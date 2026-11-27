import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { ENV, type Env } from '../../config/env';
import { REDIS } from '../../infra/redis.module';
import type { Forecast } from './price-factors';

const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
const HORIZON_MS = 15 * 86_400_000; // les prévisions ne vont pas au-delà

/**
 * Précipitations prévues à un endroit et une heure (format de l'API Open-Meteo, sans clé).
 * Aucune donnée n'est inventée : sans service, trop loin dans le temps ou en cas de panne, la météo est inconnue.
 */
@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);
  private downUntil = 0;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  get url(): string | null {
    return this.env.WEATHER_URL ?? (this.env.NODE_ENV === 'development' ? OPEN_METEO : null);
  }

  async forecast(lat: number, lng: number, at: Date): Promise<Forecast> {
    const base = this.url;
    const ahead = at.getTime() - Date.now();
    if (!base || ahead > HORIZON_MS || ahead < -3_600_000 || Date.now() < this.downUntil) return null;
    const hour = at.toISOString().slice(0, 13); // AAAA-MM-JJTHH
    const key = `weather:${lat.toFixed(2)}:${lng.toFixed(2)}:${hour}`;
    const cached = await this.redis.get(key).catch(() => null);
    if (cached) return JSON.parse(cached) as Forecast;
    try {
      const url = new URL(base);
      url.searchParams.set('latitude', lat.toFixed(2));
      url.searchParams.set('longitude', lng.toFixed(2));
      url.searchParams.set('hourly', 'precipitation');
      url.searchParams.set('timezone', 'UTC');
      url.searchParams.set('start_date', hour.slice(0, 10));
      url.searchParams.set('end_date', hour.slice(0, 10));
      const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
      const body = (await res.json()) as { hourly?: { time?: string[]; precipitation?: (number | null)[] } };
      const i = body.hourly?.time?.findIndex((t) => t.startsWith(hour)) ?? -1;
      const mm = i >= 0 ? body.hourly?.precipitation?.[i] : null;
      if (!res.ok || typeof mm !== 'number') return null;
      const out: Forecast = { precipitationMm: mm };
      await this.redis.set(key, JSON.stringify(out), 'EX', 1800).catch(() => undefined);
      return out;
    } catch (err) {
      this.downUntil = Date.now() + 60_000;
      this.logger.warn(`Météo indisponible : ${(err as Error).message}`);
      return null;
    }
  }
}
