import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { z } from 'zod';
import { ApiError } from '../../common/api-error';
import { uuidv7 } from '../../common/ids';
import { maskPhone, normalizeCiMobile } from '../../common/phone';
import { ENV, type Env } from '../../config/env';
import { DB, type Db } from '../../database/database.module';
import type { Database, PaymentEventResult, PaymentStatus } from '../../database/types';
import { AuditService, type RequestContext } from '../../infra/audit.service';
import { outbox, setActor, syncTripFullStatus } from '../bookings/lifecycle';
import { SettingsService } from '../users/settings.service';
import { paymentLines, postJournal, unallocatedPaymentLines } from './ledger';
import type { InitiatePaymentInput as PayBody } from './payments.schemas';
import {
  type InitiatePaymentInput,
  METHOD_LABEL,
  MOBILE_MONEY_METHODS,
  type MobileMoneyMethod,
  type NextAction,
  type NormalizedPaymentEvent,
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type ProviderStatus,
} from './provider';
import { RefundsService } from './refunds.service';

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Paiement introuvable.');
const conflict = (code: string, message: string, details?: Record<string, unknown>) =>
  new ApiError(HttpStatus.CONFLICT, code, message, details);

const MINUTE = 60_000;
const isUuid = (v: string) => z.uuid().safeParse(v).success;

const FAILURE_MESSAGE: Record<string, string> = {
  CANCELLED_BY_PAYER: 'Paiement annulé depuis le téléphone.',
  EXPIRED: 'Le paiement n’a pas été validé à temps.',
  DECLINED: 'Paiement refusé par l’opérateur.',
  INSUFFICIENT_FUNDS: 'Solde insuffisant.',
  NOT_FOUND_AT_PROVIDER: 'Le paiement n’a pas pu être créé chez le prestataire.',
};

type Locked = {
  trip: { id: string; status: string; seats_offered: number };
  booking: Awaited<ReturnType<PaymentsService['lockBooking']>>;
  payment: NonNullable<Awaited<ReturnType<PaymentsService['lockPayment']>>>;
};

