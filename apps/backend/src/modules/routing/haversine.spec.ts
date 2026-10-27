import { fallbackEstimate, haversineMeters } from './haversine';

describe('haversine', () => {
  it('donne 0 pour deux points identiques', () => {
    expect(haversineMeters({ lat: 5.36, lng: -4.0 }, { lat: 5.36, lng: -4.0 })).toBe(0);
  });

  it('donne environ 111 km pour un degré de latitude', () => {
    const d = haversineMeters({ lat: 5, lng: -4 }, { lat: 6, lng: -4 });
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });

  it('cumule les segments et applique coefficient et vitesse de repli', () => {
    const points = [
      { lat: 5, lng: -4 },
      { lat: 6, lng: -4 },
    ];
    const est = fallbackEstimate(points, 'INTERCITY');
    expect(est.source).toBe('HAVERSINE_FALLBACK');
    expect(est.distanceM).toBe(Math.round(haversineMeters(points[0]!, points[1]!) * 1.3));
    expect(est.durationS).toBe(Math.round((est.distanceM / 1000 / 70) * 3600));
  });
});
