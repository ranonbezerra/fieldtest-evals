import { Module } from '@nestjs/common';
import { PayoutController } from './payout.controller.js';
import { PayoutService } from './payout.service.js';
import { PayoutRepository } from './payout.repository.js';
import { PayoutWorkerService } from './payout.worker.js';
import { CryptoProviderService } from '../provider/crypto-provider.js';

@Module({
  controllers: [PayoutController],
  providers: [
    PayoutService,
    PayoutRepository,
    PayoutWorkerService,
    CryptoProviderService,
  ],
  exports: [PayoutService, PayoutRepository],
})
export class PayoutModule {}
