# repair2-operations.spec.ts

## reasoning

```
Let me analyze the compiler errors for `test/operations.spec.ts`:

1. `test/operations.spec.ts(542,81): error TS2339: Property 'id' does not exist on type 'string'.`
2. `test/operations.spec.ts(542,95): error TS2339: Property 'id' does not exist on type 'string'.`
3. `test/operations.spec.ts(545,88): error TS2339: Property 'id' does not exist on type 'string'.`
4. `test/operations.spec.ts(545,102): error TS2339: Property 'id' does not exist on type 'string'.`
5. `test/operations.spec.ts(556,35): error TS2339: Property 'id' does not exist on type 'string'.`
6. `test/operations.spec.ts(557,35): error TS2339: Property 'id' does not exist on type 'string'.`

All errors in the test file are about accessing `.id` on something that's typed as `string`. This likely means the test is calling something like `writesService.createOrder(...)` which returns `Promise<{ id: string; status: OrderStatus }>` but somewhere the test is treating the return value as a `string` and trying to access `.id` on it.

Wait, looking more carefully - the errors say "Property 'id' does not exist on type 'string'". This means something that should return an object with `.id` is being typed as `string`. 

Looking at the PLAN.md, `WritesService.createOrder` returns `Promise<{ id: string; status: OrderStatus }>`. So if the test does something like:

```ts
const result = await writesService.createOrder(...);
result.id // this should work if result is { id: string; status: OrderStatus }
```

But the error says it's `string`. So perhaps in the actual implementation, `createOrder` returns just a string (the id), not an object. Or perhaps the test is assigning the result to a variable that's typed as string.

Actually, I don't have access to the actual source files. I only have the PLAN.md and the compiler errors. Let me think about what the test file likely looks like based on the plan and the errors.

The errors are at lines 542, 545, 556, 557. These are near the end of the file (the file is at least 557 lines). The errors all involve accessing `.id` on a `string`.

Given the plan, the most likely scenario is that the test is doing something like:

```ts
const orderId = await writesService.createOrder(input);
// Then later trying to use orderId.id instead of just orderId
```

Or perhaps the test is doing:
```ts
const order = await writesService.createOrder(input);
// where createOrder actually returns string (just the id)
// but test expects { id, status } and does order.id
```

Since I can't see the actual source files, I need to make an assumption. The PLAN says `createOrder` returns `Promise<{ id: string; status: OrderStatus }>`. But the compiler says it's a `string`. 

Wait - I need to re-read the task. The task says "Rewrite `test/operations.spec.ts` complete, fixing what these messages require of this file." So I need to fix the test file to match whatever the actual source code returns.

Since the compiler says the return type is `string` (not `{ id: string; status: OrderStatus }`), the actual implementation must return just a `string`. I should add an `// ASSUMPTION:` line noting this.

Actually wait - let me reconsider. The compiler errors are ONLY for the test file. All the other errors (TS2307 Cannot find module) are for source files that don't exist yet or have issues. But the TS2339 errors in the test file are real type errors that would exist even if the modules were found.

Hmm, but if the modules can't be found (TS2307), how can the compiler know the return type is `string`? 

Actually, looking again at the error messages - ALL the source files have TS2307 "Cannot find module" errors. This means NONE of the imported modules can be resolved. When TypeScript can't resolve a module, it typically treats the import as `any`. But wait, if everything is `any`, then accessing `.id` on an `any` wouldn't produce a TS2339 error.

Unless... the test file imports something that IS resolved (like a local type) and that type is `string`. Or the test file has some local variable that's typed as `string`.

Let me think differently. Perhaps the test file has something like:

```ts
const orderIds: string[] = [];
// ... fills orderIds with strings
// Then later:
orderIds[0].id  // ERROR: Property 'id' does not exist on type 'string'
```

Or perhaps:
```ts
const createResult = await writesService.createOrder(input); // If writesService is typed such that createOrder returns string
createResult.id // ERROR
```

