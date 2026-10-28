import { priceProblemText, routeSourceNote, searchQueryString } from '@/lib/trips';
import { checkFile, sha256Hex } from '@/lib/upload';

describe('paramètres de recherche', () => {
  it('omet les valeurs vides et les filtres désactivés', () => {
    const q = new URLSearchParams(searchQueryString({ fromPlaceId: 'a', toPlaceId: 'b', seats: 2, directOnly: false, date: '', maxPriceXof: 5000 }));
    expect(Object.fromEntries(q)).toEqual({ fromPlaceId: 'a', toPlaceId: 'b', seats: '2', maxPriceXof: '5000' });
    expect(searchQueryString({ fromPlaceId: 'a', toPlaceId: 'b', directOnly: true })).toContain('directOnly=true');
  });
});

describe('explication des problèmes de prix', () => {
  const labels = ['Abidjan', 'Toumodi', 'Yamoussoukro'];
  const bounds = { minXof: 500, maxXof: 30000 };
  it('nomme les arrêts concernés', () => {
    expect(priceProblemText({ code: 'NOT_INCREASING', index: 2 }, labels, bounds)).toContain('Yamoussoukro');
    expect(priceProblemText({ code: 'BELOW_MIN', from: 1, to: 2, priceXof: 300 }, labels, bounds)).toBe(
      'De Toumodi à Yamoussoukro : 300 FCFA, en dessous du minimum de 500 FCFA.',
    );
    expect(priceProblemText({ code: 'ABOVE_MAX', priceXof: 40000 }, labels, bounds)).toContain('30000');
  });
});

it('rappelle qu’une distance est une estimation', () => {
  expect(routeSourceNote('OSRM')).toMatch(/estimées/);
  expect(routeSourceNote('HAVERSINE_FALLBACK')).toMatch(/vol d’oiseau/);
});

describe('fichiers à déposer', () => {
  const file = (type: string, size: number) => new File([new Uint8Array(size)], 'f', { type });
  it('refuse un format ou une taille non acceptés avant tout envoi', () => {
    const types = ['image/jpeg', 'image/png'];
    expect(checkFile(file('image/png', 10), types, 100)).toBeNull();
    expect(checkFile(file('image/gif', 10), types, 100)).toMatch(/Format/);
    expect(checkFile(file('image/png', 200), types, 100)).toMatch(/trop lourd/);
    expect(checkFile(file('image/png', 0), types, 100)).toMatch(/vide/);
  });

  it('calcule l’empreinte SHA-256 vérifiée ensuite par le serveur', async () => {
    const hex = await sha256Hex(new TextEncoder().encode('abc').buffer as ArrayBuffer);
    expect(hex).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
