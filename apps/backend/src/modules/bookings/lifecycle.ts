import { sql, type Transaction } from 'kysely';
import type { BookingStatus, Database } from '../../database/types';
import { driverCancellation } from './amounts';

export const BLOCKING_STATUSES = ['PENDING_ACCEPTANCE', 'PENDING_PAYMENT', 'CONFIRMED'] as const satisfies readonly BookingStatus[];
export const PENDING_STATUSES = ['PENDING_ACCEPTANCE', 'PENDING_PAYMENT'] as const satisfies readonly BookingStatus[];

/** Auteur et motif repris par le trigger d'historique des réservations (booking_status_history). */
export async function setActor(trx: Transaction<Database>, actorId: string | null, reason?: string | null): Promise<void> {
  await sql`SELECT set_config('app.actor_id', ${actorId ?? ''}, true), set_config('app.reason', ${reason ?? ''}, true)`.execute(trx);
}

/** PUBLISHED <-> FULL selon l'occupation du segment le plus chargé (doc 05 §1). */
export async function syncTripFullStatus(trx: Transaction<Database>, tripId: string): Promise<void> {
  await sql`
    UPDATE trips t SET status = s.target::trip_status
      FROM (SELECT CASE WHEN trip_max_occupancy(x.id, 0, (SELECT max(st.seq) FROM trip_stops st WHERE st.trip_id = x.id)) >= x.seats_offered
                        THEN 'FULL' ELSE 'PUBLISHED' END AS target
              FROM trips x WHERE x.id = ${tripId}::uuid) s
     WHERE t.id = ${tripId}::uuid AND t.status IN ('PUBLISHED','FULL') AND t.status::text <> s.target`.execute(trx);
}

export async function outbox(trx: Transaction<Database>, aggregate: string, id: string, eventType: string, payload: Record<string, unknown>) {
  await trx
    .insertInto('outbox_events')
    .values({ aggregate, aggregate_id: id, event_type: eventType, payload: JSON.stringify(payload), published_at: null })
    .execute();
}

/**
 * Annule toutes les réservations actives d'un trajet annulé par le conducteur ou l'administration (doc 05 §7.2) :
 * remboursement intégral de ce qui a été payé (exécuté par la couche de paiement, étape 8), rien n'est dû au conducteur.
 * Le trajet doit être verrouillé par l'appelant. Renvoie le nombre de réservations annulées.
 */
export async function cancelTripBookings(
  trx: Transaction<Database>,
  tripId: string,
  actorId: string,
  reason: string,
  status: 'CANCELLED_BY_DRIVER' | 'CANCELLED_BY_ADMIN',
): Promise<{ cancelled: number; confirmed: number }> {
  const bookings = await trx
    .selectFrom('bookings')
    .select(['id', 'status', 'payment_status', 'subtotal_xof', 'service_fee_xof', 'total_xof', 'commission_xof', 'passenger_id'])
    .where('trip_id', '=', tripId)
    .where('status', 'in', BLOCKING_STATUSES)
    .forUpdate()
    .execute();
  await setActor(trx, actorId, reason);
  let confirmed = 0;
  for (const b of bookings) {
    const outcome = driverCancellation({
      paymentStatus: b.payment_status,
      amounts: { subtotalXof: b.subtotal_xof, serviceFeeXof: b.service_fee_xof, totalXof: b.total_xof, commissionXof: b.commission_xof },
    });
    if (b.status === 'CONFIRMED') confirmed++;
    await trx
      .updateTable('bookings')
      .set({
        status,
        cancelled_at: new Date(),
        cancelled_by: actorId,
        cancellation_reason: reason,
        refund_due_xof: outcome.refundXof,
        driver_compensation_xof: 0,
        ...(b.payment_status === 'PAID' ? { payment_status: 'REFUND_PENDING' as const } : {}),
      })
      .where('id', '=', b.id)
      .execute();
    await outbox(trx, 'booking', b.id, 'booking.cancelled', { by: status, passengerId: b.passenger_id, refundXof: outcome.refundXof });
    if (outcome.refundXof > 0) await outbox(trx, 'booking', b.id, 'refund.requested', { amountXof: outcome.refundXof, reason: 'DRIVER_CANCELLED' });
  }
  return { cancelled: bookings.length, confirmed };
}
