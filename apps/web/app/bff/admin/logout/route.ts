import { type NextRequest, NextResponse } from 'next/server';
import { ADMIN_ACCESS_COOKIE, ADMIN_CSRF_COOKIE, clearAdminCookies } from '@/lib/server/admin-session';
import { API_INTERNAL_URL, csrfValid, forwardHeaders } from '@/lib/server/session';

export async function POST(req: NextRequest) {
  if (!csrfValid(req, ADMIN_CSRF_COOKIE)) {
    return NextResponse.json({ error: { code: 'CSRF_INVALID', message: 'Requête refusée. Rechargez la page.' } }, { status: 403 });
  }
  const access = req.cookies.get(ADMIN_ACCESS_COOKIE)?.value;
  if (access) {
    await fetch(`${API_INTERNAL_URL}/api/v1/admin/logout`, {
      method: 'POST',
      headers: { ...forwardHeaders(req), Authorization: `Bearer ${access}` },
      cache: 'no-store',
    }).catch(() => undefined);
  }
  const res = new NextResponse(null, { status: 204 });
  clearAdminCookies(res);
  return res;
}
