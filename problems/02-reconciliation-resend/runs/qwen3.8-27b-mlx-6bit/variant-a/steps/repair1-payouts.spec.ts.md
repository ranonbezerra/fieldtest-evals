# repair1-payouts.spec.ts

## reasoning

```
Let me analyze the compiler errors that relate to `test/payouts.spec.ts`:

1. `test/payouts.spec.ts(2,32): error TS2307: Cannot find module '../src/payouts/payouts.service' or its corresponding type declarations.`
2. `test/payouts.spec.ts(3,49): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../src/payouts/bank-client.js'?`
3. `test/payouts.spec.ts(4,40): error TS2307: Cannot find module '../src/payouts/payouts.repository' or its corresponding type declarations.`

So the issues in the test file are:
1. Import of `../src/payouts/payouts.service` - needs `.js` extension (same as the bank-client one)
2. Import of `../src/payouts/bank-client` - needs `.js` extension
3. Import of `../src/payouts/payouts.repository` - needs `.js` extension

The fix is to add `.js` extensions to all relative imports in the test file.

Now I need to write the complete `test/payouts.spec.ts` that:
- Uses `.js` extensions on all relative imports
- Tests the behaviors listed in the PLAN.md section 5 (tests 1-12)
- Follows the conventions: Vitest, test behaviour not implementation, never assert only that a call happened, must have assertions

Let me look at what the plan says about the service and repository:

Service:
- `executePayments(effectiveDate: Date): Promise<{ sent: number; rejected: number }>`
- `reconcile(date: string): Promise<ReconcileResult>`
- `deriveTxid(orderId: string, effectiveDate: Date): string` (private)
- `isPastPublishingLag(effectiveDate: Date, now?: Date): boolean` (private)

Repository:
- `findPending(effectiveDate: Date)`
- `findInFlight(effectiveDate: Date)`
- `findByTxid(txid: string)`
- `transition(id, from, to, patch?)`

BankClient:
- `send(req): Promise<BankSendResult>`
- `getStatement(date: string): Promise<BankSettlement[]>`

Now, the plan says tests should test behaviour. I need to mock the repository and bank client, then test the service's behavior.

Let me think about what tests to write:

1. **Timeout-but-settled**: Order is IN_FLIGHT (simulating a timeout), reconcile finds txid in statement → SETTLED
2. **Proven-absent, attempts remaining**: Order IN_FLIGHT, not in statement, past lag → PENDING, same txid retained
3. **Attempt exhaustion**: Order IN_FLIGHT, not in statement, past lag, attempts = 5 → PARKED
4. **Accepted response**: PENDING → IN_FLIGHT, attempts incremented, txid stored
5. **Duplicate response**: PENDING → IN_FLIGHT (same as accepted), attempts incremented
6. **Transient error**: status stays PENDING, attempts unchanged
7. **Permanent rejection**: PENDING → REJECTED
8. **Not-yet-past-lag**: order IN_FLIGHT, not in statement, but now is within lag → status unchanged
9. **Reconcile idempotency**: running reconcile twice doesn't double-settle
10. **Amount mismatch**: statement entry has different amountCents → NOT settled
11. **TXID determinism**: same order ID + date → same 32-char hex
12. **Bank network error on send**: treated as timeout → IN_FLIGHT, attempts incremented

For the `deriveTxid` test (test 11), it's private. The plan says to test it, so I'll access it via `(service as any).deriveTxid(...)` or by testing it through the public API. Actually, looking more carefully, I think the best approach is to test it indirectly through `executePayments` - that the txid passed to bank.send is deterministic. Or I can cast to access the private method. Let me just use a type assertion since the plan explicitly calls for testing TXID determinism.

Actually, let me reconsider. The plan says "Test the behaviour, not the implementation." So testing `deriveTxid` directly is testing implementation. Instead, I should test that when we call `executePayments` with the same order, the txid sent to the bank is the same. That's the behavioural test.

But wait - the plan lists it as test #11: "TXID determinism: calling `deriveTxid` with same order ID + date yields the same 32-char hex string across calls." This is explicitly a unit test of a helper. I'll include it but access it via type assertion since it's private.

