import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

/** Valeur publique, connue de tous : utilisable seulement en développement et en test. */
export const DEV_ONLY_SECRET = 'insecure-dev-only-secret-do-not-use-in-production';

const optionalUrl = z.preprocess((v) => (v === '' ? undefined : v), z.url().optional());

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
    // Connexion rapide pour les essais : avec OTP_TEST_MODE seulement, plus de délai ni de plafond de demandes de
    // code, et les applis valident le code de test toute seules. Sans effet hors mode test (interdit en production).
    OTP_TEST_QUICK_LOGIN: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    // Entrée directe dans la console d'administration pour les essais en local (sans mot de passe ni code) :
    // seulement avec NODE_ENV development ou test ET OTP_TEST_MODE. Jamais en pré-production ni en production.
    STAFF_TEST_LOGIN: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    // Prestataire de paiement. « sandbox » : bac à sable interne, aucun argent réel (interdit en production).
    // « aggregator » : squelette d'adaptateur, pas encore intégré (contrat et documentation à obtenir).
    PAYMENT_PROVIDER: z.enum(['sandbox', 'aggregator']).default('sandbox'),
    // Secret de signature des webhooks du bac à sable (HMAC-SHA256).
    SANDBOX_WEBHOOK_SECRET: z.string().min(32).default(DEV_ONLY_SECRET),
    // Adresse de l'application web, pour le retour après la page de paiement (le retour ne change aucun statut).
    WEB_BASE_URL: z.url().default('http://localhost:3001'),
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
    // Notifications sur le téléphone. « none » : notifications dans l'application seulement.
    // « fcm » : Firebase Cloud Messaging (API HTTP v1) ; exige un projet Firebase et un compte de service (non fournis).
    PUSH_PROVIDER: z.enum(['none', 'fcm']).default('none'),
    FCM_PROJECT_ID: z.string().optional(),
    // Fichier JSON du compte de service Firebase, encodé en base64. Ne jamais le mettre dans le dépôt.
    FCM_SERVICE_ACCOUNT_B64: z.string().optional(),
    // Chiffrement applicatif des données personnelles sensibles (numéro de permis).
    PII_ENCRYPTION_KEY: z.string().min(32).default(DEV_ONLY_SECRET),
    // Stockage privé des documents (API S3 : RustFS en local, tout service compatible S3 en production).
    // Sans S3_ENDPOINT, le dépôt de documents répond 503 STORAGE_UNAVAILABLE.
    S3_ENDPOINT: optionalUrl,
    // Adresse vue par les téléphones et navigateurs pour les URL signées (par défaut S3_ENDPOINT).
    S3_PUBLIC_ENDPOINT: optionalUrl,
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_BUCKET_DOCUMENTS: z.string().min(3).default('ivoirecovoit-documents'),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
    // Moteur de routage OSRM. Absent ou injoignable : estimation de repli (vol d'oiseau × coefficient).
    OSRM_URL: optionalUrl,
    OSRM_TIMEOUT_MS: z.coerce.number().int().min(200).max(30000).default(4000),
    // Tâches périodiques (expiration des blocages, clôture des trajets) via BullMQ. Désactivées dans les tests d'API.
    JOBS_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
  })
  .superRefine((env, ctx) => {
    if (env.PAYMENT_PROVIDER === 'aggregator') {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENT_PROVIDER'],
        message: "L'adaptateur agrégateur n'est qu'un squelette : aucun agrégateur n'est encore intégré (contrat et accès à obtenir).",
      });
    }
    if (env.PUSH_PROVIDER === 'fcm' && (!env.FCM_PROJECT_ID || !env.FCM_SERVICE_ACCOUNT_B64)) {
      ctx.addIssue({
        code: 'custom',
        path: ['FCM_PROJECT_ID'],
        message: 'PUSH_PROVIDER=fcm exige FCM_PROJECT_ID et FCM_SERVICE_ACCOUNT_B64 (compte de service Firebase).',
      });
    }
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
    for (const key of ['OTP_HMAC_SECRET', 'REFRESH_TOKEN_PEPPER', 'STAFF_TOTP_ENCRYPTION_KEY', 'PII_ENCRYPTION_KEY'] as const) {
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
    if (!env.S3_ENDPOINT || !env.S3_ACCESS_KEY || !env.S3_SECRET_KEY) {
      ctx.addIssue({ code: 'custom', path: ['S3_ENDPOINT'], message: 'Le stockage des documents est obligatoire en production.' });
    } else if (isDevOnlyValue(env.S3_SECRET_KEY) || env.S3_SECRET_KEY === 'rustfsadmin') {
      ctx.addIssue({ code: 'custom', path: ['S3_SECRET_KEY'], message: 'Valeur de développement interdite en production.' });
    }
    if (!(env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT ?? 'https://').startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_PUBLIC_ENDPOINT'],
        message: 'Les URL signées des documents doivent être servies en HTTPS en production.',
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
