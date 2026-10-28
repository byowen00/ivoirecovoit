import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { ApiError } from '../../common/api-error';
import { disputeReference, uuidv7 } from '../../common/ids';
import { DB, type Db } from '../../database/database.module';
import type { DisputeReason } from '../../database/types';
import { outbox } from '../bookings/lifecycle';
import { SettingsService } from '../users/settings.service';
import { conflict, participantBooking, tripEnd, unprocessable } from './access';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const disputeNotFound = () => new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Réclamation introuvable.');
export const OPEN_DISPUTE = ['OPEN', 'AWAITING_RESPONSE', 'IN_REVIEW'] as const;
const DISPUTABLE = ['CONFIRMED', 'COMPLETED', 'NO_SHOW', 'CANCELLED_BY_PASSENGER', 'CANCELLED_BY_DRIVER', 'CANCELLED_BY_ADMIN'];

export const REASON_LABEL: Record<DisputeReason, string> = {
  DRIVER_NO_SHOW: 'Conducteur absent',
  PASSENGER_NO_SHOW: 'Passager absent',
  TRIP_NOT_DONE: 'Trajet non effectué',
  LATE: 'Retard important',
  AMOUNT: 'Montant contesté',
  OTHER: 'Autre problème',
};

/**
 * Réclamations liées à une réservation (EF-72) : ouverture par une partie dans les 7 jours suivant la fin du trajet,
 * réponse de l'autre partie (48 h par défaut), puis décision du support. Tant qu'une réclamation est ouverte,
 * la part du conducteur reste bloquée (elle ne devient pas disponible).
 */