/**
 * Paiements (doc 05 §5) : initialisation, traitement idempotent des événements du prestataire (webhook signé ou
 * interrogation par notre serveur), effets sur la réservation, rattrapage des paiements restés en attente.
 * Un paiement n'est jamais déclaré réussi sans confirmation vérifiée du prestataire.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('Paiements');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly settings: SettingsService,
    private readonly refunds: RefundsService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ moyens de paiement

  async methods() {
    const [enabled, cash] = await Promise.all([
      this.settings.get<string[]>('payments.enabled_methods'),
      this.settings.get<boolean>('payments.cash_enabled'),
    ]);
    const supported = await this.provider.supportedMethods();
    const methods = MOBILE_MONEY_METHODS.filter((m) => supported.includes(m) && (enabled ?? []).includes(m));
    return {
      provider: this.provider.code,
      sandbox: this.provider.isSandbox,
      methods: methods.map((code) => ({ code, label: METHOD_LABEL[code] })),
      cashEnabled: cash === true,
    };
  }

  // ------------------------------------------------------------------ initialisation (doc 05 §5.1)

  async initiate(userId: string, bookingId: string, body: PayBody, idempotencyKey: string, ctx: RequestContext) {
    const { methods } = await this.methods();
    if (!methods.some((m) => m.code === body.method)) {
      throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'PAYMENT_METHOD_UNAVAILABLE', 'Ce moyen de paiement n’est pas disponible.');
    }
    const payerPhone = normalizeCiMobile(body.payerPhone);
    if (!payerPhone) {
      throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', 'Numéro de téléphone invalide.', {
        fields: { payerPhone: 'Numéro mobile ivoirien attendu (10 chiffres, par exemple 07 07 07 07 07).' },
      });
    }
    const extension = (await this.settings.get<number>('booking.hold_extension_minutes')) ?? 10;
    const paymentId = uuidv7();
    const created = await this.db.transaction().execute(async (trx) => {
      const head = await trx.selectFrom('bookings').select(['trip_id', 'passenger_id']).where('id', '=', bookingId).executeTakeFirst();
      if (!head || head.passenger_id !== userId) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Réservation introuvable.');
      await trx.selectFrom('trips').select('id').where('id', '=', head.trip_id).forUpdate().execute();
      const b = await this.lockBooking(trx, bookingId);
      if (b.status !== 'PENDING_PAYMENT') {
        throw conflict('INVALID_STATE_TRANSITION', 'Cette réservation n’attend pas de paiement.', { status: b.status });
      }
      if (!b.hold_expires_at || b.hold_expires_at.getTime() <= Date.now()) {
        throw conflict('BOOKING_EXPIRED', 'Le délai de paiement est dépassé : les places ont été libérées.');
      }
      const active = await trx
        .selectFrom('payments')
        .select(['id', 'status'])
        .where('booking_id', '=', bookingId)
        .where('status', 'in', ['CREATED', 'PENDING', 'SUCCEEDED'])
        .executeTakeFirst();
      if (active?.status === 'SUCCEEDED') throw conflict('ALREADY_PAID', 'Cette réservation est déjà payée.');
      if (active) throw conflict('PAYMENT_IN_PROGRESS', 'Un paiement est déjà en cours pour cette réservation.', { paymentId: active.id });
      // Le prestataire peut confirmer jusqu'à la fin de la prolongation éventuelle du blocage.
      const expiresAt = new Date(b.hold_expires_at.getTime() + extension * MINUTE);
      await trx
        .insertInto('payments')
        .values({
          id: paymentId,
          booking_id: bookingId,
          provider: this.provider.code,
          method: body.method,
          amount_xof: b.total_xof,
          payer_phone_masked: maskPhone(payerPhone),
          idempotency_key: idempotencyKey,
          expires_at: expiresAt,
        })
        .execute();
      await trx.updateTable('bookings').set({ payment_status: 'PROCESSING' }).where('id', '=', bookingId).execute();
      await this.audit.log(
        { actorId: userId, action: 'payment.initiate', targetType: 'payment', targetId: paymentId, changes: { method: body.method, amountXof: b.total_xof }, ctx },
        trx,
      );
      return { amountXof: b.total_xof, reference: b.reference, expiresAt };
    });

    // Appel au prestataire hors transaction (doc 05 §5.1). En cas d'échec réseau, le paiement reste CREATED :
    // la tâche de rattrapage interroge le prestataire avec notre référence.
    let nextAction: NextAction | null = null;
    try {
      const res = await this.provider.initiatePayment({
        paymentId,
        amountXof: created.amountXof,
        method: body.method as MobileMoneyMethod,
        payerPhone,
        description: `IvoireCovoit ${created.reference}`,
        idempotencyKey,
        returnUrl: `${this.env.WEB_BASE_URL}/reservations/${bookingId}/payer?paiement=${paymentId}`,
        notifyUrl: `${this.env.API_BASE_URL}/api/v1/webhooks/payments/${this.provider.code}`,
      } satisfies InitiatePaymentInput);
      nextAction = res.nextAction;
      await this.db
        .updateTable('payments')
        .set({ status: 'PENDING', provider_reference: res.providerReference })
        .where('id', '=', paymentId)
        .where('status', '=', 'CREATED')
        .execute();
    } catch (err) {
      this.logger.warn(`Initialisation du paiement ${paymentId} sans réponse du prestataire : ${(err as Error).message}`);
    }
    return { ...(await this.view(userId, paymentId)), nextAction };
  }

  // ------------------------------------------------------------------ lecture

  async view(userId: string, paymentId: string) {
    const p = await this.db
      .selectFrom('payments')
      .innerJoin('bookings', 'bookings.id', 'payments.booking_id')
      .select([
        'payments.id', 'payments.booking_id', 'payments.status', 'payments.method', 'payments.amount_xof', 'payments.payer_phone_masked',
        'payments.expires_at', 'payments.succeeded_at', 'payments.failure_code', 'payments.failure_message', 'payments.created_at',
        'payments.provider', 'bookings.passenger_id', 'bookings.status as booking_status', 'bookings.payment_status as booking_payment_status',
        'bookings.reference', 'bookings.hold_expires_at',
      ])
      .where('payments.id', '=', paymentId)
      .executeTakeFirst();
    if (!p || p.passenger_id !== userId) throw notFound();
    return {
      id: p.id,
      bookingId: p.booking_id,
      bookingReference: p.reference,
      status: p.status,
      method: p.method,
      amountXof: p.amount_xof,
      payerPhoneMasked: p.payer_phone_masked,
      expiresAt: p.expires_at,
      holdExpiresAt: p.hold_expires_at,
      succeededAt: p.succeeded_at,
      failureMessage: p.failure_message,
      createdAt: p.created_at,
      sandbox: this.provider.isSandbox && p.provider === this.provider.code,
      booking: { status: p.booking_status, paymentStatus: p.booking_payment_status },
    };
  }

  /**
   * Statut vu par le serveur. Le retour de la page de paiement ne change rien : si le paiement est en attente
   * depuis un moment, le serveur interroge lui-même le prestataire avant de répondre (doc 04 §9, doc 05 §5.6).
   */
  async status(userId: string, paymentId: string) {
    const v = await this.view(userId, paymentId);
    if (v.status === 'CREATED' || v.status === 'PENDING') {
      const after = (await this.settings.get<number>('payments.status_poll_after_seconds')) ?? 30;
      const p = await this.db.selectFrom('payments').select(['created_at', 'last_polled_at']).where('id', '=', paymentId).executeTakeFirstOrThrow();
      const now = Date.now();
      const recentlyPolled = p.last_polled_at !== null && now - p.last_polled_at.getTime() < 10_000;
      if (now - p.created_at.getTime() >= after * 1000 && !recentlyPolled) {
        await this.pollOne(paymentId, new Date(now));
        return this.view(userId, paymentId);
      }
    }
    return v;
  }

  // ------------------------------------------------------------------ événements du prestataire (doc 05 §5.2)

  /** Point d'entrée des webhooks : signature et horodatage vérifiés AVANT toute lecture du contenu. */
  async receiveWebhook(providerCode: string, rawBody: Buffer | undefined, headers: Record<string, string | string[] | undefined>) {
    if (providerCode !== this.provider.code) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Prestataire inconnu.');
    if (!rawBody?.length) throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Corps vide.');
    const check = this.provider.verifyWebhook(rawBody, headers);
    if (!check.valid) {
      // Rien n'est enregistré dans payment_events : un tiers ne doit pas pouvoir y réserver des identifiants d'événement.
      this.logger.warn(`Webhook ${providerCode} refusé : ${check.reason}`);
      await this.audit.log({ actorId: null, action: 'payment.webhook_rejected', targetType: 'provider', changes: { provider: providerCode, reason: check.reason } });
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'INVALID_SIGNATURE', 'Signature invalide.');
    }
    let event: NormalizedPaymentEvent;
    try {
      event = this.provider.parseWebhook(rawBody);
    } catch {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Événement illisible.');
    }
    if (event.eventType !== 'payment.updated') {
      // Les remboursements du bac à sable sont confirmés de façon synchrone ; un vrai prestataire les notifiera ici.
      return { received: true, result: 'IGNORED' };
    }
    const result = await this.applyEvent(event, 'WEBHOOK', rawBody.toString('utf8'));
    return { received: true, result };
  }

  /**
   * Traitement idempotent d'un événement vérifié. Verrous dans le même ordre que les réservations (trajet, réservation,
   * paiement) : aucun interblocage avec les annulations et l'expiration des blocages.
   */
  async applyEvent(event: NormalizedPaymentEvent, source: 'WEBHOOK' | 'POLL', rawPayload: string): Promise<PaymentEventResult> {
    const paymentId = isUuid(event.merchantReference) ? event.merchantReference : null;
    const head = paymentId
      ? await this.db
          .selectFrom('payments')
          .innerJoin('bookings', 'bookings.id', 'payments.booking_id')
          .select(['payments.id', 'bookings.id as booking_id', 'bookings.trip_id'])
          .where('payments.id', '=', paymentId)
          .executeTakeFirst()
      : undefined;
    let refundBooking: string | null = null;
    const result = await this.db.transaction().execute(async (trx) => {
      // Verrous d'abord : l'insertion de l'événement pose un verrou de clé sur le paiement, qui bloquerait le
      // FOR UPDATE d'un traitement concurrent (interblocage).
      const locked = head
        ? {
            trip: await trx.selectFrom('trips').select(['id', 'status', 'seats_offered']).where('id', '=', head.trip_id).forUpdate().executeTakeFirstOrThrow(),
            booking: await this.lockBooking(trx, head.booking_id),
            payment: (await this.lockPayment(trx, head.id))!,
          }
        : null;
      const inserted = await trx
        .insertInto('payment_events')
        .values({
          id: uuidv7(),
          payment_id: head?.id ?? null,
          provider: this.provider.code,
          provider_event_id: event.providerEventId,
          source,
          event_type: event.eventType,
          reported_status: event.status,
          amount_xof: event.amountXof,
          signature_valid: source === 'WEBHOOK',
          raw_payload: rawPayload,
          occurred_at: event.occurredAt,
        })
        .onConflict((oc) => oc.columns(['provider', 'provider_event_id']).doNothing())
        .returning('id')
        .executeTakeFirst();
      if (!inserted) return 'DUPLICATE' as const;
      const done = async (r: PaymentEventResult) => {
        await trx.updateTable('payment_events').set({ processed_at: new Date(), processing_result: r }).where('id', '=', inserted.id).execute();
        return r;
      };
      if (!locked) return done('REJECTED');
      const { trip, booking, payment } = locked;
      if (payment.provider !== this.provider.code || (payment.provider_reference && payment.provider_reference !== event.providerReference)) {
        return done('REJECTED');
      }
      if (event.amountXof !== payment.amount_xof || event.currency !== 'XOF') {
        // Montant ou devise différents : aucune confirmation, paiement à examiner (alerte finance).
        await outbox(trx, 'payment', payment.id, 'payment.mismatch', { reportedAmountXof: event.amountXof, expectedAmountXof: payment.amount_xof, currency: event.currency });
        return done('MISMATCH');
      }
      const r = await this.transition(trx, { trip, booking, payment }, event);
      if (r.refund) refundBooking = booking.id;
      return done(r.result);
    });
    if (refundBooking) await this.refunds.processBooking(refundBooking).catch((err: Error) => this.logger.error(`Remboursement ${refundBooking} : ${err.message}`));
    return result;
  }

  private async transition(trx: Transaction<Database>, l: Locked, event: NormalizedPaymentEvent): Promise<{ result: PaymentEventResult; refund?: boolean }> {
    const p = l.payment;
    const finalStatuses: PaymentStatus[] = ['SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED'];
    if (event.status === 'PENDING') {
      if (p.status === 'CREATED') {
        await trx.updateTable('payments').set({ status: 'PENDING', provider_reference: event.providerReference }).where('id', '=', p.id).execute();
        return { result: 'APPLIED' };
      }
      return { result: p.status === 'PENDING' ? 'DUPLICATE' : 'IGNORED_STALE' };
    }

    if (event.status === 'SUCCEEDED') {
      if (p.status === 'SUCCEEDED') return { result: 'DUPLICATE' };
      if (p.status === 'CANCELLED') {
        await outbox(trx, 'payment', p.id, 'payment.alert', { issue: 'SUCCESS_AFTER_CANCEL' });
        return { result: 'IGNORED_STALE' };
      }
      // Le prestataire fait foi : un succès vérifié s'applique même après un échec ou une expiration enregistrés.
      await trx
        .updateTable('payments')
        .set({ status: 'SUCCEEDED', succeeded_at: event.occurredAt, provider_reference: event.providerReference, failure_code: null, failure_message: null })
        .where('id', '=', p.id)
        .execute();
      return { result: 'APPLIED', refund: await this.applySuccess(trx, l) };
    }

    // Échec définitif (refus, annulation par le payeur, expiration chez le prestataire).
    if (p.status === 'SUCCEEDED') {
      // Un succès vérifié n'est jamais annulé automatiquement : revue humaine.
      await outbox(trx, 'payment', p.id, 'payment.alert', { issue: 'FAILURE_AFTER_SUCCESS', reported: event.status });
      return { result: 'IGNORED_STALE' };
    }
    if (finalStatuses.includes(p.status)) return { result: 'DUPLICATE' };
    const target = event.status === 'EXPIRED' ? ('EXPIRED' as const) : ('FAILED' as const);
    const code = event.status === 'CANCELLED' ? 'CANCELLED_BY_PAYER' : event.status === 'EXPIRED' ? 'EXPIRED' : (event.failureCode ?? 'DECLINED');
    await trx
      .updateTable('payments')
      .set({ status: target, failure_code: code, failure_message: FAILURE_MESSAGE[code] ?? FAILURE_MESSAGE.DECLINED!, provider_reference: p.provider_reference ?? event.providerReference })
      .where('id', '=', p.id)
      .execute();
    // La réservation reste en attente de paiement tant que le blocage court : le passager peut réessayer (doc 05 §5.5).
    if (l.booking.payment_status === 'PROCESSING') {
      await trx.updateTable('bookings').set({ payment_status: 'UNPAID' }).where('id', '=', l.booking.id).execute();
    }
    await outbox(trx, 'payment', p.id, 'payment.failed', { bookingId: l.booking.id, passengerId: l.booking.passenger_id, code });
    return { result: 'APPLIED' };
  }

  /** Effets d'un paiement réussi (doc 05 §5.3 et §5.4). Renvoie true si un remboursement est à exécuter. */
  private async applySuccess(trx: Transaction<Database>, { trip, booking: b, payment: p }: Locked): Promise<boolean> {
    const now = new Date();
    const lateMinutes = (await this.settings.get<number>('payments.late_reactivation_minutes')) ?? 30;
    const tripOpen = ['PUBLISHED', 'FULL'].includes(trip.status);
    const seatsFree = async () => {
      const { rows } = await sql<{ occ: number }>`SELECT trip_max_occupancy(${trip.id}::uuid, ${b.pickup_seq}, ${b.dropoff_seq}) AS occ`.execute(trx);
      return trip.seats_offered - Number(rows[0]!.occ) >= b.seats;
    };

    let confirm = false;
    if (b.status === 'PENDING_PAYMENT') {
      // Blocage encore valable : les places sont à lui. Échu mais pas encore traité : mêmes règles que la réactivation.
      confirm = (b.hold_expires_at !== null && b.hold_expires_at > now) || (tripOpen && (await seatsFree()));
    } else if (b.status === 'EXPIRED') {
      const recent = b.expired_at !== null && now.getTime() - b.expired_at.getTime() <= lateMinutes * MINUTE;
      confirm = recent && tripOpen && (await seatsFree());
    }

    if (confirm) {
      await setActor(trx, null, 'Paiement confirmé par le prestataire');
      await trx
        .updateTable('bookings')
        .set({ status: 'CONFIRMED', payment_status: 'PAID', payment_method: p.method, confirmed_at: now, hold_expires_at: null })
        .where('id', '=', b.id)
        .execute();
      await trx
        .insertInto('commissions')
        .values({
          id: uuidv7(),
          booking_id: b.id,
          driver_id: b.driver_id,
          gross_xof: b.subtotal_xof,
          commission_xof: b.commission_xof,
          service_fee_xof: b.service_fee_xof,
          driver_net_xof: b.driver_net_xof,
        })
        .execute();
      await postJournal(
        trx,
        paymentLines({
          subtotalXof: b.subtotal_xof,
          serviceFeeXof: b.service_fee_xof,
          discountXof: b.discount_xof,
          totalXof: b.total_xof,
          commissionXof: b.commission_xof,
          driverNetXof: b.driver_net_xof,
        }),
        { bookingId: b.id, paymentId: p.id, description: `Paiement ${b.reference}` },
      );
      await syncTripFullStatus(trx, trip.id);
      await outbox(trx, 'booking', b.id, 'payment.succeeded', { passengerId: b.passenger_id, driverId: b.driver_id, amountXof: p.amount_xof });
      return false;
    }

    // Réservation qui ne peut plus être honorée : remboursement intégral automatique (LATE_PAYMENT).
    await setActor(trx, null, 'Paiement arrivé après expiration');
    await trx
      .updateTable('bookings')
      .set({
        ...(b.status === 'PENDING_PAYMENT' ? { status: 'EXPIRED' as const, expired_at: now } : {}),
        payment_status: 'REFUND_PENDING',
        refund_due_xof: p.amount_xof,
        service_fee_refund_xof: b.service_fee_xof,
        driver_compensation_xof: 0,
        refund_reason: 'LATE_PAYMENT',
      })
      .where('id', '=', b.id)
      .execute();
    await postJournal(trx, unallocatedPaymentLines(p.amount_xof), { bookingId: b.id, paymentId: p.id, description: `Paiement tardif ${b.reference}` });
    if (b.status === 'PENDING_PAYMENT') await syncTripFullStatus(trx, trip.id);
    await outbox(trx, 'booking', b.id, 'payment.late', { passengerId: b.passenger_id, amountXof: p.amount_xof });
    await outbox(trx, 'booking', b.id, 'refund.requested', { amountXof: p.amount_xof, reason: 'LATE_PAYMENT' });
    return true;
  }

  // ------------------------------------------------------------------ rattrapage

  /** Interroge le prestataire pour un paiement resté en attente ; à l'échéance, il est clos comme expiré. */
  async pollOne(paymentId: string, now: Date = new Date()): Promise<PaymentEventResult | null> {
    const p = await this.db
      .updateTable('payments')
      .set({ last_polled_at: now })
      .where('id', '=', paymentId)
      .where('status', 'in', ['CREATED', 'PENDING'])
      .returning(['id', 'provider', 'provider_reference', 'amount_xof', 'expires_at'])
      .executeTakeFirst();
    if (!p || p.provider !== this.provider.code) return null;
    let status: ProviderStatus | null = null;
    try {
      status = p.provider_reference
        ? await this.provider.getPaymentStatus(p.provider_reference)
        : ((await this.provider.findByMerchantReference?.(p.id)) ?? null);
    } catch (err) {
      this.logger.warn(`Interrogation du paiement ${p.id} impossible : ${(err as Error).message}`);
    }
    if (status && status.status !== 'PENDING') {
      return this.applyEvent({ ...status, providerEventId: `poll:${status.providerReference}:${status.status}`, eventType: 'payment.updated' }, 'POLL', JSON.stringify(status));
    }
    if (status?.status === 'PENDING' && !p.provider_reference) {
      // Réponse d'initialisation perdue : la référence du prestataire est retrouvée.
      await this.applyEvent({ ...status, providerEventId: `poll:${status.providerReference}:PENDING`, eventType: 'payment.updated' }, 'POLL', JSON.stringify(status));
    }
    if (now > p.expires_at) {
      // Plus rien à attendre : clos comme expiré (ou introuvable chez le prestataire). Un succès ultérieur vérifié
      // reste applicable et suit la règle du paiement tardif.
      const reference = status?.providerReference ?? p.provider_reference ?? '';
      const code = status ? 'EXPIRED' : 'NOT_FOUND_AT_PROVIDER';
      return this.applyEvent(
        {
          providerEventId: `timeout:${p.id}`,
          eventType: 'payment.updated',
          providerReference: reference,
          merchantReference: p.id,
          status: status ? 'EXPIRED' : 'FAILED',
          amountXof: p.amount_xof,
          currency: 'XOF',
          occurredAt: now,
          failureCode: code,
        },
        'POLL',
        JSON.stringify({ timeout: true, code }),
      );
    }
    return null;
  }

  /** Paiements en attente depuis plus d'une minute, interrogés au plus une fois par minute. */
  async pollStale(now: Date = new Date()): Promise<number> {
    const due = await this.db
      .selectFrom('payments')
      .select('id')
      .where('status', 'in', ['CREATED', 'PENDING'])
      .where('created_at', '<=', new Date(now.getTime() - MINUTE))
      .where((eb) => eb.or([eb('last_polled_at', 'is', null), eb('last_polled_at', '<=', new Date(now.getTime() - MINUTE))]))
      .orderBy('created_at')
      .limit(100)
      .execute();
    for (const d of due) await this.pollOne(d.id, now).catch((err: Error) => this.logger.error(`Paiement ${d.id} : ${err.message}`));
    return due.length;
  }

  // ------------------------------------------------------------------ verrous

  async lockBooking(trx: Transaction<Database>, bookingId: string) {
    return trx
      .selectFrom('bookings')
      .innerJoin('trips', 'trips.id', 'bookings.trip_id')
      .selectAll('bookings')
      .select('trips.driver_id')
      .where('bookings.id', '=', bookingId)
      .forUpdate('bookings')
      .executeTakeFirstOrThrow();
  }

  async lockPayment(trx: Transaction<Database>, paymentId: string) {
    return trx.selectFrom('payments').selectAll().where('id', '=', paymentId).forUpdate().executeTakeFirst();
  }

  // ------------------------------------------------------------------ historique (écran 14)

  async transactions(userId: string, cursor?: string, limit = 20) {
    const offset = cursor ? Number(Buffer.from(cursor, 'base64url').toString()) || 0 : 0;
    const { rows } = await sql<{
      kind: 'PAYMENT' | 'REFUND';
      id: string;
      booking_id: string;
      reference: string;
      amount_xof: number;
      status: string;
      method: string | null;
      reason: string | null;
      created_at: Date;
      origin: string;
      destination: string;
    }>`
      SELECT * FROM (
        SELECT 'PAYMENT' AS kind, p.id, p.booking_id, b.reference, p.amount_xof, p.status::text, p.method::text, NULL AS reason, p.created_at,
               ps.label AS origin, ds.label AS destination
          FROM payments p JOIN bookings b ON b.id = p.booking_id
          JOIN trip_stops ps ON ps.id = b.pickup_stop_id JOIN trip_stops ds ON ds.id = b.dropoff_stop_id
         WHERE b.passenger_id = ${userId}::uuid
        UNION ALL
        SELECT 'REFUND', r.id, r.booking_id, b.reference, r.amount_xof, r.status::text, NULL, r.reason_code, r.created_at,
               ps.label, ds.label
          FROM refunds r JOIN bookings b ON b.id = r.booking_id
          JOIN trip_stops ps ON ps.id = b.pickup_stop_id JOIN trip_stops ds ON ds.id = b.dropoff_stop_id
         WHERE b.passenger_id = ${userId}::uuid
      ) t ORDER BY created_at DESC, id DESC LIMIT ${limit + 1} OFFSET ${offset}`.execute(this.db);
    return {
      data: rows.slice(0, limit).map((r) => ({
        kind: r.kind,
        id: r.id,
        bookingId: r.booking_id,
        bookingReference: r.reference,
        amountXof: Number(r.amount_xof),
        status: r.status,
        method: r.method,
        reason: r.reason,
        createdAt: r.created_at,
        route: `${r.origin} → ${r.destination}`,
      })),
      nextCursor: rows.length > limit ? Buffer.from(String(offset + limit)).toString('base64url') : null,
    };
  }

  /** Gains du conducteur par trajet : brut, commission, net, ajustements après annulation, statut de versement. */
  async earnings(driverId: string, from?: Date, to?: Date) {
    let q = this.db
      .selectFrom('commissions')
      .innerJoin('bookings', 'bookings.id', 'commissions.booking_id')
      .innerJoin('trips', 'trips.id', 'bookings.trip_id')
      .select([
        'commissions.id', 'commissions.gross_xof', 'commissions.commission_xof', 'commissions.driver_net_xof', 'commissions.adjusted_xof',
        'commissions.status', 'commissions.payable_at', 'bookings.reference', 'bookings.status as booking_status', 'bookings.seats',
        'trips.id as trip_id', 'trips.public_ref', 'trips.departure_at', 'trips.status as trip_status',
        sql<string>`(SELECT label FROM trip_stops s WHERE s.trip_id = trips.id ORDER BY seq LIMIT 1)`.as('origin'),
        sql<string>`(SELECT label FROM trip_stops s WHERE s.trip_id = trips.id ORDER BY seq DESC LIMIT 1)`.as('destination'),
      ])
      .where('commissions.driver_id', '=', driverId)
      .orderBy('trips.departure_at', 'desc');
    if (from) q = q.where('trips.departure_at', '>=', from);
    if (to) q = q.where('trips.departure_at', '<', to);
    const rows = await q.limit(500).execute();
    const due = (r: (typeof rows)[number]) => (r.status === 'VOID' ? 0 : Number(r.driver_net_xof) + Number(r.adjusted_xof));
    const trips = new Map<string, { tripId: string; publicRef: string; departureAt: Date; tripStatus: string; origin: string; destination: string; bookings: unknown[]; dueXof: number }>();
    for (const r of rows) {
      const t = trips.get(r.trip_id) ?? { tripId: r.trip_id, publicRef: r.public_ref, departureAt: r.departure_at, tripStatus: r.trip_status, origin: r.origin, destination: r.destination, bookings: [], dueXof: 0 };
      t.bookings.push({
        reference: r.reference,
        bookingStatus: r.booking_status,
        seats: r.seats,
        grossXof: Number(r.gross_xof),
        commissionXof: Number(r.commission_xof),
        netXof: Number(r.driver_net_xof),
        adjustmentXof: Number(r.adjusted_xof),
        dueXof: due(r),
        status: r.status,
        payableAt: r.payable_at,
      });
      t.dueXof += due(r);
      trips.set(r.trip_id, t);
    }
    const sum = (pred: (r: (typeof rows)[number]) => boolean) => rows.filter(pred).reduce((s, r) => s + due(r), 0);
    return {
      totals: {
        grossXof: rows.filter((r) => r.status !== 'VOID').reduce((s, r) => s + Number(r.gross_xof), 0),
        commissionXof: rows.filter((r) => r.status !== 'VOID').reduce((s, r) => s + Number(r.commission_xof), 0),
        pendingXof: sum((r) => r.status === 'PENDING'),
        payableXof: sum((r) => r.status === 'PAYABLE' || r.status === 'IN_PAYOUT'),
        paidXof: sum((r) => r.status === 'PAID'),
      },
      trips: [...trips.values()],
      // Versements aux conducteurs : procédure à définir avec le prestataire (étape 9, écran finance).
      payoutsAvailable: false,
    };
  }
}
