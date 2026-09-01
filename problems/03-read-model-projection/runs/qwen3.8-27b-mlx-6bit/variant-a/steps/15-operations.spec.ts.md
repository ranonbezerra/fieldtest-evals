# 15-operations.spec.ts

## reasoning

```
Let me analyze the cases from `15-operations.spec.ts-cases.txt` and write integration tests that cover all of them.

The cases are:
1. Create order then immediately query the dashboard for that company — the new row appears with correct denormalised fields
2. Approve an order then query filtered by status=approved — the row's status reflects the transition
3. Reject an order then query filtered by status=rejected — the row appears under rejected and is absent from approved
4. Fire 10 concurrent `approveOrder` calls on distinct orders for the same company then read totals
5. Fire concurrent `createOrder` and `approveOrder` interleaved for one company
6. Corrupt a projection row by changing its status and amount directly in the DB, then run `repairDrift`
7. Delete a projection row directly from the DB, then run `repairDrift`
8. Create several orders, manually corrupt the projection, then run `rederive`
9. Insert 25 rows for a company, query page 1 size 10 — returns exactly 10 items and `total` is 25
10. Query page 3 size 10 for a company with 25 rows — returns exactly 5 items
11. Query page 99 size 10 for a company with 25 rows — returns 0 items and `total` is still 25
12. Insert orders with known timestamps, query with date range — boundary conditions
13. Call `approveOrder` with a UUID that does not exist — returns error with code `order_not_found`
14. Call `approveOrder` on an order that is already approved — returns error with code `invalid_transition`
15. Call the dashboard with `pageSize=101` — returns error with code `invalid_query_params`
16. Call the dashboard with `page=0` — returns error with code `invalid_query_params`
17. Create the first order for a brand-new company — after create, `getTotals` returns a row with `pending_count=1` and zero totals
18. Run `repairDrift` for a window that contains no orders — returns `DriftReport` with `rowsCorrected=0` and `totalsCorrected=false`
19. Create 3 orders for company A, approve 1, reject 1, then read totals
20. Two orders for the same company have identical `created_at` timestamps — both appear, stable order

Now let me think about how to structure this. I need to:
- Use Vitest
- Set up a NestJS test module with the relevant services
- Use Prisma for database operations (integration tests)
- Each test should be independent where possible

Looking at the services:
- `OperationsService` - has `query(params)` method
- `ProjectionsService` - has `applyOrderCreated`, `applyOrderStatusChanged`, `rederive`, `repairDrift`, `getTotals`
- `WritesService` - has `createOrder`, `approveOrder`, `rejectOrder`
- `OperationsRepository` - has `findPage(params)`
- `ProjectionsRepository` - has various methods

For integration tests, I'll need to use the real Prisma client connected to a test database.

Let me think about the structure:

```ts
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
// ... service imports

