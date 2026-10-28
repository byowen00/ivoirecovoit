import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DriversModule } from '../drivers/drivers.module';
import { AdminController } from './admin.controller';
import { AdminUsersService } from './admin-users.service';
import { AdminVerificationsService } from './admin-verifications.service';

@Module({
  imports: [AuthModule, DriversModule],
  controllers: [AdminController],
  providers: [AdminUsersService, AdminVerificationsService],
})
export class AdminModule {}
