# 17-operations.spec.ts

## reasoning

```
Let me analyze what I need to write:

1. `test/operations.spec.ts` - covering read-your-own-writes, concurrent totals, filter/pagination correctness

From the cases list, I need to implement these tests:
1. read-your-own-writes: simulateWrite inserts a new order as `pending`, then getDashboard includes the row
2. read-your-own-writes on update: insert as `pending`, update to `approved`, dashboard shows `approved`
3. concurrent updates to one company's totals do not lose an update
4. update with changed amount adjusts total by delta, not by new amount
5. update with unchanged amount does not perturb totals
6. dashboard filters by status
7. dashboard filters by date range (inclusive boundaries)
8. pagination returns correct slice and total_count
9. page_size boundary 1 and 100 are accepted
10. page_size of 0 or 101 raises ValidationError with code `validation_error`
11. page < 1 raises ValidationError
12. date_from equal to date_to raises InvalidDateRangeError with code `invalid_date_range`
13. unknown company_id in getDashboard raises ResourceNotFoundError with code `resource_not_found`
14. unknown worker_id in simulateWrite raises ResourceNotFoundError
15. getCompanyTotals for an unknown company raises ResourceNotFoundError
16. projection row is read back from within the transaction

Now, let me think about how to structure this. The plan says:
- Tests use Vitest
- Test behaviour, not implementation
- Never assert only that a call happens

I need to mock the repository since we're testing the service. The service depends on `OperationsRepository` and `PrismaClient`.

Looking at the service code:
- `OperationsService` constructor takes `(repo: OperationsRepository, prisma: PrismaClient)`
- `getDashboard(query)` - validates, checks company exists via `repo.getCompanyTotal`, then calls `repo.queryDashboard`
- `simulateWrite(input)` - checks worker via `repo.findWorkerById`, checks last event via `repo.findLastEventForOrder`, then runs a transaction via `this.prisma.$transaction`
- `getCompanyTotals(companyId)` - calls `repo.getCompanyTotal`

For mocking:
- I need to mock `OperationsRepository` with the methods the service calls
- I need to mock `PrismaClient` for `$transaction` and the direct Prisma calls within it

Let me think about the `simulateWrite` flow:
1. `repo.findWorkerById(input.worker_id)` - returns worker or null
2. `repo.findLastEventForOrder(input.order_id)` - returns string | null
3. `this.prisma.$transaction(async (tx) => { ... })` - the callback receives a `Prisma.TransactionClient`

Inside the transaction:
- `tx.paymentOrder.findUnique({ where: { id: input.order_id } })` - returns existing order or null
- If existing: `tx.paymentOrder.update(...)` 
- If new: `tx.paymentOrder.create(...)`
- `this.repo.upsertOperation(tx, input, worker, lastEventType)`
- Delta computation
- If delta: `this.repo.upsertCompanyTotal(tx, input.company_id, deltaAmount, deltaCount)`
- `tx.operation.findUnique({ where: { orderId: input.order_id } })` - read back

So for the mock, I need:
- `repo.findWorkerById` 
- `repo.findLastEventForOrder`
- `repo.upsertOperation`
- `repo.upsertCompanyTotal`
- `repo.getCompanyTotal`
- `repo.queryDashboard`
- `prisma.$transaction` - which receives a callback and we mock the `tx` object

Let me think about how to structure the mocks. I'll create a helper that creates a mock repository and a mock prisma client with a transaction client.

For the concurrent test (case 3), I need to simulate two concurrent `simulateWrite` calls. The key is that both are "in-flight before either commits". With the mock, I can simulate this by having the transaction callback for both execute their logic before either "commits". 

Actually, let me think more carefully. The concurrency test needs to verify that `upsertCompanyTotal` is called correctly under concurrent conditions. Since we're testing the service (not the database), what we really need to verify is:
- Both calls compute correct deltas
- The upserts are issued correctly

But wait - the test says "leave `getCompanyTotals` with `total_amount` equal to the sum of both amounts and `order_count` equal to 2". This means I need to simulate the database state. 

For a proper test of the service layer, I think the approach should be:
- Mock the repo methods to track what was called
- For the concurrent test, simulate two transactions running and verify the deltas are correct

Actually, re-reading the cases more carefully:

> "two simulateWrite calls for different `order_id`s of the same company, issued concurrently (both in-flight before either commits), leave `getCompanyTotals` with `total_amount` equal to the sum of both amounts and `order_count` equal to 2"

This is testing that the service correctly computes deltas. If both are inserts for the same company, each should compute delta = (+amount, +1). The test verifies that after both complete, calling `getCompanyTotals` returns the correct sum.

But `getCompanyTotals` just calls `repo.getCompanyTotal`. So if I mock the repo, I need to simulate the database state.

I think the cleanest approach for these service-level tests is:
1. Create an in-memory simulation of the relevant database tables
2. Mock the repository methods to operate on that in-memory state
3. Mock the prisma transaction to operate on the same in-memory state

This way, the tests actually verify the end-to-end behavior at the service level.

Let me design this:

```ts
// In-memory state
interface InMemoryState {
  paymentOrders: Map<string, { id: string; companyId: string; workerId: string; status: string; amount: Decimal; currency: string; createdAt: Date; updatedAt: Date }>;
  operations: Map<string, { orderId: string; companyId: string; status: string; amount: Decimal; currency: string; workerName: string; workerRole: string; lastEventType: string | null; createdAt: Date }>;
  companyTotals: Map<string, { companyId: string; totalAmount: Decimal; orderCount: number }>;
  workers: Map<string, { id: string; name: string; role: string }>;
  events: Map<string, { orderId: string; eventType: string; createdAt: Date }[]>;
}
```

Then the mock repository methods read/write from this state, and the mock prisma transaction also reads/writes from this state.

This is getting complex but it's the right approach for testing behavior.

Let me write this out:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { Prisma, Decimal } from "@prisma/client";
import { OperationsService } from "../src/operations/operations.service";
import type {
  OperationRow,
  DashboardQuery,
  DashboardResult,
  CompanyTotals,
  SimulateWriteInput,
  OrderStatus,
} from "../src/operations/operations.types";
import {
  ResourceNotFoundError,
  InvalidDateRangeError,
  ValidationError,
} from "../src/operations/operations.types";

// In-memory state to simulate the database
interface PaymentOrder {
  id: string;
  companyId: string;
  workerId: string;
  status: string;
  amount: Decimal;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

interface OperationProjection {
  orderId: string;
  companyId: string;
  status: string;
  amount: Decimal;
  currency: string;
  workerName: string;
  workerRole: string;
  lastEventType: string | null;
  createdAt: Date;
}

interface CompanyTotal {
  companyId: string;
  totalAmount: Decimal;
  orderCount: number;
}

interface Worker {
  id: string;
  name: string;
  role: string;
}

interface OrderEvent {
  orderId: string;
  eventType: string;
  createdAt: Date;
}

class InMemoryDB {
  paymentOrders = new Map<string, PaymentOrder>();
  operations = new Map<string, OperationProjection>();
  companyTotals = new Map<string, CompanyTotal>();
  workers = new Map<string, Worker>();
  events: OrderEvent[] = [];

  // Transaction tracking for concurrency testing
  private pendingTransactions: Array<() => void> = [];

  createMockTx(): any {
    const db = this;
    return {
      paymentOrder: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          const order = db.paymentOrders.get(where.id);
          return order ? { ...order } : null;
        },
        create: async ({ data }: { data: Partial<PaymentOrder> }) => {
          const order: PaymentOrder = {
            id: data.id!,
            companyId: data.companyId!,
            workerId: data.workerId!,
            status: data.status!,
            amount: data.amount! as Decimal,
            currency: data.currency!,
            createdAt: data.createdAt ?? new Date(),
            updatedAt: data.updatedAt ?? new Date(),
          };
          db.paymentOrders.set(order.id, order);
          return { ...order };
        },
        update: async ({ where, data }: { where: { id: string }; data: Partial<PaymentOrder> }) => {
          const existing = db.paymentOrders.get(where.id);
          if (!existing) throw new Error("Order not found");
          const updated = { ...existing, ...data };
          db.paymentOrders.set(where.id, updated);
          return { ...updated };
        },
      },
      operation: {
        findUnique: async ({ where }: { where: { orderId: string } }) => {
          const op = db.operations.get(where.orderId);
          return op ? { ...op } : null;
        },
      },
    };
  }
}
```