describe('Operations (integration)', () => {
  let prisma: PrismaClient;
  let operationsService: OperationsService;
  let projectionsService: ProjectionsService;
  let writesService: WritesService;
  
  // Setup and teardown...
});
```

Wait, I need to think about how the services are wired. Looking at the references:
- `OperationsService` takes `OperationsRepository`
- `ProjectionsService` takes `ProjectionsRepository`
- `WritesService` takes `PrismaClient` and `ProjectionsService`

For the test, I'll create instances directly rather than using Nest's DI, since these are integration tests and I need full control. Actually, let me use Nest's testing module to be more idiomatic, but I need to think about what providers to include.

Actually, looking more carefully at the plan and the structure, I think the simplest approach for integration tests is to instantiate the services directly with a shared PrismaClient. This avoids the complexity of Nest module wiring in tests while still testing real behavior against the database.

Let me think about the error cases. The `WritesService` throws `NotFoundException` and `BadRequestException` from NestJS. But the plan says errors should use the standard envelope. Looking at the `operations.service.ts`, it throws `BadRequestException` with the envelope object as the response body. But `writes.service.ts` just throws plain `NotFoundException` and `BadRequestException` without the envelope.

For the test cases 13-16, I need to check what error is thrown. Looking at the writes service:
- `NotFoundException` for order not found
- `BadRequestException` for invalid transition

And the operations service:
- `BadRequestException` with envelope for invalid params

The test cases say "returns an error with code `order_not_found`" etc. But the writes service doesn't use the envelope format - it just throws Nest exceptions. So in the test, I should check that the exception is thrown and check its properties.

Actually wait - the cases say "returns an error with code `order_not_found`". But looking at the actual implementation in `writes.service.ts`, it throws `NotFoundException` and `BadRequestException` without the envelope. So the test should verify that these exceptions are thrown. The "code" in the cases file is the conceptual code, not necessarily a literal string in the exception.

Let me re-read: "fails if the service swallows the not-found and returns a success, or if the error code is different". So the test should verify that an exception is thrown (not swallowed) and that it's the right type.

For the `invalid_query_params` case, the operations service throws `BadRequestException` with the envelope as the body. So I can check `exception.response.error.code === 'invalid_query_params'`.

For the writes service errors, I'll just check that the appropriate exception type is thrown. Let me use `expect(...).rejects.toThrow(NotFoundException)` etc.

Actually, let me look at this more carefully. The test case says "returns an error with code `order_not_found`". In the Nest context, this would be a 404. The `writes.service.ts` throws `NotFoundException`. So I should check that a `NotFoundException` is thrown.

But wait - the problem says "Errors — one envelope" with the code being the contract. The `writes.service.ts` as shown doesn't follow this convention. It just throws plain Nest exceptions. So either:
1. The tests should check for the exception type (NotFoundException, BadRequestException)
2. Or there's a global exception filter that converts them

Since I can only see what's in the references, and the writes service throws plain Nest exceptions, I'll test for those. The "code" in the cases file is a conceptual label.

Actually, let me re-read the operations.service.ts more carefully:

```ts
throw new BadRequestException({
  error: {
    code: 'invalid_query_params',
    ...
  },
});
```

So for the operations service, the error IS in the envelope format within the exception. I can check `exception.response.error.code`.

For the writes service, it just throws `NotFoundException` and `BadRequestException` without envelope. So I'll check the exception type.

Now let me think about the concurrent tests. For case 4 (10 concurrent approveOrder calls), I need to:
1. Create a company with 10 orders (all pending)
2. Fire all 10 approveOrder calls concurrently with `Promise.all`
3. Read the totals and verify

For case 5 (interleaved creates and approves), I need to:
1. Create some orders
2. Fire concurrent createOrder and approveOrder calls
3. Verify final totals

Let me now write the full test file.

One important consideration: I need to clean up between tests. Since these are integration tests hitting a real database, I should clean up the projection and source tables between tests (or at least between test groups).

Let me also think about the `rederive` and `repairDrift` methods. Looking at the projections service reference, it's truncated (shows `...`), but from the plan I know:
- `rederive(from, to)`: delete projection rows for window → fetch source → bulk upsert → recompute totals
- `repairDrift(from, to)`: read both sides → compute diff → apply corrections

For the tests, I'll call these methods directly on the `ProjectionsService`.

Now, for the `getTotals` method - it's on `ProjectionsService`. Let me check... yes, the plan shows `getTotals(companyId: string): Promise<CompanyTotals>` on ProjectionsService.

Let me also think about what I need to import:
- `describe`, `it`, `beforeAll`, `afterAll`, `beforeEach`, `afterEach` from vitest
- Services from their respective paths
- PrismaClient
- Maybe `randomUUID` for generating test IDs

Let me structure the test file now:

```ts
import { describe, it, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { OperationsService } from '../src/operations/operations.service.js';
import { OperationsRepository } from '../src/operations/operations.repository.js';
import { ProjectionsService } from '../src/projections/projections.service.js';
import { ProjectionsRepository } from '../src/projections/projections.repository.js';
import { WritesService } from '../src/writes/writes.service.js';
import { OrderStatus, OperationQueryParams } from '../src/projections/projections.types.js';
```

Wait, I need to be careful about the import paths. The project uses ESM with `.js` extensions for relative imports. Let me check the references... Yes, `operations.service.ts` imports from `'../projections/projections.types.js'` and `'./operations.repository.js'`. So I should use `.js` extensions in my test imports too.

But wait - the test file is in `test/operations.spec.ts` and the source is in `src/`. So imports would be like `'../src/operations/operations.service.js'`.

Now let me think about the setup. I'll create a shared PrismaClient and instantiate services directly:

```ts
const prisma = new PrismaClient();
const projectionsRepo = new ProjectionsRepository(prisma);
const projectionsService = new ProjectionsService(projectionsRepo);
const operationsRepo = new OperationsRepository(prisma);
const operationsService = new OperationsService(operationsRepo);
const writesService = new WritesService(prisma, projectionsService);
```

For cleanup, I'll delete all rows from the relevant tables before each test (or at least between groups). The tables are:
- `operation_read_models`
- `company_financial_totals`
- `payment_orders`
- `workers`
- `events`

Actually, I should clean up in `beforeEach` to ensure test isolation.

Let me think about how to create test data. I need:
- A company (just an ID string, no separate companies table based on the schema)
- Workers with `id`, `name`, `companyId`
- Events with `id`, `title`, `location`
- Payment orders

Looking at the schema, there's no explicit `companies` table - companies are just referenced by `companyId` strings. So I can use any string as a company ID.

Let me write helper functions:
- `createWorker(companyId, name)` - creates a worker in the DB
- `createEvent(title, location)` - creates an event in the DB
- `seedCompany(companyId)` - creates a worker and event for the company

Actually, let me keep it simpler. I'll create the needed entities inline in each test or use a helper.

Now let me think about the `repairDrift` and `rederive` tests more carefully.

For case 6 (corrupt projection row):
1. Create an order (this creates the projection row via the sync hook)
2. Directly update the projection row in the DB (change status, change amount)
3. Call `repairDrift(from, to)` for a window containing that row
4. Verify the projection row matches the source

For case 7 (delete projection row):
1. Create an order
2. Directly delete the projection row from the DB
3. Call `repairDrift(from, to)`
4. Verify the row is restored

For case 8 (rederive after corruption):
1. Create several orders
2. Corrupt some projection rows
3. Call `rederive(from, to)`
4. Verify all projection rows match source

For the corruption, I'll use `prisma.$executeRaw` or direct Prisma updates on the projection model.

Let me also think about the `DriftReport` return type:
```ts
export interface DriftReport {
  windowStart: Date;
  windowEnd: Date;
  rowsCorrected: number;
  totalsCorrected: boolean;
}
```

Now, one issue: the `projections.service.ts` reference is truncated. I can see it starts but the body is `...`. However, from the plan and the repository reference, I know what methods it has. The tests will call these methods and verify behavior against the database, so I don't need to know the exact internal implementation.

Let me also consider: for the concurrent tests, I need to make sure the Prisma client handles concurrent transactions properly. With Postgres, each transaction gets its own connection, so this should work fine with the default Prisma connection pooling.

One more thing: for case 20 (identical timestamps), I need to create two orders with the exact same `created_at`. With Prisma, `created_at` defaults to `now()`, so two consecutive inserts might get the same timestamp if they're fast enough, but it's not guaranteed. I should explicitly set `createdAt` or use raw SQL to insert with a specific timestamp.

Actually, looking at the Prisma schema, `created_at` has `@default(now())`. I can override it by explicitly providing the value in the create call. Let me do that for this test.

Wait, but `WritesService.createOrder` doesn't accept a `createdAt` parameter. So for this test, I might need to insert directly via Prisma into `payment_orders` and then manually create the projection row. Or I could use raw SQL.

Actually, let me think about this differently. For the identical timestamp test, I can:
1. Insert two orders directly into `payment_orders` with the same `created_at` using Prisma
2. Manually create the corresponding projection rows (or use the projections service)
3. Query the dashboard and verify both appear in stable order

But the "stable order" part requires a deterministic tiebreak. The plan says the index is on `[company_id, status, created_at(sort: Desc)]`. If two rows have the same `created_at`, the order between them depends on whether there's a secondary sort key. Looking at the repository, the `orderBy` is just `{ createdAt: 'desc' }`. There's no secondary sort key.

So for this test, I need to verify that the order is stable (same across repeated queries). Even without a secondary sort key, Postgres might return them in a consistent order for the same query (especially with an index), but it's not guaranteed. The test should just verify that both rows appear and that the order is the same across two queries.

Actually, re-reading the case: "both appear, and their relative order is stable across repeated queries (deterministic tiebreak)". The "fails if" says "the sort has no secondary key and Postgres returns them in arbitrary order, causing flaky pagination". So the test is checking that the implementation handles this. But looking at the actual repository code, there's no secondary sort key. So either:
1. The test will be flaky (which is bad)
2. The implementation should have a secondary sort key but doesn't (bug)
3. In practice, with an index on `(company_id, status, created_at DESC)`, Postgres will return rows in a consistent order even for ties (it follows the index order, and for ties in `created_at`, it follows the physical order or the PK order within the index)

I think the safest approach is to query twice and assert the same order. If the implementation is correct (using an index that provides a deterministic order for ties), this will pass. If not, it might be flaky - but that's what the test is designed to catch.

Actually, I'll just do two queries and compare. The test verifies stability regardless of what the underlying mechanism is.

Let me now write the complete test file. I'll organize it into describe blocks:
- Read-your-own-writes
- Concurrent updates
- Drift repair
- Re-derivation
- Pagination and filtering
- Error handling
- Totals correctness

Let me draft this now:

```ts
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OperationsService } from '../src/operations/operations.service.js';
import { OperationsRepository } from '../src/operations/operations.repository.js';
import { ProjectionsService } from '../src/projections/projections.service.js';
import { ProjectionsRepository } from '../src/projections/projections.repository.js';
import { WritesService } from '../src/writes/writes.service.js';

