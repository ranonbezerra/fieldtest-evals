# repair1-payment.spec.ts-retry

## reasoning

```
Let me analyze the compiler errors that pertain to `test/payment.spec.ts`:

1. `test/payment.spec.ts(2,49): error TS2307: Cannot find module '../src/payment/payment.service' or its corresponding type declarations.`
2. `test/payment.spec.ts(7,8): error TS2307: Cannot find module '../src/payment/bank-client.interface' or its corresponding type declarations.`

So the test file imports from `../src/payment/payment.service` and `../src/payment/bank-client.interface`. These modules don't exist yet (they're part of the other files that need to be created), but the test file needs to reference them.

Now, I need to rewrite `test/payment.spec.ts` completely. The tests must:
- Import from the correct paths
- Test the behavior as specified in the plan
- Use Vitest
- Not assert only that a call happened
- Test behavior, not implementation

Let me look at what the plan specifies for tests:

| Test | What it proves |
|------|---------------|
| `executePayments: accepted response transitions pending → sent` | A successful bank send marks the order as settled-pending (awaiting reconciliation). |
| `executePayments: duplicate response transitions pending → sent` | Idempotent re-send (same txid) is treated as success. |
| `executePayments: transient error transitions pending → in_doubt` | A known-failure is flagged for reconciliation before any resend. |
| `executePayments: timeout transitions pending → in_doubt` | An unknown outcome (timeout) is treated identically to a transient error. |
| `executePayments: permanent rejection transitions pending → rejected` | A definitive bank refusal is terminal; no further attempts. |
| `executePayments: attempt_count >= max parks the order` | The 6th eligibility triggers `parked_manual_review`; no bank call is made. |
| `executePayments: concurrent increment skips the order` | Two workers racing on the same order results in exactly one send. |
| `reconcile: found-in-statement transitions sent → settled` | A confirmed settlement advances a known-sent order to its terminal success state. |
| `reconcile: found-in-statement transitions in_doubt → settled (timeout-but-settled)` | A timed-out send that actually went through is NOT resent; it is settled. This is the critical "no double-pay" guarantee. |
| `reconcile: proven-absent transitions in_doubt → pending (same txid preserved)` | After the publishing lag, an absent order becomes eligible for resend with its original txid. |
| `reconcile: statement not yet complete leaves in_doubt unchanged` | Before the lag expires, no proven-absent transition occurs. |
| `reconcile: overlapping windows are idempotent` | Running reconcile twice over the same window does not double-count or corrupt state. |
| `reconcile: rejected orders are untouched by reconciliation` | Terminal `rejected` status is never modified by reconcile. |
| `deriveTxid: deterministic for same input` | Same orderId + effectiveDate always yields the same txid. |
| `deriveTxid: different orders or dates yield different txids` | The derivation is injective (collision-free in practice). |
| `full lifecycle: timeout → reconcile proves absent → resend accepted → settle` | End-to-end happy path with a timeout and one retry. |
| `full lifecycle: 5 timeouts → parked_manual_review` | Attempt exhaustion parks the order; a 6th reconcile does not re-park or modify it. |

Now, since this is a unit test (Vitest), I need to mock the repository and bank client. The test file should:
- Mock `PaymentRepository` 
- Mock `BankClient`
- Create a `PaymentService` instance with the mocks
- Test each behavior

Let me think about what the `PaymentService` constructor takes based on the plan:
```typescript
constructor(
  repo: PaymentRepository,
  bank: BankClient,
  opts: { publishingLagMs: number; batchSize: number; maxAttempts: number },
);
```

And the repository interface:
```typescript
interface OrderRecord {
  id: string;
  supplier_key: string;
  amount_minor_units: number;
  effective_date: Date;
  txid: string;
  status: OrderStatus;
  attempt_count: number;
  last_attempt_at: Date | null;
  settled_at: Date | null;
}
```

The repository methods:
```typescript
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

