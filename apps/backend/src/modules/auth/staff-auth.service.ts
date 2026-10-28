import { HttpStatus, Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { ApiError } from '../../common/api-error';
import { ENV, type Env } from '../../config/env';
import { DB, type Db } from '../../database/database.module';
import { AuditService, type RequestContext } from '../../infra/audit.service';
import { rateLimited, RateLimitService } from '../../infra/rate-limit.service';
import { decryptSecret } from './crypto';
import { hashPassword, verifyPassword } from './password';
import { SessionsService, type TokenPair } from './sessions.service';
import { verifyTotp } from './totp';

export interface StaffView {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  roles: string[];
  permissions: string[];
}

const invalidCredentials = () =>
  new ApiError(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Identifiants ou code de vérification incorrects.');

/** Connexion du personnel : e-mail + mot de passe (Argon2id) + code TOTP, sans indiquer lequel est faux. */
@Injectable()
export class StaffAuthService implements OnModuleInit {
  private dummyHash = '';

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly sessions: SessionsService,
    private readonly rateLimit: RateLimitService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Empreinte factice : un e-mail inconnu coûte le même temps qu'un mot de passe faux.
    this.dummyHash = await hashPassword(randomBytes(16).toString('hex'));
  }

  async login(email: string, password: string, totp: string, ctx: RequestContext): Promise<TokenPair & { staff: StaffView }> {
    const normalized = email.trim().toLowerCase();
    const failures = { key: `staff-login-fail:${normalized}`, limit: 5, windowS: 15 * 60 };
    if (ctx.ip) {
      await this.rateLimit.consumeOrThrow([{ key: `staff-login-ip:${ctx.ip}`, limit: 20, windowS: 15 * 60 }]);
    }
    const already = await this.rateLimit.peek(failures);
    if (!already.allowed) throw rateLimited(already.retryAfterS, 'Trop de tentatives. Compte bloqué temporairement.');

    const account = await this.db
      .selectFrom('staff_accounts')
      .innerJoin('users', 'users.id', 'staff_accounts.user_id')
      .select(['users.id', 'users.status', 'staff_accounts.password_hash', 'staff_accounts.totp_secret_enc',
               'staff_accounts.totp_last_step', 'staff_accounts.is_active'])
      .where('users.email', '=', normalized)
      .executeTakeFirst();

    const passwordOk = await verifyPassword(account?.password_hash ?? this.dummyHash, password);
    let step: number | null = null;
    if (account && passwordOk) {
      const secret = decryptSecret(account.totp_secret_enc, this.env.STAFF_TOTP_ENCRYPTION_KEY);
      step = verifyTotp(secret, totp, account.totp_last_step);
    }
    if (!account || !passwordOk || step === null || !account.is_active || account.status !== 'ACTIVE') {
      await this.rateLimit.hit(failures);
      await this.audit.log({ actorId: account?.id ?? null, action: 'staff.login_failed', targetType: 'user',
                             targetId: account?.id ?? null, ctx });
      throw invalidCredentials();
    }

    const tokens = await this.db.transaction().execute(async (trx) => {
      // Anti-rejeu : le pas TOTP ne peut que croître (verrou de ligne contre deux connexions simultanées).
      const updated = await trx
        .updateTable('staff_accounts')
        .set({ totp_last_step: step, last_login_at: new Date() })
        .where('user_id', '=', account.id)
        .where((eb) => eb.or([eb('totp_last_step', 'is', null), eb('totp_last_step', '<', step)]))
        .executeTakeFirst();
      if (Number(updated.numUpdatedRows) !== 1) throw invalidCredentials();
      const pair = await this.sessions.create(account.id, 'STAFF', 'Administration', ctx, trx);
      await this.audit.log({ actorId: account.id, action: 'staff.login', targetType: 'user', targetId: account.id, ctx }, trx);
      return pair;
    });
    await this.rateLimit.reset(failures);
    return { ...tokens, staff: await this.view(account.id) };
  }

  async view(userId: string): Promise<StaffView> {
    const user = await this.db
      .selectFrom('users')
      .select(['id', 'email', 'first_name', 'last_name'])
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    const roles = await this.db
      .selectFrom('staff_role_assignments')
      .innerJoin('staff_roles', 'staff_roles.code', 'staff_role_assignments.role_code')
      .select(['staff_roles.code', 'staff_roles.permissions'])
      .where('staff_role_assignments.user_id', '=', userId)
      .orderBy('staff_roles.code')
      .execute();
    return {
      id: user.id,
      email: user.email ?? '',
      firstName: user.first_name,
      lastName: user.last_name,
      roles: roles.map((r) => r.code),
      permissions: [...new Set(roles.flatMap((r) => r.permissions))].sort(),
    };
  }
}
