import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { BankModule } from '../bank/bank.module';
import { PayoutsController } from './payouts.controller';
import { PayoutsJob } from './payouts.job';
import { PayoutsRepository } from './payouts.repository';
import { PAYOUTS_CONFIG, PayoutsService } from './payouts.service';
import type { PayoutsConfig } from './payouts.service';

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

@Module({
  imports: [BankModule],
  controllers: [PayoutsController],
  providers: [
    { provide: PrismaClient, useValue: new PrismaClient() },
    PayoutsRepository,
    {
      provide: PAYOUTS_CONFIG,
      useFactory: (): PayoutsConfig => ({
        publishingLagMs: intFromEnv('PAYOUTS_PUBLISHING_LAG_MINUTES', 30) * 60_000,
        sendBatchSize: intFromEnv('PAYOUTS_SEND_BATCH_SIZE', 100),
      }),
    },
    PayoutsService,
    PayoutsJob,
  ],
  exports: [PayoutsService],
})
export class PayoutsModule {}