describe('Operations (integration)', () => {
  let prisma: PrismaClient;
  let operationsService: OperationsService;
  let projectionsService: ProjectionsService;
  let writesService: WritesService;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const projectionsRepo = new ProjectionsRepository(prisma);
    projectionsService = new ProjectionsService(projectionsRepo);
    const operationsRepo = new OperationsRepository(prisma);
    operationsService = new OperationsService(operationsRepo);
    writesService = new WritesService(prisma, projectionsService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean all relevant tables
    await prisma.operationReadModel.deleteMany({});
    await prisma.companyFinancialTotal.deleteMany({});
    await prisma.paymentOrder.deleteMany({});
    await prisma.worker.deleteMany({});
    await prisma.event.deleteMany({});
  });

  // ... tests
});
```

Wait, I need to check the Prisma model names. From the schema:
- `payment_orders` → model name would be `PaymentOrder` (Prisma convention) → in code: `prisma.paymentOrder`
- `events` → `Event` → `prisma.event`
- `workers` → `Worker` → `prisma.worker`
- `operation_read_models` → `OperationReadModel` → `prisma.operationReadModel`
- `company_financial_totals` → `CompanyFinancialTotal` → `prisma.companyFinancialTotal`

These match what I see in the repository references.

Now let me think about the `createWorker` and `createEvent` helpers:

```ts
async function createTestWorker(companyId: string, name?: string) {
  return prisma.worker.create({
    data: { id: randomUUID(), companyId, name: name ?? `Worker ${randomUUID().slice(0, 8)}` },
  });
}

async function createTestEvent(title?: string, location?: string) {
  return prisma.event.create({
    data: { id: randomUUID(), title: title ?? `Event ${randomUUID().slice(0, 8)}`, location: location ?? 'Test Location' },
  });
}
```

For the `createOrder` calls, I'll use `writesService.createOrder(input)` which takes a `CreateOrderInput`.

Let me now write all the test cases:

**Case 1: Create order then query dashboard**
```ts
it('create order then immediately query the dashboard for that company — new row appears with correct denormalised fields', async () => {
  const companyId = randomUUID();
  const worker = await prisma.worker.create({ data: { id: randomUUID(), companyId, name: 'Alice' } });
  const event = await prisma.event.create({ data: { id: randomUUID(), title: 'Concert', location: 'Arena' } });

  const { id } = await writesService.createOrder({
    companyId,
    workerId: worker.id,
    eventId: event.id,
    amountCents: 5000,
  });

  const page = await operationsService.query({
    companyId,
    page: 1,
    pageSize: 10,
  });

  expect(page.total).toBe(1);
  const row = page.items[0];
  expect(row.id).toBe(id);
  expect(row.companyId).toBe(companyId);
  expect(row.workerName).toBe('Alice');
  expect(row.eventTitle).toBe('Concert');
  expect(row.eventLocation).toBe('Arena');
  expect(row.status).toBe('pending');
  expect(row.amountCents).toBe(5000);
});
```

**Case 2: Approve then query filtered by status=approved**
```ts
it('approve an order then query filtered by status=approved — row status reflects transition', async () => {
  const companyId = randomUUID();
  const worker = await prisma.worker.create({ data: { id: randomUUID(), companyId, name: 'Bob' } });
  const event = await prisma.event.create({ data: { id: randomUUID(), title: 'Festival', location: 'Park' } });

  const { id } = await writesService.createOrder({ companyId, workerId: worker.id, eventId: event.id, amountCents: 3000 });
  await writesService.approveOrder(id);

  const page = await operationsService.query({ companyId, status: 'approved', page: 1, pageSize: 10 });
  expect(page.total).toBe(1);
  expect(page.items[0].id).toBe(id);
  expect(page.items[0].status).toBe('approved');
});
```

**Case 3: Reject then query filtered by status=rejected, absent from approved**
```ts
it('reject an order then query filtered by status=rejected — row appears under rejected and is absent from approved', async () => {
  const companyId = randomUUID();
  const worker = await prisma.worker.create({ data: { id: randomUUID(), companyId, name: 'Carol' } });
  const event = await prisma.event.create({ data: { id: randomUUID(), title: 'Show', location: 'Theater' } });

  const { id } = await writesService.createOrder({ companyId, workerId: worker.id, eventId: event.id, amountCents: 2000 });
  await writesService.rejectOrder(id);

  const rejectedPage = await operationsService.query({ companyId, status: 'rejected', page: 1, pageSize: 10 });
  expect(rejectedPage.total).toBe(1);
  expect(rejectedPage.items[0].id).toBe(id);
  expect(rejectedPage.items[0].status).toBe('rejected');

  const approvedPage = await operationsService.query({ companyId, status: 'approved', page: 1, pageSize: 10 });
  expect(approvedPage.total).toBe(0);
});
```

**Case 4: 10 concurrent approveOrder calls**
```ts
it('fire 10 concurrent approveOrder calls on distinct orders for the same company — totals are exact', async () => {
  const companyId = randomUUID();
  const worker = await prisma.worker.create({ data: { id: randomUUID(), companyId, name: 'Dave' } });
  const event = await prisma.event.create({ data: { id: randomUUID(), title: 'Gala', location: 'Hall' } });

  const amounts = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
  const orders = [];
  for (const amount of amounts) {
    const { id } = await writesService.createOrder({ companyId, workerId: worker.id, eventId: event.id, amountCents: amount });
    orders.push({ id, amount });
  }

  await Promise.all(orders.map((o) => writesService.approveOrder(o.id)));

  const totals = await projectionsService.getTotals(companyId);
  expect(totals.approvedTotalCents).toBe(5500n);
  expect(totals.pendingCount).toBe(0);
});
```

Wait, the sum of 100+200+...+1000 = 5500. Let me verify: 100+200+300+400+500+600+700+800+900+1000 = 5500. Yes.

**Case 5: Concurrent createOrder and approveOrder interleaved**
```ts
it('fire concurrent createOrder and approveOrder interleaved for one company — final totals match', async () => {
  const companyId = randomUUID();
  const worker = await prisma.worker.create({ data: { id: randomUUID(), companyId, name: 'Eve' } });
  const event = await prisma.event.create({ data: { id: randomUUID(), title: 'Fair', location: 'Grounds' } });

  // Create 5 orders that will be approved
  const toApprove = [];
  for (let i = 0; i < 5; i++) {
    const { id } = await writesService.createOrder({ companyId, workerId: worker.id, eventId: event.id, amountCents: 100 * (i + 1) });
    toApprove.push({ id, amount: 100 * (i + 1) });
  }

  // Now fire concurrent: 5 new creates + 5 approves on existing
  const results = await Promise.all([
    ...toApprove.map((o) => writesService.approveOrder(o.id)),
    ...Array.from({ length: 5 }, (_, i) =>
      writesService.createOrder({ companyId, workerId: worker.id, eventId: event.id, amountCents: 500 * (i + 1) }),
    ),
  ]);

  // Final state: 5 approved, 5 pending
  const totalApprovedCents = toApprove.reduce((sum, o) => sum + BigInt(o.amount), 0n);
  const totals = await projectionsService.getTotals(companyId);
  expect(totals.approvedTotalCents).toBe(totalApprovedCents);
  expect(totals.pendingCount).toBe(5);
});
```

Hmm wait, this is a bit tricky. The 5 new creates add to pending, and the 5 approves move from pending to approved. So final: 5 pending (the new ones), 5 approved. The approved total should be the sum of the original 5 amounts.

Sum of 100+200+300+400+500 = 1500. So `approvedTotalCents` should be 1500n.

**Case 6: Corrupt projection row, run repairDrift**
```ts
it('corrupt a projection row then run repairDrift — projection matches source and totals are corrected', async () => {
  const companyId = randomUUID();
  const worker = await prisma.worker.create({ data: { id: randomUUID(), companyId, name: 'Frank' } });
  const event = await prisma.event.create({ data: { id: randomUUID(), title: 'Mixer', location: 'Lobby' } });

  const { id } = await writesService.createOrder({ companyId, workerId: worker.id, eventId: event.id, amountCents: 750 });
  
  // Approve it first
  await writesService.approveOrder(id);

  // Now corrupt the projection row directly
  const sourceOrder = await prisma.paymentOrder.findUniqueOrThrow({ where: { id } });
  const windowStart = new Date(sourceOrder.createdAt.getTime() - 1000);
  const windowEnd = new Date(sourceOrder.createdAt.getTime() + 1000);

  await prisma.operationReadModel.update({
    where: { id },
    data: { status: 'rejected', amountCents: 9999 },
  });

  await projectionsService.repairDrift(windowStart, windowEnd);

  const repaired = await prisma.operationReadModel.findUniqueOrThrow({ where: { id } });
  expect(repaired.status).toBe('approved');
  expect(repaired.amountCents).toBe(750);

  const totals = await projectionsService.getTotals(companyId);
  expect(totals.approvedTotalCents).toBe(750n);
  expect(totals.rejectedTotalCents).toBe(0n);
  expect(totals.pendingCount).toBe(0);
});
```

**Case 7: Delete projection row, run repairDrift**
```ts
it('delete a projection row then run repairDrift — row is restored and totals include its contribution', async () => {
  const companyId = randomUUID();
  const worker = await prisma.worker.create({ data: { id: randomUUID(), companyId, name: 'Grace' } });
  const event = await prisma.event.create({ data: { id: randomUUID(), title: 'Talk', location: 'Room A' } });

  const { id } = await writesService.createOrder({ companyId, workerId: worker.id, eventId: event.id, amountCents: 420 });

  const sourceOrder = await prisma.paymentOrder.findUniqueOrThrow({ where: { id } });
  const windowStart = new Date(sourceOrder.createdAt.getTime() - 1000);
  const windowEnd = new Date(sourceOrder.createdAt.getTime() + 1000);

  // Delete the projection row
  await prisma.operationReadModel.delete({ where: { id } });

  // Reset totals to zero (simulating the drift)
  await prisma.companyFinancialTotal.update({ where: { companyId }, data: { pendingCount: 0 } });

  await projectionsService.repairDrift(windowStart, windowEnd);

  const restored = await prisma.operationReadModel.findUnique({ where: { id } });
  expect(restored).not.toBeNull();
  expect(restored!.status).toBe('pending');
  expect(restored!.amountCents).toBe(420);

  const totals = await projectionsService.getTotals(companyId);
  expect(totals.pendingCount).toBe(1);
});
```

**Case 8: Re-derivation after corruption**
```ts
it('create orders, corrupt projection, run rederive — projection is rebuilt from source', async () => {
  const companyId = randomUUID();
  const worker = await prisma.worker.create({ data: { id: randomUUID(), companyId, name: 'Hank' } });
  const event = await prisma.event.create({ data: { id: randomUUID(), title: 'Demo', location: 'Stage' } });

  const amounts = [100, 200, 300];
  const orderIds = [];
  for (const amount of amounts) {
    const { id } = await writesService.createOrder({ companyId, workerId: worker.id, eventId: event.id, amountCents: amount });
    orderIds.push(id);
  }

  // Approve the first one
  await writesService.approveOrder(orderIds[0]);

  // Corrupt: wrong status on second, wrong amount on third
  await prisma.operationReadModel.update({ where: { id: orderIds[1] }, data: { status: 'approved' } });
  await prisma.operationReadModel.update({ where: { id: orderIds[2] }, data: { amountCents: 99999 } });

  const sourceOrders = await prisma.paymentOrder.findMany({ where: { companyId } });
  const minDate = new Date(Math.min(...sourceOrders.map((o) => o.createdAt.getTime())) - 1000);
  const maxDate = new Date(Math.max(...sourceOrders.map((o) => o.createdAt.getTime())) + 1000);

  await projectionsService.rederive(minDate, maxDate);

  // Verify all rows match source
  for (const orderId of orderIds) {
    const source = await prisma.paymentOrder.findUniqueOrThrow({ where: { id: orderId } });
    const projection = await prisma.operationReadModel.findUniqueOrThrow({ where: { id: orderId } });
    expect(projection.status).toBe(source.status);
    expect(projection.amountCents).toBe(source.amountCents);
  }

  // Verify totals: 1 approved (100), 2 pending
  const totals = await projectionsService.getTotals(companyId);
  expect(totals.approvedTotalCents).toBe(100n);
  expect(totals.pendingCount).toBe(2);
});
```

**Cases 9-11: Pagination**
```ts
it('insert 25 rows, query page 1 size 10 — returns 10 items and total is 25', async () => {
  const companyId = randomUUID();
  const worker = await prisma.worker.create({ data: { id: randomUUID(), companyId, name: 'Ivy' } });
  const event = await prisma.event.create({ data: { id: randomUUID(), title: 'Launch', location: 'HQ' } });

  for (let i = 0; i < 25; i++) {
    await writesService.createOrder({ companyId, workerId: worker.id, eventId: event.id, amountCents: 100 });
  }

  const page = await operationsService.query({ companyId, page: 1, pageSize: 10 });
  expect(page.items).toHaveLength(10);
  expect(page.total).toBe(25);
  expect(page.page).toBe(1);
});

