import type { Client } from 'pg';
import { bookingReference, tripReference, uuidv7 } from '../../common/ids';
import { fallbackEstimate, type LatLng } from '../../modules/routing/haversine';
import { LIVE_DEMO_DRIVER_PHONES, NAMES, PASSENGERS, passengerPhone, place, user } from './live-demo';

/*
 * 20 trajets proposés [DEMO] (10 en ville, 10 interurbains) par les 10 conducteurs fictifs de demo:live, avec des
 * véhicules Économique, Confort et Luxe. Les trajets « sur acceptation » reçoivent une demande d'un passager fictif,
 * que le conducteur accepte ou refuse dans l'appli (Espace conducteur > Demandes des passagers).
 * Prix indicatifs de démonstration, non validés ; aucun paiement n'est simulé.
 */

const COMFORT = ['ECONOMIQUE', 'ECONOMIQUE', 'ECONOMIQUE', 'ECONOMIQUE', 'CONFORT', 'CONFORT', 'CONFORT', 'LUXE', 'LUXE', 'LUXE'] as const;
const LUXE_CARS = [['Mercedes-Benz', 'Classe E', 'Noir'], ['Toyota', 'Land Cruiser', 'Blanc'], ['BMW', 'Série 5', 'Gris']] as const;

interface Offer {
  kind: 'URBAN' | 'INTERCITY';
  from: string;
  to: string;
  price: number;
  dayOffset: number;
  hourUtc: number;
  manual: boolean;
}
const URBAN: Omit<Offer, 'kind'>[] = [
  { from: 'Angré', to: 'Plateau', price: 800, dayOffset: 1, hourUtc: 7, manual: true },
  { from: 'Yopougon', to: 'Zone 4', price: 1000, dayOffset: 1, hourUtc: 8, manual: false },
  { from: 'Abobo', to: 'Plateau', price: 700, dayOffset: 1, hourUtc: 6, manual: true },
  { from: 'Riviera Palmeraie', to: 'Marcory', price: 900, dayOffset: 2, hourUtc: 7, manual: false },
  { from: 'Koumassi', to: 'Adjamé', price: 600, dayOffset: 2, hourUtc: 17, manual: true },
  { from: 'Deux-Plateaux', to: 'Port-Bouët', price: 1000, dayOffset: 2, hourUtc: 18, manual: false },
  { from: 'Niangon', to: 'Treichville', price: 800, dayOffset: 3, hourUtc: 7, manual: true },
  { from: 'Cocody', to: 'Yopougon', price: 900, dayOffset: 3, hourUtc: 12, manual: false },
  { from: 'Riviera 2', to: 'Zone 4', price: 700, dayOffset: 4, hourUtc: 8, manual: true },
  { from: 'Attécoubé', to: 'Cocody', price: 700, dayOffset: 4, hourUtc: 17, manual: false },
];
const INTERCITY: Omit<Offer, 'kind'>[] = [
  { from: 'Plateau', to: 'Yamoussoukro', price: 5000, dayOffset: 1, hourUtc: 6, manual: false },
  { from: "Gare routière d'Adjamé", to: 'Bouaké', price: 8000, dayOffset: 2, hourUtc: 6, manual: true },
  { from: 'Cocody', to: 'Grand-Bassam', price: 1500, dayOffset: 2, hourUtc: 9, manual: false },
  { from: 'Yopougon', to: 'Daloa', price: 9000, dayOffset: 3, hourUtc: 6, manual: true },
  { from: 'Zone 4', to: 'San-Pédro', price: 10000, dayOffset: 3, hourUtc: 7, manual: false },
  { from: 'Riviera 2', to: 'Assinie-Mafia', price: 3500, dayOffset: 4, hourUtc: 8, manual: true },
  { from: 'Adjamé', to: 'Korhogo', price: 15000, dayOffset: 4, hourUtc: 5, manual: false },
  { from: 'Plateau', to: 'Abengourou', price: 6000, dayOffset: 5, hourUtc: 7, manual: true },
  { from: 'Abobo', to: 'Agboville', price: 2500, dayOffset: 5, hourUtc: 9, manual: false },
  { from: 'Marcory', to: 'Divo', price: 5000, dayOffset: 6, hourUtc: 6, manual: true },
];

/** Prix de démonstration selon la classe du véhicule (Confort +15 %, Luxe +40 %), arrondi à 100 F. */
const priced = (base: number, comfort: string) => Math.round((base * (comfort === 'LUXE' ? 1.4 : comfort === 'CONFORT' ? 1.15 : 1)) / 100) * 100;

