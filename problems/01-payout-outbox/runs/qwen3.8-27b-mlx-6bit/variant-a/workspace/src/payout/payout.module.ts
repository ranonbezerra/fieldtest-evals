import { Module } from '@nestjs/common';
import { PayoutController } from './payout.controller.js';
import { PayoutService } from './payout.service.js';
import { PayoutRepository } from './payout.repository.js';

@Module({
  controllers: [PayoutController],
  providers: [PayoutRepository, PayoutService],
  exports: [PayoutService, PayoutRepository],
})
export class PayoutModule {}
