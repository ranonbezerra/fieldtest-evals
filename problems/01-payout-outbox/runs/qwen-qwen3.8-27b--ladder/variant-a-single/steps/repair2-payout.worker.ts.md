# repair2-payout.worker.ts

## reasoning

```
Let me analyze the compiler errors for `src/payout/payout.worker.ts`:

1. `src/payout/payout.worker.ts(2,34): error TS2307: Cannot find module './payout.repository'` — This file imports from `./payout.repository` which doesn't exist yet (or isn't found).
2. `src/payout/payout.worker.ts(3,32): error TS2307: Cannot find module './payout.provider'` — Imports from `./payout.provider` which doesn't exist.
3. `src/payout/payout.worker.ts(4,38): error TS2307: Cannot find module './payout.types'` — Imports from `./payout.types` which doesn't exist.
4. `src/payout/payout.worker.ts(108,21): error TS2352: Conversion of type 'Error' to type '{ code: string; }' may be a mistake` — There's a type cast issue at line 108.

The task says "Change nothing the messages do not name." So I need to fix `src/payout/payout.worker.ts` to resolve the errors that are in THIS file. The TS2307 errors for `./payout.repository`, `./payout.provider`, and `./payout.types` mean those modules don't exist yet — but the task says to rewrite this file fixing what the messages require of THIS file.

Wait, let me re-read: "Rewrite `src/payout/payout.worker.ts` complete, fixing what these messages require of this file."

So I need to fix the errors that are in `src/payout/payout.worker.ts`. The errors in this file are:
- Line 2: Cannot find module './payout.repository'
- Line 3: Cannot find module './payout.provider'
- Line 4: Cannot find module './payout.types'
- Line 108: TS2352 conversion error

The TS2307 errors mean the imported modules don't exist. But the task says "Change nothing the messages do not name." — so I shouldn't create other files. But the errors ARE naming this file's imports. 

Hmm, but the task says "Rewrite `src/payout/payout.worker.ts` complete, fixing what these messages require of this file." So I need to make this file compile. The TS2307 errors for missing modules can't be fixed by changing this file alone — those modules need to exist. But wait, maybe the other files ARE supposed to exist and the task is just about fixing THIS file.

Actually, re-reading more carefully: "These are the compiler's exact messages for the whole workspace — not a summary of them." So ALL these errors exist across the workspace. My job is only to fix `src/payout/payout.worker.ts`.

For the TS2307 errors on lines 2, 3, 4 of `payout.worker.ts` — these are because the modules `./payout.repository`, `./payout.provider`, and `./payout.types` don't exist. But I'm only asked to fix `payout.worker.ts`. If those files don't exist, I can't fix the import errors from within `payout.worker.ts` alone unless I use `// @ts-ignore` or something, but that would be wrong.

Wait, let me reconsider. The task says "Rewrite `src/payout/payout.worker.ts` complete, fixing what these messages require of this file." Maybe the other files DO exist but just aren't shown to me. The reference materials show the schema but not the other source files. The compiler errors suggest those files don't exist yet, but perhaps in the actual workspace they do exist and the errors are stale, or perhaps I'm supposed to assume they will exist.

Actually, I think the most reasonable interpretation is: the other files (`payout.repository.ts`, `payout.provider.ts`, `payout.types.ts`) will be created/exist separately. My job is to write `payout.worker.ts` such that:
1. It correctly imports from those modules (the imports themselves are fine, the modules just need to exist)
2. The TS2352 error at line 108 is fixed

So the TS2307 errors will be resolved when those other files are created. My job is to make sure my file is correct assuming those modules exist with the right exports.

For the TS2352 error: "Conversion of type 'Error' to type '{ code: string; }' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first."

This means at line 108, there's something like `error as { code: string }` where error is of type `Error`. The fix is to use `error as unknown as { code: string }` or better, to check the type properly.

Now let me think about what the worker should do based on the plan:

