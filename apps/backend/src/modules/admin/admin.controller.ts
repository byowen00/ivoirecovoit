import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentAuth, StaffOnly } from '../auth/decorators';
import { type AppRequest, type AuthContext, requestContext } from '../auth/request-context';
import { SessionsService } from '../auth/sessions.service';
import { StaffAuthService } from '../auth/staff-auth.service';
import {
  type AuditQuery,
  auditQuery,
  type ListUsersQuery,
  listUsersQuery,
  type RevealInput,
  revealSchema,
  type SuspendInput,
  suspendSchema,
  unsuspendSchema,
} from './admin.schemas';
import { AdminUsersService } from './admin-users.service';

@ApiTags('administration')
@ApiBearerAuth()
@Controller('admin')
export class AdminController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly staff: StaffAuthService,
    private readonly sessions: SessionsService,
  ) {}

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
