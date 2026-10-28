import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import { ApiError } from '../../common/api-error';
import { uuidv7 } from '../../common/ids';
import { ENV, type Env } from '../../config/env';
import { DB, type Db } from '../../database/database.module';
import type { Database, SessionKind } from '../../database/types';
import { AuditService, type RequestContext } from '../../infra/audit.service';
import { hmacSha256, randomToken } from './crypto';
import { ACCESS_TOKEN_TTL_S, TokenService } from './token.service';

const USER_SESSION_TTL_MS = 30 * 86_400_000; // glissant : prolongé à chaque renouvellement
const STAFF_SESSION_TTL_MS = 12 * 3_600_000; // absolu : le personnel se reconnecte chaque jour

export type RevokeReason =
  | 'LOGOUT'
  | 'LOGOUT_ALL'
  | 'REVOKED_BY_USER'
  | 'REUSE_DETECTED'
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNT_DELETED';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresInS: number;
  sessionId: string;
}

export interface SessionView {
  id: string;
  deviceLabel: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  current: boolean;
}

const sessionRevoked = () =>
  new ApiError(HttpStatus.UNAUTHORIZED, 'SESSION_REVOKED', 'Votre session a pris fin. Reconnectez-vous.');

/**
 * Sessions à refresh token opaque, stocké sous forme d'empreinte HMAC, renouvelé à chaque usage (rotation).
 * Présenter un refresh token déjà renouvelé révèle un vol probable : toute la famille de sessions est révoquée.
 */