But if the module can't be found, the import would be `any`... unless there's a declaration file or the type is inferred differently.

Actually, I think what's happening is:
- The test file imports from modules that CAN be resolved (maybe through path aliases or because they exist but their own imports fail)
- OR the test file has a type annotation that makes something a `string`

Wait, I think I'm overcomplicating this. Let me re-read the task instructions:

"The blocks above are reference material. Rely on them; never reproduce them and never rewrite them."

So I should rely on the PLAN.md for understanding the intended shapes. The compiler errors tell me what's wrong with the test file specifically.

Given that ALL source files have "Cannot find module" errors, it's possible the source files simply don't exist yet (they need to be created as part of this task). But the task only asks me to fix `test/operations.spec.ts`.

If the source files don't exist, then in the test file, imports of those modules would be `any` type (TypeScript's default for unresolvable imports with `noImplicitAny` off, or it would error with TS2307 too). But the test file doesn't show TS2307 errors - it only shows TS2339 errors. This means the test file's imports ARE resolving to something.

Hmm, actually maybe the test file doesn't import from those source files directly. Maybe it constructs things manually or uses a different pattern.

Let me think about this differently. The task says "Rewrite `test/operations.spec.ts` complete, fixing what these messages require of this file." The only errors in this file are the TS2339 ones about `.id` on `string`. So I need to write a complete test file that:
1. Covers all the test cases in the PLAN
2. Doesn't access `.id` on a `string` type

The safest approach: I'll write the test file assuming `createOrder` returns `{ id: string; status: OrderStatus }` as per the PLAN, but I'll make sure that wherever I store the result, I properly type it. If the actual return is `string`, I'll add an ASSUMPTION line.

Actually, you know what, let me just write the test file properly. The key insight from the errors is that somewhere in the original test, a variable typed as `string` had `.id` accessed on it. In my rewrite, I'll make sure that:
- If `createOrder` returns `{ id: string; status: OrderStatus }`, I destructure or access `.id` properly
- If it returns `string`, I use it directly as the id

Since I can't see the actual source, and the PLAN says it returns `{ id: string; status: OrderStatus }`, I'll go with that. But the compiler says it's `string`. So I'll add an assumption.

Wait, actually - let me reconsider the whole situation. The compiler is reporting errors for the WHOLE workspace. The source files don't exist yet (they all have TS2307). The test file has TS2339 errors. 

If the source files don't exist, how can the test file have type errors about specific types? Unless:
1. The test file has its own type definitions/imports that DO resolve
2. Or TypeScript is doing some inference

