# repair1-payout.worker.ts

## reasoning

```
Let me analyze the compiler errors that relate to `src/payout/payout.worker.ts`:

1. `src/payout/payout.worker.ts(4,34): error TS2307: Cannot find module './payout.repository' or its corresponding type declarations.`
2. `src/payout/payout.worker.ts(5,76): error TS2307: Cannot find module './payout.provider' or its corresponding type declarations.`
3. `src/payout/payout.worker.ts(6,63): error TS2307: Cannot find module './payout.provider' or its corresponding type declarations.`
4. `src/payout/payout.worker.ts(7,34): error TS2307: Cannot find module './payout.types' or its corresponding type declarations.`

So the worker file imports from:
- `./payout.repository` (line 4)
- `./payout.provider` (line 5) - two imports
- `./payout.types` (line 7)

These modules don't exist. The task says "Rewrite `src/payout/payout.worker.ts` complete, fixing what these messages require of this file."

The messages require that the file imports from `./payout.repository`, `./payout.provider` (twice), and `./payout.types`. Since these modules don't exist, I need to either:
1. Create those modules (but the task says "Change nothing the messages do not name" — it says to rewrite `src/payout/payout.worker.ts` only)
2. Or add `// ASSUMPTION:` lines explaining what I couldn't reconcile

Wait, let me re-read the instructions: "Rewrite `src/payout/payout.worker.ts` complete, fixing what these messages require of this file."

The messages for this file are:
- Line 4: Cannot find module './payout.repository'
- Line 5: Cannot find module './payout.provider' (two imports on the same line)
- Line 6: Cannot find module './payout.provider'
- Line 7: Cannot find module './payout.types'

The instruction says: "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly."

So the issue is that the modules `./payout.repository`, `./payout.provider`, and `./payout.types` don't exist. I can't see their shapes. I need to write the worker file that would work IF those modules existed, and add `// ASSUMPTION:` lines for the shapes I'm assuming.

But wait — the task says "Change nothing the messages do not name." The messages name imports in `payout.worker.ts`. The fix is to rewrite the file. But the imports reference non-existent modules. 

Let me think about this differently. The file `src/payout/payout.worker.ts` is the file I need to write. It should:
- Import from `./payout.repository` 
- Import from `./payout.provider`
- Import from `./payout.types`

Since those modules don't exist (they're listed as errors in other files too), I need to assume their shapes. The `// ASSUMPTION:` instruction applies here.

Let me think about what the worker needs based on the variant-a requirements:

1. The worker polls messages from a message table
2. For each message, it processes the payout (calls the provider)
3. It handles at-least-once delivery (idempotent processing)
4. It retries bounded number of times on transient failures
5. If retries are exhausted, it does something safe

Based on the architecture:
- `payout.repository` - the repository that touches the database
- `payout.provider` - the blockchain provider SDK wrapper
- `payout.types` - shared types

Let me think about what the worker needs:

From the repository, the worker would need methods like:
- `fetchPendingMessages()` or `claimMessages()` - to get messages to process
- `markMessageProcessed(messageId, result)` - to mark as done
- `markPayoutStatus(payoutId, status)` - to update payout lifecycle

From the provider:
- `transfer({to, amount})` - the blockchain transfer
- Some interface for the provider

From types:
- Message types, PayoutStatus enum, etc.

Now, looking at the error messages more carefully:

Line 4, column 34: `Cannot find module './payout.repository'`
Line 5, column 76: `Cannot find module './payout.provider'`
Line 6, column 63: `Cannot find module './payout.provider'`
Line 7, column 34: `Cannot find module './payout.types'`

The column numbers tell me something about the import statements. Let me think about what imports would be on those lines.

Line 4, col 34: This is where the module path starts in `from './payout.repository'`. If line 4 is `import { PayoutRepository } from './payout.repository';`, let me count:
`import { PayoutRepository } from ` - that's 33 characters, so col 34 would be the start of `'./payout.repository'`. Yes, that works.