@Injectable()
export class SessionsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  async create(
    userId: string,
    kind: SessionKind,
    deviceLabel: string | null,
    ctx: RequestContext,
    trx?: Transaction<Database>,
  ): Promise<TokenPair> {
    const refreshToken = randomToken();
    const id = uuidv7();
    const ttl = kind === 'STAFF' ? STAFF_SESSION_TTL_MS : USER_SESSION_TTL_MS;
    await (trx ?? this.db)
      .insertInto('sessions')
      .values({
        id,
        user_id: userId,
        kind,
        refresh_token_hash: this.hash(refreshToken),
        family_id: id,
        device_label: deviceLabel?.slice(0, 100) ?? null,
        ip_created: ctx.ip ?? null,
        user_agent: ctx.userAgent?.slice(0, 300) ?? null,
        expires_at: new Date(Date.now() + ttl),
        revoked_at: null,
        revoked_reason: null,
        replaced_by: null,
        last_used_at: new Date(),
      })
      .execute();
    return this.pair(userId, id, kind, refreshToken);
  }

  async refresh(refreshToken: string, ctx: RequestContext): Promise<TokenPair> {
    const hash = this.hash(refreshToken);
    const outcome = await this.db.transaction().execute(async (trx) => {
      const session = await trx
        .selectFrom('sessions')
        .innerJoin('users', 'users.id', 'sessions.user_id')
        .select([
          'sessions.id', 'sessions.user_id', 'sessions.kind', 'sessions.family_id', 'sessions.device_label',
          'sessions.expires_at', 'sessions.revoked_at', 'sessions.revoked_reason', 'sessions.ip_created',
          'sessions.user_agent', 'users.status', 'users.suspended_until',
        ])
        .where('sessions.refresh_token_hash', '=', hash)
        .forUpdate('sessions')
        .executeTakeFirst();
      if (!session) return { error: 'UNKNOWN' as const };

      if (session.revoked_at) {
        if (session.revoked_reason === 'ROTATED') {
          await this.revokeFamily(trx, session.family_id, 'REUSE_DETECTED');
          await this.audit.log(
            { actorId: null, action: 'auth.refresh_reuse_detected', targetType: 'user', targetId: session.user_id,
              changes: { familyId: session.family_id }, ctx },
            trx,
          );
          return { error: 'REUSE' as const };
        }
        return { error: 'REVOKED' as const };
      }
      if (session.expires_at.getTime() <= Date.now()) return { error: 'EXPIRED' as const };
      if (!isAllowedStatus(session.status, session.suspended_until)) {
        await this.revokeAllForUser(session.user_id, 'ACCOUNT_SUSPENDED', trx);
        return { error: 'SUSPENDED' as const };
      }

      const newToken = randomToken();
      const newId = uuidv7();
      const expiresAt =
        session.kind === 'STAFF' ? session.expires_at : new Date(Date.now() + USER_SESSION_TTL_MS);
      await trx
        .insertInto('sessions')
        .values({
          id: newId,
          user_id: session.user_id,
          kind: session.kind,
          refresh_token_hash: this.hash(newToken),
          family_id: session.family_id,
          device_label: session.device_label,
          ip_created: ctx.ip ?? session.ip_created,
          user_agent: ctx.userAgent?.slice(0, 300) ?? session.user_agent,
          expires_at: expiresAt,
          revoked_at: null,
          revoked_reason: null,
          replaced_by: null,
          last_used_at: new Date(),
        })
        .execute();
      await trx
        .updateTable('sessions')
        .set({ revoked_at: new Date(), revoked_reason: 'ROTATED', replaced_by: newId })
        .where('id', '=', session.id)
        .execute();
      return { userId: session.user_id, kind: session.kind, sessionId: newId, refreshToken: newToken };
    });

    if ('error' in outcome) {
      if (outcome.error === 'SUSPENDED') throw accountSuspended();
      throw sessionRevoked();
    }
    return this.pair(outcome.userId, outcome.sessionId, outcome.kind, outcome.refreshToken);
  }

  async listActive(userId: string, kind: SessionKind, currentFamilyOf: string): Promise<SessionView[]> {
    const current = await this.db
      .selectFrom('sessions')
      .select('family_id')
      .where('id', '=', currentFamilyOf)
      .executeTakeFirst();
    const rows = await this.db
      .selectFrom('sessions')
      .select(['id', 'family_id', 'device_label', 'created_at', 'last_used_at'])
      .where('user_id', '=', userId)
      .where('kind', '=', kind)
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', new Date())
      .orderBy('last_used_at', 'desc')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      deviceLabel: r.device_label,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
      current: r.family_id === current?.family_id,
    }));
  }

  /** Révoque une session active de l'utilisateur ; 404 si elle ne lui appartient pas (aucune fuite d'information). */
  async revokeOwned(userId: string, sessionId: string, reason: RevokeReason): Promise<void> {
    const session = await this.db
      .selectFrom('sessions')
      .select(['family_id'])
      .where('id', '=', sessionId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!session) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Session introuvable.');
    await this.revokeFamily(this.db, session.family_id, reason);
  }

  async revokeAllForUser(userId: string, reason: RevokeReason, trx?: Transaction<Database>): Promise<number> {
    const res = await (trx ?? this.db)
      .updateTable('sessions')
      .set({ revoked_at: new Date(), revoked_reason: reason })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    return Number(res.numUpdatedRows);
  }

  private async revokeFamily(db: Db | Transaction<Database>, familyId: string, reason: RevokeReason): Promise<void> {
    await db
      .updateTable('sessions')
      .set({ revoked_at: new Date(), revoked_reason: reason })
      .where('family_id', '=', familyId)
      .where('revoked_at', 'is', null)
      .execute();
  }

  private hash(token: string): Buffer {
    return hmacSha256(this.env.REFRESH_TOKEN_PEPPER, token);
  }

  private async pair(userId: string, sessionId: string, kind: SessionKind, refreshToken: string): Promise<TokenPair> {
    return {
      accessToken: await this.tokens.sign({ userId, sessionId, kind }),
      refreshToken,
      accessTokenExpiresInS: ACCESS_TOKEN_TTL_S,
      sessionId,
    };
  }
}

/** Un compte suspendu dont la date de fin est passée redevient utilisable. */
export function isAllowedStatus(status: string, suspendedUntil: Date | null, now = new Date()): boolean {
  if (status === 'ACTIVE' || status === 'PENDING_VERIFICATION') return true;
  return status === 'SUSPENDED' && suspendedUntil !== null && suspendedUntil.getTime() <= now.getTime();
}

export function accountSuspended(): ApiError {
  return new ApiError(
    HttpStatus.FORBIDDEN,
    'ACCOUNT_SUSPENDED',
    'Votre compte est suspendu. Contactez le support pour en savoir plus.',
  );
}
