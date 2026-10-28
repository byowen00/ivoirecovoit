import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../src/database/migrator';
import { connectTestDb } from './test-db';

describe('Migrations', () => {
  it('sont idempotentes : un second passage ne réapplique rien', async () => {
    const db = await connectTestDb();
    try {
      const result = await runMigrations(db);
      expect(result.applied).toEqual([]);
      expect(result.skipped.length).toBe(13);
    } finally {
      await db.end();
    }
  });

  it("détectent une migration modifiée après son application", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ic-mig-'));
    const db = await connectTestDb();
    try {
      await db.query('DROP TABLE IF EXISTS zz_migration_test');
      await db.query(`DELETE FROM schema_migrations WHERE name = '9999_zz_test.sql'`);
      writeFileSync(join(dir, '9999_zz_test.sql'), 'CREATE TABLE zz_migration_test (id int);');
      expect((await runMigrations(db, dir)).applied).toEqual(['9999_zz_test.sql']);
      writeFileSync(join(dir, '9999_zz_test.sql'), 'CREATE TABLE zz_migration_test (id bigint);');
      await expect(runMigrations(db, dir)).rejects.toThrow(/modifiée après son application/);
    } finally {
      await db.query('DROP TABLE IF EXISTS zz_migration_test');
      await db.query(`DELETE FROM schema_migrations WHERE name = '9999_zz_test.sql'`);
      await db.end();
    }
  });
});
