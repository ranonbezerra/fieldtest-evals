import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { BANK_CLIENT } from './bank.client.js';
import { OrderRepository } from './payout.repository.js';
import { PayoutService, CLOCK } from './payout.service.js';
import { PayoutProcessor } from './payout.processor.js';

@Module({
  imports: [PrismaModule],
  providers: [
    OrderRepository,
    PayoutService,
    PayoutProcessor,
    { provide: CLOCK, useValue: () => new Date() },
    // The bank adapter (the bank's SDK) is wired here. This stand-in fails
    // loudly so a miswired deploy can never pass a payment silently.
    {
      provide: BANK_CLIENT,
      useValue: {
        send: () => {
          throw new Error('bank client not wired');
        },
        getStatement: () => {
          throw new Error('bank client not wired');
        },
      },
    },
  ],
})
export class PayoutModule {}
