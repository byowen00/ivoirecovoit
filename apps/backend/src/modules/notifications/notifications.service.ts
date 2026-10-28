import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { uuidv7 } from '../../common/ids';
import { DB, type Db } from '../../database/database.module';
import type { Database } from '../../database/types';
import { SettingsService } from '../users/settings.service';
import { at, places, when, xof } from './format';
import { PUSH_CHANNEL, type PushChannel } from './push';

/**
 * Catégories (EF-82). Les notifications transactionnelles (réservation, paiement, remboursement, annulation,
 * changement d'horaire, réclamation) sont obligatoires ; les autres peuvent être coupées par l'utilisateur.
 */
export const CATEGORIES = {
  TRANSACTIONAL: { label: 'Réservations, paiements et remboursements', mandatory: true },
  REMINDERS: { label: 'Rappels avant le départ', mandatory: false },
  MESSAGES: { label: 'Nouveaux messages', mandatory: false },
  REVIEWS: { label: 'Demandes d’avis et avis reçus', mandatory: false },
} as const;
export type Category = keyof typeof CATEGORIES;
export const OPTIONAL_CATEGORIES = (Object.keys(CATEGORIES) as Category[]).filter((c) => !CATEGORIES[c].mandatory);

export interface NotifyInput {
  userId: string;
  type: string;
  category: Category;
  title: string;
  body: string;
  /** Chemin dans l'application (identique sur le web et le mobile), ex. /reservations/… */
  link?: string;
  dedupeKey?: string;
}

const PUSH_MAX_ATTEMPTS = 5;
type Trx = Transaction<Database>;

interface OutboxEvent {
  id: number;
  aggregate: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: Date;
}