upsertSettlement(data: {
  txid: string;
  amount_minor_units: number;
  settled_at: Date;
  statement_date: Date;
}): Promise<void>;
```

Wait, `incrementAttempt` returns a number (the new count) and if 0 rows affected returns... hmm, the plan says "returns the new count; if rows affected is 0, another process won the race and this one skips." So maybe it returns `null` or `0` or throws? Let me re-read: "The repository's `incrementAttempt` uses an atomic `UPDATE … SET attempt_count = attempt_count + 1 WHERE id = ? AND status = 'pending'` returning the new count; if rows affected is 0, another process won the race and this one skips."

So it probably returns `number | null` where null means no rows affected. Or maybe it returns the new count and throws if no rows? Let me think about what makes sense. In Prisma, `updateMany` returns `{ count: number }`. So the repository method could return the new count if successful, or null/undefined if not. Let me assume it returns `number | null` where `null` means the order wasn't in `pending` state.

Actually, looking more carefully at the plan: "returns the new count; if rows affected is 0, another process won the race and this one skips." This suggests the method returns a number (the new attempt count) when successful, and something falsy (null or 0) when it fails. I'll assume `Promise<number | null>`.

Wait, but looking at the plan's type signature: `incrementAttempt(id: string, lastAttemptAt: Date): Promise<number>;` — it says `Promise<number>`, not `Promise<number | null>`. Maybe it throws when no rows affected? Or maybe it returns 0?

I'll go with the interpretation that it returns `number` where 0 means "no rows affected, skip this order". Actually no, that's ambiguous with a legitimate count of 0. Let me just use `Promise<number | null>` in my mock and assume null means skip.

Actually, I think the safest approach is to just mock it and have it return a number. For the "concurrent" test, I'll have it return 0 or null to indicate the race was lost. Let me just go with `number | null` where null means "another worker got it".

Hmm, but the plan says `Promise<number>`. Let me just go with that and have it throw an error or return 0 for the race-lost case. Actually, I'll just mock it to return a number, and for the concurrent test, I'll have it return 0 to indicate "no rows updated" which the service should interpret as "skip".

Wait, I'm overthinking this. The test file just needs to import from the right paths and test the behaviors. Since I'm writing the test, I control the mock behavior. Let me just make the mocks work.

Let me now write the test file. I'll use `vi.fn()` for mocking.

Key things to get right:
1. Import paths must be `../src/payment/payment.service` and `../src/payment/bank-client.interface` (matching the error messages)
2. The test must use Vitest (`import { describe, it, expect, vi } from 'vitest'`)
3. Tests must assert behavior, not just that calls happened
4. Must cover all 17 test cases from the plan

Let me think about how to structure the mocks:

For `PaymentRepository`, I'll create a mock object with all the methods as `vi.fn()`.

For `BankClient`, I'll create a mock object with `send` and `getStatement` as `vi.fn()`.

For `PaymentService`, I'll instantiate it with the mocks and options.

Let me write this out:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaymentService } from '../src/payment/payment.service';
import type { BankClient, BankSendResponse, Settlement } from '../src/payment/bank-client.interface';

// Helper to create a mock repository
function createMockRepo() {
  return {
    findPending: vi.fn(),
    findByTxid: vi.fn(),
    findInDoubtByEffectiveDate: vi.fn(),
    markSent: vi.fn(),
    markInDoubt: vi.fn(),
    markRejected: vi.fn(),
    markSettled: vi.fn(),
    markPendingForResend: vi.fn(),
    markParked: vi.fn(),
    incrementAttempt: vi.fn(),
    upsertSettlement: vi.fn(),
  };
}

function createMockBank() {
  return {
    send: vi.fn(),
    getStatement: vi.fn(),
  };
}

const defaultOpts = {
  publishingLagMs: 30 * 60 * 1000,
  batchSize: 100,
  maxAttempts: 5,
};

function makeOrder(overrides = {}) {
  return {
    id: 'order-1',
    supplier_key: 'key-1',
    amount_minor_units: 1000,
    effective_date: new Date('2025-01-15'),
    txid: 'txid-1',
    status: 'pending' as const,
    attempt_count: 0,
    last_attempt_at: null,
    settled_at: null,
    ...overrides,
  };
}

describe('PaymentService', () => {
  let repo: ReturnType<typeof createMockRepo>;
  let bank: ReturnType<typeof createMockBank>;
  let service: PaymentService;

  beforeEach(() => {
    repo = createMockRepo();
    bank = createMockBank();
    service = new PaymentService(repo as any, bank as any, defaultOpts);
  });

  // ... tests
});
```

Wait, I need to be careful. The `PaymentService` constructor takes specific types. Since the actual files don't exist yet (they're being created as part of this task), the test file just needs to have the right imports and the compiler will resolve them once those files exist.

Actually wait - re-reading the task: "Rewrite `test/payment.spec.ts` complete, fixing what these messages require of this file."

The messages for `test/payment.spec.ts` are:
1. `test/payment.spec.ts(2,49): error TS2307: Cannot find module '../src/payment/payment.service' or its corresponding type declarations.`
2. `test/payment.spec.ts(7,8): error TS2307: Cannot find module '../src/payment/bank-client.interface' or its corresponding type declarations.`

These are "cannot find module" errors, meaning the files don't exist yet. The fix is to make sure the import paths are correct (they will resolve once the other files are created). But since I'm only asked to rewrite `test/payment.spec.ts`, I need to make sure the imports are correct and the file compiles once the other files exist.

So my job is:
1. Write a complete `test/payment.spec.ts` that imports from the correct paths
2. The imports should match what the other files will export
3. All 17 test cases from the plan must be covered
4. Tests must assert behavior, not just call counts

Let me think about what the `PaymentService` class exports and what methods it has. From the plan:
- `executePayments(): Promise<void>`
- `reconcile(window: ReconcileWindow): Promise<ReconcileResult>`
- `deriveTxid(orderId: string, effectiveDate: Date): string`

And the `ReconcileWindow` type:
```typescript
interface ReconcileWindow {
  startDate: Date;
  endDate: Date;
}
```

And `ReconcileResult`:
```typescript
interface ReconcileResult {
  settled: number;
  provenAbsent: number;
}
```

Now, for the bank client interface, from the plan:
```typescript
interface BankSendRequest {
  txid: string;
  amount_minor_units: number;
  key: string;
}

type BankSendStatus = 'accepted' | 'duplicate' | 'transient_error' | 'permanent_rejection';

interface BankSendResponse {
  status: BankSendStatus;
  message?: string;
}

interface Settlement {
  txid: string;
  amount_minor_units: number;
  settled_at: Date;
}

interface BankClient {
  send(req: BankSendRequest): Promise<BankSendResponse>;
  getStatement(date: Date): Promise<Settlement[]>;
}
```

Now let me think about the test cases more carefully:

1. **executePayments: accepted response transitions pending → sent**
   - Mock `findPending` to return one order with status 'pending'
   - Mock `incrementAttempt` to return 1 (success)
   - Mock `bank.send` to return `{ status: 'accepted' }`
   - Call `service.executePayments()`
   - Assert `repo.markSent` was called with the order id and a date
   - Wait, "Never assert only that a call happened." I need to assert something about the state or behavior.
   
   Hmm, but with mocks, how do I assert state? The service is supposed to call repository methods to change state. If I'm unit testing the service with a mocked repo, the "behavior" IS the sequence of repository calls. But the convention says "Never assert only that a call happened."
   
   Let me re-read: "Test the behaviour, not the implementation. Never assert only that a call happened."
   
   I think this means: don't just do `expect(repo.markSent).toHaveBeenCalled()`. Instead, assert the outcome. But with a mock repo, the outcome IS the call to markSent...
   
   I think the right interpretation is: assert that the correct method was called with the correct arguments, and also assert that the wrong methods were NOT called. For example:
   - `expect(repo.markSent).toHaveBeenCalledWith('order-1', expect.any(Date))`
   - `expect(repo.markInDoubt).not.toHaveBeenCalled()`
   - `expect(repo.markRejected).not.toHaveBeenCalled()`
   
   This asserts the behavioral outcome (the order was marked sent, not in_doubt, not rejected).

   Actually, I think a better approach for some tests would be to use a more integration-style test where the mock repo maintains state. Let me think...

   Actually, for a unit test of the service, I think the right approach is:
   - Assert which state transition method was called (and with what args)
   - Assert which methods were NOT called
   - This proves the behavior (correct state transition) without just saying "a call happened"

   Let me go with that approach.

2. **executePayments: duplicate response transitions pending → sent**
   - Same as above but `bank.send` returns `{ status: 'duplicate' }`

3. **executePayments: transient error transitions pending → in_doubt**
   - `bank.send` returns `{ status: 'transient_error' }`
   - Assert `markInDoubt` called, `markSent` not called

4. **executePayments: timeout transitions pending → in_doubt**
   - `bank.send` rejects with an error (timeout)
   - Assert `markInDoubt` called

5. **executePayments: permanent rejection transitions pending → rejected**
   - `bank.send` returns `{ status: 'permanent_rejection' }`
   - Assert `markRejected` called

6. **executePayments: attempt_count >= max parks the order**
   - Order has `attempt_count: 5` (which is >= maxAttempts of 5)
   - Wait, the plan says "If `attempt_count >= maxAttempts` → call `markParked`. Continue."
   - So if attempt_count is already 5 and maxAttempts is 5, park it.
   - Assert `markParked` called, `bank.send` NOT called

7. **executePayments: concurrent increment skips the order**
   - `incrementAttempt` returns 0 (or null) indicating race lost
   - Assert `bank.send` NOT called

8. **reconcile: found-in-statement transitions sent → settled**
   - Order with status 'sent', txid 'txid-1'
   - `bank.getStatement` returns settlement with txid 'txid-1'
   - `repo.findByTxid('txid-1')` returns the order
   - Assert `markSettled` called

9. **reconcile: found-in-statement transitions in_doubt → settled (timeout-but-settled)**
   - Order with status 'in_doubt'
   - Settlement found in statement
   - Assert `markSettled` called (NOT markPendingForResend)

10. **reconcile: proven-absent transitions in_doubt → pending (same txid preserved)**
    - Order with status 'in_doubt', effective_date in the window, statement is complete
    - `bank.getStatement` returns empty array (or array not containing the txid)
    - Assert `markPendingForResend` called

11. **reconcile: statement not yet complete leaves in_doubt unchanged**
    - Order with status 'in_doubt', effective_date in window
    - But the statement is NOT complete (now < endOfDay + lag)
    - Assert `markPendingForResend` NOT called

12. **reconcile: overlapping windows are idempotent**
    - Run reconcile twice
    - Assert second run doesn't change anything (or returns 0 counts)

13. **reconcile: rejected orders are untouched by reconciliation**
    - Order with status 'rejected'
    - Even if found in statement, don't change it

14. **deriveTxid: deterministic for same input**
    - Call `service.deriveTxid('order-1', someDate)` twice, assert same result

15. **deriveTxid: different orders or dates yield different txids**
    - Call with different params, assert different results

16. **full lifecycle: timeout → reconcile proves absent → resend accepted → settle**
    - First: executePayments with timeout → in_doubt
    - Then: reconcile proves absent → pending
    - Then: executePayments again → accepted → sent
    - Then: reconcile finds in statement → settled

17. **full lifecycle: 5 timeouts → parked_manual_review**
    - 5 rounds of executePayments with timeout
    - 6th round: parked

Now, for the "full lifecycle" tests, I need to make the mocks stateful. Let me create a more sophisticated mock that maintains state.

Actually, let me reconsider. For the full lifecycle tests, I'll need to:
- Have `findPending` return orders based on their current status
- Have the mark* methods actually update the in-memory state
- Have `incrementAttempt` actually increment

This is getting complex. Let me create a simple in-memory state for the order that the mock repo operates on.

Let me write this out properly now.

Actually, I realize I need to be more careful about what `incrementAttempt` returns. The plan says:
"Atomically increment attempt and set `last_attempt_at` (returns new count; if 0 rows affected, another worker won the race and this one skips)."

So the service checks the return value. If it's 0 (or null/undefined), skip. Let me have it return `number | null` where null means "no rows affected". But the plan's type says `Promise<number>`. Hmm.

Actually, looking at this more carefully, in Prisma, `updateMany` returns `{ count: number }`. So the repository method could:
- Do `const result = await prisma.order.updateMany({ where: { id, status: 'pending' }, data: { attempt_count: { increment: 1 } } })`
- If `result.count === 0`, return null (or throw)
- Otherwise, fetch the new count and return it

Or maybe it does:
```typescript
const result = await prisma.$transaction(async (tx) => {
  const updated = await tx.order.updateMany({
    where: { id, status: 'pending' },
    data: { attempt_count: { increment: 1 }, last_attempt_at: lastAttemptAt },
  });
  if (updated.count === 0) return null;
  const order = await tx.order.findUniqueOrThrow({ where: { id } });
  return order.attempt_count;
});
```

