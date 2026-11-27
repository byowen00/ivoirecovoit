import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AppearanceController } from './appearance.controller';
import { MeController } from './me.controller';
import { PhotoService } from './photo.service';

@Module({ imports: [AuthModule], controllers: [MeController, AppearanceController], providers: [PhotoService] })
export class UsersModule {}
