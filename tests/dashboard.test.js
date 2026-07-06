'use strict';

// ── Env minimale pour les tests ──────────────────────────────
process.env.NODE_ENV               = 'test';
process.env.JWT_SECRET             = 'test-jwt-secret-for-ci';
process.env.SUPABASE_URL           = 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-key';
process.env.ENCRYPTION_KEY         = '0000000000000000000000000000000000000000000000000000000000000000';

// ── Mocks ─────────────────────────────────────────────────────
jest.mock('../lib/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 'user-test-123', email: 'test@example.com', first_name: 'Karl', last_name: 'User', is_active: true };
    next();
  },
  requireSubscription: (_req, _res, next) => { next(); },
  generateToken: jest.fn(() => 'fake-jwt-token'),
}));

jest.mock('../lib/supabase', () => ({ from: jest.fn() }));

jest.mock('../lib/security', () => ({
  encrypt: jest.fn(v => `enc:${v}`),
  decrypt: jest.fn(v => String(v).replace('enc:', '')),
}));

// mailbox mocké, mais en gardant la vraie classe MailboxError (instanceof)
jest.mock('../lib/mailbox', () => {
  const actual = jest.requireActual('../lib/mailbox');
  return {
    MailboxError:           actual.MailboxError,
    syncUserEmails:         jest.fn(),
    getUserMailSource:      jest.fn(),
    fetchImapMessageByUid:  jest.fn(),
    fetchImapEmails:        jest.fn(),
  };
});

const request  = require('supertest');
const app      = require('../server');
const supabase = require('../lib/supabase');
const { MailboxError, syncUserEmails } = require('../lib/mailbox');

function mockQuery(data, error = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq:     jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    upsert: jest.fn().mockResolvedValue({ data, error }),
    single: jest.fn().mockResolvedValue({ data, error }),
    then:   jest.fn((resolve) => resolve({ data, error })),
  };
}

const MAILS = [
  { id: 101, sender: 'Marie Durand', senderEmail: 'marie@client.fr', subject: 'URGENT fuite d\'eau cuisine', date: '2026-07-01T08:00:00.000Z', body: 'Bonjour, fuite urgente sous l\'évier, il y a de l\'eau partout !' },
  { id: 102, sender: 'Paul Martin',  senderEmail: 'paul@client.fr',  subject: 'Demande de devis salle de bain', date: '2026-07-01T09:00:00.000Z', body: 'Pouvez-vous me faire un devis pour refaire la salle de bain ? Quel serait le prix ?' },
  { id: 103, sender: 'Sophie Petit', senderEmail: 'sophie@client.fr', subject: 'Facture intervention juin', date: '2026-07-01T10:00:00.000Z', body: 'Merci de m\'envoyer votre IBAN pour le règlement de la facture.' },
];

describe('GET /api/dashboard', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('classe les mails en urgent/triés avec un draft IA sur les urgents', async () => {
    syncUserEmails.mockResolvedValue({ emails: MAILS, source: 'imap' });
    supabase.from.mockImplementation(() => mockQuery([]));

    const res = await request(app).get('/api/dashboard').expect(200);

    expect(res.body.user).toEqual({ firstName: 'Karl' });
    expect(res.body.urgentCount).toBe(1);
    expect(res.body.urgent[0]).toMatchObject({ id: 101, from: 'Marie Durand', fromEmail: 'marie@client.fr' });
    expect(res.body.urgent[0].aiDraft).toMatch(/Bonjour Marie/);
    expect(res.body.urgent[0].aiDraft).toMatch(/urgence/i);

    const categories = res.body.sorted.map(m => m.category);
    expect(categories).toContain('quote');
    expect(categories).toContain('invoice');
    expect(res.body.sorted.every(m => m.body === undefined)).toBe(true); // pas de corps dans les triés
  });

  it('exclut des urgents un mail déjà traité (mail_status)', async () => {
    syncUserEmails.mockResolvedValue({ emails: MAILS, source: 'imap' });
    supabase.from.mockImplementation(() => mockQuery([{ mail_id: '101', status: 'handled' }]));

    const res = await request(app).get('/api/dashboard').expect(200);

    expect(res.body.urgentCount).toBe(0);
    const handled = res.body.sorted.find(m => m.id === 101);
    expect(handled).toBeDefined();
    expect(handled.status).toBe('handled');
  });

  it('retourne 404 + NO_ACCOUNT si aucun compte configuré', async () => {
    syncUserEmails.mockRejectedValue(new MailboxError('Aucun compte email configuré.', 'NO_ACCOUNT', 404));

    const res = await request(app).get('/api/dashboard').expect(404);
    expect(res.body.code).toBe('NO_ACCOUNT');
  });

  it('retourne 401 + OAUTH_EXPIRED si la session OAuth est expirée', async () => {
    syncUserEmails.mockRejectedValue(new MailboxError('Session OAuth expirée.', 'OAUTH_EXPIRED', 401));

    const res = await request(app).get('/api/dashboard').expect(401);
    expect(res.body.code).toBe('OAUTH_EXPIRED');
  });
});
