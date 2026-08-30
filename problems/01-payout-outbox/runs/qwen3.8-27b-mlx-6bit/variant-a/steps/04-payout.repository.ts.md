# 04-payout.repository.ts

## reply

Let me carefully analyze the plan to write `src/payout/payout.repository.ts`.

From the plan:

**`src/payout/payout.repository.ts`**
```ts
@Injectable()
export class PayoutRepository {
  constructor(prisma: PrismaClient);

  // Atomic: lock the account row, check available balance, decrement reserved,
  // insert payout (CREATED) + message (PENDING). Single transaction.
  // Returns { payoutId }, or throws InsufficientFundsError / DuplicatePayoutError.
  createPayoutWithMessage(input: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<{ payoutId: string }>;

  // Claim a pending message: set status to PROCESSING, claimedAt to now,
  // increment attempts. Use SELECT ... FOR UPDATE SKIP LOCKED.
  // Return the message, or null if none available / already claimed.
  claimMessage(messageId: string): Promise<MessageRow | null>;

  // Mark payout as PROCESSING, set processedAt.
  markProcessing(payoutId: string): Promise<void>;

  // Record a provider attempt failure: increment attempts, set lastError.
  recordAttemptFailure(payoutId: string, error: string): Promise<void>;

  // On success: payout SENT → COMPLETED, set txHash, completedAt.
  // Post a DEBIT ledger entry (amount) to the account, decrement reserved, decrement settled.
  // Mark message as DONE. Single transaction.
  completePayout(payoutId: string, txHash: string): Promise<void>;

  // On definitive failure: payout FAILED, completedAt to now.
  // Release reservation (reserved -= amount). No ledger entry.
  // Mark message as DONE. Single transaction.
  failPayout(payoutId: string): Promise<void>;

  // On retry exhaustion without a definitive outcome: payout to NEEDS_REVIEW.
  // Keep reservation. No ledger entry. Mark message as DEAD.
  markNeedsReview(payoutId: string): Promise<void>;

  // Fetch pending messages (for worker polling).
  findPendingMessages(limit: number): Promise<MessageRow[]>;

  // Fetch message by id (for reprocessing / duplicate delivery).
  findMessageById(id: string): Promise<MessageRow | null>;

  // Idempotency check: does a payout already exist for this key?
  findPayoutByAccountIdemKey(accountId: string, idempotencyKey: string): Promise<{ payoutId: string } | null>;
}
```

**`MessageRow`** (internal, not exported): `{ id: string; payoutId: string; accountId: string; status: MessageStatus; attempts: number }`.

Wait — the plan says `MessageRow` is "internal, not exported". But `claimMessage` returns `Promise<MessageRow | null>`. If MessageRow is not exported, the return type references a non-exported type. In TypeScript, you can use a non-exported type in the signature of an exported class method — it's allowed (the compiler will warn if declaration emit is enabled, but that's fine). Actually, in strict mode with `declaration: true`, you'd get a "has or is using private name" error. But the plan explicitly says "internal, not exported". Hmm. Let me think about this.

The plan's signature shows `claimMessage(messageId: string): Promise<MessageRow | null>;` and `findPendingMessages(limit: number): Promise<MessageRow[]>`. And it says "`MessageRow` (internal, not exported)".

Options:
1. Define `type MessageRow = {...}` without export. TypeScript allows using a non-exported type in the public API of an exported class. This compiles fine without declaration emit. The plan says "not exported", so I'll define it as a module-level non-exported type.

Actually wait — can you reference a non-exported type in the signature of an exported method? Yes, TypeScript allows this. The error only occurs when generating declaration files (`declaration: true`). Since the plan explicitly says "internal, not exported", I'll follow it.

Hmm, but is this really the most defensible interpretation? The plan's manifest says "PayoutRepository: all DB access — ...". The section in the plan titled "**`MessageRow`** (internal, not exported)" strongly suggests a non-exported type declaration. I'll go with that.

Now, the ordering rules from §3:
- `createPayoutWithMessage` must lock the account row **before** checking balance and inserting, to prevent concurrent overdraw.
- `completePayout` must post the ledger entry **before** updating the account's cached balance columns, in the same transaction.
- `processMessage` must claim (flip to PROCESSING) **before** calling the provider — but that's in the service, not the repository.
- On duplicate message delivery (message already DONE/DEAD), `processMessage` must be a no-op — service level.

Transaction boundaries:

1. **`createPayoutWithMessage`** (one transaction):
   - `SELECT ... FOR UPDATE` on the account row.
   - Check `settledBalance - reservedAmount >= amount`. If not, throw `InsufficientFundsError`.
   - Check idempotency: if a payout already exists for `(accountId, idempotencyKey)`, throw `DuplicatePayoutError`.
   - Increment `reservedAmount` by `amount`.
   - Insert payout row (status CREATED).
   - Insert message row (status PENDING).
   - Commit.

2. **`claimMessage`** (one transaction):
   - `SELECT ... FOR UPDATE SKIP LOCKED` the message row.
   - If status is not PENDING, return null (already claimed or done).
   - Set status to PROCESSING, `claimedAt` = now, increment `attempts`.
   - Commit.

3. **`completePayout`** (one transaction):
   - Set payout status to COMPLETED, `txHash`, `completedAt`.
   - Insert ledger entry (DEBIT, amount) for the account.
   - Decrement `reservedAmount` by `amount`, decrement `settledBalance` by `amount`.
   - Set message status to DONE.
   - Commit.

Wait, the plan says "On success: payout SENT → COMPLETED". In §4 it says "SENT is set when the provider returns a `txHash` (transfer confirmed on-chain). COMPLETED is set immediately after SENT in the same transaction that posts the ledger entry. In practice SENT and COMPLETED are set together." So in `completePayout` we set status to COMPLETED (the SENT→COMPLETED transition happens within the same transaction; in practice set together). Should we set SENT first and then COMPLETED in the same transaction? The plan says "In practice SENT and COMPLETED are set together". So just set to COMPLETED. But the method comment says "payout SENT → COMPLETED". To be safe, we could do two updates: set SENT then set COMPLETED. But the plan says "In practice SENT and COMPLETED are set together" — meaning a single update to COMPLETED suffices. Hmm, but does the state machine require SENT to be observable? §4 says "SENT exists as a distinct state for observability if the ledger post is deferred". In our implementation the ledger post isn't deferred, so SENT and COMPLETED are set together. I'll just set to COMPLETED in a single update. Actually, to be more faithful to "SENT → COMPLETED", we could do `update` to SENT then `update` to COMPLETED within the same transaction. That's two writes but both in one transaction — no observable difference. The simplest, most defensible reading: set to COMPLETED directly (set together). Let me re-read: "On success: payout SENT → COMPLETED, set txHash, completedAt." I think a single update to COMPLETED is fine and matches "In practice SENT and COMPLETED are set together".

Hmm, but wait — should we actually go through SENT explicitly? The plan's state machine lists SENT as a state. If tests check the lifecycle... The test list in §5 doesn't mention checking SENT as an intermediate state. "The payout reaches COMPLETED with a single ledger entry". So COMPLETED is what's checked. I'll go with a single update to COMPLETED. Actually, on reflection: doing `updateMany({ where: { id, status: SENT }, ... })` pattern... no. Keep it simple: single update to COMPLETED with txHash and completedAt.

4. **`failPayout`** (one transaction):
   - Set payout status to FAILED, completedAt.
   - Decrement `reservedAmount` by `amount` (release reservation). No ledger entry.
   - Set message status to DONE.
   - Commit.

5. **`markNeedsReview`** (one transaction):
   - Set payout status to NEEDS_REVIEW.
   - Keep reservation. No ledger entry.
   - Set message status to DEAD.
   - Commit.

Now, Prisma specifics:

