const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const supabase = require('../lib/supabase');
const { requireAuth } = require('../lib/auth');
const {
  sendPaymentSuccessEmail,
  sendPaymentFailedEmail,
  sendCancellationEmail,
  sendReferralRewardEmail,
} = require('../lib/emails');

// ── PRICE IDS MAP ────────────────────────────────────────────
const PRICE_MAP = {
  solo_monthly:       process.env.STRIPE_PRICE_SOLO_MONTHLY,
  solo_annual:        process.env.STRIPE_PRICE_SOLO_ANNUAL,
  team_monthly:       process.env.STRIPE_PRICE_TEAM_MONTHLY,
  team_annual:        process.env.STRIPE_PRICE_TEAM_ANNUAL,
  enterprise_monthly: process.env.STRIPE_PRICE_ENT_MONTHLY,
  enterprise_annual:  process.env.STRIPE_PRICE_ENT_ANNUAL,
};

// ── CRÉER UNE SESSION CHECKOUT ───────────────────────────────
router.post('/create-checkout-session', requireAuth, async (req, res) => {
  try {
    const { plan, billing } = req.body;
    const priceKey = `${plan}_${billing}`;
    const priceId = PRICE_MAP[priceKey];

    if (!priceId) {
      return res.status(400).json({ error: `Plan inconnu : ${priceKey}` });
    }

    // Récupérer ou créer le customer Stripe
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id, stripe_subscription_id')
      .eq('user_id', req.user.id)
      .single();

    let customerId = sub?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user.email,
        name: `${req.user.first_name} ${req.user.last_name || ''}`.trim(),
        metadata: { userId: req.user.id },
      });
      customerId = customer.id;
    }

    // Si déjà abonné → rediriger vers le portail
    if (sub?.stripe_subscription_id) {
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${process.env.FRONTEND_URL}/account.html`,
      });
      return res.json({ url: portalSession.url });
    }

    // Créer la session checkout
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      subscription_data: {
        trial_period_days: 14,
        metadata: { userId: req.user.id, plan, billing },
      },
      success_url: `${process.env.FRONTEND_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/index.html#pricing`,
      allow_promotion_codes: true,
      automatic_tax: { enabled: true },
      customer_update: { address: 'auto' },
      metadata: { userId: req.user.id, plan, billing },
    });

    res.json({ url: session.url });

  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ error: 'Erreur lors de la création de la session.' });
  }
});

