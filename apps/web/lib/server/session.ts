import 'server-only';
import { randomBytes } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';

/*
 * BFF (backend for frontend) : le navigateur ne voit jamais les jetons. Le refresh token et le jeton d'accès
 * sont dans des cookies HttpOnly limités au chemin /bff ; un cookie lisible ic_csrf sert à la protection CSRF
 * par double soumission (en-tête X-CSRF-Token obligatoire sur les requêtes qui modifient des données).
 */

export const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:3000';
export const ACCESS_COOKIE = 'ic_access';
export const REFRESH_COOKIE = 'ic_session';
export const CSRF_COOKIE = 'ic_csrf';
/** Indique seulement « une session existe » au rendu serveur ; ne contient aucun secret. */
export const SIGNED_IN_COOKIE = 'ic_signed_in';

const secure = process.env.NODE_ENV === 'production';
const REFRESH_MAX_AGE_S = 30 * 86_400;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresInS: number;
}

export function setSessionCookies(res: NextResponse, tokens: TokenPair, csrf?: string): void {
  const base = { httpOnly: true, secure, sameSite: 'lax' as const, path: '/bff' };
  res.cookies.set(ACCESS_COOKIE, tokens.accessToken, { ...base, maxAge: tokens.accessTokenExpiresInS });
  res.cookies.set(REFRESH_COOKIE, tokens.refreshToken, { ...base, maxAge: REFRESH_MAX_AGE_S });
  res.cookies.set(SIGNED_IN_COOKIE, '1', { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: REFRESH_MAX_AGE_S });
  if (csrf !== undefined) {
    res.cookies.set(CSRF_COOKIE, csrf, { httpOnly: false, secure, sameSite: 'strict', path: '/', maxAge: REFRESH_MAX_AGE_S });
  }
}

export function clearSessionCookies(res: NextResponse): void {
  for (const [name, path] of [
    [ACCESS_COOKIE, '/bff'],
    [REFRESH_COOKIE, '/bff'],
    [SIGNED_IN_COOKIE, '/'],
    [CSRF_COOKIE, '/'],
  ] as const) {
    res.cookies.set(name, '', { path, maxAge: 0 });
  }
}

export function newCsrfToken(): string {
  return randomBytes(24).toString('base64url');
}

export function csrfValid(req: NextRequest, cookieName: string = CSRF_COOKIE): boolean {
  const cookie = req.cookies.get(cookieName)?.value;
  const header = req.headers.get('x-csrf-token');
  return !!cookie && cookie.length >= 20 && cookie === header;
}

/** En-têtes transmis à l'API : IP réelle du visiteur (limitation des abus) et identifiant de corrélation. */
export function forwardHeaders(req: NextRequest): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (ip) headers['X-Forwarded-For'] = ip;
  const ua = req.headers.get('user-agent');
  if (ua) headers['User-Agent'] = ua;
  return headers;
}

/*
 * Un même refresh token ne doit être présenté qu'une fois à l'API (sinon elle détecte un rejeu et ferme la session).
 * Quand plusieurs requêtes du même navigateur arrivent avec un jeton d'accès expiré, elles partagent le même
 * renouvellement ; le résultat reste disponible quelques secondes pour les retardataires.
 */
const inflight = new Map<string, Promise<TokenPair | null>>();

export function refreshOnce(req: NextRequest, refreshToken: string): Promise<TokenPair | null> {
  const existing = inflight.get(refreshToken);
  if (existing) return existing;
  const promise = (async () => {
    try {
      const res = await fetch(`${API_INTERNAL_URL}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: forwardHeaders(req),
        body: JSON.stringify({ refreshToken }),
        cache: 'no-store',
      });
      return res.ok ? ((await res.json()) as TokenPair) : null;
    } catch {
      return null;
    }
  })();
  inflight.set(refreshToken, promise);
  setTimeout(() => inflight.delete(refreshToken), 15_000).unref?.();
  return promise;
}
