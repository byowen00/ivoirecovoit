import { Controller, Get, HttpStatus, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Redis } from 'ioredis';
import { sql } from 'kysely';
import { ApiError } from '../../common/api-error';
import { DB, type Db } from '../../database/database.module';
import { REDIS } from '../../infra/redis.module';
import { Public } from '../auth/decorators';

@ApiTags('santé')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  @ApiOperation({ summary: "État de l'API, de la base de données et de Redis" })
  async check(): Promise<{ status: 'ok'; database: 'ok'; redis: 'ok'; postgis: string }> {
    let postgis: string;
    try {
      const { rows } = await sql<{ postgis: string }>`SELECT postgis_lib_version() AS postgis`.execute(this.db);
      postgis = rows[0]!.postgis;
    } catch {
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'DATABASE_UNAVAILABLE', 'Base de données indisponible.');
    }
    try {
      await this.redis.ping();
    } catch {
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'REDIS_UNAVAILABLE', 'Service de sessions indisponible.');
    }
    return { status: 'ok', database: 'ok', redis: 'ok', postgis };
  }
}
