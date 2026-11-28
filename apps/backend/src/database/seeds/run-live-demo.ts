import { Redis } from 'ioredis';
import { Client } from 'pg';
import { loadDatabaseEnv } from '../../config/env';
import type { LatLng } from '../../modules/routing/haversine';
import { pointAlong, seedLiveDemo } from './live-demo';
import { seedOffersDemo } from './offers-demo';

/*
 * pnpm demo:live — crée (si besoin) 10 conducteurs et 10 passagers [DEMO] en trajet dans Abidjan, puis fait
 * avancer les voitures toutes les 5 s sur la carte de la console (/admin/carte). Positions SIMULÉES, pas des GPS.
 * Ctrl+C pour arrêter : les positions disparaissent d'elles-mêmes (elles expirent dans Redis).
 */
async function main(): Promise<void> {
  const env = loadDatabaseEnv();
  if (env.NODE_ENV === 'production') throw new Error('Simulation interdite en production.');
  const client = new Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  await client.query('BEGIN');
  try {
    const summary = await seedLiveDemo(client);
    const offers = await seedOffersDemo(client);
    await client.query('COMMIT');
    console.warn(`Comptes [DEMO] prêts : ${summary.drivers} conducteurs, ${summary.passengers} passagers ; ${summary.trips} trajet(s) démarré(s).`);
    console.warn(`${offers.trips} trajet(s) proposé(s) ajouté(s) (ville et interurbain, Économique / Confort / Luxe), ${offers.requests} demande(s) de passager à traiter.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  const tick = async () => {
    const { rows } = await client.query<{ id: string; started_at: Date; estimated_duration_s: number; geo: string }>(
      `SELECT id, started_at, estimated_duration_s, ST_AsGeoJSON(route_geometry::geometry) AS geo
         FROM trips WHERE is_demo AND status = 'IN_PROGRESS' AND route_geometry IS NOT NULL`,
    );
    const now = Date.now();
    for (const t of rows) {
      const line: LatLng[] = (JSON.parse(t.geo) as { coordinates: [number, number][] }).coordinates.map(([lng, lat]) => ({ lat, lng }));
      if (line.length < 2) continue;
      // Aller puis retour en boucle, pour que la démonstration dure aussi longtemps que voulu.
      const cycle = ((now - t.started_at.getTime()) / 1000 / Math.max(60, t.estimated_duration_s)) % 2;
      const p = pointAlong(cycle <= 1 ? line : [...line].reverse(), cycle <= 1 ? cycle : cycle - 1);
      const point = { lat: p.lat, lng: p.lng, accuracyM: null, heading: Math.round(p.heading), recordedAt: new Date(now).toISOString() };
      await redis.set(`live:trip:${t.id}`, JSON.stringify(point), 'EX', 15 * 60);
    }
    process.stdout.write(`\r${new Date().toLocaleTimeString('fr-FR')} : ${rows.length} voiture(s) [DEMO] en mouvement sur /admin/carte   `);
  };
  await tick();
  const timer = setInterval(() => void tick().catch((e: unknown) => console.error((e as Error).message)), 5000);
  const stop = () => {
    clearInterval(timer);
    void Promise.all([client.end(), redis.quit()]).then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err: unknown) => {
  console.error((err as Error).message);
  process.exit(1);
});
