import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentAuth, StaffOnly } from '../auth/decorators';
import { type AppRequest, type AuthContext, requestContext } from '../auth/request-context';
import {
  decideSchema,
  disputeMessageSchema,
  disputesQuery,
  disputeUpdateSchema,
  feeRuleSchema,
  hideSchema,
  periodQuery,
  placeSchema,
  placesQuery,
  placeUpdateSchema,
  promotionSchema,
  promotionUpdateSchema,
  reasonOnlySchema,
  type ReasonOnlyInput,
  reportsQuery,
  reportUpdateSchema,
  settingSchema,
  staffActiveSchema,
  staffCreateSchema,
  staffRolesSchema,
  statsQuery,
} from './admin.schemas';
import { AdminConfigService } from './admin-config.service';
import { AdminStaffService } from './admin-staff.service';
import { AdminTrustService } from './admin-trust.service';

const DAY = 86_400_000;

/** Période par défaut : les 30 derniers jours. */
function period(q: { from?: Date; to?: Date }) {
  const to = q.to ?? new Date();
  return { from: q.from ?? new Date(to.getTime() - 30 * DAY), to };
}

/** Réclamations, signalements, modération, paramètres, frais, promotions, lieux, indicateurs et personnel. */
@ApiTags('administration')
@ApiBearerAuth()
@Controller('admin')
export class AdminConfigController {
  constructor(
    private readonly trust: AdminTrustService,
    private readonly config: AdminConfigService,
    private readonly staffAccounts: AdminStaffService,
  ) {}

  // ------------------------------------------------------------------ tableau de bord et statistiques

  @StaffOnly('stats.read')
  @Get('dashboard')
  dashboard(@Query(new ZodValidationPipe(periodQuery)) q: z.infer<typeof periodQuery>) {
    const p = period(q);
    return this.config.dashboard(p.from, p.to);
  }

  @StaffOnly('stats.read')
  @Get('stats')
  stats(@Query(new ZodValidationPipe(statsQuery)) q: z.infer<typeof statsQuery>) {
    return this.config.stats({ ...q, ...period(q) });
  }

  // ------------------------------------------------------------------ réclamations

  @StaffOnly('disputes.manage')
  @Get('disputes')
  disputes(@Query(new ZodValidationPipe(disputesQuery)) q: z.infer<typeof disputesQuery>) {
    return this.trust.disputes(q);
  }

  @StaffOnly('disputes.manage')
  @Get('disputes/:id')
  @ApiOperation({ summary: 'Détail, y compris la conversation des parties (consultation journalisée)' })
  dispute(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Req() req: AppRequest) {
    return this.trust.dispute(auth, id, requestContext(req));
  }

  @StaffOnly('disputes.manage')
  @Patch('disputes/:id')
  updateDispute(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string,
                @Body(new ZodValidationPipe(disputeUpdateSchema)) body: z.infer<typeof disputeUpdateSchema>, @Req() req: AppRequest) {
    return this.trust.updateDispute(auth, id, body, requestContext(req));
  }

  @StaffOnly('disputes.manage')
  @Post('disputes/:id/messages')
  disputeMessage(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string,
                 @Body(new ZodValidationPipe(disputeMessageSchema)) body: z.infer<typeof disputeMessageSchema>, @Req() req: AppRequest) {
    return this.trust.disputeMessage(auth, id, body, requestContext(req));
  }

  @StaffOnly('disputes.manage')
  @Post('disputes/:id/decide')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Décision ; un remboursement suit les règles de plafond et de double validation' })
  decide(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string,
         @Body(new ZodValidationPipe(decideSchema)) body: z.infer<typeof decideSchema>, @Req() req: AppRequest) {
    return this.trust.decide(auth, id, body, requestContext(req));
  }

  // ------------------------------------------------------------------ signalements et modération

  @StaffOnly('reports.manage')
  @Get('reports')
  reports(@Query(new ZodValidationPipe(reportsQuery)) q: z.infer<typeof reportsQuery>) {
    return this.trust.reports(q);
  }

  @StaffOnly('reports.manage')
  @Get('reports/:id')
  report(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.trust.report(id);
  }

  @StaffOnly('reports.manage')
  @Patch('reports/:id')
  updateReport(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string,
               @Body(new ZodValidationPipe(reportUpdateSchema)) body: z.infer<typeof reportUpdateSchema>, @Req() req: AppRequest) {
    return this.trust.updateReport(auth, id, body, requestContext(req));
  }

  @StaffOnly('reports.manage')
  @Post('reviews/:id/visibility')
  @HttpCode(HttpStatus.OK)
  reviewVisibility(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string,
                   @Body(new ZodValidationPipe(hideSchema)) body: z.infer<typeof hideSchema>, @Req() req: AppRequest) {
    return this.trust.setReviewHidden(auth, id, body.hidden, body.reason, requestContext(req));
  }

  @StaffOnly('reports.manage')
  @Post('messages/:id/hide')
  @HttpCode(HttpStatus.OK)
  hideMessage(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string,
              @Body(new ZodValidationPipe(reasonOnlySchema)) body: ReasonOnlyInput, @Req() req: AppRequest) {
    return this.trust.hideMessage(auth, id, body.reason, requestContext(req));
  }

