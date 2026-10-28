import type { Client } from 'pg';
import { bookingReference, tripReference, uuidv7 } from '../src/common/ids';

// Valeurs uniques même entre fichiers de test (chaque fichier a son propre module) : certaines données restent en base.
let phoneCounter = Math.floor(Math.random() * 1e7);

export async function createUser(db: Client): Promise<string> {
  const id = uuidv7();
  phoneCounter++;
  await db.query(
    `INSERT INTO users (id, phone_e164, first_name, last_name, status) VALUES ($1, $2, 'Test', 'Utilisateur', 'ACTIVE')`,
    [id, `+2259${String(phoneCounter).padStart(8, '0')}`],
  );
  return id;
}

export async function createDriverWithVehicle(db: Client, seats = 3): Promise<{ driverId: string; vehicleId: string }> {
  const driverId = await createUser(db);
  await db.query(`INSERT INTO driver_profiles (user_id, verification_status, verification_level) VALUES ($1, 'APPROVED', 2)`, [
    driverId,
  ]);
  const vehicleId = uuidv7();
  await db.query(
    `INSERT INTO vehicles (id, driver_id, make, model, color, plate_number, seats_capacity, verification_status)
     VALUES ($1, $2, 'Toyota', 'Corolla', 'Gris', $3, $4, 'APPROVED')`,
    [vehicleId, driverId, `TT-${vehicleId.slice(-8)}`, seats],
  );
  return { driverId, vehicleId };
}

export async function ensureFeeRule(db: Client): Promise<string> {
  const { rows } = await db.query<{ id: string }>(`SELECT id FROM fee_rules WHERE trip_kind IS NULL LIMIT 1`);
  if (rows[0]) return rows[0].id;
  const id = uuidv7();
  await db.query(
    `INSERT INTO fee_rules (id, effective_from, commission_bps, service_fee_bps, is_demo) VALUES ($1, now() - interval '1 day', 1000, 600, true)`,
    [id],
  );
  return id;
}

export interface TripFixture {
  tripId: string;
  driverId: string;
  vehicleId: string;
  stopIds: string[];
}

/** Trajet publié à 3 arrêts (Abidjan -> Toumodi -> Yamoussoukro, coordonnées approximatives). */
export async function createTrip(
  db: Client,
  opts: {
    vehicle?: { driverId: string; vehicleId: string };
    departure?: Date;
    hours?: number;
    status?: string;
    seats?: number;
    acceptanceMode?: 'AUTO' | 'MANUAL';
    allowsCash?: boolean;
  } = {},
): Promise<TripFixture> {
  const { driverId, vehicleId } = opts.vehicle ?? (await createDriverWithVehicle(db));
  const departure = opts.departure ?? new Date(Date.now() + 2 * 86_400_000);
  const arrival = new Date(departure.getTime() + (opts.hours ?? 3) * 3_600_000);
  const tripId = uuidv7();
  await db.query(
    `INSERT INTO trips (id, public_ref, driver_id, vehicle_id, kind, status, departure_at, estimated_arrival_at,
                        seats_offered, cancellation_policy_code, acceptance_mode, allows_cash)
     VALUES ($1, $2, $3, $4, 'INTERCITY', $5, $6, $7, $8, 'STANDARD', $9, $10)`,
    [tripId, tripReference(), driverId, vehicleId, opts.status ?? 'PUBLISHED', departure, arrival, opts.seats ?? 3,
     opts.acceptanceMode ?? 'AUTO', opts.allowsCash ?? false],
  );
  const stops: [number, number, number][] = [
    [5.36, -3.96, 0],
    [6.55, -5.02, 3000],
    [6.83, -5.29, 5000],
  ];
  const stopIds: string[] = [];
  for (const [seq, [lat, lng, price]] of stops.entries()) {
    const id = uuidv7();
    await db.query(
      `INSERT INTO trip_stops (id, trip_id, seq, label, location, planned_at, price_from_origin_xof)
       VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($6, $5), 4326)::geography, $7, $8)`,
      [id, tripId, seq, `Arrêt ${seq}`, lat, lng, new Date(departure.getTime() + seq * 3_600_000), price],
    );
    stopIds.push(id);
  }
  return { tripId, driverId, vehicleId, stopIds };
}

/** Réservation 1 place de l'arrêt 0 à l'arrêt 2, montants de démonstration cohérents. */
export async function createBooking(
  db: Client,
  trip: TripFixture,
  passengerId: string,
  overrides: Partial<Record<'status' | 'total_xof' | 'service_fee_xof', unknown>> = {},
): Promise<string> {
  const feeRuleId = await ensureFeeRule(db);
  const id = uuidv7();
  await db.query(
    `INSERT INTO bookings (id, reference, trip_id, passenger_id, pickup_stop_id, dropoff_stop_id, pickup_seq, dropoff_seq,
                           seats, status, unit_price_xof, subtotal_xof, service_fee_xof, total_xof, commission_xof,
                           driver_net_xof, fee_rule_id, cancellation_policy_code, hold_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, 0, 0, 1, $7, 5000, 5000, $8, $9, 500, 4500, $10, 'STANDARD', now() + interval '15 minutes')`,
    [
      id, bookingReference(), trip.tripId, passengerId, trip.stopIds[0], trip.stopIds[2],
      overrides.status ?? 'PENDING_PAYMENT', overrides.service_fee_xof ?? 300, overrides.total_xof ?? 5300, feeRuleId,
    ],
  );
  return id;
}