Line 5, col 76: `import { X, Y } from './payout.provider'` - col 76 would be where the module path starts. Let me think... if it's importing two things from the provider on the same line.

Actually wait, line 5 and line 6 both import from `'./payout.provider'`. So there are two separate import statements from the provider module.

Line 5, col 76: The module path `./payout.provider` starts at column 76. So the part before it is 75 characters.
`import { SomethingLong, AnotherThing } from ` - let me count...

Actually, let me think about this differently. The exact column positions tell me the import structure:

Line 4: `import { PayoutRepository } from './payout.repository';`
- `import { PayoutRepository } from ` = 33 chars, so col 34 is the `'` of the module path. ✓

Line 5: Something from `'./payout.provider'` where the path starts at col 76.
- So the part before `from '` is 75 chars.
- `import {` = 8 chars, then the named imports, then `} from ` = 7 chars
- So named imports take 75 - 8 - 7 = 60 chars? That seems like a lot.
- Wait: `import { ... } from ` - the `...` part. Let me recalculate.
- `import {` (8) + named imports + `} from ` (7) = 75 total before the quote
- So named imports = 75 - 8 - 7 = 60 characters

Hmm, that's a lot. Maybe it's something like `import { PayoutProvider, ProviderTransferParams } from './payout.provider';`

Let me count: `import { PayoutProvider, ProviderTransferParams } from ` 
- `import { ` = 9
- `PayoutProvider, ProviderTransferParams ` = 39
- `} from ` = 7
- Total = 55, so col would be 56, not 76.

That doesn't match. Let me try different names.

Actually wait, maybe I'm overthinking the column positions. The task says to rewrite the file, not to reverse-engineer exact import names from column positions. The key requirement is:

1. The file must import from `./payout.repository`, `./payout.provider` (two imports), and `./payout.types`
2. The imports must reference shapes that make sense for a payout worker
3. I should add `// ASSUMPTION:` lines for shapes I can't see

Let me just write a sensible worker that:
- Imports a repository (for message claiming and status updates)
- Imports a provider interface and a provider class/token (two imports from the same module)
- Imports types
- Implements the polling worker with at-least-once safety and bounded retries

For the two imports from `./payout.provider`:
- One could be the provider class/interface (e.g., `PayoutProvider`)
- The other could be a token or interface for injection (e.g., `PROVIDER` token or `PayoutProviderOptions`)

Actually, looking at NestJS DI patterns, a common pattern is:
```typescript
import { PayoutProvider } from './payout.provider';
import { PROVIDER_OPTIONS } from './payout.provider';
```

Or maybe:
```typescript
import { PayoutProvider, ProviderTransfer } from './payout.provider';
```

Let me think about what makes sense for the worker:

The worker needs:
1. To claim pending messages from the message table (repository)
2. To call the provider to execute the transfer (provider)
3. To update payout status and message status (repository)
4. To handle the lifecycle transitions (types)

For the provider, the worker needs:
- The provider service (injected) - to call `transfer()`
- Maybe a config for max retries (could come from the provider module or from env)

Actually, re-reading the requirements: "Retry a bounded number of times; if you exhaust retries without a definitive outcome, do something safe and explain why."

The safe thing when exhausted without a definitive outcome is to mark the payout as `needs-review` (or `failed` with a specific flag) — because the transfer might have actually gone through on the blockchain but we didn't get a confirmation. Marking it as "failed" when it might have succeeded would be unsafe (double-spend risk on retry). Marking it as "needs-review" is safe because a human checks before retrying.

Let me now write the worker. I'll use reasonable names and add ASSUMPTION lines where I'm guessing at the shapes of the other modules.

Here's my plan for the file:

