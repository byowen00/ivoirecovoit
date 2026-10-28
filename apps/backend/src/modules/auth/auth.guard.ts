import { type CanActivate, type ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { sql } from 'kysely';
import { ApiError } from '../../common/api-error';
import { DB, type Db } from '../../database/database.module';
import { ALLOW_INCOMPLETE_PROFILE, hasPermission, IS_PUBLIC, OPTIONAL_AUTH, STAFF_PERMISSIONS } from './decorators';
import type { AppRequest, AuthContext } from './request-context';
import { accountSuspended, isAllowedStatus } from './sessions.service';
import { TokenService } from './token.service';

const unauthenticated = () => new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Authentification requise.');
const forbidden = () => new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', "Vous n'avez pas accès à cette ressource.");

/**
 * Garde globale. Pour chaque requête authentifiée : signature et expiration du jeton, puis état réel de la
 * session et du compte en base (une déconnexion ou une suspension prend effet immédiatement).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    @Inject(DB) private readonly db: Db,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const req = context.switchToHttp().getRequest<AppRequest>();
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) {
      if (this.reflector.getAllAndOverride<boolean>(OPTIONAL_AUTH, targets) && req.header('authorization')) {
        try {
          await this.authenticate(context, req);
        } catch {
          req.auth = undefined; // visiteur
        }
      }
      return true;
    }
    await this.authenticate(context, req);
    return true;
  }

  private async authenticate(context: ExecutionContext, req: AppRequest): Promise<void> {
    const targets = [context.getHandler(), context.getClass()];
    const header = req.header('authorization');
    const match = header?.match(/^Bearer ([A-Za-z0-9._-]+)$/);
    if (!match) throw unauthenticated();
    const claims = await this.tokens.verify(match[1]!);

    const staffPermissions = this.reflector.getAllAndOverride<string[] | undefined>(STAFF_PERMISSIONS, targets);
    const expectedKind = staffPermissions ? 'STAFF' : 'USER';
    if (claims.kind !== expectedKind) {
      if (staffPermissions) await this.logDenied(claims.userId, req, 'WRONG_ACCOUNT_KIND', staffPermissions);
      throw forbidden();
    }

    const row = await this.db
      .selectFrom('sessions')
      .innerJoin('users', 'users.id', 'sessions.user_id')
      .leftJoin('staff_accounts', 'staff_accounts.user_id', 'users.id')
      .select([
        'sessions.revoked_at', 'sessions.expires_at', 'users.status', 'users.suspended_until', 'users.first_name',
        'staff_accounts.is_active as staff_active',
        sql<string[]>`COALESCE((SELECT array_agg(DISTINCT p) FROM staff_role_assignments a
              JOIN staff_roles r ON r.code = a.role_code, unnest(r.permissions) p
             WHERE a.user_id = users.id), '{}')`.as('permissions'),
        sql<string[]>`COALESCE((SELECT array_agg(a.role_code ORDER BY a.role_code) FROM staff_role_assignments a
             WHERE a.user_id = users.id), '{}')`.as('roles'),
      ])
      .where('sessions.id', '=', claims.sessionId)
      .where('sessions.user_id', '=', claims.userId)
      .executeTakeFirst();

    if (!row || row.revoked_at || row.expires_at.getTime() <= Date.now()) {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'SESSION_REVOKED', 'Votre session a pris fin. Reconnectez-vous.');
    }
    if (!isAllowedStatus(row.status, row.suspended_until)) throw accountSuspended();

    const auth: AuthContext = {
      userId: claims.userId,
      sessionId: claims.sessionId,
      kind: claims.kind,
      status: row.status === 'SUSPENDED' ? (row.first_name ? 'ACTIVE' : 'PENDING_VERIFICATION') : row.status, // suspension échue
      permissions: new Set(claims.kind === 'STAFF' ? row.permissions : []),
      roles: claims.kind === 'STAFF' ? row.roles : [],
    };

    if (staffPermissions) {
      if (!row.staff_active) {
        await this.logDenied(claims.userId, req, 'STAFF_INACTIVE', staffPermissions);
        throw forbidden();
      }
      if (staffPermissions.length > 0 && !staffPermissions.some((p) => hasPermission(auth, p))) {
        await this.logDenied(claims.userId, req, 'MISSING_PERMISSION', staffPermissions);
        throw forbidden();
      }
    } else if (
      auth.status !== 'ACTIVE' &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_INCOMPLETE_PROFILE, targets)
    ) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'PROFILE_INCOMPLETE', 'Complétez votre profil pour continuer.');
    }

    req.auth = auth;
  }

  /** Chaque refus d'accès à l'administration est journalisé (doc 06, T6). */
  private async logDenied(actorId: string, req: AppRequest, why: string, required: string[]): Promise<void> {
    await this.db
      .insertInto('audit_logs')
      .values({
        actor_id: actorId,
        action: 'access.denied',
        target_type: 'route',
        reason: why,
        changes: JSON.stringify({ method: req.method, path: req.path.slice(0, 200), required }),
        ip: req.ip ?? null,
        user_agent: req.header('user-agent')?.slice(0, 300) ?? null,
        request_id: req.id ?? null,
      })
      .execute()
      .catch(() => undefined);
  }
}
