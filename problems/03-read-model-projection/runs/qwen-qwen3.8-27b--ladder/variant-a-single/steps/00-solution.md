# solution

## reasoning

```
Let me think carefully about this task.

The task is "Variant A — Marketplace Operations Dashboard":
- Marketplace back-office lists "operations" (a join of payment orders, events, and workers). Filter by company, status, date range, sort by recency, paginate.
- At ~3 million orders the query takes 20–30 seconds. Target: p95 < 50ms, no visible change.
- Read-your-own-writes (approve order → shown approved on next request).
- Per-company financial totals must be exact.

Deliverables:
1. Projection table + DDL with appropriate indexes
2. Maintenance hooks called from write services (simulated write path)
3. Re-derivation routine for arbitrary date window
4. Scheduled drift repair job
5. New dashboard query
6. Tests for read-your-own-writes, concurrent updates to one company's totals, and drift repair
7. A short DESIGN.md justifying sync hooks vs alternatives

Stack: TypeScript + NestJS + Prisma + Postgres. Vitest tests. pnpm. ESM.

Layout conventions:
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

Layering: controller validates input, calls service; zero business logic. Service holds logic; zero raw SQL, zero Prisma client calls. Repository is the only layer that touches the database.

Wait — this is interesting. "service holds logic. zero raw SQL, zero Prisma client calls." But re-derivation and drift repair typically need raw SQL (window-based upserts, atomic increments). Hmm. Atomic increments like `UPDATE totals SET approved_amount = approved_amount + $1` — can Prisma do that? Yes: `increment` in update data. So atomic increment is possible with Prisma's `update({ where, data: { approvedAmount: { increment: x } } })`. Good — no raw SQL needed.

But re-derivation (rebuilding projection for a date range from source) — with Prisma, I can fetch the source rows for the window and re-project. That's O(rows in window) but acceptable for a routine. Or use `$transaction` with queries. Prisma doesn't support CTAS/INSERT...SELECT without `$queryRaw`. The convention says zero raw SQL in the service — but the repository can use `$queryRaw`? The repository is "the only layer that touches the database". Using Prisma's `$queryRaw` is still "touching the database" via the repository. I think the intent is: service must not call `prisma.$queryRaw` or `prisma.model`. The repository may use raw SQL via `$queryRaw` since it's the data access layer. Hmm, but "zero raw SQL" is only about the service. It's cleanest and most defensible to let the repository hold all DB access, including `$queryRaw` where necessary.

Actually, let me reconsider: could I do everything in pure Prisma model APIs?

- Projection upsert on write: `upsert` or `updateOrCreate` on projection keyed by orderId. Fine.
- Totals increment: `update` with `increment`. Fine. But what if the totals row doesn't exist? `upsert` doesn't support increment on create… Actually Prisma's upsert: the `update` part can use `increment`, but the `create` part can't. So pattern: upsert a zero row first (`update: {}`), then update with increment? That's two roundtrips. Alternatively `updateMany` with increment? updateMany can't increment… no, actually it can! Prisma's `updateMany` supports `increment` in data. But it returns count; if count is 0, insert the row. Hmm, race: two concurrent updateMany calls both see the row exists… row exists (initialized on company creation), so it's fine.

  Actually simpler: maintain a totals table keyed by company with a row guaranteed to exist (created when company is created / when first order appears). Use `update` with `where: {companyId}` and increment. To guarantee existence, do `upsert` in same transaction with `update: {}`, `create: {zero}`? But upsert+update is two statements; concurrency: two transactions both upsert (no-op) then both increment — increments are atomic so fine. The read-your-own-writes and lost-update concerns are about the increment itself, which is atomic at the DB level. Good.

  Wait, subtle: `upsert` in Postgres is implemented as SELECT then INSERT/UPDATE; two concurrent upserts on the same key — Prisma's upsert handles with ON CONFLICT? No — Prisma's upsert is "select, if exists update else create", which can throw P2002 on create under concurrency… actually with Prisma on Postgres, upsert issues a SELECT then INSERT/UPDATE; concurrent creates can race. Safer: use raw SQL in repository: `INSERT INTO ... VALUES (...) ON CONFLICT (company_id) DO NOTHING` followed by `UPDATE ... SET x = x + $inc WHERE company_id = $c`. Two raw statements in repository, or a single statement: `INSERT INTO totals (company_id, approved_amount, ...) VALUES ($1, $2, ...) ON CONFLICT (company_id) DO UPDATE SET approved_amount = approved_amount + EXCLUDED.approved_amount`. That's a single atomic statement that does exactly the upsert with increment semantics! That's the cleanest. Let me use `$executeRaw` in repository for this. This is the "in-place increment" the spec calls for.

  But does the write transaction use Prisma's `$transaction` (interactive)? Yes: the write service opens `prisma.$transaction(async tx => {...})`, writes source rows, then calls projection maintenance with `tx`. Passing `tx` to the repository… the repository normally holds `this.prisma`. For transaction propagation, the repository method should accept an optional `Prisma.TransactionClient`. That's the standard Prisma pattern. The repository stays the only layer that touches DB.

- Re-derivation for arbitrary window: `DELETE FROM projection WHERE occurred_at IN range; DELETE FROM totals? ` Hmm — totals can't be deleted by window. Let me think about the shape.

Now, what exactly is the shape of the dashboard query?

The operations list: a join of payment orders, events, and workers. Filter by company, status, date range, sort by recency, paginate. What columns? "Same columns, same filters, same ordering, same page size." Since I'm building from scratch (no existing code given — the task says "the files above the task are the existing codebase and are real" but no files are given; only reference docs), I need to define the source schema myself. The reference material defines the domain: payment orders, events, workers, companies.

Let me design the domain:

Source tables:
- `companies` (id, name, ...)
- `workers` (id, name, company_id, ...) — workers belong to a company.
- `payment_orders` (id, company_id, amount_cents, currency, status, created_at, updated_at, ...) — status: pending/approved/rejected/refunded, etc.
- `events` (id, order_id, worker_id, type, occurred_at, ...) — events that move orders: order.created, order.approved (by worker), order.rejected, etc.

Hmm, "operations (join of payment orders, events, workers)". So each row of the dashboard = an operation: an event on an order, attributed to a worker, filtered by company. "Sort by recency" — by event's occurred_at. "Filter by status" — probably current status of the order. "Per-company financial totals must be exact" — totals per company of approved amount etc.

Let me define the read model:

1. `operation_entries` — one row per (event) in the list: columns: event_id (pk), order_id, company_id, status (current status of the order at that event time? or current status of the order?), worker_id, worker_name, amount_cents, occurred_at.

Hmm, wait. If we filter by the order's *current* status, then when the order's status changes, all past entries for that order change status → the entry rows have to be updated on status change, which breaks "one row per event"… unless we store status as a separate column that gets updated for all entries of the order.

Alternative interpretation: the list shows operations = orders with latest activity. Honestly, since there's no existing code, I have freedom. Let me make it clean and defensible:

**Operation = one row per event** (the operations dashboard lists operations as event-level rows: "order 1234 approved by worker X at T"). Columns:
- `id` (event id)
- `order_id`
- `company_id`
- `worker_id`
- `worker_name` (denormalized from worker)
- `order_status` (current status of the order — updated whenever the order's status changes; this is what "filter by status" means: show currently-approved operations)
- `amount_cents` (denormalized from order)
- `occurred_at` (event time — the sort key)

Filter: `company_id = ? AND order_status = ? AND occurred_at BETWEEN ? AND ?` ORDER BY `occurred_at DESC` LIMIT/OFFSET (or keyset). Covering index: `(company_id, order_status, occurred_at DESC) INCLUDE (worker_name, amount_cents, order_id)` — matches filter+sort, covers all columns → index-only scan → fast.

When an order's status changes, all its entries need `order_status` updated. That's a set update on the projection: `UPDATE operation_entries SET order_status=$1 WHERE order_id=$2`. Fine, atomic, inside the write transaction.

Hmm wait, but is it right for the "status" filter to be the current status? "Filter by company, status, date range" — for an operations list, filtering by the current status of the operation makes sense ("show me all approved operations in the past week"). I'll go with current status of the order, denormalized and maintained. I'll state this in DESIGN.md.

Actually — a simpler alternative: one row per *order*, "recency" = last event time. But "join of payment orders, events, and workers" suggests events matter (worker who performed the action, when). Let me go with one row per event; that's the more interesting projection and matches "join of three tables".

2. `company_totals` — one row per company:
- `company_id` (pk)
- `orders_count`, `approved_amount_cents`, `rejected_amount_cents`, maybe `pending_amount_cents`, `total_amount_cents`? Let me keep: `orders_count`, `pending_amount_cents`, `approved_amount_cents`, `rejected_amount_cents`, `refunded_amount_cents`. Simpler: approved/pending/rejected counts + amounts. What I'll keep: `orders_count`, `approved_amount_cents`, `pending_amount_cents`, `rejected_amount_cents`, plus `updated_at`. Financial totals per company — the sum of amounts by status. Exactness: maintained with atomic increments.

Statuses: `pending`, `approved`, `rejected`. Keep three, simple. (Could add `refunded` but keeping three keeps tests clean.)

Hmm, should totals include counts too? "Per-company financial totals must be exact" — the amount is the key part. Let me have counts and amounts per status. OK.

Now the write path (simulated write services):

- `createOrder(companyId, amountCents, currency)` → insert order (status pending), emit event `order.created` (worker? created by whom? maybe system/worker). Insert a `created` event attributed to a worker? Hmm, worker for creation could be null. For simplicity: every event has a worker_id (the operator who performed the action); creation by an operator of a company. Let me give the created event a worker_id too (the operator who registered the order). Simpler: every event references a worker.

- `approveOrder(orderId, workerId)` → set order status to approved, insert event `order.approved`, update projection: entry row for the event; update order_status for all entries of the order; increment company totals: pending_amount -= amount, approved_amount += amount.

- `rejectOrder(orderId, workerId)` similarly.

Each write: `prisma.$transaction(async (tx) => { source writes via tx; projection maintenance via tx })`.

The service must not touch Prisma directly. So the write service calls repository methods that accept a transaction client. But the transaction itself (`$transaction`) — where does it live? `prisma.$transaction` is a Prisma client call. Service can't call Prisma client at all. So the repository must expose the transactional operation: e.g. `repository.approveOrder({orderId, workerId})` which internally does `this.prisma.$transaction(...)`. This keeps the service logic (validation of state transitions? domain rules like "can't approve an approved order") and repository handles the atomic unit.

Hmm, then "simulated write path" — the write services are: `orders.service.ts` (create/approve/reject). The service does: load the order via repository (check state), then call the repository's transactional apply method. Race conditions on state transitions are handled by a conditional update (`updateMany` with where status = expected) in the repository; if 0 rows affected → throw conflict error. Good — that's also robust under concurrency.

Actually wait, the concurrency test is "two concurrent approvals of the same company → totals exact, neither lost." Two *different* orders approved concurrently for the same company. So test: two `approveOrder` calls on different orders of the same company run in parallel; the totals row is incremented by both amounts exactly once each. With the upsert-with-increment statement, it's exact. With a naive read-modify-write (read row, compute, write), one update is lost → test detects.

Read-your-own-writes test: approve an order, then immediately run the dashboard query (read) → the new entry with status approved appears, and totals reflect it. Since the same connection reads after commit, it's trivially true; the point is the projection is updated in the same transaction, so any committed read sees it. Test: create order (pending entry shows up), approve, list shows it approved. Assert the entry row appears with the approved status.

Drift repair test: inject drift (directly modify a projection row via repository, or… tests may touch DB directly — tests can use their own PrismaClient; "zero raw SQL in service" doesn't apply to tests. But to be safe, I'll have the test use `prisma.$executeRaw` — it's a test, so fine. Or, inject drift by calling a service with inconsistent state? No — simplest and most honest: test directly corrupts the projection row and runs the repair routine and asserts it's fixed. The test file can use the raw client. I think that's acceptable; alternatively add a test-only seam. Hmm, the discipline says don't create files that aren't called for. Direct DB manipulation in test is normal.

Re-derivation routine: `rederive({from, to})`:
- Rebuild `operation_entries` for events whose `occurred_at` is in [from, to): delete those rows, re-insert from source join.
- Rebuild `company_totals` for… Totals are per-company, not per-time. Re-deriving the window: compute exact totals from the *entire source* for affected companies (companies that have events/orders in the window), and SET the row to the exact value. This keeps totals exact (not incremental), and idempotent (running twice → same result). "Must be safe to run while the system is live" — hmm, live writes during re-derivation: if we SET the totals to a snapshot value computed from source at time T, and a concurrent commit at time T+ε increments the row, our SET could overwrite that increment → drift. For safety: hold a lock on the totals row for affected companies during re-derivation? In a single transaction: `SELECT ... FOR UPDATE` on the totals rows for affected companies, then recompute and set. The concurrent write transactions will block on their increments until we commit. That's safe and bounded (the window is recent/small). For entries: delete+insert for events in window inside a transaction — a concurrent write for an event in the window will also block (row lock) and then apply its increment after our commit… wait, ordering: if we delete+insert entries for the window and a concurrent approval inserts a new entry for an event that occurred *within* the window during the transaction, after we commit, their insert lands — fine. If their approval's source commit happens before our recompute reads, it's included; if after, it's not included in the recompute but the hook wrote its projection row… but our window delete would delete their entry if it's within [from,to) and committed before our delete. Hmm: timeline: T1 (write tx) commits source+projection for event e at time t∈window. T2 (rederive) starts, reads source (sees e), deletes entries in window (none yet, or some), inserts re-derived entries (includes e), commits. T1 committed before T2's read → included, correct. If T1 commits after T2's read: T1's hook inserted entry e (with correct status, via hook) — but T2's delete happened before T1's insert? In Postgres: T2 deletes rows in window, T1 inserts new row — no conflict (different rows; T2's delete doesn't lock non-existent rows… actually T2's DELETE ... WHERE occurred_at IN window takes locks on existing rows; T1's insert happens after T2's delete snapshot — T1's row survives T2's delete. T2's recomputation didn't include T1 (not committed at read time) → T1's entry exists exactly once, from its hook. Correct! And T1's totals increment happens after T2's totals recompute (T2's FOR UPDATE on the company row blocks T1's increment until T2 commits) → T1's increment lands on top of the exact recompute. Correct!

Wait, let me redo the totals ordering: T2: BEGIN; SELECT totals row FOR UPDATE (acquire lock); compute sums from source (MVCC snapshot at T2's first read — doesn't include T1 if T1 uncommitted); UPDATE totals SET exact value; COMMIT. T1: BEGIN; ...; UPSERT totals row — blocks on T2's lock; T2 commits; T1's upsert applies increment on the new exact value. Final = exact + T1's delta. Correct. And T1's event, if within window: T2's delete+insert doesn't touch T1's row (inserted after T2's delete). But wait — T2's re-derived entries don't include T1's event, but T1's hook inserted it → present exactly once. If T1's event is outside window: T1's entry is outside window, T2's delete doesn't touch it. Fine.

Edge: T1's event in window, T1 commits before T2's read → T2's recompute includes T1's source rows; T2's delete removes T1's hook entry and reinserts re-derived version. Fine, once.

So: re-derivation is:
```
BEGIN;
DELETE FROM operation_entries WHERE occurred_at >= from AND occurred_at < to;
INSERT INTO operation_entries SELECT ... FROM events e JOIN payment_orders o ON ... JOIN workers w ON ... WHERE e.occurred_at IN [from,to);
-- Totals: for companies that have activity in window:
WITH affected AS (SELECT DISTINCT company_id FROM events WHERE occurred_at IN window)
UPDATE company_totals t SET (...exact sums from full source for t.company_id...) WHERE t.company_id IN affected;
-- Ensure totals row exists for affected companies:
INSERT INTO company_totals (company_id, ...) SELECT ... WHERE NOT EXISTS;
COMMIT;
```

For this I'd need raw SQL in the repository. Is that allowed? "Repository is the only layer that touches the database." Raw SQL in the repository is standard Prisma (`$transaction`, `$queryRaw`). The service-layer prohibition is explicit; nothing prohibits the repository. The convention says "service: zero raw SQL, zero Prisma client calls" — by enumeration, the repository may. I'll use `$queryRaw`/`$executeRaw` in the repository for: re-derivation window rebuild, drift repair, totals upsert-with-increment, and entry upsert (or use Prisma's model API where convenient — mixed is fine, but for transaction propagation with raw SQL I need `tx.$queryRaw` — interactive transactions provide that).

Hmm wait, actually, let me reconsider whether to use raw SQL for the totals upsert. I could use Prisma: `prisma.companyTotals.upsert({ where: companyId, update: {}, create: zero })` followed by `prisma.companyTotals.update({ where, data: { approvedAmountCents: { increment } } })`. The increment is atomic. The race on upsert create (P2002) — if the row is guaranteed to exist before (created on company creation), a simple `update` suffices, but robustness: use `upsert` with `update: {}`… the double-create race is unlikely to fire in tests but in production is real. The raw `INSERT ... ON CONFLICT DO UPDATE SET col = col + EXCLUDED.col` is the textbook "in-place increment" the spec suggests: "make the update atomic in the database — in-place increment, or hold a lock for the duration." I'll go with raw SQL in the repository. Clean and defensible.

Similarly entry writes: `INSERT INTO operation_entries (...) VALUES (...) ON CONFLICT (id) DO UPDATE SET ...` — idempotent (re-derivation/hook double-application). Good.

Now the dashboard query: repository method `listOperations({companyId, status, from, to, page, pageSize})` → single SELECT against `operation_entries` only + COUNT (or count via the same index). "No joins back to source tables on the hot path." Covering index:

```sql
CREATE INDEX operation_entries_lookup_idx
ON operation_entries (company_id, order_status, occurred_at DESC)
INCLUDE (worker_name, amount_cents, order_id, worker_id);
```

And maybe a PK on id. Counting: `COUNT(*)` with the same filter — also index-only. To keep p95 < 50ms, I'll include `countTotal` in the same query via window function? `COUNT(*) OVER ()` with LIMIT — Postgres has to compute the window over the whole matching set… no, `COUNT(*) OVER ()` is computed over the result set after WHERE, before LIMIT — that scans all matching rows, not just the page. That could be slow if the matching set is huge, but it's an index-only scan over the covering index… at 3M rows, the matching set for one company+status+range might be large. Hmm. Pagination: for safety, I'll fetch the page (LIMIT 50 OFFSET) + a separate count. Or use keyset (cursor) pagination with no count, but the spec says "same page size" and the original is paginated — the original probably used OFFSET. Let me return `items` + `totalCount` from two index-only queries (both cheap on the covering index). Good enough, honest.

Keyset vs OFFSET: I'll use offset (page-based) to match "same page size" semantics; the index handles it. Note in DESIGN.md.

Drift repair job: scheduled (NestJS `@Cron` via `@nestjs/schedule`, or a setInterval in a module — to avoid an extra dependency? `@nestjs/schedule` is the NestJS way; but the package management is pnpm and I can list dependencies in package.json). Since I'm creating the entire repo, I'll write a `package.json` including `@nestjs/schedule`. The drift job: for a recent window (e.g., last N minutes/hours, or a configurable lookback), compare projection vs source and repair discrepancies:

- For `operation_entries`: find entries whose row differs from the current source projection (or is missing, or is extra). The simplest, most robust approach: re-derive the repair window — that's precisely the repair! But the spec distinguishes: "periodically compare projection vs source for a recent window and repair what doesn't match" and re-derivation is a manual/recovery routine. Drift repair can literally use the re-derivation window logic on the recent window, plus a *detection* step that reports what differed. But "drift injected into projection → repair job finds and fixes it" — the test injects drift (e.g., wrong order_status on an entry, wrong totals) and runs the repair → fixed. If repair = "diff, then re-derive the window," the diff step gives observability (returns a count/list of mismatches) and the re-derive fixes it. That satisfies "find and fix." Let me implement:
  1. `detectDrift(from, to)`: SQL comparing projection rows vs source-derived values for the window → returns drift rows (id, field, projected, source) + totals drift per company.
  2. `repairDrift(from, to)`: runs detection; if any, runs the window re-derivation (the exact builder) over [from,to]; returns summary {entriesRepaired, totalsRepaired, ...}.
  The scheduled job (`DriftRepairJob`, `@Cron`) calls `repairDrift` with a rolling recent window (e.g., last 1 hour, overlap with previous run for safety — maybe a window from 2 hours ago to now+epsilon).

Hmm wait — subtle: entries whose *event* occurred in the window have their status possibly changed by a later event (outside the window) — the status of those entries is updated by the hook at change time, regardless of event time. If drift hits such an entry (wrong order_status), the window re-derivation recomputes the entry from source: the re-derivation SELECT must compute the *current* status of the order (o.status), not the status at event time — so re-derivation reproduces the hook semantics: entry.order_status = o.status (current). Then re-derivation of a past window fixes both missing rows and status drift.

For entries outside the window whose status drifted: a rolling window that is large enough + repeated runs cover it eventually (the drift-repair window should exceed max lag; I'll default to last 7 days? or configurable). Hmm — but entries whose event is old: if I corrupt an old entry's status, and the repair window is "last hour," it won't be fixed. Test: I'll inject drift inside the window. In DESIGN.md I'll note the window should be ≥ max acceptable staleness, and the re-derivation routine (arbitrary window) is the tool for deeper repairs. Actually, to make the job more robust: detect drift for a recent window *of events*; additionally, entries whose order_status disagrees with the order's current status *for orders that changed status in the window* — that's the other class. Let me not overengineer: repair window = last N hours (default 24h) of event activity; also re-derive totals for affected companies (full exact recompute — self-healing regardless of window, since totals are a full aggregate). Entries: window-limited; document it. Test uses in-window drift.

Now — totals drift detection: compare `company_totals` rows to `SELECT company_id, SUM... FROM payment_orders GROUP BY company` (full, not window — the totals are a full aggregate). If mismatch → mark as totalsDrifted for that company; repair = recompute exact value and SET (with row lock). Detection is a full aggregate over 3M orders… expensive but on an appropriate index? `GROUP BY company_id` on payment_orders with amount — I need an index on payment_orders(company_id, status, amount_cents) for a fast grouped aggregate? That's a big index. Alternative: the detection compares only companies that have activity in the window (bounded work), and the deep fix is the manual re-derivation. Hmm, but "drift injected into projection → repair job finds and fixes it" — the test injects drift into a company with recent activity (which is realistic: the drift comes from a recent write). Let me have detection limited to companies with activity in the window (documented), and totals repair recomputes full aggregate for those companies. Defensible, bounded, documented.

Wait, actually — should the drift job's totals check be window-limited at all? "Compare projection vs source for a recent window" — the comparison itself is window-scoped. For totals, "compare for a recent window" could mean "compare the sum of deltas in the window"? No — the totals are a full aggregate, so comparing them means comparing the full aggregate. Pragmatic scope: companies active in the window. I'll do that and document.

Now, re-derivation "safe while live, idempotent": the above analysis holds. I'll implement in a single interactive transaction with raw SQL statements. Prisma interactive `$transaction` with `$queryRaw` — supported.

Now the "simulation of write path": I think it means: implement actual write services (order creation/approval/rejection) that are the thing that would normally write the source tables — with the hook wired in the same transaction — so that the behavior is exercisable in tests. Yes.

Now the module/feature layout. Features:

- `orders` (write path): `orders.module.ts`, `orders.controller.ts` (POST /orders, POST /orders/:id/approve, POST /orders/:id/reject), `orders.service.ts`, `orders.repository.ts`.
- `dashboard` (read path): `dashboard.controller.ts` (GET /operations?companyId&status&from&to&page&pageSize), `dashboard.service.ts`, `dashboard.repository.ts`, module.
- `maintenance`: re-derivation + drift repair: `maintenance.service.ts`, `maintenance.repository.ts`, `maintenance.module.ts`, maybe a `drift-repair.job.ts` with @Cron, and an admin endpoint? The spec says "scheduled drift repair job" — a cron job. Also a re-derivation routine — exposed as an endpoint for ops? The deliverable says "re-derivation routine for arbitrary date window" — a routine, not necessarily an endpoint. But "do exactly what the task asks" — the routine is asked; the endpoint is a way to call it. A controller for the maintenance ops is reasonable (admin). Hmm — "don't create files that aren't called for." A controller for maintenance is not explicitly requested… the job is requested (scheduled → cron). Re-derivation routine = service method + test. I'll add a small maintenance controller with POST /maintenance/rederive and GET/POST /maintenance/repair-drift? That's an extra surface… I think it's defensible as a "routine" to be called, but discipline says do exactly what's asked. The acceptance criteria test the routine directly (via service). I'll skip the maintenance controller to keep the scope tight. Actually wait — the drift repair job: scheduled. I'll implement `drift-repair.job.ts` (in maintenance feature) with `@Cron`. And re-derivation: service method + test.

Hmm but then how does an operator trigger a re-derivation? Out of scope. OK.

- `workers` and `companies`? Do I need write services for them? The write services are for orders (approval flow). Workers/companies: needed as source tables for the join. Seed/creation: in tests, I create them directly via Prisma (tests can use the client). Or minimal services? The task: "maintenance hooks called from write services (simulate write path)" — the write services = the ones that write payment orders/events (approval flow). I'll skip workers/companies services; tests seed directly. But the controller for order creation needs a worker (the operator). POST /orders body: { companyId, amountCents, workerId }. Fine.

Now the error envelope: `{ error: { code, message, details } }` with a `code` in snake_case. I need an `AllExceptionsFilter` that maps exceptions to the envelope. Codes: `resource_not_found`, `invalid_state` (e.g., approving an already-approved order → maybe `conflict`? Let me define: `resource_not_found`, `invalid_transition`? For invalid state transitions on concurrent/racing approvals: `invalid_order_state`? Hmm, codes are the contract — I'll define: `resource_not_found`, `invalid_order_state`, `invalid_request` (validation). Keep small.

NestJS validation: use class-validator decorators on DTOs? That's a standard NestJS practice (controller validates input). DTOs with `class-validator` + `ValidationPipe` in main.ts. That requires the `class-validator`, `class-transformer` deps. OK.

Now the database schema via Prisma:

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }
```

Models:

```prisma
model Company {
  id        String   @id @default(uuid) @map("id")
  name      String   @map("name")
  createdAt DateTime @default(now()) @map("created_at")
  orders    PaymentOrder[]
  events    Event[]
  totals    CompanyTotals?
  @@map("companies")
}

model Worker {
  id          String  @id @default(uuid)
  name        String
  companyId   String  @map("company_id")
  company     Company @relation(fields:[companyId], references:[id])
  events      Event[]
  @@index([companyId])
  @@map("workers")
}

model PaymentOrder {
  id           String   @id @default(uuid)
  companyId    String   @map("company_id")
  company      Company  @relation(...)
  amountCents  Int      @map("amount_cents")
  currency     String   @default("USD")
  status       OrderStatus @default(PENDING)
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")
  events       Event[]
  @@index([companyId, status])
  @@map("payment_orders")
}

enum OrderStatus { PENDING APPROVED REJECTED }
// map to snake? enum values stored as given; DB values: use @map? Prisma enums don't support per-value mapping; the column type is a text with values PENDING/APPROVED/REJECTED. Dashboard status filter uses these tokens. Fine. Hmm, convention says tables/columns snake_case; enum values — keep PENDING etc. Or use a String column with values 'pending','approved','rejected'? A text column with a check constraint is more "Postgres-y," but a Prisma enum is cleaner for types. I'll use the enum (stored as PENDING etc.). The status in the API is lowercase? The controller takes a string and maps… keep the API status values = the enum names uppercased? Operators filter by status — I'll accept lowercase in the query and map to the enum. Meh, simpler: accept the same uppercase values as the enum? For a back-office API, lowercase is nicer: 'pending'|'approved'|'rejected' → mapped to OrderStatus.PENDING etc. I'll do the mapping in the dashboard service (small logic, acceptable — the service holds logic; the controller only validates shape).

model Event {
  id        String  @id @default(uuid)  // event id doubles as the projection row's id
  orderId   String  @map("order_id")
  order     PaymentOrder @relation(...)
  workerId  String  @map("worker_id")
  worker    Worker @relation(...)
  type      EventType
  occurredAt DateTime @map("occurred_at")
  @@index([occurredAt])
  @@map("events")
}

enum EventType { ORDER_CREATED ORDER_APPROVED ORDER_REJECTED }
```

Projection tables (marked as read model):

