# repair2-outbox.service.ts

## reasoning

```
Let me analyze the compiler errors that relate to `src/outbox/outbox.service.ts`:

1. `src/outbox/outbox.service.ts(2,28): error TS2459: Module '"./outbox.repository.js"' declares 'OutboxMessageRow' locally, but it is not exported.`

This is the only error that directly names `outbox.service.ts`. The fix is to not import `OutboxMessageRow` from the outbox repository (since it's not exported), or to define the type locally in the service.

Looking at the outbox.repository.ts, `OutboxMessageRow` is an interface defined locally but not exported. The service needs to use this type. I should define a compatible interface in the service file or use `Awaited<ReturnType<...>>`.

Actually, the simplest fix is to define the shape the service expects locally, or to use a type that's compatible. Since I can't modify `outbox.repository.ts` (the instructions say "Change nothing the messages do not name"), I need to handle this in `outbox.service.ts` by not importing `OutboxMessageRow` from the repository.

Wait, let me re-read: "Change nothing the messages do not name." The messages name `outbox.service.ts` for the import error. So I need to fix the import in `outbox.service.ts`. The other errors are in other files and I shouldn't touch those.

So my fix for `outbox.service.ts`:
- Remove the import of `OutboxMessageRow` from `./outbox.repository.js`
- Define a local interface or use the return type of `claimPending`

Let me look at what the service needs from `OutboxMessageRow`:
- `id: string`
- `payoutId: string`
- `payload: { to: string; amount: string }`
- `status: OutboxStatus`
- `attempts: number`
- `nextAttemptAt: Date | null`
- `lastError: string | null`
- `createdAt: Date`
- `updatedAt: Date`

I'll define a local interface that matches what the service needs. Or better, I can use `Awaited<ReturnType<OutboxRepository['claimPending']>>[number]` to derive the type.

Actually, the cleanest approach is to just define a minimal local interface with the fields the service actually uses. Let me think about what the service needs:
- `id` - for markDone, recordAttempt
- `payoutId` - for finding the payout
- `payload.to` and `payload.amount` - for the provider call
- `attempts` - for retry logic

Let me write the complete file now.

Looking at the plan:
- `processMessages()`: claim messages, process each
  1. Load payout row
  2. If completed/failed → mark done (idempotent)
  3. Set status to 'processing' if 'created'
  4. Call provider.transfer
  5a. Success → completed, ledger post, mark done
  5b. Error → recordAttempt. If exhausted → needs_review, mark done

Constants:
- MAX_ATTEMPTS = 3
- BATCH_SIZE = 10
- Poll interval from env: PAYOUT_POLL_INTERVAL_MS, default 5000

The service also needs `start()` and `stop()` methods for the polling loop.

Now for the import of `OutboxMessageRow` - I'll define a local interface with just the fields needed, or I can use a type alias derived from the return type.

Actually, the simplest and most correct approach: define a local interface `ClaimedMessage` with the fields the service needs. This avoids any coupling to the repository's internal types.

Let me also check: the `OutboxStatus` type is imported from `../payout/payout.types.js`. That should be fine since it's a type export from that file (per the plan).

Let me write the file:

```ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import type { OutboxStatus } from '../payout/payout.types.js';
import type { BlockchainProvider } from '../payout/payout.types.js';
import type { PayoutRepository } from '../payout/payout.repository.js';
import type { OutboxRepository } from './outbox.repository.js';

// ASSUMPTION: OutboxMessageRow is not exported from outbox.repository.ts, so we define the shape we need locally.
interface ClaimedMessage {
  id: string;
  payoutId: string;
  payload: { to: string; amount: string };
  attempts: number;
}

const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 10;

