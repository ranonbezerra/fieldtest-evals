import { Module } from '@nestjs/common';
import { PayoutController } from './payout.controller.js';
import { PayoutService } from './payout.service.js';
import { PayoutRepository } from './payout.repository.js';
import { BankService } from '../bank/bank.service.js';

@Module({
  controllers: [PayoutController],
  providers: [PayoutService, PayoutRepository, BankService],
  exports: [PayoutService],
})
export class PayoutModule {}
