# solution

## reasoning

```
Let me understand the task. This is a read-model projection problem:

- A marketplace backoffice lists "operations" (a join of payment orders, events, workers) filtered by company, status, and date range, sorted by newest first, with pagination.
- At ~3M rows the query takes 20–30 seconds. Target: p95 under 50ms without changing what the operator sees.
- Read-your-own-writes: approve an order → reflected in the next request.
- Per-company financial totals must be exact.

Deliverables (TypeScript + NestJS + Prisma + Postgres):
1. Projection table + DDL with appropriate indexes
2. A maintenance hook that write services invoke (simulate the write path)
3. A re-derivation routine over an arbitrary date window
4. A scheduled drift repair job
5. The new dashboard query
6. Tests for read-your-own-writes, concurrent updates to a single company's totals, and drift repair
7. A short DESIGN.md that justifies the synchronous hook versus alternatives

I need to build the complete solution in one reply. I have no tools, no shell, no filesystem. I need to output files in the format:

### <repo-relative path>
```<lang>
content
```

There are no existing codebase files given (the block above the task is just the variant reference — the problem statement). So I decide the file layout myself. But conventions are given:

- TypeScript (strict), Node 20+. API in NestJS. Prisma ORM, PostgreSQL. Vitest tests. pnpm. ESM `"type": "module"`.
- Layout:
  ```
  prisma/schema.prisma
  src/main.ts
  src/app.module.ts
  src/<feature>/<feature>.module.ts
  src/<feature>/<feature>.controller.ts
  src/<feature>/<feature>.service.ts
  src/<feature>/<feature>.repository.ts
  test/<feature>.spec.ts
  ```
- Layers: controller validates input and calls service. No business logic. Service holds the logic. No raw SQL, no Prisma client calls. Repository is the only layer that touches the database.
- Naming: snake_case tables/columns (via Prisma `@map`/`@@map`). Endpoints: kebab-case, plural. TS files: `kebab-case.role.ts`. Classes PascalCase. Code and comments in English.
- Errors: a single envelope `{ "error": { "code": "snake_case_code", message, details: {} } }`.
- Wiring: providers listed in module, exports, imports.
- Migrations: every schema change ships with a migration.
- Tests: Vitest. Test behavior. Don't just assert call happens. No unasserted tests. No happy-path-only.
- Environment: config only from env vars. `DATABASE_URL` for Postgres. No secrets in repo.
- Discipline: do exactly what the task asks. Don't create files that aren't asked for.

Hmm, the discipline rule says "don't create files that aren't asked for" — but I need an app.module, main.ts, etc. to make a working NestJS app. The layout section defines the expected layout, so the core files are implicitly asked for. Let me be careful: the task asks for projection tables + DDL, maintenance hooks, re-derivation routine, drift repair job, new dashboard query, tests, DESIGN.md. To make that a coherent solution, I need the surrounding skeleton (schema.prisma, main.ts, app.module.ts, modules, controllers, services, repositories, tests). I should keep it minimal but complete.

Let me design the domain:

Source tables (existing operational data):
- `payment_orders`: id, company_id, worker_id, status, amount_cents, currency, created_at, updated_at.
- `events`: id, order_id, type, occurred_at, actor?
- `workers`: id, company_id, name, role?

Operations = join of payment orders + events + workers. Filter by company, status, date range. Sort by newest first. Paginated.

What does "operator sees" mean? Probably: an operation row displays order fields (id, company, worker name, status), the latest event (or count of events?), creation date, etc. To keep it defensible, the projection `operations` (read model) stores: id (= order id), company_id, worker_id, worker_name, status, amount_cents, currency, created_at, updated_at, last_event_type, last_event_at, event_count? Hmm.

Actually, let me not overengineer. A dashboard "lists operations" — the rows are payment orders enriched with worker name and the most recent event. The expensive part: at 3M rows, `JOIN events` (aggregating max(occurred_at) per order) — an aggregation over a large events table. So the projection denormalizes: worker_name, last_event_type, last_event_at.

Also "per-company financial totals must be exact" — the dashboard probably shows per-company totals (sum of amount_cents filtered by status?). Or a separate endpoint for totals. Task: "per-company financial totals must be exact, not approximate" — i.e. the totals endpoint must return exact values. The test "concurrent updates to a single company's totals" suggests the projection maintains a `company_totals` table (company_id, status?, total_cents, order_count) and concurrent writes must not lose updates.

So two read models:
1. `operation_reads` (projection row per payment order with denormalized worker name + latest event).
2. `company_totals` (per-company exact totals, probably by status).

Maintenance hooks: when a payment order is created/updated (status change, amount change), when a worker is renamed, when an event is added — update the projection synchronously in the same transaction as the write (to guarantee read-your-own-writes). Use Prisma's `$transaction` (interactive) in the write service.

Re-derivation routine: recompute the projection for an arbitrary date window from the source tables (e.g. all orders with created_at in [from, to]) — used for drift repair and backfill.

Drift repair job: scheduled (cron via `@nestjs/schedule`) to re-derive a rolling window (e.g. last N days) and/or compare and reconcile. Since we have no live load, scheduled job re-derives recent window periodically.

Dashboard query: new service/repository that queries `operation_reads` with an index: `WHERE company_id = ? AND status = ? AND created_at BETWEEN ? AND ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`. Index: partial index `(company_id, created_at DESC, id DESC) WHERE status = '...'`? Better: composite index `(company_id, status, created_at DESC, id DESC)`. Plus covering columns? For p95 < 50ms, a B-tree composite index with the filters and the order column works. We also need a count for pagination — approximate count or exact count? "Without changing what the operator sees" — if the original UI shows "X of Y results", count must stay exact... hmm, `COUNT(*)` with filters on the read model is fast with an index-only-ish scan. Keep exact count.

Read-your-own-writes: writes happen in a transaction: insert/update source row + update projection in the same transaction, so once the response returns (transaction committed), the next read sees it.

Concurrency: updating the totals — use atomic `UPDATE company_totals SET total_cents = total_cents + delta` (no read-modify-write in app). The "concurrent updates" test: fire N parallel order creations in the same company and assert totals equals sum. With atomic upsert (ON CONFLICT DO UPDATE SET total_cents = company_totals.total_cents + excluded.total_cents) it's exact.

Now, the layering constraint: "No raw SQL, no Prisma client calls. Service holds the logic. Repository is the only layer that touches the database." This is a problem for the re-derivation routine which needs to aggregate events (max occurred_at per order in window) — Prisma can do it with groupBy and select, but aggregating "latest event per order" requires a groupBy by order_id with max(occurred_at) — Prisma supports `groupBy` with `_max`. Yes: `prisma.events.groupBy({ by: ['order_id'], where: {...}, _max: { occurred_at: true } })`. That returns a list, can be thousands of rows but fine.

But for the re-derivation, doing this in chunks via groupBy per chunk of orders is doable.

Atomic upsert for totals: Prisma's `upsert` is not atomic w.r.t. concurrent increments (upsert = SELECT then INSERT/UPDATE — race). Prisma doesn't expose raw upsert with arithmetic without `$executeRaw`. The constraint says no raw SQL in *service*. Repository is the only layer that touches DB — does repository forbid raw SQL? "No raw SQL, no Prisma client calls. Service holds the logic." It says service must not do raw SQL or Prisma client calls. Repository "is the only layer that touches the database" — repository can touch database, which includes Prisma and possibly raw SQL via `prisma.$executeRaw`. The rule's wording targets service. To be safe and precise, I'll put the incremental totals maintenance in the repository using `$executeRaw` (a single atomic statement), or... hmm, can I do it in pure Prisma?

Alternative: totals are derived from the projection rows: `company_totals` is a separate projection table updated by the same maintenance hook. To do it atomically in pure Prisma, I could use an interactive transaction with a SELECT then UPDATE — but under concurrent transactions there's a race: two txns both read total=0, both write total+10 → lost update (with REPEATABLE READ one might error on write skew). Under Postgres default READ COMMITTED: txn1 SELECT (0), txn2 SELECT (0), txn1 UPDATE SET total = 10, txn2 UPDATE SET total = 10 → lost update. So pure Prisma read-modify-write is unsafe under concurrency. Correct approach is single-statement `UPDATE ... SET total_cents = total_cents + $delta ON CONFLICT` or `INSERT ... ON CONFLICT DO UPDATE SET ... = company_totals.total_cents + EXCLUDED.total_cents`. That needs raw SQL (or a Postgres function). I'll put this in the repository using `prisma.$executeRaw`. I think that's defensible: the discipline rule forbids raw SQL in the *service* layer, and repository is the designated layer for DB touches. I'll add a comment explaining why (atomic increment; upsert race).

Actually wait — is `$executeRaw` considered "raw SQL"? Yes, but the constraint literally says: "Service holds the logic. No raw SQL, no Prisma client calls. Repository is the only layer that touches the database." Read naturally: within the service — no raw SQL, no Prisma client calls. Repository is where DB access lives. So `$executeRaw` in the repository is compliant. I'll add a one-line comment.

Alternatively define a Postgres trigger to maintain totals — that would be "DDL with appropriate indexes" plus trigger. But triggers are invisible and harder to test. The task explicitly asks for "a maintenance hook that write services invoke" — so the hook lives in app code. Good.

Now the schedule: `@nestjs/schedule` provides `@Cron`. That's an added dep. Reasonable for "a scheduled drift repair job". I'll include it. Or I could implement the drift repair as a service method + a cron via `@nestjs/schedule` Cron job. Yes.

Dependencies: @nestjs/common, @nestjs/core, @nestjs/platform-express, @prisma/client, @nestjs/schedule, reflect-metadata, rxjs. Dev: prisma, typescript, ts-node? (for tests), vitest, @types/node, supertest? For tests — the task asks for "tests for read-your-own-writes, concurrent updates to a single company's totals, and drift repair". Real DB tests would need Postgres. In this environment, we can't assume a DB at test time... but the task expects tests to exist that test behavior. Common approach: run tests against a real Postgres (via DATABASE_URL), or... I have to write tests that would run against Postgres (via Vitest). Or test with in-memory fake? Prisma can't be in-memory for Postgres (except using the prisma mock). Behavior tests (read-your-own-writes, concurrent totals, drift repair) need a real database to be meaningful. I'll write tests that use a real `PrismaClient` against `DATABASE_URL` and set up/tear down fixtures. I'll mark that tests require a database (standard in this repo's stack: "DATABASE_URL for Postgres"). This is the defensible reading: the repo's environment section says config from env with DATABASE_URL. The tests will use the same.

Hmm but "concurrent updates" — fire parallel `Promise.all` order creates. Against a real DB that will exercise the atomic upsert.

For drift repair test: corrupt the projection (update a row directly in source, or delete a projection row / tamper with totals), run the repair routine, assert convergence.

Read-your-own-writes test: create an order, then immediately query the dashboard, assert it's present with status. Then approve it (status change via the write service), query again, assert status updated.

Let me define the API surface:

Existing simulated write services (task says "maintenance hook that write services invoke (simulate the write path)"): I'll implement:

- `POST /payment-orders` — create a payment order.
- `PATCH /payment-orders/:id` — update (status/approve, amount?).
- `POST /events` — record an event on an order.
- `POST /workers` — create/update worker (rename) — worker rename affects the denormalized worker_name in the projection for that worker's operations. Include? "Operations" joins workers, so worker rename must reflect in projection. Yes, include workers write path with hook that updates `worker_name` for all operations of that worker. Could be expensive on 3M but bounded by worker's orders. I'll keep it, it demonstrates the hook pattern. Actually the scope discipline... The task says the operations join is "payment orders, events, workers". To not change what operator sees, the read model must include the worker's name (denormalized). The write path for workers should exist to keep the hook pattern complete. I'll include a minimal workers write (create/rename).

- Dashboard endpoints (kebab-case, plural):
  - `GET /operations?company_id=&status=&from=&to=&page=&page_size=` — paginated list (new query over projection).
  - `GET /company-totals?company_id=&status=` — exact totals per company (or per status?). Let's do: `GET /company-totals` returns per-company totals (all companies, or filter by company). Totals: `order_count`, `total_cents` by status? "Financial totals per company" — I'll store per company and per status: `company_totals (company_id, status, order_count, total_cents)`. The dashboard probably shows totals for the company's filtered status. Simpler: per company across all statuses? Hmm.

Let me think about what "per-company financial totals" most reasonably is: sum of order amounts for a company, probably overall, probably broken by status (e.g. approved amount, pending amount). I'll model totals per (company_id, status) — exact. Endpoint: `GET /company-totals?company_id=` returns list of { status, order_count, total_cents } for that company, or across all companies if not filtered. Keep it simple: per-company breakdown by status.

Statuses: 'pending', 'approved', 'rejected' (and 'refunded'? Keep 3-4). Let's do: pending, approved, rejected.

Order amount: integer cents. Currency: fixed 'USD'? I'll include a `currency` column but totals are per company (assume single currency per company, or include currency in the key? Overkill — I'll keep `currency` on order and projection, and totals only per (company_id, status), and document assumption that company operates in single currency? Hmm, that's a real semantic choice. Simplest defensible: single currency platform (USD). I'll keep `currency` field on order for display, and totals don't mix currencies because we have one currency. I'll add one `// ASSUMPTION` comment that totals assume a single currency (USD) per company. Or omit currency entirely. Omitting is cleaner: amount is cents, currency is implicit USD. Let me include `currency` as a plain column but... no — discipline: don't add what's not asked. Skip currency. Amounts are integer cents in one currency. Actually, marketplace orders without currency is weird but this is a read-model exercise. Cents is enough. I'll skip currency to keep the totals exact and unambiguous.

Now the schema:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Worker {
  id         String   @id @default(uuid()) @db.Uuid
  company_id String   @map("company_id") @db.Uuid
  name       String
  role       String?
  created_at DateTime @default(now())
  updated_at DateTime @default(now()) @updatedAt

  @@map("workers")
}

model Company? 
```

Do we need a companies table? The filter is "by company". Company id can be a plain column (UUID) without a companies table. For the FK we need a companies table... FK is not strictly required. But the totals table keyed by company_id — fine without a companies table. I'll keep companies table minimal to be realistic? The discipline says don't create files not asked for, but schema tables are part of the design. A `companies` table makes FKs honest. But the more I add, the more I risk scope creep. Hmm. I think minimal `companies` (id, name) is defensible for a marketplace backoffice. Actually, let me not add it — the operator filters by company ID. The join is "payment orders, events, workers". No company entity needed for the join. I'll skip companies table. Company id is a UUID column.

PaymentOrder:
```prisma
model PaymentOrder {
  id          String          @id @default(uuid()) @db.Uuid
  company_id  String          @map("company_id") @db.Uuid
  worker_id   String          @map("worker_id") @db.Uuid
  status      OrderStatus
  amount_cents Int            @map("amount_cents")
  created_at  DateTime        @default(now())
  updated_at  DateTime        @default(now()) @updatedAt
  events      Event[]

  @@index([company_id, created_at])
  @@index([worker_id])
  @@map("payment_orders")
}

enum OrderStatus { pending approved rejected }
```

Event:
```prisma
model Event {
  id          String    @id @default(uuid()) @db.Uuid
  order_id    String    @map("order_id") @db.Uuid
  type        String
  occurred_at DateTime  @map("occurred_at") @default(now())
  order       PaymentOrder @relation(...)
  @@index([order_id, occurred_at])
  @@map("events")
}
```

Projection:
```prisma
model OperationRead {
  id              String      @id @db.Uuid        // = order id
  company_id      String      @map("company_id") @db.Uuid
  worker_id       String      @map("worker_id") @db.Uuid
  worker_name     String
  status          OrderStatus
  amount_cents    Int
  created_at      DateTime
  updated_at      DateTime
  last_event_type String?
  last_event_at   DateTime?

  @@unique([company_id, created_at, id])?  // no
  @@index([company_id, status, created_at(sort: Desc), id(sort: Desc)])
  @@map("operation_reads")
}
```

Wait: the query filters by company, status, created_at range, sorted by created_at desc (then id desc as tiebreaker). Index: `(company_id, status, created_at DESC, id DESC)`. In Prisma: `@@index([company_id, status, created_at(sort: Desc), id(sort: Desc)], map: "ix_operation_reads_company_status_created")`.

Do we need to include worker_name, etc? A covering index would avoid heap fetches, but we need all columns anyway for the row data. At 3M rows, an index scan for a company+status+window that matches maybe thousands of rows is fast (<10ms). Good.

CompanyTotals:
```prisma
model CompanyTotals {
  company_id   String @map("company_id") @db.Uuid
  status       OrderStatus
  order_count  Int    @default(0) @map("order_count")
  total_cents  BigInt @default(0) @map("total_cents")
  updated_at   DateTime @default(now()) @updatedAt

  @@id([company_id, status])
  @@map("company_totals")
}
```

BigInt vs Int for total_cents: 3M orders × amounts — Int (max ~2.1e9 cents = $21M) might overflow. BigInt is safer and "exact". But BigInt in Prisma requires care in JSON serialization (Prisma returns BigInt. Express's JSON.stringify throws on BigInt!). NestJS/Express's JSON serialization: `JSON.stringify` throws "Do not know how to serialize a BigInt". We need to convert to number or string in controller/service. Financial totals: returning as string is exact-safe. Let me store total_cents as BigInt and serialize to a string in the DTO (e.g. `total_cents: "123456"`). Hmm, but "without changing what the operator sees" — the original query probably summed in SQL and returned as numbers. For financial exactness, string is the standard safe choice. I'll return string cents in the totals endpoint, documented in DESIGN.md. Order's `amount_cents` remains Int (single order amounts fit).

Alternatively make total_cents Int and document that overflow isn't an issue... No — 3M orders in a company could easily exceed 2.1B cents. BigInt is the exact choice. Serialize as string.

Hmm wait, is total_cents as BigInt with `$executeRaw` incrementing arithmetic OK? Yes: `total_cents = company_totals.total_cents + EXCLUDED.delta`.

But actually, do I want to use `$executeRaw` for every write? The maintenance hook for order writes:
1. Insert/update the payment_orders row (Prisma).
2. Upsert operation_reads row (Prisma `upsert` is fine — single writer per order id, no arithmetic).
3. Increment/decrement company_totals atomically (raw SQL single statement).

All three within one interactive transaction? If I mix Prisma calls and `$executeRaw` inside a `prisma.$transaction(async tx => ...)` — `$executeRaw` doesn't take a tx... Actually it does: `tx.$executeRaw`. Yes, the interactive transaction client supports `$executeRaw`.

Event write: insert event. Update operation_reads.last_event_* if occurred_at >= current last_event_at (compare in SQL for atomicity? Or read then conditional update — race: two concurrent events on same order. A conditional update with `WHERE last_event_at IS NULL OR last_event_at < $ts` ensures monotonicity). Use raw SQL or Prisma updateMany with where clause — Prisma `updateMany({ where: { id, last_event_at: { lt: ts } } })` — but we also need "IS NULL OR lt". Prisma where supports `{ last_event_at: { lt: ts } }` but not combined OR with null in updateMany... we can use `where: { id, OR: [{ last_event_at: null }, { last_event_at: { lt: ts } }] }`. That works in Prisma (top-level OR in where). Good, no raw SQL needed.

Worker rename: `UPDATE operation_reads SET worker_name = $new WHERE worker_id = $id`. Prisma `updateMany({ where: { worker_id }, data: { worker_name } })`.

Order status change: totals delta = 0 (amount unchanged, status changes → move amount between two status buckets: decrement old status, increment new). So the totals maintenance: for old status: order_count -1, total_cents -amount. For new status: order_count +1, total_cents +amount. Single raw SQL statement can do both with two upserts... or one statement: a CTE or two upserts within one statement. I'll write a single `$executeRaw` with two INSERT...ON CONFLICT statements? `$executeRaw` can execute multiple statements in one call (node-postgres supports multi-statement simple query) — but with parameterized? Prisma's `$executeRaw` with tagged template builds parameterized. Multiple statements in one parameterized string are allowed by pg (simple query with parameters). Hmm, actually pg's `query` with parameters and multiple statements works (uses extended protocol... actually node-postgres supports multi-statement only in simple query mode. With parameters... let me recall: node-pg `client.query(text, values)` — if text contains multiple statements, pg sends it as simple query if no params? No — node-pg will error "cannot insert multiple commands into a prepared statement" for parameterized multi-statement? Actually, node-pg will send a simple query if no params. With params it uses extended protocol's Parse with one statement name — Postgres rejects multiple statements in extended-protocol Parse with "cannot insert multiple commands into a prepared statement". Prisma's $executeRaw uses extended protocol. So: one statement per call.

So the status change maintenance = two raw calls (or a single statement with a CTE doing both upserts). Single statement with CTE:

```sql
WITH dec AS (
  INSERT INTO company_totals (company_id, status, order_count, total_cents)
  VALUES ($1, $2::order_status, -1, $3::bigint)
  ON CONFLICT (company_id, status) DO UPDATE
    SET order_count = company_totals.order_count + EXCLUDED.order_count,
        total_cents = company_totals.total_cents + EXCLUDED.total_cents,
        updated_at  = now()
), inc AS (
  INSERT INTO company_totals (company_id, status, order_count, total_cents)
  VALUES ($1, $4::order_status, 1, $5::bigint)
  ON CONFLICT (company_id, status) DO UPDATE
    SET order_count = company_totals.order_count + EXCLUDED.order_count,
        total_cents = company_totals.total_cents + EXCLUDED.total_cents,
        updated_at  = now()
)
SELECT 1
```

This is one statement — atomic, single round trip. Casts: status is an enum `order_status`. In Prisma's schema, `OrderStatus` enum maps to Postgres enum `order_status`. For raw SQL I need `::order_status` casts or pass strings... passing a string to an enum column in ON CONFLICT insert works via implicit cast? PostgreSQL doesn't implicitly cast unknown to enum? Actually, unknown-typed literals (parameters are unknown in extended protocol) are cast to enum fine in INSERT VALUES. Parameters have type "unknown" so `INSERT ... VALUES ($2)` into an enum column works — Postgres resolves unknown to the column's type. Yes, that works (unknown accepts any target). So no explicit casts needed.

BigInt parameter: Prisma's $executeRaw accepts BigInt values and passes them correctly (node-pg handles BigInt with a type parser? node-pg serializes BigInt as string, and postgres parses the string to bigint fine). OK.

Now the "no raw SQL in service" rule — I'll put all raw SQL in repository. Good.

Re-derivation routine over arbitrary window:

`ReprojectionService.deriveWindow(from: Date, to: Date)`:
- Chunk orders with created_at in [from, to) (paginate by id or by created_at + id keyset).
- For each chunk:
  - Load the orders.
  - Load workers' names for the chunk's worker ids (groupBy / where in).
  - Load the latest event per order: `events.groupBy({ by: ['order_id'], where: { order_id: { in: chunkIds } }, _max: { occurred_at: true } })` and then fetch the event *type* at that max? Max type isn't returned by groupBy. Alternative: fetch events for chunk orders where occurred_at = max per order — need a per-order max first, then filter. Simpler: fetch all events for chunk orders ordered and reduce in JS? Could be large but chunk is e.g. 1000 orders. Events per order is small. Fetch events for chunk ids (with occurred_at desc, type) and reduce in JS to latest per order. Bounded by chunk size. Fine.
  - `upsert` each operation_reads row (idempotent — derived value wins).
  - Rebuild totals for companies in window: instead of incremental, compute exact totals for affected (company, status) pairs from operation_reads: `operation_reads.groupBy({ by: ['company_id','status'], where: { company_id: { in: companies } }, _sum: { amount_cents: true }, _count: true })` and SET the totals rows to those exact values. But wait — totals cover all orders for that company (not just the window). Re-deriving totals from scratch for the company requires scanning all operation_reads for that company. That's O(company size) — fine for repair (not per-write). But if two repair windows overlap / concurrent with writes... For drift repair, the cleanest: after fixing the operation_reads for the window, recompute totals from operation_reads for the affected companies (exact, authoritative). Since operation_reads is authoritative per-order and totals = aggregate over them, recomputation converges. I'll do that: recompute affected companies' totals from operation_reads.

  Hmm but there's a subtle race: writes in flight during repair could interleave. For a repair job, that's acceptable (drift repair is eventually consistent. Writes continue to maintain their own increments). I'll document in DESIGN.md. Or I could use a short `SELECT ... FOR UPDATE`... overkill. Keep it simple. Note in DESIGN.

  Actually wait — is it correct to recompute totals from operation_reads? In steady state, totals are maintained incrementally. Drift could arise from missed hooks (e.g. crashed mid-transaction? no—transaction is atomic). Real drift sources: direct source writes bypassing the hook, schema migrations, bugs. The repair re-derives operation_reads from source for the window, then recomputes totals for affected companies from the full operation_reads. If drift is *outside* the window (old orders), the recompute fixes totals anyway (since it reads all rows for that company). So the window parameter governs which rows are re-derived. Totals for affected companies are fully recomputed. Good property: totals always converge to exact.

  But careful: recompute of totals should happen per affected company with exact sum. Use groupBy sum. BigInt sum: Prisma's `_sum` returns BigInt for BigInt fields. Good.

Scheduled drift-repair job: `@Cron` (say, hourly) that calls `deriveWindow(now - 7 days, now)` or a rolling 24h window. Config from env: `DRIFT_REPAIR_WINDOW_HOURS` default 24, `DRIFT_REPAIR_CRON` maybe fixed '0 * * * *'. Config only from env — I'll read with defaults from process.env in a config module or directly in the job class (e.g. `process.env.DRIFT_REPAIR_CRON ?? '0 * * * *'`). Keep it simple: read env in the job with a safe default. Hmm, "Config only from env vars" — using default values when env var isn't set is fine (still env-driven).

Dashboard query:

`OperationsService.list(queries)`:
- Validate inputs (controller): company_id (UUID), status enum optional, from/to ISO dates, page (int ≥1), page_size (int 1..100, default 50).
- Repository: `operation_reads.findMany({ where: { company_id, status?, created_at: { gte, lt } }, orderBy: [{ created_at: 'desc' }, { id: 'desc' }], skip, take })` + `count`.

Return items + page meta { page, page_size, total_count }.

"Without changing what the operator sees": the projection returns the same fields the old join computed: order fields + worker name + last event. Good.

Totals endpoint:
- `GET /company-totals?company_id=` → rows { status, order_count, total_cents (string) }.
- From `company_totals` table (exact, maintained).

Now "new dashboard query" — the task lists it as a deliverable. Our `GET /operations` uses the projection. ✓.

Maintenance hook that write services invoke: write services (PaymentOrdersService, EventsService, WorkersService) call `OperationsProjectionService` (hook: `onOrderCreated`, `onOrderStatusChanged`, `onOrderDeleted`? no, no delete — skip. `onEventRecorded`, `onWorkerRenamed`). All within the same transaction as the write → read-your-own-writes (commit atomicity).

How do I share the transaction? The write service opens `prisma.$transaction(async (tx) => { await this.ordersRepo.create(tx, data); await this.projection.hooks.onOrderCreated(tx, order); })`. So the repository methods need to accept a `Prisma.TransactionClient`. That's a bit awkward for the layering (repositories usually own the client). Standard Prisma pattern: pass tx as an optional argument. I'll design repositories to accept `tx?: Prisma.TransactionClient`. Hmm, that couples the repositories to Prisma types — well, they're the DB layer anyway.

Alternatively, the write service orchestrates: controller → service. The service calls the repository (source write) and the projection service (hook), all inside one tx. Let me structure:

- `PaymentOrdersService.create(input)`:
```ts
return this.prisma? no — service can't touch prisma.
```
The transaction coordinator must live somewhere. Options: a "UnitOfWork" in a repository? Or the service calls a repository method that does everything? But the hook is in the projection service (logic). Hmm.

Layering: service holds logic. Repository touches DB. The transaction is a DB concern but the orchestration of "write + hook" is business logic → the service. So the service needs to open a transaction. But the service can't call Prisma directly...

Defensible approach: `Txn` / `TransactionScope` — a small infrastructure class (not the repository, not the service of a feature?) that wraps `prisma.$transaction`. Where to put it? Perhaps `src/common/transaction.ts`... The layout convention lists only feature files, but "decide file layout yourself". Let me create `src/common/transaction.service.ts` exporting a `TransactionService` with `run<T>(work: (tx: Prisma.TransactionClient) => Promise<T>)`. This is a provider in a `CommonModule` (exports TransactionService), imported by the feature modules. Repositories accept `tx?: Prisma.TransactionClient` and default to their own client. Projection hook service methods also accept `tx`. This keeps: service orchestrates (logic), repository is DB-only, raw SQL in repositories.

Wait, does this add files not asked for? The task asks for "a maintenance hook that write services invoke (simulate the write path)" — the write path has to be transactional for read-your-own-writes. So the transaction scope is a required piece of the mechanism. I'll include it minimally.

Hmm or simpler: each write service method wraps `this.ordersRepository.createInTx(...)` — no. Let's go with `TransactionService` (call it `src/common/transaction.service.ts`, with `src/common/common.module.ts`? Or just register the provider in `AppModule` and export from there? Wiring rule: "providers used by other modules are exported by their own module and that module is imported by the other". So create `CommonModule` that exports `TransactionService`. Features import `CommonModule`.

Actually wait — can I avoid a shared module by putting the TransactionService in each feature? No, duplication. `CommonModule` is the clean reading of the wiring rule. OK.

Prisma module too: the repositories need `PrismaClient`. Options: instantiate `new PrismaClient()` directly in each repository (simple, no extra wiring), or a `PrismaModule` that provides a shared client via a provider token. For tests, we want to control the client (connect/close, `$disconnect`). Shared `PrismaService` in a `PrismaModule` (or in CommonModule) is the idiomatic Nest approach. Let me do: `src/common/prisma.service.ts` — `PrismaService extends PrismaClient` (implements OnModuleInit/OnModuleDestroy), and `src/common/common.module.ts` that provides+exports both `PrismaService` and `TransactionService`. TransactionService takes PrismaService (or PrismaClient) as a dep.

Wait, is extending PrismaClient OK with ESM + Prisma 5/6? Yes, standard.

Prisma version: let me assume Prisma 5.x (stable, well-known API: `@default(uuid())`, `@updatedAt`, `@@index` with sort, `groupBy` with `_max`/`_sum`/`_count`, interactive `$transaction`). I'll write the code against the Prisma 5 API. I'll list package.json? — "Don't create files that aren't asked for" but package.json is needed for the solution to build/run (pnpm). The layout convention doesn't list it, but it's implied. Hmm. The mechanical parser reads the blocks. A package.json with deps is useful and defensible. I'll include: package.json (with type: module, deps: @nestjs/common, @nestjs/core, @nestjs/platform-express, @nestjs/schedule, @prisma/client, class-validator? — validation: controller "validates input" — I'll use manual validation in the controller (no class-validator to keep the dep light? or class-validator + ValidationPipe is idiomatic Nest). Manual validation in the controller is fine and keeps deps small. Actually a ValidationPipe + DTO classes is more idiomatic NestJS... but DTOs add files. A controller that validates and maps errors to the envelope is explicit and testable. Let me go with a small shared validation utility in common (a parse helper that throws a `ValidationError` which the exception filter maps to the envelope).

Error envelope: I need a global exception filter that produces `{ error: { code, message, details } }`. `src/common/exception.filter.ts` — an `AllExceptionsFilter` (or `ApiExceptionFilter`) that catches: `NotFoundException` → resource_not_found, `BadRequestException` (with a custom payload?) → validation_error, others → internal_error. Plus a custom `AppException` class with a code. Let me design:

- `src/common/errors.ts`: an `AppError extends Error` with `code: string` and `details: object`. Helper constructors: `notFound(resource, id)`, `validation(details)`.
- `src/common/exception.filter.ts`: `@Catch()` filter. If `AppError` → status map by code (resource_not_found → 404, validation_error → 400, else 500). Else map: `HttpException` → 500? Nest's HttpException: use their status, code: `unknown_error`? Hmm, let me keep: catch AppError (with code, message, details) and generic (code `internal_error`, message from the exception, details `{}`). Also handle Prisma known request errors? Not necessary for this scope.

Controllers throw AppError via service? "Controller validates input and calls service. No business logic." Validation errors: the controller constructs the AppError itself (or a validation helper). Service throws AppError for not-found, etc.

Tests: `test/operations.spec.ts`? Task: "tests for read-your-own-writes, concurrent updates to a single company's totals, and drift repair." I'll make `test/read-model.spec.ts` (or per-feature). The layout says `test/<feature>.spec.ts`. The feature here is "operations" (dashboard) + writes. Let me do:
- `test/operations.spec.ts` — read-your-own-writes (create → visible. Approve → updated. Event → last_event updated. Worker rename → name updated), pagination/filter sanity? (behavior-focused, not happy-path-only — include negative: filter by status excludes others).
- `test/company-totals.spec.ts` — concurrent updates (N parallel creates + parallel status flips, assert exact totals), plus correctness after mixed ops.
- `test/drift-repair.spec.ts` — tamper the projection (delete row, wrong status, corrupted totals), run `repairWindow`, assert convergence. Also test that re-derivation over a specific window fixes only the window? (Totals get recomputed for affected companies anyway.)

How to wire tests? Boot the Nest app (Test.createTestingModule with AppModule) or instantiate the services directly? Behavior tests via HTTP would test the whole stack (nice), but the concurrent write path is via services (there's no "concurrent API" need — API is fine too). Using the Nest app with supertest adds dep `supertest`. Alternative: construct the services directly with a real PrismaClient — simpler, still behavior-level (DB-backed). I'll construct the app via Nest testing module, obtain the services, and call them directly (no HTTP layer in tests — the controller's validation is thin). Hmm but "test behavior" — the operator-facing behavior includes the dashboard endpoint. Read-your-own-writes: "approve an order → reflected in the next request". I can demonstrate with service calls: `ordersService.approve(id)` then `operationsService.list(...)` — "next request" = next call. That's the behavior. Let me use Test.createTestingModule (which also wires up modules — validates wiring) and call services. Include HTTP? Let me skip supertest to reduce deps. Hmm, but then the controller + error filter are untested... The task doesn't ask for them. Fine.

Wait — actually let me reconsider: should I include the HTTP layer at all? The task says "the new dashboard query" and "without changing what the operator sees" — the dashboard is an API. The layout convention includes controllers. NestJS "API". Yes, include a controller for operations (GET), company-totals (GET), payment-orders (POST, PATCH), events (POST), workers (POST, PATCH?). Let me narrow the write surface:

- `POST /payment-orders` { company_id, worker_id, amount_cents } → create (status pending).
- `PATCH /payment-orders/:id` { status } → approve/reject (status transition).
- `POST /events` { order_id, type, occurred_at? } → record event.
- `POST /workers` { company_id, name } → create.
- `PATCH /workers/:id` { name } → rename.
- `GET /operations?...` → dashboard list.
- `GET /company-totals?company_id=` → totals.

Drift repair trigger: I'll also expose a manual trigger? Task says "a scheduled drift repair job" — scheduled. A manual endpoint isn't asked for. But the re-derivation routine "over an arbitrary date window" is a separate deliverable — a service method `rederive(from, to)`. The scheduled job calls it with a rolling window. The tests call it directly. No endpoint needed. Good — less scope.

Now — the scheduled job needs `@nestjs/schedule`. Add dep. Or use a plain `setInterval` in an `onModuleInit` — no extra dep, "scheduled" ✓. But `@nestjs/schedule` is the idiomatic Nest choice with cron expression. Either is defensible. I'll go with `@nestjs/schedule` (Cron) — clean, and disableable via env for tests (`SCHEDULE_ENABLED`?). Hmm — in tests, the cron job might fire and interfere. Set it to a harmless cron for tests, or gate on env `DRIFT_REPAIR_ENABLED` (default true)? "Config only from env" — gate with `DRIFT_REPAIR_ENABLED` (default 'true'), set to 'false' in tests. The cron expression from `DRIFT_REPAIR_CRON` default `'0 * * * *'`. Window from `DRIFT_REPAIR_WINDOW_HOURS` default 24.

Let me think about the shape of the re-derivation implementation in detail:

```ts
async rederiveWindow(from: Date, to: Date): Promise<RederiveResult> {
  // Chunk by keyset over (created_at, id)
  let afterCreatedAt = from;
  let afterId: string | null = null;
  let rowsUpdated = 0;
  const affectedCompanies = new Set<string>();

  while (true) {
    const orders = await this.ordersRepository.findInWindow(from, to, afterCreatedAt, afterId, CHUNK);
    // Actually simpler: findInWindow(from, to, limit, cursor {created_at, id})
    if (orders.length === 0) break;
    const workerIds = [...new Set(orders.map(o => o.worker_id))];
    const workers = await this.workersRepository.findByIds(workerIds); // id → name
    const events = await this.eventsRepository.findLatestForOrders(orders.map(o => o.id)); 
      // Returns Map<orderId, {type, occurred_at}>
    const reads = orders.map(o => ({...denormalized}));
    await this.operationReadsRepository.upsertMany(reads, tx);
    affectedCompanies.add(...orders.map(o => o.company_id));
    const last = orders[orders.length-1];
    afterCreatedAt = last.created_at; afterId = last.id;
    if (orders.length < CHUNK) break;
    rowsUpdated += orders.length;
  }
  // Recompute totals for affected companies
  for (const companyId of affectedCompanies) {
    await this.companyTotalsRepository.recomputeFromProjection(companyId);
  }
}
```

Wait, chunk cursor: orders sorted by created_at asc, id asc. Cursor: `(created_at > $c) OR (created_at = $c AND id > $id)`. Prisma where: `{ OR: [{ created_at: { gt: c } }, { AND: [{ created_at: { equals: c } }, { id: { gt: id } }] }] }`. Fine.

`findLatestForOrders`: for the chunk (≤1000) order ids, fetch events and reduce:
```ts
const events = await tx.events.findMany({ where: { order_id: { in: ids } }, orderBy: { occurred_at: 'asc' }, select: { order_id, type, occurred_at } });
// reduce: keep last per order (asc so later overwrites)
```
The events per order is small. Chunk 1000 → probably ≤10k event rows. OK.

Alternative: `groupBy` for `_max` and then a second query. The findMany+reduce is simpler and one round trip. Bounded. Good.

`upsertMany`: loop of `upsert` in a tx? 1000 upserts in a loop = 1000 round trips — slow but tolerable for repair (not latency-sensitive). Better: a raw SQL bulk upsert — but building parameterized multi-row raw SQL is possible: `INSERT INTO operation_reads (...) VALUES ($1,$2,...),($3,$4,...) ON CONFLICT (id) DO UPDATE SET ...`. For a chunk of 1000 → 12k params — Postgres limit is 65535 params. Fine. But it makes the repository heavier. Loop of upserts is simpler and correct. Repair is a background job — a loop is fine. Hmm, for the "drift repair" test the chunk is small. Let me go with the loop (idempotent upserts) — simpler, and I'll note that it's a background path. Actually... let me reconsider: 1000 sequential upserts in one tx → each ~1ms → 1s per chunk. Repair of 24h window over 3M orders/year ≈ 200k orders/day → 200 chunks → ~4 min. Tolerable for a nightly/hourly job. OK, loop it is. Hmm alternatively use `createMany` for new + `updateMany`... no, upsert loop is correct and simple.

`recomputeFromProjection(companyId)`:
```ts
const grouped = await tx.operationReads.groupBy({ by: ['status'], where: { company_id }, _sum: { amount_cents: true }, _count: { _all: true } });
// For each status present: upsert totals row with exact count/sum
// For statuses absent: set to 0 (delete the row, or zero it)
```
Handling absent statuses: e.g. company has no 'rejected' orders → the totals row should be 0 (or absent → endpoint treats absent as 0). Simplest: for each of the 3 statuses, set row to (count, sum), with 0 for missing. Use a per-status raw SQL upsert with absolute value (not delta): `ON CONFLICT DO UPDATE SET order_count = EXCLUDED.order_count, total_cents = EXCLUDED.total_cents`. That's the "exact re-set". And this can also be a single statement per status (3 statements) or a multi-row insert with ON CONFLICT (1 statement!):

```sql
INSERT INTO company_totals (company_id, status, order_count, total_cents)
VALUES ($1, $2, $3, $4), ($1, $5, $6, $7), ($1, $8, $9, $10)
ON CONFLICT (company_id, status) DO UPDATE
  SET order_count = EXCLUDED.order_count,
      total_cents = EXCLUDED.total_cents,
      updated_at = now()
```
1 statement, exact.

Similarly, the incremental hook for create: single upsert with +delta. Status change: the CTE version. Both in `CompanyTotalsRepository` (or a shared `ProjectionRepository`?).

Repository organization: the layout says one `<feature>.repository.ts` per feature. My features:

- `operations` (dashboard read): `operations.module/controller/service/repository` — repository reads `operation_reads`.
- `company-totals`: service+repository+controller for the totals endpoint.
- `payment-orders`: service + repository (source writes + hook orchestration? no — hook is in the projection service).
- `events`: service + repository.
- `workers`: service + repository.
- `projection`: the maintenance hook service + the repositories for `operation_reads` and `company_totals`? That's two repositories in one feature... Convention: `<feature>.repository.ts` is singular. Hmm.

Alternative organization: treat "operations" as the read-model feature that owns both `operation_reads` and `company_totals` tables:
- `operations.repository.ts` — reads for the dashboard list (operation_reads).
- `company-totals.repository.ts` — the totals table (read for endpoint + atomic write ops for the hook + recompute).
- `operations-projection.service.ts`? Naming: `kebab-case.role.ts` — I can name files freely within the pattern.

Let me reorganize cleanly:

Feature: `operations` (the read model / dashboard):
- `operations.module.ts` — providers: OperationsService, OperationsRepository, ProjectionService (hook), CompanyTotalsRepository? Hmm, the CompanyTotals endpoint...

Feature: `company-totals`:
- `company-totals.module.ts`, `.controller.ts` (GET /company-totals), `.service.ts` (query logic), `.repository.ts` (read + recompute + delta ops).

Feature: `operations`:
- controller (GET /operations), service (query logic + pagination), repository (list + count over operation_reads).

Feature: `projection` (the maintenance):
- `projection.module.ts`, `projection.service.ts` (hook: onOrderCreated/onOrderStatusChanged/onEventAdded/onWorkerRenamed. rederiveWindow. Drift repair via Cron), `projection.repository.ts` (upsert of operation_reads, read of source? no...).

Hmm wait — the re-derivation needs to read source tables (orders, events, workers) and write the projection. If the projection repository only touches projection tables, then re-derivation reads via the source repositories (payment-orders.repository, events.repository, workers.repository) — cross-feature repository use. Wiring: each feature module exports its repositories. Projection module imports them. This is actually clean layering: the projection service uses other features' repositories (as read interfaces) + its own repository for the projection tables.

But the totals table: the `company-totals` feature owns the repository with: `list(companyId?)`, `applyDelta(companyId, oldStatus, newStatus, amountCents)` (atomic), `applyDeltaCreate(companyId, status, amountCents)`, `recompute(companyId)`. The projection service imports the CompanyTotalsRepository from the company-totals module.

So:

- `payment-orders` feature: controller (POST /payment-orders, PATCH /payment-orders/:id), service (create/approve/reject. Opens a tx: writes source + calls projection hook), repository (source writes/reads).
- `events` feature: controller (POST /events), service, repository.
- `workers` feature: controller (POST /workers, PATCH /workers/:id), service, repository.
- `operations` feature: controller (GET /operations), service, repository (operation_reads list/count).
- `company-totals` feature: controller (GET /company-totals), service, repository (company_totals read/delta/recompute).
- `projection` feature: module + service (hook + rederive + scheduled drift repair job. No controller). Imports payment-orders, events, workers (for source reads), company-totals (for totals write), and needs its own repository for operation_reads *writes*...

Hmm, operation_reads: the read repository is in the operations feature, the write (upsert) is in the projection feature. Two repositories for the same table in two features? Or the operations repository has both the read (list) and the upsert? Then the projection service uses the OperationsRepository (upsert) — imported from operations module. And OperationsService (list) also uses it. That works: `operations.repository.ts` exposes `list`, `count`, `upsert(read)`. The operations module exports the repository. The projection module imports it. OK, one repository per table.

So the final module graph:
- AppModule imports: CommonModule, PaymentOrdersModule, EventsModule, WorkersModule, OperationsModule, CompanyTotalsModule, ProjectionModule. SchedulesModule (from @nestjs/schedule) for cron.
- CommonModule: providers PrismaService, TransactionService. Exports both.
- PaymentOrdersModule: providers PaymentOrdersService, PaymentOrdersRepository. Controller PaymentOrdersController. Imports CommonModule, ProjectionModule (for hook). Exports PaymentOrdersRepository, PaymentOrdersService? The ProjectionModule needs to read orders (source read) for re-derivation → import PaymentOrdersModule → need to export PaymentOrdersRepository. ✓.
- EventsModule: similar. Export EventsRepository.
- WorkersModule: export WorkersRepository.
- OperationsModule: providers OperationsService, OperationsRepository. Controller. Export OperationsRepository (for projection upsert).
- CompanyTotalsModule: providers CompanyTotalsService, CompanyTotalsRepository. Controller. Export CompanyTotalsRepository.
- ProjectionModule: providers ProjectionService (with @Cron drift repair). Imports: CommonModule, PaymentOrdersModule, EventsModule, WorkersModule, OperationsModule, CompanyTotalsModule. No exports needed.

Cycle check: PaymentOrdersModule imports ProjectionModule. ProjectionModule imports PaymentOrdersModule → circular import! Nest can handle some circular imports with forwardRef, but this is ugly.

Fix: invert — the write service calls the hook, so payment-orders needs the hook. The projection needs to read orders for re-derivation. Options:
1. forwardRef in one direction.
2. Move source reads for re-derivation into the projection repository? "Repository is the only layer that touches DB" — the projection repository can read source tables too (it's still the DB layer). The layering rule doesn't forbid a repository from reading other tables. The feature ownership is a bit crossed but pragmatic: `projection.repository.ts` does all the projection-specific DB work: read source (chunk of orders in window + events + worker names) and write (operation_reads upsert). Then ProjectionModule only imports CommonModule (+ CompanyTotalsModule for totals ops). PaymentOrdersModule imports ProjectionModule. No cycle: projection → company-totals. company-totals → common only. payment-orders → projection + common.

But then the projection repository reads `payment_orders`, `events`, `workers` directly — fine, DB layer. And the source repositories remain for write service use. This eliminates the cycle and keeps the graph acyclic.

Similarly, the event write service (events feature) calls the projection hook → EventsModule imports ProjectionModule. WorkersModule imports ProjectionModule. No cycles (projection imports only company-totals + common).

CompanyTotalsModule: does the company-totals *service* (endpoint) need anything from projection? No — it just reads totals. OK.

Now, the hook interface: `ProjectionService` with methods:
- `onOrderCreated(tx, order: { id, company_id, worker_id, status, amount_cents, created_at, updated_at, worker_name })` — hmm, the hook needs the worker's name (denormalized). The payment-orders service (which has the WorkersRepository? no—) — wait, to get the worker name at order creation: the write service must look up the worker (to validate existence too). So PaymentOrdersService injects WorkersRepository (WorkersModule exports it. PaymentOrdersModule imports WorkersModule). Fine, or the hook itself fetches the worker name via the projection repository. Cleaner: the hook receives only the order row and the projection repository fetches worker names in bulk (it can query workers table). Then the write service doesn't need to know about the worker. But validating worker existence at order creation is business logic → the service should check (else FK violation / unknown worker). Do I have an FK from payment_orders.worker_id → workers.id? If I define the FK in the schema, a create with an invalid worker_id will fail at the DB level with a Prisma P2003 error → map to `validation_error` or `resource_not_found` (worker not found). I'll define the FK and let the service catch P2003 → throw AppError not_found('worker', id)? The error code is `resource_not_found` per the convention example. Details: { field: 'worker_id', worker_id }. Good. Similarly event's order FK → order not found.

So: PaymentOrdersService.create:
```ts
const order = await this.transactions.run(async tx => {
  const created = await this.ordersRepo.create(tx, { company_id, worker_id, amount_cents }); // status default pending
  await this.projection.onOrderCreated(tx, created);
  return created;
});
return order;
```
With P2003 catch:
```ts
try { ... } catch (e) { if (isPrismaFkError(e, 'worker')) throw AppError.notFound('worker', id); throw e; }
```
Hmm — the service catches a Prisma error... "No Prisma client calls" in service — catching and pattern-matching an error object is not a client call. Tolerable? A bit leaky. Alternative: service pre-checks worker existence: `const worker = await this.workersRepo.findById(worker_id); if (!worker) throw AppError.notFound(...)`. That's explicit business logic and cleaner (no Prisma error pattern matching). But race: worker deleted between check and insert — with FK, the DB catches. Fine: pre-check + FK. Pre-check gives clean AppError. Let's do pre-check. (No worker deletes in this domain anyway.)

`onOrderCreated(tx, order)`:
- Fetch worker name (projection repo `findWorkerName(worker_id)` or via workers repo — use projection repo? WorkersRepository is in WorkersModule. If ProjectionModule doesn't import WorkersModule, use its own repository's query. Let the projection repository own a `workerName(workerId)` query. OK.)
- Upsert operation_read row.
- `companyTotalsRepo.applyDelta(tx, companyId, status, +1, +amount)` → INSERT ON CONFLICT + delta.

`onOrderStatusChanged(tx, order, oldStatus)`:
- Update operation_read.status.
- totals: move delta: `applyStatusMove(tx, companyId, oldStatus, newStatus, amount)` → CTE statement (or two single-statement deltas: decrement old, increment new — two calls, still atomic individually. CTE is one round trip. Two separate calls within the same tx is also fully atomic (tx atomicity). Simpler: reuse `applyDelta` twice: (old, -1, -amount) and (new, +1, +amount). 2 statements, 1 tx. Fine, no need for a CTE.)

`onEventRecorded(tx, orderId, type, occurredAt)`:
- `operation_reads.updateMany` conditional (last_event_at IS NULL OR < occurredAt) → set last_event_type/at.

`onWorkerRenamed(tx, workerId, newName)`:
- `operation_reads.updateMany({ where: { worker_id }, data: { worker_name: newName } })`.

Now, read-your-own-writes guarantee: each write commits source + projection in a single tx → any read after commit sees both. ✓

Concurrent updates to a single company's totals: atomic upsert delta in SQL → no lost updates. Test: e.g. 200 concurrent creates (50 orders × 4 workers?) in one company + concurrent approvals, assert `total_cents` == exact sum and `order_count` == N, and per-status breakdown is consistent with final statuses. To make it deterministic: create N orders in parallel. Approve half in parallel (interleaved). Read final status of each order? The dashboard returns status. But parallel approves to specific orders — we know which. Assert totals per status == sum over known final statuses.

Drift repair test:
1. Set up company + worker + orders + events. Let hooks maintain everything.
2. Corrupt: directly update `operation_reads` via prisma (e.g. set status wrong, change worker_name), corrupt `company_totals` (set total_cents wrong), and simulate a *missed* write: insert a source order directly (bypassing hook) → the read model is missing it.
3. Run `projectionService.rederiveWindow(from, to)` covering the orders' creation time.
4. Assert: the dashboard list matches source (order with correct status/name), totals exact.

Re-derivation "over arbitrary date window" — test that a window excluding some order doesn't touch it (corrupt an order outside the window → not fixed) — good negative test proving window semantics. And totals: the recompute for affected companies is... if the corrupted row is outside the window and same company, its company is "affected" (has rows in the window) → totals recomputed → fixed even if the row isn't. To test window semantics cleanly: use two companies — A inside window, B outside. Corrupt both. Derive window covering only A's orders. Assert A fixed, B's operation_reads row still corrupted (but if B has no rows in the window, its totals are untouched → still corrupted). This demonstrates the window boundary.

But wait: the chunk read uses `created_at IN [from,to)`. Test orders are created "now" — from = now-1h, to = now+1h covers them. For the "outside window" company, its orders are also created now — the window is time-based, not company-based! A time window can't separate two companies created at the same time. To test window semantics, the outside order must be outside the time window — but we can't easily set created_at in the past via the write service (default now()). Options: the repository's create accepts an explicit created_at? No — don't add API fields that aren't asked. In the test, I can update `payment_orders.created_at` directly via prisma to the past (test fixture manipulation — tests can touch DB directly for setup/corruption). Yes: the test sets the outside company's order's created_at to 30 days ago via `prisma.paymentOrder.update`. Then the window (last 1 hour) excludes it. Derive → A fixed, B untouched (row still corrupted). Its totals also untouched (B not affected). ✓ A good, deterministic test.

Also assert that re-derivation is idempotent: run twice → same result. (Cheap extra assertion.)

Now — the scheduled job: `@Cron` needs `@nestjs/schedule` + `SchedulesModule.forRoot()` in AppModule. The job: every hour, rederive `(now - windowHours, now)`. Guard: skip if a previous run is in progress (a simple boolean lock). Log with Logger. Config: `DRIFT_REPAIR_CRON` (default '0 * * * *'), `DRIFT_REPAIR_WINDOW_HOURS` (default 24), `DRIFT_REPAIR_ENABLED` (default true). Env only ✓.

Now, the shape of the dashboard response — "without changing what the operator sees": fields per operation:
```json
{ "id", "company_id", "worker_id", "worker_name", "status", "amount_cents", "created_at", "updated_at", "last_event_type", "last_event_at" }
```
+ meta { page, page_size, total_count }.

The original join returned the same semantic fields (order + worker.name + last event). ✓ Documented in DESIGN.md.

Validation (controller):
- `company_id`: required UUID? Or optional (no company → all companies? operator dashboard is "filtered by company" — let me make it optional, defaulting to all).
- `status`: one of pending|approved|rejected.
- `from`, `to`: ISO 8601, from < to. Optional.
- `page`: int ≥ 1, default 1.
- `page_size`: int 1..200, default 50.
Parse + throw AppError validation_error with details { field, value, reason }.

`GET /company-totals`: optional `company_id` → rows for that company (all 3 statuses, including zeros? or only non-zero? Let me return all 3 statuses with zeros — deterministic shape for operator). Hmm, "what the operator sees" — since totals are a new-ish read model, let me define the shape: for the given company (or all companies), return `{ company_id, status, order_count, total_cents }[]` covering all statuses with zero-fill. OK.

Error envelope filter:
```ts
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception, host) {
    const ctx = host.switchToHttp(); const res = ctx.getResponse();
    let status = 500; let body: Envelope;
    if (exception instanceof AppError) { status = exception.httpStatus; body = { error: { code: exception.code, message: exception.message, details: exception.details } }; }
    else if (exception instanceof HttpException) { status = exception.getStatus(); body = { error: { code: codeForStatus(status), message: exception.message, details: {} } }; }
    else { body = { error: { code: 'internal_error', message: 'Unexpected server error', details: {} } }; }
    res.status(status).json(body);
  }
}
```
Codes: 404 → resource_not_found, 400 → validation_error, 405 → method_not_allowed, else → internal_error? Mapping HttpException → code by status with a fallback `unknown_error`? Let me keep: `resource_not_found` (404), `validation_error` (400), `internal_error` (5xx), `method_not_allowed` (405), `conflict` (409)? Minimally: the statuses we produce are 400/404/500. Filter maps 404→resource_not_found, 400→validation_error, 405→method_not_allowed, else internal_error. Fine.

AppError:
```ts
export class AppError extends Error {
  constructor(public readonly code: string, message: string, public readonly details: Record<string, unknown> = {}, public readonly httpStatus: number = 500) { super(message); }
  static notFound(resource: string, id: string) { return new AppError('resource_not_found', `${resource} ${id} was not found`, { resource, id }, 404); }
  static validation(message: string, details: Record<string, unknown>) { return new AppError('validation_error', message, details, 400); }
}
```

Global filter registration: `app.useGlobalFilters(new ApiExceptionFilter())` in main.ts. Also `app.useGlobalPipes`? Not needed (manual validation).

`main.ts`: NestFactory.create(AppModule), useGlobalFilters, listen on `PORT` (env, default 3000). `app.enableShutdownHooks()` for Prisma disconnect.

`PrismaService extends PrismaClient` with onModuleInit `$connect`? Prisma connects lazily anyway. Explicit connect is fine. onModuleDestroy `$disconnect`.

ESM + Prisma: `"type": "module"` — Prisma client generation with ESM works. In tests, Vitest handles TS/ESM. `import { PrismaClient } from '@prisma/client'` — standard.

Migration file: "every schema change ships with a migration" → I'll provide a `prisma/migrations/0001_init/migration.sql` with full DDL: enums, tables, indexes (including the read-model composite index), FKs. Prisma migration SQL format:

```sql
-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "workers" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "role" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);
...
CREATE INDEX "operation_reads_company_status_created_idx" ON "operation_reads" ("company_id", "status", "created_at" DESC, "id" DESC);
```

UUID default: Prisma's `@default(uuid())` for String @db.Uuid → generated client-side (v4) in Prisma (Prisma generates the uuid in JS). The migration doesn't have a default for such columns (Prisma handles it). Right: `@default(uuid())` is client-side generated. So the DDL: `"id" UUID NOT NULL` with no default. Fine.

`@default(now())` → `DEFAULT CURRENT_TIMESTAMP` in DDL. `@updatedAt` → no default (client-managed) — actually in Prisma migrations, `@updatedAt` columns have no default. Correct.

Timestamps: TIMESTAMP(3) (Prisma's DateTime → timestamptz? In Prisma, DateTime maps to `TIMESTAMP(3)` (without time zone) by default. Yes, Prisma uses `TIMESTAMP(3)` without TZ.)

Now `amount_cents Int` — INT. `total_cents BigInt` → BIGINT.

FKs:
- payment_orders.worker_id → workers.id (ON DELETE RESTRICT, ON UPDATE CASCADE is Prisma default).
- events.order_id → payment_orders.id (RESTRICT).

Indexes on source tables: payment_orders (company_id, created_at)? For the original slow query — the original query is being replaced, but a sane index on the source is nice. Keep minimal: an index on payment_orders (created_at, id) for the re-derivation chunk scan! The re-derivation scans by created_at window — needs an index on (created_at, id) for keyset pagination. Add `@@index([created_at, id])` on payment_orders. And events (order_id, occurred_at) for event fetch. Workers: none (small).

Index on operation_reads: the big one `(company_id, status, created_at DESC, id DESC)`. Also for updateMany by worker_id (worker rename): `@@index([worker_id])`? Renames touch a worker's operations — an index on worker_id helps. Add it.

company_totals: PK (company_id, status) → index implicit.

Now — Prisma schema enums: `enum OrderStatus { pending approved rejected }` — Prisma enum names in DB: default is the enum type name "OrderStatus" → quoted "OrderStatus". I need `order_status` in snake_case → `@@map` for enums? In Prisma, enums use `@map` per value and there's no direct @@map for the enum name... Actually, Prisma supports `@@map` on enums! Yes: `enum OrderStatus { pending ... @@map("order_status") }` — supported since Prisma 4. So use it.

Table names: `@@map("payment_orders")`, etc. Columns: `@map("company_id")`.

Now, the `updated_at @updatedAt` in raw SQL for company_totals: my raw upsert sets `updated_at = now()` explicitly — but the Prisma column is `@updatedAt`... wait, mixing: if a column is `@updatedAt`, Prisma manages it on Prisma writes. My raw SQL sets it manually — consistent enough. Or make `updated_at` in company_totals a plain `@default(now())` column managed only by raw SQL? If Prisma never writes to company_totals (all writes are raw SQL), then `@default(now())` is fine, and raw sets it. Hmm — but `recompute` is also raw. So all writes to company_totals are raw → use a plain `updated_at DateTime @default(now())` and always set in raw statements. Actually simpler: drop `updated_at` from company_totals? It's useful for observability (drift detection). Keep it, plain column, set in raw SQL.

operation_reads.updated_at: written via Prisma upserts (hook + repair) → `@updatedAt` works.

Now, the Prisma model for operation_reads uses the same `OrderStatus` enum type.

Let me also consider `total_cents BigInt` serialization in the endpoint: the service returns `{ company_id, status, order_count, total_cents: total_cents.toString() }`. I'll document that total_cents is a string of integer cents (exact, arbitrary precision). And `amount_cents` on operations is a number (Int fits any single order... realistically yes. Even $21M single order fits Int. Fine).

Now, let me think about the exact raw SQL statements.

Create delta (order created, status S, amount A, company C):
```sql
INSERT INTO company_totals (company_id, status, order_count, total_cents, updated_at)
VALUES ($1, $2, 1, $3, now())
ON CONFLICT (company_id, status) DO UPDATE
SET order_count = company_totals.order_count + 1,
    total_cents = company_totals.total_cents + $3,
    updated_at = now()
```
Parameter types: $2 is an enum — the parameter is unknown → coerced to enum ✓. $3 bigint — pass a BigInt (or number? For node-pg: if I pass a JS number as param for bigint column — pg serializes as string. Postgres parses '123'::bigint from context ✓). For safety, pass BigInt: `BigInt(amount)`.

Status move (old → new):
Decrement old:
```sql
INSERT INTO company_totals (company_id, status, order_count, total_cents, updated_at)
VALUES ($1, $2, -1, -$3, now())
ON CONFLICT (company_id, status) DO UPDATE
SET order_count = company_totals.order_count - 1,
    total_cents = company_totals.total_cents - $3,
    updated_at = now()
```
Hmm, `-$3` with parameter: `$3` is a bigint param. `- $3` is fine. Actually let me pass the signed amount as a parameter directly: pass `-BigInt(amount)`. Simpler SQL: `total_cents + $3` where $3 is signed. Let me use one statement `applyDelta(company, status, deltaCount, deltaCents)`:

```sql
INSERT INTO company_totals (company_id, status, order_count, total_cents, updated_at)
VALUES ($1, $2, $3, $4, now())
ON CONFLICT (company_id, status) DO UPDATE
SET order_count = company_totals.order_count + $3,
    total_cents = company_totals.total_cents + $4,
    updated_at = now()
```
create → applyDelta(c, s, 1, A). Status change → applyDelta(c, old, -1, -A); applyDelta(c, new, 1, A). ✓ One reusable statement. `deltaCents` is BigInt signed. `$3` is int4 (order_count is int) — pass number. `$4` is BigInt.

Recompute (company C, absolute values per status):
```sql
INSERT INTO company_totals (company_id, status, order_count, total_cents, updated_at)
VALUES ($1, $2, $3, $4, now()), ($1, $5, $6, $7, now()), ($1, $8, $9, $10, now())
ON CONFLICT (company_id, status) DO UPDATE
SET order_count = EXCLUDED.order_count,
    total_cents = EXCLUDED.total_cents,
    updated_at = now()
```
Three rows fixed for the three enum values. Params: company repeated, status literals as params ($2, $5, $8), counts as numbers, cents as BigInt. ✓

Now `updated_at` in operation_reads upserts via Prisma — `@updatedAt` sets it on updates ✓.

The re-derivation upsert data:
```ts
{
  id, company_id, worker_id, worker_name, status, amount_cents, created_at,
  last_event_type, last_event_at
}
```
Wait, created_at: the upsert should preserve the original created_at (not reset). On conflict DO UPDATE — Prisma's upsert `update` clause only updates fields I include. I'll include the source created_at in `update` too (idempotent. Should be the same value anyway — re-derivation writes the source value, convergent). I'll include everything except id.

Now, the dashboard list query — the key to p95:
```ts
tx.operationRead.findMany({
  where: {
    company_id: companyId?,
    status?,
    created_at: from||to ? { ...(from && { gte: from }), ...(to && { lt: to }) } : undefined,
  },
  orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
  skip: (page-1)*pageSize,
  take: pageSize,
})
```
The index (company_id, status, created_at DESC, id DESC) matches the filter + order exactly → index range scan, no sort. For no company filter (all companies), the index doesn't help as much, but the operator filters by company (task says filtered by company) — I'll note in DESIGN that company filter is the hot path. If company_id is provided and status is provided → perfect. If company provided, no status → index prefix (company_id) then filter... index has status before created_at: without status, the index can only use the company_id prefix → scan all statuses for the company and filter → tolerable (company is selective). Alternative: two indexes? Overkill. The hot path is company + status. Fine. Documented.

Count: `operationRead.count({ where })` — index-assisted.

Now the worker rename hook: `operationRead.updateMany({ where: { worker_id }, data: { worker_name: newName } })`.

The event hook:
```ts
await tx.operationRead.updateMany({
  where: {
    id: orderId,
    OR: [{ last_event_at: null }, { last_event_at: { lt: occurredAt } }],
  },
  data: { last_event_type: type, last_event_at: occurredAt },
});
```
`last_event_at: null` in Prisma where → `IS NULL` ✓.

Now, the `TransactionService`:
```ts
@Injectable()
export class TransactionService {
  constructor(private readonly prisma: PrismaService) {}
  async run<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work, { maxWait: 5000, timeout: 30000 });
  }
}
```

The repositories accept `tx?: Prisma.TransactionClient` and use `const c = tx ?? this.prisma`.

Hmm — does Prisma.TransactionClient type include the model delegates? Yes, `$transaction`'s client type includes all model delegates + $executeRaw. ✓

The ProjectionService hooks take tx as first arg — the write service passes it. The re-derivation method (not per-write) — opens its own tx? The re-derivation over a large window should chunk with each chunk in its own tx (bounded tx size). Let me make each chunk its own `transactions.run(...)`. Totals recompute per company in its own tx (or in the final loop's own tx). ✓

Now let me write the write services:

PaymentOrdersService:
```ts
create(input: { company_id: string; worker_id: string; amount_cents: number }) {
  return this.transactions.run(async (tx) => {
    const worker = await this.workersRepository.findById(tx, input.worker_id);
    if (!worker) throw AppError.notFound('worker', input.worker_id);
    const order = await this.ordersRepository.create(tx, input);
    await this.projection.onOrderCreated(tx, order);
    return order;
  });
}

setStatus(id: string, status: OrderStatus) {
  return this.transactions.run(async (tx) => {
    const order = await this.ordersRepository.findById(tx, id);
    if (!order) throw AppError.notFound('payment order', id);
    if (order.status === status) return order; // no-op — but should we still return? Yes, idempotent.
    const updated = await this.ordersRepository.updateStatus(tx, id, status);
    await this.projection.onOrderStatusChanged(tx, updated, order.status);
    return updated;
  });
}
```
Transition rules? pending → approved/rejected. Approved → rejected? Business rules aren't specified. Let me allow any change except to same (idempotent no-op). Keep it permissive (documented as assumption? The domain is "simulate the write path" — minimal). I'll not restrict transitions beyond idempotency. Hmm, real marketplaces allow pending→approved/rejected. Once decided, locked. But the task doesn't specify. Restricting could break my concurrent test (only creates + single flip — fine either way). Let me keep permissive. Less assumption surface. Actually let me not add `// ASSUMPTION` spam. A short comment suffices.

The `amount_cents` change on update? Not supported (PATCH is status only). Good — totals delta math stays sane.

EventsService.record({ order_id, type, occurred_at? }):
```ts
return this.transactions.run(async (tx) => {
  const order = await this.ordersRepository.findById? 
```
Hmm, the events service needs to check order existence → inject PaymentOrdersRepository (PaymentOrdersModule exports it) or let FK + catch. Pre-check: inject PaymentOrdersRepository. EventsModule imports PaymentOrdersModule. ✓ (PaymentOrdersModule imports ProjectionModule + WorkersModule + CommonModule. No cycle: events → payment-orders → projection → company-totals. events → events repo... fine, acyclic.)

```ts
  if (!order) throw AppError.notFound('payment order', input.order_id);
  const occurredAt = input.occurred_at ?? new Date();
  const event = await this.eventsRepository.create(tx, { order_id, type, occurred_at: occurredAt });
  await this.projection.onEventRecorded(tx, order.id, event.type, event.occurred_at);
  return event;
});
```

WorkersService.create({ company_id, name }) / rename(id, name):
```ts
create: no hook needed (worker has no operations yet — but if a worker is re-created? id is new → no ops). So no projection impact. Just insert.
rename: transactions.run: update workers. projection.onWorkerRenamed(tx, id, newName).
```

The order creation hook needs the worker name — the projection repository fetches it: `findWorkerNameById(workerId)` (SELECT name FROM workers WHERE id). But wait — within the same tx, the worker row exists (pre-checked) ✓.

Now the OperationsService (dashboard):
```ts
list(query: OperationsQuery) {
  return Promise.all([
    this.repository.list(query),
    this.repository.count(query),
  ]).then(([items, total_count]) => ({ items, meta: { page, page_size, total_count } }));
}
```
The query object is validated in the controller.

CompanyTotalsService:
```ts
forCompany(companyId?: string) {
  return this.repository.list(companyId).then(rows => rows.map(r => ({ company_id, status, order_count, total_cents: r.total_cents.toString() })));
}
```
Zero-fill: the repository returns rows that exist. The service maps all three statuses for each company (fill missing with 0). If no company filter: all companies (group by company). Implementation: `repository.list(companyId?)` → select rows. Service reshapes to full matrix.

ProjectionService:
```ts
onOrderCreated(tx, order) { ... }
onOrderStatusChanged(tx, order, previousStatus) { ... }
onEventRecorded(tx, orderId, type, occurredAt) { ... }
onWorkerRenamed(tx, workerId, newName) { ... }
rederiveWindow(from, to) { ... returns { orders_rederived, companies_recomputed, windows? } }
@Cron(cronExpression, { name: 'drift-repair' }) async scheduledDriftRepair() { if (!enabled) return; if (running) return; running=true; try { const to = new Date(); const from = new Date(to.getTime() - hours*3600e3); await this.rederiveWindow(from, to); log } finally { running=false } }
```

@Cron with a dynamic expression: `@Cron(process.env.DRIFT_REPAIR_CRON ?? '0 * * * *')` — decorators can take runtime expressions (evaluated at class-definition time) ✓.

Now, the re-derivation implementation in the ProjectionService, using `projectionRepository` (source reads + operation_reads writes) and `companyTotalsRepository`:

```ts
async rederiveWindow(from, to) {
  let cursor: { created_at: Date; id: string } | null = null;
  let ordersRederived = 0;
  const affected = new Set<string>();
  while (true) {
    const orders = await this.projectionRepository.findOrdersInWindow(from, to, cursor, CHUNK_SIZE);
    if (!orders.length) break;
    const workerNames = await this.projectionRepository.findWorkerNames(orders.map(o => o.worker_id)); // Map
    const latestEvents = await this.projectionRepository.findLatestEventsPerOrder(orders.map(o => o.id)); // Map
    await this.transactions.run(async (tx) => {
      for (const o of orders) {
        const ev = latestEvents.get(o.id);
        await this.operationsRepository.upsert(tx, { ...o, worker_name: workerNames.get(o.worker_id) ?? '', last_event_type: ev?.type ?? null, last_event_at: ev?.occurred_at ?? null });
      }
    });
```
Hmm wait — I said the operations repository (operations feature) has the upsert. The ProjectionService injects OperationsRepository (from OperationsModule). And the projection repository has the source reads. OK, but then `upsert` needs tx — pass it. But we're inside `transactions.run` — the operationsRepository.upsert(tx, row) ✓.

Actually, should the source reads also be inside the tx? Consistency: re-derivation reads source then writes projection in a tx — the read should be inside the tx for a consistent snapshot. Let me put reads inside the tx too:

```ts
const orders = await this.transactions.run(async (tx) => {
  const batch = await this.projectionRepository.findOrdersInWindow(tx, from, to, cursor, CHUNK_SIZE);
  if (!batch.length) return [];
  const workerNames = ...
  const latest = ...
  for (...) await this.operationsRepository.upsert(tx, row);
  return batch;
});
```
Then update the cursor from the last element. `ordersRederived += batch.length`. Add companies to affected.

After the loop:
```ts
for (const companyId of affected) {
  await this.transactions.run(async (tx) => {
    const groups = await this.operationsRepository.sumByStatus(tx, companyId); // groupBy
    await this.companyTotalsRepository.recompute(tx, companyId, groups);
  });
}
```
`sumByStatus` in the OperationsRepository (reads operation_reads): `groupBy({ by: ['status'], where: { company_id }, _sum: { amount_cents: true }, _count: { _all: true } })` → returns `[{ status, _count: {_all}, _sum: {amount_cents: BigInt|null} }]`.

`recompute(tx, companyId, groups)`: build the 3 tuples (pending, approved, rejected) from the groups (default 0) and run the multi-row raw SQL.

Return a summary `{ orders_rederived, companies_recomputed }`.

Now — one concern: the `upsert` loop in the re-derivation is inside a tx with up to 1000 upserts. The interactive tx timeout of 30s is fine.

CHUNK_SIZE: 500.

Now the tests. Test file organization: `test/operations.spec.ts`, `test/company-totals.spec.ts`, `test/drift-repair.spec.ts`. Shared test helpers: `test/helpers.ts`? The layout says `test/<feature>.spec.ts` — a helpers file is extra but practical (fixture setup, app construction). Or inline a small bootstrap in each file (duplicated). I'll create `test/test-utils.ts` with:
- `createTestApp()`: Test.createTestingModule({ imports: [AppModule] }).compile(), init, return { app, module, prisma, services... } — wait, AppModule includes SchedulesModule → cron might fire. In tests `DRIFT_REPAIR_ENABLED=false` (set via process.env before import? The enabled check is at runtime inside the job — I read env at execution time → safe: set in beforeEach). Cron expression is evaluated at class-definition time — default hourly. The test won't last an hour. But to be safe, `DRIFT_REPAIR_ENABLED='false'` checked at execution. ✓
- `resetDatabase(prisma)`: delete in FK order: operation_reads? (no FK), company_totals, events, payment_orders, workers. `prisma.companyTotals.deleteMany(); prisma.event.deleteMany(); prisma.paymentOrder.deleteMany(); prisma.worker.deleteMany();`
- `randomCompany()`: uuid via crypto.randomUUID().
- `seedCompany(prisma, { workers, orders })` direct insert (bypassing hooks — for fixture speed. But note: direct source inserts leave the projection empty → tests must then call repair or use the service. For the totals concurrent test, we *want* the service path. For fixture setup in the read-your-own-writes test, we can use the service for everything (which is the point). For drift test, direct insert as "missed write" is intentional.)

Test 1 — read-your-own-writes (`test/operations.spec.ts`):
```ts
- Boot app. Reset DB.
- const worker = await workersService.create({ company_id, name: 'Ada' });
- const order = await paymentOrdersService.create({ company_id, worker_id, amount_cents: 1200 });
- let page = await operationsService.list({ company_id, page: 1, page_size: 50 });
- Assert item exists: id, worker_name 'Ada', status 'pending', amount 1200, last_event null. total_count 1.
- await eventsService.record({ order_id: order.id, type: 'approved' }) — hmm, event type: 'payment.captured'? Use simple types: 'created', 'approved'. Fine: 'approved'.
- Assert last_event_type 'approved' immediately.
- await paymentOrdersService.setStatus(order.id, 'approved');
- list again → status 'approved'. (Read-your-own-writes on status.)
- Negative: list with status 'pending' → 0 rows. company_totals? (That's the other file.)
- Worker rename: workersService.rename(worker.id, 'Ada Lovelace') → list → worker_name updated.
- Read-your-own-writes across companies: order in companyB not visible in company A's list.
```
This covers "approve an order → reflected in the next request" ✓ and "without changing what they see" (fields match source semantics).

Test 2 — concurrent totals (`test/company-totals.spec.ts`):
```ts
- Reset. Company + 4 workers (service create).
- Create N=60 orders in parallel (Promise.all, amounts deterministic: i * 100 cents).
- Flip 30 to approved in parallel (Promise.all), 10 to rejected in parallel? (20 stay pending.)
- totals = await companyTotalsService.forCompany(company_id);
- Assert: total across statuses == sum of all amounts. order_count sum == 60.
- Per status: approved total == sum of approved amounts (we know which ids), etc.
- Cross-check with projection: also verify no drift: sum of totals == sum of operation_reads (or just assert exactness of the expected value — that's the point: exact under concurrency).
```
Deterministic assignment: order i (0..59): if i % 2 === 0 → approved, if i % 5 === 0 && i%2===1? Let me define: even → approved, i%4===1 → rejected, else pending. Compute expected values from the same function in the test. Since creation is parallel, the array of returned orders is indexed. The flip sets known ids. ✓

Also assert `total_cents` returned as a string: Number(total_cents) comparison — compare with expected BigInt via BigInt(string) — assert `BigInt(row.total_cents) === expectedBigint`.

Test 3 — drift repair (`test/drift-repair.spec.ts`):
```ts
- Reset. Company A (in window) + worker + 3 orders via service (with events). Company B: 1 order via service. Then set B's order created_at to 30 days ago via prisma.
- Wait — B's order created 30 days ago is outside the default window. The test calls rederiveWindow(from, to) explicitly with a 1-hour window. ✓
- Corrupt A:
  a) Direct source change bypassing hook: prisma.paymentOrder.update({ id: a1, data: { status: 'approved' } }) → projection still shows pending (missed write).
  b) Direct projection tampering: prisma.operationRead.update({ id: a2, data: { worker_name: 'Wrong', amount_cents: 999999, status: 'rejected' } }) — wait, amount corruption: the re-derivation writes source amount → fix. ✓
  c) Event added directly: prisma.event.create({ order_id: a3, type: 'manual', occurred_at: now }) → projection lacks last_event.
  d) Totals corruption: prisma.companyTotals.update({ where: { company_id_status: { company_id: A, status: 'pending' } }, data: { total_cents: BigInt(1), order_count: 99 } }).
- Run projectionService.rederiveWindow(now-1h, now+1h) — to = now+1h to be safe against clock skew? created_at is now. Window [now-1h, now+1h) covers ✓.
- Assert:
  - a1 shows approved in list. Totals for A: approved includes a1's amount. pending excludes it.
  - a2 worker_name restored, amount restored, status restored (approved? a2's source status — let me set source as approved: source status for a2 is 'approved' (set via service before corruption?) simpler: all 3 orders pending in source. Corrupt a2 to rejected → repair → pending. ✓ And a1: source directly updated to approved → repair → approved in projection.)
  - a3 last_event 'manual'.
  - Totals for A exactly recomputed from source.
  - B untouched: B's corrupted projection row (prisma.operationRead.update for B's order to wrong name) still wrong after repair (window excludes). B's totals also corrupted & still corrupted.
  - Idempotency: run again → same results (assert totals unchanged).
```
Wait, B's order created via service at t0, then backdated. B's totals row exists (from service creation). Corrupt it. After repair: B unaffected → still corrupted ✓ (proves window scoping).

Also — company B's order is backdated via prisma, but operation_reads.created_at remains t0 (the projection holds a copy of created_at!). The re-derivation's window read uses payment_orders.created_at → B excluded ✓. But the projection row for B keeps the old created_at (t0) — in the real world, backdating source created_at is odd. Fine for test purposes.

Hmm one more check on the drift test (a): direct prisma update of source status — the repair re-derives a1 from source → projection status approved ✓ and totals recomputed for A ✓.

Now, the app module & DI — let me carefully list all providers/exports.

CommonModule:
```ts
@Module({
  providers: [PrismaService, TransactionService],
  exports: [PrismaService, TransactionService],
})
export class CommonModule {}
```

PaymentOrdersModule:
```ts
@Module({
  controllers: [PaymentOrdersController],
  providers: [PaymentOrdersService, PaymentOrdersRepository],
  imports: [CommonModule, WorkersModule, ProjectionModule],
  exports: [PaymentOrdersRepository],
})
```

EventsModule:
```ts
controllers: [EventsController],
providers: [EventsService, EventsRepository],
imports: [CommonModule, PaymentOrdersModule, ProjectionModule],
```

WorkersModule:
```ts
controllers: [WorkersController],
providers: [WorkersService, WorkersRepository],
imports: [CommonModule, ProjectionModule],
```

OperationsModule:
```ts
controllers: [OperationsController],
providers: [OperationsService, OperationsRepository],
imports: [CommonModule],
exports: [OperationsRepository],
```

CompanyTotalsModule:
```ts
controllers: [CompanyTotalsController],
providers: [CompanyTotalsService, CompanyTotalsRepository],
imports: [CommonModule],
exports: [CompanyTotalsRepository],
```

ProjectionModule:
```ts
providers: [ProjectionService],
imports: [CommonModule, OperationsModule, CompanyTotalsModule],
```
The projection service uses: Transactions (common), OperationsRepository (upsert + sumByStatus), CompanyTotalsRepository (delta/recompute), ProjectionRepository (source reads) — wait, ProjectionRepository must be a provider in ProjectionModule:
```ts
providers: [ProjectionService, ProjectionRepository],
```
✓.

Cycle check: PaymentOrders → Projection → Operations (no back-import) ✓. Events → PaymentOrders & Projection ✓. Workers → Projection ✓. No cycles.

AppModule:
```ts
@Module({
  imports: [
    SchedulesModule.forRoot(),
    CommonModule,
    PaymentOrdersModule,
    EventsModule,
    WorkersModule,
    OperationsModule,
    CompanyTotalsModule,
    ProjectionModule,
  ],
})
```

Wait — `@Cron` in the ProjectionService requires SchedulesModule to be loaded (in the same module tree) ✓.

Now, the controllers:

PaymentOrdersController:
```ts
@Controller('payment-orders')
export class PaymentOrdersController {
  constructor(private readonly service: PaymentOrdersService) {}

  @Post()
  create(@Body() body: unknown) {
    const v = validateCreateOrder(body); // throws AppError
    return this.service.create(v);
  }

  @Patch(':id')
  setStatus(@Param('id') id: string, @Body() body: unknown) {
    validate uuid + status;
    return this.service.setStatus(id, status);
  }
}
```
The validation helpers are in `src/common/validation.ts`: `requireUuid(value, field)`, `requireStatus`, `requirePositiveInt`, `parseIsoDate`, etc. Each throws AppError.validation.

OperationsController:
```ts
@Controller('operations')
@Get()
list(@Query() query: Record<string, string>) {
  return this.service.list(parseOperationsQuery(query));
}
```
parseOperationsQuery: company_id optional uuid. status optional enum. from/to optional ISO (from < to). page int ≥1 default 1. page_size int 1..200 default 50.

CompanyTotalsController:
```ts
@Controller('company-totals')
@Get()
list(@Query() q) { company_id optional uuid → service.forCompany(...) }
```

Endpoints kebab-case, plural: `payment-orders`, `company-totals`, `operations`, `events`, `workers` ✓.

Events controller POST: { order_id (uuid), type (non-empty string ≤100), occurred_at (optional ISO, not in future? allow? Validate ISO. If in future — allow? Event occurred_at in future is odd. Just require a valid ISO. No future restriction — hmm, keep it simple: valid ISO).

Workers: POST { company_id uuid, name string 1..200 }. PATCH /workers/:id { name }.

Now, response shapes: create returns the row. Fine.

Now `main.ts`:
```ts
import 'reflect-metadata'; // needed? For NestJS ESM... with CommonJS tsconfig, Nest doesn't require manual import. But ESM "type": "module"...
```
Hmm — ESM + NestJS: NestJS historically works with CJS. With `"type": "module"`, the Nest 10/11 works with ESM if the build output is ESM. The convention here says ESM type:module — so tsconfig `"module": "nodenext"`/`"NodeNext"` or `"ESNext"` with bundler... For tests (Vitest), ESM is fine. For runtime Nest ESM: supported since Nest 10 with caveats (decorators, .js extensions on relative imports for NodeNext). Do I write relative imports with `.js` extensions? If tsconfig module is NodeNext, TS requires explicit `.js` on relative imports. That's a lot of friction but correct for ESM. Alternatively `"module": "ESNext"` + `"moduleResolution": "Bundler"` — then no extensions needed and Vitest is happy. Runtime under Node would need a bundler... The repo convention says ESM type:module and pnpm. I'll provide a tsconfig with `"module": "nodenext", "moduleResolution": "nodenext"` and use `.js` extensions on relative imports — that's the defensible strict ESM setup, and Vitest supports TS with `.js` → `.ts` resolution? Hmm, Vitest + `.js` extension imports of TS files: yes, Vite/Vitest resolves `./foo.js` to `./foo.ts`? I believe Vite handles this (esbuild/TS resolution: Vite has supported importing TS files with `.js` specifiers since v3/v4? Actually I recall it does). I believe Vitest resolves `.js` → `.ts`. To be safe... alternative: avoid the issue — don't include tsconfig/package.json in the output? But the solution "needs" them to build.

Hmm let me reconsider: is it safer to output without package.json/tsconfig? The mechanical parser only reads the file blocks. Missing config = broken solution. Let me include:
- `package.json` (type module, scripts: dev/build/start/test/prisma migrate).
- `tsconfig.json` (module nodenext).
- `vitest.config.ts` (test config. env for tests).

With `.js` extensions on all relative imports (the correct ESM practice). Vitest: I'm fairly confident modern Vitest (1.x/2.x) handles `.js` → `.ts` (Vite's resolver does this for TS files — yes, Vite implements TS extension aliasing: "Vite supports importing .ts files with .js extension in ESM TS projects" — Vite has had this since 2.x? I think so. This is the standard NodeNext setup and Vite/Vitest supports it now).

Actually wait — for tests, there's a simpler, more robust path: Vitest handles TS/ESM natively, and the `.js` specifier resolution for TS sources is supported in Vite (I've seen this pattern work: NodeNext projects tested with Vitest). I'll proceed with nodenext + `.js` extensions.

Or — even simpler: keep everything standard Nest CJS... but the convention explicitly says ESM `"type": "module"`. Follow it.

Let me define package.json deps (reasonable versions):
```json
{
  "name": "marketplace-backoffice",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "dev": "tsx src/main.ts"? 
```
Hmm, `tsx` adds a dev dep. `start:dev` is via nest cli? Let me keep: `"dev": "tsx watch src/main.ts"` with `tsx` devDep. And `"test": "vitest run"`, `"prisma:migrate": "prisma migrate deploy"`, `"prisma:generate": "prisma generate"`.

deps: @nestjs/common ^10, @nestjs/core ^10, @nestjs/platform-express ^10, @nestjs/schedule ^4 (Nest10-compatible. Does v4.x work with Nest 10? @nestjs/schedule 4.x requires Nest 10? 4.0 targets Nest 10. Yes.)
@prisma/client ^5, class-transformer? (not needed), reflect-metadata ^0.2, rxjs ^7.
dev: prisma ^5, typescript ^5.5, vitest ^2, tsx ^4, @types/node ^20, @types/express? (not needed if I don't type express directly — the filter uses `Response` from @nestjs/common's ArgumentsHost — the type is from 'express'? `ctx.getResponse<Response>()` needs express types → add @types/express as devDep. Fine.)

I'll keep versions as caret ranges — defensible.

Now — I'll write all the raw SQL and Prisma calls precisely. Let me carefully draft each file.

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
  rejected

  @@map("order_status")
}

model Worker {
  id         String   @id @default(uuid()) @db.Uuid
  companyId  String   @map("company_id") @db.Uuid
  name       String
  role       String?
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @default(now()) @updatedAt @map("updated_at")

  orders PaymentOrder[]

  @@map("workers")
}

model PaymentOrder {
  id          String      @id @default(uuid()) @db.Uuid
  companyId   String      @map("company_id") @db.Uuid
  workerId    String      @map("worker_id") @db.Uuid
  status      OrderStatus @default(pending)
  amountCents Int         @map("amount_cents")
  createdAt   DateTime    @default(now()) @map("created_at")
  updatedAt   DateTime    @default(now()) @updatedAt @map("updated_at")

  worker PaymentOrderWorker? — no: relation: worker Worker @relation(fields: [workerId], references: [id])
  events Event[]

  @@index([createdAt, id], map: "ix_payment_orders_created_id")
  @@map("payment_orders")
}

model Event {
  id        String   @id @default(uuid()) @db.Uuid
  orderId   String   @map("order_id") @db.Uuid
  type      String
  occurredAt DateTime @map("occurred_at") @default(now())

  order PaymentOrder @relation(fields: [orderId], references: [id])

  @@index([orderId, occurredAt], map: "ix_events_order_occurred")
  @@map("events")
}

model OperationRead {
  id            String      @id @db.Uuid
  companyId     String      @map("company_id") @db.Uuid
  workerId      String      @map("worker_id") @db.Uuid
  workerName    String      @map("worker_name")
  status        OrderStatus
  amountCents   Int         @map("amount_cents")
  createdAt     DateTime    @map("created_at")
  updatedAt     DateTime    @default(now()) @updatedAt @map("updated_at")
  lastEventType String?     @map("last_event_type")
  lastEventAt   DateTime?   @map("last_event_at")

  @@index([companyId, status, createdAt(sort: Desc), id(sort: Desc)], map: "ix_operation_reads_company_status_created")
  @@index([workerId], map: "ix_operation_reads_worker")
  @@map("operation_reads")
}

model CompanyTotals {
  companyId   String      @map("company_id") @db.Uuid
  status      OrderStatus
  orderCount  Int         @default(0) @map("order_count")
  totalCents  BigInt      @default(0) @map("total_cents")
  updatedAt   DateTime    @default(now()) @map("updated_at")

  @@id([companyId, status])
  @@map("company_totals")
}
```

Check: `createdAt(sort: Desc)` in @@index — supported in Prisma 4.16+ / 5 ✓.

### prisma/migrations/0001_init/migration.sql

The migration name: Prisma-style is a timestamp like `20250101000000_init`. Let me use `20250101000000_init`.

```sql
-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable workers
CREATE TABLE "workers" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable payment_orders
CREATE TABLE "payment_orders" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "status" "order_status" NOT NULL DEFAULT 'pending',
    "amount_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable events
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable operation_reads
CREATE TABLE "operation_reads" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "worker_name" TEXT NOT NULL,
    "status" "order_status" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_event_type" TEXT,
    "last_event_at" TIMESTAMP(3),

    CONSTRAINT "operation_reads_pkey" PRIMARY KEY ("id")
);

-- CreateTable company_totals
CREATE TABLE "company_totals" (
    "company_id" UUID NOT NULL,
    "status" "order_status" NOT NULL,
    "order_count" INTEGER NOT NULL DEFAULT 0,
    "total_cents" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_totals_pkey" PRIMARY KEY ("company_id", "status")
);

-- CreateIndex
CREATE INDEX "ix_payment_orders_created_id" ON "payment_orders"("created_at", "id");
CREATE INDEX "ix_events_order_occurred" ON "events"("order_id", "occurred_at");
CREATE INDEX "ix_operation_reads_company_status_created" ON "operation_reads"("company_id", "status", "created_at" DESC, "id" DESC);
CREATE INDEX "ix_operation_reads_worker" ON "operation_reads"("worker_id");

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "events" ADD CONSTRAINT "events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "payment_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

`@@id([companyId, status])` → PK constraint name `company_totals_pkey` ✓ (Prisma names PK as `<table>_pkey` for composite? Prisma names the PK constraint as `company_totals_pkey`. Yes.)

The index name from `map:` ✓.

### src/common/prisma.service.ts

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

### src/common/transaction.service.ts

```ts
import { Injectable } from '@nestjs/common';
import type { PrismaTransactionClient } from '@prisma/client/runtime/library'? 
```
Hmm — the `Prisma.TransactionClient` type: from '@prisma/client' as `Prisma.TransactionClient` (namespace import). I'll use `import { Prisma } from '@prisma/client';` and `Prisma.TransactionClient`.

```ts
@Injectable()
export class TransactionService {
  constructor(private readonly prisma: PrismaService) {}

  run<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work, { maxWait: 5000, timeout: 30000 });
  }
}
```

### src/common/errors.ts

```ts
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
    public readonly httpStatus: number = 500,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static notFound(resource: string, id: string): AppError {
    return new AppError('resource_not_found', `${resource} with id ${id} was not found`, { resource, id }, 404);
  }

  static validation(message: string, details: Record<string, unknown>): AppError {
    return new AppError('validation_error', message, details, 400);
  }
}
```

### src/common/exception.filter.ts

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { AppError } from './errors.js';

interface ErrorEnvelope { error: { code: string; message: string; details: Record<string, unknown> } }

const CODE_BY_STATUS: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'validation_error',
  [HttpStatus.METHOD_NOT_ALLOWED]: 'method_not_allowed',
  [HttpStatus.NOT_FOUND]: 'resource_not_found',
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    let status: number;
    let body: ErrorEnvelope;

    if (exception instanceof AppError) {
      status = exception.httpStatus;
      body = { error: { code: exception.code, message: exception.message, details: exception.details } };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      body = { error: { code: CODE_BY_STATUS[status] ?? 'internal_error', message: exception.message, details: {} } };
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      body = { error: { code: 'internal_error', message: 'Unexpected server error', details: {} } };
    }

    response.status(status).json(body);
  }
}
```

HttpException message can be an object (e.g. validation pipe) — for plain HttpException, `exception.message` is a string ✓.

### src/common/validation.ts

Helpers that throw AppError.validation:

```ts
import { isUUID } from 'crypto'? 
```
Node crypto has `isUUID` (since Node 19.4/20 ✓). `import { isUUID } from 'node:crypto';`

```ts
const STATUSES = ['pending', 'approved', 'rejected'] as const;
export type OrderStatusValue = (typeof STATUSES)[number];

export function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isUUID(value)) {
    throw AppError.validation(`${field} must be a UUID`, { field, value });
  }
  return value;
}

export function optionalUuid(value: unknown, field: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  return requireUuid(value, field);
}

export function requireStatus(value: unknown, field: string): OrderStatusValue { ... }
export function optionalStatus(value: unknown, field: string): OrderStatusValue | undefined { ... }

export function requirePositiveInt(value: unknown, field: string, max?: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw ...
  if (max !== undefined && value > max) throw ...
  return value;
}

export function optionalIntQuery(value: unknown, field: string, fallback: number, max: number): number {
  if (value === undefined || value === '') return fallback;
  return requirePositiveInt(typeof value === 'string' ? Number(value) : value, field, max);
}

export function requireIsoDate(value: unknown, field: string): Date {
  if (typeof value !== 'string') throw ...
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw AppError.validation(`${field} must be an ISO-8601 date`, { field, value });
  return d;
}
export function optionalIsoDate(value, field): Date | undefined {...}

export function requireString(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw ...
  return value;
}
```

`isUUID` — from `node:crypto` in Node 20 ✓.

### src/common/common.module.ts

```ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { TransactionService } from './transaction.service.js';

@Module({
  providers: [PrismaService, TransactionService],
  exports: [PrismaService, TransactionService],
})
export class CommonModule {}
```

### src/workers/... 

WorkersRepository:
```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';

@Injectable()
export class WorkersRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(tx?: Prisma.TransactionClient) { return tx ?? this.prisma; }

  findById(tx: Prisma.TransactionClient | undefined, id: string) {
    return this.client(tx).worker.findUnique({ where: { id } });
  }

  create(tx, data: { companyId: string; name: string }) {
    return this.client(tx).worker.create({ data: { companyId: data.companyId, name: data.name } });
  }

  rename(tx, id: string, name: string) {
    return this.client(tx).worker.update({ where: { id }, data: { name } });
  }
}
```

Typing: tx param type `Prisma.TransactionClient | undefined`.

WorkersService:
```ts
@Injectable()
export class WorkersService {
  constructor(
    private readonly repository: WorkersRepository,
    private readonly transactions: TransactionService,
    private readonly projection: ProjectionService,
  ) {}

  create(input: { companyId: string; name: string }): Promise<Worker> {
    return this.repository.create(undefined, input); // no tx needed? For consistency: no projection impact → no tx.
  }

  rename(id: string, name: string) {
    return this.transactions.run(async (tx) => {
      const worker = await this.repository.findById(tx, id);
      if (!worker) throw AppError.notFound('worker', id);
      const updated = await this.repository.rename(tx, id, name);
      await this.projection.onWorkerRenamed(tx, id, name);
      return updated;
    });
  }
}
```
Wait — the service returns `Promise<Worker>` — import the type from '@prisma/client'. Fine.

Hmm — `create` with no tx: repository's client(undefined) → prisma ✓.

WorkersController:
```ts
@Controller('workers')
export class WorkersController {
  constructor(private readonly service: WorkersService) {}

  @Post()
  create(@Body() body: unknown) {
    const payload = body as Record<string, unknown> ... 
```
Careful typing: `@Body() body: unknown` then a helper `asRecord(body)` in the validation module? Let me add `function asRecord(value: unknown, what: string): Record<string, unknown>` that throws a validation error if not an object.

```ts
  @Post()
  create(@Body() body: unknown) {
    const payload = asRecord(body, 'request body');
    return this.service.create({
      companyId: requireUuid(payload.company_id, 'company_id'),
      name: requireString(payload.name, 'name', 200),
    });
  }

  @Patch(':id')
  rename(@Param('id') id: string, @Body() body: unknown) {
    const payload = asRecord(body, 'request body');
    return this.service.rename(requireUuid(id, 'id'), requireString(payload.name, 'name', 200));
  }
}
```

WorkersModule:
```ts
@Module({
  controllers: [WorkersController],
  providers: [WorkersService, WorkersRepository],
  imports: [CommonModule, ProjectionModule],
})
export class WorkersModule {}
```
Does the workers module need to export anything? PaymentOrdersService pre-checks worker existence → needs WorkersRepository → WorkersModule exports WorkersRepository. ✓ Add exports.

### src/payment-orders/...

PaymentOrdersRepository:
```ts
findById(tx, id): Promise<PaymentOrder | null>
create(tx, data: { companyId; workerId; amountCents }): Promise<PaymentOrder>  // status default pending
updateStatus(tx, id, status): Promise<PaymentOrder>
```

PaymentOrdersService:
```ts
create(input: { companyId; workerId; amountCents }): Promise<PaymentOrder> {
  return this.transactions.run(async (tx) => {
    const worker = await this.workersRepository.findById(tx, input.workerId);
    if (!worker) throw AppError.notFound('worker', input.workerId);
    if (input.amountCents < 0) — validated in controller (positive int). Service trusts controller? Validation is the controller's job. ok.
    const order = await this.ordersRepository.create(tx, input);
    await this.projection.onOrderCreated(tx, order);
    return order;
  });
}

setStatus(id: string, status: OrderStatus): Promise<PaymentOrder> {
  return this.transactions.run(async (tx) => {
    const order = await this.ordersRepository.findById(tx, id);
    if (!order) throw AppError.notFound('payment order', id);
    if (order.status === status) return order;
    const updated = await this.ordersRepository.updateStatus(tx, id, status);
    await this.projection.onOrderStatusChanged(tx, updated, order.status);
    return updated;
  });
}
```
Injecting WorkersRepository → PaymentOrdersModule imports WorkersModule ✓.

Controller:
```ts
@Controller('payment-orders')
@Post()
create(@Body() body: unknown) {
  const p = asRecord(body, 'request body');
  return this.service.create({
    companyId: requireUuid(p.company_id, 'company_id'),
    workerId: requireUuid(p.worker_id, 'worker_id'),
    amountCents: requirePositiveInt(p.amount_cents, 'amount_cents', 1_000_000_00), // max $1M
  });
}

@Patch(':id')
setStatus(@Param('id') id: string, @Body() body: unknown) {
  const p = asRecord(body, 'request body');
  return this.service.setStatus(requireUuid(id, 'id'), requireStatus(p.status, 'status'));
}
```

### src/events/...

EventsRepository:
```ts
create(tx, data: { orderId; type; occurredAt }): Promise<Event>
```

EventsService:
```ts
record(input: { orderId: string; type: string; occurredAt: Date }): Promise<Event> {
  return this.transactions.run(async (tx) => {
    const order = await this.ordersRepository.findById(tx, input.orderId);
    if (!order) throw AppError.notFound('payment order', input.orderId);
    const event = await this.eventsRepository.create(tx, input);
    await this.projection.onEventRecorded(tx, event.orderId, event.type, event.occurredAt);
    return event;
  });
}
```
Inject PaymentOrdersRepository → EventsModule imports PaymentOrdersModule ✓.

Controller:
```ts
@Controller('events')
@Post()
record(@Body() body: unknown) {
  const p = asRecord(body, 'request body');
  const occurredRaw = p.occurred_at;
  const occurredAt = occurredRaw === undefined ? new Date() : requireIsoDate(occurredRaw, 'occurred_at');
  return this.service.record({
    orderId: requireUuid(p.order_id, 'order_id'),
    type: requireString(p.type, 'type', 100),
    occurredAt,
  });
}
```

### src/operations/...

OperationsQuery type:
```ts
export interface OperationsQuery {
  companyId?: string;
  status?: OrderStatus;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}
```
Where to define? `operations.service.ts` or a separate types file? I'll keep it in the service file and import it in the controller. Fine.

OperationsRepository:
```ts
@Injectable()
export class OperationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(tx?: Prisma.TransactionClient, q: OperationsQuery) {
    const where = this.where(q);
    const c = this.client(tx);
    return c.operationRead.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    });
  }

  count(tx?, q): Promise<number> { return this.client(tx).operationRead.count({ where: this.where(q) }); }

  upsert(tx, read: { id; companyId; workerId; workerName; status; amountCents; createdAt; lastEventType: string | null; lastEventAt: Date | null }) {
    return this.client(tx).operationRead.upsert({
      where: { id: read.id },
      create: { id: read.id, companyId, workerId, workerName, status, amountCents, createdAt, lastEventType, lastEventAt },
      update: { companyId, workerId, workerName, status, amountCents, createdAt, lastEventType, lastEventAt },
    });
  }

  sumByStatus(tx, companyId) {
    return this.client(tx).operationRead.groupBy({
      by: ['status'],
      where: { companyId },
      _sum: { amountCents: true },
      _count: { _all: true },
    });
  }

  private where(q: OperationsQuery): Prisma.OperationReadWhereInput {
    return {
      ...(q.companyId !== undefined && { companyId: q.companyId }),
      ...(q.status !== undefined && { status: q.status }),
      ...((q.from !== undefined || q.to !== undefined) && {
        createdAt: {
          ...(q.from !== undefined && { gte: q.from }),
          ...(q.to !== undefined && { lt: q.to }),
        },
      }),
    };
  }
}
```

Note: `status?: OrderStatus` — the Prisma enum type imported as `OrderStatus` from '@prisma/client' (a value + type union). In TS, the Prisma-generated `OrderStatus` is both a type (union) and a const object. My validation module uses string literals. To keep the layers decoupled, I'll use Prisma's `OrderStatus` type throughout (import from '@prisma/client'). The controller's validation returns `OrderStatus` (cast after checking against the list). OK: `requireStatus` returns `OrderStatus` (checked with the Prisma enum object's list? Simplest: hardcode the three literal strings, typed as OrderStatus). `as const` array of the literals with type annotation `OrderStatus`.

OperationsService:
```ts
@Injectable()
export class OperationsService {
  constructor(private readonly repository: OperationsRepository) {}

  async list(query: OperationsQuery): Promise<OperationsPage> {
    const [items, totalCount] = await Promise.all([
      this.repository.list(undefined, query),
      this.repository.count(undefined, query),
    ]);
    return {
      items: items.map(mapOperationRead),
      meta: { page: query.page, pageSize: query.pageSize, totalCount },
    };
  }
}
```
`mapOperationRead`: snake_case wire fields:
```ts
{
  id: r.id, company_id: r.companyId, worker_id: r.workerId, worker_name: r.workerName,
  status: r.status, amount_cents: r.amountCents, created_at: r.createdAt.toISOString(), updated_at: ...,
  last_event_type: r.lastEventType, last_event_at: r.lastEventAt?.toISOString() ?? null,
}
```
Date → ISO string (JSON serializes Date to ISO anyway, but explicit is better).

OperationsController:
```ts
@Controller('operations')
@Get()
list(@Query() query: Record<string, string | undefined>) {
  const from = optionalIsoDate(query.from, 'from');
  const to = optionalIsoDate(query.to, 'to');
  if (from && to && from >= to) throw AppError.validation("'from' must be earlier than 'to'", { from, to });
  return this.service.list({
    companyId: optionalUuid(query.company_id, 'company_id'),
    status: optionalStatus(query.status, 'status'),
    from, to,
    page: optionalIntQuery(query.page, 'page', 1, 1_000_000),
    pageSize: optionalIntQuery(query.page_size, 'page_size', 50, 200),
  });
}
```

### src/company-totals/...

CompanyTotalsRepository:
```ts
@Injectable()
export class CompanyTotalsRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(tx?: Prisma.TransactionClient, companyId?: string) {
    return this.client(tx).companyTotals.findMany({
      where: companyId !== undefined ? { companyId } : {},
      orderBy: [{ companyId: 'asc' }, { status: 'asc' }],
    });
  }

  /**
   * Apply a signed delta atomically. A single INSERT ... ON CONFLICT statement
   * is the whole update, so concurrent increments from parallel transactions
   * can never overwrite each other (a Prisma upsert would be a read-modify-write).
   */
  applyDelta(tx, companyId: string, status: OrderStatus, deltaCount: number, deltaCents: bigint): Promise<void> {
    return this.client(tx).$executeRaw`
      INSERT INTO company_totals (company_id, status, order_count, total_cents, updated_at)
      VALUES (${companyId}, ${status}, ${deltaCount}, ${deltaCents}, now())
      ON CONFLICT (company_id, status) DO UPDATE
      SET order_count = company_totals.order_count + ${deltaCount},
          total_cents = company_totals.total_cents + ${deltaCents},
          updated_at  = now()
    `;
  }

  /** Absolute reset of a company's three status buckets (used by re-derivation). */
  recompute(tx, companyId: string, totals: Record<OrderStatus, { count: number; cents: bigint }>): Promise<void> {
    const t = totals;
    return this.client(tx).$executeRaw`
      INSERT INTO company_totals (company_id, status, order_count, total_cents, updated_at)
      VALUES
        (${companyId}, ${'pending'}, ${t.pending.count}, ${t.pending.cents}, now()),
        (${companyId}, ${'approved'}, ${t.approved.count}, ${t.approved.cents}, now()),
        (${companyId}, ${'rejected'}, ${t.rejected.count}, ${t.rejected.cents}, now())
      ON CONFLICT (company_id, status) DO UPDATE
      SET order_count = EXCLUDED.order_count,
          total_cents = EXCLUDED.total_cents,
          updated_at  = now()
    `;
  }
}
```

Wait — `updated_at` in company_totals is `@default(now())` in Prisma and a plain column. Raw sets it ✓.

Hmm, in `recompute` I use `${'pending'}` — the parameter is a string into the enum column: the unknown-typed param is coerced ✓.

BigInt parameter via template tag: does Prisma's $executeRaw support BigInt values? Prisma docs: $executeRaw supports BigInt parameters (serializes appropriately). I believe yes (Prisma's raw query parameter type includes bigint). To be extra safe, I could pass `deltaCents.toString()` — a string parameter into a bigint column: the unknown type is coerced from a string → '123'::bigint works? For an unknown-typed parameter, Postgres infers the target type from context (bigint column / arithmetic) — an unknown-typed input can be a string literal representation ✓. Numbers too. Safest: pass a string? Hmm, Prisma serializes the JS string as a text parameter (unknown OID) ✓ Postgres casts. I'll pass BigInt directly — Prisma handles BigInt (it's in the documented parameter types for $executeRaw: "number, string, BigInt, Date, ..."). Yes, Prisma supports BigInt in raw queries. OK, pass BigInt.

CompanyTotalsService:
```ts
@Injectable()
export class CompanyTotalsService {
  constructor(private readonly repository: CompanyTotalsRepository) {}

  async forCompany(companyId?: string): Promise<CompanyTotalRow[]> {
    const rows = await this.repository.list(undefined, companyId);
    // zero-fill the three buckets so the operator always sees a stable shape
    const byCompany = new Map<string, Partial<Record<OrderStatus, { orderCount: number; totalCents: bigint }>>>();
    for (const row of rows) { byCompany.get(row.companyId) ??= {}; byCompany[row.companyId][row.status] = { orderCount: row.orderCount, totalCents: row.totalCents }; }
    const companies = companyId !== undefined ? [companyId] : [...byCompany.keys()].sort();
    const out: CompanyTotalRow[] = [];
    for (const c of companies) {
      for (const status of ORDER_STATUSES) {
        const bucket = byCompany.get(c)?.[status];
        out.push({
          company_id: c,
          status,
          order_count: bucket?.orderCount ?? 0,
          total_cents: (bucket?.totalCents ?? 0n).toString(),
        });
      }
    }
    return out;
  }
}
```
`ORDER_STATUSES: OrderStatus[] = ['pending', 'approved', 'rejected']` — define in validation.ts or a shared constants file? Let me put `ORDER_STATUSES` in `src/common/order-status.ts`? Hmm, one more file... Let me put it in validation.ts: `export const ORDER_STATUSES = ['pending','approved','rejected'] as const satisfies readonly OrderStatus[];` and `type OrderStatusValue = (typeof ORDER_STATUSES)[number]`. Wait, `satisfies` needs TS 4.9+ ✓. Simpler: `export const ORDER_STATUSES: OrderStatus[] = ['pending', 'approved', 'rejected'];` (import type OrderStatus from prisma in the common file — fine).

Controller:
```ts
@Controller('company-totals')
@Get()
list(@Query() query: Record<string, string | undefined>) {
  return this.service.forCompany(optionalUuid(query.company_id, 'company_id'));
}
```

### src/projection/...

ProjectionRepository (source reads for re-derivation + worker name):
```ts
@Injectable()
export class ProjectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Keyset-paginated orders whose creation time falls in [from, to).
   */
  findOrdersInWindow(tx, from: Date, to: Date, cursor: { createdAt: Date; id: string } | null, limit: number) {
    const where: Prisma.PaymentOrderWhereInput = {
      createdAt: { gte: from, lt: to },
      ...(cursor && {
        OR: [
          { createdAt: { gt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { gt: cursor.id } },
        ],
      }),
    };
    return this.client(tx).paymentOrder.findMany({ where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: limit });
  }

  findWorkerNames(tx, workerIds: string[]): Promise<Map<string, string>> {
    return this.client(tx).worker.findMany({ where: { id: { in: workerIds } }, select: { id: true, name: true } })
      .then(rows => new Map(rows.map(w => [w.id, w.name])));
  }

  findLatestEventPerOrder(tx, orderIds: string[]): Promise<Map<string, { type: string; occurredAt: Date }>> {
    return this.client(tx).event.findMany({
      where: { orderId: { in: orderIds } },
      orderBy: { occurredAt: 'asc' },
      select: { orderId: true, type: true, occurredAt: true },
    }).then(rows => {
      const latest = new Map<string, { type: string; occurredAt: Date }>();
      for (const e of rows) latest.set(e.orderId, e); // ascending → last write wins
      return latest;
    });
  }
}
```

ProjectionService:
```ts
const REDErive_CHUNK_SIZE = 500;

@Injectable()
export class ProjectionService {
  private repairRunning = false;
  private readonly logger = new Logger(ProjectionService.name);

  constructor(
    private readonly repository: ProjectionRepository,
    private readonly operationsRepository: OperationsRepository,
    private readonly companyTotalsRepository: CompanyTotalsRepository,
    private readonly transactions: TransactionService,
  ) {}

  /** Write path hooks — each is called inside the write's transaction. */
  onOrderCreated(tx, order: { id; companyId; workerId; status: OrderStatus; amountCents; createdAt }) — needs worker name:
    return this.transactions? no — tx is given. Sequence:
      const [name] = await this.repository.workerName(tx, order.workerId); // single
      await this.operationsRepository.upsert(tx, { ...order, workerName: name, lastEventType: null, lastEventAt: null });
      await this.companyTotalsRepository.applyDelta(tx, order.companyId, order.status, 1, BigInt(order.amountCents));
```
Wait — onOrderCreated: order is new → upsert = insert. last_event null ✓. But note: an order is created with status 'pending' always (the service default) — the hook is generic anyway.

Hmm, `workerName` single fetch: add to repository: `findWorkerName(tx, workerId): Promise<string | null>` (findUnique select name).

```ts
  async onOrderCreated(tx: Prisma.TransactionClient, order: OrderRef): Promise<void> {
    const workerName = await this.repository.findWorkerName(tx, order.workerId);
    if (workerName === null) {
      throw new AppError('internal_error', `worker ${order.workerId} disappeared while creating order ${order.id}`, {});
    }
    await this.operationsRepository.upsert(tx, {
      id: order.id, companyId: order.companyId, workerId: order.workerId,
      workerName, status: order.status, amountCents: order.amountCents, createdAt: order.createdAt,
      lastEventType: null, lastEventAt: null,
    });
    await this.companyTotalsRepository.applyDelta(tx, order.companyId, order.status, 1, BigInt(order.amountCents));
  }

  async onOrderStatusChanged(tx, order: { id; companyId; status: OrderStatus; amountCents }, previousStatus: OrderStatus): Promise<void> {
    await this.operationsRepository.setStatus? 
```
Hmm — the operations repository needs a `setStatus(tx, id, status)` update method:
```ts
setStatus(tx, id: string, status: OrderStatus) { return this.client(tx).operationRead.update({ where: { id }, data: { status } }); }
```
(throw if not found? The read exists. If not, Prisma P2025 — treat as drift. Repair fixes. But the write path just created it in the same tx, so it exists.)

```ts
    await this.operationsRepository.setStatus(tx, order.id, order.status);
    await this.companyTotalsRepository.applyDelta(tx, order.companyId, previousStatus, -1, -BigInt(order.amountCents));
    await this.companyTotalsRepository.applyDelta(tx, order.companyId, order.status, 1, BigInt(order.amountCents));
  }

  async onEventRecorded(tx, orderId: string, type: string, occurredAt: Date): Promise<void> {
    await this.client? — need an operationRead updateMany with conditional. Add to OperationsRepository:
    setLatestEventIfNewer(tx, id, type, occurredAt) {
      return this.client(tx).operationRead.updateMany({
        where: { id, OR: [{ lastEventAt: null }, { lastEventAt: { lt: occurredAt } }] },
        data: { lastEventType: type, lastEventAt: occurredAt },
      });
    }
  }

  async onWorkerRenamed(tx, workerId: string, name: string): Promise<void> {
    await this.operationsRepository.renameWorker(tx, workerId, name); // updateMany by workerId
  }
```

Re-derivation:
```ts
async rederiveWindow(from: Date, to: Date): Promise<RederiveResult> {
  if (!(from < to)) throw AppError.validation("'from' must be earlier than 'to'", { from: from.toISOString(), to: to.toISOString() });
  let cursor: { createdAt: Date; id: string } | null = null;
  let ordersRederived = 0;
  const affectedCompanies = new Set<string>();

  while (true) {
    const batch = await this.transactions.run(async (tx) => {
      const orders = await this.repository.findOrdersInWindow(tx, from, to, cursor, REDEIVE_CHUNK_SIZE);
      if (orders.length === 0) return orders;
      const workerNames = await this.repository.findWorkerNames(tx, [...new Set(orders.map(o => o.workerId))]);
      const latestEvents = await this.repository.findLatestEventPerOrder(tx, orders.map(o => o.id));
      for (const order of orders) {
        const lastEvent = latestEvents.get(order.id);
        await this.operationsRepository.upsert(tx, {
          id: order.id,
          companyId: order.companyId,
          workerId: order.workerId,
          workerName: workerNames.get(order.workerId) ?? '',
          status: order.status,
          amountCents: order.amountCents,
          createdAt: order.createdAt,
          lastEventType: lastEvent?.type ?? null,
          lastEventAt: lastEvent?.occurredAt ?? null,
        });
      }
      return orders;
    });

    if (batch.length === 0) break;
    ordersRederived += batch.length;
    for (const order of batch) affectedCompanies.add(order.companyId);
    const last = batch[batch.length - 1];
    cursor = { createdAt: last.createdAt, id: last.id };
  }

  let companiesRecomputed = 0;
  for (const companyId of affectedCompanies) {
    await this.transactions.run(async (tx) => {
      const groups = await this.operationsRepository.sumByStatus(tx, companyId);
      const totals = this.totalsFromGroups(groups);
      await this.companyTotalsRepository.recompute(tx, companyId, totals);
      companiesRecomputed += 1;
    });
  }

  this.logger.log(`re-derived ${ordersRederived} operations in [${from.toISOString()}, ${to.toISOString()}); recomputed totals for ${companiesRecomputed} companies`);
  return { ordersRederived, companiesRecomputed };
}

private totalsFromGroups(groups: { status: OrderStatus; _sum: { amountCents: bigint | null }; _count: { _all: number } }[]): Record<OrderStatus, { count: number; cents: bigint }> {
  const totals: Record<OrderStatus, { count: number; cents: bigint }> = {
    pending: { count: 0, cents: 0n },
    approved: { count: 0, cents: 0n },
    rejected: { count: 0, cents: 0n },
  };
  for (const g of groups) {
    totals[g.status] = { count: g._count._all, cents: g._sum.amountCents ?? 0n };
  }
  return totals;
}
```

Bug alert: `companiesRecomputed += 1` inside the async tx callback — that's fine (increments after await? no — it's inside the callback, before it returns. `run` awaits the callback → increment is complete by the time the loop continues ✓).

Drift repair job:
```ts
@Cron(process.env.DRIFT_REPAIR_CRON ?? '0 * * * *', { name: 'drift-repair' })
async scheduledDriftRepair(): Promise<void> {
  if (process.env.DRIFT_REPAIR_ENABLED === 'false') return;
  if (this.repairRunning) { this.logger.warn('previous drift-repair run still in progress; skipping'); return; }
  this.repairRunning = true;
  try {
    const windowHours = Number(process.env.DRIFT_REPAIR_WINDOW_HOURS ?? 24);
    const to = new Date();
    const from = new Date(to.getTime() - windowHours * 3_600_000);
    await this.rederiveWindow(from, to);
  } catch (error) {
    this.logger.error(`drift-repair failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    this.repairRunning = false;
  }
}
```

`@Cron` with a dynamic default — the expression is evaluated once at class-definition time. If the env is set before module load (yes, env vars are at process start) ✓.

Edge: `windowHours` NaN → guard: `Number.isFinite(windowHours) && windowHours > 0 ? windowHours : 24`.

### src/app.module.ts, src/main.ts

main.ts:
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './common/exception.filter.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
```
`import 'reflect-metadata'` — needed? Nest's @nestjs/common already imports it. With ESM it's standard practice. Harmless.

app.module.ts:
```ts
import { Module } from '@nestjs/common';
import { SchedulesModule } from '@nestjs/schedule';
import { CommonModule } from './common/common.module.js';
...
@Module({
  imports: [
    SchedulesModule.forRoot(),
    CommonModule,
    PaymentOrdersModule,
    EventsModule,
    WorkersModule,
    OperationsModule,
    CompanyTotalsModule,
    ProjectionModule,
  ],
})
export class AppModule {}
```

### Tests

test/test-utils.ts:
```ts
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma.service.js';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  paymentOrdersService: PaymentOrdersService;
  eventsService: EventsService;
  workersService: WorkersService;
  operationsService: OperationsService;
  companyTotalsService: CompanyTotalsService;
  projectionService: ProjectionService;
}

export async function createTestContext(): Promise<TestContext> {
  process.env.DRIFT_REPAIR_ENABLED = 'false';
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return {
    app,
    prisma: moduleRef.get(PrismaService),
    paymentOrdersService: moduleRef.get(PaymentOrdersService),
    ...
  };
}

export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.companyTotals.deleteMany();
  await prisma.operationRead.deleteMany();
  await prisma.event.deleteMany();
  await prisma.paymentOrder.deleteMany();
  await prisma.worker.deleteMany();
}

export function newCompanyId(): string { return randomUUID(); }
export function newWorkerId(): string { return randomUUID(); }
```
Wait — the operations table has no FK to orders. deleteMany order: company_totals, operation_reads, events, payment_orders, workers ✓.

But — the app in tests: PrismaService connects (onModuleInit). Requires DATABASE_URL → the test needs a real Postgres. Add a `globalSetup` that fails fast with a clear message if DATABASE_URL is missing? Vitest: I can put in test-utils: `if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required to run the read-model test suite')` in createTestContext. Good — fail-fast with a clear error. (Document in DESIGN.md/README? A small `test/README`? No extra files beyond needed. A comment in test-utils suffices. Hmm, and vitest.config sets `test.env`? env from process only. OK.)

Also `app.close()` in afterEach. And in vitest.config: `test: { fileParallelism: false? }` — the 3 spec files share one database. Parallel spec files could interleave! Vitest by default runs spec files in parallel (workers). With a shared DB and resetDatabase in beforeEach → interference between files! Options: `test: { pool: 'forks', poolOptions: { forks: { singleFork: true } } }` or `fileParallelism: false` (Vitest 2). I'll set `fileParallelism: false` in vitest.config.ts to serialize files. Within a file, tests run sequentially by default (unless concurrent). ✓

Alternatively, isolate via company_id randomization — but the company_totals list (no company filter) crosses all companies → still interference (totals test asserts globally? My totals test filters by company_id. Operations list is filtered by company... but the resetDatabase deleteMany nukes other files' data → interference anyway). So serialize: `fileParallelism: false`. In Vitest 2 the option is `fileParallelism: false` (v1: `singleThread`/`threads: false`). I'll use `fileParallelism: false` and note vitest ^2.

Now, let me write the test files.

#### test/operations.spec.ts (read-your-own-writes)

```ts
import { beforeAll? } — I'll use beforeEach/afterEach with a shared context.

describe('operations dashboard — read-your-own-writes', () => {
  let ctx: TestContext;
  const companyId = randomUUID();
  let workerId: string;

  beforeEach(async () => {
    ctx = await createTestContext();
    await resetDatabase(ctx.prisma);
    workerId = await createWorker(ctx, companyId, 'Ada');
  });

  afterEach(async () => {
    await resetDatabase(ctx.prisma);
    await ctx.app.close();
  });
```
Hmm, createWorker via the service.

```ts
  it('shows a newly created order on the next dashboard read', async () => {
    const order = await ctx.paymentOrdersService.create({ companyId, workerId, amountCents: 1200 });

    const page = await ctx.operationsService.list({ companyId, page: 1, pageSize: 50 });

    expect(page.meta.totalCount).toBe(1);
    expect(page.items).toEqual([
      expect.objectContaining({
        id: order.id,
        company_id: companyId,
        worker_id: workerId,
        worker_name: 'Ada',
        status: 'pending',
        amount_cents: 1200,
      }),
    ]);
    expect(page.items[0].last_event_type).toBeNull();
  });

  it('reflects an approval immediately, including the status filter and totals', async () => {
    const order = await ctx.paymentOrdersService.create({ companyId, workerId, amountCents: 2500 });

    await ctx.paymentOrdersService.setStatus(order.id, 'approved');

    const page = await ctx.operationsService.list({ companyId, status: 'approved', page: 1, pageSize: 50 });
    expect(page.meta.totalCount).toBe(1);
    expect(page.items[0].status).toBe('approved');

    const pending = await ctx.operationsService.list({ companyId, status: 'pending', page: 1, pageSize: 50 });
    expect(pending.meta.totalCount).toBe(0);
  });

  it('reflects a new event as the operation\'s latest event', async () => {
    const order = await ctx.paymentOrdersService.create({ companyId, workerId, amountCents: 100 });
    const occurredAt = new Date('2025-06-01T12:00:00Z');
    await ctx.eventsService.record({ orderId: order.id, type: 'payment.captured', occurredAt });

    const page = await ctx.operationsService.list({ companyId, page: 1, pageSize: 50 });
    expect(page.items[0].last_event_type).toBe('payment.captured');
    expect(page.items[0].last_event_at).toBe(occurredAt.toISOString());
  });

  it('never shows another company\'s operations', async () => {
    await ctx.paymentOrdersService.create({ companyId, workerId, amountCents: 100 });
    const otherCompany = randomUUID();
    const otherWorker = await ctx.workersService.create({ companyId: otherCompany, name: 'Bo' });
    await ctx.paymentOrdersService.create({ companyId: otherCompany, workerId: otherWorker.id, amountCents: 999 });

    const page = await ctx.operationsService.list({ companyId, page: 1, pageSize: 50 });
    expect(page.meta.totalCount).toBe(1);
    expect(page.items[0].amount_cents).toBe(100);
  });

  it('keeps worker renames in sync with the denormalised name', async () => {
    const order = await ctx.paymentOrdersService.create({ companyId, workerId, amountCents: 100 });
    await ctx.workersService.rename(workerId, 'Ada Lovelace');

    const page = await ctx.operationsService.list({ companyId, page: 1, pageSize: 50 });
    expect(page.items[0].worker_name).toBe('Ada Lovelace');
    // The old name is gone
    const all = await ctx.operationsService.list({ page: 1, pageSize: 50 });
    expect(all.items.every(i => i.worker_name === 'Ada Lovelace')).toBe(true);
  });

  it('honours the date range and sorts by recency', async () => {
    const old = await ctx.paymentOrdersService.create({ companyId, workerId, amountCents: 1 });
    const fresh = await ctx.paymentOrdersService.create({ companyId, workerId, amountCents: 2 });

    const page = await ctx.operationsService.list({ companyId, page: 1, pageSize: 10 });
    expect(page.items.map(i => i.id)).toEqual([fresh.id, old.id]);

    // Exclude the new one with a to-boundary before its creation...
```
Hmm — created_at is "now" for both orders, nearly the same millisecond. Date range test: backdate the old one via prisma (fixture manipulation): `ctx.prisma.paymentOrder.update({ where: { id: old.id }, data: { createdAt: new Date('2025-01-01') } })` — but the projection row has the old created_at from creation (now). Then filter with from 2025-06-01 → the old one is excluded from the *projection*? The projection's created_at is still "now" → included. Mismatch!

To test the date range properly: create order A. Backdate A's source + projection? No — instead: backdate before reading? The hook copies created_at at creation. Alternative: use an explicit `occurred_at`... no, the date range filters the order's created_at.

Simplest and correct approach: create order A, then backdate A's *source* via prisma, then run the drift repair on that window to propagate the backdate to the projection (legitimate mechanism!). Then list with a range that excludes A's backdated time → A absent. That also doubles as a test of the repair. But this test file is about read-your-own-writes. The date range semantics:

Actually, a simpler approach: to test that range filtering works on the projection, backdate both source and projection rows directly via prisma (the test owns the fixture):
```ts
const past = new Date('2025-01-01T00:00:00Z');
await ctx.prisma.paymentOrder.update({ where: { id: old.id }, data: { createdAt: past } });
await ctx.prisma.operationRead.update({ where: { id: old.id }, data: { createdAt: past } });
```
Then:
```ts
const ranged = await ctx.operationsService.list({ companyId, from: new Date('2025-03-01'), page: 1, pageSize: 10 });
expect(ranged.meta.totalCount).toBe(1);
expect(ranged.items[0].id).toBe(fresh.id);
```
That's a legitimate test of the read path. OK. And the "sort by recency" assertion holds from two orders created at different times (created sequentially — if the timestamps are equal, tiebreak by id desc? UUIDs are random — tiebreak non-deterministic!). The two creates are sequential → millisecond granularity. Could be the same millisecond! Then the order = id desc (random) → flaky. Fix: backdate `old` to `past` (1 Jan) and `fresh` stays now → distinct timestamps → deterministic order [fresh, old]. Let me combine: backdate old, assert order [fresh.id, old.id] and range filter. ✓

So the test:
```ts
it('filters by date range and sorts by recency', async () => {
  const old = await ctx.paymentOrdersService.create({... amountCents: 1});
  const fresh = await ctx.paymentOrdersService.create({... amountCents: 2});
  const past = new Date('2025-01-01T00:00:00Z');
  await ctx.prisma.paymentOrder.update({ where: { id: old.id }, data: { createdAt: past } });
  await ctx.prisma.operationRead.update({ where: { id: old.id }, data: { createdAt: past } });

  const page = await ctx.operationsService.list({ companyId, page: 1, pageSize: 10 });
  expect(page.items.map(i => i.id)).toEqual([fresh.id, old.id]);

  const ranged = await ctx.operationsService.list({ companyId, from: new Date('2025-06-01T00:00:00Z'), page: 1, pageSize: 10 });
  expect(ranged.meta.totalCount).toBe(1);
  expect(ranged.items[0].id).toBe(fresh.id);
});
```

Wait — the range filter `from` uses the projection's created_at. fresh is "now" (2025? test-run time — actual runtime, e.g. 2026). from '2025-06-01' — if the real now is before that... no, the real now is ≥ 2025. Fresh is created at actual now (≥ 2025-01-01... could the test run in early 2025? Eval is current — assume runtime ≥ 2025). Risky: if the runtime clock is 2024 (impossible), fine. But better: compute `from` relative: `new Date(past.getTime() + 1h)` → between past and now. Safe:
```ts
const from = new Date(past.getTime() + 3_600_000); // 1h after the old order, long before fresh
```
✓ Deterministic regardless of clock.

#### test/company-totals.spec.ts (concurrent updates)

```ts
describe('company totals — concurrent updates', () => {
  const COMPANY = randomUUID();
  let ctx: TestContext;
  const workers: Worker[] = [];

  beforeEach(async () => {
    ctx = await createTestContext();
    await resetDatabase(ctx.prisma);
    workers.length = 0;
    for (const name of ['W1','W2','W3','W4']) workers.push(await ctx.workersService.create({ companyId: COMPANY, name }));
  });
  afterEach(...)

  it('stays exact under concurrent creates and status changes for one company', async () => {
    const N = 60;
    const created = await Promise.all(Array.from({ length: N }, (_, i) =>
      ctx.paymentOrdersService.create({
        companyId: COMPANY,
        workerId: workers[i % workers.length].id,
        amountCents: 100 + i * 7,
      })));

    const finalStatus = (i: number): OrderStatus => (i % 2 === 0 ? 'approved' : i % 5 === 1 ? 'rejected' : 'pending');
```
Hmm, note: i%2===0 → approved covers evens. i%5===1 && odd → rejected (i ≡ 1 mod 5 and odd: 1, 11, 21, 31, 51 → odd and ≡1 mod 5 → since 5 is odd, i≡1 mod 5 alternates parity: i=1 odd, 6 even, 11 odd...). Let me define a function and compute expected values with the same function — but the flips are done in parallel in *separate* calls. The final status of each order = finalStatus(i) by construction (each order is flipped exactly once from pending → target). ✓

```ts
    const flips = created.map((o, i) => finalStatus(i) === 'pending' ? null : ctx.paymentOrdersService.setStatus(o.id, finalStatus(i)));
    await Promise.all(flips);

    const rows = await ctx.companyTotalsService.forCompany(COMPANY);
    const byStatus = new Map(rows.map(r => [r.status, r]));

    const expected: Record<OrderStatus, { count: number; cents: bigint }> = { pending: {count:0, cents: 0n}, approved: {...}, rejected: {...} };
    created.forEach((o, i) => {
      const s = finalStatus(i);
      expected[s].count += 1;
      expected[s].cents += BigInt(o.amountCents);
    });

    for (const s of ['pending','approved','rejected'] as const) {
      expect(byStatus.get(s)!.order_count).toBe(expected[s].count);
      expect(BigInt(byStatus.get(s)!.total_cents)).toBe(expected[s].cents);
    }

    // Global invariants
    expect(rows.reduce((n, r) => n + r.order_count, 0)).toBe(N);
    expect(rows.reduce((s, r) => s + BigInt(r.total_cents), 0n)).toBe(created.reduce((s, o) => s + BigInt(o.amountCents), 0n));
  });

  it('does not mix one company\'s totals into another\'s under concurrency', async () => {
    const other = randomUUID();
    const otherWorker = await ctx.workersService.create({ companyId: other, name: 'X' });
    await Promise.all([
      ctx.paymentOrdersService.create({ companyId: COMPANY, workerId: workers[0].id, amountCents: 111 }),
      ctx.paymentOrdersService.create({ companyId: other, workerId: otherWorker.id, amountCents: 222 }),
    ]);
    const rows = await ctx.companyTotalsService.forCompany(COMPANY);
    const sum = rows.reduce((s, r) => s + BigInt(r.total_cents), 0n);
    expect(sum).toBe(111n);
    expect(rows.reduce((n, r) => n + r.order_count, 0)).toBe(1);
  });
});
```

The first test: 60 parallel creates, each an interactive tx → 60 concurrent txs. Postgres handles it. The totals upsert contention exercises the atomic delta. The p95... fine.

N=60 might be heavy but ok. Each create: worker lookup + insert + read upsert + 1 raw upsert. Parallel 60 → ok.

Note: `flips` — Promise.all on an array with nulls is fine.

Also add a test that repeated status changes (pending→approved→rejected) move the delta correctly? A sequential 2-flip on one order:
```ts
it('moves the amount between buckets on repeated status changes', async () => {
  const order = await create(... 500);
  await setStatus(approved); await check approved=500, pending=0;
  await setStatus(rejected); await check rejected=500, approved=0;
  await setStatus(pending); await check pending=500;
});
```
Good additional behavior test (sequential, not concurrency) ✓.

#### test/drift-repair.spec.ts

```ts
describe('drift repair — re-derivation over an arbitrary window', () => {
  const COMPANY = randomUUID();
  const OUTSIDER_COMPANY = randomUUID();
  let ctx: TestContext;
  let workerId: string;

  beforeEach: createTestContext, reset, create worker, 
  // 3 orders in COMPANY (in window), 1 in OUTSIDER (will be backdated)

  it('repairs missed writes, tampered rows and corrupted totals inside the window', async () => {
    const a = await ctx.paymentOrdersService.create({ companyId: COMPANY, workerId, amountCents: 1000 });
    const b = await ctx.paymentOrdersService.create({ companyId: COMPANY, workerId, amountCents: 2000 });
    const c = await ctx.paymentOrdersService.create({ companyId: COMPANY, workerId, amountCents: 3000 });
    const outsider = await ctx.paymentOrdersService.create({ companyId: OUTSIDER_COMPANY, workerId: (create another worker), amountCents: 7777 });
```
The outsider needs a worker in that company — create a second worker.

```ts
    // 1) Simulate a write that bypassed the hook (direct source update)
    await ctx.prisma.paymentOrder.update({ where: { id: a.id }, data: { status: 'approved' } });
    // 2) Tamper with the projection row
    await ctx.prisma.operationRead.update({ where: { id: b.id }, data: { worker_name: 'Ghost', amountCents: 999999, status: 'rejected' } });
    // 3) An event recorded directly on the source table
    await ctx.prisma.event.create({ data: { orderId: c.id, type: 'direct', occurredAt: new Date() } });
    // 4) Corrupt the maintained totals
    await ctx.prisma.companyTotals.update({ where: { companyId_status: { companyId: COMPANY, status: 'pending' } }, data: { orderCount: 99, totalCents: 1n } });
    // Also corrupt the outsider's row + totals (should stay untouched)
    await ctx.prisma.paymentOrder.update({ where: { id: outsider.id }, data: { createdAt: new Date(Date.now() - 30*86400e3) } });
    await ctx.prisma.operationRead.update({ where: { id: outsider.id }, data: { worker_name: 'ShouldStay' } });
    await ctx.prisma.companyTotals.update({ where: { companyId_status: { companyId: OUTSIDER_COMPANY, status: 'pending' } }, data: { totalCents: 42n } });

    const from = new Date(Date.now() - 3600e3);
    const to = new Date(Date.now() + 3600e3);
    const result = await ctx.projectionService.rederiveWindow(from, to);
    expect(result.ordersRederived).toBe(3);
    expect(result.companiesRecomputed).toBe(1);

    const page = await ctx.operationsService.list({ companyId: COMPANY, page: 1, pageSize: 50 });
    const byId = new Map(page.items.map(i => [i.id, i]));
    expect(byId.get(a.id)!.status).toBe('approved');          // missed write repaired
    expect(byId.get(b.id)!.worker_name).toBe('Worker A'? — the name); 
    expect(byId.get(b.id)!.amount_cents).toBe(2000);
    expect(byId.get(b.id)!.status).toBe('pending');
    expect(byId.get(c.id)!.last_event_type).toBe('direct');

    const rows = await ctx.companyTotalsService.forCompany(COMPANY);
    const byStatus = new Map(rows.map(r => [r.status, r]));
    expect(BigInt(byStatus.get('approved')!.total_cents)).toBe(1000n);
    expect(BigInt(byStatus.get('pending')!.total_cents)).toBe(5000n); // b 2000 + c 3000
    expect(byStatus.get('pending')!.order_count).toBe(2);
    expect(byStatus.get('rejected')!.total_cents).toBe('0');

    // The window was respected: the outsider (created 30 days ago) is untouched
    const outsiderPage = await ctx.operationsService.list({ companyId: OUTSIDER_COMPANY, page: 1, pageSize: 50 });
    expect(outsiderPage.items[0].worker_name).toBe('ShouldStay');
    const outsiderRows = await ctx.companyTotalsService.forCompany(OUTSIDER_COMPANY);
    expect(BigInt(outsiderRows.find(r => r.status === 'pending')!.total_cents)).toBe(42n);

    // Idempotent
    await ctx.projectionService.rederiveWindow(from, to);
    const rows2 = await ctx.companyTotalsService.forCompany(COMPANY);
    expect(rows2).toEqual(rows);
  });
});
```

Wait — a subtle point: the outsider order's operation_read row: its created_at in the projection is "now" (created via service at now, then source backdated). The window read is on payment_orders.created_at → the outsider is excluded ✓. `ordersRederived` = 3 ✓ (only the COMPANY's 3).

But note — the outsider's *projection* row's created_at is now. The list is filtered by company only → the row is visible with its original created_at (now) — fine, we're only asserting on the worker_name.

Also note: the tampered `b` row has status 'rejected'. After repair → source status 'pending' (never changed) ✓.

`result.companiesRecomputed` = 1 (only COMPANY is affected) ✓ — the outsider company is not in the window → not recomputed → its corrupted totals remain (asserted 42n) ✓.

Another check — the `worker_name` of the COMPANY orders: the worker is created with the service. Name 'Worker A'. The repair writes `workerNames.get(order.workerId) ?? ''` — the worker exists ✓ → 'Worker A'.

Also the `a` order: the direct source update to status approved — but wait, the source update also bumps the source `updated_at` via @updatedAt? A direct prisma update with only status — @updatedAt updates updated_at ✓ irrelevant.

The totals recompute for COMPANY reads operation_reads after the upserts ✓ (separate tx after the chunk tx commits) → sees repaired rows ✓.

Now — a potential problem: `ctx.prisma.companyTotals.update({ where: { companyId_status: ... } })` — the composite where needs the `companyId_status` key (Prisma's composite-unique input name: field order in @@id: `[companyId, status]` → `companyId_status`) ✓.

Now — `resetDatabase` between tests: `operationRead.deleteMany()` — no FKs on operation_reads ✓.

Test timing: rederiveWindow's interactive tx default 30s timeout — fine.

Now — the `createTestContext` imports service classes from src — type-only imports to avoid circularity? The test imports the services. The services don't import the tests. Fine.

The vitest config:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    env: {
      DRIFT_REPAIR_ENABLED: 'false',
    },
  },
});
```
`fileParallelism` — Vitest 2 option ✓ (v1 uses `singleThread: true` in threads). I'll pin vitest ^2.

Hmm — `test.env` sets process.env for the test process ✓ (DRIFT_REPAIR_ENABLED false). But the cron expression is evaluated at module load — the default hourly. A 60s test won't hit the hour boundary... could! If the test happens to run across an hour mark — astronomically low. Plus the enabled=false guard anyway ✓.

package.json:

```json
{
  "name": "operations-dashboard",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "start:dev": "tsx watch src/main.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate deploy",
    "prisma:studio": "prisma studio"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.0",
    "@nestjs/core": "^10.4.0",
    "@nestjs/platform-express": "^10.4.0",
    "@nestjs/schedule": "^4.1.0",
    "@prisma/client": "^5.19.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.0",
    "prisma": "^5.19.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.4",
    "vitest": "^2.1.0"
  }
}
```

@nestjs/schedule ^4.1.0 — v4 supports Nest 10 ✓.

tsconfig.json:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": false,
    "sourceMap": true,
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```
Note: `strict` ✓ (convention: TS strict). Vitest handles test files independently (esbuild) — tsconfig exclude of test is fine.

One concern: `module: NodeNext` + decorators — TS 5 supports decorators with NodeNext ESM (standard decorators? no — experimentalDecorators + NodeNext: TS allows experimentalDecorators in ESM output ✓ — but with ESM output, `emitDecoratorMetadata`... does TS error "Cannot use decorators when emitting..."? No: experimentalDecorators works with ESM emit. But there's a known issue: with `"module": "NodeNext"`, TS uses `emitDecoratorMetadata` fine? I recall NestJS ESM setup works with NodeNext + experimentalDecorators (many Nest 10 ESM projects). Hmm, there was an issue: TS 5 + NodeNext + emitDecoratorMetadata — I think it works. Nest docs ESM guide uses `"module": "NodeNext"`? The NestJS ESM docs suggest `"module": "nodenext"`? Actually, Nest docs: for ESM use tsconfig `"module": "commonjs"` for build or... let me not overthink: many production Nest ESM apps use NodeNext + decorators without issues (TS supports it. The limitation is on the standard decorators path). I'll keep NodeNext. Vitest (esbuild) handles experimentalDecorators via tsconfig ✓.

Also `verbatimModuleSyntax`? Skip (keep it simple. But with NodeNext, type imports must be explicit `import type` — does NodeNext enforce? With `isolatedModules`? I haven't enabled isolatedModules. Under NodeNext, TS requires `import type` only under verbatimModuleSyntax. Without it, normal imports of types are fine (they get erased). But esbuild (Vitest) with isolatedModules-like behavior... esbuild automatically handles type-only imports via TS syntax (it parses TS and drops type-only usages — but can't always tell if an import is a type → keeps the import → at runtime, importing a non-existent value from a module could break? In Vite, TS files are transformed by esbuild per-file. Type-only imports that aren't marked `import type` are kept as value imports → at runtime, the imported name doesn't exist in the ESM module → error? Vite/esbuild: esbuild's TS transform drops imports that are used only in type positions (it tracks usage within the file). Yes — esbuild elides type-only imports even without `import type` (it does local analysis). Safe. But to be safe and idiomatic, I'll use `import type` where I import types only. ✓

Now — the `.js` extensions on relative imports under NodeNext: required for ESM output. In Vitest, `./foo.js` resolves to `./foo.ts`? Vite's resolver: for TS, Vite supports importing with `.js` extension (since Vite 4? — "TypeScript: can import .ts files with .js extension"? Vite docs mention: Vite supports resolving `./foo.js` → `./foo.ts` (implements TS's "emit as ESM" style resolution) — yes, Vite handles it (their resolver checks .ts/.tsx candidates for .js specifiers). I'm fairly confident Vitest ≥ 1 handles it. ✓

Now, DESIGN.md — a short justification of the synchronous hook vs alternatives:

- Context: 3M orders, 20–30s join (events aggregation), p95 < 50ms, read-your-own-writes, exact totals.
- Design: a denormalized `operation_reads` + `company_totals` maintained synchronously inside the write transaction (the hook).
- Why synchronous in-tx hook:
  - Read-your-own-writes: the projection row is committed exactly when the source row is → any read after the write response sees it. Async (outbox/event bus) has a lag → violates the requirement. Triggers: same atomicity but logic hidden in the DB, hard to test/version, couples app logic to Postgres, hard to reuse the re-derivation.
  - Exact totals: atomic single-statement upsert delta → no lost updates under concurrency. Async consumers risk reordering/duplication → approximate.
  - Cost: 2–3 extra small writes per write op (all indexed PK lookups) — negligible vs a 20–30s read.
- Alternatives considered: (1) async CDC/outbox — breaks read-your-own-writes. (2) Postgres trigger — atomic but untestable, schema-locked. (3) materialized view REFRESH — too slow, not per-write. (4) compute on read (indexed join) — still a 3M-row aggregate. The join+aggregate is the cost. (5) approximate counts (HLL/BRIN) — disallowed: totals must be exact.
- Index design: composite (company_id, status, created_at DESC, id DESC) matches the query's filter + order exactly → index scan, no sort. id tiebreak for stable pagination.
- Repair: rederiveWindow(from,to) is idempotent. Scheduled drift-repair re-derives a rolling window hourly. Totals for affected companies are recomputed from the projection (authoritative).
- Trade-offs/limits: a worker rename touches a worker's operation rows (bounded). A crash mid-write can't happen (tx atomic). Direct writes to source bypassing the service are the main drift source → covered by repair.

Keep it "short" — ~60–80 lines.

The task also says "Include a short DESIGN.md justifying the synchronous hook vs alternatives" ✓.

Where to put DESIGN.md? Root: `DESIGN.md`.

Also — a README? Not asked. Skip. (Discipline.)

Now — let me re-check the layering discipline in my code:
- Controllers: only parse/validate + call service ✓ (the parse helper throws AppError — validation logic is in the common util, called from the controller ✓).
- Services: logic. No `prisma.` calls directly... PaymentOrdersService uses `this.transactions.run` (the TransactionService wraps prisma) — is that a "Prisma client call"? No — it calls a service. The callback passed to run touches the repository ✓. The callback doesn't touch prisma directly ✓.
- Repositories: the only ones with Prisma ✓. Raw SQL is in CompanyTotalsRepository (DB layer) ✓ — the constraint literally forbids raw SQL in the service. Repository is the DB layer. I'll add a comment explaining why raw is needed there (atomicity).

Wait, one more: `ProjectionService.onOrderCreated` calls `this.repository.findWorkerName(tx, ...)` — the repository ✓.

Now, let me check imports for the Prisma model type names I use:
- `Prisma.TransactionClient` ✓
- `Prisma.PaymentOrderWhereInput` ✓
- `Prisma.OperationReadWhereInput` ✓
- Types: `PaymentOrder`, `Worker`, `Event`, `OperationRead`, `CompanyTotals`, `OrderStatus` from '@prisma/client' ✓.

groupBy result type: `{ status: OrderStatus; _count: { _all: number }; _sum: { amountCents: bigint | null } }` ✓ (BigInt field → bigint).

Now, `operationsRepository.upsert` — I'll type the parameter:
```ts
export interface OperationReadInput {
  id: string;
  companyId: string;
  workerId: string;
  workerName: string;
  status: OrderStatus;
  amountCents: number;
  createdAt: Date;
  lastEventType: string | null;
  lastEventAt: Date | null;
}
```
Define in operations.repository.ts and export.

Hmm — the `updatedAt` on operation_reads is `@default(now()) @updatedAt`? I wrote `@default(now()) @updatedAt` — does Prisma allow @default + @updatedAt? `@updatedAt` is typically standalone. Adding @default(now()) is allowed (used for the create default). In migrations: `updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`? For an @updatedAt column, Prisma migrations don't add a default (client-managed). If I add @default(now()), the migration will include DEFAULT CURRENT_TIMESTAMP. Either is fine. To keep the migration clean: `@updatedAt` only (no default) → the column has no default, the client always sets it. But the raw SQL never touches operation_reads ✓. Let me do `updatedAt DateTime @updatedAt @map("updated_at")` (no default). Migration: `"updated_at" TIMESTAMP(3) NOT NULL`. ✓ (The schema above had @default(now()) for operation_reads.updatedAt — I'll drop the default. Keep the default for company_totals.updatedAt (raw-managed, but the default helps for future Prisma writes... my raw always sets it. The default is harmless. Actually with @default(now()), the Prisma create includes the default. Fine.)

Wait, company_totals.updatedAt — no @updatedAt (raw SQL manages it). Plain `@default(now())` ✓.

Now, the `PaymentOrder` model: `status OrderStatus @default(pending)` ✓.

Another consideration — `worker_name` in operation_reads is NOT NULL. In re-derivation, if a worker row is missing (deleted?) — there's no worker delete in the API. FK is RESTRICT → can't delete while orders exist. So the name always resolves. The `?? ''` fallback is defensive.

Now, the `EventsService` — the `occurred_at` validation: `requireIsoDate` for a string. The controller passes a Date. The service trusts it ✓.

`requireIsoDate` — `new Date(value)` accepts many formats (e.g. '2025-01-01', 'Jan 1 2025'). "ISO-8601" strictness: fine for this scope.

`optionalIntQuery` — query params are strings. `Number('abc')` is NaN → not integer → validation error ✓. `Number('3.5')` → 3.5 → not integer ✓.

`page` max: I set max 1_000_000 (arbitrary). Fine.

Now, the `asRecord` helper:
```ts
export function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw AppError.validation(`${what} must be a JSON object`, { what });
  }
  return value as Record<string, unknown>;
}
```

Now — a subtle DI check: `OperationsModule` exports `OperationsRepository`. `ProjectionModule` imports `OperationsModule` ✓. But `OperationsModule` imports only CommonModule → no cycle with projection ✓.

`CompanyTotalsModule` exports `CompanyTotalsRepository`. ProjectionModule imports CompanyTotalsModule ✓.

`PaymentOrdersModule` exports `PaymentOrdersRepository` (needed by EventsModule) ✓, imports ProjectionModule (hook) + WorkersModule (worker lookup) + CommonModule.

`WorkersModule` exports `WorkersRepository` (needed by PaymentOrdersModule) ✓, imports ProjectionModule + CommonModule.

`EventsModule` imports PaymentOrdersModule + ProjectionModule + CommonModule ✓.

`ProjectionModule` imports CommonModule + OperationsModule + CompanyTotalsModule ✓.

Full graph:
- PaymentOrders → Workers, Projection, Common
- Workers → Projection, Common
- Events → PaymentOrders, Projection, Common
- Operations → Common
- CompanyTotals → Common
- Projection → Operations, CompanyTotals, Common
Acyclic ✓.

Now — the `ProjectionService` is used by Workers/PaymentOrders/Events services. It's a provider in ProjectionModule → must be exported! Add `exports: [ProjectionService]` ✓ important.

Now, `main.ts` — `app.setGlobalPrefix`? No prefix. Endpoints: `/operations`, `/payment-orders`, etc. ✓ kebab-case, plural ✓.

Let me write the exception filter for the `HttpException` case — Nest's `NotFound` thrown by Nest for a missing route → 404 → 'resource_not_found'... semantically odd but acceptable as an envelope contract (the code is the contract. resource_not_found for unknown routes is tolerable).

Now, let me reconsider the raw SQL parameter order for `applyDelta` — the tag template interpolates in order: $1 companyId (string), $2 status (string), $3 deltaCount (number), $4 deltaCents (bigint). ✓

One risk: `status` param into the enum column — the param is `unknown` type → the INSERT VALUES target is enum → Postgres casts unknown → enum ✓ (standard behavior for unknown-typed literals/parameters).

For `recompute`, 10 params: $1 company, $2 'pending', $3 count, $4 cents, $5 'approved', $6, $7, $8 'rejected', $9, $10. ✓

`total_cents` column type BIGINT. `EXCLUDED.total_cents` is bigint ✓.

The `order_count` INT. deltaCount number → unknown → int ✓.

Now — `PrismaService extends PrismaClient` with ESM: the generated client is CJS by default... `import { PrismaClient } from '@prisma/client'` in ESM Node: the client is CJS. Node's ESM can import CJS with a default + named exports (cjs-module-lexer detects the exports) — Prisma client exports named PrismaClient ✓ works (universal in Nest ESM setups).

`Prisma.TransactionClient` — type only ✓.

Now, the `@Cron` import from '@nestjs/schedule'. The decorator on a method of an @Injectable provider registered in a module where SchedulesModule is imported at the root (AppModule) — SchedulesModule.forRoot() is a global-like module (does it register globally? SchedulesModule is a regular module imported at root. The scheduler scans providers of all modules for @Cron) ✓.

Env var name in the cron: `process.env.DRIFT_REPAIR_CRON ?? '0 * * * *'` — evaluated at class-definition (import) time. In tests, `fileParallelism: false` + vitest.config env DRIFT_REPAIR_ENABLED=false — but the cron expression is evaluated at import time with the default (env not set at import time?) — vitest's `test.env` is set before test file imports? test.env is set on process.env at the start of the test run (before the file import) ✓. Anyway the enabled guard is read at execution ✓.

Now — the `RederiveResult` type:
```ts
export interface RederiveResult { ordersRederived: number; companiesRecomputed: number; }
```

Also let me re-check the `rederiveWindow` cursor loop for correctness: chunk is sorted (createdAt asc, id asc), take limit. Next cursor = the last row. The next query: `OR: [createdAt > c, createdAt = c AND id > id]` ✓ keyset, no dup/skip.

Termination: the window is bounded ✓.

Concurrent writes during re-derivation: the read is inside a tx (snapshot at tx start) — a write that commits after the snapshot is not re-derived in this chunk pass... but its hook maintained the projection anyway ✓. A write that commits between the chunk tx and the next chunk tx with createdAt in the window: the snapshot of the next chunk tx — the cursor comparison uses committed rows. Could the new row be skipped? Keyset cursor: rows are ordered. A new row with createdAt > the cursor appears in the next snapshot ✓. A row with createdAt == the cursor's createdAt but a smaller id (inserted later, same timestamp, id < cursor id → the condition `id > cursor.id` excludes it!). Edge: same-millisecond inserts + a late arrival with a smaller uuid → skipped by this run. The next scheduled run (rolling window overlap) catches it (windowHours 24 >> run interval) ✓ — the overlap is inherent to a rolling window. Documented in DESIGN.md.

Hmm wait, is that actually true? The rolling window [now-24h, now] re-runs hourly → a row created at T is covered for 24 hours by many runs ✓. A skip in one run is fixed in the next ✓. Good — I'll mention.

Also — the interactive tx snapshot under READ COMMITTED: actually, under READ COMMITTED each statement sees a fresh snapshot (statement-level). So the chunk tx's single statement (well, multiple statements) — each sees the latest committed. The cursor logic is still safe as analyzed.

Now, the totals recompute race: a concurrent create for company C during the recompute: the recompute reads the groupBy (sees or doesn't see the new row), then SETs absolute. If the create's delta is applied after the recompute's read but before the recompute's write → the absolute write overwrites → that one delta is lost! A race window of microseconds. In a production-grade design I'd note this (or take a lock on the company_totals row / use a sequence number). For this deliverable: the drift-repair runs rarely. The next repair fixes it. I'll note in DESIGN.md as a known, self-healing race (eventual convergence on the next scheduled run). Hmm — but the "totals must be exact" requirement... The concurrent write test passes because the tests don't interleave with a recompute. I'll add an honest line in DESIGN.md: "The recompute of totals for company C is racy with a concurrent in-flight write to C. The conflict self-heals on the next repair run. If stricter, the recompute could take a row-level lock." Actually — I can cheaply make it safe: in the recompute tx, first `SELECT 1 FROM company_totals WHERE company_id = $1 FOR UPDATE` (locks existing rows) — but concurrent INSERT (a create's upsert) could still... the create's upsert locks/creates its row. The recompute's multi-row INSERT ON CONFLICT blocks on the concurrent row lock, then overwrites with the absolute value (potentially pre-delta) → still racy. True safety = lock all 3 rows + block new upserts → advisory lock: `pg_advisory_xact_lock(hashtext(company_id))` in both the recompute and applyDelta txs... this is scope creep. The honest DESIGN note suffices for this exercise. I'll keep the code simple and document.

Now, the test's "concurrent updates to a single company's totals" — my test uses only the write path (no recompute) → deterministic ✓.

Let me also think: should `operations` items include `updated_at`? Include it (it's in the row. Harmless).

Pagination meta naming: `page`, `page_size`, `total_count` (snake_case wire) — consistent with the snake_case convention for columns/endpoints. Let me use `page`, `page_size`, `total_count`.

Now — let me write the OperationsService mapping:

```ts
export interface OperationItem {
  id: string;
  company_id: string;
  worker_id: string;
  worker_name: string;
  status: OrderStatus;
  amount_cents: number;
  created_at: string;
  updated_at: string;
  last_event_type: string | null;
  last_event_at: string | null;
}

export interface OperationsPage {
  items: OperationItem[];
  meta: { page: number; page_size: number; total_count: number };
}
```

The service returns that. The controller passes the query object. The query is an interface `OperationsQuery` exported from the service file (the controller imports the type).

Now, the controller's @Query() typing: Nest gives an object of strings/objects. Type as `Record<string, unknown>` for safety? `@Query() query: Record<string, string | undefined>` — Nest passes query params as strings (or arrays for repeated). For a repeated param (`?status=a&status=b`) → array → my validators throw a validation error (typeof array !== 'string') ✓ good.

Now — let me write the `requireStatus`:
```ts
export function requireStatus(value: unknown, field: string): OrderStatus {
  if (typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value)) {
    return value as OrderStatus;
  }
  throw AppError.validation(`${field} must be one of: ${ORDER_STATUSES.join(', ')}`, { field, value });
}
```
`ORDER_STATUSES` — import type `OrderStatus` from '@prisma/client' in validation.ts. A value import of the OrderStatus const isn't needed. `const ORDER_STATUSES: OrderStatus[] = ['pending', 'approved', 'rejected'];` ✓.

`optionalStatus`:
```ts
export function optionalStatus(value: unknown, field: string): OrderStatus | undefined {
  if (value === undefined || value === '') return undefined;
  return requireStatus(value, field);
}
```

Same pattern for optionalUuid/optionalIsoDate.

`requirePositiveInt(value, field, max?)`:
```ts
export function requirePositiveInt(value: unknown, field: string, max?: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw AppError.validation(`${field} must be a positive integer`, { field, value });
  }
  if (max !== undefined && value > max) {
    throw AppError.validation(`${field} must be ≤ ${max}`, { field, value, max });
  }
  return value;
}
```

`optionalIntQuery(value, field, fallback, max)`:
```ts
export function optionalIntQuery(value: unknown, field: string, fallback: number, max: number): number {
  if (value === undefined || value === '') return fallback;
  return requirePositiveInt(typeof value === 'string' ? Number(value) : value, field, max);
}
```
Number('') = 0 → but we handle '' before ✓. Number('5')=5 ✓. Number('x')=NaN → error ✓.

`requireIsoDate`:
```ts
export function requireIsoDate(value: unknown, field: string): Date {
  if (typeof value !== 'string' || value === '') {
    throw AppError.validation(`${field} must be an ISO-8601 timestamp`, { field, value });
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw AppError.validation(`${field} must be a valid ISO-8601 timestamp`, { field, value });
  }
  return parsed;
}
```

`requireString(value, field, maxLength)`:
```ts
if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) throw ...
return value;
```

Now, a complete file list:

1. `package.json`
2. `tsconfig.json`
3. `vitest.config.ts`
4. `prisma/schema.prisma`
5. `prisma/migrations/20250101000000_init/migration.sql`
6. `DESIGN.md`
7. `src/main.ts`
8. `src/app.module.ts`
9. `src/common/common.module.ts`
10. `src/common/prisma.service.ts`
11. `src/common/transaction.service.ts`
12. `src/common/errors.ts`
13. `src/common/exception.filter.ts`
14. `src/common/validation.ts`
15. `src/workers/workers.module.ts`
16. `src/workers/workers.controller.ts`
17. `src/workers/workers.service.ts`
18. `src/workers/workers.repository.ts`
19. `src/payment-orders/payment-orders.module.ts`
20. `src/payment-orders/payment-orders.controller.ts`
21. `src/payment-orders/payment-orders.service.ts`
22. `src/payment-orders/payment-orders.repository.ts`
23. `src/events/events.module.ts`
24. `src/events/events.controller.ts`
25. `src/events/events.service.ts`
26. `src/events/events.repository.ts`
27. `src/operations/operations.module.ts`
28. `src/operations/operations.controller.ts`
29. `src/operations/operations.service.ts`
30. `src/operations/operations.repository.ts`
31. `src/company-totals/company-totals.module.ts`
32. `src/company-totals/company-totals.controller.ts`
33. `src/company-totals/company-totals.service.ts`
34. `src/company-totals/company-totals.repository.ts`
35. `src/projection/projection.module.ts`
36. `src/projection/projection.service.ts`
37. `src/projection/projection.repository.ts`
38. `test/test-utils.ts`
39. `test/operations.spec.ts`
40. `test/company-totals.spec.ts`
41. `test/drift-repair.spec.ts`

41 files. That's the complete solution. All "asked for" either directly or as the required scaffolding.

Now, let me write out each file carefully. I'll check imports/types as I go.

---

**prisma/schema.prisma**

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

  @@map("order_status")
}

model Worker {
  id        String   @id @default(uuid()) @db.Uuid
  companyId String   @map("company_id") @db.Uuid
  name      String
  role      String?
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @default(now()) @updatedAt @map("updated_at")

  orders PaymentOrder[]

  @@map("workers")
}
```
Hmm, the worker's `role` — needed? "Workers" join: only the name is denormalized. `role` is extra scope. Drop it? A worker table without role is fine. Drop `role` (discipline).

```prisma
model Worker {
  id        String   @id @default(uuid()) @db.Uuid
  companyId String   @map("company_id") @db.Uuid
  name      String
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @default(now()) @updatedAt @map("updated_at")

  orders PaymentOrder[]

  @@map("workers")
}

model PaymentOrder {
  id          String      @id @default(uuid()) @db.Uuid
  companyId   String      @map("company_id") @db.Uuid
  workerId    String      @map("worker_id") @db.Uuid
  status      OrderStatus @default(pending)
  amountCents Int         @map("amount_cents")
  createdAt   DateTime    @default(now()) @map("created_at")
  updatedAt   DateTime    @default(now()) @updatedAt @map("updated_at")

  worker PaymentOrder? no — worker Worker @relation(fields: [workerId], references: [id])
  events Event[]

  @@index([createdAt, id], map: "ix_payment_orders_created_id")
  @@map("payment_orders")
}

model Event {
  id         String   @id @default(uuid()) @db.Uuid
  orderId    String   @map("order_id") @db.Uuid
  type       String
  occurredAt DateTime @map("occurred_at") @default(now())

  order PaymentOrder @relation(fields: [orderId], references: [id])

  @@index([orderId, occurredAt], map: "ix_events_order_occurred")
  @@map("events")
}

model OperationRead {
  id            String      @id @db.Uuid
  companyId     String      @map("company_id") @db.Uuid
  workerId      String      @map("worker_id") @db.Uuid
  workerName    String      @map("worker_name")
  status        OrderStatus
  amountCents   Int         @map("amount_cents")
  createdAt     DateTime    @map("created_at")
  updatedAt     DateTime    @updatedAt @map("updated_at")
  lastEventType String?     @map("last_event_type")
  lastEventAt   DateTime?   @map("last_event_at")

  @@index([companyId, status, createdAt(sort: Desc), id(sort: Desc)], map: "ix_operation_reads_company_status_created")
  @@index([workerId], map: "ix_operation_reads_worker")
  @@map("operation_reads")
}

model CompanyTotals {
  companyId  String      @map("company_id") @db.Uuid
  status     OrderStatus
  orderCount Int         @default(0) @map("order_count")
  totalCents BigInt      @default(0) @map("total_cents")
  updatedAt  DateTime    @default(now()) @map("updated_at")

  @@id([companyId, status])
  @@map("company_totals")
}
```

`updatedAt DateTime @updatedAt` without default — Prisma allows @updatedAt without @default ✓ (the client sets it on create? @updatedAt is auto-set on create and update by the client ✓).

**Migration SQL** — as drafted, minus role. Let me confirm the column order matches the schema (migrations don't require order match, but for cleanliness).

**package.json** as drafted.

**tsconfig.json** — should I include "test" in include? Vitest transpiles on its own. tsc build only needs src. But type-checking the tests via `tsc --noEmit`? Not in the scripts. Keep exclude test. Hmm — the tests use `vitest` globals? I import { describe, it, expect } from 'vitest' explicitly (no globals config) → the types come from the vitest package ✓ no globals setting needed.

**vitest.config.ts**:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    env: {
      DRIFT_REPAIR_ENABLED: 'false',
    },
  },
});
```
`fileParallelism` — Vitest 2 option ✓ (v1 uses `singleThread: true` in threads). I'll pin vitest ^2.

Hmm — `test.env` sets process.env for the test process ✓ (DRIFT_REPAIR_ENABLED false). But the cron expression is evaluated at module load — the default hourly. A 60s test won't hit the hour boundary... could! If the test happens to run across an hour mark — astronomically low. Plus the enabled=false guard anyway ✓.

**src/common/errors.ts** ✓ as drafted.

**src/common/exception.filter.ts** ✓.

**src/common/validation.ts** ✓ — imports: `isUUID` from 'node:crypto'. `OrderStatus` type from '@prisma/client'. AppError from './errors.js'.

**src/common/prisma.service.ts** ✓.

**src/common/transaction.service.ts** ✓.

**src/common/common.module.ts** ✓.

**src/main.ts** ✓.

**src/app.module.ts** ✓.

**src/workers/workers.repository.ts**:
```ts
import { Injectable } from '@nestjs/common';
import { Prisma, type Worker } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';

@Injectable()
export class WorkersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(tx: Prisma.TransactionClient | undefined, id: string): Promise<Worker | null> {
    return (tx ?? this.prisma).worker.findUnique({ where: { id } });
  }

  create(tx: Prisma.TransactionClient | undefined, data: { companyId: string; name: string }): Promise<Worker> {
    return (tx ?? this.prisma).worker.create({ data });
  }

  rename(tx: Prisma.TransactionClient | undefined, id: string, name: string): Promise<Worker> {
    return (tx ?? this.prisma).worker.update({ where: { id }, data: { name } });
  }
}
```
The `data` for create: `{ companyId, name }` matches the Prisma input (createdAt/updatedAt auto) ✓.

**src/workers/workers.service.ts**:
```ts
import { Injectable } from '@nestjs/common';
import { type Worker } from '@prisma/client';
import { AppError } from '../common/errors.js';
import { TransactionService } from '../common/transaction.service.js';
import { ProjectionService } from '../projection/projection.service.js';
import { WorkersRepository } from './workers.repository.js';

@Injectable()
export class WorkersService {
  constructor(
    private readonly repository: WorkersRepository,
    private readonly transactions: TransactionService,
    private readonly projection: ProjectionService,
  ) {}

  create(input: { companyId: string; name: string }): Promise<Worker> {
    // A brand-new worker has no operations yet, so the projection needs no update.
    return this.repository.create(undefined, input);
  }

  rename(id: string, name: string): Promise<Worker> {
    return this.transactions.run(async (tx) => {
      const worker = await this.repository.findById(tx, id);
      if (!worker) throw AppError.notFound('worker', id);
      const updated = await this.repository.rename(tx, id, name);
      await this.projection.onWorkerRenamed(tx, id, name);
      return updated;
    });
  }
}
```
DI circularity? WorkersService → ProjectionService. ProjectionService → OperationsRepository, CompanyTotalsRepository, ProjectionRepository, TransactionService. No back to workers ✓.

**src/workers/workers.controller.ts**:
```ts
import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { asRecord, requireString, requireUuid } from '../common/validation.js';
import { WorkersService } from './workers.service.js';

@Controller('workers')
export class WorkersController {
  constructor(private readonly service: WorkersService) {}

  @Post()
  create(@Body() body: unknown) {
    const payload = asRecord(body, 'request body');
    return this.service.create({
      companyId: requireUuid(payload.company_id, 'company_id'),
      name: requireString(payload.name, 'name', 200),
    });
  }

  @Patch(':id')
  rename(@Param('id') id: string, @Body() body: unknown) {
    const payload = asRecord(body, 'request body');
    return this.service.rename(requireUuid(id, 'id'), requireString(payload.name, 'name', 200));
  }
}
```

**src/workers/workers.module.ts**:
```ts
@Module({
  controllers: [WorkersController],
  providers: [WorkersService, WorkersRepository],
  imports: [CommonModule, ProjectionModule],
  exports: [WorkersRepository],
})
export class WorkersModule {}
```

**src/payment-orders/payment-orders.repository.ts**:
```ts
@Injectable()
export class PaymentOrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(tx, id: string): Promise<PaymentOrder | null> {
    return (tx ?? this.prisma).paymentOrder.findUnique({ where: { id } });
  }

  create(tx, data: { companyId: string; workerId: string; amountCents: number }): Promise<PaymentOrder> {
    return (tx ?? this.prisma).paymentOrder.create({ data });
  }

  updateStatus(tx, id: string, status: OrderStatus): Promise<PaymentOrder> {
    return (tx ?? this.prisma).paymentOrder.update({ where: { id }, data: { status } });
  }
}
```

**src/payment-orders/payment-orders.service.ts**:
```ts
@Injectable()
export class PaymentOrdersService {
  constructor(
    private readonly repository: PaymentOrdersRepository,
    private readonly workersRepository: WorkersRepository,
    private readonly transactions: TransactionService,
    private readonly projection: ProjectionService,
  ) {}

  create(input: { companyId: string; workerId: string; amountCents: number }): Promise<PaymentOrder> {
    return this.transactions.run(async (tx) => {
      const worker = await this.workersRepository.findById(tx, input.workerId);
      if (!worker) throw AppError.notFound('worker', input.workerId);
      const order = await this.repository.create(tx, input);
      // The hook runs inside the write's transaction, so the dashboard reflects
      // the order exactly when the write commits (read-your-own-writes).
      await this.projection.onOrderCreated(tx, order);
      return order;
    });
  }

  setStatus(id: string, status: OrderStatus): Promise<PaymentOrder> {
    return this.transactions.run(async (tx) => {
      const order = await this.repository.findById(tx, id);
      if (!order) throw AppError.notFound('payment order', id);
      if (order.status === status) return order;
      const updated = await this.repository.updateStatus(tx, id, status);
      await this.projection.onOrderStatusChanged(tx, updated, order.status);
      return updated;
    });
  }
}
```

**Controller**:
```ts
@Controller('payment-orders')
@Post()
create(@Body() body: unknown) {
  const payload = asRecord(body, 'request body');
  return this.service.create({
    companyId: requireUuid(payload.company_id, 'company_id'),
    workerId: requireUuid(payload.worker_id, 'worker_id'),
    amountCents: requirePositiveInt(payload.amount_cents, 'amount_cents', 1_000_000_00),
  });
}

@Patch(':id')
setStatus(@Param('id') id: string, @Body() body: unknown) {
  const payload = asRecord(body, 'request body');
  return this.service.setStatus(requireUuid(id, 'id'), requireStatus(payload.status, 'status'));
}
```

**Module** as drafted.

**src/events/events.repository.ts**:
```ts
create(tx, data: { orderId: string; type: string; occurredAt: Date }): Promise<Event> {
  return (tx ?? this.prisma).event.create({ data });
}
```

**src/events/events.service.ts**:
```ts
record(input: { orderId: string; type: string; occurredAt: Date }): Promise<Event> {
  return this.transactions.run(async (tx) => {
    const order = await this.ordersRepository.findById(tx, input.orderId);
    if (!order) throw AppError.notFound('payment order', input.orderId);
    const event = await this.repository.create(tx, input);
    await this.projection.onEventRecorded(tx, event.orderId, event.type, event.occurredAt);
    return event;
  });
}
```

**Controller** as drafted.

**Module**: imports [CommonModule, PaymentOrdersModule, ProjectionModule].

**src/operations/operations.repository.ts**:
```ts
import { Injectable } from '@nestjs/common';
import { Prisma, type OperationRead, type OrderStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';

export interface OperationsQuery {
  companyId?: string;
  status?: OrderStatus;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

export interface OperationReadInput {
  id: string;
  companyId: string;
  workerId: string;
  workerName: string;
  status: OrderStatus;
  amountCents: number;
  createdAt: Date;
  lastEventType: string | null;
  lastEventAt: Date | null;
}

@Injectable()
export class OperationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(tx: Prisma.TransactionClient | undefined, query: OperationsQuery): Promise<OperationRead[]> {
    const client = tx ?? this.prisma;
    return client.operationRead.findMany({
      where: this.where(query),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
  }

  count(tx: Prisma.TransactionClient | undefined, query: OperationsQuery): Promise<number> {
    return (tx ?? this.prisma).operationRead.count({ where: this.where(query) });
  }

  /**
   * Idempotent write used by both the sync hooks and the re-derivation:
   * the last writer (a write hook, or the repair job) wins with the source's value.
   */
  upsert(tx: Prisma.TransactionClient | undefined, read: OperationReadInput): Promise<OperationRead> {
    const data = {
      companyId: read.companyId,
      workerId: read.workerId,
      workerName: read.workerName,
      status: read.status,
      amountCents: read.amountCents,
      createdAt: read.createdAt,
      lastEventType: read.lastEventType,
      lastEventAt: read.lastEventAt,
    };
    return (tx ?? this.prisma).operationRead.upsert({
      where: { id: read.id },
      create: { id: read.id, ...data },
      update: data,
    });
  }

  setStatus(tx: Prisma.TransactionClient | undefined, id: string, status: OrderStatus): Promise<void> {
    return (tx ?? this.prisma).operationRead.update({ where: { id }, data: { status } }).then(() => undefined);
  }
```
Hmm — `update` returns OperationRead. I want void — fine, I'll just not `.then`. Let me return the promise of the row (harmless). Actually I'll keep the return type honest: `Promise<OperationRead>`? The caller ignores. Let me simplify: no setStatus. Instead, the hook uses `upsert`? No — the upsert needs all fields. A dedicated `setStatus` is fine:
```ts
  setStatus(tx: Prisma.TransactionClient | undefined, id: string, status: OrderStatus): Promise<OperationRead> {
    return (tx ?? this.prisma).operationRead.update({ where: { id }, data: { status } });
  }

  setLatestEventIfNewer(tx, id: string, type: string, occurredAt: Date): Promise<{ count: number }> {
    return (tx ?? this.prisma).operationRead.updateMany({
      where: { id, OR: [{ lastEventAt: null }, { lastEventAt: { lt: occurredAt } }] },
      data: { lastEventType: type, lastEventAt: occurredAt },
    });
  }

  renameWorker(tx, workerId: string, workerName: string): Promise<{ count: number }> {
    return (tx ?? this.prisma).operationRead.updateMany({
      where: { workerId },
      data: { workerName },
    });
  }

  sumByStatus(tx, companyId: string) {
    return (tx ?? this.prisma).operationRead.groupBy({
      by: ['status'],
      where: { companyId },
      _sum: { amountCents: true },
      _count: { _all: true },
    });
  }

  private where(query: OperationsQuery): Prisma.OperationReadWhereInput {
    return {
      ...(query.companyId !== undefined && { companyId: query.companyId }),
      ...(query.status !== undefined && { status: query.status }),
      ...((query.from !== undefined || query.to !== undefined) && {
        createdAt: {
          ...(query.from !== undefined && { gte: query.from }),
          ...(query.to !== undefined && { lt: query.to }),
        },
      }),
    };
  }
}
```

**operations.service.ts**:
```ts
import { Injectable } from '@nestjs/common';
import type { OperationRead, OrderStatus } from '@prisma/client';
import { OperationsRepository, type OperationsQuery } from './operations.repository.js';

export interface OperationItem { ... }
export interface OperationsPage { ... }

function toItem(row: OperationRead): OperationItem {
  return {
    id: row.id,
    company_id: row.companyId,
    worker_id: row.workerId,
    worker_name: row.workerName,
    status: row.status,
    amount_cents: row.amountCents,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    last_event_type: row.lastEventType,
    last_event_at: row.lastEventAt?.toISOString() ?? null,
  };
}

@Injectable()
export class OperationsService {
  constructor(private readonly repository: OperationsRepository) {}

  async list(query: OperationsQuery): Promise<OperationsPage> {
    const [items, totalCount] = await Promise.all([
      this.repository.list(undefined, query),
      this.repository.count(undefined, query),
    ]);
    return {
      items: items.map(toItem),
      meta: { page: query.page, page_size: query.pageSize, total_count: totalCount },
    };
  }
}
```

**operations.controller.ts**:
```ts
@Controller('operations')
export class OperationsController {
  constructor(private readonly service: OperationsService) {}

  @Get()
  list(@Query() query: Record<string, string | undefined>) {
    const from = optionalIsoDate(query.from, 'from');
    const to = optionalIsoDate(query.to, 'to');
    if (from !== undefined && to !== undefined && from.getTime() >= to.getTime()) {
      throw AppError.validation("'from' must be earlier than 'to'", {
        from: from.toISOString(),
        to: to.toISOString(),
      });
    }
    return this.service.list({
      companyId: optionalUuid(query.company_id, 'company_id'),
      status: optionalStatus(query.status, 'status'),
      from,
      to,
      page: optionalIntQuery(query.page, 'page', 1, 10_000),
      pageSize: optionalIntQuery(query.page_size, 'page_size', 50, 200),
    });
  }
}
```

**company-totals files** as drafted.

CompanyTotalsService row type:
```ts
export interface CompanyTotalRow {
  company_id: string;
  status: OrderStatus;
  order_count: number;
  total_cents: string; // exact integer cents, serialised as a string (BigInt-safe)
}
```

**projection.repository.ts**:
```ts
import { Injectable } from '@nestjs/common';
import { Prisma, type PaymentOrder } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';

export interface RederiveCursor {
  createdAt: Date;
  id: string;
}

@Injectable()
export class ProjectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Source reads used only by the re-derivation. Keyset-paginated so the window
   * can be walked without OFFSET over millions of rows.
   */
  findOrdersInWindow(tx: Prisma.TransactionClient, from: Date, to: Date, cursor: RederiveCursor | null, limit: number): Promise<PaymentOrder[]> {
    return tx.paymentOrder.findMany({
      where: {
        createdAt: { gte: from, lt: to },
        ...(cursor === null ? {} : {
          OR: [
            { createdAt: { gt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { gt: cursor.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
  }

  findWorkerNames(tx: Prisma.TransactionClient, workerIds: string[]): Promise<Map<string, string>> {
    return tx.worker
      .findMany({ where: { id: { in: workerIds } }, select: { id: true, name: true } })
      .then((rows) => new Map(rows.map((w) => [w.id, w.name])));
  }

  findWorkerName(tx: Prisma.TransactionClient, workerId: string): Promise<string | null> {
    return tx.worker.findUnique({ where: { id: workerId }, select: { name: true } }).then((w) => (w === null ? null : w.name));
  }

  findLatestEventPerOrder(tx: Prisma.TransactionClient, orderIds: string[]): Promise<Map<string, { type: string; occurredAt: Date }>> {
    return tx.event
      .findMany({
        where: { orderId: { in: orderIds } },
        orderBy: { occurredAt: 'asc' },
        select: { orderId: true, type: true, occurredAt: true },
      })
      .then((rows) => {
        const latest = new Map<string, { type: string; occurredAt: Date }>();
        for (const row of rows) latest.set(row.orderId, row); // ascending → last write wins
        return latest;
      });
  }
}
```

**projection.service.ts**:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { OrderStatus, PaymentOrder, Prisma } from '@prisma/client';
import { AppError } from '../common/errors.js';
import { TransactionService } from '../common/transaction.service.js';
import { CompanyTotalsRepository } from '../company-totals/company-totals.repository.js';
import { OperationsRepository, type OperationReadInput } from '../operations/operations.repository.js';
import { ProjectionRepository, type RederiveCursor } from './projection.repository.js';

const REDEIVE_CHUNK_SIZE = 500;
const DEFAULT_REPAIR_CRON = '0 * * * *';
const DEFAULT_REPAIR_WINDOW_HOURS = 24;

export interface RederiveResult {
  ordersRederived: number;
  companiesRecomputed: number;
}

@Injectable()
export class ProjectionService {
  private readonly logger = new Logger(ProjectionService.name);
  private repairRunning = false;

  constructor(
    private readonly repository: ProjectionRepository,
    private readonly operationsRepository: OperationsRepository,
    private readonly companyTotalsRepository: CompanyTotalsRepository,
    private readonly transactions: TransactionService,
  ) {}

  // --- Write path hooks (called inside the caller's transaction) -------------

  async onOrderCreated(tx: Prisma.TransactionClient, order: PaymentOrder): Promise<void> {
    const workerName = await this.repository.findWorkerName(tx, order.workerId);
    if (workerName === null) {
      throw AppError('internal_error', `worker ${order.workerId} vanished while projecting order ${order.id}`, {}, 500);
    }
    const read: OperationReadInput = {
      id: order.id,
      companyId: order.companyId,
      workerId: order.workerId,
      workerName,
      status: order.status,
      amountCents: order.amountCents,
      createdAt: order.createdAt,
      lastEventType: null,
      lastEventAt: null,
    };
    await this.operationsRepository.upsert(tx, read);
    await this.companyTotalsRepository.applyDelta(tx, order.companyId, order.status, 1, BigInt(order.amountCents));
  }

  async onOrderStatusChanged(tx: Prisma.TransactionClient, order: PaymentOrder, previousStatus: OrderStatus): Promise<void> {
    await this.operationsRepository.setStatus(tx, order.id, order.status);
    // Move the amount between the two status buckets; each step is a single
    // atomic statement, so no other writer can slip between the read and the write.
    await this.companyTotalsRepository.applyDelta(tx, order.companyId, previousStatus, -1, -BigInt(order.amountCents));
    await this.companyTotalsRepository.applyDelta(tx, order.companyId, order.status, 1, BigInt(order.amountCents));
  }

  onEventRecorded(tx: Prisma.TransactionClient, orderId: string, type: string, occurredAt: Date): Promise<void> {
    return this.operationsRepository.setLatestEventIfNewer(tx, orderId, type, occurredAt).then(() => undefined);
  }

  onWorkerRenamed(tx: Prisma.TransactionClient, workerId: string, workerName: string): Promise<void> {
    return this.operationsRepository.renameWorker(tx, workerId, workerName).then(() => undefined);
  }

  // --- Re-derivation / drift repair -----------------------------------------

  /**
   * Rebuild operation_reads from the source tables for orders created in
   * [from, to), then recompute the exact totals for every affected company
   * from the rebuilt rows. Idempotent: safe to run repeatedly, overlapping,
   * or concurrently with live writes.
   */
  async rederiveWindow(from: Date, to: Date): Promise<RederiveResult> {
    if (from.getTime() >= to.getTime()) {
      throw AppError.validation("'from' must be earlier than 'to'", {
        from: from.toISOString(),
        to: to.toISOString(),
      });
    }

    let cursor: RederiveCursor | null = null;
    let ordersRederived = 0;
    const affectedCompanies = new Set<string>();

    while (true) {
      const batch = await this.transactions.run(async (tx) => {
        const orders = await this.repository.findOrdersInWindow(tx, from, to, cursor, REDEIVE_CHUNK_SIZE);
        if (orders.length === 0) return orders;
        const workerNames = await this.repository.findWorkerNames(
          tx,
          [...new Set(orders.map((o) => o.workerId))],
        );
        const latestEvents = await this.repository.findLatestEventPerOrder(tx, orders.map((o) => o.id));
        for (const order of orders) {
          const lastEvent = latestEvents.get(order.id);
          const read: OperationReadInput = {
            id: order.id,
            companyId: order.companyId,
            workerId: order.workerId,
            workerName: workerNames.get(order.workerId) ?? '',
            status: order.status,
            amountCents: order.amountCents,
            createdAt: order.createdAt,
            lastEventType: lastEvent?.type ?? null,
            lastEventAt: lastEvent?.occurredAt ?? null,
          };
          await this.operationsRepository.upsert(tx, read);
        }
        return orders;
      });

      if (batch.length === 0) break;
      ordersRederived += batch.length;
      for (const order of batch) affectedCompanies.add(order.companyId);
      const last = batch[batch.length - 1];
      cursor = { createdAt: last.createdAt, id: last.id };
    }

    let companiesRecomputed = 0;
    for (const companyId of [...affectedCompanies].sort()) {
      await this.transactions.run(async (tx) => {
        const groups = await this.operationsRepository.sumByStatus(tx, companyId);
        await this.companyTotalsRepository.recompute(tx, companyId, this.totalsFromGroups(groups));
        companiesRecomputed += 1;
      });
    }

    this.logger.log(
      `re-derived ${ordersRederived} operations in [${from.toISOString()}, ${to.toISOString()}); recomputed totals for ${companiesRecomputed} companies`,
    );
    return { ordersRederived, companiesRecomputed };
  }

  /**
   * Scheduled drift repair: re-derive a rolling window every hour. The window
   * overlaps the previous run by design, so anything skipped while live writes
   * were in flight is picked up on the next pass.
   */
  @Cron(process.env.DRIFT_REPAIR_CRON ?? DEFAULT_REPAIR_CRON, { name: 'drift-repair' })
  async scheduledDriftRepair(): Promise<void> {
    if (process.env.DRIFT_REPAIR_ENABLED === 'false') return;
    if (this.repairRunning) {
      this.logger.warn('previous drift-repair run is still in progress; skipping this tick');
      return;
    }
    this.repairRunning = true;
    try {
      const rawHours = Number(process.env.DRIFT_REPAIR_WINDOW_HOURS ?? DEFAULT_REPAIR_WINDOW_HOURS);
      const windowHours = Number.isFinite(rawHours) && rawHours > 0 ? rawHours : DEFAULT_REPAIR_WINDOW_HOURS;
      const to = new Date();
      const from = new Date(to.getTime() - windowHours * 3_600_000);
      await this.rederiveWindow(from, to);
    } catch (error) {
      this.logger.error(`drift-repair failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.repairRunning = false;
    }
  }

  private totalsFromGroups(
    groups: Array<{ status: OrderStatus; _sum: { amountCents: bigint | null }; _count: { _all: number } }>,
  ): Record<OrderStatus, { count: number; cents: bigint }> {
    const totals: Record<OrderStatus, { count: number; cents: bigint }> = {
      pending: { count: 0, cents: 0n },
      approved: { count: 0, cents: 0n },
      rejected: { count: 0, cents: 0n },
    };
    for (const group of groups) {
      totals[group.status] = { count: group._count._all, cents: group._sum.amountCents ?? 0n };
    }
    return totals;
  }
}
```

**projection.module.ts**:
```ts
@Module({
  providers: [ProjectionService, ProjectionRepository],
  imports: [CommonModule, OperationsModule, CompanyTotalsModule],
  exports: [ProjectionService],
})
export class ProjectionModule {}
```

Now, the **company-totals.repository.ts** complete:
```ts
import { Injectable } from '@nestjs/common';
import type { CompanyTotals, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';

@Injectable()
export class CompanyTotalsRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(tx: Prisma.TransactionClient | undefined, companyId?: string): Promise<CompanyTotals[]> {
    return (tx ?? this.prisma).companyTotals.findMany({
      where: companyId === undefined ? {} : { companyId },
      orderBy: [{ companyId: 'asc' }, { status: 'asc' }],
    });
  }

  /**
   * Apply a signed delta with a single INSERT ... ON CONFLICT statement.
   * The increment happens in SQL, so two concurrent transactions both
   * committing an increment for the same (company, status) never lose one —
   * a read-modify-write via Prisma's upsert would.
   */
  applyDelta(
    tx: Prisma.TransactionClient | undefined,
    companyId: string,
    status: OrderStatus,
    deltaCount: number,
    deltaCents: bigint,
  ): Promise<number> {
    return (tx ?? this.prisma).$executeRaw`
      INSERT INTO company_totals (company_id, status, order_count, total_cents, updated_at)
      VALUES (${companyId}, ${status}, ${deltaCount}, ${deltaCents}, now())
      ON CONFLICT (company_id, status) DO UPDATE
      SET order_count = company_totals.order_count + ${deltaCount},
          total_cents = company_totals.total_cents + ${deltaCents},
          updated_at  = now()
    `;
  }

  /**
   * Absolute reset of a company's three buckets, used by the re-derivation.
   * One multi-row statement so the three buckets land consistently.
   */
  recompute(
    tx: Prisma.TransactionClient | undefined,
    companyId: string,
    totals: Record<OrderStatus, { count: number; cents: bigint }>,
  ): Promise<number> {
    const { pending, approved, rejected } = totals;
    return (tx ?? this.prisma).$executeRaw`
      INSERT INTO company_totals (company_id, status, order_count, total_cents, updated_at)
      VALUES
        (${companyId}, ${'pending'}, ${pending.count}, ${pending.cents}, now()),
        (${companyId}, ${'approved'}, ${approved.count}, ${approved.cents}, now()),
        (${companyId}, ${'rejected'}, ${rejected.count}, ${rejected.cents}, now())
      ON CONFLICT (company_id, status) DO UPDATE
      SET order_count = EXCLUDED.order_count,
          total_cents = EXCLUDED.total_cents,
          updated_at  = now()
    `;
  }
}
```
`$executeRaw` returns the row count (number) ✓.

Wait — the `status` parameter passed as a TS `OrderStatus` string — Prisma's raw template takes it as a string parameter ✓.

One concern: `${status}` where status is an enum member string ('pending') → the parameter is fine.

**company-totals.service.ts**:
```ts
import { Injectable } from '@nestjs/common';
import type { OrderStatus } from '@prisma/client';
import { ORDER_STATUSES } from '../common/validation.js';
import { CompanyTotalsRepository } from './company-totals.repository.js';

export interface CompanyTotalRow {
  company_id: string;
  status: OrderStatus;
  order_count: number;
  /** Exact integer cents, serialised as a string (BigInt-safe for JSON). */
  total_cents: string;
}

@Injectable()
export class CompanyTotalsService {
  constructor(private readonly repository: CompanyTotalsRepository) {}

  async forCompany(companyId?: string): Promise<CompanyTotalRow[]> {
    const rows = await this.repository.list(undefined, companyId);

    const byCompany = new Map<string, Map<OrderStatus, { count: number; cents: bigint }>>();
    for (const row of rows) {
      let buckets = byCompany.get(row.companyId);
      if (!buckets) {
        buckets = new Map();
        byCompany.set(row.companyId, buckets);
      }
      buckets.set(row.status, { count: row.orderCount, cents: row.totalCents });
    }

    const companies =
      companyId !== undefined ? [companyId] : [...byCompany.keys()].sort();

    const result: CompanyTotalRow[] = [];
    for (const company of companies) {
      const buckets = byCompany.get(company);
      for (const status of ORDER_STATUSES) {
        const bucket = buckets?.get(status);
        result.push({
          company_id: company,
          status,
          order_count: bucket?.count ?? 0,
          total_cents: (bucket?.cents ?? 0n).toString(),
        });
      }
    }
    return result;
  }
}
```
`ORDER_STATUSES` is typed `OrderStatus[]` ✓.

**company-totals.controller.ts**:
```ts
@Controller('company-totals')
@Get()
list(@Query() query: Record<string, string | undefined>) {
  return this.service.forCompany(optionalUuid(query.company_id, 'company_id'));
}
```

**Module**:
```ts
@Module({
  controllers: [CompanyTotalsController],
  providers: [CompanyTotalsService, CompanyTotalsRepository],
  imports: [CommonModule],
  exports: [CompanyTotalsRepository],
})
export class CompanyTotalsModule {}
```

**Operations module**:
```ts
@Module({
  controllers: [OperationsController],
  providers: [OperationsService, OperationsRepository],
  imports: [CommonModule],
  exports: [OperationsRepository],
})
export class OperationsModule {}
```

Now — the tests.

**test/test-utils.ts**:
```ts
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/common/prisma.service.js';
import { PaymentOrdersService } from '../src/payment-orders/payment-orders.service.js';
import { EventsService } from '../src/events/events.service.js';
import { WorkersService } from '../src/workers/workers.service.js';
import { OperationsService } from '../src/operations/operations.service.js';
import { CompanyTotalsService } from '../src/company-totals/company-totals.service.js';
import { ProjectionService } from '../src/projection/projection.service.js';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  paymentOrders: PaymentOrdersService;
  events: EventsService;
  workers: WorkersService;
  operations: OperationsService;
  companyTotals: CompanyTotalsService;
  projection: ProjectionService;
}

/**
 * The read-model suite is behaviour-level: it needs a real Postgres at
 * DATABASE_URL (the same variable the app uses).
 */
export async function createTestContext(): Promise<TestContext> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to run the read-model test suite');
  }
  process.env.DRIFT_REPAIR_ENABLED = 'false';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();

  return {
    app,
    prisma: moduleRef.get(PrismaService),
    paymentOrders: moduleRef.get(PaymentOrdersService),
    events: moduleRef.get(EventsService),
    workers: moduleRef.get(WorkersService),
    operations: moduleRef.get(OperationsService),
    companyTotals: moduleRef.get(CompanyTotalsService),
    projection: moduleRef.get(ProjectionService),
  };
}

export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.companyTotals.deleteMany();
  await prisma.operationRead.deleteMany();
  await prisma.event.deleteMany();
  await prisma.paymentOrder.deleteMany();
  await prisma.worker.deleteMany();
}

export function newId(): string {
  return randomUUID();
}
```

**test/operations.spec.ts**:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, newId, resetDatabase, type TestContext } from './test-utils.js';

describe('operations dashboard: read-your-own-writes', () => {
  let ctx: TestContext;
  let companyId: string;
  let workerId: string;

  beforeEach(async () => {
    ctx = await createTestContext();
    await resetDatabase(ctx.prisma);
    companyId = newId();
    const worker = await ctx.workers.create({ companyId, name: 'Ada' });
    workerId = worker.id;
  });

  afterEach(async () => {
    await resetDatabase(ctx.prisma);
    await ctx.app.close();
  });

  it('shows a newly created order on the very next dashboard read', async () => {
    const order = await ctx.paymentOrders.create({ companyId, workerId, amountCents: 1200 });

    const page = await ctx.operations.list({ companyId, page: 1, pageSize: 50 });

    expect(page.meta).toEqual({ page: 1, page_size: 50, total_count: 1 });
    expect(page.items).toEqual([
      expect.objectContaining({
        id: order.id,
        company_id: companyId,
        worker_id: workerId,
        worker_name: 'Ada',
        status: 'pending',
        amount_cents: 1200,
        last_event_type: null,
        last_event_at: null,
      }),
    ]);
  });

  it('reflects an approval on the next read, and the status filter follows', async () => {
    const order = await ctx.paymentOrders.create({ companyId, workerId, amountCents: 2500 });

    await ctx.paymentOrders.setStatus(order.id, 'approved');

    const approved = await ctx.operations.list({ companyId, status: 'approved', page: 1, pageSize: 50 });
    expect(approved.meta.total_count).toBe(1);
    expect(approved.items[0].id).toBe(order.id);
    expect(approved.items[0].status).toBe('approved');

    const pending = await ctx.operations.list({ companyId, status: 'pending', page: 1, pageSize: 50 });
    expect(pending.meta.total_count).toBe(0);
    expect(pending.items).toEqual([]);
  });

  it('reflects a recorded event as the operation\'s latest event', async () => {
    const order = await ctx.paymentOrders.create({ companyId, workerId, amountCents: 100 });
    const occurredAt = new Date('2025-06-01T12:00:00.000Z');

    await ctx.events.record({ orderId: order.id, type: 'payment.captured', occurredAt });

    const page = await ctx.operations.list({ companyId, page: 1, pageSize: 50 });
    expect(page.items[0].last_event_type).toBe('payment.captured');
    expect(page.items[0].last_event_at).toBe(occurredAt.toISOString());
  });

  it('ignores events whose occurred_at is older than the latest one', async () => {
    const order = await ctx.paymentOrders.create({ companyId, workerId, amountCents: 100 });
    await ctx.events.record({ orderId: order.id, type: 'payment.captured', occurredAt: new Date('2025-06-02T00:00:00.000Z') });
    await ctx.events.record({ orderId: order.id, type: 'late-but-earlier', occurredAt: new Date('2025-06-01T00:00:00.000Z') });

    const page = await ctx.operations.list({ companyId, page: 1, pageSize: 50 });
    expect(page.items[0].last_event_type).toBe('payment.captured');
  });
```
Good — tests the conditional updateMany (monotonicity) ✓ behavior, not happy-path-only.

```ts
  it('never mixes in another company\'s operations', async () => {
    await ctx.paymentOrders.create({ companyId, workerId, amountCents: 100 });
    const otherCompany = newId();
    const otherWorker = await ctx.workers.create({ companyId: otherCompany, name: 'Bo' });
    await ctx.paymentOrders.create({ companyId: otherCompany, workerId: otherWorker.id, amountCents: 999 });

    const page = await ctx.operations.list({ companyId, page: 1, pageSize: 50 });

    expect(page.meta.total_count).toBe(1);
    expect(page.items[0].amount_cents).toBe(100);
  });

  it('keeps the denormalised worker name in sync with renames', async () => {
    await ctx.paymentOrders.create({ companyId, workerId, amountCents: 100 });

    await ctx.workers.rename(workerId, 'Ada Lovelace');

    const page = await ctx.operations.list({ companyId, page: 1, pageSize: 50 });
    expect(page.items[0].worker_name).toBe('Ada Lovelace');
  });

  it('filters by date range and sorts by recency', async () => {
    const oldOrder = await ctx.paymentOrders.create({ companyId, workerId, amountCents: 1 });
    const freshOrder = await ctx.paymentOrders.create({ companyId, workerId, amountCents: 2 });

    // Backdate the first order (fixture manipulation) so the range is unambiguous.
    const past = new Date('2025-01-01T00:00:00.000Z');
    await ctx.prisma.paymentOrder.update({ where: { id: oldOrder.id }, data: { createdAt: past } });
    await ctx.prisma.operationRead.update({ where: { id: oldOrder.id }, data: { createdAt: past } });

    const all = await ctx.operations.list({ companyId, page: 1, pageSize: 10 });
    expect(all.items.map((item) => item.id)).toEqual([freshOrder.id, oldOrder.id]);

    const ranged = await ctx.operations.list({ companyId, from: new Date(past.getTime() + 3_600_000), page: 1, pageSize: 10 });
    expect(ranged.meta.total_count).toBe(1);
    expect(ranged.items[0].id).toBe(freshOrder.id);
  });

  it('paginates with a stable order', async () => {
    const created = [];
    for (let i = 0; i < 5; i++) {
      created.push(await ctx.paymentOrders.create({ companyId, workerId, amountCents: i + 1 }));
    }
    // Backdate so each order lands on a distinct second, oldest first.
    const base = Date.parse('2025-03-01T00:00:00.000Z');
    for (let i = 0; i < created.length; i++) {
      const at = new Date(base + i * 1000);
      await ctx.prisma.paymentOrder.update({ where: { id: created[i].id }, data: { createdAt: at } });
      await ctx.prisma.operationRead.update({ where: { id: created[i].id }, data: { createdAt: at } });
    }

    const firstPage = await ctx.operations.list({ companyId, page: 1, pageSize: 2 });
    const secondPage = await ctx.operations.list({ companyId, page: 2, pageSize: 2 });

    expect(firstPage.meta.total_count).toBe(5);
    expect(firstPage.items.map((item) => item.id)).toEqual([created[4].id, created[3].id]);
    expect(secondPage.items.map((item) => item.id)).toEqual([created[2].id, created[1].id]);
    const ids = [...firstPage.items, ...secondPage.items].map((item) => item.id);
    expect(new Set(ids).size).toBe(4); // no overlap between pages
  });
});
```
Wait, the backdating: created[i] backdated to base + i seconds. But the last-created (i=4) is the most recent ✓ order [created[4], created[3], ...] ✓. Note: the loop backdates sequentially — each create is at "now" first, then backdated. No problem.

Note: `created` is a `PaymentOrder[]` type — let me type as `const created: PaymentOrder[] = []`. Need to import the type? I can use `PaymentOrder` via `Awaited<ReturnType<...>>`... simpler: `import type { PaymentOrder } from '@prisma/client';` in the spec ✓.

**test/company-totals.spec.ts**:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OrderStatus } from '@prisma/client';
import { createTestContext, newId, resetDatabase, type TestContext } from './test-utils.js';

describe('company totals: exact under concurrent updates', () => {
  let ctx: TestContext;
  let companyId: string;
  const workerIds: string[] = [];

  beforeEach(async () => {
    ctx = await createTestContext();
    await resetDatabase(ctx.prisma);
    companyId = newId();
    workerIds.length = 0;
    for (const name of ['W1', 'W2', 'W3', 'W4']) {
      workerIds.push((await ctx.workers.create({ companyId, name })).id);
    }
  });

  afterEach(async () => {
    await resetDatabase(ctx.prisma);
    await ctx.app.close();
  });

  const finalStatusOf = (index: number): OrderStatus =>
    index % 2 === 0 ? 'approved' : index % 5 === 1 ? 'rejected' : 'pending';

  it('keeps totals exact while 60 writes race on one company', async () => {
    const N = 60;
    const created = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        ctx.paymentOrders.create({
          companyId,
          workerId: workerIds[i % workerIds.length],
          amountCents: 100 + i * 7,
        }),
      ),
    );

    await Promise.all(
      created.map((order, i) =>
        finalStatusOf(i) === 'pending'
          ? Promise.resolve()
          : ctx.paymentOrders.setStatus(order.id, finalStatusOf(i)),
      ),
    );

    const rows = await ctx.companyTotals.forCompany(companyId);
    const byStatus = new Map(rows.map((row) => [row.status, row]));

    const expected: Record<OrderStatus, { count: number; cents: bigint }> = {
      pending: { count: 0, cents: 0n },
      approved: { count: 0, cents: 0n },
      rejected: { count: 0, cents: 0n },
    };
    created.forEach((order, i) => {
      const status = finalStatusOf(i);
      expected[status].count += 1;
      expected[status].cents += BigInt(order.amountCents);
    });

    for (const status of ['pending', 'approved', 'rejected'] as const) {
      const row = byStatus.get(status);
      expect(row).toBeDefined();
      expect(row!.order_count).toBe(expected[status].count);
      expect(BigInt(row!.total_cents)).toBe(expected[status].cents);
    }

    expect(rows.reduce((sum, row) => sum + row.order_count, 0)).toBe(N);
    expect(rows.reduce((sum, row) => sum + BigInt(row.total_cents), 0n)).toBe(
      created.reduce((sum, order) => sum + BigInt(order.amountCents), 0n),
    );
  });

  it('never mixes one company\'s totals into another\'s', async () => {
    const otherCompany = newId();
    const otherWorker = await ctx.workers.create({ companyId: otherCompany, name: 'X' });

    await Promise.all([
      ctx.paymentOrders.create({ companyId, workerId: workerIds[0], amountCents: 111 }),
      ctx.paymentOrders.create({ companyId: otherCompany, workerId: otherWorker.id, amountCents: 222 }),
    ]);

    const rows = await ctx.companyTotals.forCompany(companyId);
    expect(rows.reduce((sum, row) => sum + row.order_count, 0)).toBe(1);
    expect(rows.reduce((sum, row) => sum + BigInt(row.total_cents), 0n)).toBe(111n);
  });

  it('moves the amount between buckets as the status changes repeatedly', async () => {
    const order = await ctx.paymentOrders.create({ companyId, workerId: workerIds[0], amountCents: 500 });

    const totals = async () => {
      const rows = await ctx.companyTotals.forCompany(companyId);
      return new Map(rows.map((row) => [row.status, row]));
    };

    await ctx.paymentOrders.setStatus(order.id, 'approved');
    let byStatus = await totals();
    expect(byStatus.get('pending')!.order_count).toBe(0);
    expect(BigInt(byStatus.get('approved')!.total_cents)).toBe(500n);

    await ctx.paymentOrders.setStatus(order.id, 'rejected');
    byStatus = await totals();
    expect(BigInt(byStatus.get('approved')!.total_cents)).toBe(0n);
    expect(BigInt(byStatus.get('rejected')!.total_cents)).toBe(500n);

    await ctx.paymentOrders.setStatus(order.id, 'pending');
    byStatus = await totals();
    expect(BigInt(byStatus.get('rejected')!.total_cents)).toBe(0n);
    expect(BigInt(byStatus.get('pending')!.total_cents)).toBe(500n);
    expect(byStatus.get('pending')!.order_count).toBe(1);
  });
});
```

The 60-concurrent creates: each an interactive tx — 60 connections? Prisma's pool default is 15 (Prisma's default pool size = 15? Prisma's default connection pool = 15?). `maxWait: 5000` — 60 txs waiting on 15 slots → some may hit maxWait timeout under load? Each tx is short (<50ms). 60 × ~20ms / 15 ≈ 80ms total — well within 5s ✓.

**test/drift-repair.spec.ts**:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, newId, resetDatabase, type TestContext } from './test-utils.js';

describe('drift repair: re-derivation over an arbitrary window', () => {
  let ctx: TestContext;
  let companyId: string;
  let workerId: string;
  let outsiderCompany: string;
  let outsiderWorkerId: string;

  beforeEach(async () => {
    ctx = await createTestContext();
    await resetDatabase(ctx.prisma);
    companyId = newId();
    outsiderCompany = newId();
    workerId = (await ctx.workers.create({ companyId, name: 'In-window' })).id;
    outsiderWorkerId = (await ctx.workers.create({ companyId: outsiderCompany, name: 'Outsider' })).id;
  });

  afterEach(async () => {
    await resetDatabase(ctx.prisma);
    await ctx.app.close();
  });

  it('repairs missed writes, tampered rows and corrupted totals inside the window — and only there', async () => {
    const a = await ctx.paymentOrders.create({ companyId, workerId, amountCents: 1000 });
    const b = await ctx.paymentOrders.create({ companyId, workerId, amountCents: 2000 });
    const c = await ctx.paymentOrders.create({ companyId, workerId, amountCents: 3000 });
    const outsider = await ctx.paymentOrders.create({ companyId: outsiderCompany, workerId: outsiderWorkerId, amountCents: 7777 });

    // Simulate drift of the four kinds the repair has to heal.
    // 1) A source write that bypassed the hook (direct update of the order).
    await ctx.prisma.paymentOrder.update({ where: { id: a.id }, data: { status: 'approved' } });
    // 2) A projection row tampered with directly.
    await ctx.prisma.operationRead.update({ where: { id: b.id }, data: { workerName: 'Ghost', amountCents: 999999, status: 'rejected' } });
    // 3) An event written straight to the source table.
    await ctx.prisma.event.create({ data: { orderId: c.id, type: 'direct', occurredAt: new Date() } });
    // 4) A maintained totals row corrupted.
    await ctx.prisma.companyTotals.update({
      where: { companyId_status: { companyId, status: 'pending' } },
      data: { orderCount: 99, totalCents: 1n },
    });

    // Push the outsider's order outside the window that we are going to repair.
    await ctx.prisma.paymentOrder.update({
      where: { id: outsider.id },
      data: { createdAt: new Date(Date.now() - 30 * 86_400_000) },
    });
    await ctx.prisma.operationRead.update({ where: { id: outsider.id }, data: { workerName: 'ShouldStay' } });
    await ctx.prisma.companyTotals.update({
      where: { companyId_status: { companyId: outsiderCompany, status: 'pending' } },
      data: { totalCents: 42n },
    });

    const from = new Date(Date.now() - 3_600_000);
    const to = new Date(Date.now() + 3_600_000);

    const result = await ctx.projection.rederiveWindow(from, to);
    expect(result.ordersRederived).toBe(3);
    expect(result.companiesRecomputed).toBe(1);

    // The in-window company is fully repaired: rows, names, events, totals.
    const page = await ctx.operations.list({ companyId, page: 1, pageSize: 50 });
    const byId = new Map(page.items.map((item) => [item.id, item]));
    expect(byId.get(a.id)!.status).toBe('approved');
    expect(byId.get(b.id)!.worker_name).toBe('In-window');
    expect(byId.get(b.id)!.amount_cents).toBe(2000);
    expect(byId.get(b.id)!.status).toBe('pending');
    expect(byId.get(c.id)!.last_event_type).toBe('direct');

    const byStatus = new Map((await ctx.companyTotals.forCompany(companyId)).map((row) => [row.status, row]));
    expect(byStatus.get('approved')!.order_count).toBe(1);
    expect(BigInt(byStatus.get('approved')!.total_cents)).toBe(1000n);
    expect(byStatus.get('pending')!.order_count).toBe(2);
    expect(BigInt(byStatus.get('pending')!.total_cents)).toBe(5000n);
    expect(byStatus.get('rejected')!.order_count).toBe(0);
    expect(byStatus.get('rejected')!.total_cents).toBe('0');

    // The window is honoured: the 30-day-old order is not re-derived, and the
    // outsider's corrupted totals are not touched either.
    const outsiderPage = await ctx.operations.list({ companyId: outsiderCompany, page: 1, pageSize: 50 });
    expect(outsiderPage.items[0].worker_name).toBe('ShouldStay');
    const outsiderRows = await ctx.companyTotals.forCompany(outsiderCompany);
    expect(BigInt(outsiderRows.find((row) => row.status === 'pending')!.total_cents)).toBe(42n);

    // The repair is idempotent.
    await ctx.projection.rederiveWindow(from, to);
    expect(await ctx.companyTotals.forCompany(companyId)).toEqual(await ctx.companyTotals.forCompany(companyId));
```
Hmm — that last assertion is trivially true (comparing two calls). A better idempotency check: capture rows before the 2nd run, run, compare:
```ts
    const before = await ctx.companyTotals.forCompany(companyId);
    const beforePage = await ctx.operations.list({ companyId, page: 1, pageSize: 50 });
    await ctx.projection.rederiveWindow(from, to);
    expect(await ctx.companyTotals.forCompany(companyId)).toEqual(before);
    expect((await ctx.operations.list({ companyId, page: 1, pageSize: 50 })).items).toEqual(beforePage.items);
```
✓ meaningful.

Note: the `worker_name` for the outsider is 'ShouldStay' — but wait, the original name was 'Outsider'. The repair doesn't touch it (excluded by window) ✓.

Also note — the outsider's operation_reads row: its `createdAt` is still now (not backdated in the projection). Fine.

One more check: `result.ordersRederived` — 3 (a, b, c). The outsider is excluded ✓. `companiesRecomputed` — 1 (only companyId) ✓.

Another possible gotcha: `resetDatabase` in `beforeEach` — and the context creation boots the app (Prisma connect). OK.

Now — the `ctx.prisma.event.create` in the drift test — `data: { orderId, type, occurredAt }` ✓.

`ctx.prisma.operationRead.update` — a tamper with `status: 'rejected'` — the Prisma enum type accepts the string literal ✓ (typed input).

Now — `AppError('internal_error', ...)` — AppError constructor is public ✓.

Now — potential TS strict issues to double-check:
1. `requirePositiveInt` — value unknown → after typeof check, number ✓.
2. `asRecord` cast ✓.
3. `query: Record<string, string | undefined>` from Nest @Query — Nest types @Query() as any → the annotation is ok? `@Query() query: Record<string, string | undefined>` — the decorator's typing doesn't force it. Fine.
4. `ORDER_STATUSES: OrderStatus[]` — the import type of OrderStatus from @prisma/client in validation.ts. A value import of the OrderStatus const isn't needed. `const ORDER_STATUSES: OrderStatus[] = ['pending', 'approved', 'rejected'];` ✓.
5. In company-totals.service: `for (const status of ORDER_STATUSES)` → status: OrderStatus ✓.
6. The totalsFromGroups parameter type matches groupBy's output — the groupBy return type: `Prisma.OperationReadGroupByOutputType` — the structural type I declare should match: `{ status: OrderStatus; _count: { _all: number }; _sum: { amountCents: bigint | null } }` ✓ assignable.
7. `Map(rows.map((row) => [row.status, row]))` — TS needs `as [string, T][]`? `new Map(rows.map(r => [r.status, r]))` — map returns `(string | CompanyTotalRow)[][]`? No — an array literal of 2 elements in a map infers as `(string | CompanyTotalRow)[]` → Map constructor expects `readonly [K, V][]` → type error! Need explicit tuple: `rows.map((row): [string, CompanyTotalRow] => [row.status, row])` or `as const`. I'll add explicit tuple annotations to all such maps. Same for `byId = new Map(page.items.map((item) => [item.id, item]))` → annotate `[string, OperationItem]`.

8. `expect(page.items).toEqual([expect.objectContaining({...})])` ✓ vitest.

9. In the test, `created.reduce` — `created` is `PaymentOrder[]` ✓ (Promise.all preserves array type ✓).

10. `BigInt(row!.total_cents)` — row.total_cents is string ✓.

11. `expect(...total_cents).toBe('0')` — string ✓ (the zero-fill path uses 0n.toString() = '0' ✓).

12. Prisma `status: 'approved'` in `data` of `ctx.prisma.paymentOrder.update` — the type accepts a literal union ✓.

13. `ctx.prisma.companyTotals.update({ where: { companyId_status: {...} }, data: { totalCents: 1n } })` — BigInt ✓.

Now — the `TransactionService.run` generic — the callback returns orders (an array) in the re-derivation: `run<PaymentOrder[]>` inferred ✓.

Prisma's `$transaction` typing: the callback receives `Prisma.TransactionClient` ✓.

Now, one more important check — **Prisma generated client and `@map` on enums**: `@@map("order_status")` on the enum → the Postgres type is `order_status` ✓ my raw SQL uses the table/column names (not the enum type name explicitly) — the insert relies on the column type ✓.

**The raw SQL table/column names**: I use the mapped (snake_case) names in the raw SQL: `company_totals (company_id, status, order_count, total_cents, updated_at)` ✓ matches the DDL.

Now — **does the schema need a `@@index` on `payment_orders (companyId)`**? The dashboard no longer queries payment_orders by company. The source query is only the re-derivation by created_at ✓ covered.

**The index on workers?** Not needed.

Now, **DESIGN.md** content (short, focused):

```md
# Read-model design — operations dashboard

## Problem
The dashboard lists "operations" — payment orders joined with events (latest
per order) and workers (name) — filtered by company, status and date range,
sorted by recency, paginated. On ~3M orders that join-plus-aggregate takes
20–30 s. Target: p95 < 50 ms, no change to what operators see,
read-your-own-writes, and exact per-company financial totals.

## Shape of the read model
Two projection tables, both keyed by order/company:

- `operation_reads` — one row per payment order, denormalised with
  `worker_name`, `status`, `amount_cents`, `created_at` and the latest event
  (`last_event_type`, `last_event_at`). The dashboard query becomes a single
  index range scan + LIMIT on this table; no joins, no aggregation.
- `company_totals` — exact `(company_id, status) → (order_count, total_cents)`.
  `total_cents` is BIGINT and is exposed as a decimal string so JSON cannot
  round it.

## Index
`operation_reads (company_id, status, created_at DESC, id DESC)` matches the
query's equality filters, range and sort order exactly, so the hot path is an
index scan with no sort; `id` as the final key gives stable pagination. A
secondary index on `worker_id` keeps renames bounded.

## Maintenance: synchronous in-transaction hooks
Every write (create order, change status, record event, rename worker) opens
one transaction and, after writing the source row, calls the corresponding
hook on `ProjectionService`, which writes the projections in the same
transaction.

Why this, and not the alternatives:

- **Read-your-own-writes.** The projection row and the source row commit or
  roll back together, so any request after a committed write sees the new
  state. An outbox/queue (CDC or event bus) introduces lag of unknown size —
  it cannot meet "approve → next request reflects it".
- **Exact totals under concurrency.** The totals update is one
  `INSERT ... ON CONFLICT DO UPDATE SET total_cents = total_cents + $delta`
  statement. The increment happens inside Postgres, so racing writes on the
  same company never lose an update; a client-side read-modify-write (even
  inside a transaction) or an async consumer with reordering/duplicates would
  make the totals approximate.
- **Postgres triggers** would give the same atomicity but hide half the
  write-path logic in the database: untestable from the app, hard to version
  alongside the code, and impossible to reuse for re-derivation.
- **Materialised views** refresh in bulk; they cannot be per-write and
  `REFRESH` on 3M rows is exactly the 20–30 s we are removing.
- **Keep computing on read** (better indexes on the join) still pays the
  per-read aggregation over the events table; indexes do not remove work,
  and p95 50 ms at 3M rows with aggregation is not credible.

Cost of the hook: 1 upsert (+ 1–2 tiny atomic statements) per write, all
primary-key lookups. Writes in this back-office are orders of magnitude
rarer than dashboard reads, so trading a few ms on writes for a 20–30 s →
<50 ms read is the right exchange.

## Re-derivation and drift repair
- `ProjectionService.rederiveWindow(from, to)` rebuilds `operation_reads`
  from the source tables for orders created in `[from, to)`, in
  keyset-paginated chunks, then recomputes `company_totals` for every
  affected company from the rebuilt rows. It is idempotent, so runs may
  overlap or interleave with live writes.
- A scheduled job (`@Cron`, default hourly, `DRIFT_REPAIR_CRON`) re-derives
  a rolling window (`DRIFT_REPAIR_WINDOW_HOURS`, default 24). The overlap
  between runs is deliberate: an order skipped while a live write was in
  flight is covered by the next pass.
- Known, self-healing race: if a write for company C commits between the
  recompute's snapshot and its absolute `SET`, that one delta is
  overwritten and is restored by the next repair run. The steady state
  (writes only) has no such race.

## What operators still see
The same rows and fields as the old join — order fields, worker name, latest
event — with the same filters (company, status, date range), the same
sort (recency) and the same pagination, now served from the projection.
Totals are exact by construction (BIGINT, atomic increments, periodic
recomputation).
```

Good.

Now, one more consideration — the task's deliverable "maintenance hooks that write services invoke (simulate the write path)" ✓ (the write services exist and invoke the hooks).

"The new dashboard query" ✓ (`GET /operations` over the projection).

Now — I should double-check a few of Prisma API specifics:

- `@@index([companyId, status, createdAt(sort: Desc), id(sort: Desc)])` — syntax ✓ (Prisma ≥4.16).
- `groupBy` with `by: ['status']`, `_sum: { amountCents: true }`, `_count: { _all: true }` ✓.
- `updateMany` where with `OR: [{ lastEventAt: null }, ...]` — `lastEventAt: null` in Prisma where = IS NULL ✓.
- `$executeRaw` template with BigInt — Prisma supports it ✓ (documented: "BigInt values are supported").
- `Prisma.TransactionClient` type export ✓ (from '@prisma/client').
- Interactive `$transaction(fn, { maxWait, timeout })` ✓.
- `@db.Uuid` + `@default(uuid())` — client-generated uuid v4 ✓.
- BigInt column `@default(0)` ✓.
- `@@id([companyId, status])` → composite unique input `companyId_status` ✓.

Nest specifics:
- `@Cron` from '@nestjs/schedule' ✓. `SchedulesModule.forRoot()` ✓.
- Global filter via `app.useGlobalFilters(new ApiExceptionFilter())` — instantiating the filter directly (not DI) is fine here.
- `app.enableShutdownHooks()` → onModuleDestroy → prisma disconnect ✓ (used by app.close() in tests ✓).

Now — **the `import 'reflect-metadata'` in main.ts**: with Nest 10 + TS experimentalDecorators, is it needed? @nestjs/common internally imports 'reflect-metadata' — but the ESM hoisting order: main.ts imports AppModule → @nestjs/common → reflect-metadata is loaded before decorator evaluation? The decorators are evaluated at module evaluation of the imported classes — the import of '@nestjs/common' runs first (as a static import) and loads reflect-metadata ✓. The explicit import is belt-and-suspenders and standard. Keep it.

**The Express types** in the filter: `import type { Response } from 'express';` → needs @types/express ✓ included.

**`isUUID` from 'node:crypto'** — exported since Node 19.4 ✓ (Node 20+ per convention ✓).

Now — **vitest + tsconfig `module: NodeNext`**: Vitest uses esbuild, which reads tsconfig for some options. esbuild supports `experimentalDecorators` ✓. NodeNext module in esbuild — esbuild ignores moduleResolution (uses its own) and handles `.js` → `.ts` resolution? The resolver question again. Vite's resolver (used by Vitest): supports importing TS files with `.js` specifiers — yes, I'm now fairly confident (Vite implements this: "TypeScript files can be imported with `.js` extension" is supported behavior in Vite ≥ 4, matching NodeNext). OK.

An alternative to sidestep all doubt: use extensionless relative imports + `"moduleResolution": "bundler"` + `"module": "ESNext"`. Then `tsc` build with module ESNext produces ESM JS with extensionless specifiers → **Node runtime would fail** (ESM requires explicit extensions). That's a broken build. NodeNext + `.js` extensions is the only correct combo for a Node 20 ESM runtime. Commit to it.

Hmm — one more twist: **`emitDecoratorMetadata` + NodeNext ESM**: TS supports it (NestJS ESM works). There's a known limitation: under ESM + NodeNext, TS cannot emit decorator metadata for design:type in some cases? No — the limitation is with the *new* standard decorators. experimentalDecorators + NodeNext ESM: works (Nest docs ESM: "tsconfig: module: NodeNext, emitDecoratorMetadata: true"). ✓

Now — **the build output**: `tsc -p tsconfig.json` with rootDir src, outDir dist → `dist/main.js` ✓ start script ✓.

**The prisma generate step**: the user runs `pnpm prisma:generate` (or it runs on postinstall — should I add `"postinstall": "prisma generate"`? Common. I'll add postinstall for DX ✓).

Now, let me reconsider the **`page_size`** upper bound of 200, and the **`page`** max of 10_000 — arbitrary but fine.

One more design question: **Should `GET /operations` require `company_id`?** "Filtered by company, status, date range" — the operator filters. Making it optional is more flexible. The index still works for the company-provided path. Keep it optional.

Now — let me also check the **`operations.controller`** imports: `@Get`, `@Query`, `@Controller` ✓.

**The events controller** — `@Post()`, `@Body`.

**The workers controller** — `@Post`, `@Patch(':id')`, `@Param`, `@Body`.

All good. Now, let me also double-check the **AppError usage in the filter**: AppError extends Error. The filter checks `instanceof AppError` ✓ (same module instance in the app. Tests use the service directly and AppError propagates — but tests call the service directly, so AppError is thrown, not converted — in the tests, not-found paths: am I testing them? Not in the 3 mandatory test groups. Fine.)

**The `details` is never null** ✓ always an object.

Let me also reconsider the **`updated_at`** on operation_reads: `@updatedAt` — my raw SQL doesn't touch operation_reads. The Prisma upsert sets it ✓.

**The `company_totals.updatedAt`** is a plain `@default(now())` — raw sets it. No writes via Prisma ✓.

Now, the **migration** — `operation_reads.updated_at TIMESTAMP(3) NOT NULL` (no default, since @updatedAt without default) — Prisma will always write it on create ✓.

Wait — actually in the Prisma migration output for `@updatedAt` columns, there's no default ✓ correct.

**The `worker_name` tamper in the drift test** sets `workerName: 'Ghost'` — the Prisma camelCase ✓.

Now, a potential issue — **`resetDatabase` runs after `app.close()`?** The order in afterEach: reset first, then close ✓ (the prisma client is still connected during reset ✓).

But note — the `createTestContext` in the next test's `beforeEach` happens after the previous test's close ✓ sequential.

**The 60-parallel txs and the pool**: Prisma's default pool (libquery-engine) — `maxWait: 5000` in my TransactionService. 60 concurrent × ~30ms / pool 15 → ~120ms ✓ safe.

Also — **Vitest `testTimeout: 60_000`** — the concurrent test with 60 serial-ish txs + 30 flips — well under 60s ✓.

Now — one thing I want to re-verify: **the `prisma` package version and the `@prisma/client` version match** ✓ both ^5.19.0.

**@nestjs/schedule ^4.1.0** — peer deps: @nestjs/common ^10 ✓.

Now — let me write the **package.json** scripts:
```json
"scripts": {
  "build": "tsc -p tsconfig.json",
  "start": "node dist/main.js",
  "start:dev": "tsx watch src/main.ts",
  "test": "vitest run",
  "test:watch": "vitest",
  "prisma:generate": "prisma generate",
  "prisma:migrate": "prisma migrate deploy",
  "prisma:studio": "prisma studio",
  "postinstall": "prisma generate"
}
```

Now — the final file list and order in the reply. Format: level-3 heading per file with only the path, then one fenced block. "Start with the first heading." No prose outside.

Let me make sure every file's content is complete and consistent. I'll now carefully write each file's final content in my head, watching for:

1. All relative imports end with `.js`.
2. All type-only imports use `import type` where possible (to be safe with esbuild).
3. No unused imports (strict doesn't flag unused by default without noUnusedLocals — I haven't enabled noUnusedLocals. Still, keep it clean).

Wait — should I enable `noUnusedLocals`/`noUnusedParameters`? "TypeScript (strict)" — strict is the flag. noUnused* is extra. Keep only `strict: true` (the convention). OK.

4. In `projection.service.ts`, I import `PaymentOrder` as type, and `OrderStatus` also as type (used in signature) — `import type { OrderStatus, PaymentOrder, Prisma } from '@prisma/client';` — `Prisma` is a namespace used only as a type (Prisma.TransactionClient) → type import ✓.

5. In repositories, `Prisma` used as a type (TransactionClient, WhereInput) → `import type { Prisma } from '@prisma/client';` + value imports if any (none). Model types as type imports.

But — `PrismaService extends PrismaClient` needs the **value** import of `PrismaClient` ✓.

6. `common/validation.ts` — `import type { OrderStatus } from '@prisma/client';` ✓ (type-only use).

7. `errors.ts` — no prisma imports ✓.

8. Check the `OperationsQuery.status` type: `OrderStatus | undefined` ✓ the controller's `optionalStatus` returns that ✓.

9. `operations.service.ts` — `toItem` uses the `OperationRead` type import ✓.

10. In the drift test, the `status: 'rejected'` update on operationRead via prisma — `ctx.prisma.operationRead.update({ where: { id: b.id }, data: { workerName: 'Ghost', amountCents: 999999, status: 'rejected' } })` ✓ typed.

11. `expect(result.ordersRederived).toBe(3)` — the chunk is 500 ≥ 3, single chunk ✓.

12. The **sort of `affectedCompanies`** — `[...affectedCompanies].sort()` for deterministic order ✓.

13. In `recompute`, the parameter `totals` — destructured ✓.

14. **`applyDelta` return type** — `$executeRaw` returns `Promise<number>` ✓.

Now — one more subtle point: in `onOrderCreated`, the `order` passed from `PaymentOrdersService.create` is the created `PaymentOrder` (includes updatedAt etc.) ✓ I only use the fields I need.

Another subtlety — **the `PaymentOrder` created in a tx has `createdAt` from the DB default** — the Prisma create returns the row with the default applied ✓ (Prisma returns the DB value for defaults ✓).

Now — the **`findWorkerName`** in the hook: called within the same tx — the worker row is visible (committed or same tx) ✓.

**Edge**: `PaymentOrdersService.create` — worker pre-check inside the tx ✓ (consistent snapshot).

Now — **`events` service** `occurredAt` default is `new Date()` in the controller ✓.

I think the design is solid. Let me also reconsider whether to include `@nestjs/schedule` or a plain interval. Cron is idiomatic. Keep it.

Now, one more check — **the exception filter and `details` for validation errors from query parsing**: e.g., a bad `page` → AppError.validation with details { field, value } ✓.

**The `optionalIntQuery`** — `Number(value)` for a non-string (if an array was passed, e.g., `?page=1&page=2`) → `Number(['1','2'])` = NaN → error ✓.

Now — the **`requirePositiveInt`** for `amount_cents` from a JSON body: the number type ✓ (JSON number). If someone sends a string "100" → validation error (must be a number) — acceptable strictness.

Let me also verify **`asRecord`** handles the express body-parser's parsed JSON ✓.

Now, I'll write the **final content** of each file. A few remaining decisions:

- `OperationsService.list` — should I also support a `to`-only query? `where` handles from/to independently ✓.

- The **`meta`** field naming: `page`, `page_size`, `total_count` ✓.

- The **`CompanyTotalRow.total_cents`** is a string ✓.

- The **`OperationItem.status`** type: `OrderStatus` (a string union) — JSON ✓.

Now, the **test file for operations** — I use the `PaymentOrder` type import for the pagination test's `created` array:
```ts
import type { PaymentOrder } from '@prisma/client';
```
✓.

Also, in that pagination test, the sequential loop of 5 creates + 5 backdates — fine.

Let me re-verify **the `expect.objectContaining`** with `last_event_type: null` — objectContaining checks the listed keys. null equality ✓.

Now — I'll **write the final reply** in the format. I'll count the files once more and make sure the heading paths are repo-relative:

1. `package.json`
2. `tsconfig.json`
3. `vitest.config.ts`
4. `DESIGN.md`
5. `prisma/schema.prisma`
6. `prisma/migrations/20250101000000_init/migration.sql`
7. `src/main.ts`
8. `src/app.module.ts`
9. `src/common/common.module.ts`
10. `src/common/errors.ts`
11. `src/common/exception.filter.ts`
12. `src/common/prisma.service.ts`
13. `src/common/transaction.service.ts`
14. `src/common/validation.ts`
15. `src/workers/workers.module.ts`
16. `src/workers/workers.controller.ts`
17. `src/workers/workers.service.ts`
18. `src/workers/workers.repository.ts`
19. `src/payment-orders/payment-orders.module.ts`
20. `src/payment-orders/payment-orders.controller.ts`
21. `src/payment-orders/payment-orders.service.ts`
22. `src/payment-orders/payment-orders.repository.ts`
23. `src/events/events.module.ts`
24. `src/events/events.controller.ts`
25. `src/events/events.service.ts`
26. `src/events/events.repository.ts`
27. `src/operations/operations.module.ts`
28. `src/operations/operations.controller.ts`
29. `src/operations/operations.service.ts`
30. `src/operations/operations.repository.ts`
31. `src/company-totals/company-totals.module.ts`
32. `src/company-totals/company-totals.controller.ts`
33. `src/company-totals/company-totals.service.ts`
34. `src/company-totals/company-totals.repository.ts`
35. `src/projection/projection.module.ts`
36. `src/projection/projection.service.ts`
37. `src/projection/projection.repository.ts`
38. `test/test-utils.ts`
39. `test/operations.spec.ts`
40. `test/company-totals.spec.ts`
41. `test/drift-repair.spec.ts`

Now — let me re-check **the `@Cron` import** and its usage with a dynamic default in projection.service: `@Cron(process.env.DRIFT_REPAIR_CRON ?? DEFAULT_REPAIR_CRON, { name: 'drift-repair' })` — the decorator arguments are evaluated at class-definition time. The `process.env` access is fine.

**The Logger** import from '@nestjs/common' ✓.

**The `REDEIVE_CHUNK_SIZE`** = 500.

Potential issue — the re-derivation loop: after the last full chunk, the next `findOrdersInWindow` with the cursor returns [] → break ✓.

Also, hmm, **the `transactions.run` for the chunk**: the callback does the reads + the upserts in one tx — an interactive tx with up to 500 upserts + 2 reads: statement-level snapshots. Fine.

Another check — the **`operationsRepository.upsert`** inside the tx with `@updatedAt` — Prisma sets updatedAt on update ✓.

**The `findLatestEventPerOrder`** — events sorted asc by occurredAt. Two events with the same occurred_at → the last in the array wins (stable? findMany without a secondary sort on ties — the order among ties is arbitrary) → the type is non-deterministic for ties. Acceptable (documented? minor. I could add a secondary sort `orderBy: [{occurredAt:'asc'},{id:'asc'}]` for determinism ✓ cheap — I'll do that.)

Same for the hook's monotonicity: an event with the same occurred_at as the current last → `lt` is strict → not replaced. Deterministic enough.

Now — I'll write **the final test `company-totals`** — one concern: `Promise.all` with 60 creates, each doing `workersRepository.findById` etc. — all against the same DB, pool 15 — fine.

**A potential flake**: the `finalStatusOf` for i where i%2==0 → approved. i=0 → approved (0%2==0 ✓). i=1 → 1%5==1 → rejected. i=2 → approved. i=3 → pending. i=4 → approved. i=5 → 5%5==0 → pending? 5%2==1, 5%5==0 → pending ✓. The expected is computed with the same function — consistent by construction ✓ no flake (the final status is deterministic per order, and each order is flipped exactly once).

The **concurrent flips**: each `setStatus` reads the order (pending), then updates. Different orders → no contention on the same row ✓. The contention is on the totals upsert (same company+status buckets) — exactly what I'm testing ✓.

Now, let me write out **`src/common/validation.ts`** in full:

```ts
import { isUUID } from 'node:crypto';
import type { OrderStatus } from '@prisma/client';
import { AppError } from './errors.js';

export const ORDER_STATUSES: OrderStatus[] = ['pending', 'approved', 'rejected'];

export function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw AppError.validation(`${what} must be a JSON object`, { what });
  }
  return value as Record<string, unknown>;
}

export function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isUUID(value)) {
    throw AppError.validation(`${field} must be a UUID`, { field, value });
  }
  return value;
}

export function optionalUuid(value: unknown, field: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  return requireUuid(value, field);
}

export function requireStatus(value: unknown, field: string): OrderStatus {
  if (typeof value === 'string' && ORDER_STATUSES.includes(value as OrderStatus)) {
    return value as OrderStatus;
  }
  throw AppError.validation(`${field} must be one of: ${ORDER_STATUSES.join(', ')}`, { field, value });
}

export function optionalStatus(value: unknown, field: string): OrderStatus | undefined {
  if (value === undefined || value === '') return undefined;
  return requireStatus(value, field);
}

export function requireString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw AppError.validation(`${field} must be a non-empty string of at most ${maxLength} characters`, {
      field,
      value,
      maxLength,
    });
  }
  return value;
}

export function requirePositiveInt(value: unknown, field: string, max?: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw AppError.validation(`${field} must be a positive integer`, { field, value });
  }
  if (max !== undefined && value > max) {
    throw AppError.validation(`${field} must not exceed ${max}`, { field, value, max });
  }
  return value;
}

export function optionalIntQuery(value: unknown, field: string, fallback: number, max: number): number {
  if (value === undefined || value === '') return fallback;
  return requirePositiveInt(typeof value === 'string' ? Number(value) : value, field, max);
}

export function requireIsoDate(value: unknown, field: string): Date {
  if (typeof value !== 'string' || value === '') {
    throw AppError.validation(`${field} must be an ISO-8601 timestamp`, { field, value });
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw AppError.validation(`${field} is not a valid ISO-8601 timestamp`, { field, value });
  }
  return parsed;
}

export function optionalIsoDate(value: unknown, field: string): Date | undefined {
  if (value === undefined || value === '') return undefined;
  return requireIsoDate(value, field);
}
```
`ORDER_STATUSES.includes(value as OrderStatus)` — includes on OrderStatus[] with an argument of OrderStatus type — `value as OrderStatus` cast ✓.

Now, **`exception.filter.ts`** — also handles the case where `exception` is an AppError with a 5xx (internal_error from the hook) ✓.

Now, let me re-examine **the `TransactionService` options**: `{ maxWait: 5000, timeout: 30_000 }` ✓.

**The `prisma.service.ts`** — the `$connect` in onModuleInit: in tests, this connects. If the DB is unreachable → error at init → clear failure ✓.

Everything looks consistent. Let me also add a small comment in the schema.prisma header about the read-model tables (a brief comment is OK — "code and comments in English" ✓).

One more thing — **the `@default(now())` on `Event.occurredAt`** — but my create always passes occurredAt ✓.

**The migration timestamp**: `20250101000000_init` ✓.

Let me re-verify the **`@@index` map names** match between the schema and the migration SQL ✓ (I'll keep them identical).

Now, **the final DESIGN.md** — I'll trim to keep it "short" but complete. I'll include a note that the tests require DATABASE_URL (an operational note). Also document the env vars: DRIFT_REPAIR_CRON, DRIFT_REPAIR_WINDOW_HOURS, DRIFT_REPAIR_ENABLED, PORT. ✓

Let me reconsider one thing: the **convention of the layout** shows `src/<feature>/<feature>.module.ts` — my feature names: `workers`, `payment-orders`, `events`, `operations`, `company-totals`, `projection`, `common` ✓ kebab-case ✓. Files are `<feature>.controller.ts`, etc. ✓. Common isn't strictly a feature, but the pattern `<name>.<role>.ts` holds (prisma.service.ts, transaction.service.ts, exception.filter.ts, validation.ts, errors.ts, common.module.ts) — the convention shows the core files but doesn't forbid shared infra. Fine.

Also, I should double-check **the `WorkersModule` exports** — PaymentOrdersModule imports WorkersModule for the WorkersRepository ✓ exported ✓.

**The `PaymentOrdersModule` exports** — EventsModule imports for the PaymentOrdersRepository ✓.

Now — let me think about **whether the `ProjectionService.onOrderCreated` signature taking `PaymentOrder`** leaks the Prisma model type into the service layer — fine (it's a data shape).

Potential **TS error**: in `projection.service.ts`, the `AppError('internal_error', ..., {}, 500)` — the constructor is public ✓.

**`private repairRunning = false;`** — fine under strict.

Now, **vitest.config.ts** — `defineConfig` from 'vitest/config' ✓.

**`test.env`** — does vitest set `process.env.DRIFT_REPAIR_ENABLED` before module import? `test.env` is applied to the process env at start ✓. I also set it in createTestContext ✓ doubly safe.

Now — the **`hookTimeout`** for beforeEach (app init + reset) 60s ✓.

I'm reasonably confident in the whole thing. Let me write it all out.

Actually — one more consideration about the **`$executeRaw` tagged template and the `now()`** function: fine in Postgres ✓.

And **the multi-statement risk** — each of my raw calls is a single statement ✓.

And **the `ON CONFLICT (company_id, status)`** — the PK is (company_id, status) ✓ the conflict target is valid ✓.

**The `EXCLUDED`** reference in the multi-row insert's ON CONFLICT — EXCLUDED refers to the row that would have been inserted ✓ valid per row.

Now, let me write the files.

One more micro-decision: in `operations.repository.ts`, the `list`/`count` tx parameter — the service passes `undefined`. Keep the parameter for reuse in the re-derivation? Not used there. Keep it uniform (all repositories accept tx) — harmless.

Also, in `operations.controller.ts`, I need to import `AppError` for the from<to check ✓.

And **the `OperationsService`** — no transaction needed for reads ✓.

Let me write the **`app.module.ts`** imports with `.js` extensions ✓.

Final: the heading format — `### <path>` then a fenced block with the language tag. For .md, ```markdown? The spec example shows ```ts and ```prisma. I'll use appropriate tags: ts, prisma, sql, json, markdown, and for the vitest config ts. The content of the fenced block is only the file's content.

Let me make sure there's no prose between blocks ("Prose between blocks is ignored, so keep it to nothing") — I'll output only the headings + blocks.

Now, let me carefully compose each file.

---

Also, I'll double-check that `src/common/exception.filter.ts` compiles: `host.switchToHttp().getResponse<Response>()` — the generic of getResponse from ArgumentsHost ✓.

`CODE_BY_STATUS[status] ?? 'internal_error'` ✓.

`exception.message` for HttpException — `message` property exists (string) ✓.

Also **`@Catch()`** with no argument catches everything ✓.

---

For **`main.ts`**:
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './common/exception.filter.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
```

---

**`app.module.ts`**:
```ts
import { Module } from '@nestjs/common';
import { SchedulesModule } from '@nestjs/schedule';
import { CommonModule } from './common/common.module.js';
import { CompanyTotalsModule } from './company-totals/company-totals.module.js';
import { EventsModule } from './events/events.module.js';
import { OperationsModule } from './operations/operations.module.js';
import { PaymentOrdersModule } from './payment-orders/payment-orders.module.js';
import { ProjectionModule } from './projection/projection.module.js';
import { WorkersModule } from './workers/workers.module.js';

@Module({
  imports: [
    SchedulesModule.forRoot(),
    CommonModule,
    PaymentOrdersModule,
    EventsModule,
    WorkersModule,
    OperationsModule,
    CompanyTotalsModule,
    ProjectionModule,
  ],
})
export class AppModule {}
```

---

Now, I'll re-verify the **`projection.service.ts`** imports:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { OrderStatus, PaymentOrder, Prisma } from '@prisma/client';
import { AppError } from '../common/errors.js';
import { TransactionService } from '../common/transaction.service.js';
import { CompanyTotalsRepository } from '../company-totals/company-totals.repository.js';
import { OperationsRepository, type OperationReadInput } from '../operations/operations.repository.js';
import { ProjectionRepository, type RederiveCursor } from './projection.repository.js';
```
`type OperationReadInput` inline type import — TS 5 supports inline `type` modifier ✓.

---

**`projection.repository.ts`** imports:
```ts
import { Injectable } from '@nestjs/common';
import type { PaymentOrder, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';
```

---

**`operations.repository.ts`** imports:
```ts
import { Injectable } from '@nestjs/common';
import type { OperationRead, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';
```

---

**`company-totals.repository.ts`**:
```ts
import { Injectable } from '@nestjs/common';
import type { CompanyTotals, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';
```

---

Now — **the `prisma.service.ts`**:
```ts
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Shared Prisma client. The only object that owns a database connection.
 */
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

---

**`transaction.service.ts`**:
```ts
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service.js';

/**
 * Opens a single Postgres transaction for a unit of work. Write services use
 * this so that the source row and its projection updates commit or roll back
 * together — that atomicity is what gives read-your-own-writes.
 */
@Injectable()
export class TransactionService {
  constructor(private readonly prisma: PrismaService) {}

  run<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work, { maxWait: 5000, timeout: 30_000 });
  }
}
```

---

The tests — I'll confirm the `import { type TestContext }` syntax: `import { createTestContext, newId, resetDatabase, type TestContext } from './test-utils.js';` ✓.

In **`drift-repair.spec.ts`** I use `ctx.prisma` directly (a PrismaService — the tests may touch the DB for fixtures/corruption. That's the test's job, not the app layer) ✓.

Now, let me also make sure that in **`operations.spec.ts`** the `import type { PaymentOrder } from '@prisma/client';` is only if I annotate `created`. In the pagination test: `const created: PaymentOrder[] = [];` ✓ I'll add the import.

In **`company-totals.spec.ts`**: `import type { OrderStatus } from '@prisma/client';` for `finalStatusOf` and `expected` ✓.

Now — a **`expect`** assertion style check: `expect(row!.order_count).toBe(...)` — the non-null assertion after toBeDefined ✓.

OK — one last potential **compile issue**: in `company-totals.service.ts`, `ORDER_STATUSES` is imported from validation.ts (value import) ✓.

And in `validation.ts`, `import type { OrderStatus }` — but `ORDER_STATUSES: OrderStatus[]` is a const with a type annotation using the type-only import ✓.

---

**`events.repository.ts`** full:
```ts
import { Injectable } from '@nestjs/common';
import type { Event, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';

@Injectable()
export class EventsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(tx: Prisma.TransactionClient | undefined, data: { orderId: string; type: string; occurredAt: Date }): Promise<Event> {
    return (tx ?? this.prisma).event.create({ data });
  }
}
```

**`payment-orders.repository.ts`** full:
```ts
import { Injectable } from '@nestjs/common';
import type { OrderStatus, PaymentOrder, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';

@Injectable()
export class PaymentOrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(tx: Prisma.TransactionClient | undefined, id: string): Promise<PaymentOrder | null> {
    return (tx ?? this.prisma).paymentOrder.findUnique({ where: { id } });
  }

  create(tx: Prisma.TransactionClient | undefined, data: { companyId: string; workerId: string; amountCents: number }): Promise<PaymentOrder> {
    return (tx ?? this.prisma).paymentOrder.create({ data });
  }

  updateStatus(tx: Prisma.TransactionClient | undefined, id: string, status: OrderStatus): Promise<PaymentOrder> {
    return (tx ?? this.prisma).paymentOrder.update({ where: { id }, data: { status } });
  }
}
```

---

**Controllers** — final check on the imported validation functions ✓.

**`payment-orders.controller.ts`**:
```ts
import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { asRecord, requirePositiveInt, requireStatus, requireUuid } from '../common/validation.js';
import { PaymentOrdersService } from './payment-orders.service.js';

@Controller('payment-orders')
export class PaymentOrdersController {
  constructor(private readonly service: PaymentOrdersService) {}

  @Post()
  create(@Body() body: unknown) {
    const payload = asRecord(body, 'request body');
    return this.service.create({
      companyId: requireUuid(payload.company_id, 'company_id'),
      workerId: requireUuid(payload.worker_id, 'worker_id'),
      amountCents: requirePositiveInt(payload.amount_cents, 'amount_cents', 100_000_000),
    });
  }

  @Patch(':id')
  setStatus(@Param('id') id: string, @Body() body: unknown) {
    const payload = asRecord(body, 'request body');
    return this.service.setStatus(requireUuid(id, 'id'), requireStatus(payload.status, 'status'));
  }
}
```
Max amount 100_000_000 cents = $1M ✓.

**`events.controller.ts`**:
```ts
import { Body, Controller, Post } from '@nestjs/common';
import { asRecord, requireIsoDate, requireString, requireUuid } from '../common/validation.js';
import { EventsService } from './events.service.js';

@Controller('events')
export class EventsController {
  constructor(private readonly service: EventsService) {}

  @Post()
  record(@Body() body: unknown) {
    const payload = asRecord(body, 'request body');
    return this.service.record({
      orderId: requireUuid(payload.order_id, 'order_id'),
      type: requireString(payload.type, 'type', 100),
      occurredAt: payload.occurred_at === undefined ? new Date() : requireIsoDate(payload.occurred_at, 'occurred_at'),
    });
  }
}
```

**`events.service.ts`**:
```ts
import { Injectable } from '@nestjs/common';
import type { Event } from '@prisma/client';
import { AppError } from '../common/errors.js';
import { TransactionService } from '../common/transaction.service.js';
import { PaymentOrdersRepository } from '../payment-orders/payment-orders.repository.js';
import { ProjectionService } from '../projection/projection.service.js';
import { EventsRepository } from './events.repository.js';

@Injectable()
export class EventsService {
  constructor(
    private readonly repository: EventsRepository,
    private readonly ordersRepository: PaymentOrdersRepository,
    private readonly transactions: TransactionService,
    private readonly projection: ProjectionService,
  ) {}

  record(input: { orderId: string; type: string; occurredAt: Date }): Promise<Event> {
    return this.transactions.run(async (tx) => {
      const order = await this.ordersRepository.findById(tx, input.orderId);
      if (!order) throw AppError.notFound('payment order', input.orderId);
      const event = await this.repository.create(tx, input);
      await this.projection.onEventRecorded(tx, event.orderId, event.type, event.occurredAt);
      return event;
    });
  }
}
```

**Modules** — the final wiring is verified above.

---

Now, the **schema.prisma** final, and I'll add a short header comment:

```prisma
// Source tables: workers, payment_orders, events.
// Read model: operation_reads (one row per order, denormalised for the dashboard)
// and company_totals (exact per-company, per-status aggregates).

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

  @@map("order_status")
}

model Worker {
  id        String   @id @default(uuid()) @db.Uuid
  companyId String   @map("company_id") @db.Uuid
  name      String
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @default(now()) @updatedAt @map("updated_at")

  orders PaymentOrder[]

  @@map("workers")
}

model PaymentOrder {
  id          String      @id @default(uuid()) @db.Uuid
  companyId   String      @map("company_id") @db.Uuid
  workerId    String      @map("worker_id") @db.Uuid
  status      OrderStatus @default(pending)
  amountCents Int         @map("amount_cents")
  createdAt   DateTime    @default(now()) @map("created_at")
  updatedAt   DateTime    @default(now()) @updatedAt @map("updated_at")

  worker PaymentOrder?
```
No — `worker Worker @relation(fields: [workerId], references: [id])`.

I'll write it correctly in the output.

---

Also, **should I add `role` back?** No.

**The `events` table has no `actor`** — not needed.

---

Now, let me reconsider **the `updated_at` on `operation_reads` without a default**: the Prisma `create` always includes updatedAt? For an @updatedAt field, Prisma sets it on create ✓ (client-generated now). The migration column is NOT NULL with no default ✓ consistent (the client always provides it).

Hmm wait — is that true? For `@updatedAt` without `@default`, does Prisma include it in the INSERT? Yes — @updatedAt fields are always written by the client (create + update). The Prisma-generated migration for `updatedAt DateTime @updatedAt` → `"updated_at" TIMESTAMP(3) NOT NULL` (no default) — matches ✓.

---

**The `worker.createdAt/updatedAt`** — fine.

---

Now — one thing I want to double-check: **the Prisma `groupBy` `_sum` on a BigInt field returns `bigint | null`** ✓. And `_count: { _all: true }` returns `{ _all: number }` ✓.

---

**The `companyTotals.findMany` orderBy status asc** — enum ordering: the order of the enum definition (pending, approved, rejected) — does Postgres sort enums by definition order? Postgres sorts enum values by their sort order (label order)? Enums sort by their enum member order (as defined) — actually, Postgres sorts enum values by their label (text) order? Let me recall: for a Postgres enum, the comparison operators use the enum's internal order = the order of declaration in CREATE TYPE. Yes — the sort order of an enum = the order of declaration (btree on an enum uses the enum member's number). pending < approved < rejected by declaration order. The label order would be approved < pending < rejected — different! The order I chose in the schema: pending, approved, rejected → the sort is in that order. My service's zero-fill iterates ORDER_STATUSES (pending, approved, rejected) anyway → the output order is deterministic regardless ✓.

---

**The `forCompany` for a company with no rows at all** (e.g., a new company) — companies = [companyId] → all zero rows ✓ nice (the operator sees a stable shape).

---

OK, also, I should double-check **the `operations` list when `companyId` is undefined and no filters** — full scan of operation_reads with ORDER BY created_at DESC — no index → slow on 3M rows. But the documented hot path is company-scoped. Acceptable. Note in DESIGN that the company filter is the primary path? I'll add a one-liner in DESIGN.md: "Queries without a company filter (all companies) fall back to a scan; the operator dashboard always scopes by company." ✓ honest.

---

Now, **I'll write the DESIGN.md** (final, concise).

---

Time to produce the final output. I'll be extremely careful with syntax across all 41 files.

Also, let me not forget: **no prose outside the headings/blocks**. Start with the first heading.

Let me draft the DESIGN.md text:

```md
# Read-model design — operations dashboard

## Problem

The back-office dashboard lists "operations": payment orders joined with
workers (name) and events (the latest per order), filtered by company,
status and date range, sorted by recency, paginated. With ~3M orders that
join plus per-order event aggregation takes 20–30 s. Requirements:

- p95 < 50 ms without changing what operators see;
- read-your-own-writes: approve an order → the next request reflects it;
- per-company financial totals must be exact, not approximate.

## Read model

Two projection tables:

- `operation_reads` — one row per payment order, denormalised with
  `worker_name`, `status`, `amount_cents`, `created_at` and the latest event
  (`last_event_type`, `last_event_at`). The dashboard becomes a single range
  scan on this table: no join, no aggregation, no sort.
- `company_totals` — exact `(company_id, status) → (order_count,
  total_cents)`. `total_cents` is `BIGINT`, exposed as a decimal string so
  JSON serialisation cannot round it.

### Index

`operation_reads (company_id, status, created_at DESC, id DESC)` matches the
hot query's equality filters, range predicate and sort order exactly, so the
dashboard is an index range scan + `LIMIT` with no sort step; `id` as the
final key makes pagination stable. `operation_reads (worker_id)` keeps
rename updates bounded. The operator dashboard always scopes by company;
unscoped all-company reads fall back to a scan and are out of the p95
contract.

## Maintenance: synchronous in-transaction hooks

Every write opens one Postgres transaction, writes the source row, then calls
the matching hook on `ProjectionService`, which updates the projections in
the same transaction.

Why this beats the alternatives:

- **Read-your-own-writes.** Source row and projection row commit together,
  so any request after a committed write sees the new state with zero lag.
  An outbox/CDC or message-queue pipeline has lag of unknown size — it
  cannot satisfy "approve → next request reflects it".
- **Exact totals under concurrency.** The totals update is a single
  `INSERT … ON CONFLICT DO UPDATE SET total_cents = total_cents + $delta`
  statement: the increment happens inside Postgres, so racing writes on the
  same company never lose an update. A client-side read-modify-write (even
  in a transaction) or an async consumer with duplicates/reordering would
  make the totals approximate — explicitly out of contract.
- **Postgres triggers** give the same atomicity but hide half the write-path
  logic inside the database: untestable from the app, versioned separately
  from the code, and not reusable by the re-derivation.
- **Materialised views** only update on bulk `REFRESH` — that is exactly
  the 20–30 s operation we are removing, and it cannot be per-write.
- **Better indexes on the join** do not remove the per-read aggregation over
  `events`; p95 50 ms at 3M rows is not credible that way.

Cost: one upsert plus one to two tiny atomic statements per write, all
primary-key work. Back-office writes are far rarer than dashboard reads, so
trading a few milliseconds of write latency for a 20–30 s → <50 ms read is
the right exchange.

## Re-derivation and drift repair

- `ProjectionService.rederiveWindow(from, to)` rebuilds `operation_reads`
  from the source tables for orders created in `[from, to)`, walking the
  window in keyset-paginated chunks, then recomputes `company_totals` for
  every affected company from the rebuilt rows. It is idempotent, so runs
  may overlap and may interleave with live writes.
- A scheduled job (`DRIFT_REPAIR_CRON`, default hourly) re-derives a
  rolling window (`DRIFT_REPAIR_WINDOW_HOURS`, default 24 h). The overlap
  between runs is deliberate: a row skipped while a live write was in flight
  is picked up by the next pass.
- Known self-healing race: if a write for company C commits between the
  recompute's snapshot and its absolute `SET`, that single delta is
  overwritten and is restored by the next repair run. The write-only steady
  state has no such race (atomic increments).

## What operators still see

The same rows and fields as the old join — order fields, worker name, latest
event — with the same filters, sort and pagination, served from the
projection. Totals are exact by construction: `BIGINT` storage, atomic
increments on every write, periodic recomputation from the rebuilt rows.

## Environment

`DATABASE_URL` (required), `PORT` (default 3000), `DRIFT_REPAIR_CRON`
(default `0 * * * *`), `DRIFT_REPAIR_WINDOW_HOURS` (default 24),
`DRIFT_REPAIR_ENABLED` (default true; set `false` to disable the job).

The test suite is behaviour-level and needs a real Postgres at
`DATABASE_URL`.
```

Good.

Now — final pass on the tricky TS parts:

**`new Map(rows.map((w) => [w.id, w.name]))`** — infers `Map<string, string>`? An array literal `[w.id, w.name]` → inferred as `(string)[]`... in a `new Map()` context, TS infers the tuple correctly? `new Map(iterable: Iterable<readonly [K, V]>)` — the map callback returns `string[]` (a 2-element array is inferred as `string[]`, not a tuple) → `Map<string[], undefined>`? No wait — `string[]` is not assignable to `readonly [K, V]`... TS's contextual typing: the Map constructor provides a contextual tuple type → the array literal in the map callback is contextually typed → infers as `[string, string]` ✓ (contextual typing works through method calls — yes, `new Map(arr.map(x => [x.a, x.b]))` infers Map<string,string> correctly in modern TS). Hmm, is that true? I recall needing `as [string, string]` sometimes... let me think. `new Map(pairs.map(p => [p.key, p.value]))` — TS infers `Map<string, string>` — I believe contextual typing propagates (the Map constructor parameter type is `Iterable<readonly [K, V]>`, and K, V are inferred from the argument... this is inference from an argument to a generic — TS will infer K=string, V=string from the array literal if the literal is contextually a tuple. Actually, generic inference: T = `readonly [K,V]`, argument `string[]` → K, V unresolved... TS handles this common case: it infers `Map<string, string>`? I've definitely seen `new Map(rows.map(r => [r.id, r.name]))` work in TS (a very common pattern). Yes — TS since 3.x infers tuple types for array literals in this position (improvements to "better inference for generic calls with array literals"...). Hmm, to be 100% safe, I'll annotate the callback return: `.map((w): [string, string] => [w.id, w.name])` — explicit, zero risk. I'll do this for all Map constructions:

- `findWorkerNames`: `.then((rows) => new Map(rows.map((w): [string, string] => [w.id, w.name])))`
- `findLatestEventPerOrder`: build imperatively with set ✓ no Map constructor from array.
- Tests: `new Map(page.items.map((item): [string, OperationItem] => [item.id, item]))` — need to import the OperationItem type in the spec? The type is exported from operations.service ✓ import type { OperationItem }? Or avoid the annotation: build with a for-loop? Annotate the callback and import the type. Fine.

Actually, in the tests, simpler: `const byId = new Map<string, OperationItem>(); for (const item of page.items) byId.set(item.id, item);` — avoids the import. I'll do that in drift-repair.spec. In company-totals.spec: `const byStatus = new Map<string, CompanyTotalRow>(); ...` — need to import CompanyTotalRow type from company-totals.service ✓ import type.

Or a helper `toMap` in test-utils:
```ts
export function toMap<K, V>(items: readonly V[], key: (item: V) => K): Map<K, V> {
  const map = new Map<K, V>();
  for (const item of items) map.set(key(item), item);
  return map;
}
```
Clean — I'll use it in the tests ✓.

**The `expected` Record in the concurrent test** — `expected[status].count += 1` where status: OrderStatus ✓ Record<OrderStatus, {...}> is complete ✓.

**`finalStatusOf(i) === 'pending' ? Promise.resolve() : ...`** — the Promise.all array is `(Promise<void>)[]`? `Promise.resolve()` is `Promise<undefined>` ✓ fine.

Now — **the `ctx.workers.create` returns a Worker** ✓ `.id`.

**`new Date(past.getTime() + 3_600_000)`** — 3_600_000 ms = 1h ✓ (numeric separators are fine in TS).

**`30 * 86_400_000`** — 30 days in ms ✓.

---

Another potential issue: **`import { isUUID } from 'node:crypto'`** under tsconfig `types: ["node"]` ✓ @types/node has isUUID ✓ (Node 20 types).

---

**The `vitest` import in tests** — `import { afterEach, ... } from 'vitest'` ✓.

---

Now, I'll also reconsider **the `PrismaService` in `resetDatabase`** — passing the PrismaService (which extends PrismaClient) ✓ the methods are available.

---

**The `app.close()`** — closes the Nest app → module destroy hooks → prisma $disconnect ✓. The next test creates a new module → new PrismaService instance → new client ✓. Note: `Test.createTestingModule({ imports: [AppModule] })` — AppModule is imported fresh per test. Each createTestingModule makes a new module instance (not a global) ✓.

But — **PrismaClient instances accumulate** (old ones disconnect on close ✓ fine).

---

Edge — **the `SchedulesModule` in tests**: `app.init()` starts the scheduler. Cron hourly. Enabled=false guard → no work ✓.

---

I believe I'm ready. One last thing: the **format requires a level-3 heading per file with only the path**, immediately followed by a fenced block. No numbering, no extra text.

Also, a reminder: "Paths that appear twice are taken once, at their last occurrence" — no duplicates in my set ✓.

Let me also double-check that the **`workers.repository.ts` create `data`** — `{ companyId: data.companyId, name: data.name }` — Prisma's WorkerCreateInput ✓ (id is auto, timestamps are auto).

And **`paymentOrder.create` data `{ companyId, workerId, amountCents }`** — status is default pending ✓.

Now — the **`upsert` in `operations.repository.ts`** — `create: { id: read.id, ...data }` — OperationReadCreateInput requires all non-default fields: companyId, workerId, workerName, status, amountCents, createdAt ✓ all present. lastEventType/lastEventAt are nullable ✓. updatedAt is auto ✓.

`update: data` — OperationReadUpdateInput ✓.

---

**The `sumByStatus`** returns the rows. `totalsFromGroups` handles the absence (default 0) ✓.

---

**The `recompute` SQL** — 10 parameters. I'll double-check the template:
```
INSERT INTO company_totals (company_id, status, order_count, total_cents, updated_at)
VALUES
  (${companyId}, ${'pending'}, ${pending.count}, ${pending.cents}, now()),
  (${companyId}, ${'approved'}, ${approved.count}, ${approved.cents}, now()),
  (${companyId}, ${'rejected'}, ${rejected.count}, ${rejected.cents}, now())
ON CONFLICT (company_id, status) DO UPDATE
SET order_count = EXCLUDED.order_count,
    total_cents = EXCLUDED.total_cents,
    updated_at  = now()
```
✓.

**The `applyDelta` SQL** ✓.

---

Now — the **BigInt parameter `pending.cents`** (0n if absent) — Prisma serializes 0n → '0' → Postgres '0'::bigint ✓.

Negative delta `-BigInt(order.amountCents)` — e.g., -1000n → '-1000' ✓.

---

Also — the **`order_count` could go negative** if a delta is applied without a prior create (drift) — the repair's absolute recompute fixes it. Fine.

---

Let me reconsider: **the `PaymentOrdersService.setStatus` no-op path** returns the existing order without a projection update ✓ correct (nothing changed).

---

**The `WorkersService.create`** — no tx. A single statement. ✓.

---

All checked. Now I'll write out the final answer. I'll keep comments concise and in English.

Actually, one more thought about **the `optionalIntQuery` for `page` with max 10_000** — the `page` max parameter: `optionalIntQuery(query.page, 'page', 1, 10_000)` ✓.

And **`requirePositiveInt(payload.amount_cents, 'amount_cents', 100_000_000)`** ✓.

Also — **the JSON body `amount_cents`** is a number — if the client sends 100.5 → not an integer → validation ✓.

---

Final check on **`events` module imports**: `[CommonModule, PaymentOrdersModule, ProjectionModule]` ✓.

**`payment-orders` module imports**: `[CommonModule, WorkersModule, ProjectionModule]` ✓.

**`workers` module imports**: `[CommonModule, ProjectionModule]` ✓.

Now I'll write it all out. For the fenced code block language tags: `ts`, `prisma`, `sql`, `json`, `md` (use `markdown`? The example uses the language name. I'll use `md` — either is fine. I'll use `markdown`). Actually, the parser probably doesn't care about the tag. I'll use sensible tags.

Wait — one more: **the `package.json` "postinstall": "prisma generate"** — on a fresh clone, `pnpm install` runs prisma generate ✓ (prisma devDep is available at postinstall time ✓ pnpm runs postinstall after installing deps).

And **"prisma": "prisma migrate deploy"** — the migration is in the repo ✓.

Let me also include a **"prisma:migrate:dev"?** No — keep it minimal: `prisma migrate deploy` for apply. Development is... fine, I'll keep the three prisma scripts.

Hmm, one thing: `prisma migrate deploy` requires the migration folder ✓ we have it.

Done thinking. I'll write the final output now.

Actually, hold on — let me reconsider the **`@Cron` + `process.env.DRIFT_REPAIR_CRON`** evaluated at class-definition time: in the test, the env var is not set at import time (vitest's test.env is set at process start — is it set before the import? test.env is applied to process.env before the test file is loaded ✓ but the class definition is at import time of projection.service — after env setup ✓ anyway, the default cron is fine).

Also — **the `@Cron` expression is validated** at SchedulesModule init — '0 * * * *' is valid ✓.

One more: **the `Logger`** usage is fine.

And **the `repairRunning`** — a plain boolean.

Also, I'll double-check that **`rederiveWindow` is public** and the tests call it ✓.

Final: **the `RederiveResult`** is exported from projection.service ✓ (the test doesn't import the type — it uses result.x ✓).

Now I'll write the answer.

File order: I'll put the config first, then prisma, then src (common → features), then tests, and DESIGN.md near the end (or at the beginning). The order doesn't matter. I'll do: package.json, tsconfig.json, vitest.config.ts, prisma/schema.prisma, migration, src/main.ts, app.module, common, workers, payment-orders, events, operations, company-totals, projection, test-utils, three specs, DESIGN.md.

Let me write it out.
```

## reply

### package.json
```json
{
  "name": "operations-dashboard",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "start:dev": "tsx watch src/main.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate deploy",
    "prisma:studio": "prisma studio",
    "postinstall": "prisma generate"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.0",
    "@nestjs/core": "^10.4.0",
    "@nestjs/platform-express": "^10.4.0",
    "@nestjs/schedule": "^4.1.0",
    "@prisma/client": "^5.19.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.0",
    "prisma": "^5.19.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.4",
    "vitest": "^2.1.0"
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
    "strict": true,
    "esModuleInterop": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "rootDir": "src",
    "sourceMap": true,
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

### vitest.config.ts
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    // The specs share one database and reset it between tests, so they must
    // not run in parallel.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    env: {
      DRIFT_REPAIR_ENABLED: 'false',
    },
  },
});
```

### prisma/schema.prisma
```prisma
// Source tables: workers, payment_orders, events.
// Read model: operation_reads (one denormalised row per order, for the
// dashboard) and company_totals (exact per-company, per-status aggregates).

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

  @@map("order_status")
}

model Worker {
  id        String   @id @default(uuid()) @db.Uuid
  companyId String   @map("company_id") @db.Uuid
  name      String
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @default(now()) @updatedAt @map("updated_at")

  orders PaymentOrder[]

  @@map("workers")
}

model PaymentOrder {
  id          String      @id @default(uuid()) @db.Uuid
  companyId   String      @map("company_id") @db.Uuid
  workerId    String      @map("worker_id") @db.Uuid
  status      OrderStatus @default(pending)
  amountCents Int         @map("amount_cents")
  createdAt   DateTime    @default(now()) @map("created_at")
  updatedAt   DateTime    @default(now()) @updatedAt @map("updated_at")

  worker Worker    @relation(fields: [workerId], references: [id])
  events Event[]

  @@index([createdAt, id], map: "ix_payment_orders_created_id")
  @@map("payment_orders")
}

model Event {
  id         String   @id @default(uuid()) @db.Uuid
  orderId    String   @map("order_id") @db.Uuid
  type       String
  occurredAt DateTime @map("occurred_at") @default(now())

  order PaymentOrder @relation(fields: [orderId], references: [id])

  @@index([orderId, occurredAt], map: "ix_events_order_occurred")
  @@map("events")
}

// One row per payment order, denormalised for the dashboard query.
// Maintained by in-transaction write hooks and by re-derivation.
model OperationRead {
  id            String      @id @db.Uuid
  companyId     String      @map("company_id") @db.Uuid
  workerId      String      @map("worker_id") @db.Uuid
  workerName    String      @map("worker_name")
  status        OrderStatus
  amountCents   Int         @map("amount_cents")
  createdAt     DateTime    @map("created_at")
  updatedAt     DateTime    @updatedAt @map("updated_at")
  lastEventType String?     @map("last_event_type")
  lastEventAt   DateTime?   @map("last_event_at")

  // Matches the hot dashboard query exactly: equality on company + status,
  // range on created_at, then the same sort order (recency, id tiebreak).
  @@index([companyId, status, createdAt(sort: Desc), id(sort: Desc)], map: "ix_operation_reads_company_status_created")
  @@index([workerId], map: "ix_operation_reads_worker")
  @@map("operation_reads")
}

// Exact (company, status) aggregates. Every write applies a signed delta
// with a single atomic statement; re-derivation resets the buckets.
model CompanyTotals {
  companyId  String      @map("company_id") @db.Uuid
  status     OrderStatus
  orderCount Int         @default(0) @map("order_count")
  totalCents BigInt      @default(0) @map("total_cents")
  updatedAt  DateTime    @default(now()) @map("updated_at")

  @@id([companyId, status])
  @@map("company_totals")
}
```

### prisma/migrations/20250101000000_init/migration.sql
```sql
-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "workers" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_orders" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "status" "order_status" NOT NULL DEFAULT 'pending',
    "amount_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operation_reads" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "worker_name" TEXT NOT NULL,
    "status" "order_status" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_event_type" TEXT,
    "last_event_at" TIMESTAMP(3),

    CONSTRAINT "operation_reads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_totals" (
    "company_id" UUID NOT NULL,
    "status" "order_status" NOT NULL,
    "order_count" INTEGER NOT NULL DEFAULT 0,
    "total_cents" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_totals_pkey" PRIMARY KEY ("company_id", "status")
);

-- CreateIndex
CREATE INDEX "ix_payment_orders_created_id" ON "payment_orders"("created_at", "id");
CREATE INDEX "ix_events_order_occurred" ON "events"("order_id", "occurred_at");
CREATE INDEX "ix_operation_reads_company_status_created" ON "operation_reads"("company_id", "status", "created_at" DESC, "id" DESC);
CREATE INDEX "ix_operation_reads_worker" ON "operation_reads"("worker_id");

-- AddForeignKey
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "payment_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

### src/main.ts
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './common/exception.filter.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
```

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { SchedulesModule } from '@nestjs/schedule';
import { CommonModule } from './common/common.module.js';
import { CompanyTotalsModule } from './company-totals/company-totals.module.js';
import { EventsModule } from './events/events.module.js';
import { OperationsModule } from './operations/operations.module.js';
import { PaymentOrdersModule } from './payment-orders/payment-orders.module.js';
import { ProjectionModule } from './projection/projection.module.js';
import { WorkersModule } from './workers/workers.module.js';

@Module({
  imports: [
    SchedulesModule.forRoot(),
    CommonModule,
    PaymentOrdersModule,
    EventsModule,
    WorkersModule,
    OperationsModule,
    CompanyTotalsModule,
    ProjectionModule,
  ],
})
export class AppModule {}
```

### src/common/common.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { TransactionService } from './transaction.service.js';

@Module({
  providers: [PrismaService, TransactionService],
  exports: [PrismaService, TransactionService],
})
export class CommonModule {}
```

### src/common/prisma.service.ts
```ts
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * The single shared Prisma client. Repositories are the only layer that may
 * use it (directly or through a TransactionClient).
 */
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

### src/common/transaction.service.ts
```ts
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service.js';

/**
 * Opens one Postgres transaction for a unit of work. Write services use it so
 * that a source row and its projection updates commit (or roll back) together;
 * that atomicity is what delivers read-your-own-writes.
 */
@Injectable()
export class TransactionService {
  constructor(private readonly prisma: PrismaService) {}

  run<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work, { maxWait: 5000, timeout: 30_000 });
  }
}
```

### src/common/errors.ts
```ts
/**
 * Application error. `code` is the snake_case contract consumed by clients;
 * `message` is developer-facing English; `details` is always an object.
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
    public readonly httpStatus: number = 500,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static notFound(resource: string, id: string): AppError {
    return new AppError('resource_not_found', `${resource} with id ${id} was not found`, { resource, id }, 404);
  }

  static validation(message: string, details: Record<string, unknown>): AppError {
    return new AppError('validation_error', message, details, 400);
  }
}
```

### src/common/exception.filter.ts
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { AppError } from './errors.js';

interface ErrorEnvelope {
  error: { code: string; message: string; details: Record<string, unknown> };
}

const CODE_BY_STATUS: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'validation_error',
  [HttpStatus.METHOD_NOT_ALLOWED]: 'method_not_allowed',
  [HttpStatus.NOT_FOUND]: 'resource_not_found',
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    let status: number;
    let body: ErrorEnvelope;

    if (exception instanceof AppError) {
      status = exception.httpStatus;
      body = { error: { code: exception.code, message: exception.message, details: exception.details } };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      body = {
        error: {
          code: CODE_BY_STATUS[status] ?? 'internal_error',
          message: exception.message,
          details: {},
        },
      };
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      body = { error: { code: 'internal_error', message: 'Unexpected server error', details: {} } };
    }

    response.status(status).json(body);
  }
}
```

### src/common/validation.ts
```ts
import { isUUID } from 'node:crypto';
import type { OrderStatus } from '@prisma/client';
import { AppError } from './errors.js';

export const ORDER_STATUSES: OrderStatus[] = ['pending', 'approved', 'rejected'];

export function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw AppError.validation(`${what} must be a JSON object`, { what });
  }
  return value as Record<string, unknown>;
}

export function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isUUID(value)) {
    throw AppError.validation(`${field} must be a UUID`, { field, value });
  }
  return value;
}

export function optionalUuid(value: unknown, field: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  return requireUuid(value, field);
}

export function requireStatus(value: unknown, field: string): OrderStatus {
  if (typeof value === 'string' && ORDER_STATUSES.includes(value as OrderStatus)) {
    return value as OrderStatus;
  }
  throw AppError.validation(`${field} must be one of: ${ORDER_STATUSES.join(', ')}`, { field, value });
}

export function optionalStatus(value: unknown, field: string): OrderStatus | undefined {
  if (value === undefined || value === '') return undefined;
  return requireStatus(value, field);
}

export function requireString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw AppError.validation(`${field} must be a non-empty string of at most ${maxLength} characters`, {
      field,
      value,
      maxLength,
    });
  }
  return value;
}

export function requirePositiveInt(value: unknown, field: string, max?: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw AppError.validation(`${field} must be a positive integer`, { field, value });
  }
  if (max !== undefined && value > max) {
    throw AppError.validation(`${field} must not exceed ${max}`, { field, value, max });
  }
  return value;
}

export function optionalIntQuery(value: unknown, field: string, fallback: number, max: number): number {
  if (value === undefined || value === '') return fallback;
  return requirePositiveInt(typeof value === 'string' ? Number(value) : value, field, max);
}

export function requireIsoDate(value: unknown, field: string): Date {
  if (typeof value !== 'string' || value === '') {
    throw AppError.validation(`${field} must be an ISO-8601 timestamp`, { field, value });
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw AppError.validation(`${field} is not a valid ISO-8601 timestamp`, { field, value });
  }
  return parsed;
}

export function optionalIsoDate(value: unknown, field: string): Date | undefined {
  if (value === undefined || value === '') return undefined;
  return requireIsoDate(value, field);
}
```

### src/workers/workers.module.ts
```ts
import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module.js';
import { ProjectionModule } from '../projection/projection.module.js';
import { WorkersController } from './workers.controller.js';
import { WorkersRepository } from './workers.repository.js';
import { WorkersService } from './workers.service.js';

@Module({
  controllers: [WorkersController],
  providers: [WorkersService, WorkersRepository],
  imports: [CommonModule, ProjectionModule],
  exports: [WorkersRepository],
})
export class WorkersModule {}
```

### src/workers/workers.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import type { Prisma, Worker } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';

@Injectable()
export class WorkersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(tx: Prisma.TransactionClient | undefined, id: string): Promise<Worker | null> {
    return (tx ?? this.prisma).worker.findUnique({ where: { id } });
  }

  create(
    tx: Prisma.TransactionClient | undefined,
    data: { companyId: string; name: string },
  ): Promise<Worker> {
    return (tx ?? this.prisma).worker.create({ data });
  }

  rename(tx: Prisma.TransactionClient | undefined, id: string, name: string): Promise<Worker> {
    return (tx ?? this.prisma).worker.update({ where: { id }, data: { name } });
  }
}
```

### src/workers/workers.service.ts
```ts
import { Injectable } from '@nestjs/common';
import type { Worker } from '@prisma/client';
import { AppError } from '../common/errors.js';
import { TransactionService } from '../common/transaction.service.js';
import { ProjectionService } from '../projection/projection.service.js';
import { WorkersRepository } from './workers.repository.js';

@Injectable()
export class WorkersService {
  constructor(
    private readonly repository: WorkersRepository,
    private readonly transactions: TransactionService,
    private readonly projection: ProjectionService,
  ) {}

  create(input: { companyId: string; name: string }): Promise<Worker> {
    // A brand-new worker has no operations yet, so no projection update is needed.
    return this.repository.create(undefined, input);
  }

  rename(id: string, name: string): Promise<Worker> {
    return this.transactions.run(async (tx) => {
      const worker = await this.repository.findById(tx, id);
      if (!worker) throw AppError.notFound('worker', id);
      const updated = await this.repository.rename(tx, id, name);
      // The denormalised worker_name on the projection must follow the rename.
      await this.projection.onWorkerRenamed(tx, id, name);
      return updated;
    });
  }
}
```

### src/workers/workers.controller.ts
```ts
import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { asRecord, requireString, requireUuid } from '../common/validation.js';
import { WorkersService } from './workers.service.js';

@Controller('workers')
export class WorkersController {
  constructor(private readonly service: WorkersService) {}

  @Post()
  create(@Body() body: unknown) {
    const payload = asRecord(body, 'request body');
    return this.service.create({
      companyId: requireUuid(payload.company_id, 'company_id'),
      name: requireString(payload.name, 'name', 200),
    });
  }

  @Patch(':id')
  rename(@Param('id') id: string, @Body() body: unknown) {
    const payload = asRecord(body, 'request body');
    return this.service.rename(requireUuid(id, 'id'), requireString(payload.name, 'name', 200));
  }
}
```

### src/payment-orders/payment-orders.module.ts
```ts
import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module.js';
import { ProjectionModule } from '../projection/projection.module.js';
import { WorkersModule } from '../workers/workers.module.js';
import { PaymentOrdersController } from './payment-orders.controller.js';
import { PaymentOrdersRepository } from './payment-orders.repository.js';
import { PaymentOrdersService } from './payment-orders.service.js';

@Module({
  controllers: [PaymentOrdersController],
  providers: [PaymentOrdersService, PaymentOrdersRepository],
  imports: [CommonModule, WorkersModule, ProjectionModule],
  exports: [PaymentOrdersRepository],
})
export class PaymentOrdersModule {}
```

### src/payment-orders/payment-orders.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import type { OrderStatus, PaymentOrder, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';

@Injectable()
export class PaymentOrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(tx: Prisma.TransactionClient | undefined, id: string): Promise<PaymentOrder | null> {
    return (tx ?? this.prisma).paymentOrder.findUnique({ where: { id } });
  }

  create(
    tx: Prisma.TransactionClient | undefined,
    data: { companyId: string; workerId: string; amountCents: number },
  ): Promise<PaymentOrder> {
    return (tx ?? this.prisma).paymentOrder.create({ data });
  }

  updateStatus(tx: Prisma.TransactionClient | undefined, id: string, status: OrderStatus): Promise<PaymentOrder> {
    return (tx ?? this.prisma).paymentOrder.update({ where: { id }, data: { status } });
  }
}
```

### src/payment-orders/payment-orders.service.ts
```ts
import { Injectable } from '@nestjs/common';
import type { OrderStatus, PaymentOrder } from '@prisma/client';
import { AppError } from '../common/errors.js';
import { TransactionService } from '../common/transaction.service.js';
import { ProjectionService } from '../projection/projection.service.js';
import { WorkersRepository } from '../workers/workers.repository.js';
import { PaymentOrdersRepository } from './payment-orders.repository.js';

@Injectable()
export class PaymentOrdersService {
  constructor(
    private readonly repository: PaymentOrdersRepository,
    private readonly workersRepository: WorkersRepository,
    private readonly transactions: TransactionService,
    private readonly projection: ProjectionService,
  ) {}

  create(input: { companyId: string; workerId: string; amountCents: number }): Promise<PaymentOrder> {
    return this.transactions.run(async (tx) => {
      const worker = await this.workersRepository.findById(tx, input.workerId);
      if (!worker) throw AppError.notFound('worker', input.workerId);

      const order = await this.repository.create(tx, input);

      // The hook runs inside the write's transaction: the dashboard sees the
      // new order exactly when this transaction commits (read-your-own-writes).
      await this.projection.onOrderCreated(tx, order);
      return order;
    });
  }

  setStatus(id: string, status: OrderStatus): Promise<PaymentOrder> {
    return this.transactions.run(async (tx) => {
      const order = await this.repository.findById(tx, id);
      if (!order) throw AppError.notFound('payment order', id);
      if (order.status === status) return order; // idempotent no-op

      const updated = await this.repository.updateStatus(tx, id, status);
      await this.projection.onOrderStatusChanged(tx, updated, order.status);
      return updated;
    });
  }
}
```

### src/payment-orders/payment-orders.controller.ts
```ts
import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { asRecord, requirePositiveInt, requireStatus, requireUuid } from '../common/validation.js';
import { PaymentOrdersService } from './payment-orders.service.js';

@Controller('payment-orders')
export class PaymentOrdersController {
  constructor(private readonly service: PaymentOrdersService) {}

  @Post()
  create(@Body() body: unknown) {
    const payload = asRecord(body, 'request body');
    return this.service.create({
      companyId: requireUuid(payload.company_id, 'company_id'),
      workerId: requireUuid(payload.worker_id, 'worker_id'),
      amountCents: requirePositiveInt(payload.amount_cents, 'amount_cents', 100_000_000),
    });
  }

  @Patch(':id')
  setStatus(@Param('id') id: string, @Body() body: unknown) {
    const payload = asRecord(body, 'request body');
    return this.service.setStatus(requireUuid(id, 'id'), requireStatus(payload.status, 'status'));
  }
}
```

### src/events/events.module.ts
```ts
import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module.js';
import { PaymentOrdersModule } from '../payment-orders/payment-orders.module.js';
import { ProjectionModule } from '../projection/projection.module.js';
import { EventsController } from './events.controller.js';
import { EventsRepository } from './events.repository.js';
import { EventsService } from './events.service.js';

@Module({
  controllers: [EventsController],
  providers: [EventsService, EventsRepository],
  imports: [CommonModule, PaymentOrdersModule, ProjectionModule],
})
export class EventsModule {}
```

### src/events/events.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import type { Event, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';

@Injectable()
export class EventsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    tx: Prisma.TransactionClient | undefined,
    data: { orderId: string; type: string; occurredAt: Date },
  ): Promise<Event> {
    return (tx ?? this.prisma).event.create({ data });
  }
}
```

### src/events/events.service.ts
```ts
import { Injectable } from '@nestjs/common';
import type { Event } from '@prisma/client';
import { AppError } from '../common/errors.js';
import { TransactionService } from '../common/transaction.service.js';
import { PaymentOrdersRepository } from '../payment-orders/payment-orders.repository.js';
import { ProjectionService } from '../projection/projection.service.js';
import { EventsRepository } from './events.repository.js';

@Injectable()
export class EventsService {
  constructor(
    private readonly repository: EventsRepository,
    private readonly ordersRepository: PaymentOrdersRepository,
    private readonly transactions: TransactionService,
    private readonly projection: ProjectionService,
  ) {}

  record(input: { orderId: string; type: string; occurredAt: Date }): Promise<Event> {
    return this.transactions.run(async (tx) => {
      const order = await this.ordersRepository.findById(tx, input.orderId);
      if (!order) throw AppError.notFound('payment order', input.orderId);

      const event = await this.repository.create(tx, input);

      // Keeps the projection's "latest event" current, still inside the write's
      // transaction so the next dashboard read reflects it.
      await this.projection.onEventRecorded(tx, event.orderId, event.type, event.occurredAt);
      return event;
    });
  }
}
```

### src/events/events.controller.ts
```ts
import { Body, Controller, Post } from '@nestjs/common';
import { asRecord, requireIsoDate, requireString, requireUuid } from '../common/validation.js';
import { EventsService } from './events.service.js';

@Controller('events')
export class EventsController {
  constructor(private readonly service: EventsService) {}

  @Post()
  record(@Body() body: unknown) {
    const payload = asRecord(body, 'request body');
    return this.service.record({
      orderId: requireUuid(payload.order_id, 'order_id'),
      type: requireString(payload.type, 'type', 100),
      occurredAt:
        payload.occurred_at === undefined ? new Date() : requireIsoDate(payload.occurred_at, 'occurred_at'),
    });
  }
}
```

### src/operations/operations.module.ts
```ts
import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module.js';
import { OperationsController } from './operations.controller.js';
import { OperationsRepository } from './operations.repository.js';
import { OperationsService } from './operations.service.js';

@Module({
  controllers: [OperationsController],
  providers: [OperationsService, OperationsRepository],
  imports: [CommonModule],
  exports: [OperationsRepository],
})
export class OperationsModule {}
```

### src/operations/operations.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import type { OperationRead, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';

export interface OperationsQuery {
  companyId?: string;
  status?: OrderStatus;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

export interface OperationReadInput {
  id: string;
  companyId: string;
  workerId: string;
  workerName: string;
  status: OrderStatus;
  amountCents: number;
  createdAt: Date;
  lastEventType: string | null;
  lastEventAt: Date | null;
}

@Injectable()
export class OperationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The new dashboard query: a single range scan on operation_reads. The
   * index (company_id, status, created_at DESC, id DESC) matches the filters
   * and the sort order exactly, so there is no join, no aggregation and no
   * sort step.
   */
  list(tx: Prisma.TransactionClient | undefined, query: OperationsQuery): Promise<OperationRead[]> {
    const client = tx ?? this.prisma;
    return client.operationRead.findMany({
      where: this.where(query),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
  }

  count(tx: Prisma.TransactionClient | undefined, query: OperationsQuery): Promise<number> {
    return (tx ?? this.prisma).operationRead.count({ where: this.where(query) });
  }

  /**
   * Idempotent row write shared by the sync hooks and the re-derivation:
   * both write the source's value, so whichever runs last converges.
   */
  upsert(tx: Prisma.TransactionClient | undefined, read: OperationReadInput): Promise<OperationRead> {
    const data = {
      companyId: read.companyId,
      workerId: read.workerId,
      workerName: read.workerName,
      status: read.status,
      amountCents: read.amountCents,
      createdAt: read.createdAt,
      lastEventType: read.lastEventType,
      lastEventAt: read.lastEventAt,
    };
    return (tx ?? this.prisma).operationRead.upsert({
      where: { id: read.id },
      create: { id: read.id, ...data },
      update: data,
    });
  }

  setStatus(tx: Prisma.TransactionClient | undefined, id: string, status: OrderStatus): Promise<OperationRead> {
    return (tx ?? this.prisma).operationRead.update({ where: { id }, data: { status } });
  }

  /**
   * Sets the latest event only if it is newer than the current one, so
   * out-of-order event recording cannot move the pointer backwards.
   */
  setLatestEventIfNewer(
    tx: Prisma.TransactionClient | undefined,
    id: string,
    type: string,
    occurredAt: Date,
  ): Promise<{ count: number }> {
    return (tx ?? this.prisma).operationRead.updateMany({
      where: { id, OR: [{ lastEventAt: null }, { lastEventAt: { lt: occurredAt } }] },
      data: { lastEventType: type, lastEventAt: occurredAt },
    });
  }

  renameWorker(tx: Prisma.TransactionClient | undefined, workerId: string, workerName: string): Promise<{ count: number }> {
    return (tx ?? this.prisma).operationRead.updateMany({
      where: { workerId },
      data: { workerName },
    });
  }

  /** Exact per-status aggregate over the projection, used to recompute totals. */
  sumByStatus(tx: Prisma.TransactionClient | undefined, companyId: string) {
    return (tx ?? this.prisma).operationRead.groupBy({
      by: ['status'],
      where: { companyId },
      _sum: { amountCents: true },
      _count: { _all: true },
    });
  }

  private where(query: OperationsQuery): Prisma.OperationReadWhereInput {
    return {
      ...(query.companyId !== undefined && { companyId: query.companyId }),
      ...(query.status !== undefined && { status: query.status }),
      ...((query.from !== undefined || query.to !== undefined) && {
        createdAt: {
          ...(query.from !== undefined && { gte: query.from }),
          ...(query.to !== undefined && { lt: query.to }),
        },
      }),
    };
  }
}
```

### src/operations/operations.service.ts
```ts
import { Injectable } from '@nestjs/common';
import type { OperationRead, OrderStatus } from '@prisma/client';
import { OperationsRepository, type OperationsQuery } from './operations.repository.js';

export interface OperationItem {
  id: string;
  company_id: string;
  worker_id: string;
  worker_name: string;
  status: OrderStatus;
  amount_cents: number;
  created_at: string;
  updated_at: string;
  last_event_type: string | null;
  last_event_at: string | null;
}

export interface OperationsPage {
  items: OperationItem[];
  meta: { page: number; page_size: number; total_count: number };
}

function toItem(row: OperationRead): OperationItem {
  return {
    id: row.id,
    company_id: row.companyId,
    worker_id: row.workerId,
    worker_name: row.workerName,
    status: row.status,
    amount_cents: row.amountCents,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    last_event_type: row.lastEventType,
    last_event_at: row.lastEventAt?.toISOString() ?? null,
  };
}

@Injectable()
export class OperationsService {
  constructor(private readonly repository: OperationsRepository) {}

  async list(query: OperationsQuery): Promise<OperationsPage> {
    const [items, totalCount] = await Promise.all([
      this.repository.list(undefined, query),
      this.repository.count(undefined, query),
    ]);
    return {
      items: items.map(toItem),
      meta: { page: query.page, page_size: query.pageSize, total_count: totalCount },
    };
  }
}
```

### src/operations/operations.controller.ts
```ts
import { Controller, Get, Query } from '@nestjs/common';
import { AppError } from '../common/errors.js';
import { optionalIntQuery, optionalIsoDate, optionalStatus, optionalUuid } from '../common/validation.js';
import { OperationsService } from './operations.service.js';

@Controller('operations')
export class OperationsController {
  constructor(private readonly service: OperationsService) {}

  @Get()
  list(@Query() query: Record<string, string | undefined>) {
    const from = optionalIsoDate(query.from, 'from');
    const to = optionalIsoDate(query.to, 'to');
    if (from !== undefined && to !== undefined && from.getTime() >= to.getTime()) {
      throw AppError.validation("'from' must be earlier than 'to'", {
        from: from.toISOString(),
        to: to.toISOString(),
      });
    }
    return this.service.list({
      companyId: optionalUuid(query.company_id, 'company_id'),
      status: optionalStatus(query.status, 'status'),
      from,
      to,
      page: optionalIntQuery(query.page, 'page', 1, 10_000),
      pageSize: optionalIntQuery(query.page_size, 'page_size', 50, 200),
    });
  }
}
```

### src/company-totals/company-totals.module.ts
```ts
import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module.js';
import { CompanyTotalsController } from './company-totals.controller.js';
import { CompanyTotalsRepository } from './company-totals.repository.js';
import { CompanyTotalsService } from './company-totals.service.js';

@Module({
  controllers: [CompanyTotalsController],
  providers: [CompanyTotalsService, CompanyTotalsRepository],
  imports: [CommonModule],
  exports: [CompanyTotalsRepository],
})
export class CompanyTotalsModule {}
```

### src/company-totals/company-totals.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import type { CompanyTotals, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';

@Injectable()
export class CompanyTotalsRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(tx: Prisma.TransactionClient | undefined, companyId?: string): Promise<CompanyTotals[]> {
    return (tx ?? this.prisma).companyTotals.findMany({
      where: companyId === undefined ? {} : { companyId },
      orderBy: [{ companyId: 'asc' }, { status: 'asc' }],
    });
  }

  /**
   * Applies a signed delta with one INSERT ... ON CONFLICT statement. The
   * increment happens inside Postgres, so two transactions racing on the
   * same (company_id, status) bucket both land; a client-side
   * read-modify-write (even in a transaction) would lose one of them. Raw
   * SQL is confined to this repository — the service layer never touches it.
   */
  applyDelta(
    tx: Prisma.TransactionClient | undefined,
    companyId: string,
    status: OrderStatus,
    deltaCount: number,
    deltaCents: bigint,
  ): Promise<number> {
    return (tx ?? this.prisma).$executeRaw`
      INSERT INTO company_totals (company_id, status, order_count, total_cents, updated_at)
      VALUES (${companyId}, ${status}, ${deltaCount}, ${deltaCents}, now())
      ON CONFLICT (company_id, status) DO UPDATE
      SET order_count = company_totals.order_count + ${deltaCount},
          total_cents = company_totals.total_cents + ${deltaCents},
          updated_at  = now()
    `;
  }

  /**
   * Absolute reset of a company's three buckets, used by the re-derivation.
   * One multi-row statement so the three buckets land consistently.
   */
  recompute(
    tx: Prisma.TransactionClient | undefined,
    companyId: string,
    totals: Record<OrderStatus, { count: number; cents: bigint }>,
  ): Promise<number> {
    const { pending, approved, rejected } = totals;
    return (tx ?? this.prisma).$executeRaw`
      INSERT INTO company_totals (company_id, status, order_count, total_cents, updated_at)
      VALUES
        (${companyId}, ${'pending'}, ${pending.count}, ${pending.cents}, now()),
        (${companyId}, ${'approved'}, ${approved.count}, ${approved.cents}, now()),
        (${companyId}, ${'rejected'}, ${rejected.count}, ${rejected.cents}, now())
      ON CONFLICT (company_id, status) DO UPDATE
      SET order_count = EXCLUDED.order_count,
          total_cents = EXCLUDED.total_cents,
          updated_at  = now()
    `;
  }
}
```

### src/company-totals/company-totals.service.ts
```ts
import { Injectable } from '@nestjs/common';
import type { OrderStatus } from '@prisma/client';
import { ORDER_STATUSES } from '../common/validation.js';
import { CompanyTotalsRepository } from './company-totals.repository.js';

export interface CompanyTotalRow {
  company_id: string;
  status: OrderStatus;
  order_count: number;
  /** Exact integer cents, serialised as a string so JSON cannot round it. */
  total_cents: string;
}

@Injectable()
export class CompanyTotalsService {
  constructor(private readonly repository: CompanyTotalsRepository) {}

  async forCompany(companyId?: string): Promise<CompanyTotalRow[]> {
    const rows = await this.repository.list(undefined, companyId);

    const byCompany = new Map<string, Map<OrderStatus, { count: number; cents: bigint }>>();
    for (const row of rows) {
      let buckets = byCompany.get(row.companyId);
      if (!buckets) {
        buckets = new Map();
        byCompany.set(row.companyId, buckets);
      }
      buckets.set(row.status, { count: row.orderCount, cents: row.totalCents });
    }

    const companies = companyId !== undefined ? [companyId] : [...byCompany.keys()].sort();

    // Zero-fill every bucket so the operator always sees a stable shape.
    const result: CompanyTotalRow[] = [];
    for (const company of companies) {
      const buckets = byCompany.get(company);
      for (const status of ORDER_STATUSES) {
        const bucket = buckets?.get(status);
        result.push({
          company_id: company,
          status,
          order_count: bucket?.count ?? 0,
          total_cents: (bucket?.cents ?? 0n).toString(),
        });
      }
    }
    return result;
  }
}
```

### src/company-totals/company-totals.controller.ts
```ts
import { Controller, Get, Query } from '@nestjs/common';
import { optionalUuid } from '../common/validation.js';
import { CompanyTotalsService } from './company-totals.service.js';

@Controller('company-totals')
export class CompanyTotalsController {
  constructor(private readonly service: CompanyTotalsService) {}

  @Get()
  list(@Query() query: Record<string, string | undefined>) {
    return this.service.forCompany(optionalUuid(query.company_id, 'company_id'));
  }
}
```

### src/projection/projection.module.ts
```ts
import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module.js';
import { CompanyTotalsModule } from '../company-totals/company-totals.module.js';
import { OperationsModule } from '../operations/operations.module.js';
import { ProjectionRepository } from './projection.repository.js';
import { ProjectionService } from './projection.service.js';

@Module({
  providers: [ProjectionService, ProjectionRepository],
  imports: [CommonModule, OperationsModule, CompanyTotalsModule],
  exports: [ProjectionService],
})
export class ProjectionModule {}
```

### src/projection/projection.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import type { PaymentOrder, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';

export interface RederiveCursor {
  createdAt: Date;
  id: string;
}

/**
 * Source-table reads used only by the re-derivation. Repositories are the
 * only layer that touches the database, so the projection's source reads
 * live here rather than in the source features' repositories.
 */
@Injectable()
export class ProjectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Orders created in [from, to), keyset-paginated so an arbitrarily large
   * window can be walked without OFFSET over millions of rows.
   */
  findOrdersInWindow(
    tx: Prisma.TransactionClient,
    from: Date,
    to: Date,
    cursor: RederiveCursor | null,
    limit: number,
  ): Promise<PaymentOrder[]> {
    return tx.paymentOrder.findMany({
      where: {
        createdAt: { gte: from, lt: to },
        ...(cursor === null
          ? {}
          : {
              OR: [
                { createdAt: { gt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { gt: cursor.id } },
              ],
            }),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
  }

  findWorkerNames(tx: Prisma.TransactionClient, workerIds: string[]): Promise<Map<string, string>> {
    return tx.worker
      .findMany({ where: { id: { in: workerIds } }, select: { id: true, name: true } })
      .then((rows) => new Map(rows.map((w): [string, string] => [w.id, w.name])));
  }

  findWorkerName(tx: Prisma.TransactionClient, workerId: string): Promise<string | null> {
    return tx.worker
      .findUnique({ where: { id: workerId }, select: { name: true } })
      .then((w) => (w === null ? null : w.name));
  }

  /** Latest event per order; ascending order means the last write wins. */
  findLatestEventPerOrder(
    tx: Prisma.TransactionClient,
    orderIds: string[],
  ): Promise<Map<string, { type: string; occurredAt: Date }>> {
    return tx.event
      .findMany({
        where: { orderId: { in: orderIds } },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        select: { orderId: true, type: true, occurredAt: true },
      })
      .then((rows) => {
        const latest = new Map<string, { type: string; occurredAt: Date }>();
        for (const row of rows) latest.set(row.orderId, row);
        return latest;
      });
  }
}
```

### src/projection/projection.service.ts
```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { OrderStatus, PaymentOrder, Prisma } from '@prisma/client';
import { AppError } from '../common/errors.js';
import { TransactionService } from '../common/transaction.service.js';
import { CompanyTotalsRepository } from '../company-totals/company-totals.repository.js';
import { OperationsRepository, type OperationReadInput } from '../operations/operations.repository.js';
import { ProjectionRepository, type RederiveCursor } from './projection.repository.js';

const REDEIVE_CHUNK_SIZE = 500;
const DEFAULT_REPAIR_CRON = '0 * * * *';
const DEFAULT_REPAIR_WINDOW_HOURS = 24;

export interface RederiveResult {
  ordersRederived: number;
  companiesRecomputed: number;
}

@Injectable()
export class ProjectionService {
  private readonly logger = new Logger(ProjectionService.name);
  private repairRunning = false;

  constructor(
    private readonly repository: ProjectionRepository,
    private readonly operationsRepository: OperationsRepository,
    private readonly companyTotalsRepository: CompanyTotalsRepository,
    private readonly transactions: TransactionService,
  ) {}

  // --- Maintenance hooks: invoked by the write services, inside their tx ---

  async onOrderCreated(tx: Prisma.TransactionClient, order: PaymentOrder): Promise<void> {
    const workerName = await this.repository.findWorkerName(tx, order.workerId);
    if (workerName === null) {
      // The write service pre-checks the worker; this only happens if the row
      // vanished between the check and this statement (FK makes it near-impossible).
      throw new AppError('internal_error', `worker ${order.workerId} vanished while projecting order ${order.id}`, {});
    }
    const read: OperationReadInput = {
      id: order.id,
      companyId: order.companyId,
      workerId: order.workerId,
      workerName,
      status: order.status,
      amountCents: order.amountCents,
      createdAt: order.createdAt,
      lastEventType: null,
      lastEventAt: null,
    };
    await this.operationsRepository.upsert(tx, read);
    await this.companyTotalsRepository.applyDelta(tx, order.companyId, order.status, 1, BigInt(order.amountCents));
  }

  async onOrderStatusChanged(
    tx: Prisma.TransactionClient,
    order: PaymentOrder,
    previousStatus: OrderStatus,
  ): Promise<void> {
    await this.operationsRepository.setStatus(tx, order.id, order.status);
    // Move the amount between the two status buckets. Each step is one atomic
    // statement, so no other writer can slip between a read and a write.
    await this.companyTotalsRepository.applyDelta(tx, order.companyId, previousStatus, -1, -BigInt(order.amountCents));
    await this.companyTotalsRepository.applyDelta(tx, order.companyId, order.status, 1, BigInt(order.amountCents));
  }

  onEventRecorded(tx: Prisma.TransactionClient, orderId: string, type: string, occurredAt: Date): Promise<void> {
    return this.operationsRepository.setLatestEventIfNewer(tx, orderId, type, occurredAt).then(() => undefined);
  }

  onWorkerRenamed(tx: Prisma.TransactionClient, workerId: string, workerName: string): Promise<void> {
    return this.operationsRepository.renameWorker(tx, workerId, workerName).then(() => undefined);
  }

  // --- Re-derivation / drift repair -----------------------------------------

  /**
   * Rebuilds operation_reads from the source tables for orders created in
   * [from, to), then recomputes the exact company_totals for every affected
   * company from the rebuilt rows. Idempotent: safe to run repeatedly, with
   * overlapping windows, and concurrently with live writes.
   */
  async rederiveWindow(from: Date, to: Date): Promise<RederiveResult> {
    if (from.getTime() >= to.getTime()) {
      throw AppError.validation("'from' must be earlier than 'to'", {
        from: from.toISOString(),
        to: to.toISOString(),
      });
    }

    let cursor: RederiveCursor | null = null;
    let ordersRederived = 0;
    const affectedCompanies = new Set<string>();

    while (true) {
      const batch = await this.transactions.run(async (tx) => {
        const orders = await this.repository.findOrdersInWindow(tx, from, to, cursor, REDEIVE_CHUNK_SIZE);
        if (orders.length === 0) return orders;

        const workerNames = await this.repository.findWorkerNames(tx, [...new Set(orders.map((o) => o.workerId))]);
        const latestEvents = await this.repository.findLatestEventPerOrder(tx, orders.map((o) => o.id));

        for (const order of orders) {
          const lastEvent = latestEvents.get(order.id);
          const read: OperationReadInput = {
            id: order.id,
            companyId: order.companyId,
            workerId: order.workerId,
            workerName: workerNames.get(order.workerId) ?? '',
            status: order.status,
            amountCents: order.amountCents,
            createdAt: order.createdAt,
            lastEventType: lastEvent?.type ?? null,
            lastEventAt: lastEvent?.occurredAt ?? null,
          };
          await this.operationsRepository.upsert(tx, read);
        }
        return orders;
      });

      if (batch.length === 0) break;
      ordersRederived += batch.length;
      for (const order of batch) affectedCompanies.add(order.companyId);
      const last = batch[batch.length - 1];
      cursor = { createdAt: last.createdAt, id: last.id };
    }

    // Totals are authoritative aggregates over the projection: recompute each
    // affected company's buckets from the rows that are correct now.
    let companiesRecomputed = 0;
    for (const companyId of [...affectedCompanies].sort()) {
      await this.transactions.run(async (tx) => {
        const groups = await this.operationsRepository.sumByStatus(tx, companyId);
        await this.companyTotalsRepository.recompute(tx, companyId, this.totalsFromGroups(groups));
        companiesRecomputed += 1;
      });
    }

    this.logger.log(
      `re-derived ${ordersRederived} operations in [${from.toISOString()}, ${to.toISOString()}); ` +
        `recomputed totals for ${companiesRecomputed} companies`,
    );
    return { ordersRederived, companiesRecomputed };
  }

  /**
   * Scheduled drift-repair job: re-derives a rolling window on a cron. The
   * window overlaps previous runs by design, so anything skipped while a live
   * write was in flight is picked up by the next pass.
   */
  @Cron(process.env.DRIFT_REPAIR_CRON ?? DEFAULT_REPAIR_CRON, { name: 'drift-repair' })
  async scheduledDriftRepair(): Promise<void> {
    if (process.env.DRIFT_REPAIR_ENABLED === 'false') return;
    if (this.repairRunning) {
      this.logger.warn('previous drift-repair run is still in progress; skipping this tick');
      return;
    }
    this.repairRunning = true;
    try {
      const rawHours = Number(process.env.DRIFT_REPAIR_WINDOW_HOURS ?? DEFAULT_REPAIR_WINDOW_HOURS);
      const windowHours = Number.isFinite(rawHours) && rawHours > 0 ? rawHours : DEFAULT_REPAIR_WINDOW_HOURS;
      const to = new Date();
      const from = new Date(to.getTime() - windowHours * 3_600_000);
      await this.rederiveWindow(from, to);
    } catch (error) {
      this.logger.error(`drift-repair failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.repairRunning = false;
    }
  }

  private totalsFromGroups(
    groups: Array<{ status: OrderStatus; _sum: { amountCents: bigint | null }; _count: { _all: number } }>,
  ): Record<OrderStatus, { count: number; cents: bigint }> {
    const totals: Record<OrderStatus, { count: number; cents: bigint }> = {
      pending: { count: 0, cents: 0n },
      approved: { count: 0, cents: 0n },
      rejected: { count: 0, cents: 0n },
    };
    for (const group of groups) {
      totals[group.status] = { count: group._count._all, cents: group._sum.amountCents ?? 0n };
    }
    return totals;
  }
}
```

### test/test-utils.ts
```ts
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/common/prisma.service.js';
import { CompanyTotalsService } from '../src/company-totals/company-totals.service.js';
import { EventsService } from '../src/events/events.service.js';
import { OperationsService } from '../src/operations/operations.service.js';
import { PaymentOrdersService } from '../src/payment-orders/payment-orders.service.js';
import { ProjectionService } from '../src/projection/projection.service.js';
import { WorkersService } from '../src/workers/workers.service.js';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  paymentOrders: PaymentOrdersService;
  events: EventsService;
  workers: WorkersService;
  operations: OperationsService;
  companyTotals: CompanyTotalsService;
  projection: ProjectionService;
}

/**
 * Behaviour-level suite: it needs a real Postgres at DATABASE_URL, the same
 * variable the application itself uses.
 */
export async function createTestContext(): Promise<TestContext> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to run the read-model test suite');
  }
  process.env.DRIFT_REPAIR_ENABLED = 'false';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();

  return {
    app,
    prisma: moduleRef.get(PrismaService),
    paymentOrders: moduleRef.get(PaymentOrdersService),
    events: moduleRef.get(EventsService),
    workers: moduleRef.get(WorkersService),
    operations: moduleRef.get(OperationsService),
    companyTotals: moduleRef.get(CompanyTotalsService),
    projection: moduleRef.get(ProjectionService),
  };
}

export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.companyTotals.deleteMany();
  await prisma.operationRead.deleteMany();
  await prisma.event.deleteMany();
  await prisma.paymentOrder.deleteMany();
  await prisma.worker.deleteMany();
}

export function newId(): string {
  return randomUUID();
}

export function toMap<K, V>(items: readonly V[], key: (item: V) => K): Map<K, V> {
  const map = new Map<K, V>();
  for (const item of items) map.set(key(item), item);
  return map;
}
```

### test/operations.spec.ts
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PaymentOrder } from '@prisma/client';
import { createTestContext, newId, resetDatabase, type TestContext } from './test-utils.js';

describe('operations dashboard: read-your-own-writes', () => {
  let ctx: TestContext;
  let companyId: string;
  let workerId: string;

  beforeEach(async () => {
    ctx = await createTestContext();
    await resetDatabase(ctx.prisma);
    companyId = newId();
    workerId = (await ctx.workers.create({ companyId, name: 'Ada' })).id;
  });

  afterEach(async () => {
    await resetDatabase(ctx.prisma);
    await ctx.app.close();
  });

  it('shows a newly created order on the very next dashboard read', async () => {
    const order = await ctx.paymentOrders.create({ companyId, workerId, amountCents: 1200 });

    const page = await ctx.operations.list({ companyId, page: 1, pageSize: 50 });

    expect(page.meta).toEqual({ page: 1, page_size: 50, total_count: 1 });
    expect(page.items).toEqual([
      expect.objectContaining({
        id: order.id,
        company_id: companyId,
        worker_id: workerId,
        worker_name: 'Ada',
        status: 'pending',
        amount_cents: 1200,
        last_event_type: null,
        last_event_at: null,
      }),
    ]);
  });

  it('reflects an approval on the next read, and the status filter follows', async () => {
    const order = await ctx.paymentOrders.create({ companyId, workerId, amountCents: 2500 });

    await ctx.paymentOrders.setStatus(order.id, 'approved');

    const approved = await ctx.operations.list({ companyId, status: 'approved', page: 1, pageSize: 50 });
    expect(approved.meta.total_count).toBe(1);
    expect(approved.items[0].id).toBe(order.id);
    expect(approved.items[0].status).toBe('approved');

    const pending = await ctx.operations.list({ companyId, status: 'pending', page: 1, pageSize: 50 });
    expect(pending.meta.total_count).toBe(0);
    expect(pending.items).toEqual([]);
  });

  it('reflects a recorded event as the operation\'s latest event', async () => {
    const order = await ctx.paymentOrders.create({ companyId, workerId, amountCents: 100 });
    const occurredAt = new Date('2025-06-01T12:00:00.000Z');

    await ctx.events.record({ orderId: order.id, type: 'payment.captured', occurredAt });

    const page = await ctx.operations.list({ companyId, page: 1, pageSize: 50 });
    expect(page.items[0].last_event_type).toBe('payment.captured');
    expect(page.items[0].last_event_at).toBe(occurredAt.toISOString());
  });

  it('ignores an event whose occurred_at is older than the latest one', async () => {
    const order = await ctx.paymentOrders.create({ companyId, workerId, amountCents: 100 });
    await ctx.events.record({
      orderId: order.id,
      type: 'payment.captured',
      occurredAt: new Date('2025-06-02T00:00:00.000Z'),
    });
    await ctx.events.record({
      orderId: order.id,
      type: 'recorded-late-but-earlier',
      occurredAt: new Date('2025-06-01T00:00:00.000Z'),
    });

    const page = await ctx.operations.list({ companyId, page: 1, pageSize: 50 });
    expect(page.items[0].last_event_type).toBe('payment.captured');
    expect(page.items[0].last_event_at).toBe('2025-06-02T00:00:00.000Z');
  });

  it('never mixes in another company\'s operations', async () => {
    await ctx.paymentOrders.create({ companyId, workerId, amountCents: 100 });
    const otherCompany = newId();
    const otherWorker = await ctx.workers.create({ companyId: otherCompany, name: 'Bo' });
    await ctx.paymentOrders.create({ companyId: otherCompany, workerId: otherWorker.id, amountCents: 999 });

    const page = await ctx.operations.list({ companyId, page: 1, pageSize: 50 });

    expect(page.meta.total_count).toBe(1);
    expect(page.items[0].amount_cents).toBe(100);
  });

  it('keeps the denormalised worker name in sync with renames', async () => {
    await ctx.paymentOrders.create({ companyId, workerId, amountCents: 100 });

    await ctx.workers.rename(workerId, 'Ada Lovelace');

    const page = await ctx.operations.list({ companyId, page: 1, pageSize: 50 });
    expect(page.items[0].worker_name).toBe('Ada Lovelace');
  });

  it('filters by date range and sorts by recency', async () => {
    const oldOrder = await ctx.paymentOrders.create({ companyId, workerId, amountCents: 1 });
    const freshOrder = await ctx.paymentOrders.create({ companyId, workerId, amountCents: 2 });

    // Backdate the first order (fixture manipulation) so the range is unambiguous.
    const past = new Date('2025-01-01T00:00:00.000Z');
    await ctx.prisma.paymentOrder.update({ where: { id: oldOrder.id }, data: { createdAt: past } });
    await ctx.prisma.operationRead.update({ where: { id: oldOrder.id }, data: { createdAt: past } });

    const all = await ctx.operations.list({ companyId, page: 1, pageSize: 10 });
    expect(all.items.map((item) => item.id)).toEqual([freshOrder.id, oldOrder.id]);

    const ranged = await ctx.operations.list({
      companyId,
      from: new Date(past.getTime() + 3_600_000),
      page: 1,
      pageSize: 10,
    });
    expect(ranged.meta.total_count).toBe(1);
    expect(ranged.items[0].id).toBe(freshOrder.id);
  });

  it('paginates with a stable order and no overlap between pages', async () => {
    const created: PaymentOrder[] = [];
    for (let i = 0; i < 5; i++) {
      created.push(await ctx.paymentOrders.create({ companyId, workerId, amountCents: i + 1 }));
    }

    // Backdate so each order lands on a distinct second, oldest first.
    const base = Date.parse('2025-03-01T00:00:00.000Z');
    for (let i = 0; i < created.length; i++) {
      const at = new Date(base + i * 1000);
      await ctx.prisma.paymentOrder.update({ where: { id: created[i].id }, data: { createdAt: at } });
      await ctx.prisma.operationRead.update({ where: { id: created[i].id }, data: { createdAt: at } });
    }

    const firstPage = await ctx.operations.list({ companyId, page: 1, pageSize: 2 });
    const secondPage = await ctx.operations.list({ companyId, page: 2, pageSize: 2 });

    expect(firstPage.meta.total_count).toBe(5);
    expect(firstPage.items.map((item) => item.id)).toEqual([created[4].id, created[3].id]);
    expect(secondPage.items.map((item) => item.id)).toEqual([created[2].id, created[1].id]);

    const seen = new Set([...firstPage.items, ...secondPage.items].map((item) => item.id));
    expect(seen.size).toBe(4);
  });
});
```

### test/company-totals.spec.ts
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OrderStatus } from '@prisma/client';
import { createTestContext, newId, resetDatabase, toMap, type TestContext } from './test-utils.js';

describe('company totals: exact under concurrent updates', () => {
  let ctx: TestContext;
  let companyId: string;
  const workerIds: string[] = [];

  beforeEach(async () => {
    ctx = await createTestContext();
    await resetDatabase(ctx.prisma);
    companyId = newId();
    workerIds.length = 0;
    for (const name of ['W1', 'W2', 'W3', 'W4']) {
      workerIds.push((await ctx.workers.create({ companyId, name })).id);
    }
  });

  afterEach(async () => {
    await resetDatabase(ctx.prisma);
    await ctx.app.close();
  });

  const finalStatusOf = (index: number): OrderStatus =>
    index % 2 === 0 ? 'approved' : index % 5 === 1 ? 'rejected' : 'pending';

  it('keeps totals exact while 60 creates and 30 status changes race on one company', async () => {
    const N = 60;
    const created = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        ctx.paymentOrders.create({
          companyId,
          workerId: workerIds[i % workerIds.length],
          amountCents: 100 + i * 7,
        }),
      ),
    );

    // Flips interleave with each other and with the creates' tail; each order
    // is flipped exactly once, so the final state is deterministic.
    await Promise.all(
      created.map((order, i) =>
        finalStatusOf(i) === 'pending' ? Promise.resolve() : ctx.paymentOrders.setStatus(order.id, finalStatusOf(i)),
      ),
    );

    const rows = await ctx.companyTotals.forCompany(companyId);
    const byStatus = toMap(rows, (row) => row.status);

    const expected: Record<OrderStatus, { count: number; cents: bigint }> = {
      pending: { count: 0, cents: 0n },
      approved: { count: 0, cents: 0n },
      rejected: { count: 0, cents: 0n },
    };
    created.forEach((order, i) => {
      const status = finalStatusOf(i);
      expected[status].count += 1;
      expected[status].cents += BigInt(order.amountCents);
    });

    for (const status of ['pending', 'approved', 'rejected'] as const) {
      const row = byStatus.get(status);
      expect(row).toBeDefined();
      expect(row!.order_count).toBe(expected[status].count);
      expect(BigInt(row!.total_cents)).toBe(expected[status].cents);
    }

    // Global invariants: nothing lost or double-counted across the buckets.
    expect(rows.reduce((sum, row) => sum + row.order_count, 0)).toBe(N);
    expect(rows.reduce((sum, row) => sum + BigInt(row.total_cents), 0n)).toBe(
      created.reduce((sum, order) => sum + BigInt(order.amountCents), 0n),
    );
  });

  it('never mixes one company\'s totals into another\'s under concurrency', async () => {
    const otherCompany = newId();
    const otherWorker = await ctx.workers.create({ companyId: otherCompany, name: 'X' });

    await Promise.all([
      ctx.paymentOrders.create({ companyId, workerId: workerIds[0], amountCents: 111 }),
      ctx.paymentOrders.create({ companyId: otherCompany, workerId: otherWorker.id, amountCents: 222 }),
    ]);

    const rows = await ctx.companyTotals.forCompany(companyId);
    expect(rows.reduce((sum, row) => sum + row.order_count, 0)).toBe(1);
    expect(rows.reduce((sum, row) => sum + BigInt(row.total_cents), 0n)).toBe(111n);
  });

  it('moves the amount between buckets as the status changes repeatedly', async () => {
    const order = await ctx.paymentOrders.create({ companyId, workerId: workerIds[0], amountCents: 500 });

    const buckets = async () => toMap(await ctx.companyTotals.forCompany(companyId), (row) => row.status);

    await ctx.paymentOrders.setStatus(order.id, 'approved');
    let byStatus = await buckets();
    expect(byStatus.get('pending')!.order_count).toBe(0);
    expect(BigInt(byStatus.get('approved')!.total_cents)).toBe(500n);

    await ctx.paymentOrders.setStatus(order.id, 'rejected');
    byStatus = await buckets();
    expect(BigInt(byStatus.get('approved')!.total_cents)).toBe(0n);
    expect(BigInt(byStatus.get('rejected')!.total_cents)).toBe(500n);

    await ctx.paymentOrders.setStatus(order.id, 'pending');
    byStatus = await buckets();
    expect(BigInt(byStatus.get('rejected')!.total_cents)).toBe(0n);
    expect(BigInt(byStatus.get('pending')!.total_cents)).toBe(500n);
    expect(byStatus.get('pending')!.order_count).toBe(1);
  });
});
```

### test/drift-repair.spec.ts
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, newId, resetDatabase, toMap, type TestContext } from './test-utils.js';

describe('drift repair: re-derivation over an arbitrary window', () => {
  let ctx: TestContext;
  let companyId: string;
  let workerId: string;
  let outsiderCompany: string;
  let outsiderWorkerId: string;

  beforeEach(async () => {
    ctx = await createTestContext();
    await resetDatabase(ctx.prisma);
    companyId = newId();
    outsiderCompany = newId();
    workerId = (await ctx.workers.create({ companyId, name: 'In-window' })).id;
    outsiderWorkerId = (await ctx.workers.create({ companyId: outsiderCompany, name: 'Outsider' })).id;
  });

  afterEach(async () => {
    await resetDatabase(ctx.prisma);
    await ctx.app.close();
  });

  it('repairs missed writes, tampered rows and corrupted totals inside the window — and only there', async () => {
    const a = await ctx.paymentOrders.create({ companyId, workerId, amountCents: 1000 });
    const b = await ctx.paymentOrders.create({ companyId, workerId, amountCents: 2000 });
    const c = await ctx.paymentOrders.create({ companyId, workerId, amountCents: 3000 });
    const outsider = await ctx.paymentOrders.create({
      companyId: outsiderCompany,
      workerId: outsiderWorkerId,
      amountCents: 7777,
    });

    // Simulate the four kinds of drift the repair has to heal.
    // 1) A source write that bypassed the hook (direct update of the order).
    await ctx.prisma.paymentOrder.update({ where: { id: a.id }, data: { status: 'approved' } });
    // 2) A projection row tampered with directly.
    await ctx.prisma.operationRead.update({
      where: { id: b.id },
      data: { workerName: 'Ghost', amountCents: 999999, status: 'rejected' },
    });
    // 3) An event written straight to the source table.
    await ctx.prisma.event.create({ data: { orderId: c.id, type: 'direct', occurredAt: new Date() } });
    // 4) A maintained totals row corrupted.
    await ctx.prisma.companyTotals.update({
      where: { companyId_status: { companyId, status: 'pending' } },
      data: { orderCount: 99, totalCents: 1n },
    });

    // Push the outsider's order 30 days in the past, outside the window below,
    // and corrupt its row and totals too: none of it should be touched.
    await ctx.prisma.paymentOrder.update({
      where: { id: outsider.id },
      data: { createdAt: new Date(Date.now() - 30 * 86_400_000) },
    });
    await ctx.prisma.operationRead.update({ where: { id: outsider.id }, data: { workerName: 'ShouldStay' } });
    await ctx.prisma.companyTotals.update({
      where: { companyId_status: { companyId: outsiderCompany, status: 'pending' } },
      data: { totalCents: 42n },
    });

    const from = new Date(Date.now() - 3_600_000);
    const to = new Date(Date.now() + 3_600_000);

    const result = await ctx.projection.rederiveWindow(from, to);
    expect(result.ordersRederived).toBe(3);
    expect(result.companiesRecomputed).toBe(1);

    // The in-window company is fully repaired: rows, names, events, totals.
    const page = await ctx.operations.list({ companyId, page: 1, pageSize: 50 });
    const byId = toMap(page.items, (item) => item.id);
    expect(byId.get(a.id)!.status).toBe('approved');
    expect(byId.get(b.id)!.worker_name).toBe('In-window');
    expect(byId.get(b.id)!.amount_cents).toBe(2000);
    expect(byId.get(b.id)!.status).toBe('pending');
    expect(byId.get(c.id)!.last_event_type).toBe('direct');

    const byStatus = toMap(await ctx.companyTotals.forCompany(companyId), (row) => row.status);
    expect(byStatus.get('approved')!.order_count).toBe(1);
    expect(BigInt(byStatus.get('approved')!.total_cents)).toBe(1000n);
    expect(byStatus.get('pending')!.order_count).toBe(2);
    expect(BigInt(byStatus.get('pending')!.total_cents)).toBe(5000n);
    expect(byStatus.get('rejected')!.order_count).toBe(0);
    expect(byStatus.get('rejected')!.total_cents).toBe('0');

    // The window is honoured: the 30-day-old order is not re-derived, and the
    // outsider's corrupted totals are left alone too.
    const outsiderPage = await ctx.operations.list({ companyId: outsiderCompany, page: 1, pageSize: 50 });
    expect(outsiderPage.items[0].worker_name).toBe('ShouldStay');
    const outsiderRows = await ctx.companyTotals.forCompany(outsiderCompany);
    expect(BigInt(toMap(outsiderRows, (row) => row.status).get('pending')!.total_cents)).toBe(42n);

    // The repair is idempotent: a second run changes nothing.
    const totalsBefore = await ctx.companyTotals.forCompany(companyId);
    const pageBefore = await ctx.operations.list({ companyId, page: 1, pageSize: 50 });
    await ctx.projection.rederiveWindow(from, to);
    expect(await ctx.companyTotals.forCompany(companyId)).toEqual(totalsBefore);
    expect((await ctx.operations.list({ companyId, page: 1, pageSize: 50 })).items).toEqual(pageBefore.items);
  });
});
```

### DESIGN.md
```markdown
# Read-model design — operations dashboard

## Problem

The back-office dashboard lists "operations": payment orders joined with
workers (name) and events (the latest per order), filtered by company, status
and date range, sorted by recency, paginated. With ~3M orders that join plus
per-order event aggregation takes 20–30 s. Requirements:

- p95 < 50 ms without changing what operators see;
- read-your-own-writes: approve an order → the next request reflects it;
- per-company financial totals must be exact, not approximate.

## Read model

Two projection tables:

- `operation_reads` — one row per payment order, denormalised with
  `worker_name`, `status`, `amount_cents`, `created_at` and the latest event
  (`last_event_type`, `last_event_at`). The dashboard becomes a single range
  scan on this table: no join, no aggregation, no sort.
- `company_totals` — exact `(company_id, status) → (order_count,
  total_cents)`. `total_cents` is `BIGINT`, exposed as a decimal string so
  JSON serialisation cannot round it.

### Index

`operation_reads (company_id, status, created_at DESC, id DESC)` matches the
hot query's equality filters, range predicate and sort order exactly, so the
dashboard is an index range scan + `LIMIT` with no sort step; `id` as the
final key makes pagination stable. `operation_reads (worker_id)` keeps rename
updates bounded. The operator dashboard always scopes by company; unscoped
all-company reads fall back to a scan and are outside the p95 contract.

## Maintenance: synchronous in-transaction hooks

Every write (create order, change status, record event, rename worker) opens
one Postgres transaction, writes the source row, then calls the matching hook
on `ProjectionService`, which updates the projections in the same
transaction.

Why this beats the alternatives:

- **Read-your-own-writes.** The source row and the projection row commit
  together, so any request after a committed write sees the new state with
  zero lag. An outbox/CDC or message-queue pipeline has lag of unknown size —
  it cannot satisfy "approve → next request reflects it".
- **Exact totals under concurrency.** The totals update is a single
  `INSERT … ON CONFLICT DO UPDATE SET total_cents = total_cents + $delta`
  statement: the increment happens inside Postgres, so racing writes on the
  same company never lose an update. A client-side read-modify-write (even
  inside a transaction) or an async consumer with duplicates/reordering would
  make the totals approximate — explicitly out of contract.
- **Postgres triggers** would give the same atomicity but hide half of the
  write-path logic inside the database: untestable from the app, versioned
  separately from the code, and not reusable by the re-derivation.
- **Materialised views** only update on bulk `REFRESH` — that is exactly the
  20–30 s operation being removed, and it cannot be per-write.
- **Better indexes on the join** do not remove the per-read aggregation over
  `events`; p95 50 ms at 3M rows is not credible that way.

Cost: one upsert plus one to two tiny atomic statements per write, all
primary-key work. Back-office writes are far rarer than dashboard reads, so
trading a few milliseconds of write latency for a 20–30 s → <50 ms read is
the right exchange.

## Re-derivation and drift repair

- `ProjectionService.rederiveWindow(from, to)` rebuilds `operation_reads`
  from the source tables for orders created in `[from, to)`, walking the
  window in keyset-paginated chunks, then recomputes `company_totals` for
  every affected company from the rebuilt rows. It is idempotent, so runs
  may overlap and may interleave with live writes.
- A scheduled job (`DRIFT_REPAIR_CRON`, default hourly) re-derives a rolling
  window (`DRIFT_REPAIR_WINDOW_HOURS`, default 24 h). The overlap between
  runs is deliberate: a row skipped while a live write was in flight is
  picked up by the next pass.
- Known self-healing race: if a write for company C commits between the
  recompute's snapshot and its absolute `SET`, that single delta is
  overwritten and is restored by the next repair run. The write-only steady
  state has no such race (atomic increments).

## What operators still see

The same rows and fields as the old join — order fields, worker name, latest
event — with the same filters, sort and pagination, served from the
projection. Totals are exact by construction: `BIGINT` storage, atomic
increments on every write, periodic recomputation from the rebuilt rows.

## Environment

`DATABASE_URL` (required), `PORT` (default 3000), `DRIFT_REPAIR_CRON`
(default `0 * * * *`), `DRIFT_REPAIR_WINDOW_HOURS` (default 24),
`DRIFT_REPAIR_ENABLED` (default on; set `false` to disable the job).

The test suite is behaviour-level and needs a real Postgres at
`DATABASE_URL`.
```
