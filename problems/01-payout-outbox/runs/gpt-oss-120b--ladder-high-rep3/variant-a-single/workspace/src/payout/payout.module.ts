import { Module } from '@nestjs/common';
import { PayoutController } from './payout.controller';
import { PayoutService } from './payout.service';
import { PayoutRepository } from './payout.repository';
import { PayoutWorker } from './payout.worker';
import { TransferProvider, DummyTransferProvider } from '../provider/transfer.provider';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [],
  controllers: [PayoutController],
  providers: [
    PrismaService,
    PayoutRepository,
    PayoutService,
    PayoutWorker,
    {
      provide: TransferProvider,
      useClass: DummyTransferProvider,
    },
  ],
  exports: [PayoutService, PayoutWorker],
})
export class PayoutModule {}
