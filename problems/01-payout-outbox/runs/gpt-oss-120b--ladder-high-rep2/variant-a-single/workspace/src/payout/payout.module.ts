import { Module } from '@nestjs/common';
import { PayoutController } from './payout.controller';
import { PayoutService } from './payout.service';
import { PayoutRepository } from './payout.repository';
import { ProviderService } from './provider.service';
import { PayoutWorker } from './payout.worker';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [],
  controllers: [PayoutController],
  providers: [
    PayoutService,
    PayoutRepository,
    ProviderService,
    PayoutWorker,
    PrismaService,
  ],
  exports: [PayoutService],
})
export class PayoutModule {}
