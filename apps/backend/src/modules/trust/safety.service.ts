import { createHash, randomBytes } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../../common/api-error';
import { uuidv7 } from '../../common/ids';
import { ENV, type Env } from '../../config/env';
import { DB, type Db } from '../../database/database.module';
import { SettingsService } from '../users/settings.service';
import { conflict, participantBooking } from './access';

const HOUR = 3_600_000;
const shareNotFound = () => new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Ce lien de partage n’existe pas ou a expiré.');
const hashToken = (token: string) => createHash('sha256').update(token).digest();

const STATUS_TEXT: Record<string, string> = {
  PUBLISHED: 'Pas encore parti',
  FULL: 'Pas encore parti',
  IN_PROGRESS: 'En route',
  COMPLETED: 'Trajet terminé',
  CANCELLED: 'Trajet annulé',
};

/**
 * Sécurité (EF-73, EF-74) : numéros d'urgence configurables, et lien temporaire pour qu'un proche suive le trajet.
 * Seule l'empreinte du lien est enregistrée ; il expire 24 h après l'arrivée prévue et peut être révoqué.
 */
@Injectable()
export class SafetyService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly settings: SettingsService,
  ) {}

  async emergencyNumbers() {
    const v = (await this.settings.get<{ _status?: string; numbers: { label: string; phone: string }[] }>('safety.emergency_numbers')) ?? { numbers: [] };
    return { validated: !v._status, notice: v._status ?? null, numbers: v.numbers };
  }

  async createShare(userId: string, bookingId: string) {
    const b = await participantBooking(this.db, userId, bookingId);
    if (b.status !== 'CONFIRMED' || !['PUBLISHED', 'FULL', 'IN_PROGRESS'].includes(b.trip_status)) {
      throw conflict('SHARE_NOT_AVAILABLE', 'Le partage est possible pour une réservation confirmée, jusqu’à la fin du trajet.');
    }
    const hours = (await this.settings.get<number>('share.expiry_hours_after_arrival')) ?? 24;
    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(b.estimated_arrival_at.getTime() + hours * HOUR);
    await this.db.transaction().execute(async (trx) => {
      // Un seul lien actif par personne et par réservation : le précédent est révoqué.
      await trx.updateTable('trip_shares').set({ revoked_at: new Date() }).where('booking_id', '=', bookingId).where('created_by', '=', userId).where('revoked_at', 'is', null).execute();
      await trx
        .insertInto('trip_shares')
        .values({ id: uuidv7(), booking_id: bookingId, trip_id: b.trip_id, created_by: userId, token_hash: hashToken(token), expires_at: expiresAt })
        .execute();
    });
    return { url: `${this.env.WEB_BASE_URL}/partage/${token}`, token, expiresAt };
  }

  async revokeShare(userId: string, bookingId: string): Promise<void> {
    await participantBooking(this.db, userId, bookingId);
    await this.db.updateTable('trip_shares').set({ revoked_at: new Date() }).where('booking_id', '=', bookingId).where('created_by', '=', userId).where('revoked_at', 'is', null).execute();
  }

  async shareStatus(userId: string, bookingId: string) {
    await participantBooking(this.db, userId, bookingId);
    const s = await this.db
      .selectFrom('trip_shares')
      .select(['expires_at', 'created_at'])
      .where('booking_id', '=', bookingId)
      .where('created_by', '=', userId)
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', new Date())
      .executeTakeFirst();
    return { active: !!s, expiresAt: s?.expires_at ?? null, createdAt: s?.created_at ?? null };
  }

  /** Vue publique d'un lien de partage : trajet, heure, prénom du conducteur, véhicule, immatriculation, statut. */
  async viewShare(token: string) {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw shareNotFound();
    const s = await this.db
      .selectFrom('trip_shares')
      .innerJoin('trips', 'trips.id', 'trip_shares.trip_id')
      .innerJoin('vehicles', 'vehicles.id', 'trips.vehicle_id')
      .innerJoin('users as d', 'd.id', 'trips.driver_id')
      .leftJoin('bookings', 'bookings.id', 'trip_shares.booking_id')
      .leftJoin('trip_stops as p', 'p.id', 'bookings.pickup_stop_id')
      .leftJoin('trip_stops as o', 'o.id', 'bookings.dropoff_stop_id')
      .select(['trip_shares.expires_at', 'trip_shares.revoked_at', 'trips.status', 'trips.departure_at', 'trips.estimated_arrival_at', 'trips.started_at',
               'trips.completed_at', 'trips.is_demo', 'vehicles.make', 'vehicles.model', 'vehicles.color', 'vehicles.plate_number', 'd.first_name',
               'p.label as pickup', 'p.planned_at as pickup_at', 'o.label as dropoff', 'o.planned_at as dropoff_at', 'bookings.status as booking_status'])
      .where('trip_shares.token_hash', '=', hashToken(token))
      .executeTakeFirst();
    if (!s || s.revoked_at || s.expires_at.getTime() <= Date.now()) throw shareNotFound();
    const cancelled = s.booking_status !== null && s.booking_status !== 'CONFIRMED' && s.booking_status !== 'COMPLETED';
    return {
      status: cancelled ? 'CANCELLED' : s.status,
      statusText: cancelled ? 'Réservation annulée' : (STATUS_TEXT[s.status] ?? s.status),
      pickup: { label: s.pickup, plannedAt: s.pickup_at },
      dropoff: { label: s.dropoff, plannedAt: s.dropoff_at },
      departureAt: s.departure_at,
      estimatedArrivalAt: s.estimated_arrival_at,
      startedAt: s.started_at,
      completedAt: s.completed_at,
      // Heures prévues par le conducteur : ce ne sont pas des positions GPS (la position en direct n'existe pas encore).
      isEstimate: true,
      driver: { firstName: s.first_name },
      vehicle: { make: s.make, model: s.model, color: s.color, plateNumber: s.plate_number },
      expiresAt: s.expires_at,
      isDemo: s.is_demo,
    };
  }
}
