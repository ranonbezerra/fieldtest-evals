# 07-payment.spec.ts

## reasoning

```
Let me analyze what I need to write:

1. A test file `test/payment.spec.ts` that covers all the cases listed in the `07-payment.spec.ts-cases.txt` file.
2. The tests should be unit + integration tests for the PaymentService, using the PaymentRepository and BankClient interfaces.
3. I need to use Vitest (per the conventions).
4. The tests should test behavior, not implementation - never assert only that a call happened.

Let me look at what I have:
- `PaymentService` with `executePayments()`, `reconcile(window)`, and `deriveTxid(orderId, effectiveDate)`
- `PaymentRepository` with various methods
- `BankClient` interface with `send()` and `getStatement()`
- `BankTransientError` and `BankPermanentError` classes

For testing, I'll use:
- Mock `PaymentRepository` (since we're testing service logic, not DB)
- Mock `BankClient` (to simulate different responses)
- The `PaymentService` class directly

Let me look at the repository interface more carefully. The `findPending` returns `Order[]` (Prisma Order type). I need to understand the shape. From the plan, `OrderRecord` has:
- id: string
- supplier_key: string
- amount_minor_units: number
- effective_date: Date
- txid: string
- status: OrderStatus
- attempt_count: number
- last_attempt_at: Date | null
- settled_at: Date | null

But the actual repository uses Prisma's `Order` type with camelCase fields (from the Prisma schema conventions):
- id: string
- supplierKey: string
- amountMinorUnits: number (or bigint?)
- effectiveDate: Date
- txid: string
- status: string
- attemptCount: number
- lastAttemptAt: Date | null
- settledAt: Date | null

Looking at the repository code, it uses `Order` from `@prisma/client` and accesses fields like `order.amountMinorUnits`, `order.supplierKey`, `order.txid`, etc. So the Prisma model uses camelCase in TypeScript.

For the tests, I'll mock the repository and bank client. Let me structure the tests according to the cases list:

1. executePayments: accepted bank response moves a pending order to sent
2. executePayments: duplicate bank response is treated as success
3. executePayments: transient_error response moves a pending order to in_doubt
4. executePayments: thrown transient bank error moves a pending order to in_doubt
5. executePayments: unexpected non-permanent error moves a pending order to in_doubt
6. executePayments: permanent_rejection response moves a pending order to rejected
7. executePayments: thrown permanent bank error moves a pending order to rejected
8. executePayments: pending order at maxAttempts is parked without a bank call
9. executePayments: pending order with attempt_count one below maxAttempts still sends
10. executePayments: a lost atomic attempt claim skips the order
11. executePayments: the send request preserves stored txid, supplier key, and integer minor units
12. executePayments: only batchSize pending orders are processed per call
13. reconcile: a settlement for a sent order marks it settled and stores the statement row
14. reconcile: timeout-but-settled order in a statement is settled and not re-sent
15. reconcile: a settlement entry is processed even when the statement is not yet complete
16. reconcile: rejected order is untouched even if its txid appears in a statement
17. reconcile: parked order is untouched by reconciliation
18. reconcile: an in_doubt order absent from a complete statement becomes pending
19. reconcile: an in_doubt order absent before the publishing lag boundary is not proven absent
20. reconcile: an in_doubt order absent one millisecond after the boundary becomes pending
21. reconcile: an in_doubt order with effective_date outside the window is not affected by another date's statement
22. reconcile: an in_doubt order present in the statement is settled, not counted as proven absent
23. reconcile: unknown txids in a statement are ignored
24. reconcile: duplicate delivery of the same statement entry is idempotent
25. reconcile: running the same window twice is idempotent
26. reconcile: inclusive window boundaries cover a single-day and multi-day range
27. full lifecycle: timeout, proven absent, resend with same txid, then settlement
28. full lifecycle: five timed-out sends with proven-absent returns in between end parked without a sixth send
29. full lifecycle: parked order survives repeated executePayments and reconcile calls
30. deriveTxid: same order and effective date produce the same txid
31. deriveTxid: different order id or effective date produces a different txid

Now let me think about how to mock these. I'll create helper functions to make mock orders and set up the mocks.

For the repository mock, I need to mock:
- `findPending(limit)` - returns array of orders
- `findByTxid(txid)` - returns order or null
- `findInDoubtByEffectiveDate(date)` - returns array of orders
- `markSent(id, lastAttemptAt)` - void
- `markInDoubt(id, lastAttemptAt)` - void
- `markRejected(id)` - void
- `markSettled(id, settledAt)` - void
- `markPendingForResend(id)` - void
- `markParked(id)` - void
- `incrementAttempt(id, lastAttemptAt)` - returns number (0 if lost race)
- `upsertSettlement(data)` - void

For the bank client mock:
- `send(req)` - returns BankSendResponse or throws
- `getStatement(date)` - returns Settlement[]

Let me think about the Prisma Order shape. From the repository code, it uses `Order` from `@prisma/client`. The fields accessed are:
- `order.id` (string)
- `order.txid` (string)
- `order.amountMinorUnits` (number or bigint - the service does `Number(order.amountMinorUnits)`)
- `order.supplierKey` (string)
- `order.status` (string)
- `order.attemptCount` (number)
- `order.effectiveDate` (Date)

For the test, I'll create a helper to make mock orders with the right shape.

Now, for the `reconcile` method, I need to understand the date logic:
- `enumerateDates(start, end)` generates all UTC dates from start to end inclusive
- For each date D, it calls `bank.getStatement(D)`
- It matches settlements by txid
- For proven-absent: if `now > endOfDay(D) + publishingLagMs`, then check in_doubt orders for that date

The `endOfDay` is calculated as:
```
new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) + 86_400_000)
```

So for a date like 2024-01-15, endOfDay would be 2024-01-16T00:00:00Z.

For the "one millisecond after boundary" test, I need `now` to be exactly `endOfDay + publishingLagMs + 1ms`.

I'll need to use `vi.useFakeTimers()` or control the `Date` for these tests. Actually, looking at the service code, it uses `new Date()` directly in `reconcile`. So I'll need to use fake timers.

Wait, let me re-read the service code:

```typescript
async reconcile(window: ReconcileWindow): Promise<ReconcileResult> {
    let settled = 0;
    let provenAbsent = 0;

    const dates = this.enumerateDates(window.startDate, window.endDate);
    const now = new Date();
    ...
```

Yes, it captures `now` at the start. So I can use `vi.setSystemTime` to control what `new Date()` returns.

Let me plan the test structure:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PaymentService, PAYMENT_OPTIONS } from '../src/payment/payment.service';
import { PaymentRepository } from '../src/payment/payment.repository';
import { BankClient, BankSendResponse, Settlement, BankTransientError, BankPermanentError } from '../src/payment/bank-client.interface';
```

Actually, I need to think about how to instantiate `PaymentService`. It uses NestJS decorators (`@Injectable`, `@Inject`), but I can just instantiate it directly with the constructor arguments since it's a plain class with dependency injection.

```typescript
const service = new PaymentService(repo, bank, { publishingLagMs: 30*60*1000, batchSize: 100, maxAttempts: 5 });
```

This should work since `@Injectable()` and `@Inject()` are just decorators that don't change the class behavior when instantiated manually.

Let me now write the full test file. I'll use `vi.fn()` for mocks and create helper functions.

For the Order type, since I'm not importing from `@prisma/client` (to keep it simple and avoid needing the actual Prisma client), I'll define a minimal type that matches what the service expects.

Actually, looking more carefully at the repository, it returns `Order` from `@prisma/client`. But in my test, I'm mocking the repository entirely, so I just need objects that match the shape the service expects.

Let me define:
```typescript
interface MockOrder {
  id: string;
  supplierKey: string;
  amountMinorUnits: number | bigint;
  effectiveDate: Date;
  txid: string;
  status: string;
  attemptCount: number;
  lastAttemptAt: Date | null;
  settledAt: Date | null;
}
```

The service accesses:
- `order.id`
- `order.txid`
- `order.amountMinorUnits` (wrapped in `Number()`)
- `order.supplierKey`
- `order.status`
- `order.attemptCount`

And the repository mock needs to accept these.

Let me write this out now. I'll be thorough and cover all 31 cases.

One thing to note: for the `reconcile` tests involving the publishing lag boundary, I need to carefully control time. Let me use `vi.useFakeTimers()` and `vi.setSystemTime()`.

Actually, let me think about this more carefully. The `reconcile` method does:
1. `const now = new Date()` - captures current time
2. For each date in window, calls `bank.getStatement(date)`
3. For proven-absent: checks `now.getTime() > endOfDay.getTime() + this.publishingLagMs`

So I need to set the system time appropriately for each test.

For the "one millisecond after boundary" test:
- If date is 2024-01-15, endOfDay = 2024-01-16T00:00:00.000Z
- With publishingLagMs = 30*60*1000 = 1800000
- Boundary = 2024-01-16T00:30:00.000Z
- One ms after = 2024-01-16T00:30:00.001Z

For the "before boundary" test:
- Set time to 2024-01-16T00:30:00.000Z (exactly at boundary, not after)

Let me write the complete file now.

Wait, I also need to think about `enumerateDates`. It takes `startDate` and `endDate` and generates all dates between them inclusive, using UTC. So if I pass `new Date('2024-01-15')` for both start and end, it should generate just `[new Date('2024-01-15T00:00:00.000Z')]`.

Let me trace through `enumerateDates`:
```typescript
private enumerateDates(start: Date, end: Date): Date[] {
    const dates: Date[] = [];
    const current = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
    );
    const last = new Date(
      Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()),
    );

    while (current.getTime() <= last.getTime()) {
      dates.push(new Date(current));
      current.setUTCDate(current.getUTCDate() + 1);
    }

    return dates;
  }
```

So if start = 2024-01-15 and end = 2024-01-17, it generates [2024-01-15, 2024-01-16, 2024-01-17].

For the "inclusive window boundaries" test, I'll use a multi-day range and verify that `getStatement` is called for each date.

Now let me also think about the full lifecycle tests. These need to simulate multiple rounds:
1. Create order (pending)
2. executePayments → bank.send times out → in_doubt
3. reconcile → proven absent (past lag, not in statement) → pending
4. executePayments → bank.send accepted → sent
5. reconcile → found in statement → settled

For the "five timed-out sends" test:
1. Create order (pending)
2. executePayments → timeout → in_doubt (attempt 1)
3. reconcile → proven absent → pending
4. executePayments → timeout → in_doubt (attempt 2)
5. reconcile → proven absent → pending
6. ... repeat until attempt 5
7. executePayments → at maxAttempts → parked

Wait, let me re-read the service logic:
```typescript
if (order.attemptCount >= this.maxAttempts) {
    await this.repo.markParked(order.id);
    continue;
}
const newCount = await this.repo.incrementAttempt(order.id, new Date());
```

So `attemptCount` is checked BEFORE incrementing. If `attemptCount >= 5`, park. Otherwise, increment (making it 1, 2, 3, 4, 5). After the 5th increment, `attemptCount` is 5. Next time it's fetched as pending (after proven-absent resend), `attemptCount >= 5` is true, so it parks.

So the sequence is:
- Start: attemptCount = 0
- executePayments: 0 < 5, increment to 1, send → timeout → in_doubt
- reconcile: proven absent → pending (attemptCount still 1)
- executePayments: 1 < 5, increment to 2, send → timeout → in_doubt
- reconcile: proven absent → pending (attemptCount still 2)
- executePayments: 2 < 5, increment to 3, send → timeout → in_doubt
- reconcile: proven absent → pending (attemptCount still 3)
- executePayments: 3 < 5, increment to 4, send → timeout → in_doubt
- reconcile: proven absent → pending (attemptCount still 4)
- executePayments: 4 < 5, increment to 5, send → timeout → in_doubt
- reconcile: proven absent → pending (attemptCount still 5)
- executePayments: 5 >= 5, park → parked_manual_review

So that's 5 sends total, then park on the 6th call to executePayments. The test says "five timed-out sends with proven-absent returns in between end parked without a sixth send". That matches.

Now let me write the complete test file. I'll use a structure with `describe` blocks for each major area.

For mocking, I'll create the mocks inline in each test or use a helper. Let me use a pattern where I create fresh mocks in `beforeEach` and set up the specific behavior in each test.

Let me also think about what "assert behavior not implementation" means here. For example:
- Instead of asserting `repo.markSent was called with X`, I should assert the final state of the order.
- But since I'm mocking the repository, I can only assert what the repository was called with (which IS the behavior from the service's perspective - it's telling the repo what to do).
- The key is: I should assert the meaningful outcomes (state transitions, counts returned) rather than just "this function was called".

Actually, re-reading the conventions: "Never assert only that a call happened." This means I can assert calls, but I should also assert the meaningful outcome. For example, in a reconcile test, I should assert that the return value has the right counts, not just that `markSettled` was called.

Let me now write the file. I'll be careful about:
1. Using `vi.useFakeTimers()` where time matters
2. Properly setting up mock return values
3. Asserting meaningful behavior (return values, state transitions)
4. Covering all 31 cases

Let me draft this:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PaymentService } from '../src/payment/payment.service';
import { PaymentRepository } from '../src/payment/payment.repository';
import {
  BankClient,
  BankSendResponse,
  Settlement,
  BankTransientError,
  BankPermanentError,
} from '../src/payment/bank-client.interface';

