# 15-operations.spec.ts-retry

## reasoning

```
Let me analyze the test cases from `15-operations.spec.ts-cases.txt` and the plan to write the complete test file.

The test cases are:
1. Create order then immediately query dashboard — new row appears with correct denormalised fields
2. Approve an order then query filtered by status=approved — status reflects transition
3. Reject an order then query filtered by status=rejected — row appears under rejected, absent from approved
4. Fire 10 concurrent approveOrder calls on distinct orders for same company — totals correct
5. Fire concurrent createOrder and approveOrder interleaved for one company — final totals correct
6. Corrupt a projection row (status + amount), run repairDrift — projection matches source, totals corrected
7. Delete a projection row, run repairDrift — row restored, totals include contribution
8. Create orders, corrupt projection, run rederive — projection matches source, totals recomputed
9. Insert 25 rows, query page 1 size 10 — 10 items, total 25
10. Query page 3 size 10 for 25 rows — 5 items
11. Query page 99 size 10 for 25 rows — 0 items, total 25
12. Insert orders with known timestamps, query date range — only in-range rows
13. approveOrder with non-existent UUID — error code `order_not_found`
14. approveOrder on already-approved order — error code `invalid_transition`
15. Dashboard with pageSize=101 — error code `invalid_query_params`
16. Dashboard with page=0 — error code `invalid_query_params`
17. Create first order for brand-new company — getTotals returns pending_count=1, zero totals
18. Run repairDrift for empty window — rowsCorrected=0, totalsCorrected=false
19. Create 3 orders, approve 1, reject 1 — totals correct per status
20. Two orders with identical created_at — both appear, stable order

Now let me think about the test setup:
- I need to use Vitest
- I need to instantiate the services with a real PrismaClient (integration tests)
- I need to clean up between tests

Looking at the architecture:
- `WritesService` takes `PrismaClient` and `ProjectionsService`
- `OperationsService` takes `OperationsRepository`
- `OperationsRepository` takes `PrismaClient`
- `ProjectionsService` takes `ProjectionsRepository`
- `ProjectionsRepository` takes `PrismaClient`

So I'll instantiate everything with a shared `PrismaClient` instance.

For the "corrupt" tests, I'll use raw SQL via `prisma.$executeRaw` to directly modify/delete projection rows.

Let me think about the `applyOrderCreated` method - looking at the projections.service.ts reference, it's truncated with `...`. But from the plan:
- It upserts the row into `operation_read_models`
- Calls `adjustTotals(companyId, { pendingDelta: +1 })`

And `applyOrderStatusChanged`:
- Updates `operation_read_models.status`
- Calls `adjustTotals(companyId, { pendingDelta: -1, approvedCents: +amount })` (for approve)
- Or `adjustTotals(companyId, { pendingDelta: -1, rejectedCents: +amount })` (for reject)

Wait, looking more carefully at the plan's control flow:
- `applyOrderStatusChanged(orderId, 'approved')`: updates status, calls `adjustTotals(companyId, { pendingDelta: -1, approvedCents: +amount })`
- For reject it would be `adjustTotals(companyId, { pendingDelta: -1, rejectedCents: +amount })`

But the method signature is `applyOrderStatusChanged(orderId: string, newStatus: OrderStatus)`. So the service needs to look up the order to get the company and amount. Let me think about how this works...

Actually, looking at the WritesService code in the reference:
```ts
await this.projections.applyOrderStatusChanged(orderId, newStatus);
```

The projections service method takes `orderId` and `newStatus`. It needs to:
1. Look up the projection row (or source) to get companyId and amountCents
2. Update the projection row's status
3. Adjust totals

Since I can't see the full implementation of `projections.service.ts` (it's truncated), I'll assume it works correctly as specified in the plan. The tests will test behavior, not implementation.

Now for the test file structure:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
// ... imports for services

let prisma: PrismaClient;
let writesService: WritesService;
let operationsService: OperationsService;
let projectionsService: ProjectionsService;

beforeAll(async () => {
  prisma = new PrismaClient();
  const projectionsRepo = new ProjectionsRepository(prisma);
  projectionsService = new ProjectionsService(projectionsRepo);
  writesService = new WritesService(prisma, projectionsService);
  const operationsRepo = new OperationsRepository(prisma);
  operationsService = new OperationsService(operationsRepo);
});

afterAll(async () => {
  await prisma.$disconnect();
});
```

For cleanup, I'll need to delete test data between tests. I'll use a helper to create test fixtures (worker, event) and clean up after each test.

Let me think about how to handle the "corrupt" tests. I'll use `prisma.$executeRaw` to directly modify rows in `operation_read_models`.

For the concurrency tests, I'll use `Promise.all` to fire concurrent requests.

Let me think about the error handling. Looking at the WritesService:
- It throws `NotFoundException` for not found
- It throws `BadRequestException` for invalid transition

But the plan says errors should use the standard envelope. Looking at the operations.service.ts reference:
```ts
throw new BadRequestException({
  error: {
    code: 'invalid_query_params',
    message: `...`,
    details: { page: params.page, pageSize: params.pageSize },
  },
});
```

