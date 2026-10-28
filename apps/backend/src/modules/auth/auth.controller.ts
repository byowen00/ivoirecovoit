import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { ApiError } from '../../common/api-error';
import { normalizeCiMobile } from '../../common/phone';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ENV, type Env } from '../../config/env';
import { DB, type Db } from '../../database/database.module';
import { AuditService } from '../../infra/audit.service';
import { UsersService } from '../users/users.service';
import { otpRequestSchema, otpVerifySchema, refreshSchema, staffLoginSchema } from './auth.schemas';
import { AllowIncompleteProfile, CurrentAuth, Public } from './decorators';
import { OtpService } from './otp.service';
import { type AppRequest, type AuthContext, requestContext } from './request-context';
import { accountSuspended, isAllowedStatus, SessionsService } from './sessions.service';
import { StaffAuthService } from './staff-auth.service';

const invalidPhone = () =>
  new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Certains champs sont invalides.', {
    fields: { phone: 'Numéro de mobile ivoirien attendu (10 chiffres, commençant par 01, 05 ou 07).' },
  });

@ApiTags('authentification')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Db,
    private readonly otp: OtpService,
    private readonly sessions: SessionsService,
    private readonly users: UsersService,
    private readonly staff: StaffAuthService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Envoie un code de connexion par SMS (même réponse que le compte existe ou non)' })
  async requestOtp(@Body(new ZodValidationPipe(otpRequestSchema)) body: z.infer<typeof otpRequestSchema>, @Req() req: AppRequest) {
    const phone = normalizeCiMobile(body.phone, { allowDemo: this.env.OTP_TEST_MODE });
    if (!phone) throw invalidPhone();
    const deviceId = req.header('x-device-id')?.slice(0, 64) ?? null;
    return this.otp.request({ phone, purpose: body.purpose, ip: req.ip ?? null, deviceId });
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Vérifie le code et ouvre une session (crée le compte au premier passage)' })
  async verifyOtp(@Body(new ZodValidationPipe(otpVerifySchema)) body: z.infer<typeof otpVerifySchema>, @Req() req: AppRequest) {
    const ctx = requestContext(req);
    const verified = await this.otp.verify(body.otpRequestId, body.code, ctx.ip ?? null);
    if (verified.purpose !== 'LOGIN') {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'OTP_INVALID', 'Code incorrect.');
    }
    const result = await this.db.transaction().execute(async (trx) => {
      const user = await this.users.findOrCreateByPhone(verified.phone, trx);
      if (!isAllowedStatus(user.status, user.suspendedUntil)) return { suspended: true as const };
      const tokens = await this.sessions.create(user.id, 'USER', body.deviceLabel ?? null, ctx, trx);
      await this.audit.log(
        { actorId: user.id, action: user.isNew ? 'auth.signup' : 'auth.login', targetType: 'user', targetId: user.id, ctx },
        trx,
      );
      return { userId: user.id, isNewUser: user.isNew, tokens };
    });
    if ('suspended' in result) throw accountSuspended();
    return { ...result.tokens, isNewUser: result.isNewUser, user: await this.users.getMe(result.userId) };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renouvelle la paire de jetons (rotation ; réutilisation = révocation)' })
  refresh(@Body(new ZodValidationPipe(refreshSchema)) body: z.infer<typeof refreshSchema>, @Req() req: AppRequest) {
    return this.sessions.refresh(body.refreshToken, requestContext(req));
  }

  @AllowIncompleteProfile()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  async logout(@CurrentAuth() auth: AuthContext): Promise<void> {
    await this.sessions.revokeOwned(auth.userId, auth.sessionId, 'LOGOUT');
  }

  @AllowIncompleteProfile()
  @Get('sessions')
  @ApiBearerAuth()
  async listSessions(@CurrentAuth() auth: AuthContext) {
    return { data: await this.sessions.listActive(auth.userId, auth.kind, auth.sessionId) };
  }

  @AllowIncompleteProfile()
  @Delete('sessions/all')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Déconnecte tous les appareils, y compris celui-ci' })
  async revokeAll(@CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    const revoked = await this.sessions.revokeAllForUser(auth.userId, 'LOGOUT_ALL');
    await this.audit.log({ actorId: auth.userId, action: 'auth.logout_all', targetType: 'user', targetId: auth.userId,
                           changes: { revoked }, ctx: requestContext(req) });
    return { revoked };
  }

  @AllowIncompleteProfile()
  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  async revokeOne(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.sessions.revokeOwned(auth.userId, id, 'REVOKED_BY_USER');
  }

  @Public()
  @Post('staff/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Connexion du personnel : e-mail, mot de passe et code TOTP' })
  staffLogin(@Body(new ZodValidationPipe(staffLoginSchema)) body: z.infer<typeof staffLoginSchema>, @Req() req: AppRequest) {
    return this.staff.login(body.email, body.password, body.totp, requestContext(req));
  }
}
