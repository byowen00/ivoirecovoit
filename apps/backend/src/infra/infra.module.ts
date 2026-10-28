import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { IdempotencyService } from './idempotency.service';
import { RateLimitService } from './rate-limit.service';
import { RedisModule } from './redis.module';
import { StorageService } from './storage.service';

@Global()
@Module({
  imports: [RedisModule],
  providers: [RateLimitService, AuditService, StorageService, IdempotencyService],
  exports: [RateLimitService, AuditService, StorageService, IdempotencyService],
})
export class InfraModule {}
