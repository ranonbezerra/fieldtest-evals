# 04-payout-worker.service.ts-retry

## reasoning

```
Let me analyze what the worker service needs to do based on the PLAN.md:

1. `PayoutWorkerService` class, `@Injectable()`
2. Constructor takes `provider: TransferProvider` and `repo: PayoutRepository`
3. `processMessages(): Promise<void>` - the idempotent work unit called by a `setInterval` loop started in `onModuleInit`

Control flow for `processMessages()`:
1. Fetch candidate messages:
   a. `nextPendingMessage(10)` → all rows with `status = 'pending'`
   b. `claimStaleMessages(30000, 10)` → rows with `status = 'processing'` AND `processing_started_at < NOW() − 30s`
2. For each candidate, atomically claim:
   - `claimMessage(id)`: If 0 rows, skip (another worker got it).
3. Set payout status to `processing` (if not already).
4. Call `provider.transfer(destinationAddress, amount)`.
5. On **success**: in one transaction → `settleLedger`, `updatePayoutStatus(→ completed, txHash)`, `markMessageDone`.
6. On **error**:
   - If `attempts < maxAttempts`: increment attempts, set status back to `pending`, clear `processing_started_at`. Store last error.
   - If `attempts >= maxAttempts`: in one transaction → `releaseHold`, `updatePayoutStatus(→ needs_review)`, `markMessageFailed`.

Now, the worker needs access to payout details (destinationAddress, amount) and account info. The outbox message has a `payoutId` FK. So I need to fetch the payout by ID to get the details.

Looking at the repository, I have `findPayoutById(id: string)` which returns a `PayoutResponse`. But wait - the worker needs `accountId` and `amount` as a bigint for the provider call and for ledger operations. The `PayoutResponse` has `amount` as a string. That's a problem.

Actually, looking more carefully at the repository, the `findPayoutById` returns a `PayoutResponse` where `amount` is a string. But for the worker, I need the raw bigint amount and the accountId. 

Hmm, but the plan says the worker reads from `payout.repository.ts`. Let me think about what's available...

The repository has:
- `findPayoutById(id: string): Promise<PayoutResponse | null>` - returns amount as string
- `findPayoutByIdempotencyKey(key: string): Promise<PayoutResponse | null>`
- `updatePayoutStatus(id, status, txHash?, tx?)`
- `settleLedger(payoutId, accountId, amount: bigint, tx?)`
- `releaseHold(payoutId, accountId, amount: bigint, tx?)`
- `claimMessage(messageId): Promise<boolean>`
- `claimStaleMessages(timeoutMs, limit): Promise<OutboxMessageRow[]>`
- `nextPendingMessage(limit): Promise<OutboxMessageRow[]>`
- `incrementAttempts(messageId, lastError?)`
- `markMessageDone(messageId, tx?)`
- `markMessageFailed(messageId, error, tx?)`
- `withTransaction(fn)`

The `OutboxMessageRow` is `Prisma.OutboxMessageGetPayload<{}>` which would have all the columns from the outbox_messages table including `payoutId`.

So the worker needs to get the payout details. The `findPayoutById` returns a `PayoutResponse` with `amount` as string. I could parse it back to bigint. That's a bit awkward but workable.

Actually wait - let me reconsider. The plan says the worker needs `accountId` and `amount`. The `PayoutResponse` has both `accountId` (string) and `amount` (string). I can parse the amount back to bigint.

But actually, looking at this more carefully - the worker also needs `destinationAddress` which is in `PayoutResponse`.

So the flow would be:
1. Get pending messages and stale messages
2. For each, claim it
3. Fetch the payout by `message.payoutId`
4. Set status to processing
5. Call provider.transfer(destinationAddress, BigInt(amount))
6. Handle success/failure

Let me also think about the `onModuleInit` and `setInterval`. The plan says:
- `processMessages` is the idempotent work unit called by a `setInterval` loop started in `onModuleInit`.
- Worker polling interval: 5 seconds (configurable via env `WORKER_POLL_MS`)

So I need to implement `OnModuleInit` and start a `setInterval`.

Let me also consider: the `TransferProvider` interface is defined in `payout.service.ts` per the plan. So I need to import it from there. Wait, actually re-reading: "Provider interface location | Defined in `payout.service.ts` as an exported interface, injected via DI token"

So I'll import `TransferProvider` from `./payout.service.js`.

Now let me think about the DI token. The plan says "injected via DI token". I'll use a string token or the interface itself. In NestJS, you can use an abstract class or a string token. Since it's an interface (not a class), I'll use a string token like `'TRANSFER_PROVIDER'` or I could use `TransferProvider` as the token if I define it properly. Actually, in NestJS with TypeScript, you can't use an interface as a DI token directly (interfaces are erased at compile time). So I'll need a string token or a dedicated injection token.

Let me use a string constant: `export const TRANSFER_PROVIDER = 'TRANSFER_PROVIDER';`

Wait, but the plan says "Do not add an export, a feature or a file the plan does not name." So I should be careful about what I export. The plan says the worker has:
- `constructor(provider: TransferProvider, repo: PayoutRepository)`
- `processMessages(): Promise<void>`

And it's a `@Injectable()` class `PayoutWorkerService`.

For the DI token, I think it's reasonable to define it in this file since the worker is what injects it. Or I could just use `@Inject('TRANSFER_PROVIDER')`. Let me think...

Actually, looking at the plan more carefully, it says "Defined in `payout.service.ts` as an exported interface, injected via DI token". The token could be defined anywhere. I'll define a constant in this file for the injection token since that's where it's needed for injection. Actually, to keep it simple and not add exports the plan doesn't name, I'll just use `@Inject('TRANSFER_PROVIDER')` with the string literal.

Wait, but I need to import `TransferProvider` type from `payout.service.ts`. That's fine, it's a type import.

Now for the `OnModuleInit` - I need to start the interval. Let me think about what to do with `onModuleDestroy` - I should clear the interval. The plan doesn't explicitly mention `onModuleDestroy` but it's standard practice and necessary for the setInterval to be cleaned up. I'll include it as it's part of making the `onModuleInit` interval work correctly.

Let me also think about error handling in `processMessages`. If one message fails to process (e.g., DB error), should it crash the whole batch? I think I should catch errors per-message so one bad message doesn't stop others.

Let me also consider: the plan says "Set payout status to `processing` (if not already)." This means I should check if it's already processing before setting it. Or I could just set it unconditionally - the "if not already" might just mean it's idempotent. I'll just set it to processing unconditionally since the claim already ensures we're the ones processing.

Actually, re-reading: "Set payout status to `processing` (if not already)." - I think this is just a note that it's fine if it's already processing (from a previous crash/recovery). I'll just set it.

Now, for the amount parsing: `PayoutResponse.amount` is a string. I'll do `BigInt(payout.amount)` to get the bigint.

Let me also think about what `accountId` I need for `settleLedger` and `releaseHold`. The `PayoutResponse` has `accountId` as a string. Good.

Let me write the file:

```typescript
import { Injectable, Inject, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PayoutRepository } from './payout.repository.js';
import type { TransferProvider } from './payout.service.js';

