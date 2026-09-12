import { Module } from '@nestjs/common';
import { PayoutController } from './payout.controller.js';
import { PayoutService } from './payout.service.js';
import { PayoutRepository } from './payout.repository.js';
import { PayoutWorker } from './payout.worker.js';
import { ProviderModule } from '../provider/provider.module.js';
import { PrismaService } from '../prisma.service.js';

@Module({
  imports: [ProviderModule],
  controllers: [PayoutController],
  providers: [PayoutService, PayoutRepository, PayoutWorker, PrismaService],
  exports: [PayoutService],
})
export class PayoutModule {}
