import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminController } from './admin.controller';
import { AdminUsersService } from './admin-users.service';

@Module({ imports: [AuthModule], controllers: [AdminController], providers: [AdminUsersService] })
export class AdminModule {}
