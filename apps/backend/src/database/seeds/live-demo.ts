import type { Client } from 'pg';
import { bookingReference, tripReference, uuidv7 } from '../../common/ids';
import { fallbackEstimate, type LatLng } from '../../modules/routing/haversine';

/*
 * Essai de la carte en temps réel de la console : 10 conducteurs et 10 passagers FICTIFS (is_demo, « [DEMO] »),
 * numéros +225 00 00 00 00 21 à 40 (plage non attribuée). Chaque conducteur a un trajet urbain en cours dans
 * Abidjan avec un passager confirmé. Aucun paiement n'est simulé (payment_status NOT_REQUIRED).
 * Les positions sont SIMULÉES par run-live-demo.ts le long d'un tracé à vol d'oiseau : ce ne sont pas des GPS.
 */

const NAMES = [
  ['Ibrahim', 'Koné'], ['Adjoua', 'Yao'], ['Serge', 'Kouadio'], ['Nadège', 'Aka'], ['Moussa', 'Sylla'],
  ['Christelle', 'Brou'], ['Lassina', 'Coulibaly'], ['Prisca', 'Kassi'], ['Hervé', 'Gbagbo'], ['Salimata', 'Touré'],
] as const;
const PASSENGERS = [
  ['Kevin', 'Assi'], ['Rokia', 'Doumbia'], ['Patrick', 'Ehui'], ['Mariette', 'Kra'], ['Souleymane', 'Cissé'],
  ['Estelle', 'Amani'], ['Didier', 'Zadi'], ['Assita', 'Sanogo'], ['Franck', 'Loba'], ['Bintou', 'Fofana'],
] as const;
const CARS = [
  ['Toyota', 'Yaris', 'Blanc'], ['Suzuki', 'Swift', 'Rouge'], ['Hyundai', 'Accent', 'Gris'], ['Kia', 'Rio', 'Bleu'],
  ['Toyota', 'Corolla', 'Noir'], ['Renault', 'Logan', 'Blanc'], ['Peugeot', '301', 'Gris'], ['Nissan', 'Almera', 'Beige'],
  ['Honda', 'City', 'Blanc'], ['Mitsubishi', 'Lancer', 'Argent'],
] as const;
/** Trajets urbains : [départ, arrivée, prix XOF]. */
const ROUTES: [string, string, number][] = [
  ['Riviera 2', 'Plateau', 700], ['Yopougon', 'Plateau', 800], ['Abobo', 'Adjamé', 500], ['Angré', 'Zone 4', 900],
  ['Koumassi', 'Treichville', 500], ['Niangon', "Gare routière d'Adjamé", 700], ['Port-Bouët', 'Marcory', 500],
  ['Deux-Plateaux', 'Treichville', 700], ['Riviera Palmeraie', 'Cocody', 500], ['Attécoubé', 'Koumassi', 800],
];

export const LIVE_DEMO_DRIVER_PHONES = NAMES.map((_, i) => `+22500000000${21 + i}`);
const passengerPhone = (i: number) => `+22500000000${31 + i}`;

async function place(client: Client, name: string): Promise<{ id: string } & LatLng> {
  const { rows } = await client.query<{ id: string; lat: number; lng: number }>(
    `SELECT id, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng FROM places WHERE name = $1 ORDER BY kind LIMIT 1`,
    [name],
  );
  if (!rows[0]) throw new Error(`Lieu absent du référentiel : ${name} (lancer d'abord pnpm db:seed)`);
  return rows[0];
}

async function user(client: Client, phone: string, first: string, last: string): Promise<string> {
  const found = await client.query<{ id: string }>('SELECT id FROM users WHERE phone_e164 = $1', [phone]);
  if (found.rows[0]) return found.rows[0].id;
  const id = uuidv7();
  await client.query(
    `INSERT INTO users (id, phone_e164, phone_verified_at, first_name, last_name, status, is_demo)
     VALUES ($1, $2, now(), $3, $4, 'ACTIVE', true)`,
    [id, phone, `[DEMO] ${first}`, last],
  );
  return id;
}

