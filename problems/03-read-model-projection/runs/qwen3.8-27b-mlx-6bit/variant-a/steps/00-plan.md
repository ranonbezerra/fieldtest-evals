# plan

## reply

Let me carefully build out PLAN.md for Variant A of the read-model-projection problem.

Key requirements:
- TypeScript + NestJS + Prisma + Postgres
- Projection table(s) + DDL with indexes
- Maintenance hooks called from the write service (simulating the write path)
- Re-derivation routine over an arbitrary date window
- Scheduled drift repair job
- New dashboard query
- Tests: read-your-own-writes, concurrent updates to a single company's total, drift repair
- Short DESIGN.md justifying sync hooks over alternatives

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

Layers: controller validates input and calls the service. Service holds the logic, no Prisma calls. Repository is the only layer that touches the database (zero raw SQL? "Service has zero raw SQL, zero Prisma client calls." So the repository can use Prisma client calls, and if necessary raw SQL via $executeRaw/$queryRaw — the restriction is only on the service).

Naming: snake_case tables/columns via @map/@@map. Endpoints in kebab-case plural. TS files in kebab-case.role.ts.

Errors: single envelope { error: { code, message, details } }.

Wiring: services/repositories go in providers. Export/import across modules.

Migrations: every schema change ships with a migration. So prisma/migrations/<ts>_name/migration.sql is needed. The convention says migrations are required — a file like prisma/migrations/2024..._add_operations_read_model/migration.sql. Actually, in a from-scratch plan the entire schema is new. A single initial migration containing all tables would work. In the manifest, list only files I write. Migrations are part of the repo — "every schema change ships with a migration". Include one migration file in the manifest.

Tests: Vitest, test/<feature>.spec.ts. Note the layout says test/<feature>.spec.ts but the manifest's shape example is test/thing.test.ts. The layout section in the conventions takes precedence: test/<feature>.spec.ts. Manifest shape says "copy this shape exactly, replacing all parts" — the shape is `path | reads: ... | what`. Filename extensions can follow the layout convention, so use .spec.ts. Hmm, but "copy this shape exactly" refers to the manifest's format (comments, pipe-delimited), not necessarily extensions. The repo convention is .spec.ts. Going with .spec.ts.

Also environment: config comes only from env vars. Scheduled drift repair job — NestJS @nestjs/schedule or a manual setInterval? Convention stack is "NestJS for the API". @nestjs/schedule is a standard NestJS module. Alternatively, a simple Node setInterval started in main or a processor. To minimize dependencies, could also implement a `DriftRepairProcessor` as an injectable class with an interval started from the app module (onApplicationBootstrap). This avoids adding @nestjs/schedule. Choice: a DriftRepairService with setInterval, with interval from env var DRIFT_REPAIR_INTERVAL_MS. Write it in Assumptions.

Now the design:

Domain: marketplace operations = join of payment orders, events, workers. Filter by company, status, date range; sort by recency (newest first); paginate. About 3 million orders, query is 20–30s. Target is p95 under 50ms, same visible result. Read-your-own-writes: approving an order → reflected in the next request (sync hook, same transaction or immediately after). Per-company financial totals must be exact.

Tables:

Source tables (simulated write path — since we simulate, we need at minimum those source models):
- `payment_orders` (id, company_id, worker_id, status, amount_cents, currency?, created_at, updated_at, ...). What's needed to build the projection: order id, company id, worker id, status, amount, created_at/updated_at.
- `events`? "Join of payment orders, events, workers". Events might be order lifecycle events (e.g. created, approved, completed). Hmm. The projection joins payment orders, events, workers. So `events` table: id, order_id (or entity), type/name, occurred_at, payload? For the operations list, the "event" could be the latest event per order. To keep it manageable: `events` (id, kind, entity_kind?, order_id nullable, occurred_at). Actually to preserve generality: events reference orders (order events in the marketplace back-office context). Let's define `events`: id, order_id (FK), kind (enum-ish text), occurred_at. The projection stores the latest event kind + occurred_at per order.
- `workers`: id, name (display name for the dashboard), company_id? Workers belong to a company. The projection denormalizes worker_name and company_id from the order (orders have company_id; workers also have company_id, but the operation's company = order's company).

Actually simpler: the operation row = one row per payment order, denormalized:
- `operations_read_model`:
  - id (bigserial or uuid, PK) — order_id as PK is natural: operation ID = order ID. `order_id uuid PK`.
  - company_id (bigint, not null)
  - worker_id (uuid, nullable), worker_name (text, nullable — denormalized for display)
  - status (text: pending/approved/completed/rejected/refunded?) — status enum: order lifecycle. Choice: pending, approved, completed, rejected, cancelled. Keep small: pending, approved, completed, rejected.
  - amount_cents (bigint, not null)
  - currency (char(3), not null, default 'USD')
  - latest_event_kind (text, nullable)
  - latest_event_at (timestamptz, nullable)
  - occurred_at / created_at (timestamptz, not null) — "date range" filter and sort by recency. Recency is probably the order's created_at or updated_at. Sort by recency: sort by latest_event_at? "Sort by recency" — use `created_at` of the order... Hmm. In a dashboard "sorted by recency", newest operations first. An operation changes when status changes. I think recency should be the last activity. To keep it deterministic and simple: use `created_at` (order creation time) for both the date range filter and ordering? "Filter by company, status, and date range" — date range probably refers to the order's creation date. Sort by recency = newest first. Order by `created_at DESC`, tie-break with `order_id` for stable pagination. Hmm, or updated_at. Choice: `created_at` for filter, ordering by `created_at DESC, order_id DESC`. State this assumption explicitly.

  Wait — pagination with stable sort: needs a tie-breaker. created_at DESC then order_id (PK) — fine, deterministic.

- Per-company financial totals must be exact: `company_totals` table (read model):
  - company_id (bigint, PK)
  - total_amount_cents (numeric or bigint, not null) — sum of amounts. Which statuses count? Financial total: probably sum of amount over all orders (or non-rejected?). Choice: exact sum over all orders, and expose per-status subtotals too? "Per-company financial totals must be exact" — keep simple: one row per company, `total_amount_cents bigint`, and also `order_count bigint`? The requirement says totals. Keep: company_id PK, total_amount_cents numeric(18,2)? Use integer cents (bigint) for exactness. And maybe `approved_amount_cents` too? Don't overdo it. Just: total_amount_cents, order_count. Actually the dashboard "per-company financial totals" — include `total_amount_cents` and `order_count`. Two exact values, cheap.

  Hmm, but what does the dashboard query return? The operations list (paginated) and per-company totals (probably header aggregate). "New dashboard query" — the controller's endpoint returns page + totals for the filtered company. Endpoint: `GET /operations` (kebab-case plural). With query params: company_id, status, from, to, cursor/page, limit.

  Pagination style: keyset (cursor) pagination scales better than OFFSET for 3M rows; "without changing what the operator sees" — operators see a paginated list; changing from page numbers to cursors would change UX. Hmm. "What the operator sees" refers to data content/fields, not pagination mechanism. Keyset pagination is the right engineering choice for p95 < 50ms on 3M rows; OFFSET pages degrade. But to not change what the operator sees, page-number pagination is safer? The statement says "paginated" and target is p95 < 50ms. Keyset with (created_at, order_id) as the cursor is standard. Choice: keyset pagination with an opaque `cursor` (base64 of created_at|order_id) and a first page without a cursor. Note in Assumptions that the response shape includes `next_cursor` and items; operators see the same fields.

  Hmm, actually simpler and probably "what the operator sees" is: page-numbered offset pagination. With an index on (company_id, status, created_at), OFFSET is fine for small pages but degrades for deep pages. p95 requirement: offset pagination with good index is usually fine up to page depth ~thousands; deep pages are slow. Keyset is safer. Going with keyset. Write in Assumptions.

