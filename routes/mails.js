// ══════════════════════════════════════════════════════════════
// MAILONE — Actions sur un mail : répondre (SMTP) / ignorer
// Le destinataire est TOUJOURS relu depuis la boîte de l'utilisateur
// (fetch IMAP par UID) — jamais fourni par le client (anti-IDOR,
// anti-abus d'envoi arbitraire).
// ══════════════════════════════════════════════════════════════
const express    = require('express');
const router     = express.Router();
const nodemailer = require('nodemailer');
const supabase   = require('../lib/supabase');
const { requireAuth } = require('../lib/auth');
const { decrypt } = require('../lib/security');
const { getUserMailSource, fetchImapMessageByUid } = require('../lib/mailbox');

// Serveur SMTP correspondant au serveur IMAP configuré
function smtpConfigFor(imapHost) {
  const known = {
    'imap.gmail.com':       { host: 'smtp.gmail.com',        port: 465, secure: true },
    'outlook.office365.com':{ host: 'smtp.office365.com',    port: 587, secure: false },
    'imap-mail.outlook.com':{ host: 'smtp-mail.outlook.com', port: 587, secure: false },
    'imap.mail.yahoo.com':  { host: 'smtp.mail.yahoo.com',   port: 465, secure: true },
    'imap.mail.me.com':     { host: 'smtp.mail.me.com',      port: 587, secure: false },
    'imap.orange.fr':       { host: 'smtp.orange.fr',        port: 465, secure: true },
    'imap.free.fr':         { host: 'smtp.free.fr',          port: 465, secure: true },
    'ssl0.ovh.net':         { host: 'ssl0.ovh.net',          port: 465, secure: true },
  };
  return known[imapHost] || { host: imapHost.replace(/^imap[.-]/, 'smtp.'), port: 465, secure: true };
}

async function setMailStatus(userId, mailId, status) {
  const { error } = await supabase.from('mail_status').upsert({
    user_id:    userId,
    mail_id:    String(mailId),
    status,
    handled_at: new Date().toISOString(),
  }, { onConflict: 'user_id,mail_id' });
  if (error) throw new Error('Enregistrement du statut impossible : ' + error.message);
}

// ── POST /api/mails/:id/reply ────────────────────────────────
router.post('/:id/reply', requireAuth, async (req, res) => {
  const { content } = req.body || {};
  if (!content || !String(content).trim()) {
    return res.status(400).json({ error: 'Le contenu de la réponse est requis.' });
  }

  try {
    const source = await getUserMailSource(req.user.id);
    if (!source) return res.status(404).json({ error: 'Aucun compte email configuré.', code: 'NO_ACCOUNT' });

    if (source.type === 'oauth') {
      // TODO: envoi via l'API Gmail (scope gmail.send) — le scope OAuth actuel
      // est readonly et l'OAuth Google n'est pas encore configuré (pas de
      // GOOGLE_CLIENT_ID). Le frontend bascule sur un mailto pré-rempli
      // quand il reçoit ce code.
      return res.status(501).json({
        error: 'Envoi non disponible pour les comptes OAuth pour le moment.',
        code:  'SEND_UNSUPPORTED',
      });
    }

    // Relire l'expéditeur réel du mail dans la boîte de l'utilisateur
    const original = await fetchImapMessageByUid(source.account, req.params.id);
    if (!original || !original.senderEmail) {
      return res.status(404).json({ error: 'Mail introuvable dans votre boîte.' });
    }

    const smtp = smtpConfigFor(source.account.host);
    const user = decrypt(source.account.email_user);
    const pass = decrypt(source.account.email_pass);

    const transporter = nodemailer.createTransport({
      host:   smtp.host,
      port:   smtp.port,
      secure: smtp.secure,
      auth:   { user, pass },
    });

    const subject = /^re\s*:/i.test(original.subject) ? original.subject : `Re: ${original.subject}`;

    await transporter.sendMail({
      from:    user,
      to:      original.senderEmail,
      subject,
      text:    String(content),
      ...(original.messageId ? { inReplyTo: original.messageId, references: original.messageId } : {}),
    });

    await setMailStatus(req.user.id, req.params.id, 'handled');

    res.json({ success: true, to: original.senderEmail });

  } catch (e) {
    console.error('Reply error:', e.message);
    if (/auth|credentials|535/i.test(e.message)) {
      return res.status(502).json({ error: 'Le serveur d\'envoi a refusé vos identifiants. Vérifiez votre mot de passe d\'application.' });
    }
    res.status(500).json({ error: 'Envoi impossible : ' + e.message });
  }
});

// ── POST /api/mails/:id/dismiss ──────────────────────────────
router.post('/:id/dismiss', requireAuth, async (req, res) => {
  try {
    await setMailStatus(req.user.id, req.params.id, 'dismissed');
    res.json({ success: true });
  } catch (e) {
    console.error('Dismiss error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
