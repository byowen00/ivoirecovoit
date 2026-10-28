import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { ApiError } from '../../common/api-error';
import { DB, type Db } from '../../database/database.module';
import type { Database } from '../../database/types';
import { AuditService, type RequestContext } from '../../infra/audit.service';
import { currentDocuments, DocumentsService } from '../drivers/documents.service';
import { DriversService } from '../drivers/drivers.service';
import type { ApproveInput, RejectInput, VerificationListQuery, VerificationType } from './admin.schemas';

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Dossier introuvable.');
const notPending = () =>
  new ApiError(HttpStatus.CONFLICT, 'INVALID_STATE_TRANSITION', 'Ce dossier n’est pas en attente de vérification.');

/**
 * File de vérification (EF-24) : dossiers conducteur, dossiers véhicule et pièces renouvelées.
 * Le personnel voit les métadonnées ; l'image d'une pièce n'est accessible que par une URL signée demandée
 * avec un motif (journalisé). Chaque décision est journalisée.
 */
@Injectable()
export class AdminVerificationsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly documents: DocumentsService,
    private readonly drivers: DriversService,
    private readonly audit: AuditService,
  ) {}

  async list(query: VerificationListQuery) {
    if (query.type === 'driver') {
      const rows = await this.db
        .selectFrom('driver_profiles')
        .innerJoin('users', 'users.id', 'driver_profiles.user_id')
        .select(['users.id', 'users.display_name', 'users.is_demo', 'driver_profiles.verification_status',
                 'driver_profiles.submitted_at', 'driver_profiles.verified_at'])
        .where('driver_profiles.verification_status', '=', query.status)
        .orderBy('driver_profiles.submitted_at', 'asc')
        .limit(query.limit)
        .execute();
      return { data: rows.map((r) => ({ type: 'driver', id: r.id, displayName: r.display_name, status: r.verification_status,
                                        submittedAt: r.submitted_at, verifiedAt: r.verified_at, isDemo: r.is_demo })) };
    }
    if (query.type === 'vehicle') {
      const rows = await this.db
        .selectFrom('vehicles')
        .innerJoin('users', 'users.id', 'vehicles.driver_id')
        .select(['vehicles.id', 'vehicles.make', 'vehicles.model', 'vehicles.color', 'vehicles.plate_number',
                 'vehicles.verification_status', 'vehicles.submitted_at', 'users.id as driver_id', 'users.display_name'])
        .where('vehicles.verification_status', '=', query.status)
        .where('vehicles.deleted_at', 'is', null)
        .orderBy('vehicles.submitted_at', 'asc')
        .limit(query.limit)
        .execute();
      return { data: rows.map((r) => ({ type: 'vehicle', id: r.id, label: `${r.make} ${r.model} ${r.color}`, plateNumber: r.plate_number,
                                        status: r.verification_status, submittedAt: r.submitted_at,
                                        driver: { id: r.driver_id, displayName: r.display_name } })) };
    }
    // Pièces déposées hors dossier en attente (renouvellement d'une assurance sur un véhicule validé, par exemple).
    const rows = await sql<{ id: string; doc_type: string; owner_type: string; owner_id: string; uploaded_at: Date; expires_on: string | null }>`
      SELECT d.id, d.doc_type, 'vehicle' AS owner_type, d.vehicle_id AS owner_id, d.uploaded_at, d.expires_on
        FROM vehicle_documents d JOIN vehicles v ON v.id = d.vehicle_id
       WHERE d.status = ${query.status} AND d.uploaded_at IS NOT NULL AND v.verification_status = 'APPROVED'
      UNION ALL
      SELECT d.id, d.doc_type, 'driver', d.driver_id, d.uploaded_at, d.expires_on
        FROM driver_documents d JOIN driver_profiles p ON p.user_id = d.driver_id
       WHERE d.status = ${query.status} AND d.uploaded_at IS NOT NULL AND p.verification_status = 'APPROVED'
      ORDER BY uploaded_at LIMIT ${query.limit}`.execute(this.db);
    return { data: rows.rows.map((r) => ({ type: 'document', id: r.id, docType: r.doc_type, owner: { type: r.owner_type, id: r.owner_id },
                                           uploadedAt: r.uploaded_at, expiresOn: r.expires_on })) };
  }

  async getDriver(id: string) {
    const p = await this.db
      .selectFrom('driver_profiles')
      .innerJoin('users', 'users.id', 'driver_profiles.user_id')
      .select(['users.id', 'users.display_name', 'users.created_at', 'driver_profiles.verification_status', 'driver_profiles.verification_level',
               'driver_profiles.license_expires_on', 'driver_profiles.submitted_at', 'driver_profiles.rejection_reason'])
      .where('users.id', '=', id)
      .executeTakeFirst();
    if (!p) throw notFound();
    const vehicles = await this.db.selectFrom('vehicles').select(['id', 'make', 'model', 'verification_status'])
      .where('driver_id', '=', id).where('deleted_at', 'is', null).execute();
    return {
      id: p.id,
      displayName: p.display_name,
      memberSince: p.created_at,
      status: p.verification_status,
      level: p.verification_level,
      licenseExpiresOn: p.license_expires_on,
      submittedAt: p.submitted_at,
      rejectionReason: p.rejection_reason,
      documents: currentDocuments(await this.documents.list({ kind: 'driver', driverId: id })),
      vehicles: vehicles.map((v) => ({ id: v.id, label: `${v.make} ${v.model}`, status: v.verification_status })),
    };
  }

  async getVehicle(id: string) {
    const v = await this.db.selectFrom('vehicles').selectAll().where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    if (!v) throw notFound();
    return {
      id: v.id, driverId: v.driver_id, make: v.make, model: v.model, color: v.color, year: v.year, plateNumber: v.plate_number,
      seatsCapacity: v.seats_capacity, status: v.verification_status, submittedAt: v.submitted_at, rejectionReason: v.rejection_reason,
      documents: currentDocuments(await this.documents.list({ kind: 'vehicle', vehicleId: id })),
    };
  }

  async approve(staffId: string, type: VerificationType, id: string, input: ApproveInput, ctx: RequestContext) {
    const now = new Date();
    await this.db.transaction().execute(async (trx) => {
      if (type === 'driver') {
        const p = await trx.selectFrom('driver_profiles').select('verification_status').where('user_id', '=', id).forUpdate().executeTakeFirst();
        if (!p) throw notFound();
        if (p.verification_status !== 'PENDING') throw notPending();
        await this.approveCurrentDocs(trx, 'driver', id, staffId, now);
        await trx.updateTable('driver_profiles')
          .set({ verification_status: 'APPROVED', verified_at: now, verified_by: staffId, rejection_reason: null })
          .where('user_id', '=', id).execute();
        await this.drivers.refreshLevel(id, trx);
      } else if (type === 'vehicle') {
        const v = await trx.selectFrom('vehicles').select(['verification_status', 'driver_id']).where('id', '=', id)
          .where('deleted_at', 'is', null).forUpdate().executeTakeFirst();
        if (!v) throw notFound();
        if (v.verification_status !== 'PENDING') throw notPending();
        await this.approveCurrentDocs(trx, 'vehicle', id, staffId, now);
        await trx.updateTable('vehicles')
          .set({ verification_status: 'APPROVED', verified_at: now, verified_by: staffId, rejection_reason: null })
          .where('id', '=', id).execute();
        await this.drivers.refreshLevel(v.driver_id, trx);
      } else {
        const done = await this.decideDocument(trx, id, { status: 'APPROVED', rejection_reason: null, reviewed_by: staffId, reviewed_at: now });
        if (!done) throw notPending();
      }
      await this.audit.log({ actorId: staffId, action: `verification.${type}.approve`, targetType: type, targetId: id,
                             reason: input.note ?? null, ctx }, trx);
    });
    return this.detail(type, id);
  }

  async reject(staffId: string, type: VerificationType, id: string, input: RejectInput, ctx: RequestContext) {
    const now = new Date();
    const decision = { status: 'REJECTED' as const, rejection_reason: input.reason, reviewed_by: staffId, reviewed_at: now };
    await this.db.transaction().execute(async (trx) => {
      if (type === 'document') {
        if (!(await this.decideDocument(trx, id, decision))) throw notPending();
      } else {
        const table = type === 'driver' ? 'driver_profiles' : 'vehicles';
        const key = type === 'driver' ? 'user_id' : 'id';
        const row = await trx.selectFrom(table).select('verification_status').where(key, '=', id).forUpdate().executeTakeFirst();
        if (!row) throw notFound();
        if (row.verification_status !== 'PENDING') throw notPending();
        await trx.updateTable(table).set({ verification_status: 'REJECTED', rejection_reason: input.reason }).where(key, '=', id).execute();
        // Pièces désignées comme à refaire : uniquement celles de ce dossier.
        if (input.documentIds.length) {
          if (type === 'driver') {
            await trx.updateTable('driver_documents').set(decision).where('driver_id', '=', id).where('id', 'in', input.documentIds).execute();
          } else {
            await trx.updateTable('vehicle_documents').set(decision).where('vehicle_id', '=', id).where('id', 'in', input.documentIds).execute();
          }
        }
      }
      await this.audit.log({ actorId: staffId, action: `verification.${type}.reject`, targetType: type, targetId: id,
                             reason: input.reason, changes: { documentIds: input.documentIds }, ctx }, trx);
    });
    return this.detail(type, id);
  }

  private async detail(type: VerificationType, id: string) {
    if (type === 'driver') return this.getDriver(id);
    if (type === 'vehicle') return this.getVehicle(id);
    const doc = await this.db.selectFrom('driver_documents').select(['id', 'status', 'rejection_reason']).where('id', '=', id).executeTakeFirst()
      ?? await this.db.selectFrom('vehicle_documents').select(['id', 'status', 'rejection_reason']).where('id', '=', id).executeTakeFirst();
    return { id, status: doc?.status, rejectionReason: doc?.rejection_reason ?? null };
  }

  private async approveCurrentDocs(trx: Transaction<Database>, kind: 'driver' | 'vehicle', ownerId: string, staffId: string, now: Date) {
    const docs = currentDocuments(await this.documents.list(kind === 'driver' ? { kind, driverId: ownerId } : { kind, vehicleId: ownerId }));
    const ids = docs.filter((d) => d.status === 'PENDING').map((d) => d.id);
    if (!ids.length) return;
    const set = { status: 'APPROVED' as const, reviewed_by: staffId, reviewed_at: now };
    if (kind === 'driver') await trx.updateTable('driver_documents').set(set).where('id', 'in', ids).execute();
    else await trx.updateTable('vehicle_documents').set(set).where('id', 'in', ids).execute();
  }

  private async decideDocument(
    trx: Transaction<Database>,
    id: string,
    set: { status: 'APPROVED' | 'REJECTED'; rejection_reason: string | null; reviewed_by: string; reviewed_at: Date },
  ): Promise<boolean> {
    const a = await trx.updateTable('driver_documents').set(set).where('id', '=', id).where('status', '=', 'PENDING').executeTakeFirst();
    if (Number(a.numUpdatedRows) > 0) return true;
    const b = await trx.updateTable('vehicle_documents').set(set).where('id', '=', id).where('status', '=', 'PENDING').executeTakeFirst();
    return Number(b.numUpdatedRows) > 0;
  }
}
