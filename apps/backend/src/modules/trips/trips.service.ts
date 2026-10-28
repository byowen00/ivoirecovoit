import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { ApiError } from '../../common/api-error';
import { tripReference, uuidv7 } from '../../common/ids';
import { DB, type Db } from '../../database/database.module';
import type { Database, TripKind, TripStatus } from '../../database/types';
import { AuditService, type RequestContext } from '../../infra/audit.service';
import { DriversService } from '../drivers/drivers.service';
import { PlacesService } from '../places/places.service';
import { haversineMeters } from '../routing/haversine';
import { type RouteEstimate, RoutingService } from '../routing/routing.service';
import { SettingsService } from '../users/settings.service';
import { cancelTripBookings, outbox, PENDING_STATUSES, setActor, syncTripFullStatus } from '../bookings/lifecycle';
import { checkStopPrices, type PriceBounds, suggestFullPrice, suggestStopPrices } from './pricing';
import { assertTransition, START_WINDOW } from './trip-state';
import {
  type CancelInput,
  type CreateTripInput,
  decodeOffset,
  type DuplicateInput,
  encodeOffset,
  type MineQuery,
  type PreviewTripInput,
  type StopInput,
  type UpdateTripInput,
} from './trips.schemas';

/** Temps d'arrêt compté à chaque arrêt intermédiaire pour estimer les horaires de passage. */
export const STOP_DWELL_S = 5 * 60;
const MIN_STOP_GAP_M = 200;
const BLOCKING = ['PENDING_ACCEPTANCE', 'PENDING_PAYMENT', 'CONFIRMED'] as const;

const tripNotFound = () => new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Trajet introuvable.');
const unprocessable = (code: string, message: string, details?: Record<string, unknown>) =>
  new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, code, message, details);

export interface PlannedStop {
  placeId: string | null;
  label: string;
  meetingPoint: string | null;
  lat: number;
  lng: number;
  locationPrecision: 'EXACT' | 'APPROX';
  isPickup: boolean;
  isDropoff: boolean;
  plannedAt: Date;
  priceFromOriginXof: number;
}

export interface TripPlan {
  kind: TripKind;
  departureAt: Date;
  estimatedArrivalAt: Date;
  stops: PlannedStop[];
  route: RouteEstimate;
  bounds: PriceBounds;
  suggestedPriceXof: number;
}

function isConstraint(err: unknown, code: string, name?: string): boolean {
  const e = err as { code?: string; constraint?: string };
  return e.code === code && (!name || e.constraint === name);
}

/**
 * Trajets côté conducteur (EF-30 à EF-39) : création, publication, modification, duplication, annulation,
 * démarrage et fin. Distances, durées et horaires de passage sont des ESTIMATIONS (isEstimate: true).
 */