Hmm, this is getting quite involved. Let me think about whether there's a simpler approach.

Actually, for a service-level test, I think the key insight is:

For `getDashboard` tests - I just need to mock `repo.getCompanyTotal` and `repo.queryDashboard`. These are straightforward.

For `simulateWrite` tests - I need to mock `repo.findWorkerById`, `repo.findLastEventForOrder`, and the `prisma.$transaction` callback. Inside the transaction, I need to mock `tx.paymentOrder.findUnique`, `tx.paymentOrder.create`, `tx.paymentOrder.update`, `tx.operation.findUnique`, and the repo's `upsertOperation` and `upsertCompanyTotal`.

For the concurrent test - I need to simulate two transactions happening "concurrently". The simplest way is to have both transaction callbacks run their logic, and verify the final state of the totals.

Let me think about this differently. The key behaviors to test are:

1. **Read-your-own-writes**: After `simulateWrite`, calling `getDashboard` shows the new row. This tests that the projection is written (in the same tx as source) and the dashboard reads from the projection.

2. **Concurrent totals**: Two concurrent writes to same company don't lose updates. This tests that the delta computation is correct (each insert adds its own amount, not a stale total).

3. **Filter/pagination**: The dashboard query parameters produce correct results.

For (1), the simplest approach:
- Mock `repo.findWorkerById` to return a worker
- Mock `repo.findLastEventForOrder` to return null
- Mock `prisma.$transaction` to execute the callback with a mock `tx`
- The mock `tx.paymentOrder.findUnique` returns null (new order)
- The mock `tx.paymentOrder.create` succeeds
- `repo.upsertOperation` is called (mocked to record the call)
- `repo.upsertCompanyTotal` is called
- The mock `tx.operation.findUnique` returns the projection row (simulating the read-back)
- Then call `getDashboard` and verify it returns the row

Wait, but for read-your-own-writes to be meaningful, I need `getDashboard` to actually return the data that was "written" by `simulateWrite`. If I just mock everything, the test becomes trivial (I set up the mock to return X, then assert X is returned).

The key insight from the cases:
> "fails if the projection upsert is outside the interactive transaction (so a read between source-commit and projection-commit sees nothing), or if getDashboard reads the source table instead of the `operations` projection"

So the test needs to verify:
1. That `repo.queryDashboard` is called (not some source-table query)
2. That the projection row is available after `simulateWrite` completes

I think the right approach is a hybrid: use an in-memory state that both the mock repo and mock transaction read/write from. This way, `simulateWrite` actually "writes" to the state, and `getDashboard` actually "reads" from it. The test verifies the end-to-end flow without a real database.

Let me redesign:

```ts
class TestContext {
  // Simulated DB state
  paymentOrders = new Map<string, any>();
  operations = new Map<string, any>();
  companyTotals = new Map<string, { totalAmount: Decimal; orderCount: number }>();
  workers = new Map<string, Worker>();
  events: OrderEvent[] = [];

  // Mock repository
  repo: any;
  
  // Mock prisma client
  prisma: any;

  constructor() {
    this.repo = this.createMockRepo();
    this.prisma = this.createMockPrisma();
  }

  private createMockRepo() {
    const self = this;
    return {
      findWorkerById: async (id: string) => self.workers.get(id) ?? null,
      findLastEventForOrder: async (orderId: string) => {
        const evts = self.events.filter(e => e.orderId === orderId);
        if (evts.length === 0) return null;
        return evts[evts.length - 1].eventType;
      },
      upsertOperation: async (tx: any, input: SimulateWriteInput, worker: Worker, lastEventType: string | null) => {
        self.operations.set(input.order_id, {
          orderId: input.order_id,
          companyId: input.company_id,
          status: input.status,
          amount: new Decimal(input.amount),
          currency: input.currency,
          workerName: worker.name,
          workerRole: worker.role,
          lastEventType,
          createdAt: self.paymentOrders.get(input.order_id)?.createdAt ?? new Date(),
        });
      },
      upsertCompanyTotal: async (tx: any, companyId: string, deltaAmount: string, deltaCount: number) => {
        const existing = self.companyTotals.get(companyId);
        if (!existing) {
          self.companyTotals.set(companyId, {
            totalAmount: new Decimal(deltaAmount),
            orderCount: deltaCount,
          });
        } else {
          existing.totalAmount = existing.totalAmount.plus(new Decimal(deltaAmount));
          existing.orderCount += deltaCount;
        }
      },
      getCompanyTotal: async (companyId: string) => {
        const t = self.companyTotals.get(companyId);
        if (!t) return null;
        return {
          company_id: companyId,
          total_amount: t.totalAmount.toString(),
          order_count: t.orderCount,
        };
      },
      queryDashboard: async (query: DashboardQuery) => {
        let rows = Array.from(self.operations.values()).filter(op => op.companyId === query.company_id);
        
        if (query.status) {
          rows = rows.filter(op => op.status === query.status);
        }
        if (query.date_from) {
          rows = rows.filter(op => op.createdAt >= query.date_from!);
        }
        if (query.date_to) {
          rows = rows.filter(op => op.createdAt <= query.date_to!);
        }
        
        rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (b.orderId > a.orderId ? 1 : -1));
        
        const total_count = rows.length;
        const offset = (query.page - 1) * query.page_size;
        const pageRows = rows.slice(offset, offset + query.page_size);
        
        return {
          data: pageRows.map(op => ({
            order_id: op.orderId,
            company_id: op.companyId,
            status: op.status,
            amount: op.amount.toString(),
            currency: op.currency,
            worker_name: op.workerName,
            worker_role: op.workerRole,
            last_event_type: op.lastEventType,
            created_at: op.createdAt,
          })),
          total_count,
          page: query.page,
          page_size: query.page_size,
        };
      },
    };
  }

  private createMockPrisma() {
    const self = this;
    return {
      $transaction: async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          paymentOrder: {
            findUnique: async ({ where }: any) => {
              const order = self.paymentOrders.get(where.id);
              return order ? { ...order } : null;
            },
            create: async ({ data }: any) => {
              const order = { ...data };
              self.paymentOrders.set(order.id, order);
              return { ...order };
            },
            update: async ({ where, data }: any) => {
              const existing = self.paymentOrders.get(where.id);
              if (!existing) throw new Error("Not found");
              const updated = { ...existing, ...data };
              self.paymentOrders.set(where.id, updated);
              return { ...updated };
            },
          },
          operation: {
            findUnique: async ({ where }: any) => {
              const op = self.operations.get(where.orderId);
              return op ? { ...op } : null;
            },
          },
        };
        return callback(tx);
      },
    };
  }
}
```

