# repair1-payout.service.ts

## reasoning

```
Let me analyze the compiler errors for `src/payout/payout.service.ts`:

```
src/payout/payout.service.ts(3,34): error TS2307: Cannot find module './payout.repository' or its corresponding type declarations.
src/payout/payout.service.ts(4,29): error TS2307: Cannot find module './payout.types' or its corresponding type declarations.
src/payout/payout.service.ts(5,53): error TS2307: Cannot find module './payout.types' or its corresponding type declarations.
```

So `payout.service.ts` imports from:
- Line 3, col 34: `./payout.repository` — the module doesn't exist or can't be found
- Line 4, col 29: `./payout.types` — the module doesn't exist or can't be found
- Line 5, col 53: `./payout.types` — same module, different import

The task says: "Rewrite `src/payout/payout.service.ts` complete, fixing what these messages require of this file."

The errors are all `TS2307: Cannot find module` errors. These mean the files `./payout.repository` and `./payout.types` don't exist (or don't export what's expected). But wait — the task says "Change nothing the messages do not name." The messages only name `src/payout/payout.service.ts` as the file to fix.

But the issue is that `payout.service.ts` imports from `./payout.repository` and `./payout.types`, and those modules don't exist. The task says to rewrite `payout.service.ts` to fix what these messages require of this file.

Since the messages say those modules can't be found, the fix within `payout.service.ts` would be to either:
1. Inline the types and repository interface directly in the file (but that contradicts the layering convention)
2. Remove the imports (but then the service won't work)

Wait, let me re-read the task. "These are the compiler's exact messages for the whole workspace — not a summary of them". So the whole workspace has these errors. The task says to rewrite `payout.service.ts` fixing what these messages require of this file.

The messages for `payout.service.ts` specifically are:
- Line 3: Cannot find module './payout.repository'
- Line 4: Cannot find module './payout.types'
- Line 5: Cannot find module './payout.types'

Since I'm only allowed to change `payout.service.ts` (the task says "Change nothing the messages do not name"), and the errors are about missing modules that `payout.service.ts` imports, I need to resolve these within the file itself.

The options are:
1. Define the types inline in `payout.service.ts` instead of importing from `./payout.types`
2. Define the repository interface inline instead of importing from `./payout.repository`

But wait — the convention says "Layers — no exceptions: service holds the logic. Zero raw SQL, zero Prisma client calls." and "repository is the only layer that touches the database." So the service should use a repository.

But if the repository file doesn't exist, I can't import it. The task says to fix what the messages require of THIS file. Since I can't create other files (the task says "Change nothing the messages do not name" — and the messages only name `payout.service.ts` as the file to rewrite), I need to make the service self-contained in terms of type declarations.

Wait, let me re-read: "Rewrite `src/payout/payout.service.ts` complete, fixing what these messages require of this file."

So I'm rewriting only this one file. The messages that pertain to this file are the three TS2307 errors. The fix is to not import from non-existent modules but instead define what's needed inline.

But that conflicts with the architecture... Let me think about this differently.

Actually, looking more carefully at the problem. The convention says:
- `src/<feature>/<feature>.repository.ts` — this is the repository file
- `src/<feature>/<feature>.service.ts` — this is the service file

The layout shows these files should exist. The compiler says they can't be found. Since I'm told to only fix `payout.service.ts`, and the errors are about missing imports, I should define the necessary types and interfaces inline within the service file.

But wait — that would violate the layering convention where the repository is a separate file. Let me re-read the constraint: "Change nothing the messages do not name."

The messages for `payout.service.ts` say the imports can't be resolved. The fix within this file is to either:
1. Remove the imports and inline the types
2. Keep the imports but... they won't resolve

Actually, I think the right approach is: since I'm told to rewrite this file to fix the compiler errors, and the errors are about unresolvable imports, I should define the types and repository interface locally within this file. This is the only way to make this file compile without creating other files.

Let me think about what the service needs:

From the variant A requirements:
1. `POST /payouts` — creates a payout if account has sufficient available funds, with idempotency
2. Async processing via message table + polling worker
3. No overdraft under concurrent requests
4. Track lifecycle (created → processing → sent → completed / failed / needs-review)
5. Double-entry ledger — settled balance changes only when provider confirms
6. Retry bounded, safe fallback on exhaustion

The service needs:
- Types for Payout, PayoutStatus, Account, LedgerEntry, Message, etc.
- A repository interface for data access
- The business logic

Let me define what types I need based on the imports:
- Line 4, col 29: one type from `./payout.types`
- Line 5, col 53: another type from `./payout.types`

And line 3, col 34: something from `./payout.repository`

Let me think about what a payout service for variant A would need:

Types:
- `CreatePayoutInput` — the request body `{ accountId, amount, destinationAddress, idempotencyKey }`
- `Payout` — the payout entity
- `PayoutStatus` — enum for lifecycle
- `LedgerEntry` — for double-entry
- `Message` — for the outbox

Repository interface:
- `createPayout` with transaction
- `getPayoutByIdempotencyKey`
- `claimMessage` / `getMessage`
- `updatePayoutStatus`
- `recordLedgerEntry`
- etc.

Let me write a complete service that:
1. Defines the types it needs inline (since `./payout.types` doesn't exist)
2. Defines or imports the repository interface inline (since `./payout.repository` doesn't exist)
3. Implements the business logic

Actually wait. Let me reconsider. The convention says files should be separate. But the task explicitly says I can only change `payout.service.ts`. If I inline the types, that's a deviation from the convention, but the task says "If satisfying the compiler seems to require abandoning something the plan specified, keep the plan and add one `// ASSUMPTION:` line saying what you could not reconcile."

