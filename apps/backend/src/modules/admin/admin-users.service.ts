import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { ApiError } from '../../common/api-error';
import { maskEmail, maskPhone, normalizeCiMobile } from '../../common/phone';
import { DB, type Db } from '../../database/database.module';
import { AuditService, type RequestContext } from '../../infra/audit.service';
import { hasPermission } from '../auth/decorators';
import type { AuthContext } from '../auth/request-context';
import { SessionsService } from '../auth/sessions.service';
import type { AuditQuery, ListUsersQuery, RevealInput, SuspendInput } from './admin.schemas';

/** Durée maximale d'une suspension décidée avec la seule permission « users.moderate.short » (SUPPORT). */
export const SHORT_SUSPENSION_MAX_MS = 72 * 3_600_000;

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Utilisateur introuvable.');

/**
 * Fiches utilisateurs pour le personnel : téléphone et e-mail masqués par défaut.
 * Les valeurs en clair exigent « users.read_sensitive » et un motif, et chaque consultation est journalisée.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly sessions: SessionsService,
  ) {}

  async list(query: ListUsersQuery) {
    let q = this.db
      .selectFrom('users')
      .leftJoin('staff_accounts', 'staff_accounts.user_id', 'users.id')
      .select(['users.id', 'users.phone_e164', 'users.email', 'users.display_name', 'users.status',
               'users.is_demo', 'users.created_at', 'users.suspended_until', 'staff_accounts.user_id as staff_id'])
      .orderBy('users.id', 'desc')
      .limit(query.limit + 1);
    if (query.status) q = q.where('users.status', '=', query.status);
    if (query.cursor) q = q.where('users.id', '<', query.cursor);
    if (query.q) {
      const phone = normalizeCiMobile(query.q, { allowDemo: true });
      const term = query.q;
      q = phone
        ? q.where('users.phone_e164', '=', phone)
        : q.where(sql<boolean>`normalize_search(coalesce(users.first_name,'') || ' ' || coalesce(users.last_name,''))
                                 LIKE '%' || normalize_search(${term}) || '%'`);
    }
    const rows = await q.execute();
    const page = rows.slice(0, query.limit);
    return {
      data: page.map((r) => ({
        id: r.id,
        displayName: r.display_name,
        phoneMasked: maskPhone(r.phone_e164),
        emailMasked: maskEmail(r.email),
        status: r.status,
        suspendedUntil: r.suspended_until,
        isStaff: !!r.staff_id,
        isDemo: r.is_demo,
        createdAt: r.created_at,
      })),
      nextCursor: rows.length > query.limit ? page[page.length - 1]!.id : null,
    };
  }

  async get(id: string) {
    const r = await this.db
      .selectFrom('users')
      .leftJoin('driver_profiles', 'driver_profiles.user_id', 'users.id')
      .leftJoin('staff_accounts', 'staff_accounts.user_id', 'users.id')
      .select(['users.id', 'users.phone_e164', 'users.email', 'users.first_name', 'users.last_name', 'users.status',
               'users.suspended_until', 'users.is_demo', 'users.created_at', 'users.phone_verified_at',
               'driver_profiles.verification_status', 'staff_accounts.user_id as staff_id'])
      .where('users.id', '=', id)
      .executeTakeFirst();
    if (!r) throw notFound();
    const sessions = await this.db
      .selectFrom('sessions')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('user_id', '=', id)
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', new Date())
      .executeTakeFirstOrThrow();
    return {
      id: r.id,
      firstName: r.first_name,
      lastName: r.last_name,
      phoneMasked: maskPhone(r.phone_e164),
      phoneVerified: !!r.phone_verified_at,
      emailMasked: maskEmail(r.email),
      status: r.status,
      suspendedUntil: r.suspended_until,
      driverVerificationStatus: r.verification_status ?? null,
      isStaff: !!r.staff_id,
      isDemo: r.is_demo,
      activeSessions: sessions.n,
      createdAt: r.created_at,
    };
  }

  async reveal(staff: AuthContext, id: string, input: RevealInput, ctx: RequestContext) {
    const r = await this.db.selectFrom('users').select(['phone_e164', 'email']).where('id', '=', id).executeTakeFirst();
    if (!r) throw notFound();
    await this.audit.log({
      actorId: staff.userId, actorRole: staff.roles.join(','), action: 'user.sensitive_revealed', targetType: 'user',
      targetId: id, reason: input.reason, changes: { fields: input.fields }, ctx,
    });
    return {
      ...(input.fields.includes('phone') ? { phone: r.phone_e164 } : {}),
      ...(input.fields.includes('email') ? { email: r.email } : {}),
    };
  }

  async suspend(staff: AuthContext, id: string, input: SuspendInput, ctx: RequestContext) {
    const fullRights = hasPermission(staff, 'users.moderate');
    const now = Date.now();
    if (input.until && input.until.getTime() <= now) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Certains champs sont invalides.', {
        fields: { until: 'La date de fin doit être dans le futur.' },
      });
    }
    if (!fullRights && (!input.until || input.until.getTime() - now > SHORT_SUSPENSION_MAX_MS)) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Votre rôle permet une suspension de 72 heures au plus.', {
        maxHours: 72,
      });
    }
    await this.db.transaction().execute(async (trx) => {
      const target = await trx
        .selectFrom('users')
        .leftJoin('staff_accounts', 'staff_accounts.user_id', 'users.id')
        .select(['users.status', 'staff_accounts.user_id as staff_id'])
        .where('users.id', '=', id)
        .forUpdate('users')
        .executeTakeFirst();
      if (!target) throw notFound();
      if (target.staff_id) {
        throw new ApiError(HttpStatus.CONFLICT, 'TARGET_IS_STAFF', 'Les comptes du personnel se gèrent dans « Personnel ».');
      }
      if (target.status === 'DELETED' || target.status === 'BANNED') {
        throw new ApiError(HttpStatus.CONFLICT, 'INVALID_STATE_TRANSITION', 'Ce compte ne peut pas être suspendu.');
      }
      await trx
        .updateTable('users')
        .set({ status: 'SUSPENDED', suspended_until: input.until ?? null })
        .where('id', '=', id)
        .execute();
      const revoked = await this.sessions.revokeAllForUser(id, 'ACCOUNT_SUSPENDED', trx);
      await this.audit.log(
        { actorId: staff.userId, actorRole: staff.roles.join(','), action: 'user.suspended', targetType: 'user',
          targetId: id, reason: input.reason,
          changes: { from: target.status, until: input.until?.toISOString() ?? null, revokedSessions: revoked }, ctx },
        trx,
      );
    });
    return this.get(id);
  }

  async unsuspend(staff: AuthContext, id: string, reason: string, ctx: RequestContext) {
    await this.db.transaction().execute(async (trx) => {
      const target = await trx
        .selectFrom('users')
        .select(['status', 'first_name', 'last_name'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!target) throw notFound();
      if (target.status !== 'SUSPENDED') {
        throw new ApiError(HttpStatus.CONFLICT, 'INVALID_STATE_TRANSITION', "Ce compte n'est pas suspendu.");
      }
      const status = target.first_name && target.last_name ? 'ACTIVE' : 'PENDING_VERIFICATION';
      await trx.updateTable('users').set({ status, suspended_until: null }).where('id', '=', id).execute();
      await this.audit.log(
        { actorId: staff.userId, actorRole: staff.roles.join(','), action: 'user.unsuspended', targetType: 'user',
          targetId: id, reason, changes: { to: status }, ctx },
        trx,
      );
    });
    return this.get(id);
  }

  async auditLogs(query: AuditQuery) {
    let q = this.db
      .selectFrom('audit_logs')
      .select(['id', 'actor_id', 'actor_role', 'action', 'target_type', 'target_id', 'reason', 'changes', 'ip',
               'request_id', 'created_at'])
      .orderBy('id', 'desc')
      .limit(query.limit + 1);
    if (query.targetId) q = q.where('target_id', '=', query.targetId);
    if (query.actorId) q = q.where('actor_id', '=', query.actorId);
    if (query.action) q = q.where('action', '=', query.action);
    if (query.before) q = q.where('id', '<', query.before);
    const rows = await q.execute();
    const page = rows.slice(0, query.limit);
    return {
      data: page.map((r) => ({
        id: r.id, actorId: r.actor_id, actorRole: r.actor_role, action: r.action, targetType: r.target_type,
        targetId: r.target_id, reason: r.reason, changes: r.changes, ip: r.ip, requestId: r.request_id,
        createdAt: r.created_at,
      })),
      nextCursor: rows.length > query.limit ? String(page[page.length - 1]!.id) : null,
    };
  }
}
