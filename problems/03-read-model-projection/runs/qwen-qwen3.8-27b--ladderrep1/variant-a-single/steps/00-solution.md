# solution

## reasoning

```
Let me plan the overall solution carefully.

Task: build the marketplace operations dashboard read-model (projection) in TypeScript + NestJS + Prisma + Postgres.

Deliverables:
1. Projection table(s) and DDL with indexes
2. Maintenance hooks called from the write services (simulating the write path)
3. A re-derivation routine over an arbitrary date window
4. A scheduled drift repair job
5. The new dashboard query (reading only the projection)
6. Tests for read-your-own-writes, concurrent totals, and drift repair
7. DESIGN.md that justifies synchronous hooks against rejected alternatives

Key design decisions:

**Domain model** (from the problem statement): payment orders, events, workers, companies. The operations list joins payment orders, events, and workers; filters by company, status, and date range; sorts by recency; paginates.

So the source tables:
- `companies` (probably)
- `workers`
- `payment_orders` (has status, amount, company_id, worker_id, created_at, updated_at)
- `events` (activity events on orders)

The operations row = a join of payment order + event + worker. The dashboard shows, for example: order id, company, status, worker name, latest event, amount, timestamp.

**Projection tables:**
1. `operation_rows` (or `operations_list`) — one row per payment order, denormalized: company_id, status, worker_name, latest_event_type, latest_event_at, order_amount, created_at, updated_at. Primary key is payment_order_id. Index: `(company_id, status, updated_at DESC)` — for filter+sort pagination.

Actually, wait: the per-company financial totals are a separate concern. Requirement: "per-company financial totals must be exact". So a second projection table:

2. `company_financial_totals` — per-company totals: approved_amount, pending_amount, disputed_amount, etc., counts. Atomic increments via `SET approved_total = approved_total + $x`.

Maintenance hooks: called from the write service inside the same transaction. Since Prisma is the ORM and the repository is the only layer that can touch the DB… The layers: controller validates input, calls the service; service holds the logic and has zero Prisma client calls; repository is the only layer that touches the DB.

Hmm, this complicates "the hook runs inside the write transaction". Prisma transactions: `prisma.$transaction(async (tx) => { ... })`. The repository methods need to accept a transactional client (or an interceptor). Typical pattern: the repository method takes a `PrismaClient` or a transaction client as a parameter? The convention says the repository is the only layer that touches the DB. So the write service calls `ordersRepo.approve(id, tx)`? But then the service manages the transaction… The service can't call Prisma directly (zero Prisma client calls). Hmm, "zero raw SQL, zero Prisma client calls" — the service must not instantiate/call Prisma. So how do you do a multi-repository transaction?

Option: the repository exposes a `transaction(fn)` helper? That would leak the Prisma client into the service's callback… Actually a common pattern: a `Database` service (or `PrismaService`) that provides `transaction<T>(fn: (tx: PrismaClient) => Promise<T>)`. The service calls `this.db.transaction(async (tx) => { await ordersRepo.approve(id, tx); await opsProjectionRepo.syncOrder(id, tx); })`. This keeps "the repository is the only layer that touches the DB" — the service only delegates to the repository, passing the tx handle as an opaque token. Hmm, but then the repository methods take `tx: PrismaTransactionClient` as a parameter — that's fine, the repository type-imports Prisma.

The alternative would be to have the write service use a "unit of work" object. To keep it simple and testable: define a `PrismaService` (an `@Injectable` extending PrismaClient) — standard NestJS. Then a small `TransactionRunner`? I think the cleanest is: the service calls `this.prisma.$transaction(...)`? No — the service has "zero Prisma client calls".

Let me reread: "The service holds the logic. Zero raw SQL, zero Prisma client calls." My reading: the service must not call `prisma.xxx` directly; all DB work goes through the repository. So the transaction coordinator has to be either a repository-level concern or a thin data-access helper that is part of the "repository" layer.

Design: create a `data-access` module, or a `db/transaction.service.ts`? A "service" named `DatabaseTransactionService` that's really part of the repository layer… The convention lists specific files: `feature.module.ts`, `feature.controller.ts`, `feature.service.ts`, `feature.repository.ts`. Extra files are allowed as long as they respect the layering (e.g. `projection.repository.ts` as a separate repository file). A transaction-runner can just be a method on `PrismaService` — `PrismaService` is infrastructure, not a "service" in the business-layer sense. I think extending PrismaClient with a `runInTransaction` helper is acceptable: it's data-access infrastructure, not business logic. And the feature service calls `this.prisma.runInTransaction(async (tx) => ...)`. Hmm, but "zero Prisma client calls" is strict — the service calling `prisma.runInTransaction` is a Prisma client call, though not a data operation.

The safest, most defensible reading: keep a `PrismaService` (infrastructure) with a `transaction()` method, and have the feature service pass the transaction callback to repositories… Actually the cleanest thing is: each repository method that is part of a write path takes an optional `tx: PrismaClient` parameter (defaulting to `this.prisma`). And for transaction coordination, I can add a `transaction<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T>` method on `PrismaService` — a one-line wrapper around `$transaction`. The service calls `this.prisma.transaction(async (tx) => {...})`.

Hmm, honestly, many reviewers would accept `prisma.$transaction` inside the service if framed as coordination. But the convention is explicit: "zero Prisma client calls" in the service. So I'll put the transaction helper on PrismaService (infrastructure, not a business service). The feature service treats it as a unit-of-work token. This is a defensible reading; I'll add an `// ASSUMPTION` comment noting that transaction coordination lives on the infrastructure PrismaService so that the business service never calls the Prisma client for data.

Actually wait — a simpler alternative: the write service could have a `write-transaction.repository.ts`… no, that's silly. PrismaService with a `transaction` method is fine.

**How the hook works:**

Write services:
1. `orders` feature: create order, approve order, reject order, set disputed? Keep it minimal but enough: `create`, `approve`, `mark-disputed`? The problem statement mentions approving. What I'll implement: `OrderService.createOrder`, `OrderService.approveOrder`, `OrderService.updateOrder` (worker reassignment?) — hmm, "simulate the write path so this can be verified" — what's needed: an approve transition (status change that moves the total), and possibly a worker change (denormalized worker_name change). What I'll include: create, approve, assign/reassign worker.

2. `events` feature: record an event on an order (worker events, e.g. "field_visit", "status_note"). This updates `latest_event_*` on the projection.

Each write goes through: source row mutation + projection maintenance in the same transaction. The projection maintenance function is shared: an `operations` feature `projection-maintenance` service? But the service has zero Prisma calls — it calls `ProjectionRepository` (the `operations` feature's repository). Cross-module: the `orders` module imports the `OperationsModule` (which exports `OperationsProjectionService` + `OperationsProjectionRepository`). Hmm — "a provider used by other modules is `exports`ed from its own module and that module is `imports`ed in the other."

Wait, but there's a subtlety: the maintenance hook needs the tx handle. So `OperationsProjectionService.applyOrderChange(tx, snapshot)` and `applyEvent(tx, snapshot)`. The write service does:

```ts
await this.prisma.transaction(async (tx) => {
  const order = await this.ordersRepo.approve(id, tx);
  await this.projection.applyOrderChange(tx, order);
});
```

Hmm wait, but PrismaService is provided by… let's make a `database` module, or just provide `PrismaService` in `AppModule` as global? Standard NestJS Prisma integration: `PrismaModule` that exports `PrismaService`, or a global provider. To keep wiring explicit per the convention, I'll create `src/database/database.module.ts` + `src/database/prisma.service.ts` and import it into each feature module.

**Projection tables:**

```sql
CREATE TABLE operation_rows (
  payment_order_id uuid PRIMARY KEY REFERENCES payment_orders(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  status text NOT NULL,
  worker_name text NOT NULL,
  amount_cents bigint NOT NULL,
  currency char(3) NOT NULL,
  latest_event_type text,
  latest_event_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX operation_rows_company_status_updated_idx
  ON operation_rows (company_id, status, updated_at DESC)
  INCLUDE (payment_order_id, worker_name, amount_cents, currency, latest_event_type, latest_event_at, created_at);
```

Covering index for the filter (company, status) + sort (updated_at desc) + page (id for tiebreak?) + all the SELECTed columns.

Pagination: "same page size" — use offset pagination (LIMIT/OFFSET) or cursor? Original: "filter by company, status, date range, sort by recency, paginate." Simplest: offset pagination. With a covering index, offset pagination is fine enough; tiebreak on `payment_order_id` for determinism. I'll use `(updated_at DESC, payment_order_id DESC)`.

Date range filter: filter `created_at` between from/to (order's creation date). Add to the index? The access pattern is filter by company AND status, date range, sort by recency. A single covering index `(company_id, status, updated_at DESC) INCLUDE (...)` handles the company+status+sort case; the date range becomes a filter on the covered columns — but then we'd need created_at in INCLUDE, which we already have. Scanning: index seek on (company_id, status), traverse in updated_at desc, filter created_at within range, stop at limit. Good.

Totals table:

```sql
CREATE TABLE company_financial_totals (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  approved_amount_cents bigint NOT NULL DEFAULT 0,
  disputed_amount_cents bigint NOT NULL DEFAULT 0,
  cancelled_amount_cents bigint NOT NULL DEFAULT 0,
  approved_count int NOT NULL DEFAULT 0,
  disputed_count int NOT NULL DEFAULT 0,
  cancelled_count int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL
);
```

Atomic: `UPDATE company_financial_totals SET approved_amount_cents = approved_amount_cents + $1, ... WHERE company_id = $2` — in-place increment, no read-modify-write. And ensure the row exists (`upsert` with `onConflictDoUpdate: { update: { approved_amount_cents: { increment } ... } }` — note: Prisma supports `increment` inside upsert's `onConflictDoUpdate` — yes, Prisma supports arithmetic in upsert's update clause since 4.x? Actually, does Prisma's `upsert` support field updates with operators? Hmm. Prisma's `upsert` `onConflictDoUpdate: { update: { approvedAmountCents: { increment: x } } }` — yes, Prisma has supported this since v3? Let me think. Prisma docs: "You can use update operators inside an upsert" — I believe `onConflictDoUpdate: { update: { views: { increment: 1 } } }` is supported (docs show `count: { increment: 1 }` inside upsert). Yes, Prisma supports arithmetic filters inside upsert's onConflictDoUpdate.update. Good.

But wait — the repository is the only layer that touches the DB, and Prisma is the ORM; is raw SQL forbidden everywhere ("the service has zero raw SQL"; the repository presumably uses the Prisma client). Drift repair and re-derivation need set-based SQL (rebuilding a window via a source join). Prisma can't easily express the `INSERT ... SELECT ... ON CONFLICT ... DO UPDATE` for re-derivation. So we need raw SQL in the repository. The convention says the service has "zero raw SQL" — implying the repository can use `prisma.$executeRaw` / `$queryRaw`. Yes, that's standard: raw SQL lives in the repository only. I'll use tagged-template `$queryRaw`/`$executeRaw` in the projection repository for the re-derivation and drift scan. That's defensible.

Alternatively I could do re-derivation in app code with loops — bad at 3M scale, and the task says "rebuild the projection over a date range from the source tables" — a single set-based SQL statement is the right approach. I'll use raw SQL in the repository.

**Re-derivation routine** (`rederive(windowFrom, windowTo)`):
- Rebuild `operation_rows` for orders with `created_at` (or updated?) in the window. Hmm — "rebuild the projection over a date range from the source tables". Which window key? The order's `created_at`. But the status of orders created in the window could change later… Re-derivation should recompute the row's current state (current status, latest event) for all orders whose created_at is in the window — regardless of when they were last updated. That's a clean definition: window over `payment_orders.created_at`. Idempotent: `INSERT ... SELECT ... ON CONFLICT (payment_order_id) DO UPDATE SET ...` — running twice gives the same result. Safe when live: run inside a transaction (snapshot isolation; concurrent writes during the run are either included or not, but subsequent hook updates after commit fix state; a full-window rebuild converges to whatever was committed at snapshot time + subsequent hook writes).

Latest event per order: `(SELECT ... FROM events WHERE events.payment_order_id = o.id ORDER BY events.occurred_at DESC, events.id LIMIT 1)` or `DISTINCT ON`. In Postgres: `DISTINCT ON (payment_order_id) SELECT payment_order_id, event_type, occurred_at FROM events ORDER BY payment_order_id, occurred_at DESC, id DESC`. And a lateral join.

Re-derivation of totals: totals must be recomputed from the current state of all orders — hmm, the totals window issue: totals are aggregates over all orders (not just the window). If I re-derive totals only over the window's orders, I get partial totals. Options: (a) re-derive totals globally: recompute `company_financial_totals` = SELECT company_id, sum... GROUP BY company from payment_orders — full recompute, safe and idempotent, and simple; at 3M rows a GROUP BY over 3M rows is a few seconds to a minute — acceptable for a maintenance routine. (b) derive totals deltas per window. For the correctness of "exact" totals, full recompute is cleaner and idempotent. I'll do: re-derivation re-derives `operation_rows` over the window AND recomputes `company_financial_totals` from scratch (full, idempotent). Documented: totals are global, so recomputed as a whole; operation_rows is per window.

Wait, but should re-derivation also recompute totals? The spec says "a routine that rebuilds the projection over a date range from the source tables". Totals are part of the projection. Full recomputation of totals is the safe idempotent choice. I'll do both in one transaction.

**Drift repair job**:
- Compare projection vs source over a recent window (e.g. last N hours).
- Find mismatches: rows in the source (orders in the window) that don't match the projection row (or are missing).
- Repair: re-derive those (windowed re-derivation is the repair mechanism — "repair the mismatches").
- Also drift in totals: compare totals against source aggregates; if mismatch, recompute totals.

Implementation: `drift-repair.service.ts` with a `@Cron` job (NestJS `@nestjs/schedule`) or a `@Interval`. "Scheduled drift repair job" — use `@nestjs/schedule`'s `@Cron(CronExpression.EVERY_...)` or a simple `@Interval(300_000)`. The convention says the stack is NestJS; `@nestjs/schedule` is the standard scheduler. I'll add it as a dependency (list it in a file? no, package.json isn't required… the task says deliver all files the solution needs — should I include package.json? The existing codebase isn't given (only a read-only reference for the problem statement). So I'm building from scratch: I need package.json, tsconfig, prisma schema, migrations, src files, test files. Hmm — "deliver all files the solution needs, complete, from first line to last." Since no codebase is given, I should deliver a complete project: package.json, tsconfig.json, prisma/schema.prisma, prisma/migrations/... (SQL migration), src/main.ts, src/app.module.ts, feature files, test files, DESIGN.md.

Migrations: "every schema change ships with a migration." So I need `prisma/migrations/<timestamp>_init/migration.sql` containing the DDL (including the projection tables and indexes). The schema.prisma has all models. The migration SQL should match what Prisma would generate (including my custom indexes via `@@index` / `@@index` with `INCLUDE`? Prisma doesn't support `INCLUDE` columns. Hmm! Prisma has no covering-index support. So the DDL for the covering index has to come from the migration SQL… but "every schema change ships with a migration" and Prisma migration is generated from the schema. If the migration is hand-written (which is acceptable; it's a .sql file), I can put the Prisma-style base DDL plus the covering-index DDL. Prisma migrate would warn about drift, but I'm delivering a hand-written migration that also updates the `prisma/migrations/migration_lock.toml`. In the hand-written migration, I can create the exact covering index. And in schema.prisma, I declare a standard index (company_id, status, updated_at) so Prisma's model reflects it; the migration also contains the INCLUDE variant. Hmm — that creates a mismatch between schema.prisma and the actual DB (Prisma would drop/keep?).

The simplest defensible approach: the migration SQL is authoritative and hand-written. It creates the tables and the covering index. schema.prisma declares the indexes Prisma knows about. For the covering index, I'll write it as a `@@index([companyId, status, updatedAt(sort: SortOrder.DESC)])` in the schema, and in the migration create the index with INCLUDE columns. The Prisma schema index and the physical index have the same columns/prefix — Prisma might consider them identical (Prisma compares by column list; extra INCLUDE columns aren't visible to Prisma and are tolerated? Actually Prisma migrate diff compares index columns; INCLUDE-only columns are ignored in the comparison, so it's fine — the index "exists" from Prisma's perspective).

Alternatively, to reduce the risk of subtle drift, I'll write a migration that matches what `prisma migrate dev` would emit for the schema.prisma plus the `INCLUDE` clause on the main index. I'll name the index explicitly with `@@index([...], map: "operation_rows_company_status_updated_idx")` and write the migration with the same name and INCLUDE.

Let me design the models:

```prisma
model Company {
  id        String   @id @default(uuid()) @db.Uuid
  name      String
  createdAt DateTime @default(now()) @map("created_at")
  orders    PaymentOrder[]
  totals    CompanyFinancialTotals?
  @@map("companies")
}

model Worker {
  id        String   @id @default(uuid()) @db.Uuid
  name      String
  company?  -- worker belongs to company? The operations list joins workers. Worker has a name. Let's give workers a company_id (a worker employed by a company) — plausible. Keep: companyId.
  createdAt DateTime @default(now()) @map("created_at")
  orders    PaymentOrder[]
  @@map("workers")
}

model PaymentOrder {
  id         String    @id @default(uuid()) @db.Uuid
  companyId  String    @map("company_id") @db.Uuid
  workerId   String    @map("worker_id") @db.Uuid
  status     OrderStatus @default(pending)
  amountCents Int @map("amount_cents")
  currency   String  @db.Char(3)
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")
  events     Event[]
  company    Company @relation(...)
  worker     Worker @relation(...)
  @@map("payment_orders")
}

enum OrderStatus { pending approved disputed cancelled } // enum in Postgres

model Event {
  id            String   @id @default(uuid()) @db.Uuid
  paymentOrderId String  @map("payment_order_id") @db.Uuid
  type          String   // e.g. "approved", "field_visit"
  note          String?
  occurredAt    DateTime @map("occurred_at")
  createdAt     DateTime @default(now()) @map("created_at")
  paymentOrder  PaymentOrder @relation(...)
  @@index([paymentOrderId, occurredAt])
  @@map("events")
}

model OperationRow {
  paymentOrderId  String  @id @map("payment_order_id") @db.Uuid
  companyId       String  @map("company_id") @db.Uuid
  status          OrderStatus
  workerName      String  @map("worker_name")
  amountCents     Int     @map("amount_cents")
  currency        String  @db.Char(3)
  latestEventType String? @map("latest_event_type")
  latestEventAt   DateTime? @map("latest_event_at")
  createdAt       DateTime @map("created_at")
  updatedAt       DateTime @map("updated_at")
  @@index([companyId, status, updatedAt(sort: SortOrder.DESC)], map: "operation_rows_company_status_updated_idx")
  @@map("operation_rows")
}

model CompanyFinancialTotals {
  companyId           String  @id @map("company_id") @db.Uuid
  pendingAmountCents  BigInt  @default(0) @map("pending_amount_cents")
  approvedAmountCents BigInt  @default(0) @map("approved_amount_cents")
  disputedAmountCents BigInt  @default(0) @map("disputed_amount_cents")
  cancelledAmountCents BigInt @default(0) @map("cancelled_amount_cents")
  pendingCount        Int     @default(0) @map("pending_count")
  approvedCount       Int     @default(0) @map("approved_count")
  disputedCount       Int     @default(0) @map("disputed_count")
  cancelledCount      Int     @default(0) @map("cancelled_count")
  updatedAt           DateTime @map("updated_at")
  company Company @relation(...)
  @@map("company_financial_totals")
}
```

The BigInt on amount cents: 3M orders × amounts — a company total can exceed int range at scale. Use BigInt. JSON serialization of BigInt in Nest — the controller returns a DTO; BigInt can't be JSON.stringified. Convert to a number or a string in the DTO. I'll map in the service to `{ value: String(...) }` or Number if it's safe. Simplest: `amount_cents` on the order is `Int` (fits int? 2^31 cents = $10M per order — fine), and the total is BigInt; the service converts the total to a string for JSON: `{ approvedAmountCents: totals.approvedAmountCents.toString() }`. Hmm, "no changes to what the operator sees" — the original dashboard showed the total as a number. In JSON I'll output as number if it fits, else… I'll output as a plain string. Actually, to keep the API simple, I'll output the total as a number in the JSON (Number(bigint)) — safe in tests; at realistic finance scale, BigInt→Number loses precision above 2^53 cents (~$90 trillion) — irrelevant. But the purist: emit a string. I'll emit a string and note it. Hmm, the original dashboard: unknown shape. I'll emit cents as a number in row DTO (amountCents is Int → number, fine) and string for total? Inconsistent. Let me keep the total as a BigInt in the DB and serialize as a number in the response (Number). At this task scale it's fine; I'll note that in DESIGN? Not worth it. Actually, Prisma returns BigInt for BigInt columns; `JSON.stringify(BigInt)` throws. So I must convert. I'll convert to `Number` in the DTO mapper. Decision.

**Features/modules:**

- `src/database/prisma.service.ts` — PrismaClient wrapper, onModuleInit, `transaction()` helper.
- `src/database/database.module.ts` — provides/exports PrismaService.
- `src/companies/companies...` — needed? The write path "simulates" the writes to orders/events. A company feature isn't strictly needed. I'll seed companies/workers in a test seed helper. But a controller for listing companies? Not needed. Keep it minimal: `orders` feature (create/approve/dispute/reassign), `events` feature (record event), `operations` feature (dashboard read + projection maintenance + re-derivation + drift repair).

Wait — the layers: the maintenance hook is "called from the write service". The write service (OrderService) depends on the projection maintainer in the operations feature. The `OperationsProjectionService` (business logic: computes the new row state, calls the repository). Exported from `OperationsModule`. `OrdersModule` and `EventsModule` import `OperationsModule`.

But there's a subtlety: does OrderService's logic belong in the orders feature and also write the projection via the operations feature's service? Yes — that's the hook.

**Dashboard query** (in operations feature):
- GET `/operations?companyId=&status=&from=&to=&page=&pageSize=` → `{ items: OperationDto[], total? , page, pageSize }`. "Same filters, same ordering, same page size" — I'll implement page/pageSize with offset. Include `total`? A COUNT over the covering index — cheap enough; but "dashboard query only touches the projection" — count also touches only the projection. I'll include count for the pager (typical dashboard). Fine.

- GET `/operations/totals?companyId=` → the company's totals. The dashboard shows "per-company financial totals" — probably the same list page includes a totals block. I'll add a `GET /companies/:companyId/financial-totals` endpoint under operations? The kebab-case plural endpoint convention: `GET /companies/:companyId/totals/financial`? Hmm. Let me define: `GET /operations` (list) and `GET /companies/:id/financial-totals`. Fine.

**Controller validation**: use class-validator? Adds a dependency; acceptable. Or manual validation throwing BadRequest. To keep it lean (no need to enumerate extra dependencies), I'll do light manual validation in the controller (parse int, parse date, check UUID) and throw `BadRequestException`. The convention has the error envelope: a global exception filter that maps `HttpException`s to `{ error: { code, message, details } }`. I'll need:
- `resource_not_found` (404)
- `validation_failed` (400) — details contains field errors
- `conflict` for approve on non-pending? (409)
- `internal_error` (500) fallback.

A `src/common/errors.exception-filter.ts` and an error-code enum. `src/common/` isn't in the convention's layout but the layout is a guide; extra shared files are fine. Actually, the layout shows specific paths per feature; shared infrastructure files are implicitly allowed ("decide file layout yourself" — the task says "decide file layout yourself. Nothing here dictates it." — wait, that's the general instruction: "decide file layout yourself" — but the convention shows a layout… the convention's layout is a generic template. I'll follow it and add `src/common/*` for the filter + error codes.

Hmm wait, re-reading: "decide file layout yourself. Nothing here dictates it." — this slightly contradicts the convention's layout block. I'll follow the convention's layout where it applies (feature folders) and place shared files in `src/common`.

**Tests** (Vitest):
1. Read-your-own-writes: create an order → it shows up on the dashboard (pending). Approve → the next dashboard request shows approved, and the totals reflect the approval. Verify the transaction: also verify that a rolled-back write doesn't update the projection? The spec's acceptance: "Approve an order → the next dashboard request reflects it, no delay." Test: via the service (or HTTP? service-level is enough and faster; but "behavior" — I can test via the controller? Nest app boot in vitest needs supertest. Simpler: test the service directly — behavior-level (input → read result). I'll test the service.

For DB-dependent tests I need a real Postgres. The environment variable `DATABASE_URL`. Tests run against a test DB. I can't run it here; I'll write tests that use `process.env.DATABASE_URL` and assume a live Postgres (documented). Provide a `test/helpers` that creates the schema? A migration can be run manually. I'll write tests that assume the schema is already applied (via prisma migrate) — or have the test setup run `prisma db push`? Can't execSync without a filesystem… tests can use `prisma` client; schema setup is a manual step. I'll include a `test/setup` that verifies DB availability and seeds minimal companies/workers (idempotent, unique per run: create new companies/workers per test run — avoiding global state).

2. Concurrent totals: two concurrent approvals on the same company's orders → the total increases by both; and specifically test the atomic increment: call `projectionRepo.applyOrderChange` (or an OrderService.approve) for two different orders of the same company concurrently via `Promise.all` → the total is exact. Also a stress version: N parallel approvals, total = sum. "Prove in a test that runs the two concurrently, not sequentially." `Promise.all([approve(a), approve(b)])`.

To make concurrency meaningful (not serialized by a single connection), use separate transactions — each approve has its own transaction; Postgres row locks will serialize the `UPDATE ... SET x = x + 1` — both increments are preserved. A read-modify-write would lose one. Good.

3. Drift repair: inject drift (directly update the projection row via the repository/Prisma — simulate corruption: set the row's status to the wrong value, corrupt the total), run the drift-repair job → the projection matches the source again. And "run re-derivation twice → same result": re-derive window twice, snapshot the rows, compare equality.

Also "re-derive window → projection matches source."

Tests should "assert behavior, not implementation" and have real assertions (row values, totals, not just "it was called").

**Scheduled drift repair job**: `@Cron` from `@nestjs/schedule` in `DriftRepairService`, `@Module` with `ScheduleModule.forRoot()` in the app module. The cron default is every 5 minutes, configurable via an env `DRIFT_REPAIR_INTERVAL_MS`? The env is the only config source: `DRIFT_REPAIR_WINDOW_HOURS` (default 24), cron from an env or a fixed expression. I'll use `@Cron(process.env.DRIFT_REPAIR_CRON ?? '*/5 * * * *')` — hmm, the decorator argument must be a compile-time expression; env at module load time is fine.

**Re-derivation trigger**: also expose an admin endpoint? `POST /operations/rederive?from=&to=`? The deliverable is "a re-derivation routine" — a service method is enough; an endpoint is a bonus. I'll add an admin endpoint to make it operational (and testable via HTTP). Keep it: `POST /operations/rederive` with a from/to body. And the drift-repair job uses the same windowed re-derivation for the mismatched window.

**Shape of the maintenance hook:**

`OperationsProjectionService`:
- `applyOrderChange(tx, order: OrderSnapshot)`: upsert the operation_row (row's fields: company, status, worker name, amount, currency, created_at, updated_at; latest_event unchanged) and adjust the company totals: decrement the old status bucket and increment the new status bucket. To know the old status, the hook needs the before/after. Design: the write repository returns the changed row; the service passes `{ before: orderBefore, after: orderAfter }`? Or does the projection read the current operation_row's status inside the tx (read-your-own state — since it's the same tx, it sees prior updates). Simplest and correct: in `applyOrderChange`, read the existing operation_row; compute delta from the existing row's status → the new status; atomically apply delta totals. If no row: insert the row, add to the new bucket. All within tx → consistent.

But note: the row's `worker_name` is denormalized from the Worker table — the hook needs the worker name: the write service fetches the worker (ordersRepo.approve returns the order including worker? Prisma's include). To avoid extra Prisma calls, the hook's repository SQL can do a subselect of the worker name in the upsert: `worker_name = (SELECT name FROM workers WHERE id = ...)`? For raw-SQL upserts, that's easy and keeps it set-based. Since I'm already using raw SQL for the projection writes (atomic increments), I'll implement `applyOrderChange` as a single raw SQL:

```sql
WITH row AS (
  INSERT INTO operation_rows (payment_order_id, company_id, status, worker_name, amount_cents, currency, latest_event_type, latest_event_at, created_at, updated_at)
  VALUES ($1, $2, $3, (SELECT name FROM workers WHERE id=$4), $5, $6, COALESCE($7,$20?), ...)
  ON CONFLICT (payment_order_id) DO UPDATE SET
    company_id = excluded.company_id,
    status = excluded.status,
    worker_name = excluded.worker_name,
    amount_cents = excluded.amount_cents,
    currency = excluded.currency,
    updated_at = excluded.updated_at
  RETURNING status
),
prev AS (
  SELECT current.status FROM operation_rows current WHERE current.payment_order_id = $1  -- hmm, after upsert, current is the new status
)
```

To get the old status before the upsert, I need to read before the update. In a single statement: use a CTE:

```sql
WITH prev AS (
  SELECT status, company_id FROM operation_rows WHERE payment_order_id = $1
)
INSERT INTO operation_rows (...) VALUES (...)
ON CONFLICT (payment_order_id) DO UPDATE SET ...
```

A CTE's `prev` is evaluated as of statement start (in the same snapshot) — yes, a data-modifying CTE and a leading CTE: a leading `WITH prev AS (SELECT ...)` captures the pre-statement state. Then a second statement (or the same multi-statement) for the totals:

```sql
UPDATE company_financial_totals
SET <old_bucket> = <old_bucket> - 1/amt, <new_bucket> = <new_bucket> + 1/amt
WHERE company_id = $2
```

But the row might not exist (prev is null) → no decrement. And the row might not exist in the totals table → need to upsert the totals row with defaults. Combine:

Statement 1: upsert operation_rows (raw SQL, single statement).
Statement 2: `INSERT INTO company_financial_totals (company_id, <new_bucket>) VALUES ($c, <delta>) ON CONFLICT (company_id) DO UPDATE SET <new_bucket> = cft.<new_bucket> + $deltaNew, <old_bucket> = GREATEST? ...` — hmm, if the row didn't exist, the old-bucket decrement should be 0 (no row existed → nothing was counted before). But `ON CONFLICT DO UPDATE` fires only if the row existed; the INSERT branch handles the missing row with only the new delta. Two different logics in one statement is possible:

```sql
INSERT INTO company_financial_totals (company_id, approved_amount_cents, approved_count, updated_at)
VALUES ($1, $2, $3, now())
ON CONFLICT (company_id) DO UPDATE SET
  approved_amount_cents = company_financial_totals.approved_amount_cents + $2,
  approved_count = company_financial_totals.approved_count + $3,
  pending_amount_cents = company_financial_totals.pending_amount_cents - $4,
  pending_count = company_financial_totals.pending_count - $5,
  updated_at = now();
```

Where $2/$3 = the new-bucket delta (always ≥ 0 on transitions), $4/$5 = the old-bucket decrement (0 if there was no prev row). The INSERT branch (no prev totals row) applies only the new delta — consistent with "no prev operation row"? Edge case: the operation_row existed (status pending) but the totals row is missing (drift!). In that case, the prev status = pending exists → we pass $4=amt; the INSERT branch ignores it → totals become correct? The row was pending but the totals row is missing means the totals were undercounted already; after the fix, the totals reflect only the approved portion — still drifted from the source (missing the other pending orders). Drift repair will fix it. Acceptable; I'll document that the totals upsert assumes totals row presence when the operation row exists (drift-repair converges).

Hmm, this two-statement approach with the prev-status logic in the app: I can also read the prev operation_row in Prisma (a repository method) and compute the delta in the service (business logic — good, the logic stays in the service layer!), and the repository executes the two atomic statements with explicit deltas.

Even better: `OperationsProjectionService.applyOrderChange(tx, { order })`:
1. `const prev = await this.projectionRepo.findOperationRow(tx, orderId)` (repository, same tx).
2. Compute `oldStatus = prev?.status ?? null`, the delta map.
3. `await this.projectionRepo.upsertOperationRow(tx, snapshot)` — raw SQL upsert that pulls the worker name from the workers table (single statement, atomic).
4. `await this.projectionRepo.applyTotalsDelta(tx, companyId, { fromStatus: oldStatus, toStatus, amountCents })` — a single raw SQL INSERT...ON CONFLICT with the `+`/`-` expressions → atomic in-place increment. No read-modify-write. ✓

Same for `applyEvent(tx, event)`: update operation_rows' `latest_event_type/at` if the event is newer than the current one:

```sql
UPDATE operation_rows
SET latest_event_type = $2, latest_event_at = $3, updated_at = $4
WHERE payment_order_id = $1 AND (latest_event_at IS NULL OR $3 > latest_event_at)
```

Hmm, event ordering: `occurred_at`, then `id`? I'll use `occurred_at DESC, id DESC` as the latest ordering. To be precise in SQL: only set if the new event's (occurred_at, id) is greater than the current's (occurred_at, id):

```sql
UPDATE operation_rows r
SET latest_event_type = e.event_type, latest_event_at = e.occurred_at
WHERE r.payment_order_id = $1
  AND (r.latest_event_at IS NULL OR (e.occurred_at, e.id) > (r.latest_event_at, r.some_id?) ...)
```

No id column for the event on the operation row. Simplest: compare `occurred_at` only, treating ties as "replace if id is greater" — but the row doesn't store the event id. Add an `latest_event_id` column on operation_rows for exact tiebreaks. That's clean: `latest_event_id uuid?`. And the condition: `(r.latest_event_id IS NULL) OR (e.occurred_at, e.id) > (r.latest_event_at, r.latest_event_id)`. Good, deterministic.

Does an event change `updated_at` (recency)? Recency sort — the operations list sorts by "recency". Which timestamp? Probably the order's `updated_at` (when the order last changed) — the event is activity on the order; a new event should probably bump the order's recency? Hmm. In the source join, the order is updated on event record (in a real app). To be safe and simple: an event does NOT bump the row's `updated_at` (the row's updated_at = the order's updated_at, only updated when the order itself changes). Wait, but then a new field-visit event doesn't surface the order at the top. In the original join query, what would it sort by? "Sort by recency" — the order's updated_at is the natural choice. Events are history; the order row's recency = the order's last change. I'll define: the row's `updated_at` mirrors `payment_orders.updated_at`; the event hook only updates the latest-event fields (and doesn't touch updated_at). Documented in DESIGN.md as a read-model contract. Hmm, but "operators see their own writes" — an approved order must be visible; the event is auxiliary. OK.

Actually wait — should I also record an `approved` event when approving? The write service `approveOrder` can record an event `type='approved'` in the same tx (via the events feature's service? Cross-feature call). This exercises the event hook too. Let me keep the write path: `OrderService.approveOrder` → in tx: `ordersRepo.approve` (status → approved, set approvedAt? just status + updatedAt), `projection.applyOrderChange`, and optionally record the audit event: `eventsRepo.record(tx, {orderId, type:'approved', occurredAt: now})` + `projection.applyEvent`. This makes the "join of payment orders, events, workers" projection meaningful. I'll include it.

**Orders repository** (raw Prisma client calls — allowed in the repository):
- `create(tx, input)`: prisma.paymentOrder.create, maybe include worker.
- `get(id, tx)`.
- `approve(id, tx)`: `update` where id AND status='pending', returning the row; throw if no rows → NotFound/Conflict. Use `updateMany` for a race-safe transition? Two concurrent approvals of the same order — the second should conflict, not double-move the total. `updateMany({ where: { id, status: 'pending' } })` → count 0 → throw conflict. Then fetch the row. Good, atomic transition.
- `assignWorker(id, workerId, tx)` similar.
- `recordEvent` in the events repository: `create`.

**Status enum**: pending, approved, disputed, cancelled. Approve: pending→approved. Dispute: pending→disputed? Or approved→disputed? Keep: dispute from pending or approved? Totals: bucket per status; a transition moves the delta between buckets regardless of the allowed source, but only allowed sources can be the trigger: `approve` (pending→approved), `dispute` (pending|approved→disputed)? I'll stick with: dispute from pending or approved. `cancel` from pending. Enough for simulation.

**Drift-repair service**:
`runDriftRepair()`:
1. window = [now - WINDOW_HOURS, now].
2. `const drift = await repo.findDriftedOrders(tx, from, to)` — raw SQL: orders in the window that don't match the operation_row (status, worker, amount, latest event) or are missing. Returns order IDs (or the whole set).
3. If any: re-derive the window (windowed re-derivation rebuilds all rows in the window from the source — idempotent, fixes everything in the window).
4. Totals drift: `repo.totalsDrifted(from?)` — compare `company_financial_totals` vs a GROUP BY of payment_orders for companies whose orders changed in the window (or all companies — 3M scale: GROUP BY over all orders for drift check is heavy; limit to companies with orders in the window; still, their totals are global. The comparison for those companies requires the global aggregate per company — `SELECT company_id, sum... FROM payment_orders WHERE company_id IN (...) GROUP BY 1` — fine for a limited company set).
5. If totals are drifted → recompute totals globally (idempotent, single transaction).
6. Return a report `{ windowDriftedOrders: n, totalsRepaired: bool }` (log via Logger).

Cron: `@Cron(CRON, { timeZone })`. Use env `DRIFT_REPAIR_CRON`, default `'*/5 * * * *'`.

Wait — the drift check "compare projection vs source over a recent window" — my findDriftedOrders compares per row. The fix re-derives the window (superset of the fix — fine, idempotent, safe live).

**Re-derivation SQL** (the core):

```sql
WITH latest_event AS (
  SELECT DISTINCT ON (payment_order_id)
    payment_order_id, event_type, occurred_at, id
  FROM events
  ORDER BY payment_order_id, occurred_at DESC, id DESC
),
rows AS (
  SELECT
    o.id AS payment_order_id,
    o.company_id,
    o.status,
    w.name AS worker_name,
    o.amount_cents,
    o.currency,
    le.event_type AS latest_event_type,
    le.occurred_at AS latest_event_at,
    le.id AS latest_event_id,
    o.created_at,
    o.updated_at
  FROM payment_orders o
  JOIN workers w ON w.id = o.worker_id
  LEFT JOIN latest_event le ON le.payment_order_id = o.id
  WHERE o.created_at >= $1 AND o.created_at < $2
)
INSERT INTO operation_rows (payment_order_id, company_id, status, worker_name, amount_cents, currency, latest_event_type, latest_event_at, latest_event_id, created_at, updated_at)
SELECT * FROM rows
ON CONFLICT (payment_order_id) DO UPDATE SET
  company_id = excluded.company_id,
  status = excluded.status,
  worker_name = excluded.worker_name,
  amount_cents = excluded.amount_cents,
  currency = excluded.currency,
  latest_event_type = excluded.latest_event_type,
  latest_event_at = excluded.latest_event_at,
  latest_event_id = excluded.latest_event_id,
  created_at = excluded.created_at,
  updated_at = excluded.updated_at;
```

Hmm, `SELECT *` with the column list — the order of CTE columns must match; to be safe I'll write explicit column names.

Note: `latest_event` CTE scans all events (not just the window) — needed because the latest event for an order in the window could be outside the window… well, events happen after order creation, possibly after the window end (a live run: events after the window end but before the snapshot). For correctness, the latest event can be any time ≥ the order's creation; I can bound events with `occurred_at >= $1` (an order created in the window has its events after that). I'll add the `WHERE occurred_at >= $1` filter — a slight optimization, still correct (events before order creation are anomalous; the bound is `occurred_at >= windowFrom` and windowFrom ≤ order.created_at ≤ any legitimate event). Fine.

Totals recompute:

```sql
WITH agg AS (
  SELECT company_id,
    SUM(amount_cents) FILTER (WHERE status='pending')    AS pending_amount_cents,
    COUNT(*)        FILTER (WHERE status='pending')      AS pending_count,
    ... approved, disputed, cancelled ...
  FROM payment_orders GROUP BY company_id
),
upserted AS (
  INSERT INTO company_financial_totals (company_id, pending_amount_cents, pending_count, approved_amount_cents, approved_count, disputed_amount_cents, disputed_count, cancelled_amount_cents, cancelled_count, updated_at)
  SELECT company_id, COALESCE(pending_amount_cents,0), ..., now() FROM agg
  ON CONFLICT (company_id) DO UPDATE SET pending_amount_cents = agg... 
)
-- Delete totals rows for companies that no longer exist / have no orders
DELETE FROM company_financial_totals cft WHERE NOT EXISTS (SELECT 1 FROM companies c WHERE c.id = cft.company_id) OR cft.company_id NOT IN (SELECT company_id FROM payment_orders);
```

Careful about referencing CTE columns in the ON CONFLICT DO UPDATE — you can reference the source CTE via the alias: `ON CONFLICT ... DO UPDATE SET pending_amount_cents = agg.pending_amount_cents` — wait, in INSERT...SELECT, the DO UPDATE can reference the `excluded` pseudo-row. Yes, `excluded` is available. Use excluded.

Raw SQL with `FILTER (WHERE ...)` in Prisma `$executeRaw` — fine (Postgres).

**Drift check SQL** (mismatched orders in the window):

```sql
SELECT o.id
FROM payment_orders o
JOIN workers w ON w.id = o.worker_id
LEFT JOIN operation_rows r ON r.payment_order_id = o.id
LEFT JOIN latest_event le ON le.payment_order_id = o.id
WHERE o.created_at >= $1 AND o.created_at < $2
  AND (
    r.id IS NULL
    OR r.status IS DISTINCT FROM o.status
    OR r.company_id IS DISTINCT FROM o.company_id
    OR r.worker_name IS DISTINCT FROM w.name
    OR r.amount_cents IS DISTINCT FROM o.amount_cents
    OR r.currency IS DISTINCT FROM o.currency
    OR r.latest_event_id IS DISTINCT FROM le.id   -- null-safe
  );
```

`IS DISTINCT FROM` handles nulls.

Totals drift check:

```sql
SELECT t.company_id
FROM company_financial_totals t
WHERE t.company_id IN (SELECT DISTINCT company_id FROM payment_orders WHERE created_at >= $1 AND created_at < $2)
  AND EXISTS (
    SELECT 1 FROM (
      SELECT company_id,
             COALESCE(SUM(amount_cents) FILTER (WHERE status='approved'),0) AS a_amt,
             COUNT(*) FILTER (WHERE status='approved') AS a_cnt,
             ... all four
      FROM payment_orders WHERE company_id = t.company_id GROUP BY company_id
    ) s
    WHERE s.a_amt IS DISTINCT FROM t.approved_amount_cents OR ...
  );
```

OK. All inside the repository.

**Now the transaction helper**: `PrismaService.transaction<T>(fn: (tx: PrismaTransactionClient) => Promise<T>): Promise<T>` → `this.$transaction(fn)`. The feature service: `await this.prisma.transaction(async (tx) => {...})`.

Repository methods take `tx: Prisma.TransactionClient` as the first parameter (I'll skip the optionality — all writes are inside a tx; reads for the dashboard can just use the plain client… the dashboard query: `prisma.operationRow.findMany` via the repository without tx). For consistency, repository methods: read methods without tx (use `this.prisma`), write methods with a tx parameter. Hmm, but `applyOrderChange` reads the prev row inside the tx → the repository method `findOperationRow(tx, id)` uses tx. OK.

Type import: `import { Prisma } from '@prisma/client'` — type of tx: `Prisma.TransactionClient`.

**Error envelope**: global filter:

```ts
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  catch(exception, host) {
    // map HttpException → { status, body: { error: { code, message, details } } }
  }
}
```

Codes: `resource_not_found`, `validation_failed`, `conflict`, `internal_error`. Service throws `NotFoundException('...')` with a custom code? To carry the code, I'll create small error classes in `src/common/errors.ts`:

```ts
export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details: Record<string, unknown> = {})
}
export class NotFoundError extends AppError { status=404, code='resource_not_found' }
export class ValidationError extends AppError { 400, 'validation_failed' }
export class ConflictError extends AppError { 409, 'conflict' }
```

The filter catches AppError and HttpException (fallback to map to codes: 404→resource_not_found, 400→validation_failed, 409→conflict, else internal_error). `main.ts`: `app.useGlobalFilters(new ErrorEnvelopeFilter())`.

**Controllers**:

`OperationsController`:
- `GET /operations` — query: companyId (uuid, required?), status, from, to, page, pageSize. The original dashboard "filters by company, status, and date range" — company is likely required (per-company view)? "Filter by company" — accept optional company (with defaults). Keep all optional with sensible defaults: pageSize default 20, max 100; page ≥1; from<to; status in the enum.
- `GET /companies/:companyId/financial-totals`
- `POST /operations/rederive` — body {from, to} (admin).

`OrdersController`:
- `POST /orders` {companyId, workerId, amountCents, currency}
- `POST /orders/:id/approve`
- `POST /orders/:id/dispute`
- `POST /orders/:id/cancel`
- `POST /orders/:id/assign-worker` {workerId}

`EventsController`:
- `POST /orders/:orderId/events` {type, note?, occurredAt?}

Endpoints are kebab-case plural: `/orders`, `/operations`, `/companies/:companyId/financial-totals` (kebab ✓), `/operations/rederive` — hmm kebab-case plural? `rederive` is a sub-resource action; acceptable.

**Service details**:

`OrderService`:
```ts
create(input): validate uuid via repository (company exists? worker exists? — validate via a repository `companyExists`/`workerExists` or fetch). Keep: fetch worker to denormalize? The projection's upsert pulls the name from the workers table via SQL, so the service doesn't need the name. But I do want to validate worker existence → a repository method `workerExists(id)`. And company exists → `companyExists(id)`.
```
Transaction:
```ts
const order = await this.prisma.transaction(async (tx) => {
  const o = await this.ordersRepo.create(tx, input);
  await this.projection.applyOrderChange(tx, o);
  return o;
});
```

`approve(id)`:
```ts
await this.prisma.transaction(async (tx) => {
  const before = await this.ordersRepo.findOrThrow(tx, id);
  if (before.status !== 'pending') throw new ConflictError(...);
  const after = await this.ordersRepo.transition(tx, id, 'pending', 'approved'); // updateMany guard; throws NotFound/Conflict
  const event = await this.eventsRepo.record(tx, { orderId: id, type: 'approved', occurredAt: after.updatedAt });
  await this.projection.applyOrderChange(tx, after);
  await this.projection.applyEvent(tx, event);
});
```

Wait — the conflict check before the guarded update is racy but harmless (the guarded update is authoritative: `updateMany` where status=pending; count 0 → ConflictError). I'll do it directly: `const after = await this.ordersRepo.transition(tx, id, from: 'pending', to: 'approved')` and the repository throws ConflictError? The logic (which transition is allowed) belongs in the service; the repository exposes a primitive `guardedTransition(tx, id, fromStatus, toStatus)` that returns the updated row or null; the service throws the conflict. Good.

`applyOrderChange` reads the prev operation row inside the same tx — sees the current committed state + its own uncommitted updates (same tx). ✓.

`EventService.record(orderId, {type, note?, occurredAt?})`:
```ts
const now = new Date(occurredAt ?? Date.now());
const event = await this.prisma.transaction(async (tx) => {
  await this.ordersRepo.assertExists(tx, orderId); // 404 if missing
  const e = await this.eventsRepo.record(tx, {...});
  await this.projection.applyEvent(tx, e);
  return e;
});
```

`OperationsService`:
- `list(query)`: map params → repository `findOperations({companyId, status, from, to, page, pageSize})` → `prisma.operationRow.findMany({ where: { companyId, status, createdAt: { gte: from, lt: to } }, orderBy: [{ updatedAt: 'desc' }, { paymentOrderId: 'desc' }], skip, take })` + a `count` for total. Only touches the projection ✓.
- `totals(companyId)`: `prisma.companyFinancialTotals.findUnique({ where: { companyId } })` → 404 if the company doesn't exist? Or zero? If the company exists but has no totals row → zero (or 404 if the company itself doesn't exist). I'll validate company existence → 404 `resource_not_found`. Then return the row or a zeroed shape.
- `rederive(from, to)`: `this.projectionRepo.rederiveWindow(tx?, from, to)` + `recomputeTotals()` inside one transaction. Actually the re-derivation routine: windowed operation rows + full totals recompute. In one transaction.

Hmm — one transaction over a potentially large window: fine.

`DriftRepairService`:
- `run()`: as above; use a logger; return a report. Cron decorator. Also make the window env-configurable: `DRIFT_REPAIR_WINDOW_HOURS` (default 24), cron `DRIFT_REPAIR_CRON` default `'*/5 * * * *'`.

**Module wiring**:

- `DatabaseModule` (global? no — explicit imports): provides/exports `PrismaService`.
- `OperationsModule`: providers `OperationsService`, `OperationsRepository`, `OperationsProjectionService`, `ProjectionRepository`, `DriftRepairService`; exports `OperationsProjectionService` (the hook) + `OperationsRepository`? The drift-repair service uses ProjectionRepository internally. The dashboard controller uses OperationsService. Export: `OperationsProjectionService`. `DriftRepairService` is internal (scheduled), exported? Not needed externally. `ScheduleModule.forRoot()` imported in `AppModule`.
- `OrdersModule`: providers `OrderService`, `OrderRepository`, `EventRepository`?? — the event repository belongs to the events feature. OrdersModule imports `EventsModule` (for `EventRepository` — a repository as a provider: "a service, repository, or processor is listed in its module's providers" ✓, export from EventsModule). And `OrdersModule` imports `OperationsModule` (for `OperationsProjectionService`).
- `EventsModule`: providers `EventService`, `EventRepository`; imports `OperationsModule` + `OrdersModule`?? EventService needs `ordersRepo.assertExists` → import `OrdersModule` which imports `EventsModule` → circular import! NestJS circular module imports work with forwardRef but are ugly. Alternative: EventService validates order existence with a light check in `EventRepository`? The event repository can `SELECT 1 FROM payment_orders` (raw) — a repository in the events feature reading another table: acceptable? The repository is "the only layer that touches the database" — it can touch any table. I'll add `EventRepository.orderExists(orderId, tx)` that does a `findFirst` on paymentOrder? That's a Prisma call on paymentOrder from the events repository — fine (it's a DB layer). Or simpler: rely on the FK constraint — create event with `payment_order_id` → FK violation → 500. Not great. I'll add an `orderExists` check to `EventRepository` (repository-level, allowed). This avoids the circular.

Wait, but `OrderService.approve` records an event via `EventRepository` — OrdersModule imports EventsModule. EventsModule doesn't import OrdersModule (uses its own repository for the existence check). No cycle. ✓

- `AppModule`: imports DatabaseModule, OrdersModule, EventsModule, OperationsModule, `ScheduleModule.forRoot()`.

**Now the tests** (Vitest, real Postgres via DATABASE_URL):

`test/orders-read-your-own-writes.spec.ts`:
- beforeAll: create PrismaClient (or use Nest testing module). To test behavior through the service, I can instantiate the service directly with the repository (wiring by hand) — but that's a test of the wiring, and the transaction helper is on PrismaService… simpler: use `Test.createTestingModule` with the module and pull services from the app context — real Nest wiring, real DI, real PrismaService with the `DATABASE_URL` env. `app.init()`, then `app.get(OrderService)`, etc. This is a behavior test (service input → DB-observable output). I'll use Nest's testing module. Need `@nestjs/testing`.

Setup: `test/helpers/testing-app.ts` — builds a TestingModule from AppModule (but AppModule includes the cron → the drift-repair cron may fire during tests! Disable scheduling in tests: pass a defineProperty? The `@Cron` decorator registers on init. In tests, I could use a testing module that excludes DriftRepairService? But it's in the OperationsModule's providers… I can build the testing module with the same providers but replace DriftRepairService with a stub (overrideProvider). Simpler: in tests, `moduleRef.overrideProvider(DriftRepairService).useValue({ run: ... })`? But I want to test DriftRepairService in the drift spec — for that spec, instantiate directly with the real repository. Plan:
  - For read-your-own-writes + concurrency specs: `Test.createTestingModule({ imports: [AppModule] })` + override DriftRepairService with a no-op stub to prevent cron interference. (Cron default is 5 minutes; a test run is likely shorter than 5 minutes, but a window-hours check could race the assertions — override is safer.)
  - For drift spec: instantiate `DriftRepairService` directly with `ProjectionRepository` (+ PrismaService) and call `run()`.

- Also disable the real cron via env in tests? The override is enough.

Seed helper: create a company + 2 workers per test file (fresh uuid each run). Use raw Prisma client for seeding (the test file can use PrismaClient directly — it's a test, fine).

Spec 1 — read-your-own-writes:
1. `const order = await orderService.create({companyId, workerId, amountCents: 5000, currency:'USD'})`.
2. Dashboard list (OperationsService.list({companyId})) → expect the order to be present with status pending, workerName matches.
3. `await orderService.approve(order.id)`.
4. Immediately `OperationsService.list` → the row shows status approved (no delay — same process, next request).
5. Totals: `operationsService.totals(companyId)` → approvedAmountCents 5000, approvedCount 1; pending 0.
6. Additionally: a rolled-back write must not appear — e.g. `orderService.approve(anOrderThatIsDisputed?)` throws Conflict; assert the projection is unchanged. Better: verify rollback propagation directly: call the projection? The rollback guarantee comes from the shared transaction; test: approve a non-existent order → 404, no projection row is created. And test a failed multi-step write: an approve where the projection upsert fails → the source isn't changed? Hard to force a failure without fault injection. I'll stick with: a failed transition (conflict) leaves both source and projection unchanged (assert via repository reads). That's a meaningful behavior assertion about the transaction.

Spec 2 — concurrent totals:
1. Seed a company with 2 orders (create via OrderService) of 1000 and 2500 cents.
2. `await Promise.all([orderService.approve(a.id), orderService.approve(b.id)])`.
3. Totals → approvedAmountCents = 3500, approvedCount = 2. (A lost update would be 1000/2500 → 404… no, 1000 or 2500 alone.)
4. Stronger: N=8 parallel approvals → total = sum. I'll include an 8-order stress test with different amounts, assert exact sum and count. That's the "concurrent, not sequential" proof.
5. Also assert no rows are lost in the projection: list length 8, all approved.

Spec 3 — drift repair (+ re-derivation):
1. Seed: company, worker, 3 orders; approve 1, record 1 event; a 4th order created and then… set up a rich state.
2. `rederive(window covering the created_at)` → snapshot A = all operation rows (sorted). Re-derive again → snapshot B. Assert A deep-equals B (idempotence).
3. Assert the projection matches the source: for each order, row.status == source.status, workerName == worker.name, latest event is correct.
4. Inject drift: directly (raw Prisma) update the operation_row: set the status of the approved order to 'pending', set worker_name='wrong', set the latest_event fields to null; corrupt the totals row: approved_amount_cents -= 1000.
5. Run `driftRepairService.run()` → assert the projection rows are restored (status approved, worker name, latest event) and totals match the source aggregate.
6. Additionally, test the re-derivation routine separately: `operationsService.rederive(from,to)` also repairs the injected drift (same mechanism).

Note: the drift-repair window is "recent window" env-configurable — for tests I set env before module creation? DriftRepairService reads the window at construction (constructor arg with default). I'll make it constructor-injected with a default via `@Optional() @Inject('DRIFT_REPAIR_WINDOW_HOURS')`? Simpler: a static default constant 24h; the tests create orders with createdAt=now (within the window) — no env needed. Since the seed is fresh, createdAt = now → within the last 24 hours ✓.

For the re-derivation test, I pass an explicit from/to that covers now.

**Prisma client and BigInt in the raw SQL for totals recompute**: `SUM(amount_cents)` returns numeric → cast to bigint: `::bigint`. In raw SQL I control it.

**Migration SQL**: hand-written `prisma/migrations/20250101000000_init/migration.sql`. Contains:

- `CREATE TYPE "OrderStatus" AS ENUM ('PENDING','APPROVED','DISPUTED','CANCELLED');` — Prisma enum values: I'll define `enum OrderStatus { pending approved disputed cancelled }` → the Postgres values are 'pending','approved','disputed','cancelled' (Prisma uses the enum member names as-is). Lowercase enum values in Postgres: fine.
- tables companies, workers, payment_orders, events, operation_rows, company_financial_totals.
- FKs, indexes, the covering index.

And `migration_lock.toml`: `provider = "postgresql"`.

The schema.prisma must match the migration (for `prisma migrate diff` sanity). I'll write both carefully.

Let me finalize the columns:

companies: id uuid pk, name text, created_at timestamptz default now().
workers: id uuid pk, name text, company_id uuid null? Workers belong to a company — make it NOT NULL with an FK? In the operations list, workers are joined; a worker is employed by a company. NOT NULL company_id.
payment_orders: id uuid pk, company_id uuid not null FK, worker_id uuid not null FK, status OrderStatus not null default 'pending', amount_cents integer not null check ≥0, currency char(3) not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(). Index (company_id, status, updated_at desc) on the source? Not needed (the hot path is the projection only). Maybe a basic index on company_id. Keep minimal: @@index([companyId, status]) for the re-derivation scan? The re-derivation filters by created_at: @@index([createdAt]) for the window scan. I'll add both (cheap, helpful for maintenance).
events: id uuid pk, payment_order_id uuid not null FK cascade, event_type text not null, note text null, occurred_at timestamptz not null, created_at timestamptz default now(). @@index([paymentOrderId, occurredAt(sort desc), id(sort desc)]) — the name `events_order_occurred_idx`.
operation_rows: as above, with latest_event_id uuid null. Covering index:
```sql
CREATE INDEX "operation_rows_company_status_updated_idx"
  ON "operation_rows" ("company_id", "status", "updated_at" DESC, "payment_order_id" DESC)
  INCLUDE ("worker_name", "amount_cents", "currency", "latest_event_type", "latest_event_at", "latest_event_id", "created_at");
```
Hmm — include payment_order_id in the key for the tiebreak sort (updatedAt desc, paymentOrderId desc). Prisma's @@index: `@@index([companyId, status, updatedAt(sort: SortOrder.DESC), paymentOrderId(sort: SortOrder.DESC)], map: ...)` — Prisma doesn't know about INCLUDE; the physical index has extra INCLUDE columns. Will `prisma migrate` see a drift? `prisma migrate dev` compares the shadow DB created by the schema against the actual — the shadow DB would create an index without INCLUDE; the diff against a real DB with INCLUDE… the index comparison is by columns — does Prisma ignore INCLUDE columns? Not 100% sure; to be safe, this is a hand-written migration anyway; I'll note it in DESIGN.md that the covering index is the only intentional schema/migration divergence (Prisma can't express INCLUDE). Fine.

company_financial_totals: company_id uuid pk FK, four amount bigints default 0, four counts ints default 0, updated_at timestamptz not null default now().

**Repository raw SQL in Prisma**: use `tx.$executeRaw` / `tx.$queryRaw`? For `$queryRaw` with an explicit parameter array: `tx.$queryRaw\`...\``, params...` — tagged template with literals: `prisma.$queryRaw\`SELECT ...\``, a, b` — in Prisma 5+, the template tag takes the interpolated values as arguments (safe, parameterized). Yes: `await prisma.$queryRaw\`SELECT 1\``, x`` — supported (each template literal is a parameter). Good.

Note: ESM + Prisma: fine.

**PrismaService**:

```ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
  transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.$transaction(fn);
  }
}
```

`// ASSUMPTION: transaction coordination lives on the infrastructure PrismaService so that business services have zero Prisma client calls; repositories receive the tx handle as a token.`

**DTOs / validation in the controller**: I'll write a small parse helper in the controller. Query param parsing: `page` int ≥1, `pageSize` 1..100, `status` one of the enum, `from`/`to` ISO dates, `companyId` uuid regex. On failure → throw a ValidationError with `details: { field: reason }`.

**The "what the operator sees" contract** (DESIGN.md): columns, filters, ordering, pagination semantics are unchanged: the projection row mirrors the join result: `{ paymentOrderId, companyId, status, workerName, amountCents, currency, latestEventType, latestEventAt, createdAt, updatedAt }` sorted by `updatedAt DESC, paymentOrderId DESC`.

Now, the file list:

1. `package.json` — dependencies: @nestjs/common, @nestjs/core, @nestjs/platform-express, @nestjs/schedule, @nestjs/testing, prisma, @prisma/client, reflect-metadata, rxjs; dev: typescript, ts-node? (ESM — use `tsx`? For tests, vitest handles TS. For `npm run start:dev`, Nest with ESM is finicky; I'll stick with a script that works: `"test": "vitest run"`, `"migrate": "prisma migrate deploy"`, `"build": "tsc -p tsconfig.json"`. Runtime start: `"start": "node --import tsx dist/..."`? To keep it simple and honest: a `tsx src/main.ts` script (`"start:dev": "tsx watch src/main.ts"`). tsx works with ESM Nest. I'll include the tsx dependency. Vitest config: `vitest.config.ts` with test env, setup file, global timeout 30s.
2. `tsconfig.json` — strict, ESM (`"type": "module"` in package.json; tsconfig `"module": "NodeNext"` or `ESNext`+`moduleResolution` bundler? Vitest with NodeNext: imports require `.js` extensions on relative imports! Ugh — ESM NodeNext requires explicit `.js` extensions on relative imports in TS source. That's the convention: ESM, type module. So all relative imports use the `.js` extension. I'll be careful throughout.
3. `prisma/schema.prisma`
4. `prisma/migrations/migration_lock.toml`
5. `prisma/migrations/20250601000000_init/migration.sql`
6. `src/main.ts`
7. `src/app.module.ts`
8. `src/database/prisma.service.ts`
9. `src/database/database.module.ts`
10. `src/common/errors.ts`
11. `src/common/errors.exception-filter.ts`
12. `src/common/dates.ts`? (parse helper) — I'll fold it into the controller.
13. `src/orders/order.service.ts` — wait, the naming convention: `src/<feature>/<feature>.module.ts` — the feature folder name and the file name. Feature `orders` → `src/orders/orders.module.ts`? The convention's example shows `src/payout/payout.service.ts` — the file name matches the folder. So `src/orders/orders.module.ts`, `orders.controller.ts`, `orders.service.ts`, `orders.repository.ts`. And `src/events/events.*`. And `src/operations/operations.module.ts`, `operations.controller.ts`, `operations.service.ts`, `operations.repository.ts`, plus additional files in the operations folder: `projection-maintenance.service.ts`? The convention says `<feature>.service.ts` — extra files are allowed (the layout is minimal). I'll add:
    - `src/operations/projection.repository.ts` (projection table access: raw SQL)
    - `src/operations/projection.service.ts` (the maintenance hook logic) — the hook.
    - `src/operations/drift-repair.service.ts`
14. `test/...` — the convention: `test/<feature>.spec.ts`. So `test/read-your-own-writes.spec.ts`? The convention example is `test/<feature>.spec.ts` — I'll use `test/orders.spec.ts` (read-your-own-writes + concurrency), `test/operations.spec.ts` (re-derivation + drift), `test/helpers.ts` (test utilities: seed, app build).

Hmm wait — the "concurrency" test: two concurrent approvals. Both go through the `prisma.$transaction` interactive transaction — separate connections, each holding a row lock on the totals row for a short time; the increments serialize; exact. ✓

Another consideration: the `OrderService.approve` records an audit event of type 'approved' — the event's `occurredAt` = the order's updatedAt (after the transition). Fine.

**Event ordering and the latest-event hook**: `applyEvent(tx, event)`:

```sql
UPDATE operation_rows
SET latest_event_type = $2, latest_event_at = $3, latest_event_id = $4
WHERE payment_order_id = $1
  AND (latest_event_id IS NULL OR ($3, $4) > (latest_event_at, latest_event_id));
```

Row type `(timestamptz, uuid)` comparison — works in Postgres. ✓ No `updated_at` change (documented).

Edge case: an event on an order whose operation_row is missing (drift) → the update affects 0 rows; the drift repair converges. Fine.

**applyOrderChange SQL**:

Upsert the row:
```sql
INSERT INTO operation_rows (payment_order_id, company_id, status, worker_name, amount_cents, currency, created_at, updated_at)
VALUES ($1, $2, $3, (SELECT name FROM workers WHERE id = $4), $5, $6, $7, $8)
ON CONFLICT (payment_order_id) DO UPDATE SET
  company_id = excluded.company_id,
  status = excluded.status,
  worker_name = excluded.worker_name,
  amount_cents = excluded.amount_cents,
  currency = excluded.currency,
  updated_at = excluded.updated_at
```
(latest_event_* is preserved — don't touch.)

Totals delta (single statement):
```sql
INSERT INTO company_financial_totals (company_id, ${toCol}AmountCents, ${toCol}Count, updated_at)
VALUES ($1, $2, $3, now())
ON CONFLICT (company_id) DO UPDATE SET
  ${toCol}AmountCents = company_financial_totals.${toCol}AmountCents + $2,
  ${toCol}Count = company_financial_totals.${toCol}Count + $3,
  ${fromCol}AmountCents = company_financial_totals.${fromCol}AmountCents - $4,
  ${fromCol}Count = company_financial_totals.${fromCol}Count - $5,
  updated_at = now()
```
where fromCol is only present if `prevStatus` is non-null; otherwise the statement omits the decrement (and $4/$5 don't exist). The column names are built in the repository from the validated status (a map of allowed status → column; no SQL injection since the status is from a fixed map). If prevStatus === toStatus (no change, e.g. an assign-worker that doesn't change status): totals no-op (delta 0) — I'll skip the call in the service when status is unchanged. Actually, assign-worker doesn't change status → applyOrderChange with the same status: row upsert (worker_name change) + no totals delta. The service: `if (prevStatus !== status) applyTotalsDelta(...)`. ✓

But wait — the service reads the prev row (`projectionRepo.findOperationRow(tx, id)`) to get prevStatus. That's a read inside the tx — sees its own uncommitted state. ✓ Race: two concurrent writes to the same order (approve + assign) — both txs read the same prev status; the guarded transition on the source order serializes the status change… assign doesn't guard on status. Concurrent approve and cancel of the same order: both `updateMany where status=pending` — one wins, the other gets count 0 → Conflict. The loser rolls back including the projection. ✓

Concurrent writes to different orders of the same company: both read the prev row (different rows) and do the atomic increment on the totals row — serialized by the row lock, both applied. ✓ (That's the test.)

**findOperationRow**: I can use a Prisma typed query: `tx.operationRow.findUnique({ where: { paymentOrderId } })` — a Prisma model exists → typed. ✓

**Dashboard read** (`operations.repository.ts`):
```ts
list(params) {
  return this.prisma.operationRow.findMany({
    where: { companyId?, status?, createdAt: { gte, lt } },
    orderBy: [{ updatedAt: 'desc' }, { paymentOrderId: 'desc' }],
    skip: (page-1)*pageSize, take: pageSize
  })
}
count(params) { this.prisma.operationRow.count({ where }) }
```
Only the projection ✓. The query planner uses the covering index (company_id, status) seek + updated_at desc scan + filter on created_at (included) + LIMIT. ✓

**Totals read**: `this.prisma.companyFinancialTotals.findUnique({ where: { companyId } })`.

Now — one design question: the totals endpoint is under the operations feature's controller: `GET /companies/:companyId/financial-totals` in `OperationsController`. OK.

**Re-derivation endpoint**: `POST /operations/rederive` body `{ from, to }` → `OperationsService.rederive(from, to)`:
```ts
await this.prisma.transaction(async (tx) => {
  await this.projectionRepo.rederiveWindow(tx, from, to);
  await this.projectionRepo.recomputeTotals(tx);
});
```
The raw SQL inside tx: `tx.$executeRaw`. ✓

**Drift repair**:
```ts
async run(): Promise<DriftReport> {
  const to = new Date(); const from = new Date(to.getTime() - windowMs);
  return this.prisma.transaction(async (tx) => {
    const drifted = await this.projectionRepo.findDriftedOrderIds(tx, from, to);
    let rowsRepaired = 0;
    if (drifted.length > 0) {
      await this.projectionRepo.rederiveWindow(tx, from, to);
      rowsRepaired = drifted.length; // at least these; window re-derivation covers all rows in the window
    }
    const totalsDriftedCompanies = await this.projectionRepo.findTotalsDriftedCompanyIds(tx, from, to);
    let totalsRecomputed = false;
    if (totalsDriftedCompanies.length > 0) {
      await this.projectionRepo.recomputeTotals(tx);
      totalsRecomputed = true;
    }
    return { window: {from, to}, driftedOrders: drifted.length, totalsDriftedCompanies: totalsDriftedCompanies.length, totalsRecomputed };
  });
}
```

`@Cron(process.env.DRIFT_REPAIR_CRON ?? '*/5 * * * *')` — the decorator needs a value at decoration time (module load) — env is read at load time ✓.

Cron error handling: wrap in try/catch, log. (If the cron throws, @nestjs/schedule logs it.)

Now — **findDriftedOrderIds SQL**: I need the latest_event CTE again (bounded with `occurred_at >= from`). Compare fields. Return `id`.

Potential issue: `latest_event_id IS DISTINCT FROM le.id` — if the source order has no events, le.id is null; if the row's latest_event_id is null → IS DISTINCT FROM is false ✓.

**Totals drift SQL**: as sketched. Companies to check: companies with orders created in the window, or with orders that changed in the window? Totals depend on the current status of all orders of the company, not just the window. An order created long ago that changes now → its company isn't in "created in the window" → drift is missed until the window covers its creation. Better: companies with orders whose `updated_at` is in the window (any state change) or created in the window: `WHERE created_at >= from OR updated_at >= from`. That's the right set. ✓

But the per-company global aggregate comparison is per company — for each candidate company, a subquery aggregating all its orders. With a limited company set, it's fine.

**Recompute totals** (global): as sketched, plus a `DELETE` for stale companies (companies deleted / no orders):
```sql
DELETE FROM company_financial_totals
WHERE company_id NOT IN (SELECT company_id FROM payment_orders)
   OR company_id NOT IN (SELECT id FROM companies);
```
Hmm, if a company is deleted, its orders are… the FK is restrict? I'll make the FK on orders.company_id `ON DELETE RESTRICT` (a company with orders can't be deleted) — then the NOT IN companies is redundant but harmless. Keep both for safety.

Also, ensure totals rows exist for all companies (even zero orders)? The dashboard totals for a company with no orders → zero. My `totals()` service: if the row is missing → return zero (no 404 as long as the company exists). Simpler than materializing rows. But then the "INSERT branch" in applyTotalsDelta creates the row on the first order — fine.

**Now, "simulate the write path"**: the orders/events services ARE the write path (real endpoints that mutate the source + projection). ✓

**DESIGN.md content**:
- Problem, constraints (RYOW, exact totals, p95 < 50ms, no UI changes).
- Chosen design: a synchronous projection maintained inside the writer's transaction; two tables (row-level operation_rows + company totals); atomic in-place increments; covering index; windowed re-derivation (idempotent, live-safe); scheduled drift repair.
- Rejected alternatives:
  1. Materialized view (REFRESH) — refresh interval → RYOW window; refresh is global (whole thing, heavy, locks); `REFRESH CONCURRENTLY` still has an interval.
  2. Postgres trigger on the source table — works, but logic is split from the app (harder to test, deploys, no DI, two sources of truth for the business rule; the app must not rely on the DB version matching); I chose the app-level hook for testability + keeping the business logic in the service layer (per the layering rules).
  3. CDC / outbox queue (Debezium, etc.) — async by construction → violates RYOW (window); extra infrastructure.
  4. Scheduled job / interval refresh — explicitly rejected: any interval > 0 violates RYOW.
  5. Just a better index on the join / CTE / cache — the join cost at 3M rows × 3 tables with selective filters doesn't get under 50ms p95 without changing the query shape; a cache has the same staleness problem.
- Concurrency: in-place `SET x = x + delta` (row-level, no app read-modify-write), the test proves it.
- Idempotent re-derivation + live safety (snapshot isolation; post-commit writes are hook-maintained; re-derivation is a pure function of the source).
- Drift-repair design: window scan, IS DISTINCT FROM comparison, converge by re-derivation.
- Read path: a single table, a covering index matching filter+sort; keyset vs offset note.
- The read-model contract: what's shown, what changed (nothing visible).
- The INCLUDE index and a note about Prisma drift.
- The env vars: `DATABASE_URL`, `DRIFT_REPAIR_CRON`, `DRIFT_REPAIR_WINDOW_HOURS`.
- A brief testing strategy.

Keep the DESIGN.md "short" — the task says "a short DESIGN.md." I'll keep it tight (~80–120 lines).

**Now, let me write all the code carefully.**

TypeScript ESM with NodeNext → relative imports with `.js` extension. Vitest handles it fine.

package.json:

```json
{
  "name": "marketplace-backoffice",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node --import tsx src/main.ts",
    "start:dev": "tsx watch src/main.ts",
    "prisma:migrate": "prisma migrate deploy",
    "prisma:generate": "prisma generate",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.0",
    "@nestjs/core": "^10.3.0",
    "@nestjs/platform-express": "^10.3.0",
    "@nestjs/schedule": "^4.1.0",
    "@prisma/client": "^5.14.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.3.0",
    "prisma": "^5.14.0",
    "tsx": "^4.15.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "@types/node": "^20.12.0"
  }
}
```

tsconfig:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "useDefineForClassFields": false,
    "declaration": false,
    "sourceMap": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "test"]
}
```

Hmm, `useDefineForClassFields: false` is important for Nest decorators + class fields (Nest 10 with TS 5: with default true, it breaks dependency injection via constructor property injection? We use explicit constructor parameters — but Nest needs the metadata; `useDefineForClassFields` false is the Nest recommended setting). ✓

vitest.config.ts:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
  },
});
```

prisma/schema.prisma:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum OrderStatus {
  pending
  approved
  disputed
  cancelled
}

model Company {
  id        String   @id @default(uuid()) @db.Uuid
  name      String
  createdAt DateTime @default(now()) @map("created_at")

  orders PaymentOrder[]
  workers Worker[]
  totals CompanyFinancialTotals?

  @@map("companies")
}

model Worker {
  id        String   @id @default(uuid()) @db.Uuid
  name      String
  companyId String   @map("company_id") @db.Uuid
  createdAt DateTime @default(now()) @map("created_at")

  company Company      @relation(fields: [companyId], references: [id])
  orders  PaymentOrder[]

  @@index([companyId])
  @@map("workers")
}

model PaymentOrder {
  id          String      @id @default(uuid()) @db.Uuid
  companyId   String      @map("company_id") @db.Uuid
  workerId    String      @map("worker_id") @db.Uuid
  status      OrderStatus @default(pending)
  amountCents Int         @map("amount_cents")
  currency    String      @db.Char(3)
  createdAt   DateTime    @default(now()) @map("created_at")
  updatedAt   DateTime    @default(now()) @updatedAt @map("updated_at")

  company Company @relation(fields: [companyId], references: [id])
  worker  Worker  @relation(fields: [workerId], references: [id])
  events  Event[]

  @@index([companyId, status])
  @@index([createdAt])
  @@map("payment_orders")
}

model Event {
  id             String   @id @default(uuid()) @db.Uuid
  paymentOrderId String   @map("payment_order_id") @db.Uuid
  eventType      String   @map("event_type")
  note           String?
  occurredAt     DateTime @map("occurred_at")
  createdAt      DateTime @default(now()) @map("created_at")

  paymentOrder PaymentOrder @relation(fields: [paymentOrderId], references: [id], onDelete: Cascade)

  @@index([paymentOrderId, occurredAt(sort: SortOrder.DESC), id(sort: SortOrder.DESC)])
  @@map("events")
}

model OperationRow {
  paymentOrderId  String    @id @map("payment_order_id") @db.Uuid
  companyId       String    @map("company_id") @db.Uuid
  status          OrderStatus
  workerName      String    @map("worker_name")
  amountCents     Int       @map("amount_cents")
  currency        String    @db.Char(3)
  latestEventType String?   @map("latest_event_type")
  latestEventAt   DateTime? @map("latest_event_at")
  latestEventId   String?   @map("latest_event_id") @db.Uuid
  createdAt       DateTime  @map("created_at")
  updatedAt       DateTime  @map("updated_at")

  @@index([companyId, status, updatedAt(sort: SortOrder.DESC), paymentOrderId(sort: SortOrder.DESC)], map: "operation_rows_company_status_updated_idx")
  @@map("operation_rows")
}

model CompanyFinancialTotals {
  companyId            String   @id @map("company_id") @db.Uuid
  pendingAmountCents   BigInt   @default(0) @map("pending_amount_cents")
  pendingCount         Int      @default(0) @map("pending_count")
  approvedAmountCents  BigInt   @default(0) @map("approved_amount_cents")
  approvedCount        Int      @default(0) @map("approved_count")
  disputedAmountCents  BigInt   @default(0) @map("disputed_amount_cents")
  disputedCount        Int      @default(0) @map("disputed_count")
  cancelledAmountCents BigInt   @default(0) @map("cancelled_amount_cents")
  cancelledCount       Int      @default(0) @map("cancelled_count")
  updatedAt            DateTime @default(now()) @map("updated_at")

  company Company @relation(fields: [companyId], references: [id])

  @@map("company_financial_totals")
}
```

Migration SQL — mirror this exactly, plus the INCLUDE index:

```sql
CREATE TYPE "OrderStatus" AS ENUM ('pending', 'approved', 'disputed', 'cancelled');

CREATE TABLE "companies" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workers" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "company_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "workers_company_id_idx" ON "workers"("company_id");

CREATE TABLE "payment_orders" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "worker_id" UUID NOT NULL,
  "status" "OrderStatus" NOT NULL DEFAULT 'pending',
  "amount_cents" INTEGER NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_orders_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "payment_orders_company_id_status_idx" ON "payment_orders"("company_id", "status");
CREATE INDEX "payment_orders_created_at_idx" ON "payment_orders"("created_at");

CREATE TABLE "events" (
  "id" UUID NOT NULL,
  "payment_order_id" UUID NOT NULL,
  "event_type" TEXT NOT NULL,
  "note" TEXT,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "events_payment_order_id_fkey" FOREIGN KEY ("payment_order_id") REFERENCES "payment_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "events_payment_order_id_occurred_at_id_idx" ON "events"("payment_order_id", "occurred_at" DESC, "id" DESC);

-- Read models (projection)

CREATE TABLE "operation_rows" (
  "payment_order_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "status" "OrderStatus" NOT NULL,
  "worker_name" TEXT NOT NULL,
  "amount_cents" INTEGER NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "latest_event_type" TEXT,
  "latest_event_at" TIMESTAMPTZ(6),
  "latest_event_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "operation_rows_pkey" PRIMARY KEY ("payment_order_id"),
  CONSTRAINT "operation_rows_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
```

Wait — should operation_rows have an FK to payment_orders? If a source order is deleted, the row should disappear: FK ON DELETE CASCADE on payment_order_id. Yes, add `CONSTRAINT operation_rows_payment_order_id_fkey FOREIGN KEY (payment_order_id) REFERENCES payment_orders(id) ON DELETE CASCADE`. And company_id FK restrict/cascade? If a company is deleted (blocked while orders exist), cascade is moot. I'll keep the company_id FK cascade (harmless).

Note: Prisma schema doesn't declare the relation on OperationRow.paymentOrderId — Prisma doesn't require a relation for an FK; an FK not in the schema is tolerated by Prisma (it just doesn't know about it) — `migrate dev` would try to drop it in a later diff (it sees an "unknown" FK? Prisma treats FKs not in the schema as drift and drops them). In a hand-written migration with no subsequent `migrate dev` runs, it's fine. I'll note it in DESIGN.md. Alternatively I omit the FK in the migration… but cascade on order delete is nice. Keep it, with a note.

The covering index:

```sql
CREATE INDEX "operation_rows_company_status_updated_idx"
  ON "operation_rows" ("company_id", "status", "updated_at" DESC, "payment_order_id" DESC)
  INCLUDE ("worker_name", "amount_cents", "currency", "latest_event_type", "latest_event_at", "latest_event_id", "created_at");

CREATE TABLE "company_financial_totals" (
  "company_id" UUID NOT NULL,
  "pending_amount_cents" BIGINT NOT NULL DEFAULT 0,
  "pending_count" INTEGER NOT NULL DEFAULT 0,
  "approved_amount_cents" BIGINT NOT NULL DEFAULT 0,
  "approved_count" INTEGER NOT NULL DEFAULT 0,
  "disputed_amount_cents" BIGINT NOT NULL DEFAULT 0,
  "disputed_count" INTEGER NOT NULL DEFAULT 0,
  "cancelled_amount_cents" BIGINT NOT NULL DEFAULT 0,
  "cancelled_count" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "company_financial_totals_pkey" PRIMARY KEY ("company_id"),
  CONSTRAINT "company_financial_totals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
```

Now the source code.

`src/main.ts`:

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ErrorEnvelopeFilter } from './common/errors.exception-filter.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });
  app.useGlobalFilters(new ErrorEnvelopeFilter());
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}
void bootstrap();
```

`src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from './database/database.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { EventsModule } from './events/events.module.js';
import { OperationsModule } from './operations/operations.module.js';

@Module({
  imports: [ScheduleModule.forRoot(), DatabaseModule, OperationsModule, OrdersModule, EventsModule],
})
export class AppModule {}
```

`src/common/errors.ts`:

```ts
export type ErrorCode = 'resource_not_found' | 'validation_failed' | 'conflict' | 'internal_error';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) { super(message); }
}
export class ResourceNotFoundError extends AppError {
  constructor(message: string, details: Record<string, unknown> = {}) { super(404, 'resource_not_found', message, details); }
}
export class ValidationError extends AppError {
  constructor(message: string, details: Record<string, unknown> = {}) { super(400, 'validation_failed', message, details); }
}
export class ConflictError extends AppError {
  constructor(message: string, details: Record<string, unknown> = {}) { super(409, 'conflict', message, details); }
}
```

`src/common/errors.exception-filter.ts`:

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { AppError, ErrorCode } from './errors.js';

interface ErrorEnvelope { error: { code: ErrorCode | 'internal_error'; message: string; details: Record<string, unknown> } }

@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorEnvelopeFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof AppError) {
      this.send(response, exception.status, exception.code, exception.message, exception.details);
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code: ErrorCode = status === 404 ? 'resource_not_found' : status === 400 ? 'validation_failed' : status === 409 ? 'conflict' : status < 500 ? 'validation_failed' : 'internal_error';
      const body = exception.getResponse();
      const message = typeof body === 'string' ? body : (body as { message?: unknown }).message ?? exception.message;
      this.send(response, status, code, String(message), {});
      return;
    }
    this.logger.error(`Unhandled exception: ${exception instanceof Error ? exception.stack : String(exception)}`);
    this.send(response, HttpStatus.INTERNAL_SERVER_ERROR, 'internal_error', 'Internal server error', {});
  }

  private send(response: Response, status: number, code: ErrorCode, message: string, details: Record<string, unknown>): void {
    const envelope: ErrorEnvelope = { error: { code, message, details } };
    response.status(status).json(envelope);
  }
}
```

The express import — `@types/express` dev dep. Add to package.json devDependencies: `"@types/express": "^4.17.21"`.

`src/database/prisma.service.ts`:

```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> { await this.$connect(); }
  async onModuleDestroy(): Promise<void> { await this.$disconnect(); }

  /**
   * Runs `fn` inside an interactive Prisma transaction.
   * // ASSUMPTION: ...
   */
  transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.$transaction(fn);
  }
}
```

ASSUMPTION comment: "Transaction coordination is exposed by the infrastructure PrismaService (not a business service) so that feature services keep zero Prisma client calls; repositories receive the transaction handle as a token."

`src/database/database.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class DatabaseModule {}
```

Global or explicit? The convention: "a provider used by other modules is exportsed from its own module and that module is importsed in the other." To respect the wiring convention strictly, I shouldn't use @Global — each feature module should explicitly import DatabaseModule. OK, non-global, and each feature module imports DatabaseModule. Slightly more verbose but follows the convention.

`src/orders/orders.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { OrderStatus, PaymentOrder, Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { ResourceNotFoundError } from '../common/errors.js';

export interface NewOrderInput {
  companyId: string;
  workerId: string;
  amountCents: number;
  currency: string;
}

@Injectable()
export class OrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async companyExists(companyId: string, tx: Prisma.TransactionClient = this.prisma): Promise<boolean> {
    const row = await tx.company.findUnique({ where: { id: companyId }, select: { id: true } });
    return row !== null;
  }

  async workerExists(workerId: string, tx: Prisma.TransactionClient = this.prisma): Promise<boolean> {
    const row = await tx.worker.findUnique({ where: { id: workerId }, select: { id: true } });
    return row !== null;
  }

  async create(input: NewOrderInput, tx: Prisma.TransactionClient): Promise<PaymentOrder> {
    return tx.paymentOrder.create({ data: input });
  }

  async find(id: string, tx: Prisma.TransactionClient = this.prisma): Promise<PaymentOrder | null> {
    return tx.paymentOrder.findUnique({ where: { id } });
  }

  async findOrThrow(id: string, tx: Prisma.TransactionClient = this.prisma): Promise<PaymentOrder> {
    const order = await this.find(id, tx);
    if (!order) throw new ResourceNotFoundError(`Payment order ${id} does not exist`, { orderId: id });
    return order;
  }

  /**
   * Atomically transitions the order from `fromStatus` to `toStatus`.
   * Returns null if the order is not currently in `fromStatus` (the caller decides the error).
   */
  async guardedTransition(id: string, fromStatus: OrderStatus, toStatus: OrderStatus, tx: Prisma.TransactionClient): Promise<PaymentOrder | null> {
    const result = await tx.paymentOrder.updateMany({
      where: { id, status: fromStatus },
      data: { status: toStatus },
    });
    if (result.count === 0) return null;
    const updated = await this.find(id, tx);
    if (!updated) throw new ResourceNotFoundError(`Payment order ${id} disappeared during transition`, { orderId: id });
    return updated;
  }
}
```

Hmm `updateMany` sets updatedAt? `@updatedAt` is updated automatically on any update including updateMany ✓.

`src/orders/orders.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { OrderStatus, PaymentOrder } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { ConflictError, ValidationError, ResourceNotFoundError } from '../common/errors.js';
import { OrdersRepository, NewOrderInput } from './orders.repository.js';
import { EventRepository } from '../events/events.repository.js';
import { ProjectionService } from '../operations/projection.service.js';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersRepository,
    private readonly events: EventRepository,
    private readonly projection: ProjectionService,
  ) {}

  async create(input: NewOrderInput): Promise<PaymentOrder> {
    return this.prisma.transaction(async (tx) => {
      const [companyOk, workerOk] = await Promise.all([
        this.orders.companyExists(input.companyId, tx),
        this.orders.workerExists(input.workerId, tx),
      ]);
      if (!companyOk) throw new ResourceNotFoundError(`Company ${input.companyId} does not exist`, { companyId: input.companyId });
      if (!workerOk) throw new ResourceNotFoundError(`Worker ${input.workerId} does not exist`, { workerId: input.workerId });
      const order = await this.orders.create(input, tx);
      // Maintenance hook: the projection is updated inside the write's transaction (read-your-own-writes).
      await this.projection.applyOrderChange(tx, order);
      return order;
    });
  }

  async approve(orderId: string): Promise<PaymentOrder> {
    return this.transition(orderId, 'pending', 'approved');
  }

  async dispute(orderId: string): Promise<PaymentOrder> {
    // dispute can be initiated from pending or from approved
    return this.prisma.transaction(async (tx) => {
      const order = await this.orders.findOrThrow(orderId, tx);
      if (order.status === 'disputed' || order.status === 'cancelled') {
        throw new ConflictError(`Order ${orderId} is ${order.status} and cannot be disputed`, { orderId, status: order.status });
      }
      const updated = await this.orders.guardedTransition(orderId, order.status, 'disputed', tx);
      if (!updated) throw new ConflictError(`Order ${orderId} changed concurrently`, { orderId });
      await this.projection.applyOrderChange(tx, updated);
      const event = await this.events.record(tx, { paymentOrderId: orderId, eventType: 'disputed', occurredAt: updated.updatedAt });
      await this.projection.applyEvent(tx, event);
      return updated;
    });
  }
```

Hmm, dispute from pending: guardedTransition(from=pending). From approved: from=approved. But between findOrThrow and the guardedTransition, the status could change → the guardedTransition with the old fromStatus returns null → conflict ✓. But if the order was pending and is now approved, the fromStatus 'pending' → null → conflict (a bit wrong: the order is now approved, disputable). The conflict is the safe outcome. OK.

Simplify: a private `transition` for single-source transitions (approve: pending→approved; cancel: pending→cancelled):

```ts
  private transition(orderId: string, from: OrderStatus, to: OrderStatus, auditType: string): Promise<PaymentOrder> {
    return this.prisma.transaction(async (tx) => {
      const existing = await this.orders.findOrThrow(orderId, tx);
      if (existing.status !== from) {
        throw new ConflictError(`Order ${orderId} is ${existing.status}; only ${from} orders can be moved to ${to}`, { orderId, status: existing.status });
      }
      const updated = await this.orders.guardedTransition(orderId, from, to, tx);
      if (!updated) throw new ConflictError(`Order ${orderId} changed concurrently`, { orderId });
      await this.projection.applyOrderChange(tx, updated);
      const event = await this.events.record(tx, { paymentOrderId: orderId, eventType: auditType, occurredAt: updated.updatedAt });
      await this.projection.applyEvent(tx, event);
      return updated;
    });
  }

  approve(o) { return this.transition(o, 'pending', 'approved', 'approved'); }
  cancel(o) { return this.transition(o, 'pending', 'cancelled', 'cancelled'); }
  dispute(o) { ... as above but with audit 'disputed' }

  async assignWorker(orderId: string, workerId: string): Promise<PaymentOrder> {
    return this.prisma.transaction(async (tx) => {
      const existing = await this.orders.findOrThrow(orderId, tx);
      if (!(await this.orders.workerExists(workerId, tx))) {
        throw new ResourceNotFoundError(`Worker ${workerId} does not exist`, { workerId });
      }
      const updated = await this.orders.assignWorker(orderId, workerId, tx);
      await this.projection.applyOrderChange(tx, updated);
      const event = await this.events.record(tx, { paymentOrderId: orderId, eventType: 'worker_assigned', note: `worker_id=${workerId}`, occurredAt: updated.updatedAt });
      await this.projection.applyEvent(tx, event);
      return updated;
    });
  }
```

`assignWorker` in the repository: `tx.paymentOrder.update({ where: { id }, data: { workerId } })`.

Note the unused `existing` in assignWorker — drop the find? Keep for a better 404 (the order exists check). `update` would throw an opaque P2025. Keep findOrThrow.

`src/events/events.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Event, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';

export interface NewEventInput {
  paymentOrderId: string;
  eventType: string;
  note?: string;
  occurredAt: Date;
}

@Injectable()
export class EventRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Source check used so events don't depend on the orders feature (no circular module import). */
  async orderExists(orderId: string, tx: Prisma.TransactionClient = this.prisma): Promise<boolean> {
    const row = await tx.paymentOrder.findUnique({ where: { id: orderId }, select: { id: true } });
    return row !== null;
  }

  async record(input: NewEventInput, tx: Prisma.TransactionClient): Promise<Event> {
    return tx.event.create({ data: input });
  }
}
```

`src/events/events.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Event } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { ResourceNotFoundError } from '../common/errors.js';
import { EventRepository } from './events.repository.js';
import { ProjectionService } from '../operations/projection.service.js';

export interface RecordEventInput {
  paymentOrderId: string;
  eventType: string;
  note?: string;
  occurredAt?: Date;
}

@Injectable()
export class EventService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventRepository,
    private readonly projection: ProjectionService,
  ) {}

  async record(input: RecordEventInput): Promise<Event> {
    return this.prisma.transaction(async (tx) => {
      if (!(await this.events.orderExists(input.paymentOrderId, tx))) {
        throw new ResourceNotFoundError(`Payment order ${input.paymentOrderId} does not exist`, { orderId: input.paymentOrderId });
      }
      const event = await this.events.record(
        { paymentOrderId: input.paymentOrderId, eventType: input.eventType, note: input.note, occurredAt: input.occurredAt ?? new Date() },
        tx,
      );
      await this.projection.applyEvent(tx, event);
      return event;
    });
  }
}
```

`src/events/events.controller.ts`:

```ts
import { Body, Controller, Get?, Param, Post } from '@nestjs/common';
import { EventService, RecordEventInput } from './events.service.js';
import { ValidationError } from '../common/errors.js';

@Controller('orders')  // hmm — route /orders/:orderId/events; two controllers on 'orders' (OrdersController and EventsController) — Nest allows multiple controllers with the same prefix.
export class EventsController {
  constructor(private readonly events: EventService) {}

  @Post(':orderId/events')
  record(@Param('orderId') orderId: string, @Body() body: Record<string, unknown>): Event {
    const { eventType, note, occurredAt } = validateEventBody(body);
    return this.events.record({ paymentOrderId: orderId, eventType, note, occurredAt });
  }
}
```

Validation: orderId uuid, eventType non-empty string, note optional string, occurredAt optional ISO. On failure, a ValidationError with a details map.

Write a small helper in `src/common/validation.ts`:

```ts
import { ValidationError } from './errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseUuid(value: unknown, field: string, out: Record<string, unknown>): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) { out[field] = 'must be a UUID'; return ''; }
  return value;
}

export function parseOptionalIsoDate(value: unknown, field: string, out: Record<string, unknown>): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') { out[field] = 'must be an ISO-8601 date string'; return undefined; }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) { out[field] = 'must be a valid ISO-8601 date'; return undefined; }
  return d;
}

export function parsePositiveInt(value: unknown, field: string, max: number, out: Record<string, unknown>): number | undefined {...}

export function finishValidation(out: Record<string, unknown>): void {
  if (Object.keys(out).length > 0) throw new ValidationError('Invalid request parameters', out);
}
```

Controller pattern:

```ts
const errors: Record<string, unknown> = {};
const companyId = parseUuid(query.companyId, 'companyId', errors);
...
finishValidation(errors);
```

But note: a failed uuid returns '' — subsequent code must not use it. finishValidation throws before use. TS: `companyId`'s type is string (possibly '') — fine.

`src/orders/orders.controller.ts`:

```ts
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  create(@Body() body: Record<string, unknown>) {
    const errors: Record<string, unknown> = {};
    const companyId = parseUuid(body.companyId, 'companyId', errors);
    const workerId = parseUuid(body.workerId, 'workerId', errors);
    const amountCents = parseInt(body.amountCents, 'amountCents', errors, { min: 0 });
    const currency = parseCurrency(body.currency, errors);
    finishValidation(errors);
    return this.orders.create({ companyId, workerId, amountCents, currency });
  }

  @Post(':id/approve')
  approve(@Param('id') id: string) { requireUuid(id); return this.orders.approve(id); }
  @Post(':id/dispute') ...
  @Post(':id/cancel') ...
  @Post(':id/assign-worker')
  assignWorker(@Param('id') id: string, @Body() body) { requireUuid(id); const workerId = parseUuid(body?.workerId, 'workerId', errors); ... }
}
```

`requireUuid(id)` throws a ValidationError with a details `{ id: 'must be a UUID' }` — or a 404? Malformed id → 400 validation. OK.

Return type: the Prisma PaymentOrder object is JSON-serializable (dates → strings, ints fine). I won't use class-serializer; return the DTO as-is? The PaymentOrder includes only the scalar fields (no relation) → safe JSON. The Event is the same. Fine — but should the controller return a DTO? "Controller validates input and calls the service. Zero business logic." Returning the entity is fine.

`src/operations/projection.repository.ts` — the heart. Raw SQL in Prisma.

```ts
import { Injectable } from '@nestjs/common';
import { OrderStatus, OperationRow, Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';

export interface OrderSnapshot {
  paymentOrderId: string;
  companyId: string;
  workerId: string;
  status: OrderStatus;
  amountCents: number;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface EventSnapshot {
  id: string;
  paymentOrderId: string;
  eventType: string;
  occurredAt: Date;
}

export interface TotalsDelta {
  companyId: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  amountCents: number;
}

type Db = Prisma.TransactionClient | PrismaClient;

const TOTALS_COLUMNS: Record<OrderStatus, { amount: string; count: string }> = {
  pending:   { amount: 'pending_amount_cents',   count: 'pending_count' },
  approved:  { amount: 'approved_amount_cents',  count: 'approved_count' },
  disputed:  { amount: 'disputed_amount_cents',  count: 'disputed_count' },
  cancelled: { amount: 'cancelled_amount_cents', count: 'cancelled_count' },
};

@Injectable()
export class ProjectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Dashboard: the read path touches only operation_rows (the projection). */
  listOperations(filter: {
    companyId?: string;
    status?: OrderStatus;
    from?: Date;
    to?: Date;
    skip: number;
    take: number;
  }): Promise<OperationRow[]> {
    return this.prisma.operationRow.findMany({
      where: {
        ...(filter.companyId ? { companyId: filter.companyId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.from || filter.to ? { createdAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lt: filter.to } : {}) } } : {}),
      },
      orderBy: [{ updatedAt: 'desc' }, { paymentOrderId: 'desc' }],
      skip: filter.skip,
      take: filter.take,
    });
  }

  countOperations(filter: {...same minus pagination}): Promise<number> {
    return this.prisma.operationRow.count({ where: {...} });
  }

  getTotals(companyId: string): Promise<CompanyFinancialTotals | null> {
    return this.prisma.companyFinancialTotals.findUnique({ where: { companyId } });
  }

  findOperationRow(tx: Db, paymentOrderId: string): Promise<OperationRow | null> {
    return tx.operationRow.findUnique({ where: { paymentOrderId } });
  }

  /** Hook: upsert the order's operation row. The worker name is re-read from the source inside the statement. */
  async upsertOperationRow(tx: Db, order: OrderSnapshot): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO operation_rows (payment_order_id, company_id, status, worker_name, amount_cents, currency, created_at, updated_at)
      VALUES (${order.paymentOrderId}, ${order.companyId}, ${order.status},
              (SELECT name FROM workers WHERE id = ${order.workerId}),
              ${order.amountCents}, ${order.currency}, ${order.createdAt}, ${order.updatedAt})
      ON CONFLICT (payment_order_id) DO UPDATE SET
        company_id   = excluded.company_id,
        status       = excluded.status,
        worker_name  = excluded.worker_name,
        amount_cents = excluded.amount_cents,
        currency     = excluded.currency,
        updated_at   = excluded.updated_at
    `;
  }
```

Wait: `status` is an enum type "OrderStatus" — passing a JS string via Prisma raw: the parameter type is unknown to Postgres? In `INSERT INTO ... VALUES ($3, ...)` where the column is `"OrderStatus"`, the parameter is inferred as that type? Does Postgres infer unknown literals against the column type on INSERT? The parameter's `$3` in an INSERT VALUES gets the column's type via assignment — yes, Postgres resolves the unknown-typed parameter to the column type on INSERT (like an assignment cast). I believe it works: `INSERT INTO t (status) VALUES ($1)` with a text param — the parameter is `unknown` and is assigned to the enum column → works. Prisma sends the string parameter; the server coerces. I'm fairly confident this works (a common pattern). To be safe, I can add `::"OrderStatus"`? Hmm, `$executeRaw` with a template + `::"OrderStatus"` cast after the parameter: `VALUES (${order.status}::"OrderStatus")` — hmm, wait, but in Prisma's tagged template, `${...}` becomes `$N` — adding the cast suffix to the template string is fine: `${order.status}::"OrderStatus"`. I'll add the explicit cast for certainty. Hmm — but actually in re-derivation, I select from payment_orders (already enum) so no cast needed. In the upsert, add the cast. Also the drift check SQL compares `r.status IS DISTINCT FROM o.status` — both enum, fine.

  /** Hook: atomic in-place delta on the company totals row — no read-modify-write. */
  async applyTotalsDelta(tx: Db, delta: TotalsDelta): Promise<void> {
    const to = TOTALS_COLUMNS[delta.toStatus];
    const from = delta.fromStatus ? TOTALS_COLUMNS[delta.fromStatus] : null;
    if (from) {
      await tx.$executeRaw`
        INSERT INTO company_financial_totals (company_id, ${to.amount}, ${to.count}, updated_at)
        VALUES (${delta.companyId}, ${delta.amountCents}, 1, now())
        ON CONFLICT (company_id) DO UPDATE SET
          ${to.amount} = company_financial_totals.${to.amount} + ${delta.amountCents},
          ${to.count} = company_financial_totals.${to.count} + 1,
          ${from.amount} = company_financial_totals.${from.amount} - ${delta.amountCents},
          ${from.count} = company_financial_totals.${from.count} - 1,
          updated_at = now()
      `;
    } else {
      await tx.$executeRaw`
        INSERT INTO company_financial_totals (company_id, ${to.amount}, ${to.count}, updated_at)
        VALUES (${delta.companyId}, ${delta.amountCents}, 1, now())
        ON CONFLICT (company_id) DO UPDATE SET
          ${to.amount} = company_financial_totals.${to.amount} + ${delta.amountCents},
          ${to.count} = company_financial_totals.${to.count} + 1,
          updated_at = now()
      `;
    }
  }

Wait — `${to.amount}` inside the template is interpolated as a parameter! I need to build column names into the SQL text, not parameterize them. Prisma's tagged template: `${expr}` where expr is a number/string → becomes a bound parameter `$1`. I need to inject an identifier. Solution: build the SQL string with the column names concatenated (safe: from a fixed map) and use the tagged template only for the value parameters. Mixed: I can construct the query text via a template literal and pass it to `$executeRaw` as a `Prisma.Sql`? Use `Prisma.sql`? In Prisma 5: `tx.$executeRaw(Prisma.sql\`...\`)`? The modern API: `tx.$executeRaw` accepts a tagged template or a `Prisma.Sql` instance: `tx.$executeRaw(Prisma.raw(...))` is unsafe; `Prisma.sql\`...\`` is safe with interpolation. To mix identifier interpolation and parameter interpolation, I build the SQL string with string concatenation (identifiers from the fixed map) and use the safe tagged template for the values:

Option: build the entire SQL as a plain string with placeholders, then use `tx.$executeRawUnsafe(sql, ...params)`? That's the "unsafe" API but the identifiers come from my fixed map and the values are parameterized — acceptable and clear. Hmm, the `unsafe` name is scary but it's standard. Alternatively the `Prisma.sql` helper: `Prisma.sql` supports `.toSQL()`. I can do:

```ts
const toAmt = Prisma.sql`${to.amount}`; // hmm — this interpolates to.amount as a PARAMETER, not text!
```

No — `Prisma.sql` interpolates values as parameters too. There's no identifier interpolation. So the clean approach: build the SQL string with string concatenation (identifiers from my fixed map) and use `Prisma.sql` for the values? Mixing isn't trivial.

Cleanest: `$executeRawUnsafe` with a fully concatenated string and `?`/`$n` placeholders + params array. Wait, what's the syntax for $executeRawUnsafe placeholders? It uses the same `$1..$n`? Docs: `$executeRawUnsafe(queryString, ...values)` — values correspond to `$1, $2, ...`? Hmm, actually the raw unsafe API: `prisma.$executeRawUnsafe('UPDATE ... WHERE id = $1', id)`? Let me recall — in Prisma 5, `$executeRawUnsafe("SELECT $1", "abc")`? I believe unsafe takes values that bind to `$1..$n` positions (the old $queryRawUnsafe used `$1`). Yes: the older API used `$1`-style positional placeholders for the unsafe variant. Hmm, in Prisma 4/5: `$queryRawUnsafe` — "the unsafe version… placeholders are $1, $2" — actually the old docs: `prisma.$queryRawUnsafe('SELECT * FROM users WHERE id = $1', userId)`. Yes, positional.

To be safe and modern, I'll use the tagged-template safe API and construct the SQL text so that identifiers are concatenated before the tag call:

```ts
const sql = `
  INSERT INTO company_financial_totals (company_id, ${to.amount}, ${to.count}, updated_at)
  VALUES ($1, $2, $3, now())
  ON CONFLICT (company_id) DO UPDATE SET
    ${to.amount} = company_financial_totals.${to.amount} + $2,
    ${to.count} = company_financial_totals.${to.count} + $3,
    ${from.amount} = company_financial_totals.${from.amount} - $4,
    ${from.count} = company_financial_totals.${from.count} - $4,
    updated_at = now()
`;
await tx.$executeRawUnsafe(sql, delta.companyId, delta.amountCents, 1, delta.amountCents);
```

Hmm wait, `$executeRawUnsafe` — is it still available in Prisma 5? Yes (deprecated? No — `Prisma.$executeRaw` (tagged) is recommended, and unsafe still exists; in 5.x it's available). OK.

Actually — an alternative cleaner idea: use Prisma's own `upsert` with the `increment` operator to avoid raw SQL here! `tx.companyFinancialTotals.upsert({ where: { companyId }, create: {...}, update: {...} })` — but the upsert branches can't conditionally decrement a different column based on existence… the update branch needs both the increment of `to` and the decrement of `from` — expressible: `update: { approvedAmountCents: { increment: x }, approvedCount: { increment: 1 }, pendingAmountCents: { decrement: x }, pendingCount: { decrement: 1 } }` — Prisma's `decrement` ✓. And `create: { companyId, approvedAmountCents: x, approvedCount: 1, updatedAt: new Date() }` — but if the row was missing, the `from` decrement doesn't apply (correct! If the totals row was missing, there was nothing to decrement… well, if the operation row existed with a pending status but the totals row was missing → undercounted; the insert branch only adds the new bucket → converges via drift repair; acceptable). But the branch choice: Prisma's upsert create/update is fixed — create doesn't apply the decrement, update does. Exactly the semantics I want! And "make the update atomic in the database — an in-place increment" — `increment`/`decrement` operators = atomic in-place ✓. No raw SQL needed, fully typed, no identifier injection.

But wait — one subtlety: the create branch sets `updatedAt: new Date()`; the update branch sets `updatedAt: new Date()` via `updatedAt: new Date()` (a plain set, fine).

But the from-status is known at call time (the service reads the prev row). If the prev row was null → fromStatus is null → only the to-bucket delta in both branches. If prev exists → both. Two code paths building the upsert args. Typed, clean:

```ts
async applyTotalsDelta(tx: Db, delta: TotalsDelta): Promise<void> {
  const to = TOTALS_OPERATORS[delta.toStatus];   // { amount: 'approvedAmountCents', count: 'approvedCount' }
  const create: Record<string, unknown> = { companyId: delta.companyId, updatedAt: new Date() };
  const update: Record<string, unknown> = { updatedAt: new Date() };
  create[to.amount] = delta.amountCents; create[to.count] = 1;
  update[to.amount] = { increment: delta.amountCents }; update[to.count] = { increment: 1 };
  if (delta.fromStatus && delta.fromStatus !== delta.toStatus) {
    const from = TOTALS_OPERATORS[delta.fromStatus];
    update[from.amount] = { decrement: delta.amountCents }; update[from.count] = { decrement: 1 };
  }
  await tx.companyFinancialTotals.upsert({ where: { companyId: delta.companyId }, create, update });
}
```

Typing: the Prisma `create` input type is `CompanyFinancialTotalsCreateInput` — I can type it as that with an object literal; building it dynamically → cast to the input type. I'll write it with a proper type:

```ts
const create: CompanyFinancialTotalsCreateInput = { companyId, updatedAt: new Date(), [to.amount]: delta.amountCents, [to.count]: 1 } as CompanyFinancialTotalsCreateInput;
```

A computed key with a cast — acceptable. Prisma supports `increment`/`decrement` inside upsert's `update` — let me double-check: Prisma docs "upsert" — the update field accepts update operators? Docs: `onConflictDoUpdate: { update: { count: { increment: 1 } } }` — I'm fairly sure the Prisma docs show an upsert with increment. Yes, the docs have an example: `user.upsert({ where, update: { posts: { connect } }, create })`… and the "aggregations" docs show `count: { increment }` on `update` and `upsert`. Confident enough.

Hmm, but does `update: { pendingAmountCents: { decrement: x } }` inside an upsert work? Same update semantics as `update` → operators allowed. OK.

This completely avoids raw SQL for the hook — better, typed. The raw SQL remains for: re-derivation, totals recompute, drift scan. Those are set-based maintenance — raw SQL in the repository is appropriate.

But wait — the upsert approach and the "read prev row" approach: the service reads the prev operation_row to determine the fromStatus. Two concurrent writes to the same order: serialized by the source transition (guarded) or both apply (assign + event) — for the same order, the prev read: both txs read the same prev (e.g. pending); one does approve (pending→approved, delta pending−approved+), the other does cancel (guarded transition fails → rolls back before touching the projection). ✓. Different orders same company: the prev rows differ; the totals upsert is atomic with the increment operators. ✓

But there's a subtle race in the totals: two different orders of the same company both transition from pending; both read their own prev operation row (pending) ✓ no shared read. The upsert increments are serialized by the row lock. Exact. ✓

Another subtlety: the `create` branch when the totals row is missing: concurrent first-order-creation for the same company: two upserts → one inserts, the other on-conflict updates → both deltas applied (insert 1000, then update +2500) ✓ exact.

Good — the hook is pure Prisma (typed), no raw SQL.

Now the raw SQL part:

`rederiveWindow(tx, from, to)`:

```ts
async rederiveWindow(tx: Db, from: Date, to: Date): Promise<number> {
  const result = await tx.$executeRaw`
    WITH latest_event AS (
      SELECT DISTINCT ON (payment_order_id)
             payment_order_id, event_type, occurred_at, id
      FROM events
      WHERE occurred_at >= ${from}
      ORDER BY payment_order_id, occurred_at DESC, id DESC
    ),
    rebuilt AS (
      SELECT
             o.id        AS payment_order_id,
             o.company_id,
             o.status,
             w.name      AS worker_name,
             o.amount_cents,
             o.currency,
             le.event_type AS latest_event_type,
             le.occurred_at AS latest_event_at,
             le.id       AS latest_event_id,
             o.created_at,
             o.updated_at
      FROM payment_orders o
      JOIN workers w ON w.id = o.worker_id
      LEFT JOIN latest_event le ON le.payment_order_id = o.id
      WHERE o.created_at >= ${from} AND o.created_at < ${to}
    )
    INSERT INTO operation_rows (payment_order_id, company_id, status, worker_name, amount_cents, currency, latest_event_type, latest_event_at, latest_event_id, created_at, updated_at)
    SELECT payment_order_id, company_id, status, worker_name, amount_cents, currency, latest_event_type, latest_event_at, latest_event_id, created_at, updated_at
    FROM rebuilt
    ON CONFLICT (payment_order_id) DO UPDATE SET
      company_id        = excluded.company_id,
      status            = excluded.status,
      worker_name       = excluded.worker_name,
      amount_cents      = excluded.amount_cents,
      currency          = excluded.currency,
      latest_event_type = excluded.latest_event_type,
      latest_event_at   = excluded.latest_event_at,
      latest_event_id   = excluded.latest_event_id,
      created_at        = excluded.created_at,
      updated_at        = excluded.updated_at
  `;
  return Number(result);
}
```

`$executeRaw` returns the row count (bigint) for INSERT/UPDATE. ✓

Hmm — a concern: the windowed re-derivation while live: orders in the window whose status changed after `to` (created in the window, updated later) — rebuilt uses the source's current state at snapshot time (status is current) ✓ — the window only limits which orders to rebuild, not the data's freshness.

`recomputeTotals(tx)`:

```ts
async recomputeTotals(tx: Db): Promise<void> {
  await tx.$executeRaw`
    WITH agg AS (
      SELECT company_id,
             COALESCE(SUM(amount_cents) FILTER (WHERE status = 'pending'), 0)::bigint   AS pending_amount_cents,
             COUNT(*) FILTER (WHERE status = 'pending')::bigint                        AS pending_count,
             COALESCE(SUM(amount_cents) FILTER (WHERE status = 'approved'), 0)::bigint  AS approved_amount_cents,
             COUNT(*) FILTER (WHERE status = 'approved')::bigint                       AS approved_count,
             COALESCE(SUM(amount_cents) FILTER (WHERE status = 'disputed'), 0)::bigint  AS disputed_amount_cents,
             COUNT(*) FILTER (WHERE status = 'disputed')::bigint                       AS disputed_count,
             COALESCE(SUM(amount_cents) FILTER (WHERE status = 'cancelled'), 0)::bigint AS cancelled_amount_cents,
             COUNT(*) FILTER (WHERE status = 'cancelled')::bigint                      AS cancelled_count
      FROM payment_orders
      GROUP BY company_id
    ),
    all_companies AS (
      SELECT id FROM companies
      UNION SELECT company_id FROM payment_orders
    )
    INSERT INTO company_financial_totals
      (company_id, pending_amount_cents, pending_count, approved_amount_cents, approved_count,
       disputed_amount_cents, disputed_count, cancelled_amount_cents, cancelled_count, updated_at)
    SELECT a.id, 0, 0, 0, 0, 0, 0, 0, 0, now()
    FROM all_companies a
    LEFT JOIN agg ON agg.company_id = a.id
    ...
```

Hmm — this is getting complex: for companies with no orders → zero rows. Simpler: only recompute for companies with orders (agg), and the `totals()` service returns zero for missing rows. A zero-order company's totals endpoint → zero (handled in the service). So:

```sql
WITH agg AS (
  SELECT company_id, ... FILTER ... GROUP BY company_id
)
INSERT INTO company_financial_totals (company_id, pending_amount_cents, pending_count, approved_amount_cents, approved_count, disputed_amount_cents, disputed_count, cancelled_amount_cents, cancelled_count, updated_at)
SELECT company_id, pending_amount_cents, pending_count, approved_amount_cents, approved_count, disputed_amount_cents, disputed_count, cancelled_amount_cents, cancelled_count, now()
FROM agg
ON CONFLICT (company_id) DO UPDATE SET
  pending_amount_cents   = excluded.pending_amount_cents,
  pending_count          = excluded.pending_count,
  approved_amount_cents  = excluded.approved_amount_cents,
  approved_count         = excluded.approved_count,
  disputed_amount_cents  = excluded.disputed_amount_cents,
  disputed_count         = excluded.disputed_count,
  cancelled_amount_cents = excluded.cancelled_amount_cents,
  cancelled_count        = excluded.cancelled_count,
  updated_at             = now();
```

Wait — the `COUNT(*) FILTER (...)::bigint` — CAST precedence: `COUNT(*) FILTER (WHERE ...)::bigint` — does the `::` apply to the FILTER result? In Postgres, `expr FILTER (...) :: type` — the cast applies to the whole `expr FILTER (...)` ✓. And `pending_count` is INTEGER in the table — inserting bigint 0 → coerces ✓. Actually simpler: keep count as int (`COUNT(*) FILTER (WHERE ...)` is already bigint in PG! `COUNT` returns bigint → inserting into an int column is fine). Drop the `::bigint` on counts. For SUM: `SUM(integer)` → bigint in PG ✓ so `COALESCE(SUM(...), 0)` → bigint ✓ no cast needed.

And the DELETE for stale rows:

```sql
DELETE FROM company_financial_totals cft
WHERE NOT EXISTS (SELECT 1 FROM payment_orders po WHERE po.company_id = cft.company_id);
```

(Run after the upsert; a company with no orders loses its row → zero on the endpoint.) Combine both statements into one `$executeRaw`? Multiple statements in one raw call — does Prisma allow multi-statement in a single `executeRaw`? It goes through a single query — the Postgres driver (pg) supports multiple statements in one simple query… Prisma's `$executeRaw` uses the extended protocol? Multi-statement in extended protocol is not allowed. Safer: two separate `$executeRaw` calls inside the same tx. I'll do that.

`findDriftedOrderIds(tx, from, to)`:

```ts
const rows = await tx.$queryRaw<{ id: string }[]>`
  WITH latest_event AS (
    SELECT DISTINCT ON (payment_order_id) payment_order_id, id AS event_id, event_type, occurred_at
    FROM events
    WHERE occurred_at >= ${from}
    ORDER BY payment_order_id, occurred_at DESC, id DESC
  )
  SELECT o.id
  FROM payment_orders o
  JOIN workers w ON w.id = o.worker_id
  LEFT JOIN operation_rows r ON r.payment_order_id = o.id
  LEFT JOIN latest_event le ON le.payment_order_id = o.id
  WHERE o.created_at >= ${from} AND o.created_at < ${to}
    AND (
      r.id IS NULL
      OR r.status IS DISTINCT FROM o.status
      OR r.company_id IS DISTINCT FROM o.company_id
      OR r.worker_name IS DISTINCT FROM w.name
      OR r.amount_cents IS DISTINCT FROM o.amount_cents
      OR r.currency IS DISTINCT FROM o.currency
      OR r.latest_event_id IS DISTINCT FROM le.event_id
    )
`;
return rows.map(r => r.id);
```

`$queryRaw` with a generic type param + tagged template — `tx.$queryRaw<{ id: string }>\`...\`` ✓.

`findTotalsDriftedCompanyIds(tx, from, to)`:

```ts
const rows = await tx.$queryRaw<{ company_id: string }[]>`
  SELECT t.company_id
  FROM company_financial_totals t
  WHERE EXISTS (
    SELECT 1 FROM payment_orders po
    WHERE po.company_id = t.company_id AND (po.created_at >= ${from} OR po.updated_at >= ${from})
  )
  AND NOT EXISTS (
    SELECT 1 FROM (
      SELECT po2.company_id,
             COALESCE(SUM(po2.amount_cents) FILTER (WHERE po2.status = 'pending'), 0)   AS pending_amount,
             COUNT(*) FILTER (WHERE po2.status = 'pending')                             AS pending_count,
             COALESCE(SUM(po2.amount_cents) FILTER (WHERE po2.status = 'approved'), 0)  AS approved_amount,
             COUNT(*) FILTER (WHERE po2.status = 'approved')                            AS approved_count,
             COALESCE(SUM(po2.amount_cents) FILTER (WHERE po2.status = 'disputed'), 0)  AS disputed_amount,
             COUNT(*) FILTER (WHERE po2.status = 'disputed')                            AS disputed_count,
             COALESCE(SUM(po2.amount_cents) FILTER (WHERE po2.status = 'cancelled'), 0) AS cancelled_amount,
             COUNT(*) FILTER (WHERE po2.status = 'cancelled')                           AS cancelled_count
      FROM payment_orders po2
      WHERE po2.company_id = t.company_id
      GROUP BY po2.company_id
    ) s
    WHERE s.pending_amount IS DISTINCT FROM t.pending_amount_cents
       OR s.pending_count  IS DISTINCT FROM t.pending_count
       OR s.approved_amount IS DISTINCT FROM t.approved_amount_cents
       OR s.approved_count  IS DISTINCT FROM t.approved_count
       OR s.disputed_amount IS DISTINCT FROM t.disputed_amount_cents
       OR s.disputed_count  IS DISTINCT FROM t.disputed_count
       OR s.cancelled_amount IS DISTINCT FROM t.cancelled_amount_cents
       OR s.cancelled_count  IS DISTINCT FROM t.cancelled_count
  )
```

`NOT EXISTS (... WHERE mismatch)`: if no row in `s` (a company with zero orders) → the NOT EXISTS is true → flagged as drifted → but if a company has no orders, its totals row was deleted by the recompute… but in the drift check, a totals row for a zero-order company shouldn't exist (the recompute deletes it). If it does (drift), the flag → the fix (the recompute deletes it) ✓ consistent.

Wait, but if the `EXISTS (orders changed in the window)` condition is false and the totals are drifted — we don't flag it. Example: a company with old orders, totals drifted, no changes in the window → missed. But drift only arises from a change (a failed write, a manual fix); the manual fix touches updated_at or created_at… a manual fix to the projection itself (not the source) wouldn't change the source's updated_at → missed by the window-based check. Hmm. The spec says "periodically compare projection vs source over a recent window" — window-based by design. But my drift test injects drift directly into the projection (source is untouched since the seed's created/updated_at is within the window anyway — the seed is fresh so the orders' created_at/updated_at are in the window ✓ the EXISTS condition is true). Fine per spec: window-based. I'll document in DESIGN.md that the window covers the recent activity; a full-scan mode is out of scope (I can note it).

Hmm, actually wait: if the drift was injected into the projection only (e.g. I manually corrupted the row), the source's updated_at hasn't changed — but the source row's created_at/updated_at is still within the last 24 hours (freshly seeded) → flagged ✓. In production, corruption older than the window is only caught on subsequent changes — an acceptable documented trade-off (a scheduled full re-derivation can be run manually; the routine exists).

`src/operations/projection.service.ts` (the hook — business logic):

```ts
import { Injectable } from '@nestjs/common';
import { Event, OrderStatus, PaymentOrder, Prisma } from '@prisma/client';
import { ProjectionRepository } from './projection.repository.js';

type Tx = Prisma.TransactionClient;

@Injectable()
export class ProjectionService {
  constructor(private readonly projection: ProjectionRepository) {}

  /**
   * Maintenance hook: sync the read models for a single order mutation.
   * Called by the write service inside the write's transaction:
   * read-your-own-writes + rollback safety.
   */
  async applyOrderChange(tx: Tx, order: Pick<PaymentOrder, 'id'|'companyId'|'workerId'|'status'|'amountCents'|'currency'|'createdAt'|'updatedAt'>): Promise<void> {
    const prev = await this.projection.findOperationRow(tx, order.id);
    await this.projection.upsertOperationRow(tx, {
      paymentOrderId: order.id,
      companyId: order.companyId,
      workerId: order.workerId,
      status: order.status,
      amountCents: order.amountCents,
      currency: order.currency,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    });
    const fromStatus: OrderStatus | null = prev && prev.status !== order.status ? prev.status : null;
    if (fromStatus) {
      await this.projection.applyTotalsDelta(tx, { companyId: order.companyId, fromStatus, toStatus: order.status, amountCents: order.amountCents });
    } else if (!prev) {
      // A new order: add to the current bucket (no bucket to move from).
      await this.projection.applyTotalsDelta(tx, { companyId: order.companyId, fromStatus: null, toStatus: order.status, amountCents: order.amountCents });
    }
    // else: status unchanged (e.g. worker reassignment) → totals untouched.
  }

  async applyEvent(tx: Tx, event: Pick<Event, 'id'|'paymentOrderId'|'eventType'|'occurredAt'>): Promise<void> {
    await this.projection.applyLatestEvent(tx, { id: event.id, paymentOrderId: event.paymentOrderId, eventType: event.eventType, occurredAt: event.occurredAt });
  }
}
```

Wait — the `fromStatus` logic: prev exists and prev.status !== order.status → move the bucket. prev exists and same status → no totals change. prev null → add to the new bucket. Correct.

Edge case: prev exists but the company changed? The order's company_id is immutable in my write path (no endpoint to change it). If it did change, the totals delta would use order.companyId for both the from and to buckets — slightly wrong, but no such endpoint; ignore (documented? no, fine).

`applyLatestEvent` in the repository:

```ts
async applyLatestEvent(tx: Db, event: EventSnapshot): Promise<void> {
  await tx.$executeRaw`
    UPDATE operation_rows
    SET latest_event_type = ${event.eventType},
        latest_event_at   = ${event.occurredAt},
        latest_event_id   = ${event.id}
    WHERE payment_order_id = ${event.paymentOrderId}
      AND (latest_event_id IS NULL OR (${event.occurredAt}, ${event.id}) > (latest_event_at, latest_event_id))
  `;
}
```

Row-comparison `(timestamptz, uuid) > (timestamptz, uuid)` ✓.

`upsertOperationRow` — typed via Prisma? It needs the worker name from the source — not possible in Prisma (a create with a subselect). So raw SQL here, with the enum cast:

```ts
await tx.$executeRaw`
  INSERT INTO operation_rows (payment_order_id, company_id, status, worker_name, amount_cents, currency, created_at, updated_at)
  VALUES (${order.paymentOrderId}, ${order.companyId}, ${order.status}::"OrderStatus",
          (SELECT name FROM workers WHERE id = ${order.workerId}),
          ${order.amountCents}, ${order.currency}, ${order.createdAt}, ${order.updatedAt})
  ON CONFLICT (payment_order_id) DO UPDATE SET
    company_id   = excluded.company_id,
    status       = excluded.status,
    worker_name  = excluded.worker_name,
    amount_cents = excluded.amount_cents,
    currency     = excluded.currency,
    updated_at   = excluded.updated_at
`;
```

`(${...}, ${...}) > (...)` — the parameter inside the row expression: `$3 > ...` — Postgres: `($3, $4) > (latest_event_at, latest_event_id)` — the row constructor with parameters: the parameter types are inferred from the comparison context ✓.

`src/operations/operations.service.ts`:

```ts
export interface OperationListFilter {
  companyId?: string;
  status?: OrderStatus;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operations: OperationsRepository,
    private readonly projection: ProjectionRepository,
  ) {}

  async list(filter: OperationListFilter) {
    const [items, total] = await Promise.all([
      this.operations.listOperations({...filter, skip: (filter.page - 1) * filter.pageSize, take: filter.pageSize}),
      this.operations.countOperations(filter),
    ]);
    return { items, total, page: filter.page, pageSize: filter.pageSize };
  }

  async totals(companyId: string) {
    const company = await this.operations.companyExists(companyId) ? ... 
```

Hmm, `companyExists` — where? An operations repository method that reads companies? `this.prisma.company.findUnique`. The repository can touch any table. I'll add `companyExists` to `OperationsRepository`. If the company isn't found → ResourceNotFoundError. Then:

```ts
const row = await this.operations.getTotals(companyId);
if (!row) return zeroTotals(companyId);
return mapTotals(row);
```

`mapTotals`: convert BigInt → number:

```ts
function mapTotals(row: CompanyFinancialTotals) {
  return {
    companyId: row.companyId,
    pending: { amountCents: Number(row.pendingAmountCents), count: row.pendingCount },
    approved: { amountCents: Number(row.approvedAmountCents), count: row.approvedCount },
    disputed: { amountCents: Number(row.disputedAmountCents), count: row.disputedCount },
    cancelled: { amountCents: Number(row.cancelledAmountCents), count: row.cancelledCount },
    updatedAt: row.updatedAt,
  };
}
```

`rederive(from, to)`:

```ts
async rederive(from: Date, to: Date): Promise<{ rowsRebuilt: number }> {
  const rowsRebuilt = await this.prisma.transaction(async (tx) => {
    const n = await this.projection.rederiveWindow(tx, from, to);
    await this.projection.recomputeTotals(tx);
    return n;
  });
  return { rowsRebuilt };
}
```

`OperationsRepository` (the typed reads for the dashboard): listOperations, countOperations, getTotals, companyExists. And `ProjectionRepository` (the raw/maintenance). Two repositories in the operations feature — fine.

`src/operations/drift-repair.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service.js';
import { ProjectionRepository } from './projection.repository.js';

const DEFAULT_WINDOW_HOURS = 24;

@Injectable()
export class DriftRepairService {
  private readonly logger = new Logger(DriftRepairService.name);
  private readonly windowMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly projection: ProjectionRepository,
  ) {
    const hours = Number(process.env.DRIFT_REPAIR_WINDOW_HOURS ?? DEFAULT_WINDOW_HOURS);
    this.windowMs = (Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_WINDOW_HOURS) * 3_600_000;
  }

  /** Scheduled drift repair: compare the projection vs the source over a recent window and converge. */
  @Cron(process.env.DRIFT_REPAIR_CRON ?? '*/5 * * * *')
  async run(): Promise<DriftRepairReport> {
    const to = new Date();
    const from = new Date(to.getTime() - this.windowMs);
    try {
      const report = await this.prisma.transaction(async (tx) => {
        const driftedOrderIds = await this.projection.findDriftedOrderIds(tx, from, to);
        let rowsRepaired = 0;
        if (driftedOrderIds.length > 0) {
          rowsRepaired = await this.projection.rederiveWindow(tx, from, to);
        }
        const driftedCompanyIds = await this.projection.findTotalsDriftedCompanyIds(tx, from, to);
        let totalsRecomputed = false;
        if (driftedCompanyIds.length > 0) {
          await this.projection.recomputeTotals(tx);
          totalsRecomputed = true;
        }
        return { from, to, driftedOrders: driftedOrderIds.length, rowsRepaired, driftedTotalsCompanies: driftedCompanyIds.length, totalsRecomputed };
      });
      if (report.driftedOrders > 0 || report.driftedTotalsCompanies > 0) {
        this.logger.warn(`Drift repaired: ${report.driftedOrders} order rows, ${report.driftedTotalsCompanies} companies' totals (window ${report.from.toISOString()}..${report.to.toISOString()})`);
      }
      return report;
    } catch (err) {
      this.logger.error(`Drift repair failed for window ${from.toISOString()}..${to.toISOString()}: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }
}
```

The export interface DriftRepairReport is defined here.

Cron decorator argument: `@Cron(process.env.DRIFT_REPAIR_CRON ?? '*/5 * * * *')` — evaluated at class definition time ✓.

`src/operations/operations.controller.ts`:

```ts
@Controller('operations')
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get()
  list(@Query() query: Record<string, string>) {
    const errors: Record<string, unknown> = {};
    const companyId = parseUuidParam(query.companyId, 'companyId', errors);
    const status = parseStatusParam(query.status, 'status', errors);
    const from = parseOptionalIsoDate(query.from, 'from', errors);
    const to = parseOptionalIsoDate(query.to, 'to', errors);
    const page = parsePositiveInt(query.page, 'page', errors, 1) ?? 1;
    const pageSize = parsePositiveInt(query.pageSize, 'pageSize', errors, 100) ?? 20;
    if (from && to && !from.toISOString() < to.toISOString()) { errors.to = 'must be after "from"'; }
    finishValidation(errors);
    return this.operations.list({ companyId: companyId || undefined, status: status ?? undefined, from, to, page, pageSize });
  }
```

Note: `from < to` comparison: `!(from < to)` → error. Write it as `if (from && to && from >= to) errors.to = ...`.

`@Get('companies/:companyId/financial-totals')` — a route inside the 'operations' controller → `/operations/companies/:companyId/financial-totals`. Hmm, I wanted `/companies/...` earlier. Either is fine; nesting under operations keeps a single controller: `GET /operations/companies/:companyId/financial-totals`. Hmm, the endpoint is kebab-case plural — `financial-totals` ✓. I'll go with this.

`@Post('rederive')` body {from, to} required ISO → `operationsService.rederive(from, to)`.

`src/operations/operations.module.ts`:

```ts
@Module({
  imports: [DatabaseModule],
  controllers: [OperationsController],
  providers: [OperationsService, OperationsRepository, ProjectionRepository, ProjectionService, DriftRepairService],
  exports: [ProjectionService],
})
export class OperationsModule {}
```

`src/orders/orders.module.ts`:

```ts
@Module({
  imports: [DatabaseModule, EventsModule, OperationsModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersRepository],
})
export class OrdersModule {}
```

`src/events/events.module.ts`:

```ts
@Module({
  imports: [DatabaseModule, OperationsModule],
  controllers: [EventsController],
  providers: [EventService, EventRepository],
  exports: [EventRepository],
})
export class EventsModule {}
```

Wait — OrdersModule uses EventRepository (for the audit event in approve) → import EventsModule ✓ (it exports EventRepository). EventsModule doesn't import OrdersModule ✓ no cycle.

But hmm: the OrdersController and the EventsController both use the `@Controller('orders')` prefix — two controllers with the same prefix are allowed in Nest (they register different paths). ✓

Now — **a subtle issue with the Prisma client and the test DB**: tests require Postgres with the schema applied. I'll document in DESIGN.md: `prisma migrate deploy` (or `db push`) before tests; `DATABASE_URL` env. Also a test helper that asserts the connection works with a clear message.

**Test files**:

`test/helpers.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe? no } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { DriftRepairService } from '../src/operations/drift-repair.service.js';

export interface TestApp { app: INestApplication; prisma: PrismaService; }

export async function createTestApp(): Promise<TestApp> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must point to a test PostgreSQL database');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DriftRepairService)
    .useValue({ run: () => { throw new Error('scheduled drift repair is disabled in tests'); } })
    .compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  const prisma = moduleRef.get(PrismaService);
  return { app, prisma };
}

export interface Seed {
  companyId: string;
  companyName: string;
  workerId: string;
  workerName: string;
  otherWorkerId: string;
  otherWorkerName: string;
}

export async function seedCompanyWithWorkers(prisma: PrismaService, namePrefix: string): Promise<Seed> {
  const company = await prisma.company.create({ data: { name: `${namePrefix}-${randomUUID()}` } });
  const worker = await prisma.worker.create({ data: { name: `Worker A (${namePrefix}-${randomUUID().slice(0, 8)})`, companyId: company.id } });
  const otherWorker = await prisma.worker.create({ data: { name: `Worker B (...)`, companyId: company.id } });
  return {...};
}

export async function seedOrder(prisma: PrismaService, companyId: string, workerId: string, amountCents: number): Promise<PaymentOrder> {
  return prisma.paymentOrder.create({ data: { companyId, workerId, amountCents, currency: 'USD' } });
}
```

Wait — a direct `paymentOrder.create` seed bypasses the projection (the source row has no projection row) — for the concurrency test, that's actually what I want (fresh source orders without projection rows, then approve via the service → the projection row is created on approve with fromStatus null). Hmm, but a more realistic seed uses the OrderService.create (which creates the projection row + totals). For the concurrency test: create the orders via the service (so they're on the dashboard as pending), then concurrently approve. The totals: pending→approved delta moves the bucket. The total check: approved = sum. ✓ Either works; using the service's create is more end-to-end. But note: the service's create needs the tx etc. — fine.

In the drift test, I'll seed directly via Prisma to build an exact source state (including events with explicit occurredAt) without relying on the hook — to independently verify that re-derivation produces the correct rows. Then compare the re-derived projection against the expected values from the source.

`test/orders.spec.ts` — read-your-own-writes:

```ts
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestApp, seedCompanyWithWorkers, TestApp } from './helpers.js';
import { OrdersService } from '../src/orders/orders.service.js';
import { OperationsService } from '../src/operations/operations.service.js';
import { ConflictError } from '../src/common/errors.js';

describe('read-your-own-writes', () => {
  let app: TestApp;
  let orderService: OrdersService;
  let operationsService: OperationsService;
  let seed: Seed;

  beforeAll(async () => {
    app = await createTestApp();
    orderService = app.app.get(OrdersService);
    operationsService = app.app.get(OperationsService);
    seed = await seedCompanyWithWorkers(app.prisma, 'ryw');
  });

  afterAll(async () => { await app?.app.close(); });

  it('a newly created order is visible on the next dashboard request, then its approval is', async () => {
    const order = await orderService.create({ companyId: seed.companyId, workerId: seed.workerId, amountCents: 5000, currency: 'USD' });

    const afterCreate = await operationsService.list({ companyId: seed.companyId, page: 1, pageSize: 10 });
    expect(afterCreate.items.map(i => i.paymentOrderId)).toContain(order.id);
    const rowCreated = afterCreate.items.find(i => i.paymentOrderId === order.id)!;
    expect(rowCreated.status).toBe('pending');
    expect(rowCreated.workerName).toBe(seed.workerName);
    expect(rowCreated.amountCents).toBe(5000);

    await orderService.approve(order.id);

    const afterApprove = await operationsService.list({ companyId: seed.companyId, page: 1, pageSize: 10 });
    const rowApproved = afterApprove.items.find(i => i.paymentOrderId === order.id)!;
    expect(rowApproved.status).toBe('approved');
    expect(rowApproved.latestEventType).toBe('approved');

    const totals = await operationsService.totals(seed.companyId);
    expect(totals.approved.amountCents).toBe(5000);
    expect(totals.approved.count).toBe(1);
    expect(totals.pending.amountCents).toBe(0);
  });

  it('a failed transition rolls back atomically: source and projection stay consistent', async () => {
    const order = await orderService.create({ ... amountCents: 1200 });
    const totalsBefore = await operationsService.totals(seed.companyId);
    await expect(orderService.cancel(order.id)).resolves.toBeTruthy();
    // Cancelling a cancelled order must conflict and change nothing
    await expect(orderService.cancel(order.id)).rejects.toThrow(ConflictError);
    const totalsAfter = await operationsService.totals(seed.companyId);
    expect(totalsAfter.cancelled).toEqual(totalsBefore.cancelled); // hmm — the first cancel already moved the bucket; compare before the second cancel
    ...
  });
```

Let me restructure that second test:
1. Create an order (pending) → totals.pending includes it.
2. Cancel it → totals.cancelled includes it, pending decreases.
3. Cancel again → ConflictError.
4. Totals unchanged after the failed attempt; the projection row is still cancelled; the source status is cancelled (verified via the operations list or directly via the prisma source read).

Also a test for a missing order: `orderService.approve(randomUUID())` rejects with ResourceNotFoundError.

`test/concurrency.spec.ts` — concurrent totals:

```ts
describe('concurrent updates to one company totals', () => {
  it('two concurrent approvals both move the totals (no lost update)', async () => {
    const a = await orderService.create({... 1000});
    const b = await orderService.create({... 2500});
    await Promise.all([orderService.approve(a.id), orderService.approve(b.id)]);
    const totals = await operationsService.totals(companyId);
    expect(totals.approved.amountCents).toBe(3500);
    expect(totals.approved.count).toBe(2);
  });

  it('eight concurrent approvals sum exactly', async () => {
    const amounts = [101, 202, 303, 404, 505, 606, 707, 808];
    const orders = [];
    for (const amt of amounts) orders.push(await orderService.create({companyId, workerId, amountCents: amt, currency: 'USD'}));
    await Promise.all(orders.map(o => orderService.approve(o.id)));
    const totals = ...;
    expect(totals.approved.amountCents).toBe(sum(amounts));
    expect(totals.approved.count).toBe(8);
    const list = await operationsService.list({ companyId, status: 'approved', page: 1, pageSize: 100 });
    expect(list.items.filter(i => orders.some(o => o.id === i.paymentOrderId))).toHaveLength(8);
  });
});
```

Each spec file creates its own company (isolated) ✓.

Hmm — one concern: `Promise.all` of approve calls — each is an interactive `$transaction` on the pool. Each approve: a guarded transition on a different order (no lock contention), a totals upsert with increment (contention serialized by the row lock — the lock is held until tx commit; the tx is short) → both applied ✓. With the default pg pool size (5), 8 concurrent interactive txs — Prisma's default pool is 15 (interactive tx needs 1 connection each + a savepoint). 8 concurrent interactive txs → 8 connections ≤ 15 ✓. And pg's max_connections default is 100 ✓.

`test/operations.spec.ts` — re-derivation + drift:

```ts
describe('re-derivation', () => {
  // Seed directly at the source: a company, 2 workers, orders in various statuses, events.
  it('rebuilding a window reproduces the join result, and a second run changes nothing', async () => {
    // Direct source seed
    const company = await prisma.company.create(...);
    const w1 = await prisma.worker.create(...); w2...
    const o1 = await prisma.paymentOrder.create({ data: { companyId, workerId: w1.id, amountCents: 100, currency: 'USD', status: 'approved' } });
    const o2 = ... status 'pending', w2
    const o3 = ... status 'disputed'
    await prisma.event.create({ data: { paymentOrderId: o1.id, eventType: 'field_visit', occurredAt: t1 } });
    await prisma.event.create({ data: { paymentOrderId: o1.id, eventType: 'approved', occurredAt: t2 } }); // the latest
    await prisma.event.create({ data: { paymentOrderId: o2.id, eventType: 'created', occurredAt: t3 } });

    const from = new Date(Date.now() - 60_000), to = new Date(Date.now() + 60_000);
    const first = await operationsService.rederive(from, to);
    expect(first.rowsRebuilt).toBe(3);

    const rowsAfterFirst = await snapshotRows(companyId);
    // Expected values from the source:
    expect(row(o1)).toMatchObject({ status: 'approved', workerName: w1.name, latestEventType: 'approved', latestEventAt: t2, amountCents: 100 });
    expect(row(o3)).toMatchObject({ status: 'disputed', latestEventType: null });

    const totals = await operationsService.totals(companyId);
    expect(totals.approved.amountCents).toBe(100);
    expect(totals.pending.amountCents).toBe(amount of o2);
    expect(totals.disputed.amountCents).toBe(amount of o3);

    const second = await operationsService.rederive(from, to);
    const rowsAfterSecond = await snapshotRows(companyId);
    expect(rowsAfterSecond).toEqual(rowsAfterFirst); // idempotence
  });
});
```

`snapshotRows`: `prisma.operationRow.findMany({ where: { companyId }, orderBy: [{ paymentOrderId: 'asc' }] })` and map to plain objects (stable serialization: dates → ISO strings, for toEqual comparability). Note: the rows between the two re-derives are identical (no writes in between) ✓. Note: `rowsRebuilt` is the number of rows affected by the INSERT...ON CONFLICT → includes DO UPDATE rows (affected rows = rows inserted or updated). On the second run: the rows are updated (the DO UPDATE fires even if the values are the same — Postgres counts a DO UPDATE as affected even if the values are identical, unless there's a `WHERE`/`RETURNING` guard). So rowsRebuilt=3 on both runs ✓ (I won't assert 0 on the second run — I'll assert that the rows are equal).

Hmm wait — a detail: the `ON CONFLICT DO UPDATE` in `rederiveWindow` always sets (even the same values) → affected = the row count. Fine.

Drift spec:

```ts
describe('drift repair', () => {
  it('finds and repairs injected drift in rows and totals', async () => {
    // Rich source state via direct seed (similar to above), first run the drift-repair to establish a correct baseline
    const driftService = new DriftRepairService(prisma as any? ...)
```

Hmm — instantiate DriftRepairService: the constructor needs PrismaService and ProjectionRepository. I can get them from the app context: `app.app.get(ProjectionRepository)` — but I overrode DriftRepairService in the test app! I can override it with the real class… Actually, I only overrode it to prevent the cron. Alternative: don't override, and make sure the cron doesn't interfere: the cron fires every 5 minutes; the test is short. But a mid-test repair could modify rows between assertions (e.g. a drift test: inject drift, before I run it, the cron runs and repairs it → my "before" assertion sees an unexpected state). The risk is real but small (a 5-minute boundary). Cleaner: the test app builds the OperationsModule but with the DriftRepairService override; the drift spec instantiates DriftRepairService manually with the real dependencies:

```ts
const drift = new DriftRepairService(app.app.get(PrismaService), app.app.get(ProjectionRepository));
```

The constructor reads env — fine. And calls `drift.run()` directly. The @Cron decorator on a manually-instantiated class → the decorator ran at class-definition time (registering metadata), but without Nest lifecycle control it never schedules ✓.

Inject drift:
```ts
await prisma.operationRow.update({ where: { paymentOrderId: o1.id }, data: { status: 'pending', workerName: 'corrupted', latestEventType: null, latestEventAt: null, latestEventId: null } });
await prisma.companyFinancialTotals.update({ where: { companyId }, data: { approvedAmountCents: { decrement: 100 }, approvedCount: { decrement: 1 } } });
```
Wait — for the row to exist, the baseline must have been built by a hook or a re-derivation. I'll seed the source directly, run `rederive` once (baseline correct), verify, then corrupt, then `drift.run()` → verify the repair.

But the drift-repair window: the last 24 hours; the seed is fresh ✓.

Corrupting totals: use raw `prisma.companyFinancialTotals.update` with a decrement — Prisma typed ✓.

After `drift.run()`:
- The row for o1 is back to: status approved, workerName w1.name, latestEvent 'approved'@t2.
- The totals match the source aggregate (recompute).
- Assert the report: `report.driftedOrders >= 1`, `report.totalsRecomputed === true`.

Also assert "no drift → no repair": a fresh `drift.run()` → `driftedOrders: 0`, `totalsRecomputed: false`.

Also test the re-derivation endpoint path? The routine is tested via the service; that's enough.

Now — **the dashboard list's `total` count**: `countOperations` with the same where. I'll include it; it's fine.

**The `list` response and "what the operator sees"**: items: the raw OperationRow (paymentOrderId, companyId, status, workerName, amountCents, currency, latestEventType, latestEventAt, latestEventId?, createdAt, updatedAt). Should I expose latestEventId? It's internal (the tiebreak). I'll project in the service to drop latestEventId from the items (a DTO mapping) — a small mapper in the service (not business logic, a presentation mapping — acceptable in the service? The controller must have zero business logic; a field projection in the service is fine). I'll map to `OperationDto`:

```ts
export interface OperationDto {
  paymentOrderId: string; companyId: string; status: OrderStatus; workerName: string;
  amountCents: number; currency: string;
  latestEventType: string | null; latestEventAt: Date | null;
  createdAt: Date; updatedAt: Date;
}
```

Map in the service's list().

**BigInt serialization in the totals DTO** — mapped to numbers ✓ (the OperationRow's amountCents is Int → number ✓).

**Prisma + ESM + `import { PrismaClient } from '@prisma/client'`** — fine.

**Vitest + TS + NodeNext `.js` extensions** — vitest resolves `.js` → `.ts` ✓ (vite-node handles it).

**`@Cron` import in the service** — needs the `@nestjs/schedule` module loaded (ScheduleModule.forRoot in AppModule) — the decorator is independent of the module ✓.

**Prisma generate in tests**: `@prisma/client` needs the generated client — the `prisma generate` step (postinstall). Add `"postinstall": "prisma generate"` to the package.json scripts. ✓

Now, let me re-check the **Prisma typed `upsert` with the increment inside update**: Prisma docs (upsert): "You can also use update operators in the update field" — hmm, I want to be careful. Let me think about the Prisma type: `CompanyFinancialTotalsUpdateInput` includes `approvedAmountCents?: Int | BigIntFieldUpdateOperationsInput` — and `upsert`'s `update` takes `CompanyFinancialTotalsUpdateInput`? The upsert update field type is `CompanyFinancialTotalsUpdateInput` (yes, in recent Prisma it's the same UpdateInput). And `BigIntFieldUpdateOperationsInput` has increment/decrement ✓. So `update: { approvedAmountCents: { increment: x } }` is typed ✓.

But building it dynamically with a computed key: the type check needs a cast. I'll write:

```ts
const update: CompanyFinancialTotalsUpdateInput = { updatedAt: new Date() };
(update as Record<string, unknown>)[to.amount] = { increment: delta.amountCents };
```

Cleaner: since there are only four statuses, use an exhaustive helper that returns the column keys:

```ts
const TOTALS_FIELD: Record<OrderStatus, { amount: keyof CompanyFinancialTotals; count: keyof CompanyFinancialTotals }> = {
  pending: { amount: 'pendingAmountCents', count: 'pendingCount' },
  ...
};
```

And cast. Fine.

Actually — hmm, one more consideration on the correctness of the totals-upsert approach: the `create` branch (when the totals row is missing): sets the to-bucket values, others default to 0. But the correct state for a company with an existing operation row that had fromStatus: the totals row was missing but other orders of the company may exist and have been counted… no — if the totals row is missing, nothing was counted; the insert creates it with only the current delta; the undercount of the rest remains → drift repair (the totals drift check compares against the source aggregate → catches it on the next run for that company if there's activity in the window… the drift check's EXISTS condition requires the company's orders created/updated in the window — the order being written now → updated_at is now ✓ flagged). OK, consistent.

**The `findOperationRow` inside the hook** — a Prisma typed query inside the tx ✓.

Now the **`applyOrderChange` on create**: prev is null → totals delta (fromStatus null) → upsert insert branch or update increment ✓.

**Audit event on create?** I decided only on transitions (approved/disputed/cancelled/worker_assigned). A create has no event — the row's latestEvent is null until the first event. The re-derivation matches (no event → null) ✓ consistent.

**`occurredAt` on the audit event**: I pass `updated.updatedAt` — a monotonic order for the latest-event tiebreak: a later-occurring transition has a later updatedAt ✓. Two transitions in the same millisecond (unlikely) — the id uuid tiebreak breaks the order arbitrarily but consistently between the hook and the re-derivation (both use (occurred_at, id)) ✓ — wait, does the hook use the same rule as the re-derivation? Hook: only replace if (occurredAt, id) > current. Re-derivation: DISTINCT ON ordered by (occurred_at DESC, id DESC). Same semantics ✓.

**Now the controllers in detail.**

`src/common/validation.ts`:

```ts
import { ValidationError } from './errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ValidationErrors = Record<string, unknown>;

export function finishValidation(errors: ValidationErrors): void {
  if (Object.keys(errors).length > 0) {
    throw new ValidationError('Invalid request parameters', errors);
  }
}

export function parseUuid(value: unknown, field: string, errors: ValidationErrors): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    errors[field] = 'must be a valid UUID';
    return '';
  }
  return value;
}

export function requireUuid(value: string, field: string): void {
  if (!UUID_RE.test(value)) {
    throw new ValidationError('Invalid request parameters', { [field]: 'must be a valid UUID' });
  }
}

export function parseOptionalUuid(value: unknown, field: string, errors: ValidationErrors): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const v = parseUuid(value, field, errors);
  return errors[field] ? undefined : v;
}

export function parseStatus(value: unknown, field: string, errors: ValidationErrors): OrderStatus | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !(ORDER_STATUSES as readonly string[]).includes(value)) {
    errors[field] = `must be one of: ${ORDER_STATUSES.join(', ')}`;
    return undefined;
  }
  return value as OrderStatus;
}

export function parseOptionalIsoDate(value: unknown, field: string, errors: ValidationErrors): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') { errors[field] = 'must be an ISO-8601 date string'; return undefined; }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) { errors[field] = 'must be a valid ISO-8601 date'; return undefined; }
  return date;
}

export function parsePositiveInt(value: unknown, field: string, errors: ValidationErrors, max?: number): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = typeof value === 'string' ? Number(value) : (typeof value === 'number' ? value : NaN);
  if (!Number.isInteger(n) || n < 1 || (max !== undefined && n > max)) {
    errors[field] = max !== undefined ? `must be an integer between 1 and ${max}` : 'must be a positive integer';
    return undefined;
  }
  return n;
}

export function parseRequiredIsoDate(value: unknown, field: string, errors: ValidationErrors): Date | undefined {
  if (value === undefined || value === null || value === '') { errors[field] = 'is required'; return undefined; }
  return parseOptionalIsoDate(value, field, errors);
}

export function parseNonNegativeInt(value: unknown, field: string, errors: ValidationErrors): number | undefined {...}

export function parseCurrency(value: unknown, field: string, errors: ValidationErrors): string | undefined {
  if (typeof value !== 'string' || !/^[A-Za-z]{3}$/.test(value)) { errors[field] = 'must be a 3-letter ISO currency code'; return undefined; }
  return value.toUpperCase();
}
```

The `ORDER_STATUSES` constant — where? `src/common/order-status.ts`? It comes from the generated Prisma `OrderStatus` (a string enum union, not a runtime array). I'll define `export const ORDER_STATUSES = ['pending','approved','disputed','cancelled'] as const;` in `src/common/order-status.ts`, and note it must match the Prisma enum. Or derive it: the generated `@prisma/client` exports `OrderStatus` as a type only (in JS, the enum isn't exported as a value). So a manual const with a comment.

The controller code (orders):

```ts
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  create(@Body() body: Record<string, unknown>) {
    const errors: ValidationErrors = {};
    const companyId = parseUuid(body?.companyId, 'companyId', errors);
    const workerId = parseUuid(body?.workerId, 'workerId', errors);
    const amountCents = parseNonNegativeInt(body?.amountCents, 'amountCents', errors);
    const currency = parseCurrency(body?.currency, 'currency', errors);
    finishValidation(errors);
    return this.orders.create({ companyId, workerId, amountCents: amountCents as number, currency: currency as string });
  }
```

TS: after finishValidation (which throws), `amountCents` is `number | undefined` — TS doesn't narrow through a function. A cast or an assertion. I'll restructure: parse into a local and `!`? A cast is ugly but pragmatic; or make the parse function return the value with a generic that narrows… simplest:

```ts
const parsed: { companyId: string; workerId: string; amountCents: number; currency: string } = {
  companyId: parseUuid(...), ...
};
```
Still `string | undefined`. I'll accept an `assertValid` pattern: `finishValidation` is declared `asserts errors is ...`? Assertion signatures assert on a parameter — I can declare:

```ts
export function finishValidation<T extends ValidationErrors>(errors: T): asserts T { ... }
```

No — an assertion must assert the type of a parameter to a specific type. I can do:

```ts
function valid(errors: ValidationErrors): asserts errors is never { if (keys) throw }
```

Then after `valid(errors)`, `errors` is never… that doesn't narrow the other variables.

Pragmatic: use a non-null assertion `amountCents!` after finishValidation — wait, the `!` on a const of `number|undefined` → `number`. Fine: `this.orders.create({ companyId: companyId!, ... })`. Acceptable, or restructure to build the object and then validate:

```ts
const input = {
  companyId: parseUuid(...),
  workerId: parseUuid(...),
  amountCents: parseNonNegativeInt(...),
  currency: parseCurrency(...),
};
finishValidation(errors);
return this.orders.create(input as NewOrderInput);
```

A single cast on the object — clean enough. I'll use that pattern.

approve:

```ts
@Post(':id/approve')
approve(@Param('id') id: string) {
  requireUuid(id, 'id');
  return this.orders.approve(id);
}
```

The operations controller list:

```ts
@Get()
list(@Query() query: Record<string, string | undefined>) {
  const errors: ValidationErrors = {};
  const companyId = parseOptionalUuid(query?.companyId, 'companyId', errors);
  const status = parseStatus(query?.status, 'status', errors);
  const from = parseOptionalIsoDate(query?.from, 'from', errors);
  const to = parseOptionalIsoDate(query?.to, 'to', errors);
  const page = parsePositiveInt(query?.page, 'page', errors, 1_000_000) ?? 1;
  const pageSize = parsePositiveInt(query?.pageSize, 'pageSize', errors, 100) ?? 20;
  if (from !== undefined && to !== undefined && from.getTime() >= to.getTime()) {
    errors.to = 'must be strictly after "from"';
  }
  finishValidation(errors);
  return this.operations.list({ companyId, status, from, to, page, pageSize });
}

@Get('companies/:companyId/financial-totals')
financialTotals(@Param('companyId') companyId: string) {
  requireUuid(companyId, 'companyId');
  return this.operations.totals(companyId);
}

@Post('rederive')
rederive(@Body() body: Record<string, unknown>) {
  const errors: ValidationErrors = {};
  const from = parseRequiredIsoDate(body?.from, 'from', errors);
  const to = parseRequiredIsoDate(body?.to, 'to', errors);
  if (from !== undefined && to !== undefined && from.getTime() >= to.getTime()) errors.to = 'must be strictly after "from"';
  finishValidation(errors);
  return this.operations.rederive(from as Date, to as Date);
}
```

Route order: `@Get('companies/:companyId/financial-totals')` before or after `@Get()` — different paths, no conflict.

`parseStatus` needs to import OrderStatus — from `@prisma/client` ✓ (a type-only import).

**OperationsService in detail**:

```ts
@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operations: OperationsRepository,
    private readonly projection: ProjectionRepository,
  ) {}

  async list(filter: OperationListFilter): Promise<OperationListResult> {
    const where = this.operations.whereFor(filter);
    const [rows, total] = await Promise.all([
      this.operations.listOperations(filter),
      this.operations.countOperations(filter),
    ]);
    return {
      items: rows.map(toOperationDto),
      total,
      page: filter.page,
      pageSize: filter.pageSize,
    };
  }
```

The `whereFor` in the repository (the where builder is data-access logic ✓):

```ts
private whereFor(filter: Pick<OperationListFilter, 'companyId'|'status'|'from'|'to'>): OperationRowWhereInput {
  return {
    ...(filter.companyId ? { companyId: filter.companyId } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.from || filter.to ? { createdAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lt: filter.to } : {}) } } : {}),
  };
}
listOperations(filter) { return this.prisma.operationRow.findMany({ where: this.whereFor(filter), orderBy: [...], skip, take }); }
countOperations(filter) { return this.prisma.operationRow.count({ where: this.whereFor(filter) }); }
```

`totals(companyId)`:

```ts
async totals(companyId: string): Promise<CompanyFinancialTotalsDto> {
  const company = await this.operations.company(companyId);
  if (!company) throw new ResourceNotFoundError(`Company ${companyId} does not exist`, { companyId });
  const row = await this.operations.getTotals(companyId);
  if (!row) return ZERO_TOTALS(companyId);
  return {
    companyId,
    pending: { amountCents: Number(row.pendingAmountCents), count: row.pendingCount },
    approved: { amountCents: Number(row.approvedAmountCents), count: row.approvedCount },
    disputed: { amountCents: Number(row.disputedAmountCents), count: row.disputedCount },
    cancelled: { amountCents: Number(row.cancelledAmountCents), count: row.cancelledCount },
    updatedAt: row.updatedAt,
  };
}
```

`rederive(from, to)`:

```ts
async rederive(from: Date, to: Date): Promise<{ rowsRebuilt: number }> {
  if (from.getTime() >= to.getTime()) throw new ValidationError('Invalid re-derivation window', { to: 'must be strictly after "from"' });
  const rowsRebuilt = await this.prisma.transaction(async (tx) => {
    const n = await this.projection.rederiveWindow(tx, from, to);
    await this.projection.recomputeTotals(tx);
    return n;
  });
  return { rowsRebuilt };
}
```

**OperationsRepository**:

```ts
@Injectable()
export class OperationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async company(id: string): Promise<Company | null> { return this.prisma.company.findUnique({ where: { id } }); }
  async getTotals(companyId: string): Promise<CompanyFinancialTotals | null> { return this.prisma.companyFinancialTotals.findUnique({ where: { companyId } }); }
  // + whereFor, listOperations, countOperations
}
```

Now, **the test that "the dashboard query touches only the projection"** — the acceptance criterion: "the dashboard query only touches the projection." The code structure guarantees it (list reads only operationRows). I can add a test that uses EXPLAIN? Overkill; the convention says behavior tests. I'll add a test asserting the list result equals the projection contents (e.g. corrupt… no). I'll rely on the code + note in DESIGN.md. Or a light test: seed the source without a projection row, and assert it doesn't appear in the dashboard (proving the dashboard doesn't read the source):

```ts
it('reads only the projection (source rows without a projection row are not listed)', async () => {
  const raw = await prisma.paymentOrder.create({ data: { companyId, workerId, amountCents: 777, currency: 'USD' } });
  const list = await operationsService.list({ companyId, page: 1, pageSize: 100 });
  expect(list.items.map(i => i.paymentOrderId)).not.toContain(raw.id);
});
```

✓ a good behavioral proof.

**The read-your-own-writes "no delay"**: the test approves and then immediately lists — same process; the "no delay" property is essentially proven by a single process + a transaction. I'll note in a comment.

Now — **potential Prisma typing pitfalls**:

- `tx.paymentOrder.updateMany({ where: { id, status: fromStatus }, data: { status: toStatus } })` — the where `status` accepts an enum ✓.
- The `OrderStatus` type import from `@prisma/client` ✓.
- `prisma.operationRow.findMany` — the model name OperationRow → property `operationRow` ✓.
- The `CompanyFinancialTotals` model → `companyFinancialTotals` ✓.

**Prisma raw `$executeRaw` with a Date parameter** — supported ✓ (serializes).

**`$queryRaw` generic** — `tx.$queryRaw<{ id: string }[]>(\`...\`)` ✓ (the array type parameter).

**Migration naming**: `prisma/migrations/20250601000000_init/migration.sql` + `migration_lock.toml`:

```
# Please do not edit this file manually
# It should be added in your version-control system (e.g., git)
provider = "postgresql"
```

**DESIGN.md** — short but covering: context, design, why sync hooks vs rejected alternatives (trigger, async CDC/outbox, scheduled refresh, matview, plain index/cache), the concurrency mechanism, the idempotent re-derivation, the drift repair, the read path/index, the read-model contract, the operational notes (env vars, the Prisma/INCLUDE index caveat), the testing.

Now, let me re-check **the "worker join" semantics**: the original operations list joined workers to show the worker's name (probably). Our projection denormalizes `worker_name` ✓. If the worker's name changes later — the projection is only updated on the order's write (a reassign) and on re-derivation. A worker's name change doesn't update the row until the next re-derivation. Documented? A worker rename is rare; the drift repair doesn't catch it (the drift check compares the worker_name vs the current name — wait, it does: `r.worker_name IS DISTINCT FROM w.name` → a renamed worker flags all their rows as drifted in the window → repaired! Nice — actually that means worker renames within the window get picked up by the drift repair. A side effect, fine.)

**The currency column** — a `char(3)`: Prisma `String @db.Char(3)` ✓.

**Amount check constraint** — a CHECK ≥ 0 on amount_cents in the migration (not in the schema; Prisma doesn't support CHECK — I'll skip in the schema and add in the migration? A migration/schema divergence… a small addition is acceptable with a note; actually, to minimize divergence noise, I'll skip the CHECK. The controller validates ≥0. Skip.)

**`payment_orders.updated_at` `@updatedAt`** — Prisma auto-updates on any update including updateMany ✓. But a raw seed (a test direct create with status 'approved') sets updatedAt=now ✓ fine.

**A note on the drift check**: the re-derivation only rebuilds orders created in the window, but the drift check also compares all fields including the latest event — consistent.

**A subtle bug risk**: the `rederiveWindow`'s `latest_event` CTE filter `WHERE occurred_at >= ${from}` — for an order created in the window, all its events have occurredAt ≥ createdAt ≥ from ✓.

**The `findDriftedOrderIds` uses the same bound** ✓.

**A totals drift check edge case**: a company with no totals row but with orders (a drift: the row was deleted) → `t.company_id IN ...` — t has no row → not flagged! A missing totals row isn't caught. Hmm. Fix: check both directions: also `SELECT DISTINCT company_id FROM payment_orders WHERE created_at >= from OR updated_at >= from` minus existing totals rows → drifted. Add a UNION to the SQL:

```sql
(SELECT DISTINCT po.company_id
 FROM payment_orders po
 WHERE (po.created_at >= ${from} OR po.updated_at >= ${from})
   AND NOT EXISTS (SELECT 1 FROM company_financial_totals t WHERE t.company_id = po.company_id))
UNION
(SELECT t.company_id FROM company_financial_totals t WHERE EXISTS(...changed...) AND NOT EXISTS (agreement subquery))
```

I'll restructure:

```sql
SELECT company_id FROM (
  SELECT DISTINCT po.company_id AS company_id
  FROM payment_orders po
  WHERE (po.created_at >= $1 OR po.updated_at >= $2)
) active
WHERE active.company_id NOT IN (SELECT company_id FROM company_financial_totals)
   OR EXISTS (
     SELECT 1 FROM company_financial_totals t
     WHERE t.company_id = active.company_id
       AND NOT EXISTS (
         SELECT 1 FROM (
           SELECT po2.company_id,
                  COALESCE(SUM(po2.amount_cents) FILTER (WHERE po2.status = 'pending'), 0) AS pending_amount,
                  COUNT(*) FILTER (WHERE po2.status = 'pending') AS pending_count,
                  COALESCE(SUM(po2.amount_cents) FILTER (WHERE po2.status = 'approved'), 0) AS approved_amount,
                  COUNT(*) FILTER (WHERE po2.status = 'approved') AS approved_count,
                  COALESCE(SUM(po2.amount_cents) FILTER (WHERE po2.status = 'disputed'), 0) AS disputed_amount,
                  COUNT(*) FILTER (WHERE po2.status = 'disputed') AS disputed_count,
                  COALESCE(SUM(po2.amount_cents) FILTER (WHERE po2.status = 'cancelled'), 0) AS cancelled_amount,
                  COUNT(*) FILTER (WHERE po2.status = 'cancelled') AS cancelled_count
           FROM payment_orders po2
           WHERE po2.company_id = active.company_id
           GROUP BY po2.company_id
         ) s
         WHERE s.pending_amount   IS DISTINCT FROM t.pending_amount_cents
            OR s.pending_count    IS DISTINCT FROM t.pending_count
            OR s.approved_amount  IS DISTINCT FROM t.approved_amount_cents
            OR s.approved_count   IS DISTINCT FROM t.approved_count
            OR s.disputed_amount  IS DISTINCT FROM t.disputed_amount_cents
            OR s.disputed_count   IS DISTINCT FROM t.disputed_count
            OR s.cancelled_amount IS DISTINCT FROM t.cancelled_amount_cents
            OR s.cancelled_count  IS DISTINCT FROM t.cancelled_count
       )
   );
```

Hmm wait: `COUNT(*) FILTER (WHERE ...)` returns bigint; `t.pending_count` is int — `IS DISTINCT FROM` between bigint and int → coerces ✓.

The subquery per active company: a correlated aggregate over all the company's orders — fine for a small active set.

Note: a company with zero orders but an existing totals row (a stale row): it's not in `active` (no orders) → not flagged. A stale row with zero orders: the dashboard returns that (non-zero?) value — but the recomputeTotals' DELETE removes such rows; the drift check misses it (harmless: the endpoint shows the old totals for a zero-order company… an edge; the recompute only runs when something is flagged. Acceptable? To be thorough, add a stale-row check:

```sql
UNION
SELECT t.company_id FROM company_financial_totals t
WHERE NOT EXISTS (SELECT 1 FROM payment_orders po WHERE po.company_id = t.company_id)
  AND EXISTS (SELECT 1 FROM payment_orders po2 WHERE po2.updated_at >= $1 OR po2.created_at >= $1)  -- hmm, arbitrary
```

Getting over-engineered. I'll include a global stale-row check without a window (cheap: a NOT EXISTS semi-join over the small totals table):

```sql
UNION
SELECT t.company_id
FROM company_financial_totals t
WHERE NOT EXISTS (SELECT 1 FROM payment_orders po WHERE po.company_id = t.company_id)
```

A company with no orders shouldn't have a totals row (the recompute deletes them; the hook never creates them without an order). So flag any such row → the recompute deletes them. ✓ Include it.

**Now, write the `recomputeTotals` DELETE**:

```sql
DELETE FROM company_financial_totals cft
WHERE NOT EXISTS (SELECT 1 FROM payment_orders po WHERE po.company_id = cft.company_id)
```

✓.

**Order of operations in `recomputeTotals`**: upsert (set the correct values), then delete the stale ✓ (idempotent, same result in any order).

**The report type**:

```ts
export interface DriftRepairReport {
  from: Date;
  to: Date;
  driftedOrders: number;
  rowsRepaired: number;
  driftedTotalsCompanies: number;
  totalsRecomputed: boolean;
}
```

**Let me think about the `PrismaService.transaction` interactive tx and the raw SQL inside it** — `tx.$executeRaw` inside an interactive tx ✓ supported.

**A test that asserts "the totals endpoint is zero for a fresh company"** — a good addition to the operations spec:

```ts
const freshCompany = await prisma.company.create({ data: { name: ... } });
const totals = await operationsService.totals(freshCompany.id);
expect(totals.approved.amountCents).toBe(0); ... expect(totals.pending.count).toBe(0);
```

**And a 404 for an unknown company** — `expect(operationsService.totals(randomUUID())).rejects.toThrow(ResourceNotFoundError)`.

**A dashboard pagination test**: create 25 orders for a company (via the service), list with pageSize 10 page 1 → 10 items; page 3 → 5; total = 25 (plus the other specs' orders? A different company per spec file; within the file, the RYW test adds orders to the same company — use a different company per `it` where necessary, or a different company per describe). I'll create a fresh company per test via a helper (a new seed per `it` where isolation is needed). The cost is small.

Now — **vitest concurrency**: tests within a file run serially by default ✓ (no test-level `concurrent`). Good, since they share the app.

**The app.close() in afterAll** — closes the PrismaService (onModuleDestroy → $disconnect) ✓.

**The Prisma client instantiation in tests** — the `PrismaService` extends `PrismaClient` — the constructor reads `DATABASE_URL` ✓.

**One risk**: `Test.createTestingModule({ imports: [AppModule] })` — AppModule includes `ScheduleModule.forRoot()` → the cron registry; the DriftRepairService is overridden → the original provider (with the @Cron) is never instantiated → no scheduling ✓.

**The `@Cron` decorator evaluation** happens at class-load (module import) — `process.env.DRIFT_REPAIR_CRON ?? '*/5 * * * *'` ✓.

Now — **let me write the files fully.**

Let me reconsider the file list and names (kebab-case.role.ts):

- `src/main.ts`
- `src/app.module.ts`
- `src/common/errors.ts`
- `src/common/errors.exception-filter.ts`
- `src/common/order-status.ts`
- `src/common/validation.ts`
- `src/database/database.module.ts`
- `src/database/prisma.service.ts`
- `src/orders/orders.module.ts`
- `src/orders/orders.controller.ts`
- `src/orders/orders.service.ts`
- `src/orders/orders.repository.ts`
- `src/events/events.module.ts`
- `src/events/events.controller.ts`
- `src/events/events.service.ts`
- `src/events/events.repository.ts`
- `src/operations/operations.module.ts`
- `src/operations/operations.controller.ts`
- `src/operations/operations.service.ts`
- `src/operations/operations.repository.ts`
- `src/operations/projection.repository.ts`
- `src/operations/projection.service.ts`
- `src/operations/drift-repair.service.ts`
- `test/helpers.ts`
- `test/orders.spec.ts` (read-your-own-writes)
- `test/concurrency.spec.ts`
- `test/operations.spec.ts` (re-derivation + drift repair)
- `prisma/schema.prisma`
- `prisma/migrations/migration_lock.toml`
- `prisma/migrations/20250601000000_init/migration.sql`
- `DESIGN.md`
- `package.json`
- `tsconfig.json`
- `vitest.config.ts`

34 files. All "complete, first line to last line."

Now, let me write each file carefully, watching imports (with `.js` extensions) and types.

Wait — the convention example shows `src/payout/payout.service.ts` (singular feature name in the file). I'll use the plural folders `orders/events/operations` with matching file names (`orders.service.ts`, etc.) — consistent.

Let me draft each file.

---

**package.json**

```json
{
  "name": "marketplace-backoffice",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "postinstall": "prisma generate",
    "build": "tsc -p tsconfig.json",
    "start": "node --import tsx src/main.ts",
    "start:dev": "tsx watch src/main.ts",
    "migrate": "prisma migrate deploy",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.8",
    "@nestjs/core": "^10.3.8",
    "@nestjs/platform-express": "^10.3.8",
    "@nestjs/schedule": "^4.1.0",
    "@prisma/client": "^5.16.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.3.8",
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.9",
    "prisma": "^5.16.1",
    "tsx": "^4.16.2",
    "typescript": "^5.5.3",
    "vitest": "^2.0.2"
  }
}
```

**tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "useDefineForClassFields": false,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

**vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
  },
});
```

**prisma/schema.prisma** — as drafted above.

**prisma/migrations/migration_lock.toml**

```toml
# Please do not edit this file manually
# It should be added in your version-control system (e.g., git)
provider = "postgresql"
```

**prisma/migrations/20250601000000_init/migration.sql** — as drafted, including the INCLUDE covering index and the FK on operation_rows.payment_order_id.

Let me write it in full:

```sql
-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('pending', 'approved', 'disputed', 'cancelled');

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "company_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_orders" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'pending',
    "amount_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "payment_order_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "note" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- Read model: one row per payment order, shaped like the operations dashboard query.
CREATE TABLE "operation_rows" (
    "payment_order_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "worker_name" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "latest_event_type" TEXT,
    "latest_event_at" TIMESTAMPTZ(6),
    "latest_event_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "operation_rows_pkey" PRIMARY KEY ("payment_order_id")
);

-- Read model: exact per-company financial totals, maintained by atomic in-place deltas.
CREATE TABLE "company_financial_totals" (
    "company_id" UUID NOT NULL,
    "pending_amount_cents" BIGINT NOT NULL DEFAULT 0,
    "pending_count" INTEGER NOT NULL DEFAULT 0,
    "approved_amount_cents" BIGINT NOT NULL DEFAULT 0,
    "approved_count" INTEGER NOT NULL DEFAULT 0,
    "disputed_amount_cents" BIGINT NOT NULL DEFAULT 0,
    "disputed_count" INTEGER NOT NULL DEFAULT 0,
    "cancelled_amount_cents" BIGINT NOT NULL DEFAULT 0,
    "cancelled_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_financial_totals_pkey" PRIMARY KEY ("company_id")
);

-- CreateIndex
CREATE INDEX "workers_company_id_idx" ON "workers"("company_id");
CREATE INDEX "payment_orders_company_id_status_idx" ON "payment_orders"("company_id", "status");
CREATE INDEX "payment_orders_created_at_idx" ON "payment_orders"("created_at");
CREATE INDEX "events_payment_order_id_occurred_at_id_idx" ON "events"("payment_order_id", "occurred_at" DESC, "id" DESC);

-- Covering index for the hot read: filter (company_id, status), sort (updated_at DESC, payment_order_id DESC),
-- all selected columns in INCLUDE so the dashboard is answered without touching the heap.
CREATE INDEX "operation_rows_company_status_updated_idx"
    ON "operation_rows" ("company_id", "status", "updated_at" DESC, "payment_order_id" DESC)
    INCLUDE ("worker_name", "amount_cents", "currency", "latest_event_type", "latest_event_at", "latest_event_id", "created_at");

-- AddForeignKey
ALTER TABLE "workers" ADD CONSTRAINT "workers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "events" ADD CONSTRAINT "events_payment_order_id_fkey" FOREIGN KEY ("payment_order_id") REFERENCES "payment_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operation_rows" ADD CONSTRAINT "operation_rows_payment_order_id_fkey" FOREIGN KEY ("payment_order_id") REFERENCES "payment_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operation_rows" ADD CONSTRAINT "operation_rows_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "company_financial_totals" ADD CONSTRAINT "company_financial_totals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

Note: the Prisma schema doesn't declare these FKs for operation_rows / company_financial_totals (the company relation is declared for totals). I'll add a note in DESIGN.md.

Hmm wait — CompanyFinancialTotals declares `company Company @relation(fields: [companyId], references: [id])` → Prisma expects an FK named `company_financial_totals_company_id_fkey` with ON DELETE Cascade? The Prisma default is `onDelete: Cascade`? No — the Prisma default for a required relation is `ReferentialActions restrict`… actually the Prisma default: required relations → `ondelete: restrict`? Hmm: the Prisma default for a required relation is `onUpdate: Cascade, onDelete: Cascade`? Let me recall: "The default behavior is: required relation → onDelete: Restrict"? I believe the Prisma default is: required → `restrict`, optional → `set null`. Hmm no — Prisma docs: "Required relations: ON DELETE RESTRICT (default)". Wait, actually I recall the Prisma default: required relation → `onDelete: Cascade`? No. Let me think… Prisma docs (referential actions): "The default action for required relations is Cascade"??

From the Prisma docs (Referential Actions): "By default, Prisma uses: required relation → onDelete: Cascade, onUpdate: Cascade"? I honestly recall that the Prisma default for a required relation is `onUpdate: Cascade, onDelete: Cascade` — no wait, that was the old default; the docs currently say: "Required relation: ON DELETE RESTRICT / ON UPDATE CASCADE"?

To be safe, I'll be explicit in the schema: `company Company @relation(fields: [companyId], references: [id], onDelete: Cascade)`. Then the migration's FK `ON DELETE CASCADE ON UPDATE CASCADE` matches. I'll be explicit about the FK actions in schema.prisma wherever there's a relation:

- Worker.company: `onDelete: Restrict` (a company with workers can't be deleted) → the migration's `ON DELETE RESTRICT`.
- PaymentOrder.company / worker: Restrict.
- Event.paymentOrder: Cascade.
- CompanyFinancialTotals.company: Cascade.

In the schema:

```prisma
model Worker {
  ...
  company Company @relation(fields: [companyId], references: [id], onDelete: Restrict)
}
model PaymentOrder {
  ...
  company Company @relation(fields: [companyId], references: [id], onDelete: Restrict)
  worker  Worker  @relation(fields: [workerId], references: [id], onDelete: Restrict)
  events  Event[]
}
model Event {
  paymentOrder PaymentOrder @relation(fields: [paymentOrderId], references: [id], onDelete: Cascade)
}
model CompanyFinancialTotals {
  company Company @relation(fields: [companyId], references: [id], onDelete: Cascade)
}
```

The Company model declares the back-relations: `workers Worker[]`, `orders PaymentOrder[]`, `totals CompanyFinancialTotals?`.

OperationRow: no relation (a loose FK) — the Prisma model exists standalone; the FK is migration-only (noted).

**Now the code files.**

`src/common/order-status.ts`:

```ts
import type { OrderStatus } from '@prisma/client';

// Must mirror the `OrderStatus` enum in prisma/schema.prisma.
export const ORDER_STATUSES = ['pending', 'approved', 'disputed', 'cancelled'] as const satisfies readonly OrderStatus[];
```

`satisfies` — TS 4.9+ ✓.

`src/common/errors.ts` — as drafted. Also include the `InternalError`? The filter handles unknowns. I'll add it.

`src/common/validation.ts` — as drafted; import ORDER_STATUSES, OrderStatus type, ValidationError.

Let me finalize the validation functions used:

- `parseUuid(value, field, errors): string`
- `parseOptionalUuid`
- `requireUuid(value, field)` — for params
- `parseStatus(value, field, errors): OrderStatus | undefined`
- `parseOptionalIsoDate`
- `parseRequiredIsoDate`
- `parsePositiveInt(value, field, errors, max?)`
- `parseNonNegativeInt(value, field, errors)`
- `parseCurrency`
- `finishValidation(errors)`

`src/database/prisma.service.ts`:

```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Runs `fn` inside a single interactive Postgres transaction.
   *
   * // ASSUMPTION: the task fixes the layering (business services make zero Prisma client calls), so the
   * transaction coordination is exposed by this infrastructure class rather than by the feature services.
   * Feature services pass the returned transaction handle only to repositories, which treat it as an opaque token.
   */
  transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.$transaction(fn);
  }
}
```

`src/database/database.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
```

`src/orders/orders.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { OrderStatus, PaymentOrder, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { ResourceNotFoundError } from '../common/errors.js';

export interface NewOrderInput {
  companyId: string;
  workerId: string;
  amountCents: number;
  currency: string;
}

type Tx = Prisma.TransactionClient;

@Injectable()
export class OrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async companyExists(companyId: string, tx: Tx = this.prisma): Promise<boolean> {
    const row = await tx.company.findUnique({ where: { id: companyId }, select: { id: true } });
    return row !== null;
  }

  async workerExists(workerId: string, tx: Tx = this.prisma): Promise<boolean> {
    const row = await tx.worker.findUnique({ where: { id: workerId }, select: { id: true } });
    return row !== null;
  }

  async create(input: NewOrderInput, tx: Tx): Promise<PaymentOrder> {
    return tx.paymentOrder.create({ data: input });
  }

  async assignWorker(orderId: string, workerId: string, tx: Tx): Promise<PaymentOrder> {
    return tx.paymentOrder.update({ where: { id: orderId }, data: { workerId } });
  }

  async find(id: string, tx: Tx = this.prisma): Promise<PaymentOrder | null> {
    return tx.paymentOrder.findUnique({ where: { id } });
  }

  async findOrThrow(id: string, tx: Tx = this.prisma): Promise<PaymentOrder> {
    const order = await this.find(id, tx);
    if (!order) {
      throw new ResourceNotFoundError(`Payment order ${id} does not exist`, { orderId: id });
    }
    return order;
  }

  /**
   * Atomically moves the order from `fromStatus` to `toStatus`.
   * Returns null when the order is not in `fromStatus` (concurrent modification); the caller decides the error.
   */
  async transition(
    orderId: string,
    fromStatus: OrderStatus,
    toStatus: OrderStatus,
    tx: Tx,
  ): Promise<PaymentOrder | null> {
    const result = await tx.paymentOrder.updateMany({
      where: { id: orderId, status: fromStatus },
      data: { status: toStatus },
    });
    if (result.count === 0) {
      return null;
    }
    const updated = await this.find(orderId, tx);
    if (!updated) {
      throw new ResourceNotFoundError(`Payment order ${orderId} disappeared during transition`, { orderId });
    }
    return updated;
  }
}
```

`src/orders/orders.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { OrderStatus, PaymentOrder } from '@prisma/client';
import { ConflictError, ResourceNotFoundError } from '../common/errors.js';
import { PrismaService } from '../database/prisma.service.js';
import { EventRepository, NewEventInput } from '../events/events.repository.js';
import { ProjectionService } from '../operations/projection.service.js';
import { NewOrderInput, OrdersRepository } from './orders.repository.js';

type OrderSnapshot = Pick<PaymentOrder, 'id' | 'companyId' | 'workerId' | 'status' | 'amountCents' | 'currency' | 'createdAt' | 'updatedAt'>;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersRepository,
    private readonly events: EventRepository,
    private readonly projection: ProjectionService,
  ) {}

  async create(input: NewOrderInput): Promise<PaymentOrder> {
    return this.prisma.transaction(async (tx) => {
      const [companyExists, workerExists] = await Promise.all([
        this.orders.companyExists(input.companyId, tx),
        this.orders.workerExists(input.workerId, tx),
      ]);
      if (!companyExists) {
        throw new ResourceNotFoundError(`Company ${input.companyId} does not exist`, { companyId: input.companyId });
      }
      if (!workerExists) {
        throw new ResourceNotFoundError(`Worker ${input.workerId} does not exist`, { workerId: input.workerId });
      }
      const order = await this.orders.create(input, tx);
      // Maintenance hook — runs inside the write's transaction (read-your-own-writes; the projection is
      // rolled back if the write is rolled back).
      await this.projection.applyOrderChange(tx, order);
      return order;
    });
  }

  approve(orderId: string): Promise<PaymentOrder> {
    return this.move(orderId, 'pending', 'approved');
  }

  cancel(orderId: string): Promise<PaymentOrder> {
    return this.move(orderId, 'pending', 'cancelled');
  }

  async dispute(orderId: string): Promise<PaymentOrder> {
    return this.prisma.transaction(async (tx) => {
      const existing = await this.orders.findOrThrow(orderId, tx);
      if (existing.status === 'disputed' || existing.status === 'cancelled') {
        throw new ConflictError(
          `Order ${orderId} is ${existing.status}; it cannot be disputed`,
          { orderId, status: existing.status },
        );
      }
      const updated = await this.orders.transition(orderId, existing.status, 'disputed', tx);
      if (!updated) {
        throw new ConflictError(`Order ${orderId} changed concurrently`, { orderId });
      }
      await this.applyProjection(tx, updated, 'disputed');
      return updated;
    });
  }

  async assignWorker(orderId: string, workerId: string): Promise<PaymentOrder> {
    return this.prisma.transaction(async (tx) => {
      await this.orders.findOrThrow(orderId, tx);
      if (!(await this.orders.workerExists(workerId, tx))) {
        throw new ResourceNotFoundError(`Worker ${workerId} does not exist`, { workerId });
      }
      const updated = await this.orders.assignWorker(orderId, workerId, tx);
      await this.applyProjection(tx, updated, 'worker_assigned');
      return updated;
    });
  }

  private move(orderId: string, from: OrderStatus, to: OrderStatus): Promise<PaymentOrder> {
    return this.prisma.transaction(async (tx) => {
      const existing = await this.orders.findOrThrow(orderId, tx);
      if (existing.status !== from) {
        throw new ConflictError(
          `Order ${orderId} is ${existing.status}; only ${from} orders can be moved to ${to}`,
          { orderId, status: existing.status },
        );
      }
      const updated = await this.orders.transition(orderId, from, to, tx);
      if (!updated) {
        throw new ConflictError(`Order ${orderId} changed concurrently`, { orderId });
      }
      await this.applyProjection(tx, updated, to);
      return updated;
    });
  }

  /** The write→read-model hook shared by all order mutations. */
  private async applyProjection(tx: Prisma.TransactionClient, order: OrderSnapshot, auditType: string): Promise<void> {
    await this.projection.applyOrderChange(tx, order);
    const event = await this.events.record({ paymentOrderId: order.id, eventType: auditType, occurredAt: order.updatedAt }, tx);
    await this.projection.applyEvent(tx, event);
  }
}
```

Wait — `events.record(input, tx)` — the EventRepository.record signature is `(input: NewEventInput, tx)` ✓.

The type import of Prisma.TransactionClient — import the `Prisma` type: `import { OrderStatus, PaymentOrder, Prisma } from '@prisma/client';` and use `Prisma.TransactionClient`.

Note: `move` uses auditType = to ('approved'/'cancelled') ✓; dispute uses 'disputed' ✓; assignWorker uses 'worker_assigned' ✓.

`src/events/events.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Event, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';

export interface NewEventInput {
  paymentOrderId: string;
  eventType: string;
  note?: string;
  occurredAt: Date;
}

type Tx = Prisma.TransactionClient;

@Injectable()
export class EventRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Liveness check on the source order.
   * // ASSUMPTION: kept in this repository (instead of importing the orders feature) so that EventsModule
   * can depend on OrdersModule without a circular module import.
   */
  async orderExists(orderId: string, tx: Tx = this.prisma): Promise<boolean> {
    const row = await tx.paymentOrder.findUnique({ where: { id: orderId }, select: { id: true } });
    return row !== null;
  }

  async record(input: NewEventInput, tx: Tx): Promise<Event> {
    return tx.event.create({ data: input });
  }
}
```

`src/events/events.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Event, Prisma } from '@prisma/client';
import { ResourceNotFoundError } from '../common/errors.js';
import { PrismaService } from '../database/prisma.service.js';
import { ProjectionService } from '../operations/projection.service.js';
import { EventRepository } from './events.repository.js';

export interface RecordEventInput {
  paymentOrderId: string;
  eventType: string;
  note?: string;
  occurredAt?: Date;
}

@Injectable()
export class EventService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventRepository,
    private readonly projection: ProjectionService,
  ) {}

  async record(input: RecordEventInput): Promise<Event> {
    return this.prisma.transaction(async (tx) => {
      if (!(await this.events.orderExists(input.paymentOrderId, tx))) {
        throw new ResourceNotFoundError(`Payment order ${input.paymentOrderId} does not exist`, {
          orderId: input.paymentOrderId,
        });
      }
      const event = await this.events.record(
        {
          paymentOrderId: input.paymentOrderId,
          eventType: input.eventType,
          note: input.note,
          occurredAt: input.occurredAt ?? new Date(),
        },
        tx,
      );
      // Maintenance hook — inside the write's transaction.
      await this.projection.applyEvent(tx, event);
      return event;
    });
  }
}
```

`src/events/events.controller.ts`:

```ts
import { Body, Controller, Param, Post } from '@nestjs/common';
import { Event } from '@prisma/client';
import {
  finishValidation,
  parseOptionalIsoDate,
  requireUuid,
  ValidationErrors,
} from '../common/validation.js';
import { EventService } from './events.service.js';

@Controller('orders')
export class EventsController {
  constructor(private readonly events: EventService) {}

  @Post(':orderId/events')
  record(@Param('orderId') orderId: string, @Body() body: Record<string, unknown> | undefined): Promise<Event> {
    requireUuid(orderId, 'orderId');
    const errors: ValidationErrors = {};
    const eventType = body?.eventType;
    if (typeof eventType !== 'string' || eventType.length === 0 || eventType.length > 100) {
      errors.eventType = 'must be a non-empty string of at most 100 characters';
    }
    let note: string | undefined;
    if (body?.note !== undefined) {
      if (typeof body.note !== 'string' || body.note.length > 1000) {
        errors.note = 'must be a string of at most 1000 characters';
      } else {
        note = body.note;
      }
    }
    const occurredAt = parseOptionalIsoDate(body?.occurredAt, 'occurredAt', errors);
    finishValidation(errors);
    return this.events.record({ paymentOrderId: orderId, eventType: eventType as string, note, occurredAt });
  }
}
```

`src/events/events.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { OperationsModule } from '../operations/operations.module.js';
import { EventsController } from './events.controller.js';
import { EventRepository } from './events.repository.js';
import { EventService } from './events.service.js';

@Module({
  imports: [DatabaseModule, OperationsModule],
  controllers: [EventsController],
  providers: [EventService, EventRepository],
  exports: [EventRepository],
})
export class EventsModule {}
```

`src/orders/orders.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { EventsModule } from '../events/events.module.js';
import { OperationsModule } from '../operations/operations.module.js';
import { OrdersController } from './orders.controller.js';
import { OrdersRepository } from './orders.repository.js';
import { OrdersService } from './orders.service.js';

@Module({
  imports: [DatabaseModule, EventsModule, OperationsModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersRepository],
})
export class OrdersModule {}
```

`src/operations/projection.repository.ts` — the biggest file.

```ts
import { Injectable } from '@nestjs/common';
import {
  CompanyFinancialTotals,
  CompanyFinancialTotalsUpdateInput,
  OrderStatus,
  OperationRow,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';

export interface OrderRowInput {
  paymentOrderId: string;
  companyId: string;
  workerId: string;
  status: OrderStatus;
  amountCents: number;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface LatestEventInput {
  id: string;
  paymentOrderId: string;
  eventType: string;
  occurredAt: Date;
}

export interface TotalsDelta {
  companyId: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  amountCents: number;
}

type Db = Prisma.TransactionClient | PrismaClient;

const TOTALS_FIELDS: Record<OrderStatus, { amount: string; count: string }> = {
  pending: { amount: 'pendingAmountCents', count: 'pendingCount' },
  approved: { amount: 'approvedAmountCents', count: 'approvedCount' },
  disputed: { amount: 'disputedAmountCents', count: 'disputedCount' },
  cancelled: { amount: 'cancelledAmountCents', count: 'cancelledCount' },
};

@Injectable()
export class ProjectionRepository {
  constructor(private readonly prisma: PrismaService) {}
  ...
```

Wait, I need to import the PrismaClient type: `import { Prisma, PrismaClient, ... } from '@prisma/client'` — PrismaClient is a value + type; using it as a type is fine.

Methods:

```ts
  /** Hook: upsert the order's operation row. The worker name is re-read from the source inside the statement so that the row is always a faithful denormalization. */
  async upsertOperationRow(tx: Db, order: OrderRowInput): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO operation_rows (
        payment_order_id, company_id, status, worker_name,
        amount_cents, currency, created_at, updated_at
      )
      VALUES (
        ${order.paymentOrderId}, ${order.companyId}, ${order.status}::"OrderStatus",
        (SELECT name FROM workers WHERE id = ${order.workerId}),
        ${order.amountCents}, ${order.currency}, ${order.createdAt}, ${order.updatedAt}
      )
      ON CONFLICT (payment_order_id) DO UPDATE SET
        company_id   = excluded.company_id,
        status       = excluded.status,
        worker_name  = excluded.worker_name,
        amount_cents = excluded.amount_cents,
        currency     = excluded.currency,
        updated_at   = excluded.updated_at
    `;
  }

  /**
   * Hook: apply an exact in-place delta to the company totals row.
   * Atomic at the database level (`SET x = x +/- delta` via increment/decrement):
   * concurrent writers to the same row serialize on the row lock and none is lost.
   */
  async applyTotalsDelta(tx: Db, delta: TotalsDelta): Promise<void> {
    const to = TOTALS_FIELDS[delta.toStatus];
    const create = { companyId: delta.companyId, updatedAt: new Date() } as CompanyFinancialTotalsCreateInput;
    (create as Record<string, unknown>)[to.amount] = delta.amountCents;
    (create as Record<string, unknown>)[to.count] = 1;

    const update = { updatedAt: new Date() } as CompanyFinancialTotalsUpdateInput;
    (update as Record<string, unknown>)[to.amount] = { increment: delta.amountCents };
    (update as Record<string, unknown>)[to.count] = { increment: 1 };
    if (delta.fromStatus && delta.fromStatus !== delta.toStatus) {
      const from = TOTALS_FIELDS[delta.fromStatus];
      (update as Record<string, unknown>)[from.amount] = { decrement: delta.amountCents };
      (update as Record<string, unknown>)[from.count] = { decrement: 1 };
    }

    await tx.companyFinancialTotals.upsert({
      where: { companyId: delta.companyId },
      create,
      update,
    });
  }
```

Need to import `CompanyFinancialTotalsCreateInput` too.

```ts
  /** Hook: set the order's latest event if the new event is strictly newer (occurred_at, id). */
  async applyLatestEvent(tx: Db, event: LatestEventInput): Promise<void> {
    await tx.$executeRaw`
      UPDATE operation_rows
      SET latest_event_type = ${event.eventType},
          latest_event_at   = ${event.occurredAt},
          latest_event_id   = ${event.id}
      WHERE payment_order_id = ${event.paymentOrderId}
        AND (latest_event_id IS NULL OR (${event.occurredAt}, ${event.id}) > (latest_event_at, latest_event_id))
    `;
  }

  async findOperationRow(tx: Db, paymentOrderId: string): Promise<OperationRow | null> {
    return tx.operationRow.findUnique({ where: { paymentOrderId } });
  }
```

Re-derivation + drift:

```ts
  /**
   * Rebuilds operation_rows from the source tables for orders created in [from, to).
   * Set-based and idempotent: it converges on the current source state for the windowed orders,
   * so running it twice leaves the same result, and running it while live is safe
   * (writes that commit after the snapshot are re-applied by the hooks).
   */
  async rederiveWindow(tx: Db, from: Date, to: Date): Promise<number> {
    const affected = await tx.$executeRaw`
      WITH latest_event AS (
        SELECT DISTINCT ON (payment_order_id)
               payment_order_id, event_type, occurred_at, id
        FROM events
        WHERE occurred_at >= ${from}
        ORDER BY payment_order_id, occurred_at DESC, id DESC
      )
      INSERT INTO operation_rows (
        payment_order_id, company_id, status, worker_name,
        amount_cents, currency,
        latest_event_type, latest_event_at, latest_event_id,
        created_at, updated_at
      )
      SELECT
             o.id, o.company_id, o.status, w.name,
             o.amount_cents, o.currency,
             le.event_type, le.occurred_at, le.id,
             o.created_at, o.updated_at
      FROM payment_orders o
      JOIN workers w ON w.id = o.worker_id
      LEFT JOIN latest_event le ON le.payment_order_id = o.id
      WHERE o.created_at >= ${from} AND o.created_at < ${to}
      ON CONFLICT (payment_order_id) DO UPDATE SET
        company_id        = excluded.company_id,
        status            = excluded.status,
        worker_name       = excluded.worker_name,
        amount_cents      = excluded.amount_cents,
        currency          = excluded.currency,
        latest_event_type = excluded.latest_event_type,
        latest_event_at   = excluded.latest_event_at,
        latest_event_id   = excluded.latest_event_id,
        created_at        = excluded.created_at,
        updated_at        = excluded.updated_at
    `;
    return Number(affected);
  }
```

Hmm — `o.status` in the SELECT for an INSERT into an enum column: the type matches (enum) ✓ no cast needed.

```ts
  /**
   * Recomputes company_financial_totals from the source tables for every company with orders.
   * Idempotent: the result depends only on the current source state.
   */
  async recomputeTotals(tx: Db): Promise<void> {
    await tx.$executeRaw`
      WITH agg AS (
        SELECT company_id,
               COALESCE(SUM(amount_cents) FILTER (WHERE status = 'pending'), 0)   AS pending_amount_cents,
               COUNT(*) FILTER (WHERE status = 'pending')                         AS pending_count,
               COALESCE(SUM(amount_cents) FILTER (WHERE status = 'approved'), 0)  AS approved_amount_cents,
               COUNT(*) FILTER (WHERE status = 'approved')                        AS approved_count,
               COALESCE(SUM(amount_cents) FILTER (WHERE status = 'disputed'), 0)  AS disputed_amount_cents,
               COUNT(*) FILTER (WHERE status = 'disputed')                        AS disputed_count,
               COALESCE(SUM(amount_cents) FILTER (WHERE status = 'cancelled'), 0) AS cancelled_amount_cents,
               COUNT(*) FILTER (WHERE status = 'cancelled')                       AS cancelled_count
        FROM payment_orders
        GROUP BY company_id
      )
      INSERT INTO company_financial_totals (
        company_id,
        pending_amount_cents, pending_count,
        approved_amount_cents, approved_count,
        disputed_amount_cents, disputed_count,
        cancelled_amount_cents, cancelled_count,
        updated_at
      )
      SELECT company_id,
             pending_amount_cents, pending_count,
             approved_amount_cents, approved_count,
             disputed_amount_cents, disputed_count,
             cancelled_amount_cents, cancelled_count,
             now()
      FROM agg
      ON CONFLICT (company_id) DO UPDATE SET
        pending_amount_cents   = excluded.pending_amount_cents,
        pending_count          = excluded.pending_count,
        approved_amount_cents  = excluded.approved_amount_cents,
        approved_count         = excluded.approved_count,
        disputed_amount_cents  = excluded.disputed_amount_cents,
        disputed_count         = excluded.disputed_count,
        cancelled_amount_cents = excluded.cancelled_amount_cents,
        cancelled_count        = excluded.cancelled_count,
        updated_at             = excluded.updated_at
    `;
    await tx.$executeRaw`
      DELETE FROM company_financial_totals cft
      WHERE NOT EXISTS (SELECT 1 FROM payment_orders po WHERE po.company_id = cft.company_id)
    `;
  }
```

Drift scan:

```ts
  /**
   * Orders created in [from, to) whose operation row is missing or disagrees with the source.
   */
  async findDriftedOrderIds(tx: Db, from: Date, to: Date): Promise<string[]> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      WITH latest_event AS (
        SELECT DISTINCT ON (payment_order_id)
               payment_order_id, id AS event_id
        FROM events
        WHERE occurred_at >= ${from}
        ORDER BY payment_order_id, occurred_at DESC, id DESC
      )
      SELECT o.id
      FROM payment_orders o
      JOIN workers w ON w.id = o.worker_id
      LEFT JOIN operation_rows r ON r.payment_order_id = o.id
      LEFT JOIN latest_event le ON le.payment_order_id = o.id
      WHERE o.created_at >= ${from} AND o.created_at < ${to}
        AND (
          r.id IS NULL
          OR r.status IS DISTINCT FROM o.status
          OR r.company_id IS DISTINCT FROM o.company_id
          OR r.worker_name IS DISTINCT FROM w.name
          OR r.amount_cents IS DISTINCT FROM o.amount_cents
          OR r.currency IS DISTINCT FROM o.currency
          OR r.latest_event_id IS DISTINCT FROM le.event_id
        )
    `;
    return rows.map((row) => row.id);
  }

  /**
   * Companies whose totals row is missing, stale, or disagrees with the source aggregate.
   * Limited to companies with activity in [from, to) (plus any row left for a company with no orders).
   */
  async findTotalsDriftedCompanyIds(tx: Db, from: Date, to: Date): Promise<string[]> {
    const rows = await tx.$queryRaw<{ company_id: string }[]>`
      SELECT company_id
      FROM (
        SELECT DISTINCT po.company_id
        FROM payment_orders po
        WHERE po.created_at >= ${from} OR po.updated_at >= ${from}
      ) active
      WHERE active.company_id NOT IN (SELECT company_id FROM company_financial_totals)
         OR EXISTS (
           SELECT 1
           FROM company_financial_totals t
           WHERE t.company_id = active.company_id
             AND NOT EXISTS (
               SELECT 1
               FROM (
                 SELECT po2.company_id,
                        COALESCE(SUM(po2.amount_cents) FILTER (WHERE po2.status = 'pending'), 0)   AS pending_amount,
                        COUNT(*) FILTER (WHERE po2.status = 'pending')                             AS pending_count,
                        COALESCE(SUM(po2.amount_cents) FILTER (WHERE po2.status = 'approved'), 0)  AS approved_amount,
                        COUNT(*) FILTER (WHERE po2.status = 'approved')                            AS approved_count,
                        COALESCE(SUM(po2.amount_cents) FILTER (WHERE po2.status = 'disputed'), 0)  AS disputed_amount,
                        COUNT(*) FILTER (WHERE po2.status = 'disputed')                            AS disputed_count,
                        COALESCE(SUM(po2.amount_cents) FILTER (WHERE po2.status = 'cancelled'), 0) AS cancelled_amount,
                        COUNT(*) FILTER (WHERE po2.status = 'cancelled')                           AS cancelled_count
                 FROM payment_orders po2
                 WHERE po2.company_id = active.company_id
                 GROUP BY po2.company_id
               ) s
               WHERE s.pending_amount   IS DISTINCT FROM t.pending_amount_cents
                  OR s.pending_count    IS DISTINCT FROM t.pending_count
                  OR s.approved_amount  IS DISTINCT FROM t.approved_amount_cents
                  OR s.approved_count   IS DISTINCT FROM t.approved_count
                  OR s.disputed_amount  IS DISTINCT FROM t.disputed_amount_cents
                  OR s.disputed_count   IS DISTINCT FROM t.disputed_count
                  OR s.cancelled_amount IS DISTINCT FROM t.cancelled_amount_cents
                  OR s.cancelled_count  IS DISTINCT FROM t.cancelled_count
             )
         )
      UNION
      SELECT t.company_id
      FROM company_financial_totals t
      WHERE NOT EXISTS (SELECT 1 FROM payment_orders po WHERE po.company_id = t.company_id)
    `;
    return rows.map((row) => row.company_id);
  }
}
```

Wait — `COUNT(*) FILTER (...)` is bigint vs `t.pending_count` int — `IS DISTINCT FROM` → implicit cast ✓.

One concern: `active.company_id NOT IN (SELECT company_id FROM company_financial_totals)` — NOT IN with a subquery that could contain NULL — company_id is NOT NULL ✓ safe.

`src/operations/projection.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Event, OrderStatus, PaymentOrder, Prisma } from '@prisma/client';
import { ProjectionRepository } from './projection.repository.js';

type Tx = Prisma.TransactionClient;

export type OrderChange = Pick<
  PaymentOrder,
  'id' | 'companyId' | 'workerId' | 'status' | 'amountCents' | 'currency' | 'createdAt' | 'updatedAt'
>;

export type EventChange = Pick<Event, 'id' | 'paymentOrderId' | 'eventType' | 'occurredAt'>;

/**
 * The read-model maintenance hooks.
 * Write services call these inside the write's own transaction: the projection sees exactly what the source sees,
 * a rolled-back write never leaves a trace, and the next dashboard read observes the change (read-your-own-writes).
 */
@Injectable()
export class ProjectionService {
  constructor(private readonly projection: ProjectionRepository) {}

  async applyOrderChange(tx: Tx, order: OrderChange): Promise<void> {
    const previous = await this.projection.findOperationRow(tx, order.id);

    await this.projection.upsertOperationRow(tx, {
      paymentOrderId: order.id,
      companyId: order.companyId,
      workerId: order.workerId,
      status: order.status,
      amountCents: order.amountCents,
      currency: order.currency,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    });

    if (previous) {
      if (previous.status !== order.status) {
        await this.projection.applyTotalsDelta(tx, {
          companyId: order.companyId,
          fromStatus: previous.status,
          toStatus: order.status,
          amountCents: order.amountCents,
        });
      }
      // status unchanged (e.g. worker reassignment): the row was re-synced, the totals are untouched.
    } else {
      await this.projection.applyTotalsDelta(tx, {
        companyId: order.companyId,
        fromStatus: null,
        toStatus: order.status,
        amountCents: order.amountCents,
      });
    }
  }

  async applyEvent(tx: Tx, event: EventChange): Promise<void> {
    await this.projection.applyLatestEvent(tx, {
      id: event.id,
      paymentOrderId: event.paymentOrderId,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
    });
  }
}
```

`src/operations/operations.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Company, CompanyFinancialTotals, OperationRow, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';

export interface OperationQuery {
  companyId?: string;
  status?: OrderStatus;
  from?: Date;
  to?: Date;
  skip?: number;
  take?: number;
}

@Injectable()
export class OperationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async company(id: string): Promise<Company | null> {
    return this.prisma.company.findUnique({ where: { id } });
  }

  async getTotals(companyId: string): Promise<CompanyFinancialTotals | null> {
    return this.prisma.companyFinancialTotals.findUnique({ where: { companyId } });
  }

  /**
   * The dashboard read path — touches only the projection (operation_rows);
   * no join to the source tables.
   */
  listOperations(query: OperationQuery): Promise<OperationRow[]> {
    return this.prisma.operationRow.findMany({
      where: this.whereFor(query),
      orderBy: [{ updatedAt: 'desc' }, { paymentOrderId: 'desc' }],
      skip: query.skip,
      take: query.take,
    });
  }

  countOperations(query: OperationQuery): Promise<number> {
    return this.prisma.operationRow.count({ where: this.whereFor(query) });
  }

  private whereFor(query: OperationQuery): Prisma.OperationRowWhereInput {
    const createdAt: Prisma.OperationRowScalarWhere... 
```

The createdAt filter type: `{ gte?: Date; lt?: Date }` — `Prisma.DateTimeNullableFilter`? It's non-null → `Prisma.DateTimeFilter`. Build:

```ts
  private whereFor(query: OperationQuery): Prisma.OperationRowWhereInput {
    const createdAt: Prisma.DateTimeFilter = {};
    if (query.from) createdAt.gte = query.from;
    if (query.to) createdAt.lt = query.to;
    return {
      ...(query.companyId ? { companyId: query.companyId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to ? { createdAt } : {}),
    };
  }
```

✓.

`src/operations/operations.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { CompanyFinancialTotals, OperationRow, OrderStatus } from '@prisma/client';
import { ResourceNotFoundError, ValidationError } from '../common/errors.js';
import { PrismaService } from '../database/prisma.service.js';
import { ProjectionRepository } from './projection.repository.js';
import { OperationsRepository } from './operations.repository.js';

export interface OperationListFilter {
  companyId?: string;
  status?: OrderStatus;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

export interface OperationDto {
  paymentOrderId: string;
  companyId: string;
  status: OrderStatus;
  workerName: string;
  amountCents: number;
  currency: string;
  latestEventType: string | null;
  latestEventAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OperationListResult {
  items: OperationDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface FinancialTotalsDto {
  companyId: string;
  pending: { amountCents: number; count: number };
  approved: { amountCents: number; count: number };
  disputed: { amountCents: number; count: number };
  cancelled: { amountCents: number; count: number };
  updatedAt: Date;
}

function toOperationDto(row: OperationRow): OperationDto {
  return {
    paymentOrderId: row.paymentOrderId,
    companyId: row.companyId,
    status: row.status,
    workerName: row.workerName,
    amountCents: row.amountCents,
    currency: row.currency,
    latestEventType: row.latestEventType,
    latestEventAt: row.latestEventAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function zeroTotals(companyId: string): FinancialTotalsDto {
  return {
    companyId,
    pending: { amountCents: 0, count: 0 },
    approved: { amountCents: 0, count: 0 },
    disputed: { amountCents: 0, count: 0 },
    cancelled: { amountCents: 0, count: 0 },
    updatedAt: new Date(0),
  };
}

@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operations: OperationsRepository,
    private readonly projection: ProjectionRepository,
  ) {}

  async list(filter: OperationListFilter): Promise<OperationListResult> {
    const query = { companyId: filter.companyId, status: filter.status, from: filter.from, to: filter.to };
    const [rows, total] = await Promise.all([
      this.operations.listOperations({ ...query, skip: (filter.page - 1) * filter.pageSize, take: filter.pageSize }),
      this.operations.countOperations(query),
    ]);
    return { items: rows.map(toOperationDto), total, page: filter.page, pageSize: filter.pageSize };
  }

  async totals(companyId: string): Promise<FinancialTotalsDto> {
    const company = await this.operations.company(companyId);
    if (!company) {
      throw new ResourceNotFoundError(`Company ${companyId} does not exist`, { companyId });
    }
    const row = await this.operations.getTotals(companyId);
    if (!row) {
      return zeroTotals(companyId);
    }
    return {
      companyId,
      pending: { amountCents: Number(row.pendingAmountCents), count: row.pendingCount },
      approved: { amountCents: Number(row.approvedAmountCents), count: row.approvedCount },
      disputed: { amountCents: Number(row.disputedAmountCents), count: row.disputedCount },
      cancelled: { amountCents: Number(row.cancelledAmountCents), count: row.cancelledCount },
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Re-derives the projection for orders created in [from, to) and recomputes all company totals from the source.
   * Idempotent and safe while live.
   */
  async rederive(from: Date, to: Date): Promise<{ rowsRebuilt: number }> {
    if (from.getTime() >= to.getTime()) {
      throw new ValidationError('Invalid re-derivation window', { to: 'must be strictly after "from"' });
    }
    const rowsRebuilt = await this.prisma.transaction(async (tx) => {
      const rebuilt = await this.projection.rederiveWindow(tx, from, to);
      await this.projection.recomputeTotals(tx);
      return rebuilt;
    });
    return { rowsRebuilt };
  }
}
```

`src/operations/drift-repair.service.ts` — as drafted. Import Logger, Cron.

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service.js';
import { ProjectionRepository } from './projection.repository.js';

export interface DriftRepairReport {
  from: Date;
  to: Date;
  driftedOrders: number;
  rowsRepaired: number;
  driftedTotalsCompanies: number;
  totalsRecomputed: boolean;
}

const DEFAULT_WINDOW_HOURS = 24;
const DEFAULT_CRON = '*/5 * * * *';

/**
 * Scheduled drift repair: periodically compares the projection against the source for a recent window and
 * converges what disagrees, without a person noticing first.
 * Window: DRIFT_REPAIR_WINDOW_HOURS (default 24). Schedule: DRIFT_REPAIR_CRON (default every 5 minutes).
 */
@Injectable()
export class DriftRepairService {
  private readonly logger = new Logger(DriftRepairService.name);
  private readonly windowMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly projection: ProjectionRepository,
  ) {
    const hours = Number(process.env.DRIFT_REPAIR_WINDOW_HOURS ?? DEFAULT_WINDOW_HOURS);
    this.windowMs = (Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_WINDOW_HOURS) * 3_600_000;
  }

  @Cron(process.env.DRIFT_REPAIR_CRON ?? DEFAULT_CRON)
  async run(): Promise<DriftRepairReport> {
    const to = new Date();
    const from = new Date(to.getTime() - this.windowMs);
    try {
      const report = await this.prisma.transaction(async (tx) => {
        const driftedOrderIds = await this.projection.findDriftedOrderIds(tx, from, to);
        let rowsRepaired = 0;
        if (driftedOrderIds.length > 0) {
          rowsRepaired = await this.projection.rederiveWindow(tx, from, to);
        }
        const driftedCompanyIds = await this.projection.findTotalsDriftedCompanyIds(tx, from, to);
        let totalsRecomputed = false;
        if (driftedCompanyIds.length > 0) {
          await this.projection.recomputeTotals(tx);
          totalsRecomputed = true;
        }
        return {
          from,
          to,
          driftedOrders: driftedOrderIds.length,
          rowsRepaired,
          driftedTotalsCompanies: driftedCompanyIds.length,
          totalsRecomputed,
        };
      });
      if (report.driftedOrders > 0 || report.driftedTotalsCompanies > 0) {
        this.logger.warn(
          `Drift repaired: ${report.driftedOrders} order row(s) in [${from.toISOString()}, ${to.toISOString()}); ` +
          `totals recomputed: ${report.totalsRecomputed}`,
        );
      }
      return report;
    } catch (error) {
      this.logger.error(
        `Drift repair failed for window [${from.toISOString()}, ${to.toISOString()}]: ${error instanceof Error ? error.stack : String(error)}`,
      );
      throw error;
    }
  }
}
```

`src/operations/operations.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  finishValidation,
  parseOptionalIsoDate,
  parseOptionalUuid,
  parsePositiveInt,
  parseRequiredIsoDate,
  parseStatus,
  requireUuid,
  ValidationErrors,
} from '../common/validation.js';
import {
  FinancialTotalsDto,
  OperationListResult,
  OperationsService,
} from './operations.service.js';

@Controller('operations')
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get()
  list(@Query() query: Record<string, string | undefined>): Promise<OperationListResult> {
    const errors: ValidationErrors = {};
    const companyId = parseOptionalUuid(query?.companyId, 'companyId', errors);
    const status = parseStatus(query?.status, 'status', errors);
    const from = parseOptionalIsoDate(query?.from, 'from', errors);
    const to = parseOptionalIsoDate(query?.to, 'to', errors);
    const page = parsePositiveInt(query?.page, 'page', errors, 1_000_000) ?? 1;
    const pageSize = parsePositiveInt(query?.pageSize, 'pageSize', errors, 100) ?? 20;
    if (from !== undefined && to !== undefined && from.getTime() >= to.getTime()) {
      errors.to = 'must be strictly after "from"';
    }
    finishValidation(errors);
    return this.operations.list({ companyId, status, from, to, page, pageSize });
  }

  @Get('companies/:companyId/financial-totals')
  financialTotals(@Param('companyId') companyId: string): Promise<FinancialTotalsDto> {
    requireUuid(companyId, 'companyId');
    return this.operations.totals(companyId);
  }

  @Post('rederive')
  rederive(@Body() body: Record<string, unknown> | undefined): Promise<{ rowsRebuilt: number }> {
    const errors: ValidationErrors = {};
    const from = parseRequiredIsoDate(body?.from, 'from', errors);
    const to = parseRequiredIsoDate(body?.to, 'to', errors);
    if (from !== undefined && to !== undefined && from.getTime() >= to.getTime()) {
      errors.to = 'must be strictly after "from"';
    }
    finishValidation(errors);
    return this.operations.rederive(from as Date, to as Date);
  }
}
```

`src/operations/operations.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { DriftRepairService } from './drift-repair.service.js';
import { OperationsController } from './operations.controller.js';
import { OperationsRepository } from './operations.repository.js';
import { OperationsService } from './operations.service.js';
import { ProjectionRepository } from './projection.repository.js';
import { ProjectionService } from './projection.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [OperationsController],
  providers: [OperationsService, OperationsRepository, ProjectionRepository, ProjectionService, DriftRepairService],
  exports: [ProjectionService],
})
export class OperationsModule {}
```

`src/orders/orders.controller.ts`:

```ts
import { Body, Controller, Param, Post } from '@nestjs/common';
import { PaymentOrder } from '@prisma/client';
import { ValidationError } from '../common/errors.js';
import {
  finishValidation,
  parseCurrency,
  parseNonNegativeInt,
  parseUuid,
  requireUuid,
  ValidationErrors,
} from '../common/validation.js';
import { OrdersService } from './orders.service.js';
import { NewOrderInput } from './orders.repository.js';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  create(@Body() body: Record<string, unknown> | undefined): Promise<PaymentOrder> {
    const errors: ValidationErrors = {};
    const input = {
      companyId: parseUuid(body?.companyId, 'companyId', errors),
      workerId: parseUuid(body?.workerId, 'workerId', errors),
      amountCents: parseNonNegativeInt(body?.amountCents, 'amountCents', errors),
      currency: parseCurrency(body?.currency, 'currency', errors),
    };
    finishValidation(errors);
    return this.orders.create(input as NewOrderInput);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string): Promise<PaymentOrder> {
    requireUuid(id, 'id');
    return this.orders.approve(id);
  }

  @Post(':id/dispute')
  dispute(@Param('id') id: string): Promise<PaymentOrder> {
    requireUuid(id, 'id');
    return this.orders.dispute(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string): Promise<PaymentOrder> {
    requireUuid(id, 'id');
    return this.orders.cancel(id);
  }

  @Post(':id/assign-worker')
  assignWorker(@Param('id') id: string, @Body() body: Record<string, unknown> | undefined): Promise<PaymentOrder> {
    requireUuid(id, 'id');
    const errors: ValidationErrors = {};
    const workerId = parseUuid(body?.workerId, 'workerId', errors);
    finishValidation(errors);
    return this.orders.assignWorker(id, workerId);
  }
}
```

`src/app.module.ts`, `src/main.ts` — as drafted.

`src/common/validation.ts` in full:

```ts
import { OrderStatus } from '@prisma/client';
import { ValidationError } from './errors.js';
import { ORDER_STATUSES } from './order-status.js';

export type ValidationErrors = Record<string, unknown>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function finishValidation(errors: ValidationErrors): void {
  if (Object.keys(errors).length > 0) {
    throw new ValidationError('Invalid request parameters', errors);
  }
}

export function parseUuid(value: unknown, field: string, errors: ValidationErrors): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    errors[field] = 'must be a valid UUID';
    return '';
  }
  return value;
}

export function parseOptionalUuid(value: unknown, field: string, errors: ValidationErrors): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const parsed = parseUuid(value, field, errors);
  return errors[field] !== undefined ? undefined : parsed;
}

export function requireUuid(value: string, field: string): void {
  if (!UUID_RE.test(value)) {
    throw new ValidationError('Invalid request parameters', { [field]: 'must be a valid UUID' });
  }
}

export function parseStatus(value: unknown, field: string, errors: ValidationErrors): OrderStatus | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string' || !(ORDER_STATUSES as readonly string[]).includes(value)) {
    errors[field] = `must be one of: ${ORDER_STATUSES.join(', ')}`;
    return undefined;
  }
  return value as OrderStatus;
}

export function parseOptionalIsoDate(value: unknown, field: string, errors: ValidationErrors): Date | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return parseIsoDate(value, field, errors);
}

export function parseRequiredIsoDate(value: unknown, field: string, errors: ValidationErrors): Date | undefined {
  if (value === undefined || value === null || value === '') {
    errors[field] = 'is required';
    return undefined;
  }
  return parseIsoDate(value, field, errors);
}

function parseIsoDate(value: unknown, field: string, errors: ValidationErrors): Date | undefined {
  if (typeof value !== 'string') {
    errors[field] = 'must be an ISO-8601 date string';
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    errors[field] = 'must be a valid ISO-8601 date';
    return undefined;
  }
  return date;
}

export function parsePositiveInt(value: unknown, field: string, errors: ValidationErrors, max?: number): number | undefined {
  const n = toInt(value);
  if (!Number.isInteger(n) || n < 1 || (max !== undefined && n > max)) {
    errors[field] = max !== undefined ? `must be an integer between 1 and ${max}` : 'must be a positive integer';
    return undefined;
  }
  return n;
}

export function parseNonNegativeInt(value: unknown, field: string, errors: ValidationErrors): number | undefined {
  const n = toInt(value);
  if (!Number.isInteger(n) || n < 0) {
    errors[field] = 'must be an integer >= 0';
    return undefined;
  }
  return n;
}

function toInt(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return Number(value);
  }
  return NaN;
}

export function parseCurrency(value: unknown, field: string, errors: ValidationErrors): string | undefined {
  if (typeof value !== 'string' || !/^[A-Za-z]{3}$/.test(value)) {
    errors[field] = 'must be a 3-letter ISO-4217 currency code';
    return undefined;
  }
  return value.toUpperCase();
}
```

`src/common/errors.exception-filter.ts` — final:

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { AppError, ErrorCode } from './errors.js';

interface ErrorEnvelope {
  error: { code: ErrorCode; message: string; details: Record<string, unknown> };
}

@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorEnvelopeFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppError) {
      this.send(response, exception.status, exception.code, exception.message, exception.details);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : ((body as { message?: unknown }).message ?? exception.message);
      this.send(response, status, this.codeForStatus(status), String(message), {});
      return;
    }

    this.logger.error(`Unhandled exception: ${exception instanceof Error ? exception.stack : String(exception)}`);
    this.send(response, HttpStatus.INTERNAL_SERVER_ERROR, 'internal_error', 'Internal server error', {});
  }

  private codeForStatus(status: number): ErrorCode {
    if (status === 404) return 'resource_not_found';
    if (status === 409) return 'conflict';
    if (status >= 400 && status < 500) return 'validation_failed';
    return 'internal_error';
  }

  private send(
    response: Response,
    status: number,
    code: ErrorCode,
    message: string,
    details: Record<string, unknown>,
  ): void {
    const envelope: ErrorEnvelope = { error: { code, message, details } };
    response.status(status).json(envelope);
  }
}
```

`src/common/errors.ts` final:

```ts
export type ErrorCode = 'resource_not_found' | 'validation_failed' | 'conflict' | 'internal_error';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ResourceNotFoundError extends AppError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(404, 'resource_not_found', message, details);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(400, 'validation_failed', message, details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(409, 'conflict', message, details);
  }
}
```

Now the **tests**.

`test/helpers.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { DriftRepairService } from '../src/operations/drift-repair.service.js';

export interface TestApp {
  moduleRef: TestingModule;
  prisma: PrismaService;
  close(): Promise<void>;
}

/**
 * Builds the real application (real Nest wiring, real Postgres via DATABASE_URL).
 * The scheduled drift-repair job is stubbed out so that tests control every projection mutation.
 */
export async function createTestApp(): Promise<TestApp> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must point to a PostgreSQL database with the migrations applied');
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DriftRepairService)
    .useValue({ run: () => { throw new Error('the scheduled drift repair is disabled in tests'); } })
    .compile();
  await moduleRef.init();
  const prisma = moduleRef.get(PrismaService);
  return {
    moduleRef,
    prisma,
    close: async () => {
      await moduleRef.close();
    },
  };
}

export interface CompanySeed {
  companyId: string;
  workerId: string;
  workerName: string;
  otherWorkerId: string;
  otherWorkerName: string;
}

/** A fresh company with two workers (isolates each test from every other test). */
export async function seedCompany(prisma: PrismaService | PrismaClient, label: string): Promise<CompanySeed> {
  const company = await prisma.company.create({ data: { name: `${label}-${randomUUID()}` } });
  const worker = await prisma.worker.create({ data: { name: `${label} worker A ${randomUUID().slice(0, 8)}`, companyId: company.id } });
  const otherWorker = await prisma.worker.create({ data: { name: `${label} worker B ${randomUUID().slice(0, 8)}`, companyId: company.id } });
  return { companyId: company.id, workerId: worker.id, workerName: worker.name, otherWorkerId: otherWorker.id, otherWorkerName: otherWorker.name };
}

export function windowAroundNow(): { from: Date; to: Date } {
  return { from: new Date(Date.now() - 5 * 60_000), to: new Date(Date.now() + 5 * 60_000) };
}

export async function snapshotOperationRows(prisma: PrismaClient, companyId: string): Promise<Record<string, unknown>[]> {
  const rows = await prisma.operationRow.findMany({ where: { companyId }, orderBy: { paymentOrderId: 'asc' } });
  return rows.map((row) => ({
    paymentOrderId: row.paymentOrderId,
    status: row.status,
    workerName: row.workerName,
    amountCents: row.amountCents,
    latestEventType: row.latestEventType,
    latestEventAt: row.latestEventAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}
```

Hmm — `moduleRef.init()` vs `createNestApplication` — for service-level tests, `init()` is enough (no HTTP). I'll use `moduleRef.init()`.

`test/orders.spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConflictError, ResourceNotFoundError } from '../src/common/errors.js';
import { OrdersService } from '../src/orders/orders.service.js';
import { OperationsService } from '../src/operations/operations.service.js';
import { CompanySeed, createTestApp, seedCompany, TestApp } from './helpers.js';

describe('read-your-own-writes (orders -> operations dashboard)', () => {
  let app: TestApp;
  let orders: OrdersService;
  let operations: OperationsService;
  let seed: CompanySeed;

  beforeAll(async () => {
    app = await createTestApp();
    orders = app.moduleRef.get(OrdersService);
    operations = app.moduleRef.get(OperationsService);
    seed = await seedCompany(app.prisma, 'ryw');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('shows a created order immediately, and its approval on the very next request', async () => {
    const order = await orders.create({ companyId: seed.companyId, workerId: seed.workerId, amountCents: 5_000, currency: 'USD' });

    const afterCreate = await operations.list({ companyId: seed.companyId, page: 1, pageSize: 50 });
    const created = afterCreate.items.find((row) => row.paymentOrderId === order.id);
    expect(created).toBeDefined();
    expect(created!.status).toBe('pending');
    expect(created!.workerName).toBe(seed.workerName);
    expect(created!.amountCents).toBe(5_000);

    await orders.approve(order.id);

    // No waiting, no refresh job: the very next read shows the approval.
    const afterApprove = await operations.list({ companyId: seed.companyId, page: 1, pageSize: 50 });
    const approved = afterApprove.items.find((row) => row.paymentOrderId === order.id);
    expect(approved).toBeDefined();
    expect(approved!.status).toBe('approved');
    expect(approved!.latestEventType).toBe('approved');

    const totals = await operations.totals(seed.companyId);
    expect(totals.approved).toEqual({ amountCents: 5_000, count: 1 });
    expect(totals.pending).toEqual({ amountCents: 0, count: 0 });
  });

  it('a worker reassignment is visible on the next request without moving totals', async () => {
    const order = await orders.create({ companyId: seed.companyId, workerId: seed.workerId, amountCents: 700, currency: 'USD' });

    const totalsBefore = await operations.totals(seed.companyId);
    await orders.assignWorker(order.id, seed.otherWorkerId);

    const row = (await operations.list({ companyId: seed.companyId, page: 1, pageSize: 50 }))
      .items.find((r) => r.paymentOrderId === order.id);
    expect(row!.workerName).toBe(seed.otherWorkerName);
    expect(row!.latestEventType).toBe('worker_assigned');

    const totalsAfter = await operations.totals(seed.companyId);
    expect(totalsAfter.pending.amountCents).toBe(totalsBefore.pending.amountCents);
    expect(totalsAfter.pending.count).toBe(totalsBefore.pending.count);
    expect(row!.amountCents).toBe(700);
  });

  it('a failed write rolls back: neither source nor projection changes', async () => {
    const order = await orders.create({ companyId: seed.companyId, workerId: seed.workerId, amountCents: 1_200, currency: 'USD' });
    await orders.cancel(order.id);

    const totalsBefore = await operations.totals(seed.companyId);
    const rowBefore = (await operations.list({ companyId: seed.companyId, page: 1, pageSize: 50 }))
      .items.find((r) => r.paymentOrderId === order.id);

    // The second cancel must conflict and leave everything untouched.
    await expect(orders.cancel(order.id)).rejects.toThrow(ConflictError);

    const totalsAfter = await operations.totals(seed.companyId);
    expect(totalsAfter).toEqual(totalsBefore);
    const rowAfter = (await operations.list({ companyId: seed.companyId, page: 1, pageSize: 50 }))
      .items.find((r) => r.paymentOrderId === order.id);
    expect(rowAfter).toEqual(rowBefore);
    const source = await app.prisma.paymentOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(source.status).toBe('cancelled');
  });

  it('rejects operations on unknown orders with resource_not_found', async () => {
    await expect(orders.approve(randomUUID())).rejects.toThrow(ResourceNotFoundError);
  });

  it('the dashboard reads only the projection, not the source tables', async () => {
    // A source row written without the maintenance hook must not appear in the dashboard.
    const raw = await app.prisma.paymentOrder.create({
      data: { companyId: seed.companyId, workerId: seed.workerId, amountCents: 777, currency: 'USD' },
    });
    const list = await operations.list({ companyId: seed.companyId, page: 1, pageSize: 100 });
    expect(list.items.map((row) => row.paymentOrderId)).not.toContain(raw.id);
  });
});
```

Wait — `expect(totalsAfter).toEqual(totalsBefore)` — the totals include `updatedAt` (a Date) — the failed cancel doesn't touch totals → the updatedAt is the same Date value ✓ toEqual on Date compares by time ✓.

`rowAfter).toEqual(rowBefore)` — both from list; the failed cancel changes nothing ✓ (same updatedAt etc.) ✓.

Note: the "worker reassignment" test: the `latestEventType` 'worker_assigned' — but the order was just created (no events) → the event is created on assign → latest is 'worker_assigned' ✓.

Test 1 totals check: `expect(totals.approved).toEqual({ amountCents: 5000, count: 1 })` — the company is fresh: only this order. But wait — is the company fresh per describe (a single `seed` for all the tests)? Test 2 adds a 700-pending order; test 3 adds 1200-cancelled. Test 1 runs first (serial) — at that point the totals: approved 5000 ✓ pending 0 ✓. ✓ (vitest runs `it`s in a file serially by default ✓.)

`test/concurrency.spec.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OrdersService } from '../src/orders/orders.service.js';
import { OperationsService } from '../src/operations/operations.service.js';
import { CompanySeed, createTestApp, seedCompany, TestApp } from './helpers.js';

describe('concurrent updates to one company totals', () => {
  let app: TestApp;
  let orders: OrdersService;
  let operations: OperationsService;
  let seed: CompanySeed;

  beforeAll(async () => {
    app = await createTestApp();
    orders = app.moduleRef.get(OrdersService);
    operations = app.moduleRef.get(OperationsService);
    seed = await seedCompany(app.prisma, 'conc');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('two concurrent approvals for the same company are both reflected in the totals', async () => {
    const a = await orders.create({ companyId: seed.companyId, workerId: seed.workerId, amountCents: 1_000, currency: 'USD' });
    const b = await orders.create({ companyId: seed.companyId, workerId: seed.otherWorkerId, amountCents: 2_500, currency: 'USD' });

    // Concurrent, not sequential: two separate transactions fight for the same totals row.
    await Promise.all([orders.approve(a.id), orders.approve(b.id)]);

    const totals = await operations.totals(seed.companyId);
    expect(totals.approved.amountCents).toBe(3_500);
    expect(totals.approved.count).toBe(2);
    expect(totals.pending).toEqual({ amountCents: 0, count: 0 });
  });

  it('eight concurrent approvals sum exactly (no lost update at higher contention)', async () => {
    const amounts = [101, 202, 303, 404, 505, 606, 707, 808];
    const orders_ = await Promise.all(
      amounts.map((amountCents, i) =>
        orders.create({
          companyId: seed.companyId,
          workerId: i % 2 === 0 ? seed.workerId : seed.otherWorkerId,
          amountCents,
          currency: 'USD',
        }),
      ),
    );

    await Promise.all(orders_.map((o) => orders.approve(o.id)));

    const totals = await operations.totals(seed.companyId);
    // test 1 already approved 3_500 for this company
    expect(totals.approved.amountCents).toBe(3_500 + amounts.reduce((sum, x) => sum + x, 0));
    expect(totals.approved.count).toBe(2 + amounts.length);

    const rows = (await operations.list({ companyId: seed.companyId, status: 'approved', page: 1, pageSize: 100 })).items;
    expect(rows.filter((row) => orders_.some((o) => o.id === row.paymentOrderId))).toHaveLength(amounts.length);
  });
});
```

`test/operations.spec.ts` — re-derivation + drift:

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DriftRepairService } from '../src/operations/drift-repair.service.js';
import { OperationsService } from '../src/operations/operations.service.js';
import { ProjectionRepository } from '../src/operations/projection.repository.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { ResourceNotFoundError } from '../src/common/errors.js';
import { createTestApp, snapshotOperationRows, TestApp, windowAroundNow } from './helpers.js';

describe('re-derivation and drift repair', () => {
  let app: TestApp;
  let operations: OperationsService;
  let drift: DriftRepairService;

  beforeAll(async () => {
    app = await createTestApp();
    operations = app.moduleRef.get(OperationsService);
    drift = new DriftRepairService(app.moduleRef.get(PrismaService), app.moduleRef.get(ProjectionRepository));
  });

  afterAll(async () => {
    await app?.close();
  });

  async function seedSourceState() {
    // Direct source seed: the projection is built purely by the re-derivation routine.
    const company = await app.prisma.company.create({ data: { name: `rederive-${randomUUID()}` } });
    const workerA = await app.prisma.worker.create({ data: { name: `RD worker A ${randomUUID().slice(0, 8)}`, companyId: company.id } });
    const workerB = await app.prisma.worker.create({ data: { name: `RD worker B ${randomUUID().slice(0, 8)}`, companyId: company.id } });

    const t1 = new Date(Date.now() - 5 * 60_000);
    const t2 = new Date(Date.now() - 3 * 60_000);
    const t3 = new Date(Date.now() - 1 * 60_000);

    const approvedOrder = await app.prisma.paymentOrder.create({
      data: { companyId: company.id, workerId: workerA.id, status: 'approved', amountCents: 100, currency: 'USD' },
    });
    const pendingOrder = await app.prisma.paymentOrder.create({
      data: { companyId: company.id, workerId: workerB.id, status: 'pending', amountCents: 200, currency: 'USD' },
    });
    const disputedOrder = await app.prisma.paymentOrder.create({
      data: { companyId: company.id, workerId: workerA.id, status: 'disputed', amountCents: 300, currency: 'USD' },
    });

    await app.prisma.event.create({ data: { paymentOrderId: approvedOrder.id, eventType: 'field_visit', occurredAt: t1 } });
    await app.prisma.event.create({ data: { paymentOrderId: approvedOrder.id, eventType: 'approved', occurredAt: t2 } });
    await app.prisma.event.create({ data: { paymentOrderId: pendingOrder.id, eventType: 'created', occurredAt: t3 } });

    return { company, workerA, workerB, approvedOrder, pendingOrder, disputedOrder, t1, t2, t3 };
  }

  it('rebuilding a window reproduces the join result, and a second run leaves the same result', async () => {
    const s = await seedSourceState();
    const window = windowAroundNow();

    const first = await operations.rederive(window.from, window.to);
    expect(first.rowsRebuilt).toBeGreaterThanOrEqual(3);

    const rows = await snapshotOperationRows(app.prisma, s.company.id);
    expect(rows).toHaveLength(3);

    const byId = new Map(rows.map((row) => [row.paymentOrderId, row]));
    expect(byId.get(s.approvedOrder.id)).toMatchObject({
      status: 'approved',
      workerName: s.workerA.name,
      amountCents: 100,
      latestEventType: 'approved',
      latestEventAt: s.t2.toISOString(),
    });
    expect(byId.get(s.pendingOrder.id)).toMatchObject({
      status: 'pending',
      workerName: s.workerB.name,
      amountCents: 200,
      latestEventType: 'created',
    });
    expect(byId.get(s.disputedOrder.id)).toMatchObject({
      status: 'disputed',
      amountCents: 300,
      latestEventType: null,
      latestEventAt: null,
    });

    // Totals recomputed from the source, exactly.
    const totals = await operations.totals(s.company.id);
    expect(totals.approved).toEqual({ amountCents: 100, count: 1 });
    expect(totals.pending).toEqual({ amountCents: 200, count: 1 });
    expect(totals.disputed).toEqual({ amountCents: 300, count: 1 });

    // A second run over the same window must leave the same result (idempotent, safe while live).
    const second = await operations.rederive(window.from, window.to);
    const rowsAfterSecond = await snapshotOperationRows(app.prisma, s.company.id);
    expect(second.rowsRebuilt).toBeGreaterThanOrEqual(3);
    expect(rowsAfterSecond).toEqual(rows);
  });

  it('the drift repair job finds and fixes injected drift in rows and totals', async () => {
    const s = await seedSourceState();
    const window = windowAroundNow();
    await operations.rederive(window.from, window.to); // baseline: projection == source

    // Inject drift the way a deploy mid-transaction or a manual data fix would.
    await app.prisma.operationRow.update({
      where: { paymentOrderId: s.approvedOrder.id },
      data: { status: 'pending', workerName: 'corrupted', latestEventType: null, latestEventAt: null, latestEventId: null },
    });
    await app.prisma.companyFinancialTotals.update({
      where: { companyId: s.company.id },
      data: { approvedAmountCents: { decrement: 100 }, approvedCount: { decrement: 1 } },
    });

    // Sanity: the drift is actually there before the repair.
    const drifted = await snapshotOperationRows(app.prisma, s.company.id);
    expect(drifted.find((row) => row.paymentOrderId === s.approvedOrder.id)).toMatchObject({ status: 'pending', workerName: 'corrupted' });
    const corruptedTotals = await operations.totals(s.company.id);
    expect(corruptedTotals.approved).toEqual({ amountCents: 0, count: 0 });

    const report = await drift.run();
    expect(report.driftedOrders).toBeGreaterThanOrEqual(1);
    expect(report.totalsRecomputed).toBe(true);

    // The projection matches the source again.
    const repaired = await snapshotOperationRows(app.prisma, s.company.id);
    const byId = new Map(repaired.map((row) => [row.paymentOrderId, row]));
    expect(byId.get(s.approvedOrder.id)).toMatchObject({
      status: 'approved',
      workerName: s.workerA.name,
      latestEventType: 'approved',
    });
    const totals = await operations.totals(s.company.id);
    expect(totals.approved).toEqual({ amountCents: 100, count: 1 });
    expect(totals.pending).toEqual({ amountCents: 200, count: 1 });
    expect(totals.disputed).toEqual({ amountCents: 300, count: 1 });

    // A follow-up run finds nothing to repair.
    const clean = await drift.run();
    expect(clean.driftedOrders).toBe(0);
    expect(clean.driftedTotalsCompanies).toBe(0);
    expect(clean.totalsRecomputed).toBe(false);
  });

  it('returns resource_not_found for a totals lookup of an unknown company', async () => {
    await expect(operations.totals(randomUUID())).rejects.toThrow(ResourceNotFoundError);
  });
});
```

Wait — the "clean" run: after the repair, the re-derivation has already rebuilt the rows; the totals have been recomputed. The clean run: findDriftedOrderIds → 0 ✓; findTotalsDriftedCompanyIds → the company is active (updated_at is recent) and the totals agree → 0 ✓; the stale-row UNION → none ✓.

One concern: the drift-repair window is 24 hours; the seed's created/updated is now ✓.

Another: the `first.rowsRebuilt` in `it 1` — `>= 3` (exactly 3 orders for that company; the window includes orders from other tests/companies! re-derivation is global over the window, not per company — rowsRebuilt counts all orders created in the window across all companies (including from the orders.spec/concurrency spec if they run in the same DB at overlapping times — but the test files run serially (vitest default: files serial? actually vitest runs test files in parallel by default across workers!). Hmm — `pool: 'forks'` — by default, files run in parallel (minThreads…). To be safe against cross-file interference (the re-derivation window includes other files' orders — harmless: rebuilding other companies' rows is fine, idempotent; but the `rowsRebuilt` count could exceed 3 — that's why I used `>= 3` ✓).

But parallel files + shared DB + the drift-repair test's "clean run": while file A's drift test runs its "clean" assertion, file B's (orders.spec) is creating/approving orders via the hook (consistent projection) — the drift check would find no drift from consistent writes ✓. And the recompute-totals triggered by B? B's writes are hook-maintained → no drift. But wait: file B's raw source seed (the "dashboard reads only the projection" test) creates a source order without a projection row → drift (r.id IS NULL) → if file A's "clean" run happens to land in that window → `driftedOrders >= 1` → the assertion `clean.driftedOrders === 0` fails flakily!

To eliminate cross-file flakiness: run test files serially. Vitest: `fileParallelism: false` (v2 option) or `pool: 'forks'` + `poolOptions: { forks: { singleFork: true } }`. Simplest: `fileParallelism: false` in the config (Vitest 2 supports `fileParallelism`). Or set `maxWorkers: 1`/`poolOptions`. I'll use:

```ts
test: {
  environment: 'node',
  include: ['test/**/*.spec.ts'],
  fileParallelism: false,
  testTimeout: 30_000,
  hookTimeout: 30_000,
}
```

Hmm, `fileParallelism` was added in Vitest 2.0 ✓ (replaces the deprecated `threads: false`/`singleThread`). OK. Or the bulletproof approach: make the "clean" assertion tolerant: `expect(clean.driftedOrders).toBeLessThanOrEqual(?)` no — I want a strong assertion. Serial files solve it. Also, even within a single file, there's no interleaving (serial `it`). And the raw-seed order in orders.spec: after that test, the raw order remains without a projection — but the drift service is disabled in those files (overridden) and the operations.spec's drift run uses its own window — with serial files, by the time operations.spec runs, the raw order from orders.spec is in the window → operations.spec's drift test "clean run" would flag it!

The raw order in orders.spec (amountCents 777, no projection) persists in the DB. operations.spec's `drift.run()` — the first run in the drift test: `driftedOrders >= 1` ✓ (still true even with the extra). But the final "clean" run: the raw order is still drift (created in the last hour, no projection row) → `driftedOrders >= 1` → `expect(clean.driftedOrders).toBe(0)` fails.

Solutions:
(a) In the "dashboard reads only the projection" test in orders.spec, after the assertion, repair the drift by deleting the raw order (`app.prisma.paymentOrder.delete`) — cleanup restores consistency (the FK on operation_rows is cascade — no row). The delete removes the source row → no more drift ✓.
(b) Give the raw order a projection row via the re-derivation — but then it appears in the dashboard… do the delete instead.

I'll add cleanup: after the assertion, `await app.prisma.paymentOrder.delete({ where: { id: raw.id } });`. Good — the test self-cleans.

Similarly, the operations.spec's seeded source state (company + orders + events) remains after the test — consistent (the projection was built by the re-derivation + drift repair). The final "clean" run verifies 0 drift ✓. But wait — the "re-derivation" test's seed: after the re-derivation, the projection matches ✓ no drift.

But — the orders.spec + concurrency.spec's companies: the hook-maintained projection is consistent ✓ no drift to later drift runs. And the raw-seed order is deleted ✓.

Another cross-test hazard within operations.spec: the two `it`s each seed a new company ✓ isolated.

And the totals drift check's "active" set = companies with created/updated in the window — includes the orders.spec/concurrency companies (if in the same window across files) — their totals are hook-accurate → not flagged ✓ (the hook's totals are exact by design — that's the invariant we're testing elsewhere).

Hmm — one more: the orders.spec test 3 "a failed write rolls back" — the second cancel throws a ConflictError. Where does the conflict get thrown? Inside `move()`: `findOrThrow` OK (status cancelled ≠ pending → ConflictError before the transition) ✓ no DB mutation ✓.

Now — **the concurrency test and Prisma's interactive transaction**: each approve = one interactive tx. `Promise.all` of 8 → 8 concurrent interactive txs on the pool (default 15) ✓. Each tx: a find (a short read), an updateMany (a row lock on the order row — different rows, no contention), the projection: a findOperationRow, an upsert (a row lock on the operation row — different), a totals upsert (contention on the same row — serialized by the lock; the increment/decrement makes it lossless), an event insert, an applyLatestEvent (a lock on the operation row — brief). Commit. Deadlock risk: two txs lock the totals row then… each tx touches only one shared row (the totals), and the lock order is consistent (all acquire in the same relative order: the order row → the operation row → the totals row → the event). The totals row is locked by the upsert before the event insert; another tx waiting on the totals doesn't hold the event lock (the event is a separate row) → no cycle ✓.

Actually wait — the applyEvent's update happens after the totals upsert; tx1 holds the totals lock and then updates its own operation row (already held) — tx2 waiting on the totals holds its own operation row lock — tx1 doesn't need tx2's operation row → no deadlock ✓.

**The event insert and the latest-event update**: within the same tx ✓.

Now — **Prisma `upsert` with the increment inside update — let me double-check the generated types**: `CompanyFinancialTotalsUpdateInput` includes `approvedAmountCents?: BigInt | BigIntFieldUpdateOperationsInput` and `BigIntFieldUpdateOperationsInput = { increment?: BigInt | number; decrement?: BigInt | number }` ✓. The `update` field of the upsert is typed as `XOR<CompanyFinancialTotalsUpdateInput, CompanyFinancialTotalsUncheckedUpdateInput>` — passing a plain object literal with a computed key — I cast `as CompanyFinancialTotalsUpdateInput` first and mutate via a Record cast — the final object's type is `CompanyFinancialTotalsUpdateInput` ✓ compiles.

**`tx.companyFinancialTotals.upsert({ where: { companyId }, create, update })`** ✓.

**`createdAt` in the OperationRow model has no @default** (it's set explicitly) ✓; `updatedAt` is set explicitly (not @updatedAt) ✓ — the raw SQL sets it.

**Prisma client generation**: `postinstall: prisma generate` ✓. The tests import `@prisma/client` — needs the generated client ✓.

**`Prisma.TransactionClient`** — exported as a type ✓.

**`Db = Prisma.TransactionClient | PrismaClient`** — the `PrismaClient` type import ✓.

**`$executeRaw` on the union type `Db`** — both have `$executeRaw` ✓.

Now the **DESIGN.md** — let me write it (short but complete):

```md
# DESIGN — operations dashboard read model (issue #501)

## Constraints that decide the design

1. **Read-your-own-writes.** An operator approves an order; the next dashboard request shows it. Any design with a
   propagation window (a schedule, a queue, a replica) violates this by construction.
2. **Exact per-company totals.** Finance reconciles against them: no approximation, no "eventually exact".
3. **p95 < 50 ms** at ~3M orders, with no change to what the operator sees (columns, filters, order, page size).

## Design in one paragraph

Two projection tables, maintained by hooks that run **inside the write's own Postgres transaction**:
`operation_rows` (one row per payment order, shaped like the dashboard join) and
`company_financial_totals` (exact per-company aggregates). The dashboard query reads `operation_rows` alone,
served by a covering index that matches filter + sort. A windowed re-derivation routine rebuilds the projection
from the source tables (idempotent, safe while live), and a scheduled drift-repair job compares projection vs
source for a recent window and converges whatever disagrees.

## Why the hook is synchronous and in-transaction

The hook is a plain service call from the write service (`ProjectionService.applyOrderChange` /
`applyEvent`), executed with the same transaction handle as the source mutation:

- the projection sees exactly the writer's snapshot — no visibility gap, so the next read (same or other
  connection) shows the change;
- if the write rolls back, the projection never saw it — no orphaned state, no compensating writes.

### Alternatives rejected

| Alternative | Why it fails / loses |
|---|---|
| Scheduled refresh / interval job | Any interval > 0 is a read-your-own-writes gap. The requirement explicitly forbids it. |
| `REFRESH MATERIALIZED VIEW` (even `CONCURRENTLY`) | Same scheduling problem, plus a full-table rebuild cost and table locks; the refresh is a global operation and cannot bound latency. |
| Postgres trigger on the source table | Works, but the read-model logic moves out of the app: untestable with the app's tests, a second place the business rule lives, and a schema-level surprise for migrations. Same cost as an in-transaction hook, strictly less testable. |
| CDC / outbox / queue (e.g. Debezium → consumer) | Async by construction: consumer lag is exactly the RYOW gap. More infra for a property we don't need (decoupling) at the cost of the property we do (zero gap). |
| Trigger/replication on a replica | Adds a network hop and a lag; RYOW gap again. |
| A better index / faster join on the source | The join spans 3 tables at 3M rows with selective filters; index tuning buys an order of magnitude at best, not the 400× to 50 ms, and every new column the dashboard wants re-opens the join. A cache has the same staleness problem as a schedule. |

An in-transaction hook pays ~one extra indexed upsert + one row update per write — negligible next to the write
itself — and is the only option with a zero gap.

## Exactness under concurrency

The totals row is never read-modify-written in app code. The hook applies an **in-place delta**
(`SET x = x + delta` via Prisma `increment`/`decrement` in an upsert): concurrent writers to the same
company's row serialize on the row lock and each delta is applied exactly once. `test/concurrency.spec.ts`
proves it with two and eight truly concurrent approvals (separate transactions), asserting the exact sum.

## Idempotent re-derivation

`OperationsService.rederive(from, to)` runs two set-based statements in one transaction:

1. `INSERT ... SELECT ... ON CONFLICT DO UPDATE` rebuilds `operation_rows` for orders created in `[from, to)` —
   including the current status and the latest event (`DISTINCT ON (order, occurred_at DESC, id DESC)`).
   The result depends only on the current source state → running it twice leaves the same result.
2. `company_financial_totals` is recomputed from scratch (totals are global, not windowable).

Safe while live: the rebuild reads a snapshot; writes that commit afterwards are applied by the hooks, so the
projection converges to the latest source state either way.

## Drift repair

`DriftRepairService` runs on a cron (`DRIFT_REPAIR_CRON`, default every 5 min) over a recent window
(`DRIFT_REPAIR_WINDOW_HOURS`, default 24):

1. `findDriftedOrderIds` — orders in the window whose row is missing or `IS DISTINCT FROM` the source
   (status, company, worker name, amount, currency, latest event).
2. If any: the windowed re-derivation (the same idempotent routine) repairs the window.
3. `findTotalsDriftedCompanyIds` — companies whose totals row is missing, stale, or disagrees with the source
   aggregate. If any: recompute totals from scratch.
4. The result is logged; the job is a pure convergent pass, so a failed run just means the next one catches up.

Drift sources the job is designed for: a deploy mid-transaction, a manual data fix, a future bug in the hook.
A repair that needs a person to notice first is a no-op.

## The read path

`GET /operations` → `operation_rows` only. No join to the source.

```sql
CREATE INDEX operation_rows_company_status_updated_idx
  ON operation_rows (company_id, status, updated_at DESC, payment_order_id DESC)
  INCLUDE (worker_name, amount_cents, currency, latest_event_type, latest_event_at, latest_event_id, created_at);
```

The index seek is (company, status), the traversal is in sort order, `created_at` (the date-range filter) and
every projected column are in `INCLUDE` — the query is answered from the index alone.
`payment_order_id` in the key makes the pagination stable. (Prisma cannot express `INCLUDE`; the migration
carries it — see "Caveats".)

## What the operator sees — unchanged

Same columns as the old join (order id, company, status, worker name, amount, currency, latest event,
timestamps), same filters (company, status, created-in range), same order (`updated_at DESC`, order id
tiebreak), same page semantics. The only behavioural additions are guarantees: immediate own-writes visibility
and exact totals.

The row's `updated_at` mirrors `payment_orders.updated_at`; an event changes the latest-event fields but not
the row's recency — same as the old join, where an event insert did not touch the order row.

## Caveats

- `operation_rows` has an FK to `payment_orders` (`ON DELETE CASCADE`) that the Prisma model does not declare
  (Prisma models it as a loose projection). The migration is authoritative for the physical schema.
- The drift window is recent-activity-based: corruption older than the window is caught on the next change of
  the affected orders, or by a manual `POST /operations/rederive`.
- Totals are stored as `BIGINT` cents and serialized as JSON numbers; the range is far beyond any realistic
  company total.

## Operations

- Env: `DATABASE_URL`, `PORT`, `DRIFT_REPAIR_CRON`, `DRIFT_REPAIR_WINDOW_HOURS`.
- Apply schema: `pnpm prisma migrate deploy`. Run tests: `pnpm test` (needs a Postgres with the migrations applied).
```

Good. Now — **the "worker join" semantics re-check**: the original operations list joined workers to display the worker name (presumably). Our projection denormalizes `worker_name` ✓. If the worker name changes later — the projection is only updated on the order's write (a reassign) and on re-derivation. A worker rename doesn't update the row until the next re-derivation. Documented? A worker rename is rare; the drift repair doesn't catch it (the drift check compares the worker_name vs the current name — wait, it does: `r.worker_name IS DISTINCT FROM w.name` → a renamed worker flags all their rows as drifted in the window → repaired! Nice — actually that means worker renames within the window get picked up by the drift repair. A side effect, fine.)

**The currency column** — `char(3)`: Prisma `String @db.Char(3)` ✓.

**Amount check constraint** — I'll skip it.

Now — **the drift-check subtle bug**: the re-derivation only rebuilds orders created in the window, but the drift check also compares all fields including the latest event — consistent.

**A subtle bug risk**: the `rederiveWindow`'s `latest_event` CTE filter `WHERE occurred_at >= ${from}` — for an order created in the window, all its events have occurredAt ≥ createdAt ≥ from ✓.

**The `findDriftedOrderIds` uses the same bound** ✓.

**A totals drift check edge case**: a company with no totals row but with orders (drift: the row was deleted) → handled by the NOT IN branch ✓.

**Now, write the `recomputeTotals` DELETE** ✓.

**Order of operations in `recomputeTotals`**: upsert (set the correct values), then delete the stale ✓.

**The report type** ✓.

**Let me think about the `PrismaService.transaction` interactive tx and the raw SQL inside it** ✓.

**A test that asserts "the totals endpoint is zero for a fresh company"** — I'll add a good addition to the operations spec:

```ts
const freshCompany = await prisma.company.create({ data: { name: ... } });
const totals = await operationsService.totals(freshCompany.id);
expect(totals.approved.amountCents).toBe(0); ... expect(totals.pending.count).toBe(0);
```

**And a 404 for an unknown company** — `expect(operationsService.totals(randomUUID())).rejects.toThrow(ResourceNotFoundError)`.

**A dashboard pagination test**: create 25 orders for a company (via the service), list with pageSize 10 page 1 → 10 items; page 3 → 5; total = 25 (plus the other specs' orders? A different company per spec file; within the file, the RYW test adds orders to the same company — use a different company per `it` where necessary, or a different company per describe). I'll create a fresh company per test via a helper (a new seed per `it` where isolation is needed). The cost is small.

Now — **vitest concurrency**: tests within a file run serially by default ✓ (no test-level `concurrent`). Good, since they share the app.

**The app.close() in afterAll** — closes the PrismaService (onModuleDestroy → $disconnect) ✓.

**The Prisma client instantiation in tests** — the `PrismaService` extends `PrismaClient` — the constructor reads `DATABASE_URL` ✓.

**One risk**: `Test.createTestingModule({ imports: [AppModule] })` — AppModule includes `ScheduleModule.forRoot()` → the cron registry; the DriftRepairService is overridden → the original provider (with the @Cron) is never instantiated → no scheduling ✓.

**The `@Cron` decorator evaluation** happens at class-load (module import) — `process.env.DRIFT_REPAIR_CRON ?? '*/5 * * * *'` ✓.

Now — **let me write the files fully.**

Let me reconsider the file list and names (kebab-case.role.ts) — 34 files. All "complete, first line to last line."

Now let me write each file carefully, watching imports (with `.js` extensions) and types.

Wait — the convention example shows `src/payout/payout.service.ts` (singular feature name in the file). I'll use the plural folders `orders/events/operations` with matching file names (`orders.service.ts`, etc.) — consistent.

Let me draft each file.

---

**package.json** — as above.

**tsconfig.json** — as above.

**vitest.config.ts** — as above.

**prisma/schema.prisma** — as drafted.

**prisma/migrations/migration_lock.toml** — as above.

**prisma/migrations/20250601000000_init/migration.sql** — as drafted, including the INCLUDE covering index and the FK on operation_rows.payment_order_id.

Now the code files — as drafted above.

Now the **tests** — as drafted above.

Now — **potential Prisma typing pitfalls** — checked.

**Prisma raw `$executeRaw` with a Date parameter** — supported ✓.

**`$queryRaw` generic** ✓.

**Migration naming** ✓.

**DESIGN.md** — as drafted.

Now, let me re-check **the "worker join" semantics** — covered.

**The currency column** — covered.

**Amount check constraint** — skip.

Now — **the drift check** — covered.

**A subtle bug risk** — covered.

**The totals drift check edge case** — covered.

Now, write the `recomputeTotals` DELETE — covered.

**Order of operations** — covered.

**The report type** — covered.

Now, **the `PrismaService.transaction`** — covered.

**A test that asserts zero totals for a fresh company** — add to operations spec.

**And a 404 for an unknown company** — add.

**A dashboard pagination test** — add to operations spec.

Now — **vitest concurrency** — covered.

**The app.close()** — covered.

**The Prisma client instantiation in tests** — covered.

**One risk** — covered.

**The `@Cron` decorator evaluation** — covered.

Now — **let me write the files fully.**

Let me reconsider the file list and names (kebab-case.role.ts) — 34 files.

Now let me write each file carefully, watching imports (with `.js` extensions) and types.

Wait — the convention example shows `src/payout/payout.service.ts` (singular feature name in the file). I'll use the plural folders `orders/events/operations` with matching file names (`orders.service.ts`, etc.) — consistent.

Let me draft each file — as above.

---

Now, let me reconsider a subtle issue: the **`Prisma` import** in files that use only types — with `verbatimModuleSyntax`? I don't enable it, so a regular import used only as a type is fine (TS elides it). ✓

**`import { Prisma } from '@prisma/client'`** for `Prisma.TransactionClient` etc. ✓.

In `projection.repository.ts` I use `Prisma.TransactionClient`, `PrismaClient`, `CompanyFinancialTotals`, `CompanyFinancialTotalsCreateInput`, `CompanyFinancialTotalsUpdateInput`, `OperationRow`, `OrderStatus` ✓.

In `operations.repository.ts`: `Prisma.OperationRowWhereInput`, `Prisma.DateTimeFilter`, `Company`, `CompanyFinancialTotals`, `OperationRow`, `OrderStatus` ✓.

**The `OrderStatus` enum values in Prisma** — lowercase members → the Postgres enum values are lowercase ✓ the migration's `'pending'` etc. match ✓. The raw SQL string `'pending'` matches ✓.

**The `status` cast in the upsertOperationRow**: `${order.status}::"OrderStatus"` — the parameter is passed as a string; the cast handles it ✓.

**The `applyLatestEvent` comparison** — `(${event.occurredAt}, ${event.id}) > (latest_event_at, latest_event_id)` — row comparison of (timestamptz, uuid) ✓. But the parameter's type inference: `$1` inside a row-constructor comparison with the column (timestamptz, uuid) — Postgres infers the parameter types from the comparison ✓ (a row expression with unknown-typed elements resolves each element to the corresponding column type).

**The re-derivation INSERT ... SELECT with the enum** — `o.status` is already enum-typed ✓.

**`$executeRaw` return value** — for INSERT/UPDATE/DELETE it returns the row count as `bigint` → `Number(affected)` ✓.

**The `findDriftedOrderIds` and `findTotalsDriftedCompanyIds`** return arrays ✓.

Now, one more consideration on **the test for "the dashboard reads only the projection"**: I create a raw source order and assert it's absent. But the re-derivation (if any runs in another file's drift) would add it — with serial files + the cleanup delete, it's fine. Within orders.spec, no re-derivation runs. ✓

**The `windowAroundNow`** for the re-derivation: `from = now - 5min`, `to = now + 5min`. The seed's created_at is now ✓ within the window. But the orders from other files (orders.spec, concurrency.spec) are also created within the last few minutes → the re-derivation rebuilds their rows too (idempotent, consistent) → `rowsRebuilt >= 3` ✓ (I use `>=`).

**The `snapshotOperationRows`** — I map to a stable shape for `toEqual` comparison across re-derives. The `updatedAt` — the re-derivation sets `updated_at` from the source's `o.updated_at` (stable) ✓. The `createdAt` from `o.created_at` (stable) ✓. So two consecutive re-derives → identical snapshots ✓ (no writes in between).

Wait — but the first re-derivation in the "re-derivation" test: the source orders were created directly (no hook) → their `updated_at` is the creation time (Prisma `@updatedAt` sets it on create too). The re-derivation copies `o.updated_at` ✓ stable. The second re-derivation: same source (no writes in between) → same `updated_at` ✓. So the snapshots are equal ✓.

But — a subtlety: between the first and second re-derivation, could another file's test (running in parallel) write to the same source orders? No — each file seeds its own company/orders. And I set `fileParallelism: false` → files are serial. Within a file, serial. So no interleaving. ✓

Actually, even with serial files, the `PrismaClient` connections: each file's `createTestApp` creates a new `PrismaService` (new client). Fine.

**The `PrismaService` in tests and the `onModuleInit`** — `moduleRef.init()` triggers `onModuleInit` → `$connect()` ✓. `close()` → `onModuleDestroy` → `$disconnect()` ✓.

Now, **the `@Cron` in the DriftRepairService when instantiated manually in the test** — the decorator already ran at class-definition (import) time, registering metadata on the class. But the scheduling only happens when Nest's `@nestjs/schedule` processes the provider during `init()`. Since I instantiate manually (not via DI), no scheduling ✓. And the test app's DI-provided DriftRepairService is overridden (stub) → not the real class → no scheduling ✓.

Wait — the override: `.overrideProvider(DriftRepairService).useValue({ run: ... })` — this replaces the provider, so the real DriftRepairService class is not instantiated by DI → its `@Cron` is not registered ✓.

Good.

Now, **the `ScheduleModule.forRoot()`** — needs `@nestjs/schedule` ✓ in deps.

Let me also double check: **`@nestjs/schedule` v4** requires `@nestjs/common` v10 ✓.

Now, **the `main.ts` logger config** — `NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] })` ✓.

I think the design is solid. Let me now also reconsider: **do I need a `workers` controller or a `companies` controller?** The task says "simulate the write path" — the write path is orders (create/approve/dispute/cancel/assign) + events (record). I don't need to create companies/workers via the API (the tests seed them directly). So no companies/workers controllers needed. Good — keeps scope tight.

But wait — the `OrdersService.create` validates company/worker existence via the repository. The tests seed companies/workers directly via Prisma. ✓

Now, one more: **the `EventService` is only used via the EventsController** (the `POST /orders/:orderId/events` endpoint). The `OrdersService` uses `EventRepository` directly (not the EventService) to record audit events. That's fine — the audit event recording is part of the order write path, and it goes through the repository + the projection hook, not the full EventService (which would double-record). Actually, should the audit event go through the EventService? The EventService also calls `projection.applyEvent`. If I use the EventService inside the OrdersService's transaction, I'd be nesting a transaction (the EventService calls `prisma.transaction` inside the outer transaction) — Prisma interactive transactions can't be nested that way (an inner `$transaction` inside an outer interactive tx would create a savepoint? Actually Prisma's `$transaction` inside an interactive transaction callback is not supported / would error or create a new tx). So I correctly use the `EventRepository.record` directly (which takes the `tx`) + the `projection.applyEvent` directly. ✓ Good.

Let me make sure the `EventRepository.record` signature accepts the `tx` and I call it with the `tx` from the outer transaction. Yes: `this.events.record({ ... }, tx)` ✓.

Now, **the `applyProjection` private method in OrdersService** calls `this.projection.applyOrderChange(tx, order)` then `this.events.record(..., tx)` then `this.projection.applyEvent(tx, event)` — all within the outer tx ✓.

Good.

Now let me also reconsider the **`dispute` transition logic**: `existing.status` could be 'pending' or 'approved' (I reject 'disputed'/'cancelled'). Then `transition(orderId, existing.status, 'disputed', tx)` — the `fromStatus` is the current status. If it's 'pending', fromStatus='pending'; if 'approved', fromStatus='approved'. The `transition` does `updateMany where { id, status: fromStatus }`. ✓. If it's changed concurrently (e.g. approved→cancelled between the find and the transition), the `updateMany` returns 0 → null → ConflictError ✓.

Good.

Now, the **`assignWorker`** doesn't change status → the `applyOrderChange` sees `previous.status === order.status` → no totals delta, just re-syncs the row (worker name) ✓.

Now, one concern: **`applyOrderChange` reads `previous` before the `upsertOperationRow`**. For a new order, `previous` is null → after the upsert, the row exists; then we apply a totals delta with `fromStatus: null` → upsert the totals row (create or increment). ✓. For an existing order with a status change, `previous.status` is the old status → delta from old to new ✓.

But wait — there's a subtle issue: when I call `upsertOperationRow` first (which sets the row's status to the new status), then I read `previous`… no, I read `previous` BEFORE the upsert. Let me re-check the order in `applyOrderChange`:

```ts
const previous = await this.projection.findOperationRow(tx, order.id);
await this.projection.upsertOperationRow(tx, {...});
if (previous) { ... } else { ... }
```

Yes, `previous` is read before the upsert ✓. Good.

Now, the **totals delta when `previous` exists and status changed**: `fromStatus: previous.status`, `toStatus: order.status`. The `applyTotalsDelta` decrements `fromStatus` and increments `toStatus`. ✓.

Edge: what if `previous` exists but the order's `companyId` changed? I don't support company changes (no such endpoint), so ignore.

Now, let me finalize.

Actually, I realize I should double-check the **Prisma `upsert` with `create` using a computed-key cast**. The `create` input type is `CompanyFinancialTotalsCreateInput` which requires `companyId` and optional the rest. I do:

```ts
const create = { companyId: delta.companyId, updatedAt: new Date() } as CompanyFinancialTotalsCreateInput;
(create as Record<string, unknown>)[to.amount] = delta.amountCents;
(create as Record<string, unknown>)[to.count] = 1;
```

This compiles (the cast). At runtime, the object has `companyId`, `updatedAt`, and the amount/count keys. Prisma will send them. ✓.

Similarly for `update` with `CompanyFinancialTotalsUpdateInput` ✓.

Good.

Now, one more: **the `upsertOperationRow` uses `tx.$executeRaw` with a tagged template**. The `order.status` is passed as a parameter with the `::"OrderStatus"` cast. But in a tagged template, `${order.status}` becomes a parameter `$3`, and the template literal has `$3::"OrderStatus"`? No — the Prisma tagged template converts `${expr}` to a placeholder, and the surrounding literal text is kept. So the SQL is `VALUES ($1, $2, $3::"OrderStatus", (SELECT ...), $5, $6, $7, $8)`. Wait, the cast is part of the literal text after the placeholder. Let me write it carefully:

```ts
await tx.$executeRaw`
  INSERT INTO operation_rows (
    payment_order_id, company_id, status, worker_name,
    amount_cents, currency, created_at, updated_at
  )
  VALUES (
    ${order.paymentOrderId}, ${order.companyId}, ${order.status}::"OrderStatus",
    (SELECT name FROM workers WHERE id = ${order.workerId}),
    ${order.amountCents}, ${order.currency}, ${order.createdAt}, ${order.updatedAt}
  )
  ...
`;
```

The tagged template: `${order.status}::"OrderStatus"` — the `::"OrderStatus"` is literal text immediately after the placeholder. Prisma produces `$3::"OrderStatus"`. ✓. The parameter `$3` is the string 'pending'/'approved' etc., cast to the enum type. ✓.

Good.

Now, I'm confident. Let me write out all the files.

Actually, let me reconsider the **`Db` type union and the `$executeRaw`/`$queryRaw` availability**. `Prisma.TransactionClient` has `$executeRaw` and `$queryRaw` ✓. `PrismaClient` has them ✓. The union type allows calling methods present on both ✓.

But the **tagged-template `$executeRaw\`...\``** on a union type — TS may complain that the union's call signatures don't match. Let me be safe and type the parameter as `Prisma.TransactionClient | PrismaClient` and cast internally, or just use `Prisma.TransactionClient` for the hook methods (which always run in a tx) and `PrismaClient | Prisma.TransactionClient` for the maintenance methods (which also run in a tx via `rederive`/`recomputeTotals`). Actually, all the raw-SQL methods are called with a `tx` (from `rederive`, `recomputeTotals`, `drift.run`). So I can type them all as `tx: Prisma.TransactionClient`. But `findOperationRow` is also called with a `tx`. And the dashboard reads use `this.prisma` (the `PrismaClient`) directly, not through a `tx`. So the raw-SQL methods only need `Prisma.TransactionClient`. Let me simplify: type all the projection-repository methods that take a `tx` as `tx: Prisma.TransactionClient`. This avoids the union-type call-signature issue.

But `rederiveWindow`, `recomputeTotals`, `findDriftedOrderIds`, `findTotalsDriftedCompanyIds` are called from `OperationsService.rederive` (with a `tx`) and `DriftRepairService.run` (with a `tx`). Both pass a `Prisma.TransactionClient` ✓. So typing them as `tx: Prisma.TransactionClient` is correct and simpler.

Let me update: `type Tx = Prisma.TransactionClient;` and use `tx: Tx` everywhere in `projection.repository.ts`. Drop the `Db` union. This is cleaner and avoids TS union-call issues with tagged templates.

Good.

Now, the **`operations.repository.ts`** uses `this.prisma` (a `PrismaClient`) for the dashboard reads — no `tx` needed (the dashboard is a read, not in a write tx). ✓.

Let me finalize the types in `projection.repository.ts`:

```ts
import { CompanyFinancialTotalsCreateInput, CompanyFinancialTotalsUpdateInput, OperationRow, OrderStatus, Prisma } from '@prisma/client';
type Tx = Prisma.TransactionClient;
```

And methods take `tx: Tx`.

The `findOperationRow` returns `OperationRow | null` via `tx.operationRow.findUnique` ✓.

Good.

Now, let me write everything out. This is a lot of files. Let me be systematic and produce them.

Let me also add a `README.md`? The task doesn't require it. DESIGN.md is required. I'll skip README to avoid scope creep (the convention says "Do not create a file it does not call for"). The deliverables list: projection tables + DDL + indexes (schema.prisma + migration.sql), maintenance hooks (projection.service.ts + the orders/events services), re-derivation routine (operations.service.ts rederive + projection.repository.ts), scheduled drift-repair job (drift-repair.service.ts), new dashboard query (operations.repository.ts + operations.controller.ts), tests (3 spec files), DESIGN.md. Plus the supporting files (package.json, tsconfig, prisma lock, src wiring, common, database, main, app.module). These are all "needed" for the solution to run. Good.

I will NOT create a README (not requested). I will create DESIGN.md (requested).

Let me now write the final files. I'll be careful with imports and the `.js` extensions for ESM NodeNext.

One more: **`main.ts`** — `import { AppModule } from './app.module.js';` ✓. `import 'reflect-metadata';` first.

**`app.module.ts`** — imports the feature modules + `ScheduleModule.forRoot()` + `DatabaseModule`.

Wait — does `AppModule` need to import `DatabaseModule`? The feature modules each import `DatabaseModule` themselves (per the convention, a provider used by another module is exported by its own module and imported by the other). So `DatabaseModule` is imported by each feature module, not necessarily by `AppModule`. But `AppModule` imports the feature modules. `DatabaseModule` is a shared module; each feature imports it. `AppModule` doesn't need to import it directly (the feature modules do). But it's harmless to import it in `AppModule` too. To follow the convention precisely, I'll have each feature module import `DatabaseModule` and `AppModule` import only the feature modules + `ScheduleModule`. Let me not import `DatabaseModule` in `AppModule` (the feature modules handle it). Actually, it doesn't matter; Nest dedupes modules. I'll import it in the feature modules only, to be clean.

Hmm, but `PrismaService` is provided by `DatabaseModule`. Each feature module that needs `PrismaService` imports `DatabaseModule`. `OperationsModule` needs `PrismaService` (for the `OperationsService` and `ProjectionRepository`) → imports `DatabaseModule`. `OrdersModule` needs `PrismaService` (for `OrdersService`, `OrdersRepository`) → imports `DatabaseModule`. `EventsModule` needs `PrismaService` → imports `DatabaseModule`. ✓.

`AppModule` imports `OperationsModule`, `OrdersModule`, `EventsModule`, `ScheduleModule.forRoot()`. ✓.

Now, the `DriftRepairService` is in `OperationsModule` and uses `@Cron` — needs `ScheduleModule.forRoot()` to be loaded somewhere (in `AppModule`) ✓.

Good.

Let me write it all now.

Let me reconsider the **`OperationsService.list`** — it returns `OperationListResult`. The controller returns it directly (JSON-serializable: items have Date fields → serialized to ISO strings by Nest's default JSON) ✓.

**`OperationsService.totals`** returns `FinancialTotalsDto` with Date `updatedAt` ✓.

Now, **Nest's default JSON serialization** uses `JSON.stringify` which serializes `Date` to ISO strings and `BigInt` to... throw! But I already converted the totals BigInts to numbers via `Number(...)`. The `OperationRow.amountCents` is a number (Int) ✓. So no BigInt in the response. ✓. Good — I must make sure no BigInt leaks to the response. The `totals` DTO uses `Number(row.xAmountCents)` ✓. The operation rows use `amountCents` (Int → number) ✓. Good.

Now, let me write the final answer.

Actually, I want to double-check the **`Prisma` import for `OperationRowWhereInput` and `DateTimeFilter`** — these are under the `Prisma` namespace: `Prisma.OperationRowWhereInput`, `Prisma.DateTimeFilter`. ✓.

Let me write `operations.repository.ts` with these.

Also, I need to make sure `OperationRow` is imported from `@prisma/client` for the return type.

Now, writing.

Let me also reconsider: the **`whereFor`** returns `Prisma.OperationRowWhereInput`. The `createdAt` filter: `Prisma.OperationRowWhereInput['createdAt']` is `DateTimeFilter | Date | undefined`. I build `{ gte?: Date, lt?: Date }` which matches `DateTimeFilter` ✓.

Good.

Let me write all the files now in the required format.

I'll produce them in a sensible order.

Let me make sure I include the `prisma/migrations/migration_lock.toml`.

Also, I should double check: the task says "prisma as the ORM". I'm using Prisma. ✓. "PostgreSQL". ✓. "NestJS". ✓. "TypeScript strict". ✓ (tsconfig strict). "Vitest for tests". ✓. "pnpm as package manager". I'll use pnpm in scripts (no lockfile needed). The package.json is standard; pnpm will work. ✓. "ESM, type module". ✓.

Good.

Now writing.

One more: the **`package.json` "type": "module"** and the scripts. For `start`, I use `node --import tsx src/main.ts` — tsx as a loader. Alternatively `tsx src/main.ts`. I'll use `tsx src/main.ts` for start and `tsx watch` for dev. Simpler. Let me use:
- `"start": "tsx src/main.ts"`
- `"start:dev": "tsx watch src/main.ts"`

Good.

Now, the `vitest.config.ts` — `fileParallelism: false`. Let me verify this is a valid Vitest 2 option. In Vitest 2, `fileParallelism` (boolean) controls parallel execution of test files. Yes, it exists in v2 (introduced to replace the deprecated `threads`/`singleThread`). Actually, I recall `fileParallelism` was added in Vitest 2.1? Let me be safe and use both a safe approach: I'll set `pool: 'forks'` and `poolOptions: { forks: { singleFork: true } }`? Hmm. Actually the simplest reliable way to serialize files across Vitest versions is `--sequence` or setting `fileParallelism: false`. Let me use `fileParallelism: false` and also note the version. To be safe, I'll pin vitest to `^2.1.0` which definitely has `fileParallelism`. Let me set `"vitest": "^2.1.1"`.

Actually, `fileParallelism` was added in Vitest 2.1.0. So `^2.1.1` is safe. Good.

Let me finalize the package.json versions:
- `@nestjs/common`: `^10.3.8`
- `@nestjs/core`: `^10.3.8`
- `@nestjs/platform-express`: `^10.3.8`
- `@nestjs/schedule`: `^4.1.0`
- `@nestjs/testing`: `^10.3.8` (dev)
- `@prisma/client`: `^5.16.1`
- `prisma`: `^5.16.1` (dev)
- `reflect-metadata`: `^0.2.2`
- `rxjs`: `^7.8.1`
- `typescript`: `^5.5.3` (dev)
- `tsx`: `^4.16.2` (dev)
- `vitest`: `^2.1.1` (dev)
- `@types/node`: `^20.14.9` (dev)
- `@types/express`: `^4.17.21` (dev)

Good.

Now writing the files.

Let me write the DESIGN.md to be "short" as requested. I'll keep it focused.

Final check on the format: each file is a level-3 heading with only the path, then one fenced block with only the content. I must not add prose outside. I'll begin with the first heading.

Let me write them all now.

I'll order: package.json, tsconfig.json, vitest.config.ts, prisma/schema.prisma, prisma/migrations/migration_lock.toml, prisma/migrations/20250601000000_init/migration.sql, src/main.ts, src/app.module.ts, src/common/errors.ts, src/common/errors.exception-filter.ts, src/common/order-status.ts, src/common/validation.ts, src/database/database.module.ts, src/database/prisma.service.ts, src/operations/projection.repository.ts, src/operations/projection.service.ts, src/operations/operations.repository.ts, src/operations/operations.service.ts, src/operations/drift-repair.service.ts, src/operations/operations.controller.ts, src/operations/operations.module.ts, src/orders/orders.repository.ts, src/orders/orders.service.ts, src/orders/orders.controller.ts, src/orders/orders.module.ts, src/events/events.repository.ts, src/events/events.service.ts, src/events/events.controller.ts, src/events/events.module.ts, test/helpers.ts, test/orders.spec.ts, test/concurrency.spec.ts, test/operations.spec.ts, DESIGN.md.

That's the full set. Let me write.

I need to make sure every file is complete and correct. Let me write carefully.

For the migration, I'll write the full DDL.

Let me write the schema.prisma in full.

Now, the `Prisma` client generator: `provider = "prisma-client-js"`. ✓.

Let me write.

I realize for the `rederiveWindow` SQL, the `SELECT` list must match the `INSERT` column list in order. Let me align:

INSERT columns: payment_order_id, company_id, status, worker_name, amount_cents, currency, latest_event_type, latest_event_at, latest_event_id, created_at, updated_at (11 columns).

SELECT: o.id, o.company_id, o.status, w.name, o.amount_cents, o.currency, le.event_type, le.occurred_at, le.id, o.created_at, o.updated_at (11) ✓.

Good.

For the `recomputeTotals` INSERT: columns company_id, pending_amount_cents, pending_count, approved_amount_cents, approved_count, disputed_amount_cents, disputed_count, cancelled_amount_cents, cancelled_count, updated_at (10). SELECT from agg: company_id, pending_amount_cents, pending_count, approved_amount_cents, approved_count, disputed_amount_cents, disputed_count, cancelled_amount_cents, cancelled_count, now() (10) ✓.

Good.

Now writing everything.

Let me also make sure the `findDriftedOrderIds` `latest_event` CTE selects `id AS event_id` and I compare `r.latest_event_id IS DISTINCT FROM le.event_id`. ✓.

Now, writing the final answer.

I'll be careful to not include any prose outside the file blocks.

Let me write.
```

## reply

### package.json
```json
{
  "name": "marketplace-backoffice",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "postinstall": "prisma generate",
    "build": "tsc -p tsconfig.json",
    "start": "tsx src/main.ts",
    "start:dev": "tsx watch src/main.ts",
    "prisma:generate": "prisma generate",
    "migrate": "prisma migrate deploy",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.8",
    "@nestjs/core": "^10.3.8",
    "@nestjs/platform-express": "^10.3.8",
    "@nestjs/schedule": "^4.1.0",
    "@prisma/client": "^5.16.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.3.8",
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.9",
    "prisma": "^5.16.1",
    "tsx": "^4.16.2",
    "typescript": "^5.5.3",
    "vitest": "^2.1.1"
  }
}
```

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "useDefineForClassFields": false,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

### vitest.config.ts
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    // Files share one Postgres database; run them serially so a drift-repair
    // window in one file can never observe another file's source rows.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
```

### prisma/schema.prisma
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum OrderStatus {
  pending
  approved
  disputed
  cancelled
}

model Company {
  id        String   @id @default(uuid()) @db.Uuid
  name      String
  createdAt DateTime @default(now()) @map("created_at")

  orders PaymentOrder[]
  workers Worker[]
  totals CompanyFinancialTotals?

  @@map("companies")
}

model Worker {
  id        String   @id @default(uuid()) @db.Uuid
  name      String
  companyId String   @map("company_id") @db.Uuid
  createdAt DateTime @default(now()) @map("created_at")

  company Company      @relation(fields: [companyId], references: [id], onDelete: Restrict)
  orders  PaymentOrder[]

  @@index([companyId])
  @@map("workers")
}

model PaymentOrder {
  id          String      @id @default(uuid()) @db.Uuid
  companyId   String      @map("company_id") @db.Uuid
  workerId    String      @map("worker_id") @db.Uuid
  status      OrderStatus @default(pending)
  amountCents Int         @map("amount_cents")
  currency    String      @db.Char(3)
  createdAt   DateTime    @default(now()) @map("created_at")
  updatedAt   DateTime    @default(now()) @updatedAt @map("updated_at")

  company Company @relation(fields: [companyId], references: [id], onDelete: Restrict)
  worker  Worker  @relation(fields: [workerId], references: [id], onDelete: Restrict)
  events  Event[]

  @@index([companyId, status])
  @@index([createdAt])
  @@map("payment_orders")
}

model Event {
  id             String   @id @default(uuid()) @db.Uuid
  paymentOrderId String   @map("payment_order_id") @db.Uuid
  eventType      String   @map("event_type")
  note           String?
  occurredAt     DateTime @map("occurred_at")
  createdAt      DateTime @default(now()) @map("created_at")

  paymentOrder PaymentOrder @relation(fields: [paymentOrderId], references: [id], onDelete: Cascade)

  @@index([paymentOrderId, occurredAt(sort: SortOrder.DESC), id(sort: SortOrder.DESC)])
  @@map("events")
}

// Read model: one row per payment order, shaped like the operations dashboard query.
model OperationRow {
  paymentOrderId  String    @id @map("payment_order_id") @db.Uuid
  companyId       String    @map("company_id") @db.Uuid
  status          OrderStatus
  workerName      String    @map("worker_name")
  amountCents     Int       @map("amount_cents")
  currency        String    @db.Char(3)
  latestEventType String?   @map("latest_event_type")
  latestEventAt   DateTime? @map("latest_event_at")
  latestEventId   String?   @map("latest_event_id") @db.Uuid
  createdAt       DateTime  @map("created_at")
  updatedAt       DateTime  @map("updated_at")

  // Matches the hot read: filter (company, status), sort (recency, id tiebreak).
  // The physical index in the migration adds INCLUDE columns so the query is
  // answered from the index alone (Prisma cannot express INCLUDE).
  @@index(
    [companyId, status, updatedAt(sort: SortOrder.DESC), paymentOrderId(sort: SortOrder.DESC)],
    map: "operation_rows_company_status_updated_idx"
  )
  @@map("operation_rows")
}

// Read model: exact per-company financial totals, maintained by atomic in-place deltas.
model CompanyFinancialTotals {
  companyId            String   @id @map("company_id") @db.Uuid
  pendingAmountCents   BigInt   @default(0) @map("pending_amount_cents")
  pendingCount         Int      @default(0) @map("pending_count")
  approvedAmountCents  BigInt   @default(0) @map("approved_amount_cents")
  approvedCount        Int      @default(0) @map("approved_count")
  disputedAmountCents  BigInt   @default(0) @map("disputed_amount_cents")
  disputedCount        Int      @default(0) @map("disputed_count")
  cancelledAmountCents BigInt   @default(0) @map("cancelled_amount_cents")
  cancelledCount       Int      @default(0) @map("cancelled_count")
  updatedAt            DateTime @default(now()) @map("updated_at")

  company Company @relation(fields: [companyId], references: [id], onDelete: Cascade)

  @@map("company_financial_totals")
}
```

### prisma/migrations/migration_lock.toml
```toml
# Please do not edit this file manually
# It should be added in your version-control system (e.g., git)
provider = "postgresql"
```

### prisma/migrations/20250601000000_init/migration.sql
```sql
-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('pending', 'approved', 'disputed', 'cancelled');

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "company_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_orders" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'pending',
    "amount_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "payment_order_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "note" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- Read model: one row per payment order, shaped like the operations dashboard query.
CREATE TABLE "operation_rows" (
    "payment_order_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "worker_name" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "latest_event_type" TEXT,
    "latest_event_at" TIMESTAMPTZ(6),
    "latest_event_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "operation_rows_pkey" PRIMARY KEY ("payment_order_id")
);

-- Read model: exact per-company financial totals, maintained by atomic in-place deltas.
CREATE TABLE "company_financial_totals" (
    "company_id" UUID NOT NULL,
    "pending_amount_cents" BIGINT NOT NULL DEFAULT 0,
    "pending_count" INTEGER NOT NULL DEFAULT 0,
    "approved_amount_cents" BIGINT NOT NULL DEFAULT 0,
    "approved_count" INTEGER NOT NULL DEFAULT 0,
    "disputed_amount_cents" BIGINT NOT NULL DEFAULT 0,
    "disputed_count" INTEGER NOT NULL DEFAULT 0,
    "cancelled_amount_cents" BIGINT NOT NULL DEFAULT 0,
    "cancelled_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_financial_totals_pkey" PRIMARY KEY ("company_id")
);

-- CreateIndex
CREATE INDEX "workers_company_id_idx" ON "workers"("company_id");
CREATE INDEX "payment_orders_company_id_status_idx" ON "payment_orders"("company_id", "status");
CREATE INDEX "payment_orders_created_at_idx" ON "payment_orders"("created_at");
CREATE INDEX "events_payment_order_id_occurred_at_id_idx" ON "events"("payment_order_id", "occurred_at" DESC, "id" DESC);

-- Covering index for the hot read: seek on (company_id, status), walk in sort order
-- (updated_at DESC, payment_order_id DESC), and answer the whole row from INCLUDE —
-- the dashboard never touches the heap or the source tables.
CREATE INDEX "operation_rows_company_status_updated_idx"
    ON "operation_rows" ("company_id", "status", "updated_at" DESC, "payment_order_id" DESC)
    INCLUDE ("worker_name", "amount_cents", "currency", "latest_event_type", "latest_event_at", "latest_event_id", "created_at");

-- AddForeignKey
ALTER TABLE "workers" ADD CONSTRAINT "workers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "events" ADD CONSTRAINT "events_payment_order_id_fkey" FOREIGN KEY ("payment_order_id") REFERENCES "payment_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operation_rows" ADD CONSTRAINT "operation_rows_payment_order_id_fkey" FOREIGN KEY ("payment_order_id") REFERENCES "payment_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "operation_rows" ADD CONSTRAINT "operation_rows_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "company_financial_totals" ADD CONSTRAINT "company_financial_totals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

### src/main.ts
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ErrorEnvelopeFilter } from './common/errors.exception-filter.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });
  app.useGlobalFilters(new ErrorEnvelopeFilter());
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
```

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { EventsModule } from './events/events.module.js';
import { OperationsModule } from './operations/operations.module.js';
import { OrdersModule } from './orders/orders.module.js';

@Module({
  imports: [ScheduleModule.forRoot(), OperationsModule, OrdersModule, EventsModule],
})
export class AppModule {}
```

### src/common/errors.ts
```ts
export type ErrorCode = 'resource_not_found' | 'validation_failed' | 'conflict' | 'internal_error';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ResourceNotFoundError extends AppError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(404, 'resource_not_found', message, details);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(400, 'validation_failed', message, details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(409, 'conflict', message, details);
  }
}
```

### src/common/errors.exception-filter.ts
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { AppError, ErrorCode } from './errors.js';

interface ErrorEnvelope {
  error: { code: ErrorCode; message: string; details: Record<string, unknown> };
}

@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorEnvelopeFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppError) {
      this.send(response, exception.status, exception.code, exception.message, exception.details);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : (((body as { message?: unknown }).message) ?? exception.message);
      this.send(response, status, this.codeForStatus(status), String(message), {});
      return;
    }

    this.logger.error(`Unhandled exception: ${exception instanceof Error ? exception.stack : String(exception)}`);
    this.send(response, HttpStatus.INTERNAL_SERVER_ERROR, 'internal_error', 'Internal server error', {});
  }

  private codeForStatus(status: number): ErrorCode {
    if (status === 404) return 'resource_not_found';
    if (status === 409) return 'conflict';
    if (status >= 400 && status < 500) return 'validation_failed';
    return 'internal_error';
  }

  private send(
    response: Response,
    status: number,
    code: ErrorCode,
    message: string,
    details: Record<string, unknown>,
  ): void {
    const envelope: ErrorEnvelope = { error: { code, message, details } };
    response.status(status).json(envelope);
  }
}
```

### src/common/order-status.ts
```ts
import type { OrderStatus } from '@prisma/client';

// Must mirror the `OrderStatus` enum in prisma/schema.prisma.
export const ORDER_STATUSES = ['pending', 'approved', 'disputed', 'cancelled'] as const satisfies readonly OrderStatus[];
```

### src/common/validation.ts
```ts
import { OrderStatus } from '@prisma/client';
import { ValidationError } from './errors.js';
import { ORDER_STATUSES } from './order-status.js';

export type ValidationErrors = Record<string, unknown>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function finishValidation(errors: ValidationErrors): void {
  if (Object.keys(errors).length > 0) {
    throw new ValidationError('Invalid request parameters', errors);
  }
}

export function parseUuid(value: unknown, field: string, errors: ValidationErrors): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    errors[field] = 'must be a valid UUID';
    return '';
  }
  return value;
}

export function parseOptionalUuid(value: unknown, field: string, errors: ValidationErrors): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const parsed = parseUuid(value, field, errors);
  return errors[field] !== undefined ? undefined : parsed;
}

export function requireUuid(value: string, field: string): void {
  if (!UUID_RE.test(value)) {
    throw new ValidationError('Invalid request parameters', { [field]: 'must be a valid UUID' });
  }
}

export function parseStatus(value: unknown, field: string, errors: ValidationErrors): OrderStatus | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string' || !(ORDER_STATUSES as readonly string[]).includes(value)) {
    errors[field] = `must be one of: ${ORDER_STATUSES.join(', ')}`;
    return undefined;
  }
  return value as OrderStatus;
}

export function parseOptionalIsoDate(value: unknown, field: string, errors: ValidationErrors): Date | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return parseIsoDate(value, field, errors);
}

export function parseRequiredIsoDate(value: unknown, field: string, errors: ValidationErrors): Date | undefined {
  if (value === undefined || value === null || value === '') {
    errors[field] = 'is required';
    return undefined;
  }
  return parseIsoDate(value, field, errors);
}

function parseIsoDate(value: unknown, field: string, errors: ValidationErrors): Date | undefined {
  if (typeof value !== 'string') {
    errors[field] = 'must be an ISO-8601 date string';
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    errors[field] = 'must be a valid ISO-8601 date';
    return undefined;
  }
  return date;
}

export function parsePositiveInt(value: unknown, field: string, errors: ValidationErrors, max?: number): number | undefined {
  const n = toInt(value);
  if (!Number.isInteger(n) || n < 1 || (max !== undefined && n > max)) {
    errors[field] = max !== undefined ? `must be an integer between 1 and ${max}` : 'must be a positive integer';
    return undefined;
  }
  return n;
}

export function parseNonNegativeInt(value: unknown, field: string, errors: ValidationErrors): number | undefined {
  const n = toInt(value);
  if (!Number.isInteger(n) || n < 0) {
    errors[field] = 'must be an integer >= 0';
    return undefined;
  }
  return n;
}

function toInt(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return Number(value);
  }
  return NaN;
}

export function parseCurrency(value: unknown, field: string, errors: ValidationErrors): string | undefined {
  if (typeof value !== 'string' || !/^[A-Za-z]{3}$/.test(value)) {
    errors[field] = 'must be a 3-letter ISO-4217 currency code';
    return undefined;
  }
  return value.toUpperCase();
}
```

### src/database/database.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
```

### src/database/prisma.service.ts
```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Runs `fn` inside a single interactive Postgres transaction.
   *
   * // ASSUMPTION: the layering rules give business services zero Prisma client calls, so transaction
   * coordination lives on this infrastructure class. Feature services hand the returned transaction
   * handle to repositories only, which treat it as an opaque token.
   */
  transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.$transaction(fn);
  }
}
```

### src/operations/projection.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import {
  CompanyFinancialTotalsCreateInput,
  CompanyFinancialTotalsUpdateInput,
  OperationRow,
  OrderStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';

export interface OrderRowInput {
  paymentOrderId: string;
  companyId: string;
  workerId: string;
  status: OrderStatus;
  amountCents: number;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface LatestEventInput {
  id: string;
  paymentOrderId: string;
  eventType: string;
  occurredAt: Date;
}

export interface TotalsDelta {
  companyId: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  amountCents: number;
}

type Tx = Prisma.TransactionClient;

// Fixed status → totals-column mapping. The only place projection SQL is assembled;
// identifiers come from this table, values are always bound parameters.
const TOTALS_FIELDS: Record<OrderStatus, { amount: string; count: string }> = {
  pending: { amount: 'pendingAmountCents', count: 'pendingCount' },
  approved: { amount: 'approvedAmountCents', count: 'approvedCount' },
  disputed: { amount: 'disputedAmountCents', count: 'disputedCount' },
  cancelled: { amount: 'cancelledAmountCents', count: 'cancelledCount' },
};

/**
 * The only layer that writes the read-model tables. Called exclusively from
 * maintenance hooks that already run inside the writer's transaction.
 */
@Injectable()
export class ProjectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Hook: upsert the order's operation row. The worker name is re-read from the
   * source inside the statement so the row is always a faithful denormalization. */
  async upsertOperationRow(tx: Tx, order: OrderRowInput): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO operation_rows (
        payment_order_id, company_id, status, worker_name,
        amount_cents, currency, created_at, updated_at
      )
      VALUES (
        ${order.paymentOrderId}, ${order.companyId}, ${order.status}::"OrderStatus",
        (SELECT name FROM workers WHERE id = ${order.workerId}),
        ${order.amountCents}, ${order.currency}, ${order.createdAt}, ${order.updatedAt}
      )
      ON CONFLICT (payment_order_id) DO UPDATE SET
        company_id   = excluded.company_id,
        status       = excluded.status,
        worker_name  = excluded.worker_name,
        amount_cents = excluded.amount_cents,
        currency     = excluded.currency,
        updated_at   = excluded.updated_at
    `;
  }

  /**
   * Hook: apply an exact in-place delta to the company's totals row.
   *
   * The row is never read-modify-written in app code: the create branch inserts
   * the delta, the update branch uses atomic increment/decrement, so concurrent
   * writers to the same company serialize on the row lock and no update is lost.
   */
  async applyTotalsDelta(tx: Tx, delta: TotalsDelta): Promise<void> {
    const to = TOTALS_FIELDS[delta.toStatus];

    const create = { companyId: delta.companyId, updatedAt: new Date() } as CompanyFinancialTotalsCreateInput;
    (create as Record<string, unknown>)[to.amount] = delta.amountCents;
    (create as Record<string, unknown>)[to.count] = 1;

    const update = { updatedAt: new Date() } as CompanyFinancialTotalsUpdateInput;
    (update as Record<string, unknown>)[to.amount] = { increment: delta.amountCents };
    (update as Record<string, unknown>)[to.count] = { increment: 1 };
    if (delta.fromStatus && delta.fromStatus !== delta.toStatus) {
      const from = TOTALS_FIELDS[delta.fromStatus];
      (update as Record<string, unknown>)[from.amount] = { decrement: delta.amountCents };
      (update as Record<string, unknown>)[from.count] = { decrement: 1 };
    }

    await tx.companyFinancialTotals.upsert({ where: { companyId: delta.companyId }, create, update });
  }

  /** Hook: set the order's latest event, but only if the new event is strictly newer
   * (occurred_at, id) than the current one. Never touches the row's updated_at. */
  async applyLatestEvent(tx: Tx, event: LatestEventInput): Promise<void> {
    await tx.$executeRaw`
      UPDATE operation_rows
      SET latest_event_type = ${event.eventType},
          latest_event_at   = ${event.occurredAt},
          latest_event_id   = ${event.id}
      WHERE payment_order_id = ${event.paymentOrderId}
        AND (latest_event_id IS NULL OR (${event.occurredAt}, ${event.id}) > (latest_event_at, latest_event_id))
    `;
  }

  async findOperationRow(tx: Tx, paymentOrderId: string): Promise<OperationRow | null> {
    return tx.operationRow.findUnique({ where: { paymentOrderId } });
  }

  /**
   * Re-derivation: rebuild operation_rows from the source tables for orders created in [from, to).
   * Set-based and idempotent — the result depends only on the current source state, so running it
   * twice leaves the same result; running it while live is safe because writes that commit after
   * the snapshot are re-applied by the hooks. Returns the number of rows written.
   */
  async rederiveWindow(tx: Tx, from: Date, to: Date): Promise<number> {
    const affected = await tx.$executeRaw`
      WITH latest_event AS (
        SELECT DISTINCT ON (payment_order_id)
               payment_order_id, event_type, occurred_at, id
        FROM events
        WHERE occurred_at >= ${from}
        ORDER BY payment_order_id, occurred_at DESC, id DESC
      )
      INSERT INTO operation_rows (
        payment_order_id, company_id, status, worker_name,
        amount_cents, currency,
        latest_event_type, latest_event_at, latest_event_id,
        created_at, updated_at
      )
      SELECT
             o.id, o.company_id, o.status, w.name,
             o.amount_cents, o.currency,
             le.event_type, le.occurred_at, le.id,
             o.created_at, o.updated_at
      FROM payment_orders o
      JOIN workers w ON w.id = o.worker_id
      LEFT JOIN latest_event le ON le.payment_order_id = o.id
      WHERE o.created_at >= ${from} AND o.created_at < ${to}
      ON CONFLICT (payment_order_id) DO UPDATE SET
        company_id        = excluded.company_id,
        status            = excluded.status,
        worker_name       = excluded.worker_name,
        amount_cents      = excluded.amount_cents,
        currency          = excluded.currency,
        latest_event_type = excluded.latest_event_type,
        latest_event_at   = excluded.latest_event_at,
        latest_event_id   = excluded.latest_event_id,
        created_at        = excluded.created_at,
        updated_at        = excluded.updated_at
    `;
    return Number(affected);
  }

  /**
   * Recompute company_financial_totals from scratch, for every company with orders.
   * Idempotent: the result depends only on the current source state. Totals are global
   * (not windowable), so they are always rebuilt as a whole.
   */
  async recomputeTotals(tx: Tx): Promise<void> {
    await tx.$executeRaw`
      WITH agg AS (
        SELECT company_id,
               COALESCE(SUM(amount_cents) FILTER (WHERE status = 'pending'), 0)   AS pending_amount_cents,
               COUNT(*) FILTER (WHERE status = 'pending')                         AS pending_count,
               COALESCE(SUM(amount_cents) FILTER (WHERE status = 'approved'), 0)  AS approved_amount_cents,
               COUNT(*) FILTER (WHERE status = 'approved')                        AS approved_count,
               COALESCE(SUM(amount_cents) FILTER (WHERE status = 'disputed'), 0)  AS disputed_amount_cents,
               COUNT(*) FILTER (WHERE status = 'disputed')                        AS disputed_count,
               COALESCE(SUM(amount_cents) FILTER (WHERE status = 'cancelled'), 0) AS cancelled_amount_cents,
               COUNT(*) FILTER (WHERE status = 'cancelled')                       AS cancelled_count
        FROM payment_orders
        GROUP BY company_id
      )
      INSERT INTO company_financial_totals (
        company_id,
        pending_amount_cents, pending_count,
        approved_amount_cents, approved_count,
        disputed_amount_cents, disputed_count,
        cancelled_amount_cents, cancelled_count,
        updated_at
      )
      SELECT company_id,
             pending_amount_cents, pending_count,
             approved_amount_cents, approved_count,
             disputed_amount_cents, disputed_count,
             cancelled_amount_cents, cancelled_count,
             now()
      FROM agg
      ON CONFLICT (company_id) DO UPDATE SET
        pending_amount_cents   = excluded.pending_amount_cents,
        pending_count          = excluded.pending_count,
        approved_amount_cents  = excluded.approved_amount_cents,
        approved_count         = excluded.approved_count,
        disputed_amount_cents  = excluded.disputed_amount_cents,
        disputed_count         = excluded.disputed_count,
        cancelled_amount_cents = excluded.cancelled_amount_cents,
        cancelled_count        = excluded.cancelled_count,
        updated_at             = excluded.updated_at
    `;
    await tx.$executeRaw`
      DELETE FROM company_financial_totals cft
      WHERE NOT EXISTS (SELECT 1 FROM payment_orders po WHERE po.company_id = cft.company_id)
    `;
  }

  /** Orders created in [from, to) whose operation row is missing or disagrees with the source. */
  async findDriftedOrderIds(tx: Tx, from: Date, to: Date): Promise<string[]> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      WITH latest_event AS (
        SELECT DISTINCT ON (payment_order_id)
               payment_order_id, id AS event_id
        FROM events
        WHERE occurred_at >= ${from}
        ORDER BY payment_order_id, occurred_at DESC, id DESC
      )
      SELECT o.id
      FROM payment_orders o
      JOIN workers w ON w.id = o.worker_id
      LEFT JOIN operation_rows r ON r.payment_order_id = o.id
      LEFT JOIN latest_event le ON le.payment_order_id = o.id
      WHERE o.created_at >= ${from} AND o.created_at < ${to}
        AND (
          r.id IS NULL
          OR r.status IS DISTINCT FROM o.status
          OR r.company_id IS DISTINCT FROM o.company_id
          OR r.worker_name IS DISTINCT FROM w.name
          OR r.amount_cents IS DISTINCT FROM o.amount_cents
          OR r.currency IS DISTINCT FROM o.currency
          OR r.latest_event_id IS DISTINCT FROM le.event_id
        )
    `;
    return rows.map((row) => row.id);
  }

  /**
   * Companies whose totals row is missing, left for a company with no orders, or disagrees
   * with the source aggregate. Scoped to companies with activity in [from, to).
   */
  async findTotalsDriftedCompanyIds(tx: Tx, from: Date, to: Date): Promise<string[]> {
    const rows = await tx.$queryRaw<{ company_id: string }[]>`
      SELECT company_id
      FROM (
        SELECT DISTINCT po.company_id
        FROM payment_orders po
        WHERE po.created_at >= ${from} OR po.updated_at >= ${from}
      ) active
      WHERE active.company_id NOT IN (SELECT company_id FROM company_financial_totals)
         OR EXISTS (
           SELECT 1
           FROM company_financial_totals t
           WHERE t.company_id = active.company_id
             AND NOT EXISTS (
               SELECT 1
               FROM (
                 SELECT po2.company_id,
                        COALESCE(SUM(po2.amount_cents) FILTER (WHERE po2.status = 'pending'), 0)   AS pending_amount,
                        COUNT(*) FILTER (WHERE po2.status = 'pending')                             AS pending_count,
                        COALESCE(SUM(po2.amount_cents) FILTER (WHERE po2.status = 'approved'), 0)  AS approved_amount,
                        COUNT(*) FILTER (WHERE po2.status = 'approved')                            AS approved_count,
                        COALESCE(SUM(po2.amount_cents) FILTER (WHERE po2.status = 'disputed'), 0)  AS disputed_amount,
                        COUNT(*) FILTER (WHERE po2.status = 'disputed')                            AS disputed_count,
                        COALESCE(SUM(po2.amount_cents) FILTER (WHERE po2.status = 'cancelled'), 0) AS cancelled_amount,
                        COUNT(*) FILTER (WHERE po2.status = 'cancelled')                           AS cancelled_count
                 FROM payment_orders po2
                 WHERE po2.company_id = active.company_id
                 GROUP BY po2.company_id
               ) s
               WHERE s.pending_amount   IS DISTINCT FROM t.pending_amount_cents
                  OR s.pending_count    IS DISTINCT FROM t.pending_count
                  OR s.approved_amount  IS DISTINCT FROM t.approved_amount_cents
                  OR s.approved_count   IS DISTINCT FROM t.approved_count
                  OR s.disputed_amount  IS DISTINCT FROM t.disputed_amount_cents
                  OR s.disputed_count   IS DISTINCT FROM t.disputed_count
                  OR s.cancelled_amount IS DISTINCT FROM t.cancelled_amount_cents
                  OR s.cancelled_count  IS DISTINCT FROM t.cancelled_count
             )
         )
      UNION
      SELECT t.company_id
      FROM company_financial_totals t
      WHERE NOT EXISTS (SELECT 1 FROM payment_orders po WHERE po.company_id = t.company_id)
    `;
    return rows.map((row) => row.company_id);
  }
}
```

### src/operations/projection.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { Event, OrderStatus, PaymentOrder, Prisma } from '@prisma/client';
import { ProjectionRepository } from './projection.repository.js';

type Tx = Prisma.TransactionClient;

export type OrderChange = Pick<
  PaymentOrder,
  'id' | 'companyId' | 'workerId' | 'status' | 'amountCents' | 'currency' | 'createdAt' | 'updatedAt'
>;

export type EventChange = Pick<Event, 'id' | 'paymentOrderId' | 'eventType' | 'occurredAt'>;

/**
 * Read-model maintenance hooks.
 *
 * Write services call these inside the writer's own transaction, which gives both
 * hard guarantees at once:
 *  - read-your-own-writes: the projection sees the writer's snapshot, so the very
 *    next read (same or another connection) observes the change, with no delay;
 *  - rollback safety: if the write rolls back, the projection never saw it.
 */
@Injectable()
export class ProjectionService {
  constructor(private readonly projection: ProjectionRepository) {}

  async applyOrderChange(tx: Tx, order: OrderChange): Promise<void> {
    const previous = await this.projection.findOperationRow(tx, order.id);

    await this.projection.upsertOperationRow(tx, {
      paymentOrderId: order.id,
      companyId: order.companyId,
      workerId: order.workerId,
      status: order.status,
      amountCents: order.amountCents,
      currency: order.currency,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    });

    if (previous) {
      if (previous.status !== order.status) {
        await this.projection.applyTotalsDelta(tx, {
          companyId: order.companyId,
          fromStatus: previous.status,
          toStatus: order.status,
          amountCents: order.amountCents,
        });
      }
      // Status unchanged (e.g. worker reassignment): row re-synced, totals untouched.
    } else {
      // New order: add to its current bucket; there is nothing to move from.
      await this.projection.applyTotalsDelta(tx, {
        companyId: order.companyId,
        fromStatus: null,
        toStatus: order.status,
        amountCents: order.amountCents,
      });
    }
  }

  async applyEvent(tx: Tx, event: EventChange): Promise<void> {
    await this.projection.applyLatestEvent(tx, {
      id: event.id,
      paymentOrderId: event.paymentOrderId,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
    });
  }
}
```

### src/operations/operations.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { Company, CompanyFinancialTotals, OperationRow, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';

export interface OperationQuery {
  companyId?: string;
  status?: OrderStatus;
  from?: Date;
  to?: Date;
  skip?: number;
  take?: number;
}

@Injectable()
export class OperationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async company(id: string): Promise<Company | null> {
    return this.prisma.company.findUnique({ where: { id } });
  }

  async getTotals(companyId: string): Promise<CompanyFinancialTotals | null> {
    return this.prisma.companyFinancialTotals.findUnique({ where: { companyId } });
  }

  /**
   * The dashboard read path: touches operation_rows only — no join back to the
   * source tables. Filter on (company, status), ordered by (updated_at DESC, id DESC)
   * to match the covering index, offset-paginated.
   */
  listOperations(query: OperationQuery): Promise<OperationRow[]> {
    return this.prisma.operationRow.findMany({
      where: this.whereFor(query),
      orderBy: [{ updatedAt: 'desc' }, { paymentOrderId: 'desc' }],
      skip: query.skip,
      take: query.take,
    });
  }

  countOperations(query: OperationQuery): Promise<number> {
    return this.prisma.operationRow.count({ where: this.whereFor(query) });
  }

  private whereFor(query: OperationQuery): Prisma.OperationRowWhereInput {
    const createdAt: Prisma.DateTimeFilter = {};
    if (query.from) createdAt.gte = query.from;
    if (query.to) createdAt.lt = query.to;
    return {
      ...(query.companyId ? { companyId: query.companyId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to ? { createdAt } : {}),
    };
  }
}
```

### src/operations/operations.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { CompanyFinancialTotals, OperationRow, OrderStatus } from '@prisma/client';
import { ResourceNotFoundError, ValidationError } from '../common/errors.js';
import { PrismaService } from '../database/prisma.service.js';
import { ProjectionRepository } from './projection.repository.js';
import { OperationsRepository } from './operations.repository.js';

export interface OperationListFilter {
  companyId?: string;
  status?: OrderStatus;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

export interface OperationDto {
  paymentOrderId: string;
  companyId: string;
  status: OrderStatus;
  workerName: string;
  amountCents: number;
  currency: string;
  latestEventType: string | null;
  latestEventAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OperationListResult {
  items: OperationDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface FinancialTotalsDto {
  companyId: string;
  pending: { amountCents: number; count: number };
  approved: { amountCents: number; count: number };
  disputed: { amountCents: number; count: number };
  cancelled: { amountCents: number; count: number };
  updatedAt: Date;
}

function toOperationDto(row: OperationRow): OperationDto {
  return {
    paymentOrderId: row.paymentOrderId,
    companyId: row.companyId,
    status: row.status,
    workerName: row.workerName,
    amountCents: row.amountCents,
    currency: row.currency,
    latestEventType: row.latestEventType,
    latestEventAt: row.latestEventAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function zeroTotals(companyId: string): FinancialTotalsDto {
  return {
    companyId,
    pending: { amountCents: 0, count: 0 },
    approved: { amountCents: 0, count: 0 },
    disputed: { amountCents: 0, count: 0 },
    cancelled: { amountCents: 0, count: 0 },
    updatedAt: new Date(0),
  };
}

@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operations: OperationsRepository,
    private readonly projection: ProjectionRepository,
  ) {}

  async list(filter: OperationListFilter): Promise<OperationListResult> {
    const query = { companyId: filter.companyId, status: filter.status, from: filter.from, to: filter.to };
    const [rows, total] = await Promise.all([
      this.operations.listOperations({
        ...query,
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
      }),
      this.operations.countOperations(query),
    ]);
    return { items: rows.map(toOperationDto), total, page: filter.page, pageSize: filter.pageSize };
  }

  async totals(companyId: string): Promise<FinancialTotalsDto> {
    const company = await this.operations.company(companyId);
    if (!company) {
      throw new ResourceNotFoundError(`Company ${companyId} does not exist`, { companyId });
    }
    const row = await this.operations.getTotals(companyId);
    if (!row) {
      return zeroTotals(companyId);
    }
    return {
      companyId,
      pending: { amountCents: Number(row.pendingAmountCents), count: row.pendingCount },
      approved: { amountCents: Number(row.approvedAmountCents), count: row.approvedCount },
      disputed: { amountCents: Number(row.disputedAmountCents), count: row.disputedCount },
      cancelled: { amountCents: Number(row.cancelledAmountCents), count: row.cancelledCount },
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Re-derives the projection for orders created in [from, to) and recomputes all
   * company totals from the source, in one transaction. Idempotent and safe while live.
   */
  async rederive(from: Date, to: Date): Promise<{ rowsRebuilt: number }> {
    if (from.getTime() >= to.getTime()) {
      throw new ValidationError('Invalid re-derivation window', { to: 'must be strictly after "from"' });
    }
    const rowsRebuilt = await this.prisma.transaction(async (tx) => {
      const rebuilt = await this.projection.rederiveWindow(tx, from, to);
      await this.projection.recomputeTotals(tx);
      return rebuilt;
    });
    return { rowsRebuilt };
  }
}
```

### src/operations/drift-repair.service.ts
```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service.js';
import { ProjectionRepository } from './projection.repository.js';

export interface DriftRepairReport {
  from: Date;
  to: Date;
  driftedOrders: number;
  rowsRepaired: number;
  driftedTotalsCompanies: number;
  totalsRecomputed: boolean;
}

const DEFAULT_WINDOW_HOURS = 24;
const DEFAULT_CRON = '*/5 * * * *';

/**
 * Scheduled drift repair: periodically compares the projection against the source
 * for a recent window and converges what disagrees, without a person noticing first.
 *
 * Window: DRIFT_REPAIR_WINDOW_HOURS (default 24). Schedule: DRIFT_REPAIR_CRON (default every 5 minutes).
 */
@Injectable()
export class DriftRepairService {
  private readonly logger = new Logger(DriftRepairService.name);
  private readonly windowMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly projection: ProjectionRepository,
  ) {
    const hours = Number(process.env.DRIFT_REPAIR_WINDOW_HOURS ?? DEFAULT_WINDOW_HOURS);
    this.windowMs = (Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_WINDOW_HOURS) * 3_600_000;
  }

  @Cron(process.env.DRIFT_REPAIR_CRON ?? DEFAULT_CRON)
  async run(): Promise<DriftRepairReport> {
    const to = new Date();
    const from = new Date(to.getTime() - this.windowMs);
    try {
      const report = await this.prisma.transaction(async (tx) => {
        const driftedOrderIds = await this.projection.findDriftedOrderIds(tx, from, to);
        let rowsRepaired = 0;
        if (driftedOrderIds.length > 0) {
          // The same idempotent re-derivation routine is the repair mechanism.
          rowsRepaired = await this.projection.rederiveWindow(tx, from, to);
        }
        const driftedCompanyIds = await this.projection.findTotalsDriftedCompanyIds(tx, from, to);
        let totalsRecomputed = false;
        if (driftedCompanyIds.length > 0) {
          await this.projection.recomputeTotals(tx);
          totalsRecomputed = true;
        }
        return {
          from,
          to,
          driftedOrders: driftedOrderIds.length,
          rowsRepaired,
          driftedTotalsCompanies: driftedCompanyIds.length,
          totalsRecomputed,
        };
      });
      if (report.driftedOrders > 0 || report.driftedTotalsCompanies > 0) {
        this.logger.warn(
          `Drift repaired: ${report.driftedOrders} order row(s), totals recomputed: ${report.totalsRecomputed} ` +
            `(window [${from.toISOString()}, ${to.toISOString()}])`,
        );
      }
      return report;
    } catch (error) {
      this.logger.error(
        `Drift repair failed for window [${from.toISOString()}, ${to.toISOString()}]: ${
          error instanceof Error ? error.stack : String(error)
        }`,
      );
      throw error;
    }
  }
}
```

### src/operations/operations.controller.ts
```ts
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  finishValidation,
  parseOptionalIsoDate,
  parseOptionalUuid,
  parsePositiveInt,
  parseRequiredIsoDate,
  parseStatus,
  requireUuid,
  ValidationErrors,
} from '../common/validation.js';
import { FinancialTotalsDto, OperationListResult, OperationsService } from './operations.service.js';

@Controller('operations')
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get()
  list(@Query() query: Record<string, string | undefined>): Promise<OperationListResult> {
    const errors: ValidationErrors = {};
    const companyId = parseOptionalUuid(query?.companyId, 'companyId', errors);
    const status = parseStatus(query?.status, 'status', errors);
    const from = parseOptionalIsoDate(query?.from, 'from', errors);
    const to = parseOptionalIsoDate(query?.to, 'to', errors);
    const page = parsePositiveInt(query?.page, 'page', errors, 1_000_000) ?? 1;
    const pageSize = parsePositiveInt(query?.pageSize, 'pageSize', errors, 100) ?? 20;
    if (from !== undefined && to !== undefined && from.getTime() >= to.getTime()) {
      errors.to = 'must be strictly after "from"';
    }
    finishValidation(errors);
    return this.operations.list({ companyId, status, from, to, page, pageSize });
  }

  @Get('companies/:companyId/financial-totals')
  financialTotals(@Param('companyId') companyId: string): Promise<FinancialTotalsDto> {
    requireUuid(companyId, 'companyId');
    return this.operations.totals(companyId);
  }

  @Post('rederive')
  rederive(@Body() body: Record<string, unknown> | undefined): Promise<{ rowsRebuilt: number }> {
    const errors: ValidationErrors = {};
    const from = parseRequiredIsoDate(body?.from, 'from', errors);
    const to = parseRequiredIsoDate(body?.to, 'to', errors);
    if (from !== undefined && to !== undefined && from.getTime() >= to.getTime()) {
      errors.to = 'must be strictly after "from"';
    }
    finishValidation(errors);
    return this.operations.rederive(from as Date, to as Date);
  }
}
```

### src/operations/operations.module.ts
```ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { DriftRepairService } from './drift-repair.service.js';
import { OperationsController } from './operations.controller.js';
import { OperationsRepository } from './operations.repository.js';
import { OperationsService } from './operations.service.js';
import { ProjectionRepository } from './projection.repository.js';
import { ProjectionService } from './projection.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [OperationsController],
  providers: [OperationsService, OperationsRepository, ProjectionRepository, ProjectionService, DriftRepairService],
  exports: [ProjectionService],
})
export class OperationsModule {}
```

### src/orders/orders.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { OrderStatus, PaymentOrder, Prisma } from '@prisma/client';
import { ResourceNotFoundError } from '../common/errors.js';
import { PrismaService } from '../database/prisma.service.js';

export interface NewOrderInput {
  companyId: string;
  workerId: string;
  amountCents: number;
  currency: string;
}

type Tx = Prisma.TransactionClient;

@Injectable()
export class OrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async companyExists(companyId: string, tx: Tx = this.prisma): Promise<boolean> {
    const row = await tx.company.findUnique({ where: { id: companyId }, select: { id: true } });
    return row !== null;
  }

  async workerExists(workerId: string, tx: Tx = this.prisma): Promise<boolean> {
    const row = await tx.worker.findUnique({ where: { id: workerId }, select: { id: true } });
    return row !== null;
  }

  async create(input: NewOrderInput, tx: Tx): Promise<PaymentOrder> {
    return tx.paymentOrder.create({ data: input });
  }

  async assignWorker(orderId: string, workerId: string, tx: Tx): Promise<PaymentOrder> {
    return tx.paymentOrder.update({ where: { id: orderId }, data: { workerId } });
  }

  async find(id: string, tx: Tx = this.prisma): Promise<PaymentOrder | null> {
    return tx.paymentOrder.findUnique({ where: { id } });
  }

  async findOrThrow(id: string, tx: Tx = this.prisma): Promise<PaymentOrder> {
    const order = await this.find(id, tx);
    if (!order) {
      throw new ResourceNotFoundError(`Payment order ${id} does not exist`, { orderId: id });
    }
    return order;
  }

  /**
   * Atomically moves the order from `fromStatus` to `toStatus` via a guarded update.
   * Returns null when the order is not in `fromStatus` (concurrent change); the
   * caller decides the error, and the whole transaction rolls back with it.
   */
  async transition(
    orderId: string,
    fromStatus: OrderStatus,
    toStatus: OrderStatus,
    tx: Tx,
  ): Promise<PaymentOrder | null> {
    const result = await tx.paymentOrder.updateMany({
      where: { id: orderId, status: fromStatus },
      data: { status: toStatus },
    });
    if (result.count === 0) {
      return null;
    }
    const updated = await this.find(orderId, tx);
    if (!updated) {
      throw new ResourceNotFoundError(`Payment order ${orderId} disappeared during transition`, { orderId });
    }
    return updated;
  }
}
```

### src/orders/orders.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { OrderStatus, PaymentOrder, Prisma } from '@prisma/client';
import { ConflictError, ResourceNotFoundError } from '../common/errors.js';
import { PrismaService } from '../database/prisma.service.js';
import { EventRepository } from '../events/events.repository.js';
import { ProjectionService } from '../operations/projection.service.js';
import { NewOrderInput, OrdersRepository } from './orders.repository.js';

type Tx = Prisma.TransactionClient;
type OrderSnapshot = Pick<
  PaymentOrder,
  'id' | 'companyId' | 'workerId' | 'status' | 'amountCents' | 'currency' | 'createdAt' | 'updatedAt'
>;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersRepository,
    private readonly events: EventRepository,
    private readonly projection: ProjectionService,
  ) {}

  async create(input: NewOrderInput): Promise<PaymentOrder> {
    return this.prisma.transaction(async (tx) => {
      const [companyExists, workerExists] = await Promise.all([
        this.orders.companyExists(input.companyId, tx),
        this.orders.workerExists(input.workerId, tx),
      ]);
      if (!companyExists) {
        throw new ResourceNotFoundError(`Company ${input.companyId} does not exist`, { companyId: input.companyId });
      }
      if (!workerExists) {
        throw new ResourceNotFoundError(`Worker ${input.workerId} does not exist`, { workerId: input.workerId });
      }
      const order = await this.orders.create(input, tx);
      // Maintenance hook — inside the writer's transaction (read-your-own-writes, rollback-safe).
      await this.projection.applyOrderChange(tx, order);
      return order;
    });
  }

  approve(orderId: string): Promise<PaymentOrder> {
    return this.move(orderId, 'pending', 'approved');
  }

  cancel(orderId: string): Promise<PaymentOrder> {
    return this.move(orderId, 'pending', 'cancelled');
  }

  async dispute(orderId: string): Promise<PaymentOrder> {
    return this.prisma.transaction(async (tx) => {
      const existing = await this.orders.findOrThrow(orderId, tx);
      if (existing.status === 'disputed' || existing.status === 'cancelled') {
        throw new ConflictError(`Order ${orderId} is ${existing.status}; it cannot be disputed`, {
          orderId,
          status: existing.status,
        });
      }
      const updated = await this.orders.transition(orderId, existing.status, 'disputed', tx);
      if (!updated) {
        throw new ConflictError(`Order ${orderId} changed concurrently`, { orderId });
      }
      await this.applyProjection(tx, updated, 'disputed');
      return updated;
    });
  }

  async assignWorker(orderId: string, workerId: string): Promise<PaymentOrder> {
    return this.prisma.transaction(async (tx) => {
      await this.orders.findOrThrow(orderId, tx);
      if (!(await this.orders.workerExists(workerId, tx))) {
        throw new ResourceNotFoundError(`Worker ${workerId} does not exist`, { workerId });
      }
      const updated = await this.orders.assignWorker(orderId, workerId, tx);
      await this.applyProjection(tx, updated, 'worker_assigned');
      return updated;
    });
  }

  private move(orderId: string, from: OrderStatus, to: OrderStatus): Promise<PaymentOrder> {
    return this.prisma.transaction(async (tx) => {
      const existing = await this.orders.findOrThrow(orderId, tx);
      if (existing.status !== from) {
        throw new ConflictError(
          `Order ${orderId} is ${existing.status}; only ${from} orders can be moved to ${to}`,
          { orderId, status: existing.status },
        );
      }
      const updated = await this.orders.transition(orderId, from, to, tx);
      if (!updated) {
        throw new ConflictError(`Order ${orderId} changed concurrently`, { orderId });
      }
      await this.applyProjection(tx, updated, to);
      return updated;
    });
  }

  /** Shared write→read-model hook for every order mutation, inside the same transaction. */
  private async applyProjection(tx: Tx, order: OrderSnapshot, auditType: string): Promise<void> {
    await this.projection.applyOrderChange(tx, order);
    const event = await this.events.record(
      { paymentOrderId: order.id, eventType: auditType, occurredAt: order.updatedAt },
      tx,
    );
    await this.projection.applyEvent(tx, event);
  }
}
```

### src/orders/orders.controller.ts
```ts
import { Body, Controller, Param, Post } from '@nestjs/common';
import { PaymentOrder } from '@prisma/client';
import {
  finishValidation,
  parseCurrency,
  parseNonNegativeInt,
  parseUuid,
  requireUuid,
  ValidationErrors,
} from '../common/validation.js';
import { NewOrderInput } from './orders.repository.js';
import { OrdersService } from './orders.service.js';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  create(@Body() body: Record<string, unknown> | undefined): Promise<PaymentOrder> {
    const errors: ValidationErrors = {};
    const input = {
      companyId: parseUuid(body?.companyId, 'companyId', errors),
      workerId: parseUuid(body?.workerId, 'workerId', errors),
      amountCents: parseNonNegativeInt(body?.amountCents, 'amountCents', errors),
      currency: parseCurrency(body?.currency, 'currency', errors),
    };
    finishValidation(errors);
    return this.orders.create(input as NewOrderInput);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string): Promise<PaymentOrder> {
    requireUuid(id, 'id');
    return this.orders.approve(id);
  }

  @Post(':id/dispute')
  dispute(@Param('id') id: string): Promise<PaymentOrder> {
    requireUuid(id, 'id');
    return this.orders.dispute(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string): Promise<PaymentOrder> {
    requireUuid(id, 'id');
    return this.orders.cancel(id);
  }

  @Post(':id/assign-worker')
  assignWorker(@Param('id') id: string, @Body() body: Record<string, unknown> | undefined): Promise<PaymentOrder> {
    requireUuid(id, 'id');
    const errors: ValidationErrors = {};
    const workerId = parseUuid(body?.workerId, 'workerId', errors);
    finishValidation(errors);
    return this.orders.assignWorker(id, workerId);
  }
}
```

### src/orders/orders.module.ts
```ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { EventsModule } from '../events/events.module.js';
import { OperationsModule } from '../operations/operations.module.js';
import { OrdersController } from './orders.controller.js';
import { OrdersRepository } from './orders.repository.js';
import { OrdersService } from './orders.service.js';

@Module({
  imports: [DatabaseModule, EventsModule, OperationsModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersRepository],
})
export class OrdersModule {}
```

### src/events/events.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { Event, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';

export interface NewEventInput {
  paymentOrderId: string;
  eventType: string;
  note?: string;
  occurredAt: Date;
}

type Tx = Prisma.TransactionClient;

@Injectable()
export class EventRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Liveness check on the source order.
   * // ASSUMPTION: kept in this repository (instead of importing the orders feature) so EventsModule
   * does not create a circular module import with OrdersModule, which consumes this repository.
   */
  async orderExists(orderId: string, tx: Tx = this.prisma): Promise<boolean> {
    const row = await tx.paymentOrder.findUnique({ where: { id: orderId }, select: { id: true } });
    return row !== null;
  }

  async record(input: NewEventInput, tx: Tx): Promise<Event> {
    return tx.event.create({ data: input });
  }
}
```

### src/events/events.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { Event } from '@prisma/client';
import { ResourceNotFoundError } from '../common/errors.js';
import { PrismaService } from '../database/prisma.service.js';
import { ProjectionService } from '../operations/projection.service.js';
import { EventRepository } from './events.repository.js';

export interface RecordEventInput {
  paymentOrderId: string;
  eventType: string;
  note?: string;
  occurredAt?: Date;
}

@Injectable()
export class EventService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventRepository,
    private readonly projection: ProjectionService,
  ) {}

  async record(input: RecordEventInput): Promise<Event> {
    return this.prisma.transaction(async (tx) => {
      if (!(await this.events.orderExists(input.paymentOrderId, tx))) {
        throw new ResourceNotFoundError(`Payment order ${input.paymentOrderId} does not exist`, {
          orderId: input.paymentOrderId,
        });
      }
      const event = await this.events.record(
        {
          paymentOrderId: input.paymentOrderId,
          eventType: input.eventType,
          note: input.note,
          occurredAt: input.occurredAt ?? new Date(),
        },
        tx,
      );
      // Maintenance hook — inside the writer's transaction.
      await this.projection.applyEvent(tx, event);
      return event;
    });
  }
}
```

### src/events/events.controller.ts
```ts
import { Body, Controller, Param, Post } from '@nestjs/common';
import { Event } from '@prisma/client';
import { finishValidation, parseOptionalIsoDate, requireUuid, ValidationErrors } from '../common/validation.js';
import { EventService } from './events.service.js';

@Controller('orders')
export class EventsController {
  constructor(private readonly events: EventService) {}

  @Post(':orderId/events')
  record(@Param('orderId') orderId: string, @Body() body: Record<string, unknown> | undefined): Promise<Event> {
    requireUuid(orderId, 'orderId');
    const errors: ValidationErrors = {};
    const eventType = body?.eventType;
    if (typeof eventType !== 'string' || eventType.length === 0 || eventType.length > 100) {
      errors.eventType = 'must be a non-empty string of at most 100 characters';
    }
    let note: string | undefined;
    if (body?.note !== undefined) {
      if (typeof body.note !== 'string' || body.note.length > 1000) {
        errors.note = 'must be a string of at most 1000 characters';
      } else {
        note = body.note;
      }
    }
    const occurredAt = parseOptionalIsoDate(body?.occurredAt, 'occurredAt', errors);
    finishValidation(errors);
    return this.events.record({ paymentOrderId: orderId, eventType: eventType as string, note, occurredAt });
  }
}
```

### src/events/events.module.ts
```ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { OperationsModule } from '../operations/operations.module.js';
import { EventsController } from './events.controller.js';
import { EventRepository } from './events.repository.js';
import { EventService } from './events.service.js';

@Module({
  imports: [DatabaseModule, OperationsModule],
  controllers: [EventsController],
  providers: [EventService, EventRepository],
  exports: [EventRepository],
})
export class EventsModule {}
```

### test/helpers.ts
```ts
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { DriftRepairService } from '../src/operations/drift-repair.service.js';

export interface TestApp {
  moduleRef: TestingModule;
  prisma: PrismaService;
  close(): Promise<void>;
}

/**
 * Builds the real application (real Nest wiring, real Postgres via DATABASE_URL).
 * The scheduled drift-repair job is stubbed out so tests control every projection mutation.
 */
export async function createTestApp(): Promise<TestApp> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must point to a PostgreSQL database with the migrations applied');
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DriftRepairService)
    .useValue({ run: () => { throw new Error('the scheduled drift repair is disabled in tests'); } })
    .compile();
  await moduleRef.init();
  const prisma = moduleRef.get(PrismaService);
  return {
    moduleRef,
    prisma,
    close: async () => {
      await moduleRef.close();
    },
  };
}

export interface CompanySeed {
  companyId: string;
  workerId: string;
  workerName: string;
  otherWorkerId: string;
  otherWorkerName: string;
}

/** A fresh company with two workers, so each test is isolated from every other test. */
export async function seedCompany(prisma: PrismaClient, label: string): Promise<CompanySeed> {
  const company = await prisma.company.create({ data: { name: `${label}-${randomUUID()}` } });
  const worker = await prisma.worker.create({
    data: { name: `${label} worker A ${randomUUID().slice(0, 8)}`, companyId: company.id },
  });
  const otherWorker = await prisma.worker.create({
    data: { name: `${label} worker B ${randomUUID().slice(0, 8)}`, companyId: company.id },
  });
  return {
    companyId: company.id,
    workerId: worker.id,
    workerName: worker.name,
    otherWorkerId: otherWorker.id,
    otherWorkerName: otherWorker.name,
  };
}

export function windowAroundNow(): { from: Date; to: Date } {
  return { from: new Date(Date.now() - 5 * 60_000), to: new Date(Date.now() + 5 * 60_000) };
}

export async function snapshotOperationRows(prisma: PrismaClient, companyId: string): Promise<Record<string, unknown>[]> {
  const rows = await prisma.operationRow.findMany({ where: { companyId }, orderBy: { paymentOrderId: 'asc' } });
  return rows.map((row) => ({
    paymentOrderId: row.paymentOrderId,
    status: row.status,
    workerName: row.workerName,
    amountCents: row.amountCents,
    latestEventType: row.latestEventType,
    latestEventAt: row.latestEventAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}
```

### test/orders.spec.ts
```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConflictError, ResourceNotFoundError } from '../src/common/errors.js';
import { OrdersService } from '../src/orders/orders.service.js';
import { OperationsService } from '../src/operations/operations.service.js';
import { CompanySeed, createTestApp, seedCompany, TestApp } from './helpers.js';

describe('read-your-own-writes (orders → operations dashboard)', () => {
  let app: TestApp;
  let orders: OrdersService;
  let operations: OperationsService;
  let seed: CompanySeed;

  beforeAll(async () => {
    app = await createTestApp();
    orders = app.moduleRef.get(OrdersService);
    operations = app.moduleRef.get(OperationsService);
    seed = await seedCompany(app.prisma, 'ryw');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('shows a created order immediately, and its approval on the very next request', async () => {
    const order = await orders.create({
      companyId: seed.companyId,
      workerId: seed.workerId,
      amountCents: 5_000,
      currency: 'USD',
    });

    const afterCreate = await operations.list({ companyId: seed.companyId, page: 1, pageSize: 50 });
    const created = afterCreate.items.find((row) => row.paymentOrderId === order.id);
    expect(created).toBeDefined();
    expect(created!.status).toBe('pending');
    expect(created!.workerName).toBe(seed.workerName);
    expect(created!.amountCents).toBe(5_000);

    await orders.approve(order.id);

    // No waiting, no refresh job: the very next read shows the approval.
    const afterApprove = await operations.list({ companyId: seed.companyId, page: 1, pageSize: 50 });
    const approved = afterApprove.items.find((row) => row.paymentOrderId === order.id);
    expect(approved).toBeDefined();
    expect(approved!.status).toBe('approved');
    expect(approved!.latestEventType).toBe('approved');

    const totals = await operations.totals(seed.companyId);
    expect(totals.approved).toEqual({ amountCents: 5_000, count: 1 });
    expect(totals.pending).toEqual({ amountCents: 0, count: 0 });
  });

  it('a worker reassignment is visible on the next request without moving totals', async () => {
    const order = await orders.create({
      companyId: seed.companyId,
      workerId: seed.workerId,
      amountCents: 700,
      currency: 'USD',
    });

    const totalsBefore = await operations.totals(seed.companyId);
    await orders.assignWorker(order.id, seed.otherWorkerId);

    const row = (await operations.list({ companyId: seed.companyId, page: 1, pageSize: 50 }))
      .items.find((r) => r.paymentOrderId === order.id);
    expect(row!.workerName).toBe(seed.otherWorkerName);
    expect(row!.latestEventType).toBe('worker_assigned');
    expect(row!.amountCents).toBe(700);

    const totalsAfter = await operations.totals(seed.companyId);
    expect(totalsAfter.pending.amountCents).toBe(totalsBefore.pending.amountCents);
    expect(totalsAfter.pending.count).toBe(totalsBefore.pending.count);
  });

  it('a failed write rolls back: neither source nor projection changes', async () => {
    const order = await orders.create({
      companyId: seed.companyId,
      workerId: seed.workerId,
      amountCents: 1_200,
      currency: 'USD',
    });
    await orders.cancel(order.id);

    const totalsBefore = await operations.totals(seed.companyId);
    const rowBefore = (await operations.list({ companyId: seed.companyId, page: 1, pageSize: 50 }))
      .items.find((r) => r.paymentOrderId === order.id);

    // The second cancel must conflict and leave everything untouched.
    await expect(orders.cancel(order.id)).rejects.toThrow(ConflictError);

    const totalsAfter = await operations.totals(seed.companyId);
    expect(totalsAfter).toEqual(totalsBefore);
    const rowAfter = (await operations.list({ companyId: seed.companyId, page: 1, pageSize: 50 }))
      .items.find((r) => r.paymentOrderId === order.id);
    expect(rowAfter).toEqual(rowBefore);
    const source = await app.prisma.paymentOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(source.status).toBe('cancelled');
  });

  it('rejects operations on unknown orders with resource_not_found', async () => {
    await expect(orders.approve(randomUUID())).rejects.toThrow(ResourceNotFoundError);
  });

  it('the dashboard reads only the projection, not the source tables', async () => {
    // A source row written without the maintenance hook must not appear on the dashboard.
    const raw = await app.prisma.paymentOrder.create({
      data: { companyId: seed.companyId, workerId: seed.workerId, amountCents: 777, currency: 'USD' },
    });
    const list = await operations.list({ companyId: seed.companyId, page: 1, pageSize: 100 });
    expect(list.items.map((row) => row.paymentOrderId)).not.toContain(raw.id);
    // Clean up so this source-only row cannot show up as drift for other tests.
    await app.prisma.paymentOrder.delete({ where: { id: raw.id } });
  });
});
```

### test/concurrency.spec.ts
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OrdersService } from '../src/orders/orders.service.js';
import { OperationsService } from '../src/operations/operations.service.js';
import { CompanySeed, createTestApp, seedCompany, TestApp } from './helpers.js';

describe('concurrent updates to one company totals', () => {
  let app: TestApp;
  let orders: OrdersService;
  let operations: OperationsService;
  let seed: CompanySeed;

  beforeAll(async () => {
    app = await createTestApp();
    orders = app.moduleRef.get(OrdersService);
    operations = app.moduleRef.get(OperationsService);
    seed = await seedCompany(app.prisma, 'conc');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('two concurrent approvals for the same company are both reflected in the totals', async () => {
    const a = await orders.create({
      companyId: seed.companyId,
      workerId: seed.workerId,
      amountCents: 1_000,
      currency: 'USD',
    });
    const b = await orders.create({
      companyId: seed.companyId,
      workerId: seed.otherWorkerId,
      amountCents: 2_500,
      currency: 'USD',
    });

    // Concurrent, not sequential: two separate transactions race on the same totals row.
    // A read-modify-write would lose one of these; an in-place increment loses none.
    await Promise.all([orders.approve(a.id), orders.approve(b.id)]);

    const totals = await operations.totals(seed.companyId);
    expect(totals.approved.amountCents).toBe(3_500);
    expect(totals.approved.count).toBe(2);
    expect(totals.pending).toEqual({ amountCents: 0, count: 0 });
  });

  it('eight concurrent approvals sum exactly (no lost update at higher contention)', async () => {
    const amounts = [101, 202, 303, 404, 505, 606, 707, 808];
    const created = await Promise.all(
      amounts.map((amountCents, i) =>
        orders.create({
          companyId: seed.companyId,
          workerId: i % 2 === 0 ? seed.workerId : seed.otherWorkerId,
          amountCents,
          currency: 'USD',
        }),
      ),
    );

    await Promise.all(created.map((o) => orders.approve(o.id)));

    const totals = await operations.totals(seed.companyId);
    // The first test already approved 3_500 for this company.
    const expected = 3_500 + amounts.reduce((sum, x) => sum + x, 0);
    expect(totals.approved.amountCents).toBe(expected);
    expect(totals.approved.count).toBe(2 + amounts.length);

    const rows = (
      await operations.list({ companyId: seed.companyId, status: 'approved', page: 1, pageSize: 100 })
    ).items;
    expect(rows.filter((row) => created.some((o) => o.id === row.paymentOrderId))).toHaveLength(amounts.length);
  });
});
```

### test/operations.spec.ts
```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ResourceNotFoundError } from '../src/common/errors.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { DriftRepairService } from '../src/operations/drift-repair.service.js';
import { OperationsService } from '../src/operations/operations.service.js';
import { ProjectionRepository } from '../src/operations/projection.repository.js';
import { createTestApp, snapshotOperationRows, TestApp, windowAroundNow } from './helpers.js';

describe('re-derivation and drift repair', () => {
  let app: TestApp;
  let operations: OperationsService;
  let drift: DriftRepairService;

  beforeAll(async () => {
    app = await createTestApp();
    operations = app.moduleRef.get(OperationsService);
    // The DI-provided job is stubbed (no cron in tests); drive the real class directly.
    drift = new DriftRepairService(
      app.moduleRef.get(PrismaService),
      app.moduleRef.get(ProjectionRepository),
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  async function seedSourceState() {
    // Direct source seed: the projection is built purely by the re-derivation routine,
    // not by the hooks, so this proves the routine reproduces the join result.
    const company = await app.prisma.company.create({ data: { name: `rederive-${randomUUID()}` } });
    const workerA = await app.prisma.worker.create({
      data: { name: `RD worker A ${randomUUID().slice(0, 8)}`, companyId: company.id },
    });
    const workerB = await app.prisma.worker.create({
      data: { name: `RD worker B ${randomUUID().slice(0, 8)}`, companyId: company.id },
    });

    const t1 = new Date(Date.now() - 5 * 60_000);
    const t2 = new Date(Date.now() - 3 * 60_000);
    const t3 = new Date(Date.now() - 1 * 60_000);

    const approvedOrder = await app.prisma.paymentOrder.create({
      data: { companyId: company.id, workerId: workerA.id, status: 'approved', amountCents: 100, currency: 'USD' },
    });
    const pendingOrder = await app.prisma.paymentOrder.create({
      data: { companyId: company.id, workerId: workerB.id, status: 'pending', amountCents: 200, currency: 'USD' },
    });
    const disputedOrder = await app.prisma.paymentOrder.create({
      data: { companyId: company.id, workerId: workerA.id, status: 'disputed', amountCents: 300, currency: 'USD' },
    });

    await app.prisma.event.create({ data: { paymentOrderId: approvedOrder.id, eventType: 'field_visit', occurredAt: t1 } });
    await app.prisma.event.create({ data: { paymentOrderId: approvedOrder.id, eventType: 'approved', occurredAt: t2 } });
    await app.prisma.event.create({ data: { paymentOrderId: pendingOrder.id, eventType: 'created', occurredAt: t3 } });

    return { company, workerA, workerB, approvedOrder, pendingOrder, disputedOrder, t1, t2, t3 };
  }

  it('rebuilding a window reproduces the join result, and a second run leaves the same result', async () => {
    const s = await seedSourceState();
    const window = windowAroundNow();

    const first = await operations.rederive(window.from, window.to);
    expect(first.rowsRebuilt).toBeGreaterThanOrEqual(3);

    const rows = await snapshotOperationRows(app.prisma, s.company.id);
    expect(rows).toHaveLength(3);

    const byId = new Map(rows.map((row) => [row.paymentOrderId, row]));
    expect(byId.get(s.approvedOrder.id)).toMatchObject({
      status: 'approved',
      workerName: s.workerA.name,
      amountCents: 100,
      latestEventType: 'approved',
      latestEventAt: s.t2.toISOString(),
    });
    expect(byId.get(s.pendingOrder.id)).toMatchObject({
      status: 'pending',
      workerName: s.workerB.name,
      amountCents: 200,
      latestEventType: 'created',
    });
    expect(byId.get(s.disputedOrder.id)).toMatchObject({
      status: 'disputed',
      amountCents: 300,
      latestEventType: null,
      latestEventAt: null,
    });

    // Totals recomputed from the source, exactly.
    const totals = await operations.totals(s.company.id);
    expect(totals.approved).toEqual({ amountCents: 100, count: 1 });
    expect(totals.pending).toEqual({ amountCents: 200, count: 1 });
    expect(totals.disputed).toEqual({ amountCents: 300, count: 1 });

    // A second run over the same window must leave the same result (idempotent, safe while live).
    const second = await operations.rederive(window.from, window.to);
    const rowsAfterSecond = await snapshotOperationRows(app.prisma, s.company.id);
    expect(second.rowsRebuilt).toBeGreaterThanOrEqual(3);
    expect(rowsAfterSecond).toEqual(rows);
  });

  it('the drift repair job finds and fixes injected drift in rows and totals', async () => {
    const s = await seedSourceState();
    const window = windowAroundNow();
    await operations.rederive(window.from, window.to); // baseline: projection == source

    // Inject drift the way a deploy mid-transaction or a manual data fix would.
    await app.prisma.operationRow.update({
      where: { paymentOrderId: s.approvedOrder.id },
      data: {
        status: 'pending',
        workerName: 'corrupted',
        latestEventType: null,
        latestEventAt: null,
        latestEventId: null,
      },
    });
    await app.prisma.companyFinancialTotals.update({
      where: { companyId: s.company.id },
      data: { approvedAmountCents: { decrement: 100 }, approvedCount: { decrement: 1 } },
    });

    // Sanity: the drift is actually present before the repair.
    const drifted = await snapshotOperationRows(app.prisma, s.company.id);
    expect(drifted.find((row) => row.paymentOrderId === s.approvedOrder.id)).toMatchObject({
      status: 'pending',
      workerName: 'corrupted',
    });
    const corruptedTotals = await operations.totals(s.company.id);
    expect(corruptedTotals.approved).toEqual({ amountCents: 0, count: 0 });

    const report = await drift.run();
    expect(report.driftedOrders).toBeGreaterThanOrEqual(1);
    expect(report.totalsRecomputed).toBe(true);

    // The projection matches the source again.
    const repaired = await snapshotOperationRows(app.prisma, s.company.id);
    const byId = new Map(repaired.map((row) => [row.paymentOrderId, row]));
    expect(byId.get(s.approvedOrder.id)).toMatchObject({
      status: 'approved',
      workerName: s.workerA.name,
      latestEventType: 'approved',
    });
    const totals = await operations.totals(s.company.id);
    expect(totals.approved).toEqual({ amountCents: 100, count: 1 });
    expect(totals.pending).toEqual({ amountCents: 200, count: 1 });
    expect(totals.disputed).toEqual({ amountCents: 300, count: 1 });

    // A follow-up run finds nothing to repair.
    const clean = await drift.run();
    expect(clean.driftedOrders).toBe(0);
    expect(clean.driftedTotalsCompanies).toBe(0);
    expect(clean.totalsRecomputed).toBe(false);
  });

  it('returns resource_not_found for a totals lookup of an unknown company', async () => {
    await expect(operations.totals(randomUUID())).rejects.toThrow(ResourceNotFoundError);
  });
});
```

### DESIGN.md
```md
# DESIGN — operations dashboard read model (issue #501)

## Constraints that decide the design

1. **Read-your-own-writes.** An operator approves an order; the next dashboard request shows it.
   Any design with a propagation window (a schedule, a queue, a replica) violates this by construction.
2. **Exact per-company totals.** Finance reconciles against them: not approximate, not "eventually exact".
3. **p95 < 50 ms** at ~3M orders, with no change to what operators see (columns, filters, ordering, page sizes).

## The design in one paragraph

Two projection tables, maintained by hooks that run **inside the writer's own Postgres transaction**:
`operation_rows` (one row per payment order, shaped like the dashboard join) and
`company_financial_totals` (exact per-company aggregates). The dashboard query reads `operation_rows`
alone, served by a covering index that matches filter + sort. A windowed re-derivation routine rebuilds
the projection from the source tables (idempotent, safe while live), and a scheduled drift-repair job
compares projection against source for a recent window and converges what disagrees.

## Why the hooks are synchronous and in-transaction

The hooks are plain service calls from the write services (`ProjectionService.applyOrderChange` /
`applyEvent`), executed with the same transaction handle as the source mutation:

- the projection sees exactly the writer's snapshot — no visibility gap, so the next read (same or
  another connection) observes the change immediately;
- if the write rolls back, the projection never saw it — no orphaned state, no compensating writes.

### Alternatives rejected

| Alternative | Why it fails or loses |
|---|---|
| Scheduled refresh / interval job | Any interval > 0 is a read-your-own-writes gap. The requirement explicitly forbids it. |
| `REFRESH MATERIALIZED VIEW` (even `CONCURRENTLY`) | Same scheduling problem, plus a whole-table rebuild cost; the refresh is global and cannot bound per-write latency. |
| Postgres trigger on the source table | Works, but moves read-model logic out of the app: untestable with the app's tests, a second home for business rules, and a surprise at the schema level. Same cost as an in-transaction hook, strictly less testable. |
| CDC / outbox / queue (e.g. Debezium → consumer) | Asynchronous by construction: consumer lag *is* the read-your-own-writes gap. More infrastructure for a property we do not need (decoupling) at the cost of the property we do (zero gap). |
| Trigger/replication on a replica | Adds a network hop and lag; the read-your-own-writes gap again. |
| Better index / faster join on the source | The join spans three tables at 3M rows with selective filters; index tuning buys an order of magnitude at best, not the ~400× to 50 ms, and every new column the dashboard wants reopens the join. A cache has the same staleness problem as a schedule. |

An in-transaction hook costs one indexed upsert plus one row update per write — negligible next to the
write itself — and is the only option with a zero gap.

## Exactness under concurrency

The totals row is never read-modify-written in app code. The hook applies an **in-place delta**
(`SET x = x ± delta` via Prisma `increment`/`decrement` inside an upsert): concurrent writers to the same
company's row serialize on the row lock and each delta is applied exactly once. `test/concurrency.spec.ts`
proves it with two and with eight truly concurrent approvals (separate transactions), asserting the exact
sum and count — a read-modify-write loses updates under this test.

## Idempotent re-derivation

`OperationsService.rederive(from, to)` runs two set-based statements in one transaction:

1. `INSERT … SELECT … ON CONFLICT DO UPDATE` rebuilds `operation_rows` for orders created in `[from, to)` —
   current status plus the latest event via `DISTINCT ON (order, occurred_at DESC, id DESC)`. The result
   depends only on the current source state, so running it twice leaves the same result.
2. `company_financial_totals` is recomputed from scratch (totals are global, not windowable).

Safe while live: the rebuild reads a snapshot; writes that commit afterwards are applied by the hooks, so
the projection converges to the latest source state either way. `POST /operations/rederive` exposes it.

## Drift repair

`DriftRepairService` runs on a cron (`DRIFT_REPAIR_CRON`, default every 5 minutes) over a recent window
(`DRIFT_REPAIR_WINDOW_HOURS`, default 24):

1. `findDriftedOrderIds` — orders in the window whose row is missing or `IS DISTINCT FROM` the source
   (status, company, worker name, amount, currency, latest event).
2. If any: the windowed re-derivation (the same idempotent routine) repairs the window.
3. `findTotalsDriftedCompanyIds` — companies whose totals row is missing, stale, or disagrees with the
   source aggregate. If any: recompute totals from scratch.
4. The outcome is logged. The job is a pure converging pass, so a failed run simply means the next one
   catches up.

Drift sources it is built for: a deploy mid-transaction, a manual data fix, a future bug in a hook.
A repair that requires a human to notice first would be a no-op.

## The read path

`GET /operations` → `operation_rows` only; no join back to the source.

```sql
CREATE INDEX operation_rows_company_status_updated_idx
  ON operation_rows (company_id, status, updated_at DESC, payment_order_id DESC)
  INCLUDE (worker_name, amount_cents, currency, latest_event_type, latest_event_at, latest_event_id, created_at);
```

The index is a seek on `(company_id, status)`, walked in sort order; `created_at` (the date-range filter)
and every projected column are in `INCLUDE`, so the query is answered from the index alone. `payment_order_id`
in the key makes the tiebreak and pagination stable. (Prisma cannot express `INCLUDE`; the migration carries
it — see "Caveats".)

## What operators see — unchanged

Same columns as the old join (order id, company, status, worker name, amount, currency, latest event,
timestamps), same filters (company, status, created-in range), same ordering (`updated_at DESC`, order-id
tiebreak), same page semantics. The only behavioural change is the guarantee: own writes visible immediately,
totals exact.

A row's `updated_at` mirrors `payment_orders.updated_at`; an event updates the latest-event fields but not
the row's recency — the same as the old join, where inserting an event did not touch the order row.

## Caveats

- `operation_rows` carries an FK to `payment_orders` (`ON DELETE CASCADE`) that the Prisma model does not
  declare (Prisma models it as a loose projection). The migration is authoritative for the physical schema.
- The drift window is recent-activity-based: corruption older than the window is caught on the next change
  to the affected orders, or by a manual `POST /operations/rederive`.
- Totals are stored as `BIGINT` cents and serialized as JSON numbers; the range is far beyond any realistic
  company total.

## Operations

- Env: `DATABASE_URL`, `PORT`, `DRIFT_REPAIR_CRON`, `DRIFT_REPAIR_WINDOW_HOURS`.
- Apply schema: `pnpm migrate` (`prisma migrate deploy`). Run tests: `pnpm test` (needs a Postgres with
  the migrations applied; test files run serially against it).
```