So for the error tests, I need to check that the thrown exception has the right structure. For `OperationsService.query`, it throws `BadRequestException` with the envelope as the response body.

For `WritesService`, looking at the reference code, it throws plain `NotFoundException` and `BadRequestException` without the envelope structure. But the plan says all errors use the standard envelope...

Hmm, this is a conflict. The reference code shows:
```ts
throw new NotFoundException(`Order ${orderId} not found`);
throw new BadRequestException(`Invalid transition: order is already ${newStatus}`);
```

But the plan says errors should use `{ error: { code, message, details } }`. 

The test cases say:
- "returns an error with code `order_not_found`"
- "returns an error with code `invalid_transition`"

I think the tests should verify that the thrown exception carries the right error code. Since I can't see the full implementation of `projections.service.ts`, and the `writes.service.ts` reference shows plain exceptions, I'll need to make an assumption.

Actually wait - let me re-read the reference for `writes.service.ts`. It uses `NotFoundException` and `BadRequestException` without the envelope. But the plan's error table says:
- `order_not_found` raised by `WritesService.approveOrder`, `rejectOrder`
- `invalid_transition` raised by `WritesService.approveOrder`, `rejectOrder`

And the operations.service.ts reference DOES use the envelope format with `BadRequestException`.

So there's an inconsistency. The writes service in the reference doesn't use the envelope, but the plan says it should. Since the test cases specifically check for error codes (`order_not_found`, `invalid_transition`), I need to test that somehow.

I think the most defensible approach is:
- For `OperationsService.query` errors: check that the thrown `BadRequestException` has a response body with `error.code === 'invalid_query_params'`
- For `WritesService` errors: I'll need to assume the service throws exceptions that carry the error code. Since the reference shows plain `NotFoundException` and `BadRequestException`, but the plan says they should have codes...

Actually, let me look at this differently. The test file is supposed to test behavior. If the service throws a `NotFoundException`, I can catch it and verify it's thrown. The "code" contract might be enforced at a different layer (interceptor). But the test cases explicitly say "returns an error with code `order_not_found`".

I think the most reasonable interpretation is that the services DO throw exceptions with the envelope structure, similar to how `OperationsService` does. The reference code for `writes.service.ts` might be an incomplete/buggy version. Since I'm writing tests against the plan (which says errors use the standard envelope), I'll test for the envelope structure.

Wait, but I can only rely on what's shown. The reference for `writes.service.ts` clearly shows:
```ts
throw new NotFoundException(`Order ${orderId} not found`);
throw new BadRequestException(`Invalid transition: order is already ${newStatus}`);
```

These don't have the envelope. But `operations.service.ts` does:
```ts
throw new BadRequestException({
  error: { code: 'invalid_query_params', ... }
});
```

I think the safest approach for the writes service tests is to just assert that the correct exception type is thrown, and if possible check the message contains relevant info. But the test cases say "returns an error with code `order_not_found`"...

Let me re-read the instructions: "If a symbol you need is genuinely absent from both the plan and the references, do not guess in silence and do not reason around it: write the file using the most defensible reading and mark it with one `// ASSUMPTION:` comment"

The plan says the error codes are `order_not_found` and `invalid_transition`. The reference shows plain exceptions without envelopes. I'll write the tests to check for the exception being thrown and include an ASSUMPTION comment about how the error code is accessible.

Actually, looking at NestJS `HttpException`, it has a `getResponse()` method that returns the response body. If the service throws `new NotFoundException('message')`, then `getResponse()` returns a string (the message). If it throws `new NotFoundException({ error: { code: '...', ... } })`, then `getResponse()` returns the object.

Given that the plan explicitly lists error codes as a contract, and the operations.service.ts reference shows the pattern of embedding the envelope in the exception, I'll assume the writes service follows the same pattern (the reference might be an earlier/incomplete version). I'll write tests that check `exception.getResponse()` for the error code, with an ASSUMPTION comment.

Actually, let me just be pragmatic. I'll write the tests to:
1. Expect an exception to be thrown
2. Check that it's an HttpException (or subclass)
3. Check the response has the right error code

For `operations.service.ts`, the pattern is clear from the reference.
For `writes.service.ts`, I'll use an ASSUMPTION.

Let me now write the full test file.

For the "stable order" test (case 20), I need two orders with identical `created_at`. The plan says the sort should have a deterministic tiebreak. Looking at the index: `@@index([company_id, status, created_at(sort: Desc)])`. There's no secondary sort key in the index or the query. The `orderBy` in the repository is just `{ createdAt: 'desc' }`.

Hmm, but the test case says "their relative order is stable across repeated queries (deterministic tiebreak)". If the query only sorts by `createdAt DESC`, then for identical timestamps, the order is non-deterministic in Postgres. 

But the test case says this should pass... So either:
1. The repository has a secondary sort key (like `id`) that I'm not seeing
2. Or the test is meant to verify that both rows appear (not necessarily in a specific order)

Looking at the test case more carefully: "both appear, and their relative order is stable across repeated queries (deterministic tiebreak) — fails if the sort has no secondary key"

