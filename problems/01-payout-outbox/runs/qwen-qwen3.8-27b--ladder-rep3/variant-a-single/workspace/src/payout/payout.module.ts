import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PayoutController } from './payout.controller.js';
import { PayoutService } from './payout.service.js';
import { PayoutRepository } from './payout.repository.js';
import { PayoutWorkerService } from './payout-worker.service.js';
import { PAYOUT_PROVIDER, StubPayoutProvider } from './payout-provider.js';

@Module({
  imports: [PrismaModule],
  controllers: [PayoutController],
  providers: [
    PayoutRepository,
    PayoutService,
    PayoutWorkerService,
    // ASSUMPTION: the real provider SDK is not in this repo; the stub keeps the
    // app bootable. Bind the actual SDK client here in production.
    { provide: PAYOUT_PROVIDER, useClass: StubPayoutProvider },
  ],
  exports: [PayoutService],
})
export class PayoutModule {}
