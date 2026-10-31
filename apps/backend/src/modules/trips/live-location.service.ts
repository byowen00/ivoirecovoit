import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { ApiError } from '../../common/api-error';
import { DB, type Db } from '../../database/database.module';
import { REDIS } from '../../infra/redis.module';
import { RateLimitService } from '../../infra/rate-limit.service';
import type { LiveLocationInput } from './trips.schemas';

/** Une position plus vieille que ça est signalée comme ancienne (réseau coupé, appli fermée…). */
export const LIVE_STALE_AFTER_S = 120;
/** Seule la dernière position est gardée, en mémoire (Redis), et disparaît d'elle-même. */
const LIVE_TTL_S = 15 * 60;

const key = (tripId: string) => `live:trip:${tripId}`;

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

  /** Fin ou annulation du trajet : la position est effacée tout de suite. */
  async clear(tripId: string): Promise<void> {
    await this.redis.del(key(tripId));
  }
}
