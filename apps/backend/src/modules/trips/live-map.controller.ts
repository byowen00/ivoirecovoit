import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { latitude, longitude } from '../../common/geo';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { Public } from '../auth/decorators';
import { resolveAppearance } from '../users/appearance';
import { SettingsService } from '../users/settings.service';
import { LiveLocationService } from './live-location.service';

const nearQuery = z.object({ lat: z.coerce.number().pipe(latitude), lng: z.coerce.number().pipe(longitude) });

/** Conducteurs en circulation, pour la carte de l'accueil (activable dans « Interface et design »). */
@ApiTags('trajets')
@Public()
@Controller('live')
export class LiveMapController {
  constructor(
    private readonly live: LiveLocationService,
    private readonly settings: SettingsService,
  ) {}

  @Get('drivers')
  @ApiOperation({ summary: 'Trajets en cours autour d’un point (positions arrondies à 500 m environ, sans identité)' })
  async drivers(@Query(new ZodValidationPipe(nearQuery)) q: z.infer<typeof nearQuery>) {
    const look = resolveAppearance(await this.settings.get('ui.appearance'));
    if (!look.liveDrivers) return { enabled: false, data: [] };
    return { enabled: true, ...(await this.live.nearby(q)) };
  }
}