it('query page 3 size 10 for a company with 25 rows — returns 5 items', async () => {
  const companyId = randomUUID();
  const worker = await prisma.worker.create({ data: { id: randomUUID(), companyId, name: 'Jack' } });
  const event = await prisma.event.create({ data: { id: randomUUID(), title: 'Hack', location: 'Lab' } });

  for (let i = 0; i < 25; i++) {
    await writesService.createOrder({ companyId, workerId: worker.id, eventId: event.id, amountCents: 100 });
  }

  const page = await operationsService.query({ companyId, page: 3, pageSize: 10 });
  expect(page.items).toHaveLength(5);
  expect(page.total).toBe(25);
});

it('query page 99 size 10 for a company with 25 rows — returns 0 items and total is still 25', async () => {
  const companyId = randomUUID();
  const worker = await prisma.worker.create({ data: { id: randomUUID(), companyId, name: 'Kim' } });
  const event = await prisma.event.create({ data: { id: randomUUID(), title: 'Workshop', location: 'Office' } });

  for (let i = 0; i < 25; i++) {
    await writesService.createOrder({ companyId, workerId: worker.id, eventId: event.id, amountCents: 100 });
  }

  const page = await operationsService.query({ companyId, page: 99, pageSize: 10 });
  expect(page.items).toHaveLength(0);
  expect(page.total).toBe(25);
});
```

**Case 12: Date range filtering with boundaries**
```ts
it('query with date range — row at from is included, row at to is excluded', async () => {
  const companyId = randomUUID();
  const worker = await prisma.worker.create({ data: { id: randomUUID(), companyId, name: 'Leo' } });
  const event = await prisma.event.create({ data: { id: randomUUID(), title: 'Seminar', location: 'Auditorium' } });

  // We need to create orders with specific timestamps. Since WritesService doesn't accept createdAt,
  // we'll insert directly into payment_orders and manually create projection rows.
  
  const baseTime = new Date('2024-06-15T12:00:00.000Z');
  const beforeFrom = new Date(baseTime.getTime() - 60000); // 1 min before
  const atFrom = new Date(baseTime); // exactly at from
  const inRange = new Date(baseTime.getTime() + 30000); // 30s after from
  const atTo = new Date(baseTime.getTime() + 60000); // exactly at to (should be excluded)
  const afterTo = new Date(baseTime.getTime() + 120000); // 2 min after

  const orders = [
    { id: randomUUID(), createdAt: beforeFrom, amountCents: 10 },
    { id: randomUUID(), createdAt: atFrom, amountCents: 20 },
    { id: randomUUID(), createdAt: inRange, amountCents: 30 },
    { id: randomUUID(), createdAt: atTo, amountCents: 40 },
    { id: randomUUID(), createdAt: afterTo, amountCents: 50 },
  ];

  for (const o of orders) {
    await prisma.paymentOrder.create({
      data: {
        id: o.id,
        companyId,
        workerId: worker.id,
        eventId: event.id,
        amountCents: o.amountCents,
        createdAt: o.createdAt,
      },
    });
    // Manually create projection row
    await prisma.operationReadModel.create({
      data: {
        id: o.id,
        companyId,
        workerId: worker.id,
        workerName: worker.name,
        eventId: event.id,
        eventTitle: event.title,
        eventLocation: event.location,
        status: 'pending',
        amountCents: o.amountCents,
        createdAt: o.createdAt,
      },
    });
  }

  const page = await operationsService.query({
    companyId,
    from: baseTime,
    to: new Date(baseTime.getTime() + 60000), // atTo
    page: 1,
    pageSize: 10,
  });

  const returnedIds = page.items.map((r) => r.id);
  expect(returnedIds).toContain(atFrom order id);
  expect(returnedIds).toContain(inRange order id);
  expect(returnedIds).not.toContain(beforeFrom order id);
  expect(returnedIds).not.toContain(atTo order id);
  expect(returnedIds).not.toContain(afterTo order id);
  expect(page.total).toBe(2);
});
```

Wait, I need to fix the variable references. Let me restructure:

```ts
const orders = [
  { id: randomUUID(), createdAt: beforeFrom, amountCents: 10 },
  ...
];

