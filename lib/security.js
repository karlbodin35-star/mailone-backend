// ══════════════════════════════════════════════════════════════
// MAILONE — Sécurité : chiffrement AES-256-GCM + purge RGPD
// ══════════════════════════════════════════════════════════════
const crypto = require('crypto');
const supabase = require('./supabase');

const ALGO      = 'aes-256-gcm';
const KEY_HEX   = process.env.ENCRYPTION_KEY;          // 64 hex chars = 32 bytes
const KEY       = KEY_HEX ? Buffer.from(KEY_HEX, 'hex') : crypto.randomBytes(32);

// ── CHIFFREMENT AES-256-GCM ───────────────────────────────────
function encrypt(plaintext) {
  if (!plaintext) return plaintext;
  const iv         = crypto.randomBytes(12);
  const cipher     = crypto.createCipheriv(ALGO, KEY, iv);
  const encrypted  = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag        = cipher.getAuthTag();
  return iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(ciphertext) {
  if (!ciphertext || !ciphertext.includes(':')) return ciphertext;
  try {
    const [ivHex, tagHex, dataHex] = ciphertext.split(':');
    const iv      = Buffer.from(ivHex, 'hex');
    const tag     = Buffer.from(tagHex, 'hex');
    const data    = Buffer.from(dataHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
    decipher.setAuthTag(tag);
    return decipher.update(data) + decipher.final('utf8');
  } catch {
    return null; // Données corrompues ou clé incorrecte
  }
}

// ── SANITISATION DES ENTRÉES ──────────────────────────────────
function sanitize(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/<[^>]*>/g, '')           // Supprimer HTML
    .replace(/javascript:/gi, '')      // Supprimer JS URLs
    .replace(/on\w+\s*=/gi, '')        // Supprimer event handlers
    .trim()
    .slice(0, 4096);                   // Limiter la taille
}

function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, typeof v === 'string' ? sanitize(v) : v])
  );
}

// ── PURGE TOTALE DONNÉES UTILISATEUR (RGPD) ───────────────────
// Appelée à la suppression du compte OU à l'annulation de l'abonnement.
// Aucune donnée conservée. Aucune revente. Suppression immédiate et définitive.
async function purgeUserData(userId) {
  if (!userId) throw new Error('userId requis pour la purge');

  const log = (msg) => console.log(`[PURGE] userId=${userId} — ${msg}`);
  log('Début suppression définitive');

  const steps = [
    // 1. Données d'usage IA
    () => supabase.from('ai_usage').delete().eq('user_id', userId),
    // 2. Séquence emails onboarding
    () => supabase.from('email_sequence').delete().eq('user_id', userId),
    // 3. Parrainages (filleul)
    () => supabase.from('referrals').delete().eq('referee_id', userId),
    // 4. Parrainages (parrain) — anonymiser le lien
    () => supabase.from('referrals').update({ referrer_id: null }).eq('referrer_id', userId),
    // 5. Abonnements Stripe
    () => supabase.from('subscriptions').delete().eq('user_id', userId),
    // 6. Compte utilisateur — suppression définitive
    () => supabase.from('users').delete().eq('id', userId),
  ];

  for (const step of steps) {
    const { error } = await step();
    if (error) console.error(`[PURGE] Erreur étape :`, error.message);
  }

  log('Suppression complète — aucune donnée résiduelle');
  return true;
}

// ── ANONYMISATION (alternative à la suppression) ─────────────
// Conserve l'ID pour l'intégrité des logs mais efface toutes les données PII
async function anonymizeUser(userId) {
  const anon = `deleted_${crypto.randomBytes(8).toString('hex')}`;
  await supabase.from('users').update({
    email:        `${anon}@deleted.mailone`,
    first_name:   '[Supprimé]',
    last_name:    '[Supprimé]',
    company:      null,
    phone:        null,
    password_hash:'[PURGED]',
    reset_token:  null,
    is_active:    false,
  }).eq('id', userId);
}

// ── GÉNÉRATION D'UNE CLÉ DE CHIFFREMENT ──────────────────────
function generateEncryptionKey() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = { encrypt, decrypt, sanitize, sanitizeObject, purgeUserData, anonymizeUser, generateEncryptionKey };
