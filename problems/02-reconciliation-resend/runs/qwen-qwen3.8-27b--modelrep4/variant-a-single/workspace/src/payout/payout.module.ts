import { Module } from '@nestjs/common';
import { PayoutController } from './payout.controller.js';
import { PayoutService } from './payout.service.js';
import { PayoutRepository } from './payout.repository.js';
import { PayoutBankClient } from './payout-bank.client.js';
import { BANK_CLIENT } from './bank-client.token.js';

@Module({
  controllers: [PayoutController],
  providers: [
    PayoutService,
    PayoutRepository,
    {
      provide: BANK_CLIENT,
      useClass: PayoutBankClient,
    },
  ],
  exports: [PayoutService],
})
export class PayoutModule {}