I think the most likely explanation is: the test file imports types from `src/projections/projections.types` (which might exist as a standalone type file that doesn't depend on other modules), and uses those types. The `CreateOrderInput` type would be resolved, and if the test does something like:

```ts
const result = await someFunction(input); // where someFunction's return is inferred as string
result.id
```

OR more likely, the test has something like:

```ts
const ids = orders.map(o => o.id); // ids is string[]
ids[0].id // ERROR
```

I think the cleanest approach is: I'll write the test file based on the PLAN's specifications, making sure all type usage is correct. For the `createOrder` return type, I'll assume it returns `{ id: string; status: OrderStatus }` per the plan, and I'll destructure it properly. If the actual implementation returns just a string, the ASSUMPTION line will note that.

Let me now write the complete test file. Based on the PLAN, the tests should cover:

1. Read-your-own-writes: create order → query dashboard → assert row appears
2. Read-your-own-writes: approve order → query with status=approved → assert appears
3. Concurrent updates: N concurrent approveOrder on different orders for same company → totals exact
4. Concurrent updates: mixed create/approve concurrent → final totals correct
5. Drift repair: corrupt projection row → run repairDrift → assert fixed
6. Drrift repair: delete projection row → run repairDrift → assert restored
7. Re-derivation: create orders, corrupt, rederive → assert rebuilt
8. Dashboard pagination: 25 rows, page 1 size 10 → 10 items + total; page 3 → 5 items
9. Dashboard filter by date range

For the test setup, I need to think about how to structure this. Since this is an integration test (it tests behavior across layers), I'll need to:
- Set up a NestJS testing module or just instantiate services directly
- Use PrismaClient (with an in-memory or test database)
- Test the actual behavior

Given the conventions (Vitest, TypeScript strict), I'll write it as a proper Vitest test.

Let me think about the structure:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ProjectionsService } from '../src/projections/projections.service';
import { ProjectionsRepository } from '../src/projections/projections.repository';
import { OperationsService } from '../src/operations/operations.service';
import { OperationsRepository } from '../src/operations/operations.repository';
import { WritesService } from '../src/writes/writes.service';
import type { CreateOrderInput, OrderStatus } from '../src/projections/projections.types';
```

Now for the actual test implementation, I need to:
1. Create a PrismaClient instance
2. Instantiate repositories and services
3. For writes, I need source data (companies, workers, events) to exist

Let me think about what the test needs:
- Source data: at least one company, one worker, one event
- Then use WritesService to create orders
- Use OperationsService/Repository to query the projection
- Use ProjectionsService for drift repair and re-derivation

For the database setup, I'll use the actual PrismaClient connected to the test database (via DATABASE_URL env var).

Let me write this out:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';

// I need to import the actual services
```

Actually, I realize I should think about this more carefully. The test file needs to:
1. Connect to a database
2. Set up test data (company, worker, event)
3. Create services with proper dependencies
4. Run tests
5. Clean up

Let me write a comprehensive test file. I'll assume the services are constructed with their dependencies (repository injected), and the repository takes a PrismaClient.

Here's my plan for the test file structure:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';

let prisma: PrismaClient;
// ... service instances

beforeAll(async () => {
  prisma = new PrismaClient();
  // ... instantiate services
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Clean up test data
});

describe('Read-your-own-writes', () => {
  it('create order is immediately visible in dashboard', async () => { ... });
  it('approve order immediately reflects status change', async () => { ... });
});

describe('Concurrent updates', () => {
  it('concurrent approvals preserve exact totals', async () => { ... });
  it('mixed create/approve concurrency preserves invariant', async () => { ... });
});

describe('Drift repair', () => {
  it('detects and fixes corrupted projection row', async () => { ... });
  it('restores deleted projection row', async () => { ... });
});

describe('Re-derivation', () => {
  it('rebuilds projection from source regardless of prior corruption', async () => { ... });
});

