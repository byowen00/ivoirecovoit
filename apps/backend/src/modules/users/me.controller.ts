import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { ApiError } from '../../common/api-error';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { deletionSchema } from '../auth/auth.schemas';
import { AllowIncompleteProfile, CurrentAuth } from '../auth/decorators';
import { OtpService } from '../auth/otp.service';
import { type AppRequest, type AuthContext, requestContext } from '../auth/request-context';
import {
  type ConsentInput,
  consentSchema,
  emergencyContactSchema,
  type PhotoUploadInput,
  photoUploadSchema,
  type UpdateProfileInput,
  updateProfileSchema,
} from './profile.schemas';
import { PhotoService } from './photo.service';
import { UsersService } from './users.service';

@ApiTags('profil')
@ApiBearerAuth()
@AllowIncompleteProfile()
@Controller('me')
export class MeController {
  constructor(
    private readonly users: UsersService,
    private readonly otp: OtpService,
    private readonly photos: PhotoService,
  ) {}

  @Post('photo/upload-url')
  @ApiOperation({ summary: 'URL de dépôt signée (5 min) pour la photo de profil' })
  photoUploadUrl(@CurrentAuth() auth: AuthContext, @Body(new ZodValidationPipe(photoUploadSchema)) body: PhotoUploadInput) {
    return this.photos.createUpload(auth.userId, body);
  }

  @Post('photo/complete')
  @ApiOperation({ summary: 'Confirme la nouvelle photo après contrôle du fichier reçu' })
  async photoComplete(@CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    await this.photos.complete(auth.userId, requestContext(req));
    return this.users.getMe(auth.userId);
  }

  @Delete('photo')
  async photoDelete(@CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    await this.photos.remove(auth.userId, requestContext(req));
    return this.users.getMe(auth.userId);
  }

  @Get()
  @ApiOperation({ summary: 'Profil complet de la personne connectée' })
  me(@CurrentAuth() auth: AuthContext) {
    return this.users.getMe(auth.userId);
  }

  @Patch()
  update(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfileInput,
    @Req() req: AppRequest,
  ) {
    return this.users.updateProfile(auth.userId, body, requestContext(req));
  }

  @Put('consents')
  @ApiOperation({ summary: 'Enregistre un consentement daté (CGU, confidentialité, position en direct, marketing)' })
  consent(@CurrentAuth() auth: AuthContext, @Body(new ZodValidationPipe(consentSchema)) body: ConsentInput, @Req() req: AppRequest) {
    return this.users.setConsent(auth.userId, body, requestContext(req));
  }

  @Get('emergency-contact')
  async getEmergencyContact(@CurrentAuth() auth: AuthContext) {
    return { data: await this.users.getEmergencyContact(auth.userId) };
  }

  @Put('emergency-contact')
  async setEmergencyContact(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(emergencyContactSchema)) body: z.infer<typeof emergencyContactSchema>,
    @Req() req: AppRequest,
  ) {
    return { data: await this.users.setEmergencyContact(auth.userId, body.name, body.phone, requestContext(req)) };
  }

  @Post('deletion/otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Envoie un code de confirmation de suppression sur le numéro du compte' })
  async deletionOtp(@CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    const phone = await this.users.phoneOf(auth.userId);
    if (!phone) throw new ApiError(HttpStatus.CONFLICT, 'NO_PHONE', 'Aucun numéro vérifié sur ce compte.');
    return this.otp.request({ phone, purpose: 'ACCOUNT_DELETION', userId: auth.userId, ip: req.ip ?? null });
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Supprime (anonymise) le compte après confirmation par code' })
  async deleteAccount(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(deletionSchema)) body: z.infer<typeof deletionSchema>,
    @Req() req: AppRequest,
  ): Promise<void> {
    const verified = await this.otp.verify(body.otpRequestId, body.code, req.ip ?? null);
    if (verified.purpose !== 'ACCOUNT_DELETION' || verified.userId !== auth.userId) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'OTP_INVALID', 'Code incorrect.');
    }
    await this.users.deleteAccount(auth.userId, requestContext(req));
  }
}
