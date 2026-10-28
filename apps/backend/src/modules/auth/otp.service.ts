import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { randomInt } from 'node:crypto';
import { ApiError } from '../../common/api-error';
import { uuidv7 } from '../../common/ids';
import { ENV, type Env } from '../../config/env';
import { DB, type Db } from '../../database/database.module';
import type { OtpRequestsLogTable } from '../../database/types';
import { rateLimited, RateLimitService } from '../../infra/rate-limit.service';
import { REDIS } from '../../infra/redis.module';
import { hmacSha256, safeEqual } from './crypto';
import { SMS_SENDER, type SmsSender } from './sms';

export const OTP_TTL_S = 5 * 60;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_AFTER_S = 60;

export type OtpPurpose = OtpRequestsLogTable['purpose'];

export interface OtpRequestInput {
  phone: string;
  purpose: OtpPurpose;
  /** Pour ACCOUNT_DELETION : le code ne vaudra que pour ce compte. */
  userId?: string;
  ip: string | null;
  deviceId?: string | null;
}

export interface OtpRequestResult {
  otpRequestId: string;
  expiresInS: number;
  resendAfterS: number;
  /** Présent uniquement en mode OTP de test (jamais en production). */
  testCode?: string;
}

export interface VerifiedOtp {
  phone: string;
  purpose: OtpPurpose;
  userId: string | null;
}

// Incrémente le compteur d'essais et renvoie la demande ; nil si elle a expiré ou a déjà servi.
const ATTEMPT_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return nil end
local attempts = redis.call('HINCRBY', KEYS[1], 'attempts', 1)
local v = redis.call('HMGET', KEYS[1], 'phone', 'purpose', 'userId', 'hash')
return {attempts, v[1], v[2], v[3] or '', v[4]}`;

/**
 * Codes à 6 chiffres, valables 5 minutes, 5 essais. Seule une empreinte HMAC (liée à la demande et au numéro)
 * est stockée, dans Redis, avec expiration : le code en clair n'est jamais conservé.
 */
@Injectable()
export class OtpService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    private readonly rateLimit: RateLimitService,
  ) {}

  async request(input: OtpRequestInput): Promise<OtpRequestResult> {
    const { phone, purpose, ip } = input;

    const cooldownKey = `otp:cool:${purpose}:${phone}`;
    const acquired = await this.redis.set(cooldownKey, '1', 'EX', OTP_RESEND_AFTER_S, 'NX');
    if (!acquired) {
      const ttl = await this.redis.ttl(cooldownKey);
      await this.logAttempt(phone, ip, purpose, 'BLOCKED');
      throw rateLimited(Math.max(ttl, 1), 'Un code vient d’être envoyé. Patientez avant d’en demander un nouveau.');
    }

    const rules = [
      { key: `otp:phone:${phone}`, limit: 3, windowS: 15 * 60 },
      { key: `otp:phone-day:${phone}`, limit: 10, windowS: 24 * 3600 },
    ];
    if (ip) rules.push({ key: `otp:ip:${ip}`, limit: 20, windowS: 3600 });
    if (input.deviceId) rules.push({ key: `otp:device:${input.deviceId}`, limit: 10, windowS: 3600 });
    try {
      await this.rateLimit.consumeOrThrow(rules, 'Trop de codes demandés. Réessayez plus tard.');
    } catch (err) {
      await this.logAttempt(phone, ip, purpose, 'BLOCKED');
      throw err;
    }

    const otpRequestId = uuidv7();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.redis
      .multi()
      .hset(`otp:req:${otpRequestId}`, {
        phone,
        purpose,
        userId: input.userId ?? '',
        hash: this.digest(otpRequestId, phone, code).toString('base64'),
        attempts: 0,
      })
      .expire(`otp:req:${otpRequestId}`, OTP_TTL_S)
      .exec();

    try {
      await this.sms.send(
        phone,
        `IvoireCovoit : votre code est ${code}. Il expire dans 5 minutes. Ne le communiquez à personne, même au support.`,
      );
    } catch (err) {
      await this.redis.del(`otp:req:${otpRequestId}`, cooldownKey);
      throw err;
    }
    await this.logAttempt(phone, ip, purpose, 'SENT');

    return {
      otpRequestId,
      expiresInS: OTP_TTL_S,
      resendAfterS: OTP_RESEND_AFTER_S,
      ...(this.sms.isTestMode && this.env.OTP_TEST_MODE ? { testCode: code } : {}),
    };
  }

  /** Vérifie un code ; à usage unique. Lève une erreur explicite sinon. */
  async verify(otpRequestId: string, code: string, ip: string | null): Promise<VerifiedOtp> {
    const key = `otp:req:${otpRequestId}`;
    const res = (await this.redis.eval(ATTEMPT_SCRIPT, 1, key)) as [number, string, string, string, string] | null;
    if (!res) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'OTP_EXPIRED', 'Ce code a expiré. Demandez-en un nouveau.');
    }
    const [attempts, phone, purpose, userId, storedHash] = res;
    if (attempts > OTP_MAX_ATTEMPTS) {
      await this.redis.del(key);
      await this.logAttempt(phone, ip, purpose as OtpPurpose, 'BLOCKED');
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'OTP_TOO_MANY_ATTEMPTS',
        'Trop d’essais avec ce code. Demandez-en un nouveau.',
      );
    }

    const ok = /^\d{6}$/.test(code) && safeEqual(this.digest(otpRequestId, phone, code), Buffer.from(storedHash, 'base64'));
    if (!ok) {
      await this.logAttempt(phone, ip, purpose as OtpPurpose, 'FAILED');
      const remaining = OTP_MAX_ATTEMPTS - attempts;
      if (remaining <= 0) await this.redis.del(key);
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        remaining > 0 ? 'OTP_INVALID' : 'OTP_TOO_MANY_ATTEMPTS',
        remaining > 0 ? 'Code incorrect.' : 'Trop d’essais avec ce code. Demandez-en un nouveau.',
        { remainingAttempts: remaining },
      );
    }

    // Usage unique : si deux vérifications arrivent en même temps, une seule supprime la clé.
    if ((await this.redis.del(key)) !== 1) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'OTP_EXPIRED', 'Ce code a expiré. Demandez-en un nouveau.');
    }
    await this.logAttempt(phone, ip, purpose as OtpPurpose, 'VERIFIED');
    return { phone, purpose: purpose as OtpPurpose, userId: userId || null };
  }

  private digest(otpRequestId: string, phone: string, code: string): Buffer {
    return hmacSha256(this.env.OTP_HMAC_SECRET, `${otpRequestId}|${phone}|${code}`);
  }

  private async logAttempt(phone: string, ip: string | null, purpose: OtpPurpose, outcome: OtpRequestsLogTable['outcome']) {
    await this.db.insertInto('otp_requests_log').values({ phone_e164: phone, ip, purpose, outcome }).execute();
  }
}
