import { Module } from '@nestjs/common';
import { BankModule } from './bank/bank.module.js';

@Module({
  imports: [BankModule],
})
export class AppModule {}
