import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { uuidv7 } from '../src/common/ids';
import { BookingsMaintenanceService } from '../src/modules/bookings/maintenance.service';
import { JobsService } from '../src/modules/jobs/jobs.service';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { PAYMENT_PROVIDER } from '../src/modules/payments/provider';
import { ReconciliationService } from '../src/modules/payments/reconciliation.service';
import { RefundsService } from '../src/modules/payments/refunds.service';
import { SANDBOX_SIGNATURE_HEADER, type SandboxPaymentProvider } from '../src/modules/payments/sandbox.provider';
import { createTrip, ensureFeeRule, type TripFixture } from './fixtures';
import { bearer, createTestApp, type LoggedIn, loginActive, type TestApp } from './test-app';
import { connectTestDb } from './test-db';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const PHONE = '0707070707';

describe('Paiement en bac à sable et webhooks (doc 05 §5, §7, §9)', () => {
  let t: TestApp;
  let db: Client;
  let sbx: SandboxPaymentProvider;
  let maintenance: BookingsMaintenanceService;
  let payments: PaymentsService;
  let refunds: RefundsService;
  let jobs: JobsService;
  let reconciliation: ReconciliationService;
  let alice: LoggedIn;
  let bruno: LoggedIn;
  const startedAt = new Date(Date.now() - MINUTE);

  beforeAll(async () => {
    t = await createTestApp();
    db = await connectTestDb();
    sbx = t.app.get(PAYMENT_PROVIDER);
    maintenance = t.app.get(BookingsMaintenanceService);
    payments = t.app.get(PaymentsService);
    refunds = t.app.get(RefundsService);
    jobs = t.app.get(JobsService);
    reconciliation = t.app.get(ReconciliationService);
    await ensureFeeRule(db);
    alice = await loginActive(t);
    bruno = await loginActive(t);
  });
  beforeEach(async () => {
    await t.redis.flushdb();
    await db.query(
      `UPDATE bookings SET status = 'EXPIRED' WHERE passenger_id = ANY($1) AND status IN ('PENDING_ACCEPTANCE','PENDING_PAYMENT')`,
      [[alice.userId, bruno.userId]],
    );
  });
  afterAll(async () => {
    await db.end();
    await t.app.close();
  });

  // ------------------------------------------------------------------ outils

  async function book(who: LoggedIn, trip: TripFixture, seats = 1): Promise<string> {
    const res = await t
      .http()
      .post('/api/v1/bookings')
      .set(bearer(who.accessToken))
      .set('Idempotency-Key', randomUUID())
      .send({ tripId: trip.tripId, pickupStopId: trip.stopIds[0], dropoffStopId: trip.stopIds[2], seats, acceptCancellationPolicy: true })
      .expect(201);
    return res.body.id;
  }

  function initiate(who: LoggedIn, bookingId: string, body: Record<string, unknown> = { method: 'WAVE', payerPhone: PHONE }, key = randomUUID()) {
    return t.http().post(`/api/v1/bookings/${bookingId}/payments`).set(bearer(who.accessToken)).set('Idempotency-Key', key).send(body);
  }

  async function pay(who: LoggedIn, bookingId: string) {
    const res = await initiate(who, bookingId).expect(201);
    const ref = await providerRef(res.body.id);
    return { paymentId: res.body.id as string, ref, amountXof: res.body.amountXof as number };
  }

  async function providerRef(paymentId: string): Promise<string> {
    const { rows } = await db.query<{ provider_reference: string }>(`SELECT provider_reference FROM payments WHERE id = $1`, [paymentId]);
    return rows[0]!.provider_reference;
  }

  function postWebhook(hook: { rawBody: Buffer; headers: Record<string, string> }, provider = 'sandbox') {
    return t.http().post(`/api/v1/webhooks/payments/${provider}`).set(hook.headers).send(hook.rawBody.toString('utf8'));
  }

  /** Le « prestataire » décide, puis envoie son webhook signé. */
  async function settle(p: { paymentId: string; ref: string; amountXof: number }, status: 'SUCCEEDED' | 'FAILED' | 'EXPIRED' | 'CANCELLED', failureCode?: string) {
    await sbx.settle(p.ref, status);
    const hook = sbx.buildWebhook({ providerReference: p.ref, merchantReference: p.paymentId, status, amountXof: p.amountXof, failureCode });
    return { hook, res: await postWebhook(hook).expect(200) };
  }

  async function paidBooking(who: LoggedIn, trip: TripFixture): Promise<string> {
    const id = await book(who, trip);
    await settle(await pay(who, id), 'SUCCEEDED');
    return id;
  }

  async function bookingRow(id: string) {
    const { rows } = await db.query(`SELECT status, payment_status, hold_expires_at, hold_extended, refund_due_xof::int FROM bookings WHERE id = $1`, [id]);
    return rows[0];
  }

  async function paymentRow(id: string) {
    const { rows } = await db.query(`SELECT status, failure_code, payer_phone_masked FROM payments WHERE id = $1`, [id]);
    return rows[0];
  }

  async function occupancy(trip: TripFixture): Promise<number> {
    const { rows } = await db.query<{ occ: number }>(`SELECT trip_max_occupancy($1, 0, 2) AS occ`, [trip.tripId]);
    return rows[0]!.occ;
  }

  async function count(sqlText: string, params: unknown[]): Promise<number> {
    const { rows } = await db.query<{ n: number }>(sqlText, params);
    return rows[0]!.n;
  }

  async function balances(bookingId: string): Promise<Record<string, number>> {
    const { rows } = await db.query<{ account: string; total: number }>(
      `SELECT account, sum(amount_xof)::int AS total FROM ledger_entries WHERE booking_id = $1 GROUP BY account`,
      [bookingId],
    );
    return Object.fromEntries(rows.map((r) => [r.account, r.total]));
  }

  async function driverSession(trip: TripFixture): Promise<LoggedIn> {
    const s = await loginActive(t);
    await db.query(`INSERT INTO driver_profiles (user_id, verification_status, verification_level) VALUES ($1, 'APPROVED', 1)`, [s.userId]);
    await db.query(`UPDATE vehicles SET driver_id = $1 WHERE id = $2`, [s.userId, trip.vehicleId]);
    await db.query(`UPDATE trips SET driver_id = $1 WHERE id = $2`, [s.userId, trip.tripId]);
    return s;
  }

  // ------------------------------------------------------------------ moyens et initialisation

  it('moyens proposés : les 4 opérateurs du bac à sable, espèces désactivées', async () => {
    const res = await t.http().get('/api/v1/payments/methods').set(bearer(alice.accessToken)).expect(200);
    expect(res.body).toMatchObject({ provider: 'sandbox', sandbox: true, cashEnabled: false });
    expect(res.body.methods.map((m: { code: string }) => m.code)).toEqual(['WAVE', 'ORANGE_MONEY', 'MTN_MOMO', 'MOOV_MONEY']);
  });

  it('initialisation : paiement en attente, page du bac à sable, numéro masqué, blocage conservé', async () => {
    const trip = await createTrip(db);
    const id = await book(alice, trip);
    const res = await initiate(alice, id).expect(201);
    expect(res.body).toMatchObject({ bookingId: id, status: 'PENDING', method: 'WAVE', amountXof: 5300, sandbox: true, booking: { status: 'PENDING_PAYMENT', paymentStatus: 'PROCESSING' } });
    expect(res.body.nextAction).toMatchObject({ type: 'REDIRECT' });
    expect(res.body.nextAction.url).toMatch(/\/api\/v1\/sandbox\/pay\/SBX-/);
    expect(res.body.payerPhoneMasked).not.toContain('070707');
    // Le numéro complet n'est stocké nulle part dans les paiements.
    const stored = await count(`SELECT count(*)::int AS n FROM payments WHERE booking_id = $1 AND payer_phone_masked LIKE '%07070707%'`, [id]);
    expect(stored).toBe(0);
    const view = await t.http().get(`/api/v1/bookings/${id}`).set(bearer(alice.accessToken)).expect(200);
    expect(view.body.actions.canPay).toBe(false);
    expect(view.body.payment).toMatchObject({ id: res.body.id, status: 'PENDING' });
    expect(await occupancy(trip)).toBe(1);
  });

  it('initialisation : clé obligatoire, rejeu idempotent, un seul paiement en cours, contrôles', async () => {
    const trip = await createTrip(db);
    const id = await book(alice, trip);
    expect((await t.http().post(`/api/v1/bookings/${id}/payments`).set(bearer(alice.accessToken)).send({ method: 'WAVE', payerPhone: PHONE })).body.error.code)
      .toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect((await initiate(alice, id, { method: 'CASH', payerPhone: PHONE })).status).toBe(400);
    expect((await initiate(alice, id, { method: 'WAVE', payerPhone: '12345678' })).body.error.code).toBe('VALIDATION_ERROR');
    expect((await initiate(bruno, id)).status).toBe(404);
    const key = randomUUID();
    const a = await initiate(alice, id, undefined, key).expect(201);
    const b = await initiate(alice, id, undefined, key).expect(201);
    expect(b.body.id).toBe(a.body.id);
    expect(await count(`SELECT count(*)::int AS n FROM payments WHERE booking_id = $1`, [id])).toBe(1);
    expect((await initiate(alice, id)).body.error.code).toBe('PAYMENT_IN_PROGRESS');
    // Un autre compte ne voit pas le paiement.
    expect((await t.http().get(`/api/v1/payments/${a.body.id}`).set(bearer(bruno.accessToken))).status).toBe(404);
    // Réservation expirée : plus de paiement possible.
    const late = await book(bruno, trip);
    await db.query(`UPDATE bookings SET hold_expires_at = now() - interval '1 second' WHERE id = $1`, [late]);
    expect((await initiate(bruno, late)).body.error.code).toBe('BOOKING_EXPIRED');
  });

  // ------------------------------------------------------------------ T2

  it('T2 : webhook reçu deux fois en séquence puis deux fois en parallèle : une seule confirmation', async () => {
    const trip = await createTrip(db);
    const id = await book(alice, trip);
    const p = await pay(alice, id);
    const { hook, res } = await settle(p, 'SUCCEEDED');
    expect(res.body).toEqual({ received: true, result: 'APPLIED' });
    const again = await postWebhook(hook).expect(200);
    expect(again.body.result).toBe('DUPLICATE');
    const parallel = await Promise.all([postWebhook(hook), postWebhook(hook)]);
    expect(parallel.map((r) => r.status)).toEqual([200, 200]);
    expect(parallel.map((r) => r.body.result)).toEqual(['DUPLICATE', 'DUPLICATE']);

    expect(await bookingRow(id)).toMatchObject({ status: 'CONFIRMED', payment_status: 'PAID' });
    expect(await paymentRow(p.paymentId)).toMatchObject({ status: 'SUCCEEDED' });
    expect(await count(`SELECT count(*)::int AS n FROM commissions WHERE booking_id = $1`, [id])).toBe(1);
    expect(await count(`SELECT count(DISTINCT journal_id)::int AS n FROM ledger_entries WHERE booking_id = $1`, [id])).toBe(1);
    expect(await count(`SELECT count(*)::int AS n FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'payment.succeeded'`, [id])).toBe(1);
    expect(await balances(id)).toEqual({ PROVIDER_CLEARING: 5300, DRIVER_PAYABLE: -4500, PLATFORM_REVENUE_COMMISSION: -500, PLATFORM_REVENUE_FEES: -300 });
  });

  it('T2 : deux webhooks différents mais simultanés pour le même succès : une seule confirmation', async () => {
    const trip = await createTrip(db);
    const id = await book(alice, trip);
    const p = await pay(alice, id);
    await sbx.settle(p.ref, 'SUCCEEDED');
    const hooks = [1, 2].map(() => sbx.buildWebhook({ providerReference: p.ref, merchantReference: p.paymentId, status: 'SUCCEEDED', amountXof: p.amountXof }));
    const res = await Promise.all(hooks.map((h) => postWebhook(h)));
    expect(res.map((r) => r.body.result).sort()).toEqual(['APPLIED', 'DUPLICATE']);
    expect(await count(`SELECT count(*)::int AS n FROM commissions WHERE booking_id = $1`, [id])).toBe(1);
    expect(await count(`SELECT count(DISTINCT journal_id)::int AS n FROM ledger_entries WHERE booking_id = $1`, [id])).toBe(1);
  });

  it('T2b : webhooks dans le désordre : un ancien « en attente » après le succès est ignoré', async () => {
    const trip = await createTrip(db);
    const id = await book(alice, trip);
    const p = await pay(alice, id);
    await settle(p, 'SUCCEEDED');
    const stale = sbx.buildWebhook({ providerReference: p.ref, merchantReference: p.paymentId, status: 'PENDING', amountXof: p.amountXof }, { occurredAt: new Date(Date.now() - 5 * MINUTE) });
    expect((await postWebhook(stale).expect(200)).body.result).toBe('IGNORED_STALE');
    // Un échec arrivé après un succès vérifié n'annule rien : alerte pour revue humaine.
    const failed = sbx.buildWebhook({ providerReference: p.ref, merchantReference: p.paymentId, status: 'FAILED', amountXof: p.amountXof });
    expect((await postWebhook(failed).expect(200)).body.result).toBe('IGNORED_STALE');
    expect(await paymentRow(p.paymentId)).toMatchObject({ status: 'SUCCEEDED' });
    expect(await bookingRow(id)).toMatchObject({ status: 'CONFIRMED' });
    expect(await count(`SELECT count(*)::int AS n FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'payment.alert'`, [p.paymentId])).toBe(1);
  });

  it('T2c : signature absente, fausse ou trop ancienne : 401 et rien d’enregistré ; montant différent : MISMATCH', async () => {
    const trip = await createTrip(db);
    const id = await book(alice, trip);
    const p = await pay(alice, id);
    const events = () => count(`SELECT count(*)::int AS n FROM payment_events WHERE payment_id = $1`, [p.paymentId]);
    const good = sbx.buildWebhook({ providerReference: p.ref, merchantReference: p.paymentId, status: 'SUCCEEDED', amountXof: p.amountXof });

    const missing = await postWebhook({ rawBody: good.rawBody, headers: { 'content-type': 'application/json' } }).expect(401);
    expect(missing.body.error.code).toBe('INVALID_SIGNATURE');
    const tampered = Buffer.from(good.rawBody.toString().replace('"amount":5300', '"amount":5301'));
    await postWebhook({ rawBody: tampered, headers: good.headers }).expect(401);
    const forged = { ...good.headers, [SANDBOX_SIGNATURE_HEADER]: good.headers[SANDBOX_SIGNATURE_HEADER]!.replace(/v1=[0-9a-f]{4}/, 'v1=0000') };
    await postWebhook({ rawBody: good.rawBody, headers: forged }).expect(401);
    const old = sbx.buildWebhook({ providerReference: p.ref, merchantReference: p.paymentId, status: 'SUCCEEDED', amountXof: p.amountXof }, { signedAt: new Date(Date.now() - 10 * MINUTE) });
    await postWebhook(old).expect(401);
    await postWebhook(good, 'inconnu').expect(404);
    expect(await events()).toBe(0);
    expect(await bookingRow(id)).toMatchObject({ status: 'PENDING_PAYMENT' });
    expect(await count(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'payment.webhook_rejected' AND created_at >= $1`, [startedAt])).toBeGreaterThanOrEqual(4);

    // Signature valide mais montant différent : aucune confirmation, alerte finance.
    const wrong = sbx.buildWebhook({ providerReference: p.ref, merchantReference: p.paymentId, status: 'SUCCEEDED', amountXof: 100 });
    expect((await postWebhook(wrong).expect(200)).body.result).toBe('MISMATCH');
    expect(await bookingRow(id)).toMatchObject({ status: 'PENDING_PAYMENT', payment_status: 'PROCESSING' });
    expect(await paymentRow(p.paymentId)).toMatchObject({ status: 'PENDING' });
    expect(await count(`SELECT count(*)::int AS n FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'payment.mismatch'`, [p.paymentId])).toBe(1);
    // Référence inconnue : rejet.
    const unknown = sbx.buildWebhook({ providerReference: 'SBX-inconnu', merchantReference: uuidv7(), status: 'SUCCEEDED', amountXof: 5300 });
    expect((await postWebhook(unknown).expect(200)).body.result).toBe('REJECTED');
  });

  // ------------------------------------------------------------------ T3

  it('T3 : paiement refusé : réservation toujours en attente, nouvel essai possible ; à l’échéance, places libérées', async () => {
    const trip = await createTrip(db);
    const id = await book(alice, trip);
    const p = await pay(alice, id);
    await settle(p, 'FAILED', 'INSUFFICIENT_FUNDS');
    expect(await paymentRow(p.paymentId)).toMatchObject({ status: 'FAILED', failure_code: 'INSUFFICIENT_FUNDS' });
    expect(await bookingRow(id)).toMatchObject({ status: 'PENDING_PAYMENT', payment_status: 'UNPAID' });
    const status = await t.http().get(`/api/v1/payments/${p.paymentId}`).set(bearer(alice.accessToken)).expect(200);
    expect(status.body).toMatchObject({ status: 'FAILED', failureMessage: 'Solde insuffisant.' });
    const view = await t.http().get(`/api/v1/bookings/${id}`).set(bearer(alice.accessToken)).expect(200);
    expect(view.body.actions.canPay).toBe(true);
    expect(await count(`SELECT count(*)::int AS n FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'payment.failed'`, [p.paymentId])).toBe(1);

    // Pas de nouvel essai : à l'échéance du blocage (horloge avancée), la réservation expire.
    await maintenance.expireHolds(new Date(Date.now() + 16 * MINUTE));
    expect(await bookingRow(id)).toMatchObject({ status: 'EXPIRED' });
    expect(await occupancy(trip)).toBe(0);
    expect(await count(`SELECT count(*)::int AS n FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'booking.expired'`, [id])).toBe(1);
  });

  it('T3 : nouvel essai après un échec, puis succès', async () => {
    const trip = await createTrip(db);
    const id = await book(alice, trip);
    await settle(await pay(alice, id), 'CANCELLED');
    const second = await pay(alice, id);
    await settle(second, 'SUCCEEDED');
    expect(await bookingRow(id)).toMatchObject({ status: 'CONFIRMED', payment_status: 'PAID' });
    expect(await count(`SELECT count(*)::int AS n FROM payments WHERE booking_id = $1`, [id])).toBe(2);
  });

  it('paiement en cours à l’échéance : blocage prolongé une seule fois, puis expiration', async () => {
    const trip = await createTrip(db);
    const id = await book(alice, trip);
    const p = await pay(alice, id);
    const before = (await bookingRow(id)).hold_expires_at as Date;
    await maintenance.expireHolds(new Date(Date.now() + 16 * MINUTE));
    const extended = await bookingRow(id);
    expect(extended).toMatchObject({ status: 'PENDING_PAYMENT', hold_extended: true });
    expect((extended.hold_expires_at as Date).getTime() - before.getTime()).toBe(10 * MINUTE);
    expect(await occupancy(trip)).toBe(1);
    await maintenance.expireHolds(new Date(Date.now() + 27 * MINUTE));
    expect(await bookingRow(id)).toMatchObject({ status: 'EXPIRED' });
    // Le prestataire n'a jamais répondu : le paiement est clos comme expiré par la tâche de rattrapage.
    await payments.pollOne(p.paymentId, new Date(Date.now() + 30 * MINUTE));
    expect(await paymentRow(p.paymentId)).toMatchObject({ status: 'EXPIRED' });
  });

  it('T3b : paiement réussi après expiration, place reprise : remboursement automatique, pas de survente', async () => {
    const trip = await createTrip(db, { seats: 1 });
    const id = await book(alice, trip);
    const p = await pay(alice, id);
    await db.query(`UPDATE bookings SET hold_expires_at = now() - interval '1 second', hold_extended = true WHERE id = $1`, [id]);
    await maintenance.expireHolds();
    expect(await bookingRow(id)).toMatchObject({ status: 'EXPIRED' });
    const other = await book(bruno, trip);
    await settle(await pay(bruno, other), 'SUCCEEDED');
    expect(await occupancy(trip)).toBe(1);

    await settle(p, 'SUCCEEDED');
    expect(await paymentRow(p.paymentId)).toMatchObject({ status: 'SUCCEEDED' });
    expect(await bookingRow(id)).toMatchObject({ status: 'EXPIRED', payment_status: 'REFUNDED', refund_due_xof: 5300 });
    const { rows } = await db.query(`SELECT reason_code, status, amount_xof::int FROM refunds WHERE booking_id = $1`, [id]);
    expect(rows).toEqual([{ reason_code: 'LATE_PAYMENT', status: 'SUCCEEDED', amount_xof: 5300 }]);
    expect(await occupancy(trip)).toBe(1);
    expect(await count(`SELECT count(*)::int AS n FROM bookings WHERE trip_id = $1 AND status = 'CONFIRMED'`, [trip.tripId])).toBe(1);
    expect(await count(`SELECT count(*)::int AS n FROM commissions WHERE booking_id = $1`, [id])).toBe(0);
    // Encaissé puis rendu : tous les comptes de la réservation reviennent à zéro.
    const b = await balances(id);
    expect(b.PROVIDER_CLEARING).toBe(0);
    expect(b.PASSENGER_REFUNDS_PAYABLE).toBe(0);
    // Le remboursement simulé existe chez le « prestataire ».
    expect(await count(`SELECT count(*)::int AS n FROM sandbox_transactions WHERE kind = 'REFUND' AND amount_xof = 5300 AND merchant_reference IN (SELECT id FROM refunds WHERE booking_id = $1)`, [id])).toBe(1);
  });

  it('T3b : paiement tardif mais place encore libre (moins de 30 min) : réservation réactivée', async () => {
    const trip = await createTrip(db);
    const id = await book(alice, trip);
    const p = await pay(alice, id);
    await db.query(`UPDATE bookings SET hold_expires_at = now() - interval '1 second', hold_extended = true WHERE id = $1`, [id]);
    await maintenance.expireHolds();
    await settle(p, 'SUCCEEDED');
    expect(await bookingRow(id)).toMatchObject({ status: 'CONFIRMED', payment_status: 'PAID' });
    expect(await count(`SELECT count(*)::int AS n FROM refunds WHERE booking_id = $1`, [id])).toBe(0);
  });

  it('T3c : le retour du navigateur ne confirme rien ; seul le statut obtenu par le serveur fait foi', async () => {
    const trip = await createTrip(db);
    const id = await book(alice, trip);
    const p = await pay(alice, id);
    // Le client revient sur returnUrl en affichant « succès », sans aucun événement du prestataire.
    const s1 = await t.http().get(`/api/v1/payments/${p.paymentId}`).set(bearer(alice.accessToken)).expect(200);
    expect(s1.body).toMatchObject({ status: 'PENDING', booking: { status: 'PENDING_PAYMENT' } });
    expect(await bookingRow(id)).toMatchObject({ status: 'PENDING_PAYMENT' });

    // Le prestataire a validé mais le webhook s'est perdu : le serveur l'interroge lui-même (après 30 s).
    await sbx.settle(p.ref, 'SUCCEEDED');
    expect((await t.http().get(`/api/v1/payments/${p.paymentId}`).set(bearer(alice.accessToken)).expect(200)).body.status).toBe('PENDING');
    await db.query(`UPDATE payments SET created_at = now() - interval '1 minute' WHERE id = $1`, [p.paymentId]);
    const s2 = await t.http().get(`/api/v1/payments/${p.paymentId}`).set(bearer(alice.accessToken)).expect(200);
    expect(s2.body).toMatchObject({ status: 'SUCCEEDED', booking: { status: 'CONFIRMED', paymentStatus: 'PAID' } });
    const { rows } = await db.query(`SELECT source, processing_result FROM payment_events WHERE payment_id = $1`, [p.paymentId]);
    expect(rows).toEqual([{ source: 'POLL', processing_result: 'APPLIED' }]);
  });

  it('tâche de rattrapage : un paiement validé sans webhook est confirmé par interrogation', async () => {
    const trip = await createTrip(db);
    const id = await book(alice, trip);
    const p = await pay(alice, id);
    await sbx.settle(p.ref, 'SUCCEEDED');
    const r = await jobs.everyMinute(new Date(Date.now() + 2 * MINUTE));
    expect(r.polled).toBeGreaterThanOrEqual(1);
    expect(await bookingRow(id)).toMatchObject({ status: 'CONFIRMED', payment_status: 'PAID' });
  });

  // ------------------------------------------------------------------ T4 et remboursements

  it('T4 complet : le conducteur annule un trajet avec 2 réservations payées et 1 en attente', async () => {
    const trip = await createTrip(db, { acceptanceMode: 'MANUAL' });
    const driver = await driverSession(trip);
    const carol = await loginActive(t);
    const ids: string[] = [];
    for (const who of [alice, bruno]) {
      const id = await book(who, trip);
      await t.http().post(`/api/v1/bookings/${id}/accept`).set(bearer(driver.accessToken)).expect(200);
      await settle(await pay(who, id), 'SUCCEEDED');
      expect(await bookingRow(id)).toMatchObject({ status: 'CONFIRMED', payment_status: 'PAID' });
      ids.push(id);
    }
    const pending = await book(carol, trip);
    await t.http().post(`/api/v1/trips/${trip.tripId}/cancel`).set(bearer(driver.accessToken)).set('Idempotency-Key', randomUUID())
      .send({ reason: 'Imprévu familial' }).expect(200);

    const trips = await db.query(`SELECT status FROM trips WHERE id = $1`, [trip.tripId]);
    expect(trips.rows[0].status).toBe('CANCELLED');
    for (const id of ids) {
      expect(await bookingRow(id)).toMatchObject({ status: 'CANCELLED_BY_DRIVER', payment_status: 'REFUNDED', refund_due_xof: 5300 });
      const { rows } = await db.query(`SELECT reason_code, status, amount_xof::int FROM refunds WHERE booking_id = $1`, [id]);
      // Remboursement intégral, frais de service compris.
      expect(rows).toEqual([{ reason_code: 'DRIVER_CANCELLED', status: 'SUCCEEDED', amount_xof: 5300 }]);
      const c = await db.query(`SELECT status, adjusted_xof::int FROM commissions WHERE booking_id = $1`, [id]);
      expect(c.rows[0]).toEqual({ status: 'VOID', adjusted_xof: -4500 });
      for (const total of Object.values(await balances(id))) expect(total).toBe(0);
    }
    expect(await bookingRow(pending)).toMatchObject({ status: 'CANCELLED_BY_DRIVER', payment_status: 'UNPAID', refund_due_xof: 0 });
    expect(await count(`SELECT count(*)::int AS n FROM refunds WHERE booking_id = $1`, [pending])).toBe(0);
    // Grand livre : chaque journal du trajet est équilibré.
    const unbalanced = await count(
      `SELECT count(*)::int AS n FROM (SELECT journal_id FROM ledger_entries WHERE booking_id = ANY($1) GROUP BY journal_id HAVING sum(amount_xof) <> 0) j`,
      [ids],
    );
    expect(unbalanced).toBe(0);
    expect(await count(`SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'booking.cancelled' AND aggregate_id = ANY($1)`, [[...ids, pending]])).toBe(3);
    expect(await count(`SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'refund.succeeded' AND payload->>'bookingId' = ANY($1)`, [ids])).toBe(2);
    const counter = await db.query(`SELECT cancellation_count_90d AS n FROM driver_profiles WHERE user_id = $1`, [driver.userId]);
    expect(counter.rows[0].n).toBe(1);
  });

  it('annulation par le passager à 50 % : remboursement partiel, conducteur et commission au prorata', async () => {
    const trip = await createTrip(db, { departure: new Date(Date.now() + 12 * HOUR) });
    const id = await paidBooking(alice, trip);
    // Hors des 15 min suivant la confirmation : frais de service non rendus.
    await db.query(`UPDATE bookings SET confirmed_at = now() - interval '1 hour' WHERE id = $1`, [id]);
    const res = await t.http().post(`/api/v1/bookings/${id}/cancel`).set(bearer(alice.accessToken)).set('Idempotency-Key', randomUUID())
      .send({ reason: 'Changement de programme' }).expect(200);
    expect(res.body.refund).toMatchObject({ refundXof: 2500, serviceFeeRefundXof: 0, driverCompensationXof: 2250, refundPercent: 50 });
    expect(res.body.booking.paymentStatus).toBe('PARTIALLY_REFUNDED');
    const { rows } = await db.query(`SELECT reason_code, status, amount_xof::int FROM refunds WHERE booking_id = $1`, [id]);
    expect(rows).toEqual([{ reason_code: 'PASSENGER_CANCELLED', status: 'SUCCEEDED', amount_xof: 2500 }]);
    const c = await db.query(`SELECT status, adjusted_xof::int FROM commissions WHERE booking_id = $1`, [id]);
    expect(c.rows[0]).toEqual({ status: 'PENDING', adjusted_xof: -2250 });
    expect(await balances(id)).toEqual({ PROVIDER_CLEARING: 2800, DRIVER_PAYABLE: -2250, PLATFORM_REVENUE_COMMISSION: -250, PLATFORM_REVENUE_FEES: -300 });
    // Rejouer le traitement ne rembourse pas deux fois.
    expect(await refunds.processBooking(id)).toBe('SKIPPED');
    expect(await count(`SELECT count(*)::int AS n FROM refunds WHERE booking_id = $1`, [id])).toBe(1);
  });

  it('remboursement refusé par le prestataire : nouvel essai par la tâche de rattrapage après un délai', async () => {
    const trip = await createTrip(db);
    const id = await paidBooking(alice, trip);
    // Le « prestataire » ne retrouve plus le paiement d'origine : il refuse le remboursement.
    const ref = (await db.query(`SELECT provider_reference FROM payments WHERE booking_id = $1 AND status = 'SUCCEEDED'`, [id])).rows[0].provider_reference;
    await db.query(`UPDATE sandbox_transactions SET status = 'FAILED' WHERE provider_reference = $1`, [ref]);
    await t.http().post(`/api/v1/bookings/${id}/cancel`).set(bearer(alice.accessToken)).set('Idempotency-Key', randomUUID())
      .send({ reason: 'Je ne pars plus' }).expect(200);
    expect(await bookingRow(id)).toMatchObject({ payment_status: 'REFUND_PENDING', refund_due_xof: 5300 });
    expect((await db.query(`SELECT status FROM refunds WHERE booking_id = $1`, [id])).rows).toEqual([{ status: 'FAILED' }]);
    expect(await refunds.processBooking(id)).toBe('SKIPPED'); // trop tôt pour réessayer
    await db.query(`UPDATE sandbox_transactions SET status = 'SUCCEEDED' WHERE provider_reference = $1`, [ref]);
    expect(await refunds.processBooking(id, new Date(Date.now() + 11 * MINUTE))).toBe('SUCCEEDED');
    expect(await bookingRow(id)).toMatchObject({ payment_status: 'REFUNDED' });
  });

  // ------------------------------------------------------------------ gains, historique, rapprochement

  it('gains du conducteur et historique du passager ; gains disponibles 48 h après la fin, sauf réclamation', async () => {
    const trip = await createTrip(db);
    const driver = await driverSession(trip);
    const id = await paidBooking(alice, trip);
    const other = await paidBooking(bruno, trip);
    const e = await t.http().get('/api/v1/me/earnings').set(bearer(driver.accessToken)).expect(200);
    expect(e.body.payoutsAvailable).toBe(false);
    expect(e.body.totals).toMatchObject({ grossXof: 10000, commissionXof: 1000, pendingXof: 9000, payableXof: 0 });
    expect(e.body.trips[0]).toMatchObject({ tripId: trip.tripId, dueXof: 9000 });
    // Le passager ne voit pas les gains d'un autre.
    expect((await t.http().get('/api/v1/me/earnings').set(bearer(alice.accessToken)).expect(200)).body.trips).toEqual([]);
    const h = await t.http().get('/api/v1/me/transactions').set(bearer(alice.accessToken)).expect(200);
    expect(h.body.data.find((x: { bookingId: string }) => x.bookingId === id)).toMatchObject({ kind: 'PAYMENT', status: 'SUCCEEDED', amountXof: 5300, method: 'WAVE' });

    // Trajet terminé il y a 49 h ; une réclamation est ouverte sur la seconde réservation.
    await db.query(`UPDATE trips SET status = 'IN_PROGRESS', started_at = now() - interval '52 hours' WHERE id = $1`, [trip.tripId]);
    await db.query(`UPDATE trips SET status = 'COMPLETED', completed_at = now() - interval '49 hours' WHERE id = $1`, [trip.tripId]);
    await db.query(`UPDATE bookings SET status = 'COMPLETED', completed_at = now() WHERE trip_id = $1 AND status = 'CONFIRMED'`, [trip.tripId]);
    await db.query(
      `INSERT INTO disputes (id, reference, booking_id, opened_by, reason_code, description) VALUES ($1, $2, $3, $4, 'LATE', 'Retard important')`,
      [uuidv7(), `LT-${Date.now() % 1e8}`, other, bruno.userId],
    );
    expect(await refunds.releasePayable(48)).toBeGreaterThanOrEqual(1);
    const c = await db.query(`SELECT booking_id, status FROM commissions WHERE booking_id = ANY($1)`, [[id, other]]);
    expect(Object.fromEntries(c.rows.map((r) => [r.booking_id, r.status]))).toEqual({ [id]: 'PAYABLE', [other]: 'PENDING' });
  });

  it('rapprochement : écarts de montant et opération inconnue signalés, période déjà rapprochée ignorée', async () => {
    const trip = await createTrip(db);
    const id = await paidBooking(alice, trip);
    const ref = (await db.query(`SELECT provider_reference FROM payments WHERE booking_id = $1`, [id])).rows[0].provider_reference;
    await db.query(`UPDATE sandbox_transactions SET amount_xof = 5000 WHERE provider_reference = $1`, [ref]);
    const ghost = uuidv7();
    await db.query(`INSERT INTO sandbox_transactions (provider_reference, kind, merchant_reference, amount_xof, method, status) VALUES ($1, 'PAYMENT', $2, 1000, 'WAVE', 'SUCCEEDED')`, [`SBX-G${Date.now()}`, ghost]);
    const run = await reconciliation.run(startedAt, new Date(Date.now() + MINUTE));
    expect(run.status).toBe('DISCREPANCIES');
    const { rows } = await db.query(`SELECT issue, provider_reference, details FROM reconciliation_items WHERE run_id = $1`, [run.runId]);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ issue: 'AMOUNT_MISMATCH', provider_reference: ref }),
      expect.objectContaining({ issue: 'MISSING_INTERNAL', details: expect.objectContaining({ merchantReference: ghost }) }),
    ]));
    // Rapprochement quotidien : la veille, une seule fois.
    const first = await reconciliation.runDaily();
    expect(first).not.toBeNull();
    expect(await reconciliation.runDaily()).toBeNull();
  });

  it('page de paiement simulée : bandeau « aucun argent réel », validation, retour vers l’application', async () => {
    const trip = await createTrip(db);
    const id = await book(alice, trip);
    const p = await pay(alice, id);
    const page = await t.http().get(`/api/v1/sandbox/pay/${p.ref}`).expect(200);
    expect(page.text).toContain('aucun argent réel');
    expect(page.text).toContain('Valider le paiement');
    expect(page.text).not.toContain(PHONE);
    const r = await t.http().post(`/api/v1/sandbox/pay/${p.ref}/doublon`).expect(303);
    expect(r.headers.location).toBe(`../${p.ref}?m=doublon`);
    expect(await bookingRow(id)).toMatchObject({ status: 'CONFIRMED' });
    const results = await db.query(`SELECT processing_result FROM payment_events WHERE payment_id = $1 ORDER BY received_at`, [p.paymentId]);
    expect(results.rows.map((x) => x.processing_result)).toEqual(['APPLIED']); // le doublon (même identifiant) n'est pas réenregistré
    const after = await t.http().get(`/api/v1/sandbox/pay/${p.ref}`).expect(200);
    expect(after.text).not.toContain('Valider le paiement');
    expect(after.text).toContain(`/reservations/${id}/payer?paiement=${p.paymentId}`);
    await t.http().get('/api/v1/sandbox/pay/SBX-inconnu').expect(404);
  });
});