This implies the implementation SHOULD have a secondary key. Since the reference repository only shows `orderBy: { createdAt: 'desc' }`, this might be a bug in the implementation. But my job is to write tests, not fix the implementation.

I'll write the test to query twice and assert that both rows appear in the same order both times. If the implementation doesn't have a tiebreak, this test will be flaky - but that's what the test case specifies.

Actually wait - I should write the test as specified. The test says "both appear, and their relative order is stable across repeated queries". I'll query twice and compare the arrays.

Now let me think about the fixture setup. For each test I need:
- A company (just a string ID, no actual table needed based on the schema)
- A worker
- An event

Looking at the schema, `payment_orders` has `company_id`, `worker_id`, `event_id` but there are no actual FK constraints defined in the Prisma schema (they're just strings). So I just need to create workers and events rows.

Wait, looking at the schema more carefully from the plan:
- `payment_orders.company_id` - "FK → companies (implicit)"
- There's no `companies` table defined!

So `company_id` is just a string field. I don't need to create a company row. I just need worker and event rows.

Let me structure the cleanup:
- Before each test: clean all tables (or at least the relevant ones)
- Create fixtures as needed

Actually for performance, I'll clean in `beforeEach` and create minimal fixtures per test.

Let me write this out now:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { WritesService } from '../src/writes/writes.service.js';
import { OperationsService } from '../src/operations/operations.service.js';
import { OperationsRepository } from '../src/operations/operations.repository.js';
import { ProjectionsService } from '../src/projections/projections.service.js';
import { ProjectionsRepository } from '../src/projections/projections.repository.js';
import type { CreateOrderInput, OperationRow } from '../src/projections/projections.types.js';
import { HttpException } from '@nestjs/common';

let prisma: PrismaClient;
let writesService: WritesService;
let operationsService: OperationsService;
let projectionsService: ProjectionsService;

// Helper to create a worker
async function createWorker(name: string, companyId: string): Promise<string> {
  const worker = await prisma.worker.create({ data: { name, companyId } });
  return worker.id;
}

// Helper to create an event
async function createEvent(title: string, location: string): Promise<string> {
  const event = await prisma.event.create({ data: { title, location } });
  return event.id;
}

// Helper to clean all data
async function cleanAll() {
  await prisma.operationReadModel.deleteMany({});
  await prisma.companyFinancialTotal.deleteMany({});
  await prisma.paymentOrder.deleteMany({});
  await prisma.worker.deleteMany({});
  await prisma.event.deleteMany({});
}

beforeAll(async () => {
  prisma = new PrismaClient();
  const projectionsRepo = new ProjectionsRepository(prisma);
  projectionsService = new ProjectionsService(projectionsRepo);
  writesService = new WritesService(prisma, projectionsService);
  const operationsRepo = new OperationsRepository(prisma);
  operationsService = new OperationsService(operationsRepo);
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await cleanAll();
});
```

Wait, I need to think about the Prisma model names. From the plan:
- `payment_orders` → model name in Prisma would be... Looking at the repository code, it uses `this.prisma.paymentOrder`, `this.prisma.operationReadModel`, `this.prisma.companyFinancialTotal`, `this.prisma.worker`, and raw SQL for `events`.

Actually looking at the `fetchSourceWindow` in the repository, it uses raw SQL with table names `payment_orders`, `workers`, `events`. So the Prisma model for events might be `event` (singular) or accessed via raw SQL.

Let me check - the repository uses:
- `this.prisma.operationReadModel` → model `OperationReadModel`
- `this.prisma.companyFinancialTotal` → model `CompanyFinancialTotal`
- `this.prisma.paymentOrder` → model `PaymentOrder` (from writes.service.ts)

For workers and events, in the test I'll use `prisma.worker` and... hmm, I don't see explicit Prisma model usage for events in the references. The raw SQL uses `events` table.

Looking at the plan's schema, the models are:
- `PaymentOrder` (mapped to `payment_orders`)
- `Event` (mapped to `events`)
- `Worker` (mapped to `workers`)
- `OperationReadModel` (mapped to `operation_read_models`)
- `CompanyFinancialTotal` (mapped to `company_financial_totals`)

So in Prisma client, they'd be accessed as:
- `prisma.paymentOrder`
- `prisma.event`
- `prisma.worker`
- `prisma.operationReadModel`
- `prisma.companyFinancialTotal`

I'll use these. If `prisma.event` doesn't work (maybe it's named differently), I can use raw SQL. But based on standard Prisma naming conventions, `Event` model → `prisma.event`.

Actually, I realize I should be careful. Let me just use raw SQL for creating workers and events in the test setup to be safe, since I know the table names from the raw SQL in the repository.

No wait, that's overthinking it. The plan defines the models clearly. I'll use `prisma.worker` and `prisma.event`. If there's an issue, the ASSUMPTION comment will cover it.

Let me now write the complete test file with all 20 test cases.

For the concurrency tests, I need to be careful. The `WritesService.createOrder` and `approveOrder` each open their own transaction. When I fire them concurrently with `Promise.all`, they'll run in parallel, each with their own transaction. The `adjustTotals` uses `increment` in an upsert, which should be atomic in Postgres (the UPDATE ... SET col = col + delta is atomic).

For the drift repair tests, I need to:
1. Create orders (which creates projection rows)
2. Corrupt the projection (using raw SQL or direct Prisma update on the projection table)
3. Run `projectionsService.repairDrift(from, to)`
4. Verify the projection is correct

For re-derivation:
1. Create orders
2. Corrupt projection
3. Run `projectionsService.rederive(from, to)`
4. Verify

Let me think about what `repairDrift` and `rederive` do based on the plan:

`rederive(from, to)`:
- Delete projection rows for window
- Fetch source window
- Bulk upsert
- Recompute totals for affected companies
- Return DriftReport

`repairDrift(from, to)`:
- Fetch source and projection for window
- Compute diff (missing rows, stale rows, extra rows)
- Apply corrections
- Recompute totals for affected companies
- Return DriftReport

For the "empty window" test, `repairDrift` should return `{ rowsCorrected: 0, totalsCorrected: false }`.

Now let me write the full file. I'll be thorough and cover all 20 cases.

One more thing - for the `getTotals` test (case 17), I need to access the totals. The `ProjectionsService.getTotals(companyId)` method should work.

Let me also think about the `OperationPage` return type. The items are `OperationRow[]` which includes all the denormalised fields.

OK let me write this now. I'll organize by test case groups:
1. Read-your-own-writes (cases 1, 2, 3)
2. Concurrency (cases 4, 5)
3. Drift repair (cases 6, 7, 18)
4. Re-derivation (case 8)
5. Pagination (cases 9, 10, 11)
6. Date range filtering (case 12)
7. Error handling (cases 13, 14, 15, 16)
8. Totals correctness (cases 17, 19)
9. Sort stability (case 20)

Let me write it all out now.

For the ASSUMPTION about writes service error format: I'll check if the thrown exception is an HttpException and inspect its response. For `operations.service.ts` I know the format from the reference. For `writes.service.ts`, I'll assume it follows the same pattern (envelope in the exception response) since the plan mandates it.

Actually, let me look at this one more time. The test case says:
"Call `approveOrder` with a UUID that does not exist in `payment_orders` — returns an error with code `order_not_found`"

The reference shows:
```ts
throw new NotFoundException(`Order ${orderId} not found`);
```

In NestJS, `NotFoundException` extends `HttpException`. When you do `new NotFoundException('message')`, the response is just the string `'message'` (or `{ statusCode: 404, message: 'message', error: 'Not Found' }` depending on NestJS version).

But if you do `new NotFoundException({ error: { code: 'order_not_found', ... } })`, the response would be that object.

Since the plan says the error contract is `{ error: { code, message, details } }`, and the operations service clearly follows this pattern, I'll assume the writes service does too (the reference code might be a partial/buggy version). I'll write the test to check for this pattern and add an ASSUMPTION comment.

Let me finalize my approach:
- For operations service errors: test the exact pattern shown in reference
- For writes service errors: assume envelope pattern, add ASSUMPTION

Now writing the full file.
```

## reply

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { HttpException, NotFoundException, BadRequestException } from '@nestjs/common';
import { WritesService } from '../src/writes/writes.service.js';
import { OperationsService } from '../src/operations/operations.service.js';
import { OperationsRepository } from '../src/operations/operations.repository.js';
import { ProjectionsService } from '../src/projections/projections.service.js';
import { ProjectionsRepository } from '../src/projections/projections.repository.js';
import type { CreateOrderInput, OperationRow, CompanyTotals } from '../src/projections/projections.types.js';

let prisma: PrismaClient;
let writesService: WritesService;
let operationsService: OperationsService;
let projectionsService: ProjectionsService;

// --- helpers ---------------------------------------------------------------

async function cleanAll(): Promise<void> {
  await prisma.operationReadModel.deleteMany({});
  await prisma.companyFinancialTotal.deleteMany({});
  await prisma.paymentOrder.deleteMany({});
  await prisma.worker.deleteMany({});
  await prisma.event.deleteMany({});
}

async function makeWorker(name: string, companyId: string): Promise<string> {
  const w = await prisma.worker.create({ data: { name, companyId } });
  return w.id;
}

async function makeEvent(title: string, location: string): Promise<string> {
  const e = await prisma.event.create({ data: { title, location } });
  return e.id;
}

function makeOrderInput(overrides: Partial<CreateOrderInput> = {}): CreateOrderInput {
  return {
    companyId: 'company-a',
    workerId: 'worker-1',
    eventId: 'event-1',
    amountCents: 5000,
    ...overrides,
  };
}

async function createAndVerifyOrder(
  companyId: string,
  workerId: string,
  eventId: string,
  amountCents: number,
): Promise<string> {
  const result = await writesService.createOrder({ companyId, workerId, eventId, amountCents });
  return result.id;
}

function getErrorEnvelope(ex: unknown): { code: string; message: string; details: Record<string, unknown> } {
  if (ex instanceof HttpException) {
    const resp = ex.getResponse();
    if (typeof resp === 'object' && resp !== null) {
      const body = resp as Record<string, unknown>;
      const error = body.error as { code: string; message: string; details: Record<string, unknown> };
      return error;
    }
  }
  throw new Error(`Expected HttpException with envelope, got: ${ex instanceof Error ? ex.message : String(ex)}`);
}

// --- setup / teardown -------------------------------------------------------

beforeAll(async () => {
  prisma = new PrismaClient();
  const projectionsRepo = new ProjectionsRepository(prisma);
  projectionsService = new ProjectionsService(projectionsRepo);
  writesService = new WritesService(prisma, projectionsService);
  const operationsRepo = new OperationsRepository(prisma);
  operationsService = new OperationsService(operationsRepo);
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await cleanAll();
});

// --- 1. Read-your-own-writes: create order ----------------------------------

describe('read-your-own-writes', () => {
  it('create order then immediately query the dashboard for that company — the new row appears with correct denormalised fields', async () => {
    const companyId = 'company-a';
    const workerId = await makeWorker('Alice', companyId);
    const eventId = await makeEvent('Conference', 'Hall A');

    const orderId = await createAndVerifyOrder(companyId, workerId, eventId, 12000);

    const page = await operationsService.query({ companyId, page: 1, pageSize: 10 });

    expect(page.total).toBe(1);
    expect(page.items).toHaveLength(1);
    const row = page.items[0];
    expect(row.id).toBe(orderId);
    expect(row.companyId).toBe(companyId);
    expect(row.workerId).toBe(workerId);
    expect(row.workerName).toBe('Alice');
    expect(row.eventId).toBe(eventId);
    expect(row.eventTitle).toBe('Conference');
    expect(row.eventLocation).toBe('Hall A');
    expect(row.status).toBe('pending');
    expect(row.amountCents).toBe(12000);
  });

  it('approve an order then query filtered by status=approved — the row appears under approved', async () => {
    const companyId = 'company-a';
    const workerId = await makeWorker('Bob', companyId);
    const eventId = await makeEvent('Workshop', 'Room 2');

    const orderId = await createAndVerifyOrder(companyId, workerId, eventId, 7500);
    await writesService.approveOrder(orderId);

    const page = await operationsService.query({ companyId, status: 'approved', page: 1, pageSize: 10 });
    expect(page.total).toBe(1);
    expect(page.items[0].id).toBe(orderId);
    expect(page.items[0].status).toBe('approved');
  });

  it('reject an order then query filtered by status=rejected — the row appears under rejected and is absent from approved', async () => {
    const companyId = 'company-a';
    const workerId = await makeWorker('Carol', companyId);
    const eventId = await makeEvent('Seminar', 'Room 3');

    const orderId = await createAndVerifyOrder(companyId, workerId, eventId, 3000);
    await writesService.rejectOrder(orderId);

    const rejectedPage = await operationsService.query({ companyId, status: 'rejected', page: 1, pageSize: 10 });
    expect(rejectedPage.total).toBe(1);
    expect(rejectedPage.items[0].id).toBe(orderId);
    expect(rejectedPage.items[0].status).toBe('rejected');

    const approvedPage = await operationsService.query({ companyId, status: 'approved', page: 1, pageSize: 10 });
    expect(approvedPage.total).toBe(0);
  });
});

// --- 2. Concurrency ----------------------------------------------------------

describe('concurrent updates', () => {
  it('10 concurrent approveOrder calls on distinct orders for the same company produce exact totals', async () => {
    const companyId = 'company-concurrent';
    const workerId = await makeWorker('Dave', companyId);
    const eventId = await makeEvent('Meetup', 'Lobby');

    const amounts: number[] = [];
    for (let i = 0; i < 10; i++) {
      const amt = (i + 1) * 1000;
      amounts.push(amt);
      await writesService.createOrder({ companyId, workerId, eventId, amountCents: amt });
    }

    const orders = await prisma.paymentOrder.findMany({ where: { companyId } });
    const orderIds = orders.map((o) => o.id);

    await Promise.all(orderIds.map((id) => writesService.approveOrder(id)));

    const totals = await projectionsService.getTotals(companyId);
    expect(totals).not.toBeNull();
    const expectedApproved = amounts.reduce((sum, a) => sum + BigInt(a), 0n);
    expect(totals!.approvedTotalCents).toBe(expectedApproved);
    expect(totals!.rejectedTotalCents).toBe(0n);
    expect(totals!.pendingCount).toBe(0);
  });

  it('concurrent createOrder and approveOrder interleaved for one company preserve totals invariant', async () => {
    const companyId = 'company-mixed';
    const workerId = await makeWorker('Eve', companyId);
    const eventId = await makeEvent('Hackathon', 'Lab');

    // Create 5 orders that will be approved
    const approveAmounts: number[] = [];
    const approveOrderIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const amt = (i + 1) * 2000;
      approveAmounts.push(amt);
      const id = await createAndVerifyOrder(companyId, workerId, eventId, amt);
      approveOrderIds.push(id);
    }

    // Create 5 orders that will remain pending
    const pendingAmounts: number[] = [];
    for (let i = 0; i < 5; i++) {
      const amt = (i + 1) * 3000;
      pendingAmounts.push(amt);
      await createAndVerifyOrder(companyId, workerId, eventId, amt);
    }

    // Fire approves concurrently (creates are already done, so no create/approve race here;
    // but we still test concurrent approve + a concurrent new create)
    const newCreatePromise = writesService.createOrder({ companyId, workerId, eventId, amountCents: 9999 });
    const approvePromises = approveOrderIds.map((id) => writesService.approveOrder(id));

    await Promise.all([newCreatePromise, ...approvePromises]);

    const totals = await projectionsService.getTotals(companyId);
    expect(totals).not.toBeNull();
    const expectedApproved = approveAmounts.reduce((sum, a) => sum + BigInt(a), 0n);
    expect(totals!.approvedTotalCents).toBe(expectedApproved);
    // 5 pending originals + 1 new = 6 pending
    expect(totals!.pendingCount).toBe(6);
    expect(totals!.rejectedTotalCents).toBe(0n);
  });
});

