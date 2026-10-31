import { send } from './account';

/** Dernière position partagée par le conducteur pendant le trajet (jamais une donnée garantie). */
export interface LiveLocation {
  status: string;
  position: { lat: number; lng: number; accuracyM: number | null; heading: number | null; recordedAt: string } | null;
  ageS: number | null;
  stale: boolean;
}

export const live = {
  read: (tripId: string) => send<LiveLocation>(`/bff/api/trips/${tripId}/location`, 'GET'),
  share: (tripId: string, p: { lat: number; lng: number; accuracyM?: number; heading?: number }) =>
    send<{ recordedAt: string }>(`/bff/api/trips/${tripId}/location`, 'POST', p),
};

export function ageText(ageS: number): string {
  if (ageS < 60) return 'il y a moins d’une minute';
  const m = Math.round(ageS / 60);
  return `il y a ${m} min`;
}
