# repair2-set

## reasoning

```
Let me analyze the errors:

1. `src/main.ts(3,39): error TS2307: Cannot find module './payout/payout.exception-filter.js'` - The module doesn't exist. I need to create it.
2. `src/main.ts(9,13): error TS2554: Expected 1-3 arguments, but got 0.` - `app.listen()` needs arguments? Actually, `app.listen()` in NestJS takes optional arguments. Wait, let me think... In NestJS, `app.listen()` can be called with 0, 1, or 2 arguments. But the error says "Expected 1-3 arguments". This might be a version-specific issue where `listen()` requires at least a port. Let me check - actually in some versions of NestJS, `listen()` signature is `listen(port: number, callback?: () => void)` or `listen(port: number, hostname: string, callback?: () => void)`. So it needs at least a port. I'll add a port from environment.

Wait, actually looking more carefully at NestJS types: `listen(port?: number, callback?: () => void): Promise<NestApplication>` - no, that's not right either. Let me think about what version they're using. The error says "Expected 1-3 arguments, but got 0" which means the method signature requires at least 1 argument. This is likely `listen(port: number, ...)` where port is required.

I'll use `app.listen(process.env.PORT ? parseInt(process.env.PORT) : 3000)`.

3. `src/payout/payout.module.ts(5,34): error TS2307: Cannot find module './payout.controller.js'` - The controller file doesn't exist. I need to create it.

4. `src/payout/payout.repository.ts(31,7): error TS2322: Type '{ account: { select: { balance: true; }; }; }' is not assignable to type 'never'.` - This is on line 31, which is in `findPayoutByIdempotencyKey`. The `include` clause has `account: { select: { balance: true } }` but the Payout model doesn't have a relation to Account. Looking at the schema, Payout has `accountId String @map("account_id")` but no relation defined to Account. So Prisma doesn't know about the `account` relation.

5. `src/payout/payout.repository.ts(38,7): error TS2322: Type '{ account: { select: { balance: true; }; }; }' is not assignable to type 'never'.` - Same issue in `findPayoutById`.

So the distinct mistakes are:
1. Missing `payout.exception-filter.ts` file
2. `app.listen()` needs a port argument
3. Missing `payout.controller.ts` file
4. `include: { account: ... }` used in repository but no relation defined in Prisma schema (or the include is wrong)

For mistake 4, the Payout model has `accountId` but no `@relation` to Account. The fix should be to remove the `include` since there's no relation defined, or I could add a relation to the schema. But the instructions say "Do not add features" and "Change exactly what the compiler requires." The compiler is complaining about the `include` in the repository. The simplest fix is to remove the `include` clauses from the two methods, since the relation doesn't exist in the schema.

Wait, but looking at the reference schema provided, there's no relation between Payout and Account. The Payout model just has `accountId String`. So the `include: { account: ... }` is invalid. I should remove those includes.

Let me now figure out what files to create/modify:

1. **Create** `src/payout/payout.exception-filter.ts` - A simple exception filter that produces the error envelope format.
2. **Modify** `src/main.ts` - Fix the `app.listen()` call.
3. **Create** `src/payout/payout.controller.ts` - The controller.
4. **Modify** `src/payout/payout.repository.ts` - Remove the invalid `include` clauses.

Let me think about what the controller needs. Looking at the module, it imports `PayoutController` from `./payout.controller.js`. The requirement says `POST /payouts` with body `{ accountId, amount, destinationAddress, idempotencyKey }`.

For the exception filter, it needs to produce the error envelope:
```json
{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }
```

Let me look at what the service likely exports. I don't have the service file content, but I can infer from the repository what it does. The controller should:
- Accept POST /payouts
- Call the service
- Return the result

Let me write these files now.

For `payout.exception-filter.ts`:
```ts
import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class PayoutExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = 500;
    let code = 'internal_error';
    let message = 'An unexpected error occurred';
    let details: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'object' && res !== null) {
        const body = res as Record<string, unknown>;
        if (typeof body.message === 'string') message = body.message;
        if (typeof body.code === 'string') code = body.code;
        if (typeof body.details === 'object' && body.details !== null) {
          details = body.details as Record<string, unknown>;
        }
      } else if (typeof res === 'string') {
        message = res;
      }
    }

    response.status(status).json({ error: { code, message, details } });
  }
}
```

For `payout.controller.ts`:
```ts
import { Body, Controller, Post } from '@nestjs/common';
import { PayoutService } from './payout.service.js';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post()
  create(@Body() body: { accountId: string; amount: string; destinationAddress: string; idempotencyKey: string }) {
    return this.service.createPayout(body);
  }
}
```

Wait, I need to be careful. The amount is in minor units and should be BigInt. But JSON doesn't support BigInt natively. In the body, it would come as a string or number. Let me keep it as string in the body and let the service handle conversion.

Actually, let me think about this more carefully. The controller should validate input and call the service. I'll keep the body types simple and let the service handle the logic.

For `main.ts`, I need to fix the `listen()` call:
```ts
app.listen(process.env.PORT ? parseInt(process.env.PORT, 10) : 3000);
```

For `payout.repository.ts`, I need to remove the `include: { account: { select: { balance: true } } }` from both `findPayoutByIdempotencyKey` and `findPayoutById`.

Let me write the final files.
```

