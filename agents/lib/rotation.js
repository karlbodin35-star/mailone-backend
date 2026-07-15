// ══════════════════════════════════════════════════════════════
// AGENTS MAILONE — Rotation intelligente des textes
// Mémorise les ids déjà utilisés dans agents/data/.used.json pour
// ne jamais reposter le même texte tant qu'il en reste des neufs.
// ══════════════════════════════════════════════════════════════
const fs   = require('fs');
const path = require('path');

const STORE = path.join(__dirname, '..', 'data', '.used.json');

function loadUsed() {
  try { return new Set(JSON.parse(fs.readFileSync(STORE, 'utf8'))); }
  catch { return new Set(); }
}
function saveUsed(set) {
  // Sur Vercel le système de fichiers est en lecture seule : la rotation
  // devient alors un simple tirage aléatoire, sans casser la génération.
  try {
    fs.mkdirSync(path.dirname(STORE), { recursive: true });
    fs.writeFileSync(STORE, JSON.stringify([...set]), 'utf8');
  } catch { /* no-op */ }
}

// Choisit un item non encore utilisé (réinitialise le cycle quand tout
// a été consommé), le marque utilisé, et le renvoie.
function nextUnused(items, rnd = Math.random) {
  const used = loadUsed();
  let fresh = items.filter(it => !used.has(it.id));
  if (!fresh.length) {                     // cycle terminé → on repart
    for (const it of items) used.delete(it.id);
    fresh = items;
  }
  const chosen = fresh[Math.floor(rnd() * fresh.length)];
  used.add(chosen.id);
  saveUsed(used);
  return chosen;
}

module.exports = { nextUnused, loadUsed, STORE };
