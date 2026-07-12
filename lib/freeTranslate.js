// ══════════════════════════════════════════════════════════════
// MAILONE — Agent de traduction GRATUIT
// Moteur : API MyMemory (mymemory.translated.net) — sans clé, sans
// coût. Limite ~500 caractères par requête → on découpe par phrases.
// Le paramètre `de` (email) élargit le quota journalier gratuit.
// ══════════════════════════════════════════════════════════════

const LanguageDetect = require('languagedetect');
const detector = new LanguageDetect();

const MYMEMORY_URL = 'https://api.mymemory.translated.net/get';

// Les 20 langues prises en charge (promesse produit « 20 langues »)
const SUPPORTED = {
  english: 'en', spanish: 'es', german: 'de', italian: 'it', portuguese: 'pt',
  dutch: 'nl', polish: 'pl', romanian: 'ro', russian: 'ru', turkish: 'tr',
  swedish: 'sv', danish: 'da', norwegian: 'no', czech: 'cs', hungarian: 'hu',
  greek: 'el', arabic: 'ar', chinese: 'zh', japanese: 'ja',
};
const LANG_NAMES_FR = {
  en: 'anglais', es: 'espagnol', de: 'allemand', it: 'italien', pt: 'portugais',
  nl: 'néerlandais', pl: 'polonais', ro: 'roumain', ru: 'russe', tr: 'turc',
  sv: 'suédois', da: 'danois', no: 'norvégien', cs: 'tchèque', hu: 'hongrois',
  el: 'grec', ar: 'arabe', zh: 'chinois', ja: 'japonais', fr: 'français',
};

// Détecte la langue d'un texte → code ISO ('fr' si français ou incertain).
// 1. Écritures non latines (fiable) : arabe, cyrillique, grec, CJK
// 2. Langues latines : analyse statistique par trigrammes
function detectLanguage(text) {
  const t = String(text || '');
  if (!t.trim()) return 'fr';

  const len = t.length;
  const countRe = re => (t.match(re) || []).length;
  if (countRe(/[؀-ۿ]/g) / len > 0.15) return 'ar';
  if (countRe(/[぀-ヿ]/g) / len > 0.05) return 'ja';        // kana → japonais
  if (countRe(/[一-鿿]/g) / len > 0.15) return 'zh';
  if (countRe(/[Ѐ-ӿ]/g) / len > 0.15) return 'ru';
  if (countRe(/[Ͱ-Ͽ]/g) / len > 0.15) return 'el';

  const guesses = detector.detect(t, 3) || [];
  if (!guesses.length) return 'fr';
  const [topName, topScore] = guesses[0];
  if (topName === 'french' || topScore < 0.2) return 'fr';
  return SUPPORTED[topName] || 'fr';
}

// Conservée pour compatibilité
function detectEnglish(text) { return detectLanguage(text) === 'en'; }

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

module.exports = { detectEnglish, detectLanguage, translate, chunkText, LANG_NAMES_FR };