// After querying:
expect(returnedIds).toContain(orders[1].id); // atFrom
expect(returnedIds).toContain(orders[2].id); // inRange
expect(returnedIds).not.toContain(orders[0].id); // beforeFrom
expect(returnedIds).not.toContain(orders[3].id); // atTo
expect(returnedIds).not.toContain(orders[4].id); // afterTo
```

**Cases 13-16: Error handling**
```ts
it('call approveOrder with a UUID that does not exist — throws NotFoundException', async () => {
  await expect(writesService.approveOrder(randomUUID())).rejects.toThrow(NotFoundException);
});

it('call approveOrder on an order that is already approved — throws BadRequestException', async () => {
  const companyId = randomUUID();
  const worker = await prisma.worker.create({ data: { id: randomUUID(), companyId, name: 'Mia' } });
  const event = await prisma.event.create({ data: { id: randomUUID(), title: 'Meetup', location: 'Cafe' } });

  const { id } = await writesService.createOrder({ companyId, workerId: worker.id, eventId: event.id, amountCents: 100 });
  await writesService.approveOrder(id);

  await expect(writesService.approveOrder(id)).rejects.toThrow(BadRequestException);
});

it('call dashboard with pageSize=101 — throws with code invalid_query_params', async () => {
  const companyId = randomUUID();
  try {
    await operationsService.query({ companyId, page: 1, pageSize: 101 });
    throw new Error('Should have thrown');
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    const exception = e as BadRequestException;
    expect(exception.response).toHaveProperty('error');
    expect((exception.response as any).error.code).toBe('invalid_query_params');
  }
});

