import type { Client } from 'pg';
import { tripReference, uuidv7 } from '../../common/ids';
import { fallbackEstimate, type LatLng } from '../../modules/routing/haversine';

/*
 * Données de démonstration : TOUTES fictives et marquées is_demo = true, noms préfixés « [DEMO] ».
 * Numéros dans la plage +225 00 00 00 00 xx, qui n'est attribuée à aucun abonné.
 * Distances et durées : estimation de repli (vol d'oiseau × coefficient), jamais des mesures GPS.
 */

const DEMO_DRIVERS = [
  { first: '[DEMO] Koffi', last: 'Kouassi', phone: '+2250000000001', car: ['Toyota', 'Corolla', 'Gris', 'AA-1234-CI', 3] },
  { first: '[DEMO] Awa', last: 'Traoré', phone: '+2250000000002', car: ['Hyundai', 'Tucson', 'Blanc', 'AB-5678-CI', 4] },
  { first: '[DEMO] Yao', last: "N'Guessan", phone: '+2250000000003', car: ['Kia', 'Picanto', 'Rouge', 'AC-9012-CI', 3] },
  { first: '[DEMO] Mariam', last: 'Diabaté', phone: '+2250000000004', car: ['Toyota', 'Hilux', 'Noir', 'AD-3456-CI', 4] },
] as const;

const DEMO_PASSENGERS = [
  { first: '[DEMO] Aïcha', last: 'Bamba', phone: '+2250000000011' },
  { first: '[DEMO] Jean-Marc', last: 'Gnagne', phone: '+2250000000012' },
  { first: '[DEMO] Fatou', last: 'Ouattara', phone: '+2250000000013' },
] as const;

interface DemoTrip {
  driver: number;
  kind: 'URBAN' | 'INTERCITY';
  dayOffset: number;
  hourUtc: number; // Abidjan = UTC+0 toute l'année
  seats: number;
  mode: 'AUTO' | 'MANUAL';
  policy: 'FLEXIBLE' | 'STANDARD' | 'STRICT';
  // [nom du lieu dans le référentiel, point de rencontre, prix cumulé depuis l'origine en XOF]
  stops: [string, string, number][];
  description: string;
}

const DEMO_TRIPS: DemoTrip[] = [
  {
    driver: 0, kind: 'INTERCITY', dayOffset: 2, hourUtc: 7, seats: 3, mode: 'AUTO', policy: 'STANDARD',
    stops: [
      ['Riviera 2', 'Carrefour de la Riviera 2 (point fictif de démo)', 0],
      ['Toumodi', 'Gare routière de Toumodi (point fictif de démo)', 3000],
      ['Yamoussoukro', 'Centre-ville de Yamoussoukro (point fictif de démo)', 5000],
    ],
    description: '[DEMO] Trajet fictif Abidjan – Yamoussoukro avec arrêt à Toumodi.',
  },
  {
    driver: 1, kind: 'INTERCITY', dayOffset: 3, hourUtc: 6, seats: 4, mode: 'MANUAL', policy: 'FLEXIBLE',
    stops: [
      ["Gare routière d'Adjamé", "Gare routière d'Adjamé (point fictif de démo)", 0],
      ['Yamoussoukro', 'Entrée de Yamoussoukro (point fictif de démo)', 5000],
      ['Bouaké', 'Centre-ville de Bouaké (point fictif de démo)', 8000],
    ],
    description: '[DEMO] Trajet fictif Abidjan – Bouaké, réservation sur acceptation.',
  },
  {
    driver: 2, kind: 'INTERCITY', dayOffset: 4, hourUtc: 8, seats: 3, mode: 'AUTO', policy: 'STANDARD',
    stops: [
      ['Niangon', 'Niangon (point fictif de démo)', 0],
      ['Daloa', 'Centre-ville de Daloa (point fictif de démo)', 9000],
    ],
    description: '[DEMO] Trajet fictif direct Abidjan – Daloa.',
  },
  {
    driver: 3, kind: 'INTERCITY', dayOffset: 5, hourUtc: 6, seats: 4, mode: 'AUTO', policy: 'STRICT',
    stops: [
      ['Zone 4', 'Zone 4 (point fictif de démo)', 0],
      ['San-Pédro', 'Centre-ville de San-Pédro (point fictif de démo)', 10000],
    ],
    description: '[DEMO] Trajet fictif direct Abidjan – San-Pédro.',
  },
  {
    driver: 0, kind: 'INTERCITY', dayOffset: 6, hourUtc: 9, seats: 3, mode: 'AUTO', policy: 'FLEXIBLE',
    stops: [
      ['Cocody', 'Cocody (point fictif de démo)', 0],
      ['Grand-Bassam', 'Grand-Bassam (point fictif de démo)', 1500],
    ],
    description: '[DEMO] Trajet fictif Abidjan – Grand-Bassam.',
  },
  {
    driver: 2, kind: 'URBAN', dayOffset: 1, hourUtc: 7, seats: 3, mode: 'AUTO', policy: 'FLEXIBLE',
    stops: [
      ['Abobo', 'Abobo (point fictif de démo)', 0],
      ['Adjamé', 'Adjamé (point fictif de démo)', 500],
      ['Plateau', 'Plateau (point fictif de démo)', 1000],
    ],
    description: '[DEMO] Trajet urbain fictif Abobo – Plateau.',
  },
];

