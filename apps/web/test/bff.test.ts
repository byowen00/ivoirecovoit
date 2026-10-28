// @vitest-environment node
import { NextRequest } from 'next/server';
import { DELETE, GET, PATCH, POST } from '@/app/bff/api/[...path]/route';

const ctx = (path: string) => ({ params: Promise.resolve({ path: path.split('/') }) });

function req(path: string, init: { method?: string; cookies?: Record<string, string>; headers?: Record<string, string>; body?: string } = {}) {
  const cookie = Object.entries(init.cookies ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  return new NextRequest(`http://localhost:3001/bff/api/${path}`, {
    method: init.method ?? 'GET',
    headers: { ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) },
    body: init.body,
  });
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('relais authentifié /bff/api', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('ajoute le jeton d’accès du cookie et relaie la réponse', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { id: 'u1' }));
    const res = await GET(req('me', { cookies: { ic_access: 'AAA' } }), ctx('me'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'u1' });
    expect(fetchMock.mock.calls[0]![0]).toBe('http://localhost:3000/api/v1/me');
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe('Bearer AAA');
  });

  it('renouvelle une seule fois un jeton expiré, rejoue la requête et pose les nouveaux cookies', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { error: { code: 'TOKEN_EXPIRED' } }))
      .mockResolvedValueOnce(json(200, { accessToken: 'NEW', refreshToken: 'R2', accessTokenExpiresInS: 900 }))
      .mockResolvedValueOnce(json(200, { id: 'u1' }));
    const res = await GET(req('me', { cookies: { ic_access: 'OLD', ic_session: 'R1-unique-a' } }), ctx('me'));
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[1]![0]).toBe('http://localhost:3000/api/v1/auth/refresh');
    expect(fetchMock.mock.calls[2]![1].headers.Authorization).toBe('Bearer NEW');
    expect(res.cookies.get('ic_access')?.value).toBe('NEW');
    expect(res.cookies.get('ic_session')?.value).toBe('R2');
    expect(res.cookies.get('ic_session')?.httpOnly).toBe(true);
  });

  it('partage le renouvellement entre requêtes simultanées (pas de rejeu du refresh token)', async () => {
    fetchMock.mockImplementation(async (url: string, init: { headers: Record<string, string> }) => {
      if (url.endsWith('/auth/refresh')) return json(200, { accessToken: 'NEW', refreshToken: 'R2', accessTokenExpiresInS: 900 });
      return init.headers.Authorization === 'Bearer NEW' ? json(200, {}) : json(401, { error: { code: 'TOKEN_EXPIRED' } });
    });
    const cookies = { ic_access: 'OLD', ic_session: 'R1-unique-b' };
    const [a, b] = await Promise.all([GET(req('me', { cookies }), ctx('me')), GET(req('auth/sessions', { cookies }), ctx('auth/sessions'))]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('efface les cookies quand la session est terminée côté serveur', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { error: { code: 'SESSION_REVOKED' } }));
    const res = await GET(req('me', { cookies: { ic_access: 'AAA', ic_session: 'R1-unique-c' } }), ctx('me'));
    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.cookies.get('ic_session')?.value).toBe('');
  });

  it('refuse une modification sans jeton CSRF', async () => {
    const res = await PATCH(req('me', { method: 'PATCH', cookies: { ic_access: 'AAA', ic_csrf: 'x'.repeat(32) }, body: '{}' }), ctx('me'));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepte une modification avec le jeton CSRF', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const csrf = 'y'.repeat(32);
    const res = await DELETE(
      req('auth/sessions/0190', { method: 'DELETE', cookies: { ic_access: 'AAA', ic_csrf: csrf }, headers: { 'x-csrf-token': csrf } }),
      ctx('auth/sessions/0190'),
    );
    expect(res.status).toBe(204);
  });

  it('relaie l’espace conducteur avec la clé d’idempotence et la version attendue', async () => {
    fetchMock.mockImplementation(async () => json(200, {}));
    const csrf = 'z'.repeat(32);
    const id = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
    const res = await POST(
      req('trips', { method: 'POST', cookies: { ic_access: 'AAA', ic_csrf: csrf }, headers: { 'x-csrf-token': csrf, 'idempotency-key': 'k-1' }, body: '{}' }),
      ctx('trips'),
    );
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[0]![1].headers['idempotency-key']).toBe('k-1');
    await PATCH(
      req(`trips/${id}`, { method: 'PATCH', cookies: { ic_access: 'AAA', ic_csrf: csrf }, headers: { 'x-csrf-token': csrf, 'if-match': '3' }, body: '{}' }),
      ctx(`trips/${id}`),
    );
    expect(fetchMock.mock.calls[1]![1].headers['if-match']).toBe('3');
    for (const path of ['drivers/me', 'vehicles', `trips/${id}/manage`, 'trips/mine']) {
      expect((await GET(req(path, { cookies: { ic_access: 'AAA' } }), ctx(path))).status).toBe(200);
    }
  });

  it('ne relaie que les routes de l’espace personnel', async () => {
    for (const path of ['admin/users', 'admin/verifications', 'trips/search', 'drivers/0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b']) {
      const res = await GET(req(path, { cookies: { ic_access: 'AAA' } }), ctx(path));
      expect(res.status).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
