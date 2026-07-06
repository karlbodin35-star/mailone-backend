// ══════════════════════════════════════════════════════════════
// MAILONE — Agent local (analyse + génération de réponse)
// Extrait de routes/ai.js pour être réutilisé par /api/dashboard
// ══════════════════════════════════════════════════════════════

function normalize(str) {
  return (str || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function extractFirstName(sender) {
  if (!sender) return null;
  const nameMatch = sender.match(/^([^<@\n]+?)(?:\s*<|\s*@|$)/);
  if (!nameMatch) return null;
  const parts = nameMatch[1].trim().split(/\s+/);
  const first = parts[0];
  if (!first || first.length < 2) return null;
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

function extractAmounts(text) {
  return (text.match(/\d[\d\s]*(?:[,.]\d+)?\s*(?:€|euros?)/gi) || []).map(m => m.trim());
}

function extractDates(text) {
  const results = [];
  const patterns = [
    /(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+\d{1,2}(?:\s+\w+)?/gi,
    /\d{1,2}\s+(?:janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)/gi,
    /\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?/g,
  ];
  for (const p of patterns) {
    const found = normalize(text).match(p) || [];
    results.push(...found);
  }
  return results;
}

// ── GÉNÉRATION DE RÉPONSE ────────────────────────────────────
function localGenerateReply(mailContent, sender, subject, mailCategory) {
  const firstName = extractFirstName(sender);
  const salut     = firstName ? `Bonjour ${firstName},` : 'Bonjour,';
  const amounts   = extractAmounts((mailContent || '') + ' ' + (subject || ''));
  const dates     = extractDates((mailContent || '') + ' ' + (subject || ''));
  const sign      = '\n\nCordialement,';

  const cleanSubject = (subject || '')
    .replace(/^(re:|fwd:|tr:|aw:|devis|demande de)\s*/i, '')
    .trim();

  const templates = {
    urgent: `${salut}\n\nJ'ai bien pris connaissance de votre message et mesure l'urgence de la situation. Je me mobilise immédiatement.\n\nPourriez-vous me confirmer votre adresse exacte et vos disponibilités ? Je reviens vers vous dans les plus brefs délais.${sign}`,

    quote: `${salut}\n\nJe vous remercie pour votre demande${cleanSubject ? ` concernant "${cleanSubject}"` : ''}. Afin de vous établir un devis précis et adapté, je souhaiterais convenir d'une visite technique.\n\nSeriez-vous disponible cette semaine ou la semaine prochaine ? Je m'adapte à vos contraintes.${sign}`,

    appt: `${salut}\n\n${dates.length > 0
      ? `Je confirme notre rendez-vous du ${dates[0]}. Ce créneau me convient parfaitement.`
      : 'Je prends note de votre demande de rendez-vous et suis disponible pour convenir d\'un créneau.'
    }\n\nPourriez-vous me confirmer votre adresse exacte et un numéro de téléphone pour vous prévenir si besoin ?${sign}`,

    invoice: `${salut}\n\nSuite à notre intervention${amounts.length > 0 ? ` d'un montant de ${amounts[0]}` : ''}, vous trouverez ci-dessous mes coordonnées bancaires :\n\nIBAN : [VOTRE IBAN]\nBIC : [VOTRE BIC]\nLibellé : [RÉFÉRENCE]\n\nN'hésitez pas à me contacter pour toute question.${sign}`,
  };

  const reply = templates[mailCategory] || templates.quote;
  // Confiance élevée pour les catégories connues, basse sinon
  const confident = !!templates[mailCategory];
  return { reply, confident };
}

// ── ANALYSE EMAIL ────────────────────────────────────────────
function localAnalyze(mailContent, subject) {
  const text = normalize((subject || '') + ' ' + (mailContent || ''));

  const scores = {
    urgent:  ['urgent', 'urgence', 'immediatement', 'vite', 'panne', 'fuite', 'casse', 'asap', 'sos'].filter(w => text.includes(w)).length,
    quote:   ['devis', 'tarif', 'prix', 'combien', 'estimation', 'cout', 'budget', 'offre'].filter(w => text.includes(w)).length,
    appt:    ['rendez-vous', 'rdv', 'disponible', 'creneau', 'planning', 'agenda', 'quand', 'horaire'].filter(w => text.includes(w)).length,
    invoice: ['facture', 'paiement', 'reglement', 'virement', 'iban', 'bic', 'solde', 'regle'].filter(w => text.includes(w)).length,
  };

  let category = 'quote';
  let maxScore = 0;
  for (const [cat, s] of Object.entries(scores)) {
    if (s > maxScore) { maxScore = s; category = cat; }
  }

  const priority  = category === 'urgent' ? 'critical' : scores.urgent > 0 ? 'high' : 'medium';
  const urgency   = category === 'urgent' ? 'immediate' : category === 'appt' ? '48h' : 'week';
  const hasFollow = text.includes('relance') || text.includes('suite a') || text.includes('toujours pas');
  const summary   = (subject || mailContent || '').slice(0, 80).trim();

  return { category, priority, summary, urgency, sentiment: scores.urgent > 0 ? 'negative' : 'neutral', hasFollowUp: hasFollow, hasCompetitor: false, amount: null };
}

module.exports = { normalize, extractFirstName, extractAmounts, extractDates, localGenerateReply, localAnalyze };
