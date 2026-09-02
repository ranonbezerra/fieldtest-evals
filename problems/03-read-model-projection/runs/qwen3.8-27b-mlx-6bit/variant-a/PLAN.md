## 1. Assumptions

- Source tables (`payment_orders`, `events`, `workers`) are simulated: we own their DDL and a thin "write-simulation" endpoint that inserts/updates rows and calls the maintenance hook in one transaction.
- "Status" is a fixed enum on `payment_orders` with values `pending`, `approved`, `rejected`, `settled`.
- "Sort by recency" means descending on the order's `created_at`; ties broken by `id DESC`.
- Pagination is offset-based (page 1-based, page_size capped at 100).
- "Financial totals per company" means sum of `amount` and count of orders, grouped by `company_id`, where the order's status is any (all statuses included). Stored in a dedicated aggregate table updated in the same transaction as the projection write.
- Drift-repair runs on a fixed schedule (every 5 minutes) and compares a sliding window of the last 1 hour of `updated_at` on `payment_orders`.
- Re-derivation is idempotent and safe to overlap with live writes (it upserts).
- The write-simulation endpoint lives in the `operations` module (same feature) to keep the hook co-located with the projection it maintains.
- All monetary amounts use `numeric(14,2)` / Prisma `Decimal`.
- The dashboard endpoint is `GET /operations` with query-string filters; the write-simulation is `POST /operations/simulate-write`.
- Re-derivation is exposed as `POST /operations/re-derive` (admin). Drift-repair has no endpoint; it runs via a NestJS `@Cron` scheduler in its own module.
- The `DESIGN.md` file lives at the repository root.

## 2. Data model

**payment_orders** (source, simulated)

| Column | Type | Notes |
|--------|------|-------|
| id | uuid, PK | |
| company_id | uuid, NOT NULL | FK → companies (not modelled here; opaque) |
| worker_id | uuid, NOT NULL | FK → workers.id |
| status | text, NOT NULL | enum: pending / approved / rejected / settled |
| amount | numeric(14,2), NOT NULL | |
| currency | char(3), NOT NULL | ISO-4217 |
| created_at | timestamptz, NOT NULL, default now() | |
| updated_at | timestamptz, NOT NULL, default now() | |

**events** (source, simulated)

| Column | Type | Notes |
|--------|------|-------|
| id | uuid, PK | |
| order_id | uuid, NOT NULL | FK → payment_orders.id |
| event_type | text, NOT NULL | e.g. "status_changed", "note_added" |
| payload | jsonb, NOT NULL, default '{}' | |
| created_at | timestamptz, NOT NULL, default now() | |

**workers** (source, simulated)

| Column | Type | Notes |
|--------|------|-------|
| id | uuid, PK | |
| company_id | uuid, NOT NULL | |
| name | text, NOT NULL | |
| role | text, NOT NULL | |

**operations** (projection)

| Column | Type | Notes |
|--------|------|-------|
| order_id | uuid, PK, FK → payment_orders.id | one row per order |
| company_id | uuid, NOT NULL | denormalised |
| status | text, NOT NULL | denormalised |
| amount | numeric(14,2), NOT NULL | denormalised |
| currency | char(3), NOT NULL | denormalised |
| worker_name | text, NOT NULL | denormalised |
| worker_role | text, NOT NULL | denormalised |
| last_event_type | text, NULL | most recent event type for this order |
| created_at | timestamptz, NOT NULL | from payment_orders.created_at (sort key) |
| updated_at | timestamptz, NOT NULL | projection row timestamp |

Indexes on `operations`:
- `(company_id, status, created_at DESC)` — dashboard with status filter
- `(company_id, created_at DESC)` — dashboard without status filter

**company_financial_totals** (exact aggregate)

| Column | Type | Notes |
|--------|------|-------|
| company_id | uuid, PK | |
| total_amount | numeric(14,2), NOT NULL, default 0 | sum of all order amounts |
| order_count | integer, NOT NULL, default 0 | |
| updated_at | timestamptz, NOT NULL, default now() | |

## 3. Types and signatures