## reply

Looking at the errors as a whole, there are four distinct mistakes:

1. **Missing `payout.exception-filter.ts`** — imported in `main.ts` but never created.
2. **`app.listen()` called with no arguments** — the installed NestJS version requires a port.
3. **Missing `payout.controller.ts`** — imported in `payout.module.ts` but never created.
4. **`include: { account: … }` on `Payout` queries** — the Prisma schema has no `@relation` between `Payout` and `Account`, so the generated type is `never`.

I'll create the two missing files, fix `main.ts`, and remove the invalid `include` clauses from the repository.

### src/payout/payout.exception-filter.ts
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class PayoutExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = 500;
    let code = 'internal_error';
    let message = 'An unexpected error occurred';
    let details: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const body = res as Record<string, unknown>;
        if (typeof body.message === 'string') message = body.message;
        if (typeof body.code === 'string') code = body.code;
        if (typeof body.details === 'object' && body.details !== null) {
          details = body.details as Record<string, unknown>;
        }
      }
    }

    response.status(status).json({ error: { code, message, details } });
  }
}
```

### src/main.ts
```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { PayoutExceptionFilter } from './payout/payout.exception-filter.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new PayoutExceptionFilter());
  app.setGlobalPrefix('api');
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  await app.listen(port);
}

