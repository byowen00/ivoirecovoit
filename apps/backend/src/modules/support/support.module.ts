import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminSupportController, SupportController } from './support.controller';
import { SupportService } from './support.service';

@Module({ imports: [AuthModule], controllers: [SupportController, AdminSupportController], providers: [SupportService] })
export class SupportModule {}
