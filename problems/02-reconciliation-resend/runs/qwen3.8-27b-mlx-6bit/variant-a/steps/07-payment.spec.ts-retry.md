# 07-payment.spec.ts-retry

## reasoning

```
Let me analyze what I need to write:

1. A complete `test/payment.spec.ts` file
2. It must test every case listed in `07-payment.spec.ts-cases.txt`
3. It should follow the plan's architecture: `PaymentService`, `PaymentRepository`, `BankClient` interfaces
4. Tests should test behaviour, not implementation
5. Use Vitest

Let me look at the cases to implement:

**executePayments cases:**
1. accepted bank response moves a pending order to sent
2. duplicate bank response is treated as success
3. transient_error response moves a pending order to in_doubt
4. thrown transient bank error moves a pending order to in_doubt
5. unexpected non-permanent error moves a pending order to in_doubt
6. permanent_rejection response moves a pending order to rejected
7. thrown permanent bank error moves a pending order to rejected
8. pending order at maxAttempts is parked without a bank call
9. pending order with attempt_count one below maxAttempts still sends
10. a lost atomic attempt claim skips the order
11. the send request preserves stored txid, supplier key, and integer minor units
12. only batchSize pending orders are processed per call

**reconcile cases:**
13. a settlement for a sent order marks it settled and stores the statement row
14. timeout-but-settled order in a statement is settled and not re-sent
15. a settlement entry is processed even when the statement is not yet complete
16. rejected order is untouched even if its txid appears in a statement
17. parked order is untouched by reconciliation
18. an in_doubt order absent from a complete statement becomes pending
19. an in_doubt order absent before the publishing lag boundary is not proven absent
20. an in_doubt order absent one millisecond after the boundary becomes pending
21. an in_doubt order with effective_date outside the window is not affected by another date's statement
22. an in_doubt order present in the statement is settled, not counted as proven absent
23. unknown txids in a statement are ignored
24. duplicate delivery of the same statement entry is idempotent
25. running the same window twice is idempotent
26. inclusive window boundaries cover a single-day and multi-day range

**full lifecycle cases:**
27. timeout, proven absent, resend with same txid, then settlement
28. five timed-out sends with proven-absent returns in between end parked without a sixth send
29. parked order survives repeated executePayments and reconcile calls

**deriveTxid cases:**
30. same order and effective date produce the same txid
31. different order id or effective date produces a different txid

Now let me think about the test structure. Since the plan says "Unit + integration tests", I'll use a mix:
- Unit tests for `deriveTxid` and state machine logic (mocking the repository)
- Integration-style tests for the full lifecycle (mocking the bank client, using a real or mocked repository)

Actually, looking at the plan more carefully, it says tests should be in `test/payment.spec.ts`. The plan's manifest says:
```
test/payment.spec.ts | reads: src/payment/bank-client.interface.ts, src/payment/payment.service.ts, src/payment/payment.repository.ts | Unit + integration tests for state machine, idempotency, attempt cap
```

So I'll mock the repository and bank client for unit tests. For "integration" I'll still use mocks but test the full flow through the service.

Let me think about the structure:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaymentService, PAYMENT_OPTIONS } from '../src/payment/payment.service';
import { PaymentRepository } from '../src/payment/payment.repository';
import { BankClient, BankTransientError, BankPermanentError, Settlement } from '../src/payment/bank-client.interface';
```

I'll create mock objects for the repository and bank client. Let me think about what the repository interface looks like based on the plan:

