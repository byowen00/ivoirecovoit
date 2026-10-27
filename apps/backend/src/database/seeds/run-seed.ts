import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { loadDatabaseEnv } from '../../config/env';
import { seedDemo } from './demo';
import { seedPlaces } from './places';

async function main(): Promise<void> {
  const kind = process.argv[2];
  if (kind !== 'reference' && kind !== 'demo') {
    throw new Error('Usage : run-seed.ts reference|demo');
  }
  const env = loadDatabaseEnv();
  if (kind === 'demo' && env.NODE_ENV === 'production') {
    throw new Error('Les données de démonstration ne peuvent pas être chargées en production.');
  }
  const client = new Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    if (kind === 'reference') {
      await client.query(readFileSync(join(__dirname, 'reference.sql'), 'utf8'));
      const n = await seedPlaces(client);
      console.warn(`Référentiel chargé : ${n} lieux.`);
    } else {
      const summary = await seedDemo(client);
      console.warn(`Données [DEMO] chargées : ${JSON.stringify(summary)}`);
    }
    await client.query('COMMIT');
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
