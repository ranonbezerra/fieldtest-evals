import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BLOCKCHAIN_PROVIDER, DefaultBlockchainProvider } from './blockchain-provider';
import { PayoutController } from './payout.controller';
import { PAYOUT_CONFIG, WORKER_CONFIG, payoutConfigFromEnv, workerConfigFromEnv } from './payout.config';
import { PayoutRepository } from './payout.repository';
import { PayoutService } from './payout.service';
import { PayoutWorker } from './payout.worker';

@Module({
  imports: [PrismaModule],
  controllers: [PayoutController],
  providers: [
    PayoutRepository,
    { provide: PAYOUT_CONFIG, useFactory: () => payoutConfigFromEnv(process.env) },
    { provide: WORKER_CONFIG, useFactory: () => workerConfigFromEnv(process.env) },
    {
      provide: BLOCKCHAIN_PROVIDER,
      useFactory: () =>
        new DefaultBlockchainProvider({
          endpoint: process.env.PROVIDER_ENDPOINT,
          timeoutMs: Number(process.env.PROVIDER_TIMEOUT_MS ?? 30_000),
        }),
    },
    PayoutService,
    PayoutWorker,
  ],
})
export class PayoutModule {}
