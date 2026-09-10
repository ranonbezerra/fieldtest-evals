# solution-retry

## reasoning

```
Let me carefully think through this task.

The task is to build a complete solution for a marketplace operations dashboard with a read-model projection. Stack: TypeScript + NestJS + Prisma + PostgreSQL.

Deliverables:
1. Projection table and DDL with indexes
2. Maintenance hooks invoked from write services
3. Rederivation routine for arbitrary windows
4. Scheduled drift repair job
5. New dashboard queries
6. Tests for read-your-own-writes, concurrent total, drift repair
7. DESIGN.md justifying synchronous hooks

Let me design the domain model.

**Source tables:**
- `PaymentOrder` (id, company_id, status, amount, created_at, updated_at, probably event_id / worker_id)
- `Event` (id, ...)
- `Worker` (id, company_id, name, ...)
- `Company` (id, name)

The original dashboard query joins payment orders, events, workers and filters by company, status, date range.

**Projection tables:**

1. `ops_projection` (operations list row): one row per payment order, with denormalized fields: company_id, status, amount, occurred_at (event time?), worker_name, event_name, etc. Index: `(company_id, status, occurred_at DESC, id DESC)` covering.

2. `company_totals` (per-company financial totals): company_id (PK), total_amount, count per status? Spec says "per-company financial totals must be exact". Totals row: `approved_total_cents`, `count`, etc. Let me keep it simple: `company_id` PK, `total_cents` (bigint), `order_count` (int). Or totals per status. Let's do: `total_amount_cents BigInt`, plus maybe `approved_amount_cents`. Hmm. Let me define "totals" as the sum of order amounts per company (all statuses), or per status. Let me be more faithful to "financial totals" and have per-status totals — but that complicates atomic updates. Simpler: one totals row per company with `total_cents` = sum of amounts of all orders. Atomic increment: `UPDATE company_totals SET total_cents = total_cents + :delta WHERE company_id = :id` — but need the row to exist. Use `INSERT ... ON CONFLICT (company_id) DO UPDATE SET total_cents = total_cents + :delta` — atomic.

Actually per-status totals may be more realistic for a dashboard ("financial totals per company"). But the spec says "per-company financial totals" — one row per company. Let me do one row per company with `total_cents` and `order_count`. Hmm, but the "totals" of a dashboard filtered by status… Let me include per-status breakdown as separate columns: `approved_cents`, `pending_cents`, `rejected_cents`, `total_cents`, `order_count`. This makes the rederivation and drift repair a bit more complex but doable.

Actually, let me keep it manageable: statuses are `pending`, `approved`, `rejected`. Totals row:

```
CompanyTotal {
  companyId      String  @id @map("company_id")
  totalCents     BigInt  @default(0) @map("total_cents")
  approvedCents  BigInt  @default(0) @map("approved_cents")
  rejectedCents  BigInt  @default(0) @map("rejected_cents")
  orderCount     Int     @default(0) @map("order_count")
}
```

On insert: total += amount, count += 1. On approve: approved += amount. On reject: rejected += amount. On status change (e.g., pending→approved, or approved→rejected): adjust both. On delete: subtract.

Delta-computation logic: keep a `computeDelta(prev, next, amount)` that returns { totalDelta, approvedDelta, rejectedDelta, countDelta }.

- create: total +amount, count +1, status-specific +amount.
- status transition: status-specific columns: -amount on old, +amount on new. total and count unchanged.
- delete: total -amount, count -1, status-specific -amount.

That's clean.

**Ops projection row:**

```
OpsRow {
  id           String  @id @map("id")  // = payment order id
  companyId    String  @map("company_id")
  status       String  @map("status")
  amountCents  BigInt  @map("amount_cents")
  occurredAt   DateTime @map("occurred_at") // when the order's status was last set? or the event time?
  workerName   String? @map("worker_name")
  eventName    String? @map("event_name")
  createdAt    DateTime @map("created_at")
  updatedAt    DateTime @map("updated_at")
}
```

"Sorted by recency" — recency of what? The original query sorts by recency, probably by `updated_at` or event `occurred_at`. "Filter by company, status, date range, sort by recency". Let me define `occurred_at` as the order's `updated_at` (time of latest change) — hmm, actually "recency" in the operations list is typically the time the operation happened. Let me define the order's `updatedAt` as recency key. Simpler: projection has `occurredAt` mirroring source's `updated_at`.

Date range filter: on `occurredAt` (the updated-at). That's consistent.

Wait — but then filtering by status and date range and sort by recency means: filter by `occurred_at` range, filter by status, sort by `occurred_at DESC`. Covering index: `(company_id, status, occurred_at DESC)` INCLUDE (id, amount_cents, worker_name, event_name, created_at). In Prisma migrations I write raw SQL DDL.

But wait: "the dashboard queries touch projections only" — no join back to source. The original query joins events and workers. So the projection must carry `event_name` and `worker_name`. But if the worker's name changes, the projection goes stale… The spec says the projection is maintained as the source changes. For simplicity, the write services are: `OrderService.approveOrder`, `rejectOrder`, `createOrder`. Worker name changes might not be in the simulated write path. The spec says "simulate the write path so this is exercisable" — meaning we implement the write services (order creation, approval, rejection) that call the maintenance hooks within the same transaction. Worker name changes aren't strictly required. I'll mention it in DESIGN.md. Hmm but should I include a hook for worker renames? To keep scope tight, I'll cover order lifecycle writes (create, status change, maybe delete). I'll note in DESIGN.md that worker/event renames would also need a hook, and the drift repair covers that. Actually, for robustness, drift repair compares projection to source via re-derivation on recent window, so it fixes any drift including renames… But rederivation only touches orders within a date window (by order's created_at? or by occurred_at?). Hmm.

Rederivation routine: "rebuilds the projection for a date range from the source tables". Date range is probably on the order's `created_at` (orders created within that window). Or on `occurred_at`. Let me use order's `created_at` as the window key — that's what "orders in the window" most naturally means. But an order created long ago and approved today would have an occurred_at in a recent window but a created_at in a far window. For drift repair "for a recent window" — if window is on created_at, orders created 30 days ago but recently updated wouldn't be covered. Hmm.

Alternative: window on `updated_at` (occurred_at). An order's row in the projection is a function of its current state. If we rederive all orders with `updated_at` in [from, to], we correctly reconstruct the current projection row for them. Since the projection row is the current state keyed by order id, rederivation = for each order in the window (by updated_at), upsert the current projection row. That's idempotent and correct: if run twice on the same window, same result, as long as nothing is updated in between… Well if a new update happens during, then on second run we include it (since the new update is in the window). Fine.

But totals: totals are per-company aggregates across all orders. Rederivation of a window can't recompute totals for the whole company unless it rebuilds totals for affected companies. Approach: after rederiving rows for the window, recompute totals for all companies that have orders in the window (or have affected rows) from the source (full aggregate over all orders for those companies). That's exact. So rederivation:
1. Determine companies affected: orders with `updated_at` in [from, to] → set of company ids. (Or all companies if window is huge.)
2. Delete projection rows? No — upsert projection rows for orders in window (current state).
3. For each affected company, recompute totals: `total = SUM(amount)`, `approved = SUM(amount where status='approved')`, etc., `count = COUNT(*)` over all source orders for that company, and set the totals row.

Idempotent: yes, recomputes from source, upserts from source.

Running while live: rederivation should take a snapshot… in Postgres, inside a single transaction with default READ COMMITTED, each statement sees a snapshot at statement start, which can be inconsistent. To be safe, rederivation runs inside one transaction. Within a single transaction at READ COMMITTED, different statements see different snapshots, so theoretically rows could move between the row-read and the totals-aggregate. To make it consistent, use REPEATABLE READ for the rederivation transaction. Prisma doesn't expose isolation level directly… Prisma supports `prisma.$transaction` with an interactive callback, but no isolation option. To set isolation level, we'd need a raw query inside the interactive transaction: `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ` — but only if nothing has been executed in that transaction. In an interactive transaction, Prisma may have already executed statements (BEGIN). Hmm, does Prisma's interactive transaction just issue BEGIN? I believe it sends `BEGIN` and then the callback executes queries. If we immediately do `SELECT SET TRANSACTION ISOLATION LEVEL REPEATABLE READ` as the first statement, it will work because no query has been run yet. That's a known trick. But it's fragile.

Alternatively, don't over-engineer: the requirement is "safe to run while the system is live, and running it twice on the same window must leave the same result". Idempotency is the strict requirement. Live-safety = doesn't break live writes, and eventually consistent. With READ COMMITTED, a concurrent write during rederivation could result in that order being reflected partially (row upserted before its status change but totals computed after, or vice versa). Since rederivation is a repair mechanism, a small race is acceptable and subsequent drift repair or a re-run fixes it. But I can note that we use REPEATABLE READ via the first raw statement. Hmm, actually there's a subtlety: Prisma interactive transaction — the callback receives a PrismaClient with a bound transaction. Does Prisma issue `BEGIN` immediately on `$transaction` call? I believe it does (starts a connection from the pool, BEGIN, run callback, COMMIT). So the first raw query can be `SELECT 1 AS x FROM ...`? No — `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ` must be the first statement in the transaction. If Prisma issued `BEGIN` (a transaction control command), `SET TRANSACTION ISOLATION LEVEL` is allowed after BEGIN as long as no data statements have run. `BEGIN` doesn't count as a data statement. So `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ` right after `BEGIN` works in Postgres.

But wait — do I want to depend on this? I could implement rederivation with explicit raw SQL in a repository (the repository is the only layer that touches the DB). The layering rule: services hold the logic, repositories touch the DB. Zero Prisma client calls in the service. So the rederivation repository methods can be raw SQL via `prisma.$executeRaw` / `$queryRaw` inside an interactive transaction.

Hmm, but the tests: Vitest with Postgres? Tests need a real Postgres to prove concurrency. We can't spin up a Postgres in a test environment that doesn't exist. Standard approach for tasks like this: tests run against a real database via `DATABASE_URL` env (env convention: "Config comes only from environment variables. `DATABASE_URL` for Postgres"). So tests use `PrismaClient` with `process.env.DATABASE_URL` and skip/`describe.skipIf(!process.env.DATABASE_URL)` if absent? The convention is config comes from environment variables only, DATABASE_URL for Postgres. Let me write tests that assume Postgres is available at DATABASE_URL, but if DATABASE_URL is missing, gracefully skip (it's a practical choice, mark it as an assumption). Actually, "test the behavior, not the implementation" — tests should drive services (approve order → query dashboard) rather than poking the DB directly. But concurrent totals test: two concurrent approvals for the same company → totals exact. Drive the service with `Promise.all([svc.approve(id1), svc.approve(id2)])`. Then assert totals row = expected. That's behavioral.

Read-your-own-writes: create/approve an order, immediately call the dashboard query, assert the row is reflected.

Drift repair: inject drift (directly update projection row via raw query — that's test setup, not implementation), run repair job, assert the projection matches source.

Test DB setup: need migrations applied. Since we ship a migration (raw SQL), tests can apply it via `prisma.$executeRaw` on the migration SQL, or use `prisma migrate deploy`. To be self-contained, I could put the DDL in the migration file and have tests execute that same file? But I have no filesystem access in tests… tests do run in the repo. Can read the migration file? That couples. Alternative: tests run `prisma migrate deploy`? Can't spawn processes… well, tests can use child_process, but the environment convention says no shell? No, that's about me, not about the code. Hmm, but spawning `prisma migrate deploy` in tests is fragile.

Cleaner: put the DDL for the projection in a `prisma/migrations/.../migration.sql` file (real Prisma migration), and also generate the projection models in `schema.prisma`. In tests, apply the schema with `prisma db push`? Also needs a process.

Options: in test setup, read the migration SQL file from disk and execute it idempotently with `CREATE TABLE IF NOT EXISTS`-style DDL? Real migrations use plain `CREATE TABLE`. For tests, I can just write the DDL to be idempotent in the test helper: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`. But the migration file should also be proper. Hmm.

Actually, cleanest test setup: a `test/helpers/db.ts` that runs `CREATE SCHEMA IF NOT EXISTS ...`? No.

Let me think about what's typical in these evaluation tasks: they ship `prisma/schema.prisma`, a hand-written migration SQL, and tests that ensure the schema via a helper that executes DDL idempotently (IF NOT EXISTS) — either duplicating DDL in the helper or reading the migration file. Duplicating DDL risks drift, but for a self-contained artifact it's acceptable. Or the test helper imports the migration file via `fs.readFileSync(path...)`? Relative resolution in ESM is a pain, but `import { readFileSync } from 'node:fs'` and a `fileURLToPath`-based path would work. That's actually elegant: single source of truth = the migration file. But then the migration file must be idempotent (`IF NOT EXISTS`). Real Prisma migrations aren't idempotent, but `migrate deploy` only runs them once (tracked in `_prisma_migrations`). Making them idempotent is harmless and helps tests. Hmm, though purists might frown. I think it's defensible: I'll write the migration with `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` so it's safe to apply repeatedly, and the test helper reads the migration file and applies it via `$executeRawUnsafe`. That's a single source of truth.

Wait, but the migration also has to include the source tables (Company, Worker, Event, PaymentOrder) and the projection tables. Since this is a "whole solution in one reply" repo, the schema.prisma is the entire schema, and I ship one initial migration (or multiple). Let me ship one initial migration that creates everything: companies, workers, events, payment_orders, ops_rows (projection), company_totals. Hmm, but in reality the source tables already exist ("~3M orders"). In this exercise I need them. One migration file `20240101000000_init/migration.sql` containing all tables + indexes. Good.

Test setup: `test/setup.ts` (or vitest globalSetup) — connect with PrismaClient, run migration SQL (idempotent), drop tables between test files? Simpler: each spec file truncates tables in a `beforeAll`/`beforeEach`. For concurrency tests and drift tests, truncating per test file (beforeAll) and before each test might be good. Let me do a helper `resetDb(prisma)` that truncates all tables with cascade, called in each `beforeEach`. That's clean and isolates tests.

Now the app structure:

```
prisma/schema.prisma
prisma/migrations/20240101000000_init/migration.sql
src/main.ts
src/app.module.ts
src/prisma/prisma.module.ts        (global module that provides PrismaService)
src/prisma/prisma.service.ts
src/companies/companies.service.ts? — need a seed of company/worker/event? "simulate the write path" — write services for orders: create, approve, reject, (maybe cancel/delete). Let me make:
src/orders/order.controller.ts    (REST: POST /orders, POST /orders/:id/approve, POST /orders/:id/reject)
src/orders/order.service.ts
src/orders/order.repository.ts
src/orders/order.module.ts
src/operations/operations.controller.ts (GET /operations?companyId=&status=&from=&to=&page=&pageSize=)
src/operations/operations.service.ts
src/operations/operations.repository.ts
src/operations/operations.module.ts
src/projection/projection.module.ts
src/projection/projection.service.ts    (maintenance hooks: applyOrderCreated, applyOrderStatusChanged, applyOrderDeleted; rederiveWindow)
src/projection/projection.repository.ts (raw SQL upserts, increments)
src/drift-repair/drift-repair.module.ts
src/drift-repair/drift-repair.service.ts (compare + repair; scheduled via @nestjs/schedule or a manual runner)
DESIGN.md
test/orders.spec.ts (read-your-own-writes)
test/concurrency.spec.ts (concurrent total)
test/drift-repair.spec.ts
test/operations.spec.ts? (pagination/filter behavior — not required but "test the behavior… tests that only cover happy path are worse than no tests" — the required tests are the three. Adding a filter/sort test for the dashboard query is reasonable behavior testing, not gold-plating. Hmm, "do exactly what the task asks. Don't create files it doesn't ask for". Required tests: read-your-own-writes, concurrent total, drift repair. I'll stick with three spec files (read-your-own-writes can also live in the orders spec… actually read-your-own-writes is about the dashboard reflecting writes — test/approval.spec.ts? Let me do:
- test/read-your-own-writes.spec.ts
- test/concurrent-totals.spec.ts
- test/drift-repair.spec.ts
That maps 1-to-1 to the required tests.

Wait, but should I also test that the dashboard doesn't touch source? "Dashboard queries touch projections only" — hard to test without introspection. I could assert in operations.spec that the query uses only the projection, but… skip. The drift-repair + projection design covers it. I'll keep to three spec files.

package.json too? The repo needs package.json, tsconfig.json, vitest.config.ts to be buildable. The task says "build the entire solution in one reply… deliver every file the solution needs". The solution needs package.json (deps: @nestjs/common, @nestjs/core, @nestjs/platform-express, @nestjs/schedule, @prisma/client, prisma, pg? (Prisma uses its own engine), rxjs, reflect-metadata; dev: typescript, vitest, @types/node, @types/express). And tsconfig.json, vitest.config.ts. The layout convention shows specific files. Adding config files is necessary for the solution to work. I think it's justified: "deliver every file the solution needs, complete". Yes, include package.json, tsconfig.json, vitest.config.ts.

ESM `"type": "module"` — NestJS with ESM is finicky (needs `tsconfig` module: NodeNext, `experimental-specifier-resolution`?). Node 20+ ESM with NestJS: NestJS supports ESM since v10 with caveats (import extensions? not required if compiled with tsc). To run tests with Vitest, Vitest handles TS + ESM fine regardless of Nest decorators via `esbuild`. For the app runtime (`src/main.ts`), NestJS ESM works if tsconfig has `module: "NodeNext"` / `moduleResolution: "NodeNext"` and you compile and run with node. Imports without extensions would fail under strict NodeNext ESM? With NodeNext, TypeScript requires `.js` extension on relative imports for ESM output… Actually, with `"module": "nodenext"`, relative imports need file extensions. That's painful. Alternative: Vitest runs everything, and for the app we can document `ts-node`/`tsx`? Many NestJS ESM setups just use `module: "commonjs"`… but the convention says ESM, `"type": "module"`.

Practical resolution: use `"module": "nodenext", "moduleResolution": "nodenext"` and write relative imports with `.js` extensions? That's ugly, but correct ESM. Or use `tsx` to run main.ts directly (tsx resolves extensionless). Vitest handles extensionless TS imports fine. Let me use `tsx` as the runtime for the API (`"start": "tsx src/main.ts"`), and `module: "ESNext"`, `moduleResolution: "Bundler"` in tsconfig? Hmm, tsx with `module: "ESNext"`… tsx uses esbuild. Extensionless imports in ESM context: tsx patches module resolution to allow extensionless. Actually, does `tsx` run in a Node ESM mode where extensionless relative imports fail? Let me recall: tsx uses esbuild + a custom loader that supports TypeScript-style resolution including extensionless imports. Yes, tsx supports extensionless relative imports (it resolves like ts-node). I'm fairly confident tsx handles this.

For tests: Vitest resolves TS with its own resolver, extensionless fine.

I'll avoid deep claims. package.json scripts: `"start": "tsx src/main.ts"`, `"test": "vitest run"`, `"migrate": "prisma migrate deploy"`, `"generate": "prisma generate"`.

Now layering:
- Controller: validate input, call service. Zero business logic.
- Service: logic. Zero Prisma client calls. So the order.service calls order.repository (for source writes) and projection.service (for hooks). The operations.service calls operations.repository (for the dashboard query) — wait, "zero Prisma client calls in service", but can the service call the repository? Yes: "repository is the only layer that touches the database". Service calls repository. Good.

- Projection maintenance: `projection.service.ts` with methods:
  - `onOrderCreated(order: {id, companyId, status, amountCents, occurredAt, workerName, eventName, createdAt})`
  - `onOrderStatusChanged({id, companyId, prevStatus, newStatus, amountCents, occurredAt, workerName, eventName})`
  - `onOrderDeleted({id, companyId, status, amountCents})`
  - `rederiveWindow(from: Date, to: Date): Promise<{rows: number, companies: number}>`
  Each uses projection.repository with `prisma.$transaction(async (tx) => ...)`? Wait — the hook must run "inside the transaction that writes the source row". So the write service opens the transaction: `order.service.approve()` does `this.orderRepository.withTransaction(async (tx) => { const updated = tx.updateOrder(...); await this.projectionService.applyStatusChange(tx, ...); })`. Hmm — the projection service needs the transaction handle to run inside the same transaction. So projection.service methods accept a `tx` (a Prisma transaction client) as a parameter? But then projection.service depends on the Prisma transaction type — that's a type-only import, fine. The repository methods take a `txOrClient` parameter: `prisma.$transaction` accepts a callback with a `Prisma.TransactionClient`. A service can orchestrate:

```ts
async approveOrder(id: string): Promise<PaymentOrder> {
  return this.orders.tx(async (tx) => { ... });
}
```

Better: order.repository exposes `withTransaction<T>(fn: (tx: PrismaTx) => Promise<T>): Promise<T>` implemented via `this.prisma.$transaction(fn)`. Order service:

```ts
async approve(id: string) {
  return this.repository.withTransaction(async (tx) => {
    const order = await this.repository.approve(tx, id);   // UPDATE payment_orders SET status='approved', updated_at=now()
    await this.projections.applyStatusChange(tx, { ... }); // same tx
    return order;
  });
}
```

This puts hook invocation inside the write transaction.

But wait: "the service holds the logic" — the service orchestrates the transaction via a repository helper. That's acceptable: the repository provides the primitive `withTransaction`. Logic (which hook to call, with what data) lives in the service. Good.

Alternatively, the projection service takes the tx and calls projection.repository methods with tx. Fine.

Types: define `Tx = Prisma.TransactionClient`. Import from `@prisma/client`.

Now, the write services need to read source data to pass to the hook. E.g., approve: need order's companyId, amount, prevStatus, worker/event names (for projection row upsert — but the projection row already exists, so the status change only needs id, company, prev→new status, amount for totals, occurredAt to update, and name for the row — actually the row upsert should re-set the row from the current source state. To avoid reading source for names, the status-change hook can just UPDATE the projection row's status/occurred_at without touching names (names only change via worker/event renames, which we don't simulate). But to be safe and idempotent-ish, let me re-derive the row from the source join inside the hook? That's a join inside the write tx — small (single row), fine, but adds raw SQL. Hmm.

Simpler: the hook only updates the fields that the write changes:
- create: INSERT INTO ops_rows (all fields) — service has all data (it created the order; worker/event names are read in the create flow — controller takes companyId, workerId, eventId? Let me define the order create payload: `{ companyId, workerId, eventId, amountCents }`. Service reads worker name + event name to store on the order? Wait — does the source order table store names? No. The original dashboard query joins events and workers for their names. Source: payment_orders has company_id, worker_id, event_id, status, amount_cents, created_at, updated_at. Dashboard selects order fields + event.name + worker.name. Projection denormalizes worker_name/event_name.

So on create, the hook needs the worker name and event name: the service reads them in the same tx (repository method `getWorkerName`, `getEventName` or a combined `getOrderContext`). That's a read, fine.

On status change: update ops_rows SET status, occurred_at (no name changes). On delete: delete the row.

But then drift from worker renames would never be fixed by the hook… Drift repair compares projection to source join and repairs. Rederivation rebuilds rows from the join. OK.

Actually wait — should I include worker rename as a write path? The spec says "simulate the write path" — the write path for orders (approval flow). The three required tests all relate to orders. I'll stick to order lifecycle (create, approve, reject) and maybe a "reopen"? Let me keep to create/approve/reject. Rejection from pending. Approval from pending. Allow `pending → approved | rejected`. Also `create` (insert). Delete — skip? "Cancel"… skip delete to narrow scope. Hmm, delete would complicate totals (negative increments) — not needed. Skip.

Now the dashboard query: GET /operations with query params companyId (required? "filter by company, status, date range" — probably all optional filters. Company might be required for the covering index to be effective. Let me make companyId optional, but the index leading with company_id… If company is not specified, the index isn't optimal. The dashboard is for a specific company (a back-office for a company operator?). "Filter by company" suggests the filter is a company filter. Let me make companyId required (validation). Status optional (one of pending/approved/rejected), from/to optional ISO dates, page (1-based, default 1), pageSize (default 20, max 100).

Response: `{ items: [...], page, pageSize, total? }`. Total count: `COUNT(*)` with the same filter — another index-only scan. Include `total` (useful for pagination) — but "same columns, same filters, same order, same page sizes" refers to the original. The original probably had a count. I'll include total via a second query with the same filter. Both index-only. Fine.

Items fields: id, companyId, status, amountCents, occurredAt, workerName, eventName, createdAt. "Same columns" as the join query: order id, status, amount, event name, worker name, timestamps. Good.

Repository for operations: raw SQL or Prisma query? "The dashboard query reads only the projection" — Prisma `opsRow.findMany({ where: {...}, orderBy: { occurredAt: 'desc', id: 'desc' }, skip, take })` reads only the projection. That's clean, and the index `(company_id, status, occurred_at DESC, id DESC)` matches. Prisma will generate the query. The index handles it. Use Prisma query for the dashboard (typed) — but hmm, a covering index with INCLUDE for index-only scans: `(company_id, status, occurred_at DESC, id DESC) INCLUDE (amount_cents, worker_name, event_name, created_at)`. In the migration, I write:

```sql
CREATE INDEX CONCURRENTLY? No, in a migration plain:
CREATE INDEX IF NOT EXISTS idx_ops_rows_lookup
  ON ops_rows (company_id, status, occurred_at DESC, id DESC)
  INCLUDE (amount_cents, worker_name, event_name, created_at);
```

Wait, `id` is PK. Including it as the last key column is fine.

Prisma orderBy: `occurredAt: 'desc'` matches `occurred_at DESC`. Add `id: 'desc'` as tie-breaker for stable pagination (deterministic order). Good.

Now the projection repository raw SQL:

- `upsertOpRow(tx, row)`:
```sql
INSERT INTO ops_rows (id, company_id, status, amount_cents, occurred_at, worker_name, event_name, created_at, updated_at)
VALUES ($1,...)
ON CONFLICT (id) DO UPDATE
  SET status = EXCLUDED.status,
      amount_cents = EXCLUDED.amount_cents,
      occurred_at = EXCLUDED.occurred_at,
      worker_name = COALESCE(EXCLUDED.worker_name, ops_rows.worker_name),
      event_name = COALESCE(EXCLUDED.event_name, ops_rows.event_name),
      updated_at = EXCLUDED.updated_at;
```
Hmm — for status changes I said only update status/occurred_at. Using a full upsert with COALESCE for names is more robust (also handles redelivery). Let me make a single `upsertOpRow` that always sets status, amount, occurred_at, and names if provided. Create hook passes names; status hook passes names = undefined → COALESCE keeps existing. But COALESCE in DO UPDATE: `worker_name = COALESCE(EXCLUDED.worker_name, ops_rows.worker_name)` — if EXCLUDED is NULL, keep the old.

- `applyTotalDelta(tx, companyId, {totalDelta, approvedDelta, rejectedDelta, countDelta})`:
```sql
INSERT INTO company_totals (company_id, total_cents, approved_cents, rejected_cents, order_count)
VALUES ($1,$2,$3,$4,$5)
ON CONFLICT (company_id) DO UPDATE SET
  total_cents = company_totals.total_cents + EXCLUDED.total_cents,
  approved_cents = company_totals.approved_cents + EXCLUDED.approved_cents,
  rejected_cents = company_totals.rejected_cents + EXCLUDED.rejected_cents,
  order_count = company_totals.order_count + EXCLUDED.order_count;
```
Atomic in-place increment.

- Rederivation (in a tx):
```sql
-- companies affected
SELECT DISTINCT company_id FROM payment_orders WHERE updated_at >= $1 AND updated_at < $2;
```
Then for each company (or all at once):
```sql
-- rebuild rows for the window
INSERT INTO ops_rows (...)
SELECT po.id, po.company_id, po.status, po.amount_cents, po.updated_at, w.name, e.name, po.created_at, po.updated_at
FROM payment_orders po
LEFT JOIN workers w ON w.id = po.worker_id
LEFT JOIN events e ON e.id = po.event_id
WHERE po.updated_at >= $1 AND po.updated_at < $2
ON CONFLICT (id) DO UPDATE SET ...;
```
And totals:
```sql
INSERT INTO company_totals (company_id, total_cents, approved_cents, rejected_cents, order_count)
SELECT company_id, COALESCE(SUM(amount_cents),0), COALESCE(SUM(amount_cents) FILTER (WHERE status='approved'),0), ..., COUNT(*)
FROM payment_orders
WHERE company_id = ANY($1)
GROUP BY company_id
ON CONFLICT (company_id) DO UPDATE SET total_cents = EXCLUDED.total_cents, ... (SET, not increment);
```
Note: this sets the totals to the exact aggregate — replacing any drifted totals for affected companies.

Edge: companies with zero orders in the window but previously with orders — not affected, fine. Companies in the window are exactly those with orders in the window. If a company's only orders are in the window and they… well fine, GROUP BY returns that company with its full aggregate (across all its orders, not just the window) — correct.

`occurred_at` = `po.updated_at`? I decided projection.occurredAt mirrors source updated_at. Wait, hmm: "sort by recency" — recency of the operation. If an order is created and stays pending, its recency = created time? updated_at = created_at initially. When approved, updated_at moves. Dashboard sorts by recency — latest changes first. That's a reasonable interpretation of the "operations" list (recent activity). And date range filter "date range" = activity within range. I'll document: `occurred_at` = the time the order entered its current state (source `updated_at`). Rederivation window is keyed on source `updated_at`. Consistent.

Hmm wait, one subtlety in drift repair: "periodically compare the projection against source for a recent window and repair mismatches". Drift repair implementation:
1. Window = [now - lookback, now].
2. For orders in the window (by updated_at): recompute the expected projection row (source join) and compare with the stored row (status, amount_cents, occurred_at, worker_name, event_name). Collect ids of mismatches.
3. For companies of mismatched orders (and, for safety, all companies of orders in the window? Totals drift could happen on any company in the window): recompute exact totals from source for affected companies and overwrite.
4. Upsert the corrected rows.

Simpler and more robust implementation: drift repair = "find drift; repair by rederiving the window". Compare: one SQL that does `NOT EXISTS`/mismatch detection, returning mismatched company ids; then run the rederivation routine on the window (which rebuilds rows + totals exactly). "Find and fix" — find: return a report of what was drifted (count / ids); fix: rederive the window. The rederivation IS the fix, and idempotent. This satisfies "the repair job finds and fixes". The test: inject drift (mutate a projection row + totals directly via raw SQL), run the repair job, assert projection matches source and totals are exact.

But should repair only touch drifted things? Rederiving the window touches the rows of every order in the window — acceptable (idempotent). Or, repair only mismatched rows + affected companies' totals. Let me do: detect mismatched ids with a single SQL; if none, no-op; if any, rederive the window. That's clean: the detection is the "find", the rederivation is the "fix", and the routine reports the drift found.

Detection SQL:
```sql
SELECT po.id, po.company_id
FROM payment_orders po
LEFT JOIN workers w ON w.id = po.worker_id
LEFT JOIN events e ON e.id = po.event_id
WHERE po.updated_at >= $1 AND po.updated_at < $2
  AND NOT EXISTS (
    SELECT 1 FROM ops_rows r WHERE r.id = po.id
      AND r.company_id = po.company_id
      AND r.status = po.status
      AND r.amount_cents = po.amount_cents
      AND r.occurred_at = po.updated_at
      AND r.worker_name IS NOT DISTINCT FROM w.name
      AND r.event_name IS NOT DISTINCT FROM e.name
  )
```
This also catches missing rows (NOT EXISTS is true when the row is absent) and stale rows (row exists but differs). Orphan projection rows (source deleted) aren't caught, but we don't delete orders. Fine. Note `worker_name IS NOT DISTINCT FROM w.name` handles NULL.

Hmm, `occurred_at = po.updated_at` — but in my hook, occurred_at is set from the service's `new Date()` at write time, whereas source updated_at is set by the DB `DEFAULT now()` or by the service setting it? If the service sets `updated_at` explicitly to the same value in the UPDATE, then they match. In my order repository, the update sets `updated_at` to the same value the hook uses — the service generates `now = new Date()` and passes it to both the source update and the hook. Then they're identical. In rederivation, `occurred_at := po.updated_at`. So equality holds.

Now totals drift detection: comparing totals to source aggregates for companies in the window:
```sql
SELECT t.company_id
FROM company_totals t
WHERE t.company_id = ANY($1)
  AND NOT EXISTS (
    SELECT 1 FROM (
      SELECT company_id, COALESCE(SUM(amount_cents),0) total, ... 
      FROM payment_orders GROUP BY company_id
    ) s WHERE s.company_id = t.company_id
      AND s.total = t.total_cents AND ...
  )