- `FOR UPDATE` locking in Prisma: Prisma doesn't natively support `SELECT ... FOR UPDATE`. The standard approach is to use `prisma.$queryRaw` or `$executeRaw` inside a transaction. The plan says "Use SELECT ... FOR UPDATE SKIP LOCKED" for claimMessage and "`SELECT ... FOR UPDATE` on the account row" for createPayoutWithMessage. So we need raw SQL via `$queryRaw`/`$executeRaw`.

The convention says "repository is the only layer that touches the database" and "service: zero raw SQL". The repository can use raw SQL. Good.

Approach for `createPayoutWithMessage`:

```ts
async createPayoutWithMessage(input) {
  return this.prisma.$transaction(async (tx) => {
    // lock account row
    const accounts = await tx.$queryRaw<Array<{ id: string; settled_balance: bigint; reserved_amount: bigint }>>`
      SELECT id, settled_balance, reserved_amount FROM accounts WHERE id = ${input.accountId} FOR UPDATE
    `;
    const account = accounts[0];
    if (!account) throw ... // what error? Account not found. The plan doesn't specify an error for a nonexistent account in the repository. Hmm.
    ...
  });
}
```

Wait — what if the account doesn't exist? The plan doesn't mention it. The service's `createPayout` throws InsufficientFundsError or DuplicatePayoutError per the repository's comment: "Returns { payoutId }, or throws InsufficientFundsError / DuplicatePayoutError." So the plan assumes the account exists. But in reality, it might not. What's the most defensible reading? The plan's error list includes `PayoutNotFoundError` (code: "resource_not_found") in the service. But the repository comment only lists InsufficientFundsError / DuplicatePayoutError.

Hmm. Options:
1. Throw a `PayoutNotFoundError`-like error for a missing account — but the errors are defined in the service file (`payout.service.ts`), and the repository would need to import from there. The manifest's "reads" for the repository lists only `src/payout/payout.provider.ts` as a read. Wait:

"src/payout/payout.repository.ts | reads: src/payout/payout.provider.ts | PayoutRepository: all DB access — ..."

Hmm, the repository reads the provider file? That's odd — why would the repository need the provider? Probably for... hmm, actually nothing. Maybe a manifest error, or maybe the repository doesn't need the provider at all. Wait, actually the "reads" column probably lists files that this file depends on / reads from. For the repository, depending on the provider makes no sense. Unless it's a mistake in the plan. But I should follow the plan. The repository signature doesn't use PayoutProvider. I won't import it — importing an unused symbol is bad practice, and the instruction says "Implement exactly what the plan specifies for this file." The signature doesn't reference the provider. I'll skip that import.

But wait — the errors: `InsufficientFundsError` and `DuplicatePayoutError` are defined in `payout.service.ts` per the plan (§3: "src/payout/payout.service.ts ... PayoutError and subclasses"). But the repository throws them per its comment: "Returns { payoutId }, or throws InsufficientFundsError / DuplicatePayoutError."

This is a circular dependency problem: the service imports the repository, and the repository imports the errors from the service. TypeScript handles circular imports fine for types/classes used at runtime... actually, class inheritance across circular imports can be problematic. `InsufficientFundsError extends PayoutError` — if the repository imports from the service and the service imports the repository, at module load time: the service module starts loading, imports the repository, the repository imports the service (circular), gets a partial module... The `PayoutError` class might not be defined yet when `InsufficientFundsError` is being defined → "Class extends value undefined" error.

