import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { IdempotencyService, requireIdempotencyKey } from '../../infra/idempotency.service';
import { RateLimitService } from '../../infra/rate-limit.service';
import { CurrentAuth } from '../auth/decorators';
import { type AppRequest, type AuthContext, requestContext } from '../auth/request-context';
import {
  type CreateBookingInput,
  createBookingSchema,
  type MineBookingsQuery,
  mineBookingsQuery,
  type QuoteInput,
  quoteSchema,
  type ReasonInput,
  reasonSchema,
  type RejectInput,
  rejectSchema,
} from './bookings.schemas';
import { BookingsService } from './bookings.service';

@ApiTags('réservations')
@ApiBearerAuth()
@Controller()
export class BookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly idempotency: IdempotencyService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Post('bookings/quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Détail du montant pour un segment, sans réserver' })
  quote(@CurrentAuth() auth: AuthContext, @Body(new ZodValidationPipe(quoteSchema)) body: QuoteInput) {
    return this.bookings.quote(auth.userId, body);
  }

  @Post('bookings')
  @ApiOperation({ summary: 'Réserve et bloque les places (doc 05 §3). Idempotency-Key obligatoire' })
  async create(
    @CurrentAuth() auth: AuthContext,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(createBookingSchema)) body: CreateBookingInput,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.idempotency.run(auth.userId, requireIdempotencyKey(key), 'POST /bookings', body, 201, async () => {
      // Une requête rejouée (même clé) ne consomme pas la limite ; seules les vraies créations comptent.
      const limit = (await this.bookings.rules()).maxCreationsPerHour;
      await this.rateLimit.consumeOrThrow([{ key: `bookings:${auth.userId}`, limit, windowS: 3600 }]);
      return this.bookings.create(auth.userId, body, requestContext(req));
    });
    res.status(result.status);
    return result.body;
  }

  @Get('bookings/mine')
  @ApiOperation({ summary: 'Mes réservations : à venir ou passées' })
  mine(@CurrentAuth() auth: AuthContext, @Query(new ZodValidationPipe(mineBookingsQuery)) query: MineBookingsQuery) {
    return this.bookings.mine(auth.userId, query);
  }

  @Get('bookings/:id')
  @ApiOperation({ summary: 'Détail et historique (passager ou conducteur du trajet ; 404 pour tout autre compte)' })
  detail(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.bookings.view(auth.userId, id);
  }

  @Post('bookings/:id/accept')
  @HttpCode(HttpStatus.OK)
  accept(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Req() req: AppRequest) {
    return this.bookings.accept(auth.userId, id, requestContext(req));
  }

  @Post('bookings/:id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(rejectSchema)) body: RejectInput,
    @Req() req: AppRequest,
  ) {
    return this.bookings.reject(auth.userId, id, body.reason, requestContext(req));
  }

  @Post('bookings/:id/cancel/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Montant remboursable selon la politique, avant confirmation' })
  cancelPreview(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.bookings.cancelPreview(auth.userId, id);
  }

  @Post('bookings/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Annule (passager ou conducteur). Idempotency-Key obligatoire' })
  async cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(reasonSchema)) body: ReasonInput,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.idempotency.run(auth.userId, requireIdempotencyKey(key), `POST /bookings/${id}/cancel`, body, 200, () =>
      this.bookings.cancel(auth.userId, id, body.reason, requestContext(req)),
    );
    res.status(result.status);
    return result.body;
  }

  @Post('trips/:tripId/bookings/:bookingId/no-show')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Passager absent : trajet en cours, 15 min après l’heure de passage prévue' })
  noShow(
    @CurrentAuth() auth: AuthContext,
    @Param('tripId', new ParseUUIDPipe()) tripId: string,
    @Param('bookingId', new ParseUUIDPipe()) bookingId: string,
    @Req() req: AppRequest,
  ) {
    return this.bookings.markNoShow(auth.userId, tripId, bookingId, requestContext(req));
  }
}
