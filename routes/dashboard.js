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

    const urgent = [];
    const rest   = [];

    for (const mail of emails) {
      const { category } = localAnalyze(mail.body, mail.subject);
      const handled = statusMap.has(String(mail.id));

      if (category === 'urgent' && !handled) {
        // Draft généré à la volée par l'agent local — jamais mis en cache
        // (promesse « zéro stockage serveur » de la FAQ)
        const { reply } = localGenerateReply(mail.body, mail.sender, mail.subject, 'urgent');
        urgent.push({
          id:         mail.id,
          from:       mail.sender,
          fromEmail:  mail.senderEmail,
          subject:    mail.subject,
          receivedAt: mail.date,
          body:       mail.body,
          aiDraft:    reply,
        });
      } else {
        rest.push({
          id:         mail.id,
          from:       mail.sender,
          subject:    mail.subject,
          category,
          status:     statusMap.get(String(mail.id)) || null,
          receivedAt: mail.date,
        });
      }
    }

    res.json({
      user:        { firstName: req.user.first_name || '' },
      urgentCount: urgent.length,
      urgent,
      sorted:      rest.slice(0, 10),
    });

  } catch (e) {
    if (e instanceof MailboxError) {
      return res.status(e.status).json({ error: e.message, code: e.code });
    }
    console.error('Dashboard error:', e.message);
    res.status(500).json({ error: 'Impossible de charger vos mails.' });
  }
});

module.exports = router;
