import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { ApiError } from '../../common/api-error';
import { DB, type Db } from '../../database/database.module';
import { REDIS } from '../../infra/redis.module';
import { RateLimitService } from '../../infra/rate-limit.service';
import { haversineMeters } from '../routing/haversine';
import type { LiveLocationInput } from './trips.schemas';

/** Une position plus vieille que ça est signalée comme ancienne (réseau coupé, appli fermée…). */
export const LIVE_STALE_AFTER_S = 120;
/** Seule la dernière position est gardée, en mémoire (Redis), et disparaît d'elle-même. */
const LIVE_TTL_S = 15 * 60;

const key = (tripId: string) => `live:trip:${tripId}`;
/** Arrondi des positions de la carte publique (≈ 500 m). */
const APPROX_DEG = 0.0045;

export interface LivePosition {
  lat: number;
  lng: number;
  accuracyM: number | null;
  heading: number | null;
  recordedAt: string;
}

/**
 * Suivi du conducteur pendant le trajet : le conducteur envoie sa position (appli ouverte), les passagers
 * confirmés la lisent. Visible uniquement pendant un trajet en cours ; jamais écrit en base ni dans les journaux.
 */
@Injectable()
export class LiveLocationService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly rateLimit: RateLimitService,
  ) {}

  private async trip(tripId: string) {
    return this.db.selectFrom('trips').select(['id', 'driver_id', 'status']).where('id', '=', tripId).executeTakeFirst();
  }

  async share(userId: string, tripId: string, input: LiveLocationInput): Promise<{ recordedAt: string }> {
    const trip = await this.trip(tripId);
    if (!trip || trip.driver_id !== userId) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Trajet introuvable.');
    if (trip.status !== 'IN_PROGRESS') {
      throw new ApiError(HttpStatus.CONFLICT, 'TRIP_NOT_IN_PROGRESS', 'La position se partage seulement pendant le trajet.');
    }
    // Une position toutes les 5 s au plus en moyenne : largement assez pour suivre une voiture.
    await this.rateLimit.consumeOrThrow([{ key: `live:${tripId}`, limit: 12, windowS: 60 }], 'Positions envoyées trop souvent.');
    const point: LivePosition = {
      lat: input.lat,
      lng: input.lng,
      accuracyM: input.accuracyM ?? null,
      heading: input.heading ?? null,
      recordedAt: new Date().toISOString(),
    };
    await this.redis.set(key(tripId), JSON.stringify(point), 'EX', LIVE_TTL_S);
    return { recordedAt: point.recordedAt };
  }

  /** Dernière position, pour le conducteur ou un passager dont la réservation est confirmée. */
  async read(userId: string, tripId: string, now = new Date()) {
    const trip = await this.trip(tripId);
    const allowed =
      !!trip &&
      (trip.driver_id === userId ||
        !!(await this.db
          .selectFrom('bookings')
          .select('id')
          .where('trip_id', '=', tripId)
          .where('passenger_id', '=', userId)
          .where('status', 'in', ['CONFIRMED', 'COMPLETED'])
          .executeTakeFirst()));
    if (!trip || !allowed) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Trajet introuvable.');
    if (trip.status !== 'IN_PROGRESS') return { status: trip.status, position: null, stale: false, ageS: null };
    const raw = await this.redis.get(key(tripId));
    const position = raw ? (JSON.parse(raw) as LivePosition) : null;
    const ageS = position ? Math.max(0, Math.round((now.getTime() - Date.parse(position.recordedAt)) / 1000)) : null;
    return { status: trip.status, position, ageS, stale: ageS !== null && ageS > LIVE_STALE_AFTER_S };
  }

  /**
   * Carte publique des conducteurs en circulation autour d'un point : trajets en cours dont la position est
   * récente, arrondie à environ 500 m, sans nom ni plaque. Sert à montrer l'activité, pas à suivre quelqu'un.
   */
  async nearby(center: { lat: number; lng: number }, radiusM = 30_000, now = new Date()) {
    const trips = await this.db
      .selectFrom('trips')
      .select(['id', 'kind', 'is_demo'])
      .select((eb) =>
        eb.selectFrom('trip_stops').select('label').whereRef('trip_stops.trip_id', '=', 'trips.id').orderBy('seq', 'desc').limit(1).as('to_label'),
      )
      .where('status', '=', 'IN_PROGRESS')
      .limit(500)
      .execute();
    if (!trips.length) return { data: [] };
    const raws = await this.redis.mget(trips.map((t) => key(t.id)));
    const round = (v: number) => Math.round(v / APPROX_DEG) * APPROX_DEG;
    const data = [];
    for (const [i, t] of trips.entries()) {
      const p = raws[i] ? (JSON.parse(raws[i]!) as LivePosition) : null;
      if (!p) continue;
      const ageS = Math.max(0, Math.round((now.getTime() - Date.parse(p.recordedAt)) / 1000));
      if (ageS > LIVE_STALE_AFTER_S || haversineMeters(center, p) > radiusM) continue;
      data.push({ tripId: t.id, kind: t.kind, toLabel: t.to_label, lat: Number(round(p.lat).toFixed(4)), lng: Number(round(p.lng).toFixed(4)), ageS, isDemo: t.is_demo });
      if (data.length >= 100) break;
    }
    return { data, approximateM: 500 };
  }

  /**
   * Console : tous les trajets en cours, avec la dernière position exacte du conducteur et ses passagers confirmés.
   * Réservé au personnel (droit « trips.read ») ; les passagers ne partagent pas leur position, seul le conducteur.
   */
  async adminOverview(now = new Date()) {
    const trips = await this.db
      .selectFrom('trips')
      .innerJoin('users as d', 'd.id', 'trips.driver_id')
      .leftJoin('vehicles as v', 'v.id', 'trips.vehicle_id')
      .select([
        'trips.id', 'trips.public_ref', 'trips.kind', 'trips.is_demo', 'trips.started_at', 'trips.departure_at',
        'd.id as driver_id', 'd.first_name', 'd.last_name', 'v.make', 'v.model', 'v.color', 'v.plate_number',
      ])
      .select((eb) => [
        eb.selectFrom('trip_stops').select('label').whereRef('trip_stops.trip_id', '=', 'trips.id').orderBy('seq', 'asc').limit(1).as('from_label'),
        eb.selectFrom('trip_stops').select('label').whereRef('trip_stops.trip_id', '=', 'trips.id').orderBy('seq', 'desc').limit(1).as('to_label'),
      ])
      .where('trips.status', '=', 'IN_PROGRESS')
      .orderBy('trips.started_at', 'desc')
      .limit(500)
      .execute();
    if (!trips.length) return { data: [], counts: { trips: 0, sharing: 0, passengers: 0 } };
    const bookings = await this.db
      .selectFrom('bookings')
      .innerJoin('users as p', 'p.id', 'bookings.passenger_id')
      .innerJoin('trip_stops as a', 'a.id', 'bookings.pickup_stop_id')
      .innerJoin('trip_stops as b', 'b.id', 'bookings.dropoff_stop_id')
      .select(['bookings.trip_id', 'bookings.reference', 'bookings.seats', 'p.first_name', 'p.last_name', 'a.label as pickup', 'b.label as dropoff'])
      .where('bookings.trip_id', 'in', trips.map((t) => t.id))
      .where('bookings.status', '=', 'CONFIRMED')
      .execute();
    const raws = await this.redis.mget(trips.map((t) => key(t.id)));
    let sharing = 0;
    const data = trips.map((t, i) => {
      const p = raws[i] ? (JSON.parse(raws[i]!) as LivePosition) : null;
      const ageS = p ? Math.max(0, Math.round((now.getTime() - Date.parse(p.recordedAt)) / 1000)) : null;
      if (p && ageS !== null && ageS <= LIVE_STALE_AFTER_S) sharing++;
      return {
        tripId: t.id,
        reference: t.public_ref,
        kind: t.kind,
        isDemo: t.is_demo,
        startedAt: t.started_at,
        fromLabel: t.from_label,
        toLabel: t.to_label,
        driver: { id: t.driver_id, name: [t.first_name, t.last_name].filter(Boolean).join(' ') || 'Conducteur' },
        vehicle: t.make ? { label: `${t.make} ${t.model} ${t.color ?? ''}`.trim(), plate: t.plate_number } : null,
        position: p ? { lat: p.lat, lng: p.lng, heading: p.heading, recordedAt: p.recordedAt } : null,
        ageS,
        stale: ageS !== null && ageS > LIVE_STALE_AFTER_S,
        passengers: bookings
          .filter((b) => b.trip_id === t.id)
          .map((b) => ({ reference: b.reference, name: [b.first_name, b.last_name].filter(Boolean).join(' '), seats: b.seats, pickup: b.pickup, dropoff: b.dropoff })),
      };
    });
    return { data, counts: { trips: data.length, sharing, passengers: bookings.reduce((s, b) => s + b.seats, 0) } };
  }

  /** Fin ou annulation du trajet : la position est effacée tout de suite. */
  async clear(tripId: string): Promise<void> {
    await this.redis.del(key(tripId));
  }
}