// --- 3. Drift repair ---------------------------------------------------------

describe('drift repair', () => {
  it('corrupt a projection row (status + amount), run repairDrift — projection matches source and totals are corrected', async () => {
    const companyId = 'company-drift1';
    const workerId = await makeWorker('Frank', companyId);
    const eventId = await makeEvent('Retreat', 'Venue B');

    const orderId = await createAndVerifyOrder(companyId, workerId, eventId, 8000);

    // Corrupt: change status to 'approved' and amount to 9999 in the projection
    await prisma.$executeRaw`
      UPDATE operation_read_models
      SET status = 'approved', amount_cents = 9999
      WHERE id = ${orderId}
    `;

    const from = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const to = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const report = await projectionsService.repairDrift(from, to);
    expect(report.rowsCorrected).toBeGreaterThanOrEqual(1);

    // Verify projection now matches source
    const row = await prisma.operationReadModel.findUniqueOrThrow({ where: { id: orderId } });
    expect(row.status).toBe('pending');
    expect(row.amountCents).toBe(8000);

    // Verify totals are corrected (should be pending_count=1, approved=0)
    const totals = await projectionsService.getTotals(companyId);
    expect(totals).not.toBeNull();
    expect(totals!.pendingCount).toBe(1);
    expect(totals!.approvedTotalCents).toBe(0n);
  });

  it('delete a projection row, run repairDrift — the row is restored with correct fields and totals include its contribution', async () => {
    const companyId = 'company-drift2';
    const workerId = await makeWorker('Grace', companyId);
    const eventId = await makeEvent('Symposium', 'Center');

    const orderId = await createAndVerifyOrder(companyId, workerId, eventId, 4500);

    // Delete the projection row directly
    await prisma.$executeRaw`
      DELETE FROM operation_read_models WHERE id = ${orderId}
    `;

    const from = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const to = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const report = await projectionsService.repairDrift(from, to);
    expect(report.rowsCorrected).toBeGreaterThanOrEqual(1);

    // Verify row is restored
    const row = await prisma.operationReadModel.findUniqueOrThrow({ where: { id: orderId } });
    expect(row.companyId).toBe(companyId);
    expect(row.workerName).toBe('Grace');
    expect(row.eventTitle).toBe('Symposium');
    expect(row.status).toBe('pending');
    expect(row.amountCents).toBe(4500);

    // Totals should reflect the restored row
    const totals = await projectionsService.getTotals(companyId);
    expect(totals).not.toBeNull();
    expect(totals!.pendingCount).toBe(1);
  });

  it('run repairDrift for a window that contains no orders — returns rowsCorrected=0 and totalsCorrected=false', async () => {
    const from = new Date('2020-01-01T00:00:00Z');
    const to = new Date('2020-01-02T00:00:00Z');

    const report = await projectionsService.repairDrift(from, to);
    expect(report.rowsCorrected).toBe(0);
    expect(report.totalsCorrected).toBe(false);
  });
});