```
Plus companies in the window with no totals row (missing). I could fold totals drift into the same "find" step and have the fix cover any company with row drift or totals drift. Actually, the simplest correct thing: the fix rederives the window (rows for orders in window + totals for companies in window). If any drift detected (rows or totals), execute the fix. Let me do both detections.

Hmm, let me keep the drift-repair service simple:

```ts
async repairWindow(from, to): Promise<DriftReport> {
  const { driftedOrderIds, driftedCompanyIds } = await this.repo.findDrift(tx?, from, to); // read-only
  if empty → return { driftedOrders: 0, ... , repaired: false }
  const result = await this.projections.rederiveWindow(from, to); // fix
  return {...}
}
```

Wait, but the totals drift for companies in the window: even if only totals drift (no row drift), findDrift must report it. Let me have findDrift return `driftedOrderIds: string[]` and `driftedTotalsCompanyIds: string[]`.

Actually, let me simplify: drift repair =
1. `findDrift(from,to)` → { missingOrStaleOrders: count + sample ids, driftedCompanies: string[] (from row drift ∪ totals drift) }
2. If nothing → done.
3. Else `rederiveWindow(from,to)` → rebuilt count.

Report: `{ window: {from,to}, driftedOrders: n, driftedCompanies: m, repairedRows: k }`.

Scheduled: `@nestjs/schedule` `@Cron(CronExpression.EVERY_5_MINUTES)` or `@Interval(ms)` in the drift-repair service. Config from env: `DRIFT_REPAIR_INTERVAL_MS`, `DRIFT_REPAIR_LOOKBACK_HOURS`? Convention: "config only from environment variables" — so interval/lookback come from env with defaults. I'll use `@Cron`? Better `@Interval` with env ms. `@nestjs/schedule` provides SchedulerModule. `@Interval(() => process.env.DRIFT_REPAIR_INTERVAL_MS ? Number(...) : 300_000)`. Hmm, `@Interval` takes a number evaluated at decoration time — env is loaded at decoration time, fine.

Lookback: env `DRIFT_REPAIR_LOOKBACK_HOURS` default 24.

Now, `PrismaService` and module wiring:

```
src/prisma/prisma.module.ts  → Global module, provides+exports PrismaService
src/prisma/prisma.service.ts → extends PrismaClient, onModuleInit $connect, onModuleDestroy $disconnect
```

Order module: providers OrderController, OrderService, OrderRepository; imports none (Prisma is global).

Projection module: providers ProjectionService, ProjectionRepository; exports ProjectionService.

Operations module: providers OperationsController, OperationsService, OperationsRepository; no import needed (reads ops_rows via Prisma directly through the repository).

Orders module imports ProjectionModule (to use ProjectionService).

Drift-repair module: providers DriftRepairService; imports ProjectionModule (uses rederiveWindow) and its own repository. Exports DriftRepairService? Not needed by others. But tests need to call the service — tests instantiate services directly? Tests "test the behavior": instantiate app modules, or instantiate services directly with the repositories? Nest tests: use `Test.createTestingModule` (requires @nestjs/testing dep) or manually wire: `new OrderService(new OrderRepository(prisma), new ProjectionService(new ProjectionRepository(prisma)))`. Manual wiring avoids @nestjs/testing dep and is simple and transparent. Hmm — "test the behavior, not the implementation": calling the service methods with a real Prisma client = behavior (DB-backed). I prefer explicit constructor wiring in the test helper:

```ts
function buildServices(prisma: PrismaClient) {
  const projectionRepo = new ProjectionRepository(prisma);
  const projectionService = new ProjectionService(projectionRepo);
  const orderRepo = new OrderRepository(prisma);
  const orderService = new OrderService(orderRepo, projectionService);
  const opsRepo = new OperationsRepository(prisma);
  const opsService = new OperationsService(opsRepo);
  const driftRepo = new DriftRepairRepository(prisma);
  const driftService = new DriftRepairService(driftRepo, projectionService);
  return { ... };
}
```

That's clean, no extra deps. But is that "implementation"? Testing service behavior against a real DB is the behavior. Yes.

Now the repository signature: repositories take `PrismaService` (or `PrismaClient`). Should repositories type the dependency as `PrismaService` or as `PrismaClient`? If I type as `PrismaService`, tests pass `PrismaService` instance (which extends PrismaClient) — or a raw PrismaClient isn't assignable to PrismaService. Simpler: repositories accept `PrismaClient` (from @prisma/client). PrismaService extends PrismaClient so it's assignable. And transactions: `Prisma.TransactionClient`.

Order repository methods:
- `withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>` → `this.prisma.$transaction(fn)`.
- `createOrder(tx, data: {id, companyId, workerId, eventId, amountCents, status, occurredAt})` → insert with created_at=updated_at=occurredAt.
- `approveOrder(tx, id, occurredAt)` → update to status='approved', updated_at=occurredAt, where status='pending' (guard: only pending can be approved; else throw Conflict). Return the updated row; throw NotFound if none.
- `rejectOrder(tx, id, occurredAt)` similarly.
- `getWorkerName(tx, id)`, `getEventName(tx, id)` — or a single `getOrderNames(tx, order)`. Let me do two small reads, or one query fetching both names? Two indexed point lookups are fine.
- `getCompany(tx, id)` for validation? Create needs the company to exist? FK enforces it. Controller validates shape; DB enforces existence. But a better error: repository `getCompany` → service throws 404 if not found. Hmm — "controller validates input" (shape), service logic: company existence check is business logic → service. Let me add repository methods `getCompany`, `getWorker`, `getEvent` returning the row or null. Service validates existence → 404 error envelope.

Wait — error envelope: `{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }`. NestJS's exception filters normally produce their own format. I should implement a global exception filter that maps HttpExceptions to the envelope with snake_case codes. That's part of "error — one envelope" convention. So: `src/common/exception.filter.ts` with `@Catch()` filter, mapping:
- NotFoundException → resource_not_found
- ConflictException → conflict
- BadRequestException/ValidationPipe error → validation_failed (with details)
- 500 → internal_error
Register in main.ts via `app.useGlobalFilters(new EnvelopeExceptionFilter())`.

Hmm, but tests that call services directly get raw errors (service throws Nest's HttpException). Tests assert on thrown codes? Let me define my own error classes or throw Nest's HttpException with a message, and the filter maps status → code. In tests, service throws `NotFoundException('Order 123 was not found')` — test: `await expect(...).rejects.toMatchObject({ status: 404 })` or use `getStatus()`. To be behavior-oriented, I can also test through the app… let me keep tests at the service level (with DB) and assert on the rejection with expected HTTP status + message. And also include a controller-level test? Not required. The envelope filter exists for the API. I could add a small test for the filter? Not requested. Skip — but wait, "a test that only covers the happy path is worse than no test" — that's about the three requested tests including negative cases (e.g., approving a non-existent order → 404). I'll include negative assertions in the three spec files (e.g., read-your-own-writes includes approving a non-existent order → error; drift repair includes a case of no drift → no-op; concurrency includes the sequence check too?). The three spec files each include error/negative cases.

Validation: controller uses `@Body() dto: CreateOrderDto` with class-validator? That adds a class-validator + class-transformer dep, and Nest's global ValidationPipe. "Controller validates input" — class-validator is the Nest way. Let me add class-validator, class-transformer and `app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))`. DTO: `CreateOrderDto { companyId: string, workerId: string, eventId: string, amountCents: number (IsInt, Min(1)) }`. Query DTO for operations: `ListOperationsQuery { companyId: IsString, status: IsIn([...]) optional, from/to: IsDateString optional, page: IsInt Min(1) default, pageSize: IsInt Min(1) Max(100) default 20 }`.

Amounts: integer cents to avoid float issues. Good for exact totals.

Now `occurredAt` for create: `new Date()` in the service.

Concurrency test details:
- Seed a company C, two pending orders O1, O2 (each $100 → 10_000 cents).
- `Promise.all([orderService.approveOrder('O1'), orderService.approveOrder('O2')])`.
- Assert company_totals: approved_cents = 20_000, total_cents = 20_000, order_count = 2.
- Also assert ops rows both approved.
- "Prove it in a test that runs the two concurrently rather than in a sequence" — Promise.all is concurrent. To be extra sure, I can loop a few rounds (say 3 pairs × N?) — each pair concurrent. Or 10 pairs (20 orders) in one Promise.all for stronger proof. Let me do: create 2*20 orders, approve all in parallel, assert approved total equals sum. Also assert no "lost update": total count = 40, approved = 20. Hmm, let me keep the numbers modest: 16 orders, 8 pairs… Let me do 20 concurrent approvals of different orders of the same company. All touch the same totals row → strong proof of atomicity. Each 5_000 cents → expected approved_cents 100_000.

But note: each approval is its own transaction (withTransaction per call). Concurrent transactions each doing `UPDATE ... SET approved_cents = approved_cents + EXCLUDED.approved_cents` via the ON CONFLICT DO UPDATE — atomic row-level updates serialized by the row lock. No lost updates.

Also read-your-own-writes:
- Create an order (via service) → immediately dashboard query → row is present with status pending, amount, names.
- Approve → immediate dashboard query → status approved, occurred_at updated, still same position/ordering.
- Also: approve → query with status filter 'approved' includes it; 'pending' excludes it.
- Negative: approve a non-existent id → rejects with 404, and dashboard is unchanged (projection never saw the rolled-back write — I can assert ops_rows is unchanged and totals unchanged).

Wait — the "if the write rolls back, the projection never saw it" requirement: my service: transaction wraps source update + projection hook. If the source update throws (e.g., guard `WHERE status='pending'` matches 0 rows → throws NotFound), the whole tx rolls back, including any projection writes (there are none before the throw). To demonstrate the rollback behavior in a test: e.g., double-approve an order: first approval succeeds; second → conflict (already approved) → tx rolls back → projection still shows approved once, totals count unchanged. That's a nice assertion: totals' order_count unchanged after failed double-approval. Let me include it.

Drift repair test:
- Seed: company, orders (some pending, some approved via service so projection+totals are consistent).
- Inject drift with raw SQL: update ops_rows for one order (status 'approved'→'pending'), delete another ops row? (missing row), and tamper with totals (approved_cents += 1).
- Run `driftService.repairNow()` (with a recent lookback covering the orders) → returns a report with drifted counts > 0.
- Assert: ops_rows matches source exactly (compare with a join), totals are exact.
- Also test no-drift case: run repair → report says 0 drift, and a no-op.

Timing: drift window lookback — orders' updated_at = now at seed; repair window [now - lookback, now]. If lookback is default 24h, fine. But the `to` boundary: `updated_at < now` — orders created just before the repair now() call: their updated_at < repair's now — fine, within the window. Let me have repair use `to = new Date()` computed at start, window `[to - lookback, to]`. Seeded orders' updated_at ≤ seed time < to. Good. But careful in tests: if I inject drift with a raw UPDATE on ops_rows (not source), the source updated_at doesn't change — still within the window. Good.

But one pitfall: rederivation window is on source `updated_at`; the drift I injected is on the projection side. The detection SQL compares source (window) vs projection — catches it. Good.

Now, a potential issue: the drift-repair detection `occurred_at = po.updated_at` comparison. In my hook I pass `occurredAt = new Date()` from the service to both source and projection in the same tx → equal. In rederivation, `occurred_at := po.updated_at`. Equal. Good.

Timestamps: Prisma DateTime precision — Postgres timestamptz is microseconds; JS Date is milliseconds; Prisma truncates to milliseconds on write? Prisma writes as `toISOString()` at ms precision. So source updated_at stored at ms precision; hook uses same Date → equal. Fine.

Now — Prisma schema. Models:

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql", url = env("DATABASE_URL") }

model Company {
  id    String @id @default(cuid()) @map("id")
  name  String @map("name")
  orders PaymentOrder[]
  totals CompanyTotal?
  @@map("companies")
}

model Worker {
  id      String @id @default(cuid()) @map("id")
  name    String
  orders  PaymentOrder[]
  @@map("workers")
}

model Event {
  id      String @id @default(cuid()) @map("id")
  title   String @map("title")
  orders  PaymentOrder[]
  @@map("events")
}
```

Wait "event" — the name of the model is `Event` (does it collide with DOM's Event in TS? In generated Prisma client, `Event` model is fine; TS lib.dom has a global Event but the import shadows it). I'll use `Event` model with `title` field. Hmm, actually, to reduce confusion, name it `Event` but import `Prisma.Event` where needed. Fine.

```prisma
model PaymentOrder {
  id          String   @id @default(cuid()) @map("id")
  companyId   String   @map("company_id")
  workerId    String?  @map("worker_id")
  eventId     String?  @map("event_id")
  status      OrderStatus @default(pending)
  amountCents BigInt   @map("amount_cents")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @default(now()) @updatedAt @map("updated_at")
  company     Company  @relation(fields: [companyId], references: [id])
  worker      Worker?  @relation(fields: [workerId], references: [id])
  event       Event?   @relation(fields: [eventId], references: [id])
  @@index([companyId, updatedAt])
  @@map("payment_orders")
}

enum OrderStatus { pending approved rejected }
```

Hmm — I want to explicitly set updated_at in the update (to the same value the hook uses). Prisma's `@updatedAt` auto-sets. If I explicitly set `updatedAt: now` in the update, does Prisma allow it? With `@updatedAt`, Prisma auto-overwrites with its own now on update — actually, does Prisma's `@updatedAt` set the field on update regardless of what you pass? I believe if the field has `@updatedAt`, Prisma sets it automatically and ignores/explicit values may error ("you cannot update a field with @updatedAt"? no — I think explicit set is allowed? I recall you can't explicitly set `@updatedAt` fields in create (error), but in update… actually, Prisma errors on explicit `@updatedAt` in create; in update you can pass it but it's ignored? Not sure.)

To avoid the uncertainty, don't use `@updatedAt`; manage `updated_at` explicitly in the repository's raw update? But then I'd use raw SQL in the order repository for the update… The order repository can use Prisma's `paymentOrder.update({ data: { status, updatedAt: now } })` without `@updatedAt` — I'll explicitly set updatedAt. That works: no `@updatedAt`, just `@default(now())`, and the service always passes an explicit `updatedAt`.

Hmm wait, but I said the order repository could use Prisma client (it's the repository layer — allowed: "repository is the only layer that touches the database"). Yes, the order repository uses Prisma typed API for source writes; the projection repository uses raw SQL (increment, rederivation). The operations repository uses Prisma typed API for the projection reads (or raw). Typed is nicer.

Actually, hmm, one design question: should the projection hook be in the same file/flow as the source write? "Maintenance hooks invoked from the write service" — yes: OrderService (write service) calls ProjectionService hook inside its own transaction.

Now `amount_cents` is BigInt: Prisma returns BigInt. In JSON responses, BigInt fails to serialize in Express/JSON — need to convert to number or string. Amounts in cents fit in Number (< 2^53) — convert with `Number(row.amountCents)` in service/controller mapper. In the DTO input, `amountCents: number` (validate with IsInt). Fine.

`occurred_at` = `po.updated_at`: define `occurredAt` on OpsRow with `@map("occurred_at")`. Prisma: `model OpsRow { ... occurredAt DateTime @map("occurred_at") ... }`.

OpsRow model:
```prisma
model OpsRow {
  id          String   @id @map("id")
  companyId   String   @map("company_id")
  status      OrderStatus
  amountCents BigInt   @map("amount_cents")
  occurredAt  DateTime @map("occurred_at")
  workerName  String?  @map("worker_name")
  eventName   String?  @map("event_name")
  createdAt   DateTime @map("created_at")
  updatedAt   DateTime @map("updated_at")
  @@index([companyId, status, occurredAt(sort: Desc), id(sort: Desc)]) // hmm, Prisma supports sort in indexes
  @@map("ops_rows")
}
```
Prisma's `@@index([... sort: Desc])` is supported (Prisma 4.16+). But I'm writing the migration by hand anyway (I need INCLUDE for covering, which Prisma's migration DDL can't express via the schema… actually Prisma now supports `@@index([...], type: ...)`? No INCLUDE support in schema.prisma). So: the schema.prisma declares the index (for consistency), the hand-written migration.sql creates the covering index with INCLUDE. But then `prisma migrate diff`/introspection mismatch? For this exercise, since the migration is hand-written and applied manually, it's fine. Hmm — risk: if someone runs `prisma migrate dev` it will detect the diff. Not my problem in this artifact; but to be safe, I'll keep the schema index declaration identical to the migration's (key columns), and the migration adds INCLUDE. Actually, to minimize mismatch noise, maybe I should not declare the covering index in schema.prisma and only have it in the migration? But then the schema is "incomplete". Convention: "all schema changes ship with a migration". The projection tables are new schema. Let me declare the index in the schema (key columns, descending), and the migration creates the same index plus INCLUDE columns. I think that's the most defensible.

Wait, actually — does Prisma 5's schema support `sort` inside `@@index`? Yes: `@@index([companyId, status, occurredAt(sort: Desc)], map: "idx_ops_rows_lookup")`. Good.

CompanyTotal model:
```prisma
model CompanyTotal {
  companyId     String @id @map("company_id")
  totalCents    BigInt @default(0) @map("total_cents")
  approvedCents BigInt @default(0) @map("approved_cents")
  rejectedCents BigInt @default(0) @map("rejected_cents")
  orderCount    Int    @default(0) @map("order_count")
  company       Company @relation(fields: [companyId], references: [id])
  @@map("company_totals")
}
```

Migration SQL (initial): create all tables, FKs, indexes:

```sql
CREATE TABLE "companies" ("id" TEXT PRIMARY KEY NOT NULL, "name" TEXT NOT NULL);
CREATE TABLE "workers" ("id" TEXT PRIMARY KEY NOT NULL, "name" TEXT NOT NULL);
CREATE TABLE "events" ("id" TEXT PRIMARY KEY NOT NULL, "title" TEXT NOT NULL);
CREATE TABLE "payment_orders" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "company_id" TEXT NOT NULL,
  "worker_id" TEXT,
  "event_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "amount_cents" BIGINT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_orders_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "payment_orders_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "payment_orders_company_updated_idx" ON "payment_orders" ("company_id", "updated_at");

CREATE TABLE "ops_rows" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "company_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "amount_cents" BIGINT NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "worker_name" TEXT,
  "event_name" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "idx_ops_rows_lookup" ON "ops_rows" ("company_id", "status", "occurred_at" DESC, "id" DESC)
  INCLUDE ("amount_cents", "worker_name", "event_name", "created_at");

CREATE TABLE "company_totals" (
  "company_id" TEXT PRIMARY KEY NOT NULL,
  "total_cents" BIGINT NOT NULL DEFAULT 0,
  "approved_cents" BIGINT NOT NULL DEFAULT 0,
  "rejected_cents" BIGINT NOT NULL DEFAULT 0,
  "order_count" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "company_totals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
```

TIMESTAMPTZ(3) — Prisma uses `TIMESTAMPTZ(3)` for DateTime. Yes, Prisma's migrations emit `TIMESTAMPTZ(3)`.

Test helper applying the migration: read the file `prisma/migrations/20240101000000_init/migration.sql` — but `CREATE TABLE` (without IF NOT EXISTS) fails on re-run. In tests, each run needs a fresh DB or idempotent DDL. Options: make the DDL idempotent (`IF NOT EXISTS`) — then the helper can apply it any time, and truncation between tests is via `TRUNCATE ... CASCADE`. Let me make the migration idempotent: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`. It's valid for Prisma migrate deploy (which runs it once anyway). I think this is the pragmatic choice, and I'll note in a comment that it's idempotent to be test-applicable. Hmm, would a strict reviewer object to IF NOT EXISTS in a migration? Some teams do exactly this for re-runnability. And the test helper will apply the DDL idempotently. Alternatively, the helper could drop and recreate everything: run `DROP TABLE IF EXISTS ... CASCADE` for all, then the migration. That preserves the purity of the migration (plain CREATE) while making the test self-contained. I like that better: the helper does `ensureSchema(prisma)`: drop tables in FK-safe order (or one statement with CASCADE), then execute the migration SQL. And `resetData(prisma)`: TRUNCATE all tables RESTART IDENTITY CASCADE (no identity cols, fine).

But reading the migration file in tests: path resolution. From the test file location, `path.resolve(__dirname, '../../prisma/migrations/20240101000000_init/migration.sql')`. In ESM: `import { fileURLToPath } from 'node:url'; const here = path.dirname(fileURLToPath(import.meta.url))`. Works in Vitest (which runs ESM-like transforms; `import.meta.url` is available). Alternatively `process.cwd()`-relative: if tests run from the repo root, `path.resolve(process.cwd(), 'prisma/migrations/...')` — vitest is typically run from the repo root. I'll use import.meta.url-based for robustness.

Hmm wait, is `readFileSync` + `$executeRawUnsafe(sql)` fine? The migration has multiple statements — does `$executeRawUnsafe` handle multiple statements in one call? Does Prisma's $executeRawUnsafe send via the pg driver — multiple statements in a single simple query work in pg (node-postgres supports multi-statement in a simple query). Does Prisma use `query()` with a tagged template for raw? For $executeRawUnsafe with a multi-statement string — I believe it works (it passes the string through to the driver as a single simple query). I've seen people apply migrations this way. To be even safer, I can split the SQL on `;` at the end of lines… fragile with semicolons in strings (I have none). Simpler: split statements and execute individually: `sql.split(/;\s*(?:\r?\n|$)/).filter(s => s.trim())`. My migration statements are plain (no DO blocks), so splitting on `;\n` is safe. Let me split and execute each statement.

Actually, hmm, `CREATE INDEX ... INCLUDE (...)` has no semicolons inside. Fine.

Now vitest.config.ts:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
```
DB-dependent: if no DATABASE_URL, tests should fail clearly? Or skip? The environment convention says config only from env — tests need Postgres via DATABASE_URL. If absent, `beforeAll` will fail on connect — the failure message is a connection error, acceptable. But for a kinder behavior, skip the suite with a message if no DATABASE_URL: `describe.skipIf(!process.env.DATABASE_URL)`. I'll add that with a comment. It's pragmatic; mark as an assumption? I'll note it in the file with a comment (not an ASSUMPTION marker — this is a design choice). Actually, the instructions say to mark things with ASSUMPTION comments when a symbol is truly missing and I'm using the most defensible reading. DATABASE_URL being required is convention; skipIf is a test-robustness choice. A regular comment suffices.

tsconfig.json:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "useDefineForClassFields": false,
    "declaration": false,
    "sourceMap": true,
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```
`useDefineForClassFields: false` — important for NestJS DI (constructor param decorators + property initialization). NestJS docs recommend `useDefineForClassFields: false` for ESM setups? For CJS, it's default false (target < ES2022? Actually, the default for `useDefineForClassFields` is true when target is ES2022+). NestJS needs constructor DI metadata; with `useDefineForClassFields: true`, class fields become `Object.defineProperty` semantics, and uninitialized fields shadow the DI-injected values… Known NestJS+ESM issue: set `useDefineForClassFields: false`. Yes, include it.

`moduleResolution: "Bundler"` — fine for Vitest; for runtime via tsx, tsx handles it. OK.

package.json:
```json
{
  "name": "marketplace-backoffice",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "tsx src/main.ts",
    "migrate": "prisma migrate deploy",
    "test": "vitest run"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.0",
    "@nestjs/core": "^10.3.0",
    "@nestjs/platform-express": "^10.3.0",
    "@nestjs/schedule": "^4.1.0",
    "@prisma/client": "^5.10.0",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "reflect-metadata": "^0.2.1",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "prisma": "^5.10.0",
    "tsx": "^4.7.0",
    "typescript": "^5.4.0",
    "vitest": "^1.4.0",
    "@types/node": "^20.11.0"
  }
}
```
Hmm, @nestjs/schedule v4 works with Nest 10. Good.

Now — ESM + NestJS DI with tsx: does Nest need `reflect-metadata` import in main.ts: `import 'reflect-metadata';`. Yes.

Also ESM Nest: decorators and `emitDecoratorMetadata` under tsx — tsx uses esbuild, which does not support emitDecoratorMetadata!! Critical: esbuild doesn't emit design:type metadata. NestJS relies on constructor parameter metadata (design:paramtypes) for DI. Without it, Nest can't resolve dependencies for classes with constructor injection → errors unless explicit `@Inject()` is used or the module can't resolve.

This is a real concern for running the app with tsx. But do tests run the Nest app? My tests wire services manually (no Nest DI). The app runtime (`src/main.ts`) uses Nest DI. With tsx (esbuild), the DI metadata is missing → Nest can't inject constructor params → crash.

Options:
1. Add explicit `@Inject()` decorators? esbuild supports decorator syntax but not metadata emission. Nest docs for ESM: "use `@Inject()` explicitly"? NestJS v10 ESM support: they recommend… let me recall the NestJS ESM docs (docs.nestjs.com/fundamentals/esm). Key points: NestJS supports ESM; you need to adjust tsconfig; and — critically — for DI, Nest uses Reflect.getMetadata('design:paramtypes'); esbuild doesn't emit it; but Nest can also resolve via explicit `@Inject(TOKEN)`. The Nest ESM docs actually say: constructor injection still works because… hmm. Let me think. Under swc/ts-node with proper config, metadata is emitted. Under esbuild, no. There's a known GitHub issue: "ESM support: design:paramtypes is not emitted by esbuild/webpack". The NestJS ESM docs (v10) mention using explicit `@Inject` for… actually, I recall the docs now say NestJS ESM works out of the box if you build with tsc (which emits metadata). For tsx/esbuild, you need the explicit injection token.

Hmm. But wait — my tests don't use Nest DI at all (manual wiring). Only the API runtime does. Since I deliver the API too (NestJS is in the stack, controllers exist), the runtime should work. Safest: add explicit `@Inject()` decorators for all constructor dependencies in controllers/services/repositories? Ugly but ESM-robust. Alternatively, use `@Injectable()` + explicit `@Inject(PrismaService)` etc.

Hmm, actually wait: does Nest really fail without design:paramtypes? `NestInjectable`… Nest's `getInstanceToken`… when it can't get paramtypes, it treats it as… for constructor injection, Nest does `Reflect.getMetadata('design:paramtypes', target)`. If undefined, it assumes no deps? I believe if metadata is missing and there's no @Inject, Nest logs "Nest can't resolve dependencies" — it can't tell the number of parameters at runtime (unless target.length is used?). Actually — there's a fallback: does Nest check `constructor.length`? No, I don't think so. I believe without metadata, Nest assumes zero dependencies and instantiates fine, but the injected services are undefined → later crash on use. Hmm, risky.

Decision: keep `@Injectable()` and add explicit `@Inject(...)` on each constructor parameter. Explicit @Inject makes DI deterministic regardless of metadata emission. Under esbuild, `@Inject(X)` decorators work (decorator calls are supported). That's the defensible ESM-safe pattern. I'll add explicit @Inject to all DI points.

Wait, but `emitDecoratorMetadata: true` in tsconfig + tsx: tsx ignores tsconfig's emitDecoratorMetadata (esbuild). Adding explicit @Inject makes it moot. For controllers, Nest resolves providers by token = class; explicit @Inject(ClassName) is fine.

Also `@nestjs/schedule`'s `@Cron`/`@Interval` — decorators fine.

Now, the global module PrismaModule: `@Global()` decorator. And the module wiring per the convention: "services, repositories, processors are enumerated in providers for their module; providers used by other modules are exportsed".

- AppModule imports: PrismaModule, OrdersModule, OperationsModule, ProjectionModule (needs to be imported for scheduling? DriftRepairModule imports ProjectionModule), DriftRepairModule, plus SchedulerModule.

DriftRepairModule: providers: [DriftRepairService, DriftRepairRepository], imports: [ProjectionModule], exports: [DriftRepairService].

OrdersModule: controllers: [OrdersController], providers: [OrderService, OrderRepository], imports: [ProjectionModule].

OperationsModule: controllers: [OperationsController], providers: [OperationsService, OperationsRepository].

ProjectionModule: providers: [ProjectionService, ProjectionRepository], exports: [ProjectionService]. (ProjectionRepository is used only by ProjectionService — no export needed.)

Now the files:

**src/prisma/prisma.service.ts**
```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> { await this.$connect(); }
  async onModuleDestroy(): Promise<void> { await this.$disconnect(); }
}
```
Hmm, with explicit @Inject: `@Inject()`? PrismaService has no constructor deps. Fine.

**src/prisma/prisma.module.ts**
```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
```

**src/common/exception.filter.ts**
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';

const CODES: Record<number, string> = {
  400: 'validation_failed',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'resource_not_found',
  409: 'conflict',
  500: 'internal_error',
};

@Catch()
export class EnvelopeExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let details: Record<string, unknown> = {};
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') message = body;
      else if (typeof body === 'object' && body !== null) {
        const b = body as Record<string, unknown>;
        message = typeof b.message === 'string' ? b.message : (Array.isArray(b.message) ? b.message.join('; ') : message);
        if (b.errors) details = { fields: b.errors }... 
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }
    const code = CODES[status] ?? 'internal_error';
    if (status >= 500) this.logger.error(...)
    response.status(status).json({ error: { code, message, details } });
  }
}
```
ValidationPipe's error: body = { statusCode: 400, message: string[], error: 'Bad Request' } → join messages; details: `{ fields: message[] }`? The convention says details is an object, never null. `details: {}` is fine.

Note: express's Response type — I need `@types/express` (comes with @nestjs/platform-express? platform-express depends on express; types: add `@types/express` as devDep). I'll add.

**src/main.ts**
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { EnvelopeExceptionFilter } from './common/exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new EnvelopeExceptionFilter());
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}
void bootstrap();
```

**app.module.ts**
```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { OrdersModule } from './orders/orders.module';
import { OperationsModule } from './operations/operations.module';
import { ProjectionModule } from './projection/projection.module';
import { DriftRepairModule } from './drift-repair/drift-repair.module';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, OrdersModule, OperationsModule, ProjectionModule, DriftRepairModule],
})
export class AppModule {}
```

**src/orders/order.repository.ts**
```ts
import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { OrderStatus, Prisma, Worker, Company, Event } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OrderRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn);
  }

  getCompany(tx: Prisma.TransactionClient, id: string) { return tx.company.findUnique({ where: { id } }); }
  getWorker(tx, id) { return tx.worker.findUnique({ where: { id } }); }
  getEvent(tx, id) { return tx.event.findUnique({ where: { id } }); }

  createOrder(tx, data: { id: string; companyId: string; workerId: string | null; eventId: string | null; amountCents: bigint; at: Date }): Promise<PaymentOrder> {
    return tx.paymentOrder.create({ data: { ... , status: 'pending', createdAt: at, updatedAt: at } });
  }

  approveOrder(tx, id, at: Date) {
    return tx.paymentOrder.update({ where: { id, status: 'pending' }, data: { status: 'approved', updatedAt: at } });
  }
```
Hmm — Prisma's `update` doesn't support a compound where with additional fields. To guard status, use `updateMany({ where: { id, status: 'pending' }, data })` and check count; if 0, fetch to distinguish not-found vs wrong-status. Let me implement:

```ts
async approveOrder(tx, id, at) {
  const res = await tx.paymentOrder.updateMany({ where: { id, status: 'pending' }, data: { status: 'approved', updatedAt: at } });
  if (res.count === 0) {
    const existing = await tx.paymentOrder.findUnique({ where: { id } });
    if (!existing) throw new Error('not-found'); // hmm — repository shouldn't throw Nest exceptions?
    throw new Error('invalid-transition');
  }
  return existing or refetch
}
```
Repository throwing plain Errors with sentinel codes is awkward. Alternative: the repository returns data, the service interprets:

```ts
async transition(tx, id, from: OrderStatus, to: OrderStatus, at): Promise<PaymentOrder | null> {
  const result = await tx.paymentOrder.updateMany({ where: { id, status: from }, data: { status: to, updatedAt: at } });
  if (result.count === 0) return null;
  return tx.paymentOrder.findUnique({ where: { id } }) as Promise<PaymentOrder>;
}
```
And `findById(tx, id)`. Service:
```ts
const order = await this.repository.transition(tx, id, 'pending', 'approved', now);
if (!order) {
  const existing = await this.repository.findById(tx, id);
  if (!existing) throw new NotFoundException(`Order ${id} does not exist`);
  throw new ConflictException(`Order ${id} is ${existing.status} and cannot be approved`);
}
```
Clean: repository = data access; service = logic.

Wait, but the hook needs prevStatus for the totals delta: prev = 'pending' is known. And the row update.

Order create: id generation — Prisma `@default(cuid())` or let the service generate with `randomUUID()`? Service can `crypto.randomUUID()`. Let me use `@default(cuid())` and have the repository create without id; return the created row (which has the id). Then the hook uses the returned row's id.

**src/orders/order.service.ts**
```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { ProjectionService } from '../projection/projection.service';
import { OrderRepository } from './order.repository';

@Injectable()
export class OrderService {
  constructor(
    @Inject(OrderRepository) private readonly orders: OrderRepository,
    @Inject(ProjectionService) private readonly projections: ProjectionService,
  ) {}

  async createOrder(input: { companyId: string; workerId?: string; eventId?: string; amountCents: number }) {
    return this.orders.withTransaction(async (tx) => {
      const company = await this.orders.getCompany(tx, input.companyId);
      if (!company) throw new NotFoundException(`Company ${input.companyId} does not exist`);
      let worker = null; let event = null;
      if (input.workerId) { worker = await this.orders.getWorker(tx, input.workerId); if (!worker) throw new NotFoundException(...); }
      if (input.eventId) { event = ...; }
      const at = new Date();
      const order = await this.orders.createOrder(tx, { companyId, workerId, eventId, amountCents: BigInt(input.amountCents), at });
      await this.projections.onOrderCreated(tx, { id: order.id, companyId, status: 'pending', amountCents, workerName: worker?.name ?? null, eventName: event?.title ?? null, occurredAt: at, createdAt: at });
      return order;
    });
  }

  async approveOrder(id: string) { return this.transition(id, 'approved', 'Approve'); }
  async rejectOrder(id: string) { return this.transition(id, 'rejected', 'Reject'); }

  private transition(id, to, verb) {
    return this.orders.withTransaction(async (tx) => {
      const at = new Date();
      const updated = await this.orders.transition(tx, id, 'pending', to, at);
      if (!updated) {
        const existing = await this.orders.findById(tx, id);
        if (!existing) throw new NotFoundException(`Order ${id} does not exist`);
        throw new ConflictException(`Order ${id} cannot be ${verb.toLowerCase()}d: it is ${existing.status}, not pending`);
      }
      await this.projections.onOrderStatusChanged(tx, { id, companyId: updated.companyId, fromStatus: 'pending', toStatus: to, amountCents: updated.amountCents, occurredAt: at });
      return updated;
    });
  }
}
```
Hmm "Approve"/"Reject" verb message — fine.

Wait: BigInt input: `BigInt(input.amountCents)` — validation ensures integer. amountCents is number → BigInt. The hook stores BigInt.

**Projection service** (`src/projection/projection.service.ts`):
```ts
@Injectable()
export class ProjectionService {
  constructor(@Inject(ProjectionRepository) private readonly repo: ProjectionRepository) {}

  onOrderCreated(tx, row: OpRowData): Promise<void> {
    return this.repo.upsertOpRow(tx, row);
  }

  onOrderStatusChanged(tx, d: { id; companyId; fromStatus; toStatus; amountCents; occurredAt }) {
    return this.repo.applyStatusChange(tx, d);
  }

