import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BookingsModule } from '../bookings/bookings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { TrustModule } from '../trust/trust.module';
import { JobsService } from './jobs.service';

@Module({ imports: [AuthModule, BookingsModule, PaymentsModule, NotificationsModule, TrustModule], providers: [JobsService], exports: [JobsService] })
export class JobsModule {}
