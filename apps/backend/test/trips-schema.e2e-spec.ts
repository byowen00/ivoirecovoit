import type { Client } from 'pg';
import type { TripStatus } from '../src/database/types';
import { canTransition } from '../src/modules/trips/trip-state';
import { createTrip } from './fixtures';
import { connectTestDb } from './test-db';

const ALL: TripStatus[] = ['DRAFT', 'PUBLISHED', 'FULL', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

/** Chemin d'accès autorisé vers chaque statut, pour préparer l'état de départ en passant par le trigger. */
const PATH: Record<TripStatus, TripStatus[]> = {
  DRAFT: [],
  PUBLISHED: ['PUBLISHED'],
  FULL: ['PUBLISHED', 'FULL'],
  IN_PROGRESS: ['PUBLISHED', 'IN_PROGRESS'],
  COMPLETED: ['PUBLISHED', 'IN_PROGRESS', 'COMPLETED'],
  CANCELLED: ['CANCELLED'],
};

describe('Machine à états des trajets (trigger SQL) et contraintes', () => {
  let db: Client;
  beforeAll(async () => {
    db = await connectTestDb();
  });
  afterAll(async () => {
    await db.end();
  });

  for (const from of ALL) {
    for (const to of ALL.filter((s) => s !== from)) {
      it(`${from} -> ${to} : même verdict que le service`, async () => {
        await db.query('BEGIN');
        try {
          const trip = await createTrip(db, { status: 'DRAFT' });
          for (const step of PATH[from]) {
            const set = step === 'COMPLETED' ? `, completed_at = now()` : step === 'IN_PROGRESS' ? `, started_at = now()` : '';
            await db.query(`UPDATE trips SET status = $2 ${set} WHERE id = $1`, [trip.tripId, step]);
          }
          await db.query('SAVEPOINT s');
          const set = to === 'COMPLETED' ? `, completed_at = now(), started_at = coalesce(started_at, now())` : '';
          const ok = await db
            .query(`UPDATE trips SET status = $2 ${set} WHERE id = $1`, [trip.tripId, to])
            .then(() => true)
            .catch((err: Error) => {
              expect(err.message).toMatch(/Transition de trajet interdite/);
              return false;
            });
          expect(ok).toBe(canTransition(from, to));
        } finally {
          await db.query('ROLLBACK');
        }
      });
    }
  }

  it('incrémente la version à chaque modification et refuse un trajet créé directement en cours', async () => {
    await db.query('BEGIN');
    try {
      const trip = await createTrip(db, { status: 'DRAFT' });
      await db.query(`UPDATE trips SET description = 'a' WHERE id = $1`, [trip.tripId]);
      await db.query(`UPDATE trips SET description = 'b' WHERE id = $1`, [trip.tripId]);
      const { rows } = await db.query('SELECT version FROM trips WHERE id = $1', [trip.tripId]);
      expect(rows[0].version).toBe(3);
      await db.query('SAVEPOINT s');
      await expect(createTrip(db, { status: 'IN_PROGRESS' })).rejects.toThrow(/Statut initial de trajet invalide/);
    } finally {
      await db.query('ROLLBACK');
    }
  });

  it('refuse deux trajets publiés simultanés du même conducteur, même avec deux véhicules', async () => {
    await db.query('BEGIN');
    try {
      const first = await createTrip(db);
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO vehicles (id, driver_id, make, model, color, plate_number, seats_capacity, verification_status)
         VALUES (gen_random_uuid(), $1, 'Kia', 'Rio', 'Bleu', 'ZZ-999-ZZ', 3, 'APPROVED') RETURNING id`,
        [first.driverId],
      );
      await db.query('SAVEPOINT s');
      await expect(
        createTrip(db, { vehicle: { driverId: first.driverId, vehicleId: rows[0]!.id }, departure: new Date(Date.now() + 2 * 86_400_000 + 3_600_000) }),
      ).rejects.toThrow(/trips_driver_no_overlap/);
    } finally {
      await db.query('ROLLBACK');
    }
  });
});