```typescript
// ASSUMPTION: PayoutRepository exposes claimPendingMessages(batchSize) and 
// markMessageProcessed(messageId, { status, txHash? }), markMessageFailed(messageId, { attempts }),
// and markPayoutStatus(payoutId, status, txHash?).
// ASSUMPTION: PayoutProvider exposes transfer(params: { to: string; amount: bigint }): Promise<{ txHash: string }>.
// ASSUMPTION: PayoutStatus is an enum with values: CREATED, PROCESSING, SENT, COMPLETED, FAILED, NEEDS_REVIEW.

import { Injectable, Logger } from '@nestjs/common';
import { PayoutRepository } from './payout.repository';
import { PayoutProvider, ProviderTransferParams } from './payout.provider';
import { PayoutStatus, OutboxMessage } from './payout.types';

const MAX_RETRIES = 3;
const POLL_INTERVAL_MS = 5000;
const BATCH_SIZE = 10;

@Injectable()
export class PayoutWorker {
  private readonly logger = new Logger(PayoutWorker.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly repository: PayoutRepository,
    private readonly provider: PayoutProvider,
  ) {}

  start(): void {
    this.timer = setInterval(() => {
      this.processMessages().catch(err => this.logger.error(err));
    }, POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processMessages(): Promise<void> {
    const messages = await this.repository.claimPendingMessages(BATCH_SIZE);
    for (const message of messages) {
      await this.processMessage(message);
    }
  }

  private async processMessage(message: OutboxMessage): Promise<void> {
    try {
      await this.repository.markPayoutStatus(message.payoutId, PayoutStatus.PROCESSING);

      const params: ProviderTransferParams = {
        to: message.destinationAddress,
        amount: message.amount,
      };

      const result = await this.attemptTransferWithRetry(params, message);
      // result is either the txHash or null (meaning exhausted retries)

      if (result) {
        await this.repository.markPayoutStatus(message.payoutId, PayoutStatus.COMPLETED, result);
        await this.repository.markMessageProcessed(message.id, { status: 'processed' });
      } else {
        await this.repository.markPayoutStatus(message.payoutId, PayoutStatus.NEEDS_REVIEW);
        await this.repository.markMessageProcessed(message.id, { status: 'needs_review' });
      }
    } catch (err) {
      this.logger.error(`Failed to process message ${message.id}: ${err}`);
    }
  }

  private async attemptTransferWithRetry(
    params: ProviderTransferParams,
    message: OutboxMessage,
  ): Promise<string | null> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const { txHash } = await this.provider.transfer(params);
        return txHash;
      } catch (err) {
        this.logger.warn(`Transfer attempt ${attempt + 1}/${MAX_RETRIES} failed: ${err}`);
        if (attempt === MAX_RETRIES - 1) {
          // Exhausted retries without definitive outcome.
          // Safe choice: mark as needs-review rather than failed,
          // because the transfer may have succeeded on-chain but we lost the response.
          return null;
        }
      }
    }
    return null;
  }
}
```

Wait, but I need to be careful. The task says "Change nothing the messages do not name." The messages for `payout.worker.ts` are:
- Line 4: Cannot find module './payout.repository'
- Line 5: Cannot find module './payout.provider' (col 76)
- Line 6: Cannot find module './payout.provider' (col 63)
- Line 7: Cannot find module './payout.types'

These are all "Cannot find module" errors. The fix is to ensure the imports resolve. But since the modules don't exist, I can't fix the module resolution from within this file alone. 

Hmm, but the task says "Rewrite `src/payout/payout.worker.ts` complete, fixing what these messages require of this file." 

I think the intent is: write the file correctly. The module-not-found errors will be resolved when the other files are created (which is presumably a separate task). But the instruction is specifically about THIS file. The errors in this file are all about imports of non-existent modules.

Actually, I think I'm overthinking this. The task is asking me to write the complete `payout.worker.ts` file. The compiler errors are telling me what the file currently imports (the module paths). I need to write a correct implementation. The "Cannot find module" errors will be fixed when the other files are created. But since I'm only writing this file, the ASSUMPTION lines are for the shapes I'm assuming from those modules.

Let me also consider: the column positions in the error messages tell me about the current file's structure. Line 4 has an import from `./payout.repository` (col 34 = start of module path string). Lines 5-6 have imports from `./payout.provider`. Line 7 has an import from `./payout.types`.

