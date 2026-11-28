import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { latitude, longitude } from '../../common/geo';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { Public, StaffOnly } from '../auth/decorators';
import { resolveAppearance } from '../users/appearance';
import { resolveDynamicPricing, trafficInfo } from './price-factors';
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

/** Embouteillages : alerte de l'équipe et heures de pointe (écran « Paramètres » de l'appli). */
@ApiTags('trajets')
@Public()
@Controller('app')
export class TrafficController {
  constructor(private readonly settings: SettingsService) {}

  @Get('traffic')
  @ApiOperation({ summary: 'Embouteillages signalés par l’équipe et heures de pointe habituelles' })
  async traffic() {
    return trafficInfo(resolveDynamicPricing(await this.settings.get('pricing.dynamic')));
  }
}

/** Console : carte en temps réel des trajets en cours (positions exactes des conducteurs, passagers confirmés). */
@ApiTags('admin')
@Controller('admin/live')
export class AdminLiveController {
  constructor(private readonly live: LiveLocationService) {}

  @StaffOnly('trips.read')
  @Get()
  @ApiOperation({ summary: 'Trajets en cours : position du conducteur et passagers à bord' })
  overview() {
    return this.live.adminOverview();
  }
}
