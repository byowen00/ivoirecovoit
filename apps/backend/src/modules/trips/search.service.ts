import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { ApiError } from '../../common/api-error';
import { roundCoord } from '../../common/geo';
import { DB, type Db } from '../../database/database.module';
import { DriversService } from '../drivers/drivers.service';
import { PlacesService } from '../places/places.service';
import { SettingsService } from '../users/settings.service';
import { type AvailabilityQuery, decodeOffset, encodeOffset, type SearchQuery } from './trips.schemas';

/** Rayon par défaut autour du point demandé (EF-41) : 5 km en ville, 15 km entre villes. */
export const DEFAULT_RADIUS_M = { URBAN: 5_000, INTERCITY: 15_000 } as const;

const tripNotFound = () => new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Trajet introuvable.');

interface Endpoint {
  lat: number;
  lng: number;
  label: string;
  placeIds: string[];
}

interface SearchRow {
  trip_id: string;
  public_ref: string;
  kind: 'URBAN' | 'INTERCITY';
  status: string;
  acceptance_mode: 'AUTO' | 'MANUAL';
  p_id: string;
  p_seq: number;
  p_label: string;
  p_planned: Date;
  p_lat: number;
  p_lng: number;
  p_dist: number;
  d_id: string;
  d_seq: number;
  d_label: string;
  d_planned: Date;
  d_dist: number;
  unit_price: number;
  seats_available: number;
  segment_distance_m: number | null;
  driver_id: string;
  display_name: string;
  rating_avg: number | null;
  rating_count: number;
  make: string;
  model: string;
  color: string;
  is_demo: boolean;
  route_source: string | null;
}

/**
 * Recherche par segment (EF-42) : un trajet correspond si un point de montée (origine ou arrêt) est proche
 * du départ demandé ET qu'un point de descente postérieur est proche de l'arrivée. Places restantes calculées
 * sur les segments réellement parcourus par le passager (doc 05 §3).
 */
