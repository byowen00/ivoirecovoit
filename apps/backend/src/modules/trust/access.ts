import { HttpStatus } from '@nestjs/common';
import type { Transaction } from 'kysely';
import { ApiError } from '../../common/api-error';
import type { Db } from '../../database/database.module';
import type { Database } from '../../database/types';

export const bookingNotFound = () => new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Réservation introuvable.');
export const conflict = (code: string, message: string, details?: Record<string, unknown>) => new ApiError(HttpStatus.CONFLICT, code, message, details);
export const unprocessable = (code: string, message: string, details?: Record<string, unknown>) =>
  new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, code, message, details);

/**
 * Réservation vue par l'un de ses deux participants (passager ou conducteur du trajet) ; 404 pour tout autre
 * compte, sans rien révéler de son existence.
 */
export async function participantBooking(trx: Db | Transaction<Database>, userId: string, bookingId: string, lock = false) {
  let q = trx
    .selectFrom('bookings')
    .innerJoin('trips', 'trips.id', 'bookings.trip_id')
    .select([
      'bookings.id', 'bookings.reference', 'bookings.status', 'bookings.payment_status', 'bookings.passenger_id', 'bookings.trip_id',
      'bookings.cancelled_at', 'bookings.completed_at', 'bookings.total_xof', 'bookings.is_demo',
      'trips.driver_id', 'trips.status as trip_status', 'trips.departure_at', 'trips.estimated_arrival_at', 'trips.completed_at as trip_completed_at',
      'trips.cancelled_at as trip_cancelled_at', 'trips.vehicle_id',
    ])
    .where('bookings.id', '=', bookingId);
  if (lock) q = q.forUpdate();
  const b = await q.executeTakeFirst();
  if (!b || (b.passenger_id !== userId && b.driver_id !== userId)) throw bookingNotFound();
  const role = b.passenger_id === userId ? ('PASSENGER' as const) : ('DRIVER' as const);
  return { ...b, role, otherId: role === 'PASSENGER' ? b.driver_id : b.passenger_id };
}

export type ParticipantBooking = Awaited<ReturnType<typeof participantBooking>>;

/** Fin du trajet pour les délais d'avis et de réclamation : clôture réelle, sinon annulation, sinon arrivée prévue. */
export function tripEnd(b: Pick<ParticipantBooking, 'trip_completed_at' | 'trip_cancelled_at' | 'cancelled_at' | 'estimated_arrival_at'>): Date {
  return b.trip_completed_at ?? b.cancelled_at ?? b.trip_cancelled_at ?? b.estimated_arrival_at;
}