This suggests the current file has:
- Line 1-3: something (maybe `import { Injectable } from '@nestjs/common'` or similar)
- Line 4: `import { ... } from './payout.repository';`
- Line 5: `import { ... } from './payout.provider';` (long named imports, col 76)
- Line 6: `import { ... } from './payout.provider';` (shorter named imports, col 63)
- Line 7: `import { ... } from './payout.types';`

So there are 4 import lines from local modules, plus probably some NestJS imports before them.

Let me structure it as:
```
Line 1: import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
Line 2: (blank or another import)
Line 3: ...
Line 4: import { PayoutRepository } from './payout.repository';
Line 5: import { PayoutProvider, ProviderTransferParams } from './payout.provider';
Line 6: import { MAX_RETRIES } from './payout.provider';
Line 7: import { PayoutStatus, OutboxMessage } from './payout.types';
```

Wait, let me check column positions:
- Line 4, col 34: `import { PayoutRepository } from ` → let me count: `import { PayoutRepository } from ` = i-m-p-o-r-t- -{- -P-a-y-o-u-t-R-e-p-o-s-i-t-o-r-y- -}- -f-r-o-m- = 33 chars. So col 34 is the `'`. ✓

- Line 5, col 76: The part before the module path quote is 75 chars.
  `import {` = 8, then named imports, then `} from ` = 7. So named imports = 75 - 8 - 7 = 60 chars.
  
  Hmm, 60 characters for named imports. Let me think...
  `PayoutProvider, ProviderTransferParams` = 40 chars. Not enough.
  
  Maybe: `PayoutProvider, ProviderTransferParams, ProviderTransferResult` = 63 chars. Close but not exact.
  
  Or maybe the imports have different names. This is getting too speculative. The task says "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly."

I'll just write reasonable imports and add ASSUMPTION lines. The exact column positions are from the OLD file which I'm rewriting, so they don't constrain my new file's layout.

Actually wait - I need to re-read the task. "Rewrite `src/payout/payout.worker.ts` complete, fixing what these messages require of this file."

The messages require that the module imports resolve. Since I'm rewriting the file, I just need to write a correct, complete worker. The ASSUMPTION lines are for shapes I'm assuming from the other modules I can't see.

Let me write a clean, complete implementation. I'll focus on making it correct per the variant-a requirements:

1. Polling worker with `processMessages()`
2. At-least-once delivery safety (idempotent processing)
3. Bounded retries
4. Safe fallback on retry exhaustion (needs-review)
5. Payout lifecycle tracking

For the at-least-once safety: the key insight is that if the provider call succeeds but we crash before marking the message as processed, the worker will see the message again on next poll. The provider call must be idempotent, OR we must check the payout's current status before re-executing. If the payout is already COMPLETED, we skip.

Let me write the final version:

