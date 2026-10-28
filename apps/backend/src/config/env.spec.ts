import { loadEnv } from './env';

const base = { DATABASE_URL: 'postgres://u:p@localhost/db' };

describe('loadEnv', () => {
  it('accepte une configuration de développement minimale', () => {
    const env = loadEnv({ ...base });
    expect(env.NODE_ENV).toBe('development');
    expect(env.PAYMENT_PROVIDER).toBe('sandbox');
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3001']);
  });

  it('refuse de démarrer sans DATABASE_URL', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });

  it('refuse le mode OTP de test en production', () => {
    expect(() =>
      loadEnv({
        ...base,
        NODE_ENV: 'production',
        OTP_TEST_MODE: 'true',
        PAYMENT_PROVIDER: 'aggregator',
        API_BASE_URL: 'https://api.example.ci',
      }),
    ).toThrow(/OTP_TEST_MODE/);
  });

  it('refuse le prestataire de paiement sandbox en production', () => {
    expect(() =>
      loadEnv({ ...base, NODE_ENV: 'production', API_BASE_URL: 'https://api.example.ci' }),
    ).toThrow(/PAYMENT_PROVIDER/);
  });

  it('refuse une API en HTTP simple en production', () => {
    expect(() =>
      loadEnv({ ...base, NODE_ENV: 'production', PAYMENT_PROVIDER: 'aggregator', API_BASE_URL: 'http://api.example.ci' }),
    ).toThrow(/HTTPS/);
  });

  const prodSecrets = {
    ...base,
    NODE_ENV: 'production',
    PAYMENT_PROVIDER: 'aggregator',
    API_BASE_URL: 'https://api.example.ci',
    JWT_PRIVATE_KEY: 'pem',
    JWT_PUBLIC_KEY: 'pem',
    OTP_HMAC_SECRET: 'a'.repeat(40),
    REFRESH_TOKEN_PEPPER: 'b'.repeat(40),
    STAFF_TOTP_ENCRYPTION_KEY: 'c'.repeat(40),
    PII_ENCRYPTION_KEY: 'd'.repeat(40),
    S3_ENDPOINT: 'http://stockage.interne:9000',
    S3_PUBLIC_ENDPOINT: 'https://documents.example.ci',
    S3_ACCESS_KEY: 'cle-acces',
    S3_SECRET_KEY: 'e'.repeat(40),
  };

  it('refuse les secrets de développement et l’absence de clés JWT en production', () => {
    const run = () => loadEnv({ ...base, NODE_ENV: 'production', PAYMENT_PROVIDER: 'aggregator', API_BASE_URL: 'https://api.example.ci' });
    expect(run).toThrow(/JWT_PRIVATE_KEY/);
    expect(run).toThrow(/OTP_HMAC_SECRET/);
    expect(run).toThrow(/REFRESH_TOKEN_PEPPER/);
    expect(run).toThrow(/STAFF_TOTP_ENCRYPTION_KEY/);
    expect(run).toThrow(/PII_ENCRYPTION_KEY/);
    expect(run).toThrow(/S3_ENDPOINT/);
    expect(() => loadEnv({ ...prodSecrets, OTP_HMAC_SECRET: 'change-me-local-only-but-long-enough-xx' })).toThrow(
      /OTP_HMAC_SECRET/,
    );
  });

  it('refuse la production tant qu’aucun fournisseur SMS réel n’est intégré', () => {
    // Avec tous les secrets corrects, seul le fournisseur SMS manque : c'est l'état réel du projet.
    let message = '';
    try {
      loadEnv(prodSecrets);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/SMS_PROVIDER/);
    expect(message.split('\n').filter((l) => l.startsWith('  - '))).toHaveLength(1);
  });

  it('refuse en production un stockage aux identifiants de démo ou aux URL signées en HTTP', () => {
    expect(() => loadEnv({ ...prodSecrets, S3_SECRET_KEY: 'rustfsadmin' })).toThrow(/S3_SECRET_KEY/);
    expect(() => loadEnv({ ...prodSecrets, S3_PUBLIC_ENDPOINT: 'http://documents.example.ci' })).toThrow(
      /S3_PUBLIC_ENDPOINT/,
    );
  });

  it('traite une adresse vide comme absente (OSRM, stockage)', () => {
    const env = loadEnv({ ...base, OSRM_URL: '', S3_ENDPOINT: '' });
    expect(env.OSRM_URL).toBeUndefined();
    expect(env.S3_ENDPOINT).toBeUndefined();
  });

  it('refuse un secret trop court', () => {
    expect(() => loadEnv({ ...base, OTP_HMAC_SECRET: 'court' })).toThrow(/OTP_HMAC_SECRET/);
  });
});
