// ══════════════════════════════════════════════════════════════
// MAILONE — Dashboard triage (flow post-connexion)
// Les emails sont récupérés en direct (IMAP/OAuth) et analysés à la
// volée par l'agent local — aucun contenu de mail n'est persisté,
// conformément à la promesse « zéro stockage serveur ».
// ══════════════════════════════════════════════════════════════
const express  = require('express');
const router   = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../lib/auth');
const { MailboxError, syncUserEmails } = require('../lib/mailbox');
const { localAnalyze, localGenerateReply } = require('../lib/localAgent');
const { waitingDays } = require('../lib/followup');
const { upsertContactsFromMails } = require('../lib/contacts');

// ── GET /api/dashboard ───────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const { emails } = await syncUserEmails(req.user.id);

    // Statuts traités/ignorés — on ne stocke que id + statut, jamais de contenu
    const { data: statuses, error: statusErr } = await supabase
      .from('mail_status')
      .select('mail_id, status')
      .eq('user_id', req.user.id);
    if (statusErr) console.error('mail_status read error:', statusErr.message);

    const statusMap = new Map((statuses || []).map(s => [String(s.mail_id), s.status]));

    // Une seule liste : chaque mail porte son corps et sa réponse IA,
    // générée à la volée par l'agent local — jamais mise en cache
    // (promesse « zéro stockage serveur » de la FAQ)
    const mails = emails.map(mail => {
      const { category } = localAnalyze(mail.body, mail.subject);
      const status  = statusMap.get(String(mail.id)) || null;
      const { reply } = localGenerateReply(mail.body, mail.sender, mail.subject, category);
      return {
        id:         mail.id,
        from:       mail.sender,
        fromEmail:  mail.senderEmail,
        subject:    mail.subject,
        receivedAt: mail.date,
        body:       mail.body,
        category,
        status,
        urgent:     category === 'urgent' && !status,
        waitingDays: status ? 0 : waitingDays(mail.date),
        aiDraft:    reply,
      };
    });

    // Carnet clients : extraction des coordonnées en arrière-plan
    // (uniquement nom/email/téléphone/adresse — jamais le contenu du mail)
    upsertContactsFromMails(req.user.id, emails).catch(e => console.error('contacts upsert:', e.message));

    // Urgents non traités en tête, ordre chronologique conservé ensuite
    mails.sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0));

    res.json({
      user:        { firstName: req.user.first_name || '' },
      urgentCount: mails.filter(m => m.urgent).length,
      mails,
    });

  } catch (e) {
    if (e instanceof MailboxError) {
      return res.status(e.status).json({ error: e.message, code: e.code });
    }
    // Compte Google connecté sans avoir coché l'accès Gmail sur l'écran de consentement
    if (/insufficient|scope/i.test(e.message)) {
      return res.status(403).json({
        error: 'MailOne n\'a pas l\'autorisation de lire vos emails. Reconnectez Gmail en cochant la case « Consulter vos messages ».',
        code:  'SCOPE_MISSING',
      });
    }
    console.error('Dashboard error:', e.message);
    res.status(500).json({ error: 'Impossible de charger vos mails : ' + e.message });
  }
});

module.exports = router;
