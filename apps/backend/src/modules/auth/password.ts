import { hash, verify } from '@node-rs/argon2';

const ARGON2ID = 2; // Algorithm.Argon2id (enum const non importable avec isolatedModules)

// Argon2id, paramètres minimaux recommandés par l'OWASP (19 Mio, 2 passes, 1 fil).
const OPTIONS = { algorithm: ARGON2ID, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const MIN_STAFF_PASSWORD_LENGTH = 12;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}
