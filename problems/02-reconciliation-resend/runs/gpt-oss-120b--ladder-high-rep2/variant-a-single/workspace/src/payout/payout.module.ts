import { Module } from '@nestjs/common';
import { PayoutService } from './payout.service.js';
import { PayoutRepository } from './payout.repository.js';
import { PayoutReconcileJob } from './payout.reconcile.job.js';
import { BankModule } from '../bank/bank.module.js';
import { PrismaService } from '../prisma.service.js';

@Module({
  imports: [BankModule],
  providers: [PayoutService, PayoutRepository, PayoutReconcileJob, PrismaService],
  exports: [PayoutService],
})
export class PayoutModule {}
