## 1. Assumptions

- Source tables `payment_orders`, `events`, `workers`, `companies` already exist and are owned by the write services; I add only the projection tables and do not alter source DDL.
- The read model is a single denormalized projection table `operation_read_models` (one row per order) — a join of order + event + worker, pre-aggregating the financial fields needed by the dashboard.
- "Financial totals per company must be exact" means the projection stores exact integer `amount_cents` (Postgres `bigint`) and totals are computed by `SUM(amount_cents)` over the projection, never floats.
- "Read-your-own-writes" is satisfied by synchronous in-transaction maintenance: the write service and the projection update commit in one transaction, so a request after commit sees the new row.
- "Concurrent updates to one company's totals" must not corrupt or lose updates: maintenance uses atomic row upserts keyed by the natural key, so concurrent writes to different orders of one company are independent and totals stay exact.
- "Drift repair" re-derives a date window from source tables and overwrites the projection rows for that window, idempotently.
- The scheduled job runs on a cron interval (configurable via env) and repairs a sliding window behind the current time.
- The dashboard is served by a new NestJS endpoint `GET /operations` with query params `companyId`, `status`, `fromDate`, `toDate`, `page`, `pageSize`; response shape is unchanged from what operators currently see.
- Pagination is offset-based (`page` 1-indexed) with a stable secondary sort on `id` to avoid ties.
- Sort is by recency = `occurred_at DESC`, then `id DESC` for determinism.
- The write path is simulated in tests by calling the projection maintenance service directly (no real payment gateway).
- `DESIGN.md` is a short prose doc justifying sync hooks over triggers/async queues; it is not code and has no imports.
- The re-derivation routine and drift-repair job are separate: re-derivation is a callable service method for an arbitrary window; the scheduled job wraps it with a fixed sliding window.
- Error envelope is the single `error` object shape; codes used: `resource_not_found`, `invalid_parameter`.
- No auth/authorization middleware is in scope (back-office assumed internal).

## 2. Data model

**`operation_read_models`** (projection, `@@map("operation_read_models")`)
- `id` `BigInt` `@id @default(autoincrement()) @map("id")` — surrogate key
- `order_id` `BigInt` `@unique @map("order_id")` — natural key, one row per order
- `company_id` `BigInt` `@map("company_id")`
- `worker_id` `BigInt?` `@map("worker_id")`
- `event_id` `BigInt?` `@map("event_id")`
- `status` `String` `@map("status")` — order status snapshot
- `amount_cents` `BigInt` `@map("amount_cents")` — exact financial amount
- `currency` `String` `@map("currency")`
- `occurred_at` `DateTime` `@map("occurred_at")` — recency sort key
- `created_at` `DateTime` `@default(now()) @map("created_at")`
- `updated_at` `DateTime` `@updatedAt @map("updated_at")`

Indexes on `operation_read_models`:
- unique index on `order_id` (enforced by `@unique`)
- composite index `(company_id, status, occurred_at DESC, id DESC)` for the dashboard filter+sort
- index on `occurred_at` for date-window re-derivation and drift repair

**Source tables (pre-existing, read-only here):**
- `payment_orders` (`order_id`, `company_id`, `worker_id`, `event_id`, `status`, `amount_cents`, `currency`, `occurred_at`, ...)
- `events` (`event_id`, ...)
- `workers` (`worker_id`, ...)
- `companies` (`company_id`, ...)

## 3. Types and signatures

```ts
// src/operations/operation-read-model.types.ts
export type OperationStatus = string;

export interface OperationReadModel {
  id: bigint;
  orderId: bigint;
  companyId: bigint;
  workerId: bigint | null;
  eventId: bigint | null;
  status: string;
  amountCents: bigint;
  currency: string;
  occurredAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Input the write service hands to maintenance for one order.
export interface OperationUpsertInput {
  orderId: bigint;
  companyId: bigint;
  workerId: bigint | null;
  eventId: bigint | null;
  status: string;
  amountCents: bigint;
  currency: string;
  occurredAt: Date;
}

export interface OperationDeleteInput {
  orderId: bigint;
}

// Dashboard query input.
export interface OperationsQueryInput {
  companyId: bigint;
  status?: string;
  fromDate?: Date;
  toDate?: Date;
  page: number;
  pageSize: number;
}

export interface OperationsPage {
  items: OperationReadModel[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface CompanyTotals {
  companyId: bigint;
  totalAmountCents: bigint;
  orderCount: number;
}

export interface DateWindow {
  from: Date;
  to: Date;
}
```

