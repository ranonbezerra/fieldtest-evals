# plan-retry

## reasoning

```
Let me analyze the task carefully:

- Build a read-model projection for a marketplace operations dashboard
- Join of payment orders, events, and workers
- Filtered by company, status, date range, sorted by recency, paginated
- ~3M orders, current query takes 20-30s, target p95 < 50ms
- Read-your-own-writes: operators see their own writes immediately
- Financial totals per company must be exact (not approximate)
- Need: projection table(s), DDL with indexes, maintenance hooks (sync), re-derivation routine, drift-repair job, new dashboard query, tests
- Tests: read-your-own-writes, concurrent updates to one company's totals, drift repair
- DESIGN.md justifying sync-hooks vs alternatives

Let me think about the design:

**Projection table**: An `operation` table that denormalizes payment orders + events + workers. Since we need exact financial totals per company, we also need a `company_financial_totals` table (or similar) that aggregates.

**Maintenance hooks**: After a write to an order/event/worker, synchronously update the projection. This gives read-your-own-writes for free.

**Re-derivation**: Given a date window, rebuild the projection from source tables.

**Drift repair**: Scheduled job that compares projection vs source and fixes discrepancies.

Let me think about the data model:

Source tables (existing, we're not creating them but referencing them):
- `payment_orders` — id, company_id, worker_id, event_id, status, amount_cents, created_at, updated_at
- `events` — id, title, location, created_at
- `workers` — id, name, company_id, created_at

Projection tables (we create these):
- `operation_read_models` — denormalized join
- `company_financial_totals` — exact running totals per company

Now let me think about the NestJS structure:

```
src/operations/
  operations.module.ts
  operations.controller.ts
  operations.service.ts
  operations.repository.ts
  operations.projection.ts (the projection maintenance)
  operations.drift-repair.ts
src/projections/
  projections.module.ts
  projections.service.ts
  projections.repository.ts
