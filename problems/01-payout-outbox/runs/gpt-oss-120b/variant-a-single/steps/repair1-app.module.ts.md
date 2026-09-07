# repair1-app.module.ts

## reasoning

```
We need to write app.module importing needed modules. Based on errors, many imports missing. Likely need to create proper paths. We assume other files exist. Just import modules correctly.

app.module.ts should import NestModule, Module, etc, and import PayoutModule, PrismaModule. Provide global.

Write:

import { Module } from '@nestjs/common';
import { PayoutModule } from './payout/payout.module';
import { PrismaModule } from './prisma/prisma.module';
import { ScheduleModule } from '@nestjs/schedule';

export class AppModule {...}

Add ScheduleModule.forRoot().

Assume other modules exist.

Return code.
```

## reply

```ts
// src/app.module.ts
// ---------------------------------------------------------------
// Root module of the application. It wires together the Prisma
// infrastructure, the payout feature module and the NestJS schedule
// module (required for the outbox message processor).
// ---------------------------------------------------------------

import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { PrismaModule } from './prisma/prisma.module';
import { PayoutModule } from './payout/payout.module';

// ASSUMPTION: All feature modules (PayoutModule, PrismaModule) and the
// ScheduleModule are correctly implemented elsewhere in the repository.
// No other imports are required to satisfy the current compiler errors.

@Module({
  imports: [
    // Enable the NestJS scheduler – the message processor uses
    // `@Cron` / `@Interval` decorators.
    ScheduleModule.forRoot(),

    // Database layer
    PrismaModule,

    // Payout domain (controller, service, repository, processor, etc.)
    PayoutModule,
  ],
})
export class AppModule {}
```
