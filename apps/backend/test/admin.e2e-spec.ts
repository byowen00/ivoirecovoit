import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { uuidv7 } from '../src/common/ids';
import { AdminController } from '../src/modules/admin/admin.controller';
import { AdminConfigController } from '../src/modules/admin/admin-config.controller';
import { AdminOpsController } from '../src/modules/admin/admin-ops.controller';
import { createTrip, ensureFeeRule, type TripFixture } from './fixtures';
import { flows } from './flow-helpers';
import { staffToken } from './staff-helpers';
import { bearer, createTestApp, type LoggedIn, loginActive, type TestApp } from './test-app';
import { connectTestDb } from './test-db';

const DAY = 86_400_000;

/** Toutes les routes déclarées sous /admin, lues sur les contrôleurs eux-mêmes (aucune liste à tenir à jour). */
function adminRoutes(): { method: string; path: string }[] {
  const out: { method: string; path: string }[] = [];
  for (const ctrl of [AdminController, AdminOpsController, AdminConfigController]) {
    const base = Reflect.getMetadata(PATH_METADATA, ctrl) as string;
    for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
      const handler = (ctrl.prototype as unknown as Record<string, unknown>)[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (path === undefined || method === undefined) continue;
      out.push({ method: RequestMethod[method].toLowerCase(), path: `/api/v1/${base}/${path}`.replace(/:[a-zA-Z]+/g, (p) => (p === ':type' ? 'driver' : p === ':key' ? 'booking.hold_minutes' : uuidv7())) });
    }
  }
  return out;
}

