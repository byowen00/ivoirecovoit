import { connectTestDb } from './test-db';
import { bearer, createTestApp, login, loginActive, type TestApp, uniquePhone } from './test-app';

const OTP = '/api/v1/auth/otp';

describe('Authentification par OTP', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await t.redis.flushdb();
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('inscrit un nouveau numéro : compte en attente, puis actif après prénom, nom et CGU', async () => {
    const phone = uniquePhone();
    const req = await t.http().post(`${OTP}/request`).send({ phone: `+225 ${phone}` }).expect(200);
    expect(req.body).toEqual({
      otpRequestId: expect.any(String),
      expiresInS: 300,
      resendAfterS: 60,
      testCode: expect.stringMatching(/^\d{6}$/),
    });

    const res = await t
      .http()
      .post(`${OTP}/verify`)
      .send({ otpRequestId: req.body.otpRequestId, code: req.body.testCode, deviceLabel: 'Pixel 7' })
      .expect(200);
    expect(res.body.isNewUser).toBe(true);
    expect(res.body.user).toMatchObject({ phone: `+225${phone}`, status: 'PENDING_VERIFICATION', profileComplete: false });
    const auth = bearer(res.body.accessToken);

    // Profil incomplet : les routes ordinaires sont fermées, le profil reste accessible.
    const blocked = await t.http().get('/api/v1/test-only/active').set(auth).expect(403);
    expect(blocked.body.error.code).toBe('PROFILE_INCOMPLETE');

    await t.http().patch('/api/v1/me').set(auth).send({ firstName: 'Aya', lastName: "N'Guessan" }).expect(200);
    const me = await t.http().get('/api/v1/me').set(auth).expect(200);
    expect(me.body.status).toBe('PENDING_VERIFICATION');
    expect(me.body.requiredConsents).toEqual([
      { type: 'TERMS', version: '0.1-brouillon', accepted: false },
      { type: 'PRIVACY', version: '0.1-brouillon', accepted: false },
    ]);

    await t.http().put('/api/v1/me/consents').set(auth).send({ type: 'TERMS', version: '0.1-brouillon', granted: true }).expect(200);
    const done = await t
      .http()
      .put('/api/v1/me/consents')
      .set(auth)
      .send({ type: 'PRIVACY', version: '0.1-brouillon', granted: true })
      .expect(200);
    expect(done.body).toMatchObject({ status: 'ACTIVE', profileComplete: true, displayName: 'Aya N.' });
    await t.http().get('/api/v1/test-only/active').set(auth).expect(200);

    // Reconnexion : même compte, pas de nouvelle inscription.
    await t.redis.flushdb();
    const again = await login(t, phone);
    expect(again.userId).toBe(res.body.user.id);
    expect((again as unknown as { isNewUser: boolean }).isNewUser).toBe(false);

    const db = await connectTestDb();
    const { rows } = await db.query<{ action: string }>(
      `SELECT action FROM audit_logs WHERE target_id = $1 ORDER BY id`,
      [res.body.user.id],
    );
    await db.end();
    expect(rows.map((r) => r.action)).toEqual([
      'auth.signup',
      'user.profile_updated',
      'user.consent_recorded',
      'user.consent_recorded',
      'user.activated',
      'auth.login',
    ]);
  });

  it('répond de façon identique que le numéro ait un compte ou non', async () => {
    const existing = await login(t);
    await t.redis.flushdb();
    const a = await t.http().post(`${OTP}/request`).send({ phone: existing.phone }).expect(200);
    const b = await t.http().post(`${OTP}/request`).send({ phone: uniquePhone() }).expect(200);
    expect(Object.keys(a.body).sort()).toEqual(Object.keys(b.body).sort());
    expect(a.body.expiresInS).toBe(b.body.expiresInS);
  });

  it.each([
    ['fixe', '27 22 44 55 66'],
    ['étranger', '+33 6 12 34 56 78'],
    ['trop court', '07 07 07'],
    ['préfixe inconnu', '09 12 34 56 78'],
  ])('refuse un numéro %s', async (_label, phone) => {
    const res = await t.http().post(`${OTP}/request`).send({ phone }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fields.phone).toMatch(/mobile ivoirien/);
  });

  it('accepte les numéros [DEMO] (+225 00 00 00 00 xx) en mode test', async () => {
    await t.http().post(`${OTP}/request`).send({ phone: '+2250000000001' }).expect(200);
  });

  it('refuse un code faux, puis bloque après 5 essais même avec le bon code', async () => {
    const req = await t.http().post(`${OTP}/request`).send({ phone: uniquePhone() }).expect(200);
    const wrong = req.body.testCode === '000000' ? '111111' : '000000';
    for (let i = 1; i <= 4; i++) {
      const res = await t.http().post(`${OTP}/verify`).send({ otpRequestId: req.body.otpRequestId, code: wrong }).expect(400);
      expect(res.body.error).toMatchObject({ code: 'OTP_INVALID', details: { remainingAttempts: 5 - i } });
    }
    const fifth = await t.http().post(`${OTP}/verify`).send({ otpRequestId: req.body.otpRequestId, code: wrong }).expect(400);
    expect(fifth.body.error.code).toBe('OTP_TOO_MANY_ATTEMPTS');
    const good = await t
      .http()
      .post(`${OTP}/verify`)
      .send({ otpRequestId: req.body.otpRequestId, code: req.body.testCode })
      .expect(400);
    expect(good.body.error.code).toBe('OTP_EXPIRED');
  });

  it('refuse un code expiré', async () => {
    const req = await t.http().post(`${OTP}/request`).send({ phone: uniquePhone() }).expect(200);
    await t.redis.pexpire(`otp:req:${req.body.otpRequestId}`, 1);
    await new Promise((r) => setTimeout(r, 20));
    const res = await t
      .http()
      .post(`${OTP}/verify`)
      .send({ otpRequestId: req.body.otpRequestId, code: req.body.testCode })
      .expect(400);
    expect(res.body.error.code).toBe('OTP_EXPIRED');
  });

  it("refuse le code envoyé à un autre numéro", async () => {
    const a = await t.http().post(`${OTP}/request`).send({ phone: uniquePhone() }).expect(200);
    const b = await t.http().post(`${OTP}/request`).send({ phone: uniquePhone() }).expect(200);
    if (a.body.testCode === b.body.testCode) return; // une chance sur un million : rien à vérifier
    const res = await t.http().post(`${OTP}/verify`).send({ otpRequestId: b.body.otpRequestId, code: a.body.testCode }).expect(400);
    expect(res.body.error.code).toBe('OTP_INVALID');
  });

  it('un code ne sert qu’une fois', async () => {
    const req = await t.http().post(`${OTP}/request`).send({ phone: uniquePhone() }).expect(200);
    const body = { otpRequestId: req.body.otpRequestId, code: req.body.testCode };
    await t.http().post(`${OTP}/verify`).send(body).expect(200);
    const res = await t.http().post(`${OTP}/verify`).send(body).expect(400);
    expect(res.body.error.code).toBe('OTP_EXPIRED');
  });

  it('impose 60 s entre deux envois puis 3 envois maximum par 15 minutes', async () => {
    const phone = uniquePhone();
    await t.http().post(`${OTP}/request`).send({ phone }).expect(200);
    const tooSoon = await t.http().post(`${OTP}/request`).send({ phone }).expect(429);
    expect(tooSoon.body.error.code).toBe('RATE_LIMITED');
    expect(Number(tooSoon.headers['retry-after'])).toBeGreaterThan(0);

    for (let i = 2; i <= 3; i++) {
      await t.redis.del(`otp:cool:LOGIN:+225${phone}`);
      await t.http().post(`${OTP}/request`).send({ phone }).expect(200);
    }
    await t.redis.del(`otp:cool:LOGIN:+225${phone}`);
    const fourth = await t.http().post(`${OTP}/request`).send({ phone }).expect(429);
    expect(fourth.body.error.details.retryAfterS).toBeGreaterThan(60);
  });

  it('limite les envois par adresse IP', async () => {
    for (let i = 0; i < 20; i++) await t.http().post(`${OTP}/request`).send({ phone: uniquePhone() }).expect(200);
    await t.http().post(`${OTP}/request`).send({ phone: uniquePhone() }).expect(429);
  });

  it('limite les envois par appareil', async () => {
    for (let i = 0; i < 10; i++) {
      await t.http().post(`${OTP}/request`).set('X-Device-Id', 'appareil-1').send({ phone: uniquePhone() }).expect(200);
    }
    await t.http().post(`${OTP}/request`).set('X-Device-Id', 'appareil-1').send({ phone: uniquePhone() }).expect(429);
    await t.http().post(`${OTP}/request`).set('X-Device-Id', 'appareil-2').send({ phone: uniquePhone() }).expect(200);
  });

  it('journalise les envois et échecs sans stocker le code', async () => {
    const phone = uniquePhone();
    const req = await t.http().post(`${OTP}/request`).send({ phone }).expect(200);
    await t.http().post(`${OTP}/verify`).send({ otpRequestId: req.body.otpRequestId, code: '999999' === req.body.testCode ? '888888' : '999999' });
    const stored = await t.redis.hgetall(`otp:req:${req.body.otpRequestId}`);
    expect(JSON.stringify(stored)).not.toContain(req.body.testCode);
    const db = await connectTestDb();
    const { rows } = await db.query<{ outcome: string }>(
      `SELECT outcome FROM otp_requests_log WHERE phone_e164 = $1 ORDER BY id`,
      [`+225${phone}`],
    );
    await db.end();
    expect(rows.map((r) => r.outcome)).toEqual(['SENT', 'FAILED']);
  });
});

