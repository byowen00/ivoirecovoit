import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { bookingReference } from '../src/common/ids';
import { type ApprovedDriver, approvedDriver } from './driver-helpers';
import { createTrip as createTripFixture, createUser, ensureFeeRule } from './fixtures';
import { bearer, createTestApp, type TestApp } from './test-app';
import { connectTestDb } from './test-db';

const DAY = 86_400_000;

/*
 * Jeu de données de référence (plan de tests §3) : axes Abidjan–Yamoussoukro, –Bouaké, –Daloa, –San-Pédro,
 * –Grand-Bassam et trajets intra-Abidjan, tous le jour J+45 (date réservée à ce fichier) sauf mention contraire.
 */
describe('Recherche de trajets par segment (PostGIS)', () => {
  let t: TestApp;
  let db: Client;
  const place: Record<string, string> = {};
  const trip: Record<string, string> = {};
  const day = new Date(Date.now() + 45 * DAY).toISOString().slice(0, 10);
  const otherDay = new Date(Date.now() + 46 * DAY).toISOString().slice(0, 10);

  async function publish(
    d: ApprovedDriver,
    hhmm: string,
    stops: (string | { placeId: string; lat: number; lng: number })[],
    prices: number[],
    opts: { kind?: 'URBAN' | 'INTERCITY'; date?: string; publish?: boolean; seats?: number } = {},
  ): Promise<string> {
    const res = await t
      .http()
      .post('/api/v1/trips')
      .set(bearer(d.token))
      .set('Idempotency-Key', randomUUID())
      .send({
        vehicleId: d.vehicleId,
        kind: opts.kind ?? 'INTERCITY',
        departureAt: `${opts.date ?? day}T${hhmm}:00Z`,
        seatsOffered: opts.seats ?? 3,
        stops: stops.map((s) => (typeof s === 'string' ? { placeId: place[s] } : s)),
        stopPricesXof: prices,
        publish: opts.publish ?? true,
      });
    if (res.status !== 201) throw new Error(`${res.status} ${JSON.stringify(res.body)}`);
    return res.body.id;
  }

  beforeAll(async () => {
    t = await createTestApp();
    db = await connectTestDb();
    await t.redis.flushdb();
    const { rows } = await db.query<{ id: string; name: string }>(`SELECT DISTINCT ON (name) id, name FROM places ORDER BY name, kind`);
    for (const r of rows) place[r.name] = r.id;
    const drivers: ApprovedDriver[] = [];
    for (let n = 0; n < 12; n++) drivers.push(await approvedDriver(t, db, { seats: 4 }));
    const [a, b, c, d, e, f, g, h, i, j, k, l] = drivers;

    trip.T1 = await publish(a!, '07:30', [{ placeId: place['Riviera 2']!, lat: 5.3631, lng: -3.9582 }, 'Toumodi', 'Yamoussoukro'], [0, 3000, 4500]);
    trip.T2 = await publish(b!, '06:00', ["Gare routière d'Adjamé", 'Yamoussoukro', 'Bouaké'], [0, 5000, 8000]);
    trip.T3 = await publish(c!, '07:00', ['Abobo', 'Adjamé', 'Plateau'], [0, 500, 1000], { kind: 'URBAN' });
    trip.T4 = await publish(d!, '09:00', ['Cocody', 'Grand-Bassam'], [0, 1500]);
    trip.T5 = await publish(e!, '08:00', ['Niangon', 'Daloa'], [0, 9000]);
    trip.T6 = await publish(f!, '06:00', ['Zone 4', 'San-Pédro'], [0, 10000]);
    trip.T7 = await publish(g!, '15:00', ['Yamoussoukro', 'Plateau'], [0, 5000]); // sens inverse
    trip.T8 = await publish(h!, '07:30', ['Riviera 2', 'Yamoussoukro'], [0, 5000], { date: otherDay });
    trip.T9 = await publish(i!, '10:00', ['Riviera 2', 'Yamoussoukro'], [0, 5000], { publish: false }); // brouillon
    trip.T10 = await publish(j!, '11:00', ['Riviera 2', 'Yamoussoukro'], [0, 5000]);
    await t.http().post(`/api/v1/trips/${trip.T10}/cancel`).set(bearer(j!.token)).set('Idempotency-Key', randomUUID()).send({ reason: 'Annulé pour le test' }).expect(200);
    trip.T11 = await publish(k!, '12:00', ['Riviera 2', 'Yamoussoukro'], [0, 5000]);
    await db.query(`UPDATE driver_profiles SET verification_status = 'REJECTED' WHERE user_id = $1`, [k!.userId]); // conducteur retiré
    // Axe Plateau -> Divo -> Gagnoa : 2 places, toutes deux réservées sur le premier tronçon seulement.
    trip.T12 = await publish(l!, '08:00', ['Plateau', 'Divo', 'Gagnoa'], [0, 3000, 5000], { seats: 2 });
    const stops = await db.query<{ id: string }>(`SELECT id FROM trip_stops WHERE trip_id = $1 ORDER BY seq`, [trip.T12]);
    await db.query(
      `INSERT INTO bookings (id, reference, trip_id, passenger_id, pickup_stop_id, dropoff_stop_id, pickup_seq, dropoff_seq, seats, status,
                             unit_price_xof, subtotal_xof, service_fee_xof, total_xof, commission_xof, driver_net_xof, fee_rule_id, cancellation_policy_code)
       VALUES ($1, $2, $3, $4, $5, $6, 0, 0, 2, 'CONFIRMED', 3000, 6000, 360, 6360, 600, 5400, $7, 'STANDARD')`,
      [randomUUID(), bookingReference(), trip.T12, await createUser(db), stops.rows[0]!.id, stops.rows[1]!.id, await ensureFeeRule(db)],
    );
    await db.query(`UPDATE driver_profiles SET rating_avg = 4.8, rating_count = 32 WHERE user_id = $1`, [b!.userId]);
    await db.query(`UPDATE driver_profiles SET rating_avg = 4.2, rating_count = 5 WHERE user_id = $1`, [a!.userId]);
  });
  afterAll(async () => {
    await db.end();
    await t.app.close();
  });

  async function search(params: Record<string, string | number | boolean>) {
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    const res = await t.http().get(`/api/v1/trips/search?${qs}`);
    return res;
  }
  const ids = (res: { body: { data: { tripId: string }[] } }) => res.body.data.map((r) => r.tripId);
  const name = (id: string) => Object.entries(trip).find(([, v]) => v === id)?.[0];

  it('Abidjan -> Yamoussoukro : trajet direct et trajet dont Yamoussoukro est un arrêt intermédiaire', async () => {
    const res = await search({ fromPlaceId: place.Abidjan!, toPlaceId: place.Yamoussoukro!, date: day }).then((r) => r);
    expect(res.status).toBe(200);
    expect(ids(res).map(name)).toEqual(['T2', 'T1']); // par heure de départ ; ni brouillon, ni annulé, ni autre jour, ni sens inverse
    const [t2, t1] = res.body.data;
    expect(t2).toMatchObject({ unitPriceXof: 5000, stopsCount: 0, pickup: { label: "Gare routière d'Adjamé, Adjamé" }, dropoff: { label: 'Yamoussoukro' } });
    expect(t1).toMatchObject({
      unitPriceXof: 4500,
      stopsCount: 1,
      seatsAvailable: 4 - 1, // 3 places offertes sur un véhicule de 4
      isEstimate: true,
      acceptanceMode: 'AUTO',
      driver: { displayName: 'Aya K.', ratingAvg: 4.2, ratingCount: 5, verified: true },
      vehicle: { make: 'Toyota', model: 'Corolla', color: 'Gris' },
      pickup: { label: 'Riviera 2, Cocody', lat: 5.363, lng: -3.958 }, // arrondi pour les visiteurs
    });
    expect(t1.pickup.distanceFromQueryM).toBeGreaterThan(0);
    expect(t1.estimatedDurationS).toBeGreaterThan(0);
    expect(JSON.stringify(res.body)).not.toMatch(/plate|\+225/i);
    expect(res.body.query).toMatchObject({ from: { label: 'Abidjan' }, to: { label: 'Yamoussoukro' }, seats: 1 });
  });

  it('respecte l’ordre des arrêts : un trajet dans l’autre sens ne remonte pas', async () => {
    expect(ids(await search({ fromPlaceId: place.Yamoussoukro!, toPlaceId: place.Abidjan!, date: day })).map(name)).toEqual(['T7']);
    expect(ids(await search({ fromPlaceId: place.Toumodi!, toPlaceId: place['Riviera 2']!, date: day }))).toEqual([]);
  });

  it('montée à un arrêt intermédiaire : prix du seul segment parcouru', async () => {
    const yb = await search({ fromPlaceId: place.Yamoussoukro!, toPlaceId: place.Bouaké!, date: day });
    expect(ids(yb).map(name)).toEqual(['T2']);
    expect(yb.body.data[0]).toMatchObject({ unitPriceXof: 3000, pickup: { label: 'Yamoussoukro' } });
    const ty = await search({ fromPlaceId: place.Toumodi!, toPlaceId: place.Yamoussoukro!, date: day });
    expect(ty.body.data[0]).toMatchObject({ unitPriceXof: 1500, stopsCount: 0 });
  });

  it('filtres : direct uniquement, prix maximum, plage horaire, nombre de places', async () => {
    const base = { fromPlaceId: place.Abidjan!, toPlaceId: place.Yamoussoukro!, date: day };
    expect(ids(await search({ ...base, directOnly: true })).map(name)).toEqual(['T2']);
    expect(ids(await search({ ...base, maxPriceXof: 4500 })).map(name)).toEqual(['T1']);
    expect(ids(await search({ ...base, maxPriceXof: 4000 }))).toEqual([]);
    expect(ids(await search({ ...base, timeFrom: '07:00', timeTo: '09:00' })).map(name)).toEqual(['T1']);
    expect(ids(await search({ ...base, seats: 4 })).map(name)).toEqual([]); // 3 places offertes
    expect(ids(await search({ ...base, date: otherDay })).map(name)).toEqual(['T8']);
  });

  it('tris : prix, note du conducteur, proximité', async () => {
    const base = { fromPlaceId: place.Abidjan!, toPlaceId: place.Yamoussoukro!, date: day };
    expect(ids(await search({ ...base, sort: 'price' })).map(name)).toEqual(['T1', 'T2']);
    expect(ids(await search({ ...base, sort: 'rating' })).map(name)).toEqual(['T2', 'T1']);
    const near = await search({ fromLat: 5.3631, fromLng: -3.9582, toPlaceId: place.Yamoussoukro!, date: day, sort: 'distance' });
    expect(ids(near).map(name)[0]).toBe('T1');
  });

  it('places restantes calculées par segment : tronçon complet exclu, tronçon libre proposé', async () => {
    expect(ids(await search({ fromPlaceId: place.Plateau!, toPlaceId: place.Divo!, date: day }))).toEqual([]);
    expect(ids(await search({ fromPlaceId: place.Plateau!, toPlaceId: place.Gagnoa!, date: day }))).toEqual([]);
    const free = await search({ fromPlaceId: place.Divo!, toPlaceId: place.Gagnoa!, date: day });
    expect(ids(free).map(name)).toEqual(['T12']);
    expect(free.body.data[0].seatsAvailable).toBe(2);
    const detail = await t.http().get(`/api/v1/trips/${trip.T12}`).expect(200);
    expect(detail.body.status).toBe('PUBLISHED');
    expect(detail.body.segments.map((s: { seatsAvailable: number }) => s.seatsAvailable)).toEqual([0, 2]);
  });

  it('trajets urbains : rayon par défaut de 5 km, rayon choisi par le passager', async () => {
    expect(ids(await search({ fromPlaceId: place.Abobo!, toPlaceId: place.Plateau!, date: day })).map(name)).toEqual(['T3']);
    const nearAbobo = { fromLat: 5.42, fromLng: -4.016, toLat: 5.323, toLng: -4.02, date: day };
    expect(ids(await search(nearAbobo)).map(name)).toEqual(['T3']);
    const bingerville = { fromLat: 5.355, fromLng: -3.885, toLat: 5.323, toLng: -4.02, date: day };
    expect(ids(await search(bingerville))).toEqual([]);
    expect(ids(await search({ ...bingerville, radiusKm: 1 }))).toEqual([]);
    expect(ids(await search({ ...bingerville, radiusKm: 20 })).map(name)).toContain('T3');
  });

  it('autres axes de référence : Grand-Bassam, Daloa, San-Pédro', async () => {
    expect(ids(await search({ fromPlaceId: place.Abidjan!, toPlaceId: place['Grand-Bassam']!, date: day })).map(name)).toEqual(['T4']);
    expect(ids(await search({ fromPlaceId: place.Abidjan!, toPlaceId: place.Daloa!, date: day })).map(name)).toEqual(['T5']);
    expect(ids(await search({ fromPlaceId: place.Abidjan!, toPlaceId: place['San-Pédro']!, date: day })).map(name)).toEqual(['T6']);
  });

  it('tolère les fautes de frappe via l’autocomplétion (« Yamoussokro », « bassam »)', async () => {
    const typo = await t.http().get('/api/v1/places/autocomplete?q=Yamoussokro').expect(200);
    expect(typo.body.data[0].name).toBe('Yamoussoukro');
    const bassam = await t.http().get('/api/v1/places/autocomplete?q=bassam').expect(200);
    expect(bassam.body.data[0].name).toBe('Grand-Bassam');
    expect(ids(await search({ fromPlaceId: place.Abidjan!, toPlaceId: typo.body.data[0].id, date: day })).length).toBe(2);
  });

  it('pagination par curseur', async () => {
    const base = { fromPlaceId: place.Abidjan!, toPlaceId: place.Yamoussoukro!, date: day, limit: 1 };
    const p1 = await search(base);
    expect(ids(p1).map(name)).toEqual(['T2']);
    expect(p1.body.nextCursor).toEqual(expect.any(String));
    const p2 = await search({ ...base, cursor: p1.body.nextCursor });
    expect(ids(p2).map(name)).toEqual(['T1']);
    expect(p2.body.nextCursor).toBeNull();
  });

  it('sans date : trajets à venir, mais pas ceux qui partent dans moins de 30 minutes', async () => {
    const soon = await createTripFixture(db, { departure: new Date(Date.now() + 10 * 60_000) });
    const later = await createTripFixture(db, { departure: new Date(Date.now() + 3 * 3_600_000) });
    const res = await search({ fromLat: 5.36, fromLng: -3.96, toLat: 6.83, toLng: -5.29 });
    expect(ids(res)).toContain(later.tripId);
    expect(ids(res)).not.toContain(soon.tripId);
  });

  it('valide les paramètres', async () => {
    const missing = await search({ toPlaceId: place.Yamoussoukro! });
    expect(missing.status).toBe(400);
    expect(missing.body.error.details.fields).toHaveProperty('fromPlaceId');
    expect((await search({ fromPlaceId: place.Abidjan!, toPlaceId: place.Bouaké!, timeFrom: '10:00', timeTo: '08:00' })).status).toBe(400);
    expect((await search({ fromLat: 48.85, fromLng: 2.35, toPlaceId: place.Bouaké! })).status).toBe(400); // Paris
    expect((await search({ fromPlaceId: randomUUID(), toPlaceId: place.Bouaké! })).status).toBe(400);
  });

  it('lieu le plus proche et axes populaires', async () => {
    const rev = await t.http().get('/api/v1/places/reverse?lat=5.3635&lng=-3.9580').expect(200);
    expect(rev.body.data).toMatchObject({ label: 'Riviera 2, Cocody' });
    expect(rev.body.data.distanceM).toBeLessThan(100);
    const far = await t.http().get('/api/v1/places/reverse?lat=8.0&lng=-8.5').expect(200);
    expect(far.body.data).toBeNull();
    const popular = await t.http().get('/api/v1/places/popular-routes').expect(200);
    const ay = popular.body.data.find((r: { to: { name: string } }) => r.to.name === 'Yamoussoukro');
    expect(ay).toMatchObject({ from: { name: 'Abidjan' } });
    expect(ay.upcomingTrips).toBeGreaterThanOrEqual(3); // T1, T2, T8
  });
});