```prisma
model OperationEntry {
  id          String  @id @default(uuid)  // = event id
  orderId     String  @map("order_id")
  companyId   String  @map("company_id")
  orderStatus OrderStatus @map("order_status")
  workerId    String  @map("worker_id")
  workerName  String  @map("worker_name")
  amountCents Int     @map("amount_cents")
  eventType   String  @map("event_type")
  occurredAt  DateTime @map("occurred_at")
  @@index(...) // DDL index below
  @@map("operation_entries")
}

model CompanyTotals {
  companyId           String @id @map("company_id")
  ordersCount         Int    @default(0) @map("orders_count")
  pendingAmountCents  BigInt @default(0) @map("pending_amount_cents")
  approvedAmountCents BigInt @default(0) @map("approved_amount_cents")
  rejectedAmountCents BigInt @default(0) @map("rejected_amount_cents")
  updatedAt           DateTime @updatedAt @map("updated_at")
  @@map("company_totals")
}
```

BigInt for cents? With 3M orders, Int (2^31 ≈ 2.1B cents = $21M) might overflow. Use `Int`? For financial exactness, `BigInt` (8 bytes, exact) is the safe choice; JSON serialization: BigInt isn't JSON-serializable in Prisma — the client returns a BigInt; NestJS's JSON.stringify fails on BigInt! I need a serialization workaround (a class-serializer, or convert to string in the service). Options: use `Int` (document the $21M per-status cap — unrealistic for a marketplace with 3M orders). Or use Decimal? Prisma Decimal → also not JSON-serializable (a Decimal instance). Hmm. Simplest and robust: store as `BigInt`, and in the dashboard service, when returning totals, convert via `.toString()` (JSON string) — "exact" is preserved. Or expose as a string cents. In the dashboard response, I'll include per-company totals? Does the dashboard list include per-company totals? "Per-company financial totals must be exact" — probably shown on the dashboard (a totals panel). Let me have GET /operations return `items` + `totals` (for the filtered company) — the totals of the requested company (companyId filter is required? "Filter by company" — probably required; I'll make companyId required — the back-office views one company at a time; then the totals panel makes sense. Hmm, but "filter by company" could be optional. If optional, per-company totals is a multi-company aggregate… let me make `companyId` required — clean, matches "their own company" back-office. Actually wait: a marketplace back-office "filter by company" suggests multiple companies are viewable. The totals "per company" — with a single-company filter per request, totals = that company's. I'll require companyId and return that company's exact totals. Document the choice.

So the dashboard response:
```json
{
  "items": [ { id, orderId, company_id?, status, workerId, workerName, amountCents, occurredAt, eventType } ],
  "page": 1, "pageSize": 20, "total": 123,
  "totals": { "ordersCount": 10, "pendingAmountCents": "0", "approvedAmountCents": "15000", "rejectedAmountCents": "0" }
}
```
BigInt → string in JSON. I'll convert in the service.

DDL indexes (raw, in a migration). Prisma can create indexes via `@@index`, but for DESC + INCLUDE, I need `@@index([companyId, orderStatus, occurredAt(sort: Desc)])` — Prisma supports `sort: Desc` in index definitions (Postgres). `INCLUDE` columns: Prisma doesn't support INCLUDE (non-key columns) in indexes… actually, does Prisma support index filters and descending? For Postgres, Prisma supports `@db.Indexed` and `@@index` with `sort: Desc`/`sort: Asc` (yes, Prisma has supported sort direction in indexes since 3.x? Let me recall — yes: `@@index([a, b(sort: Desc)])` is supported for Postgres). INCLUDE is not supported by Prisma. So I'll do: let Prisma manage the base index in the schema (for migrations) — but for the covering index with INCLUDE, I need a custom migration SQL. Convention: "every schema change ships with a migration." I'll author the migration SQL files by hand (I'm creating the repo; the migration is just a file `prisma/migrations/<ts>_init/migration.sql` containing DDL + an update to the `_prisma_migrations` table? The standard Prisma migration folder has `migration.sql` with pure DDL; the history is tracked by prisma migrate deploy reading the files. I'll hand-write the SQL file with all the DDL (tables, indexes). Then the schema.prisma should match. For the covering index with INCLUDE, I'll write it directly in the migration SQL and not in schema.prisma (Prisma would drop it on the next migrate… but since I'm hand-authoring the migration, that's under my control; I'll note it). Alternatively, put the index in schema.prisma as `@@index([companyId, orderStatus, occurredAt(sort: Desc)])` (Prisma-generated DDL) and add the INCLUDE version in the migration… the duplication would make Prisma drift. Cleaner: keep the Prisma schema minimal (PK + FKs), and hand-write all indexes (including the covering one) in the migration SQL, and note in DESIGN.md that the covering index is hand-managed (Prisma can't express INCLUDE). Hmm, but "prisma migrate diff" would complain that the schema has no such index — I'll note it in DESIGN.md as intentional (a Prisma limitation). This is the standard real-world pattern: read-optimized indexes are managed in the migration, not in the schema file.

Decision: I'll hand-write `prisma/migrations/20250101000000_init/migration.sql` with the full DDL. Include:
- Tables: companies, workers, payment_orders, events, operation_entries, company_totals (+ enums, FKs, basic indexes).
- Covering index: `operation_entries_lookup_idx ON operation_entries (company_id, order_status, occurred_at DESC) INCLUDE (order_id, worker_id, worker_name, amount_cents, event_type)`.
- Index on events(occurred_at) for re-derivation; on payment_orders(company_id, status, amount_cents)? For totals recompute: `GROUP BY company_id, status` SUM — an index on (company_id, status, amount_cents) enables an index-only aggregate. I'll add.
- Index on operation_entries(occurred_at) for the window delete in re-derivation? The delete WHERE occurred_at IN window — a btree on occurred_at. Also drift detection. I'll add.

Wait — the enum: Prisma creates the enum type `OrderStatus` with values PENDING/APPROVED/REJECTED. In hand-written SQL: `CREATE TYPE "OrderStatus" AS ENUM ('PENDING','APPROVED','REJECTED');`.

FK naming, etc. — I'll write clean SQL.

But wait: tests need to run the migrations. I'll include a `package.json` with scripts: `test`, `migrate` (`prisma migrate deploy` or `migrate dev`), etc. Tests need a Postgres instance — `DATABASE_URL` from env. Vitest setup: create the PrismaClient, run migrations? In the test setup, I can call `prisma migrate deploy` programmatically? Simpler: a test helper that executes the migration SQL via `$executeRawUnsafe`? Migration SQL has multiple statements; psql-style. I could split by `;` (my SQL has no semicolons in strings — avoid dollar-quoted functions; keep statements simple) and execute each. Or use `child_process` `prisma migrate deploy`? No shell in tests is icky. I'll write a `test/setup.ts` that splits migration.sql on `;` and executes each statement via `$executeRawUnsafe` — but the migration references `prisma_migrations`? No — the pure DDL file doesn't. It has CREATE TYPE, CREATE TABLE, CREATE INDEX — splittable. But re-running on an existing DB fails (no IF NOT EXISTS). For CI-style tests: drop the schema first (`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`) then run the DDL. That's a clean, hermetic test setup. I'll do that in the vitest global setup.

Concurrency test "run two concurrently": two `Promise.all` of approve calls on two orders of the same company. For a true concurrency (overlapping transactions), the increments need to overlap. Since each approval is a short transaction, overlap is possible but timing-dependent. To *prove* no lost update deterministically… classic approach: run N concurrent approvals (e.g., 20 orders × 5 parallel?) and assert totals = sum. Even a single lost update breaks equality with high probability if the race is real? No — a lost update requires exact overlap of read-modify-write; with the short transaction of a real Prisma call (multiple roundtrips), overlap is likely but not guaranteed → flaky test. The spec: "prove it with a test that runs two concurrently, not sequentially." So: two concurrent approvals, assert totals exactly match the sum. With an atomic increment, it always passes; with read-modify-write, it usually fails. I'll do exactly two concurrent approvals (plus maybe more, say 8, to raise pressure, in a loop, and assert exact totals). Deterministically passing on the correct impl, catching the wrong one — that's the right shape. I'll do: create 20 pending orders, approve all with Promise.all (concurrent), assert totals.approved == 20*amount. Plus the literal two-concurrent case. Good.

Read-your-own-writes test: create an order → GET operations (pending shows it), approve → GET → it's approved; totals move. Also assert via the service, not the HTTP? The test should test behavior — I can test via service calls (unit-ish) or via the supertest HTTP. HTTP requires an e2e app setup (Nest testing). I'll use `@nestjs/testing` `Test.createTestingModule` with the real modules and supertest for at least the dashboard + approval flow — that's the true behavior test. Hmm, but Vitest + Nest e2e works fine. Let me structure:

- `test/read-your-own-writes.spec.ts` — e2e via app: POST /orders, GET /operations (see pending), POST /orders/:id/approve, GET /operations (see approved immediately). Assert.
- `test/concurrent-totals.spec.ts` — e2e: create two (and 18 more) orders, Promise.all approvals, GET /operations → totals exact.
- `test/drift-repair.spec.ts` — e2e: create orders, approve; inject drift (raw UPDATE via a PrismaClient in the test: corrupt an entry's order_status and an amount; corrupt a company_totals row); call the maintenance service's `repairDrift` (inject via app.get) for the window; assert projection == source; also re-derivation idempotency test: run re-derive window twice → same rows.

Wait, "test for read-your-own-writes, concurrent updates to one company's totals, and drift repair" — three test files (plus a re-derivation idempotency assertion inside the drift file or a separate `test/rederive.spec.ts`). The spec says "re-derive a window → projection matches source; run twice → same result" — that's an acceptance item; I'll add it to the drift file or its own file. I'll make `test/re-derivation.spec.ts` too — it's covered by the acceptance; a separate file is clearer. Four spec files.

Now, the "no change in what operators see" concern: the dashboard returns the same logical content. Since I'm defining the system fresh, I'll define the contract in the controller/service.

Let me design the endpoints:

- `POST /orders` body: `{ companyId, amountCents, currency?, workerId }` → 201 `{ id, status }`. Creates order + `ORDER_CREATED` event + projection hook (entry + totals: ordersCount+1, pending+amount).
- `POST /orders/{id}/approve` body: `{ workerId }` → 200 `{ id, status: 'approved' }`. Guards: order exists and status is PENDING, else 404/409 (`resource_not_found` / `invalid_order_state`).
- `POST /orders/{id}/reject` body: `{ workerId }`.
- `GET /operations?companyId=&status=&from=&to=&page=&pageSize=` → list + totals.

kebab-case plural endpoints: `/orders`, `/operations` — good; nested actions `/orders/:id/approve` (verb on a resource action — fine; the rule says endpoints are kebab-case plural — I'll keep the list endpoints plural, actions are subroutes, standard).

Error envelope filter: a global exception filter mapping HttpException to the envelope; custom `BusinessException` with code. Validation errors → `invalid_request` with details.

Now — layering with transaction propagation. The repository method:

```ts
// orders.repository.ts
@Injectable()
export class OrdersRepository {
  constructor(@Inject(PrismaService.token?) private readonly prisma: PrismaService) {}
  
  createOrderWithProjection(input: {...}, tx?: Prisma.TransactionClient) {...}
  approveOrder(orderId, workerId) {...} // wraps in $transaction internally
}
```

Who owns the `prisma.$transaction` call? The repository (it's DB work). The service calls `repo.approveOrder(...)`. The repo:

```ts
async approveOrder(orderId: string, workerId: string): Promise<...> {
  return this.prisma.$transaction(async (tx) => {
    const worker = await tx.worker.findUnique({ where: { id: workerId }, include: { company: true } });
    if (!worker) throw new ResourceNotFoundError('worker', workerId);
    const updated = await tx.paymentOrder.updateMany({
      where: { id: orderId, status: OrderStatus.PENDING },
      data: { status: OrderStatus.APPROVED },
    });
    if (updated.count === 0) {
      const order = await tx.paymentOrder.findUnique({ where: { id: orderId } });
      if (!order) throw new ResourceNotFoundError('order', orderId);
      throw new InvalidOrderStateError(order.id, order.status, OrderStatus.APPROVED);
    }
    const event = await tx.event.create({ data: { orderId, workerId, type: EventType.ORDER_APPROVED, occurredAt: new Date() } });
    await this.applyOrderStatusChangeProjection(tx, order..., event);
    return {...};
  });
}
```

Wait — the service should hold logic (state machine decisions). But state checks must be transactional with the conditional update (a read in the service followed by a repo update creates a TOCTOU). Defensible split: the service defines the state machine (which transitions are legal: `TRANSITIONS: { PENDING: ['APPROVED','REJECTED'], ... }`) and computes the intent; the repository executes the conditional update atomically and throws a typed error (invalid state vs not found). The service maps the thrown domain error to an HTTP exception. Domain errors defined in a shared place: `src/common/errors.ts` (NotFoundException, InvalidStateException with `code`). The repository throws domain errors; the controller/service translates? "Controller validates input and calls service. Zero business logic." Exception filter handles the translation to the envelope. Let me have domain exceptions carrying `code` + `message` + `details`; the global filter serializes them. HTTP status: 404 for not found, 409 for invalid state, 400 for validation.

Hmm, worker validation: the worker must belong to the order's company? (An operator approves an order of their own company.) That's a business rule → in the service? Also TOCTOU-ish but a soft rule; I'll enforce it in the repo inside the tx (a guard on the same read) — or more simply: enforce that the worker's company == the order's company inside the tx, and throw `forbidden`/`invalid_request`. Keep: I'll enforce, code `forbidden_worker_company`? Simpler code: `invalid_request` with a message. Hmm. Let me define the codes: `resource_not_found`, `invalid_order_state`, `invalid_request`, `forbidden`. OK.

The `createOrder` repo similarly in a tx: create order, event, projection entry (created), totals upsert+increment. Also worker-company match check.

Projection application (shared across create/approve/reject) — where? It's DB → repository. Let me make a `projection.repository.ts` under the `projection` feature? Or keep it inside orders.repository? The hook is "called from write services" — the write service calls the repository's method, which internally calls the projection repository's method with the same tx. Let me make a `projection` feature: `projection.repository.ts` with `upsertEntry(tx, ...)`, `syncOrderStatus(tx, orderId, status)`, `adjustTotals(tx, companyId, {deltas})`. The OrdersRepository (or a `ProjectionService`?) — hmm, a service between the write service and the projection repo? The write service can call both repositories… but the service can't do DB work beyond the calls. Cleaner: a `projection.service.ts` that holds the mapping logic (event → entry row; transition → totals deltas), and delegates persistence to `projection.repository.ts`. This makes the "hook" a first-class service: `ProjectionService.onOrderCreated(order, event, worker)`, `onOrderStatusChanged(order, from, to, event, worker)`. The write service calls the projection service inside… wait, the transaction. The tx handle is created inside the repository's `$transaction`. If the projection service needs the tx, the write service needs to pass it — but the write service can't open a Prisma transaction (no Prisma access).

Options:
A) The repository owns the whole tx: `orders.repository.approveOrder` calls `this.projectionRepo.upsertEntry(tx, ...)` directly (the repository uses the projection repository — a repo using another repo is fine, no layer violation: repos can cooperate). The "hook" is: the write service calls `ordersService.approve()` → `ordersRepo.approveOrder()` → inside tx: source writes + `projectionRepo.apply...`. But then the "hook" is in the repo, and the "logic" (which deltas) is in the projection repo — that violates "service holds logic." Hmm.

B) The write service orchestrates: `ordersService.approve` → `ordersRepo.withTransaction(async (tx) => { ... })`? Expose the tx to the service = the service is effectively doing DB orchestration (calls the repository method with tx — that's allowed! The service calls the repository; passing tx is just a parameter). So: `ordersRepo.beginTransaction()`? No — the service can't call prisma.$transaction, but it can call a repository method that returns a tx handle? That leaks the tx lifecycle (the service must commit/rollback). Cleaner: the repository exposes a "unit of work" method: `ordersRepo.approveOrder(intent, hooks)`, no…

C) Invert: have the projection service hold the logic, and the repository take a callback? Overengineered.

D) Pragmatic NestJS pattern: the `orders.repository.approveOrder` method receives nothing and internally: (1) tx begin, (2) source writes, (3) compute the projection delta via a pure logic function imported from a shared module (not a service) — e.g., `src/projection/projection-mapping.ts` a pure function: `deltasForStatusChange(from, to, amount)`, `entryFromEvent(event, order, worker)`. (4) call `projectionRepo` methods with tx. The logic lives in pure functions (testable) — "service holds logic" — the logic is trivial mapping; the service orchestrates the domain rules (state machine table, worker permissions). I think (D) with the logic in the `projection.service.ts`… the projection service needs the tx to apply…

Let me reconsider (B) concretely — it's actually clean:

```ts
// orders.service.ts
async approve(input: ApproveOrderInput) {
  // business rule: legal transition table
  const result = await this.ordersRepo.approveOrder({ orderId, workerId, toStatus: 'APPROVED' });
  await this.projectionService.applyOrderStatusChanged({order, from, to, event, worker}, result.txId???)
}
```
No — the projection has to be in the same tx.

OK, final approach (defensible and standard): the **repository method is the transactional unit** and takes a `Projector` collaborator (the `ProjectionService`), which it calls with `tx`. The projection service's methods take `(tx, payload)` and contain the mapping logic + calls the `projectionRepo` (the raw writes). So:

```
WriteService.approve(input)
  └─ OrdersRepo.approveOrder(input)                     // opens prisma.$transaction
       ├─ guards + conditional source update (tx)
       ├─ event insert (tx)
       └─ this.projector.onOrderStatusChanged(tx, {…})   // ProjectionService: maps + persists
            └─ ProjectionRepo.upsertEntry(tx, …) / .syncOrderStatus(tx, …) / .adjustTotals(tx, …)
```

Layer check: the service (OrdersService) holds business rules (transition table, response shaping). The repository (OrdersRepo) is the DB unit, and calls the ProjectionService… a repo calling a service — is that a violation? The layering rule: the controller calls the service; the service calls the repository; the repository touches the DB. A repo calling a service is an inversion (a cycle risk: ProjectionService → ProjectionRepo → (called from OrdersRepo)). Cycles in Nest DI: OrdersModule provides OrdersRepo (which injects ProjectionService), and ProjectionModule provides ProjectionService (which injects ProjectionRepo). No cycle unless OrdersModule ↔ ProjectionModule circular-exports. OrdersRepo (in OrdersModule) imports ProjectionService → OrdersModule imports ProjectionModule (which exports ProjectionService). ProjectionModule doesn't import OrdersModule. No cycle. It works.

But philosophically "the repository is the only layer that touches the database" — ProjectionService touches the DB only via ProjectionRepo ✓. "Service holds logic" — the projection mapping logic is in ProjectionService ✓. The OrdersRepo contains some logic (the conditional update semantics, error classification) — that's data-access logic (the conditional update is the mechanism for the invariant), acceptable. The *domain* rules (which transitions exist) are in OrdersService, and passed to the repo as an argument (`toStatus` + `expectedFrom` computed from the loaded current state? no — loading current state in the service and passing expectedFrom is TOCTOU… but the conditional update on status=PENDING enforces it; the transition table: approve → expectedFrom PENDING. The service computes the expectedFrom from the rule table based on action: approve → must be PENDING. So the service encodes `approve: {from: PENDING, to: APPROVED}`; the repo uses the from for the where clause; if count==0, it loads and classifies the error (not found vs wrong state). The service translates the domain error. Good.

Wait, do I really need to load the order in the service beforehand for the response (company, amount for the totals delta)? The totals delta needs amountCents: the repo reads the order row (inside tx, `SELECT ... FOR UPDATE`? The conditional `updateMany` doesn't return the row… I'll first read the order inside the tx: `tx.paymentOrder.findUnique({ where: { id: orderId }, ... })` — under concurrency: two approvers for the same order both read PENDING, both updateMany → the first gets count 1, the second gets count 0 → error. Correct. Then the repo has the order (amount, company). No need for FOR UPDATE thanks to the conditional update (optimistic by status predicate).

Now the ProjectionService method:

```ts
// projection.service.ts
onOrderCreated(tx, { order, event, worker }) {
  void this.projectionRepo.upsertEntry(tx, entryFromEvent(event, order, worker));
  void this.projectionRepo.adjustTotals(tx, order.companyId, { ordersCount: +1, [order.status]: +amount });
}
onOrderStatusChanged(tx, { order, from, to, event, worker }) {
  void this.projectionRepo.upsertEntry(tx, entryFromEvent(event, order, worker));
  void this.projectionRepo.syncOrderStatus(tx, order.id, to);
  void this.projectionRepo.adjustTotals(tx, order.companyId, { [from]: -amount, [to]: +amount });
}
```

The mapping `entryFromEvent` — a pure function in the same file or a separate `projection-mapping.ts`. I'll keep it in the service file as a module-level pure function (fine) — or in the repository? It's logic → service file. OK.

Hmm wait, does `adjustTotals` need to create the row if it doesn't exist? The row is created on company creation — but companies are seeded directly in tests via Prisma without a totals row! So adjustTotals must upsert-create (ON CONFLICT DO NOTHING then increment, or a single ON CONFLICT DO UPDATE with increment that covers both cases):

```sql
INSERT INTO company_totals (company_id, orders_count, pending_amount_cents, approved_amount_cents, rejected_amount_cents)
VALUES ($1, $d1, $d2, $d3, $d4)
ON CONFLICT (company_id) DO UPDATE SET
  orders_count = company_totals.orders_count + EXCLUDED.orders_count,
  pending_amount_cents = company_totals.pending_amount_cents + EXCLUDED.pending_amount_cents,
  ...
```
Wait — on INSERT (row doesn't exist), the values should be the delta (since zero base) ✓. On conflict, add delta ✓. One statement, atomic, no lost update, no P2002 race.

The BigInt parameter in $executeRaw: pass a number (delta fits in int) — Postgres will cast to bigint, fine. `updated_at` — with `@@updatedAt`, raw SQL inserts need to set it manually, or make the column default now() and the raw update set it: I'll manage updated_at in raw SQL (`now()`), and keep the Prisma field without `@updatedAt`? The Prisma schema must match the DDL. In the DDL: `updated_at timestamptz NOT NULL DEFAULT now()`. The raw update: set `updated_at = now()`. The Prisma field: `updatedAt DateTime @default(now()) @map("updated_at")`. When Prisma reads, fine. (Prisma's `@updatedAt` would auto-update on Prisma writes — but we only write this table via raw SQL; keep `@default(now())` without `@updatedAt` to match the DDL.)

Similarly operation_entries: no updated_at needed.

Now the DDL for operation_entries with event_type as text? I'll store the event type as a Prisma enum EventType (ORDER_CREATED, etc.). The dashboard response includes the event type. OK.

Entry upsert:

```sql
INSERT INTO operation_entries (id, order_id, company_id, order_status, worker_id, worker_name, amount_cents, event_type, occurred_at)
VALUES (...)
ON CONFLICT (id) DO UPDATE SET
  order_status = EXCLUDED.order_status,
  amount_cents = EXCLUDED.amount_cents,
  worker_name = EXCLUDED.worker_name,
  event_type = EXCLUDED.event_type,
  occurred_at = EXCLUDED.occurred_at;
```
Idempotent ✓ (double-hook application or re-derivation overlap → same row).

syncOrderStatus:
```sql
UPDATE operation_entries SET order_status = $2 WHERE order_id = $1 AND order_status <> $2;
```
Affects all entries for the order (all events of that order now display the current status) ✓.

Re-derivation (MaintenanceRepo.rederiveWindow(from, to)), in a single transaction (via `this.prisma.$transaction` with `$queryRaw`/`$executeRaw`):

```sql
-- 1. Delete window entries
DELETE FROM operation_entries WHERE occurred_at >= $1 AND occurred_at < $2;

-- 2. Re-insert from source
INSERT INTO operation_entries (id, order_id, company_id, order_status, worker_id, worker_name, amount_cents, event_type, occurred_at)
SELECT e.id, e.order_id, o.company_id, o.status, e.worker_id, w.name, o.amount_cents, e.type, e.occurred_at
FROM events e
JOIN payment_orders o ON o.id = e.order_id
JOIN workers w ON w.id = e.worker_id
WHERE e.occurred_at >= $1 AND e.occurred_at < $2;

-- 3. Totals: exact recompute for affected companies (full aggregate, not window!)
WITH affected AS (
  SELECT DISTINCT o.company_id
  FROM events e JOIN payment_orders o ON o.id = e.order_id
  WHERE e.occurred_at >= $1 AND e.occurred_at < $2
)
SELECT a.company_id FROM affected a
... FOR UPDATE? 
```
Hmm, locking: I want to lock the totals rows for affected companies before the recompute, so concurrent increments serialize after us.

```sql
WITH affected AS (SELECT DISTINCT o.company_id FROM events e JOIN payment_orders o ON o.id=e.order_id WHERE e.occurred_at BETWEEN $1 AND $2)
SELECT t.company_id FROM company_totals t JOIN affected a ON a.company_id = t.company_id FOR UPDATE;
```
Then:
```sql
-- Ensure the row exists
INSERT INTO company_totals (company_id) SELECT company_id FROM affected ON CONFLICT DO NOTHING;
-- Exact recompute (full aggregate per company, with status breakdown)
UPDATE company_totals t SET
  orders_count = s.orders_count,
  pending_amount_cents = s.pending_amount_cents,
  approved_amount_cents = s.approved_amount_cents,
  rejected_amount_cents = s.rejected_amount_cents,
  updated_at = now()
FROM (
  SELECT company_id,
         count(*) AS orders_count,
         COALESCE(sum(amount_cents) FILTER (WHERE status='PENDING'),0)::bigint AS pending_amount_cents,
         ... 
  FROM payment_orders GROUP BY company_id
) s WHERE t.company_id = s.company_id;
```
Wait — recompute all companies, or only affected? Recomputing all = full table aggregate over 3M — the "safe while live" concern + cost. Only affected: `WHERE t.company_id IN affected`. Let me scope: `... GROUP BY company_id HAVING company_id IN (SELECT company_id FROM affected)`. Hmm, `HAVING ... IN` is awkward; simpler:

```sql
UPDATE company_totals t SET ... FROM (
  SELECT o.company_id, count(*)::bigint ... 
  FROM payment_orders o WHERE o.company_id IN (SELECT company_id FROM affected) GROUP BY o.company_id
) s WHERE t.company_id = s.company_id;
```

But `affected` is a CTE — CTEs aren't visible across statements. So compute affected twice (statement 2 lock, statement 4 recompute) — fine, same value within the tx snapshot? Note: the tx's snapshot is at the first read; concurrent commits between our reads are invisible to both (READ COMMITTED: each statement gets a fresh snapshot!). Under READ COMMITTED, statement 4's `SELECT ... FROM events WHERE occurred_at...` sees commits that landed after statement 2's read! So `affected` in statement 4 could include more companies (a new event in the window committed in between). Is that a problem? Those additional companies: their totals get exactly recomputed too (harmless, more work). Their entries: statement 1's delete + statement 2's insert already ran — the new event's entry is… the writer's hook inserted it (after our delete, so it survives) ✓, and its company's totals: exactly recomputed, then the writer's increment… wait, ordering: the writer committed before statement 4 sees the event → its increment is already applied; our recompute SETs the exact value that includes that event's amount (recomputed from payment_orders, which also sees the committed write) → overwrites with exact → correct (recompute ⊇ writer's effect, no double-count since SET is absolute, not incremental) ✓✓. And the lock (statement 2's FOR UPDATE) — if the writer's company row lock: the writer committed before us, no contention. A writer committing between statement 2 and 4: it takes the row lock after our commit? No — we hold the lock until we commit; a concurrent writer's adjustTotals blocks on ON CONFLICT… it blocks until our tx commits, then applies the increment on the exact value ✓.

Entries for the event the concurrent writer committed mid-transaction: their occurred_at is now (in the window if the window ends at now). Statement 1's delete ran before their insert → their row survives ✓. Statement 2's insert (re-derivation) didn't include them (uncommitted at that time) → present exactly once (their hook's row) ✓. Consistent!

If the concurrent writer's event is before statement 2's read: included in the re-derivation ✓, their hook's row deleted by statement 1 ✓, once ✓.

Great — safe while live, idempotent (running twice: second run deletes and re-inserts the same set; totals SET to the same exact value → same result, provided no new activity; with new activity, converges to a newer exact value — "run twice on the same window must leave the same result" is under quiescence ✓; the test runs twice back-to-back without new writes ✓).

Drift repair (MaintenanceRepo):
- `detectDrift(from, to)` →
  - Entry drift: rows in operation_entries for the window that disagree with source, + missing rows (source events in window not in the projection), + extra rows (projection rows in window whose event no longer exists? the event id is the pk — an extra row = a row whose id is not in events, or a field mismatch). One SQL:

```sql
WITH source AS (
  SELECT e.id, e.order_id, o.company_id, o.status, e.worker_id, w.name AS worker_name, o.amount_cents, e.type, e.occurred_at
  FROM events e JOIN payment_orders o ON o.id=e.order_id JOIN workers w ON w.id=e.worker_id
  WHERE e.occurred_at >= $1 AND e.occurred_at < $2
),
mismatch AS (
  SELECT COALESCE(p.id, s.id) AS id,
         CASE WHEN p.id IS NULL THEN 'missing'
              WHEN s.id IS NULL THEN 'extra'
              WHEN (p.order_status, p.amount_cents, p.worker_name, p.event_type, p.occurred_at, p.company_id, p.order_id, p.worker_id) <> (s.status, s.amount_cents, s.worker_name, s.type, s.occurred_at, s.company_id, s.order_id, s.worker_id) THEN 'stale'
         END AS kind
  FROM source s FULL OUTER JOIN operation_entries p ON p.id = s.id
  WHERE p.id IS NULL OR s.id IS NULL OR (p.order_status,...) <> (s.status,...)
)
SELECT kind, count(*) FROM mismatch GROUP BY kind;
```
Row-wise comparison of a tuple list: Postgres allows `(a,b,c) <> (x,y,z)` ✓.

  - Totals drift (companies active in the window):
```sql
WITH affected AS (SELECT DISTINCT o.company_id FROM events e JOIN payment_orders o ... WHERE window),
expected AS (SELECT o.company_id, count(*)::bigint AS orders_count, COALESCE(sum(...) FILTER...) ... FROM payment_orders o WHERE o.company_id IN (SELECT company_id FROM affected) GROUP BY o.company_id)
SELECT e.company_id FROM expected e JOIN company_totals t ON t.company_id=e.company_id
WHERE t.orders_count <> e.orders_count OR t.pending_amount_cents <> e.pending_amount_cents OR ...
UNION SELECT a.company_id FROM affected a WHERE NOT EXISTS (SELECT 1 FROM company_totals t WHERE t.company_id=a.company_id);
```
- `repairDrift(from, to)`: detect; if entryDrift>0 or totalsDrift>0 → run rederiveWindow(from, to) (the exact builder); return a summary { window, entryDrift: {missing, extra, stale}, totalsDrift: [companyIds], repaired: true/false }.

Scheduled job: `DriftRepairJob` with `@Cron(CronExpression.EVERY_5_MINUTES)` (or configurable `DRIFT_REPAIR_INTERVAL`… "config from environment only" — the cron expression can be a literal; the window from an env var `DRIFT_REPAIR_LOOKBACK_MINUTES` defaulting to say 60? NestJS config: use `process.env` directly or @nestjs/config. I'll use `@nestjs/config`'s ConfigService for the lookback, with a default. Keep simple: read process.env in the job with a default constant. Hmm, "config from environment only" — a default fallback is fine as long as it's overridable. I'll use ConfigModule (global) + ConfigService with `getNumber('DRIFT_REPAIR_LOOKBACK_MINUTES', 120)`. Wait, a window that ends at "now": events occur at now; the window [now - lookback, now) — the last minute's writes… their hook wrote them (no drift from those). Drift = bugs/manual fixes. A 120-min lookback, 5-min interval → 4x overlap → drift is caught and fixed even if a run is skipped. But overlap + recompute of totals on every overlapping run: bounded work (affected companies per window). OK.

Edge: `to` = now; entries with occurred_at == exactly now? `to` exclusive is fine.

The job also logs the summary (NestJS Logger).

Now, the dashboard repository:

```ts
listOperations(query): Promise<{items, total}> {
  const where = { companyId, orderStatus, occurredAt: { gte: from, lt: to } };
  const [total, items] = await Promise.all([
    this.prisma.operationEntry.count({ where }),
    this.prisma.operationEntry.findMany({ where, orderBy: { occurredAt: 'desc' }, skip, take }),
  ]);
}
```
Both served by the covering index (count = index-only on the leading columns? `count` with companyId+orderStatus+occurredAt range → index-only ✓; findMany with skip/take → index scan, INCLUDE covers ✓). `ORDER BY occurred_at DESC` matches the index direction ✓. Ties: two events with the same occurred_at — the sort is non-deterministic across pages? Add a tiebreaker: secondary sort by id: `orderBy: [{occurredAt: 'desc'}, {id: 'desc'}]` — but then the index is only (…, occurred_at) — the tiebreak forces a sort? With INCLUDE id… the index INCLUDE columns can't be used for ordering. A small sort of the page rows? Postgres does an index scan in (company,status,occurred_at DESC) order, and for tied occurred_at, the order within a tied value is by TID (physical) — stable for a static table but changes with updates → possible page jitter on ties. occurred_at is timestamptz (microsecond precision) — ties are rare but possible (batch). To be safe: I'll define the ordering as occurred_at DESC, id DESC, and accept the small in-memory sort of only the page… hmm, that breaks "the index matches the sort" claim. Alternative: the index is (company_id, order_status, occurred_at DESC, id DESC) with id as a key column (not INCLUDE) — id is already the PK; adding it to the composite key is a small index-size cost, and the sort is fully index-driven. Let me do that: the covering index is `(company_id, order_status, occurred_at DESC, id) INCLUDE (order_id, worker_id, worker_name, amount_cents, event_type)`. Wait, id is the PK — including it as the fourth key column: fine. Then ORDER BY occurred_at DESC, id DESC is fully satisfied by the index ✓ deterministic pagination ✓.

Hmm, but Prisma's `orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }]` — matches ✓.

Total count with range: fine.

Now the Prisma schema for these tables — I'll declare the models (OperationEntry, CompanyTotals) with fields, PKs, `@@map`. I'll skip `@@index` entries in the schema (all indexes in the migration SQL, documented) — but wait: "every schema change ships with a migration" ✓ the migration is the DDL. Since I'm hand-writing the migration, Prisma schema indexes aren't needed to generate them. But future `prisma migrate dev` runs would diff and want to create/drop indexes → in this deliverable, note in DESIGN.md: read indexes are hand-managed in the migration (Prisma can't express INCLUDE/covering). Actually, to reduce drift risk, let me put indexes that Prisma *can* express into the schema.prisma (basic ones), and put the covering one only in the migration? Then the hand-written migration contains both the Prisma-generated ones and the extra — since I'm hand-writing it, fine, but I have to ensure the SQL matches what Prisma would generate for the schema's indexes (names: `operation_entries_company_id_idx`, etc.). Simpler and more honest: put all `@@index` in the schema.prisma that I want, hand-write the migration with the DDL for those exact indexes (matching Prisma naming convention `<table>_<cols>_idx`), plus the covering index (a name that doesn't collide). Document. That's the most consistent. Let me enumerate the indexes:

Source tables:
- companies: PK id.
- workers: PK id; `workers_company_id_idx (company_id)` — for lookups/validations.
- payment_orders: PK id; `payment_orders_company_id_status_idx (company_id, status)` — for re-derive aggregates? Aggregate needs (company_id, status, amount_cents) for index-only group-by-sum: `payment_orders_company_status_amount_idx (company_id, status, amount_cents)`. I'll use that (supersedes the 2-col one).
- events: PK id; `events_occurred_at_idx (occurred_at)` — window scans; `events_order_id_idx (order_id)` — FK + per-order lookups.

Projection:
- operation_entries: PK id; covering `operation_entries_lookup_idx (company_id, order_status, occurred_at DESC, id) INCLUDE (order_id, worker_id, worker_name, amount_cents, event_type)` — wait, id is both PK and a key column here; fine. And `operation_entries_occurred_at_idx (occurred_at)` — for window delete/re-derive. Hmm, the leading column of the lookup index is company_id — useless for a window delete (no company filter). Need the occurred_at index ✓.
- company_totals: PK company_id.

FK constraints: I'll add FKs for the source (worker.company→companies, order.company→companies, event.order→orders, event.worker→workers). FKs for the projection? The projection is a read model — FKs enforce integrity on writes (extra overhead on the hot write path: FK check on each entry insert = an index probe on the parent). Real read models skip FKs. Skip FKs on the projection, document in DESIGN.md. But the Prisma schema: I'll declare the fields without relations (plain String/Int fields) — fine.

Enum types: OrderStatus (PENDING, APPROVED, REJECTED), EventType (ORDER_CREATED, ORDER_APPROVED, ORDER_REJECTED). The projection's event_type column: I'll use the EventType enum type for consistency.

Now the migration SQL file: `prisma/migrations/20250101000000_init/migration.sql`. I'll write it carefully:

```sql
-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "EventType" AS ENUM ('ORDER_CREATED', 'ORDER_APPROVED', 'ORDER_REJECTED');

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "workers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "payment_orders" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "worker_id" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "operation_entries" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "order_status" "OrderStatus" NOT NULL,
    "worker_id" TEXT NOT NULL,
    "worker_name" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "event_type" "EventType" NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "operation_entries_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "company_totals" (
    "company_id" TEXT NOT NULL,
    "orders_count" INTEGER NOT NULL DEFAULT 0,
    "pending_amount_cents" BIGINT NOT NULL DEFAULT 0,
    "approved_amount_cents" BIGINT NOT NULL DEFAULT 0,
    "rejected_amount_cents" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "company_totals_pkey" PRIMARY KEY ("company_id")
);
-- CreateIndex
CREATE INDEX "workers_company_id_idx" ON "workers"("company_id");
CREATE INDEX "payment_orders_company_status_amount_idx" ON "payment_orders"("company_id", "status", "amount_cents");
CREATE INDEX "events_order_id_idx" ON "events"("order_id");
CREATE INDEX "events_occurred_at_idx" ON "events"("occurred_at");
CREATE INDEX "operation_entries_occurred_at_idx" ON "operation_entries"("occurred_at");
-- Covering read index for the dashboard access pattern (hand-managed; Prisma cannot express INCLUDE)
CREATE INDEX "operation_entries_lookup_idx"
    ON "operation_entries"("company_id", "order_status", "occurred_at" DESC, "id" DESC)
    INCLUDE ("order_id", "worker_id", "worker_name", "amount_cents", "event_type");
-- AddForeignKey
ALTER TABLE "workers" ADD CONSTRAINT "workers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "events" ADD CONSTRAINT "events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "payment_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "events" ADD CONSTRAINT "events_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

Prisma schema must match exactly (default now() → `@default(now())` produces TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP ✓; the enum naming `"OrderStatus"` — Prisma quotes the type name ✓ matches).

BigInt in Prisma: `BigInt @default(0)` → BIGINT ✓.

Now the app wiring.

Files:

```
package.json
tsconfig.json
tsconfig.build.json?
vitest.config.ts
prisma/schema.prisma
prisma/migrations/20250101000000_init/migration.sql
src/main.ts
src/app.module.ts
src/common/errors.ts
src/common/error-filter.ts
src/common/prisma.service.ts
src/orders/orders.module.ts
src/orders/orders.controller.ts
src/orders/orders.service.ts
src/orders/orders.repository.ts
src/orders/dto.ts (input types/DTOs)
src/projection/projection.module.ts
src/projection/projection.service.ts
src/projection/projection.repository.ts
src/dashboard/dashboard.module.ts
src/dashboard/dashboard.controller.ts
src/dashboard/dashboard.service.ts
src/dashboard/dashboard.repository.ts
src/maintenance/maintenance.module.ts
src/maintenance/maintenance.service.ts
src/maintenance/maintenance.repository.ts
src/maintenance/drift-repair.job.ts
test/read-your-own-writes.spec.ts
test/concurrent-totals.spec.ts
test/re-derivation.spec.ts
test/drift-repair.spec.ts
test/helpers.ts (app builder + prisma client + seed helpers)
DESIGN.md
```

package.json — deps: @nestjs/common, @nestjs/core, @nestjs/platform-express, @nestjs/schedule, @nestjs/config? (I said ConfigService; or skip @nestjs/config and read process.env in the job with a default — fewer deps, fewer surprises. The "config from environment only" convention → read process.env directly with a fallback in one place (the job). Hmm, the fallback constant is "hardcoded"? The convention bans hardcoded *connection strings*/secrets; a default for the lookback is config with a default — acceptable. To be safe and idiomatic, I'll use @nestjs/config's ConfigService — it's standard. Ehh — fewer moving parts: `process.env.DRIFT_REPAIR_LOOKBACK_MINUTES` parsed in the job with default 120. Fine, I'll note it. Actually the cron expression: `@Cron(CronExpression.EVERY_5_MINUTES)` literal — fine, or env `DRIFT_REPAIR_CRON`. I'll keep the literal + lookback env. Keep it simple.

Deps:
- @nestjs/common, @nestjs/core, @nestjs/platform-express, @nestjs/schedule, reflect-metadata, rxjs
- @prisma/client, class-validator, class-transformer
devDeps: prisma, typescript, ts-node? (for running nest? Tests go via vitest; no runtime build needed for the deliverable — but main.ts exists; add tsx? Vitest handles TS via esbuild — no tsconfig path issues if I use relative imports. No `nest` CLI needed. I'll include typescript + vitest + @types/node + @types/express.

ESM: `"type": "module"`. NestJS with ESM on Node 20 — requires `module: nodenext`? NestJS ESM support: import specifiers must include `.js` extensions?? With `"type": "module"` and native ESM, TypeScript's `moduleResolution: "nodenext"` requires extensions on relative imports. But Vitest (esbuild) handles extensionless fine. Hmm, this is a real friction point: ESM + NestJS + extensionless imports work under Vitest and under `tsx`/`ts-node-esm`? With native node ESM TS via `tsc` output: extensionless relative imports break at runtime. Many projects use `"type": "module"` with Vitest only, and run via tsx (which resolves extensions for TS files? tsx supports extensionless for TS files? tsx resolves .ts for extensionless — yes, tsx/esbuild resolves TS extensionless). 

The convention says ESM `"type": "module"`. I'll write the imports without extensions (standard TS style), set tsconfig to `module: "nodenext"`? That errors at type-check for extensionless relative imports ("relative import paths need explicit file extensions"). `module: "esnext"` + `moduleResolution: "bundler"` allows extensionless — bundler-style, matches how Vitest/tsx will consume it. I'll use: `module: "esnext"`, `moduleResolution: "bundler"`. Type-check clean, Vitest clean. For actually running the server: I'll document `pnpm start:dev` = `tsx watch src/main.ts`? tsx handles extensionless TS under ESM? tsx (esbuild-based) — yes, it patches resolution to allow TS extensionless. I'll include `tsx` in devDeps with a start script. The deliverable is judged on code; I'll make the scripts sensible: `start: tsx src/main.ts`, `test: vitest run`, `prisma:migrate: prisma migrate deploy`.

Vitest config: `test/vitest.config.ts`? The root `vitest.config.ts` with globals? I'll write explicit imports (no globals to keep types simple): `import { describe, it, expect, beforeAll, afterAll } from 'vitest'`. Setup: a per-file or shared beforeAll that: creates the app (Nest Testing), ensures the schema. Schema setup: a shared helper `test/helpers.ts`:

```ts
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const prisma = new PrismaClient();

export async function resetDatabase() {
  // Hermetic: drop & recreate the schema, apply the init migration, refresh client cache
  await prisma.$executeRawUnsafe('DROP SCHEMA public CASCADE');
  await prisma.$executeRawUnsafe('CREATE SCHEMA public');
  const sql = readFileSync(resolve(__dirname, '../prisma/migrations/20250101000000_init/migration.sql'), 'utf8');
  for (const statement of sql.split('\n').flatMap(l => ...)) // split by ';' at line end
    await prisma.$executeRawUnsafe(statement);
}
```
Split: my migration SQL has no `;` inside strings → split by `;\n` or `;` and filter non-empty after trim, strip comments? Prisma's $executeRawUnsafe sends to pg — can pg handle a single statement with leading `--` comment lines? A single statement with leading comment is fine for pg (comment is skipped). Splitting: `sql.split(';')` → parts; trim; drop empty; a part may contain multiple statements? No. But a trailing `-- comment` after the last `;`? Fine. But careful: a part contains a `CREATE TYPE ... ;` boundary — each part = one statement ✓. Comment lines within a part: pg handles comments within a statement fine ✓.

`__dirname` in ESM Vitest: not defined! Use `import.meta.url` + fileURLToPath. Or `new URL('../prisma/...', import.meta.url)`. I'll use fileURLToPath.

Alternative: use the `prisma migrate deploy` child process in setup — needs a shell; the readFileSync approach is hermetic and dep-free. ✓

App builder helper:

```ts
export async function buildApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return { app, moduleRef };
}
```

Wait — the global pipe/filter is better in main.ts; the e2e app should mirror main.ts. I'll put `app.useGlobalPipes` + `app.useGlobalFilters(new AllExceptionsFilter())` in main.ts, and replicate in the helper (or a shared function `configure(app)` in main? main.ts is the app's entry; the test helper imports AppModule and configures itself — a slight duplication, acceptable, or export a `configureApplication` from app.module? I'll keep the duplication in the helper, small).

The schedule module: in e2e tests, @Cron jobs would fire! The job runs every 5 min — a test run is much shorter; but `app.init()` starts the cron (5 min, no fire). Safe. But to be deterministic, disable the schedule in tests? `ScheduleModule.forRoot()` is fine; with a 5-min interval, tests won't trigger it. OK.

Now the PrismaService: a standard NestJS provider that extends PrismaClient, onModuleInit → $connect, onModuleDestroy → $disconnect.

```ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy { ... }
```

The repositories inject PrismaService. In e2e tests, the real Postgres (DATABASE_URL). Vitest concurrency: separate test files run in separate processes (vitest default threads pool, separate worker per file) — but they share the same DB! resetDatabase in each file's beforeAll → sequential interference if parallel. Solution: `fileParallelism: false` / `pool: 'forks'` + `singleFork`? Simplest: vitest.config with `test: { fileParallelism: false, ... }` (serial files). I'll add that. Within a file, tests run serially (default) ✓.

Now the code details.

**src/common/errors.ts**

```ts
export class DomainError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number, public readonly details: Record<string, unknown> = {}) { super(message); }
}
export class ResourceNotFoundError extends DomainError { constructor(resource: string, id: string) { super('resource_not_found', `...`, 404, { resource, id }); } }
export class InvalidOrderStateError ... code 'invalid_order_state', 409, details { orderId, currentStatus, expectedFrom }
export class InvalidRequestError ... 'invalid_request', 400
export class ForbiddenError ... 'forbidden', 403
```

The error filter (src/common/all-exceptions.filter.ts):

```ts
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp(); const res = ctx.getResponse<Response>(); const req = ctx.getRequest<Request>();
    let status = 500; let code = 'internal_error'; let message = 'Unexpected error'; const details = {};
    if (exception instanceof DomainError) {...}
    else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      if (typeof r === 'string') message = r;
      else { code = (r as any).code ?? snakeify(status); message = ...; details = (r as any).details ?? {} }
    }
    res.status(status).json({ error: { code, message, details } });
  }
}
```
ValidationPipe produces a BadRequestException with a `message: string[]` → code 'invalid_request', details { issues: messages }. Map status: 400→invalid_request, 404→resource_not_found, 409→conflict, default snake: 'http_400'? Keep the mapping small.

**DTOs** (src/orders/dto.ts):

```ts
export class CreateOrderDto {
  @IsString() @IsUUID() companyId!: string;
  @IsInt() @Min(1) amountCents!: number;
  @IsString() @Length(3,3) currency?: string;
  @IsString() @IsUUID() workerId!: string;
}
export class TransitionOrderDto { @IsUUID() workerId!: string; }
export class ListOperationsQueryDto { @IsUUID() companyId!: string; @IsIn(['pending','approved','rejected'])? or optional status... }
```

Dashboard: companyId required; status optional (all); from/to optional ISO datetimes; page≥1 default 1; pageSize 1..100 default 20. Validate with class-validator: `@IsOptional() @IsISO8601()`; page: `@IsOptional() @IsInt() @Min(1)`.

The service maps 'pending'→PENDING.

**Orders service:**

```ts
@Injectable()
export class OrdersService {
  constructor(private readonly ordersRepo: OrdersRepository) {}
  async create(dto) { return this.ordersRepo.createOrder(dto); } // the repo does the tx including the hook
  async approve(dto) { return this.ordersRepo.transitionOrder({ orderId, to: 'APPROVED', workerId }); }
  async reject(dto) { ... 'REJECTED' }
}
```

Hmm — where's the business logic? The transition table: approve: from PENDING → APPROVED. Encode in the service:

```ts
const APPROVAL = { from: OrderStatus.PENDING, to: OrderStatus.APPROVED, eventType: EventType.ORDER_APPROVED };
```
The repo method signature: `transitionOrder({ orderId, workerId, from, to, eventType })`. The service picks the transition constant. The repo executes: tx → read worker (must exist; must belong to the same company as the order — check after reading the order), conditional updateMany with where {id, status: from}, count? → error; read the order (before update, for the amount/company — or `findFirst` after? read first: `findUnique` → if !order → 404; if order.status !== from → invalid_order_state (no need for conditional? Two concurrent approvers both read PENDING, both updateMany → one wins (count 1), the other count 0 → then re-read? The other already classified from the stale read → would throw invalid state with the stale read's status… let me do this: updateMany first (authoritative), if 0 → findUnique → classify (missing vs wrong state with fresh status). Avoid the separate pre-read for the classification; but I need the order row data (company, amount) for the hook → after successful update, findUnique (status now 'to'). Under concurrency: loser gets count 0 → error ✓. Winner: reads the row (own update, no lock needed — row is uniquely identified, no one else can modify it since status changed… a concurrent reject on the same order: both updateMany — one count 1, one 0 ✓ (Postgres row-level: the second blocks on the first's row lock until commit, then re-evaluates the where → status changed → count 0) ✓✓.

So the repo:

```ts
async transitionOrder(args: { orderId, workerId, from, to, eventType }): Promise<TransitionedOrder> {
  return this.prisma.$transaction(async (tx) => {
    const updated = await tx.paymentOrder.updateMany({ where: { id: args.orderId, status: args.from }, data: { status: args.to } });
    if (updated.count === 0) {
      const order = await tx.paymentOrder.findUnique({ where: { id: args.orderId } });
      if (!order) throw new ResourceNotFoundError('order', args.orderId);
      throw new InvalidOrderStateError(args.orderId, order.status, args.from);
    }
    const worker = await tx.worker.findUnique({ where: { id: args.workerId }, include: { company: { select: { id: true } } } });
    if (!worker) throw new ResourceNotFoundError('worker', args.workerId);
    const order = await tx.paymentOrder.findUniqueOrThrow({ where: { id: args.orderId } });
    if (worker.companyId !== order.companyId) throw new ForbiddenError(...);
    const occurredAt = new Date();
    const event = await tx.event.create({ data: { id: uuid? default, orderId: order.id, workerId: worker.id, type: args.eventType, occurredAt } });
    await this.projector.onOrderStatusChanged(tx, { order, from: args.from, to: args.to, event, worker });
    return { id: order.id, status: args.to, companyId: order.companyId, amountCents: order.amountCents };
  });
}
```

uuid: Prisma `@default(uuid())` → omit id in create ✓.

createOrder:

```ts
return this.prisma.$transaction(async (tx) => {
  const worker = await tx.worker.findUnique({ where: { id: input.workerId } });
  if (!worker) throw new ResourceNotFoundError('worker', input.workerId);
  if (worker.companyId !== input.companyId) throw new ForbiddenError();
  const company = await tx.company.findUnique({ where: { id: input.companyId } });
  if (!company) throw new ResourceNotFoundError('company', input.companyId);
  const occurredAt = new Date();
  const order = await tx.paymentOrder.create({ data: { id: uid?, companyId, amountCents, currency: input.currency ?? 'USD', status: PENDING } });
  const event = await tx.event.create({ data: { orderId: order.id, workerId: worker.id, type: ORDER_CREATED, occurredAt } });
  await this.projector.onOrderCreated(tx, { order, event, worker });
  return { id: order.id, status: 'pending', companyId, amountCents };
});
```

The worker name for the entry: the worker row has a name ✓ (fetch the full worker).

**ProjectionService** (src/projection/projection.service.ts):

```ts
@Injectable()
export class ProjectionService {
  constructor(private readonly repo: ProjectionRepository) {}

  async onOrderCreated(tx: Prisma.TransactionClient, p: { order: {id, companyId, amountCents, currency, status}; event: {id, type, occurredAt}; worker: {id, name} }): Promise<void> {
    await this.repo.upsertEntry(tx, this.entryFrom(p, p.order.status));
    await this.repo.adjustTotals(tx, p.order.companyId, { ordersCount: 1, [p.order.status]: p.order.amountCents } as TotalsDelta);
  }

  async onOrderStatusChanged(tx, p: { order; from; to; event; worker }) {
    await this.repo.upsertEntry(tx, this.entryFrom(p, p.to));
    await this.repo.syncOrderStatus(tx, p.order.id, p.to);
    await this.repo.adjustTotals(tx, p.order.companyId, { ordersCount: 0, [p.from]: -p.order.amountCents, [p.to]: +p.order.amountCents });
  }

  private entryFrom(p, status) {
    return { id: p.event.id, orderId: p.order.id, companyId: p.order.companyId, orderStatus: status, workerId: p.worker.id, workerName: p.worker.name, amountCents: p.order.amountCents, eventType: p.event.type, occurredAt: p.event.occurredAt };
  }
}
```

The TotalsDelta type: `{ ordersCount?: number; pending?: number; approved?: number; rejected?: number }` — keyed by status? I'll map to the delta object the repo uses: `{ ordersCount, pendingAmountCents, approvedAmountCents, rejectedAmountCents }` with defaults 0. I'll build it explicitly:

```ts
private deltaFor(status: OrderStatus, amountCents: number): TotalsDelta {
  const d: TotalsDelta = { ordersCount: 0, pendingAmountCents: 0, approvedAmountCents: 0, rejectedAmountCents: 0 };
  d[statusAmountField[status]] += amountCents; // hmm
}
```
A simpler explicit switch:
```ts
const FIELDS: Record<OrderStatus, keyof TotalsDelta> = { PENDING: 'pendingAmountCents', APPROVED: 'approvedAmountCents', REJECTED: 'rejectedAmountCents' };
```
✓ (OrderStatus is a Prisma enum import — the Prisma client generates a `Prisma.OrderStatus` constant; with `@prisma/client` and TS, `import { OrderStatus } from '@prisma/client'`? Prisma generates the enum as a const object + a type, if it's a native enum. `import { OrderStatus, EventType } from '@prisma/client'` works ✓.)

**ProjectionRepository**:

```ts
@Injectable()
export class ProjectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsertEntry(tx: Prisma.TransactionClient, e: OperationEntryRow): Promise<void> {
    await tx.$executeRaw`INSERT INTO operation_entries (id, order_id, company_id, order_status, worker_id, worker_name, amount_cents, event_type, occurred_at)
      VALUES (${e.id}, ${e.orderId}, ${e.companyId}, ${e.orderStatus}, ${e.workerId}, ${e.workerName}, ${e.amountCents}, ${e.eventType}, ${e.occurredAt})
      ON CONFLICT (id) DO UPDATE SET
        order_status = EXCLUDED.order_status,
        amount_cents = EXCLUDED.amount_cents,
        worker_name = EXCLUDED.worker_name,
        event_type = EXCLUDED.event_type,
        occurred_at = EXCLUDED.occurred_at;`;
  }
```
Tagged-template `$executeRaw` with enum values: Prisma serializes the enum string fine (it sends the string). The enum parameter to a column of the enum type — the pg driver sends a string; Postgres casts ✓. occurredAt Date → timestamptz ✓.

Note: tagged-template raw inside a tx: `tx.$executeRaw` ✓ supported.

  ```ts
  async syncOrderStatus(tx, orderId, status) {
    await tx.$executeRaw`UPDATE operation_entries SET order_status = ${status} WHERE order_id = ${orderId} AND order_status <> ${status}`;
  }
  async adjustTotals(tx, companyId, d: TotalsDelta) {
    await tx.$executeRaw`INSERT INTO company_totals (company_id, orders_count, pending_amount_cents, approved_amount_cents, rejected_amount_cents)
      VALUES (${companyId}, ${d.ordersCount}, ${d.pendingAmountCents}, ${d.approvedAmountCents}, ${d.rejectedAmountCents})
      ON CONFLICT (company_id) DO UPDATE SET
        orders_count = company_totals.orders_count + EXCLUDED.orders_count,
        pending_amount_cents = company_totals.pending_amount_cents + EXCLUDED.pending_amount_cents,
        approved_amount_cents = company_totals.approved_amount_cents + EXCLUDED.approved_amount_cents,
        rejected_amount_cents = company_totals.rejected_amount_cents + EXCLUDED.rejected_amount_cents,
        updated_at = now();`;
  }
