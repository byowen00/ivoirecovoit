import { createHmac, randomBytes } from 'node:crypto';

/* TOTP (RFC 6238) : HMAC-SHA1, pas de 30 s, 6 chiffres, compatible avec les applications d'authentification. */

const STEP_S = 30;
const DIGITS = 6;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function generateTotpSecret(): Buffer {
  return randomBytes(20);
}

export function timeStep(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / STEP_S);
}

/** HOTP (RFC 4226) pour un compteur donné. */
export function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(bin).padStart(DIGITS, '0');
}

/**
 * Vérifie un code avec une tolérance d'un pas (±30 s de décalage d'horloge).
 * Renvoie le pas accepté, à mémoriser pour refuser tout rejeu ; null si invalide ou déjà utilisé.
 */
export function verifyTotp(secret: Buffer, code: string, lastUsedStep: number | null, nowMs = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = timeStep(nowMs);
  for (const step of [current - 1, current, current + 1]) {
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    if (hotp(secret, step) === code) return step;
  }
  return null;
}

export function otpauthUri(secret: Buffer, account: string, issuer = 'IvoireCovoit Admin'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${base32Encode(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
