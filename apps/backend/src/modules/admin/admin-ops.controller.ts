import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { IdempotencyService, requireIdempotencyKey } from '../../infra/idempotency.service';
import { CurrentAuth, StaffOnly } from '../auth/decorators';
import { type AppRequest, type AuthContext, requestContext } from '../auth/request-context';
import {
  bookingsQuery,
  type BookingsQuery,
  commissionsQuery,
  exportSchema,
  generatePayoutsSchema,
  markPaidSchema,
  noteSchema,
  notesQuery,
  paymentsQuery,
  type PaymentsQuery,
  payoutsQuery,
  reasonOnlySchema,
  type ReasonOnlyInput,
  reconciliationRunSchema,
  refundSchema,
  type RefundInput,
  refundsQuery,
  resolveItemSchema,
  tripsQuery,
  type TripsQuery,
} from './admin.schemas';
import { AdminFinanceService } from './admin-finance.service';
import { AdminOpsService } from './admin-ops.service';

/** Exploitation (trajets, réservations, paiements, notes, bannissement) et finance (doc 04 §12). */
@ApiTags('administration')
@ApiBearerAuth()
@Controller('admin')
export class AdminOpsController {
  constructor(
    private readonly ops: AdminOpsService,
    private readonly finance: AdminFinanceService,
    private readonly idempotency: IdempotencyService,
  ) {}

  // ------------------------------------------------------------------ trajets

  @StaffOnly('trips.read')
  @Get('trips')
  trips(@Query(new ZodValidationPipe(tripsQuery)) q: TripsQuery) {
    return this.ops.trips(q);
  }

  @StaffOnly('trips.read')
  @Get('trips/:id')
  trip(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.ops.trip(id);
  }