From the plan (variant-a.md):
- The worker polls the message table
- It processes messages (payout transfers)
- It calls `provider.transfer({to, amount}) -> {txHash}`
- Delivery is at-least-once: the worker may see the same message more than once
- The provider can fail transiently. Retry a bounded number of times; if you exhaust retries without a definitive outcome, do something safe.

From the schema:
- `Message` has: id, type, payload (Json), status (pending/processing/processed), attempts (Int), nextAttemptAt (DateTime), processedAt, createdAt, updatedAt
- `Payout` has: id, accountId, idempotencyKey, amount, destinationAddress, status, txHash, etc.
- `Account` has: settledBalance, reservedBalance

The worker should:
1. Poll for pending messages (status = pending, nextAttemptAt <= now)
2. For each message, mark it as processing (to handle at-least-once delivery)
3. Based on the message type, process the payout:
   - Call the provider to make the transfer
   - On success: update payout status to 'sent', record txHash, move from reserved to settled (actually, move funds from reserved to the provider/external), update ledger
   - On failure: increment attempts, set nextAttemptAt for retry, or if max attempts exceeded, mark as failed/needs_review
4. Mark message as processed

Let me think about the message types. Based on the plan:
- A message is created when a payout is created (type: "payout:process")
- The payload would contain the payout ID

For the retry logic:
- Bounded retries (say 3 attempts)
- If all retries fail without a definitive outcome (i.e., we don't know if the transfer went through), mark the payout as 'needs_review' rather than 'failed' — this is the safe choice because the transfer might have actually succeeded on-chain but we didn't get confirmation.

Now for the imports, I need to figure out what to import:
- From `./payout.repository`: The repository class (PayoutRepository)
- From `./payout.provider`: The provider class (PayoutProvider)
- From `./payout.types`: Types like message payload types

Let me think about what the repository would expose. Based on the plan's architecture:
- `payout.repository.ts` - the only layer that touches the database
- `payout.service.ts` - holds business logic
- `payout.worker.ts` - the polling worker

The worker needs to:
1. Find pending messages
2. Mark a message as processing
3. Get the payout associated with a message
4. Update the payout status
5. Update the account balances
6. Create ledger entries
7. Mark message as processed
8. Update message for retry (increment attempts, set next attempt time)

So the repository needs methods like:
- `findPendingMessages()` 
- `markMessageProcessing(id)`
- `markMessageProcessed(id)`
- `scheduleMessageRetry(id, nextAttemptAt)`
- `findPayoutById(id)`
- `updatePayoutStatus(id, status, txHash?)`
- `updateAccountBalance(accountId, ...)`
- `createLedgerEntry(...)`
- Or maybe a transactional method

Actually, let me think about this differently. The worker is a NestJS service (provider) that runs a polling loop. Let me write it with proper NestJS patterns.

Looking at the module imports in `payout.module.ts`:
```
src/payout/payout.module.ts(2,34): Cannot find module './payout.controller'
src/payout/payout.module.ts(3,31): Cannot find module './payout.service'
src/payout/payout.module.ts(4,34): Cannot find module './payout.repository'
src/payout/payout.module.ts(5,30): Cannot find module './payout.worker'
src/payout/payout.module.ts(6,32): Cannot find module './payout.provider'
```

So the module imports: PayoutController, PayoutService, PayoutRepository, PayoutWorker, PayoutProvider.

The worker imports:
- `./payout.repository` → PayoutRepository
- `./payout.provider` → PayoutProvider (the blockchain provider wrapper)
- `./payout.types` → types

Let me now write the worker. I'll assume:

`PayoutRepository` has methods:
- `findPendingMessages(now: Date): Promise<Message[]>`
- `markMessageProcessing(id: string): Promise<void>`
- `markMessageProcessed(id: string): Promise<void>`
- `scheduleRetry(id: string, nextAttemptAt: Date): Promise<void>`
- `findPayoutById(id: string): Promise<Payout | null>`
- `updatePayout(id: string, data: { status: PayoutStatus; txHash?: string; completedAt?: Date }): Promise<void>`
- `processPayoutSuccess(payoutId: string, txHash: string): Promise<void>` — this would be a transactional operation
- `processPayoutFailed(payoutId: string): Promise<void>`

Actually, let me think about what makes sense. The worker should be simple: it finds messages, processes them, handles retries. The complex DB operations should be in the repository.

Let me define the message payload types. A message of type "payout:process" would have payload like `{ payoutId: string }`.

Let me also think about the `payout.types` module. It likely exports:
- `MessagePayload` or specific payload types
- Maybe `PayoutMessageType` constants
- `MAX_RETRIES` constant

Let me write the worker now:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PayoutRepository } from './payout.repository';
import { PayoutProvider } from './payout.provider';
import { PayoutMessageType, MAX_RETRIES, RETRY_DELAY_MS } from './payout.types';

