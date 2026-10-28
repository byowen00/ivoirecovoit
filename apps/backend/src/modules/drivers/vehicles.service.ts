import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../../common/api-error';
import { uuidv7 } from '../../common/ids';
import { DB, type Db } from '../../database/database.module';
import { AuditService, type RequestContext } from '../../infra/audit.service';
import type { CreateVehicleInput, UpdateVehicleInput, VehicleUploadInput } from './driver.schemas';
import { todayIso } from './driver.schemas';
import { currentDocuments, type DocumentView, DocumentsService } from './documents.service';
import { DriversService, driverProfileNotFound } from './drivers.service';

const vehicleNotFound = () => new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Véhicule introuvable.');
const ACTIVE_TRIP_STATUSES = ['DRAFT', 'PUBLISHED', 'FULL', 'IN_PROGRESS'] as const;

export type VehicleRequirement = 'VEHICLE_REGISTRATION' | 'INSURANCE' | 'TECHNICAL_INSPECTION';

export function vehicleRequirements(current: DocumentView[]): Record<VehicleRequirement, boolean> {
  const ok = (type: VehicleRequirement) =>
    current.some((d) => d.docType === type && d.status !== 'REJECTED' && (!d.expiresOn || d.expiresOn >= todayIso()));
  return {
    VEHICLE_REGISTRATION: ok('VEHICLE_REGISTRATION'),
    INSURANCE: ok('INSURANCE'),
    TECHNICAL_INSPECTION: ok('TECHNICAL_INSPECTION'),
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string }).code === '23505';
}

