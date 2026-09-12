import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { BANK_CLIENT, HttpBankClient, PayoutService, type BankClient } from './payout.service.js';
import { PayoutRepository } from './payout.repository.js';
import { PayoutProcessor } from './payout.processor.js';

@Module({
  imports: [PrismaModule],
  providers: [
    PayoutRepository,
    PayoutService,
    PayoutProcessor,
    {
      provide: BANK_CLIENT,
      useFactory: (): BankClient => {
        const baseUrl = process.env.BANK_BASE_URL;
        const apiKey = process.env.BANK_API_KEY;
        if (!baseUrl || !apiKey) {
          throw new Error('BANK_BASE_URL and BANK_API_KEY must be set');
        }
        return new HttpBankClient(baseUrl, apiKey);
      },
    },
  ],
  exports: [PayoutService, PayoutRepository],
})
export class PayoutModule {}
