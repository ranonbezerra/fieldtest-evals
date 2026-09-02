# repair1-drift-repair.spec.ts

## reasoning

```
Let me analyze the compiler errors for `test/drift-repair.spec.ts`:

1. `test/drift-repair.spec.ts(2,36): error TS2307: Cannot find module '../src/drift-repair/drift-repair.service' or its corresponding type declarations.`
   - The import path for `drift-repair.service` can't be resolved. This is because `src/drift-repair/drift-repair.service.ts` itself has errors (it can't find `../operations/operations.repository` and `../operations/operations.types`). But the task says "Change nothing the messages do not name." So I need to fix what's in `test/drift-repair.spec.ts`.

2. `test/drift-repair.spec.ts(166,13): error TS2352: Conversion of type 'MockProjectionRow' to type 'Record<string, unknown>' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.`
   - There's a type assertion on line 166 that needs to go through `unknown` first.

Now, the first error is that `../src/drift-repair/drift-repair.service` can't be found. Looking at the other errors, `src/drift-repair/drift-repair.service.ts` has its own import errors (it can't find `../operations/operations.repository` and `../operations/operations.types`). But the task says to only fix what's in `test/drift-repair.spec.ts`.

Wait, let me re-read: "Rewrite `test/drift-repair.spec.ts` complete, fixing what these messages require of this file."

So I need to fix the two errors that are in `test/drift-repair.spec.ts`:
1. Line 2: `Cannot find module '../src/drift-repair/drift-repair.service'`
2. Line 166: Type conversion issue

For error 1: The module `../src/drift-repair/drift-repair.service` can't be found because that file itself has unresolved imports. But the task says "Change nothing the messages do not name." The message names `test/drift-repair.spec.ts(2,36)` - it's the import in the test file. 

But wait - the issue is that `src/drift-repair/drift-repair.service.ts` exists but has its own compilation errors. The `TS2307` error on line 2 of the test file means TypeScript can't resolve the module. This could be because:
- The file doesn't exist at that path
- The file exists but has errors that prevent it from being a valid module

Looking at the plan manifest, `src/drift-repair/drift-repair.service.ts` is listed. And the error messages show `src/drift-repair/drift-repair.service.ts` has errors (lines 1-5 reference missing modules). So the file exists but its imports are broken.

Hmm, but the task says to only fix `test/drift-repair.spec.ts`. The TS2307 on line 2 is because the target module can't be resolved due to its own errors. I can't fix that from the test file alone... unless I use a different import strategy or add an `// ASSUMPTION:` line.

Actually wait - let me reconsider. The task says "fixing what these messages require of this file." The message `test/drift-repair.spec.ts(2,36): error TS2307` is naming this file. The fix would be to ensure the import works. But if the target module has its own errors, the import will still fail regardless of what I do in the test file.

I think the right approach is:
- For the TS2307 on line 2: I'll keep the import as-is (it's correct per the plan), and add an `// ASSUMPTION:` line explaining that the module's own imports are broken in the current workspace state.
- For the TS2352 on line 166: I'll fix the type assertion by going through `unknown` first.

Actually, let me reconsider again. The task says "fixing what these messages require of this file." Maybe the TS2307 error is telling me that the import path is wrong? Let me check the layout:

The test file is at `test/drift-repair.spec.ts`. The service is at `src/drift-repair/drift-repair.service.ts`. So the relative path from `test/` to `src/drift-repair/drift-repair.service.ts` would be `../src/drift-repair/drift-repair.service`. That looks correct.

The issue is that `src/drift-repair/drift-repair.service.ts` itself can't compile because its imports of `../operations/operations.repository` and `../operations/operations.types` fail. And those fail because... let me look at the errors:

