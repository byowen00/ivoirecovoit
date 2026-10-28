import { type NextRequest, NextResponse } from 'next/server';
import { setAdminCookies } from '@/lib/server/admin-session';
import { API_INTERNAL_URL, forwardHeaders, newCsrfToken, type TokenPair } from '@/lib/server/session';

/** Connexion du personnel (e-mail, mot de passe, code TOTP) ; les jetons restent dans des cookies HttpOnly. */
export async function POST(req: NextRequest) {
  const res = await fetch(`${API_INTERNAL_URL}/api/v1/auth/staff/login`, {
    method: 'POST',
    headers: forwardHeaders(req),
    body: await req.text(),
    cache: 'no-store',
  }).catch(() => null);
  const data = res ? ((await res.json().catch(() => null)) as (TokenPair & { staff: unknown }) | null) : null;
  if (!res || !res.ok || !data) {
    return NextResponse.json(data ?? { error: { code: 'HTTP_ERROR', message: 'Service indisponible.' } }, { status: res?.status || 502 });
  }
  const out = NextResponse.json({ staff: data.staff });
  setAdminCookies(out, data, newCsrfToken());
  return out;
}
