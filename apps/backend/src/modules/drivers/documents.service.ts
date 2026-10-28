import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ApiError } from '../../common/api-error';
import { uuidv7 } from '../../common/ids';
import { DB, type Db } from '../../database/database.module';
import type { DriverDocType, VehicleDocType, VerificationStatus } from '../../database/types';
import { AuditService, type RequestContext } from '../../infra/audit.service';
import { RateLimitService } from '../../infra/rate-limit.service';
import { detectMime, type SignedUpload, StorageService } from '../../infra/storage.service';
import { type DriverUploadInput, MAX_DOCUMENT_BYTES, type VehicleUploadInput } from './driver.schemas';

export type DocumentOwner = { kind: 'driver'; driverId: string } | { kind: 'vehicle'; vehicleId: string };

export interface DocumentView {
  id: string;
  docType: DriverDocType | VehicleDocType;
  side: 'FRONT' | 'BACK' | null;
  status: VerificationStatus;
  mimeType: string;
  sizeBytes: number;
  expiresOn: string | null;
  rejectionReason: string | null;
  uploadedAt: Date | null;
  reviewedAt: Date | null;
}

export const documentNotFound = () => new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Document introuvable.');

/** Document le plus récent effectivement déposé pour chaque emplacement (type + face). */
export function currentDocuments(docs: DocumentView[]): DocumentView[] {
  const bySlot = new Map<string, DocumentView>();
  for (const d of docs) {
    if (!d.uploadedAt) continue;
    const slot = `${d.docType}:${d.side ?? ''}`;
    const prev = bySlot.get(slot);
    if (!prev || prev.uploadedAt! < d.uploadedAt) bySlot.set(slot, d);
  }
  return [...bySlot.values()];
}

/**
 * Dépôt des pièces justificatives : URL signée de 5 min dont le type et la taille sont imposés, puis
 * contrôle par le serveur du fichier réellement reçu (taille, type d'après le contenu, empreinte SHA-256).
 */
