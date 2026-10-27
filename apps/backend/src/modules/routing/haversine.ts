export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_008.8;

/** Distance orthodromique (à vol d'oiseau) en mètres. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

// Coefficient route / vol d'oiseau et vitesses moyennes : hypothèses de repli, pas des mesures.
export const FALLBACK_ROAD_FACTOR = 1.3;
export const FALLBACK_SPEED_KMH = { URBAN: 25, INTERCITY: 70 } as const;

/**
 * Estimation de repli quand le moteur de routage est indisponible.
 * Le résultat doit toujours être présenté comme une « estimation approximative ».
 */
export function fallbackEstimate(
  points: LatLng[],
  kind: keyof typeof FALLBACK_SPEED_KMH,
): { distanceM: number; durationS: number; source: 'HAVERSINE_FALLBACK' } {
  let straight = 0;
  for (let i = 1; i < points.length; i++) straight += haversineMeters(points[i - 1]!, points[i]!);
  const distanceM = Math.round(straight * FALLBACK_ROAD_FACTOR);
  const durationS = Math.round((distanceM / 1000 / FALLBACK_SPEED_KMH[kind]) * 3600);
  return { distanceM, durationS, source: 'HAVERSINE_FALLBACK' };
}
