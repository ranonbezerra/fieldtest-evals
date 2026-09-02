# 00-plan@medium

## reasoning

```
Let me analyze the task carefully:

The task is to build a marketplace operations dashboard with:
1. A projection table(s) that denormalizes payment orders, events, and workers
2. DDL with appropriate indexes
3. Maintenance hooks invoked by write services (sync hooks)
4. A re-derivation routine for an arbitrary date window
5. A scheduled drift-repair job
6. A new dashboard query (paginated, filtered by company/status/date, sorted by recency)
7. Tests for read-your-own-writes, concurrent updates, drift repair
8. DESIGN.md justifying sync-hooks vs alternatives

Let me think about the data model:

Source tables (existing):
- payment_orders (id, company_id, status, amount, currency, created_at, updated_at)
- events (id, order_id, type, payload, created_at)
- workers (id, company_id, name, role, ...)
- companies (id, name, ...)

Projection table:
- operations_dashboard (denormalized view of orders + events + workers for the dashboard)

The projection should pre-join:
- order_id, company_id, worker_id (the assigned worker), status, amount, currency, event_count, last_event_type, created_at, updated_at

Indexes:
- (company_id, status, created_at DESC) for the main query pattern
- (company_id, amount) for financial totals (or a separate aggregate table)

For exact financial totals per company:
- operations_company_totals (company_id, total_amount, currency, order_count, updated_at)

Maintenance hooks:
- On order created/approved/updated → upsert into projection + update totals
- On event created → update event_count/last_event_type in projection

Re-derivation:
- Takes a date window, re-reads source tables, rebuilds projection rows for that window

Drift repair:
- Scheduled job that compares projection vs source for a window and fixes discrepancies

Let me think about the file layout per conventions:
- src/operations/operations.module.ts
- src/operations/operations.controller.ts
- src/operations/operations.service.ts
- src/operations/operations.repository.ts
- src/operations/operations-write-hooks.service.ts (the maintenance hooks)
- src/operations/operations-rederive.service.ts
- src/operations/operations-drift-repair.processor.ts (scheduled job)
- test/operations.spec.ts
- DESIGN.md
- prisma/schema.prisma (the projection tables)

Wait, the task says "simulation of the write path" — so we need write services that the hooks are invoked by. Let me think about this differently.

The "write services" are the services that modify orders/events/workers. The "maintenance hooks" are called after those writes commit. Since this is a simulation, we need:
- A write path that modifies source data AND calls the maintenance hooks
- The maintenance hooks update the projection

Let me reconsider the structure:

Source domain (existing, but we need to model it):
- PaymentOrder
- Event  
- Worker
- Company

Projection domain (what we build):
- OperationRow (the denormalized row)
- CompanyTotals (exact financial aggregates)

Files:
- prisma/schema.prisma — all models including projection
- src/operations/operations.module.ts
- src/operations/operations.controller.ts — the dashboard query endpoint
- src/operations/operations.service.ts — business logic for querying
- src/operations/operations.repository.ts — projection table reads/writes
- src/orders/orders.module.ts
- src/orders/orders.controller.ts — write path for orders (simulation)
- src/orders/orders.service.ts — order write logic + calls maintenance hook
- src/orders/orders.repository.ts — order reads/writes
- src/events/events.module.ts
- src/events/events.service.ts — event write logic + calls maintenance hook
- src/events/events.repository.ts
- src/operations/operations-maintenance.service.ts — the hooks that update projection
- src/operations/operations-rederive.service.ts — re-derivation for date window
- src/operations/operations-drift-repair.processor.ts — scheduled drift repair
- test/operations.spec.ts
- DESIGN.md

Actually, let me simplify. The task says "maintenance hooks invoked by the write services (simulate the write path)". So the write path is simulated — we create minimal write endpoints that trigger the hooks. We don't need full CRUD on orders/events, just enough to demonstrate the write → hook → projection flow.

Let me think about what the dashboard query looks like:
- GET /operations?company_id=X&status=Y&from=Z&to=W&page=N&per_page=M
- Returns: paginated list of operation rows + total count + company totals

The projection row:
- id (order_id)
- company_id
- worker_name, worker_role (denormalized from workers)
- status
- amount, currency
- event_count, last_event_at
- created_at, updated_at

Company totals (exact):
- company_id
- total_amount (numeric)
- order_count
- last_updated_at

Indexes on operations_dashboard:
- (company_id, status, created_at DESC) — main query filter + sort
- (company_id) — for totals lookup if we ever need it there

Now let me think about transaction boundaries:
1. Write path (order create/approve): 
   - Transaction 1: write to source table + update projection + update totals (all in one transaction)
   - This guarantees read-your-own-writes

2. Re-derivation:
   - For a date window: delete projection rows in window, re-insert from source, recalculate totals
   - Should be idempotent

3. Drift repair:
   - For a date window: compare source vs projection, fix mismatches
   - Runs on schedule (e.g., every 5 minutes)

Error cases:
- resource_not_found: company doesn't exist, or order not found
- validation_error: bad date range (from > to), negative page, etc.

Let me now write the plan concisely.

For the Prisma schema, I need:
- Company
- Worker
- PaymentOrder
- Event
- OperationRow (projection)
- CompanyTotals (projection aggregate)

Let me think about the "exact financial totals" requirement. Since we can't use approximate aggregates, the CompanyTotals table maintains a running sum that's updated atomically in the same transaction as the order write. This is exact because every mutation to an order's amount/status goes through the hook in the same transaction.

The re-derivation routine recalculates from scratch for a window, so if there's ever a bug in the increment/decrement logic, re-derivation fixes it.

Drift repair: periodically, for a recent window (e.g., last 1 hour), compare projection state against source and fix any discrepancies. This catches edge cases like partial failures (though the transaction should prevent those, it's a safety net).

Now let me write the plan. I need to be concise given the output limit.
```

