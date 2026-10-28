import { z } from 'zod';

/** Emprise large de la Côte d'Ivoire : un point en dehors est presque toujours une erreur de saisie. */
export const CI_BOUNDS = { minLat: 4.0, maxLat: 11.0, minLng: -8.8, maxLng: -2.3 } as const;

export const latitude = z.number().min(CI_BOUNDS.minLat, 'Point hors de Côte d’Ivoire.').max(CI_BOUNDS.maxLat, 'Point hors de Côte d’Ivoire.');
export const longitude = z.number().min(CI_BOUNDS.minLng, 'Point hors de Côte d’Ivoire.').max(CI_BOUNDS.maxLng, 'Point hors de Côte d’Ivoire.');

/** Coordonnées arrondies pour les visiteurs (environ 100 m). */
export function roundCoord(n: number, decimals = 3): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}
