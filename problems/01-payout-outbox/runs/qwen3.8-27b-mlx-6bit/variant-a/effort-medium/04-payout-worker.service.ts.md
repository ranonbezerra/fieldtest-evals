# 04-payout-worker.service.ts@medium

## reasoning

```
Let me analyze the plan and references to write the `src/payout/payout-worker.service.ts` file.

From the plan:

### PayoutWorkerService (class, `@Injectable()`)

```typescript
constructor(provider: TransferProvider, repo: PayoutRepository)
processMessages(): Promise<void>
```

`processMessages` is the idempotent work unit called by a `setInterval` loop started in `onModuleInit`.

### Worker: processMessages()

1. Fetch candidate messages:
   a. `nextPendingMessage(10)` → all rows with `status = 'pending'`.
   b. `claimStaleMessages(30000, 10)` → rows with `status = 'processing'` AND `processing_started_at < NOW() − 30s`.
2. For each candidate, atomically claim:
   - `claimMessage(id)`: `UPDATE … SET status='processing', processing_started_at=NOW() WHERE id=? AND status IN ('pending','processing') RETURNING …`. If 0 rows, skip (another worker got it).
3. Set payout status to `processing` (if not already).
4. Call `provider.transfer(destinationAddress, amount)`.
5. On **success**: in one transaction → `settleLedger`, `updatePayoutStatus(→ completed, txHash)`, `markMessageDone`.
6. On **error**:
   - If `attempts < maxAttempts`: increment attempts, set status back to `pending`, clear `processing_started_at`. Store last error.
   - If `attempts >= maxAttempts`: in one transaction → `releaseHold`, `updatePayoutStatus(→ needs_review)`, `markMessageFailed`.

**Must not be inside a DB transaction:** the `provider.transfer` call (it may hang for seconds).

Now let me look at the repository methods available:
- `withTransaction(fn)` - runs fn inside a Prisma interactive transaction
- `createPayoutWithHold(input)` 
- `findPayoutByIdempotencyKey(key)`
- `findPayoutById(id)`
- `updatePayoutStatus(id, status, txHash?, tx?)`
- `settleLedger(payoutId, accountId, amount, tx?)`
- `releaseHold(payoutId, accountId, amount, tx?)`
- `claimMessage(messageId): Promise<boolean>`
- `claimStaleMessages(timeoutMs, limit): Promise<OutboxMessageRow[]>`
- `nextPendingMessage(limit): Promise<OutboxMessageRow[]>`
- `incrementAttempts(messageId, lastError?)`
- `markMessageDone(messageId, tx?)`
- `markMessageFailed(messageId, error, tx?)`

The worker needs to:
1. Get pending messages and stale messages
2. For each, claim it
3. Fetch the payout to get destination address and amount
4. Set status to processing
5. Call provider.transfer
6. Handle success/error

Let me look at the TransferProvider interface from the plan:
```typescript
interface TransferProvider {
  transfer(to: string, amount: bigint): Promise<{ txHash: string }>;
}
```

This is defined in `payout.service.ts` according to the plan. But the worker needs it too. Let me check - the plan says "Provider interface location | Defined in `payout.service.ts` as an exported interface, injected via DI token". So I need to import it from the service file.

Wait, but the plan says the worker reads `src/payout/payout.repository.ts`. It doesn't mention reading from `payout.service.ts`. But it needs the TransferProvider interface. Let me re-read...

The manifest says:
```
src/payout/payout-worker.service.ts | reads: src/payout/payout.repository.ts | Polling worker: claim, provider call, state transitions
```

So it only reads from the repository. But it needs the TransferProvider type. The plan says it's defined in `payout.service.ts`. I'll need to import it from there. Actually, looking more carefully at the plan's section on types:

"### Exported interfaces
// In payout.service.ts
interface TransferProvider {
  transfer(to: string, amount: bigint): Promise<{ txHash: string }>;
}"

So I should import TransferProvider from `./payout.service`. This is a type import, not a file dependency in the "reads" sense (which is about data flow). I'll import it.

Now, for the `onModuleInit` with setInterval - the plan says "processMessages is the idempotent work unit called by a setInterval loop started in onModuleInit." So I need to implement `OnModuleInit` and start the interval.

Let me also think about the config: "Worker polling interval | 5 seconds (configurable via env WORKER_POLL_MS)". So I need to read `WORKER_POLL_MS` from environment.

For the stale timeout: "Stale-processing timeout for crashed workers | 30 seconds" - this is the `timeoutMs` parameter passed to `claimStaleMessages`.

Let me also think about what `OutboxMessageRow` contains. From the schema:
- id
- payoutId
- status
- attempts
- maxAttempts
- lastError
- processingStartedAt
- createdAt
- updatedAt

The worker needs `payoutId` to look up the payout, and `attempts`/`maxAttempts` to decide retry vs give up.

Now let me think about the flow more carefully:

1. Fetch pending messages (limit 10)
2. Fetch stale messages (timeout 30s, limit 10)
3. For each message:
   a. Try to claim it. If fails, skip.
   b. Look up the payout by `message.payoutId` to get `destinationAddress`, `amount`, `accountId`.
   c. Set payout status to `processing` (if not already - but the plan says "Set payout status to processing (if not already)"). Actually, looking at the repository, `updatePayoutStatus` just does an update. I'll call it unconditionally - if it's already processing, it's a no-op effectively (same value).
   
   Wait, actually I should check: do I need to look up the payout? The message has `payoutId`. I can use `findPayoutById` to get the payout details.

   d. Call `provider.transfer(destinationAddress, amount)` - NOT in a transaction.
   e. On success: `repo.withTransaction(async (tx) => { await repo.settleLedger(...); await repo.updatePayoutStatus(..., tx); await repo.markMessageDone(..., tx); })`
   f. On error:
      - If `message.attempts + 1 < message.maxAttempts` (wait, let me think about this more carefully)
      
      Actually, the plan says:
      - If `attempts < maxAttempts`: increment attempts, set status back to pending
      - If `attempts >= maxAttempts`: release hold, needs_review, mark failed
      
      But wait - when does the attempt get incremented? The plan says "increment attempts" on the retry path. So the flow is:
      - Message starts with attempts = 0
      - First failure: attempts (0) < maxAttempts (3) → increment to 1, back to pending
      - Second failure: attempts (1) < maxAttempts (3) → increment to 2, back to pending  
      - Third failure: attempts (2) < maxAttempts (3) → increment to 3, back to pending
      - Fourth failure: attempts (3) >= maxAttempts (3) → release, needs_review, failed
      
      Hmm, but that means 4 attempts total with maxAttempts=3. Let me re-read the plan...

      "Retry a bounded number of times" and "maxAttempts default | 3". 

      Actually looking at the test: "Provider throws on attempt 1 and 2, succeeds on attempt 3 (maxAttempts = 3) | Payout → completed; message → done; attempts recorded as 3"

      So with maxAttempts=3, there are 3 total attempts. Let me reconsider:
      - Message starts with attempts = 0
      - First attempt fails: attempts (0) < maxAttempts (3) → increment to 1, back to pending (this was attempt 1)
      - Second attempt fails: attempts (1) < maxAttempts (3) → increment to 2, back to pending (this was attempt 2)
      - Third attempt succeeds: → done, attempts = 2? But the test says "attempts recorded as 3"

      Hmm, that doesn't quite work. Let me think differently. Maybe the increment happens BEFORE the check, or the semantics are different.

      Actually wait - maybe the attempt count is incremented when we START processing (or after each failure), and the check is whether we've already used up all attempts. Let me re-read:

      "On error:
      - If attempts < maxAttempts: increment attempts, set status back to pending"
      
      So with maxAttempts = 3:
      - attempts=0, fail → 0 < 3 → increment to 1, pending
      - attempts=1, fail → 1 < 3 → increment to 2, pending
      - attempts=2, fail → 2 < 3 → increment to 3, pending
      - attempts=3, fail → 3 >= 3 → release, needs_review, failed

      That's 4 total attempts. But the test says "attempts recorded as 3" for success on attempt 3.

      Hmm, let me re-read the test: "Provider throws on attempt 1 and 2, succeeds on attempt 3 (maxAttempts = 3) | Payout → completed; message → done; attempts recorded as 3"

      Maybe "attempts recorded as 3" means the field value is 3 after the successful third attempt? But in my flow above, on success we don't increment. We only increment on failure.

      Wait, maybe I'm overcomplicating this. Let me look at it differently:

      Perhaps the increment happens as part of claiming or before the provider call. Or perhaps the semantics are:
      - The `attempts` field tracks how many times we've ATTEMPTED (not how many have failed)
      - Before calling provider, we increment attempts
      - If it fails and attempts >= maxAttempts → give up
      - If it fails and attempts < maxAttempts → retry

      Let me re-read the plan one more time:
      
      "On error:
      - If attempts < maxAttempts: increment attempts, set status back to pending, clear processing_started_at. Store last error.
      - If attempts >= maxAttempts: in one transaction → releaseHold, updatePayoutStatus(→ needs_review), markMessageFailed."

      OK so the plan is clear: on error, check current attempts value. If < max, increment and retry. If >= max, give up.

      With the test "Provider throws on attempt 1 and 2, succeeds on attempt 3 (maxAttempts = 3)":
      - attempts=0: fail → 0 < 3 → increment to 1, pending
      - attempts=1: fail → 1 < 3 → increment to 2, pending
      - attempts=2: success → done

      But the test says "attempts recorded as 3". That's inconsistent with my reading. Unless...

      Maybe the test means something slightly different, or maybe I should increment attempts BEFORE the provider call (as part of claiming). Let me look at `claimMessage` - it just sets status to processing and processingStartedAt. It doesn't increment attempts.

      You know what, I think there might be a slight inconsistency in the plan's test description vs. its logic spec. The logic spec is authoritative: "If attempts < maxAttempts: increment attempts". I'll implement exactly that. The test saying "attempts recorded as 3" might be referring to the total number of times the provider was called (which would be 3: two failures + one success), not the database field value.

      Actually wait - maybe I should increment attempts as part of the claim (when we start processing). Let me re-read claimMessage:

      ```
      claimMessage(messageId): UPDATE … SET status='processing', processing_started_at=NOW() WHERE id=? AND status IN ('pending','processing') RETURNING …
      ```

      No, it doesn't increment attempts. OK, I'll stick with the plan's explicit logic: increment on failure path only.

      Actually, let me reconsider. What if the flow is:
      1. Claim message (attempts stays same)
      2. Call provider
      3a. Success → mark done (attempts unchanged)
      3b. Failure → check: if attempts < maxAttempts, increment and set pending; else release and fail

      With this, and the test scenario (throws on 1st and 2nd, succeeds on 3rd, maxAttempts=3):
      - Claim (attempts=0), provider throws → 0 < 3 → increment to 1, pending
      - Claim (attempts=1), provider throws → 1 < 3 → increment to 2, pending
      - Claim (attempts=2), provider succeeds → mark done, attempts stays 2

      "attempts recorded as 3" still doesn't match. Unless the test is just poorly worded and means "3 attempts were made" (which is true - the provider was called 3 times).

      I'll implement exactly what the plan says in the control flow section. The test description is just an approximation.

4. For the `onModuleInit` / `onModuleDestroy` lifecycle:
   - Start a setInterval calling processMessages()
   - Clear it on destroy

Let me also think about error handling in the worker. If `processMessages()` itself throws (e.g., DB connection lost), we should catch it and log, not crash the interval.

Now let me also think about what I need to import:
- `Injectable`, `OnModuleInit`, `OnModuleDestroy` from `@nestjs/common`
- `PayoutRepository` from `./payout.repository`
- `TransferProvider` from `./payout.service` (type import)
- `PayoutStatus` from `@prisma/client`

Wait, do I need PayoutStatus? I use `PayoutStatus.PROCESSING`, `PayoutStatus.COMPLETED`, `PayoutStatus.NEEDS_REVIEW`. Let me check the enum values from the plan:
```
PAYOUT_STATUS: created | processing | completed | failed | needs_review
```

In Prisma, these would be `PayoutStatus.CREATED`, `PayoutStatus.PROCESSING`, etc.

Actually, looking at the repository code, it imports `PayoutStatus` from `@prisma/client`. I'll do the same.

Let me also consider: the worker needs to look up the payout to get `destinationAddress` and `amount`. I'll use `repo.findPayoutById(message.payoutId)`.

But wait - `findPayoutById` returns a `PayoutResponse | null`. The `PayoutResponse` has:
- id, accountId, amount (as string), destinationAddress, status, txHash, createdAt

I need `amount` as bigint for the provider call. But `PayoutResponse.amount` is a string. I'll need to convert: `BigInt(response.amount)`.

Hmm, that's a bit awkward. But it's what the repository API gives us. Let me go with it.

Actually wait - let me look at this more carefully. The `PayoutResponse` has `amount: string`. For the provider call I need `bigint`. So `BigInt(payout.amount)` works.

Now let me write the file:

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PayoutRepository } from './payout.repository';
import { TransferProvider } from './payout.service';
import { PayoutStatus } from '@prisma/client';

@Injectable()
export class PayoutWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutWorkerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  private readonly pollMs: number;
  private readonly staleTimeoutMs: number;
  private readonly batchSize = 10;

  constructor(
    private readonly provider: TransferProvider,
    private readonly repo: PayoutRepository,
  ) {
    this.pollMs = Number(process.env.WORKER_POLL_MS) || 5000;
    this.staleTimeoutMs = 30_000;
  }

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.processMessages().catch((err) => {
        this.logger.error(`processMessages failed: ${err.message}`, err.stack);
      });
    }, this.pollMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processMessages(): Promise<void> {
    const pending = await this.repo.nextPendingMessage(this.batchSize);
    const stale = await this.repo.claimStaleMessages(this.staleTimeoutMs, this.batchSize);

    const candidates = [...pending, ...stale];

    for (const message of candidates) {
      const claimed = await this.repo.claimMessage(message.id);
      if (!claimed) continue;

      await this.processSingleMessage(message.id);
    }
  }

  private async processSingleMessage(messageId: string): Promise<void> {
    // Look up the message to get payoutId, attempts, maxAttempts
    // Actually I need the message row... but claimMessage doesn't return the row.
    // I need to re-fetch or use the message from the candidates list.
  }
}
```

