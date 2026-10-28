/*
 * Crée un compte du personnel (mot de passe Argon2id + TOTP obligatoire).
 *   pnpm --filter @ivoirecovoit/backend staff:create -- --email a@b.ci --first Awa --last Koné --role SUPER_ADMIN
 * Le mot de passe est lu dans STAFF_PASSWORD ou demandé au clavier. Le secret TOTP n'est affiché qu'une fois :
 * il faut l'enregistrer immédiatement dans une application d'authentification.
 */
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { Client } from 'pg';
import { z } from 'zod';
import { uuidv7 } from '../common/ids';
import { DEV_ONLY_SECRET } from '../config/env';
import { encryptSecret } from '../modules/auth/crypto';
import { hashPassword, MIN_STAFF_PASSWORD_LENGTH } from '../modules/auth/password';
import { generateTotpSecret, otpauthUri } from '../modules/auth/totp';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  STAFF_TOTP_ENCRYPTION_KEY: z.string().min(32).default(DEV_ONLY_SECRET),
});

async function readPassword(): Promise<string> {
  if (process.env.STAFF_PASSWORD) return process.env.STAFF_PASSWORD;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const value = await rl.question('Mot de passe (12 caractères minimum) : ');
  rl.close();
  return value;
}

async function main(): Promise<void> {
  const env = envSchema.parse(process.env);
  if (env.NODE_ENV === 'production' && env.STAFF_TOTP_ENCRYPTION_KEY === DEV_ONLY_SECRET) {
    throw new Error('STAFF_TOTP_ENCRYPTION_KEY doit être défini en production.');
  }
  const { values } = parseArgs({
    options: { email: { type: 'string' }, first: { type: 'string' }, last: { type: 'string' }, role: { type: 'string' } },
  });
  const args = z
    .object({
      email: z.email().toLowerCase(),
      first: z.string().min(1).max(60),
      last: z.string().min(1).max(60),
      role: z.enum(['SUPPORT', 'ADMIN', 'FINANCE', 'SUPER_ADMIN']),
    })
    .parse(values);
  const password = await readPassword();
  if (password.length < MIN_STAFF_PASSWORD_LENGTH) throw new Error('Mot de passe trop court.');

  const secret = generateTotpSecret();
  const client = new Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const id = uuidv7();
    await client.query(
      `INSERT INTO users (id, email, email_verified_at, first_name, last_name, status, is_passenger)
       VALUES ($1, $2, now(), $3, $4, 'ACTIVE', false)`,
      [id, args.email, args.first, args.last],
    );
    await client.query(`INSERT INTO staff_accounts (user_id, password_hash, totp_secret_enc) VALUES ($1, $2, $3)`, [
      id, await hashPassword(password), encryptSecret(secret, env.STAFF_TOTP_ENCRYPTION_KEY),
    ]);
    await client.query(`INSERT INTO staff_role_assignments (user_id, role_code) VALUES ($1, $2)`, [id, args.role]);
    await client.query(
      `INSERT INTO audit_logs (actor_id, action, target_type, target_id, changes) VALUES (NULL, 'staff.created', 'user', $1, $2)`,
      [id, JSON.stringify({ role: args.role, via: 'cli' })],
    );
    await client.query('COMMIT');
    console.log(`Compte du personnel créé : ${args.email} (${args.role})`);
    console.log('Ajoutez ce compte dans une application d’authentification (affiché une seule fois) :');
    console.log(otpauthUri(secret, args.email));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error((err as Error).message);
  process.exit(1);
});