```
Wait: on INSERT (a new row), updated_at defaults to now() ✓; the ON CONFLICT DO UPDATE path sets it ✓. The DO UPDATE SET with a `now()` constant — fine.

Hmm — a subtlety: with negative deltas (status change moves amount from pending to approved): the INSERT path (a new company totals row) with negative pending? Can't happen: a status change requires the order to exist → the totals row was created on order creation (adjustTotals on create with positive). But if the company_totals row was deleted (drift: someone drops the row), then a status change: INSERT with pending=-amount, approved=+amount → wrong (orders_count 0). Drift repair's re-derive recreates the row exactly. Edge acceptable (the repair path fixes it). Or guard: in adjustTotals, if the INSERT happens with a non-create delta… can't distinguish cheaply. Documented: the totals row is created by the first order write; re-derivation repairs a missing row. Fine — actually wait, let me harden: `adjustTotals` can't know. The re-derive's `INSERT ... SELECT company_id FROM affected ON CONFLICT DO NOTHING` creates an empty row, then UPDATE SETs exact ✓ covers the missing-row drift.

**Dashboard repository:**

```ts
@Injectable()
export class DashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listOperations(q: { companyId, orderStatus?: OrderStatus, from?: Date, to?: Date, skip, take }) {
    const where: Prisma.OperationEntryWhereInput = {
      companyId: q.companyId,
      ...(q.orderStatus ? { orderStatus: q.orderStatus } : {}),
      ...(q.from || q.to ? { occurredAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) } } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.operationEntry.count({ where }),
      this.prisma.operationEntry.findMany({ where, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], skip: q.skip, take: q.take }),
    ]);
    return { total, items };
  }

  async getCompanyTotals(companyId) {
    return this.prisma.companyTotals.findUnique({ where: { companyId } }); // may be null
  }
}
```

Both hit only operation_entries / company_totals — "the dashboard query touches only the projection" ✓ (company_totals is a projection table ✓ — it's part of the read model. The requirement "no joins back to source tables" ✓.)

**Dashboard service:**

```ts
@Injectable()
export class DashboardService {
  constructor(private readonly repo: DashboardRepository) {}
  async listOperations(dto: ListOperationsQueryDto) {
    const page = dto.page ?? 1; const pageSize = dto.pageSize ?? 20;
    const orderStatus = dto.status ? ORDER_STATUS_TOKEN[dto.status] : undefined;
    const { total, items } = await this.repo.listOperations({
      companyId: dto.companyId,
      orderStatus,
      from: dto.from ? new Date(dto.from) : undefined,
      to: dto.to ? new Date(dto.to) : undefined,
      skip: (page-1)*pageSize, take: pageSize,
    });
    const totalsRow = await this.repo.getCompanyTotals(dto.companyId);
    return {
      items: items.map(e => ({ id: e.id, orderId: e.orderId, status: token(e.orderStatus), eventType: token(e.eventType), workerId: e.workerId, workerName: e.workerName, amountCents: e.amountCents, occurredAt: e.occurredAt.toISOString() })),
      page, pageSize, total,
      totals: totalsRow ? { ordersCount: totalsRow.ordersCount, pendingAmountCents: totalsRow.pendingAmountCents.toString(), approvedAmountCents: ..., rejectedAmountCents: ... } : zero
    };
  }
}
```
Token mapping: enum PENDING → 'pending' (lowercase API). The response uses lowercase status — consistent with the query tokens. BigInt → string ✓ (exact, JSON-safe).

**Maintenance service:**

```ts
@Injectable()
export class MaintenanceService {
  constructor(private readonly repo: MaintenanceRepository, private readonly logger: Logger = new Logger(MaintenanceService.name)) {}

  rederiveWindow(from, to) { return this.repo.rederiveWindow(from, to); }
  async repairDrift(lookbackMs or {from,to}) {
    const to = new Date(); const from = new Date(to.getTime() - lookback);
    const drift = await this.repo.detectDrift(from, to);
    const repaired = drift.entry.missing + drift.entry.extra + drift.entry.stale > 0 || drift.totals.length > 0;
    if (repaired) await this.repo.rederiveWindow(from, to);
    this.logger.log(`drift repair [${from} → ${to}]: entries ${drift.entry...}, totals ${drift.totals.length}, repaired=${repaired}`);
    return { from, to, ...drift, repaired };
  }
}
```

**Drift repair job** (src/maintenance/drift-repair.job.ts):

```ts
@Injectable()
export class DriftRepairJob {
  constructor(private readonly maintenance: MaintenanceService) {}
  @Cron(CronExpression.EVERY_5_MINUTES)
  async run() {
    const lookbackMinutes = Number(process.env.DRIFT_REPAIR_LOOKBACK_MINUTES ?? 120);
    await this.maintenance.repairDrift(lookbackMinutes * 60_000);
  }
}
```

**Maintenance repository** — the SQL. All in one interactive transaction where needed.

rederiveWindow:

```ts
async rederiveWindow(from: Date, to: Date): Promise<{ entriesReinserted: number }> {
  return this.prisma.$transaction(async (tx) => {
    await tx.$executeRaw`DELETE FROM operation_entries WHERE occurred_at >= ${from} AND occurred_at < ${to}`;
    const inserted = await tx.$executeRaw`INSERT INTO operation_entries (id, order_id, company_id, order_status, worker_id, worker_name, amount_cents, event_type, occurred_at)
      SELECT e.id, e.order_id, o.company_id, o.status, e.worker_id, w.name, o.amount_cents, e.type, e.occurred_at
      FROM events e
      JOIN payment_orders o ON o.id = e.order_id
      JOIN workers w ON w.id = e.worker_id
      WHERE e.occurred_at >= ${from} AND e.occurred_at < ${to}`;
    // Lock the totals rows for affected companies so that live increments serialize after this recompute
    await tx.$executeRawUnsafe(`
      WITH affected AS (
        SELECT DISTINCT o.company_id
        FROM events e JOIN payment_orders o ON o.id = e.order_id
        WHERE e.occurred_at >= $1 AND e.occurred_at < $2
      )
      SELECT t.company_id FROM company_totals t JOIN affected a ON a.company_id = t.company_id FOR UPDATE`, [from, to]);
    await tx.$executeRawUnsafe(`
      INSERT INTO company_totals (company_id)
      SELECT DISTINCT o.company_id FROM events e JOIN payment_orders o ON o.id = e.order_id
      WHERE e.occurred_at >= $1 AND e.occurred_at < $2
      ON CONFLICT (company_id) DO NOTHING`, [from, to]);
    await tx.$executeRawUnsafe(`
      UPDATE company_totals t SET
        orders_count = s.orders_count,
        pending_amount_cents = s.pending_amount_cents,
        approved_amount_cents = s.approved_amount_cents,
        rejected_amount_cents = s.rejected_amount_cents,
        updated_at = now()
      FROM (
        SELECT o.company_id,
               count(*)::int AS orders_count,
               COALESCE(sum(o.amount_cents) FILTER (WHERE o.status = 'PENDING'), 0)::bigint AS pending_amount_cents,
               COALESCE(sum(o.amount_cents) FILTER (WHERE o.status = 'APPROVED'), 0)::bigint AS approved_amount_cents,
               COALESCE(sum(o.amount_cents) FILTER (WHERE o.status = 'REJECTED'), 0)::bigint AS rejected_amount_cents
        FROM payment_orders o
        WHERE o.company_id IN (
          SELECT DISTINCT o2.company_id FROM events e2 JOIN payment_orders o2 ON o2.id = e2.order_id
          WHERE e2.occurred_at >= $1 AND e2.occurred_at < $2
        )
        GROUP BY o.company_id
      ) s
      WHERE t.company_id = s.company_id`, [from, to]);
    return { entriesReinserted: Number(inserted) };
  });
}
```

`$executeRaw` tagged returns a number of affected rows for INSERT...SELECT ✓ (pg returns rowCount).

detectDrift:

```ts
async detectDrift(from: Date, to: Date): Promise<DriftReport> {
  const entryRows = await this.prisma.$queryRawUnsafe< { kind: string; count: bigint } []>(`
    WITH source AS (
      SELECT e.id, e.order_id, o.company_id, o.status, e.worker_id, w.name AS worker_name, o.amount_cents, e.type, e.occurred_at
      FROM events e
      JOIN payment_orders o ON o.id = e.order_id
      JOIN workers w ON w.id = e.worker_id
      WHERE e.occurred_at >= $1 AND e.occurred_at < $2
    )
    SELECT
      CASE
        WHEN p.id IS NULL THEN 'missing'
        WHEN s.id IS NULL THEN 'extra'
        ELSE 'stale'
      END AS kind,
      count(*)::bigint AS count
    FROM source s
    FULL OUTER JOIN operation_entries p ON p.id = s.id
    WHERE p.id IS NULL
       OR s.id IS NULL
       OR (p.order_id, p.company_id, p.order_status, p.worker_id, p.worker_name, p.amount_cents, p.event_type, p.occurred_at)
        <> (s.order_id, s.company_id, s.status, s.worker_id, s.worker_name, s.amount_cents, s.type, s.occurred_at)
    GROUP BY 1`, [from, to]);
```
Wait: for the stale comparison when both exist — I need to ensure p/s exist for the tuple comparison (NULL tuples: `(NULL,...) <> (...)` → NULL → filtered by WHERE ✓ actually if p.id is not null and s.id is not null, the tuple is fine). The WHERE clause ordering: p.id IS NULL OR s.id IS NULL OR tuple≠tuple — when p.id IS NULL, the tuple comparison is NULL → OR short-circuits to TRUE via the first term ✓.

  Totals:
```sql
WITH affected AS (
  SELECT DISTINCT o.company_id FROM events e JOIN payment_orders o ON o.id = e.order_id
  WHERE e.occurred_at >= $1 AND e.occurred_at < $2
),
expected AS (
  SELECT o.company_id, count(*)::int AS orders_count,
         COALESCE(sum(o.amount_cents) FILTER (WHERE o.status='PENDING'),0)::bigint AS pending_amount_cents,
         COALESCE(sum(o.amount_cents) FILTER (WHERE o.status='APPROVED'),0)::bigint AS approved_amount_cents,
         COALESCE(sum(o.amount_cents) FILTER (WHERE o.status='REJECTED'),0)::bigint AS rejected_amount_cents
  FROM payment_orders o WHERE o.company_id IN (SELECT company_id FROM affected) GROUP BY o.company_id
)
SELECT e.company_id FROM expected e
LEFT JOIN company_totals t ON t.company_id = e.company_id
WHERE t.company_id IS NULL
   OR t.orders_count <> e.orders_count
   OR t.pending_amount_cents <> e.pending_amount_cents
   OR t.approved_amount_cents <> e.approved_amount_cents
   OR t.rejected_amount_cents <> e.rejected_amount_cents
```
Hmm — `t.company_id IS NULL OR t.orders_count <> e.orders_count`: t.company_id is never null (it's the PK) → NULL <> → NULL → the row is only included if the IS NULL term is true ✓ correct.

Return the array of company_ids.

**Test helpers** (test/helpers.ts):

```ts
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { AppModule } from '../src/app.module';
import { ValidationPipe } from '@nestjs/common';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';

export const prisma = new PrismaClient();

export async function resetDatabase(): Promise<void> {
  await prisma.$connect();
  await prisma.$executeRawUnsafe('DROP SCHEMA public CASCADE');
  await prisma.$executeRawUnsafe('CREATE SCHEMA public');
  const migration = readFileSync(fileURLToPath(new URL('../prisma/migrations/20250101000000_init/migration.sql', import.meta.url)), 'utf8');
  for (const statement of migration.split(';')) {
    const sql = statement.trim();
    if (sql) await prisma.$executeRawUnsafe(sql);
  }
}

export async function buildApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}

export interface Seeds { companyId: string; workerId: string; }
export async function seedCompanyAndWorker(companyName?: string): Promise<Seeds> {
  const company = await prisma.company.create({ data: { name: companyName ?? `Company ${Math.random()...}` } });
  const worker = await prisma.worker.create({ data: { name: 'Op One', companyId: company.id } });
  return { companyId: company.id, workerId: worker.id };
}

export async function close(app) { await app.close(); }
```

Wait: `app.init()` vs `app.listen()` — for supertest I need a server: `app.listen(0)`? In e2e with supertest: `const app = await createNestApplication...; await app.init();` then `supertest(app.getHttpAdapter().getInstance())` — I can pass the instance without listening. Simpler: `await app.listen(0)` and use `app.getHttpServer()`? supertest accepts the http server or a url. `supertest(app.getHttpAdapter().getInstance())` works with a plain express app (init only) — yes, supertest will listen on an ephemeral port itself. I'll go with `await app.init()` + supertest(instance).

But wait: two test files, each creates the app, each resets the DB in beforeAll, and vitest serializes files (fileParallelism false) → each file: beforeAll { resetDatabase(); app = await buildApp(); } afterAll { await app.close(); await prisma.$disconnect(); }. But the PrismaService instance inside the app: its $connect → a separate pool; after resetDatabase (my helper's client), the schema is fresh; the app's pool is fine (connection-level, no cached schema). OK.

Also: the helper's `prisma` is a module-level singleton shared across tests in the file ✓.

Hmm — one more: `resetDatabase` drops the schema; the Prisma client's active transactions? None at that point ✓.

**Test 1: read-your-own-writes.spec.ts**

```ts
describe('read-your-own-writes', () => {
  beforeAll: resetDatabase(); app = await buildApp(); seed
  it('an operator sees an approved order on the very next request', async () => {
    const res = await request(app.getHttpServer()).post('/orders').send({ companyId, amountCents: 12000, currency: 'USD', workerId });
    expect(res.status).toBe(201); const orderId = res.body.id;
    // Pending is visible immediately (create was written to the projection in the same tx)
    const page1 = await request(server).get('/operations').query({ companyId, status: 'pending' });
    expect(page1.status).toBe(200);
    expect(page1.body.items).toHaveLength(1);
    expect(page1.body.items[0]).toMatchObject({ orderId, status: 'pending', amountCents: 12000, eventType: 'order_created', workerName: 'Op One' });
    expect(page1.body.totals.pendingAmountCents).toBe('12000');
    // Approve
    const appRes = await request(server).post(`/orders/${orderId}/approve`).send({ workerId });
    expect(appRes.status).toBe(200);
    expect(appRes.body).toMatchObject({ status: 'approved' });
    // The next request reflects it — no delay, no background job
    const page2 = await request(server).get('/operations').query({ companyId, status: 'approved' });
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.items[0]).toMatchObject({ orderId, status: 'approved', eventType: 'order_approved' });
    // The pending list is now empty (status synced across the order's entries)
    const page3 = await request(server).get('/operations').query({ companyId, status: 'pending' });
    expect(page3.body.items).toHaveLength(0);
    expect(page2.body.totals).toMatchObject({ approvedAmountCents: '12000', pendingAmountCents: '0' });
  });
  it('a rejected order is visible as rejected immediately', ...); // maybe combine into one test with two orders to keep it lean. I'll add a second scenario: create+reject.
  it('a rolled-back write leaves no projection row', async () => {
    // Simulate rollback: approve an already-approved order → 409; then verify the projection is unchanged (no ghost event row)
    approve again → 409 envelope { error: { code: 'invalid_order_state' } };
    const page = await get operations → items length unchanged (2 events for that order: created + approved), no extra rows.
  });
```
The rollback test: the failed tx must not leave a projection row — the conditional update fails → tx rolls back → the event insert + hook are rolled back ✓. Assert the entry count for the order == 2 (created+approved) and totals unchanged. This is a true read-your-own-writes complement (the inverse).

**Test 2: concurrent-totals.spec.ts**

```ts
it('two concurrent approvals for one company are both applied exactly once', async () => {
  const { companyId, workerId } = await seedCompanyAndWorker();
  const orderA = await post order amount 1000; const orderB = await post order amount 2500;
  const [r1, r2] = await Promise.all([
    request(server).post(`/orders/${orderA}/approve`).send({ workerId }),
    request(server).post(`/orders/${orderB}/approve`).send({ workerId }),
  ]);
  expect([r1.status, r2.status]).toEqual([200, 200]);
  const page = await get operations for company (all statuses);
  expect(page.body.totals).toMatchObject({ ordersCount: '2'? no—number, approvedAmountCents: '3500', pendingAmountCents: '0' });
  expect(page.body.items).toHaveLength(4); // created+approved ×2
});
it('a burst of concurrent approvals never loses an increment', async () => {
  seed; create 20 orders of 100 each;
  await Promise.all(orders.map(o => approve(o.id)));
  totals.approvedAmountCents === '2000'; pending '0'; ordersCount 20;
});
```
`ordersCount` is Int → JSON number ✓. Amounts are strings (BigInt) ✓.

Note: for a lost-update to be *caught*, the race needs to overlap; with 20 concurrent, if the implementation is read-modify-write, almost certainly overlaps. With atomic increment, always exact. ✓ (The test passes deterministically on the correct impl — that's the key; it's the acceptance criterion itself.)

**Test 3: re-derivation.spec.ts**

```ts
it('re-deriving a window rebuilds the projection to match the source exactly', async () => {
  seed company; 3 workers? 1 worker; create 5 orders; approve 2; reject 1;
  const from = new Date(Date.now() - 3600_000); const to = new Date(Date.now() + 3600_000);
  // Corrupt the projection inside the window (simulate drift)
  await prisma.$executeRaw`UPDATE operation_entries SET order_status = 'REJECTED', amount_cents = amount_cents + 1`;
  await prisma.$executeRaw`UPDATE company_totals SET approved_amount_cents = approved_amount_cents + 999`;
  await maintenanceService.rederiveWindow(from, to);
  // Assert projection == source: recompute expected from source and compare (via a raw query, or via dashboard)
  const page = await get operations; check items match expectations (statuses/amounts), totals exact.
  // Run twice → same result
  const before = await snapshotProjection(from, to); // raw select
  await rederiveWindow again;
  const after = await snapshotProjection(from, to);
  expect(after).toEqual(before);
});
it('is safe while the system is live', async () => {
  seed; create a few orders; kick off rederiveWindow with a window ending in the future; while it's running, concurrently approve an order (an event that lands in the window) — assert final consistency: totals exact, entry present once.
});
```
Hmm, the "live" test: re-derivation is one tx — to interleave, the writer's tx needs to commit during the re-derive tx's execution. The re-derive tx runs fast; the approval tx started before the re-derive commits after → the approval blocks on the FOR UPDATE of the totals (if the company is affected and the re-derive holds the lock) → then applies on top of the exact value → final: exact + 1 approval ✓. But timing: start approval first, then re-derive: the approval's adjustTotals blocks on the re-derive's lock → the approval's tx commits after the re-derive's commit. The approval's event occurredAt ≈ now; the re-derive window [now-1h, now+1h] contains it; the re-derive read the source before the approval's commit → the re-derived entries don't include the approval event, but the approval's hook inserted it after the re-derive's delete (the re-derive's delete ran before the approval's insert? Timeline: A: BEGIN, update order (blocks? no one's locked), insert event, adjustTotals → blocks on re-derive's FOR UPDATE. R: BEGIN, delete (A's rows? A uncommitted → invisible, and the event row is uncommitted anyway), insert re-derived, lock totals (R holds from its own statement), recompute, COMMIT. A: unblocks, commits. A's entry row (created by the hook, committed after R's delete) survives ✓. Final state: entry from A's hook + re-derived others; totals = exact (at R's read time, including A's order as PENDING? R's recompute reads payment_orders: A's update uncommitted at R's read time → the order appears as PENDING in R's exact recompute! Then A commits: its adjustTotals moves pending→approved on top of R's value ✓. Final totals: correct. A's entry row: order_status is set by the hook to APPROVED ✓; but R's re-derivation… R didn't touch A's entry (uncommitted at delete time) ✓. Everything consistent ✓.

But — does A really block on R's FOR UPDATE? R's lock statement runs mid-transaction; A's adjustTotals (an upsert on the same company row) — A may have started before R's lock → A's statement waits for R's commit ✓. To increase the chance of overlap in the test: start the approval (fire-and-forget promise), then immediately call rederiveWindow, await both. The approval tx: first statement is the conditional updateMany on the order row — no conflict with R (R doesn't lock the order row) → A proceeds to adjustTotals → blocks. R finishes. A commits. Deterministic enough (A's block only if R holds the lock at A's arrival; R's lock is held for the rest of its tx, and A started first and is fast… A might complete before R acquires the lock (A's tx: 4 statements, R: 5). If A completes first: R's recompute includes A's approved order → exact value includes it ✓; A's entry is committed before R's delete → R's delete removes it, and R's re-derivation reinserts it with the current status (APPROVED — re-derivation reads o.status = APPROVED ✓ since A committed) ✓. Either interleaving is consistent ✓ — the test asserts the final exact state regardless of timing ✓ robust.

I'll include this live test — it's a spec bullet ("must be safe to run while the system is live").

**Test 4: drift-repair.spec.ts**

```ts
it('finds and repairs drift injected into the projection', async () => {
  seed; create 3 orders (500 each); approve 1 (500);
  // Inject drift (a manual "data fix" gone wrong):
  await prisma.$executeRaw`UPDATE operation_entries SET worker_name = 'Ghost', amount_cents = 1 WHERE occurred_at > ${new Date(Date.now()-1h)}`; // or simpler: all rows for the company
  await prisma.$executeRaw`DELETE FROM operation_entries WHERE company_id = ${companyId}`; // missing rows
  await prisma.$executeRaw`UPDATE company_totals SET orders_count = 999 WHERE company_id = ${companyId}`;
  const job = app.get(DriftRepairJob) — or the MaintenanceService;
  const result = await job.run(); // the scheduled job entry point (the same code cron triggers)
  expect(result.repaired).toBe(true);
  expect(result.entry.missing).toBeGreaterThan(0);
  // Projection now matches source
  const page = await get operations; assert items/totals exact (3 orders, 1 approved 500, 2 pending 1000)
  // A second run: clean
  const second = await job.run();
  expect(second.repaired).toBe(false); expect(second.entry.missing+extra+stale).toBe(0); expect(second.totals).toEqual([]);
});
```
Also drift on entries only (worker_name stale) — covered by the UPDATE. And a totals-only drift. Both in one test + a clean second run.

The job's run() reads lookback from env (default 120 min) — drift is recent (just created) → within the window ✓.

Now — `result.entry` shape: I'll define DriftReport: `{ entries: { missing: number; extra: number; stale: number }, totals: string[] }`.

**Modules:**

app.module:
```ts
@Module({
  imports: [OrdersModule, DashboardModule, MaintenanceModule],
})
export class AppModule {}
```
Where's the ScheduleModule? MaintenanceModule imports ScheduleModule.forRoot() (a feature-local cron). ForRoot per module is allowed (idempotent? forRoot registers a global module; calling forRoot twice = duplicate — call once in MaintenanceModule only ✓).

orders.module:
```ts
@Module({
  imports: [ProjectionModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersRepository, PrismaService],
})
```
Wait — PrismaService: if multiple modules provide it → multiple PrismaClient instances (each module gets its own injection token scope). Multiple PrismaClients = multiple pools — works but wasteful; the tests use their own client. Cleanest: a `PrismaModule` (@Global()) that provides+exports PrismaService, imported by app.module; all modules inject PrismaService. I'll create `src/common/prisma.module.ts` as @Global. That's the standard NestJS pattern. ✓

projection.module:
```ts
@Module({
  providers: [ProjectionService, ProjectionRepository],
  exports: [ProjectionService],
})
export class ProjectionModule {}
```
(No controller — fine, a module with only providers ✓.)

dashboard.module: providers DashboardService, DashboardRepository; controller DashboardController.
maintenance.module: imports ScheduleModule.forRoot(); providers MaintenanceService, MaintenanceRepository, DriftRepairJob.

**Controllers:**

orders.controller:
```ts
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}
  @Post()
  create(@Body() dto: CreateOrderDto) { return this.orders.create(dto); }
  @Post(':id/approve')
  approve(@Param('id') id: string, @Body() dto: TransitionOrderDto) { return this.orders.approve({ orderId: id, ...dto }); }
  @Post(':id/reject') ...
}
```
`@Param('id')` — the UUID format isn't validated here (a non-UUID → 404 from the DB). Fine; or `@Param('id', ParseUUIDPipe)`? ParseUUIDPipe throws a BadRequest (400 invalid_request) for malformed UUIDs — nicer. Use it ✓ (controller validation is allowed).

dashboard.controller:
```ts
@Controller('operations')
export class DashboardController {
  @Get()
  list(@Query() dto: ListOperationsQueryDto) { return this.dashboard.listOperations(dto); }
}
```
With the global ValidationPipe (whitelist, transform: true) → query string → typed DTO ✓.

**ValidationPipe options**: `transform: true` (for the query DTO), `whitelist: true`, and `forbidNonWhitelisted`? Just whitelist. transformOptions enableImplicitConversion? I'll declare numeric fields as @Type(() => Number) — class-transformer. page/pageSize: `@Type(() => Number) @IsInt() @Min(1)`. ✓

**main.ts**:
```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.listen(Number(process.env.PORT ?? 3000));
}
bootstrap();
```

**Error filter** details:

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainError } from './errors';

const STATUS_TO_CODE: Record<number, string> = {
  400: 'invalid_request', 401: 'unauthorized', 403: 'forbidden', 404: 'resource_not_found',
  409: 'conflict', 422: 'invalid_request',
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal_error';
    let message = 'An unexpected error occurred';
    let details: Record<string, unknown> = {};
    if (exception instanceof DomainError) {
      status = exception.status; code = exception.code; message = exception.message; details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'string') message = payload;
      else { const p = payload as Record<string, unknown>; message = (typeof p.message === 'string' ? p.message : Array.isArray(p.message) ? (p.message as string[]).join('; ') : message); if (typeof p.code === 'string') code = p.code; if (p.details && typeof p.details === 'object') details = p.details as Record<string, unknown>; if (Array.isArray(p.message)) details = { issues: p.message }; }
    } else if (exception instanceof Error) { message = 'An unexpected error occurred'; } // keep 500 generic; don't leak
    response.status(status).json({ error: { code, message, details } });
  }
}
```
Validation: a BadRequestException from ValidationPipe has payload { statusCode:400, message: string[], error: 'Bad Request' } → code via STATUS_TO_CODE[400] = 'invalid_request' ✓ details { issues: [...] } ✓ message joined ✓.

DomainError hierarchy:
```ts
export class DomainError extends Error {
  constructor(readonly code: string, message: string, readonly status: number, readonly details: Record<string, unknown> = {}) { super(message); }
}
export class ResourceNotFoundError extends DomainError { constructor(resource: string, id: string) { super('resource_not_found', `${resource} ${id} was not found`, 404, { resource, id }); } }
export class InvalidOrderStateError extends DomainError { constructor(orderId, current, expected) { super('invalid_order_state', `order ${orderId} is ${current}, expected ${expected} for this action`, 409, { orderId, currentStatus: current, expectedStatus: expected }); } }
export class ForbiddenActionError extends DomainError { constructor(message, details={}) { super('forbidden', message, 403, details); } }
```

**Prisma service**:
```ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}
```

**vitest.config.ts**:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
```

**tsconfig.json**:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "useDefineForClassFields": false,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "test", "vitest.config.ts"]
}
```
`useDefineForClassFields: false` — important for NestJS DI + decorators (avoids the define semantics that breaks injection metadata). ✓ emitDecoratorMetadata for the DI types.

**package.json**:
```json
{
  "name": "marketplace-backoffice",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "start": "tsx src/main.ts",
    "prisma:migrate": "prisma migrate deploy",
    "prisma:generate": "prisma generate",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.0",
    "@nestjs/core": "^10.4.0",
    "@nestjs/platform-express": "^10.4.0",
    "@nestjs/schedule": "^4.1.0",
    "@prisma/client": "^5.19.0",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.0",
    "prisma": "^5.19.0",
    "supertest": "^7.0.0",
    "@types/supertest": "^6.0.2",
    "tsx": "^4.19.0",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```
Nest 10 + Node 20 fine. @nestjs/schedule v4 requires Nest ≥10 ✓.

Now — **important check**: Prisma + tagged-template raw inside a transaction: `tx.$executeRaw\`...\`` ✓ supported in Prisma 5.

Another check — `ORDER BY occurred_at DESC, id DESC` against the index `(company_id, order_status, occurred_at DESC, id DESC)`: the Prisma orderBy `[{occurredAt:'desc'},{id:'desc'}]` generates `ORDER BY "occurred_at" DESC, "id" DESC` ✓ matches the index direction exactly ✓ index-only via INCLUDE ✓.