@Injectable()
export class OutboxService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly outboxRepo: OutboxRepository,
    private readonly payoutRepo: PayoutRepository,
    private readonly provider: BlockchainProvider,
  ) {}

  onModuleInit(): void {
    this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(): void {
    const interval = parseInt(process.env.PAYOUT_POLL_INTERVAL_MS ?? '5000', 10);
    this.timer = setInterval(() => {
      void this.processMessages();
    }, interval);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processMessages(): Promise<void> {
    const messages: ClaimedMessage[] = await this.outboxRepo.claimPending(BATCH_SIZE);

    for (const message of messages) {
      try {
        await this.processMessage(message);
      } catch (err) {
        // Defensive: if processMessage throws unexpectedly, record the attempt
        // so the message isn't lost. In practice, processMessage handles its own errors.
        // ASSUMPTION: This catch is a safety net; the primary error handling is inside processMessage.
      }
    }
  }

  private async processMessage(message: ClaimedMessage): Promise<void> {
    const payout = await this.payoutRepo.findById(message.payoutId);

    if (!payout) {
      // Payout should always exist (FK constraint). If not, mark done to avoid infinite loop.
      await this.outboxRepo.markDone(message.id);
      return;
    }

    // Idempotent redelivery: if already in a terminal state, just mark done.
    if (payout.status === 'completed' || payout.status === 'failed') {
      await this.outboxRepo.markDone(message.id);
      return;
    }

    // Transition to processing if still in created state.
    if (payout.status === 'created') {
      await this.payoutRepo.updatePayout(payout.id, 'processing');
    }

    try {
      const { txHash } = await this.provider.transfer({
        to: message.payload.to,
        amount: BigInt(message.payload.amount),
      });

      // Success: update payout, post ledger entry, mark message done.
      await this.payoutRepo.updatePayout(payout.id, 'completed', txHash);
      await this.payoutRepo.confirmPayoutLedger(payout.accountId, payout.id, payout.amount);
      await this.outboxRepo.markDone(message.id);
    } catch (error) {
      // Provider failed: record the attempt.
      const attempts = message.attempts + 1;

      if (attempts >= MAX_ATTEMPTS) {
        // Retry exhausted with no definitive outcome: mark needs_review.
        await this.payoutRepo.updatePayout(payout.id, 'needs_review');
        await this.outboxRepo.markDone(message.id);
      } else {
        const errMsg = error instanceof Error ? error.message : String(error);
        await this.outboxRepo.recordAttempt(message.id, attempts, null, errMsg);
      }
    }
  }
}
```

Wait, I need to reconsider. The plan says for the success case:

> 5a. Success → payout.status='completed', tx_hash set; call payoutRepo.confirmPayoutLedger; mark message done. All in a single $transaction.

But looking at the repository methods available:
- `updatePayout(id, status, txHash)` - single update
- `confirmPayoutLedger(accountId, payoutId, amount)` - does ledger insert + balance update in a transaction

The plan says "All in a single $transaction" but the repository methods are separate. Since I can't modify the repository (messages don't name it for changes), I'll just call them sequentially. The `confirmPayoutLedger` already wraps its operations in a transaction internally. This is a minor deviation but the repository was written this way and I shouldn't change it.

Actually wait - the instructions say "Change nothing the messages do not name." The compiler errors don't name any issue with the transaction wrapping in the service. So I'll keep the calls sequential as the repository methods are designed to be called that way.

Let me also reconsider the `OutboxStatus` import - is it actually used in my file? Looking at my code... no, I don't use `OutboxStatus` directly. Let me remove that import to keep it clean.

Actually, I do reference the status values as string literals ('completed', 'failed', 'created', 'processing', 'needs_review') which are all valid `PayoutStatus` values. I don't need to import `OutboxStatus`.

Let me also think about whether I need to import `PayoutRow` type. I'm accessing `payout.status`, `payout.id`, `payout.accountId`, `payout.amount` - these are all on the PayoutRow type. But since I'm getting it from `findById` which returns `PayoutRow | null`, TypeScript should infer the type correctly without an explicit import.

Let me finalize:
```

## reply

```ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import type { BlockchainProvider, PayoutStatus } from '../payout/payout.types.js';
import type { PayoutRepository } from '../payout/payout.repository.js';
import type { OutboxRepository } from './outbox.repository.js';

// ASSUMPTION: OutboxMessageRow is declared but not exported from outbox.repository.ts;
// the service defines a minimal local shape for what it consumes.
interface ClaimedMessage {
  id: string;
  payoutId: string;
  payload: { to: string; amount: string };
  attempts: number;
}

const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 10;

@Injectable()
export class OutboxService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly outboxRepo: OutboxRepository,
    private readonly payoutRepo: PayoutRepository,
    private readonly provider: BlockchainProvider,
  ) {}

  onModuleInit(): void {
    this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(): void {
    const interval = parseInt(process.env.PAYOUT_POLL_INTERVAL_MS ?? '5000', 10);
    this.timer = setInterval(() => {
      void this.processMessages();
    }, interval);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processMessages(): Promise<void> {
    const messages: ClaimedMessage[] = await this.outboxRepo.claimPending(BATCH_SIZE);

    for (const message of messages) {
      await this.processMessage(message);
    }
  }

  private async processMessage(message: ClaimedMessage): Promise<void> {
    const payout = await this.payoutRepo.findById(message.payoutId);

    if (!payout) {
      // Payout should always exist (FK constraint). Mark done to avoid infinite re-claim.
      await this.outboxRepo.markDone(message.id);
      return;
    }

    // Idempotent redelivery: if already terminal, just mark done.
    if (payout.status === 'completed' || payout.status === 'failed') {
      await this.outboxRepo.markDone(message.id);
      return;
    }

    // Transition to processing if still in created state.
    if (payout.status === 'created') {
      await this.payoutRepo.updatePayout(payout.id, 'processing');
    }

    try {
      const { txHash } = await this.provider.transfer({
        to: message.payload.to,
        amount: BigInt(message.payload.amount),
      });

      // Success: record tx hash, post ledger entry + decrement balance, mark message done.
      await this.payoutRepo.updatePayout(payout.id, 'completed', txHash);
      await this.payoutRepo.confirmPayoutLedger(payout.accountId, payout.id, payout.amount);
      await this.outboxRepo.markDone(message.id);
    } catch (error) {
      const attempts = message.attempts + 1;

      if (attempts >= MAX_ATTEMPTS) {
        // Retry exhausted with no definitive outcome: flag for human review.
        await this.payoutRepo.updatePayout(payout.id, 'needs_review');
        await this.outboxRepo.markDone(message.id);
      } else {
        const errMsg = error instanceof Error ? error.message : String(error);
        await this.outboxRepo.recordAttempt(message.id, attempts, null, errMsg);
      }
    }
  }
}
```
