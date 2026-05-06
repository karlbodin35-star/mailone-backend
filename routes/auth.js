const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const supabase = require('../lib/supabase');
const { generateToken, requireAuth } = require('../lib/auth');
const { sendWelcomeEmail, sendPasswordResetEmail } = require('../lib/emails');
const { purgeUserData } = require('../lib/security');

// ── INSCRIPTION ──────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { firstName, lastName, email, password, company, plan, billing, marketing, referralCode } = req.body;

    // Validation
    if (!firstName || !email || !password) {
      return res.status(400).json({ error: 'Prénom, email et mot de passe requis.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Mot de passe trop court (8 caractères minimum).' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Email invalide.' });
    }

    // Vérifier si email déjà utilisé
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Un compte existe déjà avec cet email.' });
    }

    // Hasher le mot de passe
    const passwordHash = await bcrypt.hash(password, 12);

    // Créer l'utilisateur
    const { data: user, error: userError } = await supabase
      .from('users')
      .insert({
        email: email.toLowerCase(),
        password_hash: passwordHash,
        first_name: firstName,
        last_name: lastName || '',
        company: company || '',
        marketing: marketing || false,
      })
      .select()
      .single();

    if (userError) throw userError;

    // Gérer le parrainage
    if (referralCode) {
      const { data: referral } = await supabase
        .from('referrals')
        .select('*')
        .eq('referral_code', referralCode)
        .single();

      if (referral && referral.status === 'pending') {
        await supabase
          .from('referrals')
          .update({ referee_id: user.id, status: 'trial' })
          .eq('id', referral.id);
      }
    }

    // Créer le client Stripe + session de paiement
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    // Créer le customer Stripe
    const customer = await stripe.customers.create({
      email: email.toLowerCase(),
      name: `${firstName} ${lastName || ''}`.trim(),
      metadata: {
        userId: user.id,
        plan: plan || 'solo',
      },
    });

    // Mapper plan + billing → Price ID
    const priceMap = {
      'solo_monthly':       process.env.STRIPE_PRICE_SOLO_MONTHLY,
      'solo_annual':        process.env.STRIPE_PRICE_SOLO_ANNUAL,
      'team_monthly':       process.env.STRIPE_PRICE_TEAM_MONTHLY,
      'team_annual':        process.env.STRIPE_PRICE_TEAM_ANNUAL,
      'enterprise_monthly': process.env.STRIPE_PRICE_ENT_MONTHLY,
      'enterprise_annual':  process.env.STRIPE_PRICE_ENT_ANNUAL,
    };
    const priceKey = `${plan || 'solo'}_${billing || 'monthly'}`;
    const priceId = priceMap[priceKey];

    // Créer l'abonnement avec trial 14j
    let subscription = null;
    if (priceId) {
      subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: priceId }],
        trial_period_days: 14,
        payment_behavior: 'default_incomplete',
        expand: ['latest_invoice.payment_intent'],
        metadata: { userId: user.id, plan: plan || 'solo' },
      });
    }

    // Sauvegarder l'abonnement en base
    const trialEnd = subscription?.trial_end
      ? new Date(subscription.trial_end * 1000).toISOString()
      : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    await supabase.from('subscriptions').insert({
      user_id: user.id,
      stripe_customer_id: customer.id,
      stripe_subscription_id: subscription?.id || null,
      plan: plan || 'solo',
      billing: billing || 'monthly',
      status: 'trialing',
      trial_end: trialEnd,
      current_period_start: new Date().toISOString(),
      current_period_end: trialEnd,
    });

    // Envoyer l'email de bienvenue
    try {
      await sendWelcomeEmail({
        email: email.toLowerCase(),
        firstName,
        plan: plan || 'solo',
        trialEnd,
      });
    } catch (emailErr) {
      console.error('Email welcome error:', emailErr.message);
    }

    // Générer le JWT
    const token = generateToken(user.id);

    res.status(201).json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        company: user.company,
        plan: plan || 'solo',
        billing: billing || 'monthly',
        status: 'trialing',
        trialEnd,
      },
    });

  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Erreur lors de la création du compte.' });
  }
});

