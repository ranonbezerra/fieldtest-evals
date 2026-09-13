import { Module } from '@nestjs/common';
import { PayoutService } from './payout.service';
import { PayoutRepository } from './payout.repository';
import { PayoutController } from './payout.controller';
import { BankModule } from '../bank/bank.module';

@Module({
  imports: [BankModule],
  controllers: [PayoutController],
  providers: [PayoutService, PayoutRepository],
  exports: [PayoutService, PayoutRepository],
})
export class PayoutModule {}
