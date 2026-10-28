import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { latitude, longitude } from '../../common/geo';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { RateLimitService } from '../../infra/rate-limit.service';
import type { AppRequest } from '../auth/request-context';
import { Public } from '../auth/decorators';
import { type PlaceSuggestion, PlacesService } from './places.service';

const autocompleteQuery = z.object({
  q: z.string().trim().min(2, 'Saisissez au moins 2 caractères.').max(60),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});
type AutocompleteQuery = z.infer<typeof autocompleteQuery>;

const reverseQuery = z.object({ lat: z.coerce.number().pipe(latitude), lng: z.coerce.number().pipe(longitude) });
type ReverseQuery = z.infer<typeof reverseQuery>;

@ApiTags('lieux')
@Public()
@Controller('places')
export class PlacesController {
  constructor(
    private readonly places: PlacesService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get('autocomplete')
  @ApiOperation({ summary: 'Suggestions de villes, communes et quartiers' })
  @ApiQuery({ name: 'q', example: 'yamous' })
  @ApiQuery({ name: 'limit', required: false, example: 8 })
  async autocomplete(
    @Query(new ZodValidationPipe(autocompleteQuery)) query: AutocompleteQuery,
  ): Promise<{ data: PlaceSuggestion[] }> {
    return { data: await this.places.autocomplete(query.q, query.limit) };
  }

  @Get('reverse')
  @ApiOperation({ summary: 'Lieu du référentiel le plus proche d’un point (20 km au plus)' })
  async reverse(@Query(new ZodValidationPipe(reverseQuery)) query: ReverseQuery, @Req() req: AppRequest) {
    await this.rateLimit.consumeOrThrow([{ key: `reverse:${req.ip}`, limit: 60, windowS: 60 }]);
    return { data: await this.places.reverse(query.lat, query.lng) };
  }

  @Get('popular-routes')
  @ApiOperation({ summary: 'Axes populaires avec le nombre de trajets à venir' })
  async popularRoutes() {
    return { data: await this.places.popularRoutes() };
  }
}