Hmm, but actually the "plan" here is the variant A requirements, not the file layout convention. The file layout convention says there should be separate files. But the task says to fix this one file. 

I think the cleanest approach is:
- Define the types inline in the service file (or in a local `types` section)
- Define the repository as an injected interface (the concrete implementation would be in the repository file when it exists)

Actually, I can define an interface for the repository that the service depends on, and then the concrete `PayoutRepository` class (in the other file) would implement it. But since I can only write this file, I'll define the interface and the types here.

Wait, but the convention says the service should use the repository (not the prisma client directly). If I define the repository interface here, and the repository file imports from here, that could work. But the repository file also has errors...

Let me just focus on making `payout.service.ts` compile. I'll:
1. Define the types I need in the same file
2. Define a `PayoutRepository` interface (or import type from a local definition)
3. Implement the service logic

The key constraint is: the service should NOT have raw SQL or Prisma client calls. It should delegate to a repository. So I'll define an interface for what the repository provides, and the service will use that interface.

Let me write this out:

```typescript
import { Injectable, Inject, Logger } from '@nestjs/common';

// Types (defined here because ./payout.types is not available)
export type PayoutStatus = 'created' | 'processing' | 'sent' | 'completed' | 'failed' | 'needs_review';

export interface CreatePayoutInput {
  accountId: string;
  amount: bigint; // minor units, no float
  destinationAddress: string;
  idempotencyKey: string;
}

export interface Payout {
  id: string;
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
  status: PayoutStatus;
  txHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LedgerEntry {
  id: string;
  accountId: string;
  debit: bigint;
  credit: bigint;
  payoutId: string | null;
  createdAt: Date;
}

export interface OutboxMessage {
  id: string;
  payoutId: string;
  payload: string;
  status: 'pending' | 'processing' | 'done';
  attempts: number;
  createdAt: Date;
}

// Repository interface (defined here because ./payout.repository is not available)
export interface PayoutRepository {
  // ... methods
}

@Injectable()
export class PayoutService {
  // ...
}
```

Hmm, but this is getting complex. Let me think about what the service actually needs to do:

1. **createPayout(input)**: 
   - Check idempotency (if same key exists, return existing)
   - In a transaction: check available balance, reserve funds (debit available, credit in-transit), create payout record, create outbox message
   - Must be atomic to prevent overdraft

2. **processMessages()** (called by worker):
   - Fetch pending messages
   - For each: call provider.transfer()
   - On success: update payout to 'sent', record ledger entry (debit in-transit, credit external), mark message done
   - On transient failure: increment attempts, if < max, re-queue; else mark payout as 'needs_review' (safe: funds are still in in-transit, not lost)
   - On definitive failure: update payout to 'failed', release reservation (debit in-transit, credit available back)

Now for the "safe" choice on retry exhaustion: if we exhaust retries without a definitive outcome, we mark the payout as `needs_review`. This is safe because:
- The funds are still reserved (in the in-transit account), so the user can't spend them elsewhere
- We haven't confirmed the transfer, so we don't release funds
- A human or system can investigate whether the transfer actually went through
- This prevents both double-spending and losing funds

Let me now write the complete file. I need to be careful about what types to import vs define.

Actually, re-reading the errors more carefully:

```
src/payout/payout.service.ts(3,34): error TS2307: Cannot find module './payout.repository' or its corresponding type declarations.
src/payout/payout.service.ts(4,29): error TS2307: Cannot find module './payout.types' or its corresponding type declarations.
src/payout/payout.service.ts(5,53): error TS2307: Cannot find module './payout.types' or its corresponding type declarations.
```

Line 3 col 34 — this is importing something from `./payout.repository`. Col 34 suggests the import statement starts around there. If it's `import { PayoutRepository } from './payout.repository'`, let me count: `import { PayoutRepository } from './payout.repository'` — the `from` part... actually col 34 would be where the module string starts or where the imported name is. Let me not overthink the exact column and just know it's importing from those two modules.

Line 4 col 29: `import { SomeType } from './payout.types'` — col 29 might be where `SomeType` is
Line 5 col 53: `import { AnotherType } from './payout.types'` — col 53 might be where `AnotherType` is

The fact that there are two separate imports from `./payout.types` suggests two different type groups, or it could be one import with multiple named exports on one line... but they're on separate lines (4 and 5).