```ts
// ─── src/operations/operations.types.ts ───

export type OrderStatus = "pending" | "approved" | "rejected" | "settled";

export interface OperationRow {
  order_id: string;
  company_id: string;
  status: OrderStatus;
  amount: string;          // Decimal as string for JSON safety
  currency: string;
  worker_name: string;
  worker_role: string;
  last_event_type: string | null;
  created_at: Date;
}

export interface DashboardQuery {
  company_id: string;
  status?: OrderStatus;
  date_from?: Date;
  date_to?: Date;
  page: number;            // 1-based
  page_size: number;       // 1..100
}

export interface DashboardResult {
  data: OperationRow[];
  total_count: number;
  page: number;
  page_size: number;
}

export interface CompanyTotals {
  company_id: string;
  total_amount: string;
  order_count: number;
}

export interface SimulateWriteInput {
  order_id: string;
  company_id: string;
  worker_id: string;
  status: OrderStatus;
  amount: string;
  currency: string;
}

export interface ReDeriveInput {
  date_from: Date;
  date_to: Date;
}

export interface DriftRepairReport {
  window_start: Date;
  window_end: Date;
  rows_checked: number;
  rows_repaired: number;
}

// ─── Errors ───

export class ResourceNotFoundError extends Error {
  code = "resource_not_found" as const;
  constructor(public readonly message: string, public readonly details: Record<string, unknown> = {}) { super(message); }
}

export class InvalidDateRangeError extends Error {
  code = "invalid_date_range" as const;
  constructor(public readonly message: string, public readonly details: Record<string, unknown> = {}) { super(message); }
}

export class ValidationError extends Error {
  code = "validation_error" as const;
  constructor(public readonly message: string, public readonly details: Record<string, unknown> = {}) { super(message); }
}

// ─── src/operations/operations.repository.ts ───

export class OperationsRepository {
  constructor(prisma: PrismaClient) {}

  // Projection maintenance (called inside a transaction)
  upsertOperation(tx: PrismaPromise, order: SimulateWriteInput, worker: { name: string; role: string }, lastEventType: string | null): Promise<void>;

  // Dashboard read
  queryDashboard(query: DashboardQuery): Promise<DashboardResult>;

  // Aggregate maintenance (called inside a transaction)
  upsertCompanyTotal(tx: PrismaPromise, companyId: string, deltaAmount: string, deltaCount: number): Promise<void>;

  // Source reads (for re-derivation and drift-repair)
  findOrdersByWindow(from: Date, to: Date): Promise<Record<string, unknown>[]>;
  findWorkerById(workerId: string): Promise<{ id: string; name: string; role: string } | null>;
  findLastEventForOrder(orderId: string): Promise<string | null>;

  // Drift-repair comparison
  findProjectionByWindow(from: Date, to: Date): Promise<OperationRow[]>;

  // Read-your-own-writes: single-order fetch from projection
  getOperationByOrderId(orderId: string): Promise<OperationRow | null>;

  // Totals read
  getCompanyTotal(companyId: string): Promise<CompanyTotals | null>;
}

// ─── src/operations/operations.service.ts ───

export class OperationsService {
  constructor(repo: OperationsRepository) {}

  getDashboard(query: DashboardQuery): Promise<DashboardResult>;
  // Raises: ResourceNotFoundError (company_id not in totals), InvalidDateRangeError, ValidationError

  simulateWrite(input: SimulateWriteInput): Promise<OperationRow>;
  // Raises: ResourceNotFoundError (worker not found)

  getCompanyTotals(companyId: string): Promise<CompanyTotals>;
  // Raises: ResourceNotFoundError
}

// ─── src/operations/operations.controller.ts ───

export class OperationsController {
  constructor(service: OperationsService) {}

  @Get("operations")
  getDashboard(query: DashboardQuery): Promise<DashboardResult>;

  @Post("operations/simulate-write")
  simulateWrite(@Body() input: SimulateWriteInput): Promise<OperationRow>;

  @Get("operations/totals/:companyId")
  getTotals(@Param("companyId") companyId: string): Promise<CompanyTotals>;
}

// ─── src/re-derivation/re-derivation.service.ts ───

export class ReDerivationService {
  constructor(repo: OperationsRepository) {}

  reDerive(input: ReDeriveInput): Promise<{ rows_rewritten: number }>;
  // Raises: InvalidDateRangeError

}

// ─── src/re-derivation/re-derivation.controller.ts ───

export class ReDerivationController {
  constructor(service: ReDerivationService) {}

  @Post("operations/re-derive")
  reDerive(@Body() input: ReDeriveInput): Promise<{ rows_rewritten: number }>;
}

// ─── src/drift-repair/drift-repair.service.ts ───

export class DriftRepairService {
  constructor(repo: OperationsRepository) {}

  run(): Promise<DriftRepairReport>;
  // No user-facing error; internal errors are logged and re-thrown.
}
```

