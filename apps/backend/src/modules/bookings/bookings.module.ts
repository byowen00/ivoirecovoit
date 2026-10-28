import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { JobsService } from './jobs.service';
import { BookingsMaintenanceService } from './maintenance.service';

@Module({
  imports: [AuthModule],
  controllers: [BookingsController],
  providers: [BookingsService, BookingsMaintenanceService, JobsService],
  exports: [BookingsService, BookingsMaintenanceService],
})
export class BookingsModule {}
