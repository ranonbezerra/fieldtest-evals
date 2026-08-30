import { Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PayoutController } from './payout.controller';
import { PayoutService } from './payout.service';
import { PayoutRepository } from './payout.repository';
import { PayoutWorker } from './payout.worker';
import { PayoutProvider } from './payout.provider';

@Module({
  controllers: [PayoutController],
  providers: [
    // ASSUMPTION: the plan names no Prisma provider, so the module instantiates PrismaClient itself to satisfy PayoutRepository's constructor.
    { provide: PrismaClient, useFactory: () => new PrismaClient() },
    PayoutRepository,
    PayoutService,
    // ASSUMPTION: the plan names no concrete blockchain SDK class; the token is backed by a stub that throws on use so a misconfigured deployment can never move funds silently (the worker parks such payouts in NEEDS_REVIEW). A real client would be constructed here from environment configuration.
    {
      provide: PayoutProvider,
      useFactory: (): PayoutProvider => ({
        transfer: () => {
          throw new Error('PayoutProvider is not configured');
        },
      }),
    },
    PayoutWorker,
  ],
})
export class PayoutModule implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly worker: PayoutWorker) {}

  onModuleInit(): void {
    const intervalMs = Number(process.env.PAYOUT_WORKER_INTERVAL_MS ?? 1000);
    this.worker.start(intervalMs);
  }

  onModuleDestroy(): void {
    this.worker.stop();
  }
}
