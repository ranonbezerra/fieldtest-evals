// src/app.module.ts
/**
 * Root module of the application.
 *
 * The original scaffold expected three feature modules (`PayoutModule`,
 * `BankModule` and `PrismaModule`). Those modules (and their related files)
 * are not present in the current repository, therefore importing them would
 * cause a “Cannot find module …” TypeScript error.
 *
 * To keep the project compile‑able we expose an empty root module that
 * satisfies Nest’s requirements while deliberately omitting the missing
 * feature modules.
 *
 * // ASSUMPTION: `payout`, `bank` and `prisma` feature modules are not available
 * // in this code base. They are required by the original design, but cannot be
 * // imported here without causing a compilation failure. The rest of the
 * // application (controllers, services, etc.) will need to be added later
 * // alongside their corresponding modules.
 */

import { Module } from '@nestjs/common';

@Module({
  imports: [],          // Feature modules would be listed here once they exist.
  controllers: [],      // Global controllers can be added here.
  providers: [],        // Global providers can be added here.
})
export class AppModule {}