// --- 4. Re-derivation ---------------------------------------------------------

describe('re-derivation', () => {
  it('create orders, corrupt projection, run rederive — projection matches source and totals are recomputed', async () => {
    const companyId = 'company-rederive';
    const workerId = await makeWorker('Heidi', companyId);
    const eventId = await makeEvent('Forum', 'Stage');

    const order1 = await createAndVerifyOrder(companyId, workerId, eventId, 1000);
    const order2 = await createAndVerifyOrder(companyId, workerId, eventId, 2000);
    const order3 = await createAndVerifyOrder(companyId, workerId, eventId, 3000);

    // Approve order1
    await writesService.approveOrder(order1);

    // Corrupt: wrong status on order2, wrong amount on order3
    await prisma.$executeRaw`
      UPDATE operation_read_models SET status = 'approved' WHERE id = ${order2}
    `;
    await prisma.$executeRaw`
      UPDATE operation_read_models SET amount_cents = 99999 WHERE id = ${order3}
    `;

    const from = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const to = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const report = await projectionsService.rederive(from, to);
    expect(report.rowsCorrected).toBeGreaterThanOrEqual(3);

    // Verify all three rows match source
    const r1 = await prisma.operationReadModel.findUniqueOrThrow({ where: { id: order1 } });
    expect(r1.status).toBe('approved');
    expect(r1.amountCents).toBe(1000);

    const r2 = await prisma.operationReadModel.findUniqueOrThrow({ where: { id: order2 } });
    expect(r2.status).toBe('pending');
    expect(r2.amountCents).toBe(2000);

    const r3 = await prisma.operationReadModel.findUniqueOrThrow({ where: { id: order3 } });
    expect(r3.status).toBe('pending');
    expect(r3.amountCents).toBe(3000);

    // Totals: 1 approved (1000), 2 pending
    const totals = await projectionsService.getTotals(companyId);
    expect(totals).not.toBeNull();
    expect(totals!.approvedTotalCents).toBe(1000n);
    expect(totals!.pendingCount).toBe(2);
  });
});