So the return type would be `Promise<number | null>`. But the plan says `Promise<number>`. I'll go with what makes sense for the test: the mock returns a number on success, and I'll have it return 0 or null on failure. For the test, I'll just have the mock return a number, and for the "concurrent" test, return 0 (treating 0 as "no rows affected").

Wait, actually if the plan says `Promise<number>` and the service is supposed to check "if rows affected is 0, skip", then maybe the convention is that it returns 0 when no rows were affected. Let me just go with that: return type is `number`, and 0 means "skip".

Hmm, but that's weird because attempt_count could legitimately be... well, no, if you're incrementing from a pending state, the minimum would be 1 (0 + 1). So 0 can safely mean "no rows affected".

OK let me just write the tests now. I'll use `number` for the return type of `incrementAttempt`, with 0 meaning "no rows affected, skip".

Let me also think about the `reconcile` method's behavior more carefully:

```
1. Enumerate each calendar date D from window.startDate to window.endDate.
2. For each D:
   a. Call bank.getStatement(D).
   b. Match settlements: For each settlement, findByTxid. If found with status sent or in_doubt, markSettled + upsertSettlement.
   c. Proven-absent: If D's statement is complete (now > endOfDay(D) + publishingLagMs):
      - Fetch all orders with status in_doubt and effective_date = D.
      - For each, if txid NOT in the set of txids from getStatement(D), markPendingForResend.
```

So for the proven-absent test, I need:
- `repo.findInDoubtByEffectiveDate(D)` returns orders with status 'in_doubt'
- The statement for D is complete
- The txid of the in_doubt order is NOT in the statement

For the "statement not yet complete" test:
- Same setup but `now` is before `endOfDay(D) + publishingLagMs`
- I'll need to control "now" somehow. I can use `vi.useFakeTimers()` or inject a clock.

Hmm, the plan doesn't mention a clock injection. The service just uses `Date.now()` or `new Date()`. For testing, I can use `vi.useFakeTimers()` and `vi.setSystemTime()`.

Let me plan the test structure:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PaymentService } from '../src/payment/payment.service';
import type { BankClient, BankSendResponse, Settlement } from '../src/payment/bank-client.interface';

