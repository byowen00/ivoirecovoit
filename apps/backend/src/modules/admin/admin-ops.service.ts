import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { ApiError } from '../../common/api-error';
import { uuidv7 } from '../../common/ids';
import { maskPhone } from '../../common/phone';
import { DB, type Db } from '../../database/database.module';
import type { BookingStatus, TripStatus } from '../../database/types';
import { AuditService, type RequestContext } from '../../infra/audit.service';
import { driverCancellation } from '../bookings/amounts';
import { BLOCKING_STATUSES, cancelTripBookings, outbox, setActor, syncTripFullStatus } from '../bookings/lifecycle';
import type { AuthContext } from '../auth/request-context';
import { SessionsService } from '../auth/sessions.service';
import { PaymentsService } from '../payments/payments.service';
import { RefundsService } from '../payments/refunds.service';

const notFound = (what: string) => new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${what} introuvable.`);
const conflict = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, code, message);
const role = (a: AuthContext) => a.roles.join(',');

export interface Page {
  cursor?: string;
  limit: number;
}

function paginate<T extends { id: string }>(rows: T[], limit: number) {
  const page = rows.slice(0, limit);
  return { page, nextCursor: rows.length > limit ? page.at(-1)!.id : null };
}

/**
 * Exploitation (EF-91, EF-93, EF-94) : trajets, réservations, paiements, notes internes, bannissement.
 * Les numéros de téléphone restent masqués ; les annulations administratives sont motivées et journalisées.
 */
@Injectable()
export class AdminOpsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly refunds: RefundsService,
    private readonly payments: PaymentsService,
    private readonly sessions: SessionsService,
  ) {}

  // ------------------------------------------------------------------ trajets

  async trips(q: Page & { status?: TripStatus; q?: string; driverId?: string }) {
    let query = this.db
      .selectFrom('trips')
      .innerJoin('users as d', 'd.id', 'trips.driver_id')
      .select([
        'trips.id', 'trips.public_ref', 'trips.status', 'trips.kind', 'trips.departure_at', 'trips.seats_offered', 'trips.is_demo', 'd.display_name as driver_name',
        'trips.driver_id',
        sql<string>`(SELECT label FROM trip_stops s WHERE s.trip_id = trips.id ORDER BY seq LIMIT 1)`.as('origin'),
        sql<string>`(SELECT label FROM trip_stops s WHERE s.trip_id = trips.id ORDER BY seq DESC LIMIT 1)`.as('destination'),
        sql<number>`(SELECT coalesce(sum(seats), 0)::int FROM bookings b WHERE b.trip_id = trips.id AND b.status IN ('CONFIRMED','COMPLETED','NO_SHOW'))`.as('seats_booked'),
      ])
      .where('trips.status', '<>', 'DRAFT')
      .orderBy('trips.id', 'desc')
      .limit(q.limit + 1);
    if (q.status) query = query.where('trips.status', '=', q.status);
    if (q.driverId) query = query.where('trips.driver_id', '=', q.driverId);
    if (q.cursor) query = query.where('trips.id', '<', q.cursor);
    if (q.q) query = query.where('trips.public_ref', '=', q.q.toUpperCase());
    const { page, nextCursor } = paginate(await query.execute(), q.limit);
    return {
      data: page.map((t) => ({
        id: t.id, publicRef: t.public_ref, status: t.status, kind: t.kind, departureAt: t.departure_at, origin: t.origin, destination: t.destination,
        seatsOffered: t.seats_offered, seatsBooked: t.seats_booked, driver: { id: t.driver_id, displayName: t.driver_name }, isDemo: t.is_demo,
      })),
      nextCursor,
    };
  }

  async trip(id: string) {
    const t = await this.db
      .selectFrom('trips')
      .innerJoin('users as d', 'd.id', 'trips.driver_id')
      .innerJoin('vehicles', 'vehicles.id', 'trips.vehicle_id')
      .selectAll('trips')
      .select(['d.display_name as driver_name', 'vehicles.make', 'vehicles.model', 'vehicles.color', 'vehicles.plate_number'])
      .where('trips.id', '=', id)
      .executeTakeFirst();
    if (!t) throw notFound('Trajet');
    const [stops, bookings, notes] = await Promise.all([
      this.db.selectFrom('trip_stops').select(['id', 'seq', 'label', 'planned_at', 'price_from_origin_xof']).where('trip_id', '=', id).orderBy('seq').execute(),
      this.db
        .selectFrom('bookings')
        .innerJoin('users as p', 'p.id', 'bookings.passenger_id')
        .select(['bookings.id', 'bookings.reference', 'bookings.status', 'bookings.payment_status', 'bookings.seats', 'bookings.total_xof', 'p.display_name'])
        .where('trip_id', '=', id)
        .orderBy('bookings.id')
        .execute(),
      this.notes('TRIP', id),
    ]);
    return {
      id: t.id,
      publicRef: t.public_ref,
      status: t.status,
      kind: t.kind,
      departureAt: t.departure_at,
      estimatedArrivalAt: t.estimated_arrival_at,
      seatsOffered: t.seats_offered,
      acceptanceMode: t.acceptance_mode,
      cancellationPolicyCode: t.cancellation_policy_code,
      routeSource: t.route_source,
      estimatedDistanceM: t.estimated_distance_m,
      cancelledAt: t.cancelled_at,
      cancellationReason: t.cancellation_reason,
      isDemo: t.is_demo,
      driver: { id: t.driver_id, displayName: t.driver_name },
      vehicle: { make: t.make, model: t.model, color: t.color, plateNumber: t.plate_number },
      stops: stops.map((s) => ({ id: s.id, seq: s.seq, label: s.label, plannedAt: s.planned_at, priceFromOriginXof: s.price_from_origin_xof })),
      bookings: bookings.map((b) => ({ id: b.id, reference: b.reference, status: b.status, paymentStatus: b.payment_status, seats: b.seats, totalXof: b.total_xof, passengerName: b.display_name })),
      notes: notes.data,
      actions: { canCancel: ['PUBLISHED', 'FULL'].includes(t.status) },
    };
  }

  /** Annulation administrative d'un trajet (doc 05 §7.3) : passagers remboursés intégralement. */
  async cancelTrip(staff: AuthContext, id: string, reason: string, ctx: RequestContext) {
    const toRefund = await this.db.transaction().execute(async (trx) => {
      const t = await trx.selectFrom('trips').select(['id', 'status']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!t) throw notFound('Trajet');
      if (!['PUBLISHED', 'FULL'].includes(t.status)) {
        throw conflict('INVALID_STATE_TRANSITION', t.status === 'IN_PROGRESS' ? 'Trajet en cours : passez par une réclamation.' : 'Ce trajet ne peut plus être annulé.');
      }
      const { cancelled, toRefund } = await cancelTripBookings(trx, id, staff.userId, reason, 'CANCELLED_BY_ADMIN', 'ADMIN');
      await trx.updateTable('trips').set({ status: 'CANCELLED', cancelled_at: new Date(), cancellation_reason: reason }).where('id', '=', id).execute();
      await outbox(trx, 'trip', id, 'trip.cancelled', { by: 'ADMIN', bookingsCancelled: cancelled });
      await this.audit.log({ actorId: staff.userId, actorRole: role(staff), action: 'trip.admin_cancel', targetType: 'trip', targetId: id, reason, changes: { bookingsCancelled: cancelled }, ctx }, trx);
      return toRefund;
    });
    for (const b of toRefund) await this.refunds.processBooking(b).catch(() => undefined);
    return this.trip(id);
  }

  // ------------------------------------------------------------------ réservations

  async bookings(q: Page & { status?: BookingStatus; q?: string; tripId?: string; userId?: string }) {
    let query = this.db
      .selectFrom('bookings')
      .innerJoin('trips', 'trips.id', 'bookings.trip_id')
      .innerJoin('users as p', 'p.id', 'bookings.passenger_id')
      .innerJoin('trip_stops as ps', 'ps.id', 'bookings.pickup_stop_id')
      .innerJoin('trip_stops as ds', 'ds.id', 'bookings.dropoff_stop_id')
      .select(['bookings.id', 'bookings.reference', 'bookings.status', 'bookings.payment_status', 'bookings.seats', 'bookings.total_xof', 'bookings.created_at',
               'bookings.is_demo', 'p.display_name as passenger_name', 'trips.departure_at', 'trips.public_ref', 'ps.label as pickup', 'ds.label as dropoff'])
      .orderBy('bookings.id', 'desc')
      .limit(q.limit + 1);
    if (q.status) query = query.where('bookings.status', '=', q.status);
    if (q.tripId) query = query.where('bookings.trip_id', '=', q.tripId);
    if (q.userId) query = query.where((eb) => eb.or([eb('bookings.passenger_id', '=', q.userId!), eb('trips.driver_id', '=', q.userId!)]));
    if (q.cursor) query = query.where('bookings.id', '<', q.cursor);
    if (q.q) query = query.where('bookings.reference', '=', q.q.toUpperCase());
    const { page, nextCursor } = paginate(await query.execute(), q.limit);
    return {
      data: page.map((b) => ({
        id: b.id, reference: b.reference, status: b.status, paymentStatus: b.payment_status, seats: b.seats, totalXof: b.total_xof, createdAt: b.created_at,
        passengerName: b.passenger_name, route: `${b.pickup} → ${b.dropoff}`, departureAt: b.departure_at, tripRef: b.public_ref, isDemo: b.is_demo,
      })),
      nextCursor,
    };
  }

  async booking(id: string) {
    const b = await this.db
      .selectFrom('bookings')
      .innerJoin('trips', 'trips.id', 'bookings.trip_id')
      .innerJoin('users as p', 'p.id', 'bookings.passenger_id')
      .innerJoin('users as d', 'd.id', 'trips.driver_id')
      .innerJoin('trip_stops as ps', 'ps.id', 'bookings.pickup_stop_id')
      .innerJoin('trip_stops as ds', 'ds.id', 'bookings.dropoff_stop_id')
      .selectAll('bookings')
      .select(['trips.public_ref', 'trips.status as trip_status', 'trips.departure_at', 'trips.driver_id', 'p.display_name as passenger_name',
               'p.phone_e164 as passenger_phone', 'd.display_name as driver_name', 'ps.label as pickup', 'ds.label as dropoff'])
      .where('bookings.id', '=', id)
      .executeTakeFirst();
    if (!b) throw notFound('Réservation');
    const [history, payments, refunds, disputes, commission, notes] = await Promise.all([
      this.db.selectFrom('booking_status_history').select(['from_status', 'to_status', 'reason', 'created_at', 'actor_id']).where('booking_id', '=', id).orderBy('id').execute(),
      this.db.selectFrom('payments').select(['id', 'status', 'method', 'amount_xof', 'provider', 'payer_phone_masked', 'created_at', 'succeeded_at', 'failure_code'])
        .where('booking_id', '=', id).orderBy('id').execute(),
      this.db.selectFrom('refunds').select(['id', 'status', 'amount_xof', 'reason_code', 'requested_by', 'approved_by', 'note', 'created_at', 'succeeded_at'])
        .where('booking_id', '=', id).orderBy('id').execute(),
      this.db.selectFrom('disputes').select(['id', 'reference', 'status', 'reason_code', 'created_at']).where('booking_id', '=', id).orderBy('id').execute(),
      this.db.selectFrom('commissions').select(['status', 'driver_net_xof', 'adjusted_xof', 'commission_xof', 'payable_at']).where('booking_id', '=', id).executeTakeFirst(),
      this.notes('BOOKING', id),
    ]);
    const paid = refunds.filter((r) => r.status === 'SUCCEEDED').reduce((s, r) => s + r.amount_xof, 0);
    const succeeded = payments.find((p) => p.status === 'SUCCEEDED');
    return {
      id: b.id,
      reference: b.reference,
      status: b.status,
      paymentStatus: b.payment_status,
      paymentMethod: b.payment_method,
      seats: b.seats,
      route: `${b.pickup} → ${b.dropoff}`,
      trip: { id: b.trip_id, publicRef: b.public_ref, status: b.trip_status, departureAt: b.departure_at },
      passenger: { id: b.passenger_id, displayName: b.passenger_name, phoneMasked: maskPhone(b.passenger_phone) },
      driver: { id: b.driver_id, displayName: b.driver_name },
      amounts: {
        unitPriceXof: b.unit_price_xof, subtotalXof: b.subtotal_xof, serviceFeeXof: b.service_fee_xof, discountXof: b.discount_xof, totalXof: b.total_xof,
        commissionXof: b.commission_xof, driverNetXof: b.driver_net_xof, refundDueXof: b.refund_due_xof, refundedXof: paid,
      },
      cancellation: { at: b.cancelled_at, reason: b.cancellation_reason, refundReason: b.refund_reason },
      createdAt: b.created_at,
      isDemo: b.is_demo,
      history: history.map((h) => ({ from: h.from_status, to: h.to_status, reason: h.reason, at: h.created_at, actorId: h.actor_id })),
      payments: payments.map((p) => ({ id: p.id, status: p.status, method: p.method, amountXof: p.amount_xof, provider: p.provider, payerPhoneMasked: p.payer_phone_masked, createdAt: p.created_at, succeededAt: p.succeeded_at, failureCode: p.failure_code })),
      refunds: refunds.map((r) => ({ id: r.id, status: r.status, amountXof: r.amount_xof, reasonCode: r.reason_code, requestedBy: r.requested_by, approvedBy: r.approved_by, note: r.note, createdAt: r.created_at, succeededAt: r.succeeded_at })),
      disputes: disputes.map((d) => ({ id: d.id, reference: d.reference, status: d.status, reasonCode: d.reason_code, createdAt: d.created_at })),
      commission: commission ? { status: commission.status, driverNetXof: commission.driver_net_xof, adjustedXof: commission.adjusted_xof, commissionXof: commission.commission_xof, payableAt: commission.payable_at } : null,
      notes: notes.data,
      actions: {
        canCancel: (BLOCKING_STATUSES as readonly string[]).includes(b.status) && ['PUBLISHED', 'FULL'].includes(b.trip_status),
        // Remboursement décidé par le personnel : paiement réussi, rien encore remboursé, aucun remboursement en cours.
        canRefund: !!succeeded && b.payment_status === 'PAID',
        maxRefundXof: succeeded && b.payment_status === 'PAID' ? succeeded.amount_xof : 0,
      },
    };
  }

  /** Annulation administrative d'une réservation : remboursement intégral de ce qui a été payé. */
  async cancelBooking(staff: AuthContext, id: string, reason: string, ctx: RequestContext) {
    const refundNow = await this.db.transaction().execute(async (trx) => {
      const head = await trx.selectFrom('bookings').select('trip_id').where('id', '=', id).executeTakeFirst();
      if (!head) throw notFound('Réservation');
      const trip = await trx.selectFrom('trips').select(['status']).where('id', '=', head.trip_id).forUpdate().executeTakeFirstOrThrow();
      const b = await trx.selectFrom('bookings').selectAll().where('id', '=', id).forUpdate().executeTakeFirstOrThrow();
      if (!(BLOCKING_STATUSES as readonly string[]).includes(b.status)) throw conflict('INVALID_STATE_TRANSITION', 'Cette réservation n’est plus active.');
      if (!['PUBLISHED', 'FULL'].includes(trip.status)) throw conflict('TRIP_ALREADY_STARTED', 'Le trajet a commencé : passez par une réclamation.');
      const outcome = driverCancellation({
        paymentStatus: b.payment_status,
        amounts: { subtotalXof: b.subtotal_xof, serviceFeeXof: b.service_fee_xof, totalXof: b.total_xof, commissionXof: b.commission_xof },
      });
      const pay = b.payment_status === 'PAID' && outcome.refundXof > 0;
      await setActor(trx, staff.userId, reason);
      await trx
        .updateTable('bookings')
        .set({
          status: 'CANCELLED_BY_ADMIN',
          cancelled_at: new Date(),
          cancelled_by: staff.userId,
          cancellation_reason: reason,
          refund_due_xof: outcome.refundXof,
          driver_compensation_xof: 0,
          ...(pay ? { payment_status: 'REFUND_PENDING' as const, service_fee_refund_xof: outcome.serviceFeeRefundXof, refund_reason: 'ADMIN' as const } : {}),
        })
        .where('id', '=', id)
        .execute();
      await syncTripFullStatus(trx, b.trip_id);
      await outbox(trx, 'booking', id, 'booking.cancelled', { by: 'CANCELLED_BY_ADMIN', refundXof: outcome.refundXof });
      await this.audit.log({ actorId: staff.userId, actorRole: role(staff), action: 'booking.admin_cancel', targetType: 'booking', targetId: id, reason, changes: { refundXof: outcome.refundXof }, ctx }, trx);
      return pay;
    });
    if (refundNow) await this.refunds.processBooking(id).catch(() => undefined);
    return this.booking(id);
  }

  // ------------------------------------------------------------------ paiements

  async paymentsList(q: Page & { status?: string; bookingId?: string }) {
    let query = this.db
      .selectFrom('payments')
      .innerJoin('bookings', 'bookings.id', 'payments.booking_id')
      .select(['payments.id', 'payments.status', 'payments.method', 'payments.amount_xof', 'payments.provider', 'payments.payer_phone_masked', 'payments.created_at',
               'payments.succeeded_at', 'payments.failure_code', 'bookings.reference', 'bookings.id as booking_id'])
      .orderBy('payments.id', 'desc')
      .limit(q.limit + 1);
    if (q.status) query = query.where('payments.status', '=', q.status as never);
    if (q.bookingId) query = query.where('payments.booking_id', '=', q.bookingId);
    if (q.cursor) query = query.where('payments.id', '<', q.cursor);
    const { page, nextCursor } = paginate(await query.execute(), q.limit);
    return {
      data: page.map((p) => ({
        id: p.id, status: p.status, method: p.method, amountXof: p.amount_xof, provider: p.provider, payerPhoneMasked: p.payer_phone_masked,
        createdAt: p.created_at, succeededAt: p.succeeded_at, failureCode: p.failure_code, bookingId: p.booking_id, bookingReference: p.reference,
      })),
      nextCursor,
    };
  }

  async payment(id: string) {
    const p = await this.db.selectFrom('payments').selectAll().where('id', '=', id).executeTakeFirst();
    if (!p) throw notFound('Paiement');
    // Le contenu brut des webhooks n'est pas affiché : il peut contenir des données du payeur.
    const events = await this.db
      .selectFrom('payment_events')
      .select(['id', 'source', 'event_type', 'reported_status', 'amount_xof', 'signature_valid', 'occurred_at', 'received_at', 'processing_result'])
      .where('payment_id', '=', id)
      .orderBy('received_at')
      .execute();
    return {
      id: p.id, bookingId: p.booking_id, provider: p.provider, method: p.method, amountXof: p.amount_xof, status: p.status, providerReference: p.provider_reference,
      payerPhoneMasked: p.payer_phone_masked, failureCode: p.failure_code, failureMessage: p.failure_message, expiresAt: p.expires_at, succeededAt: p.succeeded_at,
      createdAt: p.created_at, lastPolledAt: p.last_polled_at,
      events: events.map((e) => ({
        id: e.id, source: e.source, type: e.event_type, reportedStatus: e.reported_status, amountXof: e.amount_xof, signatureValid: e.signature_valid,
        occurredAt: e.occurred_at, receivedAt: e.received_at, result: e.processing_result,
      })),
    };
  }

  /** Interroge le prestataire et applique le statut vérifié (doc 04 §12). */
  async recheck(staff: AuthContext, id: string, ctx: RequestContext) {
    const p = await this.db.selectFrom('payments').select('id').where('id', '=', id).executeTakeFirst();
    if (!p) throw notFound('Paiement');
    const result = await this.payments.pollOne(id);
    await this.audit.log({ actorId: staff.userId, actorRole: role(staff), action: 'payment.recheck', targetType: 'payment', targetId: id, changes: { result }, ctx });
    return { result, payment: await this.payment(id) };
  }

  // ------------------------------------------------------------------ notes internes et bannissement

  async notes(targetType: 'USER' | 'TRIP' | 'BOOKING', targetId: string) {
    const rows = await this.db
      .selectFrom('staff_notes')
      .innerJoin('users as a', 'a.id', 'staff_notes.author_id')
      .select(['staff_notes.id', 'staff_notes.body', 'staff_notes.created_at', 'a.display_name'])
      .where('target_type', '=', targetType)
      .where('target_id', '=', targetId)
      .orderBy('staff_notes.id', 'desc')
      .limit(100)
      .execute();
    return { data: rows.map((n) => ({ id: n.id, body: n.body, author: n.display_name, createdAt: n.created_at })) };
  }

  async addNote(staff: AuthContext, targetType: 'USER' | 'TRIP' | 'BOOKING', targetId: string, body: string, ctx: RequestContext) {
    const table = targetType === 'USER' ? 'users' : targetType === 'TRIP' ? 'trips' : 'bookings';
    const exists = await this.db.selectFrom(table).select('id').where('id', '=', targetId).executeTakeFirst();
    if (!exists) throw notFound('Élément');
    await this.db.insertInto('staff_notes').values({ id: uuidv7(), target_type: targetType, target_id: targetId, author_id: staff.userId, body: body.trim() }).execute();
    await this.audit.log({ actorId: staff.userId, actorRole: role(staff), action: 'note.added', targetType: targetType.toLowerCase(), targetId, ctx });
    return this.notes(targetType, targetId);
  }

  /** Bannissement (EF-76) : définitif jusqu'à décision contraire, sessions révoquées, trajets et réservations à venir annulés. */
  async ban(staff: AuthContext, id: string, reason: string, ctx: RequestContext) {
    const toRefund = await this.db.transaction().execute(async (trx) => {
      const u = await trx
        .selectFrom('users')
        .leftJoin('staff_accounts', 'staff_accounts.user_id', 'users.id')
        .select(['users.status', 'staff_accounts.user_id as staff_id'])
        .where('users.id', '=', id)
        .forUpdate('users')
        .executeTakeFirst();
      if (!u) throw notFound('Utilisateur');
      if (u.staff_id) throw conflict('TARGET_IS_STAFF', 'Les comptes du personnel se gèrent dans « Personnel ».');
      if (u.status === 'BANNED' || u.status === 'DELETED') throw conflict('INVALID_STATE_TRANSITION', 'Ce compte est déjà banni ou supprimé.');
      await trx.updateTable('users').set({ status: 'BANNED', suspended_until: null }).where('id', '=', id).execute();
      const revoked = await this.sessions.revokeAllForUser(id, 'ACCOUNT_SUSPENDED', trx);
      // Trajets à venir du conducteur banni : annulés, passagers remboursés intégralement.
      const trips = await trx.selectFrom('trips').select('id').where('driver_id', '=', id).where('status', 'in', ['PUBLISHED', 'FULL']).forUpdate().execute();
      const refund: string[] = [];
      for (const t of trips) {
        const r = await cancelTripBookings(trx, t.id, staff.userId, 'Compte du conducteur fermé', 'CANCELLED_BY_ADMIN', 'ADMIN');
        refund.push(...r.toRefund);
        await trx.updateTable('trips').set({ status: 'CANCELLED', cancelled_at: new Date(), cancellation_reason: 'Compte du conducteur fermé' }).where('id', '=', t.id).execute();
      }
      await this.audit.log({ actorId: staff.userId, actorRole: role(staff), action: 'user.banned', targetType: 'user', targetId: id, reason, changes: { from: u.status, revokedSessions: revoked, tripsCancelled: trips.length }, ctx }, trx);
      return refund;
    });
    for (const b of toRefund) await this.refunds.processBooking(b).catch(() => undefined);
    return { status: 'BANNED' };
  }
}
