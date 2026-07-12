'use strict';

// ── Env minimale pour les tests ──────────────────────────────
process.env.NODE_ENV               = 'test';
process.env.JWT_SECRET             = 'test-jwt-secret-for-ci';
process.env.SUPABASE_URL           = 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-key';
process.env.GOOGLE_CLIENT_ID       = 'google-client-id-test';
process.env.GOOGLE_CLIENT_SECRET   = 'google-client-secret-test';

// ── Mock fetch global (Node 18+) ─────────────────────────────
global.fetch = jest.fn();

// ── Mock Supabase ─────────────────────────────────────────────
// Construit une chaîne de requête Supabase mockée
function makeChain(resolvedData) {
  const chain = {
    select:  jest.fn().mockReturnThis(),
    eq:      jest.fn().mockReturnThis(),
    order:   jest.fn().mockReturnThis(),
    limit:   jest.fn().mockReturnThis(),
    update:  jest.fn().mockReturnThis(),
    single:  jest.fn().mockResolvedValue({ data: resolvedData, error: resolvedData ? null : { message: 'No rows' } }),
    // Rendre la chaîne elle-même awaitable (pour: await supabase.from().update().eq())
    then:    jest.fn((resolve) => resolve({ data: resolvedData, error: null })),
  };
  return chain;
}

jest.mock('../lib/supabase', () => ({ from: jest.fn() }));

const supabase = require('../lib/supabase');
const { getValidAccessToken, fetchGmailEmails, fetchOutlookEmails } = require('../lib/oauthHelpers');

// ─────────────────────────────────────────────────────────────
describe('getValidAccessToken', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('retourne null si aucune connexion OAuth en base', async () => {
    supabase.from.mockReturnValue(makeChain(null));
    expect(await getValidAccessToken('user-1', 'gmail')).toBeNull();
  });

  it("retourne l'access_token directement si non expiré", async () => {
    const futureExpiry = new Date(Date.now() + 3600_000).toISOString();
    supabase.from.mockReturnValue(makeChain({
      access_token:  'valid-access-token',
      refresh_token: 'refresh',
      token_expiry:  futureExpiry,
    }));
    expect(await getValidAccessToken('user-1', 'gmail')).toBe('valid-access-token');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('retourne null si token expiré sans refresh_token', async () => {
    const pastExpiry = new Date(Date.now() - 1000).toISOString();
    supabase.from.mockReturnValue(makeChain({
      access_token:  'expired-token',
      refresh_token: null,
      token_expiry:  pastExpiry,
    }));
    expect(await getValidAccessToken('user-1', 'gmail')).toBeNull();
  });

  it('rafraîchit et retourne le nouveau token si expiré avec refresh_token', async () => {
    const pastExpiry = new Date(Date.now() - 1000).toISOString();
    supabase.from.mockReturnValue(makeChain({
      access_token:  'old-token',
      refresh_token: 'valid-refresh',
      token_expiry:  pastExpiry,
    }));
    global.fetch.mockResolvedValueOnce({
      ok:   true,
      json: async () => ({ access_token: 'refreshed-token', expires_in: 3600 }),
    });
    expect(await getValidAccessToken('user-1', 'gmail')).toBe('refreshed-token');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('retourne null si le refresh échoue côté Google', async () => {
    const pastExpiry = new Date(Date.now() - 1000).toISOString();
    supabase.from.mockReturnValue(makeChain({
      access_token:  'old-token',
      refresh_token: 'bad-refresh',
      token_expiry:  pastExpiry,
    }));
    global.fetch.mockResolvedValueOnce({
      ok:   false,
      json: async () => ({ error: 'invalid_grant', error_description: 'Token has been expired' }),
    });
    expect(await getValidAccessToken('user-1', 'gmail')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
describe('fetchGmailEmails', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('retourne [] si la boîte est vide', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    expect(await fetchGmailEmails('token')).toEqual([]);
  });

  it('retourne [] si messages est un tableau vide', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ messages: [] }) });
    expect(await fetchGmailEmails('token')).toEqual([]);
  });

  it('lance une erreur EXPLICITE si Gmail API non activée (403 PERMISSION_DENIED)', async () => {
    global.fetch.mockResolvedValueOnce({
      ok:     false,
      status: 403,
      json:   async () => ({
        error: {
          code:    403,
          message: 'Gmail API has not been used in project 123 before or it is disabled.',
          status:  'PERMISSION_DENIED',
        },
      }),
    });
    await expect(fetchGmailEmails('token')).rejects.toThrow(/Gmail API non activée/);
  });

  it('lance une erreur avec le statut HTTP pour les autres erreurs (401)', async () => {
    global.fetch.mockResolvedValueOnce({
      ok:     false,
      status: 401,
      json:   async () => ({ error: { message: 'Invalid Credentials', status: 'UNAUTHENTICATED' } }),
    });
    await expect(fetchGmailEmails('bad-token')).rejects.toThrow(/401/);
  });

  it('retourne les emails formatés quand tout fonctionne', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok:   true,
        json: async () => ({ messages: [{ id: 'abc1' }, { id: 'abc2' }] }),
      })
      .mockResolvedValueOnce({
        ok:   true,
        json: async () => ({
          id:      'abc1',
          snippet: 'L&#39;eau coule &amp; d&eacute;borde partout',
          payload: {
            headers: [
              { name: 'From',    value: 'Jean Dupont <jean@plomberie.fr>' },
              { name: 'Subject', value: 'Urgence : fuite eau' },
              { name: 'Date',    value: 'Mon, 1 Jan 2024 10:00:00 +0000' },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok:   true,
        json: async () => ({
          id:      'abc2',
          snippet: 'Demande de devis, Espace&amp;#160;Pro',
          payload: {
            headers: [
              { name: 'From',    value: 'Marie Martin <marie@client.fr>' },
              { name: 'Subject', value: 'Devis installation chaudière' },
              { name: 'Date',    value: 'Mon, 1 Jan 2024 11:00:00 +0000' },
            ],
          },
        }),
      });

    const emails = await fetchGmailEmails('valid-token', 30);

    expect(emails).toHaveLength(2);
    expect(emails[0]).toMatchObject({
      id:          'abc1',
      subject:     'Urgence : fuite eau',
      senderEmail: 'jean@plomberie.fr',
      sender:      'Jean Dupont',
    });
    // Entités HTML des snippets décodées (&#39; → ' , &amp; → &)
    expect(emails[0].body).toBe("L'eau coule & d&eacute;borde partout");
    expect(emails[1]).toMatchObject({
      id:          'abc2',
      subject:     'Devis installation chaudière',
      senderEmail: 'marie@client.fr',
    });
    // Double encodage (&amp;#160;) décodé jusqu'à stabilité → espace insécable
    expect(emails[1].body).toBe('Demande de devis, Espace Pro');
  });

  it('filtre les emails dont le fetch individuel échoue (résistance partielle)', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok:   true,
        json: async () => ({ messages: [{ id: 'ok1' }, { id: 'bad' }] }),
      })
      .mockResolvedValueOnce({
        ok:   true,
        json: async () => ({
          id: 'ok1', snippet: 'ok',
          payload: { headers: [
            { name: 'From',    value: 'A <a@b.fr>' },
            { name: 'Subject', value: 'Sujet ok' },
            { name: 'Date',    value: 'Mon, 1 Jan 2024 10:00:00 +0000' },
          ]},
        }),
      })
      .mockRejectedValueOnce(new Error('Network error'));

    const emails = await fetchGmailEmails('token');
    expect(emails).toHaveLength(1);
    expect(emails[0].id).toBe('ok1');
  });
});