/**
 * Notifications dans l'application et sur le téléphone (EF-81). Les modules métier enregistrent des événements
 * dans `outbox_events` dans leur propre transaction ; ce service les transforme en notifications (une seule fois
 * par événement et par destinataire), puis envoie celles qui doivent l'être sur le téléphone.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PUSH_CHANNEL) private readonly push: PushChannel,
    private readonly settings: SettingsService,
  ) {}

  // ------------------------------------------------------------------ création

  /** Crée une notification si la catégorie est permise par l'utilisateur ; renvoie false sinon (ou si doublon). */
  async notify(trx: Trx | Db, n: NotifyInput): Promise<boolean> {
    if (!CATEGORIES[n.category].mandatory) {
      const u = await trx.selectFrom('users').select('preferences').where('id', '=', n.userId).executeTakeFirst();
      const prefs = (u?.preferences as { notifications?: Record<string, boolean> } | undefined)?.notifications;
      if (prefs?.[n.category] === false) return false;
    }
    const id = uuidv7();
    const inserted = await trx
      .insertInto('notifications')
      .values({
        id,
        user_id: n.userId,
        type: n.type,
        title: n.title.slice(0, 120),
        body: n.body.slice(0, 400),
        data: JSON.stringify({ category: n.category, ...(n.link ? { link: n.link } : {}) }),
        channels: ['IN_APP', 'PUSH'],
        dedupe_key: n.dedupeKey ?? null,
      })
      .onConflict((oc) => oc.column('dedupe_key').doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!inserted) return false;
    const hasDevice = this.push.configured
      ? await trx.selectFrom('device_tokens').select('id').where('user_id', '=', n.userId).limit(1).executeTakeFirst()
      : undefined;
    await trx
      .insertInto('notification_deliveries')
      .values([
        { notification_id: id, channel: 'IN_APP', status: 'SENT' },
        {
          notification_id: id,
          channel: 'PUSH',
          status: hasDevice ? 'QUEUED' : 'SKIPPED',
          error: hasDevice ? null : this.push.configured ? 'NO_DEVICE' : 'PUSH_NOT_CONFIGURED',
        },
      ])
      .execute();
    return true;
  }

  // ------------------------------------------------------------------ événements -> notifications

  /** Traite les événements non publiés, chacun dans sa transaction. Renvoie le nombre de notifications créées. */
  async dispatchOutbox(limit = 200): Promise<number> {
    const pending = await this.db
      .selectFrom('outbox_events')
      .select('id')
      .where('published_at', 'is', null)
      .orderBy('id')
      .limit(limit)
      .execute();
    let created = 0;
    for (const { id } of pending) {
      try {
        created += await this.db.transaction().execute(async (trx) => {
          const e = await trx
            .selectFrom('outbox_events')
            .select(['id', 'aggregate', 'aggregate_id', 'event_type', 'payload', 'created_at'])
            .where('id', '=', id)
            .where('published_at', 'is', null)
            .forUpdate()
            .skipLocked()
            .executeTakeFirst();
          if (!e) return 0;
          let n = 0;
          for (const input of await this.forEvent(trx, e as OutboxEvent)) {
            if (await this.notify(trx, { ...input, dedupeKey: input.dedupeKey ?? `evt:${e.id}:${input.userId}:${input.type}` })) n++;
          }
          await trx.updateTable('outbox_events').set({ published_at: new Date() }).where('id', '=', e.id).execute();
          return n;
        });
      } catch (err) {
        // Un événement illisible ne doit pas bloquer la file : il est marqué traité et l'erreur est journalisée.
        this.logger.error(`Événement ${id} non transformé en notification : ${(err as Error).message}`);
        await this.db.updateTable('outbox_events').set({ published_at: new Date() }).where('id', '=', id).execute();
      }
    }
    return created;
  }

  private async booking(trx: Trx, bookingId: string) {
    return trx
      .selectFrom('bookings')
      .innerJoin('trips', 'trips.id', 'bookings.trip_id')
      .innerJoin('trip_stops as p', 'p.id', 'bookings.pickup_stop_id')
      .innerJoin('trip_stops as d', 'd.id', 'bookings.dropoff_stop_id')
      .innerJoin('users as pu', 'pu.id', 'bookings.passenger_id')
      .select([
        'bookings.id', 'bookings.reference', 'bookings.passenger_id', 'bookings.seats', 'bookings.status', 'bookings.total_xof',
        'bookings.hold_expires_at', 'bookings.acceptance_deadline', 'bookings.refund_due_xof', 'bookings.cancellation_reason',
        'trips.id as trip_id', 'trips.driver_id', 'trips.departure_at', 'p.label as pickup', 'd.label as dropoff', 'p.planned_at as pickup_at',
        'pu.first_name as passenger_name',
      ])
      .where('bookings.id', '=', bookingId)
      .executeTakeFirst();
  }

  private async forEvent(trx: Trx, e: OutboxEvent): Promise<NotifyInput[]> {
    const p = e.payload;
    if (e.aggregate === 'booking' || e.event_type.startsWith('refund.') || e.event_type === 'payment.failed') {
      const bookingId = e.aggregate === 'booking' ? e.aggregate_id : (p.bookingId as string | undefined);
      if (!bookingId) return [];
      const b = await this.booking(trx, bookingId);
      if (!b) return [];
      const route = `${b.pickup} → ${b.dropoff}`;
      const link = `/reservations/${b.id}`;
      const toPassenger = (type: string, title: string, body: string, category: Category = 'TRANSACTIONAL'): NotifyInput => ({
        userId: b.passenger_id, type, category, title, body, link,
      });
      const toDriver = (type: string, title: string, body: string, category: Category = 'TRANSACTIONAL'): NotifyInput => ({
        userId: b.driver_id, type, category, title, body, link,
      });
      switch (e.event_type) {
        case 'booking.created':
          if (p.status === 'PENDING_ACCEPTANCE') {
            return [toDriver('booking.request', 'Nouvelle demande de réservation',
              `${b.passenger_name ?? 'Un passager'} demande ${places(b.seats)} sur ${route}, ${when(b.departure_at)}.` +
                (b.acceptance_deadline ? ` Répondez avant ${when(b.acceptance_deadline)}.` : ''))];
          }
          if (p.status === 'CONFIRMED') {
            return [toDriver('booking.confirmed', 'Nouvelle réservation', `${b.passenger_name ?? 'Un passager'} a réservé ${places(b.seats)} sur ${route}, ${when(b.departure_at)} (paiement en espèces).`)];
          }
          return [];
        case 'booking.accepted':
          return [toPassenger('booking.accepted', 'Demande acceptée',
            `Le conducteur a accepté votre demande pour ${route}.` + (b.hold_expires_at ? ` Payez avant ${at(b.hold_expires_at)} pour confirmer vos places.` : ''))];
        case 'booking.rejected':
          return [toPassenger('booking.rejected', 'Demande refusée', `Le conducteur n’a pas pu accepter votre demande pour ${route}. Aucun montant n’a été prélevé.`)];
        case 'booking.expired':
          return [toPassenger('booking.expired', 'Réservation expirée', `Le délai est passé pour ${route} (réf. ${b.reference}) : les places ont été libérées.`)];
        case 'booking.no_show':
          return [toPassenger('booking.no_show', 'Absence signalée',
            `Le conducteur vous a signalé absent au départ de ${b.pickup}. Si c’est une erreur, ouvrez une réclamation depuis votre réservation.`)];
        case 'booking.cancelled': {
          const refund = (p.refundXof as number | undefined) ?? 0;
          const refundText = refund > 0 ? ` Vous serez remboursé de ${xof(refund)}.` : '';
          if (p.by === 'CANCELLED_BY_PASSENGER') {
            return [toDriver('booking.cancelled', 'Réservation annulée', `${b.passenger_name ?? 'Un passager'} a annulé sa réservation (${places(b.seats)}) pour ${route}, ${when(b.departure_at)}.`)];
          }
          if (p.by === 'CANCELLED_BY_DRIVER') {
            return [toPassenger('booking.cancelled', 'Trajet annulé par le conducteur', `Votre réservation pour ${route}, ${when(b.departure_at)}, est annulée.${refundText}`)];
          }
          return [
            toPassenger('booking.cancelled', 'Réservation annulée', `Votre réservation pour ${route}, ${when(b.departure_at)}, a été annulée par IvoireCovoit.${refundText}`),
            toDriver('booking.cancelled', 'Réservation annulée', `La réservation ${b.reference} (${places(b.seats)}) pour ${route} a été annulée par IvoireCovoit.`),
          ];
        }
        case 'payment.succeeded':
          return [
            toPassenger('payment.succeeded', 'Paiement confirmé', `${xof(b.total_xof)} reçus. Votre place pour ${route}, ${when(b.departure_at)}, est confirmée.`),
            toDriver('booking.confirmed', 'Nouvelle réservation confirmée', `${b.passenger_name ?? 'Un passager'} a payé ${places(b.seats)} sur ${route}, ${when(b.departure_at)}.`),
          ];
        case 'payment.failed':
          return [toPassenger('payment.failed', 'Paiement non abouti', `Le paiement pour ${route} n’a pas abouti. Vous pouvez réessayer tant que vos places sont bloquées.`)];
        case 'payment.late':
          return [toPassenger('payment.late', 'Paiement reçu trop tard',
            `Votre paiement est arrivé après l’expiration de la réservation ${b.reference}. Il vous sera remboursé intégralement.`)];
        case 'refund.succeeded':
          return [toPassenger('refund.succeeded', 'Remboursement effectué', `${xof((p.amountXof as number) ?? 0)} vous ont été remboursés (réf. ${b.reference}).`)];
        case 'refund.manual_required':
          return [toPassenger('refund.delayed', 'Remboursement en cours', `Votre remboursement de ${xof((p.amountXof as number) ?? 0)} est traité par notre équipe (réf. ${b.reference}).`)];
        default:
          return [];
      }
    }

    if (e.aggregate === 'trip') return this.forTripEvent(trx, e);
    if (e.aggregate === 'conversation' && e.event_type === 'message.created') return this.forMessage(trx, e);
    if (e.aggregate === 'dispute') return this.forDispute(trx, e);
    if (e.aggregate === 'review' && e.event_type === 'review.published') {
      const r = await trx.selectFrom('reviews').select(['subject_id', 'rating', 'booking_id']).where('id', '=', e.aggregate_id).executeTakeFirst();
      if (!r) return [];
      return [{ userId: r.subject_id, type: 'review.published', category: 'REVIEWS', title: 'Nouvel avis', body: `Vous avez reçu un avis : ${r.rating}/5.`, link: '/compte' }];
    }
    return [];
  }

  private async forTripEvent(trx: Trx, e: OutboxEvent): Promise<NotifyInput[]> {
    const trip = await trx.selectFrom('trips').select(['id', 'driver_id', 'departure_at']).where('id', '=', e.aggregate_id).executeTakeFirst();
    if (!trip) return [];
    const bookings = await trx
      .selectFrom('bookings')
      .innerJoin('trip_stops as p', 'p.id', 'bookings.pickup_stop_id')
      .innerJoin('trip_stops as d', 'd.id', 'bookings.dropoff_stop_id')
      .select(['bookings.id', 'bookings.passenger_id', 'bookings.status', 'p.label as pickup', 'd.label as dropoff', 'p.planned_at'])
      .where('bookings.trip_id', '=', trip.id)
      .execute();
    if (e.event_type === 'trip.updated') {
      const free = e.payload.freeCancellation === true;
      return bookings
        .filter((b) => ['CONFIRMED', 'PENDING_PAYMENT', 'PENDING_ACCEPTANCE'].includes(b.status))
        .map((b) => ({
          userId: b.passenger_id,
          type: 'trip.updated',
          category: 'TRANSACTIONAL' as const,
          title: 'Trajet modifié',
          body: `Le conducteur a modifié le trajet ${b.pickup} → ${b.dropoff}. Nouveau passage prévu ${when(b.planned_at)}.` +
            (free ? ' Vous pouvez annuler sans frais jusqu’au départ.' : ''),
          link: `/reservations/${b.id}`,
        }));
    }
    if (e.event_type === 'trip.completed') {
      const done = bookings.filter((b) => b.status === 'COMPLETED');
      const out: NotifyInput[] = done.map((b) => ({
        userId: b.passenger_id,
        type: 'review.request',
        category: 'REVIEWS' as const,
        title: 'Trajet terminé',
        body: `Comment s’est passé votre trajet ${b.pickup} → ${b.dropoff} ? Laissez un avis au conducteur.`,
        link: `/reservations/${b.id}`,
      }));
      if (done.length > 0) {
        out.push({
          userId: trip.driver_id,
          type: 'review.request',
          category: 'REVIEWS',
          title: 'Trajet terminé',
          body: `Merci d’avoir conduit ! Laissez un avis à vos ${done.length > 1 ? `${done.length} passagers` : 'passager'}.`,
          link: `/conducteur/trajets/${trip.id}`,
        });
      }
      return out;
    }
    return [];
  }

  private async forMessage(trx: Trx, e: OutboxEvent): Promise<NotifyInput[]> {
    const m = await trx
      .selectFrom('messages')
      .innerJoin('conversations', 'conversations.id', 'messages.conversation_id')
      .innerJoin('bookings', 'bookings.id', 'conversations.booking_id')
      .innerJoin('trips', 'trips.id', 'bookings.trip_id')
      .innerJoin('users as s', 's.id', 'messages.sender_id')
      .select(['messages.sender_id', 'messages.created_at', 'bookings.id as booking_id', 'bookings.passenger_id', 'trips.driver_id', 's.first_name', 'conversations.id as conversation_id'])
      .where('messages.id', '=', e.payload.messageId as string)
      .executeTakeFirst();
    if (!m) return [];
    const to = m.sender_id === m.passenger_id ? m.driver_id : m.passenger_id;
    // Une notification au plus par conversation et par quart d'heure : les messages suivants restent visibles dans la conversation.
    const slot = Math.floor(m.created_at.getTime() / 900_000);
    return [{
      userId: to,
      type: 'message.created',
      category: 'MESSAGES',
      title: `Message de ${m.first_name ?? 'votre contact'}`,
      body: 'Vous avez un nouveau message au sujet de votre réservation.',
      link: `/reservations/${m.booking_id}/messages`,
      dedupeKey: `msg:${m.conversation_id}:${to}:${slot}`,
    }];
  }

  private async forDispute(trx: Trx, e: OutboxEvent): Promise<NotifyInput[]> {
    const d = await trx
      .selectFrom('disputes')
      .innerJoin('bookings', 'bookings.id', 'disputes.booking_id')
      .innerJoin('trips', 'trips.id', 'bookings.trip_id')
      .select(['disputes.id', 'disputes.reference', 'disputes.opened_by', 'disputes.respondent_id', 'disputes.decision', 'disputes.decided_refund_xof',
               'disputes.response_deadline', 'bookings.passenger_id', 'trips.driver_id'])
      .where('disputes.id', '=', e.aggregate_id)
      .executeTakeFirst();
    if (!d) return [];
    const link = `/aide/reclamations/${d.id}`;
    const parties = [d.opened_by, d.respondent_id].filter((u): u is string => !!u);
    const n = (userId: string, type: string, title: string, body: string): NotifyInput => ({ userId, type, category: 'TRANSACTIONAL', title, body, link });
    switch (e.event_type) {
      case 'dispute.opened':
        return d.respondent_id
          ? [n(d.respondent_id, 'dispute.opened', 'Réclamation ouverte',
              `Une réclamation (${d.reference}) concerne une de vos réservations.` +
                (d.response_deadline ? ` Donnez votre version avant ${when(d.response_deadline)}.` : ''))]
          : [];
      case 'dispute.message': {
        const author = e.payload.authorId as string;
        const fromStaff = e.payload.fromStaff === true;
        return parties
          .filter((u) => u !== author)
          .map((u) => n(u, fromStaff ? 'dispute.staff_reply' : 'dispute.message', fromStaff ? 'Réponse du support' : 'Nouvelle réponse à une réclamation',
            `Nouveau message dans la réclamation ${d.reference}.`));
      }
      case 'dispute.decided': {
        const refund = d.decided_refund_xof ? ` Remboursement décidé : ${xof(d.decided_refund_xof)}.` : '';
        return parties.map((u) => n(u, 'dispute.decided', 'Réclamation traitée', `Une décision a été prise pour la réclamation ${d.reference}.${refund}`));
      }
      case 'dispute.rejected':
        return parties.map((u) => n(u, 'dispute.decided', 'Réclamation clôturée', `La réclamation ${d.reference} a été clôturée sans suite.`));
      default:
        return [];
    }
  }

  // ------------------------------------------------------------------ rappels

  /** Rappels avant le départ (24 h et 2 h par défaut) aux passagers confirmés et aux conducteurs. */
  async sendReminders(now: Date = new Date()): Promise<number> {
    const hours = ((await this.settings.get<number[]>('notifications.reminder_hours')) ?? [24, 2]).sort((a, b) => b - a);
    let created = 0;
    for (const [i, h] of hours.entries()) {
      const lower = hours[i + 1] ?? 0; // fenêtre (h suivant, h] : on n'envoie pas un rappel « 24 h » à 1 h du départ
      const rows = await this.db
        .selectFrom('bookings')
        .innerJoin('trips', 'trips.id', 'bookings.trip_id')
        .innerJoin('trip_stops as p', 'p.id', 'bookings.pickup_stop_id')
        .innerJoin('trip_stops as d', 'd.id', 'bookings.dropoff_stop_id')
        .select(['bookings.id', 'bookings.passenger_id', 'trips.id as trip_id', 'trips.driver_id', 'p.label as pickup', 'p.meeting_point', 'd.label as dropoff', 'p.planned_at'])
        .where('bookings.status', '=', 'CONFIRMED')
        .where('trips.status', 'in', ['PUBLISHED', 'FULL'])
        .where('p.planned_at', '>', new Date(now.getTime() + lower * 3_600_000))
        .where('p.planned_at', '<=', new Date(now.getTime() + h * 3_600_000))
        .limit(500)
        .execute();
      for (const r of rows) {
        const label = h >= 24 ? 'demain' : `dans ${h} h`;
        const ok = await this.notify(this.db, {
          userId: r.passenger_id,
          type: 'trip.reminder',
          category: 'REMINDERS',
          title: `Départ ${label}`,
          body: `${r.pickup} → ${r.dropoff} : passage prévu ${when(r.planned_at)}${r.meeting_point ? `, ${r.meeting_point}` : ''}. Horaire estimé.`,
          link: `/reservations/${r.id}`,
          dedupeKey: `reminder:${h}:${r.id}`,
        });
        if (ok) created++;
        const okDriver = await this.notify(this.db, {
          userId: r.driver_id,
          type: 'trip.reminder',
          category: 'REMINDERS',
          title: `Départ ${label}`,
          body: `Vous avez des passagers confirmés. Premier passage prévu ${when(r.planned_at)}.`,
          link: `/conducteur/trajets/${r.trip_id}`,
          dedupeKey: `reminder:${h}:trip:${r.trip_id}`,
        });
        if (okDriver) created++;
      }
    }
    return created;
  }

  // ------------------------------------------------------------------ envoi sur le téléphone

  async deliverPush(limit = 100): Promise<{ sent: number; failed: number }> {
    if (!this.push.configured) return { sent: 0, failed: 0 };
    const queued = await this.db
      .selectFrom('notification_deliveries')
      .innerJoin('notifications', 'notifications.id', 'notification_deliveries.notification_id')
      .select(['notification_deliveries.id', 'notification_deliveries.attempts', 'notifications.id as notification_id', 'notifications.user_id',
               'notifications.title', 'notifications.body', 'notifications.data', 'notifications.type'])
      .where('notification_deliveries.status', '=', 'QUEUED')
      .where('notification_deliveries.channel', '=', 'PUSH')
      .orderBy('notification_deliveries.id')
      .limit(limit)
      .execute();
    let sent = 0;
    let failed = 0;
    for (const q of queued) {
      const tokens = await this.db.selectFrom('device_tokens').select(['id', 'fcm_token']).where('user_id', '=', q.user_id).execute();
      if (tokens.length === 0) {
        await this.db.updateTable('notification_deliveries').set({ status: 'SKIPPED', error: 'NO_DEVICE', updated_at: new Date() }).where('id', '=', q.id).execute();
        continue;
      }
      const data = q.data as { link?: string };
      let ok = false;
      let lastError = '';
      let retryable = false;
      let messageId = '';
      for (const t of tokens) {
        const r = await this.push.send({ token: t.fcm_token, title: q.title, body: q.body, data: { type: q.type, notificationId: q.notification_id, ...(data.link ? { link: data.link } : {}) } });
        if (r.status === 'SENT') {
          ok = true;
          messageId = r.providerMessageId;
        } else if (r.status === 'INVALID_TOKEN') {
          await this.db.deleteFrom('device_tokens').where('id', '=', t.id).execute();
          lastError = r.error;
        } else {
          lastError = r.error;
          retryable ||= r.retryable;
        }
      }
      const attempts = q.attempts + 1;
      const status = ok ? 'SENT' : retryable && attempts < PUSH_MAX_ATTEMPTS ? 'QUEUED' : 'FAILED';
      await this.db
        .updateTable('notification_deliveries')
        .set({ status, attempts, error: ok ? null : lastError.slice(0, 300), provider_message_id: ok ? messageId.slice(0, 150) : null, updated_at: new Date() })
        .where('id', '=', q.id)
        .execute();
      if (ok) sent++;
      else if (status === 'FAILED') failed++;
    }
    return { sent, failed };
  }

  // ------------------------------------------------------------------ lecture par l'utilisateur

  async list(userId: string, q: { cursor?: string; limit: number; unread?: boolean }) {
    let query = this.db
      .selectFrom('notifications')
      .select(['id', 'type', 'title', 'body', 'data', 'read_at', 'created_at'])
      .where('user_id', '=', userId)
      .orderBy('id', 'desc')
      .limit(q.limit + 1);
    if (q.cursor) query = query.where('id', '<', q.cursor);
    if (q.unread) query = query.where('read_at', 'is', null);
    const rows = await query.execute();
    const page = rows.slice(0, q.limit);
    return {
      data: page.map((r) => {
        const data = r.data as { link?: string; category?: Category };
        return { id: r.id, type: r.type, title: r.title, body: r.body, link: data.link ?? null, category: data.category ?? 'TRANSACTIONAL', readAt: r.read_at, createdAt: r.created_at };
      }),
      nextCursor: rows.length > q.limit ? page.at(-1)!.id : null,
      unreadCount: await this.unreadCount(userId),
    };
  }

  async unreadCount(userId: string): Promise<number> {
    const r = await this.db
      .selectFrom('notifications')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('user_id', '=', userId)
      .where('read_at', 'is', null)
      .executeTakeFirstOrThrow();
    return r.n;
  }

  async markRead(userId: string, input: { ids?: string[]; all?: boolean }): Promise<{ unreadCount: number }> {
    let q = this.db.updateTable('notifications').set({ read_at: new Date() }).where('user_id', '=', userId).where('read_at', 'is', null);
    if (!input.all) q = q.where('id', 'in', input.ids ?? []);
    if (input.all || (input.ids && input.ids.length > 0)) await q.execute();
    return { unreadCount: await this.unreadCount(userId) };
  }

  async registerDevice(userId: string, platform: 'ANDROID' | 'IOS' | 'WEB', token: string): Promise<void> {
    // Un jeton appartient au dernier compte connecté sur l'appareil.
    await this.db
      .insertInto('device_tokens')
      .values({ id: uuidv7(), user_id: userId, platform, fcm_token: token })
      .onConflict((oc) => oc.column('fcm_token').doUpdateSet({ user_id: userId, platform, last_seen_at: new Date() }))
      .execute();
  }

  async removeDevice(userId: string, token: string): Promise<void> {
    await this.db.deleteFrom('device_tokens').where('user_id', '=', userId).where('fcm_token', '=', token).execute();
  }

  async preferences(userId: string) {
    const u = await this.db.selectFrom('users').select('preferences').where('id', '=', userId).executeTakeFirstOrThrow();
    const prefs = (u.preferences as { notifications?: Record<string, boolean> }).notifications ?? {};
    return {
      pushAvailable: this.push.configured,
      categories: (Object.keys(CATEGORIES) as Category[]).map((code) => ({
        code,
        label: CATEGORIES[code].label,
        mandatory: CATEGORIES[code].mandatory,
        enabled: CATEGORIES[code].mandatory || prefs[code] !== false,
      })),
    };
  }

  async setPreferences(userId: string, input: Partial<Record<Category, boolean>>) {
    const clean = Object.fromEntries(OPTIONAL_CATEGORIES.filter((c) => typeof input[c] === 'boolean').map((c) => [c, input[c]]));
    await this.db
      .updateTable('users')
      .set({ preferences: sql`jsonb_set(preferences, '{notifications}', coalesce(preferences->'notifications', '{}'::jsonb) || ${JSON.stringify(clean)}::jsonb)` as never })
      .where('id', '=', userId)
      .execute();
    return this.preferences(userId);
  }
}
