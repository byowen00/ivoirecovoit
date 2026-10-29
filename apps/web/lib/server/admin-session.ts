import 'server-only';
import type { NextResponse } from 'next/server';
import type { TokenPair } from './session';

/*
 * Session du personnel, séparée de celle des utilisateurs : autres cookies (HttpOnly, limités à /bff/admin),
 * autre jeton CSRF. Une déconnexion côté utilisateur ne ferme pas la console, et inversement.
 * La session du personnel expire au bout de 12 h quoi qu'il arrive (règle de l'API).
 */
export const ADMIN_ACCESS_COOKIE = 'ic_admin_access';
export const ADMIN_REFRESH_COOKIE = 'ic_admin_session';
export const ADMIN_CSRF_COOKIE = 'ic_admin_csrf';
/** Présence d'une session du personnel (aucun secret), lue par les pages /admin. */
export const ADMIN_SIGNED_IN_COOKIE = 'ic_admin_signed_in';

const secure = process.env.NODE_ENV === 'production';
const MAX_AGE_S = 12 * 3600;

export function setAdminCookies(res: NextResponse, tokens: TokenPair, csrf?: string): void {
  const base = { httpOnly: true, secure, sameSite: 'strict' as const, path: '/bff/admin' };
  res.cookies.set(ADMIN_ACCESS_COOKIE, tokens.accessToken, { ...base, maxAge: tokens.accessTokenExpiresInS });
  res.cookies.set(ADMIN_REFRESH_COOKIE, tokens.refreshToken, { ...base, maxAge: MAX_AGE_S });
  res.cookies.set(ADMIN_SIGNED_IN_COOKIE, '1', { httpOnly: true, secure, sameSite: 'strict', path: '/admin', maxAge: MAX_AGE_S });
  if (csrf !== undefined) res.cookies.set(ADMIN_CSRF_COOKIE, csrf, { httpOnly: false, secure, sameSite: 'strict', path: '/', maxAge: MAX_AGE_S });
}

export function clearAdminCookies(res: NextResponse): void {
  for (const [name, path] of [
    [ADMIN_ACCESS_COOKIE, '/bff/admin'],
    [ADMIN_REFRESH_COOKIE, '/bff/admin'],
    [ADMIN_SIGNED_IN_COOKIE, '/admin'],
    [ADMIN_CSRF_COOKIE, '/'],
  ] as const) {
    // Mêmes attributs qu'à la création : un cookie effacé ne doit pas repartir sans HttpOnly, Secure ni SameSite.
    res.cookies.set(name, '', { path, maxAge: 0, httpOnly: name !== ADMIN_CSRF_COOKIE, secure, sameSite: 'strict' });
  }
}