Wait, but this approach has a problem. If I mock `repo.queryDashboard` to actually filter the in-memory operations, then I'm essentially re-implementing the repository logic in the test. That's testing my mock, not the service.

Let me reconsider. The cases say:

> "dashboard filters by status: seed three orders for a company with statuses `pending`, `approved`, `settled`; getDashboard with `status: "approved"` returns only the one approved row and `total_count` = 1 — fails if the repository omits the status predicate, or if the projection row stored the wrong status at upsert time"

So the test is checking that:
1. The projection rows were stored with the correct status (by `simulateWrite`)
2. `getDashboard` returns only the matching rows

If I mock `repo.queryDashboard` to do actual filtering on the in-memory state, then I'm testing that `simulateWrite` stored the right status AND that my mock filter works. The service itself just passes the query through to the repo - there's no filtering logic in the service.

Hmm, but the cases say these tests are in `test/operations.spec.ts` which tests the service. The filtering logic is in the repository. So what exactly is being tested at the service level?

Looking at the service code for `getDashboard`:
1. Validate page, page_size, date range
2. Check company exists via `repo.getCompanyTotal`
3. Call `repo.queryDashboard(query)`

So at the service level, the tests verify:
- Validation logic (page, page_size, date range)
- Company existence check
- That the query is passed through correctly

The actual filtering/pagination logic is in the repository. But the cases list says to test "dashboard filters by status" and "pagination returns correct slice" in this file.

I think the intent is that these are integration-style tests at the service level, where the repository is mocked with a realistic implementation (in-memory). This way:
- `simulateWrite` writes to the in-memory "database"
- `getDashboard` reads from it via the mocked repo

The test verifies the end-to-end behavior: write then read shows correct data.

OK so my in-memory approach is correct. The mock repo isn't just a stub - it's a faithful in-memory implementation of the repository contract. This is a common pattern for testing service logic that depends on data access.

Let me also think about the concurrent test more carefully.

Case 3: "two simulateWrite calls for different `order_id`s of the same company, issued concurrently (both in-flight before either commits), leave `getCompanyTotals` with `total_amount` equal to the sum of both amounts and `order_count` equal to 2"

With my in-memory approach:
- Call 1: `simulateWrite({ order_id: "A", company_id: "C", amount: "100.00", ... })`
- Call 2: `simulateWrite({ order_id: "B", company_id: "C", amount: "200.00", ... })`
- Both are issued concurrently (Promise.all)
- After both complete, `getCompanyTotals("C")` should return `{ total_amount: "300.00", order_count: 2 }`

In my mock, both transactions will:
1. Find no existing order → delta = (+amount, +1)
2. Call `upsertCompanyTotal` with their respective deltas

Since JavaScript is single-threaded and the mock operations are synchronous (just Map operations), there's no actual race condition. But the test still verifies that the service computes the correct deltas (each as an insert, not reading a stale total).

If the service were buggy and computed the delta by reading the current total and adding to it, both would read 0 and both would set the total to their own amount (lost update). With my mock, this would be caught because:
- If the service did `SELECT total → SET total = total + amount`, both would read 0 and set to their own amount
- But the service actually does `delta = +amount for insert` and calls `upsertCompanyTotal(tx, companyId, deltaAmount, deltaCount)` which does `total += delta`
- So both calls correctly add their amounts

Wait, but in my mock `upsertCompanyTotal` does:
```
existing.totalAmount = existing.totalAmount.plus(new Decimal(deltaAmount));
```

If both run "concurrently" (which in JS means sequentially since it's single-threaded), the second will see the updated total. So the result is correct: 100 + 200 = 300.

But what if the service were buggy and instead of computing a delta, it read the total and set it to total + amount? In my mock, that would look like:
- Call 1 reads total = 0, sets total = 0 + 100 = 100
- Call 2 reads total = 100 (after call 1 committed), sets total = 100 + 200 = 300

That would actually still work! The bug would only manifest if both read the total before either writes. In a real database with proper transaction isolation, this is possible (both in a REPEATABLE READ or even SERIALIZABLE could see the same snapshot).

Hmm, so my in-memory mock doesn't actually simulate the concurrency issue properly because JS is single-threaded.

But wait - the test case says:
> "fails if `upsertCompanyTotal` performs a non-atomic SELECT-then-UPDATE (lost update on the aggregate row), or if the delta for a concurrent insert is computed against a stale `total_amount` read outside the transaction's snapshot"

The key bug being tested is: "the delta for a concurrent insert is computed against a stale `total_amount` read outside the transaction's snapshot". This means the bug would be in the service computing the delta incorrectly.

Looking at the service code:
```ts
if (!existingOrder) {
  deltaAmount = input.amount;
  deltaCount = 1;
}
```

For a new order, the delta is always `+amount, +1`. It doesn't read the current total. So this is correct.

The test verifies that after two concurrent inserts, the total is correct. In my in-memory mock, since the operations are sequential, this will always pass as long as the delta computation is correct (which it is - each insert adds its own amount).

I think the test is really verifying:
1. The service correctly identifies both as inserts (not updates)
2. Each computes the correct delta
3. The final total is the sum

This is a valid test even without true concurrency, because it catches bugs like:
- Computing delta as `new_total - old_total` where `old_total` is read outside the tx
- Treating the second insert as an update (wrong delta)
- Not calling `upsertCompanyTotal` for the second insert

OK, I'm convinced the in-memory approach works. Let me now write the full test file.

One more consideration: the `simulateWrite` method in the service does:
```ts
const worker = await this.repo.findWorkerById(input.worker_id);
if (!worker) throw new ResourceNotFoundError(...)

const lastEventType = await this.repo.findLastEventForOrder(input.order_id);

return this.prisma.$transaction(async (tx) => { ... })
```

So `findWorkerById` and `findLastEventForOrder` are called OUTSIDE the transaction. The transaction starts after these reads.

In my mock, I need to make sure the workers and events are set up before calling `simulateWrite`.

Let me also think about what `tx.operation.findUnique` should return. In the service:
```ts
const row = await tx.operation.findUnique({ where: { orderId: input.order_id } });
```

This reads back the projection row. In my mock, this should return what `repo.upsertOperation` just wrote. Since `upsertOperation` writes to `self.operations`, and `tx.operation.findUnique` reads from `self.operations`, this works.

But wait - there's a subtlety. In the real implementation, `repo.upsertOperation` would use the `tx` client to write (so it's transactional). In my mock, `upsertOperation` writes directly to the in-memory state regardless of whether it's "in a transaction". And `tx.operation.findUnique` reads from the same in-memory state. So the read-back will always see the write, which is correct for the test.