@Injectable()
export class TripsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly routing: RoutingService,
    private readonly places: PlacesService,
    private readonly settings: SettingsService,
    private readonly drivers: DriversService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- calcul de l'itinéraire et des prix

  async priceBounds(): Promise<PriceBounds & { suggestedXofPerKm: number }> {
    const [minXof, maxXof, cap, perKm] = await Promise.all([
      this.settings.get<number>('trip.price_min_xof'),
      this.settings.get<number>('trip.price_max_xof'),
      this.settings.get<number | null>('trip.price_cap_xof_per_km'),
      this.settings.get<number>('trip.suggested_price_xof_per_km'),
    ]);
    return { minXof: minXof ?? 500, maxXof: maxXof ?? 30000, capXofPerKm: cap ?? null, suggestedXofPerKm: perKm ?? 20 };
  }

  private async resolveStops(stops: StopInput[]) {
    const resolved = [];
    for (const [i, s] of stops.entries()) {
      const place = s.placeId ? await this.places.byId(s.placeId) : undefined;
      if (s.placeId && !place) {
        throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Certains champs sont invalides.', {
          fields: { [`stops.${i}.placeId`]: 'Lieu inconnu.' },
        });
      }
      const exact = s.lat !== undefined && s.lng !== undefined;
      resolved.push({
        placeId: place?.id ?? null,
        label: s.label ?? place!.label,
        meetingPoint: s.meetingPoint ?? null,
        lat: exact ? s.lat! : place!.lat,
        lng: exact ? s.lng! : place!.lng,
        locationPrecision: exact ? ('EXACT' as const) : place!.locationPrecision,
        isPickup: i < stops.length - 1,
        isDropoff: i > 0,
      });
    }
    for (let i = 1; i < resolved.length; i++) {
      if (haversineMeters(resolved[i - 1]!, resolved[i]!) < MIN_STOP_GAP_M) {
        throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Certains champs sont invalides.', {
          fields: { [`stops.${i}`]: 'Deux arrêts consécutifs sont trop proches (200 m minimum).' },
        });
      }
    }
    return resolved;
  }

  /** Itinéraire estimé, horaires de passage et prix par arrêt. Lève PRICE_* si strict et prix invalides. */
  async buildPlan(
    input: { kind: TripKind; departureAt: Date; stops: StopInput[]; pricePerSeatXof?: number; stopPricesXof?: number[] },
    strict = true,
  ): Promise<TripPlan & { priceProblems: ReturnType<typeof checkStopPrices> }> {
    const resolved = await this.resolveStops(input.stops);
    const route = await this.routing.estimate(resolved, input.kind);
    const { suggestedXofPerKm, ...bounds } = await this.priceBounds();
    const suggestedPriceXof = suggestFullPrice(route.distanceM, suggestedXofPerKm, bounds);
    const legDistances = route.legs.map((l) => l.distanceM);
    const prices =
      input.stopPricesXof ?? suggestStopPrices(legDistances, input.pricePerSeatXof ?? suggestedPriceXof);
    const priceProblems = checkStopPrices(prices, legDistances, bounds);
    if (strict && priceProblems.length) {
      const formatOnly = priceProblems.every((p) => ['NOT_MULTIPLE_OF_50', 'ORIGIN_NOT_ZERO', 'NOT_INCREASING'].includes(p.code));
      throw unprocessable(
        formatOnly ? 'PRICE_INVALID' : 'PRICE_OUT_OF_BOUNDS',
        formatOnly
          ? 'Les prix doivent être des multiples de 50 FCFA, croissants d’un arrêt à l’autre.'
          : `Chaque segment doit coûter entre ${bounds.minXof} et ${bounds.maxXof} FCFA par place.`,
        { problems: priceProblems, ...bounds },
      );
    }
    let elapsedS = 0;
    const stops = resolved.map((s, i) => {
      if (i > 0) elapsedS += route.legs[i - 1]!.durationS + (i > 1 ? STOP_DWELL_S : 0);
      return { ...s, plannedAt: new Date(input.departureAt.getTime() + elapsedS * 1000), priceFromOriginXof: prices[i]! };
    });
    return {
      kind: input.kind,
      departureAt: input.departureAt,
      estimatedArrivalAt: stops.at(-1)!.plannedAt,
      stops,
      route,
      bounds,
      suggestedPriceXof,
      priceProblems,
    };
  }

  async preview(userId: string, input: PreviewTripInput) {
    await this.drivers.requireApproved(userId);
    const plan = await this.buildPlan(input, false);
    return {
      estimatedDistanceM: plan.route.distanceM,
      estimatedDurationS: plan.route.durationS,
      routeSource: plan.route.source,
      isEstimate: true,
      geometry: plan.route.geometry,
      estimatedArrivalAt: plan.estimatedArrivalAt,
      stops: plan.stops,
      price: {
        suggestedPriceXof: plan.suggestedPriceXof,
        minXof: plan.bounds.minXof,
        maxXof: plan.bounds.maxXof,
        capXofPerKm: plan.bounds.capXofPerKm,
        problems: plan.priceProblems,
      },
    };
  }

  // ---------------------------------------------------------------- contrôles de publication

  private async publishChecks(
    trx: Transaction<Database>,
    p: { driverId: string; vehicleId: string; departureAt: Date; seatsOffered: number },
  ): Promise<void> {
    const [minMinutes, maxDays] = await Promise.all([
      this.settings.get<number>('trip.min_minutes_before_publish'),
      this.settings.get<number>('trip.max_days_ahead'),
    ]);
    const now = Date.now();
    const earliest = now + (minMinutes ?? 30) * 60_000;
    const latest = now + (maxDays ?? 90) * 86_400_000;
    if (p.departureAt.getTime() < earliest || p.departureAt.getTime() > latest) {
      throw unprocessable(
        'DEPARTURE_OUT_OF_RANGE',
        `Le départ doit être au moins ${minMinutes ?? 30} min après la publication et au plus dans ${maxDays ?? 90} jours.`,
        { earliest: new Date(earliest), latest: new Date(latest) },
      );
    }
    const departureDay = p.departureAt.toISOString().slice(0, 10);
    const driver = await trx
      .selectFrom('driver_profiles')
      .select(['verification_status', 'license_expires_on'])
      .where('user_id', '=', p.driverId)
      .executeTakeFirst();
    if (driver?.verification_status !== 'APPROVED') {
      throw new ApiError(HttpStatus.FORBIDDEN, 'DRIVER_NOT_VERIFIED', 'Votre profil conducteur doit être vérifié pour publier.');
    }
    if (driver.license_expires_on && driver.license_expires_on < departureDay) {
      throw unprocessable('DOCUMENT_EXPIRED', 'Votre permis de conduire sera expiré à la date du trajet.', { docType: 'DRIVING_LICENSE' });
    }
    const vehicle = await this.ownedVehicle(trx, p.driverId, p.vehicleId);
    if (vehicle.verification_status !== 'APPROVED' || !vehicle.is_active) {
      throw unprocessable('VEHICLE_NOT_APPROVED', 'Ce véhicule n’est pas encore vérifié.');
    }
    if (p.seatsOffered > vehicle.seats_capacity) throw seatsExceed(vehicle.seats_capacity);
    // Assurance et visite technique validées et valables le jour du trajet (EF-25).
    for (const docType of ['INSURANCE', 'TECHNICAL_INSPECTION'] as const) {
      const ok = await trx
        .selectFrom('vehicle_documents')
        .select('id')
        .where('vehicle_id', '=', p.vehicleId)
        .where('doc_type', '=', docType)
        .where('status', '=', 'APPROVED')
        .where('expires_on', '>=', departureDay)
        .executeTakeFirst();
      if (!ok) {
        throw unprocessable(
          'DOCUMENT_EXPIRED',
          docType === 'INSURANCE'
            ? 'L’assurance du véhicule n’est pas valable à la date du trajet.'
            : 'La visite technique du véhicule n’est pas valable à la date du trajet.',
          { docType },
        );
      }
    }
  }

  private async ownedVehicle(trx: Db | Transaction<Database>, driverId: string, vehicleId: string) {
    const v = await trx
      .selectFrom('vehicles')
      .select(['id', 'seats_capacity', 'verification_status', 'is_active'])
      .where('id', '=', vehicleId)
      .where('driver_id', '=', driverId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!v) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Certains champs sont invalides.', {
        fields: { vehicleId: 'Véhicule inconnu.' },
      });
    }
    return v;
  }

  private async checkOptions(input: { cancellationPolicy?: string; allowsCash?: boolean }) {
    if (input.cancellationPolicy) {
      const policy = await this.db
        .selectFrom('cancellation_policies')
        .select('code')
        .where('code', '=', input.cancellationPolicy)
        .where('is_active', '=', true)
        .executeTakeFirst();
      if (!policy) {
        throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Certains champs sont invalides.', {
          fields: { cancellationPolicy: 'Politique d’annulation inconnue.' },
        });
      }
    }
    if (input.allowsCash && !(await this.settings.get<boolean>('payments.cash_enabled'))) {
      throw unprocessable('CASH_DISABLED', 'Le paiement en espèces n’est pas proposé pour le moment.');
    }
  }

  // ---------------------------------------------------------------- écriture

  private async insertStops(trx: Transaction<Database>, tripId: string, stops: PlannedStop[]): Promise<void> {
    for (const [seq, s] of stops.entries()) {
      await trx
        .insertInto('trip_stops')
        .values({
          id: uuidv7(),
          trip_id: tripId,
          seq,
          place_id: s.placeId,
          label: s.label,
          meeting_point: s.meetingPoint,
          location: sql<string>`ST_SetSRID(ST_MakePoint(${s.lng}, ${s.lat}), 4326)::geography`,
          location_precision: s.locationPrecision,
          planned_at: s.plannedAt,
          price_from_origin_xof: s.priceFromOriginXof,
          is_pickup: s.isPickup,
          is_dropoff: s.isDropoff,
        })
        .execute();
    }
  }

  private geometrySql(route: RouteEstimate) {
    const pts = route.geometry.length >= 2 ? route.geometry : [];
    if (!pts.length) return null;
    return sql<string>`ST_GeogFromText(${`SRID=4326;LINESTRING(${pts.map(([lat, lng]) => `${lng} ${lat}`).join(',')})`})`;
  }

  /** Traduit les contraintes d'exclusion en erreurs lisibles. */
  private overlapError(err: unknown): never {
    if (isConstraint(err, '23P01', 'trips_vehicle_no_overlap')) {
      throw new ApiError(HttpStatus.CONFLICT, 'VEHICLE_OVERLAP', 'Ce véhicule a déjà un trajet publié sur ce créneau.');
    }
    if (isConstraint(err, '23P01', 'trips_driver_no_overlap')) {
      throw new ApiError(HttpStatus.CONFLICT, 'DRIVER_OVERLAP', 'Vous avez déjà un trajet publié sur ce créneau.');
    }
    throw err;
  }

  async create(userId: string, input: CreateTripInput, ctx: RequestContext) {
    await this.drivers.requireApproved(userId);
    await this.checkOptions(input);
    const vehicle = await this.ownedVehicle(this.db, userId, input.vehicleId);
    if (input.seatsOffered > vehicle.seats_capacity) throw seatsExceed(vehicle.seats_capacity);
    const plan = await this.buildPlan(input);
    const id = uuidv7();
    try {
      await this.db.transaction().execute(async (trx) => {
        if (input.publish) {
          await this.publishChecks(trx, { driverId: userId, vehicleId: input.vehicleId, departureAt: plan.departureAt, seatsOffered: input.seatsOffered });
        }
        await trx
          .insertInto('trips')
          .values({
            id,
            public_ref: tripReference(),
            driver_id: userId,
            vehicle_id: input.vehicleId,
            kind: input.kind,
            status: input.publish ? 'PUBLISHED' : 'DRAFT',
            departure_at: plan.departureAt,
            estimated_arrival_at: plan.estimatedArrivalAt,
            seats_offered: input.seatsOffered,
            acceptance_mode: input.acceptanceMode,
            cancellation_policy_code: input.cancellationPolicy,
            allows_cash: input.allowsCash,
            luggage_policy: input.luggagePolicy,
            description: input.description ?? null,
            instructions: input.instructions ?? null,
            estimated_distance_m: plan.route.distanceM,
            estimated_duration_s: Math.round((plan.estimatedArrivalAt.getTime() - plan.departureAt.getTime()) / 1000),
            route_geometry: this.geometrySql(plan.route),
            route_source: plan.route.source,
            published_at: input.publish ? new Date() : null,
          })
          .execute();
        await this.insertStops(trx, id, plan.stops);
        await this.audit.log({ actorId: userId, action: input.publish ? 'trip.publish' : 'trip.create', targetType: 'trip', targetId: id, ctx }, trx);
      });
    } catch (err) {
      this.overlapError(err);
    }
    return this.manageView(userId, id);
  }

  private async owned(trx: Db | Transaction<Database>, userId: string, tripId: string, lock = false) {
    let q = trx.selectFrom('trips').selectAll().where('id', '=', tripId).where('driver_id', '=', userId);
    if (lock) q = q.forUpdate();
    const trip = await q.executeTakeFirst();
    if (!trip) throw tripNotFound();
    return trip;
  }

  private async activeBookings(trx: Db | Transaction<Database>, tripId: string): Promise<number> {
    const row = await trx
      .selectFrom('bookings')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('trip_id', '=', tripId)
      .where('status', 'in', BLOCKING)
      .where(sql<boolean>`(hold_expires_at IS NULL OR hold_expires_at > now() OR status = 'CONFIRMED')`)
      .executeTakeFirstOrThrow();
    return row.n;
  }

  private async maxOccupancy(trx: Db | Transaction<Database>, tripId: string): Promise<number> {
    const { rows } = await sql<{ occ: number }>`
      SELECT trip_max_occupancy(${tripId}::uuid, 0, (SELECT max(seq) FROM trip_stops WHERE trip_id = ${tripId}::uuid)) AS occ`.execute(trx);
    return rows[0]?.occ ?? 0;
  }

  /** PUBLISHED <-> FULL selon l'occupation du segment le plus chargé (doc 05 §1). */
  async syncFullStatus(trx: Transaction<Database>, tripId: string): Promise<void> {
    await syncTripFullStatus(trx, tripId);
  }

  async publish(userId: string, tripId: string, ctx: RequestContext) {
    await this.drivers.requireApproved(userId);
    try {
      await this.db.transaction().execute(async (trx) => {
        const trip = await this.owned(trx, userId, tripId, true);
        assertTransition(trip.status, 'PUBLISHED');
        await this.publishChecks(trx, { driverId: userId, vehicleId: trip.vehicle_id, departureAt: trip.departure_at, seatsOffered: trip.seats_offered });
        // Un brouillon ancien peut avoir des prix sortis des bornes actuelles : on revérifie.
        const stops = await trx.selectFrom('trip_stops').select(['price_from_origin_xof']).where('trip_id', '=', tripId).orderBy('seq').execute();
        const { minXof, maxXof, capXofPerKm } = await this.priceBounds();
        const bounds = { minXof, maxXof, capXofPerKm };
        const legs = await this.legDistances(trx, tripId);
        const problems = checkStopPrices(stops.map((s) => s.price_from_origin_xof), legs, bounds);
        if (problems.length) throw unprocessable('PRICE_OUT_OF_BOUNDS', 'Les prix de ce brouillon sont hors des bornes actuelles.', { problems, ...bounds });
        await trx.updateTable('trips').set({ status: 'PUBLISHED', published_at: new Date() }).where('id', '=', tripId).execute();
        await this.audit.log({ actorId: userId, action: 'trip.publish', targetType: 'trip', targetId: tripId, ctx }, trx);
      });
    } catch (err) {
      this.overlapError(err);
    }
    return this.manageView(userId, tripId);
  }

  /** Distances à vol d'oiseau × coefficient entre arrêts enregistrés (pour revérifier le plafond par km). */
  private async legDistances(trx: Db | Transaction<Database>, tripId: string): Promise<number[]> {
    const { rows } = await sql<{ d: number }>`
      SELECT round(ST_Distance(a.location, b.location) * 1.3)::int AS d
        FROM trip_stops a JOIN trip_stops b ON b.trip_id = a.trip_id AND b.seq = a.seq + 1
       WHERE a.trip_id = ${tripId}::uuid ORDER BY a.seq`.execute(trx);
    return rows.map((r) => r.d);
  }

  async update(userId: string, tripId: string, ifMatch: string | undefined, input: UpdateTripInput, ctx: RequestContext) {
    await this.drivers.requireApproved(userId);
    const expected = Number(ifMatch?.replace(/^W\//, '').replace(/"/g, ''));
    if (!ifMatch || !Number.isInteger(expected)) {
      throw new ApiError(HttpStatus.PRECONDITION_REQUIRED, 'IF_MATCH_REQUIRED', 'En-tête If-Match (version du trajet) obligatoire.');
    }
    await this.checkOptions(input);
    const current = await this.owned(this.db, userId, tripId);
    if (!['DRAFT', 'PUBLISHED', 'FULL'].includes(current.status)) {
      throw new ApiError(HttpStatus.CONFLICT, 'INVALID_STATE_TRANSITION', 'Un trajet commencé, terminé ou annulé ne peut plus être modifié.');
    }
    const routeChanged = input.stops !== undefined;
    const timeChanged = input.departureAt !== undefined && input.departureAt.getTime() !== current.departure_at.getTime();
    const pricesChanged = input.stopPricesXof !== undefined || input.pricePerSeatXof !== undefined;

    const existingStops = await this.db
      .selectFrom('trip_stops')
      .select(['seq', 'place_id', 'label', 'meeting_point', 'location_precision', 'price_from_origin_xof',
               sql<number>`ST_Y(location::geometry)`.as('lat'), sql<number>`ST_X(location::geometry)`.as('lng')])
      .where('trip_id', '=', tripId)
      .orderBy('seq')
      .execute();

    // Nouveau plan si l'itinéraire, l'heure ou les prix changent (horaires de passage et prix recalculés).
    let plan: TripPlan | null = null;
    if (routeChanged || timeChanged || pricesChanged) {
      const stops: StopInput[] =
        input.stops ??
        existingStops.map((s) => ({
          placeId: s.place_id ?? undefined,
          label: s.label,
          meetingPoint: s.meeting_point ?? undefined,
          ...(s.location_precision === 'EXACT' || !s.place_id ? { lat: s.lat, lng: s.lng } : {}),
        }));
      plan = await this.buildPlan({
        kind: current.kind,
        departureAt: input.departureAt ?? current.departure_at,
        stops,
        pricePerSeatXof: input.pricePerSeatXof,
        stopPricesXof: input.stopPricesXof ?? (routeChanged || input.pricePerSeatXof !== undefined ? undefined : existingStops.map((s) => s.price_from_origin_xof)),
      });
    }

    try {
      await this.db.transaction().execute(async (trx) => {
        const trip = await this.owned(trx, userId, tripId, true);
        if (trip.version !== expected) {
          throw new ApiError(HttpStatus.CONFLICT, 'VERSION_CONFLICT', 'Le trajet a été modifié entre-temps. Rechargez-le.', { version: trip.version });
        }
        const booked = await this.activeBookings(trx, tripId);
        if (booked > 0 && routeChanged) {
          // Les arrêts sont référencés par les réservations : le changement d'arrêt avec réservations
          // (notification et annulation sans frais, doc 05 §6) arrive avec les réservations, étape 7.
          throw new ApiError(HttpStatus.CONFLICT, 'TRIP_HAS_BOOKINGS', 'Des passagers ont réservé : les arrêts ne peuvent pas être modifiés.');
        }
        const seats = input.seatsOffered ?? trip.seats_offered;
        const vehicleId = input.vehicleId ?? trip.vehicle_id;
        if (input.seatsOffered !== undefined || input.vehicleId !== undefined) {
          const v = await this.ownedVehicle(trx, userId, vehicleId);
          if (seats > v.seats_capacity) throw seatsExceed(v.seats_capacity);
          if (input.vehicleId !== undefined && trip.status !== 'DRAFT' && v.verification_status !== 'APPROVED') {
            throw unprocessable('VEHICLE_NOT_APPROVED', 'Ce véhicule n’est pas encore vérifié.');
          }
          const occupied = await this.maxOccupancy(trx, tripId);
          if (seats < occupied) {
            throw new ApiError(HttpStatus.CONFLICT, 'SEATS_BELOW_BOOKED', `${occupied} places sont déjà réservées.`, { occupied });
          }
        }
        if (trip.status !== 'DRAFT' && (timeChanged || input.vehicleId !== undefined)) {
          await this.publishChecks(trx, { driverId: userId, vehicleId, departureAt: plan?.departureAt ?? trip.departure_at, seatsOffered: seats });
        }

        await trx
          .updateTable('trips')
          .set({
            vehicle_id: input.vehicleId,
            seats_offered: input.seatsOffered,
            acceptance_mode: input.acceptanceMode,
            cancellation_policy_code: input.cancellationPolicy,
            allows_cash: input.allowsCash,
            luggage_policy: input.luggagePolicy,
            description: input.description,
            instructions: input.instructions,
            ...(plan
              ? {
                  departure_at: plan.departureAt,
                  estimated_arrival_at: plan.estimatedArrivalAt,
                  estimated_distance_m: plan.route.distanceM,
                  estimated_duration_s: Math.round((plan.estimatedArrivalAt.getTime() - plan.departureAt.getTime()) / 1000),
                  route_geometry: this.geometrySql(plan.route),
                  route_source: plan.route.source,
                }
              : {}),
          })
          .where('id', '=', tripId)
          .execute();

        if (plan) {
          if (routeChanged) {
            await trx.deleteFrom('trip_stops').where('trip_id', '=', tripId).execute();
            await this.insertStops(trx, tripId, plan.stops);
          } else {
            for (const [seq, s] of plan.stops.entries()) {
              await trx
                .updateTable('trip_stops')
                .set({ planned_at: s.plannedAt, price_from_origin_xof: s.priceFromOriginXof })
                .where('trip_id', '=', tripId)
                .where('seq', '=', seq)
                .execute();
            }
          }
        }
        await this.syncFullStatus(trx, tripId);

        const shiftMin = timeChanged ? Math.round((input.departureAt!.getTime() - trip.departure_at.getTime()) / 60_000) : 0;
        if (booked > 0 && Math.abs(shiftMin) > 30) {
          // Horaire décalé de plus de 30 min : chaque passager peut annuler sans frais jusqu'au départ (doc 05 §6).
          await trx.updateTable('bookings').set({ free_cancellation: true }).where('trip_id', '=', tripId).where('status', 'in', BLOCKING).execute();
        }
        if (booked > 0) {
          // Événement pour les notifications (étape 9) ; > 30 min ouvre l'annulation sans frais (doc 05 §6).
          await trx
            .insertInto('outbox_events')
            .values({
              aggregate: 'trip',
              aggregate_id: tripId,
              event_type: 'trip.updated',
              payload: JSON.stringify({ fields: Object.keys(input), departureShiftMin: shiftMin, freeCancellation: Math.abs(shiftMin) > 30 }),
              published_at: null,
            })
            .execute();
        }
        await this.audit.log(
          { actorId: userId, action: 'trip.update', targetType: 'trip', targetId: tripId, changes: { fields: Object.keys(input), departureShiftMin: shiftMin }, ctx },
          trx,
        );
      });
    } catch (err) {
      this.overlapError(err);
    }
    return this.manageView(userId, tripId);
  }

  async duplicate(userId: string, tripId: string, input: DuplicateInput, ctx: RequestContext) {
    await this.drivers.requireApproved(userId);
    const source = await this.owned(this.db, userId, tripId);
    const stops = await this.db
      .selectFrom('trip_stops')
      .select(['seq', 'place_id', 'label', 'meeting_point', 'location', 'location_precision', 'planned_at', 'price_from_origin_xof', 'is_pickup', 'is_dropoff'])
      .where('trip_id', '=', tripId)
      .orderBy('seq')
      .execute();
    const timeOfDayMs = source.departure_at.getTime() - Date.parse(`${source.departure_at.toISOString().slice(0, 10)}T00:00:00Z`);
    const results = [];
    for (const date of input.dates) {
      const departure = new Date(Date.parse(`${date}T00:00:00Z`) + timeOfDayMs);
      const shift = departure.getTime() - source.departure_at.getTime();
      const id = uuidv7();
      try {
        await this.db.transaction().execute(async (trx) => {
          if (input.publish) {
            await this.publishChecks(trx, { driverId: userId, vehicleId: source.vehicle_id, departureAt: departure, seatsOffered: source.seats_offered });
          }
          await sql`
            INSERT INTO trips (id, public_ref, driver_id, vehicle_id, kind, status, departure_at, estimated_arrival_at, seats_offered,
                               acceptance_mode, cancellation_policy_code, allows_cash, luggage_policy, description, instructions,
                               estimated_distance_m, estimated_duration_s, route_geometry, route_source, source_trip_id, published_at)
            SELECT ${id}::uuid, ${tripReference()}, driver_id, vehicle_id, kind, ${input.publish ? 'PUBLISHED' : 'DRAFT'}::trip_status,
                   ${departure}, estimated_arrival_at + make_interval(secs => ${shift / 1000}), seats_offered,
                   acceptance_mode, cancellation_policy_code, allows_cash, luggage_policy, description, instructions,
                   estimated_distance_m, estimated_duration_s, route_geometry, route_source, id, ${input.publish ? new Date() : null}
              FROM trips WHERE id = ${tripId}::uuid`.execute(trx);
          for (const s of stops) {
            await trx
              .insertInto('trip_stops')
              .values({
                id: uuidv7(),
                trip_id: id,
                seq: s.seq,
                place_id: s.place_id,
                label: s.label,
                meeting_point: s.meeting_point,
                location: s.location,
                location_precision: s.location_precision,
                planned_at: new Date(s.planned_at.getTime() + shift),
                price_from_origin_xof: s.price_from_origin_xof,
                is_pickup: s.is_pickup,
                is_dropoff: s.is_dropoff,
              })
              .execute();
          }
          await this.audit.log({ actorId: userId, action: 'trip.duplicate', targetType: 'trip', targetId: id, changes: { sourceTripId: tripId }, ctx }, trx);
        });
        results.push({ date, tripId: id, status: input.publish ? 'PUBLISHED' : 'DRAFT' });
      } catch (err) {
        try {
          this.overlapError(err);
        } catch (mapped) {
          if (!(mapped instanceof ApiError)) throw mapped;
          const body = mapped.getResponse() as { code: string; message: string };
          results.push({ date, tripId: null, status: null, error: { code: body.code, message: body.message } });
        }
      }
    }
    return { data: results };
  }

  async cancel(userId: string, tripId: string, input: CancelInput, ctx: RequestContext) {
    await this.db.transaction().execute(async (trx) => {
      const trip = await this.owned(trx, userId, tripId, true);
      assertTransition(trip.status, 'CANCELLED');
      // Réservations annulées, remboursement intégral de ce qui a été payé (doc 05 §7.2).
      const { cancelled } = await cancelTripBookings(trx, tripId, userId, input.reason, 'CANCELLED_BY_DRIVER');
      await trx
        .updateTable('trips')
        .set({ status: 'CANCELLED', cancelled_at: new Date(), cancellation_reason: input.reason })
        .where('id', '=', tripId)
        .execute();
      if (cancelled > 0) {
        await trx
          .updateTable('driver_profiles')
          .set({ cancellation_count_90d: sql<number>`cancellation_count_90d + 1` })
          .where('user_id', '=', userId)
          .execute();
      }
      await this.audit.log(
        { actorId: userId, action: 'trip.cancel', targetType: 'trip', targetId: tripId, reason: input.reason, changes: { bookingsCancelled: cancelled }, ctx },
        trx,
      );
    });
    return this.manageView(userId, tripId);
  }

  async start(userId: string, tripId: string, ctx: RequestContext) {
    await this.db.transaction().execute(async (trx) => {
      const trip = await this.owned(trx, userId, tripId, true);
      assertTransition(trip.status, 'IN_PROGRESS');
      const now = Date.now();
      const dep = trip.departure_at.getTime();
      if (now < dep - START_WINDOW.beforeMs || now > dep + START_WINDOW.afterMs) {
        throw unprocessable('START_WINDOW_CLOSED', 'Le départ se déclare entre 1 h avant et 3 h après l’heure prévue.', {
          opensAt: new Date(dep - START_WINDOW.beforeMs),
          closesAt: new Date(dep + START_WINDOW.afterMs),
        });
      }
      await trx.updateTable('trips').set({ status: 'IN_PROGRESS', started_at: new Date() }).where('id', '=', tripId).execute();
      // Les réservations non confirmées au départ expirent (doc 05 §1).
      await setActor(trx, userId, 'Trajet démarré');
      await trx
        .updateTable('bookings')
        .set({ status: 'EXPIRED', expired_at: new Date() })
        .where('trip_id', '=', tripId)
        .where('status', 'in', PENDING_STATUSES)
        .execute();
      await outbox(trx, 'trip', tripId, 'trip.started', {});
      await this.audit.log({ actorId: userId, action: 'trip.start', targetType: 'trip', targetId: tripId, ctx }, trx);
    });
    return this.manageView(userId, tripId);
  }

  async complete(userId: string, tripId: string, ctx: RequestContext) {
    await this.db.transaction().execute(async (trx) => {
      const trip = await this.owned(trx, userId, tripId, true);
      assertTransition(trip.status, 'COMPLETED');
      await trx.updateTable('trips').set({ status: 'COMPLETED', completed_at: new Date() }).where('id', '=', tripId).execute();
      await setActor(trx, userId, 'Trajet terminé');
      await trx
        .updateTable('bookings')
        .set({ status: 'COMPLETED', completed_at: new Date() })
        .where('trip_id', '=', tripId)
        .where('status', '=', 'CONFIRMED')
        .execute();
      await outbox(trx, 'trip', tripId, 'trip.completed', { auto: false });
      await trx
        .updateTable('driver_profiles')
        .set({ completed_trips_count: sql<number>`completed_trips_count + 1` })
        .where('user_id', '=', userId)
        .execute();
      await this.audit.log({ actorId: userId, action: 'trip.complete', targetType: 'trip', targetId: tripId, ctx }, trx);
    });
    return this.manageView(userId, tripId);
  }

  // ---------------------------------------------------------------- lecture (conducteur)

  async mine(userId: string, query: MineQuery) {
    await this.drivers.requireApproved(userId);
    const statuses: Record<MineQuery['status'], TripStatus[]> = {
      upcoming: ['PUBLISHED', 'FULL'],
      in_progress: ['IN_PROGRESS'],
      past: ['COMPLETED', 'CANCELLED'],
      draft: ['DRAFT'],
    };
    const offset = decodeOffset(query.cursor);
    const rows = await this.db
      .selectFrom('trips')
      .innerJoin('vehicles', 'vehicles.id', 'trips.vehicle_id')
      .select([
        'trips.id', 'trips.public_ref', 'trips.status', 'trips.kind', 'trips.departure_at', 'trips.estimated_arrival_at',
        'trips.seats_offered', 'trips.version', 'vehicles.make', 'vehicles.model', 'vehicles.color',
        sql<string>`(SELECT label FROM trip_stops s WHERE s.trip_id = trips.id ORDER BY seq LIMIT 1)`.as('origin'),
        sql<string>`(SELECT label FROM trip_stops s WHERE s.trip_id = trips.id ORDER BY seq DESC LIMIT 1)`.as('destination'),
        sql<number>`(SELECT price_from_origin_xof FROM trip_stops s WHERE s.trip_id = trips.id ORDER BY seq DESC LIMIT 1)`.as('price'),
        sql<number>`(SELECT count(*)::int FROM trip_stops s WHERE s.trip_id = trips.id) - 2`.as('intermediate'),
        sql<number>`trip_max_occupancy(trips.id, 0, (SELECT max(seq) FROM trip_stops s WHERE s.trip_id = trips.id))`.as('occupied'),
        sql<number>`(SELECT count(*)::int FROM bookings b WHERE b.trip_id = trips.id AND b.status IN ('PENDING_ACCEPTANCE','PENDING_PAYMENT','CONFIRMED'))`.as('bookings'),
      ])
      .where('trips.driver_id', '=', userId)
      .where('trips.status', 'in', statuses[query.status])
      .orderBy('trips.departure_at', query.status === 'past' ? 'desc' : 'asc')
      .orderBy('trips.id')
      .offset(offset)
      .limit(query.limit + 1)
      .execute();
    const page = rows.slice(0, query.limit);
    return {
      data: page.map((r) => ({
        id: r.id,
        publicRef: r.public_ref,
        status: r.status,
        kind: r.kind,
        departureAt: r.departure_at,
        estimatedArrivalAt: r.estimated_arrival_at,
        origin: r.origin,
        destination: r.destination,
        intermediateStops: Math.max(0, r.intermediate),
        priceXof: r.price,
        seatsOffered: r.seats_offered,
        seatsOccupied: r.occupied,
        activeBookings: r.bookings,
        vehicle: `${r.make} ${r.model} ${r.color}`,
        version: r.version,
        isEstimate: true,
      })),
      nextCursor: rows.length > query.limit ? encodeOffset(offset + query.limit) : null,
    };
  }

  /** Détail complet pour le conducteur : coordonnées exactes, réservations, actions possibles. */
  async manageView(userId: string, tripId: string) {
    const trip = await this.owned(this.db, userId, tripId);
    const [stops, vehicle, bookings, occupied, geometry, noShowDelay] = await Promise.all([
      this.db
        .selectFrom('trip_stops')
        .select(['id', 'seq', 'place_id', 'label', 'meeting_point', 'location_precision', 'planned_at', 'price_from_origin_xof',
                 'is_pickup', 'is_dropoff', sql<number>`ST_Y(location::geometry)`.as('lat'), sql<number>`ST_X(location::geometry)`.as('lng')])
        .where('trip_id', '=', tripId)
        .orderBy('seq')
        .execute(),
      this.db.selectFrom('vehicles').select(['id', 'make', 'model', 'color', 'plate_number', 'seats_capacity', 'verification_status'])
        .where('id', '=', trip.vehicle_id).executeTakeFirstOrThrow(),
      sql<{ id: string; reference: string; status: string; payment_status: string; seats: number; pickup_seq: number; dropoff_seq: number;
            display_name: string | null; rating: number | null; hold_expires_at: Date | null; subtotal_xof: number; driver_net_xof: number }>`
        SELECT b.id, b.reference, b.status, b.payment_status, b.seats, b.pickup_seq, b.dropoff_seq, u.display_name,
               u.rating_avg_passenger AS rating, b.hold_expires_at, b.subtotal_xof, b.driver_net_xof
          FROM bookings b JOIN users u ON u.id = b.passenger_id
         WHERE b.trip_id = ${tripId}::uuid ORDER BY b.created_at`.execute(this.db),
      this.maxOccupancy(this.db, tripId),
      sql<{ coords: [number, number][] | null }>`
        SELECT (SELECT json_agg(json_build_array(ST_Y(geom), ST_X(geom))) FROM ST_DumpPoints(route_geometry::geometry) AS dp(path, geom)) AS coords
          FROM trips WHERE id = ${tripId}::uuid`.execute(this.db),
      this.settings.get<number>('booking.no_show_delay_minutes'),
    ]);
    const now = Date.now();
    const dep = trip.departure_at.getTime();
    return {
      id: trip.id,
      publicRef: trip.public_ref,
      status: trip.status,
      version: trip.version,
      kind: trip.kind,
      departureAt: trip.departure_at,
      estimatedArrivalAt: trip.estimated_arrival_at,
      estimatedDistanceM: trip.estimated_distance_m,
      estimatedDurationS: trip.estimated_duration_s,
      routeSource: trip.route_source,
      isEstimate: true,
      geometry: geometry.rows[0]?.coords ?? [],
      seatsOffered: trip.seats_offered,
      seatsOccupied: occupied,
      acceptanceMode: trip.acceptance_mode,
      cancellationPolicy: trip.cancellation_policy_code,
      allowsCash: trip.allows_cash,
      luggagePolicy: trip.luggage_policy,
      description: trip.description,
      instructions: trip.instructions,
      publishedAt: trip.published_at,
      startedAt: trip.started_at,
      completedAt: trip.completed_at,
      cancelledAt: trip.cancelled_at,
      cancellationReason: trip.cancellation_reason,
      isDemo: trip.is_demo,
      vehicle: {
        id: vehicle.id, make: vehicle.make, model: vehicle.model, color: vehicle.color, plateNumber: vehicle.plate_number,
        seatsCapacity: vehicle.seats_capacity, status: vehicle.verification_status,
      },
      stops: stops.map((s) => ({
        id: s.id, seq: s.seq, placeId: s.place_id, label: s.label, meetingPoint: s.meeting_point, lat: s.lat, lng: s.lng,
        locationPrecision: s.location_precision, plannedAt: s.planned_at, priceFromOriginXof: s.price_from_origin_xof,
        isPickup: s.is_pickup, isDropoff: s.is_dropoff,
      })),
      bookings: bookings.rows.map((b) => {
        const pickupAt = stops[b.pickup_seq]?.planned_at.getTime() ?? Infinity;
        const holdOpen = b.hold_expires_at === null || b.hold_expires_at.getTime() > now;
        return {
          id: b.id, reference: b.reference, status: b.status, paymentStatus: b.payment_status, seats: b.seats,
          passenger: { displayName: b.display_name, ratingAvg: b.rating },
          pickup: stops[b.pickup_seq]?.label ?? null, dropoff: stops[b.dropoff_seq]?.label ?? null,
          pickupAt: stops[b.pickup_seq]?.planned_at ?? null, holdExpiresAt: b.hold_expires_at,
          subtotalXof: b.subtotal_xof, driverNetXof: b.driver_net_xof,
          actions: {
            canAccept: b.status === 'PENDING_ACCEPTANCE' && holdOpen && ['PUBLISHED', 'FULL'].includes(trip.status),
            canReject: b.status === 'PENDING_ACCEPTANCE' && ['PUBLISHED', 'FULL'].includes(trip.status),
            canCancel: ['PENDING_ACCEPTANCE', 'PENDING_PAYMENT', 'CONFIRMED'].includes(b.status) && ['PUBLISHED', 'FULL'].includes(trip.status),
            canMarkNoShow: b.status === 'CONFIRMED' && trip.status === 'IN_PROGRESS' && now >= pickupAt + (noShowDelay ?? 15) * 60_000,
          },
        };
      }),
      actions: {
        canEdit: ['DRAFT', 'PUBLISHED', 'FULL'].includes(trip.status),
        canPublish: trip.status === 'DRAFT',
        canCancel: ['DRAFT', 'PUBLISHED', 'FULL'].includes(trip.status),
        canStart: ['PUBLISHED', 'FULL'].includes(trip.status) && now >= dep - START_WINDOW.beforeMs && now <= dep + START_WINDOW.afterMs,
        canComplete: trip.status === 'IN_PROGRESS',
        canDuplicate: true,
      },
    };
  }
}

function seatsExceed(capacity: number): ApiError {
  return unprocessable('SEATS_EXCEED_CAPACITY', `Ce véhicule compte ${capacity} places passagers au maximum.`, { capacity });
}