## reply

## 1. Assumptions

- The source tables (`companies`, `workers`, `payment_orders`, `events`) are pre-existing and modeled in the same Prisma schema; this task adds only the projection tables and the read/write services around them.
- The "write path" is a minimal simulation: `POST /orders` (create) and `PATCH /orders/:id/approve` (status change). No full CRUD.
- The dashboard endpoint is `GET /operations` with query params `company_id`, `status`, `from`, `to`, `page`, `per_page`.
- "Scheduled" drift-repair uses NestJS's `@nestjs/schedule` `@Cron` decorator, not an external scheduler.
- One currency per company; the totals table stores a single `total_amount` per company (no multi-currency aggregation).
- Per-page defaults to 50, max 200. Page is 1-based.
- The re-derivation endpoint is `POST /operations/re-derive` accepting `{ from, to }`; drift-repair is an internal cron (no HTTP endpoint).
- Worker assignment on an order is a single `worker_id` FK. The denormalized columns in the projection are `worker_name` and `worker_role`.
- Migration files are out of scope for this plan (Prisma generates them); only the schema DDL is specified.

## 2. Data model

### Prisma schema additions (projection tables)

**`operations_dashboard`** (mapped to `operations_dashboard`)

| Column | Type | Notes |
|--------|------|-------|
| `id` | `BigInt @id @default(autoincrement())` | surrogate key |
| `order_id` | `BigInt @unique` | FK → `payment_orders.id` |
| `company_id` | `BigInt` | FK → `companies.id`, indexed |
| `worker_id` | `BigInt?` | FK → `workers.id` |
| `worker_name` | `String?` | denormalized |
| `worker_role` | `String?` | denormalized |
| `status` | `String` | mirrors `payment_orders.status` |
| `amount` | `Decimal @db.Decimal(18,4)` | mirrors `payment_orders.amount` |
| `currency` | `String` | mirrors |
| `event_count` | `Int @default(0)` | count of linked events |
| `last_event_at` | `DateTime?` | max event `created_at` |
| `created_at` | `DateTime @default(now())` | mirrors order |
| `updated_at` | `DateTime @updatedAt` | mirrors order |

Indexes:
- `(company_id, status, created_at DESC)` — primary dashboard query path
- `(company_id, amount)` — totals verification
- `(order_id)` — unique, upsert target

**`company_totals`** (mapped to `company_totals`)

| Column | Type | Notes |
|--------|------|-------|
| `company_id` | `BigInt @id` | PK, FK → `companies.id` |
| `total_amount` | `Decimal @default(0) @db.Decimal(18,4)` | exact sum of non-cancelled orders |
| `order_count` | `Int @default(0)` | count of non-cancelled orders |
| `last_updated_at` | `DateTime @updatedAt` | |

Index: PK on `company_id`.

### Source tables (assumed pre-existing, listed for reference)

