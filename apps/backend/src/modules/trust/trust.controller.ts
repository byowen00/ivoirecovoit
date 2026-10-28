import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { IdempotencyService, requireIdempotencyKey } from '../../infra/idempotency.service';
import { RateLimitService } from '../../infra/rate-limit.service';
import { CurrentAuth, Public } from '../auth/decorators';
import type { AppRequest, AuthContext } from '../auth/request-context';
import { DisputesService, REASON_LABEL } from './disputes.service';
import { MessagesService } from './messages.service';
import { ReportsService } from './reports.service';
import { ReviewsService } from './reviews.service';
import { SafetyService } from './safety.service';
import {
  type DisputeBody,
  disputeMessageSchema,
  disputeSchema,
  messageSchema,
  messagesQuery,
  type ReportBody,
  reportSchema,
  type ReviewInput,
  reviewSchema,
  type UserReviewsQuery,
  userReviewsQuery,
} from './trust.schemas';

@ApiTags('confiance et sécurité')
@ApiBearerAuth()
@Controller()
export class TrustController {
  constructor(
    private readonly messages: MessagesService,
    private readonly reviews: ReviewsService,
    private readonly reports: ReportsService,
    private readonly disputes: DisputesService,
    private readonly safety: SafetyService,
    private readonly idempotency: IdempotencyService,
    private readonly rateLimit: RateLimitService,
  ) {}

  // ------------------------------------------------------------------ messagerie

  @Get('bookings/:id/messages')
  @ApiOperation({ summary: 'Conversation de la réservation (participants seulement)' })
  listMessages(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Query(new ZodValidationPipe(messagesQuery)) q: z.infer<typeof messagesQuery>) {
    return this.messages.list(auth.userId, id, q.after);
  }

  @Post('bookings/:id/messages')
  @ApiOperation({ summary: 'Envoie un message ; coordonnées masquées tant que la réservation n’est pas confirmée' })
  sendMessage(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(messageSchema)) body: z.infer<typeof messageSchema>) {
    return this.messages.send(auth.userId, id, body.body);
  }

  // ------------------------------------------------------------------ avis

  @Get('bookings/:id/review')
  reviewStatus(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.reviews.status(auth.userId, id);
  }

  @Post('bookings/:id/reviews')
  @ApiOperation({ summary: 'Avis après un trajet effectué (14 jours, un par sens)' })
  createReview(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(reviewSchema)) body: ReviewInput) {
    return this.reviews.create(auth.userId, id, body);
  }

  @Public()
  @Get('users/:id/reviews')
  @ApiOperation({ summary: 'Avis publiés sur un utilisateur (prénom des auteurs seulement)' })
  userReviews(@Param('id', new ParseUUIDPipe()) id: string, @Query(new ZodValidationPipe(userReviewsQuery)) q: UserReviewsQuery) {
    return this.reviews.forUser(id, q);
  }

  // ------------------------------------------------------------------ signalements

  @Post('reports')
  async report(
    @CurrentAuth() auth: AuthContext,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(reportSchema)) body: ReportBody,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.idempotency.run(auth.userId, requireIdempotencyKey(key), 'POST /reports', body, 201, () => this.reports.create(auth.userId, body));
    res.status(r.status);
    return r.body;
  }

  @Get('reports/mine')
  myReports(@CurrentAuth() auth: AuthContext) {
    return this.reports.mine(auth.userId);
  }

  // ------------------------------------------------------------------ réclamations

  @Get('bookings/:id/dispute')
  @ApiOperation({ summary: 'Une réclamation est-elle possible sur cette réservation, et avec quels motifs ?' })
  async disputeEligibility(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
    const e = await this.disputes.eligibility(auth.userId, id);
    return {
      allowed: e.allowed,
      deadline: e.deadline,
      openDisputeId: e.open?.id ?? null,
      reasons: e.reasons.map((code) => ({ code, label: REASON_LABEL[code] })),
    };
  }

  @Post('disputes')
  async openDispute(
    @CurrentAuth() auth: AuthContext,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(disputeSchema)) body: DisputeBody,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.idempotency.run(auth.userId, requireIdempotencyKey(key), 'POST /disputes', body, 201, () => this.disputes.create(auth.userId, body));
    res.status(r.status);
    return r.body;
  }

  @Get('disputes/mine')
  myDisputes(@CurrentAuth() auth: AuthContext) {
    return this.disputes.mine(auth.userId);
  }

  @Get('disputes/:id')
  dispute(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.disputes.get(auth.userId, id);
  }

  @Post('disputes/:id/messages')
  replyDispute(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(disputeMessageSchema)) body: z.infer<typeof disputeMessageSchema>) {
    return this.disputes.reply(auth.userId, id, body.body);
  }

  // ------------------------------------------------------------------ sécurité

  @Public()
  @Get('safety/emergency-numbers')
  emergency() {
    return this.safety.emergencyNumbers();
  }

  @Get('bookings/:id/share')
  shareStatus(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.safety.shareStatus(auth.userId, id);
  }

  @Post('bookings/:id/share')
  @ApiOperation({ summary: 'Crée un lien temporaire pour qu’un proche suive le trajet (remplace le précédent)' })
  createShare(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.safety.createShare(auth.userId, id);
  }

  @Delete('bookings/:id/share')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeShare(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.safety.revokeShare(auth.userId, id);
  }

  @Public()
  @Get('share/:token')
  @ApiOperation({ summary: 'Vue publique d’un lien de partage de trajet' })
  async viewShare(@Param('token') token: string, @Req() req: AppRequest) {
    await this.rateLimit.consumeOrThrow([{ key: `share:${req.ip ?? 'inconnu'}`, limit: 120, windowS: 3600 }]);
    return this.safety.viewShare(token);
  }
}