// ── CONNEXION ────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis.' });
    }

    // Trouver l'utilisateur
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase())
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'Identifiants incorrects.' });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Compte suspendu. Contactez le support.' });
    }

    // Vérifier le mot de passe
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Identifiants incorrects.' });
    }

    // Récupérer l'abonnement
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // Mettre à jour last_login
    await supabase
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', user.id);

    const token = generateToken(user.id);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        company: user.company,
        plan: sub?.plan || 'solo',
        billing: sub?.billing || 'monthly',
        status: sub?.status || 'inactive',
        trialEnd: sub?.trial_end,
      },
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Erreur lors de la connexion.' });
  }
});

// ── MOI (profil) ─────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      firstName: req.user.first_name,
      lastName: req.user.last_name,
      company: req.user.company,
      plan: sub?.plan || 'solo',
      billing: sub?.billing || 'monthly',
      status: sub?.status || 'inactive',
      trialEnd: sub?.trial_end,
      currentPeriodEnd: sub?.current_period_end,
    },
  });
});

// ── METTRE À JOUR LE PROFIL ──────────────────────────────────
router.put('/me', requireAuth, async (req, res) => {
  try {
    const { firstName, lastName, company, phone, sector } = req.body;

    const { data, error } = await supabase
      .from('users')
      .update({
        first_name: firstName,
        last_name: lastName,
        company,
        phone,
        sector,
      })
      .eq('id', req.user.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, user: data });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la mise à jour.' });
  }
});

// ── MOT DE PASSE OUBLIÉ ──────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requis.' });

    const { data: user } = await supabase
      .from('users')
      .select('id, first_name, email')
      .eq('email', email.toLowerCase())
      .single();

    // Toujours répondre OK (sécurité : ne pas révéler si l'email existe)
    if (!user) {
      return res.json({ success: true, message: 'Si cet email existe, un lien a été envoyé.' });
    }

    // Générer un token de reset (1h)
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    // Stocker le token hashé
    await supabase
      .from('users')
      .update({
        reset_token: crypto.createHash('sha256').update(resetToken).digest('hex'),
        reset_token_expires: resetExpires,
      })
      .eq('id', user.id);

    const resetUrl = `${process.env.FRONTEND_URL}/reset-password.html?token=${resetToken}`;

    await sendPasswordResetEmail({
      email: user.email,
      firstName: user.first_name,
      resetUrl,
    });

    res.json({ success: true, message: 'Si cet email existe, un lien a été envoyé.' });

  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Erreur lors de la demande.' });
  }
});

// ── RESET MOT DE PASSE ───────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password || password.length < 8) {
      return res.status(400).json({ error: 'Token et mot de passe (8+ caractères) requis.' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('reset_token', tokenHash)
      .gt('reset_token_expires', new Date().toISOString())
      .single();

    if (!user) {
      return res.status(400).json({ error: 'Token invalide ou expiré.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await supabase
      .from('users')
      .update({
        password_hash: passwordHash,
        reset_token: null,
        reset_token_expires: null,
      })
      .eq('id', user.id);

    res.json({ success: true, message: 'Mot de passe mis à jour.' });

  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Erreur lors de la réinitialisation.' });
  }
});

// ── SUPPRIMER LE COMPTE ──────────────────────────────────────
router.delete('/me', requireAuth, async (req, res) => {
  try {
    // Annuler l'abonnement Stripe
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('stripe_subscription_id')
      .eq('user_id', req.user.id)
      .single();

    if (sub?.stripe_subscription_id) {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      await stripe.subscriptions.cancel(sub.stripe_subscription_id);
    }

    // Suppression immédiate et définitive — aucune donnée résiduelle
    await purgeUserData(req.user.id);

    res.json({ success: true, message: 'Compte et données supprimés définitivement.' });

  } catch (err) {
    console.error('Delete account error:', err);
    res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

module.exports = router;
