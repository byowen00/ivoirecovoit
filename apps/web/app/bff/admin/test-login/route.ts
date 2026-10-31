import { type NextRequest, NextResponse } from 'next/server';
import { setAdminCookies } from '@/lib/server/admin-session';
import { API_INTERNAL_URL, forwardHeaders, newCsrfToken, type TokenPair } from '@/lib/server/session';

const TARGET = `${API_INTERNAL_URL}/api/v1/auth/staff/test-login`;

/** Essais en local : l'API dit si l'entrée directe est ouverte (jamais en pré-production ni en production). */
export async function GET(req: NextRequest) {
  const res = await fetch(TARGET, { headers: forwardHeaders(req), cache: 'no-store' }).catch(() => null);
  const data = res?.ok ? ((await res.json().catch(() => null)) as { enabled?: boolean } | null) : null;
  return NextResponse.json({ enabled: data?.enabled === true });
}

/** Entrée directe : mêmes cookies HttpOnly qu'une connexion normale du personnel. */
export async function POST(req: NextRequest) {
  const res = await fetch(TARGET, { method: 'POST', headers: forwardHeaders(req), body: '{}', cache: 'no-store' }).catch(() => null);
  const data = res ? ((await res.json().catch(() => null)) as (TokenPair & { staff: unknown }) | null) : null;
  if (!res || !res.ok || !data) {
    return NextResponse.json(data ?? { error: { code: 'HTTP_ERROR', message: 'Service indisponible.' } }, { status: res?.status || 502 });
  }
  const out = NextResponse.json({ staff: data.staff });
  setAdminCookies(out, data, newCsrfToken());
  return out;
}
