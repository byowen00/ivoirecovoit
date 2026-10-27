import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'pg';

export const MIGRATIONS_DIR = join(__dirname, 'migrations');

// Clé arbitraire mais fixe : empêche deux processus de migrer en même temps.
const MIGRATION_LOCK_KEY = 4_250_007;

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

/**
 * Applique les fichiers SQL de `dir` dans l'ordre lexical, chacun dans sa propre transaction.
 * Un fichier déjà appliqué dont le contenu a changé provoque une erreur : on ne réécrit
 * jamais une migration publiée, on en ajoute une nouvelle.
 */
export async function runMigrations(client: Client, dir = MIGRATIONS_DIR): Promise<MigrationResult> {
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort();

  await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        checksum   char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM schema_migrations',
    );
    const done = new Map(rows.map((r) => [r.name, r.checksum]));
    const result: MigrationResult = { applied: [], skipped: [] };

    for (const file of files) {
      const sql = readFileSync(join(dir, file), 'utf8');
      const sum = checksum(sql);
      const previous = done.get(file);
      if (previous) {
        if (previous !== sum) {
          throw new Error(`La migration ${file} a été modifiée après son application.`);
        }
        result.skipped.push(file);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [file, sum]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Échec de la migration ${file} : ${(err as Error).message}`, { cause: err });
      }
      result.applied.push(file);
    }
    return result;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
  }
}