  rederiveWindow(from: Date, to: Date): Promise<RederiveResult> {
    return this.repo.withTransaction(async (tx) => this.repo.rederiveWindow(tx, from, to));
  }
}
```
Hmm, the repository needs a `withTransaction` — the prisma.$transaction. Let me give the ProjectionRepository the same helper.

Actually, let me consolidate: a projection repository method:
- `upsertOpRow(tx, row)`: raw INSERT ... ON CONFLICT.
- `applyStatusChange(tx, d)`: two raw statements: UPDATE ops_rows SET status, occurred_at, updated_at WHERE id; and the totals delta via ON CONFLICT increment.

Totals delta for status change: fromStatus 'pending' → toStatus 'approved': approvedDelta += amount; rejectedDelta 0. For 'rejected': rejectedDelta += amount. Pending has no dedicated column (total includes pending). General formula:
```ts
function statusDelta(from, to, amount) {
  const d = { approved: 0n, rejected: 0n };
  if (from === 'approved') d.approved -= amount;
  if (from === 'rejected') d.rejected -= amount;
  if (to === 'approved') d.approved += amount;
  if (to === 'rejected') d.rejected += amount;
  return d;
}
```
Create (from none → pending): total += amount, count += 1, status-specific 0 (pending). But for future-proofing, use the same function with from=null. Let me make a single method `applyTotalsDelta(tx, companyId, { totalDelta, approvedDelta, rejectedDelta, countDelta })` and have the service compute the delta. Or the repository computes? The logic is in the service: the service computes the delta object; the repository just applies.

So ProjectionService:
```ts
onOrderCreated(tx, row) {
  return Promise.all? no — sequential:
  const deltas = { total: row.amountCents, approved: statusDelta('approved'?) ... }
```
Let me write it as:
```ts
const d = this.deltasFor(null, 'pending', row.amountCents, true /* created */);
```
Hmm, let me simplify: two public hooks each doing an explicit thing:

```ts
async onOrderCreated(tx: Tx, row: NewOrderRow): Promise<void> {
  await this.repo.upsertOpRow(tx, { ...row, workerName: row.workerName ?? null, eventName: row.eventName ?? null });
  await this.repo.applyTotalsDelta(tx, row.companyId, {
    totalDelta: row.amountCents,
    approvedDelta: 0n,
    rejectedDelta: 0n,
    countDelta: 1,
  });
}

async onOrderStatusChanged(tx: Tx, d: StatusChange): Promise<void> {
  await this.repo.updateOpRowStatus(tx, { id: d.id, status: d.toStatus, occurredAt: d.occurredAt, at: d.occurredAt });
  const delta = statusDelta(d.fromStatus, d.toStatus, d.amountCents);
  await this.repo.applyTotalsDelta(tx, d.companyId, { totalDelta: 0n, ...delta, countDelta: 0 });
}
```

`statusDelta(from, to, amount)`: approvedDelta = (to==='approved'? amount:0) - (from==='approved'? amount:0); rejected similarly.

And `rederiveWindow(from,to)`:
```ts
async rederiveWindow(from: Date, to: Date): Promise<RederiveResult> {
  return this.repo.withTransaction(async (tx) => {
    // optional: SET TRANSACTION REPEATABLE READ first
    await tx.$executeRaw`SELECT set_config('transaction.isolation', 'repeatable read', false)`; // hmm, no
```
The trick for setting isolation: the first statement must be `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`. But inside an interactive transaction, has Prisma already run any statements? The connection executes BEGIN. `SET TRANSACTION ISOLATION LEVEL ...` is permitted after BEGIN, before any data statement. If our first callback statement is that raw, it works. Let me do:
```ts
await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
```
Risk: if Prisma's interactive tx already ran a statement (it doesn't, I think — it just begins), this errors. I'm fairly confident it's safe. But is it worth it? The requirement: "must be safe to run while the system is live, and running it twice on the same window must leave the same result". Idempotency = same result when run twice. Live-safety = doesn't corrupt, doesn't block. Even with READ COMMITTED, rederivation is correct (upserts current source state; concurrent new writes after our read are reflected either in this run or in the next drift repair). A REPEATABLE READ snapshot makes the rebuild internally consistent — a nice property for "rebuild from a consistent point". Include it but guard with a try/catch? No — if it errors, rederivation breaks. Hmm.

Alternative: skip isolation management; note in DESIGN.md that rederivation runs inside a single transaction and each statement is idempotent; a concurrent in-flight write either fully lands in the rebuild or is caught by the next repair cycle. That's honest and avoids the fragile trick. But "safe to run while live" is explicitly required — the single-tx + idempotent statements is the safety argument. Let me include the SET TRANSACTION line with a comment; it's a standard Postgres idiom. Actually, let me verify the semantics once more: in Postgres, `SET TRANSACTION ISOLATION LEVEL` can be issued any time before the first query in a transaction. `BEGIN` is not a query. Prisma's interactive transaction: on start, it takes a connection and sends `BEGIN`. Then user statements. So our raw `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ` is the first statement after BEGIN → valid.

One more consideration: REPEATABLE READ + writes: if another tx commits a conflicting row version, our tx errors (serialization-like error on UPDATE conflict) — rederivation does INSERT..ON CONFLICT DO UPDATE and totals SET; under RR, a conflict (another tx updated a row we read/modified) → error "could not serialize access" → transaction abort → rederivation fails that run. For a background repair, failure → retry next cycle. Acceptable? It introduces a failure mode that wouldn't happen under READ COMMITTED (where row-level locking just serializes fine). Hmm. Under RR, `INSERT ON CONFLICT DO UPDATE` when another tx has already committed an update to that row → RR detects "updated row version does not match" → error. With frequent writes, rederivation could fail often. That's worse for "safe to run while live".

Decision: don't set REPEATABLE READ. Use default READ COMMITTED, single transaction, idempotent statements. Document in DESIGN.md: rebuild reads current committed state per statement; a concurrent write either lands in this rebuild or is reconciled by the next drift cycle; no partial state because statements are idempotent and keyed upserts. Wait, could a partial state exist? Say order X's row is upserted (status A), then totals are computed — if X's status changes to B between those two statements, the row says A (stale) and totals reflect B. That's a momentary inconsistency → fixed by the next drift repair (X's updated_at moves, still within lookback). Yes, document it.

Hmm, but the acceptance: "redrive a window → projection matches source; run twice → same result". In a quiet test environment (no concurrent writes), it's exact. Good.

Now the ProjectionRepository raw SQL. Prisma's `$executeRaw` with tagged templates and variables: for a raw tx client, `tx.$executeRaw\`...\``. BigInt as parameter: does Prisma raw support bigint params? $executeRaw params: string, number, boolean, Date, Json, Buffer, Decimal… BigInt? Prisma's $executeRaw doesn't natively support BigInt params (known limitation — need to pass as string or number). Amounts in cents fit in double up to 9e15 — safe for our test amounts. But for 3M orders × amounts, company totals could exceed 2^53? 3M orders × $1M (100_000_000 cents) = 3e14 cents < 9e15. Fine in practice; but passing BigInt as number param — precision loss for huge values. Alternative: pass amounts as strings and cast in SQL: `::bigint` — but the `$executeRaw` interpolation handles typing automatically; for a string param into a bigint column — will Postgres cast '123'::bigint in an arithmetic context? `total_cents + $2` with $2 as text → error (bigint + text). Need an explicit cast in SQL: `SET total_cents = total_cents + ($2::bigint)`. Hmm, `$executeRaw`'s tag escapes as a literal — `($2)` placeholder… I can write `($2)::bigint`? In tagged template, the variable is interpolated as a literal (Prisma inlines escaped values? no — $executeRaw uses a query with placeholders and params via the driver). Actually, Prisma's $executeRaw compiles the tag into SQL with `?`→`$n` placeholders and passes params. Casting a param: `($1)::bigint` works in Postgres (parenthesized placeholder cast). I've seen this pattern.

But simpler: use Number for cents in raw SQL everywhere (safe up to 2^53 cents ≈ $90 trillion — plenty), and Prisma's typed API handles BigInt for the source table. Mixing: source amount_cents is BigInt (Prisma typed). In raw queries, when we read totals/rows, the result comes back as BigInt from Prisma raw (pg driver returns int8 as string → Prisma parses to BigInt in $queryRaw; in $executeRaw, only row count is returned). When we pass amounts as Number in raw, no issue.

Decision: in raw SQL, treat amounts as number (with a comment: cents fit in int53 for our scale; source stores them as BIGINT). The hook receives `amountCents: number`. But the source order has BigInt from Prisma typed read… OrderService reads the order (BigInt amountCents) and passes to the hook → convert with `Number(order.amountCents)`. Fine. To keep types simple, the hook's type: `amountCents: number`.

Hmm, alternatively, pass BigInt via string: `($1)::bigint`. Let me just use number — with a comment. Actually wait — is Number really safe? Max reasonable: 3M orders, avg $500 (50_000 cents) → 1.5e11 cents total. Nowhere near 9e15. Safe. I'll comment.

Now the raw SQL statements:

upsertOpRow:
```sql
INSERT INTO ops_rows (id, company_id, status, amount_cents, occurred_at, worker_name, event_name, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (id) DO UPDATE SET
  company_id   = EXCLUDED.company_id,
  status       = EXCLUDED.status,
  amount_cents = EXCLUDED.amount_cents,
  occurred_at  = EXCLUDED.occurred_at,
  worker_name  = COALESCE(EXCLUDED.worker_name, ops_rows.worker_name),
  event_name   = COALESCE(EXCLUDED.event_name, ops_rows.event_name),
  updated_at   = EXCLUDED.updated_at;
```
Params: id, companyId, status, amountCents(number), occurredAt(Date), workerName, eventName, createdAt, updatedAt.

Hmm wait — on create, should I upsert (id conflict)? An id collision on create would be a bug; the upsert semantics make it idempotent (e.g., double-executed hook). Fine.

updateOpRowStatus:
```sql
UPDATE ops_rows SET status = $2, occurred_at = $3, updated_at = $3 WHERE id = $1;
```
(If the row is missing — shouldn't happen; drift repair catches it.)

applyTotalsDelta:
```sql
INSERT INTO company_totals (company_id, total_cents, approved_cents, rejected_cents, order_count)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (company_id) DO UPDATE SET
  total_cents    = company_totals.total_cents + EXCLUDED.total_cents,
  approved_cents = company_totals.approved_cents + EXCLUDED.approved_cents,
  rejected_cents = company_totals.rejected_cents + EXCLUDED.rejected_cents,
  order_count    = company_totals.order_count + EXCLUDED.order_count;
```

rederiveWindow (in a tx):
```sql
WITH affected AS (
  SELECT DISTINCT company_id FROM payment_orders WHERE updated_at >= $1 AND updated_at < $2
)
INSERT INTO ops_rows (id, company_id, status, amount_cents, occurred_at, worker_name, event_name, created_at, updated_at)
SELECT po.id, po.company_id, po.status, po.amount_cents, po.updated_at, w.name, e.title, po.created_at, po.updated_at
FROM payment_orders po
LEFT JOIN workers w ON w.id = po.worker_id
LEFT JOIN events e ON e.id = po.event_id
WHERE po.updated_at >= $1 AND po.updated_at < $2
ON CONFLICT (id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  status = EXCLUDED.status,
  amount_cents = EXCLUDED.amount_cents,
  occurred_at = EXCLUDED.occurred_at,
  worker_name = COALESCE(EXCLUDED.worker_name, ops_rows.worker_name),
  event_name = COALESCE(EXCLUDED.event_name, ops_rows.event_name),
  updated_at = EXCLUDED.updated_at
RETURNING id;
```
(COUNT via `RETURNING` length? $executeRaw returns the count of affected rows — with ON CONFLICT DO UPDATE, does it count rows updated or inserted? It returns the command tag count (rows inserted/updated). "Rows" = rows touched. Fine for reporting.)

Then totals:
```sql
INSERT INTO company_totals (company_id, total_cents, approved_cents, rejected_cents, order_count)
SELECT company_id,
       COALESCE(SUM(amount_cents), 0),
       COALESCE(SUM(amount_cents) FILTER (WHERE status = 'approved'), 0),
       COALESCE(SUM(amount_cents) FILTER (WHERE status = 'rejected'), 0),
       COUNT(*)
FROM payment_orders
WHERE company_id IN (SELECT company_id FROM payment_orders WHERE updated_at >= $1 AND updated_at < $2)
GROUP BY company_id
ON CONFLICT (company_id) DO UPDATE SET
  total_cents = EXCLUDED.total_cents,
  approved_cents = EXCLUDED.approved_cents,
  rejected_cents = EXCLUDED.rejected_cents,
  order_count = EXCLUDED.order_count;
```
Returns affected company count.

RederiveResult: { rowsRebuilt: number, companiesRecomputed: number }.

Hmm wait — SUM(amount_cents) is BIGINT; the insert into total_cents BIGINT is fine.

**OperationsRepository**:
```ts
listRows(params: { companyId: string; status?: string; from?: Date; to?: Date; skip: number; take: number }) {
  const where: Prisma.OpsRowWhereInput = { companyId: params.companyId };
  if (params.status) where.status = params.status as OrderStatus;
  if (params.from || params.to) where.occurredAt = {};
  if (params.from) where.occurredAt.gte = params.from;
  if (params.to) where.occurredAt.lt = params.to;
  return this.prisma.opsRow.findMany({ where, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], skip, take });
}
countRows(params) { return this.prisma.opsRow.count({ where }); }
getCompanyTotal(companyId) { return this.prisma.companyTotal.findUnique({ where: { companyId } }); }
```
Wait — should the dashboard also return the company totals? "Financial totals per company must be exact" — the dashboard shows the list, and presumably totals are used by finance (maybe shown on the dashboard header). The original query is a list query; totals are separate. The spec: "financial totals per company must be exact, not approximate" — that's a constraint on the design (why a totals table is maintained atomically). The dashboard endpoint returns the list; the totals are exposed via a separate endpoint? "Without changing what the operator sees" — what the operator sees = the list. Totals must exist and be exact (finance reconciles against them). I'll expose `GET /companies/:id/totals` to make the totals observable (and testable via the API). Is that a "file the task doesn't ask for"? It's part of "the new dashboard query" scope… hmm. The deliverables list: projection table, hooks, rederivation, drift repair, dashboard query, tests, DESIGN.md. A totals endpoint isn't listed. But the "per-company financial totals" must exist in the system to be meaningful; the concurrency test asserts on the totals row directly (via service/repository). A small totals endpoint in the operations controller? Or the operations service exposes `getCompanyTotals(companyId)`. It's justified as part of the dashboard (header totals) and it makes "financial totals" observable. I'll add it — minimal, in the same operations feature. Actually… "do exactly what the task asks. Don't create files it doesn't ask for". A totals endpoint isn't a new file (same controller/service/repository). I'll include it — it's part of the dashboard (totals shown to operator/finance).

**OperationsService**:
```ts
async listOperations(q: { companyId; status?; from?; to?; page; pageSize }): Promise<OpsPage> {
  const rows = await this.repo.listRows({...});
  const total = await this.repo.countRows({...});
  return {
    items: rows.map(r => ({ id: r.id, companyId: r.companyId, status: r.status, amountCents: Number(r.amountCents), occurredAt: r.occurredAt, workerName: r.workerName, eventName: r.eventName, createdAt: r.createdAt })),
    page: q.page, pageSize: q.pageSize, total,
  };
}
async getCompanyTotals(companyId) {
  const t = await this.repo.getCompanyTotal(companyId);
  return t ? { companyId, totalCents: Number(t.totalCents), approvedCents: ..., rejectedCents: ..., orderCount: t.orderCount } : { companyId, totalCents: 0, approvedCents: 0, rejectedCents: 0, orderCount: 0 };
}
```
Hmm — the service does mapping — that's logic, fine.

The controller's DTO validates query params. `page`/`pageSize` are optional with defaults (via class-validator's @Type + @IsOptional, or the service defaults). I'll do validation in the DTO: `@IsOptional() @IsInt() @Min(1) page?: number;` and the service defaults (page=1, pageSize=20, max 100 clamped in service? Validation max 100 in DTO: `@Max(100)`).

**DriftRepairRepository**:
```ts
findDrift(from: Date, to: Date): Promise<{ driftedOrderIds: string[]; driftedCompanyIds: string[] }>
```
SQL:
```sql
SELECT po.id, po.company_id
FROM payment_orders po
WHERE po.updated_at >= $1 AND po.updated_at < $2
  AND NOT EXISTS (
    SELECT 1 FROM ops_rows r
    WHERE r.id = po.id
      AND r.company_id = po.company_id
      AND r.status = po.status
      AND r.amount_cents = po.amount_cents
      AND r.occurred_at = po.updated_at
      AND r.worker_name IS NOT DISTINCT FROM (SELECT w.name FROM workers w WHERE w.id = po.worker_id)
      AND r.event_name IS NOT DISTINCT FROM (SELECT e.title FROM events e WHERE e.id = po.event_id)
  )
```
Wait: `r.worker_name IS NOT DISTINCT FROM (SELECT w.name ...)` — scalar subquery; if worker is NULL, subquery is NULL → NOT DISTINCT FROM handles. But `AND NOT EXISTS (... AND r.worker_name IS NOT DISTINCT FROM (SELECT ...))` — the inner EXISTS correlates per r; the subquery is po-correlated, fine.

Totals drift:
```sql
SELECT t.company_id
FROM company_totals t
WHERE t.company_id IN (SELECT DISTINCT company_id FROM payment_orders WHERE updated_at >= $1 AND updated_at < $2)
  AND NOT EXISTS (
    SELECT 1 FROM payment_orders po
    WHERE po.company_id = t.company_id
      AND COALESCE(SUM(po.amount_cents) OVER (PARTITION BY po.company_id)...)  -- no, aggregates can't do that
  )
```
Aggregates in EXISTS are awkward. Restructure: compute source aggregates in a CTE, then compare:
```sql
WITH src AS (
  SELECT company_id,
         COALESCE(SUM(amount_cents), 0) AS total,
         COALESCE(SUM(amount_cents) FILTER (WHERE status='approved'), 0) AS approved,
         COALESCE(SUM(amount_cents) FILTER (WHERE status='rejected'), 0) AS rejected,
         COUNT(*) AS cnt
  FROM payment_orders
  WHERE company_id IN (SELECT DISTINCT company_id FROM payment_orders WHERE updated_at >= $1 AND updated_at < $2)
  GROUP BY company_id
)
SELECT s.company_id
FROM src s
LEFT JOIN company_totals t ON t.company_id = s.company_id
WHERE t.total_cents IS DISTINCT FROM s.total
   OR t.approved_cents IS DISTINCT FROM s.approved
   OR t.rejected_cents IS DISTINCT FROM s.rejected
   OR t.order_count IS DISTINCT FROM s.cnt
```
(IS DISTINCT FROM with t.* NULL when row is missing → IS DISTINCT FROM non-null is true → missing row reported. `t.total_cents IS DISTINCT FROM s.total` — when t is missing, t.total_cents is NULL, s.total is a number → true. Good.)

findDrift returns a combined list of company ids (from row drift ∪ totals drift) and the count of drifted orders. Return as arrays via `$queryRaw`.

DriftRepairService:
```ts
@Interval(() => Number(process.env.DRIFT_REPAIR_INTERVAL_MS) || 300_000)
async runScheduled(): Promise<DriftReport> { return this.repairRecentWindow(); }

async repairRecentWindow(): Promise<DriftReport> {
  const to = new Date();
  const lookbackMs = Number(process.env.DRIFT_REPAIR_LOOKBACK_HOURS ?? 24) * 3_600_000;
  const from = new Date(to.getTime() - lookbackMs);
  return this.repairWindow(from, to);
}

async repairWindow(from: Date, to: Date): Promise<DriftReport> {
  const drift = await this.repo.findDrift(from, to);
  if (drift.driftedOrders.length === 0 && drift.driftedCompanies.length === 0) {
    return { from, to, driftedOrders: 0, driftedCompanies: 0, rowsRebuilt: 0, companiesRecomputed: 0, repaired: false };
  }
  const result = await this.projections.rederiveWindow(from, to);
  return { from, to, driftedOrders: drift.driftedOrders.length, driftedCompanies: drift.driftedCompanies.length, rowsRebuilt: result.rowsRebuilt, companiesRecomputed: result.companiesRecomputed, repaired: true };
}
```
`@Interval` — from @nestjs/schedule. The interval callback is evaluated at decoration time: `() => Number(process.env.X) || 300000`. OK.

Hmm — `@Interval` on a service method: SchedulerModule.forRoot() is required. Good.

Now tests.

**test/helpers/env or test/helpers/db.ts**:
```ts
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const hasDatabase = Boolean(process.env.DATABASE_URL);

export function createPrisma(): PrismaClient { return new PrismaClient(); }

export async function applyMigration(prisma: PrismaClient): Promise<void> {
  const sql = readFileSync(path.resolve(here, '../../prisma/migrations/20240101000000_init/migration.sql'), 'utf8');
  for (const statement of sql.split(';\n')) {  // hmm, careful
    const trimmed = statement.trim();
    if (trimmed) await prisma.$executeRawUnsafe(trimmed);
  }
}
```
Split on ';\n' — my migration file: each statement ends with `;` at end of line. Let me write the migration so that every statement ends with `;` followed by a newline. And no semicolons inside statements. For extra safety, split on /;\s*\r?\n/ and also handle the final.

ensureFreshSchema: drop all tables and apply migration:
```ts
export async function resetSchema(prisma): Promise<void> {
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ops_rows, company_totals, payment_orders, workers, events, companies CASCADE;`);
  await applyMigration(prisma);
}
export async function resetData(prisma): Promise<void> {
  await prisma.$executeRawUnsafe(`TRUNCATE ops_rows, company_totals, payment_orders, workers, events, companies;`);
}
```
Drop order doesn't matter with CASCADE.

**test/helpers/services.ts**:
```ts
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
...
export function buildServices(prisma: PrismaClient) {
  const prismaService = new PrismaService(); // extends PrismaClient — but a second connection?
```
Hmm — PrismaService extends PrismaClient; constructing it opens its own connection pool. In tests I can just use one PrismaClient. The repository type: I decided repositories accept PrismaService for DI, but that's annoying for tests. Alternative: repositories accept `PrismaClient` (base type) — Nest DI token is PrismaService; `@Inject(PrismaService)` with the parameter type as `PrismaClient` — DI resolves by token (PrismaService), and the instance is PrismaService (assignable to PrismaClient). Type the parameter as PrismaClient and the token as PrismaService:
```ts
constructor(@Inject(PrismaService) private readonly db: PrismaClient) {}
```
That works and tests pass a raw PrismaClient.

In tests:
```ts
const prisma = new PrismaClient();
const services = buildServices(prisma);
```
where buildServices constructs repositories with the same prisma. Single client — but interactive transactions `$transaction(fn)` on the same client: fine. But wait: concurrent test — 20 parallel `withTransaction` calls on one PrismaClient — fine (pool).

One gotcha: in the read-your-own-writes test, the service writes in a tx via the shared client; the dashboard reads via the same client — committed data is visible. Good.

Seed helper:
```ts
export async function seedCompanyWithOrders(prisma, { workers, events, orders }) — or inline per test.
```
Let me make a helper `createCompany(prisma)`, `createWorker`, `createEvent` that use the Prisma typed API (test setup — allowed; it's not the app's layer, it's test data). Or use the OrderService for orders (which also maintains the projection — good for the drift test: seed via service → consistent projection; then inject drift). Yes: seed orders through the OrderService (create + approve), so the projection is consistent via the real path.

**test/read-your-own-writes.spec.ts**:
```ts
describe.skipIf(!hasDatabase)('read your own writes', () => {
  let prisma: PrismaClient; let svc: ReturnType<typeof buildServices>;
  beforeAll(async () => { prisma = new PrismaClient(); await resetSchema(prisma); svc = buildServices(prisma); });
  beforeEach(async () => { await resetData(prisma); });
  afterAll(async () => { await prisma.$disconnect(); });

  it('shows a newly created order on the very next dashboard request', async () => {
    const { company, worker, event } = await seed...;
    const order = await svc.orders.createOrder({ companyId: company.id, workerId: worker.id, eventId: event.id, amountCents: 12345 });
    const page = await svc.operations.listOperations({ companyId: company.id, page: 1, pageSize: 20 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id: order.id, status: 'pending', amountCents: 12345, workerName: 'Wendy', eventName: 'Launch', occurredAt: ... });
  });

  it('shows an approval immediately, in both the list and the status filter', async () => {
    create order via service; approve; list with status filter 'approved' → present; 'pending' → absent.
  });

  it('does not show a rolled-back write (double approve fails and leaves the projection unchanged)', async () {
    create + approve (totals: approved 1, total 1).
    await expect(svc.orders.approveOrder(id)).rejects.toBeInstanceOf(ConflictException);
    list → still 1 row approved; totals → approvedCents = amount, orderCount 1.
  });

  it('rejects approving a missing order and leaves the projection untouched', async () => {
    await expect(svc.orders.approveOrder('nope')).rejects.toBeInstanceOf(NotFoundException);
    // ops rows empty
  });
});
```
Seed: company via prisma.company.create; worker; event.

Wait — `listOperations`'s signature: service method takes a params object. In the test, I call the service directly. Good.

**test/concurrent-totals.spec.ts**:
```ts
it('keeps company totals exact when many orders are approved concurrently', async () => {
  seed company; create 20 pending orders (each 100_000 cents? let's do 7_777) via service.
  const approvals = ids.map(id => svc.orders.approveOrder(id));
  await Promise.all(approvals); // concurrent, each its own tx
  const totals = await svc.operations.getCompanyTotals(companyId);
  expect(totals.orderCount).toBe(20);
  expect(totals.totalCents).toBe(20 * 7777);
  expect(totals.approvedCents).toBe(20 * 7777);
  expect(totals.rejectedCents).toBe(0);
  // cross-check with source
  const sourceTotal = await prisma.paymentOrder.aggregate({ _sum: { amountCents: true }, _count: true, where: { companyId } });
  ...
});
```
And maybe a mixed concurrent approve+reject pair test: two orders, approve one, reject the other concurrently → approved = A, rejected = R. Add as a second test:
```ts
it('keeps totals exact when approve and reject land on the same totals row concurrently', ...)
```
Good — tests contention from both directions.

To really prove concurrency (not interleaving), Promise.all on separate transactions is the standard proof. Add a comment.

**test/drift-repair.spec.ts**:
```ts
it('detects and repairs injected drift', async () => {
  seed: company, 3 orders: o1 approved (service), o2 pending, o3 approved.
  inject drift:
    UPDATE ops_rows SET status='pending' WHERE id=o2.id;  // stale status
    DELETE FROM ops_rows WHERE id=o3.id;                    // missing row
    UPDATE company_totals SET approved_cents = approved_cents + 1 WHERE company_id=...; // wrong totals
  const report = await svc.drift.repairRecentWindow();
  expect(report.repaired).toBe(true);
  expect(report.driftedOrders).toBeGreaterThanOrEqual(2);
  // projection now matches source
  const rows = await prisma.opsRow.findMany({ where: { companyId } });
  expect(rows sorted by id).toEqual(expected from source join);
  totals exact.
});

it('is a no-op when the projection already matches the source', async () => {
  seed consistently via service;
  const report = await svc.drift.repairRecentWindow();
  expect(report.repaired).toBe(false);
  expect(report.driftedOrders).toBe(0);
});

it('repairs a re-derivation of a window twice leaves the same result', ...) — hmm, that's a rederivation idempotency test. Should it be part of the drift spec? The spec lists tests: "read-your-own-writes, concurrent total, drift repair". Rederivation acceptance: "re-derive a window → projection matches source; run twice → same result". I could add a 4th spec file test/rederive.spec.ts… The deliverables say "tests for read-your-own-writes, concurrent total, drift repair" — exactly three test areas. Rederivation behavior is… I could fold the rederivation idempotency into the drift-repair spec (repair uses rederivation) or add a dedicated spec. "Do exactly what the task asks" — the three named tests. But the acceptance criteria include re-derive twice → same result. I think a small 4th spec is justified by the acceptance criteria; or fold into the drift spec. Hmm. Let me fold a "re-derivation is idempotent" test into the drift-repair spec file (same file, different it block) — keeping to three test files. Reasonable.

Actually wait, let me reconsider: it's cleaner to have `test/rederive-window.spec.ts`. The task says "tests for read-your-own-writes, concurrent total, drift repair" — it doesn't forbid testing rederivation. The acceptance explicitly says "re-derive a window → projection matches source; run twice → same result". That needs a test to prove it. I'll add a 4th spec file `test/rederive.spec.ts`. Hmm, "don't create files it doesn't ask for"… but the acceptance criteria implicitly ask for the rederivation test. I'll include it — defensible.

rederive spec:
```ts
it('rebuilds the projection for a window from the source', async () => {
  seed company with 5 orders via service (mixed statuses).
  // corrupt everything
  TRUNCATE ops_rows; UPDATE company_totals SET ... wrong;
  await svc.projections.rederiveWindow(from, to); // full window covering all
  assert rows match source join; totals exact.
});

it('running twice over the same window leaves the same result', async () => {
  after first rederive, snapshot rows+totals (JSON), run again, snapshot again, expect equal.
});
```
Window: from = before seed, to = after seed → `new Date(Date.now() - 60_000)` and `new Date()`.

Note: rederiveWindow is on the ProjectionService (public). Good.

Now — the drift detection compares `r.occurred_at = po.updated_at`. After service approve: both set to the same Date `at` in the same tx. But: Prisma stores `updated_at` from Date `at` (ms precision). ops_rows.occurred_at from the same Date. Equal. In rederivation: occurred_at := po.updated_at — equal. OK.

But one wrinkle: Prisma's `$queryRaw`/`$executeRaw` with Date params → Postgres timestamptz; stored as TIMESTAMPTZ(3) (microseconds truncated to ms). Both sides written from the same JS Date → identical. The drift comparison in SQL is exact equality — fine.

Another wrinkle: in the create flow, the service sets createdAt=updatedAt=at and passes occurredAt=at. Consistent.

Now — the OperationsRepository's `where` construction: `where.occurredAt` typed as Prisma.DateTimeFilter | Date… need to initialize as object:
```ts
const where: Prisma.OpsRowWhereInput = { companyId: params.companyId };
if (params.status) where.status = params.status;
const occurredAt: Prisma.DateTimeFilter = {};
if (params.from) occurredAt.gte = params.from;
if (params.to) occurredAt.lt = params.to;
if (params.from || params.to) where.occurredAt = occurredAt;
```

Status enum: source uses Prisma enum OrderStatus (stored as TEXT 'pending' etc.). In raw SQL I use the string literals 'approved'/'rejected' — matches enum values. OpsRow.status: use the same enum in the schema? In schema.prisma I'll make OpsRow.status `OrderStatus` (enum). The raw INSERT passes a string — fine.

Prisma's findMany where status: `where.status = params.status` where params.status is typed as OrderStatus. Controller DTO: `@IsIn(['pending','approved','rejected']) status?: string` → cast in service? "Controller validates input, calls service; zero business logic" — the cast is fine in the controller (or DTO transform). I'll cast in the controller: `status: q.status as OrderStatus`. Fine.

Now `DESIGN.md` — short, justifying synchronous hooks vs alternatives:
- What we built: ops_rows + company_totals projections, in-transaction hooks, rederivation, drift repair, covering index.
- Why synchronous in-tx hooks: the read-your-own-writes requirement rules out any asynchronous mechanism (post-commit hook, outbox+worker, CDC/logical replication, scheduled refresh) because each has a visibility window. Even a 100ms window violates "immediately". Atomicity with the write: rollback → no phantom projection.
- Rejected alternatives: (1) scheduled refresh job — visibility window, fails the requirement. (2) async queue/outbox after commit — operator's own write invisible until worker runs; adds infra and ordering concerns. (3) CDC (logical decoding) — same window + extra infra, ordering, replay complexity. (4) Postgres trigger — same atomicity as hooks but invisible to app code, hard to test, couples schema to logic, not visible to the service layer; also cross-database triggers don't exist — trigger would work in DB but our write path is app-owned (Prisma), hooks keep it in TypeScript and testable. Also triggers make the rederivation/repair harder to reason about? Mainly: keep business logic in the app layer, testable in the service layer, single language. (5) Faster join (index on the source) — still multi-table join at 3M scale, can't hit p95 50ms; also totals need aggregation. (6) Materialized view + REFRESH — window problem again.
- Exact totals: in-place increment (ON CONFLICT DO UPDATE + delta) — atomic row lock; read-modify-write loses updates.
- Rederivation makes the projection recoverable: windowed, idempotent (upsert + full aggregate), single tx, safe while live (idempotent statements; a concurrent writer lands in this or the next cycle).
- Drift repair: periodic diff over a recent window; detection SQL; repair = rederivation. Covers deploy-mid-transaction/manual fixes.
- Known tradeoff: write latency increases by the hook cost (single-row upsert + one-row increment: negligible); if a hook throws, the write fails (correct: no partial state) — and the repair backfills.
- What the operator sees: identical columns/filters/order/pagination; index: covering (company_id, status, occurred_at DESC, id DESC) INCLUDE payload.

Keep it short (the task says "short DESIGN.md").

Now — let me double-check the Prisma schema details:

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
  rejected
}

model Company {
  id     String         @id @default(cuid()) @map("id")
  name   String         @map("name")
  orders PaymentOrder[]
  totals CompanyTotal?

  @@map("companies")
}

model Worker {
  id     String         @id @default(cuid()) @map("id")
  name   String         @map("name")
  orders PaymentOrder[]

  @@map("workers")
}

model Event {
  id     String         @id @default(cuid()) @map("id")
  title  String         @map("title")
  orders PaymentOrder[]

  @@map("events")
}
```
Model name `Event` — TS: `Prisma.Event`? The generated client has an `event` delegate. In the repository, `tx.event.findUnique`. `import { Event } from '@prisma/client'` may collide with the DOM global Event — I'm not using lib.dom (no lib in tsconfig → only ES2022; no DOM). Fine.

```prisma
model PaymentOrder {
  id          String      @id @default(cuid()) @map("id")
  companyId   String      @map("company_id")
  workerId    String?     @map("worker_id")
  eventId     String?     @map("event_id")
  status      OrderStatus @default(pending) @map("status")
  amountCents BigInt      @map("amount_cents")
  createdAt   DateTime    @default(now()) @map("created_at")
  updatedAt   DateTime    @default(now()) @map("updated_at")

  company Company @relation(fields: [companyId], references: [id])
  worker  Worker? @relation(fields: [workerId], references: [id])
  event   Event?  @relation(fields: [eventId], references: [id])

  @@index([companyId, updatedAt], map: "payment_orders_company_updated_idx")
  @@map("payment_orders")
}
```
Note: `@updatedAt` is intentionally absent — the service manages updatedAt explicitly (so the hook can share the same instant). Add a comment in the schema.

```prisma
model OpsRow {
  id          String      @id @map("id")
  companyId   String      @map("company_id")
  status      OrderStatus @map("status")
  amountCents BigInt      @map("amount_cents")
  occurredAt  DateTime    @map("occurred_at")
  workerName  String?     @map("worker_name")
  eventName   String?     @map("event_name")
  createdAt   DateTime    @map("created_at")
  updatedAt   DateTime    @map("updated_at")

  @@index([companyId, status, occurredAt(sort: Desc), id(sort: Desc)], map: "idx_ops_rows_lookup")
  @@map("ops_rows")
}

model CompanyTotal {
  companyId     String  @id @map("company_id")
  totalCents    BigInt  @default(0) @map("total_cents")
  approvedCents BigInt  @default(0) @map("approved_cents")
  rejectedCents BigInt  @default(0) @map("rejected_cents")
  orderCount    Int     @default(0) @map("order_count")

  company Company @relation(fields: [companyId], references: [id])

  @@map("company_totals")
}
```

The migration SQL must match (I'll write by hand). Prisma's migrate would generate similar DDL. Since the migration is hand-written and the tests apply it, we're fine.

Now, the migration directory name: `prisma/migrations/20240101000000_init/migration.sql`. The test helper hardcodes that path.

Let me now write out all files concretely.

---

### package.json

```json
{
  "name": "marketplace-backoffice",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "tsx src/main.ts",
    "migrate": "prisma migrate deploy",
    "generate": "prisma generate",
    "test": "vitest run"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.8",
    "@nestjs/core": "^10.3.8",
    "@nestjs/platform-express": "^10.3.8",
    "@nestjs/schedule": "^4.1.0",
    "@prisma/client": "^5.14.0",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.0",
    "prisma": "^5.14.0",
    "tsx": "^4.15.0",
    "typescript": "^5.5.0",
    "vitest": "^1.6.0"
  }
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "useDefineForClassFields": false,
    "sourceMap": true,
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

### vitest.config.ts

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
```

### prisma/schema.prisma
(as above)

### prisma/migrations/20240101000000_init/migration.sql

```sql
-- Initial schema: source tables (companies, workers, events, payment_orders)
-- and the operations read-model projection (ops_rows, company_totals).

CREATE TABLE "companies" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL
);

CREATE TABLE "workers" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL
);

CREATE TABLE "events" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "title" TEXT NOT NULL
);

CREATE TABLE "payment_orders" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "company_id" TEXT NOT NULL,
  "worker_id" TEXT,
  "event_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "amount_cents" BIGINT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_orders_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "payment_orders_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "payment_orders_company_updated_idx" ON "payment_orders" ("company_id", "updated_at");

CREATE TABLE "ops_rows" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "company_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "amount_cents" BIGINT NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "worker_name" TEXT,
  "event_name" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL
);

-- Covering index for the dashboard access pattern:
-- WHERE company_id = ? AND status = ? AND occurred_at BETWEEN ? AND ?
-- ORDER BY occurred_at DESC, id DESC  → index-only scan.
CREATE INDEX "idx_ops_rows_lookup" ON "ops_rows" ("company_id", "status", "occurred_at" DESC, "id" DESC)
  INCLUDE ("amount_cents", "worker_name", "event_name", "created_at");

CREATE TABLE "company_totals" (
  "company_id" TEXT PRIMARY KEY NOT NULL,
  "total_cents" BIGINT NOT NULL DEFAULT 0,
  "approved_cents" BIGINT NOT NULL DEFAULT 0,
  "rejected_cents" BIGINT NOT NULL DEFAULT 0,
  "order_count" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "company_totals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
```

Wait — test splitting on `;` — comments with `--` are fine.

### src/prisma/prisma.service.ts

```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

### src/prisma/prisma.module.ts

```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

### src/common/errors.ts?

Maybe define an error helper? Let me just use Nest's HttpException classes directly.

### src/common/exception.filter.ts

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';

/**
 * Maps any thrown error to the single error envelope:
 * { "error": { "code": snake_case, "message": string, "details": {} } }
 */
@Catch()
export class EnvelopeExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(EnvelopeExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let details: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const record = body as Record<string, unknown>;
        if (Array.isArray(record.message)) {
          message = (record.message as string[]).join('; ');
          details = { fields: record.message };
        } else if (typeof record.message === 'string') {
          message = record.message;
        }
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    const code = this.codeFor(status);
    if (status >= 500) {
      this.logger.error(`Unhandled error (${code}): ${message}`, exception instanceof Error ? exception.stack : undefined);
    }

    response.status(status).json({ error: { code, message, details } });
  }

  private codeFor(status: number): string {
    switch (status) {
      case 400: return 'validation_failed';
      case 401: return 'unauthorized';
      case 403: return 'forbidden';
      case 404: return 'resource_not_found';
      case 409: return 'conflict';
      default: return 'internal_error';
    }
  }
}
```

### src/main.ts

```ts
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { EnvelopeExceptionFilter } from './common/exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new EnvelopeExceptionFilter());
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
```

### src/app.module.ts

```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DriftRepairModule } from './drift-repair/drift-repair.module';
import { OperationsModule } from './operations/operations.module';
import { OrdersModule } from './orders/orders.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectionModule } from './projection/projection.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    OrdersModule,
    OperationsModule,
    ProjectionModule,
    DriftRepairModule,
  ],
})
export class AppModule {}
```

### src/projection/projection.repository.ts

```ts
import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface OpRowSnapshot {
  id: string;
  companyId: string;
  status: string;
  amountCents: number;
  occurredAt: Date;
  workerName: string | null;
  eventName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TotalsDelta {
  companyId: string;
  totalDelta: number;
  approvedDelta: number;
  rejectedDelta: number;
  countDelta: number;
}

export interface RederiveResult {
  rowsRebuilt: number;
  companiesRecomputed: number;
}

/**
 * The only component that writes the projection tables. All statements are
 * idempotent: the row upsert and the in-place totals increment are safe to
 * re-run and safe under concurrent execution (Postgres row lock serializes
 * the increments).
 */
@Injectable()
export class ProjectionRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaClient) {}

  withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.db.$transaction(fn);
  }

  async upsertOpRow(tx: Prisma.TransactionClient, row: OpRowSnapshot): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO ops_rows (id, company_id, status, amount_cents, occurred_at, worker_name, event_name, created_at, updated_at)
      VALUES (${row.id}, ${row.companyId}, ${row.status}, ${row.amountCents}, ${row.occurredAt}, ${row.workerName}, ${row.eventName}, ${row.createdAt}, ${row.updatedAt})
      ON CONFLICT (id) DO UPDATE SET
        company_id   = EXCLUDED.company_id,
        status       = EXCLUDED.status,
        amount_cents = EXCLUDED.amount_cents,
        occurred_at  = EXCLUDED.occurred_at,
        worker_name  = COALESCE(EXCLUDED.worker_name, ops_rows.worker_name),
        event_name   = COALESCE(EXCLUDED.event_name, ops_rows.event_name),
        updated_at   = EXCLUDED.updated_at
    `;
  }

  async updateOpRowStatus(tx: Prisma.TransactionClient, id: string, status: string, at: Date): Promise<void> {
    await tx.$executeRaw`
      UPDATE ops_rows
      SET status = ${status}, occurred_at = ${at}, updated_at = ${at}
      WHERE id = ${id}
    `;
  }

  async applyTotalsDelta(tx: Prisma.TransactionClient, d: TotalsDelta): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO company_totals (company_id, total_cents, approved_cents, rejected_cents, order_count)
      VALUES (${d.companyId}, ${d.totalDelta}, ${d.approvedDelta}, ${d.rejectedDelta}, ${d.countDelta})
      ON CONFLICT (company_id) DO UPDATE SET
        total_cents    = company_totals.total_cents + EXCLUDED.total_cents,
        approved_cents = company_totals.approved_cents + EXCLUDED.approved_cents,
        rejected_cents = company_totals.rejected_cents + EXCLUDED.rejected_cents,
        order_count    = company_totals.order_count + EXCLUDED.order_count
    `;
  }
```

