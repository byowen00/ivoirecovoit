import { Logger, Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { AuthModule } from '../auth/auth.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { DisabledPushChannel, FcmPushChannel, PUSH_CHANNEL, type PushChannel } from './push';

@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [
    {
      provide: PUSH_CHANNEL,
      inject: [ENV],
      useFactory: (env: Env): PushChannel => {
        if (env.PUSH_PROVIDER === 'fcm' && env.FCM_PROJECT_ID && env.FCM_SERVICE_ACCOUNT_B64) {
          return new FcmPushChannel(env.FCM_PROJECT_ID, env.FCM_SERVICE_ACCOUNT_B64);
        }
        new Logger('Notifications').log('Notifications sur le téléphone désactivées (PUSH_PROVIDER=none) : notifications dans l’application seulement.');
        return new DisabledPushChannel();
      },
    },
    NotificationsService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
