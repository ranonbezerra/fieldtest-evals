import { Module } from '@nestjs/common';
import { BankService } from './bank.service.js';

// ASSUMPTION: src/bank/bank.service.ts is expected to exist per the plan's layering
// (service holds logic, zero raw SQL, zero Prisma client calls). The TS2307 error
// indicates it has not yet been created; this module is written to consume it.
@Module({
  providers: [BankService],
  exports: [BankService],
})
export class BankModule {}
