import { Module, Provider } from '@nestjs/common';

import { PayoutController } from './payout.controller.js';
import { PayoutService, TransferProvider } from './payout.service.js';
import { PayoutWorkerService } from './payout-worker.service.js';
import { PayoutRepository } from './payout.repository.js';

// ASSUMPTION: the plan wires the provider via the 'TRANSFER_PROVIDER' DI token
// but does not name a concrete implementation module, so this module supplies
// a placeholder provider; real deployments override it with the SDK client.
const transferProviderProvider: Provider = {
  provide: 'TRANSFER_PROVIDER',
  useValue: {
    transfer(_to: string, _amount: bigint): Promise<{ txHash: string }> {
      return Promise.reject(new Error('TransferProvider is not configured'));
    },
  } as TransferProvider,
};

@Module({
  controllers: [PayoutController],
  providers: [PayoutRepository, PayoutService, PayoutWorkerService, transferProviderProvider],
  exports: [PayoutService],
})
export class PayoutModule {}
