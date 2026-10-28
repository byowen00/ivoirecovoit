import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { ApiError } from '../../common/api-error';
import { uuidv7 } from '../../common/ids';
import { ENV, type Env } from '../../config/env';
import { DB, type Db } from '../../database/database.module';
import type { Database } from '../../database/types';
import { AuditService, type RequestContext } from '../../infra/audit.service';
import { encryptSecret } from '../auth/crypto';
import { hashPassword } from '../auth/password';
import type { AuthContext } from '../auth/request-context';
import { SessionsService } from '../auth/sessions.service';
import { generateTotpSecret, otpauthUri } from '../auth/totp';

export const STAFF_ROLES = ['SUPPORT', 'ADMIN', 'FINANCE', 'SUPER_ADMIN'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

const role = (a: AuthContext) => a.roles.join(',');
const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Membre du personnel introuvable.');
const conflict = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, code, message);

/**
 * Gestion du personnel (staff.manage, SUPER_ADMIN seulement) : comptes, rôles, désactivation.
 * Le secret TOTP d'un nouveau compte n'est renvoyé qu'une fois ; il n'est stocké que chiffré.
 */
@Injectable()
export class AdminStaffService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
    private readonly sessions: SessionsService,
  ) {}

  async roles() {
    const rows = await this.db.selectFrom('staff_roles').select(['code', 'label', 'permissions']).orderBy('code').execute();
    return { data: rows };
  }

  async list() {
    const rows = await this.db
      .selectFrom('staff_accounts')
      .innerJoin('users', 'users.id', 'staff_accounts.user_id')
      .select(['users.id', 'users.email', 'users.first_name', 'users.last_name', 'staff_accounts.is_active', 'staff_accounts.last_login_at',
               'staff_accounts.created_at',
               sql<string[]>`coalesce((SELECT array_agg(role_code ORDER BY role_code) FROM staff_role_assignments a WHERE a.user_id = users.id), '{}')`.as('roles')])
      .orderBy('staff_accounts.created_at')
      .execute();
    return {
      data: rows.map((r) => ({ id: r.id, email: r.email, firstName: r.first_name, lastName: r.last_name, roles: r.roles, isActive: r.is_active,
                               lastLoginAt: r.last_login_at, createdAt: r.created_at })),
    };
  }

  async create(staff: AuthContext, input: { email: string; firstName: string; lastName: string; role: StaffRole; password: string }, ctx: RequestContext) {
    const id = uuidv7();
    const secret = generateTotpSecret();
    const passwordHash = await hashPassword(input.password);
    try {
      await this.db.transaction().execute(async (trx) => {
        await trx.insertInto('users').values({ id, email: input.email, email_verified_at: new Date(), first_name: input.firstName, last_name: input.lastName,
                                              status: 'ACTIVE', is_passenger: false }).execute();
        await trx.insertInto('staff_accounts').values({ user_id: id, password_hash: passwordHash,
                                                       totp_secret_enc: encryptSecret(secret, this.env.STAFF_TOTP_ENCRYPTION_KEY) }).execute();
        await trx.insertInto('staff_role_assignments').values({ user_id: id, role_code: input.role, granted_by: staff.userId }).execute();
        await this.audit.log({ actorId: staff.userId, actorRole: role(staff), action: 'staff.created', targetType: 'user', targetId: id,
                               changes: { role: input.role, email: input.email }, ctx }, trx);
      });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw conflict('EMAIL_TAKEN', 'Cette adresse e-mail est déjà utilisée.');
      throw err;
    }
    // Affiché une seule fois : à enregistrer tout de suite dans une application d'authentification.
    return { id, email: input.email, role: input.role, otpauthUri: otpauthUri(secret, input.email) };
  }

  async setRoles(staff: AuthContext, id: string, roles: StaffRole[], reason: string, ctx: RequestContext) {
    if (id === staff.userId && !roles.includes('SUPER_ADMIN')) {
      throw conflict('SELF_DEMOTION', 'Vous ne pouvez pas retirer votre propre rôle de super administrateur.');
    }
    await this.db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext('staff_roles'))`.execute(trx);
      const account = await trx.selectFrom('staff_accounts').select('user_id').where('user_id', '=', id).forUpdate().executeTakeFirst();
      if (!account) throw notFound();
      const before = (await trx.selectFrom('staff_role_assignments').select('role_code').where('user_id', '=', id).execute()).map((r) => r.role_code);
      await trx.deleteFrom('staff_role_assignments').where('user_id', '=', id).execute();
      await trx.insertInto('staff_role_assignments').values(roles.map((r) => ({ user_id: id, role_code: r, granted_by: staff.userId }))).execute();
      await this.ensureSuperAdminLeft(trx);
      await this.audit.log({ actorId: staff.userId, actorRole: role(staff), action: 'staff.roles_changed', targetType: 'user', targetId: id, reason,
                             changes: { before, after: roles }, ctx }, trx);
    });
    // Les jetons en cours portent les anciennes permissions : on force une nouvelle connexion.
    await this.sessions.revokeAllForUser(id, 'ACCOUNT_SUSPENDED');
    return (await this.list()).data.find((s) => s.id === id)!;
  }

  async setActive(staff: AuthContext, id: string, active: boolean, reason: string, ctx: RequestContext) {
    if (id === staff.userId && !active) throw conflict('SELF_DEACTIVATION', 'Vous ne pouvez pas désactiver votre propre compte.');
    await this.db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext('staff_roles'))`.execute(trx);
      const res = await trx.updateTable('staff_accounts').set({ is_active: active }).where('user_id', '=', id).executeTakeFirst();
      if (Number(res.numUpdatedRows) === 0) throw notFound();
      await this.ensureSuperAdminLeft(trx);
      await this.audit.log({ actorId: staff.userId, actorRole: role(staff), action: active ? 'staff.reactivated' : 'staff.deactivated', targetType: 'user',
                             targetId: id, reason, ctx }, trx);
    });
    if (!active) await this.sessions.revokeAllForUser(id, 'ACCOUNT_SUSPENDED');
    return (await this.list()).data.find((s) => s.id === id)!;
  }

  private async ensureSuperAdminLeft(trx: Transaction<Database>) {
    const row = await trx
      .selectFrom('staff_role_assignments')
      .innerJoin('staff_accounts', 'staff_accounts.user_id', 'staff_role_assignments.user_id')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('staff_role_assignments.role_code', '=', 'SUPER_ADMIN')
      .where('staff_accounts.is_active', '=', true)
      .executeTakeFirstOrThrow();
    if (Number(row.n) === 0) throw conflict('LAST_SUPER_ADMIN', 'Il doit rester au moins un super administrateur actif.');
  }
}
