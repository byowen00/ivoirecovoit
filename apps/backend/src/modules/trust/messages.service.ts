import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { uuidv7 } from '../../common/ids';
import { DB, type Db } from '../../database/database.module';
import { RateLimitService } from '../../infra/rate-limit.service';
import { outbox } from '../bookings/lifecycle';
import { SettingsService } from '../users/settings.service';
import { conflict, type ParticipantBooking, participantBooking } from './access';
import { redactContacts } from './redact';

const OPEN_BOOKING = ['PENDING_ACCEPTANCE', 'PENDING_PAYMENT', 'CONFIRMED'];
const OPEN_TRIP = ['PUBLISHED', 'FULL', 'IN_PROGRESS'];

/**
 * Messagerie limitée aux deux participants d'une réservation en attente ou confirmée (EF-80) : texte seul,
 * 1 000 caractères, coordonnées masquées tant que la réservation n'est pas confirmée, débit limité.
 * L'historique reste lisible ensuite (réclamations), mais on ne peut plus écrire.
 */
@Injectable()
export class MessagesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly rateLimit: RateLimitService,
    private readonly settings: SettingsService,
  ) {}

  private canSend(b: ParticipantBooking): boolean {
    return OPEN_BOOKING.includes(b.status) && OPEN_TRIP.includes(b.trip_status);
  }

  async list(userId: string, bookingId: string, after?: string) {
    const b = await participantBooking(this.db, userId, bookingId);
    const conv = await this.db.selectFrom('conversations').select('id').where('booking_id', '=', bookingId).executeTakeFirst();
    const other = await this.db.selectFrom('users').select(['first_name']).where('id', '=', b.otherId).executeTakeFirstOrThrow();
    let messages: { id: string; sender_id: string; body: string; was_redacted: boolean; read_at: Date | null; hidden_at: Date | null; created_at: Date }[] = [];
    if (conv) {
      let q = this.db
        .selectFrom('messages')
        .select(['id', 'sender_id', 'body', 'was_redacted', 'read_at', 'hidden_at', 'created_at'])
        .where('conversation_id', '=', conv.id)
        .orderBy('id')
        .limit(200);
      if (after) q = q.where('id', '>', after);
      messages = await q.execute();
      await this.db
        .updateTable('messages')
        .set({ read_at: new Date() })
        .where('conversation_id', '=', conv.id)
        .where('sender_id', '<>', userId)
        .where('read_at', 'is', null)
        .execute();
    }
    const open = this.canSend(b);
    return {
      bookingId,
      reference: b.reference,
      viewerRole: b.role,
      other: { firstName: other.first_name, role: b.role === 'PASSENGER' ? 'DRIVER' : 'PASSENGER' },
      canSend: open,
      closedReason: open ? null : 'Cette réservation n’est plus active : la conversation est fermée.',
      contactsMasked: b.status !== 'CONFIRMED',
      data: messages.map((m) => ({
        id: m.id,
        mine: m.sender_id === userId,
        body: m.hidden_at ? 'Message masqué par la modération.' : m.body,
        wasRedacted: m.was_redacted,
        hidden: m.hidden_at !== null,
        readAt: m.read_at,
        createdAt: m.created_at,
      })),
    };
  }

  async send(userId: string, bookingId: string, body: string) {
    const b = await participantBooking(this.db, userId, bookingId);
    if (!this.canSend(b)) throw conflict('CONVERSATION_CLOSED', 'Cette réservation n’est plus active : vous ne pouvez plus écrire.');
    const limit = (await this.settings.get<number>('messages.max_per_10_minutes')) ?? 20;
    await this.rateLimit.consumeOrThrow([{ key: `msg:${userId}:${bookingId}`, limit, windowS: 600 }], 'Trop de messages en peu de temps. Patientez quelques minutes.');
    const { text, redacted } = b.status === 'CONFIRMED' ? { text: body, redacted: false } : redactContacts(body);
    const id = uuidv7();
    await this.db.transaction().execute(async (trx) => {
      const conv = await trx
        .insertInto('conversations')
        .values({ id: uuidv7(), booking_id: bookingId })
        .onConflict((oc) => oc.column('booking_id').doUpdateSet({ booking_id: sql`excluded.booking_id` }))
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx.insertInto('messages').values({ id, conversation_id: conv.id, sender_id: userId, body: text, was_redacted: redacted }).execute();
      await outbox(trx, 'conversation', conv.id, 'message.created', { messageId: id, bookingId });
    });
    return { id, mine: true, body: text, wasRedacted: redacted, hidden: false, readAt: null, createdAt: new Date() };
  }
}
