import { Module } from '@nestjs/common';
import { PayoutController } from './payout.controller.js';
import { PayoutRepository } from './payout.repository.js';
import { PayoutService } from './payout.service.js';
import { PAYOUT_WORKER_OPTIONS, PayoutWorker, payoutWorkerOptionsFromEnv } from './payout.worker.js';
import { InMemoryTransferProvider, TRANSFER_PROVIDER } from './transfer.provider.js';

@Module({
  controllers: [PayoutController],
  providers: [
    PayoutService,
    PayoutRepository,
    PayoutWorker,
    { provide: TRANSFER_PROVIDER, useClass: InMemoryTransferProvider },
    { provide: PAYOUT_WORKER_OPTIONS, useFactory: payoutWorkerOptionsFromEnv },
  ],
})
export class PayoutModule {}