// --- 5. Pagination -------------------------------------------------------------

describe('pagination', () => {
  async function seedCompany(companyId: string, count: number): Promise<void> {
    const workerId = await makeWorker('Pagination Worker', companyId);
    const eventId = await makeEvent('Pag Event', 'Loc');
    for (let i = 0; i < count; i++) {
      await writesService.createOrder({ companyId, workerId, eventId, amountCents: 100 + i });
    }
  }

  it('insert 25 rows, query page 1 size 10 — returns exactly 10 items and total is 25', async () => {
    const companyId = 'company-pag1';
    await seedCompany(companyId, 25);

    const page = await operationsService.query({ companyId, page: 1, pageSize: 10 });
    expect(page.items).toHaveLength(10);
    expect(page.total).toBe(25);
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(10);
  });

  it('query page 3 size 10 for a company with 25 rows — returns exactly 5 items', async () => {
    const companyId = 'company-pag3';
    await seedCompany(companyId, 25);

    const page = await operationsService.query({ companyId, page: 3, pageSize: 10 });
    expect(page.items).toHaveLength(5);
    expect(page.total).toBe(25);
  });

  it('query page 99 size 10 for a company with 25 rows — returns 0 items and total is still 25', async () => {
    const companyId = 'company-pag99';
    await seedCompany(companyId, 25);

    const page = await operationsService.query({ companyId, page: 99, pageSize: 10 });
    expect(page.items).toHaveLength(0);
    expect(page.total).toBe(25);
  });
});

