# repair2-payment.spec.ts

## reasoning

```
Let me analyze the compiler errors:

1. `src/app.module.ts(3,31): error TS2307: Cannot find module './payment/payment.module'` — This is about `payment.module.ts` not existing, but the task says "Change nothing the messages do not name." The message names `src/app.module.ts` importing from `./payment/payment.module`, but I'm only asked to fix `test/payment.spec.ts`. So I should not create `payment.module.ts` — that's not my file to fix.

2. `src/payment/payment.repository.ts(21,5)`, `(29,5)`, `(33,5)` — These are `bigint` vs `number` issues in the repository. The task says "Change nothing the messages do not name." These errors are in `payment.repository.ts`, not in `test/payment.spec.ts`. I should not change that file.

3. `test/payment.spec.ts(2,32): error TS2307: Cannot find module '../src/payment/payment.service'` — The file `payment.service.ts` doesn't exist yet.

4. `test/payment.spec.ts(3,80): error TS2307: Cannot find module '../src/payment/bank-client.interface'` — The file `bank-client.interface.ts` doesn't exist yet.

Wait, let me re-read the task: "Rewrite `test/payment.spec.ts` complete, fixing what these messages require of this file."

So I only need to fix `test/payment.spec.ts`. The errors that pertain to this file are:
- Line 2: Cannot find module `'../src/payment/payment.service'`
- Line 3: Cannot find module `'../src/payment/bank-client.interface'`

But wait — these modules don't exist in the workspace. The task says to fix what "these messages require of this file." If the modules don't exist, I can't just import them. But the task also says "Do not drop a requirement to silence an error." and "If satisfying the compiler seems to require abandoning something the plan specified, keep the plan and add one `// ASSUMPTION:` line saying what you could not reconcile."

Hmm, but looking more carefully at the reference material — the workspace only shows `payment.repository.ts`. The `payment.service.ts` and `bank-client.interface.ts` files don't exist in the workspace. The test file is trying to import them.

Wait, let me re-read: "These are the compiler's exact messages for the whole workspace." So the entire workspace has these errors. My job is to fix only `test/payment.spec.ts`.