Let me now write the test file:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { PayoutsService } from '../src/payouts/payouts.service.js';
import type { BankClient, BankSettlement } from '../src/payouts/bank-client.js';
import type { PayoutsRepository } from '../src/payouts/payouts.repository.js';
```

Wait, I need to think about what types are exported. The plan shows:
- `bank-client.ts` exports: `BankSendRequest`, `BankSendResult`, `BankSettlement`, `BankClient`
- `payouts.repository.ts` exports: `PayoutsRepository` class
- `payouts.service.ts` exports: `ReconcileResult`, `PayoutsService`

For the repository, I'll need to mock it. Let me create a mock that has the methods the service calls: `findPending`, `findInFlight`, `findByTxid`, `transition`.

Let me think about the order shape. From the plan:
```typescript
{
  id: string;
  amountCents: number;
  bankKey: string;
  status: OrderStatus; // 'PENDING' | 'IN_FLIGHT' | 'SETTLED' | 'REJECTED' | 'PARKED'
  attempts: number;
  txid: string | null;
  effectiveDate: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

Now let me write the full test file. I need to be careful about:
- Using `.js` extensions on imports (fixes the compiler errors)
- Testing behaviour with proper assertions
- Not just asserting that a call happened

Let me also think about the `isPastPublishingLag` logic. The plan says: "An order with effectiveDate D is 'past lag' iff now >= D + 24 h + 30 min". So if effectiveDate is 2024-01-01, past lag means now >= 2024-01-02T00:30:00Z.

For the tests, I'll use a fixed date and manipulate `now` by mocking Date or by passing it where possible. Since `isPastPublishingLag` takes an optional `now` parameter, I can control it. But it's private... I'll need to control time via `vi.useFakeTimers()` or by setting up the scenario so that the effective date is far enough in the past.

Actually, the simplest approach: for "past lag" tests, use an effective date that's clearly in the past (e.g., yesterday). For "not yet past lag" tests, use today's date. That way I don't need to mock time.

Wait, but the reconcile method takes a `date: string` parameter and internally computes the effectiveDate. So I control the date passed to reconcile. Let me use:
- Past lag: `reconcile('2024-01-01')` - clearly in the past
- Not yet past lag: use today's date or a future date

Actually, let me think more carefully. The `isPastPublishingLag` check is: `now >= effectiveDate + 24h + 30min`. If I use a date like '2024-01-01', then past lag threshold is '2024-01-02T00:30:00Z'. Since "now" will be whenever the test runs (2025), it will definitely be past lag.

For "not yet past lag", I need a date where `now < effectiveDate + 24h + 30min`. That means the effective date needs to be within the last 24.5 hours. I can compute that dynamically: `new Date(Date.now() - 10 * 60 * 1000)` (10 minutes ago) formatted as a date string.

Let me structure the tests now. I'll create helper functions to make mock orders.

Let me also reconsider - the repository's `transition` method signature is:
```typescript
transition(id: string, from: OrderStatus, to: OrderStatus, patch?: Partial<Pick<Order, 'attempts' | 'txid'>>): Promise<boolean>;
```

I need to mock this properly. The mock should return `true` when the transition is valid (status matched) and `false` otherwise. For simplicity in tests, I'll just have it return `true` by default (simulating a successful transition) unless I need to test the idempotency case.

Let me write this out now:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { PayoutsService } from '../src/payouts/payouts.service.js';
import type { BankClient, BankSendResult, BankSettlement } from '../src/payouts/bank-client.js';
import type { PayoutsRepository } from '../src/payouts/payouts.repository.js';
```

Hmm, but I also need to import `OrderStatus` or just use string literals. Since the enum values are strings (`'PENDING'`, `'IN_FLIGHT'`, etc.), I can just use string literals in my mock data.

Actually wait - let me look at the plan more carefully. It says `OrderStatus` is a Prisma enum. In Prisma, enums are generated as TypeScript string literal types or const objects. The values would be like `'PENDING'`, `'IN_FLIGHT'`, etc.

For the test, I'll just use string literals since they match the enum values.

Now let me think about what the `PayoutsRepository` type looks like for mocking. The plan shows:

```typescript
export class PayoutsRepository {
  constructor(private readonly prisma: PrismaClient) {}
  findPending(effectiveDate: Date): Promise<...>;
  findInFlight(effectiveDate: Date): Promise<...>;
  findByTxid(txid: string): Promise<... | null>;
  transition(id, from, to, patch?): Promise<boolean>;
}
```

I'll create a mock object that implements these methods. I don't need to import the actual class - just use it as a type for the mock.

Actually, I should import it as a type to use it in type assertions. Let me use `import type { PayoutsRepository } from '../src/payouts/payouts.repository.js';`

Now let me write the complete test:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { PayoutsService } from '../src/payouts/payouts.service.js';
import type { BankClient, BankSendResult, BankSettlement } from '../src/payouts/bank-client.js';
import type { PayoutsRepository } from '../src/payouts/payouts.repository.js';

interface MockOrder {
  id: string;
  amountCents: number;
  bankKey: string;
  status: string;
  attempts: number;
  txid: string | null;
  effectiveDate: Date;
  createdAt: Date;
  updatedAt: Date;
}

function makeOrder(overrides: Partial<MockOrder> = {}): MockOrder {
  return {
    id: 'order-1',
    amountCents: 5000,
    bankKey: 'key-abc',
    status: 'PENDING',
    attempts: 0,
    txid: null,
    effectiveDate: new Date('2024-01-01T00:00:00Z'),
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeRepo(orders: MockOrder[]): PayoutsRepository & { transition: ReturnType<typeof vi.fn> } {
  return {
    findPending: vi.fn().mockResolvedValue(orders),
    findInFlight: vi.fn().mockResolvedValue(orders.filter(o => o.status === 'IN_FLIGHT')),
    findByTxid: vi.fn().mockResolvedValue(null),
    transition: vi.fn().mockResolvedValue(true),
  } as any;
}

function makeBank(overrides: Partial<Record<'send' | 'getStatement', any>> = {}): BankClient & { send: ReturnType<typeof vi.fn>; getStatement: ReturnType<typeof vi.fn> } {
  return {
    send: vi.fn().mockResolvedValue({ kind: 'accepted' }),
    getStatement: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as any;
}
```

Wait, I'm using `as any` which is a bit ugly. Let me think of a cleaner way... Actually for tests, using `as any` or `as unknown as BankClient` is common practice. Let me just use a straightforward mock object and cast it.

Let me reconsider the structure. I'll write clean tests:

Actually, let me think about test 9 (reconcile idempotency). The plan says "running reconcile twice for the same date does not double-settle or double-park; counts on second run are zero." 

For this to work, the second run of reconcile should find that the orders are no longer IN_FLIGHT (they're now SETTLED or PARKED). So `findInFlight` on the second run should return an empty array. I can simulate this by having the mock's `findInFlight` return different values on successive calls.

Let me also think about test 11 (TXID determinism). The plan says "calling `deriveTxid` with same order ID + date yields the same 32-char hex string across calls." Since `deriveTxid` is private, I'll test it indirectly: call `executePayments` twice with the same order and verify the txid passed to `bank.send` is the same both times. But wait, after the first call, the order status changes to IN_FLIGHT (if accepted), so the second call to `findPending` won't find it. 

Hmm, so I need a different approach. I could:
1. Access the private method via type assertion
2. Or set up the scenario where the order is proven absent (back to PENDING) and then resend

Actually, the simplest is just to access it: `(service as any).deriveTxid('order-1', new Date('2024-01-01T00:00:00Z'))` and call it twice, checking they're equal and 32 chars.

The plan explicitly lists this as a test, so I'll do it directly with a type assertion.

Let me now write the full file:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { PayoutsService } from '../src/payouts/payouts.service.js';
import type { BankClient, BankSettlement } from '../src/payouts/bank-client.js';
import type { PayoutsRepository } from '../src/payouts/payouts.repository.js';

// Helper: create a mock order
function makeOrder(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'order-1',
    amountCents: 5000,
    bankKey: 'key-abc',
    status: 'PENDING',
    attempts: 0,
    txid: null,
    effectiveDate: new Date('2024-01-01T00:00:00Z'),
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

// Helper: create a mock repository
function makeRepo(): {
  findPending: ReturnType<typeof vi.fn>;
  findInFlight: ReturnType<typeof vi.fn>;
  findByTxid: ReturnType<typeof vi.fn>;
  transition: ReturnType<typeof vi.fn>;
} {
  return {
    findPending: vi.fn().mockResolvedValue([]),
    findInFlight: vi.fn().mockResolvedValue([]),
    findByTxid: vi.fn().mockResolvedValue(null),
    transition: vi.fn().mockResolvedValue(true),
  };
}

// Helper: create a mock bank client
function makeBank(): {
  send: ReturnType<typeof vi.fn>;
  getStatement: ReturnType<typeof vi.fn>;
} {
  return {
    send: vi.fn().mockResolvedValue({ kind: 'accepted' }),
    getStatement: vi.fn().mockResolvedValue([]),
  };
}

function createService(repo: ReturnType<typeof makeRepo>, bank: ReturnType<typeof makeBank>): PayoutsService {
  return new PayoutsService(repo as unknown as PayoutsRepository, bank as unknown as BankClient);
}
```

Hmm wait, I'm overcomplicating this. Let me just write clean, straightforward tests. The key constraint from the compiler errors is that I need `.js` extensions on relative imports. Let me focus on getting that right and writing good behavioural tests.

Let me look at what I actually need to import:
- `PayoutsService` from `'../src/payouts/payouts.service.js'`
- Types from `'../src/payouts/bank-client.js'` (BankClient, BankSettlement)
- Type from `'../src/payouts/payouts.repository.js'` (PayoutsRepository)

Now for the actual test content. Let me be thorough but focused:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { PayoutsService } from '../src/payouts/payouts.service.js';
import type { BankClient, BankSettlement } from '../src/payouts/bank-client.js';
import type { PayoutsRepository } from '../src/payouts/payouts.repository.js';

const JAN_1 = new Date('2024-01-01T00:00:00Z');

function order(over: Partial<Record<string, any>> = {}) {
  return {
    id: 'ord-1',
    amountCents: 5000,
    bankKey: 'acct-1',
    status: 'PENDING',
    attempts: 0,
    txid: null,
    effectiveDate: JAN_1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function mockRepo() {
  return {
    findPending: vi.fn().mockResolvedValue([]),
    findInFlight: vi.fn().mockResolvedValue([]),
    findByTxid: vi.fn().mockResolvedValue(null),
    transition: vi.fn().mockResolvedValue(true),
  };
}

function mockBank() {
  return {
    send: vi.fn().mockResolvedValue({ kind: 'accepted' }),
    getStatement: vi.fn().mockResolvedValue([]),
  };
}

function svc(repo = mockRepo(), bank = mockBank()) {
  return new PayoutsService(repo as unknown as PayoutsRepository, bank as unknown as BankClient);
}
```

Now the tests. Let me go through each one:

**Test 1: Timeout-but-settled (no resend)**
- Setup: Order is IN_FLIGHT with a txid (simulating a timeout that actually landed)
- reconcile finds the txid in the statement
- Result: transition called with (id, 'IN_FLIGHT', 'SETTLED'), result.settled === 1

**Test 2: Proven-absent (resend, same txid)**
- Setup: Order is IN_FLIGHT with attempts=1, not in statement, past lag
- Result: transition called with (id, 'IN_FLIGHT', 'PENDING'), result.provenAbsent === 1
- Also verify the txid is preserved (it stays on the order)

**Test 3: Attempt exhaustion**
- Setup: Order is IN_FLIGHT with attempts=5, not in statement, past lag
- Result: transition called with (id, 'IN_FLIGHT', 'PARKED'), result.parked === 1

**Test 4: Accepted response**
- Setup: Order is PENDING, bank returns accepted
- Result: transition called with (id, 'PENDING', 'IN_FLIGHT', { txid: <some string>, attempts: 1 })

**Test 5: Duplicate response**
- Setup: Order is PENDING, bank returns duplicate
- Result: same as accepted

**Test 6: Transient error**
- Setup: Order is PENDING, bank returns transient
- Result: transition NOT called, order stays PENDING

**Test 7: Permanent rejection**
- Setup: Order is PENDING, bank returns permanent_rejection
- Result: transition called with (id, 'PENDING', 'REJECTED')

**Test 8: Not-yet-past-lag**
- Setup: Order is IN_FLIGHT, not in statement, but effective date is recent (within lag)
- Result: transition NOT called, order stays IN_FLIGHT

**Test 9: Reconcile idempotency**
- Setup: First run settles an order; second run finds no IN_FLIGHT orders
- Result: Second run has settled=0, provenAbsent=0, parked=0

**Test 10: Amount mismatch**
- Setup: Order IN_FLIGHT with amountCents=5000, statement has same txid but amountCents=6000
- Result: transition NOT called with SETTLED, order remains IN_FLIGHT

**Test 11: TXID determinism**
- Call deriveTxid twice with same args, expect same result, 32 hex chars

**Test 12: Bank network error on send**
- Setup: Order PENDING, bank.send throws
- Result: transition called with (id, 'PENDING', 'IN_FLIGHT', { txid: ..., attempts: 1 })

Let me now write all of these out properly. I need to be careful about:
- For test 8, I need a date that's "not past lag". The lag is 24h + 30min from effective date. So if I use today's date, `now < today + 24h + 30min` is always true. I'll compute today's date dynamically.
- For test 9, I need to simulate two runs. First run: findInFlight returns the order, it gets settled. Second run: findInFlight returns empty (because the order is now SETTLED).

Let me write this out:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { PayoutsService } from '../src/payouts/payouts.service.js';
import type { BankClient, BankSettlement } from '../src/payouts/bank-client.js';
import type { PayoutsRepository } from '../src/payouts/payouts.repository.js';

const PAST_DATE = '2024-01-01';
const PAST_DATE_D = new Date('2024-01-01T00:00:00Z');

function order(over: Record<string, any> = {}) {
  return {
    id: 'ord-1',
    amountCents: 5000,
    bankKey: 'acct-1',
    status: 'PENDING',
    attempts: 0,
    txid: null,
    effectiveDate: PAST_DATE_D,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function mockRepo() {
  return {
    findPending: vi.fn().mockResolvedValue([]),
    findInFlight: vi.fn().mockResolvedValue([]),
    findByTxid: vi.fn().mockResolvedValue(null),
    transition: vi.fn().mockResolvedValue(true),
  };
}

function mockBank() {
  return {
    send: vi.fn().mockResolvedValue({ kind: 'accepted' }),
    getStatement: vi.fn().mockResolvedValue([]),
  };
}

function makeService(repo = mockRepo(), bank = mockBank()): PayoutsService {
  return new PayoutsService(repo as unknown as PayoutsRepository, bank as unknown as BankClient);
}

describe('executePayments', () => {
  it('accepted: transitions PENDING to IN_FLIGHT, stores txid, increments attempts', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    bank.send.mockResolvedValue({ kind: 'accepted' });
    repo.findPending.mockResolvedValue([order()]);

    const service = makeService(repo, bank);
    const result = await service.executePayments(PAST_DATE_D);

    expect(result.sent).toBe(1);
    expect(result.rejected).toBe(0);
    // The transition should be from PENDING to IN_FLIGHT with txid and attempts=1
    const transitionCall = repo.transition.mock.calls[0];
    expect(transitionCall[0]).toBe('ord-1');
    expect(transitionCall[1]).toBe('PENDING');
    expect(transitionCall[2]).toBe('IN_FLIGHT');
    expect(transitionCall[3]).toMatchObject({ attempts: 1 });
    // txid should be a non-null string
    expect(transitionCall[3].txid).toBeTypeOf('string');
    expect((transitionCall[3].txid as string).length).toBe(32);
  });

  it('duplicate: transitions PENDING to IN_FLIGHT same as accepted', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    bank.send.mockResolvedValue({ kind: 'duplicate', originalAcceptedAt: new Date() });
    repo.findPending.mockResolvedValue([order()]);

    const service = makeService(repo, bank);
    const result = await service.executePayments(PAST_DATE_D);

    expect(result.sent).toBe(1);
    expect(repo.transition).toHaveBeenCalledWith(
      'ord-1', 'PENDING', 'IN_FLIGHT',
      expect.objectContaining({ attempts: 1, txid: expect.any(String) })
    );
  });

  it('transient error: status remains PENDING, attempts unchanged', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    bank.send.mockResolvedValue({ kind: 'transient', reason: 'timeout' });
    repo.findPending.mockResolvedValue([order()]);

    const service = makeService(repo, bank);
    const result = await service.executePayments(PAST_DATE_D);

    expect(result.sent).toBe(0);
    expect(result.rejected).toBe(0);
    // No transition should have been called
    expect(repo.transition).not.toHaveBeenCalled();
  });

  it('permanent rejection: transitions PENDING to REJECTED', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    bank.send.mockResolvedValue({ kind: 'permanent_rejection', code: 'BAD_KEY', reason: 'invalid' });
    repo.findPending.mockResolvedValue([order()]);

    const service = makeService(repo, bank);
    const result = await service.executePayments(PAST_DATE_D);

    expect(result.sent).toBe(0);
    expect(result.rejected).toBe(1);
    expect(repo.transition).toHaveBeenCalledWith('ord-1', 'PENDING', 'REJECTED');
  });

  it('bank network error: treated as timeout, transitions to IN_FLIGHT with incremented attempts', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    bank.send.mockRejectedValue(new Error('network unreachable'));
    repo.findPending.mockResolvedValue([order()]);

    const service = makeService(repo, bank);
    const result = await service.executePayments(PAST_DATE_D);

    expect(result.sent).toBe(1);
    expect(repo.transition).toHaveBeenCalledWith(
      'ord-1', 'PENDING', 'IN_FLIGHT',
      expect.objectContaining({ attempts: 1, txid: expect.any(String) })
    );
  });

  it('reuses existing txid on resend', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    bank.send.mockResolvedValue({ kind: 'accepted' });
    const existingTxid = 'a'.repeat(32);
    repo.findPending.mockResolvedValue([order({ txid: existingTxid, attempts: 1 })]);

    const service = makeService(repo, bank);
    await service.executePayments(PAST_DATE_D);

    // The txid sent to the bank should be the existing one
    expect(bank.send).toHaveBeenCalledWith(
      expect.objectContaining({ txid: existingTxid })
    );
  });
});

