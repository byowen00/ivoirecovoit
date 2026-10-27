import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

/**
 * Variables d'environnement du backend.
 * Toute valeur manquante ou incohérente fait échouer le démarrage :
 * mieux vaut un serveur qui ne démarre pas qu'un serveur mal configuré.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    API_BASE_URL: z.url().default('http://localhost:3000'),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3001')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    DATABASE_URL: z.string().min(1),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
    OTP_TEST_MODE: booleanString,
    PAYMENT_PROVIDER: z.enum(['sandbox', 'aggregator']).default('sandbox'),
    SWAGGER_ENABLED: booleanString,
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    if (env.OTP_TEST_MODE) {
      ctx.addIssue({
        code: 'custom',
        path: ['OTP_TEST_MODE'],
        message: 'Le mode OTP de test est interdit en production.',
      });
    }
    if (env.PAYMENT_PROVIDER === 'sandbox') {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENT_PROVIDER'],
        message: 'Le prestataire de paiement sandbox est interdit en production.',
      });
    }
    if (!env.API_BASE_URL.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['API_BASE_URL'],
        message: "L'API doit être servie en HTTPS en production.",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuration invalide :\n${details}`);
  }
  return result.data;
}

export const ENV = Symbol('ENV');

/** Pour les scripts d'exploitation (migrations, données) : seule la connexion à la base est requise. */
const databaseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
});

export function loadDatabaseEnv(source: NodeJS.ProcessEnv = process.env): z.infer<typeof databaseEnvSchema> {
  const result = databaseEnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Configuration invalide : ${result.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  }
  return result.data;
}
