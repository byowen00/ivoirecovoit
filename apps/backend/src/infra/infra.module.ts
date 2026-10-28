import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { RateLimitService } from './rate-limit.service';
import { RedisModule } from './redis.module';

@Global()
@Module({
  imports: [RedisModule],
  providers: [RateLimitService, AuditService],
  exports: [RateLimitService, AuditService],
})
export class InfraModule {}