describe('Sessions et jetons', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await t.redis.flushdb();
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('exige un jeton sur les routes non publiques', async () => {
    const res = await t.http().get('/api/v1/me').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    await t.http().get('/api/v1/me').set('Authorization', 'Bearer abc.def.ghi').expect(401);
  });

  it('refuse un jeton modifié', async () => {
    const s = await login(t);
    const [h, p, sig] = s.accessToken.split('.');
    const payload = JSON.parse(Buffer.from(p!, 'base64url').toString());
    payload.sub = '00000000-0000-7000-8000-000000000000';
    const forged = `${h}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${sig}`;
    await t.http().get('/api/v1/me').set(bearer(forged)).expect(401);
  });

  it('signale un jeton expiré par TOKEN_EXPIRED', async () => {
    const s = await login(t);
    // Seule l'horloge (Date) avance de 16 minutes ; les minuteries restent réelles.
    jest.useFakeTimers({
      now: Date.now() + 16 * 60_000,
      doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'setImmediate', 'clearImmediate',
                  'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
    });
    try {
      const res = await t.http().get('/api/v1/me').set(bearer(s.accessToken)).expect(401);
      expect(res.body.error.code).toBe('TOKEN_EXPIRED');
    } finally {
      jest.useRealTimers();
    }
  });

  it('renouvelle les jetons par rotation et révoque la famille en cas de réutilisation', async () => {
    const s = await login(t);
    const r1 = await t.http().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken }).expect(200);
    expect(r1.body.refreshToken).not.toBe(s.refreshToken);
    await t.http().get('/api/v1/me').set(bearer(r1.body.accessToken)).expect(200);

    // L'ancien refresh token est rejoué (vol probable) : tout est révoqué, y compris la paire légitime.
    const reuse = await t.http().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken }).expect(401);
    expect(reuse.body.error.code).toBe('SESSION_REVOKED');
    await t.http().post('/api/v1/auth/refresh').send({ refreshToken: r1.body.refreshToken }).expect(401);
    await t.http().get('/api/v1/me').set(bearer(r1.body.accessToken)).expect(401);

    const db = await connectTestDb();
    const { rows } = await db.query<{ revoked_reason: string }>(
      `SELECT revoked_reason FROM sessions WHERE user_id = $1 ORDER BY created_at`,
      [s.userId],
    );
    const audit = await db.query(`SELECT 1 FROM audit_logs WHERE action = 'auth.refresh_reuse_detected' AND target_id = $1`, [s.userId]);
    await db.end();
    expect(rows.map((r) => r.revoked_reason)).toEqual(['ROTATED', 'REUSE_DETECTED']);
    expect(audit.rowCount).toBe(1);
  });

  it('refuse un refresh token inconnu', async () => {
    await t.http().post('/api/v1/auth/refresh').send({ refreshToken: 'x'.repeat(43) }).expect(401);
  });

  it('déconnecte immédiatement : le jeton d’accès ne sert plus', async () => {
    const s = await login(t);
    await t.http().post('/api/v1/auth/logout').set(bearer(s.accessToken)).expect(204);
    const res = await t.http().get('/api/v1/me').set(bearer(s.accessToken)).expect(401);
    expect(res.body.error.code).toBe('SESSION_REVOKED');
    await t.http().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken }).expect(401);
  });

  it('liste les appareils, en déconnecte un et refuse la session d’un autre compte', async () => {
    const phone = uniquePhone();
    const phoneA = await login(t, phone, 'Téléphone');
    const laptop = await login(t, phone, 'Ordinateur');
    const other = await login(t);

    const list = await t.http().get('/api/v1/auth/sessions').set(bearer(laptop.accessToken)).expect(200);
    expect(list.body.data.map((s: { deviceLabel: string; current: boolean }) => [s.deviceLabel, s.current]).sort()).toEqual([
      ['Ordinateur', true],
      ['Téléphone', false],
    ]);

    const notMine = await t.http().delete(`/api/v1/auth/sessions/${other.sessionId}`).set(bearer(laptop.accessToken)).expect(404);
    expect(notMine.body.error.code).toBe('NOT_FOUND');
    await t.http().get('/api/v1/me').set(bearer(other.accessToken)).expect(200);

    await t.http().delete(`/api/v1/auth/sessions/${phoneA.sessionId}`).set(bearer(laptop.accessToken)).expect(204);
    await t.http().get('/api/v1/me').set(bearer(phoneA.accessToken)).expect(401);
    await t.http().get('/api/v1/me').set(bearer(laptop.accessToken)).expect(200);
  });

  it('déconnecte tous les appareils', async () => {
    const phone = uniquePhone();
    const a = await login(t, phone);
    const b = await login(t, phone);
    const res = await t.http().delete('/api/v1/auth/sessions/all').set(bearer(a.accessToken)).expect(200);
    expect(res.body.revoked).toBe(2);
    await t.http().get('/api/v1/me').set(bearer(a.accessToken)).expect(401);
    await t.http().get('/api/v1/me').set(bearer(b.accessToken)).expect(401);
  });

  it('un jeton utilisateur n’ouvre pas l’administration', async () => {
    const s = await loginActive(t);
    const res = await t.http().get('/api/v1/admin/users').set(bearer(s.accessToken)).expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('Profil, consentements et suppression', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await t.redis.flushdb();
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('valide les champs du profil', async () => {
    const s = await login(t);
    const res = await t
      .http()
      .patch('/api/v1/me')
      .set(bearer(s.accessToken))
      .send({ firstName: '<script>', email: 'pas-un-email', preferences: { smoking: 'oui' } })
      .expect(400);
    expect(Object.keys(res.body.error.details.fields).sort()).toEqual(['email', 'firstName', 'preferences.smoking']);
    await t.http().patch('/api/v1/me').set(bearer(s.accessToken)).send({ role: 'ADMIN' }).expect(400);
  });

  it('fusionne les préférences et refuse un e-mail déjà pris', async () => {
    const a = await loginActive(t);
    const b = await loginActive(t);
    await t.http().patch('/api/v1/me').set(bearer(a.accessToken)).send({ preferences: { music: true, chat: 'SOME' } }).expect(200);
    const me = await t
      .http()
      .patch('/api/v1/me')
      .set(bearer(a.accessToken))
      .send({ preferences: { pets: false, languages: ['fr', 'dioula'] }, email: 'Aya@Example.ci' })
      .expect(200);
    expect(me.body.preferences).toEqual({ music: true, chat: 'SOME', pets: false, languages: ['fr', 'dioula'] });
    expect(me.body.email).toBe('aya@example.ci');
    const dup = await t.http().patch('/api/v1/me').set(bearer(b.accessToken)).send({ email: 'aya@example.ci' }).expect(409);
    expect(dup.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('refuse une version périmée des CGU et le retrait des CGU', async () => {
    const s = await loginActive(t);
    const old = await t
      .http()
      .put('/api/v1/me/consents')
      .set(bearer(s.accessToken))
      .send({ type: 'TERMS', version: '0.0', granted: true })
      .expect(409);
    expect(old.body.error).toMatchObject({ code: 'CONSENT_VERSION_OUTDATED', details: { currentVersion: '0.1-brouillon' } });
    const withdraw = await t
      .http()
      .put('/api/v1/me/consents')
      .set(bearer(s.accessToken))
      .send({ type: 'TERMS', version: '0.1-brouillon', granted: false })
      .expect(409);
    expect(withdraw.body.error.code).toBe('CONSENT_REQUIRED');
  });

  it('enregistre le consentement de géolocalisation et son retrait, datés', async () => {
    const s = await loginActive(t);
    const auth = bearer(s.accessToken);
    await t.http().put('/api/v1/me/consents').set(auth).send({ type: 'LOCATION_LIVE', version: '1', granted: true }).expect(200);
    const me = await t.http().put('/api/v1/me/consents').set(auth).send({ type: 'LOCATION_LIVE', version: '1', granted: false }).expect(200);
    expect(me.body.consents.find((c: { type: string }) => c.type === 'LOCATION_LIVE')).toMatchObject({ granted: false });
    const db = await connectTestDb();
    const { rowCount } = await db.query(`SELECT 1 FROM user_consents WHERE user_id = $1 AND consent_type = 'LOCATION_LIVE'`, [
      s.userId,
    ]);
    await db.end();
    expect(rowCount).toBe(2);
  });

  it('enregistre un contact d’urgence privé', async () => {
    const s = await loginActive(t);
    const auth = bearer(s.accessToken);
    expect((await t.http().get('/api/v1/me/emergency-contact').set(auth).expect(200)).body.data).toBeNull();
    const res = await t
      .http()
      .put('/api/v1/me/emergency-contact')
      .set(auth)
      .send({ name: 'Maman', phone: '27 22 44 55 66' })
      .expect(200);
    expect(res.body.data).toEqual({ name: 'Maman', phone: '+2252722445566' });
  });

  it('supprime le compte après confirmation par code : données effacées, sessions révoquées', async () => {
    const s = await loginActive(t);
    const auth = bearer(s.accessToken);
    const otp = await t.http().post('/api/v1/me/deletion/otp').set(auth).expect(200);
    const bad = await t.http().delete('/api/v1/me').set(auth).send({ otpRequestId: otp.body.otpRequestId, code: '000000' === otp.body.testCode ? '111111' : '000000' });
    expect(bad.status).toBe(400);
    await t.http().delete('/api/v1/me').set(auth).send({ otpRequestId: otp.body.otpRequestId, code: otp.body.testCode }).expect(204);
    await t.http().get('/api/v1/me').set(auth).expect(401);

    const db = await connectTestDb();
    const { rows } = await db.query(`SELECT status, phone_e164, first_name, deleted_at FROM users WHERE id = $1`, [s.userId]);
    await db.end();
    expect(rows[0]).toMatchObject({ status: 'DELETED', phone_e164: null, first_name: null });
    expect(rows[0].deleted_at).not.toBeNull();

    // Le numéro est libéré : une nouvelle inscription crée un nouveau compte.
    const again = await login(t, s.phone.replace('+225', ''));
    expect(again.userId).not.toBe(s.userId);
  });

  it('un code de connexion ne permet pas de supprimer le compte', async () => {
    const s = await loginActive(t);
    const req = await t.http().post(`${OTP}/request`).send({ phone: s.phone }).expect(200);
    const res = await t
      .http()
      .delete('/api/v1/me')
      .set(bearer(s.accessToken))
      .send({ otpRequestId: req.body.otpRequestId, code: req.body.testCode })
      .expect(400);
    expect(res.body.error.code).toBe('OTP_INVALID');
  });
});

describe('Connexion rapide pour les essais (mode OTP de test)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp([], { OTP_TEST_QUICK_LOGIN: 'true' });
  });
  afterAll(async () => {
    await t.app.close();
    process.env.OTP_TEST_QUICK_LOGIN = 'false';
  });

  it('enchaîne les demandes de code sans délai ni plafond, et le code reste vérifié', async () => {
    const phone = uniquePhone();
    let last: { otpRequestId: string; testCode: string } | undefined;
    for (let i = 0; i < 5; i++) last = (await t.http().post(`${OTP}/request`).send({ phone }).expect(200)).body;
    await t.http().post(`${OTP}/verify`).send({ otpRequestId: last!.otpRequestId, code: '000000' === last!.testCode ? '111111' : '000000' }).expect(400);
    await t.http().post(`${OTP}/verify`).send({ otpRequestId: last!.otpRequestId, code: last!.testCode }).expect(200);
  });
});
