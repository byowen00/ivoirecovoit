import { Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import { DB, type Db } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { AggregatorPaymentProvider } from './aggregator.provider';
import { PaymentsController, PaymentWebhooksController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PAYMENT_PROVIDER, type PaymentProvider } from './provider';
import { ReconciliationService } from './reconciliation.service';
import { RefundsService } from './refunds.service';
import { SandboxController } from './sandbox.controller';
import { SandboxPaymentProvider } from './sandbox.provider';

@Module({
  imports: [AuthModule],
  controllers: [PaymentsController, PaymentWebhooksController, SandboxController],
  providers: [
    {
      provide: PAYMENT_PROVIDER,
      inject: [DB, ENV],
      // Choix du prestataire par configuration ; la configuration refuse déjà le bac à sable en production
      // et l'agrégateur tant qu'il n'est pas intégré.
      useFactory: (db: Db, env: Env): PaymentProvider =>
        env.PAYMENT_PROVIDER === 'sandbox' ? new SandboxPaymentProvider(db, env.SANDBOX_WEBHOOK_SECRET, env.API_BASE_URL) : new AggregatorPaymentProvider(),
    },
    PaymentsService,
    RefundsService,
    ReconciliationService,
  ],
  exports: [PaymentsService, RefundsService, ReconciliationService, PAYMENT_PROVIDER],
})
export class PaymentsModule {}