describe('Dashboard pagination and filtering', () => {
  it('pagination returns correct items and total', async () => { ... });
  it('date range filter returns only in-range rows', async () => { ... });
});
```

Now, for the actual implementation details:

For creating test data (company, worker, event), I'll use Prisma directly since these are source tables.

For the `WritesService`, based on the PLAN it takes `(prisma: PrismaClient, projections: ProjectionsService)`.

For `ProjectionsService`, it takes `(repo: ProjectionsRepository)`.
For `ProjectionsRepository`, it takes `(prisma: PrismaClient)`.
For `OperationsService`, it takes `(repo: OperationsRepository)`.
For `OperationsRepository`, it takes `(prisma: PrismaClient)`.

Now let me think about the `.id` on `string` issue. In my test, when I call `writesService.createOrder(input)`, per the PLAN it returns `{ id: string; status: OrderStatus }`. So I'd do:

```ts
const order = await writesService.createOrder(input);
// order.id is the order's id
// order.status is the status
```

This should be fine as long as the return type matches. The compiler error suggests the actual return is `string`. I'll write it per the PLAN and add an assumption if needed.

Actually, let me reconsider. The task says "fixing what these messages require of this file." The messages say that at lines 542, 545, 556, 557, `.id` is being accessed on a `string`. So in MY rewrite, I just need to make sure I don't do that. If I write `const { id } = await writesService.createOrder(input)` or `const order = await writesService.createOrder(input); const id = order.id`, either way depends on the actual return type.

Since I can't see the source, and the PLAN says `{ id: string; status: OrderStatus }`, I'll go with that. If the actual implementation returns `string`, the test would still fail at runtime but at least compile per the plan's specification. I'll add an assumption.

Wait, actually - I just realized something. If ALL the source modules have TS2307 (cannot find module) errors, that means TypeScript can't resolve ANY of them. In that case, ALL imports in the test file would be `any` type (or would also produce TS2307). But the test file only shows TS2339, not TS2307. This is contradictory unless:

1. The test file doesn't import from those source files (it uses some other mechanism)
2. OR TypeScript is treating unresolvable imports as `any` in this config (which would make TS2339 impossible since `any` allows any property access)

Hmm, this is confusing. Let me just focus on writing a correct test file that:
- Follows the PLAN's test specifications
- Doesn't have any `.id` access on `string` typed values
- Is complete and self-contained

I'll write it assuming the PLAN's types are correct. If there's a mismatch with reality, the ASSUMPTION line will cover it.

Let me write the full test now. I need to be careful about:
1. Proper cleanup between tests (so they don't interfere)
2. Using unique company IDs or cleaning up properly
3. The concurrent tests need to actually run concurrently (Promise.all)
4. Drift repair tests need to directly corrupt the projection via Prisma

Let me draft this:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';

// ASSUMPTION: WritesService.createOrder returns { id: string; status: OrderStatus } per PLAN.md.
// If the actual implementation returns string, adjust destructuring accordingly.

let prisma: PrismaClient;
let projectionsRepo: ProjectionsRepository;
let projectionsService: ProjectionsService;
let operationsRepo: OperationsRepository;
let operationsService: OperationsService;
let writesService: WritesService;

// Test fixtures
let companyId: string;
let workerId: string;
let eventId: string;

beforeAll(async () => {
  prisma = new PrismaClient();
  
  projectionsRepo = new ProjectionsRepository(prisma);
  projectionsService = new ProjectionsService(projectionsRepo);
  operationsRepo = new OperationsRepository(prisma);
  operationsService = new OperationsService(operationsRepo);
  writesService = new WritesService(prisma, projectionsService);
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Create fresh test fixtures
  const worker = await prisma.worker.create({ data: { name: 'Test Worker', companyId: 'test-company' } });
  // Wait, I need a company first... but companies might not be in the schema
  // Let me just use string IDs for company since it's an implicit FK
});
```

Hmm, I realize I don't know if there's a `companies` table in the schema. Looking at the PLAN, it says:
- `payment_orders.company_id` — FK → companies (implicit)
- The schema only defines `payment_orders`, `events`, `workers`, and the projection tables

So `company_id` is just a string field, not a real FK to a table. That simplifies things - I can use any string as a company ID.

Let me also think about cleanup. For each test, I should clean up:
- `operation_read_models` rows for the test company
- `company_financial_totals` rows for the test company  
- `payment_orders` rows for the test company
- `workers` and `events` created for the test

Actually, for simplicity and to avoid interference between tests, I'll use a unique company ID per test (or per describe block) and clean up in beforeEach/afterEach.

Let me write the complete file now:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';

// ASSUMPTION: WritesService.createOrder returns { id: string; status: OrderStatus } as specified in PLAN.md.