- `src/operations/operations.repository.ts(8,8): error TS2307: Cannot find module './operations.types' or its corresponding type declarations.`
- `src/operations/operations.service.ts(2,38): error TS2307: Cannot find module './operations.repository' or its corresponding type declarations.`
- `src/operations/operations.service.ts(10,8): error TS2307: Cannot find module './operations.types' or its corresponding type declarations.`

So `src/operations/operations.types.ts` can't be found! And `src/operations/operations.repository.ts` can't be found from the service. These are missing files in the workspace.

So the chain is:
- `test/drift-repair.spec.ts` imports `../src/drift-repair/drift-repair.service`
- That service imports `../operations/operations.repository`
- That repository imports `./operations.types` (which doesn't exist)
- So the whole chain breaks

Since I can only fix `test/drift-repair.spec.ts`, and the root cause is missing files elsewhere, I should add an `// ASSUMPTION:` line.

Now let me think about what the test file should look like based on the plan:

From the plan, the tests for drift-repair are:
1. `drift-repair detects and repairs a stale projection row`
2. `drift-repair skips rows where source is newer than projection (concurrent write guard)`
3. `drift-repair recomputes company totals after repair`

The plan says:
- `DriftRepairService.run()` returns `DriftRepairReport`
- It defines window `[now − 1 h, now]`
- Fetches projection rows with `updated_at` in window
- For each row, fetches corresponding source + worker + last-event
- If source `updated_at` > projection `updated_at`, re-derive that single row
- Recomputes `company_financial_totals` for affected companies

The repository methods available (from the plan):
- `findProjectionByWindow(from, to): Promise<OperationRow[]>`
- `findOrdersByWindow(from, to)`
- `findWorkerById(workerId)`
- `findLastEventForOrder(orderId)`
- `upsertOperation(tx, order, worker, lastEventType)`
- `upsertCompanyTotal(tx, companyId, deltaAmount, deltaCount)`

Wait, but the plan says drift-repair uses "recompute (not delta) the company_financial_totals". Let me re-read...

Actually looking at the plan more carefully:
- For `reDerive`: "Recompute (not delta) the `company_financial_totals` for that company by SUM/COUNT over `payment_orders` WHERE `company_id = ?`"
- For `drift-repair`: "Recompute `company_financial_totals` for affected companies (SUM/COUNT from source)"

So the repository needs a method to recompute totals. But looking at the repository interface in the plan, I only see `upsertCompanyTotal(tx, companyId, deltaAmount, deltaCount)`. There's no `recomputeCompanyTotal` method explicitly listed. 

Hmm, but the plan says for drift-repair: "Recompute `company_financial_totals` for affected companies (SUM/COUNT from source)." This implies a different method than the delta-based `upsertCompanyTotal`. Maybe it's done via raw query in the repository? Or maybe there's an implicit method.

Since I can only see what the plan specifies for the repository interface, and it doesn't explicitly list a `recomputeCompanyTotal` method, I'll need to make an assumption. Let me look at what methods are listed:

```
upsertOperation(tx, order, worker, lastEventType)
queryDashboard(query)
upsertCompanyTotal(tx, companyId, deltaAmount, deltaCount)
findOrdersByWindow(from, to)
findWorkerById(workerId)
findLastEventForOrder(orderId)
findProjectionByWindow(from, to)
getOperationByOrderId(orderId)
getCompanyTotal(companyId)
```

For the drift-repair test, I need to mock the repository. The service will call:
- `findProjectionByWindow(from, to)` to get projection rows in the window
- For each stale row, it needs to fetch the source order, worker, and last event
- Then upsert the projection
- Then recompute totals

For recomputing totals, since the plan says "SUM/COUNT from source", there might be a method like `recomputeCompanyTotal(companyId)` that does a full recompute. I'll assume such a method exists since the plan explicitly calls for recompute semantics in drift-repair.

Actually, I need to be more careful. Let me think about what the DriftRepairService would look like based on the plan:

```typescript
export class DriftRepairService {
  constructor(repo: OperationsRepository) {}
  run(): Promise<DriftRepairReport>;
}
```

The `run()` method:
1. window = [now - 1h, now]
2. projectionRows = await repo.findProjectionByWindow(window.start, window.end)
3. For each row:
   - Fetch source order (need a method to get a single order by ID... `getOperationByOrderId` is for the projection. We need something for the source.)
   
Hmm, looking at the repository interface again:
- `findOrdersByWindow(from, to)` - gets orders in a time window
- There's no `findOrderByOrderId` or similar

Wait, maybe the drift repair uses `findOrdersByWindow` with a narrow window, or maybe there's an implicit method. Let me think about this differently.

Actually, for the test, I'm mocking the repository. So I need to know what methods the service calls. Based on the plan's control flow:

"3. For each row, fetch the corresponding `payment_orders` + worker + last-event."

This implies:
- Fetch source order by ID (some method)
- `findWorkerById(workerId)` 
- `findLastEventForOrder(orderId)`

Then:
"the projection is stale → re-derive that single row (same upsert as in reDerive step 3)"
- `upsertOperation(tx, order, worker, lastEventType)`

"4. Recompute `company_financial_totals` for affected companies (SUM/COUNT from source)"
- Some recompute method

Since the plan doesn't explicitly list a `findOrderByOrderId` or `recomputeCompanyTotal` method in the repository interface, I'll add `// ASSUMPTION:` lines for these.

Let me now write the test file. I'll structure it as:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { DriftRepairService } from '../src/drift-repair/drift-repair.service';
// ... other imports

describe('DriftRepairService', () => {
  // mock repository
  // tests...
});
```

For the TS2352 error on line 166, I need to see what's being cast. Since I'm rewriting the file, I'll make sure any casts go through `unknown` first.

Let me write the complete test file now. I'll need to be careful about:
1. The import of `DriftRepairService` - keep it, add ASSUMPTION if needed
2. Any type assertions - use `as unknown as X` pattern
3. Test the three scenarios from the plan

Let me think about what the DriftRepairService constructor takes and what `run()` does:

From the plan:
- Constructor takes `OperationsRepository`
- `run()` returns `Promise<DriftRepairReport>`
- `DriftRepairReport` has: `window_start`, `window_end`, `rows_checked`, `rows_repaired`

The service logic:
1. window = [now - 1h, now]
2. projectionRows = repo.findProjectionByWindow(windowStart, windowEnd)
3. For each projectionRow:
   - Get source order (by order_id)
   - If source.updated_at > projectionRow.updated_at → stale
   - Get worker
   - Get last event
   - Upsert projection (in a transaction)
   - Recompute totals for that company
4. Return report

For the test, I'll mock the repository methods. Let me figure out what methods to mock:

Based on the plan's repository interface and the drift-repair control flow, the service likely calls:
- `findProjectionByWindow(from, to)` 
- Some way to get the source order by ID - I'll assume `findOrderByOrderId(orderId)` or similar
- `findWorkerById(workerId)`
- `findLastEventForOrder(orderId)`
- `upsertOperation(...)` or similar for the repair
- Some method to recompute totals

Actually, I realize I'm overthinking this. The task is to fix the compilation errors in the test file. The two errors are:
1. Module not found for the import (caused by broken chain elsewhere)
2. Type assertion needs `unknown` intermediate

For error 1, since I can't fix the other files, I'll keep the import and add an ASSUMPTION line.

For error 2, I need to make sure any type assertion in my rewrite goes through `unknown`.

Let me write a clean, complete test file that:
- Imports DriftRepairService (with ASSUMPTION about the broken chain)
- Mocks the repository appropriately
- Tests the three scenarios
- Uses `as unknown as X` for any type assertions

Let me draft this:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
// ASSUMPTION: The module '../src/drift-repair/drift-repair.service' cannot be resolved because its transitive imports (../operations/operations.types, ../operations/operations.repository) are missing in the current workspace. The import is kept per plan.
import { DriftRepairService } from '../src/drift-repair/drift-repair.service';

// ASSUMPTION: The plan specifies drift-repair fetches source orders by ID and recomputes totals via SUM/COUNT, but the repository interface in the plan does not explicitly list methods `findOrderByOrderId` or `recomputeCompanyTotal`. These are assumed to exist on the repository for the drift-repair use case.

interface MockProjectionRow {
  order_id: string;
  company_id: string;
  status: string;
  amount: string;
  currency: string;
  worker_name: string;
  worker_role: string;
  last_event_type: string | null;
  created_at: Date;
  updated_at: Date;
}

function makeProjectionRow(overrides: Partial<MockProjectionRow> = {}): MockProjectionRow {
  return {
    order_id: 'order-1',
    company_id: 'company-1',
    status: 'approved',
    amount: '100.00',
    currency: 'USD',
    worker_name: 'Alice',
    worker_role: 'driver',
    last_event_type: null,
    created_at: new Date('2024-01-15T10:00:00Z'),
    updated_at: new Date('2024-01-15T10:00:00Z'),
    ...overrides,
  };
}

function makeSourceOrder(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'order-1',
    company_id: 'company-1',
    worker_id: 'worker-1',
    status: 'approved',
    amount: '100.00',
    currency: 'USD',
    created_at: new Date('2024-01-15T10:00:00Z'),
    updated_at: new Date('2024-01-15T10:00:00Z'),
    ...overrides,
  };
}

describe('DriftRepairService', () => {
  let repo: Record<string, (...args: unknown[]) => unknown>;
  let service: DriftRepairService;

  beforeEach(() => {
    repo = {
      findProjectionByWindow: vi.fn(),
      findOrderByOrderId: vi.fn(), // ASSUMPTION: method not explicitly in plan's repo interface
      findWorkerById: vi.fn(),
      findLastEventForOrder: vi.fn(),
      upsertOperation: vi.fn(),
      recomputeCompanyTotal: vi.fn(), // ASSUMPTION: method not explicitly in plan's repo interface
    };
    service = new DriftRepairService(repo as unknown as Parameters<typeof DriftRepairService extends new (...args: infer A) => any ? A : never>[0]);
  });

  it('detects and repairs a stale projection row', async () => {
    const now = new Date('2024-01-15T12:00:00Z');
    const windowStart = new Date('2024-01-15T11:00:00Z');
    
    const staleRow = makeProjectionRow({
      order_id: 'order-stale',
      updated_at: new Date('2024-01-15T11:30:00Z'),
    });

    const sourceOrder = makeSourceOrder({
      id: 'order-stale',
      updated_at: new Date('2024-01-15T11:35:00Z'), // newer than projection
    });

    (repo.findProjectionByWindow as ReturnType<typeof vi.fn>).mockResolvedValue([staleRow]);
    (repo.findOrderByOrderId as ReturnType<typeof vi.fn>).mockResolvedValue(sourceOrder);
    (repo.findWorkerById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'worker-1', name: 'Alice', role: 'driver' });
    (repo.findLastEventForOrder as ReturnType<typeof vi.fn>).mockResolvedValue('status_changed');
    (repo.upsertOperation as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (repo.recomputeCompanyTotal as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    // Mock Date to control "now"
    const dateSpy = vi.spyOn(global, 'Date').mockImplementation(() => now as unknown as Date);
    
    const report = await service.run();

    expect(report.rows_checked).toBe(1);
    expect(report.rows_repaired).toBe(1);
    expect(repo.upsertOperation).toHaveBeenCalled();
    expect(repo.recomputeCompanyTotal).toHaveBeenCalledWith('company-1');

    dateSpy.mockRestore();
  });

  it('skips rows where source is newer than projection (concurrent write guard)', async () => {
    const now = new Date('2024-01-15T12:00:00Z');
    
    const freshRow = makeProjectionRow({
      order_id: 'order-fresh',
      updated_at: new Date('2024-01-15T11:45:00Z'),
    });

    const sourceOrder = makeSourceOrder({
      id: 'order-fresh',
      updated_at: new Date('2024-01-15T11:30:00Z'), // older than projection → NOT stale
    });

    (repo.findProjectionByWindow as ReturnType<typeof vi.fn>).mockResolvedValue([freshRow]);
    (repo.findOrderByOrderId as ReturnType<typeof vi.fn>).mockResolvedValue(sourceOrder);

    const report = await service.run();

    expect(report.rows_checked).toBe(1);
    expect(report.rows_repaired).toBe(0);
    expect(repo.upsertOperation).not.toHaveBeenCalled();
    expect(repo.recomputeCompanyTotal).not.toHaveBeenCalled();
  });

  it('recomputes company totals after repair', async () => {
    const now = new Date('2024-01-15T12:00:00Z');
    
    const staleRow1 = makeProjectionRow({
      order_id: 'order-a',
      company_id: 'company-x',
    });
    const staleRow2 = makeProjectionRow({
      order_id: 'order-b',
      company_id: 'company-x',
    });

    const sourceOrderA = makeSourceOrder({ id: 'order-a', company_id: 'company-x' });
    const sourceOrderB = makeSourceOrder({ id: 'order-b', company_id: 'company-x' });

    (repo.findProjectionByWindow as ReturnType<typeof vi.fn>).mockResolvedValue([staleRow1, staleRow2]);
    (repo.findOrderByOrderId as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(sourceOrderA)
      .mockResolvedValueOnce(sourceOrderB);
    (repo.findWorkerById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'worker-1', name: 'Bob', role: 'driver' });
    (repo.findLastEventForOrder as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (repo.upsertOperation as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (repo.recomputeCompanyTotal as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const report = await service.run();

    expect(report.rows_repaired).toBe(2);
    // Totals recomputed for the affected company
    expect(repo.recomputeCompanyTotal).toHaveBeenCalledWith('company-x');
  });
});
```

Hmm wait, I need to be more careful. Let me think about what the service actually does and what it calls on the repository.

The issue is I don't have the actual implementation of `DriftRepairService`. I only have the plan. Let me re-read the plan's control flow for drift-repair:

"1. Define window: `[now − 1 h, now]`.
2. Fetch projection rows with `updated_at` in window.
3. For each row, fetch the corresponding `payment_orders` + worker + last-event. If the source `updated_at` > projection `updated_at`, the projection is stale → re-derive that single row (same upsert as in reDerive step 3).
4. Recompute `company_financial_totals` for affected companies (SUM/COUNT from source).
5. Return report."

So the service:
1. Computes window
2. Calls `repo.findProjectionByWindow(windowStart, windowEnd)` 
3. For each row:
   a. Fetch source order (by the row's `order_id`) - needs a method
   b. Fetch worker (by source order's `worker_id`) - `repo.findWorkerById(workerId)`
   c. Fetch last event (by order_id) - `repo.findLastEventForOrder(orderId)`
   d. If source.updated_at > row.updated_at:
      - Upsert projection - `repo.upsertOperation(...)` or similar
4. For affected companies, recompute totals
5. Return report

The problem is I don't know the exact method names for (a) and (4). The plan's repository interface doesn't list them explicitly.

For the test, I'm mocking the repo. The key question is: what does the service call? Since I can't see the implementation, I need to make reasonable assumptions based on the plan.

Actually, wait. Let me re-read the task instructions: "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly."

The TS2307 error on line 2 refers to the module `../src/drift-repair/drift-repair.service`. I can't see its actual implementation (only the plan's signature). The error is caused by the module's own broken imports. I should add an ASSUMPTION line about this.

For the TS2352 error on line 166, it's about a type conversion from `MockProjectionRow` to `Record<string, unknown>`. The fix is to use `as unknown as Record<string, unknown>`.

Let me simplify my approach. I'll write the test file with:
1. The import kept, with an ASSUMPTION about the broken chain
2. Proper type assertions using `as unknown as X`
3. Tests for the three scenarios from the plan
4. ASSUMPTION lines where I'm guessing at method names/shapes

Actually, I realize I should think about this more carefully. The test needs to actually test the DriftRepairService. The service takes a repository in its constructor. I need to mock that repository and test the service's behavior.

But since I can't see the actual implementation of DriftRepairService, I'm somewhat constrained. However, the plan gives me enough to write meaningful tests:
- The service's `run()` method takes no arguments and returns a `DriftRepairReport`
- The behavior is well-defined in the plan

Let me write the test assuming the service uses the repository methods as described in the plan. I'll use `as unknown as` for the repository mock injection.

Let me also think about what `findProjectionByWindow` returns. The plan says it returns `OperationRow[]`. And `OperationRow` has:
```
order_id, company_id, status, amount, currency, worker_name, worker_role, last_event_type, created_at
```

Wait, the plan's `OperationRow` interface doesn't include `updated_at`. But the drift-repair logic needs to compare `source.updated_at > projection.updated_at`. So either:
- The projection table has `updated_at` (which it does per the DDL)
- But the `OperationRow` type in the plan doesn't include it

This is a discrepancy. I'll add an ASSUMPTION line about this.

Actually, looking again at the plan's operations table DDL:
```
updated_at | timestamptz, NOT NULL | projection row timestamp
```

And the `OperationRow` type:
```ts
export interface OperationRow {
  order_id: string;
  company_id: string;
  status: OrderStatus;
  amount: string;
  currency: string;
  worker_name: string;
  worker_role: string;
  last_event_type: string | null;
  created_at: Date;
}
```

No `updated_at` in the type. But the drift-repair logic needs it. So either:
- The `findProjectionByWindow` method returns a different type that includes `updated_at`
- Or the `OperationRow` type should have it but the plan forgot

I'll add an ASSUMPTION line and include `updated_at` in my mock rows.

Let me finalize my test file. I'll keep it focused on the three test scenarios from the plan, use proper type assertions, and add ASSUMPTION lines where needed.

One more thing - for the `service` instantiation, since I can't see the actual constructor signature (the module doesn't compile), I'll just do:
```typescript
service = new DriftRepairService(mockRepo as unknown as Parameters<typeof DriftRepairService.prototype.run> extends ... );
```

Actually that's getting too complex. Let me just do:
```typescript
service = new DriftRepairService(mockRepo as unknown as never);
```

No wait, that's not great either. Let me think...

The plan says:
```ts
export class DriftRepairService {
  constructor(repo: OperationsRepository) {}
  run(): Promise<DriftRepairReport>;
}
```

So the constructor takes an `OperationsRepository`. I can import that type (even if it doesn't compile) and use it for the cast. But since `OperationsRepository` also can't be resolved...

I think the cleanest approach is:
```typescript
service = new DriftRepairService(mockRepo as unknown as object);
```

Or even simpler, since TypeScript will complain about the type mismatch regardless:
```typescript
// @ts-expect-error: OperationsRepository is not resolvable in current workspace state
service = new DriftRepairService(mockRepo);
```

Hmm, but `@ts-expect-error` would suppress the error. Let me just use `as unknown as never` or similar.

Actually, the cleanest is probably to define a minimal interface for what I need:

```typescript
type AnyRepository = {
  [key: string]: (...args: any[]) => Promise<any>;
};
```

And then:
```typescript
service = new DriftRepairService(mockRepo as unknown as AnyRepository);
```

Wait, that won't work because the constructor expects `OperationsRepository`, not `AnyRepository`.

I think the most pragmatic approach given the constraints is:

```typescript
// ASSUMPTION: OperationsRepository type is not resolvable in the current workspace; using structural mock.
const service = new (DriftRepairService as new (repo: object) => DriftRepairService)(mockRepo);
```

Or simply:
```typescript
const service = new DriftRepairService(mockRepo as unknown as never);
```

The `as unknown as never` will work because `never` is assignable to everything.

Let me write the final version now.
```

## reply

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
// ASSUMPTION: The module '../src/drift-repair/drift-repair.service' cannot be resolved because its transitive imports (../operations/operations.types, ../operations/operations.repository) are missing or broken in the current workspace. The import is kept per plan; the error is expected to clear once those files compile.
import { DriftRepairService } from '../src/drift-repair/drift-repair.service';

// ASSUMPTION: The plan's DriftRepairService control flow requires fetching a source order by its primary key and recomputing company totals via SUM/COUNT, but the plan's repository interface does not explicitly list methods named `findOrderByOrderId` or `recomputeCompanyTotal`. These are assumed to exist on the repository for the drift-repair use case.

// ASSUMPTION: The plan's OperationRow type does not include `updated_at`, but the drift-repair logic requires comparing source.updated_at against projection.updated_at. The projection table DDL includes `updated_at`, so it is assumed the repository returns it (either OperationRow should include it, or findProjectionByWindow returns a wider shape).

interface MockProjectionRow {
  order_id: string;
  company_id: string;
  status: string;
  amount: string;
  currency: string;
  worker_name: string;
  worker_role: string;
  last_event_type: string | null;
  created_at: Date;
  updated_at: Date;
}

function makeProjectionRow(overrides: Partial<MockProjectionRow> = {}): MockProjectionRow {
  return {
    order_id: 'order-1',
    company_id: 'company-1',
    status: 'approved',
    amount: '100.00',
    currency: 'USD',
    worker_name: 'Alice',
    worker_role: 'driver',
    last_event_type: null,
    created_at: new Date('2024-01-15T10:00:00Z'),
    updated_at: new Date('2024-01-15T10:00:00Z'),
    ...overrides,
  };
}

function makeSourceOrder(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'order-1',
    company_id: 'company-1',
    worker_id: 'worker-1',
    status: 'approved',
    amount: '100.00',
    currency: 'USD',
    created_at: new Date('2024-01-15T10:00:00Z'),
    updated_at: new Date('2024-01-15T10:00:00Z'),
    ...overrides,
  };
}

describe('DriftRepairService', () => {
  let mockRepo: Record<string, ReturnType<typeof vi.fn>>;
  let service: DriftRepairService;

  beforeEach(() => {
    mockRepo = {
      findProjectionByWindow: vi.fn().mockResolvedValue([]),
      // ASSUMPTION: method name inferred from plan control flow step 3
      findOrderByOrderId: vi.fn().mockResolvedValue(null),
      findWorkerById: vi.fn().mockResolvedValue(null),
      findLastEventForOrder: vi.fn().mockResolvedValue(null),
      upsertOperation: vi.fn().mockResolvedValue(undefined),
      // ASSUMPTION: method name inferred from plan control flow step 4 (recompute via SUM/COUNT)
      recomputeCompanyTotal: vi.fn().mockResolvedValue(undefined),
    };

    // ASSUMPTION: DriftRepairService constructor expects OperationsRepository which is not resolvable; casting through unknown.
    service = new DriftRepairService(mockRepo as unknown as never);
  });

  it('detects and repairs a stale projection row', async () => {
    const now = new Date('2024-01-15T12:00:00Z');
    const dateSpy = vi.spyOn(global, 'Date').mockImplementation(
      (...args) => (args.length === 0 ? now : new Date(...args)),
    );

    const staleRow = makeProjectionRow({
      order_id: 'order-stale',
      updated_at: new Date('2024-01-15T11:30:00Z'),
    });

    const sourceOrder = makeSourceOrder({
      id: 'order-stale',
      updated_at: new Date('2024-01-15T11:35:00Z'), // newer than projection → stale
    });

    mockRepo.findProjectionByWindow.mockResolvedValue([staleRow] as unknown as Awaited<ReturnType<typeof mockRepo.findProjectionByWindow>>);
    mockRepo.findOrderByOrderId.mockResolvedValue(sourceOrder);
    mockRepo.findWorkerById.mockResolvedValue({ id: 'worker-1', name: 'Alice', role: 'driver' });
    mockRepo.findLastEventForOrder.mockResolvedValue('status_changed');

    const report = await service.run();

    expect(report.rows_checked).toBe(1);
    expect(report.rows_repaired).toBe(1);
    expect(mockRepo.upsertOperation).toHaveBeenCalledTimes(1);
    expect(mockRepo.recomputeCompanyTotal).toHaveBeenCalledWith('company-1');

    dateSpy.mockRestore();
  });

  it('skips rows where source is not newer than projection (concurrent write guard)', async () => {
    const now = new Date('2024-01-15T12:00:00Z');
    const dateSpy = vi.spyOn(global, 'Date').mockImplementation(
      (...args) => (args.length === 0 ? now : new Date(...args)),
    );

    const freshRow = makeProjectionRow({
      order_id: 'order-fresh',
      updated_at: new Date('2024-01-15T11:45:00Z'),
    });

    const sourceOrder = makeSourceOrder({
      id: 'order-fresh',
      updated_at: new Date('2024-01-15T11:30:00Z'), // older than projection → NOT stale
    });

    mockRepo.findProjectionByWindow.mockResolvedValue([freshRow] as unknown as Awaited<ReturnType<typeof mockRepo.findProjectionByWindow>>);
    mockRepo.findOrderByOrderId.mockResolvedValue(sourceOrder);

    const report = await service.run();

    expect(report.rows_checked).toBe(1);
    expect(report.rows_repaired).toBe(0);
    expect(mockRepo.upsertOperation).not.toHaveBeenCalled();
    expect(mockRepo.recomputeCompanyTotal).not.toHaveBeenCalled();

    dateSpy.mockRestore();
  });

  it('recomputes company totals after repair', async () => {
    const now = new Date('2024-01-15T12:00:00Z');
    const dateSpy = vi.spyOn(global, 'Date').mockImplementation(
      (...args) => (args.length === 0 ? now : new Date(...args)),
    );

    const staleRow1 = makeProjectionRow({
      order_id: 'order-a',
      company_id: 'company-x',
      updated_at: new Date('2024-01-15T11:00:00Z'),
    });
    const staleRow2 = makeProjectionRow({
      order_id: 'order-b',
      company_id: 'company-x',
      updated_at: new Date('2024-01-15T11:05:00Z'),
    });

    const sourceOrderA = makeSourceOrder({ id: 'order-a', company_id: 'company-x', updated_at: new Date('2024-01-15T11:10:00Z') });
    const sourceOrderB = makeSourceOrder({ id: 'order-b', company_id: 'company-x', updated_at: new Date('2024-01-15T11:15:00Z') });

    mockRepo.findProjectionByWindow.mockResolvedValue(
      [staleRow1, staleRow2] as unknown as Awaited<ReturnType<typeof mockRepo.findProjectionByWindow>>,
    );
    mockRepo.findOrderByOrderId
      .mockResolvedValueOnce(sourceOrderA)
      .mockResolvedValueOnce(sourceOrderB);
    mockRepo.findWorkerById.mockResolvedValue({ id: 'worker-1', name: 'Bob', role: 'driver' });
    mockRepo.findLastEventForOrder.mockResolvedValue(null);

    const report = await service.run();

    expect(report.rows_repaired).toBe(2);
    expect(mockRepo.recomputeCompanyTotal).toHaveBeenCalledWith('company-x');

    dateSpy.mockRestore();
  });
});
```