// --- 6. Date range filtering ----------------------------------------------------

describe('date range filtering', () => {
  it('only strictly-in-range rows are returned; from is included, to is excluded', async () => {
    const companyId = 'company-daterange';
    const workerId = await makeWorker('Date Worker', companyId);
    const eventId = await makeEvent('Date Event', 'DateLoc');

    // We'll create 3 orders and then overwrite their created_at in both source and projection
    const orderBefore = await writesService.createOrder({ companyId, workerId, eventId, amountCents: 100 });
    const orderIn = await writesService.createOrder({ companyId, workerId, eventId, amountCents: 200 });
    const orderAtFrom = await writesService.createOrder({ companyId, workerId, eventId, amountCents: 300 });
    const orderAtTo = await writesService.createOrder({ companyId, workerId, eventId, amountCents: 400 });

    const from = new Date('2025-06-01T00:00:00.000Z');
    const to = new Date('2025-06-05T00:00:00.000Z');

    // Set created_at on source and projection
    await prisma.$executeRaw`
      UPDATE payment_orders SET created_at = '2025-05-30T00:00:00.000Z' WHERE id = ${orderBefore.id}
    `;
    await prisma.$executeRaw`
      UPDATE operation_read_models SET created_at = '2025-05-30T00:00:00.000Z' WHERE id = ${orderBefore.id}
    `;

    await prisma.$executeRaw`
      UPDATE payment_orders SET created_at = '2025-06-02T00:00:00.000Z' WHERE id = ${orderIn.id}
    `;
    await prisma.$executeRaw`
      UPDATE operation_read_models SET created_at = '2025-06-02T00:00:00.000Z' WHERE id = ${orderIn.id}
    `;

    await prisma.$executeRaw`
      UPDATE payment_orders SET created_at = '2025-06-01T00:00:00.000Z' WHERE id = ${orderAtFrom.id}
    `;
    await prisma.$executeRaw`
      UPDATE operation_read_models SET created_at = '2025-06-01T00:00:00.000Z' WHERE id = ${orderAtFrom.id}
    `;

    await prisma.$executeRaw`
      UPDATE payment_orders SET created_at = '2025-06-05T00:00:00.000Z' WHERE id = ${orderAtTo.id}
    `;
    await prisma.$executeRaw`
      UPDATE operation_read_models SET created_at = '2025-06-05T00:00:00.000Z' WHERE id = ${orderAtTo.id}
    `;

    const page = await operationsService.query({ companyId, from, to, page: 1, pageSize: 100 });
    const ids = page.items.map((r) => r.id);
    expect(page.total).toBe(2);
    expect(ids).toContain(orderAtFrom.id); // from is included (gte)
    expect(ids).toContain(orderIn.id);
    expect(ids).not.toContain(orderBefore.id); // before from
    expect(ids).not.toContain(orderAtTo.id); // to is excluded (lt)
  });
});

// --- 7. Error handling -----------------------------------------------------------