When the `status` filter is omitted (all statuses): the index's second column is order_status — a query with only company_id + range on occurred_at can't use the index efficiently (needs to merge two status ranges… actually a btree scan with company_id prefix: (company_id=X, order_status=?, occurred_at) — with no status predicate, Postgres scans all status subtrees for company X — the sort is by (order_status, occurred_at), not occurred_at alone → the sort order isn't usable → Postgres will do a full index scan + sort, or a seq scan. Hmm. Is the "no status" case a hot path? The spec: "filter by company, status, date range" — all three filters are the pattern. The covering index "matches the filter and the sort" — with all three predicates. To be safe for status-less queries: add a second index `(company_id, occurred_at DESC, id DESC) INCLUDE (...)`? Doubles the index + write cost. Alternative: the hot-path assumption is status is always provided (operators filter by status — the spec lists it as part of the filter set). I'll note in DESIGN.md: the covering index assumes the dashboard always sends a status (it's part of the contract); the fallback is still a company-scoped scan. Keep the single index. Also, a `company_id`-leading partial index for each status? Overkill. One covering index + a note. Hmm, but if someone queries without a status: index-only scan of all of company X's rows + top-N sort — for a large company (3M total, one company might have 1M) that's slowish but not the contracted pattern. Acceptable + documented. Actually — should I make status required in the DTO? "Filter by company, status, date range" — the dashboard filters by all of them. Making status required simplifies the index story (always full index match) and matches "same filters." I'll make `status` required (one of pending/approved/rejected). ✓ Decision: required. (The "see their own writes" test uses the status filter ✓.)

Wait, but the concurrent-totals test queries without a status to see all 4 entries? I'll query with a status or loop. I'll query per-status, or… totals come regardless (the totals are company-level, independent of the filter). The items assert via a per-status query. Fine — or allow an optional status and just have the tests use it. I'll make it required (contract = the actual access pattern, index always optimal).

Hmm, one consideration: "no change in what operators see" — the original query could filter by any combination; my new contract makes status required. Since I'm defining the system fresh (no existing code), the contract = my DTO. I'll state the access pattern in DESIGN.md. OK.

Date range: from/to optional (a dashboard shows the last N days by default? The original filters by date range — required? I'll keep optional: omit → no bound (all time). The covering index still matches (range on occurred_at with an open bound ✓).

**Now re-check the "zero raw SQL, zero Prisma client calls" for the service**:
- OrdersService: only calls ordersRepo ✓ (the transition constants are data, fine).
- DashboardService: repo ✓.
- MaintenanceService: repo + Logger ✓.
- ProjectionService: repo ✓ (takes a tx param passed from the repo — fine, doesn't call Prisma itself).
- DriftRepairJob: service ✓.
Repositories: PrismaService only ✓.

**Controller zero business logic**: only DTO binding + delegating ✓ (ParseUUIDPipe is validation ✓).

**Naming conventions**: files kebab-case.role.ts ✓ (drift-repair.job.ts is the role "job" — acceptable; the layout template lists module/controller/service/repository as standard roles; the job is the requested deliverable "scheduled drift repair job" → the file is justified). Tables snake_case via @@map ✓ columns via @map ✓. Endpoints kebab-case plural: /orders, /operations ✓ (nested /orders/:id/approve — a singular action subroute; the "plural" rule applies to collection endpoints; fine).

**DESIGN.md** content (short but complete):
- Problem and target.
- The read model: two tables; why entry-level (one row per event) — matches the join shape; denormalized worker name and order status.
- Status semantics: entries carry the order's *current* status (synced on transition) → status filter = "currently approved operations."
- Maintenance: hooks inside the write tx (why: read-your-own-writes). Rejected alternatives: triggers (opaque, hard to test, but same-transaction — I'll discuss: Postgres triggers *could* satisfy same-tx; rejected for language fragmentation, testability, and because the business mapping (which totals to move) belongs in app code with types; also triggers are hard to evolve/migrate alongside the service), async queues/outbox (a visibility window → violates), scheduled refresh (a window → violates), materialized views (REFRESH is a window + locks, can't be row-locked per write → violates), CDC/logical replication (a window + extra infra → violates), caching in the app (no exactness/consistency, memory).
- Exactness: single-statement upsert-with-increment (no read-modify-write); the recompute is absolute SET after FOR UPDATE.
- Idempotency: entry upsert on event id; re-derivation = delete+rebuild → idempotent.
- Re-derivation & drift repair: the window, the live safety argument (the serialization point = the FOR UPDATE on totals; the delete+insert interleaving argument), the rolling overlap.
- Indexes: the covering index matches (company, status, occurred_at DESC) + INCLUDE; why hand-managed (Prisma has no INCLUDE); no FKs on the projection (write-path cost, repairable).
- Performance argument: the old join (3M rows, hash join + sort per page) vs an index-only top-N scan (page-sized).
- Known limits / tradeoffs: status is required; the drift window is bounded by the lookback (deeper drift → manual re-derivation); BigInt as a string in JSON.

Keep it "short" — ~60–90 lines.

Now, let me mentally write all the code, checking types.

Prisma client types: `Prisma.TransactionClient` — I'll import type { Prisma } from '@prisma/client'.

ProjectionRepository method param types: I'll define an interface in the projection module (maybe `projection.types.ts`? or inside the service file and imported by the repo… the repo is imported by the service; if the repo imports the type from the service file, that's a cycle? Type-only import = no runtime cycle, TS is fine. Cleaner: put the shared types in `src/projection/projection.types.ts`. Hmm, "don't create files that aren't called for" — a types file is a normal part of the feature. I'll inline the types in each file to minimize files? The row shape for the entry is used by the service (builds it) and the repo (consumes it). I'll define `OperationEntryRow` + `TotalsDelta` in `projection.repository.ts` and the service imports the types from the repository (type-only, no cycle at runtime; at module-graph level service→repo already exists ✓ no cycle). ✓

Event/Order/Worker row types: Prisma model types (`PaymentOrder`, `Event`, `Worker` from '@prisma/client'). The hook payload: `{ order: PaymentOrder; event: Event; worker: Worker }`. ✓ (The repo passes the rows it created/fetched.)

Wait — in `transitionOrder`, I read the order *after* the update (status = to). The hook needs `from` (for the totals delta) — pass it explicitly from the argument ✓. The event row: created with occurredAt. Worker: fetched. So the payload is assembled in the repo ✓.

`onOrderCreated`: order (PENDING), event ORDER_CREATED, worker.

Totals delta: created: { ordersCount: +1, [status]: +amount }. Changed: { ordersCount: 0, [from]: -amount, [to]: +amount }.

Now the DTOs:

```ts
// src/orders/dto.ts
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';

export class CreateOrderDto {
  @IsUUID() companyId!: string;
  @IsInt() @Min(1) amountCents!: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsUUID() workerId!: string;
}

export class TransitionOrderDto {
  @IsUUID() workerId!: string;
}
```

```ts
// src/dashboard/dto.ts? or inside the controller file. I'll put the query DTO in src/dashboard/operations-query.dto.ts? Naming: kebab-case files — `operations-query.dto.ts`. Hmm the layout says `<feature>.controller.ts` etc. — a dto file is an addition; fine (the orders dto already is). I'll keep `src/orders/dto.ts` and `src/dashboard/dto.ts`.
```

```ts
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsUUID, Max, Min } from 'class-validator';

export const OPERATIONS_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type OperationsStatusToken = (typeof OPERATIONS_STATUSES)[number];

export class ListOperationsQueryDto {
  @IsUUID() companyId!: string;
  @IsIn(OPERATIONS_STATUSES) status!: OperationsStatusToken;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}
```

DashboardService mapping: token→enum: `const TOKEN_TO_STATUS: Record<OperationsStatusToken, OrderStatus> = { pending: OrderStatus.PENDING, ... }`; enum→token for the response: a reverse map.

Response item shape:
```ts
{ id, orderId, status: 'approved', eventType: 'order_approved', workerId, workerName, amountCents, occurredAt: ISO }
```
eventType token: ORDER_APPROVED → 'order_approved' (snake token — consistency with the status tokens; it's the contract, fine).

Totals response: `{ ordersCount: number, pendingAmountCents: string, approvedAmountCents: string, rejectedAmountCents: string }` (BigInt→string, exact). If no totals row → zeros: `{ ordersCount: 0, ...'0' }`.

Now the OrdersController response: create → 201 with `@HttpCode(201)`? Default for POST = 201 ✓ Nest's default is 201 for POST ✓. Body: `{ id, status: 'pending', companyId, amountCents }`. Transition → 200 `@HttpCode(200)` + `{ id, status, companyId, amountCents }`.

The repo returns domain rows; the service shapes the API response (lowercase status).

Let me write OrdersService:

```ts
const TRANSITIONS = {
  approve: { from: OrderStatus.PENDING, to: OrderStatus.APPROVED, eventType: EventType.ORDER_APPROVED, token: 'approved' as const },
  reject: { from: OrderStatus.PENDING, to: OrderStatus.REJECTED, eventType: EventType.ORDER_REJECTED, token: 'rejected' as const },
} as const;
```
Hmm 'approved' as const — a token type; I'll keep `token: string`? I'll type the return as `{ id: string; status: 'pending'|'approved'|'rejected'; companyId: string; amountCents: number }`. Use a shared type `OrderStatusToken`. Define in common? The dashboard DTO defines OperationsStatusToken; the orders service needs the same. Put the token type + map in `src/common/order-status.ts`:

```ts
import { OrderStatus } from '@prisma/client';
export type OrderStatusToken = 'pending' | 'approved' | 'rejected';
export const TOKEN_TO_STATUS: Record<OrderStatusToken, OrderStatus> = {...};
export const STATUS_TO_TOKEN: Record<OrderStatus, OrderStatusToken> = {...};
```
And the dashboard DTO's `@IsIn(['pending','approved','rejected'])`. ✓ (A small common file, justified.)

EventType tokens for the response: `order_created` etc.:
```ts
// in common/event-type.ts? or in the dashboard service. I'll add to common/order-status.ts? no — a separate concern; I'll put a map in the dashboard service file (display mapping = presentation logic, service-side OK).
```
Actually the eventType token mapping: `EVENT_TYPE_TO_TOKEN: Record<EventType, string> = { ORDER_CREATED: 'order_created', ... }` inside the dashboard service file ✓.

Now — MaintenanceService API:

```ts
@Injectable()
export class MaintenanceService {
  constructor(private readonly repo: MaintenanceRepository, private readonly logger: Logger = new Logger(MaintenanceService.name)) {}
```
DI for Logger: the @nestjs/common Logger is injectable (provide Logger) — `constructor(private readonly repo: MaintenanceRepository, @Inject(Logger) private readonly logger: Logger)`? Simpler: `private readonly logger = new Logger(MaintenanceService.name)` (no DI) ✓.

```ts
  rederiveWindow(from: Date, to: Date) { return this.repo.rederiveWindow(from, to); }

  async repairDrift(lookbackMs: number) {
    const to = new Date();
    const from = new Date(to.getTime() - lookbackMs);
    const drift = await this.repo.detectDrift(from, to);
    const entryDriftCount = drift.entries.missing + drift.entries.extra + drift.entries.stale;
    const repaired = entryDriftCount > 0 || drift.totals.length > 0;
    let rebuiltEntries = 0;
    if (repaired) {
      const result = await this.repo.rederiveWindow(from, to);
      rebuiltEntries = result.entriesReinserted;
    }
    this.logger.log(`drift repair window=[${from.toISOString()}, ${to.toISOString()}] entries=${JSON.stringify(drift.entries)} totals=${drift.totals.length} repaired=${repaired} rebuiltEntries=${rebuiltEntries}`);
    return { from, to, ...drift, repaired, rebuiltEntries };
  }
```

DriftRepairJob:
```ts
import { Cron, CronExpression } from '@nestjs/schedule';
const DEFAULT_LOOKBACK_MINUTES = 120;
@Injectable()
export class DriftRepairJob {
  constructor(private readonly maintenance: MaintenanceService) {}
  @Cron(CronExpression.EVERY_5_MINUTES)
  async run() {
    const lookbackMinutes = Number(process.env.DRIFT_REPAIR_LOOKBACK_MINUTES ?? DEFAULT_LOOKBACK_MINUTES);
    return this.maintenance.repairDrift(lookbackMinutes * 60_000);
  }
}
```

MaintenanceRepository.detectDrift returns `{ entries: { missing: number; extra: number; stale: number }, totals: string[] }`.

Now — let me check the SQL for the detectDrift tuple comparison with the enum: `(p.order_status, ...) <> (s.status, ...)` — p.order_status is the "OrderStatus" enum type, s.status is also "OrderStatus" ✓ same type. worker_name text, event_type enum vs type enum ✓, occurred_at both timestamptz ✓. count(*)::bigint → in pg, `count(*)::bigint` — the cast binds to count(*) ✓.

`$queryRawUnsafe` with a parameterized $1/$2 + [from, to] ✓.

The entries kind: I group by CASE → rows like { kind: 'missing', count: 3n }. Map to the object. If no drift → zero rows → default zeros ✓.

Now the re-derive INSERT ... SELECT with enum columns: e.type is the EventType enum → into event_type ✓; o.status → order_status ✓.

One catch: the re-derive DELETE uses occurred_at range; the lookup index (company leading) is useless → I use operation_entries_occurred_at_idx ✓ present.

Another catch: re-derive `FOR UPDATE` on company_totals rows — but the INSERT (create if missing) runs after the lock; a concurrent writer's upsert on a *missing* row: both try to insert → the second blocks on the first's tuple uniqueness (an ON CONFLICT DO UPDATE would wait on the in-flight insert) → then the writer's update part applies… if the writer's tx commits before my re-derive's recompute reads: my recompute includes its order's final state ✓ (its totals effect = subsumed by the exact value? My recompute SETs the exact aggregate that includes the committed order ✓; the writer's increment was already in the row; the SET overwrites with the exact value ✓ no double count). If the writer commits after my recompute: the writer's upsert blocks (my lock), then applies the increment on the exact value ✓. ✓ consistent in both orders.

But wait: the INSERT ... ON CONFLICT DO NOTHING for the missing row — if a concurrent writer is inserting the same row (uncommitted): my INSERT blocks on their pending tuple → if they later commit, my INSERT does nothing (conflict → DO NOTHING) ✓; if they roll back, my insert proceeds ✓. Then my UPDATE (recompute) — their commit already included? My snapshot: READ COMMITTED, per-statement: my UPDATE's FROM subquery sees commits up to its statement start → if the writer committed before my recompute statement → included ✓. If after → my SET doesn't include it, but they increment after me ✓.

Edge: a company with events in the window but no payment_orders rows at all (impossible — events reference orders) ✓.

Now — the `affected` for the lock uses the join of events→orders: an event whose order was deleted? No deletes in the app (RESTRICT FK) ✓.

**Test: snapshot of the projection for idempotency**:
```ts
async function snapshotProjection(): Promise<unknown[]> {
  const entries = await prisma.$queryRawUnsafe(`SELECT id, order_id, company_id, order_status, worker_id, worker_name, amount_cents, event_type, occurred_at FROM operation_entries ORDER BY id`);
  const totals = await prisma.$queryRawUnsafe(`SELECT * FROM company_totals ORDER BY company_id`);
  return [entries, totals];
}
```
Comparing two arrays of objects (BigInts → JSON? $queryRaw returns bigint as JS bigint? Prisma returns BigInt for BIGINT columns in raw queries ✓; toEqual with bigint works ✓; enum → string ✓). I'll compare with toEqual after normalizing to JSON? `expect(after).toEqual(before)` — deep equality on arrays/objects with bigint is fine in vitest ✓.

**Rollback test detail**: approve an already-approved order: updateMany where status=PENDING → count 0 → findUnique → status APPROVED → InvalidOrderStateError (409, code invalid_order_state) → tx rolls back → no second event row, no entry change. Assert: response 409 + envelope; operations list for the order: still exactly 2 entries (created + approved); totals unchanged.

Also a 404 test: approve an unknown order → 404 resource_not_found envelope ✓ (assert the envelope shape — good to assert the contract in one place).

**Now the "same columns as the original" concern** — no original; I'll define. Fine.

**Supertest import**: `import request from 'supertest';` with esModuleInterop ✓. `app.getHttpServer()` returns an http.Server (after init? getHttpServer is available after init ✓ — createNestApplication creates the http server on init? Actually `app.init()` initializes the module + the http server is created on listen… hmm: in Nest, `app.init()` initializes; the http server is lazily created on `listen()`. `app.getHttpServer()` before listen → throws? Let me recall: NestApplication.getHttpServer() returns this.httpServer, which is set in listen()… actually no: createNestApplication → `createHttpServer` is called during `init()`? Let me think — in the Nest source (v10): `NestApplication.init()` → `await this.httpAdapter.initServer(...)`? The http adapter's init (createServer) happens in `NestApplication.listen()` → `await this.httpAdapter.initHttpServer...`. Hmm, I recall e2e tests commonly do: `await app.init(); const server = app.getHttpServer();` — and it works, because `createNestApplication` calls `createNestApplicationContext`… Let me be safe: use `await app.listen(0)` and `app.getHttpServer()` — definitely available. listen(0) = ephemeral port; close in afterAll ✓. I'll use listen(0).

Actually the Nest docs e2e: `await app.init(); await supertest(app.getHttpServer())` — the docs example uses `app.init()` and getHttpServer… In the Nest docs (first steps e2e):
```ts
await app.init();
...
await request(app.getHttpServer()).get('/').expect(200);
```
Yes, that's the documented pattern — so getHttpServer works after init (the http server instance is created during the app's construction via createNestApplication → createHttpServer is eager). I'll trust the docs: `await app.init()` + supertest(getHttpServer()). But then close: `await app.close()` ✓.

Hmm, but I'm not 100% sure that getHttpServer is non-null after init without listen. The docs literally show that pattern (the "first steps" e2e test). OK ✓.

**Vitest + Nest decorators**: esbuild transforms decorators (experimental) — does Vitest read tsconfig? esbuild reads tsconfig for `experimentalDecorators`? Vitest/esbuild: since ~0.31 it supports `esbuild.tsconfigRaw`? By default, esbuild honors `experimentalDecorators` from tsconfig? esbuild has supported reading tsconfig.json since 0.16 for some options (target, decorators?). esbuild supports `experimentalDecorators` and `emitDecoratorMetadata`? esbuild does *not* support emitDecoratorMetadata! That's the killer for NestJS DI with implicit types. But: NestJS DI works without decorator metadata if every constructor dependency has an explicit `@Inject()`? No wait — Nest resolves dependencies via `design:paramtypes` (reflect-metadata) set by TS's emitDecoratorMetadata. Without it, paramtypes = undefined → Nest can't resolve a concrete class → throws "Nest can't resolve dependencies."

Hmm! But — does esbuild actually emit design:paramtypes? esbuild docs: "esbuild does not support emitDecoratorMetadata" — correct, it doesn't. So how do people run NestJS with Vitest? Options:
1. Use `@swc/core` with Vitest (`@vitest/plugin-swc` or `swc` in the esbuild config? swc supports emitDecoratorMetadata ✓). `unplugin-swc` or `@vitest/plugin-swc` in the Vitest config → decorators with metadata ✓.
2. Explicit `@Inject()` everywhere (annoying but works without metadata) — but with `useDefineForClassFields` issues too… actually with @Inject() and explicit tokens, DI works without paramtypes. But I'd have to annotate every constructor param — acceptable? It's ugly and error-prone.
3. `ts-jest`-style via `vite-tsconfig-paths`? No.
4. Use Vitest with a SWC transform: `@vitest/plugin-swc` (official) — I'll set it up.

I'll go with `@vitest/plugin-swc` (Vitest 2: `import swc from '@vitest/plugin-swc'; plugins: [swc()]`). SWC's config: `jsc: { transform: { decoratorMetadata: true, legacyDecorators: true } }`. `@vitest/plugin-swc` by default uses `@swc/core` with defaults that honor tsconfig? The plugin's README: "By default it uses swc to transform the code … decorator metadata?" Let me recall the plugin's API:

```ts
import swc from '@vitest/plugin-swc';
export default defineConfig({
  plugins: [swc()],
});
```
The plugin reads tsconfig? It has options like `swc?: SwcOptions`. Does the default enable `legacyDecorators` and `decoratorMetadata`? I believe the plugin sets `jsc: { parser: { syntax: 'typescript', tsx: false, decorators: true }, transform: { legacyDecorators: true, decoratorMetadata: true } }` by default? Not 100% sure about decoratorMetadata by default. To be safe, I'll pass an explicit config:

```ts
swc({
  swc: {
    jsc: {
      parser: { syntax: 'typescript', decorators: true },
      transform: { legacyDecorators: true, decoratorMetadata: true },
    },
  },
})
```
Hmm — the plugin option shape: `swc(options?: SwcPluginOptions)`, with `SwcPluginOptions = { swc?: SwcOptions; include?; exclude?; ... }` where SwcOptions = @swc/core's TransformOptions. And `@swc/core` is a peer (does the plugin bundle it? The plugin requires @swc/core as a dependency — it's a dependency of the plugin, I think). I'll add `@vitest/plugin-swc` to devDeps.

Alternatively — avoid the whole problem: don't rely on paramtypes. I can write explicit `@Inject()` for every constructor dependency. With a fixed, small number of dependencies, that's reliable across transform pipelines (esbuild/Vitest without swc, tsc, node via tsx — tsx uses esbuild too! So `pnpm start` via tsx would have the same metadata problem!). So either I commit to swc for both (tsx → swc-node? tsx can't use swc). Hmm.

Cleanest and universal: **explicit `@Inject()` tokens everywhere** → DI works with esbuild, swc, or tsc. Then I can drop emitDecoratorMetadata from tsconfig? I'll keep the decorators on (experimentalDecorators still needed for @Inject/@Controller etc. — esbuild supports legacy decorators with a tsconfig flag ✓ esbuild reads `experimentalDecorators` from tsconfig.json ✓ (esbuild supports reading the tsconfig experimentalDecorators option ✓)).

Wait — does esbuild honor experimentalDecorators from tsconfig? Yes — esbuild has long supported `experimentalDecorators` (via tsconfig or --tsconfig-raw). It transforms to the __decorate helper. And class-validator decorators (property decorators) also work with esbuild ✓ (many people run class-validator under esbuild/Vitest without swc ✓). The only esbuild gap is emitDecoratorMetadata → hence explicit @Inject everywhere solves it.

Decision: **explicit `@Inject(TOKEN)` on every constructor parameter** + tsconfig with experimentalDecorators (no emitDecoratorMetadata needed; I'll leave it out to avoid confusion). Then Vitest works with plain esbuild (no swc dep). And `tsx` runtime works too.

Let me double-check Nest with explicit @Inject: `constructor(@Inject(OrdersRepository) private readonly ordersRepo: OrdersRepository)` — token = the class itself → resolved from the module providers ✓. This is a documented Nest pattern ✓. PrismaService from a global module ✓.

For ValidationPipe on body/query with class-validator: property decorators via esbuild ✓ works.

`useDefineForClassFields`: with esbuild + legacy decorators, the class fields with `!` declaration… `private readonly x!: T` — with declare modifiers, no runtime field is emitted ✓. But `private readonly logger = new Logger(...)` emits an assignment — with useDefineForClassFields true (ES2022 target default), the field defines after the constructor super — for a DI param (no initializer), fine. For the logger field: the `Object.defineProperty` semantics after the constructor — fine. But the classic pitfall: useDefineForClassFields=true + decorator-transformed class + a field with an initializer referencing `this` — avoid. The logger field: the `useDefineForClassFields: false`? To be safe: avoid instance field initializers that use `this`… `new Logger(...)` doesn't use this ✓. I'll set `"useDefineForClassFields": false` anyway (the classic NestJS tsconfig does; with esbuild, the target determines it — esbuild honors useDefineForClassFields from tsconfig ✓). Set to false.

DTO classes: `companyId!: string;` — a declare-style with `!` (definite assignment) → under useDefineForClassFields false + TS: `!` without initializer = no emit (a type-only declaration)? Under legacy semantics, a property declaration without an initializer emits nothing (no define) ✓ — class-validator reads the metadata ✓, and ValidationPipe assigns the transformed value to `dto.companyId` via Object.assign on the instance — wait: with no field definition, does the assignment create an own property? `transform: true` → the pipe does `classToInstance`/plainToInstance → creates a new class instance and assigns the properties → own properties exist ✓. Without transform, the body object is used as-is ✓. Fine.

Hmm — one more esbuild subtlety: `@IsUUID() companyId!: string;` — esbuild legacy decorators on a class field ✓ standard.

**Prisma client generation**: the repo's code imports `@prisma/client` — the generated client must exist before tests run. I'll document in package.json: the test script should run `prisma generate` first: `"test": "prisma generate && vitest run"`. ✓ And `postinstall: prisma generate`? I'll keep an explicit script; note in DESIGN? Add `postinstall` — standard. I'll include `"postinstall": "prisma generate"` (harmless, standard Prisma practice).

The test setup also needs the DB migrated — my resetDatabase handles the schema (reads the migration file) ✓ no external migration step needed in tests. For a real deployment: `pnpm prisma:migrate` + `pnpm start`. ✓

**The Prisma client and ESM**: `@prisma/client`'s generated code — with `"type": "module"`, Prisma 5's generated client supports ESM imports ✓ (imports from '@prisma/client' work under Vitest/tsx ✓).

**The BigInt in the JSON response**: the DashboardService converts ✓ (the repo returns a Prisma row with BigInt → the service maps to a string). The repo returns a Prisma row with BigInt fields; the service maps to a string. The tests assert a string ✓.

**Currency**: the amount_cents Int + a currency column — totals assume a single currency per company (USD default). I'll note in DESIGN: totals are per (company) and assume a single currency per company (marketplace is single-currency; the currency column is preserved on orders for the future). Actually — to keep "exact" clean, the dashboard shows totals in cents as-is; fine.

Now — the `events` table: do I need an index on order_id? The app never queries events directly by order (the projection handles reads; the re-derive joins by e.order_id = o.id — the join direction: re-derive iterates events (window) → nested-loop to orders by PK ✓; the index on events.order_id is unused… I'll drop it? It's cheap; but discipline: don't add what I don't use. Drop events_order_id_idx. Keep events_occurred_at_idx (re-derive, drift detection). The payment_orders index (company_id, status, amount_cents): used by the recompute aggregate (`WHERE company_id IN (...) GROUP BY company_id` + FILTER sum — the index on (company_id, status, amount_cents) enables an index-only grouped aggregate per company ✓ good). workers_company_id_idx: used by the validation lookup? The worker lookup is by PK; the company check uses the worker row ✓. The index on workers.company_id is unused… but a FK → Postgres needs an index for the FK's ON DELETE? RESTRICT/NO ACTION: the index isn't strictly needed (only for fast FK checks on the child update/delete… a FK check queries the parent by PK; the index on the child column is for the reverse / cascade speed). Keep it minimal: drop? I'll keep `workers_company_id_idx` — hmm, discipline says no unused. But FKs: I add FKs events→orders/workers, orders→companies, workers→companies. The FK index isn't needed for correctness. Let me drop workers_company_id_idx and keep the schema lean… actually wait: one real use — none. Drop. Hmm, but a `@@index` in the schema vs a hand-written migration — I'm hand-writing the migration, so the Prisma schema's `@@index` entries only affect future migrate diffs. I'll keep the schema indexes minimal = only what's in the migration (to avoid drift confusion): events(occurredAt), payment_orders(companyId, status, amountCents), operation_entries(occurredAt). And the covering index: hand-written in the migration only (not in the schema — Prisma can't express INCLUDE; a future `migrate dev` would diff… I'll note in a comment in the schema). A compromise: include the Prisma-expressible parts of the covering index in the schema? If the schema has `@@index([companyId, orderStatus, occurredAt(sort: Desc), id(sort: Desc)])` and the migration has the INCLUDE version — the names collide / drift. No — keep the schema clean, document. Actually, hmm: let me reconsider — I'll put *all* the base indexes in the schema (so the Prisma migration could regenerate them), and the covering one only in the migration SQL with a comment. The migration file is the source of truth I ship; the schema is in sync for the non-covering ones. Fine.

The schema also needs the FK relations (Prisma models with relations) — the schema's relations generate the FKs in the migration ✓ matching my SQL.

Let me write schema.prisma concretely:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum OrderStatus {
  PENDING
  APPROVED
  REJECTED
}

enum EventType {
  ORDER_CREATED
  ORDER_APPROVED
  ORDER_REJECTED
}

model Company {
  id        String   @id @default(uuid()) @map("id")
  name      String   @map("name")
  createdAt DateTime @default(now()) @map("created_at")

  orders PaymentOrder[]
  events Event[]
  workers Worker[]
  totals CompanyTotals?

  @@map("companies")
}
```
Wait — CompanyTotals is a projection table; I'll declare the relation? If I declare the relation, Prisma generates the FK in the migration → I said no FK on the projection. So: no Prisma relation for CompanyTotals/OperationEntry — standalone models with plain fields (no relation attributes). ✓ Then Company has only orders/events/workers relations. And CompanyTotals:

```prisma
// Read model (projection). Intentionally no FKs and no relations:
// it is rebuilt from the source by re-derivation, and the write path stays lean.
// The covering index `operation_entries_lookup_idx` (with INCLUDE columns) is
// defined in prisma/migrations/.../migration.sql because Prisma cannot express
// non-key (INCLUDE) index columns.
model OperationEntry {
  id          String      @id @map("id")
  orderId     String      @map("order_id")
  companyId   String      @map("company_id")
  orderStatus OrderStatus @map("order_status")
  workerId    String      @map("worker_id")
  workerName  String      @map("worker_name")
  amountCents Int         @map("amount_cents")
  eventType   EventType   @map("event_type")
  occurredAt  DateTime    @map("occurred_at")

  @@index([occurredAt], map: "operation_entries_occurred_at_idx")
  @@map("operation_entries")
}

model CompanyTotals {
  companyId           String   @id @map("company_id")
  ordersCount         Int      @default(0) @map("orders_count")
  pendingAmountCents  BigInt   @default(0) @map("pending_amount_cents")
  approvedAmountCents BigInt   @default(0) @map("approved_amount_cents")
  rejectedAmountCents BigInt   @default(0) @map("rejected_amount_cents")
  updatedAt           DateTime @default(now()) @map("updated_at")

  @@map("company_totals")
}
```

`@default(uuid())` — Prisma's `uuid()` default: in SQL: `DEFAULT gen_random_uuid()` (Prisma 5 uses gen_random_uuid() for @default(uuid()) on Postgres) — my hand-written migration must match: `DEFAULT gen_random_uuid()`. But I never insert ids via default in the app (I always generate them myself, or omit → I omit ids in create and rely on the default). In the migration: `"id" TEXT NOT NULL DEFAULT gen_random_uuid()`. Prisma 5.19: yes, it generates `gen_random_uuid()` (pgcrypto is bundled in PG13+ ✓). ✓ I'll use that.

Hmm wait — do I omit id in the Prisma create? Yes: `tx.paymentOrder.create({ data: { ... } })` without id → default ✓.

Source models:

```prisma
model Worker {
  id        String  @id @default(uuid()) @map("id")
  name      String  @map("name")
  companyId String  @map("company_id")
  company   Company @relation(fields: [companyId], references: [id])
  events    Event[]

  @@map("workers")
}

model PaymentOrder {
  id          String      @id @default(uuid()) @map("id")
  companyId   String      @map("company_id")
  company     Company     @relation(fields: [companyId], references: [id])
  amountCents Int         @map("amount_cents")
  currency    String      @default("USD") @map("currency")
  status      OrderStatus @default(PENDING) @map("status")
  createdAt   DateTime    @default(now()) @map("created_at")
  updatedAt   DateTime    @updatedAt @map("updated_at")
  events      Event[]

  @@index([companyId, status, amountCents], map: "payment_orders_company_status_amount_idx")
  @@map("payment_orders")
}

model Event {
  id         String      @id @default(uuid()) @map("id")
  orderId    String      @map("order_id")
  order      PaymentOrder @relation(fields: [orderId], references: [id])
  workerId   String      @map("worker_id")
  worker     Worker      @relation(fields: [workerId], references: [id])
  type       EventType   @map("type")
  occurredAt DateTime    @map("occurred_at")

  @@index([occurredAt], map: "events_occurred_at_idx")
  @@map("events")
}
```

The hand-written migration must generate the FK constraints with the names Prisma uses: `workers_company_id_fkey` etc. — I'll name them that way in my SQL ✓ (it matters if a future prisma migrate diff runs; consistency).

payment_orders `updatedAt @updatedAt` → DDL: `"updated_at" TIMESTAMP(3) NOT NULL` (Prisma emits no default for @updatedAt? Prisma emits `"updatedAt" TIMESTAMP(3) NOT NULL` for @updatedAt (no default — the client sets it). Actually Prisma 5 emits: for `@updatedAt`, the column is `TIMESTAMP(3) NOT NULL` with no default ✓. But my raw SQL recompute doesn't touch payment_orders ✓. The write goes through the Prisma client (which sets updatedAt) ✓. OK — migration: `"updated_at" TIMESTAMP(3) NOT NULL`. ✓

The migration SQL for tables with these defaults:

companies: id TEXT NOT NULL DEFAULT gen_random_uuid(), name TEXT NOT NULL, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP.
workers: id, name, company_id TEXT NOT NULL, FK.
payment_orders: ..., status "OrderStatus" NOT NULL DEFAULT 'PENDING', created_at ... DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL.
events: id, order_id, worker_id, type "EventType" NOT NULL, occurred_at TIMESTAMP(3) NOT NULL, FKs.
operation_entries: as above (no default on id — wait, I set `@id` without a default on OperationEntry (I always supply the id = event id) ✓ no default in DDL ✓).
company_totals: as above, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP (I set @default(now()) and the raw SQL sets it explicitly on update ✓ consistent).

Now the full migration.sql:

```sql
-- Init: marketplace-backoffice source tables + operations read model.

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "EventType" AS ENUM ('ORDER_CREATED', 'ORDER_APPROVED', 'ORDER_REJECTED');

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workers" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_orders" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "company_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "order_id" TEXT NOT NULL,
    "worker_id" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- Read model: one row per order event, denormalized for the dashboard.
-- CreateTable
CREATE TABLE "operation_entries" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "order_status" "OrderStatus" NOT NULL,
    "worker_id" TEXT NOT NULL,
    "worker_name" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "event_type" "EventType" NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "operation_entries_pkey" PRIMARY KEY ("id")
);

-- Read model: exact per-company financial totals, maintained by in-place increments.
-- CreateTable
CREATE TABLE "company_totals" (
    "company_id" TEXT NOT NULL,
    "orders_count" INTEGER NOT NULL DEFAULT 0,
    "pending_amount_cents" BIGINT NOT NULL DEFAULT 0,
    "approved_amount_cents" BIGINT NOT NULL DEFAULT 0,
    "rejected_amount_cents" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "company_totals_pkey" PRIMARY KEY ("company_id")
);

-- CreateIndex
CREATE INDEX "events_occurred_at_idx" ON "events"("occurred_at");
CREATE INDEX "payment_orders_company_status_amount_idx" ON "payment_orders"("company_id", "status", "amount_cents");
CREATE INDEX "operation_entries_occurred_at_idx" ON "operation_entries"("occurred_at");

-- Covering index for the dashboard access pattern:
-- WHERE company_id = ? AND order_status = ? AND occurred_at (range) ORDER BY occurred_at DESC, id DESC.
-- INCLUDE makes it covering → index-only top-N scan. Hand-managed here because
-- Prisma cannot express INCLUDE columns; do not add a duplicate in schema.prisma.
CREATE INDEX "operation_entries_lookup_idx" ON "operation_entries" ("company_id", "order_status", "occurred_at" DESC, "id" DESC) INCLUDE ("order_id", "worker_id", "worker_name", "amount_cents", "event_type");

-- AddForeignKey
ALTER TABLE "workers" ADD CONSTRAINT "workers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "events" ADD CONSTRAINT "events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "payment_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "events" ADD CONSTRAINT "events_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

Wait — the test's resetDatabase splits by ';': the comments contain a ';'?? My comment: "ORDER BY occurred_at DESC, id DESC. INCLUDE makes..." — no semicolons in the comments ✓ (I'll make sure no ';' appears inside comments or strings; 'USD' is fine; enum values are comma-separated). ✓ Also `split(';')` leaves a trailing empty chunk after the final ';' → filtered ✓.

Prisma's TIMESTAMP(3) — the occurredAt stored at millisecond precision. A timestamptz vs timestamp: Prisma's DateTime → `TIMESTAMP(3)` (without tz) by default! The SQL above: I wrote TIMESTAMP(3) ✓ matching Prisma. But my raw SQL uses `now()` (timestamptz) for company_totals.updated_at → inserting timestamptz into a timestamp column: Postgres casts (session TZ) — the column is timestamp without tz; `now()`::timestamp is implicit cast ✓ works (converts to session TZ). Consistency: Prisma writes Date → converts to UTC? Prisma treats DateTime as UTC; the cast to a timestamp column stores the UTC wall-clock… the raw now() in the session TZ (UTC in PG default) ✓ consistent enough. updated_at is informational only ✓. Or make the column timestamptz? Prisma has no timestamptz type (DateTime = timestamp). Keep as Prisma standard. ✓

The raw SQL comparisons with JS Date (occurred_at >= $1): Prisma sends the Date as an ISO string / timestamp — pg casts to timestamp ✓ (Date → '2025-...Z' literal? The pg driver serializes Date to 'YYYY-MM-DD HH:MM:SS.mmm+00'? The pg driver serializes Date to a Postgres timestamp in session TZ… for a `timestamp without time zone` column, the parameter type is unspecified → the pg driver sends an ISO string; Postgres interprets it in the session TZ. Prisma sets the session TZ? Prisma typically runs with the session's timezone = the DB default (UTC in most PGs). Node's Date → pg driver format: it uses `dateToString` → UTC-based 'YYYY-MM-DD HH:MM:SS.mmm+00'… hmm, does the node-postgres driver format Date in the session's offset? node-pg: `new Date().toISOString()`-ish, but actually node-pg serializes Date with a UTC offset marker: '2025-01-01 00:00:00.000+00'. For a timestamptz target, it's interpreted correctly. For a timestamp (no tz) target, Postgres converts to the session TZ (if the session TZ is UTC, then the +00 literal → same value ✓; if the session TZ is say America/New_York → the stored value shifts by 5h vs what Prisma (UTC) would store → comparisons between Prisma-written values and raw-parameterized values could skew by the TZ offset!). To eliminate this risk: in the raw SQL comparisons, I'll cast explicitly: `WHERE e.occurred_at >= $1::timestamptz`? But the column is timestamp — comparing a timestamp column with a timestamptz parameter: Postgres resolves the comparison to timestamptz, converting the column value *from* the session TZ → again a session-TZ-dependent roundtrip. Ugh.

Simplest and robust: **run the DB session in UTC**. I can't control the CI's DB config… but I can set the session TZ per connection: PrismaClient supports a connection string parameter: `DATABASE_URL=...&?` — for Postgres: the Prisma URL supports `?connection_limit` etc.; the session TZ via a connection string parameter? Postgres URL: `?options=-c%20timezone=UTC`? There's a `connect_timeout` etc. Prisma passes unknown parameters? Risky.

Alternative: avoid the Date parameters in the raw SQL entirely — compute the boundary strings in JS as a UTC-formatted string and compare the string to the timestamp? `occurred_at >= $1` where $1 is a string 'YYYY-MM-DD HH:MM:SS.mmm' (UTC wall-clock, no tz marker) → Postgres parses an unmarked timestamp literal into the timestamp column in the session TZ… no: an unmarked timestamp literal is stored as-is (no conversion) into a timestamp column ✓ but the comparison of a column value (which Prisma stored as a UTC wall-clock, because Prisma always converts to UTC before storing into timestamp? Does it? Prisma's timestamp (no tz) handling: Prisma treats DateTime as UTC; when writing to a `timestamp` column, it stores the UTC wall-clock ✓; the node driver: Prisma doesn't use node-pg directly (its own driver) — Prisma writes the UTC wall-clock into the timestamp column ✓ standard behavior.) So: if I format the parameter as a UTC wall-clock string without tz → Postgres stores/compares it as a literal value, no session-TZ involvement ✓ consistent with Prisma's stored UTC values ✓.

So: `const iso = (d: Date) => d.toISOString().replace('T',' ').replace('Z','')` → '2025-01-01 12:34:56.789' — pass as a string parameter; the column is timestamp(3) — millisecond precision: toISOString gives ms ✓ matches TIMESTAMP(3) ✓ (µs beyond are truncated — the occurredAt from Prisma is ms-precision anyway ✓).

I'll use that helper for all raw SQL date parameters (`utcWallClock(d)`).

Similarly the `now()` in the raw UPDATE for company_totals.updated_at: `now()` → timestamptz → implicit cast to timestamp in session TZ — only an informational column; a slight skew is harmless. Or use the same helper: pass the string. For cleanliness, I'll use the parameterized string: `updated_at = $3`. ✓ Deterministic.

OK, now let me re-verify the **concurrent-totals test** mechanics with the upsert statement: two txs, both `INSERT ... ON CONFLICT DO UPDATE SET approved = approved + EXCLUDED.approved` — the second's INSERT blocks on the first's pending unique tuple; after the first commits, the second's ON CONFLICT fires → increments the committed value ✓ exact. Both also do the entry upsert (different ids) and the syncOrderStatus (different orders) — no other contention. ✓ And the orders' updateMany is on different rows ✓.

**Read-your-own-writes via HTTP**: the approval tx commits; the next GET is a new tx (implicit) → MVCC sees the committed row ✓ trivially. The *design* property (projection is written in the same tx as the source) is what makes this true under any connection/pool; the test demonstrates the behavior ✓. I'll also add a unit-ish proof? The spec asks for a behavior test — I'll do e2e ✓.

Now the file count and "don't create files that aren't called for": the enumerated deliverables: projection DDL (migration + schema), maintenance hooks (projection.*), write services (orders.*), re-derivation + drift (maintenance.*), dashboard query (dashboard.*), tests (4 spec files + helpers), DESIGN.md. Plus unavoidable scaffolding: main.ts, app.module.ts (the layout mandates these), common (errors, filter, prisma module/service, status tokens), package.json, tsconfig, vitest config. All justified.

Let me also re-check the **layering** for the DriftRepairJob — a "processor" per the convention ("a service, repository, or processor is listed in the module's providers") — the job = a processor ✓ listed in providers ✓.

**Module exports**: OrdersModule doesn't export anything (self-contained). DashboardModule self-contained. MaintenanceModule self-contained. ProjectionModule exports ProjectionService (used by OrdersModule) ✓ imports: OrdersModule imports ProjectionModule ✓.

PrismaModule @Global ✓ imports: PrismaModule imports nothing (PrismaService extends PrismaClient — the client is constructed with the env DATABASE_URL on instantiation; PrismaClient reads DATABASE_URL automatically ✓ no config needed).

The test helper's `new PrismaClient()` — separate from the app's PrismaService client ✓ both fine.

**Edge — the ValidationPipe `transform: true` for the query DTO**: the page string '1' → Number ✓ with @Type(() => Number). status: @IsIn array ✓.

**404 for unknown order**: the filter maps to resource_not_found ✓.

**The reject flow**: symmetric.

Now — the dashboard's **totals** come from company_totals regardless of the status filter (company-level) ✓ "per-company financial totals."

Let me also think about the **response code for the approval**: 200 ✓.

**The list response shape**:
```ts
{
  items: [...],
  page: number,
  pageSize: number,
  total: number,
  totals: { ordersCount, pendingAmountCents, approvedAmountCents, rejectedAmountCents }
}
```
✓.

Now let me write the **MaintenanceRepository** carefully:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';

export interface DriftReport {
  entries: { missing: number; extra: number; stale: number };
  totals: string[];
}

const utcWallClock = (d: Date): string => d.toISOString().replace('T', ' ').replace('Z', '');

@Injectable()
export class MaintenanceRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async rederiveWindow(from: Date, to: Date): Promise<{ entriesReinserted: number }> {
    const fromSql = utcWallClock(from);
    const toSql = utcWallClock(to);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `DELETE FROM operation_entries WHERE occurred_at >= $1 AND occurred_at < $2`, [fromSql, toSql],
      );
      const inserted = await tx.$executeRawUnsafe<number>(`
        INSERT INTO operation_entries (id, order_id, company_id, order_status, worker_id, worker_name, amount_cents, event_type, occurred_at)
        SELECT e.id, e.order_id, o.company_id, o.status, e.worker_id, w.name, o.amount_cents, e.type, e.occurred_at
        FROM events e
        JOIN payment_orders o ON o.id = e.order_id
        JOIN workers w ON w.id = e.worker_id
        WHERE e.occurred_at >= $1 AND e.occurred_at < $2`, [fromSql, toSql]);
      // Serialize live writes to affected companies' totals behind this recompute:
      // a concurrent approval blocks here and then applies its increment on top of the exact value.
      await tx.$executeRawUnsafe(`
        WITH affected AS (
          SELECT DISTINCT o.company_id
          FROM events e
          JOIN payment_orders o ON o.id = e.order_id
          WHERE e.occurred_at >= $1 AND e.occurred_at < $2
        )
        SELECT t.company_id
        FROM company_totals t
        JOIN affected a ON a.company_id = t.company_id
        FOR UPDATE`, [fromSql, toSql]);
      await tx.$executeRawUnsafe(`
        INSERT INTO company_totals (company_id)
        SELECT DISTINCT o.company_id
        FROM events e
        JOIN payment_orders o ON o.id = e.order_id
        WHERE e.occurred_at >= $1 AND e.occurred_at < $2
        ON CONFLICT (company_id) DO NOTHING`, [fromSql, toSql]);
      await tx.$executeRawUnsafe(`
        UPDATE company_totals t
        SET orders_count = s.orders_count,
            pending_amount_cents = s.pending_amount_cents,
            approved_amount_cents = s.approved_amount_cents,
            rejected_amount_cents = s.rejected_amount_cents,
            updated_at = $3
        FROM (
          SELECT o.company_id,
                 count(*)::int AS orders_count,
                 COALESCE(sum(o.amount_cents) FILTER (WHERE o.status = 'PENDING'), 0)::bigint AS pending_amount_cents,
                 COALESCE(sum(o.amount_cents) FILTER (WHERE o.status = 'APPROVED'), 0)::bigint AS approved_amount_cents,
                 COALESCE(sum(o.amount_cents) FILTER (WHERE o.status = 'REJECTED'), 0)::bigint AS rejected_amount_cents
          FROM payment_orders o
          WHERE o.company_id IN (
            SELECT DISTINCT o2.company_id
            FROM events e2
            JOIN payment_orders o2 ON o2.id = e2.order_id
            WHERE e2.occurred_at >= $1 AND e2.occurred_at < $2
          )
          GROUP BY o.company_id
        ) s
        WHERE t.company_id = s.company_id`, [fromSql, toSql, utcWallClock(new Date())]);
      return { entriesReinserted: Number(inserted) };
    });
  }
```

Hmm wait — `$executeRawUnsafe` with a parameter array: signature `$executeRawUnsafe(sql, ...values)` — values can be an array too? Prisma: `$executeRawUnsafe(sql, values)` accepts a spread or a single array? The typed `$executeRaw` takes (values: Prisma.SqlValue[]) as one array param. For $executeRawUnsafe: `(...values: Prisma.Sql[])` — both forms work? The Prisma docs: `prisma.$executeRawUnsafe(\`...\`, id, name)` spread, or `prisma.$executeRawUnsafe(\`...\`, [id, name])`? The unsafe version's TS signature: `(sql: string, ...values: Prisma.Sql[])` → passing a single array matches `...values` as a single value that is an array — pg driver: Prisma flattens? I recall Prisma supports both for $queryRawUnsafe: `prisma.$queryRawUnsafe('...', [a, b])` — yes, the Prisma docs show the array form for $queryRawUnsafe ✓ ("You can also pass the values as an array"). ✓ I'll use the array form consistently.

detectDrift:

```ts
async detectDrift(from: Date, to: Date): Promise<DriftReport> {
  const fromSql = utcWallClock(from);
  const toSql = utcWallClock(to);
  const [entryRows, totalRows] = await Promise.all([
    this.prisma.$queryRawUnsafe<Array<{ kind: string; count: bigint }>>(`
      WITH source AS (
        SELECT e.id, e.order_id, o.company_id, o.status, e.worker_id, w.name AS worker_name,
               o.amount_cents, e.type, e.occurred_at
        FROM events e
        JOIN payment_orders o ON o.id = e.order_id
        JOIN workers w ON w.id = e.worker_id
        WHERE e.occurred_at >= $1 AND e.occurred_at < $2
      )
      SELECT
        CASE
          WHEN p.id IS NULL THEN 'missing'
          WHEN s.id IS NULL THEN 'extra'
          ELSE 'stale'
        END AS kind,
        count(*)::bigint AS count
      FROM source s
      FULL OUTER JOIN operation_entries p ON p.id = s.id
      WHERE p.id IS NULL
         OR s.id IS NULL
         OR (p.order_id, p.company_id, p.order_status, p.worker_id, p.worker_name, p.amount_cents, p.event_type, p.occurred_at)
          <> (s.order_id, s.company_id, s.status, s.worker_id, s.worker_name, s.amount_cents, s.type, s.occurred_at)
      GROUP BY kind`, [fromSql, toSql]),
    this.prisma.$queryRawUnsafe<Array<{ company_id: string }>>(`
      WITH affected AS (
        SELECT DISTINCT o.company_id
        FROM events e
        JOIN payment_orders o ON o.id = e.order_id
        WHERE e.occurred_at >= $1 AND e.occurred_at < $2
      ),
      expected AS (
        SELECT o.company_id,
               count(*)::int AS orders_count,
               COALESCE(sum(o.amount_cents) FILTER (WHERE o.status = 'PENDING'), 0)::bigint AS pending_amount_cents,
               COALESCE(sum(o.amount_cents) FILTER (WHERE o.status = 'APPROVED'), 0)::bigint AS approved_amount_cents,
               COALESCE(sum(o.amount_cents) FILTER (WHERE o.status = 'REJECTED'), 0)::bigint AS rejected_amount_cents
        FROM payment_orders o
        WHERE o.company_id IN (SELECT company_id FROM affected)
        GROUP BY o.company_id
      )
      SELECT e.company_id
      FROM expected e
      LEFT JOIN company_totals t ON t.company_id = e.company_id
      WHERE t.company_id IS NULL
         OR t.orders_count <> e.orders_count
         OR t.pending_amount_cents <> e.pending_amount_cents
         OR t.approved_amount_cents <> e.approved_amount_cents
         OR t.rejected_amount_cents <> e.rejected_amount_cents`, [fromSql, toSql]),
  ]);
  const entries = { missing: 0, extra: 0, stale: 0 };
  for (const row of entryRows) entries[row.kind as keyof typeof entries] = Number(row.count);
  return { entries, totals: totalRows.map(r => r.company_id) };
}
```

`GROUP BY kind` — grouping by the column alias: Postgres allows GROUP BY alias? Postgres allows output column names in GROUP BY? Actually, Postgres allows grouping by output column *aliases*? No — Postgres doesn't allow the use of SELECT aliases in GROUP BY (that's MySQL). Wait — actually Postgres does allow the use of output column names in GROUP BY! Let me recall: PostgreSQL docs: "GROUP BY can contain … references to output columns as specified in the SELECT list"? Hmm — PostgreSQL allows grouping by the result column's *name* if it's unambiguous? I think Postgres allows `GROUP BY alias` when the alias is a simple name that isn't also a column name? Let me recall concretely: `SELECT a AS x, count(*) FROM t GROUP BY x` — I'm pretty sure Postgres accepts this (it resolves the alias in GROUP BY/ORDER BY; in ORDER BY definitely; in GROUP BY… yes, PostgreSQL resolves target-list aliases in GROUP BY — I've done this many times. Hmm, risk: `kind` — there's no column named kind in the tables → it resolves to the alias ✓ I'll accept it. To be extra safe, I'll repeat the CASE expression or use `GROUP BY 1` — `GROUP BY 1` is safe in Postgres ✓ (ordinal). I'll use `GROUP BY 1`. ✓

The tuple comparison with a NULL on one side: handled by the preceding OR terms (Postgres evaluates OR with short-circuit? It evaluates all but NULL<>NULL=NULL → treated as false in WHERE ✓; the row is kept via the IS NULL term ✓).

Now — **the extra rows case**: an operation_entries row whose id is not in the source (a ghost from a rolled-back write? Impossible — the rollback rolls back both; a ghost can only be manually injected, or a re-derive delete missed it… anyway detectable ✓). The repair re-derives the window: the ghost's occurred_at — if in the window, the delete removes it ✓; if the ghost's occurred_at is outside the window → survives (documented limit: the repair is window-scoped; a deeper drift → manual re-derive with the right window).

Now the **orders.repository.ts** in full:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { EventType, OrderStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { ForbiddenActionError, InvalidOrderStateError, ResourceNotFoundError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { ProjectionService } from '../projection/projection.service';

export interface CreateOrderInput {
  companyId: string;
  amountCents: number;
  currency: string;
  workerId: string;
}

export interface TransitionInput {
  orderId: string;
  workerId: string;
  from: OrderStatus;
  to: OrderStatus;
  eventType: EventType;
}

export interface OrderView {
  id: string;
  companyId: string;
  amountCents: number;
  status: OrderStatus;
}

@Injectable()
export class OrdersRepository {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProjectionService) private readonly projector: ProjectionService,
  ) {}

  async createOrder(input: CreateOrderInput): Promise<OrderView> {
    return this.prisma.$transaction(async (tx) => {
      const [worker, company] = await Promise.all([
        tx.worker.findUnique({ where: { id: input.workerId } }),
        tx.company.findUnique({ where: { id: input.companyId } }),
      ]);
      if (!company) throw new ResourceNotFoundError('company', input.companyId);
      if (!worker) throw new ResourceNotFoundError('worker', input.workerId);
      if (worker.companyId !== company.id) {
        throw new ForbiddenActionError('worker does not belong to the order's company', { workerId: worker.id, companyId: company.id });
      }
      const occurredAt = new Date();
      const order = await tx.paymentOrder.create({
        data: { companyId: company.id, amountCents: input.amountCents, currency: input.currency, status: OrderStatus.PENDING },
      });
      const event = await tx.event.create({
        data: { orderId: order.id, workerId: worker.id, type: EventType.ORDER_CREATED, occurredAt },
      });
      // Maintenance hook, in the same transaction as the source write:
      // if the write rolls back, the projection never sees it.
      await this.projector.onOrderCreated(tx, { order, event, worker });
      return { id: order.id, companyId: order.companyId, amountCents: order.amountCents, status: order.status };
    });
  }

  async transitionOrder(input: TransitionInput): Promise<OrderView> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.paymentOrder.updateMany({
        where: { id: input.orderId, status: input.from },
        data: { status: input.to },
      });
      if (updated.count === 0) {
        const order = await tx.paymentOrder.findUnique({ where: { id: input.orderId } });
        if (!order) throw new ResourceNotFoundError('order', input.orderId);
        throw new InvalidOrderStateError(order.id, order.status, input.from);
      }
      const [worker, order] = await Promise.all([
        tx.worker.findUnique({ where: { id: input.workerId } }),
        tx.paymentOrder.findUnique({ where: { id: input.orderId } }),
      ]);
      if (!worker) throw new ResourceNotFoundError('worker', input.workerId);
      if (!order) throw new ResourceNotFoundError('order', input.orderId);
      if (worker.companyId !== order.companyId) {
        throw new ForbiddenActionError('worker does not belong to the order's company', { workerId: worker.id, companyId: order.companyId });
      }
      const event = await tx.event.create({
        data: { id: ?... }
      });
      await this.projector.onOrderStatusChanged(tx, { order, from: input.from, to: input.to, event, worker });
      return { id: order.id, companyId: order.companyId, amountCents: order.amountCents, status: order.status };
    });
  }
}
```

The event.id: default uuid ✓ omit.

The Promise.all with two findUnique in a tx — both sequential over the wire anyway (the Prisma client in a tx serializes queries? A Prisma client in an interactive tx: concurrent queries on the same tx client — Prisma handles batching? It sends sequentially; fine.)

Note: the `order` after updateMany has status = input.to; the hook uses `from` for the delta ✓, the entry uses `to` ✓ (ProjectionService.onOrderStatusChanged builds the entry with `to`).

**ProjectionService**:

```ts
import { Inject, Injectable } from '@prisma/client'?? no.
import { Injectable } from '@nestjs/common';
import { EventType, OrderStatus } from '@prisma/client';
import type { Prisma, Worker, PaymentOrder, Event } from '@prisma/client';
import { Inject } from '@nestjs/common';
import { ProjectionRepository, type TotalsDelta, type OperationEntryRow } from './projection.repository';

interface OrderEventContext {
  order: PaymentOrder;
  event: Event;
  worker: Worker;
}

@Injectable()
export class ProjectionService {
  constructor(@Inject(ProjectionRepository) private readonly projection: ProjectionRepository) {}

  /** Hook for the order.create write path. */
  async onOrderCreated(tx: Prisma.TransactionClient, ctx: OrderEventContext): Promise<void> {
    await this.projection.upsertEntry(tx, this.entryFor(ctx, ctx.order.status));
    await this.projection.adjustTotals(tx, ctx.order.companyId, this.deltaFor(ctx.order.status, ctx.order.amountCents, { ordersCount: 1 }));
  }

  /** Hook for the approve/reject write path. */
  async onOrderStatusChanged(tx: Prisma.TransactionClient, ctx: OrderEventContext & { from: OrderStatus; to: OrderStatus }): Promise<void> {
    await this.projection.upsertEntry(tx, this.entryFor(ctx, ctx.to));
    await this.projection.syncOrderStatus(tx, ctx.order.id, ctx.to);
    await this.projection.adjustTotals(tx, ctx.order.companyId, this.deltaFor(ctx.from, -ctx.order.amountCents, {}));
    await this.projection.adjustTotals(tx, ctx.order.companyId, this.deltaFor(ctx.to, +ctx.order.amountCents, {}));
  }

  private entryFor(ctx: OrderEventContext, status: OrderStatus): OperationEntryRow {
    return {
      id: ctx.event.id,
      orderId: ctx.order.id,
      companyId: ctx.order.companyId,
      orderStatus: status,
      workerId: ctx.worker.id,
      workerName: ctx.worker.name,
      amountCents: ctx.order.amountCents,
      eventType: ctx.event.type,
      occurredAt: ctx.event.occurredAt,
    };
  }

  private deltaFor(status: OrderStatus, amountCents: number, base: Partial<TotalsDelta>): TotalsDelta {
    const delta: TotalsDelta = { ordersCount: 0, pendingAmountCents: 0, approvedAmountCents: 0, rejectedAmountCents: 0, ...base };
    switch (status) {
      case OrderStatus.PENDING: delta.pendingAmountCents += amountCents; break;
      case OrderStatus.APPROVED: delta.approvedAmountCents += amountCents; break;
      case OrderStatus.REJECTED: delta.rejectedAmountCents += amountCents; break;
    }
    return delta;
  }
}
```

Two adjustTotals calls for the change (one per bucket) — two atomic statements; could combine into one statement with both deltas — one statement is cleaner:
`deltaForChange(from, to, amount)` returning both. Let me do that:

```ts
private transitionDelta(from: OrderStatus, to: OrderStatus, amountCents: number): TotalsDelta {
  const d: TotalsDelta = zeros;
  this.add(d, from, -amountCents);
  this.add(d, to, +amountCents);
  return d;
}
private add(d: TotalsDelta, status: OrderStatus, amountCents: number) { switch... }
```
✓ one statement per write.

**ProjectionRepository**:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';

export interface OperationEntryRow {
  id: string;
  orderId: string;
  companyId: string;
  orderStatus: OrderStatus;
  workerId: string;
  workerName: string;
  amountCents: number;
  eventType: EventType;
  occurredAt: Date;
}

export interface TotalsDelta {
  ordersCount: number;
  pendingAmountCents: number;
  approvedAmountCents: number;
  rejectedAmountCents: number;
}

@Injectable()
export class ProjectionRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async upsertEntry(tx: Prisma.TransactionClient, e: OperationEntryRow): Promise<void> {
    // Idempotent: re-applying the same event (double hook, re-derivation overlap) converges to the same row.
    await tx.$executeRaw`
      INSERT INTO operation_entries (id, order_id, company_id, order_status, worker_id, worker_name, amount_cents, event_type, occurred_at)
      VALUES (${e.id}, ${e.orderId}, ${e.companyId}, ${e.orderStatus}, ${e.workerId}, ${e.workerName}, ${e.amountCents}, ${e.eventType}, ${e.occurredAt})
      ON CONFLICT (id) DO UPDATE SET
        order_status = EXCLUDED.order_status,
        amount_cents = EXCLUDED.amount_cents,
        worker_name = EXCLUDED.worker_name,
        event_type = EXCLUDED.event_type,
        occurred_at = EXCLUDED.occurred_at`;
  }

  async syncOrderStatus(tx: Prisma.TransactionClient, orderId: string, status: OrderStatus): Promise<void> {
    await tx.$executeRaw`UPDATE operation_entries SET order_status = ${status} WHERE order_id = ${orderId} AND order_status <> ${status}`;
  }

  async adjustTotals(tx: Prisma.TransactionClient, companyId: string, d: TotalsDelta): Promise<void> {
    // A single atomic upsert-with-increment: concurrent writers on the same company serialize on the
    // unique row and each delta is applied in place — no read-modify-write, so nothing is lost.
    await tx.$executeRaw`
      INSERT INTO company_totals (company_id, orders_count, pending_amount_cents, approved_amount_cents, rejected_amount_cents)
      VALUES (${companyId}, ${d.ordersCount}, ${d.pendingAmountCents}, ${d.approvedAmountCents}, ${d.rejectedAmountCents})
      ON CONFLICT (company_id) DO UPDATE SET
        orders_count = company_totals.orders_count + EXCLUDED.orders_count,
        pending_amount_cents = company_totals.pending_amount_cents + EXCLUDED.pending_amount_cents,
        approved_amount_cents = company_totals.approved_amount_cents + EXCLUDED.approved_amount_cents,
        rejected_amount_cents = company_totals.rejected_amount_cents + EXCLUDED.rejected_amount_cents,
        updated_at = now()`;
  }
}
```

The tagged template with the enum values: Prisma serializes the enum string ✓. `now()` inside a tagged raw ✓ (a raw SQL fragment in the string).

Wait — the tagged `$executeRaw` template literals: `${e.occurredAt}` Date ✓ supported.

**DashboardRepository** — as above. The findMany orderBy is `[{ occurredAt: 'desc' }, { id: 'desc' }]` ✓.

**DashboardService** — as above; imports: Prisma? no. OrderStatus from '@prisma/client' ✓.

**Common files**:

errors.ts:
```ts
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export class ResourceNotFoundError extends DomainError {
  constructor(resource: string, id: string) {
    super('resource_not_found', `${resource} '${id}' was not found`, 404, { resource, id });
  }
}

export class InvalidOrderStateError extends DomainError {
  constructor(orderId: string, current: string, expected: string) {
    super('invalid_order_state', `order '${orderId}' is '${current}', the action requires '${expected}'`, 409, { orderId, currentStatus: current, expectedStatus: expected });
  }
}

export class ForbiddenActionError extends DomainError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('forbidden', message, 403, details);
  }
}
```
The name `ForbiddenActionError` — the Nest core has a ForbiddenException; I'm not extending it (a separate class) → the filter checks DomainError first ✓. The naming is fine.

all-exceptions.filter.ts — as drafted. Include a log line for 500s? A Logger. Keep it minimal but log:
```ts
if (!(exception instanceof DomainError) && !(exception instanceof HttpException)) {
  this.logger.error(...);
}
```
Add a Logger field.

order-status.ts (common):
```ts
import { OrderStatus } from '@prisma/client';

export type OrderStatusToken = 'pending' | 'approved' | 'rejected';

export const TOKEN_TO_STATUS: Record<OrderStatusToken, OrderStatus> = {
  pending: OrderStatus.PENDING,
  approved: OrderStatus.APPROVED,
  rejected: OrderStatus.REJECTED,
};

export const STATUS_TO_TOKEN: Record<OrderStatus, OrderStatusToken> = {
  [OrderStatus.PENDING]: 'pending',
  [OrderStatus.APPROVED]: 'approved',
  [OrderStatus.REJECTED]: 'rejected',
};
```

prisma.service.ts / prisma.module.ts:
```ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> { await this.$connect(); }
  async onModuleDestroy(): Promise<void> { await this.$disconnect(); }
}

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
```

**app.module.ts**:
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from './common/prisma.module';
import { OrdersModule } from './orders/orders.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { MaintenanceModule } from './maintenance/maintenance.module';

@Module({
  imports: [PrismaModule, OrdersModule, DashboardModule, MaintenanceModule],
})
export class AppModule {}
```

**maintenance.module.ts**:
```ts
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [MaintenanceService, MaintenanceRepository, DriftRepairJob],
})
export class MaintenanceModule {}
```
No controller — allowed? A module with only providers ✓.

**orders.module.ts**:
```ts
@Module({
  imports: [ProjectionModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersRepository],
})
export class OrdersModule {}
```

**dashboard.module.ts**:
```ts
@Module({
  controllers: [DashboardController],
  providers: [DashboardService, DashboardRepository],
})
export class DashboardModule {}
```

**projection.module.ts**:
```ts
@Module({
  providers: [ProjectionService, ProjectionRepository],
  exports: [ProjectionService],
})
export class ProjectionModule {}
```

Now the tests. A common helper file `test/helpers.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';

export const prisma = new PrismaClient();

export async function resetDatabase(): Promise<void> {
  await prisma.$connect();
  await prisma.$executeRawUnsafe('DROP SCHEMA public CASCADE');
  await prisma.$executeRawUnsafe('CREATE SCHEMA public');
  const migrationPath = fileURLToPath(new URL('../prisma/migrations/20250101000000_init/migration.sql', import.meta.url));
  const sql = readFileSync(migrationPath, 'utf8');
  for (const statement of sql.split(';')) {
    const trimmed = statement.trim();
    if (trimmed.length > 0) await prisma.$executeRawUnsafe(trimmed);
  }
}

export async function buildApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}

export interface Seed {
  companyId: string;
  workerId: string;
  workerName: string;
}

export async function seedCompany(companyName = 'Acme'): Promise<Seed> {
  const company = await prisma.company.create({ data: { name: companyName } });
  const worker = await prisma.worker.create({ data: { name: 'Operator One', companyId: company.id } });
  return { companyId: company.id, workerId: worker.id, workerName: worker.name };
}

export type OperationsResponse = {
  items: Array<{ id: string; orderId: string; status: string; eventType: string; workerId: string; workerName: string; amountCents: number; occurredAt: string }>;
  page: number;
  pageSize: number;
  total: number;
  totals: { ordersCount: number; pendingAmountCents: string; approvedAmountCents: string; rejectedAmountCents: string };
};
```

Test 1 — read-your-own-writes.spec.ts:

```ts
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { buildApp, prisma, resetDatabase, seedCompany } from './helpers';

describe('read-your-own-writes', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await resetDatabase();
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('an operator sees each write on the very next request, with no background refresh', async () => {
    const { companyId, workerId, workerName } = await seedCompany('RW Co');

    // Write: create
    const created = await request(app.getHttpServer())
      .post('/orders')
      .send({ companyId, amountCents: 12000, currency: 'USD', workerId });
    expect(created.status).toBe(201);
    const orderId = created.body.id;

    // The next read shows it, pending, with the worker denormalized
    let page = await request(app.getHttpServer()).get('/operations').query({ companyId, status: 'pending' });
    expect(page.status).toBe(200);
    expect(page.body.total).toBe(1);
    expect(page.body.items).toHaveLength(1);
    expect(page.body.items[0]).toMatchObject({ orderId, status: 'pending', eventType: 'order_created', workerName, amountCents: 12000 });
    expect(page.body.totals).toMatchObject({ ordersCount: 1, pendingAmountCents: '12000', approvedAmountCents: '0', rejectedAmountCents: '0' });

    // Write: approve → the next read shows it approved; the pending list is empty
    const approved = await request(app.getHttpServer()).post(`/orders/${orderId}/approve`).send({ workerId });
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ id: orderId, status: 'approved' });

    page = await request(app.getHttpServer()).get('/operations').query({ companyId, status: 'approved' });
    expect(page.body.total).toBe(1);
    expect(page.body.items[0]).toMatchObject({ orderId, status: 'approved', eventType: 'order_approved' });
    expect(page.body.totals).toMatchObject({ pendingAmountCents: '0', approvedAmountCents: '12000' });

    // The order's earlier entry also moved to the current status
    page = await request(app.getHttpServer()).get('/operations').query({ companyId, status: 'pending' });
    expect(page.body.total).toBe(0);

    // Write: reject a second order → visible immediately
    const second = await request(app.getHttpServer()).post('/orders').send({ companyId, amountCents: 3000, currency: 'USD', workerId });
    const rejected = await request(app.getHttpServer()).post(`/orders/${second.body.id}/reject`).send({ workerId });
    expect(rejected.status).toBe(200);
    page = await request(app.getHttpServer()).get('/operations').query({ companyId, status: 'rejected' });
    expect(page.body.total).toBe(1);
    expect(page.body.items[0]).toMatchObject({ orderId: second.body.id, status: 'rejected', eventType: 'order_rejected' });
    expect(page.body.totals).toMatchObject({ approvedAmountCents: '12000', rejectedAmountCents: '3000' });
  });

  it('a rolled-back write leaves the projection untouched', async () => {
    const { companyId, workerId } = await seedCompany('Rollback Co');
    const created = await request(app.getHttpServer()).post('/orders').send({ companyId, amountCents: 500, currency: 'USD', workerId });
    expect(created.status).toBe(201);
    const orderId = created.body.id;
    const first = await request(app.getHttpServer()).post(`/orders/${orderId}/approve`).send({ workerId });
    expect(first.status).toBe(200);

    // The second approval fails (already approved): its transaction, hook included, rolls back
    const second = await request(app.getHttpServer()).post(`/orders/${orderId}/approve`).send({ workerId });
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ error: { code: 'invalid_order_state' } });
    expect(second.body.error.details).toMatchObject({ orderId, currentStatus: 'APPROVED' });

    const page = await request(app.getHttpServer()).get('/operations').query({ companyId, status: 'approved' });
    // Exactly two entries for the order: created + approved. No ghost event row from the failed write.
    expect(page.body.total).toBe(1);
    const all = await request(app.getHttpServer()).get('/operations').query({ companyId, status: 'approved' }); // hmm — after approval, both entries have status approved (sync) → the approved list shows 2 entries for the one order
    ...
  });
});
```

Wait — the status sync: after approval, both entries (created, approved) have order_status=APPROVED → the approved filter shows 2 entries (order created + order approved). So `page.body.total` for status=approved = 2 (for the one order). Let me re-verify the first test: after approval, the approved list = 2 entries (created + approved events, both now showing approved). I wrote earlier "expect(page.body.total).toBe(1)" for approved — wrong, it's 2. Let me recount: order1: entries e_created, e_approved. After approve: both order_status=APPROVED. Filter approved → 2 rows. The test asserts total 1 — I have to fix it: expect 2 and find the eventType order_approved among them. I'll assert items length 2, one of which is order_created and one is order_approved.

The pending list after approval: 0 ✓ (both moved).

Rollback test: after a failed second approval: the approved filter → 2 entries (unchanged), the order has exactly 2 events in the source:
```ts
const eventCount = await prisma.event.count({ where: { orderId } });
expect(eventCount).toBe(2);
```
And the totals unchanged: approved 500, pending 0, ordersCount 1. And the approved page total is 2 ✓.

404 test:
```ts
it('returns the standard error envelope for a missing order', async () => {
  const unknown = crypto.randomUUID();
  const res = await request(app.getHttpServer()).post(`/orders/${unknown}/approve`).send({ workerId: (await seedCompany('X')).workerId });
  expect(res.status).toBe(404);
  expect(res.body).toMatchObject({ error: { code: 'resource_not_found', details: { resource: 'order', id: unknown } } });
  expect(res.body.error.details).toBeTypeOf('object');
});
```
crypto: `import { randomUUID } from 'node:crypto';` ✓.

Test 2 — concurrent-totals.spec.ts:

```ts
describe('concurrent updates to one company\'s totals', () => {
  it('two concurrent approvals for the same company both land, exact totals', async () => {
    const seed = await seedCompany('Concurrent Co');
    const [a, b] = await Promise.all([
      request(server).post('/orders').send({ ...amount 1000 }),
      request(server).post('/orders').send({ ...amount 2500 }),
    ]);
    // Both create txs concurrent — each must land
    expect([a.status, b.status]).toEqual([201, 201]);
    const [ra, rb] = await Promise.all([
      request(server).post(`/orders/${a.body.id}/approve`).send({ workerId }),
      request(server).post(`/orders/${b.body.id}/approve`).send({ workerId }),
    ]);
    expect([ra.status, rb.status]).toEqual([200, 200]);
    const page = await request(server).get('/operations').query({ companyId, status: 'approved' });
    expect(page.body.totals).toEqual({ ordersCount: 2, pendingAmountCents: '0', approvedAmountCents: '3500', rejectedAmountCents: '0' });
    expect(page.body.total).toBe(4); // created+approved per order, both showing approved
  });

  it('a burst of 20 concurrent approvals never loses an increment', async () => {
    const seed = await seedCompany('Burst Co');
    const ids = [];
    for (let i = 0; i < 20; i++) {
      const res = await request(server).post('/orders').send({ companyId, amountCents: 100, currency: 'USD', workerId });
      ids.push(res.body.id);
    }
    await Promise.all(ids.map(id => request(server).post(`/orders/${id}/approve`).send({ workerId })));
    const page = ... status approved;
    expect(page.body.totals.approvedAmountCents).toBe('2000');
    expect(page.body.totals.ordersCount).toBe(20);
    expect(page.body.total).toBe(40);
  });
});
```
Sequential creates (fine — the concurrency being tested is the approvals). I could also Promise.all the creates; the sequential creation avoids create-tx contention noise; the spec asks for concurrency on the approval ✓.

Test 3 — re-derivation.spec.ts:

```ts
describe('re-derivation for an arbitrary window', () => {
  let app; let maintenance: MaintenanceService;
  beforeAll: reset, build, maintenance = app.get(MaintenanceService);

  it('rebuilds the projection to match the source exactly, and is idempotent', async () => {
    const { companyId } = await seedCompany('Rebuild Co');
    // Activity: 5 orders (100 each), 2 approved, 1 rejected
    const ids = create 5;
    approve ids[0], ids[1]; reject ids[2];
    
    // Inject damage inside the window (a bad manual "data fix" on the projection)
    await prisma.$executeRaw`UPDATE operation_entries SET worker_name = 'Ghost', amount_cents = 1 WHERE company_id = ${companyId}`;
    await prisma.$executeRaw`DELETE FROM operation_entries WHERE company_id = ${companyId} AND event_type = 'ORDER_APPROVED'`;
    await prisma.$executeRaw`UPDATE company_totals SET approved_amount_cents = 99999, orders_count = 77 WHERE company_id = ${companyId}`;

    const from = new Date(Date.now() - 60 * 60 * 1000);
    const to = new Date(Date.now() + 60 * 60 * 1000);
    const first = await maintenance.rederiveWindow(from, to);
    expect(first.entriesReinserted).toBe(9); // 5 created + 2 approved + 1 rejected = 8 events! 
```
Wait: events: 5 created + 2 approved + 1 rejected = 8 events → 8 entries. ✓ 8.

```ts
    // The projection now matches the source exactly
    const page = await request(server).get('/operations').query({ companyId, status: 'approved' });
    expect(page.body.totals).toEqual({ ordersCount: 5, pendingAmountCents: '200', approvedAmountCents: '200', rejectedAmountCents: '100' });
    // The worker name is restored, and the deleted entry is back
    expect(page.body.items.every(i => i.workerName === 'Operator One')).toBe(true);
    expect(page.body.items.map(i => i.eventType).sort()).toEqual(['order_approved','order_approved','order_created','order_created']);

    // Run twice over the same window → same result
    const snap = async () => [
      await prisma.$queryRawUnsafe(`SELECT * FROM operation_entries ORDER BY id`),
      await prisma.$queryRawUnsafe(`SELECT * FROM company_totals ORDER BY company_id`),
    ];
    const before = await snap();
    await maintenance.rederiveWindow(from, to);
    const after = await snap();
    expect(after).toEqual(before);
  });

  it('is safe to run while the system is live', async () => {
    const { companyId, workerId } = await seedCompany('Live Co');
    // A few settled orders so the company is in the re-derive's affected set
    create 3 orders (50 each); approve 1;
    const from = new Date(Date.now() - 60 * 60 * 1000);
    const to = new Date(Date.now() + 60 * 60 * 1000);
    // An in-flight approval racing the re-derive; it must neither be lost nor double-counted
    const [rederive, approval] = await Promise.all([
      maintenance.rederiveWindow(from, to),
      (async () => {
        const created = await request(server).post('/orders').send({ companyId, amountCents: 250, currency: 'USD', workerId });
        return request(server).post(`/orders/${created.body.id}/approve`).send({ workerId });
      })(),
    ]);
    expect(approval.status).toBe(200);
    const page = await request(server).get('/operations').query({ companyId, status: 'approved' });
    expect(page.body.totals).toEqual({ ordersCount: 4, pendingAmountCents: '100', approvedAmountCents: '300', rejectedAmountCents: '0' });
    // The raced approval's entry is present exactly once
    const approvalEntry = page.body.items.find(i => i.eventType === 'order_approved' && i.amountCents === 250);
    expect(approvalEntry).toBeDefined();
    const entryCount = await prisma.operationEntry.count({ where: { companyId, eventType: 'ORDER_APPROVED' } });
    expect(entryCount).toBe(2);
  });
});
```

Let me verify the live test totals: 3 created (50 each): pending 150. Approve 1: pending 100, approved 50. The raced one: create 250 (pending 350) + approve (pending 100, approved 300). Final: ordersCount 4, pending 100, approved 300, rejected 0 ✓. Entries: created×4 + approved×2 = 6; the approved filter shows 4 entries (the created and approved of the two approved orders) ✓ find works.

Timing robustness: as analyzed, both interleavings are consistent ✓. One more interleave: the approval's create tx commits during the re-derive (after the re-derive's delete/read): its entry is inserted after the delete → survives ✓; the totals recompute may or may not see the created order (PENDING): if not seen → then the create's adjustTotals (+pending 250) blocks on the re-derive's FOR UPDATE lock → applied after the exact value ✓; the approval's adjustTotals (-pending +approved) is a later statement in the same tx ✓. If the re-derive sees it → the exact value includes pending 250; the create's increment would double it?? Wait: the create's tx commits before the re-derive's read → the re-derive's recompute (from payment_orders) includes the order as PENDING → pending 150+250=400 in the exact value. The create's adjustTotals has already committed before that (its increment is in the old row; the recompute SETs absolute → no double count ✓ — the SET overwrites, not adds). Then the approval tx: its adjustTotals applies -250/+250 after the re-derive commit ✓ → pending 150? Let me recompute: 3×50 created, 1 approved: pending 100 approved 50. Create 250: pending 350. Approve 250: pending 100, approved 300. The exact recompute at the moment it sees all creates+first approve (before the 250's approval): pending 350, approved 50. Then the 250's approval tx applies -250/+250 → pending 100, approved 300 ✓. And the entry: the 250's approved event — the re-derive ran before its commit → the entry is from the hook, order_status APPROVED ✓. The re-derive's DELETE: the 250's entry is inserted by the hook after the delete ✓ survives. But wait — the 250's order's created entry: the create tx committed before the re-derive's read → the re-derive deletes and re-inserts it ✓ once. ✓ consistent.

The other order: the approval tx starts and its updateMany runs before the re-derive's FOR UPDATE: it proceeds: insert the event, the entry upsert, the adjustTotals → blocks on the lock (the re-derive holds it) — but its event/entry insert committed? No — the same tx; nothing commits until the adjustTotals completes. The re-derive's delete: the entry is uncommitted → invisible → not deleted; the re-derive's re-insert: the event is uncommitted → not re-derived → after the re-derive commits, the approval tx commits its entry ✓ once ✓.

Test 4 — drift-repair.spec.ts:

```ts
describe('scheduled drift repair', () => {
  let app; let job: DriftRepairJob;

  beforeAll: reset; build; job = app.get(DriftRepairJob);

  it('finds injected drift and repairs it; a second run is clean', async () => {
    const { companyId, workerName } = await seedCompany('Drift Co');
    create 3 orders (500 each); approve the first;
    // Simulate drift (a deploy mid-transaction / a bad manual fix):
    await prisma.$executeRaw`UPDATE operation_entries SET worker_name = 'Ghost' WHERE company_id = ${companyId}`;   // stale
    await prisma.$executeRaw`DELETE FROM operation_entries WHERE company_id = ${companyId}`;                      // missing
    await prisma.$executeRaw`UPDATE company_totals SET orders_count = 42, approved_amount_cents = 12345 WHERE company_id = ${companyId}`; // wrong totals

    const first = await job.run();
    expect(first.repaired).toBe(true);
    expect(first.entries.missing).toBeGreaterThan(0);
    expect(first.totals).toContain(companyId);

    const page = await request(app.getHttpServer()).get('/operations').query({ companyId, status: 'approved' });
    expect(page.body.totals).toEqual({ ordersCount: 3, pendingAmountCents: '1000', approvedAmountCents: '500', rejectedAmountCents: '0' });
    expect(page.body.items.every(i => i.workerName === workerName)).toBe(true);

    const second = await job.run();
    expect(second.repaired).toBe(false);
    expect(second.entries).toEqual({ missing: 0, extra: 0, stale: 0 });
    expect(second.totals).toEqual([]);
  });

  it('detects stale entries whose row exists but disagrees with the source', async () => {
    // (Covered above? The first test has both stale+missing+totals. A separate focused one: corrupt only an amount.)
    ...
  });
});
```
One test is enough + maybe a second for stale-only (no delete): I'll keep two: (1) full drift → repair → clean; (2) stale-only (worker_name/amount drift, no missing) → detected as stale, repaired. Both are cheap. ✓

`job.run()` uses the env lookback default 120 min — the drift is fresh ✓ inside the window.

Note: `app.get(DriftRepairJob)` — the provider is registered ✓.

Also note: the drift test's `job.run()` also runs… the cron isn't active in tests (5 min) ✓ no interference.

Now — **the dashboard service response totals type**: the ordersCount is a number; the amounts are strings. The tests use toEqual with strings ✓.

**The page default**: 20.

**One concern**: `supertest` + `app.getHttpServer()` before `listen()` — the Nest docs e2e pattern uses exactly this ✓ I'll trust it. (createNestApplication → `this.httpServer = this.httpAdapter.createServer()`? In Nest 10, `NestFactory.create` → `createNestApplication` → `new NestApplication(...)`; the constructor does `this.httpServer = this.httpAdapter.createServer()`? Hmm, I believe `createNestApplicationContext` doesn't create the server; `createNestApplication` calls `createNestApplicationContext` then `new NestApplication(context, httpAdapter)`… and `NestApplication`'s constructor: `this.httpServer = httpAdapter.createServer()`? Let me recall the source (v10):

```ts
export const createNestApplication = async (module, httpAdapter?, options?) => {
  const context = await createNestApplicationContext(module, httpAdapter, options);
  const instance = httpAdapter ? new NestApplication(context, httpAdapter, options) : new NestApplication(context, undefined, options);
  ...
};
// NestApplication constructor:
constructor(context, httpAdapter, options) {
  super(context, httpAdapter, options);
  this.httpAdapter = httpAdapter || new HttpAdapter(this);
  this.httpServer = this.httpAdapter.createServer(options);
}
```
Yes — NestApplication's constructor creates the http server eagerly ✓ so `getHttpServer()` after init() works (supertest can attach). ✓ (This matches the documented e2e usage.)

**Validation of the query string `status`**: `@IsIn(['pending','approved','rejected'])` — the required (no @IsOptional) → missing status → 400 invalid_request with details.issues ✓.

**ParseUUIDPipe** for the order id param: `@Param('id', ParseUUIDPipe) id: string` → a malformed → 400 invalid_request ✓.

Now — **the filter for HttpException from ParseUUIDPipe**: a BadRequestException with a string or object payload — handled ✓.

**The `details` in the envelope must be an object, never null** ✓ default {}.

Let me also re-check the **Prisma enum import**: `import { OrderStatus, EventType } from '@prisma/client'` — the generated client exports the enums as const objects ✓ (native TS enum in the generated code? Prisma generates `export const OrderStatus = { PENDING: 'PENDING', ... } as const; export type OrderStatus = ...` ✓).

**`Prisma.TransactionClient`** — exported type ✓.

**Vitest + `import request from 'supertest'`** — supertest is CJS; esModuleInterop ✓ default import works under Vitest's interop ✓.

**tsx runtime for main.ts**: decorators under esbuild — tsx reads the tsconfig's experimentalDecorators ✓ (tsx supports tsconfig decorators; it has to — many Nest+tsx setups work with explicit @Inject… wait, Nest+tsx without emitDecoratorMetadata fails DI! Since I have explicit @Inject everywhere, it works ✓ — I have to make sure I have @Inject on every constructor param in every provider/controller. Let me audit: every DI'd constructor gets @Inject. ✓ I'll be careful.)

Actually wait — controllers too: `constructor(@Inject(DashboardService) ...)` ✓. The filter: `class AllExceptionsFilter implements ExceptionFilter` — instantiated via `new` in main, no DI ✓ (its Logger field: `private readonly logger = new Logger(...)`. A field initializer under useDefineForClassFields false → the constructor assignment ✓ esbuild fine).

**Another audit — is there any class that relies on paramtype inference?** All Nest-resolved classes: PrismaService (no deps), ProjectionRepository (PrismaService @Inject ✓), ProjectionService (ProjectionRepository @Inject ✓), OrdersRepository (PrismaService, ProjectionService ✓), OrdersService (OrdersRepository ✓), DashboardRepository (PrismaService ✓), DashboardService (DashboardRepository ✓), MaintenanceRepository (PrismaService ✓), MaintenanceService (MaintenanceRepository ✓), DriftRepairJob (MaintenanceService ✓). Controllers: OrdersController (OrdersService ✓), DashboardController (DashboardService ✓). ✓ All explicit.

**class-validator decorators under esbuild**: property decorators ✓ supported (legacy). `@IsUUID()` etc. ✓.

**The BigInt in the `prisma.$queryRawUnsafe` snapshot**: returns a bigint; the toEqual comparison is fine.

**`DROP SCHEMA public CASCADE` + Prisma client**: the helper's client's active connections are OK (a new statement). The app's PrismaService connections: after reset, the app is built fresh in each file's beforeAll (the previous file's app was closed in afterAll ✓ with fileParallelism false, the order is: file A afterAll closes before file B beforeAll ✓).

**The DATABASE_URL requirement**: tests need it; I'll note it in the DESIGN/README? No, no README requested… I'll put a short "how to run" section in DESIGN.md (helpful, still short). The convention: "config from env only" ✓ the PrismaClient reads DATABASE_URL automatically.

Now, the **DESIGN.md** (short):

```md
# DESIGN — operations read model

