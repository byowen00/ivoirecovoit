import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentAuth, StaffOnly } from '../auth/decorators';
import { type AppRequest, type AuthContext, requestContext } from '../auth/request-context';
import { SessionsService } from '../auth/sessions.service';
import { StaffAuthService } from '../auth/staff-auth.service';
import { DocumentsService } from '../drivers/documents.service';
import {
  type ApproveInput,
  approveSchema,
  type AuditQuery,
  auditQuery,
  documentViewSchema,
  type RejectInput,
  rejectSchema,
  type VerificationListQuery,
  verificationListQuery,
  verificationType,
  type VerificationType,
  type ListUsersQuery,
  listUsersQuery,
  type RevealInput,
  revealSchema,
  type SuspendInput,
  suspendSchema,
  unsuspendSchema,
} from './admin.schemas';
import { AdminUsersService } from './admin-users.service';
import { AdminVerificationsService } from './admin-verifications.service';

@ApiTags('administration')
@ApiBearerAuth()
@Controller('admin')
export class AdminController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly staff: StaffAuthService,
    private readonly sessions: SessionsService,
    private readonly verifications: AdminVerificationsService,
    private readonly documents: DocumentsService,
  ) {}

  @StaffOnly('verifications.read')
  @Get('verifications')
  @ApiOperation({ summary: 'File de vérification : dossiers conducteur, véhicules, pièces renouvelées' })
  listVerifications(@Query(new ZodValidationPipe(verificationListQuery)) query: VerificationListQuery) {
    return this.verifications.list(query);
  }

  @StaffOnly('verifications.read')
  @Get('verifications/driver/:id')
  getDriverVerification(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.verifications.getDriver(id);
  }

  @StaffOnly('verifications.read')
  @Get('verifications/vehicle/:id')
  getVehicleVerification(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.verifications.getVehicle(id);
  }

  @StaffOnly('verifications.decide')
  @Post('verifications/:type/:id/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @CurrentAuth() auth: AuthContext,
    @Param('type', new ZodValidationPipe(verificationType)) type: VerificationType,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(approveSchema)) body: ApproveInput,
    @Req() req: AppRequest,
  ) {
    return this.verifications.approve(auth.userId, type, id, body, requestContext(req));
  }

  @StaffOnly('verifications.decide')
  @Post('verifications/:type/:id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @CurrentAuth() auth: AuthContext,
    @Param('type', new ZodValidationPipe(verificationType)) type: VerificationType,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(rejectSchema)) body: RejectInput,
    @Req() req: AppRequest,
  ) {
    return this.verifications.reject(auth.userId, type, id, body, requestContext(req));
  }

  @StaffOnly('documents.view')
  @Post('documents/:id/download-url')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'URL signée (5 min) d’une pièce justificative : motif obligatoire, journalisé' })
  documentUrl(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(documentViewSchema)) body: z.infer<typeof documentViewSchema>,
    @Req() req: AppRequest,
  ) {
    return this.documents.staffDownloadUrl(auth.userId, id, body.reason, requestContext(req));
  }

  @StaffOnly()
  @Get('me')
  me(@CurrentAuth() auth: AuthContext) {
    return this.staff.view(auth.userId);
  }

  @StaffOnly()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentAuth() auth: AuthContext): Promise<void> {
    await this.sessions.revokeOwned(auth.userId, auth.sessionId, 'LOGOUT');
  }

  @StaffOnly('users.read')
  @Get('users')
  @ApiOperation({ summary: 'Recherche d’utilisateurs (téléphone et e-mail masqués)' })
  listUsers(@Query(new ZodValidationPipe(listUsersQuery)) query: ListUsersQuery) {
    return this.users.list(query);
  }

  @StaffOnly('users.read')
  @Get('users/:id')
  getUser(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.users.get(id);
  }

  @StaffOnly('users.read_sensitive')
  @Post('users/:id/reveal')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Affiche une donnée sensible en clair (motif obligatoire, journalisé)' })
  reveal(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(revealSchema)) body: RevealInput,
    @Req() req: AppRequest,
  ) {
    return this.users.reveal(auth, id, body, requestContext(req));
  }

  @StaffOnly('users.moderate', 'users.moderate.short')
  @Post('users/:id/suspend')
  @HttpCode(HttpStatus.OK)
  suspend(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(suspendSchema)) body: SuspendInput,
    @Req() req: AppRequest,
  ) {
    return this.users.suspend(auth, id, body, requestContext(req));
  }

  @StaffOnly('users.moderate', 'users.moderate.short')
  @Post('users/:id/unsuspend')
  @HttpCode(HttpStatus.OK)
  unsuspend(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(unsuspendSchema)) body: z.infer<typeof unsuspendSchema>,
    @Req() req: AppRequest,
  ) {
    return this.users.unsuspend(auth, id, body.reason, requestContext(req));
  }

  @StaffOnly('audit.read')
  @Get('audit-logs')
  auditLogs(@Query(new ZodValidationPipe(auditQuery)) query: AuditQuery) {
    return this.users.auditLogs(query);
  }
}