void bootstrap();
```

### src/payout/payout.controller.ts
```ts
import { Body, Controller, Post } from '@nestjs/common';
import { PayoutService } from './payout.service.js';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post()
  create(
    @Body()
    body: {
      accountId: string;
      amount: string;
      destinationAddress: string;
      idempotencyKey: string;
    },
  ) {
    return this.service.createPayout(body);
  }
}
```

### src/payout/payout.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PayoutStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { LedgerEntryDto } from './dto-payout.js';
import { PayoutConfigService } from './payout.config.service.js';

export interface ClaimedMessage {
  id: bigint;
  payoutId: string;
  attemptCount: number;
}

@Injectable()
export class PayoutRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: PayoutConfigService,
  ) {}

  account(accountId: string, initialBalance = 0n) {
    return this.prisma.account.upsert({
      where: { id: accountId },
      update: {},
      create: { id: accountId, accountNumber: accountId, balance: initialBalance },
    });
  }

  async findPayoutByIdempotencyKey(accountId: string, idempotencyKey: string) {
    return this.prisma.payout.findUnique({
      where: { idempotencyKey },
    });
  }

  async findPayoutById(id: string) {
    return this.prisma.payout.findUnique({
      where: { id },
    });
  }

  async listPayouts(limit: number, offset: number) {
    return this.prisma.payout.findMany({
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Creates the payout, debits the available balance, posts the hold ledger
   * batch and enqueues the outbox message — all in one transaction. The debit
   * is a conditional row update, so two racing requests can never both
   * succeed.
   */
  async createWithDebit(
    input: {
      accountId: string;
      amount: bigint;
      destinationAddress: string;
      idempotencyKey: string;
    },
    holdEntries: LedgerEntryDto[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Debit only if funds are available. The row lock serialises racers.
      const debited = await tx.account.updateMany({
        where: { id: input.accountId, balance: { gte: input.amount } },
        data: { balance: { decrement: input.amount } },
      });
      if (debited.count === 0) return { ok: false as const };

      const payout = await tx.payout.create({
        data: {
          accountId: input.accountId,
          amount: input.amount,
          destinationAddress: input.destinationAddress,
          idempotencyKey: input.idempotencyKey,
          status: PayoutStatus.created,
        },
      });

      await tx.ledgerEntry.createMany({
        data: holdEntries.map((e) => ({
          batchId: e.batchId,
          entryType: e.entryType,
          accountId: e.accountId,
          amount: e.amount,
          memo: e.memo ?? null,
        })),
      });

      await tx.outboxMessage.create({
        data: { payoutId: payout.id },
      });

      return { ok: true as const, payout };
    });
  }

  /**
   * Atomically claims the next due pending message (single-winner conditional
   * update) and moves its payout to processing.
   */
  async claimMessage(now: Date): Promise<ClaimedMessage | null> {
    return this.prisma.$transaction(async (tx) => {
      const candidate = await tx.outboxMessage.findFirst({
        where: { status: 'pending', nextAttemptAt: { lte: now } },
        orderBy: { nextAttemptAt: 'asc' },
        select: { id: true },
      });
      if (!candidate) return null;

      const claimed = await tx.outboxMessage.updateMany({
        where: { id: candidate.id, status: 'pending' },
        data: { status: 'processing', attemptCount: { increment: 1 } },
      });
      if (claimed.count === 0) return null;

      const message = await tx.outboxMessage.findUniqueOrThrow({
        where: { id: candidate.id },
      });
      await tx.payout.updateMany({
        where: { id: message.payoutId, status: PayoutStatus.created },
        data: { status: PayoutStatus.processing },
      });
      return { id: message.id, payoutId: message.payoutId, attemptCount: message.attemptCount };
    });
  }

  /**
   * Provider confirmed. Posts the settlement batch and marks the payout sent.
   * The conditional update makes repeated deliveries no-ops.
   */
  async completeSent(
    payoutId: string,
    txHash: string,
    settlementEntries: LedgerEntryDto[],
    sentAt: Date,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.payout.updateMany({
        where: { id: payoutId, status: PayoutStatus.processing },
        data: { status: PayoutStatus.sent, txHash, sentAt },
      });
      if (updated.count === 0) return false;

      await tx.ledgerEntry.createMany({
        data: settlementEntries.map((e) => ({
          batchId: e.batchId,
          entryType: e.entryType,
          accountId: e.accountId,
          amount: e.amount,
          memo: e.memo ?? null,
        })),
      });
      return true;
    });
  }

  /**
   * Definitive provider failure. Posts the reversal batch (funds return to
   * available balance) and marks the payout failed.
   */
  async failFinal(payoutId: string, reversalEntries: LedgerEntryDto[]): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.payout.updateMany({
        where: { id: payoutId, status: PayoutStatus.processing },
        data: { status: PayoutStatus.failed },
      });
      if (updated.count === 0) return false;

      await tx.ledgerEntry.createMany({
        data: reversalEntries.map((e) => ({
          batchId: e.batchId,
          entryType: e.entryType,
          accountId: e.accountId,
          amount: e.amount,
          memo: e.memo ?? null,
        })),
      });
      return true;
    });
  }

  async markRetry(messageId: bigint, nextAttemptAt: Date): Promise<void> {
    await this.prisma.outboxMessage.update({
      where: { id: messageId },
      data: { status: 'pending', nextAttemptAt },
    });
  }

  /**
   * Bounded retries exhausted without a definitive outcome. Funds stay
   * reserved (the hold ledger entry remains) and the payout needs review.
   */
  async exhaust(messageId: bigint, payoutId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.outboxMessage.update({
        where: { id: messageId },
        data: { status: 'dead' },
      });
      await tx.payout.updateMany({
        where: { id: payoutId, status: PayoutStatus.processing },
        data: { status: PayoutStatus.needs_review },
      });
    });
  }

  async markMessageHandled(messageId: bigint): Promise<void> {
    await this.prisma.outboxMessage.update({
      where: { id: messageId },
      data: { status: 'handled' },
    });
  }
}
```