/** Crée les comptes s'ils manquent, termine les anciens trajets d'essai et en démarre de nouveaux. */
export async function seedLiveDemo(client: Client, now: Date = new Date()): Promise<{ drivers: number; passengers: number; trips: number }> {
  let fee = (await client.query<{ id: string }>(
    `SELECT id FROM fee_rules WHERE effective_to IS NULL AND trip_kind IS NULL ORDER BY effective_from DESC LIMIT 1`,
  )).rows[0]?.id;
  if (!fee) {
    fee = uuidv7();
    // Règle de DÉMONSTRATION (10 % / 6 %), non validée commercialement.
    await client.query(
      `INSERT INTO fee_rules (id, effective_from, commission_bps, service_fee_bps, service_fee_min_xof, is_demo)
       VALUES ($1, now() - interval '1 day', 1000, 600, 100, true)`,
      [fee],
    );
  }
  const feeRow = (await client.query<{ commission_bps: number; service_fee_bps: number; service_fee_min_xof: number }>(
    'SELECT commission_bps, service_fee_bps, service_fee_min_xof FROM fee_rules WHERE id = $1', [fee],
  )).rows[0]!;

  let trips = 0;
  for (const [i, [first, last]] of NAMES.entries()) {
    const driverId = await user(client, LIVE_DEMO_DRIVER_PHONES[i]!, first, last);
    await client.query(
      `INSERT INTO driver_profiles (user_id, verification_status, verification_level, verified_at, submitted_at, license_expires_on)
       VALUES ($1, 'APPROVED', 2, now(), now(), (now() + interval '3 years')::date) ON CONFLICT (user_id) DO NOTHING`,
      [driverId],
    );
    let vehicleId = (await client.query<{ id: string }>('SELECT id FROM vehicles WHERE driver_id = $1 LIMIT 1', [driverId])).rows[0]?.id;
    if (!vehicleId) {
      vehicleId = uuidv7();
      const [make, model, color] = CARS[i]!;
      await client.query(
        `INSERT INTO vehicles (id, driver_id, make, model, color, plate_number, seats_capacity, verification_status)
         VALUES ($1, $2, $3, $4, $5, $6, 4, 'APPROVED')`,
        [vehicleId, driverId, make, model, color, `DM-${String(100 + i)}-CI`],
      );
    }
    const passengerId = await user(client, passengerPhone(i), PASSENGERS[i]![0], PASSENGERS[i]![1]);

    // Un trajet d'essai encore en cours est gardé ; les autres sont terminés pour laisser place aux nouveaux.
    const running = await client.query<{ id: string }>(
      `SELECT id FROM trips WHERE driver_id = $1 AND is_demo AND status = 'IN_PROGRESS' AND started_at > now() - interval '2 hours'`,
      [driverId],
    );
    if (running.rows[0]) continue;
    await client.query(`UPDATE bookings SET status = 'COMPLETED', completed_at = now()
                         WHERE is_demo AND status = 'CONFIRMED' AND trip_id IN (SELECT id FROM trips WHERE driver_id = $1 AND status = 'IN_PROGRESS')`, [driverId]);
    await client.query(`UPDATE trips SET status = 'COMPLETED', completed_at = now() WHERE driver_id = $1 AND is_demo AND status = 'IN_PROGRESS'`, [driverId]);

    const [fromName, toName, price] = ROUTES[i]!;
    const a = await place(client, fromName);
    const b = await place(client, toName);
    const est = fallbackEstimate([a, b], 'URBAN');
    // Durée d'au moins 20 minutes, pour voir les voitures avancer.
    const durationS = Math.max(est.durationS, 1200);
    const departure = new Date(now.getTime() - 60_000);
    const tripId = uuidv7();
    await client.query(
      `INSERT INTO trips (id, public_ref, driver_id, vehicle_id, kind, status, departure_at, estimated_arrival_at,
                          seats_offered, acceptance_mode, cancellation_policy_code, description,
                          estimated_distance_m, estimated_duration_s, route_source, is_demo, published_at, route_geometry)
       VALUES ($1, $2, $3, $4, 'URBAN', 'PUBLISHED', $5, $6, 3, 'AUTO', 'FLEXIBLE', $7, $8, $9, 'HAVERSINE_FALLBACK', true, now(),
               ST_GeogFromText($10))`,
      [tripId, tripReference(), driverId, vehicleId, departure, new Date(departure.getTime() + durationS * 1000),
       `[DEMO] Essai de la carte en temps réel : ${fromName} – ${toName}.`, est.distanceM, durationS,
       `SRID=4326;LINESTRING(${a.lng} ${a.lat},${b.lng} ${b.lat})`],
    );
    const stopIds: string[] = [];
    for (const [seq, p] of [a, b].entries()) {
      const id = uuidv7();
      stopIds.push(id);
      await client.query(
        `INSERT INTO trip_stops (id, trip_id, seq, place_id, label, meeting_point, location, location_precision,
                                 planned_at, price_from_origin_xof, is_pickup, is_dropoff)
         VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($8, $7), 4326)::geography, 'APPROX', $9, $10, $11, $12)`,
        [id, tripId, seq, p.id, seq === 0 ? fromName : toName, `${seq === 0 ? fromName : toName} (point fictif de démo)`, p.lat, p.lng,
         new Date(departure.getTime() + seq * durationS * 1000), seq === 0 ? 0 : price, seq === 0, seq === 1],
      );
    }
    const commission = Math.round((price * feeRow.commission_bps) / 10_000);
    const serviceFee = Math.max(feeRow.service_fee_min_xof, Math.round((price * feeRow.service_fee_bps) / 10_000));
    await client.query(
      `INSERT INTO bookings (id, reference, trip_id, passenger_id, pickup_stop_id, dropoff_stop_id, pickup_seq, dropoff_seq, seats,
                             status, payment_status, unit_price_xof, subtotal_xof, service_fee_xof, total_xof, commission_xof,
                             driver_net_xof, fee_rule_id, cancellation_policy_code, accepted_at, confirmed_at, is_demo)
       VALUES ($1, $2, $3, $4, $5, $6, 0, 1, 1, 'CONFIRMED', 'NOT_REQUIRED', $7, $7, $8, $9, $10, $11, $12, 'FLEXIBLE', now(), now(), true)`,
      [uuidv7(), bookingReference(), tripId, passengerId, stopIds[0], stopIds[1], price, serviceFee, price + serviceFee,
       commission, price - commission, fee],
    );
    await client.query(`UPDATE trips SET status = 'IN_PROGRESS', started_at = now() WHERE id = $1`, [tripId]);
    trips++;
  }
  return { drivers: NAMES.length, passengers: PASSENGERS.length, trips };
}

/** Point à la fraction f (0 → 1) d'un tracé, en interpolant entre ses sommets. */
export function pointAlong(line: LatLng[], f: number): LatLng & { heading: number } {
  const t = Math.min(1, Math.max(0, f)) * (line.length - 1);
  const i = Math.min(line.length - 2, Math.floor(t));
  const a = line[i]!;
  const b = line[i + 1]!;
  const k = t - i;
  const heading = (Math.atan2(b.lng - a.lng, b.lat - a.lat) * 180) / Math.PI;
  return { lat: a.lat + (b.lat - a.lat) * k, lng: a.lng + (b.lng - a.lng) * k, heading: (heading + 360) % 360 };
}
