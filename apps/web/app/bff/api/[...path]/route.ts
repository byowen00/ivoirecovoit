import { type NextRequest, NextResponse } from 'next/server';
import {
  ACCESS_COOKIE,
  API_INTERNAL_URL,
  clearSessionCookies,
  csrfValid,
  forwardHeaders,
  REFRESH_COOKIE,
  refreshOnce,
  setSessionCookies,
  type TokenPair,
} from '@/lib/server/session';

// Seules les routes de l'espace personnel passent par ce relais authentifié.
const ALLOWED = /^(me(\/.*)?|auth\/sessions(\/.*)?)$/;
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type Ctx = { params: Promise<{ path: string[] }> };

async function relay(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { path } = await ctx.params;
  const target = path.join('/');
  if (!ALLOWED.test(target)) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Ressource introuvable.' } }, { status: 404 });
  }
  if (MUTATING.has(req.method) && !csrfValid(req)) {
    return NextResponse.json({ error: { code: 'CSRF_INVALID', message: 'Requête refusée. Rechargez la page.' } }, { status: 403 });
  }

  const body = MUTATING.has(req.method) ? await req.text() : undefined;
  const url = `${API_INTERNAL_URL}/api/v1/${target}${req.nextUrl.search}`;
  const call = (access: string | undefined) =>
    fetch(url, {
      method: req.method,
      headers: { ...forwardHeaders(req), ...(access ? { Authorization: `Bearer ${access}` } : {}) },
      body: body || undefined,
      cache: 'no-store',
    });

  let access = req.cookies.get(ACCESS_COOKIE)?.value;
  let renewed: TokenPair | null = null;
  let res = access ? await call(access) : null;

  // Jeton d'accès absent ou expiré : un renouvellement, puis une seule nouvelle tentative.
  if (!res || res.status === 401) {
    const code = res ? ((await res.clone().json().catch(() => null)) as { error?: { code?: string } } | null)?.error?.code : null;
    const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;
    if ((!res || code === 'TOKEN_EXPIRED') && refreshToken) {
      renewed = await refreshOnce(req, refreshToken);
      if (renewed) {
        access = renewed.accessToken;
        res = await call(access);
      }
    }
  }

  if (!res) {
    const out = NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Connectez-vous pour continuer.' } }, { status: 401 });
    clearSessionCookies(out);
    return out;
  }

  const out = new NextResponse(res.status === 204 ? null : await res.arrayBuffer(), {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
  });
  if (renewed) setSessionCookies(out, renewed);
  // Session terminée côté serveur (déconnexion ailleurs, suspension, suppression) : on nettoie le navigateur.
  if (res.status === 401 || (target === 'auth/sessions/all' && res.ok) || (target === 'me' && req.method === 'DELETE' && res.ok)) {
    clearSessionCookies(out);
  }
  return out;
}

export { relay as DELETE, relay as GET, relay as PATCH, relay as POST, relay as PUT };