describe('Administration (étape 9, T6) : permissions, remboursements, finance, réclamations, configuration', () => {
  let t: TestApp;
  let db: Client;
  let f: ReturnType<typeof flows>;
  let alice: LoggedIn;
  let support: string;
  let admin: string;
  let admin2: string;
  let finance: string;
  let superAdmin: string;
  let supportId: string;
  let adminId: string;

  beforeAll(async () => {
    t = await createTestApp();
    db = await connectTestDb();
    f = flows(t, db);
    await ensureFeeRule(db);
    alice = await loginActive(t);
    const s = await staffToken(t, db, 'SUPPORT');
    support = s.token;
    supportId = s.staff.id;
    const a = await staffToken(t, db, 'ADMIN');
    admin = a.token;
    adminId = a.staff.id;
    admin2 = (await staffToken(t, db, 'ADMIN')).token;
    finance = (await staffToken(t, db, 'FINANCE')).token;
    superAdmin = (await staffToken(t, db, 'SUPER_ADMIN')).token;
  });
  beforeEach(async () => {
    await t.redis.flushdb();
    await db.query(`UPDATE bookings SET status = 'EXPIRED' WHERE passenger_id = $1 AND status IN ('PENDING_ACCEPTANCE','PENDING_PAYMENT')`, [alice.userId]);
  });
  afterAll(async () => {
    await db.end();
    await t.app.close();
  });

  const as = (token: string) => ({
    get: (p: string) => t.http().get(`/api/v1/admin${p}`).set(bearer(token)),
    post: (p: string, body: object = {}) => t.http().post(`/api/v1/admin${p}`).set(bearer(token)).send(body),
    put: (p: string, body: object) => t.http().put(`/api/v1/admin${p}`).set(bearer(token)).send(body),
    patch: (p: string, body: object) => t.http().patch(`/api/v1/admin${p}`).set(bearer(token)).send(body),
    refund: (body: object) => t.http().post('/api/v1/admin/refunds').set(bearer(token)).set('Idempotency-Key', randomUUID()).send(body),
  });
  const denials = async (actorId: string) =>
    (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'access.denied' AND actor_id = $1`, [actorId])).rows[0]!.n;
  const bookingState = async (id: string) =>
    (await db.query(`SELECT status, payment_status FROM bookings WHERE id = $1`, [id])).rows[0] as { status: string; payment_status: string };

  // ------------------------------------------------------------------ T6

  describe('T6 : contrôle d’accès', () => {
    it('toute route /admin/* avec un jeton utilisateur → 403, et chaque refus est journalisé', async () => {
      const routes = adminRoutes();
      expect(routes.length).toBeGreaterThan(70);
      const before = await denials(alice.userId);
      for (const r of routes) {
        const res = await (t.http() as unknown as Record<string, (p: string) => ReturnType<ReturnType<TestApp['http']>['get']>>)[r.method]!(r.path)
          .set(bearer(alice.accessToken))
          .send({});
        if (res.status !== 403) throw new Error(`${r.method.toUpperCase()} ${r.path} → ${res.status}`);
      }
      expect(await denials(alice.userId)).toBe(before + routes.length);
      const { rows } = await db.query(`SELECT reason, changes FROM audit_logs WHERE action = 'access.denied' AND actor_id = $1 ORDER BY id DESC LIMIT 1`, [alice.userId]);
      expect(rows[0].reason).toBe('WRONG_ACCOUNT_KIND');
    });

    it('SUPPORT : paramètres (écriture), règles de frais, personnel, validation de remboursement et pièces → 403 journalisés', async () => {
      const before = await denials(supportId);
      const s = as(support);
      await s.put('/settings/booking.hold_minutes', { value: 20, reason: 'Essai de modification' }).expect(403);
      await s.get('/fee-rules').expect(403);
      await s.post('/fee-rules', {}).expect(403);
      await s.get('/staff').expect(403);
      await s.post('/staff', {}).expect(403);
      await s.post(`/refunds/${uuidv7()}/approve`).expect(403);
      await s.post(`/documents/${uuidv7()}/download-url`, { reason: 'Vérification du dossier' }).expect(403);
      await s.post(`/users/${alice.userId}/reveal`, { reason: 'Vérification du dossier', fields: ['phone'] }).expect(403);
      expect(await denials(supportId)).toBe(before + 8);
      const { rows } = await db.query(`SELECT reason, changes FROM audit_logs WHERE action = 'access.denied' AND actor_id = $1 ORDER BY id DESC LIMIT 1`, [supportId]);
      expect(rows[0]).toMatchObject({ reason: 'MISSING_PERMISSION', changes: expect.objectContaining({ required: ['users.read_sensitive'] }) });
    });

    it('ADMIN : versements → 403 ; FINANCE : modération des trajets → 403', async () => {
      await as(admin).post('/payouts/generate', { until: new Date().toISOString() }).expect(403);
      await as(finance).post(`/trips/${uuidv7()}/cancel`, { reason: 'Essai d’annulation' }).expect(403);
      await as(finance).get('/disputes').expect(403);
    });
  });

  // ------------------------------------------------------------------ remboursements

  describe('remboursements', () => {
    it('SUPPORT sous le plafond : exécuté ; au-delà : en attente, validé par une autre personne', async () => {
      const trip = await createTrip(db);
      const small = await f.paidBooking(alice, trip);
      const r1 = await as(support).refund({ bookingId: small, amountXof: 2000, note: 'Retard important signalé' }).expect(201);
      expect(r1.body.status).toBe('APPROVED');
      expect((await bookingState(small)).payment_status).toMatch(/PARTIALLY_REFUNDED|REFUND_PENDING/);

      const big = await f.paidBooking(alice, await createTrip(db));
      const r2 = await as(support).refund({ bookingId: big, amountXof: 5300, note: 'Trajet non effectué' }).expect(201);
      expect(r2.body.status).toBe('REQUESTED');
      const pending = await as(admin).get('/refunds?status=REQUESTED').expect(200);
      expect(pending.body.data.map((r: { id: string }) => r.id)).toContain(r2.body.refundId);
      expect(pending.body.limits).toEqual({ supportCapXof: 5000, doubleValidationAboveXof: 10000 });
      await as(admin).post(`/refunds/${r2.body.refundId}/approve`).expect(200);
      expect((await bookingState(big)).payment_status).toMatch(/REFUNDED|REFUND_PENDING/);
      const again = await as(admin).post(`/refunds/${r2.body.refundId}/approve`).expect(409);
      expect(again.body.error.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('double validation : le demandeur ne valide pas lui-même ; un refus rétablit la réservation payée', async () => {
      await as(superAdmin).put('/settings/refunds.double_validation_above_xof', { value: 4000, reason: 'Test de double validation' }).expect(200);
      try {
        const trip = await createTrip(db);
        const id = await f.paidBooking(alice, trip);
        const r = await as(admin).refund({ bookingId: id, amountXof: 5000, note: 'Geste commercial important' }).expect(201);
        expect(r.body.status).toBe('REQUESTED');
        const same = await as(admin).post(`/refunds/${r.body.refundId}/approve`).expect(403);
        expect(same.body.error.code).toBe('SAME_PERSON');
        const busy = await as(admin2).refund({ bookingId: id, amountXof: 1000, note: 'Second remboursement' }).expect(409);
        expect(busy.body.error.code).toBe('REFUND_NOT_ALLOWED');
        await as(admin2).post(`/refunds/${r.body.refundId}/reject`, { reason: 'Montant non justifié' }).expect(200);
        expect(await bookingState(id)).toMatchObject({ payment_status: 'PAID' });
        const above = await as(admin2).refund({ bookingId: id, amountXof: 6000, note: 'Montant trop élevé' }).expect(409);
        expect(above.body.error.code).toBe('REFUND_ABOVE_PAID');
      } finally {
        await as(superAdmin).put('/settings/refunds.double_validation_above_xof', { value: 10000, reason: 'Retour à la valeur de démonstration' }).expect(200);
      }
    });

    it('idempotent : même clé, même remboursement', async () => {
      const trip = await createTrip(db);
      const id = await f.paidBooking(alice, trip);
      const key = randomUUID();
      const body = { bookingId: id, amountXof: 1000, note: 'Geste commercial' };
      const a = await t.http().post('/api/v1/admin/refunds').set(bearer(admin)).set('Idempotency-Key', key).send(body).expect(201);
      const b = await t.http().post('/api/v1/admin/refunds').set(bearer(admin)).set('Idempotency-Key', key).send(body).expect(201);
      expect(b.body.refundId).toBe(a.body.refundId);
      await t.http().post('/api/v1/admin/refunds').set(bearer(admin)).send(body).expect(400);
    });
  });

  // ------------------------------------------------------------------ exploitation

  describe('exploitation', () => {
    it('annulation administrative d’un trajet : passagers remboursés intégralement', async () => {
      const trip = await createTrip(db);
      const id = await f.paidBooking(alice, trip);
      const detail = await as(support).get(`/trips/${trip.tripId}`).expect(200);
      expect(detail.body.bookings.map((b: { id: string }) => b.id)).toContain(id);
      await as(support).post(`/trips/${trip.tripId}/cancel`, { reason: 'Véhicule non conforme' }).expect(403);
      await as(admin).post(`/trips/${trip.tripId}/cancel`, { reason: 'Véhicule non conforme' }).expect(200);
      expect(await bookingState(id)).toMatchObject({ status: 'CANCELLED_BY_ADMIN' });
      const { rows } = await db.query(`SELECT amount_xof, reason_code FROM refunds WHERE booking_id = $1`, [id]);
      expect(rows).toEqual([{ amount_xof: 5300, reason_code: 'ADMIN' }]);
    });

    it('fiche réservation, paiements sans données brutes, notes internes', async () => {
      const trip = await createTrip(db);
      const id = await f.paidBooking(alice, trip);
      const b = await as(support).get(`/bookings/${id}`).expect(200);
      expect(b.body.actions).toMatchObject({ canRefund: true, maxRefundXof: 5300 });
      const pay = await as(support).get(`/payments?bookingId=${id}`).expect(200);
      expect(pay.body.data).toHaveLength(1);
      const detail = await as(support).get(`/payments/${pay.body.data[0].id}`).expect(200);
      expect(JSON.stringify(detail.body)).not.toContain('raw_payload');
      expect(JSON.stringify(detail.body)).not.toContain('0707070707');
      await as(support).post('/notes', { targetType: 'BOOKING', targetId: id, body: 'Passagère rappelée, attend le remboursement.' }).expect(201);
      const notes = await as(admin).get(`/notes?targetType=BOOKING&targetId=${id}`).expect(200);
      expect(notes.body.data[0]).toMatchObject({ body: 'Passagère rappelée, attend le remboursement.' });
    });

    it('bannissement : sessions révoquées, trajets à venir annulés et remboursés', async () => {
      const trip = await createTrip(db);
      const driver = await f.driverSession(trip);
      const id = await f.paidBooking(alice, trip);
      await as(support).post(`/users/${driver.userId}/ban`, { reason: 'Fraude avérée' }).expect(403);
      await as(admin).post(`/users/${driver.userId}/ban`, { reason: 'Fraude avérée' }).expect(200);
      await t.http().get('/api/v1/me').set(bearer(driver.accessToken)).expect(401);
      expect(await bookingState(id)).toMatchObject({ status: 'CANCELLED_BY_ADMIN' });
    });
  });

  // ------------------------------------------------------------------ réclamations et modération

  describe('réclamations et signalements', () => {
    async function openDispute(trip: TripFixture) {
      const id = await f.paidBooking(alice, trip);
      await f.completeTrip(trip);
      const d = await t.http().post('/api/v1/disputes').set(bearer(alice.accessToken)).set('Idempotency-Key', randomUUID())
        .send({ bookingId: id, reasonCode: 'LATE', description: 'Deux heures de retard au départ.' }).expect(201);
      return { bookingId: id, disputeId: d.body.id as string };
    }

    it('détail journalisé, message interne invisible des parties, décision avec remboursement partiel', async () => {
      const trip = await createTrip(db);
      const { bookingId, disputeId } = await openDispute(trip);
      const list = await as(support).get('/disputes?open=true').expect(200);
      expect(list.body.data.map((d: { id: string }) => d.id)).toContain(disputeId);
      const detail = await as(support).get(`/disputes/${disputeId}`).expect(200);
      expect(detail.body).toMatchObject({ canDecide: true, booking: { id: bookingId } });
      const { rows } = await db.query(`SELECT 1 FROM audit_logs WHERE action = 'dispute.viewed' AND target_id = $1 AND actor_id = $2`, [disputeId, supportId]);
      expect(rows).toHaveLength(1);

      await as(support).patch(`/disputes/${disputeId}`, { assignToMe: true }).expect(200);
      await as(support).post(`/disputes/${disputeId}/messages`, { body: 'Vérifier les horaires GPS ? Non disponibles.', internal: true }).expect(201);
      await as(support).post(`/disputes/${disputeId}/messages`, { body: 'Nous examinons votre demande.', internal: false }).expect(201);
      const seen = await t.http().get(`/api/v1/disputes/${disputeId}`).set(bearer(alice.accessToken)).expect(200);
      expect(seen.body.messages.map((m: { body: string }) => m.body)).toEqual(['Nous examinons votre demande.']);

      const decided = await as(support).post(`/disputes/${disputeId}/decide`, { decision: 'PARTIAL_REFUND', refundXof: 1500, note: 'Retard confirmé par les deux parties.' })
        .expect(200);
      expect(decided.body).toMatchObject({ status: 'RESOLVED', decision: 'PARTIAL_REFUND', decidedRefundXof: 1500, refund: { status: 'APPROVED' } });
      const refund = await db.query(`SELECT amount_xof, reason_code FROM refunds WHERE booking_id = $1`, [bookingId]);
      expect(refund.rows).toEqual([{ amount_xof: 1500, reason_code: 'DISPUTE' }]);
      const closed = await as(support).post(`/disputes/${disputeId}/decide`, { decision: 'NO_REFUND', note: 'Seconde décision.' }).expect(409);
      expect(closed.body.error.code).toBe('DISPUTE_CLOSED');
    });

    it('rejet sans remboursement ; montant obligatoire pour un remboursement partiel', async () => {
      const trip = await createTrip(db);
      const { disputeId } = await openDispute(trip);
      await as(admin).post(`/disputes/${disputeId}/decide`, { decision: 'PARTIAL_REFUND', note: 'Montant oublié.' }).expect(400);
      const r = await as(admin).post(`/disputes/${disputeId}/decide`, { decision: 'REJECT', note: 'Aucun élément ne confirme le retard.' }).expect(200);
      expect(r.body).toMatchObject({ status: 'REJECTED', refund: null });
    });

    it('signalement pris en charge, avis masqué puis rétabli', async () => {
      const trip = await createTrip(db);
      const driver = await f.driverSession(trip);
      const id = await f.paidBooking(alice, trip);
      await f.completeTrip(trip);
      await t.http().post(`/api/v1/bookings/${id}/reviews`).set(bearer(alice.accessToken)).send({ rating: 1, comment: 'Insultant.' }).expect(201);
      await t.http().post(`/api/v1/bookings/${id}/reviews`).set(bearer(driver.accessToken)).send({ rating: 5 }).expect(201);
      const { rows } = await db.query<{ id: string }>(`SELECT id FROM reviews WHERE booking_id = $1 AND author_id = $2`, [id, alice.userId]);
      const reviewId = rows[0]!.id;
      const rep = await t.http().post('/api/v1/reports').set(bearer(driver.accessToken)).set('Idempotency-Key', randomUUID())
        .send({ targetType: 'REVIEW', targetId: reviewId, bookingId: id, category: 'INAPPROPRIATE', description: 'Avis injurieux et faux.' }).expect(201);

      const list = await as(support).get('/reports?open=true').expect(200);
      expect(list.body.data.map((r: { id: string }) => r.id)).toContain(rep.body.id);
      await as(support).patch(`/reports/${rep.body.id}`, { assignToMe: true, status: 'IN_REVIEW' }).expect(200);
      await as(support).post(`/reviews/${reviewId}/visibility`, { hidden: true, reason: 'Avis injurieux' }).expect(200);
      expect((await t.http().get(`/api/v1/users/${driver.userId}/reviews`).expect(200)).body.data).toHaveLength(0);
      await as(support).patch(`/reports/${rep.body.id}`, { status: 'ACTION_TAKEN', resolution: 'Avis masqué.' }).expect(200);
      await as(admin).post(`/reviews/${reviewId}/visibility`, { hidden: false, reason: 'Décision revue en appel' }).expect(200);
      expect((await t.http().get(`/api/v1/users/${driver.userId}/reviews`).expect(200)).body.data).toHaveLength(1);
    });
  });

  // ------------------------------------------------------------------ finance

  describe('finance', () => {
    it('versement : relevé préparé, marqué payé avec sa référence externe, grand livre', async () => {
      const trip = await createTrip(db);
      const driver = await f.driverSession(trip);
      const id = await f.paidBooking(alice, trip);
      await f.completeTrip(trip);
      await db.query(`UPDATE commissions SET status = 'PAYABLE', payable_at = now() - interval '1 hour' WHERE booking_id = $1`, [id]);

      const gen = await as(finance).post('/payouts/generate', { until: new Date().toISOString(), driverId: driver.userId }).expect(201);
      expect(gen.body.created).toBe(1);
      const payout = await as(finance).get(`/payouts/${gen.body.ids[0]}`).expect(200);
      expect(payout.body).toMatchObject({ status: 'DRAFT', amountXof: 4500 });
      const list = await as(admin).get('/payouts').expect(200);
      expect(list.body.automaticPayouts).toBe(false);

      await as(finance).post(`/payouts/${gen.body.ids[0]}/mark-paid`, {}).expect(400);
      const paid = await as(finance).post(`/payouts/${gen.body.ids[0]}/mark-paid`, { externalReference: 'VIR-2026-10-001', method: 'WAVE' }).expect(200);
      expect(paid.body).toMatchObject({ status: 'PAID', externalReference: 'VIR-2026-10-001' });
      const c = await db.query(`SELECT status FROM commissions WHERE booking_id = $1`, [id]);
      expect(c.rows[0].status).toBe('PAID');
      const bal = await db.query<{ total: number }>(`SELECT sum(amount_xof)::int AS total FROM ledger_entries WHERE booking_id = $1 AND account = 'DRIVER_PAYABLE'`, [id]);
      expect(bal.rows[0]!.total).toBe(0);
      await as(finance).post(`/payouts/${gen.body.ids[0]}/mark-paid`, { externalReference: 'VIR-BIS' }).expect(409);
    });

    it('commissions avec totaux ; rapprochement lancé à la demande', async () => {
      const c = await as(finance).get('/commissions?status=PAID').expect(200);
      expect(c.body.totals).toBeDefined();
      const from = new Date(Date.now() - DAY).toISOString();
      const run = await as(finance).post('/reconciliation/run', { from, to: new Date().toISOString() }).expect(201);
      expect(['OK', 'DISCREPANCIES']).toContain(run.body.status);
      const runs = await as(finance).get('/reconciliation/runs').expect(200);
      expect(runs.body.data.length).toBeGreaterThan(0);
    });

    it('export CSV : fichier signé, séparateur « ; », sans téléphone, injection de formule neutralisée', async () => {
      const trip = await createTrip(db);
      await f.paidBooking(alice, trip);
      await as(admin).post('/exports', { type: 'BOOKINGS', from: new Date(Date.now() - DAY).toISOString(), to: new Date(Date.now() + DAY).toISOString() }).expect(403);
      const tooLong = await as(finance).post('/exports', { type: 'BOOKINGS', from: '2025-01-01', to: '2026-06-01' }).expect(400);
      expect(tooLong.body.error.code).toBe('PERIOD_TOO_LONG');
      const res = await as(finance).post('/exports', { type: 'BOOKINGS', from: new Date(Date.now() - DAY).toISOString(), to: new Date(Date.now() + DAY).toISOString() })
        .expect(201);
      expect(res.body.rowCount).toBeGreaterThan(0);
      const file = await fetch(res.body.url);
      expect(file.status).toBe(200);
      const bytes = Buffer.from(await file.arrayBuffer());
      expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM : accents corrects à l'ouverture dans Excel
      const text = bytes.subarray(3).toString('utf8');
      expect(text.split('\r\n')[0]).toBe('date;reservation;trajet;type;statut;paiement;places;sous_total_xof;frais_xof;reduction_xof;total_xof;commission_xof;net_conducteur_xof;demo');
      expect(text).not.toContain(alice.phone);
      expect(text).not.toContain(alice.phone.slice(4));
    });
  });

  // ------------------------------------------------------------------ configuration

  describe('configuration', () => {
    it('paramètres : liste, validation, nouvelle version et historique', async () => {
      const list = await as(admin).get('/settings').expect(200);
      const hold = list.body.data.find((s: { key: string }) => s.key === 'booking.hold_minutes');
      expect(hold).toMatchObject({ group: 'Réservations', value: 15 });
      await as(support).get('/settings').expect(403);
      await as(admin).put('/settings/booking.hold_minutes', { value: 500, reason: 'Valeur hors bornes' }).expect(400);
      await as(admin).put('/settings/inconnu.cle', { value: 1, reason: 'Clé inconnue' }).expect(404);
      await as(admin).put('/settings/trip.price_min_xof', { value: 10_000_000, reason: 'Minimum au-dessus du maximum' }).expect(400);
      const v = await as(admin).put('/settings/booking.hold_minutes', { value: 20, reason: 'Essai de durée plus longue' }).expect(200);
      expect(v.body.versions[0]).toMatchObject({ value: 20, version: hold.version + 1 });
      const back = await as(admin).put('/settings/booking.hold_minutes', { value: 15, reason: 'Retour à la valeur par défaut' }).expect(200);
      expect(back.body.versions.slice(0, 3).map((x: { value: number }) => x.value)).toEqual([15, 20, 15]);
      const { rows } = await db.query(`SELECT reason FROM audit_logs WHERE action = 'setting.changed' AND actor_id = $1 ORDER BY id DESC LIMIT 1`, [adminId]);
      expect(rows[0].reason).toBe('Retour à la valeur par défaut');
    });

    it('règles de frais : nouvelle version datée, jamais rétroactive', async () => {
      const base = { tripKind: 'URBAN', commissionBps: 900, serviceFeeBps: 500, reason: 'Essai de grille urbaine' };
      await as(admin).post('/fee-rules', { ...base, effectiveFrom: new Date(Date.now() - DAY).toISOString() }).expect(400);
      const from = new Date(Date.now() + 365 * DAY + Math.floor(Math.random() * 1000) * DAY);
      await as(admin).post('/fee-rules', { ...base, effectiveFrom: from.toISOString() }).expect(201);
      const rules = await as(admin).get('/fee-rules').expect(200);
      expect(rules.body.data.some((r: { tripKind: string; commissionBps: number }) => r.tripKind === 'URBAN' && r.commissionBps === 900)).toBe(true);
    });

    it('promotions : pourcentage saisi en %, code unique, désactivation', async () => {
      const code = `ADM-${randomUUID().slice(0, 6).toUpperCase()}`;
      const body = { code, discountType: 'PERCENT', discountValue: 10, startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 7 * DAY).toISOString() };
      await as(support).post('/promotions', body).expect(403);
      const p = await as(admin).post('/promotions', body).expect(201);
      const { rows } = await db.query(`SELECT discount_value FROM promotions WHERE id = $1`, [p.body.id]);
      expect(rows[0].discount_value).toBe(1000);
      const dup = await as(admin).post('/promotions', body).expect(409);
      expect(dup.body.error.code).toBe('PROMO_CODE_TAKEN');
      await as(admin).patch(`/promotions/${p.body.id}`, { isActive: false }).expect(200);
      const trip = await createTrip(db);
      await t.http().post('/api/v1/bookings/quote').set(bearer(alice.accessToken))
        .send({ tripId: trip.tripId, pickupStopId: trip.stopIds[0], dropoffStopId: trip.stopIds[2], seats: 1, promoCode: code }).expect(422);
    });

    it('lieux : création dans les limites du pays, recherche, modification', async () => {
      const name = `Gare test ${randomUUID().slice(0, 6)}`;
      await as(admin).post('/places', { kind: 'STATION', name, lat: 48.85, lng: 2.35 }).expect(400);
      const p = await as(admin).post('/places', { kind: 'STATION', name, lat: 5.33, lng: -4.02, aliases: ['Gare nord'] }).expect(201);
      expect(p.body).toMatchObject({ name, precision: 'APPROX', isActive: true });
      const found = await as(admin).get(`/places?q=${encodeURIComponent(name)}`).expect(200);
      expect(found.body.data.map((x: { id: string }) => x.id)).toContain(p.body.id);
      const upd = await as(admin).patch(`/places/${p.body.id}`, { isActive: false }).expect(200);
      expect(upd.body.isActive).toBe(false);
    });

    it('tableau de bord et statistiques', async () => {
      const d = await as(admin).get('/dashboard').expect(200);
      expect(Object.keys(d.body)).toEqual(expect.arrayContaining(['users', 'trips', 'bookings', 'money', 'queues']));
      await as(support).get('/dashboard').expect(403);
      for (const groupBy of ['city', 'route', 'period', 'kind']) {
        const s = await as(finance).get(`/stats?groupBy=${groupBy}`).expect(200);
        expect(Array.isArray(s.body.data)).toBe(true);
      }
    });
  });

  // ------------------------------------------------------------------ personnel

  describe('personnel', () => {
    it('création (lien TOTP renvoyé une fois), changement de rôle, désactivation', async () => {
      const email = `nouvel.agent.${Date.now()}@test.ivoirecovoit.ci`;
      const created = await as(superAdmin).post('/staff', { email, firstName: 'Awa', lastName: 'Koné', role: 'SUPPORT', password: 'un-mot-de-passe-solide' }).expect(201);
      expect(created.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
      await as(superAdmin).post('/staff', { email, firstName: 'Awa', lastName: 'Koné', role: 'SUPPORT', password: 'un-mot-de-passe-solide' }).expect(409);
      const list = await as(superAdmin).get('/staff').expect(200);
      expect(JSON.stringify(list.body)).not.toMatch(/password|totp/i);
      const roles = await as(superAdmin).put(`/staff/${created.body.id}/roles`, { roles: ['SUPPORT', 'FINANCE'], reason: 'Renfort de l’équipe finance' }).expect(200);
      expect(roles.body.roles).toEqual(['FINANCE', 'SUPPORT']);
      const off = await as(superAdmin).post(`/staff/${created.body.id}/active`, { active: false, reason: 'Départ de l’entreprise' }).expect(200);
      expect(off.body.isActive).toBe(false);
      await as(admin).get('/staff').expect(403);
    });

    it('un super administrateur ne se retire pas ses propres droits', async () => {
      const me = await as(superAdmin).get('/me').expect(200);
      const self = await as(superAdmin).post(`/staff/${me.body.id}/active`, { active: false, reason: 'Essai de désactivation' }).expect(409);
      expect(self.body.error.code).toBe('SELF_DEACTIVATION');
      const demote = await as(superAdmin).put(`/staff/${me.body.id}/roles`, { roles: ['ADMIN'], reason: 'Essai de rétrogradation' }).expect(409);
      expect(demote.body.error.code).toBe('SELF_DEMOTION');
    });
  });
});