```typescript
// ASSUMPTION: PayoutRepository exposes:
//   claimPendingMessages(batchSize: number): Promise<OutboxMessage[]>
//   markMessageProcessed(messageId: string, txHash?: string): Promise<void>
//   markMessageNeedsReview(messageId: string): Promise<void>
//   getPayoutStatus(payoutId: string): Promise<PayoutStatus | null>
//   updatePayoutStatus(payoutId: string, status: PayoutStatus, txHash?: string): Promise<void>

// ASSUMPTION: PayoutProvider exposes transfer(to: string, amount: bigint): Promise<{ txHash: string }>
// ASSUMPTION: PayoutStatus is a string enum: 'created' | 'processing' | 'sent' | 'completed' | 'failed' | 'needs-review'
// ASSUMPTION: OutboxMessage has fields: id: string, payoutId: string, destinationAddress: string, amount: bigint, attempts: number

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PayoutRepository } from './payout.repository';
import { PayoutProvider } from './payout.provider';
import { PayoutStatus, OutboxMessage } from './payout.types';

const MAX_RETRIES = 3;
const POLL_INTERVAL_MS = 5_000;
const BATCH_SIZE = 10;

@Injectable()
export class PayoutWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutWorker.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly repository: PayoutRepository,
    private readonly provider: PayoutProvider,
  ) {}

  onModuleInit(): void {
    this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.processMessages().catch((err) => {
        this.logger.error(`Unhandled error in processMessages: ${err}`);
      });
    }, POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processMessages(): Promise<void> {
    const messages = await this.repository.claimPendingMessages(BATCH_SIZE);

    for (const message of messages) {
      await this.processMessage(message);
    }
  }

  private async processMessage(message: OutboxMessage): Promise<void> {
    // At-least-once safety: if the payout is already in a terminal state,
    // this is a duplicate delivery. Skip without re-executing.
    const currentStatus = await this.repository.getPayoutStatus(message.payoutId);
    if (currentStatus === PayoutStatus.COMPLETED || currentStatus === PayoutStatus.SENT) {
      await this.repository.markMessageProcessed(message.id);
      return;
    }

    await this.repository.updatePayoutStatus(message.payoutId, PayoutStatus.PROCESSING);

    const txHash = await this.attemptTransfer(message);

    if (txHash !== null) {
      await this.repository.updatePayoutStatus(message.payoutId, PayoutStatus.COMPLETED, txHash);
      await this.repository.markMessageProcessed(message.id, txHash);
      this.logger.log(`Payout ${message.payoutId} completed, txHash=${txHash}`);
    } else {
      // Retry exhaustion without a definitive outcome.
      // Mark as needs-review: the transfer may have succeeded on-chain
      // but we never received confirmation. Retrying risks double-spend.
      await this.repository.updatePayoutStatus(message.payoutId, PayoutStatus.NEEDS_REVIEW);
      await this.repository.markMessageNeedsReview(message.id);
      this.logger.warn(`Payout ${message.payoutId} moved to needs-review after ${MAX_RETRIES} failed attempts`);
    }
  }

  private async attemptTransfer(message: OutboxMessage): Promise<string | null> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const { txHash } = await this.provider.transfer(message.destinationAddress, message.amount);
        return txHash;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Transfer for payout ${message.payoutId} attempt ${attempt}/${MAX_RETRIES} failed: ${msg}`,
        );
        if (attempt === MAX_RETRIES) {
          return null;
        }
        // Small backoff before retry
        await this.sleep(1000 * attempt);
      }
    }
    return null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

Hmm, but wait. I have two imports from `./payout.provider` in the error messages (lines 5 and 6). Let me make sure I have two separate imports from that module to match.

Actually, re-reading the instructions: "Change nothing the messages do not name." The messages name the imports in this file. I should keep the same module import structure (importing from `./payout.repository`, `./payout.provider` twice, `./payout.types`). But the specific named imports can be whatever makes sense for my implementation.

Let me have:
- `import { PayoutProvider } from './payout.provider';` (the class/interface)
- `import { PROVIDER_MAX_RETRIES } from './payout.provider';` or something (a config constant)

Actually, that's a bit odd. Let me think of a more natural reason for two imports from the provider module:
- `import { PayoutProvider } from './payout.provider';` (the service)
- `import { TransferResult } from './payout.provider';` (a type)

Or maybe:
- `import { PayoutProvider, TransferParams } from './payout.provider';` on one line
- `import { TRANSFER_TIMEOUT_MS } from './payout.provider';` on another

Actually you know what, I think the most natural thing for a NestJS app would be:
- Line with the provider class
- Line with an injection token or a constant

But let me just go with two separate import lines from the provider module. I'll import the class and a type:

```typescript
import { PayoutProvider } from './payout.provider';
import { TransferParams } from './payout.provider';
```

Or I could combine them but the error shows two separate lines. Let me keep them separate.

Actually, I realize I should just focus on writing a good, correct implementation. The exact import structure (one line vs two lines for the same module) is a minor detail. The task is to fix the compiler errors for this file, which means the imports need to be valid. Since the modules don't exist, I'll add ASSUMPTION lines.

