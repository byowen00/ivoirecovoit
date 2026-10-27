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

  it('accepte une configuration de production cohérente', () => {
    const env = loadEnv({
      ...base,
      NODE_ENV: 'production',
      PAYMENT_PROVIDER: 'aggregator',
      API_BASE_URL: 'https://api.example.ci',
    });
    expect(env.OTP_TEST_MODE).toBe(false);
  });
});
