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

// Seules les routes de l'espace personnel, des réservations, de l'espace conducteur, des notifications et de l'aide
// passent par ce relais authentifié (l'administration a son propre relais, /bff/admin).
const ID = '[0-9a-fA-F-]{36}';
const ALLOWED_ROUTES = [
  'me(/.*)?',
  'auth/sessions(/.*)?',
  'drivers/me(/.*)?',
  'vehicles(/.*)?',
  `documents/${ID}/download-url`,
  'trips',
  'trips/(mine|preview)',
  `trips/${ID}(/(manage|publish|duplicate|cancel|start|complete|location))?`,
  'routing/estimate',
  'bookings',
  'bookings/(quote|mine)',
  `bookings/${ID}(/(accept|reject|cancel|cancel/preview))?`,
  `trips/${ID}/bookings/${ID}/no-show`,
  `bookings/${ID}/payments`,
  'payments/methods',
  `payments/${ID}`,
  'notifications(/(unread-count|read))?',
  `bookings/${ID}/(messages|review|reviews|dispute|share)`,
  'reports(/mine)?',
  'disputes(/mine)?',
  `disputes/${ID}(/messages)?`,
];
const ALLOWED = new RegExp(`^(${ALLOWED_ROUTES.join('|')})$`);
// En-têtes du client utiles à l'API : clé d'idempotence (création sans doublon) et version attendue (If-Match).
const PASSTHROUGH = ['idempotency-key', 'if-match'];
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
  const passthrough: Record<string, string> = {};
  for (const name of PASSTHROUGH) {
    const value = req.headers.get(name);
    if (value && value.length <= 128) passthrough[name] = value;
  }
  const url = `${API_INTERNAL_URL}/api/v1/${target}${req.nextUrl.search}`;
  const call = (access: string | undefined) =>
    fetch(url, {
      method: req.method,
      headers: { ...forwardHeaders(req), ...passthrough, ...(access ? { Authorization: `Bearer ${access}` } : {}) },
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
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'application/json',
      ...(res.headers.get('etag') ? { ETag: res.headers.get('etag')! } : {}),
    },
  });
  if (renewed) setSessionCookies(out, renewed);
  // Session terminée côté serveur (déconnexion ailleurs, suspension, suppression) : on nettoie le navigateur.
  if (res.status === 401 || (target === 'auth/sessions/all' && res.ok) || (target === 'me' && req.method === 'DELETE' && res.ok)) {
    clearSessionCookies(out);
  }
  return out;
}

export { relay as DELETE, relay as GET, relay as PATCH, relay as POST, relay as PUT };
