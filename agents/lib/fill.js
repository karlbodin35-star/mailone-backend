// ══════════════════════════════════════════════════════════════
// AGENTS MAILONE — Remplissage de variables dans les templates
// Code pur, zéro IA. Variables : {métier} {bénéfice} {chiffre}
// {ville} {prénom} {taille} — valeurs fournies ou tirées des pools.
// ══════════════════════════════════════════════════════════════

const POOLS = {
  'métier':   ['plombier', 'électricien', 'chauffagiste', 'maçon', 'menuisier', 'couvreur', 'peintre', 'carreleur', 'serrurier', 'paysagiste'],
  'bénéfice': ['1 h récupérée chaque jour', 'zéro mail oublié', 'des devis répondus dans l\'heure', 'des soirées enfin tranquilles', 'plus aucun client perdu', 'une boîte mail vide chaque soir'],
  'chiffre':  ['30 secondes', '5 h par semaine', '8 minutes', '14 jours', '2 clics', '20 langues'],
  'ville':    ['Rennes', 'Nantes', 'Lyon', 'Bordeaux', 'Toulouse', 'Lille', 'Marseille', 'Angers'],
  'prénom':   [''],
  'taille':   [''],
};

function pick(arr, rnd = Math.random) {
  return arr[Math.floor(rnd() * arr.length)];
}

// Remplace {variable} par la valeur fournie, sinon une valeur du pool.
// Nettoie les tournures orphelines si la variable est vide.
function fillTemplate(text, vars = {}, rnd = Math.random) {
  let out = String(text || '');
  out = out.replace(/\{([^}]+)\}/g, (_, key) => {
    const k = key.trim();
    if (vars[k] !== undefined && vars[k] !== null && String(vars[k]).trim() !== '') return String(vars[k]).trim();
    const pool = POOLS[k];
    if (pool) { const v = pick(pool, rnd); if (v) return v; }
    return '';
  });
  // Espaces doublés / ponctuation orpheline après variable vide
  return out.replace(/ {2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').replace(/\(\s*\)/g, '').trim();
}

// Majuscule initiale (après remplissage en début de phrase)
function capitalize(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

module.exports = { fillTemplate, capitalize, POOLS, pick };
