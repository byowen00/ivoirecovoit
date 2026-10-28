import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { DB, type Db } from '../../database/database.module';
import { SettingsService } from '../users/settings.service';
import { cancelTripBookings, outbox, PENDING_STATUSES, setActor, syncTripFullStatus } from './lifecycle';

const HOUR = 3_600_000;
const BATCH = 200;

/**
 * Échéances traitées par le système (doc 05 §1 et §3) : expiration des blocages de places, clôture automatique
 * des trajets non déclarés terminés, annulation des trajets jamais démarrés. Rejouable sans risque : chaque
 * traitement revérifie l'état sous verrou. Les places d'un blocage échu sont de toute façon ignorées par le calcul
 * d'occupation, même si cette tâche est en retard.
 */
@Injectable()
export class BookingsMaintenanceService {
  private readonly logger = new Logger('Échéances');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Réservations en attente (acceptation ou paiement) dont le blocage est échu -> EXPIRED. Exception (doc 05 §4) :
   * si un paiement est en cours chez le prestataire, le blocage est prolongé une seule fois de quelques minutes.
   */
  async expireHolds(now: Date = new Date()): Promise<number> {
    const extension = (await this.settings.get<number>('booking.hold_extension_minutes')) ?? 10;
    const due = await this.db
      .selectFrom('bookings')
      .select(['id', 'trip_id'])
      .where('status', 'in', PENDING_STATUSES)
      .where('hold_expires_at', '<=', now)
      .limit(BATCH)
      .execute();
    const byTrip = new Map<string, string[]>();
    for (const d of due) byTrip.set(d.trip_id, [...(byTrip.get(d.trip_id) ?? []), d.id]);
    let count = 0;
    for (const [tripId, ids] of byTrip) {
      count += await this.db.transaction().execute(async (trx) => {
        await trx.selectFrom('trips').select('id').where('id', '=', tripId).forUpdate().execute();
        await trx
          .updateTable('bookings')
          .set({ hold_expires_at: sql<Date>`hold_expires_at + make_interval(mins => ${extension})`, hold_extended: true })
          .where('id', 'in', ids)
          .where('status', '=', 'PENDING_PAYMENT')
          .where('payment_status', '=', 'PROCESSING')
          .where('hold_extended', '=', false)
          .where('hold_expires_at', '<=', now)
          .execute();
        await setActor(trx, null, 'Délai dépassé');
        const expired = await trx
          .updateTable('bookings')
          .set({ status: 'EXPIRED', expired_at: now })
          .where('id', 'in', ids)
          .where('status', 'in', PENDING_STATUSES)
          .where('hold_expires_at', '<=', now)
          .returning(['id', 'passenger_id'])
          .execute();
        for (const b of expired) await outbox(trx, 'booking', b.id, 'booking.expired', { passengerId: b.passenger_id });
        await syncTripFullStatus(trx, tripId);
        return expired.length;
      });
    }
    return count;
  }

  /** Trajets en cours non déclarés terminés 12 h après l'arrivée estimée -> COMPLETED « clôture automatique ». */
  async autoCloseTrips(now: Date = new Date()): Promise<number> {
    const hours = (await this.settings.get<number>('trip.auto_close_hours_after_arrival')) ?? 12;
    const trips = await this.db
      .selectFrom('trips')
      .select(['id', 'driver_id'])
      .where('status', '=', 'IN_PROGRESS')
      .where('estimated_arrival_at', '<=', new Date(now.getTime() - hours * HOUR))
      .limit(BATCH)
      .execute();
    for (const t of trips) {
      await this.db.transaction().execute(async (trx) => {
        const locked = await trx.selectFrom('trips').select('status').where('id', '=', t.id).forUpdate().executeTakeFirstOrThrow();
        if (locked.status !== 'IN_PROGRESS') return;
        await setActor(trx, null, 'Clôture automatique');
        await trx.updateTable('trips').set({ status: 'COMPLETED', completed_at: now, auto_closed: true }).where('id', '=', t.id).execute();
        await trx.updateTable('bookings').set({ status: 'COMPLETED', completed_at: now }).where('trip_id', '=', t.id).where('status', '=', 'CONFIRMED').execute();
        await trx.updateTable('driver_profiles').set({ completed_trips_count: sql<number>`completed_trips_count + 1` }).where('user_id', '=', t.driver_id).execute();
        await outbox(trx, 'trip', t.id, 'trip.completed', { auto: true });
      });
    }
    return trips.length;
  }

  /** Trajets publiés jamais démarrés 6 h après le départ prévu -> CANCELLED, passagers remboursés intégralement. */
  async autoCancelNotStarted(now: Date = new Date()): Promise<number> {
    const hours = (await this.settings.get<number>('trip.auto_cancel_hours_after_departure')) ?? 6;
    const trips = await this.db
      .selectFrom('trips')
      .select(['id', 'driver_id'])
      .where('status', 'in', ['PUBLISHED', 'FULL'])
      .where('departure_at', '<=', new Date(now.getTime() - hours * HOUR))
      .limit(BATCH)
      .execute();
    const reason = 'Trajet non démarré';
    for (const t of trips) {
      await this.db.transaction().execute(async (trx) => {
        const locked = await trx.selectFrom('trips').select('status').where('id', '=', t.id).forUpdate().executeTakeFirstOrThrow();
        if (!['PUBLISHED', 'FULL'].includes(locked.status)) return;
        const { cancelled } = await cancelTripBookings(trx, t.id, t.driver_id, reason, 'CANCELLED_BY_DRIVER', 'TRIP_NOT_STARTED');
        await trx.updateTable('trips').set({ status: 'CANCELLED', cancelled_at: now, cancellation_reason: reason }).where('id', '=', t.id).execute();
        if (cancelled > 0) {
          // Pénalité de fiabilité : comptée comme une annulation du conducteur (doc 05 §1).
          await trx.updateTable('driver_profiles').set({ cancellation_count_90d: sql<number>`cancellation_count_90d + 1` }).where('user_id', '=', t.driver_id).execute();
        }
        await outbox(trx, 'trip', t.id, 'trip.cancelled', { auto: true, reason, bookingsCancelled: cancelled });
      });
    }
    return trips.length;
  }

  async runAll(now: Date = new Date()) {
    const result = {
      expired: await this.expireHolds(now),
      autoClosed: await this.autoCloseTrips(now),
      autoCancelled: await this.autoCancelNotStarted(now),
    };
    if (result.expired || result.autoClosed || result.autoCancelled) this.logger.log(JSON.stringify(result));
    return result;
  }
}
