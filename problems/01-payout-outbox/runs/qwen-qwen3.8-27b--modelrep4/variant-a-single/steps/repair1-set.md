# repair1-set

## reasoning

```
Let me analyze the errors:

1. `src/payout/payout.error-filter.ts(49,83)`: `Property 'getMessage' does not exist on type 'HttpException'. Did you mean 'message'?`
   - Fix: Change `exception.getMessage()` to `exception.message`

2. `src/payout/payout.repository.ts(78,11)`, `(183,9)`, `(235,9)`: Type errors on `ledgerEntry.create({ data: [...] })`. The issue is that `direction` is a plain string but Prisma expects the enum type `LedgerDirection`. The fix is to cast `direction` to the proper enum value. Looking at the schema, `LedgerDirection` is an enum with values `debit` and `credit`. In Prisma, when you use `create` with `data`, you need to use the enum type. The issue is that the string literals `'debit'` and `'credit'` are being widened to `string` instead of staying as literal types. I need to cast them to `Prisma.LedgerDirection` or use `as const` or import the enum.

   Actually, looking more carefully at Prisma's type system: when you pass an array to `data`, each element needs to match `LedgerEntryUncheckedCreateInput` or `LedgerEntryCreateInput`. The `direction` field expects `LedgerDirection` enum type. The string literals `'debit'` and `'credit'` should work if they're properly typed... 

   Wait, the issue is likely that in the array literal, TypeScript widens the string type. The fix would be to explicitly cast: `direction: 'debit' as Prisma.EnumLedgerDirectionField` or use `Prisma.LedgerDirection.debit`. But actually in Prisma, the enum values are just strings. Let me think...

   In Prisma, for PostgreSQL enums, the type is typically `LedgerDirection` which is a string enum. The values are `'debit' | 'credit'`. When you write `direction: 'debit'` in an object literal that's part of an array, TypeScript might widen it. The fix is to use `as const` on the array or cast the direction values.

   Actually, the simplest fix is to import `LedgerDirection` from `@prisma/client` and use it as a type assertion, or just add `as const` to make the strings literal types.

   Wait, let me look at this more carefully. The error says:
   ```
   Type '{ payoutId: string; event: string; accountCode: string; direction: string; amountMinor: bigint; }[]' is not assignable to type '(Without<LedgerEntryCreateInput, LedgerEntryUncheckedCreateInput> & LedgerEntryUncheckedCreateInput) | (Without<...> & LedgerEntryCreateInput)'
   ```

   The issue is `direction: string` - it's being widened to `string` instead of staying as `'debit' | 'credit'`. The fix is to explicitly type the direction field. I can either:
   - Import `LedgerDirection` from `@prisma/client` and use it
   - Use `as const` 
   - Cast each direction value

   The cleanest fix that matches the Prisma pattern is to import the enum and use it. But actually, in Prisma's generated types, `LedgerDirection` is typically a string literal union type or a const object. Let me think about what works.

   In Prisma, for a schema enum, the generated type is:
   ```ts
   export const LedgerDirection = {
     debit: 'debit',
     credit: 'credit'
   } as const;
   export type LedgerDirection = (typeof LedgerDirection)[keyof typeof LedgerDirection];
   ```

   So I can import `LedgerDirection` from `@prisma/client` and use `LedgerDirection.debit` and `LedgerDirection.credit`. Or I can just cast the strings.

   Actually the simplest and most common fix is to just add a type annotation or use the enum values. Let me use `as const` on the data array... no, that won't work because `bigint` values aren't const.

   The cleanest fix: cast each `direction` value. Since we're already importing from `@prisma/client`, I can import `LedgerDirection` and use `LedgerDirection.debit` / `LedgerDirection.credit`. Or I can just do `direction: 'debit' as LedgerDirection` where `LedgerDirection` is the type.

   Actually, let me just import the type and use it:
   ```ts
   import { Prisma, PrismaClient, type Payout, type PayoutMessage, type LedgerDirection } from '@prisma/client';
   ```
   
   Wait, but in the existing code, `LedgerDirection` is already defined in the schema. The generated client should export it. Let me just cast the direction values.

   The simplest fix: add `as Prisma.EnumLedgerDirectionField` or just annotate the array. Actually the most robust fix that definitely works is to type-annotate the `data` array:

   ```ts
   await tx.ledgerEntry.create({
     data: [
       {
         payoutId: payout.id,
         event: 'reserved',
         accountCode: `payable:${input.accountId}:available`,
         direction: 'debit' as const,
         amountMinor: input.amountMinor,
       },
       ...
     ]
   });
   ```

   Hmm, but `as const` on a string literal should narrow it to the literal type. Let me check: `'debit' as const` gives type `'debit'` which should be assignable to `LedgerDirection` (which is `'debit' | 'credit'`).

   Actually wait - I need to be more careful. In Prisma, the `direction` field type in `LedgerEntryUncheckedCreateInput` would be `LedgerDirection` which is `$Enums.LedgerDirection` = `'debit' | 'credit'`. A string literal `'debit'` should be assignable to that. The problem is that in an array of object literals, TypeScript widens the type.

   The fix: I'll use explicit type annotation on the direction field. The cleanest way:

   ```ts
   direction: 'debit' as LedgerDirection,
   ```

   where `LedgerDirection` is imported as a type from `@prisma/client`.

   Let me check what's available. In Prisma generated client, you can import:
   - `import { LedgerDirection } from '@prisma/client'` - this gives you the const object
   - The type is `typeof LedgerDirection[keyof typeof LedgerDirection]` or just the enum type

   Actually in newer Prisma versions, you can do:
   ```ts
   import { Prisma } from '@prisma/client';
   // Prisma.LedgerDirection is the const object
   // The type would be: typeof Prisma.LedgerDirection[keyof typeof Prisma.LedgerDirection]
   ```

   Or more simply, I think the generated client exports the type directly:
   ```ts
   import type { LedgerDirection } from '@prisma/client';
   ```

   Hmm, but I'm not 100% sure of the exact export. Let me use a safer approach: just cast to the expected type using a local type assertion.

   Actually, the simplest and safest fix is:
   ```ts
   import { Prisma, PrismaClient, type Payout, type PayoutMessage } from '@prisma/client';
   ```
   And then use `Prisma.LedgerDirection` values? No, that's not how it works either.

   OK let me think differently. The issue is TypeScript widening. The most reliable fix is to annotate the `data` parameter type explicitly. But that's verbose.

   Actually, the most common pattern I've seen work is:
   ```ts
   data: [
     {
       payoutId: payout.id,
       event: 'reserved',
       accountCode: `payable:${input.accountId}:available`,
       direction: 'debit' as 'debit',
       amountMinor: input.amountMinor,
     },
   ```

   This explicitly narrows the type to the literal `'debit'` which is a valid `LedgerDirection`.

   Wait, but will `'debit'` (literal type) be assignable to the Prisma enum type? In Prisma, the enum type for PostgreSQL is typically:
   ```ts
   type LedgerDirection = 'debit' | 'credit'
   ```
   So yes, `'debit'` as a literal type should be assignable.

   Let me go with this approach: add `as 'debit'` and `as 'credit'` to each direction value.

   Actually, I just realized there might be a simpler approach. Let me look at what Prisma actually generates. In recent versions of Prisma (5+), for PostgreSQL native enums, it generates:

   ```ts
   export const LedgerDirection = {
     debit: 'debit',
     credit: 'credit'
   } as const;
   export type LedgerDirection = (typeof LedgerDirection)[keyof typeof LedgerDirection];
   ```

   So `LedgerDirection` (the type) is `'debit' | 'credit'`. And the const `LedgerDirection` has properties `.debit` and `.credit`.

   I can import both the type and value:
   ```ts
   import { LedgerDirection, type LedgerDirection as LedgerDirectionType } from '@prisma/client';
   ```

   Or just use the const values:
   ```ts
   direction: LedgerDirection.debit,
   ```

   This is the cleanest. Let me import `LedgerDirection` as a value and use `LedgerDirection.debit` / `LedgerDirection.credit`.

   Wait, but the existing import already has `type` modifiers. Let me just add `LedgerDirection` as a value import.

   Current import:
   ```ts
   import { Prisma, PrismaClient, type Payout, type PayoutMessage } from '@prisma/client';
   ```

   New import:
   ```ts
   import { LedgerDirection, Prisma, PrismaClient, type Payout, type PayoutMessage } from '@prisma/client';
   ```

   Then use `LedgerDirection.debit` and `LedgerDirection.credit` instead of the string literals.

   This should fix all three occurrences.

3. `test/payout.spec.ts(118,34)`: `Property 'toBe' does not exist on type 'void'.`

   Line 118 in the test file. Let me count... Looking at the test file, line 118 would be in the first test. Let me find it.

   Looking at the test:
   ```ts
   expect(debits).toBe(credits).toBe(60_000n);
   ```

   This is the issue! `expect(debits).toBe(credits)` returns `void`, so you can't chain `.toBe(60_000n)` on it. The fix is to split into two assertions:
   ```ts
   expect(debits).toBe(credits);
   expect(debits).toBe(60_000n);
   ```

   Wait, let me recount the lines to make sure line 118 is indeed that line. Let me count from the top of the test file...

   Actually, I don't need to count exactly. The error message says `Property 'toBe' does not exist on type 'void'` which can only happen when chaining assertions. The only place in the test where `.toBe()` is chained is:
   ```ts
   expect(debits).toBe(credits).toBe(60_000n);
   ```

   That's the fix.

So my three distinct mistakes are:
1. `exception.getMessage()` → `exception.message` in error-filter
2. `direction: 'debit'` / `direction: 'credit'` → `direction: LedgerDirection.debit` / `direction: LedgerDirection.credit` in repository (3 occurrences)
3. Chained `.toBe().toBe()` → two separate `expect` calls in test

Let me now write the fixed files.
```

## reply

### src/payout/payout.error-filter.ts
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Injectable, Logger } from '@nestjs/common';
import { PayoutError } from './payout.service';