## What we're doing
The dashboard list (orders × events × workers, filtered by company/status/date, sorted by recency, paginated) takes 20–30s at 3M orders. I'm replacing the join with a read model:

- `operation_entries` — one row per order event, denormalized (company, current order status, worker name, amount).
- `company_totals` — exact per-company counts/amounts by status.

The dashboard query becomes:
`SELECT ... FROM operation_entries WHERE company_id=? AND order_status=? AND occurred_at BETWEEN ? AND ? ORDER BY occurred_at DESC, id DESC LIMIT ? OFFSET ?`
served entirely by the covering index `operation_entries_lookup_idx (company_id, order_status, occurred_at DESC, id DESC) INCLUDE (order_id, worker_id, worker_name, amount_cents, event_type)` → index-only top-N scan, page-sized work → p95 < 50ms. The totals come from `company_totals` (one primary-key lookup).

## Why maintenance hooks inside the write transaction
The read-your-own-writes requirement kills every asynchronous design:
- scheduled refresh / materialized view REFRESH / CDC: a visibility window of up to the interval. Fails.
- outbox + queue consumer: even a 100ms consumer lag is a window. Fails.
- Postgres triggers: same-transaction (would satisfy the constraint), but the mapping logic (which totals bucket moves, worker denormalization) lives in SQL, split from the app's types/tests, and harder to evolve; I prefer hooks in the same language as the domain.
The hook is called by the write service inside `prisma.$transaction`: source write and projection write commit or roll back together. A rolled-back write never touches the projection (tested).

