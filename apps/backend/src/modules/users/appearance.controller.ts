import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators';
import { resolveAppearance, THEMES, VEHICLE_COLORS } from './appearance';
import { SettingsService } from './settings.service';

/** Apparence choisie dans l'administration, lue par le site et l'appli au démarrage. */
@ApiTags('apparence')
@Public()
@Controller('app')
export class AppearanceController {
  constructor(private readonly settings: SettingsService) {}

  @Get('appearance')
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({ summary: 'Palette de couleurs et disposition de l’accueil (réglées par l’administration)' })
  async appearance() {
    // Les palettes disponibles accompagnent la réponse : l'administration en affiche l'aperçu.
    return { ...resolveAppearance(await this.settings.get('ui.appearance')), themes: THEMES, vehicleColors: VEHICLE_COLORS };
  }
}