  @StaffOnly('trips.moderate')
  @Post('trips/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Annulation administrative : passagers remboursés intégralement' })
  cancelTrip(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string,
             @Body(new ZodValidationPipe(reasonOnlySchema)) body: ReasonOnlyInput, @Req() req: AppRequest) {
    return this.ops.cancelTrip(auth, id, body.reason, requestContext(req));
  }

  // ------------------------------------------------------------------ réservations

  @StaffOnly('bookings.read')
  @Get('bookings')
  bookings(@Query(new ZodValidationPipe(bookingsQuery)) q: BookingsQuery) {
    return this.ops.bookings(q);
  }

  @StaffOnly('bookings.read')
  @Get('bookings/:id')
  booking(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.ops.booking(id);
  }

  @StaffOnly('trips.moderate')
  @Post('bookings/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelBooking(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string,
                @Body(new ZodValidationPipe(reasonOnlySchema)) body: ReasonOnlyInput, @Req() req: AppRequest) {
    return this.ops.cancelBooking(auth, id, body.reason, requestContext(req));
  }

  // ------------------------------------------------------------------ paiements

  @StaffOnly('payments.read')
  @Get('payments')
  payments(@Query(new ZodValidationPipe(paymentsQuery)) q: PaymentsQuery) {
    return this.ops.paymentsList(q);
  }

  @StaffOnly('payments.read')
  @Get('payments/:id')
  payment(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.ops.payment(id);
  }

  @StaffOnly('payments.read')
  @Post('payments/:id/recheck')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Interroge le prestataire et applique le statut vérifié' })
  recheck(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Req() req: AppRequest) {
    return this.ops.recheck(auth, id, requestContext(req));
  }

  // ------------------------------------------------------------------ notes internes et bannissement

  @StaffOnly('users.read', 'trips.read', 'bookings.read')
  @Get('notes')
  notes(@Query(new ZodValidationPipe(notesQuery)) q: z.infer<typeof notesQuery>) {
    return this.ops.notes(q.targetType, q.targetId);
  }

  @StaffOnly('users.read', 'trips.read', 'bookings.read')
  @Post('notes')
  addNote(@CurrentAuth() auth: AuthContext, @Body(new ZodValidationPipe(noteSchema)) body: z.infer<typeof noteSchema>, @Req() req: AppRequest) {
    return this.ops.addNote(auth, body.targetType, body.targetId, body.body, requestContext(req));
  }

  @StaffOnly('users.moderate')
  @Post('users/:id/ban')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bannissement : sessions révoquées, trajets à venir annulés et remboursés' })
  ban(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string,
      @Body(new ZodValidationPipe(reasonOnlySchema)) body: ReasonOnlyInput, @Req() req: AppRequest) {
    return this.ops.ban(auth, id, body.reason, requestContext(req));
  }

  // ------------------------------------------------------------------ remboursements

  @StaffOnly('refunds.create', 'refunds.create.capped', 'refunds.approve', 'finance.read')
  @Get('refunds')
  async refunds(@Query(new ZodValidationPipe(refundsQuery)) q: z.infer<typeof refundsQuery>) {
    return { ...(await this.finance.refundsList(q)), limits: await this.finance.limits() };
  }

  @StaffOnly('refunds.create', 'refunds.create.capped', 'refunds.approve', 'finance.read')
  @Get('refunds/:id')
  refund(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.finance.refund(id);
  }

  @StaffOnly('refunds.create', 'refunds.create.capped')
  @Post('refunds')
  @ApiOperation({ summary: 'Remboursement décidé par le personnel ; au-delà du plafond ou du seuil : en attente de validation' })
  async createRefund(@CurrentAuth() auth: AuthContext, @Headers('idempotency-key') key: string | undefined,
                     @Body(new ZodValidationPipe(refundSchema)) body: RefundInput, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const ctx = requestContext(req);
    const r = await this.idempotency.run(auth.userId, requireIdempotencyKey(key), 'POST /admin/refunds', body, 201,
                                         () => this.finance.requestRefund(auth, body, ctx));
    res.status(r.status);
    return r.body;
  }

  @StaffOnly('refunds.approve')
  @Post('refunds/:id/approve')
  @HttpCode(HttpStatus.OK)
  approveRefund(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Req() req: AppRequest) {
    return this.finance.approveRefund(auth, id, requestContext(req));
  }

  @StaffOnly('refunds.approve')
  @Post('refunds/:id/reject')
  @HttpCode(HttpStatus.OK)
  rejectRefund(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string,
               @Body(new ZodValidationPipe(reasonOnlySchema)) body: ReasonOnlyInput, @Req() req: AppRequest) {
    return this.finance.rejectRefund(auth, id, body.reason, requestContext(req));
  }

  // ------------------------------------------------------------------ commissions et versements

  @StaffOnly('finance.read')
  @Get('commissions')
  commissions(@Query(new ZodValidationPipe(commissionsQuery)) q: z.infer<typeof commissionsQuery>) {
    return this.finance.commissions(q);
  }

  @StaffOnly('finance.read')
  @Get('payouts')
  payouts(@Query(new ZodValidationPipe(payoutsQuery)) q: z.infer<typeof payoutsQuery>) {
    return this.finance.payouts(q);
  }

  @StaffOnly('finance.read')
  @Get('payouts/:id')
  payout(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.finance.payout(id);
  }

  @StaffOnly('finance.payouts')
  @Post('payouts/generate')
  @ApiOperation({ summary: 'Prépare des relevés de versement (brouillons) : le virement se fait hors plateforme' })
  generatePayouts(@CurrentAuth() auth: AuthContext, @Body(new ZodValidationPipe(generatePayoutsSchema)) body: z.infer<typeof generatePayoutsSchema>,
                  @Req() req: AppRequest) {
    return this.finance.generatePayouts(auth, body, requestContext(req));
  }

  @StaffOnly('finance.payouts')
  @Post('payouts/:id/mark-paid')
  @HttpCode(HttpStatus.OK)
  markPaid(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string,
           @Body(new ZodValidationPipe(markPaidSchema)) body: z.infer<typeof markPaidSchema>, @Req() req: AppRequest) {
    return this.finance.markPayoutPaid(auth, id, body, requestContext(req));
  }

  @StaffOnly('finance.payouts')
  @Post('payouts/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelPayout(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string,
               @Body(new ZodValidationPipe(reasonOnlySchema)) body: ReasonOnlyInput, @Req() req: AppRequest) {
    return this.finance.cancelPayout(auth, id, body.reason, requestContext(req));
  }

  // ------------------------------------------------------------------ rapprochement

  @StaffOnly('finance.reconcile')
  @Get('reconciliation/runs')
  reconciliationRuns() {
    return this.finance.reconciliationRuns(30);
  }

  @StaffOnly('finance.reconcile')
  @Get('reconciliation/runs/:id')
  reconciliationRun(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.finance.reconciliationRun(id);
  }

  @StaffOnly('finance.reconcile')
  @Post('reconciliation/run')
  runReconciliation(@CurrentAuth() auth: AuthContext, @Body(new ZodValidationPipe(reconciliationRunSchema)) body: z.infer<typeof reconciliationRunSchema>,
                    @Req() req: AppRequest) {
    return this.finance.runReconciliation(auth, body.from, body.to, requestContext(req));
  }

  @StaffOnly('finance.reconcile')
  @Post('reconciliation/items/:id/resolve')
  @HttpCode(HttpStatus.OK)
  resolveItem(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string,
              @Body(new ZodValidationPipe(resolveItemSchema)) body: z.infer<typeof resolveItemSchema>, @Req() req: AppRequest) {
    return this.finance.resolveReconciliationItem(auth, id, body.note, requestContext(req));
  }

  // ------------------------------------------------------------------ exports

  @StaffOnly('exports.create')
  @Post('exports')
  @ApiOperation({ summary: 'Export CSV (sans numéros de téléphone) téléchargeable par URL signée' })
  createExport(@CurrentAuth() auth: AuthContext, @Body(new ZodValidationPipe(exportSchema)) body: z.infer<typeof exportSchema>, @Req() req: AppRequest) {
    return this.finance.createExport(auth, body, requestContext(req));
  }
}
