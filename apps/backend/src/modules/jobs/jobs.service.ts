import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { type Job, Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { ENV, type Env } from '../../config/env';
import { BookingsMaintenanceService } from '../bookings/maintenance.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../users/settings.service';
import { PaymentsService } from '../payments/payments.service';
import { ReconciliationService } from '../payments/reconciliation.service';
import { RefundsService } from '../payments/refunds.service';
import { DisputesService } from '../trust/disputes.service';
import { ReviewsService } from '../trust/reviews.service';

const QUEUE = 'maintenance';

/**
 * Planification BullMQ (doc 05 §3 : « tâche de rattrapage »). Toutes les minutes : échéances des réservations,
 * interrogation des paiements restés en attente, remboursements à exécuter, gains devenus disponibles.
 * Chaque nuit à 01:00 UTC : rapprochement de la veille avec le prestataire.
 * Une seule tâche tourne à la fois, même avec plusieurs serveurs API (verrou BullMQ).
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Tâches');
  private connection?: Redis;
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly maintenance: BookingsMaintenanceService,
    private readonly payments: PaymentsService,
    private readonly refunds: RefundsService,
    private readonly reconciliation: ReconciliationService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly reviews: ReviewsService,
    private readonly disputes: DisputesService,
  ) {}

  /** Tâche de la minute ; appelée directement par les tests. */
  async everyMinute(now: Date = new Date()) {
    const bookings = await this.maintenance.runAll(now);
    const polled = await this.payments.pollStale(now);
    const refunded = await this.refunds.processPending(now);
    const hours = (await this.settings.get<number>('finance.driver_payable_after_hours')) ?? 48;
    const payable = await this.refunds.releasePayable(hours, now);
    const reviewsPublished = await this.reviews.publishDue(now);
    const disputesEscalated = await this.disputes.escalateOverdue(now);
    const reminders = await this.notifications.sendReminders(now);
    const notified = await this.notifications.dispatchOutbox();
    if (polled || refunded || payable || reviewsPublished || disputesEscalated) {
      this.logger.log(JSON.stringify({ polled, refunded, payable, reviewsPublished, disputesEscalated }));
    }
    return { ...bookings, polled, refunded, payable, reviewsPublished, disputesEscalated, reminders, notified };
  }

  /** Toutes les 10 s : événements -> notifications, puis envoi sur les téléphones. */
  async notificationsTick() {
    const notified = await this.notifications.dispatchOutbox();
    const push = await this.notifications.deliverPush();
    return { notified, ...push };
  }

  private run(job: Job) {
    if (job.name === 'reconciliation') return this.reconciliation.runDaily();
    if (job.name === 'notifications') return this.notificationsTick();
    return this.everyMinute();
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.env.JOBS_ENABLED) return;
    this.connection = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.connection.on('error', (err: Error) => this.logger.error(`Redis indisponible : ${err.message}`));
    this.queue = new Queue(QUEUE, { connection: this.connection });
    const opts = { removeOnComplete: 100, removeOnFail: 500 };
    await this.queue.upsertJobScheduler('deadlines-every-minute', { every: 60_000 }, { name: 'deadlines', opts });
    await this.queue.upsertJobScheduler('notifications-every-10s', { every: 10_000 }, { name: 'notifications', opts });
    await this.queue.upsertJobScheduler('reconciliation-daily', { pattern: '0 1 * * *', tz: 'UTC' }, { name: 'reconciliation', opts });
    this.worker = new Worker(QUEUE, (job) => this.run(job), { connection: this.connection, concurrency: 1 });
    this.worker.on('failed', (job, err) => this.logger.error(`${job?.name ?? 'tâche'} : ${err.message}`));
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
    await this.connection?.quit().catch(() => undefined);
  }
}
