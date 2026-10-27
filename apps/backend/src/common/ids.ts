import { randomBytes, randomInt } from 'node:crypto';

/** UUID v7 (RFC 9562) : ordonné dans le temps, donc favorable aux index B-tree. */
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  const ts = BigInt(now);
  for (let i = 0; i < 6; i++) {
    bytes[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variante RFC
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Alphabet sans 0/O ni 1/I pour éviter les confusions à la lecture ou au téléphone.
const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return out;
}

/** Référence de réservation lisible, par exemple « IC-7K3P9Q ». */
export function bookingReference(): string {
  return `IC-${randomCode(6)}`;
}

/** Référence publique de trajet, par exemple « T-8F2K4M ». */
export function tripReference(): string {
  return `T-${randomCode(6)}`;
}
