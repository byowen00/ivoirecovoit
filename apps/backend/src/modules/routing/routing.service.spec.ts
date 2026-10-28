import { Logger } from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Redis } from 'ioredis';
import { loadEnv } from '../../config/env';
import { RoutingService } from './routing.service';

/** Faux Redis en mémoire : seul le cache est en jeu ici. */
function memoryRedis(): Redis {
  const store = new Map<string, string>();
  return {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => {
      store.set(k, v);
      return 'OK';
    },
  } as unknown as Redis;
}

const ABIDJAN = { lat: 5.36, lng: -4.008 };
const TOUMODI = { lat: 6.5526, lng: -5.0193 };
const YAKRO = { lat: 6.8276, lng: -5.2893 };

describe('RoutingService', () => {
  let server: Server;
  let url: string;
  let calls: string[];
  let reply: (path: string) => { status: number; body: unknown };

  beforeAll(async () => {
    Logger.overrideLogger(false);
    server = createServer((req, res) => {
      calls.push(req.url!);
      const r = reply(req.url!);
      res.writeHead(r.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(r.body));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  beforeEach(() => {
    calls = [];
  });
  afterAll(() => {
    server.close();
  });

  const service = (osrmUrl?: string) =>
    new RoutingService(loadEnv({ DATABASE_URL: 'postgres://x', OSRM_URL: osrmUrl ?? '', OSRM_TIMEOUT_MS: '500' }), memoryRedis());

  it('utilise OSRM quand il répond (lng,lat dans l’URL), et met le résultat en cache', async () => {
    reply = () => ({
      status: 200,
      body: {
        code: 'Ok',
        routes: [{
          distance: 241_234.6, duration: 9_912.2,
          legs: [{ distance: 180_000, duration: 7_000 }, { distance: 61_234.6, duration: 2_912.2 }],
          geometry: { coordinates: [[-4.008, 5.36], [-5.0193, 6.5526], [-5.2893, 6.8276]] },
        }],
      },
    });
    const s = service(url);
    const r = await s.estimate([ABIDJAN, TOUMODI, YAKRO], 'INTERCITY');
    expect(r).toMatchObject({ source: 'OSRM', isEstimate: true, distanceM: 241_235, durationS: 9_912 });
    expect(r.legs).toEqual([{ distanceM: 180_000, durationS: 7_000 }, { distanceM: 61_235, durationS: 2_912 }]);
    expect(r.geometry[0]).toEqual([5.36, -4.008]); // remis en [lat, lng]
    expect(calls[0]).toMatch(/^\/route\/v1\/driving\/-4\.00800,5\.36000;-5\.01930,6\.55260;-5\.28930,6\.82760\?/);
    await s.estimate([ABIDJAN, TOUMODI, YAKRO], 'INTERCITY');
    expect(calls).toHaveLength(1); // deuxième appel servi par le cache
  });

  it('se replie sur l’estimation à vol d’oiseau sans OSRM configuré', async () => {
    const r = await service().estimate([ABIDJAN, YAKRO], 'INTERCITY');
    expect(r.source).toBe('HAVERSINE_FALLBACK');
    expect(r.isEstimate).toBe(true);
    expect(r.distanceM).toBeGreaterThan(200_000);
    expect(r.geometry).toEqual([[5.36, -4.008], [6.8276, -5.2893]]);
  });

  it('se replie si OSRM ne trouve pas de route, sans le considérer en panne', async () => {
    reply = () => ({ status: 400, body: { code: 'NoRoute' } });
    const s = service(url);
    expect((await s.estimate([ABIDJAN, TOUMODI], 'INTERCITY')).source).toBe('HAVERSINE_FALLBACK');
    expect((await s.estimate([ABIDJAN, YAKRO], 'INTERCITY')).source).toBe('HAVERSINE_FALLBACK');
    expect(calls).toHaveLength(2);
  });

  it('cesse d’interroger un OSRM injoignable pendant une minute', async () => {
    const s = service('http://127.0.0.1:1'); // port fermé
    expect((await s.estimate([ABIDJAN, TOUMODI], 'URBAN')).source).toBe('HAVERSINE_FALLBACK');
    const spy = jest.spyOn(global, 'fetch');
    expect((await s.estimate([ABIDJAN, YAKRO], 'URBAN')).source).toBe('HAVERSINE_FALLBACK');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('rejette une réponse OSRM incohérente (nombre de tronçons)', async () => {
    reply = () => ({ status: 200, body: { code: 'Ok', routes: [{ distance: 1, duration: 1, legs: [], geometry: { coordinates: [] } }] } });
    expect((await service(url).estimate([ABIDJAN, YAKRO], 'INTERCITY')).source).toBe('HAVERSINE_FALLBACK');
  });
});
