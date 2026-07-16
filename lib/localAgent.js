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
  const raw       = `${subject || ''}\n${mailContent || ''}`;

  // ── Intentions spécifiques : on répond à CE QUE demande le client ──

  // 1. Le client attend des documents / éléments de notre part
  const askSend = /(?:je n['']ai (?:pas|toujours pas) re[çc]u|pas encore re[çc]u|toujours pas re[çc]u|dans l['']attente de|pouvez[- ]vous m['']?(?:envoyer|transmettre|faire parvenir)|pourriez[- ]vous m['']?(?:envoyer|transmettre|faire parvenir)|merci de (?:me |m['']?)?(?:envoyer|transmettre|renvoyer|faire parvenir)|quand (?:pensez|comptez|pouvez)[- ]vous (?:pouvoir )?(?:m['']?)?envoyer)/i;
  if (askSend.test(raw)) {
    const whatM = raw.match(/\b(?:les?|la|vos?|ces?|mes?)\s+(?:[éeè]l[ée]ments?|documents?|pi[èe]ces?(?:\s+jointes?)?|photos?|plans?|devis|factures?|rib|attestations?|coordonn[ée]es|informations?)(?:\s+(?:[ée]voqu|mentionn|demand|convenu|promis)[a-zà-ÿ]*)?/i);
    const what  = whatM ? whatM[0].trim().replace(/\s+/g, ' ') : 'les éléments demandés';
    return {
      reply: `${salut}\n\nVous avez tout à fait raison, et je vous prie de m'excuser pour ce délai : ${what} ne vous sont pas encore parvenus.\n\nJe vous les transmets d'ici la fin de journée. Si un point manque à l'appel une fois reçus, dites-le moi et je complète aussitôt.${sign}`,
      confident: true,
    };
  }

  // 2. Simple remerciement / confirmation → accusé bref, pas de tunnel commercial
  const isThanks = /^(?:merci|bien re[çc]u|c['']est not[ée]|parfait|ok pour|entendu|tr[èe]s bien)/i.test((mailContent || '').trim())
                || (/(merci (?:beaucoup|infiniment)|bien re[çc]u|c['']est parfait)/i.test(raw) && (mailContent || '').length < 220);
  if (isThanks) {
    return {
      reply: `${salut}\n\nMerci pour votre retour — c'est bien noté de mon côté.\n\nJe reste à votre disposition si besoin.${sign}`,
      confident: true,
    };
  }

  const cleanSubject = (subject || '')
    .replace(/^(re:|fwd:|tr:|aw:|devis|demande de)\s*/i, '')
    .replace(/^\(sans objet\)$/i, '')
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

  // 3. Catégorie « devis » par défaut SANS vrai signal devis :
  //    → si une question est posée, on la reprend telle quelle ;
  //    → sinon, accusé de réception neutre — jamais de tunnel commercial hors sujet.
  const hasQuoteWords = /devis|tarif|prix|estimation|budget|combien|co[ûu]t/i.test(raw);
  if (mailCategory === 'quote' && !hasQuoteWords) {
    const questions = raw.match(/[^.?!\n]{10,160}\?/g);
    if (questions && questions.length) {
      const q = questions[questions.length - 1].trim().replace(/\s+/g, ' ');
      return {
        reply: `${salut}\n\nMerci pour votre message. Concernant votre question — « ${q} » — je vous apporte une réponse précise d'ici la fin de journée.\n\nS'il y a une urgence entre-temps, n'hésitez pas à me joindre directement par téléphone.${sign}`,
        confident: true,
      };
    }
    return {
      reply: `${salut}\n\nMerci pour votre message, je l'ai bien reçu.\n\nJe le regarde attentivement et je reviens vers vous rapidement.${sign}`,
      confident: false,   // signal faible → l'IA premium prendra le relais quand disponible
    };
  }

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