@Injectable()
export class DisputesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly settings: SettingsService,
  ) {}

  async eligibility(userId: string, bookingId: string) {
    const b = await participantBooking(this.db, userId, bookingId);
    const days = (await this.settings.get<number>('disputes.window_days')) ?? 7;
    const deadline = new Date(tripEnd(b).getTime() + days * DAY);
    const open = await this.db.selectFrom('disputes').select(['id', 'reference']).where('booking_id', '=', bookingId).where('status', 'in', OPEN_DISPUTE).executeTakeFirst();
    const started = Date.now() >= b.departure_at.getTime() || b.status.startsWith('CANCELLED');
    const allowed = DISPUTABLE.includes(b.status) && started && Date.now() <= deadline.getTime() && !open;
    const reasons: DisputeReason[] = b.role === 'PASSENGER' ? ['DRIVER_NO_SHOW', 'TRIP_NOT_DONE', 'LATE', 'AMOUNT', 'OTHER'] : ['PASSENGER_NO_SHOW', 'AMOUNT', 'OTHER'];
    return { b, allowed, deadline, open: open ?? null, reasons };
  }

  async create(userId: string, input: { bookingId: string; reasonCode: DisputeReason; description: string }) {
    const e = await this.eligibility(userId, input.bookingId);
    if (e.open) throw conflict('DISPUTE_ALREADY_OPEN', 'Une réclamation est déjà ouverte pour cette réservation.', { disputeId: e.open.id });
    if (!e.allowed) {
      throw unprocessable('DISPUTE_NOT_ALLOWED', Date.now() > e.deadline.getTime()
        ? 'Le délai pour ouvrir une réclamation sur ce trajet est passé.'
        : 'Une réclamation est possible à partir du départ du trajet, ou après une annulation.');
    }
    if (!e.reasons.includes(input.reasonCode)) throw unprocessable('DISPUTE_REASON_INVALID', 'Ce motif ne correspond pas à votre rôle sur ce trajet.');
    const hours = (await this.settings.get<number>('disputes.response_hours')) ?? 48;
    const id = uuidv7();
    try {
      await this.db.transaction().execute(async (trx) => {
        await trx
          .insertInto('disputes')
          .values({
            id,
            reference: disputeReference(),
            booking_id: input.bookingId,
            opened_by: userId,
            respondent_id: e.b.otherId,
            reason_code: input.reasonCode,
            description: input.description.trim(),
            status: 'AWAITING_RESPONSE',
            response_deadline: new Date(Date.now() + hours * HOUR),
          })
          .execute();
        // Gains devenus disponibles mais pas encore versés : de nouveau bloqués pendant la réclamation.
        await trx.updateTable('commissions').set({ status: 'PENDING', payable_at: null }).where('booking_id', '=', input.bookingId).where('status', '=', 'PAYABLE').execute();
        await outbox(trx, 'dispute', id, 'dispute.opened', {});
      });
    } catch (err) {
      if ((err as { constraint?: string }).constraint === 'disputes_one_open_per_booking') {
        throw conflict('DISPUTE_ALREADY_OPEN', 'Une réclamation est déjà ouverte pour cette réservation.');
      }
      throw err;
    }
    return this.get(userId, id);
  }

  private async accessible(userId: string, disputeId: string) {
    const d = await this.db
      .selectFrom('disputes')
      .innerJoin('bookings', 'bookings.id', 'disputes.booking_id')
      .innerJoin('trips', 'trips.id', 'bookings.trip_id')
      .selectAll('disputes')
      .select(['bookings.reference as booking_reference', 'bookings.passenger_id', 'trips.driver_id',
               sql<string>`(SELECT label FROM trip_stops s WHERE s.id = bookings.pickup_stop_id)`.as('pickup'),
               sql<string>`(SELECT label FROM trip_stops s WHERE s.id = bookings.dropoff_stop_id)`.as('dropoff'),
               'trips.departure_at'])
      .where('disputes.id', '=', disputeId)
      .executeTakeFirst();
    if (!d || (d.passenger_id !== userId && d.driver_id !== userId)) throw disputeNotFound();
    return d;
  }

  async get(userId: string, disputeId: string) {
    const d = await this.accessible(userId, disputeId);
    const messages = await this.db
      .selectFrom('dispute_messages')
      .select(['id', 'author_id', 'body', 'created_at'])
      .where('dispute_id', '=', disputeId)
      .where('is_internal', '=', false)
      .orderBy('id')
      .execute();
    const party = (id: string) => (id === userId ? 'ME' : id === d.passenger_id ? 'PASSENGER' : id === d.driver_id ? 'DRIVER' : 'SUPPORT');
    return {
      id: d.id,
      reference: d.reference,
      bookingId: d.booking_id,
      bookingReference: d.booking_reference,
      route: `${d.pickup} → ${d.dropoff}`,
      departureAt: d.departure_at,
      reasonCode: d.reason_code,
      reasonLabel: REASON_LABEL[d.reason_code],
      description: d.description,
      status: d.status,
      openedByMe: d.opened_by === userId,
      responseDeadline: d.response_deadline,
      decision: d.decision,
      decisionNote: d.decision_note,
      decidedRefundXof: d.decided_refund_xof,
      resolvedAt: d.resolved_at,
      createdAt: d.created_at,
      canReply: (OPEN_DISPUTE as readonly string[]).includes(d.status),
      messages: messages.map((m) => ({ id: m.id, from: party(m.author_id), body: m.body, createdAt: m.created_at })),
    };
  }

  async mine(userId: string) {
    const rows = await this.db
      .selectFrom('disputes')
      .innerJoin('bookings', 'bookings.id', 'disputes.booking_id')
      .innerJoin('trips', 'trips.id', 'bookings.trip_id')
      .select(['disputes.id', 'disputes.reference', 'disputes.status', 'disputes.reason_code', 'disputes.created_at', 'disputes.opened_by',
               'bookings.reference as booking_reference', 'bookings.id as booking_id'])
      .where((eb) => eb.or([eb('bookings.passenger_id', '=', userId), eb('trips.driver_id', '=', userId)]))
      .orderBy('disputes.id', 'desc')
      .limit(50)
      .execute();
    return {
      data: rows.map((r) => ({
        id: r.id, reference: r.reference, status: r.status, reasonCode: r.reason_code, reasonLabel: REASON_LABEL[r.reason_code],
        openedByMe: r.opened_by === userId, bookingId: r.booking_id, bookingReference: r.booking_reference, createdAt: r.created_at,
      })),
    };
  }

  async reply(userId: string, disputeId: string, body: string) {
    await this.db.transaction().execute(async (trx) => {
      const d = await trx.selectFrom('disputes').select(['id', 'status', 'respondent_id']).where('id', '=', disputeId).forUpdate().executeTakeFirst();
      await this.accessible(userId, disputeId);
      if (!d || !(OPEN_DISPUTE as readonly string[]).includes(d.status)) throw conflict('DISPUTE_CLOSED', 'Cette réclamation est close.');
      await trx.insertInto('dispute_messages').values({ id: uuidv7(), dispute_id: disputeId, author_id: userId, body: body.trim() }).execute();
      // L'autre partie a donné sa version : le dossier passe à l'examen du support.
      if (d.status === 'AWAITING_RESPONSE' && d.respondent_id === userId) {
        await trx.updateTable('disputes').set({ status: 'IN_REVIEW' }).where('id', '=', disputeId).execute();
      }
      await outbox(trx, 'dispute', disputeId, 'dispute.message', { authorId: userId, fromStaff: false });
    });
    return this.get(userId, disputeId);
  }

  /** Tâche : sans réponse dans le délai, le dossier passe quand même à l'examen. */
  async escalateOverdue(now: Date = new Date()): Promise<number> {
    const r = await this.db.updateTable('disputes').set({ status: 'IN_REVIEW' }).where('status', '=', 'AWAITING_RESPONSE').where('response_deadline', '<=', now).executeTakeFirst();
    return Number(r.numUpdatedRows);
  }
}