describe('reconcile', () => {
  it('timeout-but-settled: IN_FLIGHT order found in statement is settled, no resend', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    const txid = 'b'.repeat(32);
    repo.findInFlight.mockResolvedValue([order({ status: 'IN_FLIGHT', txid })]);
    bank.getStatement.mockResolvedValue([
      { txid, amountCents: 5000, settledAt: new Date() },
    ]);

    const service = makeService(repo, bank);
    const result = await service.reconcile(PAST_DATE);

    expect(result.settled).toBe(1);
    expect(result.provenAbsent).toBe(0);
    expect(result.parked).toBe(0);
    expect(repo.transition).toHaveBeenCalledWith('ord-1', 'IN_FLIGHT', 'SETTLED');
  });

  it('proven-absent with attempts remaining: returns to PENDING, same txid retained', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    const txid = 'c'.repeat(32);
    repo.findInFlight
      .mockResolvedValueOnce([order({ status: 'IN_FLIGHT', txid, attempts: 1 })])
      .mockResolvedValueOnce([]); // absence phase re-fetch: no longer IN_FLIGHT after transition
    bank.getStatement.mockResolvedValue([]);

    const service = makeService(repo, bank);
    const result = await service.reconcile(PAST_DATE);

    expect(result.settled).toBe(0);
    expect(result.provenAbsent).toBe(1);
    expect(result.parked).toBe(0);
    // Should transition back to PENDING, not increment attempts further
    expect(repo.transition).toHaveBeenCalledWith('ord-1', 'IN_FLIGHT', 'PENDING');
  });

  it('attempt exhaustion: IN_FLIGHT with attempts=5 and past lag becomes PARKED', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    const txid = 'd'.repeat(32);
    repo.findInFlight
      .mockResolvedValueOnce([order({ status: 'IN_FLIGHT', txid, attempts: 5 })])
      .mockResolvedValueOnce([]);
    bank.getStatement.mockResolvedValue([]);

    const service = makeService(repo, bank);
    const result = await service.reconcile(PAST_DATE);

    expect(result.parked).toBe(1);
    expect(result.settled).toBe(0);
    expect(result.provenAbsent).toBe(0);
    expect(repo.transition).toHaveBeenCalledWith('ord-1', 'IN_FLIGHT', 'PARKED');
  });

  it('not-yet-past-lag: IN_FLIGHT order is left untouched', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const todayD = new Date(`${today}T00:00:00Z`);
    const txid = 'e'.repeat(32);
    repo.findInFlight.mockResolvedValue([order({ status: 'IN_FLIGHT', txid, effectiveDate: todayD })]);
    bank.getStatement.mockResolvedValue([]);

    const service = makeService(repo, bank);
    const result = await service.reconcile(today);

    expect(result.settled).toBe(0);
    expect(result.provenAbsent).toBe(0);
    expect(result.parked).toBe(0);
    expect(repo.transition).not.toHaveBeenCalled();
  });

  it('idempotency: second run produces zero counts', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    const txid = 'f'.repeat(32);
    // First run: finds the IN_FLIGHT order, settles it
    repo.findInFlight
      .mockResolvedValueOnce([order({ status: 'IN_FLIGHT', txid })])
      .mockResolvedValueOnce([]) // absence phase after settling
      .mockResolvedValueOnce([]) // second run: no IN_FLIGHT orders
    bank.getStatement.mockResolvedValue([
      { txid, amountCents: 5000, settledAt: new Date() },
    ]);

    const service = makeService(repo, bank);
    const first = await service.reconcile(PAST_DATE);
    const second = await service.reconcile(PAST_DATE);

    expect(first.settled).toBe(1);
    expect(second.settled).toBe(0);
    expect(second.provenAbsent).toBe(0);
    expect(second.parked).toBe(0);
  });

  it('amount mismatch: order is NOT settled', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    const txid = 'g'.repeat(32);
    repo.findInFlight.mockResolvedValue([order({ status: 'IN_FLIGHT', txid, amountCents: 5000 })]);
    bank.getStatement.mockResolvedValue([
      { txid, amountCents: 6000, settledAt: new Date() }, // different amount!
    ]);

    const service = makeService(repo, bank);
    const result = await service.reconcile(PAST_DATE);

    expect(result.settled).toBe(0);
    // Should NOT have transitioned to SETTLED
    expect(repo.transition).not.toHaveBeenCalledWith('ord-1', 'IN_FLIGHT', 'SETTLED');
  });
});

