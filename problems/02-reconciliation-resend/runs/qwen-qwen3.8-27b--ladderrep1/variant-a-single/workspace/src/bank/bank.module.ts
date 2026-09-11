import { Module } from '@nestjs/common';
import { BankClient } from './bank-client.js';
import { BankHttpClient } from './bank-http-client.js';

@Module({
  providers: [BankHttpClient, { provide: BankClient, useExisting: BankHttpClient }],
  exports: [BankClient],
})
export class BankModule {}
