# repair1-payout.worker.ts

## reasoning

```
Let me analyze the compiler errors that relate to `src/payout/payout.worker.ts`:

1. `src/payout/payout.worker.ts(3,34): error TS2307: Cannot find module './payout.repository' or its corresponding type declarations.`
2. `src/payout/payout.worker.ts(4,49): error TS2307: Cannot find module './payout.provider' or its corresponding type declarations.`
3. `src/payout/payout.worker.ts(5,75): error TS2307: Cannot find module './payout.types' or its corresponding type declarations.`

These are "Cannot find module" errors. The files `payout.repository`, `payout.provider`, and `payout.types` don't exist (or can't be found). The task says "Change nothing the messages do not name." So I need to fix the imports in `payout.worker.ts`.

Wait, but the task says "Rewrite `src/payout/payout.worker.ts` complete, fixing what these messages require of this file." So I need to make this file compile. The errors for this file are:
- Cannot find module './payout.repository'
- Cannot find module './payout.provider'
- Cannot find module './payout.types'

But I don't have the content of the existing `payout.worker.ts`. I need to infer what it should contain based on:
- The variant requirements (async processing via message table, polling worker with `processMessages()`, retry logic, at-least-once delivery)
- The Prisma schema (Message model with status, attempts, nextAttemptAt, etc.)
- The other files that reference it (test file imports from `payout.worker`)
- The PLAN.md which I don't have but the task says "still governs"

The task says "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly."

I don't have the existing `payout.worker.ts`, `payout.repository.ts`, `payout.provider.ts`, or `payout.types.ts`. I need to write `payout.worker.ts` that imports from these modules.

The errors say the modules can't be found. But the task says "Change nothing the messages do not name." The messages name `payout.worker.ts` as the file to fix. The "Cannot find module" errors mean the imported files don't exist or the paths are wrong.

Wait, looking more carefully at the other errors:
- `src/payout/payout.service.ts(2,34): error TS2307: Cannot find module './payout.repository'` - same module
- `src/payout/payout.repository.ts(79,7): error TS2322` - this file EXISTS and has type errors
- `test/payout.spec.ts(4,34): error TS2307: Cannot find module '../src/payout/payout.repository'`

So `payout.repository.ts` exists (it has type errors on lines 79, 178, 220) but can't be found by imports? That's strange. Maybe it's a compilation error in that file that prevents it from being resolved? Or maybe the file is in a different location.

Actually wait - looking at the error for `payout.repository.ts(79,7)`, the file clearly exists and is being compiled. The "Cannot find module" errors for `./payout.repository` from other files might be because the file has its own compilation errors that prevent it from being a valid module export.

But the task says "Change nothing the messages do not name." The messages name `payout.worker.ts` as the file to rewrite. So I should fix `payout.worker.ts` to address the errors that are specifically attributed to it.

The errors attributed to `payout.worker.ts` are only the three "Cannot find module" errors. These are import resolution failures. The fix would be to ensure the imports point to files that exist and compile.

But I can't create those other files (the task says only rewrite `payout.worker.ts`). And I can't change the other files.

Hmm, let me re-read: "Rewrite `src/payout/payout.worker.ts` complete, fixing what these messages require of this file."

So the messages that reference `payout.worker.ts` are:
1. Line 3, col 34: Cannot find module './payout.repository'
2. Line 4, col 49: Cannot find module './payout.provider'
3. Line 5, col 75: Cannot find module './payout.types'

The fix for "Cannot find module" in a file is typically:
- The file doesn't exist (can't fix from here)
- The import path is wrong
- The file exists but has errors that prevent it from being a valid module

Since `payout.repository.ts` clearly exists (it has errors on lines 79, 178, 220), the "Cannot find module" error is likely because the file itself has compilation errors that prevent it from being resolved as a valid module.

But I can only change `payout.worker.ts`. What can I do?

One approach: use `// @ts-ignore` or `// @ts-expect-error` to suppress the errors. But that feels wrong.

Another approach: The task says "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly."

I think the right approach here is:
1. Write the complete `payout.worker.ts` with the correct logic
2. Add `// ASSUMPTION:` comments noting that the imported modules have their own compilation errors that prevent them from being resolved

Actually, wait. Let me reconsider. The task says "fixing what these messages require of this file." The messages require that the modules be found. Since I can't create those files, and the existing ones have their own errors, I need to acknowledge this.

But actually, maybe the "Cannot find module" errors will resolve once the other files are fixed (by someone else). In that case, my job is just to write `payout.worker.ts` correctly assuming those modules will exist and export the right things.