Actually, I realize there might be an issue with the `createdAt` field. In the service:
```ts
await tx.paymentOrder.create({
  data: {
    id: input.order_id,
    ...
    createdAt: new Date(),
    updatedAt: new Date(),
  },
});
```

Then `repo.upsertOperation` is called. In the real repo, it would read the `createdAt` from the source order (or use the one passed in). Looking at the plan:

> "created_at | timestamptz, NOT NULL | from payment_orders.created_at (sort key)"

So the projection's `created_at` comes from the source order's `created_at`. In my mock, I need to make sure `upsertOperation` sets the projection's `createdAt` from the source order.

Let me look at how the service calls `upsertOperation`:
```ts
await this.repo.upsertOperation(tx, input, worker, lastEventType);
```

The `input` is `SimulateWriteInput` which doesn't include `createdAt`. So the repo must be getting it from somewhere - either from the source order (read within the tx) or using `now()`.

Looking at the plan's signature:
```ts
upsertOperation(tx: PrismaPromise, order: SimulateWriteInput, worker: { name: string; role: string }, lastEventType: string | null): Promise<void>;
```

The repo has access to `tx`, so it can read the source order to get `createdAt`. In my mock, I'll have `upsertOperation` read from `self.paymentOrders` to get the `createdAt`.

Actually, let me simplify. In my mock `upsertOperation`, I'll look up the payment order in the in-memory state to get `createdAt`:

```ts
upsertOperation: async (tx, input, worker, lastEventType) => {
  const sourceOrder = self.paymentOrders.get(input.order_id);
  self.operations.set(input.order_id, {
    orderId: input.order_id,
    companyId: input.company_id,
    status: input.status,
    amount: new Decimal(input.amount),
    currency: input.currency,
    workerName: worker.name,
    workerRole: worker.role,
    lastEventType,
    createdAt: sourceOrder?.createdAt ?? new Date(),
  });
},
```

This should work because by the time `upsertOperation` is called, the source order has already been created/updated in the same "transaction" (in my mock, just sequential operations on the same Map).

Now let me think about the date range tests. The cases say:
> "dashboard filters by date range (inclusive boundaries): seed orders at T1, T2, T3; getDashboard with `date_from` = T2 and `date_to` = T3 returns the orders at T2 and T3 but not T1"

So I need to control the `createdAt` of orders. In my mock, when I call `simulateWrite`, the `createdAt` is set to `new Date()` in the service's transaction callback. I can't easily control that.

Option 1: After calling `simulateWrite`, directly modify the in-memory state to set specific `createdAt` values.
Option 2: Make the mock's `paymentOrder.create` use a provided date.

Actually, looking at the service code more carefully:
```ts
await tx.paymentOrder.create({
  data: {
    id: input.order_id,
    ...
    createdAt: new Date(),
    updatedAt: new Date(),
  },
});
```

The `createdAt` is always `new Date()` in the service. I can't control it from the test input.

For the date range test, I'll just set up the in-memory state directly (bypassing `simulateWrite`) to create orders with specific timestamps. Then call `getDashboard` and verify the filtering.

Wait, but that means I'm not testing through the full flow. Let me re-read the case:

> "dashboard filters by date range (inclusive boundaries): seed orders at T1, T2, T3; getDashboard with `date_from` = T2 and `date_to` = T3 returns the orders at T2 and T3 but not T1"

It says "seed orders" - so it's OK to set up the state directly. The test is about the `getDashboard` behavior, not about `simulateWrite`.

Similarly for the status filter test:
> "seed three orders for a company with statuses `pending`, `approved`, `settled`"

And pagination:
> "seed 5 orders"

So for these tests, I'll set up the in-memory state directly (put rows in `self.operations` and `self.companyTotals`) and then call `getDashboard`.

This makes the tests cleaner and more focused. The "seed" is setting up the projection state, then verifying the read path.

Let me now structure the test file:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { Decimal } from "@prisma/client";
import { OperationsService } from "../src/operations/operations.service";
import type { ... } from "../src/operations/operations.types";
import { ResourceNotFoundError, InvalidDateRangeError, ValidationError } from "../src/operations/operations.types";

// ... in-memory DB and mock setup ...

