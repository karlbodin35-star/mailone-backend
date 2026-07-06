// ══════════════════════════════════════════════════════════════
// MAILONE — Connexion et synchronisation emails (IMAP + OAuth)
// ══════════════════════════════════════════════════════════════
const express  = require('express');
const router   = express.Router();
const { ImapFlow } = require('imapflow');
const supabase = require('../lib/supabase');
const { requireAuth } = require('../lib/auth');
const { encrypt } = require('../lib/security');
const { MailboxError, syncUserEmails } = require('../lib/mailbox');

// ── POST /api/emails/connect ─────────────────────────────────
router.post('/connect', requireAuth, async (req, res) => {
  const { host, port = 993, user, password, tls = true, name } = req.body;
  if (!host || !user || !password) {
    return res.status(400).json({ error: 'host, user et password sont requis.' });
  }

  const client = new ImapFlow({
    host,
    port: Number(port),
    secure: tls,
    auth: { user, pass: password },
    logger: false,
    tls: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    await client.logout();
  } catch (e) {
    return res.status(400).json({ error: 'Connexion impossible : ' + e.message });
  }

  await supabase.from('email_accounts').upsert({
    user_id:    req.user.id,
    host,
    port:       Number(port),
    tls,
    email_user: encrypt(user),
    email_pass: encrypt(password),
    name:       name || user,
  }, { onConflict: 'user_id' });

  res.json({ success: true, name: name || user });
});

// ── GET /api/emails/account ──────────────────────────────────
router.get('/account', requireAuth, async (req, res) => {
  const { data: imap } = await supabase
    .from('email_accounts')
    .select('id, host, name, port, tls, created_at, last_sync')
    .eq('user_id', req.user.id)
    .single();

  if (imap) return res.json({ account: imap });

  // Fall back to OAuth connection info
  const { data: oauth } = await supabase
    .from('oauth_connections')
    .select('provider, email, created_at')
    .eq('user_id', req.user.id)
    .single();

  if (oauth) {
    return res.json({
      account: {
        id:         `oauth_${oauth.provider}`,
        host:       oauth.provider === 'gmail' ? 'gmail.oauth' : 'outlook.oauth',
        name:       oauth.email,
        port:       null,
        tls:        true,
        created_at: oauth.created_at,
        last_sync:  null,
        provider:   oauth.provider,
        email:      oauth.email,
      },
    });
  }

  res.json({ account: null });
});

// ── GET /api/emails/sync ─────────────────────────────────────
router.get('/sync', requireAuth, async (req, res) => {
  try {
    const { emails, source } = await syncUserEmails(req.user.id);
    res.json(source === 'imap' ? { emails } : { emails, source });
  } catch (e) {
    if (e instanceof MailboxError) {
      const payload = { error: e.message };
      if (e.code === 'OAUTH_EXPIRED') payload.code = e.code;
      return res.status(e.status).json(payload);
    }
    console.error('Sync error:', e.message);
    res.status(500).json({ error: 'Erreur de synchronisation : ' + e.message });
  }
});

// ── DELETE /api/emails/account ───────────────────────────────
router.delete('/account', requireAuth, async (req, res) => {
  await supabase.from('email_accounts').delete().eq('user_id', req.user.id);
  res.json({ success: true });
});

module.exports = router;
