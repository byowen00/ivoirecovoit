import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { uuidv7 } from '../src/common/ids';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { ReviewsService } from '../src/modules/trust/reviews.service';
import { createTrip, ensureFeeRule } from './fixtures';
import { flows } from './flow-helpers';
import { bearer, createTestApp, type LoggedIn, loginActive, type TestApp } from './test-app';
import { connectTestDb } from './test-db';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('Confiance et notifications (étape 9 : messagerie, avis, signalements, réclamations, partage, promotions)', () => {
  let t: TestApp;
  let db: Client;
  let f: ReturnType<typeof flows>;
  let alice: LoggedIn;
  let stranger: LoggedIn;

  beforeAll(async () => {
    t = await createTestApp();
    db = await connectTestDb();
    f = flows(t, db);
    await ensureFeeRule(db);
    alice = await loginActive(t);
    stranger = await loginActive(t);
  });
  beforeEach(async () => {
    await t.redis.flushdb();
    await db.query(`UPDATE bookings SET status = 'EXPIRED' WHERE passenger_id = $1 AND status IN ('PENDING_ACCEPTANCE','PENDING_PAYMENT')`, [alice.userId]);
  });
  afterAll(async () => {
    await db.end();
    await t.app.close();
  });

  const get = (who: LoggedIn, path: string) => t.http().get(`/api/v1${path}`).set(bearer(who.accessToken));
  const post = (who: LoggedIn, path: string, body: object = {}) => t.http().post(`/api/v1${path}`).set(bearer(who.accessToken)).send(body);
  const postIdem = (who: LoggedIn, path: string, body: object) =>
    t.http().post(`/api/v1${path}`).set(bearer(who.accessToken)).set('Idempotency-Key', randomUUID()).send(body);

  // ------------------------------------------------------------------ notifications (écran 13)

  describe('notifications', () => {
    it('paiement confirmé : notification au passager et au conducteur, compteur, lecture', async () => {
      const trip = await createTrip(db);
      const driver = await f.driverSession(trip);
      await f.dispatch();
      await post(alice, '/notifications/read', { all: true }).expect(200);
      await post(driver, '/notifications/read', { all: true }).expect(200);

      await f.paidBooking(alice, trip);
      await f.dispatch();
      const list = await get(alice, '/notifications').expect(200);
      expect(list.body.data[0]).toMatchObject({ type: 'payment.succeeded', title: 'Paiement confirmé' });
      expect(list.body.data[0].body).toMatch(/5\s300 F CFA/u);
      const unread = await get(alice, '/notifications/unread-count').expect(200);
      expect(unread.body.unreadCount).toBeGreaterThanOrEqual(1);
      const forDriver = await get(driver, '/notifications?unread=true').expect(200);
      expect(forDriver.body.data.map((n: { type: string }) => n.type)).toContain('booking.confirmed');

      await post(alice, '/notifications/read', { ids: [list.body.data[0].id] }).expect(200);
      await post(alice, '/notifications/read', { all: true }).expect(200);
      expect((await get(alice, '/notifications/unread-count').expect(200)).body.unreadCount).toBe(0);
    });

    it('un même événement traité deux fois ne crée pas de doublon', async () => {
      const trip = await createTrip(db);
      await f.paidBooking(alice, trip);
      await f.dispatch();
      const before = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1`, [alice.userId]);
      await db.query(`UPDATE outbox_events SET published_at = NULL WHERE id = (SELECT max(id) FROM outbox_events WHERE event_type = 'payment.succeeded')`);
      await f.dispatch();
      const after = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1`, [alice.userId]);
      expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
    });

    it('préférences : messages et rappels désactivables, notifications de transaction obligatoires', async () => {
      const prefs = await get(alice, '/me/notification-preferences').expect(200);
      const enabled = (b: { categories: { code: string; enabled: boolean }[] }) => Object.fromEntries(b.categories.map((c) => [c.code, c.enabled]));
      expect(enabled(prefs.body)).toEqual({ TRANSACTIONAL: true, REMINDERS: true, MESSAGES: true, REVIEWS: true });
      expect(prefs.body.pushAvailable).toBe(false);
      await t.http().put('/api/v1/me/notification-preferences').set(bearer(alice.accessToken)).send({ TRANSACTIONAL: false }).expect(400);
      const off = await t.http().put('/api/v1/me/notification-preferences').set(bearer(alice.accessToken)).send({ MESSAGES: false }).expect(200);
      expect(enabled(off.body)).toMatchObject({ MESSAGES: false, TRANSACTIONAL: true });

      const trip = await createTrip(db);
      const driver = await f.driverSession(trip);
      const id = await f.paidBooking(alice, trip);
      await f.dispatch();
      await post(driver, `/bookings/${id}/messages`, { body: 'Bonjour, je suis au rond-point.' }).expect(201);
      await f.dispatch();
      const { rows } = await db.query(`SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'message.created' AND data->>'bookingId' = $2`, [alice.userId, id]);
      expect(rows).toHaveLength(0);
      await t.http().put('/api/v1/me/notification-preferences').set(bearer(alice.accessToken)).send({ MESSAGES: true }).expect(200);
    });

    it('rappels avant le départ : un seul rappel par fenêtre', async () => {
      const trip = await createTrip(db, { departure: new Date(Date.now() + 90 * 60_000) });
      const id = await f.paidBooking(alice, trip);
      const n = t.app.get(NotificationsService);
      await n.sendReminders();
      await n.sendReminders();
      const { rows } = await db.query(`SELECT title FROM notifications WHERE user_id = $1 AND type = 'trip.reminder' AND data->>'link' = $2`,
                                      [alice.userId, `/reservations/${id}`]);
      expect(rows).toEqual([{ title: 'Départ dans 2 h' }]);
    });

    it('appareils : enregistrement et retrait d’un jeton (aucun envoi sans fournisseur configuré)', async () => {
      const token = `fcm-token-de-test-${randomUUID()}`;
      await post(alice, '/me/devices', { platform: 'ANDROID', token }).expect(204);
      await post(alice, '/me/devices', { platform: 'ANDROID', token }).expect(204);
      const { rows } = await db.query(`SELECT count(*)::int AS n FROM device_tokens WHERE fcm_token = $1`, [token]);
      expect(rows[0].n).toBe(1);
      await t.http().delete('/api/v1/me/devices').set(bearer(alice.accessToken)).send({ token }).expect(204);
      expect((await db.query(`SELECT 1 FROM device_tokens WHERE fcm_token = $1`, [token])).rows).toHaveLength(0);
      expect(await t.app.get(NotificationsService).deliverPush()).toEqual({ sent: 0, failed: 0 });
    });
  });

  // ------------------------------------------------------------------ messagerie

  describe('messagerie', () => {
    it('coordonnées masquées tant que la réservation n’est pas confirmée, visibles ensuite', async () => {
      const trip = await createTrip(db);
      const driver = await f.driverSession(trip);
      const id = await f.book(alice, trip);
      const early = await post(alice, `/bookings/${id}/messages`, { body: 'Appelle-moi au 07 07 07 07 07 ou alice@exemple.ci' }).expect(201);
      expect(early.body.wasRedacted).toBe(true);
      expect(early.body.body).not.toContain('07 07 07 07 07');
      expect(early.body.body).not.toContain('alice@exemple.ci');

      await f.pay(alice, id);
      const late = await post(alice, `/bookings/${id}/messages`, { body: 'Mon numéro : 0707070707' }).expect(201);
      expect(late.body.wasRedacted).toBe(false);

      const conv = await get(driver, `/bookings/${id}/messages`).expect(200);
      expect(conv.body.viewerRole).toBe('DRIVER');
      expect(conv.body.data).toHaveLength(2);
      expect(conv.body.data[0].mine).toBe(false);
    });

    it('un tiers ne voit ni n’écrit dans la conversation (404)', async () => {
      const trip = await createTrip(db);
      const id = await f.book(alice, trip);
      await get(stranger, `/bookings/${id}/messages`).expect(404);
      await post(stranger, `/bookings/${id}/messages`, { body: 'Bonjour' }).expect(404);
    });

    it('conversation fermée après le trajet', async () => {
      const trip = await createTrip(db);
      const id = await f.paidBooking(alice, trip);
      await f.completeTrip(trip);
      const res = await post(alice, `/bookings/${id}/messages`, { body: 'Merci pour le trajet' }).expect(409);
      expect(res.body.error.code).toBe('CONVERSATION_CLOSED');
    });

    it('limite d’envoi : 20 messages par 10 minutes', async () => {
      const trip = await createTrip(db);
      const id = await f.paidBooking(alice, trip);
      for (let i = 0; i < 20; i++) await post(alice, `/bookings/${id}/messages`, { body: `Message ${i}` }).expect(201);
      await post(alice, `/bookings/${id}/messages`, { body: 'Un de trop' }).expect(429);
    });
  });

  // ------------------------------------------------------------------ avis

  describe('avis', () => {
    it('après un trajet effectué et payé ; publiés quand les deux ont noté ; note moyenne', async () => {
      const trip = await createTrip(db);
      const driver = await f.driverSession(trip);
      const id = await f.paidBooking(alice, trip);
      const before = await post(alice, `/bookings/${id}/reviews`, { rating: 5 }).expect(422);
      expect(before.body.error.code).toBe('REVIEW_NOT_ALLOWED');

      await f.completeTrip(trip);
      expect((await get(alice, `/bookings/${id}/review`).expect(200)).body).toMatchObject({ canReview: true, subjectRole: 'DRIVER' });
      await post(alice, `/bookings/${id}/reviews`, { rating: 4, comment: 'Ponctuel et prudent.' }).expect(201);
      const dup = await post(alice, `/bookings/${id}/reviews`, { rating: 5 }).expect(409);
      expect(dup.body.error.code).toBe('ALREADY_REVIEWED');
      expect((await get(alice, `/bookings/${id}/review`).expect(200)).body.mine).toMatchObject({ rating: 4, published: false });
      // Pas encore publié : le conducteur ne voit rien.
      expect((await t.http().get(`/api/v1/users/${driver.userId}/reviews`).expect(200)).body.data).toHaveLength(0);

      await post(driver, `/bookings/${id}/reviews`, { rating: 5 }).expect(201);
      const pub = await t.http().get(`/api/v1/users/${driver.userId}/reviews`).expect(200);
      expect(pub.body.data).toHaveLength(1);
      expect(pub.body.data[0]).toMatchObject({ rating: 4, comment: 'Ponctuel et prudent.' });
      expect(pub.body.user.asDriver).toMatchObject({ ratingAvg: 4, ratingCount: 1 });
      await get(stranger, `/bookings/${id}/review`).expect(404);
    });

    it('publication automatique à la fin du délai si une seule partie a noté', async () => {
      const trip = await createTrip(db);
      const driver = await f.driverSession(trip);
      const id = await f.paidBooking(alice, trip);
      await f.completeTrip(trip);
      await post(alice, `/bookings/${id}/reviews`, { rating: 3 }).expect(201);
      await t.app.get(ReviewsService).publishDue(new Date(Date.now() + 15 * DAY));
      const pub = await t.http().get(`/api/v1/users/${driver.userId}/reviews`).expect(200);
      expect(pub.body.data.map((r: { rating: number }) => r.rating)).toEqual([3]);
    });

    it('délai dépassé : plus d’avis possible', async () => {
      const trip = await createTrip(db);
      const id = await f.paidBooking(alice, trip);
      await f.completeTrip(trip, 15 * 24);
      const res = await post(alice, `/bookings/${id}/reviews`, { rating: 5 }).expect(422);
      expect(res.body.error.code).toBe('REVIEW_WINDOW_CLOSED');
    });
  });

  // ------------------------------------------------------------------ signalements

  describe('signalements', () => {
    it('gravité déduite de la catégorie, idempotent, visible dans « mes signalements »', async () => {
      const trip = await createTrip(db);
      const driver = await f.driverSession(trip);
      const id = await f.paidBooking(alice, trip);
      const key = randomUUID();
      const body = { targetType: 'USER', targetId: driver.userId, bookingId: id, category: 'DANGEROUS_DRIVING', description: 'Excès de vitesse sur l’autoroute du Nord.' };
      const a = await t.http().post('/api/v1/reports').set(bearer(alice.accessToken)).set('Idempotency-Key', key).send(body).expect(201);
      const b = await t.http().post('/api/v1/reports').set(bearer(alice.accessToken)).set('Idempotency-Key', key).send(body).expect(201);
      expect(b.body.id).toBe(a.body.id);
      const { rows } = await db.query(`SELECT severity, status FROM reports WHERE id = $1`, [a.body.id]);
      expect(rows[0]).toEqual({ severity: 'HIGH', status: 'OPEN' });
      const mine = await get(alice, '/reports/mine').expect(200);
      expect(mine.body.data.map((r: { id: string }) => r.id)).toContain(a.body.id);
    });

    it('cible inexistante ou soi-même refusée', async () => {
      await postIdem(alice, '/reports', { targetType: 'USER', targetId: uuidv7(), category: 'OTHER', description: 'Description assez longue.' }).expect(404);
      await postIdem(alice, '/reports', { targetType: 'USER', targetId: alice.userId, category: 'OTHER', description: 'Description assez longue.' }).expect(422);
    });
  });

  // ------------------------------------------------------------------ réclamations (écran 16)

  describe('réclamations', () => {
    it('ouverture après le trajet, réponse de l’autre partie, gains bloqués', async () => {
      const trip = await createTrip(db);
      const driver = await f.driverSession(trip);
      const id = await f.paidBooking(alice, trip);
      const early = await postIdem(alice, '/disputes', { bookingId: id, reasonCode: 'DRIVER_NO_SHOW', description: 'Le conducteur n’est jamais venu.' }).expect(422);
      expect(early.body.error.code).toBe('DISPUTE_NOT_ALLOWED');

      await f.completeTrip(trip);
      await db.query(`UPDATE commissions SET status = 'PAYABLE', payable_at = now() WHERE booking_id = $1`, [id]);
      const elig = await get(alice, `/bookings/${id}/dispute`).expect(200);
      expect(elig.body.allowed).toBe(true);
      const wrongRole = await postIdem(alice, '/disputes', { bookingId: id, reasonCode: 'PASSENGER_NO_SHOW', description: 'Motif qui ne va pas.' }).expect(422);
      expect(wrongRole.body.error.code).toBe('DISPUTE_REASON_INVALID');
      const d = await postIdem(alice, '/disputes', { bookingId: id, reasonCode: 'DRIVER_NO_SHOW', description: 'Le conducteur n’est jamais venu.' }).expect(201);
      expect(d.body).toMatchObject({ status: 'AWAITING_RESPONSE' });
      expect(d.body.reference).toMatch(/^R-[A-Z0-9]{6}$/);
      const { rows } = await db.query(`SELECT status FROM commissions WHERE booking_id = $1`, [id]);
      expect(rows[0].status).toBe('PENDING');

      const dup = await postIdem(alice, '/disputes', { bookingId: id, reasonCode: 'LATE', description: 'Deuxième réclamation.' }).expect(409);
      expect(dup.body.error.code).toBe('DISPUTE_ALREADY_OPEN');
      await get(stranger, `/disputes/${d.body.id}`).expect(404);

      await post(driver, `/disputes/${d.body.id}/messages`, { body: 'J’étais au point de rendez-vous à l’heure.' }).expect(201);
      const seen = await get(alice, `/disputes/${d.body.id}`).expect(200);
      expect(seen.body.status).toBe('IN_REVIEW');
      expect(seen.body.messages.map((m: { from: string }) => m.from)).toEqual(['DRIVER']);
      expect((await get(driver, '/disputes/mine').expect(200)).body.data.map((x: { id: string }) => x.id)).toContain(d.body.id);
    });

    it('délai de 7 jours dépassé', async () => {
      const trip = await createTrip(db);
      const id = await f.paidBooking(alice, trip);
      await f.completeTrip(trip, 8 * 24);
      const res = await postIdem(alice, '/disputes', { bookingId: id, reasonCode: 'TRIP_NOT_DONE', description: 'Le trajet n’a pas eu lieu.' }).expect(422);
      expect(res.body.error.message).toContain('délai');
    });
  });

  // ------------------------------------------------------------------ sécurité : urgence et partage

  describe('sécurité', () => {
    it('numéros d’urgence publics, marqués à valider', async () => {
      const res = await t.http().get('/api/v1/safety/emergency-numbers').expect(200);
      expect(res.body.validated).toBe(false);
      expect(res.body.numbers.length).toBeGreaterThan(0);
    });

    it('lien de partage : estimation sans position GPS, un seul lien actif, révocable', async () => {
      const trip = await createTrip(db);
      const id = await f.paidBooking(alice, trip);
      await post(stranger, `/bookings/${id}/share`).expect(404);
      const first = await post(alice, `/bookings/${id}/share`).expect(201);
      expect(first.body.url).toContain(`/partage/${first.body.token}`);
      const view = await t.http().get(`/api/v1/share/${first.body.token}`).expect(200);
      expect(view.body).toMatchObject({ isEstimate: true, status: 'PUBLISHED' });
      expect(JSON.stringify(view.body)).not.toMatch(/"(phone\w*|lat|lng|location|passenger\w*)"/i);

      const second = await post(alice, `/bookings/${id}/share`).expect(201);
      await t.http().get(`/api/v1/share/${first.body.token}`).expect(404);
      await t.http().get(`/api/v1/share/${second.body.token}`).expect(200);
      expect((await get(alice, `/bookings/${id}/share`).expect(200)).body.active).toBe(true);
      await t.http().delete(`/api/v1/bookings/${id}/share`).set(bearer(alice.accessToken)).expect(204);
      await t.http().get(`/api/v1/share/${second.body.token}`).expect(404);
      const { rows } = await db.query(`SELECT count(*)::int AS n FROM trip_shares WHERE token_hash = $1`, [second.body.token]);
      expect(rows[0].n).toBe(0); // seule l'empreinte est stockée
    });
  });

  // ------------------------------------------------------------------ codes promo

  describe('codes promo', () => {
    async function promo(opts: { code?: string; type?: 'FIXED' | 'PERCENT'; value?: number; maxRedemptions?: number | null; firstTripOnly?: boolean } = {}) {
      const code = opts.code ?? `TEST-${randomUUID().slice(0, 8).toUpperCase()}`;
      const id = uuidv7();
      await db.query(
        `INSERT INTO promotions (id, code, discount_type, discount_value, starts_at, ends_at, max_redemptions, first_trip_only, is_demo)
         VALUES ($1, $2, $3, $4, now() - interval '1 day', now() + interval '30 days', $5, $6, true)`,
        [id, code, opts.type ?? 'FIXED', opts.value ?? 1000, opts.maxRedemptions ?? null, opts.firstTripOnly ?? false],
      );
      return { id, code };
    }
    const redemption = async (bookingId: string) =>
      (await db.query(`SELECT status FROM promotion_redemptions WHERE booking_id = $1`, [bookingId])).rows[0]?.status;
    const counter = async (id: string) => (await db.query<{ n: number }>(`SELECT redemptions_count AS n FROM promotions WHERE id = $1`, [id])).rows[0]!.n;

    it('devis : réduction sur la part trajet, code inconnu refusé', async () => {
      const trip = await createTrip(db);
      const p = await promo({ type: 'PERCENT', value: 2000 }); // 20 % (stocké en points de base)
      const quote = await post(alice, '/bookings/quote', { tripId: trip.tripId, pickupStopId: trip.stopIds[0], dropoffStopId: trip.stopIds[2], seats: 1, promoCode: p.code.toLowerCase() })
        .expect(200);
      expect(quote.body).toMatchObject({ promoCode: p.code, subtotalXof: 5000, serviceFeeXof: 300, discountXof: 1000, totalXof: 4300 });
      const bad = await post(alice, '/bookings/quote', { tripId: trip.tripId, pickupStopId: trip.stopIds[0], dropoffStopId: trip.stopIds[2], seats: 1, promoCode: 'INCONNU-42' })
        .expect(422);
      expect(bad.body.error.code).toBe('PROMO_INVALID');
    });

    it('réservé à la réservation, libéré à l’expiration, consommé au paiement ; grand livre équilibré', async () => {
      const trip = await createTrip(db);
      const p = await promo({ maxRedemptions: 1 });
      const first = await f.book(alice, trip, { promoCode: p.code });
      expect(await redemption(first)).toBe('RESERVED');
      expect(await counter(p.id)).toBe(1);
      const full = await post(stranger, '/bookings/quote', { tripId: trip.tripId, pickupStopId: trip.stopIds[0], dropoffStopId: trip.stopIds[2], seats: 1, promoCode: p.code })
        .expect(422);
      expect(full.body.error.code).toBe('PROMO_INVALID');

      await db.query(`UPDATE bookings SET status = 'EXPIRED' WHERE id = $1`, [first]);
      expect(await redemption(first)).toBe('RELEASED');
      expect(await counter(p.id)).toBe(0);

      const second = await f.paidBooking(alice, trip, { promoCode: p.code });
      expect(await redemption(second)).toBe('USED');
      const { rows } = await db.query<{ account: string; total: number }>(
        `SELECT account, sum(amount_xof)::int AS total FROM ledger_entries WHERE booking_id = $1 GROUP BY account`, [second]);
      const bal = Object.fromEntries(rows.map((r) => [r.account, r.total]));
      expect(bal).toMatchObject({ PROVIDER_CLEARING: 4300, PROMO_EXPENSE: 1000, DRIVER_PAYABLE: -4500, PLATFORM_REVENUE_COMMISSION: -500, PLATFORM_REVENUE_FEES: -300 });
      expect(Object.values(bal).reduce((a, b) => a + b, 0)).toBe(0);
    });

    it('« premier trajet » refusé à un passager qui a déjà voyagé', async () => {
      const trip = await createTrip(db);
      await f.paidBooking(alice, trip);
      const p = await promo({ firstTripOnly: true });
      const other = await createTrip(db);
      const res = await post(alice, '/bookings/quote', { tripId: other.tripId, pickupStopId: other.stopIds[0], dropoffStopId: other.stopIds[2], seats: 1, promoCode: p.code })
        .expect(422);
      expect(res.body.error.message).toMatch(/premier/i);
    });
  });
});