OK so my plan:
- Define all types I need in this file (export them so other files can import from here if needed)
- Define the repository as an interface in this file (or import it... but it doesn't exist)
- Actually, I'll define the `PayoutRepository` interface here and inject it

Wait, but the convention says the repository is a separate file. If I define the interface here, the concrete class in `payout.repository.ts` would implement it. That's actually a clean pattern — the service defines the contract (interface), and the repository implements it.

Let me write the complete service:

```typescript
import { Injectable, Inject, Logger } from '@nestjs/common';
import { PayoutRepository, ... } from './payout.repository'; // THIS WON'T COMPILE
```

No. I need to NOT import from `./payout.repository` since it doesn't exist. I'll define the interface locally.

Let me think about what the provider interface looks like. The variant says: `provider.transfer({to, amount}) -> {txHash}`, which may throw, time out, or succeed slowly.

The worker imports from `./payout.provider` — but that's the worker's problem, not the service's. The service doesn't directly call the provider; the worker does. Wait, actually let me re-read the architecture...

The convention says:
- controller: validates input, calls service
- service: holds logic, zero raw SQL, zero Prisma
- repository: only layer that touches DB

The worker would call the service for business logic and the repository for data access, and directly call the provider SDK. Or maybe the worker calls the service which calls the provider? Let me think...

Actually, looking at the worker's imports:
```
src/payout/payout.worker.ts(4,34): error TS2307: Cannot find module './payout.repository'
src/payout/payout.worker.ts(5,76): error TS2307: Cannot find module './payout.provider'
src/payout/payout.worker.ts(6,63): error TS2307: Cannot find module './payout.provider'
src/payout/payout.worker.ts(7,34): error TS2307: Cannot find module './payout.types'
```

So the worker imports from repository, provider (twice), and types. The worker seems to directly use the repository and provider.

For the service, it imports from repository and types (twice). So the service uses the repository and some types.

OK here's my final plan for `payout.service.ts`:

I'll define:
1. The types that the service needs (PayoutStatus, CreatePayoutInput, Payout, etc.) — these would normally be in `payout.types`
2. A `PayoutRepository` interface that defines the contract — this would normally be in `payout.repository` but I'll define the interface here
3. The `PayoutService` class with all business logic

The service will inject the repository (by interface) and implement:
- `createPayout(input)` — idempotent creation with balance check
- `processPayout(payoutId)` — handles the async processing logic (called by worker)
- Possibly `getPayout(id)` — for querying

Wait, but if the worker imports the service AND the repository AND the provider, then maybe the worker orchestrates and the service provides business logic methods. Let me design it so the service has methods that the worker can call.

Actually, let me think about this more carefully. The service "holds the logic". The worker is the thing that polls and triggers processing. The worker would:
1. Fetch pending messages (via repository)
2. For each message, call the provider (directly)
3. Call the service to record the outcome (via service)
4. Update the message status (via repository)

OR the service could have a `processMessage(message)` method that encapsulates the business logic of what to do with a message, and the worker just orchestrates the provider call and passes results to the service.

I think the cleaner design is:
- Worker fetches messages, calls provider, then calls `service.handleTransferResult(payoutId, result)`
- Service updates the payout status, ledger entries, etc.

Let me write this now. I'll define the repository interface with the methods the service needs.

```typescript
import { Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';

// ─── Types ───────────────────────────────────────────────────────────────────

export type PayoutStatus =
  | 'created'
  | 'processing'
  | 'sent'
  | 'completed'
  | 'failed'
  | 'needs_review';

export interface CreatePayoutInput {
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}

export interface Payout {
  id: string;
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
  status: PayoutStatus;
  txHash: string | null;
  maxRetries: number;
  retryCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface LedgerEntry {
  id: string;
  accountAvailableId: string;
  accountInTransitId: string;
  amount: bigint;
  direction: 'debit' | 'credit';
  payoutId: string | null;
  createdAt: Date;
}

export interface OutboxMessage {
  id: string;
  payoutId: string;
  status: 'pending' | 'processing' | 'done';
  attempts: number;
  nextAttemptAt: Date | null;
  createdAt: Date;
}

// ─── Repository contract ─────────────────────────────────────────────────────

export interface PayoutRepository {
  findByIdempotencyKey(key: string): Promise<Payout | null>;
  createWithReservation(payout: Omit<Payout, 'id' | 'createdAt' | 'updatedAt'>, ledgerEntry: Omit<LedgerEntry, 'id' | 'createdAt'>, message: Omit<OutboxMessage, 'id' | 'createdAt'>): Promise<Payout>;
  // ... etc
}
```

Hmm, this is getting quite involved. Let me think about what methods the service actually needs from the repository:

For `createPayout`:
- `findByIdempotencyKey(key)` → existing payout or null
- `createPayoutWithReservation(...)` → atomic: check balance, reserve, create payout, create message

For processing (called by worker):
- `findPendingMessages(limit)` → messages to process
- `claimMessage(id)` → atomically mark as processing (for at-least-once safety)
- `updatePayoutStatus(id, status, txHash?)` → update payout
- `recordLedgerEntry(entry)` → add ledger entry
- `completeMessage(id)` → mark done
- `scheduleRetry(messageId, attempts)` → increment attempts, set next attempt

Actually, for the at-least-once delivery requirement, the key insight is:
- The worker claims a message (marks it 'processing')
- Calls the provider
- If provider succeeds: update payout, record ledger, mark message 'done'
- If provider fails (transient): if attempts < max, re-queue (back to 'pending' with incremented attempts)
- If attempts >= max and no definitive outcome: mark payout 'needs_review', mark message 'done'

The "safe" thing on retry exhaustion: mark as `needs_review`. The funds remain in the in-transit holding. This is safe because:
- We don't release the reservation (so no double-spend)
- We don't mark as completed (so we don't claim a transfer that may not have happened)
- A human/operator can investigate and either complete or fail the payout

Now, for the idempotency + concurrency safety:
- The `createPayout` method must be idempotent on `idempotencyKey`
- The balance check + reservation must be atomic (in a DB transaction)
- Two racing requests with different keys but same account: the transaction with row-level locking ensures only one succeeds if balance is insufficient

The repository's `createPayoutWithReservation` would do:
```sql
BEGIN;
-- Lock the account row
SELECT * FROM accounts WHERE id = ? FOR UPDATE;
-- Check balance
-- If sufficient: debit available, credit in_transit (ledger entry), insert payout, insert message
-- If insufficient: raise error
COMMIT;
```

But the service doesn't do SQL — the repository does. The service just calls the repository method.

Let me also think about what happens with the ledger. Double-entry means:
- On creation (reservation): Debit: available_balance, Credit: in_transit (funds move from available to in-transit)
- On successful transfer: Debit: in_transit, Credit: external (funds leave the system)
- On failed transfer (reversal): Debit: in_transit, Credit: available_balance (funds go back)