```

Wait, let me reconsider. The task says "maintenance hooks invoked by the write services (simulate the write path)". So we need to simulate write services that trigger the projection update.

Let me think about what files I'll create:

1. `prisma/schema.prisma` — schema with source tables + projection tables
2. `src/operations/operations.module.ts`
3. `src/operations/operations.controller.ts` — dashboard query endpoint
4. `src/operations/operations.service.ts` — business logic for querying
5. `src/operations/operations.repository.ts` — reads from projection table
6. `src/projections/projections.module.ts`
7. `src/projections/projections.service.ts` — sync hooks, re-derivation, drift repair
8. `src/projections/projections.repository.ts` — writes to projection tables, reads from source tables
9. `src/writes/writes.module.ts` — simulated write services
10. `src/writes/writes.service.ts` — simulates order approval etc., calls projections
11. `src/drift-repair/drift-repair.module.ts`
12. `src/drift-repair/drift-repair.processor.ts` — scheduled job
13. `test/operations.spec.ts`
14. `DESIGN.md`

Wait, I should be more careful about the layout conventions. The convention says:
```
src/<feature>/<feature>.module.ts
src/<feature>/<feature>.controller.ts
src/<feature>/<feature>.service.ts
src/<feature>/<feature>.repository.ts
```

So features should follow this pattern. Let me think about what the features are:
- `operations` — the dashboard query (read path)
- `projections` — the projection maintenance (write hooks, re-derivation, drift repair)
- `writes` — simulated write services that trigger projections

Actually, let me reconsider. The drift repair is a processor. The convention doesn't mention processors explicitly but says "A service, repository or processor is listed in its module's providers."

Let me also think about the `@nestjs/schedule` for the scheduled job. I'll use `@Cron` decorator.

Now for the financial totals: "financial totals per company must be exact, not approximate." This means I need a table that maintains running sums. When an order is created/updated/deleted, we increment/decrement the totals. This must be done atomically (in the same transaction as the projection update).

Let me now write the PLAN.md. I need to be concise but complete.

For the data model:

Source tables (already exist, we define them in schema for completeness):
- `PaymentOrder`: id (uuid), companyId (uuid), workerId (uuid), eventId (uuid), status (enum: pending/approved/rejected), amountCents (int), createdAt, updatedAt
- `Event`: id (uuid), title (string), location (string), createdAt
- `Worker`: id (uuid), name (string), companyId (uuid), createdAt

Projection tables:
- `OperationReadModel`: id (uuid, PK — same as order id), companyId, workerId, workerName, eventId, eventTitle, eventLocation, status, amountCents, createdAt (order's created_at), updatedAt
- `CompanyFinancialTotals`: companyId (PK), approvedTotalCents (bigint), rejectedTotalCents (bigint), pendingCount (int)

Indexes:
- `OperationReadModel`: composite index on (companyId, status, createdAt DESC) for the main query pattern
- `CompanyFinancialTotals`: PK on companyId

For the dashboard query: filter by companyId, status (optional), date range, sort by createdAt DESC, paginate.

Now let me think about types and signatures more carefully.

For the controller endpoint: `GET /operations?companyId=...&status=...&from=...&to=...&page=...&pageSize=...`

Returns: `{ items: OperationReadModel[], total: number, page: number, pageSize: number }`

For the projections service:
- `applyOrderCreated(order: PaymentOrder)` — creates projection row + updates totals
- `applyOrderStatusChanged(orderId: string, newStatus: OrderStatus)` — updates projection row + adjusts totals
- `rederive(dateFrom: Date, dateTo: Date)` — rebuilds projection for the window
- `repairDrift(dateFrom: Date, dateTo: Date)` — compares and fixes

For the writes service (simulated):
- `approveOrder(orderId: string)` — changes status to approved, calls projections
- `rejectOrder(orderId: string)` — changes status to rejected, calls projections
- `createOrder(input: CreateOrderInput)` — creates order, calls projections

Let me now write the plan. I'll be terse.

Actually, wait — I need to think about what "simulated write path" means. The task says "maintenance hooks invoked by the write services (simulate the write path)". I think this means we create a service that simulates what the real write services would do (approve an order, create an order), and these services call the projection maintenance.

For the drift repair: it should be a scheduled job (using @Cron) that periodically checks for discrepancies. But we also need it to be callable manually for testing.

Let me finalize the file list:

```
prisma/schema.prisma
src/app.module.ts
src/operations/operations.module.ts
src/operations/operations.controller.ts
src/operations/operations.service.ts
src/operations/operations.repository.ts
src/projections/projections.module.ts
src/projections/projections.service.ts
src/projections/projections.repository.ts
src/writes/writes.module.ts
src/writes/writes.service.ts
src/drift-repair/drift-repair.module.ts
src/drift-repair/drift-repair.processor.ts
test/operations.spec.ts
DESIGN.md
```

Hmm, but `src/app.module.ts` is already in the convention layout. I should include it since it wires everything together.

Actually wait — the manifest says "List only files you will write." If `src/main.ts` and `src/app.module.ts` already exist, I shouldn't list them. But the task is to build this from scratch (it's a new feature being added). Let me assume we're adding to an existing app, so `src/main.ts` and `src/app.module.ts` already exist. I'll list `src/app.module.ts` only if I need to modify it to import the new modules.

Actually, re-reading the conventions: "Do exactly what the task asks. Do not create a file it does not call for, and do not improve code you were not asked to change." So I should only list files that are new or that I need to modify. Since this is a feature being added, I'll assume `app.module.ts` needs to import the new modules.

Let me reconsider the structure. The task says "maintenance hooks invoked by the write services (simulate the write path)". I think the cleanest approach is:

- `projections` feature: contains the projection maintenance logic (sync hooks, re-derivation)
- `operations` feature: the dashboard read path
- `writes` feature: simulated write services that call projection hooks
- `drift-repair`: the scheduled job

But actually, maybe I can fold drift-repair into projections since it's closely related. Let me think...

The convention says features follow `src/<feature>/<feature>.*.ts`. A processor is just another provider in a module. I could have:

```
src/projections/projections.module.ts
src/projections/projections.service.ts
src/projections/projections.repository.ts
src/projections/drift-repair.processor.ts
```

Wait, but the convention says `<feature>.<role>.ts` where role is module/controller/service/repository. A processor doesn't fit neatly. Let me just call it a service that has a @Cron method, or make it a separate small module.

Actually, I'll make it part of the projections module as a separate provider. The file can be `src/projections/drift-repair.processor.ts`. The convention says "TS file: kebab-case.role.ts" — so `drift-repair.processor.ts` fits (kebab-case name + .role).

Wait, re-reading: "TS file: `kebab-case.role.ts`". So it's like `operations.controller.ts`, `projections.service.ts`. A processor would be `drift-repair.processor.ts`? That's two words before the dot. Hmm, maybe I should just call it `projections.drift-repair.ts` or put it in its own module.

Actually, I think the cleanest is to have a separate `drift-repair` feature:
```
src/drift-repair/drift-repair.module.ts
src/drift-repair/drift-repair.processor.ts
```

The processor imports and uses the projections service. This follows the convention most cleanly.

Let me finalize and write the plan now. I need to be concise given the output limit.

One more thought on the financial totals: "exact, not approximate" means we can't use a counter that might drift. But with sync hooks in the same transaction, they'll be exact as long as the write succeeds. The drift-repair job is a safety net. The re-derivation can also rebuild totals from scratch.

For the `CompanyFinancialTotals`, I'll track:
- `approved_total_cents` (bigint) — sum of amounts for approved orders
- `rejected_total_cents` (bigint) — sum of amounts for rejected orders  
- `pending_count` (int) — count of pending orders

When an order transitions:
- created (pending): pending_count += 1
- approved: pending_count -= 1, approved_total_cents += amount
- rejected: pending_count -= 1, rejected_total_cents += amount

This is exact because it's in the same transaction.

Now let me write the plan.
```

