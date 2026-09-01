import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { PaymentRepository } from './payment.repository.js';
import { PaymentService } from './payment.service.js';

// ASSUMPTION: relative ESM imports in this workspace require an explicit '.js'
// suffix (Node 20+, "type": "module"); the TS2307 messages for
// './payment.repository' and './payment.service' are read as missing
// extensions, since both files exist in this same directory.
// ASSUMPTION: I cannot see PaymentRepository's constructor. Its own imports all
// resolve (no TS2307 reported for them), so it does not depend on
// '@prisma/nestjs'; I assume it injects the @prisma/client PrismaClient class
// as a DI token, so a local PrismaClient provider replaces the unresolvable
// '@prisma/nestjs' import. If the repository self-instantiates its client
// instead, this provider is simply unused and harmless.

@Module({
  providers: [
    { provide: PrismaClient, useFactory: () => new PrismaClient() },
    PaymentRepository,
    PaymentService,
  ],
  exports: [PaymentService],
})
export class PaymentModule {}
