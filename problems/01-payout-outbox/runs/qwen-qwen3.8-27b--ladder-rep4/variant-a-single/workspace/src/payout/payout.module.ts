import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PayoutController } from './payout.controller.js';
import { PayoutProvider, PayoutProviderToken } from './payout.provider.js';
import { PayoutRepository } from './payout.repository.js';
import { PayoutService } from './payout.service.js';
import { PayoutWorkerService } from './payout.worker.js';

/**
 * ASSUMPTION: the provider SDK is not part of this exercise, so the token is
 * satisfied by a thin adapter that wraps the documented
 * `provider.transfer({to, amount}) -> {txHash}` signature.
 */
function createPayoutProvider(): PayoutProvider {
  const sdk = {
    transfer: async ({
      to,
      amount,
    }: {
      to: string;
      amount: bigint;
    }): Promise<{ txHash: string }> => {
      // The real SDK call belongs here. Its contract: may throw, time out,
      // or succeed slowly.
      void to;
      void amount;
      throw new Error('Payout provider SDK is not configured');
    },
  };
  return {
    transfer: async (args: { to: string; amount: bigint }) => {
      try {
        const { txHash } = await sdk.transfer(args);
        return { txHash };
      } catch (e) {
        // Map SDK errors into the outcome contract. A thrown error with no
        // outcome means "we do not know", which the service parks safely.
        const err = e as {
          txHash?: string;
          definitive?: boolean;
          message?: string;
        };
        if (typeof err.txHash === 'string') {
          return { txHash: err.txHash, message: err.message };
        }
        return {
          definitive: err.definitive === true,
          message: err.message ?? String(e),
        };
      }
    },
  };
}

@Module({
  imports: [],
  controllers: [PayoutController],
  providers: [
    {
      provide: PrismaClient,
      useValue: new PrismaClient(),
    },
    {
      provide: PayoutProviderToken,
      useFactory: createPayoutProvider,
    },
    PayoutRepository,
    PayoutService,
    PayoutWorkerService,
  ],
  exports: [PayoutService, PayoutRepository],
})
export class PayoutModule {}
