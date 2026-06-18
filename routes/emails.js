// ══════════════════════════════════════════════════════════════
// MAILONE — Connexion et synchronisation emails (IMAP + OAuth)
// ══════════════════════════════════════════════════════════════
const express  = require('express');
const router   = express.Router();
const { ImapFlow } = require('imapflow');
const supabase = require('../lib/supabase');
const { requireAuth } = require('../lib/auth');
const { encrypt, decrypt } = require('../lib/security');
const { getValidAccessToken, fetchGmailEmails, fetchOutlookEmails } = require('../lib/oauthHelpers');

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
  // Check OAuth first
  const { data: oauth } = await supabase
    .from('oauth_connections')
    .select('provider, email')
    .eq('user_id', req.user.id)
    .single();

  if (oauth) {
    try {
      const accessToken = await getValidAccessToken(req.user.id, oauth.provider);
      if (!accessToken) {
        return res.status(401).json({ error: 'Session OAuth expirée. Reconnectez votre boîte mail.', code: 'OAUTH_EXPIRED' });
      }
      const emails = oauth.provider === 'gmail'
        ? await fetchGmailEmails(accessToken)
        : await fetchOutlookEmails(accessToken);
      return res.json({ emails, source: oauth.provider });
    } catch (e) {
      console.error('OAuth sync error:', e.message);
      return res.status(500).json({ error: 'Erreur synchronisation OAuth : ' + e.message });
    }
  }

  // Fall back to IMAP
  const { data: account } = await supabase
    .from('email_accounts')
    .select('*')
    .eq('user_id', req.user.id)
    .single();

  if (!account) return res.status(404).json({ error: 'Aucun compte email configuré.' });

  const client = new ImapFlow({
    host:   account.host,
    port:   account.port,
    secure: account.tls,
    auth: {
      user: decrypt(account.email_user),
      pass: decrypt(account.email_pass),
    },
    logger: false,
    tls: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    await client.mailboxOpen('INBOX');

    const status = await client.status('INBOX', { messages: true });
    const total  = status.messages || 0;
    if (total === 0) { await client.logout(); return res.json({ emails: [] }); }

    const fetchFrom = Math.max(1, total - 49);
    const messages  = [];

    for await (const msg of client.fetch(`${fetchFrom}:*`, {
      envelope:      true,
      bodyStructure: true,
      bodyParts:     ['1'],
    })) {
      let body = '';
      try {
        const part = msg.bodyParts?.get('1');
        if (part) body = part.toString('utf-8').replace(/\r\n/g, '\n').slice(0, 500);
      } catch {}

      const from = msg.envelope?.from?.[0];
      messages.push({
        id:          msg.uid,
        sender:      from?.name || from?.address || 'Inconnu',
        senderEmail: from?.address || '',
        subject:     msg.envelope?.subject || '(sans objet)',
        date:        msg.envelope?.date?.toISOString() || new Date().toISOString(),
        body,
      });
    }

    await client.logout();

    await supabase
      .from('email_accounts')
      .update({ last_sync: new Date().toISOString() })
      .eq('user_id', req.user.id);

    res.json({ emails: messages.reverse() });

  } catch (e) {
    console.error('IMAP sync error:', e.message);
    try { await client.logout(); } catch {}
    res.status(500).json({ error: 'Erreur de synchronisation : ' + e.message });
  }
});

// ── DELETE /api/emails/account ───────────────────────────────
router.delete('/account', requireAuth, async (req, res) => {
  await supabase.from('email_accounts').delete().eq('user_id', req.user.id);
  res.json({ success: true });
});

module.exports = router;
