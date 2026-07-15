// ══════════════════════════════════════════════════════════════
// MAILONE — Carnet clients (coordonnées uniquement, zéro contenu mail)
// ══════════════════════════════════════════════════════════════
const express  = require('express');
const router   = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../lib/auth');

router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('contacts')
    .select('id, name, email, phone, address, first_seen, last_seen')
    .eq('user_id', req.user.id)
    .order('last_seen', { ascending: false });

  if (error) return res.status(500).json({ error: 'Carnet indisponible : ' + error.message });
  res.json({ contacts: data || [] });
});

router.delete('/:id', requireAuth, async (req, res) => {
  const { error } = await supabase
    .from('contacts').delete()
    .eq('id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
