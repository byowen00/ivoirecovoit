import { type NextRequest, NextResponse } from 'next/server';
import { ADMIN_ACCESS_COOKIE, ADMIN_CSRF_COOKIE, ADMIN_REFRESH_COOKIE, clearAdminCookies, setAdminCookies } from '@/lib/server/admin-session';
import { API_INTERNAL_URL, csrfValid, forwardHeaders, refreshOnce, type TokenPair } from '@/lib/server/session';

// Relais de la console : uniquement vers /api/v1/admin/*, avec le jeton du personnel. Les droits sont vérifiés par l'API.
const SAFE_PATH = /^[a-z0-9-]+(\/[a-zA-Z0-9._-]+)*$/;
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type Ctx = { params: Promise<{ path: string[] }> };

async function relay(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const target = (await ctx.params).path.join('/');
  if (!SAFE_PATH.test(target) || target.split('/').includes('..')) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Ressource introuvable.' } }, { status: 404 });
  }
  if (MUTATING.has(req.method) && !csrfValid(req, ADMIN_CSRF_COOKIE)) {
    return NextResponse.json({ error: { code: 'CSRF_INVALID', message: 'Requête refusée. Rechargez la page.' } }, { status: 403 });
  }
  const body = MUTATING.has(req.method) ? await req.text() : undefined;
  const idem = req.headers.get('idempotency-key');
  const url = `${API_INTERNAL_URL}/api/v1/admin/${target}${req.nextUrl.search}`;
  const call = (access: string) =>
    fetch(url, {
      method: req.method,
      headers: { ...forwardHeaders(req), ...(idem && idem.length <= 128 ? { 'Idempotency-Key': idem } : {}), Authorization: `Bearer ${access}` },
      body: body || undefined,
      cache: 'no-store',
    });

  let access = req.cookies.get(ADMIN_ACCESS_COOKIE)?.value;
  let renewed: TokenPair | null = null;
  let res = access ? await call(access) : null;
  if (!res || res.status === 401) {
    const code = res ? ((await res.clone().json().catch(() => null)) as { error?: { code?: string } } | null)?.error?.code : null;
    const refreshToken = req.cookies.get(ADMIN_REFRESH_COOKIE)?.value;
    if ((!res || code === 'TOKEN_EXPIRED') && refreshToken) {
      renewed = await refreshOnce(req, refreshToken);
      if (renewed) {
        access = renewed.accessToken;
        res = await call(access);
      }
    }
  }
  if (!res) {
    const out = NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Session expirée : reconnectez-vous.' } }, { status: 401 });
    clearAdminCookies(out);
    return out;
  }
  const out = new NextResponse(res.status === 204 ? null : await res.arrayBuffer(), {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json', 'Cache-Control': 'no-store' },
  });
  if (renewed) setAdminCookies(out, renewed);
  if (res.status === 401) clearAdminCookies(out);
  return out;
}

export { relay as DELETE, relay as GET, relay as PATCH, relay as POST, relay as PUT };
