import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DisputesService } from './disputes.service';
import { MessagesService } from './messages.service';
import { ReportsService } from './reports.service';
import { ReviewsService } from './reviews.service';
import { SafetyService } from './safety.service';
import { TrustController } from './trust.controller';

@Module({
  imports: [AuthModule],
  controllers: [TrustController],
  providers: [MessagesService, ReviewsService, ReportsService, DisputesService, SafetyService],
  exports: [MessagesService, ReviewsService, ReportsService, DisputesService, SafetyService],
})
export class TrustModule {}