@Injectable()
export class PayoutWorker {
  private readonly logger = new Logger(PayoutWorker.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly repository: PayoutRepository,
    private readonly provider: PayoutProvider,
  ) {}

  start(intervalMs: number = 5000): void {
    this.timer = setInterval(() => {
      this.processMessages().catch((err) => {
        this.logger.error(`Worker tick failed: ${err.message}`, err.stack);
      });
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processMessages(): Promise<void> {
    const messages = await this.repository.findPendingMessages(new Date());
    for (const message of messages) {
      await this.processMessage(message);
    }
  }

  private async processMessage(message: { id: string; type: string; payload: unknown; attempts: number }): Promise<void> {
    // Mark as processing to handle at-least-once delivery
    await this.repository.markMessageProcessing(message.id);

    try {
      if (message.type === PayoutMessageType.PAYOUT_PROCESS) {
        const { payoutId } = message.payload as { payoutId: string };
        await this.processPayout(payoutId, message);
      }
      await this.repository.markMessageProcessed(message.id);
    } catch (err) {
      const error = err as { code?: string; message: string };
      
      if (error.code === 'TRANSFER_FAILED' || error.code === 'TRANSFER_TIMEOUT') {
        // Transient failure — schedule retry
        if (message.attempts + 1 >= MAX_RETRIES) {
          // Exhausted retries without definitive outcome
          // Safe choice: mark as needs_review, do NOT release funds
          const { payoutId } = message.payload as { payoutId: string };
          await this.repository.markPayoutNeedsReview(payoutId);
          this.logger.warn(`Payout ${payoutId}: retries exhausted, marked needs_review`);
          await this.repository.markMessageProcessed(message.id);
        } else {
          const nextAttemptAt = new Date(Date.now() + RETRY_DELAY_MS);
          await this.repository.scheduleRetry(message.id, nextAttemptAt);
          this.logger.warn(`Message ${message.id}: attempt ${message.attempts + 1} failed, next retry at ${nextAttemptAt.toISOString()}`);
        }
      } else {
        // Non-transient error
        this.logger.error(`Message ${message.id}: unrecoverable error: ${error.message}`);
        await this.repository.markMessageProcessed(message.id);
      }
    }
  }

  private async processPayout(payoutId: string, message: { attempts: number }): Promise<void> {
    const payout = await this.repository.findPayoutById(payoutId);
    if (!payout) {
      throw new Error(`Payout ${payoutId} not found`);
    }

    // Idempotency check: if already completed or sent, skip
    if (payout.status === 'completed' || payout.status === 'sent') {
      this.logger.debug(`Payout ${payoutId} already ${payout.status}, skipping`);
      return;
    }

    // Update status to processing
    await this.repository.updatePayoutStatus(payoutId, 'processing');

    const result = await this.provider.transfer({
      to: payout.destinationAddress,
      amount: payout.amount,
    });

    // Transfer succeeded — update payout and finalize
    await this.repository.completePayout(payoutId, result.txHash);
  }
}
```

Wait, I need to be more careful. Let me re-read the error:

`src/payout/payout.worker.ts(108,21): error TS2352: Conversion of type 'Error' to type '{ code: string; }' may be a mistake`

This is at line 108, column 21. The fix is to use `as unknown as { code: string }` or to use a type guard. Let me use a proper approach:

```typescript
const error = err as unknown as { code?: string; message: string };
```

Or better, since we're checking for specific error codes:

```typescript
if (err instanceof Error) {
  // check err.message or a custom property
}
```

Actually, the cleanest fix for the TS2352 is:

```typescript
const errWithCode = err as unknown as { code?: string };
```

This converts through `unknown` first, which is what the compiler suggests.

Now let me also think about what types to import. The `payout.types` module likely exports:
- `PayoutMessageType` — an enum or const object for message types
- `MAX_RETRIES` — number
- `RETRY_DELAY_MS` — number

And maybe the payload types.

Let me also consider: the `markMessageProcessing` call is for at-least-once delivery. If the worker crashes after marking as processing but before completing, the message would be stuck in "processing" state. In a real system, you'd have a timeout to re-queue processing messages that have been stuck too long. But for this implementation, I'll keep it simple.

Actually wait - looking at the MessageStatus enum: `pending`, `processing`, `processed`. So the flow is:
1. Message starts as `pending`
2. Worker picks it up, marks as `processing` (this is the at-least-once guard)
3. Worker processes it
4. On success: mark as `processed`
5. On transient failure: set back to `pending` with incremented attempts and future `nextAttemptAt`

But wait, if we set it back to `pending`, another worker instance might pick it up again (at-least-once). That's fine for our purposes.

Actually, for the retry case, we should set the status back to `pending` and update `nextAttemptAt` and `attempts`. Let me adjust.

Let me also think about what the `completePayout` method in the repository would do:
1. Update payout status to 'sent' (or 'completed')
2. Update the account: decrease reserved balance, decrease settled balance (funds leave the system)
3. Create ledger entries:
   - Debit: customer account (reserve) → Credit: provider account (outbound)
   - Or: Debit: customer settled → Credit: provider settlement

Actually, from the plan: "The account's settled balance changes only when the provider confirms the transfer."

So the flow is:
1. Payout created: reservedBalance += amount (funds are reserved)
2. Transfer succeeds: settledBalance -= amount, reservedBalance -= amount (funds leave)

Wait, that doesn't quite work. Let me think again:

- When a payout is created: `reservedBalance += amount` (funds are held)
- When the transfer is confirmed: `reservedBalance -= amount` AND `settledBalance -= amount`

No wait. Let me think about this more carefully with double-entry:

At creation:
- Debit: Customer Available (asset) → Credit: Customer Reserved (liability/hold)
- Net effect on available balance: decreases by amount
- reservedBalance increases by amount

At transfer confirmation:
- Debit: Customer Reserved (liability/hold) → Credit: Provider Outbound (asset leaves system)
- Net effect: reservedBalance decreases by amount
- settledBalance... hmm

Actually, I think the model is:
- `settledBalance` = the balance that's been confirmed/settled
- `reservedBalance` = the amount currently held for in-progress payouts

When a payout is created:
- The available balance (which is settledBalance - reservedBalance) decreases
- reservedBalance increases

When the transfer completes:
- reservedBalance decreases (the hold is released)
- settledBalance decreases (the money actually left)

So: available = settledBalance - reservedBalance

At creation: reservedBalance += amount (available decreases)
At completion: reservedBalance -= amount, settledBalance -= amount (available stays the same relative to before creation... wait no)

Let me trace through:
- Start: settled=100, reserved=0, available=100
- Create payout for 30: settled=100, reserved=30, available=70
- Payout completes: settled=70, reserved=0, available=70

Yes! That works. The available balance goes from 100 → 70 when the payout is created, and stays at 70 after completion.

OK so the repository's `completePayout` would:
1. Update payout status to 'completed' (or 'sent' then 'completed')
2. Decrement account.settledBalance by amount
3. Decrement account.reservedBalance by amount
4. Create ledger entries

And the `markPayoutNeedsReview` would:
1. Update payout status to 'needs_review'
2. Do NOT change balances (funds remain reserved)

Now, for the worker, I need to be careful about what I'm importing. Let me look at what makes sense:

From `./payout.types`, I'll import:
- `PayoutMessageType` (a const or enum)
- `MAX_RETRIES`
- `RETRY_DELAY_MS`

I might also need a type for the message payload. Let me define it inline or import it.

Actually, I realize I should be more careful about what the `payout.types` module exports. Since I can't see it, I should add an ASSUMPTION comment if needed. But let me just use reasonable names and the compiler will tell us if they're wrong.

Let me also think about the message shape. The `Message` model has `payload Json`. So the payload is a JSON object. For a payout process message, it would be `{ payoutId: string }`.

Let me write the final version:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PayoutRepository } from './payout.repository';
import { PayoutProvider } from './payout.provider';
import { PayoutMessageType, MAX_RETRIES, RETRY_DELAY_MS } from './payout.types';

@Injectable()
export class PayoutWorker {
  private readonly logger = new Logger(PayoutWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly repository: PayoutRepository,
    private readonly provider: PayoutProvider,
  ) {}

  start(intervalMs = 5000): void {
    this.timer = setInterval(() => {
      this.processMessages().catch((err) => {
        this.logger.error(`Worker tick failed: ${err.message}`, err.stack);
      });
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processMessages(): Promise<void> {
    const messages = await this.repository.findPendingMessages(new Date());

    for (const message of messages) {
      await this.processMessage(message);
    }
  }

  private async processMessage(
    message: { id: string; type: string; payload: unknown; attempts: number },
  ): Promise<void> {
    await this.repository.markMessageProcessing(message.id);

    try {
      if (message.type === PayoutMessageType.PAYOUT_PROCESS) {
        const payload = message.payload as { payoutId: string };
        await this.processPayout(payload.payoutId);
      }

      await this.repository.markMessageProcessed(message.id);
    } catch (err) {
      const error = err as unknown as { code?: string; message: string };

      if (error.code === 'TRANSFER_FAILED' || error.code === 'TRANSFER_TIMEOUT') {
        const attempts = message.attempts + 1;

        if (attempts >= MAX_RETRIES) {
          const payload = message.payload as { payoutId: string };
          await this.repository.markPayoutNeedsReview(payload.payoutId);
          this.logger.warn(
            `Payout ${payload.payoutId}: ${attempts} retries exhausted without definitive outcome; marked needs_review. Funds remain reserved.`,
          );
          await this.repository.markMessageProcessed(message.id);
        } else {
          const nextAttemptAt = new Date(Date.now() + RETRY_DELAY_MS);
          await this.repository.scheduleRetry(message.id, attempts, nextAttemptAt);
          this.logger.warn(
            `Message ${message.id}: attempt ${attempts}/${MAX_RETRIES} failed, next retry at ${nextAttemptAt.toISOString()}`,
          );
        }
      } else {
        this.logger.error(
          `Message ${message.id}: unrecoverable error: ${error.message}`,
        );
        await this.repository.markMessageProcessed(message.id);
      }
    }
  }

  private async processPayout(payoutId: string): Promise<void> {
    const payout = await this.repository.findPayoutById(payoutId);

    if (!payout) {
      this.logger.error(`Payout ${payoutId} not found`);
      return;
    }

    // Idempotency: if already processed, skip (at-least-once delivery safety)
    if (payout.status === 'sent' || payout.status === 'completed') {
      this.logger.debug(`Payout ${payoutId} already ${payout.status}, skipping`);
      return;
    }

    await this.repository.updatePayoutStatus(payoutId, 'processing');

    const result = await this.provider.transfer({
      to: payout.destinationAddress,
      amount: payout.amount,
    });

    await this.repository.completePayout(payoutId, result.txHash);
  }
}
```

Hmm, but I need to check: does this fix all the errors in `payout.worker.ts`?

1. Line 2: `Cannot find module './payout.repository'` — This will be fixed when `payout.repository.ts` exists. My import is correct.
2. Line 3: `Cannot find module './payout.provider'` — Same, will be fixed when `payout.provider.ts` exists.
3. Line 4: `Cannot find module './payout.types'` — Same.
4. Line 108: TS2352 — Fixed by using `as unknown as { code?: string; message: string }` instead of `as { code: string }`.

Wait, but the TS2307 errors ARE in this file. If the modules don't exist, the file won't compile regardless of what I write in it. The task says "fixing what these messages require of this file." I think the intent is:
- The TS2307 errors will be resolved when the other files are created (which is presumably happening in parallel or in other tasks)
- My job is to make sure THIS file is correct, especially the TS2352 error

So my rewrite should:
1. Have correct imports (matching what the other files will export)
2. Fix the type cast error
3. Be a complete, working worker implementation

Let me also think about whether I need to add `onModuleInit`/`onModuleDestroy` for the lifecycle. In NestJS, you can use `OnModuleInit` and `OnModuleDestroy` interfaces. But the module might handle starting the worker. Let me keep it simple with explicit `start()`/`stop()` methods and also implement the NestJS lifecycle hooks.

Actually, looking at the module structure, the worker is listed as a provider. It might be started by the module or by main.ts. Let me add the lifecycle hooks to be safe:

```typescript
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
```

And implement `onModuleInit` and `onModuleDestroy`.

Actually, let me not over-engineer this. The plan says "a polling worker (`processMessages()` runs every N seconds)". Let me provide both the lifecycle hooks and the manual start/stop.

Wait, but if I add `OnModuleInit` and `OnModuleDestroy`, the worker would auto-start when the module initializes. That might conflict with tests. Let me just provide the explicit `start()`/`stop()` and let the module or main.ts decide when to start it. Or better, let me use the lifecycle hooks since that's the NestJS way.

Hmm, but the tests need to be able to call `processMessages()` directly. So having it as a public method is good regardless of whether it's auto-started.

Let me keep it simple: provide `processMessages()` as a public method, and `start()`/`stop()` for the interval. The module or app can call `start()` at boot.

Actually, I'll add `OnModuleInit` and `OnModuleDestroy` because that's idiomatic NestJS and the plan implies the worker runs automatically.

Let me finalize:

```typescript
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PayoutRepository } from './payout.repository';
import { PayoutProvider } from './payout.provider';
import { PayoutMessageType, MAX_RETRIES, RETRY_DELAY_MS } from './payout.types';

const WORKER_INTERVAL_MS = 5000;

@Injectable()
export class PayoutWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly repository: PayoutRepository,
    private readonly provider: PayoutProvider,
  ) {}

  onModuleInit(): void {
    this.start(WORKER_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(intervalMs: number): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.processMessages().catch((err) => {
        this.logger.error(`Worker tick failed: ${(err as Error).message}`, (err as Error).stack);
      });
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processMessages(): Promise<void> {
    const messages = await this.repository.findPendingMessages(new Date());

    for (const message of messages) {
      await this.processMessage(message);
    }
  }

  private async processMessage(
    message: { id: string; type: string; payload: unknown; attempts: number },
  ): Promise<void> {
    // Claim the message to handle at-least-once delivery safely
    await this.repository.markMessageProcessing(message.id);

    try {
      if (message.type === PayoutMessageType.PAYOUT_PROCESS) {
        const payload = message.payload as { payoutId: string };
        await this.processPayout(payload.payoutId);
      }

      await this.repository.markMessageProcessed(message.id);
    } catch (err) {
      const error = err as unknown as { code?: string; message: string };

      if (error.code === 'TRANSFER_FAILED' || error.code === 'TRANSFER_TIMEOUT') {
        const attempts = message.attempts + 1;

        if (attempts >= MAX_RETRIES) {
          const payload = message.payload as { payoutId: string };
          // Safe choice: mark needs_review. We do NOT know if the transfer
          // landed on-chain, so we must not release the reservation or
          // double-spend. An operator must reconcile manually.
          await this.repository.markPayoutNeedsReview(payload.payoutId);
          this.logger.warn(
            `Payout ${payload.payoutId}: ${attempts} retries exhausted without definitive outcome; marked needs_review. Funds remain reserved.`,
          );
          await this.repository.markMessageProcessed(message.id);
        } else {
          const nextAttemptAt = new Date(Date.now() + RETRY_DELAY_MS);
          await this.repository.scheduleRetry(message.id, attempts, nextAttemptAt);
          this.logger.warn(
            `Message ${message.id}: attempt ${attempts}/${MAX_RETRIES} failed, retrying at ${nextAttemptAt.toISOString()}`,
          );
        }
      } else {
        this.logger.error(
          `Message ${message.id}: unrecoverable error: ${error.message}`,
        );
        await this.repository.markMessageProcessed(message.id);
      }
    }
  }

  private async processPayout(payoutId: string): Promise<void> {
    const payout = await this.repository.findPayoutById(payoutId);

    if (!payout) {
      this.logger.error(`Payout ${payoutId} not found; cannot process`);
      return;
    }

    // Idempotency guard for at-least-once delivery:
    // if the transfer already completed, do nothing.
    if (payout.status === 'sent' || payout.status === 'completed') {
      this.logger.debug(`Payout ${payoutId} already ${payout.status}; skipping`);
      return;
    }

    await this.repository.updatePayoutStatus(payoutId, 'processing');

    const { txHash } = await this.provider.transfer({
      to: payout.destinationAddress,
      amount: payout.amount,
    });

    await this.repository.completePayout(payoutId, txHash);
  }
}
```

This looks good. Let me double-check against the errors:

1. `src/payout/payout.worker.ts(2,34): error TS2307: Cannot find module './payout.repository'` — My import on line 2 is `import { PayoutRepository } from './payout.repository';`. This is correct; the error will go away when the file exists.

2. `src/payout/payout.worker.ts(3,32): error TS2307: Cannot find module './payout.provider'` — My import on line 3 is `import { PayoutProvider } from './payout.provider';`. Correct.

3. `src/payout/payout.worker.ts(4,38): error TS2307: Cannot find module './payout.types'` — My import on line 4 is `import { PayoutMessageType, MAX_RETRIES, RETRY_DELAY_MS } from './payout.types';`. Correct.

4. `src/payout/payout.worker.ts(108,21): error TS2352` — I use `err as unknown as { code?: string; message: string }` which is the correct pattern.

I think this is solid. Let me also make sure I'm not violating any conventions:
- File naming: `payout.worker.ts` ✓ (kebab-case.role.ts)
- Class naming: `PayoutWorker` ✓ (PascalCase)
- No raw SQL, no Prisma client calls ✓ (all DB access through repository)
- Business logic in service... well, the worker has some logic but it's orchestration logic specific to the async processing, which is appropriate for a worker
- ESM compatible (no `require`) ✓

One thing: should I add an `// ASSUMPTION:` line? The instructions say: "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly."

I can't see the exact exports of `payout.repository`, `payout.provider`, or `payout.types`. I'm making assumptions about:
- `PayoutRepository` exports a class with methods: `findPendingMessages`, `markMessageProcessing`, `markMessageProcessed`, `scheduleRetry`, `findPayoutById`, `updatePayoutStatus`, `completePayout`, `markPayoutNeedsReview`
- `PayoutProvider` exports a class with method: `transfer({to, amount}) -> {txHash}`
- `PayoutMessageType` is an enum/const with `PAYOUT_PROCESS`
- `MAX_RETRIES` is a number
- `RETRY_DELAY_MS` is a number

I should add one ASSUMPTION line to note this. Let me add it at the top of the file.

Actually, re-reading the instruction: "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly." The TS2307 messages refer to modules I can't see. So I should add an assumption.

Let me add: `// ASSUMPTION: payout.repository, payout.provider, and payout.types modules are expected to exist with the named exports used here.`

That's one line covering all three. Good.

Let me finalize the file.
```

## reply

```typescript
// ASSUMPTION: payout.repository, payout.provider, and payout.types modules are expected to exist with the named exports used here.
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PayoutRepository } from './payout.repository';
import { PayoutProvider } from './payout.provider';
import { PayoutMessageType, MAX_RETRIES, RETRY_DELAY_MS } from './payout.types';

const WORKER_INTERVAL_MS = 5000;

@Injectable()
export class PayoutWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly repository: PayoutRepository,
    private readonly provider: PayoutProvider,
  ) {}

