import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { ApiError } from '../../common/api-error';
import { uuidv7 } from '../../common/ids';
import { normalizeCiPhone } from '../../common/phone';
import { DB, type Db } from '../../database/database.module';
import type { ConsentType, Database, UserStatus } from '../../database/types';
import { AuditService, type RequestContext } from '../../infra/audit.service';
import { SessionsService } from '../auth/sessions.service';
import type { ConsentInput, Preferences, UpdateProfileInput } from './profile.schemas';
import { SettingsService } from './settings.service';

export interface ConsentView {
  type: ConsentType;
  version: string;
  granted: boolean;
  at: Date;
}

export interface MeView {
  id: string;
  phone: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  bio: string | null;
  preferences: Preferences;
  status: UserStatus;
  profileComplete: boolean;
  isDemo: boolean;
  driver: { verificationStatus: string } | null;
  consents: ConsentView[];
  /** Versions des CGU et de la politique de confidentialité à accepter ; manquantes = à demander. */
  requiredConsents: { type: 'TERMS' | 'PRIVACY'; version: string; accepted: boolean }[];
  createdAt: Date;
}

const ACTIVE_BOOKING_STATUSES = ['PENDING_ACCEPTANCE', 'PENDING_PAYMENT', 'CONFIRMED'];
const ACTIVE_TRIP_STATUSES = ['PUBLISHED', 'FULL', 'IN_PROGRESS'] as const;