The account's "settled balance" (available) changes:
- Decreases when a payout is created (reservation)
- Increases when a payout fails (reversal)
- Does NOT change on success (the in_transit → external transfer doesn't affect available)

Wait, that's interesting. The requirement says "The account's settled balance changes only when the provider confirms the transfer." Hmm, that's a different interpretation. Let me re-read:

"Keep a double-entry-style ledger. The account's settled balance changes only when the provider confirms the transfer."

So the interpretation is:
- The "settled balance" is what the user can actually use
- It only decreases when the transfer is confirmed (not when the payout is created)
- So on creation, we might just mark the funds as "reserved" but the settled balance hasn't changed yet?

Actually wait, that doesn't make sense for the overdraft prevention requirement. If the settled balance doesn't change on creation, then two racing requests could both see the full balance and both succeed.

Let me re-read requirement 3: "The account balance may be spent by concurrent payout requests. Two racing requests must never overdraw the account."

And requirement 5: "The account's settled balance changes only when the provider confirms the transfer."

These seem contradictory at first, but I think the resolution is:
- There's a "reserved" or "pending" amount that is subtracted from available at creation time (for overdraft prevention)
- The "settled balance" in the ledger sense (the actual accounting entry) is only recorded when the transfer is confirmed

So the account has:
- `total_balance` (what was deposited)
- `reserved_amount` (sum of all active payouts' amounts)
- `available = total_balance - reserved_amount` (what can be used for new payouts)

And the ledger entries:
- On creation: reserve the funds (available decreases)
- On confirmation: the ledger records the actual debit from the in-transit account to external
- The "settled balance" in the ledger = total_balance - confirmed_payouts

Hmm, actually I think the simplest interpretation that satisfies both requirements is:

The account table has:
- `balance` (the actual available funds, in minor units)
- `reserved` (funds reserved for in-progress payouts)

Available for new payouts = `balance - reserved`

On payout creation: `reserved += amount` (atomic, with row lock)
On payout success: `balance -= amount; reserved -= amount` (funds actually leave)
On payout failure: `reserved -= amount` (funds go back to available)

The "settled balance" = `balance` (only changes on success/failure, not on creation)
The "available for spending" = `balance - reserved` (changes on creation, preventing overdraft)

This satisfies both requirements:
- Req 3: Two racing requests can't overdraw because `reserved` increases atomically
- Req 5: The settled balance (`balance`) only changes when provider confirms

OK let me now write the actual code. I'll keep it focused and complete.

Actually, I realize I'm overcomplicating this. Let me look at what the service file needs to contain based on the imports:

The service imports:
- From `./payout.repository` (line 3): likely `PayoutRepository` (the class or interface)
- From `./payout.types` (line 4): one type
- From `./payout.types` (line 5): another type

Since I'm rewriting this file and those modules don't exist, I need to inline those definitions. Let me keep it pragmatic.

Let me write a clean, complete service that:
1. Defines the types it needs (exported for use by other files)
2. Defines the repository interface (exported for implementation by the repository file)
3. Implements the service logic

Here's my final attempt:

```typescript
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import type { PayoutRepository } from './payout.repository';
import type { PayoutStatus, CreatePayoutInput } from './payout.types';
```

Wait no, I CAN'T import from those files because they don't exist. That's the whole problem. I need to define everything in this file.

Let me write it out properly now.
```

## reply

```typescript
import { Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';

// ─── Types (inlined; ./payout.types is not present) ──────────────────────────

export type PayoutStatus =
  | 'created'
  | 'processing'
  | 'sent'
  | 'completed'
  | 'failed'
  | 'needs_review';

export interface CreatePayoutInput {
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}

export interface Payout {
  id: string;
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
  status: PayoutStatus;
  txHash: string | null;
  retryCount: number;
  maxRetries: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface LedgerEntry {
  id: string;
  payoutId: string;
  accountId: string;
  amount: bigint;
  /** 'reserve' | 'settle' | 'reverse' */
  kind: 'reserve' | 'settle' | 'reverse';
  createdAt: Date;
}

export interface OutboxMessage {
  id: string;
  payoutId: string;
  status: 'pending' | 'processing' | 'done';
  attempts: number;
  nextAttemptAt: Date | null;
  createdAt: Date;
}

// ─── Repository contract (inlined; ./payout.repository is not present) ──────

export interface PayoutRepository {
  findByIdempotencyKey(key: string): Promise<Payout | null>;
  findById(id: string): Promise<Payout | null>;

  /**
   * Atomically: lock the account row, verify (balance - reserved) >= amount,
   * increment reserved, insert payout (status='created'), insert outbox message.
   * Throws InsufficientFundsError on failure.
   */
  createWithReservation(input: CreatePayoutInput): Promise<Payout>;

  /**
   * Atomically: lock message row, set status='processing'. Returns null if
   * already claimed (at-least-once safety).
   */
  claimMessage(messageId: string): Promise<OutboxMessage | null>;

  findPendingMessages(limit: number): Promise<OutboxMessage[]>;

  completeMessage(messageId: string): Promise<void>;

  rescheduleMessage(messageId: string, nextAttemptAt: Date): Promise<void>;

  updatePayoutStatus(id: string, status: PayoutStatus, txHash?: string): Promise<Payout>;

  recordLedgerEntry(entry: Omit<LedgerEntry, 'id' | 'createdAt'>): Promise<LedgerEntry>;

  /**
   * On confirmed settlement: decrement balance AND reserved by amount.
   * On failure/reversal: decrement reserved only (funds return to available).
   */
  adjustBalances(accountId: string, amount: bigint, kind: 'settle' | 'reverse'): Promise<void>;
}

// ─── Custom error ─────────────────────────────────────────────────────────────

export class InsufficientFundsError extends Error {
  constructor(public readonly accountId: string, public readonly available: bigint, public readonly requested: bigint) {
    super(`Account ${accountId} has insufficient available funds: available=${available}, requested=${requested}`);
    this.name = 'InsufficientFundsError';
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

const MAX_RETRIES = 5;
const RETRY_BACKOFF_BASE_MS = 1_000;

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);

  constructor(private readonly repo: PayoutRepository) {}

  /**
   * Idempotent payout creation.
   * If the idempotencyKey has been seen before, returns the existing payout
   * without reserving funds again.
   */
  async createPayout(input: CreatePayoutInput): Promise<Payout> {
    // Idempotency check
    const existing = await this.repo.findByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      this.logger.debug(`Idempotent replay: key=${input.idempotencyKey} → payout=${existing.id} status=${existing.status}`);
      return existing;
    }

    try {
      return await this.repo.createWithReservation(input);
    } catch (err) {
      if (err instanceof InsufficientFundsError) {
        throw new BadRequestException({
          error: {
            code: 'insufficient_funds',
            message: err.message,
            details: { accountId: input.accountId, available: err.available, requested: input.requested },
          },
        });
      }
      // Race: another request with the same key created the payout between our
      // check and our insert. Re-fetch and return it.
      const raced = await this.repo.findByIdempotencyKey(input.idempotencyKey);
      if (raced) return raced;
      throw err;
    }
  }

  /**
   * Handles a single outbox message. Called by the worker after it has
   * successfully invoked the provider (or after the provider call failed).
   *
   * @param message  The claimed message.
   * @param result   Either the provider's success response or the error.
   */
  async handleMessage(
    message: OutboxMessage,
    result: { ok: true; txHash: string } | { ok: false; error: unknown; transient: boolean },
  ): Promise<void> {
    const payout = await this.repo.findById(message.payoutId);
    if (!payout) {
      this.logger.warn(`Message ${message.id} references unknown payout ${message.payoutId}; completing message.`);
      await this.repo.completeMessage(message.id);
      return;
    }

    if (result.ok) {
      // Provider confirmed the transfer.
      // 1. Record the definitive ledger entry (in_transit → external).
      // 2. Adjust balances: decrement both balance and reserved.
      // 3. Mark payout 'completed'.
      // 4. Mark message 'done'.
      await this.recordSettlement(payout, result.txHash);
      this.logger.info(`Payout ${payout.id} completed. tx=${result.txHash}`);
    } else if (result.transient) {
      // Transient failure: retry if budget remains, else mark needs_review.
      await this.handleTransientFailure(message, payout, result.error);
    } else {
      // Definitive failure: reverse the reservation.
      await this.recordFailure(payout, result.error);
      this.logger.info(`Payout ${payout.id} failed (definitive).`);
    }
  }

  /**
   * Records a confirmed settlement.
   */
  private async recordSettlement(payout: Payout, txHash: string): Promise<void> {
    await this.repo.recordLedgerEntry({
      payoutId: payout.id,
      accountId: payout.accountId,
      amount: payout.amount,
      kind: 'settle',
    });
    await this.repo.adjustBalances(payout.accountId, payout.amount, 'settle');
    await this.repo.updatePayoutStatus(payout.id, 'completed', txHash);
    await this.repo.completeMessage(/* message id is on the caller's message object; see below */ '');
    // Note: the worker calls completeMessage with the actual message id after this returns.
  }

  /**
   * Handles a transient provider failure.
   * Safe behaviour on retry exhaustion: mark the payout 'needs_review'.
   * Rationale: we do NOT know whether the transfer went through. The reserved
   * funds remain held, so the account cannot be overdrawn. An operator (or a
   * reconciliation job) must confirm the outcome before releasing or completing.
   */
  private async handleTransientFailure(
    message: OutboxMessage,
    payout: Payout,
    error: unknown,
  ): Promise<void> {
    const attempts = message.attempts + 1;

    if (attempts < payout.maxRetries) {
      const backoff = RETRY_BACKOFF_BASE_MS * Math.pow(2, attempts - 1);
      const next = new Date(Date.now() + backoff);
      this.logger.warn(
        `Payout ${payout.id} transient failure (attempt ${attempts}/${payout.maxRetries}); retrying at ${next.toISOString()}`,
      );
      await this.repo.rescheduleMessage(message.id, next);
      await this.repo.updatePayoutStatus(payout.id, 'processing');
    } else {
      // Exhausted retries without a definitive outcome.
      // Safe: funds stay reserved. Status 'needs_review' flags for manual action.
      this.logger.error(
        `Payout ${payout.id} exhausted ${payout.maxRetries} retries; marking needs_review. Last error: ${String(error)}`,
      );
      await this.repo.updatePayoutStatus(payout.id, 'needs_review');
      await this.repo.completeMessage(message.id);
    }
  }

  /**
   * Records a definitive failure and reverses the reservation.
   */
  private async recordFailure(payout: Payout, error: unknown): Promise<void> {
    await this.repo.recordLedgerEntry({
      payoutId: payout.id,
      accountId: payout.accountId,
      amount: payout.amount,
      kind: 'reverse',
    });
    await this.repo.adjustBalances(payout.accountId, payout.amount, 'reverse');
    await this.repo.updatePayoutStatus(payout.id, 'failed');
    this.logger.debug(`Payout ${payout.id} failed; reservation reversed. error=${String(error)}`);
  }
}
```

Wait — I have a problem in `recordSettlement`: I'm calling `completeMessage('')` with an empty string because I don't have the message id there. Let me restructure so the message id flows properly.

Let me also reconsider: the `completeMessage` call should happen with the actual message id. I should pass it into `recordSettlement`, or the worker should handle it. Let me refactor to pass the message id.

Also, I realize I should double-check: the task says "Change nothing the messages do not name." The messages only name `src/payout/payout.service.ts`. So I'm rewriting that one file. Good.

Let me also add an `// ASSUMPTION:` comment where needed. The main assumption is that I'm inlining types and the repository interface because the referenced modules don't exist.

Let me rewrite cleanly:

```typescript
import { Injectable, Logger, BadRequestException } from '@nestjs/common';

// ASSUMPTION: ./payout.types and ./payout.repository do not exist in this workspace;
// their contents are inlined here so that this file compiles.

// ─── Types ────────────────────────────────────────────────────────────────────

export type PayoutStatus =
  | 'created'
  | 'processing'
  | 'sent'
  | 'completed'
  | 'failed'
  | 'needs_review';

export interface CreatePayoutInput {
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}

export interface Payout {
  id: string;
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
  status: PayoutStatus;
  txHash: string | null;
  retryCount: number;
  maxRetries: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface LedgerEntry {
  id: string;
  payoutId: string;
  accountId: string;
  amount: bigint;
  kind: 'reserve' | 'settle' | 'reverse';
  createdAt: Date;
}

export interface OutboxMessage {
  id: string;
  payoutId: string;
  status: 'pending' | 'processing' | 'done';
  attempts: number;
  nextAttemptAt: Date | null;
  createdAt: Date;
}

// ─── Repository contract ──────────────────────────────────────────────────────

export interface PayoutRepository {
  findByIdempotencyKey(key: string): Promise<Payout | null>;
  findById(id: string): Promise<Payout | null>;
  createWithReservation(input: CreatePayoutInput): Promise<Payout>;
  claimMessage(messageId: string): Promise<OutboxMessage | null>;
  findPendingMessages(limit: number): Promise<OutboxMessage[]>;
  completeMessage(messageId: string): Promise<void>;
  rescheduleMessage(messageId: string, nextAttemptAt: Date): Promise<void>;
  updatePayoutStatus(id: string, status: PayoutStatus, txHash?: string): Promise<Payout>;
  recordLedgerEntry(entry: Omit<LedgerEntry, 'id' | 'createdAt'>): Promise<LedgerEntry>;
  adjustBalances(accountId: string, amount: bigint, kind: 'settle' | 'reverse'): Promise<void>;
}

// ─── Domain error ─────────────────────────────────────────────────────────────

export class InsufficientFundsError extends Error {
  constructor(
    public readonly accountId: string,
    public readonly available: bigint,
    public readonly requested: bigint,
  ) {
    super(`Account ${accountId} has insufficient funds: available=${available}, requested=${requested}`);
    this.name = 'InsufficientFundsError';
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MAX_RETRIES = 5;
const RETRY_BACKOFF_BASE_MS = 1_000;

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);

  constructor(private readonly repo: PayoutRepository) {}

  /**
   * Idempotent payout creation.
   * Retrying with the same idempotencyKey returns the existing payout
   * without reserving funds a second time.
   */
  async createPayout(input: CreatePayoutInput): Promise<Payout> {
    const existing = await this.repo.findByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      this.logger.debug(
        `Idempotent replay: key=${input.idempotencyKey} → payout=${existing.id} status=${existing.status}`,
      );
      return existing;
    }

    try {
      return await this.repo.createWithReservation(input);
    } catch (err) {
      if (err instanceof InsufficientFundsError) {
        throw new BadRequestException({
          error: {
            code: 'insufficient_funds',
            message: err.message,
            details: {
              accountId: err.accountId,
              available: err.available,
              requested: err.requested,
            },
          },
        });
      }
      // Race: another request with the same key committed between our read and
      // our write. The unique constraint on idempotency_key would have caused a
      // conflict; re-fetch to return the winner.
      const raced = await this.repo.findByIdempotencyKey(input.idempotencyKey);
      if (raced) return raced;
      throw err;
    }
  }

  /**
   * Processes a single outbox message after the worker has called the provider.
   * At-least-once safe: the same (payout, message) pair may be processed more
   * than once; the status transitions are idempotent.
   */
  async handleMessage(
    message: OutboxMessage,
    result: { ok: true; txHash: string } | { ok: false; transient: boolean; error: unknown },
  ): Promise<void> {
    const payout = await this.repo.findById(message.payoutId);
    if (!payout) {
      this.logger.warn(`Message ${message.id} references missing payout ${message.payoutId}; completing.`);
      await this.repo.completeMessage(message.id);
      return;
    }

    // Idempotency guard: if the payout is already in a terminal state, do nothing.
    if (payout.status === 'completed' || payout.status === 'failed') {
      this.logger.debug(`Payout ${payout.id} already ${payout.status}; skipping duplicate delivery.`);
      await this.repo.completeMessage(message.id);
      return;
    }

    if (result.ok) {
      await this.settle(payout, message.id, result.txHash);
    } else if (result.transient) {
      await this.transientFailure(payout, message, result.error);
    } else {
      await this.definitiveFailure(payout, message.id);
    }
  }

  /**
   * Provider confirmed the transfer.
   * Ledger: in_transit → external. Balances: balance -= amount, reserved -= amount.
   */
  private async settle(payout: Payout, messageId: string, txHash: string): Promise<void> {
    await this.repo.recordLedgerEntry({
      payoutId: payout.id,
      accountId: payout.accountId,
      amount: payout.amount,
      kind: 'settle',
    });
    await this.repo.adjustBalances(payout.accountId, payout.amount, 'settle');
    await this.repo.updatePayoutStatus(payout.id, 'completed', txHash);
    await this.repo.completeMessage(messageId);
    this.logger.info(`Payout ${payout.id} completed (tx=${txHash}).`);
  }

  /**
   * Transient provider failure.
   * If retry budget remains: reschedule with exponential backoff.
   * If exhausted: mark 'needs_review'. Funds stay reserved — the account cannot
   * be overdrawn, and no funds are released until an operator confirms the
   * outcome. This is the safe choice because we have no definitive signal
   * whether the transfer actually landed on-chain.
   */
  private async transientFailure(
    payout: Payout,
    message: OutboxMessage,
    error: unknown,
  ): Promise<void> {
    const attempts = message.attempts + 1;

    if (attempts < payout.maxRetries) {
      const backoffMs = RETRY_BACKOFF_BASE_MS * 2 ** (attempts - 1);
      const nextAttemptAt = new Date(Date.now() + backoffMs);
      this.logger.warn(
        `Payout ${payout.id} transient (attempt ${attempts}/${payout.maxRetries}); retry at ${nextAttemptAt.toISOString()}. err=${String(error)}`,
      );
      await this.repo.updatePayoutStatus(payout.id, 'processing');
      await this.repo.rescheduleMessage(message.id, nextAttemptAt);
    } else {
      this.logger.error(
        `Payout ${payout.id} exhausted ${payout.maxRetries} retries without definitive outcome; marking needs_review. Last err=${String(error)}`,
      );
      await this.repo.updatePayoutStatus(payout.id, 'needs_review');
      await this.repo.completeMessage(message.id);
    }
  }

  /**
   * Definitive provider failure (e.g. invalid address, insufficient provider balance).
   * Ledger: in_transit → available (reversal). Balances: reserved -= amount.
   */
  private async definitiveFailure(payout: Payout, messageId: string): Promise<void> {
    await this.repo.recordLedgerEntry({
      payoutId: payout.id,
      accountId: payout.accountId,
      amount: payout.amount,
      kind: 'reverse',
    });
    await this.repo.adjustBalances(payout.accountId, payout.amount, 'reverse');
    await this.repo.updatePayoutStatus(payout.id, 'failed');
    await this.repo.completeMessage(messageId);
    this.logger.info(`Payout ${payout.id} failed; reservation reversed.`);
  }
}
```

Hmm wait, I need to double-check: does this file have any other issues? Let me check for implicit `any` — the errors for `payout.service.ts` were only the three TS2307 module-not-found errors. No TS7006 (implicit any) errors were listed for this file. So the only thing I need to fix is the imports.

By inlining the types and the repository interface, I eliminate the three TS2307 errors. The file should now compile.

Let me also make sure I'm not using anything that would cause a new error. `BigInt` is available in Node 20+. `2 ** (attempts - 1)` — that's a number exponentiation, fine. No floating point for money (I use `bigint` for amounts). Good.

One more check: the `BadRequestException` with a custom object — in NestJS, `BadRequestException` can accept a string or an object. If I pass an object, it becomes the `response` property of the HTTP error. The convention shows the error envelope as `{ "error": { "code": ..., "message": ..., "details": ... } }`. I should make sure my thrown exception produces that shape. Actually, NestJS's `HttpException` when given an object will use it as the response body. But the convention wants a specific envelope. Let me just keep it as is — the controller or a global exception filter would format it. Actually, looking at the convention again, it says "Errors — one envelope" which is the HTTP response format. The service throwing a `BadRequestException` with the right object shape should work if the exception filter wraps it properly. I'll keep it.

Actually, I realize I should simplify. The service shouldn't necessarily construct the full HTTP envelope — that's the controller's or exception filter's job. But the convention says the service holds logic and the controller validates input. The error envelope is a response format concern. Let me just throw a domain error and let the controller/filter handle the HTTP mapping. But actually, for a clean implementation, I'll keep the `BadRequestException` in the service since the service is the one that knows the error code. This is a common NestJS pattern.

I'm satisfied with the file. Let me finalize it.
</think>

```typescript
import { Injectable, Logger, BadRequestException } from '@nestjs/common';

// ASSUMPTION: ./payout.types and ./payout.repository do not exist in this workspace;
// their type definitions are inlined here so this file compiles standalone.

// ─── Types ────────────────────────────────────────────────────────────────────

export type PayoutStatus =
  | 'created'
  | 'processing'
  | 'sent'
  | 'completed'
  | 'failed'
  | 'needs_review';

export interface CreatePayoutInput {
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}

export interface Payout {
  id: string;
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
  status: PayoutStatus;
  txHash: string | null;
  retryCount: number;
  maxRetries: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface LedgerEntry {
  id: string;
  payoutId: string;
  accountId: string;
  amount: bigint;
  kind: 'reserve' | 'settle' | 'reverse';
  createdAt: Date;
}

export interface OutboxMessage {
  id: string;
  payoutId: string;
  status: 'pending' | 'processing' | 'done';
  attempts: number;
  nextAttemptAt: Date | null;
  createdAt: Date;
}

// ─── Repository contract ──────────────────────────────────────────────────────

export interface PayoutRepository {
  findByIdempotencyKey(key: string): Promise<Payout | null>;
  findById(id: string): Promise<Payout | null>;
  createWithReservation(input: CreatePayoutInput): Promise<Payout>;
  claimMessage(messageId: string): Promise<OutboxMessage | null>;
  findPendingMessages(limit: number): Promise<OutboxMessage[]>;
  completeMessage(messageId: string): Promise<void>;
  rescheduleMessage(messageId: string, nextAttemptAt: Date): Promise<void>;
  updatePayoutStatus(id: string, status: PayoutStatus, txHash?: string): Promise<Payout>;
  recordLedgerEntry(entry: Omit<LedgerEntry, 'id' | 'createdAt'>): Promise<LedgerEntry>;
  adjustBalances(accountId: string, amount: bigint, kind: 'settle' | 'reverse'): Promise<void>;
}

// ─── Domain error ─────────────────────────────────────────────────────────────

export class InsufficientFundsError extends Error {
  constructor(
    public readonly accountId: string,
    public readonly available: bigint,
    public readonly requested: bigint,
  ) {
    super(`Account ${accountId} has insufficient funds: available=${available}, requested=${requested}`);
    this.name = 'InsufficientFundsError';
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const RETRY_BACKOFF_BASE_MS = 1_000;

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);

  constructor(private readonly repo: PayoutRepository) {}

  /**
   * Idempotent payout creation.
   * Retrying with the same idempotencyKey returns the existing payout
   * without reserving funds a second time.
   */
  async createPayout(input: CreatePayoutInput): Promise<Payout> {
    const existing = await this.repo.findByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      this.logger.debug(
        `Idempotent replay: key=${input.idempotencyKey} → payout=${existing.id} status=${existing.status}`,
      );
      return existing;
    }

    try {
      return await this.repo.createWithReservation(input);
    } catch (err) {
      if (err instanceof InsufficientFundsError) {
        throw new BadRequestException({
          error: {
            code: 'insufficient_funds',
            message: err.message,
            details: {
              accountId: err.accountId,
              available: err.available,
              requested: err.requested,
            },
          },
        });
      }
      // Race: another request with the same key committed between our read and
      // our write (unique constraint on idempotency_key caused a conflict).
      // Re-fetch to return the winner.
      const raced = await this.repo.findByIdempotencyKey(input.idempotencyKey);
      if (raced) return raced;
      throw err;
    }
  }

  /**
   * Processes a single outbox message after the worker has called the provider.
   * At-least-once safe: if the same message is delivered twice, the idempotency
   * guard below ensures no double-settlement or double-reversal occurs.
   */
  async handleMessage(
    message: OutboxMessage,
    result: { ok: true; txHash: string } | { ok: false; transient: boolean; error: unknown },
  ): Promise<void> {
    const payout = await this.repo.findById(message.payoutId);
    if (!payout) {
      this.logger.warn(`Message ${message.id} references missing payout ${message.payoutId}; completing.`);
      await this.repo.completeMessage(message.id);
      return;
    }

    // Idempotency guard: terminal states mean the outcome is already recorded.
    if (payout.status === 'completed' || payout.status === 'failed') {
      this.logger.debug(`Payout ${payout.id} already ${payout.status}; skipping duplicate delivery.`);
      await this.repo.completeMessage(message.id);
      return;
    }

    if (result.ok) {
      await this.settle(payout, message.id, result.txHash);
    } else if (result.transient) {
      await this.transientFailure(payout, message, result.error);
    } else {
      await this.definitiveFailure(payout, message.id);
    }
  }

  /**
   * Provider confirmed the transfer.
   * Ledger: in_transit → external (funds leave the system).
   * Balances: settled balance decremented, reservation released.
   */
  private async settle(payout: Payout, messageId: string, txHash: string): Promise<void> {
    await this.repo.recordLedgerEntry({
      payoutId: payout.id,
      accountId: payout.accountId,
      amount: payout.amount,
      kind: 'settle',
    });
    await this.repo.adjustBalances(payout.accountId, payout.amount, 'settle');
    await this.repo.updatePayoutStatus(payout.id, 'completed', txHash);
    await this.repo.completeMessage(messageId);
    this.logger.info(`Payout ${payout.id} completed (tx=${txHash}).`);
  }

  /**
   * Transient provider failure.
   *
   * If retry budget remains: reschedule with exponential backoff.
   * If exhausted: mark 'needs_review'.
   *
   * Rationale for 'needs_review' on exhaustion: we have no definitive signal
   * whether the transfer landed on-chain. Releasing the reservation would risk
   * double-spend (the transfer may have succeeded); marking it failed would
   * risk losing funds (the transfer may not have executed). Holding the
   * reservation in 'needs_review' is the only option that is safe against
   * both failure modes. An operator or reconciliation job must confirm the
   * on-chain state before the payout is completed or reversed.
   */
  private async transientFailure(
    payout: Payout,
    message: OutboxMessage,
    error: unknown,
  ): Promise<void> {
    const attempts = message.attempts + 1;

    if (attempts < payout.maxRetries) {
      const backoffMs = RETRY_BACKOFF_BASE_MS * 2 ** (attempts - 1);
      const nextAttemptAt = new Date(Date.now() + backoffMs);
      this.logger.warn(
        `Payout ${payout.id} transient (attempt ${attempts}/${payout.maxRetries}); retry at ${nextAttemptAt.toISOString()}. err=${String(error)}`,
      );
      await this.repo.updatePayoutStatus(payout.id, 'processing');
      await this.repo.rescheduleMessage(message.id, nextAttemptAt);
    } else {
      this.logger.error(
        `Payout ${payout.id} exhausted ${payout.maxRetries} retries without definitive outcome; marking needs_review. Last err=${String(error)}`,
      );
      await this.repo.updatePayoutStatus(payout.id, 'needs_review');
      await this.repo.completeMessage(message.id);
    }
  }

  /**
   * Definitive provider failure (e.g. invalid address, rejected by provider).
   * Ledger: in_transit → available (reversal; funds return to spendable).
   * Balances: reservation released, settled balance unchanged.
   */
  private async definitiveFailure(payout: Payout, messageId: string): Promise<void> {
    await this.repo.recordLedgerEntry({
      payoutId: payout.id,
      accountId: payout.accountId,
      amount: payout.amount,
      kind: 'reverse',
    });
    await this.repo.adjustBalances(payout.accountId, payout.amount, 'reverse');
    await this.repo.updatePayoutStatus(payout.id, 'failed');
    await this.repo.completeMessage(messageId);
    this.logger.info(`Payout ${payout.id} failed; reservation reversed.`);
  }
}
```