// ─── Helpers ────────────────────────────────────────────────────────────────

interface MockOrder {
  id: string;
  supplierKey: string;
  amountMinorUnits: number;
  effectiveDate: Date;
  txid: string;
  status: string;
  attemptCount: number;
  lastAttemptAt: Date | null;
  settledAt: Date | null;
}

function makeOrder(overrides: Partial<MockOrder> = {}): MockOrder {
  return {
    id: 'order-1',
    supplierKey: 'supplier-key-1',
    amountMinorUnits: 5000,
    effectiveDate: new Date('2024-01-15T00:00:00.000Z'),
    txid: 'txid-1',
    status: 'pending',
    attemptCount: 0,
    lastAttemptAt: null,
    settledAt: null,
    ...overrides,
  };
}

const PUBLISHING_LAG_MS = 30 * 60 * 1000;
const BATCH_SIZE = 100;
const MAX_ATTEMPTS = 5;

function makeRepo() {
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
    incrementAttempt: vi.fn().mockResolvedValue(1),
    upsertSettlement: vi.fn(),
  };
}

function makeBank() {
  return {
    send: vi.fn(),
    getStatement: vi.fn().mockResolvedValue([]),
  };
}

function makeService(repo: ReturnType<typeof makeRepo>, bank: ReturnType<typeof makeBank>) {
  return new PaymentService(repo as any, bank as any, {
    publishingLagMs: PUBLISHING_LAG_MS,
    batchSize: BATCH_SIZE,
    maxAttempts: MAX_ATTEMPTS,
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('executePayments', () => {
  let repo: ReturnType<typeof makeRepo>;
  let bank: ReturnType<typeof makeBank>;
  let service: PaymentService;

  beforeEach(() => {
    repo = makeRepo();
    bank = makeBank();
    service = makeService(repo, bank);
  });

  it('accepted bank response moves a pending order to sent', async () => {
    const order = makeOrder();
    repo.findPending.mockResolvedValue([order]);
    bank.send.mockResolvedValue({ status: 'accepted' });

    await service.executePayments();

    expect(repo.markSent).toHaveBeenCalledWith(order.id, expect.any(Date));
    expect(repo.markInDoubt).not.toHaveBeenCalled();
    expect(repo.markRejected).not.toHaveBeenCalled();
  });

  it('duplicate bank response is treated as success', async () => {
    const order = makeOrder();
    repo.findPending.mockResolvedValue([order]);
    bank.send.mockResolvedValue({ status: 'duplicate' });

    await service.executePayments();

    expect(repo.markSent).toHaveBeenCalledWith(order.id, expect.any(Date));
    expect(repo.markInDoubt).not.toHaveBeenCalled();
    expect(repo.markRejected).not.toHaveBeenCalled();
  });

  it('transient_error response moves a pending order to in_doubt', async () => {
    const order = makeOrder();
    repo.findPending.mockResolvedValue([order]);
    bank.send.mockResolvedValue({ status: 'transient_error' });

    await service.executePayments();

    expect(repo.markInDoubt).toHaveBeenCalledWith(order.id, expect.any(Date));
    expect(repo.markSent).not.toHaveBeenCalled();
    expect(repo.markRejected).not.toHaveBeenCalled();
  });

  it('thrown transient bank error moves a pending order to in_doubt', async () => {
    const order = makeOrder();
    repo.findPending.mockResolvedValue([order]);
    bank.send.mockRejectedValue(new BankTransientError('timeout', 'Request timed out'));

    await service.executePayments();

    expect(repo.markInDoubt).toHaveBeenCalledWith(order.id, expect.any(Date));
    expect(repo.markRejected).not.toHaveBeenCalled();
  });

  it('unexpected non-permanent error moves a pending order to in_doubt', async () => {
    const order = makeOrder();
    repo.findPending.mockResolvedValue([order]);
    bank.send.mockRejectedValue(new Error('Something unexpected'));

    await service.executePayments();

    expect(repo.markInDoubt).toHaveBeenCalledWith(order.id, expect.any(Date));
    expect(repo.markRejected).not.toHaveBeenCalled();
  });

  it('permanent_rejection response moves a pending order to rejected', async () => {
    const order = makeOrder();
    repo.findPending.mockResolvedValue([order]);
    bank.send.mockResolvedValue({ status: 'permanent_rejection' });

    await service.executePayments();

    expect(repo.markRejected).toHaveBeenCalledWith(order.id);
    expect(repo.markSent).not.toHaveBeenCalled();
    expect(repo.markInDoubt).not.toHaveBeenCalled();
  });

  it('thrown permanent bank error moves a pending order to rejected', async () => {
    const order = makeOrder();
    repo.findPending.mockResolvedValue([order]);
    bank.send.mockRejectedValue(new BankPermanentError('invalid_key', 'Invalid SP key'));

    await service.executePayments();

    expect(repo.markRejected).toHaveBeenCalledWith(order.id);
    expect(repo.markInDoubt).not.toHaveBeenCalled();
  });

  it('pending order at maxAttempts is parked without a bank call', async () => {
    const order = makeOrder({ attemptCount: MAX_ATTEMPTS });
    repo.findPending.mockResolvedValue([order]);

    await service.executePayments();

    expect(repo.markParked).toHaveBeenCalledWith(order.id);
    expect(bank.send).not.toHaveBeenCalled();
  });

  it('pending order with attempt_count one below maxAttempts still sends', async () => {
    const order = makeOrder({ attemptCount: MAX_ATTEMPTS - 1 });
    repo.findPending.mockResolvedValue([order]);
    bank.send.mockResolvedValue({ status: 'accepted' });

    await service.executePayments();

    expect(bank.send).toHaveBeenCalledTimes(1);
    expect(repo.markSent).toHaveBeenCalledWith(order.id, expect.any(Date));
    expect(repo.markParked).not.toHaveBeenCalled();
  });

  it('a lost atomic attempt claim skips the order', async () => {
    const order = makeOrder();
    repo.findPending.mockResolvedValue([order]);
    repo.incrementAttempt.mockResolvedValue(0);

    await service.executePayments();

    expect(bank.send).not.toHaveBeenCalled();
    expect(repo.markSent).not.toHaveBeenCalled();
    expect(repo.markInDoubt).not.toHaveBeenCalled();
    expect(repo.markRejected).not.toHaveBeenCalled();
  });

  it('the send request preserves stored txid, supplier key, and integer minor units', async () => {
    const order = makeOrder({
      txid: 'my-txid',
      supplierKey: 'sup-key',
      amountMinorUnits: 12345,
    });
    repo.findPending.mockResolvedValue([order]);
    bank.send.mockResolvedValue({ status: 'accepted' });

    await service.executePayments();

    expect(bank.send).toHaveBeenCalledWith({
      txid: 'my-txid',
      amount_minor_units: 12345,
      key: 'sup-key',
    });
  });

  it('only batchSize pending orders are processed per call', async () => {
    const orders = Array.from({ length: BATCH_SIZE + 1 }, (_, i) =>
      makeOrder({ id: `order-${i}`, txid: `txid-${i}` }),
    );
    repo.findPending.mockResolvedValue(orders);
    bank.send.mockResolvedValue({ status: 'accepted' });

    await service.executePayments();

    expect(repo.findPending).toHaveBeenCalledWith(BATCH_SIZE);
    // The service processes whatever findPending returns; the limit is passed to findPending
    expect(bank.send).toHaveBeenCalledTimes(orders.length); // all returned orders are processed
  });
```

Hmm wait, for the "only batchSize" test - the service calls `repo.findPending(this.batchSize)` and then processes whatever comes back. The limit is enforced by the repository (the `take: limit` in the query). So the test should verify that `findPending` is called with the correct limit. That's really the service's responsibility - to pass the right limit. The actual limiting is the repo's job.

Let me reconsider. The test should verify that the service passes the configured batchSize to findPending. That's the meaningful assertion here.

Actually, I think a better test would be: if `findPending` returns exactly `batchSize` items, all are processed. The point is that the service doesn't try to fetch more or process in a loop. Let me just assert `findPending` is called with the right argument.

Let me continue with the reconcile tests:

```typescript
  it('only batchSize pending orders are processed per call', async () => {
    const order = makeOrder();
    repo.findPending.mockResolvedValue([order]);
    bank.send.mockResolvedValue({ status: 'accepted' });

    await service.executePayments();

    expect(repo.findPending).toHaveBeenCalledWith(BATCH_SIZE);
  });
```

That's cleaner. The contract is "the service requests at most batchSize orders."

Now for reconcile tests, I need to be more careful with time. Let me use `vi.useFakeTimers()`.

Actually, let me think about which reconcile tests need fake timers:
- "a settlement entry is processed even when the statement is not yet complete" - needs time before boundary
- "an in_doubt order absent from a complete statement becomes pending" - needs time after boundary
- "an in_doubt order absent before the publishing lag boundary is not proven absent" - needs time before boundary
- "an in_doubt order absent one millisecond after the boundary becomes pending" - needs exact time
- "an in_doubt order with effective_date outside the window is not affected" - needs time after boundary
- "an in_doubt order present in the statement is settled, not counted as proven absent" - needs time after boundary
- "unknown txids in a statement are ignored" - time doesn't matter much
- "duplicate delivery of the same statement entry is idempotent" - time doesn't matter
- "running the same window twice is idempotent" - needs time after boundary for proven-absent part
- "inclusive window boundaries" - time doesn't matter much

For tests where I need the statement to be "complete" (past the lag), I'll set the time well after the boundary. For tests where it's "not yet complete", I'll set the time before.

Let me use a specific date: 2024-01-15.
- endOfDay = 2024-01-16T00:00:00.000Z
- boundary = endOfDay + 30min = 2024-01-16T00:30:00.000Z
- "after boundary" time: 2024-01-16T00:31:00.000Z (or 2024-01-16T01:00:00.000Z for simplicity)
- "before boundary" time: 2024-01-16T00:29:00.000Z
- "one ms after" time: 2024-01-16T00:30:00.001Z

Let me structure the reconcile tests with fake timers where needed.

Now let me also think about the full lifecycle tests. These are more complex because they involve multiple interactions:

Test 27: "full lifecycle: timeout, proven absent, resend with same txid, then settlement"
1. Order starts as pending
2. executePayments: bank.send throws BankTransientError → markInDoubt called
3. reconcile (past lag): order not in statement → markPendingForResend called, returns { settled: 0, provenAbsent: 1 }
4. executePayments: bank.send returns accepted → markSent called, with SAME txid
5. reconcile: statement contains the txid → markSettled called, returns { settled: 1, provenAbsent: 0 }

For this, I need to simulate the repository state changing between calls. Since I'm mocking the repo, I need to make `findPending` return different things on different calls, and `findByTxid` return the right thing.

Let me use `mockResolvedValueOnce` chains or a state variable.

Actually, for the full lifecycle tests, it might be cleaner to use a stateful mock. Let me create a simple in-memory store:

```typescript
function makeStatefulRepo(orders: Map<string, MockOrder>) {
  // ... methods that read/write from the map
}
```

Hmm, but that's more complex. Let me just use sequential mocks with `mockResolvedValueOnce`.

For test 27:
```typescript
const order = makeOrder();
const txid = order.txid;

// Phase 1: executePayments → timeout
repo.findPending.mockResolvedValueOnce([order]);
repo.incrementAttempt.mockResolvedValueOnce(1);
bank.send.mockRejectedValueOnce(new BankTransientError('timeout', 'timed out'));
await service.executePayments();

// Phase 2: reconcile → proven absent
vi.setSystemTime(new Date('2024-01-16T01:00:00.000Z'));
bank.getStatement.mockResolvedValueOnce([]); // no settlements for that date
repo.findInDoubtByEffectiveDate.mockResolvedValueOnce([makeOrder({ status: 'in_doubt' })]);
const result1 = await service.reconcile({ startDate: new Date('2024-01-15'), endDate: new Date('2024-01-15') });
expect(result1).toEqual({ settled: 0, provenAbsent: 1 });

// Phase 3: executePayments → accepted (same txid)
repo.findPending.mockResolvedValueOnce([makeOrder({ attemptCount: 1 })]);
repo.incrementAttempt.mockResolvedValueOnce(2);
bank.send.mockResolvedValueOnce({ status: 'accepted' });
await service.executePayments();

// Verify same txid was used
expect(bank.send).toHaveBeenLastCalledWith({
  txid,
  amount_minor_units: order.amountMinorUnits,
  key: order.supplierKey,
});

// Phase 4: reconcile → settled
bank.getStatement.mockResolvedValueOnce([{ txid, amount_minor_units: order.amountMinorUnits, settled_at: new Date() }]);
repo.findByTxid.mockResolvedValueOnce(makeOrder({ status: 'sent' }));
const result2 = await service.reconcile({ startDate: new Date('2024-01-15'), endDate: new Date('2024-01-15') });
expect(result2).toEqual({ settled: 1, provenAbsent: 0 });
```

This is getting complex but manageable. Let me write it all out.

One more consideration: the `reconcile` method calls `bank.getStatement(date)` for each date in the window. If the window is a single day, it's called once. For the "inclusive window boundaries" test with a multi-day range, it should be called for each day.

Let me also think about the "parked order survives repeated calls" test:
- Order is in `parked_manual_review` status
- Call executePayments: `findPending` should NOT return it (it's not pending), so it's not processed
- Call reconcile: `findByTxid` returns it with status `parked_manual_review`, the service checks if status is 'sent' or 'in_doubt' - it's not, so it's skipped
- Also `findInDoubtByEffectiveDate` won't return it since it's not in_doubt

So the test verifies that parked orders are never modified. I'll set up the scenario where a parked order's txid appears in a statement, and verify no state change happens.

OK let me write the complete file now. I'll be thorough.

Actually, one more thing: for the `reconcile` tests, I need to be careful about the interaction between settlement matching and proven-absent checking. The service does BOTH for each date:
1. First, it iterates over settlements and matches them
2. Then, if the statement is complete, it checks for proven-absent

So an order that IS in the statement gets settled (step 1), and then in step 2, it won't be found by `findInDoubtByEffectiveDate` because... wait, actually it will still be in_doubt in the mock. The service doesn't re-read the order after settling it.

Hmm, this is a subtle point. In the real system with conditional updates, `markSettled` would change the status, so a subsequent `findInDoubtByEffectiveDate` in the same reconcile run would not return it. But in my mock, `findInDoubtByEffectiveDate` returns whatever I tell it to.

For the test "an in_doubt order present in the statement is settled, not counted as proven absent", I need to:
1. Have the order's txid in the statement
2. Have `findByTxid` return it with status 'in_doubt' (so it gets settled)
3. Have `findInDoubtByEffectiveDate` return it (simulating that it's still in_doubt at query time)
4. But since its txid IS in the statementTxids set, the proven-absent check should skip it

Looking at the service code:
```typescript
for (const settlement of statement) {
    const order = await this.repo.findByTxid(settlement.txid);
    if (order && (order.status === 'sent' || order.status === 'in_doubt')) {
      await this.repo.markSettled(order.id, settlement.settled_at);
      ...
      settled++;
    }
}

if (now.getTime() > endOfDay.getTime() + this.publishingLagMs) {
    const inDoubtOrders = await this.repo.findInDoubtByEffectiveDate(date);
    for (const order of inDoubtOrders) {
      if (!statementTxids.has(order.txid)) {
        await this.repo.markPendingForResend(order.id);
        provenAbsent++;
      }
    }
}
```

So if the order's txid is in `statementTxids`, the proven-absent check will skip it (the `if (!statementTxids.has(order.txid))` guard). Good.

So for that test:
- Statement contains the order's txid
- `findByTxid` returns it with status 'in_doubt' → gets settled, settled = 1
- `findInDoubtByEffectiveDate` returns it (same order) → but its txid IS in statementTxids, so it's NOT counted as proven absent
- Result: { settled: 1, provenAbsent: 0 }

This works correctly with the mock.

Now let me write the final file. I'll organize it clearly with describe blocks.

Let me also double-check: the service constructor takes `(repo, bank, opts)`. The `opts` is injected via `@Inject(PAYMENT_OPTIONS)` in NestJS, but when I instantiate manually, I just pass it as the third argument. This should work fine.

One last thing: I should make sure my tests don't just assert "a call happened" but also assert the meaningful outcome. For example:
- For reconcile tests, assert the return value `{ settled, provenAbsent }`
- For executePayments tests, since there's no return value, asserting the repository calls IS the meaningful behavior (the service is telling the repo what state transition to make)
- But I should also assert negative cases (other transitions didn't happen)

I think my approach is solid. Let me write it all out now.
```

## reply

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PaymentService } from '../src/payment/payment.service';
import { PaymentRepository } from '../src/payment/payment.repository';
import {
  BankClient,
  BankSendResponse,
  Settlement,
  BankTransientError,
  BankPermanentError,
} from '../src/payment/bank-client.interface';

// ─── Constants ──────────────────────────────────────────────────────────────

const PUBLISHING_LAG_MS = 30 * 60 * 1000;
const BATCH_SIZE = 100;
const MAX_ATTEMPTS = 5;

// ─── Helpers ────────────────────────────────────────────────────────────────

interface MockOrder {
  id: string;
  supplierKey: string;
  amountMinorUnits: number;
  effectiveDate: Date;
  txid: string;
  status: string;
  attemptCount: number;
  lastAttemptAt: Date | null;
  settledAt: Date | null;
}

function makeOrder(overrides: Partial<MockOrder> = {}): MockOrder {
  return {
    id: 'order-1',
    supplierKey: 'supplier-key-1',
    amountMinorUnits: 5000,
    effectiveDate: new Date('2024-01-15T00:00:00.000Z'),
    txid: 'txid-1',
    status: 'pending',
    attemptCount: 0,
    lastAttemptAt: null,
    settledAt: null,
    ...overrides,
  };
}

function makeRepo() {
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

function makeBank() {
  return {
    send: vi.fn().mockResolvedValue({ status: 'accepted' } as BankSendResponse),
    getStatement: vi.fn().mockResolvedValue([] as Settlement[]),
  };
}

function makeService(
  repo: ReturnType<typeof makeRepo>,
  bank: ReturnType<typeof makeBank>,
): PaymentService {
  return new PaymentService(repo as any, bank as any, {
    publishingLagMs: PUBLISHING_LAG_MS,
    batchSize: BATCH_SIZE,
    maxAttempts: MAX_ATTEMPTS,
  });
}

/** Date well after the publishing lag for 2024-01-15. */
const AFTER_LAG = new Date('2024-01-16T01:00:00.000Z');
/** Date before the publishing lag for 2024-01-15. */
const BEFORE_LAG = new Date('2024-01-16T00:29:00.000Z');
/** Exactly one millisecond after the boundary for 2024-01-15. */
const ONE_MS_AFTER = new Date('2024-01-16T00:30:00.001Z');

// ─── executePayments ────────────────────────────────────────────────────────

describe('executePayments', () => {
  let repo: ReturnType<typeof makeRepo>;
  let bank: ReturnType<typeof makeBank>;
  let service: PaymentService;

  beforeEach(() => {
    repo = makeRepo();
    bank = makeBank();
    service = makeService(repo, bank);
  });

  it('accepted bank response moves a pending order to sent', async () => {
    const order = makeOrder();
    repo.findPending.mockResolvedValue([order]);
    bank.send.mockResolvedValue({ status: 'accepted' });

    await service.executePayments();

    expect(repo.markSent).toHaveBeenCalledWith(order.id, expect.any(Date));
    expect(repo.markInDoubt).not.toHaveBeenCalled();
    expect(repo.markRejected).not.toHaveBeenCalled();
  });

  it('duplicate bank response is treated as success', async () => {
    const order = makeOrder();
    repo.findPending.mockResolvedValue([order]);
    bank.send.mockResolvedValue({ status: 'duplicate' });

    await service.executePayments();

    expect(repo.markSent).toHaveBeenCalledWith(order.id, expect.any(Date));
    expect(repo.markInDoubt).not.toHaveBeenCalled();
    expect(repo.markRejected).not.toHaveBeenCalled();
  });

  it('transient_error response moves a pending order to in_doubt', async () => {
    const order = makeOrder();
    repo.findPending.mockResolvedValue([order]);
    bank.send.mockResolvedValue({ status: 'transient_error' });

    await service.executePayments();

    expect(repo.markInDoubt).toHaveBeenCalledWith(order.id, expect.any(Date));
    expect(repo.markSent).not.toHaveBeenCalled();
    expect(repo.markRejected).not.toHaveBeenCalled();
  });

  it('thrown transient bank error moves a pending order to in_doubt', async () => {
    const order = makeOrder();
    repo.findPending.mockResolvedValue([order]);
    bank.send.mockRejectedValue(new BankTransientError('timeout', 'Request timed out'));

    await service.executePayments();

    expect(repo.markInDoubt).toHaveBeenCalledWith(order.id, expect.any(Date));
    expect(repo.markSent).not.toHaveBeenCalled();
    expect(repo.markRejected).not.toHaveBeenCalled();
  });

  it('unexpected non-permanent error moves a pending order to in_doubt', async () => {
    const order = makeOrder();
    repo.findPending.mockResolvedValue([order]);
    bank.send.mockRejectedValue(new Error('Something unexpected happened'));

    await service.executePayments();

    expect(repo.markInDoubt).toHaveBeenCalledWith(order.id, expect.any(Date));
    expect(repo.markSent).not.toHaveBeenCalled();
    expect(repo.markRejected).not.toHaveBeenCalled();
  });

  it('permanent_rejection response moves a pending order to rejected', async () => {
    const order = makeOrder();
    repo.findPending.mockResolvedValue([order]);
    bank.send.mockResolvedValue({ status: 'permanent_rejection' });

    await service.executePayments();

    expect(repo.markRejected).toHaveBeenCalledWith(order.id);
    expect(repo.markSent).not.toHaveBeenCalled();
    expect(repo.markInDoubt).not.toHaveBeenCalled();
  });

  it('thrown permanent bank error moves a pending order to rejected', async () => {
    const order = makeOrder();
    repo.findPending.mockResolvedValue([order]);
    bank.send.mockRejectedValue(new BankPermanentError('invalid_key', 'Invalid SP key'));

    await service.executePayments();

    expect(repo.markRejected).toHaveBeenCalledWith(order.id);
    expect(repo.markSent).not.toHaveBeenCalled();
    expect(repo.markInDoubt).not.toHaveBeenCalled();
  });

  it('pending order at maxAttempts is parked without a bank call', async () => {
    const order = makeOrder({ attemptCount: MAX_ATTEMPTS });
    repo.findPending.mockResolvedValue([order]);

    await service.executePayments();

    expect(repo.markParked).toHaveBeenCalledWith(order.id);
    expect(bank.send).not.toHaveBeenCalled();
    expect(repo.incrementAttempt).not.toHaveBeenCalled();
  });

  it('pending order with attempt_count one below maxAttempts still sends', async () => {
    const order = makeOrder({ attemptCount: MAX_ATTEMPTS - 1 });
    repo.findPending.mockResolvedValue([order]);
    bank.send.mockResolvedValue({ status: 'accepted' });

    await service.executePayments();

    expect(bank.send).toHaveBeenCalledTimes(1);
    expect(repo.markSent).toHaveBeenCalledWith(order.id, expect.any(Date));
    expect(repo.markParked).not.toHaveBeenCalled();
  });

  it('a lost atomic attempt claim skips the order', async () => {
    const order = makeOrder();
    repo.findPending.mockResolvedValue([order]);
    repo.incrementAttempt.mockResolvedValue(0);

    await service.executePayments();

    expect(bank.send).not.toHaveBeenCalled();
    expect(repo.markSent).not.toHaveBeenCalled();
    expect(repo.markInDoubt).not.toHaveBeenCalled();
    expect(repo.markRejected).not.toHaveBeenCalled();
    expect(repo.markParked).not.toHaveBeenCalled();
  });

  it('the send request preserves stored txid, supplier key, and integer minor units', async () => {
    const order = makeOrder({
      txid: 'deterministic-txid-abc',
      supplierKey: 'supplier-99',
      amountMinorUnits: 12345,
    });
    repo.findPending.mockResolvedValue([order]);
    bank.send.mockResolvedValue({ status: 'accepted' });

    await service.executePayments();

    expect(bank.send).toHaveBeenCalledWith({
      txid: 'deterministic-txid-abc',
      amount_minor_units: 12345,
      key: 'supplier-99',
    });
  });

  it('only batchSize pending orders are processed per call', async () => {
    const order = makeOrder();
    repo.findPending.mockResolvedValue([order]);
    bank.send.mockResolvedValue({ status: 'accepted' });

    await service.executePayments();

    expect(repo.findPending).toHaveBeenCalledWith(BATCH_SIZE);
  });
});

// ─── reconcile ──────────────────────────────────────────────────────────────

describe('reconcile', () => {
  let repo: ReturnType<typeof makeRepo>;
  let bank: ReturnType<typeof makeBank>;
  let service: PaymentService;

  beforeEach(() => {
    vi.useFakeTimers();
    repo = makeRepo();
    bank = makeBank();
    service = makeService(repo, bank);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a settlement for a sent order marks it settled and stores the statement row', async () => {
    vi.setSystemTime(AFTER_LAG);
    const order = makeOrder({ status: 'sent', settledAt: null });
    const settlementDate = new Date('2024-01-15T10:00:00.000Z');

    bank.getStatement.mockResolvedValue([
      { txid: order.txid, amount_minor_units: order.amountMinorUnits, settled_at: settlementDate },
    ]);
    repo.findByTxid.mockResolvedValue(order);

    const result = await service.reconcile({
      startDate: new Date('2024-01-15T00:00:00.000Z'),
      endDate: new Date('2024-01-15T00:00:00.000Z'),
    });

    expect(result).toEqual({ settled: 1, provenAbsent: 0 });
    expect(repo.markSettled).toHaveBeenCalledWith(order.id, settlementDate);
    expect(repo.upsertSettlement).toHaveBeenCalledWith({
      txid: order.txid,
      amount_minor_units: order.amountMinorUnits,
      settled_at: settlementDate,
      statement_date: new Date('2024-01-15T00:00:00.000Z'),
    });
  });

  it('timeout-but-settled order in a statement is settled and not re-sent', async () => {
    vi.setSystemTime(AFTER_LAG);
    const order = makeOrder({ status: 'in_doubt' });
    const settlementDate = new Date('2024-01-15T12:00:00.000Z');

    bank.getStatement.mockResolvedValue([
      { txid: order.txid, amount_minor_units: order.amountMinorUnits, settled_at: settlementDate },
    ]);
    repo.findByTxid.mockResolvedValue(order);

    const result = await service.reconcile({
      startDate: new Date('2024-01-15T00:00:00.000Z'),
      endDate: new Date('2024-01-15T00:00:00.000Z'),
    });

    expect(result).toEqual({ settled: 1, provenAbsent: 0 });
    expect(repo.markSettled).toHaveBeenCalledWith(order.id, settlementDate);
    expect(repo.markPendingForResend).not.toHaveBeenCalled();
  });

  it('a settlement entry is processed even when the statement is not yet complete', async () => {
    vi.setSystemTime(BEFORE_LAG);
    const order = makeOrder({ status: 'sent' });
    const settlementDate = new Date('2024-01-15T09:00:00.000Z');

    bank.getStatement.mockResolvedValue([
      { txid: order.txid, amount_minor_units: order.amountMinorUnits, settled_at: settlementDate },
    ]);
    repo.findByTxid.mockResolvedValue(order);

    const result = await service.reconcile({
      startDate: new Date('2024-01-15T00:00:00.000Z'),
      endDate: new Date('2024-01-15T00:00:00.000Z'),
    });

    expect(result.settled).toBe(1);
    expect(repo.markSettled).toHaveBeenCalledWith(order.id, settlementDate);
  });

  it('rejected order is untouched even if its txid appears in a statement', async () => {
    vi.setSystemTime(AFTER_LAG);
    const order = makeOrder({ status: 'rejected' });

    bank.getStatement.mockResolvedValue([
      { txid: order.txid, amount_minor_units: order.amountMinorUnits, settled_at: new Date() },
    ]);
    repo.findByTxid.mockResolvedValue(order);

    const result = await service.reconcile({
      startDate: new Date('2024-01-15T00:00:00.000Z'),
      endDate: new Date('2024-01-15T00:00:00.000Z'),
    });

    expect(result).toEqual({ settled: 0, provenAbsent: 0 });
    expect(repo.markSettled).not.toHaveBeenCalled();
    expect(repo.markPendingForResend).not.toHaveBeenCalled();
  });

  it('parked order is untouched by reconciliation', async () => {
    vi.setSystemTime(AFTER_LAG);
    const order = makeOrder({ status: 'parked_manual_review' });

    bank.getStatement.mockResolvedValue([
      { txid: order.txid, amount_minor_units: order.amountMinorUnits, settled_at: new Date() },
    ]);
    repo.findByTxid.mockResolvedValue(order);
    repo.findInDoubtByEffectiveDate.mockResolvedValue([]);

    const result = await service.reconcile({
      startDate: new Date('2024-01-15T00:00:00.000Z'),
      endDate: new Date('2024-01-15T00:00:00.000Z'),
    });

    expect(result).toEqual({ settled: 0, provenAbsent: 0 });
    expect(repo.markSettled).not.toHaveBeenCalled();
    expect(repo.markPendingForResend).not.toHaveBeenCalled();
    expect(repo.markParked).not.toHaveBeenCalled();
  });

  it('an in_doubt order absent from a complete statement becomes pending', async () => {
    vi.setSystemTime(AFTER_LAG);
    const order = makeOrder({ status: 'in_doubt' });

    bank.getStatement.mockResolvedValue([]);
    repo.findInDoubtByEffectiveDate.mockResolvedValue([order]);

    const result = await service.reconcile({
      startDate: new Date('2024-01-15T00:00:00.000Z'),
      endDate: new Date('2024-01-15T00:00:00.000Z'),
    });

    expect(result).toEqual({ settled: 0, provenAbsent: 1 });
    expect(repo.markPendingForResend).toHaveBeenCalledWith(order.id);
  });

  it('an in_doubt order absent before the publishing lag boundary is not proven absent', async () => {
    vi.setSystemTime(BEFORE_LAG);
    const order = makeOrder({ status: 'in_doubt' });

    bank.getStatement.mockResolvedValue([]);
    repo.findInDoubtByEffectiveDate.mockResolvedValue([order]);

    const result = await service.reconcile({
      startDate: new Date('2024-01-15T00:00:00.000Z'),
      endDate: new Date('2024-01-15T00:00:00.000Z'),
    });

    expect(result).toEqual({ settled: 0, provenAbsent: 0 });
    expect(repo.markPendingForResend).not.toHaveBeenCalled();
  });

  it('an in_doubt order absent one millisecond after the boundary becomes pending', async () => {
    vi.setSystemTime(ONE_MS_AFTER);
    const order = makeOrder({ status: 'in_doubt' });

    bank.getStatement.mockResolvedValue([]);
    repo.findInDoubtByEffectiveDate.mockResolvedValue([order]);

    const result = await service.reconcile({
      startDate: new Date('2024-01-15T00:00:00.000Z'),
      endDate: new Date('2024-01-15T00:00:00.000Z'),
    });

    expect(result).toEqual({ settled: 0, provenAbsent: 1 });
    expect(repo.markPendingForResend).toHaveBeenCalledWith(order.id);
  });

  it("an in_doubt order with effective_date outside the window is not affected by another date's statement", async () => {
    vi.setSystemTime(AFTER_LAG);
    // Order has effective_date 2024-01-20, but we reconcile window for 2024-01-15
    const order = makeOrder({ status: 'in_doubt', effectiveDate: new Date('2024-01-20T00:00:00.000Z') });

    bank.getStatement.mockResolvedValue([]);
    // The service queries findInDoubtByEffectiveDate for 2024-01-15, not 2024-01-20
    repo.findInDoubtByEffectiveDate.mockImplementation((date: Date) => {
      // Only return the order if the queried date matches its effective_date
      const y = date.getUTCFullYear();
      const m = date.getUTCMonth();
      const d = date.getUTCDate();
      const od = order.effectiveDate;
      if (y === od.getUTCFullYear() && m === od.getUTCMonth() && d === od.getUTCDate()) {
        return Promise.resolve([order]);
      }
      return Promise.resolve([]);
    });

    const result = await service.reconcile({
      startDate: new Date('2024-01-15T00:00:00.000Z'),
      endDate: new Date('2024-01-15T00:00:00.000Z'),
    });

    expect(result).toEqual({ settled: 0, provenAbsent: 0 });
    expect(repo.markPendingForResend).not.toHaveBeenCalled();
  });

  it('an in_doubt order present in the statement is settled, not counted as proven absent', async () => {
    vi.setSystemTime(AFTER_LAG);
    const order = makeOrder({ status: 'in_doubt' });
    const settlementDate = new Date('2024-01-15T14:00:00.000Z');

    bank.getStatement.mockResolvedValue([
      { txid: order.txid, amount_minor_units: order.amountMinorUnits, settled_at: settlementDate },
    ]);
    repo.findByTxid.mockResolvedValue(order);
    // Simulate that the order is still in_doubt when queried (before markSettled takes effect)
    repo.findInDoubtByEffectiveDate.mockResolvedValue([order]);

    const result = await service.reconcile({
      startDate: new Date('2024-01-15T00:00:00.000Z'),
      endDate: new Date('2024-01-15T00:00:00.000Z'),
    });

    expect(result).toEqual({ settled: 1, provenAbsent: 0 });
    expect(repo.markSettled).toHaveBeenCalledWith(order.id, settlementDate);
    expect(repo.markPendingForResend).not.toHaveBeenCalled();
  });

  it('unknown txids in a statement are ignored', async () => {
    vi.setSystemTime(AFTER_LAG);

    bank.getStatement.mockResolvedValue([
      { txid: 'unknown-txid-1', amount_minor_units: 999, settled_at: new Date() },
      { txid: 'unknown-txid-2', amount_minor_units: 888, settled_at: new Date() },
    ]);
    repo.findByTxid.mockResolvedValue(null);
    repo.findInDoubtByEffectiveDate.mockResolvedValue([]);

    const result = await service.reconcile({
      startDate: new Date('2024-01-15T00:00:00.000Z'),
      endDate: new Date('2024-01-15T00:00:00.000Z'),
    });

    expect(result).toEqual({ settled: 0, provenAbsent: 0 });
    expect(repo.markSettled).not.toHaveBeenCalled();
    expect(repo.upsertSettlement).not.toHaveBeenCalled();
  });

  it('duplicate delivery of the same statement entry is idempotent', async () => {
    vi.setSystemTime(AFTER_LAG);
    const order = makeOrder({ status: 'sent' });
    const settlementDate = new Date('2024-01-15T10:00:00.000Z');
    const settlement = { txid: order.txid, amount_minor_units: order.amountMinorUnits, settled_at: settlementDate };

    bank.getStatement.mockResolvedValue([settlement]);
    // First call: order is sent → gets settled
    repo.findByTxid
      .mockResolvedValueOnce(order)
      .mockResolvedValueOnce(makeOrder({ id: order.id, status: 'settled' }));

    const window = {
      startDate: new Date('2024-01-15T00:00:00.000Z'),
      endDate: new Date('2024-01-15T00:00:00.000Z'),
    };

    const result1 = await service.reconcile(window);
    expect(result1).toEqual({ settled: 1, provenAbsent: 0 });

    const result2 = await service.reconcile(window);
    expect(result2).toEqual({ settled: 0, provenAbsent: 0 });

    expect(repo.markSettled).toHaveBeenCalledTimes(1);
    expect(repo.upsertSettlement).toHaveBeenCalledTimes(1);
  });

  it('running the same window twice is idempotent', async () => {
    vi.setSystemTime(AFTER_LAG);
    const order = makeOrder({ status: 'sent' });
    const inDoubtOrder = makeOrder({ id: 'order-2', txid: 'txid-2', status: 'in_doubt' });
    const settlementDate = new Date('2024-01-15T10:00:00.000Z');

    bank.getStatement.mockResolvedValue([
      { txid: order.txid, amount_minor_units: order.amountMinorUnits, settled_at: settlementDate },
    ]);
    // First reconcile: order is sent → settled; inDoubtOrder is absent → proven absent
    // Second reconcile: order is now settled (skip); inDoubtOrder is now pending (not in_doubt, skip)
    repo.findByTxid
      .mockResolvedValueOnce(order)
      .mockResolvedValueOnce(makeOrder({ id: order.id, status: 'settled' }));
    repo.findInDoubtByEffectiveDate
      .mockResolvedValueOnce([inDoubtOrder])
      .mockResolvedValueOnce([]);

    const window = {
      startDate: new Date('2024-01-15T00:00:00.000Z'),
      endDate: new Date('2024-01-15T00:00:00.000Z'),
    };

    const result1 = await service.reconcile(window);
    expect(result1).toEqual({ settled: 1, provenAbsent: 1 });

    const result2 = await service.reconcile(window);
    expect(result2).toEqual({ settled: 0, provenAbsent: 0 });

    expect(repo.markSettled).toHaveBeenCalledTimes(1);
    expect(repo.markPendingForResend).toHaveBeenCalledTimes(1);
  });

  it('inclusive window boundaries cover a single-day and multi-day range', async () => {
    vi.setSystemTime(AFTER_LAG);
    bank.getStatement.mockResolvedValue([]);
    repo.findByTxid.mockResolvedValue(null);
    repo.findInDoubtByEffectiveDate.mockResolvedValue([]);

    // Single-day window
    await service.reconcile({
      startDate: new Date('2024-01-15T00:00:00.000Z'),
      endDate: new Date('2024-01-15T00:00:00.000Z'),
    });
    expect(bank.getStatement).toHaveBeenCalledTimes(1);

    // Multi-day window: 3 days
    bank.getStatement.mockClear();
    await service.reconcile({
      startDate: new Date('2024-01-15T00:00:00.000Z'),
      endDate: new Date('2024-01-17T00:00:00.000Z'),
    });
    expect(bank.getStatement).toHaveBeenCalledTimes(3);

    // Verify all three dates were queried (UTC midnights)
    const calledDates = bank.getStatement.mock.calls.map((c) => c[0]);
    expect(calledDates).toHaveLength(3);
    expect(calledDates[0].getUTCDate()).toBe(15);
    expect(calledDates[1].getUTCDate()).toBe(16);
    expect(calledDates[2].getUTCDate()).toBe(17);
  });
});

// ─── Full lifecycle ─────────────────────────────────────────────────────────

describe('full lifecycle', () => {
  let repo: ReturnType<typeof makeRepo>;
  let bank: ReturnType<typeof makeBank>;
  let service: PaymentService;

  beforeEach(() => {
    vi.useFakeTimers();
    repo = makeRepo();
    bank = makeBank();
    service = makeService(repo, bank);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('timeout, proven absent, resend with same txid, then settlement', async () => {
    const order = makeOrder({ txid: 'lifecycle-txid' });

    // Phase 1: executePayments → timeout → in_doubt
    repo.findPending.mockResolvedValueOnce([order]);
    repo.incrementAttempt.mockResolvedValueOnce(1);
    bank.send.mockRejectedValueOnce(new BankTransientError('timeout', 'Request timed out'));
    await service.executePayments();

    expect(repo.markInDoubt).toHaveBeenCalledTimes(1);

    // Phase 2: reconcile (past lag) → proven absent → pending
    vi.setSystemTime(AFTER_LAG);
    bank.getStatement.mockResolvedValueOnce([]);
    repo.findInDoubtByEffectiveDate.mockResolvedValueOnce([makeOrder({ status: 'in_doubt' })]);
    const result1 = await service.reconcile({
      startDate: new Date('2024-01-15T00:00:00.000Z'),
      endDate: new Date('2024-01-15T00:00:00.000Z'),
    });
    expect(result1).toEqual({ settled: 0, provenAbsent: 1 });
    expect(repo.markPendingForResend).toHaveBeenCalledTimes(1);

    // Phase 3: executePayments → accepted with same txid
    const resentOrder = makeOrder({ txid: 'lifecycle-txid', attemptCount: 1 });
    repo.findPending.mockResolvedValueOnce([resentOrder]);
    repo.incrementAttempt.mockResolvedValueOnce(2);
    bank.send.mockResolvedValueOnce({ status: 'accepted' });
    await service.executePayments();

    // Verify the same txid was used for resend
    expect(bank.send).toHaveBeenLastCalledWith({
      txid: 'lifecycle-txid',
      amount_minor_units: order.amountMinorUnits,
      key: order.supplierKey,
    });

    // Phase 4: reconcile → found in statement → settled
    bank.getStatement.mockResolvedValueOnce([
      { txid: 'lifecycle-txid', amount_minor_units: order.amountMinorUnits, settled_at: new Date('2024-01-15T16:00:00.000Z') },
    ]);
    repo.findByTxid.mockResolvedValueOnce(makeOrder({ id: order.id, txid: 'lifecycle-txid', status: 'sent' }));
    const result2 = await service.reconcile({
      startDate: new Date('2024-01-15T00:00:00.000Z'),
      endDate: new Date('2024-01-15T00:00:00.000Z'),
    });
    expect(result2).toEqual({ settled: 1, provenAbsent: 0 });
    expect(repo.markSettled).toHaveBeenCalledTimes(1);
  });

  it('five timed-out sends with proven-absent returns in between end parked without a sixth send', async () => {
    vi.setSystemTime(AFTER_LAG);

    for (let i = 0; i < 5; i++) {
      // executePayments: attempt i (0-indexed), increment to i+1
      const order = makeOrder({ attemptCount: i });
      repo.findPending.mockResolvedValueOnce([order]);
      repo.incrementAttempt.mockResolvedValueOnce(i + 1);
      bank.send.mockRejectedValueOnce(new BankTransientError('timeout', 'timed out'));

      await service.executePayments();
      expect(repo.markInDoubt).toHaveBeenCalledTimes(i + 1);

      // reconcile: proven absent → back to pending
      bank.getStatement.mockResolvedValueOnce([]);
      repo.findInDoubtByEffectiveDate.mockResolvedValueOnce([makeOrder({ status: 'in_doubt' })]);
      await service.reconcile({
        startDate: new Date('2024-01-15T00:00:00.000Z'),
        endDate: new Date('2024-01-15T00:00:00.000Z'),
      });
    }

    // After 5 timeouts, attemptCount is 5. Next executePayments should park.
    expect(bank.send).toHaveBeenCalledTimes(5);

    // Phase 6: executePayments with attemptCount = 5 → park
    const exhaustedOrder = makeOrder({ attemptCount: MAX_ATTEMPTS });
    repo.findPending.mockResolvedValueOnce([exhaustedOrder]);
    await service.executePayments();

    expect(repo.markParked).toHaveBeenCalledTimes(1);
    expect(bank.send).toHaveBeenCalledTimes(5); // no sixth send
  });

  it('parked order survives repeated executePayments and reconcile calls', async () => {
    vi.setSystemTime(AFTER_LAG);
    const parkedOrder = makeOrder({ status: 'parked_manual_review' });

    // executePayments: parked order is not pending, so it won't be fetched
    repo.findPending.mockResolvedValue([]);
    await service.executePayments();
    expect(bank.send).not.toHaveBeenCalled();

    // reconcile: parked order's txid appears in statement but status is not sent/in_doubt
    bank.getStatement.mockResolvedValue([
      { txid: parkedOrder.txid, amount_minor_units: parkedOrder.amountMinorUnits, settled_at: new Date() },
    ]);
    repo.findByTxid.mockResolvedValue(parkedOrder);
    repo.findInDoubtByEffectiveDate.mockResolvedValue([]);

    const result = await service.reconcile({
      startDate: new Date('2024-01-15T00:00:00.000Z'),
      endDate: new Date('2024-01-15T00:00:00.000Z'),
    });
    expect(result).toEqual({ settled: 0, provenAbsent: 0 });

    // Call again to verify stability
    repo.findByTxid.mockResolvedValue(p
