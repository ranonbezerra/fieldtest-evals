# repair1-payment.spec.ts

## reasoning

```
Let me analyze the compiler errors that relate to `test/payment.spec.ts`:

1. `test/payment.spec.ts(2,32): error TS2307: Cannot find module '../src/payment/payment.service' or its corresponding type declarations.`
2. `test/payment.spec.ts(3,63): error TS2307: Cannot find module '../src/payment/bank-client.interface' or its corresponding type declarations.`
3. `test/payment.spec.ts(24,17): error TS2344: Type 'Promise<BankSendResponse>' does not satisfy the constraint 'Procedure'.`
4. `test/payment.spec.ts(25,25): error TS2344: Type 'Promise<Settlement[]>' does not satisfy the constraint 'Procedure'.`

Errors 1 and 2 are about missing modules. These are because `src/payment/payment.module.ts` doesn't exist (which causes the cascade), and `src/payment/bank-client.interface.ts` doesn't exist. But wait - the task says "Change nothing the messages do not name." The messages name `test/payment.spec.ts` lines 2, 3, 24, 25. 

Wait, let me re-read: "Rewrite `test/payment.spec.ts` complete, fixing what these messages require of this file."

So I need to fix `test/payment.spec.ts` to address:
- Line 2: importing from `'../src/payment/payment.service'` - module not found
- Line 3: importing from `'../src/payment/bank-client.interface'` - module not found
- Line 24: `Promise<BankSendResponse>` doesn't satisfy `Procedure` constraint
- Line 25: `Promise<Settlement[]>` doesn't satisfy `Procedure` constraint

The errors 1 and 2 (TS2307) are because the source files don't exist yet. But the task says to only fix what the messages require of `test/payment.spec.ts`. The source files are separate issues - they'll need to be created separately.

Wait, but if the modules don't exist, the imports will always fail. Let me think about this differently.

Actually, looking more carefully at the error messages:
- `src/app.module.ts(2,31): error TS2307: Cannot find module './payment/payment.module'` - this means `src/payment/payment.module.ts` doesn't exist
- `src/payment/payment.service.ts(3,70): error TS2307: Cannot find module './bank-client.interface'` - this means `src/payment/bank-client.interface.ts` doesn't exist
- `src/payment/payment.service.ts(4,53): error TS2307: Cannot find module './payment.repository'` - this means `src/payment/payment.repository.ts` doesn't exist

Wait, but `src/payment/payment.repository.ts` IS referenced in other errors (like line 11, 22, 29, etc.), so it DOES exist. The error on `payment.service.ts(4,53)` saying "Cannot find module './payment.repository'" is strange if the file exists...

Actually wait - let me re-read. The errors for `payment.repository.ts` are type errors (TS2353, TS2561), not module-not-found. So `payment.repository.ts` exists but has type errors. The error in `payment.service.ts(4,53)` saying it can't find `'./payment.repository'` - this might be because the file has syntax errors that prevent it from being resolved as a module? Or maybe it's a different issue.

Hmm, but the task says "Change nothing the messages do not name." So I should only modify `test/payment.spec.ts`.

The key insight is: the test file imports from modules that don't exist yet (or have errors). The test file itself has two categories of issues:
1. Import path issues (TS2307) - the modules aren't found
2. Type issues (TS2344) - using `Promise<X>` where `Procedure` is expected

For issue 1: The imports in the test file reference `../src/payment/payment.service` and `../src/payment/bank-client.interface`. If those files don't exist, the test can't compile. But the task says to fix what the messages require of THIS file. The messages say the modules can't be found. But I can't create those files (the task says "Change nothing the messages do not name" and only asks me to rewrite `test/payment.spec.ts`).

Wait, I need to re-read the task more carefully: "Rewrite `test/payment.spec.ts` complete, fixing what these messages require of this file."

So I'm only rewriting `test/payment.spec.ts`. The other files will be fixed separately. The question is: what can I do in `test/payment.spec.ts` to fix the TS2307 errors?

Actually, the TS2307 errors in `test/payment.spec.ts` are because the imported modules don't exist or have their own errors. If those other files get fixed, the TS2307 in the test will resolve. So maybe I don't need to do anything special for those - they'll be fixed when the other files are fixed.

But the TS2344 errors ARE specific to how the test file is written:
- `test/payment.spec.ts(24,17): error TS2344: Type 'Promise<BankSendResponse>' does not satisfy the constraint 'Procedure'.`
- `test/payment.spec.ts(25,25): error TS2344: Type 'Promise<Settlement[]>' does not satisfy the constraint 'Procedure'.`

This is a classic Vitest issue. When you use `vi.fn().mockReturnValue(...)` or type your mock as `ReturnType<typeof something>`, the `Procedure` constraint from `Parameters<T>` or `ReturnType<T>` fails when the function returns a Promise.

The typical fix is to use `vi.fn<Procedure>()` or type the mock properly. Actually, the issue is likely that the test is doing something like:

```typescript
const mockSend = vi.fn<Parameters<typeof bank.send>, ReturnType<typeof bank.send>>()
```

But `ReturnType<typeof bank.send>` is `Promise<BankSendResponse>`, and when used with `vi.fn()`, the second type parameter needs to be a function signature or the mock needs to be typed differently.

Actually, looking at Vitest's type definitions, `vi.fn()` accepts:
- `vi.fn<T extends Procedure>()` where `Procedure = (...args: any[]) => any`
- Or you can use the newer overload

The issue is that `Promise<BankSendResponse>` is not a function (not a `Procedure`), so it can't be used where a function type is expected.

The fix is to type the mock as:
```typescript
const mockSend = vi.fn<(req: BankSendRequest) => Promise<BankSendResponse>>()
```

Or use the object mock approach:
```typescript
const bankClient = {
  send: vi.fn(),
  getStatement: vi.fn(),
} as unknown as BankClient;
```

Now, let me think about what the test file should look like based on the PLAN.md:

The plan specifies these tests:
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

Now, the plan says:
- `PaymentService` constructor takes `(repo: PaymentRepository, bank: BankClient, opts: { publishingLagMs: number; batchSize: number; maxAttempts: number })`
- `executePayments(): Promise<void>`
- `reconcile(window: ReconcileWindow): Promise<ReconcileResult>`
- `deriveTxid(orderId: string, effectiveDate: Date): string`

The repository interface has:
- `findPending(limit: number): Promise<OrderRecord[]>`
- `findByTxid(txid: string): Promise<OrderRecord | null>`
- `findInDoubtByEffectiveDate(date: Date): Promise<OrderRecord[]>`
- `markSent(id: string, lastAttemptAt: Date): Promise<void>`
- `markInDoubt(id: string, lastAttemptAt: Date): Promise<void>`
- `markRejected(id: string): Promise<void>`
- `markSettled(id: string, settledAt: Date): Promise<void>`
- `markPendingForResend(id: string): Promise<void>`
- `markParked(id: string): Promise<void>`
- `incrementAttempt(id: string, lastAttemptAt: Date): Promise<number>`
- `upsertSettlement(data: {...}): Promise<void>`

Now, for the test file, I need to:
1. Import from the correct paths
2. Fix the `Procedure` constraint issue by typing mocks properly
3. Write all the tests from the plan

The TS2307 errors will be resolved when the source files are created/fixed. The TS2344 errors I need to fix in this file by properly typing the mocks.

Let me write the test file. I'll use `vi.fn()` with proper typing to avoid the `Procedure` constraint issue.

For the mock bank client, I'll do:
```typescript
const mockBank = {
  send: vi.fn(),
  getStatement: vi.fn(),
};
```

And for the repository, similarly. Then I'll cast them.

Actually, let me think about this more carefully. The error says:
```
test/payment.spec.ts(24,17): error TS2344: Type 'Promise<BankSendResponse>' does not satisfy the constraint 'Procedure'.
test/payment.spec.ts(25,25): error TS2344: Type 'Promise<Settlement[]>' does not satisfy the constraint 'Procedure'.
```

This suggests the original test was doing something like:
```typescript
const send = vi.fn<Parameters<BankClient['send']>, ReturnType<BankClient['send']>>();
```

Where `ReturnType<BankClient['send']>` is `Promise<BankSendResponse>`, and Vitest's `vi.fn` second type parameter expects a return type that could be used as part of a function signature... Actually no, looking at Vitest's types more carefully:

In older Vitest, `vi.fn<T, Y extends any[]>` where T is the return type. In newer Vitest (1.x+), it's `vi.fn<T extends Procedure>()` where T is the full function type.

The error "Type 'Promise<BankSendResponse>' does not satisfy the constraint 'Procedure'" suggests the code is using the newer `vi.fn<T extends Procedure>()` form but passing `Promise<BankSendResponse>` as T, which is not a function type.

The fix is to pass the full function type:
```typescript
const send = vi.fn<(req: BankSendRequest) => Promise<BankSendResponse>>();
```

Or use the object approach and cast.

Let me write the complete test file now. I'll use the approach of creating mock objects and casting them to the proper interfaces, which avoids the `Procedure` constraint issue entirely.

Let me think about what the Prisma schema looks like based on the PLAN:

The `OrderRecord` interface in the plan uses `snake_case` field names (matching the Prisma schema with `@map`). But wait - in Prisma, by default, the model fields are camelCase in the TypeScript client, and they map to snake_case in the database via `@map`. 

Looking at the compiler errors for `payment.repository.ts`:
- `'effectiveDate' does not exist in type 'OrderWhereInput'. Did you mean to write 'effective_date'?`
- `'lastAttemptAt' does not exist... Did you mean to write 'last_attempt_at'?`
- `'settledAt' does not exist... Did you mean to write 'settled_at'?`
- `'amountMinorUnits' does not exist... Did you mean to write 'amount_minor_units'?`

This tells me that the Prisma schema does NOT use `@map` for these fields - the model fields are directly named in snake_case. So in the Prisma client, you use `effective_date`, `last_attempt_at`, etc. directly.

Wait, that's unusual. Normally with Prisma you'd have:
```prisma
model Order {
  effectiveDate DateTime @map("effective_date")
}
```

Which gives you `effectiveDate` in the TS client. But the error says "Did you mean to write 'effective_date'?" which means the field in the Prisma model is literally named `effective_date` (no `@map`, just the field name is snake_case).

So the Prisma model looks like:
```prisma
model Order {
  id                String    @id @default(uuid())
  supplier_key      String
  amount_minor_units BigInt
  effective_date    DateTime  @db.Date
  txid              String    @unique
  status            String
  attempt_count     Int       @default(0)
  last_attempt_at   DateTime?
  settled_at        DateTime?
  created_at        DateTime  @default(now())
  updated_at        DateTime  @default(now()) @updatedAt
}
```

This means in the test file, when I reference `OrderRecord` fields, they should be snake_case to match what the repository returns (since it's passing through Prisma model data directly).

But wait - the plan defines `OrderRecord` with snake_case fields:
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

So the repository returns objects with snake_case field names. This is consistent with the Prisma model having snake_case field names directly.

Now, for the test file, I need to:
1. Import `PaymentService` from `'../src/payment/payment.service'`
2. Import types from `'../src/payment/bank-client.interface'`
3. Mock the repository and bank client
4. Write all 17 tests

Let me also check: the plan says `deriveTxid` uses `sha256(orderId + effectiveDate.toISOString()).hex`. I'll need to mock or compute this.

Actually, for the `deriveTxid` tests, I can just call the real method and verify determinism (same input → same output) and injectivity (different input → different output). I don't need to verify the exact hash value.

Let me now write the test file:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { PaymentService } from '../src/payment/payment.service';
import type { BankClient, BankSendResponse, Settlement } from '../src/payment/bank-client.interface';

// --- Helpers to create mock objects with proper typing ---

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

// ... tests
```

