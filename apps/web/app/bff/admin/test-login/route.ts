import { type NextRequest, NextResponse } from 'next/server';
import { setAdminCookies } from '@/lib/server/admin-session';
import { API_INTERNAL_URL, forwardHeaders, newCsrfToken, type TokenPair } from '@/lib/server/session';

const TARGET = `${API_INTERNAL_URL}/api/v1/auth/staff/test-login`;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/i;

/** Depuis Internet (tunnel Cloudflare des essais), l'API exige le code d'essai : le site le lui signale. */
function isLocalRequest(req: NextRequest): boolean {
  if (req.headers.get('cf-connecting-ip') || req.headers.get('cf-ray')) return false;
  const hosts = [req.headers.get('host'), req.headers.get('x-forwarded-host')].flatMap((v) => (v ? v.split(',') : []));
  return hosts.length > 0 && hosts.every((h) => LOCAL_HOST.test(h.trim()));
}

function apiHeaders(req: NextRequest, local: boolean): Record<string, string> {
  return local ? forwardHeaders(req) : { ...forwardHeaders(req), 'X-IC-Remote': '1' };
}

/** Essais : l'API dit si l'entrée directe est ouverte (jamais en pré-production ni en production). */
export async function GET(req: NextRequest) {
  const local = isLocalRequest(req);
  const res = await fetch(TARGET, { headers: apiHeaders(req, local), cache: 'no-store' }).catch(() => null);
  const data = res?.ok ? ((await res.json().catch(() => null)) as { enabled?: boolean } | null) : null;
  return NextResponse.json({ enabled: data?.enabled === true, needsCode: !local });
}

/** Entrée directe : mêmes cookies HttpOnly qu'une connexion normale du personnel. */
export async function POST(req: NextRequest) {
  const local = isLocalRequest(req);
  const sent = (await req.json().catch(() => null)) as { code?: unknown } | null;
  const body = JSON.stringify(!local && typeof sent?.code === 'string' ? { code: sent.code } : {});
  const res = await fetch(TARGET, { method: 'POST', headers: apiHeaders(req, local), body, cache: 'no-store' }).catch(() => null);
  const data = res ? ((await res.json().catch(() => null)) as (TokenPair & { staff: unknown }) | null) : null;
  if (!res || !res.ok || !data) {
    return NextResponse.json(data ?? { error: { code: 'HTTP_ERROR', message: 'Service indisponible.' } }, { status: res?.status || 502 });
  }
  const out = NextResponse.json({ staff: data.staff });
  setAdminCookies(out, data, newCsrfToken());
  return out;
}
