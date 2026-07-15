#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════
// AGENT RELANCE COMMERCIALE — règles de dates pures, zéro IA
// Relances suggérées : J+3 (1er contact), J+7 (1re relance), J+15 (suite)
// ⚠️ BROUILLONS UNIQUEMENT : rien n'est envoyé.
// Usage :
//   node agents/relance.js                → tableau + brouillons pour les relances dues
//   node agents/relance.js --seuils 2,5,10
// ══════════════════════════════════════════════════════════════
const fs   = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { nextRelance, relanceDue, DEFAULT_SEUILS } = require('./lib/relanceRules');
const { fillTemplate } = require('./lib/fill');
const BANK   = require('./data/prospection.json');
const OUTDIR = path.join(__dirname, '..', 'output', 'prospection');

function parseArgs(argv) {
  const a = { seuils: DEFAULT_SEUILS };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--seuils') a.seuils = argv[++i].split(',').map(Number).filter(n => n > 0);
  }
  return a;
}

async function main() {
  const { seuils } = parseArgs(process.argv);
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: prospects, error } = await sb.from('prospects').select('*').order('created_at');
  if (error) throw new Error('Supabase : ' + error.message);

  console.log(`\n🔔 Agent Relance — seuils J+${seuils.join(', J+')} — ${new Date().toLocaleDateString('fr-FR')}\n`);
  console.log('  Prospect'.padEnd(22) + 'Statut'.padEnd(14) + 'Dernière action'.padEnd(18) + 'Prochaine relance');
  console.log('  ' + '─'.repeat(70));

  const due = [];
  for (const p of prospects || []) {
    const next = nextRelance(p.statut, p.last_action_at || p.created_at, seuils);
    const isDue = relanceDue(p.statut, p.last_action_at || p.created_at, seuils);
    const last = p.last_action_at ? new Date(p.last_action_at).toLocaleDateString('fr-FR') : '—';
    const nextTxt = next ? (isDue ? '🔔 MAINTENANT' : next.toLocaleDateString('fr-FR')) : '—';
    console.log(`  ${String(p.name).padEnd(20)}${String(p.statut).padEnd(14)}${last.padEnd(18)}${nextTxt}`);
    if (isDue) due.push(p);
  }

  if (!due.length) { console.log('\n✅ Aucune relance due aujourd\'hui.\n'); return; }

  fs.mkdirSync(OUTDIR, { recursive: true });
  console.log(`\n📨 ${due.length} brouillon(s) de relance généré(s) :\n`);
  for (const p of due) {
    const canal = ['email', 'sms', 'linkedin'].includes(p.canal) ? p.canal : 'email';
    const pool  = BANK.relance.filter(t => t.canal === canal);
    const tpl   = pool[Math.floor(Math.random() * pool.length)];
    const vars  = { 'prénom': p.name, 'métier': p.metier || 'artisan', 'ville': p.ville || '' };
    const texte = tpl.objet
      ? `Objet : ${fillTemplate(tpl.objet, vars)}\n\n${fillTemplate(tpl.texte, vars)}`
      : fillTemplate(tpl.texte, vars);
    const slug = String(p.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
    const file = path.join(OUTDIR, `relance-${slug}-${canal}.txt`);
    fs.writeFileSync(file, texte, 'utf8');
    console.log(`  ✅ ${path.basename(file)}`);
  }
  console.log(`\n📁 Sortie : ${OUTDIR}\n⚠️  Rien n'a été envoyé — validez et envoyez vous-même.\n`);
}

if (require.main === module) main().catch(e => { console.error('❌', e.message); process.exit(1); });
module.exports = { parseArgs };