Projection maintenance (sync hooks):
Write service: `PaymentOrdersService` with methods that the task calls out: approve an order (`approve`), plus maybe `createOrder`, `rejectOrder`, `completeOrder`, and an event recorder. Task: "maintenance hooks called from the write service (simulating the write path)". So we need at minimum an order-creation service with `create`, `approve` (explicitly mentioned), and probably a general `updateStatus`. And `recordEvent` for events. To narrow scope:

- `orders/orders.service.ts`: createOrder(input), updateStatus(orderId, status), appendEvent(orderId, kind).
- Each write goes through a transaction: write to source tables + call projection maintenance in the same transaction. Where does the hook live? Conventions: service has zero Prisma calls; repository is the only DB layer. So the write transaction must be in the repository: a `PaymentOrdersRepository.createWithProjection(tx)` style? Hmm.

Cleaner architecture respecting the layering:
- `orders.repository.ts` — source writes (create order, set status) and event insertion. Exposes transactional composite operations: e.g. `recordCreatedOrder(order, projectionRow)`, `recordStatusChange(...)`.
- `operations.repository.ts` — read-model maintenance: upsert/patch/delete rows, increment/decrement company totals. And dashboard queries.
- `operations.service.ts` (projection maintenance service) — builds the new projection row from source entities, decides total deltas; called by the orders service inside the same transaction.
- Transaction boundaries: write service opens a transaction via... wait, services can't call Prisma. So the transaction needs to be in the repository. But a single logical write touches two repositories (source + projection). Options:
  1. Repository methods take a tx client parameter; the "transaction" is opened by one repository that orchestrates. E.g. `OrdersRepository.applyStatusChange(orderId, status, tx?)`. Hmm, having service pass a transaction client around crosses layers awkwardly but works: service gets `tx` from...? No, service can't call prisma.$transaction.
  2. Put the composite operation in one repository (the "aggregator" pattern): `OperationsRepository`? No — projection repository shouldn't own source writes.
  3. Let the orders repository's write methods internally call projection maintenance? That breaks "repository is the only layer that touches the database" — fine, but couples repositories.
  4. A dedicated `write-transaction` seam: since only the repository can call Prisma, each repository method that needs atomicity receives a `Prisma.TransactionClient`? Service can't create it.

  Better: the write service calls a single repository method per logical operation, and that method does everything atomically in its own transaction. To keep the layering honest: `OrdersRepository.create(input, projectionPatch)` — no...

  Cleanest within the constraints: the maintenance hook is a service (`OperationsMaintenanceService` = the operations service) and the write path goes: `OrdersService.createOrder` → constructs source data → calls `OrdersRepository.persistCreatedOrder(sourceData)`, which returns the created entity, then... this is two transactions → read-your-own-writes still holds (next request after commit sees the projection). But "concurrent updates to a single company's total" — if totals are updated via separate transactions with atomic increments (UPDATE ... SET total = total + delta), concurrent updates still yield exact totals (atomic row-level operation, no lost updates). Read-your-own-writes: after the write endpoint returns 201, the projection must be committed. Two sequential transactions satisfy that: "approve an order → reflected in next request". But the partial failure risk: source committed, projection not → drift, which the drift repair job fixes. That's actually a defensible design: idempotent sync hook + drift repair as backstop. But the strongest read-your-own-writes is same transaction.

  Alternative that respects layers: give each write operation a repository method on `OrdersRepository` that performs the whole logical write (source + projection call)... but the projection logic is business logic → belongs to the service. So the orders service computes the new projection row + total delta (pure function), then calls a repository method `applyOrderWrite({ sourceWrite, projectionPatch, totalDelta })` — one atomic transaction in the orders repository that writes to both tables? That makes OrdersRepository touch the projection table. Is that a layering violation? "Repository is the only layer that touches the database" — any repository can touch the DB. But it's cleaner if each table belongs to one repository... not a stated rule. The stated rules are about layers (controller/service/repository), not table ownership.

  Hmm, but the cleanest is: pass a shared `Prisma.TransactionClient` down. Who opens it? A `PrismaService` that wraps the client — NestJS Prisma convention. Service can't call prisma client... but could the service call `PrismaService.runInTransaction(fn)`? That's a Prisma client call in the service via a wrapper. The rule is "zero Prisma client calls" — a wrapper that exposes `transaction(fn: (tx: TxClient) => Promise<T>): Promise<T>`... the service still indirectly calls it. The spirit: DB access is in repositories. Opening a transaction that spans two repositories is an orchestrator concern; putting it in the service via a thin `DatabaseService` that only exposes `withTransaction` is arguable but... I think for a plan, simpler is better and clearly within the letter of the rules:

  Decision: each logical write is one repository transaction in `OrdersRepository` (the write-path repo): a method that takes the source change and the precomputed projection patch (row upsert payload + total delta) and executes both writes atomically. The `OperationsService` (projection logic) computes the patch from the current + new source state; `OrdersService` coordinates: read current entity (repo), compute new projection row via `OperationsService.toProjection(entity)`, total delta, then call `OrdersRepository.commitWrite(...)`. Wait, but the projection row upsert belongs in OperationsRepository...

  OK another clean pattern that's common with this layering: repository methods take an optional `tx` client, and one designated repository exposes a `runInTransaction`? No.

  Let me reconsider: is `PrismaService` with a `runInTransaction` acceptable? Task layers: "service holds the logic. Zero raw SQL, zero Prisma client calls". A `runInTransaction(callback)` call where the callback contains repository calls — the service isn't calling a Prisma client *method* on data; it's opening a transaction. Many codebases use exactly this: services receive a `Database`/transaction-scoped service. I think the intended reading is: no query logic in the service. But strictly "zero Prisma client calls" — `prisma.$transaction` is a Prisma client call.

  Safest design that satisfies the letter: composite repository method. `OrdersRepository.applyOperationWrite(payload: OperationWritePayload): Promise<PaymentOrder>` where payload includes `order` (source row data or status change), `events?`, and `projection: { upsertRow, totalDelta }` — the single `$transaction` inside does: source write, event insert, `operations_read_model` upsert, `company_totals` increment. But this repository writing to two tables owned by different repositories... The manifest has "what it holds" per file; we can describe OrdersRepository as "source of truth writes; executes atomic write+projection transaction". Hmm, but then the dashboard/projection queries live in OperationsRepository (same table ownership for reads), and the write-side projection upsert goes through OrdersRepository. A bit awkward but defensible: "single transaction, single repository method, no cross-repo transactions".

  Alternative: projection writes also belong in OperationsRepository, and OrdersRepository receives a `tx` param... no, that needs an opener.

  Actually wait — re-reading: "the service has zero Prisma client calls" is about data access. Another widely used pattern: the projection upsert + total delta is applied by OperationsRepository, and *source* write + projection are made atomic by making the projection maintenance a second repository call inside... no.

  Decision: composite method in OrdersRepository: `applyOrderWrite`. Let me define a clear payload type. Actually let me restructure with a cleaner story:

  The task says "maintenance hooks called from the write service". So the write service (OrdersService) calls a maintenance hook. The hook = `OperationsService.applyOrderWrite(...)` (the service layer), which calls OperationsRepository to persist the projection — and for atomicity, the entire write (source + projection) must be one transaction. To make that possible while keeping "repositories own the DB": expose `OrdersRepository.createInTransaction`?

  Let me just decide: **A transaction-scoped repository pattern with an explicit `runInTransaction` on PrismaService is ruled out** (letter of the rule). **Chosen**: each logical write goes through exactly one repository method that opens one `$transaction`: methods on `OrdersRepository` for source changes each accept the projection patch to apply in the same transaction, computed by `OperationsService`. The projection *queries* and *bulk/derivation* logic live in `OperationsRepository` (used by OperationsService for the dashboard, re-derivation, drift repair). Wait, then the `operations_read_model` table is written to by two repositories (OrdersRepository in the single-write transaction; OperationsRepository in bulk re-derivation). That's acceptable — bulk writes (re-derive, repair) use OperationsRepository; single-row sync writes are done atomically alongside the source write in OrdersRepository. Explain the reason (atomicity) in Assumptions. Hmm, but "concurrent updates to a single company's total" — the total is updated in both paths via `UPDATE company_totals SET total_amount_cents = total_amount_cents + $delta` — exact under concurrency (Postgres row lock, serialized). Good; the test verifies N concurrent writes → total equals sum.

  Hold on, maybe simpler and still atomic: have OrdersRepository write only the source, and have the projection hook be a *second* repository call, but both inside... no. Going with composite. Actually, hmm, one more idea: what if the projection upsert method lives in OperationsRepository and OrdersRepository exposes nothing to it, and atomicity is achieved by having `OrdersService` call a method on `OperationsRepository.applyAtomic(orderWrite, projectionPatch)`? No — source writes belong to the orders domain.

  Final: `OrdersRepository.applyOrderWrite(payload)` — single transaction, writes to payment_orders / events / operations_read_model / company_totals. The payload is fully computed by the service (projection logic lives in OperationsService, which exposes pure functions like `buildProjectionRow`, `totalDelta`). And OperationsRepository handles: dashboard queries, re-derivation window (bulk upsert + totals reset), drift repair (compare & resync), totals read. Both repos use PrismaService client.

  Hmm wait, does `OperationsService` even need to exist separately from a projection hook inside the OrdersService? Task: "maintenance hooks called from the write service (simulating the write path)". Layout: src/<feature>/<feature>.service.ts — a feature folder. Features: `orders` (write path), `operations` (read model + dashboard). So:
  - src/orders/orders.module.ts, orders.controller.ts (write API to simulate the write path: POST /orders, PATCH /orders/:id/status — kebab-case plural endpoints; PATCH /orders/:id/status → `PATCH /orders/{id}/status`), orders.service.ts, orders.repository.ts.
  - src/operations/operations.module.ts, operations.controller.ts (GET /operations, POST /operations/rederive — kebab-case plural... "rederive" is an action endpoint; make it `POST /operations/rederive` with a date window body? Or keep under the operations controller. The task says re-derivation routine — could be service method called by a job/endpoint. Expose endpoint `POST /operations/rederive` (auth out of scope). And drift repair: scheduled job + manual trigger endpoint `POST /operations/repair`? Task says "scheduled drift repair job". A scheduled processor is enough; manual trigger for testability — tests can call the service method directly, no endpoint needed. Keep manual trigger as a service method (testable) and schedule via interval.
  - operations.service.ts, operations.repository.ts, plus `src/operations/drift-repair.processor.ts`? Feature folder file naming: `<feature>.module|controller|service|repository.ts`. Extra files like `drift-repair.processor.ts`... layout is suggestive, not exhaustive ("Layout" lists standard roles). Convention for processor naming from Wiring section: "a service, repository, or processor goes into its module's providers" — so the `processor` role is anticipated! Good: `src/operations/drift-repair.processor.ts` with class `DriftRepairProcessor`. But feature-folder naming: file inside operations folder, name `drift-repair.processor.ts` (kebab-case.role.ts).

  And projection maintenance logic: keep inside OperationsService (`operations.service.ts`), exports a maintenance API (`applyOrderWrite`, `rederiveWindow`, `repairDrift`), which the OrdersService imports (OperationsModule exports OperationsService; OrdersModule imports OperationsModule). That's the "maintenance hook called from the write service". Transactions: OperationsService methods call... hmm, but atomicity with source writes.

  Ugh, tension again: if OperationsService.applyOrderWrite is called by OrdersService after the source write commits → not atomic. For atomicity, OptionsService would need to return a patch, and OrdersRepository would apply it inside the source transaction. Let me define precisely:

  - `OperationsService` exports pure-ish computations: `projectionRowFor(order, workerName): OperationRow`, and maintenance methods that take a transaction? Can't — repositories open transactions.

  Final clean scheme (committing now):
  - `OrdersService.createOrder(input)`: builds order data, calls `OperationsService.assumeProjectionFor(orderDraft)` → returns { row, totalDelta } (pure computation, no DB). Calls `OrdersRepository.applyCreate({ order, event?, projection })`. Repository opens one transaction: insert payment_orders (with ID generated server-side — uuid default), insert event row(s) if any, upsert operations row, upsert+increment company_totals. Returns created order (worker name lookup happens in repo or service? Worker lookup: OrdersService reads `WorkersRepository`? Do we need a workers feature? The "simulating the write path" needs source tables payment_orders, events, workers. We can have minimal seed/creation of workers. Worker name for the projection: the orders write transaction needs worker_name — look up in same transaction? Or a separate read before (workers are fairly static). Simpler: projection stores worker_name via lookup in the same transaction (repo does `prisma.worker.findUnique` within tx). OK, composite repo method does it.
  - `OrdersService.updateStatus(orderId, status)`: read current order via repository (read is fine outside tx), compute old+new status, projection patch (status change → upsert row with new status; totals: does a status change change the total? If total = sum of all orders regardless of status, then no delta on status change — only row update. To make totals meaningful and the "concurrent total updates" test interesting, maybe the total should be "approved+completed amount"? The requirement: "per-company financial totals must be exact". Financial total probably = sum of money in effect. If it's just a row count/sum over all orders, then delta only on create/delete. Concurrent updates to total happen on concurrent order creation (each +amount) and refunds/voids (delta -). Include void/refund? Status list: pending, approved, completed, rejected, voided. Total definition: sum of amounts of orders in any status? "Financial total" over rejected orders is weird. Define: `total_amount_cents` = sum of amounts of orders with status in (approved, completed) — i.e. committed money. Hmm, then status change pending→approved adds delta, approved→completed no delta, →rejected/voided subtracts. That gives deltas on status writes, making "concurrent updates to a single company's total" test rich (mixed creates + approvals racing). Also `order_count` = number of non-rejected/voided orders? Simple: count rows in counted statuses. Or keep just totals (amount) and count. Keeping both: `total_amount_cents`, `order_count`.

  Wait, over-engineering? The dashboard shows a list; "financial totals" is a dashboard KPI per company. Exact = bigint arithmetic, no approximation (in contrast to materialized views with pg_stat approximations or Redis counter with possible loss). A simple definition: total over all current orders? Define in Assumptions/Types section precisely: counts statuses approved and completed; document it. And "without changing what the operator sees" refers to the operations list — totals are a new KPI so we can define them as we like.

  Hmm hold on, simpler and probably "what the operator sees" is: totals are sum of all orders regardless of status. Then only create/void affect it. Then the concurrency test = N concurrent creates for one company → total exact. That also works and is simpler. But including the status dimension makes the projection more genuinely a "read model". I'll keep the two-status definition — it better exercises deltas in both directions. Final: counted statuses = approved, completed.

  - `OrdersService.recordEvent(orderId, kind)`? Events table: does the dashboard show latest_event? Include `latest_event_kind` + `latest_event_at` in the projection; events appended via write endpoint `POST /orders/:id/events`. Maintenance: update latest_event fields only if newer (ordering rule: an event with later occurred_at wins; ties → later insert wins... need deterministic: `occurred_at > current OR (equal AND id > current)`? Event ID is uuid — not orderable. Use `occurred_at >=` and `event_id > current_event_id`? UUIDs can be compared lexicographically but arbitrary. Simpler ordering rule: events are appended with strictly monotonically increasing occurred_at (server clock, microseconds) and the hook applies if `incoming.occurred_at > stored.latest_event_at`. Late events (older) are ignored for the latest fields (source table retains full history). Document as an ordering rule.

  Actually do we need the events source table at all? Task: operations = "join of payment orders, events, workers". To honor it, yes, an `events` source table and a projection that denormalizes the latest event. Keep it minimal: events (id, order_id, kind, occurred_at).

  - Read-your-own-writes: same transaction → committed when the write endpoint responds. `applyOrderWrite` commit is before the HTTP response → next GET sees it.

- Re-derivation routine for an arbitrary date window: `OperationsService.rederiveWindow(from, to)`: recompute projection rows + totals for orders created in [from, to). Implementation (repository):
  - `BEGIN;`
  - Upsert operations rows: SELECT o.*, w.name, latest event (window function or lateral) FROM payment_orders o LEFT JOIN workers ... WHERE created_at in window → ON CONFLICT (order_id) DO UPDATE.
  - Recompute that company's totals... total is over all orders, not just the window! If the total aggregates a per-company sum over all statuses across all time, then re-deriving a window requires recomputing the company's total = SUM over all orders for the affected companies. Options: (a) recompute full totals per company affected by `DELETE` + `INSERT ... GROUP BY`; (b) compute the delta. For exactness and simplicity: for the affected companies, reset total from full source scan (SELECT company_id, SUM(amount) FILTER (status counted), COUNT(...) GROUP BY company_id). Window is arbitrary but full scan per affected company could be heavy — but exact and simple; the window usually narrows the set of companies. Or: recompute global `company_totals` wholesale (DELETE all + INSERT GROUP BY) — simplest, exact, idempotent; at 3M rows the GROUP BY is one scan. For a "re-derive window" of e.g. one day, full totals rebuild is O(all) but tolerable as a routine; document the tradeoff? The plan should commit. Choice: `rederiveWindow(from,to)` = (1) upsert rows for orders created in [from,to); (2) rebuild `company_totals` wholesale from source (single GROUP BY, DELETE+INSERT in same tx). Totals remain exact. Idempotent. Good — simple and exact.

    Hmm wait, should re-derivation *replace* rows or upsert? Upsert is fine (same source). Rows for orders outside the window are untouched. OK.

  - Transaction: one transaction. Concurrency during re-derive: writes inside the window will race — upsert is idempotent, totals rebuilt at end of tx from source snapshot... in READ COMMITTED each statement sees latest committed; rebuild after upsert is mostly consistent. Race between a concurrent write commit between the upsert and the totals rebuild → total includes the new order, projection row upserted... if the write commits after the totals snapshot, total misses it. Mitigation: take a consistent view in re-derive? REPEATABLE READ snapshot at tx start → sees a consistent snapshot of source, and the write's projection row upsert happens in its own tx; our upsert will conflict... this is a repair routine; document the acceptable window: concurrent writes during re-derive may be temporarily out of sync for totals; drift repair / a subsequent re-derive fixes it. Or serialize: `LOCK` the company_totals row? Simplest and most robust: rebuild totals from source inside the same tx with a snapshot (default READ COMMITTED, statement-level) — accept and document a minor race; the drift-repair job covers it. But the requirement says totals must be exact — eventual consistency with a repair loop is fine; "exact" means no approximation (vs. sampling/approx count), not linearizable. Note: after re-derive/repair completes, for quiescent data totals are exactly equal to source sum; the drift test will assert that.

  Drift repair job: scheduled (interval from env var, e.g. every 15 min — assumption), compares source vs. projection for a window (e.g. last N hours, env var DRIFT_REPAIR_WINDOW_HOURS), detects mismatches (row missing/stale or totals off), and repairs by re-deriving those orders + rebuilding affected companies' totals. Implementation: `DriftRepairProcessor` (NestJS processor with an interval; or a class started by module `onModuleInit`). How to schedule without @nestjs/schedule? NestJS built-in: onApplicationBootstrap + `setInterval`. That's fine and zero deps. `DriftRepairProcessor` implements OnApplicationBootstrap; env var `DRIFT_REPAIR_INTERVAL_MS`; guard with a boolean to prevent double runs. Also expose `OperationsService.repairDrift(windowHours?)` used by the processor + tests + maybe endpoint.

  Drift detection details: find orders where projection is missing/stale: compare (status, worker_name, latest_event_at/kind, amount) and row count; totals mismatch: compare company_totals to computed sums. Report counts { rowsRepaired, totalsRebuilt } and return summary. Keep internal logic implementation detail; signature returns a summary type. For the plan: define `DriftRepairReport { windowFrom, windowTo, rowsResynced, companiesRebuilt }`.

  Which window for the scheduled repair? Orders changed in the last W hours: detection needs to know what changed → scan source orders with updated_at in [now-W, now] + totals check for all companies? Totals check: rebuild/compare all companies each run (one GROUP BY scan) — at 3M rows that's fine for a job every 15 min. Or compare only touched companies (touched = those in updated source rows in the window + companies of orders in window). Plan: repair window covers `updated_at` (or created) in [now - W, now]; resync rows for those orders; rebuild totals for the affected set of companies. Also run a full reconciliation at... no, keep as above. Hmm — but an order created long ago whose projection row was deleted: updated_at old → missed by the W-hour window. Document: the job covers recent activity; full re-derive endpoint exists for full repair. Good, honest.

  Dashboard query (new): GET /operations, query params:
  - company_id (required? "filter by company" — optional; the dashboard is probably per-company view; make it optional, defaulting to all)
  - status (optional single value)
  - from, to (ISO8601, created_at in [from, to))
  - limit (default 50, max 200), cursor (opaque)
  Response: { items: OperationDTO[], nextCursor: string | null } — plus company totals? "Financial totals per company" — a separate endpoint GET /operations/totals?company_id=... or include totals in the list response for the requested company. Choice: list endpoint returns items + nextCursor; a second endpoint `GET /company-totals` (plural kebab) for per-company totals? Hmm — the task says "new dashboard query" singular. Keep one endpoint returning both: when company_id filter is set, include `totals` (exact sum + count) for the filtered company; if no filter, `totals` is null? Asymmetric...

  Simpler: endpoint `GET /operations` returns `{ items, nextCursor }`. Totals: the dashboard's financial KPI — a separate route on the same controller `GET /operations/totals?company_id=` returns `{ company_id, total_amount_cents, order_count }`. Two small endpoints; task says "dashboard query" but the totals read is part of the dashboard. Hmm, task: "new dashboard query" (the slow one). The totals table is explicitly called out ("per-company financial totals must be exact") — so it needs to be surfaced somewhere. Add `GET /operations/totals`. Wait, kebab-case plural endpoints: `/operations`, `/operations/totals` OK.

  Indexes (DDL):
  - operations_read_model: PK order_id; index for the dashboard query: `(company_id, status, created_at DESC)` with ORDER BY created_at DESC — keyset pagination on (created_at, order_id): index `(company_id, status, created_at DESC)` suffices with order_id tie-break within same created_at (rare, PK sort inside a scan... actually for strict keyset we need an index that covers ORDER BY exactly: `(company_id, status, created_at DESC, order_id DESC)`? Index scan with equality on company_id,status then created_at DESC, order_id DESC — yes, add order_id to index. Also for status-less query: `(company_id, created_at DESC, order_id DESC)`. To keep DDL small, one composite index `(company_id, status, created_at DESC, order_id DESC)` handles both (status NULL → separate index for `WHERE company_id=? AND created_at ...`? Without status filter, composite has status in the middle — equality impossible; index unusable beyond company_id prefix → sort. So two indexes: A: (company_id, created_at DESC, order_id DESC); B: (company_id, status, created_at DESC, order_id DESC). A covers all-statuses, B covers filtered. Good DDL practice here.
  - company_totals: PK company_id (unique), nothing else.
  - Source tables: payment_orders: PK id; index (company_id, created_at) for the re-derive window scan? Re-derive filters by created_at in window (global, not per company) → index (created_at); plus a partial? Totals GROUP BY is a full scan. Events: PK id, index (order_id, occurred_at). Workers: PK id, unique? Name not unique.
  - company_id type: bigint (numeric ID) vs uuid? Choice: companies bigserial/bigint; workers uuid; orders uuid. Assumption line: `company_id bigint` (numeric, like most payment systems), `worker_id uuid`, order id uuid. Amount: integer cents bigint. Currency: text(3) — include? "Financial total" spanning currencies is meaningless without conversion; assume single currency USD — drop the currency column? Or include `currency` and assume single-currency? Simpler: `amount_cents bigint`, assumption "single currency USD; no currency column". Clean.

  created_at vs occurred: use `created_at` (timestamptz, server time).

Types and signatures section — everything needs declaring:

Prisma models (schema.prisma):
- PaymentOrder: id String @id @default(uuid()) @map("id"); companyId BigInt @map("company_id"); workerId String? @map("worker_id"); status OrderStatus (String) @default("pending") @map("status"); amountCents BigInt @map("amount_cents"); createdAt DateTime @default(now()) @map("created_at"); updatedAt DateTime @updatedAt @map("updated_at"); @@map("payment_orders").
- Worker: id, name, @@map("workers").
- Event: id, orderId String @map("order_id"), kind String, occurredAt DateTime @map("occurred_at"), @@index([orderId, occurredAt]), @@map("events").
- OperationRow (read model): id/orderId String @id @map("order_id"); companyId BigInt @map("company_id"); workerId String?; workerName String? @map("worker_name"); status String; amountCents BigInt; latestEventKind String? @map("latest_event_kind"); latestEventAt DateTime? @map("latest_event_at"); createdAt DateTime @map("created_at"). @@map("operations_read_model"), @@index per above.
- CompanyTotal: companyId BigInt @id @map("company_id"); totalAmountCents BigInt @default(0) @map("total_amount_cents"); orderCount Int @default(0) @map("order_count"). @@map("company_totals").

Wait — BigInt in Prisma ↔ JS: BigInt support is fine (Node 20). Or use Int for amount? 3M orders × amounts — cents can exceed int for big companies (2^31 cents ≈ $2.1M). Use BigInt. Type: `AmountCents = bigint`. DTO serialization: JSON.stringify(BigInt) throws! NestJS needs to serialize responses. Must convert to string in DTO (exact, no float). Define: all amounts in API payloads are strings (`"amount_cents": "12345"`). Good detail to include in the plan (prevents a classic bug). DTO: `OperationItem { order_id, company_id, worker_id | null, worker_name | null, status, amount_cents: string, latest_event_kind | null, latest_event_at: ISO | null, created_at: ISO }`. Totals DTO similarly.

Status enum: `type OperationStatus = 'pending' | 'approved' | 'completed' | 'rejected' | 'voided'`. Counted statuses: approved, completed. Export const `COUNTED_STATUSES`.

Input/DTO types (exported in service or controller file... plan: define a types module? Convention doesn't show a types file; declare types in the service/controller files. Put shared types in `src/operations/operations.service.ts`? Cross-feature (orders uses them) — does OperationsModule export the types via its service file? Types are compile-time; import from operations files is fine. Alternatively declare in each feature: write-side inputs in orders.service, read-side DTOs in operations.service. Cross-import: OrdersService imports OperationRow type from operations. OK — OperationsModule exports OperationsService; types flow with the module import (types need no runtime wiring).

Signatures:

OrdersService (src/orders/orders.service.ts):
- constructor(deps: OrdersRepository, WorkersLookup? — no, worker lookup in repo tx, OperationsService)
- `createOrder(input: CreateOrderInput): Promise<OrderDTO>` — CreateOrderInput { company_id: number; worker_id?: string; status?: OperationStatus (default pending); amount_cents: string|number? — input from API as string to preserve exactness; accept string. event? }
- `updateOrderStatus(order_id: string, status: OperationStatus): Promise<OrderDTO>` — raise 404 ResourceNotFound if missing; invalid transition? Enforce a status machine? Assume any transition allowed (assumption).
- `appendEvent(order_id: string, kind: EventKind): Promise<EventDTO>` — occurred_at = now.
- Worker creation for simulation? To "simulate the write path" we need seed data in tests: create workers. `createWorker(input)`? Or just seed via repository in test setup. Tests can insert source rows directly via repository (tests may use the repository). Keep no worker endpoint; tests seed via `WorkersRepository`? That adds a workers feature... or OrdersRepository.upsertWorker for simulation. Hmm — minimal: add `createWorker` to OrdersService? The worker is part of the marketplace source data. Add a small `src/workers` feature? That's scope creep. Alternative: include a worker stub on the order input: `worker?: { id, name }` — no, source tables should be real.

  Decision: minimal workers support inside orders feature: `OrdersRepository.ensureWorker(workerId, name)`? Awkward. Cleaner: test fixtures call a repository method. Expose `src/orders/orders.repository.ts` with methods: createOrder, getOrder, setOrderStatus, appendEvent, listOrdersInWindow, upsertWorker? Hmm.

  Actually — does the dashboard display require a workers table? The join includes workers → yes, worker name is displayed. Tests need workers to exist. Add an endpoint `POST /workers` (kebab-case plural) to orders controller? "Operations" feature is the read model; writes simulated = order writes + events + workers. Keep a single `orders` write feature, three endpoints: POST /orders, PATCH /orders/:id/status, POST /orders/:id/events. Workers: tests seed directly via a repository method `upsertWorker(id, name)` — document as a test seam (simulation helper). Hmm, "simulating the write path" just means we build our own write service (no real marketplace). Worker seeding via repository in tests is fine. But is a repository-only worker write consistent? Fine — document it.

  Actually simpler: include optional `worker_name` creation... no. Going with repository seam + assumption line.

OrderDTO { order_id, company_id, worker_id|null, status, amount_cents: string, created_at, updated_at }.

OperationsService (src/operations/operations.service.ts) — public API:
- `listOperations(query: ListOperationsQuery): Promise<PageResponse<OperationItem>>`
  - ListOperationsQuery { company_id?: number; status?: OperationStatus; from?: string(ISO); to?: string; cursor?: string; limit?: number }
  - Validation: controller validates (parse, range check); service enforces domain: limit clamp [1,200] default 50; from<to; cursor decodes (malformed → InvalidCursor error).
- `getCompanyTotals(companyId: number): Promise<CompanyTotalDTO | null>`? For a company with no orders → 404 or zero? Choice: if the company is unknown (no orders), 404 resource_not_found. Hmm, zero for a known company (e.g. all pending) — totals row exists only after write (row created with 0 on first counted order? no—totals increment on create if counted; pending create → no totals row). getCompanyTotals: no row → 404? Dashboard would show 0. Choice: return a DTO with zeros for any company (no 404). Simpler semantics. Actually "totals must be exact" — zeros are exact too. But then the totals row is lazily created; dashboard reads via `findUnique` → null → DTO zeros. Good: no 404 on that endpoint; company_id required (validation error if missing).
- `rederiveWindow(window: DateWindow): Promise<RederiveReport>` — DateWindow { from: string, to: string } ISO; validate from < to.
- `repairDrift(windowHours?: number): Promise<DriftRepairReport>` — default from env var.
- Maintenance hooks (called by OrdersService) — but per earlier decision, the source+projection transaction is in OrdersRepository. So where does the projection logic live? OptionsService exposes pure builders:
  - `projectionRowFor(order: PaymentOrder, workerName: string | null): ProjectionUpsert`
  - `totalDeltaFor(oldStatus: OperationStatus | null, newStatus: OperationStatus | null, amountCents: bigint): TotalsDelta`
  These are pure functions → OrdersService computes, passes into `OrdersRepository.applyOrderWrite(...)`. Then "maintenance hook called from write service" = OrdersService calling these + the repository atomic apply. OK, that satisfies it: hook = projection maintenance computation; atomic persistence in one repo tx.

  Hmm, but then OperationsService's DB-bound methods (list, totals, rederive, repair) use OperationsRepository. Fine.

  Wait, but do we still need OrdersService to import OperationsService? Yes for pure functions (or a standalone module `projection`... keep in OperationsService; fine).

  Alternative cleaner: put the pure builders in a separate small file `src/operations/projection.ts` (not a role — is that allowed? The layout lists standard roles but the manifest says "list only files you write"; helper files are OK, e.g. `src/operations/projection.ts` with pure functions + types). That avoids a service dependency for pure logic and keeps the "hook" clean: OrdersService imports { buildProjectionRow, totalsDelta } from projection.ts. I like this. But "no file not called for" — a shared helper is called for (logic shared by orders + operations). Include: `src/operations/projection.ts` holds the pure mapping + status set + cursor codec? Cursor codec is read-model-specific → operations.repository or a helper in the service. Cursor: opaque base64(`${created_at_ms}|${order_id}`). Codec functions in `src/operations/cursor.ts`? Two small helpers... consolidate: `src/operations/projection.ts` for pure projection computations; cursor codec as a private function inside OperationsRepository (repository concern — decoding for query construction). Good, one helper file.

  Hmm wait, does `projection.ts` violate "layer" convention? Not a layer role; it's a plain module of pure functions. Fine.

OrdersRepository (src/orders/orders.repository.ts) — DB methods:
- `createWorker(id: string, name: string): Promise<Worker>` (upsert-ish; test seam)
- `getOrder(orderId: string): Promise<PaymentOrder | null>`
- `applyOrderWrite(write: OrderWritePayload): Promise<PaymentOrder>` — the big one; single transaction.
  - OrderWritePayload variants? Three kinds of writes: CREATE, STATUS_CHANGE, EVENT_APPEND. Discriminated union:
    - { kind: 'create'; order: { companyId: number; workerId: string | null; status: OperationStatus; amountCents: bigint }; workerName: string | null? }
      Hmm, worker name lookup: repo does it inside tx (findUnique worker). Or the service pre-resolves it? The service would call getOrder... workers aren't in orders repo's reads? Give OrdersRepository a `getWorker(id)`. Service pre-reads worker name before apply (stale risk: worker rename between read and write — negligible; but "exact" is about totals). Cleaner to have the repo tx do it: lookup inside. Do the worker lookup in the repo tx (source-of-truth at commit time). So payload: { kind:'create', companyId, workerId|null, status, amountCents }.
    - { kind:'status_change'; orderId: string; from: OperationStatus | null; to: OperationStatus } — null from = order didn't exist → 404 handled by service (pre-read). Actually the service pre-reads for validation; the repo re-verifies inside tx (row missing → throw NotFoundError domain error? service checks pre-tx, then the repo tx asserts; concurrent delete — no delete op, so safe).
    - { kind:'event_append'; orderId: string; kind: EventKind }
  All three, in one tx: source write + projection upsert + totals delta (create: +amount if counted; status_change: delta = counted(to)−counted(from); event: 0).
  - Projection upsert for event_append: only update latest_event fields if occurred_at is newer (ordering rule!). If not newer → no projection change (source row inserted).
  - Totals upsert: `upsert company_totals where exists → increment, else create with delta`.
- `listOrdersInWindow(from: Date, to: Date): AsyncIterable or array`? Used by re-derive — but that's OperationsRepository's job reading source tables? Re-derive reads payment_orders+events+workers (source) and writes operations_read_model + company_totals. Which repository? OperationsRepository is "the read-model repo" — re-derivation *reads* source. Layering-wise any repo can touch the DB; but conceptually OperationsRepository touching payment_orders... Alternative: an OrdersRepository read method `collectSourceForWindow(from,to)` returning raw rows (order+worker name+latest event) — the re-derive in OperationsService composes: fetch source snapshot (OrdersRepository), then OperationsRepository.bulkUpsert(rows) + rebuildTotals(companies). Two repos cooperating, one transaction — again the tx spanning problem! bulkUpsert + totals rebuild must be atomic → must be a single repository method. So either OperationsRepository does the whole re-derive including source reads (via prisma queries — allowed, it's a repository) or OrdersRepository does the whole thing (but that's read-model logic — no). Decision: **OperationsRepository.rederiveWindow(from, to): Promise<RederiveReport>** does it all with raw SQL ($queryRaw/$executeRaw) inside one $transaction: upsert projection rows from source with window function (SQL is much simpler here), rebuild totals wholesale. Raw SQL in the repository is fine (the rule only forbids raw SQL in the service). Likewise `repairDrift` needs source vs. projection comparison → raw SQL is natural. And dashboard queries are Prisma or raw? Keyset + filtering with Prisma is fine; but index and DESC order... Prisma supports orderBy desc. Keyset where: (created_at < :c) OR (created_at = :c AND order_id < :oid) → Prisma's `OR` + `lt`/`eq` — fine. Dashboard via Prisma, bulk ops via raw SQL.

  Hmm wait, then re-derive "reads source" from OperationsRepository — the repo name says operations; the manifest line can say "read-model queries + bulk maintenance (re-derivation, drift repair); executes raw SQL inside transactions". Acceptable; alternative is `read-model` naming. Keep the feature name `operations`.

- OperationsRepository:
  - `findPage(query: ParsedQuery): Promise<{ rows: OperationRow[], nextCursor: string | null }>`
  - `getTotal(companyId: number): Promise<CompanyTotal | null>`
  - `rederiveWindow(from: Date, to: Date): Promise<RederiveReport>` (one transaction, raw SQL)
  - `repairDrift(from: Date): Promise<DriftRepairReport>` (one transaction)
  - Private cursor codec.

RederiveReport { from: string; to: string; rowsSynced: number }. DriftRepairReport { from: string; to: string; rowsResynced: number; companiesRebuilt: number }.

DriftRepairProcessor (src/operations/drift-repair.processor.ts): implements OnApplicationBootstrap; setInterval(intervalMs from config `DRIFT_REPAIR_INTERVAL_MS` default 900000); each tick calls operationsService.repairDrift(windowHours from env var `DRIFT_REPAIR_WINDOW_HOURS` default 24); catch log. Also expose `disable()`? NestJS tests: module init would start the timer in tests — guard with an env var `SCHEDULING_ENABLED` default...? In test env, we don't import the processor. But app.module imports operations.module which provides the processor → tests that use the module start the timer → dangling handle. Guard: `APP_ENV`/env var `DRIFT_REPAIR_ENABLED` default 'true'; test sets 'false'. Document.

Environment config: NestJS `@nestjs/config`? Convention: "config only from environment variables" — read process.env directly with a small config helper to avoid an extra dependency? NestJS idiom is ConfigModule. Assumption: use `@nestjs/config`'s ConfigModule.forRoot({ isGlobal: true })? Or a plain `src/config.ts` that reads process.env with defaults. Simpler: a `src/config.ts` exporting `getConfig()` that reads process.env (DATABASE_URL, DRIFT_REPAIR_INTERVAL_MS, DRIFT_REPAIR_WINDOW_HOURS, DRIFT_REPAIR_ENABLED). No extra deps. Good — file `src/config.ts`.

Main.ts: NestFactory.create(AppModule), listen on PORT (env var, default 3000). App.module: imports ConfigModule? If plain config.ts, app module just imports OrdersModule + OperationsModule + serves providers. PrismaService? Conventions don't list a prisma.service file... Repositories need a Prisma client. Either each repository constructs its own `new PrismaClient()` (wasteful) or a shared PrismaService. Layout has no prisma file but Wiring says "a service, repository, or processor goes into its module's providers" — add `src/prisma/prisma.service.ts`? Or put PrismaService in app module and export it: `src/app.module.ts` hosts a `PrismaService` (providers+exports), imported by feature modules. Hmm, that pollutes app.module. Alternative: small `src/prisma.service.ts`? Convention's layout is a pattern for features; a shared service is fine: choice — `src/prisma.service.ts` with class PrismaService (extends? no—wraps PrismaClient, onModuleInit connect? Standard PrismaService extends PrismaClient with onModuleInit/onModuleDestroy). Where does it get imported/exported? "Providers used by other modules are exported by their own module and that module is imported" — a provider not belonging to a feature... create a `src/core.module.ts`? The layout shows app.module + feature modules. Simplest and rule-compliant: declare PrismaService as a provider+export in App module... then feature modules import AppModule — weird (circular? no, features are imported by app module; features importing app module = cycle!). Module cycle in NestJS is disallowed without ForwardRef. So PrismaService needs a home module: `src/prisma/prisma.module.ts` + `src/prisma/prisma.service.ts` — a small shared module. Clean and rule-compliant (core infra module). Going with that.

Wait, the "no file not called for" discipline — is a prisma module called for? Repositories need to share the client; the wiring rule forces a module for cross-module providers. Justified. Two files.

Hmm, alternatively each feature module instantiates its own PrismaClient via its own provider (duplicate providers of the same class? Different instances). Two PrismaClients = two connection pools; works but wasteful and onModuleDestroy coordination. A shared core module is cleaner. Decision: `src/prisma/prisma.module.ts`, `src/prisma/prisma.service.ts`.

Controllers:
- OperationsController:
  - `GET /operations` — @Query params; validate: company_id integer, status in enum, from/to ISO and from<to, limit int 1..200, cursor string. On validation failure → 400 invalid_request with details per field. Returns { items, next_cursor }.
  - `GET /operations/totals?company_id=123` → CompanyTotalDTO; company_id required.
  - `POST /operations/rederive` — body { from, to } ISO; validate; 202/200 with RederiveReport. (Manual re-derive trigger — needed? Task says "re-derivation routine" — a service method; expose endpoint for operability + testability. Include; small.)
- OrdersController:
  - `POST /orders` (201) body { company_id, worker_id?, status?, amount_cents } → OrderDTO.
  - `PATCH /orders/:orderId/status` body { status } → OrderDTO (404 if missing).
  - `POST /orders/:orderId/events` body { kind } → EventDTO (404 if missing).

Error envelope: implement as NestJS exception filter? Convention: single envelope. Files: `src/errors/http-exceptions.ts` (classes) + `src/errors/filter.ts` (AllExceptionsFilter)? That's additional infra files... the envelope is contract → a small file justified: `src/errors.ts` with exception classes (ResourceNotFoundError code 'resource_not_found', InvalidRequestError code 'invalid_request', ConflictError? for concurrent status change? No optimistic concurrency needed... skip) and `src/errors.filter.ts`? Naming convention: kebab-case.role.ts — role "errors"? Use `src/errors/error-exceptions.ts` + `src/errors/error-filter.ts`. Hmm "kebab-case.role.ts" — `error-exceptions` isn't a role. Alternative: single file `src/http-error.ts`? A class `HttpError extends Error { code; message; details; status }` + filter in the same file? A filter is NestJS-specific... a single `src/errors.ts` with class HttpError + an `ExceptionFilter` class `HttpEnvelopeFilter`. One file, justifiable (error contract). Assumption line: the envelope is implemented by `src/errors.ts` (HttpError + HttpEnvelopeFilter applied globally in main).

Also Prisma error mapping: P2025 not found → resource_not_found — handled at service level by explicit check (pre-read null → throw HttpError). Fine.

Status transitions: assumption — any status can transition to any other (no state-machine enforcement), except... keep no enforcement. Simpler.

Read-your-own-writes: same transaction guarantees that after POST/PATCH returns, GET sees it.

Concurrency test: N=50 concurrent creates+status-changes for the same company via HTTP? Tests via service/repository directly (no supertest dependency). "Concurrent updates to a single company's total": fire Promise.all of 100 mixed operations (50 create pending + then approve? each op: create with counted status 'approved' → +amount) against one company; then getTotal == expected sum. Also mixed with status transitions that subtract. Use real Postgres (test environment DB URL from env var; assumption: tests run against a disposable Postgres, DATABASE_URL provided by environment (test container); clean tables before each test via repository/prisma $transaction DELETE). Test file: test/operations.spec.ts? Convention: test/<feature>.spec.ts — multiple features → `test/orders.spec.ts` (write path + write-read-your-writes), `test/operations.spec.ts` (dashboard query, pagination, totals), `test/drift-repair.spec.ts`? Task requires 3 named test groups: read-your-own-writes, concurrent totals, drift repair. Files:
- test/orders.spec.ts — read-your-own-writes (create → list sees; approve → totals+list sees), plus 404 path, invalid input.
- test/operations.spec.ts — dashboard: filtering (company/status/date range), keyset pagination consistency + ordering, exact totals (including zeros), malformed cursor → 400.
- test/drift-repair.spec.ts — drift scenarios: direct corruption of projection rows (delete/stale via repository $executeRaw? tests can use prisma service directly — tests have no layering rules... but "test behavior not implementation": corrupt by raw SQL via PrismaService is a setup detail, fine), totals drift (manual UPDATE of company_totals), then repairDrift → matches source; also rederiveWindow correctness.

Test infrastructure: an AppModule-ish test app or direct instantiation? Vitest + NestJS: use `Test.createTestingModule` (from @nestjs/testing) with modules + real PrismaService; or simpler manual wiring: instantiate repositories with a new PrismaClient. NestJS convention is Test.createTestingModule — use that; the assumption line: tests build a real app with Test.createTestingModule using PrismaService pointed at the test DATABASE_URL; no mock of repositories.

DESIGN.md: short, sync-hooks vs alternatives (triggers, CDC/log-based e.g. pgoutput+worker, materialized view refresh, dual-write-async, periodic full recompute). Justification: read-your-own-writes → must be in the same transaction as write; triggers are same-tx too (why not? opaque, hard to test, cross-table logic in SQL, versioned; still mention) → choice: application-level sync hooks (co-located, typed, testable, idempotent + drift repair backstop). Alternatives fail: MV refresh too slow / not immediate; CDC adds infra + lag breaks read-your-own-writes ("next request"); async queue lags; periodic full recompute too expensive at 3M rows. Keep it tight (task says short). File DESIGN.md at root.

Manifest files (all to write):
```
DESIGN.md
PLAN.md — no, PLAN is the artifact we're writing now; the manifest lists "files you write" for the task. Does PLAN.md itself count? The manifest is inside PLAN.md; "list only files you write" — for the implementation. Plan doc itself: exclude (it is the plan, not an implementation file). Hmm, DESIGN.md is called for by the task → include.
prisma/schema.prisma
prisma/migrations/0001_init/migration.sql — name: Prisma migrations are timestamped `YYYYMMDDHHMMSS_name`. For a plan, use `20250101000000_init`? Convention "every schema change ships with a migration" — one initial migration. Path: `prisma/migrations/20250601000000_init/migration.sql`. Plus `prisma/migrations/migration_lock.toml` (created by prisma migrate dev; should be listed? Machine-generated lock file — include for completeness: it's a real file in the repo. Include.)
package.json? Assumption: repo scaffold (package.json, tsconfig, vitest config) exists or the plan needs it? "Whoever implements this has only this document" + manifest lists files to write. If from scratch, package.json/tsconfig/vitest.config are needed... The reference layout lists prisma/schema.prisma, src/main.ts, etc. — suggesting a fresh repo with standard config. Assumption line: "Standard config files (package.json, tsconfig.json, vitest.config.ts) are preexisting/scaffolded; the manifest lists only source, tests, prisma, and DESIGN.md". Hmm — risky. Or include package.json in the manifest. "Do not create files not called for" — a from-scratch repo needs a package.json to exist; but that's scaffolding. The task focuses on the solution files. Write an Assumption: repo already has a pnpm workspace scaffold (package.json with NestJS/Prisma/Vitest deps, tsconfig ESM strict, vitest.config.ts); the manifest lists only files this plan adds. That's a clean one-liner.
src/main.ts
src/app.module.ts
src/config.ts
src/errors.ts
src/prisma/prisma.module.ts
src/prisma/prisma.service.ts
src/orders/orders.module.ts
src/orders/orders.controller.ts
src/orders/orders.service.ts
src/orders/orders.repository.ts
src/operations/operations.module.ts
src/operations/operations.controller.ts
src/operations/operations.service.ts
src/operations/operations.repository.ts
src/operations/drift-repair.processor.ts
src/operations/projection.ts
test/orders.spec.ts
test/operations.spec.ts
test/drift-repair.spec.ts
```

Manifest `reads:` — "a file may only list in reads: files that are listed above it". So the manifest ordering matters: foundational first.

Ordering:
1. prisma/schema.prisma | reads: - | canonical Prisma models (source + read-model tables), types, and table names
2. prisma/migrations/20250601000000_init/migration.sql | reads: prisma/schema.prisma | DDL for all tables + indexes (dashboard index, totals PK)
3. prisma/migrations/migration_lock.toml | reads: - | provider lock (postgresql)
4. DESIGN.md | reads: prisma/schema.prisma | rationale for sync hooks vs alternatives — hmm, DESIGN.md reads? It's prose; reads: prisma/schema.prisma fine.
5. src/config.ts | reads: - | env var accessors + defaults (DATABASE_URL via Prisma, DRIFT_REPAIR_*)
6. src/errors.ts | reads: - | HttpError codes + global envelope filter
7. src/prisma/prisma.service.ts | reads: - | shared PrismaClient lifecycle — could also read config? DATABASE_URL is consumed by PrismaClient natively (env()) — reads: - or src/config.ts? If the service uses config for URL... PrismaClient auto-reads DATABASE_URL. Keep reads: -.
8. src/prisma/prisma.module.ts | reads: src/prisma/prisma.service.ts | Core module providing+exporting PrismaService
9. src/operations/projection.ts | reads: prisma/schema.prisma | Pure projection row builder, counted statuses, totals delta — reads the schema for types? The "reads" relation is about dependency; projection.ts imports Prisma model types from @prisma/client (generated from schema) → reads: prisma/schema.prisma makes sense.
10. src/orders/orders.repository.ts | reads: prisma/schema.prisma, src/prisma/prisma.service.ts, src/operations/projection.ts? — does the repository use projection functions? The payload is computed by the service; the repository just applies (row upsert + delta). The repo needs the OperationRow shape for the upsert parameters — that comes from @prisma/client (schema). Delta is a number. So reads: schema, prisma.service. OK.
11. src/orders/orders.service.ts | reads: src/orders/orders.repository.ts, src/operations/projection.ts | write orchestration, hook invocation
12. src/orders/orders.controller.ts | reads: src/orders/orders.service.ts, src/errors.ts | input validation, routes
13. src/orders/orders.module.ts | reads: ...module — does a module read all four of its files? A file "listed above it": schema (no). Does the module read orders.controller/service/repository + prisma.module? It declares providers; imports PrismaModule and OperationsModule (for the hook types — actually at runtime OrdersService's DI needs OperationsService? If the service uses only projection.ts (pure functions), no dependency on OperationsService! Then OrdersModule only imports PrismaModule. Cleaner: hook = projection.ts pure functions + repository atomic apply; no cross-module service dependency.
    Reads for orders.module.ts: src/orders/orders.controller.ts, orders.service.ts, orders.repository.ts, src/prisma/prisma.module.ts.
14. src/operations/operations.repository.ts | reads: prisma/schema.prisma, src/prisma/prisma.service.ts
15. src/operations/operations.service.ts | reads: src/operations/operations.repository.ts, src/operations/projection.ts
16. src/operations/operations.controller.ts | reads: src/operations/operations.service.ts, src/errors.ts
17. src/operations/drift-repair.processor.ts | reads: src/operations/operations.service.ts, src/config.ts
18. src/operations/operations.module.ts | reads: the four operations files + prisma.module
19. src/app.module.ts | reads: src/orders/orders.module.ts, src/operations/operations.module.ts
20. src/main.ts | reads: src/app.module.ts, src/errors.ts (global filter)
21. test/orders.spec.ts | reads: the orders files + operations repository? (for list visibility checks — tests call OperationsService.listOperations → also read operations files) + prisma.service for cleanup.
22. test/operations.spec.ts | reads: operations files + orders service (to write data via write path? tests should go through the API/service — use OrdersService for seeding → reads orders.service.ts)
23. test/drift-repair.spec.ts | reads: operations.service, operations.repository (corruption via raw? tests use PrismaService directly for corruption → reads src/prisma/prisma.service.ts), orders repository/service for seeding.

The manifest description column: "what it holds" / "what it proves". Keep terse.

Hmm, `reads:` semantics: imports/uses. Tests use prisma.service for table cleanup (prisma.$transaction delete). OK.

Now section 2 Data model — all tables with columns/types:
- payment_orders: id uuid PK default gen_random_uuid(); company_id bigint NOT NULL; worker_id uuid NULL REFERENCES workers(id); status text NOT NULL CHECK in set, default 'pending'; amount_cents bigint NOT NULL CHECK (amount_cents >= 0); created_at timestamptz NOT NULL default now(); updated_at timestamptz NOT NULL; index (company_id, created_at) — needed? Re-derive window scans created_at globally: index (created_at); drift uses updated_at: index (updated_at). Add both (small).
- workers: id uuid PK; name text NOT NULL.
- events: id uuid PK; order_id uuid NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE? Order deletion not modeled; keep plain FK. kind text NOT NULL; occurred_at timestamptz NOT NULL; index (order_id, occurred_at).
- operations_read_model: order_id uuid PK; company_id bigint NOT NULL; worker_id uuid NULL; worker_name text NULL; status text NOT NULL; amount_cents bigint NOT NULL; latest_event_kind text NULL; latest_event_at timestamptz NULL; created_at timestamptz NOT NULL; indexes: (company_id, created_at DESC, order_id DESC), (company_id, status, created_at DESC, order_id DESC).
- company_totals: company_id bigint PK; total_amount_cents bigint NOT NULL default 0; order_count int NOT NULL default 0.

Event kind: enum-like text — kinds: 'approved','rejected',... no, events are independent of status (e.g. 'payment_captured','dispute_opened'). Keep `EventKind = string` (free text) — assumption: event kind is free-form text; dashboard shows latest. Avoids over-modeling.

Section 3 types and signatures — write them all out:

```
// src/config.ts
export interface AppConfig {
  port: number;
  driftRepairEnabled: boolean;
  driftRepairIntervalMs: number;
  driftRepairWindowHours: number;
}
export function getConfig(): AppConfig
```
(DATABASE_URL is read by PrismaClient directly — note it.)

// src/errors.ts
```
export type ErrorCode = 'resource_not_found' | 'invalid_request' | 'internal';
export class HttpError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;
  constructor(code, message, opts?: { status?: number; details?: Record<string, unknown> })
}
export class HttpEnvelopeFilter implements (NestJS ExceptionFilter) { catch(exception, host) }
```
Every error and what raises it:
- resource_not_found (404): unknown order id in PATCH status/POST event; unknown cursor? No — malformed cursor → invalid_request.
- invalid_request (400): controller validation failures (bad enum, non-numeric company_id, from >= to, limit out of range, malformed cursor, missing required field); service-level domain validation (window from>=to).
- internal (500): unexpected; envelope with code 'internal', message is generic.

// src/operations/projection.ts
```
export type OperationStatus = 'pending' | 'approved' | 'completed' | 'rejected' | 'voided';
export const OPERATION_STATUSES: readonly OperationStatus[];
export function isCountedStatus(s: OperationStatus): boolean  // approved|completed
export interface ProjectionRow {
  orderId: string; companyId: number; workerId: string | null; workerName: string | null;
  status: OperationStatus; amountCents: bigint;
  latestEventKind: string | null; latestEventAt: Date | null; createdAt: Date;
}
export interface TotalsDelta { amountCents: bigint; count: number }
export function buildProjectionRow(args: {
  order: { id: string; companyId: number; workerId: string | null; status: OperationStatus; amountCents: bigint; createdAt: Date };
  workerName: string | null;
  latestEventKind?: string | null;
  latestEventAt?: Date | null;
  prev?: { status?...} — hmm. For a create: build full row (latestEvent null). For a status change: the repo upserts only changed columns? Simplify: build full row on each write; worker name + latest event fields need to be current → the repo tx selects the existing projection row first (source of truth within the transaction? The projection could drift... source + worker lookup is enough; latest event from events table: SELECT max occurred. Ugh — the tx cost is tiny (pk/index).
```
Simplify contract: `buildProjectionRow(order, workerName, latestEvent: { kind, at } | null): ProjectionRow`. The repo (create/status_change tx) resolves workerName (workers lookup) and latestEvent (max occurred_at event for the order) inside tx
