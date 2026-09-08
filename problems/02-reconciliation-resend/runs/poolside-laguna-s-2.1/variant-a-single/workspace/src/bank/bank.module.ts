import { Module } from '@nestjs/common';
import { BANK_CLIENT } from './bank.types';
import { BankService } from './bank.service';

@Module({
  providers: [
    BankService,
    { provide: BANK_CLIENT, useExisting: BankService },
  ],
  exports: [
    BankService,
    { provide: BANK_CLIENT, useExisting: BankService },
  ],
})
export class BankModule {}
