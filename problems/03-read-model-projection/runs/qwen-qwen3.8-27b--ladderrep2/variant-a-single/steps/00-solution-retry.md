# solution-retry

## reasoning

```
Let me think carefully about this task.

The task is to build a read model projection for a marketplace operations dashboard:
- Projection table + DDL with indexes
- A maintenance hook that the write service invokes (inside a transaction)
- A re-derivation routine for an arbitrary date window
- A periodic drift repair job
- A new dashboard query (reads only the projection)
- Tests: read-your-own-writes, concurrent updates to a single company's total, drift repair
- DESIGN.md justifying the synchronous hook

Stack: TypeScript strict, NestJS, Prisma, PostgreSQL, Vitest, pnpm, ESM.

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

Layers: controller validates input and calls the service. Service holds the logic. Repository is the only layer that touches the database (Prisma client calls only in the repository).

Naming: tables and columns are snake_case via `@map`/`@@map`. Endpoints are kebab-case plural. TS files are kebab-case. Classes are PascalCase.

Errors: one envelope `{ error: { code, message, details } }`.

Wiring: providers in a module, exports for cross-module.

Migrations: every schema change ships with a migration.

Tests: Vitest. Test behavior. No assertion-free tests. No happy-path-only tests.

Now, since there's no existing codebase (files above are just the task spec), I need to build everything from scratch, including `prisma/schema.prisma`, `src/main.ts`, `src/app.module.ts`, features, `test/*.spec.ts`, migrations, DESIGN.md.

Wait — "if the above files are the task, they are an existing codebase." The above files are variant-a.md and L2-spec.md, which are reference specs, not code. So I have to create the whole repository.

Let me design the domain:

**Source tables** (what the dashboard joins):
- `payment_orders` — an order: id, company_id, worker_id?, status, amount, created_at, updated_at, approved_at?
- `events` — order events: id, order_id, type, created_at
- `workers` — worker profile: id, name, company_id?

The dashboard "joins payment orders, events, and workers" — the join probably pulls in worker name (who handled the order) and the latest event (e.g. last event type). Let me define:

- `PaymentOrder`: id (uuid or bigint), company_id (int/uuid), worker_id (int), status (enum: pending, approved, rejected, refunded), amount (int cents or numeric), created_at, updated_at.
- `Worker`: id, name, company_id (worker belongs to a company).
- `OrderEvent`: id, order_id, kind (e.g. created, approved, rejected, refunded), payload?/note, created_at.

The dashboard query: list operations = order + worker name + latest event kind + amount, filtered by company (required?), status (optional, multiple?), date range (created_at between from and to), sorted by recency (created_at desc, or updated_at desc — "recency" — probably created_at desc; let's use created_at desc with id as tiebreaker for stable pagination), paginated (page + page_size or cursor). The spec says "same page size", "sorted by recency" — page-based (offset) is simplest and matches "paginated" with "page size". Let's use `page` and `pageSize`.

Projection table:

`ops_projection` (snake_case: `operations_view`? Let's name it `operations_read_model`, or `ops_row`). Columns to match the query:
- order_id (pk)
- company_id
- worker_id
- worker_name (denormalized from workers)
- status
- amount_cents (int)
- last_event_kind (from latest event)
- created_at
- updated_at (row version / last maintenance timestamp)
- version (int, monotonically incremented to make re-derivation/drift detection deterministic)

Plus a per-company financial totals table (the "total per company must be accurate" constraint):

`company_totals`:
- company_id (pk)
- pending_amount, pending_count
- approved_amount, approved_count
- rejected_amount, rejected_count
- refunded_amount, refunded_count
- version (int)
- updated_at

Concurrent updates: use `SET approved_amount = approved_amount + $1` inside a transaction with `SELECT ... FOR UPDATE`, or simply the atomic `UPDATE ... SET col = col + x` (the database serializes row locks). The spec says "make the update atomic in the database — an in-place increment or a held lock." Atomic increment is simplest and exact. In the test, run two concurrent approvals for the same company and assert the total.

Maintenance hook: the write service calls `OperationsProjectionService.applyXxx(orderId)` inside the same Prisma `$transaction`. The hook recomputes the row for that order (re-reading the order and worker and last event inside the transaction, upserting the projection row, adjusting the total delta).

Wait — for the total, when a status changes from old→new, we need to subtract the old contribution and add the new one. If we compute the delta from the source row inside the same transaction, that's accurate. But watch out for concurrency: two concurrent transactions both read the old status? Scenario: two different orders, same company, both approved simultaneously. Each transaction reads its own order (different row), computes the delta (approved += amount), and runs `UPDATE company_totals SET approved_amount = approved_amount + delta` — the atomic increment serializes at the row level and both are applied. Exact.

For a single order whose status changes (pending → approved), the delta: pending -= amount, approved += amount. If two transactions concurrently modify the same order (e.g. approve + reject race), each reads the old status… they read different rows (their own writes) but the same totals row. Each does an atomic increment. But the projection row for the order: each upserts the full row (last-write-wins by commit order). The totals: transaction A reads order status=pending, sets approved, computes delta pending-1/approved+1; transaction B reads the same pending (before A commits), sets rejected, computes delta pending-1/rejected+1. Both apply: pending-2, approved+1, rejected+1 — but the final status is one or the other. Totals drift! This is an edge case (concurrent conflicting writes to the same order). To be safe, the hook should `SELECT ... FOR UPDATE` the order row inside the transaction — that serializes writes to the same order. But the write service itself updates the order; inside the write service's transaction, locking the order row first serializes concurrent writes to the same order. The concurrent updates that the spec cares about are "two orders approved simultaneously for the same company" — different orders, same company. Atomic increment handles that. For safety, the maintenance hook does a `SELECT ... FOR UPDATE` of the order row to serialize writes to the same order (also protecting the delta computation against the old status). Let me implement the hook this way:

```
$transaction(async (tx) => {
  // 1. Update source (order status, insert event, maybe update worker name)
  // 2. Lock order row: SELECT * FROM payment_orders WHERE id = ? FOR UPDATE
  // 3. Upsert projection row (recompute from source: order + worker name + last event)
  // 4. Atomic increment of company_totals delta
  // 5. Increment totals version
})
```

But wait — layering: the repository is the only layer that touches the DB. So `prisma.$transaction` is in the repository. The write service (order) calls its own repository method, which runs the transaction, and inside that calls the projection repository's apply methods? The spec says "the maintenance hook is invoked by the write service (simulates the write path)." So the write service calls the projection service (the hook) — but both must be inside the same transaction. If the projection service receives a transaction client… In NestJS, dependency injection with a transaction client is awkward. Options:

1. The order service calls `this.ordersRepo.approveOrder(id)`, which internally (in the repository layer) runs `$transaction` and calls the projection repository's method with the transaction client. But the spec says "the maintenance hook is invoked by the write service" — the service level. Hmm.

2. The service takes a PrismaClient and passes `tx` down? The layering says the service has "zero Prisma client calls". Passing a tx client to the repository isn't a Prisma call in the service; the repository does `prisma.$transaction(async tx => { this.projectionRepo.applyForOrder(tx, ...) })`? But then it's the repository that invokes the hook, not the service.

3. The projection service exposes `maintainForOrder(id, prisma: Prisma.TransactionClient)` — the service takes a client and calls the projection repository. But the write service can't call `$transaction` itself (zero Prisma calls in the service).

Cleanest way that respects the stated constraint and the "hook invoked by the write service" rule: the write service calls two things inside a single repository-managed transaction? No — the service can't open a transaction.

Alternative: the order repository exposes `withTransaction(fn: (tx) => Promise<void>)`? Still, the service is orchestrating…

Let me re-read: "the maintenance hook is invoked by the write service (simulates the write path)." And the L2 spec: "the maintenance hook is invoked by the write service and runs **inside the transaction that writes the source row**."

A workable pattern under the layers: the write service injects both `OrdersRepository` and `OperationsProjectionService` (the hook). The write service's method:

```ts
await this.ordersRepository.approveInTransaction(orderId, (tx) =>
  this.projectionService.applyOrderChanged(tx, orderId)
);
```

Hmm, this puts orchestration in the repository (a "withTransaction" helper). The repository owns the transaction and exposes `runInTransaction`. The service passes a callback that calls the projection service with the tx. The projection service calls `this.projectionRepository.applyOrderChanged(tx, orderId)`. The repository's methods take an optional `tx` (PrismaTransactionClient) and default to `this.prisma`. This is a standard pattern (passing the transaction client through). The service makes zero Prisma calls — it just calls repository/service methods. `runInTransaction` is defined in the repository as `return this.prisma.$transaction(fn, { isolationLevel: 'Serializable' })` — hmm, what isolation level?

For exactness of the total, the atomic increment makes isolation level irrelevant (each transaction's increment is atomic; under READ COMMITTED, concurrent increments both apply — that's exactly what we want: neither is lost). For the delta against the old status of the same order, we take a row lock (`FOR UPDATE`) on the order row, which serializes modifications to the same order regardless of isolation level. So READ COMMITTED (the default) is enough and fastest. Use the default (omit isolationLevel). Actually, let me think: does the total increment need a lock? No — `UPDATE ... SET x = x + d` is row-level atomic; Postgres applies both increments.

But there's a subtlety with the totals row: if the totals row doesn't yet exist, we must upsert. `INSERT ... ON CONFLICT (company_id) DO UPDATE SET pending_amount = company_totals.pending_amount + EXCLUDED...` — hmm, computing the delta: use the same upsert that atomically increments with the delta. Prisma has `upsert` but with read-modify-write it's not atomic (Prisma's upsert internally does a SELECT then UPDATE? Actually Prisma's upsert under `DO UPDATE` is a single SQL statement — it generates `INSERT ... ON CONFLICT DO UPDATE SET col = ...` and the values are… let me recall: Prisma's upsert generates `INSERT INTO ... ON CONFLICT DO UPDATE SET` where the update values are the supplied literal values, not `col + value`. So `approvedAmount: { increment: 5 }` — does Prisma support `increment` in an upsert's update? Hmm. Prisma supports field operators like `increment` in `update`, and I think in `upsert` too (update: { approvedAmount: { increment: 1 } }). Yes — Prisma's `upsert` accepts the same update arguments including atomic operators (increment, decrement). This generates `ON CONFLICT DO UPDATE SET "approved_count" = "company_totals"."approved_count" + 1`. That's atomic.

But to be safe and explicit (and because the spec says "in-place increment"), let's write the totals update in the repository using `$executeRaw` with raw SQL:

```sql
INSERT INTO company_totals (company_id, pending_count, pending_amount, updated_at, version)
VALUES ($1, ..., now(), 1)
ON CONFLICT (company_id) DO UPDATE
SET pending_amount = company_totals.pending_amount + EXCLUDED.pending_amount - company_totals.pending_amount ...
```

Hmm, that's convoluted. Simpler: the delta has four (count, amount) pairs per status. Raw SQL:

```sql
INSERT INTO company_totals AS ct (company_id, version, updated_at)
VALUES ($1, 1, now())
ON CONFLICT (company_id) DO UPDATE SET
  pending_count    = ct.pending_count + ($2::bigint),
  pending_amount   = ct.pending_amount + ($3::bigint),
  approved_count   = ct.approved_count + ($4::bigint),
  approved_amount  = ct.approved_amount + ($5::bigint),
  rejected_count   = ct.rejected_count + ($6::bigint),
  rejected_amount  = ct.rejected_amount + ($7::bigint),
  refunded_count   = ct.refunded_count + ($8::bigint),
  refunded_amount  = ct.refunded_amount + ($9::bigint),
  version          = ct.version + 1,
  updated_at       = now();
```

On the INSERT side, the delta has to be in the inserted row's values. So: `INSERT (company_id, pending_count, pending_amount, approved_count, approved_amount, rejected_count, rejected_amount, refunded_count, refunded_amount, version, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, now()) ON CONFLICT ... DO UPDATE SET pending_count = ct.pending_count + $2, ...`. On conflict, EXCLUDED holds the inserted values, which equal the delta; we can use the parameter again or EXCLUDED. Using EXCLUDED is cleaner: `ct.pending_count + EXCLUDED.pending_count`.

Wait, but is raw SQL allowed? "The repository is the only layer that touches the database" — raw SQL is fine as long as it's in the repository. The service must have "zero raw SQL, zero Prisma client calls" — no problem, it's in the repository.

Actually, can I do it in Prisma without raw SQL? `tx.companyTotals.upsert({ where: { companyId }, create: { companyId, ...deltas, version: 1 }, update: { pendingCount: { increment: d2 }, ... version: { increment: 1 } } })`. I'm fairly confident Prisma supports increment in an upsert's update. But for the concurrent-total test, I want the exactness to come from the database, not from Prisma's query shape. Raw SQL makes the mechanism explicit and self-documenting. The spec says "make the update atomic in the database — an in-place increment or a held lock." I'll use raw SQL with `$executeRaw` with an in-place increment. It's defensible and explicit. I'll keep it in the repository.

Hmm, but strict Prisma typing with raw SQL: `$executeRaw` accepts tagged templates or `Prisma.sql` / `$executeRaw(sql, ...values)`. No problem.

**Projection row upsert**: recompute from the source inside the tx:
- The order row (already locked with FOR UPDATE — actually the write service itself updates the order; the hook re-reads it)
- The worker's name (JOIN)
- The last event kind: `SELECT kind, created_at FROM order_events WHERE order_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`

Then `INSERT INTO operations_read_model ... ON CONFLICT (order_id) DO UPDATE SET ...`. The upsert is idempotent, so re-derivation and the hook share code paths.

Include `source_version`/`updated_at`? For drift detection, the drift repair compares the projection against the source: for each order in the window, recompute expected status/amount/worker/last event and compare to the projection row; repair the mismatches (re-run the upsert and fix the total?). Drift in the total: compare the per-company totals in the window against recomputation? Simpler, more robust drift repair: for a recent window [now - N days, now], recompute the expected state of each order from the source (order row, worker, last event), and for each order: upsert the projection row (idempotent re-derivation for that order), then fix the total by full recomputation? Full recomputation of the total per company inside the window is possible with GROUP BY:

```sql
SELECT company_id, status, count(*), sum(amount) FROM payment_orders WHERE created_at >= $1 GROUP BY 1,2
```

Then for each company in the window, recompute the total from scratch? No — the total is the company-wide total, not just for the window. The window is just the scope to detect drift in. The repair: (1) for all orders in the window, recompute and reapply the projection row and total delta from zero: i.e. zero out the contributions for the window's orders and reapply. That's complex. Simpler: drift repair = for each company that has orders in the window, recompute the total for that company from scratch (GROUP BY status over the whole company), and replace the totals row; and for each order in the window, reapply the projection row. Both are idempotent and converge to the source truth. "Compare and repair the mismatches" — the job detects the mismatch (compares the projection row against the expected value; compares the total against the recomputed value), reports the count, and repairs. Let me implement it:

`DriftRepairService.run(windowDays)`:
1. Get orders in the window (id, company_id, status, amount, created_at).
2. For each, compute expected projection values (status, amount, worker_name, last_event_kind) and compare to the stored projection row; collect drift order ids.
3. For companies with drifted orders… actually simpler: repair = re-derive all orders in the window (call the same re-derivation routine for the window). And fix the total: recompute per-company totals from scratch for companies that have drifted orders (or all companies in the window), replacing the totals row atomically.
4. Return the drift stats (drifted orders, repaired companies).

The scheduled job: a NestJS provider with `@Cron` from `@nestjs/schedule`? That adds a dependency. Or use a simple `setInterval` in a service that implements `OnModuleInit`. To keep dependencies light, I'll implement a `DriftRepairJob` service with `@Injectable()` that implements `OnApplicationBootstrap` and uses `setInterval` with a period from an env var (`DRIFT_REPAIR_INTERVAL_MS`), guarded by a flag env var (`DRIFT_REPAIR_ENABLED`)? The task says "a scheduled drift repair job." `@nestjs/schedule` is the idiomatic way. But pnpm deps — I can list them in the reply; the user's environment handles installation. I'll use `@nestjs/schedule`'s `Cron` decorator with a cron expression from env var (`DRIFT_REPAIR_CRON`, default `*/5 * * * *`). Hmm, env var: "configuration comes only from environment variables." The cron expression from env var with a default is fine.

Actually, let me reduce risk: `@nestjs/schedule`'s `Cron` decorator requires registering `ScheduleModule.forRoot()`. That's standard. I'll include it.

**Re-derivation routine**: `ReprojectionService.rederive(from: Date, to: Date)` — safe to run while the system is live (per-order upsert is idempotent; no long locks; batches by order id), and idempotent (run twice → same result). Implementation:
- SELECT orders in [from, to) with id, company_id, status, amount, created_at — batched by id range (e.g. 500 at a time, `WHERE id > $cursor AND created_at >= ... ORDER BY id LIMIT 500`). Hmm, ordering by id while filtering by created_at — no problem.
- For each batch, in a transaction: for each order, upsert the projection row (recomputed with worker name and last event), and fix the total? Recomputing the total in re-derivation: the cleanest, most exact approach = for companies affected in the window, recompute the total from scratch: `SELECT company_id, status, COUNT(*), SUM(amount) FROM payment_orders GROUP BY company_id, status`, then `INSERT ... ON CONFLICT DO UPDATE SET <absolute values>` (absolute values, not deltas). This is idempotent and exact. Run it per batch of affected companies (dedup) at the end, or incrementally. To make "run twice → same result" obvious, use the full per-company recomputation (absolute value upsert).

Wait, but if we mix delta-based maintenance (hook) with absolute-value recomputation (re-derivation), does the total stay exact? Yes: the re-derivation overwrites the totals row with the source truth; subsequent hooks apply the delta from the correct base. There's a window where concurrent hook deltas interleave with the re-derivation replacement — the replacement is a single-row atomic statement; a hook delta that reads the old status before the replacement and applies after → drift until the next repair. That's acceptable (that's why the drift job exists), and re-derivation is a maintenance operation. But the acceptance criterion is "re-derive the window → projection matches source" — with the system live, a concurrent write during re-derivation could land between the order snapshot and the total recompute… For the acceptance test, we'll run it quiescently. Fine.

Actually, a simpler and more consistent design: the re-derivation routine does both:
1. For orders in the window: upsert projection rows from source.
2. For affected companies: recompute and replace total rows from source (absolute values).
Both idempotent. Good.

**Drift repair** uses the same primitive as the re-derivation but with a "recent window" (now - X days) and first reports the mismatches. Implementation: `DriftRepairService.run()` computes the window, calls the comparison (a count of rows that disagree + a count of totals that disagree), then calls `reprojectionService.rederive(from, to)` for the repair. Return stats. This cleanly satisfies "compare projection to source over the recent window and repair the mismatches."

Comparison query for drift detection (raw SQL, in the repository):

```sql
WITH expected AS (
  SELECT po.id AS order_id, po.company_id, po.status, po.amount_cents,
         w.name AS worker_name,
         (SELECT oe.kind FROM order_events oe WHERE oe.order_id = po.id
           ORDER BY oe.created_at DESC, oe.id DESC LIMIT 1) AS last_event_kind,
         po.created_at
  FROM payment_orders po LEFT JOIN workers w ON w.id = po.worker_id
  WHERE po.created_at >= $1 AND po.created_at < $2
)
SELECT count(*) FROM expected e
LEFT JOIN operations_read_model r ON r.order_id = e.order_id
WHERE r.order_id IS NULL
   OR r.status <> e.status
   OR r.amount_cents <> e.amount_cents
   OR COALESCE(r.worker_name,'') <> COALESCE(e.worker_name,'')
   OR COALESCE(r.last_event_kind,'') <> COALESCE(e.last_event_kind,'')
   OR r.created_at <> e.created_at;
```

And missing rows are counted via `r.order_id IS NULL`. Also companies whose total drifts: compare company_totals against per-company GROUP BY. I can do a second query. Fine — I'll keep the drift report as `{ windowFrom, windowTo, driftedOrders, driftedCompanies, repaired: true }`.

**Dashboard query**: `GET /operations?companyId=&status=&from=&to=&page=&pageSize=`. Hmm — "filter by company" — is companyId required or optional? The dashboard "lists operations filtered by company, status, and date range." Make companyId optional (default: all)? The projection index should match the "filter by company and status, sorted by recency, paginated" access pattern. Index: `(company_id, status, created_at DESC, id DESC)` INCLUDE (worker_name, worker_id, amount_cents, last_event_kind) — a covering index. When companyId isn't provided, the index's leading column is useless; but the spec says the access pattern includes a company filter. Let me make companyId required (the back-office dashboard is always scoped to a company — "financial total per company" suggests company scoping). Required companyId → the index is always effective. Also an index on `(created_at DESC, id DESC)` for the drift/derive window scans? The re-derivation scans by created_at range — index `(created_at)` on payment_orders. And order_events has index `(order_id, created_at DESC, id DESC)` for the last-event lookup. payment_orders has `@@index([company_id, status, created_at])` for the dashboard fallback and `@@index([created_at])` for the window.

Pagination: `page` (1-based) and `pageSize` (default 20, max 100). The query:

```sql
SELECT order_id, company_id, worker_id, worker_name, status, amount_cents, last_event_kind, created_at
FROM operations_read_model
WHERE company_id = $1 AND ($2::text[] IS NULL OR status = ANY($2)) AND created_at >= $3 AND created_at < $4
ORDER BY created_at DESC, order_id DESC
LIMIT $5 OFFSET $6;
```

status filter: single or multiple? The spec says "filter by company, status, and date range" — I'll accept `status` as a comma-separated list (or repeated param). Keep it simple: repeat `?status=approved&status=refunded` (NestJS string[]). Or comma. Let's use a repeatable query param; NestJS's `@Query('status') status?: string[]`. Validation: must be a known status.

Also "operators must see their own writes immediately" — the projection is updated in the same transaction, so the next request (committed) reflects it. Note: read-your-own-writes in a real system might be the same session; here, after commit, the next request reflects it — that's exactly what the acceptance criterion says: "approve the order → next dashboard request reflects it, no delay."

**Endpoints** (kebab-case plural):
- `GET /operations` — dashboard list (paginated).
- Write path (simulated): `POST /payment-orders/:id/approve`? The spec says "simulates the write path so this is testable." So we expose the write service via an endpoint: `POST /payment-orders/{id}/approve`, `POST /payment-orders/{id}/reject`, and maybe `POST /payment-orders` (create). The maintenance hook is called from these write services. I'll implement the orders feature: `create` (status pending), `approve`, `reject`, and `refund`? Statuses: pending, approved, rejected, refunded. Refund only from approved (typical). Keep transitions: pending→approved, pending→rejected, approved→refunded. Invalid transition → 409 with error envelope.

Hmm wait, the naming convention says endpoints are kebab-case plural: `/payment-orders`. Actions as POST on the resource: `POST /payment-orders/:id/approve` — is that "kebab-case plural"? The resource path is kebab plural; the action suffix is fine.

Also an endpoint for the total? The dashboard is "a list of operations … per-company financial total must be exact" — the total is part of the dashboard payload? "Operators see their own writes" and the financial total is what finance reconciles. Let me include a `GET /companies/:id/totals` endpoint that reads `company_totals` (projection-only). Or include the total in the dashboard response. The spec's "same column" constraint refers to the list. Let me make a separate endpoint `GET /company-totals/:companyId`? The plural-kebab convention → `/company-totals`. Hmm, `GET /company-totals?companyId=`? Simpler: `GET /company-totals/:companyId`. That works.

Wait, actually should the list's response include the total? The original dashboard was "a list of operations (a join of payment orders, events, workers) filtered by …". The financial total is a separate requirement (finance reconciles). A separate endpoint keeps "no change to what the operator sees" on the list. Let's go with a separate endpoint.

**Features and modules**:
- `src/main.ts` — bootstrap.
- `src/app.module.ts` — imports PrismaModule, OperationsModule, PaymentOrdersModule, DriftRepairModule, maybe ScheduleModule.
- `src/prisma/prisma.module.ts` + `prisma.service.ts` — a standard global Prisma provider. The convention lists `src/<feature>/<feature>.*` but Prisma needs a home; the standard NestJS Prisma pattern is `src/prisma/prisma.module.ts` (Global). Add it.
- `src/payment-orders/payment-orders.*` — write path (controller/service/repository/module).
- `src/operations/operations.*` — the dashboard read + the projection maintenance hook + re-derivation? The projection is an operations read model. `OperationsProjectionService` (the hook), `OperationsService` (the dashboard query + totals), `OperationsRepository` (all projection SQL), `ReprojectionService`? Maybe fold re-derivation into the operations feature: `src/operations/reprojection.service.ts`? The convention shows one controller/service/repository per feature, but additional service files are fine (`<feature>.service.ts` is the named one; extras like `drift-repair.job.ts` are OK). Let me structure:

  - `src/operations/operations.module.ts` — provides OperationsController, OperationsService, OperationsRepository, ProjectionMaintenanceService, ReprojectionService, DriftRepairJob; exports ProjectionMaintenanceService (imported by payment-orders module).
  - `src/payment-orders/payment-orders.module.ts` — imports OperationsModule (for the maintenance service); providers: PaymentOrdersController, PaymentOrdersService, PaymentOrdersRepository.
  - `src/drift-repair/drift-repair.job.ts` — the scheduled job; imports the ReprojectionService via OperationsModule. Or put the job in the operations module. The layout convention is feature-based; I'll make `src/drift-repair/drift-repair.module.ts` that imports OperationsModule and provides `DriftRepairJob`. Cleaner: a job that "compares and repairs" is itself a feature. Hmm, but it only needs the re-derivation service. Either works. Let's do `src/drift-repair/`.

Actually, simpler wiring: the OperationsModule exports `ProjectionMaintenanceService` and `ReprojectionService`. PaymentOrdersModule imports OperationsModule. DriftRepairModule imports OperationsModule and provides the job (cron). AppModule imports all + PrismaModule (global) + ScheduleModule.forRoot().

**Error envelope**: a global exception filter `src/common/error-envelope.filter.ts`? The convention doesn't forbid common files. Error codes: `resource_not_found`, `invalid_transition`, `validation_error`, `unprocessable`? Keep: `resource_not_found` (order not found), `invalid_state_transition`, `validation_failed` (bad query param/status). Controller validates input (parse and throw BadRequestException with the details) — but the envelope requires a custom shape; NestJS default exceptions produce `{ statusCode, message }`. A global `ExceptionFilter` that maps any exception to the envelope: `HttpException` with a code? Approach: define an `ApiError extends Error` with `code` and `details` and `statusCode`; a filter catches `ApiError` and any `HttpException` (mapping 404 → resource_not_found, 400 → validation_failed, 409 → conflict_code from exception), and unknown → `internal_error`. The service throws `ApiError` (e.g. not found, invalid transition), and the controller throws `ApiError('validation_failed', ...)` for input validation. The filter ensures the envelope. That satisfies "one envelope."

**Prisma schema**:

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

model PaymentOrder {
  id           Int        @id @default(autoincrement()) @map("id")
  companyId    Int        @map("company_id")
  workerId     Int        @map("worker_id")
  status       String     @default("pending") @map("status")
  amountCents  Int        @map("amount_cents")
  createdAt    DateTime   @default(now()) @map("created_at")
  updatedAt    DateTime   @updatedAt @map("updated_at")
  events       OrderEvent[]
  @@index([["created_at"], [Prisma.SortOrder.Desc]])? 
  @@map("payment_orders")
}
```

Hmm, Int vs BigInt for 3M orders — Int is fine (2.1B). UUID vs Int: Int autoincrement is fine.

Status as a Prisma enum? An enum adds a Postgres enum type; raw SQL is a bit awkward but OK. Let's use String with a TS union type + validation. Simpler for raw SQL. Use `String` mapped and validate in TS.

`Worker { id Int @id, name String @map("name"), companyId Int @map("company_id") }`.

`OrderEvent { id Int @id, orderId Int @map("order_id"), kind String @map("kind"), note String? @map("note"), createdAt DateTime @default(now()) @map("created_at"), order PaymentOrder @relation(...) }` with `@@index([orderId, createdAt, id])` for last-event lookup.

`OperationRow` (the projection):
```prisma
model OperationRow {
  orderId        Int      @id @map("order_id")
  companyId      Int      @map("company_id")
  workerId       Int?     @map("worker_id")
  workerName     String?  @map("worker_name")
  status         String   @map("status")
  amountCents    Int      @map("amount_cents")
  lastEventKind  String?  @map("last_event_kind")
  createdAt      DateTime @map("created_at")
  maintainedAt   DateTime @default(now()) @map("maintained_at")
  @@index([["company_id"], [status...]])? 
```
Covering index: `@@index([companyId, status, createdAt(sort: Desc), orderId(sort: Desc)], ...)` — Prisma doesn't support INCLUDE columns. The covering index needs raw SQL in a migration. Prisma can't express `CREATE INDEX ... INCLUDE`. So: define the primary access index in a migration SQL (migrations are SQL files — I can write the covering index directly in the migration SQL and not in the schema… but "every schema change ships with a migration" and the schema is the source of truth. Mixing: Prisma-managed index in the schema + an additional raw covering index in a custom migration SQL file. That's legitimate: a migration can include hand-written SQL. But then the schema and migration diverge (the index isn't in the schema) — Prisma's drift detection (migrate dev) might complain, but for this deliverable it's fine. Alternatively, keep the index in the schema as a plain (non-covering) multi-column index — a b-tree index on (company_id, status, created_at DESC, id DESC) will be used for filter + sort; the table has few columns, so the heap fetch is cheap; "covering" is a bonus. The spec says "a covering index that matches the filter and the sort is the very point of doing this" — it explicitly calls for covering. Let me ship both: in the schema a `@@index([companyId, status, createdAt(sort Desc), orderId(sort Desc)])` (which Prisma will manage and which alone satisfies filter + sort), plus in the migration an `CREATE INDEX IF NOT EXISTS ... INCLUDE (worker_id, worker_name, amount_cents, last_event_kind)` — wait, if I define both, they're two similar indexes. Better: don't declare that index in the schema; create it (with INCLUDE) in the migration, and comment in the schema that it's managed by the migration. Hmm, "every schema change ships with a migration" — the schema is the model; the additional index is in the migration. I think the cleanest deliverable is:

- The schema has the covering-equivalent index declared (so `prisma db pull`/migrate is consistent) — but INCLUDE isn't expressible.

Decision: write the migration SQL manually (I'll provide a full `prisma/migrations/0001_init/migration.sql` that creates all tables + indexes, including the covering index with INCLUDE). The schema declares the tables and the non-covering parts? If the schema's declared indexes don't match the migration SQL, `prisma migrate dev` will generate diffs in the future. In this exercise, I'll write the migration to match the schema's indexes plus the INCLUDE covering index, and note in a comment that the covering index is applied by the migration (Prisma can't express INCLUDE). To avoid confusion, don't declare the company/status/created index in the schema at all; declare it with INCLUDE in the migration SQL. But then the schema has no index for the hot path, and someone running `prisma migrate dev` fresh (from an empty DB, using the schema) will… generate their own migration from the schema (with no index) and my hand-written migration becomes "already applied"? Messy.

Practical answer for the evaluation: provide `prisma/schema.prisma` (with all models, sensible `@@index` where Prisma can express it, with a comment noting the covering index is in the migration), and a `prisma/migrations/20240101000000_init/migration.sql` that contains the full DDL: tables, all indexes, and the covering INCLUDE index. That is the deliverable "projection table and DDL with appropriate indexes." The DDL is explicit and reviewable. Note in the migration: covering index for the dashboard access pattern.

Let me write the migration SQL fully (CREATE TABLE etc.), matching the schema's field names. It's a bit of duplication but it's the actual deliverable ("DDL with appropriate indexes"). Good.

**Indexes summary**:
- `payment_orders`: PK id; `@@index([created_at])` (window scan for derive/repair); maybe `@@index([companyId, status, created_at])` for source-side queries (recomputation of totals uses full-scan GROUP BY over company — an index on company_id helps per-company recomputation: `@@index([companyId])`). Keep: `@@index([companyId])`, `@@index([createdAt])`.
- `order_events`: `@@index([orderId, createdAt(sort Desc), Id(sort Desc)])`? Prisma can't do descending in index… Prisma 5 supports `@@index([orderId, [createdAt(sort: Desc)]])`. Yes, Prisma supports sort order in indexes (since 4.8? `@index([a, [b(sort: Desc)]])` — hmm, syntax: `@@index([orderId, [createdAt(sort: SortOrder.Desc), id(sort: SortOrder.Desc)]])`? I recall Prisma supports `[field(sort: Desc)]` inside an index. Yes, Prisma supports descending indexes: `@@index([userId, [createdAt(sort: Desc)]])`. I'll use that. And a `createdAt` index on events for the window? Not needed.
- `workers`: PK; maybe `@@index([companyId])`.
- `operations_read_model`: covering index via migration SQL:
```sql
CREATE INDEX idx_operations_read_model_dashboard
  ON operations_read_model (company_id, status, created_at DESC, order_id DESC)
  INCLUDE (worker_id, worker_name, amount_cents, last_event_kind);
```
Wait — with `status` equality filter and `created_at DESC` sort: (company_id, status, created_at DESC) is ideal; include order_id in the key for the tiebreak sort (to avoid sort on a tiebreak… `ORDER BY created_at DESC, order_id DESC` — if the index is (company_id, status, created_at DESC, order_id DESC), it matches exactly). With multiple status values (`status = ANY(...)`), the index still helps (skipping/range per status) but Postgres might do a sort; acceptable.

Also an index on `operations_read_model (created_at)`? The drift comparison JOINs by order_id — PK covers it. Re-derivation reads the source's payment_orders by created_at. OK.

- `company_totals`: PK company_id.

**Now the maintenance hook code path**:

PaymentOrdersService.approve(orderId):
```ts
await this.repo.updateStatusInTx(orderId, 'approved', (tx) =>
  this.projections.onOrderChanged(tx, orderId)
);
```
Hmm — but the hook needs to happen after the write and inside the same transaction. The repository method:

```ts
// payment-orders.repository.ts
async approveInTransaction(orderId: number, hook: (tx: PrismaTx) => Promise<unknown>) {
  return this.prisma.$transaction(async (tx) => {
    const order = await this.findForUpdate(tx, orderId); // SELECT FOR UPDATE — serializes same-order writes
    if (order.status !== 'pending') throw new ApiError('invalid_state_transition', ...);
    await tx.paymentOrder.update({ where: { id: orderId }, data: { status: 'approved' } });
    await tx.orderEvent.create({ data: { orderId, kind: 'approved' } });
    await hook(tx); // projection maintenance, same tx
  });
}
```

But that puts business logic (status transition check) in the repository — a layering violation ("the service holds the logic"). Hmm. The service must hold the logic but can't touch Prisma. Options: the service does the validation with a prior read (`this.repo.findById`), then calls the tx method, and the repository re-checks under the lock and throws (defense). The *logic* (allowed transitions) lives in the service: it checks the current status from the read and decides; the repository re-validates under the lock (a consistency guard that throws the same error). It's acceptable: the repository re-check is a concurrency safety net, and the logic (which transitions are allowed) is defined in the service and passed as parameters? That's over-engineering.

Cleaner: the repository's tx method takes the transition (from→to) and performs the guarded update:

```ts
await this.repo.transition(orderId, 'pending', 'approved', hook);
```
The repository: `UPDATE payment_orders SET status='approved' WHERE id=$1 AND status='pending' RETURNING *` — if 0 rows → not found or invalid transition (distinguish with a prior existence check, or just check and throw). Then insert the event, then hook(tx). The *service* determines the valid transition (maps the action to from/to) and throws validation errors for unknown actions. The repository's guarded UPDATE implements atomicity. I think this is a reasonable layering: transition rules live in the service (a `TRANSITIONS: Record<Action, {from: Status, to: Status}>` map), and the repository just applies `from→to` atomically. And the service pre-reads for a better error (resource_not_found vs invalid_state_transition)? For the error distinction: the service first reads the order (repo.findById); if missing → resource_not_found; if status not in from set → invalid_state_transition; then the repo.transition (which is re-guarded; if the guard fails due to a race, throw invalid_state_transition). Good.

Where does the FOR UPDATE go? The guarded `UPDATE ... WHERE status=$from` itself is atomic — two concurrent approvals of the same order: only one succeeds (the second's UPDATE matches 0 rows… wait, the second transaction's UPDATE blocks on the first's row lock until commit, then re-evaluates the WHERE → 0 rows). So no explicit FOR UPDATE is needed! The guarded update is the serialization point.

And the hook: reads the order (now with the new status), the worker, the last event; upserts the projection row; applies the total delta (from→to). The delta is computed from the transition, not by reading the old totals — exact.

The hook (ProjectionMaintenanceService.onOrderChanged(tx, orderId, transition)):
```ts
const row = await this.repo.recomputeRow(tx, orderId); // order + worker + last event
await this.repo.upsertRow(tx, row);
await this.repo.applyTotalsDelta(tx, row.companyId, { [from]: -1, [to]: +1 });
```
recomputeRow is raw SQL JOIN:
```sql
SELECT po.id, po.company_id, po.worker_id, w.name, po.status, po.amount_cents, po.created_at,
       (SELECT oe.kind FROM order_events oe WHERE oe.order_id=po.id ORDER BY oe.created_at DESC, oe.id DESC LIMIT 1)
FROM payment_orders po LEFT JOIN workers w ON w.id = po.worker_id WHERE po.id = $1;
```

applyTotalsDelta is raw SQL (the upsert with in-place increments shown above).

The write path also includes creating an order: create order (pending) + event 'created' + hook (projection row inserted, pending total incremented). And the worker: seed data? The write path needs a worker row for the order. Include `POST /workers`? That expands scope. "Simulates the write path" refers to the order write. For tests, seed workers + companies via a fixture service, or plain SQL in tests. In tests, I can seed via the repository/prisma directly (tests can use PrismaClient directly — tests are not bound by the layers; still, using repositories is cleaner). I'll add a small seeder to the tests via prisma.

Do I need a worker write endpoint? No. Keep endpoints: payment-orders create/approve/reject/refund + operations list + company totals + maybe a `POST /operations/reproject` (trigger re-derivation) and `POST /drift-repair/run` (trigger the job) — useful for the acceptance tests ("drift injected into the projection → repair job finds and fixes it" — the test can call the job service directly; the endpoint is a bonus. The task's list of deliverables doesn't include a management endpoint, but a re-derivation routine needs to be callable — the service + a test call is enough; an endpoint makes it operable. I'll add minimal management endpoints: `POST /operations/reproject` (from,to) and `POST /drift-repair/run` — hmm, "don't create files the task doesn't ask for" refers to files, not endpoints. Extra endpoints are scope creep; but a re-derivation routine and a periodic job are asked for; a cron covers periodicity; manual triggering is a reasonable ops affordance. Let me include them — they're small and make the system operable. Actually, the discipline says "do exactly what the task asks." The task asks for a re-derivation routine (a service method — test calls it) and a periodic job (cron). A manual-trigger endpoint is defensible but not asked. I'll skip the extra endpoints; the cron job is the periodic path, the service method is called from tests. Hmm, but then how does an operator re-derive in production? Not our problem here. Skip. Keep: `/operations` (GET), `/payment-orders` (POST create, with :id/approve, :id/reject, :id/refund), `/company-totals/:companyId` (GET). That covers "the write service that invokes the hook (simulates the write path)" and "the new dashboard query."

Wait — the dashboard "sorts by recency." Is recency = created_at or updated_at? "List operations … sorted by recency" — the list is orders; an order's recency is its creation time. An approved order might re-sort to the top (updated_at) — ambiguous. "Without changing what the operator sees" — we define it: created_at DESC, order_id DESC (stable). Fine.

**Dashboard response shape** (what the operator sees):
```json
{
  "items": [
    { "orderId": 1, "companyId": 1, "workerId": 2, "workerName": "Ana", "status": "approved", "amountCents": 12000, "lastEventKind": "approved", "createdAt": "..." }
  ],
  "page": 1, "pageSize": 20, "total": 137
}
```
The total count: `COUNT(*)` with the same filter (using the index: count on the same prefix — no problem).

**Controller validation**: companyId is a required int; status is optional, an array from the set; from/to optional ISO dates, from<to; page ≥1; pageSize 1..100 default 20. Invalid → ApiError validation_failed with details.

**Tests** (Vitest, `test/*.spec.ts`):

Testing NestJS + Postgres needs a real DB (raw SQL, concurrency). Vitest with `@nestjs/testing` for the app, `DATABASE_URL` from env (the test environment must have Postgres; the tests assume `DATABASE_URL` points to a test DB). I'll write the specs to bootstrap the real Nest app (or the service/repo directly) against Postgres. Concurrency test: `Promise.all` of two approve calls. Read-your-own-writes: create → approve → GET /operations → expect status approved. Drift repair: corrupt the projection row directly (UPDATE the projection table), run DriftRepairJob.run(), assert the projection matches the source.

I'll write the tests using the Nest app's `INestApplication` + `app.inject`? Supertest isn't in the stack list; use the service directly (no supertest): `const app = await Test.createTestingModule({ imports: [AppModule] }).compile(); const appRef = await app.init(); const opService = appRef.get(OperationsService); ...`. Service-level behavior tests are fine ("test behavior") — but read-your-own-writes via the service = same as via HTTP. To keep dependencies light, no supertest. But the controller's validation… a few controller-level tests via `appRef.get(PaymentOrdersController)` calling the methods? That tests the validation. Let me structure the tests:

`test/operations.spec.ts`:
- Before all: compile the module, init the app, migrate/reset the schema (truncate tables, re-seed), obtain the PrismaClient from the app.
- After all: close the app.
- Read-your-own-writes: seed a worker+company; POST create via PaymentOrdersService.create; approve via service; call OperationsService.list with the company filter; assert the item shows approved and lastEventKind 'approved'. Also the totals endpoint reflects it.
- Concurrent total: seed a company with 2 orders; `Promise.all([approve(a), approve(b)])`; read the total → approved_count 2, approved_amount a+b; also the total for pending is 0. To make it a real concurrency, the two approvals happen in separate transactions with overlapping locks — the atomic increment guarantees exactness. Also assert each order's projection row is correct.
- Drift repair: create orders, approve; then `UPDATE operations_read_model SET status='pending' WHERE order_id=?` (via prisma $executeRaw), and corrupt the totals (`UPDATE company_totals SET approved_amount = approved_amount - 500`); run `driftJob.run({windowDays: 1})`; assert the projection row matches the source and the totals match the recomputed value. The drift report should have been non-zero before the run (assert that run() reports driftedOrders ≥ 1).
- Reprojection idempotency: call `reprojection.rederive(from,to)` twice; assert the result is identical (the total and rows are equal; also the maintainedAt? maintained_at changes on each upsert — comparing maintained_at would fail. The idempotency assertion should be on data fields, not timestamps. Or make the upsert NOT update maintained_at when nothing changed? That complicates things. Assert on the data: status/amount/worker/last event + total. "Running twice over the same window must leave the same result" — result = the projection's contents. Compare the row snapshot (excluding maintained_at) before/after the second run. Good.)

`test/payment-orders.spec.ts`? The convention is `test/<feature>.spec.ts`. I'll do:
- `test/operations.spec.ts` — dashboard query behavior (filter/sort/paginate/total, projection-only read) + read-your-own-writes + drift repair + re-derivation idempotency.
- `test/payment-orders.spec.ts` — write path: valid transitions, invalid transition error, not-found error, concurrent approval total exactness.

Hmm, the concurrent test fits in payment-orders (the total is a write-path concern). The drift test fits in operations. Let me split:

`test/payment-orders.spec.ts`:
- Create → row exists in the projection with pending status (read-your-own-writes for create).
- Approve → the next list shows approved (read-your-own-writes acceptance).
- Reject an approved → invalid_state_transition envelope.
- Approve a non-existent → resource_not_found.
- Concurrent approvals → total exact (Promise.all).
- Rollback safety: simulate? "If the write rolls back, the projection never sees it." A test: a write that fails mid-transaction (e.g. an order creation with a duplicate… hard to induce). Skip — I'll mention in DESIGN.md.

`test/operations.spec.ts`:
- The dashboard list: seed multiple companies/statuses/dates; filter by company+status+range; order by created_at desc; pagination page size; the total count.
- The dashboard reads only the projection: hard to assert "no join to source" from the outside — I can verify by seeding source rows that shouldn't appear (e.g. an order whose worker was deleted? Or a source order not in the projection… but the hook keeps them in sync). A behavior-level proof: directly mutate the source (e.g. UPDATE the worker's name in `workers`) without a hook, and show that the list still shows the old name? No — the name change should be reflected… actually, worker name changes are not on the write path (no worker write endpoint), so a stale name in the projection until re-derivation is expected. That test would assert the "projection-only read": change `workers.name` directly, list → old name; run re-derivation → new name. That's a good behavior test of projection-only read + re-derivation correctness!
- Re-derivation: corrupt the projection, re-derive the window → matches source; run twice → same.
- Drift repair: corrupt, job.run() → repairs; report is accurate.

The test DB lifecycle: `beforeAll`: get prisma, run DDL? The schema is created by migrations — tests need the schema to exist. Add a `test/db.ts` helper? The convention says test/<feature>.spec.ts; helper files are allowed. I'll make a `test/helpers.ts` with `createApp()`, `seed`, `reset`, and `PrismaService` access. Keep it minimal: each spec compiles the AppModule, truncates and recreates? If a migration is applied to the test DB, the tables exist; the spec just truncates. If the DB is fresh, the developer runs `prisma migrate deploy` first. But a test that must be self-contained would… I can't run the migration in the test without the exec tool… actually I can: `fs.readFileSync` the migration SQL + `prisma.$executeRawUnsafe`? Splitting statements is annoying. Alternative: `prisma db push`? Needs exec. Keep it simple: the tests assume `DATABASE_URL` points to a DB with the migration applied (documented in the test header comment + a README? No README asked for… only DESIGN.md. I'll add a comment to the test file). Actually — I can make the spec self-contained by executing the migration file via a pg client? A `pg` dependency isn't in the list… Prisma's `$executeRawUnsafe` can run a single statement; migration.sql has many. I can read the file, split by `;\n`, and execute each. Fragile, but it works for a controlled migration file I write. Hmm. I think it's acceptable to require `prisma migrate deploy` (or `migrate dev`) before running the tests — standard. But to be kinder: in the spec's beforeAll, if the tables don't exist, apply the migration statements (split by line-terminating `;`, filter empty). Let me include a small helper `ensureSchema(prisma)` that reads `prisma/migrations/2024.../migration.sql` relative to process.cwd() and executes the statements. That makes the tests robust in both cases (fresh DB and migrated DB, IF NOT EXISTS everywhere). I'll write all migration SQL with IF NOT EXISTS.

Wait — ESM + vitest + `@nestjs/testing` + NestJS 10/11. pnpm deps: `@nestjs/common`, `@nestjs/core`, `@nestjs/testing`, `@nestjs/schedule`, `@prisma/client`, `prisma` (dev), `reflect-metadata`, `rxjs`, `vitest`, `@types/node`. I'll add a `package.json`? "Do not create files the task doesn't ask for" — but a working solution needs package.json, tsconfig, vitest config. The deliverable list: projection table and DDL, hooks, re-derivation, job, query, tests, DESIGN.md. A repository with no package.json/tsconfig can't be built. I think it's necessary to include `package.json`, `tsconfig.json`, `vitest.config.ts` as part of "the whole solution" — the instruction "don't create files the task doesn't ask for" is about scope creep (an extra feature, an extra endpoint, a refactor), not about the build scaffolding. The solution must be complete. I'll include a minimal package.json (with scripts: test, build, start:dev, prisma:migrate), a tsconfig.json (strict, ESM), a vitest.config.ts. Maybe a `.env.example`? "No secrets in the repository, no hardcoded connection strings" — `.env.example` with placeholders is standard and not a secret. I'll skip .env.example and document DATABASE_URL in a DESIGN.md note? Environment configuration: `DATABASE_URL` required; the drift cron from `DRIFT_REPAIR_CRON` (with a default) — is a default OK under "configuration only from environment variables"? A default is fine (env can override). Actually, to be strict, read from env with a sensible fallback constant — that's standard.

Now — the ESM details: NestJS + ESM is tricky (needs specific config). The convention says ESM `"type": "module"`. NestJS supports ESM since v10 with some constraints. I'll write it in the straightforward way: `main.ts` imports `NestFactory`, etc. Prisma + ESM is fine. Vitest handles TS ESM well. `import 'reflect-metadata'` at the top of main. tsconfig: `"module": "ESNext"`, `"moduleResolution": "Bundler"`? For Nest build with tsc, ESM needs `.js` extension on imports… that's painful. Vitest doesn't care. To keep the deliverable clean and runnable under vitest (the tests are the acceptance criterion), I'll set tsconfig module ESNext, moduleResolution Bundler, target ES2022, strict true, experimentalDecorators, emitDecoratorMetadata, no `verbatimModuleSyntax`… and imports without extensions (works under vitest + bundler resolution; tsc build will fail without extensions but I won't provide a build script… hmm, "build" is expected). I'll provide a build via `tsc` only if it works — with moduleResolution Bundler, tsc emits ESM without adding extensions → node can't resolve at runtime. A common workaround for Nest ESM. To avoid going down this hole: the test runner is vitest; I'll skip the `build` script (or provide `nest build`? that's a dep). Provide scripts: `migrate:deploy`, `test`, `start:dev` via `tsx`? Extra dep `tsx`. Ugh.

Decision: package.json scripts: `"test": "vitest run"`, `"migrate": "prisma migrate deploy"`, `"start:dev": "tsx watch src/main.ts"` (add `tsx` dev dep). That's honest and works. No build script (tsc type-check: `"typecheck": "tsc --noEmit"`). tsconfig: strict, target ES2022, module ESNext, moduleResolution Bundler, experimentalDecorators true, emitDecoratorMetadata true, skipLibCheck true, noEmit true. Vitest with moduleResolution Bundler is fine.

Prisma generator: `prisma-client-js` outputs CJS to `node_modules/.prisma/client` — importable from ESM via default interop? In ESM, `import { PrismaClient, Prisma } from '@prisma/client'` works (the client package has an ESM wrapper since v5… actually @prisma/client v5 is CJS; Node's ESM can import CJS named exports via static analysis — Prisma's CJS exports are detectable? In practice `import { PrismaClient } from '@prisma/client'` in Node ESM works with v5 (they ship a package with exports and a wrapper). Many Nest ESM projects do this. Fine.)

Vitest config: `test: { environment: 'node', include: ['test/**/*.spec.ts'] }`. Concurrency: Vitest runs spec files in parallel by default (separate workers/processes) — two spec files truncating the same DB tables in parallel → flaky. Set `fileParallelism: false` (Vitest ≥2: `fileParallelism` config key; older: `singleThread`/`--no-file-parallelism`). Use `fileParallelism: false` in the vitest config. Good catch.

Now, DriftRepairJob with `@nestjs/schedule`'s `@Cron`:

```ts
@Injectable()
export class DriftRepairJob {
  constructor(private readonly reproject: ReprojectionService, private readonly opsRepo: OperationsRepository) {}
  @Cron(process.env.DRIFT_REPAIR_CRON ?? '*/5 * * * *')
  async runScheduled() { await this.run(); }
  async run(opts?: {windowDays?: number}) { ... compare, repair, log }
}
```
Cron expression from env var at decoration time (the decorator evaluates at class-definition time — the env is read at import time; acceptable). Also add a guard to avoid overlapping runs (a simple `running` flag). ScheduleModule.forRoot() in AppModule. The cron runs during tests too → potential interference (the drift job's re-derivation touching tables during tests). Mitigation: default cron every 5 min — tests run in seconds; but the job runs on module init? `@Cron`'s schedule starts at app init; the first run is after the interval (5 min) — safe. Also make it disableable: `DRIFT_REPAIR_ENABLED=false` in tests? Simpler: in the test helper, set `process.env.DRIFT_REPAIR_CRON = 'CRON_DISABLED'`? A cron library (cron) with an invalid expression might throw at parse time. `@nestjs/schedule`'s `@Cron` with an invalid expression → throws at schedule creation? To be safe, in the test's beforeAll, set `process.env.DRIFT_REPAIR_CRON = '0 0 1 1 '`… hmm. Alternative: the job only runs if `DRIFT_REPAIR_ENABLED !== 'false'` — but the schedule is still set up; make the cron default `*/5 * * * *`; in tests, set the env to `0 0 31 2 *` (02:31 — a valid cron that never fires in tests). That's clean. In the test helper: `process.env.DRIFT_REPAIR_CRON = '0 0 31 2 *'`.

Wait, does `@Cron` accept a string expression — yes.

Now the total: "financial total per company must be exact." Total table columns: count and amount (cents) per status. Amount is Int cents (exact). Good.

**Now, code details.**

PrismaService:
```ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() { super({ log: ['warn','error'] }); }
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}
```
`PrismaModule @Global()` exports PrismaService.

PrismaTransaction type: `Prisma.TransactionClient`.

ApiError:
```ts
export class ApiError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string, public readonly details: Record<string, unknown> = {}) { super(message); }
}
```
ErrorEnvelopeFilter:
```ts
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp(); const res = ctx.getResponse();
    let status = 500; let code = 'internal_error'; let message = 'unexpected error'; let details: Record<string, unknown> = {};
    if (exception instanceof ApiError) { ... }
    else if (exception instanceof Prisma.PrismaClientKnownRequestError) { map P2025 → resource_not_found? } 
    else if (exception instanceof HttpException) { map status; default code by status: 400 validation_failed, 404 resource_not_found, 409 conflict }
    res.status(status).json({ error: { code, message, details } });
  }
}
```
Keep it compact. Register in main.ts via `app.useGlobalFilters(new ErrorEnvelopeFilter())`. Also a global ValidationPipe? The controller does manual validation (parsing params) — no class-validator dependency. Manual: `parseId`, `parseIntOrThrow`.

**OperationsRepository** — the heart. Methods (all take an optional tx):

```ts
export type Tx = Prisma.TransactionClient;
type C = Tx | PrismaClient; // prisma: PrismaClient & { $transaction...}
```
Actually, PrismaClient and TransactionClient both have `$executeRaw`. Define `type Db = PrismaClient | Prisma.TransactionClient`.

Methods:
- `listOperations(prisma: Db, q: {companyId, statuses?, from?, to?, page, pageSize})` → `{items, total}` raw SQL.
- `getCompanyTotals(prisma, companyId)` → row or null.
- `recomputeOperationRow(prisma, orderId)` → row|null.
- `upsertOperationRow(prisma, row)` → raw SQL ON CONFLICT DO UPDATE.
- `applyTotalsDelta(prisma, companyId, deltas: {pendingCount, pendingAmount, approvedCount, approvedAmount, rejectedCount, rejectedAmount, refundedCount, refundedAmount})` → raw SQL.
- `recomputeCompanyTotals(prisma, companyId)` → absolute value upsert (GROUP BY).
- `ordersInWindow(prisma, from, to, cursorId, limit)` → re-derivation batch: `SELECT id, company_id, status, amount_cents, created_at, worker_id FROM payment_orders WHERE created_at >= $1 AND created_at < $2 AND id > $3 ORDER BY id LIMIT $4`.
- `affectedCompanies(prisma, from, to)` or derive from the batch's company set.
- `countDriftedOrders(prisma, from, to)` → raw SQL CTE.
- `countDriftedCompanies(prisma, from, to)` → compare totals rows.
- `findOrder(prisma, id)` → via Prisma (paymentOrder.findUnique) — used by the payment-orders repository.

Hmm wait — the list query's statuses: pass an array; build the SQL with `status = ANY($2)` only if provided. Build with a `Prisma.sql` template, or a parameterized string via `$executeRaw(Prisma.sql\`...\`)`. With Prisma.sql, arrays work (`$` interpolates arrays as Postgres array literals? Prisma's raw handles `string[]` → yes, it converts to a Postgres array). To be safe, I'll use `$executeRawUnsafe` with manual `?` placeholders? The parameterized API `$executeRaw(sql, ...values)` accepts a string with `?` placeholders (older Prisma) — v5 uses `Prisma.sql` tagged or `$executeRaw(Prisma.raw...)`? The modern API: `prisma.$executeRaw(Prisma.sql\`SELECT ...\`)` with template interpolation, or `prisma.$executeRaw\`...\`` tagged (allowed only with static SQL, no interpolation). For dynamic parts (the statuses filter), build with `Prisma.sql` and `${Prisma.join? }`… Simpler: always use `status = ANY($statuses)` with `statuses` defaulting to `ALL_STATUSES` (the full set) when not provided — uniform SQL, no branching. `status = ANY(ARRAY['pending','approved','rejected','refunded'])` matches everything.

But with `status = ANY([...])` the index (company_id, status, created_at DESC) — Postgres can use the index for equality on company_id and a small set of status via skip-scan? For 1-2 statuses it uses a bitmap. Fine.

The total count query: same WHERE, `SELECT count(*)`. Two queries per dashboard hit — fine. Or `count(*) OVER ()` in one query — cleaner:
```sql
SELECT order_id, company_id, worker_id, worker_name, status, amount_cents, last_event_kind, created_at,
       count(*) OVER () AS total
FROM operations_read_model
WHERE company_id = $1 AND status = ANY($2) AND created_at >= $3 AND created_at < $4
ORDER BY created_at DESC, order_id DESC
LIMIT $5 OFFSET $6;
```
Window function count over the filtered set — Postgres computes count(*) OVER () over the filtered rows before LIMIT — yes, that gives the total for the filtered set. One round-trip.

**Re-derivation algorithm** (ReprojectionService.rederive(from, to)):
```ts
async rederive(from: Date, to: Date): Promise<ReprojectionResult> {
  let cursor = 0; let rows = 0; const companies = new Set<number>();
  while (true) {
    const batch = await this.repo.ordersInWindow(this.prisma, from, to, cursor, 500);
    if (batch.length === 0) break;
    await this.prisma.$transaction(async (tx) => {
      for (const o of batch) {
        const row = await this.repo.recomputeOperationRow(tx, o.id);
        if (row) { await this.repo.upsertOperationRow(tx, row); companies.add(o.companyId); }
      }
      for (const c of companies) await this.repo.recomputeCompanyTotals(tx, c);
    });
    rows += batch.length;
    cursor = batch[batch.length-1].id;
    if (batch.length < 500) break;
  }
  return { rows, companies: companies.size };
}
```
Idempotent: upsert is absolute; totals recomputed as absolute. Live-safe: per-batch short transactions, no long locks. Run twice → same. The company set accumulates across batches — the totals recomputation happens per batch (the company set grows; recompute every time a company appears — a bit wasteful but correct; or collect them and recompute at the end + per batch? Recomputing at the end for all affected companies in one tx is cleaner; but a big window = many companies in one tx — fine (a single GROUP BY per company… or a single SQL that recomputes all affected companies at once):

```sql
INSERT INTO company_totals AS ct (company_id, pending_count, pending_amount, approved_count, approved_amount, rejected_count, rejected_amount, refunded_count, refunded_amount, version, updated_at)
SELECT company_id,
       count(*) FILTER (WHERE status='pending'), sum(amount_cents) FILTER (WHERE status='pending') ?? 0, ...
FROM payment_orders WHERE company_id = ANY($1) GROUP BY company_id
ON CONFLICT (company_id) DO UPDATE SET pending_count = EXCLUDED.pending_count, ... version = ct.version+1, updated_at = now();
```
One statement for all affected companies.

But wait: during re-derivation with the system live, recomputing totals at the very end for all companies is a single point; hook deltas in between are fine. Good.

Hmm, one subtlety: `sum(amount_cents) FILTER (...)` can be NULL if there are no rows — but with a company that has at least one order in the window, the GROUP BY guarantees a row per company; individual status sums may be NULL → `COALESCE(sum(...) FILTER (WHERE ...), 0)`.

**Drift detection query**:

Drifted orders (in the window):
```sql
WITH expected AS (
  SELECT po.id, po.company_id, po.worker_id, po.status, po.amount_cents, po.created_at,
         w.name AS worker_name,
         (SELECT oe.kind FROM order_events oe WHERE oe.order_id = po.id ORDER BY oe.created_at DESC, oe.id DESC LIMIT 1) AS last_event_kind
  FROM payment_orders po
  LEFT JOIN workers w ON w.id = po.worker_id
  WHERE po.created_at >= $1 AND po.created_at < $2
)
SELECT count(*) AS drifted
FROM expected e
LEFT JOIN operations_read_model r ON r.order_id = e.id
WHERE r.order_id IS NULL
   OR r.status IS DISTINCT FROM e.status
   OR r.worker_id IS DISTINCT FROM e.worker_id
   OR r.worker_name IS DISTINCT FROM e.worker_name
   OR r.amount_cents IS DISTINCT FROM e.amount_cents
   OR r.last_event_kind IS DISTINCT FROM e.last_event_kind
   OR r.created_at IS DISTINCT FROM e.created_at;
```
`IS DISTINCT FROM` handles NULLs. Note: the LEFT JOIN to workers: if the worker was deleted, e.worker_name is NULL; the projection has the old name → drift → repair sets NULL. The hook's upsert preserves the snapshot semantics. OK.

Drifted companies (totals):
```sql
WITH actual AS (
  SELECT company_id,
         count(*) FILTER (WHERE status='pending') pc, COALESCE(sum(amount_cents) FILTER (WHERE status='pending'),0) pa,
         ... per status
  FROM payment_orders GROUP BY company_id
)
SELECT count(*)
FROM actual a
JOIN company_totals t ON t.company_id = a.company_id
WHERE t.pending_count IS DISTINCT FROM a.pc OR t.pending_amount IS DISTINCT FROM a.pa OR ...
UNION ALL? 
```
Plus missing totals rows: companies that have orders but no totals row (drift). Combine:
```sql
WITH actual AS (...), known AS (
  SELECT a.company_id,
    (t.company_id IS NULL
      OR t.pending_count IS DISTINCT FROM a.pc
      OR t.pending_amount IS DISTINCT FROM a.pa
      OR t.approved_count IS DISTINCT FROM a.ac
      OR t.approved_amount IS DISTINCT FROM t2...
    ) AS drifted
  FROM actual a LEFT JOIN company_totals t ON t.company_id = a.company_id
)
SELECT count(*) FILTER (WHERE drifted) FROM known;
```
Should the drift window be limited to companies with orders in the window? The spec: "periodically compare the projection to the source over the recent window." A total drift for a company that has no recent orders but has historical ones — out of scope; the window-based job covers the recent window; a full scan would be a separate maintenance. I'll scope: companies = companies with orders in the window (consistent with "over the recent window").

So `countDriftedCompanies(from, to)`:
```sql
WITH windowed AS (SELECT DISTINCT company_id FROM payment_orders WHERE created_at >= $1 AND created_at < $2),
actual AS (
  SELECT po.company_id,
    COALESCE(count(*) FILTER (WHERE po.status='pending'),0) AS pc,
    COALESCE(sum(po.amount_cents) FILTER (WHERE po.status='pending'),0) AS pa,
    ...
  FROM payment_orders po JOIN windowed w ON w.company_id = po.company_id
  GROUP BY po.company_id
)
SELECT count(*) AS drifted
FROM actual a
LEFT JOIN company_totals t ON t.company_id = a.company_id
WHERE t.company_id IS NULL
   OR t.pending_count IS DISTINCT FROM a.pc
   OR t.pending_amount IS DISTINCT FROM a.pa
   OR t.approved_count IS DISTINCT FROM a.ac
   OR t.approved_amount IS DISTINCT FROM a.aam
   OR t.rejected_count IS DISTINCT FROM a.rc
   OR t.rejected_amount IS DISTINCT FROM a.ra
   OR t.refunded_count IS DISTINCT FROM a.fc
   OR t.refunded_amount IS DISTINCT FROM a.fa;
```

Repair: `rederive(from, to)` fixes both the rows and the totals (for affected companies). Note: the drifted-company set (companies with orders in the window) is a subset of… wait, re-derivation recomputes totals for companies that have orders in the window — the same set. Consistent.

DriftRepairService.run({windowDays = from env var DRIFT_REPAIR_WINDOW_DAYS default 1}):
```ts
const to = new Date(); const from = new Date(to.getTime() - windowDays*86400000);
const [driftedOrders, driftedCompanies] = await Promise.all([repo.countDriftedOrders(from,to), repo.countDriftedCompanies(from,to)]);
let repaired: ReprojectionResult | undefined;
if (driftedOrders > 0 || driftedCompanies > 0) repaired = await reproject.rederive(from, to);
return { windowFrom, windowTo, driftedOrders, driftedCompanies, repaired };
```

**Payment orders repository**:

```ts
async create(prisma: Db, data): Promise<PaymentOrder> {
  return prisma.$transaction(async (tx) => { ... });
}
```
Hmm wait — the hook must run inside the same transaction, and the hook is invoked by the service (the spec). So the service:

```ts
async create(input) {
  await this.validate(input);
  return this.repo.withWriteTransaction(async (tx) => {
    const order = await this.repo.insertOrder(tx, input);
    await this.repo.insertEvent(tx, order.id, 'created');
    await this.projections.onOrderCreated(tx, order.id); // the hook, same tx
    return order;
  });
}
```
And `withWriteTransaction` in PaymentOrdersRepository: `return this.prisma.$transaction(fn)`. Is that "business logic in the repository"? No — it's a transaction helper. The orchestration (which hook, which event) is in the service. This satisfies "the maintenance hook is invoked by the write service and runs inside the transaction that writes the source row."

approve:
```ts
async approve(orderId: number) {
  const order = await this.repo.findById(orderId);
  if (!order) throw new ApiError(404, 'resource_not_found', `payment order ${orderId} does not exist`, { orderId });
  if (order.status !== 'pending') throw new ApiError(409, 'invalid_state_transition', `order ${orderId} is ${order.status}; approve requires pending`, {...});
  return this.repo.transition(orderId, 'pending', 'approved', async (tx) => {
    await this.repo.insertEvent(tx, orderId, 'approved');
    await this.projections.onOrderStatusChanged(tx, orderId, 'pending', 'approved');
  });
}
```
Repository.transition:
```ts
async transition(orderId, from, to, after: (tx) => Promise<unknown>) {
  return this.prisma.$transaction(async (tx) => {
    const updated = await tx.paymentOrder.updateMany({ where: { id: orderId, status: from }, data: { status: to } });
    if (updated.count === 0) {
      const exists = await tx.paymentOrder.findUnique({ where: { id: orderId }, select: { status: true } });
      throw exists
        ? new ApiError(409, 'invalid_state_transition', `order ${orderId} is no longer ${from}`, { orderId, expected: from, actual: exists.status })
        : new ApiError(404, 'resource_not_found', `payment order ${orderId} does not exist`, { orderId });
    }
    await after(tx);
    return orderId;
  });
}
```
The service pre-reads for a clear error; the repository guard handles the race. The hook inside the tx sees the committed-in-tx status `to` (uncommitted but visible within the tx).

`ProjectionMaintenanceService` (in the operations feature, exported):
```ts
@Injectable()
export class ProjectionMaintenanceService {
  constructor(private readonly repo: OperationsRepository) {}
  onOrderCreated(tx: Prisma.TransactionClient, orderId: number) { return this.apply(tx, orderId, 'pending', 'pending'); }
  onOrderStatusChanged(tx, orderId, from, to) { return this.apply(tx, orderId, from, to); }
  private async apply(tx, orderId, from, to) {
    const row = await this.repo.recomputeOperationRow(tx, orderId);
    if (!row) throw new ApiError(409, 'invalid_state_transition', ...); // should not happen
    await this.repo.upsertOperationRow(tx, row);
    await this.repo.applyTotalsDelta(tx, row.companyId, toDelta(from, to));
  }
}
```
For a create, the delta = +1 pending (from=to='pending' → delta only +1? For a create, the order did not exist before → delta = +1 in the new status. For a status change: -1 in `from`, +1 in `to`. Distinguish with a boolean `created`. `apply(tx, orderId, {created, from, to})`: delta = created ? +1[to] : -1[from]+1[to].

`toDelta`:
```ts
function statusDelta(created: boolean, from: Status, to: Status): TotalsDelta {
  const d = emptyDelta();
  if (created) add(d, to, 1, 1); // +1 count; amount added from the row's amount
  else { add(d, from, -1, 0); add(d, to, +1, 0); }
  ...
}
```
Amount: the delta's amount = ±amountCents. So we need the row's amount: build the delta in `apply` after reading the row:
```ts
const delta = emptyDelta();
if (created) { delta[to] = { count: +1, amount: +row.amountCents }; }
else { delta[from] = { count: -1, amount: -row.amountCents }; delta[to] = { count: +1, amount: +row.amountCents }; }
```
`emptyDelta()` returns all 8 keys zero. Good.

**upsertOperationRow** raw SQL:
```sql
INSERT INTO operations_read_model
  (order_id, company_id, worker_id, worker_name, status, amount_cents, last_event_kind, created_at, maintained_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
ON CONFLICT (order_id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  worker_id = EXCLUDED.worker_id,
  worker_name = EXCLUDED.worker_name,
  status = EXCLUDED.status,
  amount_cents = EXCLUDED.amount_cents,
  last_event_kind = EXCLUDED.last_event_kind,
  created_at = EXCLUDED.created_at,
  maintained_at = now();
```

**applyTotalsDelta**:
```sql
INSERT INTO company_totals
  (company_id, pending_count, pending_amount, approved_count, approved_amount, rejected_count, rejected_amount, refunded_count, refunded_amount, version, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, now())
ON CONFLICT (company_id) DO UPDATE SET
  pending_count = company_totals.pending_count + EXCLUDED.pending_count,
  pending_amount = company_totals.pending_amount + EXCLUDED.pending_amount,
  approved_count = company_totals.approved_count + EXCLUDED.approved_count,
  approved_amount = company_totals.approved_amount + EXCLUDED.approved_amount,
  rejected_count = company_totals.rejected_count + EXCLUDED.rejected_count,
  rejected_amount = company_totals.rejected_amount + EXCLUDED.rejected_amount,
  refunded_count = company_totals.refunded_count + EXCLUDED.refunded_count,
  refunded_amount = company_totals.refunded_amount + EXCLUDED.refunded_amount,
  version = company_totals.version + 1,
  updated_at = now();
```
Note: if the conflict happens, EXCLUDED = the inserted row = the delta → `ct.pending_count + EXCLUDED.pending_count` = ct.pending_count + delta. Correct. The ON CONFLICT DO UPDATE path never inserts, so the initial row values in the INSERT only matter in the no-conflict case (= the delta = correct for a fresh company).

**recomputeCompanyTotals(companyIds)**:
```sql
INSERT INTO company_totals AS ct (company_id, pending_count, pending_amount, approved_count, approved_amount, rejected_count, rejected_amount, refunded_count, refunded_amount, version, updated_at)
SELECT po.company_id,
  COALESCE(count(*) FILTER (WHERE po.status = 'pending'), 0),
  COALESCE(sum(po.amount_cents) FILTER (WHERE po.status = 'pending'), 0),
  ... approved, rejected, refunded
FROM payment_orders po
WHERE po.company_id = ANY($1)
GROUP BY po.company_id
ON CONFLICT (company_id) DO UPDATE SET
  pending_count = EXCLUDED.pending_count,
  ... (absolute values),
  version = ct.version + 1,
  updated_at = now();
```
Hmm — `AS ct` on the target of an INSERT ... SELECT ... ON CONFLICT: the alias works (`INSERT INTO company_totals AS ct ... ON CONFLICT ... SET version = ct.version + 1`). Yes.

Note: companies with zero orders (all filtered out) — `WHERE company_id = ANY($1)` with an empty array → no rows → the INSERT inserts nothing → no conflict → no problem (companies that were affected always have orders).

But one issue: an absolute-value upsert that overwrites could *lose* concurrent hook deltas if a hook delta for the same company applies between the SELECT… no — it's a single statement; the hook delta either precedes (its increment is overwritten → lost!) or follows (applied on top of the recomputation → fine). Lost scenario: a hook increments approved_amount at T1; the re-derivation's recomputation takes a snapshot at T0 < T1 and writes at T2 > T1 → overwrites the increment → the total is behind until the next repair. That's inherent to a live-safe re-derivation (documented in DESIGN.md; the drift job fixes it). The acceptance test is quiescent. Fine. To reduce the window, we could recompute totals per batch right after applying the batch's rows (instead of at the end) — same property. I'll recompute per batch (each batch's tx: upsert the rows, then recompute the affected companies' totals) — smaller windows, and still idempotent.

Hmm wait, actually there's a subtle correctness issue with per-batch total recomputation + idempotency: none — the absolute-value recomputation is always source truth. Good.

**Dashboard list query** (raw SQL):
```sql
SELECT order_id, company_id, worker_id, worker_name, status, amount_cents, last_event_kind, created_at,
       count(*) OVER () AS total
FROM operations_read_model
WHERE company_id = $1
  AND status = ANY($2)
  AND created_at >= $3
  AND created_at < $4
ORDER BY created_at DESC, order_id DESC
LIMIT $5 OFFSET $6
```
Defaults: from = epoch, to = now + 1? The query requires from/to — the service fills defaults: from = 1970-01-01, to = now(). The controller validates from < to if both given.

`count(*) OVER ()` with LIMIT — Postgres: the window is computed on the query result before LIMIT (LIMIT is applied after window functions in the physical plan; the total is correct for the filtered set). Yes.

**Total endpoint**: `GET /company-totals/:companyId` → `OperationsService.getTotals(companyId)` → repo.getCompanyTotals → if missing, 404? Return zeros? If the company has no orders, there's no row → return a zero total (a neutral object) — or 404? Finance reconciles against it; a zero row is more useful. Return zeros for unknown companies (with details?). Keep it simple: zero total.

Hmm, actually let me return the row if it exists, otherwise a zero total with `version: 0`. Good.

**Controller validation helpers**: a `src/common/parsing.ts`? Put small helpers in the controller file. "The controller validates input and calls the service. Zero business logic." Parse int/date, range-check, throw ApiError('validation_failed').

Endpoints and routes:
- `@Controller('operations')` GET `/` → list.
- `@Controller('company-totals')` GET `/:companyId` → totals. (In the operations controller? Separate? Same operations feature: one controller can have two `@Controller` decorators… one controller class per resource. Two controllers in the operations feature? The convention suggests one controller per feature. I'll put both routes in OperationsController: `@Controller()` with `@Get('operations')` and `@Get('company-totals/:companyId')`. The route paths are kebab plural. Good — one controller.)
- `@Controller('payment-orders')`: `@Post()`, `@Post(':id/approve')`, `@Post(':id/reject')`, `@Post(':id/refund')`.

Wait — refund: pending→? Typical: approved→refunded. Include it to make the four statuses meaningful.

Create body: `{ companyId, workerId, amountCents }` (status implicitly pending). Validate worker existence? If the worker doesn't exist, FK violation → Prisma error → 500-ish. The service pre-checks worker existence (repo.workerExists) → validation_failed if missing. Good.

**Amount validation**: positive int.

Now — the test details.

Test helper (`test/helpers.ts`):
```ts
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js'? 
```
Extension: with moduleResolution Bundler + vitest, extensionless imports in TS are fine (`../src/app.module`). Vitest resolves TS. Use extensionless.

```ts
export async function createTestApp() {
  process.env.DRIFT_REPAIR_CRON = '0 0 31 2 *'; // never fire during tests
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalFilters(new ErrorEnvelopeFilter());
  await app.init();
  return app;
}
export function prismaOf(app: INestApplication) { return app.get(PrismaService); }
export async function resetTables(prisma: PrismaService) {
  await prisma.$executeRawUnsafe(`TRUNCATE order_events, operations_read_model, company_totals, payment_orders, workers RESTART IDENTITY CASCADE`);
}
```
Wait — TRUNCATE order… order: FK: order_events references payment_orders; operations_read_model is standalone; truncating with CASCADE is fine.

ensureSchema: read the migration file:
```ts
const fs = await import('node:fs/promises');
const path = await import('node:path');
export async function ensureSchema(prisma: PrismaService) {
  const dir = path.join(process.cwd(), 'prisma', 'migrations');
  const files = (await fs.readdir(dir)).sort();
  for (const f of files) {
    const sql = await fs.readFile(path.join(dir, f, 'migration.sql'), 'utf8');
    for (const stmt of sql.split(/;\s*(?:\r?\n|$)/)) {
      const s = stmt.trim();
      if (s) await prisma.$executeRawUnsafe(s);
    }
  }
}
```
My migration SQL must split cleanly on `;` at line ends, and every statement must be idempotent (IF NOT EXISTS; CREATE UNIQUE INDEX IF NOT EXISTS; CREATE INDEX IF NOT EXISTS). But TRUNCATE … RESTART IDENTITY resets ids → the tests use deterministic ids. Good.

Hmm — but if the migration SQL includes `CREATE TYPE status...`? I decided String, no enum type. Good, no CREATE TYPE (which isn't easily idempotent).

The spec:

`test/payment-orders.spec.ts`:
```ts
describe('payment orders write path', () => {
  let app, prisma, orders: PaymentOrdersService, ops: OperationsService;
  beforeAll(async () => { app = await createTestApp(); prisma = app.get(PrismaService); await ensureSchema(prisma); orders = app.get(PaymentOrdersService); ops = app.get(OperationsService); });
  beforeEach(async () => { await resetTables(prisma); });
  afterAll(async () => { await app.close(); });

  it('an approved order is visible to the dashboard immediately (read your own writes)', async () => {
    const worker = await prisma.worker.create({ data: { companyId: 1, name: 'Ana' } });
    const created = await orders.create({ companyId: 1, workerId: worker.id, amountCents: 12000 });
    await orders.approve(created.id);
    const page = await ops.listOperations({ companyId: 1, page: 1, pageSize: 20 });
    const item = page.items.find(i => i.orderId === created.id)!;
    expect(item.status).toBe('approved');
    expect(item.lastEventKind).toBe('approved');
    const totals = await ops.getCompanyTotals(1);
    expect(totals.approvedCount).toBe(1);
    expect(totals.approvedAmountCents).toBe(12000);
  });

  it('rejects an invalid transition with the error envelope', async () => {
    // Create, approve, then approve again → throws ApiError invalid_state_transition; also check the message/code.
  });
  it('returns resource_not_found for a missing order', ...);

  it('keeps company totals exact under concurrent approvals', async () => {
    Seed 3 orders for company 7 (amounts 1000, 2500, 4000) via orders.create (each create also maintains the projection → pending total = 7500/3).
    const [a,b,c] = ...
    await Promise.all([orders.approve(a.id), orders.approve(b.id), orders.approve(c.id)]);
    const totals = await ops.getCompanyTotals(7);
    expect(totals.pendingCount).toBe(0);
    expect(totals.approvedCount).toBe(3);
    expect(totals.approvedAmountCents).toBe(7500);
    // and each order's projection row
  });
});
```
Also a create-rollback test: "if the write rolls back, the projection never sees it" — testable: create an order for a non-existent worker → the FK… I made the service pre-validate the worker (no tx started). To test rollback: pass a hook failure? Simpler: test the invalid transition guard: approve a non-existent order id → 404 and the projection is unchanged. Rollback coverage: I can simulate a failed write: an amountCents that causes… hmm. I can test directly: call the repo's transition with an after() that throws → assert no projection change. That's a repository-level test — acceptable as "behavior: a rolled-back write leaves no projection trace." Let me add:
```ts
it('leaves no projection trace when the write transaction rolls back', async () => {
  const { id } = await orders.create(...);
  // Force the transition tx to fail after the status update but before commit
  await expect(orders.approveWithFailure?).rejects...
});
```
I need an injection point… I can test at the repository level:
```ts
const repo = app.get(PaymentOrdersRepository);
await expect(repo.transition(id, 'pending', 'approved', async (tx) => {
  await tx.$executeRawUnsafe(`UPDATE company_totals SET approved_amount = approved_amount + 1 WHERE company_id = 1`);
  throw new Error('boom');
})).rejects.toThrow('boom');
```
Then assert the totals are unchanged and the order status is still pending (the projection upsert wasn't applied). That's a legitimate behavior test of "a rolled-back write never touched the projection." The totals UPDATE inside the tx is raw SQL in the test — fine (tests can do anything).

`test/operations.spec.ts`:
```ts
describe('operations read model', () => {
  beforeAll: app, prisma, ops service, reprojection service, drift job.
  Seed helper: seedOrder(companyId, workerName, status, amount, createdAt) → create via the prisma source table + events (simulating the history) — but the projection must be in sync: either run re-derive after seeding, or go through the service. For a dashboard filter test, seed via the service (create + transitions) and control created_at? created_at = default now() — date range filtering needs varied created_at. Can the service accept createdAt? The source is `@default(now())`. In the test, I can update payment_orders.created_at directly after creation (a source-only change → then re-derive to sync the projection). That's a bit awkward but fine: seed → backdate via raw SQL → run re-derivation → the projection matches. It also doubles as a re-derivation test. Or, simpler: the list test doesn't need multiple dates; I'll test the date filter with 2 orders: one with now, one backdated. Let's do this: create 2 orders; backdate one directly in the source (prisma update created_at); run reproject.rederive(epoch, now) → assert the list with a from/to window includes only the right ones. This tests both the filter and the re-derivation.

  it('filters by company, status and date range, sorts by recency and paginates', ...):
    Company 10: orders A (1000, created at T1), B (2000, T2>T1), C (3000, T3>T2, rejected); company 11: D (5000, T4>T3, approved).
    Via the service: create all (pending) → approve A, B, D; reject C; backdate A to T1 (raw update), re-derive.
    list(company=10, page1, size=2) → items [C? no — sort by created desc: C(T3), B(T2)], total 3.
    list(company=10, status=['approved']) → B(T2), A(T1), total 2.
    list(company=10, from=T1+1ms, to=now) → excludes A.
    list(company=10, to=T1+1ms) → only A.
    Company isolation: list(company=11) → only D.

  it('reads only the projection (source changes without a write are not visible until re-derivation)', ...):
    Create an order (approved). Update the worker's name directly in the source. list → old name. re-derive → new name. (This proves the hot path doesn't join to workers.)
    Also: an order deleted from the source? Overkill.

  it('re-derivation rebuilds a window and is idempotent', ...):
    Create+approve orders for company 20. Corrupt: UPDATE operations_read_model SET status='pending', amount_cents=1 WHERE ...; corrupt the totals.
    rederive(from,to) → matches the source (assert row + totals).
    Snapshot the rows (excluding maintained_at) + totals; rederive again; assert identical.

  it('the drift-repair job finds and fixes injected drift', ...):
    Create+approve orders for company 30 (a few).
    Inject: UPDATE operations_read_model SET last_event_kind='created' WHERE order_id=X; UPDATE company_totals SET approved_amount = approved_amount + 999 WHERE company_id=30; DELETE one projection row? (missing row → drift; re-derivation re-creates it.)
    const report = await driftJob.run();
    expect(report.driftedOrders).toBeGreaterThanOrEqual(2); expect(report.driftedCompanies).toBe(1);
    Assert the projection row is restored (status approved, lastEventKind approved, row exists), and the totals are exact.
    And a clean run: report2 = await driftJob.run() → driftedOrders 0, driftedCompanies 0.
});
```

Note on the drift job's default window: created_at within the last N days — all the test orders have created_at of now (some backdated to T1 — T1 is also now-ish). The backdated order: backdate by 2 hours (still within a 1-day window). Fine.

Drift window env var: `DRIFT_REPAIR_WINDOW_DAYS` default 1. In tests, the orders are created at now → within the window. The backdated order is backdated by 2 hours — still within 1 day. OK.

Now — `count(*) FILTER (WHERE ...)` with `IS DISTINCT FROM` against a bigint/int sum: Postgres sum(int) → bigint; company_totals.amount columns: make them BigInt in the schema? Prisma BigInt ↔ Postgres bigint. JS number for amount up to 2^53 is fine, but Prisma BigInt returns a BigInt object — comparisons in tests are awkward. Simpler: keep amount as Int (int4) everywhere (cents; 3M orders × a few thousand dollars fits in int4? sum per company could exceed 2.1B cents = $21M — hmm, a large company's total could exceed int4 (2,147,483,647 cents ≈ $21.47M). Risky but it's an exercise… use BigInt for the amount columns on totals, and Int for the per-order amount? Then raw SQL mixing is fine (numeric). Prisma schema: `amountCents Int` (per order), totals as `BigInt`. Raw SQL `sum(amount_cents)` → bigint. `EXCLUDED.pending_amount` etc. are bigint. JS side: applyTotalsDelta passes number values (fine, coerced). getCompanyTotals returns BigInt for the amount → the service maps to number via Number() (the dashboard/total API returns a number). In tests, compare with Number(...). Hmm, adds friction but is more correct. Or use `Decimal`? No — cents are integers. I'll go with BigInt for the totals amount, Int for the order amount. In `recomputeCompanyTotals`, `sum(amount_cents) FILTER` → bigint → COALESCE(..., 0)::bigint? `COALESCE(sum, 0)` → 0 is an int literal, sum is bigint → the result is bigint. OK.

For `applyTotalsDelta`, the value: `$3` (pending amount delta) is passed as a JS number → the pg driver sends a numeric string; the column is bigint → coercion fine.

`upsertOperationRow.amountCents` is int.

`getCompanyTotals` returns `Record<string, unknown>` from raw SQL — the raw `sum` returns a string for bigint (the pg driver returns a string for bigint/int8). So Number(row.approved_amount) etc. Normalize in the repository to a typed object.

**Prisma schema final**:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Worker {
  id        Int  @id @default(autoincrement())
  companyId Int  @map("company_id")
  name      String @map("name")
  @@index([companyId])
  @@map("workers")
}

model PaymentOrder {
  id          Int        @id @default(autoincrement())
  companyId   Int        @map("company_id")
  workerId    Int        @map("worker_id")
  status      String     @default("pending") @map("status")
  amountCents Int        @map("amount_cents")
  createdAt   DateTime   @default(now()) @map("created_at")
  updatedAt   DateTime   @default(now()) @updatedAt @map("updated_at")
  events      OrderEvent[]
  @@index([companyId])
  @@index([createdAt])
  @@map("payment_orders")
}

model OrderEvent {
  id        Int      @id @default(autoincrement())
  orderId   Int      @map("order_id")
  kind      String   @map("kind")
  createdAt DateTime @default(now()) @map("created_at")
  order     PaymentOrder @relation(fields: [orderId], references: [id], onDelete: Cascade)
  @@index([orderId, [createdAt(sort: SortOrder.Desc), id(sort: SortOrder.Desc)]])
  @@map("order_events")
}

model OperationRow {
  orderId       Int      @id @map("order_id")
  companyId     Int      @map("company_id")
  workerId      Int      @map("worker_id")
  workerName    String?  @map("worker_name")
  status        String   @map("status")
  amountCents   Int      @map("amount_cents")
  lastEventKind String?  @map("last_event_kind")
  createdAt     DateTime @map("created_at")
  maintainedAt  DateTime @default(now()) @map("maintained_at")
  @@map("operations_read_model")
  // The dashboard covering index is applied by the migration (Prisma can't express INCLUDE).
}

model CompanyTotals {
  companyId      Int   @id @map("company_id")
  pendingCount   Int   @default(0) @map("pending_count")
  pendingAmount  BigInt @default(0) @map("pending_amount")
  approvedCount  Int   @default(0) @map("approved_count")
  approvedAmount BigInt @default(0) @map("approved_amount")
  rejectedCount  Int   @default(0) @map("rejected_count")
  rejectedAmount BigInt @default(0) @map("rejected_amount")
  refundedCount  Int   @default(0) @map("refunded_count")
  refundedAmount BigInt @default(0) @map("refunded_amount")
  version        Int   @default(0) @map("version")
  updatedAt      DateTime @default(now()) @updatedAt @map("updated_at")
  @@map("company_totals")
}
```

workerId on the order: is worker required? An order handled by a worker — the dashboard shows the worker name. Make workerId required (FK). operations_read_model.worker_id Int (required) — but the LEFT JOIN for the worker name can still be NULL if the worker was deleted; keep worker_name nullable. worker_id required on the projection (mirrors the source). OK.

FK in the schema: `worker Worker @relation(fields: [workerId], references: [id])`. Cascade delete from a worker → breaks the order? If a worker is deleted, the order is cascade-deleted — hmm, that's wrong for payment orders; use `onDelete: Restrict`? Or leave the projection's worker_name as a snapshot. For the source, the worker deletion is outside our scope; default (restrict? Prisma's default is SetNull for optional / NoAction for required). I'll declare `@relation(fields:[workerId], references:[id])` (default NoAction/Restrict-ish). Keep it simple.

**Migration SQL** (`prisma/migrations/20240601000000_init/migration.sql`) — full DDL:

```sql
CREATE TABLE IF NOT EXISTS workers (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  name TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workers_company_id ON workers (company_id);

CREATE TABLE IF NOT EXISTS payment_orders (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  worker_id INTEGER NOT NULL REFERENCES workers(id),
  status TEXT NOT NULL DEFAULT 'pending',
  amount_cents INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_orders_company_id ON payment_orders (company_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_created_at ON payment_orders (created_at);

CREATE TABLE IF NOT EXISTS order_events (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_events_order_latest ON order_events (order_id, created_at DESC, id DESC);

-- read model
CREATE TABLE IF NOT EXISTS operations_read_model (
  order_id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL,
  worker_id INTEGER NOT NULL,
  worker_name TEXT,
  status TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  last_event_kind TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  maintained_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Covering index: dashboard access pattern (company + status filter, recency sort, all returned columns in the index)
CREATE INDEX IF NOT EXISTS idx_operations_read_model_dashboard
  ON operations_read_model (company_id, status, created_at DESC, order_id DESC)
  INCLUDE (worker_id, worker_name, amount_cents, last_event_kind);

CREATE TABLE IF NOT EXISTS company_totals (
  company_id INTEGER PRIMARY KEY,
  pending_count INTEGER NOT NULL DEFAULT 0,
  pending_amount BIGINT NOT NULL DEFAULT 0,
  approved_count INTEGER NOT NULL DEFAULT 0,
  approved_amount BIGINT NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  rejected_amount BIGINT NOT NULL DEFAULT 0,
  refunded_count INTEGER NOT NULL DEFAULT 0,
  refunded_amount BIGINT NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Prisma's `@@index([orderId, [createdAt(sort: SortOrder.Desc), id(sort: SortOrder.Desc)]])` — does that syntax exist? Prisma docs: descending indexes:
```prisma
@@index([firstName, [lastName(sort: Desc)]])
```
Hmm, actually I recall: `@index([userId, [createdAt(sort: Desc)]])`. Yes, Prisma 4.7+ supports sort order in indexes. I'll use it. Even if a bit off, the migration SQL is the truth. To minimize the risk of schema parse errors, I could omit the descending index from the schema and let the migration own it. Safer: don't declare an index that Prisma can't express; the schema declares only what Prisma can express. Let me declare in the schema: payment_orders indexes (companyId), (createdAt); order_events @@index([orderId, createdAt, id]) (ascending — close enough for the prefix of the lookup pattern; the migration adds the descending version). Hmm, two similar indexes (asc + desc) on the same columns = bloat. Decision: the schema declares `@@index([orderId, createdAt, id])`; the migration creates only the descending version. If someone runs `prisma migrate dev` fresh, the schema diff will… this is an exercise; I'll note in a schema comment that the exact index shape (with DESC + INCLUDE) lives in the migration. Actually — to keep schema ↔ migration consistent (a reviewer will check "every schema change ships with a migration"), let me make the migration the full DDL, and have the schema declare a matching index except for what can't be expressed, with comments. The order_events index: declare `@@index([orderId, [createdAt(sort: Desc), id(sort: Desc)]])` — I'm fairly confident this parses in modern Prisma (5.x). I'll keep it. And operation rows: no index in the schema (the covering one is in the migration) — with a comment.

**DESIGN.md** contents:
- Problem, constraints (read-your-own-writes, exact totals, p95 < 50ms).
- Chosen design: a synchronous in-transaction maintenance hook (the write service calls the projection hook inside the same Prisma transaction), a projection table shaped like the query, an atomic in-place increment on the totals (no read-modify-write), an idempotent re-derivation, a periodic drift repair, a covering index.
- Why this satisfies each acceptance criterion.
- Alternatives considered and rejected:
  1. Materialized view / scheduled refresh — violates read-your-own-writes (a window exists for any interval); REFRESH is a full scan (unbounded cost at 3M rows), locks during refresh.
  2. Outbox + async worker (CDC / queue) — eventual visibility window; ordering/complication; exact totals need careful replay; adds infrastructure; violates the constraint.
  3. Postgres trigger — DB-level, not testable via the app layer, versioning in SQL, Prisma-managed schema drift, hidden cost on every write; hooks in the service = explicit, testable, and co-located with the write logic; a trigger is also in-transaction (equally correct) but less portable/observable. Rejected primarily for visibility/testability, not correctness.
  4. A faster join + indexes — at 3M rows, a 20-30s join won't reach 50ms p95; no total; doesn't fix it.
  5. Application-level lock/queue around the totals (a mutex in the app) — serializes writers across instances, lost on crash; the DB row lock via atomic increment is cheaper and exact.
- Concurrency notes: guarded UPDATE for the same order (atomic from→to), row-level atomic increment for the totals (Postgres serializes concurrent increments on the same row), a recompute for idempotency.
- Failure modes and the drift job: a deploy mid-transaction, a manual fix, a hook added later (a backfill via re-derivation); the job's window; re-derivation is the backfill.
- Operational notes: the covering index, a note on EXPLAIN, the p95 target.
- A brief note on the environment: DATABASE_URL, DRIFT_REPAIR_CRON, DRIFT_REPAIR_WINDOW_DAYS.

**File list**:

1. `package.json`
2. `tsconfig.json`
3. `vitest.config.ts`
4. `prisma/schema.prisma`
5. `prisma/migrations/20240601000000_init/migration.sql`
6. `src/main.ts`
7. `src/app.module.ts`
8. `src/prisma/prisma.module.ts`
9. `src/prisma/prisma.service.ts`
10. `src/common/api-error.ts`
11. `src/common/error-envelope.filter.ts`
12. `src/payment-orders/payment-orders.module.ts`
13. `src/payment-orders/payment-orders.controller.ts`
14. `src/payment-orders/payment-orders.service.ts`
15. `src/payment-orders/payment-orders.repository.ts`
16. `src/operations/operations.module.ts`
17. `src/operations/operations.controller.ts`
18. `src/operations/operations.service.ts`
19. `src/operations/operations.repository.ts`
20. `src/operations/projection-maintenance.service.ts`
21. `src/operations/reprojection.service.ts`
22. `src/drift-repair/drift-repair.module.ts`
23. `src/drift-repair/drift-repair.job.ts`
24. `test/helpers.ts`
25. `test/payment-orders.spec.ts`
26. `test/operations.spec.ts`
27. `DESIGN.md`

A shared type for Status — `src/common/status.ts`? Put the Status type + STATUS list in `src/operations/types.ts`? The totals delta type is used in operations + maintenance. Keep in `src/operations/types.ts`. Hmm, payment-orders also needs Status. Put `Status`, `ALL_STATUSES`, `OperationRowData`, `TotalsDelta`, `CompanyTotals` in `src/common/types.ts`. Good.

Now let me write the code carefully.

---

`src/common/api-error.ts`:
```ts
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
```

`src/common/error-envelope.filter.ts`:
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '@prisma/client';
import { ApiError } from './api-error';

const CODE_BY_STATUS: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'validation_failed',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'validation_failed',
  [HttpStatus.CONFLICT]: 'conflict',
  [HttpStatus.NOT_FOUND]: 'resource_not_found',
};

@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal_error';
    let message = 'An unexpected error occurred';
    let details: Record<string, unknown> = {};

    if (exception instanceof ApiError) {
      status = exception.statusCode;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      status = exception.code === 'P2025' ? HttpStatus.NOT_FOUND : HttpStatus.CONFLICT;
      code = status === HttpStatus.NOT_FOUND ? 'resource_not_found' : 'conflict';
      message = `Prisma error ${exception.code}`;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = CODE_BY_STATUS[status] ?? 'error';
      message = exception.message;
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    response.status(status).json({ error: { code, message, details } });
  }
}
```
`import type { Response } from 'express'` — NestJS uses express by default; @types/express isn't in the deps… I can add `@types/express` to devDeps. OK, add it.

`src/common/types.ts`:
```ts
export const STATUSES = ['pending', 'approved', 'rejected', 'refunded'] as const;
export type Status = (typeof STATUSES)[number];

export interface OperationRowData {
  orderId: number;
  companyId: number;
  workerId: number;
  workerName: string | null;
  status: Status;
  amountCents: number;
  lastEventKind: string | null;
  createdAt: Date;
}

export interface CompanyTotalsData {
  companyId: number;
  pendingCount: number;
  pendingAmountCents: number;
  approvedCount: number;
  approvedAmountCents: number;
  rejectedCount: number;
  rejectedAmountCents: number;
  refundedCount: number;
  refundedAmountCents: number;
  version: number;
}

export type TotalsDelta = Record<Status, { count: number; amountCents: number }>;

export function zeroTotals(companyId: number): CompanyTotalsData { ... }
export function emptyTotalsDelta(): TotalsDelta { ... }
```

`src/prisma/prisma.service.ts`:
```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> { await this.$connect(); }
  async onModuleDestroy(): Promise<void> { await this.$disconnect(); }
}
```

`src/prisma/prisma.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
```

`src/operations/operations.repository.ts` — the big one.

```ts
import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CompanyTotalsData, OperationRowData, Status, TotalsDelta } from '../common/types';

export type Db = PrismaClient | Prisma.TransactionClient;

@Injectable()
export class OperationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Dashboard query: projection only, matches the covering index. */
  async listOperations(db: Db, q: {
    companyId: number;
    statuses: readonly Status[];
    from: Date;
    to: Date;
    limit: number;
    offset: number;
  }): Promise<{ items: OperationRowData[]; total: number }> {
    const rows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT order_id, company_id, worker_id, worker_name, status, amount_cents, last_event_kind, created_at,
             count(*) OVER () AS total
      FROM operations_read_model
      WHERE company_id = ${q.companyId}
        AND status = ANY(${q.statuses})
        AND created_at >= ${q.from}
        AND created_at < ${q.to}
      ORDER BY created_at DESC, order_id DESC
      LIMIT ${q.limit} OFFSET ${q.offset}
    `);
    ...map
  }
```
Does Prisma.sql with an array parameter work? Prisma's raw query: passing a `string[]` as a parameter → converted to a Postgres array. Yes (Prisma supports arrays in raw queries).

`status = ANY($2)` with `$2` being a text array: the `status` column is text → OK.

Date parameters: Prisma converts Date → timestamptz. OK.

Mapping the rows: `order_id` → number (int4 → number), `created_at` → Date.

  async getCompanyTotals(db: Db, companyId: number): Promise<CompanyTotalsData> {
    const rows = await db.$queryRaw<...>(Prisma.sql`SELECT ... FROM company_totals WHERE company_id = ${companyId}`);
    if (!rows[0]) return zeroTotals(companyId);
    Normalize BigInt/string → number via Number().
  }

  /** Recompute one projection row from the source (order + worker + last event). */
  async recomputeOperationRow(db: Db, orderId: number): Promise<OperationRowData | null> {
    const rows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT po.id AS order_id, po.company_id, po.worker_id, w.name AS worker_name,
             po.status, po.amount_cents, po.created_at,
             (SELECT oe.kind FROM order_events oe
               WHERE oe.order_id = po.id
               ORDER BY oe.created_at DESC, oe.id DESC
               LIMIT 1) AS last_event_kind
      FROM payment_orders po
      LEFT JOIN workers w ON w.id = po.worker_id
      WHERE po.id = ${orderId}
    `);
    return rows[0] ? map : null;
  }

  /** Idempotent upsert of one projection row (absolute values from source). */
  async upsertOperationRow(db: Db, row: OperationRowData): Promise<void> {
    await db.$executeRaw(Prisma.sql`
      INSERT INTO operations_read_model (order_id, company_id, worker_id, worker_name, status, amount_cents, last_event_kind, created_at, maintained_at)
      VALUES (${row.orderId}, ${row.companyId}, ${row.workerId}, ${row.workerName}, ${row.status}, ${row.amountCents}, ${row.lastEventKind}, ${row.createdAt}, now())
      ON CONFLICT (order_id) DO UPDATE SET
        company_id = EXCLUDED.company_id,
        worker_id = EXCLUDED.worker_id,
        worker_name = EXCLUDED.worker_name,
        status = EXCLUDED.status,
        amount_cents = EXCLUDED.amount_cents,
        last_event_kind = EXCLUDED.last_event_kind,
        created_at = EXCLUDED.created_at,
        maintained_at = now()
    `);
  }

  /** Atomic in-place totals adjustment — never a read-modify-write. */
  async applyTotalsDelta(db: Db, companyId: number, d: TotalsDelta): Promise<void> {
    await db.$executeRaw(Prisma.sql`
      INSERT INTO company_totals
        (company_id, pending_count, pending_amount, approved_count, approved_amount, rejected_count, rejected_amount, refunded_count, refunded_amount, version, updated_at)
      VALUES
        (${companyId},
         ${d.pending.count}, ${d.pending.amountCents},
         ${d.approved.count}, ${d.approved.amountCents},
         ${d.rejected.count}, ${d.rejected.amountCents},
         ${d.refunded.count}, ${d.refunded.amountCents},
         1, now())
      ON CONFLICT (company_id) DO UPDATE SET
        pending_count = company_totals.pending_count + EXCLUDED.pending_count,
        pending_amount = company_totals.pending_amount + EXCLUDED.pending_amount,
        approved_count = company_totals.approved_count + EXCLUDED.approved_count,
        approved_amount = company_totals.approved_amount + EXCLUDED.approved_amount,
        rejected_count = company_totals.rejected_count + EXCLUDED.rejected_count,
        rejected_amount = company_totals.rejected_amount + EXCLUDED.rejected_amount,
        refunded_count = company_totals.refunded_count + EXCLUDED.refunded_count,
        refunded_amount = company_totals.refunded_amount + EXCLUDED.refunded_amount,
        version = company_totals.version + 1,
        updated_at = now()
    `);
  }

  /** Recompute the totals rows (absolute values) for the given companies from the source. */
  async recomputeCompanyTotals(db: Db, companyIds: readonly number[]): Promise<void> {
    if (companyIds.length === 0) return;
    await db.$executeRaw(Prisma.sql`
      INSERT INTO company_totals AS ct
        (company_id, pending_count, pending_amount, approved_count, approved_amount, rejected_count, rejected_amount, refunded_count, refunded_amount, version, updated_at)
      SELECT po.company_id,
        COALESCE(count(*) FILTER (WHERE po.status = 'pending'), 0)::int,
        COALESCE(sum(po.amount_cents) FILTER (WHERE po.status = 'pending'), 0)::bigint,
        ... approved / rejected / refunded
      FROM payment_orders po
      WHERE po.company_id = ANY(${companyIds})
      GROUP BY po.company_id
      ON CONFLICT (company_id) DO UPDATE SET
        pending_count = EXCLUDED.pending_count,
        pending_amount = EXCLUDED.pending_amount,
        approved_count = EXCLUDED.approved_count,
        approved_amount = EXCLUDED.approved_amount,
        rejected_count = EXCLUDED.rejected_count,
        rejected_amount = EXCLUDED.rejected_amount,
        refunded_count = EXCLUDED.refunded_count,
        refunded_amount = EXCLUDED.refunded_amount,
        version = ct.version + 1,
        updated_at = now()
    `);
  }

  async sourceOrdersInWindow(db: Db, from: Date, to: Date, afterId: number, limit: number) {
    const rows = await db.$queryRaw<{ id: number; company_id: number }[]>(Prisma.sql`
      SELECT id, company_id FROM payment_orders
      WHERE created_at >= ${from} AND created_at < ${to} AND id > ${afterId}
      ORDER BY id
      LIMIT ${limit}
    `);
    return rows;
  }

  async countDriftedOrders(db: Db, from: Date, to: Date): Promise<number> { ... CTE ... }
  async countDriftedCompanies(db: Db, from: Date, to: Date): Promise<number> { ... }
```

Wait — one problem with `INSERT INTO company_totals AS ct ... SELECT ...`: does Postgres allow an alias on the INSERT target? Yes: `INSERT INTO tbl AS alias (cols) ... ON CONFLICT DO UPDATE SET x = alias.x + 1` is valid.

`$queryRaw` generics: with typed objects, it's fine.

Another subtlety: `Prisma.sql` inside a template literal containing `${companyIds}` (a number[]) — Prisma converts number[] to a Postgres int array. OK.

`count(*) OVER ()` returns a bigint → a string via the driver. Map with Number().

**operations.service.ts**:

```ts
export interface OperationQuery {
  companyId: number;
  statuses?: Status[];
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

@Injectable()
export class OperationsService {
  constructor(private readonly repo: OperationsRepository) {}

  async listOperations(query: OperationQuery): Promise<{items, total, page, pageSize}> {
    const from = query.from ?? new Date(0);
    const to = query.to ?? new Date(Date.now() + 1); // future-safe: include everything up to now
    const statuses = query.statuses ?? STATUSES;
    const { items, total } = await this.repo.listOperations(this.prisma?, { companyId, statuses, from, to, limit: pageSize, offset: (page-1)*pageSize });
    return { items, total, page, pageSize };
  }

  async getCompanyTotals(companyId: number) { return this.repo.getCompanyTotals(prisma, companyId); }
}
```
The service needs a Db = PrismaService injected (calling repo methods with a `this.prisma` client — the service holds a reference but makes zero Prisma calls — passing the client to the repository is acceptable; the service itself doesn't call Prisma methods). Hmm — is passing the PrismaService to repository methods a "Prisma client call in the service"? No. OK.

Actually simpler: the repository methods that take a `db` parameter are for the in-transaction use; for the non-tx use, the service passes `this.prisma`. Good.

**reprojection.service.ts**:

```ts
@Injectable()
export class ReprojectionService {
  constructor(private readonly prisma: PrismaService, private readonly repo: OperationsRepository) {}

  /**
   * Rebuild the projection for [from, to) from the source tables.
   * Idempotent (absolute-value upsert + absolute-value totals recomputation) and safe
   * while the system is live (short per-batch transactions, no shared locks).
   */
  async rederive(from: Date, to: Date): Promise<{ orders: number; companies: number }> {
    const BATCH = 500;
    let cursor = 0;
    let orders = 0;
    const companies = new Set<number>();
    for (;;) {
      const batch = await this.repo.sourceOrdersInWindow(this.prisma, from, to, cursor, BATCH);
      if (batch.length === 0) break;
      const batchCompanyIds = [...new Set(batch.map((b) => b.company_id))];
      await this.prisma.$transaction(async (tx) => {
        for (const b of batch) {
          const row = await this.repo.recomputeOperationRow(tx, b.id);
          if (row) await this.repo.upsertOperationRow(tx, row);
        }
        await this.repo.recomputeCompanyTotals(tx, batchCompanyIds);
      });
      orders += batch.length;
      for (const c of batchCompanyIds) companies.add(c);
      cursor = batch[batch.length - 1].id;
      if (batch.length < BATCH) break;
    }
    return { orders, companies: companies.size };
  }
}
```
Wait — the `this.prisma.$transaction` call is in the service — is that a "Prisma client call in the service"?? A strict reading: "the service holds the logic. Zero raw SQL, zero Prisma client calls." `$transaction` is a Prisma client call! Ugh. Then the transaction has to live in the repository. But the re-derivation batches… I can expose a repository method `rederiveWindow(from, to, afterId, limit)` that does one batch inside a transaction:

```ts
// repository
async rederiveBatch(from, to, afterId, limit): Promise<{ rows: {id, company_id}[], nextCursor: number }> {
  return this.prisma.$transaction(async (tx) => {
    const batch = await this.sourceOrdersInWindow(tx, from, to, afterId, limit);
    for (const b of batch) { const row = await this.recomputeOperationRow(tx, b.id); if (row) await this.upsertOperationRow(tx, row); }
    await this.recomputeCompanyTotals(tx, [...new Set(batch.map(b=>b.company_id))]);
    return batch;
  });
}
```
And the service loops calling `repo.rederiveBatch` — all Prisma calls are in the repository. The loop logic (cursor) is in the service. This respects the layering cleanly.

Similarly, the PaymentOrdersRepository.transition does the $transaction. And the create path: the service needs "run these steps inside one transaction with a hook callback." Repository:

```ts
async createWithMaintenance(orderId?? ...)
```
Hmm, the create needs the service's hook callback inside the transaction. Pattern:

```ts
// payment-orders.repository.ts
async runInTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return this.prisma.$transaction(work);
}
```
The service:
```ts
return this.repo.runInTransaction(async (tx) => {
  const order = await this.repo.insertOrder(tx, input);
  await this.repo.insertEvent(tx, order.id, 'created');
  await this.projections.onOrderCreated(tx, order.id);
  return order;
});
```
The service passes a callback that calls the projection service — "the hook is invoked by the write service" ✓, "inside the transaction that writes the source row" ✓, the service has zero Prisma calls (it calls repo.runInTransaction with a callback) ✓. The callback isn't executed by the service directly, but… the service invokes the hook functionally (it's the service's code that calls `this.projections.onOrderCreated`). I think that's the most defensible reading. I'll add a comment.

`transition` similarly with an `after` callback:
```ts
async transitionInTransaction(orderId: number, from: Status, to: Status, work: (tx: Prisma.TransactionClient) => Promise<unknown>): Promise<number> {
  return this.prisma.$transaction(async (tx) => {
    const res = await tx.paymentOrder.updateMany({ where: { id: orderId, status: from }, data: { status: to } });
    if (res.count === 0) {
      const existing = await tx.paymentOrder.findUnique({ where: { id: orderId }, select: { id: true, status: true } });
      if (!existing) throw new ApiError(404, 'resource_not_found', `Payment order ${orderId} does not exist`, { orderId });
      throw new ApiError(409, 'invalid_state_transition', `Payment order ${orderId} cannot move ${from} -> ${to}; current status is ${existing.status}`, { orderId, from, to, current: existing.status });
    }
    await work(tx);
    return orderId;
  });
}
```
The updateMany with a status guard — atomic transition; concurrent transitions to the same order serialize on the row lock; the loser sees 0 rows → 409.

insertOrder / insertEvent:
```ts
async insertOrder(tx, input): Promise<PaymentOrder> { return tx.paymentOrder.create({ data: input }); }
async insertEvent(tx, orderId, kind) { await tx.orderEvent.create({ data: { orderId, kind } }); }
async findById(id): Promise<PaymentOrder | null> { return this.prisma.paymentOrder.findUnique({ where: { id } }); }
async workerExists(id): Promise<boolean> { return (await this.prisma.worker.findUnique({ where: { id }, select: { id: true } })) !== null; }
```

**payment-orders.service.ts**:

```ts
const TRANSITIONS = {
  approve: { from: 'pending', to: 'approved', event: 'approved' },
  reject: { from: 'pending', to: 'rejected', event: 'rejected' },
  refund: { from: 'approved', to: 'refunded', event: 'refunded' },
} as const;
export type OrderAction = keyof typeof TRANSITIONS;

@Injectable()
export class PaymentOrdersService {
  constructor(
    private readonly repo: PaymentOrdersRepository,
    private readonly projections: ProjectionMaintenanceService,
  ) {}

  async create(input: { companyId: number; workerId: number; amountCents: number }) {
    if (!(await this.repo.workerExists(input.workerId))) {
      throw new ApiError(400, 'validation_failed', `Worker ${input.workerId} does not exist`, { workerId: input.workerId });
    }
    return this.repo.runInTransaction(async (tx) => {
      const order = await this.repo.insertOrder(tx, input);
      await this.repo.insertEvent(tx, order.id, 'created');
      // Synchronous maintenance hook: same transaction as the source write.
      await this.projections.onOrderCreated(tx, order.id);
      return order;
    });
  }

  async act(action: OrderAction, orderId: number) {
    const t = TRANSITIONS[action];
    const order = await this.repo.findById(orderId);
    if (!order) throw new ApiError(404, 'resource_not_found', ...);
    if (order.status !== t.from) throw new ApiError(409, 'invalid_state_transition', ...);
    return this.repo.transitionInTransaction(orderId, t.from, t.to, async (tx) => {
      await this.repo.insertEvent(tx, orderId, t.event);
      await this.projections.onOrderStatusChanged(tx, orderId, t.from, t.to);
    });
  }
  approve(id) { return this.act('approve', id); }
  reject(id) { return this.act('reject', id); }
  refund(id) { return this.act('refund', id); }
}
```

**projection-maintenance.service.ts**:

```ts
@Injectable()
export class ProjectionMaintenanceService {
  constructor(private readonly repo: OperationsRepository) {}

  onOrderCreated(tx: Prisma.TransactionClient, orderId: number): Promise<void> {
    return this.apply(tx, orderId, { created: true, from: 'pending', to: 'pending' });
  }
  onOrderStatusChanged(tx: Prisma.TransactionClient, orderId: number, from: Status, to: Status): Promise<void> {
    return this.apply(tx, orderId, { created: false, from, to });
  }
  private async apply(tx, orderId, change: { created: boolean; from: Status; to: Status }) {
    const row = await this.repo.recomputeOperationRow(tx, orderId);
    if (!row) throw new ApiError(409, 'invalid_state_transition', `Order ${orderId} vanished mid-write`, { orderId });
    await this.repo.upsertOperationRow(tx, row);
    const delta = emptyTotalsDelta();
    const amount = row.amountCents;
    if (change.created) { delta[change.to] = { count: 1, amountCents: amount }; }
    else { delta[change.from] = { count: -1, amountCents: -amount }; delta[change.to] = { count: 1, amountCents: amount }; }
    await this.repo.applyTotalsDelta(tx, row.companyId, delta);
  }
}
```

**operations.controller.ts**:

```ts
@Controller()
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get('operations')
  list(
    @Query('companyId') companyIdRaw: string,
    @Query('status') statusRaw?: string | string[],
    @Query('from') fromRaw?: string,
    @Query('to') toRaw?: string,
    @Query('page') pageRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
  ) {
    const companyId = parsePositiveInt(companyIdRaw, 'companyId');
    const statuses = parseStatuses(statusRaw);
    const from = parseDate(fromRaw, 'from');
    const to = parseDate(toRaw, 'to');
    if (from && to && from >= to) throw new ApiError(400, 'validation_failed', 'from must be earlier than to', {});
    const page = parsePositiveInt(pageRaw ?? '1', 'page');
    const pageSize = parsePositiveInt(pageSizeRaw ?? '20', 'pageSize');
    if (pageSize > 100) throw new ApiError(400, 'validation_failed', 'pageSize must be <= 100', {});
    return this.operations.listOperations({ companyId, statuses, from, to, page, pageSize });
  }

  @Get('company-totals/:companyId')
  totals(@Param('companyId') companyIdRaw: string) {
    const companyId = parsePositiveInt(companyIdRaw, 'companyId');
    return this.operations.getCompanyTotals(companyId);
  }
}
```
parsePositiveInt: throws an ApiError 400 validation_failed with details {field}. companyId is required: if undefined → validation_failed.

**payment-orders.controller.ts**:
```ts
@Controller('payment-orders')
export class PaymentOrdersController {
  constructor(private readonly orders: PaymentOrdersService) {}

  @Post()
  create(@Body() body: { companyId?: unknown; workerId?: unknown; amountCents?: unknown }) {
    const companyId = parsePositiveInt(body?.companyId, 'companyId');
    const workerId = parsePositiveInt(body?.workerId, 'workerId');
    const amountCents = parsePositiveInt(body?.amountCents, 'amountCents');
    return this.orders.create({ companyId, workerId, amountCents });
  }

  @Post(':id/approve')
  approve(@Param('id') idRaw: string) { return this.orders.approve(parsePositiveInt(idRaw, 'id')); }
  @Post(':id/reject') reject(...) 
  @Post(':id/refund') refund(...)
}
```
parsePositiveInt accepts number | string (body may be a number). The signature: `parsePositiveInt(value: unknown, field: string): number`.

**drift-repair.job.ts**:
```ts
@Injectable()
export class DriftRepairJob {
  private running = false;
  constructor(
    private readonly repo: OperationsRepository,
    private readonly reproject: ReprojectionService,
    private readonly logger: Logger? — use @nestjs/common's Logger
  ) {}

  @Cron(process.env.DRIFT_REPAIR_CRON ?? '*/5 * * * *')
  async runScheduled(): Promise<void> {
    if (this.running) { this.logger.warn('skipping overlapping drift-repair run'); return; }
    this.running = true;
    try { await this.run(); } finally { this.running = false; }
  }

  async run(windowDays: number = readWindowDays()): Promise<DriftRepairReport> {
    const to = new Date();
    const from = new Date(to.getTime() - windowDays * 86_400_000);
    const [driftedOrders, driftedCompanies] = await Promise.all([
      this.repo.countDriftedOrders(this.prisma?, from, to),
      this.repo.countDriftedCompanies(...),
    ]);
    let repaired: { orders: number; companies: number } | null = null;
    if (driftedOrders > 0 || driftedCompanies > 0) {
      repaired = await this.reproject.rederive(from, to);
    }
    const report = { windowFrom: from, windowTo: to, driftedOrders, driftedCompanies, repaired };
    this.logger.log(`drift repair: window=[${from}..${to}] driftedOrders=${driftedOrders} driftedCompanies=${driftedCompanies} repaired=${...}`);
    return report;
  }
}
```
Needs PrismaService for the db parameter (repo methods take a Db). Inject PrismaService. The repo methods take a db parameter — pass `this.prisma`.

Hmm — a design smell: every repo method takes a Db. Alternative: the repo holds a `this.prisma` default, and the methods take an optional `db?: Db` with `const c = db ?? this.prisma`. More concise at call sites: `this.repo.countDriftedOrders(from, to)` outside a tx, `this.repo.upsertOperationRow(tx, row)` inside. I'll use the optional parameter: `async upsertOperationRow(row: OperationRowData, db?: Db)`. The first parameter is data, the last is an optional db. Cleaner.

**modules**:

operations.module.ts:
```ts
@Module({
  controllers: [OperationsController],
  providers: [OperationsService, OperationsRepository, ProjectionMaintenanceService, ReprojectionService],
  exports: [OperationsRepository, ProjectionMaintenanceService, ReprojectionService],
})
export class OperationsModule {}
```
payment-orders.module.ts:
```ts
@Module({
  imports: [OperationsModule],
  controllers: [PaymentOrdersController],
  providers: [PaymentOrdersService, PaymentOrdersRepository],
})
export class PaymentOrdersModule {}
```
drift-repair.module.ts:
```ts
@Module({ imports: [OperationsModule], providers: [DriftRepairJob] })
export class DriftRepairModule {}
```
app.module.ts:
```ts
@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, OperationsModule, PaymentOrdersModule, DriftRepairModule],
})
export class AppModule {}
```
main.ts:
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ErrorEnvelopeFilter } from './common/error-envelope.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new ErrorEnvelopeFilter());
  await app.listen(Number(process.env.PORT ?? 3000));
}
void bootstrap();
```

Now the test file.

test/helpers.ts:
```ts
import { fs } from 'node:fs/promises';
import path from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ErrorEnvelopeFilter } from '../src/common/error-envelope.filter';

// The drift job must not fire mid-test; 02:31 on Feb 31 never happens.
process.env.DRIFT_REPAIR_CRON = '0 31 2 2 *';
```
Wait, Feb 31: cron day-of-month 31 in February — the cron library might still schedule it (it just won't fire because the date doesn't exist — cron implementations skip impossible dates). '0 31 2 2 *' = minute 0, hour 31? No — cron fields: minute hour day-of-month month day-of-week. '0 31 2 2 *' → minute 0, hour 31 (impossible hour!). Hour 31 never fires. Use `0 31 1 1 *`? Hour 31 is impossible → safe. Hmm, but if the cron library throws on an invalid hour… cron-validate might reject hour 31. Safer: a valid expression that never fires in a short test: `0 0 31 2 *` (Feb 31 — impossible date; the standard cron library treats it as "never fires," not an error). I'll use that.

```ts
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalFilters(new ErrorEnvelopeFilter());
  await app.init();
  return app;
}

export function prismaOf(app: INestApplication): PrismaService { return app.get(PrismaService); }

/** Apply the checked-in migration DDL (idempotent) so the spec runs against a fresh DB. */
export async function ensureSchema(prisma: PrismaService): Promise<void> {
  const migrationsDir = path.resolve(process.cwd(), 'prisma', 'migrations');
  const entries = (await fs.readdir(migrationsDir)).filter((e) => e !== 'migration_lock.toml').sort();
  for (const entry of entries) {
    const sql = await fs.readFile(path.join(migrationsDir, entry, 'migration.sql'), 'utf8');
    for (const statement of sql.split(/;\r?\n/)) {
      const trimmed = statement.trim();
      if (trimmed) await prisma.$executeRawUnsafe(trimmed);
    }
  }
}

export async function resetTables(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE order_events, operations_read_model, company_totals, payment_orders, workers RESTART IDENTITY CASCADE`,
  );
}
```
The migration splitting: my migration.sql ends statements with `;\n`. `split(/;\r?\n/)` works if every statement ends with `;` + newline and the file has no `;` inside strings — my SQL has no `;` in string literals. OK. I'll ensure the migration file has no inline comments with `;`… comments are fine.

Hmm — TRUNCATE with a list + RESTART IDENTITY: `TRUNCATE a, b, ... RESTART IDENTITY CASCADE` — valid syntax: `TRUNCATE [TABLE] name [, ...] [RESTART IDENTITY | CONTINUE IDENTITY] [CASCADE | RESTRICT]`. Yes.

But note: `ensureSchema` runs before `resetTables`? The tables must exist to truncate. beforeAll: create app → ensureSchema → done; beforeEach: resetTables. Good.

The PrismaService onModuleInit connects — requires DATABASE_URL. A comment at the top of the test file: `Requires DATABASE_URL pointing at a throwaway Postgres database.`

test/payment-orders.spec.ts:

```ts
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { PaymentOrdersService } from '../src/payment-orders/payment-orders.service';
import { PaymentOrdersRepository } from '../src/payment-orders/payment-orders.repository';
import { OperationsService } from '../src/operations/operations.service';
import { ApiError } from '../src/common/api-error';
import { createTestApp, ensureSchema, prismaOf, resetTables } from './helpers';

describe('payment order write path (simulated)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orders: PaymentOrdersService;
  let ops: OperationsService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = prismaOf(app);
    await ensureSchema(prisma);
    orders = app.get(PaymentOrdersService);
    ops = app.get(OperationsService);
  });
  beforeEach(async () => { await resetTables(prisma); });
  afterAll(async () => { await app.close(); });

  it('approve -> the next dashboard request shows the approved order and the exact totals', async () => {
    const worker = await prisma.worker.create({ data: { companyId: 1, name: 'Ana' } });
    const created = await orders.create({ companyId: 1, workerId: worker.id, amountCents: 12000 });
    // Visible as pending before the write? The create hook ran: assert pending total.
    let totals = await ops.getCompanyTotals(1);
    expect(totals.pendingCount).toBe(1);
    await orders.approve(created.id);
    const page = await ops.listOperations({ companyId: 1, page: 1, pageSize: 20 });
    const item = page.items.find((i) => i.orderId === created.id);
    expect(item).toBeDefined();
    expect(item!.status).toBe('approved');
    expect(item!.lastEventKind).toBe('approved');
    expect(item!.workerName).toBe('Ana');
    totals = await ops.getCompanyTotals(1);
    expect(totals.pendingCount).toBe(0);
    expect(totals.approvedCount).toBe(1);
    expect(totals.approvedAmountCents).toBe(12000);
  });

  it('rejects a transition that is not allowed for the current status', async () => {
    const worker = await prisma.worker.create({ data: { companyId: 1, name: 'Ana' } });
    const order = await orders.create({ companyId: 1, workerId: worker.id, amountCents: 500 });
    await orders.approve(order.id);
    await expect(orders.approve(order.id)).rejects.toMatchObject({ code: 'invalid_state_transition', statusCode: 409 });
    // refund from rejected is invalid
    await expect(orders.refund(order.id)).resolves.toBeDefined(); // approved -> refunded is valid
    await expect(orders.reject(order.id)).rejects.toMatchObject({ code: 'invalid_state_transition' });
  });

  it('returns resource_not_found for a missing order', async () => {
    await expect(orders.approve(999999)).rejects.toMatchObject({ code: 'resource_not_found', statusCode: 404 });
  });

  it('a rolled-back write leaves no trace in the projection or the totals', async () => {
    const worker = await prisma.worker.create({ data: { companyId: 2, name: 'Bo' } });
    const order = await orders.create({ companyId: 2, workerId: worker.id, amountCents: 777 });
    const repo = app.get(PaymentOrdersRepository);
    await expect(
      repo.transitionInTransaction(order.id, 'pending', 'approved', async (tx) => {
        await tx.$executeRawUnsafe(`UPDATE company_totals SET approved_amount = approved_amount + 1 WHERE company_id = 2`);
        throw new Error('simulate a mid-transaction failure');
      }),
    ).rejects.toThrow('simulate a mid-transaction failure');
    const fresh = await prisma.paymentOrder.findUnique({ where: { id: order.id } });
    expect(fresh!.status).toBe('pending');
    const totals = await ops.getCompanyTotals(2);
    expect(totals.pendingCount).toBe(1);
    expect(totals.pendingAmountCents).toBe(777);
    expect(totals.approvedCount).toBe(0);
    expect(totals.approvedAmountCents).toBe(0);
  });

  it('keeps one company totals exact when approvals run concurrently', async () => {
    const worker = await prisma.worker.create({ data: { companyId: 7, name: 'Cy' } });
    const amounts = [1000, 2500, 4000, 555];
    const created = [];
    for (const a of amounts) created.push(await orders.create({ companyId: 7, workerId: worker.id, amountCents: a }));
    await Promise.all(created.map((o) => orders.approve(o.id)));
    const totals = await ops.getCompanyTotals(7);
    expect(totals.pendingCount).toBe(0);
    expect(totals.approvedCount).toBe(4);
    expect(totals.approvedAmountCents).toBe(1000 + 2500 + 4000 + 555);
    const page = await ops.listOperations({ companyId: 7, statuses: ['approved'], page: 1, pageSize: 10 });
    expect(page.items.map(i => i.amountCents).sort((a,b)=>b-a)).toEqual([4000,2500,1000,555]);
  });
});
```

Wait — `orders.create` returns the full PaymentOrder (id, etc.). `listOperations` items — OperationRowData. `page.items` is typed.

One concern: `rejects.toMatchObject({ code: ... })` — the ApiError has the `code` property. toMatchObject on an error object works with the properties. OK.

test/operations.spec.ts:

```ts
describe('operations read model', () => {
  beforeAll: app, prisma, ops, reproject, driftJob; ensureSchema.
  beforeEach: resetTables.

  it('filters by company, status and date range, sorts by recency and paginates', async () => {
    const w1 = await prisma.worker.create({ data: { companyId: 10, name: 'A' } });
    const w2 = await prisma.worker.create({ data: { companyId: 11, name: 'B' } });
    const a = await opsSvc.create({ companyId: 10, workerId: w1.id, amountCents: 100 });
    const b = await opsSvc.create({ companyId: 10, workerId: w1.id, amountCents: 200 });
    const c = await opsSvc.create({ companyId: 10, workerId: w1.id, amountCents: 300 });
    const d = await opsSvc.create({ companyId: 11, workerId: w2.id, amountCents: 500 });
    await Promise.all([approve(a), approve(b), approve(d), reject(c)]);
    // backdate a by 2 hours in the source, then re-derive so the projection carries it
    await prisma.$executeRawUnsafe(`UPDATE payment_orders SET created_at = now() - interval '2 hours' WHERE id = ${a.id}`);
    const { reproject } = ...; await reproject.rederive(new Date(0), new Date(Date.now() + 60000));

    const all = await ops.listOperations({ companyId: 10, page: 1, pageSize: 10 });
    expect(all.total).toBe(3);
    expect(all.items.map((i) => i.orderId)).toEqual([c.id, b.id, a.id]); // most recent first

    const onlyApproved = await ops.listOperations({ companyId: 10, statuses: ['approved'], page: 1, pageSize: 10 });
    expect(onlyApproved.items.map((i) => i.orderId)).toEqual([b.id, a.id]);

    const from = new Date(Date.now() - 3600e3); // last hour: excludes backdated a
    const recent = await ops.listOperations({ companyId: 10, from, page: 1, pageSize: 10 });
    expect(recent.items.map((i) => i.orderId)).toEqual([c.id, b.id]);

    const oldOnly = await ops.listOperations({ companyId: 10, to: from, page: 1, pageSize: 10 });
    expect(oldOnly.items.map((i) => i.orderId)).toEqual([a.id]);

    // pagination
    const p1 = await ops.listOperations({ companyId: 10, page: 1, pageSize: 2 });
    expect(p1.items).toHaveLength(2); expect(p1.total).toBe(3);
    const p2 = await ops.listOperations({ companyId: 10, page: 2, pageSize: 2 });
    expect(p2.items.map((i)=>i.orderId)).toEqual([a.id]);

    // company isolation
    const other = await ops.listOperations({ companyId: 11, page: 1, pageSize: 10 });
    expect(other.items.map((i) => i.orderId)).toEqual([d.id]);
  });

  it('the dashboard reads only the projection: source-only changes are invisible until re-derivation', async () => {
    const w = await prisma.worker.create({ data: { companyId: 20, name: 'Old Name' } });
    const o = await orders.create({ companyId: 20, workerId: w.id, amountCents: 10 });
    await orders.approve(o.id);
    await prisma.$executeRawUnsafe(`UPDATE workers SET name = 'New Name' WHERE id = ${w.id}`);
    let page = await ops.listOperations({ companyId: 20, page: 1, pageSize: 10 });
    expect(page.items[0].workerName).toBe('Old Name'); // hot path does not join to workers
    await reproject.rederive(new Date(0), new Date(Date.now() + 60000));
    page = await ops.listOperations({ companyId: 20, page: 1, pageSize: 10 });
    expect(page.items[0].workerName).toBe('New Name');
  });

  it('re-derivation rebuilds a damaged window and is idempotent', async () => {
    const w = await prisma.worker.create({ data: { companyId: 30, name: 'D' } });
    const o1 = await orders.create({ companyId: 30, workerId: w.id, amountCents: 111 });
    const o2 = await orders.create({ companyId: 30, workerId: w.id, amountCents: 222 });
    await Promise.all([orders.approve(o1.id), orders.approve(o2.id)]);
    // damage
    await prisma.$executeRawUnsafe(`UPDATE operations_read_model SET status = 'pending', amount_cents = 1, last_event_kind = 'created' WHERE company_id = 30`);
    await prisma.$executeRawUnsafe(`UPDATE company_totals SET approved_amount = 1 WHERE company_id = 30`);
    const windowFrom = new Date(0); const windowTo = new Date(Date.now() + 60000);
    const first = await reproject.rederive(windowFrom, windowTo);
    expect(first.orders).toBe(2);
    const after1 = snapshot(); // projection rows + totals
    expect(after1).toEqual(expected snapshot from source);
    const second = await reproject.rederive(windowFrom, windowTo);
    const after2 = snapshot();
    expect(after2).toEqual(after1); // running twice leaves the same result
  });

  it('the drift-repair job detects and repairs injected drift', async () => {
    const w = await prisma.worker.create({ data: { companyId: 40, name: 'E' } });
    const o1 = await orders.create({ companyId: 40, workerId: w.id, amountCents: 1000 });
    const o2 = await orders.create({ companyId: 40, workerId: w.id, amountCents: 2000 });
    await Promise.all([orders.approve(o1.id), orders.approve(o2.id)]);
    // Inject drift: one row is wrong, one row is missing, the totals are off.
    await prisma.$executeRawUnsafe(`UPDATE operations_read_model SET last_event_kind = 'created' WHERE order_id = ${o1.id}`);
    await prisma.$executeRawUnsafe(`DELETE FROM operations_read_model WHERE order_id = ${o2.id}`);
    await prisma.$executeRawUnsafe(`UPDATE company_totals SET approved_amount = approved_amount + 999, approved_count = approved_count + 1 WHERE company_id = 40`);
    const report = await driftJob.run();
    expect(report.driftedOrders).toBe(2);
    expect(report.driftedCompanies).toBe(1);
    expect(report.repaired).not.toBeNull();
    // verify repair
    const page = await ops.listOperations({ companyId: 40, page: 1, pageSize: 10 });
    expect(page.items).toHaveLength(2);
    for (const i of page.items) expect(i.status).toBe('approved'); expect(i.lastEventKind).toBe('approved');
    const totals = await ops.getCompanyTotals(40);
    expect(totals.approvedCount).toBe(2);
    expect(totals.approvedAmountCents).toBe(3000);
    // a second run is clean
    const clean = await driftJob.run();
    expect(clean.driftedOrders).toBe(0);
    expect(clean.driftedCompanies).toBe(0);
  });
});
```

The snapshot helper for the idempotency test:
```ts
async function snapshot() {
  const rows = await prisma.$queryRawUnsafe(`SELECT order_id, company_id, worker_id, worker_name, status, amount_cents, last_event_kind, created_at FROM operations_read_model ORDER BY order_id`);
  const totals = await prisma.$queryRawUnsafe(`SELECT company_id, pending_count, pending_amount, approved_count, approved_amount, rejected_count, rejected_amount, refunded_count, refunded_amount FROM company_totals ORDER BY company_id`);
  return { rows, totals };
}
```
Comparing two raw results: dates are Dates, bigints are strings — consistent between runs → toEqual works. But `second` run vs `after1`: maintained_at isn't selected → equal. version isn't selected either (it increments per upsert — exclude it!). Good — select only the data columns.

Wait, in the idempotency test, after `first`, the rows should equal the source: assert that explicitly:
```ts
expect(after1.rows.map(r => r.status)).toEqual(['approved','approved']);
expect(after1.totals[0].approved_amount).toBe? — bigint string: Number(...)
```
The raw $queryRawUnsafe returns bigint as a string. I'll assert with Number conversion. Keep assertions explicit:
```ts
const t = after1.totals[0];
expect(t.approved_count).toBe(2);
expect(Number(t.approved_amount)).toBe(333);
expect(t.pending_count).toBe(0);
```
And then `expect(after2).toEqual(after1)`.

The drift report's `repaired` field: type `{ orders: number; companies: number } | null`.

Now — `countDriftedOrders` must count both the wrong row (o1: last_event_kind 'created' vs 'approved') and the missing row (o2). Both in the window (created_at is now). → 2. ✓.
`countDriftedCompanies` (company 40): totals approved_amount is off by +999 and count +1 → drift → 1. ✓.

But wait — the drift job's default window: `DRIFT_REPAIR_WINDOW_DAYS` default 1 → from = now-1d. o1/o2 were created at now → in window. The backdated order (2 hours ago) in the other test → in window, but that test doesn't run the job. OK.

Another check — the "reads only the projection" test: after `UPDATE workers SET name`, the projection keeps 'Old Name' — because the hot path reads the projection's worker_name. ✓ proves no join. And the re-derivation updates it. ✓.

Now — a potential pitfall: `listOperations` when the table is empty → items [], total 0. `count(*) OVER ()` on empty → no rows → total 0. ✓.

Another pitfall: the `Prisma.sql` template with `ANY(${statuses})` — statuses: readonly Status[] → string[]. Prisma raw: is a string[] parameter OK? Prisma's query engine converts JS arrays to Postgres arrays in raw queries — yes (documented: "arrays are supported in raw queries").

Date parameter: Date objects are supported.

`LIMIT ${q.limit} OFFSET ${q.offset}` — numbers OK.

`$queryRaw` generic: `<{ order_id: number; ... total: string }[]>` — total is bigint → string. Map: `total: Number(r.total)`.

`created_at` → the driver returns a Date for timestamptz. ✓.

`worker_name` can be null. ✓.

Now `applyTotalsDelta` — parameter: `d.pending.count` etc. are numbers. `EXCLUDED.pending_amount` is bigint + a number parameter → OK (int coerces to bigint).

Potential Prisma issue: `$executeRaw` with Prisma.sql and an alias `AS ct` in the INSERT — no problem, it's just SQL.

Now the `recomputeCompanyTotals` INSERT...SELECT with `ON CONFLICT (company_id) DO UPDATE SET ... version = ct.version + 1`. If the company's totals row doesn't exist → insert. ✓.

Edge: two different companies in the SELECT — the ON CONFLICT is per row. ✓.

**ScheduleModule** — `@nestjs/schedule` dep. `ScheduleModule.forRoot()` in AppModule. `@Cron` in the job. In tests, the cron is disabled with the env var. But wait — the `@Cron` decorator reads `process.env.DRIFT_REPAIR_CRON` at class-definition time (module import time). The test helper sets the env before importing the app module (the helper's top level sets it, and the spec imports the helper first → the helper module evaluates → the env is set before the app module import… actually ES module imports are hoisted: the spec's `import { createTestApp } from './helpers'` and `import { PaymentOrdersService } from ...` — all imports evaluate in order; the helpers module body (the env assignment) runs when the helpers module is evaluated, which is when the spec imports it — but the src module is imported later in the spec's import list? Import evaluation order: the spec's imports are evaluated in written order. If `import './helpers'` (the env setting) comes before any src imports, the env is set first. But `createTestApp` imports AppModule internally (dynamic? no, static import in helpers → the helpers module statically imports AppModule → AppModule's imports (drift-repair.job with @Cron) are evaluated when the helpers module is evaluated — after the env line? No! Static imports inside the helpers are evaluated before the helpers' own body. So `process.env.DRIFT_REPAIR_CRON = ...` (the helpers body) runs after the drift-repair.job module (via the helpers' static import chain) evaluated → the @Cron expression is already read the default. Damn.

Fix: set the env in a separate module imported first, or read the cron lazily. Options:
1. In drift-repair.job.ts: `@Cron(() => process.env.DRIFT_REPAIR_CRON ?? '*/5 * * * *')` — does @Cron accept a function? @nestjs/schedule's `@Cron(expression)` — expression can be a string | CronExpression | function? I recall `@Cron` supports `() => string`? Hmm, not sure. Docs: `@Cron('10,20,30 * * * * *')`; also accepts `CronExpression` (an object) and `CRON.EVERY_5_MINUTES`. Function support — I don't think so.
2. A dedicated `test/env.ts` that only sets the env, imported as the first import in each spec: `import './env';` first. Import order within a spec file: the first listed import is evaluated first. `import './env'` → env.ts body runs → the env is set. Then other imports (the spec's src imports) are evaluated. But the spec imports helpers (which imports src) — order: `import './env'; import { ... } from './helpers';` → env first ✓. Fragile but works.
3. Don't rely on env: the job checks `if (this.running) return;` — the cron default every 5 min; the tests run in <5 min; the first cron tick is at +5 min (the cron library schedules the next occurrence of */5 → up to 5 min away). The test session is much shorter. Risk: if the test session runs for >5 min (unlikely) or the cron fires at a minute boundary during a long run. Also vitest's teardown — the interval is cleared on app.close(). Actually, `@Cron` with '*/5 * * * *' fires at minute boundaries 0,5,10… If the tests happen to run exactly at that moment… the probability is low but not zero (a 20-second test window straddling :00 with a :00 tick → the job runs → re-derivation during the test → could it interfere? The job's re-derivation is idempotent and only repairs drift — it could actually "fix" the damage injected by the drift test before the assertion!! That would make the test flaky (report.driftedOrders is computed before the fix… the race: the job's re-derivation completes between the damage injection and the run() comparison → the drift count is 0 → the test fails). Probability ~ (test duration / 5 min) ≈ small but real. A deterministic test must disable it.

Robust fix: make the cron expression resolvable at scheduling time (module init), not at import time: a custom decorator that reads env at definition time is still import time. Alternative: the DriftRepairJob implements OnModuleInit and starts its own `setInterval`/`setTimeout` from an env read at init time (after the test env is set? The test sets env in beforeAll — after the module import but before app.init() → onModuleInit runs at app.init() → reads env at that point → the disabled expression → we can even skip the schedule when the env `DRIFT_REPAIR_CRON_DISABLED` is set.

Simplest and most robust: skip @nestjs/schedule entirely; the job uses a `setTimeout` chain with an interval from env, started in `onApplicationBootstrap` (after the test env is set… wait, the test sets env at the top of the spec file (a module-level `process.env.X = ...` in the spec body?) — a module-level statement in the spec file runs at import time (before beforeAll) — same timing problem as helpers, but the schedule starts at app.init() (inside beforeAll, after the module-level env line has run) → the env is available at init time ✓. So:

```ts
@Injectable()
export class DriftRepairJob implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  onApplicationBootstrap() {
    const intervalMs = Number(process.env.DRIFT_REPAIR_INTERVAL_MS ?? 5 * 60 * 1000);
    if (intervalMs <= 0) return; // disabled (tests)
    this.timer = setTimeout(() => void this.runOnce(), intervalMs);
  }
  private async runOnce() { ...run...; this.timer = setTimeout(...) }
  onModuleDestroy() { clearTimeout(this.timer); }
}
```
The tests set `process.env.DRIFT_REPAIR_INTERVAL_MS = '0'` at the module level (in the helper's top level? Same import-order problem — but now it's read at bootstrap time, not import time → any module-level env set before app.init() works; the helpers' module-level env set runs at import time, which is before beforeAll → ✓).

But "a periodic drift-repair job" via setTimeout is less idiomatic than @Cron… The task says "a periodic drift-repair job." An interval-based scheduler is a legitimate reading; but @Cron with a cron expression is more "scheduled." Compromise: use @nestjs/schedule's `@Cron` and have the expression read the env at import time with the default '*/5 * * * *' and additionally guard execution with a bootstrap-time flag:

```ts
@Injectable()
export class DriftRepairJob {
  private enabled = true; // tests can disable via env, read at bootstrap
  private running = false;
  @Cron(process.env.DRIFT_REPAIR_CRON ?? '*/5 * * * *')
  async runScheduled() {
    if (!this.enabled || this.running) return;
    ...
  }
  onApplicationBootstrap() { this.enabled = (process.env.DRIFT_REPAIR_ENABLED ?? 'true') !== 'false'; }
  ...
}
```
Hmm, but if the test sets the env at module level (before init) → the bootstrap reads it → disabled → the cron tick does nothing ✓ deterministic. And in production, the env `DRIFT_REPAIR_CRON` is read at import time (process start) — that's fine (the process env is stable). This works and keeps the @Cron idiomatic. I need the ScheduleModule dep — OK.

Wait, but the test env var: the spec sets `process.env.DRIFT_REPAIR_ENABLED = 'false'` at module level (in helpers.ts's top level). The helpers' module body runs at import time — before beforeAll → before app.init() → before onApplicationBootstrap → ✓.

Also `@Cron` at import time: `process.env.DRIFT_REPAIR_CRON ?? '*/5 * * * *'` — in tests, env is unset → the default cron is scheduled (a real timer is created, but the runScheduled guard early-returns) → harmless. On app.close, ScheduleModule clears it. ✓ deterministic.

Let me go with this. In tests, I'll set both `DRIFT_REPAIR_ENABLED=false` (defensive).

Also — the test helper sets the env at the top level; but vitest might cache the module between spec files (the same process? With fileParallelism false, the spec files run sequentially in the same worker? By default vitest runs each test file in a separate worker (module isolation per file) — the env set in one file's helpers doesn't leak to the other file's process (separate workers) — but each file imports helpers → the env is set per file ✓.

Now the Prisma client in tests: two Nest app instances across the two spec files (sequential, separate workers) share the same DB — beforeEach's TRUNCATE handles isolation.

**package.json**:

```json
{
  "name": "marketplace-backoffice",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "migrate": "prisma migrate deploy",
    "typecheck": "tsc --noEmit",
    "start:dev": "tsx watch src/main.ts"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.0",
    "@nestjs/core": "^10.4.0",
    "@nestjs/schedule": "^4.1.0",
    "@prisma/client": "^5.20.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.4.0",
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.0",
    "prisma": "^5.20.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

tsconfig.json:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "vitest.config.ts"]
}
```
moduleResolution Bundler + emitDecoratorMetadata — does tsc support emitDecoratorMetadata with module ESNext? Yes.

vitest.config.ts:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    fileParallelism: false, // the specs share one Postgres database
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
```
`fileParallelism` is a Vitest 2 key ✓.

Now let me write the drift count queries fully.

countDriftedOrders:
```sql
WITH expected AS (
  SELECT po.id,
         po.status,
         po.amount_cents,
         po.created_at,
         w.name AS worker_name,
         po.worker_id,
         (SELECT oe.kind FROM order_events oe
           WHERE oe.order_id = po.id
           ORDER BY oe.created_at DESC, oe.id DESC
           LIMIT 1) AS last_event_kind
  FROM payment_orders po
  LEFT JOIN workers w ON w.id = po.worker_id
  WHERE po.created_at >= ${from} AND po.created_at < ${to}
)
SELECT count(*) AS drifted
FROM expected e
LEFT JOIN operations_read_model r ON r.order_id = e.id
WHERE r.order_id IS NULL
   OR r.status IS DISTINCT FROM e.status
   OR r.amount_cents IS DISTINCT FROM e.amount_cents
   OR r.created_at IS DISTINCT FROM e.created_at
   OR r.worker_id IS DISTINCT FROM e.worker_id
   OR r.worker_name IS DISTINCT FROM e.worker_name
   OR r.last_event_kind IS DISTINCT FROM e.last_event_kind
```

countDriftedCompanies:
```sql
WITH windowed AS (
  SELECT DISTINCT company_id FROM payment_orders
  WHERE created_at >= ${from} AND created_at < ${to}
),
actual AS (
  SELECT po.company_id,
    count(*) FILTER (WHERE po.status = 'pending') AS pending_count,
    COALESCE(sum(po.amount_cents) FILTER (WHERE po.status = 'pending'), 0) AS pending_amount,
    count(*) FILTER (WHERE po.status = 'approved') AS approved_count,
    COALESCE(sum(po.amount_cents) FILTER (WHERE po.status = 'approved'), 0) AS approved_amount,
    count(*) FILTER (WHERE po.status = 'rejected') AS rejected_count,
    COALESCE(sum(po.amount_cents) FILTER (WHERE po.status = 'rejected'), 0) AS rejected_amount,
    count(*) FILTER (WHERE po.status = 'refunded') AS refunded_count,
    COALESCE(sum(po.amount_cents) FILTER (WHERE po.status = 'refunded'), 0) AS refunded_amount
  FROM payment_orders po
  JOIN windowed w ON w.company_id = po.company_id
  GROUP BY po.company_id
)
SELECT count(*) AS drifted
FROM actual a
LEFT JOIN company_totals t ON t.company_id = a.company_id
WHERE t.company_id IS NULL
   OR t.pending_count <> a.pending_count
   OR t.pending_amount IS DISTINCT FROM a.pending_amount
   OR t.approved_count <> a.approved_count
   OR t.approved_amount IS DISTINCT FROM a.approved_amount
   OR t.rejected_count <> a.rejected_count
   OR t.rejected_amount IS DISTINCT FROM a.rejected_amount
   OR t.refunded_count <> a.refunded_count
   OR t.refunded_amount IS DISTINCT FROM a.refunded_amount
```
count(*) is never NULL; `<>` is fine. Amounts are bigint; `IS DISTINCT FROM` is fine.

Wait — a subtlety: `windowed` selects companies from the window, and `actual` aggregates the company's full history (join windowed to restrict the companies) ✓ (the totals are the company-wide total).

recomputeCompanyTotals — the same shape of SELECT (no window join; the companyIds parameter).

Now, `applyTotalsDelta` and the initial insert: `version 1`. The drift/repair path `recomputeCompanyTotals` on insert is version 1, on conflict +1. `company_totals.updated_at` — set to now() on both paths (the schema's @updatedAt is irrelevant to raw SQL; it's maintained by raw).

Hmm — the Prisma schema's `updatedAt @updatedAt` only applies to Prisma writes; the raw writes maintain it explicitly. OK.

**Worker name change** — no write path for the worker; the projection is a snapshot; the re-derivation syncs it. Documented.

Now — `listOperations`'s from/to defaults: from = new Date(0) (epoch — timestamptz min is 4713 BC, no problem), to = now + a small epsilon? If an order's created_at == now() is exactly… use `new Date()` + 1000ms? Use `new Date(Date.now() + 60_000)` for safety. It's a default for the optional upper bound. Fine.

Now the **OperationsController** parsing:

```ts
function parsePositiveInt(value: unknown, field: string): number {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  if (!Number.isInteger(n) || n <= 0) {
    throw new ApiError(400, 'validation_failed', `${field} must be a positive integer`, { field, value: String(value) });
  }
  return n;
}
function parseOptionalPositiveInt(value: unknown, field: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  return parsePositiveInt(value, field);
}
function parseDate(value: unknown, field: string): Date | undefined {
  if (value === undefined || value === '') return undefined;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new ApiError(400, 'validation_failed', `${field} must be an ISO-8601 date`, { field });
  return d;
}
function parseStatuses(value: string | string[] | undefined): Status[] | undefined {
  if (value === undefined) return undefined;
  const list = Array.isArray(value) ? value : [value];
  for (const s of list) {
    if (!STATUSES.includes(s as Status)) throw new ApiError(400, 'validation_failed', `status must be one of ${STATUSES.join(', ')}`, { status: s });
  }
  return [...new Set(list as Status[])];
}
```
Where to put the helpers — in the controller file (shared by both controllers?) both controllers need parsePositiveInt. Put the parse helpers in `src/common/validation.ts`. The controllers import them. Good.

`parsePositiveInt` accepts number | string (the body may be a number). Signature: `parsePositiveInt(value: unknown, field: string): number`.

**The payment-orders controller** create body: a typed `@Body() body: CreatePaymentOrderDto`? No DTO validation (no class-validator). Type: `{ companyId?: unknown; workerId?: unknown; amountCents?: unknown }` — parse each. The amountCents > 0 check is already in parsePositiveInt. ✓.

**Response shape**: NestJS auto-wraps nothing — returns a plain JSON object. The list returns `{ items, total, page, pageSize }`.

The totals response: a flat CompanyTotalsData.

Now the **module import cycle**: OperationsModule is imported by PaymentOrdersModule and DriftRepairModule — no cycle. ✓.

**DriftRepairJob** needs OperationsRepository + ReprojectionService (exported by OperationsModule ✓) + PrismaService (global ✓).

Let me write the DriftRepairJob:

```ts
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { OperationsRepository } from '../operations/operations.repository';
import { ReprojectionService } from '../operations/reprojection.service';

export interface DriftRepairReport {
  windowFrom: Date;
  windowTo: Date;
  driftedOrders: number;
  driftedCompanies: number;
  repaired: { orders: number; companies: number } | null;
}

/**
 * Periodic drift repair: compare the projection to the source over a recent
 * window and re-derive the drifted window. The cron expression comes from
 * the environment (DRIFT_REPAIR_CRON); execution can be disabled with
 * DRIFT_REPAIR_ENABLED=false (used by the test suite).
 */
@Injectable()
export class DriftRepairJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(DriftRepairJob.name);
  private enabled = true;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: OperationsRepository,
    private readonly reproject: ReprojectionService,
  ) {}

  onApplicationBootstrap(): void {
    this.enabled = (process.env.DRIFT_REPAIR_ENABLED ?? 'true') !== 'false';
  }

  @Cron(process.env.DRIFT_REPAIR_CRON ?? '*/5 * * * *')
  async runScheduled(): Promise<void> {
    if (!this.enabled) return;
    if (this.running) { this.logger.warn('previous drift-repair run still in flight; skipping'); return; }
    this.running = true;
    try { await this.run(); }
    catch (err) { this.logger.error(`drift-repair run failed: ${(err as Error).message}`); }
    finally { this.running = false; }
  }

  async run(windowDays: number = Number(process.env.DRIFT_REPAIR_WINDOW_DAYS ?? '1')): Promise<DriftRepairReport> {
    const windowTo = new Date();
    const windowFrom = new Date(windowTo.getTime() - windowDays * 86_400_000);
    const [driftedOrders, driftedCompanies] = await Promise.all([
      this.repo.countDriftedOrders(windowFrom, windowTo),
      this.repo.countDriftedCompanies(windowFrom, windowTo),
    ]);
    let repaired: DriftRepairReport['repaired'] = null;
    if (driftedOrders > 0 || driftedCompanies > 0) {
      repaired = await this.reproject.rederive(windowFrom, windowTo);
    }
    const report: DriftRepairReport = { windowFrom, windowTo, driftedOrders, driftedCompanies, repaired };
    this.logger.log(
      `drift-repair window=[${windowFrom.toISOString()}..${windowTo.toISOString()}] driftedOrders=${driftedOrders} driftedCompanies=${driftedCompanies} repaired=${repaired ? 'yes' : 'no'}`,
    );
    return report;
  }
}
```
Note: I switched the repo methods to an optional db parameter (default this.prisma) — `this.repo.countDriftedOrders(windowFrom, windowTo)` ✓.

Repo method signatures (optional trailing db):
```ts
async listOperations(q: {...}, db: Db = this.prisma)
```
Hmm, TS default parameter `db: Db = this.prisma` — a `this` reference in a default parameter is allowed (it's evaluated at call time). Yes.

Wait, one thing: `OperationsRepository` is exported and used by DriftRepairJob via OperationsModule's exports ✓; ProjectionMaintenanceService is used by PaymentOrdersService ✓ exported.

**ReprojectionService** (the loop in the service, the batch in the repo):

```ts
@Injectable()
export class ReprojectionService {
  private static readonly BATCH_SIZE = 500;

  constructor(private readonly repo: OperationsRepository) {}

  async rederive(from: Date, to: Date): Promise<{ orders: number; companies: number }> {
    if (from >= to) throw new ApiError(400, 'validation_failed', 're-derivation window: from must be earlier than to', {});
    let cursor = 0;
    let orders = 0;
    const companies = new Set<number>();
    for (;;) {
      const batch = await this.repo.rederiveBatch(from, to, cursor, ReprojectionService.BATCH_SIZE);
      if (batch.length === 0) break;
      orders += batch.length;
      for (const b of batch) companies.add(b.companyId);
      cursor = batch[batch.length - 1].orderId;
      if (batch.length < ReprojectionService.BATCH_SIZE) break;
    }
    return { orders, companies: companies.size };
  }
}
```
repo.rederiveBatch:
```ts
async rederiveBatch(from: Date, to: Date, afterOrderId: number, limit: number): Promise<Array<{ orderId: number; companyId: number }>> {
  return this.prisma.$transaction(async (tx) => {
    const batch = await this.sourceOrdersInWindow(tx, from, to, afterOrderId, limit);
    const typed = batch.map((b) => ({ orderId: b.id, companyId: b.company_id }));
    for (const b of typed) {
      const row = await this.recomputeOperationRow(b.orderId, tx);
      if (row) await this.upsertOperationRow(row, tx);
    }
    await this.recomputeCompanyTotals([...new Set(typed.map((t) => t.companyId))], tx);
    return typed;
  });
}
```
The order of parameters for these internal methods: data first, optional db last. In the maintenance service, the tx is the first parameter (since there's always a tx) — for consistency: all repo methods are `(...data, db?: Db)`. The maintenance service calls `this.repo.recomputeOperationRow(orderId, tx)` etc.

**sourceOrdersInWindow** returns raw `{ id: number; company_id: number }[]` via $queryRaw<{id:number; company_id:number}>.

Now — the **list query** and the covering index: the SELECT columns exactly match the INCLUDE columns + the key columns ✓ an index-only scan is possible.

Now the **DESIGN.md** — write it well, ~100-150 lines. Sections:
1. Goal and constraints
2. Design (projection + in-transaction hook + atomic totals + re-derivation + drift repair + covering index)
3. How each acceptance criterion is met
4. Alternatives rejected (materialized view/refresh, outbox/CDC async, trigger, faster join, app-level lock) — and why the synchronous hook wins
5. Concurrency and exactness argument (guarded update; in-place increment; row lock; idempotent re-derivation)
6. Failure modes, recovery, and the drift job
7. Performance argument (covering index, no join, index-only scan, window-function count)
8. Operations (env vars, endpoints, backfill procedure)

Also note the assumption markers: is there anything truly unresolved?
- "Recency" = created_at (not updated_at) — mark it with an ASSUMPTION comment in operations.repository or the service.
- companyId filter required — an assumption (the spec says "filter by company"; the covering index leads with company_id).
- Worker FK required — a minor assumption.
Add `// ASSUMPTION:` at the point it matters (created_at sort; required companyId).

Now, let me double-check the **Prisma schema parse** risks:
- `@@index([orderId, [createdAt(sort: SortOrder.Desc), id(sort: Desc)]])` — the correct Prisma syntax for mixed: actually the syntax is: `@@index([firstName, [lastName(sort: Desc)]])` — the nested array groups fields with a sort. For two desc fields: `@@index([orderId, [createdAt(sort: Desc), id(sort: Desc)]])`? Hmm, I think the nested-array syntax is: `@index([a, [b(sort: Desc), c(sort: Desc)]])` — yes, Prisma docs: "you can specify the sort order of individual columns… @@index([email, [name(sort: Desc)]])". Multiple in a nested array should work. To be safe, I'll write `@@index([orderId, [createdAt(sort: SortOrder.Desc), id(sort: SortOrder.Desc)]])`. Even if the exact syntax is slightly off, the migration is the truth; but a schema parse failure breaks everything (PrismaClient generation). Safer: keep the order_events index in the schema as plain `@@index([orderId, createdAt, id])` and note that the migration creates the DESC version. Hmm — but then the migration and schema differ (the migration creates idx ... (order_id, created_at DESC, id DESC); the schema declares (order_id, created_at, id)) → `prisma migrate dev` would add a duplicate ascending index later. For a deliverable with a single checked-in migration, that mismatch is a minor blemish. The risk of a parse error is worse. Decision: I'll use the descending syntax — I'm reasonably confident it's valid in Prisma 5 (a documented feature since 4.x: "Descending indexes" — `@index([user, [createdAt(sort: Desc)]])`). I'll trust it. Actually, let me minimize risk: `@@index([orderId, createdAt(sort: Desc), id(sort: Desc)])`? No — the sort modifier must be inside a nested array? The docs show both… I recall the doc example:
```prisma
model User {
  ...
  @@index([email, [name(sort: Desc)]])
}
```
I'm fairly sure the modifier attaches to fields inside a nested array; a top-level `field(sort: Desc)` I think also works (the grammar allows `FieldRef` with sort). Hmm. I'll use the nested-array form (documented).

- `BigInt @default(0)` ✓.
- `@default(now())` ✓.

**Prisma client generation in tests**: the tests import `@prisma/client` — the client must be generated (a `prisma generate` step). The package.json script: add `"postinstall": "prisma generate"`? That's the common pattern — but the prisma binary must be available; OK, add a "generate": "prisma generate" script and a note. Include `"postinstall": "prisma generate"`.

Also, the generated client is needed even before the DB exists (generate doesn't need a DB) ✓.

**ESM + Prisma**: `import { PrismaClient, Prisma } from '@prisma/client'` — in Node ESM, this CJS module: named imports via cjs-module-lexer — Prisma's generated index is CJS that re-exports via `module.exports = require('.prisma/client')`… The lexer might fail to detect the re-exports → `PrismaClient` is undefined?? A known issue in older versions; Prisma v5 works in ESM projects (NestJS ESM docs use Prisma). I'll trust v5.

**NestJS 10 + ESM**: NestFactory works; decorators via reflect-metadata ✓. tsx for dev run handles TS ESM with decorators? tsx (esbuild) supports experimentalDecorators via tsconfig ✓ (esbuild reads tsconfig). OK.

Now — the **test `orders.create`** returns a Prisma `PaymentOrder` — the service returns it; the controller would too. ✓.

Another consideration — **`$queryRaw` with `count(*) OVER ()`**: the column alias `total` is a bigint string. Map with `Number(r.total)`. But when there are no rows (empty result), total = 0.

**The list's statuses parameter type**: the repo takes `statuses: readonly Status[]` and passes to Prisma.sql — Prisma.sql's array handling: does it expect a plain array? A readonly array is fine at runtime.

Now let me write the **payment-orders.repository.ts** fully:

```ts
import { Injectable } from '@nestjs/common';
import { PaymentOrder, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import type { Status } from '../common/types';

@Injectable()
export class PaymentOrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(orderId: number): Promise<PaymentOrder | null> {
    return this.prisma.paymentOrder.findUnique({ where: { id: orderId } });
  }

  workerExists(workerId: number): Promise<boolean> {
    return this.prisma.worker.findUnique({ where: { id: workerId }, select: { id: true } }).then((w) => w !== null);
  }

  /** Runs the write and its synchronous projection maintenance inside one transaction. */
  runInTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work);
  }

  insertOrder(tx: Prisma.TransactionClient, data: { companyId: number; workerId: number; amountCents: number }): Promise<PaymentOrder> {
    return tx.paymentOrder.create({ data });
  }

  insertEvent(tx: Prisma.TransactionClient, orderId: number, kind: string): Promise<void> {
    return tx.orderEvent.create({ data: { orderId, kind } }).then(() => undefined);
  }

  /**
   * Atomic status transition: the UPDATE only matches if the order is still
   * `from`, so two concurrent transitions to the same order serialize and the
   * loser sees zero affected rows.
   */
  transitionInTransaction(
    orderId: number,
    from: Status,
    to: Status,
    work: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.paymentOrder.updateMany({
        where: { id: orderId, status: from },
        data: { status: to },
      });
      if (result.count === 0) {
        const current = await tx.paymentOrder.findUnique({ where: { id: orderId }, select: { id: true, status: true } });
        if (!current) {
          throw new ApiError(404, 'resource_not_found', `Payment order ${orderId} does not exist`, { orderId });
        }
        throw new ApiError(409, 'invalid_state_transition',
          `Payment order ${orderId} cannot move ${from} -> ${to}; current status is ${current.status}`,
          { orderId, from, to, current: current.status });
      }
      await work(tx);
      return orderId;
    });
  }
}
```

**operations.repository.ts** full — the mapping helpers:

```ts
function mapOperationRow(r: Record<string, unknown>): OperationRowData {
  return {
    orderId: Number(r.order_id),
    companyId: Number(r.company_id),
    workerId: Number(r.worker_id),
    workerName: (r.worker_name as string | null) ?? null,
    status: r.status as Status,
    amountCents: Number(r.amount_cents),
    lastEventKind: (r.last_event_kind as string | null) ?? null,
    createdAt: r.created_at as Date,
  };
}
function mapTotals(companyId: number, r?: Record<string, unknown>): CompanyTotalsData {
  if (!r) return zeroTotals(companyId);
  return {
    companyId,
    pendingCount: Number(r.pending_count),
    pendingAmountCents: Number(r.pending_amount),
    approvedCount: Number(r.approved_count),
    approvedAmountCents: Number(r.approved_amount),
    rejectedCount: Number(r.rejected_count),
    rejectedAmountCents: Number(r.rejected_amount),
    refundedCount: Number(r.refunded_count),
    refundedAmountCents: Number(r.refunded_amount),
    version: Number(r.version),
  };
}
```

The full repo:

```ts
import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CompanyTotalsData, OperationRowData, Status, TotalsDelta } from '../common/types';

type Db = PrismaClient | Prisma.TransactionClient;

@Injectable()
export class OperationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  listOperations(q: { companyId: number; statuses: readonly Status[]; from: Date; to: Date; limit: number; offset: number }, db: Db = this.prisma) { ... }
  getCompanyTotals(companyId: number, db: Db = this.prisma) { ... }
  recomputeOperationRow(orderId: number, db: Db = this.prisma) { ... }
  upsertOperationRow(row: OperationRowData, db: Db = this.prisma) { ... }
  applyTotalsDelta(companyId: number, delta: TotalsDelta, db: Db = this.prisma) { ... }
  recomputeCompanyTotals(companyIds: readonly number[], db: Db = this.prisma) { ... }
  sourceOrdersInWindow(from, to, afterOrderId, limit, db = this.prisma) { ... }
  rederiveBatch(from, to, afterOrderId, limit) { ... }
  countDriftedOrders(from, to, db = this.prisma) { ... }
  countDriftedCompanies(from, to, db = this.prisma) { ... }
}
```

A default parameter referencing `this.prisma` — legal TS. ✓.

Now, the Prisma.sql usage with a dynamic array for statuses: `${q.statuses}` — a readonly array is passed; Prisma handles it.

**Zero totals** in common/types.ts:
```ts
export function zeroTotals(companyId: number): CompanyTotalsData {
  return { companyId, pendingCount: 0, pendingAmountCents: 0, approvedCount: 0, approvedAmountCents: 0, rejectedCount: 0, rejectedAmountCents: 0, refundedCount: 0, refundedAmountCents: 0, version: 0 };
}
export function emptyTotalsDelta(): TotalsDelta {
  return { pending: {count:0, amountCents:0}, approved: {...}, rejected: {...}, refunded: {...} };
}
```

Now — the **operations.service.ts**:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OperationsRepository } from './operations.repository';
import { STATUSES } from '../common/types';
import type { CompanyTotalsData, OperationRowData, Status } from '../common/types';

export interface OperationListQuery {
  companyId: number;
  statuses?: Status[];
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

export interface OperationPage {
  items: OperationRowData[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: OperationsRepository,
  ) {}

  /** Dashboard read: projection only, no join back to the source tables. */
  async listOperations(query: OperationListQuery): Promise<OperationPage> {
    // ASSUMPTION: recency means creation time (created_at DESC), not last modification.
    const from = query.from ?? new Date(0);
    const to = query.to ?? new Date(Date.now() + 60_000);
    const statuses = query.statuses && query.statuses.length > 0 ? query.statuses : STATUSES;
    const { items, total } = await this.repo.listOperations({
      companyId: query.companyId,
      statuses,
      from,
      to,
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    }, this.prisma);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  getCompanyTotals(companyId: number): Promise<CompanyTotalsData> {
    return this.repo.getCompanyTotals(companyId, this.prisma);
  }
}
```
Hmm — the service passes `this.prisma` explicitly; the default parameter exists, but explicit is clearer. Actually simpler: don't pass it (use the default). The default `db: Db = this.prisma` — the repo's this.prisma is the same service instance. The service just calls `this.repo.listOperations({...})`. Cleaner. I'll drop the explicit passing; the service holds no reference to PrismaService at all → the service has zero Prisma client references.

The same for ReprojectionService/DriftRepairJob: no PrismaService injection needed (the repo default). DriftRepairJob drops the prisma injection. Cleaner layering story.

**Now the full operations.controller.ts**:

```ts
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
...
@Controller()
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get('operations')
  list(
    @Query('companyId') companyId: string | undefined,
    @Query('status') status: string | string[] | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
  ): Promise<OperationPage> {
    const companyId = parseRequiredPositiveInt(companyId, 'companyId');
    const statuses = parseStatuses(status);
    const from = parseOptionalDate(from, 'from');
    const to = parseOptionalDate(to, 'to');
    if (from !== undefined && to !== undefined && from.getTime() >= to.getTime()) {
      throw new ApiError(400, 'validation_failed', 'from must be strictly earlier than to', { from: from.toISOString(), to: to.toISOString() });
    }
    const page = parsePositiveInt(page ?? '1', 'page');
    const size = parsePositiveInt(pageSize ?? '20', 'pageSize');
    if (size > 100) throw new ApiError(400, 'validation_failed', 'pageSize must be at most 100', { pageSize: size });
    return this.operations.listOperations({ companyId, statuses, from, to, page, pageSize: size });
  }

  @Get('company-totals/:companyId')
  totals(@Param('companyId') companyId: string) {
    const id = parseRequiredPositiveInt(companyId, 'companyId');
    return this.operations.getCompanyTotals(id);
  }
}
```

common/validation.ts:
```ts
import { ApiError } from './api-error';
import { STATUSES } from './types';
import type { Status } from './types';

export function parsePositiveInt(value: unknown, field: string): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value !== '' ? Number(value) : NaN;
  if (!Number.isInteger(n) || n <= 0) {
    throw new ApiError(400, 'validation_failed', `${field} must be a positive integer`, { field, received: String(value) });
  }
  return n;
}

export function parseRequiredPositiveInt(value: unknown, field: string): number {
  if (value === undefined || value === '') throw new ApiError(400, 'validation_failed', `${field} is required`, { field });
  return parsePositiveInt(value, field);
}

export function parseOptionalDate(value: unknown, field: string): Date | undefined {
  if (value === undefined || value === '') return undefined;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new ApiError(400, 'validation_failed', `${field} must be an ISO-8601 date`, { field, received: String(value) });
  return d;
}

export function parseStatuses(value: string | string[] | undefined): Status[] | undefined {
  if (value === undefined) return undefined;
  const list = Array.isArray(value) ? value : [value];
  for (const s of list) {
    if (!STATUSES.includes(s as Status)) {
      throw new ApiError(400, 'validation_failed', `status must be one of: ${STATUSES.join(', ')}`, { received: s });
    }
  }
  return [...new Set(list as Status[])];
}
```

The payment-orders controller:
```ts
@Controller('payment-orders')
export class PaymentOrdersController {
  constructor(private readonly orders: PaymentOrdersService) {}

  @Post()
  create(@Body() body: { companyId?: unknown; workerId?: unknown; amountCents?: unknown }) {
    const payload = body ?? {};
    return this.orders.create({
      companyId: parseRequiredPositiveInt(payload.companyId, 'companyId'),
      workerId: parseRequiredPositiveInt(payload.workerId, 'workerId'),
      amountCents: parseRequiredPositiveInt(payload.amountCents, 'amountCents'),
    });
  }

  @Post(':id/approve')
  approve(@Param('id') id: string) { return this.orders.approve(parseRequiredPositiveInt(id, 'id')); }
  @Post(':id/reject')
  reject(@Param('id') id: string) { return this.orders.reject(parseRequiredPositiveInt(id, 'id')); }
  @Post(':id/refund')
  refund(@Param('id') id: string) { return this.orders.refund(parseRequiredPositiveInt(id, 'id')); }
}
```

Now, the full **payment-orders.service.ts** with a clear "hook" comment.

```ts
const TRANSITIONS = {
  approve: { from: 'pending', to: 'approved', event: 'approved' },
  reject: { from: 'pending', to: 'rejected', event: 'rejected' },
  refund: { from: 'approved', to: 'refunded', event: 'refunded' },
} as const;

export type OrderAction = keyof typeof TRANSITIONS;
export type CreatePaymentOrderInput = { companyId: number; workerId: number; amountCents: number };

@Injectable()
export class PaymentOrdersService {
  constructor(
    private readonly repo: PaymentOrdersRepository,
    private readonly projections: ProjectionMaintenanceService,
  ) {}

  create(input: CreatePaymentOrderInput): Promise<PaymentOrder> {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) { // defense in depth; the controller already validated
      ...
    }
    return this.repo.runInTransaction(async (tx) => {
      const worker = await this.repo.findWorker(tx?...)
```
Hmm, the worker check needs a tx or a prisma — workerExists outside the tx (a pre-read; the FK enforces it inside the tx — if the worker is deleted between the check and the tx, the FK fails → a Prisma error → the envelope is internal_error… acceptable? Better: check inside the tx with tx.worker. Add a repo method `workerExistsInTx(tx, id)`. And if missing → throw ApiError validation_failed inside the tx (rolls back, fine).

```ts
  create(input: CreatePaymentOrderInput): Promise<PaymentOrder> {
    return this.repo.runInTransaction(async (tx) => {
      const worker = await this.repo.workerInTx(tx, input.workerId);
      if (!worker) throw new ApiError(400, 'validation_failed', `Worker ${input.workerId} does not exist`, { workerId: input.workerId });
      const order = await this.repo.insertOrder(tx, input);
      await this.repo.insertEvent(tx, order.id, 'created');
      // Synchronous projection maintenance hook: runs inside this same
      // transaction, so the read model can never observe a state the source
      // has not committed, and a rolled-back write leaves no trace.
      await this.projections.onOrderCreated(tx, order.id);
      return order;
    });
  }
```
repo.workerInTx(tx, id) → tx.worker.findUnique.

```ts
  approve(orderId: number): Promise<number> { return this.transition('approve', orderId); }
  reject(orderId: number): Promise<number> { return this.transition('reject', orderId); }
  refund(orderId: number): Promise<number> { return this.transition('refund', orderId); }

  private transition(action: OrderAction, orderId: number): Promise<number> {
    const t = TRANSITIONS[action];
    return this.repo.findById(orderId).then(async (order) => {
      if (!order) throw new ApiError(404, 'resource_not_found', `Payment order ${orderId} does not exist`, { orderId });
      if (order.status !== t.from) {
        throw new ApiError(409, 'invalid_state_transition',
          `Payment order ${orderId} is ${order.status}; ${action} requires status ${t.from}`,
          { orderId, current: order.status, required: t.from });
      }
      return this.repo.transitionInTransaction(orderId, t.from, t.to, async (tx) => {
        await this.repo.insertEvent(tx, orderId, t.event);
        // The synchronous projection maintenance hook, in the same transaction
        // as the source write.
        await this.projections.onOrderStatusChanged(tx, orderId, t.from, t.to);
      });
    });
  }
```
The return type of transition: `Promise<number>` — the repo returns Promise<number> ✓. But the `.then` chain returns a Promise of a Promise — TS: `.then(async (order) => {...})` — is the return Promise<number> flattened? The outer type is `Promise<number>` — the async function in then returns Promise<number> → the resulting promise resolves to number; TS types it as Promise<number> ✓ (Promise flatMap typing). Actually, `this.repo.findById(orderId).then(async (order) => {...})` → Promise<number>. But I declared the method's return `Promise<number>` ✓.

Hmm — `findById` outside the tx then `transitionInTransaction` — a TOCTOU window: the order's status could change between the read and the tx → the guard throws a 409 with the current status — correct behavior (the error message uses the fresh status). ✓.

**projection-maintenance.service.ts** — the hook. Note the import of Prisma.TransactionClient.

Now — **the drift test** uses `driftJob.run()` — DriftRepairJob is provided by DriftRepairModule; the test obtains it via `app.get(DriftRepairJob)` — it must be accessible (a provider, not exported — app.get works for any provider in the module graph ✓).

**reproject** service: `app.get(ReprojectionService)` ✓.

Now, the **full test file** with proper typing. Also confirm `expect(item).toBeDefined()` then `item!` — TS strict: `items.find` returns `OperationRowData | undefined`. Use a non-null assertion after the toBeDefined check — TS doesn't narrow via expect; use `!`. Or `const item = page.items.find(...); if (!item) throw new Error(...);` — in a test, an explicit check is fine:
```ts
const item = page.items.find((i) => i.orderId === created.id);
expect(item).toBeDefined();
if (!item) return; // unreachable; satisfies the type system
```
A bit awkward; I'll use `!` — acceptable in tests. Or an assertion helper. I'll use `!` sparingly.

Now, **ensureSchema**'s splitting regex: the migration has lines ending with `;`. I'll write the migration with each statement on its own line ending in `;` and blank lines between. `split(/;\r?\n/)` — the trailing `;\n` splits correctly; the final statement ends with `;\n` → the last chunk is empty → filtered. But a statement that contains `;` inside a string or comment? My SQL: no `;` in strings; no `;` in comments. ✓.

Actually — one risk: `CREATE INDEX ... INCLUDE (...)` spans multiple lines but only ends with `;` at the end ✓.

Let me finalize the **migration.sql** text (idempotent):

```sql
-- Source tables
CREATE TABLE IF NOT EXISTS workers (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  name TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workers_company_id ON workers (company_id);

CREATE TABLE IF NOT EXISTS payment_orders (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  worker_id INTEGER NOT NULL REFERENCES workers (id),
  status TEXT NOT NULL DEFAULT 'pending',
  amount_cents INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_orders_company_id ON payment_orders (company_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_created_at ON payment_orders (created_at);

CREATE TABLE IF NOT EXISTS order_events (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES payment_orders (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_events_order_id_latest
  ON order_events (order_id, created_at DESC, id DESC);

-- Read model (projection)
CREATE TABLE IF NOT EXISTS operations_read_model (
  order_id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL,
  worker_id INTEGER NOT NULL,
  worker_name TEXT,
  status TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  last_event_kind TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  maintained_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Covering index for the dashboard access pattern:
-- filter by company_id + status, sort by created_at DESC / order_id DESC,
-- all remaining selected columns in INCLUDE, so the read is index-only.
CREATE INDEX IF NOT EXISTS idx_operations_read_model_dashboard
  ON operations_read_model (company_id, status, created_at DESC, order_id DESC)
  INCLUDE (worker_id, worker_name, amount_cents, last_event_kind);

CREATE TABLE IF NOT EXISTS company_totals (
  company_id INTEGER PRIMARY KEY,
  pending_count INTEGER NOT NULL DEFAULT 0,
  pending_amount BIGINT NOT NULL DEFAULT 0,
  approved_count INTEGER NOT NULL DEFAULT 0,
  approved_amount BIGINT NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  rejected_amount BIGINT NOT NULL DEFAULT 0,
  refunded_count INTEGER NOT NULL DEFAULT 0,
  refunded_amount BIGINT NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

The schema.prisma must produce the same (Prisma would generate slightly different DDL, but the migration is the shipped truth; consistent enough).

Wait — the schema has an OrderEvent relation with onDelete Cascade: Prisma's migration would also add an FK for worker (worker_id REFERENCES workers(id)) — my migration includes that ✓.

The schema's `PaymentOrder.worker` relation — declare it:
```prisma
model PaymentOrder {
  ...
  worker Worker       @relation(fields: [workerId], references: [id])
  events OrderEvent[]
```
✓.

Now the **schema's operations_read_model index**: none declared (the covering one is in the migration) — add a comment. But `prisma migrate dev` from an empty DB: Prisma generates a migration without the covering index (and my hand-written migration file coexists — a confusing state). This is an exercise; a comment in the schema explains it. Or, declare a non-covering index in the schema and have the migration create only the covering one (with the same key columns) — the covering index also serves the non-covering purpose. Declare `@@index([companyId, status, createdAt, orderId])`? A Prisma-managed ascending index + the migration's DESC covering → two indexes. No. I'll keep the schema without that index, with a comment:

```prisma
// NOTE: the dashboard covering index
// (company_id, status, created_at DESC, order_id DESC) INCLUDE (...)
// is applied by prisma/migrations/.../migration.sql because Prisma cannot
// express INCLUDE columns.
```
Good.

Similarly, the order_events descending index: I'll declare `@@index([orderId, [createdAt(sort: SortOrder.Desc), id(sort: SortOrder.Desc)]])` — if it parses, the generated DDL matches the migration ✓.

The workers companyId index is declared ✓ matches.
payment_orders indexes ✓ match.

**Now DESIGN.md** — I'll write it concisely but completely.

Also — the "simulates the write path" endpoint: covered (POST /payment-orders etc.).

**The main.ts PORT**: `Number(process.env.PORT ?? 3000)`.

Double-check **@nestjs/schedule v4** API: `ScheduleModule.forRoot()`, `@Cron('*/5 * * * *')` ✓ (5-field or 6-field with seconds). '*/5 * * * *' is 5 fields ✓.

**Vitest + Nest decorators**: fine.

**Prisma log level**: to keep tests quiet: `new PrismaClient({ log: ['error'] })`? I'll keep the default (no log config) → Prisma logs nothing by default. I won't set log.

**Now, let me reconsider `count(*) OVER ()`**: with LIMIT and OFFSET — Postgres applies the window function before LIMIT (the window is computed over the whole filtered result set). `count(*) OVER ()` = the count of the filtered set ✓ standard trick.

**Performance note**: `status = ANY(...)` prevents a pure index-order scan with multiple statuses; with one status (the common case) the index is used fully. Fine, I'll document it.

**The total count** — the operator sees the same as before (the original query presumably returned the total or a page). Fine.

**Edge: `page` > last page** → items [], total unchanged ✓.

Now, let me check **Prisma.sql with a number[] for `recomputeCompanyTotals`**: `WHERE po.company_id = ANY(${companyIds})` ✓.

**rederiveBatch's transaction isolation**: the default READ COMMITTED; the re-derivation reads the source and writes to the projection — fine.

**A potential deadlock in the concurrent approval test**: tx A updates order1, then upserts operationrow1, then company_totals row 7. tx B similarly with order2. The totals row lock: A holds it briefly, B waits → no cycle (each holds its own order row, then requests the totals row; the totals row is the same → serialized; no cycle because no one requests an order row after the totals row) ✓.

**The test `orders.approve` ×4 in Promise.all** — each: findById (a separate connection), then $transaction (an interactive transaction). Prisma's default connection pool (interactive transactions use a dedicated connection) — 4 concurrent → needs ≥4 pool connections (default 15… Prisma's default is `connection_limit` 15? Default 10) ✓.

**Now the vitest globals**: I import explicitly from 'vitest' (no globals config needed).

**TS strict concerns**:
- `batch[batch.length - 1].orderId` — under `noUncheckedIndexedAccess`, a possible undefined? I won't enable noUncheckedIndexedAccess (strict alone doesn't include it) ✓.
- Raw rows are `Record<string, unknown>` → casts are needed ✓.

**Prisma types for $queryRaw**: `db.$queryRaw<{ order_id: number; ... }[]>(Prisma.sql\`...\`)` ✓.

Now the **helpers' import order**: the spec file:
```ts
import './helpers-env'? 
```
I decided the drift job is disabled via `DRIFT_REPAIR_ENABLED=false` read at bootstrap (onApplicationBootstrap) — so the env can be set anywhere before app.init(). The test helper's top level sets it; the helper is imported by the spec → the module body runs at import time (before beforeAll's app.init()) ✓ regardless of import order relative to the src modules (the @Cron expression reads the default at import time — fine, the guard disables it).

So the helpers:
```ts
// The scheduled drift job must not fire mid-suite. onApplicationBootstrap
// reads this, and the spec's app.init() happens in beforeAll.
process.env.DRIFT_REPAIR_ENABLED = 'false';
```
✓ deterministic.

**Another design point**: the spec says "the dashboard query touches only the projection" — the total endpoint reads company_totals (also a projection table) ✓.

**A "total" in the list response** — fine.

Also, does the list include `updatedAt`? The original operator view: the order fields. My OperationRowData fields: orderId, companyId, workerId, workerName, status, amountCents, lastEventKind, createdAt. Reasonable as "the same column."

Now, let me think about whether `OperationsService.listOperations` should be called with `this.prisma` — I removed the prisma injection; the repo default handles it. ✓.

But `OperationsRepository`'s default parameter `db: Db = this.prisma` — when called from ProjectionMaintenanceService with an explicit tx ✓.

**Check: is `OperationsRepository` used directly by DriftRepairJob** (countDriftedOrders etc.) — exported by OperationsModule ✓, imported via DriftRepairModule's imports: [OperationsModule] ✓.

**The payment-orders module imports OperationsModule** → the controller is declared ✓.

**AppModule** imports ScheduleModule.forRoot() — the ScheduleModule import from '@nestjs/schedule'.

Now — **the file `src/common/validation.ts`** imports ApiError and types ✓ no cycle.

**The error filter** — `import type { Response } from 'express'` needs @types/express in devDeps ✓ included.

Actually, to avoid the express type dep, I could type the response as `{ status(code: number): { json(b: unknown): unknown } }`… I'll keep @types/express (standard).

**main.ts**:
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ErrorEnvelopeFilter } from './common/error-envelope.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new ErrorEnvelopeFilter());
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3000);
}
void bootstrap();
```

**Now let me write the tests fully and carefully.**

test/payment-orders.spec.ts — as sketched. Add a "the create hook also maintains the projection" assertion (pending visible in the list before approval) — included in the first test (assert the pending total before approval). Also assert the projection row exists in the list as pending:
```ts
const before = await ops.listOperations({ companyId: 1, page: 1, pageSize: 10 });
expect(before.items[0].status).toBe('pending');
expect(before.items[0].lastEventKind).toBe('created');
```

test/operations.spec.ts — as sketched. Let me double-check the ordering assertion for the "filters by..." test: created a, b, c, d sequentially → created_at is non-decreasing (millisecond resolution; sequential awaits → probably increasing timestamps; but if two share the same millisecond, the tiebreak is order_id DESC → the order is still c, b, a by id ✓ since id increases with creation time — the tiebreak id DESC gives the same order as time DESC when tied ✓). c is rejected, a/b/d approved. Backdate a by 2 hours. Re-derive. Order for company 10: c (now), b (now-ε), a (now-2h) → [c,b,a] ✓. `onlyApproved` (company 10, statuses approved): b, a → [b, a] ✓ (c is rejected, excluded). recent (from = now-1h): c, b ✓ (a excluded). oldOnly (to = now-1h): a ✓ — wait, `to` is exclusive: `created_at < now-1h`; a is at now-2h ✓ included. p1 (pageSize 2): [c, b], total 3 ✓. p2: [a] ✓. Company 11: [d] ✓.

But note: `from = new Date(Date.now() - 3600e3)` is computed after the re-derivation — a is backdated by 2 hours before that → a.created_at < from ✓; b, c, d are within the last hour ✓.

The re-derive window: `new Date(0)` to `now + 60s` ✓ covers the backdated a.

The re-derive also recomputes totals — the totals for company 10/11 become the absolute truth ✓ (they were already correct).

**The "projection-only read" test**: after approve + worker rename, list → workerName 'Old Name' ✓ (the projection snapshot). Re-derive → 'New Name' ✓.

**The idempotency test**: after the damage, the first re-derive → correct; the snapshot after1; the second re-derive → after2; `expect(after2).toEqual(after1)` ✓. Also assert after1's correctness: status approved, total 333.

Note: the snapshot's rows include `created_at` (a Date) — consistent across snapshots ✓ (re-derivation doesn't change created_at — the upsert sets created_at = EXCLUDED.created_at = the source's created_at, unchanged ✓).

**The drift test**: as sketched. `report.driftedOrders` = 2 (the wrong o1, the missing o2) — wait, does `countDriftedOrders` also count o1's missing? o1 exists but last_event_kind differs → drift ✓; o2 is missing → drift ✓ → 2. `driftedCompanies` = 1 (company 40's totals off) ✓. After repair: the list has 2 items, both approved/lastEventKind approved ✓; totals 3000/2 ✓. A clean second run → 0/0 ✓ (re-derivation is exact).

Hmm — after the drift job's repair via re-derivation, is the projection's `created_at` unchanged? Yes.

Another subtlety in the drift test: `DELETE FROM operations_read_model WHERE order_id = o2` → the missing-row drift detection ✓; the repair re-creates it ✓.

**The rollback test** — repo.transitionInTransaction with an after that throws → the tx rolls back: the order status stays pending ✓ (the updateMany is undone), the totals are unchanged ✓. Assert via ops.getCompanyTotals + a fresh findUnique. Note: `fresh!.status` — findUnique after the rollback → 'pending' ✓.

Now — **the `runInTransaction` generic**: `runInTransaction<T>(work): Promise<T>` → `this.prisma.$transaction(work)` — the interactive transaction returns T ✓.

**Prisma interactive transaction + raw SQL inside** ✓.

**The maintenance hook's recomputeOperationRow inside tx** — reads the order (the new status), the worker, the last event (the event inserted earlier in the tx is visible within the tx ✓ — same tx, uncommitted but visible).

**A potential issue**: `insertEvent` then `recomputeOperationRow` — the last-event subquery sees the new event ✓ same tx.

Now **package.json versions** — pin to reasonable ones:
- @nestjs/common, core, testing ^10.3.0; @nestjs/schedule ^4.1.0 (compatible with Nest 10) ✓.
- @prisma/client + prisma ^5.16.0.
- reflect-metadata ^0.2.2, rxjs ^7.8.1.
- typescript ^5.4.0, tsx ^4.16.0, vitest ^2.0.0, @types/node ^20.14.0, @types/express ^4.17.21.

**vitest.config.ts** — top-level `fileParallelism: false` under test ✓ (Vitest 2 supports `fileParallelism`).

Now, **DESIGN.md** — I'll draft it:

```md
# DESIGN.md — Operations dashboard read model

## Problem
... (the join takes 20–30s at 3M orders; p95 < 50ms; read-your-own-writes; exact totals)

## Chosen design
A materialized read model maintained synchronously by the write path.

- `operations_read_model` — one row per payment order, shaped exactly like the
  dashboard query: company, worker (id + name snapshot), status, amount,
  latest event kind, created_at. No join is needed to serve the list.
- `company_totals` — one row per company with per-status counts and amounts.
- The write service (`PaymentOrdersService`) is the only writer to the source
  tables and it calls the projection maintenance hook
  (`ProjectionMaintenanceService`) **inside the same transaction** as the
  source write (`PaymentOrdersRepository.runInTransaction` /
  `transitionInTransaction`). No queue, no worker, no delay: the projection
  becomes visible at the same instant as the source row.
- Totals are maintained with **in-place increments** (`UPDATE ... SET x = x + delta`
  via `INSERT ... ON CONFLICT DO UPDATE`), never read-modify-write. Postgres
  serializes concurrent increments on the same row; neither is lost.
- A guarded `UPDATE ... WHERE status = :from` makes the transition on a single
  order atomic, so two racing actions on the same order cannot both apply.
- `ReprojectionService.rederive(from, to)` rebuilds the projection for an
  arbitrary window from the source: per-order absolute-value upserts and a
  per-company absolute-value totals recomputation, in short batches.
  Idempotent and safe while live.
- `DriftRepairJob` runs on a cron (`DRIFT_REPAIR_CRON`, default every 5 min):
  counts projection rows in the recent window (`DRIFT_REPAIR_WINDOW_DAYS`,
  default 1 day) that disagree with the source, plus companies whose totals
  disagree, and repairs them by re-deriving the window.
- The dashboard query reads only `operations_read_model` and is served by a
  covering index `(company_id, status, created_at DESC, order_id DESC)
  INCLUDE (worker_id, worker_name, amount_cents, last_event_kind)` → index-only
  scan, no heap access, no join.

## How each acceptance criterion is met
- approve → visible: same-transaction hook; the next committed read sees it. Test: test/payment-orders.spec.ts.
- concurrent approvals, exact totals: in-place increments; test runs them with Promise.all.
- re-derive window / twice: absolute-value upserts; test asserts idempotency.
- drift repair: injected drift (wrong row, missing row, bad totals) → job reports and fixes; test asserts before/after.
- projection-only read: the list SQL touches only operations_read_model; the test proves source-only changes (worker rename) are invisible until re-derivation.

## Alternatives considered and rejected
1. **Materialized view / scheduled refresh** — a refresh interval > 0 is a
   read-your-own-writes violation by construction; REFRESH is a full rebuild
   (unbounded cost at 3M rows) and locks readers.
2. **Outbox + async projection worker (CDC/queue)** — eventual: an operator's
   own approval is invisible until the worker catches up; requires at-least-once
   delivery, ordering, and careful replay to keep the totals exact; extra
   infrastructure for a property the constraint forbids.
3. **Database trigger** — equally correct (in-transaction) but the maintenance
   logic moves out of the TypeScript write path: untestable with the app's
   test suite, invisible in code review, harder to version and debug, and
   Prisma's schema tooling doesn't manage triggers. The hook in the write
   service is the same semantics with the logic where the write logic is.
4. **A faster join** (indexes on the source, covering partial indexes) —
   3M-row join + aggregate still can't hit 50ms p95 under refresh load, and
   doesn't give the exact per-company totals without a per-query aggregation
   over the whole company.
5. **Application-level lock / queue around the totals** — a process-local
   mutex doesn't span instances and dies with the process; a DB row lock (what
   the in-place increment uses for free) is the right serialization point.

## Concurrency and exactness argument
- Same order, racing actions: the guarded UPDATE serializes; exactly one wins;
  the loser gets `invalid_state_transition`. The totals delta is computed from
  the *transition* (from → to), not from a read of the current totals, so there
  is no read-modify-write anywhere.
- Same company, different orders: both transactions increment the same totals
  row; Postgres applies `x = x + d` atomically under the row lock; the sum of
  increments is exact. Proven by the concurrent test.
- Re-derivation vs live writes: absolute-value recompute; a write that lands
  mid-re-derivation is either in the recomputed base or applied on top; the
  rare interleaving that could drop one increment is bounded and is what the
  drift job exists to catch.
- A rolled-back write never touched the projection: the hook runs inside the
  write's transaction; rollback undoes both. (Tested.)

## Failure modes and recovery
- A deploy mid-transaction, a manual source fix, or a hook added later →
  drift. The job's window covers `DRIFT_REPAIR_WINDOW_DAYS`; anything older is
  fixed by an explicit `rederive(from, to)` (backfill procedure: run it over
  the affected window; it is idempotent, so running it "just in case" is safe).
- The projection is recoverable, not precious: delete both tables and run
  `rederive(min created_at, now())`.

## Performance
- The read path is a single index-only scan on the covering index with a
  bounded LIMIT; `count(*) OVER ()` gives the page total in the same query.
  No join, no aggregate over 3M rows, no cross-table IO at p95.
- The write path adds one upsert + one totals increment per order mutation —
  both row-level, both on hot pages.

## Configuration (env only)
- `DATABASE_URL` — required.
- `PORT` — default 3000.
- `DRIFT_REPAIR_CRON` — default `*/5 * * * *`.
- `DRIFT_REPAIR_WINDOW_DAYS` — default 1.
- `DRIFT_REPAIR_ENABLED` — `false` disables the schedule (tests).

## API
- `GET /operations?companyId=&status=&status=&from=&to=&page=&pageSize=`
- `GET /company-totals/:companyId`
- `POST /payment-orders` `{ companyId, workerId, amountCents }`
- `POST /payment-orders/:id/approve|reject|refund`
Errors use the single envelope `{ "error": { "code", "message", "details" } }`.
```

Good. Now — the "ASSUMPTION" comments:
1. `// ASSUMPTION: "recency" is the order's creation time (created_at DESC, order_id DESC tiebreak), not last-modified time.` in operations.service or the repo's list query.
2. `// ASSUMPTION: the dashboard is always scoped to a company, so companyId is required; the covering index leads with company_id.` in the controller's parse or the service.
3. Maybe: `// ASSUMPTION: the projection stores a snapshot of the worker name; worker renames propagate via re-derivation/drift repair, not a worker write path (no worker write path exists in this codebase).` in the schema comment or the maintenance service.

Keep to a few.

Now — let me carefully check **the Prisma.sql template literals** in TS files: nested backticks are fine.

One concern: `Prisma.sql` with `${q.statuses}` where q.statuses is `readonly Status[]` — Prisma's runtime array→pg array conversion works for arrays; the readonly flag is erased at runtime ✓.

**$executeRaw with Prisma.sql** returns a number (rows affected) ✓.

**`$queryRaw` with a Prisma.sql that includes `count(*) OVER () AS total`** — fine.

Now the **mapping of list rows**: the columns `order_id` etc. The generic:
```ts
type RawOperationRow = {
  order_id: number; company_id: number; worker_id: number; worker_name: string | null;
  status: string; amount_cents: number; last_event_kind: string | null; created_at: Date; total: string;
};
const rows = await db.$queryRaw<RawOperationRow[]>(Prisma.sql`...`);
```
✓.

getCompanyTotals raw:
```ts
type RawTotals = { company_id: number; pending_count: number; pending_amount: string; ... version: number };
```
bigint → string ✓ Number() it.

Now, **rederiveBatch's return type** and the cursor: `batch[batch.length-1].orderId`.

The `sourceOrdersInWindow` raw generic is `{ id: number; company_id: number }`.

Now — **the re-derive test's `reproject` service**: `app.get(ReprojectionService)`.

**Import names for DriftRepairJob** in the test: `import { DriftRepairJob } from '../src/drift-repair/drift-repair.job';`

Now — **the helpers.ts** exports `createTestApp, prismaOf, ensureSchema, resetTables`. Set the env at the top level too.

Potential issue: two spec files each create an app → each `PrismaService.$connect` in onModuleInit, `$disconnect` in onModuleDestroy via app.close() ✓.

**Vitest fileParallelism false** → sequential files, one shared DB ✓. Within a file, tests run sequentially by default ✓.

**beforeEach's resetTables** — TRUNCATE ... RESTART IDENTITY — serializes with an open transaction? There's no long-running tx between tests ✓.

Now — one more requirement check: "a re-derivation routine for an arbitrary date window" ✓ (service + repo, callable; also exposed? The test calls it). Should I expose an endpoint? I decided no. Hmm — "include … a re-derivation routine" — a routine, not an endpoint ✓.

"a periodic drift-repair job" ✓ cron.

"maintenance hook invoked by the write service (simulates the write path)" ✓.

"the new dashboard query" ✓.

"tests for read-your-own-writes, concurrent updates to a single company's total, and drift repair" ✓ all three explicit.

"projection table and DDL with appropriate indexes" ✓ schema + migration.

"DESIGN.md justifying the synchronous hook against the alternatives rejected" ✓.

Now, **the naming convention check**:
- Files kebab-case: `error-envelope.filter.ts`, `projection-maintenance.service.ts`, `drift-repair.job.ts`, `payment-orders.repository.ts` ✓.
- Classes PascalCase ✓.
- Endpoints kebab plural: `/operations`, `/company-totals`, `/payment-orders` ✓.
- Tables snake via @@map ✓.

**The layering check**: the controller only validates + delegates ✓. The service holds the logic ✓ (no prisma, no raw). The repository touches the DB ✓.

Wait — `PaymentOrdersService`'s `transition` method: it calls `this.repo.findById` and then the repo's tx — orchestration logic ✓ no Prisma.

**The service returns a Promise** — fine.

Now, let me write the **operations.repository.ts** in full (the largest file). I'll be careful with the SQL strings.

Also note: the Prisma.sql tagged template inside a class method — fine.

The countDriftedOrders method:

```ts
async countDriftedOrders(from: Date, to: Date, db: Db = this.prisma): Promise<number> {
  const rows = await db.$queryRaw<{ drifted: string }[]>(Prisma.sql`
    WITH expected AS (
      SELECT po.id AS order_id,
             po.status,
             po.amount_cents,
             po.created_at,
             po.worker_id,
             w.name AS worker_name,
             (SELECT oe.kind
                FROM order_events oe
               WHERE oe.order_id = po.id
               ORDER BY oe.created_at DESC, oe.id DESC
               LIMIT 1) AS last_event_kind
      FROM payment_orders po
      LEFT JOIN workers w ON w.id = po.worker_id
      WHERE po.created_at >= ${from}
        AND po.created_at < ${to}
    )
    SELECT count(*) AS drifted
    FROM expected e
    LEFT JOIN operations_read_model r ON r.order_id = e.order_id
    WHERE r.order_id IS NULL
       OR r.status IS DISTINCT FROM e.status
       OR r.amount_cents IS DISTINCT FROM e.amount_cents
       OR r.created_at IS DISTINCT FROM e.created_at
       OR r.worker_id IS DISTINCT FROM e.worker_id
       OR r.worker_name IS DISTINCT FROM e.worker_name
       OR r.last_event_kind IS DISTINCT FROM e.last_event_kind
  `);
  return Number(rows[0]?.drifted ?? 0);
}
```
count(*) returns a bigint → a string ✓ Number it.

countDriftedCompanies similarly.

Now — the `Prisma.sql` interpolation of `Date` ✓.

**Check the `recomputeCompanyTotals` SQL** with the `AS ct` alias — `INSERT INTO company_totals AS ct (...) SELECT ... ON CONFLICT (company_id) DO UPDATE SET ... version = ct.version + 1` — valid.

But hmm: `ON CONFLICT (company_id)` — company_id is the PK ✓.

**applyTotalsDelta SQL** — verify the column order matches the VALUES order:
Columns: company_id, pending_count, pending_amount, approved_count, approved_amount, rejected_count, rejected_amount, refunded_count, refunded_amount, version, updated_at (11)
Values: ${companyId}, ${d.pending.count}, ${d.pending.amountCents}, ${d.approved.count}, ${d.approved.amountCents}, ${d.rejected.count}, ${d.rejected.amountCents}, ${d.refunded.count}, ${d.refunded.amountCents}, 1, now() (11) ✓.

**upsertOperationRow** columns: order_id, company_id, worker_id, worker_name, status, amount_cents, last_event_kind, created_at, maintained_at (9); values: row.orderId, row.companyId, row.workerId, row.workerName, row.status, row.amountCents, row.lastEventKind, row.createdAt, now() (9) ✓.

**listOperations SQL** ✓.

Now — **the `OperationRowData` import** in the repo from common/types ✓.

**common/types.ts** full:

```ts
export const STATUSES = ['pending', 'approved', 'rejected', 'refunded'] as const;
export type Status = (typeof STATUSES)[number];

export interface OperationRowData {
  orderId: number;
  companyId: number;
  workerId: number;
  workerName: string | null;
  status: Status;
  amountCents: number;
  lastEventKind: string | null;
  createdAt: Date;
}

export interface CompanyTotalsData {
  companyId: number;
  pendingCount: number;
  pendingAmountCents: number;
  approvedCount: number;
  approvedAmountCents: number;
  rejectedCount: number;
  rejectedAmountCents: number;
  refundedCount: number;
  refundedAmountCents: number;
  version: number;
}

export interface TotalsDeltaEntry { count: number; amountCents: number; }
export type TotalsDelta = Record<Status, TotalsDeltaEntry>;

export function zeroTotals(companyId: number): CompanyTotalsData { ... }
export function emptyTotalsDelta(): TotalsDelta { ... }
```

**projection-maintenance.service.ts**:

```ts
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ApiError } from '../common/api-error';
import { emptyTotalsDelta } from '../common/types';
import type { Status } from '../common/types';
import { OperationsRepository } from './operations.repository';

/**
 * Synchronous projection maintenance hook. The write service calls these
 * methods with the transaction client of the write's own transaction, so the
 * projection update commits or rolls back atomically with the source write.
 */
@Injectable()
export class ProjectionMaintenanceService {
  constructor(private readonly repo: OperationsRepository) {}

  onOrderCreated(tx: Prisma.TransactionClient, orderId: number): Promise<void> {
    return this.apply(tx, orderId, { created: true, from: 'pending', to: 'pending' });
  }

  onOrderStatusChanged(tx: Prisma.TransactionClient, orderId: number, from: Status, to: Status): Promise<void> {
    return this.apply(tx, orderId, { created: false, from, to });
  }

  private async apply(tx: Prisma.TransactionClient, orderId: number, change: { created: boolean; from: Status; to: Status }): Promise<void> {
    const row = await this.repo.recomputeOperationRow(orderId, tx);
    if (!row) {
      throw new ApiError(409, 'conflict', `Payment order ${orderId} disappeared while its projection was being maintained`, { orderId });
    }
    // The row is written as an absolute snapshot of the source: idempotent,
    // so the hook, re-derivation and drift repair all converge to the same state.
    await this.repo.upsertOperationRow(row, tx);
    // The totals delta is derived from the transition itself, never from a
    // read of the current totals, so there is no read-modify-write race.
    const delta = emptyTotalsDelta();
    if (change.created) {
      delta[change.to] = { count: 1, amountCents: row.amountCents };
    } else {
      delta[change.from] = { count: -1, amountCents: -row.amountCents };
      delta[change.to] = { count: 1, amountCents: row.amountCents };
    }
    await this.repo.applyTotalsDelta(row.companyId, delta, tx);
  }
}
```

Wait — the `change.created` case where from==='pending' and to==='pending' — the delta is only +pending ✓.

**The payment-orders.service.ts** full:

```ts
import { Injectable } from '@nestjs/common';
import { PaymentOrder } from '@prisma/client';
import { ApiError } from '../common/api-error';
import type { Status } from '../common/types';
import { ProjectionMaintenanceService } from '../operations/projection-maintenance.service';
import { PaymentOrdersRepository } from './payment-orders.repository';

const TRANSITIONS = {
  approve: { from: 'pending', to: 'approved', event: 'approved' },
  reject: { from: 'pending', to: 'rejected', event: 'rejected' },
  refund: { from: 'approved', to: 'refunded', event: 'refunded' },
} as const;

export type OrderAction = keyof typeof TRANSITIONS;
export interface CreatePaymentOrderInput { companyId: number; workerId: number; amountCents: number; }

@Injectable()
export class PaymentOrdersService {
  constructor(
    private readonly repo: PaymentOrdersRepository,
    private readonly projections: ProjectionMaintenanceService,
  ) {}

  create(input: CreatePaymentOrderInput): Promise<PaymentOrder> {
    return this.repo.runInTransaction(async (tx) => {
      const worker = await this.repo.workerInTransaction(tx, input.workerId);
      if (!worker) {
        throw new ApiError(400, 'validation_failed', `Worker ${input.workerId} does not exist`, { workerId: input.workerId });
      }
      const order = await this.repo.insertOrder(tx, input);
      await this.repo.insertEvent(tx, order.id, 'created');
      // The synchronous projection maintenance hook, inside this transaction.
      await this.projections.onOrderCreated(tx, order.id);
      return order;
    });
  }

  approve(orderId: number): Promise<number> { return this.transition('approve', orderId); }
  reject(orderId: number): Promise<number> { return this.transition('reject', orderId); }
  refund(orderId: number): Promise<number> { return this.transition('refund', orderId); }

  private transition(action: OrderAction, orderId: number): Promise<number> {
    const t = TRANSITIONS[action];
    return this.repo.findById(orderId).then(async (order) => {
      if (!order) {
        throw new ApiError(404, 'resource_not_found', `Payment order ${orderId} does not exist`, { orderId });
      }
      if (order.status !== t.from) {
        throw new ApiError(409, 'invalid_state_transition',
          `Payment order ${orderId} is ${order.status}; ${action} requires status ${t.from}`,
          { orderId, current: order.status, required: t.from });
      }
      // The guarded UPDATE inside transitionInTransaction re-checks the status
      // under the row lock, so a concurrent transition wins or loses atomically.
      return this.repo.transitionInTransaction(orderId, t.from as Status, t.to as Status, async (tx) => {
        await this.repo.insertEvent(tx, orderId, t.event);
        // The synchronous projection maintenance hook, in the same transaction
        // as the source write: approve → projection → totals, all-or-nothing.
        await this.projections.onOrderStatusChanged(tx, orderId, t.from as Status, t.to as Status);
      });
    });
  }
}
```
`TRANSITIONS[action].from` is typed as the literal 'pending' — assignable to Status ✓ (the literal is in the union) — no cast needed; but the `as const` gives `from: "pending"` ✓ assignable. I'll drop the cast.

The return of `.then(async ...)` — TS: the inner returns `Promise<number>` (the repo call) or throws → the overall `Promise<number>` ✓.

**The full operations.controller.ts** — with the import of OperationPage type for the return annotation.

Now, **the module files** — trivial.

**app.module.ts**:
```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { OperationsModule } from './operations/operations.module';
import { PaymentOrdersModule } from './payment-orders/payment-orders.module';
import { DriftRepairModule } from './drift-repair/drift-repair.module';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, OperationsModule, PaymentOrdersModule, DriftRepairModule],
})
export class AppModule {}
```

Now, the **tests import the services** — the services are provided and exported? `app.get(OperationsService)` — a provider in the compiled AppModule's graph ✓ app.get works regardless of exports (it searches the whole module tree) ✓.

**A potential test flake**: the backdated `UPDATE payment_orders SET created_at` in the "filters" test — the raw update is after the service writes; then re-derive → the projection's created_at = the backdated ✓.

Now — the **`resetTables`** truncates `order_events` first (the child) — with CASCADE the order doesn't matter, but I'll list the child first ✓. `RESTART IDENTITY` resets the serials → the deterministic ids 1,2,3… across tests — but I don't rely on specific ids (I use the returned ids) ✓. The worker id after reset is 1 — fine, the tests use the returned id.

Wait — a subtlety: the tests create workers with companyIds like 1, 7, 10… the companies aren't an entity (no companies table!) — companyId is just an int FK-less reference. ✓ (the schema has no companies table — is that OK? The dashboard filters by company; the total is per company. A companies table isn't needed for the read model; the source has companies implicitly. Hmm — should I add a `companies` table? The original join is "payment orders, events, workers" — no mention of a companies table. The company id is a plain reference. To match the spec's join set exactly, I'll omit a companies table. An ASSUMPTION comment? Minor; I'll add a comment in the schema: `// companies are referenced by company_id; no companies table in the source model.` OK, without an ASSUMPTION marker (it's just modeling). Actually, per the instructions, I'll add one `// ASSUMPTION:` where genuinely unresolved — the absence of a companies table is defensible from the spec's join list. I'll leave a short comment, no marker.

**Now, let me write the test files fully.**

test/payment-orders.spec.ts:

```ts
// Requires DATABASE_URL pointing at a throwaway Postgres database.
// The checked-in migration DDL is applied idempotently by test/helpers.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { ApiError } from '../src/common/api-error';
import { PrismaService } from '../src/prisma/prisma.service';
import { PaymentOrdersRepository } from '../src/payment-orders/payment-orders.repository';
import { PaymentOrdersService } from '../src/payment-orders/payment-orders.service';
import { OperationsService } from '../src/operations/operations.service';
import { createTestApp, ensureSchema, prismaOf, resetTables } from './helpers';

describe('payment order write path (simulated)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orders: PaymentOrdersService;
  let ops: OperationsService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = prismaOf(app);
    await ensureSchema(prisma);
    orders = app.get(PaymentOrdersService);
    ops = app.get(OperationsService);
  });

  beforeEach(async () => {
    await resetTables(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  it('a create and an approve are visible to the dashboard immediately (read your own writes)', async () => {
    const worker = await prisma.worker.create({ data: { companyId: 1, name: 'Ana' } });
    const created = await orders.create({ companyId: 1, workerId: worker.id, amountCents: 12000 });

    const asPending = await ops.listOperations({ companyId: 1, page: 1, pageSize: 10 });
    expect(asPending.items).toHaveLength(1);
    expect(asPending.items[0].status).toBe('pending');
    expect(asPending.items[0].lastEventKind).toBe('created');
    let totals = await ops.getCompanyTotals(1);
    expect(totals.pendingCount).toBe(1);
    expect(totals.pendingAmountCents).toBe(12000);

    await orders.approve(created.id);

    const asApproved = await ops.listOperations({ companyId: 1, page: 1, pageSize: 10 });
    const item = asApproved.items.find((i) => i.orderId === created.id);
    expect(item).toBeDefined();
    expect(item!.status).toBe('approved');
    expect(item!.lastEventKind).toBe('approved');
    expect(item!.workerName).toBe('Ana');
    expect(item!.amountCents).toBe(12000);
    totals = await ops.getCompanyTotals(1);
    expect(totals.pendingCount).toBe(0);
    expect(totals.pendingAmountCents).toBe(0);
    expect(totals.approvedCount).toBe(1);
    expect(totals.approvedAmountCents).toBe(12000);
  });

  it('enforces the status machine and answers with the error envelope', async () => {
    const worker = await prisma.worker.create({ data: { companyId: 1, name: 'Ana' } });
    const order = await orders.create({ companyId: 1, workerId: worker.id, amountCents: 500 });
    await orders.approve(order.id);

    await expect(orders.approve(order.id)).rejects.toMatchObject<ApiError>({
      statusCode: 409,
      code: 'invalid_state_transition',
    });
    await expect(orders.reject(order.id)).resolves.toBe(order.id); // refund? no — reject requires pending
```
Wait — reject requires pending; the order is approved → reject should fail. Fix: `await expect(orders.reject(order.id)).rejects.toMatchObject({ code: 'invalid_state_transition' });` and `await expect(orders.refund(order.id)).resolves.toBe(order.id);` then `await expect(orders.refund(order.id)).rejects...`.

    await expect(orders.approve(999999)).rejects.toMatchObject({ statusCode: 404, code: 'resource_not_found' });
  });

  it('a rolled-back write leaves no trace in the projection or the totals', async () => {
    const worker = await prisma.worker.create({ data: { companyId: 2, name: 'Bo' } });
    const order = await orders.create({ companyId: 2, workerId: worker.id, amountCents: 777 });
    const repo = app.get(PaymentOrdersRepository);

    await expect(
      repo.transitionInTransaction(order.id, 'pending', 'approved', async (tx) => {
        await tx.$executeRawUnsafe(
          'UPDATE company_totals SET approved_amount = approved_amount + 1 WHERE company_id = 2',
        );
        throw new Error('simulate a failure after the source update');
      }),
    ).rejects.toThrow('simulate a failure after the source update');

    const fresh = await prisma.paymentOrder.findUnique({ where: { id: order.id } });
    expect(fresh?.status).toBe('pending');
    const totals = await ops.getCompanyTotals(2);
    expect(totals.pendingCount).toBe(1);
    expect(totals.pendingAmountCents).toBe(777);
    expect(totals.approvedCount).toBe(0);
    expect(totals.approvedAmountCents).toBe(0);
  });

  it('keeps one company totals exact when approvals run concurrently', async () => {
    const worker = await prisma.worker.create({ data: { companyId: 7, name: 'Cy' } });
    const amounts = [1000, 2500, 4000, 555];
    const created = [];
    for (const amountCents of amounts) {
      created.push(await orders.create({ companyId: 7, workerId: worker.id, amountCents }));
    }
    const totalsBefore = await ops.getCompanyTotals(7);
    expect(totalsBefore.pendingCount).toBe(4);

    await Promise.all(created.map((o) => orders.approve(o.id)));

    const totals = await ops.getCompanyTotals(7);
    expect(totals.pendingCount).toBe(0);
    expect(totals.pendingAmountCents).toBe(0);
    expect(totals.approvedCount).toBe(4);
    expect(totals.approvedAmountCents).toBe(amounts.reduce((a, b) => a + b, 0));

    const page = await ops.listOperations({ companyId: 7, statuses: ['approved'], page: 1, pageSize: 10 });
    expect(page.total).toBe(4);
    expect(page.items.map((i) => i.amountCents).sort((a, b) => b - a)).toEqual([4000, 2500, 1000, 555]);
  });
});
```

`rejects.toMatchObject<ApiError>(...)` — toMatchObject on an Error instance: the code/statusCode properties exist ✓.

test/operations.spec.ts:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { DriftRepairJob } from '../src/drift-repair/drift-repair.job';
import { PrismaService } from '../src/prisma/prisma.service';
import { PaymentOrdersService } from '../src/payment-orders/payment-orders.service';
import { OperationsService } from '../src/operations/operations.service';
import { ReprojectionService } from '../src/operations/reprojection.service';
import { createTestApp, ensureSchema, prismaOf, resetTables } from './helpers';

describe('operations read model', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orders: PaymentOrdersService;
  let ops: OperationsService;
  let reproject: ReprojectionService;
  let drift: DriftRepairJob;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = prismaOf(app);
    await ensureSchema(prisma);
    orders = app.get(PaymentOrdersService);
    ops = app.get(OperationsService);
    reproject = app.get(ReprojectionService);
    drift = app.get(DriftRepairJob);
  });

  beforeEach(async () => { await resetTables(prisma); });
  afterAll(async () => { await app.close(); });

  async function seedWorker(companyId: number, name: string) {
    return prisma.worker.create({ data: { companyId, name } });
  }

  const windowTo = () => new Date(Date.now() + 60_000);

  it('filters by company, status and date range, sorts by recency and paginates', async () => {
    const w10 = await seedWorker(10, 'A');
    const w11 = await seedWorker(11, 'B');
    const a = await orders.create({ companyId: 10, workerId: w10.id, amountCents: 100 });
    const b = await orders.create({ companyId: 10, workerId: w10.id, amountCents: 200 });
    const c = await orders.create({ companyId: 10, workerId: w10.id, amountCents: 300 });
    const d = await orders.create({ companyId: 11, workerId: w11.id, amountCents: 500 });
    await Promise.all([orders.approve(a.id), orders.approve(b.id), orders.approve(d.id), orders.reject(c.id)]);

    // Backdate one order in the source, then re-derive so the projection carries it.
    await prisma.$executeRawUnsafe(`UPDATE payment_orders SET created_at = now() - interval '2 hours' WHERE id = ${a.id}`);
    await reproject.rederive(new Date(0), windowTo());

    const all = await ops.listOperations({ companyId: 10, page: 1, pageSize: 10 });
    expect(all.total).toBe(3);
    expect(all.items.map((i) => i.orderId)).toEqual([c.id, b.id, a.id]);

    const approvedOnly = await ops.listOperations({ companyId: 10, statuses: ['approved'], page: 1, pageSize: 10 });
    expect(approvedOnly.items.map((i) => i.orderId)).toEqual([b.id, a.id]);

    const oneHourAgo = new Date(Date.now() - 3_600_000);
    const recent = await ops.listOperations({ companyId: 10, from: oneHourAgo, page: 1, pageSize: 10 });
    expect(recent.items.map((i) => i.orderId)).toEqual([c.id, b.id]);

    const oldOnly = await ops.listOperations({ companyId: 10, to: oneHourAgo, page: 1, pageSize: 10 });
    expect(oldOnly.items.map((i) => i.orderId)).toEqual([a.id]);

    const page1 = await ops.listOperations({ companyId: 10, page: 1, pageSize: 2 });
    expect(page1.items.map((i) => i.orderId)).toEqual([c.id, b.id]);
    expect(page1.total).toBe(3);
    const page2 = await ops.listOperations({ companyId: 10, page: 2, pageSize: 2 });
    expect(page2.items.map((i) => i.orderId)).toEqual([a.id]);

    const otherCompany = await ops.listOperations({ companyId: 11, page: 1, pageSize: 10 });
    expect(otherCompany.items.map((i) => i.orderId)).toEqual([d.id]);
  });
```
Wait — `all.items.map` = [c, b, a] by created desc: c and b are at roughly the same now; a is backdated → last ✓. But b and c's created_at: c was created after b → c is newer ✓; even if tied, the id DESC tiebreak → c first ✓.

But — `recent` with from=now-1h: b and c are at "now" — but `now` at creation time vs `oneHourAgo` computed after — b, c are within the last hour ✓.

The `approvedOnly` ordering [b, a]: b is at now, a is backdated ✓.

```ts
  it('the dashboard reads only the projection: a source-only change is invisible until re-derivation', async () => {
    const worker = await seedWorker(20, 'Old Name');
    const order = await orders.create({ companyId: 20, workerId: worker.id, amountCents: 10 });
    await orders.approve(order.id);

    await prisma.$executeRawUnsafe(`UPDATE workers SET name = 'New Name' WHERE id = ${worker.id}`);

    let page = await ops.listOperations({ companyId: 20, page: 1, pageSize: 10 });
    expect(page.items[0].workerName).toBe('Old Name'); // the hot path does not join to workers

    await reproject.rederive(new Date(0), windowTo());
    page = await ops.listOperations({ companyId: 20, page: 1, pageSize: 10 });
    expect(page.items[0].workerName).toBe('New Name');
  });

  it('re-derivation rebuilds a damaged window from the source and is idempotent', async () => {
    const worker = await seedWorker(30, 'D');
    const o1 = await orders.create({ companyId: 30, workerId: worker.id, amountCents: 111 });
    const o2 = await orders.create({ companyId: 30, workerId: worker.id, amountCents: 222 });
    await Promise.all([orders.approve(o1.id), orders.approve(o2.id)]);

    await prisma.$executeRawUnsafe(
      `UPDATE operations_read_model SET status = 'pending', amount_cents = 1, last_event_kind = 'created' WHERE company_id = 30`,
    );
    await prisma.$executeRawUnsafe(`UPDATE company_totals SET approved_amount = 1 WHERE company_id = 30`);

    const first = await reproject.rederive(new Date(0), windowTo());
    expect(first.orders).toBe(2);

    const snapshot = async () => ({
      rows: await prisma.$queryRawUnsafe(
        `SELECT order_id, company_id, worker_id, worker_name, status, amount_cents, last_event_kind, created_at
         FROM operations_read_model WHERE company_id = 30 ORDER BY order_id`,
      ),
      totals: await prisma.$queryRawUnsafe(
        `SELECT company_id, pending_count, pending_amount, approved_count, approved_amount,
                rejected_count, rejected_amount, refunded_count, refunded_amount
         FROM company_totals WHERE company_id = 30`,
      ),
    });

    const afterFirst = await snapshot();
    expect(afterFirst.rows).toHaveLength(2);
    for (const row of afterFirst.rows as Array<{ status: string; amount_cents: number }>) {
      expect(row.status).toBe('approved');
    }
    const totalsRow = (afterFirst.totals as Array<Record<string, unknown>>)[0];
    expect(Number(totalsRow.approved_count)).toBe(2);
    expect(Number(totalsRow.approved_amount)).toBe(333);
    expect(Number(totalsRow.pending_count)).toBe(0);

    await reproject.rederive(new Date(0), windowTo());
    const afterSecond = await snapshot();
    expect(afterSecond).toEqual(afterFirst);
  });
```
`afterFirst.rows` is an unknown[] — I'll cast. The amount of o2 = 222 is approved; the total 333 ✓.

Hmm — `first.orders` = 2 (both in the window) ✓.

```ts
  it('the drift-repair job detects injected drift and repairs it', async () => {
    const worker = await seedWorker(40, 'E');
    const o1 = await orders.create({ companyId: 40, workerId: worker.id, amountCents: 1000 });
    const o2 = await orders.create({ companyId: 40, workerId: worker.id, amountCents: 2000 });
    await Promise.all([orders.approve(o1.id), orders.approve(o2.id)]);

    await prisma.$executeRawUnsafe(`UPDATE operations_read_model SET last_event_kind = 'created' WHERE order_id = ${o1.id}`);
    await prisma.$executeRawUnsafe(`DELETE FROM operations_read_model WHERE order_id = ${o2.id}`);
    await prisma.$executeRawUnsafe(
      `UPDATE company_totals SET approved_amount = approved_amount + 999, approved_count = approved_count + 1 WHERE company_id = 40`,
    );

    const report = await drift.run();
    expect(report.driftedOrders).toBe(2);
    expect(report.driftedCompanies).toBe(1);
    expect(report.repaired).not.toBeNull();

    const page = await ops.listOperations({ companyId: 40, page: 1, pageSize: 10 });
    expect(page.items).toHaveLength(2);
    for (const item of page.items) {
      expect(item.status).toBe('approved');
      expect(item.lastEventKind).toBe('approved');
    }
    const totals = await ops.getCompanyTotals(40);
    expect(totals.approvedCount).toBe(2);
    expect(totals.approvedAmountCents).toBe(3000);

    const clean = await drift.run();
    expect(clean.driftedOrders).toBe(0);
    expect(clean.driftedCompanies).toBe(0);
    expect(clean.repaired).toBeNull();
  });
```
✓.

The type of `report.repaired`: `{ orders: number; companies: number } | null` ✓.

Now — **the drift job's window**: the default 1 day; the orders are created at now ✓ in the window.

**helpers.ts** final:

```ts
// Test bootstrap. Requires DATABASE_URL pointing at a throwaway Postgres.
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ErrorEnvelopeFilter } from '../src/common/error-envelope.filter';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// The scheduled drift-repair job must not fire in the middle of a suite.
// DriftRepairJob reads this in onApplicationBootstrap, which runs in the
// specs' beforeAll, so setting it at module load is safe.
process.env.DRIFT_REPAIR_ENABLED = 'false';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalFilters(new ErrorEnvelopeFilter());
  await app.init();
  return app;
}

export function prismaOf(app: INestApplication): PrismaService {
  return app.get(PrismaService);
}

/** Apply the checked-in migration DDL (fully idempotent) so the specs can run against a fresh database. */
export async function ensureSchema(prisma: PrismaService): Promise<void> {
  const migrationsDir = resolve(process.cwd(), 'prisma', 'migrations');
  const entries = (await readdir(migrationsDir)).filter((e) => e !== 'migration_lock.toml').sort();
  for (const entry of entries) {
    const sql = await readFile(join(migrationsDir, entry, 'migration.sql'), 'utf8');
    for (const statement of sql.split(/;\r?\n/)) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) await prisma.$executeRawUnsafe(trimmed);
    }
  }
}

export async function resetTables(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE order_events, operations_read_model, company_totals, payment_orders, workers RESTART IDENTITY CASCADE',
  );
}
```

Now — the migration splitting: my migration file — I need to ensure each statement ends with `;` + newline and the final line ends with `;\n` (or at least `;` is followed by a newline/EOF). I'll write the file with a trailing newline after the final `;`. The split handles the last statement: the `...;\n` at EOF → split produces an empty final chunk ✓.

Also the migration has comments (lines starting with `--`) — they attach to the next statement chunk — fine (comments are valid SQL prefixes).

**Another check**: `ensureSchema` uses `$executeRawUnsafe` with multi-line statements ✓.

Now — **the PrismaClient default constructor** reads DATABASE_URL ✓; if absent, an error at connect → a clear failure.

**The tsconfig's "types": ["node"]** — vitest types aren't needed (I import from 'vitest' explicitly) ✓.

**The ESM import extension issue in src**: imports like `from './operations.repository'` — no extension. tsx (esbuild) resolves TS extensionless ✓. Vitest ✓. tsc --noEmit with moduleResolution Bundler ✓. Good.

**The `import type { Prisma } from '@prisma/client'`** in the repo — Prisma is used for the sql tag (value!) — `Prisma.sql` is a value import: `import { Prisma, PrismaClient } from '@prisma/client'` — PrismaClient is only used as a type (a Db union) — under strict, importing a class as a value is fine. Use `import { Prisma } from '@prisma/client'; import type { PrismaClient } from '@prisma/client';` ✓.

In projection-maintenance: `import type { Prisma } from '@prisma/client'` for `Prisma.TransactionClient` ✓ type-only.

In payment-orders.repository: `import { Prisma } from '@prisma/client'`? I use `Prisma.TransactionClient` (type only) and the `PaymentOrder` type → `import type { PaymentOrder, Prisma } from '@prisma/client'` ✓ (type-only import).

**Check the `$queryRaw` generic with `Prisma.sql` in `sourceOrdersInWindow`**: `db.$queryRaw<{ id: number; company_id: number }[]>(Prisma.sql\`...\`)` ✓.

Now — **the listOperations SQL** — `ORDER BY created_at DESC, order_id DESC` matches the index key order (company_id, status, created_at DESC, order_id DESC) ✓ (with a single status).

**The `ANY(${q.statuses})`** — the statuses array is e.g. ['approved'] ✓; when all four → matches everything ✓.

Now — **the DriftRepairJob logger** — a `Logger` instance per job ✓.

**The ScheduleModule in tests** — the cron is registered; disabled via the env; app.close clears the timer ✓.

**Check the `@Cron` import** — `import { Cron } from '@nestjs/schedule';` ✓.

**A potential TS error**: `@Cron(process.env.DRIFT_REPAIR_CRON ?? '*/5 * * * *')` — the decorator argument is evaluated at class creation ✓ fine.

Now, **the total count via window function with `status = ANY`** — a subtle point: if the statuses list has duplicates (the user passes the same status twice) — the controller dedupes ✓.

**parsePositiveInt for pageSize '0'** → rejected (≤0) ✓.

Now, **the `OperationPage` export** from operations.service for the controller's return type ✓.

**Let me reconsider the layering of `OperationsRepository` exporting `type Db`** — fine.

**The `rederiveBatch` method name** in the repo — used by ReprojectionService ✓.

**Check the ReprojectionService loop termination**: batch.length < BATCH_SIZE → break; otherwise continue with cursor=last id. If the batch length == BATCH, continue; the next query is id > cursor → terminates when empty ✓. The window bounds are fixed ✓.

**`rederive`'s from >= to check** — throws an ApiError validation_failed ✓.

Now, **the drift job's `run()` uses the repo's count methods with the default prisma** ✓.

**The `PrismaService`'s connection in tests**: `onModuleInit`'s `$connect` — if the DB is unreachable → a bootstrap error; acceptable (documented).

Now — **write the schema.prisma** in full:

```prisma
// marketplace-backoffice
// Source tables (payment orders, events, workers) + the operations read model.
// The DDL of the dashboard covering index lives in
// prisma/migrations/20240601000000_init/migration.sql because Prisma cannot
// express INCLUDE columns.

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Worker {
  id        Int    @id @default(autoincrement())
  companyId Int    @map("company_id")
  name      String @map("name")

  @@index([companyId])
  @@map("workers")
}

model PaymentOrder {
  id          Int          @id @default(autoincrement())
  companyId   Int          @map("company_id")
  workerId    Int          @map("worker_id")
  status      String       @default("pending") @map("status") // pending | approved | rejected | refunded
  amountCents Int          @map("amount_cents")
  createdAt   DateTime     @default(now()) @map("created_at")
  updatedAt   DateTime     @default(now()) @updatedAt @map("updated_at")
  worker      Worker       @relation(fields: [workerId], references: [id])
  events      OrderEvent[]

  @@index([companyId])
  @@index([createdAt])
  @@map("payment_orders")
}

model OrderEvent {
  id        Int          @id @default(autoincrement())
  orderId   Int          @map("order_id")
  kind      String       @map("kind")
  createdAt DateTime     @default(now()) @map("created_at")
  order     PaymentOrder @relation(fields: [orderId], references: [id], onDelete: Cascade)

  @@index([orderId, [createdAt(sort: Desc), id(sort: Desc)]])
  @@map("order_events")
}

/// One row per payment order, shaped exactly like the dashboard query.
/// Maintained synchronously by the write path and by re-derivation.
model OperationRow {
  orderId       Int      @id @map("order_id")
  companyId     Int      @map("company_id")
  workerId      Int      @map("worker_id")
  workerName    String?  @map("worker_name") // snapshot; worker renames propagate via re-derivation
  status        String   @map("status")
  amountCents   Int      @map("amount_cents")
  lastEventKind String?  @map("last_event_kind")
  createdAt     DateTime @map("created_at")
  maintainedAt  DateTime @default(now()) @map("maintained_at")

  // The dashboard covering index (company_id, status, created_at DESC,
  // order_id DESC) INCLUDE (worker_id, worker_name, amount_cents,
  // last_event_kind) is applied by the init migration.
  @@map("operations_read_model")
}

/// Exact per-company financial totals, one row per company.
/// Maintained with in-place increments (never read-modify-write).
model CompanyTotals {
  companyId      Int      @id @map("company_id")
  pendingCount   Int      @default(0) @map("pending_count")
  pendingAmount  BigInt   @default(0) @map("pending_amount")
  approvedCount  Int      @default(0) @map("approved_count")
  approvedAmount BigInt   @default(0) @map("approved_amount")
  rejectedCount  Int      @default(0) @map("rejected_count")
  rejectedAmount BigInt   @default(0) @map("rejected_amount")
  refundedCount  Int      @default(0) @map("refunded_count")
  refundedAmount BigInt   @default(0) @map("refunded_amount")
  version        Int      @default(0) @map("version")
  updatedAt      DateTime @default(now()) @updatedAt @map("updated_at")

  @@map("company_totals")
}
```

Prisma `sort: Desc` — do I need `import`? In Prisma, `sort: Desc` inside an index uses the built-in enum `SortOrder` — the syntax in the schema is `sort: Desc` (no import needed) ✓.

Hmm — the nested-array index syntax `@@index([orderId, [createdAt(sort: Desc), id(sort: Desc)]])` — I've seen the doc example `@@index([email, [name(sort: Desc)]])`… Actually, the exact doc syntax:
```prisma
model User {
  id     Int    @id
  email  String
  name   String
  @@index([email, [name(sort: Desc)]])
}
```
Hmm wait, I'm now doubting: is it `[name(sort: Desc)]` or is it a flat `name(sort: Desc)`? The Prisma docs "sort order" section:
```prisma
model User {
  ...
  @@index([firstName, [lastName(sort: Desc)]])
}
```
I'm reasonably sure the nested form is correct. I'll go with it.

Now — **a concern**: `prisma generate` will run at postinstall; if the syntax is wrong, the generation fails and the tests can't run. The risk is acceptable; the nested form is documented.

**Migration timestamp directory**: `20240601000000_init` — Prisma migration directory naming: `<timestamp>_init` with a 14-digit timestamp: `20240601000000` is 14 digits ✓.

**migration_lock.toml** — Prisma creates it:
```
# Please do not edit this file manually
provider = "postgresql"
```
I can include it (it's part of the migrations directory) — harmless, and it tells the tooling the provider. I'll include it.

Now, **the `package.json`'s "prisma" field**? Not needed.

**The `.env` handling** — Prisma reads `.env` automatically; the tests need the DATABASE_URL env — the developer sets it (or a .env file, not committed). A comment in the tests + DESIGN covers it.

Now — **re-verify the requirements for "the controller validates input and calls the service. Zero business logic."** My OperationsController does parsing + range checks → validation ✓ (business logic = what to read; the service does that). The PaymentOrdersController parses the body ✓.

**"The service holds the logic. Zero raw SQL, zero Prisma client calls."** — the service: the PaymentOrdersService orchestration ✓ no prisma references at all ✓. The OperationsService ✓. The ReprojectionService ✓ (only the repo). The ProjectionMaintenanceService ✓ (only the repo, with the tx parameter). The DriftRepairJob ✓ (only the repo + the reproject service).

**"The repository is the only layer that touches the database."** ✓ (PrismaService + the raw SQL are in the repos; the PrismaService is the DB client provider — fine).

Now, **the error envelope filter** — catches everything including Prisma P2002 etc. ✓.

**main.ts** registers the filter ✓.

**A potential issue — `Test.createTestingModule({ imports: [AppModule] })`** — AppModule imports everything ✓ compiles.

**The ScheduleModule.forRoot() in the test app** — fine.

Now, **a potential runtime issue**: `@Cron` + `ScheduleModule.forRoot()` — the default timezone is fine.

**Let me check the `Prisma.sql` usage with `count(*) OVER ()`** — the window function alias `total` — `SELECT ... count(*) OVER () AS total` ✓.

**The bigint `total` from the driver → string** ✓ Number().

**Now, the `listOperations`'s `total` when there are 0 rows** → `rows.length === 0` → total 0 ✓ (I compute from rows[0]?.total ?? 0).

Let me write the repo's listOperations:

```ts
async listOperations(
  q: { companyId: number; statuses: readonly Status[]; from: Date; to: Date; limit: number; offset: number },
  db: Db = this.prisma,
): Promise<{ items: OperationRowData[]; total: number }> {
  // ASSUMPTION: "recency" = the order's creation time, so we sort by
  // created_at DESC with order_id DESC as the tiebreak for stable pages.
  // The query touches only the projection table; the covering index
  // (company_id, status, created_at DESC, order_id DESC) INCLUDE (...) makes
  // this an index-only scan.
  const rows = await db.$queryRaw<RawOperationRow[]>(
    Prisma.sql`
      SELECT order_id, company_id, worker_id, worker_name, status, amount_cents, last_event_kind, created_at,
             count(*) OVER () AS total
      FROM operations_read_model
      WHERE company_id = ${q.companyId}
        AND status = ANY(${q.statuses})
        AND created_at >= ${q.from}
        AND created_at < ${q.to}
      ORDER BY created_at DESC, order_id DESC
      LIMIT ${q.limit} OFFSET ${q.offset}
    `,
  );
  return { items: rows.map(mapOperationRow), total: rows.length > 0 ? Number(rows[0].total) : 0 };
}
```
`RawOperationRow` is a local type.

Hmm — `status = ANY(${q.statuses})` — q.statuses is `readonly Status[]` → at runtime, a string[] ✓.

**`getCompanyTotals`**:
```ts
async getCompanyTotals(companyId: number, db: Db = this.prisma): Promise<CompanyTotalsData> {
  const rows = await db.$queryRaw<Record<string, unknown>[]>(
    Prisma.sql`
      SELECT company_id, pending_count, pending_amount, approved_count, approved_amount,
             rejected_count, rejected_amount, refunded_count, refunded_amount, version
      FROM company_totals
      WHERE company_id = ${companyId}
    `,
  );
  return mapCompanyTotals(companyId, rows[0]);
}
```

**recomputeOperationRow**:
```ts
async recomputeOperationRow(orderId: number, db: Db = this.prisma): Promise<OperationRowData | null> {
  const rows = await db.$queryRaw<Record<string, unknown>[]>(
    Prisma.sql`
      SELECT po.id AS order_id, po.company_id, po.worker_id, w.name AS worker_name,
             po.status, po.amount_cents, po.created_at,
             (SELECT oe.kind
                FROM order_events oe
               WHERE oe.order_id = po.id
               ORDER BY oe.created_at DESC, oe.id DESC
               LIMIT 1) AS last_event_kind
      FROM payment_orders po
      LEFT JOIN workers w ON w.id = po.worker_id
      WHERE po.id = ${orderId}
    `,
  );
  return rows.length > 0 ? mapOperationRow(rows[0]) : null;
}
```

Good. Everything is consistent. Now — **the `mapOperationRow`** status cast: `r.status as Status`.

**A potential issue**: `Number(r.order_id)` — int4 → a JS number directly (the driver returns a number for int4) — Number() is a no-op, fine.

Now — **the `company_totals` select in the snapshot test** returns the bigint amount as a string ✓ I compare the object toEqual between snapshots (both are strings) ✓ and Number() for the explicit assertions ✓.

Now — let me think about **whether `ensureSchema` runs before `resetTables` in beforeAll/beforeEach** — the order: beforeAll (ensureSchema) runs once before the first beforeEach ✓.

**A test timeout** — the default 5s might be tight for the app bootstrap + the migration (a cold Postgres). I set testTimeout/hookTimeout 30000 ✓.

**Vitest `fileParallelism: false`** ✓.

Now — **the final file list** (27 files). Let me also consider a `README.md`? Not asked for — skip (DESIGN.md covers operations). The instruction says don't create files that aren't asked for — but package.json/tsconfig/vitest.config are necessary for "the whole solution." I'll keep them.

Wait — one more: **the `test/` convention** is `test/<feature>.spec.ts` ✓ I have `test/payment-orders.spec.ts`, `test/operations.spec.ts` + a helper `test/helpers.ts` (an additional file, justified).

Now, let me double-check the **Prisma interactive transaction callback type**: `(tx: Prisma.TransactionClient) => Promise<T>` ✓.

**`runInTransaction`** — `this.prisma.$transaction(work)` — the overload with a function ✓ returns Promise<T>.

**The `transitionInTransaction` return** Promise<number> ✓.

Now, the **PaymentOrdersRepository.workerInTransaction**:
```ts
workerInTransaction(tx: Prisma.TransactionClient, workerId: number): Promise<Worker | null> {
  return tx.worker.findUnique({ where: { id: workerId } });
}
```
Import the Worker type.

**The insertOrder data type**: `{ companyId: number; workerId: number; amountCents: number }` — Prisma's create data expects exactly that (no status → default pending) ✓.

Now — **the payment-orders.module.ts**:
```ts
import { Module } from '@nestjs/common';
import { OperationsModule } from '../operations/operations.module';
import { PaymentOrdersController } from './payment-orders.controller';
import { PaymentOrdersService } from './payment-orders.service';
import { PaymentOrdersRepository } from './payment-orders.repository';

@Module({
  imports: [OperationsModule],
  controllers: [PaymentOrdersController],
  providers: [PaymentOrdersService, PaymentOrdersRepository],
})
export class PaymentOrdersModule {}
```

**The operations.module.ts**:
```ts
import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';
import { OperationsRepository } from './operations.repository';
import { ProjectionMaintenanceService } from './projection-maintenance.service';
import { ReprojectionService } from './reprojection.service';

@Module({
  controllers: [OperationsController],
  providers: [OperationsService, OperationsRepository, ProjectionMaintenanceService, ReprojectionService],
  exports: [OperationsRepository, ProjectionMaintenanceService, ReprojectionService],
})
export class OperationsModule {}
```

**The drift-repair.module.ts**:
```ts
import { Module } from '@nestjs/common';
import { OperationsModule } from '../operations/operations.module';
import { DriftRepairJob } from './drift-repair.job';

@Module({
  imports: [OperationsModule],
  providers: [DriftRepairJob],
})
export class DriftRepairModule {}
```

Now, **the operations.controller.ts** imports:
```ts
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiError } from '../common/api-error';
import { parseOptionalDate, parsePositiveInt, parseRequiredPositiveInt, parseStatuses } from '../common/validation';
import { OperationsService, OperationPage } from './operations.service';
```

Let me write `list` with the correct return.

Now — a subtle **NestJS route collision**: the OperationsController with `@Controller()` (no prefix) and routes 'operations' and 'company-totals/:companyId' ✓ no collision with 'payment-orders'.

Now, **the `OperationPage` interface** is exported ✓.

I think the design is solid. Let me also add **the ASSUMPTION comments**:
1. operations.service or the repo list: recency = created_at. (I put it in the repo's listOperations.)
2. The controller's list: companyId required — `// ASSUMPTION: the dashboard is always company-scoped, so companyId is required; the covering index leads with company_id.`
3. The schema's OperationRow workerName snapshot comment (not an assumption but a design note) — fine.
4. The payment-orders service: `// ASSUMPTION: the write path is simulated with create/approve/reject/refund; refund is only valid from approved.` — is that a genuine design choice? The status set is my invention; I'll mark it: `// ASSUMPTION: order lifecycle is pending -> approved|rejected, approved -> refunded.` I'll put it in the TRANSITIONS comment.

Keep to 3-4 markers.

Now — **write the full contents of every file** carefully, ensuring import/export consistency.

Also — the **`import 'reflect-metadata'`** is only in main.ts; the tests create the app via Test — do the decorators need reflect-metadata? @nestjs/testing imports Nest which… NestJS requires reflect-metadata to be loaded before the framework; `@nestjs/core` itself imports 'reflect-metadata' internally (it does — @nestjs/core's index imports reflect-metadata) ✓. To be safe, I'll also add `import 'reflect-metadata'` to helpers.ts. Harmless.

**The `void bootstrap()`** in main.ts ✓.

**A potential TS strict issue in the error filter**: `host.switchToHttp().getResponse<Response>()` — a generic type parameter — the signature: `getResponse<T = any>()` ✓.

**`CODE_BY_STATUS`** computed with numeric keys ✓.

Now — **the `Prisma` import in the error filter** — `Prisma.PrismaClientKnownRequestError` is a class (a value) ✓ `import { Prisma } from '@prisma/client'`.

Now, let me reconsider **whether to include `@nestjs/platform-express`** — it's a transitive dependency of @nestjs/core (core depends on platform-express) — for `app.listen` etc., it's fine without an explicit dep? NestFactory.create uses platform-express — it's a dependency of @nestjs/core, so it's resolvable. Many templates list it explicitly. To be safe, I'll add `@nestjs/platform-express` to the deps.

Now — **the version compatibility**: @nestjs/schedule ^4.1.0 requires @nestjs/common ^8 || ^9 || ^10 ✓.

**Final check of the raw SQL strings for typos** — I'll write them carefully in the final answer.

One more thing: **`$executeRaw(Prisma.sql\`...\`)`** — Prisma.sql with many interpolations ✓.

**`recomputeCompanyTotals`** — the SELECT list order must match the INSERT column order:
Columns: company_id, pending_count, pending_amount, approved_count, approved_amount, rejected_count, rejected_amount, refunded_count, refunded_amount, version, updated_at
SELECT: po.company_id, count pending, sum pending, count approved, sum approved, count rejected, sum rejected, count refunded, sum refunded, 1, now() ✓.

`1` for version in the SELECT — the insert path version 1 ✓ (a literal int).

**The `COALESCE(count(*) FILTER (...), 0)`** — count with FILTER never returns NULL (it returns 0) — COALESCE is harmless; I'll keep just `count(*) FILTER (...)` — actually, count(*) FILTER returns 0 when there are no matching rows, not NULL ✓ I'll drop the COALESCE for count; keep it for sum.

Now — **a potential issue with `IS DISTINCT FROM` and a bigint vs int4 comparison** — pending_amount is bigint vs the sum's bigint ✓.

**The `t.pending_count <> a.pending_count`** int vs bigint? a.pending_count = count(*) → bigint; t.pending_count is int. `int <> bigint` → coerced ✓ fine. Or I could use IS DISTINCT FROM everywhere — I'll use `IS DISTINCT FROM` for all for uniformity and NULL safety (t is null-guarded by the `t.company_id IS NULL` OR — actually, when t.company_id IS NULL, the other t.* references are also NULL → `NULL IS DISTINCT FROM value` = true → already true; fine).

Now — **let me write it all.** I'll also make sure no file references something that doesn't exist.

**common/types.ts** — used across the repo/service/maintenance ✓.

**Check: `OperationsRepository` is exported from OperationsModule and injected into DriftRepairJob** ✓ via the module import.

**The `ReprojectionService` is injected into DriftRepairJob** ✓ exported.

**The `DriftRepairJob` is provided in DriftRepairModule** ✓; the test gets it from the app root ✓ (the app's injector can get any provider in the tree).

**One more consideration — `@Cron` and the `enabled` flag**: onApplicationBootstrap sets enabled=false in tests before any cron tick (the tick is at most 5 min away) ✓.

Also, in tests, ScheduleModule starts a cron with '*/5 * * * *' — the timer is cleared on app.close ✓.

**Now, the `package.json` "postinstall": "prisma generate"** — during pnpm install, the prisma CLI is available ✓.

**The engines** node >= 20 ✓.

Let me also add `"name": "marketplace-backoffice"` matching the issue's repo name.

**The final answer structure**: a level-3 heading per file + a fenced block. No prose between blocks ("keep it to nothing" — I'll output only the pattern). The order: package.json, tsconfig, vitest config, prisma schema, migration, migration_lock, src files, test files, DESIGN.md.

Let me now write the final contents of each file, double-checking the syntax as I go.

---

**package.json**:
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
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "migrate": "prisma migrate deploy",
    "start:dev": "tsx watch src/main.ts"
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
    "vitest": "^2.0.3"
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
    "strict": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "vitest.config.ts"]
}
```

**vitest.config.ts**:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    // The specs share one Postgres database; run the files sequentially.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
```

**prisma/schema.prisma** — as drafted above.

**prisma/migrations/20240601000000_init/migration.sql** — as drafted.

**prisma/migrations/migration_lock.toml**:
```toml
# Please do not edit this file manually
provider = "postgresql"
```

**src/main.ts**, **src/app.module.ts** — as drafted.

**src/prisma/prisma.module.ts**, **src/prisma/prisma.service.ts**.

**src/common/api-error.ts**:
```ts
/** Application error with the error-envelope code attached. */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
```

**src/common/error-envelope.filter.ts** — as drafted.

**src/common/types.ts** — as drafted.

**src/common/validation.ts** — as drafted.

**src/operations/operations.repository.ts** — the full version, all methods. Let me write it fully and carefully now.

```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CompanyTotalsData, OperationRowData, Status, TotalsDelta } from '../common/types';
import { zeroTotals } from '../common/types';

/** Either the pool client or a transaction client; both speak the same raw SQL. */
type Db = PrismaClient | Prisma.TransactionClient;

interface RawOperationRow {
  order_id: number;
  company_id: number;
  worker_id: number;
  worker_name: string | null;
  status: string;
  amount_cents: number;
  last_event_kind: string | null;
  created_at: Date;
  total: string;
}

function mapOperationRow(r: Record<string, unknown>): OperationRowData {
  return {
    orderId: Number(r.order_id),
    companyId: Number(r.company_id),
    workerId: Number(r.worker_id),
    workerName: (r.worker_name as string | null) ?? null,
    status: r.status as Status,
    amountCents: Number(r.amount_cents),
    lastEventKind: (r.last_event_kind as string | null) ?? null,
    createdAt: r.created_at as Date,
  };
}

function mapCompanyTotals(companyId: number, r?: Record<string, unknown>): CompanyTotalsData {
  if (!r) return zeroTotals(companyId);
  return {
    companyId,
    pendingCount: Number(r.pending_count),
    pendingAmountCents: Number(r.pending_amount),
    approvedCount: Number(r.approved_count),
    approvedAmountCents: Number(r.approved_amount),
    rejectedCount: Number(r.rejected_count),
    rejectedAmountCents: Number(r.rejected_amount),
    refundedCount: Number(r.refunded_count),
    refundedAmountCents: Number(r.refunded_amount),
    version: Number(r.version),
  };
}

@Injectable()
export class OperationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The dashboard query. Reads only the projection; the covering index
   * (company_id, status, created_at DESC, order_id DESC) INCLUDE (...) makes
   * this an index-only scan. count(*) OVER () returns the filtered total in
   * the same round-trip.
   */
  async listOperations(
    q: { companyId: number; statuses: readonly Status[]; from: Date; to: Date; limit: number; offset: number },
    db: Db = this.prisma,
  ): Promise<{ items: OperationRowData[]; total: number }> {
    // ASSUMPTION: "recency" means the order's creation time; created_at DESC
    // with order_id DESC as the tiebreak gives deterministic pages.
    const rows = await db.$queryRaw<RawOperationRow[]>(
      Prisma.sql`
        SELECT order_id, company_id, worker_id, worker_name, status, amount_cents,
               last_event_kind, created_at,
               count(*) OVER () AS total
        FROM operations_read_model
        WHERE company_id = ${q.companyId}
          AND status = ANY(${q.statuses})
          AND created_at >= ${q.from}
          AND created_at < ${q.to}
        ORDER BY created_at DESC, order_id DESC
        LIMIT ${q.limit} OFFSET ${q.offset}
      `,
    );
    return { items: rows.map(mapOperationRow), total: rows.length > 0 ? Number(rows[0].total) : 0 };
  }

  /** Exact per-company totals, straight from the maintained totals row. */
  async getCompanyTotals(companyId: number, db: Db = this.prisma): Promise<CompanyTotalsData> {
    const rows = await db.$queryRaw<Record<string, unknown>[]>(
      Prisma.sql`
        SELECT company_id, pending_count, pending_amount, approved_count, approved_amount,
               rejected_count, rejected_amount, refunded_count, refunded_amount, version
        FROM company_totals
        WHERE company_id = ${companyId}
      `,
    );
    return mapCompanyTotals(companyId, rows[0]);
  }

  /** Recompute one projection row from the source (order + worker + latest event). */
  async recomputeOperationRow(orderId: number, db: Db = this.prisma): Promise<OperationRowData | null> {
    const rows = await db.$queryRaw<Record<string, unknown>[]>(
      Prisma.sql`
        SELECT po.id AS order_id, po.company_id, po.worker_id, w.name AS worker_name,
               po.status, po.amount_cents, po.created_at,
               (SELECT oe.kind
                  FROM order_events oe
                 WHERE oe.order_id = po.id
                 ORDER BY oe.created_at DESC, oe.id DESC
                 LIMIT 1) AS last_event_kind
        FROM payment_orders po
        LEFT JOIN workers w ON w.id = po.worker_id
        WHERE po.id = ${orderId}
      `,
    );
    return rows.length > 0 ? mapOperationRow(rows[0]) : null;
  }

  /** Absolute-value upsert of one projection row; safe to run any number of times. */
  async upsertOperationRow(row: OperationRowData, db: Db = this.prisma): Promise<void> {
    await db.$executeRaw(
      Prisma.sql`
        INSERT INTO operations_read_model
          (order_id, company_id, worker_id, worker_name, status, amount_cents, last_event_kind, created_at, maintained_at)
        VALUES
          (${row.orderId}, ${row.companyId}, ${row.workerId}, ${row.workerName}, ${row.status},
           ${row.amountCents}, ${row.lastEventKind}, ${row.createdAt}, now())
        ON CONFLICT (order_id) DO UPDATE SET
          company_id = EXCLUDED.company_id,
          worker_id = EXCLUDED.worker_id,
          worker_name = EXCLUDED.worker_name,
          status = EXCLUDED.status,
          amount_cents = EXCLUDED.amount_cents,
          last_event_kind = EXCLUDED.last_event_kind,
          created_at = EXCLUDED.created_at,
          maintained_at = now()
      `,
    );
  }

  /**
   * Atomic in-place totals adjustment. The delta is added in the same
   * statement that creates the row, so two concurrent writers to the same
   * company row both apply — Postgres serializes them on the row lock and
   * neither increment is lost.
   */
  async applyTotalsDelta(companyId: number, d: TotalsDelta, db: Db = this.prisma): Promise<void> {
    await db.$executeRaw(
      Prisma.sql`
        INSERT INTO company_totals
          (company_id, pending_count, pending_amount, approved_count, approved_amount,
           rejected_count, rejected_amount, refunded_count, refunded_amount, version, updated_at)
        VALUES
          (${companyId}, ${d.pending.count}, ${d.pending.amountCents}, ${d.approved.count},
           ${d.approved.amountCents}, ${d.rejected.count}, ${d.rejected.amountCents},
           ${d.refunded.count}, ${d.refunded.amountCents}, 1, now())
        ON CONFLICT (company_id) DO UPDATE SET
          pending_count = company_totals.pending_count + EXCLUDED.pending_count,
          pending_amount = company_totals.pending_amount + EXCLUDED.pending_amount,
          approved_count = company_totals.approved_count + EXCLUDED.approved_count,
          approved_amount = company_totals.approved_amount + EXCLUDED.approved_amount,
          rejected_count = company_totals.rejected_count + EXCLUDED.rejected_count,
          rejected_amount = company_totals.rejected_amount + EXCLUDED.rejected_amount,
          refunded_count = company_totals.refunded_count + EXCLUDED.refunded_count,
          refunded_amount = company_totals.refunded_amount + EXCLUDED.refunded_amount,
          version = company_totals.version + 1,
          updated_at = now()
      `,
    );
  }

  /** Absolute-value recomputation of the totals rows for the given companies. */
  async recomputeCompanyTotals(companyIds: readonly number[], db: Db = this.prisma): Promise<void> {
    if (companyIds.length === 0) return;
    await db.$executeRaw(
      Prisma.sql`
        INSERT INTO company_totals AS ct
          (company_id, pending_count, pending_amount, approved_count, approved_amount,
           rejected_count, rejected_amount, refunded_count, refunded_amount, version, updated_at)
        SELECT po.company_id,
               count(*) FILTER (WHERE po.status = 'pending'),
               COALESCE(sum(po.amount_cents) FILTER (WHERE po.status = 'pending'), 0),
               count(*) FILTER (WHERE po.status = 'approved'),
               COALESCE(sum(po.amount_cents) FILTER (WHERE po.status = 'approved'), 0),
               count(*) FILTER (WHERE po.status = 'rejected'),
               COALESCE(sum(po.amount_cents) FILTER (WHERE po.status = 'rejected'), 0),
               count(*) FILTER (WHERE po.status = 'refunded'),
               COALESCE(sum(po.amount_cents) FILTER (WHERE po.status = 'refunded'), 0),
               1,
               now()
        FROM payment_orders po
        WHERE po.company_id = ANY(${companyIds})
        GROUP BY po.company_id
        ON CONFLICT (company_id) DO UPDATE SET
          pending_count = EXCLUDED.pending_count,
          pending_amount = EXCLUDED.pending_amount,
          approved_count = EXCLUDED.approved_count,
          approved_amount = EXCLUDED.approved_amount,
          rejected_count = EXCLUDED.rejected_count,
          rejected_amount = EXCLUDED.rejected_amount,
          refunded_count = EXCLUDED.refunded_count,
          refunded_amount = EXCLUDED.refunded_amount,
          version = ct.version + 1,
          updated_at = now()
      `,
    );
  }

  /** Source orders in the window, id-ordered for cursor batching. */
  async sourceOrdersInWindow(
    from: Date,
    to: Date,
    afterOrderId: number,
    limit: number,
    db: Db = this.prisma,
  ): Promise<Array<{ orderId: number; companyId: number }>> {
    const rows = await db.$queryRaw<Array<{ id: number; company_id: number }>>(
      Prisma.sql`
        SELECT id, company_id
        FROM payment_orders
        WHERE created_at >= ${from}
          AND created_at < ${to}
          AND id > ${afterOrderId}
        ORDER BY id
        LIMIT ${limit}
      `,
    );
    return rows.map((r) => ({ orderId: r.id, companyId: r.company_id }));
  }

  /**
   * One re-derivation batch: upsert the projection rows for a batch of orders
   * and recompute the affected companies' totals, inside a short transaction.
   * Idempotent — running it any number of times converges to the source state.
   */
  async rederiveBatch(from: Date, to: Date, afterOrderId: number, limit: number): Promise<Array<{ orderId: number; companyId: number }>> {
    return this.prisma.$transaction(async (tx) => {
      const batch = await this.sourceOrdersInWindow(from, to, afterOrderId, limit, tx);
      for (const b of batch) {
        const row = await this.recomputeOperationRow(b.orderId, tx);
        if (row) await this.upsertOperationRow(row, tx);
      }
      await this.recomputeCompanyTotals([...new Set(batch.map((b) => b.companyId))], tx);
      return batch;
    });
  }

  /** Projection rows in the window that disagree with the source (including missing ones). */
  async countDriftedOrders(from: Date, to: Date, db: Db = this.prisma): Promise<number> {
    const rows = await db.$queryRaw<Array<{ drifted: string }>>(
      Prisma.sql`
        WITH expected AS (
          SELECT po.id AS order_id, po.status, po.amount_cents, po.created_at, po.worker_id,
                 w.name AS worker_name,
                 (SELECT oe.kind
                    FROM order_events oe
                   WHERE oe.order_id = po.id
                   ORDER BY oe.created_at DESC, oe.id DESC
                   LIMIT 1) AS last_event_kind
          FROM payment_orders po
          LEFT JOIN workers w ON w.id = po.worker_id
          WHERE po.created_at >= ${from}
            AND po.created_at < ${to}
        )
        SELECT count(*) AS drifted
        FROM expected e
        LEFT JOIN operations_read_model r ON r.order_id = e.order_id
        WHERE r.order_id IS NULL
           OR r.status IS DISTINCT FROM e.status
           OR r.amount_cents IS DISTINCT FROM e.amount_cents
           OR r.created_at IS DISTINCT FROM e.created_at
           OR r.worker_id IS DISTINCT FROM e.worker_id
           OR r.worker_name IS DISTINCT FROM e.worker_name
           OR r.last_event_kind IS DISTINCT FROM e.last_event_kind
      `,
    );
    return Number(rows[0]?.drifted ?? 0);
  }

  /** Companies (with orders in the window) whose totals row disagrees with the source. */
  async countDriftedCompanies(from: Date, to: Date, db: Db = this.prisma): Promise<number> {
    const rows = await db.$queryRaw<Array<{ drifted: string }>>(
      Prisma.sql`
        WITH windowed AS (
          SELECT DISTINCT company_id
          FROM payment_orders
          WHERE created_at >= ${from}
            AND created_at < ${to}
        ),
        actual AS (
          SELECT po.company_id,
                 count(*) FILTER (WHERE po.status = 'pending') AS pending_count,
                 COALESCE(sum(po.amount_cents) FILTER (WHERE po.status = 'pending'), 0) AS pending_amount,
                 count(*) FILTER (WHERE po.status = 'approved') AS approved_count,
                 COALESCE(sum(po.amount_cents) FILTER (WHERE po.status = 'approved'), 0) AS approved_amount,
                 count(*) FILTER (WHERE po.status = 'rejected') AS rejected_count,
                 COALESCE(sum(po.amount_cents) FILTER (WHERE po.status = 'rejected'), 0) AS rejected_amount,
                 count(*) FILTER (WHERE po.status = 'refunded') AS refunded_count,
                 COALESCE(sum(po.amount_cents) FILTER (WHERE po.status = 'refunded'), 0) AS refunded_amount
          FROM payment_orders po
          JOIN windowed w ON w.company_id = po.company_id
          GROUP BY po.company_id
        )
        SELECT count(*) AS drifted
        FROM actual a
        LEFT JOIN company_totals t ON t.company_id = a.company_id
        WHERE t.company_id IS NULL
           OR t.pending_count IS DISTINCT FROM a.pending_count
           OR t.pending_amount IS DISTINCT FROM a.pending_amount
           OR t.approved_count IS DISTINCT FROM a.approved_count
           OR t.approved_amount IS DISTINCT FROM a.approved_amount
           OR t.rejected_count IS DISTINCT FROM a.rejected_count
           OR t.rejected_amount IS DISTINCT FROM a.rejected_amount
           OR t.refunded_count IS DISTINCT FROM a.refunded_count
           OR t.refunded_amount IS DISTINCT FROM a.refunded_amount
      `,
    );
    return Number(rows[0]?.drifted ?? 0);
  }
}
```

Wait — the `Db` type is exported? Not needed externally. Fine.

One thing: the `mapOperationRow(r: Record<string, unknown>)` called with `rows[0]` (a RawOperationRow) — assignable to Record<string, unknown>? A RawOperationRow with known properties → assignable to Record<string, unknown>? A TS interface with known properties → assignable to Record<string, unknown>? For type aliases (not interfaces), an object literal type is assignable to Record<string, unknown> ✓ (interface would fail due to the implicit index signature). RawOperationRow is an interface — the assignability of an interface to Record<string, unknown> fails! I call `mapOperationRow(rows[0])` where rows[0]: RawOperationRow (interface) → the error "Index signature for type 'string' is missing in type 'RawOperationRow'". Fix: make RawOperationRow a `type` alias (a type alias gets an implicit index signature) ✓. I'll use `type RawOperationRow = {...}`. And the other call: `mapOperationRow(rows[0])` where rows is `Record<string, unknown>[]` ✓ fine.

**operations.service.ts** — as drafted (no prisma injection).

**projection-maintenance.service.ts** — as drafted.

**reprojection.service.ts**:
```ts
import { Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error';
import { OperationsRepository } from './operations.repository';

const BATCH_SIZE = 500;

/**
 * Re-derivation for an arbitrary date window [from, to). Rebuilds the
 * projection rows and the affected companies' totals from the source
 * tables. Idempotent (absolute-value writes) and safe while live (short
 * per-batch transactions, no shared locks).
 */
@Injectable()
export class ReprojectionService {
  constructor(private readonly repo: OperationsRepository) {}

  async rederive(from: Date, to: Date): Promise<{ orders: number; companies: number }> {
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from.getTime() >= to.getTime()) {
      throw new ApiError(400, 'validation_failed', 're-derivation window: from must be a date earlier than to', { from, to });
    }
    let cursor = 0;
    let orders = 0;
    const companies = new Set<number>();
    for (;;) {
      const batch = await this.repo.rederiveBatch(from, to, cursor, BATCH_SIZE);
      if (batch.length === 0) break;
      orders += batch.length;
      for (const b of batch) companies.add(b.companyId);
      cursor = batch[batch.length - 1].orderId;
      if (batch.length < BATCH_SIZE) break;
    }
    return { orders, companies: companies.size };
  }
}
```

**drift-repair.job.ts** — as drafted (no prisma injection).

**operations.controller.ts** full:
```ts
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiError } from '../common/api-error';
import { parseOptionalDate, parsePositiveInt, parseRequiredPositiveInt, parseStatuses } from '../common/validation';
import { OperationsService } from './operations.service';
import type { OperationPage } from './operations.service';

@Controller()
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  /** The new dashboard list: projection only, p95 target < 50 ms. */
  @Get('operations')
  list(
    @Query('companyId') companyId: string | undefined,
    @Query('status') status: string | string[] | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
  ): Promise<OperationPage> {
    // ASSUMPTION: the dashboard is always company-scoped, so companyId is
    // required; the covering index leads with company_id.
    const companyId = parseRequiredPositiveInt(companyId, 'companyId');
    const statuses = parseStatuses(status);
    const fromDate = parseOptionalDate(from, 'from');
    const toDate = parseOptionalDate(to, 'to');
    if (fromDate !== undefined && toDate !== undefined && fromDate.getTime() >= toDate.getTime()) {
      throw new ApiError(400, 'validation_failed', 'from must be strictly earlier than to', {
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
      });
    }
    const pageNum = parsePositiveInt(page ?? '1', 'page');
    const size = parsePositiveInt(pageSize ?? '20', 'pageSize');
    if (size > 100) {
      throw new ApiError(400, 'validation_failed', 'pageSize must be at most 100', { pageSize: size });
    }
    return this.operations.listOperations({ companyId, statuses, from: fromDate, to: toDate, page: pageNum, pageSize: size });
  }

  /** Exact per-company financial totals (the projection's totals row). */
  @Get('company-totals/:companyId')
  totals(@Param('companyId') companyId: string) {
    return this.operations.getCompanyTotals(parseRequiredPositiveInt(companyId, 'companyId'));
  }
}
```

**payment-orders.controller.ts**:
```ts
import { Body, Controller, Param, Post } from '@nestjs/common';
import { parseRequiredPositiveInt } from '../common/validation';
import { PaymentOrdersService } from './payment-orders.service';

/**
 * Simulated write path: these endpoints are what a real order service would
 * do, and they are what invoke the projection maintenance hooks.
 */
@Controller('payment-orders')
export class PaymentOrdersController {
  constructor(private readonly orders: PaymentOrdersService) {}

  @Post()
  create(@Body() body: { companyId?: unknown; workerId?: unknown; amountCents?: unknown }) {
    const payload = body ?? {};
    return this.orders.create({
      companyId: parseRequiredPositiveInt(payload.companyId, 'companyId'),
      workerId: parseRequiredPositiveInt(payload.workerId, 'workerId'),
      amountCents: parseRequiredPositiveInt(payload.amountCents, 'amountCents'),
    });
  }

  @Post(':id/approve')
  approve(@Param('id') id: string) {
    return this.orders.approve(parseRequiredPositiveInt(id, 'id'));
  }

  @Post(':id/reject')
  reject(@Param('id') id: string) {
    return this.orders.reject(parseRequiredPositiveInt(id, 'id'));
  }

  @Post(':id/refund')
  refund(@Param('id') id: string) {
    return this.orders.refund(parseRequiredPositiveInt(id, 'id'));
  }
}
```

**payment-orders.repository.ts** — as drafted (with the Worker import).

**payment-orders.service.ts** — as drafted.

Now, **the error filter file** — the final version:

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { ApiError } from './api-error';

const CODE_BY_STATUS: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'validation_failed',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'validation_failed',
  [HttpStatus.NOT_FOUND]: 'resource_not_found',
  [HttpStatus.CONFLICT]: 'conflict',
};

/** Single error envelope for every error: { "error": { code, message, details } }. */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal_error';
    let message = 'An unexpected error occurred';
    let details: Record<string, unknown> = {};

    if (exception instanceof ApiError) {
      status = exception.statusCode;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      status = exception.code === 'P2025' ? HttpStatus.NOT_FOUND : HttpStatus.CONFLICT;
      code = status === HttpStatus.NOT_FOUND ? 'resource_not_found' : 'conflict';
      message = `Database request failed (Prisma ${exception.code})`;
      details = { prismaCode: exception.code };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = CODE_BY_STATUS[status] ?? 'error';
      message = exception.message;
    } else if (exception instanceof Error && exception.message) {
      message = exception.message;
    }

    response.status(status).json({ error: { code, message, details } });
  }
}
```

**common/validation.ts** — final (as drafted).

**common/types.ts** — final:
```ts
export const STATUSES = ['pending', 'approved', 'rejected', 'refunded'] as const;
export type Status = (typeof STATUSES)[number];

export interface OperationRowData {
  orderId: number;
  companyId: number;
  workerId: number;
  workerName: string | null;
  status: Status;
  amountCents: number;
  lastEventKind: string | null;
  createdAt: Date;
}

export interface CompanyTotalsData {
  companyId: number;
  pendingCount: number;
  pendingAmountCents: number;
  approvedCount: number;
  approvedAmountCents: number;
  rejectedCount: number;
  rejectedAmountCents: number;
  refundedCount: number;
  refundedAmountCents: number;
  version: number;
}

export interface TotalsDeltaEntry {
  count: number;
  amountCents: number;
}

export type TotalsDelta = Record<Status, TotalsDeltaEntry>;

export function zeroTotals(companyId: number): CompanyTotalsData {
  return {
    companyId,
    pendingCount: 0,
    pendingAmountCents: 0,
    approvedCount: 0,
    approvedAmountCents: 0,
    rejectedCount: 0,
    rejectedAmountCents: 0,
    refundedCount: 0,
    refundedAmountCents: 0,
    version: 0,
  };
}

export function emptyTotalsDelta(): TotalsDelta {
  return {
    pending: { count: 0, amountCents: 0 },
    approved: { count: 0, amountCents: 0 },
    rejected: { count: 0, amountCents: 0 },
    refunded: { count: 0, amountCents: 0 },
  };
}
```

**operations.service.ts** final:
```ts
import { Injectable } from '@nestjs/common';
import { STATUSES } from '../common/types';
import type { CompanyTotalsData, OperationRowData, Status } from '../common/types';
import { OperationsRepository } from './operations.repository';

export interface OperationListQuery {
  companyId: number;
  statuses?: Status[];
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

export interface OperationPage {
  items: OperationRowData[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class OperationsService {
  constructor(private readonly repo: OperationsRepository) {}

  /** Dashboard read. The projection only — no join back to the source tables. */
  async listOperations(query: OperationListQuery): Promise<OperationPage> {
    const from = query.from ?? new Date(0);
    const to = query.to ?? new Date(Date.now() + 60_000);
    const statuses = query.statuses && query.statuses.length > 0 ? query.statuses : STATUSES;
    const { items, total } = await this.repo.listOperations({
      companyId: query.companyId,
      statuses,
      from,
      to,
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    });
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  getCompanyTotals(companyId: number): Promise<CompanyTotalsData> {
    return this.repo.getCompanyTotals(companyId);
  }
}
```
The `statuses` type: `Status[] | readonly Status[]` — the repo expects `readonly Status[]` ✓ the STATUSES constant is a readonly tuple ✓ assignable.

**drift-repair.job.ts** final — with the Logger and the cron:
```ts
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OperationsRepository } from '../operations/operations.repository';
import { ReprojectionService } from '../operations/reprojection.service';

export interface DriftRepairReport {
  windowFrom: Date;
  windowTo: Date;
  driftedOrders: number;
  driftedCompanies: number;
  repaired: { orders: number; companies: number } | null;
}

/**
 * The scheduled drift-repair job. Every `DRIFT_REPAIR_CRON` (default: every 5
 * minutes) it compares the projection to the source over the last
 * `DRIFT_REPAIR_WINDOW_DAYS` days (default 1) and re-derives the window when
 * anything disagrees. Drift is expected (deploy mid-transaction, manual
 * source fix); the job is what notices before a person does.
 */
@Injectable()
export class DriftRepairJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(DriftRepairJob.name);
  private enabled = true;
  private running = false;

  constructor(
    private readonly repo: OperationsRepository,
    private readonly reproject: ReprojectionService,
  ) {}

  onApplicationBootstrap(): void {
    this.enabled = (process.env.DRIFT_REPAIR_ENABLED ?? 'true') !== 'false';
  }

  @Cron(process.env.DRIFT_REPAIR_CRON ?? '*/5 * * * *')
  async runScheduled(): Promise<void> {
    if (!this.enabled || this.running) return;
    this.running = true;
    try {
      await this.run();
    } catch (err) {
      this.logger.error(`drift-repair run failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
    }
  }

  /** One comparison-and-repair pass; also called directly from the tests. */
  async run(windowDays: number = Number(process.env.DRIFT_REPAIR_WINDOW_DAYS ?? '1')): Promise<DriftRepairReport> {
    const windowTo = new Date();
    const windowFrom = new Date(windowTo.getTime() - windowDays * 86_400_000);

    const [driftedOrders, driftedCompanies] = await Promise.all([
      this.repo.countDriftedOrders(windowFrom, windowTo),
      this.repo.countDriftedCompanies(windowFrom, windowTo),
    ]);

    let repaired: DriftRepairReport['repaired'] = null;
    if (driftedOrders > 0 || driftedCompanies > 0) {
      repaired = await this.reproject.rederive(windowFrom, windowTo);
    }

    const report: DriftRepairReport = { windowFrom, windowTo, driftedOrders, driftedCompanies, repaired };
    this.logger.log(
      `drift-repair window=[${windowFrom.toISOString()} .. ${windowTo.toISOString()}] ` +
        `driftedOrders=${driftedOrders} driftedCompanies=${driftedCompanies} repaired=${repaired ? 'yes' : 'no'}`,
    );
    return report;
  }
}
```

Now — **the payment-orders.repository.ts** final:
```ts
import { Injectable } from '@nestjs/common';
import type { PaymentOrder, Prisma, Worker } from '@prisma/client';
import { ApiError } from '../common/api-error';
import type { Status } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PaymentOrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(orderId: number): Promise<PaymentOrder | null> {
    return this.prisma.paymentOrder.findUnique({ where: { id: orderId } });
  }

  workerInTransaction(tx: Prisma.TransactionClient, workerId: number): Promise<Worker | null> {
    return tx.worker.findUnique({ where: { id: workerId } });
  }

  insertOrder(
    tx: Prisma.TransactionClient,
    data: { companyId: number; workerId: number; amountCents: number },
  ): Promise<PaymentOrder> {
    return tx.paymentOrder.create({ data });
  }

  insertEvent(tx: Prisma.TransactionClient, orderId: number, kind: string): Promise<void> {
    return tx.orderEvent.create({ data: { orderId, kind } }).then(() => undefined);
  }

  /** Runs the write and its synchronous projection maintenance in one transaction. */
  runInTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work);
  }

  /**
   * Atomic status transition: the UPDATE matches only while the order is
   * still `from`. Two racing transitions on the same order serialize on the
   * row lock; the loser matches zero rows and gets a typed error. `work`
   * (the projection maintenance hook) runs in the same transaction, so it
   * commits or rolls back with the write.
   */
  transitionInTransaction(
    orderId: number,
    from: Status,
    to: Status,
    work: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.paymentOrder.updateMany({
        where: { id: orderId, status: from },
        data: { status: to },
      });
      if (result.count === 0) {
        const current = await tx.paymentOrder.findUnique({ where: { id: orderId }, select: { id: true, status: true } });
        if (!current) {
          throw new ApiError(404, 'resource_not_found', `Payment order ${orderId} does not exist`, { orderId });
        }
        throw new ApiError(
          409,
          'invalid_state_transition',
          `Payment order ${orderId} cannot move ${from} -> ${to}; current status is ${current.status}`,
          { orderId, from, to, current: current.status },
        );
      }
      await work(tx);
      return orderId;
    });
  }
}
```

**payment-orders.service.ts** final:
```ts
import { Injectable } from '@nestjs/common';
import type { PaymentOrder } from '@prisma/client';
import { ApiError } from '../common/api-error';
import { ProjectionMaintenanceService } from '../operations/projection-maintenance.service';
import { PaymentOrdersRepository } from './payment-orders.repository';

// ASSUMPTION: the simulated write path is create + these transitions;
// refund is only valid from approved.
const TRANSITIONS = {
  approve: { from: 'pending', to: 'approved', event: 'approved' },
  reject: { from: 'pending', to: 'rejected', event: 'rejected' },
  refund: { from: 'approved', to: 'refunded', event: 'refunded' },
} as const;

export type OrderAction = keyof typeof TRANSITIONS;

export interface CreatePaymentOrderInput {
  companyId: number;
  workerId: number;
  amountCents: number;
}

@Injectable()
export class PaymentOrdersService {
  constructor(
    private readonly repo: PaymentOrdersRepository,
    private readonly projections: ProjectionMaintenanceService,
  ) {}

  create(input: CreatePaymentOrderInput): Promise<PaymentOrder> {
    return this.repo.runInTransaction(async (tx) => {
      const worker = await this.repo.workerInTransaction(tx, input.workerId);
      if (!worker) {
        throw new ApiError(400, 'validation_failed', `Worker ${input.workerId} does not exist`, {
          workerId: input.workerId,
        });
      }
      const order = await this.repo.insertOrder(tx, input);
      await this.repo.insertEvent(tx, order.id, 'created');
      // Synchronous projection maintenance hook: runs inside this very
      // transaction, so the read model is updated at the same instant as the
      // source row, and a rolled-back create leaves no projection trace.
      await this.projections.onOrderCreated(tx, order.id);
      return order;
    });
  }

  approve(orderId: number): Promise<number> {
    return this.transition('approve', orderId);
  }

  reject(orderId: number): Promise<number> {
    return this.transition('reject', orderId);
  }

  refund(orderId: number): Promise<number> {
    return this.transition('refund', orderId);
  }

  private transition(action: OrderAction, orderId: number): Promise<number> {
    const t = TRANSITIONS[action];
    return this.repo.findById(orderId).then(async (order) => {
      if (!order) {
        throw new ApiError(404, 'resource_not_found', `Payment order ${orderId} does not exist`, { orderId });
      }
      if (order.status !== t.from) {
        throw new ApiError(
          409,
          'invalid_state_transition',
          `Payment order ${orderId} is ${order.status}; ${action} requires status ${t.from}`,
          { orderId, current: order.status, required: t.from },
        );
      }
      // transitionInTransaction re-checks the status under the row lock, so a
      // concurrent transition on the same order wins or loses atomically.
      return this.repo.transitionInTransaction(orderId, t.from, t.to, async (tx) => {
        await this.repo.insertEvent(tx, orderId, t.event);
        // Synchronous projection maintenance hook, in the same transaction
        // as the source write: order row, event, projection row and totals
        // all commit together.
        await this.projections.onOrderStatusChanged(tx, orderId, t.from, t.to);
      });
    });
  }
}
```
Type check: `t.from` is `'pending' | 'approved'` (a literal) — assignable to the Status parameter ✓. The return of `.then(async (order) => ...)` — the inner returns `Promise<number>` → the outer is `Promise<number>` ✓. But the method signature says `Promise<number>` and `.then` returns `Promise<number>` — ✓.

Hmm — `order.status !== t.from` — order.status is a string; t.from is a literal ✓ the comparison is fine.

Now — **check that everything compiles in my head**:

- `import { Prisma } from '@prisma/client'` used for the `Prisma.sql` value ✓.
- `type Db = PrismaClient | Prisma.TransactionClient` — the PrismaClient is a type import ✓.
- The `db.$queryRaw` / `db.$executeRaw` exist on both union members ✓ (the TransactionClient has them).

**One risk**: the `Prisma.TransactionClient` type — `import type { Prisma } from '@prisma/client'; Prisma.TransactionClient` ✓.

**The test file imports ApiError for toMatchObject** — actually I don't reference ApiError directly, except maybe for typing; I'll drop the unused import (noUnusedLocals isn't enabled, but it's cleaner to drop it).

`toMatchObject` on an error: `rejects.toMatchObject({ statusCode: 409, code: 'invalid_state_transition' })` — vitest's toMatchObject works on objects ✓.

Now — **the concurrent test**: 4 approves in parallel — each does a `findById` (a read) then a transaction. The creates are sequential (a for-loop with await) → the pending totals are 4 ✓. Then Promise.all. Each transition tx: updateMany guard (pending→approved), insert the event, the hook (recompute the row, upsert, the totals delta). Concurrent on the same totals row — serialized by the row lock ✓ exact.

A potential **deadlock**: the tx order: the order row lock (updateMany) → the operation row (upsert, its own row) → the totals row. Different order rows, different operation rows, the same totals row → no cycle ✓.

**The rollback test** — `repo.transitionInTransaction` with an after that does a raw UPDATE on the totals and throws → the tx rolls back: updateMany undone, the totals undone ✓. The assertion: the status is pending; the totals' pending 777/1, approved 0/0 ✓. Note: the create already set the pending totals ✓.

**The `fresh?.status`** — findUnique returns a non-null (the order exists) — I use `fresh?.status` → the type is `string | undefined` — the toBe('pending') ✓.

Now — **the operations spec's `seedWorker`** is defined inside the describe (a function declaration hoisted within the closure) — I'll define it as `async function` inside the describe body — accessible from the tests ✓ (a closure over prisma — the prisma is assigned in beforeAll — the function is called after ✓; TS: `prisma` is a let with a definite assignment — used inside the function — fine).

TS strict: `let prisma: PrismaService;` and then used in a closure — "used before assigned"? A TS control-flow: a `let` without an initializer used inside a function defined before the assignment — TS allows it (no error, since it can't prove it) — actually, TS only flags "Block-scoped variable used before its declaration" for a direct use-before-declaration in the same scope. Inside a nested function it's fine ✓.

**The `windowTo()`** helper inside the describe ✓.

**The snapshot typing in the idempotency test**:
```ts
const snapshot = async () => ({
  rows: await prisma.$queryRawUnsafe(`...`),
  totals: await prisma.$queryRawUnsafe(`...`),
});
```
`$queryRawUnsafe` without a generic → any[]? It returns Promise<any> (the default generic is any). Then `afterFirst.rows` is any → the cast is fine. TS strict allows the any usage ✓ (no noExplicitAny rule). OK.

`for (const row of afterFirst.rows as Array<{ status: string }>)` ✓.

**toEqual between two snapshots with Date objects** — vitest's toEqual does a deep comparison of Dates ✓.

Now — **the migration file's statement splitting**: I need to ensure no statement contains `;\n` internally. My SQL: no `;` except at statement ends ✓.

**`ensureSchema`** — `readdir` on the migrations directory; the entries: ['20240601000000_init', 'migration_lock.toml'] → filter out the lock ✓.

Now — **the `TRUNCATE ... RESTART IDENTITY CASCADE`** — payment_orders references workers; the operations_read_model has no FKs; company_totals has no FKs ✓ the order in the list is fine with CASCADE anyway.

**A potential issue**: `ensureSchema` runs before `resetTables` in beforeAll/beforeEach — the order: beforeAll (ensureSchema) runs once before the first beforeEach ✓.

**A test timeout** — the default 5s might be tight for the app bootstrap + the migration (a cold Postgres). I set testTimeout/hookTimeout 30000 ✓.

**Vitest `fileParallelism: false`** ✓.

Now — **write DESIGN.md** — the final text (I'll polish the draft above).

Also — the instruction: "start with the first heading." So the response begins directly with `### package.json`.

Let me count the files and their order:
1. package.json
2. tsconfig.json
3. vitest.config.ts
4. prisma/schema.prisma
5. prisma/migrations/migration_lock.toml
6. prisma/migrations/20240601000000_init/migration.sql
7. src/main.ts
8. src/app.module.ts
9. src/prisma/prisma.module.ts
10. src/prisma/prisma.service.ts
11. src/common/api-error.ts
12. src/common/error-envelope.filter.ts
13. src/common/types.ts
14. src/common/validation.ts
15. src/operations/operations.module.ts
16. src/operations/operations.controller.ts
17. src/operations/operations.service.ts
18. src/operations/operations.repository.ts
19. src/operations/projection-maintenance.service.ts
20. src/operations/reprojection.service.ts
21. src/payment-orders/payment-orders.module.ts
22. src/payment-orders/payment-orders.controller.ts
23. src/payment-orders/payment-orders.service.ts
24. src/payment-orders/payment-orders.repository.ts
25. src/drift-repair/drift-repair.module.ts
26. src/drift-repair/drift-repair.job.ts
27. test/helpers.ts
28. test/payment-orders.spec.ts
29. test/operations.spec.ts
30. DESIGN.md

The fence language: `ts` for TS, `prisma` for the schema, `sql` for SQL, `json` for JSON, `toml` for the lock, `md` for DESIGN.

Let me double-check a few remaining risks:

1. **`Prisma.sql` with a readonly array** — fine.
2. **`count(*) OVER ()` + `LIMIT`** — correct.
3. **`INSERT ... SELECT ... ON CONFLICT DO UPDATE` with an alias** — valid Postgres.
4. **`EXCLUDED.pending_count + ...`** — EXCLUDED is a row of the proposed insert ✓.
5. **`$executeRaw` returns a number** — unused ✓.
6. **Vitest `fileParallelism`** — a valid key in Vitest 2 ✓.
7. **`@nestjs/schedule` Cron string '*/5 * * * *'** — 5 fields, valid ✓.
8. **The Prisma schema's nested descending index** — the documented syntax ✓.
9. **`esModuleInterop` + `import { PrismaClient } from '@prisma/client'`** — a named import from CJS — TS with esModuleInterop handles it; Node ESM runtime: Prisma v5's @prisma/client default entry — does it export ESM-compatible named? The @prisma/client package's main is CJS; Node ESM's named-import detection via cjs-module-lexer — Prisma's generated client uses `module.exports = { PrismaClient, Prisma, ... }`? The default export of the generated index.js is `module.exports = require('.prisma/client/index')` with an added default — the lexer can detect `module.exports.X = ...` patterns? There's a known issue… but countless NestJS ESM + Prisma projects work (the Prisma client v4.16+ added an ESM wrapper: `@prisma/client` ships an `export` map with an ESM re-export for Node ESM? Actually, does Prisma 5 ship an `exports` field with an "import" condition? Let me think — the `@prisma/client` package.json (v5) has:
```json
"exports": {
  ".": {
    "types": "...",
    "default": "default.js"
  }
}
```
default.js is CJS. Node's CJS-ESM interop: named imports work if the lexer can statically analyze. Prisma's default.js: `module.exports = { ...Object.assign({}, require('.prisma/client/default')) }`? The lexer might not detect it → the named import fails at runtime.

Hmm, this is a real risk. The common fix: `import pkg from '@prisma/client'; const { PrismaClient } = pkg;` — but many Nest ESM tutorials use named imports fine with Prisma 5. I recall Prisma's generated client index does:
```js
Object.defineProperty(exports, "__esModule", { value: true });
...
const { PrismaClient } = require('.prisma/client');
exports.PrismaClient = PrismaClient;
```
Hmm, actually the generated `.prisma/client/index.js` uses `module.exports = {}` and then a bunch of `exports.X = X` via a tsc-compiled pattern… The top-level `@prisma/client/default.js` does:
```js
module.exports = {
  ...require('.prisma/client/default'),
}
```
That's not statically analyzable.

But — the tests run under **Vitest**, not raw Node ESM. Vitest (vite-node/esbuild) transforms CJS/ESM interop leniently — the named imports from CJS work under vitest regardless of the lexer. And the dev server (tsx) — tsx also handles interop well (esbuild-based, lenient). So in the contexts I ship (vitest tests + tsx dev), the named imports work. A raw `node dist/` build isn't part of my deliverables (no build script). Acceptable. I'll keep the named imports.

10. **`import 'reflect-metadata'` in helpers** — I'll add it.

11. **The `Test.createTestingModule` import from '@nestjs/testing'** ✓.

12. **The `INestApplication` type import** ✓.

13. **The `process.env.DRIFT_REPAIR_ENABLED = 'false'` in the helpers' top level** — runs at import time; the DriftRepairJob's onApplicationBootstrap reads it at init ✓.

14. **The `@Cron` expression at import time** — `process.env.DRIFT_REPAIR_CRON ?? '*/5 * * * *'` — in tests, the default is scheduled; the guard disables ✓.

15. **Prisma's `$transaction` default isolation** — the default ReadCommitted ✓ fine.

16. **The `status = ANY($1)` where $1 is a text[] and the column is text** ✓.

17. **The `created_at >= ${q.from}` where from = new Date(0)** — 1970 ✓ within the timestamptz range.

18. **The `LIMIT ${q.limit}`** — a number parameter ✓.

19. **The `offset`** — a number ✓.

20. **The `mapOperationRow(rows[0])` where rows[0] is a RawOperationRow (type alias)** — RawOperationRow is a type alias → an implicit index signature → assignable to Record<string, unknown> ✓ (I made it a type alias).

Actually, wait — I pass `r: Record<string, unknown>` and call `mapOperationRow(rows[0])` where rows: RawOperationRow[] — a type alias is assignable to Record<string, unknown>? A type alias of an object literal type gets an implicit index signature for assignability ✓ (yes — type aliases of object literal types are assignable to index signature types; interfaces are not). ✓.

And in recomputeOperationRow, the rows are typed as `Record<string, unknown>[]` → `rows[0]` is Record ✓.

21. **`Prisma.sql` interpolation of `null`** (workerName can be null) ✓ supported.

22. **The BigInt amount in `applyTotalsDelta`** — the JS number is passed → the pg driver sends a numeric literal → the bigint column coerces ✓.

23. **The `version` in getCompanyTotals** ✓.

24. **The test `expect(totals.approvedAmountCents).toBe(12000)`** — the repo maps via Number(bigint string) ✓ a number.

25. **The `page.items[0].workerName`** in the "projection-only read" test — items is non-empty (1 order) ✓.

26. **The ordering assertion `toEqual([c.id, b.id, a.id])`** — c.id > b.id > a.id (created in that order; the autoincrement is reset per test via TRUNCATE RESTART IDENTITY → the ids are 1,2,3,4 across the test — the worker takes the first id! worker1 = id 1 (company 10), worker2 = id 2 (company 11); then orders: a=1, b=2, c=3 (company 10), d=4 (company 11). The created_at ordering: a, b, c, d increasing; a is backdated → [c, b, a] ✓.

27. **`oneHourAgo`** is computed after the creation + the re-derivation — b and c are created within seconds → > oneHourAgo ✓. a is at now-2h < oneHourAgo ✓.

28. **The `recent` query's `from: oneHourAgo`** — `created_at >= oneHourAgo` — b, c ✓ a excluded ✓.

29. **The `oldOnly` query's `to: oneHourAgo`** — `created_at < oneHourAgo` — a ✓; b, c excluded ✓. But wait — the default `from` is new Date(0) ✓.

30. **The drift job's default windowDays=1** — the orders are at now ✓.

31. **The `report.repaired` is not null** — `{ orders: 2, companies: 1 }` ✓.

32. **After the drift repair, `clean.run()`** — driftedOrders 0 ✓ (the projection now matches), the totals match ✓ → repaired is null ✓.

33. **`expect(clean.repaired).toBeNull()`** ✓.

34. **The idempotency test's `first.orders` = 2** ✓ (the window covers everything: from epoch).

35. **The damage UPDATE `WHERE company_id = 30`** — 2 rows ✓.

36. **After the first re-derive, `afterFirst.totals`** — company_totals for 30: approved 2/333 ✓ (the recompute is absolute).

37. **`afterSecond` toEqual `afterFirst`** — the rows are identical (the absolute-value upsert sets the same values; created_at is unchanged; maintained_at is not selected) ✓ the totals are identical (the absolute recompute; version is not selected) ✓.

One caveat — the snapshot's SQL selects a fixed column list — maintained_at and version are excluded ✓ intentional.

38. **The `ensureSchema` idempotency** — all DDL is IF NOT EXISTS ✓ (re-runnable across spec files).

39. **A worker FK violation in `resetTables`** — TRUNCATE handles the FKs with CASCADE ✓.

40. **The Prisma client's `prisma.worker.create` in the test** — the model name `worker` ✓ (the Worker model → the prisma.worker delegate).

41. **The `prisma.paymentOrder.findUnique`** ✓.

42. **The `tx.$executeRawUnsafe` in the rollback test** — the TransactionClient has $executeRawUnsafe ✓.

43. **Nest DI**: PaymentOrdersService's constructor(repo, projections) — both provided/imported ✓. OperationsService(repo) ✓. DriftRepairJob(repo, reproject) ✓ both exported by OperationsModule and imported by DriftRepairModule ✓.

44. **The `@Controller()` with an empty prefix** — routes are absolute ✓.

45. **The Express Response type** — @types/express ✓.

46. **The `httpAdapter`** default express ✓.

47. **`app.useGlobalFilters(new ErrorEnvelopeFilter())`** in both main and the tests ✓.

48. **Vitest + decorators + emitDecoratorMetadata** — vitest uses esbuild; esbuild supports emitDecoratorMetadata? esbuild supports experimentalDecorators but does not fully support emitDecoratorMetadata — it emits the `__metadata` design:type only if it can infer… For NestJS DI, the constructor parameters are decorated? My services use constructor parameter injection without @Inject — Nest needs the design:paramtypes metadata. esbuild's emitDecoratorMetadata support: does esbuild honor `emitDecoratorMetadata` since v0.?? — actually, esbuild does support emitDecoratorMetadata (limited: it emits metadata for constructor parameters it can resolve from imports? esbuild docs: "emitDecoratorMetadata is supported… but it cannot emit metadata for parameters without a type annotation"?). Hmm — a known issue: NestJS + esbuild (vitest) — the common workaround is that the design:paramtypes for constructor parameters typed as classes works because esbuild can emit the metadata for the parameter type if the type is a class reference resolvable in that module. esbuild's implementation: with experimentalDecorators + emitDecoratorMetadata on, it emits `__metadata("design:paramtypes", [A, B])` for constructor parameters whose TS type is an identifier (a class) — yes, esbuild supports this for class types. My constructor parameters are all class types (PrismaService, repositories, services, Logger — Logger is a class ✓). No primitives/arrays in the constructor parameters ✓. So the DI metadata works under esbuild/vitest ✓. (The @nestjs/testing + vitest combination is widely used with this exact setup.)

Wait — `DriftRepairJob`'s constructor: `(private readonly repo: OperationsRepository, private readonly reproject: ReprojectionService)` ✓ classes. `new Logger(DriftRepairJob.name)` is in the field initializer ✓.

`PrismaService extends PrismaClient` — the paramtypes for PrismaModule's providers [PrismaService] ✓.

The controllers: the constructor parameters are services ✓.

49. **The `useGlobalFilters`** — fine.

50. **The `parseStatuses` with an array from @Query** — Nest passes an array when the query param is repeated ✓ typed `string | string[] | undefined` ✓.

51. **The `@Query('status') status: string | string[]`** — Nest injects a string for a single occurrence ✓.

52. **The `OperationPage` export type** ✓.

53. **The `DESIGN.md`** — the content is fine.

54. **The `tsconfig` includes vitest.config.ts** ✓.

55. **The `process` global in the tests** — @types/node ✓.

56. **The `readdir/readFile` import from 'node:fs/promises'** ✓.

One more: **`test/helpers.ts`** sets the env — but the `@Cron` decorator in drift-repair.job is evaluated when that module is imported (via the helpers' static import chain) — the expression is the default '*/5 * * * *'. The ScheduleModule schedules a cron that fires every 5 min — in tests, it might fire if the suite runs for >5 min — but the `enabled` flag (set at bootstrap from the env) blocks the run ✓.

57. **The `86_400_000`** numeric separator ✓ ES2021+.

58. **The `for (;;)` loop** ✓.

59. **The `Prisma.sql` template with a leading newline** ✓ fine.

60. **The migration's `SERIAL` vs the Prisma's `@default(autoincrement())`** ✓ consistent.

I think I'm ready to write the final answer. Let me also ensure the fenced blocks contain only file contents and the headings are exactly the repository-relative paths.

One more point about the format: "For each file, a level-3 heading containing only the repository-relative path, immediately followed by a single fenced block containing only the contents of that file." So:

### package.json
```json
...
```

No extra text. I'll output all 30 files in a reasonable order (config, prisma, src, test, docs).

Let me finalize the migration SQL text (making sure the splitting works):

```sql
-- Source tables
CREATE TABLE IF NOT EXISTS workers (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  name TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workers_company_id ON workers (company_id);

CREATE TABLE IF NOT EXISTS payment_orders (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  worker_id INTEGER NOT NULL REFERENCES workers (id),
  status TEXT NOT NULL DEFAULT 'pending',
  amount_cents INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_orders_company_id ON payment_orders (company_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_created_at ON payment_orders (created_at);

CREATE TABLE IF NOT EXISTS order_events (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES payment_orders (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_events_order_id_latest ON order_events (order_id, created_at DESC, id DESC);

-- Read model: one row per payment order, shaped like the dashboard query.
CREATE TABLE IF NOT EXISTS operations_read_model (
  order_id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL,
  worker_id INTEGER NOT NULL,
  worker_name TEXT,
  status TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  last_event_kind TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  maintained_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Covering index for the dashboard access pattern:
-- company_id + status filter, created_at DESC / order_id DESC sort, all other
-- selected columns in INCLUDE, so the list query is an index-only scan.
CREATE INDEX IF NOT EXISTS idx_operations_read_model_dashboard
  ON operations_read_model (company_id, status, created_at DESC, order_id DESC)
  INCLUDE (worker_id, worker_name, amount_cents, last_event_kind);

-- Exact per-company financial totals, maintained with in-place increments.
CREATE TABLE IF NOT EXISTS company_totals (
  company_id INTEGER PRIMARY KEY,
  pending_count INTEGER NOT NULL DEFAULT 0,
  pending_amount BIGINT NOT NULL DEFAULT 0,
  approved_count INTEGER NOT NULL DEFAULT 0,
  approved_amount BIGINT NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  rejected_amount BIGINT NOT NULL DEFAULT 0,
  refunded_count INTEGER NOT NULL DEFAULT 0,
  refunded_amount BIGINT NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Good — each statement ends with `;` at end of line ✓ the splitting works (the CREATE INDEX spanning 3 lines ends with `);`? No — the INCLUDE line ends with `);` — yes, `INCLUDE (...)` ends with `);` — wait:
```
CREATE INDEX IF NOT EXISTS idx_operations_read_model_dashboard
  ON operations_read_model (company_id, status, created_at DESC, order_id DESC)
  INCLUDE (worker_id, worker_name, amount_cents, last_event_kind);
```
The final line ends with `;` ✓.

The splitting regex `/;\r?\n/` — the final statement ends with `;\n` (file ends with a newline) → an empty chunk ✓.

Now — the `ensureSchema` executes each chunk with $executeRawUnsafe — a comment-prefixed chunk (e.g. `-- Source tables\nCREATE TABLE...`) ✓ valid.

Now, **the schema.prisma** — one concern: `@@index([orderId, [createdAt(sort: Desc), id(sort: Desc)]])` — hmm, the exact Prisma syntax for multiple sorted fields: the docs show:
```prisma
@@index([email, [name(sort: Desc)]])
```
For two: `@@index([orderId, [createdAt(sort: Desc), id(sort: Desc)]])` — I believe the nested array can hold multiple FieldRefs with sort modifiers. Even if I'm slightly wrong, the generate failure is the only risk; I'll accept it. Actually — as a hedge, I could simplify to a single sorted field group that matches the migration: the migration index is (order_id, created_at DESC, id DESC). Alternative schema: `@@index([orderId, createdAt(sort: Desc), id(sort: Desc)])`? If the top-level sort syntax is invalid… I'll go with the nested form; it's the documented one.

Hmm, actually, now I recall the exact doc example from the Prisma docs (indexes page, "Sort order"):
```prisma
model User {
  id    Int    @id
  email String
  name  String

  @@index([email, [name(sort: Desc)]])
}
```
Wait, that doesn't look right either — email + name… The docs example is actually:
```prisma
model User {
  ...
  @@index([email, [name(sort: Desc)]])
}
```
I'm reasonably sure. The multiple-fields case works the same. Proceed.

Now — **the final DESIGN.md** (I'll write it in full in the answer).

Also, a small point: the task says "a short DESIGN.md" — I'll keep it to ~120 lines.

Let me also double-check that the **`OperationsService`'s unused import** — `OperationRowData` is used in the OperationPage interface ✓; `Status` is used ✓; `CompanyTotalsData` ✓.

**The `reprojection.service.ts`** — the ApiError import is used ✓.

**The `validation.ts`** — the STATUSES import is used ✓.

**The `operations.repository.ts`** — zeroTotals is used in mapCompanyTotals ✓; Status, OperationRowData, CompanyTotalsData, TotalsDelta are used ✓.

**The `projection-maintenance.service.ts`** — emptyTotalsDelta, Status, ApiError, Prisma type, OperationsRepository ✓ all used.

Now, one more thought: **should the `OperationsRepository.listOperations`'s `total` use the window function** — a Postgres-only feature ✓ fine.

**The potential issue: `count(*) OVER ()` with an `OFFSET`** — the window is computed on the filtered set before offset/limit → the total is constant across pages ✓.

I'm confident. Let me also make sure there are no stray non-ASCII characters.

**The final file order** in the response:
1. package.json
2. tsconfig.json
3. vitest.config.ts
4. prisma/schema.prisma
5. prisma/migrations/migration_lock.toml
6. prisma/migrations/20240601000000_init/migration.sql
7. src/main.ts
8. src/app.module.ts
9. src/prisma/prisma.module.ts
10. src/prisma/prisma.service.ts
11. src/common/api-error.ts
12. src/common/error-envelope.filter.ts
13. src/common/types.ts
14. src/common/validation.ts
15. src/operations/operations.module.ts
16. src/operations/operations.controller.ts
17. src/operations/operations.service.ts
18. src/operations/operations.repository.ts
19. src/operations/projection-maintenance.service.ts
20. src/operations/reprojection.service.ts
21. src/payment-orders/payment-orders.module.ts
22. src/payment-orders/payment-orders.controller.ts
23. src/payment-orders/payment-orders.service.ts
24. src/payment-orders/payment-orders.repository.ts
25. src/drift-repair/drift-repair.module.ts
26. src/drift-repair/drift-repair.job.ts
27. test/helpers.ts
28. test/payment-orders.spec.ts
29. test/operations.spec.ts
30. DESIGN.md

Let me write the final versions of the two spec files in full (assembling the pieces above and checking the imports).

test/payment-orders.spec.ts imports: vitest functions; INestApplication type; PrismaService; PaymentOrdersService; PaymentOrdersRepository; OperationsService; the helpers. (No ApiError import needed.)

test/operations.spec.ts imports: vitest; INestApplication; DriftRepairJob; PrismaService; PaymentOrdersService; OperationsService; ReprojectionService; the helpers.

Also — the `beforeEach` in the payment-orders spec: resetTables ✓; the same for the operations spec.

One more check — the **`expect(orders.reject(order.id)).rejects...`** in the "enforces the status machine" test — the order is approved; reject requires pending → the service's pre-read throws invalid_state_transition ✓ (the repo guard is not reached). ✓.

And `orders.refund(order.id)` resolves to order.id (a number) ✓ the repo returns orderId.

`await expect(orders.approve(999999)).rejects.toMatchObject({ statusCode: 404, code: 'resource_not_found' })` — the pre-read findById → null → ApiError 404 ✓.

Now — **a subtle point**: in the "enforces the status machine" test, after `orders.approve(order.id)`, the order is approved. Then `reject` → 409 ✓. Then `refund` → resolves ✓. Then `refund` again → 409 (now refunded) — I'll assert that too.

Let me also make sure **`orders.create` with a missing worker** → validation_failed — I could add a small assertion in the machine test: `await expect(orders.create({ companyId: 1, workerId: 9999, amountCents: 1 })).rejects.toMatchObject({ code: 'validation_failed', statusCode: 400 });` ✓ nice (it covers the worker check).

Now — **a potential timing issue in the concurrent test**: the 4 sequential creates each take a round-trip; fine.

**The `windowTo()` in the operations spec** — `new Date(Date.now() + 60_000)` ✓.

I think everything is consistent. Let me write it.

Actually — one more consideration about **`ensureSchema` running on every spec file** — both spec files call it in beforeAll; the idempotent DDL ✓.

And **the `prisma migrate deploy` path** — if the DB is already migrated, the ensureSchema is a no-op (IF NOT EXISTS) ✓.

Also — the **`migration_lock.toml`** content format:
```
# Please do not edit this file manually
provider = "postgresql"
```
✓.

Final check of the **`main.ts`** — the PORT env var: `process.env.PORT ? Number(process.env.PORT) : 3000` ✓ "configuration only from env vars" ✓.

Now, let me write the response. The fenced blocks must contain only the file contents — no comments outside the code fences.

For DESIGN.md, I'll keep it tight but complete. I'll include the rejected alternatives with reasons (the explicit deliverable).

Let me draft the DESIGN.md text:

```md
# DESIGN.md — Operations dashboard read model

## The constraint set

- p95 < 50 ms for the operations list (company + status + date-range filter,
  recency sort, pagination) at ~3M orders. Same columns, filters, ordering and
  page sizes as today.
- Read-your-own-writes: an operator's approval must be visible on the next
  request. Any refresh interval, however short, creates a visibility window, so
  a schedule-based refresh is disqualified by construction.
- Exact per-company financial totals: finance reconciles against them.

## The design

Two projection tables maintained by the write path:

- `operations_read_model` — one row per payment order, shaped exactly like the
  dashboard query (company, worker id + name snapshot, status, amount, latest
  event kind, created_at). The list query is a single index-only scan over this
  table; no join.
- `company_totals` — one row per company with per-status counts and amounts.

### 1. Synchronous maintenance hooks

`PaymentOrdersService` is the only writer to the source tables. Every write
(create, approve, reject, refund) runs inside one Prisma transaction and calls
the projection maintenance hook (`ProjectionMaintenanceService`) with the
transaction client, so the hook executes **inside the transaction that writes
the source row**:

- approve commits → the projection row and the totals row committed in the
  same instant → the next request sees them. No window.
- the write rolls back → the hook's updates roll back with it → the projection
  never saw it.

The hook does two things per order: an absolute-value upsert of the projection
row (recomputed from order + worker + latest event), and an in-place totals
increment derived from the transition (from → to).

### 2. Exact totals under concurrency

The totals row is never read-modify-written. The increment is an
`INSERT ... ON CONFLICT DO UPDATE SET x = x + delta` statement: Postgres
applies concurrent increments on the same row atomically, under the row lock.
Two approvals for the same company both apply; neither is lost. The test runs
them concurrently (Promise.all), not in sequence.

Transitions on the same order are made atomic with a guarded
`UPDATE ... WHERE id = ? AND status = ?`: racing actions serialize on the row
lock and the loser gets `invalid_state_transition`.

### 3. Re-derivation for an arbitrary window

`ReprojectionService.rederive(from, to)` rebuilds the projection for a window
from the source: id-ordered batches of 500 orders, each batch in a short
transaction that upserts the projection rows and recomputes the affected
companies' totals from scratch (absolute values). It is safe while live (no
long locks, no table scans held open) and idempotent — run it twice and the
state is the same. This is what makes the projection recoverable rather than
precious.

### 4. Scheduled drift-repair job

`DriftRepairJob` (cron `DRIFT_REPAIR_CRON`, default every 5 min) counts, for
the last `DRIFT_REPAIR_WINDOW_DAYS` (default 1), the projection rows that
disagree with the source (including missing ones) and the companies whose
totals disagree. Anything non-zero → re-derive the window. Drift is expected:
a deploy mid-transaction, a manual source fix, a hook added after a data
migration. The job is what notices before a person does.

### 5. The dashboard query

`GET /operations` reads only `operations_read_model`, served by the covering
index `(company_id, status, created_at DESC, order_id DESC)
INCLUDE (worker_id, worker_name, amount_cents, last_event_kind)` — filter on
the key prefix, sort in index order, all selected columns in the index, so the
read is an index-only scan with a bounded LIMIT. `count(*) OVER ()` returns the
filtered total in the same round-trip. `GET /company-totals/:companyId` reads
`company_totals`.

## Alternatives considered and rejected

| Alternative | Why it lost |
| --- | --- |
| Materialized view + scheduled refresh | Any refresh interval > 0 is a read-your-own-writes violation by construction; REFRESH is a full rebuild (unbounded cost at 3M rows) and blocks readers. |
| Outbox + async projection worker (CDC/queue) | Eventual: the operator's own write is invisible until the worker catches up — the exact window the requirement forbids. Also needs at-least-once delivery, ordering and replay handling to keep totals exact, plus extra infrastructure. |
| Database trigger | Same in-transaction correctness, but the maintenance logic moves out of the TypeScript write path: invisible in code review, untestable with the app's test suite, not managed by Prisma's schema tooling. The hook is the same semantics, in the layer where the write logic already lives. |
| A faster join (better indexes on the source) | A 3M-row multi-table join + aggregate cannot hit 50 ms p95 under refresh load, and per-company totals would require aggregating the whole company on every request. |
| Application-level lock/queue around the totals | A process-local mutex doesn't span instances and dies with the process. The DB row lock is the right serialization point and the in-place increment gets it for free. |

The synchronous hook is the only option that keeps the projection visible at
the same instant as the source write *and* keeps the totals exact without
extra infrastructure. Its cost is one upsert + one totals increment per order
mutation — both row-level, on hot pages.

## Failure modes and recovery

- Rolled-back write → hook rolls back too (tested).
- Deploy mid-transaction / manual source fix → drift → the repair job catches
  it within the cron interval for the windowed recent data; older data is
  repaired with an explicit `rederive(from, to)` (safe to run "just in case":
  idempotent).
- Catastrophe → drop both projection tables and run `rederive(min created_at,
  now())`.
- Worker rename → the projection holds a name snapshot (there is no worker
  write path in this codebase); renames propagate through re-derivation /
  drift repair.

## Configuration (environment only)

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | — (required) | Postgres connection |
| `PORT` | `3000` | API port |
| `DRIFT_REPAIR_CRON` | `*/5 * * * *` | Drift-repair schedule |
| `DRIFT_REPAIR_WINDOW_DAYS` | `1` | Window the job compares |
| `DRIFT_REPAIR_ENABLED` | `true` | `false` disables the schedule (tests) |

## Endpoints

- `GET /operations?companyId=&status=&from=&to=&page=&pageSize=` — the list
  (companyId required; status repeatable; ISO dates; pageSize ≤ 100)
- `GET /company-totals/:companyId` — exact totals
- `POST /payment-orders` `{ companyId, workerId, amountCents }` — the simulated
  write path
- `POST /payment-orders/:id/approve | /reject | /refund`

Errors use the single envelope `{ "error": { "code", "message", "details" } }`.
```

Good. Now I'll assemble the whole response. I'll double-check that each file's code is syntactically complete as I write it.

One more detail — **the `test/helpers.ts` import order**: I'll include `import 'reflect-metadata';` at the top.

And — **the spec file header comment** about DATABASE_URL ✓.

Also — `createTestApp` — `moduleRef.createNestApplication()` defaults to the express adapter ✓.

Now, in the **`beforeAll`** of both specs — the `await ensureSchema(prisma)` after the app init (the PrismaService has connected) ✓.

I'm ready. Let me write the final answer now. I'll be meticulous with the braces/parens in the SQL templates and TS.

A quick re-check of the `Prisma.sql` usage in `listOperations`: the template contains `${q.companyId}` etc. — all valid expressions. The SQL keywords are fine.

And `applyTotalsDelta` — `${d.pending.count}` — the dot access inside the template ✓.

The `recomputeCompanyTotals` — `${companyIds}` ✓.

`countDriftedOrders` — `${from}`, `${to}` ✓.

The `rederiveBatch` → `sourceOrdersInWindow(from, to, afterOrderId, limit, tx)` — the db parameter is explicitly passed ✓.

Final: the `Db` type is a local (not exported) — the repo methods' default parameter uses it ✓.

Let me also make sure `OperationsRepository`'s constructor parameter `private readonly prisma: PrismaService` — used in the default parameter `this.prisma` ✓.

Writing it now.
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
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "migrate": "prisma migrate deploy",
    "start:dev": "tsx watch src/main.ts"
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
    "vitest": "^2.0.3"
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
    "strict": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.spec.ts", "test/**/*.ts", "vitest.config.ts"]
}
```

### vitest.config.ts
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    // The specs share one Postgres database, so files must not run in parallel.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
```

### prisma/schema.prisma
```prisma
// marketplace-backoffice
// Source tables (payment orders, events, workers) plus the operations read model.
// The dashboard covering index is applied by
// prisma/migrations/20240601000000_init/migration.sql because Prisma cannot
// express INCLUDE columns.

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Worker {
  id        Int    @id @default(autoincrement())
  companyId Int    @map("company_id")
  name      String @map("name")

  @@index([companyId])
  @@map("workers")
}

model PaymentOrder {
  id          Int          @id @default(autoincrement())
  companyId   Int          @map("company_id")
  workerId    Int          @map("worker_id")
  status      String       @default("pending") @map("status") // pending | approved | rejected | refunded
  amountCents Int          @map("amount_cents")
  createdAt   DateTime     @default(now()) @map("created_at")
  updatedAt   DateTime     @default(now()) @updatedAt @map("updated_at")
  worker      Worker       @relation(fields: [workerId], references: [id])
  events      OrderEvent[]

  @@index([companyId])
  @@index([createdAt])
  @@map("payment_orders")
}

model OrderEvent {
  id        Int          @id @default(autoincrement())
  orderId   Int          @map("order_id")
  kind      String       @map("kind")
  createdAt DateTime     @default(now()) @map("created_at")
  order     PaymentOrder @relation(fields: [orderId], references: [id], onDelete: Cascade)

  @@index([orderId, [createdAt(sort: Desc), id(sort: Desc)]])
  @@map("order_events")
}

/// One row per payment order, shaped exactly like the dashboard query.
/// Maintained synchronously by the write path and by re-derivation.
model OperationRow {
  orderId       Int      @id @map("order_id")
  companyId     Int      @map("company_id")
  workerId      Int      @map("worker_id")
  workerName    String?  @map("worker_name") // snapshot; worker renames propagate via re-derivation
  status        String   @map("status")
  amountCents   Int      @map("amount_cents")
  lastEventKind String?  @map("last_event_kind")
  createdAt     DateTime @map("created_at")
  maintainedAt  DateTime @default(now()) @map("maintained_at")

  // Dashboard covering index (company_id, status, created_at DESC,
  // order_id DESC) INCLUDE (worker_id, worker_name, amount_cents,
  // last_event_kind) is applied by the init migration.
  @@map("operations_read_model")
}

/// Exact per-company financial totals, one row per company.
/// Maintained with in-place increments, never read-modify-write.
model CompanyTotals {
  companyId      Int      @id @map("company_id")
  pendingCount   Int      @default(0) @map("pending_count")
  pendingAmount  BigInt   @default(0) @map("pending_amount")
  approvedCount  Int      @default(0) @map("approved_count")
  approvedAmount BigInt   @default(0) @map("approved_amount")
  rejectedCount  Int      @default(0) @map("rejected_count")
  rejectedAmount BigInt   @default(0) @map("rejected_amount")
  refundedCount  Int      @default(0) @map("refunded_count")
  refundedAmount BigInt   @default(0) @map("refunded_amount")
  version        Int      @default(0) @map("version")
  updatedAt      DateTime @default(now()) @updatedAt @map("updated_at")

  @@map("company_totals")
}
```

### prisma/migrations/migration_lock.toml
```toml
# Please do not edit this file manually
provider = "postgresql"
```

### prisma/migrations/20240601000000_init/migration.sql
```sql
-- Source tables
CREATE TABLE IF NOT EXISTS workers (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  name TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workers_company_id ON workers (company_id);

CREATE TABLE IF NOT EXISTS payment_orders (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  worker_id INTEGER NOT NULL REFERENCES workers (id),
  status TEXT NOT NULL DEFAULT 'pending',
  amount_cents INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_orders_company_id ON payment_orders (company_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_created_at ON payment_orders (created_at);

CREATE TABLE IF NOT EXISTS order_events (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES payment_orders (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_events_order_id_latest ON order_events (order_id, created_at DESC, id DESC);

-- Read model: one row per payment order, shaped like the dashboard query.
CREATE TABLE IF NOT EXISTS operations_read_model (
  order_id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL,
  worker_id INTEGER NOT NULL,
  worker_name TEXT,
  status TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  last_event_kind TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  maintained_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Covering index for the dashboard access pattern:
-- company_id + status filter, created_at DESC / order_id DESC sort, and all
-- remaining selected columns in INCLUDE, so the list query is index-only.
CREATE INDEX IF NOT EXISTS idx_operations_read_model_dashboard
  ON operations_read_model (company_id, status, created_at DESC, order_id DESC)
  INCLUDE (worker_id, worker_name, amount_cents, last_event_kind);

-- Exact per-company financial totals, maintained with in-place increments.
CREATE TABLE IF NOT EXISTS company_totals (
  company_id INTEGER PRIMARY KEY,
  pending_count INTEGER NOT NULL DEFAULT 0,
  pending_amount BIGINT NOT NULL DEFAULT 0,
  approved_count INTEGER NOT NULL DEFAULT 0,
  approved_amount BIGINT NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  rejected_amount BIGINT NOT NULL DEFAULT 0,
  refunded_count INTEGER NOT NULL DEFAULT 0,
  refunded_amount BIGINT NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### src/main.ts
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ErrorEnvelopeFilter } from './common/error-envelope.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new ErrorEnvelopeFilter());
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3000);
}

void bootstrap();
```

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { OperationsModule } from './operations/operations.module';
import { PaymentOrdersModule } from './payment-orders/payment-orders.module';
import { DriftRepairModule } from './drift-repair/drift-repair.module';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, OperationsModule, PaymentOrdersModule, DriftRepairModule],
})
export class AppModule {}
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

### src/common/api-error.ts
```ts
/** Application error carrying the error-envelope code. */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
```

### src/common/error-envelope.filter.ts
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { ApiError } from './api-error';

const CODE_BY_STATUS: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'validation_failed',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'validation_failed',
  [HttpStatus.NOT_FOUND]: 'resource_not_found',
  [HttpStatus.CONFLICT]: 'conflict',
};

/** Single error envelope for every error: { "error": { "code", "message", "details" } }. */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal_error';
    let message = 'An unexpected error occurred';
    let details: Record<string, unknown> = {};

    if (exception instanceof ApiError) {
      status = exception.statusCode;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      status = exception.code === 'P2025' ? HttpStatus.NOT_FOUND : HttpStatus.CONFLICT;
      code = status === HttpStatus.NOT_FOUND ? 'resource_not_found' : 'conflict';
      message = `Database request failed (Prisma ${exception.code})`;
      details = { prismaCode: exception.code };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = CODE_BY_STATUS[status] ?? 'error';
      message = exception.message;
    } else if (exception instanceof Error && exception.message) {
      message = exception.message;
    }

    response.status(status).json({ error: { code, message, details } });
  }
}
```

### src/common/types.ts
```ts
export const STATUSES = ['pending', 'approved', 'rejected', 'refunded'] as const;
export type Status = (typeof STATUSES)[number];

export interface OperationRowData {
  orderId: number;
  companyId: number;
  workerId: number;
  workerName: string | null;
  status: Status;
  amountCents: number;
  lastEventKind: string | null;
  createdAt: Date;
}

export interface CompanyTotalsData {
  companyId: number;
  pendingCount: number;
  pendingAmountCents: number;
  approvedCount: number;
  approvedAmountCents: number;
  rejectedCount: number;
  rejectedAmountCents: number;
  refundedCount: number;
  refundedAmountCents: number;
  version: number;
}

export interface TotalsDeltaEntry {
  count: number;
  amountCents: number;
}

export type TotalsDelta = Record<Status, TotalsDeltaEntry>;

export function zeroTotals(companyId: number): CompanyTotalsData {
  return {
    companyId,
    pendingCount: 0,
    pendingAmountCents: 0,
    approvedCount: 0,
    approvedAmountCents: 0,
    rejectedCount: 0,
    rejectedAmountCents: 0,
    refundedCount: 0,
    refundedAmountCents: 0,
    version: 0,
  };
}

export function emptyTotalsDelta(): TotalsDelta {
  return {
    pending: { count: 0, amountCents: 0 },
    approved: { count: 0, amountCents: 0 },
    rejected: { count: 0, amountCents: 0 },
    refunded: { count: 0, amountCents: 0 },
  };
}
```

### src/common/validation.ts
```ts
import { ApiError } from './api-error';
import { STATUSES } from './types';
import type { Status } from './types';

export function parsePositiveInt(value: unknown, field: string): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value !== '' ? Number(value) : NaN;
  if (!Number.isInteger(n) || n <= 0) {
    throw new ApiError(400, 'validation_failed', `${field} must be a positive integer`, { field, received: String(value) });
  }
  return n;
}

export function parseRequiredPositiveInt(value: unknown, field: string): number {
  if (value === undefined || value === '') {
    throw new ApiError(400, 'validation_failed', `${field} is required`, { field });
  }
  return parsePositiveInt(value, field);
}

export function parseOptionalDate(value: unknown, field: string): Date | undefined {
  if (value === undefined || value === '') return undefined;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) {
    throw new ApiError(400, 'validation_failed', `${field} must be an ISO-8601 date`, { field, received: String(value) });
  }
  return d;
}

export function parseStatuses(value: string | string[] | undefined): Status[] | undefined {
  if (value === undefined) return undefined;
  const list = Array.isArray(value) ? value : [value];
  for (const s of list) {
    if (!STATUSES.includes(s as Status)) {
      throw new ApiError(400, 'validation_failed', `status must be one of: ${STATUSES.join(', ')}`, { received: s });
    }
  }
  return [...new Set(list as Status[])];
}
```

### src/operations/operations.module.ts
```ts
import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';
import { OperationsRepository } from './operations.repository';
import { ProjectionMaintenanceService } from './projection-maintenance.service';
import { ReprojectionService } from './reprojection.service';

@Module({
  controllers: [OperationsController],
  providers: [OperationsService, OperationsRepository, ProjectionMaintenanceService, ReprojectionService],
  exports: [OperationsRepository, ProjectionMaintenanceService, ReprojectionService],
})
export class OperationsModule {}
```

### src/operations/operations.controller.ts
```ts
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiError } from '../common/api-error';
import { parseOptionalDate, parsePositiveInt, parseRequiredPositiveInt, parseStatuses } from '../common/validation';
import { OperationsService } from './operations.service';
import type { OperationPage } from './operations.service';

@Controller()
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  /** The new dashboard list: reads the projection only, p95 target < 50 ms. */
  @Get('operations')
  list(
    @Query('companyId') companyId: string | undefined,
    @Query('status') status: string | string[] | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
  ): Promise<OperationPage> {
    // ASSUMPTION: the dashboard is always company-scoped, so companyId is
    // required; the covering index leads with company_id.
    const parsedCompanyId = parseRequiredPositiveInt(companyId, 'companyId');
    const statuses = parseStatuses(status);
    const fromDate = parseOptionalDate(from, 'from');
    const toDate = parseOptionalDate(to, 'to');
    if (fromDate !== undefined && toDate !== undefined && fromDate.getTime() >= toDate.getTime()) {
      throw new ApiError(400, 'validation_failed', 'from must be strictly earlier than to', {
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
      });
    }
    const pageNum = parsePositiveInt(page ?? '1', 'page');
    const size = parsePositiveInt(pageSize ?? '20', 'pageSize');
    if (size > 100) {
      throw new ApiError(400, 'validation_failed', 'pageSize must be at most 100', { pageSize: size });
    }
    return this.operations.listOperations({
      companyId: parsedCompanyId,
      statuses,
      from: fromDate,
      to: toDate,
      page: pageNum,
      pageSize: size,
    });
  }

  /** Exact per-company financial totals (the maintained totals row). */
  @Get('company-totals/:companyId')
  totals(@Param('companyId') companyId: string) {
    return this.operations.getCompanyTotals(parseRequiredPositiveInt(companyId, 'companyId'));
  }
}
```

### src/operations/operations.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { STATUSES } from '../common/types';
import type { CompanyTotalsData, OperationRowData, Status } from '../common/types';
import { OperationsRepository } from './operations.repository';

export interface OperationListQuery {
  companyId: number;
  statuses?: Status[];
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

export interface OperationPage {
  items: OperationRowData[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class OperationsService {
  constructor(private readonly repo: OperationsRepository) {}

  /** Dashboard read. Projection only — no join back to the source tables. */
  async listOperations(query: OperationListQuery): Promise<OperationPage> {
    const from = query.from ?? new Date(0);
    const to = query.to ?? new Date(Date.now() + 60_000);
    const statuses = query.statuses && query.statuses.length > 0 ? query.statuses : STATUSES;
    const { items, total } = await this.repo.listOperations({
      companyId: query.companyId,
      statuses,
      from,
      to,
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    });
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  getCompanyTotals(companyId: number): Promise<CompanyTotalsData> {
    return this.repo.getCompanyTotals(companyId);
  }
}
```

### src/operations/operations.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { zeroTotals } from '../common/types';
import type { CompanyTotalsData, OperationRowData, Status, TotalsDelta } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';

/** Either the pool client or a transaction client; both speak the same raw SQL. */
type Db = PrismaClient | Prisma.TransactionClient;

type RawOperationRow = {
  order_id: number;
  company_id: number;
  worker_id: number;
  worker_name: string | null;
  status: string;
  amount_cents: number;
  last_event_kind: string | null;
  created_at: Date;
  total: string;
};

function mapOperationRow(r: Record<string, unknown>): OperationRowData {
  return {
    orderId: Number(r.order_id),
    companyId: Number(r.company_id),
    workerId: Number(r.worker_id),
    workerName: (r.worker_name as string | null) ?? null,
    status: r.status as Status,
    amountCents: Number(r.amount_cents),
    lastEventKind: (r.last_event_kind as string | null) ?? null,
    createdAt: r.created_at as Date,
  };
}

function mapCompanyTotals(companyId: number, r?: Record<string, unknown>): CompanyTotalsData {
  if (!r) return zeroTotals(companyId);
  return {
    companyId,
    pendingCount: Number(r.pending_count),
    pendingAmountCents: Number(r.pending_amount),
    approvedCount: Number(r.approved_count),
    approvedAmountCents: Number(r.approved_amount),
    rejectedCount: Number(r.rejected_count),
    rejectedAmountCents: Number(r.rejected_amount),
    refundedCount: Number(r.refunded_count),
    refundedAmountCents: Number(r.refunded_amount),
    version: Number(r.version),
  };
}

@Injectable()
export class OperationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The dashboard query. Reads only the projection; the covering index
   * (company_id, status, created_at DESC, order_id DESC) INCLUDE (...) makes
   * this an index-only scan. count(*) OVER () returns the filtered total in
   * the same round-trip.
   */
  async listOperations(
    q: { companyId: number; statuses: readonly Status[]; from: Date; to: Date; limit: number; offset: number },
    db: Db = this.prisma,
  ): Promise<{ items: OperationRowData[]; total: number }> {
    // ASSUMPTION: "recency" means the order's creation time; created_at DESC
    // with order_id DESC as tie-break gives deterministic pages.
    const rows = await db.$queryRaw<RawOperationRow[]>(
      Prisma.sql`
        SELECT order_id, company_id, worker_id, worker_name, status, amount_cents,
               last_event_kind, created_at,
               count(*) OVER () AS total
        FROM operations_read_model
        WHERE company_id = ${q.companyId}
          AND status = ANY(${q.statuses})
          AND created_at >= ${q.from}
          AND created_at < ${q.to}
        ORDER BY created_at DESC, order_id DESC
        LIMIT ${q.limit} OFFSET ${q.offset}
      `,
    );
    return { items: rows.map(mapOperationRow), total: rows.length > 0 ? Number(rows[0].total) : 0 };
  }

  /** Exact per-company totals, straight from the maintained totals row. */
  async getCompanyTotals(companyId: number, db: Db = this.prisma): Promise<CompanyTotalsData> {
    const rows = await db.$queryRaw<Record<string, unknown>[]>(
      Prisma.sql`
        SELECT company_id, pending_count, pending_amount, approved_count, approved_amount,
               rejected_count, rejected_amount, refunded_count, refunded_amount, version
        FROM company_totals
        WHERE company_id = ${companyId}
      `,
    );
    return mapCompanyTotals(companyId, rows[0]);
  }

  /** Recompute one projection row from the source (order + worker + latest event). */
  async recomputeOperationRow(orderId: number, db: Db = this.prisma): Promise<OperationRowData | null> {
    const rows = await db.$queryRaw<Record<string, unknown>[]>(
      Prisma.sql`
        SELECT po.id AS order_id, po.company_id, po.worker_id, w.name AS worker_name,
               po.status, po.amount_cents, po.created_at,
               (SELECT oe.kind
                  FROM order_events oe
                 WHERE oe.order_id = po.id
                 ORDER BY oe.created_at DESC, oe.id DESC
                 LIMIT 1) AS last_event_kind
        FROM payment_orders po
        LEFT JOIN workers w ON w.id = po.worker_id
        WHERE po.id = ${orderId}
      `,
    );
    return rows.length > 0 ? mapOperationRow(rows[0]) : null;
  }

  /** Absolute-value upsert of one projection row; safe to run any number of times. */
  async upsertOperationRow(row: OperationRowData, db: Db = this.prisma): Promise<void> {
    await db.$executeRaw(
      Prisma.sql`
        INSERT INTO operations_read_model
          (order_id, company_id, worker_id, worker_name, status, amount_cents, last_event_kind, created_at, maintained_at)
        VALUES
          (${row.orderId}, ${row.companyId}, ${row.workerId}, ${row.workerName}, ${row.status},
           ${row.amountCents}, ${row.lastEventKind}, ${row.createdAt}, now())
        ON CONFLICT (order_id) DO UPDATE SET
          company_id = EXCLUDED.company_id,
          worker_id = EXCLUDED.worker_id,
          worker_name = EXCLUDED.worker_name,
          status = EXCLUDED.status,
          amount_cents = EXCLUDED.amount_cents,
          last_event_kind = EXCLUDED.last_event_kind,
          created_at = EXCLUDED.created_at,
          maintained_at = now()
      `,
    );
  }

  /**
   * Atomic in-place totals adjustment. The delta is added by the same
   * statement that creates the row, so two concurrent writers to the same
   * company row both apply — Postgres serializes them on the row lock and
   * neither increment is lost.
   */
  async applyTotalsDelta(companyId: number, d: TotalsDelta, db: Db = this.prisma): Promise<void> {
    await db.$executeRaw(
      Prisma.sql`
        INSERT INTO company_totals
          (company_id, pending_count, pending_amount, approved_count, approved_amount,
           rejected_count, rejected_amount, refunded_count, refunded_amount, version, updated_at)
        VALUES
          (${companyId}, ${d.pending.count}, ${d.pending.amountCents}, ${d.approved.count},
           ${d.approved.amountCents}, ${d.rejected.count}, ${d.rejected.amountCents},
           ${d.refunded.count}, ${d.refunded.amountCents}, 1, now())
        ON CONFLICT (company_id) DO UPDATE SET
          pending_count = company_totals.pending_count + EXCLUDED.pending_count,
          pending_amount = company_totals.pending_amount + EXCLUDED.pending_amount,
          approved_count = company_totals.approved_count + EXCLUDED.approved_count,
          approved_amount = company_totals.approved_amount + EXCLUDED.approved_amount,
          rejected_count = company_totals.rejected_count + EXCLUDED.rejected_count,
          rejected_amount = company_totals.rejected_amount + EXCLUDED.rejected_amount,
          refunded_count = company_totals.refunded_count + EXCLUDED.refunded_count,
          refunded_amount = company_totals.refunded_amount + EXCLUDED.refunded_amount,
          version = company_totals.version + 1,
          updated_at = now()
      `,
    );
  }

  /** Absolute-value recomputation of the totals rows for the given companies. */
  async recomputeCompanyTotals(companyIds: readonly number[], db: Db = this.prisma): Promise<void> {
    if (companyIds.length === 0) return;
    await db.$executeRaw(
      Prisma.sql`
        INSERT INTO company_totals AS ct
          (company_id, pending_count, pending_amount, approved_count, approved_amount,
           rejected_count, rejected_amount, refunded_count, refunded_amount, version, updated_at)
        SELECT po.company_id,
               count(*) FILTER (WHERE po.status = 'pending'),
               COALESCE(sum(po.amount_cents) FILTER (WHERE po.status = 'pending'), 0),
               count(*) FILTER (WHERE po.status = 'approved'),
               COALESCE(sum(po.amount_cents) FILTER (WHERE po.status = 'approved'), 0),
               count(*) FILTER (WHERE po.status = 'rejected'),
               COALESCE(sum(po.amount_cents) FILTER (WHERE po.status = 'rejected'), 0),
               count(*) FILTER (WHERE po.status = 'refunded'),
               COALESCE(sum(po.amount_cents) FILTER (WHERE po.status = 'refunded'), 0),
               1,
               now()
        FROM payment_orders po
        WHERE po.company_id = ANY(${companyIds})
        GROUP BY po.company_id
        ON CONFLICT (company_id) DO UPDATE SET
          pending_count = EXCLUDED.pending_count,
          pending_amount = EXCLUDED.pending_amount,
          approved_count = EXCLUDED.approved_count,
          approved_amount = EXCLUDED.approved_amount,
          rejected_count = EXCLUDED.rejected_count,
          rejected_amount = EXCLUDED.rejected_amount,
          refunded_count = EXCLUDED.refunded_count,
          refunded_amount = EXCLUDED.refunded_amount,
          version = ct.version + 1,
          updated_at = now()
      `,
    );
  }

  /** Source orders in the window, id-ordered for cursor batching. */
  async sourceOrdersInWindow(
    from: Date,
    to: Date,
    afterOrderId: number,
    limit: number,
    db: Db = this.prisma,
  ): Promise<Array<{ orderId: number; companyId: number }>> {
    const rows = await db.$queryRaw<Array<{ id: number; company_id: number }>>(
      Prisma.sql`
        SELECT id, company_id
        FROM payment_orders
        WHERE created_at >= ${from}
          AND created_at < ${to}
          AND id > ${afterOrderId}
        ORDER BY id
        LIMIT ${limit}
      `,
    );
    return rows.map((r) => ({ orderId: r.id, companyId: r.company_id }));
  }

  /**
   * One re-derivation batch: upsert the projection rows for a batch of orders
   * and recompute the affected companies' totals, in a short transaction.
   * Idempotent — running it any number of times converges to the source state.
   */
  async rederiveBatch(
    from: Date,
    to: Date,
    afterOrderId: number,
    limit: number,
  ): Promise<Array<{ orderId: number; companyId: number }>> {
    return this.prisma.$transaction(async (tx) => {
      const batch = await this.sourceOrdersInWindow(from, to, afterOrderId, limit, tx);
      for (const b of batch) {
        const row = await this.recomputeOperationRow(b.orderId, tx);
        if (row) await this.upsertOperationRow(row, tx);
      }
      await this.recomputeCompanyTotals([...new Set(batch.map((b) => b.companyId))], tx);
      return batch;
    });
  }

  /** Projection rows in the window that disagree with the source (including missing rows). */
  async countDriftedOrders(from: Date, to: Date, db: Db = this.prisma): Promise<number> {
    const rows = await db.$queryRaw<Array<{ drifted: string }>>(
      Prisma.sql`
        WITH expected AS (
          SELECT po.id AS order_id, po.status, po.amount_cents, po.created_at, po.worker_id,
                 w.name AS worker_name,
                 (SELECT oe.kind
                    FROM order_events oe
                   WHERE oe.order_id = po.id
                   ORDER BY oe.created_at DESC, oe.id DESC
                   LIMIT 1) AS last_event_kind
          FROM payment_orders po
          LEFT JOIN workers w ON w.id = po.worker_id
          WHERE po.created_at >= ${from}
            AND po.created_at < ${to}
        )
        SELECT count(*) AS drifted
        FROM expected e
        LEFT JOIN operations_read_model r ON r.order_id = e.order_id
        WHERE r.order_id IS NULL
           OR r.status IS DISTINCT FROM e.status
           OR r.amount_cents IS DISTINCT FROM e.amount_cents
           OR r.created_at IS DISTINCT FROM e.created_at
           OR r.worker_id IS DISTINCT FROM e.worker_id
           OR r.worker_name IS DISTINCT FROM e.worker_name
           OR r.last_event_kind IS DISTINCT FROM e.last_event_kind
      `,
    );
    return Number(rows[0]?.drifted ?? 0);
  }

  /** Companies (with orders in the window) whose totals row disagrees with the source. */
  async countDriftedCompanies(from: Date, to: Date, db: Db = this.prisma): Promise<number> {
    const rows = await db.$queryRaw<Array<{ drifted: string }>>(
      Prisma.sql`
        WITH windowed AS (
          SELECT DISTINCT company_id
          FROM payment_orders
          WHERE created_at >= ${from}
            AND created_at < ${to}
        ),
        actual AS (
          SELECT po.company_id,
                 count(*) FILTER (WHERE po.status = 'pending') AS pending_count,
                 COALESCE(sum(po.amount_cents) FILTER (WHERE po.status = 'pending'), 0) AS pending_amount,
                 count(*) FILTER (WHERE po.status = 'approved') AS approved_count,
                 COALESCE(sum(po.amount_cents) FILTER (WHERE po.status = 'approved'), 0) AS approved_amount,
                 count(*) FILTER (WHERE po.status = 'rejected') AS rejected_count,
                 COALESCE(sum(po.amount_cents) FILTER (WHERE po.status = 'rejected'), 0) AS rejected_amount,
                 count(*) FILTER (WHERE po.status = 'refunded') AS refunded_count,
                 COALESCE(sum(po.amount_cents) FILTER (WHERE po.status = 'refunded'), 0) AS refunded_amount
          FROM payment_orders po
          JOIN windowed w ON w.company_id = po.company_id
          GROUP BY po.company_id
        )
        SELECT count(*) AS drifted
        FROM actual a
        LEFT JOIN company_totals t ON t.company_id = a.company_id
        WHERE t.company_id IS NULL
           OR t.pending_count IS DISTINCT FROM a.pending_count
           OR t.pending_amount IS DISTINCT FROM a.pending_amount
           OR t.approved_count IS DISTINCT FROM a.approved_count
           OR t.approved_amount IS DISTINCT FROM a.approved_amount
           OR t.rejected_count IS DISTINCT FROM a.rejected_count
           OR t.rejected_amount IS DISTINCT FROM a.rejected_amount
           OR t.refunded_count IS DISTINCT FROM a.refunded_count
           OR t.refunded_amount IS DISTINCT FROM a.refunded_amount
      `,
    );
    return Number(rows[0]?.drifted ?? 0);
  }
}
```

### src/operations/projection-maintenance.service.ts
```ts
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ApiError } from '../common/api-error';
import { emptyTotalsDelta } from '../common/types';
import type { Status } from '../common/types';
import { OperationsRepository } from './operations.repository';

/**
 * Synchronous projection maintenance hooks. The write services call these
 * with the transaction client of the write's own transaction, so the
 * projection update commits or rolls back atomically with the source write.
 */
@Injectable()
export class ProjectionMaintenanceService {
  constructor(private readonly repo: OperationsRepository) {}

  onOrderCreated(tx: Prisma.TransactionClient, orderId: number): Promise<void> {
    return this.apply(tx, orderId, { created: true, from: 'pending', to: 'pending' });
  }

  onOrderStatusChanged(tx: Prisma.TransactionClient, orderId: number, from: Status, to: Status): Promise<void> {
    return this.apply(tx, orderId, { created: false, from, to });
  }

  private async apply(
    tx: Prisma.TransactionClient,
    orderId: number,
    change: { created: boolean; from: Status; to: Status },
  ): Promise<void> {
    const row = await this.repo.recomputeOperationRow(orderId, tx);
    if (!row) {
      throw new ApiError(
        409,
        'conflict',
        `Payment order ${orderId} disappeared while its projection was being maintained`,
        { orderId },
      );
    }
    // The row is written as an absolute snapshot of the source: idempotent,
    // so the hook, re-derivation and drift repair all converge on the same state.
    await this.repo.upsertOperationRow(row, tx);
    // The totals delta is derived from the transition itself, never from a
    // read of the current totals, so there is no read-modify-write race.
    const delta = emptyTotalsDelta();
    if (change.created) {
      delta[change.to] = { count: 1, amountCents: row.amountCents };
    } else {
      delta[change.from] = { count: -1, amountCents: -row.amountCents };
      delta[change.to] = { count: 1, amountCents: row.amountCents };
    }
    await this.repo.applyTotalsDelta(row.companyId, delta, tx);
  }
}
```

### src/operations/reprojection.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error';
import { OperationsRepository } from './operations.repository';

const BATCH_SIZE = 500;

/**
 * Re-derivation for an arbitrary date window [from, to). Rebuilds the
 * projection rows and the affected companies' totals from the source tables.
 * Safe to run while the system is live (short per-batch transactions, no
 * shared locks) and idempotent (absolute-value writes): running it twice over
 * the same window leaves the same result.
 */
@Injectable()
export class ReprojectionService {
  constructor(private readonly repo: OperationsRepository) {}

  async rederive(from: Date, to: Date): Promise<{ orders: number; companies: number }> {
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from.getTime() >= to.getTime()) {
      throw new ApiError(400, 'validation_failed', 're-derivation window: from must be a date earlier than to', {
        from: from.toISOString(),
        to: to.toISOString(),
      });
    }
    let cursor = 0;
    let orders = 0;
    const companies = new Set<number>();
    for (;;) {
      const batch = await this.repo.rederiveBatch(from, to, cursor, BATCH_SIZE);
      if (batch.length === 0) break;
      orders += batch.length;
      for (const b of batch) companies.add(b.companyId);
      cursor = batch[batch.length - 1].orderId;
      if (batch.length < BATCH_SIZE) break;
    }
    return { orders, companies: companies.size };
  }
}
```

### src/payment-orders/payment-orders.module.ts
```ts
import { Module } from '@nestjs/common';
import { OperationsModule } from '../operations/operations.module';
import { PaymentOrdersController } from './payment-orders.controller';
import { PaymentOrdersService } from './payment-orders.service';
import { PaymentOrdersRepository } from './payment-orders.repository';

@Module({
  imports: [OperationsModule],
  controllers: [PaymentOrdersController],
  providers: [PaymentOrdersService, PaymentOrdersRepository],
})
export class PaymentOrdersModule {}
```

### src/payment-orders/payment-orders.controller.ts
```ts
import { Body, Controller, Param, Post } from '@nestjs/common';
import { parseRequiredPositiveInt } from '../common/validation';
import { PaymentOrdersService } from './payment-orders.service';

/**
 * Simulated write path: these endpoints stand in for the real order service
 * and are what invoke the projection maintenance hooks.
 */
@Controller('payment-orders')
export class PaymentOrdersController {
  constructor(private readonly orders: PaymentOrdersService) {}

  @Post()
  create(@Body() body: { companyId?: unknown; workerId?: unknown; amountCents?: unknown }) {
    const payload = body ?? {};
    return this.orders.create({
      companyId: parseRequiredPositiveInt(payload.companyId, 'companyId'),
      workerId: parseRequiredPositiveInt(payload.workerId, 'workerId'),
      amountCents: parseRequiredPositiveInt(payload.amountCents, 'amountCents'),
    });
  }

  @Post(':id/approve')
  approve(@Param('id') id: string) {
    return this.orders.approve(parseRequiredPositiveInt(id, 'id'));
  }

  @Post(':id/reject')
  reject(@Param('id') id: string) {
    return this.orders.reject(parseRequiredPositiveInt(id, 'id'));
  }

  @Post(':id/refund')
  refund(@Param('id') id: string) {
    return this.orders.refund(parseRequiredPositiveInt(id, 'id'));
  }
}
```

### src/payment-orders/payment-orders.service.ts
```ts
import { Injectable } from '@nestjs/common';
import type { PaymentOrder } from '@prisma/client';
import { ApiError } from '../common/api-error';
import { ProjectionMaintenanceService } from '../operations/projection-maintenance.service';
import { PaymentOrdersRepository } from './payment-orders.repository';

// ASSUMPTION: the simulated write path is create plus these transitions;
// refund is only valid from approved.
const TRANSITIONS = {
  approve: { from: 'pending', to: 'approved', event: 'approved' },
  reject: { from: 'pending', to: 'rejected', event: 'rejected' },
  refund: { from: 'approved', to: 'refunded', event: 'refunded' },
} as const;

export type OrderAction = keyof typeof TRANSITIONS;

export interface CreatePaymentOrderInput {
  companyId: number;
  workerId: number;
  amountCents: number;
}

@Injectable()
export class PaymentOrdersService {
  constructor(
    private readonly repo: PaymentOrdersRepository,
    private readonly projections: ProjectionMaintenanceService,
  ) {}

  create(input: CreatePaymentOrderInput): Promise<PaymentOrder> {
    return this.repo.runInTransaction(async (tx) => {
      const worker = await this.repo.workerInTransaction(tx, input.workerId);
      if (!worker) {
        throw new ApiError(400, 'validation_failed', `Worker ${input.workerId} does not exist`, {
          workerId: input.workerId,
        });
      }
      const order = await this.repo.insertOrder(tx, input);
      await this.repo.insertEvent(tx, order.id, 'created');
      // Synchronous projection maintenance hook: runs inside this very
      // transaction, so the read model is updated at the same instant as the
      // source row, and a rolled-back create leaves no projection trace.
      await this.projections.onOrderCreated(tx, order.id);
      return order;
    });
  }

  approve(orderId: number): Promise<number> {
    return this.transition('approve', orderId);
  }

  reject(orderId: number): Promise<number> {
    return this.transition('reject', orderId);
  }

  refund(orderId: number): Promise<number> {
    return this.transition('refund', orderId);
  }

  private transition(action: OrderAction, orderId: number): Promise<number> {
    const t = TRANSITIONS[action];
    return this.repo.findById(orderId).then(async (order) => {
      if (!order) {
        throw new ApiError(404, 'resource_not_found', `Payment order ${orderId} does not exist`, { orderId });
      }
      if (order.status !== t.from) {
        throw new ApiError(
          409,
          'invalid_state_transition',
          `Payment order ${orderId} is ${order.status}; ${action} requires status ${t.from}`,
          { orderId, current: order.status, required: t.from },
        );
      }
      // transitionInTransaction re-checks the status under the row lock, so a
      // concurrent transition on the same order wins or loses atomically.
      return this.repo.transitionInTransaction(orderId, t.from, t.to, async (tx) => {
        await this.repo.insertEvent(tx, orderId, t.event);
        // Synchronous projection maintenance hook, in the same transaction as
        // the source write: order row, event, projection row and totals all
        // commit together.
        await this.projections.onOrderStatusChanged(tx, orderId, t.from, t.to);
      });
    });
  }
}
```

### src/payment-orders/payment-orders.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import type { PaymentOrder, Prisma, Worker } from '@prisma/client';
import { ApiError } from '../common/api-error';
import type { Status } from '../common/types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PaymentOrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(orderId: number): Promise<PaymentOrder | null> {
    return this.prisma.paymentOrder.findUnique({ where: { id: orderId } });
  }

  workerInTransaction(tx: Prisma.TransactionClient, workerId: number): Promise<Worker | null> {
    return tx.worker.findUnique({ where: { id: workerId } });
  }

  insertOrder(
    tx: Prisma.TransactionClient,
    data: { companyId: number; workerId: number; amountCents: number },
  ): Promise<PaymentOrder> {
    return tx.paymentOrder.create({ data });
  }

  insertEvent(tx: Prisma.TransactionClient, orderId: number, kind: string): Promise<void> {
    return tx.orderEvent.create({ data: { orderId, kind } }).then(() => undefined);
  }

  /** Runs the write and its synchronous projection maintenance in one transaction. */
  runInTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work);
  }

  /**
   * Atomic status transition: the UPDATE matches only while the order is
   * still `from`. Two racing transitions on the same order serialize on the
   * row lock; the loser matches zero rows and gets a typed error. `work`
   * (the projection maintenance hook) runs in the same transaction, so it
   * commits or rolls back with the write.
   */
  transitionInTransaction(
    orderId: number,
    from: Status,
    to: Status,
    work: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.paymentOrder.updateMany({
        where: { id: orderId, status: from },
        data: { status: to },
      });
      if (result.count === 0) {
        const current = await tx.paymentOrder.findUnique({ where: { id: orderId }, select: { id: true, status: true } });
        if (!current) {
          throw new ApiError(404, 'resource_not_found', `Payment order ${orderId} does not exist`, { orderId });
        }
        throw new ApiError(
          409,
          'invalid_state_transition',
          `Payment order ${orderId} cannot move ${from} -> ${to}; current status is ${current.status}`,
          { orderId, from, to, current: current.status },
        );
      }
      await work(tx);
      return orderId;
    });
  }
}
```

### src/drift-repair/drift-repair.module.ts
```ts
import { Module } from '@nestjs/common';
import { OperationsModule } from '../operations/operations.module';
import { DriftRepairJob } from './drift-repair.job';

@Module({
  imports: [OperationsModule],
  providers: [DriftRepairJob],
})
export class DriftRepairModule {}
```

### src/drift-repair/drift-repair.job.ts
```ts
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OperationsRepository } from '../operations/operations.repository';
import { ReprojectionService } from '../operations/reprojection.service';

export interface DriftRepairReport {
  windowFrom: Date;
  windowTo: Date;
  driftedOrders: number;
  driftedCompanies: number;
  repaired: { orders: number; companies: number } | null;
}

/**
 * Scheduled drift-repair job. Every `DRIFT_REPAIR_CRON` (default: every 5
 * minutes) it compares the projection against the source for the last
 * `DRIFT_REPAIR_WINDOW_DAYS` days (default 1) and re-derives the window when
 * anything disagrees. Drift is expected (a deploy mid-transaction, a manual
 * source fix); this job is what notices before a person does.
 */
@Injectable()
export class DriftRepairJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(DriftRepairJob.name);
  private enabled = true;
  private running = false;

  constructor(
    private readonly repo: OperationsRepository,
    private readonly reproject: ReprojectionService,
  ) {}

  onApplicationBootstrap(): void {
    this.enabled = (process.env.DRIFT_REPAIR_ENABLED ?? 'true') !== 'false';
  }

  @Cron(process.env.DRIFT_REPAIR_CRON ?? '*/5 * * * *')
  async runScheduled(): Promise<void> {
    if (!this.enabled || this.running) return;
    this.running = true;
    try {
      await this.run();
    } catch (err) {
      this.logger.error(`drift-repair run failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
    }
  }

  /** One compare-and-repair pass; also invoked directly from the tests. */
  async run(windowDays: number = Number(process.env.DRIFT_REPAIR_WINDOW_DAYS ?? '1')): Promise<DriftRepairReport> {
    const windowTo = new Date();
    const windowFrom = new Date(windowTo.getTime() - windowDays * 86_400_000);

    const [driftedOrders, driftedCompanies] = await Promise.all([
      this.repo.countDriftedOrders(windowFrom, windowTo),
      this.repo.countDriftedCompanies(windowFrom, windowTo),
    ]);

    let repaired: DriftRepairReport['repaired'] = null;
    if (driftedOrders > 0 || driftedCompanies > 0) {
      repaired = await this.reproject.rederive(windowFrom, windowTo);
    }

    const report: DriftRepairReport = { windowFrom, windowTo, driftedOrders, driftedCompanies, repaired };
    this.logger.log(
      `drift-repair window=[${windowFrom.toISOString()} .. ${windowTo.toISOString()}] ` +
        `driftedOrders=${driftedOrders} driftedCompanies=${driftedCompanies} repaired=${repaired ? 'yes' : 'no'}`,
    );
    return report;
  }
}
```

### test/helpers.ts
```ts
// Test bootstrap. Requires DATABASE_URL pointing at a throwaway Postgres
// database; the checked-in migration DDL is applied idempotently.
import 'reflect-metadata';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { ErrorEnvelopeFilter } from '../src/common/error-envelope.filter';
import { PrismaService } from '../src/prisma/prisma.service';

// The scheduled drift-repair job must not fire mid-suite. DriftRepairJob
// reads this in onApplicationBootstrap, which runs in the specs' beforeAll,
// so setting it at module load is safe.
process.env.DRIFT_REPAIR_ENABLED = 'false';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalFilters(new ErrorEnvelopeFilter());
  await app.init();
  return app;
}

export function prismaOf(app: INestApplication): PrismaService {
  return app.get(PrismaService);
}

/** Apply the checked-in migration DDL (fully idempotent) so specs can run against a fresh database. */
export async function ensureSchema(prisma: PrismaService): Promise<void> {
  const migrationsDir = resolve(process.cwd(), 'prisma', 'migrations');
  const entries = (await readdir(migrationsDir)).filter((e) => e !== 'migration_lock.toml').sort();
  for (const entry of entries) {
    const sql = await readFile(join(migrationsDir, entry, 'migration.sql'), 'utf8');
    for (const statement of sql.split(/;\r?\n/)) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) await prisma.$executeRawUnsafe(trimmed);
    }
  }
}

export async function resetTables(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE order_events, operations_read_model, company_totals, payment_orders, workers RESTART IDENTITY CASCADE',
  );
}
```

### test/payment-orders.spec.ts
```ts
// Requires DATABASE_URL pointing at a throwaway Postgres database.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { PaymentOrdersRepository } from '../src/payment-orders/payment-orders.repository';
import { PaymentOrdersService } from '../src/payment-orders/payment-orders.service';
import { OperationsService } from '../src/operations/operations.service';
import { createTestApp, ensureSchema, prismaOf, resetTables } from './helpers';

describe('payment order write path (simulated)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orders: PaymentOrdersService;
  let ops: OperationsService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = prismaOf(app);
    await ensureSchema(prisma);
    orders = app.get(PaymentOrdersService);
    ops = app.get(OperationsService);
  });

  beforeEach(async () => {
    await resetTables(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  it('a create and an approve are visible to the dashboard immediately (read your own writes)', async () => {
    const worker = await prisma.worker.create({ data: { companyId: 1, name: 'Ana' } });
    const created = await orders.create({ companyId: 1, workerId: worker.id, amountCents: 12000 });

    const asPending = await ops.listOperations({ companyId: 1, page: 1, pageSize: 10 });
    expect(asPending.items).toHaveLength(1);
    expect(asPending.items[0].status).toBe('pending');
    expect(asPending.items[0].lastEventKind).toBe('created');
    let totals = await ops.getCompanyTotals(1);
    expect(totals.pendingCount).toBe(1);
    expect(totals.pendingAmountCents).toBe(12000);

    await orders.approve(created.id);

    const asApproved = await ops.listOperations({ companyId: 1, page: 1, pageSize: 10 });
    const item = asApproved.items.find((i) => i.orderId === created.id);
    expect(item).toBeDefined();
    expect(item!.status).toBe('approved');
    expect(item!.lastEventKind).toBe('approved');
    expect(item!.workerName).toBe('Ana');
    expect(item!.amountCents).toBe(12000);
    totals = await ops.getCompanyTotals(1);
    expect(totals.pendingCount).toBe(0);
    expect(totals.pendingAmountCents).toBe(0);
    expect(totals.approvedCount).toBe(1);
    expect(totals.approvedAmountCents).toBe(12000);
  });

  it('enforces the status machine and answers with the error envelope', async () => {
    const worker = await prisma.worker.create({ data: { companyId: 1, name: 'Ana' } });
    const order = await orders.create({ companyId: 1, workerId: worker.id, amountCents: 500 });
    await orders.approve(order.id);

    await expect(orders.approve(order.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'invalid_state_transition',
    });
    await expect(orders.reject(order.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'invalid_state_transition',
    });
    await expect(orders.refund(order.id)).resolves.toBe(order.id);
    await expect(orders.refund(order.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'invalid_state_transition',
    });
    await expect(orders.approve(999999)).rejects.toMatchObject({
      statusCode: 404,
      code: 'resource_not_found',
    });
    await expect(orders.create({ companyId: 1, workerId: 9999, amountCents: 1 })).rejects.toMatchObject({
      statusCode: 400,
      code: 'validation_failed',
    });
  });

  it('a rolled-back write leaves no trace in the projection or the totals', async () => {
    const worker = await prisma.worker.create({ data: { companyId: 2, name: 'Bo' } });
    const order = await orders.create({ companyId: 2, workerId: worker.id, amountCents: 777 });
    const repo = app.get(PaymentOrdersRepository);

    await expect(
      repo.transitionInTransaction(order.id, 'pending', 'approved', async (tx) => {
        await tx.$executeRawUnsafe(
          'UPDATE company_totals SET approved_amount = approved_amount + 1 WHERE company_id = 2',
        );
        throw new Error('simulate a failure after the source update');
      }),
    ).rejects.toThrow('simulate a failure after the source update');

    const fresh = await prisma.paymentOrder.findUnique({ where: { id: order.id } });
    expect(fresh?.status).toBe('pending');
    const totals = await ops.getCompanyTotals(2);
    expect(totals.pendingCount).toBe(1);
    expect(totals.pendingAmountCents).toBe(777);
    expect(totals.approvedCount).toBe(0);
    expect(totals.approvedAmountCents).toBe(0);
  });

  it('keeps one company totals exact when approvals run concurrently', async () => {
    const worker = await prisma.worker.create({ data: { companyId: 7, name: 'Cy' } });
    const amounts = [1000, 2500, 4000, 555];
    const created = [];
    for (const amountCents of amounts) {
      created.push(await orders.create({ companyId: 7, workerId: worker.id, amountCents }));
    }
    const totalsBefore = await ops.getCompanyTotals(7);
    expect(totalsBefore.pendingCount).toBe(4);
    expect(totalsBefore.pendingAmountCents).toBe(amounts.reduce((a, b) => a + b, 0));

    await Promise.all(created.map((o) => orders.approve(o.id)));

    const totals = await ops.getCompanyTotals(7);
    expect(totals.pendingCount).toBe(0);
    expect(totals.pendingAmountCents).toBe(0);
    expect(totals.approvedCount).toBe(4);
    expect(totals.approvedAmountCents).toBe(amounts.reduce((a, b) => a + b, 0));

    const page = await ops.listOperations({ companyId: 7, statuses: ['approved'], page: 1, pageSize: 10 });
    expect(page.total).toBe(4);
    expect(page.items.map((i) => i.amountCents).sort((a, b) => b - a)).toEqual([4000, 2500, 1000, 555]);
  });
});
```

### test/operations.spec.ts
```ts
// Requires DATABASE_URL pointing at a throwaway Postgres database.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { DriftRepairJob } from '../src/drift-repair/drift-repair.job';
import { PrismaService } from '../src/prisma/prisma.service';
import { PaymentOrdersService } from '../src/payment-orders/payment-orders.service';
import { OperationsService } from '../src/operations/operations.service';
import { ReprojectionService } from '../src/operations/reprojection.service';
import { createTestApp, ensureSchema, prismaOf, resetTables } from './helpers';

describe('operations read model', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orders: PaymentOrdersService;
  let ops: OperationsService;
  let reproject: ReprojectionService;
  let drift: DriftRepairJob;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = prismaOf(app);
    await ensureSchema(prisma);
    orders = app.get(PaymentOrdersService);
    ops = app.get(OperationsService);
    reproject = app.get(ReprojectionService);
    drift = app.get(DriftRepairJob);
  });

  beforeEach(async () => {
    await resetTables(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  async function seedWorker(companyId: number, name: string) {
    return prisma.worker.create({ data: { companyId, name } });
  }

  const windowTo = () => new Date(Date.now() + 60_000);

  it('filters by company, status and date range, sorts by recency and paginates', async () => {
    const w10 = await seedWorker(10, 'A');
    const w11 = await seedWorker(11, 'B');
    const a = await orders.create({ companyId: 10, workerId: w10.id, amountCents: 100 });
    const b = await orders.create({ companyId: 10, workerId: w10.id, amountCents: 200 });
    const c = await orders.create({ companyId: 10, workerId: w10.id, amountCents: 300 });
    const d = await orders.create({ companyId: 11, workerId: w11.id, amountCents: 500 });
    await Promise.all([orders.approve(a.id), orders.approve(b.id), orders.approve(d.id), orders.reject(c.id)]);

    // Backdate one order in the source, then re-derive so the projection carries it.
    await prisma.$executeRawUnsafe(
      `UPDATE payment_orders SET created_at = now() - interval '2 hours' WHERE id = ${a.id}`,
    );
    await reproject.rederive(new Date(0), windowTo());

    const all = await ops.listOperations({ companyId: 10, page: 1, pageSize: 10 });
    expect(all.total).toBe(3);
    expect(all.items.map((i) => i.orderId)).toEqual([c.id, b.id, a.id]);

    const approvedOnly = await ops.listOperations({ companyId: 10, statuses: ['approved'], page: 1, pageSize: 10 });
    expect(approvedOnly.items.map((i) => i.orderId)).toEqual([b.id, a.id]);

    const oneHourAgo = new Date(Date.now() - 3_600_000);
    const recent = await ops.listOperations({ companyId: 10, from: oneHourAgo, page: 1, pageSize: 10 });
    expect(recent.items.map((i) => i.orderId)).toEqual([c.id, b.id]);

    const oldOnly = await ops.listOperations({ companyId: 10, to: oneHourAgo, page: 1, pageSize: 10 });
    expect(oldOnly.items.map((i) => i.orderId)).toEqual([a.id]);

    const page1 = await ops.listOperations({ companyId: 10, page: 1, pageSize: 2 });
    expect(page1.items.map((i) => i.orderId)).toEqual([c.id, b.id]);
    expect(page1.total).toBe(3);
    const page2 = await ops.listOperations({ companyId: 10, page: 2, pageSize: 2 });
    expect(page2.items.map((i) => i.orderId)).toEqual([a.id]);

    const otherCompany = await ops.listOperations({ companyId: 11, page: 1, pageSize: 10 });
    expect(otherCompany.items.map((i) => i.orderId)).toEqual([d.id]);
  });

  it('the dashboard reads only the projection: a source-only change is invisible until re-derivation', async () => {
    const worker = await seedWorker(20, 'Old Name');
    const order = await orders.create({ companyId: 20, workerId: worker.id, amountCents: 10 });
    await orders.approve(order.id);

    // No worker write path exists: this source change happens outside the hooks.
    await prisma.$executeRawUnsafe(`UPDATE workers SET name = 'New Name' WHERE id = ${worker.id}`);

    let page = await ops.listOperations({ companyId: 20, page: 1, pageSize: 10 });
    expect(page.items[0].workerName).toBe('Old Name'); // hot path does not join workers

    await reproject.rederive(new Date(0), windowTo());
    page = await ops.listOperations({ companyId: 20, page: 1, pageSize: 10 });
    expect(page.items[0].workerName).toBe('New Name');
  });

  it('re-derivation rebuilds a damaged window from the source and is idempotent', async () => {
    const worker = await seedWorker(30, 'D');
    const o1 = await orders.create({ companyId: 30, workerId: worker.id, amountCents: 111 });
    const o2 = await orders.create({ companyId: 30, workerId: worker.id, amountCents: 222 });
    await Promise.all([orders.approve(o1.id), orders.approve(o2.id)]);

    await prisma.$executeRawUnsafe(
      `UPDATE operations_read_model SET status = 'pending', amount_cents = 1, last_event_kind = 'created' WHERE company_id = 30`,
    );
    await prisma.$executeRawUnsafe(`UPDATE company_totals SET approved_amount = 1 WHERE company_id = 30`);

    const first = await reproject.rederive(new Date(0), windowTo());
    expect(first.orders).toBe(2);

    const snapshot = async () => ({
      rows: await prisma.$queryRawUnsafe(
        `SELECT order_id, company_id, worker_id, worker_name, status, amount_cents, last_event_kind, created_at
         FROM operations_read_model WHERE company_id = 30 ORDER BY order_id`,
      ),
      totals: await prisma.$queryRawUnsafe(
        `SELECT company_id, pending_count, pending_amount, approved_count, approved_amount,
                rejected_count, rejected_amount, refunded_count, refunded_amount
         FROM company_totals WHERE company_id = 30`,
      ),
    });

    const afterFirst = await snapshot();
    expect(afterFirst.rows).toHaveLength(2);
    for (const row of afterFirst.rows as Array<{ status: string }>) {
      expect(row.status).toBe('approved');
    }
    const totalsRow = (afterFirst.totals as Array<Record<string, unknown>>)[0];
    expect(Number(totalsRow.approved_count)).toBe(2);
    expect(Number(totalsRow.approved_amount)).toBe(333);
    expect(Number(totalsRow.pending_count)).toBe(0);

    await reproject.rederive(new Date(0), windowTo());
    const afterSecond = await snapshot();
    expect(afterSecond).toEqual(afterFirst);
  });

  it('the drift-repair job detects injected drift and repairs it', async () => {
    const worker = await seedWorker(40, 'E');
    const o1 = await orders.create({ companyId: 40, workerId: worker.id, amountCents: 1000 });
    const o2 = await orders.create({ companyId: 40, workerId: worker.id, amountCents: 2000 });
    await Promise.all([orders.approve(o1.id), orders.approve(o2.id)]);

    // Inject drift: one row wrong, one row missing, totals off.
    await prisma.$executeRawUnsafe(
      `UPDATE operations_read_model SET last_event_kind = 'created' WHERE order_id = ${o1.id}`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM operations_read_model WHERE order_id = ${o2.id}`);
    await prisma.$executeRawUnsafe(
      `UPDATE company_totals SET approved_amount = approved_amount + 999, approved_count = approved_count + 1 WHERE company_id = 40`,
    );

    const report = await drift.run();
    expect(report.driftedOrders).toBe(2);
    expect(report.driftedCompanies).toBe(1);
    expect(report.repaired).not.toBeNull();

    const page = await ops.listOperations({ companyId: 40, page: 1, pageSize: 10 });
    expect(page.items).toHaveLength(2);
    for (const item of page.items) {
      expect(item.status).toBe('approved');
      expect(item.lastEventKind).toBe('approved');
    }
    const totals = await ops.getCompanyTotals(40);
    expect(totals.approvedCount).toBe(2);
    expect(totals.approvedAmountCents).toBe(3000);

    const clean = await drift.run();
    expect(clean.driftedOrders).toBe(0);
    expect(clean.driftedCompanies).toBe(0);
    expect(clean.repaired).toBeNull();
  });
});
```

### DESIGN.md
```md
# DESIGN.md — Operations dashboard read model

## Constraint set

- p95 < 50 ms for the operations list (company + status + date-range filters,
  recency sort, pagination) at ~3M orders, with no change to what operators
  see.
- Read-your-own-writes: an operator's approval must be visible on the next
  request. Any refresh interval, however short, is a visibility window, so
  schedule-based refresh is disqualified by construction.
- Exact per-company financial totals: finance reconciles against them. Not
  eventually exact, not approximate.

## Design

Two projection tables maintained by the write path:

- `operations_read_model` — one row per payment order, shaped exactly like the
  dashboard query (company, worker id + name snapshot, status, amount, latest
  event kind, created_at). The list query is a single index-only scan over
  this table; no join.
- `company_totals` — one row per company with per-status counts and amounts.

### 1. Synchronous maintenance hooks

`PaymentOrdersService` is the only writer to the source tables. Every write
(create, approve, reject, refund) runs inside one Prisma transaction and
calls the projection maintenance hook (`ProjectionMaintenanceService`) with
the transaction client, so the hook executes **inside the transaction that
writes the source row**:

- the write commits → projection row and totals row committed at the same
  instant → the next request sees them. There is no window.
- the write rolls back → the hook's updates roll back with it → the
  projection never saw it.

Per order, the hook does an absolute-value upsert of the projection row
(recomputed from order + worker + latest event) and an in-place totals
increment derived from the transition (from → to).

### 2. Exact totals under concurrency

The totals row is never read-modify-written. The increment is an
`INSERT ... ON CONFLICT DO UPDATE SET x = x + delta` statement: Postgres
applies concurrent increments on the same row atomically under the row lock,
so two approvals for the same company both apply and neither is lost. The
test runs the two concurrently, not in sequence.

Transitions on the same order are made atomic with a guarded
`UPDATE ... WHERE id = ? AND status = ?`: racing actions serialize on the
row lock and the loser gets `invalid_state_transition`.

### 3. Re-derivation for an arbitrary window

`ReprojectionService.rederive(from, to)` rebuilds the projection for a window
from the source: id-ordered batches of 500 orders, each batch in a short
transaction that upserts the projection rows and recomputes the affected
companies' totals from scratch (absolute values). Safe to run while the
system is live (no long locks) and idempotent — running it twice over the
same window leaves the same result. This is what makes the projection
recoverable rather than precious.

### 4. Scheduled drift-repair job

`DriftRepairJob` (cron `DRIFT_REPAIR_CRON`, default every 5 min) counts, for
the last `DRIFT_REPAIR_WINDOW_DAYS` (default 1), the projection rows that
disagree with the source (including missing ones) and the companies whose
totals disagree. Anything non-zero → re-derive the window. Drift is expected:
a deploy mid-transaction, a manual source fix, a hook added after a data
migration. The job is what notices before a person does.

### 5. The dashboard query

`GET /operations` reads only `operations_read_model`, served by the covering
index `(company_id, status, created_at DESC, order_id DESC)
INCLUDE (worker_id, worker_name, amount_cents, last_event_kind)`: filter on
the key prefix, sort in index order, every selected column in the index →
index-only scan with a bounded LIMIT. `count(*) OVER ()` returns the filtered
total in the same round-trip. `GET /company-totals/:companyId` reads
`company_totals`.

## Alternatives considered and rejected

- **Materialized view + scheduled refresh** — any refresh interval > 0 is a
  read-your-own-writes violation by construction; REFRESH is a full rebuild
  (cost unbounded at 3M rows) and blocks readers.
- **Outbox + async projection worker (CDC/queue)** — eventual: the operator's
  own write is invisible until the worker catches up, exactly the window the
  requirement forbids. Also needs at-least-once delivery, ordering and replay
  handling to keep totals exact, plus extra infrastructure.
- **Database trigger** — same in-transaction correctness, but the maintenance
  logic moves out of the TypeScript write path: invisible in code review,
  untestable with the app's test suite, not managed by Prisma's schema
  tooling. The service-level hook is the same semantics, in the layer where
  the write logic already lives.
- **Faster join (better indexes on the source)** — a multi-table join +
  aggregation over 3M rows cannot hit 50 ms p95 under refresh load, and the
  per-company totals would require aggregating the whole company on every
  request.
- **Application-level lock/queue around the totals** — a process-local mutex
  does not span instances and dies with the process. The database row lock is
  the right serialization point, and the in-place increment gets it for free.

The synchronous hook is the only option that keeps the projection visible at
the same instant as the source write *and* keeps totals exact without extra
infrastructure. Its cost is one upsert + one totals increment per order
mutation — both row-level, on hot pages.

## Failure modes and recovery

- Rolled-back write → the hook rolls back with it (tested).
- Deploy mid-transaction / manual source fix → drift → the repair job catches
  it within one cron interval for the recent window; older data is repaired
  with an explicit `rederive(from, to)` (safe to run "just in case":
  idempotent).
- Catastrophe → drop both projection tables and run `rederive(min created_at,
  now())`.
- Worker rename → the projection holds a name snapshot (this codebase has no
  worker write path); renames propagate through re-derivation / drift repair.

## Configuration (environment only)

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | — (required) | Postgres connection |
| `PORT` | `3000` | API port |
| `DRIFT_REPAIR_CRON` | `*/5 * * * *` | Drift-repair schedule |
| `DRIFT_REPAIR_WINDOW_DAYS` | `1` | Window the job compares |
| `DRIFT_REPAIR_ENABLED` | `true` | `false` disables the schedule (tests) |

## Endpoints

- `GET /operations?companyId=&status=&from=&to=&page=&pageSize=` — the list
  (companyId required; status repeatable; ISO dates; pageSize ≤ 100)
- `GET /company-totals/:companyId` — exact totals
- `POST /payment-orders` `{ companyId, workerId, amountCents }` — the
  simulated write path
- `POST /payment-orders/:id/approve` · `/reject` · `/refund`

Errors use the single envelope `{ "error": { "code", "message", "details" } }`.
```
