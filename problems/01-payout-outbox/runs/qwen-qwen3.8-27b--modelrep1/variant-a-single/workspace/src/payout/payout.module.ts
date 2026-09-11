import { Module } from '@nestjs/common';
import { PayoutController } from './payout.controller.js';
import { PayoutService } from './payout.service.js';
import { PayoutRepository } from './payout.repository.js';
import { PayoutWorker } from './payout.worker.js';
import { PAYOUT_PROVIDER, createPayoutProvider } from './blockchain-provider.js';

@Module({
  controllers: [PayoutController],
  providers: [
    PayoutRepository,
    PayoutService,
    PayoutWorker,
    { provide: PAYOUT_PROVIDER, useFactory: createPayoutProvider },
  ],
  exports: [PayoutService],
})
export class PayoutModule {}
