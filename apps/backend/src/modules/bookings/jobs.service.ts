import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { ENV, type Env } from '../../config/env';
import { BookingsMaintenanceService } from './maintenance.service';

const QUEUE = 'maintenance';

/**
 * Planification BullMQ : une tâche toutes les minutes traite les échéances (doc 05 §3 : « tâche de rattrapage »).
 * Une seule instance de la tâche tourne à la fois, même avec plusieurs serveurs API (verrou BullMQ).
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
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.env.JOBS_ENABLED) return;
    this.connection = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.connection.on('error', (err: Error) => this.logger.error(`Redis indisponible : ${err.message}`));
    this.queue = new Queue(QUEUE, { connection: this.connection });
    await this.queue.upsertJobScheduler('deadlines-every-minute', { every: 60_000 }, { name: 'deadlines', opts: { removeOnComplete: 100, removeOnFail: 500 } });
    this.worker = new Worker(QUEUE, () => this.maintenance.runAll(), { connection: this.connection, concurrency: 1 });
    this.worker.on('failed', (_job, err) => this.logger.error(`Échéances : ${err.message}`));
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
    await this.connection?.quit().catch(() => undefined);
  }
}
