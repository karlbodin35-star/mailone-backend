// ══════════════════════════════════════════════════════════════
// MAILONE — OAuth Gmail & Outlook
// ══════════════════════════════════════════════════════════════
const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const supabase   = require('../lib/supabase');
const { requireAuth } = require('../lib/auth');

const BACKEND_URL  = (process.env.BACKEND_URL  || 'https://mailone-backend.vercel.app').replace(/\/$/, '');
const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://mailone.app').replace(/\/$/, '');

const GOOGLE_AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const MS_AUTH_URL      = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MS_TOKEN_URL     = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

// ── GET /api/oauth/gmail/start ───────────────────────────────
router.get('/gmail/start', (req, res) => {
  const { state } = req.query;
  if (!state) return res.status(400).send('Paramètre state manquant.');

  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID,
    redirect_uri:  `${BACKEND_URL}/api/oauth/gmail/callback`,
    response_type: 'code',
    scope:         'https://www.googleapis.com/auth/gmail.readonly email profile',
    access_type:   'offline',
    prompt:        'consent',
    state,
  });

  res.redirect(`${GOOGLE_AUTH_URL}?${params}`);
});

// ── GET /api/oauth/gmail/callback ────────────────────────────
router.get('/gmail/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const done = (ok, provider, email, err) =>
    res.redirect(`${FRONTEND_URL}/auth-callback.html?` + (ok
      ? `success=1&provider=${provider}&email=${encodeURIComponent(email)}`
      : `error=${encodeURIComponent(err || 'erreur_inconnue')}`));

  if (error || !code || !state) return done(false, null, null, error || 'annulé');

  let userId;
  try {
    const decoded = jwt.verify(state, process.env.JWT_SECRET);
    userId = decoded.userId;
  } catch {
    return done(false, null, null, 'token_invalide');
  }

  try {
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        code,
        client_id:     process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri:  `${BACKEND_URL}/api/oauth/gmail/callback`,
        grant_type:    'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok || tokens.error) throw new Error(tokens.error_description || tokens.error);

    const profileRes = await fetch('https://www.googleapis.com/oauth2/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json();
    const email = profile.email || '';

    await supabase.from('oauth_connections').upsert({
      user_id:      userId,
      provider:     'gmail',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      token_expiry:  tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null,
      email,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,provider' });

    done(true, 'gmail', email, null);
  } catch (e) {
    console.error('Gmail OAuth callback error:', e.message);
    done(false, null, null, e.message);
  }
});

// ── GET /api/oauth/outlook/start ─────────────────────────────
router.get('/outlook/start', (req, res) => {
  const { state } = req.query;
  if (!state) return res.status(400).send('Paramètre state manquant.');

  const params = new URLSearchParams({
    client_id:     process.env.MICROSOFT_CLIENT_ID,
    redirect_uri:  `${BACKEND_URL}/api/oauth/outlook/callback`,
    response_type: 'code',
    scope:         'https://graph.microsoft.com/Mail.Read offline_access',
    response_mode: 'query',
    state,
  });

  res.redirect(`${MS_AUTH_URL}?${params}`);
});

// ── GET /api/oauth/outlook/callback ──────────────────────────
router.get('/outlook/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const done = (ok, provider, email, err) =>
    res.redirect(`${FRONTEND_URL}/auth-callback.html?` + (ok
      ? `success=1&provider=${provider}&email=${encodeURIComponent(email)}`
      : `error=${encodeURIComponent(err || 'erreur_inconnue')}`));

  if (error || !code || !state) return done(false, null, null, error || 'annulé');

  let userId;
  try {
    const decoded = jwt.verify(state, process.env.JWT_SECRET);
    userId = decoded.userId;
  } catch {
    return done(false, null, null, 'token_invalide');
  }

  try {
    const tokenRes = await fetch(MS_TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        code,
        client_id:     process.env.MICROSOFT_CLIENT_ID,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET,
        redirect_uri:  `${BACKEND_URL}/api/oauth/outlook/callback`,
        grant_type:    'authorization_code',
        scope:         'https://graph.microsoft.com/Mail.Read offline_access',
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok || tokens.error) throw new Error(tokens.error_description || tokens.error);

    const profileRes = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json();
    const email = profile.mail || profile.userPrincipalName || '';

    await supabase.from('oauth_connections').upsert({
      user_id:      userId,
      provider:     'outlook',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      token_expiry:  tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null,
      email,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,provider' });

    done(true, 'outlook', email, null);
  } catch (e) {
    console.error('Outlook OAuth callback error:', e.message);
    done(false, null, null, e.message);
  }
});

// ── GET /api/oauth/status ────────────────────────────────────
router.get('/status', requireAuth, async (req, res) => {
  const { data: connections } = await supabase
    .from('oauth_connections')
    .select('provider, email, created_at')
    .eq('user_id', req.user.id);

  if (!connections?.length) return res.json({ connected: false, providers: [], email: null });

  res.json({
    connected:   true,
    providers:   connections.map(c => c.provider),
    email:       connections[0]?.email || null,
    connections,
  });
});

// ── DELETE /api/oauth/:provider ───────────────────────────────
router.delete('/:provider', requireAuth, async (req, res) => {
  const { provider } = req.params;
  if (!['gmail', 'outlook'].includes(provider)) return res.status(400).json({ error: 'Provider invalide.' });
  await supabase.from('oauth_connections').delete().eq('user_id', req.user.id).eq('provider', provider);
  res.json({ success: true });
});

module.exports = router;
