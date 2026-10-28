import { checkStopPrices, roundToStep, suggestFullPrice, suggestStopPrices } from './pricing';

const bounds = { minXof: 500, maxXof: 30000, capXofPerKm: null };

describe('Prix des segments', () => {
  it('arrondit à 50 FCFA', () => {
    expect(roundToStep(2974)).toBe(2950);
    expect(roundToStep(2975)).toBe(3000);
    expect(roundToStep(0)).toBe(0);
  });

  it('répartit le prix complet au prorata des distances, le dernier arrêt valant le prix complet', () => {
    // Abidjan -> Toumodi (≈ 180 km) -> Yamoussoukro (≈ 60 km)
    expect(suggestStopPrices([180_000, 60_000], 5000)).toEqual([0, 3750, 5000]);
    const p = suggestStopPrices([10_000, 10_000, 10_000], 3000);
    expect(p).toEqual([0, 1000, 2000, 3000]);
    expect(p.every((x) => x % 50 === 0)).toBe(true);
  });

  it('ne rend jamais un tronçon gratuit malgré l’arrondi', () => {
    const p = suggestStopPrices([100, 100_000], 5000);
    expect(p[1]).toBeGreaterThan(0);
    expect(p[2]).toBe(5000);
  });

  it('suggère un prix complet borné', () => {
    expect(suggestFullPrice(240_000, 20, bounds)).toBe(4800);
    expect(suggestFullPrice(5_000, 20, bounds)).toBe(500); // plancher
    expect(suggestFullPrice(3_000_000, 20, bounds)).toBe(30000); // plafond
  });

  it('accepte des prix cumulés valides', () => {
    expect(checkStopPrices([0, 3000, 5000], [180_000, 60_000], bounds)).toEqual([]);
  });

  it('refuse les montants non multiples de 50, une origine non nulle, des prix non croissants', () => {
    expect(checkStopPrices([0, 3010, 5000], [1, 1], bounds)).toEqual([{ code: 'NOT_MULTIPLE_OF_50', index: 1 }]);
    expect(checkStopPrices([100, 3000], [1], bounds)).toEqual([{ code: 'ORIGIN_NOT_ZERO' }]);
    expect(checkStopPrices([0, 3000, 3000], [1, 1], bounds)).toEqual([{ code: 'NOT_INCREASING', index: 2 }]);
  });

  it('vérifie chaque segment réservable contre le minimum et le prix complet contre le maximum', () => {
    expect(checkStopPrices([0, 300, 5000], [1, 1], bounds)).toEqual([{ code: 'BELOW_MIN', from: 0, to: 1, priceXof: 300 }]);
    expect(checkStopPrices([0, 30050], [1], bounds)).toEqual([{ code: 'ABOVE_MAX', priceXof: 30050 }]);
  });

  it('applique le plafond par km seulement s’il est fixé', () => {
    const capped = { ...bounds, capXofPerKm: 25 };
    // 100 km -> 2 500 FCFA au plus
    expect(checkStopPrices([0, 2500], [100_000], capped)).toEqual([]);
    expect(checkStopPrices([0, 2550], [100_000], capped)).toEqual([{ code: 'ABOVE_KM_CAP', from: 0, to: 1, priceXof: 2550, capXof: 2500 }]);
    expect(checkStopPrices([0, 2550], [100_000], bounds)).toEqual([]);
  });
});
