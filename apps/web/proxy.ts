import { type NextRequest, NextResponse } from 'next/server';

/**
 * Politique de sécurité du contenu à nonce : un nonce aléatoire par requête, que Next.js pose sur ses propres
 * scripts ; aucun script en ligne injecté ne peut s'exécuter. Les attributs style (React, carte) restent permis.
 * Passe aussi le chemin demandé au gabarit racine (en-tête public masqué dans la console).
 */
/** Origine du fournisseur de tuiles (même valeur que components/TripMap.tsx), « {s} » devenant « * ». */
export function tileOrigin(url = process.env.NEXT_PUBLIC_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'): string {
  const m = /^(https:\/\/[^/]+)/.exec(url.replace('{s}', '*'));
  return m ? m[1]! : '';
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isProd = process.env.NODE_ENV === 'production';
  // Origine du stockage des documents (dépôt direct depuis le navigateur par URL signée).
  const uploadOrigin = process.env.CSP_CONNECT_SRC ?? '';
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isProd ? '' : " 'unsafe-eval'"}`,
    // En développement, Next.js injecte des balises <style> sans nonce : 'unsafe-inline' (ignoré si un nonce est présent).
    isProd ? `style-src 'self' 'nonce-${nonce}'` : "style-src 'self' 'unsafe-inline'",
    "style-src-attr 'unsafe-inline'",
    // Tuiles de carte : seulement le fournisseur configuré (NEXT_PUBLIC_TILE_URL).
    `img-src 'self' data: blob: ${tileOrigin()}`,
    "font-src 'self' data:",
    `connect-src 'self'${uploadOrigin ? ` ${uploadOrigin}` : ''}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(isProd ? ['upgrade-insecure-requests'] : []),
  ].join('; ');

  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  headers.set('x-pathname', request.nextUrl.pathname);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|bff/|api/).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
