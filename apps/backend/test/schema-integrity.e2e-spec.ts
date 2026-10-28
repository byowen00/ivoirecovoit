import type { Client } from 'pg';
import { uuidv7 } from '../src/common/ids';
import { connectTestDb } from './test-db';
import { createBooking, createDriverWithVehicle, createTrip, createUser } from './fixtures';

/*
 * Vérifie que la base refuse d'elle-même les états incohérents, indépendamment du code applicatif.
 * Chaque test tourne dans une transaction annulée à la fin.
 */
describe('Intégrité du schéma (PostgreSQL + PostGIS réels)', () => {
  let db: Client;

  beforeAll(async () => {
    db = await connectTestDb();
  });
  afterAll(async () => {
    await db.end();
  });
  beforeEach(async () => {
    await db.query('BEGIN');
  });
  afterEach(async () => {
    await db.query('ROLLBACK');
  });

  // Reçoit une fonction : la requête ne doit partir qu'après la pose du point de sauvegarde.
  async function expectRejected(run: () => Promise<unknown>, pattern: RegExp): Promise<void> {
    await db.query('SAVEPOINT s');
    await expect(run()).rejects.toThrow(pattern);
    await db.query('ROLLBACK TO SAVEPOINT s');
  }

  it('enregistre une réservation cohérente et son historique de statut', async () => {
    const trip = await createTrip(db);
    const bookingId = await createBooking(db, trip, await createUser(db));
    const { rows } = await db.query(
      'SELECT pickup_seq, dropoff_seq FROM bookings WHERE id = $1',
      [bookingId],
    );
    expect(rows[0]).toEqual({ pickup_seq: 0, dropoff_seq: 2 }); // recopiés depuis les arrêts par trigger
    const history = await db.query('SELECT from_status, to_status FROM booking_status_history WHERE booking_id = $1', [
      bookingId,
    ]);
    expect(history.rows).toEqual([{ from_status: null, to_status: 'PENDING_PAYMENT' }]);
  });

  it('refuse un total incohérent avec le sous-total et les frais', async () => {
    const trip = await createTrip(db);
    await expectRejected(async () => createBooking(db, trip, await createUser(db), { total_xof: 5000 }), /bookings_check/);
  });

  it("refuse un arrêt qui n'appartient pas au trajet réservé", async () => {
    const tripA = await createTrip(db);
    const tripB = await createTrip(db);
    const mixed = { ...tripA, stopIds: [tripB.stopIds[0]!, tripA.stopIds[1]!, tripA.stopIds[2]!] };
    await expectRejected(async () => createBooking(db, mixed, await createUser(db)), /foreign key/);
  });

  it('refuse deux réservations actives du même passager sur le même trajet', async () => {
    const trip = await createTrip(db);
    const passenger = await createUser(db);
    await createBooking(db, trip, passenger);
    await expectRejected(async () => createBooking(db, trip, passenger), /bookings_one_active_per_trip/);
  });

  it('refuse les transitions de réservation interdites', async () => {
    const trip = await createTrip(db);
    const bookingId = await createBooking(db, trip, await createUser(db));
    await expectRejected(
      async () => db.query(`UPDATE bookings SET status = 'COMPLETED' WHERE id = $1`, [bookingId]),
      /Transition de réservation interdite : PENDING_PAYMENT -> COMPLETED/,
    );
    await db.query(`UPDATE bookings SET status = 'CONFIRMED', payment_status = 'PAID' WHERE id = $1`, [bookingId]);
    await expectRejected(
      async () => db.query(`UPDATE bookings SET status = 'PENDING_PAYMENT' WHERE id = $1`, [bookingId]),
      /CONFIRMED -> PENDING_PAYMENT/,
    );
  });

  it('refuse deux trajets actifs qui se chevauchent pour le même véhicule', async () => {
    const vehicle = await createDriverWithVehicle(db);
    const departure = new Date(Date.now() + 3 * 86_400_000);
    await createTrip(db, { vehicle, departure, hours: 4 });
    await expectRejected(
      async () => createTrip(db, { vehicle, departure: new Date(departure.getTime() + 2 * 3_600_000) }),
      /trips_vehicle_no_overlap/,
    );
    // Un trajet après l'arrivée estimée est accepté
    await createTrip(db, { vehicle, departure: new Date(departure.getTime() + 5 * 3_600_000) });
  });

  it("n'autorise qu'un paiement réussi par réservation et empêche la régression d'un succès", async () => {
    const trip = await createTrip(db);
    const bookingId = await createBooking(db, trip, await createUser(db));
    const paymentId = uuidv7();
    await db.query(
      `INSERT INTO payments (id, booking_id, provider, method, amount_xof, status, idempotency_key, expires_at)
       VALUES ($1, $2, 'sandbox', 'WAVE', 5300, 'PENDING', $3, now() + interval '15 minutes')`,
      [paymentId, bookingId, uuidv7()],
    );
    await expectRejected(
      async () => db.query(
        `INSERT INTO payments (id, booking_id, provider, method, amount_xof, status, idempotency_key, expires_at)
         VALUES ($1, $2, 'sandbox', 'WAVE', 5300, 'PENDING', $3, now() + interval '15 minutes')`,
        [uuidv7(), bookingId, uuidv7()],
      ),
      /payments_one_pending_per_booking/,
    );
    await db.query(`UPDATE payments SET status = 'SUCCEEDED', succeeded_at = now() WHERE id = $1`, [paymentId]);
    await expectRejected(
      async () => db.query(`UPDATE payments SET status = 'FAILED' WHERE id = $1`, [paymentId]),
      /Transition de paiement interdite : SUCCEEDED -> FAILED/,
    );
  });

  it('refuse des remboursements supérieurs au montant payé', async () => {
    const trip = await createTrip(db);
    const bookingId = await createBooking(db, trip, await createUser(db));
    const paymentId = uuidv7();
    await db.query(
      `INSERT INTO payments (id, booking_id, provider, method, amount_xof, status, idempotency_key, expires_at, succeeded_at)
       VALUES ($1, $2, 'sandbox', 'WAVE', 5300, 'SUCCEEDED', $3, now(), now())`,
      [paymentId, bookingId, uuidv7()],
    );
    const refund = (amount: number, reason = 'DISPUTE') =>
      db.query(
        `INSERT INTO refunds (id, payment_id, booking_id, amount_xof, reason_code, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [uuidv7(), paymentId, bookingId, amount, reason, uuidv7()],
      );
    await refund(3000, 'PASSENGER_CANCELLED');
    // Un second remboursement automatique pour le même motif est refusé (tâche rejouée).
    await expectRejected(async () => refund(1, 'PASSENGER_CANCELLED'), /refunds_one_active_per_reason/);
    await expectRejected(async () => refund(2301), /supérieurs au montant payé/);
    await refund(2300);
  });

  it('refuse un journal comptable déséquilibré à la validation de la transaction', async () => {
    const journal = uuidv7();
    await db.query('SAVEPOINT s');
    await db.query(`INSERT INTO ledger_entries (journal_id, account, amount_xof) VALUES ($1, 'PROVIDER_CLEARING', 5300)`, [
      journal,
    ]);
    await db.query(`INSERT INTO ledger_entries (journal_id, account, amount_xof) VALUES ($1, 'DRIVER_PAYABLE', -5000)`, [
      journal,
    ]);
    await expect(db.query('SET CONSTRAINTS ledger_balanced IMMEDIATE')).rejects.toThrow(/déséquilibré/);
    await db.query('ROLLBACK TO SAVEPOINT s');

    const ok = uuidv7();
    await db.query(
      `INSERT INTO ledger_entries (journal_id, account, amount_xof) VALUES
         ($1, 'PROVIDER_CLEARING', 5300), ($1, 'DRIVER_PAYABLE', -4500),
         ($1, 'PLATFORM_REVENUE_COMMISSION', -500), ($1, 'PLATFORM_REVENUE_FEES', -300)`,
      [ok],
    );
    await db.query('SET CONSTRAINTS ledger_balanced IMMEDIATE');
  });

  it("interdit la modification et la suppression du journal d'audit", async () => {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO audit_logs (action, reason) VALUES ('test.action', 'test') RETURNING id`,
    );
    await expectRejected(async () => db.query(`UPDATE audit_logs SET reason = 'modifié' WHERE id = $1`, [rows[0]!.id]), /ajout seul/);
    await expectRejected(async () => db.query(`DELETE FROM audit_logs WHERE id = $1`, [rows[0]!.id]), /ajout seul/);
  });

  it('refuse un prix de segment qui n’est pas un multiple de 50 XOF', async () => {
    const trip = await createTrip(db);
    await expectRejected(
      async () => db.query(`UPDATE trip_stops SET price_from_origin_xof = 3025 WHERE id = $1`, [trip.stopIds[1]]),
      /trip_stops_price_from_origin_xof_check/,
    );
  });
});
