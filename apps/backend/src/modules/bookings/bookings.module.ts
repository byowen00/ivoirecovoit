import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PaymentsModule } from '../payments/payments.module';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { BookingsMaintenanceService } from './maintenance.service';

@Module({
  imports: [AuthModule, PaymentsModule],
  controllers: [BookingsController],
  providers: [BookingsService, BookingsMaintenanceService],
  exports: [BookingsService, BookingsMaintenanceService],
})
export class BookingsModule {}