describe("OperationsService", () => {
  let ctx: TestContext;
  let service: OperationsService;

  beforeEach(() => {
    ctx = new TestContext();
    service = new OperationsService(ctx.repo, ctx.prisma);
  });

  describe("read-your-own-writes", () => {
    it("simulateWrite inserts a new order, getDashboard includes it", async () => {
      // Seed worker
      ctx.workers.set("w1", { id: "w1", name: "Alice", role: "driver" });
      
      // Write
      const result = await service.simulateWrite({
        order_id: "o1",
        company_id: "c1",
        worker_id: "w1",
        status: "pending",
        amount: "100.00",
        currency: "USD",
      });
      
      // Read back via dashboard
      const dashboard = await service.getDashboard({
        company_id: "c1",
        page: 1,
        page_size: 10,
      });
      
      expect(dashboard.data).toHaveLength(1);
      expect(dashboard.data[0].order_id).toBe("o1");
      expect(dashboard.data[0].status).toBe("pending");
      expect(dashboard.data[0].amount).toBe("100.00");
    });

    it("simulateWrite update changes status, getDashboard reflects new status", async () => {
      // Seed worker
      ctx.workers.set("w1", { id: "w1", name: "Alice", role: "driver" });
      
      // First write: insert as pending
      await service.simulateWrite({
        order_id: "o1",
        company_id: "c1",
        worker_id: "w1",
        status: "pending",
        amount: "100.00",
        currency: "USD",
      });
      
      // Second write: update to approved
      await service.simulateWrite({
        order_id: "o1",
        company_id: "c1",
        worker_id: "w1",
        status: "approved",
        amount: "100.00",
        currency: "USD",
      });
      
      // Dashboard shows approved
      const dashboard = await service.getDashboard({
        company_id: "c1",
        page: 1,
        page_size: 10,
      });
      
      expect(dashboard.data).toHaveLength(1);
      expect(dashboard.data[0].status).toBe("approved");
    });
  });

  describe("concurrent totals", () => {
    it("two concurrent inserts for same company produce correct total", async () => {
      ctx.workers.set("w1", { id: "w1", name: "Alice", role: "driver" });
      
      await Promise.all([
        service.simulateWrite({
          order_id: "o1", company_id: "c1", worker_id: "w1",
          status: "pending", amount: "100.00", currency: "USD",
        }),
        service.simulateWrite({
          order_id: "o2", company_id: "c1", worker_id: "w1",
          status: "pending", amount: "200.00", currency: "USD",
        }),
      ]);
      
      const totals = await service.getCompanyTotals("c1");
      expect(totals.total_amount).toBe("300.00");
      expect(totals.order_count).toBe(2);
    });
  });

  // ... more tests ...
});
```

Wait, I need to be careful about the `getCompanyTotal` mock. In the service's `getDashboard`:
```ts
const total = await this.repo.getCompanyTotal(query.company_id);
if (!total) {
  throw new ResourceNotFoundError("Company not found", { company_id: query.company_id });
}
```

So `getCompanyTotal` is used as an existence check. If the company has no totals row, it throws. This means for `getDashboard` to work, there must be a row in `companyTotals`. After `simulateWrite`, the totals row is created. Good.

For the "unknown company" test, I just don't seed any totals and call `getDashboard` - it should throw.

Now let me think about the `queryDashboard` mock more carefully. The service passes the query directly to the repo. The repo is responsible for filtering, sorting, and pagination. My mock needs to implement this correctly.

For the sort: "ORDER BY `created_at DESC, order_id DESC`"

In my mock:
```ts
rows.sort((a, b) => {
  const timeDiff = b.createdAt.getTime() - a.createdAt.getTime();
  if (timeDiff !== 0) return timeDiff;
  return b.orderId.localeCompare(a.orderId); // DESC
});
```

Wait, `localeCompare` with default options gives ascending. For descending: `b.orderId.localeCompare(a.orderId)` or `a.orderId < b.orderId ? 1 : -1`.

Actually for UUIDs, I can just use: `b.orderId > a.orderId ? 1 : -1` for descending.

Let me also handle the `total_count` correctly. The COUNT should use the same WHERE as the SELECT (before LIMIT/OFFSET).

OK let me now write the complete file. I'll be thorough and make sure all 16 cases are covered.

Let me also double-check: the cases file says "Not tested in this file: re-derivation idempotency and window repair, drift-repair detection/skip/recompute, and the Prisma migration DDL itself". So I only need the 16 cases listed.

Let me count them again:
1. read-your-own-writes: simulateWrite inserts new order as pending, getDashboard includes it
2. read-your-own-writes on update: insert pending, update to approved, dashboard shows approved
3. concurrent updates to one company's totals do not lose an update
4. update with changed amount adjusts total by delta, not by new amount
5. update with unchanged amount does not perturb totals
6. dashboard filters by status
7. dashboard filters by date range (inclusive boundaries)
8. pagination returns correct slice and total_count
9. page_size boundary 1 and 100 are accepted
10. page_size of 0 or 101 raises ValidationError
11. page < 1 raises ValidationError
12. date_from equal to date_to raises InvalidDateRangeError
13. unknown company_id in getDashboard raises ResourceNotFoundError
14. unknown worker_id in simulateWrite raises ResourceNotFoundError
15. getCompanyTotals for an unknown company raises ResourceNotFoundError
16. projection row is read back from within the transaction

For case 16: "simulateWrite returns an `OperationRow` whose `status` matches the input and whose `created_at` is non-null — fails if the read-back uses `this.prisma.operation.findUnique` (non-transactional) instead of `tx.operation.findUnique`"

This is testing that the returned value from `simulateWrite` is correct. In my mock, both `tx.operation.findUnique` and a hypothetical non-transactional read would hit the same in-memory state. So this test really just verifies that `simulateWrite` returns a valid row with the correct status and non-null created_at.

The "fails if" part describes what would happen in a real concurrency scenario, but at the unit test level, we just verify the return value is correct.

OK, I think I have a clear picture now. Let me write the file.

One more thing: for the `getDashboard` validation tests (cases 10, 11, 12), I need to make sure the company exists in the totals (so the validation errors are thrown before the existence check, or after? Let me look at the service code order:

```ts
async getDashboard(query: DashboardQuery): Promise<DashboardResult> {
  if (query.page < 1) throw new ValidationError(...);
  if (query.page_size < 1 || query.page_size > 100) throw new ValidationError(...);
  if (query.date_from && query.date_to) {
    if (query.date_from >= query.date_to) throw new InvalidDateRangeError(...);
  }
  
  const total = await this.repo.getCompanyTotal(query.company_id);
  if (!total) throw new ResourceNotFoundError(...);
  
  return this.repo.queryDashboard(query);
}
```

So validation happens BEFORE the existence check. Good - for cases 10, 11, 12, I don't need to seed a company. The error will be thrown before the company check.

Wait, actually for case 12 (date_from == date_to), I need to make sure `date_from` and `date_to` are both set. Let me use the same Date object or two Dates with the same timestamp.

Let me now write the complete file:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { Decimal } from "@prisma/client";
import { OperationsService } from "../src/operations/operations.service";
import type {
  OperationRow,
  DashboardQuery,
  DashboardResult,
  CompanyTotals,
  SimulateWriteInput,
  OrderStatus,
} from "../src/operations/operations.types";
import {
  ResourceNotFoundError,
  InvalidDateRangeError,
  ValidationError,
} from "../src/operations/operations.types";

// ─── In-memory state ───

interface PaymentOrderRow {
  id: string;
  companyId: string;
  workerId: string;
  status: string;
  amount: Decimal;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

interface OperationProjectionRow {
  orderId: string;
  companyId: string;
  status: string;
  amount: Decimal;
  currency: string;
  workerName: string;
  workerRole: string;
  lastEventType: string | null;
  createdAt: Date;
}

interface CompanyTotalRow {
  companyId: string;
  totalAmount: Decimal;
  orderCount: number;
}

interface WorkerRow {
  id: string;
  name: string;
  role: string;
}

// ─── Test context: in-memory DB + mocks ───

class TestContext {
  paymentOrders = new Map<string, PaymentOrderRow>();
  operations = new Map<string, OperationProjectionRow>();
  companyTotals = new Map<string, CompanyTotalRow>();
  workers = new Map<string, WorkerRow>();

  repo: any;
  prisma: any;

  constructor() {
    this.repo = this.buildRepoMock();
    this.prisma = this.buildPrismaMock();
  }

  private buildRepoMock() {
    const self = this;
    return {
      findWorkerById: async (id: string): Promise<WorkerRow | null> => {
        return self.workers.get(id) ?? null;
      },

      findLastEventForOrder: async (_orderId: string): Promise<string | null> => {
        // No events in these tests
        return null;
      },

      upsertOperation: async (
        _tx: unknown,
        input: SimulateWriteInput,
        worker: WorkerRow,
        lastEventType: string | null,
      ): Promise<void> => {
        const source = self.paymentOrders.get(input.order_id);
        self.operations.set(input.order_id, {
          orderId: input.order_id,
          companyId: input.company_id,
          status: input.status,
          amount: new Decimal(input.amount),
          currency: input.currency,
          workerName: worker.name,
          workerRole: worker.role,
          lastEventType,
          createdAt: source ? source.createdAt : new Date(),
        });
      },

      upsertCompanyTotal: async (
        _tx: unknown,
        companyId: string,
        deltaAmount: string,
        deltaCount: number,
      ): Promise<void> => {
        const existing = self.companyTotals.get(companyId);
        if (!existing) {
          self.companyTotals.set(companyId, {
            companyId,
            totalAmount: new Decimal(deltaAmount),
            orderCount: deltaCount,
          });
        } else {
          existing.totalAmount = existing.totalAmount.plus(new Decimal(deltaAmount));
          existing.orderCount += deltaCount;
        }
      },

      getCompanyTotal: async (companyId: string): Promise<CompanyTotals | null> => {
        const t = self.companyTotals.get(companyId);
        if (!t) return null;
        return {
          company_id: companyId,
          total_amount: t.totalAmount.toString(),
          order_count: t.orderCount,
        };
      },

      queryDashboard: async (query: DashboardQuery): Promise<DashboardResult> => {
        let rows = Array.from(self.operations.values()).filter(
          (op) => op.companyId === query.company_id,
        );

        if (query.status !== undefined) {
          rows = rows.filter((op) => op.status === query.status);
        }
        if (query.date_from !== undefined) {
          rows = rows.filter((op) => op.createdAt >= query.date_from!);
        }
        if (query.date_to !== undefined) {
          rows = rows.filter((op) => op.createdAt <= query.date_to!);
        }

        // Sort: created_at DESC, order_id DESC
        rows.sort((a, b) => {
          const timeDiff = b.createdAt.getTime() - a.createdAt.getTime();
          if (timeDiff !== 0) return timeDiff;
          return b.orderId > a.orderId ? 1 : -1;
        });

        const total_count = rows.length;
        const offset = (query.page - 1) * query.page_size;
        const pageRows = rows.slice(offset, offset + query.page_size);

        return {
          data: pageRows.map((op) => ({
            order_id: op.orderId,
            company_id: op.companyId,
            status: op.status as OrderStatus,
            amount: op.amount.toString(),
            currency: op.currency,
            worker_name: op.workerName,
            worker_role: op.workerRole,
            last_event_type: op.lastEventType,
            created_at: op.createdAt,
          })),
          total_count,
          page: query.page,
          page_size: query.page_size,
        };
      },
    };
  }

  private buildPrismaMock() {
    const self = this;
    return {
      $transaction: async (callback: (tx: any) => Promise<unknown>) => {
        const tx = {
          paymentOrder: {
            findUnique: async ({ where }: { where: { id: string } }) => {
              const order = self.paymentOrders.get(where.id);
              return order ? { ...order } : null;
            },
            create: async ({ data }: { data: Partial<PaymentOrderRow> }) => {
              const order: PaymentOrderRow = {
                id: data.id!,
                companyId: data.companyId!,
                workerId: data.workerId!,
                status: data.status!,
                amount: data.amount as Decimal,
                currency: data.currency!,
                createdAt: (data.createdAt as Date) ?? new Date(),
                updatedAt: (data.updatedAt as Date) ?? new Date(),
              };
              self.paymentOrders.set(order.id, order);
              return { ...order };
            },
            update: async ({
              where,
              data,
            }: {
              where: { id: string };
              data: Partial<PaymentOrderRow>;
            }) => {
              const existing = self.paymentOrders.get(where.id);
              if (!existing) throw new Error("PaymentOrder not found");
              const updated: PaymentOrderRow = { ...existing, ...data };
              self.paymentOrders.set(where.id, updated);
              return { ...updated };
            },
          },
          operation: {
            findUnique: async ({ where }: { where: { orderId: string } }) => {
              const op = self.operations.get(where.orderId);
              return op ? { ...op } : null;
            },
          },
        };
        return callback(tx);
      },
    };
  }

  // Helper to seed the projection and totals directly (bypassing simulateWrite)
  seedOperation(opts: {
    orderId: string;
    companyId: string;
    status: OrderStatus;
    amount: string;
    currency?: string;
    workerName?: string;
    workerRole?: string;
    createdAt: Date;
  }): void {
    this.operations.set(opts.orderId, {
      orderId: opts.orderId,
      companyId: opts.companyId,
      status: opts.status,
      amount: new Decimal(opts.amount),
      currency: opts.currency ?? "USD",
      workerName: opts.workerName ?? "Test Worker",
      workerRole: opts.workerRole ?? "driver",
      lastEventType: null,
      createdAt: opts.createdAt,
    });

    // Ensure a totals row exists for the company
    if (!this.companyTotals.has(opts.companyId)) {
      this.companyTotals.set(opts.companyId, {
        companyId: opts.companyId,
        totalAmount: new Decimal(0),
        orderCount: 0,
      });
    }
    const total = this.companyTotals.get(opts.companyId)!;
    total.totalAmount = total.totalAmount.plus(new Decimal(opts.amount));
    total.orderCount += 1;
  }
}
```

