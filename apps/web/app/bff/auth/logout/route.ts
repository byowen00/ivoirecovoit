import { type NextRequest, NextResponse } from 'next/server';
import { ACCESS_COOKIE, API_INTERNAL_URL, clearSessionCookies, csrfValid, forwardHeaders } from '@/lib/server/session';

export async function POST(req: NextRequest) {
  if (!csrfValid(req)) {
    return NextResponse.json({ error: { code: 'CSRF_INVALID', message: 'Requête refusée. Rechargez la page.' } }, { status: 403 });
  }
  const access = req.cookies.get(ACCESS_COOKIE)?.value;
  if (access) {
    // Meilleur effort : même si l'API est injoignable, le navigateur oublie la session.
    await fetch(`${API_INTERNAL_URL}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { ...forwardHeaders(req), Authorization: `Bearer ${access}` },
      cache: 'no-store',
    }).catch(() => undefined);
  }
  const res = new NextResponse(null, { status: 204 });
  clearSessionCookies(res);
  return res;
}