Errors (raised by service, mapped to the envelope by controller/exception filter):
- `ResourceNotFoundError` → code `resource_not_found`. Raised when a re-derivation window contains no derivable rows and the caller expected them, or when maintenance is asked to update an order whose source row no longer exists.
- `InvalidParameterError` → code `invalid_parameter`. Raised for `page < 1`, `pageSize < 1 || pageSize > 200`, `fromDate > toDate`.

Ordering rules:
- `upsertOperation` vs `deleteOperation` for the same `orderId`: last write wins; a delete after an upsert removes the row, an upsert after a delete re-inserts.
- Concurrent `upsertOperation` calls for different `orderId` of the same company: independent, both commit, totals reflect both.
- `rederiveWindow` vs a concurrent `upsertOperation` inside the window: re-derivation reads source as-of its transaction start and overwrites projection rows; a later upsert then wins for that order.
- `repairDrift` (scheduled) is idempotent and may overlap with manual `rederiveWindow`; overlapping windows converge to the same rows because re-derivation is a pure function of source.

```ts
// src/operations/operation-read-model.repository.ts
export class OperationReadModelRepository {
  constructor(prisma: PrismaClient);
  upsert(input: OperationUpsertInput): Promise<void>;
  remove(orderId: bigint): Promise<void>;
  findPage(query: OperationsQueryInput): Promise<OperationsPage>;
  totalsForCompany(companyId: bigint): Promise<CompanyTotals>;
  rederiveWindow(window: DateWindow): Promise<number>; // returns rows written
  deleteInWindow(window: DateWindow): Promise<void>;
}

// src/operations/operation-read-model.service.ts
export class OperationReadModelService {
  constructor(repo: OperationReadModelRepository, prisma: PrismaClient);
  upsertOperation(input: OperationUpsertInput): Promise<void>;
  deleteOperation(orderId: bigint): Promise<void>;
  queryOperations(query: OperationsQueryInput): Promise<OperationsPage>;
  totalsForCompany(companyId: bigint): Promise<CompanyTotals>;
  rederiveWindow(window: DateWindow): Promise<number>;
}

// src/operations/drift-repair.processor.ts
export class DriftRepairProcessor {
  constructor(service: OperationReadModelService, config: ConfigService);
  // @Cron — repairs a sliding window [now - lag, now - safety]
  repairDrift(): Promise<number>;
}

// src/operations/operations.controller.ts
export class OperationsController {
  constructor(service: OperationReadModelService);
  // GET /operations?companyId&status&fromDate&toDate&page&pageSize
  getOperations(query: OperationsQueryInput): Promise<OperationsPage>;
}

// src/operations/operations.module.ts
export class OperationsModule implements NestModule {}
```

## 4. Control flow

- **Write path (simulated).** The write service performs its source-table mutation and calls `OperationReadModelService.upsertOperation` (or `deleteOperation`) within the **same Prisma transaction** that commits the source change. The projection `upsert`/`remove` is part of that transaction. Nothing reads the projection inside it. This single-transaction boundary is what guarantees read-your-own-writes: after commit, the next `queryOperations` sees the row. The projection write must not open its own transaction or await anything external.

- **Concurrent company updates.** Each `upsertOperation` targets exactly one row keyed by `order_id`. Concurrent writes to different orders of one company touch disjoint rows, so they commit independently; `totalsForCompany` is a fresh `SUM` at read time, never a cached counter, so it always reflects committed rows exactly. No advisory lock is taken; row-level isolation suffices.

- **Re-derivation (`rederiveWindow`).** One transaction: (1) delete projection rows whose `occurred_at` is in `[from, to)`; (2) read source orders in that window joined to event/worker; (3) bulk-insert the derived rows. The transaction is atomic — a crash leaves either the old or the new set, never a partial mix. Idempotent: running it twice yields identical rows.

