const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const supabase = require('../lib/supabase');
const { requireAuth } = require('../lib/auth');

// ── MON LIEN DE PARRAINAGE ───────────────────────────────────
router.get('/my-code', requireAuth, async (req, res) => {
  try {
    // Vérifier si un code existe déjà
    const { data: existing } = await supabase
      .from('referrals')
      .select('referral_code')
      .eq('referrer_id', req.user.id)
      .limit(1)
      .single();

    let code;
    if (existing) {
      code = existing.referral_code;
    } else {
      // Générer un code unique basé sur le nom + random
      const base = `${req.user.first_name || 'user'}-${crypto.randomBytes(4).toString('hex')}`;
      code = base.toLowerCase().replace(/[^a-z0-9-]/g, '');

      await supabase.from('referrals').insert({
        referrer_id: req.user.id,
        referral_code: code,
        status: 'pending',
      });
    }

    const referralUrl = `${process.env.FRONTEND_URL}/login.html?ref=${code}`;

    // Statistiques
    const { data: referrals } = await supabase
      .from('referrals')
      .select('*')
      .eq('referrer_id', req.user.id);

    const stats = {
      totalInvited:   referrals?.filter(r => r.referee_id).length || 0,
      converted:      referrals?.filter(r => r.status === 'converted' || r.status === 'rewarded').length || 0,
      monthsEarned:   referrals?.reduce((s, r) => s + (r.reward_months || 0), 0) || 0,
    };

    res.json({ code, referralUrl, stats });

  } catch (err) {
    console.error('Referral code error:', err);
    res.status(500).json({ error: 'Erreur lors de la récupération du code.' });
  }
});

// ── MES FILLEULS ─────────────────────────────────────────────
router.get('/my-referrals', requireAuth, async (req, res) => {
  const { data: referrals } = await supabase
    .from('referrals')
    .select('*, referee:referee_id(first_name, last_name, email)')
    .eq('referrer_id', req.user.id)
    .order('created_at', { ascending: false });

  res.json({ referrals: referrals || [] });
});

// ── VÉRIFIER UN CODE DE PARRAINAGE ───────────────────────────
router.get('/validate/:code', async (req, res) => {
  const { data: referral } = await supabase
    .from('referrals')
    .select('referral_code, referrer:referrer_id(first_name, last_name)')
    .eq('referral_code', req.params.code)
    .single();

  if (!referral) {
    return res.status(404).json({ valid: false });
  }

  res.json({
    valid: true,
    referrerName: referral.referrer
      ? `${referral.referrer.first_name} ${referral.referrer.last_name || ''}`.trim()
      : null,
    discount: '50% sur le 1er mois',
  });
});

module.exports = router;
