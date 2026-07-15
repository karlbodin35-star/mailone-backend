// ══════════════════════════════════════════════════════════════
// AGENTS MAILONE — Règles de relance commerciale (dates pures)
// J+3 après le 1er contact, J+7 après la 1re relance, J+15 ensuite.
// Seuils configurables. Zéro IA, zéro appel réseau.
// ══════════════════════════════════════════════════════════════

const DEFAULT_SEUILS = [3, 7, 15];

// Combien de jours attendre selon l'avancement du prospect
function delayForStatut(statut, seuils = DEFAULT_SEUILS) {
  switch (statut) {
    case 'a_contacter': return 0;            // à contacter tout de suite
    case 'contacte':    return seuils[0];    // J+3 après le premier contact
    case 'relance':     return seuils[1];    // J+7 après une relance
    case 'repondu':     return seuils[2];    // J+15 pour entretenir la relation
    default:            return null;         // client / perdu : plus de relance
  }
}

// Date de la prochaine relance suggérée (null si terminé)
function nextRelance(statut, lastActionAt, seuils = DEFAULT_SEUILS, now = new Date()) {
  const delay = delayForStatut(statut, seuils);
  if (delay === null) return null;
  const base = lastActionAt ? new Date(lastActionAt) : now;
  if (isNaN(base)) return null;
  return new Date(base.getTime() + delay * 86400000);
}

function relanceDue(statut, lastActionAt, seuils = DEFAULT_SEUILS, now = new Date()) {
  const next = nextRelance(statut, lastActionAt, seuils, now);
  return !!next && next <= now;
}

module.exports = { DEFAULT_SEUILS, delayForStatut, nextRelance, relanceDue };
