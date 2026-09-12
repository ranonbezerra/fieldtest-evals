import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PayoutController } from './payout.controller';
import { PRISMA_CLIENT, PayoutRepository } from './payout.repository';
import { PayoutService } from './payout.service';
import { PayoutWorker } from './payout.worker';
import { PAYOUT_PROVIDER, UnconfiguredPayoutProvider } from './payout.provider';

@Module({
  controllers: [PayoutController],
  providers: [
    { provide: PRISMA_CLIENT, useFactory: () => new PrismaClient() },
    PayoutRepository,
    // ASSUMPTION: the real blockchain provider SDK is not part of this repo;
    // this fails-closed default never fabricates a success. Replace the
    // binding with an adapter around the real SDK at deployment time.
    { provide: PAYOUT_PROVIDER, useValue: new UnconfiguredPayoutProvider() },
    PayoutService,
    PayoutWorker,
  ],
})
export class PayoutModule {}
