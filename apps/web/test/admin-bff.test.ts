// @vitest-environment node
import { NextRequest } from 'next/server';
import { GET, POST, PUT } from '@/app/bff/admin/api/[...path]/route';
import { POST as LOGIN } from '@/app/bff/admin/login/route';

const ctx = (path: string) => ({ params: Promise.resolve({ path: path.split('/') }) });

function req(url: string, init: { method?: string; cookies?: Record<string, string>; headers?: Record<string, string>; body?: string } = {}) {
  const cookie = Object.entries(init.cookies ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  return new NextRequest(`http://localhost:3001${url}`, {
    method: init.method ?? 'GET',
    headers: { ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) },
    body: init.body,
  });
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const rel = (path: string, init?: Parameters<typeof req>[1]) => req(`/bff/admin/api/${path}`, init);

describe('relais de la console /bff/admin/api', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('relaie vers /api/v1/admin avec le jeton du personnel, jamais celui de l’utilisateur', async () => {
    fetchMock.mockResolvedValue(json(200, { data: [] }));
    const res = await GET(rel('refunds?status=REQUESTED', { cookies: { ic_access: 'USER', ic_admin_access: 'STAFF' } }), ctx('refunds'));
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[0]![0]).toBe('http://localhost:3000/api/v1/admin/refunds?status=REQUESTED');
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe('Bearer STAFF');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('sans session du personnel, répond 401 sans appeler l’API (le cookie utilisateur ne suffit pas)', async () => {
    const res = await GET(rel('dashboard', { cookies: { ic_access: 'USER', ic_session: 'R' } }), ctx('dashboard'));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exige le jeton CSRF propre à la console', async () => {
    const userCsrf = 'u'.repeat(32);
    const res = await POST(
      rel('refunds', { method: 'POST', cookies: { ic_admin_access: 'STAFF', ic_csrf: userCsrf }, headers: { 'x-csrf-token': userCsrf }, body: '{}' }),
      ctx('refunds'),
    );
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(json(201, { refundId: 'r1' }));
    const csrf = 'a'.repeat(32);
    const ok = await POST(
      rel('refunds', { method: 'POST', cookies: { ic_admin_access: 'STAFF', ic_admin_csrf: csrf }, headers: { 'x-csrf-token': csrf, 'idempotency-key': 'k-9' }, body: '{"a":1}' }),
      ctx('refunds'),
    );
    expect(ok.status).toBe(201);
    expect(fetchMock.mock.calls[0]![1].headers['Idempotency-Key']).toBe('k-9');
    expect(fetchMock.mock.calls[0]![1].body).toBe('{"a":1}');
  });

  it('refuse les chemins douteux', async () => {
    for (const path of ['../users', 'Users', 'refunds/../../auth/me', '']) {
      const res = await GET(rel(path, { cookies: { ic_admin_access: 'STAFF' } }), ctx(path));
      expect(res.status).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renouvelle une fois un jeton expiré puis pose les nouveaux cookies de la console', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { error: { code: 'TOKEN_EXPIRED' } }))
      .mockResolvedValueOnce(json(200, { accessToken: 'NEW', refreshToken: 'R2', accessTokenExpiresInS: 900 }))
      .mockResolvedValueOnce(json(200, {}));
    const csrf = 'b'.repeat(32);
    const res = await PUT(
      rel('settings/booking.hold_minutes', {
        method: 'PUT',
        cookies: { ic_admin_access: 'OLD', ic_admin_session: 'R1-admin-unique', ic_admin_csrf: csrf },
        headers: { 'x-csrf-token': csrf },
        body: '{}',
      }),
      ctx('settings/booking.hold_minutes'),
    );
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[2]![1].headers.Authorization).toBe('Bearer NEW');
    expect(res.cookies.get('ic_admin_access')?.value).toBe('NEW');
    expect(res.cookies.get('ic_admin_session')?.path).toBe('/bff/admin');
    expect(res.cookies.get('ic_access')).toBeUndefined();
  });

  it('relaie un 403 de l’API tel quel (les droits sont décidés par l’API)', async () => {
    fetchMock.mockResolvedValueOnce(json(403, { error: { code: 'FORBIDDEN' } }));
    const res = await GET(rel('staff', { cookies: { ic_admin_access: 'STAFF' } }), ctx('staff'));
    expect(res.status).toBe(403);
    expect(res.cookies.get('ic_admin_access')).toBeUndefined();
  });

  it('efface la session de la console sur un 401 définitif', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { error: { code: 'SESSION_REVOKED' } }));
    const res = await GET(rel('me', { cookies: { ic_admin_access: 'STAFF', ic_admin_session: 'R1-admin-other' } }), ctx('me'));
    expect(res.status).toBe(401);
    expect(res.cookies.get('ic_admin_session')?.value).toBe('');
    // L'effacement garde les attributs de sécurité (analyse ZAP de l'étape 10).
    expect(res.cookies.get('ic_admin_session')).toMatchObject({ httpOnly: true, sameSite: 'strict' });
    expect(res.cookies.get('ic_admin_csrf')).toMatchObject({ httpOnly: false, sameSite: 'strict' });
  });
});

describe('connexion du personnel /bff/admin/login', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('garde les jetons dans des cookies HttpOnly stricts et ne renvoie que le profil', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { accessToken: 'A', refreshToken: 'R', accessTokenExpiresInS: 900, staff: { id: 's1' } }));
    const res = await LOGIN(req('/bff/admin/login', { method: 'POST', body: '{"email":"a@b.ci","password":"x","totp":"123456"}' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ staff: { id: 's1' } });
    expect(fetchMock.mock.calls[0]![0]).toBe('http://localhost:3000/api/v1/auth/staff/login');
    const access = res.cookies.get('ic_admin_access')!;
    expect(access.httpOnly).toBe(true);
    expect(access.sameSite).toBe('strict');
    expect(access.path).toBe('/bff/admin');
    expect(res.cookies.get('ic_admin_csrf')?.value).toMatch(/^.{32,}$/);
  });

  it('relaie le refus de l’API sans poser de cookie', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'Identifiants incorrects.' } }));
    const res = await LOGIN(req('/bff/admin/login', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(401);
    expect(res.cookies.get('ic_admin_access')).toBeUndefined();
  });
});