- `companies`: id, name, created_at
- `workers`: id, company_id, name, role, created_at
- `payment_orders`: id, company_id, worker_id?, status, amount (Decimal(18,4)), currency, created_at, updated_at
- `events`: id, order_id (FK), type, payload (Json), created_at

## 3. Types and signatures

```typescript
// --- enums / constants ---

type OrderStatus = "pending" | "approved" | "rejected" | "cancelled";
// Excluded from totals: "cancelled"

type DashboardStatusFilter = OrderStatus | "all";

// --- DTOs (controller input/output) ---

interface CreateOrderDto {
  company_id: string;   // BigInt as string for JSON
  worker_id?: string;
  amount: number;
  currency: string;
}

interface ApproveOrderDto {
  status: "approved" | "rejected";
}

interface OperationsQueryDto {
  company_id: string;
  status?: DashboardStatusFilter;  // default "all"
  from?: string;                   // ISO-8601, default epoch
  to?: string;                     // ISO-8601, default now
  page?: number;                   // default 1, min 1
  per_page?: number;               // default 50, max 200
}

interface OperationRowDto {
  order_id: string;
  company_id: string;
  worker_name: string | null;
  worker_role: string | null;
  status: OrderStatus;
  amount: string;   // Decimal serialized as string
  currency: string;
  event_count: number;
  last_event_at: string | null;
  created_at: string;
  updated_at: string;
}

interface CompanyTotalsDto {
  total_amount: string;
  order_count: number;
}

interface OperationsResponseDto {
  rows: OperationRowDto[];
  total_count: number;
  page: number;
  per_page: number;
  totals: CompanyTotalsDto;
}

interface ReDeriveDto {
  from: string;  // ISO-8601
  to: string;    // ISO-8601
}

// --- error codes (raised as HttpException or NestJS exceptions) ---

// "resource_not_found" — company_id does not exist, or order_id not found
// "validation_error" — from > to, per_page > 200, page < 1

// --- Service / Repository signatures ---

class OperationsRepository {
  findDashboard(query: OperationsQueryDto): Promise<{ rows: OperationRow[]; total_count: number }>;
  findTotals(companyId: bigint): Promise<CompanyTotals | null>;
  upsertRow(row: UpsertOperationRowInput): Promise<OperationRow>;
  adjustTotals(companyId: bigint, deltaAmount: Decimal, deltaCount: number): Promise<CompanyTotals>;
  deleteRowsByDateRange(from: Date, to: Date): Promise< number>;
  bulkInsert(rows: UpsertOperationRowInput[]): Promise<void>;
}

interface UpsertOperationRowInput {
  order_id: bigint;
  company_id: bigint;
  worker_id: bigint | null;
  worker_name: string | null;
  worker_role: string | null;
  status: OrderStatus;
  amount: Decimal;
  currency: string;
  event_count: number;
  last_event_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

class OperationsService {
  constructor(repo: OperationsRepository, totalsRepo: CompanyTotalsRepository);

  getDashboard(query: OperationsQueryDto): Promise<OperationsResponseDto>;
  reDerive(from: Date, to: Date): Promise<void>;
  applyOrderCreated(order: PaymentOrder, worker: Worker | null): Promise<void>;
  applyOrderStatusChange(order: PaymentOrder, prevStatus: OrderStatus): Promise<void>;
  applyEventCreated(event: Event): Promise<void>;
}

class OperationsMaintenanceService {
  // Called by write-path services AFTER their transaction commits (same tx in practice)
  onOrderCreated(tx: Prisma.TransactionClient, order: PaymentOrder, worker: Worker | null): Promise<void>;
  onOrderStatusChanged(tx: Prisma.TransactionClient, order: PaymentOrder, prevStatus: OrderStatus): Promise<void>;
  onEventCreated(tx: Prisma.TransactionClient, event: Event): Promise<void>;
}

class ReDeriveService {
  reDeriveWindow(from: Date, to: Date): Promise<void>;
}

class DriftRepairProcessor {
  @Cron("*/5 * * * * *")   // every 5 min
  repair(): Promise<void>;
}

class OrdersService {
  create(dto: CreateOrderDto): Promise<{ id: string }>;
  approve(id: string, dto: ApproveOrderDto): Promise<{ id: string; status: OrderStatus }>;
}

class EventsService {
  record(orderId: string, type: string, payload: object): Promise<{ id: string }>;
}

class OperationsController {
  @Get("operations") getDashboard(query: OperationsQueryDto): Promise<OperationsResponseDto>;
  @Post("operations/re-derive") reDerive(body: ReDeriveDto): Promise<{ processed: number }>;
}

class OrdersController {
  @Post("orders") create(dto: CreateOrderDto): Promise<{ id: string }>;
  @Patch("orders/:id/approve") approve(@Param("id") id: string, body: ApproveOrderDto): Promise<{ id: string; status: OrderStatus }>;
}

class EventsController {
  @Post("events") record(body: RecordEventDto): Promise<{ id: string }>;
}

interface RecordEventDto {
  order_id: string;
  type: string;
  payload?: Record<string, unknown>;
}

class CompanyTotalsRepository {
  upsert(companyId: bigint): Promise<CompanyTotals>;
  findById(companyId: bigint): Promise<CompanyTotals | null>;
  adjust(companyId: bigint, deltaAmount: Decimal, deltaCount: number): Promise<CompanyTotals>;
  recalcForWindow(companyId: bigint, from: Date, to: Date): Promise<CompanyTotals>;
}

class SourceRepository {
  // Reads from source tables for re-derivation and drift check
  findOrdersInWindow(from: Date, to: Date): Promise<PaymentOrder[]>;
  findWorkerById(id: bigint): Promise<Worker | null>;
  countEventsForOrder(orderId: bigint): Promise<number>;
  lastEventTimeForOrder(orderId: bigint): Promise<Date | null>;
  findCompany(id: string): Promise<Company | null>;
}
```

