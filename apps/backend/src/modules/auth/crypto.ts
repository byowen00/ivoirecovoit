import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function hmacSha256(secret: string, value: string): Buffer {
  return createHmac('sha256', secret).update(value).digest();
}

export function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Jeton opaque (256 bits) pour les refresh tokens. */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/*
 * Chiffrement des secrets TOTP du personnel : AES-256-GCM, clé dérivée de STAFF_TOTP_ENCRYPTION_KEY.
 * Format stocké : version (1 octet) | IV (12) | tag (16) | texte chiffré.
 */
const ENC_VERSION = 1;

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(`ivoirecovoit:totp:${secret}`).digest();
}

export function encryptSecret(plain: Buffer, secret: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from([ENC_VERSION]), iv, cipher.getAuthTag(), enc]);
}

export function decryptSecret(stored: Buffer, secret: string): Buffer {
  if (stored[0] !== ENC_VERSION) throw new Error('Format de secret chiffré inconnu');
  const iv = stored.subarray(1, 13);
  const tag = stored.subarray(13, 29);
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(stored.subarray(29)), decipher.final()]);
}