- **Drift-repair job.** Scheduled by `@Cron`. On each tick it computes a sliding window `[now - lag, now - safetyMargin]` (both from env config) and calls `rederiveWindow`. It must not overlap the very recent window that live writes are still filling (hence `safetyMargin`), and it must be idempotent so a missed or doubled tick is harmless. It runs independently of request traffic and takes no locks held by the write path.

- **Dashboard read.** `getOperations` validates params (raises `InvalidParameterError`), then calls `queryOperations`, which issues one indexed query against the projection (filter on company/status/date, sort `occurred_at DESC, id DESC`, offset/limit) plus a `COUNT(*)` for pagination. It never touches source tables.

- **Must not be inside the write transaction:** any read of the projection for display, any cross-company aggregate, any external call. The write transaction contains only the source mutation and the single-row projection upsert/remove.

## 5. Tests

- **Read-your-own-writes:** after `upsertOperation` commits, a subsequent `queryOperations` for that company returns the new row with correct status/amount.
- **Read-your-own-writes delete:** after `deleteOperation`, the row no longer appears in `queryOperations`.
- **Concurrent updates to one company's totals:** two concurrent `upsertOperation` calls for different orders of the same company both persist; `totalsForCompany` equals the exact sum of both amounts (no lost update).
- **Concurrent updates idempotency on same order:** two concurrent `upsertOperation` for the same `orderId` converge to one row with the last-writer's values.
- **Exact totals:** `totalsForCompany` returns `totalAmountCents` as the exact integer sum of committed orders, matching a hand-computed value.
- **Drift repair recovers divergence:** manually corrupt a projection row (wrong status/amount), run `repairDrift` for a window covering it, and assert the row is restored to match source.
- **Drift repair idempotent:** running `repairDrift` twice over the same window yields identical projection contents and row counts.
- **Re-derivation arbitrary window:** `rederiveWindow` over a custom `[from,to)` replaces exactly the projection rows in that window and leaves rows outside it untouched.
- **Pagination stability:** `queryOperations` across pages returns disjoint, complete, deterministically ordered rows (no duplicates/omissions) for a fixed dataset.
- **Filtering:** `queryOperations` filters correctly by `status`, `fromDate`, `toDate` combinations.
- **Invalid parameters:** `queryOperations` raises `InvalidParameterError` for `page < 1`, `pageSize > 200`, and `fromDate > toDate`.

## 6. Manifest

```
<!-- manifest
DESIGN.md | reads: - | prose justification of sync maintenance hooks vs triggers/async queues
prisma/schema.prisma | reads: - | Prisma models + indexes for operation_read_models
src/operations/operation-read-model.types.ts | reads: - | shared input/output types and error contracts
src/operations/operation-read-model.repository.ts | reads: src/operations/operation-read-model.types.ts | only layer touching the DB: upsert/remove/page/totals/rederive
src/operations/operation-read-model.service.ts | reads: src/operations/operation-read-model.types.ts, src/operations/operation-read-model.repository.ts | write-maintenance + query logic, validation, error raising
src/operations/drift-repair.processor.ts | reads: src/operations/operation-read-model.service.ts, src/operations/operation-read-model.types.ts | @Cron sliding-window drift repair
src/operations/operations.controller.ts | reads: src/operations/operation-read-model.service.ts, src/operations/operation-read-model.types.ts | GET /operations endpoint, input validation, envelope mapping
src/operations/operations.module.ts | reads: src/operations/operation-read-model.service.ts, src/operations/operation-read-model.repository.ts, src/operations/drift-repair.processor.ts, src/operations/operations.controller.ts | NestJS wiring: providers, exports, controller
test/operation-read-model.spec.ts | reads: src/operations/operation-read-model.service.ts, src/operations/operation-read-model.repository.ts, src/operations/operation-read-model.types.ts | read-your-own-writes, concurrent totals, exact totals, invalid params
test/drift-repair.spec.ts | reads: src/operations/drift-repair.processor.ts, src/operations/operation-read-model.service.ts, src/operations/operation-read-model.types.ts | drift repair recovers divergence and is idempotent
-->
