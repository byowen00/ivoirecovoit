import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MeController } from './me.controller';
import { PhotoService } from './photo.service';

@Module({ imports: [AuthModule], controllers: [MeController], providers: [PhotoService] })
export class UsersModule {}
