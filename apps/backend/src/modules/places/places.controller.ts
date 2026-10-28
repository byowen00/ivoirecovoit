import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { Public } from '../auth/decorators';
import { type PlaceSuggestion, PlacesService } from './places.service';

const autocompleteQuery = z.object({
  q: z.string().trim().min(2, 'Saisissez au moins 2 caractères.').max(60),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});
type AutocompleteQuery = z.infer<typeof autocompleteQuery>;

@ApiTags('lieux')
@Public()
@Controller('places')
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  @Get('autocomplete')
  @ApiOperation({ summary: 'Suggestions de villes, communes et quartiers' })
  @ApiQuery({ name: 'q', example: 'yamous' })
  @ApiQuery({ name: 'limit', required: false, example: 8 })
  async autocomplete(
    @Query(new ZodValidationPipe(autocompleteQuery)) query: AutocompleteQuery,
  ): Promise<{ data: PlaceSuggestion[] }> {
    return { data: await this.places.autocomplete(query.q, query.limit) };
  }
}