Wait, I have a problem. `claimMessage` returns just a boolean. I need the message details (payoutId, attempts, maxAttempts) after claiming. I could:
1. Use the message from the candidates list (but it might be stale - another worker could have processed it between my fetch and claim)
2. Re-fetch the message after claiming

Actually, since I just claimed it (it's now `processing` and I own it), re-fetching is safe. But the repository doesn't have a `findMessageById` method. Let me check...

The repository has:
- `nextPendingMessage(limit)` - returns OutboxMessageRow[]
- `claimStaleMessages(timeoutMs, limit)` - returns OutboxMessageRow[]
- No `findMessageById`

Hmm. I think the safest approach is to use the message data from the candidates list. The `attempts` and `maxAttempts` won't change between my fetch and my claim (only the status changes, which is handled by the conditional update in claimMessage). The `payoutId` never changes. So using the candidate row's data is fine.

Actually wait - could `attempts` change? No, because only the worker that claims the message can increment attempts, and I just claimed it. Between the initial fetch and the claim, no other worker can modify this message (they'd need to claim it first, which I just did).

So I'll pass the message row into a private method. Let me restructure:

```typescript
async processMessages(): Promise<void> {
  const pending = await this.repo.nextPendingMessage(this.batchSize);
  const stale = await this.repo.claimStaleMessages(this.staleTimeoutMs, this.batchSize);

  const candidates = [...pending, ...stale];

  for (const message of candidates) {
    const claimed = await this.repo.claimMessage(message.id);
    if (!claimed) continue;

    await this.processSingleMessage(message);
  }
}

private async processSingleMessage(message: OutboxMessageRow): Promise<void> {
  const payout = await this.repo.findPayoutById(message.payoutId);
  if (!payout) {
    this.logger.warn(`Payout ${message.payoutId} not found for message ${message.id}`);
    return;
  }

  // Set payout status to processing
  await this.repo.updatePayoutStatus(payout.id, PayoutStatus.PROCESSING);

  // Call provider (NOT in a transaction)
  const amount = BigInt(payout.amount);
  
  try {
    const { txHash } = await this.provider.transfer(payout.destinationAddress, amount);

    // Success: settle in one transaction
    await this.repo.withTransaction(async (tx) => {
      await this.repo.settleLedger(payout.id, payout.accountId, amount, tx);
      await this.repo.updatePayoutStatus(payout.id, PayoutStatus.COMPLETED, txHash, tx);
      await this.repo.markMessageDone(message.id, tx);
    });
  } catch (err: any) {
    const errorMessage = err?.message ?? String(err);
    
    if (message.attempts < message.maxAttempts) {
      // Retry: increment attempts, back to pending
      await this.repo.incrementAttempts(message.id, errorMessage);
    } else {
      // Exhausted: release hold, needs_review, mark failed
      await this.repo.withTransaction(async (tx) => {
        await this.repo.releaseHold(payout.id, payout.accountId, amount, tx);
        await this.repo.updatePayoutStatus(payout.id, PayoutStatus.NEEDS_REVIEW, undefined, tx);
        await this.repo.markMessageFailed(message.id, errorMessage, tx);
      });
    }
  }
}
```

Wait, I need to import `OutboxMessageRow` type. Looking at the repository:
```typescript
type OutboxMessageRow = Prisma.OutboxMessageGetPayload<{}>;
```

This is not exported from the repository file. I need to either:
1. Import it directly from `@prisma/client` as `Prisma.OutboxMessageGetPayload<{}>`
2. Define a local type

I'll import Prisma types. Actually, let me just use the type inline or import `Prisma` from `@prisma/client`.

Let me also double-check: the `OutboxMessageRow` has fields matching the schema:
- id: string
- payoutId: string  
- status: MessageStatus
- attempts: number
- maxAttempts: number
- lastError: string | null
- processingStartedAt: Date | null
- createdAt: Date
- updatedAt: Date

Yes, that's what I need.

Now, one issue: `message.attempts` - at the point I'm using it, has it been incremented? No. The increment happens in `incrementAttempts` which I call on the retry path. So when I check `message.attempts < message.maxAttempts`, it's the value before this attempt. That matches the plan.

Let me also think about whether I need to handle the case where `findPayoutById` returns null. The payout should always exist (referential integrity), but defensively I'll log and skip.

Actually, wait. If the payout doesn't exist, what should I do with the message? I'll just log a warning and leave it in processing state. The stale recovery will pick it up again, and if the payout still doesn't exist, it'll loop. But that's a data integrity issue that shouldn't happen in practice. For the scope of this implementation, I'll just log and return.

Hmm, but that means the message stays in `processing` forever until stale recovery kicks in, then it loops. Maybe I should mark it as failed? But that would release funds for a non-existent payout which makes no sense. I'll just log and return - this is an exceptional case.

Let me finalize the file. One more consideration: the plan says "processMessages() runs every N seconds" and the worker is a `@Injectable()` class. I need `OnModuleInit` to start the interval and `OnModuleDestroy` to clean up.

Let me also make sure I'm not adding anything the plan doesn't specify. The plan says:
- `processMessages(): Promise<void>` - public
- constructor with provider and repo
- setInterval loop in onModuleInit

I think a private helper `processSingleMessage` is fine as an implementation detail.

Let me write the final version now.
```

## reply

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PayoutStatus, Prisma } from '@prisma/client';
import { PayoutRepository } from './payout.repository';
import type { TransferProvider } from './payout.service';

type OutboxMessageRow = Prisma.OutboxMessageGetPayload<{}>;

@Injectable()
export class PayoutWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutWorkerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  private readonly pollMs: number;
  private readonly staleTimeoutMs = 30_000;
  private readonly batchSize = 10;

  constructor(
    private readonly provider: TransferProvider,
    private readonly repo: PayoutRepository,
  ) {
    this.pollMs = Number(process.env.WORKER_POLL_MS) || 5_000;
  }

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.processMessages().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`processMessages failed: ${msg}`);
      });
    }, this.pollMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processMessages(): Promise<void> {
    const pending = await this.repo.nextPendingMessage(this.batchSize);
    const stale = await this.repo.claimStaleMessages(this.staleTimeoutMs, this.batchSize);

    const candidates: OutboxMessageRow[] = [...pending, ...stale];

    for (const message of candidates) {
      const claimed = await this.repo.claimMessage(message.id);
      if (!claimed) {
        continue;
      }

      await this.processSingleMessage(message);
    }
  }

  private async processSingleMessage(message: OutboxMessageRow): Promise<void> {
    const payout = await this.repo.findPayoutById(message.payoutId);
    if (!payout) {
      this.logger.warn(
        `Payout ${message.payoutId} not found for message ${message.id}; skipping`,
      );
      return;
    }

    await this.repo.updatePayoutStatus(payout.id, PayoutStatus.PROCESSING);

    const amount = BigInt(payout.amount);

    try {
      const { txHash } = await this.provider.transfer(
        payout.destinationAddress,
        amount,
      );

      await this.repo.withTransaction(async (tx) => {
        await this.repo.settleLedger(payout.id, payout.accountId, amount, tx);
        await this.repo.updatePayoutStatus(payout.id, PayoutStatus.COMPLETED, txHash, tx);
        await this.repo.markMessageDone(message.id, tx);
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      if (message.attempts < message.maxAttempts) {
        await this.repo.incrementAttempts(message.id, errorMessage);
        this.logger.warn(
          `Message ${message.id} attempt failed (${errorMessage}); will retry`,
        );
      } else {
        await this.repo.withTransaction(async (tx) => {
          await this.repo.releaseHold(payout.id, payout.accountId, amount, tx);
          await this.repo.updatePayoutStatus(
            payout.id,
            PayoutStatus.NEEDS_REVIEW,
            undefined,
            tx,
          );
          await this.repo.markMessageFailed(message.id, errorMessage, tx);
        });
        this.logger.error(
          `Message ${message.id} exhausted retries; payout marked needs_review`,
        );
      }
    }
  }
}
```