## reply

## 1. Assumptions

| Open question | Choice | Why |
|---|---|---|
| Source tables already exist in the DB? | Yes; we define them in `schema.prisma` for Prisma but do not migrate them here. | The task is about the projection, not the source domain. |
| How is "status" modelled? | Enum: `pending`, `approved`, `rejected`. | Standard order lifecycle; three states cover the task. |
| Currency unit? | Integer cents. | Avoids float drift; exact arithmetic. |
| Pagination style? | Offset-based (`page`, `pageSize`). | Simple, matches "paginated" without extra infra. |
| Drift-repair schedule? | Every 5 minutes via `@nestjs/schedule`. | Reasonable default; the routine is also callable manually. |
| Where do simulated write services live? | `src/writes/` feature. | Keeps the "simulate the write path" concern isolated from projections. |
| `app.module.ts` already exists? | Yes; we only list it in the manifest because we must add imports. | Standard Nest bootstrap already present. |

## 2. Data model

### Source tables (pre-existing, defined in schema for Prisma)

**`payment_orders`** (`@@map("payment_orders")`)
| Column | Type | Notes |
|---|---|---|
| `id` | `String @id @default(uuid())` | PK |
| `company_id` | `String @map("company_id")` | FK → companies (implicit) |
| `worker_id` | `String @map("worker_id")` | FK → workers |
| `event_id` | `String @map("event_id")` | FK → events |
| `status` | `OrderStatus @default(pending)` | enum: `pending`, `approved`, `rejected` |
| `amount_cents` | `Int @map("amount_cents")` | |
| `created_at` | `DateTime @default(now())` | |
| `updated_at` | `DateTime @updatedAt @map("updated_at")` | |

**`events`** (`@@map("events")`)
| Column | Type |
|---|---|
| `id` | `String @id @default(uuid())` |
| `title` | `String` |
| `location` | `String` |
| `created_at` | `DateTime @default(now())` |

**`workers`** (`@@map("workers")`)
| Column | Type |
|---|---|
| `id` | `String @id @default(uuid())` |
| `name` | `String` |
| `company_id` | `String @map("company_id")` |
| `created_at` | `DateTime @default(now())` |

### Projection tables (new)

**`operation_read_models`** (`@@map("operation_read_models")`)
| Column | Type | Notes |
|---|---|---|
| `id` | `String @id` | Same UUID as source order — upsert key |
| `company_id` | `String @map("company_id")` | |
| `worker_id` | `String @map("worker_id")` | |
| `worker_name` | `String @map("worker_name")` | Denormalised from workers |
| `event_id` | `String @map("event_id")` | |
| `event_title` | `String @map("event_title")` | Denormalised from events |
| `event_location` | `String @map("event_location")` | Denormalised from events |
| `status` | `OrderStatus` | Mirrors source |
| `amount_cents` | `Int @map("amount_cents")` | Mirrors source |
| `created_at` | `DateTime @map("created_at")` | Order's original `created_at` — sort key |
| `updated_at` | `DateTime @updatedAt @map("updated_at")` | When projection last touched |