@Injectable()
export class DocumentsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly storage: StorageService,
    private readonly rateLimit: RateLimitService,
    private readonly audit: AuditService,
  ) {}

  async createUpload(
    userId: string,
    owner: DocumentOwner,
    input: DriverUploadInput | VehicleUploadInput,
  ): Promise<{ documentId: string; upload: SignedUpload }> {
    if (!this.storage.available) {
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'STORAGE_UNAVAILABLE', 'Le dépôt de documents est indisponible.');
    }
    await this.rateLimit.consumeOrThrow([{ key: `doc-upload:${userId}`, limit: 30, windowS: 3600 }], 'Trop de dépôts de documents. Réessayez plus tard.');
    const id = uuidv7();
    const common = {
      id,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      sha256: Buffer.from(input.sha256, 'hex'),
      expires_on: input.expiresOn ?? null,
    };
    if (owner.kind === 'driver') {
      const d = input as DriverUploadInput;
      await this.db
        .insertInto('driver_documents')
        .values({ ...common, driver_id: owner.driverId, doc_type: d.docType, side: d.side, object_key: `drivers/${owner.driverId}/${id}` })
        .execute();
      return { documentId: id, upload: await this.storage.presignPut(`drivers/${owner.driverId}/${id}`, d.mimeType, d.sizeBytes) };
    }
    const v = input as VehicleUploadInput;
    const key = `vehicles/${owner.vehicleId}/${id}`;
    await this.db
      .insertInto('vehicle_documents')
      .values({ ...common, vehicle_id: owner.vehicleId, doc_type: v.docType, object_key: key })
      .execute();
    return { documentId: id, upload: await this.storage.presignPut(key, v.mimeType, v.sizeBytes) };
  }

  /** Confirme un dépôt après vérification du fichier reçu. Un fichier non conforme est supprimé. */
  async complete(owner: DocumentOwner, documentId: string): Promise<DocumentView> {
    const table = owner.kind === 'driver' ? 'driver_documents' : 'vehicle_documents';
    const doc =
      owner.kind === 'driver'
        ? await this.db.selectFrom('driver_documents').selectAll().where('id', '=', documentId).where('driver_id', '=', owner.driverId).executeTakeFirst()
        : await this.db.selectFrom('vehicle_documents').selectAll().where('id', '=', documentId).where('vehicle_id', '=', owner.vehicleId).executeTakeFirst();
    if (!doc) throw documentNotFound();
    if (doc.status !== 'NOT_SUBMITTED') return this.view(owner, documentId);

    const content = await this.storage.read(doc.object_key, MAX_DOCUMENT_BYTES);
    if (!content) {
      throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'UPLOAD_MISSING', 'Le fichier n’a pas été reçu. Recommencez le dépôt.');
    }
    let problem: 'SIZE' | 'HASH' | 'TYPE' | null = null;
    if (content.length !== doc.size_bytes) problem = 'SIZE';
    else if (!createHash('sha256').update(content).digest().equals(doc.sha256)) problem = 'HASH';
    else if (detectMime(content) !== doc.mime_type) problem = 'TYPE';
    if (problem) {
      await this.storage.remove(doc.object_key);
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'UPLOAD_INVALID',
        problem === 'TYPE'
          ? 'Le fichier n’est pas une image JPEG, PNG, WebP ou un PDF valide.'
          : 'Le fichier reçu ne correspond pas à celui annoncé. Recommencez le dépôt.',
        { reason: problem },
      );
    }
    await this.db
      .updateTable(table)
      .set({ status: 'PENDING', uploaded_at: new Date() })
      .where('id', '=', documentId)
      .where('status', '=', 'NOT_SUBMITTED')
      .execute();
    return this.view(owner, documentId);
  }

  async list(owner: DocumentOwner): Promise<DocumentView[]> {
    const cols = ['id', 'doc_type', 'status', 'mime_type', 'size_bytes', 'expires_on', 'rejection_reason', 'uploaded_at', 'reviewed_at'] as const;
    const rows =
      owner.kind === 'driver'
        ? await this.db.selectFrom('driver_documents').select([...cols, 'side']).where('driver_id', '=', owner.driverId).orderBy('created_at').execute()
        : (await this.db.selectFrom('vehicle_documents').select(cols).where('vehicle_id', '=', owner.vehicleId).orderBy('created_at').execute()).map((r) => ({ ...r, side: null }));
    return rows.map((r) => ({
      id: r.id,
      docType: r.doc_type,
      side: r.side,
      status: r.status,
      mimeType: r.mime_type,
      sizeBytes: r.size_bytes,
      expiresOn: r.expires_on,
      rejectionReason: r.rejection_reason,
      uploadedAt: r.uploaded_at,
      reviewedAt: r.reviewed_at,
    }));
  }

  private async view(owner: DocumentOwner, id: string): Promise<DocumentView> {
    const doc = (await this.list(owner)).find((d) => d.id === id);
    if (!doc) throw documentNotFound();
    return doc;
  }

  /** Clé de stockage d'un document déposé, si l'utilisateur en est l'auteur (sinon 404, sans rien divulguer). */
  private async ownedObjectKey(userId: string, documentId: string): Promise<string | null> {
    const driverDoc = await this.db
      .selectFrom('driver_documents')
      .select('object_key')
      .where('id', '=', documentId)
      .where('driver_id', '=', userId)
      .where('uploaded_at', 'is not', null)
      .executeTakeFirst();
    if (driverDoc) return driverDoc.object_key;
    const vehicleDoc = await this.db
      .selectFrom('vehicle_documents')
      .innerJoin('vehicles', 'vehicles.id', 'vehicle_documents.vehicle_id')
      .select('vehicle_documents.object_key')
      .where('vehicle_documents.id', '=', documentId)
      .where('vehicles.driver_id', '=', userId)
      .where('vehicle_documents.uploaded_at', 'is not', null)
      .executeTakeFirst();
    return vehicleDoc?.object_key ?? null;
  }

  async ownerDownloadUrl(userId: string, documentId: string): Promise<{ url: string; expiresAt: Date }> {
    const key = await this.ownedObjectKey(userId, documentId);
    if (!key) throw documentNotFound();
    return this.storage.presignGet(key);
  }

  /** Consultation par le personnel : permission documents.view vérifiée par la garde, motif journalisé. */
  async staffDownloadUrl(
    staffId: string,
    documentId: string,
    reason: string,
    ctx: RequestContext,
  ): Promise<{ url: string; expiresAt: Date }> {
    const driverDoc = await this.db
      .selectFrom('driver_documents')
      .select(['object_key', 'driver_id as owner_id', 'doc_type'])
      .where('id', '=', documentId)
      .where('uploaded_at', 'is not', null)
      .executeTakeFirst();
    const doc =
      driverDoc ??
      (await this.db
        .selectFrom('vehicle_documents')
        .innerJoin('vehicles', 'vehicles.id', 'vehicle_documents.vehicle_id')
        .select(['vehicle_documents.object_key', 'vehicles.driver_id as owner_id', 'vehicle_documents.doc_type'])
        .where('vehicle_documents.id', '=', documentId)
        .where('vehicle_documents.uploaded_at', 'is not', null)
        .executeTakeFirst());
    if (!doc) throw documentNotFound();
    await this.audit.log({
      actorId: staffId,
      action: 'document.view',
      targetType: 'document',
      targetId: documentId,
      reason,
      changes: { docType: doc.doc_type, ownerId: doc.owner_id },
      ctx,
    });
    return this.storage.presignGet(doc.object_key);
  }
}
