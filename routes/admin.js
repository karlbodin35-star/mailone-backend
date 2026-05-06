// ══════════════════════════════════════════════════════════════
// MAILONE — Admin : statistiques agrégées (zéro donnée personnelle)
// ══════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../lib/auth');

// ── Middleware admin ─────────────────────────────────────────
async function requireAdmin(req, res, next) {
  const { data: user } = await supabase
    .from('users')
    .select('is_admin')
    .eq('id', req.user.id)
    .single();

  if (!user?.is_admin) {
    return res.status(403).json({ error: 'Accès réservé aux administrateurs.' });
  }
  next();
}

// ── GET /api/admin/stats — métriques agrégées ────────────────
router.get('/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    // ── Compteurs utilisateurs ──
    const { count: totalUsers } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true);

    const { count: newUsersThisMonth } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString());

    // ── Abonnements ──
    const { data: subs } = await supabase
      .from('subscriptions')
      .select('status, plan, billing');

    const active   = (subs || []).filter(s => s.status === 'active').length;
    const trialing = (subs || []).filter(s => s.status === 'trialing').length;
    const pastDue  = (subs || []).filter(s => s.status === 'past_due').length;
    const canceled = (subs || []).filter(s => s.status === 'canceled').length;

    // ── Répartition par plan ──
    const activeSubs = (subs || []).filter(s => s.status === 'active');
    const planCounts = {
      solo:       activeSubs.filter(s => s.plan === 'solo').length,
      team:       activeSubs.filter(s => s.plan === 'team').length,
      enterprise: activeSubs.filter(s => s.plan === 'enterprise').length,
    };

    // ── MRR depuis Stripe (réel) ──
    let mrr = 0;
    let mrrLastMonth = 0;
    let recentPayments = [];

    try {
      // Abonnements actifs Stripe
      const stripeSubs = await stripe.subscriptions.list({
        status: 'active',
        limit: 100,
        expand: ['data.items.data.price'],
      });

      stripeSubs.data.forEach(sub => {
        sub.items.data.forEach(item => {
          const amount = item.price.unit_amount / 100;
          const interval = item.price.recurring?.interval;
          mrr += interval === 'year' ? Math.round(amount / 12) : amount;
        });
      });

      // Paiements du mois dernier pour comparaison
      const lastMonthStart = Math.floor(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).getTime() / 1000);
      const lastMonthEnd   = Math.floor(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() / 1000);

      const invoices = await stripe.invoices.list({
        status: 'paid',
        created: { gte: lastMonthStart, lt: lastMonthEnd },
        limit: 100,
      });
      mrrLastMonth = invoices.data.reduce((s, inv) => s + inv.amount_paid / 100, 0);

      // 5 derniers paiements (montant + date uniquement — pas de nom)
      const recent = await stripe.charges.list({ limit: 5 });
      recentPayments = recent.data.map(c => ({
        amount: c.amount / 100,
        currency: c.currency.toUpperCase(),
        date: new Date(c.created * 1000).toLocaleDateString('fr-FR'),
        status: c.status,
      }));

    } catch (stripeErr) {
      console.error('Stripe admin stats error:', stripeErr.message);
    }

    // ── Utilisation IA ce mois ──
    const monthKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    const { data: aiUsage } = await supabase
      .from('ai_usage')
      .select('count')
      .eq('month_key', monthKey);
    const totalAiRequests = (aiUsage || []).reduce((s, u) => s + (u.count || 0), 0);

    // ── MRR historique (6 mois, depuis Stripe) ──
    const mrrHistory = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const label = d.toLocaleDateString('fr-FR', { month: 'short' });
      const start = Math.floor(new Date(d.getFullYear(), d.getMonth(), 1).getTime() / 1000);
      const end   = Math.floor(new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() / 1000);
      let monthMrr = 0;
      try {
        const inv = await stripe.invoices.list({ status: 'paid', created: { gte: start, lt: end }, limit: 100 });
        monthMrr = inv.data.reduce((s, invoice) => s + invoice.amount_paid / 100, 0);
      } catch { /* ignore */ }
      mrrHistory.push({ month: label, mrr: Math.round(monthMrr) });
    }

    const arpu = active > 0 ? Math.round(mrr / active) : 0;
    const churnRate = (active + canceled) > 0 ? Math.round(canceled / (active + canceled) * 100) : 0;

    res.json({
      users: { total: totalUsers || 0, newThisMonth: newUsersThisMonth || 0 },
      subscriptions: { active, trialing, pastDue, canceled },
      plans: planCounts,
      revenue: {
        mrr: Math.round(mrr),
        arr: Math.round(mrr * 12),
        mrrLastMonth: Math.round(mrrLastMonth),
        arpu,
        churnRate,
        recentPayments,
        history: mrrHistory,
      },
      usage: { aiRequestsThisMonth: totalAiRequests },
    });

  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ error: 'Erreur chargement statistiques.' });
  }
});

module.exports = router;
