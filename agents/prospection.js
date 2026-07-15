#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════
// AGENT PROSPECTION — brouillons email/SMS/LinkedIn, zéro IA
// ⚠️ BROUILLONS UNIQUEMENT : cet agent n'envoie jamais rien.
// Usage :
//   node agents/prospection.js                          → tous les prospects Supabase (statut a_contacter)
//   node agents/prospection.js --canal sms              → un canal précis
//   node agents/prospection.js --offline --prenom Marc --metier plombier --ville Rennes
// Sortie : output/prospection/<prospect>-<canal>.txt
// ══════════════════════════════════════════════════════════════
const fs   = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { fillTemplate } = require('./lib/fill');
const { nextUnused }   = require('./lib/rotation');
const BANK   = require('./data/prospection.json');
const OUTDIR = path.join(__dirname, '..', 'output', 'prospection');

function parseArgs(argv) {
  const a = { canal: null, offline: false, prenom: '', metier: '', ville: '', taille: '' };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (k === 'offline') a.offline = true;
    else if (['canal', 'prenom', 'metier', 'ville', 'taille'].includes(k)) a[k] = argv[++i];
  }
  return a;
}

function draftFor(prospect, canal) {
  const items = BANK[canal];
  if (!items) throw new Error(`Canal inconnu : ${canal} (email, sms, linkedin)`);
  const tpl = nextUnused(items);
  const vars = {
    'prénom': prospect.prenom || prospect.name || '',
    'métier': prospect.metier || 'artisan',
    'ville':  prospect.ville  || '',
    'taille': prospect.taille || '',
  };
  const texte = canal === 'email'
    ? `Objet : ${fillTemplate(tpl.objet, vars)}\n\n${fillTemplate(tpl.corps, vars)}`
    : fillTemplate(tpl.texte, vars);
  return { id: tpl.id, texte };
}

async function loadProspects() {
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await sb.from('prospects').select('*').eq('statut', 'a_contacter');
  if (error) throw new Error('Supabase : ' + error.message);
  return data || [];
}

async function main() {
  const args = parseArgs(process.argv);
  const canaux = args.canal ? [args.canal] : ['email', 'sms', 'linkedin'];

  const prospects = args.offline
    ? [{ name: args.prenom || 'prospect', prenom: args.prenom, metier: args.metier, ville: args.ville, taille: args.taille }]
    : await loadProspects();

  if (!prospects.length) { console.log('Aucun prospect « à contacter » dans la table. (--offline pour tester sans base)'); return; }

  fs.mkdirSync(OUTDIR, { recursive: true });
  console.log(`\n✉️  Agent Prospection — ${prospects.length} prospect(s) × ${canaux.length} canal/canaux — BROUILLONS UNIQUEMENT\n`);

  for (const p of prospects) {
    for (const canal of canaux) {
      const d = draftFor(p, canal);
      const slug = String(p.name || 'prospect').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
      const file = path.join(OUTDIR, `${slug}-${canal}-${d.id}.txt`);
      fs.writeFileSync(file, d.texte, 'utf8');
      console.log(`  ✅ ${path.basename(file)}`);
    }
  }
  console.log(`\n📁 Sortie : ${OUTDIR}\n⚠️  Rien n'a été envoyé — copiez-collez les brouillons vous-même.\n`);
}

if (require.main === module) main().catch(e => { console.error('❌', e.message); process.exit(1); });
module.exports = { draftFor, parseArgs };
