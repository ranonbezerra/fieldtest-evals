import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PayoutController } from './payout.controller.js';
import { PayoutService } from './payout.service.js';
import { PayoutRepository } from './payout.repository.js';
import { PayoutWorker } from './payout.worker.js';
import { PAYOUT_PROVIDER, StubPayoutProvider } from './payout.provider.js';

@Module({
  imports: [PrismaModule],
  controllers: [PayoutController],
  providers: [
    PayoutService,
    PayoutRepository,
    PayoutWorker,
    { provide: PAYOUT_PROVIDER, useClass: StubPayoutProvider },
  ],
})
export class PayoutModule {}
