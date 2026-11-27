import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/server/session', () => ({ API_INTERNAL_URL: 'http://api.test' }));
const { themeCss } = await import('@/lib/appearance');

describe('apparence réglée par l’administration', () => {
  it('produit les variables CSS de la palette', () => {
    expect(themeCss({ brand: '#1d4ed8', night: '#0f172a' })).toBe(':root{--color-brand:#1d4ed8;--color-night:#0f172a;}');
  });
  it('ignore une couleur mal formée (pas d’injection CSS)', () => {
    expect(themeCss({ brand: 'red;}body{display:none' })).toBe('');
  });
});
