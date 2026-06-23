'use strict';

// ── Env minimale pour les tests ──────────────────────────────
process.env.NODE_ENV               = 'test';
process.env.JWT_SECRET             = 'test-jwt-secret-for-ci';
process.env.SUPABASE_URL           = 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-key';
process.env.ENCRYPTION_KEY         = '0000000000000000000000000000000000000000000000000000000000000000';

// ── Mocks ─────────────────────────────────────────────────────

// requireAuth contourné pour les tests : injecte req.user directement
jest.mock('../lib/auth', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: 'user-test-123', email: 'test@example.com', first_name: 'Test', last_name: 'User', is_active: true };
    next();
  },
  requireSubscription: (_req, _res, next) => { next(); },
  generateToken: jest.fn(() => 'fake-jwt-token'),
}));

// Supabase mocké avec chaîne de requête complète
jest.mock('../lib/supabase', () => ({ from: jest.fn() }));

// oauthHelpers mocké
jest.mock('../lib/oauthHelpers', () => ({
  getValidAccessToken:  jest.fn(),
  fetchGmailEmails:     jest.fn(),
  fetchOutlookEmails:   jest.fn(),
}));

// ImapFlow mocké (non utilisé dans les tests OAuth mais nécessaire pour ne pas planter)
jest.mock('imapflow', () => ({
  ImapFlow: jest.fn().mockImplementation(() => ({
    connect:     jest.fn().mockResolvedValue(undefined),
    logout:      jest.fn().mockResolvedValue(undefined),
    mailboxOpen: jest.fn().mockResolvedValue(undefined),
    status:      jest.fn().mockResolvedValue({ messages: 0 }),
    fetch:       jest.fn().mockReturnValue([]),
  })),
}));

// lib/security mocké
jest.mock('../lib/security', () => ({
  encrypt: jest.fn(v => `enc:${v}`),
  decrypt: jest.fn(v => String(v).replace('enc:', '')),
}));

const request  = require('supertest');
const app      = require('../server');
const supabase = require('../lib/supabase');
const { getValidAccessToken, fetchGmailEmails } = require('../lib/oauthHelpers');

// ── Helper : construit une chaîne de requête Supabase mockée ──
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

// ─────────────────────────────────────────────────────────────
describe('GET /api/emails/account', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('retourne {account: null} si ni IMAP ni OAuth configurés', async () => {
    supabase.from.mockImplementation(() => mockQuery(null));
    const res = await request(app).get('/api/emails/account').expect(200);
    expect(res.body).toEqual({ account: null });
  });

  it('retourne le compte IMAP si configuré', async () => {
    const imapData = { id: 1, host: 'imap.gmail.com', name: 'test@gmail.com', port: 993, tls: true, created_at: '2024-01-01T00:00:00Z', last_sync: null };
    supabase.from.mockImplementation((table) => {
      if (table === 'email_accounts') return mockQuery(imapData);
      return mockQuery(null);
    });
    const res = await request(app).get('/api/emails/account').expect(200);
    expect(res.body.account).toMatchObject({ host: 'imap.gmail.com', name: 'test@gmail.com' });
  });

  it('retourne le compte OAuth Gmail si IMAP absent mais OAuth présent', async () => {
    const oauthData = { provider: 'gmail', email: 'test@gmail.com', created_at: '2024-01-01T00:00:00Z' };
    supabase.from.mockImplementation((table) => {
      if (table === 'email_accounts') return mockQuery(null);
      if (table === 'oauth_connections') return mockQuery(oauthData);
      return mockQuery(null);
    });
    const res = await request(app).get('/api/emails/account').expect(200);
    expect(res.body.account).toMatchObject({
      id:       'oauth_gmail',
      host:     'gmail.oauth',
      name:     'test@gmail.com',
      provider: 'gmail',
    });
  });
});

// ─────────────────────────────────────────────────────────────
describe('GET /api/emails/sync', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it("retourne les emails Gmail quand l'OAuth est valide", async () => {
    const oauthData = { provider: 'gmail', email: 'test@gmail.com' };
    supabase.from.mockImplementation(() => mockQuery(oauthData));
    getValidAccessToken.mockResolvedValue('valid-access-token');
    fetchGmailEmails.mockResolvedValue([
      { id: 'msg1', sender: 'Jean Dupont', senderEmail: 'jean@example.fr', subject: 'Test', date: '2024-01-01T00:00:00Z', body: 'Bonjour' },
    ]);

    const res = await request(app).get('/api/emails/sync').expect(200);
    expect(res.body).toMatchObject({ source: 'gmail' });
    expect(res.body.emails).toHaveLength(1);
    expect(res.body.emails[0]).toMatchObject({ id: 'msg1', subject: 'Test' });
  });

  it('retourne 401 + code OAUTH_EXPIRED si getValidAccessToken retourne null', async () => {
    const oauthData = { provider: 'gmail', email: 'test@gmail.com' };
    supabase.from.mockImplementation(() => mockQuery(oauthData));
    getValidAccessToken.mockResolvedValue(null);

    const res = await request(app).get('/api/emails/sync').expect(401);
    expect(res.body).toMatchObject({ code: 'OAUTH_EXPIRED' });
  });

  it('retourne 500 avec message clair si fetchGmailEmails lance une erreur Gmail API', async () => {
    const oauthData = { provider: 'gmail', email: 'test@gmail.com' };
    supabase.from.mockImplementation(() => mockQuery(oauthData));
    getValidAccessToken.mockResolvedValue('token');
    fetchGmailEmails.mockRejectedValue(new Error('Gmail API non activée dans Google Cloud Console.'));

    const res = await request(app).get('/api/emails/sync').expect(500);
    expect(res.body.error).toMatch(/Gmail API/);
  });

  it('retourne 404 si aucun compte configuré (ni OAuth ni IMAP)', async () => {
    supabase.from.mockImplementation(() => mockQuery(null));
    const res = await request(app).get('/api/emails/sync').expect(404);
    expect(res.body.error).toMatch(/Aucun compte/);
  });

  it('retourne [] via IMAP si la boîte est vide (messages: 0)', async () => {
    const { ImapFlow } = require('imapflow');
    // Premier appel: oauth_connections → null → pas d'OAuth
    // Deuxième appel: email_accounts → compte IMAP
    const imapAccount = {
      id: 1, host: 'imap.test.fr', port: 993, tls: true,
      email_user: 'enc:user@test.fr', email_pass: 'enc:motdepasse',
    };
    let callCount = 0;
    supabase.from.mockImplementation(() => {
      callCount++;
      return mockQuery(callCount === 1 ? null : imapAccount);
    });

    const res = await request(app).get('/api/emails/sync').expect(200);
    expect(res.body.emails).toEqual([]);
  });
});