@Injectable()
export class SearchService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly places: PlacesService,
    private readonly settings: SettingsService,
    private readonly drivers: DriversService,
  ) {}

  private async endpoint(side: 'from' | 'to', q: SearchQuery): Promise<Endpoint> {
    const placeId = q[`${side}PlaceId`];
    if (placeId) {
      const place = await this.places.byId(placeId);
      if (!place) {
        throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Certains champs sont invalides.', {
          fields: { [`${side}PlaceId`]: 'Lieu inconnu.' },
        });
      }
      return { lat: place.lat, lng: place.lng, label: place.label, placeIds: await this.places.withDescendants(placeId) };
    }
    const lat = q[`${side}Lat`]!;
    const lng = q[`${side}Lng`]!;
    const near = await this.places.reverse(lat, lng);
    return { lat, lng, label: near ? `Près de ${near.label}` : 'Point choisi sur la carte', placeIds: [] };
  }

  async search(q: SearchQuery) {
    const [from, to] = await Promise.all([this.endpoint('from', q), this.endpoint('to', q)]);
    const minMinutes = (await this.settings.get<number>('booking.min_minutes_before_departure')) ?? 30;
    const notBefore = new Date(Date.now() + minMinutes * 60_000);
    // Jour demandé en heure d'Abidjan (UTC+0 toute l'année).
    const dayStart = q.date ? new Date(`${q.date}T${q.timeFrom ?? '00:00'}:00Z`) : notBefore;
    const dayEnd = q.date ? new Date(`${q.date}T${q.timeTo ?? '23:59'}:59.999Z`) : new Date(Date.now() + 90 * 86_400_000);
    const windowStart = dayStart > notBefore ? dayStart : notBefore;
    const radius = q.radiusKm ? q.radiusKm * 1000 : null;
    const offset = decodeOffset(q.cursor);

    const order = {
      departure: sql`p_planned ASC, unit_price ASC`,
      price: sql`unit_price ASC, p_planned ASC`,
      distance: sql`(p_dist + d_dist) ASC, p_planned ASC`,
      rating: sql`rating_avg DESC NULLS LAST, rating_count DESC, p_planned ASC`,
    }[q.sort];

    const fromIds = from.placeIds.length ? from.placeIds : [null];
    const toIds = to.placeIds.length ? to.placeIds : [null];
    const { rows } = await sql<SearchRow>`
      WITH qp AS (
        SELECT ST_SetSRID(ST_MakePoint(${from.lng}, ${from.lat}), 4326)::geography AS f,
               ST_SetSRID(ST_MakePoint(${to.lng}, ${to.lat}), 4326)::geography AS t
      ),
      cand AS (
        SELECT DISTINCT ON (tr.id)
               tr.id AS trip_id, tr.public_ref, tr.kind, tr.status, tr.acceptance_mode, tr.seats_offered, tr.driver_id,
               tr.vehicle_id, tr.is_demo, tr.route_source,
               p.id AS p_id, p.seq AS p_seq, p.label AS p_label, p.planned_at AS p_planned,
               ST_Y(p.location::geometry) AS p_lat, ST_X(p.location::geometry) AS p_lng,
               round(ST_Distance(p.location, qp.f))::int AS p_dist,
               d.id AS d_id, d.seq AS d_seq, d.label AS d_label, d.planned_at AS d_planned,
               round(ST_Distance(d.location, qp.t))::int AS d_dist,
               (d.price_from_origin_xof - p.price_from_origin_xof)::int AS unit_price
          FROM trip_stops p
          JOIN trips tr ON tr.id = p.trip_id
          JOIN trip_stops d ON d.trip_id = p.trip_id AND d.seq > p.seq AND d.is_dropoff
          CROSS JOIN qp
         WHERE tr.status IN ('PUBLISHED','FULL')
           AND p.is_pickup
           AND p.planned_at >= ${windowStart} AND p.planned_at <= ${dayEnd}
           AND (ST_DWithin(p.location, qp.f, coalesce(${radius}::float, CASE tr.kind WHEN 'URBAN' THEN ${DEFAULT_RADIUS_M.URBAN}::float ELSE ${DEFAULT_RADIUS_M.INTERCITY}::float END))
                OR p.place_id = ANY(${fromIds}::uuid[]))
           AND (ST_DWithin(d.location, qp.t, coalesce(${radius}::float, CASE tr.kind WHEN 'URBAN' THEN ${DEFAULT_RADIUS_M.URBAN}::float ELSE ${DEFAULT_RADIUS_M.INTERCITY}::float END))
                OR d.place_id = ANY(${toIds}::uuid[]))
         ORDER BY tr.id, ST_Distance(p.location, qp.f) + ST_Distance(d.location, qp.t), p.seq, d.seq DESC
      ),
      scored AS (
        SELECT c.*, c.seats_offered - trip_max_occupancy(c.trip_id, c.p_seq, c.d_seq) AS seats_available,
               (SELECT sum(ST_Distance(a.location, b.location))::int FROM trip_stops a
                  JOIN trip_stops b ON b.trip_id = a.trip_id AND b.seq = a.seq + 1
                 WHERE a.trip_id = c.trip_id AND a.seq >= c.p_seq AND b.seq <= c.d_seq) AS segment_distance_m
          FROM cand c
      )
      SELECT s.*, u.display_name, dp.rating_avg, dp.rating_count, v.make, v.model, v.color
        FROM scored s
        JOIN users u ON u.id = s.driver_id AND u.status = 'ACTIVE'
        JOIN driver_profiles dp ON dp.user_id = s.driver_id AND dp.verification_status = 'APPROVED'
        JOIN vehicles v ON v.id = s.vehicle_id
       WHERE s.seats_available >= ${q.seats}
         AND (${q.maxPriceXof ?? null}::int IS NULL OR s.unit_price <= ${q.maxPriceXof ?? null}::int)
         AND (NOT ${q.directOnly} OR s.d_seq = s.p_seq + 1)
       ORDER BY ${order}, s.trip_id
       OFFSET ${offset} LIMIT ${q.limit + 1}`.execute(this.db);

    const page = rows.slice(0, q.limit);
    return {
      data: page.map((r) => ({
        tripId: r.trip_id,
        publicRef: r.public_ref,
        kind: r.kind,
        pickup: {
          stopId: r.p_id,
          label: r.p_label,
          plannedAt: r.p_planned,
          distanceFromQueryM: r.p_dist,
          lat: roundCoord(r.p_lat),
          lng: roundCoord(r.p_lng),
        },
        dropoff: { stopId: r.d_id, label: r.d_label, plannedAt: r.d_planned, distanceFromQueryM: r.d_dist },
        estimatedDurationS: Math.round((r.d_planned.getTime() - r.p_planned.getTime()) / 1000),
        // Distance à vol d'oiseau entre arrêts du segment : ordre de grandeur, pas une distance routière.
        estimatedDistanceM: r.segment_distance_m,
        isEstimate: true,
        unitPriceXof: r.unit_price,
        seatsAvailable: r.seats_available,
        acceptanceMode: r.acceptance_mode,
        driver: { id: r.driver_id, displayName: r.display_name, ratingAvg: r.rating_avg, ratingCount: r.rating_count, verified: true },
        vehicle: { make: r.make, model: r.model, color: r.color },
        stopsCount: r.d_seq - r.p_seq - 1,
        isDemo: r.is_demo,
      })),
      nextCursor: rows.length > q.limit ? encodeOffset(offset + q.limit) : null,
      query: {
        from: { label: from.label, lat: from.lat, lng: from.lng },
        to: { label: to.label, lat: to.lat, lng: to.lng },
        seats: q.seats,
        date: q.date ?? null,
      },
    };
  }

  /** Personne autorisée à voir les coordonnées exactes et l'immatriculation : conducteur ou passager confirmé. */
  private async privileged(tripId: string, driverId: string, viewerId?: string): Promise<boolean> {
    if (!viewerId) return false;
    if (viewerId === driverId) return true;
    const b = await this.db
      .selectFrom('bookings')
      .select('id')
      .where('trip_id', '=', tripId)
      .where('passenger_id', '=', viewerId)
      .where('status', 'in', ['CONFIRMED', 'COMPLETED'])
      .executeTakeFirst();
    return !!b;
  }

  /** Détail public d'un trajet (écran 6). Brouillons invisibles. */
  async publicDetail(tripId: string, viewerId?: string) {
    const trip = await this.db
      .selectFrom('trips')
      .innerJoin('vehicles', 'vehicles.id', 'trips.vehicle_id')
      .innerJoin('cancellation_policies', 'cancellation_policies.code', 'trips.cancellation_policy_code')
      .select([
        'trips.id', 'trips.public_ref', 'trips.status', 'trips.kind', 'trips.driver_id', 'trips.departure_at', 'trips.estimated_arrival_at',
        'trips.estimated_distance_m', 'trips.estimated_duration_s', 'trips.route_source', 'trips.seats_offered', 'trips.acceptance_mode',
        'trips.allows_cash', 'trips.luggage_policy', 'trips.description', 'trips.instructions', 'trips.is_demo',
        'trips.cancellation_reason', 'vehicles.make', 'vehicles.model', 'vehicles.color', 'vehicles.plate_number',
        'cancellation_policies.code as policy_code', 'cancellation_policies.label as policy_label', 'cancellation_policies.rules as policy_rules',
      ])
      .where('trips.id', '=', tripId)
      .where('trips.status', '<>', 'DRAFT')
      .executeTakeFirst();
    if (!trip) throw tripNotFound();
    const exact = await this.privileged(tripId, trip.driver_id, viewerId);
    const [stops, segments, geometry, driver] = await Promise.all([
      this.db
        .selectFrom('trip_stops')
        .select(['id', 'seq', 'label', 'meeting_point', 'location_precision', 'planned_at', 'price_from_origin_xof', 'is_pickup', 'is_dropoff',
                 sql<number>`ST_Y(location::geometry)`.as('lat'), sql<number>`ST_X(location::geometry)`.as('lng')])
        .where('trip_id', '=', tripId)
        .orderBy('seq')
        .execute(),
      sql<{ seq: number; occ: number }>`
        SELECT g.seq, trip_max_occupancy(${tripId}::uuid, g.seq, g.seq + 1) AS occ
          FROM generate_series(0, (SELECT max(seq) - 1 FROM trip_stops WHERE trip_id = ${tripId}::uuid)) g(seq)`.execute(this.db),
      sql<{ coords: [number, number][] | null }>`
        SELECT (SELECT json_agg(json_build_array(ST_Y(geom), ST_X(geom))) FROM ST_DumpPoints(route_geometry::geometry) AS dp(path, geom)) AS coords
          FROM trips WHERE id = ${tripId}::uuid`.execute(this.db),
      this.drivers.publicProfile(trip.driver_id).catch(() => null),
    ]);
    const coord = (n: number) => (exact ? n : roundCoord(n));
    return {
      id: trip.id,
      publicRef: trip.public_ref,
      status: trip.status,
      kind: trip.kind,
      departureAt: trip.departure_at,
      estimatedArrivalAt: trip.estimated_arrival_at,
      estimatedDistanceM: trip.estimated_distance_m,
      estimatedDurationS: trip.estimated_duration_s,
      routeSource: trip.route_source,
      isEstimate: true,
      coordinatesPrecision: exact ? 'EXACT' : 'ROUNDED',
      geometry: (geometry.rows[0]?.coords ?? []).map(([lat, lng]) => [coord(lat), coord(lng)]),
      seatsOffered: trip.seats_offered,
      segments: segments.rows.map((s) => ({ fromSeq: s.seq, toSeq: s.seq + 1, seatsAvailable: Math.max(0, trip.seats_offered - s.occ) })),
      stops: stops.map((s) => ({
        id: s.id, seq: s.seq, label: s.label, meetingPoint: s.meeting_point, lat: coord(s.lat), lng: coord(s.lng),
        locationPrecision: s.location_precision, plannedAt: s.planned_at, priceFromOriginXof: s.price_from_origin_xof,
        isPickup: s.is_pickup, isDropoff: s.is_dropoff,
      })),
      driver: driver
        ? {
            id: driver.id, displayName: driver.displayName, photoUrl: driver.photoUrl, ratingAvg: driver.ratingAvg, ratingCount: driver.ratingCount,
            completedTripsCount: driver.completedTripsCount, verified: true, memberSince: driver.memberSince, preferences: driver.preferences,
          }
        : null,
      vehicle: { make: trip.make, model: trip.model, color: trip.color, plateNumber: exact ? trip.plate_number : null },
      acceptanceMode: trip.acceptance_mode,
      cancellationPolicy: { code: trip.policy_code, label: trip.policy_label, rules: trip.policy_rules },
      allowsCash: trip.allows_cash,
      luggagePolicy: trip.luggage_policy,
      description: trip.description,
      instructions: trip.instructions,
      cancellationReason: trip.status === 'CANCELLED' ? trip.cancellation_reason : null,
      isDemo: trip.is_demo,
      viewer: { isDriver: viewerId === trip.driver_id, isConfirmedPassenger: exact && viewerId !== trip.driver_id },
    };
  }

  async availability(tripId: string, q: AvailabilityQuery) {
    const { rows } = await sql<{ status: string; seats_offered: number; p_seq: number; d_seq: number; p_price: number; d_price: number;
                                 p_pickup: boolean; d_dropoff: boolean; p_label: string; d_label: string; occ: number }>`
      SELECT t.status, t.seats_offered, p.seq AS p_seq, d.seq AS d_seq, p.price_from_origin_xof AS p_price,
             d.price_from_origin_xof AS d_price, p.is_pickup AS p_pickup, d.is_dropoff AS d_dropoff, p.label AS p_label,
             d.label AS d_label, trip_max_occupancy(t.id, p.seq, d.seq) AS occ
        FROM trips t
        JOIN trip_stops p ON p.trip_id = t.id AND p.id = ${q.pickupStopId}::uuid
        JOIN trip_stops d ON d.trip_id = t.id AND d.id = ${q.dropoffStopId}::uuid
       WHERE t.id = ${tripId}::uuid AND t.status <> 'DRAFT'`.execute(this.db);
    const r = rows[0];
    if (!r) throw tripNotFound();
    if (!(r.d_seq > r.p_seq) || !r.p_pickup || !r.d_dropoff) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'INVALID_SEGMENT', 'Le point de descente doit suivre le point de montée.');
    }
    const bookable = ['PUBLISHED', 'FULL'].includes(r.status);
    return {
      pickup: { stopId: q.pickupStopId, label: r.p_label },
      dropoff: { stopId: q.dropoffStopId, label: r.d_label },
      unitPriceXof: r.d_price - r.p_price,
      seatsAvailable: bookable ? Math.max(0, r.seats_offered - r.occ) : 0,
      bookable,
    };
  }
}