The issue is: the test file imports from `../src/payment/payment.service` and `../src/payment/bank-client.interface`, but those files don't exist. I can't create them (the task says "Change nothing the messages do not name" and I'm only rewriting `test/payment.spec.ts`).

But wait — maybe the files DO exist but just aren't shown in the reference. The reference only shows `payment.repository.ts` as an example of what's in the workspace. Let me re-read the task statement...

"The blocks above are reference material." — So the reference shows what's in the workspace. Only `payment.repository.ts` is shown from the `src/payment/` directory.

Actually, I think the key insight is: the task says "Rewrite `test/payment.spec.ts` complete, fixing what these messages require of this file." The messages that reference `test/payment.spec.ts` are:
- Line 2, col 32: Cannot find module `'../src/payment/payment.service'`
- Line 3, col 80: Cannot find module `'../src/payment/bank-client.interface'`

These are "Cannot find module" errors. The fix would be to either:
1. Create those modules (not allowed — I can only change `test/payment.spec.ts`)
2. Remove the imports (would drop requirements)
3. Add `// ASSUMPTION:` comments

But actually, thinking about this differently — the task is asking me to write a complete test file. The test file needs to import from `payment.service` and `bank-client.interface`. If those files don't exist, the test can't compile regardless of what I write.

Wait, let me reconsider. Maybe the files DO exist in the actual workspace but just weren't shown to me as reference. The reference material says "The blocks above are reference material." — it's giving me context, not necessarily showing every file.

Actually, I think the most reasonable interpretation is:
- The files `payment.service.ts` and `bank-client.interface.ts` are supposed to exist (they're in the plan) but haven't been created yet
- The test file references them
- I need to write the test file as if those modules exist (per the plan)
- The "Cannot find module" errors will be resolved once those files are created

But the task says "fixing what these messages require of this file" — meaning I should make changes to THIS file that would resolve the errors. If the modules don't exist, no change to this file can resolve the error... unless I inline the types or mock them differently.

Hmm, let me think about this more carefully. The compiler errors for `test/payment.spec.ts` are:
1. `test/payment.spec.ts(2,32): error TS2307: Cannot find module '../src/payment/payment.service'`
2. `test/payment.spec.ts(3,80): error TS2307: Cannot find module '../src/payment/bank-client.interface'`

These are import resolution errors. The only way to fix them from within `test/payment.spec.ts` is to not import those modules. But the plan requires testing `PaymentService` and using `BankClient` types.

Wait — maybe I should look at this from a different angle. What if the test file is supposed to use `vi.mock` or type-only imports? No, that doesn't help with module resolution.

Actually, I think the correct interpretation is: the test file should be written according to the plan, importing from those modules. The "Cannot find module" errors are because those files haven't been written yet. My job is to write the test file correctly per the plan, and the errors will resolve when the other files are created. The task says "fixing what these messages require of this file" — and what the messages require is that the imports point to the correct paths. If the files exist at those paths, the errors go away.

But that's circular — I can't verify the files exist. Let me just write the test file per the plan, with proper imports, and add `// ASSUMPTION:` lines where needed.

Actually wait — re-reading the task more carefully: "Rewrite `test/payment.spec.ts` complete, fixing what these messages require of this file."

I think the key is "what these messages require of THIS FILE." The messages say the modules can't be found. What does that require of this file? It requires that the file either:
- Doesn't import those modules, OR
- The imports are correct and the modules will exist

Since the plan requires testing `PaymentService` (from `payment.service`) and using `BankClient` types (from `bank-client.interface`), I should keep those imports. The errors will be resolved when those files are created.

But I also need to address the `bigint` issue. The repository's `OrderRecord` interface has `amount_minor_units: number` but Prisma returns `bigint`. The plan says "Money in minor units, integers only." The repository file shown uses `number` in its interface but Prisma returns `bigint`. This is a type mismatch in the repository, not in the test.

For the test file, I need to decide what type `amount_minor_units` is in my test's mock data. Since the repository's `OrderRecord` interface says `number`, I'll use `number` in my test mocks. But wait — if the service uses the repository's type, and the repository returns `bigint` from Prisma... 

Actually, looking at the plan again:
- The `BankSendRequest` has `amount_minor_units: number`
- The `Settlement` interface has `amount_minor_units: number`
- The `OrderRecord` in the repository (as shown) has `amount_minor_units: number`

The plan uses `number` throughout. The Prisma schema uses `BigInt` (which maps to `bigint` in TypeScript). But the plan says to use `number` in the interfaces. The repository is supposed to handle the conversion or the plan just uses `number` for simplicity.

For the test, I'll follow the plan and use `number` types. The test will mock the repository anyway, so it won't actually hit Prisma's `bigint` return type.

Now let me write the test file. I need to:
1. Import from `../src/payment/payment.service` and `../src/payment/bank-client.interface`
2. Test all the cases listed in the plan's test table
3. Use `number` for money amounts (per the plan)
4. Mock the repository and bank client

Let me structure the tests:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaymentService, ReconcileWindow } from '../src/payment/payment.service';
import { BankClient, BankSendResponse, Settlement, BankSendRequest } from '../src/payment/bank-client.interface';
```

Wait, I need to think about what's exported from where. Per the plan:
- `bank-client.interface.ts` exports: `BankSendRequest`, `BankSendStatus`, `BankSendResponse`, `Settlement`, `BankClient`
- `payment.service.ts` exports: `PaymentService`, `ReconcileWindow`, `ReconcileResult`

The `OrderRecord` and `PaymentRepository` are from the repository.

For the test, I'll need to mock:
- `PaymentRepository` — all its methods
- `BankClient` — `send` and `getStatement`

Let me write the complete test file now. I'll use vitest with mocks.

Key tests from the plan:
1. `executePayments: accepted response transitions pending → sent`
2. `executePayments: duplicate response transitions pending → sent`
3. `executePayments: transient error transitions pending → in_doubt`
4. `executePayments: timeout transitions pending → in_doubt`
5. `executePayments: permanent rejection transitions pending → rejected`
6. `executePayments: attempt_count >= max parks the order`
7. `executePayments: concurrent increment skips the order`
8. `reconcile: found-in-statement transitions sent → settled`
9. `reconcile: found-in-statement transitions in_doubt → settled (timeout-but-settled)`
10. `reconcile: proven-absent transitions in_doubt → pending (same txid preserved)`
11. `reconcile: statement not yet complete leaves in_doubt unchanged`
12. `reconcile: overlapping windows are idempotent`
13. `reconcile: rejected orders are untouched by reconciliation`
14. `deriveTxid: deterministic for same input`
15. `deriveTxid: different orders or dates yield different txids`
16. `full lifecycle: timeout → reconcile proves absent → resend accepted → settle`
17. `full lifecycle: 5 timeouts → parked_manual_review`

Now, the service constructor per the plan:
```typescript
constructor(
  repo: PaymentRepository,
  bank: BankClient,
  opts: { publishingLagMs: number; batchSize: number; maxAttempts: number },
);
```

For the test, I need to create a mock repository. Let me think about what the repository interface looks like based on the plan:

```typescript
interface PaymentRepository {
  findPending(limit: number): Promise<OrderRecord[]>;
  findByTxid(txid: string): Promise<OrderRecord | null>;
  findInDoubtByEffectiveDate(date: Date): Promise<OrderRecord[]>;
  markSent(id: string, lastAttemptAt: Date): Promise<void>;
  markInDoubt(id: string, lastAttemptAt: Date): Promise<void>;
  markRejected(id: string): Promise<void>;
  markSettled(id: string, settledAt: Date): Promise<void>;
  markPendingForResend(id: string): Promise<void>;
  markParked(id: string): Promise<void>;
  incrementAttempt(id: string, lastAttemptAt: Date): Promise<number>;
  upsertSettlement(data: { txid: string; amount_minor_units: number; settled_at: Date; statement_date: Date; }): Promise<void>;
}
```

Wait, but the test file can't import `PaymentRepository` from the repository file if I'm only fixing the test file. Actually, the repository file DOES exist (it's shown in the reference). So I can import from it. But do I need to? I can just create a mock object that matches the interface.

Actually, looking at the compiler errors again — there are NO errors about importing from `payment.repository`. The only "Cannot find module" errors for the test file are about `payment.service` and `bank-client.interface`. So either:
1. The test file currently doesn't import from the repository, or
2. It does and there's no error (meaning the file exists)

Since the repository file is shown to exist, I can import from it if needed. But for a unit test with mocks, I probably don't need to import the concrete class — I just need the types.

Let me think about what approach to take:
- I'll create mock objects for the repository and bank client
- I'll type them structurally (matching the interfaces from the plan)
- I won't import the concrete `PaymentRepository` class since I'm mocking it

Actually, for the test to work with TypeScript strict mode, I need proper types. Let me import `OrderRecord` from the repository (since it exists) and define inline types for the bank client (since `bank-client.interface.ts` doesn't exist per the errors).

Wait no — if I import from `bank-client.interface` and it doesn't exist, that's the error I'm supposed to fix. But I can't create that file. So what do I do?

The task says: "If satisfying the compiler seems to require abandoning something the plan specified, keep the plan and add one `// ASSUMPTION:` line saying what you could not reconcile."

So I should keep the imports per the plan and add `// ASSUMPTION:` lines. The assumption would be that those files will exist when the full workspace is complete.

Actually, wait. Let me re-read the task one more time: "Rewrite `test/payment.spec.ts` complete, fixing what these messages require of this file."

I think the intent is: write the test file correctly per the plan. The "Cannot find module" errors are because those source files haven't been written yet — they're part of the deliverable. The test file should reference them correctly, and once those files exist, the errors will resolve.

The `bigint` errors in the repository are a separate issue (they're in `payment.repository.ts`, not in my file). The task says "Change nothing the messages do not name" — and the messages about `bigint` name `payment.repository.ts`, not my test file.

So my approach:
1. Write the complete test file per the plan
2. Import from `../src/payment/payment.service` and `../src/payment/bank-client.interface` as the plan specifies
3. Use `number` for money (per the plan)
4. Add `// ASSUMPTION:` if needed

Actually, I realize I should also consider: does the test file need to import `OrderRecord` from the repository? The repository exports `OrderRecord`. If I need that type in my test, I can import it from `../src/payment/payment.repository` (which exists and has no module-not-found error).

Let me write the test now. I'll be thorough and cover all 17 test cases from the plan.

Let me think about the structure:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaymentService, ReconcileWindow } from '../src/payment/payment.service';
import { BankClient, Settlement } from '../src/payment/bank-client.interface';
import type { OrderRecord } from '../src/payment/payment.repository';
```

For the mock repository, I'll create a plain object with all the methods as `vi.fn()`.

For the bank client mock, same approach.

Let me think about the `deriveTxid` method — it's on the service, exposed for tests. The plan says:
- `deriveTxid(orderId: string, effectiveDate: Date): string`
- It's deterministic: `sha256(orderId + effectiveDate.toISOString()).hex`

For tests, I just need to verify determinism and uniqueness, not the exact hash value.

Now let me think about the "timeout" case. The plan says:
- `transient_error` (or `BankTransientError` thrown) → `markInDoubt`
- Timeout (request exceeds client timeout, treated same as transient) → `markInDoubt`

So a timeout would manifest as either:
- A `BankSendResponse` with `status: 'transient_error'`, OR
- A `BankTransientError` being thrown

For the "timeout" test specifically, I'll simulate it as a `BankTransientError` being thrown (or a response with `transient_error` status). Actually, looking at the plan more carefully:

```
type BankSendStatus = 'accepted' | 'duplicate' | 'transient_error' | 'permanent_rejection';
```

And:
```
class BankTransientError extends Error { ... }
class BankPermanentError extends Error { ... }
```

So the bank client can either:
- Return a `BankSendResponse` with one of the four statuses, OR
- Throw `BankTransientError` / `BankPermanentError`

The service should handle both. For the "timeout" test, I'll simulate a thrown error (since a timeout typically manifests as a network error/exception rather than a structured response).

Actually, looking at the plan's classification:
- `accepted` or `duplicate` → markSent
- `transient_error` (or `BankTransientError` thrown) → markInDoubt
- `permanent_rejection` (or `BankPermanentError` thrown) → markRejected
- Timeout → markInDoubt (same as transient)

So for the timeout test, I'll have `bank.send` reject/throw with a `BankTransientError` (or a generic Error that the service treats as transient).

Hmm, but the plan defines specific error classes. Let me import those too... but they're in `bank-client.interface.ts` which doesn't exist. I'll just use a generic Error or create a local class for testing.

Actually, I think the cleanest approach is:
- For "transient error" test: `bank.send` resolves with `{ status: 'transient_error' }`
- For "timeout" test: `bank.send` rejects with an Error (simulating a network timeout)
- For "permanent rejection" test: `bank.send` resolves with `{ status: 'permanent_rejection' }`

The service should treat a rejected promise from `bank.send` as transient (in-doubt) and a resolved response with `permanent_rejection` as rejected.

Wait, but what about `BankPermanentError`? The plan says it's thrown on permanent rejection. So the service needs to handle:
1. Resolved response with status `permanent_rejection` → markRejected
2. Thrown `BankPermanentError` → markRejected
3. Resolved response with status `transient_error` → markInDoubt
4. Thrown `BankTransientError` → markInDoubt
5. Any other thrown error (timeout, network) → markInDoubt

For the test, I'll cover:
- Test 3 (transient): resolved with `{ status: 'transient_error' }`
- Test 4 (timeout): rejected with a generic Error
- Test 5 (permanent): resolved with `{ status: 'permanent_rejection' }`

This covers the main paths without needing to import the error classes.

Now let me also think about what "concurrent increment skips the order" means. The `incrementAttempt` returns a count (0 if no rows affected). If it returns 0, the service should skip that order. So in the test, I mock `incrementAttempt` to return 0 and verify that `bank.send` is NOT called.

Wait, but looking at the plan's control flow for `executePayments`:
1. Fetch pending orders
2. For each:
   a. If `attempt_count >= maxAttempts` → markParked, continue
   b. Atomically increment (returns new count; if 0 rows affected, skip)
   c. Call bank.send
   d. Classify response

So step (a) checks the current attempt_count from the fetched record. If it's already >= max, park it. Otherwise, increment and proceed.

But wait — if `attempt_count` in the fetched record is already >= max, we park. The increment happens AFTER the check. So the flow is:
- Fetch order with `attempt_count = 4` (max is 5)
- 4 < 5, so don't park
- Increment → attempt_count becomes 5
- Send
- If send fails (transient) → in_doubt
- Next time: fetch order with `attempt_count = 5`
- 5 >= 5, so park

Wait, but the plan says "Cap attempts at 5; after that, park for manual review." So after 5 failed attempts, the 6th time it's seen, it should be parked. Let me re-read...

"Cap attempts at 5; after that, park for manual review and never auto-revert."

So:
- Attempts 1-5: try to send
- After attempt 5 fails (order goes to in_doubt, then reconciliation proves absent → back to pending)
- Now attempt_count is 5
- Next executePayments: fetches it, sees attempt_count >= 5, parks it

Yes, that makes sense. The check is `attempt_count >= maxAttempts` (i.e., >= 5).

Now for the "full lifecycle: 5 timeouts → parked_manual_review" test:
- Start with a pending order, attempt_count = 0
- 5 cycles of: executePayments (sends, times out → in_doubt) + reconcile (proves absent → pending)
- After 5 cycles, attempt_count = 5, status = pending
- 6th executePayments: sees attempt_count >= 5, parks it

Let me now write the full test file. I'll be comprehensive.

One more consideration: the `reconcile` method takes a `ReconcileWindow` with `startDate` and `endDate`. The plan says it enumerates each calendar date in the window. For the "statement not yet complete" test, I need `now` to be before `endOfDay(D) + publishingLagMs`.

For the "proven-absent" test, I need `now` to be after `endOfDay(D) + publishingLagMs`.

I'll need to control the current time. I can use `vi.useFakeTimers()` or pass a specific date that makes the statement complete/not complete based on the `publishingLagMs` option.

Actually, a simpler approach: set `publishingLagMs` to a small value (like 0 or 1) in some tests, or use dates far enough in the past that the statement is always complete. For the "not yet complete" test, use a future date or set `publishingLagMs` very large.

Let me think... if I use `publishingLagMs = 0`, then a statement for date D is complete when `now > endOfDay(D)`. If I use yesterday's date, it's complete. If I use tomorrow's date, it's not.

Actually, let me use a fixed "now" via `vi.setSystemTime()` for tests that need precise time control, and just use dates relative to the system time for others.

Hmm, but `vi.setSystemTime` affects `new Date()` which the service would use internally. Let me check — does the service call `new Date()` or `Date.now()`? The plan doesn't specify, but the "statement is complete" check would use the current time.

I'll use `vi.useFakeTimers()` and `vi.setSystemTime()` where I need precise time control.

Let me draft the test file:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PaymentService, ReconcileWindow } from '../src/payment/payment.service';
import type { BankClient, BankSendResponse, Settlement } from '../src/payment/bank-client.interface';
import type { OrderRecord } from '../src/payment/payment.repository';

// Helper to create a mock order
function makeOrder(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: 'order-1',
    supplier_key: 'key-1',
    amount_minor_units: 100,
    effective_date: new Date('2025-01-15'),
    txid: 'txid-1',
    status: 'pending',
    attempt_count: 0,
    last_attempt_at: null,
    settled_at: null,
    ...overrides,
  };
}

// Helper to create a mock repository
function makeRepoMock() {
  return {
    findPending: vi.fn(),
    findByTxid: vi.fn(),
    findInDoubtByEffectiveDate: vi.fn(),
    markSent: vi.fn().mockResolvedValue(undefined),
    markInDoubt: vi.fn().mockResolvedValue(undefined),
    markRejected: vi.fn().mockResolvedValue(undefined),
    markSettled: vi.fn().mockResolvedValue(undefined),
    markPendingForResend: vi.fn().mockResolvedValue(undefined),
    markParked: vi.fn().mockResolvedValue(undefined),
    incrementAttempt: vi.fn().mockResolvedValue(1),
    upsertSettlement: vi.fn().mockResolvedValue(undefined),
  };
}

// Helper to create a mock bank client
function makeBankMock() {
  return {
    send: vi.fn(),
    getStatement: vi.fn().mockResolvedValue([]),
  };
}

const DEFAULT_OPTS = {
  publishingLagMs: 30 * 60 * 1000, // 30 minutes
  batchSize: 100,
  maxAttempts: 5,
};

describe('PaymentService', () => {
  let service: PaymentService;
  let repo: ReturnType<typeof makeRepoMock>;
  let bank: ReturnType<typeof makeBankMock>;

  beforeEach(() => {
    repo = makeRepoMock();
    bank = makeBankMock();
    service = new PaymentService(repo as any, bank as BankClient, DEFAULT_OPTS);
  });

  // ... tests
});
```

Wait, I need to be careful with types. The `PaymentService` constructor expects a `PaymentRepository` (concrete class) and `BankClient` (interface). Since I'm passing mocks, I'll use `as any` or type the mocks properly.

Actually, looking at this from a testing best practice standpoint, and given that the repository is a concrete class (not an interface), I'll use `as any` for the repo mock since we can't easily create a type-only import of the class without instantiating it.

Let me also think about whether I need to import `OrderRecord` from the repository. The repository file exists (no "Cannot find module" error for it), so I can import from it. But do I need the type? Yes, for typing my mock orders.

Actually wait — the repository file has a `bigint` vs `number` type error. The `OrderRecord` interface in the repository declares `amount_minor_units: number`, but Prisma returns `bigint`. However, the interface itself says `number`. So when I import `OrderRecord` from the repository, I get the declared type (`number`), which is what I want for my mocks. The type error is in the return type of the Prisma calls, not in the interface definition. So importing `OrderRecord` from the repository should be fine for my test purposes.

Let me finalize my approach and write the complete file.

One more thing: for the "full lifecycle" tests, I need to simulate multiple calls to `executePayments` and `reconcile`. The repo mock's return values need to change between calls. I'll use `mockResolvedValueOnce` for sequential returns.

Let me also consider: does the service's `reconcile` method call `repo.findInDoubtByEffectiveDate`? Yes, per the plan. And for each in-doubt order, it checks if the txid is in the statement's set of txids. If not, and the statement is complete, it calls `markPendingForResend`.

So for the "proven-absent" test:
1. Set up an order with status `in_doubt`, effective_date = D
2. Mock `repo.findInDoubtByEffectiveDate(D)` to return that order
3. Mock `bank.getStatement(D)` to return an empty array (or an array not containing the order's txid)
4. Ensure `now > endOfDay(D) + publishingLagMs` (use a past date)
5. Call `reconcile({ startDate: D, endDate: D })`
6. Assert `markPendingForResend` was called with the order's id

For the "timeout-but-settled" test:
1. Set up an order with status `in_doubt`, effective_date = D, txid = 'txid-1'
2. Mock `bank.getStatement(D)` to return a settlement with txid 'txid-1'
3. Mock `repo.findByTxid('txid-1')` to return the order
4. Call `reconcile`
5. Assert `markSettled` was called
6. Assert `markPendingForResend` was NOT called

OK let me write this out now. I'll aim for completeness and clarity.

Actually, one more thought: the `reconcile` method's "proven-absent" check. Per the plan:
- For each date D in the window:
  - Call `bank.getStatement(D)` → get settlements
  - Match settlements to orders (findByTxid + markSettled)
  - If D's statement is complete:
    - Fetch in_doubt orders for date D
    - For each, if txid NOT in the statement's txids → markPendingForResend

So the flow for a single date is:
1. `getStatement(D)` → `Settlement[]`
2. For each settlement: `findByTxid(settlement.txid)` → if found and status is sent/in_doubt → `markSettled` + `upsertSettlement`
3. If complete: `findInDoubtByEffectiveDate(D)` → for each order, if its txid is not in the set from step 1 → `markPendingForResend`

Important: an order that was found in the statement (step 2) and marked settled should NOT also be subject to the proven-absent check in step 3. But since step 3 only looks at `in_doubt` orders, and step 2 changes the status to `settled`, the order won't be returned by `findInDoubtByEffectiveDate` anymore (if it's a real DB). But in our mock, we control what `findInDoubtByEffectiveDate` returns. So in the test, I just need to make sure my mock is consistent.

Actually, for the "timeout-but-settled" test, I want to prove that:
- An order in `in_doubt` state that IS found in the statement gets settled (not resent)
- The key assertion is that `markPendingForResend` is NOT called for that order

I'll set up the mock so that `findInDoubtByEffectiveDate` returns an empty array (since the order was already settled in step 2), OR I return the order but with the understanding that its txid IS in the statement's set, so it wouldn't be marked for resend anyway.

Actually, the cleanest test is:
- `findInDoubtByEffectiveDate` returns the order (simulating that the status hasn't been updated yet in the same transaction)
- The statement DOES contain the order's txid
- Assert that `markPendingForResend` is NOT called (because the txid IS in the statement)

This directly tests the "no resend when found in statement" logic.

Let me write the file now.
```

## reply

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PaymentService, ReconcileWindow } from '../src/payment/payment.service';
import type { BankClient, BankSendResponse, Settlement } from '../src/payment/bank-client.interface';
import type { OrderRecord } from '../src/payment/payment.repository';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeOrder(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: 'order-1',
    supplier_key: 'key-1',
    amount_minor_units: 100,
    effective_date: new Date('2025-01-15'),
    txid: 'txid-1',
    status: 'pending',
    attempt_count: 0,
    last_attempt_at: null,
    settled_at: null,
    ...overrides,
  };
}

function makeRepoMock() {
  return {
    findPending: vi.fn().mockResolvedValue([]),
    findByTxid: vi.fn().mockResolvedValue(null),
    findInDoubtByEffectiveDate: vi.fn().mockResolvedValue([]),
    markSent: vi.fn().mockResolvedValue(undefined),
    markInDoubt: vi.fn().mockResolvedValue(undefined),
    markRejected: vi.fn().mockResolvedValue(undefined),
    markSettled: vi.fn().mockResolvedValue(undefined),
    markPendingForResend: vi.fn().mockResolvedValue(undefined),
    markParked: vi.fn().mockResolvedValue(undefined),
    incrementAttempt: vi.fn().mockResolvedValue(1),
    upsertSettlement: vi.fn().mockResolvedValue(undefined),
  };
}

function makeBankMock() {
  return {
    send: vi.fn(),
    getStatement: vi.fn().mockResolvedValue([]),
  };
}

const DEFAULT_OPTS = {
  publishingLagMs: 30 * 60 * 1000,
  batchSize: 100,
  maxAttempts: 5,
};

// A date far enough in the past that its statement is always complete.
const PAST_DATE = new Date('2025-01-15');

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PaymentService', () => {
  let repo: ReturnType<typeof makeRepoMock>;
  let bank: ReturnType<typeof makeBankMock>;
  let service: PaymentService;

  beforeEach(() => {
    repo = makeRepoMock();
    bank = makeBankMock();
    // ASSUMPTION: PaymentService and BankClient modules will exist per the plan manifest.
    service = new PaymentService(repo as any, bank as BankClient, DEFAULT_OPTS);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── executePayments ──────────────────────────────────────────────────────

  describe('executePayments', () => {
    it('accepted response transitions pending → sent', async () => {
      const order = makeOrder();
      repo.findPending.mockResolvedValue([order]);
      bank.send.mockResolvedValue({ status: 'accepted' } satisfies BankSendResponse);

      await service.executePayments();

      expect(bank.send).toHaveBeenCalledWith({
        txid: order.txid,
        amount_minor_units: order.amount_minor_units,
        key: order.supplier_key,
      });
      expect(repo.markSent).toHaveBeenCalledWith(order.id, expect.any(Date));
      expect(repo.markInDoubt).not.toHaveBeenCalled();
      expect(repo.markRejected).not.toHaveBeenCalled();
    });

    it('duplicate response transitions pending → sent', async () => {
      const order = makeOrder();
      repo.findPending.mockResolvedValue([order]);
      bank.send.mockResolvedValue({ status: 'duplicate' } satisfies BankSendResponse);

      await service.executePayments();

      expect(repo.markSent).toHaveBeenCalledWith(order.id, expect.any(Date));
      expect(repo.markInDoubt).not.toHaveBeenCalled();
    });

    it('transient error response transitions pending → in_doubt', async () => {
      const order = makeOrder();
      repo.findPending.mockResolvedValue([order]);
      bank.send.mockResolvedValue({ status: 'transient_error' } satisfies BankSendResponse);

      await service.executePayments();

      expect(repo.markInDoubt).toHaveBeenCalledWith(order.id, expect.any(Date));
      expect(repo.markSent).not.toHaveBeenCalled();
      expect(repo.markRejected).not.toHaveBeenCalled();
    });

    it('timeout (rejected promise) transitions pending → in_doubt', async () => {
      const order = makeOrder();
      repo.findPending.mockResolvedValue([order]);
      bank.send.mockRejectedValue(new Error('timeout'));

      await service.executePayments();

      expect(repo.markInDoubt).toHaveBeenCalledWith(order.id, expect.any(Date));
      expect(repo.markSent).not.toHaveBeenCalled();
      expect(repo.markRejected).not.toHaveBeenCalled();
    });

    it('permanent rejection response transitions pending → rejected', async () => {
      const order = makeOrder();
      repo.findPending.mockResolvedValue([order]);
      bank.send.mockResolvedValue({ status: 'permanent_rejection' } satisfies BankSendResponse);

      await service.executePayments();

      expect(repo.markRejected).toHaveBeenCalledWith(order.id);
      expect(repo.markSent).not.toHaveBeenCalled();
      expect(repo.markInDoubt).not.toHaveBeenCalled();
    });

    it('attempt_count >= max parks the order without calling bank', async () => {
      const order = makeOrder({ attempt_count: 5 });
      repo.findPending.mockResolvedValue([order]);

      await service.executePayments();

      expect(bank.send).not.toHaveBeenCalled();
      expect(repo.markParked).toHaveBeenCalledWith(order.id);
    });

    it('concurrent increment (0 rows affected) skips the order', async () => {
      const order = makeOrder();
      repo.findPending.mockResolvedValue([order]);
      repo.incrementAttempt.mockResolvedValue(0); // another worker won the race

      await service.executePayments();

      expect(bank.send).not.toHaveBeenCalled();
      expect(repo.markSent).not.toHaveBeenCalled();
      expect(repo.markInDoubt).not.toHaveBeenCalled();
    });
  });

  // ─── reconcile ────────────────────────────────────────────────────────────

  describe('reconcile', () => {
    it('found-in-statement transitions sent → settled', async () => {
      const order = makeOrder({ status: 'sent' });
      const settlement: Settlement = {
        txid: order.txid,
        amount_minor_units: order.amount_minor_units,
        settled_at: new Date('2025-01-15T12:00:00Z'),
      };

      repo.findByTxid.mockResolvedValue(order);
      bank.getStatement.mockResolvedValue([settlement]);

      const window: ReconcileWindow = { startDate: PAST_DATE, endDate: PAST_DATE };
      const result = await service.reconcile(window);

      expect(repo.markSettled).toHaveBeenCalledWith(order.id, settlement.settled_at);
      expect(result.settled).toBe(1);
    });

    it('found-in-statement transitions in_doubt → settled (timeout-but-settled, no resend)', async () => {
      const order = makeOrder({ status: 'in_doubt' });
      const settlement: Settlement = {
        txid: order.txid,
        amount_minor_units: order.amount_minor_units,
        settled_at: new Date('2025-01-15T12:00:00Z'),
      };

      repo.findByTxid.mockResolvedValue(order);
      bank.getStatement.mockResolvedValue([settlement]);

      const window: ReconcileWindow = { startDate: PAST_DATE, endDate: PAST_DATE };
      const result = await service.reconcile(window);

      expect(repo.markSettled).toHaveBeenCalledWith(order.id, settlement.settled_at);
      expect(repo.markPendingForResend).not.toHaveBeenCalled();
      expect(result.settled).toBe(1);
    });

    it('proven-absent transitions in_doubt → pending (same txid preserved)', async () => {
      const order = makeOrder({ status: 'in_doubt' });
      // Statement is empty — the order's txid is absent.
      bank.getStatement.mockResolvedValue([]);
      repo.findInDoubtByEffectiveDate.mockResolvedValue([order]);

      const window: ReconcileWindow = { startDate: PAST_DATE, endDate: PAST_DATE };
      const result = await service.reconcile(window);

      expect(repo.markPendingForResend).toHaveBeenCalledWith(order.id);
      expect(result.provenAbsent).toBe(1);
    });

    it('statement not yet complete leaves in_doubt unchanged', async () => {
      // Use a future date so the statement is not yet complete.
      const futureDate = new Date('2099-01-01');
      const order = makeOrder({ status: 'in_doubt', effective_date: futureDate });

      bank.getStatement.mockResolvedValue([]);
      repo.findInDoubtByEffectiveDate.mockResolvedValue([order]);

      const window: ReconcileWindow = { startDate: futureDate, endDate: futureDate };
      const result = await service.reconcile(window);

      expect(repo.markPendingForResend).not.toHaveBeenCalled();
      expect(result.provenAbsent).toBe(0);
    });

    it('overlapping windows are idempotent', async () => {
      const order = makeOrder({ status: 'sent' });
      const settlement: Settlement = {
        txid: order.txid,
        amount_minor_units: order.amount_minor_units,
        settled_at: new Date('2025-01-15T12:00:00Z'),
      };

      repo.findByTxid.mockResolvedValue(order);
      bank.getStatement.mockResolvedValue([settlement]);

      const window: ReconcileWindow = { startDate: PAST_DATE, endDate: PAST_DATE };

      // First run settles the order.
      await service.reconcile(window);
      expect(repo.markSettled).toHaveBeenCalledTimes(1);

      // Second run over the same window: findByTxid now returns a settled order.
      repo.findByTxid.mockResolvedValue(makeOrder({ status: 'settled' }));
      await service.reconcile(window);

      // markSettled should not be called again for an already-settled order.
      expect(repo.markSettled).toHaveBeenCalledTimes(1);
    });

    it('rejected orders are untouched by reconciliation', async () => {
      const order = makeOrder({ status: 'rejected' });
      const settlement: Settlement = {
        txid: order.txid,
        amount_minor_units: order.amount_minor_units,
        settled_at: new Date('2025-01-15T12:00:00Z'),
      };

      repo.findByTxid.mockResolvedValue(order);
      bank.getStatement.mockResolvedValue([settlement]);

      const window: ReconcileWindow = { startDate: PAST_DATE, endDate: PAST_DATE };
      const result = await service.reconcile(window);

      expect(repo.markSettled).not.toHaveBeenCalled();
      expect(result.settled).toBe(0);
    });
  });

  // ─── deriveTxid ───────────────────────────────────────────────────────────

  describe('deriveTxid', () => {
    it('is deterministic for the same input', () => {
      const id = 'order-1';
      const date = new Date('2025-06-01');
      const a = service.deriveTxid(id, date);
      const b = service.deriveTxid(id, date);
      expect(a).toBe(b);
    });

    it('yields different txids for different orders or dates', () => {
      const date = new Date('2025-06-01');
      const txidA = service.deriveTxid('order-1', date);
      const txidB = service.deriveTxid('order-2', date);
      const txidC = service.deriveTxid('order-1', new Date('2025-06-02'));
      expect(txidA).not.toBe(txidB);
      expect(txidA).not.toBe(txidC);
    });
  });

  // ─── Full lifecycle ───────────────────────────────────────────────────────

  describe('full lifecycle', () => {
    it('timeout → reconcile proves absent → resend accepted → settle', async () => {
      const order = makeOrder({ attempt_count: 0 });

      // Phase 1: executePayments — send times out.
      repo.findPending.mockResolvedValue([order]);
      repo.incrementAttempt.mockResolvedValueOnce(1);
      bank.send.mockRejectedValueOnce(new Error('timeout'));

      await service.executePayments();
      expect(repo.markInDoubt).toHaveBeenCalledWith(order.id, expect.any(Date));

      // Phase 2: reconcile — proven absent, order goes back to pending.
      const inDoubtOrder = makeOrder({ status: 'in_doubt', attempt_count: 1 });
      bank.getStatement.mockResolvedValue([]);
      repo.findInDoubtByEffectiveDate.mockResolvedValue([inDoubtOrder]);

      const window: ReconcileWindow = { startDate: PAST_DATE, endDate: PAST_DATE };
      await service.reconcile(window);
      expect(repo.markPendingForResend).toHaveBeenCalledWith(order.id);

      // Phase 3: executePayments — resend with same txid, accepted.
      const pendingOrder = makeOrder({ status: 'pending', attempt_count: 1 });
      repo.findPending.mockResolvedValue([pendingOrder]);
      repo.incrementAttempt.mockResolvedValueOnce(2);
      bank.send.mockResolvedValueOnce({ status: 'accepted' });

      await service.executePayments();
      expect(bank.send).toHaveBeenLastCalledWith({
        txid: order.txid, // same txid preserved
        amount_minor_units: order.amount_minor_units,
        key: order.supplier_key,
      });
      expect(repo.markSent).toHaveBeenCalledWith(order.id, expect.any(Date));

      // Phase 4: reconcile — settlement found.
      const sentOrder = makeOrder({ status: 'sent' });
      const settlement: Settlement = {
        txid: order.txid,
        amount_minor_units: order.amount_minor_units,
        settled_at: new Date('2025-01-15T18:00:00Z'),
      };
      repo.findByTxid.mockResolvedValue(sentOrder);
      bank.getStatement.mockResolvedValue([settlement]);

      await service.reconcile(window);
      expect(repo.markSettled).toHaveBeenCalledWith(order.id, settlement.settled_at);
    });

    it('5 timeouts → parked_manual_review', async () => {
      // Simulate 5 full cycles of: execute (timeout) + reconcile (proven absent).
      for (let attempt = 1; attempt <= 5; attempt++) {
        const orderForExecute = makeOrder({ status: 'pending', attempt_count: attempt - 1 });
        repo.findPending.mockResolvedValue([orderForExecute]);
        repo.incrementAttempt.mockResolvedValueOnce(attempt);
        bank.send.mockRejectedValueOnce(new Error('timeout'));

        await service.executePayments();
        expect(repo.markInDoubt).toHaveBeenCalledWith('order-1', expect.any(Date));

        // Reconcile: proven absent → back to pending.
        const inDoubtOrder = makeOrder({ status: 'in_doubt', attempt_count: attempt });
        bank.getStatement.mockResolvedValue([]);
        repo.findInDoubtByEffectiveDate.mockResolvedValue([inDoubtOrder]);

        const window: ReconcileWindow = { startDate: PAST_DATE, endDate: PAST_DATE };
        await service.reconcile(window);
        expect(repo.markPendingForResend).toHaveBeenCalledWith('order-1');
      }

      // 6th executePayments: attempt_count is now 5, should park.
      const exhaustedOrder = makeOrder({ status: 'pending', attempt_count: 5 });
      repo.findPending.mockResolvedValue([exhaustedOrder]);

      await service.executePayments();
      expect(bank.send).not.toHaveBeenCalled();
      expect(repo.markParked).toHaveBeenCalledWith('order-1');
    });
  });
});
```
