import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { IdempotencyService, requireIdempotencyKey } from '../../infra/idempotency.service';
import { RateLimitService } from '../../infra/rate-limit.service';
import { CurrentAuth, MaybeAuth, OptionalAuth, Public } from '../auth/decorators';
import { type AppRequest, type AuthContext, requestContext } from '../auth/request-context';
import { SearchService } from './search.service';
import {
  type AvailabilityQuery,
  availabilityQuery,
  type CancelInput,
  cancelSchema,
  type CreateTripInput,
  createTripSchema,
  type DuplicateInput,
  duplicateSchema,
  type MineQuery,
  mineQuery,
  type PreviewTripInput,
  previewTripSchema,
  type SearchQuery,
  searchQuery,
  type UpdateTripInput,
  updateTripSchema,
} from './trips.schemas';
import { TripsService } from './trips.service';

@ApiTags('trajets')
@ApiBearerAuth()
@Controller('trips')
export class TripsController {
  constructor(
    private readonly trips: TripsService,
    private readonly search: SearchService,
    private readonly idempotency: IdempotencyService,
    private readonly rateLimit: RateLimitService,
  ) {}

  // Les routes à chemin fixe sont déclarées avant « :id ».

  @Public()
  @Get('search')
  @ApiOperation({ summary: 'Recherche par segment (départ et arrivée proches d’arrêts du trajet, dans l’ordre)' })
  async searchTrips(@Query(new ZodValidationPipe(searchQuery)) query: SearchQuery, @Req() req: AppRequest) {
    await this.rateLimit.consumeOrThrow([{ key: `search:${req.ip}`, limit: 120, windowS: 60 }]);
    return this.search.search(query);
  }

  @Get('mine')
  @ApiOperation({ summary: 'Mes trajets (conducteur vérifié) : à venir, en cours, passés, brouillons' })
  mine(@CurrentAuth() auth: AuthContext, @Query(new ZodValidationPipe(mineQuery)) query: MineQuery) {
    return this.trips.mine(auth.userId, query);
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Itinéraire estimé, horaires de passage et prix suggérés, sans rien enregistrer' })
  async preview(@CurrentAuth() auth: AuthContext, @Body(new ZodValidationPipe(previewTripSchema)) body: PreviewTripInput) {
    await this.rateLimit.consumeOrThrow([{ key: `routing:${auth.userId}`, limit: 120, windowS: 3600 }]);
    return this.trips.preview(auth.userId, body);
  }

  @Post()
  @ApiOperation({ summary: 'Crée un brouillon ou publie directement (publish: true). Idempotency-Key obligatoire' })
  async create(
    @CurrentAuth() auth: AuthContext,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(createTripSchema)) body: CreateTripInput,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.idempotency.run(auth.userId, requireIdempotencyKey(key), 'POST /trips', body, 201, () =>
      this.trips.create(auth.userId, body, requestContext(req)),
    );
    res.status(result.status);
    return result.body;
  }

  @Public()
  @OptionalAuth()
  @Get(':id')
  @ApiOperation({ summary: 'Détail public (coordonnées arrondies sauf pour le conducteur et les passagers confirmés)' })
  detail(@Param('id', new ParseUUIDPipe()) id: string, @MaybeAuth() auth?: AuthContext) {
    return this.search.publicDetail(id, auth?.userId);
  }

  @Public()
  @Get(':id/availability')
  @ApiOperation({ summary: 'Places restantes et prix unitaire sur un segment' })
  availability(@Param('id', new ParseUUIDPipe()) id: string, @Query(new ZodValidationPipe(availabilityQuery)) query: AvailabilityQuery) {
    return this.search.availability(id, query);
  }

  @Get(':id/manage')
  manage(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.trips.manageView(auth.userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Modifie un trajet (If-Match : version) selon les règles du doc 05 §6' })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body(new ZodValidationPipe(updateTripSchema)) body: UpdateTripInput,
    @Req() req: AppRequest,
  ) {
    return this.trips.update(auth.userId, id, ifMatch, body, requestContext(req));
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  publish(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Req() req: AppRequest) {
    return this.trips.publish(auth.userId, id, requestContext(req));
  }

  @Post(':id/duplicate')
  @ApiOperation({ summary: 'Duplique le trajet sur plusieurs dates (14 au maximum). Idempotency-Key obligatoire' })
  async duplicate(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(duplicateSchema)) body: DuplicateInput,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.idempotency.run(auth.userId, requireIdempotencyKey(key), `POST /trips/${id}/duplicate`, body, 201, () =>
      this.trips.duplicate(auth.userId, id, body, requestContext(req)),
    );
    res.status(result.status);
    return result.body;
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Annule le trajet. Idempotency-Key obligatoire' })
  async cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(cancelSchema)) body: CancelInput,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.idempotency.run(auth.userId, requireIdempotencyKey(key), `POST /trips/${id}/cancel`, body, 200, () =>
      this.trips.cancel(auth.userId, id, body, requestContext(req)),
    );
    res.status(result.status);
    return result.body;
  }

  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  start(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Req() req: AppRequest) {
    return this.trips.start(auth.userId, id, requestContext(req));
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  complete(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Req() req: AppRequest) {
    return this.trips.complete(auth.userId, id, requestContext(req));
  }
}