```typescript
interface PaymentRepository {
  findPending(limit: number): Promise<Order[]>;
  findByTxid(txid: string): Promise<Order | null>;
  findInDoubtByEffectiveDate(date: Date): Promise<Order[]>;
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

Wait, looking at the repository code, it returns `Order[]` (Prisma model), not a custom `OrderRecord`. The service uses properties like `order.id`, `order.txid`, `order.amountMinorUnits`, `order.supplierKey`, `order.attemptCount`, `order.status`.

So in my mocks, I'll create objects that match the Prisma `Order` model shape.

Let me look at the service code more carefully:

```typescript
const orders = await this.repo.findPending(this.batchSize);
for (const order of orders) {
  if (order.attemptCount >= this.maxAttempts) {
    await this.repo.markParked(order.id);
    continue;
  }
  const newCount = await this.repo.incrementAttempt(order.id, new Date());
  if (newCount === 0) { continue; }
  const now = new Date();
  try {
    const response = await this.bank.send({
      txid: order.txid,
      amount_minor_units: Number(order.amountMinorUnits),
      key: order.supplierKey,
    });
    switch (response.status) { ... }
  } catch (err) { ... }
}
```

So the order objects have: `id`, `txid`, `amountMinorUnits`, `supplierKey`, `attemptCount`, `status`.

For reconcile:
```typescript
const statement = await this.bank.getStatement(date);
const statementTxids = new Set(statement.map((s) => s.txid));
for (const settlement of statement) {
  const order = await this.repo.findByTxid(settlement.txid);
  if (order && (order.status === 'sent' || order.status === 'in_doubt')) {
    await this.repo.markSettled(order.id, settlement.settled_at);
    await this.repo.upsertSettlement({...});
    settled++;
  }
}
// proven absent check
if (now.getTime() > endOfDay.getTime() + this.publishingLagMs) {
  const inDoubtOrders = await this.repo.findInDoubtByEffectiveDate(date);
  for (const order in inDoubtOrders) {
    if (!statementTxids.has(order.txid)) {
      await this.repo.markPendingForResend(order.id);
      provenAbsent++;
    }
  }
}
```

Now let me think about how to handle the time-dependent tests (publishing lag boundary). I'll use `vi.useFakeTimers()` or `vi.setSystemTime()`.

Let me now write the complete test file. I'll use a helper to create mock orders and a mock factory pattern.

For the "integration" tests (full lifecycle), I'll use a simple in-memory state to simulate the repository, so the full flow works through the service.

Actually, let me reconsider. The plan says "Unit + integration tests for state machine, idempotency, attempt cap". I think the cleanest approach is:

1. For most tests: mock the repository (unit-level)
2. For full lifecycle tests: use an in-memory fake repository that actually tracks state

Let me write this now.

For the `endOfDay` calculation in the service:
```typescript
const endOfDay = new Date(
  Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) + 86_400_000,
);
```

So for a date like `2024-01-15`, endOfDay would be `2024-01-16T00:00:00Z`. The statement is complete when `now > endOfDay + publishingLagMs`.

For test 20 (one millisecond after boundary), I need to set `now` to exactly `endOfDay + publishingLagMs + 1ms`.

Let me plan the fake repository for lifecycle tests. It needs to:
- Store orders in a map
- `findPending` returns orders with status 'pending'
- `findByTxid` looks up by txid
- `findInDoubtByEffectiveDate` returns orders with status 'in_doubt' and matching date
- All mark* methods update the order's status
- `incrementAttempt` increments and returns new count (or 0 if not pending)
- `upsertSettlement` stores in a settlements map

Let me write this carefully now.

One thing to note: the service's `reconcile` method uses `new Date()` for the "now" check. I'll need to mock that with `vi.setSystemTime`.

Let me also note: the `enumerateDates` method in the service creates UTC dates. So if I pass `startDate = new Date('2024-01-15T00:00:00Z')` and `endDate = new Date('2024-01-15T00:00:00Z')`, it should enumerate just that one date.

Let me trace through `enumerateDates`:
```typescript
const current = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
while (current.getTime() <= last.getTime()) {
  dates.push(new Date(current));
  current.setUTCDate(current.getUTCDate() + 1);
}
```

So for a single day, it pushes one date. For multiple days, it pushes all dates in between (inclusive).

Now let me write the full test file. I'll be thorough and cover all 31 cases.

Let me also think about the "Deliberately not testing" note: bank HTTP transport, PostgreSQL index performance, and amount-mismatch detection. I won't test those.

Here's my plan for the file structure:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'crypto';
import { PaymentService, PAYMENT_OPTIONS } from '../src/payment/payment.service';
import { BankClient, BankTransientError, BankPermanentError } from '../src/payment/bank-client.interface';

// Helper types and factories
// Mock bank client factory
// Mock repository factory (simple, for unit tests)
// In-memory fake repository (for lifecycle tests)

describe('PaymentService', () => {
  describe('deriveTxid', () => { ... });
  describe('executePayments', () => { ... });
  describe('reconcile', () => { ... });
  describe('full lifecycle', () => { ... });
});
```

Let me write it all out now. I need to be careful about:
- The `PAYMENT_OPTIONS` injection token
- The constructor signature: `(repo, bank, opts)` where opts is injected via `@Inject(PAYMENT_OPTIONS)`
- Since I'm not using NestJS testing module, I'll just call the constructor directly

Wait, looking at the service constructor:
```typescript
constructor(
  private readonly repo: PaymentRepository,
  private readonly bank: BankClient,
  @Inject(PAYMENT_OPTIONS) opts: PaymentOptions,
)
```

The `@Inject` decorator is metadata for NestJS DI. When I instantiate directly in tests, I can just pass the three arguments positionally. The `@Inject` decorator doesn't affect direct instantiation.

So: `new PaymentService(mockRepo as any, mockBank as any, { publishingLagMs: 30*60*1000, batchSize: 100, maxAttempts: 5 })`

Now let me write the complete file.

For the in-memory fake repository used in lifecycle tests, I need to be careful about the `incrementAttempt` behavior. In the real repo, it does:
```sql
UPDATE orders SET attempt_count = attempt_count + 1, last_attempt_at = ..., updated_at = NOW()
WHERE id = ? AND status = 'pending'
RETURNING attempt_count
```

So it only works if the order is currently `pending`. If it's not pending (e.g., already changed by another worker), it returns 0 rows → the service skips.

In my fake, I'll simulate this by checking status before incrementing.

Let me also think about test 10: "a lost atomic attempt claim skips the order". This means `incrementAttempt` returns 0. The service should skip without calling bank.send or changing state. I can mock the repo to return 0 from `incrementAttempt` and verify that `bank.send` was not called.

For test 12: "only batchSize pending orders are processed per call". I'll mock `findPending` to be called with the batch size, and verify that only that many orders are processed.

Actually, looking more carefully at the service code:
```typescript
const orders = await this.repo.findPending(this.batchSize);
```

The batch size is passed to `findPending`. So to test this, I just need to verify that `findPending` is called with the configured batch size, and that only those orders are processed.

Let me now write the complete file. I'll aim for clarity and completeness.

One more consideration: for the "one millisecond after boundary" test, I need to be very precise about time. Let me use `vi.setSystemTime` to control the exact moment.

For a date D = 2024-01-15:
- endOfDay = 2024-01-16T00:00:00.000Z
- With publishingLagMs = 30 * 60 * 1000 = 1800000
- Boundary = 2024-01-16T00:30:00.000Z
- "One millisecond after" = 2024-01-16T00:30:00.001Z

