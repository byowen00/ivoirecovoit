import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { uuidv7 } from '../../common/ids';
import { DB, type Db } from '../../database/database.module';
import type { Database } from '../../database/types';
import { outbox } from '../bookings/lifecycle';
import { SettingsService } from '../users/settings.service';
import { bookingNotFound, conflict, participantBooking, tripEnd, unprocessable } from './access';

const DAY = 86_400_000;
const PAID_FOR_REVIEW = ['PAID', 'PARTIALLY_REFUNDED', 'CASH_DUE'];

/**
 * Avis mutuels (EF-70) : après un trajet terminé et payé, dans les 14 jours, un par réservation et par sens.
 * Publiés quand les deux parties ont noté, ou à la fin du délai (pour qu'aucun avis ne soit écrit en réaction).
 */
@Injectable()
export class ReviewsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly settings: SettingsService,
  ) {}

  private async windowDays(): Promise<number> {
    return (await this.settings.get<number>('reviews.window_days')) ?? 14;
  }

  /** État de l'avis pour la personne connectée sur cette réservation. */
  async status(userId: string, bookingId: string) {
    const b = await participantBooking(this.db, userId, bookingId);
    const days = await this.windowDays();
    const deadline = new Date(tripEnd(b).getTime() + days * DAY);
    const reviews = await this.db.selectFrom('reviews').select(['author_id', 'rating', 'comment', 'published_at', 'hidden_at', 'created_at']).where('booking_id', '=', bookingId).execute();
    const mine = reviews.find((r) => r.author_id === userId);
    const theirs = reviews.find((r) => r.author_id !== userId);
    const eligible = b.status === 'COMPLETED' && PAID_FOR_REVIEW.includes(b.payment_status);
    return {
      canReview: eligible && !mine && Date.now() <= deadline.getTime(),
      deadline: eligible ? deadline : null,
      subjectRole: b.role === 'PASSENGER' ? 'DRIVER' : 'PASSENGER',
      mine: mine ? { rating: mine.rating, comment: mine.comment, published: mine.published_at !== null, createdAt: mine.created_at } : null,
      // L'avis de l'autre partie n'est montré qu'une fois publié.
      theirs: theirs?.published_at && !theirs.hidden_at ? { rating: theirs.rating, comment: theirs.comment } : null,
    };
  }

  async create(userId: string, bookingId: string, input: { rating: number; comment?: string }) {
    const days = await this.windowDays();
    await this.db.transaction().execute(async (trx) => {
      const b = await participantBooking(trx, userId, bookingId, true);
      if (b.status !== 'COMPLETED' || !PAID_FOR_REVIEW.includes(b.payment_status)) {
        throw unprocessable('REVIEW_NOT_ALLOWED', 'Un avis est possible seulement après un trajet effectué et payé.');
      }
      if (Date.now() > tripEnd(b).getTime() + days * DAY) throw unprocessable('REVIEW_WINDOW_CLOSED', `Le délai de ${days} jours pour laisser un avis est passé.`);
      const id = uuidv7();
      const inserted = await trx
        .insertInto('reviews')
        .values({
          id,
          booking_id: bookingId,
          author_id: userId,
          subject_id: b.otherId,
          direction: b.role === 'PASSENGER' ? 'PASSENGER_TO_DRIVER' : 'DRIVER_TO_PASSENGER',
          rating: input.rating,
          comment: input.comment?.trim() || null,
        })
        .onConflict((oc) => oc.columns(['booking_id', 'author_id']).doNothing())
        .returning('id')
        .executeTakeFirst();
      if (!inserted) throw conflict('ALREADY_REVIEWED', 'Vous avez déjà laissé un avis pour ce trajet.');
      // Les deux parties ont noté : publication immédiate des deux avis.
      const other = await trx.selectFrom('reviews').select('id').where('booking_id', '=', bookingId).where('author_id', '=', b.otherId).where('published_at', 'is', null).executeTakeFirst();
      if (other) await this.publish(trx, [id, other.id]);
    });
    return this.status(userId, bookingId);
  }

  private async publish(trx: Transaction<Database>, ids: string[]): Promise<void> {
    const rows = await trx.updateTable('reviews').set({ published_at: new Date() }).where('id', 'in', ids).where('published_at', 'is', null).returning(['id', 'subject_id', 'direction']).execute();
    for (const r of rows) {
      await this.refreshRating(trx, r.subject_id, r.direction);
      await outbox(trx, 'review', r.id, 'review.published', {});
    }
  }

  /** Note moyenne recalculée sur les avis publiés et non masqués. */
  async refreshRating(trx: Transaction<Database> | Db, subjectId: string, direction: 'PASSENGER_TO_DRIVER' | 'DRIVER_TO_PASSENGER'): Promise<void> {
    if (direction === 'PASSENGER_TO_DRIVER') {
      await sql`UPDATE driver_profiles d SET rating_avg = s.avg, rating_count = s.n
                  FROM (SELECT round(avg(rating)::numeric, 2) AS avg, count(*)::int AS n FROM reviews
                         WHERE subject_id = ${subjectId}::uuid AND direction = 'PASSENGER_TO_DRIVER' AND published_at IS NOT NULL AND hidden_at IS NULL) s
                 WHERE d.user_id = ${subjectId}::uuid`.execute(trx);
    } else {
      await sql`UPDATE users u SET rating_avg_passenger = s.avg, rating_count_passenger = s.n
                  FROM (SELECT round(avg(rating)::numeric, 2) AS avg, count(*)::int AS n FROM reviews
                         WHERE subject_id = ${subjectId}::uuid AND direction = 'DRIVER_TO_PASSENGER' AND published_at IS NOT NULL AND hidden_at IS NULL) s
                 WHERE u.id = ${subjectId}::uuid`.execute(trx);
    }
  }

  /** Tâche : publie les avis dont le délai est passé (l'autre partie n'a pas noté). */
  async publishDue(now: Date = new Date()): Promise<number> {
    const days = await this.windowDays();
    const due = await this.db
      .selectFrom('reviews')
      .innerJoin('bookings', 'bookings.id', 'reviews.booking_id')
      .innerJoin('trips', 'trips.id', 'bookings.trip_id')
      .select('reviews.id')
      .where('reviews.published_at', 'is', null)
      .where(sql<boolean>`coalesce(trips.completed_at, trips.estimated_arrival_at) <= ${new Date(now.getTime() - days * DAY)}`)
      .limit(500)
      .execute();
    if (due.length === 0) return 0;
    await this.db.transaction().execute((trx) => this.publish(trx, due.map((d) => d.id)));
    return due.length;
  }

  /** Avis publics d'un utilisateur (EF-70, écran 7) : prénom de l'auteur seulement. */
  async forUser(subjectId: string, q: { role?: 'DRIVER' | 'PASSENGER'; cursor?: string; limit: number }) {
    const user = await this.db
      .selectFrom('users')
      .leftJoin('driver_profiles', 'driver_profiles.user_id', 'users.id')
      .select(['users.id', 'users.status', 'users.first_name', 'users.rating_avg_passenger', 'users.rating_count_passenger',
               'driver_profiles.rating_avg', 'driver_profiles.rating_count'])
      .where('users.id', '=', subjectId)
      .executeTakeFirst();
    if (!user || user.status === 'DELETED' || user.status === 'BANNED') throw bookingNotFound();
    let query = this.db
      .selectFrom('reviews')
      .innerJoin('users as a', 'a.id', 'reviews.author_id')
      .select(['reviews.id', 'reviews.rating', 'reviews.comment', 'reviews.direction', 'reviews.published_at', 'a.first_name'])
      .where('reviews.subject_id', '=', subjectId)
      .where('reviews.published_at', 'is not', null)
      .where('reviews.hidden_at', 'is', null)
      .orderBy('reviews.id', 'desc')
      .limit(q.limit + 1);
    if (q.role) query = query.where('reviews.direction', '=', q.role === 'DRIVER' ? 'PASSENGER_TO_DRIVER' : 'DRIVER_TO_PASSENGER');
    if (q.cursor) query = query.where('reviews.id', '<', q.cursor);
    const rows = await query.execute();
    const page = rows.slice(0, q.limit);
    return {
      user: {
        id: user.id,
        firstName: user.first_name,
        asDriver: { ratingAvg: user.rating_avg, ratingCount: user.rating_count ?? 0 },
        asPassenger: { ratingAvg: user.rating_avg_passenger, ratingCount: user.rating_count_passenger },
      },
      data: page.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        authorFirstName: r.first_name,
        aboutRole: r.direction === 'PASSENGER_TO_DRIVER' ? 'DRIVER' : 'PASSENGER',
        publishedAt: r.published_at,
      })),
      nextCursor: rows.length > q.limit ? page.at(-1)!.id : null,
    };
  }
}