export async function seedOffersDemo(client: Client, now: Date = new Date()): Promise<{ trips: number; requests: number }> {
  const fee = (await client.query<{ id: string; commission_bps: number; service_fee_bps: number; service_fee_min_xof: number }>(
    `SELECT id, commission_bps, service_fee_bps, service_fee_min_xof FROM fee_rules WHERE effective_to IS NULL AND trip_kind IS NULL
      ORDER BY effective_from DESC LIMIT 1`,
  )).rows[0];
  if (!fee) throw new Error('Aucune règle de frais : lancer d’abord pnpm demo:live ou pnpm db:seed:demo.');
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let trips = 0;
  let requests = 0;
  for (const [i, [first, last]] of NAMES.entries()) {
    const driverId = await user(client, LIVE_DEMO_DRIVER_PHONES[i]!, first, last);
    const vehicle = (await client.query<{ id: string }>('SELECT id FROM vehicles WHERE driver_id = $1 LIMIT 1', [driverId])).rows[0];
    if (!vehicle) throw new Error('Conducteurs [DEMO] absents : lancer d’abord pnpm demo:live une fois.');
    const comfort = COMFORT[i]!;
    const luxe = comfort === 'LUXE' ? LUXE_CARS[i - 7]! : null;
    await client.query(
      `UPDATE vehicles SET comfort_class = $2, air_conditioning = $3, make = COALESCE($4, make), model = COALESCE($5, model),
              color = COALESCE($6, color) WHERE id = $1`,
      [vehicle.id, comfort, comfort !== 'ECONOMIQUE', luxe?.[0] ?? null, luxe?.[1] ?? null, luxe?.[2] ?? null],
    );
    const already = await client.query(
      `SELECT 1 FROM trips WHERE driver_id = $1 AND is_demo AND status IN ('PUBLISHED','FULL') AND description LIKE '[DEMO] Trajet proposé%' LIMIT 1`,
      [driverId],
    );
    if (already.rowCount) continue;
    const passengerId = await user(client, passengerPhone(i), PASSENGERS[i]![0], PASSENGERS[i]![1]);

    // Un même véhicule ne fait pas deux trajets à la fois : l'interurbain part deux jours après le trajet en ville.
    const urban = URBAN[i]!;
    for (const offer of [{ ...urban, kind: 'URBAN' as const }, { ...INTERCITY[i]!, dayOffset: urban.dayOffset + 2, kind: 'INTERCITY' as const }]) {
      const a = await place(client, offer.from);
      const b = await place(client, offer.to);
      const est = fallbackEstimate([a, b] as LatLng[], offer.kind);
      const departure = new Date(today + offer.dayOffset * 86_400_000 + offer.hourUtc * 3_600_000);
      const price = priced(offer.price, comfort);
      const tripId = uuidv7();
      await client.query(
        `INSERT INTO trips (id, public_ref, driver_id, vehicle_id, kind, status, departure_at, estimated_arrival_at,
                            seats_offered, acceptance_mode, cancellation_policy_code, description,
                            estimated_distance_m, estimated_duration_s, route_source, is_demo, published_at, route_geometry)
         VALUES ($1, $2, $3, $4, $5, 'PUBLISHED', $6, $7, $8, $9, 'STANDARD', $10, $11, $12, 'HAVERSINE_FALLBACK', true, now(),
                 ST_GeogFromText($13))`,
        [tripId, tripReference(), driverId, vehicle.id, offer.kind, departure, new Date(departure.getTime() + est.durationS * 1000),
         offer.kind === 'URBAN' ? 3 : 4, offer.manual ? 'MANUAL' : 'AUTO',
         `[DEMO] Trajet proposé ${offer.from} – ${offer.to}, véhicule ${comfort.toLowerCase()}.`, est.distanceM, est.durationS,
         `SRID=4326;LINESTRING(${a.lng} ${a.lat},${b.lng} ${b.lat})`],
      );
      const stopIds: string[] = [];
      for (const [seq, p] of [a, b].entries()) {
        const id = uuidv7();
        stopIds.push(id);
        const label = seq === 0 ? offer.from : offer.to;
        await client.query(
          `INSERT INTO trip_stops (id, trip_id, seq, place_id, label, meeting_point, location, location_precision,
                                   planned_at, price_from_origin_xof, is_pickup, is_dropoff)
           VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($8, $7), 4326)::geography, 'APPROX', $9, $10, $11, $12)`,
          [id, tripId, seq, p.id, label, `${label} (point fictif de démo)`, p.lat, p.lng,
           new Date(departure.getTime() + seq * est.durationS * 1000), seq === 0 ? 0 : price, seq === 0, seq === 1],
        );
      }
      trips++;
      if (!offer.manual) continue;
      // Demande d'un passager fictif, à accepter avant 12 h (ou 2 h avant le départ).
      const answerBefore = new Date(Math.min(now.getTime() + 12 * 3_600_000, departure.getTime() - 2 * 3_600_000));
      const commission = Math.round((price * fee.commission_bps) / 10_000);
      const serviceFee = Math.max(fee.service_fee_min_xof, Math.round((price * fee.service_fee_bps) / 10_000));
      await client.query(
        `INSERT INTO bookings (id, reference, trip_id, passenger_id, pickup_stop_id, dropoff_stop_id, pickup_seq, dropoff_seq, seats,
                               status, payment_status, unit_price_xof, subtotal_xof, service_fee_xof, total_xof, commission_xof,
                               driver_net_xof, fee_rule_id, cancellation_policy_code, hold_expires_at, acceptance_deadline, is_demo)
         VALUES ($1, $2, $3, $4, $5, $6, 0, 1, 1, 'PENDING_ACCEPTANCE', 'UNPAID', $7, $7, $8, $9, $10, $11, $12, 'STANDARD', $13, $13, true)`,
        [uuidv7(), bookingReference(), tripId, passengerId, stopIds[0], stopIds[1], price, serviceFee, price + serviceFee,
         commission, price - commission, fee.id, answerBefore],
      );
      requests++;
    }
  }
  return { trips, requests };
}