export interface DemoSummary {
  skipped?: boolean;
  users?: number;
  vehicles?: number;
  trips?: number;
}

async function placeByName(client: Client, name: string): Promise<{ id: string } & LatLng> {
  const { rows } = await client.query<{ id: string; lat: number; lng: number }>(
    `SELECT id, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
       FROM places WHERE name = $1 ORDER BY kind LIMIT 1`,
    [name],
  );
  if (!rows[0]) throw new Error(`Lieu absent du référentiel : ${name} (lancer d'abord db:seed)`);
  return rows[0];
}

export async function seedDemo(client: Client, now: Date = new Date()): Promise<DemoSummary> {
  const existing = await client.query('SELECT 1 FROM users WHERE is_demo LIMIT 1');
  if (existing.rowCount) return { skipped: true };

  // Règle de frais de DÉMONSTRATION : 10 % de commission, 6 % de frais de service. Non validée commercialement.
  await client.query(
    `INSERT INTO fee_rules (id, effective_from, commission_bps, service_fee_bps, service_fee_min_xof, is_demo)
     SELECT $1, now() - interval '1 day', 1000, 600, 100, true
     WHERE NOT EXISTS (SELECT 1 FROM fee_rules WHERE effective_to IS NULL AND trip_kind IS NULL)`,
    [uuidv7()],
  );

  const driverIds: string[] = [];
  const vehicleIds: string[] = [];
  for (const d of DEMO_DRIVERS) {
    const userId = uuidv7();
    await client.query(
      `INSERT INTO users (id, phone_e164, phone_verified_at, first_name, last_name, status, is_demo)
       VALUES ($1, $2, now(), $3, $4, 'ACTIVE', true)`,
      [userId, d.phone, d.first, d.last],
    );
    await client.query(
      `INSERT INTO driver_profiles (user_id, verification_status, verification_level, verified_at)
       VALUES ($1, 'APPROVED', 2, now())`,
      [userId],
    );
    const [make, model, color, plate, seats] = d.car;
    const vehicleId = uuidv7();
    await client.query(
      `INSERT INTO vehicles (id, driver_id, make, model, color, plate_number, seats_capacity, verification_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'APPROVED')`,
      [vehicleId, userId, make, model, color, plate, seats],
    );
    driverIds.push(userId);
    vehicleIds.push(vehicleId);
  }
  for (const p of DEMO_PASSENGERS) {
    await client.query(
      `INSERT INTO users (id, phone_e164, phone_verified_at, first_name, last_name, status, is_demo)
       VALUES ($1, $2, now(), $3, $4, 'ACTIVE', true)`,
      [uuidv7(), p.phone, p.first, p.last],
    );
  }

  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (const t of DEMO_TRIPS) {
    const places: ({ id: string } & LatLng)[] = [];
    for (const [name] of t.stops) places.push(await placeByName(client, name));
    const departure = new Date(today + t.dayOffset * 86_400_000 + t.hourUtc * 3_600_000);
    const total = fallbackEstimate(places, t.kind);
    const tripId = uuidv7();
    await client.query(
      `INSERT INTO trips (id, public_ref, driver_id, vehicle_id, kind, status, departure_at, estimated_arrival_at,
                          seats_offered, acceptance_mode, cancellation_policy_code, description,
                          estimated_distance_m, estimated_duration_s, route_source, is_demo, published_at)
       VALUES ($1, $2, $3, $4, $5, 'PUBLISHED', $6, $7, $8, $9, $10, $11, $12, $13, 'HAVERSINE_FALLBACK', true, now())`,
      [
        tripId, tripReference(), driverIds[t.driver], vehicleIds[t.driver], t.kind, departure,
        new Date(departure.getTime() + total.durationS * 1000), t.seats, t.mode, t.policy, t.description,
        total.distanceM, total.durationS,
      ],
    );
    let elapsedS = 0;
    for (const [seq, [, meetingPoint, price]] of t.stops.entries()) {
      if (seq > 0) elapsedS += fallbackEstimate([places[seq - 1]!, places[seq]!], t.kind).durationS;
      const place = places[seq]!;
      await client.query(
        `INSERT INTO trip_stops (id, trip_id, seq, place_id, label, meeting_point, location, location_precision,
                                 planned_at, price_from_origin_xof)
         VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($8, $7), 4326)::geography, 'APPROX', $9, $10)`,
        [
          uuidv7(), tripId, seq, place.id, t.stops[seq]![0], meetingPoint, place.lat, place.lng,
          new Date(departure.getTime() + elapsedS * 1000), price,
        ],
      );
    }
  }

  return {
    users: DEMO_DRIVERS.length + DEMO_PASSENGERS.length,
    vehicles: vehicleIds.length,
    trips: DEMO_TRIPS.length,
  };
}