**Indexes:**
- `@@index([company_id, status, created_at(sort: Desc)])` — main dashboard query pattern.
- `@@index([company_id, created_at(sort: Desc)])` — company + date-range without status filter.

**`company_financial_totals`** (`@@map("company_financial_totals")`)
| Column | Type | Notes |
|---|---|---|
| `company_id` | `String @id @map("company_id")` | PK — one row per company |
| `approved_total_cents` | `BigInt @default(0) @map("approved_total_cents")` | Sum of approved amounts |
| `rejected_total_cents` | `BigInt @default(0) @map("rejected_total_cents")` | Sum of rejected amounts |
| `pending_count` | `Int @default(0) @map("pending_count")` | Count of pending orders |

No additional indexes needed (PK lookup only).

### Enum

```prisma
enum OrderStatus {
  pending
  approved
  rejected
}
```

## 3. Types and signatures

### Shared types (`src/projections/projections.types.ts`)

```ts
export type OrderStatus = 'pending' | 'approved' | 'rejected';

export interface CreateOrderInput {
  companyId: string;
  workerId: string;
  eventId: string;
  amountCents: number;
}

export interface OperationRow {
  id: string;
  companyId: string;
  workerId: string;
  workerName: string;
  eventId: string;
  eventTitle: string;
  eventLocation: string;
  status: OrderStatus;
  amountCents: number;
  createdAt: Date;
}

export interface OperationQueryParams {
  companyId: string;
  status?: OrderStatus;
  from?: Date;
  to?: Date;
  page: number;        // 1-based
  pageSize: number;    // default 20, max 100
}

export interface OperationPage {
  items: OperationRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CompanyTotals {
  companyId: string;
  approvedTotalCents: bigint;
  rejectedTotalCents: bigint;
  pendingCount: number;
}

export interface DriftReport {
  windowStart: Date;
  windowEnd: Date;
  rowsCorrected: number;
  totalsCorrected: boolean;
}
```

### Errors

All errors use the standard envelope `{ error: { code, message, details } }`.

| Code | Raised by | When |
|---|---|---|
| `order_not_found` | `WritesService.approveOrder`, `rejectOrder` | Order ID does not exist in source table |
| `invalid_transition` | `WritesService.approveOrder`, `rejectOrder` | Order is already in the target status |
| `invalid_query_params` | `OperationsService.query` | `pageSize > 100` or `page < 1` |
| `company_not_found` | `ProjectionsService.getTotals` | No totals row for the company (should not happen if hooks are correct) |

### `OperationsController` (`src/operations/operations.controller.ts`)

```ts
class OperationsController {
  @Get('operations')
  query(
    @Query('companyId') companyId: string,
    @Query('status') status?: OrderStatus,
    @Query('from') from?: string,       // ISO 8601
    @Query('to') to?: string,           // ISO 8601
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<OperationPage>;
}
```

### `OperationsService` (`src/operations/operations.service.ts`)

```ts
class OperationsService {
  constructor(repo: OperationsRepository);
  query(params: OperationQueryParams): Promise<OperationPage>;
}
```

### `OperationsRepository` (`src/operations/operations.repository.ts`)

```ts
class OperationsRepository {
  constructor(prisma: PrismaClient);
  findPage(params: OperationQueryParams): Promise<OperationPage>;
}
```

### `ProjectionsService` (`src/projections/projections.service.ts`)

```ts
class ProjectionsService {
  constructor(repo: ProjectionsRepository);

  /** Called by write services inside the same transaction as the source write. */
  applyOrderCreated(input: CreateOrderInput, order: { id: string; createdAt: Date }): Promise<void>;
  applyOrderStatusChanged(orderId: string, newStatus: OrderStatus): Promise<void>;

  /** Rebuilds projection rows + totals for orders whose `created_at` falls in [from, to). */
  rederive(from: Date, to: Date): Promise<DriftReport>;

  /** Compares projection vs source for the window; fixes discrepancies. */
  repairDrift(from: Date, to: Date): Promise<DriftReport>;

  getTotals(companyId: string): Promise<CompanyTotals>;
}
```

### `ProjectionsRepository` (`src/projections/projections.repository.ts`)

