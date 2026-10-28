import { createHash, randomBytes } from 'node:crypto';
import type { Client } from 'pg';
import { uuidv7 } from '../src/common/ids';
import { detectMime } from '../src/infra/storage.service';
import { bearer, loginActive, type LoggedIn, type TestApp } from './test-app';

/** Faux fichiers : seule la signature de début compte pour la détection du type (aucune vraie pièce d'identité). */
export const fakePng = (size = 256) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(size)]);
export const fakeJpeg = (size = 256) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(size)]);
export const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

export function inYears(n: number): string {
  return new Date(Date.now() + n * 365 * 86_400_000).toISOString().slice(0, 10);
}

/** Demande l'URL signée, dépose le fichier directement dans le stockage (comme le ferait l'application). */
export async function putDocument(
  t: TestApp,
  token: string,
  basePath: string,
  meta: Record<string, unknown>,
  content: Buffer,
  mimeType: string = detectMime(content) ?? 'image/png',
): Promise<{ documentId: string; putStatus: number }> {
  const res = await t
    .http()
    .post(`${basePath}/upload-url`)
    .set(bearer(token))
    .send({ ...meta, mimeType, sizeBytes: content.length, sha256: sha256(content) });
  if (res.status !== 201) throw new Error(`upload-url ${res.status} ${JSON.stringify(res.body)}`);
  const put = await fetch(res.body.upload.url, { method: 'PUT', body: content, headers: res.body.upload.headers });
  return { documentId: res.body.documentId, putStatus: put.status };
}

export async function uploadDocument(
  t: TestApp,
  token: string,
  basePath: string,
  meta: Record<string, unknown>,
  content: Buffer = fakePng(),
): Promise<string> {
  const { documentId, putStatus } = await putDocument(t, token, basePath, meta, content);
  if (putStatus !== 200) throw new Error(`PUT ${putStatus}`);
  const done = await t.http().post(`${basePath}/${documentId}/complete`).set(bearer(token));
  if (done.status !== 200) throw new Error(`complete ${done.status} ${JSON.stringify(done.body)}`);
  return documentId;
}

export interface ApprovedDriver extends LoggedIn {
  vehicleId: string;
  token: string;
}

let plateSeq = 0;
const runPrefix = String(Date.now() % 9000 + 1000);
/** Immatriculation au format ivoirien « 1234 AB 01 », unique pendant l'exécution des tests. */
export function uniquePlate(): string {
  plateSeq++;
  const letters = String.fromCharCode(65 + Math.floor(plateSeq / 26) % 26) + String.fromCharCode(65 + (plateSeq % 26));
  return `${runPrefix} ${letters} ${String(plateSeq % 100).padStart(2, '0')}`;
}

/** Ajoute un véhicule validé avec assurance et visite valables (raccourci SQL : la vérification a son propre test). */
export async function addApprovedVehicle(
  db: Client,
  driverId: string,
  opts: { seats?: number; insuranceExpiresOn?: string; inspectionExpiresOn?: string } = {},
): Promise<string> {
  const vehicleId = uuidv7();
  await db.query(
    `INSERT INTO vehicles (id, driver_id, make, model, color, plate_number, seats_capacity, verification_status, verified_at)
     VALUES ($1, $2, 'Toyota', 'Corolla', 'Gris', $3, $4, 'APPROVED', now())`,
    [vehicleId, driverId, uniquePlate(), opts.seats ?? 3],
  );
  const docs: [string, string | null][] = [
    ['VEHICLE_REGISTRATION', null],
    ['INSURANCE', opts.insuranceExpiresOn ?? inYears(1)],
    ['TECHNICAL_INSPECTION', opts.inspectionExpiresOn ?? inYears(1)],
  ];
  for (const [docType, expiresOn] of docs) {
    await db.query(
      `INSERT INTO vehicle_documents (id, vehicle_id, doc_type, object_key, mime_type, size_bytes, sha256, expires_on, status, uploaded_at)
       VALUES ($1, $2, $3, 'test/absent', 'image/png', 1, '\\x00', $4, 'APPROVED', now())`,
      [uuidv7(), vehicleId, docType, expiresOn],
    );
  }
  await db.query(`UPDATE driver_profiles SET verification_level = 2 WHERE user_id = $1`, [driverId]);
  return vehicleId;
}

/** Conducteur connecté, profil validé et un véhicule validé (raccourci SQL). */
export async function approvedDriver(t: TestApp, db: Client, opts: { seats?: number } = {}): Promise<ApprovedDriver> {
  const s = await loginActive(t);
  await db.query(
    `INSERT INTO driver_profiles (user_id, verification_status, verification_level, verified_at, license_expires_on)
     VALUES ($1, 'APPROVED', 1, now(), $2)`,
    [s.userId, inYears(3)],
  );
  const vehicleId = await addApprovedVehicle(db, s.userId, opts);
  return { ...s, vehicleId, token: s.accessToken };
}