  onModuleInit(): void {
    this.start(WORKER_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(intervalMs: number): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.processMessages().catch((err) => {
        this.logger.error(`Worker tick failed: ${(err as Error).message}`, (err as Error).stack);
      });
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processMessages(): Promise<void> {
    const messages = await this.repository.findPendingMessages(new Date());

    for (const message of messages) {
      await this.processMessage(message);
    }
  }

  private async processMessage(
    message: { id: string; type: string; payload: unknown; attempts: number },
  ): Promise<void> {
    // Claim the message to handle at-least-once delivery safely
    await this.repository.markMessageProcessing(message.id);

    try {
      if (message.type === PayoutMessageType.PAYOUT_PROCESS) {
        const payload = message.payload as { payoutId: string };
        await this.processPayout(payload.payoutId);
      }

      await this.repository.markMessageProcessed(message.id);
    } catch (err) {
      const error = err as unknown as { code?: string; message: string };

      if (error.code === 'TRANSFER_FAILED' || error.code === 'TRANSFER_TIMEOUT') {
        const attempts = message.attempts + 1;

        if (attempts >= MAX_RETRIES) {
          const payload = message.payload as { payoutId: string };
          // Safe choice: mark needs_review. We do NOT know if the transfer
          // landed on-chain, so we must not release the reservation or
          // double-spend. An operator must reconcile manually.
          await this.repository.markPayoutNeedsReview(payload.payoutId);
          this.logger.warn(
            `Payout ${payload.payoutId}: ${attempts} retries exhausted without definitive outcome; marked needs_review. Funds remain reserved.`,
          );
          await this.repository.markMessageProcessed(message.id);
        } else {
          const nextAttemptAt = new Date(Date.now() + RETRY_DELAY_MS);
          await this.repository.scheduleRetry(message.id, attempts, nextAttemptAt);
          this.logger.warn(
            `Message ${message.id}: attempt ${attempts}/${MAX_RETRIES} failed, retrying at ${nextAttemptAt.toISOString()}`,
          );
        }
      } else {
        this.logger.error(
          `Message ${message.id}: unrecoverable error: ${error.message}`,
        );
        await this.repository.markMessageProcessed(message.id);
      }
    }
  }

  private async processPayout(payoutId: string): Promise<void> {
    const payout = await this.repository.findPayoutById(payoutId);

    if (!payout) {
      this.logger.error(`Payout ${payoutId} not found; cannot process`);
      return;
    }

    // Idempotency guard for at-least-once delivery:
    // if the transfer already completed, do nothing.
    if (payout.status === 'sent' || payout.status === 'completed') {
      this.logger.debug(`Payout ${payoutId} already ${payout.status}; skipping`);
      return;
    }

    await this.repository.updatePayoutStatus(payoutId, 'processing');

    const { txHash } = await this.provider.transfer({
      to: payout.destinationAddress,
      amount: payout.amount,
    });

    await this.repository.completePayout(payoutId, txHash);
  }
}
```
