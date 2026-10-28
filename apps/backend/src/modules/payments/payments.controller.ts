import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { IdempotencyService, requireIdempotencyKey } from '../../infra/idempotency.service';
import { RateLimitService } from '../../infra/rate-limit.service';
import { CurrentAuth, Public } from '../auth/decorators';
import { type AppRequest, type AuthContext, requestContext } from '../auth/request-context';
import {
  type EarningsQuery,
  earningsQuery,
  type InitiatePaymentInput,
  initiatePaymentSchema,
  type TransactionsQuery,
  transactionsQuery,
} from './payments.schemas';
import { PaymentsService } from './payments.service';

@ApiTags('paiements')
@ApiBearerAuth()
@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly idempotency: IdempotencyService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Get('payments/methods')
  @ApiOperation({ summary: 'Moyens de paiement proposés (selon le prestataire et les paramètres)' })
  methods() {
    return this.payments.methods();
  }

  @Post('bookings/:id/payments')
  @ApiOperation({ summary: 'Lance le paiement mobile d’une réservation (doc 05 §5.1). Idempotency-Key obligatoire' })
  async initiate(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(initiatePaymentSchema)) body: InitiatePaymentInput,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const k = requireIdempotencyKey(key);
    const result = await this.idempotency.run(auth.userId, k, `POST /bookings/${id}/payments`, body, 201, async () => {
      await this.rateLimit.consumeOrThrow([{ key: `payments:${auth.userId}`, limit: 10, windowS: 3600 }]);
      return this.payments.initiate(auth.userId, id, body, k, requestContext(req));
    });
    res.status(result.status);
    return result.body;
  }

  @Get('payments/:id')
  @ApiOperation({ summary: 'Statut d’un paiement vu par le serveur (seul ce statut fait foi)' })
  status(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.payments.status(auth.userId, id);
  }

  @Get('me/transactions')
  @ApiOperation({ summary: 'Historique : paiements et remboursements du passager' })
  transactions(@CurrentAuth() auth: AuthContext, @Query(new ZodValidationPipe(transactionsQuery)) q: TransactionsQuery) {
    return this.payments.transactions(auth.userId, q.cursor, q.limit);
  }

  @Get('me/earnings')
  @ApiOperation({ summary: 'Relevé des gains du conducteur par trajet, sur une période' })
  earnings(@CurrentAuth() auth: AuthContext, @Query(new ZodValidationPipe(earningsQuery)) q: EarningsQuery) {
    return this.payments.earnings(auth.userId, q.from ? new Date(`${q.from}T00:00:00Z`) : undefined, q.to ? new Date(`${q.to}T00:00:00Z`) : undefined);
  }
}

/** Notifications des prestataires : sans session, authentifiées par la signature du corps brut. */
@ApiTags('paiements')
@Controller('webhooks/payments')
export class PaymentWebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  @Public()
  @Post(':provider')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Webhook signé d’un prestataire de paiement' })
  receive(@Param('provider') provider: string, @Req() req: AppRequest & { rawBody?: Buffer }) {
    return this.payments.receiveWebhook(provider, req.rawBody, req.headers);
  }
}