describe('deriveTxid', () => {
  it('is deterministic: same inputs yield same 32-char hex output', () => {
    const repo = mockRepo();
    const bank = mockBank();
    const service = makeService(repo, bank);

    // Access private method for unit testing
    const derive = (service as any).deriveTxid;
    const txid1 = derive('ord-1', PAST_DATE_D);
    const txid2 = derive('ord-1', PAST_DATE_D);

    expect(txid1).toBe(txid2);
    expect(txid1).toMatch(/^[0-9a-f]{32}$/);
  });

  it('differs for different order IDs', () => {
    const service = makeService();
    const derive = (service as any).deriveTxid;
    const txid1 = derive('ord-1', PAST_DATE_D);
    const txid2 = derive('ord-2', PAST_DATE_D);

    expect(txid1).not.toBe(txid2);
  });
});
```

Wait, I need to double-check something. The plan says for the absence phase in reconcile: "re-fetch `repo.findInFlight(effectiveDate)` (to exclude those just settled)". So the flow is:
1. First `findInFlight` call → match phase
2. Second `findInFlight` call → absence phase

For the "proven-absent" test, after the match phase finds nothing (order not in statement), the absence phase re-fetches. At that point, the order is still IN_FLIGHT (it wasn't settled), so it should appear in the second fetch too. Wait, that doesn't make sense with my mock setup.

Let me re-read the plan:
- Match phase: `repo.findInFlight(effectiveDate)` → for each, if in statement, settle it
- Absence phase: re-fetch `repo.findInFlight(effectiveDate)` → for each remaining, check lag and transition

So the re-fetch is to get a fresh view after the match phase may have settled some. In my "proven-absent" test, the order is NOT in the statement, so it won't be settled in the match phase. It will still be IN_FLIGHT when the absence phase re-fetches. So both calls to `findInFlight` should return the same order.

Let me fix my mocks:

For "proven-absent":
- First `findInFlight` (match phase): returns the order (not in statement, so not settled)
- Second `findInFlight` (absence phase): returns the order (still IN_FLIGHT)

For "attempt exhaustion":
- Same pattern

For "timeout-but-settled":
- First `findInFlight` (match phase): returns the order (in statement, settled)
- Second `findInFlight` (absence phase): returns empty (order is now SETTLED, not IN_FLIGHT anymore)

For "not-yet-past-lag":
- First `findInFlight` (match phase): returns the order (not in statement)
- Second `findInFlight` (absence phase): returns the order (still IN_FLIGHT, but not past lag, so skipped)

For "idempotency":
- First run, first `findInFlight`: returns order (settled)
- First run, second `findInFlight`: empty
- Second run, first `findInFlight`: empty (no IN_FLIGHT orders)
- Second run, second `findInFlight`: empty

Let me fix the tests:

```typescript
it('proven-absent with attempts remaining: returns to PENDING, same txid retained', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    const txid = 'c'.repeat(32);
    // Match phase: order not in statement, stays IN_FLIGHT
    // Absence phase: order still IN_FLIGHT, past lag → PENDING
    repo.findInFlight
      .mockResolvedValueOnce([order({ status: 'IN_FLIGHT', txid, attempts: 1 })])
      .mockResolvedValueOnce([order({ status: 'IN_FLIGHT', txid, attempts: 1 })]);
    bank.getStatement.mockResolvedValue([]);

    const service = makeService(repo, bank);
    const result = await service.reconcile(PAST_DATE);

    expect(result.provenAbsent).toBe(1);
    expect(repo.transition).toHaveBeenCalledWith('ord-1', 'IN_FLIGHT', 'PENDING');
});
```

Hmm, but this is getting complicated with the mock setup. Let me simplify: for most tests, I'll just use `mockResolvedValue` (always returns the same thing) unless I specifically need different return values per call.

Actually, for the "timeout-but-settled" test, I need:
- Match phase finds the order and settles it
- Absence phase should NOT find it (it's settled now)

If I use `mockResolvedValue([order])` for both calls, the absence phase will also see it and might try to process it. But since the match phase already transitioned it to SETTLED, and the absence phase checks `isPastPublishingLag`... wait, the plan says the absence phase operates on IN_FLIGHT orders. If the mock always returns the same list, the absence phase will see an order it thinks is IN_FLIGHT.

But in reality, after the transition, the order would be SETTLED, so a fresh `findInFlight` query wouldn't return it. So I DO need different mock values for the two calls in the "settled" case.

OK let me be more careful:

For tests where an order gets settled in the match phase, I need:
- `findInFlight` call 1: returns the order
- `findInFlight` call 2: returns empty (order is now SETTLED)

For tests where an order is NOT settled (proven absent, not past lag, amount mismatch):
- `findInFlight` call 1: returns the order (match phase, not in statement or amount mismatch)
- `findInFlight` call 2: returns the order (absence phase, still IN_FLIGHT)

Let me rewrite with this in mind.

Actually, I realize I should also think about whether the "amount mismatch" case affects the absence phase. If the order has an amount mismatch in the match phase, it's NOT settled. So in the absence phase, it's still IN_FLIGHT. But it IS in the statement (just with wrong amount). The absence phase logic says "not found in statement + past lag → transition". Since it IS found (just with wrong amount), does the absence phase skip it?

Re-reading the plan: "Absence phase — re-fetch `repo.findInFlight(effectiveDate)` (to exclude those just settled): For each remaining order: If `!isPastPublishingLag(effectiveDate)` → skip. Else: ..."

It doesn't say "if not in statement" explicitly for the absence phase. It says "for each remaining order" (i.e., still IN_FLIGHT after match phase). Then it checks lag. If past lag, it transitions based on attempts.

Wait, that means even if an order IS in the statement but had an amount mismatch (and thus wasn't settled), the absence phase would still process it and potentially move it to PENDING or PARKED. That seems wrong...

Let me re-read more carefully: "re-fetch `repo.findInFlight(effectiveDate)` (to exclude those just settled)". The parenthetical explains WHY they re-fetch: to exclude those just settled. It doesn't say they filter by "not in statement". 

But logically, if an order IS in the statement (even with wrong amount), we shouldn't treat it as "proven absent". The absence should mean "not in the statement at all".

I think the plan's description is a bit ambiguous here. Let me re-read: "re-fetch `repo.findInFlight(effectiveDate)` (to exclude those just settled): For each remaining order: If !isPastPublishingLag(effectiveDate) → skip (cannot yet prove absence). Else: newAttempts = order.attempts. If newAttempts >= 5 → PARKED. Else → PENDING."

I think the intent is that the absence phase only processes orders that are NOT in the statement. The "re-fetch to exclude those just settled" is an optimization (you already know which ones were settled, so re-fetching gives you only the non-settled ones). But you also need to exclude those that WERE in the statement (even if with amount mismatch).

Actually, I think the simplest interpretation that makes sense is: the absence phase processes orders that are still IN_FLIGHT AND not present in the statement. The re-fetch is just to get a clean list after the match phase modifications.

For my tests, the "amount mismatch" test should verify that the order is NOT moved to PENDING or PARKED either. Let me add that assertion.

But wait - if the plan's implementation doesn't check "not in statement" in the absence phase, then my test might be wrong. Let me look at this from the perspective of what makes sense behaviorally:

If an order's txid appears in the statement with a different amount, that's a data integrity issue. We shouldn't:
1. Settle it (amount doesn't match) ✓
2. Treat it as "proven absent" and resend (it IS present, just wrong)

So the correct behavior is to leave it IN_FLIGHT and raise an alarm. My test should verify it's not transitioned at all.

For the test to work correctly, I need the implementation to check "not in statement" in the absence phase. If it doesn't, then my test would fail against the actual implementation. But since I'm writing the test based on the plan's intent (which is clear: "proven absent" means actually absent), I'll write the test to expect no transition.

Actually, let me look at this differently. The plan says the absence phase processes "each remaining order" from the re-fetched IN_FLIGHT list. If the implementation simply iterates all IN_FLIGHT orders in the absence phase without checking if they're in the statement, then an order with amount mismatch would be moved to PENDING/PARKED. That would be a bug.

But my job is to write tests that match the plan's intent. The plan says "reconcile proves it is absent from the statement past the publishing lag" for resend. So "absent from the statement" is the key condition. I'll write the test to expect no transition for the amount mismatch case.

If the actual implementation doesn't filter by "not in statement" in the absence phase, that's an implementation bug, not a test bug. My test correctly captures the intended behavior.

OK, I think I've been overthinking this. Let me just write the tests clearly and move on.

One more thing: for the "not-yet-past-lag" test, I need to use a date that's within the lag window. The lag is 24h + 30min from the effective date. So if effective date is today (midnight UTC), then past lag is tomorrow at 00:30 UTC. Since "now" (test execution time) will be sometime today, it's before past lag. Good.

But wait - what if the test runs at a time where "now" has already passed tomorrow's 00:30? That's impossible since "now" is today and "tomorrow 00:30" is in the future. Unless the test runs at exactly midnight... which is extremely unlikely. I'll use today's date and it should be safe.

Actually, to be extra safe, let me use a date that's definitely within the lag: `new Date(Date.now() - 1 * 60 * 60 * 1000)` (1 hour ago). Then the lag threshold is `now - 1h + 24h + 30min = now + 23.5h`, which is definitely in the future.

But the reconcile method takes a date string (YYYY-MM-DD) and computes the effective date as midnight UTC of that day. So I need to format the date properly. Let me just use today's date:

```typescript
const today = new Date();
const todayStr = today.toISOString().slice(0, 10);
```

This gives us the current UTC date. The effective date will be midnight UTC of today. Past lag = midnight + 24h + 30min = tomorrow 00:30 UTC. Since we're running the test today, now < tomorrow 00:30 UTC. ✓

Let me finalize my test file now. I'll be clean and thorough.

One more consideration: the `transition` method's fourth parameter. Looking at the plan:
```
transition(id, from, to, patch?: Partial<Pick<Order, 'attempts' | 'txid'>>)
```

So for the "accepted" test, the call would be:
`transition('ord-1', 'PENDING', 'IN_FLIGHT', { txid: '...', attempts: 1 })`

For the "reconcile settled" test:
`transition('ord-1', 'IN_FLIGHT', 'SETTLED')` (no patch)

For the "proven absent" test:
`transition('ord-1', 'IN_FLIGHT', 'PENDING')` (no patch, since attempts stays the same)

For the "parked" test:
`transition('ord-1', 'IN_FLIGHT', 'PARKED')` (no patch)

Let me verify: when an order goes back to PENDING after being proven absent, does the plan say to increment or reset attempts? Re-reading: "PENDING ──send timeout (no resp)──▶ IN_FLIGHT ──reconcile: absent + past lag──▶ PENDING (attempts<5)". The attempts counter is "Committed send attempts" and it's not reset when going back to PENDING. It only increments on the next send. So no patch needed for the IN_FLIGHT → PENDING transition.

OK, I'm confident now. Let me write the final version.

Wait, one more thing about the `bank.send` call in the "reuses existing txid" test. The plan says:
"a. Compute `txid = deriveTxid(order.id, effectiveDate)`. If `order.txid` is already set, reuse it (resend path)."

So if the order already has a txid, we use that instead of deriving a new one. My test verifies this by checking that `bank.send` is called with the existing txid.

Let me finalize.
```

