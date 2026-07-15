'use strict';

// Tests unitaires purs : extraction de coordonnées + détection sans réponse
jest.mock('../lib/supabase', () => ({ from: jest.fn() }));

const { extractContact, normalizePhone } = require('../lib/contacts');
const { waitingDays, ageBucket, unanswered, DEFAULT_THRESHOLD_DAYS } = require('../lib/followup');

describe('Extraction de contacts (lib/contacts)', () => {
  it('extrait nom, email, téléphone et adresse d\'un mail', () => {
    const c = extractContact({
      sender: 'Marie Durand',
      senderEmail: 'Marie.Durand@Gmail.com',
      body: 'Bonjour, pouvez-vous passer au 12 rue de la Paix, 35000 Rennes ? Mon numéro : 06 12 34 56 78. Merci !',
    });
    expect(c).toMatchObject({ name: 'Marie Durand', email: 'marie.durand@gmail.com', phone: '0612345678' });
    expect(c.address).toMatch(/12 rue de la Paix/i);
    expect(c.address).toMatch(/35000/);
  });

  it('normalise les téléphones français (+33, points, espaces)', () => {
    expect(normalizePhone('+33 6 12 34 56 78')).toBe('0612345678');
    expect(normalizePhone('01.23.45.67.89')).toBe('0123456789');
    expect(normalizePhone('12345')).toBeNull();
  });

  it('ignore les expéditeurs machine (noreply, newsletters)', () => {
    expect(extractContact({ sender: 'Trello', senderEmail: 'noreply@trello.com', body: 'x' })).toBeNull();
    expect(extractContact({ sender: 'News', senderEmail: 'newsletter@shop.fr', body: 'x' })).toBeNull();
  });

  it('ne retourne rien sans email exploitable', () => {
    expect(extractContact({ sender: 'X', senderEmail: '', body: 'tel 06 12 34 56 78' })).toBeNull();
  });
});

describe('Détection des mails sans réponse (lib/followup)', () => {
  const NOW = new Date('2026-07-15T12:00:00Z');
  const mail = (daysAgo, status = null) => ({
    id: `m${daysAgo}`, status,
    receivedAt: new Date(NOW - daysAgo * 86400000).toISOString(),
  });

  it('calcule l\'ancienneté en jours entiers', () => {
    expect(waitingDays(mail(0).receivedAt, NOW)).toBe(0);
    expect(waitingDays(mail(3).receivedAt, NOW)).toBe(3);
    expect(waitingDays('date-invalide', NOW)).toBe(0);
  });

  it('bucket vert / orange / rouge selon le seuil (défaut 3 jours)', () => {
    expect(DEFAULT_THRESHOLD_DAYS).toBe(3);
    expect(ageBucket(1)).toBe('green');
    expect(ageBucket(3)).toBe('orange');
    expect(ageBucket(5)).toBe('orange');
    expect(ageBucket(6)).toBe('red');
    expect(ageBucket(3, 5)).toBe('green');   // seuil configurable
    expect(ageBucket(5, 5)).toBe('orange');
  });

  it('liste les mails sans réponse au-delà du seuil, plus anciens d\'abord', () => {
    const mails = [mail(1), mail(5), mail(10), mail(7, 'handled'), mail(4, 'dismissed')];
    const res = unanswered(mails, 3, NOW);
    expect(res.map(m => m.id)).toEqual(['m10', 'm5']);   // traités/ignorés exclus, tri ancien → récent
  });
});