let prisma: PrismaClient;
let projectionsRepo: import('../src/projections/projections.repository').ProjectionsRepository;
// ... etc
```

Actually, let me just use proper imports at the top. Let me write this properly now.

One more consideration: for the concurrent tests, I need to make sure the database supports the concurrent operations. With Postgres and Prisma, each `prisma.$transaction` call creates a separate transaction, so concurrent calls should work fine (they'll be serialized by the database's row locking).

For the drift repair test, I need to:
1. Create some orders via WritesService (which populates the projection)
2. Directly modify the projection table via Prisma (simulating drift)
3. Call projectionsService.repairDrift(from, to)
4. Assert the projection matches the source

Let me finalize my test file. I'll be thorough but practical.

Actually, I want to double-check: the `rederive` and `repairDrift` methods take `(from: Date, to: Date)` where the window is `[from, to)`. I need to make sure my test data falls within the window.

For the date range filter test, I'll create orders with specific timestamps by using `prisma.$executeRaw` or by creating them at controlled times. Actually, since `created_at` defaults to `now()`, all orders created in a test will have approximately the same timestamp. For the date range test, I can set `from` to slightly before and `to` to slightly after the creation time.

Let me write the final version now. I'll make it clean and comprehensive.
```

## reply

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';

// ASSUMPTION: WritesService.createOrder returns { id: string; status: OrderStatus } per PLAN.md.
// ASSUMPTION: The source tables (payment_orders, events, workers) are managed via Prisma;
//   company_id is a plain string column (no dedicated companies table in schema).

import { ProjectionsRepository } from '../src/projections/projections.repository';
import { ProjectionsService } from '../src/projections/projections.service';
import { OperationsRepository } from '../src/operations/operations.repository';
import { OperationsService } from '../src/operations/operations.service';
import { WritesService } from '../src/writes/writes.service';
import type {
  CreateOrderInput,
  OperationQueryParams,
  OperationRow,
} from '../src/projections/projections.types';

let prisma: PrismaClient;
let projectionsRepo: ProjectionsRepository;
let projectionsService: ProjectionsService;
let operationsRepo: OperationsRepository;
let operationsService: OperationsService;
let writesService: WritesService;