  // ------------------------------------------------------------------ paramètres versionnés

  @StaffOnly('settings.read')
  @Get('settings')
  settings() {
    return this.config.settingsList();
  }

  @StaffOnly('settings.read')
  @Get('settings/:key')
  settingHistory(@Param('key') key: string) {
    return this.config.settingHistory(key);
  }

  @StaffOnly('settings.write')
  @Put('settings/:key')
  @ApiOperation({ summary: 'Nouvelle version du paramètre (motif obligatoire, journalisé)' })
  putSetting(@CurrentAuth() auth: AuthContext, @Param('key') key: string,
             @Body(new ZodValidationPipe(settingSchema)) body: z.infer<typeof settingSchema>, @Req() req: AppRequest) {
    return this.config.putSetting(auth, key, body.value, body.reason, requestContext(req));
  }

  // ------------------------------------------------------------------ règles de frais

  @StaffOnly('settings.fees')
  @Get('fee-rules')
  feeRules() {
    return this.config.feeRules();
  }

  @StaffOnly('settings.fees')
  @Post('fee-rules')
  @ApiOperation({ summary: 'Nouvelle version datée ; une version déjà utilisée n’est jamais modifiée' })
  createFeeRule(@CurrentAuth() auth: AuthContext, @Body(new ZodValidationPipe(feeRuleSchema)) body: z.infer<typeof feeRuleSchema>, @Req() req: AppRequest) {
    return this.config.createFeeRule(auth, body, requestContext(req));
  }

  // ------------------------------------------------------------------ promotions

  @StaffOnly('promotions.manage')
  @Get('promotions')
  promotions() {
    return this.config.promotions();
  }

  @StaffOnly('promotions.manage')
  @Get('promotions/:id')
  promotion(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.config.promotion(id);
  }

  @StaffOnly('promotions.manage')
  @Post('promotions')
  createPromotion(@CurrentAuth() auth: AuthContext, @Body(new ZodValidationPipe(promotionSchema)) body: z.infer<typeof promotionSchema>, @Req() req: AppRequest) {
    return this.config.createPromotion(auth, body, requestContext(req));
  }

  @StaffOnly('promotions.manage')
  @Patch('promotions/:id')
  updatePromotion(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string,
                  @Body(new ZodValidationPipe(promotionUpdateSchema)) body: z.infer<typeof promotionUpdateSchema>, @Req() req: AppRequest) {
    return this.config.updatePromotion(auth, id, body, requestContext(req));
  }

  // ------------------------------------------------------------------ lieux

  @StaffOnly('places.manage')
  @Get('places')
  places(@Query(new ZodValidationPipe(placesQuery)) q: z.infer<typeof placesQuery>) {
    return this.config.places(q);
  }

  @StaffOnly('places.manage')
  @Get('places/:id')
  place(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.config.place(id);
  }

  @StaffOnly('places.manage')
  @Post('places')
  createPlace(@CurrentAuth() auth: AuthContext, @Body(new ZodValidationPipe(placeSchema)) body: z.infer<typeof placeSchema>, @Req() req: AppRequest) {
    return this.config.createPlace(auth, body, requestContext(req));
  }

  @StaffOnly('places.manage')
  @Patch('places/:id')
  updatePlace(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string,
              @Body(new ZodValidationPipe(placeUpdateSchema)) body: z.infer<typeof placeUpdateSchema>, @Req() req: AppRequest) {
    return this.config.updatePlace(auth, id, body, requestContext(req));
  }

  // ------------------------------------------------------------------ personnel

  @StaffOnly('staff.manage')
  @Get('staff')
  staff() {
    return this.staffAccounts.list();
  }

  @StaffOnly('staff.manage')
  @Get('staff-roles')
  staffRoles() {
    return this.staffAccounts.roles();
  }

  @StaffOnly('staff.manage')
  @Post('staff')
  @ApiOperation({ summary: 'Crée un compte ; le lien TOTP n’est renvoyé qu’une fois' })
  createStaff(@CurrentAuth() auth: AuthContext, @Body(new ZodValidationPipe(staffCreateSchema)) body: z.infer<typeof staffCreateSchema>, @Req() req: AppRequest) {
    return this.staffAccounts.create(auth, body, requestContext(req));
  }

  @StaffOnly('staff.manage')
  @Put('staff/:id/roles')
  setStaffRoles(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string,
                @Body(new ZodValidationPipe(staffRolesSchema)) body: z.infer<typeof staffRolesSchema>, @Req() req: AppRequest) {
    return this.staffAccounts.setRoles(auth, id, body.roles, body.reason, requestContext(req));
  }

  @StaffOnly('staff.manage')
  @Post('staff/:id/active')
  @HttpCode(HttpStatus.OK)
  setStaffActive(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string,
                 @Body(new ZodValidationPipe(staffActiveSchema)) body: z.infer<typeof staffActiveSchema>, @Req() req: AppRequest) {
    return this.staffAccounts.setActive(auth, id, body.active, body.reason, requestContext(req));
  }
}
