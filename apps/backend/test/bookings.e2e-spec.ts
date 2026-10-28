import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { BookingsMaintenanceService } from '../src/modules/bookings/maintenance.service';
import { createTrip, ensureFeeRule, type TripFixture } from './fixtures';
import { bearer, createTestApp, type LoggedIn, loginActive, type TestApp } from './test-app';
import { connectTestDb } from './test-db';

const HOUR = 3_600_000;

describe('Réservations (doc 05 §2, §3, §7)', () => {
  let t: TestApp;
  let db: Client;
  let maintenance: BookingsMaintenanceService;
  let alice: LoggedIn;
  let bruno: LoggedIn;

  beforeAll(async () => {
    t = await createTestApp();
    db = await connectTestDb();
    maintenance = t.app.get(BookingsMaintenanceService);
    await ensureFeeRule(db);
    alice = await loginActive(t);
    bruno = await loginActive(t);
  });
  beforeEach(async () => {
    await t.redis.flushdb();
    // Chaque test part sans réservation en attente pour Alice et Bruno (limite de 3 en attente).
    await db.query(
      `UPDATE bookings SET status = 'EXPIRED' WHERE passenger_id = ANY($1) AND status IN ('PENDING_ACCEPTANCE','PENDING_PAYMENT')`,
      [[alice.userId, bruno.userId]],
    );
  });
  afterAll(async () => {
    await db.end();
    await t.app.close();
  });

  const body = (trip: TripFixture, extra: Record<string, unknown> = {}) => ({
    tripId: trip.tripId,
    pickupStopId: trip.stopIds[0],
    dropoffStopId: trip.stopIds[2],
    seats: 1,
    acceptCancellationPolicy: true,
    ...extra,
  });

  function book(who: LoggedIn, trip: TripFixture, extra: Record<string, unknown> = {}, key = randomUUID()) {
    return t.http().post('/api/v1/bookings').set(bearer(who.accessToken)).set('Idempotency-Key', key).send(body(trip, extra));
  }

  async function driverSession(trip: TripFixture): Promise<LoggedIn> {
    // Le conducteur du fixture est créé en SQL : on rattache une vraie session à un compte conducteur connecté.
    const s = await loginActive(t);
    await db.query(`INSERT INTO driver_profiles (user_id, verification_status, verification_level) VALUES ($1, 'APPROVED', 1)`, [s.userId]);
    await db.query(`UPDATE vehicles SET driver_id = $1 WHERE id = $2`, [s.userId, trip.vehicleId]);
    await db.query(`UPDATE trips SET driver_id = $1 WHERE id = $2`, [s.userId, trip.tripId]);
    return s;
  }

  async function occupancy(trip: TripFixture): Promise<number> {
    const { rows } = await db.query<{ occ: number }>(`SELECT trip_max_occupancy($1, 0, 2) AS occ`, [trip.tripId]);
    return rows[0]!.occ;
  }

  async function tripStatus(trip: TripFixture): Promise<string> {
    const { rows } = await db.query<{ status: string }>(`SELECT status FROM trips WHERE id = $1`, [trip.tripId]);
    return rows[0]!.status;
  }

  it('devis : montants du segment, politique d’annulation lisible, aucune place bloquée', async () => {
    const trip = await createTrip(db);
    const res = await t.http().post('/api/v1/bookings/quote').set(bearer(alice.accessToken))
      .send({ tripId: trip.tripId, pickupStopId: trip.stopIds[1], dropoffStopId: trip.stopIds[2], seats: 2 }).expect(200);
    // Toumodi -> Yamoussoukro : 5 000 - 3 000 = 2 000 par place ; frais 6 % (règle de démonstration)
    expect(res.body).toMatchObject({ unitPriceXof: 2000, subtotalXof: 4000, serviceFeeXof: 240, totalXof: 4240, seatsAvailable: 3, acceptanceMode: 'AUTO' });
    expect(res.body.cancellationPolicy.summary).toContain('100 % jusqu’à 24 h avant le départ');
    expect(await occupancy(trip)).toBe(0);
  });

  it('réservation instantanée : places bloquées 15 min, montants figés, historique', async () => {
    const trip = await createTrip(db);
    const res = await book(alice, trip, { seats: 2 }).expect(201);
    expect(res.body).toMatchObject({
      status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID', seats: 2, unitPriceXof: 5000, subtotalXof: 10000, serviceFeeXof: 600, totalXof: 10600,
      viewerRole: 'PASSENGER', actions: { canCancel: true, canPay: false },
    });
    expect(res.body.reference).toMatch(/^IC-[A-HJ-NP-Z2-9]{6}$/);
    expect(res.body).not.toHaveProperty('commissionXof');
    const hold = new Date(res.body.holdExpiresAt).getTime() - Date.now();
    expect(hold).toBeGreaterThan(14 * 60_000);
    expect(hold).toBeLessThanOrEqual(15 * 60_000);
    expect(res.body.history).toEqual([expect.objectContaining({ from: null, to: 'PENDING_PAYMENT', by: 'PASSENGER' })]);
    expect(res.body.trip.vehicle.plateNumber).toBeNull();
    expect(await occupancy(trip)).toBe(2);
    // Une hausse de prix ultérieure ne change pas la réservation.
    await db.query(`UPDATE trip_stops SET price_from_origin_xof = 9000 WHERE id = $1`, [trip.stopIds[2]]);
    const again = await t.http().get(`/api/v1/bookings/${res.body.id}`).set(bearer(alice.accessToken)).expect(200);
    expect(again.body.totalXof).toBe(10600);
  });

  it('idempotence : même clé, même réponse et une seule réservation ; même clé, autre requête : 422', async () => {
    const trip = await createTrip(db);
    const key = randomUUID();
    const a = await book(alice, trip, {}, key).expect(201);
    const b = await book(alice, trip, {}, key).expect(201);
    expect(b.body.id).toBe(a.body.id);
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM bookings WHERE trip_id = $1`, [trip.tripId]);
    expect(rows[0].n).toBe(1);
    const other = await book(alice, trip, { seats: 2 }, key).expect(422);
    expect(other.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect((await book(alice, trip)).status).toBe(409); // ALREADY_BOOKED avec une nouvelle clé
  });

  it('refus : son propre trajet, segment à l’envers, trop de places, départ trop proche, trajet non publié, conditions non acceptées', async () => {
    const trip = await createTrip(db);
    const driver = await driverSession(trip);
    expect((await book(driver, trip)).body.error.code).toBe('OWN_TRIP');
    expect((await book(alice, trip, { pickupStopId: trip.stopIds[2], dropoffStopId: trip.stopIds[0] })).body.error.code).toBe('INVALID_SEGMENT');
    expect((await book(alice, trip, { seats: 4 })).body.error.code).toBe('TOO_MANY_SEATS');
    expect((await book(alice, trip, { acceptCancellationPolicy: false })).status).toBe(400);
    const soon = await createTrip(db, { departure: new Date(Date.now() + 20 * 60_000) });
    expect((await book(alice, soon)).body.error.code).toBe('TOO_CLOSE_TO_DEPARTURE');
    const draft = await createTrip(db, { status: 'DRAFT' });
    expect((await book(alice, draft)).status).toBe(404);
  });

  it('au plus 3 réservations en attente par passager', async () => {
    for (let i = 0; i < 3; i++) await book(bruno, await createTrip(db)).expect(201);
    const res = await book(bruno, await createTrip(db)).expect(422);
    expect(res.body.error.code).toBe('TOO_MANY_PENDING');
  });

  it('T1 : deux passagers, une dernière place, 50 répétitions : exactement un 201 et un 409', async () => {
    const filler = await loginActive(t);
    for (let i = 0; i < 50; i++) {
      await t.redis.flushdb();
      const trip = await createTrip(db);
      // 2 places sur 3 déjà occupées
      await book(filler, trip, { seats: 2 }).expect(201);
      const [a, b] = await Promise.all([book(alice, trip), book(bruno, trip)]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect([a, b].find((r) => r.status === 409)!.body.error.code).toBe('SEATS_UNAVAILABLE');
      expect(await occupancy(trip)).toBe(3);
      expect(await tripStatus(trip)).toBe('FULL');
      const { rows } = await db.query(`SELECT count(*)::int AS n FROM bookings WHERE trip_id = $1`, [trip.tripId]);
      expect(rows[0].n).toBe(2); // aucune ligne orpheline
      await db.query(`UPDATE bookings SET status = 'EXPIRED' WHERE trip_id = $1 AND status = 'PENDING_PAYMENT'`, [trip.tripId]);
    }
  });

  it('T1b : 10 passagers simultanés, places mixtes (1 et 2) sur 3 places : jamais de survente', async () => {
    const trip = await createTrip(db);
    const passengers = await Promise.all(Array.from({ length: 10 }, () => loginActive(t)));
    await t.redis.flushdb();
    const results = await Promise.all(passengers.map((p, i) => book(p, trip, { seats: i % 2 ? 2 : 1 })));
    const ok = results.filter((r) => r.status === 201);
    expect(results.every((r) => r.status === 201 || (r.status === 409 && r.body.error.code === 'SEATS_UNAVAILABLE'))).toBe(true);
    const reserved = ok.reduce((s, r) => s + r.body.seats, 0);
    expect(reserved).toBeLessThanOrEqual(3);
    expect(await occupancy(trip)).toBe(reserved);
    const { rows } = await db.query<{ seats: number }>(
      `SELECT coalesce(sum(seats), 0)::int AS seats FROM bookings WHERE trip_id = $1 AND status IN ('PENDING_PAYMENT','CONFIRMED')`,
      [trip.tripId],
    );
    expect(rows[0]!.seats).toBe(reserved);
  });

  it('T1c : segments disjoints sur la dernière place : A et B passent, C sur le trajet complet échoue', async () => {
    const trip = await createTrip(db, { seats: 1 });
    const carol = await loginActive(t);
    await book(alice, trip, { pickupStopId: trip.stopIds[0], dropoffStopId: trip.stopIds[1] }).expect(201);
    await book(bruno, trip, { pickupStopId: trip.stopIds[1], dropoffStopId: trip.stopIds[2] }).expect(201);
    const c = await book(carol, trip).expect(409);
    expect(c.body.error).toMatchObject({ code: 'SEATS_UNAVAILABLE', details: { seatsAvailable: 0 } });
    expect(await tripStatus(trip)).toBe('FULL');
  });

  it('expiration du blocage : places ignorées dès l’échéance, puis réservation EXPIRED par la tâche', async () => {
    const trip = await createTrip(db, { seats: 1 });
    const a = await book(alice, trip).expect(201);
    expect(await tripStatus(trip)).toBe('FULL');
    await db.query(`UPDATE bookings SET hold_expires_at = now() - interval '1 second' WHERE id = $1`, [a.body.id]);
    // Avant même le passage de la tâche, la place est de nouveau proposée.
    expect(await occupancy(trip)).toBe(0);
    expect(await maintenance.expireHolds()).toBeGreaterThanOrEqual(1);
    const after = await t.http().get(`/api/v1/bookings/${a.body.id}`).set(bearer(alice.accessToken)).expect(200);
    expect(after.body).toMatchObject({ status: 'EXPIRED', actions: { canCancel: false } });
    expect(after.body.history.at(-1)).toMatchObject({ to: 'EXPIRED', by: 'SYSTEM', reason: 'Délai dépassé' });
    expect(await tripStatus(trip)).toBe('PUBLISHED');
    await book(bruno, trip).expect(201);
  });

  describe('mode sur acceptation', () => {
    it('acceptation : demande bloquée jusqu’à l’échéance, puis 15 min pour payer', async () => {
      const trip = await createTrip(db, { acceptanceMode: 'MANUAL' });
      const driver = await driverSession(trip);
      const req = await book(alice, trip).expect(201);
      expect(req.body.status).toBe('PENDING_ACCEPTANCE');
      const deadline = new Date(req.body.acceptanceDeadline).getTime();
      expect(deadline).toBeLessThanOrEqual(Date.now() + 12 * HOUR);
      expect(req.body.holdExpiresAt).toBe(req.body.acceptanceDeadline);
      // Le passager ne peut pas accepter sa propre demande ; un tiers ne la voit pas.
      expect((await t.http().post(`/api/v1/bookings/${req.body.id}/accept`).set(bearer(alice.accessToken))).status).toBe(404);
      const manage = await t.http().get(`/api/v1/trips/${trip.tripId}/manage`).set(bearer(driver.accessToken)).expect(200);
      expect(manage.body.bookings[0]).toMatchObject({ status: 'PENDING_ACCEPTANCE', actions: { canAccept: true, canReject: true } });
      const ok = await t.http().post(`/api/v1/bookings/${req.body.id}/accept`).set(bearer(driver.accessToken)).expect(200);
      expect(ok.body).toMatchObject({ status: 'PENDING_PAYMENT', viewerRole: 'DRIVER', commissionXof: 500, driverNetXof: 4500 });
      expect(new Date(ok.body.holdExpiresAt).getTime() - Date.now()).toBeLessThanOrEqual(15 * 60_000);
      const twice = await t.http().post(`/api/v1/bookings/${req.body.id}/accept`).set(bearer(driver.accessToken)).expect(409);
      expect(twice.body.error.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('refus : places libérées, motif conservé', async () => {
      const trip = await createTrip(db, { acceptanceMode: 'MANUAL', seats: 1 });
      const driver = await driverSession(trip);
      const req = await book(alice, trip).expect(201);
      expect(await tripStatus(trip)).toBe('FULL');
      await t.http().post(`/api/v1/bookings/${req.body.id}/reject`).set(bearer(driver.accessToken)).send({ reason: 'Bagages trop volumineux' }).expect(200);
      const seen = await t.http().get(`/api/v1/bookings/${req.body.id}`).set(bearer(alice.accessToken)).expect(200);
      expect(seen.body).toMatchObject({ status: 'REJECTED', cancellationReason: 'Bagages trop volumineux' });
      expect(await tripStatus(trip)).toBe('PUBLISHED');
    });

    it('sans réponse avant l’échéance : la demande expire, l’acceptation tardive est refusée', async () => {
      const trip = await createTrip(db, { acceptanceMode: 'MANUAL' });
      const driver = await driverSession(trip);
      const req = await book(alice, trip).expect(201);
      await db.query(`UPDATE bookings SET hold_expires_at = now() - interval '1 minute', acceptance_deadline = now() - interval '1 minute' WHERE id = $1`, [req.body.id]);
      const late = await t.http().post(`/api/v1/bookings/${req.body.id}/accept`).set(bearer(driver.accessToken)).expect(409);
      expect(late.body.error.code).toBe('BOOKING_EXPIRED');
      const seen = await t.http().get(`/api/v1/bookings/${req.body.id}`).set(bearer(alice.accessToken)).expect(200);
      expect(seen.body.status).toBe('EXPIRED');
    });

    it('moins de 3 h avant le départ : demande impossible', async () => {
      const trip = await createTrip(db, { acceptanceMode: 'MANUAL', departure: new Date(Date.now() + 2 * HOUR) });
      expect((await book(alice, trip)).body.error.code).toBe('MANUAL_TOO_LATE');
    });
  });

  describe('annulation', () => {
    function cancel(who: LoggedIn, id: string, reason = 'Changement de programme') {
      return t.http().post(`/api/v1/bookings/${id}/cancel`).set(bearer(who.accessToken)).set('Idempotency-Key', randomUUID()).send({ reason });
    }

    async function paidBooking(who: LoggedIn, trip: TripFixture, confirmedHoursAgo = 2): Promise<string> {
      // Le paiement réel arrive à l'étape 8 : état « payé » posé en SQL pour tester les règles de remboursement.
      const res = await book(who, trip).expect(201);
      await db.query(
        `UPDATE bookings SET status = 'CONFIRMED', payment_status = 'PAID', confirmed_at = now() - make_interval(hours => $2) WHERE id = $1`,
        [res.body.id, confirmedHoursAgo],
      );
      return res.body.id;
    }

    it('réservation non payée : annulée sans frais, places libérées', async () => {
      const trip = await createTrip(db, { seats: 1 });
      const a = await book(alice, trip).expect(201);
      const preview = await t.http().post(`/api/v1/bookings/${a.body.id}/cancel/preview`).set(bearer(alice.accessToken)).expect(200);
      expect(preview.body).toMatchObject({ refundXof: 0, driverCompensationXof: 0, basis: 'NOTHING_PAID' });
      const res = await cancel(alice, a.body.id).expect(200);
      expect(res.body.booking).toMatchObject({ status: 'CANCELLED_BY_PASSENGER', refundDueXof: 0 });
      expect(await tripStatus(trip)).toBe('PUBLISHED');
      expect((await cancel(alice, a.body.id)).status).toBe(409);
    });

    it('payée, plus de 24 h avant le départ (STANDARD) : part trajet rendue, frais de service conservés', async () => {
      const trip = await createTrip(db);
      const id = await paidBooking(alice, trip);
      const preview = await t.http().post(`/api/v1/bookings/${id}/cancel/preview`).set(bearer(alice.accessToken)).expect(200);
      expect(preview.body).toMatchObject({ refundXof: 5000, serviceFeeRefundXof: 0, driverCompensationXof: 0, refundPercent: 100 });
      const res = await cancel(alice, id).expect(200);
      expect(res.body.booking).toMatchObject({ status: 'CANCELLED_BY_PASSENGER', paymentStatus: 'REFUND_PENDING', refundDueXof: 5000 });
      const { rows } = await db.query(`SELECT event_type, payload FROM outbox_events WHERE aggregate_id = $1 ORDER BY id`, [id]);
      expect(rows.map((r) => r.event_type)).toEqual(expect.arrayContaining(['booking.cancelled', 'refund.requested']));
    });

    it('payée, entre 24 h et 2 h : 50 %, le reste revient au conducteur commission déduite', async () => {
      const trip = await createTrip(db, { departure: new Date(Date.now() + 10 * HOUR) });
      const id = await paidBooking(alice, trip);
      const res = await cancel(alice, id).expect(200);
      expect(res.body.refund).toMatchObject({ refundXof: 2500, driverCompensationXof: 2250, refundPercent: 50 });
    });

    it('horaire décalé de plus de 30 min : annulation sans frais', async () => {
      const trip = await createTrip(db, { departure: new Date(Date.now() + 10 * HOUR) });
      const id = await paidBooking(alice, trip);
      await db.query(`UPDATE bookings SET free_cancellation = true WHERE id = $1`, [id]);
      const res = await cancel(alice, id).expect(200);
      expect(res.body.refund).toMatchObject({ refundXof: 5300, basis: 'FREE_CANCELLATION' });
    });

    it('le conducteur annule une réservation confirmée : remboursement intégral et compteur d’annulations', async () => {
      const trip = await createTrip(db);
      const driver = await driverSession(trip);
      const id = await paidBooking(alice, trip);
      const res = await cancel(driver, id, 'Panne du véhicule').expect(200);
      expect(res.body.booking).toMatchObject({ status: 'CANCELLED_BY_DRIVER', refundDueXof: 5300 });
      const { rows } = await db.query(`SELECT cancellation_count_90d AS n FROM driver_profiles WHERE user_id = $1`, [driver.userId]);
      expect(rows[0].n).toBe(1);
    });

    it('trajet commencé : plus d’annulation par l’application', async () => {
      const trip = await createTrip(db);
      const id = await paidBooking(alice, trip);
      await db.query(`UPDATE trips SET status = 'IN_PROGRESS' WHERE id = $1`, [trip.tripId]);
      expect((await cancel(alice, id)).body.error.code).toBe('TRIP_ALREADY_STARTED');
    });
  });

  it('T4 (partie réservation) : le conducteur annule un trajet réservé', async () => {
    const trip = await createTrip(db, { acceptanceMode: 'MANUAL' });
    const driver = await driverSession(trip);
    const carol = await loginActive(t);
    const ids: string[] = [];
    for (const p of [alice, bruno]) {
      const r = await book(p, trip).expect(201);
      await db.query(`UPDATE bookings SET status = 'PENDING_PAYMENT' WHERE id = $1`, [r.body.id]);
      await db.query(`UPDATE bookings SET status = 'CONFIRMED', payment_status = 'PAID', confirmed_at = now() WHERE id = $1`, [r.body.id]);
      ids.push(r.body.id);
    }
    const pending = await book(carol, trip).expect(201);
    expect(pending.body.status).toBe('PENDING_ACCEPTANCE');
    await t.http().post(`/api/v1/trips/${trip.tripId}/cancel`).set(bearer(driver.accessToken)).set('Idempotency-Key', randomUUID())
      .send({ reason: 'Imprévu familial' }).expect(200);
    expect(await tripStatus(trip)).toBe('CANCELLED');
    const { rows } = await db.query<{ id: string; status: string; payment_status: string; refund_due_xof: number }>(
      `SELECT id, status, payment_status, refund_due_xof::int FROM bookings WHERE trip_id = $1`, [trip.tripId]);
    for (const id of ids) {
      expect(rows.find((r) => r.id === id)).toMatchObject({ status: 'CANCELLED_BY_DRIVER', payment_status: 'REFUND_PENDING', refund_due_xof: 5300 });
    }
    expect(rows.find((r) => r.id === pending.body.id)).toMatchObject({ status: 'CANCELLED_BY_DRIVER', payment_status: 'UNPAID', refund_due_xof: 0 });
    const counter = await db.query(`SELECT cancellation_count_90d AS n FROM driver_profiles WHERE user_id = $1`, [driver.userId]);
    expect(counter.rows[0].n).toBe(1);
    const events = await db.query(`SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'booking.cancelled' AND aggregate_id = ANY($1)`,
      [[...ids, pending.body.id]]);
    expect(events.rows[0].n).toBe(3);
  });

  it('jour J : départ (attentes expirées), absence après 15 min, fin du trajet', async () => {
    const trip = await createTrip(db, { departure: new Date(Date.now() + 30 * 60_000 + 60_000) });
    const driver = await driverSession(trip);
    const carol = await loginActive(t);
    const confirmed = await book(alice, trip).expect(201);
    await db.query(`UPDATE bookings SET status = 'CONFIRMED', payment_status = 'PAID', confirmed_at = now() WHERE id = $1`, [confirmed.body.id]);
    const second = await book(bruno, trip, { pickupStopId: trip.stopIds[1] }).expect(201);
    await db.query(`UPDATE bookings SET status = 'CONFIRMED', payment_status = 'PAID', confirmed_at = now() WHERE id = $1`, [second.body.id]);
    const unpaid = await book(carol, trip).expect(201);
    await t.http().post(`/api/v1/trips/${trip.tripId}/start`).set(bearer(driver.accessToken)).expect(200);
    const u = await t.http().get(`/api/v1/bookings/${unpaid.body.id}`).set(bearer(carol.accessToken)).expect(200);
    expect(u.body.status).toBe('EXPIRED');

    const noShow = (id: string, tripId = trip.tripId) =>
      t.http().post(`/api/v1/trips/${tripId}/bookings/${id}/no-show`).set(bearer(driver.accessToken));
    expect((await noShow(confirmed.body.id)).body.error.code).toBe('NO_SHOW_TOO_EARLY');
    await db.query(`UPDATE trip_stops SET planned_at = now() - interval '20 minutes' WHERE id = $1`, [trip.stopIds[0]]);
    expect((await noShow(confirmed.body.id, (await createTrip(db)).tripId)).status).toBe(404);
    const ns = await noShow(confirmed.body.id).expect(200);
    expect(ns.body.status).toBe('NO_SHOW');

    await t.http().post(`/api/v1/trips/${trip.tripId}/complete`).set(bearer(driver.accessToken)).expect(200);
    const done = await t.http().get(`/api/v1/bookings/${second.body.id}`).set(bearer(bruno.accessToken)).expect(200);
    expect(done.body.status).toBe('COMPLETED');
    expect(done.body.trip.vehicle.plateNumber).not.toBeNull();
  });

  it('tâches automatiques : clôture 12 h après l’arrivée, annulation d’un trajet jamais démarré', async () => {
    const running = await createTrip(db, { departure: new Date(Date.now() + 2 * HOUR) });
    const a = await book(alice, running).expect(201);
    await db.query(`UPDATE bookings SET status = 'CONFIRMED', payment_status = 'PAID', confirmed_at = now() WHERE id = $1`, [a.body.id]);
    await db.query(`UPDATE trips SET status = 'IN_PROGRESS', started_at = now() WHERE id = $1`, [running.tripId]);
    const forgotten = await createTrip(db, { departure: new Date(Date.now() + 2 * HOUR) });
    const b = await book(bruno, forgotten).expect(201);
    await db.query(`UPDATE bookings SET status = 'CONFIRMED', payment_status = 'PAID', confirmed_at = now() WHERE id = $1`, [b.body.id]);

    const later = new Date(Date.now() + 2 * HOUR + 3 * HOUR + 12 * HOUR + 60_000);
    const result = await maintenance.runAll(later);
    expect(result.autoClosed).toBeGreaterThanOrEqual(1);
    expect(result.autoCancelled).toBeGreaterThanOrEqual(1);
    const r = await db.query(`SELECT status, auto_closed FROM trips WHERE id = $1`, [running.tripId]);
    expect(r.rows[0]).toEqual({ status: 'COMPLETED', auto_closed: true });
    const f = await db.query(`SELECT status, cancellation_reason FROM trips WHERE id = $1`, [forgotten.tripId]);
    expect(f.rows[0]).toEqual({ status: 'CANCELLED', cancellation_reason: 'Trajet non démarré' });
    const bk = await db.query(`SELECT status, refund_due_xof::int FROM bookings WHERE id = ANY($1) ORDER BY passenger_id = $2 DESC`, [[a.body.id, b.body.id], alice.userId]);
    expect(bk.rows).toEqual([{ status: 'COMPLETED', refund_due_xof: null }, { status: 'CANCELLED_BY_DRIVER', refund_due_xof: 5300 }]);
  });

  it('espèces : seulement si la plateforme et le conducteur l’acceptent ; confirmée, à régler au conducteur', async () => {
    const trip = await createTrip(db, { allowsCash: true });
    expect((await book(alice, trip, { paymentMethod: 'CASH' })).body.error.code).toBe('CASH_NOT_ALLOWED');
    await db.query(`INSERT INTO settings (key, value, version) SELECT 'payments.cash_enabled', 'true', max(version) + 1 FROM settings WHERE key = 'payments.cash_enabled'`);
    try {
      const res = await book(alice, trip, { paymentMethod: 'CASH' }).expect(201);
      expect(res.body).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'CASH_DUE', paymentMethod: 'CASH', holdExpiresAt: null });
      const noCash = await createTrip(db);
      expect((await book(bruno, noCash, { paymentMethod: 'CASH' })).body.error.code).toBe('CASH_NOT_ALLOWED');
    } finally {
      await db.query(`INSERT INTO settings (key, value, version) SELECT 'payments.cash_enabled', 'false', max(version) + 1 FROM settings WHERE key = 'payments.cash_enabled'`);
    }
  });

  it('mes réservations : à venir puis passées', async () => {
    const dave = await loginActive(t);
    const trip = await createTrip(db);
    const a = await book(dave, trip).expect(201);
    const up = await t.http().get('/api/v1/bookings/mine').set(bearer(dave.accessToken)).expect(200);
    expect(up.body.data.map((b: { id: string }) => b.id)).toEqual([a.body.id]);
    expect(up.body.data[0]).toMatchObject({ pickup: { label: 'Arrêt 0' }, dropoff: { label: 'Arrêt 2' }, totalXof: 5300 });
    await t.http().post(`/api/v1/bookings/${a.body.id}/cancel`).set(bearer(dave.accessToken)).set('Idempotency-Key', randomUUID()).send({ reason: 'Annulé' }).expect(200);
    const past = await t.http().get('/api/v1/bookings/mine?scope=past').set(bearer(dave.accessToken)).expect(200);
    expect(past.body.data[0]).toMatchObject({ id: a.body.id, status: 'CANCELLED_BY_PASSENGER' });
    expect((await t.http().get('/api/v1/bookings/mine').set(bearer(dave.accessToken))).body.data).toEqual([]);
  });

  it('T5 : un autre compte ne voit ni ne modifie une réservation (404 partout, sans fuite)', async () => {
    const trip = await createTrip(db, { acceptanceMode: 'MANUAL' });
    const mine = await book(alice, trip).expect(201);
    const intruder = bruno;
    const otherDriverTrip = await createTrip(db);
    const otherDriver = await driverSession(otherDriverTrip);
    const id = mine.body.id;
    for (const who of [intruder, otherDriver]) {
      const calls = [
        t.http().get(`/api/v1/bookings/${id}`).set(bearer(who.accessToken)),
        t.http().post(`/api/v1/bookings/${id}/cancel/preview`).set(bearer(who.accessToken)),
        t.http().post(`/api/v1/bookings/${id}/cancel`).set(bearer(who.accessToken)).set('Idempotency-Key', randomUUID()).send({ reason: 'Pas à moi' }),
        t.http().post(`/api/v1/bookings/${id}/accept`).set(bearer(who.accessToken)),
        t.http().post(`/api/v1/bookings/${id}/reject`).set(bearer(who.accessToken)).send({}),
        t.http().post(`/api/v1/trips/${trip.tripId}/bookings/${id}/no-show`).set(bearer(who.accessToken)),
      ];
      for (const res of await Promise.all(calls)) {
        expect(res.status).toBe(404);
        expect(JSON.stringify(res.body)).not.toContain(alice.userId);
        expect(JSON.stringify(res.body)).not.toContain(mine.body.reference);
      }
    }
    const still = await t.http().get(`/api/v1/bookings/${id}`).set(bearer(alice.accessToken)).expect(200);
    expect(still.body.status).toBe('PENDING_ACCEPTANCE');
    expect((await t.http().get(`/api/v1/bookings/${id}`)).status).toBe(401);
  });
});
