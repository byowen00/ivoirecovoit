import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { runMigrations } from '../src/database/migrator';
import { seedPlaces } from '../src/database/seeds/places';
import { TEST_DATABASE_URL } from './test-db';

/** Recrée une base de test vide, applique toutes les migrations et le référentiel. */
export default async function globalSetup(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.slice(1);
  if (!dbName.endsWith('_test')) throw new Error('La base de test doit se terminer par _test');

  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = '/postgres';
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  await runMigrations(client);
  await client.query(readFileSync(join(__dirname, '../src/database/seeds/reference.sql'), 'utf8'));
  await seedPlaces(client);
  await client.end();
}
