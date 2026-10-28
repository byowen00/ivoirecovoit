import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { ApiError } from '../../common/api-error';
import { uuidv7 } from '../../common/ids';
import { DB, type Db } from '../../database/database.module';
import { AuditService, type RequestContext } from '../../infra/audit.service';
import { StorageService } from '../../infra/storage.service';
import { hasPermission } from '../auth/decorators';
import type { AuthContext } from '../auth/request-context';
import { outbox } from '../bookings/lifecycle';
import { ACCOUNTS, postJournal } from '../payments/ledger';
import { ReconciliationService } from '../payments/reconciliation.service';
import { RefundsService } from '../payments/refunds.service';
import { SettingsService } from '../users/settings.service';
import { toCsv } from './csv';

const notFound = (what: string) => new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} introuvable.`);
const conflict = (code: string, message: string, details?: Record<string, unknown>) => new ApiError(HttpStatus.CONFLICT, code, message, details);
const forbidden = (code: string, message: string, details?: Record<string, unknown>) => new ApiError(HttpStatus.FORBIDDEN, code, message, details);
const role = (a: AuthContext) => a.roles.join(',');
const DAY = 86_400_000;

export interface StaffRefundInput {
  bookingId: string;
  amountXof: number;
  reasonCode: 'ADMIN' | 'DISPUTE';
  note: string;
}

/**
 * Ventilation d'un remboursement décidé par le personnel sur une réservation payée et non encore remboursée.
 * Les frais de service ne sont rendus qu'au-delà de la part trajet payée ; le conducteur garde la part du prix
 * plein qui n'est pas remboursée, commission déduite au prorata (même règle que les annulations, doc 05 §7).
 */
export function staffRefundSplit(b: { subtotal_xof: number; discount_xof: number; service_fee_xof: number; commission_xof: number; total_xof: number }, amountXof: number) {
  if (amountXof === b.total_xof) return { serviceFeeRefundXof: b.service_fee_xof, driverCompensationXof: 0 };
  const paidTrip = b.subtotal_xof - b.discount_xof;
  const tripRefund = Math.min(amountXof, paidTrip);
  const serviceFeeRefundXof = amountXof - tripRefund;
  const gross = paidTrip <= 0 ? 0 : tripRefund === paidTrip ? b.subtotal_xof : Math.round((tripRefund * b.subtotal_xof) / paidTrip);
  const kept = b.subtotal_xof - gross;
  const commissionOnKept = b.subtotal_xof > 0 ? Math.round((b.commission_xof * kept) / b.subtotal_xof) : 0;
  return { serviceFeeRefundXof, driverCompensationXof: kept - commissionOnKept };
}

/**
 * Finance (EF-94) : remboursements décidés par le personnel avec plafond et double validation, commissions,
 * versements aux conducteurs (enregistrés à la main : aucun versement automatique), rapprochement, exports.
 */
@Injectable()
export class AdminFinanceService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly refunds: RefundsService,
    private readonly reconciliation: ReconciliationService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
  ) {}

  // ------------------------------------------------------------------ remboursements

  async limits() {
    const [supportCap, doubleAbove] = await Promise.all([
      this.settings.get<number>('refunds.support_cap_xof'),
      this.settings.get<number>('refunds.double_validation_above_xof'),
    ]);
    return { supportCapXof: supportCap ?? 0, doubleValidationAboveXof: doubleAbove ?? 0 };
  }

  /**
   * Crée un remboursement. Sans la permission complète (SUPPORT), au-delà du plafond, il reste « demandé » ;
   * au-delà du seuil de double validation, il attend aussi la validation d'une autre personne.
   */
  async requestRefund(staff: AuthContext, input: StaffRefundInput, ctx: RequestContext): Promise<{ refundId: string; status: 'REQUESTED' | 'APPROVED' }> {
    const full = hasPermission(staff, 'refunds.create');
    if (!full && !hasPermission(staff, 'refunds.create.capped')) throw forbidden('FORBIDDEN', "Vous n'avez pas accès à cette ressource.");
    const { supportCapXof, doubleValidationAboveXof } = await this.limits();
    const needsApproval = (!full && input.amountXof > supportCapXof) || input.amountXof > doubleValidationAboveXof;
    const status = needsApproval ? ('REQUESTED' as const) : ('APPROVED' as const);
    const refundId = uuidv7();
    await this.db.transaction().execute(async (trx) => {
      const head = await trx.selectFrom('bookings').select('trip_id').where('id', '=', input.bookingId).executeTakeFirst();
      if (!head) throw notFound('Réservation');
      const b = await trx.selectFrom('bookings').selectAll().where('id', '=', input.bookingId).forUpdate().executeTakeFirstOrThrow();
      const payment = await trx.selectFrom('payments').select(['id', 'amount_xof']).where('booking_id', '=', b.id).where('status', '=', 'SUCCEEDED').forUpdate().executeTakeFirst();
      if (!payment) throw conflict('NOTHING_TO_REFUND', 'Aucun paiement confirmé sur cette réservation.');
      if (b.payment_status !== 'PAID') {
        throw conflict('REFUND_NOT_ALLOWED', b.payment_status === 'REFUND_PENDING'
          ? 'Un remboursement est déjà en cours sur cette réservation.'
          : 'Cette réservation a déjà été remboursée en tout ou partie : à traiter manuellement avec la finance.');
      }
      if (input.amountXof > payment.amount_xof) throw conflict('REFUND_ABOVE_PAID', `Le montant dépasse ce qui a été payé (${payment.amount_xof} F CFA).`, { maxXof: payment.amount_xof });
      const split = staffRefundSplit(b, input.amountXof);
      await trx
        .updateTable('bookings')
        .set({
          payment_status: 'REFUND_PENDING',
          refund_due_xof: input.amountXof,
          refund_reason: input.reasonCode,
          service_fee_refund_xof: split.serviceFeeRefundXof,
          driver_compensation_xof: split.driverCompensationXof,
        })
        .where('id', '=', b.id)
        .execute();
      await trx
        .insertInto('refunds')
        .values({
          id: refundId,
          payment_id: payment.id,
          booking_id: b.id,
          amount_xof: input.amountXof,
          reason_code: input.reasonCode,
          status,
          requested_by: staff.userId,
          // approved_by désigne la seconde personne : vide quand le montant reste dans les limites du demandeur.
          approved_by: null,
          decided_at: status === 'APPROVED' ? new Date() : null,
          note: input.note,
          idempotency_key: uuidv7(),
        })
        .execute();
      await outbox(trx, 'refund', refundId, status === 'REQUESTED' ? 'refund.approval_required' : 'refund.approved', { bookingId: b.id, amountXof: input.amountXof });
      await this.audit.log(
        { actorId: staff.userId, actorRole: role(staff), action: 'refund.requested', targetType: 'booking', targetId: b.id, reason: input.note,
          changes: { refundId, amountXof: input.amountXof, status, reasonCode: input.reasonCode }, ctx },
        trx,
      );
    });
    if (status === 'APPROVED') await this.refunds.processBooking(input.bookingId).catch(() => undefined);
    return { refundId, status };
  }

  /** Seconde validation, par une autre personne que le demandeur (doc 04 §12). */
  async approveRefund(staff: AuthContext, refundId: string, ctx: RequestContext) {
    const bookingId = await this.db.transaction().execute(async (trx) => {
      const r = await trx.selectFrom('refunds').select(['id', 'booking_id', 'status', 'requested_by', 'amount_xof']).where('id', '=', refundId).forUpdate().executeTakeFirst();
      if (!r) throw notFound('Remboursement');
      if (r.status !== 'REQUESTED') throw conflict('INVALID_STATE_TRANSITION', 'Ce remboursement n’attend pas de validation.');
      if (r.requested_by === staff.userId) throw forbidden('SAME_PERSON', 'La validation doit être faite par une autre personne que le demandeur.');
      await trx.updateTable('refunds').set({ status: 'APPROVED', approved_by: staff.userId, decided_at: new Date() }).where('id', '=', refundId).execute();
      await this.audit.log({ actorId: staff.userId, actorRole: role(staff), action: 'refund.approved', targetType: 'refund', targetId: refundId, changes: { amountXof: r.amount_xof }, ctx }, trx);
      return r.booking_id;
    });
    await this.refunds.processBooking(bookingId).catch(() => undefined);
    return this.refund(refundId);
  }

  async rejectRefund(staff: AuthContext, refundId: string, reason: string, ctx: RequestContext) {
    await this.db.transaction().execute(async (trx) => {
      const head = await trx.selectFrom('refunds').select('booking_id').where('id', '=', refundId).executeTakeFirst();
      if (!head) throw notFound('Remboursement');
      await trx.selectFrom('bookings').select('id').where('id', '=', head.booking_id).forUpdate().execute();
      const r = await trx.selectFrom('refunds').select(['id', 'status', 'booking_id']).where('id', '=', refundId).forUpdate().executeTakeFirstOrThrow();
      if (r.status !== 'REQUESTED') throw conflict('INVALID_STATE_TRANSITION', 'Ce remboursement n’attend pas de validation.');
      await trx.updateTable('refunds').set({ status: 'REJECTED', rejected_by: staff.userId, decided_at: new Date(), failure_message: reason.slice(0, 300) }).where('id', '=', refundId).execute();
      await trx
        .updateTable('bookings')
        .set({ payment_status: 'PAID', refund_due_xof: null, refund_reason: null, service_fee_refund_xof: null, driver_compensation_xof: null })
        .where('id', '=', r.booking_id)
        .where('payment_status', '=', 'REFUND_PENDING')
        .execute();
      await this.audit.log({ actorId: staff.userId, actorRole: role(staff), action: 'refund.rejected', targetType: 'refund', targetId: refundId, reason, ctx }, trx);
    });
    return this.refund(refundId);
  }

  async refund(id: string) {
    const r = await this.db
      .selectFrom('refunds')
      .innerJoin('bookings', 'bookings.id', 'refunds.booking_id')
      .leftJoin('users as rq', 'rq.id', 'refunds.requested_by')
      .leftJoin('users as ap', 'ap.id', 'refunds.approved_by')
      .select(['refunds.id', 'refunds.status', 'refunds.amount_xof', 'refunds.reason_code', 'refunds.note', 'refunds.failure_message', 'refunds.created_at',
               'refunds.succeeded_at', 'refunds.decided_at', 'refunds.requested_by', 'bookings.reference', 'bookings.id as booking_id',
               'rq.display_name as requested_by_name', 'ap.display_name as approved_by_name'])
      .where('refunds.id', '=', id)
      .executeTakeFirst();
    if (!r) throw notFound('Remboursement');
    return {
      id: r.id, status: r.status, amountXof: r.amount_xof, reasonCode: r.reason_code, note: r.note, failureMessage: r.failure_message, createdAt: r.created_at,
      succeededAt: r.succeeded_at, decidedAt: r.decided_at, bookingId: r.booking_id, bookingReference: r.reference, requestedBy: r.requested_by,
      requestedByName: r.requested_by_name, approvedByName: r.approved_by_name,
    };
  }

  async refundsList(q: { status?: string; cursor?: string; limit: number }) {
    let query = this.db
      .selectFrom('refunds')
      .innerJoin('bookings', 'bookings.id', 'refunds.booking_id')
      .leftJoin('users as rq', 'rq.id', 'refunds.requested_by')
      .select(['refunds.id', 'refunds.status', 'refunds.amount_xof', 'refunds.reason_code', 'refunds.note', 'refunds.created_at', 'refunds.requested_by',
               'bookings.reference', 'bookings.id as booking_id', 'rq.display_name as requested_by_name'])
      .orderBy('refunds.id', 'desc')
      .limit(q.limit + 1);
    if (q.status) query = query.where('refunds.status', '=', q.status as never);
    if (q.cursor) query = query.where('refunds.id', '<', q.cursor);
    const rows = await query.execute();
    const page = rows.slice(0, q.limit);
    return {
      data: page.map((r) => ({
        id: r.id, status: r.status, amountXof: r.amount_xof, reasonCode: r.reason_code, note: r.note, createdAt: r.created_at, bookingId: r.booking_id,
        bookingReference: r.reference, requestedBy: r.requested_by, requestedByName: r.requested_by_name,
      })),
      nextCursor: rows.length > q.limit ? page.at(-1)!.id : null,
      limits: await this.limits(),
    };
  }

  // ------------------------------------------------------------------ commissions et versements

  async commissions(q: { status?: string; driverId?: string; cursor?: string; limit: number }) {
    let query = this.db
      .selectFrom('commissions')
      .innerJoin('bookings', 'bookings.id', 'commissions.booking_id')
      .innerJoin('trips', 'trips.id', 'bookings.trip_id')
      .innerJoin('users as d', 'd.id', 'commissions.driver_id')
      .select(['commissions.id', 'commissions.status', 'commissions.gross_xof', 'commissions.commission_xof', 'commissions.service_fee_xof', 'commissions.driver_net_xof',
               'commissions.adjusted_xof', 'commissions.payable_at', 'commissions.created_at', 'commissions.driver_id', 'd.display_name', 'bookings.reference',
               'trips.departure_at'])
      .orderBy('commissions.id', 'desc')
      .limit(q.limit + 1);
    if (q.status) query = query.where('commissions.status', '=', q.status as never);
    if (q.driverId) query = query.where('commissions.driver_id', '=', q.driverId);
    if (q.cursor) query = query.where('commissions.id', '<', q.cursor);
    const rows = await query.execute();
    const page = rows.slice(0, q.limit);
    const totals = await this.db
      .selectFrom('commissions')
      .select(['status', sql<number>`sum(driver_net_xof + adjusted_xof)::bigint`.as('due'), sql<number>`sum(commission_xof)::bigint`.as('commission')])
      .groupBy('status')
      .execute();
    return {
      data: page.map((c) => ({
        id: c.id, status: c.status, grossXof: c.gross_xof, commissionXof: c.commission_xof, serviceFeeXof: c.service_fee_xof, driverNetXof: c.driver_net_xof,
        adjustedXof: c.adjusted_xof, dueXof: c.driver_net_xof + c.adjusted_xof, payableAt: c.payable_at, createdAt: c.created_at,
        driver: { id: c.driver_id, displayName: c.display_name }, bookingReference: c.reference, departureAt: c.departure_at,
      })),
      nextCursor: rows.length > q.limit ? page.at(-1)!.id : null,
      totals: Object.fromEntries(totals.map((t) => [t.status, { dueXof: Number(t.due), commissionXof: Number(t.commission) }])),
    };
  }

  async payouts(q: { status?: string; cursor?: string; limit: number }) {
    let query = this.db
      .selectFrom('payouts')
      .innerJoin('users as d', 'd.id', 'payouts.driver_id')
      .select(['payouts.id', 'payouts.driver_id', 'payouts.period_start', 'payouts.period_end', 'payouts.amount_xof', 'payouts.status', 'payouts.external_reference',
               'payouts.paid_at', 'payouts.created_at', 'd.display_name',
               sql<number>`(SELECT count(*)::int FROM payout_items i WHERE i.payout_id = payouts.id)`.as('items')])
      .orderBy('payouts.id', 'desc')
      .limit(q.limit + 1);
    if (q.status) query = query.where('payouts.status', '=', q.status as never);
    if (q.cursor) query = query.where('payouts.id', '<', q.cursor);
    const rows = await query.execute();
    const page = rows.slice(0, q.limit);
    return {
      // Aucun versement n'est envoyé par la plateforme : le virement se fait hors plateforme, puis il est enregistré ici.
      automaticPayouts: false,
      data: page.map((p) => ({
        id: p.id, driver: { id: p.driver_id, displayName: p.display_name }, periodStart: p.period_start, periodEnd: p.period_end, amountXof: p.amount_xof,
        status: p.status, externalReference: p.external_reference, paidAt: p.paid_at, createdAt: p.created_at, items: p.items,
      })),
      nextCursor: rows.length > q.limit ? page.at(-1)!.id : null,
    };
  }

  /** Prépare un relevé par conducteur avec ses gains disponibles jusqu'à la date donnée (brouillon). */
  async generatePayouts(staff: AuthContext, input: { until: Date; driverId?: string }, ctx: RequestContext) {
    const created = await this.db.transaction().execute(async (trx) => {
      let q = trx
        .selectFrom('commissions')
        .select(['id', 'driver_id', 'driver_net_xof', 'adjusted_xof', 'payable_at'])
        .where('status', '=', 'PAYABLE')
        .where('payable_at', '<=', input.until)
        .orderBy('driver_id')
        .forUpdate();
      if (input.driverId) q = q.where('driver_id', '=', input.driverId);
      const rows = await q.execute();
      const byDriver = new Map<string, typeof rows>();
      for (const r of rows) byDriver.set(r.driver_id, [...(byDriver.get(r.driver_id) ?? []), r]);
      const ids: string[] = [];
      for (const [driverId, items] of byDriver) {
        const amount = items.reduce((s, i) => s + i.driver_net_xof + i.adjusted_xof, 0);
        if (amount <= 0) continue;
        const id = uuidv7();
        const start = new Date(Math.min(...items.map((i) => i.payable_at!.getTime())));
        await trx
          .insertInto('payouts')
          .values({ id, driver_id: driverId, period_start: start.toISOString().slice(0, 10), period_end: input.until.toISOString().slice(0, 10), amount_xof: amount, status: 'DRAFT' })
          .execute();
        await trx.insertInto('payout_items').values(items.map((i) => ({ payout_id: id, commission_id: i.id, amount_xof: i.driver_net_xof + i.adjusted_xof }))).execute();
        await trx.updateTable('commissions').set({ status: 'IN_PAYOUT' }).where('id', 'in', items.map((i) => i.id)).execute();
        ids.push(id);
      }
      await this.audit.log({ actorId: staff.userId, actorRole: role(staff), action: 'payouts.generated', targetType: 'payout', changes: { count: ids.length, until: input.until.toISOString() }, ctx }, trx);
      return ids;
    });
    return { created: created.length, ids: created };
  }

  /** Enregistre un versement fait hors plateforme (virement, Mobile Money), avec sa référence externe. */
  async markPayoutPaid(staff: AuthContext, id: string, input: { externalReference: string; method?: 'WAVE' | 'ORANGE_MONEY' | 'MTN_MOMO' | 'MOOV_MONEY' }, ctx: RequestContext) {
    await this.db.transaction().execute(async (trx) => {
      const p = await trx.selectFrom('payouts').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!p) throw notFound('Versement');
      if (p.status !== 'DRAFT' && p.status !== 'APPROVED') throw conflict('INVALID_STATE_TRANSITION', 'Ce versement n’est plus modifiable.');
      const items = await trx
        .selectFrom('payout_items')
        .innerJoin('commissions', 'commissions.id', 'payout_items.commission_id')
        .select(['payout_items.amount_xof', 'commissions.id', 'commissions.booking_id'])
        .where('payout_id', '=', id)
        .execute();
      await trx.updateTable('payouts').set({ status: 'PAID', paid_at: new Date(), external_reference: input.externalReference, method: input.method ?? null, approved_by: staff.userId }).where('id', '=', id).execute();
      await trx.updateTable('commissions').set({ status: 'PAID' }).where('id', 'in', items.map((i) => i.id)).execute();
      for (const i of items) {
        await postJournal(trx, [
          { account: ACCOUNTS.driverPayable, amountXof: i.amount_xof },
          { account: ACCOUNTS.clearing, amountXof: -i.amount_xof },
        ], { bookingId: i.booking_id, description: `Versement conducteur ${input.externalReference}` });
      }
      await this.audit.log({ actorId: staff.userId, actorRole: role(staff), action: 'payout.marked_paid', targetType: 'payout', targetId: id, changes: { amountXof: p.amount_xof, externalReference: input.externalReference }, ctx }, trx);
    });
    return this.payout(id);
  }

  async payout(id: string) {
    const p = await this.db
      .selectFrom('payouts')
      .innerJoin('users as d', 'd.id', 'payouts.driver_id')
      .selectAll('payouts')
      .select('d.display_name')
      .where('payouts.id', '=', id)
      .executeTakeFirst();
    if (!p) throw notFound('Versement');
    const items = await this.db
      .selectFrom('payout_items')
      .innerJoin('commissions', 'commissions.id', 'payout_items.commission_id')
      .innerJoin('bookings', 'bookings.id', 'commissions.booking_id')
      .select(['payout_items.amount_xof', 'bookings.reference', 'commissions.payable_at'])
      .where('payout_items.payout_id', '=', id)
      .execute();
    return {
      id: p.id, driver: { id: p.driver_id, displayName: p.display_name }, periodStart: p.period_start, periodEnd: p.period_end, amountXof: p.amount_xof,
      status: p.status, method: p.method, externalReference: p.external_reference, paidAt: p.paid_at, createdAt: p.created_at,
      items: items.map((i) => ({ amountXof: i.amount_xof, bookingReference: i.reference, payableAt: i.payable_at })),
    };
  }

  async cancelPayout(staff: AuthContext, id: string, reason: string, ctx: RequestContext) {
    await this.db.transaction().execute(async (trx) => {
      const p = await trx.selectFrom('payouts').select(['id', 'status']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!p) throw notFound('Versement');
      if (p.status !== 'DRAFT' && p.status !== 'APPROVED') throw conflict('INVALID_STATE_TRANSITION', 'Ce versement n’est plus modifiable.');
      const items = await trx.selectFrom('payout_items').select('commission_id').where('payout_id', '=', id).execute();
      await trx.deleteFrom('payout_items').where('payout_id', '=', id).execute();
      if (items.length > 0) await trx.updateTable('commissions').set({ status: 'PAYABLE' }).where('id', 'in', items.map((i) => i.commission_id)).execute();
      await trx.updateTable('payouts').set({ status: 'CANCELLED' }).where('id', '=', id).execute();
      await this.audit.log({ actorId: staff.userId, actorRole: role(staff), action: 'payout.cancelled', targetType: 'payout', targetId: id, reason, ctx }, trx);
    });
    return { id, status: 'CANCELLED' };
  }

  // ------------------------------------------------------------------ rapprochement

  async reconciliationRuns(limit: number) {
    const rows = await this.db
      .selectFrom('reconciliation_runs')
      .select(['id', 'provider', 'period_start', 'period_end', 'status', 'created_at',
               sql<number>`(SELECT count(*)::int FROM reconciliation_items i WHERE i.run_id = reconciliation_runs.id)`.as('items'),
               sql<number>`(SELECT count(*)::int FROM reconciliation_items i WHERE i.run_id = reconciliation_runs.id AND i.resolved_at IS NULL)`.as('open_items')])
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();
    return { data: rows.map((r) => ({ id: r.id, provider: r.provider, periodStart: r.period_start, periodEnd: r.period_end, status: r.status, createdAt: r.created_at, items: r.items, openItems: r.open_items })) };
  }

  async reconciliationRun(id: string) {
    const run = await this.db.selectFrom('reconciliation_runs').selectAll().where('id', '=', id).executeTakeFirst();
    if (!run) throw notFound('Rapprochement');
    const items = await this.db.selectFrom('reconciliation_items').selectAll().where('run_id', '=', id).orderBy('id').execute();
    return {
      id: run.id, provider: run.provider, periodStart: run.period_start, periodEnd: run.period_end, status: run.status, createdAt: run.created_at,
      items: items.map((i) => ({ id: i.id, issue: i.issue, paymentId: i.payment_id, providerReference: i.provider_reference, details: i.details, resolvedAt: i.resolved_at, resolutionNote: i.resolution_note })),
    };
  }

  async runReconciliation(staff: AuthContext, from: Date, to: Date, ctx: RequestContext) {
    const result = await this.reconciliation.run(from, to);
    await this.audit.log({ actorId: staff.userId, actorRole: role(staff), action: 'reconciliation.run', targetType: 'reconciliation', targetId: result.runId, changes: { from, to, status: result.status }, ctx });
    return this.reconciliationRun(result.runId);
  }

  async resolveReconciliationItem(staff: AuthContext, itemId: string, note: string, ctx: RequestContext) {
    const r = await this.db
      .updateTable('reconciliation_items')
      .set({ resolved_at: new Date(), resolved_by: staff.userId, resolution_note: note })
      .where('id', '=', itemId)
      .where('resolved_at', 'is', null)
      .returning('run_id')
      .executeTakeFirst();
    if (!r) throw notFound('Écart');
    await this.audit.log({ actorId: staff.userId, actorRole: role(staff), action: 'reconciliation.item_resolved', targetType: 'reconciliation_item', targetId: itemId, reason: note, ctx });
    return this.reconciliationRun(r.run_id);
  }

  // ------------------------------------------------------------------ exports CSV

  /**
   * Export CSV d'une période (EF-98, doc 04 §12) : colonnes sensibles exclues (aucun téléphone ni nom complet),
   * fichier déposé dans le stockage privé et remis par une URL signée de 5 minutes.
   */
  async createExport(staff: AuthContext, input: { type: 'TRANSACTIONS' | 'BOOKINGS' | 'REFUNDS' | 'COMMISSIONS'; from: Date; to: Date }, ctx: RequestContext) {
    if (input.to.getTime() - input.from.getTime() > 366 * DAY) throw new ApiError(HttpStatus.BAD_REQUEST, 'PERIOD_TOO_LONG', 'Période d’un an au maximum.');
    const { header, rows } = await this.exportRows(input.type, input.from, input.to);
    const id = uuidv7();
    const key = `exports/${input.type.toLowerCase()}-${input.from.toISOString().slice(0, 10)}-${input.to.toISOString().slice(0, 10)}-${id}.csv`;
    await this.storage.put(key, toCsv(header, rows), 'text/csv; charset=utf-8');
    await this.db.insertInto('exports').values({ id, type: input.type, period_from: input.from, period_to: input.to, row_count: rows.length, object_key: key, created_by: staff.userId }).execute();
    await this.audit.log({ actorId: staff.userId, actorRole: role(staff), action: 'export.created', targetType: 'export', targetId: id, changes: { type: input.type, from: input.from, to: input.to, rows: rows.length }, ctx });
    const { url, expiresAt } = await this.storage.presignGet(key);
    return { id, type: input.type, rowCount: rows.length, url, expiresAt };
  }

  private async exportRows(type: 'TRANSACTIONS' | 'BOOKINGS' | 'REFUNDS' | 'COMMISSIONS', from: Date, to: Date): Promise<{ header: string[]; rows: unknown[][] }> {
    const LIMIT = 100_000;
    if (type === 'TRANSACTIONS') {
      const r = await this.db
        .selectFrom('ledger_entries')
        .leftJoin('bookings', 'bookings.id', 'ledger_entries.booking_id')
        .select(['ledger_entries.created_at', 'ledger_entries.journal_id', 'ledger_entries.account', 'ledger_entries.amount_xof', 'ledger_entries.description', 'bookings.reference'])
        .where('ledger_entries.created_at', '>=', from)
        .where('ledger_entries.created_at', '<', to)
        .orderBy('ledger_entries.id')
        .limit(LIMIT)
        .execute();
      return { header: ['date', 'journal', 'compte', 'montant_xof', 'libelle', 'reservation'], rows: r.map((e) => [e.created_at, e.journal_id, e.account, e.amount_xof, e.description, e.reference]) };
    }
    if (type === 'BOOKINGS') {
      const r = await this.db
        .selectFrom('bookings')
        .innerJoin('trips', 'trips.id', 'bookings.trip_id')
        .select(['bookings.created_at', 'bookings.reference', 'trips.public_ref', 'trips.kind', 'bookings.status', 'bookings.payment_status', 'bookings.seats',
                 'bookings.subtotal_xof', 'bookings.service_fee_xof', 'bookings.discount_xof', 'bookings.total_xof', 'bookings.commission_xof', 'bookings.driver_net_xof', 'bookings.is_demo'])
        .where('bookings.created_at', '>=', from)
        .where('bookings.created_at', '<', to)
        .orderBy('bookings.id')
        .limit(LIMIT)
        .execute();
      return {
        header: ['date', 'reservation', 'trajet', 'type', 'statut', 'paiement', 'places', 'sous_total_xof', 'frais_xof', 'reduction_xof', 'total_xof', 'commission_xof', 'net_conducteur_xof', 'demo'],
        rows: r.map((b) => [b.created_at, b.reference, b.public_ref, b.kind, b.status, b.payment_status, b.seats, b.subtotal_xof, b.service_fee_xof, b.discount_xof, b.total_xof, b.commission_xof, b.driver_net_xof, b.is_demo ? 'oui' : 'non']),
      };
    }
    if (type === 'REFUNDS') {
      const r = await this.db
        .selectFrom('refunds')
        .innerJoin('bookings', 'bookings.id', 'refunds.booking_id')
        .select(['refunds.created_at', 'refunds.succeeded_at', 'bookings.reference', 'refunds.amount_xof', 'refunds.reason_code', 'refunds.status', 'refunds.provider_reference'])
        .where('refunds.created_at', '>=', from)
        .where('refunds.created_at', '<', to)
        .orderBy('refunds.id')
        .limit(LIMIT)
        .execute();
      return { header: ['date', 'date_reussite', 'reservation', 'montant_xof', 'motif', 'statut', 'reference_prestataire'], rows: r.map((x) => [x.created_at, x.succeeded_at, x.reference, x.amount_xof, x.reason_code, x.status, x.provider_reference]) };
    }
    const r = await this.db
      .selectFrom('commissions')
      .innerJoin('bookings', 'bookings.id', 'commissions.booking_id')
      .select(['commissions.created_at', 'bookings.reference', 'commissions.driver_id', 'commissions.status', 'commissions.gross_xof', 'commissions.commission_xof',
               'commissions.driver_net_xof', 'commissions.adjusted_xof', 'commissions.payable_at'])
      .where('commissions.created_at', '>=', from)
      .where('commissions.created_at', '<', to)
      .orderBy('commissions.id')
      .limit(LIMIT)
      .execute();
    return {
      header: ['date', 'reservation', 'conducteur_id', 'statut', 'part_trajet_xof', 'commission_xof', 'net_conducteur_xof', 'ajustement_xof', 'disponible_le'],
      rows: r.map((c) => [c.created_at, c.reference, c.driver_id, c.status, c.gross_xof, c.commission_xof, c.driver_net_xof, c.adjusted_xof, c.payable_at]),
    };
  }
}