```ts
class ProjectionsRepository {
  constructor(prisma: PrismaClient);

  upsertOrder(order: OperationRow): Promise<void>;
  updateOrderStatus(orderId: string, status: OrderStatus): Promise<void>;

  adjustTotals(companyId: string, delta: { approvedCents?: bigint; rejectedCents?: bigint; pendingDelta?: number }): Promise<void>;
  resetTotals(companyId: string, totals: CompanyTotals): Promise<void>;

  /** Reads source tables; returns joined rows for the given window. */
  fetchSourceWindow(from: Date, to: Date): Promise<OperationRow[]>;

  /** Reads projection rows for the given window (by `createdAt`). */
  fetchProjectionWindow(from: Date, to: Date): Promise<OperationRow[]>;

  deleteProjectionWindow(from: Date, to: Date): Promise<number>;
  bulkUpsert(rows: OperationRow[]): Promise<void>;

  getTotals(companyId: string): Promise<CompanyTotals | null>;
}
```

### `WritesService` (`src/writes/writes.service.ts`)

```ts
class WritesService {
  constructor(prisma: PrismaClient, projections: ProjectionsService);

  createOrder(input: CreateOrderInput): Promise<{ id: string; status: OrderStatus }>;
  approveOrder(orderId: string): Promise<{ id: string; status: OrderStatus }>;
  rejectOrder(orderId: string): Promise<{ id: string; status: OrderStatus }>;
}
```

### `DriftRepairProcessor` (`src/drift-repair/drift-repair.processor.ts`)

```ts
class DriftRepairProcessor {
  constructor(projections: ProjectionsService);

  @Cron(CronExpression.EVERY_5_MINUTES)
  run(): Promise<void>;

  /** Manual trigger; window defaults to last 1 hour. */
  runForWindow(from: Date, to: Date): Promise<DriftReport>;
}
```

### Ordering rules

- `applyOrderStatusChanged` must execute **after** the source write commits (same transaction). The projection row is updated, then totals are adjusted — both in one `prisma.$transaction`.
- In `rederive`: delete old projection rows for the window → bulk-insert new rows → recompute totals for affected companies. All in one transaction.
- In `repairDrift`: read both sides → compute diff → apply corrections (upserts + total resets). One transaction.
- `WritesService.approveOrder` / `rejectOrder`: read source order → validate transition → update source → call `projections.applyOrderStatusChanged`. Entire sequence in one `$transaction`.

## 4. Control flow

### Write path (create order)

1. `WritesService.createOrder` opens a Prisma transaction.
2. Insert row into `payment_orders` (status = `pending`).
3. Read the joined source row (order + worker + event) — all inside the transaction.
4. Call `ProjectionsService.applyOrderCreated` which:
   - Upserts the row into `operation_read_models`.
   - Calls `adjustTotals(companyId, { pendingDelta: +1 })` via upsert on `company_financial_totals`.
5. Commit transaction.

**Must not be in the transaction:** any HTTP response formatting, logging to external systems.

### Write path (status change)

1. `WritesService.approveOrder` opens a transaction.
2. Read the order from `payment_orders`. If not found → throw `order_not_found`. If already `approved` → throw `invalid_transition`.
3. Update `payment_orders.status = 'approved'`.
4. Call `ProjectionsService.applyOrderStatusChanged(orderId, 'approved')` which:
   - Updates `operation_read_models.status`.
   - Calls `adjustTotals(companyId, { pendingDelta: -1, approvedCents: +amount })`.
5. Commit.

### Dashboard read path

1. Controller parses and validates query params.
2. `OperationsService.query` → `OperationsRepository.findPage`.
3. Single `SELECT` on `operation_read_models` with `WHERE company_id = ? AND (status = ?) AND created_at BETWEEN ? AND ? ORDER BY created_at DESC LIMIT ? OFFSET ?` plus a `COUNT(*)` for total.
4. Return page.

No source-table access on the read path.

### Re-derivation

1. `ProjectionsService.rederive(from, to)` opens a transaction.
2. `DELETE FROM operation_read_models WHERE created_at >= $1 AND created_at < $2`.
3. `fetchSourceWindow(from, to)` — reads from `payment_orders` JOIN `workers` JOIN `events`.
4. `bulkUpsert(rows)`.
5. For each affected company: recompute totals from the newly inserted rows; `resetTotals`.
6. Commit. Return `DriftReport` with count of rows.

### Drift repair

1. Processor (cron or manual) calls `projections.repairDrift(from, to)`.
2. Open transaction.
3. Fetch source window and projection window for `[from, to)`.
4. Compute diff: rows in source but missing/stale in projection → upsert; rows in projection but not in source → delete.
5. Recompute totals for all affected companies from corrected projection rows; `resetTotals` if changed.
6. Commit. Return `DriftReport`.

