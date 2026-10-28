import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { IdempotencyService, requireIdempotencyKey } from '../../infra/idempotency.service';
import { CurrentAuth } from '../auth/decorators';
import { type AppRequest, type AuthContext, requestContext } from '../auth/request-context';
import {
  type CreateVehicleInput,
  createVehicleSchema,
  type UpdateVehicleInput,
  updateVehicleSchema,
  type VehicleUploadInput,
  vehicleUploadSchema,
} from './driver.schemas';
import { VehiclesService } from './vehicles.service';

@ApiTags('véhicules')
@ApiBearerAuth()
@Controller('vehicles')
export class VehiclesController {
  constructor(
    private readonly vehicles: VehiclesService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext) {
    return this.vehicles.list(auth.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Ajoute un véhicule (en-tête Idempotency-Key obligatoire)' })
  async create(
    @CurrentAuth() auth: AuthContext,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(createVehicleSchema)) body: CreateVehicleInput,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.idempotency.run(auth.userId, requireIdempotencyKey(key), 'POST /vehicles', body, 201, () =>
      this.vehicles.create(auth.userId, body, requestContext(req)),
    );
    res.status(result.status);
    return result.body;
  }

  @Get(':id')
  get(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.vehicles.view(auth.userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Modifie un véhicule (immatriculation ou places : nouvel examen)' })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateVehicleSchema)) body: UpdateVehicleInput,
    @Req() req: AppRequest,
  ) {
    return this.vehicles.update(auth.userId, id, body, requestContext(req));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Req() req: AppRequest) {
    await this.vehicles.remove(auth.userId, id, requestContext(req));
  }

  @Post(':id/documents/upload-url')
  uploadUrl(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(vehicleUploadSchema)) body: VehicleUploadInput,
  ) {
    return this.vehicles.createUpload(auth.userId, id, body);
  }

  @Post(':id/documents/:documentId/complete')
  @HttpCode(HttpStatus.OK)
  complete(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
  ) {
    return this.vehicles.completeUpload(auth.userId, id, documentId);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soumet le véhicule et ses pièces pour vérification' })
  submit(@CurrentAuth() auth: AuthContext, @Param('id', new ParseUUIDPipe()) id: string, @Req() req: AppRequest) {
    return this.vehicles.submit(auth.userId, id, requestContext(req));
  }
}
