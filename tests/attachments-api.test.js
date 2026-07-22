'use strict';

// Endpoints support des pièces jointes (le CONTENU des fichiers ne
// transite jamais par le serveur — échange direct navigateur ↔ Gmail)
process.env.NODE_ENV               = 'test';
process.env.JWT_SECRET             = 'test-jwt-secret-for-ci';
process.env.SUPABASE_URL           = 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-key';
process.env.ENCRYPTION_KEY         = '0000000000000000000000000000000000000000000000000000000000000000';

jest.mock('../lib/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 'user-test-123', email: 't@e.fr', first_name: 'Karl', is_active: true }; next(); },
  requireSubscription: (_req, _res, next) => next(),
  requireAdmin: (_req, _res, next) => next(),
  generateToken: jest.fn(() => 'fake'),
}));
jest.mock('../lib/supabase', () => ({ from: jest.fn() }));
jest.mock('../lib/security', () => ({ encrypt: jest.fn(v => v), decrypt: jest.fn(v => v) }));
jest.mock('../lib/mailbox', () => {
  const actual = jest.requireActual('../lib/mailbox');
  return { MailboxError: actual.MailboxError, syncUserEmails: jest.fn(), getUserMailSource: jest.fn(), fetchImapMessageByUid: jest.fn(), fetchImapEmails: jest.fn() };
});
jest.mock('../lib/oauthHelpers', () => ({
  getValidAccessToken: jest.fn(),
  fetchGmailEmails: jest.fn(),
  fetchOutlookEmails: jest.fn(),
  sendGmailReply: jest.fn(),
}));

const request  = require('supertest');
const app      = require('../server');
const supabase = require('../lib/supabase');
const { getValidAccessToken } = require('../lib/oauthHelpers');

function mockQuery(data, error = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq:     jest.fn().mockReturnThis(),
    upsert: jest.fn().mockResolvedValue({ data, error }),
    single: jest.fn().mockResolvedValue({ data, error }),
    then:   (resolve) => Promise.resolve({ data, error }).then(resolve),
  };
}

describe('GET /api/oauth/gmail-token', () => {
  beforeEach(() => jest.clearAllMocks());

  it('remet son propre token à l\'utilisateur connecté', async () => {
    supabase.from.mockImplementation(() => mockQuery({ email: 'moi@gmail.com' }));
    getValidAccessToken.mockResolvedValue('ya29.token-valide');

    const res = await request(app).get('/api/oauth/gmail-token').expect(200);
    expect(res.body).toEqual({ accessToken: 'ya29.token-valide', email: 'moi@gmail.com' });
    expect(getValidAccessToken).toHaveBeenCalledWith('user-test-123', 'gmail');
  });

  it('404 NO_GMAIL sans boîte Gmail connectée', async () => {
    supabase.from.mockImplementation(() => mockQuery(null));
    const res = await request(app).get('/api/oauth/gmail-token').expect(404);
    expect(res.body.code).toBe('NO_GMAIL');
  });

  it('401 OAUTH_EXPIRED si le rafraîchissement échoue', async () => {
    supabase.from.mockImplementation(() => mockQuery({ email: 'moi@gmail.com' }));
    getValidAccessToken.mockResolvedValue(null);
    const res = await request(app).get('/api/oauth/gmail-token').expect(401);
    expect(res.body.code).toBe('OAUTH_EXPIRED');
  });
});

describe('POST /api/mails/:id/handled', () => {
  beforeEach(() => jest.clearAllMocks());

  it('marque traité un mail envoyé directement par le navigateur', async () => {
    const q = mockQuery(null);
    supabase.from.mockImplementation(() => q);
    const res = await request(app).post('/api/mails/19ef4a/handled').expect(200);
    expect(res.body).toEqual({ success: true });
    expect(q.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-test-123', mail_id: '19ef4a', status: 'handled' }),
      { onConflict: 'user_id,mail_id' }
    );
  });
});
