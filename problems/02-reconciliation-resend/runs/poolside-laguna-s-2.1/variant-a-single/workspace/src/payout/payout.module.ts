import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BankModule } from '../bank/bank.module';
import { PrismaPayoutRepository } from './payout.repository';
import { PayoutService } from './payout.service';
import { PayoutController } from './payout.controller';
import { PAYOUT_CONFIG, PAYOUT_REPOSITORY } from './payout.types';

@Module({
  imports: [PrismaModule, BankModule],
  controllers: [PayoutController],
  providers: [
    PrismaPayoutRepository,
    {
      provide: PAYOUT_REPOSITORY,
      useExisting: PrismaPayoutRepository,
    },
    PayoutService,
    {
      provide: PAYOUT_CONFIG,
      useFactory: () => ({
        publishLagMinutes: parseInt(
          process.env.PUBLISH_LAG_MINUTES || '30',
          10,
        ),
        maxAttempts: parseInt(
          process.env.MAX_PAYOUT_ATTEMPTS || '5',
          10,
        ),
      }),
    },
  ],
  exports: [PayoutService],
})
export class PayoutModule {}
