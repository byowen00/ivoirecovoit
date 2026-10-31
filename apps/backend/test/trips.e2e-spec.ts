import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { bookingReference } from '../src/common/ids';
import { addApprovedVehicle, type ApprovedDriver, approvedDriver } from './driver-helpers';
import { createBooking, createUser, ensureFeeRule, type TripFixture } from './fixtures';
import { bearer, createTestApp, loginActive, type TestApp } from './test-app';
import { connectTestDb } from './test-db';

const DAY = 86_400_000;

describe('Trajets : publication, modification, cycle de vie', () => {
  let t: TestApp;
  let db: Client;
  const places: Record<string, string> = {};

  beforeAll(async () => {
    t = await createTestApp();
    db = await connectTestDb();
    const { rows } = await db.query<{ id: string; name: string }>(
      `SELECT id, name FROM places WHERE name IN ('Riviera 2','Toumodi','Yamoussoukro','Bouaké','Plateau','Abobo','Adjamé')`,
    );
    for (const r of rows) places[r.name] = r.id;
  });
  beforeEach(async () => {
    await t.redis.flushdb();
  });
  afterAll(async () => {
    await db.end();
    await t.app.close();
  });

  /** Départ à J+n, à 7 h 30 (heure d'Abidjan = UTC). */
  function at(days: number, hour = 7, minute = 30): string {
    const d = new Date(Date.now() + days * DAY);
    d.setUTCHours(hour, minute, 0, 0);
    return d.toISOString();
  }

  function tripBody(d: ApprovedDriver, extra: Record<string, unknown> = {}) {
    return {
      vehicleId: d.vehicleId,
      kind: 'INTERCITY',
      departureAt: at(3),
      seatsOffered: 3,
      stops: [
        { placeId: places['Riviera 2'], meetingPoint: 'Carrefour de la Riviera 2', lat: 5.3631, lng: -3.9582 },
        { placeId: places.Toumodi },
        { placeId: places.Yamoussoukro },
      ],
      pricePerSeatXof: 5000,
      stopPricesXof: [0, 3000, 5000],
      ...extra,
    };
  }

  function createTrip(d: ApprovedDriver, extra: Record<string, unknown> = {}, key = randomUUID()) {
    return t.http().post('/api/v1/trips').set(bearer(d.token)).set('Idempotency-Key', key).send(tripBody(d, extra));
  }

  function asFixture(trip: { id: string; stops: { id: string }[] }, d: ApprovedDriver): TripFixture {
    return { tripId: trip.id, driverId: d.userId, vehicleId: d.vehicleId, stopIds: trip.stops.map((s) => s.id) };
  }

  it('aperçu : itinéraire estimé, horaires de passage croissants, prix suggéré et bornes', async () => {
    const d = await approvedDriver(t, db);
    const body = tripBody(d);
    delete (body as Record<string, unknown>).stopPricesXof;
    const res = await t.http().post('/api/v1/trips/preview').set(bearer(d.token)).send(body).expect(200);
    expect(res.body).toMatchObject({ routeSource: 'HAVERSINE_FALLBACK', isEstimate: true, price: { minXof: 500, maxXof: 30000, problems: [] } });
    expect(res.body.estimatedDistanceM).toBeGreaterThan(200_000);
    const planned = res.body.stops.map((s: { plannedAt: string }) => Date.parse(s.plannedAt));
    expect(planned[0]).toBe(Date.parse(body.departureAt));
    expect(planned[1]).toBeGreaterThan(planned[0]);
    expect(planned[2]).toBeGreaterThan(planned[1]);
    // Prix intermédiaire au prorata de la distance : Toumodi est aux trois quarts environ de la route.
    const [p0, p1, p2] = res.body.stops.map((s: { priceFromOriginXof: number }) => s.priceFromOriginXof);
    expect([p0, p2]).toEqual([0, 5000]);
    expect(p1 % 50).toBe(0);
    expect(p1 / p2).toBeGreaterThan(0.7);
    expect(p1 / p2).toBeLessThan(0.9);
    expect(res.body.stops[0]).toMatchObject({ label: 'Riviera 2, Cocody', locationPrecision: 'EXACT', isPickup: true, isDropoff: false });
    expect(res.body.stops[1]).toMatchObject({ label: 'Toumodi', locationPrecision: 'APPROX' });
  });

  it('crée un brouillon (idempotent), puis le publie', async () => {
    const d = await approvedDriver(t, db);
    const key = randomUUID();
    const draft = await createTrip(d, {}, key).expect(201);
    expect(draft.body).toMatchObject({ status: 'DRAFT', isEstimate: true, routeSource: 'HAVERSINE_FALLBACK', seatsOccupied: 0 });
    expect(draft.body.publicRef).toMatch(/^T-[A-HJ-NP-Z2-9]{6}$/);
    expect(draft.body.stops.map((s: { priceFromOriginXof: number }) => s.priceFromOriginXof)).toEqual([0, 3000, 5000]);
    const replay = await createTrip(d, {}, key).expect(201);
    expect(replay.body.id).toBe(draft.body.id);
    const count = await db.query('SELECT count(*)::int AS n FROM trips WHERE driver_id = $1', [d.userId]);
    expect(count.rows[0].n).toBe(1);

    // Brouillon invisible du public.
    await t.http().get(`/api/v1/trips/${draft.body.id}`).expect(404);
    const pub = await t.http().post(`/api/v1/trips/${draft.body.id}/publish`).set(bearer(d.token)).expect(200);
    expect(pub.body.status).toBe('PUBLISHED');
    expect(pub.body.publishedAt).not.toBeNull();
    const again = await t.http().post(`/api/v1/trips/${draft.body.id}/publish`).set(bearer(d.token)).expect(409);
    expect(again.body.error.code).toBe('INVALID_STATE_TRANSITION');
    await createTrip(d).set('Idempotency-Key', '').expect(400);
  });

  describe('publication refusée', () => {
    it('conducteur non vérifié', async () => {
      const s = await loginActive(t);
      const res = await t
        .http()
        .post('/api/v1/trips')
        .set(bearer(s.accessToken))
        .set('Idempotency-Key', randomUUID())
        .send({ ...tripBody({ vehicleId: randomUUID() } as ApprovedDriver), publish: true })
        .expect(403);
      expect(res.body.error.code).toBe('DRIVER_NOT_VERIFIED');
      await t.http().get('/api/v1/trips/mine').set(bearer(s.accessToken)).expect(403);
    });

    it('véhicule non vérifié, assurance ou visite expirée à la date du trajet', async () => {
      const d = await approvedDriver(t, db);
      await db.query(`UPDATE vehicles SET verification_status = 'PENDING' WHERE id = $1`, [d.vehicleId]);
      expect((await createTrip(d, { publish: true }).expect(422)).body.error.code).toBe('VEHICLE_NOT_APPROVED');

      const soon = new Date(Date.now() + 2 * DAY).toISOString().slice(0, 10);
      const v2 = await addApprovedVehicle(db, d.userId, { insuranceExpiresOn: soon });
      const res = await createTrip({ ...d, vehicleId: v2 }, { publish: true }).expect(422);
      expect(res.body.error).toMatchObject({ code: 'DOCUMENT_EXPIRED', details: { docType: 'INSURANCE' } });
      // Le même trajet la veille de l'expiration passe.
      await createTrip({ ...d, vehicleId: v2 }, { publish: true, departureAt: at(1, 9) }).expect(201);

      const v3 = await addApprovedVehicle(db, d.userId, { inspectionExpiresOn: soon });
      const res3 = await createTrip({ ...d, vehicleId: v3 }, { publish: true, departureAt: at(5) }).expect(422);
      expect(res3.body.error.details.docType).toBe('TECHNICAL_INSPECTION');
    });

    it('départ trop proche (< 30 min) ou trop lointain (> 90 jours)', async () => {
      const d = await approvedDriver(t, db);
      const tooSoon = await createTrip(d, { publish: true, departureAt: new Date(Date.now() + 20 * 60_000).toISOString() }).expect(422);
      expect(tooSoon.body.error.code).toBe('DEPARTURE_OUT_OF_RANGE');
      const tooFar = await createTrip(d, { publish: true, departureAt: at(91) }).expect(422);
      expect(tooFar.body.error.code).toBe('DEPARTURE_OUT_OF_RANGE');
      // Un brouillon lointain reste possible, mais sa publication est refusée.
      const draft = await createTrip(d, { departureAt: at(91) }).expect(201);
      await t.http().post(`/api/v1/trips/${draft.body.id}/publish`).set(bearer(d.token)).expect(422);
    });

    it('plus de places que le véhicule', async () => {
      const d = await approvedDriver(t, db, { seats: 3 });
      const res = await createTrip(d, { seatsOffered: 4 }).expect(422);
      expect(res.body.error).toMatchObject({ code: 'SEATS_EXCEED_CAPACITY', details: { capacity: 3 } });
    });

    it('chevauchement : même véhicule, ou même conducteur avec un autre véhicule (contraintes d’exclusion)', async () => {
      const d = await approvedDriver(t, db);
      await createTrip(d, { publish: true, departureAt: at(10) }).expect(201);
      const overlap = await createTrip(d, { publish: true, departureAt: at(10, 8) }).expect(409);
      expect(overlap.body.error.code).toBe('VEHICLE_OVERLAP');
      const other = await addApprovedVehicle(db, d.userId);
      const driverOverlap = await createTrip({ ...d, vehicleId: other }, { publish: true, departureAt: at(10, 9) }).expect(409);
      expect(driverOverlap.body.error.code).toBe('DRIVER_OVERLAP');
      // Le soir, une fois arrivé : possible.
      await createTrip(d, { publish: true, departureAt: at(10, 18) }).expect(201);
      // Un brouillon qui chevauche ne bloque rien tant qu'il n'est pas publié.
      const draft = await createTrip(d, { departureAt: at(10, 8) }).expect(201);
      expect((await t.http().post(`/api/v1/trips/${draft.body.id}/publish`).set(bearer(d.token)).expect(409)).body.error.code).toBe('VEHICLE_OVERLAP');
    });

    it('prix : multiples de 50, croissants, segments dans les bornes', async () => {
      const d = await approvedDriver(t, db);
      const notStep = await createTrip(d, { stopPricesXof: [0, 3010, 5000] }).expect(422);
      expect(notStep.body.error.code).toBe('PRICE_INVALID');
      const below = await createTrip(d, { stopPricesXof: [0, 4800, 5000] }).expect(422);
      expect(below.body.error).toMatchObject({ code: 'PRICE_OUT_OF_BOUNDS', details: { minXof: 500, maxXof: 30000 } });
      expect(below.body.error.details.problems).toEqual([{ code: 'BELOW_MIN', from: 1, to: 2, priceXof: 200 }]);
      const above = await createTrip(d, { pricePerSeatXof: 30050, stopPricesXof: undefined }).expect(422);
      expect(above.body.error.code).toBe('PRICE_OUT_OF_BOUNDS');
      const mismatch = await createTrip(d, { pricePerSeatXof: 6000 }).expect(400);
      expect(mismatch.body.error.details.fields).toHaveProperty('pricePerSeatXof');
      // Prix complet seul : prix intermédiaires proposés au prorata des distances.
      const auto = await createTrip(d, { stopPricesXof: undefined, pricePerSeatXof: 6000 }).expect(201);
      const prices = auto.body.stops.map((s: { priceFromOriginXof: number }) => s.priceFromOriginXof);
      expect(prices[0]).toBe(0);
      expect(prices[2]).toBe(6000);
      expect(prices[1] % 50 === 0 && prices[1] > 0 && prices[1] < 6000).toBe(true);
    });

    it('arrêts : hors de Côte d’Ivoire, lieu inconnu, trop proches, trop nombreux', async () => {
      const d = await approvedDriver(t, db);
      const outside = await createTrip(d, { stops: [{ label: 'Accra', lat: 5.6, lng: -0.19 }, { placeId: places.Yamoussoukro }] }).expect(400);
      expect(outside.body.error.details.fields).toHaveProperty(['stops.0.lng']);
      await createTrip(d, { stops: [{ placeId: randomUUID() }, { placeId: places.Yamoussoukro }], stopPricesXof: [0, 5000] }).expect(400);
      const close = await createTrip(d, {
        stops: [{ placeId: places.Plateau }, { label: 'Juste à côté', lat: 5.3231, lng: -4.0201 }],
        stopPricesXof: [0, 500],
        pricePerSeatXof: 500,
        kind: 'URBAN',
      }).expect(400);
      expect(Object.values(close.body.error.details.fields)[0]).toMatch(/trop proches/);
      const many = Array.from({ length: 8 }, (_, i) => ({ label: `Arrêt ${i}`, lat: 5.4 + i * 0.1, lng: -4.5 }));
      await createTrip(d, { stops: many, stopPricesXof: undefined }).expect(400);
    });
  });

  it('modification : If-Match obligatoire et vérifié, horaires recalculés, version incrémentée', async () => {
    const d = await approvedDriver(t, db);
    const trip = (await createTrip(d, { publish: true }).expect(201)).body;
    const noHeader = await t.http().patch(`/api/v1/trips/${trip.id}`).set(bearer(d.token)).send({ description: 'Clim' }).expect(428);
    expect(noHeader.body.error.code).toBe('IF_MATCH_REQUIRED');
    const ok = await t
      .http()
      .patch(`/api/v1/trips/${trip.id}`)
      .set(bearer(d.token))
      .set('If-Match', String(trip.version))
      .send({ description: 'Départ à l’heure, climatisation.', departureAt: at(3, 8, 0) })
      .expect(200);
    expect(ok.body.version).toBe(trip.version + 1);
    expect(Date.parse(ok.body.stops[2].plannedAt) - Date.parse(trip.stops[2].plannedAt)).toBe(30 * 60_000);
    const stale = await t
      .http()
      .patch(`/api/v1/trips/${trip.id}`)
      .set(bearer(d.token))
      .set('If-Match', String(trip.version))
      .send({ description: 'Autre' })
      .expect(409);
    expect(stale.body.error).toMatchObject({ code: 'VERSION_CONFLICT', details: { version: trip.version + 1 } });
    // Nouvel itinéraire sans réservation : arrêts remplacés.
    const reroute = await t
      .http()
      .patch(`/api/v1/trips/${trip.id}`)
      .set(bearer(d.token))
      .set('If-Match', String(ok.body.version))
      .send({ stops: [{ placeId: places['Riviera 2'] }, { placeId: places.Yamoussoukro }], stopPricesXof: [0, 5000] })
      .expect(200);
    expect(reroute.body.stops.map((s: { label: string }) => s.label)).toEqual(['Riviera 2, Cocody', 'Yamoussoukro']);
  });

  it('modification avec réservations : arrêts figés, places ≥ réservées, décalage horaire signalé', async () => {
    const d = await approvedDriver(t, db);
    const trip = (await createTrip(d, { publish: true }).expect(201)).body;
    await createBooking(db, asFixture(trip, d), await createUser(db), { status: 'CONFIRMED' });
    await createBooking(db, asFixture(trip, d), await createUser(db), { status: 'CONFIRMED' });
    const patch = (version: number, body: Record<string, unknown>) =>
      t.http().patch(`/api/v1/trips/${trip.id}`).set(bearer(d.token)).set('If-Match', String(version)).send(body);

    const stops = await patch(trip.version, { stops: [{ placeId: places['Riviera 2'] }, { placeId: places.Yamoussoukro }], stopPricesXof: [0, 5000] }).expect(409);
    expect(stops.body.error.code).toBe('TRIP_HAS_BOOKINGS');
    const seats = await patch(trip.version, { seatsOffered: 1 }).expect(409);
    expect(seats.body.error).toMatchObject({ code: 'SEATS_BELOW_BOOKED', details: { occupied: 2 } });
    // Places ajoutées puis retirées jusqu'au nombre réservé : FULL quand plus rien n'est libre.
    const full = await patch(trip.version, { seatsOffered: 2 }).expect(200);
    expect(full.body).toMatchObject({ status: 'FULL', seatsOccupied: 2 });
    const reopened = await patch(full.body.version, { seatsOffered: 3 }).expect(200);
    expect(reopened.body.status).toBe('PUBLISHED');
    // Décalage de 45 min : autorisé, événement prévu pour prévenir les passagers (annulation sans frais).
    await patch(reopened.body.version, { departureAt: at(3, 8, 15) }).expect(200);
    const events = await db.query(`SELECT payload FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'trip.updated' ORDER BY id`, [trip.id]);
    expect(events.rows.at(-1).payload).toMatchObject({ departureShiftMin: 45, freeCancellation: true });
    const free = await db.query(`SELECT bool_and(free_cancellation) AS all FROM bookings WHERE trip_id = $1`, [trip.id]);
    expect(free.rows[0].all).toBe(true);
    // Annulation du trajet : les réservations sont annulées avec lui (détail dans bookings.e2e-spec.ts, T4).
    const cancel = await t
      .http()
      .post(`/api/v1/trips/${trip.id}/cancel`)
      .set(bearer(d.token))
      .set('Idempotency-Key', randomUUID())
      .send({ reason: 'Voiture en panne' })
      .expect(200);
    expect(cancel.body.bookings.map((b: { status: string }) => b.status)).toEqual(['CANCELLED_BY_DRIVER', 'CANCELLED_BY_DRIVER']);
  });

  it('cloisonnement : le trajet d’un autre conducteur est introuvable (404)', async () => {
    const owner = await approvedDriver(t, db);
    const trip = (await createTrip(owner).expect(201)).body;
    const other = await approvedDriver(t, db);
    const h = bearer(other.token);
    await t.http().get(`/api/v1/trips/${trip.id}/manage`).set(h).expect(404);
    await t.http().patch(`/api/v1/trips/${trip.id}`).set(h).set('If-Match', '1').send({ description: 'pirate' }).expect(404);
    await t.http().post(`/api/v1/trips/${trip.id}/publish`).set(h).expect(404);
    await t.http().post(`/api/v1/trips/${trip.id}/cancel`).set(h).set('Idempotency-Key', randomUUID()).send({ reason: 'pirate' }).expect(404);
    await t.http().post(`/api/v1/trips/${trip.id}/duplicate`).set(h).set('Idempotency-Key', randomUUID()).send({ dates: ['2030-01-01'] }).expect(404);
    await t.http().post(`/api/v1/trips/${trip.id}/start`).set(h).expect(404);
    const mine = await t.http().get('/api/v1/trips/mine?status=draft').set(h).expect(200);
    expect(mine.body.data).toEqual([]);
  });

  it('duplication sur plusieurs dates, avec rapport par date', async () => {
    const d = await approvedDriver(t, db);
    const trip = (await createTrip(d, { publish: true, departureAt: at(4) }).expect(201)).body;
    const day = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
    const res = await t
      .http()
      .post(`/api/v1/trips/${trip.id}/duplicate`)
      .set(bearer(d.token))
      .set('Idempotency-Key', randomUUID())
      .send({ dates: [day(5), day(4), day(6)], publish: true })
      .expect(201);
    expect(res.body.data.map((r: { status: string | null }) => r.status)).toEqual(['PUBLISHED', null, 'PUBLISHED']);
    expect(res.body.data[1].error.code).toBe('VEHICLE_OVERLAP'); // même jour que l'original
    const copy = await t.http().get(`/api/v1/trips/${res.body.data[0].tripId}/manage`).set(bearer(d.token)).expect(200);
    expect(copy.body.departureAt.slice(11)).toBe(trip.departureAt.slice(11));
    expect(copy.body.stops.map((s: { priceFromOriginXof: number }) => s.priceFromOriginXof)).toEqual([0, 3000, 5000]);
    const tooMany = await t
      .http()
      .post(`/api/v1/trips/${trip.id}/duplicate`)
      .set(bearer(d.token))
      .set('Idempotency-Key', randomUUID())
      .send({ dates: Array.from({ length: 15 }, (_, i) => day(20 + i)) })
      .expect(400);
    expect(tooMany.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('cycle de vie : démarrage dans la fenêtre, fin, puis plus aucune modification', async () => {
    const d = await approvedDriver(t, db);
    const trip = (await createTrip(d, { publish: true }).expect(201)).body;
    const early = await t.http().post(`/api/v1/trips/${trip.id}/start`).set(bearer(d.token)).expect(422);
    expect(early.body.error.code).toBe('START_WINDOW_CLOSED');
    // On rapproche le départ (dans 20 min) directement en base : la fenêtre s'ouvre 1 h avant.
    await db.query(`UPDATE trips SET departure_at = now() + interval '20 minutes', estimated_arrival_at = now() + interval '4 hours' WHERE id = $1`, [trip.id]);
    const pending = await createBooking(db, asFixture(trip, d), await createUser(db));
    const started = await t.http().post(`/api/v1/trips/${trip.id}/start`).set(bearer(d.token)).expect(200);
    expect(started.body).toMatchObject({ status: 'IN_PROGRESS', actions: { canComplete: true, canEdit: false } });
    const expired = await db.query('SELECT status FROM bookings WHERE id = $1', [pending]);
    expect(expired.rows[0].status).toBe('EXPIRED'); // réservation non confirmée au départ
    const done = await t.http().post(`/api/v1/trips/${trip.id}/complete`).set(bearer(d.token)).expect(200);
    expect(done.body.status).toBe('COMPLETED');
    const count = await db.query('SELECT completed_trips_count FROM driver_profiles WHERE user_id = $1', [d.userId]);
    expect(count.rows[0].completed_trips_count).toBe(1);
    for (const action of ['start', 'complete', 'publish']) {
      await t.http().post(`/api/v1/trips/${trip.id}/${action}`).set(bearer(d.token)).expect(409);
    }
    await t.http().post(`/api/v1/trips/${trip.id}/cancel`).set(bearer(d.token)).set('Idempotency-Key', randomUUID()).send({ reason: 'trop tard' }).expect(409);
    await t.http().patch(`/api/v1/trips/${trip.id}`).set(bearer(d.token)).set('If-Match', String(done.body.version)).send({ description: 'x' }).expect(409);
  });

  it('suivi du conducteur : partage pendant le trajet, lecture par les passagers confirmés seulement', async () => {
    const d = await approvedDriver(t, db);
    const trip = (await createTrip(d, { publish: true }).expect(201)).body;
    const passenger = await loginActive(t);
    const stranger = await loginActive(t);
    await createBooking(db, asFixture(trip, d), passenger.userId, { status: 'CONFIRMED' });
    const point = { lat: 5.3364, lng: -4.0267, accuracyM: 25, heading: 90 };

    // Avant le départ : rien à partager ni à lire.
    const early = await t.http().post(`/api/v1/trips/${trip.id}/location`).set(bearer(d.token)).send(point).expect(409);
    expect(early.body.error.code).toBe('TRIP_NOT_IN_PROGRESS');
    const before = await t.http().get(`/api/v1/trips/${trip.id}/location`).set(bearer(passenger.accessToken)).expect(200);
    expect(before.body).toMatchObject({ status: 'PUBLISHED', position: null });

    await db.query(`UPDATE trips SET departure_at = now() + interval '20 minutes', estimated_arrival_at = now() + interval '4 hours' WHERE id = $1`, [trip.id]);
    await t.http().post(`/api/v1/trips/${trip.id}/start`).set(bearer(d.token)).expect(200);
    const none = await t.http().get(`/api/v1/trips/${trip.id}/location`).set(bearer(passenger.accessToken)).expect(200);
    expect(none.body).toMatchObject({ status: 'IN_PROGRESS', position: null });

    await t.http().post(`/api/v1/trips/${trip.id}/location`).set(bearer(d.token)).send(point).expect(200);
    const seen = await t.http().get(`/api/v1/trips/${trip.id}/location`).set(bearer(passenger.accessToken)).expect(200);
    expect(seen.body).toMatchObject({ status: 'IN_PROGRESS', stale: false, position: { lat: 5.3364, lng: -4.0267, accuracyM: 25, heading: 90 } });
    expect(seen.body.ageS).toBeLessThan(5);

    // Ni un autre membre, ni un passager qui n'est pas du trajet, ni un passager qui voudrait écrire.
    await t.http().get(`/api/v1/trips/${trip.id}/location`).set(bearer(stranger.accessToken)).expect(404);
    await t.http().post(`/api/v1/trips/${trip.id}/location`).set(bearer(passenger.accessToken)).send(point).expect(404);
    await t.http().post(`/api/v1/trips/${trip.id}/location`).set(bearer(d.token)).send({ lat: 95, lng: 0 }).expect(400);

    // Fin du trajet : la position est effacée.
    await t.http().post(`/api/v1/trips/${trip.id}/complete`).set(bearer(d.token)).expect(200);
    const after = await t.http().get(`/api/v1/trips/${trip.id}/location`).set(bearer(passenger.accessToken)).expect(200);
    expect(after.body).toMatchObject({ status: 'COMPLETED', position: null });
  });

  it('annulation (idempotente) et onglets « mes trajets »', async () => {
    const d = await approvedDriver(t, db);
    const a = (await createTrip(d, { publish: true, departureAt: at(2) }).expect(201)).body;
    const b = (await createTrip(d, { departureAt: at(20) }).expect(201)).body;
    const key = randomUUID();
    const cancel = () => t.http().post(`/api/v1/trips/${a.id}/cancel`).set(bearer(d.token)).set('Idempotency-Key', key).send({ reason: 'Imprévu familial' });
    expect((await cancel().expect(200)).body).toMatchObject({ status: 'CANCELLED', cancellationReason: 'Imprévu familial' });
    expect((await cancel().expect(200)).body.status).toBe('CANCELLED'); // rejeu : même réponse, pas d'erreur
    const tab = async (status: string) =>
      (await t.http().get(`/api/v1/trips/mine?status=${status}`).set(bearer(d.token)).expect(200)).body.data.map((x: { id: string }) => x.id);
    expect(await tab('past')).toEqual([a.id]);
    expect(await tab('draft')).toEqual([b.id]);
    expect(await tab('upcoming')).toEqual([]);
    const pub = await t.http().get(`/api/v1/trips/${a.id}`).expect(200);
    expect(pub.body).toMatchObject({ status: 'CANCELLED', cancellationReason: 'Imprévu familial' });
  });

  it('détail public : coordonnées arrondies et immatriculation cachée, sauf conducteur et passager confirmé', async () => {
    const d = await approvedDriver(t, db);
    const trip = (await createTrip(d, { publish: true }).expect(201)).body;
    const visitor = await t.http().get(`/api/v1/trips/${trip.id}`).expect(200);
    expect(visitor.body).toMatchObject({ coordinatesPrecision: 'ROUNDED', isEstimate: true, vehicle: { make: 'Toyota', plateNumber: null } });
    expect(visitor.body.stops[0]).toMatchObject({ lat: 5.363, lng: -3.958, meetingPoint: 'Carrefour de la Riviera 2' });
    expect(visitor.body.segments).toEqual([
      { fromSeq: 0, toSeq: 1, seatsAvailable: 3 },
      { fromSeq: 1, toSeq: 2, seatsAvailable: 3 },
    ]);
    expect(visitor.body.driver).toMatchObject({ displayName: 'Aya K.', verified: true });
    expect(JSON.stringify(visitor.body)).not.toContain('+225');
    expect(visitor.body.cancellationPolicy).toMatchObject({ code: 'STANDARD', label: 'Standard' });

    const asDriver = await t.http().get(`/api/v1/trips/${trip.id}`).set(bearer(d.token)).expect(200);
    expect(asDriver.body).toMatchObject({ coordinatesPrecision: 'EXACT', viewer: { isDriver: true } });
    expect(asDriver.body.stops[0]).toMatchObject({ lat: 5.3631, lng: -3.9582 });

    const passenger = await loginActive(t);
    const fixture = asFixture(trip, d);
    await createBooking(db, fixture, passenger.userId, { status: 'CONFIRMED' });
    const asPassenger = await t.http().get(`/api/v1/trips/${trip.id}`).set(bearer(passenger.accessToken)).expect(200);
    expect(asPassenger.body).toMatchObject({ coordinatesPrecision: 'EXACT', viewer: { isConfirmedPassenger: true } });
    expect(asPassenger.body.vehicle.plateNumber).toMatch(/[A-Z]/);
    expect(asPassenger.body.segments.map((s: { seatsAvailable: number }) => s.seatsAvailable)).toEqual([2, 2]);
    // Jeton invalide : traité comme un visiteur, pas comme une erreur.
    const badToken = await t.http().get(`/api/v1/trips/${trip.id}`).set(bearer('abc.def.ghi')).expect(200);
    expect(badToken.body.coordinatesPrecision).toBe('ROUNDED');
  });

  it('disponibilité par segment', async () => {
    const d = await approvedDriver(t, db, { seats: 3 });
    const trip = (await createTrip(d, { publish: true, seatsOffered: 1 }).expect(201)).body;
    const [s0, s1, s2] = trip.stops.map((s: { id: string }) => s.id);
    // Une place réservée de Riviera 2 à Toumodi (segment 0 -> 1 seulement).
    await db.query(
      `INSERT INTO bookings (id, reference, trip_id, passenger_id, pickup_stop_id, dropoff_stop_id, pickup_seq, dropoff_seq, seats, status,
                             unit_price_xof, subtotal_xof, service_fee_xof, total_xof, commission_xof, driver_net_xof, fee_rule_id,
                             cancellation_policy_code)
       VALUES ($1, $2, $3, $4, $5, $6, 0, 0, 1, 'CONFIRMED', 3000, 3000, 180, 3180, 300, 2700, $7, 'STANDARD')`,
      [randomUUID(), bookingReference(), trip.id, await createUser(db), s0, s1, await ensureFeeRule(db)],
    );
    const seg = (p: string, q: string) => t.http().get(`/api/v1/trips/${trip.id}/availability?pickupStopId=${p}&dropoffStopId=${q}`);
    expect((await seg(s0, s1).expect(200)).body).toMatchObject({ seatsAvailable: 0, unitPriceXof: 3000, bookable: true });
    expect((await seg(s1, s2).expect(200)).body).toMatchObject({ seatsAvailable: 1, unitPriceXof: 2000 });
    expect((await seg(s0, s2).expect(200)).body.seatsAvailable).toBe(0);
    expect((await seg(s2, s0).expect(400)).body.error.code).toBe('INVALID_SEGMENT');
    const manage = await t.http().get(`/api/v1/trips/${trip.id}/manage`).set(bearer(d.token)).expect(200);
    expect(manage.body.status).toBe('PUBLISHED'); // statut recalculé à la réservation (étape 7)
    expect(manage.body.bookings).toHaveLength(1);
    expect(manage.body.bookings[0]).toMatchObject({ seats: 1, pickup: 'Riviera 2, Cocody', dropoff: 'Toumodi' });
  });
});
