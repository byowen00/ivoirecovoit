import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

/** Valeur publique, connue de tous : utilisable seulement en développement et en test. */
export const DEV_ONLY_SECRET = 'insecure-dev-only-secret-do-not-use-in-production';

function isDevOnlyValue(value: string): boolean {
  return value === DEV_ONLY_SECRET || /change-me|insecure|dev-only/i.test(value);
}

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
    // Nombre de proxys de confiance devant l'API (pour lire la vraie IP du client).
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
    // Clés Ed25519 au format PEM (\n accepté). Absentes hors production : paire éphémère générée au démarrage.
    JWT_PRIVATE_KEY: z.string().optional(),
    JWT_PUBLIC_KEY: z.string().optional(),
    OTP_HMAC_SECRET: z.string().min(32).default(DEV_ONLY_SECRET),
    REFRESH_TOKEN_PEPPER: z.string().min(32).default(DEV_ONLY_SECRET),
    STAFF_TOTP_ENCRYPTION_KEY: z.string().min(32).default(DEV_ONLY_SECRET),
    // Aucun fournisseur SMS n'est encore intégré (contrat et identifiant d'expéditeur à obtenir).
    SMS_PROVIDER: z.enum(['none']).default('none'),
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
    if (!env.JWT_PRIVATE_KEY || !env.JWT_PUBLIC_KEY) {
      ctx.addIssue({ code: 'custom', path: ['JWT_PRIVATE_KEY'], message: 'Les clés JWT sont obligatoires en production.' });
    }
    for (const key of ['OTP_HMAC_SECRET', 'REFRESH_TOKEN_PEPPER', 'STAFF_TOTP_ENCRYPTION_KEY'] as const) {
      if (isDevOnlyValue(env[key])) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'Valeur de développement interdite en production.' });
      }
    }
    if (env.SMS_PROVIDER === 'none') {
      ctx.addIssue({
        code: 'custom',
        path: ['SMS_PROVIDER'],
        message: "Aucun fournisseur SMS n'est configuré : impossible d'envoyer les codes de connexion.",
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
