import { Module } from '@nestjs/common';
import { BankModule } from '../bank/bank.module.js';
import { PayoutOrderStore, PayoutRepository } from './payout.repository.js';
import { PayoutService } from './payout.service.js';
import { PayoutProcessor } from './payout.processor.js';

@Module({
  imports: [BankModule],
  providers: [
    PayoutRepository,
    { provide: PayoutOrderStore, useExisting: PayoutRepository },
    PayoutService,
    PayoutProcessor,
  ],
})
export class PayoutModule {}
