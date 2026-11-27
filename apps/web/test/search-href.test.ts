import { resultsHref } from '@/components/SearchForm';

describe('lien de recherche', () => {
  const from = { id: 'a', label: 'Abidjan' };
  const to = { id: 'b', label: 'Yamoussoukro' };

  it('garde le menu choisi (interurbain ou en ville)', () => {
    expect(new URL(resultsHref(from, to, '2026-12-01', 1, undefined, 'INTERCITY'), 'http://x').searchParams.get('kind')).toBe('INTERCITY');
    expect(new URL(resultsHref(from, to, '2026-12-01', 1, undefined, 'URBAN'), 'http://x').searchParams.get('kind')).toBe('URBAN');
  });

  it('« Tous » : pas de filtre', () => {
    expect(new URL(resultsHref(from, to, '2026-12-01', 1), 'http://x').searchParams.has('kind')).toBe(false);
  });
});
