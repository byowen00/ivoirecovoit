import { Controller, Get, HttpStatus, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { sql } from 'kysely';
import { ApiError } from '../../common/api-error';
import { DB, type Db } from '../../database/database.module';

@ApiTags('santé')
@Controller('health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  @ApiOperation({ summary: "État de l'API et de la base de données" })
  async check(): Promise<{ status: 'ok'; database: 'ok'; postgis: string }> {
    try {
      const { rows } = await sql<{ postgis: string }>`SELECT postgis_lib_version() AS postgis`.execute(this.db);
      return { status: 'ok', database: 'ok', postgis: rows[0]!.postgis };
    } catch {
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'DATABASE_UNAVAILABLE', 'Base de données indisponible.');
    }
  }
}
