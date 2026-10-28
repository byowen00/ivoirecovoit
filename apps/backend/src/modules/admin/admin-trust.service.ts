import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { ApiError } from '../../common/api-error';
import { uuidv7 } from '../../common/ids';
import { DB, type Db } from '../../database/database.module';
import type { DisputeDecision, DisputeStatus, ReportStatus } from '../../database/types';
import { AuditService, type RequestContext } from '../../infra/audit.service';
import type { AuthContext } from '../auth/request-context';
import { outbox } from '../bookings/lifecycle';
import { OPEN_DISPUTE, REASON_LABEL } from '../trust/disputes.service';
import { ReviewsService } from '../trust/reviews.service';
import { AdminFinanceService } from './admin-finance.service';

const notFound = (what: string) => new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} introuvable.`);
const conflict = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, code, message);
const role = (a: AuthContext) => a.roles.join(',');

/**
 * Réclamations, signalements et modération (EF-95, parcours 4.3) : file, assignation, statut, historique, décision.
 * Une décision de remboursement passe par les mêmes plafonds et la même double validation que tout remboursement.
 */
@Injectable()
export class AdminTrustService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly finance: AdminFinanceService,
    private readonly reviews: ReviewsService,
  ) {}

  // ------------------------------------------------------------------ réclamations

  async disputes(q: { status?: DisputeStatus; open?: boolean; assignedTo?: string; cursor?: string; limit: number }) {
    let query = this.db
      .selectFrom('disputes')
      .innerJoin('bookings', 'bookings.id', 'disputes.booking_id')
      .leftJoin('users as a', 'a.id', 'disputes.assigned_to')
      .select(['disputes.id', 'disputes.reference', 'disputes.status', 'disputes.reason_code', 'disputes.created_at', 'disputes.response_deadline',
               'disputes.assigned_to', 'a.display_name as assigned_name', 'bookings.reference as booking_reference', 'bookings.total_xof'])
      .orderBy('disputes.id', 'desc')
      .limit(q.limit + 1);
    if (q.status) query = query.where('disputes.status', '=', q.status);
    if (q.open) query = query.where('disputes.status', 'in', OPEN_DISPUTE);
    if (q.assignedTo) query = query.where('disputes.assigned_to', '=', q.assignedTo);
    if (q.cursor) query = query.where('disputes.id', '<', q.cursor);
    const rows = await query.execute();
    const page = rows.slice(0, q.limit);
    return {
      data: page.map((d) => ({
        id: d.id, reference: d.reference, status: d.status, reasonCode: d.reason_code, reasonLabel: REASON_LABEL[d.reason_code], createdAt: d.created_at,
        responseDeadline: d.response_deadline, assignedTo: d.assigned_to ? { id: d.assigned_to, displayName: d.assigned_name } : null,
        bookingReference: d.booking_reference, totalXof: d.total_xof,
      })),
      nextCursor: rows.length > q.limit ? page.at(-1)!.id : null,
    };
  }

  async dispute(staff: AuthContext, id: string, ctx: RequestContext) {
    const d = await this.db
      .selectFrom('disputes')
      .innerJoin('bookings', 'bookings.id', 'disputes.booking_id')
      .innerJoin('trips', 'trips.id', 'bookings.trip_id')
      .innerJoin('users as p', 'p.id', 'bookings.passenger_id')
      .innerJoin('users as dr', 'dr.id', 'trips.driver_id')
      .leftJoin('users as a', 'a.id', 'disputes.assigned_to')
      .selectAll('disputes')
      .select(['bookings.reference as booking_reference', 'bookings.passenger_id', 'bookings.status as booking_status', 'bookings.payment_status', 'bookings.total_xof',
               'trips.driver_id', 'bookings.trip_id', 'trips.status as trip_status', 'trips.departure_at', 'trips.started_at', 'trips.completed_at', 'p.display_name as passenger_name',
               'dr.display_name as driver_name', 'a.display_name as assigned_name'])
      .where('disputes.id', '=', id)
      .executeTakeFirst();
    if (!d) throw notFound('Réclamation');
    const [messages, conversation] = await Promise.all([
      this.db
        .selectFrom('dispute_messages')
        .innerJoin('users as u', 'u.id', 'dispute_messages.author_id')
        .select(['dispute_messages.id', 'dispute_messages.author_id', 'dispute_messages.body', 'dispute_messages.is_internal', 'dispute_messages.created_at', 'u.display_name'])
        .where('dispute_id', '=', id)
        .orderBy('dispute_messages.id')
        .execute(),
      this.db
        .selectFrom('messages')
        .innerJoin('conversations', 'conversations.id', 'messages.conversation_id')
        .select(['messages.id', 'messages.sender_id', 'messages.body', 'messages.was_redacted', 'messages.hidden_at', 'messages.created_at'])
        .where('conversations.booking_id', '=', d.booking_id)
        .orderBy('messages.id')
        .limit(500)
        .execute(),
    ]);
    // Lire la conversation privée des parties est un accès à justifier : il est journalisé.
    await this.audit.log({ actorId: staff.userId, actorRole: role(staff), action: 'dispute.viewed', targetType: 'dispute', targetId: id, ctx });
    const who = (uid: string) => (uid === d.passenger_id ? 'PASSENGER' : uid === d.driver_id ? 'DRIVER' : 'STAFF');
    return {
      id: d.id,
      reference: d.reference,
      status: d.status,
      reasonCode: d.reason_code,
      reasonLabel: REASON_LABEL[d.reason_code],
      description: d.description,
      openedBy: who(d.opened_by),
      responseDeadline: d.response_deadline,
      assignedTo: d.assigned_to ? { id: d.assigned_to, displayName: d.assigned_name } : null,
      decision: d.decision,
      decisionNote: d.decision_note,
      decidedRefundXof: d.decided_refund_xof,
      refundId: d.refund_id,
      resolvedAt: d.resolved_at,
      createdAt: d.created_at,
      booking: {
        id: d.booking_id, reference: d.booking_reference, status: d.booking_status, paymentStatus: d.payment_status, totalXof: d.total_xof,
        passenger: { id: d.passenger_id, displayName: d.passenger_name }, driver: { id: d.driver_id, displayName: d.driver_name },
        trip: { id: d.trip_id, status: d.trip_status, departureAt: d.departure_at, startedAt: d.started_at, completedAt: d.completed_at },
      },
      messages: messages.map((m) => ({ id: m.id, from: who(m.author_id), author: m.display_name, body: m.body, internal: m.is_internal, createdAt: m.created_at })),
      conversation: conversation.map((m) => ({ id: m.id, from: who(m.sender_id), body: m.body, wasRedacted: m.was_redacted, hidden: m.hidden_at !== null, createdAt: m.created_at })),
      canDecide: (OPEN_DISPUTE as readonly string[]).includes(d.status),
    };
  }

  async updateDispute(staff: AuthContext, id: string, input: { assignToMe?: boolean; unassign?: boolean; status?: 'IN_REVIEW' | 'CLOSED' }, ctx: RequestContext) {
    await this.db.transaction().execute(async (trx) => {
      const d = await trx.selectFrom('disputes').select(['id', 'status']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!d) throw notFound('Réclamation');
      if (!(OPEN_DISPUTE as readonly string[]).includes(d.status)) throw conflict('DISPUTE_CLOSED', 'Cette réclamation est close.');
      const set: { assigned_to?: string | null; status?: DisputeStatus; resolved_at?: Date } = {};
      if (input.assignToMe) set.assigned_to = staff.userId;
      if (input.unassign) set.assigned_to = null;
      if (input.status) set.status = input.status;
      if (input.status === 'CLOSED') set.resolved_at = new Date();
      if (Object.keys(set).length === 0) return;
      await trx.updateTable('disputes').set(set).where('id', '=', id).execute();
      await this.audit.log({ actorId: staff.userId, actorRole: role(staff), action: 'dispute.updated', targetType: 'dispute', targetId: id, changes: { ...set }, ctx }, trx);
    });
    return this.dispute(staff, id, ctx);
  }

  async disputeMessage(staff: AuthContext, id: string, input: { body: string; internal: boolean }, ctx: RequestContext) {
    await this.db.transaction().execute(async (trx) => {
      const d = await trx.selectFrom('disputes').select(['id', 'status']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!d) throw notFound('Réclamation');
      await trx.insertInto('dispute_messages').values({ id: uuidv7(), dispute_id: id, author_id: staff.userId, body: input.body.trim(), is_internal: input.internal }).execute();
      if (!input.internal) await outbox(trx, 'dispute', id, 'dispute.message', { authorId: staff.userId, fromStaff: true });
      await this.audit.log({ actorId: staff.userId, actorRole: role(staff), action: input.internal ? 'dispute.note' : 'dispute.reply', targetType: 'dispute', targetId: id, ctx }, trx);
    });
    return this.dispute(staff, id, ctx);
  }

  /**
   * Décision (parcours 4.3) : aucun remboursement, partiel, total, ou pénalité du conducteur (décision enregistrée,
   * sans sanction automatique : la suspension éventuelle se décide sur la fiche du compte). Un remboursement
   * au-delà du plafond reste en attente de validation.
   */
  async decide(staff: AuthContext, id: string, input: { decision: DisputeDecision | 'REJECT'; refundXof?: number; note: string }, ctx: RequestContext) {
    const d = await this.db
      .selectFrom('disputes')
      .innerJoin('bookings', 'bookings.id', 'disputes.booking_id')
      .select(['disputes.id', 'disputes.status', 'disputes.booking_id', 'bookings.total_xof', 'bookings.payment_status'])
      .where('disputes.id', '=', id)
      .executeTakeFirst();
    if (!d) throw notFound('Réclamation');
    if (!(OPEN_DISPUTE as readonly string[]).includes(d.status)) throw conflict('DISPUTE_CLOSED', 'Cette réclamation est déjà close.');
    let refund: { refundId: string; status: string } | null = null;
    let amount: number | null = null;
    if (input.decision === 'PARTIAL_REFUND' || input.decision === 'FULL_REFUND') {
      amount = input.decision === 'FULL_REFUND' ? d.total_xof : input.refundXof!;
      if (input.decision === 'PARTIAL_REFUND' && (!amount || amount >= d.total_xof)) {
        throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Certains champs sont invalides.', { fields: { refundXof: `Montant partiel entre 1 et ${d.total_xof - 1} F CFA.` } });
      }
      refund = await this.finance.requestRefund(staff, { bookingId: d.booking_id, amountXof: amount, reasonCode: 'DISPUTE', note: `Réclamation : ${input.note}`.slice(0, 500) }, ctx);
    }
    await this.db.transaction().execute(async (trx) => {
      const rejected = input.decision === 'REJECT';
      const r = await trx
        .updateTable('disputes')
        .set({
          status: rejected ? 'REJECTED' : 'RESOLVED',
          decision: rejected ? null : input.decision as DisputeDecision,
          decision_note: input.note,
          decided_by: staff.userId,
          decided_refund_xof: amount,
          refund_id: refund?.refundId ?? null,
          resolved_at: new Date(),
        })
        .where('id', '=', id)
        .where('status', 'in', OPEN_DISPUTE)
        .executeTakeFirst();
      if (Number(r.numUpdatedRows) === 0) throw conflict('DISPUTE_CLOSED', 'Cette réclamation vient d’être close.');
      await outbox(trx, 'dispute', id, rejected ? 'dispute.rejected' : 'dispute.decided', {});
      await this.audit.log({ actorId: staff.userId, actorRole: role(staff), action: 'dispute.decided', targetType: 'dispute', targetId: id, reason: input.note,
                             changes: { decision: input.decision, refundXof: amount, refundStatus: refund?.status ?? null }, ctx }, trx);
    });
    return { ...(await this.dispute(staff, id, ctx)), refund };
  }

  // ------------------------------------------------------------------ signalements

  async reports(q: { status?: ReportStatus; open?: boolean; severity?: string; cursor?: string; limit: number }) {
    let query = this.db
      .selectFrom('reports')
      .innerJoin('users as r', 'r.id', 'reports.reporter_id')
      .leftJoin('users as a', 'a.id', 'reports.assigned_to')
      .select(['reports.id', 'reports.target_type', 'reports.target_id', 'reports.category', 'reports.severity', 'reports.status', 'reports.created_at',
               'reports.assigned_to', 'r.display_name as reporter_name', 'a.display_name as assigned_name'])
      // Les plus graves d'abord, puis les plus anciens.
      .orderBy(sql`CASE reports.severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END`)
      .orderBy('reports.id')
      .limit(q.limit + 1);
    if (q.status) query = query.where('reports.status', '=', q.status);
    if (q.open) query = query.where('reports.status', 'in', ['OPEN', 'IN_REVIEW']);
    if (q.severity) query = query.where('reports.severity', '=', q.severity as never);
    if (q.cursor) query = query.where('reports.id', '>', q.cursor);
    const rows = await query.execute();
    const page = rows.slice(0, q.limit);
    return {
      data: page.map((r) => ({
        id: r.id, targetType: r.target_type, targetId: r.target_id, category: r.category, severity: r.severity, status: r.status, createdAt: r.created_at,
        reporterName: r.reporter_name, assignedTo: r.assigned_to ? { id: r.assigned_to, displayName: r.assigned_name } : null,
      })),
      nextCursor: rows.length > q.limit ? page.at(-1)!.id : null,
    };
  }

  async report(id: string) {
    const r = await this.db
      .selectFrom('reports')
      .innerJoin('users as rp', 'rp.id', 'reports.reporter_id')
      .selectAll('reports')
      .select('rp.display_name as reporter_name')
      .where('reports.id', '=', id)
      .executeTakeFirst();
    if (!r) throw notFound('Signalement');
    let target: Record<string, unknown> = {};
    if (r.target_type === 'MESSAGE') {
      const m = await this.db.selectFrom('messages').select(['body', 'sender_id', 'created_at', 'hidden_at']).where('id', '=', r.target_id).executeTakeFirst();
      target = m ? { body: m.body, senderId: m.sender_id, createdAt: m.created_at, hidden: m.hidden_at !== null } : {};
    } else if (r.target_type === 'REVIEW') {
      const v = await this.db.selectFrom('reviews').select(['rating', 'comment', 'author_id', 'subject_id', 'hidden_at']).where('id', '=', r.target_id).executeTakeFirst();
      target = v ? { rating: v.rating, comment: v.comment, authorId: v.author_id, subjectId: v.subject_id, hidden: v.hidden_at !== null } : {};
    } else if (r.target_type === 'USER') {
      const u = await this.db.selectFrom('users').select(['display_name', 'status']).where('id', '=', r.target_id).executeTakeFirst();
      target = u ? { displayName: u.display_name, status: u.status } : {};
    } else if (r.target_type === 'TRIP') {
      const t = await this.db.selectFrom('trips').select(['public_ref', 'status', 'driver_id']).where('id', '=', r.target_id).executeTakeFirst();
      target = t ? { publicRef: t.public_ref, status: t.status, driverId: t.driver_id } : {};
    }
    return {
      id: r.id, targetType: r.target_type, targetId: r.target_id, target, bookingId: r.booking_id, category: r.category, severity: r.severity, description: r.description,
      status: r.status, resolution: r.resolution, assignedTo: r.assigned_to, reporter: { id: r.reporter_id, displayName: r.reporter_name }, createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }

  async updateReport(staff: AuthContext, id: string, input: { status?: ReportStatus; resolution?: string; assignToMe?: boolean }, ctx: RequestContext) {
    if ((input.status === 'ACTION_TAKEN' || input.status === 'DISMISSED') && !input.resolution) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Certains champs sont invalides.', { fields: { resolution: 'Indiquez ce qui a été décidé.' } });
    }
    const r = await this.db
      .updateTable('reports')
      .set({
        ...(input.status ? { status: input.status } : {}),
        ...(input.resolution ? { resolution: input.resolution } : {}),
        ...(input.assignToMe ? { assigned_to: staff.userId } : {}),
      })
      .where('id', '=', id)
      .returning('id')
      .executeTakeFirst();
    if (!r) throw notFound('Signalement');
    await this.audit.log({ actorId: staff.userId, actorRole: role(staff), action: 'report.updated', targetType: 'report', targetId: id, reason: input.resolution ?? null, changes: { status: input.status ?? null }, ctx });
    return this.report(id);
  }

  // ------------------------------------------------------------------ modération des avis et messages

  async setReviewHidden(staff: AuthContext, id: string, hidden: boolean, reason: string, ctx: RequestContext) {
    await this.db.transaction().execute(async (trx) => {
      const v = await trx
        .updateTable('reviews')
        .set(hidden ? { hidden_at: new Date(), hidden_reason: reason, hidden_by: staff.userId } : { hidden_at: null, hidden_reason: null, hidden_by: null })
        .where('id', '=', id)
        .returning(['subject_id', 'direction'])
        .executeTakeFirst();
      if (!v) throw notFound('Avis');
      await this.reviews.refreshRating(trx, v.subject_id, v.direction);
      await this.audit.log({ actorId: staff.userId, actorRole: role(staff), action: hidden ? 'review.hidden' : 'review.restored', targetType: 'review', targetId: id, reason, ctx }, trx);
    });
    return { id, hidden };
  }

  async hideMessage(staff: AuthContext, id: string, reason: string, ctx: RequestContext) {
    const m = await this.db.updateTable('messages').set({ hidden_at: new Date(), hidden_by: staff.userId }).where('id', '=', id).returning('id').executeTakeFirst();
    if (!m) throw notFound('Message');
    await this.audit.log({ actorId: staff.userId, actorRole: role(staff), action: 'message.hidden', targetType: 'message', targetId: id, reason, ctx });
    return { id, hidden: true };
  }
}
