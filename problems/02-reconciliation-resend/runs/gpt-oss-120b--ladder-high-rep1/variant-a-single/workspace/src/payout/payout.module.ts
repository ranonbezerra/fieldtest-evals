import { Module } from '@nestjs/common';
import { PayoutController } from './payout.controller.js';
import { PayoutService } from './payout.service.js';
import { PayoutRepository } from './payout.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BankService } from '../bank/bank.service.js';
import { PayoutReconcileJob } from './payout.reconcile.job.js';

@Module({
  controllers: [PayoutController],
  providers: [
    PayoutService,
    PayoutRepository,
    PrismaService,
    BankService,
    PayoutReconcileJob,
  ],
  exports: [PayoutService],
})
export class PayoutModule {}
