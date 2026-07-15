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
  requireAdmin: (_req, _res, next) => next(),
  generateToken: jest.fn(() => 'fake-jwt-token'),
}));

jest.mock('../lib/supabase', () => ({ from: jest.fn() }));

jest.mock('../lib/security', () => ({
  encrypt: jest.fn(v => `enc:${v}`),
  decrypt: jest.fn(v => String(v).replace('enc:', '')),
}));

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

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

const request    = require('supertest');
const nodemailer = require('nodemailer');
const app        = require('../server');
const supabase   = require('../lib/supabase');
const { getUserMailSource, fetchImapMessageByUid } = require('../lib/mailbox');

function mockQuery(data, error = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq:     jest.fn().mockReturnThis(),
    upsert: jest.fn().mockResolvedValue({ data, error }),
    single: jest.fn().mockResolvedValue({ data, error }),
    then:   jest.fn((resolve) => resolve({ data, error })),
  };
}

const IMAP_SOURCE = {
  type: 'imap',
  account: { host: 'imap.gmail.com', port: 993, tls: true, email_user: 'enc:moi@gmail.com', email_pass: 'enc:app-password' },
};

describe('POST /api/mails/:id/reply', () => {
  let sendMail;

  beforeEach(() => {
    jest.clearAllMocks();
    sendMail = jest.fn().mockResolvedValue({ messageId: '<sent>' });
    nodemailer.createTransport.mockReturnValue({ sendMail });
    supabase.from.mockImplementation(() => mockQuery(null));
  });

  it('envoie la réponse en SMTP au véritable expéditeur et marque le mail traité', async () => {
    getUserMailSource.mockResolvedValue(IMAP_SOURCE);
    fetchImapMessageByUid.mockResolvedValue({
      uid: 101, sender: 'Marie Durand', senderEmail: 'marie@client.fr',
      subject: 'Fuite d\'eau', messageId: '<orig-123@client.fr>',
    });

    const res = await request(app)
      .post('/api/mails/101/reply')
      .send({ content: 'Bonjour Marie, j\'arrive dans l\'heure.' })
      .expect(200);

    expect(res.body).toMatchObject({ success: true, to: 'marie@client.fr' });

    // Destinataire relu depuis la boîte — jamais fourni par le client
    expect(fetchImapMessageByUid).toHaveBeenCalledWith(IMAP_SOURCE.account, '101');
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to:        'marie@client.fr',
      subject:   'Re: Fuite d\'eau',
      inReplyTo: '<orig-123@client.fr>',
    }));
    // SMTP dérivé du host IMAP
    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: 'smtp.gmail.com', port: 465 }));
  });

  it('refuse un contenu vide (400)', async () => {
    await request(app).post('/api/mails/101/reply').send({ content: '   ' }).expect(400);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('retourne 501 SEND_UNSUPPORTED pour un compte OAuth (TODO scope gmail.send)', async () => {
    getUserMailSource.mockResolvedValue({ type: 'oauth', provider: 'gmail', email: 'moi@gmail.com' });

    const res = await request(app)
      .post('/api/mails/101/reply')
      .send({ content: 'Réponse' })
      .expect(501);
    expect(res.body.code).toBe('SEND_UNSUPPORTED');
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('retourne 404 si le mail est introuvable dans la boîte de l\'utilisateur', async () => {
    getUserMailSource.mockResolvedValue(IMAP_SOURCE);
    fetchImapMessageByUid.mockResolvedValue(null);

    await request(app).post('/api/mails/999/reply').send({ content: 'Réponse' }).expect(404);
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe('POST /api/mails/:id/dismiss', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('marque le mail comme ignoré (upsert user_id + mail_id, sans contenu)', async () => {
    const q = mockQuery(null);
    supabase.from.mockImplementation(() => q);

    const res = await request(app).post('/api/mails/101/dismiss').expect(200);
    expect(res.body).toEqual({ success: true });
    expect(q.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-test-123', mail_id: '101', status: 'dismissed' }),
      { onConflict: 'user_id,mail_id' }
    );
  });

  it('retourne 500 si la table mail_status est absente ou en erreur', async () => {
    supabase.from.mockImplementation(() => mockQuery(null, { message: 'relation "mail_status" does not exist' }));
    const res = await request(app).post('/api/mails/101/dismiss').expect(500);
    expect(res.body.error).toMatch(/mail_status/);
  });
});