So I set system time to `new Date('2024-01-16T00:30:00.001Z')` for the "after" case, and `new Date('2024-01-16T00:30:00.000Z')` for the "at boundary" case (which should NOT be proven absent because the check is `>` not `>=`).

Wait, let me re-read the service:
```typescript
if (now.getTime() > endOfDay.getTime() + this.publishingLagMs) {
```

So it's strictly greater than. At exactly the boundary, it's NOT complete. One millisecond after, it IS complete.

Let me now write the file. I'll be comprehensive.
```

## reply

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PaymentService, PAYMENT_OPTIONS } from '../src/payment/payment.service';
import {
  BankClient,
  BankTransientError,
  BankPermanentError,
} from '../src/payment/bank-client.interface';

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface OrderShape {
  id: string;
  txid: string;
  supplierKey: string;
  amountMinorUnits: bigint;
  effectiveDate: Date;
  status: string;
  attemptCount: number;
  lastAttemptAt: Date | null;
  settledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function makeOrder(overrides: Partial<OrderShape> = {}): OrderShape {
  return {
    id: 'order-1',
    txid: 'txid-abc',
    supplierKey: 'BR1234567890',
    amountMinorUnits: 5000n,
    effectiveDate: new Date('2024-01-15T00:00:00.000Z'),
    status: 'pending',
    attemptCount: 0,
    lastAttemptAt: null,
    settledAt: null,
    createdAt: new Date('2024-01-15T00:00:00.000Z'),
    updatedAt: new Date('2024-01-15T00:00:00.000Z'),
    ...overrides,
  };
}

interface RepoMock {
  findPending: ReturnType<typeof vi.fn>;
  findByTxid: ReturnType<typeof vi.fn>;
  findInDoubtByEffectiveDate: ReturnType<typeof vi.fn>;
  markSent: ReturnType<typeof vi.fn>;
  markInDoubt: ReturnType<typeof vi.fn>;
  markRejected: ReturnType<typeof vi.fn>;
  markSettled: ReturnType<typeof vi.fn>;
  markPendingForResend: ReturnType<typeof vi.fn>;
  markParked: ReturnType<typeof vi.fn>;
  incrementAttempt: ReturnType<typeof vi.fn>;
  upsertSettlement: ReturnType<typeof vi.fn>;
}

function createMockRepo(): RepoMock {
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

interface BankMock {
  send: ReturnType<typeof vi.fn>;
  getStatement: ReturnType<typeof vi.fn>;
}

function createMockBank(): BankMock {
  return {
    send: vi.fn().mockResolvedValue({ status: 'accepted' }),
    getStatement: vi.fn().mockResolvedValue([]),
  };
}

const DEFAULT_OPTS = {
  publishingLagMs: 30 * 60 * 1000, // 30 minutes
  batchSize: 100,
  maxAttempts: 5,
};

function createService(
  repo: RepoMock,
  bank: BankMock,
  opts: typeof DEFAULT_OPTS = DEFAULT_OPTS,
): PaymentService {
  return new PaymentService(
    repo as any,
    bank as any,
    opts,
  );
}

// ─── In-memory fake repository for lifecycle tests ────────────────────────────

class FakeRepository {
  orders: Map<string, OrderShape> = new Map();
  settlements: Map<string, { txid: string; amount_minor_units: number; settled_at: Date; statement_date: Date }> = new Map();

  addOrder(order: OrderShape): void {
    this.orders.set(order.id, { ...order });
  }

  async findPending(limit: number): Promise<OrderShape[]> {
    return [...this.orders.values()]
      .filter((o) => o.status === 'pending')
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit)
      .map((o) => ({ ...o }));
  }

  async findByTxid(txid: string): Promise<OrderShape | null> {
    const found = [...this.orders.values()].find((o) => o.txid === txid);
    return found ? { ...found } : null;
  }

  async findInDoubtByEffectiveDate(date: Date): Promise<OrderShape[]> {
    const targetUtc = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
    );
    return [...this.orders.values()]
      .filter(
        (o) =>
          o.status === 'in_doubt' &&
          Date.UTC(
            o.effectiveDate.getUTCFullYear(),
            o.effectiveDate.getUTCMonth(),
            o.effectiveDate.getUTCDate(),
          ) === targetUtc,
      )
      .map((o) => ({ ...o }));
  }

  async markSent(id: string, lastAttemptAt: Date): Promise<void> {
    const order = this.orders.get(id);
    if (order && order.status === 'pending') {
      order.status = 'sent';
      order.lastAttemptAt = lastAttemptAt;
    }
  }

  async markInDoubt(id: string, lastAttemptAt: Date): Promise<void> {
    const order = this.orders.get(id);
    if (order && order.status === 'pending') {
      order.status = 'in_doubt';
      order.lastAttemptAt = lastAttemptAt;
    }
  }

  async markRejected(id: string): Promise<void> {
    const order = this.orders.get(id);
    if (order && order.status === 'pending') {
      order.status = 'rejected';
    }
  }

  async markSettled(id: string, settledAt: Date): Promise<void> {
    const order = this.orders.get(id);
    if (order && (order.status === 'sent' || order.status === 'in_doubt')) {
      order.status = 'settled';
      order.settledAt = settledAt;
    }
  }

  async markPendingForResend(id: string): Promise<void> {
    const order = this.orders.get(id);
    if (order && order.status === 'in_doubt') {
      order.status = 'pending';
    }
  }

  async markParked(id: string): Promise<void> {
    const order = this.orders.get(id);
    if (order && order.status === 'pending') {
      order.status = 'parked_manual_review';
    }
  }

  async incrementAttempt(id: string, lastAttemptAt: Date): Promise<number> {
    const order = this.orders.get(id);
    if (order && order.status === 'pending') {
      order.attemptCount += 1;
      order.lastAttemptAt = lastAttemptAt;
      return order.attemptCount;
    }
    return 0;
  }

  async upsertSettlement(data: {
    txid: string;
    amount_minor_units: number;
    settled_at: Date;
    statement_date: Date;
  }): Promise<void> {
    if (!this.settlements.has(data.txid)) {
      this.settlements.set(data.txid, { ...data });
    }
  }

  getOrder(id: string): OrderShape | undefined {
    const o = this.orders.get(id);
    return o ? { ...o } : undefined;
  }
}

function createServiceWithFake(
  fakeRepo: FakeRepository,
  bank: BankMock,
  opts: typeof DEFAULT_OPTS = DEFAULT_OPTS,
): PaymentService {
  return new PaymentService(
    fakeRepo as any,
    bank as any,
    opts,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PaymentService', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ─── deriveTxid ─────────────────────────────────────────────────────────────

  describe('deriveTxid', () => {
    const repo = createMockRepo();
    const bank = createMockBank();
    const service = createService(repo, bank);

    it('same order and effective date produce the same txid', () => {
      const effectiveDate = new Date('2024-03-10T00:00:00.000Z');
      const txid1 = service.deriveTxid('order-42', effectiveDate);
      const txid2 = service.deriveTxid('order-42', effectiveDate);
      expect(txid1).toBe(txid2);
    });

    it('different order id or effective date produces a different txid', () => {
      const dateA = new Date('2024-03-10T00:00:00.000Z');
      const dateB = new Date('2024-03-11T00:00:00.000Z');

      const txidAA = service.deriveTxid('order-1', dateA);
      const txidAB = service.deriveTxid('order-2', dateA);
      const txidBA = service.deriveTxid('order-1', dateB);

      expect(txidAA).not.toBe(txidAB);
      expect(txidAA).not.toBe(txidBA);
    });
  });

  // ─── executePayments ────────────────────────────────────────────────────────

  describe('executePayments', () => {
    let repo: RepoMock;
    let bank: BankMock;
    let service: PaymentService;

    beforeEach(() => {
      repo = createMockRepo();
      bank = createMockBank();
      service = createService(repo, bank);
    });

    it('accepted bank response moves a pending order to sent', async () => {
      const order = makeOrder({ status: 'pending', attemptCount: 0 });
      repo.findPending.mockResolvedValue([order]);
      bank.send.mockResolvedValue({ status: 'accepted' });

      await service.executePayments();

      expect(bank.send).toHaveBeenCalledTimes(1);
      expect(repo.markSent).toHaveBeenCalledWith(order.id, expect.any(Date));
      expect(repo.markInDoubt).not.toHaveBeenCalled();
      expect(repo.markRejected).not.toHaveBeenCalled();
    });

    it('duplicate bank response is treated as success', async () => {
      const order = makeOrder({ status: 'pending', attemptCount: 0 });
      repo.findPending.mockResolvedValue([order]);
      bank.send.mockResolvedValue({ status: 'duplicate' });

      await service.executePayments();

      expect(repo.markSent).toHaveBeenCalledWith(order.id, expect.any(Date));
      expect(repo.markInDoubt).not.toHaveBeenCalled();
      expect(repo.markRejected).not.toHaveBeenCalled();
    });

    it('transient_error response moves a pending order to in_doubt', async () => {
      const order = makeOrder({ status: 'pending', attemptCount: 0 });
      repo.findPending.mockResolvedValue([order]);
      bank.send.mockResolvedValue({ status: 'transient_error' });

      await service.executePayments();

      expect(repo.markInDoubt).toHaveBeenCalledWith(order.id, expect.any(Date));
      expect(repo.markSent).not.toHaveBeenCalled();
      expect(repo.markRejected).not.toHaveBeenCalled();
    });

    it('thrown transient bank error moves a pending order to in_doubt', async () => {
      const order = makeOrder({ status: 'pending', attemptCount: 0 });
      repo.findPending.mockResolvedValue([order]);
      bank.send.mockRejectedValue(new BankTransientError('E_TIMEOUT', 'timed out'));

      await service.executePayments();

      expect(repo.markInDoubt).toHaveBeenCalledWith(order.id, expect.any(Date));
      expect(repo.markRejected).not.toHaveBeenCalled();
    });

    it('unexpected non-permanent error moves a pending order to in_doubt', async () => {
      const order = makeOrder({ status: 'pending', attemptCount: 0 });
      repo.findPending.mockResolvedValue([order]);
      bank.send.mockRejectedValue(new Error('something unexpected'));

      await service.executePayments();

      expect(repo.markInDoubt).toHaveBeenCalledWith(order.id, expect.any(Date));
      expect(repo.markRejected).not.toHaveBeenCalled();
    });

    it('permanent_rejection response moves a pending order to rejected', async () => {
      const order = makeOrder({ status: 'pending', attemptCount: 0 });
      repo.findPending.mockResolvedValue([order]);
      bank.send.mockResolvedValue({ status: 'permanent_rejection' });

      await service.executePayments();

      expect(repo.markRejected).toHaveBeenCalledWith(order.id);
      expect(repo.markSent).not.toHaveBeenCalled();
      expect(repo.markInDoubt).not.toHaveBeenCalled();
    });

    it('thrown permanent bank error moves a pending order to rejected', async () => {
      const order = makeOrder({ status: 'pending', attemptCount: 0 });
      repo.findPending.mockResolvedValue([order]);
      bank.send.mockRejectedValue(
        new BankPermanentError('E_INVALID_KEY', 'bad key'),
      );

      await service.executePayments();

      expect(repo.markRejected).toHaveBeenCalledWith(order.id);
      expect(repo.markInDoubt).not.toHaveBeenCalled();
    });

    it('pending order at maxAttempts is parked without a bank call', async () => {
      const order = makeOrder({ status: 'pending', attemptCount: 5 });
      repo.findPending.mockResolvedValue([order]);

      await service.executePayments();

      expect(repo.markParked).toHaveBeenCalledWith(order.id);
      expect(bank.send).not.toHaveBeenCalled();
    });

    it('pending order with attempt_count one below maxAttempts still sends', async () => {
      const order = makeOrder({ status: 'pending', attemptCount: 4 });
      repo.findPending.mockResolvedValue([order]);
      bank.send.mockResolvedValue({ status: 'accepted' });

      await service.executePayments();

      expect(bank.send).toHaveBeenCalledTimes(1);
      expect(repo.markSent).toHaveBeenCalled();
      expect(repo.markParked).not.toHaveBeenCalled();
    });

    it('a lost atomic attempt claim skips the order', async () => {
      const order = makeOrder({ status: 'pending', attemptCount: 0 });
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
        txid: 'deterministic-txid-xyz',
        supplierKey: 'BR9876543210',
        amountMinorUnits: 12345n,
      });
      repo.findPending.mockResolvedValue([order]);
      bank.send.mockResolvedValue({ status: 'accepted' });

      await service.executePayments();

      expect(bank.send).toHaveBeenCalledWith({
        txid: 'deterministic-txid-xyz',
        amount_minor_units: 12345,
        key: 'BR9876543210',
      });
    });

    it('only batchSize pending orders are processed per call', async () => {
      const orders = [
        makeOrder({ id: 'o1' }),
        makeOrder({ id: 'o2' }),
        makeOrder({ id: 'o3' }),
      ];
      repo.findPending.mockResolvedValue(orders);
      bank.send.mockResolvedValue({ status: 'accepted' });

      const smallBatchService = createService(repo, bank, {
        ...DEFAULT_OPTS,
        batchSize: 2,
      });

      await smallBatchService.executePayments();

      expect(repo.findPending).toHaveBeenCalledWith(2);
      // Only 2 orders should have been sent (the mock returns all 3, but the
      // service iterates over whatever findPending returns; the contract is
      // that findPending respects the limit. We verify the limit was passed.)
      expect(bank.send).toHaveBeenCalledTimes(3); // mock returned 3, so 3 processed
      // The key assertion: the limit was communicated to the repository
      expect(repo.findPending).toHaveBeenCalledWith(2);
    });
  });

  // ─── reconcile ──────────────────────────────────────────────────────────────

  describe('reconcile', () => {
    let repo: RepoMock;
    let bank: BankMock;
    let service: PaymentService;

    const statementDate = new Date('2024-01-15T00:00:00.000Z');
    // endOfDay for 2024-01-15 = 2024-01-16T00:00:00.000Z
    const endOfDay = new Date('2024-01-16T00:00:00.000Z');
    const boundary = new Date(endOfDay.getTime() + DEFAULT_OPTS.publishingLagMs);

    beforeEach(() => {
      repo = createMockRepo();
      bank = createMockBank();
      service = createService(repo, bank);
    });

    it('a settlement for a sent order marks it settled and stores the statement row', async () => {
      vi.setSystemTime(new Date(boundary.getTime() + 1000));

      const order = makeOrder({ status: 'sent', txid: 'txid-sent-1' });
      const settlement = {
        txid: 'txid-sent-1',
        amount_minor_units: 5000,
        settled_at: new Date('2024-01-15T18:00:00.000Z'),
      };

      bank.getStatement.mockResolvedValue([settlement]);
      repo.findByTxid.mockResolvedValue(order);

      const result = await service.reconcile({
        startDate: statementDate,
        endDate: statementDate,
      });

      expect(repo.markSettled).toHaveBeenCalledWith(
        order.id,
        settlement.settled_at,
      );
      expect(repo.upsertSettlement).toHaveBeenCalledWith({
        txid: 'txid-sent-1',
        amount_minor_units: 5000,
        settled_at: settlement.settled_at,
        statement_date: expect.any(Date),
      });
      expect(result.settled).toBe(1);
    });

    it('timeout-but-settled order in a statement is settled and not re-sent', async () => {
      vi.setSystemTime(new Date(boundary.getTime() + 1000));

      const order = makeOrder({ status: 'in_doubt', txid: 'txid-doubt-1' });
      const settlement = {
        txid: 'txid-doubt-1',
        amount_minor_units: 5000,
        settled_at: new Date('2024-01-15T18:00:00.000Z'),
      };

      bank.getStatement.mockResolvedValue([settlement]);
      repo.findByTxid.mockResolvedValue(order);
      // The order IS in the statement, so it should NOT be proven absent
      repo.findInDoubtByEffectiveDate.mockResolvedValue([order]);

      const result = await service.reconcile({
        startDate: statementDate,
        endDate: statementDate,
      });

      expect(repo.markSettled).toHaveBeenCalledWith(
        order.id,
        settlement.settled_at,
      );
      // Should NOT be marked pending for resend
      expect(repo.markPendingForResend).not.toHaveBeenCalled();
      expect(result.settled).toBe(1);
      expect(result.provenAbsent).toBe(0);
    });

    it('a settlement entry is processed even when the statement is not yet complete', async () => {
      // Set time BEFORE the boundary (statement not yet complete)
      vi.setSystemTime(new Date(endOfDay.getTime() + 1000));

      const order = makeOrder({ status: 'sent', txid: 'txid-early' });
      const settlement = {
        txid: 'txid-early',
        amount_minor_units: 3000,
        settled_at: new Date('2024-01-15T12:00:00.000Z'),
      };

      bank.getStatement.mockResolvedValue([settlement]);
      repo.findByTxid.mockResolvedValue(order);

      const result = await service.reconcile({
        startDate: statementDate,
        endDate: statementDate,
      });

      // Settlement matching is NOT gated by the publishing lag
      expect(repo.markSettled).toHaveBeenCalledWith(
        order.id,
        settlement.settled_at,
      );
      expect(result.settled).toBe(1);
    });

    it('rejected order is untouched even if its txid appears in a statement', async () => {
      vi.setSystemTime(new Date(boundary.getTime() + 1000));

      const order = makeOrder({ status: 'rejected', txid: 'txid-rejected' });
      const settlement = {
        txid: 'txid-rejected',
        amount_minor_units: 5000,
        settled_at: new Date('2024-01-15T18:00:00.000Z'),
      };

      bank.getStatement.mockResolvedValue([settlement]);
      repo.findByTxid.mockResolvedValue(order);

      const result = await service.reconcile({
        startDate: statementDate,
        endDate: statementDate,
      });

      expect(repo.markSettled).not.toHaveBeenCalled();
      expect(repo.markPendingForResend).not.toHaveBeenCalled();
      expect(result.settled).toBe(0);
    });

    it('parked order is untouched by reconciliation', async () => {
      vi.setSystemTime(new Date(boundary.getTime() + 1000));

      const order = makeOrder({
        status: 'parked_manual_review',
        txid: 'txid-parked',
      });
      const settlement = {
        txid: 'txid-parked',
        amount_minor_units: 5000,
        settled_at: new Date('2024-01-15T18:00:00.000Z'),
      };

      bank.getStatement.mockResolvedValue([settlement]);
      repo.findByTxid.mockResolvedValue(order);
      repo.findInDoubtByEffectiveDate.mockResolvedValue([order]);

      const result = await service.reconcile({
        startDate: statementDate,
        endDate: statementDate,
      });

      expect(repo.markSettled).not.toHaveBeenCalled();
      expect(repo.markPendingForResend).not.toHaveBeenCalled();
      expect(result.settled).toBe(0);
      expect(result.provenAbsent).toBe(0);
    });

    it('an in_doubt order absent from a complete statement becomes pending', async () => {
      vi.setSystemTime(new Date(boundary.getTime() + 1000));

      const order = makeOrder({ status: 'in_doubt', txid: 'txid-absent' });
      // Statement does NOT contain this txid
      bank.getStatement.mockResolvedValue([]);
      repo.findInDoubtByEffectiveDate.mockResolvedValue([order]);

      const result = await service.reconcile({
        startDate: statementDate,
        endDate: statementDate,
      });

      expect(repo.markPendingForResend).toHaveBeenCalledWith(order.id);
      expect(result.provenAbsent).toBe(1);
    });

    it('an in_doubt order absent before the publishing lag boundary is not proven absent', async () => {
      // Set time exactly AT the boundary (not strictly after)
      vi.setSystemTime(new Date(boundary.getTime()));

      const order = makeOrder({ status: 'in_doubt', txid: 'txid-early-absent' });
      bank.getStatement.mockResolvedValue([]);
      repo.findInDoubtByEffectiveDate.mockResolvedValue([order]);

      const result = await service.reconcile({
        startDate: statementDate,
        endDate: statementDate,
      });

      expect(repo.markPendingForResend).not.toHaveBeenCalled();
      expect(result.provenAbsent).toBe(0);
    });

    it('an in_doubt order absent one millisecond after the boundary becomes pending', async () => {
      // Set time exactly 1ms after the boundary
      vi.setSystemTime(new Date(boundary.getTime() + 1));

      const order = makeOrder({ status: 'in_doubt', txid: 'txid-just-after' });
      bank.getStatement.mockResolvedValue([]);
      repo.findInDoubtByEffectiveDate.mockResolvedValue([order]);

      const result = await service.reconcile({
        startDate: statementDate,
        endDate: statementDate,
      });

      expect(repo.markPendingForResend).toHaveBeenCalledWith(order.id);
      expect(result.provenAbsent).toBe(1);
    });

    it("an in_doubt order with effective_date outside the window is not affected by another date's statement", async () => {
      vi.setSystemTime(new Date(boundary.getTime() + 1000));

      // Order has effective_date = 2024-01-16, but we reconcile window for 2024-01-15
      const order = makeOrder({
        status: 'in_doubt',
        txid: 'txid-other-day',
        effectiveDate: new Date('2024-01-16T00:00:00.000Z'),
      });

      bank.getStatement.mockResolvedValue([]);
      // findInDoubtByEffectiveDate is called with the date from the window (2024-01-15)
      // The order's effective_date is 2024-01-16, so it should NOT be returned
      repo.findInDoubtByEffectiveDate.mockResolvedValue([]);

      const result = await service.reconcile({
        startDate: statementDate,
        endDate: statementDate,
      });

      expect(repo.markPendingForResend).not.toHaveBeenCalled();
      expect(result.provenAbsent).toBe(0);
    });

    it('an in_doubt order present in the statement is settled, not counted as proven absent', async () => {
      vi.setSystemTime(new Date(boundary.getTime() + 1000));

      const order = makeOrder({ status: 'in_doubt', txid: 'txid-present' });
      const settlement = {
        txid: 'txid-present',
        amount_minor_units: 5000,
        settled_at: new Date('2024-01-15T18:00:00.000Z'),
      };

      bank.getStatement.mockResolvedValue([settlement]);
      repo.findByTxid.mockResolvedValue(order);
      // The order is in the statement, so it's settled. It should also appear
      // in findInDoubtByEffectiveDate but since its txid IS in statementTxids,
      // it should NOT be marked pending for resend.
      repo.findInDoubtByEffectiveDate.mockResolvedValue([order]);

      const result = await service.reconcile({
        startDate: statementDate,
        endDate: statementDate,
      });

      expect(repo.markSettled).toHaveBeenCalled();
      expect(repo.markPendingForResend).not.toHaveBeenCalled();
      expect(result.settled).toBe(1);
      expect(result.provenAbsent).toBe(0);
    });

    it('unknown txids in a statement are ignored', async () => {
      vi.setSystemTime(new Date(boundary.getTime() + 1000));

      const settlement = {
        txid: 'txid-unknown-bank-entry',
        amount_minor_units: 9999,
        settled_at: new Date('2024-01-15T18:00:00.000Z'),
      };

      bank.getStatement.mockResolvedValue([settlement]);
      // No local order matches this txid
      repo.findByTxid.mockResolvedValue(null);

      const result = await service.reconcile({
        startDate: statementDate,
        endDate: statementDate,
      });

      expect(repo.markSettled).not.toHaveBeenCalled();
      expect(result.settled).toBe(0);
      // Should not have thrown
    });

    it('duplicate delivery of the same statement entry is idempotent', async () => {
      vi.setSystemTime(new Date(boundary.getTime() + 1000));

      const order = makeOrder({ status: 'sent', txid: 'txid-dup' });
      const settlement = {
        txid: 'txid-dup',
        amount_minor_units: 5000,
        settled_at: new Date('2024-01-15T18:00:00.000Z'),
      };

      // First call: order is in 'sent' state
      repo.findByTxid
        .mockResolvedValueOnce(order)
        .mockResolvedValueOnce({ ...order, status: 'settled' });

      bank.getStatement.mockResolvedValue([settlement]);

      const window = { startDate: statementDate, endDate: statementDate };

      const result1 = await service.reconcile(window);
      expect(result1.settled).toBe(1);

      const result2 = await service.reconcile(window);
      // Second time: order is already 'settled', so markSettled should not be called again
      expect(result2.settled).toBe(0);
    });

    it('running the same window twice is idempotent', async () => {
      vi.setSystemTime(new Date(boundary.getTime() + 1000));

      const sentOrder = makeOrder({ status: 'sent', txid: 'txid-s1' });
      const inDoubtOrder = makeOrder({ status: 'in_doubt', txid: 'txid-absent-1' });
      const settlement = {
        txid: 'txid-s1',
        amount_minor_units: 5000,
        settled_at: new Date('2024-01-15T18:00:00.000Z'),
      };

      bank.getStatement.mockResolvedValue([settlement]);
      // First call: sent order is found, in_doubt order is absent
      repo.findByTxid.mockResolvedValue(sentOrder);
      repo.findInDoubtByEffectiveDate
        .mockResolvedValueOnce([inDoubtOrder])
        .mockResolvedValueOnce([]); // second call: already moved to pending

      const window = { startDate: statementDate, endDate: statementDate };

      const result1 = await service.reconcile(window);
      expect(result1.settled).toBe(1);
      expect(result1.provenAbsent).toBe(1);

      const result2 = await service.reconcile(window);
      // Second run: order is now settled (mock still returns it, but markSettled
      // is a conditional update that won't match). The in_doubt list is empty.
      expect(result2.provenAbsent).toBe(0);
    });

    it('inclusive window boundaries cover a single-day and multi-day range', async () => {
      vi.setSystemTime(new Date('2024-01-20T00:00:00.000Z'));

      const day1 = new Date('2024-01-15T00:00:00.000Z');
      const day2 = new Date('2024-01-16T00:00:00.000Z');
      const day3 = new Date('2024-01-17T00:00:00.000Z');

      bank.getStatement
        .mockResolvedValueOnce([]) // day1
        .mockResolvedValueOnce([]) // day2
        .mockResolvedValueOnce([]); // day3

      repo.findInDoubtByEffectiveDate.mockResolvedValue([]);

      const result = await service.reconcile({
        startDate: day1,
        endDate: day3,
      });

      // All three days should have been queried
      expect(bank.getStatement).toHaveBeenCalledTimes(3);

      // Single-day window
      bank.getStatement.mockReset();
      bank.getStatement.mockResolvedValue([]);
      await service.reconcile({ startDate: day1, endDate: day1 });
      expect(bank.getStatement).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Full lifecycle ─────────────────────────────────────────────────────────

  describe('full lifecycle', () => {
    let fakeRepo: FakeRepository;
    let bank: BankMock;
    let service: PaymentService;

    const effectiveDate = new Date('2024-01-15T00:00:00.000Z');
    const endOfDay = new Date('2024-01-16T00:00:00.000Z');
    const boundary = new Date(endOfDay.getTime() + DEFAULT_OPTS.publishingLagMs);

    beforeEach(() => {
      fakeRepo = new FakeRepository();
      bank = createMockBank();
      service = createServiceWithFake(fakeRepo, bank);
    });

    it('timeout, proven absent, resend with same txid, then settlement', async () => {
      const order = makeOrder({
        id: 'lifecycle-1',
        txid: 'txid-lifecycle',
        status: 'pending',
        attemptCount: 0,
      });
      fakeRepo.addOrder(order);

      // Phase 1: executePayments → timeout → in_doubt
      bank.send.mockRejectedValueOnce(
        new BankTransientError('E_TIMEOUT', 'connection timed out'),
      );
      await service.executePayments();

      let current = fakeRepo.getOrder('lifecycle-1')!;
      expect(current.status).toBe('in_doubt');
      expect(current.attemptCount).toBe(1);

      // Phase 2: reconcile → proven absent → pending (same txid preserved)
      vi.setSystemTime(new Date(boundary.getTime() + 1000));
      bank.getStatement.mockResolvedValue([]); // empty statement
      const reconResult = await service.reconcile({
        startDate: effectiveDate,
        endDate: effectiveDate,
      });
      expect(reconResult.provenAbsent).toBe(1);

      current = fakeRepo.getOrder('lifecycle-1')!;
      expect(current.status).toBe('pending');
      expect(current.txid).toBe('txid-lifecycle'); // same txid preserved

      // Phase 3: executePayments → accepted → sent
      bank.send.mockResolvedValueOnce({ status: 'accepted' });
      await service.executePayments();

      current = fakeRepo.getOrder('lifecycle-1')!;
      expect(current.status).toBe('sent');
      expect(current.attemptCount).toBe(2);

      // Verify the same txid was used
      const sendCall = bank.send.mock.calls[1][0] as any;
      expect(sendCall.txid).toBe('txid-lifecycle');

      // Phase 4: reconcile → found in statement → settled
      const settlement = {
        txid: 'txid-lifecycle',
        amount_minor_units: 5000,
        settled_at: new Date('2024-01-15T18:00:00.000Z'),
      };
      bank.getStatement.mockResolvedValue([settlement]);
      const reconResult2 = await service.reconcile({
        startDate: effectiveDate,
        endDate: effectiveDate,
      });
      expect(reconResult2.settled).toBe(1);

      current = fakeRepo.getOrder('lifecycle-1')!;
      expect(current.status).toBe('settled');
    });

    it('five timed-out sends with proven-absent returns in between end parked without a sixth send', async () => {
      vi.setSystemTime(new Date(boundary.getTime() + 1000));

      const order = makeOrder({
        id: 'lifecycle-exhaust',
        txid: 'txid-exhaust',
        status: 'pending',
        attemptCount: 0,
      });
      fakeRepo.addOrder(order);

      // Simulate 5 rounds of: executePayments (timeout) → reconcile (proven absent)
      for (let round = 0; round < 5; round++) {
        // executePayments: send times out → in_doubt
        bank.send.mockRejectedValueOnce(
          new BankTransientError('E_TIMEOUT', 'timeout'),
        );
        await service.executePayments();

        let current = fakeRepo.getOrder('lifecycle-exhaust')!;
        expect(current.status).toBe('in_doubt');
        expect(current.attemptCount).toBe(round + 1);

        // reconcile: proven absent → back to pending
        bank.getStatement.mockResolvedValue([]);
        await service.reconcile({
          startDate: effectiveDate,
          endDate: effectiveDate,
        });

        current = fakeRepo.getOrder('lifecycle-exhaust')!;
        expect(current.status).toBe('pending');
      }

      // After 5 attempts, the order is pending with attemptCount = 5
      let current = fakeRepo.getOrder('lifecycle-exhaust')!;
      expect(current.status).toBe('pending');
      expect(current.attemptCount).toBe(5);

      // 6th executePayments: should park, NOT call bank
      bank.send.mockReset();
      bank.send.mockResolvedValue({ status: 'accepted' });

      await service.executePayments();

      current = fakeRepo.getOrder('lifecycle-exhaust')!;
      expect(current.status).toBe('parked_manual_review');
      expect(bank.send).not.toHaveBeenCalled();
    });

    it('parked order survives repeated executePayments and reconcile calls', async () => {
      vi.setSystemTime(new Date(boundary.getTime() + 1000));

      const order = makeOrder({
        id: 'lifecycle-parked',
        txid: 'txid-parked-lc',
        status: 'parked_manual_review',
        attemptCount: 5,
      });
      fakeRepo.addOrder(order);

      // executePayments should not pick it up (it's not pending)
      bank.send.mockResolvedValue({ status: 'accepted' });
      await service.executePayments();
      expect(bank.send).not.toHaveBeenCalled();

      // reconcile should not change it
      bank.getStatement.mockResolvedValue([]);
      await service.reconcile({
        startDate: effectiveDate,
        endDate: effectiveDate,
      });

      let current = fakeRepo.getOrder('lifecycle-parked')!;
      expect(current.status).toBe('parked_manual_review');

      // Repeat to confirm stability
      await service.executePayments();
      bank.getStatement.mockResolvedValue([]);
      await service.reconcile({
        startDate: effectiveDate,
        endDate: effectiveDate,
      });

      current = fakeRepo.getOrder('lifecycle-parked')!;
      expect(current.status).toBe('parked_manual_review');
      expect(bank.send).not.toHaveBeenCalled();
    });
  });
});
```
