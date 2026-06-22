const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const supabase = require('../lib/supabase');
const { generateToken, requireAuth } = require('../lib/auth');
const { sendWelcomeEmail, sendPasswordResetEmail } = require('../lib/emails');
const { purgeUserData } = require('../lib/security');

const BACKEND_URL  = process.env.BACKEND_URL  || 'https://mailone-backend.vercel.app';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://mailone.app';

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

    // Essai 14 jours — pas de paiement à l'inscription, Stripe intervient après le trial
    const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    const { error: subError } = await supabase.from('subscriptions').insert({
      user_id: user.id,
      stripe_customer_id: null,
      stripe_subscription_id: null,
      plan: plan || 'solo',
      billing: billing || 'monthly',
      status: 'trialing',
      trial_end: trialEnd,
      current_period_start: new Date().toISOString(),
      current_period_end: trialEnd,
    });
    if (subError) console.error('Subscription insert error:', subError.message);

    // ── Traiter l'invitation d'équipe si présente ──
    const { inviteToken } = req.body;
    if (inviteToken) {
      const { data: invite } = await supabase
        .from('team_members')
        .select('id, team_id, invited_email, teams(max_seats)')
        .eq('invite_token', inviteToken)
        .eq('status', 'invited')
        .single();

      if (invite && invite.invited_email === email.toLowerCase()) {
        // Vérifier qu'il reste un siège
        const { count } = await supabase
          .from('team_members')
          .select('id', { count: 'exact', head: true })
          .eq('team_id', invite.team_id)
          .eq('status', 'active');

        if ((count || 0) < (invite.teams?.max_seats || 1)) {
          await supabase
            .from('team_members')
            .update({ user_id: user.id, status: 'active', joined_at: new Date().toISOString(), invite_token: null })
            .eq('id', invite.id);
        }
      }
    }

    // ── Créer automatiquement l'équipe pour les plans team/enterprise ──
    if ((plan === 'team' || plan === 'enterprise') && !inviteToken) {
      try {
        const PLAN_SEATS = { team: 10, enterprise: 50 };
        const maxSeats = PLAN_SEATS[plan] || 10;
        const { data: team, error: teamError } = await supabase
          .from('teams')
          .insert({ owner_id: user.id, name: `Équipe de ${firstName}`, max_seats: maxSeats })
          .select()
          .single();

        if (teamError) console.error('Team insert error:', teamError.message);

        if (team) {
          const { error: memberError } = await supabase.from('team_members').insert({
            team_id: team.id,
            user_id: user.id,
            role: 'owner',
            status: 'active',
            joined_at: new Date().toISOString(),
          });
          if (memberError) console.error('Team member insert error:', memberError.message);
        }
      } catch (teamErr) {
        console.error('Team creation error:', teamErr.message);
      }
    }

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

// ── GOOGLE OAUTH LOGIN / INSCRIPTION ─────────────────────────
router.get('/google/start', (req, res) => {
  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID,
    redirect_uri:  `${BACKEND_URL}/api/auth/google/callback`,
    response_type: 'code',
    scope:         'email profile https://www.googleapis.com/auth/gmail.readonly',
    access_type:   'offline',
    prompt:        'consent',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

router.get('/google/callback', async (req, res) => {
  const { code, error } = req.query;
  const errRedirect = (msg) =>
    res.redirect(`${FRONTEND_URL}/login.html?google_error=${encodeURIComponent(msg)}&action=login`);

  if (error || !code) return errRedirect(error === 'access_denied' ? 'Accès refusé' : 'Connexion annulée');

  try {
    // Échanger le code contre des tokens Google
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        code,
        client_id:     process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri:  `${BACKEND_URL}/api/auth/google/callback`,
        grant_type:    'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tokens.error_description || 'Échange de code échoué');

    // Récupérer le profil Google
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json();
    const email = (profile.email || '').toLowerCase();
    if (!email) throw new Error('Email Google non disponible');

    const firstName = profile.given_name  || profile.name?.split(' ')[0]            || 'Utilisateur';
    const lastName  = profile.family_name || profile.name?.split(' ').slice(1).join(' ') || '';

    // Trouver ou créer l'utilisateur
    let { data: user } = await supabase.from('users').select('*').eq('email', email).single();

    if (!user) {
      // Nouveau compte — mot de passe aléatoire (jamais utilisé)
      const randomPwdHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
      const { data: newUser, error: insertErr } = await supabase
        .from('users')
        .insert({ email, first_name: firstName, last_name: lastName, password_hash: randomPwdHash, company: '', is_active: true, marketing: false })
        .select()
        .single();
      if (insertErr) throw insertErr;
      user = newUser;

      // Essai 14 jours
      const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
      await supabase.from('subscriptions').insert({
        user_id: user.id, plan: 'solo', billing: 'monthly', status: 'trialing',
        trial_end: trialEnd, current_period_start: new Date().toISOString(), current_period_end: trialEnd,
      });

      // Email de bienvenue (optionnel — ne bloque pas en cas d'erreur)
      try { await sendWelcomeEmail({ email, firstName, plan: 'solo', trialEnd }); } catch (_) {}
    }

    // Stocker les tokens Gmail pour la lecture d'emails (même flux que oauth.js)
    if (tokens.access_token) {
      await supabase.from('oauth_connections').upsert({
        user_id:      user.id,
        provider:     'gmail',
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || null,
        token_expiry:  tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null,
        email,
        updated_at:   new Date().toISOString(),
      }, { onConflict: 'user_id,provider' });
    }

    // Récupérer l'abonnement
    const { data: sub } = await supabase
      .from('subscriptions').select('*').eq('user_id', user.id)
      .order('created_at', { ascending: false }).limit(1).single();

    await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id);

    // Émettre notre JWT
    const jwtToken = generateToken(user.id);

    // Construire l'objet utilisateur pour le frontend
    const userObj = {
      id:        user.id,
      email:     user.email,
      firstName: user.first_name,
      lastName:  user.last_name,
      company:   user.company || '',
      plan:      sub?.plan    || 'solo',
      billing:   sub?.billing || 'monthly',
      status:    sub?.status  || 'trialing',
      trialEnd:  sub?.trial_end || null,
    };

    // Rediriger vers le frontend avec JWT + user dans le fragment hash
    const fragment = new URLSearchParams({ gt: jwtToken, u: JSON.stringify(userObj) }).toString();
    res.redirect(`${FRONTEND_URL}/auth-callback.html#${fragment}`);

  } catch (e) {
    console.error('Google auth error:', e.message);
    errRedirect(e.message || 'Erreur de connexion Google');
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
