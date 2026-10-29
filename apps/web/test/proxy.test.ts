// @vitest-environment node
import { NextRequest } from 'next/server';
import { proxy, tileOrigin } from '@/proxy';

describe('proxy : politique de sécurité du contenu', () => {
  it('pose une CSP à nonce, différente à chaque requête, sans script en ligne autorisé', () => {
    const a = proxy(new NextRequest('http://localhost:3001/recherche')).headers.get('content-security-policy')!;
    const b = proxy(new NextRequest('http://localhost:3001/recherche')).headers.get('content-security-policy')!;
    const nonce = /'nonce-([^']+)'/.exec(a)?.[1];
    expect(nonce).toBeTruthy();
    expect(a).not.toBe(b);
    const scriptSrc = a.split('; ').find((d) => d.startsWith('script-src'))!;
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(a).toContain("frame-ancestors 'none'");
    expect(a).toContain("object-src 'none'");
  });

  it('transmet le nonce et le chemin au rendu', () => {
    const res = proxy(new NextRequest('http://localhost:3001/admin/paiements'));
    expect(res.headers.get('x-middleware-request-x-pathname')).toBe('/admin/paiements');
    const csp = res.headers.get('content-security-policy')!;
    expect(csp).toContain(`'nonce-${res.headers.get('x-middleware-request-x-nonce')}'`);
  });

  it('n’autorise les images externes que du fournisseur de tuiles', () => {
    const csp = proxy(new NextRequest('http://localhost:3001/')).headers.get('content-security-policy')!;
    expect(csp).toContain("img-src 'self' data: blob: https://tile.openstreetmap.org;");
    expect(tileOrigin('https://{s}.tiles.exemple.ci/{z}/{x}/{y}.png?key=abc')).toBe('https://*.tiles.exemple.ci');
  });
});