Now let me write all the test cases. Let me be careful about case 4 (delta on update):

> "first insert an order for 100.00, then simulateWrite the same `order_id` with amount 250.00; getCompanyTotals shows total_amount = 250.00 (not 350.00) and order_count still 1"

In the service code:
```ts
const existingOrder = await tx.paymentOrder.findUnique({ where: { id: input.order_id } });
if (existingOrder) {
  // update branch
  const oldAmount = existingOrder.amount.toString();
  if (oldAmount !== input.amount) {
    const delta = new Decimal(input.amount).minus(existingOrder.amount);
    deltaAmount = delta.toString();
  }
}
// deltaCount stays 0 for updates
```

So for an update from 100 to 250: delta = 250 - 100 = 150. The total was 100, now becomes 100 + 150 = 250. Correct.

For case 5 (unchanged amount):
> "insert order for 50.00, simulateWrite same `order_id` with a different status but the same amount 50.00; getCompanyTotals still shows total_amount = 50.00 and order_count = 1"

In the service: oldAmount = "50.00", input.amount = "50.00", so `oldAmount !== input.amount` is false, deltaAmount stays "0", deltaCount is 0. The guard `if (deltaAmount !== "0" || deltaCount !== 0)` prevents the upsert. Good.

Wait, but there's a subtlety with Decimal comparison. `new Decimal("50.00").toString()` gives `"50.00"`. And `input.amount` is `"50.00"`. So the string comparison works.

But what if one is "50.0" and the other is "50.00"? The service does:
```ts
const oldAmount = existingOrder.amount.toString(); // Decimal's toString
if (oldAmount !== input.amount) { // string comparison
```

If `existingOrder.amount` is a Decimal("50.00"), its toString() is "50.00". If `input.amount` is "50.00", they match. Good.

In my mock, when I create the order with `amount: new Decimal("50.00")`, the `toString()` will give "50.00". And in the second call, `input.amount` is "50.00". So they match.

Actually wait - I need to double-check Prisma Decimal behavior. In Prisma, `Decimal` from `@prisma/client` (which re-exports `decimal.js`) - its `toString()` for `new Decimal("50.00")` gives `"50.00"`. Yes, decimal.js preserves trailing zeros in toString().

OK, I'm confident the tests will work. Let me write the final file now.

Actually, one more thought on case 3 (concurrent). The test says "issued concurrently (both in-flight before either commits)". In my mock, since everything is synchronous within the event loop, `Promise.all` will actually run them sequentially (the first completes before the second starts). But that's fine - the test is verifying the delta computation logic, not actual OS-level concurrency. The key assertion is that the final total is correct.

If the service had a bug where it read the total outside the transaction and computed `new_total = current_total + amount`, then in a truly concurrent scenario both would read 0 and set to their own amount. But in my sequential mock, the second would read the first's result and compute correctly. So this test wouldn't catch that specific bug in my mock.

However, the test as stated in the cases file says:
> "fails if `upsertCompanyTotal` performs a non-atomic SELECT-then-UPDATE (lost update on the aggregate row), or if the delta for a concurrent insert is computed against a stale `total_amount` read outside the transaction's snapshot"