Wait, but I need to make sure the types work. The `PaymentService` constructor expects specific types. Let me cast the mocks.

Actually, looking at this more carefully - the issue is that `vi.fn()` without type parameters returns `Mock<any[], any>` which should be assignable to most things. The problem in the original code was specifically using `vi.fn<ReturnType<...>>()` which doesn't work.

Let me use the approach of creating plain mock functions and casting the whole object:

```typescript
const bank = { send: vi.fn(), getStatement: vi.fn() } as unknown as BankClient;
const repo = { ... } as unknown as PaymentRepository;
```

But wait - `PaymentRepository` is a class, not an interface. The plan says it's a class. In the test, I should mock it as the interface of its methods.

Actually, for testing purposes, I just need the structural type. Let me define a local interface or use `Pick<PaymentRepository, ...>`.

Hmm, but I'm told to only fix what the compiler errors require. The TS2307 errors mean the modules don't exist yet. Once they do, the imports will work. The TS2344 errors are about the typing of the mocks.

Let me just write a clean test file that:
1. Has correct import paths (matching the plan's manifest)
2. Uses `as unknown as` casts to avoid any `Procedure` constraint issues
3. Implements all 17 tests from the plan

Here's my approach for mocking:

```typescript
const mockRepo = createMockRepo() as unknown as PaymentRepository;
const mockBank = createMockBank() as unknown as BankClient;
```

But I need to import `PaymentRepository` type. Looking at the plan, the repository is in `src/payment/payment.repository.ts`. I can import it as a type.

Actually wait - the task says "Change nothing the messages do not name." The messages name specific lines in `test/payment.spec.ts`. Let me just make sure my rewrite:
1. Has correct imports (lines 2, 3)
2. Doesn't have the `Procedure` constraint issue (lines 24, 25)

The imports on lines 2 and 3 in the original were:
- Line 2: `import { PaymentService } from '../src/payment/payment.service'`
- Line 3: `import { ... } from '../src/payment/bank-client.interface'`

These are correct paths per the plan. The TS2307 will resolve when those files exist. So I keep these imports.

For lines 24-25, the issue was with how mocks were typed. I'll use `as unknown as` to sidestep this.

Let me write the complete file now. I'll follow the plan's test list exactly.

One more consideration: the `reconcile` method takes a `ReconcileWindow` with `startDate` and `endDate`. The plan says it enumerates each calendar date from start to end. For tests, I'll use single-day windows (start = end) for simplicity in most cases.

For the "statement not yet complete" test, I need `now` to be before `endOfDay(D) + publishingLagMs`. For the "proven absent" test, I need `now` to be after that.

I'll use `vi.useFakeTimers()` and `vi.setSystemTime()` to control "now".

Let me also think about the `incrementAttempt` return value. The plan says it returns the new count, and if 0 rows affected (concurrent race), it returns... hmm, actually the plan says "if rows affected is 0, another process won the race and this one skips." So `incrementAttempt` probably returns a number (the new attempt count) or 0/null if the update didn't affect any rows.

Looking at the plan's repository interface: `incrementAttempt(id: string, lastAttemptAt: Date): Promise<number>` - it returns a number. If the conditional update affects 0 rows, it likely returns 0 or -1 to signal "no change."

Actually, re-reading: "Atomically increment attempt and set last_attempt_at (returns new count; if 0 rows affected, skip — another worker got it)."

So the return is the new count. If 0 rows were affected, there's no "new count" - so it probably returns 0 or the function signals failure somehow. Let me assume it returns the new count if successful, and 0 if no rows were affected (since attempt_count starts at 0, a return of 0 would mean "no update happened" since a successful increment would give at least 1).

Wait, that's ambiguous. Let me re-read: "The repository's incrementAttempt uses an atomic UPDATE … SET attempt_count = attempt_count + 1 WHERE id = ? AND status = 'pending' returning the new count; if rows affected is 0, another process won the race and this one skips."

So if rows affected = 0, the service skips. The return value when rows affected > 0 is the new count. When rows affected = 0, the return is... probably 0 or undefined. Since the type is `Promise<number>`, it likely returns 0 when no update happened.

For my test "concurrent increment skips the order", I'll mock `incrementAttempt` to return 0, and verify that `bank.send` is NOT called.

Actually wait - if the initial attempt_count is 0, and we increment, the new count would be 1. So returning 0 can safely mean "no rows affected" since a valid increment always produces ≥ 1.

Let me finalize my test file. I'll make it comprehensive but focused on the behaviors specified in the plan.

One more thing: for `deriveTxid`, the plan says `sha256(orderId + effectiveDate.toISOString()).hex`. I'll test that calling it twice with the same args gives the same result, and different args give different results. I don't need to verify the exact hash (that would be testing implementation).

Let me write it out:
```

## reply

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaymentService } from '../src/payment/payment.service';
import type { BankClient, BankSendRequest, BankSendResponse, Settlement } from '../src/payment/bank-client.interface';

// ─── Mock factories ────────────────────────────────────────────────────────

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

// ─── Constants for tests ───────────────────────────────────────────────────

const PUBLISHING_LAG_MS = 30 * 60 * 1000;
const BATCH_SIZE = 100;
const MAX_ATTEMPTS = 5;

function makeService(repo: ReturnType<typeof createMockRepo>, bank: ReturnType<typeof createMockBank>) {
  return new PaymentService(repo as never, bank as never, {
    publishingLagMs: PUBLISHING_LAG_MS,
    batchSize: BATCH_SIZE,
    maxAttempts: MAX_ATTEMPTS,
  });
}

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    supplier_key: 'key-1',
    amount_minor_units: 1500,
    effective_date: new Date('2025-01-15T00:00:00Z'),
    txid: 'txid-abc',
    status: 'pending' as const,
    attempt_count: 0,
    last_attempt_at: null,
    settled_at: null,
    ...overrides,
  };
}

// ─── executePayments ───────────────────────────────────────────────────────

describe('executePayments', () => {
  let repo: ReturnType<typeof createMockRepo>;
  let bank: ReturnType<typeof createMockBank>;
  let service: PaymentService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-16T12:00:00Z'));
    repo = createMockRepo();
    bank = createMockBank();
    service = makeService(repo, bank);
  });

  it('accepted response transitions pending → sent', async () => {
    const order = makeOrder();
    repo.findPending.mockResolvedValue([order]);
    repo.incrementAttempt.mockResolvedValue(1);
    bank.send.mockResolvedValue({ status: 'accepted' });

    await service.executePayments();

    expect(bank.send).toHaveBeenCalledWith({
      txid: 'txid-abc',
      amount_minor_units: 1500,
      key: 'key-1',
    });
    expect(repo.markSent).toHaveBeenCalledWith('order-1', expect.any(Date));
  });

  it('duplicate response transitions pending → sent', async () => {
    const order = makeOrder();
    repo.findPending.mockResolvedValue([order]);
    repo.incrementAttempt.mockResolvedValue(1);
    bank.send.mockResolvedValue({ status: 'duplicate' });

    await service.executePayments();

    expect(repo.markSent).toHaveBeenCalledWith('order-1', expect.any(Date));
  });

  it('transient error transitions pending → in_doubt', async () => {
    const order = makeOrder();
    repo.findPending.mockResolvedValue([order]);
    repo.incrementAttempt.mockResolvedValue(1);
    bank.send.mockResolvedValue({ status: 'transient_error' });

    await service.executePayments();

    expect(repo.markInDoubt).toHaveBeenCalledWith('order-1', expect.any(Date));
  });

  it('timeout (thrown transient) transitions pending → in_doubt', async () => {
    const order = makeOrder();
    repo.findPending.mockResolvedValue([order]);
    repo.incrementAttempt.mockResolvedValue(1);
    bank.send.mockRejectedValue(new Error('timeout'));

    await service.executePayments();

    expect(repo.markInDoubt).toHaveBeenCalledWith('order-1', expect.any(Date));
  });

  it('permanent rejection transitions pending → rejected', async () => {
    const order = makeOrder();
    repo.findPending.mockResolvedValue([order]);
    repo.incrementAttempt.mockResolvedValue(1);
    bank.send.mockResolvedValue({ status: 'permanent_rejection' });

    await service.executePayments();

    expect(repo.markRejected).toHaveBeenCalledWith('order-1');
  });

  it('attempt_count >= max parks the order without calling bank', async () => {
    const order = makeOrder({ attempt_count: 5 });
    repo.findPending.mockResolvedValue([order]);

    await service.executePayments();

    expect(bank.send).not.toHaveBeenCalled();
    expect(repo.markParked).toHaveBeenCalledWith('order-1');
  });

  it('concurrent increment (0 rows affected) skips the order', async () => {
    const order = makeOrder();
    repo.findPending.mockResolvedValue([order]);
    repo.incrementAttempt.mockResolvedValue(0);

    await service.executePayments();

    expect(bank.send).not.toHaveBeenCalled();
    expect(repo.markSent).not.toHaveBeenCalled();
    expect(repo.markInDoubt).not.toHaveBeenCalled();
  });
});

// ─── reconcile ─────────────────────────────────────────────────────────────

describe('reconcile', () => {
  let repo: ReturnType<typeof createMockRepo>;
  let bank: ReturnType<typeof createMockBank>;
  let service: PaymentService;

  beforeEach(() => {
    vi.useFakeTimers();
    repo = createMockRepo();
    bank = createMockBank();
    service = makeService(repo, bank);
  });

  it('found-in-statement transitions sent → settled', async () => {
    // Set "now" well past end-of-day + publishing lag so the statement is complete.
    vi.setSystemTime(new Date('2025-01-17T01:00:00Z'));
    const stmtDate = new Date('2025-01-15T00:00:00Z');

    const order = makeOrder({ status: 'sent', txid: 'txid-abc' });
    const settlement: Settlement = {
      txid: 'txid-abc',
      amount_minor_units: 1500,
      settled_at: new Date('2025-01-15T23:00:00Z'),
    };

    bank.getStatement.mockResolvedValue([settlement]);
    repo.findByTxid.mockResolvedValue(order);

    const result = await service.reconcile({ startDate: stmtDate, endDate: stmtDate });

    expect(repo.markSettled).toHaveBeenCalledWith('order-1', settlement.settled_at);
    expect(result.settled).toBe(1);
  });

  it('found-in-statement transitions in_doubt → settled (timeout-but-settled, no resend)', async () => {
    vi.setSystemTime(new Date('2025-01-17T01:00:00Z'));
    const stmtDate = new Date('2025-01-15T00:00:00Z');

    const order = makeOrder({ status: 'in_doubt', txid: 'txid-abc' });
    const settlement: Settlement = {
      txid: 'txid-abc',
      amount_minor_units: 1500,
      settled_at: new Date('2025-01-15T23:00:00Z'),
    };

    bank.getStatement.mockResolvedValue([settlement]);
    repo.findByTxid.mockResolvedValue(order);

    const result = await service.reconcile({ startDate: stmtDate, endDate: stmtDate });

    expect(repo.markSettled).toHaveBeenCalledWith('order-1', settlement.settled_at);
    // Must NOT mark pending for resend
    expect(repo.markPendingForResend).not.toHaveBeenCalled();
    expect(result.settled).toBe(1);
  });

  it('proven-absent transitions in_doubt → pending (same txid preserved)', async () => {
    vi.setSystemTime(new Date('2025-01-17T01:00:00Z'));
    const stmtDate = new Date('2025-01-15T00:00:00Z');

    // Statement is empty — the txid is absent.
    bank.getStatement.mockResolvedValue([]);

    const order = makeOrder({ status: 'in_doubt', txid: 'txid-abc' });
    repo.findInDoubtByEffectiveDate.mockResolvedValue([order]);

    const result = await service.reconcile({ startDate: stmtDate, endDate: stmtDate });

    expect(repo.markPendingForResend).toHaveBeenCalledWith('order-1');
    expect(result.provenAbsent).toBe(1);
  });

  it('statement not yet complete leaves in_doubt unchanged', async () => {
    // "now" is still within the publishing lag window.
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));
    const stmtDate = new Date('2025-01-15T00:00:00Z');

    bank.getStatement.mockResolvedValue([]);

    const order = makeOrder({ status: 'in_doubt', txid: 'txid-abc' });
    repo.findInDoubtByEffectiveDate.mockResolvedValue([order]);

    const result = await service.reconcile({ startDate: stmtDate, endDate: stmtDate });

    expect(repo.markPendingForResend).not.toHaveBeenCalled();
    expect(result.provenAbsent).toBe(0);
  });

  it('overlapping windows are idempotent', async () => {
    vi.setSystemTime(new Date('2025-01-17T01:00:00Z'));
    const stmtDate = new Date('2025-01-15T00:00:00Z');

    const order = makeOrder({ status: 'sent', txid: 'txid-abc' });
    const settlement: Settlement = {
      txid: 'txid-abc',
      amount_minor_units: 1500,
      settled_at: new Date('2025-01-15T23:00:00Z'),
    };

    bank.getStatement.mockResolvedValue([settlement]);
    repo.findByTxid.mockResolvedValue(order);

    const r1 = await service.reconcile({ startDate: stmtDate, endDate: stmtDate });
    const r2 = await service.reconcile({ startDate: stmtDate, endDate: stmtDate });

    // First run settles; second run still calls markSettled (conditional update is a no-op in DB),
    // but from the service's perspective it still reports the match.
    expect(r1.settled).toBe(1);
    expect(r2.settled).toBe(1);
    // upsertSettlement is idempotent (ON CONFLICT DO NOTHING) — called each time but harmless.
    expect(repo.upsertSettlement).toHaveBeenCalledTimes(2);
  });

  it('rejected orders are untouched by reconciliation', async () => {
    vi.setSystemTime(new Date('2025-01-17T01:00:00Z'));
    const stmtDate = new Date('2025-01-15T00:00:00Z');

    const settlement: Settlement = {
      txid: 'txid-abc',
      amount_minor_units: 1500,
      settled_at: new Date('2025-01-15T23:00:00Z'),
    };

    bank.getStatement.mockResolvedValue([settlement]);

    // The order is in 'rejected' status — should not be transitioned.
    const rejectedOrder = makeOrder({ status: 'rejected', txid: 'txid-abc' });
    repo.findByTxid.mockResolvedValue(rejectedOrder);

    const result = await service.reconcile({ startDate: stmtDate, endDate: stmtDate });

    expect(repo.markSettled).not.toHaveBeenCalled();
    expect(result.settled).toBe(0);
  });
});

// ─── deriveTxid ────────────────────────────────────────────────────────────

describe('deriveTxid', () => {
  let service: PaymentService;

  beforeEach(() => {
    const repo = createMockRepo();
    const bank = createMockBank();
    service = makeService(repo, bank);
  });

  it('is deterministic for same input', () => {
    const date = new Date('2025-01-15T00:00:00Z');
    const a = service.deriveTxid('order-1', date);
    const b = service.deriveTxid('order-1', date);
    expect(a).toBe(b);
  });

  it('different orders or dates yield different txids', () => {
    const date = new Date('2025-01-15T00:00:00Z');
    const a = service.deriveTxid('order-1', date);
    const b = service.deriveTxid('order-2', date);
    const c = service.deriveTxid('order-1', new Date('2025-01-16T00:00:00Z'));
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

// ─── Full lifecycle ────────────────────────────────────────────────────────

describe('full lifecycle', () => {
  let repo: ReturnType<typeof createMockRepo>;
  let bank: ReturnType<typeof createMockBank>;
  let service: PaymentService;

  beforeEach(() => {
    vi.useFakeTimers();
    repo = createMockRepo();
    bank = createMockBank();
    service = makeService(repo, bank);
  });

  it('timeout → reconcile proves absent → resend accepted → settle', async () => {
    const order = makeOrder({ attempt_count: 0 });

    // Phase 1: execute → timeout
    vi.setSystemTime(new Date('2025-01-16T10:00:00Z'));
    repo.findPending.mockResolvedValue([order]);
    repo.incrementAttempt.mockResolvedValue(1);
    bank.send.mockRejectedValue(new Error('timeout'));

    await service.executePayments();
    expect(repo.markInDoubt).toHaveBeenCalledWith('order-1', expect.any(Date));

    // Phase 2: reconcile after lag → proven absent
    vi.setSystemTime(new Date('2025-01-17T01:00:00Z'));
    const stmtDate = new Date('2025-01-15T00:00:00Z');
    bank.getStatement.mockResolvedValue([]);
    repo.findInDoubtByEffectiveDate.mockResolvedValue([{ ...order, status: 'in_doubt' }]);

    await service.reconcile({ startDate: stmtDate, endDate: stmtDate });
    expect(repo.markPendingForResend).toHaveBeenCalledWith('order-1');

    // Phase 3: resend → accepted
    vi.setSystemTime(new Date('2025-01-17T02:00:00Z'));
    const resentOrder = makeOrder({ attempt_count: 1, status: 'pending' });
    repo.findPending.mockResolvedValue([resentOrder]);
    repo.incrementAttempt.mockResolvedValue(2);
    bank.send.mockResolvedValue({ status: 'accepted' });

    await service.executePayments();
    expect(repo.markSent).toHaveBeenCalledWith('order-1', expect.any(Date));

    // Phase 4: reconcile → settled
    vi.setSystemTime(new Date('2025-01-18T01:00:00Z'));
    const settlement: Settlement = {
      txid: 'txid-abc',
      amount_minor_units: 1500,
      settled_at: new Date('2025-01-17T02:30:00Z'),
    };
    bank.getStatement.mockResolvedValue([settlement]);
    repo.findByTxid.mockResolvedValue({ ...order, status: 'sent' });

    const result = await service.reconcile({ startDate: stmtDate, endDate: stmtDate });
    expect(repo.markSettled).toHaveBeenCalledWith('order-1', settlement.settled_at);
    expect(result.settled).toBe(1);
  });

  it('5 timeouts → parked_manual_review, and a 6th reconcile does not modify it', async () => {
    // Simulate 5 failed attempts by parking the order.
    const exhaustedOrder = makeOrder({ attempt_count: 5 });
    repo.findPending.mockResolvedValue([exhaustedOrder]);

    vi.setSystemTime(new Date('2025-01-16T10:00:00Z'));
    await service.executePayments();

    expect(bank.send).not.toHaveBeenCalled();
    expect(repo.markParked).toHaveBeenCalledWith('order-1');

    // A subsequent reconcile must not touch a parked order.
    vi.setSystemTime(new Date('2025-01-17T01:00:00Z'));
    const stmtDate = new Date('2025-01-15T00:00:00Z');
    bank.getStatement.mockResolvedValue([]);
    // findInDoubtByEffectiveDate should not return parked orders (they are not in_doubt).
    repo.findInDoubtByEffectiveDate.mockResolvedValue([]);

    await service.reconcile({ startDate: stmtDate, endDate: stmtDate });
    expect(repo.markPendingForResend).not.toHaveBeenCalled();
    expect(repo.markSettled).not.toHaveBeenCalled();
  });
});
```
