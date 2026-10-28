import { type NextRequest, NextResponse } from 'next/server';
import { API_INTERNAL_URL, forwardHeaders, newCsrfToken, setSessionCookies, type TokenPair } from '@/lib/server/session';

/** Vérifie le code auprès de l'API puis ouvre la session dans des cookies HttpOnly ; les jetons ne sont pas renvoyés. */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const res = await fetch(`${API_INTERNAL_URL}/api/v1/auth/otp/verify`, {
    method: 'POST',
    headers: forwardHeaders(req),
    body,
    cache: 'no-store',
  });
  const data = (await res.json().catch(() => null)) as (TokenPair & { user: unknown; isNewUser: boolean }) | null;
  if (!res.ok || !data) {
    return NextResponse.json(data ?? { error: { code: 'HTTP_ERROR', message: 'Service indisponible.' } }, {
      status: res.status || 502,
    });
  }
  const out = NextResponse.json({ user: data.user, isNewUser: data.isNewUser });
  setSessionCookies(out, data, newCsrfToken());
  return out;
}