describe('error handling', () => {
  it('approveOrder with a non-existent UUID — returns an error with code order_not_found', async () => {
    // ASSUMPTION: WritesService throws exceptions carrying the standard error envelope (code/message/details) in the HttpException response, consistent with OperationsService and the plan's error contract.
    await expect(writesService.approveOrder('00000000-0000-0000-0000-000000000000')).rejects.toThrow();

    try {
      await writesService.approveOrder('00000000-0000-0000-0000-000000000000');
    } catch (ex) {
      const envelope = getErrorEnvelope(ex);
      expect(envelope.code).toBe('order_not_found');
    }
  });

  it('approveOrder on an already-approved order — returns an error with code invalid_transition', async () => {
    const companyId = 'company-err';
    const workerId = await makeWorker('Err Worker', companyId);
    const eventId = await makeEvent('Err Event', 'ErrLoc');

    const orderId = await createAndVerifyOrder(companyId, workerId, eventId, 1000);
    await writesService.approveOrder(orderId);

    // ASSUMPTION: same envelope pattern as above
    try {
      await writesService.approveOrder(orderId);
      expect.fail('should have thrown');
    } catch (ex) {
      const envelope = getErrorEnvelope(ex);
      expect(envelope.code).toBe('invalid_transition');
    }
  });

  it('dashboard with pageSize=101 — returns an error with code invalid_query_params', async () => {
    try {
      await operationsService.query({ companyId: 'x', page: 1, pageSize: 101 });
      expect.fail('should have thrown');
    } catch (ex) {
      const envelope = getErrorEnvelope(ex);
      expect(envelope.code).toBe('invalid_query_params');
    }
  });

  it('dashboard with page=0 — returns an error with code invalid_query_params', async () => {
    try {
      await operationsService.query({ companyId: 'x', page: 0, pageSize: 10 });
      expect.fail('should have thrown');
    } catch (ex) {
      const envelope = getErrorEnvelope(ex);
      expect(envelope.code).toBe('invalid_query_params');
    }
  });
});

// --- 8. Totals correctness --------------------------------------------------------

describe('totals correctness', () => {
  it('create the first order for a brand-new company — getTotals returns pending_count=1 and zero totals', async () => {
    const companyId = 'company-new-totals';
    const workerId = await makeWorker('NewCo Worker', companyId);
    const eventId = await makeEvent('NewCo Event', 'NewLoc');

    await createAndVerifyOrder(companyId, workerId, eventId, 5000);

    const totals = await projectionsService.getTotals(companyId);
    expect(totals).not.toBeNull();
    expect(totals!.pendingCount).toBe(1);
    expect(totals!.approvedTotalCents).toBe(0n);
    expect(totals!.rejectedTotalCents).toBe(0n);
  });

  it('create 3 orders, approve 1, reject 1 — totals reflect each status bucket correctly', async () => {
    const companyId = 'company-buckets';
    const workerId = await makeWorker('Bucket Worker', companyId);
    const eventId = await makeEvent('Bucket Event', 'BucketLoc');

    const orderA = await createAndVerifyOrder(companyId, workerId, eventId, 1000);
    const orderB = await createAndVerifyOrder(companyId, workerId, eventId, 2000);
    const orderC = await createAndVerifyOrder(companyId, workerId, eventId, 3000);

    await writesService.approveOrder(orderA);
    await writesService.rejectOrder(orderB);

    const totals = await projectionsService.getTotals(companyId);
    expect(totals).not.toBeNull();
    expect(totals!.pendingCount).toBe(1);
    expect(totals!.approvedTotalCents).toBe(1000n);
    expect(totals!.rejectedTotalCents).toBe(2000n);
  });
});

// --- 9. Sort stability --------------------------------------------------------------

describe('sort stability', () => {
  it('two orders with identical created_at — both appear and relative order is stable across repeated queries', async () => {
    const companyId = 'company-stable';
    const workerId = await makeWorker('Stable Worker', companyId);
    const eventId = await makeEvent('Stable Event', 'StableLoc');

    const order1 = await createAndVerifyOrder(companyId, workerId, eventId, 1000);
    const order2 = await createAndVerifyOrder(companyId, workerId, eventId, 2000);

    // Set both to the same timestamp
    const fixedDate = new Date('2025-07-01T12:00:00.000Z');
    await prisma.$executeRaw`
      UPDATE payment_orders SET created_at = ${fixedDate} WHERE id IN (${order1.id}, ${order2.id})
    `;
    await prisma.$executeRaw`
      UPDATE operation_read_models SET created_at = ${fixedDate} WHERE id IN (${order1.id}, ${order2.id})
    `;

    const page1 = await operationsService.query({ companyId, page: 1, pageSize: 10 });
    const page2 = await operationsService.query({ companyId, page: 1, pageSize: 10 });

    expect(page1.items).toHaveLength(2);
    const ids1 = page1.items.map((r) => r.id);
    const ids2 = page2.items.map((r) => r.id);

    // Both orders must appear
    expect(ids1).toContain(order1.id);
    expect(ids1).toContain(order2.id);

    // Relative order must be stable
    expect(ids1).toEqual(ids2);
  });
});
```
