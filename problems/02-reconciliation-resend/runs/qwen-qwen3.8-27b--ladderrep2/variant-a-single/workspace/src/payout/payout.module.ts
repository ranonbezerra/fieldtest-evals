import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module.js';
import { BANK_GATEWAY, BankGateway } from './bank-gateway.js';
import { HttpBankGateway } from './http-bank-gateway.js';
import { CLOCK, Clock, PAYOUT_CONFIG, PayoutConfig, createPayoutConfig, positiveIntEnv } from './payout.constants.js';
import { PAYOUT_REPOSITORY, PayoutRepository } from './payout.repository.js';
import { PayoutReconcileJob } from './payout.reconcile-job.js';
import { PayoutService } from './payout.service.js';

const systemClock: Clock = { now: () => new Date() };

@Module({
  imports: [PrismaModule],
  providers: [
    { provide: PAYOUT_REPOSITORY, useClass: PayoutRepository },
    PayoutService,
    PayoutReconcileJob,
    { provide: CLOCK, useValue: systemClock },
    { provide: PAYOUT_CONFIG, useFactory: (): PayoutConfig => createPayoutConfig() },
    {
      provide: BANK_GATEWAY,
      useFactory: (): BankGateway =>
        new HttpBankGateway({
          baseUrl: process.env.BANK_BASE_URL ?? '',
          sendTimeoutMs: positiveIntEnv(process.env, 'BANK_SEND_TIMEOUT_MS', 10_000),
        }),
    },
  ],
  exports: [PayoutService],
})
export class PayoutModule {}
