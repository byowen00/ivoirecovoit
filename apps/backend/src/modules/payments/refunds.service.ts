import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { uuidv7 } from '../../common/ids';
import { DB, type Db } from '../../database/database.module';
import { outbox } from '../bookings/lifecycle';
import { postJournal, refundLines, refundSplit, unallocatedRefundLines } from './ledger';
import { PAYMENT_PROVIDER, type PaymentProvider, type RefundResult } from './provider';

const MINUTE = 60_000;
/** Après un échec, nouvel essai au plus tôt 10 min plus tard ; au-delà de 5 échecs, traitement manuel. */
const RETRY_AFTER_MS = 10 * MINUTE;
const MAX_FAILURES = 5;
/** Un remboursement « en cours » depuis plus longtemps est relancé (même identifiant : le prestataire ne paie pas deux fois). */
const STUCK_AFTER_MS = 5 * MINUTE;

export type RefundOutcome = 'SUCCEEDED' | 'PROCESSING' | 'FAILED' | 'MANUAL_REQUIRED' | 'SKIPPED';

/**
 * Exécution des remboursements dus (doc 05 §7 et §8) : le montant, les frais rendus, la part laissée au conducteur
 * et le motif ont été figés sur la réservation à l'annulation (ou au paiement tardif). Ici on crée le remboursement,
 * on l'envoie au prestataire hors transaction, puis, sur confirmation, on écrit le grand livre, on ajuste la
 * commission du conducteur et on met à jour la réservation. Rejouable : un seul remboursement actif par motif.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger('Remboursements');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  async processBooking(bookingId: string, now: Date = new Date()): Promise<RefundOutcome> {
    const prepared = await this.db.transaction().execute(async (trx) => {
      const b = await trx
        .selectFrom('bookings')
        .select(['id', 'payment_status', 'refund_due_xof', 'refund_reason', 'cancelled_by'])
        .where('id', '=', bookingId)
        .forUpdate()
        .executeTakeFirst();
      if (!b || b.payment_status !== 'REFUND_PENDING' || !b.refund_due_xof || !b.refund_reason) return null;
      const payment = await trx
        .selectFrom('payments')
        .select(['id', 'provider', 'provider_reference', 'amount_xof'])
        .where('booking_id', '=', bookingId)
        .where('status', '=', 'SUCCEEDED')
        .forUpdate()
        .executeTakeFirst();
      if (!payment) return null; // rien d'encaissé par la plateforme (espèces, ou paiement jamais confirmé)
      const existing = await trx
        .selectFrom('refunds')
        .selectAll()
        .where('booking_id', '=', bookingId)
        .where('reason_code', '=', b.refund_reason)
        .where('status', 'not in', ['REJECTED', 'FAILED', 'SUCCEEDED'])
        .executeTakeFirst();
      if (existing) {
        // Décidé par le personnel au-delà du seuil : en attente de la seconde validation.
        if (existing.status === 'REQUESTED' || existing.status === 'MANUAL_REQUIRED') return null;
        // Un autre traitement vient de l'envoyer : on le laisse finir.
        if (existing.status === 'PROCESSING' && now.getTime() - existing.updated_at.getTime() < STUCK_AFTER_MS) return null;
        await trx.updateTable('refunds').set({ status: 'PROCESSING' }).where('id', '=', existing.id).execute();
        return { refundId: existing.id, idempotencyKey: existing.idempotency_key, amountXof: existing.amount_xof, payment, reason: b.refund_reason };
      }
      const failures = await trx
        .selectFrom('refunds')
        .select([sql<number>`count(*)::int`.as('n'), sql<Date | null>`max(updated_at)`.as('last')])
        .where('booking_id', '=', bookingId)
        .where('reason_code', '=', b.refund_reason)
        .where('status', '=', 'FAILED')
        .executeTakeFirstOrThrow();
      if (failures.n >= MAX_FAILURES) return null;
      if (failures.last && now.getTime() - failures.last.getTime() < RETRY_AFTER_MS) return null;
      const refundId = uuidv7();
      const idempotencyKey = uuidv7();
      await trx
        .insertInto('refunds')
        .values({
          id: refundId,
          payment_id: payment.id,
          booking_id: bookingId,
          amount_xof: b.refund_due_xof,
          reason_code: b.refund_reason,
          status: 'PROCESSING',
          requested_by: b.cancelled_by,
          idempotency_key: idempotencyKey,
        })
        .execute();
      return { refundId, idempotencyKey, amountXof: b.refund_due_xof, payment, reason: b.refund_reason };
    });
    if (!prepared) return 'SKIPPED';

    if (!this.provider.refund || prepared.payment.provider !== this.provider.code || !prepared.payment.provider_reference) {
      await this.db.transaction().execute(async (trx) => {
        await trx.updateTable('refunds').set({ status: 'MANUAL_REQUIRED', failure_message: 'Remboursement automatique indisponible chez ce prestataire.' }).where('id', '=', prepared.refundId).execute();
        await outbox(trx, 'refund', prepared.refundId, 'refund.manual_required', { bookingId, amountXof: prepared.amountXof });
      });
      return 'MANUAL_REQUIRED';
    }

    let result: RefundResult;
    try {
      result = await this.provider.refund({
        refundId: prepared.refundId,
        providerReference: prepared.payment.provider_reference,
        amountXof: prepared.amountXof,
        reason: prepared.reason,
        idempotencyKey: prepared.idempotencyKey,
      });
    } catch (err) {
      // Réponse inconnue : le remboursement reste « en cours » et sera relancé avec le même identifiant.
      this.logger.warn(`Remboursement ${prepared.refundId} sans réponse du prestataire : ${(err as Error).message}`);
      return 'PROCESSING';
    }
    if (result.status === 'PROCESSING') {
      await this.db.updateTable('refunds').set({ provider_reference: result.providerReference || null }).where('id', '=', prepared.refundId).execute();
      return 'PROCESSING';
    }
    if (result.status === 'FAILED') {
      await this.db.transaction().execute(async (trx) => {
        await trx
          .updateTable('refunds')
          .set({ status: 'FAILED', failure_message: (result.failureMessage ?? 'Remboursement refusé par le prestataire.').slice(0, 300) })
          .where('id', '=', prepared.refundId)
          .execute();
        await outbox(trx, 'refund', prepared.refundId, 'refund.failed', { bookingId, amountXof: prepared.amountXof });
      });
      return 'FAILED';
    }
    await this.applySucceeded(prepared.refundId, result.providerReference, now);
    return 'SUCCEEDED';
  }

  /** Remboursement confirmé par le prestataire : grand livre, commission, réservation. */
  async applySucceeded(refundId: string, providerReference: string, now: Date = new Date()): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const head = await trx.selectFrom('refunds').select('booking_id').where('id', '=', refundId).executeTakeFirstOrThrow();
      const b = await trx.selectFrom('bookings').selectAll().where('id', '=', head.booking_id).forUpdate().executeTakeFirstOrThrow();
      const r = await trx.selectFrom('refunds').selectAll().where('id', '=', refundId).forUpdate().executeTakeFirstOrThrow();
      if (r.status === 'SUCCEEDED') return;
      const payment = await trx.selectFrom('payments').select(['id', 'amount_xof']).where('id', '=', r.payment_id).executeTakeFirstOrThrow();
      await trx.updateTable('refunds').set({ status: 'SUCCEEDED', provider_reference: providerReference, succeeded_at: now, failure_message: null }).where('id', '=', r.id).execute();

      const description = `Remboursement ${b.reference}`;
      if (r.reason_code === 'LATE_PAYMENT') {
        await postJournal(trx, unallocatedRefundLines(r.amount_xof), { bookingId: b.id, paymentId: payment.id, refundId: r.id, description });
      } else {
        const compensation = b.driver_compensation_xof ?? 0;
        const feeRefund = b.service_fee_refund_xof ?? (r.amount_xof === b.total_xof ? b.service_fee_xof : 0);
        const split = refundSplit(
          {
            subtotalXof: b.subtotal_xof,
            serviceFeeXof: b.service_fee_xof,
            discountXof: b.discount_xof,
            totalXof: b.total_xof,
            commissionXof: b.commission_xof,
            driverNetXof: b.driver_net_xof,
          },
          r.amount_xof,
          feeRefund,
          compensation,
        );
        await postJournal(trx, refundLines(split, r.amount_xof), { bookingId: b.id, paymentId: payment.id, refundId: r.id, description });
        // Commission du conducteur : il garde `compensation` au lieu de son net ; rien du tout -> annulée.
        await trx
          .updateTable('commissions')
          .set(compensation === 0 ? { status: 'VOID', adjusted_xof: -b.driver_net_xof } : { adjusted_xof: compensation - b.driver_net_xof })
          .where('booking_id', '=', b.id)
          .where('status', 'in', ['PENDING', 'PAYABLE'])
          .execute();
      }

      const { refunded } = await trx
        .selectFrom('refunds')
        .select(sql<number>`coalesce(sum(amount_xof), 0)::bigint`.as('refunded'))
        .where('payment_id', '=', payment.id)
        .where('status', '=', 'SUCCEEDED')
        .executeTakeFirstOrThrow();
      await trx
        .updateTable('bookings')
        .set({ payment_status: Number(refunded) >= payment.amount_xof ? 'REFUNDED' : 'PARTIALLY_REFUNDED' })
        .where('id', '=', b.id)
        .execute();
      await outbox(trx, 'refund', r.id, 'refund.succeeded', { bookingId: b.id, passengerId: b.passenger_id, amountXof: r.amount_xof });
    });
  }

  /** Tâche de rattrapage : réservations dont le remboursement n'a pas encore abouti. */
  async processPending(now: Date = new Date()): Promise<number> {
    const due = await this.db
      .selectFrom('bookings')
      .select('id')
      .where('payment_status', '=', 'REFUND_PENDING')
      // Remboursements en attente d'une seconde validation : rien à faire tant qu'elle n'est pas donnée.
      .where(({ not, exists, selectFrom }) =>
        not(exists(selectFrom('refunds').select('refunds.id').whereRef('refunds.booking_id', '=', 'bookings.id').where('refunds.status', '=', 'REQUESTED'))),
      )
      .orderBy('updated_at')
      .limit(100)
      .execute();
    let done = 0;
    for (const d of due) {
      const r = await this.processBooking(d.id, now).catch((err: Error) => {
        this.logger.error(`Remboursement de ${d.id} : ${err.message}`);
        return 'FAILED' as const;
      });
      if (r === 'SUCCEEDED') done++;
    }
    return done;
  }

  /**
   * Gains disponibles (doc 05 §9) : 48 h après la fin du trajet, sans réclamation ouverte ni remboursement en cours.
   * Le versement lui-même n'est pas automatisé (procédure à définir avec le prestataire).
   */
  async releasePayable(hours: number, now: Date = new Date()): Promise<number> {
    const { numAffectedRows } = await sql`
      UPDATE commissions c SET status = 'PAYABLE', payable_at = ${now}
        FROM bookings b JOIN trips t ON t.id = b.trip_id
       WHERE c.booking_id = b.id AND c.status = 'PENDING'
         AND t.status = 'COMPLETED' AND t.completed_at <= ${new Date(now.getTime() - hours * 3_600_000)}
         AND b.status IN ('COMPLETED','NO_SHOW','CANCELLED_BY_PASSENGER')
         AND b.payment_status IN ('PAID','PARTIALLY_REFUNDED')
         AND c.driver_net_xof + c.adjusted_xof > 0
         AND NOT EXISTS (SELECT 1 FROM disputes d WHERE d.booking_id = b.id AND d.status NOT IN ('RESOLVED','REJECTED','CLOSED'))`.execute(this.db);
    return Number(numAffectedRows ?? 0);
  }
}
