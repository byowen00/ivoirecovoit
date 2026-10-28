import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { ApiError } from '../../common/api-error';
import { bookingReference, uuidv7 } from '../../common/ids';
import { DB, type Db } from '../../database/database.module';
import type { BookingStatus, Database, RefundReason, TripKind } from '../../database/types';
import { AuditService, type RequestContext } from '../../infra/audit.service';
import { RefundsService } from '../payments/refunds.service';
import { SettingsService } from '../users/settings.service';
import {
  type BookingAmounts,
  type CancellationOutcome,
  computeAmounts,
  driverCancellation,
  type FeeRule,
  passengerCancellation,
  type PolicyRules,
} from './amounts';
import type { CreateBookingInput, MineBookingsQuery, QuoteInput } from './bookings.schemas';
import { BLOCKING_STATUSES, outbox, PENDING_STATUSES, setActor, syncTripFullStatus } from './lifecycle';
import { findPromotion, reservePromotion } from './promotions';

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Réservation introuvable.');
const tripNotFound = () => new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Trajet introuvable.');
const unprocessable = (code: string, message: string, details?: Record<string, unknown>) =>
  new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, code, message, details);
const conflict = (code: string, message: string, details?: Record<string, unknown>) =>
  new ApiError(HttpStatus.CONFLICT, code, message, details);

const MINUTE = 60_000;
const HOUR = 3_600_000;

interface BookingRules {
  holdMinutes: number;
  minMinutesBeforeDeparture: number;
  manualAcceptanceHours: number;
  manualMinHoursBeforeDeparture: number;
  manualDeadlineHoursBeforeDeparture: number;
  maxPendingPerPassenger: number;
  maxSeatsPerBooking: number;
  noShowDelayMinutes: number;
  lateDriverFreeCancelMinutes: number;
  cashEnabled: boolean;
  maxCreationsPerHour: number;
}

interface Segment {
  trip: {
    id: string;
    driver_id: string;
    status: string;
    kind: TripKind;
    seats_offered: number;
    departure_at: Date;
    acceptance_mode: 'AUTO' | 'MANUAL';
    allows_cash: boolean;
    cancellation_policy_code: string;
  };
  pickup: { id: string; seq: number; label: string; planned_at: Date; price: number };
  dropoff: { id: string; seq: number; label: string; planned_at: Date; price: number };
}

/** Phrase lisible résumant une politique d'annulation passager. */
export function policySummary(rules: PolicyRules): string {
  const sorted = [...rules.passenger].sort((a, b) => b.minHoursBefore - a.minHoursBefore);
  const parts = sorted.map((r, i) =>
    i === sorted.length - 1 || r.minHoursBefore === 0
      ? `${r.refundPercent} % ensuite`
      : `${r.refundPercent} % jusqu’à ${r.minHoursBefore} h avant le départ`,
  );
  return `Remboursement de la part trajet : ${parts.join(', ')}. Frais de service non remboursés, sauf annulation dans les ${rules.serviceFeeRefundableWithinMinutes ?? 0} min suivant la confirmation et plus de 24 h avant le départ.`;
}

/**
 * Réservations (doc 05 §2, §3, §7) : devis, création sous verrou du trajet (anti-survente), acceptation,
 * refus, annulation, absence. Le paiement mobile est géré par PaymentsService ; une réservation PENDING_PAYMENT
 * non payée expire à la fin de son blocage, et les remboursements dus sont exécutés par RefundsService.
 */
