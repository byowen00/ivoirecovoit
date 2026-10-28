import type { Client } from 'pg';
import { hotp, timeStep } from '../src/modules/auth/totp';
import { createStaff, PASSWORD, type StaffFixture } from './staff-helpers';
import { connectTestDb } from './test-db';
import { bearer, createTestApp, loginActive, type TestApp } from './test-app';

const totpNow = (s: StaffFixture, offset = 0) => hotp(s.secret, timeStep() + offset);

describe('Personnel : connexion et permissions', () => {
  let t: TestApp;
  let db: Client;
  const tokens: Record<string, string> = {};

  function staffLogin(s: StaffFixture, totp = totpNow(s)) {
    return t.http().post('/api/v1/auth/staff/login').send({ email: s.email, password: PASSWORD, totp });
  }

  beforeAll(async () => {
    t = await createTestApp();
    db = await connectTestDb();
    await t.redis.flushdb();
    for (const role of ['SUPPORT', 'ADMIN', 'FINANCE', 'SUPER_ADMIN']) {
      const res = await staffLogin(await createStaff(db, role));
      expect(res.status).toBe(200);
      tokens[role] = res.body.accessToken;
    }
  });
  beforeEach(async () => {
    await t.redis.flushdb();
  });
  afterAll(async () => {
    await db.end();
    await t.app.close();
  });

  it('connecte un agent avec mot de passe et code TOTP, et expose ses permissions', async () => {
    const s = await createStaff(db, 'SUPPORT');
    const res = await staffLogin(s).expect(200);
    expect(res.body.staff).toMatchObject({ email: s.email, roles: ['SUPPORT'] });
    expect(res.body.staff.permissions).toContain('users.read');
    const me = await t.http().get('/api/v1/admin/me').set(bearer(res.body.accessToken)).expect(200);
    expect(me.body.id).toBe(s.id);
  });

  it('refuse le rejeu d’un code TOTP déjà utilisé', async () => {
    const s = await createStaff(db, 'ADMIN');
    const code = totpNow(s);
    await staffLogin(s, code).expect(200);
    const replay = await staffLogin(s, code).expect(401);
    expect(replay.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('donne la même erreur pour un e-mail inconnu, un mot de passe faux ou un code faux', async () => {
    const s = await createStaff(db, 'ADMIN');
    const wrongCode = totpNow(s) === '123456' ? '654321' : '123456';
    const responses = [
      await t.http().post('/api/v1/auth/staff/login').send({ email: 'inconnu@test.ci', password: PASSWORD, totp: '123456' }),
      await t.http().post('/api/v1/auth/staff/login').send({ email: s.email, password: 'mauvais-mot-de-passe', totp: totpNow(s) }),
      await staffLogin(s, wrongCode),
    ];
    for (const r of responses) {
      expect(r.status).toBe(401);
      expect(r.body.error).toMatchObject({ code: 'INVALID_CREDENTIALS', message: 'Identifiants ou code de vérification incorrects.' });
    }
  });

  it('bloque le compte après 5 échecs, même avec les bons identifiants', async () => {
    const s = await createStaff(db, 'ADMIN');
    for (let i = 0; i < 5; i++) {
      await t.http().post('/api/v1/auth/staff/login').send({ email: s.email, password: 'faux', totp: '000000' }).expect(401);
    }
    const res = await staffLogin(s).expect(429);
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('refuse un compte du personnel désactivé', async () => {
    const s = await createStaff(db, 'ADMIN', { active: false });
    await staffLogin(s).expect(401);
  });

  it('un jeton du personnel n’ouvre pas les routes utilisateur', async () => {
    await t.http().get('/api/v1/me').set(bearer(tokens.ADMIN!)).expect(403);
  });

  it('masque téléphone et e-mail dans la recherche', async () => {
    const user = await loginActive(t);
    const res = await t.http().get('/api/v1/admin/users').query({ q: user.phone }).set(bearer(tokens.SUPPORT!)).expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].phoneMasked).toBe(`+225 ${user.phone.slice(4, 6)} •• •• •• ${user.phone.slice(-2)}`);
    expect(JSON.stringify(res.body)).not.toContain(user.phone);
  });

  // Matrice de permissions initiale (doc 04 §12) : [rôle, statut attendu].
  const matrix: [string, string, Record<string, number>][] = [
    ['GET /admin/users', 'lister les utilisateurs', { SUPPORT: 200, ADMIN: 200, FINANCE: 200, SUPER_ADMIN: 200 }],
    ['POST /admin/users/:id/reveal', 'voir le téléphone en clair', { SUPPORT: 403, ADMIN: 200, FINANCE: 403, SUPER_ADMIN: 200 }],
    ['POST /admin/users/:id/suspend', 'suspendre 7 jours', { SUPPORT: 403, ADMIN: 200, FINANCE: 403, SUPER_ADMIN: 200 }],
    ['POST /admin/users/:id/suspend-short', 'suspendre 24 h', { SUPPORT: 200, ADMIN: 200, FINANCE: 403, SUPER_ADMIN: 200 }],
    ['GET /admin/audit-logs', 'lire le journal d’audit', { SUPPORT: 403, ADMIN: 200, FINANCE: 403, SUPER_ADMIN: 200 }],
  ];

  describe.each(matrix)('%s (%s)', (route, _label, expected) => {
    it.each(Object.entries(expected))('%s → %i', async (role, status) => {
      const user = await loginActive(t);
      const auth = bearer(tokens[role]!);
      const reason = 'Vérification demandée par le support (ticket test)';
      let res;
      switch (route) {
        case 'GET /admin/users':
          res = await t.http().get('/api/v1/admin/users').set(auth);
          break;
        case 'POST /admin/users/:id/reveal':
          res = await t.http().post(`/api/v1/admin/users/${user.userId}/reveal`).set(auth).send({ reason, fields: ['phone'] });
          if (status === 200) expect(res.body.phone).toBe(user.phone);
          break;
        case 'POST /admin/users/:id/suspend':
          res = await t
            .http()
            .post(`/api/v1/admin/users/${user.userId}/suspend`)
            .set(auth)
            .send({ reason, until: new Date(Date.now() + 7 * 86_400_000).toISOString() });
          break;
        case 'POST /admin/users/:id/suspend-short':
          res = await t
            .http()
            .post(`/api/v1/admin/users/${user.userId}/suspend`)
            .set(auth)
            .send({ reason, until: new Date(Date.now() + 24 * 3_600_000).toISOString() });
          break;
        default:
          res = await t.http().get('/api/v1/admin/audit-logs').set(auth);
      }
      expect(res.status).toBe(status);
    });
  });

  it('SUPPORT ne peut pas suspendre sans date de fin', async () => {
    const user = await loginActive(t);
    const res = await t
      .http()
      .post(`/api/v1/admin/users/${user.userId}/suspend`)
      .set(bearer(tokens.SUPPORT!))
      .send({ reason: 'Comportement signalé par plusieurs passagers' })
      .expect(403);
    expect(res.body.error.details.maxHours).toBe(72);
  });

  it('exige un motif pour voir une donnée sensible et journalise la consultation', async () => {
    const user = await loginActive(t);
    await t
      .http()
      .post(`/api/v1/admin/users/${user.userId}/reveal`)
      .set(bearer(tokens.ADMIN!))
      .send({ fields: ['phone'] })
      .expect(400);
    await t
      .http()
      .post(`/api/v1/admin/users/${user.userId}/reveal`)
      .set(bearer(tokens.ADMIN!))
      .send({ reason: 'Litige ouvert sur la réservation IC-TEST01', fields: ['phone'] })
      .expect(200);
    const logs = await t
      .http()
      .get('/api/v1/admin/audit-logs')
      .query({ targetId: user.userId, action: 'user.sensitive_revealed' })
      .set(bearer(tokens.SUPER_ADMIN!))
      .expect(200);
    expect(logs.body.data).toHaveLength(1);
    expect(logs.body.data[0]).toMatchObject({ reason: 'Litige ouvert sur la réservation IC-TEST01', actorRole: 'ADMIN' });
    expect(JSON.stringify(logs.body.data[0])).not.toContain(user.phone);
  });

  it('suspendre révoque les sessions et bloque la reconnexion ; lever la suspension la rétablit', async () => {
    const user = await loginActive(t);
    const reason = 'Annulations répétées de dernière minute';
    await t
      .http()
      .post(`/api/v1/admin/users/${user.userId}/suspend`)
      .set(bearer(tokens.ADMIN!))
      .send({ reason })
      .expect(200);
    await t.http().get('/api/v1/me').set(bearer(user.accessToken)).expect(401);
    await t.http().post('/api/v1/auth/refresh').send({ refreshToken: user.refreshToken }).expect(401);

    const otp = await t.http().post('/api/v1/auth/otp/request').send({ phone: user.phone }).expect(200);
    const denied = await t
      .http()
      .post('/api/v1/auth/otp/verify')
      .send({ otpRequestId: otp.body.otpRequestId, code: otp.body.testCode })
      .expect(403);
    expect(denied.body.error.code).toBe('ACCOUNT_SUSPENDED');

    await t
      .http()
      .post(`/api/v1/admin/users/${user.userId}/unsuspend`)
      .set(bearer(tokens.ADMIN!))
      .send({ reason: 'Appel avec l’utilisateur, situation clarifiée' })
      .expect(200);
    await t.redis.flushdb();
    const otp2 = await t.http().post('/api/v1/auth/otp/request').send({ phone: user.phone }).expect(200);
    await t
      .http()
      .post('/api/v1/auth/otp/verify')
      .send({ otpRequestId: otp2.body.otpRequestId, code: otp2.body.testCode })
      .expect(200);
  });

  it('une suspension arrivée à échéance n’empêche plus la connexion', async () => {
    const user = await loginActive(t);
    await db.query(`UPDATE users SET status = 'SUSPENDED', suspended_until = now() - interval '1 minute' WHERE id = $1`, [
      user.userId,
    ]);
    await t.http().get('/api/v1/test-only/active').set(bearer(user.accessToken)).expect(200);
  });

  it('refuse de suspendre un compte du personnel', async () => {
    const s = await createStaff(db, 'SUPPORT');
    const res = await t
      .http()
      .post(`/api/v1/admin/users/${s.id}/suspend`)
      .set(bearer(tokens.SUPER_ADMIN!))
      .send({ reason: 'Test de garde-fou sur les comptes du personnel' })
      .expect(409);
    expect(res.body.error.code).toBe('TARGET_IS_STAFF');
  });

  it('la déconnexion du personnel ferme la session', async () => {
    const s = await createStaff(db, 'FINANCE');
    const res = await staffLogin(s).expect(200);
    await t.http().post('/api/v1/admin/logout').set(bearer(res.body.accessToken)).expect(204);
    await t.http().get('/api/v1/admin/me').set(bearer(res.body.accessToken)).expect(401);
  });
});
