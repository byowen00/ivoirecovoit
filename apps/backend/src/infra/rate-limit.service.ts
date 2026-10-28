import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { ApiError } from '../common/api-error';
import { REDIS } from './redis.module';

export interface RateLimitRule {
  /** Clé logique, ex. « otp:phone:+225… » */
  key: string;
  limit: number;
  windowS: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterS: number;
}

// Incrément et expiration dans le même script : pas de compteur sans durée de vie.
const HIT_SCRIPT = `
local c = redis.call('INCR', KEYS[1])
if redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return {c, redis.call('TTL', KEYS[1])}`;

/** Compteurs à fenêtre fixe dans Redis (INCR + EXPIRE atomiques). */
@Injectable()
export class RateLimitService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async hit(rule: RateLimitRule): Promise<RateLimitResult> {
    const key = `rl:${rule.key}:${rule.windowS}`;
    const [count, ttl] = (await this.redis.eval(HIT_SCRIPT, 1, key, rule.windowS)) as [number, number];
    const retryAfterS = ttl > 0 ? ttl : rule.windowS;
    return { allowed: count <= rule.limit, remaining: Math.max(0, rule.limit - count), retryAfterS };
  }

  /** Lecture sans incrément (ex. : nombre d'échecs déjà enregistrés). */
  async peek(rule: RateLimitRule): Promise<RateLimitResult> {
    const key = `rl:${rule.key}:${rule.windowS}`;
    const [[, raw], [, ttl]] = (await this.redis.multi().get(key).ttl(key).exec()) as [
      [null, string | null],
      [null, number],
    ];
    const count = Number(raw ?? 0);
    return { allowed: count < rule.limit, remaining: Math.max(0, rule.limit - count), retryAfterS: ttl > 0 ? ttl : 0 };
  }

  async reset(rule: RateLimitRule): Promise<void> {
    await this.redis.del(`rl:${rule.key}:${rule.windowS}`);
  }

  /** Consomme toutes les règles ; lève une 429 avec le plus long délai si l'une est dépassée. */
  async consumeOrThrow(rules: RateLimitRule[], message = 'Trop de tentatives. Réessayez plus tard.'): Promise<void> {
    let retryAfterS = 0;
    for (const rule of rules) {
      const res = await this.hit(rule);
      if (!res.allowed) retryAfterS = Math.max(retryAfterS, res.retryAfterS);
    }
    if (retryAfterS > 0) throw rateLimited(retryAfterS, message);
  }
}

export function rateLimited(retryAfterS: number, message = 'Trop de tentatives. Réessayez plus tard.'): ApiError {
  return new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', message, { retryAfterS });
}