## reply

```typescript
import { describe, it, expect, vi } from 'vitest';
import { PayoutsService } from '../src/payouts/payouts.service.js';
import type { BankClient, BankSettlement } from '../src/payouts/bank-client.js';
import type { PayoutsRepository } from '../src/payouts/payouts.repository.js';

const PAST_DATE = '2024-01-01';
const PAST_DATE_D = new Date('2024-01-01T00:00:00Z');

function order(over: Record<string, any> = {}) {
  return {
    id: 'ord-1',
    amountCents: 5000,
    bankKey: 'acct-1',
    status: 'PENDING',
    attempts: 0,
    txid: null,
    effectiveDate: PAST_DATE_D,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function mockRepo() {
  return {
    findPending: vi.fn().mockResolvedValue([]),
    findInFlight: vi.fn().mockResolvedValue([]),
    findByTxid: vi.fn().mockResolvedValue(null),
    transition: vi.fn().mockResolvedValue(true),
  };
}

function mockBank() {
  return {
    send: vi.fn().mockResolvedValue({ kind: 'accepted' }),
    getStatement: vi.fn().mockResolvedValue([]),
  };
}

function makeService(repo = mockRepo(), bank = mockBank()): PayoutsService {
  return new PayoutsService(repo as unknown as PayoutsRepository, bank as unknown as BankClient);
}

describe('executePayments', () => {
  it('accepted: transitions PENDING to IN_FLIGHT, stores txid, increments attempts', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    bank.send.mockResolvedValue({ kind: 'accepted' });
    repo.findPending.mockResolvedValue([order()]);

    const service = makeService(repo, bank);
    const result = await service.executePayments(PAST_DATE_D);

    expect(result.sent).toBe(1);
    expect(result.rejected).toBe(0);

    const [, from, to, patch] = repo.transition.mock.calls[0];
    expect(repo.transition.mock.calls[0][0]).toBe('ord-1');
    expect(from).toBe('PENDING');
    expect(to).toBe('IN_FLIGHT');
    expect(patch.attempts).toBe(1);
    expect(patch.txid).toMatch(/^[0-9a-f]{32}$/);
  });

  it('duplicate: transitions PENDING to IN_FLIGHT, increments attempts', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    bank.send.mockResolvedValue({ kind: 'duplicate', originalAcceptedAt: new Date() });
    repo.findPending.mockResolvedValue([order()]);

    const service = makeService(repo, bank);
    const result = await service.executePayments(PAST_DATE_D);

    expect(result.sent).toBe(1);
    const [, from, to, patch] = repo.transition.mock.calls[0];
    expect(from).toBe('PENDING');
    expect(to).toBe('IN_FLIGHT');
    expect(patch.attempts).toBe(1);
  });

  it('transient error: no transition, order remains PENDING with attempts unchanged', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    bank.send.mockResolvedValue({ kind: 'transient', reason: 'upstream timeout' });
    repo.findPending.mockResolvedValue([order()]);

    const service = makeService(repo, bank);
    const result = await service.executePayments(PAST_DATE_D);

    expect(result.sent).toBe(0);
    expect(result.rejected).toBe(0);
    expect(repo.transition).not.toHaveBeenCalled();
  });

  it('permanent rejection: transitions PENDING to REJECTED', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    bank.send.mockResolvedValue({ kind: 'permanent_rejection', code: 'BAD_KEY', reason: 'invalid key' });
    repo.findPending.mockResolvedValue([order()]);

    const service = makeService(repo, bank);
    const result = await service.executePayments(PAST_DATE_D);

    expect(result.sent).toBe(0);
    expect(result.rejected).toBe(1);
    const [id, from, to] = repo.transition.mock.calls[0];
    expect(id).toBe('ord-1');
    expect(from).toBe('PENDING');
    expect(to).toBe('REJECTED');
  });

  it('bank network error on send: treated as timeout, transitions to IN_FLIGHT with incremented attempts', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    bank.send.mockRejectedValue(new Error('ECONNRESET'));
    repo.findPending.mockResolvedValue([order()]);

    const service = makeService(repo, bank);
    const result = await service.executePayments(PAST_DATE_D);

    expect(result.sent).toBe(1);
    const [id, from, to, patch] = repo.transition.mock.calls[0];
    expect(id).toBe('ord-1');
    expect(from).toBe('PENDING');
    expect(to).toBe('IN_FLIGHT');
    expect(patch.attempts).toBe(1);
    expect(patch.txid).toMatch(/^[0-9a-f]{32}$/);
  });

  it('reuses existing txid on resend', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    bank.send.mockResolvedValue({ kind: 'accepted' });
    const existingTxid = 'a'.repeat(32);
    repo.findPending.mockResolvedValue([order({ txid: existingTxid, attempts: 1 })]);

    const service = makeService(repo, bank);
    await service.executePayments(PAST_DATE_D);

    expect(bank.send).toHaveBeenCalledWith(
      expect.objectContaining({ txid: existingTxid, amountCents: 5000, bankKey: 'acct-1' }),
    );
  });
});

describe('reconcile', () => {
  it('timeout-but-settled: IN_FLIGHT order found in statement is settled, no resend', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    const txid = 'b'.repeat(32);
    // Match phase: order is IN_FLIGHT and present in statement → settled
    // Absence phase: no remaining IN_FLIGHT orders
    repo.findInFlight
      .mockResolvedValueOnce([order({ status: 'IN_FLIGHT', txid })])
      .mockResolvedValueOnce([]);
    bank.getStatement.mockResolvedValue([
      { txid, amountCents: 5000, settledAt: new Date() } as BankSettlement,
    ]);

    const service = makeService(repo, bank);
    const result = await service.reconcile(PAST_DATE);

    expect(result.settled).toBe(1);
    expect(result.provenAbsent).toBe(0);
    expect(result.parked).toBe(0);

    const [id, from, to] = repo.transition.mock.calls[0];
    expect(id).toBe('ord-1');
    expect(from).toBe('IN_FLIGHT');
    expect(to).toBe('SETTLED');
  });

  it('proven-absent with attempts remaining: returns to PENDING, same txid retained', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    const txid = 'c'.repeat(32);
    // Match phase: not in statement
    // Absence phase: still IN_FLIGHT, past lag, attempts < 5 → PENDING
    repo.findInFlight
      .mockResolvedValueOnce([order({ status: 'IN_FLIGHT', txid, attempts: 1 })])
      .mockResolvedValueOnce([order({ status: 'IN_FLIGHT', txid, attempts: 1 })]);
    bank.getStatement.mockResolvedValue([]);

    const service = makeService(repo, bank);
    const result = await service.reconcile(PAST_DATE);

    expect(result.settled).toBe(0);
    expect(result.provenAbsent).toBe(1);
    expect(result.parked).toBe(0);

    const [id, from, to] = repo.transition.mock.calls[0];
    expect(id).toBe('ord-1');
    expect(from).toBe('IN_FLIGHT');
    expect(to).toBe('PENDING');
  });

  it('attempt exhaustion: IN_FLIGHT with attempts=5 past lag becomes PARKED', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    const txid = 'd'.repeat(32);
    repo.findInFlight
      .mockResolvedValueOnce([order({ status: 'IN_FLIGHT', txid, attempts: 5 })])
      .mockResolvedValueOnce([order({ status: 'IN_FLIGHT', txid, attempts: 5 })]);
    bank.getStatement.mockResolvedValue([]);

    const service = makeService(repo, bank);
    const result = await service.reconcile(PAST_DATE);

    expect(result.settled).toBe(0);
    expect(result.provenAbsent).toBe(0);
    expect(result.parked).toBe(1);

    const [id, from, to] = repo.transition.mock.calls[0];
    expect(id).toBe('ord-1');
    expect(from).toBe('IN_FLIGHT');
    expect(to).toBe('PARKED');
  });

  it('not-yet-past-lag: IN_FLIGHT order is left untouched', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    // Use today's date — past-lag threshold is tomorrow 00:30 UTC, so we are within lag
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayD = new Date(`${todayStr}T00:00:00Z`);
    const txid = 'e'.repeat(32);
    repo.findInFlight
      .mockResolvedValueOnce([order({ status: 'IN_FLIGHT', txid, effectiveDate: todayD })])
      .mockResolvedValueOnce([order({ status: 'IN_FLIGHT', txid, effectiveDate: todayD })]);
    bank.getStatement.mockResolvedValue([]);

    const service = makeService(repo, bank);
    const result = await service.reconcile(todayStr);

    expect(result.settled).toBe(0);
    expect(result.provenAbsent).toBe(0);
    expect(result.parked).toBe(0);
    expect(repo.transition).not.toHaveBeenCalled();
  });

  it('idempotency: second reconcile for same date yields zero counts', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    const txid = 'f'.repeat(32);
    // Run 1 match: finds order, settles it
    // Run 1 absence: empty (order now SETTLED)
    // Run 2 match: empty (no IN_FLIGHT)
    // Run 2 absence: empty
    repo.findInFlight
      .mockResolvedValueOnce([order({ status: 'IN_FLIGHT', txid })])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    bank.getStatement.mockResolvedValue([
      { txid, amountCents: 5000, settledAt: new Date() } as BankSettlement,
    ]);

    const service = makeService(repo, bank);
    const first = await service.reconcile(PAST_DATE);
    const second = await service.reconcile(PAST_DATE);

    expect(first.settled).toBe(1);
    expect(second.settled).toBe(0);
    expect(second.provenAbsent).toBe(0);
    expect(second.parked).toBe(0);
  });

  it('amount mismatch: order is NOT settled and NOT treated as absent', async () => {
    const repo = mockRepo();
    const bank = mockBank();
    const txid = 'g'.repeat(32);
    repo.findInFlight
      .mockResolvedValueOnce([order({ status: 'IN_FLIGHT', txid, amountCents: 5000 })])
      .mockResolvedValueOnce([order({ status: 'IN_FLIGHT', txid, amountCents: 5000 })]);
    bank.getStatement.mockResolvedValue([
      { txid, amountCents: 6000, settledAt: new Date() } as BankSettlement,
    ]);

    const service = makeService(repo, bank);
    const result = await service.reconcile(PAST_DATE);

    expect(result.settled).toBe(0);
    // Order must not be moved to PENDING or PARKED either
    expect(repo.transition).not.toHaveBeenCalled();
  });
});

describe('deriveTxid', () => {
  it('is deterministic: same inputs produce the same 32-char hex string', () => {
    const service = makeService();
    // ASSUMPTION: deriveTxid is private; accessing via type assertion to unit-test the derivation contract.
    const derive = (service as unknown as { deriveTxid: (id: string, d: Date) => string }).deriveTxid;
    const a = derive('ord-1', PAST_DATE_D);
    const b = derive('ord-1', PAST_DATE_D);

    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  it('differs for different order IDs', () => {
    const service = makeService();
    const derive = (service as unknown as { deriveTxid: (id: string, d: Date) => string }).deriveTxid;
    const a = derive('ord-1', PAST_DATE_D);
    const b = derive('ord-2', PAST_DATE_D);

    expect(a).not.toBe(b);
  });
});
```
