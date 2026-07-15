// ══════════════════════════════════════════════════════════════
// MAILONE — Carnet clients : extraction de coordonnées
// On n'enregistre QUE les coordonnées (nom, email, téléphone,
// adresse) — jamais le contenu des emails (règle produit n°1).
// ══════════════════════════════════════════════════════════════
const supabase = require('./supabase');

// Téléphone français : 06 12 34 56 78 / +33 6 12 34 56 78 / 01.23.45.67.89
const PHONE_RE = /(?:\+33\s?[1-9]|0[1-9])(?:[\s.-]?\d{2}){4}\b/;

// Adresse française : « 12 rue de la Paix, 75002 Paris » (best effort)
const ADDRESS_RE = /\b\d{1,4}\s?(?:bis|ter)?[,\s]+(?:rue|avenue|av\.?|boulevard|bd\.?|chemin|impasse|allée|allee|place|route|quai|cours|square)\s+[a-zA-Zàâäéèêëîïôöùûüç'’ -]{3,60}(?:[,\s]+\d{5}\s+[a-zA-Zàâäéèêëîïôöùûüç' -]{2,40})?/i;

function normalizePhone(raw) {
  if (!raw) return null;
  let p = raw.replace(/[\s.-]/g, '');
  if (p.startsWith('+33')) p = '0' + p.slice(3);
  return /^0[1-9]\d{8}$/.test(p) ? p : null;
}

// Extrait les coordonnées d'un mail synchronisé ({sender, senderEmail, body})
function extractContact(mail) {
  const email = String(mail.senderEmail || '').toLowerCase().trim();
  if (!email || !email.includes('@')) return null;

  // Les expéditeurs « machine » ne sont pas des clients
  if (/no[.-]?reply|noreply|newsletter|notification|mailer|donotreply|ne-pas-repondre/i.test(email)) return null;

  const body    = String(mail.body || '');
  const phone   = normalizePhone((body.match(PHONE_RE) || [])[0]);
  const addr    = (body.match(ADDRESS_RE) || [])[0] || null;
  const name    = String(mail.sender || '').replace(/["<>]/g, '').trim().slice(0, 80) || null;

  return {
    email,
    name,
    phone,
    address: addr ? addr.replace(/\s+/g, ' ').trim().slice(0, 160) : null,
  };
}

// Upsert en base — dédoublonnage par (user_id, email).
// Ne remplit que les champs découverts (ne jamais écraser par du vide).
async function upsertContactsFromMails(userId, mails) {
  const seen = new Map();
  for (const m of mails || []) {
    const c = extractContact(m);
    if (!c) continue;
    const prev = seen.get(c.email) || {};
    seen.set(c.email, {
      email:   c.email,
      name:    c.name    || prev.name    || null,
      phone:   c.phone   || prev.phone   || null,
      address: c.address || prev.address || null,
    });
  }
  if (!seen.size) return;

  const now = new Date().toISOString();
  for (const c of seen.values()) {
    const { data: existing } = await supabase
      .from('contacts').select('id, name, phone, address')
      .eq('user_id', userId).eq('email', c.email).single();

    if (existing) {
      const patch = { last_seen: now };
      if (!existing.name    && c.name)    patch.name    = c.name;
      if (!existing.phone   && c.phone)   patch.phone   = c.phone;
      if (!existing.address && c.address) patch.address = c.address;
      await supabase.from('contacts').update(patch).eq('id', existing.id);
    } else {
      const { error } = await supabase.from('contacts').insert({
        user_id: userId, email: c.email, name: c.name, phone: c.phone,
        address: c.address, first_seen: now, last_seen: now,
      });
      if (error) throw new Error(error.message);
    }
  }
}

module.exports = { extractContact, normalizePhone, upsertContactsFromMails };