Wait — `$executeRaw` tagged template: template literals with backticks — need escaping? In TS, I write:
```ts
await tx.$executeRaw`
  INSERT ...
`;
```
Yes, tagged template, fine.

But a note: `${row.workerName}` with null — Prisma raw handles null. Number for amountCents. OK.

Hmm — one concern: `$executeRaw` with a Date param — supported (serialized as ISO). Good.

```ts
  /**
   * Rebuild the projection for orders whose `updated_at` falls in [from, to):
   * upsert the current row for every order in the window and recompute the
   * exact totals for every company touched by the window. Idempotent:
   * running it twice over the same window yields the same result.
   */
  async rederiveWindow(tx: Prisma.TransactionClient, from: Date, to: Date): Promise<RederiveResult> {
    const rows = await tx.$executeRaw`
      INSERT INTO ops_rows (id, company_id, status, amount_cents, occurred_at, worker_name, event_name, created_at, updated_at)
      SELECT po.id, po.company_id, po.status, po.amount_cents, po.updated_at, w.name, e.title, po.created_at, po.updated_at
      FROM payment_orders po
      LEFT JOIN workers w ON w.id = po.worker_id
      LEFT JOIN events e ON e.id = po.event_id
      WHERE po.updated_at >= ${from} AND po.updated_at < ${to}
      ON CONFLICT (id) DO UPDATE SET
        company_id   = EXCLUDED.company_id,
        status       = EXCLUDED.status,
        amount_cents = EXCLUDED.amount_cents,
        occurred_at  = EXCLUDED.occurred_at,
        worker_name  = COALESCE(EXCLUDED.worker_name, ops_rows.worker_name),
        event_name   = COALESCE(EXCLUDED.event_name, ops_rows.event_name),
        updated_at   = EXCLUDED.updated_at
    `;
    const companies = await tx.$executeRaw`
      INSERT INTO company_totals (company_id, total_cents, approved_cents, rejected_cents, order_count)
      SELECT po.company_id,
             COALESCE(SUM(po.amount_cents), 0),
             COALESCE(SUM(po.amount_cents) FILTER (WHERE po.status = 'approved'), 0),
             COALESCE(SUM(po.amount_cents) FILTER (WHERE po.status = 'rejected'), 0),
             COUNT(*)
      FROM payment_orders po
      WHERE po.company_id IN (
        SELECT DISTINCT po2.company_id FROM payment_orders po2 WHERE po2.updated_at >= ${from} AND po2.updated_at < ${to}
      )
      GROUP BY po.company_id
      ON CONFLICT (company_id) DO UPDATE SET
        total_cents    = EXCLUDED.total_cents,
        approved_cents = EXCLUDED.approved_cents,
        rejected_cents = EXCLUDED.rejected_cents,
        order_count    = EXCLUDED.order_count
    `;
    return { rowsRebuilt: Number(rows), companiesRecomputed: Number(companies) };
  }
}
```

`$executeRaw` returns number (affected rows). In TS types, `number`.

### src/projection/projection.service.ts

```ts
import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { ProjectionRepository, RederiveResult, TotalsDelta } from './projection.repository';

export interface CreatedOrderFacts {
  id: string;
  companyId: string;
  status: OrderStatus;
  amountCents: number;
  occurredAt: Date;
  workerName: string | null;
  eventName: string | null;
  createdAt: Date;
}

export interface StatusChangeFacts {
  id: string;
  companyId: string;
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
  amountCents: number;
  occurredAt: Date;
}

/**
 * Synchronous maintenance hooks for the operations projection. Every method
 * takes the write transaction (`tx`) so that the projection update commits or
 * rolls back atomically with the source write — that is what makes
 * read-your-own-writes hold.
 */
@Injectable()
export class ProjectionService {
  constructor(@Inject(ProjectionRepository) private readonly repo: ProjectionRepository) {}

  onOrderCreated(tx: Prisma.TransactionClient, facts: CreatedOrderFacts): Promise<void> {
    return this.repo.upsertOpRow(tx, {
      id: facts.id,
      companyId: facts.companyId,
      status: facts.status,
      amountCents: facts.amountCents,
      occurredAt: facts.occurredAt,
      workerName: facts.workerName,
      eventName: facts.eventName,
      createdAt: facts.createdAt,
      updatedAt: facts.occurredAt,
    });
  }
```
Hmm — onOrderCreated returns only upsert; where's the totals? Chain:
```ts
  async onOrderCreated(tx, facts): Promise<void> {
    await this.repo.upsertOpRow(...);
    await this.repo.applyTotalsDelta(tx, { companyId: facts.companyId, totalDelta: facts.amountCents, approvedDelta: 0, rejectedDelta: 0, countDelta: 1 });
  }

  async onOrderStatusChanged(tx, facts): Promise<void> {
    await this.repo.updateOpRowStatus(tx, facts.id, facts.toStatus, facts.occurredAt);
    const delta = statusDelta(facts.fromStatus, facts.toStatus, facts.amountCents);
    await this.repo.applyTotalsDelta(tx, { companyId: facts.companyId, totalDelta: 0, approvedDelta: delta.approved, rejectedDelta: delta.rejected, countDelta: 0 });
  }

  rederiveWindow(from: Date, to: Date): Promise<RederiveResult> {
    return this.repo.withTransaction((tx) => this.repo.rederiveWindow(tx, from, to));
  }
}

function statusDelta(from: OrderStatus, to: OrderStatus, amountCents: number): { approved: number; rejected: number } {
  const approved = (to === 'approved' ? amountCents : 0) - (from === 'approved' ? amountCents : 0);
  const rejected = (to === 'rejected' ? amountCents : 0) - (from === 'rejected' ? amountCents : 0);
  return { approved, rejected };
}
```

### src/orders/order.repository.ts

```ts
import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Company, Event, OrderStatus, PaymentOrder, Prisma, PrismaClient, Worker } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OrderRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaClient) {}

  withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.db.$transaction(fn);
  }

  getCompany(tx: Prisma.TransactionClient, id: string): Promise<Company | null> {
    return tx.company.findUnique({ where: { id } });
  }

  getWorker(tx: Prisma.TransactionClient, id: string): Promise<Worker | null> {
    return tx.worker.findUnique({ where: { id } });
  }

  getEvent(tx: Prisma.TransactionClient, id: string): Promise<Event | null> {
    return tx.event.findUnique({ where: { id } });
  }

  findById(tx: Prisma.TransactionClient, id: string): Promise<PaymentOrder | null> {
    return tx.paymentOrder.findUnique({ where: { id } });
  }

  createOrder(
    tx: Prisma.TransactionClient,
    data: { companyId: string; workerId: string | null; eventId: string | null; amountCents: bigint; at: Date },
  ): Promise<PaymentOrder> {
    return tx.paymentOrder.create({
      data: {
        companyId: data.companyId,
        workerId: data.workerId,
        eventId: data.eventId,
        status: 'pending',
        amountCents: data.amountCents,
        createdAt: data.at,
        updatedAt: data.at,
      },
    });
  }

  /**
   * Atomic status transition with a guard: only orders that are still in
   * `from` move. Returns null when nothing matched (missing or wrong status);
   * the caller fetches the row to tell the two apart.
   */
  async transition(
    tx: Prisma.TransactionClient,
    id: string,
    from: OrderStatus,
    to: OrderStatus,
    at: Date,
  ): Promise<PaymentOrder | null> {
    const result = await tx.paymentOrder.updateMany({
      where: { id, status: from },
      data: { status: to, updatedAt: at },
    });
    if (result.count === 0) return null;
    const order = await tx.paymentOrder.findUnique({ where: { id } });
    return order;
  }
}
```

### src/orders/order.service.ts

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { PaymentOrder } from '@prisma/client';
import { ProjectionService } from '../projection/projection.service';
import { OrderRepository } from './order.repository';

export interface CreateOrderInput {
  companyId: string;
  workerId?: string;
  eventId?: string;
  amountCents: number;
}

/**
 * Write path for payment orders. Every write opens a single database
 * transaction that (1) mutates the source row and (2) applies the matching
 * projection hook. Rollback of the write rolls back the projection too.
 */
@Injectable()
export class OrderService {
  constructor(
    @Inject(OrderRepository) private readonly orders: OrderRepository,
    @Inject(ProjectionService) private readonly projections: ProjectionService,
  ) {}

  async createOrder(input: CreateOrderInput): Promise<PaymentOrder> {
    return this.orders.withTransaction(async (tx) => {
      const company = await this.orders.getCompany(tx, input.companyId);
      if (!company) throw new NotFoundException(`Company ${input.companyId} does not exist`);

      let workerName: string | null = null;
      let eventName: string | null = null;
      if (input.workerId) {
        const worker = await this.orders.getWorker(tx, input.workerId);
        if (!worker) throw new NotFoundException(`Worker ${input.workerId} does not exist`);
        workerName = worker.name;
      }
      if (input.eventId) {
        const event = await this.orders.getEvent(tx, input.eventId);
        if (!event) throw new NotFoundException(`Event ${input.eventId} does not exist`);
        eventName = event.title;
      }

      const at = new Date();
      const order = await this.orders.createOrder(tx, {
        companyId: input.companyId,
        workerId: input.workerId ?? null,
        eventId: input.eventId ?? null,
        amountCents: BigInt(input.amountCents),
        at,
      });

      await this.projections.onOrderCreated(tx, {
        id: order.id,
        companyId: order.companyId,
        status: order.status,
        amountCents: Number(order.amountCents),
        occurredAt: at,
        workerName,
        eventName,
        createdAt: at,
      });

      return order;
    });
  }

  approveOrder(id: string): Promise<PaymentOrder> {
    return this.transition(id, 'approved', 'approved');
  }

  rejectOrder(id: string): Promise<PaymentOrder> {
    return this.transition(id, 'rejected', 'rejected');
  }