**Ordering rules between operations:**

- `applyOrderStatusChange` must subtract the old status's contribution from totals only if the old status was non-cancelled, and add the new status's contribution only if the new status is non-cancelled. Both adjustments happen in the same transaction as the projection row upsert.
- `reDeriveWindow` is destructive for its window: it deletes projection rows in `[from, to)` and re-inserts. It must complete atomically (one transaction) so a reader never sees a partial window.
- `DriftRepairProcessor.repair` reads source and projection for a 1-hour window ending at `now - 30s` (safety margin). If it finds discrepancies it applies the same upsert/adjust as the hooks. It must be idempotent.

## 4. Control flow

### Write path (create order)

1. `OrdersController.create` validates input, calls `OrdersService.create`.
2. `OrdersService.create` opens a Prisma `$transaction`:
   - Insert into `payment_orders` (source).
   - Call `OperationsMaintenanceService.onOrderCreated(tx, order, worker)`.
     - Upsert row in `operations_dashboard` (event_count=0, last_event_at=null).
     - `CompanyTotalsRepository.adjust(companyId, +amount, +1)` (since status is "pending", which is non-cancelled).
   - Commit.
3. Return `{ id }`.

**Read-your-own-writes guarantee:** the projection row and totals are written in the same transaction as the source row. The next `GET /operations` reads the committed projection.

### Write path (approve/reject)

1. `OrdersController.approve` → `OrdersService.approve`.
2. `$transaction`:
   - Read current order (prevStatus).
   - Update `payment_orders.status` + `updated_at`.
   - Call `OperationsMaintenanceService.onOrderStatusChanged(tx, order, prevStatus)`.
     - Upsert `operations_dashboard` row (status, updated_at).
     - If prevStatus was non-cancelled → `adjust(companyId, -amount, -1)`.
     - If newStatus is non-cancelled → `adjust(companyId, +amount, +1)`.
   - Commit.

### Write path (record event)

1. `EventsController.record` → `EventsService.record`.
2. `$transaction`:
   - Insert into `events`.
   - Call `OperationsMaintenanceService.onEventCreated(tx, event)`.
     - Update `operations_dashboard` row: `event_count += 1`, `last_event_at = event.created_at`.
   - Commit.

### Dashboard read

1. `OperationsController.getDashboard` validates params, calls `OperationsService.getDashboard`.
2. `OperationsRepository.findDashboard` executes a single query against `operations_dashboard` with WHERE `(company_id) AND (status = ? OR all) AND (created_at >= from AND created_at < to)`, ORDER BY `created_at DESC`, LIMIT/OFFSET. Also `COUNT(*)` for pagination.
3. `CompanyTotalsRepository.findById(companyId)` reads the pre-computed totals row.
4. Assemble and return `OperationsResponseDto`.

No joins at read time. The query touches one table + one totals row.

### Re-derivation

