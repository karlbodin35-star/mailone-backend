// ══════════════════════════════════════════════════════════════
// MAILONE — Agents marketing & prospection
// 2.1 Agent Contenu (posts Instagram/LinkedIn)
// 2.2 Agent Prospection (email + SMS + LinkedIn — BROUILLONS uniquement)
// 2.3 Agent Veille/Relance commerciale (suivi prospects)
// Générateurs locaux (gratuits) — Anthropic en secours si disponible.
// Règle produit n°2 : aucun envoi automatique, tout est brouillon.
// ══════════════════════════════════════════════════════════════
const express  = require('express');
const router   = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth, requireAdmin } = require('../lib/auth');
const { nextRelance, relanceDue } = require('../agents/lib/relanceRules');

// ── 2.1 AGENT CONTENU ────────────────────────────────────────
function localContentPost(theme, platform) {
  const t = String(theme || '').trim() || 'le quotidien d\'un artisan';
  const insta = platform !== 'linkedin';
  const hooks = [
    `⏱️ ${t} : et si vous récupériez 1 h par jour ?`,
    `La vérité sur ${t} (que personne ne dit aux artisans)`,
    `3 erreurs qui vous font perdre des clients sur ${t}`,
  ];
  const bodies = [
    `Chaque mail sans réponse, c'est un client qui appelle le concurrent.\n\nAvec MailOne, vos mails sont triés, les urgences remontent toutes seules et la réponse est déjà écrite — vous n'avez plus qu'à cliquer.\n\n30 secondes par mail au lieu de 8 minutes. Le soir, votre boîte est vide et votre tête aussi.`,
    `On ne devient pas artisan pour passer ses soirées sur sa boîte mail.\n\n${t} ne devrait pas vous voler du temps de chantier (ni du temps en famille). L'IA trie, résume, prépare la réponse. Vous validez. Point.`,
  ];
  const ctas = insta
    ? ['👉 Essai gratuit 14 jours — lien en bio', '📩 Réponds « MAIL » en DM, je t\'explique en 2 min']
    : ['Essai gratuit 14 jours sur mailone.app — sans carte bancaire.', 'Curieux de voir ce que ça donne sur VOTRE boîte ? Commentez « démo ».'];
  const hashtags = insta
    ? '#artisan #plombier #electricien #TPE #gestion #gaindetemps #IA'
    : '#artisanat #TPE #productivité #relationclient';
  const pick = a => a[Math.floor(Math.random() * a.length)];
  return {
    platform: insta ? 'instagram' : 'linkedin',
    text: `${pick(hooks)}\n\n${pick(bodies)}\n\n${pick(ctas)}\n\n${hashtags}`,
    visual: insta
      ? `Photo chantier réelle (avant/après) ou artisan au téléphone, souriant. Texte incrusté : « ${t} — 30 sec/mail ». Couleurs sombres + accent bleu électrique, logo MailOne en coin.`
      : `Capture d'écran du dashboard MailOne (mode sombre) avec 3 mails triés, ou portrait pro de l'artisan. Format 1200×627.`,
  };
}

router.post('/content', requireAuth, requireAdmin, (req, res) => {
  const { theme, platform } = req.body || {};
  res.json({ post: localContentPost(theme, platform), engine: 'local' });
});

// ── 2.2 AGENT PROSPECTION (brouillons uniquement) ────────────
function localProspectDrafts({ metier = 'artisan', ville = '', taille = '' }) {
  const m = String(metier).trim() || 'artisan';
  const v = String(ville).trim();
  const ou = v ? ` à ${v}` : '';
  const tailleTxt = taille ? ` Avec une équipe comme la vôtre (${taille}),` : '';
  return {
    email: {
      subject: `${m.charAt(0).toUpperCase() + m.slice(1)}${ou} : vos mails clients en 30 secondes`,
      body: `Bonjour,\n\nJe contacte quelques ${m}s${ou} : la plupart me disent perdre 1 h par jour dans les mails — devis à répondre, relances oubliées, urgences noyées.\n\nMailOne trie vos mails automatiquement, fait remonter les urgences et prépare chaque réponse. Vous validez, c'est envoyé.${tailleTxt} c'est en moyenne 5 h par semaine récupérées.\n\nEssai gratuit 14 jours, sans carte bancaire : https://mailone.app\n\nBonne journée,\n[VOTRE PRÉNOM]`,
    },
    sms: `Bonjour, [PRÉNOM] de MailOne. On aide les ${m}s${ou} à répondre à leurs mails clients en 30 sec (tri auto + réponse prête). Essai gratuit 14 j : mailone.app — Intéressé ?`,
    linkedin: `Bonjour [PRÉNOM],\n\nJe vois que vous êtes ${m}${ou} — je travaille justement avec des artisans qui perdaient leurs soirées dans les mails clients.\n\nMailOne trie la boîte, repère les urgences et rédige les réponses (vous gardez la main sur l'envoi). Ça vous parle ? Je vous montre en 10 min, sans engagement.`,
  };
}

router.post('/prospect', requireAuth, requireAdmin, (req, res) => {
  res.json({ drafts: localProspectDrafts(req.body || {}), engine: 'local', note: 'Brouillons uniquement — aucun envoi automatique.' });
});

// ── 2.3 AGENT VEILLE / RELANCE COMMERCIALE ───────────────────
const STATUTS = ['a_contacter', 'contacte', 'relance', 'repondu', 'client', 'perdu'];

// Règles partagées avec l'agent CLI : J+3 (contact), J+7 (relance), J+15 (répondu)
function withSuggestion(p) {
  const ref  = p.last_action_at || p.created_at;
  const next = nextRelance(p.statut, ref);
  return {
    ...p,
    next_action_at: next ? next.toISOString() : null,
    relance_due:    relanceDue(p.statut, ref),
  };
}

router.get('/prospects', requireAuth, requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('prospects')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Suivi indisponible : ' + error.message });
  res.json({ prospects: (data || []).map(withSuggestion) });
});

router.post('/prospects', requireAuth, requireAdmin, async (req, res) => {
  const { name, metier, ville, canal, notes } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Le nom est requis.' });
  const { data, error } = await supabase.from('prospects').insert({
    user_id: req.user.id,
    name:   String(name).trim().slice(0, 80),
    metier: String(metier || '').slice(0, 60) || null,
    ville:  String(ville  || '').slice(0, 60) || null,
    canal:  String(canal  || 'email').slice(0, 20),
    notes:  String(notes  || '').slice(0, 400) || null,
    statut: 'a_contacter',
  }).select('*').single();
  if (error) return res.status(500).json({ error: 'Enregistrement impossible : ' + error.message });
  res.json({ prospect: withSuggestion(data) });
});

router.patch('/prospects/:id', requireAuth, requireAdmin, async (req, res) => {
  const patch = {};
  if (req.body?.statut && STATUTS.includes(req.body.statut)) {
    patch.statut = req.body.statut;
    patch.last_action_at = new Date().toISOString();
  }
  if (typeof req.body?.notes === 'string') patch.notes = req.body.notes.slice(0, 400);
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Rien à modifier.' });

  const { data, error } = await supabase.from('prospects').update(patch)
    .eq('id', req.params.id).eq('user_id', req.user.id).select('*').single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ prospect: withSuggestion(data) });
});

router.delete('/prospects/:id', requireAuth, requireAdmin, async (req, res) => {
  const { error } = await supabase.from('prospects').delete()
    .eq('id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