## 5. Tests

| Test | What it proves |
|---|---|
| Read-your-own-writes: create order, immediately query dashboard for that company, assert the new row appears with correct fields | Synchronous projection write makes new data visible on the next read without any delay or cache invalidation |
| Read-your-own-writes: approve an order, query dashboard filtered by `status=approved`, assert it appears | Status transitions propagate to the projection immediately |
| Concurrent updates: fire N concurrent `approveOrder` calls on different orders for the same company, then read `company_financial_totals`, assert `approved_total_cents` equals sum of all amounts and `pending_count` is correct | Totals remain exact under concurrent writes (no lost updates) |
| Concurrent updates: fire concurrent `createOrder` + `approveOrder` interleaved for one company, verify final totals match the sum of final order statuses | Mixed create/modify concurrency preserves invariant |
| Drift repair: manually corrupt a projection row (change status, change amount), run `repairDrift` for that window, assert projection matches source and totals are corrected | The drift-repair routine detects and fixes discrepancies between projection and source |
| Drift repair: delete a projection row, run `repairDrift`, assert the row is restored and totals reflect it | Missing rows are reinserted by drift repair |
| Re-derivation: create orders, corrupt projection, run `rederive` for the window, assert projection is rebuilt from source | Re-derivation produces a correct snapshot regardless of prior corruption |
| Dashboard pagination: insert 25 rows, query page 1 size 10, assert 10 items + correct total; page 3, assert 5 items | Pagination arithmetic and `total` are correct |
| Dashboard filter by date range: insert orders with known timestamps, query with `from`/`to`, assert only in-range rows returned | Date filtering works on the projection's `created_at` |

## 6. Manifest

```
<!-- manifest
prisma/schema.prisma | reads: - | Full Prisma schema: source tables, projection tables, enum, indexes
src/projections/projections.types.ts | reads: - | Shared types and interfaces for the projection feature
src/projections/projections.repository.ts | reads: src/projections/projections.types.ts | All Prisma access for projection tables and source-table reads used by re-derivation
src/projections/projections.service.ts | reads: src/projections/projections.repository.ts, src/projections/projections.types.ts | Sync-hook logic, re-derivation, drift repair, totals queries
src/projections/projections.module.ts | reads: src/projections/projections.service.ts, src/projections/projections.repository.ts | Module wiring; exports ProjectionsService
src/operations/operations.repository.ts | reads: src/projections/projections.types.ts | Read-path Prisma query on operation_read_models
src/operations/operations.service.ts | reads: src/operations/operations.repository.ts, src/projections/projections.types.ts | Validates params, delegates to repository
src/operations/operations.controller.ts | reads: src/operations/operations.service.ts, src/projections/projections.types.ts | GET /operations endpoint
src/operations/operations.module.ts | reads: src/operations/operations.controller.ts, src/operations/operations.service.ts, src/operations/operations.repository.ts | Module wiring
src/writes/writes.service.ts | reads: src/projections/projections.service.ts, src/projections/projections.types.ts | Simulated write path: createOrder, approveOrder, rejectOrder
src/writes/writes.module.ts | reads: src/writes/writes.service.ts | Module wiring; imports ProjectionsModule
src/drift-repair/drift-repair.processor.ts | reads: src/projections/projections.service.ts, src/projections/projections.types.ts | Cron processor calling repairDrift
src/drift-repair/drift-repair.module.ts | reads: src/drift-repair/drift-repair.processor.ts | Module wiring; imports ProjectionsModule
src/app.module.ts | reads: src/operations/operations.module.ts, src/projections/projections.module.ts, src/writes/writes.module.ts, src/drift-repair/drift-repair.module.ts | Root module importing all feature modules
test/operations.spec.ts | reads: src/operations/operations.service.ts, src/operations/operations.repository.ts, src/projections/projections.service.ts, src/projections/projections.repository.ts, src/writes/writes.service.ts, src/drift-repair/drift-repair.processor.ts, src/projections/projections.types.ts | Integration tests: read-your-own-writes, concurrency, drift repair, re-derivation, pagination
DESIGN.md | reads: - | Justification of sync-hooks over CDC/event-sourcing/materialised-view alternatives
-->
```
