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
  requireSubscription: (req, _res, next) => { req.subscription = { plan: 'solo', status: 'trialing' }; next(); },
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
    MailboxError:          actual.MailboxError,
    syncUserEmails:        jest.fn(),
    getUserMailSource:     jest.fn(),
    fetchImapMessageByUid: jest.fn(),
    fetchImapEmails:       jest.fn(),
  };
});

const request = require('supertest');

// fetch mocké : MyMemory renvoie une traduction canned
global.fetch = jest.fn();
function mockMyMemory(text) {
  return Promise.resolve({
    ok:   true,
    json: async () => ({ responseStatus: 200, responseData: { translatedText: text } }),
  });
}

const app = require('../server');

const MAIL_EN = {
  sender:  'Trello',
  subject: 'Your free trial ends on Thursday',
  body:    'Hello, the Premium free trial for the Workspace ends on Thursday. Please upgrade your plan if you want to keep your boards.',
};

describe('POST /api/ai/translate-mail (agent gratuit)', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('renvoie {lang:fr} sans aucun appel réseau pour un mail français', async () => {
    const res = await request(app)
      .post('/api/ai/translate-mail')
      .send({ sender: 'Marie', subject: 'Demande de devis', body: 'Bonjour, pouvez-vous me faire un devis pour la salle de bain ? Merci pour votre retour.' })
      .expect(200);
    expect(res.body).toEqual({ lang: 'fr' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('traduit un mail anglais via le moteur gratuit (0 quota) et rédige la réponse', async () => {
    global.fetch
      .mockReturnValueOnce(mockMyMemory('Bonjour, l\'essai gratuit Premium se termine jeudi. Mettez à niveau votre offre pour garder vos tableaux.'))  // corps EN→FR
      .mockReturnValueOnce(mockMyMemory('Votre essai gratuit se termine jeudi'))                                                                        // sujet EN→FR
      .mockReturnValueOnce(mockMyMemory('Hello, thank you for your request. I will get back to you shortly.'));                                          // réponse FR→EN

    const res = await request(app).post('/api/ai/translate-mail').send(MAIL_EN).expect(200);

    expect(res.body.lang).toBe('en');
    expect(res.body.engine).toBe('free');
    expect(res.body.mailFr).toMatch(/essai gratuit/);
    expect(res.body.subjectFr).toMatch(/jeudi/);
    expect(res.body.reply).toMatch(/Hello/);
    expect(res.body.replyFr).toMatch(/Bonjour/);          // réponse française de l'agent local
    // Uniquement MyMemory — jamais Anthropic, jamais de quota
    for (const call of global.fetch.mock.calls) {
      expect(String(call[0])).toContain('mymemory');
    }
  });

  it('gère un mail espagnol : réponse rédigée en espagnol', async () => {
    global.fetch
      .mockReturnValueOnce(mockMyMemory('Bonjour, je voudrais un devis pour la rénovation de ma salle de bain.'))  // corps ES→FR
      .mockReturnValueOnce(mockMyMemory('Demande de devis salle de bain'))                                          // sujet ES→FR
      .mockReturnValueOnce(mockMyMemory('Hola, gracias por su solicitud. Le enviaré un presupuesto en breve.'));    // réponse FR→ES

    const res = await request(app).post('/api/ai/translate-mail').send({
      sender:  'Carlos García',
      subject: 'Solicitud de presupuesto para el baño',
      body:    'Hola, me gustaría recibir un presupuesto para la renovación de mi baño. Gracias por su respuesta y hasta pronto.',
    }).expect(200);

    expect(res.body.lang).toBe('es');
    expect(res.body.langName).toBe('espagnol');
    expect(res.body.engine).toBe('free');
    expect(res.body.reply).toMatch(/Hola/);
    expect(res.body.replyFr).toMatch(/Bonjour/);
  });

  it('bascule sur Anthropic (avec quota) si le moteur gratuit échoue', async () => {
    const supabase = require('../lib/supabase');
    supabase.from.mockImplementation(() => ({
      select: jest.fn().mockReturnThis(),
      eq:     jest.fn().mockReturnThis(),
      insert: jest.fn().mockResolvedValue({ data: null, error: null }),
      update: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
      then:   jest.fn(resolve => resolve({ data: null, error: null })),
    }));

    global.fetch
      .mockRejectedValueOnce(new Error('MyMemory down'))   // moteur gratuit KO
      .mockReturnValueOnce(Promise.resolve({               // Anthropic OK
        ok:   true,
        json: async () => ({ content: [{ text: '{"lang":"en","mailFr":"Bonjour…","reply":"Hello…","replyFr":"Bonjour…"}' }] }),
      }));

    const res = await request(app).post('/api/ai/translate-mail').send(MAIL_EN).expect(200);
    expect(res.body.lang).toBe('en');
    expect(res.body.reply).toBe('Hello…');
    expect(String(global.fetch.mock.calls[1][0])).toContain('anthropic');
  });
});