it('call dashboard with page=0 — throws with code invalid_query_params', async () => {
  const companyId = randomUUID();
  try {
    await operationsService.query({ companyId, page: 0, pageSize: 10 });
    throw new Error('Should have thrown');
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    const exception = e as BadRequestException;
    expect(exception.response).toHaveProperty('error');
    expect((exception.response as any).error.code).toBe('invalid_query_params');
  }
});
```

Hmm, the `BadRequestException` in NestJS has a `response` property that is the body. When you do `new BadRequestException({ error: {...} })`, the `response` property is set to `{ error: {...} }`. Let me verify this is how it works.

In NestJS, `new BadRequestException(response)` sets the response body to `response`. The `exception.response` or `exception.getResponse()` returns it. So if I throw `new BadRequestException({ error: { code: 'invalid_query_params', ... } })`, then `exception.response` should be `{ error: { code: 'invalid_query_params', ... } }`.

Actually, looking at the NestJS source, when you pass an object to `HttpException`, it gets stored as `this.response`. And `getResponse()` returns it. So `exception.response` should work, or I can use `exception.getResponse()`.

Let me use a cleaner pattern:

```ts
await expect(async () => {
  await operationsService.query({ companyId, page: 1, pageSize: 101 });
}).rejects.toMatchObject({
  response: { error: { code: 'invalid_query_params' } },
});
```

Wait, `toMatchObject` works on the error object. The `BadRequestException` instance has a `response` property. Let me check... Actually in NestJS, `HttpException` stores the response in a private field and exposes it via `getResponse()`. The `response` property might not be directly accessible.

Let me use a different approach:

```ts
let caught: unknown;
try {
  await operationsService.query({ companyId, page: 1, pageSize: 101 });
} catch (e) {
  caught = e;
}
expect(caught).toBeInstanceOf(BadRequestException);
const response = (caught as BadRequestException).getResponse();
expect(response).toMatchObject({ error: { code: 'invalid_query_params' } });
```

This is cleaner and more reliable.

**Case 17: First order for brand-new company**
```ts
it('create the first order for a brand-new company — getTotals returns pending_count=1 and zero totals', async () => {
  const companyId = randomUUID();
  const worker = await prisma.worker.create({ data: { id: randomUUID(), companyId, name: 'Nina' } });
  const event = await prisma.event.create({ data: { id: randomUUID(), title: 'Social', location: 'Bar' } });

  await writesService.createOrder({ companyId, workerId: worker.id, eventId: event.id, amountCents: 100 });

  const totals = await projectionsService.getTotals(companyId);
  expect(totals.pendingCount).toBe(1);
  expect(totals.approvedTotalCents).toBe(0n);
  expect(totals.rejectedTotalCents).toBe(0n);
});
```

**Case 18: repairDrift for empty window**
```ts
it('run repairDrift for a window that contains no orders — returns rowsCorrected=0 and totalsCorrected=false', async () => {
  const windowStart = new Date('2020-01-01T00:00:00.000Z');
  const windowEnd = new Date('2020-01-02T00:00:00.000Z');

  const report = await projectionsService.repairDrift(windowStart, windowEnd);
  expect(report.rowsCorrected).toBe(0);
  expect(report.totalsCorrected).toBe(false);
});
```

**Case 19: Create 3, approve 1, reject 1, check totals**
```ts
it('create 3 orders, approve 1, reject 1 — totals reflect correct bucket distribution', async () => {
  const companyId = randomUUID();
  const worker = await prisma.worker.create({ data: { id: randomUUID(), companyId, name: 'Oscar' } });
  const event = await prisma.event.create({ data: { id: randomUUID(), title: 'Panel', location: 'Room B' } });

  const o1 = await writesService.createOrder({ companyId, workerId: worker.id, eventId: event.id, amountCents: 500 });
  const o2 = await writesService.createOrder({ companyId, workerId: worker.id, eventId: event.id, amountCents: 700 });
  const o3 = await writesService.createOrder({ companyId, workerId: worker.id, eventId: event.id, amountCents: 900 });

  await writesService.approveOrder(o1.id);
  await writesService.rejectOrder(o2.id);

  const totals = await projectionsService.getTotals(companyId);
  expect(totals.pendingCount).toBe(1);
  expect(totals.approvedTotalCents).toBe(500n);
  expect(totals.rejectedTotalCents).toBe(700n);
});
```

**Case 20: Identical timestamps, stable order**
```ts
it('two orders with identical created_at — both appear and relative order is stable across repeated queries', async () => {
  const companyId = randomUUID();
  const worker = await prisma.worker.create({ data: { id: randomUUID(), companyId, name: 'Pia' } });
  const event = await prisma.event.create({ data: { id: randomUUID(), title: 'Keynote', location: 'Main Hall' } });

  const sameTime = new Date('2024-07-01T10:00:00.000Z');
  const id1 = randomUUID();
  const id2 = randomUUID();

  for (const oid of [id1, id2]) {
    await prisma.paymentOrder.create({
      data: {
        id: oid,
        companyId,
        workerId: worker.id,
        eventId: event.id,
        amountCents: 100,
        status: 'pending',
        createdAt: sameTime,
      },
    });
    await prisma.operationReadModel.create({
      data: {
        id: oid,
        companyId,
        workerId: worker.id,
        workerName: worker.name,
        eventId: event.id,
        eventTitle: event.title,
        eventLocation: event.location,
        status: 'pending',
        amountCents: 100,
        createdAt: sameTime,
      },
    });
  }

  const page1 = await operationsService.query({ companyId, page: 1, pageSize: 10 });
  const page2 = await operationsService.query({ companyId, page: 1, pageSize: 10 });

  expect(page1.items).toHaveLength(2);
  expect(page1.total).toBe(2);

  const ids1 = page1.items.map((r) => r.id);
  const ids2 = page2.items.map((r) => r.id);
  expect(ids1).toEqual(ids2);
});
```

Now let me put it all together. I need to make sure the imports are correct and the file is complete.

One thing I want to double-check: the `PrismaClient` import. In the references, it's `import { PrismaClient } from '@prisma/client'`. Good.

Also, for the `BadRequestException` and `NotFoundException`, they come from `@nestjs/common`.

Let me also make sure I'm not missing any edge cases. Looking at the cases list again:

1. ✅ Create order then query
2. ✅ Approve then query approved
3. ✅ Reject then query rejected, absent from approved
4. ✅ 10 concurrent approves
5. ✅ Concurrent create + approve
6. ✅ Corrupt + repairDrift
7. ✅ Delete + repairDrift
8. ✅ Re-derivation after corruption
9. ✅ Page 1 size 10, 25 rows
10. ✅ Page 3 size 10, 25 rows
11. ✅ Page 99 size 10, 25 rows
12. ✅ Date range boundaries
13. ✅ approveOrder with non-existent UUID
14. ✅ approveOrder already approved
15. ✅ pageSize=101
16. ✅ page=0
17. ✅ First order for new company
18. ✅ repairDrift empty window
19. ✅ Create 3, approve 1, reject 1
20. ✅ Identical timestamps

All 20 cases covered. Let me finalize the file.

Actually, I realize I should double-check: in the `OperationsService.query` method, it takes `OperationQueryParams` which has `companyId`, `status?`, `from?`, `to?`, `page`, `pageSize`. The `from` and `to` are `Date` objects. So when I pass them in the test, I pass Date objects directly.

Also, for the `projectionsService.getTotals` - looking at the plan, it returns `Promise<CompanyTotals>`. But in the repository, `getTotals` returns `Promise<CompanyTotals | null>`. The service might handle the null case. For my tests, I'll assume it returns a non-null value when the company has orders (since the sync hook creates the totals row on first order creation).

Wait, actually looking at the plan more carefully: `getTotals(companyId: string): Promise<CompanyTotals>` - no null. So the service either throws or returns a value. For case 17, the first order creation should create the totals row via `adjustTotals` upsert.

Let me also think about whether I need to handle the case where `getTotals` might return null. In the repository, it returns `null` if no row exists. But in the service (which I can't see fully), it probably handles this. For my tests, since I'm creating orders first (which should create the totals row), I shouldn't hit the null case.

One more consideration: the `repairDrift` and `rederive` methods need a date window. For tests where I create orders using `writesService.createOrder`, the `createdAt` is set by the database to `now()`. I need to determine the window after creation. I can read the source orders to find their `createdAt` range.

Let me finalize the test file now. I'll make it clean and well-organized.
```

## reply

