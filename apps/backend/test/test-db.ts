import { Client } from 'pg';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://ivoirecovoit:devpassword@127.0.0.1:5432/ivoirecovoit_test';

/** Stockage S3 de test (RustFS local ou service CI) : bucket dédié, recréé par global-setup. */
export const TEST_S3 = {
  S3_ENDPOINT: process.env.TEST_S3_ENDPOINT ?? 'http://127.0.0.1:9000',
  S3_ACCESS_KEY: process.env.TEST_S3_ACCESS_KEY ?? 'ivoirecovoit',
  S3_SECRET_KEY: process.env.TEST_S3_SECRET_KEY ?? 'change-me-local-only-min-8-chars',
  S3_BUCKET_DOCUMENTS: 'ivoirecovoit-test',
};

export async function connectTestDb(): Promise<Client> {
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  return client;
}
