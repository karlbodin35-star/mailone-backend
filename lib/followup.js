// ══════════════════════════════════════════════════════════════
// MAILONE — Suivi des emails sans réponse
// Fonctions pures (testables) : ancienneté d'un mail et niveau
// d'urgence selon un seuil configurable (défaut 3 jours).
// ══════════════════════════════════════════════════════════════

const DEFAULT_THRESHOLD_DAYS = 3;

// Nombre de jours entiers écoulés depuis la réception
function waitingDays(receivedAt, now = new Date()) {
  const d = new Date(receivedAt);
  if (isNaN(d)) return 0;
  return Math.max(0, Math.floor((now - d) / 86400000));
}

// Niveau d'urgence : vert (< seuil), orange (seuil → seuil+2), rouge (au-delà)
function ageBucket(days, threshold = DEFAULT_THRESHOLD_DAYS) {
  if (days < threshold) return 'green';
  if (days < threshold + 3) return 'orange';
  return 'red';
}

// Filtre les mails en attente de réponse depuis au moins `threshold` jours
// (mails sans statut : ni répondus ni ignorés)
function unanswered(mails, threshold = DEFAULT_THRESHOLD_DAYS, now = new Date()) {
  return (mails || [])
    .filter(m => !m.status && waitingDays(m.receivedAt, now) >= threshold)
    .sort((a, b) => new Date(a.receivedAt) - new Date(b.receivedAt)); // plus ancien d'abord
}

module.exports = { DEFAULT_THRESHOLD_DAYS, waitingDays, ageBucket, unanswered };
