import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ApiError } from '../../common/api-error';
import { supportReference, uuidv7 } from '../../common/ids';
import { DB, type Db } from '../../database/database.module';
import type { SupportStatus } from '../../database/types';
import { RateLimitService } from '../../infra/rate-limit.service';
import { outbox } from '../bookings/lifecycle';

export const TOPICS = ['COMPTE', 'RESERVATION', 'PAIEMENT', 'CONDUCTEUR', 'SECURITE', 'AUTRE'] as const;
const body = z.string().trim().min(1, 'Message vide.').max(2000, '2 000 caractères au maximum.');
export const newTicketSchema = z.object({
  subject: z.string().trim().min(3, 'Sujet trop court.').max(120),
  topic: z.enum(TOPICS).default('AUTRE'),
  body,
});
export const supportMessageSchema = z.object({ body });
export const supportListQuery = z.object({ status: z.enum(['OPEN', 'ANSWERED', 'CLOSED']).optional() });

const notFound = () => new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Demande introuvable.');

/**
 * Assistance : conversation entre un membre et l'équipe, hors réservation (les litiges sur un trajet passent par
 * les réclamations). Le membre voit ses demandes ; l'équipe répond depuis l'administration.
 */
@Injectable()
export class SupportService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly rateLimit: RateLimitService,
  ) {}

  async mine(userId: string) {
    const rows = await this.db
      .selectFrom('support_tickets')
      .select(['id', 'reference', 'subject', 'topic', 'status', 'last_message_at', 'created_at'])
      .where('user_id', '=', userId)
      .orderBy('last_message_at', 'desc')
      .limit(50)
      .execute();
    return { data: rows.map((r) => this.summary(r)) };
  }

  private summary(r: { id: string; reference: string; subject: string; topic: string; status: SupportStatus; last_message_at: Date; created_at: Date }) {
    return { id: r.id, reference: r.reference, subject: r.subject, topic: r.topic, status: r.status, lastMessageAt: r.last_message_at, createdAt: r.created_at };
  }

  async open(userId: string, input: z.infer<typeof newTicketSchema>) {
    await this.rateLimit.consumeOrThrow([{ key: `support:open:${userId}`, limit: 5, windowS: 86_400 }], 'Trop de demandes ouvertes aujourd’hui.');
    const id = uuidv7();
    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('support_tickets').values({ id, reference: supportReference(), user_id: userId, subject: input.subject, topic: input.topic }).execute();
      await trx.insertInto('support_messages').values({ id: uuidv7(), ticket_id: id, author_id: userId, body: input.body }).execute();
    });
    return this.view(id, { userId });
  }

  /** Une demande avec sa conversation. Pour un membre, seulement les siennes (sinon 404). */
  async view(id: string, as: { userId?: string; staff?: boolean }) {
    const t = await this.db
      .selectFrom('support_tickets')
      .innerJoin('users', 'users.id', 'support_tickets.user_id')
      .select(['support_tickets.id', 'reference', 'subject', 'topic', 'support_tickets.status', 'last_message_at', 'support_tickets.created_at', 'user_id',
               'users.display_name', 'users.phone_e164'])
      .where('support_tickets.id', '=', id)
      .executeTakeFirst();
    if (!t || (!as.staff && t.user_id !== as.userId)) throw notFound();
    const messages = await this.db
      .selectFrom('support_messages')
      .innerJoin('users', 'users.id', 'support_messages.author_id')
      .select(['support_messages.id', 'body', 'from_staff', 'support_messages.created_at', 'users.first_name'])
      .where('ticket_id', '=', id)
      .orderBy('support_messages.id')
      .execute();
    return {
      ...this.summary(t),
      ...(as.staff ? { user: { id: t.user_id, displayName: t.display_name } } : {}),
      // Côté membre, l'agent est présenté comme « Équipe IvoireCovoit » (ni nom ni compte du personnel).
      messages: messages.map((m) => ({
        id: m.id,
        body: m.body,
        fromStaff: m.from_staff,
        author: m.from_staff ? (as.staff ? (m.first_name ?? 'Équipe') : 'Équipe IvoireCovoit') : 'Vous',
        createdAt: m.created_at,
      })),
    };
  }

  async reply(id: string, authorId: string, text: string, fromStaff: boolean) {
    const t = await this.db.selectFrom('support_tickets').select(['user_id', 'status']).where('id', '=', id).executeTakeFirst();
    if (!t || (!fromStaff && t.user_id !== authorId)) throw notFound();
    if (!fromStaff) {
      await this.rateLimit.consumeOrThrow([{ key: `support:msg:${authorId}`, limit: 30, windowS: 600 }], 'Messages envoyés trop souvent.');
    }
    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('support_messages').values({ id: uuidv7(), ticket_id: id, author_id: authorId, from_staff: fromStaff, body: text }).execute();
      // Un message du membre rouvre une demande close ; une réponse de l'équipe la marque « répondue ».
      await trx.updateTable('support_tickets').set({ status: fromStaff ? 'ANSWERED' : 'OPEN', closed_at: null, last_message_at: new Date() }).where('id', '=', id).execute();
      if (fromStaff) await outbox(trx, 'support', id, 'support.staff_reply', {});
    });
    return this.view(id, fromStaff ? { staff: true } : { userId: authorId });
  }

  async close(id: string) {
    const r = await this.db.updateTable('support_tickets').set({ status: 'CLOSED', closed_at: new Date() }).where('id', '=', id).returning('id').executeTakeFirst();
    if (!r) throw notFound();
    return this.view(id, { staff: true });
  }

  /** File de l'équipe : demandes ouvertes d'abord, les plus anciennes en premier. */
  async queue(q: z.infer<typeof supportListQuery>) {
    let query = this.db
      .selectFrom('support_tickets')
      .innerJoin('users', 'users.id', 'support_tickets.user_id')
      .select(['support_tickets.id', 'reference', 'subject', 'topic', 'support_tickets.status', 'last_message_at', 'support_tickets.created_at', 'users.display_name'])
      .limit(100);
    query = q.status ? query.where('support_tickets.status', '=', q.status).orderBy('last_message_at', 'asc') : query.orderBy('last_message_at', 'desc');
    const rows = await query.execute();
    return { data: rows.map((r) => ({ ...this.summary(r), userName: r.display_name })) };
  }
}
