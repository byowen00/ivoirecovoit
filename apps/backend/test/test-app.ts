import { Controller, Get, type INestApplication, type Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import { REDIS } from '../src/infra/redis.module';
import { CurrentAuth } from '../src/modules/auth/decorators';
import type { AuthContext } from '../src/modules/auth/request-context';
import { TEST_DATABASE_URL, TEST_S3 } from './test-db';

export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/15';


/** Route de test : exige un compte ACTIVE (comportement par défaut de la garde). */
@Controller('test-only')
class ActiveOnlyController {
  @Get('active')
  active(@CurrentAuth() auth: AuthContext) {
    return { userId: auth.userId };
  }
}

export interface TestApp {
  app: INestApplication;
  redis: Redis;
  http: () => ReturnType<typeof request>;
}

export async function createTestApp(extraControllers: Type[] = []): Promise<TestApp> {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.REDIS_URL = TEST_REDIS_URL;
  process.env.NODE_ENV = 'test';
  process.env.OTP_TEST_MODE = 'true';
  Object.assign(process.env, TEST_S3);
  // Pas d'OSRM dans les tests d'API : estimation de repli (les tests du client OSRM utilisent un faux serveur).
  delete process.env.OSRM_URL;
  // Les échéances sont déclenchées explicitement par les tests (BookingsMaintenanceService).
  process.env.JOBS_ENABLED = 'false';
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [ActiveOnlyController, ...extraControllers],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: ['error'] });
  setupApp(app);
  await app.init();
  const redis = app.get<Redis>(REDIS);
  return { app, redis, http: () => request(app.getHttpServer()) };
}

let phoneSeq = 0;
/** Numéro mobile Orange fictif, unique par test (aucun SMS n'est envoyé en mode test). */
export function uniquePhone(): string {
  phoneSeq++;
  return `07${String(Date.now() % 1_000_000).padStart(6, '0')}${String(phoneSeq % 100).padStart(2, '0')}`;
}

export interface LoggedIn {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  userId: string;
  phone: string;
}

export async function login(t: TestApp, phone = uniquePhone(), deviceLabel = 'Test'): Promise<LoggedIn> {
  const req = await t.http().post('/api/v1/auth/otp/request').send({ phone }).expect(200);
  const res = await t
    .http()
    .post('/api/v1/auth/otp/verify')
    .send({ otpRequestId: req.body.otpRequestId, code: req.body.testCode, deviceLabel })
    .expect(200);
  // Les tests enchaînent les connexions : on lève le délai de renvoi pour ce numéro.
  await t.redis.del(`otp:cool:LOGIN:+225${phone}`);
  return { ...res.body, userId: res.body.user.id, phone: `+225${phone}` };
}

/** Connexion + prénom, nom et acceptation des textes en vigueur : compte ACTIVE. */
export async function loginActive(t: TestApp, phone?: string): Promise<LoggedIn> {
  const s = await login(t, phone);
  const auth = { Authorization: `Bearer ${s.accessToken}` };
  await t.http().patch('/api/v1/me').set(auth).send({ firstName: 'Aya', lastName: 'Konan' }).expect(200);
  const me = await t.http().get('/api/v1/me').set(auth).expect(200);
  for (const c of me.body.requiredConsents) {
    await t.http().put('/api/v1/me/consents').set(auth).send({ type: c.type, version: c.version, granted: true }).expect(200);
  }
  return s;
}

export function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
