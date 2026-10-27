import { Client } from 'pg';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://ivoirecovoit:devpassword@127.0.0.1:5432/ivoirecovoit_test';

export async function connectTestDb(): Promise<Client> {
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  return client;
}