## Exactness under concurrency
Totals are never read-modify-writes. One statement:
`INSERT ... ON CONFLICT (company_id) DO UPDATE SET x = x + EXCLUDED.x`
Concurrent approvals for one company serialize on the unique row; each delta is applied in place → nothing is lost (tested with a concurrent burst).

## Recoverability
- Re-derivation for an arbitrary window: delete+rebuild `operation_entries` for the window and recompute `company_totals` for the affected companies as an absolute SET (not an increment). Idempotent (tested: two runs, same result). Safe while live: the recompute locks the affected totals rows (`FOR UPDATE`); a concurrent write's increment serializes behind it and lands on the exact value; a concurrent write's entry either predates the rebuild (re-derived) or postdates it (kept from its hook) — never duplicated, never lost (tested).
- Drift repair: a 5-min job diffs the last N hours of the projection against the source (row-level for entries, aggregate for totals) and re-runs the re-derivation on drift. The rolling window overlaps (lookback 2h, interval 5min) so a missed run is covered.
The projection is therefore disposable: wrong → rebuild. That's why the projection has no FKs (lean writes, integrity is recovered by re-derivation).

## The status the list shows
Entries carry the order's **current** status; a transition updates all of the order's entries in the same transaction as the write. The list shows "operations whose order is currently in this status," and the pending/approved/rejected view never splits one order.

