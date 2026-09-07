// src/bank/bank.module.ts

import { Module } from '@nestjs/common';

/**
 * // ASSUMPTION:
 * The original project intended a separate `bank.service.ts` file, but it is not
 * present in the repository. To satisfy the compiler without creating new files,
 * we define a minimal placeholder `BankService` here. The real implementation can
 * replace this stub later.
 */
export class BankService {
  // The real service would contain methods such as `send(...)` and any other
  // bank‑API interactions required by the payout feature.
  // For now the class is intentionally empty to keep the module compile‑ready.
}

@Module({
  providers: [BankService],
  exports: [BankService],
})
export class BankModule {}
