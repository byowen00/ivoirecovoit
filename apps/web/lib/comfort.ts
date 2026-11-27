/** Gammes de véhicule et classement des conducteurs (mêmes codes que l'API). */
export type ComfortClass = 'ECONOMIQUE' | 'CONFORT' | 'LUXE';

export const COMFORT: Record<ComfortClass, { label: string; icon: string; hint: string }> = {
  ECONOMIQUE: { label: 'Économique', icon: '🚗', hint: 'Voiture simple, sans confort particulier : le prix le plus bas.' },
  CONFORT: { label: 'Confort', icon: '🚙', hint: 'Voiture confortable et bien entretenue, sièges spacieux.' },
  LUXE: { label: 'Luxe', icon: '✨', hint: 'Voiture haut de gamme.' },
};
export const COMFORT_CLASSES = Object.keys(COMFORT) as ComfortClass[];

export type DriverBadge = 'EXCELLENT' | 'TRES_BON' | null;
export const BADGE_LABEL: Record<'EXCELLENT' | 'TRES_BON', string> = {
  EXCELLENT: '🏆 Excellent conducteur',
  TRES_BON: '⭐ Très bon conducteur',
};

/** Critères notés par le passager en fin de trajet. */
export const REVIEW_CRITERIA = [
  { key: 'driving', label: 'Conduite (prudence, respect du code)' },
  { key: 'punctuality', label: 'Ponctualité' },
  { key: 'comfort', label: 'Confort et propreté du véhicule' },
  { key: 'courtesy', label: 'Amabilité' },
] as const;
export type ReviewCriteria = Record<(typeof REVIEW_CRITERIA)[number]['key'], number>;