// ... mock helpers, test cases
```

Wait, I need to check: does the plan export `BankClient` as a type from `bank-client.interface.ts`? Yes:
```typescript
interface BankClient {
  send(req: BankSendRequest): Promise<BankSendResponse>;
  getStatement(date: Date): Promise<Settlement[]>;
}
```

And `BankSendResponse`:
```typescript
interface BankSendResponse {
  status: BankSendStatus;
  message?: string;
}
```

And `Settlement`:
```typescript
interface Settlement {
  txid: string;
  amount_minor_units: number;
  settled_at: Date;
}
```

These are all interfaces (types), so I should import them with `import type`.

Now let me write the complete test file. I'll be thorough and cover all 17 test cases.

For the "concurrent increment" test, I need to think about what the service does when `incrementAttempt` returns 0. Based on the plan: "if rows affected is 0, another process won the race and this one skips." So the service should skip that order (not call bank.send, not mark anything).

Let me also think about the `findPending` mock. It returns orders with status 'pending'. For the "attempt_count >= max" test, the order is still in 'pending' status (it was previously set back to pending after being proven absent, and now its attempt_count is at the max). So `findPending` returns it, but the service should park it instead of sending.

Wait, let me re-read the plan:
"If `attempt_count >= maxAttempts` → call `markParked`. Continue."

This check happens BEFORE incrementing. So the flow is:
1. Fetch pending orders
2. For each order:
   a. If attempt_count >= maxAttempts → markParked, continue
   b. incrementAttempt (atomic)
   c. bank.send
   d. classify response

So for the "park" test:
- Order has status 'pending', attempt_count = 5, maxAttempts = 5
- `findPending` returns it
- Service sees attempt_count >= maxAttempts, calls markParked
- bank.send is NOT called

For the "concurrent" test:
- Order has status 'pending', attempt_count = 0
- `findPending` returns it
- Service calls incrementAttempt, which returns 0 (race lost)
- Service skips the order (no bank.send, no mark*)

OK I think I have enough to write this. Let me also consider: for the full lifecycle tests, I need a stateful mock. Let me create a helper that maintains an order object and updates it when mark* methods are called.

Here's my plan for the stateful mock:

```typescript
function createStatefulMockRepo(order: any) {
  const repo = {
    findPending: vi.fn(async (limit: number) => 
      order.status === 'pending' ? [order] : []
    ),
    findByTxid: vi.fn(async (txid: string) => 
      order.txid === txid ? order : null
    ),
    findInDoubtByEffectiveDate: vi.fn(async (date: Date) => 
      order.status === 'in_doubt' && sameDay(order.effective_date, date) ? [order] : []
    ),
    markSent: vi.fn(async (id: string, lastAttemptAt: Date) => {
      if (id === order.id) { order.status = 'sent'; order.last_attempt_at = lastAttemptAt; }
    }),
    markInDoubt: vi.fn(async (id: string, lastAttemptAt: Date) => {
      if (id === order.id) { order.status = 'in_doubt'; order.last_attempt_at = lastAttemptAt; }
    }),
    markRejected: vi.fn(async (id: string) => {
      if (id === order.id) { order.status = 'rejected'; }
    }),
    markSettled: vi.fn(async (id: string, settledAt: Date) => {
      if (id === order.id && (order.status === 'sent' || order.status === 'in_doubt')) {
        order.status = 'settled'; order.settled_at = settledAt;
      }
    }),
    markPendingForResend: vi.fn(async (id: string) => {
      if (id === order.id && order.status === 'in_doubt') {
        order.status = 'pending';
      }
    }),
    markParked: vi.fn(async (id: string) => {
      if (id === order.id) { order.status = 'parked_manual_review'; }
    }),
    incrementAttempt: vi.fn(async (id: string, lastAttemptAt: Date) => {
      if (id === order.id && order.status === 'pending') {
        order.attempt_count += 1;
        order.last_attempt_at = lastAttemptAt;
        return order.attempt_count;
      }
      return 0;
    }),
    upsertSettlement: vi.fn(async () => {}),
  };
  return repo;
}
```

This is getting complex but it's the right approach for behavior testing. Let me write the full file now.

One more consideration: the `reconcile` method takes a `ReconcileWindow` with `startDate` and `endDate`. I need to figure out how the service enumerates dates. The plan says "Enumerate each calendar date D from window.startDate to window.endDate." So if start and end are the same date, it processes just that one date.

For the "statement not yet complete" test, I need to control the current time. I'll use `vi.useFakeTimers()`.

Let me also think about the `endOfDay(D)` calculation. If D is '2025-01-15', then endOfDay would be '2025-01-15T23:59:59.999Z' (or maybe '2025-01-16T00:00:00.000Z'). The plan says "now > endOfDay(D) + PUBLISHING_LAG_MS". I'll assume endOfDay is the start of the next day (midnight), so `endOfDay('2025-01-15') = '2025-01-16T00:00:00.000Z'`.

For the test where the statement IS complete:
- effective_date = '2025-01-15'
- endOfDay = '2025-01-16T00:00:00.000Z'
- publishingLagMs = 30 * 60 * 1000 (30 minutes)
- complete after = '2025-01-16T00:30:00.000Z'
- So if I set the fake time to '2025-01-16T01:00:00.000Z', the statement is complete.

For the test where it's NOT complete:
- Set fake time to '2025-01-15T12:00:00.000Z' (well before the threshold)

OK, I think I have enough to write the complete test file. Let me do it now.

Actually, one more thought: for the `reconcile` method, how does it know which date to call `getStatement` with? It enumerates dates from startDate to endDate. If both are the same date (e.g., '2025-01-15'), it calls `getStatement(new Date('2025-01-15'))`.

In my mock, I'll have `getStatement` return a function that checks the date argument and returns appropriate settlements.

Let me also consider: the `ReconcileWindow` has `startDate` and `endDate` as `Date` objects. In the test, I'll create them like `new Date('2025-01-15T00:00:00.000Z')`.

Alright, let me write the final test file. I'll organize it with describe blocks for each major area.

Let me also double-check: the plan says `deriveTxid` is "exposed for tests only". So it's a public method on the service that tests can call directly. Good.

One more thing: for the "full lifecycle: 5 timeouts → parked_manual_review" test, I need to simulate 5 rounds of:
1. executePayments → timeout → in_doubt (attempt_count goes 0→1, 1→2, ..., 4→5)
2. reconcile → proven absent → pending

After 5 rounds, attempt_count = 5. On the 6th call to executePayments:
- findPending returns the order (it's back to pending)
- attempt_count (5) >= maxAttempts (5) → markParked

Wait, but after the 5th timeout, the order is in_doubt with attempt_count = 5. Then reconcile proves it absent and sets it back to pending. Now on the next executePayments, attempt_count is still 5, which is >= maxAttempts, so it parks.

Actually wait, let me re-read: "Cap attempts at 5; after that, park for manual review and never auto-revert."

So the flow is:
- Attempt 1: pending → send → timeout → in_doubt (attempt_count = 1)
- Reconcile: proven absent → pending
- Attempt 2: pending → send → timeout → in_doubt (attempt_count = 2)
- Reconcile: proven absent → pending
- ...
- Attempt 5: pending → send → timeout → in_doubt (attempt_count = 5)
- Reconcile: proven absent → pending
- Attempt 6: pending, but attempt_count = 5 >= maxAttempts → parked_manual_review

So I need 5 full cycles of (execute + reconcile) and then one more execute that parks it.

For the test, I'll loop 5 times doing execute + reconcile, then one more execute and assert parked.

OK let me write this now. I'll aim for clarity and completeness.

Wait, one more issue: in the full lifecycle test with timeouts, each `executePayments` call processes the order. But after the first timeout, the order is in_doubt. The next `executePayments` won't find it (findPending only returns 'pending' status). So I need to do the reconcile in between to set it back to pending.

So the loop is:
```
for (let i = 0; i < 5; i++) {
  await service.executePayments(); // timeout → in_doubt
  await service.reconcile(window); // proven absent → pending
}
await service.executePayments(); // attempt_count >= max → parked
```

This should work with the stateful mock.

Let me finalize and write the complete file now.
```

## reply

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PaymentService } from '../src/payment/payment.service';
import type { BankClient, BankSendResponse, Settlement } from '../src/payment/bank-client.interface';

// ─── Helpers ────────────────────────────────────────────────────────────────────

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    supplier_key: 'key-1',
    amount_minor_units: 10_000,
    effective_date: new Date('2025-01-15T00:00:00.000Z'),
    txid: 'txid-1',
    status: 'pending' as string,
    attempt_count: 0,
    last_attempt_at: null as Date | null,
    settled_at: null as Date | null,
    ...overrides,
  };
}

function makeMockBank() {
  return {
    send: vi.fn<Promise<BankSendResponse>>(),
    getStatement: vi.fn<Promise<Settlement[]>>(),
  };
}

