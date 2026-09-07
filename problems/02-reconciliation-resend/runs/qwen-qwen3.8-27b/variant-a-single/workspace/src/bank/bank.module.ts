import { Module } from '@nestjs/common';
import { BankClient } from './bank.client';

@Module({
  providers: [BankClient],
  exports: [BankClient],
})
export class BankModule {}
