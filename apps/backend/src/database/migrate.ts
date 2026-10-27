import { Client } from 'pg';
import { loadDatabaseEnv } from '../config/env';
import { runMigrations } from './migrator';

async function main(): Promise<void> {
  const env = loadDatabaseEnv();
  const client = new Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    const { applied, skipped } = await runMigrations(client);
    console.warn(`Migrations appliquées : ${applied.length}, déjà présentes : ${skipped.length}`);
    for (const name of applied) console.warn(`  + ${name}`);
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error((err as Error).message);
  process.exit(1);
});