// ── PORTAIL CLIENT (gérer abonnement) ───────────────────────
router.post('/portal', requireAuth, async (req, res) => {
  try {
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', req.user.id)
      .single();

    if (!sub?.stripe_customer_id) {
      return res.status(404).json({ error: 'Aucun abonnement trouvé.' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${process.env.FRONTEND_URL}/account.html`,
    });

    res.json({ url: session.url });

  } catch (err) {
    console.error('Portal error:', err);
    res.status(500).json({ error: 'Erreur portail Stripe.' });
  }
});

// ── WEBHOOK STRIPE ───────────────────────────────────────────
// ⚠️ Ce endpoint doit recevoir le body RAW (pas parsé JSON)
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`📨 Stripe webhook: ${event.type}`);

  try {
    switch (event.type) {

      // ── PAIEMENT RÉUSSI ─────────────────────────────────
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
        const userId = subscription.metadata?.userId;
        if (!userId) break;

        const plan = subscription.metadata?.plan || 'solo';
        const billing = subscription.metadata?.billing || 'monthly';

        // Mettre à jour le statut en base
        await supabase
          .from('subscriptions')
          .update({
            status: 'active',
            stripe_subscription_id: subscription.id,
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          })
          .eq('user_id', userId);

        // Email de confirmation de paiement
        const { data: user } = await supabase
          .from('users')
          .select('email, first_name')
          .eq('id', userId)
          .single();

        if (user && invoice.amount_paid > 0) {
          await sendPaymentSuccessEmail({
            email: user.email,
            firstName: user.first_name,
            plan,
            amount: invoice.amount_paid,
            periodEnd: new Date(subscription.current_period_end * 1000),
            invoiceUrl: invoice.hosted_invoice_url,
          });
        }

        // Vérifier les parrainages
        const { data: referral } = await supabase
          .from('referrals')
          .select('*, referrer:referrer_id(email, first_name)')
          .eq('referee_id', userId)
          .eq('status', 'trial')
          .single();

        if (referral) {
          await supabase
            .from('referrals')
            .update({ status: 'converted', converted_at: new Date().toISOString(), reward_months: 1 })
            .eq('id', referral.id);

          // Ajouter 1 mois au parrain
          if (referral.referrer) {
            await sendReferralRewardEmail({
              email: referral.referrer.email,
              firstName: referral.referrer.first_name,
              rewardMonths: 1,
              referreeName: user?.first_name || 'Votre filleul',
            });
          }
        }
        break;
      }

      // ── PAIEMENT ÉCHOUÉ ─────────────────────────────────
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
        const userId = subscription.metadata?.userId;
        if (!userId) break;

        await supabase
          .from('subscriptions')
          .update({ status: 'past_due' })
          .eq('user_id', userId);

        const { data: user } = await supabase
          .from('users')
          .select('email, first_name')
          .eq('id', userId)
          .single();

        if (user) {
          const portalSession = await stripe.billingPortal.sessions.create({
            customer: invoice.customer,
            return_url: `${process.env.FRONTEND_URL}/account.html`,
          });
          await sendPaymentFailedEmail({
            email: user.email,
            firstName: user.first_name,
            retryUrl: portalSession.url,
          });
        }
        break;
      }

      // ── ABONNEMENT ANNULÉ ────────────────────────────────
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const userId = subscription.metadata?.userId;
        if (!userId) break;

        await supabase
          .from('subscriptions')
          .update({
            status: 'canceled',
            cancel_at_period_end: false,
          })
          .eq('stripe_subscription_id', subscription.id);

        const { data: user } = await supabase
          .from('users')
          .select('email, first_name')
          .eq('id', userId)
          .single();

        if (user) {
          await sendCancellationEmail({
            email: user.email,
            firstName: user.first_name,
            accessEnd: new Date(subscription.current_period_end * 1000),
          });
        }
        break;
      }

      // ── ABONNEMENT MIS À JOUR ────────────────────────────
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const userId = subscription.metadata?.userId;
        if (!userId) break;

        const statusMap = {
          active: 'active',
          trialing: 'trialing',
          past_due: 'past_due',
          canceled: 'canceled',
          incomplete: 'incomplete',
        };

        await supabase
          .from('subscriptions')
          .update({
            status: statusMap[subscription.status] || subscription.status,
            cancel_at_period_end: subscription.cancel_at_period_end,
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          })
          .eq('stripe_subscription_id', subscription.id);
        break;
      }

      // ── CHECKOUT COMPLÉTÉ ────────────────────────────────
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.userId;
        const plan = session.metadata?.plan;
        const billing = session.metadata?.billing;

        if (userId && plan && session.subscription) {
          await supabase
            .from('subscriptions')
            .upsert({
              user_id: userId,
              stripe_customer_id: session.customer,
              stripe_subscription_id: session.subscription,
              plan,
              billing: billing || 'monthly',
              status: 'trialing',
            }, { onConflict: 'user_id' });
        }
        break;
      }

      default:
        console.log(`Événement ignoré : ${event.type}`);
    }

    res.json({ received: true });

  } catch (err) {
    console.error('Webhook handler error:', err);
    res.status(500).json({ error: 'Erreur traitement webhook.' });
  }
});

// ── STATUT ABONNEMENT ────────────────────────────────────────
router.get('/subscription', requireAuth, async (req, res) => {
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  res.json({ subscription: sub || null });
});

module.exports = router;
