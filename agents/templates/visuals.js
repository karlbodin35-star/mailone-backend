// ══════════════════════════════════════════════════════════════
// AGENTS MAILONE — Templates visuels SVG (DA du site)
// Palette extraite de da.css / dashboard.html :
//   fond #07090F · surface glass rgba(255,255,255,.04) · bordure .08
//   accent #5B8CFF → violet #9F7BFF · ok #3DD68C · urgent #FF5C5C
//   orbes #1E3A8A / #4C1D95 flous · grille rgba(255,255,255,.025)
// Fontes : Space Grotesk (titres) / DM Sans (texte) avec repli Arial.
// ══════════════════════════════════════════════════════════════

const FONT_TITLE = "'Space Grotesk', 'Segoe UI', Arial, sans-serif";
const FONT_BODY  = "'DM Sans', 'Segoe UI', Arial, sans-serif";

function escXml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
}

// Découpe un texte en lignes ≤ maxChars (sur les espaces)
function wrap(text, maxChars) {
  const words = String(text || '').split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > maxChars && line) { lines.push(line); line = w; }
    else line = (line + ' ' + w).trim();
  }
  if (line) lines.push(line);
  return lines;
}

function tspans(lines, x, startY, lineHeight) {
  return lines.map((l, i) => `<tspan x="${x}" y="${startY + i * lineHeight}">${escXml(l)}</tspan>`).join('');
}

// Décor commun : fond nuit, orbes flous, grille, logo, pied de page
function shell(W, H, inner) {
  const grid = [];
  for (let x = 0; x <= W; x += 90) grid.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}"/>`);
  for (let y = 0; y <= H; y += 90) grid.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}"/>`);
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#5B8CFF"/><stop offset="1" stop-color="#9F7BFF"/>
    </linearGradient>
    <filter id="blur90" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="90"/></filter>
    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="18"/></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="#07090F"/>
  <circle cx="${W * 0.02}" cy="${H * 0.05}" r="${W * 0.42}" fill="#1E3A8A" opacity="0.38" filter="url(#blur90)"/>
  <circle cx="${W * 0.98}" cy="${H * 0.97}" r="${W * 0.38}" fill="#4C1D95" opacity="0.35" filter="url(#blur90)"/>
  <g stroke="rgba(255,255,255,0.025)" stroke-width="1">${grid.join('')}</g>
  ${inner}
  <text x="${W / 2}" text-anchor="middle" y="${H - 64}" font-family="${FONT_TITLE}" font-weight="700" font-size="44" fill="#FFFFFF">Mail<tspan fill="url(#accent)">One</tspan></text>
  <text x="${W / 2}" text-anchor="middle" y="${H - 24}" font-family="${FONT_BODY}" font-size="24" fill="#8B93A5">mailone.app — essai gratuit 14 jours</text>
</svg>`;
}

function glassRect(x, y, w, h, r = 28) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"
    fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)" stroke-width="2"/>`;
}

// ── Template 1 : CITATION ────────────────────────────────────
function citation(W, H, d) {
  const lines = wrap(d.visuel, W > H ? 34 : 24);
  const fs = lines.length > 4 ? 56 : 66;
  const lh = fs * 1.35;
  const blockH = lines.length * lh + 160;
  const y0 = (H - blockH) / 2;
  return shell(W, H, `
    ${glassRect(70, y0, W - 140, blockH)}
    <text x="120" y="${y0 + 110}" font-family="${FONT_TITLE}" font-weight="700" font-size="120" fill="url(#accent)">“</text>
    <text font-family="${FONT_TITLE}" font-weight="600" font-size="${fs}" fill="#EDF0F5">${tspans(lines, 120, y0 + 190, lh)}</text>
    <rect x="120" y="${y0 + blockH - 46}" width="120" height="6" rx="3" fill="url(#accent)"/>`);
}

// ── Template 2 : CHIFFRE CLÉ ─────────────────────────────────
function chiffre(W, H, d) {
  const cy = H / 2;
  const subLines = wrap(d.sous || '', 30);
  return shell(W, H, `
    <circle cx="${W / 2}" cy="${cy - 60}" r="180" fill="#5B8CFF" opacity="0.28" filter="url(#glow)"/>
    <text x="${W / 2}" text-anchor="middle" y="${cy - 10}" font-family="${FONT_TITLE}" font-weight="700" font-size="190" fill="url(#accent)">${escXml(d.visuel)}</text>
    <text text-anchor="middle" font-family="${FONT_BODY}" font-size="52" fill="#EDF0F5">${tspans(subLines, W / 2, cy + 110, 66)}</text>`);
}