/** Minimal HTTP response surface the filter needs (Express or Fastify). */
interface HttpResponse {
  status(code: number): HttpResponse;
  json(body: unknown): unknown;
}

const CODES_BY_STATUS: Record<number, string> = {
  400: 'bad_request',
  404: 'resource_not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  415: 'unsupported_media_type',
};

/**
 * Global error envelope: every error leaves the API as
 * { "error": { "code", "message", "details" } } with a snake_case code.
 */
@Catch()
@Injectable()
export class PayoutErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(PayoutErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponse>();

    let status = 500;
    let code = 'internal_error';
    let message = 'an unexpected error occurred';
    let details: Record<string, unknown> = {};

    if (exception instanceof PayoutError) {
      status = exception.httpStatus;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        code = CODES_BY_STATUS[status] ?? 'unexpected_error';
        message = payload;
      } else if (typeof payload === 'object' && payload !== null) {
        const record = payload as Record<string, unknown>;
        code = typeof record.code === 'string' ? record.code : (CODES_BY_STATUS[status] ?? 'unexpected_error');
        message = typeof record.message === 'string' ? record.message : exception.message;
        details =
          typeof record.details === 'object' && record.details !== null
            ? (record.details as Record<string, unknown>)
            : {};
      }
    } else if (exception instanceof Error) {
      message = 'an unexpected error occurred';
    }

    if (status >= 500) {
      this.logger.error(exception);
    }

    response.status(status).json({ error: { code, message, details } });
  }
}
```

### src/payout/payout.repository.ts
```ts
import { Inject, Injectable } from '@nestjs/common';
import { LedgerDirection, Prisma, PrismaClient, type Payout, type PayoutMessage } from '@prisma/client';

