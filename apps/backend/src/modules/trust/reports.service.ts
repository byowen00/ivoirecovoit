import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../../common/api-error';
import { uuidv7 } from '../../common/ids';
import { DB, type Db } from '../../database/database.module';
import type { ReportCategory, ReportSeverity, ReportTarget } from '../../database/types';
import { RateLimitService } from '../../infra/rate-limit.service';
import { outbox } from '../bookings/lifecycle';
import { SettingsService } from '../users/settings.service';
import { unprocessable } from './access';

/** Catégories graves : priorité haute et alerte au tableau de bord de l'administration (EF-71). */
export const SEVERITY: Record<ReportCategory, ReportSeverity> = {
  DANGEROUS_DRIVING: 'HIGH',
  HARASSMENT: 'HIGH',
  FRAUD: 'HIGH',
  NO_SHOW: 'MEDIUM',
  INAPPROPRIATE: 'MEDIUM',
  OTHER: 'LOW',
};

const targetNotFound = () => new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Élément signalé introuvable.');

export interface ReportInput {
  targetType: ReportTarget;
  targetId: string;
  bookingId?: string;
  category: ReportCategory;
  description: string;
}

/**
 * Signalement d'un utilisateur, d'un trajet, d'un véhicule, d'un message ou d'un avis (EF-71). On ne peut signaler
 * un message que dans une conversation à laquelle on participe, et un avis que s'il est public ou nous concerne.
 */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly rateLimit: RateLimitService,
    private readonly settings: SettingsService,
  ) {}

  private async checkTarget(userId: string, t: ReportInput): Promise<void> {
    switch (t.targetType) {
      case 'USER': {
        if (t.targetId === userId) throw unprocessable('REPORT_SELF', 'Vous ne pouvez pas vous signaler vous-même.');
        const u = await this.db.selectFrom('users').select('id').where('id', '=', t.targetId).executeTakeFirst();
        if (!u) throw targetNotFound();
        return;
      }
      case 'TRIP': {
        const tr = await this.db.selectFrom('trips').select('id').where('id', '=', t.targetId).where('status', '<>', 'DRAFT').executeTakeFirst();
        if (!tr) throw targetNotFound();
        return;
      }
      case 'VEHICLE': {
        const v = await this.db.selectFrom('vehicles').select('id').where('id', '=', t.targetId).executeTakeFirst();
        if (!v) throw targetNotFound();
        return;
      }
      case 'MESSAGE': {
        const m = await this.db
          .selectFrom('messages')
          .innerJoin('conversations', 'conversations.id', 'messages.conversation_id')
          .innerJoin('bookings', 'bookings.id', 'conversations.booking_id')
          .innerJoin('trips', 'trips.id', 'bookings.trip_id')
          .select(['messages.sender_id', 'bookings.passenger_id', 'trips.driver_id'])
          .where('messages.id', '=', t.targetId)
          .executeTakeFirst();
        if (!m || (m.passenger_id !== userId && m.driver_id !== userId) || m.sender_id === userId) throw targetNotFound();
        return;
      }
      case 'REVIEW': {
        const r = await this.db.selectFrom('reviews').select(['subject_id', 'published_at']).where('id', '=', t.targetId).executeTakeFirst();
        if (!r || (!r.published_at && r.subject_id !== userId)) throw targetNotFound();
        return;
      }
    }
  }

  async create(userId: string, input: ReportInput) {
    const perDay = (await this.settings.get<number>('reports.max_per_day')) ?? 10;
    await this.rateLimit.consumeOrThrow([{ key: `reports:${userId}`, limit: perDay, windowS: 86_400 }], 'Vous avez envoyé beaucoup de signalements aujourd’hui. Réessayez demain ou contactez le support.');
    await this.checkTarget(userId, input);
    if (input.bookingId) {
      const b = await this.db
        .selectFrom('bookings')
        .innerJoin('trips', 'trips.id', 'bookings.trip_id')
        .select(['bookings.passenger_id', 'trips.driver_id'])
        .where('bookings.id', '=', input.bookingId)
        .executeTakeFirst();
      if (!b || (b.passenger_id !== userId && b.driver_id !== userId)) throw targetNotFound();
    }
    const id = uuidv7();
    const severity = SEVERITY[input.category];
    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('reports')
        .values({
          id,
          reporter_id: userId,
          target_type: input.targetType,
          target_id: input.targetId,
          booking_id: input.bookingId ?? null,
          category: input.category,
          severity,
          description: input.description.trim(),
        })
        .execute();
      await outbox(trx, 'report', id, severity === 'HIGH' || severity === 'CRITICAL' ? 'report.urgent' : 'report.created', { severity });
    });
    return { id, status: 'OPEN', severity, createdAt: new Date() };
  }

  async mine(userId: string) {
    const rows = await this.db
      .selectFrom('reports')
      .select(['id', 'target_type', 'category', 'status', 'created_at', 'updated_at'])
      .where('reporter_id', '=', userId)
      .orderBy('id', 'desc')
      .limit(50)
      .execute();
    // La décision détaillée et la personne visée par une sanction ne sont pas communiquées au signalant.
    return { data: rows.map((r) => ({ id: r.id, targetType: r.target_type, category: r.category, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at })) };
  }
}
