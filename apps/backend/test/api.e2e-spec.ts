import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import { TEST_DATABASE_URL } from './test-db';

describe('API (HTTP)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.NODE_ENV = 'test';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health répond ok avec la version PostGIS', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'ok' });
    expect(res.headers['x-request-id']).toMatch(/^req_/);
  });

  it.each([
    ['yamoussokro', 'Yamoussoukro'],
    ['bassam', 'Grand-Bassam'],
    ['BOUAKE', 'Bouaké'],
    ['san pedro', 'San-Pédro'],
    ['riviera 2', 'Riviera 2, Cocody'],
  ])('autocomplétion « %s » propose « %s » en premier', async (q, expected) => {
    const res = await request(app.getHttpServer()).get('/api/v1/places/autocomplete').query({ q }).expect(200);
    expect(res.body.data[0].label).toBe(expected);
    expect(res.body.data[0].locationPrecision).toBe('APPROX');
  });

  it('refuse une recherche trop courte avec le format d’erreur standard', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/places/autocomplete').query({ q: 'a' }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fields.q).toBeDefined();
    expect(res.body.error.requestId).toBeDefined();
  });

  it('renvoie une 404 au format standard pour une route inconnue', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/inexistant').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('pose les en-têtes de sécurité', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
