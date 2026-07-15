#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════
// AGENT CONTENU — posts & stories MailOne, zéro IA, zéro token
// Usage :
//   node agents/contenu.js --type story --theme benefice
//   node agents/contenu.js --type post  --theme citation --metier plombier --ville Rennes
//   node agents/contenu.js --batch 10          (mix de thèmes et formats)
// Sortie : output/posts/<nom>.png + <nom>.txt (caption prête à coller)
// ══════════════════════════════════════════════════════════════
const fs    = require('fs');
const path  = require('path');
const sharp = require('sharp');

const { renderSVG }    = require('./templates/visuals');
const { fillTemplate } = require('./lib/fill');
const { nextUnused }   = require('./lib/rotation');

const BANK   = require('./data/textes.json');
const OUTDIR = path.join(__dirname, '..', 'output', 'posts');

const HASHTAGS = {
  instagram: '#artisan #plombier #electricien #TPE #gestion #gaindetemps #IA #devis',
  linkedin:  '#artisanat #TPE #productivité #relationclient',
};

function parseArgs(argv) {
  const args = { type: 'post', theme: null, batch: 0, metier: '', ville: '', platform: 'instagram' };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    if (['type', 'theme', 'metier', 'ville', 'platform'].includes(k)) args[k] = argv[++i];
    else if (k === 'batch') args.batch = parseInt(argv[++i]) || 5;
  }
  return args;
}

const THEME_ALIAS = { benefice: 'benefice', 'bénéfice': 'benefice', citation: 'citation', chiffre: 'chiffre', avantapres: 'avantapres', 'avant-apres': 'avantapres', 'avant-après': 'avantapres', cta: 'cta' };

function generateOne({ type, theme, metier, ville, platform }) {
  const cat = THEME_ALIAS[theme] || theme;
  if (!BANK[cat]) throw new Error(`Thème inconnu : ${theme} (choix : ${Object.keys(BANK).join(', ')})`);

  const item = nextUnused(BANK[cat]);
  const vars = { 'métier': metier, 'ville': ville };
  const fill = t => fillTemplate(t, vars);

  const data = {
    visuel: fill(item.visuel || ''),
    sous:   fill(item.sous   || ''),
    avant:  fill(item.avant  || ''),
    apres:  fill(item.apres  || ''),
  };
  const caption = fill(item.caption) + '\n\n' + (HASHTAGS[platform] || HASHTAGS.instagram);

  const svg  = renderSVG(cat, type, data);
  const name = `${new Date().toISOString().slice(0, 10)}-${item.id}-${type}`;

  fs.mkdirSync(OUTDIR, { recursive: true });
  const pngPath = path.join(OUTDIR, name + '.png');
  const txtPath = path.join(OUTDIR, name + '.txt');

  return sharp(Buffer.from(svg)).png().toFile(pngPath).then(() => {
    fs.writeFileSync(txtPath, caption, 'utf8');
    return { id: item.id, pngPath, txtPath, caption };
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const themes = Object.keys(BANK);
  const jobs = [];

  if (args.batch > 0) {
    for (let i = 0; i < args.batch; i++) {
      jobs.push({ ...args, theme: themes[i % themes.length], type: i % 3 === 0 ? 'story' : 'post' });
    }
  } else {
    jobs.push({ ...args, theme: args.theme || 'benefice' });
  }

  console.log(`\n🎨 Agent Contenu MailOne — ${jobs.length} publication(s), zéro token\n`);
  for (const job of jobs) {
    const r = await generateOne(job);
    console.log(`  ✅ ${path.basename(r.pngPath)}  (+ caption .txt)`);
  }
  console.log(`\n📁 Sortie : ${OUTDIR}\n`);
}

if (require.main === module) main().catch(e => { console.error('❌', e.message); process.exit(1); });
module.exports = { generateOne, parseArgs };
