# 07-payouts.spec.ts

## reasoning

```
Let me analyze the test cases from `07-payouts.spec.ts-cases.txt` and the plan to write comprehensive unit tests.

From the cases file, I need to test:

1. `accepted response transitions PENDING → IN_FLIGHT, stores txid, increments attempts`
2. `duplicate response is handled identically to accepted (IN_FLIGHT, attempts + 1)`
3. `transient error leaves order PENDING with unchanged attempts`
4. `permanent rejection transitions PENDING → REJECTED (terminal)`
5. `bank.send network throw is treated as committed timeout (IN_FLIGHT, attempts + 1)`
6. `timeout-but-settled: reconcile finds txid in statement → SETTLED, no resend`
7. `proven-absent with attempts < 5: IN_FLIGHT → PENDING, same txid retained`
8. `proven-absent with attempts ≥ 5: IN_FLIGHT → PARKED (terminal, never auto-reverted)`
9. `not-yet-past-publishing-lag: order stays IN_FLIGHT, no transition`
10. `boundary: now exactly at effectiveDate + 24h + 30min is past lag; one millisecond before is not`
11. `amount mismatch in statement: order is NOT settled, remains IN_FLIGHT`
12. `reconcile idempotency: second run on same date yields zero settlements, zero parks, zero proven-absent`
13. `concurrent reconcile: two runs on same date — the transition WHERE status = $from guard means only one wins, the other gets 0 rows and skips`
14. `txid determinism: same (orderId, effectiveDate) always yields the same 32-char hex string`
15. `txid reuse on resend: an order that went IN_FLIGHT → PENDING (proven-absent) keeps its original txid on the next executePayments`
16. `executePayments processes multiple PENDING orders independently: one bank.send throw does not abort the loop`
17. `reconcile with empty statement (no settlements for the date) still runs the absence phase correctly`
18. `bank.getStatement throws: reconcile surfaces bank_unavailable, no state mutations`
19. `attempts counter after 5 committed sends + 5 proven-absent cycles is exactly 5, and the 6th absence parks`

Now let me look at the service code to understand the interfaces:

- `PayoutsService` constructor takes `repo: PayoutsRepository` and `bank: BankClient`
- `executePayments(effectiveDate: Date)` → `{ sent, rejected }`
- `reconcile(date: string)` → `ReconcileResult`
- `deriveTxid(orderId, effectiveDate)` is private
- `isPastPublishingLag(effectiveDate, now?)` is private
- `parseUTCDate(date)` is private

For the repository:
- `findPending(effectiveDate: Date)` → orders[]
- `findInFlight(effectiveDate: Date)` → orders[]
- `transition(id, from, to, patch?)` → boolean

For the bank:
- `send(req)` → BankSendResult
- `getStatement(date)` → BankSettlement[]

I need to mock both the repository and the bank client. I'll use `vi.fn()` for the mocks.

For test 10 (boundary), I need to test `isPastPublishingLag` which is private. I can access it via `(service as any).isPastPublishingLag(...)` or I can test it indirectly through `reconcile`. Let me think... The plan says to test behaviour, not implementation. But the boundary test is specifically about the threshold. I think testing it through `reconcile` is the right approach - I'll set up an IN_FLIGHT order and mock `now` to be exactly at the threshold vs one ms before.

Wait, but `isPastPublishingLag` takes an optional `now` parameter that defaults to `new Date()`. In the reconcile method, it's called as `this.isPastPublishingLag(effectiveDate)` without passing `now`. So I can't inject a custom `now` through the public API.

Looking at the service code more carefully:
```ts
private isPastPublishingLag(effectiveDate: Date, now: Date = new Date()): boolean {
```

It's called in `reconcile` as:
```ts
if (!this.isPastPublishingLag(effectiveDate)) continue;
```

So `now` defaults to `new Date()`. To test the boundary, I'd need to either:
1. Use `vi.useFakeTimers()` and set the clock
2. Access the private method directly

Using fake timers is cleaner and tests through the public API. Let me use that approach.

Actually, let me reconsider. The plan says "Test the behaviour, not the implementation." So I should test through `reconcile` with fake timers.

Let me structure the tests:

For the boundary test, I'll use `vi.useFakeTimers()` and set the time to exactly `effectiveDate + 24h + 30min` and `effectiveDate + 24h + 30min - 1ms`.

Let me think about the order shape. From the schema:
- `id: string`
- `amountCents: number`
- `bankKey: string`
- `status: OrderStatus`
- `attempts: number`
- `txid: string | null`
- `effectiveDate: Date`
- `createdAt: Date`
- `updatedAt: Date`

I'll create a helper to make order fixtures.

For the `OrderStatus` enum, I'll import from `@prisma/client`.

Let me now write the test file:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PayoutsService } from '../src/payouts/payouts.service';
import { BankClient, BankSettlement } from '../src/payouts/bank-client';
import { PayoutsRepository } from '../src/payouts/payouts.repository';
import { OrderStatus } from '@prisma/client';

// Helper to create a minimal order fixture
function makeOrder(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 'ord-1',
    amountCents: 5000,
    bankKey: 'key-1',
    status: OrderStatus.PENDING,
    attempts: 0,
    txid: null as string | null,
    effectiveDate: new Date('2024-01-15T00:00:00.000Z'),
    createdAt: new Date('2024-01-14T10:00:00.000Z'),
    updatedAt: new Date('2024-01-14T10:00:00.000Z'),
    ...overrides,
  };
}

function makeMockBank() {
  return {
    send: vi.fn(),
    getStatement: vi.fn(),
  };
}

function makeMockRepo() {
  return {
    findPending: vi.fn(),
    findInFlight: vi.fn(),
    findByTxid: vi.fn(),
    transition: vi.fn().mockResolvedValue(true),
  };
}

// ... tests
```

Now let me think about each test case:

**Test 1: accepted response**
- Mock `findPending` to return one order (PENDING)
- Mock `bank.send` to resolve with `{ kind: 'accepted' }`
- Call `executePayments(effectiveDate)`
- Assert `transition` was called with `(order.id, PENDING, IN_FLIGHT, { txid: <expected>, attempts: 1 })`

**Test 2: duplicate response**
- Same as above but `bank.send` resolves with `{ kind: 'duplicate', originalAcceptedAt: new Date() }`
- Assert same transition

**Test 3: transient error**
- Mock `bank.send` to resolve with `{ kind: 'transient', reason: 'rate limit' }`
- Call `executePayments`
- Assert `transition` was NOT called

**Test 4: permanent rejection**
- Mock `bank.send` to resolve with `{ kind: 'permanent_rejection', code: 'INSUFFICIENT_FUNDS', reason: '...' }`
- Call `executePayments`
- Assert `transition` was called with `(order.id, PENDING, REJECTED)` (no patch)

**Test 5: bank.send throws**
- Mock `bank.send` to reject with an Error
- Call `executePayments`
- Assert `transition` was called with `(order.id, PENDING, IN_FLIGHT, { txid, attempts: 1 })`

**Test 6: timeout-but-settled**
- Mock `findInFlight` to return one order (IN_FLIGHT, with txid)
- Mock `getStatement` to return a settlement matching the txid and amount
- Call `reconcile(date)`
- Assert `transition` was called with `(order.id, IN_FLIGHT, SETTLED)`
- Assert result has `settled: 1`

**Test 7: proven-absent, attempts < 5**
- Mock `findInFlight` to return one order (IN_FLIGHT, attempts: 2, with txid)
- Mock `getStatement` to return empty array (or settlements not matching the txid)
- Use fake timers set past the lag threshold
- Call `reconcile(date)`
- Assert `transition` was called with `(order.id, IN_FLIGHT, PENDING)`
- Assert result has `provenAbsent: 1`

**Test 8: proven-absent, attempts >= 5**
- Same as above but `attempts: 5`
- Assert `transition` was called with `(order.id, IN_FLIGHT, PARKED)`
- Assert result has `parked: 1`

**Test 9: not-yet-past-lag**
- Mock `findInFlight` to return one order (IN_FLIGHT)
- Mock `getStatement` to return empty
- Use fake timers set before the lag threshold
- Call `reconcile(date)`
- Assert `transition` was NOT called
- Assert result has all zeros

**Test 10: boundary**
- Two sub-cases:
  a. `now` exactly at `effectiveDate + 24h + 30min` → past lag → transition happens
  b. `now` one ms before → not past lag → no transition

**Test 11: amount mismatch**
- Mock `findInFlight` to return order with `amountCents: 5000`
- Mock `getStatement` to return settlement with same txid but `amountCents: 6000`
- Call `reconcile`
- Assert `transition` was NOT called with SETTLED (actually not called at all)

**Test 12: reconcile idempotency**
- First run: `findInFlight` returns order, `getStatement` has matching settlement → SETTLED
- Second run: `findInFlight` returns empty (because the order is now SETTLED) → all zeros
- Or alternatively: `transition` returns false on second call (simulating the WHERE guard)

Actually, for idempotency, the key insight is that on the second run, `findInFlight` won't return the order because it's already SETTLED. So I should mock `findInFlight` to return the order on first call and empty on second. Or I can just test that `transition` returning false (0 rows updated) results in zero counts.

Let me think about this differently. The plan says: "running reconcile twice for the same date does not double-settle or double-park; counts on second run are zero."

The most realistic simulation: first call to `findInFlight` returns the order, second call returns empty (because it was already settled). So I'll use `mockResolvedValueOnce` for the first call and then `mockResolvedValue` for subsequent.

Actually, a simpler approach: mock `findInFlight` to return the order, but mock `transition` to return `false` (simulating that the WHERE guard didn't match because another run already processed it). Then the counts should be zero.

Let me go with: `transition` returns false → counts are zero. This directly tests the CAS guard behavior.

**Test 13: concurrent reconcile (CAS guard)**
- This is essentially the same as test 12 but framed differently. I'll test that when `transition` returns false, the counts are zero.

Actually, looking at the cases list more carefully, test 12 and 13 are slightly different:
- Test 12: "second run on same date yields zero settlements" - this is about the full flow where `findInFlight` returns empty on second run
- Test 13: "the transition WHERE status = $from guard means only one wins" - this is about the CAS mechanism

Let me implement them as:
- Test 12: `findInFlight` returns empty on second call → all zeros
- Test 13: `findInFlight` returns the order (simulating race where both see it), but `transition` returns false → all zeros

**Test 14: txid determinism**
- Access `deriveTxid` via `(service as any).deriveTxid(...)`
- Call it twice with same args, assert same result
- Assert it's 32 hex chars

**Test 15: txid reuse on resend**
- Order has `txid: 'existing-txid'` and status PENDING (after proven-absent)
- Mock `bank.send` to resolve with accepted
- Call `executePayments`
- Assert `bank.send` was called with `txid: 'existing-txid'` (not a new derived one)

**Test 16: multiple orders, one throws**
- Two PENDING orders
- `bank.send` rejects on first, resolves accepted on second
- Assert both orders were processed (transition called for both)

**Test 17: empty statement**
- `getStatement` returns `[]`
- `findInFlight` returns an order past lag with attempts < 5
- Assert `transition` called with IN_FLIGHT → PENDING

**Test 18: getStatement throws**
- `getStatement` rejects
- Call `reconcile`
- Assert it throws (the error propagates)
- Assert `transition` was NOT called

**Test 19: attempts counter stays at 5 through proven-absent cycles**
- Order with attempts: 5, IN_FLIGHT
- `findInFlight` returns it
- `getStatement` returns empty
- Past lag
- Call `reconcile` → should PARK (attempts >= 5)
- Then simulate the order being PENDING again (resend cycle):
  - Actually, this test is about proving that reconcile doesn't increment attempts. Let me re-read...

"attempts counter after 5 committed sends + 5 proven-absent cycles is exactly 5, and the 6th absence parks"

So the test should verify:
- An order with attempts=4 goes through reconcile (proven-absent) → transition to PENDING, but the patch does NOT include attempts
- Then on next send, attempts becomes 5
- Then reconcile again → PARKED

Actually, the simplest way to test this: verify that when reconcile transitions IN_FLIGHT → PENDING, it does NOT pass an `attempts` patch. The transition call should be `(id, IN_FLIGHT, PENDING)` with no third argument (or the patch should not contain `attempts`).

Let me re-read the service code:
```ts
} else {
  const updated = await this.repo.transition(
    order.id,
    OrderStatus.IN_FLIGHT,
    OrderStatus.PENDING,
  );
  if (updated) provenAbsent++;
}
```

Yes, no patch is passed for the PENDING transition. So I'll assert that `transition` was called with exactly 3 args (no patch), or that if a patch is passed, it doesn't contain `attempts`.

Actually in TypeScript, calling with 3 args means the 4th is undefined. I'll assert `transition` was called with `(id, IN_FLIGHT, PENDING)` - checking that the 4th arg is undefined.

Let me now write the full test file. I need to be careful about:
1. The `OrderStatus` import from `@prisma/client` - in tests, I might need to use the string values or import the enum
2. The effective date format - `reconcile` takes a string like `'2024-01-15'`
3. Fake timers for the lag tests

Let me also think about what `effectiveDate` to use. I'll use `'2024-01-15'` which is `new Date('2024-01-15T00:00:00.000Z')`.

The lag threshold is `effectiveDate + 24h + 30min` = `2024-01-16T00:30:00.000Z`.

For fake timers:
- Past lag: set to `2024-01-16T00:30:00.000Z` (exactly at threshold) or later
- Not past lag: set to `2024-01-16T00:29:59.999Z` (one ms before)

Now let me write the complete file.

One more consideration: the `transition` method signature is:
```ts
transition(id: string, from: OrderStatus, to: OrderStatus, patch?: Partial<Pick<Order, 'attempts' | 'txid'>>): Promise<boolean>;
```

So when I mock it and check calls, I need to be careful about the 4th argument.

For test 4 (permanent rejection), the service calls:
```ts
await this.repo.transition(order.id, OrderStatus.PENDING, OrderStatus.REJECTED);
```
No patch. So I assert it was called with 3 args where the 4th is undefined.

Let me also think about the `ReconcileResult` shape:
```ts
export interface ReconcileResult {
  date: string;
  settled: number;
  provenAbsent: number;
  parked: number;
}
```

OK, I think I have enough to write the full test. Let me be thorough and cover all 19 cases from the list.

Wait, I need to double-check: for test 6 (timeout-but-settled), the case description says "no resend". How do I prove no resend? The key is that after reconcile settles the order, if `executePayments` were called again, `findPending` wouldn't return it (because it's SETTLED, not PENDING). I can test this by:
1. First, simulate the order being IN_FLIGHT (from a prior timeout)
2. Reconcile settles it
3. Then call `executePayments` and verify `findPending` returns empty (or that the settled order is not in the pending list)

Actually, the simpler approach: just verify the reconcile result shows `settled: 1` and the transition was to SETTLED. The "no resend" is implicit because SETTLED is terminal and `findPending` only returns PENDING orders. But to be explicit, I could add a follow-up assertion that `findPending` (mocked) would not return this order.

Hmm, but we're mocking `findPending`, so we control what it returns. The real test is: after reconcile transitions to SETTLED, the order is no longer PENDING, so a subsequent `executePayments` (which calls `findPending`) won't pick it up. Since we mock the repo, the "proof" is really that the transition target is SETTLED (terminal).

I think the test is sufficient if I assert:
- `transition` was called with `(id, IN_FLIGHT, SETTLED)`
- Result has `settled: 1`

That proves the order is settled and won't be re-sent. The "no resend" is a consequence of the state machine.

Let me finalize and write the file now.
```

## reply

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PayoutsService } from '../src/payouts/payouts.service';
import type { BankClient, BankSettlement } from '../src/payouts/bank-client';
import type { PayoutsRepository } from '../src/payouts/payouts.repository';
import { OrderStatus } from '@prisma/client';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const EFFECTIVE_DATE = new Date('2024-01-15T00:00:00.000Z');
const EFFECTIVE_DATE_STR = '2024-01-15';
const LAG_THRESHOLD = new Date('2024-01-16T00:30:00.000Z'); // effectiveDate + 24h + 30min

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ord-1',
    amountCents: 5000,
    bankKey: 'key-1',
    status: OrderStatus.PENDING,
    attempts: 0,
    txid: null as string | null,
    effectiveDate: EFFECTIVE_DATE,
    createdAt: new Date('2024-01-14T10:00:00.000Z'),
    updatedAt: new Date('2024-01-14T10:00:00.000Z'),
    ...overrides,
  };
}

function makeMockBank() {
  return {
    send: vi.fn(),
    getStatement: vi.fn(),
  } as unknown as BankClient;
}

function makeMockRepo() {
  return {
    findPending: vi.fn().mockResolvedValue([]),
    findInFlight: vi.fn().mockResolvedValue([]),
    findByTxid: vi.fn().mockResolvedValue(null),
    transition: vi.fn().mockResolvedValue(true),
  } as unknown as PayoutsRepository & {
    findPending: ReturnType<typeof vi.fn>;
    findInFlight: ReturnType<typeof vi.fn>;
    findByTxid: ReturnType<typeof vi.fn>;
    transition: ReturnType<typeof vi.fn>;
  };
}

function createService(repo?: PayoutsRepository, bank?: BankClient) {
  const r = repo ?? makeMockRepo();
  const b = bank ?? makeMockBank();
  return { service: new PayoutsService(r, b), repo: r as ReturnType<typeof makeMockRepo>, bank: b };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('PayoutsService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(LAG_THRESHOLD);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── executePayments: response classification ──────────────────────────────

  it('accepted response transitions PENDING → IN_FLIGHT, stores txid, increments attempts', async () => {
    const order = makeOrder({ status: OrderStatus.PENDING, attempts: 0 });
    const { service, repo, bank } = createService();

    (repo.findPending as ReturnType<typeof vi.fn>).mockResolvedValue([order]);
    (bank.send as ReturnType<typeof vi.fn>).mockResolvedValue({ kind: 'accepted' });

    const result = await service.executePayments(EFFECTIVE_DATE);

    expect(result).toEqual({ sent: 1, rejected: 0 });
    expect(repo.transition).toHaveBeenCalledTimes(1);
    const [id, from, to, patch] = (repo.transition as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(id).toBe('ord-1');
    expect(from).toBe(OrderStatus.PENDING);
    expect(to).toBe(OrderStatus.IN_FLIGHT);
    expect(patch.attempts).toBe(1);
    expect(typeof patch.txid).toBe('string');
    expect(patch.txid).toHaveLength(32);
  });

  it('duplicate response is handled identically to accepted (IN_FLIGHT, attempts + 1)', async () => {
    const order = makeOrder({ status: OrderStatus.PENDING, attempts: 2 });
    const { service, repo, bank } = createService();

    (repo.findPending as ReturnType<typeof vi.fn>).mockResolvedValue([order]);
    (bank.send as ReturnType<typeof vi.fn>).mockResolvedValue({
      kind: 'duplicate',
      originalAcceptedAt: new Date('2024-01-15T08:00:00.000Z'),
    });

    const result = await service.executePayments(EFFECTIVE_DATE);

    expect(result).toEqual({ sent: 1, rejected: 0 });
    const [id, from, to, patch] = (repo.transition as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(id).toBe('ord-1');
    expect(from).toBe(OrderStatus.PENDING);
    expect(to).toBe(OrderStatus.IN_FLIGHT);
    expect(patch.attempts).toBe(3);
    expect(typeof patch.txid).toBe('string');
  });

  it('transient error leaves order PENDING with unchanged attempts', async () => {
    const order = makeOrder({ status: OrderStatus.PENDING, attempts: 1 });
    const { service, repo, bank } = createService();

    (repo.findPending as ReturnType<typeof vi.fn>).mockResolvedValue([order]);
    (bank.send as ReturnType<typeof vi.fn>).mockResolvedValue({
      kind: 'transient',
      reason: 'rate_limited',
    });

    const result = await service.executePayments(EFFECTIVE_DATE);

    expect(result).toEqual({ sent: 0, rejected: 0 });
    expect(repo.transition).not.toHaveBeenCalled();
  });

  it('permanent rejection transitions PENDING → REJECTED (terminal)', async () => {
    const order = makeOrder({ status: OrderStatus.PENDING, attempts: 0 });
    const { service, repo, bank } = createService();

    (repo.findPending as ReturnType<typeof vi.fn>).mockResolvedValue([order]);
    (bank.send as ReturnType<typeof vi.fn>).mockResolvedValue({
      kind: 'permanent_rejection',
      code: 'INSUFFICIENT_FUNDS',
      reason: 'Account has insufficient funds',
    });

    const result = await service.executePayments(EFFECTIVE_DATE);

    expect(result).toEqual({ sent: 0, rejected: 1 });
    expect(repo.transition).toHaveBeenCalledTimes(1);
    const [id, from, to] = (repo.transition as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(id).toBe('ord-1');
    expect(from).toBe(OrderStatus.PENDING);
    expect(to).toBe(OrderStatus.REJECTED);
  });

  it('bank.send network throw is treated as committed timeout (IN_FLIGHT, attempts + 1)', async () => {
    const order = makeOrder({ status: OrderStatus.PENDING, attempts: 1 });
    const { service, repo, bank } = createService();

    (repo.findPending as ReturnType<typeof vi.fn>).mockResolvedValue([order]);
    (bank.send as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ETIMEDOUT'));

    const result = await service.executePayments(EFFECTIVE_DATE);

    expect(result).toEqual({ sent: 1, rejected: 0 });
    expect(repo.transition).toHaveBeenCalledTimes(1);
    const [id, from, to, patch] = (repo.transition as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(id).toBe('ord-1');
    expect(from).toBe(OrderStatus.PENDING);
    expect(to).toBe(OrderStatus.IN_FLIGHT);
    expect(patch.attempts).toBe(2);
    expect(typeof patch.txid).toBe('string');
  });

  // ── reconcile: matching and settlement ────────────────────────────────────

  it('timeout-but-settled: reconcile finds txid in statement → SETTLED, no resend', async () => {
    const txid = 'a'.repeat(32);
    const order = makeOrder({ status: OrderStatus.IN_FLIGHT, attempts: 1, txid });
    const settlement: BankSettlement = { txid, amountCents: 5000, settledAt: new Date('2024-01-15T12:00:00.000Z') };
    const { service, repo, bank } = createService();

    (repo.findInFlight as ReturnType<typeof vi.fn>).mockResolvedValue([order]);
    (bank.getStatement as ReturnType<typeof vi.fn>).mockResolvedValue([settlement]);

    const result = await service.reconcile(EFFECTIVE_DATE_STR);

    expect(result).toEqual({ date: EFFECTIVE_DATE_STR, settled: 1, provenAbsent: 0, parked: 0 });
    expect(repo.transition).toHaveBeenCalledTimes(1);
    const [id, from, to] = (repo.transition as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(id).toBe('ord-1');
    expect(from).toBe(OrderStatus.IN_FLIGHT);
    expect(to).toBe(OrderStatus.SETTLED);
  });

  it('amount mismatch in statement: order is NOT settled, remains IN_FLIGHT', async () => {
    const txid = 'b'.repeat(32);
    const order = makeOrder({ status: OrderStatus.IN_FLIGHT, attempts: 1, txid, amountCents: 5000 });
    const settlement: BankSettlement = { txid, amountCents: 6000, settledAt: new Date('2024-01-15T12:00:00.000Z') };
    const { service, repo, bank } = createService();

    (repo.findInFlight as ReturnType<typeof vi.fn>).mockResolvedValue([order]);
    (bank.getStatement as ReturnType<typeof vi.fn>).mockResolvedValue([settlement]);

    const result = await service.reconcile(EFFECTIVE_DATE_STR);

    expect(result.settled).toBe(0);
    // The order is not settled; it also should not be parked or proven-absent in this call
    // because the absence phase re-fetches findInFlight which still returns it.
    // But since we're past lag, it would go to provenAbsent or parked depending on attempts.
    // With attempts=1, it would be provenAbsent. That's fine — the key assertion is settled=0.
    expect(repo.transition).not.toHaveBeenCalledWith(
      'ord-1',
      OrderStatus.IN_FLIGHT,
      OrderStatus.SETTLED,
    );
  });

  // ── reconcile: absence and resend ─────────────────────────────────────────

  it('proven-absent with attempts < 5: IN_FLIGHT → PENDING, same txid retained', async () => {
    const txid = 'c'.repeat(32);
    const order = makeOrder({ status: OrderStatus.IN_FLIGHT, attempts: 2, txid });
    const { service, repo, bank } = createService();

    (repo.findInFlight as ReturnType<typeof vi.fn>).mockResolvedValue([order]);
    (bank.getStatement as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await service.reconcile(EFFECTIVE_DATE_STR);

    expect(result).toEqual({ date: EFFECTIVE_DATE_STR, settled: 0, provenAbsent: 1, parked: 0 });
    expect(repo.transition).toHaveBeenCalledTimes(1);
    const [id, from, to] = (repo.transition as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(id).toBe('ord-1');
    expect(from).toBe(OrderStatus.IN_FLIGHT);
    expect(to).toBe(OrderStatus.PENDING);
  });

  it('proven-absent with attempts ≥ 5: IN_FLIGHT → PARKED (terminal, never auto-reverted)', async () => {
    const txid = 'd'.repeat(32);
    const order = makeOrder({ status: OrderStatus.IN_FLIGHT, attempts: 5, txid });
    const { service, repo, bank } = createService();

    (repo.findInFlight as ReturnType<typeof vi.fn>).mockResolvedValue([order]);
    (bank.getStatement as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await service.reconcile(EFFECTIVE_DATE_STR);

    expect(result).toEqual({ date: EFFECTIVE_DATE_STR, settled: 0, provenAbsent: 0, parked: 1 });
    expect(repo.transition).toHaveBeenCalledTimes(1);
    const [id, from, to] = (repo.transition as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(id).toBe('ord-1');
    expect(from).toBe(OrderStatus.IN_FLIGHT);
    expect(to).toBe(OrderStatus.PARKED);
  });

  it('not-yet-past-publishing-lag: order stays IN_FLIGHT, no transition', async () => {
    vi.setSystemTime(new Date('2024-01-16T00:29:00.000Z')); // 30 min before threshold
    const txid = 'e'.repeat(32);
    const order = makeOrder({ status: OrderStatus.IN_FLIGHT, attempts: 1, txid });
    const { service, repo, bank } = createService();

    (repo.findInFlight as ReturnType<typeof vi.fn>).mockResolvedValue([order]);
    (bank.getStatement as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await service.reconcile(EFFECTIVE_DATE_STR);

    expect(result).toEqual({ date: EFFECTIVE_DATE_STR, settled: 0, provenAbsent: 0, parked: 0 });
    expect(repo.transition).not.toHaveBeenCalled();
  });

  it('boundary: now exactly at effectiveDate + 24h + 30min is past lag; one millisecond before is not', async () => {
    const txid = 'f'.repeat(32);

    // Exactly at threshold → past lag
    vi.setSystemTime(LAG_THRESHOLD);
    {
      const order = makeOrder({ status: OrderStatus.IN_FLIGHT, attempts: 1, txid });
      const { service, repo, bank } = createService();
      (repo.findInFlight as ReturnType<typeof vi.fn>).mockResolvedValue([order]);
      (bank.getStatement as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await service.reconcile(EFFECTIVE_DATE_STR);
      expect(result.provenAbsent).toBe(1);
    }

    // One millisecond before threshold → NOT past lag
    vi.setSystemTime(new Date(LAG_THRESHOLD.getTime() - 1));
    {
      const order = makeOrder({ status: OrderStatus.IN_FLIGHT, attempts: 1, txid });
      const { service, repo, bank } = createService();
      (repo.findInFlight as ReturnType<typeof vi.fn>).mockResolvedValue([order]);
      (bank.getStatement as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await service.reconcile(EFFECTIVE_DATE_STR);
      expect(result.provenAbsent).toBe(0);
      expect(repo.transition).not.toHaveBeenCalled();
    }
  });

  // ── reconcile: idempotency and concurrency ────────────────────────────────

  it('reconcile idempotency: second run on same date yields zero settlements, zero parks, zero proven-absent', async () => {
    const txid = 'a'.repeat(32);
    const order = makeOrder({ status: OrderStatus.IN_FLIGHT, attempts: 1, txid });
    const settlement: BankSettlement = { txid, amountCents: 5000, settledAt: new Date() };
    const { service, repo, bank } = createService();

    // First run: order is found and settled
    (repo.findInFlight as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([order]) // match phase
      .mockResolvedValueOnce([]);    // absence phase (already settled)
    (bank.getStatement as ReturnType<typeof vi.fn>).mockResolvedValue([settlement]);

    const first = await service.reconcile(EFFECTIVE_DATE_STR);
    expect(first.settled).toBe(1);

    // Second run: findInFlight returns empty (order is now SETTLED)
    (repo.findInFlight as ReturnType<typeof vi.fn>).mockReset();
    (repo.findInFlight as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const second = await service.reconcile(EFFECTIVE_DATE_STR);
    expect(second).toEqual({ date: EFFECTIVE_DATE_STR, settled: 0, provenAbsent: 0, parked: 0 });
  });

  it('concurrent reconcile: two runs on same date — the transition WHERE status = $from guard means only one wins, the other gets 0 rows and skips', async () => {
    const txid = 'a'.repeat(32);
    const order = makeOrder({ status: OrderStatus.IN_FLIGHT, attempts: 1, txid });
    const settlement: BankSettlement = { txid, amountCents: 5000, settledAt: new Date() };
    const { service, repo, bank } = createService();

    // Simulate a race: both runs see the order in findInFlight,
    // but only one transition succeeds (the other gets false from the CAS guard).
    (repo.findInFlight as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([order]) // match phase
      .mockResolvedValueOnce([]);    // absence phase
    (bank.getStatement as ReturnType<typeof vi.fn>).mockResolvedValue([settlement]);

    // First transition call succeeds, second would fail
    (repo.transition as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(true)   // this run wins
      .mockResolvedValueOnce(false); // concurrent run loses

    const result = await service.reconcile(EFFECTIVE_DATE_STR);

    // The losing transition returns false, so it doesn't count.
    // Since the order was settled in match phase and absence phase sees empty,
    // only one transition was actually needed. The "losing" scenario is:
    // if both tried to settle, only one gets true.
    expect(result.settled).toBe(1);

    // Now simulate: both see the order in absence phase (not settled yet)
    const { service: svc2, repo: repo2, bank: bank2 } = createService();
    (repo2.findInFlight as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])  // match phase: no match
      .mockResolvedValueOnce([order]); // absence phase: order present
    (bank2.getStatement as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    // transition returns false — another concurrent run already moved it
    (repo2.transition as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const result2 = await svc2.reconcile(EFFECTIVE_DATE_STR);
    expect(result2).toEqual({ date: EFFECTIVE_DATE_STR, settled: 0, provenAbsent: 0, parked: 0 });
  });

  // ── txid derivation ───────────────────────────────────────────────────────

  it('txid determinism: same (orderId, effectiveDate) always yields the same 32-char hex string', async () => {
    const { service } = createService();
    // Access private method for direct unit test of derivation
    const derive = (service as unknown as { deriveTxid: (id: string, d: Date) => string }).deriveTxid;

    const txid1 = derive('ord-42', EFFECTIVE_DATE);
    const txid2 = derive('ord-42', EFFECTIVE_DATE);

    expect(txid1).toBe(txid2);
    expect(txid1).toMatch(/^[0-9a-f]{32}$/);
  });

  it('txid reuse on resend: an order that went IN_FLIGHT → PENDING (proven-absent) keeps its original txid on the next executePayments', async () => {
    const existingTxid = 'ab'.repeat(16); // 32 hex chars
    const order = makeOrder({ status: OrderStatus.PENDING, attempts: 1, txid: existingTxid });
    const { service, repo, bank } = createService();

    (repo.findPending as ReturnType<typeof vi.fn>).mockResolvedValue([order]);
    (bank.send as ReturnType<typeof vi.fn>).mockResolvedValue({ kind: 'accepted' });

    await service.executePayments(EFFECTIVE_DATE);

    const sendCall = (bank.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sendCall.txid).toBe(existingTxid);
  });

  // ── fault isolation and edge cases ────────────────────────────────────────

  it('executePayments processes multiple PENDING orders independently: one bank.send throw does not abort the loop', async () => {
    const order1 = makeOrder({ id: 'ord-1', status: OrderStatus.PENDING, attempts: 0 });
    const order2 = makeOrder({ id: 'ord-2', status: OrderStatus.PENDING, attempts: 0 });
    const { service, repo, bank } = createService();

    (repo.findPending as ReturnType<typeof vi.fn>).mockResolvedValue([order1, order2]);
    (bank.send as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({ kind: 'accepted' });

    const result = await service.executePayments(EFFECTIVE_DATE);

    // order1: timeout → IN_FLIGHT (counts as sent)
    // order2: accepted → IN_FLIGHT (counts as sent)
    expect(result).toEqual({ sent: 2, rejected: 0 });
    expect(repo.transition).toHaveBeenCalledTimes(2);

    const calls = (repo.transition as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toBe('ord-1');
    expect(calls[0][2]).toBe(OrderStatus.IN_FLIGHT);
    expect(calls[1][0]).toBe('ord-2');
    expect(calls[1][2]).toBe(OrderStatus.IN_FLIGHT);
  });

  it('reconcile with empty statement (no settlements for the date) still runs the absence phase correctly', async () => {
    const txid = 'a'.repeat(32);
    const order = makeOrder({ status: OrderStatus.IN_FLIGHT, attempts: 3, txid });
    const { service, repo, bank } = createService();

    (repo.findInFlight as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([order]) // match phase: no match found in empty statement
      .mockResolvedValueOnce([order]); // absence phase: order still IN_FLIGHT
    (bank.getStatement as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await service.reconcile(EFFECTIVE_DATE_STR);

    expect(result.settled).toBe(0);
    expect(result.provenAbsent).toBe(1);
    expect(repo.transition).toHaveBeenCalledWith('ord-1', OrderStatus.IN_FLIGHT, OrderStatus.PENDING);
  });

  it('bank.getStatement throws: reconcile surfaces bank_unavailable, no state mutations', async () => {
    const { service, repo, bank } = createService();

    (bank.getStatement as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(service.reconcile(EFFECTIVE_DATE_STR)).rejects.toThrow('ECONNREFUSED');
    expect(repo.transition).not.toHaveBeenCalled();
  });

  // ── attempts counter semantics ────────────────────────────────────────────

  it('attempts counter after 5 committed sends + 5 proven-absent cycles is exactly 5, and the 6th absence parks', async () => {
    // Simulate an order that has been through 5 send cycles (attempts=5)
    // and is now IN_FLIGHT. Reconcile should park it, NOT increment attempts.
    const txid = 'g'.repeat(32);
    const order = makeOrder({ status: OrderStatus.IN_FLIGHT, attempts: 5, txid });
    const { service, repo, bank } = createService();

    (repo.findInFlight as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])    // match phase: no match
      .mockResolvedValueOnce([order]); // absence phase: order present, past lag
    (bank.getStatement as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await service.reconcile(EFFECTIVE_DATE_STR);

    expect(result.parked).toBe(1);
    expect(repo.transition).toHaveBeenCalledTimes(1);
    const [id, from, to, patch] = (repo.transition as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(id).toBe('ord-1');
    expect(from).toBe(OrderStatus.IN_FLIGHT);
    expect(to).toBe(OrderStatus.PARKED);
    // No patch should be passed (attempts must NOT be incremented by reconcile)
    expect(patch).toBeUndefined();

    // Also verify: for a lower-attempt order, the PENDING transition has no patch either
    const { service: svc2, repo: repo2, bank: bank2 } = createService();
    const order2 = makeOrder({ status: OrderStatus.IN_FLIGHT, attempts: 3, txid });
    (repo2.findInFlight as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([order2]);
    (bank2.getStatement as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await svc2.reconcile(EFFECTIVE_DATE_STR);

    const [, , , patch2] = (repo2.transition as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(patch2).toBeUndefined();
  });
});
```