## Tradeoffs
- `status` is required in the query (part of the contracted access pattern; keeps the index fully effective).
- Drift repair covers the lookback window; deeper drift → run re-derivation with the right window (the routine is the tool for that).
- Totals assume a single currency per company (the `currency` is preserved on orders).
- Amounts are serialized as decimal strings (Postgres BIGINT, exact; JSON has no 64-bit integer type).
- The covering index is hand-managed in the migration (Prisma can't express INCLUDE).
```

Good, short.

**How to run** (briefly at the end of DESIGN.md): env DATABASE_URL, pnpm install, pnpm prisma:migrate, pnpm test / pnpm start.

Now let me also re-verify the **acceptance item: "the dashboard query touches only the projection"** — the DashboardRepository queries only operationEntry + companyTotals ✓ (no source tables) ✓. I can add a test asserting this? "The dashboard query touches only the projection" — hard to assert without SQL tracing; the code inspection suffices; the test file focuses on the behavior (the specified 3 tests). I'll keep the 4 spec files as planned (RYOW, concurrent, re-derive, drift) — that covers the specified 3 + the acceptance of re-derive.

Now let me write all the files. The file order in the reply: I'll go with a sensible order: package.json, tsconfig, vitest config, prisma schema, migration, src common, projection, orders, dashboard, maintenance, app, main, tests, DESIGN.md.

Let me carefully write each file.

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
    "start": "tsx src/main.ts",
    "typecheck": "tsc --noEmit",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate deploy",
    "test": "vitest run"
  },
  "postinstall": "prisma generate",
  "dependencies": {
    "@nestjs/common": "^10.4.4",
    "@nestjs/core": "^10.4.4",
    "@nestjs/platform-express": "^10.4.4",
    "@nestjs/schedule": "^4.1.1",
    "@prisma/client": "^5.19.1",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.16.10",
    "@types/supertest": "^6.0.2",
    "prisma": "^5.19.1",
    "supertest": "^7.0.0",
    "tsx": "^4.19.1",
    "typescript": "^5.6.2",
    "vitest": "^2.1.1"
  }
}
```

**tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": false,
    "useDefineForClassFields": false,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "vitest.config.ts"]
}
```
emitDecoratorMetadata false — explicit (I'm relying on @Inject). Hmm — will tsc complain? No, it's just not emitting metadata; the types are fine.

**vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    // The specs share one Postgres database; run files sequentially.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
```

**prisma/schema.prisma** — as drafted. Let me finalize with comments.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum OrderStatus {
  PENDING
  APPROVED
  REJECTED
}

enum EventType {
  ORDER_CREATED
  ORDER_APPROVED
  ORDER_REJECTED
}

model Company {
  id   String @id @default(uuid()) @map("id")
  name String @map("name")

  createdAt DateTime @default(now()) @map("created_at")

  orders  PaymentOrder[]
  workers Worker[]
  events  Event[]

  @@map("companies")
}

model Worker {
  id    String @id @default(uuid()) @map("id")
  name  String @map("name")

  companyId String  @map("company_id")
  company   Company @relation(fields: [companyId], references: [id])

  events Event[]

  @@map("workers")
}

model PaymentOrder {
  id   String @id @default(uuid()) @map("id")

  companyId   String  @map("company_id")
  company     Company @relation(fields: [companyId], references: [id])
  amountCents Int     @map("amount_cents")
  currency    String  @default("USD") @map("currency")
  status      OrderStatus @default(PENDING) @map("status")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  events Event[]

  @@index([companyId, status, amountCents], map: "payment_orders_company_status_amount_idx")
  @@map("payment_orders")
}

model Event {
  id   String @id @default(uuid()) @map("id")

  orderId String       @map("order_id")
  order   PaymentOrder @relation(fields: [orderId], references: [id])
  workerId String  @map("worker_id")
  worker   Worker  @relation(fields: [workerId], references: [id])
  type    EventType @map("type")
  occurredAt DateTime @map("occurred_at")

  @@index([occurredAt], map: "events_occurred_at_idx")
  @@map("events")
}

// ── Read model (projection) ─────────────────────────────────────────────────
// The tables below are maintained by the write path (see src/projection/) and
// rebuilt by re-derivation (see src/maintenance/). Deliberately no relations
// and no FKs: the projection is disposable and must keep the write path lean.
// The covering dashboard index (with INCLUDE columns) is defined in
// prisma/migrations/20250101000000_init/migration.sql because Prisma cannot
// express INCLUDE columns.

model OperationEntry {
  id          String      @id @map("id")
  orderId     String      @map("order_id")
  companyId   String      @map("company_id")
  orderStatus OrderStatus @map("order_status")
  workerId    String      @map("worker_id")
  workerName  String      @map("worker_name")
  amountCents Int         @map("amount_cents")
  eventType   EventType   @map("event_type")
  occurredAt  DateTime    @map("occurred_at")

  @@index([occurredAt], map: "operation_entries_occurred_at_idx")
  @@map("operation_entries")
}

model CompanyTotals {
  companyId           String   @id @map("company_id")
  ordersCount         Int      @default(0) @map("orders_count")
  pendingAmountCents  BigInt   @default(0) @map("pending_amount_cents")
  approvedAmountCents BigInt   @default(0) @map("approved_amount_cents")
  rejectedAmountCents BigInt   @default(0) @map("rejected_amount_cents")
  updatedAt           DateTime @default(now()) @map("updated_at")

  @@map("company_totals")
}
```

**Migration** — as drafted (I'll ensure no ';' inside comments).

The comment lines — I'll avoid semicolons ✓.

**src/common/errors.ts** — as drafted.

**src/common/all-exceptions.filter.ts**:

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainError } from './errors';

const STATUS_TO_CODE: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'invalid_request',
  [HttpStatus.UNAUTHORIZED]: 'unauthorized',
  [HttpStatus.FORBIDDEN]: 'forbidden',
  [HttpStatus.NOT_FOUND]: 'resource_not_found',
  [HttpStatus.CONFLICT]: 'conflict',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'invalid_request',
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal_error';
    let message = 'An unexpected error occurred';
    let details: Record<string, unknown> = {};

    if (exception instanceof DomainError) {
      ({ status, code, message, details } = exception);
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = STATUS_TO_CODE[status] ?? 'http_error';
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        message = payload;
      } else {
        const body = payload as { message?: unknown; code?: unknown; details?: unknown };
        if (typeof body.message === 'string') message = body.message;
        else if (Array.isArray(body.message)) {
          message = body.message.join('; ');
          details = { issues: body.message };
        }
        if (typeof body.code === 'string') code = body.code;
        if (body.details && typeof body.details === 'object') details = { ...details, ...(body.details as Record<string, unknown>) };
      }
    } else if (exception instanceof Error) {
      this.logger.error(exception.stack);
    } else {
      this.logger.error(String(exception));
    }

    response.status(status).json({ error: { code, message, details } });
  }
}
```

Wait — `({ status, code, message, details } = exception);` — destructuring assignment to existing let variables: I need parentheses ✓ as written. But `details` is declared with `let details: Record<string, unknown> = {}` and the DomainError's details is a Record ✓.

Note: an HttpException with a 409 status but a DomainError? A DomainError isn't an HttpException (I don't extend it) → the first branch ✓. Nest's built-in ForbiddenException etc. → the second branch ✓.

Edge: a DomainError with a status not in the map — the first branch uses its own ✓.

**src/common/prisma.service.ts**:

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

**src/common/prisma.module.ts**:

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

**src/common/order-status.ts** — as drafted.

**src/projection/projection.repository.ts** — as drafted, with the EventType import:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { EventType, OrderStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';

export interface OperationEntryRow {
  id: string;
  orderId: string;
  companyId: string;
  orderStatus: OrderStatus;
  workerId: string;
  workerName: string;
  amountCents: number;
  eventType: EventType;
  occurredAt: Date;
}

export interface TotalsDelta {
  ordersCount: number;
  pendingAmountCents: number;
  approvedAmountCents: number;
  rejectedAmountCents: number;
}

/**
 * The only layer that writes the projection. Every write is a single
 * idempotent statement so that a re-applied event or a re-derivation overlap
 * can never double-count.
 */
@Injectable()
export class ProjectionRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async upsertEntry(tx: Prisma.TransactionClient, entry: OperationEntryRow): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO operation_entries (id, order_id, company_id, order_status, worker_id, worker_name, amount_cents, event_type, occurred_at)
      VALUES (${entry.id}, ${entry.orderId}, ${entry.companyId}, ${entry.orderStatus}, ${entry.workerId}, ${entry.workerName}, ${entry.amountCents}, ${entry.eventType}, ${entry.occurredAt})
      ON CONFLICT (id) DO UPDATE SET
        order_status = EXCLUDED.order_status,
        amount_cents = EXCLUDED.amount_cents,
        worker_name  = EXCLUDED.worker_name,
        event_type   = EXCLUDED.event_type,
        occurred_at  = EXCLUDED.occurred_at`;
  }

  async syncOrderStatus(tx: Prisma.TransactionClient, orderId: string, status: OrderStatus): Promise<void> {
    await tx.$executeRaw`
      UPDATE operation_entries
      SET order_status = ${status}
      WHERE order_id = ${orderId} AND order_status <> ${status}`;
  }

  async adjustTotals(tx: Prisma.TransactionClient, companyId: string, delta: TotalsDelta): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO company_totals (company_id, orders_count, pending_amount_cents, approved_amount_cents, rejected_amount_cents)
      VALUES (${companyId}, ${delta.ordersCount}, ${delta.pendingAmountCents}, ${delta.approvedAmountCents}, ${delta.rejectedAmountCents})
      ON CONFLICT (company_id) DO UPDATE SET
        orders_count          = company_totals.orders_count + EXCLUDED.orders_count,
        pending_amount_cents  = company_totals.pending_amount_cents + EXCLUDED.pending_amount_cents,
        approved_amount_cents = company_totals.approved_amount_cents + EXCLUDED.approved_amount_cents,
        rejected_amount_cents = company_totals.rejected_amount_cents + EXCLUDED.rejected_amount_cents,
        updated_at            = now()`;
  }
}
```

The `$executeRaw` tagged template on `tx` — Prisma's InteractiveTransaction supports $executeRaw ✓.

**src/projection/projection.service.ts** — as drafted. Final:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import type { Event, PaymentOrder, Prisma, Worker } from '@prisma/client';
import { ProjectionRepository } from './projection.repository';
import type { OperationEntryRow, TotalsDelta } from './projection.repository';

interface OrderEventContext {
  order: PaymentOrder;
  event: Event;
  worker: Worker;
}

/**
 * The maintenance hooks. The write services call these inside the very
 * transaction that writes the source rows: the projection commits or rolls
 * back with the write, which is what makes read-your-own-writes hold.
 */
@Injectable()
export class ProjectionService {
  constructor(@Inject(ProjectionRepository) private readonly projection: ProjectionRepository) {}

  async onOrderCreated(tx: Prisma.TransactionClient, ctx: OrderEventContext): Promise<void> {
    await this.projection.upsertEntry(tx, this.entryFor(ctx, ctx.order.status));
    await this.projection.adjustTotals(tx, ctx.order.companyId, this.createdDelta(ctx.order.status, ctx.order.amountCents));
  }

  async onOrderStatusChanged(
    tx: Prisma.TransactionClient,
    ctx: OrderEventContext & { from: OrderStatus; to: OrderStatus },
  ): Promise<void> {
    await this.projection.upsertEntry(tx, this.entryFor(ctx, ctx.to));
    await this.projection.syncOrderStatus(tx, ctx.order.id, ctx.to);
    await this.projection.adjustTotals(
      tx,
      ctx.order.companyId,
      this.transitionDelta(ctx.from, ctx.to, ctx.order.amountCents),
    );
  }

  private entryFor(ctx: OrderEventContext, status: OrderStatus): OperationEntryRow {
    return {
      id: ctx.event.id,
      orderId: ctx.order.id,
      companyId: ctx.order.companyId,
      orderStatus: status,
      workerId: ctx.worker.id,
      workerName: ctx.worker.name,
      amountCents: ctx.order.amountCents,
      eventType: ctx.event.type,
      occurredAt: ctx.event.occurredAt,
    };
  }

  private createdDelta(status: OrderStatus, amountCents: number): TotalsDelta {
    const delta = this.emptyDelta();
    this.addTo(delta, status, amountCents);
    delta.ordersCount += 1;
    return delta;
  }

  private transitionDelta(from: OrderStatus, to: OrderStatus, amountCents: number): TotalsDelta {
    const delta = this.emptyDelta();
    this.addTo(delta, from, -amountCents);
    this.addTo(delta, to, amountCents);
    return delta;
  }

  private emptyDelta(): TotalsDelta {
    return { ordersCount: 0, pendingAmountCents: 0, approvedAmountCents: 0, rejectedAmountCents: 0 };
  }

  private addTo(delta: TotalsDelta, status: OrderStatus, amountCents: number): void {
    switch (status) {
      case OrderStatus.PENDING:
        delta.pendingAmountCents += amountCents;
        break;
      case OrderStatus.APPROVED:
        delta.approvedAmountCents += amountCents;
        break;
      case OrderStatus.REJECTED:
        delta.rejectedAmountCents += amountCents;
        break;
    }
  }
}
```

**src/projection/projection.module.ts** — as drafted.

**src/orders/dto.ts**:

```ts
import { IsInt, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';

export class CreateOrderDto {
  @IsUUID()
  companyId!: string;

  @IsInt()
  @Min(1)
  amountCents!: number;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsUUID()
  workerId!: string;
}

export class TransitionOrderDto {
  @IsUUID()
  workerId!: string;
}
```

**src/orders/orders.repository.ts** — as drafted. Let me finalize with the comment about the hook in the same tx.

**src/orders/orders.service.ts**:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { EventType, OrderStatus } from '@prisma/client';
import { OrderStatusToken, STATUS_TO_TOKEN } from '../common/order-status';
import type { OrderView, TransitionInput } from './orders.repository';
import { OrdersRepository } from './orders.repository';
import { CreateOrderDto, TransitionOrderDto } from './dto';

export interface OrderResponse {
  id: string;
  companyId: string;
  amountCents: number;
  status: OrderStatusToken;
}

const TRANSITIONS: Record<'approve' | 'reject', Pick<TransitionInput, 'from' | 'to' | 'eventType'>> = {
  approve: { from: OrderStatus.PENDING, to: OrderStatus.APPROVED, eventType: EventType.ORDER_APPROVED },
  reject: { from: OrderStatus.PENDING, to: OrderStatus.REJECTED, eventType: EventType.ORDER_REJECTED },
};

@Injectable()
export class OrdersService {
  constructor(@Inject(OrdersRepository) private readonly orders: OrdersRepository) {}

  async create(dto: CreateOrderDto): Promise<OrderResponse> {
    const order = await this.orders.createOrder({
      companyId: dto.companyId,
      amountCents: dto.amountCents,
      currency: dto.currency ?? 'USD',
      workerId: dto.workerId,
    });
    return this.toResponse(order);
  }

  async approve(orderId: string, dto: TransitionOrderDto): Promise<OrderResponse> {
    const order = await this.orders.transitionOrder({ ...TRANSITIONS.approve, orderId, workerId: dto.workerId });
    return this.toResponse(order);
  }

  async reject(orderId: string, dto: TransitionOrderDto): Promise<OrderResponse> {
    const order = await this.orders.transitionOrder({ ...TRANSITIONS.reject, orderId, workerId: dto.workerId });
    return this.toResponse(order);
  }

  private toResponse(order: OrderView): OrderResponse {
    return { id: order.id, companyId: order.companyId, amountCents: order.amountCents, status: STATUS_TO_TOKEN[order.status] };
  }
}
```

**src/orders/orders.controller.ts**:

```ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
```
No need for Get/Res.

```ts
import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto, TransitionOrderDto } from './dto';

@Controller('orders')
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  @Post()
  create(@Body() dto: CreateOrderDto): Promise<OrderResponse> {
    return this.orders.create(dto);
  }

  @Post(':id/approve')
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TransitionOrderDto): Promise<OrderResponse> {
    return this.orders.approve(id, dto);
  }

  @Post(':id/reject')
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TransitionOrderDto): Promise<OrderResponse> {
    return this.orders.reject(id, dto);
  }
}
```
Import OrderResponse type from the service.

**src/orders/orders.module.ts** — as drafted.

**src/dashboard/dto.ts**:

```ts
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { OrderStatusToken } from '../common/order-status';

export const STATUS_FILTERS: readonly OrderStatusToken[] = ['pending', 'approved', 'rejected'];

export class ListOperationsQueryDto {
  @IsUUID()
  companyId!: string;

  @IsIn(STATUS_FILTERS)
  status!: OrderStatusToken;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
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

**src/dashboard/dashboard.repository.ts**:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';

export interface OperationsQuery {
  companyId: string;
  status: OrderStatus;
  from?: Date;
  to?: Date;
  skip: number;
  take: number;
}

/**
 * The dashboard reads only the projection tables. No join back to the
 * source: the covering index on operation_entries makes this a page-sized,
 * index-only scan.
 */
@Injectable()
export class DashboardRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listOperations(query: OperationsQuery): Promise<{ items: OperationEntry[]; total: number }> {
    const where: Prisma.OperationEntryWhereInput = {
      companyId: query.companyId,
      orderStatus: query.status,
      occurredAt: {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lt: query.to } : {}),
      },
    };
    const [total, items] = await Promise.all([
      this.prisma.operationEntry.count({ where }),
      this.prisma.operationEntry.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: query.skip,
        take: query.take,
      }),
    ]);
    return { items, total };
  }

  async getCompanyTotals(companyId: string): Promise<CompanyTotals | null> {
    return this.prisma.companyTotals.findUnique({ where: { companyId } });
  }
}
```
Import types OperationEntry, CompanyTotals from '@prisma/client'.

Hmm — an empty `occurredAt` object `{}` when no bounds — Prisma is fine with an empty filter ✓.

**src/dashboard/dashboard.service.ts**:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { EventType, OrderStatus } from '@prisma/client';
import { TOKEN_TO_STATUS, OrderStatusToken } from '../common/order-status';
import { DashboardRepository } from './dashboard.repository';
import type { CompanyTotals } from '@prisma/client';
import { ListOperationsQueryDto } from './dto';

export interface OperationItem {
  id: string;
  orderId: string;
  status: OrderStatusToken;
  eventType: string;
  workerId: string;
  workerName: string;
  amountCents: number;
  occurredAt: string;
}

export interface CompanyTotalsResponse {
  ordersCount: number;
  pendingAmountCents: string;
  approvedAmountCents: string;
  rejectedAmountCents: string;
}

export interface OperationsPageResponse {
  items: OperationItem[];
  page: number;
  pageSize: number;
  total: number;
  totals: CompanyTotalsResponse;
}

const EVENT_TYPE_TOKENS: Record<EventType, string> = {
  [EventType.ORDER_CREATED]: 'order_created',
  [EventType.ORDER_APPROVED]: 'order_approved',
  [EventType.ORDER_REJECTED]: 'order_rejected',
};

const PAGE_SIZE_DEFAULT = 20;

@Injectable()
export class DashboardService {
  constructor(@Inject(DashboardRepository) private readonly dashboard: DashboardRepository) {}

  async listOperations(dto: ListOperationsQueryDto): Promise<OperationsPageResponse> {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? PAGE_SIZE_DEFAULT;

    const { items, total } = await this.dashboard.listOperations({
      companyId: dto.companyId,
      status: TOKEN_TO_STATUS[dto.status],
      from: dto.from ? new Date(dto.from) : undefined,
      to: dto.to ? new Date(dto.to) : undefined,
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    const totals = await this.dashboard.getCompanyTotals(dto.companyId);

    return {
      items: items.map((entry) => ({
        id: entry.id,
        orderId: entry.orderId,
        status: STATUS_TO_TOKEN[entry.orderStatus],
        eventType: EVENT_TYPE_TOKENS[entry.eventType],
        workerId: entry.workerId,
        workerName: entry.workerName,
        amountCents: entry.amountCents,
        occurredAt: entry.occurredAt.toISOString(),
      })),
      page,
      pageSize,
      total,
      totals: this.totalsResponse(totals),
    };
  }

  private totalsResponse(totals: CompanyTotals | null): CompanyTotalsResponse {
    if (!totals) {
      return { ordersCount: 0, pendingAmountCents: '0', approvedAmountCents: '0', rejectedAmountCents: '0' };
    }
    // BIGINT → string: JSON has no 64-bit integer, and finance needs exactness, not floats.
    return {
      ordersCount: totals.ordersCount,
      pendingAmountCents: totals.pendingAmountCents.toString(),
      approvedAmountCents: totals.approvedAmountCents.toString(),
      rejectedAmountCents: totals.rejectedAmountCents.toString(),
    };
  }
}
```
I also need to import STATUS_TO_TOKEN.

The OrderStatus import may be unused — I'll remove it (noUnusedLocals? I didn't enable it — but I'll keep it clean anyway).

**src/dashboard/dashboard.module.ts** — as drafted.

**src/maintenance/maintenance.repository.ts** — as drafted, with the utcWallClock helper (a local function).

**src/maintenance/maintenance.service.ts**:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { MaintenanceRepository } from './maintenance.repository';
import type { DriftReport } from './maintenance.repository';

export interface DriftRepairResult extends DriftReport {
  from: Date;
  to: Date;
  repaired: boolean;
  entriesReinserted: number;
}

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(@Inject(MaintenanceRepository) private readonly maintenance: MaintenanceRepository) {}

  /**
   * Rebuild the projection for [from, to) from the source tables. Idempotent
   * and safe while live (see DESIGN.md) — the routine that makes the
   * projection recoverable.
   */
  async rederiveWindow(from: Date, to: Date): Promise<{ entriesReinserted: number }> {
    return this.maintenance.rederiveWindow(from, to);
  }

  /**
   * One pass of the scheduled drift repair: diff the projection against the
   * source for a recent window and, on disagreement, re-derive that window.
   */
  async repairDrift(lookbackMs: number): Promise<DriftRepairResult> {
    const to = new Date();
    const from = new Date(to.getTime() - lookbackMs);
    const drift = await this.maintenance.detectDrift(from, to);
    const driftedEntries = drift.entries.missing + drift.entries.extra + drift.entries.stale;
    const repaired = driftedEntries > 0 || drift.totals.length > 0;

    let entriesReinserted = 0;
    if (repaired) {
      const rebuilt = await this.maintenance.rederiveWindow(from, to);
      entriesReinserted = rebuilt.entriesReinserted;
    }

    this.logger.log(
      `drift repair [${from.toISOString()} .. ${to.toISOString()}]: ` +
        `entries missing=${drift.entries.missing} extra=${drift.entries.extra} stale=${drift.entries.stale}, ` +
        `totals drifted=${drift.totals.length}, repaired=${repaired}, entriesReinserted=${entriesReinserted}`,
    );
    return { from, to, ...drift, repaired, entriesReinserted };
  }
}
```

**src/maintenance/drift-repair.job.ts**:

```ts
import { Cron, CronExpression } from '@nestjs/schedule';
import { Inject, Injectable } from '@nestjs/common';
import { MaintenanceService } from './maintenance.service';
import type { DriftRepairResult } from './maintenance.service';

/**
 * The interval is short on purpose; the lookback (default 2h) overlaps many
 * intervals, so a missed or crashed run is covered by the next one.
 */
const DEFAULT_LOOKBACK_MINUTES = 120;

@Injectable()
export class DriftRepairJob {
  constructor(@Inject(MaintenanceService) private readonly maintenance: MaintenanceService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run(): Promise<DriftRepairResult> {
    const lookbackMinutes = Number(process.env.DRIFT_REPAIR_LOOKBACK_MINUTES ?? DEFAULT_LOOKBACK_MINUTES);
    return this.maintenance.repairDrift(lookbackMinutes * 60_000);
  }
}
```

**src/maintenance/maintenance.module.ts** — as drafted.

**src/app.module.ts**, **src/main.ts** — as drafted.

**test/helpers.ts** — as drafted. Also an `operations()` helper? The tests use supertest directly. Add a small helper:

```ts
export function getOperations(app: INestApplication, params: Record<string, string>) {
  return request(app.getHttpServer()).get('/operations').query(params);
}
```
Maybe skip; the direct calls are fine. I'll keep helpers minimal: resetDatabase, buildApp, seedCompany, prisma.

**test/read-your-own-writes.spec.ts** — final (fixing the counts):

Scenario:
1. RW Co: create order 12000.
   - Pending page: total 1, item {order_created, pending, 12
```

## reply

(empty)
