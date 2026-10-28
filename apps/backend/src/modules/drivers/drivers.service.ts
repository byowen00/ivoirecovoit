import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { ApiError } from '../../common/api-error';
import { ENV, type Env } from '../../config/env';
import { DB, type Db } from '../../database/database.module';
import { AuditService, type RequestContext } from '../../infra/audit.service';
import { StorageService } from '../../infra/storage.service';
import { decryptSecret, encryptSecret } from '../auth/crypto';
import { DRIVER_DOC_SIDES, type DriverUploadInput, type LicenseInput, todayIso } from './driver.schemas';
import { currentDocuments, type DocumentView, DocumentsService } from './documents.service';

export const driverProfileNotFound = () =>
  new ApiError(HttpStatus.NOT_FOUND, 'DRIVER_PROFILE_NOT_FOUND', 'Vous n’avez pas encore de profil conducteur.');

export const driverNotVerified = () =>
  new ApiError(HttpStatus.FORBIDDEN, 'DRIVER_NOT_VERIFIED', 'Votre profil conducteur doit être vérifié pour cette action.');

const dossierLocked = () =>
  new ApiError(HttpStatus.CONFLICT, 'DOSSIER_LOCKED', 'Votre dossier est en cours d’examen ou déjà validé : il ne peut pas être modifié.');

export type DriverRequirement = 'LICENSE_INFO' | 'DRIVING_LICENSE_FRONT' | 'DRIVING_LICENSE_BACK' | 'IDENTITY_DOCUMENT';

/** Pièces d'identité acceptées : CNI ou carte consulaire (recto et verso), ou passeport (page d'identité). */
function hasIdentity(current: DocumentView[]): boolean {
  return (['NATIONAL_ID', 'PASSPORT', 'CONSULAR_CARD'] as const).some((type) =>
    DRIVER_DOC_SIDES[type].every((side) => current.some((d) => d.docType === type && d.side === side && d.status !== 'REJECTED')),
  );
}

export function driverRequirements(hasLicense: boolean, current: DocumentView[]): Record<DriverRequirement, boolean> {
  const has = (side: 'FRONT' | 'BACK') =>
    current.some((d) => d.docType === 'DRIVING_LICENSE' && d.side === side && d.status !== 'REJECTED');
  return {
    LICENSE_INFO: hasLicense,
    DRIVING_LICENSE_FRONT: has('FRONT'),
    DRIVING_LICENSE_BACK: has('BACK'),
    IDENTITY_DOCUMENT: hasIdentity(current),
  };
}

function maskLicense(number: string): string {
  return `•••• ${number.slice(-4)}`;
}

/**
 * Profil conducteur : permis, pièces justificatives, soumission du dossier (EF-20, EF-24).
 * Niveau 1 = identité et permis validés ; niveau 2 = au moins un véhicule validé en plus (peut publier).
 */
