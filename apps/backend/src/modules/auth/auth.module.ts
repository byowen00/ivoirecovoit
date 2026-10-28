import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ENV, type Env } from '../../config/env';
import { SettingsService } from '../users/settings.service';
import { UsersService } from '../users/users.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { OtpService } from './otp.service';
import { SessionsService } from './sessions.service';
import { SMS_SENDER, TestModeSmsSender, UnavailableSmsSender } from './sms';
import { StaffAuthService } from './staff-auth.service';
import { TokenService } from './token.service';

@Module({
  controllers: [AuthController],
  providers: [
    TokenService,
    SessionsService,
    OtpService,
    StaffAuthService,
    UsersService,
    SettingsService,
    {
      provide: SMS_SENDER,
      inject: [ENV],
      useFactory: (env: Env) => (env.OTP_TEST_MODE ? new TestModeSmsSender() : new UnavailableSmsSender()),
    },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [TokenService, SessionsService, OtpService, StaffAuthService, UsersService, SettingsService],
})
export class AuthModule {}
