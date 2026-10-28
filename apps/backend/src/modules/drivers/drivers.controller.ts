import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentAuth, Public } from '../auth/decorators';
import { type AppRequest, type AuthContext, requestContext } from '../auth/request-context';
import { type DriverUploadInput, driverUploadSchema, type LicenseInput, licenseSchema } from './driver.schemas';
import { DocumentsService } from './documents.service';
import { DriversService } from './drivers.service';

@ApiTags('conducteurs')
@ApiBearerAuth()
@Controller()
export class DriversController {
  constructor(
    private readonly drivers: DriversService,
    private readonly documents: DocumentsService,
  ) {}

  @Post('drivers/me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Crée le profil conducteur ou met à jour le permis (dossier non soumis ou à corriger)' })
  upsert(@CurrentAuth() auth: AuthContext, @Body(new ZodValidationPipe(licenseSchema)) body: LicenseInput, @Req() req: AppRequest) {
    return this.drivers.upsertLicense(auth.userId, body, requestContext(req));
  }

  @Get('drivers/me')
  @ApiOperation({ summary: 'Statut de vérification, pièces déposées, pièces manquantes, motifs de rejet' })
  me(@CurrentAuth() auth: AuthContext) {
    return this.drivers.view(auth.userId);
  }

  @Post('drivers/me/documents/upload-url')
  @ApiOperation({ summary: 'URL de dépôt signée (PUT, 5 min) pour une pièce du conducteur' })
  uploadUrl(@CurrentAuth() auth: AuthContext, @Body(new ZodValidationPipe(driverUploadSchema)) body: DriverUploadInput) {
    return this.drivers.createUpload(auth.userId, body);
  }

  @Post('drivers/me/documents/:id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirme le dépôt : le serveur vérifie taille, type réel et empreinte' })
  complete(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.drivers.completeUpload(auth.userId, id);
  }

  @Post('drivers/me/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soumet le dossier conducteur pour vérification' })
  submit(@CurrentAuth() auth: AuthContext, @Req() req: AppRequest) {
    return this.drivers.submit(auth.userId, requestContext(req));
  }

  @Public()
  @Get('drivers/:id')
  @ApiOperation({ summary: 'Profil public d’un conducteur vérifié' })
  publicProfile(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.drivers.publicProfile(id);
  }

  @Get('documents/:id/download-url')
  @ApiOperation({ summary: 'URL de consultation signée (5 min), réservée à l’auteur du document' })
  download(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.documents.ownerDownloadUrl(auth.userId, id);
  }
}
