import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PayoutController } from './payout.controller.js';
import { PayoutRepository } from './payout.repository.js';
import { PayoutService } from './payout.service.js';
import { PayoutWorker } from './payout.worker.js';
import { PAYOUT_PROVIDER, type PayoutProvider } from './payout-provider.js';

/**
 * ASSUMPTION: the real blockchain provider SDK is external to this repo.
 * This stand-in satisfies the PayoutProvider contract so the app boots and is
 * wired; replace `useValue` with a factory returning the real SDK client.
 */
const providerStandIn: PayoutProvider = {
  async transfer(): Promise<{ txHash: string }> {
    throw new Error('PAYOUT_PROVIDER stand-in: wire the real provider SDK in payout.module.ts');
  },
  async confirmSettlement(): Promise<{ settled: boolean }> {
    throw new Error('PAYOUT_PROVIDER stand-in: wire the real provider SDK in payout.module.ts');
  },
};

@Module({
  imports: [PrismaModule],
  controllers: [PayoutController],
  providers: [
    PayoutService,
    PayoutRepository,
    PayoutWorker,
    { provide: PAYOUT_PROVIDER, useValue: providerStandIn },
  ],
})
export class PayoutModule {}
