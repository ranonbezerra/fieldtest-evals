import { Module } from '@nestjs/common';
import { BankService } from './bank.service.js';

@Module({
  providers: [BankService],
  exports: [BankService],
})
export class BankModule {}