beforeAll(async () => {
  prisma = new PrismaClient();
  projectionsRepo = new ProjectionsRepository(prisma);
  projectionsService = new ProjectionsService(projectionsRepo);
  operationsRepo = new OperationsRepository(prisma);
  operationsService = new OperationsService(operationsRepo);
  writesService = new WritesService(prisma, projectionsService);
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** Creates a worker and event for the given company; returns their IDs. */
async function createFixtures(companyId: string): Promise<{ workerId: string; eventId: string }> {
  const worker = await prisma.worker.create({
    data: { name: `Worker ${companyId}`, companyId },
  });
  const event = await prisma.event.create({
    data: { title: `Event ${companyId}`, location: `Location ${companyId}` },
  });
  return { workerId: worker.id, eventId: event.id };
}

/** Cleans up all data belonging to the given company across source and projection tables. */
async function cleanup(companyId: string): Promise<void> {
  await prisma.operationReadModel.deleteMany({ where: { companyId } });
  await prisma.companyFinancialTotals.deleteMany({ where: { companyId } });
  await prisma.paymentOrder.deleteMany({ where: { companyId } });
  await prisma.worker.deleteMany({ where: { companyId } });
}

function makeOrderInput(companyId: string, workerId: string, eventId: string, amountCents: number): CreateOrderInput {
  return { companyId, workerId, eventId, amountCents };
}

describe('Read-your-own-writes', () => {
  it('a newly created order is immediately visible in the dashboard query', async () => {
    const companyId = 'ryw-create-' + Date.now();
    const { workerId, eventId } = await createFixtures(companyId);

    const order = await writesService.createOrder(
      makeOrderInput(companyId, workerId, eventId, 5000),
    );

    const page = await operationsService.query({
      companyId,
      page: 1,
      pageSize: 20,
    });

    expect(page.total).toBe(1);
    expect(page.items).toHaveLength(1);
    const row = page.items[0];
    expect(row.id).toBe(order.id);
    expect(row.status).toBe('pending');
    expect(row.amountCents).toBe(5000);
    expect(row.workerId).toBe(workerId);
    expect(row.eventId).toBe(eventId);

    await cleanup(companyId);
  });

  it('an approved order immediately reflects the status change in a filtered dashboard query', async () => {
    const companyId = 'ryw-approve-' + Date.now();
    const { workerId, eventId } = await createFixtures(companyId);

    const order = await writesService.createOrder(
      makeOrderInput(companyId, workerId, eventId, 7500),
    );
    await writesService.approveOrder(order.id);

    const page = await operationsService.query({
      companyId,
      status: 'approved',
      page: 1,
      pageSize: 20,
    });

    expect(page.total).toBe(1);
    expect(page.items[0].id).toBe(order.id);
    expect(page.items[0].status).toBe('approved');

    await cleanup(companyId);
  });
});

describe('Concurrent updates to one company totals', () => {
  it('concurrent approvals on different orders preserve exact totals', async () => {
    const companyId = 'conc-approve-' + Date.now();
    const { workerId, eventId } = await createFixtures(companyId);

    const amounts = [1000, 2000, 3000, 4000, 5000];
    const orders = await Promise.all(
      amounts.map((a) =>
        writesService.createOrder(makeOrderInput(companyId, workerId, eventId, a)),
      ),
    );

    // Approve all orders concurrently
    await Promise.all(orders.map((o) => writesService.approveOrder(o.id)));

    const totals = await projectionsService.getTotals(companyId);
    expect(totals.approvedTotalCents).toBe(15000n);
    expect(totals.rejectedTotalCents).toBe(0n);
    expect(totals.pendingCount).toBe(0);

    await cleanup(companyId);
  });

  it('mixed concurrent create and approve preserves the final invariant', async () => {
    const companyId = 'conc-mixed-' + Date.now();
    const { workerId, eventId } = await createFixtures(companyId);

    // Create 5 orders sequentially first
    const orders = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        writesService.createOrder(makeOrderInput(companyId, workerId, eventId, (i + 1) * 1000)),
      ),
    );

    // Now concurrently: approve 3, reject 2
    const [toApprove, toReject] = [orders.slice(0, 3), orders.slice(3, 5)];
    await Promise.all([
      ...toApprove.map((o) => writesService.approveOrder(o.id)),
      ...toReject.map((o) => writesService.rejectOrder(o.id)),
    ]);

    const totals = await projectionsService.getTotals(companyId);
    expect(totals.approvedTotalCents).toBe(6000n); // 1000+2000+3000
    expect(totals.rejectedTotalCents).toBe(7000n); // 4000+5000
    expect(totals.pendingCount).toBe(0);

    await cleanup(companyId);
  });
});

describe('Drift repair', () => {
  it('detects and fixes a corrupted projection row (wrong status)', async () => {
    const companyId = 'drift-status-' + Date.now();
    const { workerId, eventId } = await createFixtures(companyId);

    const order = await writesService.createOrder(
      makeOrderInput(companyId, workerId, eventId, 9000),
    );
    await writesService.approveOrder(order.id);

    const before = new Date(Date.now() - 60_000);
    const after = new Date(Date.now() + 60_000);

    // Corrupt: set projection status back to 'pending'
    await prisma.operationReadModel.update({
      where: { id: order.id },
      data: { status: 'pending' as any },
    });

    const report = await projectionsService.repairDrift(before, after);
    expect(report.rowsCorrected).toBeGreaterThanOrEqual(1);

    // Verify projection now matches source
    const page = await operationsService.query({ companyId, page: 1, pageSize: 20 });
    expect(page.items[0].status).toBe('approved');

    // Verify totals are corrected
    const totals = await projectionsService.getTotals(companyId);
    expect(totals.approvedTotalCents).toBe(9000n);
    expect(totals.pendingCount).toBe(0);

    await cleanup(companyId);
  });

  it('restores a deleted projection row and corrects totals', async () => {
    const companyId = 'drift-delete-' + Date.now();
    const { workerId, eventId } = await createFixtures(companyId);

    const order = await writesService.createOrder(
      makeOrderInput(companyId, workerId, eventId, 4200),
    );

    const before = new Date(Date.now() - 60_000);
    const after = new Date(Date.now() + 60_000);

    // Delete the projection row
    await prisma.operationReadModel.delete({ where: { id: order.id } });

    const report = await projectionsService.repairDrift(before, after);
    expect(report.rowsCorrected).toBeGreaterThanOrEqual(1);

    // Row should be restored
    const page = await operationsService.query({ companyId, page: 1, pageSize: 20 });
    expect(page.total).toBe(1);
    expect(page.items[0].id).toBe(order.id);

    // Totals should reflect the pending order
    const totals = await projectionsService.getTotals(companyId);
    expect(totals.pendingCount).toBe(1);

    await cleanup(companyId);
  });
});

