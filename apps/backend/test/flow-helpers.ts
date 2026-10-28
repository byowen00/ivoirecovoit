import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { PAYMENT_PROVIDER } from '../src/modules/payments/provider';
import type { SandboxPaymentProvider } from '../src/modules/payments/sandbox.provider';
import type { TripFixture } from './fixtures';
import { bearer, type LoggedIn, loginActive, type TestApp } from './test-app';

/** Parcours réels par l'API : réservation, paiement en bac à sable confirmé par webhook signé, fin de trajet. */
export function flows(t: TestApp, db: Client) {
  const sbx = () => t.app.get<SandboxPaymentProvider>(PAYMENT_PROVIDER);

  async function book(who: LoggedIn, trip: TripFixture, extra: Record<string, unknown> = {}): Promise<string> {
    const res = await t
      .http()
      .post('/api/v1/bookings')
      .set(bearer(who.accessToken))
      .set('Idempotency-Key', randomUUID())
      .send({ tripId: trip.tripId, pickupStopId: trip.stopIds[0], dropoffStopId: trip.stopIds[2], seats: 1, acceptCancellationPolicy: true, ...extra })
      .expect(201);
    return res.body.id;
  }

  async function pay(who: LoggedIn, bookingId: string): Promise<void> {
    const res = await t
      .http()
      .post(`/api/v1/bookings/${bookingId}/payments`)
      .set(bearer(who.accessToken))
      .set('Idempotency-Key', randomUUID())
      .send({ method: 'WAVE', payerPhone: '0707070707' })
      .expect(201);
    const { rows } = await db.query<{ provider_reference: string }>(`SELECT provider_reference FROM payments WHERE id = $1`, [res.body.id]);
    const ref = rows[0]!.provider_reference;
    await sbx().settle(ref, 'SUCCEEDED');
    const hook = sbx().buildWebhook({ providerReference: ref, merchantReference: res.body.id, status: 'SUCCEEDED', amountXof: res.body.amountXof });
    await t.http().post('/api/v1/webhooks/payments/sandbox').set(hook.headers).send(hook.rawBody.toString('utf8')).expect(200);
  }

  async function paidBooking(who: LoggedIn, trip: TripFixture, extra: Record<string, unknown> = {}): Promise<string> {
    const id = await book(who, trip, extra);
    await pay(who, id);
    return id;
  }

  /** Le conducteur du trajet devient un compte connecté (le trajet de test est créé en base). */
  async function driverSession(trip: TripFixture): Promise<LoggedIn> {
    const s = await loginActive(t);
    await db.query(`INSERT INTO driver_profiles (user_id, verification_status, verification_level) VALUES ($1, 'APPROVED', 1)`, [s.userId]);
    await db.query(`UPDATE vehicles SET driver_id = $1 WHERE id = $2`, [s.userId, trip.vehicleId]);
    await db.query(`UPDATE trips SET driver_id = $1 WHERE id = $2`, [s.userId, trip.tripId]);
    return s;
  }

  /** Trajet terminé il y a `hoursAgo` heures (départ et arrivée déplacés dans le passé). */
  async function completeTrip(trip: TripFixture, hoursAgo = 1): Promise<void> {
    await db.query(
      `UPDATE trips SET departure_at = now() - make_interval(hours => $2 + 3), estimated_arrival_at = now() - make_interval(hours => $2),
                        started_at = now() - make_interval(hours => $2 + 3), status = 'IN_PROGRESS'
       WHERE id = $1`,
      [trip.tripId, hoursAgo],
    );
    await db.query(`UPDATE trips SET completed_at = now() - make_interval(hours => $2), status = 'COMPLETED' WHERE id = $1`, [trip.tripId, hoursAgo]);
    await db.query(`UPDATE bookings SET status = 'COMPLETED', completed_at = now() - make_interval(hours => $2) WHERE trip_id = $1 AND status = 'CONFIRMED'`,
                   [trip.tripId, hoursAgo]);
  }

  /** Traite toute la file d'événements (les tests ne lancent pas les tâches planifiées). */
  async function dispatch(): Promise<void> {
    const n = t.app.get(NotificationsService);
    for (;;) {
      await n.dispatchOutbox(500);
      const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM outbox_events WHERE published_at IS NULL`);
      if (rows[0]!.n === 0) return;
    }
  }

  return { book, pay, paidBooking, driverSession, completeTrip, dispatch };
}
