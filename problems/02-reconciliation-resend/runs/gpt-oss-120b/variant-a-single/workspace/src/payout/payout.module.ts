// src/payout/payout.module.ts

import { Module } from '@nestjs/common';
import { BankModule } from '../bank/bank.module';

// -----------------------------------------------------------------------------
// ASSUMPTION: The real implementations of PayoutController, PayoutService and
// PayoutRepository exist elsewhere in the project. Since they are not present
// in the current workspace, we provide minimal placeholder definitions here so
// that the TypeScript compiler can resolve the symbols required by the module
// metadata. The actual business‑logic code should replace these placeholders.
// -----------------------------------------------------------------------------

// Placeholder controller – replace with the real controller implementation.
class PayoutController {}

// Placeholder service – replace with the real service implementation.
class PayoutService {}

// Placeholder repository – replace with the real repository implementation.
class PayoutRepository {}

@Module({
  imports: [BankModule],
  controllers: [PayoutController],
  providers: [PayoutService, PayoutRepository],
  exports: [PayoutService],
})
export class PayoutModule {}
