import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BookingsModule } from '../bookings/bookings.module';
import { PaymentsModule } from '../payments/payments.module';
import { JobsService } from './jobs.service';

@Module({ imports: [AuthModule, BookingsModule, PaymentsModule], providers: [JobsService], exports: [JobsService] })
export class JobsModule {}
