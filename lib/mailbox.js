// ══════════════════════════════════════════════════════════════
// MAILONE — Récupération des emails (IMAP + OAuth)
// Logique extraite de routes/emails.js pour être réutilisée
// par /api/dashboard et /api/mails. Aucun email n'est stocké.
// ══════════════════════════════════════════════════════════════
const { ImapFlow } = require('imapflow');
const supabase = require('./supabase');
const { decrypt } = require('./security');
const { getValidAccessToken, fetchGmailEmails, fetchOutlookEmails } = require('./oauthHelpers');

class MailboxError extends Error {
  constructor(message, code, status = 500) {
    super(message);
    this.code   = code;
    this.status = status;
  }
}

function imapClientFor(account) {
  return new ImapFlow({
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
}

// Récupère les `limit` derniers emails de l'INBOX (du plus récent au plus ancien)
async function fetchImapEmails(account, limit = 50) {
  const client = imapClientFor(account);
  try {
    await client.connect();
    await client.mailboxOpen('INBOX');

    const status = await client.status('INBOX', { messages: true });
    const total  = status.messages || 0;
    if (total === 0) { await client.logout(); return []; }

    const fetchFrom = Math.max(1, total - (limit - 1));
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
    return messages.reverse();
  } catch (e) {
    try { await client.logout(); } catch {}
    throw e;
  }
}

// Retrouve l'expéditeur et le sujet d'un mail précis dans la boîte de
// l'utilisateur (par UID) — garantit qu'on ne répond qu'à un mail qui
// appartient bien à sa propre boîte (anti-IDOR).
async function fetchImapMessageByUid(account, uid) {
  const client = imapClientFor(account);
  try {
    await client.connect();
    await client.mailboxOpen('INBOX');
    const msg = await client.fetchOne(String(uid), { envelope: true }, { uid: true });
    await client.logout();
    if (!msg || !msg.envelope) return null;
    const from = msg.envelope.from?.[0];
    return {
      uid,
      sender:      from?.name || from?.address || '',
      senderEmail: from?.address || '',
      subject:     msg.envelope.subject || '(sans objet)',
      messageId:   msg.envelope.messageId || null,
    };
  } catch (e) {
    try { await client.logout(); } catch {}
    throw e;
  }
}

// Source de mails de l'utilisateur : OAuth prioritaire, sinon IMAP
async function getUserMailSource(userId) {
  const { data: oauth } = await supabase
    .from('oauth_connections')
    .select('provider, email')
    .eq('user_id', userId)
    .single();

  if (oauth) return { type: 'oauth', provider: oauth.provider, email: oauth.email };

  const { data: account } = await supabase
    .from('email_accounts')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (account) return { type: 'imap', account };
  return null;
}

// Synchronise les emails de l'utilisateur, quelle que soit la source.
// Lève MailboxError avec code NO_ACCOUNT (404) ou OAUTH_EXPIRED (401).
async function syncUserEmails(userId, limit = 50) {
  const source = await getUserMailSource(userId);
  if (!source) throw new MailboxError('Aucun compte email configuré.', 'NO_ACCOUNT', 404);

  if (source.type === 'oauth') {
    const accessToken = await getValidAccessToken(userId, source.provider);
    if (!accessToken) {
      throw new MailboxError('Session OAuth expirée. Reconnectez votre boîte mail.', 'OAUTH_EXPIRED', 401);
    }
    const emails = source.provider === 'gmail'
      ? await fetchGmailEmails(accessToken, Math.min(limit, 30))
      : await fetchOutlookEmails(accessToken, Math.min(limit, 30));
    return { emails, source: source.provider };
  }

  const emails = await fetchImapEmails(source.account, limit);

  await supabase
    .from('email_accounts')
    .update({ last_sync: new Date().toISOString() })
    .eq('user_id', userId);

  return { emails, source: 'imap' };
}

module.exports = { MailboxError, fetchImapEmails, fetchImapMessageByUid, getUserMailSource, syncUserEmails };