@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly sessions: SessionsService,
  ) {}

  /** Compte lié à un téléphone vérifié ; créé s'il n'existe pas (inscription et connexion sont un seul parcours). */
  async findOrCreateByPhone(
    phone: string,
    trx: Transaction<Database>,
  ): Promise<{ id: string; status: UserStatus; suspendedUntil: Date | null; isNew: boolean }> {
    const existing = await trx
      .selectFrom('users')
      .select(['id', 'status', 'suspended_until', 'phone_verified_at'])
      .where('phone_e164', '=', phone)
      .forUpdate()
      .executeTakeFirst();
    if (existing) {
      if (!existing.phone_verified_at) {
        await trx.updateTable('users').set({ phone_verified_at: new Date() }).where('id', '=', existing.id).execute();
      }
      return { id: existing.id, status: existing.status, suspendedUntil: existing.suspended_until, isNew: false };
    }
    const id = uuidv7();
    const inserted = await trx
      .insertInto('users')
      .values({ id, phone_e164: phone, phone_verified_at: new Date(), first_name: null, last_name: null, email: null,
                email_verified_at: null, photo_object_key: null, bio: null, suspended_until: null, deleted_at: null })
      .onConflict((oc) => oc.column('phone_e164').doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!inserted) {
      // Création concurrente du même numéro : on reprend le compte créé par l'autre requête.
      return this.findOrCreateByPhone(phone, trx);
    }
    await trx
      .insertInto('auth_identities')
      .values({ id: uuidv7(), user_id: id, provider: 'PHONE', provider_uid: phone })
      .execute();
    return { id, status: 'PENDING_VERIFICATION', suspendedUntil: null, isNew: true };
  }

  async getMe(userId: string): Promise<MeView> {
    const user = await this.db
      .selectFrom('users')
      .leftJoin('driver_profiles', 'driver_profiles.user_id', 'users.id')
      .select([
        'users.id', 'users.phone_e164', 'users.email', 'users.first_name', 'users.last_name', 'users.display_name',
        'users.bio', 'users.preferences', 'users.status', 'users.suspended_until', 'users.is_demo',
        'users.created_at', 'driver_profiles.verification_status',
      ])
      .where('users.id', '=', userId)
      .executeTakeFirstOrThrow();
    const consents = await this.latestConsents(this.db, userId);
    const versions = await this.settings.legalVersions();
    const requiredConsents = (['TERMS', 'PRIVACY'] as const).map((type) => {
      const c = consents.find((x) => x.type === type);
      return { type, version: versions[type], accepted: !!c && c.granted && c.version === versions[type] };
    });
    return {
      id: user.id,
      phone: user.phone_e164,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      displayName: user.display_name,
      bio: user.bio,
      preferences: user.preferences as Preferences,
      status: user.status,
      profileComplete: !!user.first_name && !!user.last_name && requiredConsents.every((c) => c.accepted),
      isDemo: user.is_demo,
      driver: user.verification_status ? { verificationStatus: user.verification_status } : null,
      consents,
      requiredConsents,
      createdAt: user.created_at,
    };
  }

  async updateProfile(userId: string, input: UpdateProfileInput, ctx: RequestContext): Promise<MeView> {
    await this.db.transaction().execute(async (trx) => {
      const current = await trx
        .selectFrom('users')
        .select(['preferences', 'email'])
        .where('id', '=', userId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const set: Record<string, unknown> = {};
      if (input.firstName !== undefined) set.first_name = input.firstName;
      if (input.lastName !== undefined) set.last_name = input.lastName;
      if (input.bio !== undefined) set.bio = input.bio || null;
      if (input.email !== undefined && input.email !== current.email) {
        set.email = input.email;
        set.email_verified_at = null;
      }
      if (input.preferences !== undefined) {
        set.preferences = JSON.stringify({ ...(current.preferences as object), ...input.preferences });
      }
      try {
        await trx.updateTable('users').set(set).where('id', '=', userId).execute();
      } catch (err) {
        if ((err as { code?: string; constraint?: string }).code === '23505') {
          throw new ApiError(HttpStatus.CONFLICT, 'EMAIL_TAKEN', 'Cette adresse e-mail est déjà utilisée.');
        }
        throw err;
      }
      await this.audit.log(
        { actorId: userId, action: 'user.profile_updated', targetType: 'user', targetId: userId,
          changes: { fields: Object.keys(set) }, ctx },
        trx,
      );
      await this.activateIfComplete(trx, userId, ctx);
    });
    return this.getMe(userId);
  }

  async setConsent(userId: string, input: ConsentInput, ctx: RequestContext): Promise<MeView> {
    const versions = await this.settings.legalVersions();
    if ((input.type === 'TERMS' || input.type === 'PRIVACY') && input.version !== versions[input.type]) {
      throw new ApiError(HttpStatus.CONFLICT, 'CONSENT_VERSION_OUTDATED', 'Une nouvelle version du texte est disponible.', {
        currentVersion: versions[input.type],
      });
    }
    if ((input.type === 'TERMS' || input.type === 'PRIVACY') && !input.granted) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'CONSENT_REQUIRED',
        'Ce consentement est nécessaire pour utiliser le service. Pour le retirer, supprimez votre compte.',
      );
    }
    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('user_consents')
        .values({ id: uuidv7(), user_id: userId, consent_type: input.type, version: input.version,
                  granted: input.granted, ip: ctx.ip ?? null })
        .execute();
      await this.audit.log(
        { actorId: userId, action: 'user.consent_recorded', targetType: 'user', targetId: userId,
          changes: { type: input.type, version: input.version, granted: input.granted }, ctx },
        trx,
      );
      await this.activateIfComplete(trx, userId, ctx);
    });
    return this.getMe(userId);
  }

  async getEmergencyContact(userId: string): Promise<{ name: string; phone: string } | null> {
    const row = await this.db
      .selectFrom('emergency_contacts')
      .select(['name', 'phone_e164'])
      .where('user_id', '=', userId)
      .executeTakeFirst();
    return row ? { name: row.name, phone: row.phone_e164 } : null;
  }

  async setEmergencyContact(userId: string, name: string, rawPhone: string, ctx: RequestContext) {
    const phone = normalizeCiPhone(rawPhone);
    if (!phone) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Certains champs sont invalides.', {
        fields: { phone: 'Numéro ivoirien à 10 chiffres attendu (mobile ou fixe).' },
      });
    }
    await this.db
      .insertInto('emergency_contacts')
      .values({ id: uuidv7(), user_id: userId, name, phone_e164: phone })
      .onConflict((oc) => oc.column('user_id').doUpdateSet({ name, phone_e164: phone }))
      .execute();
    await this.audit.log({ actorId: userId, action: 'user.emergency_contact_set', targetType: 'user', targetId: userId, ctx });
    return { name, phone };
  }

  /**
   * Suppression à la demande : anonymisation (données d'identité effacées, sessions révoquées).
   * Les écritures financières et réservations passées sont conservées, rattachées à un compte anonyme (obligation légale).
   */
  async deleteAccount(userId: string, ctx: RequestContext): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const activeBookings = await trx
        .selectFrom('bookings')
        .select(sql<number>`count(*)::int`.as('n'))
        .where('passenger_id', '=', userId)
        .where('status', 'in', ACTIVE_BOOKING_STATUSES)
        .executeTakeFirstOrThrow();
      const activeTrips = await trx
        .selectFrom('trips')
        .select(sql<number>`count(*)::int`.as('n'))
        .where('driver_id', '=', userId)
        .where('status', 'in', ACTIVE_TRIP_STATUSES)
        .executeTakeFirstOrThrow();
      if (activeBookings.n > 0 || activeTrips.n > 0) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'ACCOUNT_HAS_ACTIVE_ACTIVITY',
          'Annulez ou terminez vos réservations et trajets en cours avant de supprimer votre compte.',
          { activeBookings: activeBookings.n, activeTrips: activeTrips.n },
        );
      }
      await trx
        .updateTable('users')
        .set({
          status: 'DELETED', deleted_at: new Date(), phone_e164: null, phone_verified_at: null, email: null,
          email_verified_at: null, first_name: null, last_name: null, bio: null, photo_object_key: null,
          preferences: '{}',
        })
        .where('id', '=', userId)
        .execute();
      await trx.deleteFrom('auth_identities').where('user_id', '=', userId).execute();
      await trx.deleteFrom('emergency_contacts').where('user_id', '=', userId).execute();
      await trx.deleteFrom('device_tokens').where('user_id', '=', userId).execute();
      await this.sessions.revokeAllForUser(userId, 'ACCOUNT_DELETED', trx);
      await this.audit.log({ actorId: userId, action: 'user.deleted', targetType: 'user', targetId: userId, ctx }, trx);
    });
  }

  async phoneOf(userId: string): Promise<string | null> {
    const row = await this.db.selectFrom('users').select('phone_e164').where('id', '=', userId).executeTakeFirst();
    return row?.phone_e164 ?? null;
  }

  private async latestConsents(db: Db | Transaction<Database>, userId: string): Promise<ConsentView[]> {
    const rows = await db
      .selectFrom('user_consents')
      .select(['consent_type', 'version', 'granted', 'created_at'])
      .distinctOn('consent_type')
      .where('user_id', '=', userId)
      .orderBy('consent_type')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .execute();
    return rows.map((r) => ({ type: r.consent_type, version: r.version, granted: r.granted, at: r.created_at }));
  }

  /** PENDING_VERIFICATION → ACTIVE dès que prénom, nom, CGU et politique de confidentialité (versions en vigueur) sont là. */
  private async activateIfComplete(trx: Transaction<Database>, userId: string, ctx: RequestContext): Promise<void> {
    const user = await trx
      .selectFrom('users')
      .select(['status', 'first_name', 'last_name'])
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    if (user.status !== 'PENDING_VERIFICATION' || !user.first_name || !user.last_name) return;
    const versions = await this.settings.legalVersions();
    const consents = await this.latestConsents(trx, userId);
    const ok = (['TERMS', 'PRIVACY'] as const).every((t) =>
      consents.some((c) => c.type === t && c.granted && c.version === versions[t]),
    );
    if (!ok) return;
    await trx.updateTable('users').set({ status: 'ACTIVE' }).where('id', '=', userId).execute();
    await this.audit.log({ actorId: userId, action: 'user.activated', targetType: 'user', targetId: userId, ctx }, trx);
  }
}