```ts
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OperationsService } from '../src/operations/operations.service.js';
import { OperationsRepository } from '../src/operations/operations.repository.js';
import { ProjectionsService } from '../src/projections/projections.service.js';
import { ProjectionsRepository } from '../src/projections/projections.repository.js';
import { WritesService } from '../src/writes/writes.service.js';

describe('Operations (integration)', () => {
  let prisma: PrismaClient;
  let operationsService: OperationsService;
  let projectionsService: ProjectionsService;
  let writesService: WritesService;

  beforeAll(async () => {
    prisma = new PrismaClient();
    const projectionsRepo = new ProjectionsRepository(prisma);
    projectionsService = new ProjectionsService(projectionsRepo);
    const operationsRepo = new OperationsRepository(prisma);
    operationsService = new OperationsService(operationsRepo);
    writesService = new WritesService(prisma, projectionsService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.operationReadModel.deleteMany({});
    await prisma.companyFinancialTotal.deleteMany({});
    await prisma.paymentOrder.deleteMany({});
    await prisma.worker.deleteMany({});
    await prisma.event.deleteMany({});
  });

  // ─── Read-your-own-writes ───────────────────────────────────────────────────

  describe('read-your-own-writes', () => {
    it('create order then immediately query the dashboard — new row appears with correct denormalised fields', async () => {
      const companyId = randomUUID();
      const worker = await prisma.worker.create({ data: { id: randomUUID(), companyId, name: 'Alice' } });
      const event = await prisma.event.create({ data: { id: randomUUID(), title: 'Concert', location: 'Arena' } });

      const { id } = await writesService.createOrder({
        companyId,
        workerId: worker.id,
        eventId: event.id,
        amountCents: 5000,
      });

      const page = await operationsService.query({ companyId, page: 1, pageSize: 10 });

      expect(page.total).toBe(1);
      expect(page.items[0].id).toBe(id);
      expect(page.items[0].companyId).toBe(companyId);
      expect(page.items[0].workerName).toBe('Alice');
      expect(page.items[0].eventTitle).toBe('Concert');
      expect(page.items[0].eventLocation).toBe('Arena');
      expect(page.items[0].status).toBe('pending');
      expect(page.items[0].amountCents).toBe(5000);
    });

    it('approve an order then query filtered by status=approved — row status reflects the transition', async () => {
      const companyId = randomUUID();
      const worker = await prisma.worker.create({ data: { id: randomUUID(), companyId, name: 'Bob' } });
      const event = await prisma.event.create({ data: { id: randomUUID(), title: 'Festival', location: 'Park' } });

      const { id } = await writesService.createOrder({
        companyId,
        workerId: worker.id,
        eventId: event.id,
        amountCents: 3000,
      });
      await writesService.approveOrder(id);

      const page = await operationsService.query({ companyId, status: 'approved', page: 1, pageSize: 10 });

      expect(page.total).toBe(1);
      expect(page.items[0].id).toBe(id);
      expect(page.items[0].status).toBe('approved');
    });

    it('reject an order then query filtered by status=rejected — row appears under rejected and is absent from approved', async () => {
      const companyId = randomUUID();
      const worker = await prisma.worker.create({ data: { id: randomUUID(), companyId, name: 'Carol' } });
      const event = await prisma.event.create({ data: { id: randomUUID(), title: 'Show', location: 'Theater' } });

      const { id } = await writesService.createOrder({
        companyId,
        workerId: worker.id,
        eventId: event.id,
        amountCents: 2000,
      });
      await writesService.rejectOrder(id);

      const rejectedPage = await operationsService.query({ companyId, status: 'rejected', page: 1, pageSize: 10 });
      expect(rejectedPage.total).toBe(1);
      expect(rejectedPage.items[0].id).toBe(id);
      expect(rejectedPage.items[0].status).toBe('rejected');

      const approvedPage = await operationsService.query({ companyId, status: 'approved', page: 1, pageSize: 10 });
      expect(approvedPage.total).toBe(0);
    });
  });

  // ─── Concurrent updates ─────────────────────────────────────────────────────

  describe('concurrent updates', () => {
    it('fire 10 concurrent approveOrder calls on distinct orders for the same company — totals are exact', async () => {
      const companyId = randomUUID();
      const worker = await prisma.worker.create({ data: { id: randomUUID(), companyId, name: 'Dave' } });
      const event = await prisma.event.create({ data: { id: randomUUID(), title: 'Gala', location: 'Hall' } });

      const amounts = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
      const orderIds: string[] = [];
      for (const amount of amounts) {
        const { id } = await writesService.createOrder({
          companyId,
          workerId: worker.id,
          eventId: event.id,
          amountCents: amount,
        });
        orderIds.push(id);
      }

      await Promise.all(orderIds.map((id) => writesService.approveOrder(id)));

      const totals = await projectionsService.getTotals(companyId);
      expect(totals.approvedTotalCents).toBe(5500n);
      expect(totals.pendingCount).toBe(0);
    });

    it('fire concurrent createOrder and approveOrder interleaved for one company — final totals match', async () => {
      const companyId = randomUUID();
      const worker = await prisma.worker.create({ data: { id: randomUUID(), companyId, name: 'Eve' } });
      const event = await prisma.event.create({ data: { id: randomUUID(), title: 'Fair', location: 'Grounds' } });

      const toApprove: { id: string; amount: number }[] = [];
      for (let i = 0; i < 5; i++) {
        const { id } = await writesService.createOrder({
          companyId,
          workerId: worker.id,
          eventId: event.id,
          amountCents: 100 * (i + 1),
        });
        toApprove.push({ id, amount: 100 * (i + 1) });
      }

      await Promise.all([
        ...toApprove.map((o) => writesService.approveOrder(o.id)),
        ...Array.from({ length: 5 }, (_, i) =>
          writesService.createOrder({
            companyId,
            workerId: worker.id,
            eventId: event.id,
            amountCents: 500 * (i + 1),
          }),
        ),
      ]);

      const expectedApproved = toApprove.reduce((sum, o) => sum + BigInt(o.amount), 0n);
      const totals = await projectionsService.getTotals(companyId);
      expect(totals.approvedTotalCents).toBe(expectedApproved);
      expect(totals.pendingCount).toBe(5);
    });
  });

  // ─── Drift repair ───────────────────────────────────────────────────────────

  describe('drift repair', () => {
    it('corrupt a projection row (status + amount) then run repairDrift — projection matches source and totals are corrected', async () => {
      const companyId = randomUUID();
      const worker = await prisma.worker.create({ data: { id: randomUUID(), companyId, name: 'Frank' } });
      const event = await prisma.event.create({ data: { id: randomUUID(), title: 'Mixer', location: 'Lobby' } });

      const { id } = await writesService.createOrder({
        companyId,
        workerId: worker.id,
        eventId: event.id,
        amountCents: 750,
      });
      await writesService.approveOrder(id);

      const sourceOrder = await prisma.paymentOrder.findUniqueOrThrow({ where: { id } });
      const windowStart = new Date(sourceOrder.createdAt.getTime() - 1000);
      const windowEnd = new Date(sourceOrder.createdAt.getTime() + 1000);

      await prisma.operationReadModel.update({
        where: { id },
        data: { status: 'rejected', amountCents: 9999 },
      });

      await projectionsService.repairDrift(windowStart, windowEnd);

      const repaired = await prisma.operationReadModel.findUniqueOrThrow({ where: { id } });
      expect(repaired.status).toBe('approved');
      expect(repaired.amountCents).toBe(750);

      const totals = await projectionsService.getTotals(companyId);
      expect(totals.approvedTotalCents).toBe(750n);
      expect(totals.rejectedTotalCents).toBe(0n);
      expect(totals.pendingCount).toBe(0);
    });

    it('delete a projection row then run repairDrift — row is restored and totals include its contribution', async () => {
      const companyId = randomUUID();
      const worker = await prisma.worker.create({ data: { id: randomUUID(), companyId, name: 'Grace' } });
      const event = await prisma.event.create({ data: { id: randomUUID(), title: 'Talk', location: 'Room A' } });

      const { id } = await writesService.createOrder({
        companyId,
        workerId: worker.id,
        eventId: event.id,
        amountCents: 420,
      });

      const sourceOrder = await prisma.paymentOrder.findUniqueOrThrow({ where: { id } });
      const windowStart = new Date(sourceOrder.createdAt.getTime() - 1000);
      const windowEnd = new Date(sourceOrder.createdAt.getTime() + 1000);

      await prisma.operationReadModel.delete({ where: { id } });
      await prisma.companyFinancialTotal.update({
        where: { companyId },
        data: { pendingCount: 0 },
      });

      await projectionsService.repairDrift(windowStart, windowEnd);

      const restored = await prisma.operationReadModel.findUnique({ where: { id } });
      expect(restored).not.toBeNull();
      expect(restored!.status).toBe('pending');
      expect(restored!.amountCents).toBe(420);

      const totals = await projectionsService.getTotals(companyId);
      expect(totals.pendingCount).toBe(1);
    });

    it('run repairDrift for a window that contains no orders — returns rowsCorrected=0 and totalsCorrected=false', async () => {
      const windowStart = new Date('2020-01-01T00:00:00.000Z');
      const windowEnd = new Date('2020-01-02T00:00:00.000Z');

      const report = await projectionsService.repairDrift(windowStart, windowEnd);
      expect(report.rowsCorrected).toBe(0);
      expect(report.totalsCorrected).toBe(false);
    });
  });

  // ─── Re-derivation ──────────────────────────────────────────────────────────

  describe('re-derivation', () => {
    it('create orders, corrupt projection, run rederive — projection is rebuilt from source and totals are recomputed', async () => {
      const companyId = randomUUID();
      const worker = await prisma.worker.create({ data: { id: randomUUID(), companyId, name: 'Hank' } });
      const event = await prisma.event.create({ data: { id: randomUUID(), title: 'Demo', location: 'Stage' } });

      const orderIds: string[] = [];
      for (const amount of [100, 200, 300]) {
        const { id } = await writesService.createOrder({
          companyId,
          workerId: worker.id,
          eventId: event.id,
          amountCents: amount,
        });
        orderIds.push(id);
      }

      await writesService.approveOrder(orderIds[0]);

      // Corrupt: wrong status on second, wrong amount on third
      await prisma.operationReadModel.update({ where: { id: orderIds[1] }, data: { status: 'approved' } });
      await prisma.operationReadModel.update({ where: { id: orderIds[2] }, data: { amountCents: 99999 } });

      const sourceOrders = await prisma.paymentOrder.findMany({ where: { companyId } });
      const minDate = new Date(Math.min(...sourceOrders.map((o) => o.createdAt.getTime())) - 1000);
      const maxDate = new Date(Math.max(...sourceOrders.map((o) => o.createdAt.getTime())) + 1000);

      await projectionsService.rederive(minDate, maxDate);

      for (const orderId of orderIds) {
        const source = await prisma.paymentOrder.findUniqueOrThrow({ where: { id: orderId } });
        const projection = await prisma.operationReadModel.findUniqueOrThrow({ where: { id: orderId } });
        expect(projection.status).toBe(source.status);
        expect(projection.amountCents).toBe(source.amountCents);
      }

      const totals = await projectionsService.getTotals(companyId);
      expect(totals.approvedTotalCents).toBe(100n);
      expect(totals.pendingCount).toBe(2);
    });
  });

  // ─── Pagination and filtering ───────────────────────────────────────────────

  describe('pagination and filtering', () => {
    it('insert 25 rows, query page 1 size 10 — returns 10 items and total is 25', async () => {
      const companyId = randomUUID();
      const worker = await prisma.worker.create({ data: { id: randomUUID(), companyId, name: 'Ivy' } });
      const event = await prisma.event.create({ data: { id: randomUUID(), title: 'Launch', location: 'HQ' } });

      for (let i = 0; i < 25; i++) {
        await writesService.createOrder({ companyId, workerId: worker.id, eventId: event.id, amountCents: 100 });
      }

      const page = await operationsService.query({ companyId, page: 1, pageSize: 10 });
      expect(page.items).toHaveLength(10);
      expect(page.total).toBe(25);
      expect(page.page).toBe(1);
    });

    it('query page 3 size 10 for a company with 25 rows — returns exactly 5 items', async () => {
      const companyId = randomUUID();
      const worker = await prisma.worker.create({ data: { id: randomUUID(), companyId, name: 'Jack' } });
      const event = await prisma.event.create({ data: { id: randomUUID(), title: 'Hack', location: 'Lab' } });

      for (let i = 0; i < 25; i++) {
        await writesService.createOrder({ companyId, workerId: worker.id, eventId: event.id, amountCents: 100 });
      }

      const page = await operationsService.query({ companyId, page: 3, pageSize: 10 });
      expect(page.items).toHaveLength(5);
      expect(page.total).toBe(25);
    });

    it('query page 99 size 10 for a company with 25 rows — returns 0 items and total is still 25', async () => {
      const companyId = randomUUID();
      const worker = await prisma.worker.create({ data: { id: randomUUID(), companyId, name: 'Kim' } });
      const event = await prisma.event.create({ data: { id: randomUUID(), title: 'Workshop', location: 'Office' } });

      for (let i = 0; i < 25; i++) {
        await writesService.createOrder({ companyId, workerId: worker.id, eventId: event.id, amountCents: 100 });
      }

      const page = await operationsService.query({ companyId, page: 99, pageSize: 10 });
      expect(page.items).toHaveLength(0);
      expect(page.total).toBe(25);
    });

    it('query with date range — row at from is included, row at to is excluded', async () => {
      const companyId = randomUUID();
      const worker = await prisma.worker.create({ data: { id: randomUUID(), companyId, name: 'Leo' } });
      const event = await prisma.event.create({ data: { id: randomUUID(), title: 'Seminar', location: 'Auditorium' } });

      const baseTime = new Date('2024-06-15T12:00:00.000Z');
      const from = baseTime;
      const to = new Date(baseTime.getTime() + 60000);

      const orders = [
        { id: randomUUID(), createdAt: new Date(baseTime.getTime() - 60000), amountCents: 10 },
        { id: randomUUID(), createdAt: new Date(baseTime), amountCents: 20 },
        { id: randomUUID(), createdAt: new Date(baseTime.getTime() + 30000), amountCents: 30 },
        { id: randomUUID(), createdAt: new Date(to), amountCents: 40 },
        { id: randomUUID(), createdAt: new Date(baseTime.getTime() + 120000), amountCents: 50 },
      ];

      for (const o of orders) {
        await prisma.paymentOrder.create({
          data: {
            id: o.id,
            companyId,
            workerId: worker.id,
            eventId: event.id,
            amountCents: o.amountCents,
            createdAt: o.createdAt,
          },
        });
        await prisma.operationReadModel.create({
          data: {
            id: o.id,
            companyId,
            workerId: worker.id,
            workerName: worker.name,
            eventId: event.id,
            eventTitle: event.title,
            eventLocation: event.location,
            status: 'pending',
            amountCents: o.amountCents,
            createdAt: o.createdAt,
          },
        });
      }

      const page = await operationsService.query({ companyId, from, to, page: 1, pageSize: 10 });

      const returnedIds = page.items.map((r) => r.id);
      expect(returnedIds).toContain(orders[1].id); // at from — included
      expect(returnedIds).toContain(orders[2].id); // in range — included
      expect(returnedIds).not.toContain(orders[0].id); // before from — excluded
      expect(returnedIds).not
