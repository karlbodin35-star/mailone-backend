// ══════════════════════════════════════════════════════════════
// MAILONE — Agent de traduction GRATUIT
// Moteur : API MyMemory (mymemory.translated.net) — sans clé, sans
// coût. Limite ~500 caractères par requête → on découpe par phrases.
// Le paramètre `de` (email) élargit le quota journalier gratuit.
// ══════════════════════════════════════════════════════════════

const MYMEMORY_URL = 'https://api.mymemory.translated.net/get';

// Détection simple d'un texte en anglais (même heuristique que le front)
function detectEnglish(text) {
  const t = ' ' + String(text || '').toLowerCase().replace(/[^a-zà-ÿ]+/g, ' ') + ' ';
  const en = [' the ', ' and ', ' you ', ' your ', ' for ', ' with ', ' this ', ' that ', ' from ', ' will ', ' have ', ' please ', ' hello ', ' thanks ', ' dear ', ' our ', ' has ', ' ends '];
  const fr = [' le ', ' la ', ' les ', ' des ', ' et ', ' vous ', ' votre ', ' pour ', ' avec ', ' bonjour ', ' merci ', ' dans ', ' est ', ' une ', ' nous ', ' je ', ' pas '];
  const count = a => a.reduce((s, w) => s + (t.split(w).length - 1), 0);
  const e = count(en), f = count(fr);
  return e >= 3 && e > f * 1.5;
}

// Découpe un texte en morceaux ≤ maxLen, de préférence sur les phrases
function chunkText(text, maxLen = 450) {
  const chunks = [];
  let rest = String(text || '').trim();
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf('. ', maxLen);
    if (cut < maxLen * 0.4) cut = rest.lastIndexOf(' ', maxLen);
    if (cut <= 0) cut = maxLen;
    chunks.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

async function translateChunk(chunk, from, to) {
  const params = new URLSearchParams({
    q:        chunk,
    langpair: `${from}|${to}`,
    de:       process.env.EMAIL_SUPPORT || process.env.EMAIL_FROM || 'support@mailone.app',
  });
  const res  = await fetch(`${MYMEMORY_URL}?${params}`);
  if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`);
  const data = await res.json();
  const txt  = data?.responseData?.translatedText;
  if (!txt || data.responseStatus >= 400) {
    throw new Error('MyMemory : ' + (data?.responseDetails || 'réponse invalide'));
  }
  return txt;
}

// Traduit un texte complet (découpé si nécessaire)
async function translate(text, from, to) {
  const clean = String(text || '').trim();
  if (!clean) return '';
  const parts = [];
  for (const chunk of chunkText(clean)) {
    parts.push(await translateChunk(chunk, from, to));
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

module.exports = { detectEnglish, translate, chunkText };