**Ordering rules:**

- `simulateWrite` performs the source insert/update, the projection upsert, and the totals upsert **inside a single Prisma interactive transaction**. No read of the projection may observe a state where the source row exists but the projection row does not.
- `reDerive` processes orders in `created_at ASC` order and upserts projection rows. If a concurrent write occurs mid-derivation, the later of the two to commit wins (last-writer-wins on `updated_at`). Re-derivation must not delete rows outside its window.
- `DriftRepairService.run` compares and repairs in `created_at ASC` order; it must tolerate concurrent writes by skipping rows whose `payment_orders.updated_at` is newer than the projection row's `updated_at` (stale read guard).

## 4. Control flow

**simulateWrite (transaction T1):**

1. Begin interactive transaction.
2. Validate worker exists (SELECT). Raise `ResourceNotFoundError` if not.
3. Upsert the `payment_orders` row (insert or update by `order_id`).
4. Read the latest event for this order (SELECT … ORDER BY created_at DESC LIMIT 1) — may be null.
5. Upsert the `operations` projection row with denormalised fields from steps 3–4.
6. Compute the delta for `company_financial_totals`: if this is an insert, delta = (+amount, +1). If status changed from a non-settled to settled or vice-versa, adjust accordingly (for simplicity in v1: recompute the row's contribution as a delta of new − old). Upsert the totals row.
7. Commit transaction T1.
8. Return the projection row (SELECT inside T1, returned after commit).

The caller's next request to `getDashboard` reads the committed projection → read-your-own-writes holds.

**getDashboard (no transaction, single query):**

1. Validate input: `date_from < date_to` if both present; `page ≥ 1`; `1 ≤ page_size ≤ 100`. Raise errors on violation.
2. Build a single SELECT against `operations` with WHERE `company_id = ?` [AND `status = ?`] [AND `created_at >= ?`] [AND `created_at <= ?`], ORDER BY `created_at DESC, order_id DESC`, OFFSET/LIMIT.
3. COUNT(*) with same WHERE for `total_count`.
4. Return result.

**reDerive (no single transaction; batched):**

1. Validate `date_from < date_to`. Raise `InvalidDateRangeError` otherwise.
2. Fetch all `payment_orders` in `[date_from, date_to]` ordered by `created_at ASC`.
3. For each order (batches of 500 within a single transaction):
   - Look up the worker.
   - Look up the last event.
   - Upsert the `operations` row.
   - Recompute (not delta) the `company_financial_totals` for that company by SUM/COUNT over `payment_orders` WHERE `company_id = ?`. This avoids drift from concurrent writes during the batch.
4. Return count of rows rewritten.

Idempotency: upsert semantics mean running reDerive twice on the same window produces the same result.

**DriftRepair (scheduled, every 5 min):**

1. Define window: `[now − 1 h, now]`.
2. Fetch projection rows with `updated_at` in window.
3. For each row, fetch the corresponding `payment_orders` + worker + last-event. If the source `updated_at` > projection `updated_at`, the projection is stale → re-derive that single row (same upsert as in reDerive step 3).
4. Recompute `company_financial_totals` for affected companies (SUM/COUNT from source).
5. Return report.

No user-facing endpoint; errors are logged to the NestJS logger.

**Transaction boundaries:**

| Operation | Transaction? | What is inside | What must NOT be |
|-----------|-------------|----------------|-----------------|
| simulateWrite | Yes (interactive) | source upsert, projection upsert, totals upsert | Any external I/O; any read after commit |
| getDashboard | No (auto-commit reads) | Single SELECT + COUNT | Any write |
| reDerive batch | Yes (per 500-row batch) | Up to 500 projection upserts + totals recompute | Processing more than one batch in the same tx; any source writes |
| drift-repair per row | Yes (per row) | Single projection upsert + totals recompute for that company | Reprocessing a row already repaired in this run |

## 5. Tests

| Test file | Test name | Proves |
|-----------|-----------|--------|
| test/operations.spec.ts | read-your-own-writes: approve an order, next getDashboard includes it with new status | The maintenance hook commits before any subsequent read can observe stale data |
| test/operations.spec.ts | concurrent updates to one company's totals: two simultaneous simulateWrite calls for different orders of the same company leave total_amount = sum of both | The totals upsert is correct under concurrent writers (no lost update) |
| test/operations.spec.ts | dashboard filters by status and date range correctly | WHERE clauses on the projection produce expected subset |
| test/operations.spec.ts | pagination returns correct page and total_count | OFFSET/LIMIT arithmetic is right |
| test/re-derivation.spec.ts | re-derive a window after manually corrupting a projection row restores it | Re-derivation is a correct repair path |
| test/re-derivation.spec.ts | re-derive is idempotent (run twice, same result) | No double-counting or drift on replay |
| test/drift-repair.spec.ts | drift-repair detects and repairs a stale projection row | The scheduled job finds mismatches and fixes them |
| test/drift-repair.spec.ts | drift-repair skips rows where source is newer than projection (concurrent write guard) | No clobber of in-flight writes |
| test/drift-repair.spec.ts | drift-repair recomputes company totals after repair | Totals are consistent post-repair |

## 6. Manifest

<!-- manifest
DESIGN.md | reads: - | Justifies sync-hooks over CDC/messaging/materialised-view alternatives
prisma/schema.prisma | reads: - | Prisma DDL for all five tables with @@map and indexes
prisma/migrations/0001_initial/migration.sql | reads: - | DDL migration for all tables and indexes
src/main.ts | reads: src/app.module.ts | NestJS bootstrap
src/app.module.ts | reads: - | Root module importing OperationsModule, ReDerivationModule, DriftRepairModule
src/operations/operations.types.ts | reads: - | Shared types, enums, and error classes for the operations feature
src/operations/operations.repository.ts | reads: src/operations/operations.types.ts | All Prisma queries for projection, source, and aggregate tables
src/operations/operations.service.ts | reads: src/operations/operations.repository.ts, src/operations/operations.types.ts | Business logic for dashboard read, simulate-write, totals
src/operations/operations.controller.ts | reads: src/operations/operations.service.ts, src/operations/operations.types.ts | Route handlers with input validation
src/operations/operations.module.ts | reads: - | NestJS module wiring controller, service, repository; exports service
src/re-derivation/re-derivation.repository.ts | reads: src/operations/operations.types.ts | Reuses OperationsRepository (type-level only); no separate repo needed
src/re-derivation/re-derivation.service.ts | reads: src/operations/operations.repository.ts, src/operations/operations.types.ts | Batched re-derivation logic
src/re-derivation/re-derivation.controller.ts | reads: src/re-derivation/re-derivation.service.ts, src/operations/operations.types.ts | POST /operations/re-derive
src/re-derivation/re-derivation.module.ts | reads: - | Module wiring; imports OperationsModule for the repository
src/drift-repair/drift-repair.service.ts | reads: src/operations/operations.repository.ts, src/operations/operations.types.ts | Scheduled drift check and repair logic with @Cron
src/drift-repair/drift-repair.module.ts | reads: - | Module wiring; imports OperationsModule for the repository
test/operations.spec.ts | reads: src/operations/operations.service.ts, src/operations/operations.types.ts | Read-your-own-writes, concurrent totals, filter/pagination correctness
test/re-derivation.spec.ts | reads: src/re-derivation/re-derivation.service.ts, src/operations/operations.types.ts | Re-derivation correctness and idempotency
test/drift-repair.spec.ts | reads: src/drift-repair/drift-repair.service.ts, src/operations/operations.types.ts | Drift detection, repair, and concurrent-write guard
-->
