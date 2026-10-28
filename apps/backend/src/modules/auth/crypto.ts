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
 * Chiffrement applicatif AES-256-GCM : secrets TOTP du personnel (clé STAFF_TOTP_ENCRYPTION_KEY) et données
 * personnelles sensibles comme le numéro de permis (clé PII_ENCRYPTION_KEY, usage « pii »).
 * Format stocké : version (1 octet) | IV (12) | tag (16) | texte chiffré.
 */
const ENC_VERSION = 1;

function deriveKey(secret: string, purpose: string): Buffer {
  return createHash('sha256').update(`ivoirecovoit:${purpose}:${secret}`).digest();
}

export function encryptSecret(plain: Buffer, secret: string, purpose = 'totp'): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret, purpose), iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from([ENC_VERSION]), iv, cipher.getAuthTag(), enc]);
}

export function decryptSecret(stored: Buffer, secret: string, purpose = 'totp'): Buffer {
  if (stored[0] !== ENC_VERSION) throw new Error('Format de secret chiffré inconnu');
  const iv = stored.subarray(1, 13);
  const tag = stored.subarray(13, 29);
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret, purpose), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(stored.subarray(29)), decipher.final()]);
}
