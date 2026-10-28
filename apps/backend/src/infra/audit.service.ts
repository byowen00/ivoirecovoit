import { Inject, Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import { DB, type Db } from '../database/database.module';
import type { Database } from '../database/types';

export interface RequestContext {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface AuditEntry {
  actorId: string | null;
  actorRole?: string | null;
  action: string;
  targetType?: string;
  targetId?: string | null;
  reason?: string | null;
  /** Noms de champs ou valeurs non sensibles uniquement : jamais de téléphone, code ni secret en clair. */
  changes?: Record<string, unknown>;
  ctx?: RequestContext;
}

/** Journal d'audit en ajout seul (un trigger SQL refuse UPDATE et DELETE). */
@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async log(entry: AuditEntry, trx?: Transaction<Database>): Promise<void> {
    await (trx ?? this.db)
      .insertInto('audit_logs')
      .values({
        actor_id: entry.actorId,
        actor_role: entry.actorRole ?? null,
        action: entry.action,
        target_type: entry.targetType ?? null,
        target_id: entry.targetId ?? null,
        reason: entry.reason ?? null,
        changes: entry.changes ? JSON.stringify(entry.changes) : null,
        ip: entry.ctx?.ip ?? null,
        user_agent: entry.ctx?.userAgent?.slice(0, 300) ?? null,
        request_id: entry.ctx?.requestId ?? null,
      })
      .execute();
  }
}