Hmm, this is a real concern. But wait — the plan says the errors are in `payout.service.ts`. And the repository throws them. So the plan mandates this circular import. In ESM, circular imports work as long as you don't access the binding at module evaluation time in a way that hits undefined. Class declarations are hoisted... no, class declarations are not hoisted for use before definition (they're in the temporal dead zone). So if the service module is evaluated first: service.ts starts → imports repository.ts → repository.ts starts → imports service.ts (circular, gets a live binding but the class isn't defined yet) → repository.ts evaluates `class InsufficientFundsError ...` — no wait, the error classes are in service.ts, not repository.ts. Let me redo this.

service.ts:
```ts
import { PayoutRepository } from './payout.repository.js';
export class PayoutError extends Error {}
export class InsufficientFundsError extends PayoutError {}
...
@Injectable()
export class PayoutService { constructor(repo: PayoutRepository) {...} }
```

repository.ts:
```ts
import { InsufficientFundsError, DuplicatePayoutError } from './payout.service.js';
@Injectable()
export class PayoutRepository { ... throws new InsufficientFundsError(...) }
```

Load order: main imports service.ts (via the module). service.ts starts evaluating. It hits `import { PayoutRepository } from './payout.repository.js'` → repository.ts starts evaluating. repository.ts hits `import { InsufficientFundsError } from './payout.service.js'` → circular, service.ts is mid-evaluation, so repository gets a module namespace with uninitialized bindings (TDZ). repository.ts continues: `class PayoutRepository` is defined — its methods reference `InsufficientFundsError` only at call time, not at class definition time. So repository.ts finishes evaluating fine. Back to service.ts: `PayoutError` is defined, `InsufficientFundsError` is defined, etc. No problem!

The issue only arises if the entry point loads repository.ts first: repository.ts starts → imports service.ts → service.ts starts → imports repository.ts (circular, mid-evaluation) → service.ts continues: PayoutError is defined, InsufficientFundsError is defined (extends PayoutError — fine, same module), `class PayoutService` references `PayoutRepository` only in the constructor type (type-only, erased) and... the constructor parameter `repo: PayoutRepository` — type-only, erased at runtime. So service.ts finishes evaluating fine. Back to repository.ts: PayoutRepository is defined.

So as long as neither module uses the other's bindings at class definition time (only at call time), the circular import works in ESM. The `@Injectable()` decorator — does it evaluate anything at class definition time? NestJS's `@Injectable()` without metadata is just a decorator that registers design metadata (design:paramtypes) — with `emitDecoratorMetadata`, the constructor parameter types become runtime values: `design:paramtypes` would reference `PayoutRepository` in the service's decorator... wait, the service's constructor parameter is `repo: PayoutRepository` — with emitDecoratorMetadata, TypeScript emits `__metadata("design:paramtypes", [PayoutRepository])` — that's a runtime reference! And the repository's constructor parameter is `prisma: PrismaClient` — no circular reference.

So in the service.ts decorator: `@Injectable()` on PayoutService emits design:paramtypes referencing PayoutRepository. If service.ts is evaluated first: it imports repository.ts → repository.ts imports service.ts (circular) → repository.ts evaluates fine (its design:paramtypes references PrismaClient from @prisma/client — no problem) → back to service.ts: PayoutError etc. are defined, then `@Injectable() class PayoutService` → design:paramtypes evaluates `PayoutRepository` — already defined (repository.ts fully evaluated). No problem.

If repository.ts is evaluated first: it imports service.ts → service.ts imports repository.ts (circular, mid-evaluation) → service.ts continues: PayoutError is defined... then `@Injectable() class PayoutService` → design:paramtypes evaluates `PayoutRepository` — TDZ! Not defined yet (repository.ts is still in its import phase). → ReferenceError: Cannot access 'PayoutRepository' before initialization.

Hmm, so with decorator metadata, the load order matters. In NestJS apps, modules import services, and the module file imports controllers, services, etc. The order in which module files are evaluated... typically the app.module imports PayoutModule, which imports the controller → the controller imports the service → the service imports the repository. So service.ts is evaluated before repository.ts? No wait: the controller imports the service; the service's import of the repository happens when service.ts is evaluated. So the order: controller.ts → service.ts → (service.ts imports repository.ts) → repository.ts → (repository.ts imports service.ts, circular, fine). So service.ts is the entry into the cycle. As analyzed, that works.

But in tests (test/payout.spec.ts), the test might import PayoutRepository directly first... if the test imports both, the order depends on the import statement order in the test file. If the test imports `payout.repository.ts` first, we hit the TDZ problem with design:paramtypes.

Hmm, this is getting deep. But wait — do I even need to import the error classes from the service? Let me re-read the plan.

The plan §3 for the repository: "Returns { payoutId }, or throws InsufficientFundsError / DuplicatePayoutError."

And the service: "createPayout ... Throws InsufficientFundsError if available < amount. Throws DuplicatePayoutError if (accountId, idempotencyKey) already exists."

So who actually throws? The repository's comment says the repository throws them. The service's comment also says it throws them — but the service delegates to the repository, so the throw originates in the repository and propagates through the service.

So the repository must throw those error classes. They're defined in payout.service.ts per the plan. So the repository imports from the service. That's what the plan dictates.

Alternatively — is it possible the plan intends for the errors to be importable from the service, and that's fine? The manifest's "reads" for the repository lists only the provider, not the service. Hmm, that's a contradiction within the plan. The manifest says the repository reads: src/payout/payout.provider.ts. But the signature comment says it throws InsufficientFundsError / DuplicatePayloadError which live in the service.

Wait, maybe I'm misreading the manifest format: "src/payout/payout.repository.ts | reads: src/payout/payout.provider.ts | PayoutRepository: all DB access — ...". The "reads" column for the service: "src/payout/payout.repository.ts, src/payout/payout.provider.ts" — the service reads the repository and the provider. That makes sense. For the worker: "src/payout/payout.service.ts, src/payout/payout.repository.ts" — makes sense. For the repository: "src/payout/payout.provider.ts" — doesn't make much sense; the repository doesn't use the provider. Probably a plan error, or it means "reads" as in "files that read this file"? Let me check: the provider's manifest line: "src/payout/payout.provider.ts | reads: - | PayoutProvider interface...". The service line: "reads: src/payout/payout.repository.ts, src/payout/payout.provider.ts" — the service depends on the repository and provider. So "reads" = "depends on". For the repository, depending on the provider is wrong. But depending on the service (for errors) is correct per the signature comment.

Given the ambiguity, what's the most defensible reading? The repository must throw `InsufficientFundsError` and `DuplicatePayoutError`. Those classes are, per the plan, defined in `payout.service.ts`. So the repository imports them from `./payout.service.js`. The manifest's "reads" line for the repository is probably just an error in the plan (or the provider import was intended for... nothing). I'll go with importing the errors from the service.

Hmm wait, actually, let me reconsider. Is there an alternative where the repository doesn't throw the service's error classes but throws something else, and the service translates? The repository comment explicitly says "throws InsufficientFundsError / DuplicatePayoutError". And the service's `createPayout` says "Throws InsufficientFundsError if available < amount" — consistent with propagation. So the repository throws those classes. Import from the service file.

The circular import concern: as analyzed, it works in ESM as long as the usage is at call time. The decorator metadata risk exists but is load-order dependent; in a NestJS app the typical entry order (module → controller → service → repository) is safe. Also, if `emitDecoratorMetadata` is off or the parameter types are... anyway, I'll follow the plan. This is the plan's own design; I shouldn't redesign it.

Actually, wait. Let me reconsider whether to import types from the service file for the errors. There's another subtlety: `PrismaClient` and the enum types (`PayoutStatus`, `MessageStatus`, `LedgerDirection`) come from `@prisma/client`. The plan's data model defines the enums in Prisma. So import from `@prisma/client`.

Now let me think about the raw SQL details.

Table names (via @@map):
- `accounts`: id, settled_balance (BIGINT), reserved_amount (BIGINT), created_at
- `payouts`: id, account_id, amount (BIGINT), destination_address, status (PAYOUTSTATUS enum), tx_hash, attempts, last_error, created_at, processed_at, completed_at
- `payout_messages`: id, payout_id (unique), account_id, idempotency_key, status (MESSAGESTATUS enum), attempts, created_at, claimed_at; unique (account_id, idempotency_key)
- `ledger_entries`: id, account_id, payout_id, direction (LEDGERDIRECTION enum), amount (BIGINT), created_at

Postgres enum type names: Prisma by default creates enum types with the name of the enum (e.g., `PayoutStatus`, `MessageStatus`, `LedgerDirection`) — unless @map is applied to the enum. The plan doesn't specify @map on the enums, so the Postgres type names are `PayoutStatus`, `MessageStatus`, `LedgerDirection`.

Now, do I need raw SQL with enum casts? For `FOR UPDATE` selects, we only read numeric/string columns, no enum needed. For updates via raw SQL, we'd need to cast string literals to the enum type: `status = 'PROCESSING'::"MessageStatus"`. Alternatively, use Prisma's typed API for updates (no raw SQL needed) and only use raw SQL where locking is required.

Strategy:
- `createPayoutWithMessage`: need `SELECT ... FOR UPDATE` on the account → raw `$queryRaw`. The rest (idempotency check, update account, create payout, create message) can be Prisma typed calls within the same interactive transaction. Order per the plan: lock account → check balance → check idempotency → increment reserved → insert payout → insert message.

Wait, the plan's order: "1. SELECT ... FOR UPDATE on the account row. 2. Check settledBalance - reservedAmount >= amount... 3. Check idempotency... 4. Increment reservedAmount by amount. 5. Insert payout row (status CREATED). 6. Insert message row (status PENDING)."

Hmm, but there's a race subtlety: the idempotency check is done under the account row lock. Two concurrent requests with the same (accountId, idempotencyKey) both lock the account row sequentially — the second waits for the first's commit, then sees the existing message → throws DuplicatePayoutError. Good. Two concurrent requests with different keys both reserve — the account lock serializes them, and the balance check is correct. Good.

But what about a duplicate request where the first hasn't committed yet and both use different... no, same key → serialized by the account lock. No problem.

Also, the unique index on (account_id, idempotency_key) in `payout_messages` is a backstop. If a race slips through (e.g., different accounts? no — the key is scoped per account), the unique constraint would throw a P2002. Should we catch that and convert to DuplicatePayoutError? The plan doesn't mention it. Under the account lock, the check-then-insert is safe for the same account. I'll keep it simple per the plan: check via findUnique on the composite unique, throw DuplicatePayoutError.

How to check idempotency? `tx.payoutMessage.findUnique({ where: { accountId_idempotencyKey: { accountId, idempotencyKey } } })` — Prisma generates a composite unique input from `@@unique([accountId, idempotencyKey], map: "uq_messages_account_idem")`. The property name would be `accountId_idempotencyKey`. Yes, Prisma names composite unique inputs by joining field names with underscores: `accountId_idempotencyKey`.

Alternatively, use the repository's own `findPayoutByAccountIdemKey` — but that's a separate method (probably for the service to use elsewhere). Within `createPayoutWithMessage`, I can call the same logic inside the transaction. The `findPayoutByAccountIdemKey` method as planned takes (accountId, idempotencyKey) and returns `{ payoutId } | null`. But it needs to run within the transaction to be safe. The planned signature doesn't take a tx parameter. Hmm.

Options:
- Implement `findPayoutByAccountIdemKey` as a standalone method using `this.prisma` (non-transactional), and within `createPayoutWithMessage` do the check directly with `tx.payoutMessage.findUnique(...)` (duplicating a small bit of logic).
- Or `findPayoutByAccountIdemKey` just does the findUnique.

The plan lists `findPayoutByAccountIdemKey` as a repository method: "Idempotency check: does a payout already exist for this key?" The service might use it (e.g., for returning existing payouts on duplicates? no — the service throws DuplicatePayoutError). Actually, who uses `findPayoutByAccountIdemKey`? Maybe the service's `createPayout` pre-checks before calling the repository? That'd be a redundant check. Or the worker? Hmm. The plan just lists it as a method; I'll implement it as specified: query the message (or payout) by (accountId, idempotencyKey) and return `{ payoutId }` or null.

I'll implement it with `this.prisma.payoutMessage.findUnique({ where: { accountId_idempotencyKey: {...} }, select: { payoutId: true } })`.

Now, within `createPayoutWithMessage`, for the idempotency check under the lock, I'll use `tx.payoutMessage.findUnique(...)` directly. That's cleanest and matches the plan's transaction steps.

Now, the missing account case: if `SELECT ... FOR UPDATE` returns no rows, what do we throw? The plan doesn't specify. The service has `PayoutNotFoundError` (code: "resource_not_found"). Hmm, but that's for a payout not found. For an account... The plan's error list: InsufficientFundsError (insufficient_funds), DuplicatePayoutError (duplicate_payout), PayoutNotFoundError (resource_not_found).

Most defensible: throw `PayoutNotFoundError`? Semantically off (it's an account, not a payout). Or throw `InsufficientFundsError`? Also off.

The plan says the repository "throws InsufficientFundsError / DuplicatePayoutError" — implying only those two. So maybe the plan assumes the account always exists (the service might check first? no, the service has zero DB access; it delegates).

Hmm. The instructions say: "If a symbol you truly need is missing from both the plan and references, don't silently guess... write the file with the most defensible reading and mark it with a single `// ASSUMPTION: <what was unresolved>` comment at the point where it matters."

A missing account is a genuine gap. Most defensible reading: treat a missing account as insufficient funds? No... I think the cleanest is to throw `PayoutNotFoundError` — no wait.

Let me think about what's most defensible for fund safety: if the account doesn't exist, we must not create a payout. Any error is fine as long as it's safe. The envelope code would be... The plan's controller translates PayoutError subclasses: 409 for duplicate/insufficient, 404 for not found. A missing account → 404 "resource_not_found" is a reasonable HTTP semantics. Reusing `PayoutNotFoundError` with a message like "Account not found" is pragmatic but semantically muddled.

Alternatively, throw a plain `Error`? That'd be translated to 500 internal_error — bad for a client error.

I'll go with throwing `PayoutNotFoundError` with a message indicating the account was not found, and mark it with an ASSUMPTION comment. Hmm wait, but actually — is `PayoutNotFoundError` the right class? Its code is "resource_not_found" which is generic enough for a missing account. I'll do:

```ts
if (!account) {
  // ASSUMPTION: The plan does not define an error for a missing account; reusing PayoutNotFoundError ("resource_not_found") so the client gets a 404 instead of a 500.
  throw new PayoutNotFoundError(`Account ${input.accountId} not found`);
}
```

Hmm, that's a reasonable single ASSUMPTION comment. Actually wait — let me reconsider. Maybe simpler: the plan's `createPayoutWithMessage` contract only mentions two errors, and the tests never create a payout for a nonexistent account (all tests seed an account). The ASSUMPTION comment is allowed and even encouraged for genuine gaps. I'll include it.

Now, the `recordAttemptFailure` method: "Record a provider attempt failure: increment attempts, set lastError." On which row? The signature is `recordAttemptFailure(payoutId: string, error: string)`. So it updates the payout row: attempts += 1, lastError = error.

But wait — §4 says "The `attempts` counter on the message tracks how many times it has been processed." And claimMessage increments the message's attempts. And "On failure: record the attempt (recordAttemptFailure). If attempts < PAYOUT_MAX_ATTEMPTS, keep the message as PROCESSING (which will be re-claimed by a subsequent poll after a timeout/reclaim, or the worker can reset it to PENDING for retry)." And "Retry mechanism: after a failed attempt with retries remaining, the message status is reset to PENDING (via recordAttemptFailure or a separate repository call) so that the next poll picks it up again."

Hmm, so `recordAttemptFailure` might also reset the message status to PENDING? The method's own comment says only "increment attempts, set lastError" (on the payout). But §4 says the message is reset to PENDING "via recordAttemptFailure or a separate repository call".

This is ambiguous. The method signature takes only `payoutId` and `error`. If it also resets the message, it needs to find the message by payoutId (payout_id is unique on messages, so that's fine).

Hmm. Let me think about what makes the system work:

- claimMessage: PENDING → PROCESSING, attempts++ (message).
- Provider fails, retries remaining: the message must go back to PENDING for the next poll. Otherwise it stays PROCESSING forever (the plan mentions "re-claimed by a subsequent poll after a timeout/reclaim" — but no reclaim mechanism is specified! There's no stale-claim timeout in the plan. So if the message stays PROCESSING, it's stuck forever).

So for the retry to work, after a failed attempt with retries remaining, the message must be reset to PENDING. The plan says this happens "via recordAttemptFailure or a separate repository call". Since no separate repository method for resetting the message is listed in the manifest, `recordAttemptFailure` should do it.

But wait — the signature is `recordAttemptFailure(payoutId: string, error: string)`. It can update both the payout row (attempts++, lastError) and the message row (status → PENDING). The message is found via the unique payout_id.

Hmm, but then what does the service's retry logic look like? "On failure: record the attempt (recordAttemptFailure). If attempts < PAYOUT_MAX_ATTEMPTS, keep the message as PROCESSING (... or the worker can reset it to PENDING for retry). If attempts >= PAYOUT_MAX_ATTEMPTS: ... failPayout / markNeedsReview."

And the test "transient failure then success": "The provider fails once (timeout) and succeeds on the second attempt; the payout is COMPLETED with a ledger entry; the message's attempts is 2."

So the flow: poll 1 → claim (message attempts=1, PROCESSING) → provider fails → recordAttemptFailure (payout attempts=1, lastError; message → PENDING) → poll 2 → claim (message attempts=2, PROCESSING) → provider succeeds → completePayout.

For this to work with `processMessages()` being called twice (the test would call processMessages() twice, or the worker's interval), recordAttemptFailure must reset the message to PENDING. Otherwise the second poll finds nothing pending.

Alternatively, the service could call a separate reset... but there's no such method in the manifest. So: `recordAttemptFailure` resets the message to PENDING (if retries remain)? But the method doesn't know the max attempts... The service decides whether retries remain. Hmm.

Wait, let me re-read: "Retry mechanism: after a failed attempt with retries remaining, the message status is reset to PENDING (via recordAttemptFailure or a separate repository call) so that the next poll picks it up again."

So the reset to PENDING happens only when retries remain. If retries are exhausted, failPayout (message DONE) or markNeedsReview (message DEAD) handles the terminal state. So the service's flow:

```
catch (err) {
  await repo.recordAttemptFailure(payoutId, err.message); // payout attempts++, lastError; message → PENDING
  if (attempts < max) return; // will be re-polled
  // exhausted:
  if (definitive) await repo.failPayout(payoutId); else await repo.markNeedsReview(payoutId);
}
```

But if recordAttemptFailure always resets to PENDING, then after exhaustion we call failPayout/markNeedsReview which sets DONE/DEAD — fine. But there's a subtle race: between recordAttemptFailure (message → PENDING) and failPayout (message → DONE), another worker could claim the message and process it again! That's an extra attempt beyond the max. Hmm. But is that a fund-safety issue? No — it's just an extra provider call, and the payout transitions are guarded (only CREATED/PROCESSING → terminal). Actually wait, if another worker claims it and the provider succeeds, completePayout runs — that's fine, idempotent. If it fails again, recordAttemptFailure again... attempts could exceed max slightly. Not a fund-safety issue, but sloppy.

Alternatively, recordAttemptFailure could take the decision... no, the signature is fixed: (payoutId, error).

Hmm, let me reconsider. Maybe the reset to PENDING should be conditional within recordAttemptFailure based on the message's own attempts vs... but the max is a service-level config (PAYOUT_MAX_ATTEMPTS env var). The repository shouldn't read env config? The plan says "Poll interval and max retries are configured via environment variables: PAYOUT_WORKER_INTERVAL_MS (default 1000) and PAYOUT_MAX_ATTEMPTS (default 3)." Where are they read? Probably the worker/service. The repository probably shouldn't.

OK, my decision: `recordAttemptFailure(payoutId, error)` does:
1. Update payout: attempts += 1, lastError = error.
2. Reset the message (found by payoutId) status to PENDING.

And I'll note in a comment that this re-queues for retry; terminal transitions (failPayout/markNeedsReview) override it. This matches "via recordAttemptFailure or a separate repository call" — I choose the former since no separate method exists.

Hmm wait, but actually, let me reconsider once more. If recordAttemptFailure resets to PENDING unconditionally, then in the exhaustion path:

```
recordAttemptFailure → message PENDING, payout attempts=3
then failPayout → message DONE
```

Between these two awaits, another worker could claim. In tests (single-threaded vitest), no race. In production, a rare extra attempt — acceptable, and the plan itself acknowledges re-claiming as part of the design ("will be re-claimed by a subsequent poll"). Also, at-least-once delivery is explicitly allowed. I'm comfortable with this.

Actually wait a moment, let me reconsider whether recordAttemptFailure should touch the message at all. Re-reading the method comment: "Record a provider attempt failure: increment attempts, set lastError." — "increment attempts" — whose attempts? The payout's (since the signature is payoutId). And §4: "The `attempts` counter on the message tracks how many times it has been processed." — incremented by claimMessage.

And "Retry mechanism: after a failed attempt with retries remaining, the message status is reset to PENDING (via recordAttemptFailure or a separate repository call)".

Yes — the plan explicitly allows the reset to be inside recordAttemptFailure. Since no other method does it, I'll put it in recordAttemptFailure. This is a defensible reading; should I mark it with an ASSUMPTION? The instructions say to mark when a symbol is truly missing. This isn't a missing symbol — it's an explicit "or" in the plan, and I'm choosing one branch. A brief comment explaining the choice is good practice but an ASSUMPTION marker might be overkill. I'll add a regular comment explaining why (re-queue for retry). Actually, the guidelines say code and comments in English, and to explain non-obvious choices. I'll write a clear comment.

Hmm, wait. Let me think about whether resetting to PENDING in recordAttemptFailure breaks the "duplicate message delivery" test: "Call processMessage twice for the same message id; the provider's transfer is called exactly once; the payout reaches COMPLETED with a single ledger entry; the second call is a no-op."

processMessage flow (service): load message; if DONE/DEAD → return. If not PROCESSING → claim. ... On success → completePayout (message DONE). Second call: message is DONE → no-op. Good, recordAttemptFailure isn't involved.

What about the "processMessage must claim (flip to PROCESSING) before calling the provider" rule — service level.

Now, `claimMessage` details: "SELECT ... FOR UPDATE SKIP LOCKED the message row. If status is not PENDING, return null (already claimed or done). Set status to PROCESSING, claimedAt = now, increment attempts. Commit."

Implementation with Prisma: Prisma doesn't support SKIP LOCKED directly. Use raw SQL:

```ts
const rows = await tx.$queryRaw<Array<{ id: string; payout_id: string; account_id: string; status: MessageStatus; attempts: number }>>`
  SELECT id, payout_id, account_id, status, attempts FROM payout_messages WHERE id = ${messageId} FOR UPDATE SKIP LOCKED
`;
```

Then if no row or status !== 'PENDING' → return null. Then update:

```ts
await tx.payoutMessage.update({ where: { id: messageId }, data: { status: 'PROCESSING', claimedAt: new Date(), attempts: { increment: 1 } } });
```

And return the MessageRow.

Wait — but if the row is locked by another transaction (SKIP LOCKED), the raw SELECT returns no rows → return null. Good.

Note: the `status` in the raw select comes back as a string (Postgres enum). Prisma's raw queries return enums as strings. So the type would be string; I'll cast or type the row accordingly. Let me define the raw result type with `status: string` and compare to `'PENDING'`. Or cast to MessageStatus. I'll keep it simple: type the raw result with `status: string` and compare to `'PENDING'`.

Actually, a cleaner approach for claimMessage: do it all in raw SQL?

```sql
WITH claimed AS (
  UPDATE payout_messages
  SET status = 'PROCESSING'::"MessageStatus", claimed_at = now(), attempts = attempts + 1
  WHERE id = $1 AND status = 'PENDING'::"MessageStatus"
  RETURNING id, payout_id, account_id, status, attempts
)
SELECT * FROM claimed;
```

But UPDATE ... WHERE doesn't use FOR UPDATE SKIP LOCKED semantics — actually, an UPDATE with a WHERE clause acquires the row lock; concurrent UPDATEs serialize (the second waits for the first's commit, then sees status != PENDING and updates 0 rows). That's actually correct behavior without SKIP LOCKED: the second worker waits briefly and then gets 0 rows. With a single claim by id, blocking vs skip doesn't matter much. But the plan explicitly says "Use SELECT ... FOR UPDATE SKIP LOCKED". I'll follow it: raw SELECT with FOR UPDATE SKIP LOCKED, then a Prisma update.

Hmm, but there's a subtlety: `findPendingMessages` — "Fetch pending messages (for worker polling)". Does the worker use findPendingMessages and then claimMessage per message? Per the plan's worker: "Single poll cycle: fetch pending messages, claim each, call service.processMessage." So findPendingMessages returns a list of PENDING messages (no lock, just a plain SELECT), and then the worker claims each by id. The claim is what's atomic.

So `findPendingMessages(limit)`:
```ts
const rows = await this.prisma.payoutMessage.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: limit });
return rows.map(...); // to MessageRow
```

FIFO by createdAt is a defensible choice. The plan doesn't specify ordering; I'll use createdAt ascending (oldest first) — reasonable for a queue.

Now `createPayoutWithMessage` in full:

```ts
async createPayoutWithMessage(input: {
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}): Promise<{ payoutId: string }> {
  return this.prisma.$transaction(async (tx) => {
    // Lock the account row before checking balance so that concurrent
    // payouts against the same account are serialized (no overdraw).
    const locked = await tx.$queryRaw<...>`SELECT ... FROM accounts WHERE id = ${input.accountId} FOR UPDATE`;
    const account = locked[0];
    if (!account) throw new PayoutNotFoundError(...); // ASSUMPTION
    
    const available = account.settled_balance - account.reserved_amount;
    if (available < input.amount) throw new InsufficientFundsError(...);
    
    const existing = await tx.payoutMessage.findUnique({
      where: { accountId_idempotencyKey: { accountId: input.accountId, idempotencyKey: input.idempotencyKey } },
      select: { payoutId: true },
    });
    if (existing) throw new DuplicatePayoutError(...);
    
    await tx.account.update({ where: { id: input.accountId }, data: { reservedAmount: { increment: input.amount } } });
    
    const payout = await tx.payout.create({ data: { accountId: input.accountId, amount: input.amount, destinationAddress: input.destinationAddress, status: 'CREATED' } });
    
    await tx.payoutMessage.create({ data: { payoutId: payout.id, accountId: input.accountId, idempotencyKey: input.idempotencyKey, status: 'PENDING' } });
    
    return { payoutId: payout.id };
  });
}
```

Wait — the plan's order: lock → check balance → check idempotency → increment reserved → insert payout → insert message. Yes, that's what I have.

Hmm, one consideration: should the idempotency check come before the balance check? The plan lists the balance check first (step 2), then idempotency (step 3). I'll follow the plan's order exactly.

Error messages: developer-facing English. E.g.:
- InsufficientFundsError: `Account ${accountId} has insufficient available funds: available ${available}, requested ${amount}`.
- DuplicatePayoutError: `A payout already exists for idempotency key ${idempotencyKey} on account ${accountId}`.

The PayoutError constructor: `constructor(code: string, message: string, details?: Record<string, unknown>)`. Subclasses — how are they constructed? The plan shows `export class InsufficientFundsError extends PayoutError {}` with a comment "code: 'insufficient_funds'". The subclasses probably override the code. Since I'm writing only the repository, I'll just call `new InsufficientFundsError(message)` — presumably the subclass's constructor sets its own code. I don't know the exact subclass constructor signature, but the plan implies each subclass has a fixed code, so `new InsufficientFundsError(message)` is the natural call. I'll use that.

Now `completePayout(payoutId, txHash)`:

Plan: one transaction:
- Set payout status to COMPLETED, txHash, completedAt. (SENT → COMPLETED set together)
- Insert ledger entry (DEBIT, amount) for the account.
- Decrement reservedAmount by amount, decrement settledBalance by amount.
- Set message status to DONE.

Ordering rule: "completePayout must post the ledger entry before updating the account's cached balance columns, in the same transaction."

So: update payout → create ledger entry → update account → update message.

I need the payout's amount and accountId — fetch the payout first (within the tx). Also, should I guard on status? "The idempotency of payout state transitions (only CREATED/PROCESSING → terminal) ensures no double ledger entry." So the update should be conditional: only transition if the status is CREATED or PROCESSING. If already COMPLETED (duplicate delivery), skip — no double ledger entry.

How to implement the guard? Use `updateMany` with `where: { id, status: { in: ['CREATED', 'PROCESSING'] } }` and check `count`. If count === 0, someone else already completed it → return (no-op). That's the safe idempotent pattern.

```ts
async completePayout(payoutId: string, txHash: string): Promise<void> {
  await this.prisma.$transaction(async (tx) => {
    const payout = await tx.payout.findUnique({ where: { id: payoutId } });
    if (!payout) return; // or throw? ASSUMPTION?
    
    const transitioned = await tx.payout.updateMany({
      where: { id: payoutId, status: { in: ['CREATED', 'PROCESSING'] } },
      data: { status: 'COMPLETED', txHash, completedAt: new Date() },
    });
    if (transitioned.count === 0) return; // already terminal — duplicate delivery, no-op
    
    await tx.ledgerEntry.create({ data: { accountId: payout.accountId, payoutId, direction: 'DEBIT', amount: payout.amount } });
    
    await tx.account.update({
      where: { id: payout.accountId },
      data: { reservedAmount: { decrement: payout.amount }, settledBalance: { decrement: payout.amount } },
    });
    
    await tx.payoutMessage.update({ where: { payoutId }, data: { status: 'DONE' } });
  });
}
```

Hmm wait — should completePayout also set SENT? "In practice SENT and COMPLETED are set together" — I'll set COMPLETED directly.

Should missing payout throw? The plan doesn't say. If the worker only processes existing messages, the payout should exist (message references it). A missing payout is a data integrity anomaly. Returning silently vs throwing... For fund safety, returning (no-op) is safe — no ledger entry posted. But it hides bugs. Hmm. The plan's failPayout/markNeedsReview have the same issue.

I think the most defensible is: if the payout doesn't exist, throw an error (data integrity violation → 500-ish). But that's a service-level concern... the repository can throw a plain Error. Hmm, actually, for robustness of the worker loop, throwing would crash processMessages — but that's a genuine integrity bug that should be loud.

Alternatively, treat it as a no-op. Let me think about what the tests would do: the tests always seed a payout with a message. So this path isn't tested. I'll go with throwing a plain `Error` with a clear message — loud failure for an impossible state. Hmm, but is that "exactly what the plan specifies"? The plan doesn't specify. Both readings are defensible.

Actually, you know what — let me reconsider. For `failPayout` and `markNeedsReview`, the same guard pattern applies (only from CREATED/PROCESSING). For consistency, I'll use the same conditional updateMany guard in all three terminal transitions. And for a missing payout...

Let me do this: find the payout; if missing, throw `Error(\`Payout ${payoutId} not found\`)`. Simple, loud. Actually hmm, wait. Let me reconsider no-op vs throw once more.

The worker's processMessage: "Load the associated payout. If the payout status is not CREATED or PROCESSING, return (already handled)." — so the service already checks the payout's status before calling completePayout/failPayout/markNeedsReview! So by the time the repository's terminal method is called, the payout exists and is in CREATED/PROCESSING (per the service's check). The repository's conditional updateMany is a belt-and-suspenders for the race (two workers... but claim prevents two workers on one message; duplicate delivery is handled by the service's status check).

Given the service pre-checks, the repository can assume existence. But defensive coding in the repository is cheap. I'll keep the conditional updateMany (fund safety: prevents double ledger entry under any race), and for a missing payout I'll throw a plain Error. Hmm...

Actually, let me simplify: skip the findUnique entirely? I need payout.amount and accountId for the ledger entry and account update. So yes, fetch first. If missing → throw Error. OK.

Wait, actually, one more consideration: should the ledger entry be created before or after the conditional transition check? Ordering rule: "post the ledger entry before updating the account's cached balance columns". The transition check is separate. My order: fetch payout → conditional transition (guard) → if not transitioned, return → ledger entry → account update → message DONE. This satisfies "ledger before balance columns" and prevents double posting.

Now `failPayout(payoutId)`:
- One transaction: payout FAILED + completedAt; reserved -= amount (release reservation); no ledger; message DONE.
- Same guard: only from CREATED/PROCESSING.

```ts
async failPayout(payoutId: string): Promise<void> {
  await this.prisma.$transaction(async (tx) => {
    const payout = await tx.payout.findUnique({ where: { id: payoutId } });
    if (!payout) throw new Error(...);
    const transitioned = await tx.payout.updateMany({
      where: { id: payoutId, status: { in: ['CREATED', 'PROCESSING'] } },
      data: { status: 'FAILED', completedAt: new Date() },
    });
    if (transitioned.count === 0) return;
    await tx.account.update({ where: { id: payout.accountId }, data: { reservedAmount: { decrement: payout.amount } } });
    await tx.payoutMessage.update({ where: { payoutId }, data: { status: 'DONE' } });
  });
}
```

`markNeedsReview(payoutId)`:
- Payout NEEDS_REVIEW; keep reservation; no ledger; message DEAD.

```ts
async markNeedsReview(payoutId: string): Promise<void> {
  await this.prisma.$transaction(async (tx) => {
    const payout = await tx.payout.findUnique({ where: { id: payoutId } });
    if (!payout) throw new Error(...);
    const transitioned = await tx.payout.updateMany({
      where: { id: payoutId, status: { in: ['CREATED', 'PROCESSING'] } },
      data: { status: 'NEEDS_REVIEW' },
    });
    if (transitioned.count === 0) return;
    await tx.payoutMessage.update({ where: { payoutId }, data: { status: 'DEAD' } });
  });
}
```

Note: markNeedsReview doesn't set completedAt? The plan: "On retry exhaustion without a definitive outcome: payout to NEEDS_REVIEW. Keep reservation. No ledger entry. Mark message as DEAD." — no mention of completedAt. The data model has completedAt as nullable. For NEEDS_REVIEW, the payout isn't completed — it's pending review. I won't set completedAt. Hmm, or should I? The plan explicitly lists "completedAt to now" for failPayout but not for markNeedsReview. I'll follow it literally: no completedAt for NEEDS_REVIEW.

`markProcessing(payoutId)`: "Mark payout as PROCESSING, set processedAt."

```ts
async markProcessing(payoutId: string): Promise<void> {
  await this.prisma.payout.update({
    where: { id: payoutId },
    data: { status: 'PROCESSING', processedAt: new Date() },
  });
}
```

Should this be conditional (only from CREATED)? The service calls it after the claim, when the payout is CREATED or PROCESSING (re-delivery case: payout already PROCESSING). A plain update is fine — re-setting PROCESSING/processedAt on a PROCESSING payout is harmless. But if the payout is terminal (COMPLETED), the service's check ("If the payout status is not CREATED or PROCESSING, return") prevents the call. I'll keep it a simple update. Or use updateMany with a status guard for safety? The plan says "Mark payout as PROCESSING, set processedAt." — simple. I'll do a plain update. Hmm, but what if the payout doesn't exist? Prisma throws P2025. The service pre-loads the payout, so it exists. Fine.

`recordAttemptFailure(payoutId, error)`:

```ts
async recordAttemptFailure(payoutId: string, error: string): Promise<void> {
  await this.prisma.$transaction(async (tx) => {
    await tx.payout.update({ where: { id: payoutId }, data: { attempts: { increment: 1 }, lastError: error } });
    // Re-queue the message so the next poll retries it (at-least-once).
    await tx.payoutMessage.update({ where: { payoutId }, data: { status: 'PENDING' } });
  });
}
```

Wait — should the message reset be unconditional here? As discussed: yes, this is the retry re-queue; terminal methods override it. But hmm, let me reconsider the exhaustion path once more:

Service flow on failure (per §4):
```
recordAttemptFailure(payoutId, errMsg)  // message → PENDING
if (attempts < MAX) return;            // retry on next poll
if (definitive) failPayout(payoutId);  // message → DONE
else markNeedsReview(payoutId);        // message → DEAD
```

So after exhaustion, the message ends DONE/DEAD. The transient PENDING window is a minor race, acceptable per at-least-once. OK.

But wait — how does the service know `attempts`? From the message row (message.attempts after claim) or from the payout's attempts? The service loads the message and payout. Either way — not my concern in the repository.

One more point on `recordAttemptFailure`: should it be a transaction? Two updates, atomicity is nice (payout attempts and message status consistent). I'll use a transaction. Or two separate calls — the plan doesn't specify a transaction boundary for this. §4 lists transaction boundaries 1-5, and recordAttemptFailure isn't among them ("processMessage flow (no single transaction; each DB op is its own)"). Hmm! "Each DB op is its own" — that suggests recordAttemptFailure's updates are separate ops. But bundling them in a transaction is also defensible and safer. The "no single transaction" refers to the whole processMessage flow not being one big transaction (because of the provider call in between), not that each repository method can't be its own transaction. The listed boundaries 1-5 are the required ones; additional atomicity in recordAttemptFailure is harmless. I'll use a transaction for the two updates — it keeps the payout/message consistent. Actually, hmm, let me keep it simple: two separate `this.prisma` calls? If the process crashes between them, the payout's attempts is incremented but the message stays PROCESSING → stuck (no retry). That's a liveness bug, not a fund-safety bug. With a transaction, no stuck state. I'll use the transaction. Defensible.

Hmm wait, actually — if the message stays PROCESSING after a crash mid-recordAttemptFailure, is there any recovery? No reclaim mechanism in the plan. So the transaction is the safer choice. Yes, transaction.

`findMessageById(id)`:
```ts
async findMessageById(id: string): Promise<MessageRow | null> {
  const msg = await this.prisma.payoutMessage.findUnique({ where: { id } });
  return msg ? { id: msg.id, payoutId: msg.payoutId, accountId: msg.accountId, status: msg.status, attempts: msg.attempts } : null;
}
```

`findPendingMessages(limit)`:
```ts
async findPendingMessages(limit: number): Promise<MessageRow[]> {
  const rows = await this.prisma.payoutMessage.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
  return rows.map((m) => ({ id: m.id, payoutId: m.payoutId, accountId: m.accountId, status: m.status, attempts: m.attempts }));
}
```

`findPayoutByAccountIdemKey(accountId, idempotencyKey)`:
```ts
async findPayoutByAccountIdemKey(accountId: string, idempotencyKey: string): Promise<{ payoutId: string } | null> {
  const msg = await this.prisma.payoutMessage.findUnique({
    where: { accountId_idempotencyKey: { accountId, idempotencyKey } },
    select: { payoutId: true },
  });
  return msg ? { payoutId: msg.payoutId } : null;
}
```

Now, imports:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { DuplicatePayoutError, InsufficientFundsError, PayoutNotFoundError } from './payout.service.js';
```

ESM: the codebase is `"type": "module"`. NestJS with ESM — imports need `.js` extensions? In ESM TypeScript, relative imports should include the file extension (`.js`) when using NodeNext module resolution. The convention says ESM, "type": "module". Hmm, but many NestJS projects use bundler resolution or CommonJS despite the type field. The plan doesn't show import statements. What's the most defensible?

Given "ESM, `"type": "module"`" is a hard convention, relative imports should use `.js` extensions for NodeNext. I'll use `./payout.service.js`. Hmm, but if the project uses `"moduleResolution": "bundler"`, then `.js` extensions still work (they're allowed). If it uses Node16/NodeNext, `.js` is required. So `.js` is the safe choice for ESM. I'll go with `.js`.

Wait, but the other files (controller, service) — I don't see their imports. The provider file shown has no imports. OK, I'll go with `.js` extensions for ESM correctness.

Now the raw SQL for locking the account:

```ts
const locked = await tx.$queryRaw<Array<{ id: string; settled_balance: bigint; reserved_amount: bigint }>>`
  SELECT id, settled_balance, reserved_amount
  FROM accounts
  WHERE id = ${accountId}
  FOR UPDATE
`;
```

Prisma's $queryRaw with tagged templates — yes, supported. The result: Postgres BIGINT → bigint in Node (Prisma returns BigInt for BIGINT columns in raw queries). Good.

For claimMessage:

```ts
const rows = await tx.$queryRaw<Array<{ id: string; payout_id: string; account_id: string; status: string; attempts: number }>>`
  SELECT id, payout_id, account_id, status, attempts
  FROM payout_messages
  WHERE id = ${messageId}
  FOR UPDATE SKIP LOCKED
`;
const row = rows[0];
if (!row || row.status !== 'PENDING') return null;
await tx.payoutMessage.update({
  where: { id: messageId },
  data: { status: 'PROCESSING', claimedAt: new Date(), attempts: { increment: 1 } },
});
return { id: row.id, payoutId: row.payout_id, accountId: row.account_id, status: 'PROCESSING', attempts: row.attempts + 1 };
```

Hmm — the returned MessageRow: should status be PROCESSING (the new state) and attempts be the incremented value? Yes, that reflects the post-claim state. The service uses the returned message... probably just to know it was claimed, and maybe for the attempts count. Returning the updated state is most useful.

Wait, one subtlety with `FOR UPDATE SKIP LOCKED` + subsequent update: after the SELECT ... FOR UPDATE, we hold the row lock until the transaction commits, so the subsequent update is safe. Good.

Also — should claimMessage be a single raw statement instead? I'll keep the two-step (raw select + Prisma update) inside `this.prisma.$transaction`.

Now, the MessageRow type — non-exported:

```ts
type MessageRow = {
  id: string;
  payoutId: string;
  accountId: string;
  status: MessageStatus;
  attempts: number;
};
```

Where does `MessageStatus` come from? `@prisma/client` exports the enum type. In raw results, status is a string; I'll cast: `status: row.status as MessageStatus` or type the raw result directly with MessageStatus. Prisma's $queryRaw generic lets you declare the shape; I can declare `status: MessageStatus` and cast internally. Cleaner: type the raw rows with string status and cast at the boundary. Or just declare MessageStatus in the generic — it's a type assertion anyway (no runtime check). I'll declare the raw shape with `status: string` and map with a cast. Hmm, simpler: declare the generic as MessageRow-like with snake_case... let me just write it cleanly:

```ts
const rows = await tx.$queryRaw<
  Array<Pick<MessageRow, 'id' | 'attempts'> & { payout_id: string; account_id: string; status: string }>
>`...`;
```

That's ugly. Alternative: use Prisma's `Prisma.PayoutMessageGetPayload`? Overkill.

Cleanest: define the raw row type inline with snake_case and map:

```ts
type ClaimedMessageRow = {
  id: string;
  payout_id: string;
  account_id: string;
  status: string;
  attempts: number;
};
```

Hmm, but that's an extra type not in the plan. The plan says MessageRow is internal; adding another internal type is a minor addition... "Don't add exports, features, or files the plan doesn't name" — an internal helper type isn't an export/feature/file. But to be minimal, I can inline the generic:

```ts
const rows = await tx.$queryRaw<Array<{ id: string; payout_id: string; account_id: string; status: string; attempts: number }>>(Prisma.sql`...`);
```

Wait — tagged template vs Prisma.sql: `tx.$queryRaw<T>` accepts a tagged template directly: `tx.$queryRaw<T>\`SELECT ...\``. Yes, that's the standard form. I'll use the tagged template with an inline generic. No extra type needed.

Similarly for the account lock: `tx.$queryRaw<Array<{ id: string; settled_balance: bigint; reserved_amount: bigint }>>\`...\``.

Now — the enum values in Prisma's typed API: `status: 'PENDING'` etc. Prisma generates the enum as a const object (e.g., `MessageStatus.PENDING`) and also accepts string literals of the same value in typed inputs (since the enum type is a union of literals). Actually, Prisma's generated types: `status?: $Enums.MessageStatus | MessageStatusFieldRefInput`, and `$Enums.MessageStatus` is a union type `'PENDING' | 'PROCESSING' | ...`. So string literals work directly. I'll use string literals — no need to import the enum objects. But for the MessageRow type, I need the `MessageStatus` type — import as a type from '@prisma/client': `import { PrismaClient, MessageStatus } from '@prisma/client';` — hmm, `MessageStatus` is exported as both a type and a const. Importing it as a value works; using it only as a type is fine (TS elides type-only usage... actually, if I import `MessageStatus` and use it only in type positions, with `verbatimModuleSyntax` it might complain? To be safe: `import { PrismaClient, type MessageStatus } from '@prisma/client';` — hmm, is `type` modifier on named imports OK in TS 4.5+? Yes. But do I need MessageStatus as a value anywhere? No — only in the MessageRow type. So `import type` or inline `type` modifier.

Wait, do I even need to import MessageStatus? The plan's MessageRow has `status: MessageStatus`. Yes, I'll import it as a type.

Also `PayoutStatus` — do I reference it by name? In updateMany's where: `status: { in: ['CREATED', 'PROCESSING'] }` — string literals, no type import needed. OK.

Now, the PrismaClient import: `import { PrismaClient } from '@prisma/client';` — used in the constructor parameter type.

Let me also double-check the Prisma model names. The plan's data model section gives table names via @@map, but what are the Prisma model names? The plan shows e.g. "**`accounts`** (`@@map("accounts")`)" — suggesting the model name might differ from the table? If the model were `Account` with @@map("accounts"), the plan would probably write "model Account ... @@map('accounts')". The plan writes the model name in backticks matching the table: `accounts`, `payouts`, `payout_messages`, `ledger_entries`. And fields are camelCase with @map to snake_case. So the Prisma models are lowercase: `accounts`, `payouts`, `payout_messages`, `ledger_entries`.

Hmm, that's unusual (Prisma convention is PascalCase models) but the plan literally names them as `accounts` etc. with `@@map("accounts")`. If the model name equals the table name, @@map is redundant but harmless — consistent with the plan writing it. So `this.prisma.accounts`, `this.prisma.payouts`, `this.prisma.payout_messages`, `this.prisma.ledger_entries`.

Wait, is that right? Let me re-read: "**`accounts`** (`@@map("accounts")`)". Yes — the model is named `accounts` and mapped to table `accounts`. Similarly `payout_messages` → table `payout_messages`. OK, I'll use lowercase model names in Prisma client calls: `this.prisma.accounts.findUnique`, `this.prisma.payouts.create`, `this.prisma.payout_messages.findUnique`, `this.prisma.ledger_entries.create`.

And the raw SQL uses the table names: `accounts`, `payout_messages` — same strings. Good, consistent.

Field names in Prisma: camelCase (settledBalance, reservedAmount, destinationAddress, txHash, lastError, processedAt, completedAt, claimedAt, idempotencyKey, payoutId, accountId). The composite unique input: `accountId_idempotencyKey`.

Now let me also reconsider: the idempotency check in `createPayoutWithMessage` — via `tx.payout_messages.findUnique({ where: { accountId_idempotencyKey: {...} } })`. If the composite unique has a custom map ("uq_messages_account_idem"), does the input name change? No — the Prisma client's input property is derived from the field names, not the index name. `accountId_idempotencyKey`. Correct.

Now, let me think about the `PayoutNotFoundError` import — used for the missing account case. The plan defines it in the service with code "resource_not_found". I'll import and use it with an ASSUMPTION comment.

Hmm, actually — wait. Let me reconsider whether to throw PayoutNotFoundError for a missing account or handle it differently. The ASSUMPTION instruction: "If a symbol you truly need is missing from both the plan and references... write the file with the most defensible reading and mark it with a single // ASSUMPTION comment at the point where it matters."

The "missing symbol" here is: an error type for a missing account. The plan has three errors; none fits "account not found" perfectly, but PayoutNotFoundError ("resource_not_found") is the closest. I'll use it + one ASSUMPTION comment. Good.

Now, let me also think: should `createPayoutWithMessage` validate amount > 0? The plan doesn't mention it. The controller validates input (per the layering: "controller validates input"). So no validation in the repository. Skip.

Now let me write out the full file.

```ts
import { Injectable } from '@nestjs/common';
import { PrismaClient, type MessageStatus } from '@prisma/client';
import {
  DuplicatePayoutError,
  InsufficientFundsError,
  PayoutNotFoundError,
} from './payout.service.js';

/**
 * Internal shape of a payout message row as consumed by the worker.
 * Deliberately not exported: the rest of the codebase only ever sees
 * message ids.
 */
type MessageRow = {
  id: string;
  payoutId: string;
  accountId: string;
  status: MessageStatus;
  attempts: number;
};

/**
 * The only layer that touches the database. All money movement happens in
 * short transactions; the provider call never happens inside one of them.
 */
@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Atomically reserves funds and creates the payout plus its outbox message.
   * The account row is locked (SELECT ... FOR UPDATE) before the balance is
   * checked, so concurrent payouts against one account are serialized and can
   * never overdraw it. The idempotency check runs under the same lock, so a
   * retried (accountId, idempotencyKey) pair is rejected exactly once.
   */
  async createPayoutWithMessage(input: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<{ payoutId: string }> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{ id: string; settled_balance: bigint; reserved_amount: bigint }>
      >`
        SELECT id, settled_balance, reserved_amount
        FROM accounts
        WHERE id = ${input.accountId}
        FOR UPDATE
      `;
      const account = locked[0];
      if (!account) {
        // ASSUMPTION: the plan defines no error for a missing account; reusing
        // PayoutNotFoundError ("resource_not_found") so the request fails with a
        // 404 instead of a 500.
        throw new PayoutNotFoundError(`Account ${input.accountId} not found`);
      }

      const available = account.settled_balance - account.reserved_amount;
      if (available < input.amount) {
        throw new InsufficientFundsError(
          `Account ${input.accountId} has insufficient available funds: available=${available}, requested=${input.amount}`,
        );
      }
