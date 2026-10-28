import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentAuth } from '../auth/decorators';
import type { AuthContext } from '../auth/request-context';
import {
  type DeviceInput,
  deviceSchema,
  type ListNotificationsQuery,
  listNotificationsQuery,
  type MarkReadInput,
  markReadSchema,
  type NotificationPreferencesInput,
  preferencesSchema,
  removeDeviceSchema,
} from './notifications.schemas';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('notifications')
  @ApiOperation({ summary: 'Écran 13 : mes notifications, les plus récentes d’abord' })
  list(@CurrentAuth() auth: AuthContext, @Query(new ZodValidationPipe(listNotificationsQuery)) q: ListNotificationsQuery) {
    return this.notifications.list(auth.userId, q);
  }

  @Get('notifications/unread-count')
  async unread(@CurrentAuth() auth: AuthContext) {
    return { unreadCount: await this.notifications.unreadCount(auth.userId) };
  }

  @Post('notifications/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Marque comme lues : { ids } ou { all: true }' })
  read(@CurrentAuth() auth: AuthContext, @Body(new ZodValidationPipe(markReadSchema)) body: MarkReadInput) {
    return this.notifications.markRead(auth.userId, body);
  }

  @Post('me/devices')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Enregistre le jeton de notification de l’appareil' })
  async register(@CurrentAuth() auth: AuthContext, @Body(new ZodValidationPipe(deviceSchema)) body: DeviceInput): Promise<void> {
    await this.notifications.registerDevice(auth.userId, body.platform, body.token);
  }

  @Delete('me/devices')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentAuth() auth: AuthContext, @Body(new ZodValidationPipe(removeDeviceSchema)) body: z.infer<typeof removeDeviceSchema>): Promise<void> {
    await this.notifications.removeDevice(auth.userId, body.token);
  }

  @Get('me/notification-preferences')
  preferences(@CurrentAuth() auth: AuthContext) {
    return this.notifications.preferences(auth.userId);
  }

  @Put('me/notification-preferences')
  @ApiOperation({ summary: 'Coupe ou réactive une catégorie facultative (les notifications transactionnelles restent obligatoires)' })
  setPreferences(@CurrentAuth() auth: AuthContext, @Body(new ZodValidationPipe(preferencesSchema)) body: NotificationPreferencesInput) {
    return this.notifications.setPreferences(auth.userId, body);
  }
}
