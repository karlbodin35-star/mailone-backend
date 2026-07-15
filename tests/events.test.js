'use strict';

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

const request  = require('supertest');
const app      = require('../server');
const supabase = require('../lib/supabase');

function chain(result) {
  const q = {
    select: jest.fn(() => q), eq: jest.fn(() => q), order: jest.fn(() => q),
    insert: jest.fn(() => q), delete: jest.fn(() => q),
    single: jest.fn().mockResolvedValue(result),
    then:   (resolve) => Promise.resolve(result).then(resolve),
  };
  return q;
}

describe('Agenda /api/events', () => {
  beforeEach(() => jest.clearAllMocks());

  it('liste les rendez-vous de l\'utilisateur', async () => {
    supabase.from.mockReturnValue(chain({ data: [{ id: 'e1', title: 'Visite Mme Durand', starts_at: '2026-07-15T09:00:00Z', mail_id: null }], error: null }));
    const res = await request(app).get('/api/events').expect(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].title).toBe('Visite Mme Durand');
  });

  it('crée un rendez-vous (titre + date requis)', async () => {
    supabase.from.mockReturnValue(chain({ data: { id: 'e2', title: 'Chantier Leroy', starts_at: '2026-07-20T14:00:00.000Z', mail_id: null }, error: null }));
    const res = await request(app).post('/api/events').send({ title: 'Chantier Leroy', starts_at: '2026-07-20T14:00:00Z' }).expect(200);
    expect(res.body.event.title).toBe('Chantier Leroy');

    await request(app).post('/api/events').send({ title: '', starts_at: '2026-07-20T14:00:00Z' }).expect(400);
    await request(app).post('/api/events').send({ title: 'X', starts_at: 'pas-une-date' }).expect(400);
  });
});