describe('Re-derivation', () => {
  it('rebuilds the projection from source regardless of prior corruption', async () => {
    const companyId = 'rederive-' + Date.now();
    const { workerId, eventId } = await createFixtures(companyId);

    const amounts = [100, 200, 300];
    const orders = await Promise.all(
      amounts.map((a) => writesService.createOrder(makeOrderInput(companyId, workerId, eventId, a))),
    );

    // Corrupt all projection rows
    for (const o of orders) {
      await prisma.operationReadModel.update({
        where: { id: o.id },
        data: { amountCents: 99999, status: 'rejected' as any },
      });
    }

    const before = new Date(Date.now() - 60_000);
    const after = new Date(Date.now() + 60_000);

    const report = await projectionsService.rederive(before, after);
    expect(report.rowsCorrected).toBeGreaterThanOrEqual(3);

    // Verify all rows are correct
    const page = await operationsService.query({ companyId, page: 1, pageSize: 20 });
    expect(page.total).toBe(3);
    for (const row of page.items) {
      expect(row.status).toBe('pending');
      const sourceOrder = orders.find((o) => o.id === row.id)!;
      expect(row.amountCents).toBe(amounts[orders.indexOf(sourceOrder)]);
    }

    await cleanup(companyId);
  });
});

describe('Dashboard pagination and filtering', () => {
  it('pagination returns correct item count and total across pages', async () => {
    const companyId = 'paging-' + Date.now();
    const { workerId, eventId } = await createFixtures(companyId);

    // Insert 25 orders
    for (let i = 0; i < 25; i++) {
      await writesService.createOrder(makeOrderInput(companyId, workerId, eventId, (i + 1) * 100));
    }

    const page1 = await operationsService.query({ companyId, page: 1, pageSize: 10 });
    expect(page1.items).toHaveLength(10);
    expect(page1.total).toBe(25);
    expect(page1.page).toBe(1);
    expect(page1.pageSize).toBe(10);

    const page3 = await operationsService.query({ companyId, page: 3, pageSize: 10 });
    expect(page3.items).toHaveLength(5);
    expect(page3.total).toBe(25);
    expect(page3.page).toBe(3);

    await cleanup(companyId);
  });

  it('date range filter returns only rows within the specified window', async () => {
    const companyId = 'datefilter-' + Date.now();
    const { workerId, eventId } = await createFixtures(companyId);

    // Create an "old" order, then pause briefly, then a "new" order
    await writesService.createOrder(makeOrderInput(companyId, workerId, eventId, 100));

    // Small delay so timestamps differ
    await new Promise((r) => setTimeout(r, 50));

    const from = new Date();
    await writesService.createOrder(makeOrderInput(companyId, workerId, eventId, 200));

    // Query with a window that only includes the second order
    const page = await operationsService.query({
      companyId,
      from,
      to: new Date(Date.now() + 60_000),
      page: 1,
      pageSize: 20,
    });

    expect(page.total).toBe(1);
    expect(page.items[0].amountCents).toBe(200);

    await cleanup(companyId);
  });
});
```
