import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { ENV, type Env } from '../../config/env';
import { REDIS } from '../../infra/redis.module';
import { FALLBACK_ROAD_FACTOR, FALLBACK_SPEED_KMH, haversineMeters, type LatLng } from './haversine';

export type RouteSource = 'OSRM' | 'HAVERSINE_FALLBACK';

export interface RouteLeg {
  distanceM: number;
  durationS: number;
}

export interface RouteEstimate {
  distanceM: number;
  durationS: number;
  legs: RouteLeg[];
  /** Tracé [lat, lng] ; en repli, simple ligne brisée entre les points (pas une route). */
  geometry: [number, number][];
  source: RouteSource;
  /** Toujours vrai : une distance ou une durée calculée n'est jamais une mesure GPS. */
  isEstimate: true;
}

const CACHE_TTL_S = 7 * 86_400;
const BREAKER_MS = 60_000;

interface OsrmResponse {
  code: string;
  routes?: { distance: number; duration: number; legs: { distance: number; duration: number }[]; geometry: { coordinates: [number, number][] } }[];
}

/**
 * Itinéraires estimés. Source principale : OSRM (données OpenStreetMap). S'il n'est pas configuré ou ne répond
 * pas, estimation de repli « vol d'oiseau × 1,3 » à vitesse moyenne fixe, marquée HAVERSINE_FALLBACK.
 * Après un échec, OSRM n'est plus sollicité pendant une minute (pour ne pas ralentir chaque publication).
 */
@Injectable()
export class RoutingService {
  private readonly logger = new Logger('Routage');
  private osrmDownUntil = 0;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async estimate(points: LatLng[], kind: 'URBAN' | 'INTERCITY'): Promise<RouteEstimate> {
    if (points.length < 2) throw new Error('Au moins deux points');
    const osrm = await this.fromOsrm(points);
    return osrm ?? fallbackRoute(points, kind);
  }

  private async fromOsrm(points: LatLng[]): Promise<RouteEstimate | null> {
    if (!this.env.OSRM_URL || Date.now() < this.osrmDownUntil) return null;
    const coords = points.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
    const cacheKey = `route:osrm:${coords}`;
    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) return JSON.parse(cached) as RouteEstimate;

    try {
      const url = new URL(`route/v1/driving/${coords}`, this.env.OSRM_URL.endsWith('/') ? this.env.OSRM_URL : `${this.env.OSRM_URL}/`);
      url.searchParams.set('overview', 'simplified');
      url.searchParams.set('geometries', 'geojson');
      url.searchParams.set('steps', 'false');
      const res = await fetch(url, { signal: AbortSignal.timeout(this.env.OSRM_TIMEOUT_MS) });
      const body = (await res.json()) as OsrmResponse;
      const route = body.routes?.[0];
      if (!res.ok || body.code !== 'Ok' || !route || route.legs.length !== points.length - 1) {
        // NoRoute (point hors du réseau routier) : pas une panne, juste pas de route connue.
        this.logger.warn(`OSRM sans itinéraire (${body.code ?? res.status}) : estimation de repli`);
        return null;
      }
      const estimate: RouteEstimate = {
        distanceM: Math.round(route.distance),
        durationS: Math.round(route.duration),
        legs: route.legs.map((l) => ({ distanceM: Math.round(l.distance), durationS: Math.round(l.duration) })),
        geometry: route.geometry.coordinates.map(([lng, lat]) => [round5(lat), round5(lng)]),
        source: 'OSRM',
        isEstimate: true,
      };
      await this.redis.set(cacheKey, JSON.stringify(estimate), 'EX', CACHE_TTL_S).catch(() => undefined);
      return estimate;
    } catch (err) {
      this.osrmDownUntil = Date.now() + BREAKER_MS;
      this.logger.warn(`OSRM injoignable (${(err as Error).message}) : estimation de repli pendant 1 min`);
      return null;
    }
  }
}

function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

/** Estimation de repli : jamais présentée comme une route réelle (source HAVERSINE_FALLBACK). */
export function fallbackRoute(points: LatLng[], kind: 'URBAN' | 'INTERCITY'): RouteEstimate {
  const legs = points.slice(1).map((p, i) => {
    const distanceM = Math.round(haversineMeters(points[i]!, p) * FALLBACK_ROAD_FACTOR);
    return { distanceM, durationS: Math.round((distanceM / 1000 / FALLBACK_SPEED_KMH[kind]) * 3600) };
  });
  return {
    distanceM: legs.reduce((s, l) => s + l.distanceM, 0),
    durationS: legs.reduce((s, l) => s + l.durationS, 0),
    legs,
    geometry: points.map((p) => [round5(p.lat), round5(p.lng)]),
    source: 'HAVERSINE_FALLBACK',
    isEstimate: true,
  };
}
