import { HttpStatus } from '@nestjs/common';
import { ApiError } from '../../common/api-error';
import type { TripStatus } from '../../database/types';

/** Machine à états des trajets (doc 05 §1). Doublée par le trigger SQL trips_check_transition. */
export const TRIP_TRANSITIONS: Record<TripStatus, readonly TripStatus[]> = {
  DRAFT: ['PUBLISHED', 'CANCELLED'],
  PUBLISHED: ['FULL', 'IN_PROGRESS', 'CANCELLED'],
  FULL: ['PUBLISHED', 'IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransition(from: TripStatus, to: TripStatus): boolean {
  return TRIP_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: TripStatus, to: TripStatus): void {
  if (!canTransition(from, to)) {
    throw new ApiError(HttpStatus.CONFLICT, 'INVALID_STATE_TRANSITION', 'Cette action n’est pas possible dans l’état actuel du trajet.', {
      from,
      to,
    });
  }
}

/** Fenêtre de démarrage : de 60 min avant à 3 h après l'heure de départ prévue. */
export const START_WINDOW = { beforeMs: 60 * 60_000, afterMs: 3 * 3_600_000 } as const;
