import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { BankClient, BankHttpClient, BANK_CLIENT } from './bank.client.js';
import { PayoutConfig, PAYOUT_CONFIG, loadPayoutConfig } from './payout.config.js';
import { PayoutController } from './payout.controller.js';
import { PayoutRepository } from './payout.repository.js';
import { PayoutScheduler } from './payout.scheduler.js';
import { PayoutService } from './payout.service.js';

@Module({
  controllers: [PayoutController],
  providers: [
    { provide: PAYOUT_CONFIG, useFactory: loadPayoutConfig },
    {
      provide: BANK_CLIENT,
      useFactory: (config: PayoutConfig): BankClient =>
        new BankHttpClient(config.bankApiBaseUrl, config.bankApiToken, config.bankRequestTimeoutMs),
      inject: [PAYOUT_CONFIG],
    },
    PrismaService,
    PayoutRepository,
    PayoutService,
    PayoutScheduler,
  ],
})
export class PayoutModule {}
