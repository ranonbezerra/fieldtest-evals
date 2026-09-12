import { Module } from '@nestjs/common';
import { PayoutController } from './payout.controller.js';
import { PayoutService } from './payout.service.js';
import { PayoutRepository } from './payout.repository.js';
import { ProviderService } from '../provider/provider.service.js';
import { PayoutProcessor } from './payout.processor.js';
import { PrismaService } from '../prisma.service.js';

@Module({
  controllers: [PayoutController],
  providers: [
    PayoutService,
    PayoutRepository,
    ProviderService,
    PayoutProcessor,
    PrismaService,
  ],
  exports: [PayoutService],
})
export class PayoutModule {}