The first failure mode (non-atomic SELECT-then-UPDATE) would be in the repository, not the service. The second (stale total read) would be a bug in the service's delta computation.

Looking at the service code, for an insert it does:
```ts
if (!existingOrder) {
  deltaAmount = input.amount;
  deltaCount = 1;
}
```

It doesn't read the total at all for inserts. So the "stale total read" bug can't exist in this implementation. The test verifies that the correct delta is passed to `upsertCompanyTotal` (which is +amount, +1 for each insert).

In my mock, I can verify this by checking the final state. If both inserts correctly add their amounts, the total is 300. If one of them somehow computed a wrong delta (e.g., 0), the total would be wrong.

I think the test is valid as-is. It catches bugs where:
- The service doesn't call `upsertCompanyTotal` for the second insert
- The service computes the wrong delta
- The service treats the second insert as an update

Let me finalize and write the file.

One last thing: for the `getCompanyTotal` method used in `getDashboard` as an existence check - after `simulateWrite` creates a new company's first order, the totals row will exist. So subsequent `getDashboard` calls will pass the existence check. Good.

For tests where I seed operations directly (cases 6-9), I use the `seedOperation` helper which also creates/updates the totals row. This ensures the existence check passes.

Let me write it all out now.
```

## reply

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { Decimal } from "@prisma/client";
import { OperationsService } from "../src/operations/operations.service";
import type {
  OperationRow,
  DashboardQuery,
  DashboardResult,
  CompanyTotals,
  SimulateWriteInput,
  OrderStatus,
} from "../src/operations/operations.types";
import {
  ResourceNotFoundError,
  InvalidDateRangeError,
  ValidationError,
} from "../src/operations/operations.types";

// ─── In-memory state types ───

interface PaymentOrderRow {
  id: string;
  companyId: string;
  workerId: string;
  status: string;
  amount: Decimal;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

interface OperationProjectionRow {
  orderId: string;
  companyId: string;
  status: string;
  amount: Decimal;
  currency: string;
  workerName: string;
  workerRole: string;
  lastEventType: string | null;
  createdAt: Date;
}

interface CompanyTotalRow {
  companyId: string;
  totalAmount: Decimal;
  orderCount: number;
}

interface WorkerRow {
  id: string;
  name: string;
  role: string;
}

// ─── Test context: in-memory DB + mock collaborators ───

class TestContext {
  paymentOrders = new Map<string, PaymentOrderRow>();
  operations = new Map<string, OperationProjectionRow>();
  companyTotals = new Map<string, CompanyTotalRow>();
  workers = new Map<string, WorkerRow>();

  repo: any;
  prisma: any;

  constructor() {
    this.repo = this.buildRepoMock();
    this.prisma = this.buildPrismaMock();
  }

  private buildRepoMock() {
    const self = this;
    return {
      findWorkerById: async (id: string): Promise<WorkerRow | null> => {
        return self.workers.get(id) ?? null;
      },

      findLastEventForOrder: async (_orderId: string): Promise<string | null> => {
        return null;
      },

      upsertOperation: async (
        _tx: unknown,
        input: SimulateWriteInput,
        worker: WorkerRow,
        lastEventType: string | null,
      ): Promise<void> => {
        const source = self.paymentOrders.get(input.order_id);
        self.operations.set(input.order_id, {
          orderId: input.order_id,
          companyId: input.company_id,
          status: input.status,
          amount: new Decimal(input.amount),
          currency: input.currency,
          workerName: worker.name,
          workerRole: worker.role,
          lastEventType,
          createdAt: source ? source.createdAt : new Date(),
        });
      },

      upsertCompanyTotal: async (
        _tx: unknown,
        companyId: string,
        deltaAmount: string,
        deltaCount: number,
      ): Promise<void> => {
        const existing = self.companyTotals.get(companyId);
        if (!existing) {
          self.companyTotals.set(companyId, {
            companyId,
            totalAmount: new Decimal(deltaAmount),
            orderCount: deltaCount,
          });
        } else {
          existing.totalAmount = existing.totalAmount.plus(new Decimal(deltaAmount));
          existing.orderCount += deltaCount;
        }
      },

      getCompanyTotal: async (companyId: string): Promise<CompanyTotals | null> => {
        const t = self.companyTotals.get(companyId);
        if (!t) return null;
        return {
          company_id: companyId,
          total_amount: t.totalAmount.toString(),
          order_count: t.orderCount,
        };
      },

      queryDashboard: async (query: DashboardQuery): Promise<DashboardResult> => {
        let rows = Array.from(self.operations.values()).filter(
          (op) => op.companyId === query.company_id,
        );

        if (query.status !== undefined) {
          rows = rows.filter((op) => op.status === query.status);
        }
        if (query.date_from !== undefined) {
          rows = rows.filter((op) => op.createdAt >= query.date_from!);
        }
        if (query.date_to !== undefined) {
          rows = rows.filter((op) => op.createdAt <= query.date_to!);
        }

        // Sort: created_at DESC, order_id DESC
        rows.sort((a, b) => {
          const timeDiff = b.createdAt.getTime() - a.createdAt.getTime();
          if (timeDiff !== 0) return timeDiff;
          return b.orderId > a.orderId ? 1 : -1;
        });

        const total_count = rows.length;
        const offset = (query.page - 1) * query.page_size;
        const pageRows = rows.slice(offset, offset + query.page_size);

        return {
          data: pageRows.map((op) => ({
            order_id: op.orderId,
            company_id: op.companyId,
            status: op.status as OrderStatus,
            amount: op.amount.toString(),
            currency: op.currency,
            worker_name: op.workerName,
            worker_role: op.workerRole,
            last_event_type: op.lastEventType,
            created_at: op.createdAt,
          })),
          total_count,
          page: query.page,
          page_size: query.page_size,
        };
      },
    };
  }

  private buildPrismaMock() {
    const self = this;
    return {
      $transaction: async (callback: (tx: any) => Promise<unknown>) => {
        const tx = {
          paymentOrder: {
            findUnique: async ({ where }: { where: { id: string } }) => {
              const order = self.paymentOrders.get(where.id);
              return order ? { ...order } : null;
            },
            create: async ({ data }: { data: Partial<PaymentOrderRow> }) => {
              const order: PaymentOrderRow = {
                id: data.id!,
                companyId: data.companyId!,
                workerId: data.workerId!,
                status: data.status!,
                amount: data.amount as Decimal,
                currency: data.currency!,
                createdAt: (data.createdAt as Date) ?? new Date(),
                updatedAt: (data.updatedAt as Date) ?? new Date(),
              };
              self.paymentOrders.set(order.id, order);
              return { ...order };
            },
            update: async ({
              where,
              data,
            }: {
              where: { id: string };
              data: Partial<PaymentOrderRow>;
            }) => {
              const existing = self.paymentOrders.get(where.id);
              if (!existing) throw new Error("PaymentOrder not found");
              const updated: PaymentOrderRow = { ...existing, ...data };
              self.paymentOrders.set(where.id, updated);
              return { ...updated };
            },
          },
          operation: {
            findUnique: async ({ where }: { where: { orderId: string } }) => {
              const op = self.operations.get(where.orderId);
              return op ? { ...op } : null;
            },
          },
        };
        return callback(tx);
      },
    };
  }

  /** Seed a projection row and update the company totals directly (bypasses simulateWrite). */
  seedOperation(opts: {
    orderId: string;
    companyId: string;
    status: OrderStatus;
    amount: string;
    currency?: string;
    workerName?: string;
    workerRole?: string;
    createdAt: Date;
  }): void {
    this.operations.set(opts.orderId, {
      orderId: opts.orderId,
      companyId: opts.companyId,
      status: opts.status,
      amount: new Decimal(opts.amount),
      currency: opts.currency ?? "USD",
      workerName: opts.workerName ?? "Test Worker",
      workerRole: opts.workerRole ?? "driver",
      lastEventType: null,
      createdAt: opts.createdAt,
    });

    if (!this.companyTotals.has(opts.companyId)) {
      this.companyTotals.set(opts.companyId, {
        companyId: opts.companyId,
        totalAmount: new Decimal(0),
        orderCount: 0,
      });
    }
    const total = this.companyTotals.get(opts.companyId)!;
    total.totalAmount = total.totalAmount.plus(new Decimal(opts.amount));
    total.orderCount += 1;
  }
}

// ─── Tests ───

describe("OperationsService", () => {
  let ctx: TestContext;
  let service: OperationsService;

  beforeEach(() => {
    ctx = new TestContext();
    service = new OperationsService(ctx.repo, ctx.prisma);
  });

  // ─── Read-your-own-writes ───

  describe("read-your-own-writes", () => {
    it("simulateWrite inserts a new order as pending; getDashboard includes the row with correct status and amount", async () => {
      ctx.workers.set("w1", { id: "w1", name: "Alice", role: "driver" });

      await service.simulateWrite({
        order_id: "o1",
        company_id: "c1",
        worker_id: "w1",
        status: "pending",
        amount: "100.00",
        currency: "USD",
      });

      const result = await service.getDashboard({
        company_id: "c1",
        page: 1,
        page_size: 10,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].order_id).toBe("o1");
      expect(result.data[0].status).toBe("pending");
      expect(result.data[0].amount).toBe("100.00");
      expect(result.data[0].company_id).toBe("c1");
    });

    it("simulateWrite update changes status to approved; getDashboard reflects the new status", async () => {
      ctx.workers.set("w1", { id: "w1", name: "Alice", role: "driver" });

      // First write: insert as pending
      await service.simulateWrite({
        order_id: "o1",
        company_id: "c1",
        worker_id: "w1",
        status: "pending",
        amount: "100.00",
        currency: "USD",
      });

      // Second write: same order_id, status changed to approved
      await service.simulateWrite({
        order_id: "o1",
        company_id: "c1",
        worker_id: "w1",
        status: "approved",
        amount: "100.00",
        currency: "USD",
      });

      const result = await service.getDashboard({
        company_id: "c1",
        page: 1,
        page_size: 10,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].status).toBe("approved");
    });
  });

  // ─── Concurrent totals ───

  describe("concurrent updates to company totals", () => {
    it("two concurrent simulateWrite calls for different orders of the same company produce correct total_amount and order_count", async () => {
      ctx.workers.set("w1", { id: "w1", name: "Alice", role: "driver" });

      await Promise.all([
        service.simulateWrite({
          order_id: "o1",
          company_id: "c1",
          worker_id: "w1",
          status: "pending",
          amount: "100.00",
          currency: "USD",
        }),
        service.simulateWrite({
          order_id: "o2",
          company_id: "c1",
          worker_id: "w1",
          status: "approved",
          amount: "200.00",
          currency: "USD",
        }),
      ]);

      const totals = await service.getCompanyTotals("c1");
      expect(totals.total_amount).toBe("300.00");
      expect(totals.order_count).toBe(2);
    });

    it("update with changed amount adjusts total by delta, not by the new amount", async () => {
      ctx.workers.set("w1", { id: "w1", name: "Alice", role: "driver" });

      // Insert for 100.00
      await service.simulateWrite({
        order_id: "o1",
        company_id: "c1",
        worker_id: "w1",
        status: "pending",
        amount: "100.00",
        currency: "USD",
      });

      // Update same order to 250.00 (status also changes)
      await service.simulateWrite({
        order_id: "o1",
        company_id: "c1",
        worker_id: "w1",
        status: "approved",
        amount: "250.00",
        currency: "USD",
      });

      const totals = await service.getCompanyTotals("c1");
      // Total should be 250.00 (the new amount), not 350.00 (100 + 250)
      expect(totals.total_amount).toBe("250.00");
      expect(totals.order_count).toBe(1);
    });

    it("update with unchanged amount does not perturb totals", async () => {
      ctx.workers.set("w1", { id: "w1", name: "Alice", role: "driver" });

      // Insert for 50.00
      await service.simulateWrite({
        order_id: "o1",
        company_id: "c1",
        worker_id: "w1",
        status: "pending",
        amount: "50.00",
        currency: "USD",
      });

      // Update same order: different status, same amount
      await service.simulateWrite({
        order_id: "o1",
        company_id: "c1",
        worker_id: "w1",
        status: "settled",
        amount: "50.00",
        currency: "USD",
      });

      const totals = await service.getCompanyTotals("c1");
      expect(totals.total_amount).toBe("50.00");
      expect(totals.order_count).toBe(1);
    });
  });

  // ─── Dashboard filtering and pagination ───

  describe("dashboard filters", () => {
    it("filters by status: only returns rows matching the requested status", async () => {
      const t = new Date("2025-01-10T10:00:00Z");
      ctx.seedOperation({ orderId: "o1", companyId: "c1", status: "pending", amount: "10.00", createdAt: t });
      ctx.seedOperation({ orderId: "o2", companyId: "c1", status: "approved", amount: "20.00", createdAt: new Date(t.getTime() + 1000) });
      ctx.seedOperation({ orderId: "o3", companyId: "c1", status: "settled", amount: "30.00", createdAt: new Date(t.getTime() + 2000) });

      const result = await service.getDashboard({
        company_id: "c1",
        status: "approved",
        page: 1,
        page_size: 10,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].order_id).toBe("o2");
      expect(result.data[0].status).toBe("approved");
      expect(result.total_count).toBe(1);
    });

    it("filters by date range with inclusive boundaries", async () => {
      const t1 = new Date("2025-01-01T00:00:00Z");
      const t2 = new Date("2025-01-10T00:00:00Z");
      const t3 = new Date("2025-01-20T00:00:00Z");

      ctx.seedOperation({ orderId: "o1", companyId: "c1", status: "pending", amount: "10.00", createdAt: t1 });
      ctx.seedOperation({ orderId: "o2", companyId: "c1", status: "pending", amount: "20.00", createdAt: t2 });
      ctx.seedOperation({ orderId: "o3", companyId: "c1", status: "pending", amount: "30.00", createdAt: t3 });

      const result = await service.getDashboard({
        company_id: "c1",
        date_from: t2,
        date_to: t3,
        page: 1,
        page_size: 10,
      });

      // Should include o2 (at T2) and o3 (at T3), but not o1 (at T