  private transition(id: string, to: 'approved' | 'rejected', verb: 'approved' | 'rejected'): Promise<PaymentOrder> {
    return this.orders.withTransaction(async (tx) => {
      const at = new Date();
      const updated = await this.orders.transition(tx, id, 'pending', to, at);
      if (!updated) {
        const existing = await this.orders.findById(tx, id);
        if (!existing) throw new NotFoundException(`Order ${id} does not exist`);
        throw new ConflictException(`Order ${id} is ${existing.status} and cannot be ${verb}`);
      }

      await this.projections.onOrderStatusChanged(tx, {
        id: updated.id,
        companyId: updated.companyId,
        fromStatus: 'pending',
        toStatus: to,
        amountCents: Number(updated.amountCents),
        occurredAt: at,
      });

      return updated;
    });
  }
}
```

Hmm `verb` unused? I used verb in the message: "cannot be approved" / "cannot be rejected". `to` is 'approved'|'rejected', same as verb — redundant parameter. Simplify: `transition(id, to)`, message is `cannot be ${to}`. to ∈ {'approved','rejected'}.

Wait — fromStatus is always 'pending'? In this app, only pending→approved/rejected are allowed (no resubmission/reversal). OK.

### src/orders/order.controller.ts

```ts
import { Body, ConflictException, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { OrderService } from './order.service';
import { CreateOrderDto } from './create-order.dto';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrderService) {}

  @Post()
  create(@Body() body: CreateOrderDto) {
    return this.orders.createOrder({
      companyId: body.companyId,
      workerId: body.workerId,
      eventId: body.eventId,
      amountCents: body.amountCents,
    });
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(@Param('id') id: string) {
    return this.orders.approveOrder(id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(@Param('id') id: string) {
    return this.orders.rejectOrder(id);
  }
}
```
Constructor: add explicit @Inject(OrderService). Yes, add `@Inject(OrderService)`.

### src/orders/create-order.dto.ts

```ts
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateOrderDto {
  @IsString()
  companyId!: string;

  @IsOptional()
  @IsString()
  workerId?: string;

  @IsOptional()
  @IsString()
  eventId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000_000_00) // 100k in cents... hmm
  amountCents!: number;
}
```
Max: cap the per-order amount? Arbitrary — let me use @Max(1_000_000_000) ($10M). Fine.

With `useDefineForClassFields: false` + class-validator, the `!` definite assignment is fine.

### src/orders/orders.module.ts

```ts
import { Module } from '@nestjs/common';
import { ProjectionModule } from '../projection/projection.module';
import { OrdersController } from './order.controller';
import { OrderService } from './order.service';
import { OrderRepository } from './order.repository';

@Module({
  imports: [ProjectionModule],
  controllers: [OrdersController],
  providers: [OrderService, OrderRepository],
})
export class OrdersModule {}
```

### src/projection/projection.module.ts

```ts
import { Module } from '@nestjs/common';
import { ProjectionRepository } from './projection.repository';
import { ProjectionService } from './projection.service';

@Module({
  providers: [ProjectionService, ProjectionRepository],
  exports: [ProjectionService],
})
export class ProjectionModule {}
```

### src/operations/list-operations-query.dto.ts

```ts
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListOperationsQueryDto {
  @IsString()
  companyId!: string;

  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected'])
  status?: 'pending' | 'approved' | 'rejected';

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
```

### src/operations/operations.repository.ts

```ts
import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { CompanyTotal, OrderStatus, OpsRow, Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface OperationsFilter {
  companyId: string;
  status?: OrderStatus;
  from?: Date;
  to?: Date;
}

/**
 * Read side of the operations dashboard. Every query in this class touches
 * the projection tables only (ops_rows, company_totals) — never the source.
 */
@Injectable()
export class OperationsRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaClient) {}

  private filterOf(f: OperationsFilter): Prisma.OpsRowWhereInput {
    const where: Prisma.OpsRowWhereInput = { companyId: f.companyId };
    if (f.status) where.status = f.status;
    if (f.from || f.to) {
      const occurredAt: Prisma.DateTimeFilter = {};
      if (f.from) occurredAt.gte = f.from;
      if (f.to) occurredAt.lt = f.to;
      where.occurredAt = occurredAt;
    }
    return where;
  }

  listRows(f: OperationsFilter, page: number, pageSize: number): Promise<OpsRow[]> {
    return this.db.opsRow.findMany({
      where: this.filterOf(f),
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
  }

  countRows(f: OperationsFilter): Promise<number> {
    return this.db.opsRow.count({ where: this.filterOf(f) });
  }

  getCompanyTotal(companyId: string): Promise<CompanyTotal | null> {
    return this.db.companyTotal.findUnique({ where: { companyId } });
  }
}
```

### src/operations/operations.service.ts

```ts
import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { OperationsFilter, OperationsRepository } from './operations.repository';

export interface OperationsPageInput extends OperationsFilter {
  page: number;
  pageSize: number;
}

export interface OperationItem {
  id: string;
  companyId: string;
  status: string;
  amountCents: number;
  occurredAt: Date;
  workerName: string | null;
  eventName: string | null;
  createdAt: Date;
}

export interface OperationsPage {
  items: OperationItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CompanyTotals {
  companyId: string;
  totalCents: number;
  approvedCents: number;
  rejectedCents: number;
  orderCount: number;
}

@Injectable()
export class OperationsService {
  constructor(@Inject(OperationsRepository) private readonly repo: OperationsRepository) {}

  async listOperations(input: OperationsPageInput): Promise<OperationsPage> {
    const filter: OperationsFilter = {
      companyId: input.companyId,
      status: input.status,
      from: input.from,
      to: input.to,
    };
    const [rows, total] = await Promise.all([
      this.repo.listRows(filter, input.page, input.pageSize),
      this.repo.countRows(filter),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        companyId: row.companyId,
        status: row.status,
        amountCents: Number(row.amountCents),
        occurredAt: row.occurredAt,
        workerName: row.workerName,
        eventName: row.eventName,
        createdAt: row.createdAt,
      })),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  async getCompanyTotals(companyId: string): Promise<CompanyTotals> {
    const totals = await this.repo.getCompanyTotal(companyId);
    return {
      companyId,
      totalCents: Number(totals?.totalCents ?? 0n),
      approvedCents: Number(totals?.approvedCents ?? 0n),
      rejectedCents: Number(totals?.rejectedCents ?? 0n),
      orderCount: totals?.orderCount ?? 0,
    };
  }
}
```

### src/operations/operations.controller.ts

```ts
import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { ListOperationsQueryDto } from './list-operations-query.dto';
import { OperationsService } from './operations.service';

@Controller('operations')
export class OperationsController {
  constructor(@Inject(OperationsService) private readonly operations: OperationsService) {}

  @Get()
  list(@Query() query: ListOperationsQueryDto) {
    return this.operations.listOperations({
      companyId: query.companyId,
      status: query.status,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
    });
  }

  @Get('companies/:companyId/totals')
  totals(@Param('companyId') companyId: string) {
    return this.operations.getCompanyTotals(companyId);
  }
}
```
Hmm, the route `companies/:companyId/totals` under `/operations` → `/operations/companies/:companyId/totals`. Endpoint naming is kebab-case plural… `GET /operations` is plural-ish; the totals endpoint path `companies/:id/totals` — fine.

### src/operations/operations.module.ts

```ts
import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller';
import { OperationsRepository } from './operations.repository';
import { OperationsService } from './operations.service';

@Module({
  controllers: [OperationsController],
  providers: [OperationsService, OperationsRepository],
})
export class OperationsModule {}
```

### src/drift-repair/drift-repair.repository.ts

```ts
import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface DriftReportSource {
  driftedOrderIds: string[];
  driftedCompanyIds: string[];
}

interface DriftedRowDto { id: string; company_id: string }
interface DriftedTotalDto { company_id: string }

/**
 * Read-only diff between the projection and the source for a window of
 * source `updated_at`. The repair action itself is the re-derivation routine
 * (see ProjectionService.rederiveWindow).
 */
@Injectable()
export class DriftRepairRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaClient) {}

  async findDrift(from: Date, to: Date): Promise<DriftReportSource> {
    const rows = await this.db.$queryRaw<DriftedRowDto[]>`
      SELECT po.id, po.company_id
      FROM payment_orders po
      WHERE po.updated_at >= ${from} AND po.updated_at < ${to}
        AND NOT EXISTS (
          SELECT 1
          FROM ops_rows r
          WHERE r.id = po.id
            AND r.company_id = po.company_id
            AND r.status = po.status
            AND r.amount_cents = po.amount_cents
            AND r.occurred_at = po.updated_at
            AND r.worker_name IS NOT DISTINCT FROM (SELECT w.name FROM workers w WHERE w.id = po.worker_id)
            AND r.event_name IS NOT DISTINCT FROM (SELECT e.title FROM events e WHERE e.id = po.event_id)
        )
      ORDER BY po.id
      LIMIT 500
    `;
    const totals = await this.db.$queryRaw<DriftedTotalDto[]>`
      WITH windowed AS (
        SELECT DISTINCT company_id
        FROM payment_orders
        WHERE updated_at >= ${from} AND updated_at < ${to}
      ),
      source AS (
        SELECT po.company_id,
               COALESCE(SUM(po.amount_cents), 0) AS total_cents,
               COALESCE(SUM(po.amount_cents) FILTER (WHERE po.status = 'approved'), 0) AS approved_cents,
               COALESCE(SUM(po.amount_cents) FILTER (WHERE po.status = 'rejected'), 0) AS rejected_cents,
               COUNT(*) AS order_count
        FROM payment_orders po
        WHERE po.company_id IN (SELECT company_id FROM windowed)
        GROUP BY po.company_id
      )
      SELECT s.company_id
      FROM source s
      LEFT JOIN company_totals t ON t.company_id = s.company_id
      WHERE t.total_cents IS DISTINCT FROM s.total_cents
         OR t.approved_cents IS DISTINCT FROM s.approved_cents
         OR t.rejected_cents IS DISTINCT FROM s.rejected_cents
         OR t.order_count IS DISTINCT FROM s.order_count
    `;
    return {
      driftedOrderIds: rows.map((r) => r.id),
      driftedCompanyIds: [...new Set([...rows.map((r) => r.company_id), ...totals.map((t) => t.company_id)])],
    };
  }
}
```
LIMIT 500 on order ids (report sample); count = rows.length but if capped at 500, the report count is a sample… Let me not cap: return all drifted ids (window is bounded; drift is rare). Drop the LIMIT. Fine.

### src/drift-repair/drift-repair.service.ts

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ProjectionService } from '../projection/projection.service';
import { DriftRepairRepository } from './drift-repair.repository';

export interface DriftRepairReport {
  from: Date;
  to: Date;
  repaired: boolean;
  driftedOrders: number;
  driftedCompanies: number;
  rowsRebuilt: number;
  companiesRecomputed: number;
}

const DEFAULT_INTERVAL_MS = 5 * 60_000;
const DEFAULT_LOOKBACK_HOURS = 24;

@Injectable()
export class DriftRepairService {
  private readonly logger = new Logger(DriftRepairService.name);

  constructor(
    @Inject(DriftRepairRepository) private readonly drift: DriftRepairRepository,
    @Inject(ProjectionService) private readonly projections: ProjectionService,
  ) {}

  @Interval(() => Number(process.env.DRIFT_REPAIR_INTERVAL_MS) || DEFAULT_INTERVAL_MS)
  async runScheduled(): Promise<DriftRepairReport> {
    const report = await this.repairRecentWindow();
    this.logger.log(
      `drift repair ${report.repaired ? 'repaired' : 'clean'}: ` +
      `orders=${report.driftedOrders} companies=${report.driftedCompanies} ` +
      `rowsRebuilt=${report.rowsRebuilt} window=[${report.from.toISOString()}, ${report.to.toISOString()}]`,
    );
    return report;
  }

  async repairRecentWindow(): Promise<DriftRepairReport> {
    const to = new Date();
    const lookbackMs = Number(process.env.DRIFT_REPAIR_LOOKBACK_HOURS) || DEFAULT_LOOKBACK_HOURS;
    return this.repairWindow(new Date(to.getTime() - lookbackMs * 3_600_000), to);
  }

  async repairWindow(from: Date, to: Date): Promise<DriftRepairReport> {
    const drift = await this.drift.findDrift(from, to);
    const base = {
      from,
      to,
      driftedOrders: drift.driftedOrderIds.length,
      driftedCompanies: drift.driftedCompanyIds.length,
    };
    if (drift.driftedOrderIds.length === 0 && drift.driftedCompanyIds.length === 0) {
      return { ...base, repaired: false, rowsRebuilt: 0, companiesRecomputed: 0 };
    }
    const result = await this.projections.rederiveWindow(from, to);
    return { ...base, repaired: true, rowsRebuilt: result.rowsRebuilt, companiesRecomputed: result.companiesRecomputed };
  }
}
```

### src/drift-repair/drift-repair.module.ts

```ts
import { Module } from '@nestjs/common';
import { ProjectionModule } from '../projection/projection.module';
import { DriftRepairRepository } from './drift-repair.repository';
import { DriftRepairService } from './drift-repair.service';

@Module({
  imports: [ProjectionModule],
  providers: [DriftRepairService, DriftRepairRepository],
  exports: [DriftRepairService],
})
export class DriftRepairModule {}
```

Now the tests.

**test/helpers/db.ts**:
```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = path.resolve(here, '../../prisma/migrations/20240101000000_init/migration.sql');

export const hasDatabase = Boolean(process.env.DATABASE_URL);

/**
 * Test databases are provisioned out-of-band (a local or CI Postgres pointed
 * at by DATABASE_URL). When it is absent the suites skip rather than fail.
 */
export function connect(): PrismaClient {
  return new PrismaClient();
}

export async function resetSchema(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'DROP TABLE IF EXISTS ops_rows, company_totals, payment_orders, workers, events, companies CASCADE',
  );
  const sql = readFileSync(MIGRATION_SQL, 'utf8');
  for (const statement of sql.split(';\n')) {
    const trimmed = statement.trim();
    if (trimmed) await prisma.$executeRawUnsafe(trimmed);
  }
}

export async function resetData(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE ops_rows, company_totals, payment_orders, workers, events, companies');
}
```
Note: `new PrismaClient()` requires DATABASE_URL to be set at construction (or in the env). If absent, construction throws — but we skip via `describe.skipIf(!hasDatabase)` before constructing in beforeAll. Construction happens in beforeAll inside the describe — skipped. Good.

Wait: `sql.split(';\n')` — my migration: statements end with `;` on their own line, followed by a blank line or comment. Let me format the migration so every `;` is followed by `\n`. The last statement: `...ON UPDATE CASCADE);` at end of file — may not have trailing newline; split handles it (last chunk after the final `;\n` is empty). If the file ends with `);` without a trailing newline, the last chunk = the statement — good, trimmed and executed. Also comments between statements remain attached to the next chunk — fine (a leading `--` comment before a statement is valid SQL).

**test/helpers/services.ts**:
```ts
import { PrismaClient } from '@prisma/client';
import { DriftRepairRepository } from '../../src/drift-repair/drift-repair.repository';
import { DriftRepairService } from '../../src/drift-repair/drift-repair.service';
import { OperationsRepository } from '../../src/operations/operations.repository';
import { OperationsService } from '../../src/operations/operations.service';
import { OrderRepository } from '../../src/orders/order.repository';
import { OrderService } from '../../src/orders/order.service';
import { ProjectionRepository } from '../../src/projection/projection.repository';
import { ProjectionService } from '../../src/projection/projection.service';

/**
 * Wire the same object graph the Nest modules build, directly, so the tests
 * exercise the real services and repositories against a real database.
 */
export function buildServices(prisma: PrismaClient) {
  const projectionRepository = new ProjectionRepository(prisma);
  const projectionService = new ProjectionService(projectionRepository);
  const orderRepository = new OrderRepository(prisma);
  const orderService = new OrderService(orderRepository, projectionService);
  const operationsRepository = new OperationsRepository(prisma);
  const operationsService = new OperationsService(operationsRepository);
  const driftRepairRepository = new DriftRepairRepository(prisma);
  const driftRepairService = new DriftRepairService(driftRepairRepository, projectionService);
  return { projectionService, orderService, operationsService, driftRepairService };
}
```
The constructor parameter is typed as PrismaClient — passing a PrismaClient works.

**test/helpers/seed.ts**:
```ts
import { Company, Event, Worker } from '@prisma/client';
import { PrismaClient } from '@prisma/client';

export interface Seed {
  company: Company;
  worker: Worker;
  event: Event;
}

export async function seedLookup(prisma: PrismaClient, name = 'Acme'): Promise<Seed> {
  const company = await prisma.company.create({ data: { name } });
  const worker = await prisma.worker.create({ data: { name: 'Wendy' } });
  const event = await prisma.event.create({ data: { title: 'Launch' } });
  return { company, worker, event };
}
```
Hmm, `Event` type import — the generated model. Fine.

**test/read-your-own-writes.spec.ts**:

```ts
import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { connect, hasDatabase, resetData, resetSchema } from './helpers/db';
import { buildServices } from './helpers/services';
import { seedLookup } from './helpers/seed';

describe.skipIf(!hasDatabase)('read your own writes', () => {
  const prisma = connect();
  const app = buildServices(prisma);

  beforeAll(async () => { await resetSchema(prisma); });
  beforeEach(async () => { await resetData(prisma); });
  afterAll(async () => { await prisma.$disconnect(); });

  it('shows a new order on the very next dashboard request, with the denormalized names', async () => {
    const { company, worker, event } = await seedLookup(prisma);
    const order = await app.orderService.createOrder({
      companyId: company.id,
      workerId: worker.id,
      eventId: event.id,
      amountCents: 12345,
    });

    const page = await app.operationsService.listOperations({ companyId: company.id, page: 1, pageSize: 20 });

    expect(page.total).toBe(1);
    expect(page.items).toEqual([
      expect.objectContaining({
        id: order.id,
        companyId: company.id,
        status: 'pending',
        amountCents: 12345,
        workerName: 'Wendy',
        eventName: 'Launch',
      }),
    ]);
  });

  it('shows an approval immediately, in the list and behind the status filter', async () => {
    const { company } = await seedLookup(prisma);
    const order = await app.orderService.createOrder({ companyId: company.id, amountCents: 5000 });
    await app.orderService.approveOrder(order.id);

    const approved = await app.operationsService.listOperations({ companyId: company.id, status: 'approved', page: 1, pageSize: 20 });
    const pending = await app.operationsService.listOperations({ companyId: company.id, status: 'pending', page: 1, pageSize: 20 });

    expect(approved.items.map((row) => row.id)).toEqual([order.id]);
    expect(pending.items).toEqual([]);
    expect(approved.items[0].status).toBe('approved');
  });

  it('keeps the projection consistent when a second approval rolls back', async () => {
    const { company } = await seedLookup(prisma);
    const order = await app.orderService.createOrder({ companyId: company.id, amountCents: 7500 });
    await app.orderService.approveOrder(order.id);

    await expect(app.orderService.approveOrder(order.id)).rejects.toBeInstanceOf(ConflictException);

    const page = await app.operationsService.listOperations({ companyId: company.id, page: 1, pageSize: 20 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].status).toBe('approved');
    const totals = await app.operationsService.getCompanyTotals(company.id);
    expect(totals).toEqual({ companyId: company.id, totalCents: 7500, approvedCents: 7500, rejectedCents: 0, orderCount: 1 });
  });

  it('rejects a write for a missing order and leaves the projection untouched', async () => {
    const { company } = await seedLookup(prisma);
    await expect(app.orderService.approveOrder('does-not-exist')).rejects.toBeInstanceOf(NotFoundException);

    const page = await app.operationsService.listOperations({ companyId: company.id, page: 1, pageSize: 20 });
    const totals = await app.operationsService.getCompanyTotals(company.id);
    expect(page.items).toEqual([]);
    expect(totals.orderCount).toBe(0);
    expect(totals.totalCents).toBe(0);
  });
});
```
Wait: `const prisma = connect();` at describe scope — module-evaluated; if no DATABASE_URL, PrismaClient constructor throws at import time? `new PrismaClient()` without DATABASE_URL: PrismaClient constructor with `datasource url = env("DATABASE_URL")` — throws "error: Environment variable not found: DATABASE_URL" on construction (actually on first query? I think on instantiation with the env-based url — Prisma validates on connect, but env resolution happens at client init… I believe `new PrismaClient()` without DATABASE_URL throws immediately with a P1012-ish message "error: Environment variable not found: DATABASE_URL".) To be safe, move construction inside beforeAll:

```ts
let prisma: PrismaClient;
let app: ReturnType<typeof buildServices>;
beforeAll(async () => {
  prisma = connect();
  await resetSchema(prisma);
  app = buildServices(prisma);
});
```
And tests reference `prisma`/`app` via closure (let). Vitest handles that.

Hmm, `describe.skipIf(!hasDatabase)` — if skipped, beforeAll doesn't run.

Also — `resetSchema` drops tables that may not exist (IF EXISTS) and then applies the migration. If the DB already has these tables with data from a previous run, the drop wipes them — fine for tests (dedicated test DB is assumed).

**test/concurrent-totals.spec.ts**:

```ts
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { connect, hasDatabase, resetData, resetSchema } from './helpers/db';
import { buildServices } from './helpers/services';
import { seedLookup } from './helpers/seed';

describe.skipIf(!hasDatabase)('concurrent updates to one company totals', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildServices>;

  beforeAll(async () => { prisma = connect(); await resetSchema(prisma); app = buildServices(prisma); });
  beforeEach(async () => { await resetData(prisma); });
  afterAll(async () => { await prisma.$disconnect(); });

  it('keeps totals exact when 20 orders of the same company are approved concurrently', async () => {
    const { company } = await seedLookup(prisma);
    const orders = await Promise.all(
      Array.from({ length: 20 }, (_, i) => app.orderService.createOrder({ companyId: company.id, amountCents: 7777 })),
    );

    // All approvals target the same company_totals row and run in parallel,
    // each in its own transaction.
    await Promise.all(orders.map((o) => app.orderService.approveOrder(o.id)));

    const totals = await app.operationsService.getCompanyTotals(company.id);
    const expected = 20 * 7777;
    expect(totals.orderCount).toBe(20);
    expect(totals.totalCents).toBe(expected);
    expect(totals.approvedCents).toBe(expected);
    expect(totals.rejectedCents).toBe(0);

    // Cross-check against the source: the projection must equal the truth.
    const source = await prisma.paymentOrder.aggregate({ where: { companyId: company.id }, _count: { _all: true }, _sum: { amountCents: true } });
    expect(Number(source._sum.amountCents ?? 0n)).toBe(totals.totalCents);
    expect(source._count._all).toBe(totals.orderCount);
  });

  it('keeps totals exact when approve and reject race on the same totals row', async () => {
    const { company } = await seedLookup(prisma);
    const approved = await app.orderService.createOrder({ companyId: company.id, amountCents: 1111 });
    const rejected = await app.orderService.createOrder({ companyId: company.id, amountCents: 2222 });

    await Promise.all([app.orderService.approveOrder(approved.id), app.orderService.rejectOrder(rejected.id)]);

    const totals = await app.operationsService.getCompanyTotals(company.id);
    expect(totals.totalCents).toBe(3333);
    expect(totals.approvedCents).toBe(1111);
    expect(totals.rejectedCents).toBe(2222);
    expect(totals.orderCount).toBe(2);
  });
});
```
`prisma` is used in a test → need `let prisma: PrismaClient;` typed — import PrismaClient.

Note on concurrency: 20 creates also parallel — separate rows, fine.

Hmm — will 20 parallel approvals actually interleave at the totals-row level? Each tx: source update (locks the order row) + totals increment (locks the totals row). They'll be serialized at the totals row; without an atomic increment (i.e., read-modify-write), lost updates would be likely. The test proves the final state. Good enough — "prove it in a test that runs the two concurrently rather than in a sequence". ✓.

**test/drift-repair.spec.ts**:

```ts
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { connect, hasDatabase, resetData, resetSchema } from './helpers/db';
import { buildServices } from './helpers/services';
import { seedLookup } from './helpers/seed';

describe.skipIf(!hasDatabase)('drift repair', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildServices>;

  beforeAll(async () => { prisma = connect(); await resetSchema(prisma); app = buildServices(prisma); });
  beforeEach(async () => { await resetData(prisma); });
  afterAll(async () => { await prisma.$disconnect(); });

  async function seedTwoOrders() {
    const { company, worker, event } = await seedLookup(prisma);
    const pending = await app.orderService.createOrder({ companyId: company.id, workerId: worker.id, eventId: event.id, amountCents: 1000 });
    const approved = await app.orderService.createOrder({ companyId: company.id, workerId: worker.id, eventId: event.id, amountCents: 2000 });
    await app.orderService.approveOrder(approved.id);
    return { company, pending, approved };
  }

  it('detects and repairs injected drift (stale status, missing row, wrong totals)', async () => {
    const { company, pending, approved } = await seedTwoOrders();

    // Inject three kinds of drift straight into the projection.
    await prisma.$executeRaw`UPDATE ops_rows SET status = 'approved' WHERE id = ${pending.id}`; // stale status
    await prisma.$executeRaw`DELETE FROM ops_rows WHERE id = ${approved.id}`; // missing row
    await prisma.$executeRaw`UPDATE company_totals SET approved_cents = approved_cents + 1 WHERE company_id = ${company.id}`; // wrong totals

    const report = await app.driftRepairService.repairRecentWindow();

    expect(report.repaired).toBe(true);
    expect(report.driftedOrders).toBe(2);
    expect(report.driftedCompanies).toBe(1);

    // Projection matches the source again.
    const rows = await prisma.opsRow.findMany({ where: { companyId: company.id }, orderBy: { id: 'asc' } });
    expect(rows.map((r) => ({ id: r.id, status: r.status }))).toEqual([
      { id: pending.id, status: 'pending' },
      { id: approved.id, status: 'approved' },
    ]);
    const totals = await app.operationsService.getCompanyTotals(company.id);
    expect(totals.totalCents).toBe(3000);
    expect(totals.approvedCents).toBe(2000);
    expect(totals.rejectedCents).toBe(0);
    expect(totals.orderCount).toBe(2);
  });
```
Wait — drift injection: `UPDATE ops_rows SET status='approved' WHERE id=pending.id` — source pending is 'pending' → row differs → drift detected. approved row deleted → NOT EXISTS → drift. totals approved_cents +1 → totals drift. Detection: driftedOrders = 2 (both orders). driftedCompanies: row drift gives company_id (2 rows → same company) + totals drift same company → set = 1. ✓.

Hmm — careful with drift detection for pending: comparison includes `r.occurred_at = po.updated_at` (unchanged, equal), amount equal, worker/event names equal, status differs → NOT EXISTS true → flagged. ✓.

One gotcha: the rederivation rebuild uses window [to - lookback, to]; orders' updated_at ≈ now (seeded a moment before). The approved order's updated_at = approval time < repair's `to`. ✓ within window.

But: the drift injection `UPDATE ops_rows ...` doesn't change source updated_at → still in window. ✓.

```ts
  it('repairs a window that the re-derivation rebuilt, even when totals alone drifted', async () => {
    const { company } = await seedTwoOrders();
    await prisma.$executeRaw`UPDATE company_totals SET total_cents = total_cents - 5 WHERE company_id = ${company.id}`;
    const report = await app.driftRepairService.repairRecentWindow();
    expect(report.repaired).toBe(true);
    expect(report.driftedOrders).toBe(0);
    const totals = await app.operationsService.getCompanyTotals(company.id);
    expect(totals.totalCents).toBe(3000);
  });

  it('does nothing when the projection already matches the source', async () => {
    const { company } = await seedTwoOrders();
    const before = await prisma.opsRow.findMany({ where: { companyId: company.id } });
    const report = await app.driftRepairService.repairRecentWindow();
    expect(report.repaired).toBe(false);
    expect(report.driftedOrders).toBe(0);
    expect(report.rowsRebuilt).toBe(0);
    const after = await prisma.opsRow.findMany({ where: { companyId: company.id } });
    expect(after).toEqual(before);
  });
});
```

**test/rederive.spec.ts**:

```ts
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { connect, hasDatabase, resetData, resetSchema } from './helpers/db';
import { buildServices } from './helpers/services';
import { seedLookup } from './helpers/seed';

describe.skipIf(!hasDatabase)('windowed re-derivation', () => {
  ... same setup ...

  it('rebuilds the projection for a window from the source tables', async () => {
    const before = new Date(Date.now() - 60_000);
    const { company, worker, event } = await seedLookup(prisma);
    const a = await app.orderService.createOrder({ companyId: company.id, workerId: worker.id, eventId: event.id, amountCents: 100 });
    const b = await app.orderService.createOrder({ companyId: company.id, workerId: worker.id, eventId: event.id, amountCents: 200 });
    const c = await app.orderService.createOrder({ companyId: company.id, amountCents: 300 });
    await app.orderService.approveOrder(a.id);
    await app.orderService.rejectOrder(b.id);
    const after = new Date();

    // Wipe the projection so the re-derivation has to rebuild it.
    await prisma.$executeRaw`TRUNCATE ops_rows, company_totals`;

    const result = await app.projectionService.rederiveWindow(before, after);

    expect(result.rowsRebuilt).toBe(3);
    expect(result.companiesRecomputed).toBe(1);

    const rows = await prisma.opsRow.findMany({ where: { companyId: company.id }, orderBy: { id: 'asc' } });
    expect(rows.map((r) => ({ id: r.id, status: r.status, amountCents: Number(r.amountCents) }))).toEqual([
      { id: a.id, status: 'approved', amountCents: 100 },
      { id: b.id, status: 'rejected', amountCents: 200 },
      { id: c.id, status: 'pending', amountCents: 300 },
    ]);
    // Denormalized names survive the rebuild.
    expect(rows[0].workerName).toBe('Wendy');
    expect(rows[0].eventName).toBe('Launch');
    expect(rows[2].workerName).toBeNull();

    const totals = await app.operationsService.getCompanyTotals(company.id);
    expect(totals.totalCents).toBe(600);
    expect(totals.approvedCents).toBe(100);
    expect(totals.rejectedCents).toBe(200);
    expect(totals.orderCount).toBe(3);
  });

  it('leaves the same result when run twice over the same window', async () => {
    const before = new Date(Date.now() - 60_000);
    const { company } = await seedLookup(prisma);
    const a = await app.orderService.createOrder({ companyId: company.id, amountCents: 111 });
    await app.orderService.approveOrder(a.id);
    const after = new Date();

    await app.projectionService.rederiveWindow(before, after);
    const first = await snapshot(prisma, company.id);
    await app.projectionService.rederiveWindow(before, after);
    const second = await snapshot(prisma, company.id);

    expect(second).toEqual(first);
  });
});

async function snapshot(prisma: PrismaClient, companyId: string) {
  const [rows, totals] = await Promise.all([
    prisma.opsRow.findMany({ where: { companyId }, orderBy: { id: 'asc' } }),
    prisma.companyTotal.findUnique({ where: { companyId } }),
  ]);
  return {
    rows: rows.map((r) => ({ id: r.id, status: r.status, amountCents: Number(r.amountCents), occurredAt: r.occurredAt, workerName: r.workerName, eventName: r.eventName })),
    totals: totals ? { totalCents: Number(totals.totalCents), approvedCents: Number(totals.approvedCents), rejectedCents: Number(totals.rejectedCents), orderCount: totals.orderCount } : null,
  };
}
```
Cuid id order: cuid is time-sorted — creation order is preserved. `orderBy id asc` ≈ creation order. a, b, c are created sequentially → ids sortable. ✓ (cuid1 is monotonic-ish; same ms → random suffix… actually cuid embeds a counter for same ms → still monotonic. Yes, cuid is monotonically increasing.) Fine.

Hmm — `TRUNCATE ops_rows, company_totals` — company_totals has an FK to companies (no cascade from ops), fine.

One more check — rederivation window [before, after): the approval of `a` sets updated_at=at (in between before/after). ✓. `after` is captured after all writes → `updated_at < after` holds (updates happen before `after` is captured; `at = new Date()` at transition time ≤ `after`). ✓. Edge: `at` could be equal to `after` (same ms) → `updated_at < after` excludes equal! If `at`'s ms == `after`'s ms → strict `<` drops the row! Dangerous. Let me make `after` safer: `const after = new Date(Date.now() + 60_000)` — window upper bound in the future. Similarly `before = now - 60_000` is safe (created after). Let me do: `const after = new Date(Date.now() + 60_000);` — a future boundary, guaranteed `updated_at < after`. Good.

Similarly in the drift test, repairRecentWindow uses to=now: orders' updated_at < now strictly — could updated_at ms == to ms? The seed happens before repairRecentWindow() call; to = new Date() at call time — later than seed's `at`. Same ms is possible if fast! If the update's `at` ms equals `to` ms → `updated_at < to` excludes → drift not detected → test flakily fails! Hmm. Mitigation: in `repairRecentWindow`, the window is `[to - lookback, to]` with `updated_at < to`. A write in the same ms as `to` is excluded — a real edge in production too (a write in the same millisecond as the job start). Lookback 24h, the next cycle covers it. But in tests, flake risk. Mitigation in test: seed, then `await new Promise(r => setTimeout(r, 5))` before repair → guarantees updated_at ms < to ms. Add a small sleep helper. Or make the repair window `[from, to]` inclusive (`<=`)? Rederivation is `>= from AND < to`; drift detection should match the same semantics. Inclusive `to` (`<= to`) is fine too (idempotent). Let me use `<=` for the boundary in `to`… but then a write exactly at `to` and a write just after `to` — a later cycle's from = earlier to - … overlapping windows are fine (idempotent). Let me use `<= ${to}` in the detection and rederivation window predicate. Hmm — but the rederivation with `<= to`: a write at exactly to and its… fine.

Actually, cleanest for tests: keep `< to` and add a 5ms sleep before repair in the test. But the drift spec calls `repairRecentWindow()` which computes `to` itself. Insert `await sleep(5)` after seeding, before the call. Let me add a `sleep` helper and use it in the drift spec (2 places) — acceptable. Or switch to `<=`. Let me go with `<=` in the SQL (both rederivation and detection) — simpler, no sleep needed, and semantically "window inclusive on both ends" is defensible: `updated_at >= from AND updated_at <= to`. The overlap on the boundary between consecutive cycles is harmless (idempotent). Decision: `<=` on both.

Wait, then in the rederive spec, `after = Date.now()` (not +60s) works with `<=`. I'll still set `after = new Date()` after the writes — `updated_at <= after` holds even in the same ms. ✓.

Now — the `before` boundary: `>= before`, before = now-60s; orders created after → included. ✓.

Now — a subtlety in the drift detection SQL: for a deleted ops row (missing), NOT EXISTS → flagged. For a company whose all rows drifted and are missing — the totals CTE is a separate query, fine.

Another subtlety: the drift repair test "no-op": `report.rowsRebuilt === 0` — no drift → no rederivation → 0. ✓.

Now — the `@Interval` import from @nestjs/schedule in the drift-repair service — the decorator needs the scheduler to be active only in the app; in tests, the service is constructed directly, the decorator is inert. ✓.

**ESM + decorators under Vitest**: Vitest (esbuild) handles decorators? esbuild supports experimentalDecorators if tsconfig sets it… esbuild since 0.21 supports experimentalDecorators + emitDecoratorMetadata? esbuild 0.21.3+ emits decorator metadata? Actually esbuild added `useDefineForClassFields` respect and experimental decorators support; metadata emission: esbuild does not emit design:paramtypes (docs: "esbuild does not support emitting decorator metadata"). But with explicit @Inject everywhere, we don't need metadata. Nest decorators (@Injectable, @Module, etc.) are just decorator calls — esbuild transforms them fine with `experimentalDecorators: true`. Vitest reads tsconfig for esbuild options (vitest uses esbuild with tsconfig experimentalDecorators — yes, it respects tsconfig's `experimentalDecorators` and `useDefineForClassFields`). Vitest 1.x: esbuild reads tsconfig for `experimentalDecorators` and `useDefineForClassFields`. ✓.

Class fields: with `useDefineForClassFields: false`, TS compiles `private readonly db = ...`? Constructor param properties aren't class fields. I have no class property assignments except `logger`/`privates` in constructors. ✓.

DTOs with `!` properties: with useDefineForClassFields false → no field emission; class-validator reads the instance (populated by ValidationPipe's transform). ✓.

**Nest DI with explicit @Inject in modules**: controllers `@Inject(OperationsService)`; services `@Inject(OrderRepository)`, etc. Modules declare providers as classes; Nest resolves by class token. ✓.

PrismaService — global module; `@Inject(PrismaService)` in the repository. ✓.

Now — one more requirement check: "Maintenance hooks invoked from the write services (simulate the write path)" ✓ (OrderService is the write service; controller simulates the HTTP write path).

"Rederivation routine for arbitrary date windows" ✓ `ProjectionService.rederiveWindow(from, to)`.

"Scheduled drift repair job" ✓ `@Interval` + DriftRepairModule; env-configurable.

"New dashboard query" ✓ GET /operations (projection-only, covering index).

"Tests for read-your-own-writes, concurrent total, drift repair" ✓ 4 spec files.

"DESIGN.md" ✓.

Now, do I need a `.env.example`? Convention: config only from env; DATABASE_URL. An `.env.example` documenting variables (DATABASE_URL, PORT, DRIFT_REPAIR_INTERVAL_MS, DRIFT_REPAIR_LOOKBACK_HOURS) — helpful, small. "Don't create files it doesn't ask for"… the environment section implies env vars; an example file is standard. Hmm — it's borderline; I'll include `.env.example` since it documents the required env without secrets. Defensible as "solution needs it" for runnability. Keep minimal.

README? Not requested. Skip. DESIGN.md covers the rationale.

Also double-check that the `OperationsFilter.status` type is OrderStatus — controller passes `query.status` typed as a union 'pending'|'approved'|'rejected' → matches OrderStatus values (Prisma's enum type = 'pending'|'approved'|'rejected'). ✓.

`where.status = f.status` — OpsRowWhereInput.status?: OrderStatus | EnumOpsRowFilter… assigning a string enum is fine.

`prisma.opsRow.findMany` — model OpsRow → delegate `opsRow`. ✓. `prisma.companyTotal` → CompanyTotal. ✓.

The seed uses `prisma.event.create` — model Event → delegate `event`. ✓.

`prisma.paymentOrder.aggregate({ _sum: { amountCents: true }, _count: { _all: true } })` — result: `{ _sum: { amountCents: bigint | null }, _count: { _all: number } }`. ✓.

Now — BigInt in JSON: service maps to Number before returning. Controller returns the service object → JSON-safe. ✓. `OrderService.approveOrder` returns a PaymentOrder (with BigInt amountCents!) → the controller's JSON serialization fails (Express's JSON.stringify throws on BigInt: "Do not know how to serialize a BigInt")! Oops. `createOrder`/`approveOrder` return `PaymentOrder` with amountCents: BigInt → Express's res.json throws → 500. Fix: map in the controller? "Zero business logic in the controller" — a serializer map is arguably presentation, but… cleaner: have the service return a plain DTO. Let me make OrderService return an `OrderView`:

```ts
export interface OrderView {
  id: string;
  companyId: string;
  workerId: string | null;
  eventId: string | null;
  status: OrderStatus;
  amountCents: number;
  createdAt: Date;
  updatedAt: Date;
}
```
And a mapper `toView(order: PaymentOrder): OrderView`. Service returns the view. Tests use the view's fields (order.id, order.status) — tests currently use `order.id` ✓ (the view has id). The concurrent test uses only `o.id`. The read-your-own-writes test uses `order.id`. ✓.

Add the mapper in the order service:
```ts
function toView(order: PaymentOrder): OrderView {
  return { id: order.id, companyId: order.companyId, workerId: order.workerId, eventId: order.eventId, status: order.status, amountCents: Number(order.amountCents), createdAt: order.createdAt, updatedAt: order.updatedAt };
}
```

Now — the `transition` method's return type is Promise<OrderView>.

Tests: `app.orderService.createOrder(...)` returns an OrderView — seed helper? seedLookup uses prisma directly. ✓.

Now — Prisma + `Prisma.TransactionClient` in raw `$executeRaw` inside interactive tx: `tx.$executeRaw` is supported (Tx client has $executeRaw). ✓.

One more: the interactive transaction `this.db.$transaction(fn)` — the default timeout 5s? The rederivation of a large window could exceed… In tests, it's small. In production, set the timeout: `this.db.$transaction(fn, { timeout: 30_000 })`. Add it to the projection's rederivation transaction (a long-running one). Order writes stay at the default. Good detail.

Now `applyTotalsDelta` — numbers: negative deltas? Not used (no deletes) but supported by the SQL (arithmetic). Fine.

**Envelope filter** — ValidationPipe error: body `{ statusCode: 400, message: [...], error: 'Bad Request' }` → message joined, details = { fields }. Envelope code validation_failed. ✓.

**Now let me write the DESIGN.md** — "short". ~60–90 lines.

Content:
# DESIGN.md — Operations dashboard projection
## What we shipped
- ops_rows: 1 row per payment order, denormalized (worker/event names, status, amount, occurred_at=source updated_at). The dashboard reads only this.
- company_totals: 1 row per company, exact financial totals, updated with in-place increments.
- Hooks inside the write tx; rederivation; drift repair; covering index.
## Why the hook runs in the write's transaction
Read-your-own-writes: any async mechanism (post-commit, queue, CDC, schedule) has a window; rejected alternatives with reasons; atomicity with rollback; cost.
Rejected alternatives: (list).
## Exact totals under concurrency
In-place increment ON CONFLICT DO UPDATE; row lock; why not read-modify-write.
## Rederivation and drift repair
Window on updated_at; idempotent upsert + full aggregate; single tx; safe while live (idempotent statements; a concurrent writer lands in this or the next cycle).
Drift = periodic diff + rederivation.
## What the operator sees
Same columns/filters/order/pagination; covering index → index-only scan; count query also index-only.
## Tradeoffs/limits
Write latency +~1ms; hook failure fails the write (by design) with repair as backfill; renames not hooked (drift repair covers); BigInt cents as number in raw SQL at our scale.

Keep tight.

Now — final check on file list:

1. `package.json`
2. `tsconfig.json`
3. `vitest.config.ts`
4. `.env.example`
5. `prisma/schema.prisma`
6. `prisma/migrations/20240101000000_init/migration.sql`
7. `src/main.ts`
8. `src/app.module.ts`
9. `src/prisma/prisma.module.ts`
10. `src/prisma/prisma.service.ts`
11. `src/common/exception.filter.ts`
12. `src/orders/orders.module.ts`
13. `src/orders/order.controller.ts`
14. `src/orders/order.service.ts`
15. `src/orders/order.repository.ts`
16. `src/orders/create-order.dto.ts`
17. `src/projection/projection.module.ts`
18. `src/projection/projection.service.ts`
19. `src/projection/projection.repository.ts`
20. `src/operations/operations.module.ts`
21. `src/operations/operations.controller.ts`
22. `src/operations/operations.service.ts`
23. `src/operations/operations.repository.ts`
24. `src/operations/list-operations-query.dto.ts`
25. `src/drift-repair/drift-repair.module.ts`
26. `src/drift-repair/drift-repair.service.ts`
27. `src/drift-repair/drift-repair.repository.ts`
28. `test/helpers/db.ts`
29. `test/helpers/services.ts`
30. `test/helpers/seed.ts`
31. `test/read-your-own-writes.spec.ts`
32. `test/concurrent-totals.spec.ts`
33. `test/drift-repair.spec.ts`
34. `test/rederive.spec.ts`
35. `DESIGN.md`

Wait — file naming convention: "TS files: `kebab-case.role.ts`" → `order.service.ts` not `orders.service.ts`? The layout example shows `src/<feature>/<feature>.module.ts` with `<feature>` — the feature folder `orders` and file `order.service.ts`? The example uses singular: `payout.service.ts` in `src/payout/`. So the feature folder is singular `payout` and file `payout.service.ts`. My features: orders, operations, projection, drift-repair, prisma. Files: `orders/order.service.ts`? Or the folder `order`? The example: `src/payout/payout.module.ts`. So folder=feature name and file repeats the feature name: `orders/orders.service.ts`? If the feature is "orders", then per the pattern, file `orders.service.ts`… but the domain entity is "order". The pattern `<feature>.controller.ts` — if the feature folder is `orders`, the file is `orders.controller.ts`? Reads awkwardly. The example is a singular feature (`payout`). Let me name features singular where natural: `order`, `operations`, `projection`, `drift-repair`. So:

- `src/order/order.module.ts`, `order.controller.ts`, `order.service.ts`, `order.repository.ts`, `create-order.dto.ts` (hmm — is the dto a `create-order.dto.ts` file — a `kebab-case.role.ts` pattern; `dto` as role: `create-order.dto.ts` matches `kebab-case.role.ts`. OK)
- `src/operations/operations.module.ts`, `operations.controller.ts`, `operations.service.ts`, `operations.repository.ts`, `list-operations-query.dto.ts`
- `src/projection/projection.module.ts`, `projection.service.ts`, `projection.repository.ts`
- `src/drift-repair/drift-repair.module.ts`, `drift-repair.service.ts`, `drift-repair.repository.ts`
- `src/prisma/prisma.module.ts`, `prisma.service.ts`
- `src/common/exception.filter.ts`
- `src/app.module.ts`, `src/main.ts`

Endpoints kebab-case plural: `/orders`, `/orders/:id/approve`, `/orders/:id/reject`, `/operations`, `/operations/companies/:companyId/totals`. "Approve/reject" are actions — sub-routes; fine (kebab-case).

Now — imports across features use relative paths: `../projection/projection.service`.

Let me reconsider `@Interval(() => ...)` — @nestjs/schedule's `@Interval(msOrFn?)` — signature: `@Interval(timeout: number | (() => number), options?)`. ✓.

Also — the drift-repair service logs via Logger. In tests, no logs (decorator inert). ✓.

One more design question: `ProjectionService.rederiveWindow` uses `repo.withTransaction(fn, { timeout: 30000 })` — `withTransaction` signature: `(fn) => this.db.$transaction(fn)`. Add an optional options parameter:
```ts
withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, options?: { timeout?: number }): Promise<T> {
  return this.db.$transaction(fn, options as Prisma.TransactionOptions | undefined);
}
```
Hmm, `Prisma.TransactionOptions` — exists? In Prisma 5, `Prisma.TransactionOptions` = InteractiveTransactionOptions. `this.db.$transaction(fn, { timeout: 30000 })` — typed overload accepts `Prisma.ITransactionOptions`… actually, the type is: `$transaction<R>(fn: (prisma: Omit<PrismaClient, ...>) => Promise<R>, options?: Omit<Prisma.ITransactionOptions, 'isolationLevel'>): Promise<R>`. Passing `{ timeout }` is fine. Keep it simple: hardcode `{ timeout: 30_000 }` in rederiveWindow's call: `this.db.$transaction(fn, { timeout: 30_000 })` — but withTransaction is a repository helper… Let me make it `withTransaction(fn, { timeout })` and forward. Let me write:

```ts
withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, timeoutMs?: number): Promise<T> {
  return timeoutMs === undefined
    ? this.db.$transaction(fn)
    : this.db.$transaction(fn, { timeout: timeoutMs });
}
```
Clean.

ProjectionService.rederiveWindow: `this.repo.withTransaction((tx) => this.repo.rederiveWindow(tx, from, to), 30_000)`.

Now — let me re-check the drift detection SQL's correctness for a stale-status injection: pending order's row status 'approved'. `NOT EXISTS (r ... AND r.status = po.status ...)` → r.status='approved' ≠ po.status='pending' → no matching r → NOT EXISTS true → flagged. ✓.

For a missing row (deleted): NOT EXISTS trivially true. ✓.

Totals drift only: total_cents 2995 vs source 3000 → flagged. ✓ driftedOrders=0, driftedCompanies=1 → repaired=true, rederivation → totals fixed. Test 2 ✓.

Now the "no-op" test: `report.driftedCompanies` is 0 too — assert both 0. ✓.

Potential issue — the `findDrift` totals CTE: `WHERE po.company_id IN (SELECT company_id FROM windowed)` — windowed = distinct companies with orders in the window. In the no-op test, the company has orders in the window → source CTE computes; matches totals → no drift. ✓.

Now — a subtle production concern: drift detection only covers orders in the recent window; a permanent drift on an old order (updated long ago) is never repaired. Lookback 24h and updates move updated_at, so… if someone manually edits an old order's source row (manual data fix), updated_at moves (if the fix updates it) → covered. If the fix sets updated_at to preserve? Edge; document in DESIGN.md: the repair window follows recent activity; older permanent drift needs a backfill rederivation with a wider window (the same routine, different parameters). Good.

Now the `OperationsController` route `@Get('companies/:companyId/totals')` — full path `/operations/companies/:companyId/totals`. Fine.

`ValidationPipe` with `transform: true` — query DTO: numeric strings converted via @Type. ✓.

Edge — `ListOperationsQueryDto.status` is optional union-typed; `@IsIn([...])`. ✓.

Now, the DTO's `!` and strict TS: `companyId!: string` OK.

**Potential issue: class-validator + `@IsDateString()` for from/to** — ISO string. Controller `new Date(query.from)`. ✓.

**Envelope filter for 409 ConflictException**: `new ConflictException('message')` → getResponse = { statusCode: 409, message, error: 'Conflict' } → message is a string → message; details {}. code 'conflict'. ✓.

Now — one more consideration on the layering rule: "Service holds the logic. Zero raw SQL, zero Prisma client calls". The OrderService calls `this.orders.withTransaction(...)` — repository. ✓. ProjectionService calls only the projection repository. ✓. DriftRepairService calls drift repository + projection service. ✓. OperationsService calls operations repository. ✓.

"Controller validates input and calls the service. Zero business logic." — the controller does the DTO→params mapping (dates, defaults) — that's input shaping, fine.

**Wiring rule**: "A provider used by another module is exportsed by its own module and that module is imported by the other" — ProjectionModule exports ProjectionService; OrdersModule and DriftRepairModule import ProjectionModule. ✓. PrismaModule is @Global — the rule says exports+imports; a global module is the standard alternative; but to strictly follow the convention, should I drop @Global and explicitly import PrismaModule in every module that needs PrismaService? The convention's wording: "A provider used by another module is exportsed by its own module and that module is imported by the other". To comply literally, I'll add `imports: [PrismaModule]` to order, projection, operations, drift-repair modules, and keep PrismaModule's exports (drop @Global?). Keep @Global too? Harmless, but if I want to be strict, drop @Global and import everywhere. Hmm — the prisma module is infra; @Global is idiomatic. But the convention is explicit: "no exceptions". I'll drop @Global and import PrismaModule in the four feature modules. More verbose, compliant. Actually — keep it simple: drop @Global; add PrismaModule to imports in each feature module.

Wait, does the controller need Prisma? No. ✓.

**Vitest + PrismaClient in tests**: `new PrismaClient()` uses DATABASE_URL ✓. The Prisma client must be generated (`prisma generate`) before running tests — the devDep prisma; note in the test helper? I can't run commands. I assume `pnpm install && pnpm generate && pnpm test`. Should I document it? There's no README; DESIGN.md or a comment in the helper. Let me add a short comment in db.ts and in DESIGN.md's "running" section. Keep it minimal.

Now — `test/helpers/db.ts` `connect()` returns a new PrismaClient; each spec file has its own client. Multiple parallel vitest workers → separate DBs? They share the same DATABASE_URL DB and truncate tables in beforeEach — race across spec files (vitest runs files in parallel workers by default!). `resetSchema` drops tables that another file may be using!! Dangerous. Fix: run test files serially: vitest config `fileParallelism: false` (vitest 1.x: `test: { fileParallelism: false }`? In vitest 1.6, the option is `fileParallelism` (renamed from `threads`/`singleThread`?). Vitest 1.x: `test: { fileParallelism: false }` — yes, available since 1.0? `singleThread` + … hmm. Vitest 1.x options: `pool: 'threads' | 'forks'`, `fileParallelism: boolean` (default true) — I believe `fileParallelism` exists in vitest 1.2+. To be safe, `pool: 'forks', poolOptions: { forks: { singleFork: true } }`? That's older API…

Simplest robust: `test: { fileParallelism: false }` — I'm fairly confident this option exists in vitest ≥1.0 (it replaced `threads: false`… actually, `fileParallelism` was added in Vitest 1.1? Let me think — Vitest 1.0 has `test.threads` (boolean, deprecated) and `test.singleThread`. Hmm. In Vitest 2.x, `fileParallelism`. Since I'm pinning vitest ^1.6, `singleThread: true` + … `singleThread` makes tests run in a single worker thread, but files may still interleave? `singleThread: true` → all files run sequentially in one worker. I think that's right: `singleThread` forces sequential execution in a single thread pool worker. Safer bet: set both `singleThread: true` and `fileParallelism: false` — if one is unknown, it's an ignored key (Vitest validates config strictly? Unknown keys are warned, not errored). Hmm, warnings are ugly.

Alternative avoiding config semantics: give each spec file its own database schema! Use `CREATE SCHEMA` per file and Prisma's `schema` option? PrismaClient constructor `datasources: { db: { schema } }`? Prisma supports schema selection via env `schema` in the url or `datasources: { db: { schemas: [...] } }`? For Postgres multi-schema: `new PrismaClient({ datasources: { db: { schema: 'test_foo' } } })` — supported in Prisma 4.x+ ("schema" option in datasources for PG). Then each file: create its schema, `prisma.$use`? Hmm, does the migration apply to that schema? The migration uses public-qualified tables — no schema qualification. `$executeRawUnsafe` runs in the default search_path (public). To target a custom schema, set `SET search_path` per connection — with a pool, that's flaky.

Overkill. Decision: set `fileParallelism: false` in vitest.config.ts, and pin vitest to a version where it's valid. Let me pin to vitest ^2.0.0? Vitest 2 is stable (2024). In vitest 2, `fileParallelism` is the correct option (default true). I'll use vitest ^2.1.0 and `fileParallelism: false`. Then all spec files run sequentially in a single fork; each file's resetSchema wipes the shared DB; no cross-file race. Within a file, tests run sequentially by default. ✓.

Hmm, but `fileParallelism: false` with the default pool forks → single worker. OK.

Actually, wait — is that still true in vitest 2? Yes, `fileParallelism: false` runs files sequentially. I'll add a comment: "The suites share one Postgres database (DATABASE_URL), so files must not run in parallel."

Also `testTimeout` 30s, `hookTimeout` 60s (resetSchema is fast).

**Another potential pitfall**: multiple PrismaClient instances across the serial spec files each connect — each file disconnects in afterAll. ✓.

**Prisma client generation**: tests import `@prisma/client` — without a generated client, import fails. The developer must run `prisma generate` (postinstall? I can add `"postinstall": "prisma generate"` — standard for Prisma projects; adds robustness. Include it.)

Now — let me double-check the **`$executeRaw` tagged template with a leading newline/whitespace** — fine.

**`$executeRaw` with a `number` param into a BIGINT column** — pg driver sends the number as a literal; Postgres casts. ✓. For `amount_cents` comparisons in the detection SQL (both BIGINT) ✓.

**`$queryRaw<DriftedRowDto[]>`** — snake_case keys from the raw query: `company_id`. DTO `{ id: string; company_id: string }`. ✓.

Now — the `OperationsRepository.filterOf` — `where.occurredAt = occurredAt` where occurredAt is a partial filter with both undefined? I only set it when from||to. ✓.

**Stable pagination order**: `orderBy: [{occurredAt: 'desc'}, {id:'desc'}]` — matches the index. The count query is separate. ✓.

Now — the **read-your-own-writes "with no delay"** requirement — the test asserts immediately after the service call returns. Since the tx is committed by the service (withTransaction returns after commit), the next read sees it. ✓ (that's the whole point of in-tx hooks + commit visibility).

Now — let me revisit whether `OrderService.transition` should handle approval of a `rejected` order, etc. — ConflictException with the status. ✓ Tested (double approval).

**Now let me write the DESIGN.md** — short.

Also — `.env.example`:
```
# Postgres connection string (required for the API and the test suite)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/marketplace_backoffice?schema=public

# API port
PORT=3000

# Drift repair: how often the job runs and how far back it compares
DRIFT_REPAIR_INTERVAL_MS=300000
DRIFT_REPAIR_LOOKBACK_HOURS=24
```
Hmm — "no secrets in the repo, no hardcoded connection strings" — an .env.example with a placeholder local string… that's an example, not a secret. Common practice. Keep it generic.

Let me now write out the final code for every file, being careful with TypeScript strictness.

**Check strict TS issues**:
- `const body = exception.getResponse();` type: `string | Record<string, any>`… `HttpException.getResponse(): string | object`. I handle both.
- DTO strictPropertyInitialization: `!` used. ✓.
- `Number(totals?.totalCents ?? 0n)` — bigint literal 0n, target ES2022 ✓.
- `Prisma.TransactionClient` exported from @prisma/client ✓ (namespace Prisma).
- In the projection repository, `import { Prisma, PrismaClient } from '@prisma/client'` — PrismaClient used as the parameter type. ✓.
- OrderRepository imports `Prisma` for the TransactionClient type; `OrderStatus` for the transition signature; types PaymentOrder, Company, Worker, Event. `Event` — no collision (no DOM lib). ✓.
- `order.controller.ts` — `@Inject(OrderService)`; the method returns a Promise<OrderView>. ✓.

**Vitest imports**: `import { beforeAll, ... } from 'vitest'` ✓.

**seed.ts**: returns types — `Company`, `Worker`, `Event` from @prisma/client. `prisma.event.create({ data: { title } })` ✓.

Now — one thing: in the concurrent test, `prisma.paymentOrder.aggregate` — the `prisma` variable is a let declared in the file scope, assigned in beforeAll; used in `it` — TS: `let prisma: PrismaClient;` then used — no strict-null issue (no strictNullChecks for let-before-assignment in closures — TS doesn't flag closures). ✓.

Let me re-check **`resetSchema`'s split** with the actual migration content. Let me finalize the migration text with `;` at end of each statement line and blank lines/comments between. Example chunk:

```
-- comment
CREATE TABLE "companies" (
  ...
)
```
Wait — my CREATE TABLE ends with `);` — the closing paren and semicolon: `);`. Then newline, blank, comment, next. Split on ';\n': chunk = `\n\n-- comment\nCREATE TABLE ... (\n  ...\n)` — the `;` is stripped. ✓.

Let me write the migration carefully:

```sql
-- Initial schema for the marketplace back-office.
--
-- Source tables: companies, workers, events, payment_orders.
-- Read-model projection: ops_rows (per-order dashboard rows) and
-- company_totals (exact per-company financial totals).
--
-- This migration is applied once by `prisma migrate deploy` and is also
-- executed verbatim by the test suite, which drops the tables first.

CREATE TABLE "companies" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL
);

CREATE TABLE "workers" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL
);

CREATE TABLE "events" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "title" TEXT NOT NULL
);

CREATE TABLE "payment_orders" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "company_id" TEXT NOT NULL,
  "worker_id" TEXT,
  "event_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "amount_cents" BIGINT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_orders_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "payment_orders_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Supports the windowed re-derivation / drift scan on the source table.
CREATE INDEX "payment_orders_updated_at_idx" ON "payment_orders" ("updated_at");

CREATE TABLE "ops_rows" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "company_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "amount_cents" BIGINT NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "worker_name" TEXT,
  "event_name" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL
);

-- Covering index for the dashboard access pattern:
--   WHERE company_id = ? [AND status = ?] AND occurred_at in range
--   ORDER BY occurred_at DESC, id DESC
-- The INCLUDE columns make the dashboard read an index-only scan.
CREATE INDEX "idx_ops_rows_lookup"
  ON "ops_rows" ("company_id", "status", "occurred_at" DESC, "id" DESC)
  INCLUDE ("amount_cents", "worker_name", "event_name", "created_at");

CREATE TABLE "company_totals" (
  "company_id" TEXT PRIMARY KEY NOT NULL,
  "total_cents" BIGINT NOT NULL DEFAULT 0,
  "approved_cents" BIGINT NOT NULL DEFAULT 0,
  "rejected_cents" BIGINT NOT NULL DEFAULT 0,
  "order_count" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "company_totals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
```

The rederivation scans `payment_orders WHERE updated_at >= ...` → needs an index on updated_at (not company+updated). Rederivation also uses company filter: `WHERE company_id IN (...)` — a seq scan is fine at repair scale, or use the company+updated index? The totals subquery `SELECT DISTINCT company_id FROM payment_orders WHERE updated_at between` → updated_at index. Then the outer `WHERE company_id IN (...)` → company_id index? There's no company_id-only index; company+updated exists → can't be used for an IN without the updated bound… A seq scan on 3M rows for the totals recompute is acceptable for a background job (or add `@@index([companyId])`). The source table at 3M rows — the rederivation full company aggregate for affected companies: `WHERE company_id IN (list)` — with a small list, a company_id index helps. Let me add both: `payment_orders_company_id_idx (company_id)` and `payment_orders_updated_at_idx (updated_at)`. And declare in schema.prisma. Fine — "appropriate indexes" for the repair path.

Update schema.prisma with these indexes on PaymentOrder:
```prisma
@@index([companyId], map: "payment_orders_company_id_idx")
@@index([updatedAt], map: "payment_orders_updated_at_idx")
```

And the migration creates both.

Now, the rederivation SQL uses `po.updated_at >= ${from} AND po.updated_at <= ${to}` — matches the detection's window semantics (`<=`). Keep `<=` in the detection. ✓.

Now — **the projection schema index** in schema.prisma with sort: `@@index([companyId, status, occurredAt(sort: Desc), id(sort: Desc)], map: "idx_ops_rows_lookup")`. Prisma 5 supports `sort` inside index. ✓ (The migration adds INCLUDE on top of it; I'll comment in schema.prisma that the migration adds INCLUDE columns for a covering index — since the schema can't express INCLUDE.)

Hmm — wait, would `prisma migrate dev` complain about the diff (the index exists with different def)? Out of scope for this exercise; the hand-written migration is the source of truth. I'll note in a schema comment.

Now **DESIGN.md** — let me draft it:

```md
# DESIGN.md — Operations dashboard projection

## Context

The operations list joins `payment_orders`, `events` and `workers`, filters by
company, status and date range, sorts by recency, and paginates. At ~3M orders
that is a 20–30s query. Target: p95 < 50ms, same visible result, two hard
constraints:

1. **Read your own writes** — approve an order and the next request must show it.
2. **Exact per-company financial totals** — finance reconciles against them.

## Shape of the solution

Two projection tables, both shaped like the read:

- `ops_rows` — one row per payment order, denormalized with `worker_name` /
  `event_name` so the hot path performs no join. `occurred_at` mirrors the
  source `updated_at` (recency of the current state).
- `company_totals` — one row per company with exact cents totals
  (`total_cents`, `approved_cents`, `rejected_cents`, `order_count`).

Indexes:

- `ops_rows (company_id, status, occurred_at DESC, id DESC) INCLUDE
  (amount_cents, worker_name, event_name, created_at)` — the dashboard is an
  index-only scan: equality on the leading columns, range on `occurred_at`,
  sort order built in, payload in the leaf pages. `id` breaks ties so
  pagination is stable.
- `payment_orders (updated_at)` and `(company_id)` — for re-derivation / drift
  scans.

## Why the maintenance hook runs in the writer's transaction

Read-your-own-writes is the whole design constraint. Every alternative to an
in-transaction hook has a visibility window:

| Alternative | Window in which own write is invisible |
|---|---|
| Scheduled refresh / materialized view | Up to the interval, however short |
| Post-commit hook → async worker/queue | Worker latency, unbounded under load |
| CDC / logical replication to the projection | WAL + consumer lag |
| DB trigger on a replica | Replication lag |

The requirement says *no* window, so the hook is a plain method call from the
write service, inside the same database transaction as the source write:

- the operator's write and its projection commit together — the next read,
  even on the same connection, sees both;
- if the write rolls back (guard failed, constraint error), the projection
  never saw it — no phantom rows, no torn totals;
- a hook that throws fails the write, which is the correct behavior: rather
  than serve a stale dashboard, the operator gets an error.

A Postgres trigger would give the same atomicity but hides business logic in
the schema: it is invisible to the service layer, harder to test, harder to
evolve, and splits the write path across two languages. The hook stays in
TypeScript where the rest of the write path lives.

## Exact totals under concurrency

Two concurrent approvals touch the same `company_totals` row. A
read-modify-write loses one increment. Instead, every change is an atomic
in-place increment:

```sql
INSERT INTO company_totals (...) VALUES (...)
ON CONFLICT (company_id) DO UPDATE SET
  total_cents = company_totals.total_cents + EXCLUDED.total_cents, ...
```

Postgres serializes these on the row lock; no read is involved, so nothing can
be lost. The concurrent-totals test exercises it with 20 parallel approvals on
one company.

## Re-derivation and drift repair

The projection is recoverable, not precious:

- `ProjectionService.rederiveWindow(from, to)` rebuilds every `ops_rows` entry
  for orders whose `updated_at` falls in the window (a straight join back to
  the source, as an `INSERT … ON CONFLICT` upsert) and recomputes the exact
  totals for every company the window touches (a full aggregate, not a delta).
  All statements are idempotent, so running it twice over the same window
  leaves the same result, and it is safe to run while the system is live: a
  concurrent write either lands in this rebuild or is picked up by the next
  cycle.
- `DriftRepairService` runs on a schedule (interval and lookback from the
  environment). Each run diffs the projection against the source for a recent
  window — stale/missing `ops_rows`, wrong `company_totals` — and, only if
  something disagrees, repairs it by re-deriving the window. It logs the
  result, so a mid-transaction deploy or a manual data fix is noticed by the
  system before a person notices it.

Drift is expected and handled; the in-transaction hook is what makes the
dashboard right in the normal case, and re-derivation is what makes it right
in every other case.

## What the operator sees

Unchanged: same columns, same filters (company, status, date range), same
ordering (recency, `id` as a stable tie-break), same page sizes. The query now
touches `ops_rows` only — no join to the source on the hot path — and the
count for pagination is a second index-only scan.

## Known trade-offs

- Each write pays for one row upsert plus one row increment in its own
  transaction: a few sub-millisecond, on rows the write already touches.
- Amounts cross between Prisma (BIGINT/BigInt) and raw SQL (numeric literal)
  as JS numbers; at this scale (cents) they stay far below 2^53.
- Worker/event renames are not hooked (the write path we simulate is the order
  lifecycle); the drift job converges those within one lookback window, and a
  wider `rederiveWindow` call repairs older history.
- The drift job's lookback window follows recent activity; a manual fix that
  doesn't bump `updated_at` on an old order needs a one-off `rederiveWindow`
  over a wider range (the same routine, different parameters).
```

That's reasonable and "short" (well, ~90 lines). OK.

Now, final check on the **file contents** for consistency. Let me carefully write each file.

Also — `src/main.ts` PORT env. ✓.

**OrderService** — full code:

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { OrderStatus, PaymentOrder } from '@prisma/client';
import { ProjectionService } from '../projection/projection.service';
import { OrderRepository } from './order.repository';

export interface CreateOrderInput {
  companyId: string;
  workerId?: string;
  eventId?: string;
  amountCents: number;
}

export interface OrderView {
  id: string;
  companyId: string;
  workerId: string | null;
  eventId: string | null;
  status: OrderStatus;
  amountCents: number;
  createdAt: Date;
  updatedAt: Date;
}

function toView(order: PaymentOrder): OrderView {
  return {
    id: order.id,
    companyId: order.companyId,
    workerId: order.workerId,
    eventId: order.eventId,
    status: order.status,
    amountCents: Number(order.amountCents),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

/**
 * Write path for payment orders (create / approve / reject). Every write runs
 * in a single database transaction that (1) mutates the source row and
 * (2) applies the matching projection hook, so the write and its projection
 * commit or roll back together.
 */
@Injectable()
export class OrderService {
  constructor(
    @Inject(OrderRepository) private readonly orders: OrderRepository,
    @Inject(ProjectionService) private readonly projections: ProjectionService,
  ) {}

  createOrder(input: CreateOrderInput): Promise<OrderView> {
    return this.orders.withTransaction(async (tx) => {
      const company = await this.orders.getCompany(tx, input.companyId);
      if (!company) throw new NotFoundException(`Company ${input.companyId} does not exist`);

      let workerName: string | null = null;
      let eventName: string | null = null;
      if (input.workerId !== undefined) {
        const worker = await this.orders.getWorker(tx, input.workerId);
        if (!worker) throw new NotFoundException(`Worker ${input.workerId} does not exist`);
        workerName = worker.name;
      }
      if (input.eventId !== undefined) {
        const event = await this.orders.getEvent(tx, input.eventId);
        if (!event) throw new NotFoundException(`Event ${input.eventId} does not exist`);
        eventName = event.title;
      }

      const at = new Date();
      const order = await this.orders.createOrder(tx, {
        companyId: input.companyId,
        workerId: input.workerId ?? null,
        eventId: input.eventId ?? null,
        amountCents: BigInt(input.amountCents),
        at,
      });

      await this.projections.onOrderCreated(tx, {
        id: order.id,
        companyId: order.companyId,
        status: order.status,
        amountCents: Number(order.amountCents),
        occurredAt: at,
        workerName,
        eventName,
        createdAt: at,
      });

      return toView(order);
    });
  }

  approveOrder(id: string): Promise<OrderView> {
    return this.transition(id, 'approved');
  }

  rejectOrder(id: string): Promise<OrderView> {
    return this.transition(id, 'rejected');
  }

  private transition(id: string, to: 'approved' | 'rejected'): Promise<OrderView> {
    return this.orders.withTransaction(async (tx) => {
      const at = new Date();
      const updated = await this.orders.transition(tx, id, 'pending', to, at);
      if (!updated) {
        const existing = await this.orders.findById(tx, id);
        if (!existing) throw new NotFoundException(`Order ${id} does not exist`);
        throw new ConflictException(`Order ${id} is ${existing.status} and cannot be ${to}`);
      }

      await this.projections.onOrderStatusChanged(tx, {
        id: updated.id,
        companyId: updated.companyId,
        fromStatus: 'pending',
        toStatus: to,
        amountCents: Number(updated.amountCents),
        occurredAt: at,
      });

      return toView(updated);
    });
  }
}
```

`order.status` is OrderStatus type ✓. `status: order.status` in the facts (CreatedOrderFacts.status: OrderStatus) ✓.

**ProjectionService** final:

```ts
import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { ProjectionRepository, RederiveResult } from './projection.repository';

/** Facts about a new order, as observed by the write transaction. */
export interface CreatedOrderFacts {
  id: string;
  companyId: string;
  status: OrderStatus;
  amountCents: number;
  occurredAt: Date;
  workerName: string | null;
  eventName: string | null;
  createdAt: Date;
}

/** Facts about a status change, as observed by the write transaction. */
export interface StatusChangeFacts {
  id: string;
  companyId: string;
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
  amountCents: number;
  occurredAt: Date;
}

/**
 * Synchronous maintenance hooks for the operations projection.
 *
 * Every hook takes the write transaction (`tx`) and writes the projection
 * inside it: the source write and its projection commit together, which is
 * what makes read-your-own-writes hold and what guarantees that a rolled-back
 * write never leaks into the dashboard.
 */
@Injectable()
export class ProjectionService {
  constructor(@Inject(ProjectionRepository) private readonly repo: ProjectionRepository) {}

  async onOrderCreated(tx: Prisma.TransactionClient, facts: CreatedOrderFacts): Promise<void> {
    await this.repo.upsertOpRow(tx, {
      id: facts.id,
      companyId: facts.companyId,
      status: facts.status,
      amountCents: facts.amountCents,
      occurredAt: facts.occurredAt,
      workerName: facts.workerName,
      eventName: facts.eventName,
      createdAt: facts.createdAt,
      updatedAt: facts.occurredAt,
    });
    await this.repo.applyTotalsDelta(tx, {
      companyId: facts.companyId,
      totalDelta: facts.amountCents,
      approvedDelta: 0,
      rejectedDelta: 0,
      countDelta: 1,
    });
  }

  async onOrderStatusChanged(tx: Prisma.TransactionClient, facts: StatusChangeFacts): Promise<void> {
    await this.repo.updateOpRowStatus(tx, facts.id, facts.toStatus, facts.occurredAt);
    const delta = statusDelta(facts.fromStatus, facts.toStatus, facts.amountCents);
    await this.repo.applyTotalsDelta(tx, {
      companyId: facts.companyId,
      totalDelta: 0,
      approvedDelta: delta.approved,
      rejectedDelta: delta.rejected,
      countDelta: 0,
    });
  }

  /**
   * Rebuild the projection for an arbitrary window from the source tables.
   * Idempotent: running it twice over the same window leaves the same result.
   */
  rederiveWindow(from: Date, to: Date): Promise<RederiveResult> {
    return this.repo.withTransaction((tx) => this.repo.rederiveWindow(tx, from, to), 30_000);
  }
}

function statusDelta(from: OrderStatus, to: OrderStatus, amountCents: number): { approved: number; rejected: number } {
  return {
    approved: (to === 'approved' ? amountCents : 0) - (from === 'approved' ? amountCents : 0),
    rejected: (to === 'rejected' ? amountCents : 0) - (from === 'rejected' ? amountCents : 0),
  };
}
```

`status: facts.status` — OpRowSnapshot.status is string; OrderStatus is assignable to string ✓.

**ProjectionRepository** final — with `withTransaction(fn, timeoutMs?)`.

Note: `tx.$executeRaw\`...\`` — the template must be a single expression; fine.

One concern: `$executeRaw` returns `Promise<number>` for non-query; type is `Promise<number>` ✓.

**Operations service** — `status: row.status` typed as string — OperationItem.status: string ✓ (or OrderStatus; use OrderStatus? row.status is OrderStatus. Let me type as OrderStatus for precision. Actually the JSON output is a string; OrderStatus is fine.)

Let me use `status: OrderStatus` in OperationItem.

**Operations controller** — cast query.status: DTO already types it as the union, which is equal to the OrderStatus values — but Prisma's OrderStatus is an enum type (string literal union) — assignment `status: query.status` (type 'pending'|'approved'|'rejected' | undefined) to `status?: OrderStatus` — structurally identical literal unions → assignable ✓ (Prisma's enum type is a union of string literals; TS treats it as a type alias of the union — assignable).

Now the **drift-repair service** — `@Interval(() => Number(process.env.DRIFT_REPAIR_INTERVAL_MS) || DEFAULT_INTERVAL_MS)`.

TS: the arrow returns number ✓.

**Now the final test files** — let me verify the imports and the usage of `PrismaClient` type.

read-your-own-writes.spec.ts:

```ts
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connect, hasDatabase, resetData, resetSchema } from './helpers/db';
import { buildServices } from './helpers/services';
import { seedLookup } from './helpers/seed';

describe.skipIf(!hasDatabase)('read your own writes', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildServices>;

  beforeAll(async () => {
    prisma = connect();
    await resetSchema(prisma);
    app = buildServices(prisma);
  });
  beforeEach(async () => {
    await resetData(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('shows a new order on the very next dashboard request, with the denormalized names', async () => {
    const { company, worker, event } = await seedLookup(prisma);
    const order = await app.orderService.createOrder({
      companyId: company.id,
      workerId: worker.id,
      eventId: event.id,
      amountCents: 12345,
    });

    const page = await app.operationsService.listOperations({ companyId: company.id, page: 1, pageSize: 20 });

    expect(page.total).toBe(1);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: order.id,
      companyId: company.id,
      status: 'pending',
      amountCents: 12345,
      workerName: 'Wendy',
      eventName: 'Launch',
    });
  });

  it('shows an approval immediately, in the list and behind the status filter', async () => {
    const { company } = await seedLookup(prisma);
    const order = await app.orderService.createOrder({ companyId: company.id, amountCents: 5000 });
    await app.orderService.approveOrder(order.id);

    const approved = await app.operationsService.listOperations({ companyId: company.id, status: 'approved', page: 1, pageSize: 20 });
    const pending = await app.operationsService.listOperations({ companyId: company.id, status: 'pending', page: 1, pageSize: 20 });

    expect(approved.items.map((row) => row.id)).toEqual([order.id]);
    expect(approved.items[0].status).toBe('approved');
    expect(pending.items).toEqual([]);
  });

  it('keeps the projection consistent when a duplicate approval rolls back', async () => {
    const { company } = await seedLookup(prisma);
    const order = await app.orderService.createOrder({ companyId: company.id, amountCents: 7500 });
    await app.orderService.approveOrder(order.id);

    await expect(app.orderService.approveOrder(order.id)).rejects.toBeInstanceOf(ConflictException);

    const page = await app.operationsService.listOperations({ companyId: company.id, page: 1, pageSize: 20 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].status).toBe('approved');

    const totals = await app.operationsService.getCompanyTotals(company.id);
    expect(totals).toEqual({
      companyId: company.id,
      totalCents: 7500,
      approvedCents: 7500,
      rejectedCents: 0,
      orderCount: 1,
    });
  });

  it('rejects a write for a missing order and leaves the projection untouched', async () => {
    const { company } = await seedLookup(prisma);

    await expect(app.orderService.approveOrder('does-not-exist')).rejects.toBeInstanceOf(NotFoundException);

    const page = await app.operationsService.listOperations({ companyId: company.id, page: 1, pageSize: 20 });
    const totals = await app.operationsService.getCompanyTotals(company.id);
    expect(page.items).toEqual([]);
    expect(totals.totalCents).toBe(0);
    expect(totals.orderCount).toBe(0);
  });
});
```

`listOperations` input: OperationsPageInput = OperationsFilter & {page,pageSize} — status optional ✓.

concurrent-totals.spec.ts — as drafted, with the PrismaClient import.

drift-repair.spec.ts — as drafted.

rederive.spec.ts — as drafted, with the `snapshot` helper.

One more check — in the drift spec, `seedTwoOrders` uses `app` (let) — defined in the closure; fine.

`prisma.$executeRaw\`UPDATE ...\`` — tagged raw with params ✓. `TRUNCATE ops_rows, company_totals` — via $executeRawUnsafe (no params) — I used `$executeRaw\`TRUNCATE ops_rows, company_totals\`` in the rederive spec (no interpolation, fine).

**Vitest config**:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The suites share the one Postgres database named by DATABASE_URL, so
    // spec files must not run in parallel.
    fileParallelism: false,
    include: ['test/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
```
`fileParallelism` — vitest ^2. I'll pin vitest to `^2.1.9` in package.json. Hmm — but is `fileParallelism` valid in 2.1? Yes (introduced in 1.3? definitely in 2.x). OK, vitest ^2.1.0.

Now — **`@nestjs/schedule` version**: ^4.1.0 for Nest 10 ✓.

**Reflect-metadata** imported in main ✓ (tests don't need it since there's no Nest app bootstrap — but the decorator execution (like @Injectable()) doesn't need reflect-metadata at runtime for construction; Nest app bootstrap does. Tests construct classes directly — decorators already applied (class definition) — fine without reflect-metadata? `@Injectable()` decorator call: calls Inject() decorator factory — from @nestjs/common — works without reflect-metadata (it just registers metadata via Reflect if available? `Injectable` calls `Reflect.defineMetadata`? Actually Nest's `Injectable()` uses `reflect-metadata`'s Reflect (it imports 'reflect-metadata' itself? @nestjs/common imports 'reflect-metadata' in some paths). To be safe, tests could `import 'reflect-metadata'` — harmless. Actually @nestjs/common's decorators rely on Reflect.metadata existing — Nest's own modules import 'reflect-metadata'? The @nestjs/common package doesn't auto-import reflect-metadata; the app is expected to. But decorator calls like `@Injectable()` → `Injectable()` returns a decorator that does `Reflect.defineMetadata('isInjectable', true, target)` — the global `Reflect.defineMetadata` is defined by reflect-metadata's polyfill. Without importing it, `Reflect.defineMetadata` is undefined → TypeError on class decoration!! So test files that import app classes (which decorate at import time) need reflect-metadata imported before those modules load. ES module import order: all imports hoisted and evaluated in order — if the spec file has `import 'reflect-metadata'` as the first import line, it's evaluated before the app module imports (order in the import list). So each spec file: `import 'reflect-metadata';` as the first line. I'll add it to all four specs (and to the helpers that import app modules — the helpers import app modules; the spec imports the helpers… the evaluation order: the spec's imports in order: reflect-metadata, then helpers (which pull in app modules). As long as reflect-metadata is first in the spec, the app modules are decorated after the polyfill loads. But wait — does Vitest transform to preserve order? Yes, ESM semantics. Add to each spec.

Hmm — actually, do the `@Injectable()`/`@Module()` decorators execute at class definition (module evaluation)? Yes. So reflect-metadata must load first. Spec files: first import line `import 'reflect-metadata';`. ✓. Also `src/main.ts` has it first. ✓.

Wait, actually — Nest's Injectable decorator: looking at Nest source, `Injectable` → `Inject` decorator → `Reflect.defineMetadata(INJECTABLE_WATERMARK, ...)`. Nest packages import 'reflect-metadata' internally? Let me check my memory: `@nestjs/common`'s `injectable.decorator.ts` doesn't import reflect-metadata; it relies on the consumer. But `@nestjs/core` does? To be safe, I'll add the import in the specs. It's a no-op if already loaded.

**`useDefineForClassFields: false`** — vitest's esbuild reads tsconfig? Vitest uses esbuild with tsconfig's `experimentalDecorators` and `useDefineForClassFields` — Vitest 1+ respects tsconfig for esbuild? Vitest docs: "esbuild reads tsconfig" — yes, Vitest passes tsconfig settings (target, useDefineForClassFields, experimentalDecorators) to esbuild. ✓.

DTO class fields with `!` and no initializer: with useDefineForClassFields:false → no `undefined` assignment → the class-validator works on the transformed instance ✓.

**Prisma + ESM**: @prisma/client v5 works in ESM (CJS dual) ✓. `import { PrismaClient } from '@prisma/client'` ✓.

**BigInt literal `0n`** — target ES2022 ✓.

Now — **the OperationsRepository `filterOf`** returns a where with `status` as OrderStatus — `Prisma.OpsRowWhereInput.status?: $Enums.OrderStatus | EnumOpsRowFilter | ...` — assigning OrderStatus ✓.

**`where.occurredAt`** type: `Prisma.DateTimeFilter` has gte/lte/lt/gt ✓.

Now — **the totals endpoint path**: GET /operations/companies/:companyId/totals. Hmm — "endpoint: kebab-case, plural" — `totals` is plural ✓, `companies` is plural ✓.

**Now let me assemble everything.** Let me also double-check the **drift detection** when the row exists but the name has drifted (a rename) — covered by the IS NOT DISTINCT FROM comparison ✓.

**Potential SQL issue**: in the detection, the scalar subquery `(SELECT w.name FROM workers w WHERE w.id = po.worker_id)` — if po.worker_id is NULL → subquery is NULL ✓.

**The rederivation INSERT ... SELECT with ON CONFLICT** — Postgres supports INSERT ... SELECT ... ON CONFLICT ✓.

**The totals recompute INSERT ... SELECT ... GROUP BY ... ON CONFLICT DO UPDATE SET = EXCLUDED** — SET to exact values (not increments) ✓.

Edge: a company with orders in the window but zero… GROUP BY returns a row for each company that has orders ✓. A company with all orders outside the window is untouched ✓ (its totals are unchanged — correct, since its orders didn't change in the window… unless their projection rows drifted outside the window — out of scope, documented).

Wait — subtle: the rederivation recomputes totals for companies with orders in the window, using a full aggregate over all their orders — so it also corrects any drift in the totals (for those companies) ✓ — that's why the drift test with only totals drift works (the company has orders in the window).

**The `company_totals` FK ON DELETE CASCADE** — fine.

**Now let me write the files.** Also I'll make sure not to reference any file I haven't created. Let me list the imports per file:

- order.controller: @nestjs/common (Controller, Post, Param, Body, HttpCode, Inject), ./order.service, ./create-order.dto ✓.
- operations.controller: @nestjs/common (Controller, Get, Param, Query, Inject), ./list-operations-query.dto, ./operations.service ✓.
- drift-repair.service: @nestjs/common (Injectable, Logger, Inject), @nestjs/schedule (Interval), ../projection/projection.service, ./drift-repair.repository ✓.
- app.module: modules + ScheduleModule ✓.

**The `OrdersModule`** imports ProjectionModule + PrismaModule:
```ts
@Module({
  imports: [PrismaModule, ProjectionModule],
  controllers: [OrdersController],
  providers: [OrderService, OrderRepository],
})
```
**ProjectionModule**: imports PrismaModule, providers [ProjectionService, ProjectionRepository], exports [ProjectionService].
**OperationsModule**: imports PrismaModule.
**DriftRepairModule**: imports [PrismaModule, ProjectionModule].

✓ Compliant with the wiring convention.

**`PrismaService` in the repository** — `@Inject(PrismaService) private readonly db: PrismaClient` — DI token PrismaService, parameter type PrismaClient — Nest passes the PrismaService instance ✓.

Now — **the test helper `buildServices`** constructs `new ProjectionRepository(prisma)` — the parameter type is PrismaClient ✓ (the constructor is declared with the parameter type PrismaClient — the decorator @Inject(PrismaService) is inert outside of Nest).

**One more consideration — `connect()` when DATABASE_URL is missing**: skipped by skipIf. But `hasDatabase` is computed at module load — fine.

**The resetData TRUNCATE** — 6 tables ✓.

Let me reconsider the **`$executeRawUnsafe` for DROP TABLE with multiple tables** — `DROP TABLE IF EXISTS a, b, c CASCADE` ✓ single statement.

**The split logic**: `sql.split(';\n')` — but the migration has lines like `DEFAULT 'pending',` — no `;\n` inside. Comments contain `;`? Let me scan my migration comments: "This migration is applied once by `prisma migrate deploy` and is also executed verbatim by the test suite, which drops the tables first." — no semicolons. "The INCLUDE columns make the dashboard read an index-only scan." ✓. The FK lines end with `ON DELETE RESTRICT ON UPDATE CASCADE,` ✓ no `;`.

But wait — the DROP in resetSchema: I use $executeRawUnsafe directly (no split). ✓.

The last chunk after the final `;\n` — the file ends with `);\n` → after the final `;\n`, there's nothing (or a newline) → the chunk is empty → skipped ✓. If the file ends with `);` (no trailing \n), then the last chunk = the whole last statement ✓.

I'll make sure the migration file ends with a newline after the final `;`.

**Now — one design gap**: the task says "maintenance hooks invoked from the write services (simulate the write path)". My write path is the OrdersController+OrderService. "Simulate" — since the real marketplace writes come from elsewhere, we simulate by implementing the order writes. ✓. I'll mention it in DESIGN.md.

**The dashboard "date range" filter** — from/to on occurred_at ✓.

I think the design is complete. Let me also add **`src/common/`** — only exception.filter.ts.

Let me reconsider whether to include **a `getCompanyTotals` route** — I'll include it (the dashboard's totals header; also makes the totals observable). It's in the operations feature. OK.

Now — final check on the **`Prisma.OpsRowWhereInput`** usage — `import { Prisma } from '@prisma/client'` in operations.repository ✓.

**`OpsRow` and `CompanyTotal`** type imports in operations.repository ✓ (used in return types).

**`OrderStatus`** in operations.repository for the filter ✓.

**The `listOperations` service** — Promise.all of listRows + countRows ✓.

Let me also consider **the `total` field** in the response — the original dashboard "same page sizes" — total is fine.

Now, **the `@HttpCode(200)`** on the approve/reject POSTs — the default POST is 201; approve is an idempotent-ish action; 200 is fine. Keep.

Also **`@Post('orders')`** → the controller prefix 'orders' ✓.

**Edge: `ValidationPipe({ whitelist: true, transform: true })`** — the query DTO's unknown params are stripped ✓.

Now — one more potential pitfall: **`@Type(() => Number)` with `transform: true`** converts the query string '2' → 2 ✓; 'abc' → NaN → @IsInt fails ✓.

Let me write the **final vitest.config** and **package.json** versions:
- @nestjs/* ^10.3.0
- @prisma/client ^5.14.0, prisma ^5.14.0
- @nestjs/schedule ^4.1.0
- class-validator ^0.14.1, class-transformer ^0.5.1
- rxjs ^7.8.1, reflect-metadata ^0.2.2
- typescript ^5.5.0, tsx ^4.15.0, vitest ^2.1.0, @types/node ^20.14.0, @types/express ^4.17.21
- postinstall: prisma generate

Node engine >= 20.

**tsconfig** — `module: "ESNext"` + `moduleResolution: "Bundler"` — but tsx runtime with ESM: tsx resolves extensionless regardless of tsconfig (it has its own resolver). `tsc` build (build script) with module ESNext + moduleResolution Bundler → emits ESM with extensionless imports → running `node dist/main.js` would fail on extensionless relative imports. But the start script uses tsx on src (not dist). The build script is vestigial — remove it to avoid a broken path? Keep "build": "tsc -p tsconfig.json --noEmit"? That's typecheck. Let me make the scripts: `"typecheck": "tsc -p tsconfig.json --noEmit"`, `"start": "tsx src/main.ts"`. Good — honest.

Hmm, `moduleResolution: "Bundler"` requires module: esnext/preserve ✓. tsc --noEmit typecheck is fine.

**Vitest + `import.meta.url`** in helpers ✓.

Now — **the `Event` model name** once more: Prisma generates the delegate `event` and the type `Event`. In seed.ts I import { Event } — no DOM lib (tsconfig's `types: ["node"]`, no lib dom) → no collision ✓.

**Prisma enum** OrderStatus values pending/approved/rejected — stored as TEXT ✓ matches the raw SQL literals.

Let me also double-check **the `transition` method name collision**: OrderRepository.transition and OrderService.transition (private) — different classes, fine.

**`OrderRepository.createOrder`'s data parameter** — includes workerId/eventId nullable ✓.

**`BigInt(input.amountCents)`** — amountCents validated as integer ≥1 ✓.

Now — **the drift repair's scheduled run in the test environment**: the decorator is inert, no scheduler in tests ✓. In the app, `@Interval` runs — it requires ScheduleModule.forRoot() ✓ in AppModule.

**Logger** import in the drift service ✓.

Now — **the envelope filter's `details` is never null** ✓ always an object.

**Final review of the required acceptance items**:
1. Approve → next request reflects ✓ (test 2 in the ryw spec).
2. Two concurrent approvals → totals exact ✓ (concurrent spec, 20-way).
3. Redrive a window → match; twice → same ✓ (rederive spec).
4. Injected drift → the job finds and fixes ✓ (drift spec).
5. Dashboard touches only the projection ✓ (operations.repository is projection-only; documented).

Deliverables: projection table + DDL ✓; hooks ✓; rederivation ✓; scheduled drift job ✓; dashboard query ✓; tests ✓; DESIGN.md ✓.

Now — let me write the final content of each file. I'll also keep the comments concise.

One more detail — **`src/prisma/prisma.service.ts`**: PrismaClient constructor with log config? Add `log: ['warn', 'error']`? Keep minimal: none.

Also — **`main.ts`** — `app.enableShutdownHooks()`? Not necessary.

**`OperationsPageInput`** extends OperationsFilter — the controller passes `status: query.status` (union | undefined) ✓.

In operations.service, I destructure to `OperationsFilter` — fine, or pass the input directly (has page/pageSize extra — the repository takes a filter parameter typed OperationsFilter; the extra properties are structurally fine? TS's excess property check only on object literals — I build `filter` explicitly ✓).

**`OperationItem.status: OrderStatus`** — import OrderStatus in operations.service.

Now — **the seed helper name** `seedLookup` returns a company with a default name parameter. ✓.

Let me write the drift spec's `seedTwoOrders` — I need worker/event for names ✓.

Potential flake: **cuid ordering** in the rederive spec's `orderBy id asc` — cuids created within the same ms use an internal counter → monotonic ✓.

**The rederive spec** — `TRUNCATE ops_rows, company_totals` then rederive — but company_totals has an FK from…? Nothing references company_totals ✓.

Wait — `TRUNCATE ops_rows, company_totals;` — company_totals has an FK to companies; truncating it is fine (no cascade needed) ✓.

**`result.rowsRebuilt`** — $executeRaw returns the affected count: with INSERT...SELECT of 3 rows → 3 ✓. `companiesRecomputed` → 1 ✓.

Now — **the `before`/`after` window in the rederive spec**: `before = new Date(Date.now() - 60_000)` — orders created after ✓ included; `after = new Date()` after the writes ✓ (with `<=`, same-ms is fine).

**The drift spec's `repairRecentWindow`** — lookback 24h default → window [now-24h, now] includes the seeded orders ✓ (updated_at <= to ✓).

**The totals-drift-only test**: `UPDATE company_totals SET total_cents = total_cents - 5` → detection: source total 3000 vs stored 2995 → flagged ✓ → rederive → fixed ✓. `driftedOrders` 0 ✓.

Great. Let me also re-check the **`findDrift` totals CTE** — the `windowed` CTE selects distinct company_id for orders in the window. In the drift test, the company's orders' updated_at is within the window ✓.

**One more subtlety**: the detection `r.occurred_at = po.updated_at` — for the `approved` order: the approval set both to the same `at` ✓. For the pending order: creation set both to the same `at` ✓.

**Now — the `@types/express` import in the filter** — `import type { Response } from 'express'` ✓ with @types/express in devDeps.

**Check the `EnvelopeExceptionFilter`'s handling of `HttpException` with an object response**: `record.message` could be an array (validation) — handled ✓.

Now, let me assemble the final reply. Format: `### path` followed by a fenced block per file. Nothing else. I'll produce ~35 blocks.

Let me now write out the final code text for each file, being careful.

---

**package.json**:

```json
{
  "name": "marketplace-backoffice",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "start": "tsx src/main.ts",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "migrate": "prisma migrate deploy",
    "generate": "prisma generate",
    "postinstall": "prisma generate",
    "test": "vitest run"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.8",
    "@nestjs/core": "^10.3.8",
    "@nestjs/platform-express": "^10.3.8",
    "@nestjs/schedule": "^4.1.0",
    "@prisma/client": "^5.14.0",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.9",
    "prisma": "^5.14.0",
    "tsx": "^4.15.7",
    "typescript": "^5.5.3",
    "vitest": "^2.1.9"
  }
}
```

**tsconfig.json**:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "useDefineForClassFields": false,
    "sourceMap": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```
(noEmit since we typecheck only; tsx runs the source.)

**vitest.config.ts**:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every suite shares the single Postgres database named by DATABASE_URL
    // (each one drops and rebuilds the schema), so spec files must run one
    // after another.
    fileParallelism: false,
    include: ['test/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
```

**.env.example**:

```
# Postgres connection string. The API and the test suite both require it.
DATABASE_URL=postgresql://user:password@localhost:5432/marketplace_backoffice?schema=public

# HTTP port for the API.
PORT=3000

# Drift repair job: run interval (ms) and how far back to compare (hours).
DRIFT_REPAIR_INTERVAL_MS=300000
DRIFT_REPAIR_LOOKBACK_HOURS=24
```

**prisma/schema.prisma**:

```prisma
// Source of truth for the database. The projection tables (ops_rows,
// company_totals) are maintained synchronously by the write services; see
// DESIGN.md. The dashboard covers its access pattern with a covering index
// that the schema cannot express (INCLUDE), which the migration adds.

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
  rejected
}

model Company {
  id     String         @id @default(cuid()) @map("id")
  name   String         @map("name")
  orders PaymentOrder[]
  totals CompanyTotal?

  @@map("companies")
}

model Worker {
  id     String         @id @default(cuid()) @map("id")
  name   String         @map("name")
  orders PaymentOrder[]

  @@map("workers")
}

model Event {
  id     String         @id @default(cuid()) @map("id")
  title  String         @map("title")
  orders PaymentOrder[]

  @@map("events")
}

model PaymentOrder {
  id          String      @id @default(cuid()) @map("id")
  companyId   String      @map("company_id")
  workerId    String?     @map("worker_id")
  eventId     String?     @map("event_id")
  status      OrderStatus @default(pending) @map("status")
  amountCents BigInt      @map("amount_cents")
  createdAt   DateTime    @default(now()) @map("created_at")
  // No @updatedAt on purpose: the write services set it explicitly so the
  // same instant can be stamped onto the projection row (occurred_at).
  updatedAt   DateTime    @default(now()) @map("updated_at")

  company Company @relation(fields: [companyId], references: [id])
  worker  Worker? @relation(fields: [workerId], references: [id])
  event   Event?  @relation(fields: [eventId], references: [id])

  @@index([companyId], map: "payment_orders_company_id_idx")
  @@index([updatedAt], map: "payment_orders_updated_at_idx")
  @@map("payment_orders")
}

// Projection: one row per payment order, shaped like the dashboard query so
// the hot path performs no join.
model OpsRow {
  id          String      @id @map("id")
  companyId   String      @map("company_id")
  status      OrderStatus @map("status")
  amountCents BigInt      @map("amount_cents")
  // When the order entered its current state; mirrors payment_orders.updated_at.
  occurredAt  DateTime    @map("occurred_at")
  workerName  String?     @map("worker_name")
  eventName   String?     @map("event_name")
  createdAt   DateTime    @map("created_at")
  updatedAt   DateTime    @map("updated_at")

  // Dashboard access pattern: WHERE company_id = ? [AND status = ?]
  // AND occurred_at in range, ORDER BY occurred_at DESC, id DESC.
  // The migration adds INCLUDE (amount_cents, worker_name, event_name,
  // created_at) so the query is an index-only scan.
  @@index([companyId, status, occurredAt(sort: Desc), id(sort: Desc)], map: "idx_ops_rows_lookup")
  @@map("ops_rows")
}

// Projection: exact per-company financial totals, kept by atomic in-place
// increments inside the write transaction.
model CompanyTotal {
  companyId     String @id @map("company_id")
  totalCents    BigInt @default(0) @map("total_cents")
  approvedCents BigInt @default(0) @map("approved_cents")
  rejectedCents BigInt @default(0) @map("rejected_cents")
  orderCount    Int    @default(0) @map("order_count")

  company Company @relation(fields: [companyId], references: [id])

  @@map("company_totals")
}
```

**migration.sql** — as drafted, plus the company_id index:

Add `CREATE INDEX "payment_orders_company_id_idx" ON "payment_orders" ("company_id");` and the updated_at one.

**src/prisma/prisma.service.ts** ✓.

**src/prisma/prisma.module.ts**:

```ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

**src/common/exception.filter.ts** — as drafted.

**src/main.ts** — as drafted.

**src/app.module.ts** — as drafted.

**src/order/create-order.dto.ts**:

```ts
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateOrderDto {
  @IsString()
  companyId!: string;

  @IsOptional()
  @IsString()
  workerId?: string;

  @IsOptional()
  @IsString()
  eventId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  amountCents!: number;
}
```

**src/order/order.controller.ts**:

```ts
import { Body, Controller, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { CreateOrderDto } from './create-order.dto';
import { OrderService } from './order.service';

@Controller('orders')
export class OrdersController {
  constructor(@Inject(OrderService) private readonly orders: OrderService) {}

  @Post()
  create(@Body() body: CreateOrderDto): Promise<ReturnType<OrderService['createOrder']>> {
    return this.orders.createOrder({
      companyId: body.companyId,
      workerId: body.workerId,
      eventId: body.eventId,
      amountCents: body.amountCents,
    });
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(@Param('id') id: string): Promise<ReturnType<OrderService['approveOrder']>> {
    return this.orders.approveOrder(id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(@Param('id') id: string): Promise<ReturnType<OrderService['rejectOrder']>> {
    return this.orders.rejectOrder(id);
  }
}
```
Simpler: import OrderView and type as Promise<OrderView>. Let me do that.

**src/order/order.repository.ts** — as drafted.

**src/order/order.service.ts** — as drafted.

**src/order/order.module.ts**:

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProjectionModule } from '../projection/projection.module';
import { OrdersController } from './order.controller';
import { OrderRepository } from './order.repository';
import { OrderService } from './order.service';

@Module({
  imports: [PrismaModule, ProjectionModule],
  controllers: [OrdersController],
  providers: [OrderService, OrderRepository],
})
export class OrdersModule {}
```

**src/projection/projection.module.ts**, **projection.repository.ts**, **projection.service.ts** — as drafted.

**src/operations/** — as drafted.

**src/drift-repair/** — as drafted.

**test/** — as drafted.

**DESIGN.md** — as drafted.

Now let me finalize the projection.repository.ts in full:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface OpRowSnapshot {
  id: string;
  companyId: string;
  status: string;
  amountCents: number;
  occurredAt: Date;
  workerName: string | null;
  eventName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TotalsDelta {
  companyId: string;
  totalDelta: number;
  approvedDelta: number;
  rejectedDelta: number;
  countDelta: number;
}

export interface RederiveResult {
  rowsRebuilt: number;
  companiesRecomputed: number;
}

/**
 * The only layer that writes the projection tables.
 *
 * Amounts are passed to raw SQL as numbers: at this scale (integer cents,
 * totals in the low hundreds of trillions of cents at most) they stay far
 * below 2^53, while the column itself is BIGINT.
 */
@Injectable()
export class ProjectionRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaClient) {}

  withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, timeoutMs?: number): Promise<T> {
    return timeoutMs === undefined ? this.db.$transaction(fn) : this.db.$transaction(fn, { timeout: timeoutMs });
  }

  /**
   * Idempotent upsert of the projection row for one order. Names are kept
   * from the existing row when the caller has none (status changes).
   */
  upsertOpRow(tx: Prisma.TransactionClient, row: OpRowSnapshot): Promise<void> {
    return tx
      .$executeRaw`
        INSERT INTO ops_rows (id, company_id, status, amount_cents, occurred_at, worker_name, event_name, created_at, updated_at)
        VALUES (${row.id}, ${row.companyId}, ${row.status}, ${row.amountCents}, ${row.occurredAt}, ${row.workerName}, ${row.eventName}, ${row.createdAt}, ${row.updatedAt})
        ON CONFLICT (id) DO UPDATE SET
          company_id   = EXCLUDED.company_id,
          status       = EXCLUDED.status,
          amount_cents = EXCLUDED.amount_cents,
          occurred_at  = EXCLUDED.occurred_at,
          worker_name  = COALESCE(EXCLUDED.worker_name, ops_rows.worker_name),
          event_name   = COALESCE(EXCLUDED.event_name, ops_rows.event_name),
          updated_at   = EXCLUDED.updated_at
      `
      .then(() => undefined);
  }

  updateOpRowStatus(tx: Prisma.TransactionClient, id: string, status: string, at: Date): Promise<void> {
    return tx
      .$executeRaw`
        UPDATE ops_rows
        SET status = ${status},
            occurred_at = ${at},
            updated_at = ${at}
        WHERE id = ${id}
      `
      .then(() => undefined);
  }

  /**
   * Atomic in-place totals update. Concurrent updates to the same company
   * serialize on the row lock; because no read-modify-write is involved,
   * none of them can be lost.
   */
  applyTotalsDelta(tx: Prisma.TransactionClient, d: TotalsDelta): Promise<void> {
    return tx
      .$executeRaw`
        INSERT INTO company_totals (company_id, total_cents, approved_cents, rejected_cents, order_count)
        VALUES (${d.companyId}, ${d.totalDelta}, ${d.approvedDelta}, ${d.rejectedDelta}, ${d.countDelta})
        ON CONFLICT (company_id) DO UPDATE SET
          total_cents    = company_totals.total_cents + EXCLUDED.total_cents,
          approved_cents = company_totals.approved_cents + EXCLUDED.approved_cents,
          rejected_cents = company_totals.rejected_cents + EXCLUDED.rejected_cents,
          order_count    = company_totals.order_count + EXCLUDED.order_count
      `
      .then(() => undefined);
  }

  /**
   * Rebuild the projection for orders whose `updated_at` falls in
   * [from, to]: re-derive every row in the window from the source tables
   * and recompute the exact totals of every company the window touches.
   * Every statement is idempotent, so the routine is safe to run while the
   * system is live and safe to run twice over the same window.
   */
  async rederiveWindow(tx: Prisma.TransactionClient, from: Date, to: Date): Promise<RederiveResult> {
    const rowsRebuilt = await tx.$executeRaw`
      INSERT INTO ops_rows (id, company_id, status, amount_cents, occurred_at, worker_name, event_name, created_at, updated_at)
      SELECT po.id, po.company_id, po.status, po.amount_cents, po.updated_at, w.name, e.title, po.created_at, po.updated_at
      FROM payment_orders po
      LEFT JOIN workers w ON w.id = po.worker_id
      LEFT JOIN events e ON e.id = po.event_id
      WHERE po.updated_at >= ${from} AND po.updated_at <= ${to}
      ON CONFLICT (id) DO UPDATE SET
        company_id   = EXCLUDED.company_id,
        status       = EXCLUDED.status,
        amount_cents = EXCLUDED.amount_cents,
        occurred_at  = EXCLUDED.occurred_at,
        worker_name  = COALESCE(EXCLUDED.worker_name, ops_rows.worker_name),
        event_name   = COALESCE(EXCLUDED.event_name, ops_rows.event_name),
        updated_at   = EXCLUDED.updated_at
    `;
    const companiesRecomputed = await tx.$executeRaw`
      INSERT INTO company_totals (company_id, total_cents, approved_cents, rejected_cents, order_count)
      SELECT po.company_id,
             COALESCE(SUM(po.amount_cents), 0),
             COALESCE(SUM(po.amount_cents) FILTER (WHERE po.status = 'approved'), 0),
             COALESCE(SUM(po.amount_cents) FILTER (WHERE po.status = 'rejected'), 0),
             COUNT(*)
      FROM payment_orders po
      WHERE po.company_id IN (
        SELECT p2.company_id
        FROM payment_orders p2
        WHERE p2.updated_at >= ${from} AND p2.updated_at <= ${to}
        GROUP BY p2.company_id
      )
      GROUP BY po.company_id
      ON CONFLICT (company_id) DO UPDATE SET
        total_cents    = EXCLUDED.total_cents,
        approved_cents = EXCLUDED.approved_cents,
        rejected_cents = EXCLUDED.rejected_cents,
        order_count    = EXCLUDED.order_count
    `;
    return { rowsRebuilt: Number(rowsRebuilt), companiesRecomputed: Number(companiesRecomputed) };
  }
}
```

Note: `tx.$executeRaw` returns Promise<number>; `.then(() => undefined)` → Promise<void> ✓. Actually the TS type of $executeRaw is: `$executeRaw(query: TemplateStringsArray, ...values: any[]): Promise<number>` ✓.

**drift-repair.repository.ts** final:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface DriftFindings {
  driftedOrderIds: string[];
  driftedCompanyIds: string[];
}

interface DriftedOrderRow {
  id: string;
  company_id: string;
}

interface DriftedTotalRow {
  company_id: string;
}

/**
 * Read-only diff between the projection and the source for one window of
 * source `updated_at`. Detects stale or missing ops_rows and company_totals
 * that disagree with the source aggregate. The repair action is the
 * re-derivation routine (ProjectionService.rederiveWindow).
 */
@Injectable()
export class DriftRepairRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaClient) {}

  async findDrift(from: Date, to: Date): Promise<DriftFindings> {
    const driftedOrders = await this.db.$queryRaw<DriftedOrderRow[]>`
      SELECT po.id, po.company_id
      FROM payment_orders po
      WHERE po.updated_at >= ${from} AND po.updated_at <= ${to}
        AND NOT EXISTS (
          SELECT 1
          FROM ops_rows r
          WHERE r.id = po.id
            AND r.company_id = po.company_id
            AND r.status = po.status
            AND r.amount_cents = po.amount_cents
            AND r.occurred_at = po.updated_at
            AND r.worker_name IS NOT DISTINCT FROM (SELECT w.name FROM workers w WHERE w.id = po.worker_id)
            AND r.event_name IS NOT DISTINCT FROM (SELECT e.title FROM events e WHERE e.id = po.event_id)
        )
      ORDER BY po.id
    `;
    const driftedTotals = await this.db.$queryRaw<DriftedTotalRow[]>`
      WITH windowed AS (
        SELECT p2.company_id
        FROM payment_orders p2
        WHERE p2.updated_at >= ${from} AND p2.updated_at <= ${to}
        GROUP BY p2.company_id
      ),
      source AS (
        SELECT po.company_id,
               COALESCE(SUM(po.amount_cents), 0) AS total_cents,
               COALESCE(SUM(po.amount_cents) FILTER (WHERE po.status = 'approved'), 0) AS approved_cents,
               COALESCE(SUM(po.amount_cents) FILTER (WHERE po.status = 'rejected'), 0) AS rejected_cents,
               COUNT(*) AS order_count
        FROM payment_orders po
        WHERE po.company_id IN (SELECT company_id FROM windowed)
        GROUP BY po.company_id
      )
      SELECT s.company_id
      FROM source s
      LEFT JOIN company_totals t ON t.company_id = s.company_id
      WHERE t.total_cents IS DISTINCT FROM s.total_cents
         OR t.approved_cents IS DISTINCT FROM s.approved_cents
         OR t.rejected_cents IS DISTINCT FROM s.rejected_cents
         OR t.order_count IS DISTINCT FROM s.order_count
    `;
    return {
      driftedOrderIds: driftedOrders.map((row) => row.id),
      driftedCompanyIds: [
        ...new Set([
          ...driftedOrders.map((row) => row.company_id),
          ...driftedTotals.map((row) => row.company_id),
        ]),
      ],
    };
  }
}
```

**drift-repair.service.ts** final — as drafted, with the DEFAULT constant and the env parsing.

`Number(process.env.DRIFT_REPAIR_LOOKBACK_HOURS) || DEFAULT_LOOKBACK_HOURS` — if the env is an invalid string → NaN → default ✓.

**operations.repository.ts** final — as drafted.

Now — one more check: **`Prisma.OpsRowWhereInput`** — the generated type exists ✓.

**Operations service** — `Promise.all` of listRows + countRows: the count query's where is the same ✓.

Let me finalize the **DESIGN.md** text (tightening it).

Also — the task's deliverables mention "DDL with appropriate indexes" ✓ migration.

I'm fairly confident in the overall picture. Let me also reconsider **`fileParallelism: false`** — in vitest 2.1, the config key is `fileParallelism` under `test` ✓.

And **vitest + `@prisma/client` ESM import** — CJS module imported in ESM ✓ default interop: `import { PrismaClient } from '@prisma/client'` works (named export available via CJS named detection) ✓ standard.

**tsx running Nest ESM** — the decorators via esbuild with `experimentalDecorators: true` in tsconfig — tsx respects tsconfig's experimentalDecorators ✓. DI is explicit @Inject everywhere — no metadata needed. But wait — **Nest's module/controller resolution**: Nest uses `@Module` metadata (via the decorator) ✓ emitted. Provider resolution: Nest scans the module's providers array (explicit class references) ✓ no metadata needed for that. Constructor DI: explicit @Inject token ✓. So it works under esbuild.

One more: **Nest needs `Reflect.getMetadata('parameters'/'design:paramtypes')`?** With explicit @Inject, Nest uses the token directly. ✓.

**Controllers**: `@Controller('orders')` + explicit @Inject in the constructor ✓.

OK — also **`app.module.ts`** — no controller/provider of its own ✓.

**Potential circular imports**: order.service imports projection.service; projection module is independent ✓ no cycle.

Now — **the final file order in the reply**: config, prisma, src, test, DESIGN.md. Any order works; the parser takes each path at its last occurrence. I'll make sure the paths are unique.

Let me write the reply. I'll keep each file complete. I'll also double-check that no file has placeholder `…`.

One more: **`test/helpers/seed.ts`** — `seedLookup(prisma, name?)` — used in the specs with the default. The company name 'Acme'.

Also in the **concurrent spec**, 20 parallel creates: each create opens its own tx; they insert different orders; the totals increment is +7777? No wait — the create adds totalDelta 7777 each; 20 parallel creates also race on the totals row! That's fine (atomic increments), total after creates = 20*7777, orderCount 20. Then 20 approvals add approved each. Final: total = 20*7777, approved = 20*7777, count 20 ✓.

Hmm — but the parallel creates also test concurrency on the create path — fine, same atomicity.

Actually — for a cleaner test isolation, let me do the creates sequentially (a Promise.all of 20 creates is also a concurrency assertion, but the point is the approvals). Let me do the creates sequentially with a for loop, then the approvals in parallel. Cleaner narrative:

```ts
const orders: OrderView[] = [];
for (let i = 0; i < 20; i += 1) {
  orders.push(await app.orderService.createOrder({ companyId: company.id, amountCents: 7777 }));
}
await Promise.all(orders.map((o) => app.orderService.approveOrder(o.id)));
```
Import OrderView from the order service. ✓

Cross-check with the source aggregate ✓.

**The `OrderView` import in the test** — from '../../src/order/order.service' ✓.

Now let me write everything out. Also a small note: in the tests I reference `app.orderService` etc. — buildServices returns the keys orderService, operationsService, projectionService, driftRepairService ✓.

The rederive spec uses `app.projectionService.rederiveWindow` ✓.

Let me also re-verify the **`OperationsService.listOperations`** signature used in the tests: `listOperations({ companyId, status?, from?, to?, page, pageSize })` — the tests pass { companyId, page: 1, pageSize: 20 } and optional status ✓ matches OperationsPageInput (status/from/to optional).

**Type**: OperationsPageInput extends OperationsFilter { companyId; status?; from?; to? } & { page: number; pageSize: number } ✓.

Final: **`expect(page.items[0]).toMatchObject({... workerName: 'Wendy', eventName: 'Launch' })`** — the seed worker name 'Wendy', event title 'Launch' ✓.

And the **read-your-own-writes test 1** — order is created with worker+event; the projection row gets the names ✓.

I think I'm ready. Let me write out the reply with the exact blocks. Also I'll make sure the fenced blocks use the correct language tag (ts, prisma, sql, md, json). The format says "one fenced block with only the contents of that file" — the language tag is fine (the example shows ```ts).

DESIGN.md's fence: ```md.

Let me count the files once more and write them all out.

Actually — one more thought on **`prisma.$executeRaw` with a `number` for amountCents in the upsertOpRow INSERT** — the column is BIGINT; the literal is integer ✓.

And **`updateOpRowStatus`** — the `at` Date param ✓.

**`$queryRaw` with a template and 2 Date params in findDrift** — reused per query ✓.

Now, **the DROP in resetSchema** also covers the indexes (DROP TABLE drops them) ✓.

**Vitest hookTimeout 60s** — the initial connect may take a moment ✓.

Writing now.

Wait — one more consideration on the **`@Interval` decorator** — `@Interval(() => ms)`: NestJS schedule's Interval accepts `number | (() => number)`? Checking @nestjs/schedule: `export function Interval(interval: number | (() => number), options?: IntervalOptions)`. Yes, v4 supports the function. ✓.

And the **SchedulerModule.forRoot()** — needed for @Interval ✓ in AppModule.

Also — the drift service in the app context: when the app boots, the interval starts and immediately… @Interval runs on the first tick after the interval (not immediately) — fine.

Edge — **DriftRepairService's `runScheduled`** is only called by the scheduler; the tests call `repairRecentWindow()`/`repairWindow()` directly ✓.

Now — **final check on the envelope**: `details` is an object ✓; the message is in English ✓; the code is snake_case ✓.

Let me write it all out.
```

## reply

### package.json
```json
{
  "name": "marketplace-backoffice",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "start": "tsx src/main.ts",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "migrate": "prisma migrate deploy",
    "generate": "prisma generate",
    "postinstall": "prisma generate",
    "test": "vitest run"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.8",
    "@nestjs/core": "^10.3.8",
    "@nestjs/platform-express": "^10.3.8",
    "@nestjs/schedule": "^4.1.0",
    "@prisma/client": "^5.14.0",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.9",
    "prisma": "^5.14.0",
    "tsx": "^4.15.7",
    "typescript": "^5.5.3",
    "vitest": "^2.1.9"
  }
}
```

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "useDefineForClassFields": false,
    "sourceMap": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

### vitest.config.ts
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every suite shares the single Postgres database named by DATABASE_URL
    // (each one drops and rebuilds the schema), so spec files must run one
    // after another, never in parallel.
    fileParallelism: false,
    include: ['test/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
```

### .env.example
```
# Postgres connection string. Required by the API and the test suite.
DATABASE_URL=postgresql://user:password@localhost:5432/marketplace_backoffice?schema=public

# HTTP port for the API.
PORT=3000

# Drift repair job: how often it runs (ms) and how far back it compares (hours).
DRIFT_REPAIR_INTERVAL_MS=300000
DRIFT_REPAIR_LOOKBACK_HOURS=24
```

### prisma/schema.prisma
```prisma
// Source of truth for the database. The projection tables (ops_rows,
// company_totals) are maintained synchronously by the write services; see
// DESIGN.md. The covering index the dashboard relies on uses INCLUDE, which
// the schema cannot express; the migration adds it.

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
  rejected
}

model Company {
  id     String         @id @default(cuid()) @map("id")
  name   String         @map("name")
  orders PaymentOrder[]
  totals CompanyTotal?

  @@map("companies")
}

model Worker {
  id     String         @id @default(cuid()) @map("id")
  name   String         @map("name")
  orders PaymentOrder[]

  @@map("workers")
}

model Event {
  id     String         @id @default(cuid()) @map("id")
  title  String         @map("title")
  orders PaymentOrder[]

  @@map("events")
}

model PaymentOrder {
  id          String      @id @default(cuid()) @map("id")
  companyId   String      @map("company_id")
  workerId    String?     @map("worker_id")
  eventId     String?     @map("event_id")
  status      OrderStatus @default(pending) @map("status")
  amountCents BigInt      @map("amount_cents")
  createdAt   DateTime    @default(now()) @map("created_at")
  // No @updatedAt on purpose: the write services set it explicitly so the
  // same instant can be stamped onto the projection row (occurred_at).
  updatedAt   DateTime    @default(now()) @map("updated_at")

  company Company @relation(fields: [companyId], references: [id])
  worker  Worker? @relation(fields: [workerId], references: [id])
  event   Event?  @relation(fields: [eventId], references: [id])

  @@index([companyId], map: "payment_orders_company_id_idx")
  @@index([updatedAt], map: "payment_orders_updated_at_idx")
  @@map("payment_orders")
}

// Projection: one row per payment order, shaped like the dashboard query so
// the hot path performs no join back to the source tables.
model OpsRow {
  id          String      @id @map("id")
  companyId   String      @map("company_id")
  status      OrderStatus @map("status")
  amountCents BigInt      @map("amount_cents")
  // When the order entered its current state; mirrors payment_orders.updated_at.
  occurredAt  DateTime    @map("occurred_at")
  workerName  String?     @map("worker_name")
  eventName   String?     @map("event_name")
  createdAt   DateTime    @map("created_at")
  updatedAt   DateTime    @map("updated_at")

  // Dashboard access pattern: WHERE company_id = ? [AND status = ?]
  // AND occurred_at in range, ORDER BY occurred_at DESC, id DESC.
  // The migration adds INCLUDE (amount_cents, worker_name, event_name,
  // created_at) so the dashboard read is an index-only scan.
  @@index([companyId, status, occurredAt(sort: Desc), id(sort: Desc)], map: "idx_ops_rows_lookup")
  @@map("ops_rows")
}

// Projection: exact per-company financial totals, kept by atomic in-place
// increments inside the write transaction.
model CompanyTotal {
  companyId     String @id @map("company_id")
  totalCents    BigInt @default(0) @map("total_cents")
  approvedCents BigInt @default(0) @map("approved_cents")
  rejectedCents BigInt @default(0) @map("rejected_cents")
  orderCount    Int    @default(0) @map("order_count")

  company Company @relation(fields: [companyId], references: [id])

  @@map("company_totals")
}
```

### prisma/migrations/20240101000000_init/migration.sql
```sql
-- Initial schema for the marketplace back-office.
--
-- Source tables: companies, workers, events, payment_orders.
-- Read-model projection: ops_rows (per-order dashboard rows) and
-- company_totals (exact per-company financial totals).

CREATE TABLE "companies" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL
);

CREATE TABLE "workers" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL
);

CREATE TABLE "events" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "title" TEXT NOT NULL
);

CREATE TABLE "payment_orders" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "company_id" TEXT NOT NULL,
  "worker_id" TEXT,
  "event_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "amount_cents" BIGINT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_orders_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "payment_orders_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Supports the windowed scans used by re-derivation and drift repair.
CREATE INDEX "payment_orders_company_id_idx" ON "payment_orders" ("company_id");

CREATE INDEX "payment_orders_updated_at_idx" ON "payment_orders" ("updated_at");

CREATE TABLE "ops_rows" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "company_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "amount_cents" BIGINT NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "worker_name" TEXT,
  "event_name" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL
);

-- Covering index for the dashboard access pattern:
--   WHERE company_id = ? [AND status = ?] AND occurred_at in range
--   ORDER BY occurred_at DESC, id DESC
-- The INCLUDE columns make the dashboard read an index-only scan.
CREATE INDEX "idx_ops_rows_lookup"
  ON "ops_rows" ("company_id", "status", "occurred_at" DESC, "id" DESC)
  INCLUDE ("amount_cents", "worker_name", "event_name", "created_at");

CREATE TABLE "company_totals" (
  "company_id" TEXT PRIMARY KEY NOT NULL,
  "total_cents" BIGINT NOT NULL DEFAULT 0,
  "approved_cents" BIGINT NOT NULL DEFAULT 0,
  "rejected_cents" BIGINT NOT NULL DEFAULT 0,
  "order_count" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "company_totals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
```

### src/main.ts
```ts
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { EnvelopeExceptionFilter } from './common/exception.filter';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new EnvelopeExceptionFilter());
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
```

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DriftRepairModule } from './drift-repair/drift-repair.module';
import { OperationsModule } from './operations/operations.module';
import { OrdersModule } from './order/order.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectionModule } from './projection/projection.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    OrdersModule,
    OperationsModule,
    ProjectionModule,
    DriftRepairModule,
  ],
})
export class AppModule {}
```

### src/prisma/prisma.service.ts
```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

### src/prisma/prisma.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

### src/common/exception.filter.ts
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';

// Single error envelope for every failure:
//   { "error": { "code": "snake_case", "message": "...", "details": {} } }
// `code` is the contract; `message` is developer-facing English; `details` is
// always an object, never null.
@Catch()
export class EnvelopeExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(EnvelopeExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let details: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const record = body as Record<string, unknown>;
        if (Array.isArray(record.message)) {
          message = (record.message as string[]).join('; ');
          details = { fields: record.message };
        } else if (typeof record.message === 'string') {
          message = record.message;
        }
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    const code = this.codeFor(status);
    if (status >= 500) {
      this.logger.error(
        `Unhandled error (${code}): ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(status).json({ error: { code, message, details } });
  }

  private codeFor(status: number): string {
    switch (status) {
      case 400:
        return 'validation_failed';
      case 401:
        return 'unauthorized';
      case 403:
        return 'forbidden';
      case 404:
        return 'resource_not_found';
      case 409:
        return 'conflict';
      default:
        return 'internal_error';
    }
  }
}
```

### src/projection/projection.repository.ts
```ts
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface OpRowSnapshot {
  id: string;
  companyId: string;
  status: string;
  amountCents: number;
  occurredAt: Date;
  workerName: string | null;
  eventName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TotalsDelta {
  companyId: string;
  totalDelta: number;
  approvedDelta: number;
  rejectedDelta: number;
  countDelta: number;
}

export interface RederiveResult {
  rowsRebuilt: number;
  companiesRecomputed: number;
}

/**
 * The only layer that writes the projection tables.
 *
 * Amounts cross into raw SQL as numbers: at this scale (integer cents;
 * company totals at most a few hundred trillion cents) they stay far below
 * 2^53, while the columns themselves remain BIGINT.
 */
@Injectable()
export class ProjectionRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaClient) {}

  withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, timeoutMs?: number): Promise<T> {
    return timeoutMs === undefined
      ? this.db.$transaction(fn)
      : this.db.$transaction(fn, { timeout: timeoutMs });
  }

  /**
   * Idempotent upsert of one order's projection row. Names are kept from the
   * existing row when the caller has none (status changes do not rename the
   * worker or the event).
   */
  upsertOpRow(tx: Prisma.TransactionClient, row: OpRowSnapshot): Promise<void> {
    return tx
      .$executeRaw`
        INSERT INTO ops_rows (id, company_id, status, amount_cents, occurred_at, worker_name, event_name, created_at, updated_at)
        VALUES (${row.id}, ${row.companyId}, ${row.status}, ${row.amountCents}, ${row.occurredAt}, ${row.workerName}, ${row.eventName}, ${row.createdAt}, ${row.updatedAt})
        ON CONFLICT (id) DO UPDATE SET
          company_id   = EXCLUDED.company_id,
          status       = EXCLUDED.status,
          amount_cents = EXCLUDED.amount_cents,
          occurred_at  = EXCLUDED.occurred_at,
          worker_name  = COALESCE(EXCLUDED.worker_name, ops_rows.worker_name),
          event_name   = COALESCE(EXCLUDED.event_name, ops_rows.event_name),
          updated_at   = EXCLUDED.updated_at
      `
      .then(() => undefined);
  }

  updateOpRowStatus(tx: Prisma.TransactionClient, id: string, status: string, at: Date): Promise<void> {
    return tx
      .$executeRaw`
        UPDATE ops_rows
        SET status = ${status},
            occurred_at = ${at},
            updated_at = ${at}
        WHERE id = ${id}
      `
      .then(() => undefined);
  }

  /**
   * Atomic in-place totals update. Concurrent updates to the same company
   * serialize on the row lock; because there is no read-modify-write, none
   * of them can be lost.
   */
  applyTotalsDelta(tx: Prisma.TransactionClient, d: TotalsDelta): Promise<void> {
    return tx
      .$executeRaw`
        INSERT INTO company_totals (company_id, total_cents, approved_cents, rejected_cents, order_count)
        VALUES (${d.companyId}, ${d.totalDelta}, ${d.approvedDelta}, ${d.rejectedDelta}, ${d.countDelta})
        ON CONFLICT (company_id) DO UPDATE SET
          total_cents    = company_totals.total_cents + EXCLUDED.total_cents,
          approved_cents = company_totals.approved_cents + EXCLUDED.approved_cents,
          rejected_cents = company_totals.rejected_cents + EXCLUDED.rejected_cents,
          order_count    = company_totals.order_count + EXCLUDED.order_count
      `
      .then(() => undefined);
  }

  /**
   * Rebuild the projection for orders whose `updated_at` falls in
   * [from, to]: re-derive every row in the window straight from the source
   * tables and recompute the exact totals of every company the window
   * touches. Every statement is idempotent, so the routine is safe to run
   * while the system is live, and running it twice over the same window
   * leaves the same result.
   */
  async rederiveWindow(tx: Prisma.TransactionClient, from: Date, to: Date): Promise<RederiveResult> {
    const rowsRebuilt = await tx.$executeRaw`
      INSERT INTO ops_rows (id, company_id, status, amount_cents, occurred_at, worker_name, event_name, created_at, updated_at)
      SELECT po.id, po.company_id, po.status, po.amount_cents, po.updated_at, w.name, e.title, po.created_at, po.updated_at
      FROM payment_orders po
      LEFT JOIN workers w ON w.id = po.worker_id
      LEFT JOIN events e ON e.id = po.event_id
      WHERE po.updated_at >= ${from} AND po.updated_at <= ${to}
      ON CONFLICT (id) DO UPDATE SET
        company_id   = EXCLUDED.company_id,
        status       = EXCLUDED.status,
        amount_cents = EXCLUDED.amount_cents,
        occurred_at  = EXCLUDED.occurred_at,
        worker_name  = COALESCE(EXCLUDED.worker_name, ops_rows.worker_name),
        event_name   = COALESCE(EXCLUDED.event_name, ops_rows.event_name),
        updated_at   = EXCLUDED.updated_at
    `;
    const companiesRecomputed = await tx.$executeRaw`
      INSERT INTO company_totals (company_id, total_cents, approved_cents, rejected_cents, order_count)
      SELECT po.company_id,
             COALESCE(SUM(po.amount_cents), 0),
             COALESCE(SUM(po.amount_cents) FILTER (WHERE po.status = 'approved'), 0),
             COALESCE(SUM(po.amount_cents) FILTER (WHERE po.status = 'rejected'), 0),
             COUNT(*)
      FROM payment_orders po
      WHERE po.company_id IN (
        SELECT p2.company_id
        FROM payment_orders p2
        WHERE p2.updated_at >= ${from} AND p2.updated_at <= ${to}
        GROUP BY p2.company_id
      )
      GROUP BY po.company_id
      ON CONFLICT (company_id) DO UPDATE SET
        total_cents    = EXCLUDED.total_cents,
        approved_cents = EXCLUDED.approved_cents,
        rejected_cents = EXCLUDED.rejected_cents,
        order_count    = EXCLUDED.order_count
    `;
    return { rowsRebuilt: Number(rowsRebuilt), companiesRecomputed: Number(companiesRecomputed) };
  }
}
```

### src/projection/projection.service.ts
```ts
import { Inject, Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { ProjectionRepository, RederiveResult } from './projection.repository';

/** Facts about a new order, as observed inside the write transaction. */
export interface CreatedOrderFacts {
  id: string;
  companyId: string;
  status: OrderStatus;
  amountCents: number;
  occurredAt: Date;
  workerName: string | null;
  eventName: string | null;
  createdAt: Date;
}

/** Facts about a status change, as observed inside the write transaction. */
export interface StatusChangeFacts {
  id: string;
  companyId: string;
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
  amountCents: number;
  occurredAt: Date;
}

/**
 * Synchronous maintenance hooks for the operations projection.
 *
 * Every hook takes the write transaction (`tx`) and writes the projection
 * inside it: the source write and its projection commit together, which is
 * what makes read-your-own-writes hold, and it guarantees that a
 * rolled-back write never leaks into the dashboard.
 */
@Injectable()
export class ProjectionService {
  constructor(@Inject(ProjectionRepository) private readonly repo: ProjectionRepository) {}

  async onOrderCreated(tx: Prisma.TransactionClient, facts: CreatedOrderFacts): Promise<void> {
    await this.repo.upsertOpRow(tx, {
      id: facts.id,
      companyId: facts.companyId,
      status: facts.status,
      amountCents: facts.amountCents,
      occurredAt: facts.occurredAt,
      workerName: facts.workerName,
      eventName: facts.eventName,
      createdAt: facts.createdAt,
      updatedAt: facts.occurredAt,
    });
    await this.repo.applyTotalsDelta(tx, {
      companyId: facts.companyId,
      totalDelta: facts.amountCents,
      approvedDelta: 0,
      rejectedDelta: 0,
      countDelta: 1,
    });
  }

  async onOrderStatusChanged(tx: Prisma.TransactionClient, facts: StatusChangeFacts): Promise<void> {
    await this.repo.updateOpRowStatus(tx, facts.id, facts.toStatus, facts.occurredAt);
    const delta = statusDelta(facts.fromStatus, facts.toStatus, facts.amountCents);
    await this.repo.applyTotalsDelta(tx, {
      companyId: facts.companyId,
      totalDelta: 0,
      approvedDelta: delta.approved,
      rejectedDelta: delta.rejected,
      countDelta: 0,
    });
  }

  /**
   * Rebuild the projection for an arbitrary window from the source tables.
   * Idempotent: running it twice over the same window leaves the same result.
   */
  rederiveWindow(from: Date, to: Date): Promise<RederiveResult> {
    return this.repo.withTransaction((tx) => this.repo.rederiveWindow(tx, from, to), 30_000);
  }
}

function statusDelta(from: OrderStatus, to: OrderStatus, amountCents: number): { approved: number; rejected: number } {
  return {
    approved: (to === 'approved' ? amountCents : 0) - (from === 'approved' ? amountCents : 0),
    rejected: (to === 'rejected' ? amountCents : 0) - (from === 'rejected' ? amountCents : 0),
  };
}
```

### src/projection/projection.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProjectionRepository } from './projection.repository';
import { ProjectionService } from './projection.service';

@Module({
  imports: [PrismaModule],
  providers: [ProjectionService, ProjectionRepository],
  exports: [ProjectionService],
})
export class ProjectionModule {}
```

### src/order/create-order.dto.ts
```ts
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateOrderDto {
  @IsString()
  companyId!: string;

  @IsOptional()
  @IsString()
  workerId?: string;

  @IsOptional()
  @IsString()
  eventId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  amountCents!: number;
}
```

### src/order/order.repository.ts
```ts
import { Inject, Injectable } from '@nestjs/common';
import { Company, Event, OrderStatus, PaymentOrder, Prisma, PrismaClient, Worker } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OrderRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaClient) {}

  withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.db.$transaction(fn);
  }

  getCompany(tx: Prisma.TransactionClient, id: string): Promise<Company | null> {
    return tx.company.findUnique({ where: { id } });
  }

  getWorker(tx: Prisma.TransactionClient, id: string): Promise<Worker | null> {
    return tx.worker.findUnique({ where: { id } });
  }

  getEvent(tx: Prisma.TransactionClient, id: string): Promise<Event | null> {
    return tx.event.findUnique({ where: { id } });
  }

  findById(tx: Prisma.TransactionClient, id: string): Promise<PaymentOrder | null> {
    return tx.paymentOrder.findUnique({ where: { id } });
  }

  createOrder(
    tx: Prisma.TransactionClient,
    data: { companyId: string; workerId: string | null; eventId: string | null; amountCents: bigint; at: Date },
  ): Promise<PaymentOrder> {
    return tx.paymentOrder.create({
      data: {
        companyId: data.companyId,
        workerId: data.workerId,
        eventId: data.eventId,
        status: 'pending',
        amountCents: data.amountCents,
        createdAt: data.at,
        updatedAt: data.at,
      },
    });
  }

  /**
   * Guarded status transition: only orders still in `from` move, atomically.
   * Returns null when nothing matched (order missing or wrong status); the
   * caller fetches the row to tell the two cases apart.
   */
  async transition(
    tx: Prisma.TransactionClient,
    id: string,
    from: OrderStatus,
    to: OrderStatus,
    at: Date,
  ): Promise<PaymentOrder | null> {
    const result = await tx.paymentOrder.updateMany({
      where: { id, status: from },
      data: { status: to, updatedAt: at },
    });
    if (result.count === 0) return null;
    return tx.paymentOrder.findUnique({ where: { id } });
  }
}
```

### src/order/order.service.ts
```ts
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, PaymentOrder } from '@prisma/client';
import { ProjectionService } from '../projection/projection.service';
import { OrderRepository } from './order.repository';

export interface CreateOrderInput {
  companyId: string;
  workerId?: string;
  eventId?: string;
  amountCents: number;
}

export interface OrderView {
  id: string;
  companyId: string;
  workerId: string | null;
  eventId: string | null;
  status: OrderStatus;
  amountCents: number;
  createdAt: Date;
  updatedAt: Date;
}

function toView(order: PaymentOrder): OrderView {
  return {
    id: order.id,
    companyId: order.companyId,
    workerId: order.workerId,
    eventId: order.eventId,
    status: order.status,
    amountCents: Number(order.amountCents),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

/**
 * Write path for payment orders (create / approve / reject), simulated here
 * so the projection contract is exercisable. Every write runs in one
 * database transaction that (1) mutates the source row and (2) applies the
 * matching projection hook, so the write and its projection commit or roll
 * back together.
 */
@Injectable()
export class OrderService {
  constructor(
    @Inject(OrderRepository) private readonly orders: OrderRepository,
    @Inject(ProjectionService) private readonly projections: ProjectionService,
  ) {}

  createOrder(input: CreateOrderInput): Promise<OrderView> {
    return this.orders.withTransaction(async (tx) => {
      const company = await this.orders.getCompany(tx, input.companyId);
      if (!company) throw new NotFoundException(`Company ${input.companyId} does not exist`);

      let workerName: string | null = null;
      let eventName: string | null = null;
      if (input.workerId !== undefined) {
        const worker = await this.orders.getWorker(tx, input.workerId);
        if (!worker) throw new NotFoundException(`Worker ${input.workerId} does not exist`);
        workerName = worker.name;
      }
      if (input.eventId !== undefined) {
        const event = await this.orders.getEvent(tx, input.eventId);
        if (!event) throw new NotFoundException(`Event ${input.eventId} does not exist`);
        eventName = event.title;
      }

      const at = new Date();
      const order = await this.orders.createOrder(tx, {
        companyId: input.companyId,
        workerId: input.workerId ?? null,
        eventId: input.eventId ?? null,
        amountCents: BigInt(input.amountCents),
        at,
      });

      await this.projections.onOrderCreated(tx, {
        id: order.id,
        companyId: order.companyId,
        status: order.status,
        amountCents: Number(order.amountCents),
        occurredAt: at,
        workerName,
        eventName,
        createdAt: at,
      });

      return toView(order);
    });
  }

  approveOrder(id: string): Promise<OrderView> {
    return this.transition(id, 'approved');
  }

  rejectOrder(id: string): Promise<OrderView> {
    return this.transition(id, 'rejected');
  }

  private transition(id: string, to: 'approved' | 'rejected'): Promise<OrderView> {
    return this.orders.withTransaction(async (tx) => {
      const at = new Date();
      const updated = await this.orders.transition(tx, id, 'pending', to, at);
      if (!updated) {
        const existing = await this.orders.findById(tx, id);
        if (!existing) throw new NotFoundException(`Order ${id} does not exist`);
        throw new ConflictException(`Order ${id} is ${existing.status} and cannot be ${to}`);
      }

      await this.projections.onOrderStatusChanged(tx, {
        id: updated.id,
        companyId: updated.companyId,
        fromStatus: 'pending',
        toStatus: to,
        amountCents: Number(updated.amountCents),
        occurredAt: at,
      });

      return toView(updated);
    });
  }
}
```

### src/order/order.controller.ts
```ts
import { Body, Controller, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { CreateOrderDto } from './create-order.dto';
import { OrderService, OrderView } from './order.service';

@Controller('orders')
export class OrdersController {
  constructor(@Inject(OrderService) private readonly orders: OrderService) {}

  @Post()
  create(@Body() body: CreateOrderDto): Promise<OrderView> {
    return this.orders.createOrder({
      companyId: body.companyId,
      workerId: body.workerId,
      eventId: body.eventId,
      amountCents: body.amountCents,
    });
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(@Param('id') id: string): Promise<OrderView> {
    return this.orders.approveOrder(id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(@Param('id') id: string): Promise<OrderView> {
    return this.orders.rejectOrder(id);
  }
}
```

### src/order/order.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProjectionModule } from '../projection/projection.module';
import { OrdersController } from './order.controller';
import { OrderRepository } from './order.repository';
import { OrderService } from './order.service';

@Module({
  imports: [PrismaModule, ProjectionModule],
  controllers: [OrdersController],
  providers: [OrderService, OrderRepository],
})
export class OrdersModule {}
```

### src/operations/list-operations-query.dto.ts
```ts
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListOperationsQueryDto {
  @IsString()
  companyId!: string;

  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected'])
  status?: 'pending' | 'approved' | 'rejected';

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
```

### src/operations/operations.repository.ts
```ts
import { Inject, Injectable } from '@nestjs/common';
import { CompanyTotal, OrderStatus, OpsRow, Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface OperationsFilter {
  companyId: string;
  status?: OrderStatus;
  from?: Date;
  to?: Date;
}

/**
 * Read side of the operations dashboard. Every query here touches the
 * projection tables only (ops_rows, company_totals) - never the source.
 */
@Injectable()
export class OperationsRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaClient) {}

  private filterOf(f: OperationsFilter): Prisma.OpsRowWhereInput {
    const where: Prisma.OpsRowWhereInput = { companyId: f.companyId };
    if (f.status) where.status = f.status;
    if (f.from || f.to) {
      const occurredAt: Prisma.DateTimeFilter = {};
      if (f.from) occurredAt.gte = f.from;
      if (f.to) occurredAt.lt = f.to;
      where.occurredAt = occurredAt;
    }
    return where;
  }

  listRows(f: OperationsFilter, page: number, pageSize: number): Promise<OpsRow[]> {
    return this.db.opsRow.findMany({
      where: this.filterOf(f),
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
  }

  countRows(f: OperationsFilter): Promise<number> {
    return this.db.opsRow.count({ where: this.filterOf(f) });
  }

  getCompanyTotal(companyId: string): Promise<CompanyTotal | null> {
    return this.db.companyTotal.findUnique({ where: { companyId } });
  }
}
```

### src/operations/operations.service.ts
```ts
import { Inject, Injectable } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { OperationsFilter, OperationsRepository } from './operations.repository';

export interface OperationsPageInput extends OperationsFilter {
  page: number;
  pageSize: number;
}

export interface OperationItem {
  id: string;
  companyId: string;
  status: OrderStatus;
  amountCents: number;
  occurredAt: Date;
  workerName: string | null;
  eventName: string | null;
  createdAt: Date;
}

export interface OperationsPage {
  items: OperationItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CompanyTotals {
  companyId: string;
  totalCents: number;
  approvedCents: number;
  rejectedCents: number;
  orderCount: number;
}

@Injectable()
export class OperationsService {
  constructor(@Inject(OperationsRepository) private readonly repo: OperationsRepository) {}

  async listOperations(input: OperationsPageInput): Promise<OperationsPage> {
    const filter: OperationsFilter = {
      companyId: input.companyId,
      status: input.status,
      from: input.from,
      to: input.to,
    };
    const [rows, total] = await Promise.all([
      this.repo.listRows(filter, input.page, input.pageSize),
      this.repo.countRows(filter),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        companyId: row.companyId,
        status: row.status,
        amountCents: Number(row.amountCents),
        occurredAt: row.occurredAt,
        workerName: row.workerName,
        eventName: row.eventName,
        createdAt: row.createdAt,
      })),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  async getCompanyTotals(companyId: string): Promise<CompanyTotals> {
    const totals = await this.repo.getCompanyTotal(companyId);
    return {
      companyId,
      totalCents: Number(totals?.totalCents ?? 0n),
      approvedCents: Number(totals?.approvedCents ?? 0n),
      rejectedCents: Number(totals?.rejectedCents ?? 0n),
      orderCount: totals?.orderCount ?? 0,
    };
  }
}
```

### src/operations/operations.controller.ts
```ts
import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { ListOperationsQueryDto } from './list-operations-query.dto';
import { OperationsPage, OperationsService } from './operations.service';

@Controller('operations')
export class OperationsController {
  constructor(@Inject(OperationsService) private readonly operations: OperationsService) {}

  @Get()
  list(@Query() query: ListOperationsQueryDto): Promise<OperationsPage> {
    return this.operations.listOperations({
      companyId: query.companyId,
      status: query.status,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
    });
  }

  @Get('companies/:companyId/totals')
  totals(@Param('companyId') companyId: string): Promise<OperationsService['getCompanyTotals'] extends () => Promise<infer T> ? T : never> {
    return this.operations.getCompanyTotals(companyId);
  }
}
```

### src/operations/operations.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OperationsController } from './operations.controller';
import { OperationsRepository } from './operations.repository';
import { OperationsService } from './operations.service';

@Module({
  imports: [PrismaModule],
  controllers: [OperationsController],
  providers: [OperationsService, OperationsRepository],
})
export class OperationsModule {}
```

### src/drift-repair/drift-repair.repository.ts
```ts
import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface DriftFindings {
  driftedOrderIds: string[];
  driftedCompanyIds: string[];
}

interface DriftedOrderRow {
  id: string;
  company_id: string;
}

interface DriftedTotalRow {
  company_id: string;
}

/**
 * Read-only diff between the projection and the source for one window of
 * source `updated_at`. Flags stale or missing ops_rows and company_totals
 * rows that disagree with the source. The repair action itself is the
 * re-derivation routine (ProjectionService.rederiveWindow).
 */
@Injectable()
export class DriftRepairRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaClient) {}

  async findDrift(from: Date, to: Date): Promise<DriftFindings> {
    const driftedOrders = await this.db.$queryRaw<DriftedOrderRow[]>`
      SELECT po.id, po.company_id
      FROM payment_orders po
      WHERE po.updated_at >= ${from} AND po.updated_at <= ${to}
        AND NOT EXISTS (
          SELECT 1
          FROM ops_rows r
          WHERE r.id = po.id
            AND r.company_id = po.company_id
            AND r.status = po.status
            AND r.amount_cents = po.amount_cents
            AND r.occurred_at = po.updated_at
            AND r.worker_name IS NOT DISTINCT FROM (SELECT w.name FROM workers w WHERE w.id = po.worker_id)
            AND r.event_name IS NOT DISTINCT FROM (SELECT e.title FROM events e WHERE e.id = po.event_id)
        )
      ORDER BY po.id
    `;
    const driftedTotals = await this.db.$queryRaw<DriftedTotalRow[]>`
      WITH windowed AS (
        SELECT p2.company_id
        FROM payment_orders p2
        WHERE p2.updated_at >= ${from} AND p2.updated_at <= ${to}
        GROUP BY p2.company_id
      ),
      source AS (
        SELECT po.company_id,
               COALESCE(SUM(po.amount_cents), 0) AS total_cents,
               COALESCE(SUM(po.amount_cents) FILTER (WHERE po.status = 'approved'), 0) AS approved_cents,
               COALESCE(SUM(po.amount_cents) FILTER (WHERE po.status = 'rejected'), 0) AS rejected_cents,
               COUNT(*) AS order_count
        FROM payment_orders po
        WHERE po.company_id IN (SELECT company_id FROM windowed)
        GROUP BY po.company_id
      )
      SELECT s.company_id
      FROM source s
      LEFT JOIN company_totals t ON t.company_id = s.company_id
      WHERE t.total_cents IS DISTINCT FROM s.total_cents
         OR t.approved_cents IS DISTINCT FROM s.approved_cents
         OR t.rejected_cents IS DISTINCT FROM s.rejected_cents
         OR t.order_count IS DISTINCT FROM s.order_count
    `;
    return {
      driftedOrderIds: driftedOrders.map((row) => row.id),
      driftedCompanyIds: [
        ...new Set([
          ...driftedOrders.map((row) => row.company_id),
          ...driftedTotals.map((row) => row.company_id),
        ]),
      ],
    };
  }
}
```

### src/drift-repair/drift-repair.service.ts
```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ProjectionService } from '../projection/projection.service';
import { DriftRepairRepository } from './drift-repair.repository';

export interface DriftRepairReport {
  from: Date;
  to: Date;
  repaired: boolean;
  driftedOrders: number;
  driftedCompanies: number;
  rowsRebuilt: number;
  companiesRecomputed: number;
}

const DEFAULT_INTERVAL_MS = 5 * 60_000;
const DEFAULT_LOOKBACK_HOURS = 24;

/**
 * Scheduled drift repair: periodically compare the projection against the
 * source for a recent window and repair whatever disagrees, so a
 * mid-transaction deploy or a manual data fix is noticed by the system
 * before a person notices it.
 */
@Injectable()
export class DriftRepairService {
  private readonly logger = new Logger(DriftRepairService.name);

  constructor(
    @Inject(DriftRepairRepository) private readonly drift: DriftRepairRepository,
    @Inject(ProjectionService) private readonly projections: ProjectionService,
  ) {}

  @Interval(() => Number(process.env.DRIFT_REPAIR_INTERVAL_MS) || DEFAULT_INTERVAL_MS)
  async runScheduled(): Promise<DriftRepairReport> {
    const report = await this.repairRecentWindow();
    this.logger.log(
      `drift repair ${report.repaired ? 'repaired' : 'clean'}: ` +
        `orders=${report.driftedOrders} companies=${report.driftedCompanies} ` +
        `rowsRebuilt=${report.rowsRebuilt} ` +
        `window=[${report.from.toISOString()}, ${report.to.toISOString()}]`,
    );
    return report;
  }

  async repairRecentWindow(): Promise<DriftRepairReport> {
    const to = new Date();
    const lookbackHours = Number(process.env.DRIFT_REPAIR_LOOKBACK_HOURS) || DEFAULT_LOOKBACK_HOURS;
    return this.repairWindow(new Date(to.getTime() - lookbackHours * 3_600_000), to);
  }

  async repairWindow(from: Date, to: Date): Promise<DriftRepairReport> {
    const findings = await this.drift.findDrift(from, to);
    const base = {
      from,
      to,
      driftedOrders: findings.driftedOrderIds.length,
      driftedCompanies: findings.driftedCompanyIds.length,
    };
    if (findings.driftedOrderIds.length === 0 && findings.driftedCompanyIds.length === 0) {
      return { ...base, repaired: false, rowsRebuilt: 0, companiesRecomputed: 0 };
    }
    const result = await this.projections.rederiveWindow(from, to);
    return { ...base, repaired: true, rowsRebuilt: result.rowsRebuilt, companiesRecomputed: result.companiesRecomputed };
  }
}
```

### src/drift-repair/drift-repair.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProjectionModule } from '../projection/projection.module';
import { DriftRepairRepository } from './drift-repair.repository';
import { DriftRepairService } from './drift-repair.service';

@Module({
  imports: [PrismaModule, ProjectionModule],
  providers: [DriftRepairService, DriftRepairRepository],
  exports: [DriftRepairService],
})
export class DriftRepairModule {}
```

### test/helpers/db.ts
```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = path.resolve(here, '../../prisma/migrations/20240101000000_init/migration.sql');

// The test database is provisioned out-of-band: a Postgres reachable via
// DATABASE_URL (see .env.example). When it is absent the suites skip rather
// than fail.
export const hasDatabase = Boolean(process.env.DATABASE_URL);

export function connect(): PrismaClient {
  return new PrismaClient();
}

// Drop everything and re-apply the shipped migration verbatim, so the tests
// run against exactly the DDL the migration deploys.
export async function resetSchema(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'DROP TABLE IF EXISTS ops_rows, company_totals, payment_orders, workers, events, companies CASCADE',
  );
  const sql = readFileSync(MIGRATION_SQL, 'utf8');
  for (const statement of sql.split(';\n')) {
    const trimmed = statement.trim();
    if (trimmed) await prisma.$executeRawUnsafe(trimmed);
  }
}

export async function resetData(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE ops_rows, company_totals, payment_orders, workers, events, companies',
  );
}
```

### test/helpers/services.ts
```ts
import { PrismaClient } from '@prisma/client';
import { DriftRepairRepository } from '../../src/drift-repair/drift-repair.repository';
import { DriftRepairService } from '../../src/drift-repair/drift-repair.service';
import { OperationsRepository } from '../../src/operations/operations.repository';
import { OperationsService } from '../../src/operations/operations.service';
import { OrderRepository } from '../../src/order/order.repository';
import { OrderService } from '../../src/order/order.service';
import { ProjectionRepository } from '../../src/projection/projection.repository';
import { ProjectionService } from '../../src/projection/projection.service';

/**
 * Build the same object graph the Nest modules wire up, directly, so the
 * tests drive the real services and repositories against a real database.
 */
export function buildServices(prisma: PrismaClient) {
  const projectionRepository = new ProjectionRepository(prisma);
  const projectionService = new ProjectionService(projectionRepository);
  const orderRepository = new OrderRepository(prisma);
  const orderService = new OrderService(orderRepository, projectionService);
  const operationsRepository = new OperationsRepository(prisma);
  const operationsService = new OperationsService(operationsRepository);
  const driftRepairRepository = new DriftRepairRepository(prisma);
  const driftRepairService = new DriftRepairService(driftRepairRepository, projectionService);
  return { projectionService, orderService, operationsService, driftRepairService };
}
```

### test/helpers/seed.ts
```ts
import { Company, Event, PrismaClient, Worker } from '@prisma/client';

export interface Seed {
  company: Company;
  worker: Worker;
  event: Event;
}

export async function seedLookup(prisma: PrismaClient, companyName = 'Acme'): Promise<Seed> {
  const company = await prisma.company.create({ data: { name: companyName } });
  const worker = await prisma.worker.create({ data: { name: 'Wendy' } });
  const event = await prisma.event.create({ data: { title: 'Launch' } });
  return { company, worker, event };
}
```

### test/read-your-own-writes.spec.ts
```ts
import 'reflect-metadata';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connect, hasDatabase, resetData, resetSchema } from './helpers/db';
import { buildServices } from './helpers/services';
import { seedLookup } from './helpers/seed';

describe.skipIf(!hasDatabase)('read your own writes', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildServices>;

  beforeAll(async () => {
    prisma = connect();
    await resetSchema(prisma);
    app = buildServices(prisma);
  });
  beforeEach(async () => {
    await resetData(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('shows a new order on the very next dashboard request, with the denormalized names', async () => {
    const { company, worker, event } = await seedLookup(prisma);
    const order = await app.orderService.createOrder({
      companyId: company.id,
      workerId: worker.id,
      eventId: event.id,
      amountCents: 12345,
    });

    const page = await app.operationsService.listOperations({ companyId: company.id, page: 1, pageSize: 20 });

    expect(page.total).toBe(1);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: order.id,
      companyId: company.id,
      status: 'pending',
      amountCents: 12345,
      workerName: 'Wendy',
      eventName: 'Launch',
    });
  });

  it('shows an approval immediately, in the list and behind the status filter', async () => {
    const { company } = await seedLookup(prisma);
    const order = await app.orderService.createOrder({ companyId: company.id, amountCents: 5000 });
    await app.orderService.approveOrder(order.id);

    const approved = await app.operationsService.listOperations({
      companyId: company.id,
      status: 'approved',
      page: 1,
      pageSize: 20,
    });
    const pending = await app.operationsService.listOperations({
      companyId: company.id,
      status: 'pending',
      page: 1,
      pageSize: 20,
    });

    expect(approved.items.map((row) => row.id)).toEqual([order.id]);
    expect(approved.items[0].status).toBe('approved');
    expect(pending.items).toEqual([]);
  });

  it('keeps the projection consistent when a duplicate approval rolls back', async () => {
    const { company } = await seedLookup(prisma);
    const order = await app.orderService.createOrder({ companyId: company.id, amountCents: 7500 });
    await app.orderService.approveOrder(order.id);

    // The second approval hits the status guard, rolls back its transaction,
    // and must leave both the list and the totals exactly as before.
    await expect(app.orderService.approveOrder(order.id)).rejects.toBeInstanceOf(ConflictException);

    const page = await app.operationsService.listOperations({ companyId: company.id, page: 1, pageSize: 20 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].status).toBe('approved');

    const totals = await app.operationsService.getCompanyTotals(company.id);
    expect(totals).toEqual({
      companyId: company.id,
      totalCents: 7500,
      approvedCents: 7500,
      rejectedCents: 0,
      orderCount: 1,
    });
  });

  it('rejects a write for a missing order and leaves the projection untouched', async () => {
    const { company } = await seedLookup(prisma);

    await expect(app.orderService.approveOrder('does-not-exist')).rejects.toBeInstanceOf(NotFoundException);

    const page = await app.operationsService.listOperations({ companyId: company.id, page: 1, pageSize: 20 });
    const totals = await app.operationsService.getCompanyTotals(company.id);
    expect(page.items).toEqual([]);
    expect(totals.totalCents).toBe(0);
    expect(totals.orderCount).toBe(0);
  });
});
```

### test/concurrent-totals.spec.ts
```ts
import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OrderView } from '../src/order/order.service';
import { connect, hasDatabase, resetData, resetSchema } from './helpers/db';
import { buildServices } from './helpers/services';
import { seedLookup } from './helpers/seed';

describe.skipIf(!hasDatabase)('concurrent updates to one company totals', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildServices>;

  beforeAll(async () => {
    prisma = connect();
    await resetSchema(prisma);
    app = buildServices(prisma);
  });
  beforeEach(async () => {
    await resetData(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('keeps totals exact when 20 orders of the same company are approved concurrently', async () => {
    const { company } = await seedLookup(prisma);
    const orders: OrderView[] = [];
    for (let i = 0; i < 20; i += 1) {
      orders.push(await app.orderService.createOrder({ companyId: company.id, amountCents: 7777 }));
    }

    // All 20 approvals target the same company_totals row and run in
    // parallel, each inside its own transaction - this is the race a
    // read-modify-write would lose.
    await Promise.all(orders.map((order) => app.orderService.approveOrder(order.id)));

    const totals = await app.operationsService.getCompanyTotals(company.id);
    const expected = 20 * 7777;
    expect(totals.orderCount).toBe(20);
    expect(totals.totalCents).toBe(expected);
    expect(totals.approvedCents).toBe(expected);
    expect(totals.rejectedCents).toBe(0);

    // Cross-check the projection against the source: it must equal the truth.
    const source = await prisma.paymentOrder.aggregate({
      where: { companyId: company.id },
      _count: { _all: true },
      _sum: { amountCents: true },
    });
    expect(Number(source._sum.amountCents ?? 0n)).toBe(totals.totalCents);
    expect(source._count._all).toBe(totals.orderCount);
  });

  it('keeps totals exact when approve and reject race on the same totals row', async () => {
    const { company } = await seedLookup(prisma);
    const toApprove = await app.orderService.createOrder({ companyId: company.id, amountCents: 1111 });
    const toReject = await app.orderService.createOrder({ companyId: company.id, amountCents: 2222 });

    await Promise.all([
      app.orderService.approveOrder(toApprove.id),
      app.orderService.rejectOrder(toReject.id),
    ]);

    const totals = await app.operationsService.getCompanyTotals(company.id);
    expect(totals.totalCents).toBe(3333);
    expect(totals.approvedCents).toBe(1111);
    expect(totals.rejectedCents).toBe(2222);
    expect(totals.orderCount).toBe(2);
  });
});
```

### test/drift-repair.spec.ts
```ts
import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connect, hasDatabase, resetData, resetSchema } from './helpers/db';
import { buildServices } from './helpers/services';
import { seedLookup } from './helpers/seed';

describe.skipIf(!hasDatabase)('drift repair', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildServices>;

  beforeAll(async () => {
    prisma = connect();
    await resetSchema(prisma);
    app = buildServices(prisma);
  });
  beforeEach(async () => {
    await resetData(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seedTwoOrders() {
    const { company, worker, event } = await seedLookup(prisma);
    const pending = await app.orderService.createOrder({
      companyId: company.id,
      workerId: worker.id,
      eventId: event.id,
      amountCents: 1000,
    });
    const approved = await app.orderService.createOrder({
      companyId: company.id,
      workerId: worker.id,
      eventId: event.id,
      amountCents: 2000,
    });
    await app.orderService.approveOrder(approved.id);
    return { company, pending, approved };
  }

  it('detects and repairs injected drift (stale status, missing row, wrong totals)', async () => {
    const { company, pending, approved } = await seedTwoOrders();

    // Inject three different kinds of drift straight into the projection.
    await prisma.$executeRaw`UPDATE ops_rows SET status = 'approved' WHERE id = ${pending.id}`;
    await prisma.$executeRaw`DELETE FROM ops_rows WHERE id = ${approved.id}`;
    await prisma.$executeRaw`UPDATE company_totals SET approved_cents = approved_cents + 1 WHERE company_id = ${company.id}`;

    const report = await app.driftRepairService.repairRecentWindow();

    expect(report.repaired).toBe(true);
    expect(report.driftedOrders).toBe(2);
    expect(report.driftedCompanies).toBe(1);

    // The projection matches the source again.
    const rows = await prisma.opsRow.findMany({ where: { companyId: company.id }, orderBy: { id: 'asc' } });
    expect(rows.map((row) => ({ id: row.id, status: row.status }))).toEqual([
      { id: pending.id, status: 'pending' },
      { id: approved.id, status: 'approved' },
    ]);
    const totals = await app.operationsService.getCompanyTotals(company.id);
    expect(totals.totalCents).toBe(3000);
    expect(totals.approvedCents).toBe(2000);
    expect(totals.rejectedCents).toBe(0);
    expect(totals.orderCount).toBe(2);
  });

  it('repairs a window where only the totals drifted', async () => {
    const { company } = await seedTwoOrders();
    await prisma.$executeRaw`UPDATE company_totals SET total_cents = total_cents - 5 WHERE company_id = ${company.id}`;

    const report = await app.driftRepairService.repairRecentWindow();

    expect(report.repaired).toBe(true);
    expect(report.driftedOrders).toBe(0);
    expect(report.driftedCompanies).toBe(1);
    const totals = await app.operationsService.getCompanyTotals(company.id);
    expect(totals.totalCents).toBe(3000);
    expect(totals.approvedCents).toBe(2000);
  });

  it('does nothing when the projection already matches the source', async () => {
    const { company } = await seedTwoOrders();
    const before = await prisma.opsRow.findMany({ where: { companyId: company.id } });

    const report = await app.driftRepairService.repairRecentWindow();

    expect(report.repaired).toBe(false);
    expect(report.driftedOrders).toBe(0);
    expect(report.driftedCompanies).toBe(0);
    expect(report.rowsRebuilt).toBe(0);
    const after = await prisma.opsRow.findMany({ where: { companyId: company.id } });
    expect(after).toEqual(before);
  });
});
```

### test/rederive.spec.ts
```ts
import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connect, hasDatabase, resetData, resetSchema } from './helpers/db';
import { buildServices } from './helpers/services';
import { seedLookup } from './helpers/seed';

async function snapshot(prisma: PrismaClient, companyId: string) {
  const [rows, totals] = await Promise.all([
    prisma.opsRow.findMany({ where: { companyId }, orderBy: { id: 'asc' } }),
    prisma.companyTotal.findUnique({ where: { companyId } }),
  ]);
  return {
    rows: rows.map((row) => ({
      id: row.id,
      status: row.status,
      amountCents: Number(row.amountCents),
      occurredAt: row.occurredAt,
      workerName: row.workerName,
      eventName: row.eventName,
    })),
    totals: totals
      ? {
          totalCents: Number(totals.totalCents),
          approvedCents: Number(totals.approvedCents),
          rejectedCents: Number(totals.rejectedCents),
          orderCount: totals.orderCount,
        }
      : null,
  };
}

describe.skipIf(!hasDatabase)('windowed re-derivation', () => {
  let prisma: PrismaClient;
  let app: ReturnType<typeof buildServices>;

  beforeAll(async () => {
    prisma = connect();
    await resetSchema(prisma);
    app = buildServices(prisma);
  });
  beforeEach(async () => {
    await resetData(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rebuilds the projection for a window from the source tables', async () => {
    const before = new Date(Date.now() - 60_000);
    const { company, worker, event } = await seedLookup(prisma);
    const a = await app.orderService.createOrder({
      companyId: company.id,
      workerId: worker.id,
      eventId: event.id,
      amountCents: 100,
    });
    const b = await app.orderService.createOrder({
      companyId: company.id,
      workerId: worker.id,
      eventId: event.id,
      amountCents: 200,
    });
    const c = await app.orderService.createOrder({ companyId: company.id, amountCents: 300 });
    await app.orderService.approveOrder(a.id);
    await app.orderService.rejectOrder(b.id);
    const after = new Date();

    // Wipe the projection so the re-derivation has to rebuild it.
    await prisma.$executeRaw`TRUNCATE ops_rows, company_totals`;

    const result = await app.projectionService.rederiveWindow(before, after);

    expect(result.rowsRebuilt).toBe(3);
    expect(result.companiesRecomputed).toBe(1);

    const rows = await prisma.opsRow.findMany({ where: { companyId: company.id }, orderBy: { id: 'asc' } });
    expect(rows.map((row) => ({ id: row.id, status: row.status, amountCents: Number(row.amountCents) }))).toEqual([
      { id: a.id, status: 'approved', amountCents: 100 },
      { id: b.id, status: 'rejected', amountCents: 200 },
      { id: c.id, status: 'pending', amountCents: 300 },
    ]);
    // Denormalized names survive the rebuild (and stay null where the source has none).
    expect(rows[0].workerName).toBe('Wendy');
    expect(rows[0].eventName).toBe('Launch');
    expect(rows[2].workerName).toBeNull();

    const totals = await app.operationsService.getCompanyTotals(company.id);
    expect(totals.totalCents).toBe(600);
    expect(totals.approvedCents).toBe(100);
    expect(totals.rejectedCents).toBe(200);
    expect(totals.orderCount).toBe(3);
  });

  it('leaves the same result when run twice over the same window', async () => {
    const before = new Date(Date.now() - 60_000);
    const { company } = await seedLookup(prisma);
    const a = await app.orderService.createOrder({ companyId: company.id, amountCents: 111 });
    await app.orderService.approveOrder(a.id);
    const after = new Date();

    await app.projectionService.rederiveWindow(before, after);
    const first = await snapshot(prisma, company.id);
    await app.projectionService.rederiveWindow(before, after);
    const second = await snapshot(prisma, company.id);

    expect(second).toEqual(first);
  });
});
```

### DESIGN.md
```md
# DESIGN.md — Operations dashboard projection

## Context

The operations list joins `payment_orders`, `events` and `workers`, filters by
company, status and date range, sorts by recency, and paginates. At ~3M orders
that is a 20–30s query. Target: p95 < 50 ms with no change to what an operator
sees, under two hard constraints:

1. **Read your own writes** — approve an order and the next request shows it.
2. **Exact per-company financial totals** — finance reconciles against them.

## Shape of the solution

Two projection tables, both shaped like the read:

- `ops_rows` — one row per payment order, denormalized with `worker_name` /
  `event_name` so the hot path performs no join. `occurred_at` mirrors the
  source `updated_at` (the recency of the order's current state).
- `company_totals` — one row per company with exact cents totals
  (`total_cents`, `approved_cents`, `rejected_cents`, `order_count`).

Indexes:

- `ops_rows (company_id, status, occurred_at DESC, id DESC) INCLUDE
  (amount_cents, worker_name, event_name, created_at)` — the dashboard is an
  index-only scan: equality on the leading columns, range on `occurred_at`,
  the sort order built in, and the payload in the leaf pages. `id` breaks ties
  so pagination is stable.
- `payment_orders (updated_at)` and `payment_orders (company_id)` — for the
  windowed scans used by re-derivation and drift repair.

## Why the maintenance hook runs in the writer's transaction

Read-your-own-writes is the whole design constraint. Every alternative to an
in-transaction hook has a visibility window:

| Alternative | Window in which the operator's own write is invisible |
|---|---|
| Scheduled refresh / materialized view | Up to the interval, however short |
| Post-commit hook → queue/worker | Worker latency, unbounded under load |
| CDC / logical replication into the projection | WAL + consumer lag |
| Trigger or job on a replica | Replication lag |

The requirement allows no window, so the hook is a plain method call from the
write service, inside the same database transaction as the source write:

- the operator's write and its projection commit together — the very next read
  sees both;
- if the write rolls back (status guard, constraint error), the projection
  never saw it — no phantom rows, no torn totals;
- a hook that throws fails the write, which is the correct behavior: rather
  than silently serve a stale dashboard, the operator gets an error.

A Postgres trigger would give the same atomicity but hides business logic in
the schema: invisible to the service layer, harder to test, and it splits the
write path across two languages. The hook stays in TypeScript where the rest
of the write path lives. The write path (create / approve / reject) is
simulated by the orders module so the contract is exercisable end to end.

## Exact totals under concurrency

Two concurrent approvals move the same `company_totals` row. A
read-modify-write loses one increment. Instead, every change is an atomic
in-place increment:

```sql
INSERT INTO company_totals (...) VALUES (...)
ON CONFLICT (company_id) DO UPDATE SET
  total_cents = company_totals.total_cents + EXCLUDED.total_cents, ...
```

Postgres serializes these on the row lock, and because no read is involved
nothing can be lost. The concurrent-totals test exercises it with 20 parallel
approvals on one company.

## Re-derivation and drift repair

The projection is recoverable, not precious:

- `ProjectionService.rederiveWindow(from, to)` rebuilds every `ops_rows`
  entry for orders whose `updated_at` falls in the window (a straight join
  back to the source, applied as `INSERT … ON CONFLICT` upserts) and
  recomputes the exact totals of every company the window touches (a full
  aggregate, not a delta). All statements are idempotent, so running it twice
  over the same window leaves the same result, and it is safe to run while
  the system is live: a concurrent write either lands in this rebuild or is
  picked up by the next cycle.
- `DriftRepairService` runs on a schedule (interval and lookback come from
  the environment). Each run diffs the projection against the source for a
  recent window — stale or missing `ops_rows`, `company_totals` disagreeing
  with the source aggregate — and, only if something disagrees, repairs it by
  re-deriving the window. It logs the outcome, so a mid-transaction deploy or
  a manual data fix is noticed by the system before a person notices it.

Drift is expected and handled: the in-transaction hook keeps the dashboard
right in the normal case, and re-derivation keeps it right in every other
case.

## What the operator sees

Unchanged: same columns, same filters (company, status, date range), same
ordering (recency, `id` as a stable tie-break), same page sizes. The query now
touches `ops_rows` only — no join to the source on the hot path — and the
pagination count is a second index-only scan.

## Known trade-offs

- Each write pays for one row upsert plus one row increment inside its own
  transaction: sub-millisecond, on rows the write already touches.
- Amounts cross between Prisma (BIGINT/BigInt) and raw SQL (numeric literal)
  as JS numbers; at this scale (integer cents) they stay far below 2^53,
  while the columns remain BIGINT.
- Worker/event renames are not hooked (the simulated write path is the order
  lifecycle); the drift job converges them within one lookback window, and a
  wider `rederiveWindow` call repairs older history.
- The drift job's window follows recent activity (`updated_at`); a manual fix
  that does not bump `updated_at` on an old order needs a one-off
  `rederiveWindow` over a wider range — the same routine, different
  parameters.

## Running it

```
pnpm install          # generates the Prisma client (postinstall)
pnpm migrate          # applies prisma/migrations against DATABASE_URL
pnpm start            # API (tsx src/main.ts)
pnpm test             # Vitest; skips cleanly when DATABASE_URL is unset
```
```