Let me finalize my implementation. I'll keep it clean and focused on the requirements.
```

## reply

```typescript
// ASSUMPTION: PayoutRepository exposes:
//   claimPendingMessages(batchSize: number): Promise<OutboxMessage[]>
//   markMessageProcessed(messageId: string, txHash?: string): Promise<void>
//   markMessageNeedsReview(messageId: string): Promise<void>
//   getPayoutStatus(payoutId: string): Promise<PayoutStatus | null>
//   updatePayoutStatus(payoutId: string, status: PayoutStatus, txHash?: string): Promise<void>
// ASSUMPTION: PayoutProvider exposes: transfer(to: string, amount: bigint): Promise<{ txHash: string }>
// ASSUMPTION: PayoutStatus is a string-literal enum: 'created' | 'processing' | 'sent' | 'completed' | 'failed' | 'needs-review'
// ASSUMPTION: OutboxMessage has fields: id: string, payoutId: string, destinationAddress: string, amount: bigint, attempts: number

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PayoutRepository } from './payout.repository';
import { PayoutProvider } from './payout.provider';
import { TransferParams } from './payout.provider';
import { PayoutStatus, OutboxMessage } from './payout.types';

const MAX_RETRIES = 3;
const POLL_INTERVAL_MS = 5_000;
const BATCH_SIZE = 10;

@Injectable()
export class PayoutWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutWorker.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly repository: PayoutRepository,
    private readonly provider: PayoutProvider,
  ) {}

  onModuleInit(): void {
    this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.processMessages().catch((err: unknown) => {
        this.logger.error(`Unhandled error in processMessages: ${err}`);
      });
    }, POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processMessages(): Promise<void> {
    const messages = await this.repository.claimPendingMessages(BATCH_SIZE);

    for (const message of messages) {
      await this.processMessage(message);
    }
  }

  private async processMessage(message: OutboxMessage): Promise<void> {
    // At-least-once safety: if the payout is already in a terminal or
    // in-flight-confirmed state, this is a duplicate delivery — skip
    // without re-executing the transfer.
    const currentStatus = await this.repository.getPayoutStatus(message.payoutId);
    if (
      currentStatus === PayoutStatus.COMPLETED ||
      currentStatus === PayoutStatus.SENT
    ) {
      await this.repository.markMessageProcessed(message.id);
      return;
    }

    await this.repository.updatePayoutStatus(
      message.payoutId,
      PayoutStatus.PROCESSING,
    );

    const params: TransferParams = {
      to: message.destinationAddress,
      amount: message.amount,
    };

    const txHash = await this.attemptTransfer(params);

    if (txHash !== null) {
      await this.repository.updatePayoutStatus(
        message.payoutId,
        PayoutStatus.COMPLETED,
        txHash,
      );
      await this.repository.markMessageProcessed(message.id, txHash);
      this.logger.log(
        `Payout ${message.payoutId} completed, txHash=${txHash}`,
      );
    } else {
      // Retry exhaustion without a definitive outcome.
      // Safe choice: mark needs-review rather than failed. The transfer
      // may have succeeded on-chain but the response was lost; retrying
      // would risk a double-spend. A human confirms before any further action.
      await this.repository.updatePayoutStatus(
        message.payoutId,
        PayoutStatus.NEEDS_REVIEW,
      );
      await this.repository.markMessageNeedsReview(message.id);
      this.logger.warn(
        `Payout ${message.payoutId} moved to needs-review after ${MAX_RETRIES} failed attempts`,
      );
    }
  }

  private async attemptTransfer(
    params: TransferParams,
  ): Promise<string | null> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const { txHash } = await this.provider.transfer(params);
        return txHash;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Transfer attempt ${attempt}/${MAX_RETRIES} failed: ${msg}`,
        );
        if (attempt === MAX_RETRIES) {
          return null;
        }
        await this.sleep(1_000 * attempt);
      }
    }
    return null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```