/** Véhicules du conducteur (EF-21, EF-22). L'immatriculation complète n'est jamais publique. */
@Injectable()
export class VehiclesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly documents: DocumentsService,
    private readonly drivers: DriversService,
    private readonly audit: AuditService,
  ) {}

  private async owned(userId: string, id: string) {
    const v = await this.db
      .selectFrom('vehicles')
      .selectAll()
      .where('id', '=', id)
      .where('driver_id', '=', userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!v) throw vehicleNotFound();
    return v;
  }

  async view(userId: string, id: string) {
    const v = await this.owned(userId, id);
    const current = currentDocuments(await this.documents.list({ kind: 'vehicle', vehicleId: id }));
    const requirements = vehicleRequirements(current);
    const editable = ['NOT_SUBMITTED', 'REJECTED'].includes(v.verification_status);
    return {
      id: v.id,
      make: v.make,
      model: v.model,
      color: v.color,
      year: v.year,
      plateNumber: v.plate_number,
      seatsCapacity: v.seats_capacity,
      status: v.verification_status,
      rejectionReason: v.rejection_reason,
      submittedAt: v.submitted_at,
      verifiedAt: v.verified_at,
      isActive: v.is_active,
      documents: current,
      requirements: Object.entries(requirements).map(([key, done]) => ({ key, done })),
      canSubmit: editable && Object.values(requirements).every(Boolean),
    };
  }

  async list(userId: string) {
    const rows = await this.db
      .selectFrom('vehicles')
      .select('id')
      .where('driver_id', '=', userId)
      .where('deleted_at', 'is', null)
      .orderBy('created_at')
      .execute();
    return { data: await Promise.all(rows.map((r) => this.view(userId, r.id))) };
  }

  async create(userId: string, input: CreateVehicleInput, ctx: RequestContext) {
    const profile = await this.db.selectFrom('driver_profiles').select('user_id').where('user_id', '=', userId).executeTakeFirst();
    if (!profile) throw driverProfileNotFound();
    const id = uuidv7();
    try {
      await this.db
        .insertInto('vehicles')
        .values({
          id,
          driver_id: userId,
          make: input.make,
          model: input.model,
          color: input.color,
          year: input.year ?? null,
          plate_number: input.plateNumber,
          seats_capacity: input.seatsCapacity,
          verification_status: 'NOT_SUBMITTED',
        })
        .execute();
    } catch (err) {
      if (isUniqueViolation(err)) throw plateTaken();
      throw err;
    }
    await this.audit.log({ actorId: userId, action: 'vehicle.create', targetType: 'vehicle', targetId: id, ctx });
    return this.view(userId, id);
  }

  async update(userId: string, id: string, input: UpdateVehicleInput, ctx: RequestContext) {
    const v = await this.owned(userId, id);
    if (v.verification_status === 'PENDING') {
      throw new ApiError(HttpStatus.CONFLICT, 'DOSSIER_LOCKED', 'Ce véhicule est en cours d’examen : attendez la décision.');
    }
    if (input.seatsCapacity !== undefined && input.seatsCapacity < v.seats_capacity) {
      const used = await this.db
        .selectFrom('trips')
        .select('seats_offered')
        .where('vehicle_id', '=', id)
        .where('status', 'in', ACTIVE_TRIP_STATUSES)
        .where('seats_offered', '>', input.seatsCapacity)
        .executeTakeFirst();
      if (used) {
        throw new ApiError(HttpStatus.CONFLICT, 'VEHICLE_IN_USE', 'Un trajet prévu propose plus de places que cette nouvelle capacité.');
      }
    }
    // Immatriculation ou nombre de places modifiés sur un véhicule validé : nouvel examen (contrat API §4).
    const sensitive =
      (input.plateNumber !== undefined && input.plateNumber !== v.plate_number) ||
      (input.seatsCapacity !== undefined && input.seatsCapacity !== v.seats_capacity);
    const reReview = sensitive && v.verification_status === 'APPROVED';
    try {
      await this.db
        .updateTable('vehicles')
        .set({
          make: input.make,
          model: input.model,
          color: input.color,
          year: input.year,
          plate_number: input.plateNumber,
          seats_capacity: input.seatsCapacity,
          ...(reReview ? { verification_status: 'PENDING' as const, submitted_at: new Date(), verified_at: null, verified_by: null } : {}),
        })
        .where('id', '=', id)
        .execute();
    } catch (err) {
      if (isUniqueViolation(err)) throw plateTaken();
      throw err;
    }
    if (reReview) await this.drivers.refreshLevel(userId);
    await this.audit.log({
      actorId: userId,
      action: 'vehicle.update',
      targetType: 'vehicle',
      targetId: id,
      changes: { fields: Object.keys(input), reReview },
      ctx,
    });
    return this.view(userId, id);
  }

  async remove(userId: string, id: string, ctx: RequestContext): Promise<void> {
    await this.owned(userId, id);
    const active = await this.db
      .selectFrom('trips')
      .select('id')
      .where('vehicle_id', '=', id)
      .where('status', 'in', ACTIVE_TRIP_STATUSES)
      .executeTakeFirst();
    if (active) {
      throw new ApiError(HttpStatus.CONFLICT, 'VEHICLE_IN_USE', 'Ce véhicule est utilisé par un trajet prévu ou en cours.');
    }
    await this.db.updateTable('vehicles').set({ deleted_at: new Date(), is_active: false }).where('id', '=', id).execute();
    await this.drivers.refreshLevel(userId);
    await this.audit.log({ actorId: userId, action: 'vehicle.delete', targetType: 'vehicle', targetId: id, ctx });
  }

  async createUpload(userId: string, id: string, input: VehicleUploadInput) {
    const v = await this.owned(userId, id);
    // Un véhicule validé peut recevoir une pièce renouvelée (assurance, visite) : elle est examinée seule.
    if (v.verification_status === 'PENDING') {
      throw new ApiError(HttpStatus.CONFLICT, 'DOSSIER_LOCKED', 'Ce véhicule est en cours d’examen : attendez la décision.');
    }
    return this.documents.createUpload(userId, { kind: 'vehicle', vehicleId: id }, input);
  }

  async completeUpload(userId: string, id: string, documentId: string) {
    await this.owned(userId, id);
    return this.documents.complete({ kind: 'vehicle', vehicleId: id }, documentId);
  }

  async submit(userId: string, id: string, ctx: RequestContext) {
    const view = await this.view(userId, id);
    if (!['NOT_SUBMITTED', 'REJECTED'].includes(view.status)) {
      throw new ApiError(HttpStatus.CONFLICT, 'DOSSIER_LOCKED', 'Ce véhicule est déjà soumis ou validé.');
    }
    const missing = view.requirements.filter((r) => !r.done).map((r) => r.key);
    if (missing.length) {
      throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'DOSSIER_INCOMPLETE', 'Il manque des pièces pour ce véhicule.', { missing });
    }
    await this.db
      .updateTable('vehicles')
      .set({ verification_status: 'PENDING', submitted_at: new Date(), rejection_reason: null })
      .where('id', '=', id)
      .execute();
    await this.audit.log({ actorId: userId, action: 'vehicle.submit', targetType: 'vehicle', targetId: id, ctx });
    return this.view(userId, id);
  }
}

function plateTaken(): ApiError {
  return new ApiError(HttpStatus.CONFLICT, 'PLATE_ALREADY_REGISTERED', 'Cette immatriculation est déjà enregistrée.');
}