1. `POST /operations/re-derive` with `{ from, to }`.
2. `ReDeriveService.reDeriveWindow` in one `$transaction`:
   - Delete all `operations_dashboard` rows where `created_at` in `[from, to)`.
   - Query source: all `payment_orders` in window + their workers + event counts.
   - Bulk-insert reconstructed rows into `operations_dashboard`.
   - For each affected company: `recalcForWindow` — recompute totals from source orders in window, write back.
3. Return `{ processed: rowCount }`.

### Drift repair (cron, every 5 min)

1. Compute window: `[now - 60s, now - 30s]`.
2. For each company with activity in window (source count > 0):
   - Compare source-derived state to projection rows.
   - For each mismatched/missing row: upsert (same logic as hook).
   - If totals differ from source sum: write corrected totals.
3. Log discrepancies count. No HTTP response (internal).

**What must NOT be in a transaction:** logging, external calls. The drift-repair cron does its reads outside the write transaction; only the corrective writes are wrapped.

## 5. Tests

| Test | Proves |
|------|--------|
| `create order → GET /operations returns it with correct status/amount` | read-your-own-writes for create |
| `approve order → GET /operations shows updated status, totals unchanged (pending→approved both count)` | read-your-own-writes for status change; totals arithmetic correct |
| `create order → cancel → GET /operations totals decrease by amount` | cancelled orders excluded from exact totals |
| `two concurrent PATCH approve on same company → totals reflect exactly two changes (no lost update)` | concurrent-update safety via atomic `adjust` in tx |
| `re-derive a window that had 3 orders → projection rows match source exactly` | re-derivation produces correct state from scratch |
| `mutate a projection row directly (simulate drift) → run drift-repair → row matches source again` | drift detection and correction |
| `GET /operations with from > to → 400 validation_error` | input validation |
| `GET /operations for non-existent company → 404 resource_not_found` | error envelope correctness |
| `create order with event_count 0 → record event → GET shows event_count 1, last_event_at set` | event hook updates projection |
| `re-derive window with zero orders → returns processed: 0, no errors` | idempotent/empty-window edge case |

## 6. Manifest

<!-- manifest
prisma/schema.prisma | reads: - | all Prisma models including projection tables and indexes
DESIGN.md | reads: - | justification of sync-hooks over triggers/messaging/async
src/app.module.ts | reads: - | root module importing feature modules, schedule module
src/operations/operations.module.ts | reads: - | module wiring controller, services, repositories, processor
src/operations/operations.controller.ts | reads: src/operations/operations.service.ts | GET /operations, POST /operations/re-derive
src/operations/operations.service.ts | reads: src/operations/operations.repository.ts, src/operations/company-totals.repository.ts | dashboard query logic, re-derive orchestration
src/operations/operations.repository.ts | reads: - | all CRUD on operations_dashboard table
src/operations/company-totals.repository.ts | reads: - | all CRUD on company_totals table
src/operations/operations-maintenance.service.ts | reads: src/operations/operations.repository.ts, src/operations/company-totals.repository.ts | hook methods: onOrderCreated, onOrderStatusChanged, onEventCreated
src/operations/re-derive.service.ts | reads: src/operations/operations.repository.ts, src/operations/company-totals.repository.ts, src/operations/source.repository.ts | window re-derivation
src/operations/drift-repair.processor.ts | reads: src/operations/re-derive.service.ts, src/operations/source.repository.ts | @Cron drift detection + correction
src/operations/source.repository.ts | reads: - | read-only access to source tables for re-derive/drift
src/orders/orders.module.ts | reads: - | module wiring orders controller + service
src/orders/orders.controller.ts | reads: src/orders/orders.service.ts | POST /orders, PATCH /orders/:id/approve
src/orders/orders.service.ts | reads: src/orders/orders.repository.ts, src/operations/operations-maintenance.service.ts | write logic + hook invocation in tx
src/orders/orders.repository.ts | reads: - | payment_orders CRUD
src/events/events.module.ts | reads: - | module wiring events controller + service
src/events/events.controller.ts | reads: src/events/events.service.ts | POST /events
src/events/events.service.ts | reads: src/events/events.repository.ts, src/operations/operations-maintenance.service.ts | event insert + hook in tx
src/events/events.repository.ts | reads: - | events CRUD
test/operations.spec.ts | reads: src/operations/operations.service.ts, src/operations/operations.repository.ts, src/operations/company-totals.repository.ts, src/orders/orders.service.ts, src/events/events.service.ts, src/operations/re-derive.service.ts, src/operations/drift-repair.processor.ts | all behavioural tests listed in section 5
-->
