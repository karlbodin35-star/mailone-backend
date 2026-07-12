// ══════════════════════════════════════════════════════════════
// MAILONE — Agenda : rendez-vous de l'utilisateur
// Stocke uniquement des événements créés par l'utilisateur
// (titre + date) — aucun contenu de mail.
// ══════════════════════════════════════════════════════════════
const express  = require('express');
const router   = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../lib/auth');

// ── GET /api/events ──────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('events')
    .select('id, title, starts_at, mail_id')
    .eq('user_id', req.user.id)
    .order('starts_at', { ascending: true });

  if (error) {
    console.error('events list error:', error.message);
    return res.status(500).json({ error: 'Agenda indisponible : ' + error.message });
  }
  res.json({ events: data || [] });
});

// ── POST /api/events ─────────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  const { title, starts_at, mail_id } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Le titre est requis.' });
  const when = new Date(starts_at);
  if (isNaN(when)) return res.status(400).json({ error: 'Date invalide.' });

  const { data, error } = await supabase.from('events').insert({
    user_id:   req.user.id,
    title:     String(title).trim().slice(0, 120),
    starts_at: when.toISOString(),
    mail_id:   mail_id ? String(mail_id) : null,
  }).select('id, title, starts_at, mail_id').single();

  if (error) {
    console.error('event insert error:', error.message);
    return res.status(500).json({ error: 'Enregistrement impossible : ' + error.message });
  }
  res.json({ event: data });
});

// ── DELETE /api/events/:id ───────────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  const { error } = await supabase
    .from('events')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);   // un utilisateur ne supprime que SES événements

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
