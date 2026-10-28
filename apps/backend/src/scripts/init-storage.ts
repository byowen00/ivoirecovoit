/*
 * Crée le bucket privé des documents et autorise le dépôt direct depuis le site web (CORS_ORIGINS).
 * Idempotent. Usage : pnpm --filter @ivoirecovoit/backend storage:init
 */
import { loadEnv } from '../config/env';
import { StorageService } from '../infra/storage.service';

async function main(): Promise<void> {
  const env = loadEnv();
  const storage = new StorageService(env);
  await storage.ensureBucket(env.CORS_ORIGINS);
  console.log(`Bucket « ${storage.bucket} » prêt (privé ; dépôt autorisé depuis ${env.CORS_ORIGINS.join(', ')}).`);
}

main().catch((err: Error) => {
  console.error(`Échec : ${err.message}`);
  process.exit(1);
});