const WORKER_POLL_MS = Number(process.env.WORKER_POLL_MS ?? 5000);
const STALE_TIMEOUT_MS = 30_000;
const BATCH_SIZE = 10;

@Injectable()
export class PayoutWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutWorkerService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject('TRANSFER_PROVIDER') private readonly provider: TransferProvider,
    private readonly repo: PayoutRepository,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.processMessages().catch((err) => {
        this.logger.error('processMessages failed', err.stack);
      });
    }, WORKER_POLL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processMessages(): Promise<void> {
    const [pending, stale] = await Promise.all([
      this.repo.nextPendingMessage(BATCH_SIZE),
      this.repo.claimStaleMessages(STALE_TIMEOUT_MS, BATCH_SIZE),
    ]);

    const candidates = [...pending, ...stale];

    for (const message of candidates) {
      try {
        await this.processOne(message.id, message.payoutId, message.attempts, message.maxAttempts);
      } catch (err) {
        this.logger.error(`Failed to process message ${message.id}`, (err as Error).stack);
      }
    }
  }

  private async processOne(
    messageId: string,
    payoutId: string,
    attempts: number,
    maxAttempts: number,
  ): Promise<void> {
    // Atomically claim the message
    const claimed = await this.repo.claimMessage(messageId);
    if (!claimed) {
      return; // Another worker got it
    }

    const payout = await this.repo.findPayoutById(payoutId);
    if (!payout) {
      // Payout not found — this should not happen; mark as failed
      await this.repo.markMessageFailed(messageId, 'Payout not found');
      return;
    }

    // Set payout status to processing
    await this.repo.updatePayoutStatus(payoutId, 'processing');

    const amount = BigInt(payout.amount);

    try {
      const { txHash } = await this.provider.transfer(payout.destinationAddress, amount);

      // Success: settle in one transaction
      await this.repo.withTransaction(async (tx) => {
        await this.repo.settleLedger(payoutId, payout.accountId, amount, tx);
        await this.repo.updatePayoutStatus(payoutId, 'completed', txHash, tx);
        await this.repo.markMessageDone(messageId, tx);
      });
    } catch (err) {
      const errorMessage = (err as Error).message ?? String(err);

      if (attempts < maxAttempts) {
        // Retry: increment attempts, reset to pending
        await this.repo.incrementAttempts(messageId, errorMessage);
      } else {
        // Exhausted: release hold, mark needs_review
        await this.repo.withTransaction(async (tx) => {
          await this.repo.releaseHold(payoutId, payout.accountId, amount, tx);
          await this.repo.updatePayoutStatus(payoutId, 'needs_review', undefined, tx);
          await this.repo.markMessageFailed(messageId, errorMessage, tx);
        });
      }
    }
  }
}
```

Wait, I need to think about the `TransferProvider` import. The plan says it's defined in `payout.service.ts`. I should use a type-only import since it's an interface.

Also, I'm using `@Inject('TRANSFER_PROVIDER')` - this is a string token. The plan says "injected via DI token" which confirms this approach.

Let me also reconsider the `onModuleDestroy` - is it in the plan? The plan says "started in `onModuleInit`" but doesn't explicitly mention `onModuleDestroy`. However, it's a standard lifecycle hook and necessary for proper cleanup. I think it's reasonable to include it as part of implementing the interval properly. It's not adding a "feature" per se, it's proper implementation of what the plan describes.

Actually wait - let me re-read the constraint: "Do not add an export, a feature or a file the plan does not name." `onModuleDestroy` is not an export, not a feature, and not a file. It's part of implementing the `onModuleInit` lifecycle properly. I'll keep it.

One more thing - the `PayoutStatus` values. In the repository, I see it imports `PayoutStatus` from `@prisma/client`. The enum values would be `PayoutStatus.CREATED`, `PayoutStatus.PROCESSING`, `PayoutStatus.COMPLETED`, `PayoutStatus.NEEDS_REVIEW`, etc. But in the repository code I see it's used as a string parameter in `updatePayoutStatus`. Let me look at how the repository uses it...

In the repository: `updatePayoutStatus(id: string, status: PayoutStatus, txHash?: string, tx?: Prisma.TransactionClient)` - it takes `PayoutStatus` which is the Prisma enum.

So I should import `PayoutStatus` from `@prisma/client` and use the enum values. Let me update:

```typescript
import { PayoutStatus } from '@prisma/client';
```

And use `PayoutStatus.PROCESSING`, `PayoutStatus.COMPLETED`, `PayoutStatus.NEEDS_REVIEW`.

Actually wait, looking at the repository more carefully, it imports `PayoutStatus` from `@prisma/client`. So the enum values would be like `PayoutStatus.PROCESSING`, etc. Let me use those.

Let me finalize the file.
```

