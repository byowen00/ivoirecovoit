import type { ReviewCriteriaAvg } from '../../database/types';

/**
 * Classement d'un conducteur à partir des avis publiés (note générale et notes de conduite) :
 * « Excellent conducteur », « Très bon conducteur », ou rien tant qu'il n'y a pas assez d'avis.
 */
export type DriverBadge = 'EXCELLENT' | 'TRES_BON' | null;

export const DRIVER_BADGE_LABEL: Record<Exclude<DriverBadge, null>, string> = {
  EXCELLENT: 'Excellent conducteur',
  TRES_BON: 'Très bon conducteur',
};

export function driverBadge(ratingAvg: number | string | null, ratingCount: number, criteria: ReviewCriteriaAvg | null): DriverBadge {
  if (ratingAvg === null || ratingCount < 3) return null;
  const avg = Number(ratingAvg);
  // La conduite compte double : c'est ce qui distingue un bon conducteur d'un trajet seulement agréable.
  const driving = criteria?.driving ?? avg;
  if (ratingCount >= 5 && avg >= 4.7 && driving >= 4.7) return 'EXCELLENT';
  if (avg >= 4.3 && driving >= 4.3) return 'TRES_BON';
  return null;
}