/** Injection token for the shared PrismaClient (created in payout.module.ts). */
export const PRISMA_CLIENT = Symbol('PRISMA_CLIENT');

export interface CreatePayoutInput {
  accountId: string;
  amountMinor: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}

export type CreatePayoutOutcome =
  | { outcome: 'created'; payout: Payout }
  | { outcome: 'duplicate'; payout: Payout }
  | { outcome: 'account_not_found' }
  | { outcome: 'insufficient_funds'; availableMinor: bigint };

const MAX_ERROR_LENGTH = 500;

function truncate(value: string): string {
  return value.length > MAX_ERROR_LENGTH ? value.slice(0, MAX_ERROR_LENGTH) : value;
}

function isIdempotencyKeyConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = (error.meta?.target ?? []) as string | string[] | undefined;
  const fields = Array.isArray(target) ? target : target ? [target] : [];
  return fields.includes('idempotency_key');
}

@Injectable()
export class PayoutRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  findPayoutById(id: string): Promise<Payout | null> {
    return this.prisma.payout.findUnique({ where: { id } });
  }

  findPayoutByIdempotencyKey(idempotencyKey: string): Promise<Payout | null> {
    return this.prisma.payout.findUnique({ where: { idempotencyKey } });
  }

  /**
   * Atomically: reserve the funds (guarded debit), create the payout, post the
   * balanced `reserved` ledger pair, and enqueue the outbox message. The
   * guarded debit is the concurrency guard that makes overdrawing impossible;
   * the unique idempotency_key makes a concurrent duplicate fail cleanly.
   */
  async createPayout(input: CreatePayoutInput): Promise<CreatePayoutOutcome> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const debited = await tx.account.updateMany({
          where: { id: input.accountId, availableMinor: { gte: input.amountMinor } },
          data: { availableMinor: { decrement: input.amountMinor } },
        });
        if (debited.count === 0) {
          const account = await tx.account.findUnique({ where: { id: input.accountId } });
          if (!account) {
            return { outcome: 'account_not_found' as const };
          }
          return { outcome: 'insufficient_funds' as const, availableMinor: account.availableMinor };
        }

        const payout = await tx.payout.create({
          data: {
            accountId: input.accountId,
            amountMinor: input.amountMinor,
            destinationAddress: input.destinationAddress,
            idempotencyKey: input.idempotencyKey,
          },
        });

        await tx.ledgerEntry.create({
          data: [
            {
              payoutId: payout.id,
              event: 'reserved',
              accountCode: `payable:${input.accountId}:available`,
              direction: LedgerDirection.debit,
              amountMinor: input.amountMinor,
            },
            {
              payoutId: payout.id,
              event: 'reserved',
              accountCode: `payable:${input.accountId}:pending`,
              direction: LedgerDirection.credit,
              amountMinor: input.amountMinor,
            },
          ],
        });

        await tx.payoutMessage.create({ data: { payoutId: payout.id } });

        return { outcome: 'created' as const, payout };
      });
    } catch (error) {
      if (isIdempotencyKeyConflict(error)) {
        // A concurrent call with the same key won the race; our transaction
        // rolled back, so nothing was double-reserved.
        const existing = await this.findPayoutByIdempotencyKey(input.idempotencyKey);
        if (existing) {
          return { outcome: 'duplicate', payout: existing };
        }
      }
      throw error;
    }
  }

  /**
   * Claim up to `limit` due messages (pending and due, or processing and
   * stale). The claim is a guarded UPDATE re-checked against the same
   * claimability conditions, so concurrent pollers never claim the same
   * message twice.
   */
  async claimMessages(limit: number, claimToken: string, staleAfterMs: number): Promise<PayoutMessage[]> {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - staleAfterMs);
    const claimable: Prisma.PayoutMessageWhereInput = {
      OR: [
        { status: 'pending', nextAttemptAt: { lte: now } },
        { status: 'processing', lockedAt: { lte: staleBefore } },
      ],
    };
    return this.prisma.$transaction(async (tx) => {
      const candidates = await tx.payoutMessage.findMany({
        where: claimable,
        orderBy: { createdAt: 'asc' },
        take: limit,
      });
      const ids = candidates.map((message) => message.id);
      if (ids.length === 0) {
        return [];
      }
      await tx.payoutMessage.updateMany({
        where: { id: { in: ids }, ...claimable },
        data: { status: 'processing', claimToken, lockedAt: now },
      });
      return tx.payoutMessage.findMany({
        where: { id: { in: ids }, claimToken },
        orderBy: { createdAt: 'asc' },
      });
    });
  }

  /** created -> processing. Returns rows flipped (0 means a concurrent worker owns it). */
  async transitionToProcessing(payoutId: string): Promise<number> {
    const result = await this.prisma.payout.updateMany({
      where: { id: payoutId, status: 'created' },
      data: { status: 'processing' },
    });
    return result.count;
  }

  /**
   * Provider confirmed the transfer. Atomically: processing -> sent (txHash),
   * debit the reservation to the platform cash, post the balanced `settled`
   * pair, sent -> completed, and finish the message. Every step is guarded,
   * so a duplicate delivery cannot post the ledger twice.
   */
  async applySent(payoutId: string, messageId: string, txHash: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const flipped = await tx.payout.updateMany({
        where: { id: payoutId, status: 'processing' },
        data: { status: 'sent', txHash },
      });
      if (flipped.count === 0) {
        await this.settleDuplicateDelivery(tx, payoutId, messageId);
        return;
      }
      const payout = await tx.payout.findUniqueOrThrow({ where: { id: payoutId } });
      const debited = await tx.account.updateMany({
        where: { id: payout.accountId, pendingMinor: { gte: payout.amountMinor } },
        data: { pendingMinor: { decrement: payout.amountMinor } },
      });
      if (debited.count !== 1) {
        throw new Error(`ledger invariant violated: payout ${payoutId} has no matching reservation`);
      }
      await tx.ledgerEntry.create({
        data: [
          {
            payoutId,
            event: 'settled',
            accountCode: `payable:${payout.accountId}:pending`,
            direction: LedgerDirection.debit,
            amountMinor: payout.amountMinor,
          },
          {
            payoutId,
            event: 'settled',
            accountCode: 'cash:stablecoin',
            direction: LedgerDirection.credit,
            amountMinor: payout.amountMinor,
          },
        ],
      });
      await tx.payout.updateMany({
        where: { id: payoutId, status: 'sent' },
        data: { status: 'completed' },
      });
      await this.markMessageDone(tx, messageId);
    });
  }

  /**
   * The provider rejected definitively: the transfer is known not to have
   * happened. Atomically: processing -> failed, release the reservation
   * (balanced `released` reversal), and finish the message.
   */
  async applyFailed(payoutId: string, messageId: string, reason: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const flipped = await tx.payout.updateMany({
        where: { id: payoutId, status: 'processing' },
        data: { status: 'failed', failureReason: truncate(reason) },
      });
      if (flipped.count === 0) {
        await this.settleDuplicateDelivery(tx, payoutId, messageId);
        return;
      }
      const payout = await tx.payout.findUniqueOrThrow({ where: { id: payoutId } });
      const released = await tx.account.updateMany({
        where: { id: payout.accountId, pendingMinor: { gte: payout.amountMinor } },
        data: {
          availableMinor: { increment: payout.amountMinor },
          pendingMinor: { decrement: payout.amountMinor },
        },
      });
      if (released.count !== 1) {
        throw new Error(`ledger invariant violated: payout ${payoutId} has no matching reservation`);
      }
      await tx.ledgerEntry.create({
        data: [
          {
            payoutId,
            event: 'released',
            accountCode: `payable:${payout.accountId}:pending`,
            direction: LedgerDirection.debit,
            amountMinor: payout.amountMinor,
          },
          {
            payoutId,
            event: 'released',
            accountCode: `payable:${payout.accountId}:available`,
            direction: LedgerDirection.credit,
            amountMinor: payout.amountMinor,
          },
        ],
      });
      await this.markMessageDone(tx, messageId);
    });
  }

  /**
   * Retries exhausted without a definitive outcome. The payout is parked in
   * needs_review and the message stops being delivered. Deliberately NO ledger
   * movement: the outcome is unknown, so the reservation stays (DESIGN.md).
   */
  async applyExhausted(payoutId: string, messageId: string, attempts: number, reason: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const flipped = await tx.payout.updateMany({
        where: { id: payoutId, status: 'processing' },
        data: { status: 'needs_review', failureReason: truncate(reason) },
      });
      if (flipped.count === 0) {
        await this.settleDuplicateDelivery(tx, payoutId, messageId);
        return;
      }
      await tx.payoutMessage.update({
        where: { id: messageId },
        data: { status: 'dead', attempts, lastError: truncate(reason), claimToken: null, lockedAt: null },
      });
    });
  }

  /** Bump the attempt count and schedule the next try. */
  async applyRetry(messageId: string, attempts: number, nextAttemptAt: Date, reason: string): Promise<void> {
    await this.prisma.payoutMessage.update({
      where: { id: messageId },
      data: {
        status: 'pending',
        attempts,
        nextAttemptAt,
        lastError: truncate(reason),
        claimToken: null,
        lockedAt: null,
      },
    });
  }

  /** Terminate a claimed message (idempotent: only flips messages in 'processing'). */
  async finishMessage(messageId: string, status: 'done' | 'dead'): Promise<void> {
    await this.prisma.payoutMessage.updateMany({
      where: { id: messageId, status: 'processing' },
      data: { status, claimToken: null, lockedAt: null },
    });
  }

  private async settleDuplicateDelivery(
    tx: Prisma.TransactionClient,
    payoutId: string,
    messageId: string,
  ): Promise<void> {
    const current = await tx.payout.findUnique({ where: { id: payoutId } });
    if (
      current &&
      (current.status === 'completed' || current.status === 'failed' || current.status === 'needs_review')
    ) {
      await tx.payoutMessage.updateMany({
        where: { id: messageId, status: 'processing' },
        data: { status: current.status === 'needs_review' ? 'dead' : 'done', claimToken: null, lockedAt: null },
      });
    }
    // If the payout is still in-flight, a concurrent worker owns it; the
    // message stays 'processing' and stale recovery will retry.
  }

  private async markMessageDone(tx: Prisma.TransactionClient, messageId: string): Promise<void> {
    await tx.payoutMessage.updateMany({
      where: { id: messageId, status: 'processing' },
      data: { status: 'done', claimToken: null, lockedAt: null },
    });
  }
}
```

### test/payout.spec.ts
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PayoutRepository } from '../src/payout/payout.repository';
import { PayoutError, PayoutService, type PayoutDto } from '../src/payout/payout.service';
import type { PayoutProvider, TransferArgs } from '../src/payout/payout.provider';

// Integration tests: require Postgres via DATABASE_URL (see prisma/schema.prisma)
// and a generated client (`pnpm prisma:generate`). Skipped when DATABASE_URL
// is absent.
const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

suite('payout service', () => {
  let prisma!: PrismaClient;
  const seededAccounts: string[] = [];

  class StubProvider implements PayoutProvider {
    readonly calls: TransferArgs[] = [];

    constructor(
      private readonly mode: 'success' | 'transient' | 'definitive' = 'success',
      private readonly failureMessage = 'stub provider failure',
    ) {}

    async transfer(args: TransferArgs): Promise<{ txHash: string }> {
      this.calls.push(args);
      if (this.mode === 'success') {
        return { txHash: `0xstub${this.calls.length}` };
      }
      const error = new Error(this.failureMessage);
      if (this.mode === 'definitive') {
        Object.assign(error, { definitive: true });
      }
      throw error;
    }
  }

  function makeService(provider: PayoutProvider): PayoutService {
    return new PayoutService(new PayoutRepository(prisma), provider);
  }

  async function seedAccount(availableMinor: bigint, pendingMinor = 0n): Promise<string> {
    const account = await prisma.account.create({ data: { availableMinor, pendingMinor } });
    seededAccounts.push(account.id);
    return account.id;
  }

  async function wipeAccount(accountId: string): Promise<void> {
    const payoutIds = (
      await prisma.payout.findMany({ where: { accountId }, select: { id: true } })
    ).map((p) => p.id);
    await prisma.payoutMessage.deleteMany({ where: { payoutId: { in: payoutIds } } });
    await prisma.ledgerEntry.deleteMany({ where: { payoutId: { in: payoutIds } } });
    await prisma.payout.deleteMany({ where: { id: { in: payoutIds } } });
    await prisma.account.delete({ where: { id: accountId } });
  }

  beforeAll(() => {
    process.env.PAYOUT_MAX_ATTEMPTS ??= '3';
    process.env.PAYOUT_RETRY_BASE_MS ??= '0';
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    for (const accountId of seededAccounts) {
      await wipeAccount(accountId);
    }
    await prisma.$disconnect();
  });

  it('never overdraws an account when requests race on it', async () => {
    const accountId = await seedAccount(100_000n);
    const provider = new StubProvider();
    const service = makeService(provider);

    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        service
          .createPayout({
            accountId,
            amountMinor: 60_000n,
            destinationAddress: `0xdst${i}`,
            idempotencyKey: `race-${i}-${randomUUID()}`,
          })
          .then(
            (payout) => ({ ok: true as const, payout }),
            (error: unknown) => ({ ok: false as const, error }),
          ),
      ),
    );

    const succeeded = results.filter((r): r is { ok: true; payout: PayoutDto } => r.ok);
    const failed = results.filter((r): r is { ok: false; error: unknown } => !r.ok);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(5);
    for (const r of failed) {
      expect(r.error).toBeInstanceOf(PayoutError);
      expect((r.error as PayoutError).httpStatus).toBe(409);
      expect((r.error as PayoutError).code).toBe('insufficient_funds');
    }

    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.availableMinor).toBe(40_000n);
    expect(account.pendingMinor).toBe(60_000n);

    const payouts = await prisma.payout.findMany({ where: { accountId } });
    expect(payouts).toHaveLength(1);

    const ledger = await prisma.ledgerEntry.findMany({ where: { payoutId: payouts[0].id } });
    expect(ledger).toHaveLength(2);
    const debits = ledger
      .filter((e) => e.direction === 'debit')
      .reduce<bigint>((sum, e) => sum + e.amountMinor, 0n);
    const credits = ledger
      .filter((e) => e.direction === 'credit')
      .reduce<bigint>((sum, e) => sum + e.amountMinor, 0n);
    expect(debits).toBe(credits);
    expect(debits).toBe(60_000n);

    const messages = await prisma.payoutMessage.findMany({ where: { payoutId: payouts[0].id } });
    expect(messages).toHaveLength(1);
    expect(messages[0].status).toBe('pending');

    // The transfer never happens inside the request.
    expect(provider.calls).toHaveLength(0);
  });

  it('does not double-create or double-reserve when the same idempotency key races', async () => {
    const accountId = await seedAccount(100_000n);
    const service = makeService(new StubProvider());
    const input = {
      accountId,
      amountMinor: 30_000n,
      destinationAddress: '0xdst',
      idempotencyKey: `dup-${randomUUID()}`,
    };

    const results = await Promise.allSettled([
      service.createPayout(input),
      service.createPayout(input),
      service.createPayout(input),
    ]);

    const fulfilled = results.filter((r): r is PromiseFulfilledResult<PayoutDto> => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(3);
    const ids = new Set(fulfilled.map((r) => r.value.id));
    expect(ids.size).toBe(1);

    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.availableMinor).toBe(70_000n);
    expect(account.pendingMinor).toBe(30_000n);

    const payouts = await prisma.payout.findMany({ where: { accountId } });
    expect(payouts).toHaveLength(1);

    const reserved = await prisma.ledgerEntry.findMany({
      where: { payoutId: payouts[0].id, event: 'reserved' },
    });
    expect(reserved).toHaveLength(2);
  });

  it('settles only on provider confirmation and survives duplicate message delivery', async () => {
    const accountId = await seedAccount(100_000n);
    const provider = new StubProvider();
    const service = makeService(provider);
    const { id: payoutId } = await service.createPayout({
      accountId,
      amountMinor: 40_000n,
      destinationAddress: '0xdst',
      idempotencyKey: `settle-${randomUUID()}`,
    });

    await service.processMessages();

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toEqual({ to: '0xdst', amount: 40_000n });
    let payout = await prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
    expect(payout.status).toBe('completed');
    expect(payout.txHash).toBe('0xstub1');
    let account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.availableMinor).toBe(60_000n);
    expect(account.pendingMinor).toBe(0n);
    const firstMessage = await prisma.payoutMessage.findUniqueOrThrow({ where: { payoutId } });
    expect(firstMessage.status).toBe('done');

    // At-least-once: force a redelivery of the same message, with two workers
    // polling at the same instant.
    await prisma.payoutMessage.update({
      where: { id: firstMessage.id },
      data: { status: 'pending', nextAttemptAt: new Date(), lockedAt: null, claimToken: null, attempts: 0 },
    });
    await Promise.all([service.processMessages(), service.processMessages()]);

    // No second transfer, no double posting, no balance drift.
    expect(provider.calls).toHaveLength(1);
    payout = await prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
    expect(payout.status).toBe('completed');
    expect(payout.txHash).toBe('0xstub1');
    account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.availableMinor).toBe(60_000n);
    expect(account.pendingMinor).toBe(0n);

    const settled = await prisma.ledgerEntry.findMany({ where: { payoutId, event: 'settled' } });
    expect(settled.map((e) => `${e.accountCode}:${e.direction}`).sort()).toEqual([
      'cash:stablecoin:credit',
      `payable:${accountId}:pending:debit`,
    ]);
  });

  it('releases the reservation when the provider rejects definitively', async () => {
    const accountId = await seedAccount(100_000n);
    const provider = new StubProvider('definitive', 'invalid destination address');
    const service = makeService(provider);
    const { id: payoutId } = await service.createPayout({
      accountId,
      amountMinor: 25_000n,
      destinationAddress: 'bad-address',
      idempotencyKey: `def-${randomUUID()}`,
    });

    await service.processMessages();

    // Definitive: no retries.
    expect(provider.calls).toHaveLength(1);
    const payout = await prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
    expect(payout.status).toBe('failed');
    expect(payout.failureReason).toBe('invalid destination address');

    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.availableMinor).toBe(100_000n);
    expect(account.pendingMinor).toBe(0n);

    const events = (await prisma.ledgerEntry.findMany({ where: { payoutId } }))
      .map((e) => e.event)
      .sort();
    expect(events).toEqual(['released', 'released', 'reserved', 'reserved']);

    const message = await prisma.payoutMessage.findUniqueOrThrow({ where: { payoutId } });
    expect(message.status).toBe('done');
  });

  it('exhausts bounded retries, parks the payout in needs_review and keeps the funds reserved', async () => {
    const accountId = await seedAccount(100_000n);
    const provider = new StubProvider('transient', 'provider timed out');
    const service = makeService(provider);
    const { id: payoutId } = await service.createPayout({
      accountId,
      amountMinor: 25_000n,
      destinationAddress: '0xdst',
      idempotencyKey: `exh-${randomUUID()}`,
    });

    await service.processMessages(); // attempt 1 -> retry scheduled
    await service.processMessages(); // attempt 2 -> retry scheduled
    await service.processMessages(); // attempt 3 == PAYOUT_MAX_ATTEMPTS -> needs_review

    expect(provider.calls).toHaveLength(3);

    const payout = await prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
    expect(payout.status).toBe('needs_review');
    expect(payout.failureReason).toBe('provider timed out');

    const message = await prisma.payoutMessage.findUniqueOrThrow({ where: { payoutId } });
    expect(message.status).toBe('dead');
    expect(message.attempts).toBe(3);

    // Safe outcome: with no definitive outcome the funds stay reserved.
    // Releasing could double-pay if the timed-out transfer went through.
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.availableMinor).toBe(75_000n);
    expect(account.pendingMinor).toBe(25_000n);

    const events = (await prisma.ledgerEntry.findMany({ where: { payoutId } }))
      .map((e) => e.event)
      .sort();
    expect(events).toEqual(['reserved', 'reserved']);

    // A further pass does nothing.
    await service.processMessages();
    expect(provider.calls).toHaveLength(3);
  });
});
```
