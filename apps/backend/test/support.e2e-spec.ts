import type { Client } from 'pg';
import { staffToken } from './staff-helpers';
import { bearer, createTestApp, type LoggedIn, loginActive, type TestApp } from './test-app';
import { connectTestDb } from './test-db';

describe('Assistance : conversation avec l’équipe', () => {
  let t: TestApp;
  let db: Client;
  let alice: LoggedIn;
  let bob: LoggedIn;
  let agent: string;
  let finance: string;

  beforeAll(async () => {
    t = await createTestApp();
    db = await connectTestDb();
    alice = await loginActive(t);
    bob = await loginActive(t);
    agent = (await staffToken(t, db, 'SUPPORT')).token;
    finance = (await staffToken(t, db, 'FINANCE')).token;
  });
  beforeEach(() => t.redis.flushdb());
  afterAll(async () => {
    await db.end();
    await t.app.close();
  });

  it('le membre écrit, l’équipe répond (notification), le membre relance, l’équipe clôture', async () => {
    const open = await t.http().post('/api/v1/support/tickets').set(bearer(alice.accessToken))
      .send({ subject: 'Changer mon numéro', topic: 'COMPTE', body: 'Bonjour, comment changer mon numéro ?' }).expect(201);
    expect(open.body).toMatchObject({ status: 'OPEN', topic: 'COMPTE', messages: [{ author: 'Vous', fromStaff: false }] });
    expect(open.body.reference).toMatch(/^A-/);
    const id = open.body.id as string;

    // Personne d'autre ne la voit ; données invalides refusées.
    await t.http().get(`/api/v1/support/tickets/${id}`).set(bearer(bob.accessToken)).expect(404);
    await t.http().post(`/api/v1/support/tickets/${id}/messages`).set(bearer(bob.accessToken)).send({ body: 'intrus' }).expect(404);
    await t.http().post('/api/v1/support/tickets').set(bearer(alice.accessToken)).send({ subject: 'x', body: '' }).expect(400);
    await t.http().get('/api/v1/support/tickets').expect(401);

    // File de l'équipe, réponse, notification au membre ; l'agent reste anonyme côté membre.
    await t.http().get('/api/v1/admin/support').set(bearer(finance)).expect(403);
    const queue = await t.http().get('/api/v1/admin/support?status=OPEN').set(bearer(agent)).expect(200);
    expect(queue.body.data.map((x: { id: string }) => x.id)).toContain(id);
    await t.http().post(`/api/v1/admin/support/${id}/messages`).set(bearer(agent)).send({ body: 'Depuis Compte > Téléphone.' }).expect(201);
    const seen = await t.http().get(`/api/v1/support/tickets/${id}`).set(bearer(alice.accessToken)).expect(200);
    expect(seen.body.status).toBe('ANSWERED');
    expect(seen.body.messages[1]).toMatchObject({ fromStaff: true, author: 'Équipe IvoireCovoit', body: 'Depuis Compte > Téléphone.' });
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM outbox_events WHERE aggregate = 'support' AND aggregate_id = $1`, [id]);
    expect(rows[0].n).toBe(1);

    await t.http().post(`/api/v1/admin/support/${id}/close`).set(bearer(agent)).expect(200);
    // Une relance du membre rouvre la demande.
    await t.http().post(`/api/v1/support/tickets/${id}/messages`).set(bearer(alice.accessToken)).send({ body: 'Merci, encore une question.' }).expect(201);
    const mine = await t.http().get('/api/v1/support/tickets').set(bearer(alice.accessToken)).expect(200);
    expect(mine.body.data[0]).toMatchObject({ id, status: 'OPEN' });
  });
});