@Injectable()
export class BookingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly refunds: RefundsService,
  ) {}

  async rules(): Promise<BookingRules> {
    const keys = [
      'booking.hold_minutes', 'booking.min_minutes_before_departure', 'booking.manual_acceptance_hours',
      'booking.manual_min_hours_before_departure', 'booking.manual_deadline_hours_before_departure',
      'booking.max_pending_per_passenger', 'booking.max_seats_per_booking', 'booking.no_show_delay_minutes',
      'booking.late_driver_free_cancel_minutes', 'payments.cash_enabled', 'booking.max_creations_per_hour',
    ];
    const v = await Promise.all(keys.map((k) => this.settings.get<number | boolean>(k)));
    const n = (i: number, d: number) => (typeof v[i] === 'number' ? (v[i] as number) : d);
    return {
      holdMinutes: n(0, 15),
      minMinutesBeforeDeparture: n(1, 30),
      manualAcceptanceHours: n(2, 12),
      manualMinHoursBeforeDeparture: n(3, 3),
      manualDeadlineHoursBeforeDeparture: n(4, 2),
      maxPendingPerPassenger: n(5, 3),
      maxSeatsPerBooking: n(6, 4),
      noShowDelayMinutes: n(7, 15),
      lateDriverFreeCancelMinutes: n(8, 30),
      cashEnabled: v[9] === true,
      maxCreationsPerHour: n(10, 10),
    };
  }

  /** Règle de frais en vigueur : une règle propre au type de trajet l'emporte sur la règle générale. */
  private async feeRule(trx: Db | Transaction<Database>, kind: TripKind): Promise<FeeRule> {
    const rule = await trx
      .selectFrom('fee_rules')
      .select([
        'id', 'commission_bps', 'commission_fixed_xof', 'commission_min_xof', 'commission_max_xof',
        'service_fee_bps', 'service_fee_fixed_xof', 'service_fee_min_xof', 'service_fee_max_xof',
      ])
      .where('effective_from', '<=', new Date())
      .where((eb) => eb.or([eb('effective_to', 'is', null), eb('effective_to', '>', new Date())]))
      .where((eb) => eb.or([eb('trip_kind', '=', kind), eb('trip_kind', 'is', null)]))
      .orderBy(sql`trip_kind IS NULL`)
      .limit(1)
      .executeTakeFirst();
    if (!rule) {
      // Pas de commission imposée sans validation commerciale : sans règle en base, on ne réserve pas.
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'FEES_NOT_CONFIGURED', 'Les réservations ne sont pas encore ouvertes.');
    }
    return rule;
  }

  private async policy(trx: Db | Transaction<Database>, code: string) {
    const p = await trx.selectFrom('cancellation_policies').select(['code', 'label', 'rules']).where('code', '=', code).executeTakeFirstOrThrow();
    const rules = p.rules as unknown as PolicyRules;
    return { code: p.code, label: p.label, rules, summary: policySummary(rules) };
  }

  private async segment(trx: Db | Transaction<Database>, input: Pick<QuoteInput, 'tripId' | 'pickupStopId' | 'dropoffStopId'>, lock = false): Promise<Segment> {
    let q = trx
      .selectFrom('trips')
      .select(['id', 'driver_id', 'status', 'kind', 'seats_offered', 'departure_at', 'acceptance_mode', 'allows_cash', 'cancellation_policy_code'])
      .where('id', '=', input.tripId)
      .where('status', '<>', 'DRAFT');
    if (lock) q = q.forUpdate();
    const trip = await q.executeTakeFirst();
    if (!trip) throw tripNotFound();
    const stops = await trx
      .selectFrom('trip_stops')
      .select(['id', 'seq', 'label', 'planned_at', 'price_from_origin_xof', 'is_pickup', 'is_dropoff'])
      .where('trip_id', '=', input.tripId)
      .where('id', 'in', [input.pickupStopId, input.dropoffStopId])
      .execute();
    const p = stops.find((s) => s.id === input.pickupStopId);
    const d = stops.find((s) => s.id === input.dropoffStopId);
    if (!p || !d || d.seq <= p.seq || !p.is_pickup || !d.is_dropoff) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'INVALID_SEGMENT', 'Le point de descente doit suivre le point de montée.');
    }
    const stop = (s: typeof p) => ({ id: s.id, seq: s.seq, label: s.label, planned_at: s.planned_at, price: s.price_from_origin_xof });
    return { trip, pickup: stop(p), dropoff: stop(d) };
  }

  private async seatsAvailable(trx: Db | Transaction<Database>, seg: Segment): Promise<number> {
    const { rows } = await sql<{ occ: number }>`SELECT trip_max_occupancy(${seg.trip.id}::uuid, ${seg.pickup.seq}, ${seg.dropoff.seq}) AS occ`.execute(trx);
    return Math.max(0, seg.trip.seats_offered - (rows[0]?.occ ?? 0));
  }

  private bookableChecks(seg: Segment, rules: BookingRules, seats: number, userId: string | undefined) {
    if (!['PUBLISHED', 'FULL'].includes(seg.trip.status)) {
      throw conflict('TRIP_NOT_BOOKABLE', 'Ce trajet n’accepte plus de réservation.');
    }
    if (userId && seg.trip.driver_id === userId) {
      throw unprocessable('OWN_TRIP', 'Vous ne pouvez pas réserver votre propre trajet.');
    }
    if (seg.trip.departure_at.getTime() < Date.now() + rules.minMinutesBeforeDeparture * MINUTE) {
      throw unprocessable('TOO_CLOSE_TO_DEPARTURE', `Les réservations ferment ${rules.minMinutesBeforeDeparture} min avant le départ.`);
    }
    const maxSeats = Math.min(rules.maxSeatsPerBooking, seg.trip.seats_offered);
    if (seats > maxSeats) {
      throw unprocessable('TOO_MANY_SEATS', `${maxSeats} place${maxSeats > 1 ? 's' : ''} au maximum par réservation.`, { maxSeats });
    }
  }

  /** Mode d'acceptation effectif et échéance (doc 05 §4). */
  private acceptance(seg: Segment, rules: BookingRules, now: number) {
    const dep = seg.trip.departure_at.getTime();
    if (seg.trip.acceptance_mode === 'AUTO') return { mode: 'AUTO' as const, deadline: null };
    if (dep < now + rules.manualMinHoursBeforeDeparture * HOUR) {
      throw unprocessable(
        'MANUAL_TOO_LATE',
        `Ce conducteur accepte chaque demande : il faut réserver au moins ${rules.manualMinHoursBeforeDeparture} h avant le départ.`,
      );
    }
    const deadline = Math.min(now + rules.manualAcceptanceHours * HOUR, dep - rules.manualDeadlineHoursBeforeDeparture * HOUR);
    return { mode: 'MANUAL' as const, deadline: new Date(deadline) };
  }

  private amountsView(a: BookingAmounts) {
    return {
      seats: a.seats, unitPriceXof: a.unitPriceXof, subtotalXof: a.subtotalXof, serviceFeeXof: a.serviceFeeXof,
      discountXof: a.discountXof, totalXof: a.totalXof,
    };
  }

  /** Montants avec, le cas échéant, la réduction du code promo (vérifié mais pas réservé). */
  private async amountsWithPromo(trx: Db | Transaction<Database>, userId: string, seg: Segment, seats: number, fee: FeeRule, code?: string) {
    const base = computeAmounts(seg.dropoff.price - seg.pickup.price, seats, fee);
    if (!code) return { amounts: base, promotion: null };
    const promotion = await findPromotion(trx, userId, code, base.subtotalXof + base.serviceFeeXof);
    return { amounts: computeAmounts(seg.dropoff.price - seg.pickup.price, seats, fee, promotion), promotion };
  }

  // ------------------------------------------------------------------ devis et création

  async quote(userId: string, input: QuoteInput) {
    const rules = await this.rules();
    const seg = await this.segment(this.db, input);
    this.bookableChecks(seg, rules, input.seats, userId);
    const [available, fee, policy] = await Promise.all([
      this.seatsAvailable(this.db, seg),
      this.feeRule(this.db, seg.trip.kind),
      this.policy(this.db, seg.trip.cancellation_policy_code),
    ]);
    const { amounts, promotion } = await this.amountsWithPromo(this.db, userId, seg, input.seats, fee, input.promoCode);
    const acceptance = this.acceptance(seg, rules, Date.now());
    return {
      tripId: seg.trip.id,
      promoCode: promotion?.code ?? null,
      pickup: { stopId: seg.pickup.id, label: seg.pickup.label, plannedAt: seg.pickup.planned_at },
      dropoff: { stopId: seg.dropoff.id, label: seg.dropoff.label, plannedAt: seg.dropoff.planned_at },
      ...this.amountsView(amounts),
      seatsAvailable: available,
      acceptanceMode: acceptance.mode,
      acceptanceDeadline: acceptance.deadline,
      holdMinutes: rules.holdMinutes,
      cashAllowed: rules.cashEnabled && seg.trip.allows_cash,
      cancellationPolicy: policy,
      isEstimate: false,
    };
  }

  async create(userId: string, input: CreateBookingInput, ctx: RequestContext) {
    const rules = await this.rules();
    const id = uuidv7();
    try {
      await this.db.transaction().execute(async (trx) => {
        // Verrou exclusif sur le trajet : les réservations d'un même trajet passent l'une après l'autre (doc 05 §3).
        const seg = await this.segment(trx, input, true);
        this.bookableChecks(seg, rules, input.seats, userId);
        const cash = input.paymentMethod === 'CASH';
        if (cash && !(rules.cashEnabled && seg.trip.allows_cash)) {
          throw unprocessable('CASH_NOT_ALLOWED', 'Le paiement en espèces n’est pas proposé pour ce trajet.');
        }
        const already = await trx
          .selectFrom('bookings')
          .select('id')
          .where('trip_id', '=', seg.trip.id)
          .where('passenger_id', '=', userId)
          .where('status', 'in', BLOCKING_STATUSES)
          .executeTakeFirst();
        if (already) throw conflict('ALREADY_BOOKED', 'Vous avez déjà une réservation en cours sur ce trajet.', { bookingId: already.id });
        const pending = await trx
          .selectFrom('bookings')
          .select(sql<number>`count(*)::int`.as('n'))
          .where('passenger_id', '=', userId)
          .where('status', 'in', PENDING_STATUSES)
          .where('hold_expires_at', '>', new Date())
          .executeTakeFirstOrThrow();
        if (pending.n >= rules.maxPendingPerPassenger) {
          throw unprocessable('TOO_MANY_PENDING', `Vous avez déjà ${pending.n} réservations en attente. Finalisez-les ou annulez-en une.`);
        }
        const available = await this.seatsAvailable(trx, seg);
        if (input.seats > available) {
          throw conflict('SEATS_UNAVAILABLE', available > 0 ? `Il ne reste que ${available} place${available > 1 ? 's' : ''} sur ce segment.` : 'Plus aucune place sur ce segment.', {
            seatsAvailable: available,
          });
        }
        const fee = await this.feeRule(trx, seg.trip.kind);
        const { amounts, promotion } = await this.amountsWithPromo(trx, userId, seg, input.seats, fee, input.promoCode);
        if (promotion && amounts.discountXof > 0) await reservePromotion(trx, promotion.id);
        const now = Date.now();
        const acceptance = this.acceptance(seg, rules, now);
        const status: BookingStatus = acceptance.mode === 'MANUAL' ? 'PENDING_ACCEPTANCE' : cash ? 'CONFIRMED' : 'PENDING_PAYMENT';
        await setActor(trx, userId, null);
        await trx
          .insertInto('bookings')
          .values({
            id,
            reference: bookingReference(),
            trip_id: seg.trip.id,
            passenger_id: userId,
            pickup_stop_id: seg.pickup.id,
            dropoff_stop_id: seg.dropoff.id,
            pickup_seq: seg.pickup.seq,
            dropoff_seq: seg.dropoff.seq,
            seats: input.seats,
            status,
            payment_status: status === 'CONFIRMED' ? 'CASH_DUE' : 'UNPAID',
            payment_method: cash ? 'CASH' : null,
            unit_price_xof: amounts.unitPriceXof,
            subtotal_xof: amounts.subtotalXof,
            service_fee_xof: amounts.serviceFeeXof,
            discount_xof: amounts.discountXof,
            total_xof: amounts.totalXof,
            commission_xof: amounts.commissionXof,
            driver_net_xof: amounts.driverNetXof,
            fee_rule_id: fee.id,
            promotion_id: promotion && amounts.discountXof > 0 ? promotion.id : null,
            cancellation_policy_code: seg.trip.cancellation_policy_code,
            acceptance_deadline: acceptance.deadline,
            // En attente d'acceptation, le blocage dure jusqu'à l'échéance d'acceptation.
            hold_expires_at: status === 'CONFIRMED' ? null : (acceptance.deadline ?? new Date(now + rules.holdMinutes * MINUTE)),
            confirmed_at: status === 'CONFIRMED' ? new Date(now) : null,
          })
          .execute();
        if (promotion && amounts.discountXof > 0) {
          await trx
            .insertInto('promotion_redemptions')
            .values({ id: uuidv7(), promotion_id: promotion.id, user_id: userId, booking_id: id, amount_xof: amounts.discountXof, status: status === 'CONFIRMED' ? 'USED' : 'RESERVED' })
            .execute();
        }
        await syncTripFullStatus(trx, seg.trip.id);
        await outbox(trx, 'booking', id, 'booking.created', { status, tripId: seg.trip.id, driverId: seg.trip.driver_id });
        await this.audit.log({ actorId: userId, action: 'booking.create', targetType: 'booking', targetId: id, changes: { status, seats: input.seats }, ctx }, trx);
      });
    } catch (err) {
      const e = err as { code?: string; constraint?: string };
      if (e.code === '23505' && e.constraint === 'bookings_one_active_per_trip') {
        throw conflict('ALREADY_BOOKED', 'Vous avez déjà une réservation en cours sur ce trajet.');
      }
      throw err;
    }
    return this.view(userId, id);
  }

  // ------------------------------------------------------------------ lecture

  private async load(trx: Db | Transaction<Database>, bookingId: string, lock = false) {
    let q = trx
      .selectFrom('bookings')
      .innerJoin('trips', 'trips.id', 'bookings.trip_id')
      .selectAll('bookings')
      .select(['trips.driver_id', 'trips.status as trip_status', 'trips.departure_at'])
      .where('bookings.id', '=', bookingId);
    if (lock) q = q.forUpdate();
    return q.executeTakeFirst();
  }

  /** Réservation visible par son passager ou par le conducteur du trajet ; 404 pour tout autre compte. */
  private async accessible(trx: Db | Transaction<Database>, userId: string, bookingId: string, lock = false) {
    const b = await this.load(trx, bookingId, lock);
    if (!b || (b.passenger_id !== userId && b.driver_id !== userId)) throw notFound();
    return { ...b, role: b.passenger_id === userId ? ('PASSENGER' as const) : ('DRIVER' as const) };
  }

  async view(userId: string, bookingId: string) {
    const b = await this.accessible(this.db, userId, bookingId);
    const rules = await this.rules();
    const [trip, stops, passenger, history, policy, payment] = await Promise.all([
      this.db
        .selectFrom('trips')
        .innerJoin('vehicles', 'vehicles.id', 'trips.vehicle_id')
        .innerJoin('users', 'users.id', 'trips.driver_id')
        .select(['trips.id', 'trips.public_ref', 'trips.status', 'trips.departure_at', 'trips.estimated_arrival_at', 'trips.started_at', 'trips.completed_at',
                 'vehicles.make', 'vehicles.model', 'vehicles.color', 'vehicles.plate_number', 'users.display_name', 'trips.is_demo',
                 sql<string>`(SELECT label FROM trip_stops s WHERE s.trip_id = trips.id ORDER BY seq LIMIT 1)`.as('origin'),
                 sql<string>`(SELECT label FROM trip_stops s WHERE s.trip_id = trips.id ORDER BY seq DESC LIMIT 1)`.as('destination')])
        .where('trips.id', '=', b.trip_id)
        .executeTakeFirstOrThrow(),
      this.db.selectFrom('trip_stops').select(['id', 'seq', 'label', 'meeting_point', 'planned_at'])
        .where('id', 'in', [b.pickup_stop_id, b.dropoff_stop_id]).execute(),
      sql<{ display_name: string | null; rating: number | null }>`
        SELECT display_name, rating_avg_passenger AS rating FROM users WHERE id = ${b.passenger_id}::uuid`.execute(this.db),
      this.db.selectFrom('booking_status_history').select(['from_status', 'to_status', 'reason', 'created_at', 'actor_id'])
        .where('booking_id', '=', bookingId).orderBy('id').execute(),
      this.policy(this.db, b.cancellation_policy_code),
      this.db
        .selectFrom('payments')
        .select(['id', 'status', 'method', 'amount_xof', 'failure_message', 'created_at'])
        .where('booking_id', '=', bookingId)
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .executeTakeFirst(),
    ]);
    const [myReview, openDispute, reviewDays] = await Promise.all([
      this.db.selectFrom('reviews').select('id').where('booking_id', '=', bookingId).where('author_id', '=', userId).executeTakeFirst(),
      this.db.selectFrom('disputes').select(['id', 'reference', 'status']).where('booking_id', '=', bookingId)
        .where('status', 'in', ['OPEN', 'AWAITING_RESPONSE', 'IN_REVIEW']).executeTakeFirst(),
      this.settings.get<number>('reviews.window_days'),
    ]);
    const pickup = stops.find((s) => s.id === b.pickup_stop_id)!;
    const dropoff = stops.find((s) => s.id === b.dropoff_stop_id)!;
    const now = Date.now();
    const active = (BLOCKING_STATUSES as readonly string[]).includes(b.status);
    const holdOpen = b.hold_expires_at === null || b.hold_expires_at.getTime() > now;
    const tripOpen = ['PUBLISHED', 'FULL'].includes(trip.status);
    const isDriver = b.role === 'DRIVER';
    const confirmed = b.status === 'CONFIRMED';
    return {
      id: b.id,
      reference: b.reference,
      status: b.status,
      paymentStatus: b.payment_status,
      paymentMethod: b.payment_method,
      seats: b.seats,
      unitPriceXof: b.unit_price_xof,
      subtotalXof: b.subtotal_xof,
      serviceFeeXof: b.service_fee_xof,
      discountXof: b.discount_xof,
      totalXof: b.total_xof,
      ...(isDriver ? { commissionXof: b.commission_xof, driverNetXof: b.driver_net_xof } : {}),
      holdExpiresAt: b.hold_expires_at,
      acceptanceDeadline: b.acceptance_deadline,
      acceptedAt: b.accepted_at,
      confirmedAt: b.confirmed_at,
      cancelledAt: b.cancelled_at,
      cancellationReason: b.cancellation_reason,
      refundDueXof: b.refund_due_xof,
      freeCancellation: b.free_cancellation,
      createdAt: b.created_at,
      isDemo: b.is_demo || trip.is_demo,
      viewerRole: b.role,
      cancellationPolicy: policy,
      // Dernier paiement, visible du seul passager (le conducteur voit le statut de paiement de la réservation).
      payment:
        payment && !isDriver
          ? { id: payment.id, status: payment.status, method: payment.method, amountXof: payment.amount_xof, failureMessage: payment.failure_message, createdAt: payment.created_at }
          : null,
      trip: {
        id: trip.id,
        publicRef: trip.public_ref,
        status: trip.status,
        departureAt: trip.departure_at,
        estimatedArrivalAt: trip.estimated_arrival_at,
        origin: trip.origin,
        destination: trip.destination,
        driver: { id: b.driver_id, displayName: trip.display_name },
        // Immatriculation communiquée au passager une fois la réservation confirmée.
        vehicle: { make: trip.make, model: trip.model, color: trip.color, plateNumber: isDriver || confirmed || b.status === 'COMPLETED' ? trip.plate_number : null },
      },
      passenger: { displayName: passenger.rows[0]?.display_name ?? null, ratingAvg: passenger.rows[0]?.rating ?? null },
      pickup: { stopId: pickup.id, label: pickup.label, meetingPoint: pickup.meeting_point, plannedAt: pickup.planned_at, isEstimate: true },
      dropoff: { stopId: dropoff.id, label: dropoff.label, meetingPoint: dropoff.meeting_point, plannedAt: dropoff.planned_at, isEstimate: true },
      history: history.map((h) => ({
        from: h.from_status,
        to: h.to_status,
        at: h.created_at,
        by: h.actor_id === null ? 'SYSTEM' : h.actor_id === b.passenger_id ? 'PASSENGER' : h.actor_id === b.driver_id ? 'DRIVER' : 'STAFF',
        reason: h.reason,
      })),
      actions: {
        canCancel: active && tripOpen,
        canAccept: isDriver && b.status === 'PENDING_ACCEPTANCE' && holdOpen && tripOpen,
        canReject: isDriver && b.status === 'PENDING_ACCEPTANCE' && tripOpen,
        canMarkNoShow: isDriver && confirmed && trip.status === 'IN_PROGRESS' && now >= pickup.planned_at.getTime() + rules.noShowDelayMinutes * MINUTE,
        // Paiement mobile possible tant que le blocage court et qu'aucun paiement n'est en cours chez le prestataire.
        canPay: !isDriver && b.status === 'PENDING_PAYMENT' && holdOpen && b.hold_expires_at !== null && b.payment_status === 'UNPAID' && tripOpen,
        canMessage: active && ['PUBLISHED', 'FULL', 'IN_PROGRESS'].includes(trip.status),
        canShare: confirmed && ['PUBLISHED', 'FULL', 'IN_PROGRESS'].includes(trip.status),
        canReview:
          b.status === 'COMPLETED' && ['PAID', 'PARTIALLY_REFUNDED', 'CASH_DUE'].includes(b.payment_status) && !myReview &&
          now <= (trip.completed_at ?? trip.estimated_arrival_at).getTime() + (reviewDays ?? 14) * 86_400_000,
      },
      openDispute: openDispute ? { id: openDispute.id, reference: openDispute.reference, status: openDispute.status } : null,
    };
  }

  async mine(userId: string, q: MineBookingsQuery) {
    const upcoming = q.scope === 'upcoming';
    const offset = Number(Buffer.from(q.cursor ?? '', 'base64url').toString()) || 0;
    const rows = await this.db
      .selectFrom('bookings')
      .innerJoin('trips', 'trips.id', 'bookings.trip_id')
      .innerJoin('trip_stops as p', 'p.id', 'bookings.pickup_stop_id')
      .innerJoin('trip_stops as d', 'd.id', 'bookings.dropoff_stop_id')
      .innerJoin('users as drv', 'drv.id', 'trips.driver_id')
      .select([
        'bookings.id', 'bookings.reference', 'bookings.status', 'bookings.payment_status', 'bookings.seats', 'bookings.total_xof',
        'bookings.hold_expires_at', 'bookings.acceptance_deadline', 'bookings.is_demo', 'trips.id as trip_id', 'trips.status as trip_status',
        'trips.departure_at', 'p.label as pickup_label', 'p.planned_at as pickup_at', 'd.label as dropoff_label', 'd.planned_at as dropoff_at',
        'drv.display_name as driver_name',
      ])
      .where('bookings.passenger_id', '=', userId)
      .where((eb) =>
        upcoming
          ? eb.and([eb('bookings.status', 'in', BLOCKING_STATUSES), eb('trips.status', 'in', ['PUBLISHED', 'FULL', 'IN_PROGRESS'])])
          : eb.or([eb('bookings.status', 'not in', BLOCKING_STATUSES), eb('trips.status', 'in', ['COMPLETED', 'CANCELLED'])]),
      )
      .orderBy('trips.departure_at', upcoming ? 'asc' : 'desc')
      .orderBy('bookings.id')
      .offset(Math.min(Math.max(offset, 0), 10_000))
      .limit(q.limit + 1)
      .execute();
    const page = rows.slice(0, q.limit);
    return {
      data: page.map((r) => ({
        id: r.id,
        reference: r.reference,
        status: r.status,
        paymentStatus: r.payment_status,
        seats: r.seats,
        totalXof: r.total_xof,
        holdExpiresAt: r.hold_expires_at,
        acceptanceDeadline: r.acceptance_deadline,
        isDemo: r.is_demo,
        trip: { id: r.trip_id, status: r.trip_status, departureAt: r.departure_at, driverName: r.driver_name },
        pickup: { label: r.pickup_label, plannedAt: r.pickup_at },
        dropoff: { label: r.dropoff_label, plannedAt: r.dropoff_at },
      })),
      nextCursor: rows.length > q.limit ? Buffer.from(String(offset + q.limit)).toString('base64url') : null,
    };
  }

  // ------------------------------------------------------------------ conducteur : acceptation, refus, absence

  /** Verrouille le trajet puis la réservation (même ordre partout, pas d'interblocage). */
  private async lockForDriver(trx: Transaction<Database>, driverId: string, bookingId: string) {
    const head = await trx.selectFrom('bookings').select(['trip_id']).where('id', '=', bookingId).executeTakeFirst();
    if (!head) throw notFound();
    const trip = await trx.selectFrom('trips').select(['id', 'driver_id', 'status', 'departure_at']).where('id', '=', head.trip_id).forUpdate().executeTakeFirstOrThrow();
    if (trip.driver_id !== driverId) throw notFound();
    const b = await this.load(trx, bookingId, true);
    return { trip, b: b! };
  }

  async accept(driverId: string, bookingId: string, ctx: RequestContext) {
    const rules = await this.rules();
    const expired = await this.db.transaction().execute(async (trx) => {
      const { trip, b } = await this.lockForDriver(trx, driverId, bookingId);
      if (b.status !== 'PENDING_ACCEPTANCE') throw conflict('INVALID_STATE_TRANSITION', 'Cette demande a déjà été traitée.', { status: b.status });
      if (!['PUBLISHED', 'FULL'].includes(trip.status)) throw conflict('TRIP_NOT_BOOKABLE', 'Ce trajet n’accepte plus de réservation.');
      await setActor(trx, driverId, null);
      if (b.hold_expires_at && b.hold_expires_at.getTime() <= Date.now()) {
        await trx.updateTable('bookings').set({ status: 'EXPIRED', expired_at: new Date() }).where('id', '=', bookingId).execute();
        await syncTripFullStatus(trx, trip.id);
        return true;
      }
      const cash = b.payment_method === 'CASH';
      const now = Date.now();
      await trx
        .updateTable('bookings')
        .set(
          cash
            ? { status: 'CONFIRMED', payment_status: 'CASH_DUE', accepted_at: new Date(now), confirmed_at: new Date(now), hold_expires_at: null }
            : { status: 'PENDING_PAYMENT', accepted_at: new Date(now), hold_expires_at: new Date(now + rules.holdMinutes * MINUTE) },
        )
        .where('id', '=', bookingId)
        .execute();
      await outbox(trx, 'booking', bookingId, 'booking.accepted', { passengerId: b.passenger_id });
      await this.audit.log({ actorId: driverId, action: 'booking.accept', targetType: 'booking', targetId: bookingId, ctx }, trx);
      return false;
    });
    if (expired) throw conflict('BOOKING_EXPIRED', 'Le délai de réponse est dépassé : la demande a expiré.');
    return this.view(driverId, bookingId);
  }

  async reject(driverId: string, bookingId: string, reason: string | undefined, ctx: RequestContext) {
    await this.db.transaction().execute(async (trx) => {
      const { trip, b } = await this.lockForDriver(trx, driverId, bookingId);
      if (b.status !== 'PENDING_ACCEPTANCE') throw conflict('INVALID_STATE_TRANSITION', 'Cette demande a déjà été traitée.', { status: b.status });
      await setActor(trx, driverId, reason ?? null);
      await trx.updateTable('bookings').set({ status: 'REJECTED', rejected_at: new Date(), cancellation_reason: reason ?? null }).where('id', '=', bookingId).execute();
      await syncTripFullStatus(trx, trip.id);
      await outbox(trx, 'booking', bookingId, 'booking.rejected', { passengerId: b.passenger_id });
      await this.audit.log({ actorId: driverId, action: 'booking.reject', targetType: 'booking', targetId: bookingId, reason, ctx }, trx);
    });
    return this.view(driverId, bookingId);
  }

  /** Passager absent (doc 05 §7.4) : trajet en cours, au plus tôt 15 min après l'heure de passage prévue. */
  async markNoShow(driverId: string, tripId: string, bookingId: string, ctx: RequestContext) {
    const rules = await this.rules();
    await this.db.transaction().execute(async (trx) => {
      const { trip, b } = await this.lockForDriver(trx, driverId, bookingId);
      if (trip.id !== tripId) throw notFound();
      if (trip.status !== 'IN_PROGRESS') throw conflict('INVALID_STATE_TRANSITION', 'Une absence se déclare une fois le trajet commencé.');
      if (b.status !== 'CONFIRMED') throw conflict('INVALID_STATE_TRANSITION', 'Seule une réservation confirmée peut être marquée absente.', { status: b.status });
      const pickup = await trx.selectFrom('trip_stops').select('planned_at').where('id', '=', b.pickup_stop_id).executeTakeFirstOrThrow();
      const opensAt = pickup.planned_at.getTime() + rules.noShowDelayMinutes * MINUTE;
      if (Date.now() < opensAt) {
        throw unprocessable('NO_SHOW_TOO_EARLY', `Vous pourrez déclarer l’absence ${rules.noShowDelayMinutes} min après l’heure de passage prévue.`, { opensAt: new Date(opensAt) });
      }
      await setActor(trx, driverId, 'Passager absent');
      await trx.updateTable('bookings').set({ status: 'NO_SHOW', no_show_at: new Date() }).where('id', '=', bookingId).execute();
      await outbox(trx, 'booking', bookingId, 'booking.no_show', { passengerId: b.passenger_id });
      await this.audit.log({ actorId: driverId, action: 'booking.no_show', targetType: 'booking', targetId: bookingId, ctx }, trx);
    });
    return this.view(driverId, bookingId);
  }

  // ------------------------------------------------------------------ annulation

  private async outcome(trx: Db | Transaction<Database>, b: NonNullable<Awaited<ReturnType<BookingsService['load']>>>, role: 'PASSENGER' | 'DRIVER', rules: BookingRules) {
    const amounts = { subtotalXof: b.subtotal_xof, serviceFeeXof: b.service_fee_xof, totalXof: b.total_xof, commissionXof: b.commission_xof, discountXof: b.discount_xof };
    if (role === 'DRIVER') return { outcome: driverCancellation({ amounts, paymentStatus: b.payment_status }), lateDriver: false };
    const policy = await this.policy(trx, b.cancellation_policy_code);
    const pickup = await trx.selectFrom('trip_stops').select('planned_at').where('id', '=', b.pickup_stop_id).executeTakeFirstOrThrow();
    // Conducteur en retard de plus de 30 min au point de montée, sans avoir démarré : annulation sans frais (doc 05 §7.5).
    const lateDriver = ['PUBLISHED', 'FULL'].includes(b.trip_status) && Date.now() > pickup.planned_at.getTime() + rules.lateDriverFreeCancelMinutes * MINUTE;
    const outcome = passengerCancellation({
      amounts,
      paymentStatus: b.payment_status,
      departureAt: b.departure_at,
      confirmedAt: b.confirmed_at,
      now: new Date(),
      policy: policy.rules,
      freeCancellation: b.free_cancellation || lateDriver,
    });
    return { outcome, lateDriver };
  }

  private cancellable(b: { status: string; trip_status: string }) {
    if (!(BLOCKING_STATUSES as readonly string[]).includes(b.status)) {
      throw conflict('INVALID_STATE_TRANSITION', 'Cette réservation n’est plus active.', { status: b.status });
    }
    if (!['PUBLISHED', 'FULL'].includes(b.trip_status)) {
      throw conflict('TRIP_ALREADY_STARTED', 'Le trajet a commencé : en cas de problème, ouvrez une réclamation.');
    }
  }

  async cancelPreview(userId: string, bookingId: string) {
    const rules = await this.rules();
    const b = await this.accessible(this.db, userId, bookingId);
    this.cancellable(b);
    const { outcome, lateDriver } = await this.outcome(this.db, b, b.role, rules);
    return { ...this.outcomeView(outcome), lateDriver, paymentStatus: b.payment_status, totalXof: b.total_xof };
  }

  private outcomeView(o: CancellationOutcome) {
    return {
      refundXof: o.refundXof,
      tripRefundXof: o.tripRefundXof,
      serviceFeeRefundXof: o.serviceFeeRefundXof,
      driverCompensationXof: o.driverCompensationXof,
      refundPercent: o.refundPercent,
      basis: o.reason,
    };
  }

  async cancel(userId: string, bookingId: string, reason: string, ctx: RequestContext) {
    const rules = await this.rules();
    let result: CancellationOutcome | null = null;
    let refundNow = false;
    await this.db.transaction().execute(async (trx) => {
      const head = await this.accessible(trx, userId, bookingId);
      await trx.selectFrom('trips').select('id').where('id', '=', head.trip_id).forUpdate().execute();
      const b = { ...(await this.load(trx, bookingId, true))!, role: head.role };
      this.cancellable(b);
      const { outcome, lateDriver } = await this.outcome(trx, b, b.role, rules);
      result = outcome;
      const refundReason: RefundReason =
        b.role === 'DRIVER' ? 'DRIVER_CANCELLED' : outcome.reason === 'FREE_CANCELLATION' ? (lateDriver ? 'DRIVER_LATE' : 'TRIP_CHANGED') : 'PASSENGER_CANCELLED';
      refundNow = b.payment_status === 'PAID' && outcome.refundXof > 0;
      const status = b.role === 'PASSENGER' ? ('CANCELLED_BY_PASSENGER' as const) : ('CANCELLED_BY_DRIVER' as const);
      await setActor(trx, userId, reason);
      await trx
        .updateTable('bookings')
        .set({
          status,
          cancelled_at: new Date(),
          cancelled_by: userId,
          cancellation_reason: reason,
          refund_due_xof: outcome.refundXof,
          driver_compensation_xof: outcome.driverCompensationXof,
          ...(refundNow ? { payment_status: 'REFUND_PENDING' as const, service_fee_refund_xof: outcome.serviceFeeRefundXof, refund_reason: refundReason } : {}),
        })
        .where('id', '=', bookingId)
        .execute();
      await syncTripFullStatus(trx, b.trip_id);
      if (b.role === 'DRIVER' && b.status === 'CONFIRMED') {
        await trx.updateTable('driver_profiles').set({ cancellation_count_90d: sql<number>`cancellation_count_90d + 1` }).where('user_id', '=', userId).execute();
      }
      await outbox(trx, 'booking', bookingId, 'booking.cancelled', { by: status, refundXof: outcome.refundXof });
      if (refundNow) await outbox(trx, 'booking', bookingId, 'refund.requested', { amountXof: outcome.refundXof, reason: refundReason });
      await this.audit.log(
        { actorId: userId, action: 'booking.cancel', targetType: 'booking', targetId: bookingId, reason, changes: { status, refundXof: outcome.refundXof }, ctx },
        trx,
      );
    });
    // Remboursement envoyé tout de suite ; en cas d'échec, la tâche de rattrapage reprend.
    if (refundNow) await this.refunds.processBooking(bookingId).catch(() => undefined);
    return { booking: await this.view(userId, bookingId), refund: this.outcomeView(result!) };
  }
}