// ── Template 3 : BÉNÉFICE PRODUIT ────────────────────────────
function benefice(W, H, d) {
  const lines = wrap(d.visuel, W > H ? 30 : 22);
  const fs = 62, lh = fs * 1.3;
  const y0 = H / 2 - (lines.length * lh) / 2 - 60;
  return shell(W, H, `
    <rect x="${W / 2 - 210}" y="${y0 - 130}" width="420" height="64" rx="32" fill="rgba(91,140,255,0.15)" stroke="rgba(91,140,255,0.4)" stroke-width="2"/>
    <text x="${W / 2}" text-anchor="middle" y="${y0 - 86}" font-family="${FONT_TITLE}" font-weight="700" font-size="26" letter-spacing="4" fill="#5B8CFF">CE QUE ÇA CHANGE</text>
    <text text-anchor="middle" font-family="${FONT_TITLE}" font-weight="700" font-size="${fs}" fill="#EDF0F5">${tspans(lines, W / 2, y0, lh)}</text>
    <text x="${W / 2}" text-anchor="middle" y="${y0 + lines.length * lh + 60}" font-family="${FONT_BODY}" font-size="40" fill="#3DD68C">✓ sans rien installer · ✓ rien ne part sans vous</text>`);
}

// ── Template 4 : AVANT / APRÈS ───────────────────────────────
function avantapres(W, H, d) {
  const boxW = W - 160;
  const avLines = wrap(d.avant, 30), apLines = wrap(d.apres, 30);
  const fs = 46, lh = fs * 1.3;
  const h1 = avLines.length * lh + 150, h2 = apLines.length * lh + 150;
  const gap = 70;
  const y0 = (H - (h1 + h2 + gap)) / 2;
  return shell(W, H, `
    <rect x="80" y="${y0}" width="${boxW}" height="${h1}" rx="28" fill="rgba(255,92,92,0.07)" stroke="rgba(255,92,92,0.35)" stroke-width="2"/>
    <text x="130" y="${y0 + 78}" font-family="${FONT_TITLE}" font-weight="700" font-size="30" letter-spacing="4" fill="#FF5C5C">AVANT</text>
    <text font-family="${FONT_BODY}" font-size="${fs}" fill="#EDF0F5">${tspans(avLines, 130, y0 + 150, lh)}</text>
    <text x="${W / 2}" text-anchor="middle" y="${y0 + h1 + gap / 2 + 16}" font-family="${FONT_TITLE}" font-size="52" fill="url(#accent)">↓</text>
    <rect x="80" y="${y0 + h1 + gap}" width="${boxW}" height="${h2}" rx="28" fill="rgba(61,214,140,0.07)" stroke="rgba(61,214,140,0.4)" stroke-width="2"/>
    <text x="130" y="${y0 + h1 + gap + 78}" font-family="${FONT_TITLE}" font-weight="700" font-size="30" letter-spacing="4" fill="#3DD68C">APRÈS · MAILONE</text>
    <text font-family="${FONT_BODY}" font-size="${fs}" fill="#EDF0F5">${tspans(apLines, 130, y0 + h1 + gap + 150, lh)}</text>`);
}

// ── Template 5 : CTA ─────────────────────────────────────────
function cta(W, H, d) {
  const lines = wrap(d.visuel, W > H ? 26 : 20);
  const fs = 72, lh = fs * 1.25;
  const y0 = H / 2 - (lines.length * lh) / 2 - 80;
  const btnY = y0 + lines.length * lh + 70;
  return shell(W, H, `
    <text text-anchor="middle" font-family="${FONT_TITLE}" font-weight="700" font-size="${fs}" fill="#EDF0F5">${tspans(lines, W / 2, y0, lh)}</text>
    <rect x="${W / 2 - 300}" y="${btnY}" width="600" height="110" rx="26" fill="url(#accent)"/>
    <rect x="${W / 2 - 300}" y="${btnY}" width="600" height="110" rx="26" fill="#5B8CFF" opacity="0.45" filter="url(#glow)"/>
    <text x="${W / 2}" text-anchor="middle" y="${btnY + 70}" font-family="${FONT_TITLE}" font-weight="700" font-size="40" fill="#FFFFFF">Essayer gratuitement →</text>
    ${d.sous ? `<text x="${W / 2}" text-anchor="middle" y="${btnY + 180}" font-family="${FONT_BODY}" font-size="34" fill="#8B93A5">${escXml(d.sous)}</text>` : ''}`);
}

const TEMPLATES = { citation, chiffre, benefice, avantapres, cta };
const SIZES = { story: [1080, 1920], post: [1080, 1080] };

function renderSVG(category, size, data) {
  const fn = TEMPLATES[category];
  if (!fn) throw new Error(`Template inconnu : ${category} (choix : ${Object.keys(TEMPLATES).join(', ')})`);
  const [W, H] = SIZES[size] || SIZES.post;
  return fn(W, H, data);
}

module.exports = { renderSVG, TEMPLATES, SIZES, wrap };
