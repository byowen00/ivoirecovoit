import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DriversModule } from '../drivers/drivers.module';
import { PaymentsModule } from '../payments/payments.module';
import { TrustModule } from '../trust/trust.module';
import { AdminController } from './admin.controller';
import { AdminConfigController } from './admin-config.controller';
import { AdminConfigService } from './admin-config.service';
import { AdminFinanceService } from './admin-finance.service';
import { AdminOpsController } from './admin-ops.controller';
import { AdminOpsService } from './admin-ops.service';
import { AdminStaffService } from './admin-staff.service';
import { AdminTrustService } from './admin-trust.service';
import { AdminUsersService } from './admin-users.service';
import { AdminVerificationsService } from './admin-verifications.service';

@Module({
  imports: [AuthModule, DriversModule, PaymentsModule, TrustModule],
  controllers: [AdminController, AdminOpsController, AdminConfigController],
  providers: [AdminUsersService, AdminVerificationsService, AdminOpsService, AdminFinanceService, AdminTrustService, AdminConfigService, AdminStaffService],
})
export class AdminModule {}
