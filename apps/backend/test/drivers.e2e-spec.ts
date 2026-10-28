import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { fakeJpeg, fakePng, inYears, putDocument, sha256, uniquePlate, uploadDocument } from './driver-helpers';
import { staffToken } from './staff-helpers';
import { bearer, createTestApp, loginActive, type TestApp } from './test-app';
import { connectTestDb } from './test-db';

describe('Conducteurs, véhicules et documents', () => {
  let t: TestApp;
  let db: Client;
  let admin: string;
  let support: string;

  beforeAll(async () => {
    t = await createTestApp();
    db = await connectTestDb();
    await t.redis.flushdb();
    admin = (await staffToken(t, db, 'ADMIN')).token;
    support = (await staffToken(t, db, 'SUPPORT')).token;
  });
  beforeEach(async () => {
    await t.redis.flushdb();
  });
  afterAll(async () => {
    await db.end();
    await t.app.close();
  });

  async function newDriver(): Promise<string> {
    const s = await loginActive(t);
    await t
      .http()
      .post('/api/v1/drivers/me')
      .set(bearer(s.accessToken))
      .send({ licenseNumber: 'CI-2019-123456', licenseExpiresOn: inYears(4) })
      .expect(200);
    return s.accessToken;
  }

  async function completeDriverDossier(token: string): Promise<Record<string, string>> {
    const base = '/api/v1/drivers/me/documents';
    return {
      licenseFront: await uploadDocument(t, token, base, { docType: 'DRIVING_LICENSE', side: 'FRONT' }),
      licenseBack: await uploadDocument(t, token, base, { docType: 'DRIVING_LICENSE', side: 'BACK' }, fakeJpeg()),
      idFront: await uploadDocument(t, token, base, { docType: 'NATIONAL_ID', side: 'FRONT' }),
      idBack: await uploadDocument(t, token, base, { docType: 'NATIONAL_ID', side: 'BACK' }),
    };
  }

  function createVehicle(token: string, body: Record<string, unknown> = {}) {
    return t
      .http()
      .post('/api/v1/vehicles')
      .set(bearer(token))
      .set('Idempotency-Key', randomUUID())
      .send({ make: 'Toyota', model: 'Corolla', color: 'Gris', year: 2018, plateNumber: uniquePlate(), seatsCapacity: 3, ...body });
  }

  it('parcours complet : dossier, vérification par l’administration, véhicule, publication possible', async () => {
    const token = await loginActive(t).then((s) => s.accessToken);
    const none = await t.http().get('/api/v1/drivers/me').set(bearer(token)).expect(404);
    expect(none.body.error.code).toBe('DRIVER_PROFILE_NOT_FOUND');

    const created = await t
      .http()
      .post('/api/v1/drivers/me')
      .set(bearer(token))
      .send({ licenseNumber: 'ci 2019 123456', licenseExpiresOn: inYears(4) })
      .expect(200);
    expect(created.body).toMatchObject({ status: 'NOT_SUBMITTED', level: 0, canSubmit: false, canPublish: false });
    expect(created.body.license.numberMasked).toBe('•••• 3456'); // jamais le numéro complet
    const stored = await db.query(`SELECT license_number_enc FROM driver_profiles d JOIN users u ON u.id = d.user_id
                                   WHERE d.license_number_enc IS NOT NULL ORDER BY d.created_at DESC LIMIT 1`);
    expect(stored.rows[0].license_number_enc.toString('latin1')).not.toContain('123456'); // chiffré en base

    const docs = await completeDriverDossier(token);
    const ready = await t.http().get('/api/v1/drivers/me').set(bearer(token)).expect(200);
    expect(ready.body.canSubmit).toBe(true);
    expect(ready.body.documents).toHaveLength(4);
    expect(ready.body.documents.every((d: { status: string }) => d.status === 'PENDING')).toBe(true);

    const submitted = await t.http().post('/api/v1/drivers/me/submit').set(bearer(token)).expect(200);
    expect(submitted.body.status).toBe('PENDING');
    // Dossier en cours d'examen : plus de modification possible.
    await t
      .http()
      .post('/api/v1/drivers/me/documents/upload-url')
      .set(bearer(token))
      .send({ docType: 'PASSPORT', mimeType: 'image/png', sizeBytes: 10, sha256: 'a'.repeat(64) })
      .expect(409);

    // Côté administration : la file, puis la consultation d'une pièce avec motif (journalisée).
    const me = await t.http().get('/api/v1/me').set(bearer(token)).expect(200);
    const queue = await t.http().get('/api/v1/admin/verifications?type=driver').set(bearer(admin)).expect(200);
    expect(queue.body.data.map((d: { id: string }) => d.id)).toContain(me.body.id);
    const noReason = await t.http().post(`/api/v1/admin/documents/${docs.licenseFront}/download-url`).set(bearer(admin)).send({}).expect(400);
    expect(noReason.body.error.code).toBe('VALIDATION_ERROR');
    const view = await t
      .http()
      .post(`/api/v1/admin/documents/${docs.licenseFront}/download-url`)
      .set(bearer(admin))
      .send({ reason: 'Vérification du dossier conducteur' })
      .expect(200);
    const file = await fetch(view.body.url);
    expect(file.status).toBe(200);
    const audit = await db.query(`SELECT reason FROM audit_logs WHERE action = 'document.view' AND target_id = $1`, [docs.licenseFront]);
    expect(audit.rows).toEqual([{ reason: 'Vérification du dossier conducteur' }]);

    await t.http().post(`/api/v1/admin/verifications/driver/${me.body.id}/approve`).set(bearer(admin)).send({}).expect(200);
    const approved = await t.http().get('/api/v1/drivers/me').set(bearer(token)).expect(200);
    expect(approved.body).toMatchObject({ status: 'APPROVED', level: 1, canPublish: false, publishBlockers: ['NO_APPROVED_VEHICLE'] });
    expect(approved.body.documents.every((d: { status: string }) => d.status === 'APPROVED')).toBe(true);

    // Véhicule : création, pièces, soumission, validation -> niveau 2.
    const vehicle = await createVehicle(token).expect(201);
    expect(vehicle.body).toMatchObject({ status: 'NOT_SUBMITTED', canSubmit: false });
    const vbase = `/api/v1/vehicles/${vehicle.body.id}/documents`;
    await uploadDocument(t, token, vbase, { docType: 'VEHICLE_REGISTRATION' });
    await uploadDocument(t, token, vbase, { docType: 'INSURANCE', expiresOn: inYears(1) });
    await uploadDocument(t, token, vbase, { docType: 'TECHNICAL_INSPECTION', expiresOn: inYears(1) });
    await t.http().post(`/api/v1/vehicles/${vehicle.body.id}/submit`).set(bearer(token)).expect(200);
    await t.http().post(`/api/v1/admin/verifications/vehicle/${vehicle.body.id}/approve`).set(bearer(admin)).send({}).expect(200);
    const final = await t.http().get('/api/v1/drivers/me').set(bearer(token)).expect(200);
    expect(final.body).toMatchObject({ status: 'APPROVED', level: 2, canPublish: true, publishBlockers: [] });

    // Profil public : prénom + initiale, véhicule sans immatriculation, aucun numéro.
    const pub = await t.http().get(`/api/v1/drivers/${me.body.id}`).expect(200);
    expect(pub.body).toMatchObject({ displayName: 'Aya K.', verified: true, verificationLevel: 2 });
    expect(pub.body.vehicles).toEqual([{ make: 'Toyota', model: 'Corolla', color: 'Gris', year: 2018, seats: 3 }]);
    expect(JSON.stringify(pub.body)).not.toMatch(/\+225|plate/i);
  });

  it('rejet motivé : le conducteur voit le motif, corrige la pièce et renvoie son dossier', async () => {
    const token = await newDriver();
    const docs = await completeDriverDossier(token);
    await t.http().post('/api/v1/drivers/me/submit').set(bearer(token)).expect(200);
    const me = await t.http().get('/api/v1/me').set(bearer(token));
    await t
      .http()
      .post(`/api/v1/admin/verifications/driver/${me.body.id}/reject`)
      .set(bearer(admin))
      .send({ reason: 'Photo du permis (verso) illisible', documentIds: [docs.licenseBack] })
      .expect(200);
    const rejected = await t.http().get('/api/v1/drivers/me').set(bearer(token)).expect(200);
    expect(rejected.body).toMatchObject({ status: 'REJECTED', rejectionReason: 'Photo du permis (verso) illisible', canSubmit: false });
    expect(rejected.body.requirements).toContainEqual({ key: 'DRIVING_LICENSE_BACK', done: false });
    expect(rejected.body.documents.find((d: { id: string }) => d.id === docs.licenseBack)).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'Photo du permis (verso) illisible',
    });

    await uploadDocument(t, token, '/api/v1/drivers/me/documents', { docType: 'DRIVING_LICENSE', side: 'BACK' });
    const resubmitted = await t.http().post('/api/v1/drivers/me/submit').set(bearer(token)).expect(200);
    expect(resubmitted.body).toMatchObject({ status: 'PENDING', rejectionReason: null });
    // Une décision ne s'applique qu'à un dossier en attente.
    await t.http().post(`/api/v1/admin/verifications/driver/${me.body.id}/approve`).set(bearer(admin)).send({}).expect(200);
    const twice = await t.http().post(`/api/v1/admin/verifications/driver/${me.body.id}/approve`).set(bearer(admin)).send({}).expect(409);
    expect(twice.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('refuse de soumettre un dossier incomplet en listant les pièces manquantes', async () => {
    const token = await newDriver();
    await uploadDocument(t, token, '/api/v1/drivers/me/documents', { docType: 'PASSPORT' });
    const res = await t.http().post('/api/v1/drivers/me/submit').set(bearer(token)).expect(422);
    expect(res.body.error).toMatchObject({ code: 'DOSSIER_INCOMPLETE', details: { missing: ['DRIVING_LICENSE_FRONT', 'DRIVING_LICENSE_BACK'] } });
  });

  it('vérifie le fichier réellement reçu : absent, empreinte, type, taille', async () => {
    const token = await newDriver();
    const base = '/api/v1/drivers/me/documents';

    // Demande d'URL sans dépôt : rien n'a été reçu.
    const ask = await t
      .http()
      .post(`${base}/upload-url`)
      .set(bearer(token))
      .send({ docType: 'PASSPORT', mimeType: 'image/png', sizeBytes: 100, sha256: 'b'.repeat(64) })
      .expect(201);
    expect(ask.body.upload).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'image/png' } });
    const missing = await t.http().post(`${base}/${ask.body.documentId}/complete`).set(bearer(token)).expect(422);
    expect(missing.body.error.code).toBe('UPLOAD_MISSING');

    // Le stockage refuse un fichier d'une autre taille que celle signée.
    const content = fakePng();
    const res = await t
      .http()
      .post(`${base}/upload-url`)
      .set(bearer(token))
      .send({ docType: 'PASSPORT', mimeType: 'image/png', sizeBytes: content.length, sha256: sha256(content) })
      .expect(201);
    const bigger = await fetch(res.body.upload.url, { method: 'PUT', body: Buffer.concat([content, Buffer.from('x')]), headers: res.body.upload.headers });
    expect(bigger.status).toBe(403);

    // Même taille, contenu différent : empreinte refusée, fichier supprimé.
    const other = fakePng();
    await fetch(res.body.upload.url, { method: 'PUT', body: other, headers: res.body.upload.headers });
    const hash = await t.http().post(`${base}/${res.body.documentId}/complete`).set(bearer(token)).expect(422);
    expect(hash.body.error).toMatchObject({ code: 'UPLOAD_INVALID', details: { reason: 'HASH' } });
    const again = await t.http().post(`${base}/${res.body.documentId}/complete`).set(bearer(token)).expect(422);
    expect(again.body.error.code).toBe('UPLOAD_MISSING');

    // Annoncé comme image, mais c'est du texte.
    const text = Buffer.from('ceci n’est pas une image, juste du texte quelconque');
    const { documentId } = await putDocument(t, token, base, { docType: 'PASSPORT' }, text);
    const type = await t.http().post(`${base}/${documentId}/complete`).set(bearer(token)).expect(422);
    expect(type.body.error.details.reason).toBe('TYPE');

    // Validation des métadonnées.
    const bad = await t
      .http()
      .post(`${base}/upload-url`)
      .set(bearer(token))
      .send({ docType: 'PASSPORT', side: 'BACK', mimeType: 'image/gif', sizeBytes: 9 * 1024 * 1024, sha256: 'xyz' })
      .expect(400);
    expect(Object.keys(bad.body.error.details.fields).sort()).toEqual(['mimeType', 'sha256', 'sizeBytes']);
  });

  it('cloisonne les documents : un autre utilisateur ou le SUPPORT n’y a pas accès', async () => {
    const owner = await newDriver();
    const docId = await uploadDocument(t, owner, '/api/v1/drivers/me/documents', { docType: 'PASSPORT' });
    const own = await t.http().get(`/api/v1/documents/${docId}/download-url`).set(bearer(owner)).expect(200);
    expect(new URL(own.body.url).searchParams.get('X-Amz-Expires')).toBe('300');

    const intruder = await newDriver();
    const r1 = await t.http().get(`/api/v1/documents/${docId}/download-url`).set(bearer(intruder)).expect(404);
    expect(r1.body.error.code).toBe('NOT_FOUND');
    await t.http().post(`/api/v1/drivers/me/documents/${docId}/complete`).set(bearer(intruder)).expect(404);

    const r2 = await t
      .http()
      .post(`/api/v1/admin/documents/${docId}/download-url`)
      .set(bearer(support))
      .send({ reason: 'Simple curiosité du support' })
      .expect(403);
    expect(r2.body.error.code).toBe('FORBIDDEN');
    await t.http().get('/api/v1/admin/verifications?type=driver').set(bearer(owner)).expect(403);
    await t.http().get('/api/v1/admin/verifications?type=driver').set(bearer(support)).expect(403);
    await t.http().post(`/api/v1/admin/verifications/document/${docId}/approve`).set(bearer(support)).send({}).expect(403);
  });

  it('véhicules : immatriculation, unicité, idempotence, nouvel examen, suppression', async () => {
    const token = await newDriver();
    const invalid = await createVehicle(token, { plateNumber: 'ABCDEFG', seatsCapacity: 9 }).expect(400);
    expect(Object.keys(invalid.body.error.details.fields).sort()).toEqual(['plateNumber', 'seatsCapacity']);

    const plate = uniquePlate();
    const key = randomUUID();
    const body = { make: 'Kia', model: 'Picanto', color: 'Rouge', plateNumber: plate, seatsCapacity: 3 };
    const first = await t.http().post('/api/v1/vehicles').set(bearer(token)).set('Idempotency-Key', key).send(body).expect(201);
    const replay = await t.http().post('/api/v1/vehicles').set(bearer(token)).set('Idempotency-Key', key).send(body).expect(201);
    expect(replay.body.id).toBe(first.body.id);
    const reused = await t
      .http()
      .post('/api/v1/vehicles')
      .set(bearer(token))
      .set('Idempotency-Key', key)
      .send({ ...body, color: 'Bleu' })
      .expect(422);
    expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    await t.http().post('/api/v1/vehicles').set(bearer(token)).send(body).expect(400);
    const count = await db.query('SELECT count(*)::int AS n FROM vehicles WHERE driver_id = (SELECT user_id FROM sessions WHERE id = $1)', [
      JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()).sid,
    ]);
    expect(count.rows[0].n).toBe(1);

    // Même plaque avec d'autres séparateurs : déjà enregistrée.
    const dup = await createVehicle(await newDriver(), { plateNumber: plate.replace(/ /g, '-').toLowerCase() }).expect(409);
    expect(dup.body.error.code).toBe('PLATE_ALREADY_REGISTERED');

    // Véhicule validé : changer le nombre de places le renvoie en examen.
    await db.query(`UPDATE vehicles SET verification_status = 'APPROVED' WHERE id = $1`, [first.body.id]);
    const color = await t.http().patch(`/api/v1/vehicles/${first.body.id}`).set(bearer(token)).send({ color: 'Bordeaux' }).expect(200);
    expect(color.body.status).toBe('APPROVED');
    const seats = await t.http().patch(`/api/v1/vehicles/${first.body.id}`).set(bearer(token)).send({ seatsCapacity: 4 }).expect(200);
    expect(seats.body.status).toBe('PENDING');

    const other = await newDriver();
    await t.http().patch(`/api/v1/vehicles/${first.body.id}`).set(bearer(other)).send({ color: 'Noir' }).expect(404);
    await t.http().delete(`/api/v1/vehicles/${first.body.id}`).set(bearer(other)).expect(404);
    await t.http().delete(`/api/v1/vehicles/${first.body.id}`).set(bearer(token)).expect(204);
    const list = await t.http().get('/api/v1/vehicles').set(bearer(token)).expect(200);
    expect(list.body.data).toEqual([]);
  });

  it('renouvellement d’une pièce sur un véhicule validé : examinée seule dans la file « document »', async () => {
    const token = await newDriver();
    const vehicle = await createVehicle(token).expect(201);
    await db.query(`UPDATE vehicles SET verification_status = 'APPROVED' WHERE id = $1`, [vehicle.body.id]);
    const docId = await uploadDocument(t, token, `/api/v1/vehicles/${vehicle.body.id}/documents`, { docType: 'INSURANCE', expiresOn: inYears(1) });
    const queue = await t.http().get('/api/v1/admin/verifications?type=document').set(bearer(admin)).expect(200);
    expect(queue.body.data.map((d: { id: string }) => d.id)).toContain(docId);
    await t.http().post(`/api/v1/admin/verifications/document/${docId}/approve`).set(bearer(admin)).send({}).expect(200);
    const v = await t.http().get(`/api/v1/vehicles/${vehicle.body.id}`).set(bearer(token)).expect(200);
    expect(v.body.documents.find((d: { id: string }) => d.id === docId).status).toBe('APPROVED');
  });

  it('cache le profil public d’un conducteur non vérifié', async () => {
    const token = await newDriver();
    const me = await t.http().get('/api/v1/me').set(bearer(token));
    await t.http().get(`/api/v1/drivers/${me.body.id}`).expect(404);
  });
});