Let me think about what the worker should do based on the requirements:
- Polls the message table every N seconds
- Processes messages (payout transfers)
- At-least-once delivery (may see same message more than once)
- Retries bounded number of times
- If retries exhausted without definitive outcome, do something safe (mark as needs_review)

The worker needs:
- A `PayoutRepository` for database operations
- A `PayoutProvider` (the blockchain SDK wrapper)
- Types for the message payload

Let me think about what the worker class should look like:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PayoutRepository } from './payout.repository';
import { PayoutProvider } from './payout.provider';
import { PayoutStatus, MessageStatus, PayoutMessagePayload } from './payout.types';

@Injectable()
export class PayoutWorker {
  private readonly logger = new Logger(PayoutWorker.name);
  private readonly MAX_ATTEMPTS = 3;

  constructor(
    private readonly repository: PayoutRepository,
    private readonly provider: PayoutProvider,
  ) {}

  async processMessages(): Promise<void> {
    const messages = await this.repository.findPendingMessages();
    for (const message of messages) {
      try {
        await this.processMessage(message);
      } catch (error) {
        this.logger.error(`Failed to process message ${message.id}: ${error}`);
      }
    }
  }

  private async processMessage(message: { id: string; payload: any; attempts: number }): Promise<void> {
    const payload = message.payload as PayoutMessagePayload;
    
    // Mark as processing (claim the message)
    const claimed = await this.repository.claimMessage(message.id);
    if (!claimed) return; // Another worker got it

    try {
      const result = await this.provider.transfer({
        to: payload.destinationAddress,
        amount: payload.amount,
      });
      
      // Transfer succeeded - mark payout as sent/completed
      await this.repository.completePayout(payload.payoutId, result.txHash);
      await this.repository.markMessageProcessed(message.id);
    } catch (error) {
      const isTransient = /* check if error is transient */;
      if (isTransient && message.attempts < this.MAX_ATTEMPTS) {
        await this.repository.incrementMessageAttempts(message.id);
      } else if (isTransient) {
        // Exhausted retries - mark as needs_review (safe: don't assume sent)
        await this.repository.markPayoutNeedsReview(payload.payoutId);
        await this.repository.markMessageProcessed(message.id);
      } else {
        // Definitive failure
        await this.repository.markPayoutFailed(payload.payoutId);
        await this.repository.markMessageProcessed(message.id);
      }
    }
  }
}
```

Now, I don't know the exact shapes of `PayoutRepository`, `PayoutProvider`, or the types. Let me add ASSUMPTION comments.

Looking at the test file errors:
- `test/payout.spec.ts(48,5): error TS2353: Object literal may only specify known properties, and 'transfer' does not exist in type 'TestProvider'.`

This tells me that `TestProvider` is a type used in tests, and the provider interface should have a `transfer` method. The test is creating a mock with `{ transfer: ... }` but `TestProvider` doesn't have it. This suggests `TestProvider` is defined somewhere (maybe in `payout.types` or inline in the test) and doesn't match the actual provider interface.

From the variant description: `provider.transfer({to, amount}) -> {txHash}`

So the provider interface is:
```typescript
interface PayoutProvider {
  transfer(params: { to: string; amount: bigint }): Promise<{ txHash: string }>;
}
```

For the repository, I need methods that the worker calls. Based on the schema:
- Find pending messages (status = 'pending', nextAttemptAt <= now)
- Claim a message (set status to 'processing')
- Mark message as processed
- Increment message attempts (and update nextAttemptAt)
- Update payout status
- Record ledger entries (for the double-entry bookkeeping when transfer completes)

Let me think about what `payout.types` would export. It probably exports:
- `PayoutStatus` enum or type
- `MessageStatus` enum or type  
- `PayoutMessagePayload` type
- Maybe `PayoutProvider` interface

Actually, looking at the import in the worker: `import { PayoutStatus, MessageStatus, PayoutMessagePayload } from './payout.types';` - but I'm making up the import. Let me think about what makes sense.

Actually, I realize I'm overthinking this. The task says to fix the compilation errors in `payout.worker.ts`. The errors are "Cannot find module" for three imports. Since I can't create those modules (task says only rewrite this file), and the existing modules have their own errors, I should:

1. Write the worker with the correct logic
2. Keep the imports (they're correct - the modules should exist)
3. Add ASSUMPTION comments where I'm guessing at shapes

The "Cannot find module" errors will resolve when the other files are fixed. My job is to make sure THIS file is correct.

Let me write a complete, well-structured worker:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PayoutRepository } from './payout.repository';
import { PayoutProvider } from './payout.provider';
import { PayoutMessagePayload } from './payout.types';

@Injectable()
export class PayoutWorker {
  private readonly logger = new Logger(PayoutWorker.name);
  private static readonly MAX_ATTEMPTS = 3;
  private static readonly RETRY_DELAY_MS = 5_000;

  constructor(
    private readonly repository: PayoutRepository,
    private readonly provider: PayoutProvider,
  ) {}

  /**
   * Polls for pending messages and processes them.
   * Called externally on an interval (every N seconds).
   */
  async processMessages(): Promise<void> {
    const messages = await this.repository.findPendingMessages();
    for (const message of messages) {
      try {
        await this.processMessage(message);
      } catch (err) {
        this.logger.error(
          `Unexpected error processing message ${message.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  private async processMessage(message: {
    id: string;
    payload: PayoutMessagePayload;
    attempts: number;
  }): Promise<void> {
    // Atomically claim the message to prevent concurrent processing
    const claimed = await this.repository.claimMessage(message.id);
    if (!claimed) {
      return; // Another worker instance already claimed it
    }

    const { payoutId, destinationAddress, amount } = message.payload;

    try {
      const { txHash } = await this.provider.transfer({
        to: destinationAddress,
        amount,
      });

      // Transfer confirmed by provider — settle the ledger and mark completed
      await this.repository.completePayout(payoutId, txHash);
      await this.repository.markMessageProcessed(message.id);
    } catch (err) {
      const isDefinitive = this.isDefinitiveFailure(err);

      if (isDefinitive) {
        // Provider definitively rejected — mark failed, release reservation
        await this.repository.failPayout(payoutId);
        await this.repository.markMessageProcessed(message.id);
      } else if (message.attempts + 1 >= PayoutWorker.MAX_ATTEMPTS) {
        // Exhausted retries without a definitive outcome.
        // Safe action: mark needs_review so a human can inspect.
        // We do NOT assume the transfer succeeded or failed.
        // The reservation stays in place so the account cannot be overdrawn.
        await this.repository.markPayoutNeedsReview(payoutId);
        await this.repository.markMessageProcessed(message.id);
      } else {
        // Transient failure — schedule retry with backoff
        await this.repository.scheduleRetry(message.id, PayoutWorker.RETRY_DELAY_MS);
      }
    }
  }

  /**
   * Determines whether a provider error is a definitive rejection
   * (e.g., invalid address, insufficient provider balance) vs.
   * a transient failure (timeout, network error, 5xx).
   */
  private isDefinitiveFailure(err: unknown): boolean {
    // ASSUMPTION: The provider SDK throws errors with a `code` property
    // for definitive failures (e.g., 'INVALID_ADDRESS', 'INSUFFICIENT_FUNDS').
    // Transient failures (timeouts, network errors) lack this property or
    // carry a retryable code.
    if (err instanceof Error && 'code' in err) {
      const code = (err as { code: string }).code;
      // ASSUMPTION: These codes indicate definitive, non-retryable failures
      const definitiveCodes = ['INVALID_ADDRESS', 'INSUFFICIENT_FUNDS', 'REJECTED'];
      return definitiveCodes.includes(code);
    }
    return false;
  }
}
```

Wait, but I need to be careful. The task says "Change nothing the messages do not name." The messages only name errors in `payout.worker.ts` lines 3, 4, 5 (the imports). But I'm rewriting the whole file. Let me re-read the task:

"Rewrite `src/payout/payout.worker.ts` complete, fixing what these messages require of this file."

So I'm rewriting the complete file. The messages require that the module imports work. Since I can't make the other files exist, I'll keep the imports correct and add ASSUMPTION comments.

Actually, I just realized - maybe the "Cannot find module" errors are because the files genuinely don't exist yet (they're supposed to be created as part of the full solution). In that case, the worker file is being written before its dependencies exist. The fix is simply to have the correct import statements, and the errors will go away once those files are created.

Let me finalize my approach:
1. Write a complete, correct `payout.worker.ts`
2. The imports will reference `./payout.repository`, `./payout.provider`, `./payout.types`
3. Add `// ASSUMPTION:` comments where I'm guessing at the exact shapes of those modules