@Injectable()
export class DriversService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly documents: DocumentsService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  private async profile(userId: string) {
    const row = await this.db.selectFrom('driver_profiles').selectAll().where('user_id', '=', userId).executeTakeFirst();
    if (!row) throw driverProfileNotFound();
    return row;
  }

  /** Crée le profil conducteur ou met à jour les informations du permis (dossier non soumis ou rejeté). */
  async upsertLicense(userId: string, input: LicenseInput, ctx: RequestContext) {
    const enc = encryptSecret(Buffer.from(input.licenseNumber), this.env.PII_ENCRYPTION_KEY, 'pii');
    const existing = await this.db.selectFrom('driver_profiles').select('verification_status').where('user_id', '=', userId).executeTakeFirst();
    if (!existing) {
      await this.db
        .insertInto('driver_profiles')
        .values({ user_id: userId, license_number_enc: enc, license_expires_on: input.licenseExpiresOn })
        .execute();
      await this.audit.log({ actorId: userId, action: 'driver.create', targetType: 'user', targetId: userId, ctx });
    } else {
      if (!['NOT_SUBMITTED', 'REJECTED'].includes(existing.verification_status)) throw dossierLocked();
      await this.db
        .updateTable('driver_profiles')
        .set({ license_number_enc: enc, license_expires_on: input.licenseExpiresOn })
        .where('user_id', '=', userId)
        .execute();
      await this.audit.log({ actorId: userId, action: 'driver.license_update', targetType: 'user', targetId: userId, ctx });
    }
    return this.view(userId);
  }

  async view(userId: string) {
    const p = await this.profile(userId);
    const docs = await this.documents.list({ kind: 'driver', driverId: userId });
    const current = currentDocuments(docs);
    const requirements = driverRequirements(!!p.license_number_enc && !!p.license_expires_on, current);
    const licenseNumber = p.license_number_enc
      ? decryptSecret(p.license_number_enc, this.env.PII_ENCRYPTION_KEY, 'pii').toString()
      : null;
    const vehicles = await this.db
      .selectFrom('vehicles')
      .select(['verification_status'])
      .where('driver_id', '=', userId)
      .where('deleted_at', 'is', null)
      .execute();
    const blockers: string[] = [];
    if (p.verification_status !== 'APPROVED') blockers.push('DRIVER_NOT_APPROVED');
    if (p.license_expires_on && p.license_expires_on < todayIso()) blockers.push('LICENSE_EXPIRED');
    if (!vehicles.some((v) => v.verification_status === 'APPROVED')) blockers.push('NO_APPROVED_VEHICLE');
    return {
      status: p.verification_status,
      level: p.verification_level,
      submittedAt: p.submitted_at,
      verifiedAt: p.verified_at,
      rejectionReason: p.rejection_reason,
      license: licenseNumber ? { numberMasked: maskLicense(licenseNumber), expiresOn: p.license_expires_on } : null,
      documents: current,
      requirements: Object.entries(requirements).map(([key, done]) => ({ key, done })),
      canEdit: ['NOT_SUBMITTED', 'REJECTED'].includes(p.verification_status),
      canSubmit: ['NOT_SUBMITTED', 'REJECTED'].includes(p.verification_status) && Object.values(requirements).every(Boolean),
      canPublish: blockers.length === 0,
      publishBlockers: blockers,
    };
  }

  async createUpload(userId: string, input: DriverUploadInput) {
    const p = await this.profile(userId);
    if (!['NOT_SUBMITTED', 'REJECTED'].includes(p.verification_status)) throw dossierLocked();
    return this.documents.createUpload(userId, { kind: 'driver', driverId: userId }, input);
  }

  async completeUpload(userId: string, documentId: string) {
    await this.profile(userId);
    return this.documents.complete({ kind: 'driver', driverId: userId }, documentId);
  }

  async submit(userId: string, ctx: RequestContext) {
    const v = await this.view(userId);
    if (!v.canEdit) throw dossierLocked();
    const missing = v.requirements.filter((r) => !r.done).map((r) => r.key);
    if (missing.length) {
      throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'DOSSIER_INCOMPLETE', 'Il manque des pièces à votre dossier.', { missing });
    }
    await this.db
      .updateTable('driver_profiles')
      .set({ verification_status: 'PENDING', submitted_at: new Date(), rejection_reason: null })
      .where('user_id', '=', userId)
      .where('verification_status', 'in', ['NOT_SUBMITTED', 'REJECTED'])
      .execute();
    await this.audit.log({ actorId: userId, action: 'driver.submit', targetType: 'user', targetId: userId, ctx });
    return this.view(userId);
  }

  /** Garde des routes 🚗 : profil conducteur validé. */
  async requireApproved(userId: string): Promise<void> {
    const row = await this.db
      .selectFrom('driver_profiles')
      .select('verification_status')
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (row?.verification_status !== 'APPROVED') throw driverNotVerified();
  }

  /** Recalcule le niveau de vérification après une décision (EF-24). */
  async refreshLevel(userId: string, trx: Db = this.db): Promise<void> {
    await trx
      .updateTable('driver_profiles')
      .set({
        verification_level: sql<number>`CASE WHEN verification_status <> 'APPROVED' THEN 0
          WHEN EXISTS (SELECT 1 FROM vehicles v WHERE v.driver_id = driver_profiles.user_id
                        AND v.verification_status = 'APPROVED' AND v.deleted_at IS NULL) THEN 2
          ELSE 1 END`,
      })
      .where('user_id', '=', userId)
      .execute();
  }

  /** Profil public d'un conducteur vérifié (écran 7). Prénom et initiale seulement. */
  async publicProfile(driverId: string) {
    const row = await this.db
      .selectFrom('driver_profiles')
      .innerJoin('users', 'users.id', 'driver_profiles.user_id')
      .select([
        'users.id', 'users.display_name', 'users.photo_object_key', 'users.bio', 'users.preferences', 'users.created_at',
        'users.is_demo', 'driver_profiles.verification_level', 'driver_profiles.rating_avg', 'driver_profiles.rating_count',
        'driver_profiles.completed_trips_count', 'driver_profiles.verified_at',
      ])
      .where('driver_profiles.user_id', '=', driverId)
      .where('driver_profiles.verification_status', '=', 'APPROVED')
      .where('users.status', '=', 'ACTIVE')
      .executeTakeFirst();
    if (!row) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Conducteur introuvable.');
    const [vehicles, reviews, upcoming] = await Promise.all([
      this.db
        .selectFrom('vehicles')
        .select(['make', 'model', 'color', 'year', 'seats_capacity'])
        .where('driver_id', '=', driverId)
        .where('verification_status', '=', 'APPROVED')
        .where('deleted_at', 'is', null)
        .where('is_active', '=', true)
        .execute(),
      this.db
        .selectFrom('reviews')
        .innerJoin('users as author', 'author.id', 'reviews.author_id')
        .select(['reviews.id', 'reviews.rating', 'reviews.comment', 'reviews.published_at', 'author.display_name as author'])
        .where('reviews.subject_id', '=', driverId)
        .where('reviews.direction', '=', 'PASSENGER_TO_DRIVER')
        .where('reviews.published_at', 'is not', null)
        .where('reviews.hidden_at', 'is', null)
        .orderBy('reviews.published_at', 'desc')
        .limit(10)
        .execute(),
      this.db
        .selectFrom('trips')
        .select(sql<number>`count(*)::int`.as('n'))
        .where('driver_id', '=', driverId)
        .where('status', 'in', ['PUBLISHED', 'FULL'])
        .where('departure_at', '>', new Date())
        .executeTakeFirstOrThrow(),
    ]);
    const prefs = (row.preferences ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      displayName: row.display_name,
      photoUrl: await this.photoUrl(row.photo_object_key),
      bio: row.bio,
      preferences: prefs,
      memberSince: row.created_at,
      verified: true,
      verificationLevel: row.verification_level,
      verifiedSince: row.verified_at,
      ratingAvg: row.rating_avg,
      ratingCount: row.rating_count,
      completedTripsCount: row.completed_trips_count,
      upcomingTripsCount: upcoming.n,
      isDemo: row.is_demo,
      vehicles: vehicles.map((v) => ({ make: v.make, model: v.model, color: v.color, year: v.year, seats: v.seats_capacity })),
      reviews: reviews.map((r) => ({ id: r.id, rating: r.rating, comment: r.comment, publishedAt: r.published_at, author: r.author })),
    };
  }

  async photoUrl(key: string | null): Promise<string | null> {
    if (!key || !this.storage.available) return null;
    return (await this.storage.presignGet(key, 3600)).url;
  }

}
