// src/payout/payout.module.ts

import { Module } from '@nestjs/common';
import { PayoutService } from './payout.service';
import { PayoutController } from './payout.controller';
import { PayoutRepository } from './payout.repository';
import { BankModule } from '../bank/bank.module';

@Module({
  imports: [BankModule],
  controllers: [PayoutController],
  providers: [PayoutService, PayoutRepository],
  exports: [PayoutService],
})
export class PayoutModule {}