Let me also think about what the `PayoutMessagePayload` type would look like. Based on the message being created when a payout is created:
```typescript
interface PayoutMessagePayload {
  payoutId: string;
  destinationAddress: string;
  amount: bigint;
}
```

And the `PayoutProvider`:
```typescript
interface PayoutProvider {
  transfer(params: { to: string; amount: bigint }): Promise<{ txHash: string }>;
}
```

And `PayoutRepository` methods I need:
- `findPendingMessages(): Promise<Array<{ id: string; payload: PayoutMessagePayload; attempts: number }>>`
- `claimMessage(id: string): Promise<boolean>`
- `markMessageProcessed(id: string): Promise<void>`
- `scheduleRetry(id: string, delayMs: number): Promise<void>`
- `completePayout(payoutId: string, txHash: string): Promise<void>`
- `failPayout(payoutId: string): Promise<void>`
- `markPayoutNeedsReview(payoutId: string): Promise<void>`

Let me write the final version. I'll keep it clean and focused.
```

## reply

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PayoutRepository } from './payout.repository';
import { PayoutProvider } from './payout.provider';
import { PayoutMessagePayload } from './payout.types';

// ASSUMPTION: PayoutRepository exposes the following methods:
//   findPendingMessages(): Promise<Array<{ id: string; payload: PayoutMessagePayload; attempts: number }>>
//   claimMessage(id: string): Promise<boolean>
//   markMessageProcessed(id: string): Promise<void>
//   scheduleRetry(id: string, delayMs: number): Promise<void>
//   completePayout(payoutId: string, txHash: string): Promise<void>
//   failPayout(payoutId: string): Promise<void>
//   markPayoutNeedsReview(payoutId: string): Promise<void>

// ASSUMPTION: PayoutProvider exposes:
//   transfer(params: { to: string; amount: bigint }): Promise<{ txHash: string }>

// ASSUMPTION: PayoutMessagePayload is:
//   { payoutId: string; destinationAddress: string; amount: bigint }

@Injectable()
export class PayoutWorker {
  private readonly logger = new Logger(PayoutWorker.name);
  private static readonly MAX_ATTEMPTS = 3;
  private static readonly RETRY_DELAY_MS = 5_000;

  constructor(
    private readonly repository: PayoutRepository,
    private readonly provider: PayoutProvider,
  ) {}

  /**
   * Polls for pending messages and processes them.
   * Intended to be called externally on a fixed interval (every N seconds).
   * Delivery is at-least-once: the same message may be seen more than once
   * if a crash occurs between the provider call and the status update.
   */
  async processMessages(): Promise<void> {
    const messages = await this.repository.findPendingMessages();
    for (const message of messages) {
      try {
        await this.processMessage(message);
      } catch (err) {
        this.logger.error(
          `Unexpected error processing message ${message.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  private async processMessage(message: {
    id: string;
    payload: PayoutMessagePayload;
    attempts: number;
  }): Promise<void> {
    // Atomically claim the message (status pending → processing).
    // If another worker already claimed it, skip.
    const claimed = await this.repository.claimMessage(message.id);
    if (!claimed) {
      return;
    }

    const { payoutId, destinationAddress, amount } = message.payload;

    try {
      const { txHash } = await this.provider.transfer({
        to: destinationAddress,
        amount,
      });

      // Provider confirmed the transfer. Settle the ledger and mark completed.
      await this.repository.completePayout(payoutId, txHash);
      await this.repository.markMessageProcessed(message.id);
    } catch (err) {
      const definitive = this.isDefinitiveFailure(err);

      if (definitive) {
        // Provider definitively rejected (e.g. invalid address).
        // Release the reservation and mark the payout as failed.
        await this.repository.failPayout(payoutId);
        await this.repository.markMessageProcessed(message.id);
      } else if (message.attempts + 1 >= PayoutWorker.MAX_ATTEMPTS) {
        // Retries exhausted without a definitive outcome.
        // Safe action: mark needs_review so a human can investigate.
        // The reservation is NOT released — the account balance stays
        // protected until the outcome is confirmed.
        await this.repository.markPayoutNeedsReview(payoutId);
        await this.repository.markMessageProcessed(message.id);
      } else {
        // Transient failure (timeout, network, 5xx).
        // Release the claim and schedule a retry with backoff.
        await this.repository.scheduleRetry(message.id, PayoutWorker.RETRY_DELAY_MS);
      }
    }
  }

  /**
   * Returns true if the error represents a definitive, non-retryable
   * rejection from the provider (as opposed to a transient failure
   * such as a timeout or network hiccup).
   */
  private isDefinitiveFailure(err: unknown): boolean {
    // ASSUMPTION: The provider SDK attaches a `code` string property to
    // errors for definitive failures (e.g. 'INVALID_ADDRESS', 'REJECTED').
    // Transient errors (timeouts, socket errors) either lack a `code`
    // property or carry a code not in the definitive set.
    if (err instanceof Error && typeof (err as { code?: string }).code === 'string') {
      const code = (err as { code: string }).code;
      const definitiveCodes = ['INVALID_ADDRESS', 'INSUFFICIENT_FUNDS', 'REJECTED'];
      return definitiveCodes.includes(code);
    }
    return false;
  }
}
```