function makeMockRepo() {
  return {
    findPending: vi.fn(),
    findByTxid: vi.fn(),
    findInDoubtByEffectiveDate: vi.fn(),
    markSent: vi.fn(),
    markInDoubt: vi.fn(),
    markRejected: vi.fn(),
    markSettled: vi.fn(),
    markPendingForResend: vi.fn(),
    markParked: vi.fn(),
    incrementAttempt: vi.fn(),
    upsertSettlement: vi.fn(),
  };
}

const DEFAULT_OPTS = {
  publishingLagMs: 30 * 60 * 1000,
  batchSize: 100,
  maxAttempts: 5,
};

// Stateful repository mock that mutates the order in place.
function makeStatefulRepo(order: Record<string, any>) {
  return {
    findPending: vi.fn(async (_limit: number) =>
      order.status === 'pending' ? [{ ...order }] : [],
    ),
    findByTxid: vi.fn(async (txid: string) =>
      order.txid === txid ? { ...order } : null,
    ),
    findInDoubtByEffectiveDate: vi.fn(async (date: Date) => {
      const d = new Date(date);
      const od = new Date(order.effective_date);
      if (
        order.status === 'in_doubt' &&
        d.getUTCFullYear() === od.getUTCFullYear() &&
        d.getUTCMonth() === od.getUTCMonth() &&
        d.getUTCDate() === od.getUTCDate()
      ) {
        return [{ ...order }];
      }
      return [];
    }),
    markSent: vi.fn(async (id: string, lastAttemptAt: Date) => {
      if (id === order.id) {
        order.status = 'sent';
        order.last_attempt_at = lastAttemptAt;
      }
    }),
    markInDoubt: vi.fn(async (id: string, lastAttemptAt: Date) => {
      if (id === order.id) {
        order.status = 'in_doubt';
        order.last_attempt_at = lastAttemptAt;
      }
    }),
    markRejected: vi.fn(async (id: string) => {
      if (id === order.id) {
        order.status = 'rejected';
      }
    }),
    markSettled: vi.fn(async (id: string, settledAt: Date) => {
      if (id === order.id && (order.status === 'sent' || order.status === 'in_doubt')) {
        order.status = 'settled';
        order.settled_at = settledAt;
      }
    }),
    markPendingForResend: vi.fn(async (id: string) => {
      if (id === order.id && order.status === 'in_doubt') {
        order.status = 'pending';
      }
    }),
    markParked: vi.fn(async (id: string) => {
      if (id === order.id && order.status === 'pending') {
        order.status = 'parked_manual_review';
      }
    }),
    incrementAttempt: vi.fn(async (id: string, lastAttemptAt: Date) => {
      if (id === order.id && order.status === 'pending') {
        order.attempt_count += 1;
        order.last_attempt_at = lastAttemptAt;
        return order.attempt_count;
      }
      return 0;
    }),
    upsertSettlement: vi.fn(async () => {}),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe('PaymentService', () => {
  let repo: ReturnType<typeof makeMockRepo>;
  let bank: ReturnType<typeof makeMockBank>;
  let service: PaymentService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-16T01:00:00.000Z'));
    repo = makeMockRepo();
    bank = makeMockBank();
    service = new PaymentService(repo as any, bank as any, DEFAULT_OPTS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── executePayments: response classification ──────────────────────────────

  describe('executePayments — response classification', () => {
    it('accepted response transitions pending → sent', async () => {
      const order = makeOrder();
      repo.findPending.mockResolvedValue([order]);
      repo.incrementAttempt.mockResolvedValue(1);
      bank.send.mockResolvedValue({ status: 'accepted' });

      await service.executePayments();

      expect(repo.markSent).toHaveBeenCalledWith(order.id, expect.any(Date));
      expect(repo.markInDoubt).not.toHaveBeenCalled();
      expect(repo.markRejected).not.toHaveBeenCalled();
      expect(bank.send).toHaveBeenCalledWith(
        expect.objectContaining({ txid: order.txid, amount_minor_units: order.amount_minor_units }),
      );
    });

    it('duplicate response transitions pending → sent', async () => {
      const order = makeOrder();
      repo.findPending.mockResolvedValue([order]);
      repo.incrementAttempt.mockResolvedValue(1);
      bank.send.mockResolvedValue({ status: 'duplicate' });

      await service.executePayments();

      expect(repo.markSent).toHaveBeenCalledWith(order.id, expect.any(Date));
      expect(repo.markInDoubt).not.toHaveBeenCalled();
    });

    it('transient error response transitions pending → in_doubt', async () => {
      const order = makeOrder();
      repo.findPending.mockResolvedValue([order]);
      repo.incrementAttempt.mockResolvedValue(1);
      bank.send.mockResolvedValue({ status: 'transient_error' });

      await service.executePayments();

      expect(repo.markInDoubt).toHaveBeenCalledWith(order.id, expect.any(Date));
      expect(repo.markSent).not.toHaveBeenCalled();
      expect(repo.markRejected).not.toHaveBeenCalled();
    });

    it('timeout (rejected promise) transitions pending → in_doubt', async () => {
      const order = makeOrder();
      repo.findPending.mockResolvedValue([order]);
      repo.incrementAttempt.mockResolvedValue(1);
      bank.send.mockRejectedValue(new Error('Request timed out'));

      await service.executePayments();

      expect(repo.markInDoubt).toHaveBeenCalledWith(order.id, expect.any(Date));
      expect(repo.markSent).not.toHaveBeenCalled();
    });

    it('permanent rejection transitions pending → rejected', async () => {
      const order = makeOrder();
      repo.findPending.mockResolvedValue([order]);
      repo.incrementAttempt.mockResolvedValue(1);
      bank.send.mockResolvedValue({ status: 'permanent_rejection' });

      await service.executePayments();

      expect(repo.markRejected).toHaveBeenCalledWith(order.id);
      expect(repo.markSent).not.toHaveBeenCalled();
      expect(repo.markInDoubt).not.toHaveBeenCalled();
    });

    it('attempt_count >= max parks the order without calling bank', async () => {
      const order = makeOrder({ attempt_count: 5 });
      repo.findPending.mockResolvedValue([order]);

      await service.executePayments();

      expect(repo.markParked).toHaveBeenCalledWith(order.id);
      expect(bank.send).not.toHaveBeenCalled();
      expect(repo.incrementAttempt).not.toHaveBeenCalled();
    });

    it('concurrent increment (returns 0) skips the order', async () => {
      const order = makeOrder();
      repo.findPending.mockResolvedValue([order]);
      repo.incrementAttempt.mockResolvedValue(0);

      await service.executePayments();

      expect(bank.send).not.toHaveBeenCalled();
      expect(repo.markSent).not.toHaveBeenCalled();
      expect(repo.markInDoubt).not.toHaveBeenCalled();
      expect(repo.markRejected).not.toHaveBeenCalled();
    });
  });

  // ── reconcile: settlement matching ────────────────────────────────────────

  describe('reconcile — settlement matching', () => {
    it('found-in-statement transitions sent → settled', async () => {
      const order = makeOrder({ status: 'sent' });
      const settlement: Settlement = {
        txid: order.txid,
        amount_minor_units: order.amount_minor_units,
        settled_at: new Date('2025-01-15T18:00:00.000Z'),
      };

      bank.getStatement.mockResolvedValue([settlement]);
      repo.findByTxid.mockResolvedValue(order);
      repo.findInDoubtByEffectiveDate.mockResolvedValue([]);

      const result = await service.reconcile({
        startDate: new Date('2025-01-15T00:00:00.000Z'),
        endDate: new Date('2025-01-15T00:00:00.000Z'),
      });

      expect(repo.markSettled).toHaveBeenCalledWith(order.id, settlement.settled_at);
      expect(result.settled).toBe(1);
    });

    it('found-in-statement transitions in_doubt → settled (timeout-but-settled, no resend)', async () => {
      const order = makeOrder({ status: 'in_doubt' });
      const settlement: Settlement = {
        txid: order.txid,
        amount_minor_units: order.amount_minor_units,
        settled_at: new Date('2025-01-15T20:00:00.000Z'),
      };

      bank.getStatement.mockResolvedValue([settlement]);
      repo.findByTxid.mockResolvedValue(order);
      // Even though the order is in_doubt, it was found in the statement,
      // so it must be settled, NOT marked pending for resend.
      repo.findInDoubtByEffectiveDate.mockResolvedValue([order]);

      const result = await service.reconcile({
        startDate: new Date('2025-01-15T00:00:00.000Z'),
        endDate: new Date('2025-01-15T00:00:00.000Z'),
      });

      expect(repo.markSettled).toHaveBeenCalledWith(order.id, settlement.settled_at);
      expect(repo.markPendingForResend).not.toHaveBeenCalled();
      expect(result.settled).toBe(1);
    });

    it('rejected orders are untouched by reconciliation', async () => {
      const order = makeOrder({ status: 'rejected' });
      const settlement: Settlement = {
        txid: order.txid,
        amount_minor_units: order.amount_minor_units,
        settled_at: new Date('2025-01-15T18:00:00.000Z'),
      };

      bank.getStatement.mockResolvedValue([settlement]);
      repo.findByTxid.mockResolvedValue(order);
      repo.findInDoubtByEffectiveDate.mockResolvedValue([]);

      await service.reconcile({
        startDate: new Date('2025-01-15T00:00:00.000Z'),
        endDate: new Date('2025-01-15T00:00:00.000Z'),
      });

      expect(repo.markSettled).not.toHaveBeenCalled();
      expect(repo.markPendingForResend).not.toHaveBeenCalled();
    });
  });

  // ── reconcile: proven-absent logic ────────────────────────────────────────

  describe('reconcile — proven-absent logic', () => {
    it('proven-absent transitions in_doubt → pending (same txid preserved)', async () => {
      // Statement is complete: now (2025-01-16T01:00) > endOfDay(2025-01-15) + 30 min
      // endOfDay = 2025-01-16T00:00, +30 min = 2025-01-16T00:30, now=01:00 ✓
      const order = makeOrder({ status: 'in_doubt' });

      // Statement does NOT contain the order's txid
      bank.getStatement.mockResolvedValue([]);
      repo.findInDoubtByEffectiveDate.mockResolvedValue([order]);

      const result = await service.reconcile({
        startDate: new Date('2025-01-15T00:00:00.000Z'),
        endDate: new Date('2025-01-15T00:00:00.000Z'),
      });

      expect(repo.markPendingForResend).toHaveBeenCalledWith(order.id);
      expect(result.provenAbsent).toBe(1);
      // The order's txid is unchanged (still txid-1 in the order object)
      expect(order.txid).toBe('txid-1');
    });

    it('statement not yet complete leaves in_doubt unchanged', async () => {
      // Set time BEFORE the publishing lag expires.
      // endOfDay(2025-01-15) = 2025-01-16T00:00, +30 min = 2025-01-16T00:30
      // Set now to 2025-01-15T12:00 — well before the threshold.
      vi.setSystemTime(new Date('2025-01-15T12:00:00.000Z'));

      const order = makeOrder({ status: 'in_doubt' });

      bank.getStatement.mockResolvedValue([]);
      repo.findInDoubtByEffectiveDate.mockResolvedValue([order]);

      const result = await service.reconcile({
        startDate: new Date('2025-01-15T00:00:00.000Z'),
        endDate: new Date('2025-01-15T00:00:00.000Z'),
      });

      expect(repo.markPendingForResend).not.toHaveBeenCalled();
      expect(result.provenAbsent).toBe(0);
    });

    it('overlapping windows are idempotent', async () => {
      const order = makeOrder({ status: 'in_doubt' });
      const settlement: Settlement = {
        txid: order.txid,
        amount_minor_units: order.amount_minor_units,
        settled_at: new Date('2025-01-15T18:00:00.000Z'),
      };

      bank.getStatement.mockResolvedValue([settlement]);
      repo.findByTxid.mockImplementation(async (txid: string) => {
        // First call: order is in_doubt, second call (after settle): settled
        return { ...order };
      });
      repo.findInDoubtByEffectiveDate.mockResolvedValue([]);

      const window = {
        startDate: new Date('2025-01-15T00:00:00.000Z'),
        endDate: new Date('2025-01-15T00:00:00.000Z'),
      };

      const first = await service.reconcile(window);
      expect(first.settled).toBe(1);

      // Reset mocks to simulate a second run where the order is already settled
      repo.findByTxid.mockResolvedValue({ ...order, status: 'settled' });

      const second = await service.reconcile(window);
      expect(second.settled).toBe(0);
      expect(repo.markSettled).toHaveBeenCalledTimes(1); // only from the first run
    });
  });

  // ── deriveTxid ────────────────────────────────────────────────────────────

  describe('deriveTxid', () => {
    it('is deterministic for the same input', () => {
      const date = new Date('2025-01-15T00:00:00.000Z');
      const a = service.deriveTxid('order-abc', date);
      const b = service.deriveTxid('order-abc', date);
      expect(a).toBe(b);
      expect(typeof a).toBe('string');
      expect(a.length).toBeGreaterThan(0);
    });

    it('yields different txids for different orders or dates', () => {
      const date = new Date('2025-01-15T00:00:00.000Z');
      const otherDate = new Date('2025-01-16T00:00:00.000Z');

      const a = service.deriveTxid('order-1', date);
      const b = service.deriveTxid('order-2', date);
      const c = service.deriveTxid('order-1', otherDate);

      expect(a).not.toBe(b);
      expect(a).not.toBe(c);
    });
  });

  // ── Full lifecycle ────────────────────────────────────────────────────────

  describe('full lifecycle', () => {
    it('timeout → reconcile proves absent → resend accepted → settle', async () => {
      const order = makeOrder();
      const statefulRepo = makeStatefulRepo(order);
      statefulBank: {
        // Re-create service with stateful repo
        const bank2 = makeMockBank();
        const service2 = new PaymentService(statefulRepo as any, bank2 as any, DEFAULT_OPTS);

        // Phase 1: execute → timeout → in_doubt
        bank2.send.mockRejectedValueOnce(new Error('timeout'));
        await service2.executePayments();
        expect(order.status).toBe('in_doubt');

        // Phase 2: reconcile → proven absent → pending
        // now = 2025-01-16T01:00, statement for 2025-01-15 is complete
        bank2.getStatement.mockResolvedValueOnce([]);
        await service2.reconcile({
          startDate: new Date('2025-01-15T00:00:00.000Z'),
          endDate: new Date('2025-01-15T00:00:00.000Z'),
        });
        expect(order.status).toBe('pending');

        // Phase 3: execute again → accepted → sent
        bank2.send.mockResolvedValueOnce({ status: 'accepted' });
        await service2.executePayments();
        expect(order.status).toBe('sent');

        // Phase 4: reconcile → found in statement → settled
        bank2.getStatement.mockResolvedValueOnce([
          {
            txid: order.txid,
            amount_minor_units: order.amount_minor_units,
            settled_at: new Date('2025-01-15T22:00:00.000Z'),
          },
        ]);
        await service2.reconcile({
          startDate: new Date('2025-01-15T00:00:00.000Z'),
          endDate: new Date('2025-01-15T00:00:00.000Z'),
        });
        expect(order.status).toBe('settled');
        expect(order.settled_at).toEqual(new Date('2025-01-15T22:00:00.000Z'));
      }
    });

    it('5 timeouts → parked_manual_review (never auto-reverts)', async () => {
      const order = makeOrder();
      const statefulRepo = makeStatefulRepo(order);
      const bank2 = makeMockBank();
      const service2 = new PaymentService(statefulRepo as any, bank2 as any, DEFAULT_OPTS);

      // 5 rounds: execute (timeout) + reconcile (proven absent)
      for (let i = 0; i < 5; i++) {
        bank2.send.mockRejectedValueOnce(new Error('timeout'));
        await service2.executePayments();
        expect(order.status).toBe('in_doubt');

        bank2.getStatement.mockResolvedValueOnce([]);
        await service2.reconcile({
          startDate: new Date('2025-01-15T00:00:00.000Z'),
          endDate: new Date('2025-01-15T00:00:00.000Z'),
        });
        expect(order.status).toBe('pending');
      }

      // After 5 attempts, attempt_count === 5 === maxAttempts
      expect(order.attempt_count).toBe(5);

      // 6th execute: should park, not send
      await service2.executePayments();
      expect(order.status).toBe('parked_manual_review');
      // bank.send was called exactly 5 times (once per attempt), not on the 6th
      expect(bank2.send).toHaveBeenCalledTimes(5);

      // A subsequent reconcile must not revert the parked order
      bank2.getStatement.mockResolvedValueOnce([]);
      await service2.reconcile({
        startDate: new Date('2025-01-15T00:00:00.000Z'),
        endDate: new Date('2025-01-15T00:00:00.000Z'),
      });
      expect(order.status).toBe('parked_manual_review');
    });
  });
});
```
