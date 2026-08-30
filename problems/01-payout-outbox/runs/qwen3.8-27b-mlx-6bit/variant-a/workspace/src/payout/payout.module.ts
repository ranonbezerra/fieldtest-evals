import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { PayoutController } from './payout.controller.js';
import { PayoutRepository } from './payout.repository.js';
import { PayoutService } from './payout.service.js';
import { PAYOUT_PROVIDER, PayoutProvider } from './provider.types.js';
import { PayoutWorker } from './worker/payout.worker.js';

// ASSUMPTION: the plan names no concrete provider SDK adapter or its configuration, so
// the module ships a placeholder that throws instead of faking a transfer; tests
// override PAYOUT_PROVIDER with a fake.
const placeholderProvider: PayoutProvider = {
  transfer: async (_to: string, _amount: bigint): Promise<{ txHash: string }> => {
    throw new Error('payout provider is not configured; override PAYOUT_PROVIDER');
  },
};

@Module({
  controllers: [PayoutController],
  providers: [
    PayoutService,
    PayoutRepository,
    PayoutWorker,
    { provide: PAYOUT_PROVIDER, useValue: placeholderProvider },
    // ASSUMPTION: the plan does not state where PrismaClient is provided, so the module
    // provides it here to keep the feature self-contained (the repository injects it).
    { provide: PrismaClient, useFactory: () => new PrismaClient() },
  ],
  exports: [PayoutService],
})
export class PayoutModule {}
