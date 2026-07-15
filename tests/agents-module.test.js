'use strict';

// Tests du module /agents — zéro IA, zéro réseau
const fs = require('fs');

const { fillTemplate }  = require('../agents/lib/fill');
const { nextRelance, relanceDue, delayForStatut } = require('../agents/lib/relanceRules');
const { renderSVG, wrap } = require('../agents/templates/visuals');
const BANK  = require('../agents/data/textes.json');
const PROSP = require('../agents/data/prospection.json');

describe('Remplissage des variables (agents/lib/fill)', () => {
  it('remplace les variables fournies', () => {
    expect(fillTemplate('Un {métier} à {ville}', { 'métier': 'plombier', 'ville': 'Rennes' }))
      .toBe('Un plombier à Rennes');
  });
  it('tire une valeur du pool quand la variable n\'est pas fournie', () => {
    const out = fillTemplate('Un {métier} pressé', {}, () => 0);   // rnd déterministe
    expect(out).toBe('Un plombier pressé');
  });
  it('nettoie proprement une variable vide (prénom absent)', () => {
    expect(fillTemplate('Bonjour {prénom},', {})).toBe('Bonjour,');
  });
});

describe('Règles de relance (agents/lib/relanceRules)', () => {
  const NOW = new Date('2026-07-15T12:00:00Z');
  it('applique J+3 / J+7 / J+15 selon le statut', () => {
    expect(delayForStatut('contacte')).toBe(3);
    expect(delayForStatut('relance')).toBe(7);
    expect(delayForStatut('repondu')).toBe(15);
    expect(delayForStatut('client')).toBeNull();
    expect(delayForStatut('perdu')).toBeNull();
  });
  it('calcule la date de prochaine relance depuis la dernière action', () => {
    const next = nextRelance('contacte', '2026-07-10T12:00:00Z', [3, 7, 15], NOW);
    expect(next.toISOString()).toBe('2026-07-13T12:00:00.000Z');
    expect(relanceDue('contacte', '2026-07-10T12:00:00Z', [3, 7, 15], NOW)).toBe(true);   // J+5 > J+3
    expect(relanceDue('contacte', '2026-07-14T12:00:00Z', [3, 7, 15], NOW)).toBe(false);  // J+1 < J+3
  });
  it('accepte des seuils personnalisés', () => {
    expect(delayForStatut('contacte', [2, 5, 10])).toBe(2);
  });
});

describe('Banques de contenus (agents/data)', () => {
  it('contient 100 textes de posts répartis en 5 catégories', () => {
    const total = Object.values(BANK).reduce((n, arr) => n + arr.length, 0);
    expect(Object.keys(BANK).sort()).toEqual(['avantapres', 'benefice', 'chiffre', 'citation', 'cta']);
    expect(total).toBe(100);
  });
  it('contient 15 templates de prospection par canal', () => {
    expect(PROSP.email).toHaveLength(15);
    expect(PROSP.sms).toHaveLength(15);
    expect(PROSP.linkedin).toHaveLength(15);
    expect(PROSP.relance.length).toBeGreaterThanOrEqual(5);
  });
});

describe('Génération visuelle (agents/templates + sharp)', () => {
  it('découpe le texte en lignes', () => {
    expect(wrap('un texte assez long pour deux lignes', 20).length).toBeGreaterThan(1);
  });
  it('produit un SVG valide pour chaque template et chaque format', () => {
    for (const cat of ['citation', 'chiffre', 'benefice', 'avantapres', 'cta']) {
      for (const size of ['story', 'post']) {
        const svg = renderSVG(cat, size, { visuel: 'Test', sous: 'sous-titre', avant: 'avant', apres: 'après' });
        expect(svg).toContain('<svg');
        expect(svg).toContain('MailOne'.slice(0, 4));   // logo présent
      }
    }
  });
  it('génère un vrai PNG via sharp (signature de fichier vérifiée)', async () => {
    const sharp = require('sharp');
    const svg = renderSVG('chiffre', 'post', { visuel: '30 sec', sous: 'par mail au lieu de 8 minutes' });
    const buf = await sharp(Buffer.from(svg)).png().toBuffer();
    // Signature PNG : 89 50 4E 47
    expect(buf.slice(0, 4).toString('hex')).toBe('89504e47');
    expect(buf.length).toBeGreaterThan(10000);
  }, 30000);
});
