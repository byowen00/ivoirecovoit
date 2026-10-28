import type { Client } from 'pg';
import { uuidv7 } from '../src/common/ids';
import { DEV_ONLY_SECRET } from '../src/config/env';
import { encryptSecret } from '../src/modules/auth/crypto';
import { hashPassword } from '../src/modules/auth/password';
import { generateTotpSecret, hotp, timeStep } from '../src/modules/auth/totp';
import type { TestApp } from './test-app';

export const PASSWORD = 'mot-de-passe-de-test-assez-long';
let seq = 0;

export interface StaffFixture {
  id: string;
  email: string;
  secret: Buffer;
}

export async function createStaff(db: Client, role: string, opts: { active?: boolean } = {}): Promise<StaffFixture> {
  const id = uuidv7();
  const email = `agent${++seq}.${Date.now()}@test.ivoirecovoit.ci`;
  const secret = generateTotpSecret();
  await db.query(`INSERT INTO users (id, email, first_name, last_name, status, is_passenger) VALUES ($1, $2, 'Agent', 'Test', 'ACTIVE', false)`, [
    id, email,
  ]);
  await db.query(`INSERT INTO staff_accounts (user_id, password_hash, totp_secret_enc, is_active) VALUES ($1, $2, $3, $4)`, [
    id, await hashPassword(PASSWORD), encryptSecret(secret, DEV_ONLY_SECRET), opts.active ?? true,
  ]);
  await db.query(`INSERT INTO staff_role_assignments (user_id, role_code) VALUES ($1, $2)`, [id, role]);
  return { id, email, secret };
}

/** Agent connecté avec le rôle donné : renvoie son jeton d'accès. */
export async function staffToken(t: TestApp, db: Client, role: string): Promise<{ token: string; staff: StaffFixture }> {
  const staff = await createStaff(db, role);
  const res = await t
    .http()
    .post('/api/v1/auth/staff/login')
    .send({ email: staff.email, password: PASSWORD, totp: hotp(staff.secret, timeStep()) })
    .expect(200);
  return { token: res.body.accessToken as string, staff };
}