## reply

```typescript
import { Injectable, Inject, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PayoutStatus } from '@prisma/client';
import { PayoutRepository } from './payout.repository.js';
import type { TransferProvider } from './payout.service.js';

const WORKER_POLL_MS = Number(process.env.WORKER_POLL_MS ?? 5000);
const STALE_TIMEOUT_MS = 30_000;
const BATCH_SIZE = 10;

@Injectable()
export class PayoutWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutWorkerService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject('TRANSFER_PROVIDER') private readonly provider: TransferProvider,
    private readonly repo: PayoutRepository,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.processMessages().catch((err) => {
        this.logger.error('processMessages failed', err instanceof Error ? err.stack : String(err));
      });
    }, WORKER_POLL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processMessages(): Promise<void> {
    const [pending, stale] = await Promise.all([
      this.repo.nextPendingMessage(BATCH_SIZE),
      this.repo.claimStaleMessages(STALE_TIMEOUT_MS, BATCH_SIZE),
    ]);

    const candidates = [...pending, ...stale];

    for (const message of candidates) {
      try {
        await this.processOne(message);
      } catch (err) {
        this.logger.error(
          `Failed to process message ${message.id}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
  }

  private async processOne(message: {
    id: string;
    payoutId: string;
    attempts: number;
    maxAttempts: number;
  }): Promise<void> {
    const claimed = await this.repo.claimMessage(message.id);
    if (!claimed) {
      return;
    }

    const payout = await this.repo.findPayoutById(message.payoutId);
    if (!payout) {
      await this.repo.markMessageFailed(message.id, 'Payout not found');
      return;
    }

    await this.repo.updatePayoutStatus(message.payoutId, PayoutStatus.PROCESSING);

    const amount = BigInt(payout.amount);

    try {
      const { txHash } = await this.provider.transfer(payout.destinationAddress, amount);

      await this.repo.withTransaction(async (tx) => {
        await this.repo.settleLedger(message.payoutId, payout.accountId, amount, tx);
        await this.repo.updatePayoutStatus(message.payoutId, PayoutStatus.COMPLETED, txHash, tx);
        await this.repo.markMessageDone(message.id, tx);
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      if (message.attempts < message.maxAttempts) {
        await this.repo.incrementAttempts(message.id, errorMessage);
      } else {
        await this.repo.withTransaction(async (tx) => {
          await this.repo.releaseHold(message.payoutId, payout.accountId, amount, tx);
          await this.repo.updatePayoutStatus(message.payoutId, PayoutStatus.NEEDS_REVIEW, undefined, tx);
          await this.repo.markMessageFailed(message.id, errorMessage, tx);
        });
      }
    }
  }
}
```
