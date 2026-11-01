import { type NextRequest, NextResponse } from 'next/server';
import { setAdminCookies } from '@/lib/server/admin-session';
import { API_INTERNAL_URL, forwardHeaders, newCsrfToken, type TokenPair } from '@/lib/server/session';

const TARGET = `${API_INTERNAL_URL}/api/v1/auth/staff/test-login`;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/i;

/** Jamais depuis Internet (tunnel Cloudflare ouvert pour les essais) : seulement depuis l'ordinateur ou le Wi-Fi. */
function isLocalRequest(req: NextRequest): boolean {
  if (req.headers.get('cf-connecting-ip') || req.headers.get('cf-ray')) return false;
  const hosts = [req.headers.get('host'), req.headers.get('x-forwarded-host')].flatMap((v) => (v ? v.split(',') : []));
  return hosts.length > 0 && hosts.every((h) => LOCAL_HOST.test(h.trim()));
}

/** Essais en local : l'API dit si l'entrée directe est ouverte (jamais en pré-production ni en production). */
export async function GET(req: NextRequest) {
  if (!isLocalRequest(req)) return NextResponse.json({ enabled: false });
  const res = await fetch(TARGET, { headers: forwardHeaders(req), cache: 'no-store' }).catch(() => null);
  const data = res?.ok ? ((await res.json().catch(() => null)) as { enabled?: boolean } | null) : null;
  return NextResponse.json({ enabled: data?.enabled === true });
}

/** Entrée directe : mêmes cookies HttpOnly qu'une connexion normale du personnel. */
export async function POST(req: NextRequest) {
  if (!isLocalRequest(req)) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Ressource introuvable.' } }, { status: 404 });
  const res = await fetch(TARGET, { method: 'POST', headers: forwardHeaders(req), body: '{}', cache: 'no-store' }).catch(() => null);
  const data = res ? ((await res.json().catch(() => null)) as (TokenPair & { staff: unknown }) | null) : null;
  if (!res || !res.ok || !data) {
    return NextResponse.json(data ?? { error: { code: 'HTTP_ERROR', message: 'Service indisponible.' } }, { status: res?.status || 502 });
  }
  const out = NextResponse.json({ staff: data.staff });
  setAdminCookies(out, data, newCsrfToken());
  return out;
}
