import type { NextConfig } from 'next';

// URL de l'API vue depuis le serveur Next.js (réseau interne en production).
const apiInternalUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:3000';

// La politique de sécurité du contenu (à nonce, donc par requête) est posée par proxy.ts.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  output: 'standalone',
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  // Le navigateur appelle /api/... sur le même domaine ; Next.js relaie vers l'API (pas de CORS côté client).
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiInternalUrl}/api/v1/:path*` }];
  },
};

export default nextConfig;
