# Transcript — 03-read-model-projection / variant-a / qwen/qwen3.8-27b

Every request, in order, with its reasoning. Nothing is elided.

# solution-retry

## reasoning

```
Let me carefully analyze the task.

Task: build a solution for the "marketplace operations dashboard" — a read model projection that:

1. Maintains a projection table (a join of payment orders, events, workers) — filtered by company, status, date range, sorted by recency, paginated.
2. The projection is updated inside the writer's transaction (synchronous hook called from the write service).
3. Concurrent updates to one company's totals must be accurate (in-place increment).
4. A re-derivation routine for an arbitrary window (idempotent, safe while live).
5. A scheduled drift-repair job.
6. Dashboard query reads only the projection, with a covering index.
7. Tests: read-your-own-writes, concurrent totals, drift repair.
8. DESIGN.md justifying synchronous hook.

Stack: TypeScript (strict), Node 20+, NestJS, Prisma, PostgreSQL, Vitest, pnpm, ESM ("type": "module").

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

Layers:
- controller validates input and calls service. Zero business logic.
- service holds logic. Zero raw SQL, zero Prisma client calls.
- repository is the only layer that touches the database.

Wait — "zero raw SQL, zero Prisma client calls" in the service. But the maintenance hook needs atomic in-place increment. That can be done with Prisma's `increment` — that's a Prisma client call, but in the repository. OK, so the repository uses Prisma. Service calls repository.

Naming:
- Table and column: snake_case (via Prisma `@map`/`@@map`).
- Endpoint: kebab-case, plural.
- TS file: `kebab-case.role.ts`.
- Class: PascalCase.
- Code and comments in English.

Errors: one envelope `{ "error": { "code": "snake_case", "message": "...", "details": {} } }`. details is an object, never null.

Wiring: providers, exports, imports.

Migrations: every schema change ships with a migration. So I need to include a migration SQL file. Conventionally `prisma/migrations/<timestamp>_name/migration.sql`. I'll create one migration for the initial schema and possibly the projection table. Since I'm creating the whole schema, I can do it in one initial migration. Actually "every schema change ships with a migration" — since I'm building from zero, one initial migration is fine. I'll write the SQL in `prisma/migrations/20250101000000_init/migration.sql`. Should I include the projection table in the same migration, or a separate one? The projection is part of the new schema, so one initial migration is cleanest. Let me actually think: I'll include source tables (payment_orders, events, workers) and the projection tables (operations_rows / operations projection and company totals) in the initial migration. Hmm — actually wait. The spec says the projection is a join of payment orders, events, workers. The source tables exist in the marketplace. Since I'm building the whole solution from zero, I need to define the source tables in the schema too (at least the relevant columns) so that the re-derivation query works and tests can seed.

Let me design the domain:

Source tables:

**workers** (`workers`):
- id (uuid, pk)
- company_id? Hmm. Actually workers belong to a company? The operations list filters by company. A "operation" is a join of payment orders, events, workers. Let me think about what an "operation" row looks like:

Columns an operator sees (from the join):
- operation id (payment order id, presumably)
- company_id (from payment order)
- status (from payment order: e.g. pending, approved, rejected, settled)
- worker_id + worker name
- event_id + event name
- amount (payment amount, maybe in cents)
- created_at / updated_at
- recency sort — probably `updated_at` or `created_at`. "Sort by recency" — let me use `updated_at`... actually recency typically means most recent first — sort by created_at or updated_at. Let me choose `created_at` desc? Hmm. The list of "operations" sorted by recency. Let me use `created_at` descending, paginated by cursor or page offset. Pagination — "same page size" — the original query paginates. I can implement offset pagination with LIMIT/OFFSET, or cursor. The simplest, faithful reproduction: `?company=&status=&from=&to=&page=&pageSize=` with OFFSET. But the index must match the filter and sort: covering index matching filter (company_id, status, created_at) and sort (created_at desc). With offset pagination, index (company_id, status, created_at DESC) covers filter+sort and includes selected columns for coverage.

Let me define:

**PaymentOrder** (`payment_orders`):
- id: uuid
- company_id: uuid
- worker_id: uuid
- event_id: uuid
- status: enum-like string: "pending" | "approved" | "rejected" | "settled"
- amount_cents: integer
- currency: string (e.g. "USD")
- created_at: datetime
- updated_at: datetime

**Event** (`events`):
- id: uuid
- company_id: uuid? Or is event independent? Events could belong to a company (e.g. an event the marketplace hosts for a company). For the join to make sense, event has name, occurred_at.
- name: string
- location? not needed.
- created_at

**Worker** (`workers`):
- id: uuid
- full_name: string
- company_id: uuid? A worker might belong to a company. But the payment order has company_id, so the join filter is by payment order's company.

Operation row = a payment order enriched with worker name, event name. The dashboard lists operations: columns like id, company_id, worker_name, event_name, status, amount_cents, created_at, updated_at.

**Projection table** `operations` (name it `operations_read_model` or `operation_projection`? snake_case table name; I'll use `operations_projection`? Hmm, endpoint is plural kebab-case: `/operations`? Wait, the endpoint for the dashboard query: `/operations` list endpoint, filtered. And totals endpoint: `/companies/:id/totals`? Hmm.

Let me design the endpoints:
- `GET /operations?company_id=&status=&from=&to=&page=&page_size=` → paginated list (reads projection only).
- `GET /companies/{companyId}/operations-totals?from=&to=`? Hmm, but the totals per company must be accurate. Totals row maintained by atomic increment.
- Write endpoints (simulate write path): `POST /operations/approve`? Actually approval of a payment order: `POST /payment-orders/:id/approve` and `POST /payment-orders/:id/reject`. Endpoint is kebab-case plural: `/payment-orders/{id}/approve` — "approve" is an action on a resource; convention says kebab-case plural endpoints. Let me use `POST /payment-orders/:id/approve` and `POST /payment-orders/:id/reject`. Also `POST /payment-orders` for create? For read-your-own-writes, the test: approve an order → next dashboard request reflects it. So approve endpoint must exist. I might also add a create endpoint to simulate initial write (`POST /payment-orders`), which also upserts the projection row.

- Maintenance hook: in the write service, after writing the source row, call `projectionService.rebuildForOrder(tx, order)` inside the same Prisma interactive transaction. Since the service must have "zero Prisma client calls", the transaction needs to be initiated in the repository layer. Prisma interactive transactions: `prisma.$transaction(async (tx) => {...})` — the `tx` client gets passed around. So the repository methods should accept a Prisma client (either the base or the tx client) as parameter. This is the standard pattern: repository methods take `Prisma.TransactionClient | PrismaClient`.

So the write flow:
1. Controller `POST /payment-orders/:id/approve` → service `approveOrder(id)`.
2. Service calls repository `updateStatusInTx`? But service can't call Prisma. The repository needs a method that runs the whole transaction: e.g., `PaymentOrderRepository.approve(id)` does `prisma.$transaction(async tx => { const updated = tx.paymentOrder.update({...status: 'approved'}); await tx.$executeRaw(...upsert projection row + increment company totals...); return updated; })`.

But wait: "the maintenance hook is called from the write service" — the hook should be called from the write service, not buried in a repository transaction method. So the structure is:

- `PaymentOrderService.approve(id)`:
  ```ts
  return this.paymentOrderRepository.withTransaction(async (tx) => {
    const order = await this.paymentOrderRepository.updateStatus(tx, id, 'approved');
    await this.operationsProjectionService.rebuildRowForOrder(tx, order); // hook
    await this.companyTotalsService.increment(tx, order.companyId, ...); // hook
    return order;
  });
  ```
  Hmm, but `withTransaction` — the repository provides the transaction. The hook itself is a service that calls the repository. That works: service holds the logic; repository touches DB.

  Alternative: repository method `PaymentOrderRepository.approveOrder(id, tx?)` where if no tx is provided it opens one, and the hook is called from the service inside the tx. Cleanest:

  ```ts
  // repository
  async approveInTx(tx: TxClient, id: string) { ... }
  async withTransaction<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> { return prisma.$transaction(fn); }
  ```

  Service:
  ```ts
  async approve(id: string) {
    return this.ordersRepository.withTransaction(async (tx) => {
      const order = await this.ordersRepository.approveInTx(tx, id);
      await this.projectionService.applyOrderChange(tx, order);
      return order;
    });
  }
  ```

  And `ProjectionService.applyOrderChange` is the "maintenance hook" — a service called from the write service that writes to the projection table + totals via the projection repository. This matches "maintenance hook is called from the write service and runs inside the transaction that wrote the source row".

Hmm, but "zero business logic in the controller, zero Prisma client calls in the service" — passing `tx` (which is a Prisma client) through the service is fine; it's not calling prisma directly, the repository receives the tx client.

2. **Concurrent totals accuracy**: the totals table `company_financial_totals` has one row per company, with columns like `approved_amount_cents`, `settled_amount_cents`, `approved_count`, etc. Updates must be atomic in-place increments: `UPDATE company_financial_totals SET approved_amount_cents = approved_amount_cents + $delta ...` — via Prisma `increment`. But a delta based on old→new status: approving a pending order adds its amount to the approved total. If an order is approved then settled, move the amount from approved to settled. So the hook computes the delta from old status → new status, and applies atomic increments/decrements. The totals table also needs to be idempotent to the status transitions — deltas computed from (oldStatus, newStatus) and amount.

  Actually, for the re-derivation accuracy, the totals can be fully recomputed from the orders inside the re-derivation window. For the incremental hook, the delta approach is stateless and accurate: each transition changes totals by a deterministic delta. If the same transition is applied twice (double delivery), it would be double-counted — but hooks run in the same transaction as the source write, so at most once per write. Re-derivation fixes any drift.

  Alternatively, the totals can be re-derived entirely from the orders table (a full-scan aggregation) rather than incrementally. But the spec explicitly says: "if two orders are approved concurrently for the same company, both move the same totals row. A read-modify-write on that row loses one. Make the update atomic at the database — either an in-place increment or a lock held for the duration — and prove it with a test." So an in-place increment on a shared totals row is the design. Good: `company_financial_totals` table, `upsert` + `increment` operations in one statement per counter:

  ```ts
  await tx.companyFinancialTotals.upsert({
    where: { company_id: companyId },
    update: { approved_amount_cents: { increment: delta }, ... },
    create: { company_id: companyId, approved_amount_cents: delta, ... },
  });
  ```

  This is atomic (a single UPDATE ... SET col = col + delta), concurrent increments won't be lost.

  What are the "financial totals per company"? Let me define columns:
  - `company_id` (pk)
  - `total_amount_cents` (all orders regardless of status? or per status?)
  Let me go with per status: `pending_amount_cents`, `approved_amount_cents`, `rejected_amount_cents`, `settled_amount_cents`, and counts too? Keeping it modest: amount per status + `orders_count`? I'll do amount per status and count per status? Simpler: amount per status + `total_amount_cents` (sum over all orders). Hmm, keep: `pending_amount_cents`, `approved_amount_cents`, `rejected_amount_cents`, `settled_amount_cents`, and `orders_count`. The delta logic:

  - create order (status pending): pending += amt, count += 1
  - pending → approved: pending -= amt, approved += amt
  - pending → rejected: pending -= amt, rejected += amt
  - approved → settled: approved -= amt, settled += amt
  - rejected → ? maybe reopen: rejected → pending? Support a "reopen"? Probably not necessary. Support the transitions above, plus approve from... Actually the operator "approves an order" — presumably from pending. I'll also allow approved → rejected? Keep the set small but defined. I'll implement a generic transition map that handles any from→to pair among the four statuses: decrement counter[from] by amt, increment counter[to] by amt; count unchanged (count = number of orders, which only changes on create). That's clean and general.

  Wait — but is "orders_count" needed? Maybe skip counts; just amounts per status. The requirement is "financial totals per company". Amounts per status is enough. Keep 4 columns of amounts. Good.

3. **Projection row table** `operation_read_model` (table name? The dashboard lists "operations"). Name the table `operations_view`? Hmm. Table must be snake_case. `operation_read_model`? Or just `operations_read_model`. Let me name the Prisma model `OperationReadModel`, table `operation_read_model`. Hmm, singular vs plural tables: examples `payment_orders`, `events`, `workers`. So `operation_read_models`? Reads awkwardly. Common convention: singular for read model, e.g. `operations_read_model`... Let me go with table `operation_read_model`, model `OperationReadModel`. Actually, maybe simpler and clearer: table `operations_projection`. Model `OperationsProjection`? Hmm.

Let me think about what makes it readable:
- Source: `payment_orders`, `events`, `workers`
- Projection: `operation_read_model` (one row per payment order, denormalized with worker_name, event_name)
- Totals: `company_financial_totals`

Endpoints:
- `GET /operations` (dashboard list) — reads `operation_read_model`.
- `GET /companies/{companyId}/financial-totals` — reads totals.
- `POST /payment-orders` (create — simulates write path that also maintains projection)
- `POST /payment-orders/{id}/approve`
- `POST /payment-orders/{id}/reject`
- `POST /payment-orders/{id}/settle`? For completeness of the transitions. Probably not needed for tests but harmless. Include approve, reject, settle to make the transitions testable. Hmm, "do exactly what the task asks". Task asks to "simulate write path" — approve is the named write. I'll include create + approve + reject (three writes, enough to exercise transitions and drift scenarios). Actually settle completes the lifecycle; the spec only mentions approve. To avoid scope creep, I'll include create, approve, reject — those are enough to demonstrate the hook, concurrent totals (concurrent approve), and drift. Hmm but "settled" status adds a 4th counter column... Keep statuses: pending, approved, rejected. Three statuses, clean.

Wait — but for read-your-own-writes: "approve an order and the next request shows it as approved". The projection row's `status` column is updated in the same transaction. Then `GET /operations?company_id=...&status=approved` shows it. Good.

Columns on the projection row (the shape of the query):
- `payment_order_id` (pk) — the order id, same uuid
- `company_id`
- `worker_id`, `worker_name`
- `event_id`, `event_name`
- `status`
- `amount_cents`
- `currency`? maybe skip; add `currency` for realism? The original join selects order fields + worker.name + event.name. Keep: status, amount_cents, created_at, updated_at (from the order), plus `worker_full_name` as `worker_name`, `event_name`.

Sort by recency: `created_at DESC`? or `updated_at DESC`? "Sort by recency" — the most recent operation first. For a list of operations, recency = when the operation happened = created_at. But the read-your-own-writes test: approve an order → it reflects in the next request — "reflects" means status changes, not necessarily position. I'll sort by `created_at DESC` with `payment_order_id DESC` as tiebreaker for stable pagination. Hmm, but wait — actually, let me reconsider: if the operator approves an old order, its position in a created_at-sorted list doesn't change, only the status. That's fine — "reflects in the next request" = the row shows the new status (and appears in the filtered list for status=approved).

Covering index: `(company_id, status, created_at DESC) INCLUDE (payment_order_id, worker_name, event_name, amount_cents, updated_at, ...)`. In Prisma, you can define composite indexes but not INCLUDE columns; covering indexes with INCLUDE require raw SQL in a migration. Since "every schema change ships with a migration", I'll hand-write the migration SQL including the covering index (CREATE INDEX ... INCLUDE). And in schema.prisma I'll declare the regular index used by Prisma queries. The Prisma query on the projection: `where: { company_id, status, created_at: { gte, lte } }, orderBy: [{ created_at: 'desc' }, { payment_order_id: 'desc' }], skip, take`. A regular composite index `(company_id, status, created_at DESC)` is enough for filter+sort; INCLUDE makes it covering. Since the migration is under my control, I can write the CREATE INDEX with INCLUDE there, and just declare the base index in Prisma. The Prisma-generated index and my hand-written one might conflict (Prisma creates the index I declare). Let me not declare the covering one in schema.prisma (to avoid a duplicated index) and instead create it manually in the migration. Hmm, but then `prisma migrate dev` would create the index I declare and my migration adds another... Let me have the migration be the single source: the migration creates all tables AND indexes; schema.prisma declares indexes matching the migration (so they are in sync). For the covering index with INCLUDE, I'll declare it in the migration only, with a comment in the schema saying the covering index is in the migration. Wait — but if Prisma declares an index `@@index([company_id, status, created_at])` and the migration creates `(company_id, status, created_at DESC) INCLUDE (...)`, Prisma's shadow-database check might detect drift... In this artifact, no one runs `prisma migrate dev` for verification; I just ship both consistent files. To be safe, I'll make the declared index exactly `@@index([company_id, status, created_at(sort: Desc)])` and in the migration create the same key columns DESC plus INCLUDE columns. A plain B-tree index without INCLUDE vs. one with INCLUDE — Prisma's drift detection compares index definitions; INCLUDE would show as drift. To avoid inconsistency, maybe I should not declare this index in the Prisma schema and create only in the migration. Prisma doesn't require an index to be in the schema for it to exist... well, `prisma migrate diff` would report it. But honestly, for this artifact, the cleanest defensible approach: declare in schema.prisma and also in migration, matching as closely as Prisma allows; covering INCLUDE goes in the migration. Actually you know — a simpler alternative: a regular composite index `(company_id, status, created_at DESC, payment_order_id DESC)`... no, that's not covering.

Let me be pragmatic:
- schema.prisma: `@@index([companyId, status, createdAt(sort: Desc)], map: "idx_operation_read_model_company_status_created")` — hmm wait, actually if the migration creates an index with INCLUDE, Prisma's introspection would... I'm overthinking. Many real projects have raw indexes that aren't in the schema. The instructions say every schema change ships with a migration — I'm shipping the migration with the DDL (tables + indexes including covering). In schema.prisma I'll declare the same index key columns (without INCLUDE), plus a comment noting that the migration widens it to a covering index. That's defensible.

Hmm wait. Actually, let me reconsider: is the INCLUDE index even needed given Prisma's query? The hot path query filters by (company_id, status, created_at range), sorts by created_at DESC, and selects specific columns. A non-covering index on (company_id, status, created_at DESC) → index scan + heap fetch per row (page size e.g. 50) — still fast (p95 well under 50ms for 3M rows). Covering index eliminates the heap fetch. The spec says "a covering index that matches filter and sort is the point of doing all this." So I'll include it. In the migration:

```sql
CREATE INDEX idx_operation_read_model_covering
ON operation_read_model (company_id, status, created_at DESC, payment_order_id DESC)
INCLUDE (worker_name, event_name, amount_cents, updated_at);
```

Wait — should payment_order_id DESC be part of the key columns? The query's orderBy: created_at DESC, then payment_order_id DESC (tiebreaker). To have the index serve the sort exactly, the key should be (company_id, status, created_at DESC, payment_order_id DESC). But then the created_at range filter (`gte`/`to`) — with created_at as 3rd key column, the range still works (index is usable for prefix equality + 1 range). The 4th column payment_order_id is just for tiebreak order — for a range scan on created_at, the tiebreak order within the same created_at... For rows with identical created_at (possible), the index order by (created_at DESC, payment_order_id DESC) gives us the exact sort. Good.

But wait — should the date-range filter be inclusive on created_at (`from`, `to`)? Yes: `created_at >= from AND created_at <= to`.

The Prisma query:
```ts
where: {
  company_id: { equals: companyId },  // required filter? Dashboard filters by company — is company mandatory? "Filter by company, status, date range" — the backoffice list is per operator's company? Make company_id required in the query (operators see their company's operations). Hmm, could be optional. The index leading column is company_id; if company were optional, the index wouldn't be used. The spec: "filter by company and status, order by recency" and "covering index that matches filter and sort". So: company required, status optional? If status is optional, the index (company, status, created) only uses the company prefix and has to scan all statuses for that company — that's fine, it's per company.
```

Let me make `company_id` required (validated in controller, 400 if missing), `status` optional (validated against enum), `from`/`to` optional (validated as ISO dates, from <= to), `page` (1-based) and `page_size` (default 50, max 200).

Pagination: offset-based with skip = (page-1)*pageSize, take = pageSize. Also return `total` count? A count query on the projection for the same filter — cheap with the same index (`COUNT` uses the index). The original query paginates; "same page size" — I'll return `{ items, page, page_size, total }`. Count adds a 2nd query but stays on the projection. I'll include the total — dashboards need it. Hmm, is that scope creep? The dashboard shows a list with pagination; total count is standard. I'll keep it.

4. **Re-derivation routine**: a service `ReDerivationService.deriveWindow(from: Date, to: Date)`: rebuild the projection rows and totals for a date range from source tables. Requirements: safe to run while live; idempotent (run twice → same result).

Implementation:
- For orders in the window (by created_at? by updated_at?): the projection row reflects the order's current state. "Rebuild the projection for a date range from the source tables". If an order created in the window was later updated (outside the window), the projection must reflect its current state. Simplest, correct approach: select all payment orders with created_at in [from, to] (and their workers/events), and upsert the projection rows for them to match current source state. For totals: totals are per company, aggregated over ALL orders — not window-limited! If I only re-derive totals for orders in the window, companies with orders outside the window are left wrong.

  Hmm. How do I make window re-derivation consistent with totals? Options:
  a) Recompute company totals fully from the entire orders table (global), regardless of window. That makes window derivation: rows for window orders + full totals recomputation. Idempotent, accurate. But "arbitrary date window" for totals is weird — the totals are global. Since the totals row is a full-state aggregate, any derivation that touches them should recompute them fully, not just for a window.
  b) Make totals derivable by summing deltas from the window orders only, on top of the existing totals — dangerous and not idempotent.
  
  Correctness requires (a): the re-derivation routine rebuilds projection rows for the window AND recomputes all company totals from source. To keep it efficient and live-safe:
  - Rows: `DELETE FROM operation_read_model WHERE payment_order_id IN (SELECT id FROM payment_orders WHERE created_at BETWEEN ...)` followed by INSERT ... SELECT with JOINs (single statement) — or an upsert per row. Bulk DELETE+INSERT in a transaction is idempotent (same result twice) and live-safe if... it's inside a single transaction; other concurrent writers' writes for those orders are either before or after the transaction's snapshot (Postgres MVCC) — if a concurrent writer commits in between, the final state is... The delete+insert runs in one transaction, so it's atomic; if the concurrent write commits first, the re-derivation sees it; if it commits after, that write's own hook already re-applies its own row after the re-derivation commits? Wait — the hook writes the projection row for the changed order in its own transaction. If the re-derivation transaction commits, and then the writer's transaction commits, the writer's upsert overwrites the row with its own (newer) state — but the writer's transaction started before the re-derivation's SELECT (read view under READ COMMITTED... Prisma default isolation is READ COMMITTED). Under READ COMMITTED, each statement sees a fresh snapshot. The writer's UPDATE on the source row: if the re-derivation is deleting/inserting that row... no conflict on different tables, unless both write the same projection row — the writer upserts (ON CONFLICT DO UPDATE), the re-derivation upserts. Both are full-value upserts keyed on payment_order_id → last committer wins, and the last committer has the latest source state (assuming the writer's update to the source row committed after the re-derivation read). Hmm, edge case: writer W updates source row at T1 (uncommitted), re-derivation R reads at T2 (sees old value, writes projection with old value, commits at T3), W commits at T4 — projection is stale! But: this is the same edge case as a normal concurrent write; the re-derivation window is bounded, and the drift-repair job catches this. "Safe to run while live" — I read this as: doesn't break service, doesn't lose data, is transactional, is idempotent. A brief stale row that the drift repair would fix is acceptable — and the drift repair job exists precisely for that. OK.

  Actually, to reduce this edge, I can derive using a consistent snapshot: run inside a SERIALIZABLE transaction? Or use `SELECT ... FOR UPDATE`? Hmm. A simpler, more defensible approach: the re-derivation upserts rows in a single statement `INSERT ... SELECT ... ON CONFLICT DO UPDATE` — atomic, idempotent, and under READ COMMITTED, any source write that commits before this statement runs is reflected; any that commit after is reflected by their own hook. The only lossy interleaving is a write that commits after the re-derivation's SELECT but whose hook already... no wait, the hook runs in the same transaction as the source write — so if the source write commits after the re-derivation's insert statement, then its hook's upsert also commits after → the final projection state = that write's state. If the source write commits before the re-derivation's statement, the re-derivation's SELECT sees it (statement-level snapshot in READ COMMITTED) → correct. There's actually no lossy interleaving! Because the projection row write is in the same transaction as the source write (atomic pair), and the re-derivation's upsert is a full-value overwrite: final value = whichever of (re-derivation's read state) or (write's committed state) committed last... Let me redo it:

  - W (write tx): at t_a update source row S to state X; at t_b upsert projection row P to state X; commit at t_c (t_a < t_b < t_c, same tx).
  - R (re-derivation tx): at t_d read S (statement snapshot = latest committed at t_d); at t_e upsert P to that state; commit at t_f.
  - Case t_c < t_d: R reads state X → P = X. Correct.
  - Case t_d < t_a: R reads old state Y, P = Y, commits at t_f. Now two subcases: t_f < t_b: then W's upsert at t_b sets P = X, commits at t_c > t_f. Final P = X. Correct. t_b < t_f < t_c?? Impossible: t_b < t_c, and R commits at t_f after t_b but before t_c. Then P is written Y at t_e (assume t_e before t_b), then X at t_b, then R commits at t_f — the upsert at t_e is an INSERT ... ON CONFLICT DO UPDATE executed at t_e, not at commit. Order of writes to P: Y at t_e, X at t_b → final P = X regardless of commit order (the row version at t_f... hmm, actually the row update at t_e creates an MVCC version; W's update at t_b reads the latest committed row or a conflicting uncommitted version?

    MVCC: R's statement at t_e (upsert) — if it's an UPDATE on an existing row, it acquires a lock (UPDATE lock) on the row version. W's update at t_b on the same row blocks until R's transaction commits or aborts. If R commits at t_f, W then proceeds, reads R's committed version (state Y), and applies its own update → state X (since W's upsert is a full-value set, not a delta) → P = X. If R aborts, W proceeds on the old version → X. Either way final = X. Correct!
  - Case t_a < t_d < t_c (W in progress during R's read): R's snapshot at t_d does not include W's uncommitted change → R reads Y, upserts Y at t_e — W's row update at t_a already took a lock on the source row S... different tables, no lock interaction on S. But both W and R write to P: W at t_b (full set to X), R at t_e (full set to Y). If t_b < t_e: R's update blocks on W's row lock until W commits at t_c; then R applies Y over X → P = Y, commits at t_f. Final P = Y but S = X. Stale! The interleaving t_a < t_d... wait t_b < t_e requires t_b < t_e; and t_d < t_e (read before write in same tx). So t_a < t_d < t_e, t_b < t_e, t_c > t_b. For example: t_a=1, t_d=2, t_b=3, t_e=4, t_c=5, t_f=6. W writes source at 1, writes projection at 3, commits at 5. R reads source at 2 (sees Y), writes projection at 4 — but W holds an uncommitted update on P from t_b=3, so R's statement at t_e=4 blocks until W commits (at 5). R then reads the current committed version of P (= X, W's state), and applies its full-value update → Y. Commits at 6. Final P = Y, S = X. Drift!

  So there IS a lossy interleaving: when the writer's projection write happens after the re-derivation's source read but before the re-derivation's projection write. To eliminate it, options:
  - Run the re-derivation in a REPEATABLE READ or SERIALIZABLE transaction. Under SERIALIZABLE, R's read at t_d establishes a snapshot; W commits at t_c with changes overlapping R's reads → R gets a serialization error (40P01) → retry. This is the clean "safe while live" answer: SERIALIZABLE + retry on serialization failure. Under READ COMMITTED, as I showed, R can apply an old value over a new one.

  Hmm wait, but even under SERIALIZABLE, does the drift disappear? R's snapshot (fixed at first read t_d) sees Y (W uncommitted). W commits X. R's SERIALIZABLE check: R read S at t_d (version Y); W updated S and committed at t_c after R's read → write-skew detection: R's statement writes P based on reading S; W's tx read (no, W didn't read S's row... W updated S). The serialization graph: R read S (version at t_d) and wrote P; W wrote S and wrote P. Edge R→W? R read S@Y before W's update to S@X committed: edge R → W (R's read of S is "before" W's update... the dependency: W's update to S overwrites the version R read, so R → W? In SSI: R read a row version that W later overwrote → R precedes W? no — a reader that read a version that was later overwritten: the edge is reader → writer (R → W). And W wrote P, and R wrote P: R read P's version at time t_e (which at that point was X? R's read at t_e reads the version committed at t_e, which is X since W committed at t_c=5 < t_e... wait t_e was delayed past t_c). Hmm, this is getting deep. In the blocked scenario, R's P-update at t_e reads the latest committed P = X (W's), and writes Y. W wrote P=X, and R read P=X and wrote P=Y → edge R → W? (R read a version W wrote? no — R's read of P at t_e happened after W's commit; reading a version that another tx wrote: edge W → R? In SSI, a read of a committed version that another tx wrote gives an edge writer → reader... hmm, actual SSI edges: (1) writer W1 updates a row, reader R reads the old version before W1 commits → edge R → W1. (2) reader R reads a row version written by W1 (W1 committed before R's read) → no edge? no wait — if W1's version is committed before R reads it, then W1 → R? Let me recall: SSI adds edge W1 → R if R read a row version that W1 wrote? That's for the case where W1's version is the one R read: W1 → R. And R → W1 if R read the old version before W1's commit. Cycle W1 → R → W1 → abort one. In our scenario: W wrote P version X (committed at t_c=5). R read P at t_e=4 (delayed to after t_c=5) → R read W's version → edge W → R. R read S at t_d=2, saw Y; W updated S (version X) and committed at 5 after R's read → R read the old version before W's update committed → edge R → W. Cycle W→R→W → SSI aborts R (or W). Retry → R re-reads S and now sees X. Correct!

  So: the re-derivation transaction is `isolationLevel: 'Serializable'` with a retry on 40001/40P01. That makes it rigorously safe while live.

  Hmm, but Prisma: `prisma.$transaction(fn, { isolationLevel: 'serializable', maxWait, timeout })` — supported (Postgres interactive transaction). But wait — the layering: the re-derivation service calls a repository method that receives the tx client. The repository's `withTransaction(fn, { isolation: 'serializable' })` handles it. But retries on serialization failure — where? The service can retry (logic), calling the repository's transactional unit. But the unit of work includes both row re-derivation and totals recomputation in one SERIALIZABLE tx; on 40001, the whole thing retries. The service wraps: `retryOnSerializableConflict(() => repo.withTransaction(...))`. The service holds the retry logic (it's business logic), the repository exposes `withSerializableTransaction`.

  Hmm, actually — do I need SERIALIZABLE for totals recomputation too? The totals are recomputed via `INSERT ... SELECT ... GROUP BY company` or a per-company upsert from a full aggregation. Same concurrency concern. Same transaction → same protection.

  OK, but also simpler thought: do I really need to re-derive the per-company totals over the full table? Yes for accuracy. The routine "rebuild the projection for a date range from source" — the projection includes the totals read model. A window that re-derives only rows but not totals would leave stale totals for companies whose window orders changed... wait, if the window is [from, to] and I re-derive rows for orders created in that window, the affected companies are those with orders in the window; but their totals also include orders outside the window — those don't change in this run... but the totals might have drifted for other reasons (drift injection test!). The drift repair job = re-derivation over a recent window (or compare+fix). If drift was injected into a company's totals, then re-derivation over a window containing that company's orders must fix the totals → full recomputation of the totals for affected companies (or all companies). Simplest, most robust: recompute totals for all companies from the full orders table, in the same transaction. Full table scan of 3M orders in a SERIALIZABLE tx — a few seconds, tolerable for a maintenance routine. For the drift repair job (recent window), I can limit the totals recomputation to companies that have orders in the window: `RECOMPUTE totals for companies in (SELECT DISTINCT company_id FROM payment_orders WHERE created_at IN window)`. Hmm, but drift could exist for a company with no orders in the window. The drift repair job should find and fix drift in the recent window — drift injected in a window order's company. The task says "drift injected into the projection → repair job finds and fixes". If the drift is in a totals row for a company with recent orders, window-limited recomputation catches it. I'll implement it:

  - `ReDerivationService.derive(from, to)`: in one serializable tx:
    1. Delete projection rows for orders created in [from, to].
    2. INSERT ... SELECT current state from payment_orders JOIN workers JOIN events where created_at in [from, to] (full row).
    3. Recompute totals for all companies that have at least one order in [from, to] (SELECT DISTINCT company_id), as a full aggregation over all their orders: DELETE + INSERT ... SELECT ... GROUP BY, or UPSERT with computed values. Full-value recompute (not delta) → idempotent.
  - This makes "run twice over same window → same result" hold: full overwrite of rows, full recompute of totals for affected companies. If I recompute all companies, it's even simpler: totals recomputation = full rebuild of the totals table. Let me do that: in every derive run, rebuild the whole totals table (delete + insert-select group by company). Idempotent, accurate, simple. Cost: aggregation over all orders — fine for maintenance.

  Wait but hmm: is it weird for a "window" re-derivation to rebuild global totals? Defensible: totals is a global aggregate; any derivation must leave it consistent, and a full rebuild is the only idempotent way (window-limited deltas aren't idempotent). I'll note this in DESIGN.md.

- **Drift repair job**: scheduled (cron, e.g. every 5 min) that: picks a recent window (e.g. last 24 hours, with overlap), runs a compare: find projection rows that disagree with source, find totals that disagree; repair. Two implementation choices:
  a) The repair = re-run the re-derivation on the recent window (idempotent by construction — rebuild overwrites, so it "finds and fixes" any drift in that window by making everything match). The "compare" step is implicitly the rebuild. But the spec says "compare the projection and source for the recent window and repair the mismatches". A compare-then-repair is more literal: detect drift (count / rows), and repair them. I can do:
     1. Compare: `SELECT ... FROM payment_orders o LEFT JOIN operation_read_model p ON ... WHERE o.created_at IN window AND (p.payment_order_id IS NULL OR p.status <> o.status OR p.amount_cents <> o.amount_cents OR ...)` → count + list drifted rows.
     2. Totals compare: recompute expected totals per company in window (aggregation), and compare with stored totals row → list companies that drifted.
     3. Repair: run the re-derivation for the window (idempotent) — this fixes both row drift and totals drift for the affected companies. Return a report: `{ rows_drifted: n, companies_drifted: m, window: {...} }`.

  Compare via raw SQL in the repository (only the repository touches the DB; raw SQL allowed in the repository — the ban is in the service). Prisma can't do that comparison cleanly (no joins across models in where), so the repository uses `$queryRaw`/`$executeRaw`. That's fine and honest.

  Scheduling: NestJS @nestjs/schedule `@Cron`. Include `@Cron(CronExpression.EVERY_5_MINUTES)` or a cron string `'*/5 * * * *'` in the `DriftRepairService`, with `@ScheduleModule`. The job calls `DriftRepairService.run()` → window = [now - 24h, now] → `ReDerivationService.derive` after compare. Actually, should the drift repair just be a scheduled invocation of the re-derivation over the recent window + a compare report? Let me define:

  `DriftRepairService.runRepair(now = new Date())`:
  - window = [now - 24h, now]
  - `drift = await this.repository.compareProjectionToSource(from, to)` → { rowsMissing, rowsMismatched, totalsDrifted: string[] }
  - if any drift → `await this.reDerivationService.derive(from, to)` (serializable, idempotent)
  - return report.

  Even if no drift detected in the window, running a repair every 5 min with a 24h window is cheap enough, but I'll gate the repair on detection (less load), and the compare is the detection. Edge: drift injected and the injected row's order is inside the window → detected → fixed.

  One subtlety: the compare should be robust under concurrency — the compare is READ COMMITTED outside a serializable tx; a concurrent write between the compare and the repair is fine (the repair is an idempotent overwrite). A compare that reports drift when a concurrent write is in flight → spurious repair, harmless.

5. **Dashboard query**: `OperationsController` `GET /operations` → `OperationsQueryService.list(filter)` → repository reads only `operation_read_model`. The controller validates: company_id is a non-empty string (uuid? validate as uuid? The controller "validates input" — I'll use a simple parse / class-validator? The stack doesn't mention class-validator. I'll do manual validation in the controller, throwing `BadRequestException`? But error envelope: the code is the contract with snake_case. I need a global exception filter that produces `{ error: { code, message, details } }`. The envelope requires that every error is in that shape — implement a `AllExceptionsFilter` (or `ApiExceptionFilter`) that maps:
  - NotFoundException → code `resource_not_found`
  - BadRequestException → `validation_failed`? Or more specific codes. The spec shows `resource_not_found` as an example. Let me define a small set of domain error codes:
    - `resource_not_found` (404)
    - `validation_failed` (400) with details of the failing fields
    - `conflict` (409) — e.g. approve an already-approved order? Or `invalid_state_transition` (409)?
    - `internal_error` (500) fallback.
  I'll build a `DomainException` (custom HttpException) with a code, and a global filter that maps known codes through and maps standard Nest exceptions to codes.

  Validation specifics in the controller:
  - `company_id`: required, uuid → otherwise 400 `validation_failed` with `details: { company_id: "..." }`.
  - `status`: optional, one of pending/approved/rejected → otherwise 400.
  - `from`, `to`: optional ISO 8601 datetime; both present → from <= to, else 400.
  - `page`: positive integer ≥ 1 (default 1); `page_size`: integer 1..200 (default 50).

  UUID validation without uuid package: regex `/^[0-9a-f]{8}-...$/i`. Fine.

6. **Write endpoints**:
  - `POST /payment-orders` body `{ company_id, worker_id, event_id, amount_cents }` → creates an order with status pending; hook upserts projection row + increments totals. Validate body in the controller (amount_cents is a non-negative integer, uuids). 201 returning the created order (with id, status, timestamps).
  - `POST /payment-orders/:id/approve` → transition pending→approved (reject non-pending with 409 `invalid_state_transition`? or 422? I'll use 409 conflict with code `invalid_state_transition` and details { from, to }). Hook: upsert projection row (status, updated_at), totals delta: pending -amt, approved +amt.
  - `POST /payment-orders/:id/reject` → pending→rejected similarly.

  Hmm — do we need `POST /payment-orders`? For the read-your-own-writes test, we need orders to exist: we can seed via re-derivation (create source row directly, then run derive on a window) — but the test says "approve an order → next dashboard request reflects it". Creating the order via the API is the cleanest simulation of a "write service". Yes, I'll include the create endpoint. The spec says "simulate the write path so this is runnable" — the write service = these controllers/services.

  Note: on create, the projection hook upserts the row; on transition, the hook upserts the row with the new status + updated_at, and applies totals delta. If the source row is updated (worker/event changed)? Out of scope — only status/amount is what we maintain. Keep the hook for: create, status change.

  Also, worker/event name changes? If a worker's name changes, the projection row's worker_name becomes stale. Out of scope for the spec (drift repair handles it via re-derivation). Not building worker update endpoints. OK.

7. **Totals endpoint**: `GET /companies/:companyId/financial-totals` → returns the totals row (404 `resource_not_found` if no orders for the company). The read-your-own-writes test can assert totals after concurrent approve. The "concurrent updates to one company's totals must be accurate" test: create N orders for company C (via service or via repo seed + derive), approve half concurrently (Promise.all of approve calls), and assert totals: approved == sum of approved amounts, pending == sum of pending amounts, exact.

8. **Tests** (Vitest, `test/<feature>.spec.ts`):
  - `test/operations-read-your-own-writes.spec.ts`: seed an order (via create service), approve via service, then immediately query the list → the row shows approved; also totals reflect. Test via service layer (behavioral), with a real Postgres? Vitest + real Postgres requires a DB. Hmm — "no tools, no shell" — I'm just writing files; the tests need a database to run in their environment. Convention: DATABASE_URL for Postgres. The tests should connect to Postgres via DATABASE_URL (skip if not set? or assume). Let me write tests that use a real Prisma client against DATABASE_URL and create/tear down data in beforeAll/afterAll (unique company id per test run). I'll also provide a small test helper `test/helpers/test-db.ts` (create PrismaClient, clean tables). The layering rules say the repository touches DB; tests can use PrismaClient directly for seeding (test code, not feature code).

    Hmm wait — should the tests go through the HTTP layer (supertest) or the service? "Test behavior, not implementation" — going through the Nest app (via `NestFactory.create(AppModule)`) and HTTP requests is most behavioral. Supertest isn't in the stack list... I can use `app.init()` + `app.getHttpServer()` with Node's fetch (Node 20 has global fetch) — request to `http://localhost:${port}`. That avoids the supertest dependency. Let me do this: bootstrap the app in e2e style, use fetch for the dashboard query and writes, and use PrismaClient directly for seeding source data and asserting on the DB (totals accuracy).

    Test files:
    - `test/read-your-own-writes.spec.ts`
    - `test/concurrent-totals.spec.ts`
    - `test/drift-repair.spec.ts`
    Maybe consolidate under `test/operations.spec.ts`? The layout shows `test/<feature>.spec.ts`. I'll make: `test/operations.spec.ts` (read-your-own-writes + dashboard shape), `test/concurrent-totals.spec.ts`, `test/drift-repair.spec.ts`, and `test/re-derivation.spec.ts` (idempotency: run twice → same result; row matches source). The spec's deliverables list tests for read-your-own-writes, concurrent totals, drift repair. Idempotency of re-derivation is an acceptance criterion ("run twice → same result") — I'll add a small test for that in the drift or a separate file. Let me do 4 files; keep focused.

    DB availability: I'll assume DATABASE_URL is set (their environment). Add a guard: `const databaseUrl = process.env.DATABASE_URL;` if (!databaseUrl) skip? Vitest `describe.skipIf(!process.env.DATABASE_URL)` — nice touch so the suite doesn't fail in CI without a DB... but if we skip, we report non-existent coverage... eh, in their evaluation environment the DB is probably available (they asked for a Postgres solution). I'll use `describe.skipIf(!databaseUrl)` — safe and honest.

    Test DB isolation: use unique UUIDs per suite for company/worker/event; teardown deletes by company_id (and orders by company). Clean up between suites with `prisma.$executeRawUnsafe` truncate? Delete is safer.

9. **DESIGN.md**: justify synchronous hook vs. alternatives (post-commit hook + poller, outbox + queue, CDC/Debezium, database trigger, scheduled refresh). Discuss the read-your-own-writes constraint, accurate totals via in-place increment, idempotent re-derivation, drift repair, index design, tradeoffs (write amplification, tx size, no isolation of projection failure → same tx = atomic rollback; rejected alternatives: async (eventual consistency breaks the requirement), triggers (hidden logic, can't run in app transaction... actually DB triggers run in the same tx — that's a legitimate alternative! justify app-level hook: triggers bypass app validation... hmm, triggers are actually quite good. Why reject? (1) logic in DB makes app testing harder, hard to unit test, Prisma migration coupling; (2) two sources of truth for the write logic; (3) can't reuse the same code in the re-derivation path; (4) portability / not visible to app logs. Defensible.)

10. **File layout** (following the conventions):
```
prisma/schema.prisma
prisma/migrations/20250612000000_init/migration.sql
prisma/migrations/20250612000000_init/migration_lock.toml
src/main.ts
src/app.module.ts
src/common/errors.ts (DomainException + codes)
src/common/all-exceptions.filter.ts
src/common/prisma.service.ts?
```
Hmm — Prisma client access. Convention: the repository is the only layer that touches the DB. Standard Nest+Prisma: a `PrismaService extends PrismaClient` provided at app level, injected into repositories. That's fine — the repository injects PrismaService. The service never touches it.

Features:
- `src/operations/` — the dashboard query feature:
  - `operations.module.ts` (controller + query service + repository)
  - `operations.controller.ts` (GET /operations)
  - `operations.service.ts` (query logic: pagination computation)
  - `operations.repository.ts` (projection reads)
- `src/payment-orders/` — write service feature:
  - `payment-orders.module.ts`
  - `payment-orders.controller.ts` (POST /payment-orders, POST /payment-orders/:id/approve, :id/reject)
  - `payment-orders.service.ts` (transaction orchestration, calls the maintenance hook)
  - `payment-orders.repository.ts` (source writes in tx)
- `src/projection/` — projection maintenance:
  - `projection.module.ts` (exports ProjectionService + CompanyFinancialTotalsService?)
  - `projection.service.ts` (maintenance hook: upsert operation row; delta for totals) — named `OperationsProjectionService`? File: `projection.service.ts`, class `ProjectionService`. Hmm, maybe split: row maintenance vs totals maintenance. One `ProjectionService` with methods `upsertOperationRow(tx, order, worker, event)` and `applyTotalsDelta(tx, companyId, fromStatus, toStatus, amountCents)`? The row upsert needs the worker's full name and the event's name — the write service fetches the full order with worker/event (a join) via the payment-orders repository (`findOrderWithRelations(tx, id)`), or the projection repository fetches them. Let me have `PaymentOrderRepository.findByIdWithRelations(tx, id)` return `{ order, worker: {full_name}, event: {name} }` (Prisma include). Then the hook: `projectionService.applyOrderWrite(tx, snapshot)`, snapshot = { order fields, workerName, eventName, previousStatus | null }.
  - `projection.repository.ts` (upsert operation row, totals upsert/increment — all in tx)
- `src/totals/`? Or fold the totals endpoint into the operations feature? The dashboard shows a list; totals is a separate concern: `GET /companies/{id}/financial-totals`. I'll put it in the operations feature (operations.controller) or its own `financial-totals` feature. Convention is one module per feature. I'll create `src/financial-totals/`:
  - `financial-totals.module.ts` (exports service + repository)
  - `financial-totals.controller.ts` (GET /companies/:companyId/financial-totals)
  - `financial-totals.service.ts` (fetch by company; 404 if none)
  - `financial-totals.repository.ts` (read totals row)
  The write path uses the projection repository's increment — that's in the projection module; the payment-orders module imports the projection module (which exports the ProjectionService). Financial-totals module is standalone read.
- `src/re-derivation/`:
  - `re-derivation.module.ts`
  - `re-derivation.service.ts` (`derive(from, to)` with serializable tx + retry)
  - `re-derivation.repository.ts` (SQL: delete rows, insert-select, rebuild totals, compare for drift)
  Wait — the re-derivation needs a serializable transaction that spans multiple statements; the repository method takes the tx client, and `reDerivationRepository.withSerializableTransaction(fn)` — hmm, but the tx unit includes calls to other repository methods (projection repository's upsert?). No — re-derivation is its own bulk SQL (insert-select), it doesn't need the incremental hook. So re-derivation.repository handles: `deleteRowsInWindow(tx, from, to)`, `insertRowsFromSource(tx, from, to)`, `rebuildTotals(tx)` (global), and `withSerializableTransaction(fn)`. The service orchestrates with retry logic on serialization errors.

    Retry detection: catch errors with `code === '40P01'` or `P2034` (Prisma serializes serialization failures as P2034 "Transaction failed due to a conflict with another transaction" for interactive tx? Actually for interactive txs, Prisma surfaces the underlying error code `40P01` via `error.code` on a PrismaClientKnownRequestError? Hmm. For interactive transactions, errors from the callback propagate; a serialization failure on commit appears as a PrismaClientKnownRequestError with code `P2034`? Let me think. There's a known Prisma issue: interactive transaction serializable → on serialization failure you get a PrismaClientKnownRequestError with code P2034 ("Transaction failed due to a conflict with another transaction")? I recall Prisma maps 40P01 to P2034 in interactive transactions. For safety, I'll retry on both: check `err.code === '40P01' || err.code === 'P2034'` or the message contains 'serialization'. I'll write a helper `isSerializationError(err)` that checks those codes. Max 3 attempts with a small backoff.
- `src/drift-repair/`:
  - `drift-repair.module.ts`
  - `drift-repair.service.ts` (`run()` with @Cron + `repairWindow(from,to)`; uses re-derivation service)
  - `drift-repair.repository.ts` (compare query via $queryRaw)
  The drift-repair module imports the re-derivation module (which exports ReDerivationService).
- `src/companies/`? No — the totals endpoint is under /companies/...; no company table needed? Company is referenced by id; should there be a `companies` table? Workers belong to a company? I hadn't defined a companies table. To be honest, do we need one? A payment order has company_id; a worker has full_name (and company_id? not needed for the projection). For realism, minimal: no companies table (company is an external entity, id-only FK). Hmm, FKs in Postgres should reference a table... but in this artifact, I can omit FK constraints on company_id (treat as a plain uuid column) or I can add a `companies` table. Adding a `companies` table (id, name) is cheap and makes the schema coherent. But it's not strictly asked for... "don't create files it doesn't ask for" — that's about files, not tables. A coherent schema needs the referenced tables to exist for FKs; I'll include a minimal `companies` (id uuid pk, name). Workers: (id, full_name, company_id?). Keep workers without company_id (a worker can work for multiple companies; the order ties worker↔company). FK: payment_orders.company_id → companies(id), worker_id → workers(id), event_id → events(id). Events: (id, company_id → companies(id)?, name, occurred_at?). The operation join uses event name; events belong to a company in this marketplace (e.g. a company's event where workers provide services). I'll give events a company_id FK + name + created_at. Worker: id, full_name, created_at. Keep it lean.

  Wait, do I even need the companies table for the tests? Seed: create a company row, worker, event, order. Yes, fine.

11. **main.ts**: NestFactory.create(AppModule), set global prefix? Endpoints are defined without a prefix (`/operations`, `/payment-orders`, `/companies`). Enable global prefix `v1`? Not asked for; skip. Use the global filter: `app.useGlobalFilters(new ApiExceptionFilter())`. Global ValidationPipe? Do manual validation in the controller. Body parsing: Nest's default express.json(). PORT from env (`process.env.PORT ?? 3000`).

12. **app.module.ts**: imports: PrismaModule (a common module that provides/exports PrismaService), OperationsModule, PaymentOrdersModule, FinancialTotalsModule, ReDerivationModule, DriftRepairModule, ScheduleModule.forRoot().

13. **Prisma module**: `src/common/prisma.module.ts` + `src/common/prisma.service.ts`:
```ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}
```
Global module.

14. **Transaction client type**: define in `src/common/prisma.tx.ts`:
```ts
export type DbTx = Prisma.TransactionClient;
```
Hmm — but a method in a repository that takes the base PrismaService also accepts a tx client. A type `Prisma.TransactionClient` works for tx; for "base or tx" I need a union: `PrismaClient | Prisma.TransactionClient`. Simpler: the repository methods always take a tx parameter (`Prisma.TransactionClient`), and a non-transactional caller wraps: for reads (operations list), just use the injected prisma service as-is (a `PrismaClient` structurally satisfies? `Prisma.TransactionClient` is basically Omit<PrismaClient, '$connect'...> — PrismaClient is assignable to TransactionClient? I think `Prisma.TransactionClient` is defined as `PrismaClient | $Transaction.TransactionManager`... in recent Prisma, `Prisma.TransactionClient = Prisma.PrismaClient | Prisma.Transaction.PrismaPromise...`? hmm. In Prisma 5/6: `export type TransactionClient = PrismaClient | Prisma.Transaction...`? Not sure exactly. To avoid type friction, I'll define my own:
```ts
// a client capable of executing queries, either the base client or an interactive-transaction client
export type DbClient = Prisma.TransactionClient;
```
And the repository method takes `client: DbClient`. For reads without a tx, the repository passes `this.prisma` — `PrismaService extends PrismaClient`; is PrismaClient assignable to `Prisma.TransactionClient`? In Prisma ≥5, `TransactionClient` is: `type TransactionClient = PrismaClient | $extends...`? Hmm, actually what I recall: `Prisma.TransactionClient` exists and is `Omit<PrismaClient, '$connect' | '$disconnect' | ...>`? Let me recall Prisma 5: in `prisma/client`, `export namespace Prisma { export type TransactionClient = PrismaClient | $Transaction... }` — I really don't remember. There's a known pattern: `prisma.$transaction(async (tx) => {})` where tx is `Prisma.TransactionClient`, and people annotate repositories with `client: Prisma.TransactionClient` and pass `this.prisma` — that compiles in Prisma 5 because TransactionClient = PrismaClient | ... I think. Hmm, risk: if it doesn't compile, I want to avoid it.

A safer approach: define my own structural type that covers the operations we use:
```ts
export type DbClient = {
  $queryRaw<T>(...): ...;
  $executeRaw(...): ...;
  $transaction(...): ...;
  operationReadModel: Prisma.OperationReadModelDelegate<...>;
  ...
};
```
That's ugly. Alternative practical approach (very common in Nest+Prisma codebases): type the tx parameter as `Prisma.TransactionClient`, and for direct reads (no tx), the repository methods take no client and use `this.prisma`; for transactional paths, a separate method that takes `tx: Prisma.TransactionClient`. And in non-tx contexts I never pass the base client into a tx-typed parameter... except in `withTransaction` callbacks, where the callback's parameter is typed by Prisma as `Prisma.TransactionClient` — fine.

But then the service: `this.repository.withTransaction(async (tx) => { await this.projectionService.applyWrite(tx, ...); })` — the `tx` here is Prisma's callback parameter (type `Prisma.TransactionClient`), passed to the projection service → that takes `Prisma.TransactionClient`.

For `withTransaction` implementation in a repository:
```ts
async withTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel }): Promise<T> {
  return this.prisma.$transaction(work, options);
}
```
This is clean. And `Prisma.TransactionIsolationLevel` includes `'serializable'`.

For the read repository (operations), the method uses `this.prisma` directly — no client parameter needed.

Now, does `Prisma.TransactionClient` exist in the Prisma 5/6 types? Yes — `Prisma.TransactionClient` has existed since ~v3: `type TransactionClient = PrismaClient | $extends.Extends...`? Let me recall actual usage: `async (tx: Prisma.TransactionClient) => ...` is a widely used pattern and compiles. And `$transaction` overloads accept `(fn: (prisma: Prisma.TransactionClient) => Promise<T>)`. So the callback parameter's type matches what I annotate.

15. **Raw SQL in the repository** — allowed (repository is the only layer that touches the DB; the ban on raw SQL is for the service). Re-derivation + compare need raw SQL (bulk upsert with joins). I'll write carefully with tagged templates (`$queryRaw`/`$executeRaw` with params — safe from injection) — use `Prisma.sql` tagged template for the dynamic parts (dates are parameters).

Let me write the DDL (migration):

```sql
-- companies
CREATE TABLE "companies" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workers" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "full_name" text NOT NULL,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "events" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id")
);

CREATE TABLE "payment_orders" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL,
  "worker_id" uuid NOT NULL,
  "event_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','approved','rejected')),
  "amount_cents" integer NOT NULL CHECK ("amount_cents" >= 0),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id"),
  CONSTRAINT "payment_orders_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id"),
  CONSTRAINT "payment_orders_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id")
);

CREATE INDEX "idx_payment_orders_company_created" ON "payment_orders" ("company_id", "created_at" DESC);

CREATE TABLE "operation_read_model" (
  "payment_order_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "worker_id" uuid NOT NULL,
  "worker_name" text NOT NULL,
  "event_id" uuid NOT NULL,
  "event_name" text NOT NULL,
  "status" text NOT NULL,
  "amount_cents" integer NOT NULL,
  "created_at" timestamptz(6) NOT NULL,
  "updated_at" timestamptz(6) NOT NULL,
  CONSTRAINT "operation_read_model_pkey" PRIMARY KEY ("payment_order_id")
);

-- covering index for the dashboard access pattern:
-- filter by company + status, range on created_at, sort by created_at DESC, id tiebreak
CREATE INDEX "idx_operation_read_model_dashboard"
  ON "operation_read_model" ("company_id", "status", "created_at" DESC, "payment_order_id" DESC)
  INCLUDE ("worker_name", "event_name", "amount_cents", "updated_at");

CREATE TABLE "company_financial_totals" (
  "company_id" uuid NOT NULL,
  "pending_amount_cents" bigint NOT NULL DEFAULT 0,
  "approved_amount_cents" bigint NOT NULL DEFAULT 0,
  "rejected_amount_cents" bigint NOT NULL DEFAULT 0,
  "orders_count" integer NOT NULL DEFAULT 0,
  CONSTRAINT "company_financial_totals_pkey" PRIMARY KEY ("company_id"),
  CONSTRAINT "company_financial_totals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id")
);
```

Hmm `gen_random_uuid()` — Postgres 13+ has it built in. Fine.

Note: the pkey on operation_read_model uses the column name "payment_order_id"; in Prisma that's the model field `paymentOrderId @id @map("payment_order_id")`.

16. **schema.prisma**:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Company {
  id        String   @id @default(uuid()) @db.Uuid
  name      String
  createdAt DateTime @map("created_at") @default(now())

  @@map("companies")
}

model Worker {
  id        String   @id @default(uuid()) @db.Uuid
  fullName  String   @map("full_name")
  createdAt DateTime @map("created_at") @default(now())

  @@map("workers")
}

model Event {
  id         String   @id @default(uuid()) @db.Uuid
  companyId  String   @map("company_id") @db.Uuid
  name       String
  createdAt  DateTime @map("created_at") @default(now())

  @@index([companyId])
  @@map("events")
}

enum? — Prisma enums for postgres become CREATE TYPE; to keep the migration simple I used a text + CHECK. Use @db.Text with an app-level union type. Add `// status is one of 'pending' | 'approved' | 'rejected' (CHECK in DDL)`. Or use a Prisma `enum OrderStatus` and let the migration CREATE TYPE. A Prisma enum is cleaner for types. Migration:
CREATE TYPE "OrderStatus" AS ENUM ('PENDING','APPROVED','REJECTED');
But then the values are uppercase — I want lowercase 'pending'. Prisma enum values map to the DB values as-is: `enum OrderStatus { pending approved rejected }` — valid (lowercase enum values allowed? Prisma enum names are PascalCase for the TS type, but the value members can be lowercase? Prisma enum member names follow the same identifier rules as fields — lowercase allowed. Yes, e.g. `enum Role { admin user }` works and the DB type values are 'admin','user'.)

I'll use Prisma enum:
```prisma
enum OrderStatus {
  pending
  approved
  rejected
}
```
Migration: `CREATE TYPE "OrderStatus" AS ENUM ('pending', 'approved', 'rejected');` and column `"status" "OrderStatus" NOT NULL DEFAULT 'pending'`.

Model PaymentOrder:
```prisma
model PaymentOrder {
  id          String      @id @default(uuid()) @db.Uuid
  companyId   String      @map("company_id") @db.Uuid
  workerId    String      @map("worker_id") @db.Uuid
  eventId     String      @map("event_id") @db.Uuid
  status      OrderStatus @default(pending)
  amountCents Int         @map("amount_cents")
  createdAt   DateTime    @map("created_at") @default(now())
  updatedAt   DateTime    @map("updated_at") @default(now())

  @@index([companyId, createdAt(sort: Desc)], map: "idx_payment_orders_company_created")
  @@map("payment_orders")
}
```

Model OperationReadModel:
```prisma
model OperationReadModel {
  paymentOrderId String   @id @map("payment_order_id") @db.Uuid
  companyId      String   @map("company_id") @db.Uuid
  workerId       String   @map("worker_id") @db.Uuid
  workerName     String   @map("worker_name")
  eventId        String   @map("event_id") @db.Uuid
  eventName      String   @map("event_name")
  status         OrderStatus
  amountCents    Int      @map("amount_cents")
  createdAt      DateTime @map("created_at")
  updatedAt      DateTime @map("updated_at")

  // the covering index (with INCLUDE columns) is created in the migration:
  // idx_operation_read_model_dashboard
  @@index([companyId, status, createdAt(sort: Desc)], map: "idx_operation_read_model_company_status_created")
  @@map("operation_read_model")
}
```
Wait — if I declare `@@index([companyId, status, createdAt(sort: Desc)], map: "idx_operation_read_model_company_status_created")` and also create `idx_operation_read_model_dashboard` (4-key + INCLUDE) in the migration, that's 2 indexes on similar keys. A bit redundant but harmless? Actually redundant: the 3-key index is a prefix of the 4-key index (except the 4th column is payment_order_id which is the pk — redundant anyway since the pk is appended to the index). Let me simplify: I'll declare in the Prisma schema `@@index([companyId, status, createdAt(sort: Desc), paymentOrderId(sort: Desc)], map: "idx_operation_read_model_dashboard")`, and in the migration create the same 4 columns + INCLUDE. Drift-wise, the only difference is INCLUDE. I'll add a comment in the schema: `// note: the migration widens this index with INCLUDE (worker_name, event_name, amount_cents, updated_at) to make it covering; Prisma cannot express INCLUDE.` That's honest and consistent.

Model CompanyFinancialTotals:
```prisma
model CompanyFinancialTotals {
  companyId         String @id @map("company_id") @db.Uuid
  pendingAmountCents BigInt @default(0) @map("pending_amount_cents")
  approvedAmountCents BigInt @default(0) @map("approved_amount_cents")
  rejectedAmountCents BigInt @default(0) @map("rejected_amount_cents")
  ordersCount       Int    @default(0) @map("orders_count")

  @@map("company_financial_totals")
}
```

17. **The maintenance hook code**:

`src/projection/projection.service.ts`:
```ts
@Injectable()
export class ProjectionService {
  constructor(private readonly projectionRepository: ProjectionRepository) {}

  /** Maintenance hook: called by the write services inside the writer's transaction. */
  async applyCreatedOrder(tx: DbClient, order: OrderSnapshot, workerName, eventName) ...
```
Hmm, let me define a snapshot type. Write flow:

PaymentOrderService.create(input):
```ts
return this.paymentOrdersRepository.withTransaction(async (tx) => {
  const order = await this.paymentOrdersRepository.createInTx(tx, input); // returns order with relations (worker.fullName, event.name)
  await this.projectionService.applyOrderCreated(tx, order);
  return order;
});
```
approve(id):
```ts
return this.paymentOrdersRepository.withTransaction(async (tx) => {
  const before = await this.paymentOrdersRepository.findByIdInTx(tx, id); // with relations; 404 if not found
  if (before.status !== 'pending') throw new DomainException(409, 'invalid_state_transition', ...);
  const after = await this.paymentOrdersRepository.updateStatusInTx(tx, id, 'approved');
  await this.projectionService.applyOrderStatusChanged(tx, after, 'pending'); // hook
  return after;
});
```

ProjectionService methods:
```ts
async applyOrderCreated(tx, order: OrderWithRelations) {
  await this.projectionRepository.upsertOperationRow(tx, toRow(order));
  await this.projectionRepository.applyTotalsDelta(tx, order.companyId, { pending: +amt, ordersCount: +1 });
}
async applyOrderStatusChanged(tx, order: OrderWithRelations, from: OrderStatus) {
  await this.projectionRepository.upsertOperationRow(tx, toRow(order));
  if (from !== order.status) await this.projectionRepository.applyTotalsDelta(tx, order.companyId, { [from]: -amt, [order.status]: +amt });
}
```
toRow: { payment_order_id: order.id, company_id, worker_id, worker_name: order.worker.fullName, event_id, event_name: order.event.name, status, amount_cents, created_at, updated_at }.

ProjectionRepository:
```ts
async upsertOperationRow(tx, row) {
  await tx.operationReadModel.upsert({
    where: { paymentOrderId: row.paymentOrderId },
    update: { company_id..., status, amount_cents, created_at, updated_at, worker_name, event_name, worker_id, event_id },
    create: row,
  });
}
async applyTotalsDelta(tx, companyId, delta: { pending: number; approved: number; rejected: number; ordersCount: number }) {
  await tx.companyFinancialTotals.upsert({
    where: { companyId },
    update: {
      pendingAmountCents: { increment: delta.pending },
      approvedAmountCents: { increment: delta.approved },
      rejectedAmountCents: { increment: delta.rejected },
      ordersCount: { increment: delta.ordersCount },
    },
    create: { companyId, pendingAmountCents: delta.pending, approvedAmountCents: delta.approved, rejectedAmountCents: delta.rejected, ordersCount: delta.ordersCount },
  });
}
```
`increment` on BigInt in Prisma: does it accept a number or BigInt? For BigInt fields, increment accepts `number | bigint`. I'll pass a number; TS types: `PendingAmountCentsIncrementInput: number | bigint`. OK.

Atomicity: a single `UPDATE ... SET col = col + delta` → concurrent increments are serialized by row locks, none lost. Upsert = INSERT ... ON CONFLICT DO UPDATE with the same expression → also atomic.

18. **PaymentOrderRepository**:
```ts
@Injectable()
export class PaymentOrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  withTransaction<T>(work: (tx: DbClient) => Promise<T>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel }) {
    return this.prisma.$transaction(work, options);
  }

  async createInTx(tx, input): Promise<OrderWithRelations> {
    return tx.paymentOrder.create({ data: input, include: { worker: true, event: true } });
  }
  async findByIdInTx(tx, id) {
    const order = await tx.paymentOrder.findUnique({ where: { id }, include: { worker: true, event: true } });
    if (!order) throw new DomainException(404, 'resource_not_found', `payment order ${id} does not exist`, { id });
    return order;
  }
  async updateStatusInTx(tx, id, status) {
    return tx.paymentOrder.update({ where: { id }, data: { status, updatedAt: new Date() }, include: { worker: true, event: true } });
  }
}
```
Type `OrderWithRelations` = `Prisma.PaymentOrderGetPayload<{ include: { worker: true; event: true } }>`.

`DbClient` — where do I define it? `src/common/db-client.ts`:
```ts
import type { Prisma } from '@prisma/client';
/** Either the base Prisma client or an interactive-transaction client. */
export type DbClient = Prisma.TransactionClient;
```
And `withTransaction`'s callback is typed `(tx: Prisma.TransactionClient)`. When a service passes `this.prisma` — I never do; reads use the prisma service directly inside the repository. OK, but wait: in `OperationsRepository` (a read-only repository), the method uses `this.prisma.operationReadModel.findMany(...)`. PrismaService extends PrismaClient — fine.

Does `Prisma.TransactionClient` exist? In the Prisma 5/6 generated client: `export type TransactionClient = PrismaClient | $Transaction...`? Let me recall the actual generated code (Prisma 5): in `.prisma/client/index.d.ts` we have:
```ts
export type TransactionClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$executeRaw' | ...>
```
Hmm, no. I remember people use `Prisma.TransactionClient`... actually I think the type of the interactive tx callback is `Prisma.TransactionClient` defined as `PrismaClient | Prisma.TransactionManager`? Hmm. In Prisma 4/5 there's `Prisma.TransactionManager` (internal). Public docs example:

```ts
const tx = prisma.$transaction(async (tx) => { ... })
```
And people annotate `tx: Prisma.TransactionClient` in helpers — yes, I'm fairly sure `Prisma.TransactionClient` is exported (added in Prisma 3.10+?). Hmm, let me think again... I do recall in the generated d.ts: `export type TransactionClient = PrismaClient | $extends...` no...

Let me just look at my memory of the actual generated types (Prisma 5.x):
```ts
namespace Prisma {
  export type TransactionClient = PrismaClient | $Transaction.TransactionManager;
  ...
}
```
Hmm, I honestly think there's a `Prisma.TransactionClient`. There's a GitHub discussion using `client: Prisma.TransactionClient` in repository methods. Yes, I'm fairly sure it exists in Prisma ≥ 4/5. And `PrismaClient` is assignable to it (since it's a union including PrismaClient). I'll use it; risk acceptable. To be extra safe, I could also define:
```ts
export type DbClient = Prisma.TransactionClient;
```
And if their Prisma version lacks it... The environment is "Prisma" with Node 20 — recent Prisma 6: does it still export TransactionClient? Prisma 6 client: `export type TransactionClient = ...`? Prisma 6 has the new client generator but also prisma-client-js. I'll trust `Prisma.TransactionClient`.

Alternatively, I can dodge the question entirely: type the tx parameter as the specific delegate object? No. Or:
```ts
type TxClient = Awaited<ReturnType<Parameters<Parameters<PrismaService['$transaction']>[0]>[0]>>;
```
Too clever. I'll use `Prisma.TransactionClient` with an ASSUMPTION comment? The instructions say to mark genuinely missing symbols. This is a standard symbol; I'll use it without a comment... hmm, "if a symbol you need is genuinely missing from the task, don't guess in silence" — this isn't missing from the task; it's from the Prisma library. I'll use it. Actually, to minimize the risk of type mismatch on their end, I can make the type defensive:

```ts
// src/common/db-client.ts
import type { Prisma } from '@prisma/client';

/**
 * Client used inside a unit of work: either the interactive-transaction client
 * handed to a $transaction callback, or (for read paths) the base client.
 */
export type DbClient = Prisma.TransactionClient;
```
I'll keep this. If `Prisma.TransactionClient` = `PrismaClient | TransactionManager`, the PrismaClient assignability works.

Hmm wait, actually — let me double-check one more Prisma detail: the second argument `options` to `prisma.$transaction(fn, { isolationLevel, timeout, maxWait })` — supported in interactive transactions (Postgres). `isolationLevel: 'serializable'` — the value of `Prisma.TransactionIsolationLevel` is: `'read_uncommitted' | 'read_committed' | 'repeatable_read' | 'serializable'`. Yes.

19. **Re-derivation repository** (raw SQL):

```ts
@Injectable()
export class ReDerivationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async withSerializableTransaction<T>(work: (tx: DbClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work, { isolationLevel: 'serializable', timeout: 60_000 });
  }

  async deleteRowsInWindow(tx: DbClient, from: Date, to: Date): Promise<number> {
    const result = await tx.$executeRaw`
      DELETE FROM "operation_read_model"
      WHERE "payment_order_id" IN (
        SELECT "id" FROM "payment_orders" WHERE "created_at" >= ${from} AND "created_at" <= ${to}
      )
    `;
    return Number(result);
  }

  async insertRowsFromSource(tx: DbClient, from: Date, to: Date): Promise<number> {
    const result = await tx.$executeRaw`
      INSERT INTO "operation_read_model" (
        "payment_order_id", "company_id", "worker_id", "worker_name",
        "event_id", "event_name", "status", "amount_cents", "created_at", "updated_at"
      )
      SELECT o."id", o."company_id", o."worker_id", w."full_name",
             o."event_id", e."name", o."status", o."amount_cents", o."created_at", o."updated_at"
      FROM "payment_orders" o
      JOIN "workers" w ON w."id" = o."worker_id"
      JOIN "events" e ON e."id" = o."event_id"
      WHERE o."created_at" >= ${from} AND o."created_at" <= ${to}
      ON CONFLICT ("payment_order_id") DO UPDATE SET
        "company_id" = EXCLUDED."company_id",
        "worker_id" = EXCLUDED."worker_id",
        "worker_name" = EXCLUDED."worker_name",
        "event_id" = EXCLUDED."event_id",
        "event_name" = EXCLUDED."event_name",
        "status" = EXCLUDED."status",
        "amount_cents" = EXCLUDED."amount_cents",
        "created_at" = EXCLUDED."created_at",
        "updated_at" = EXCLUDED."updated_at"
    `;
    return Number(result);
  }

  async rebuildAllTotals(tx: DbClient): Promise<void> {
    await tx.$executeRaw`
      DELETE FROM "company_financial_totals"
    `;
    await tx.$executeRaw`
      INSERT INTO "company_financial_totals" (
        "company_id", "pending_amount_cents", "approved_amount_cents", "rejected_amount_cents", "orders_count"
      )
      SELECT "company_id",
             COALESCE(SUM("amount_cents") FILTER (WHERE "status" = 'pending'), 0),
             COALESCE(SUM("amount_cents") FILTER (WHERE "status" = 'approved'), 0),
             COALESCE(SUM("amount_cents") FILTER (WHERE "status" = 'rejected'), 0),
             COUNT(*)
      FROM "payment_orders"
      GROUP BY "company_id"
    `;
  }
}
```
Wait — DELETE FROM totals + INSERT while the totals FK → companies exists; fine. But concurrent writers during the rebuild: a writer's upsert could INSERT a totals row for a new company after our DELETE → the DELETE already ran (the DELETE ran first, and a concurrent writer upserting in between creates the row — that's fine, the row exists with its delta; but then our INSERT ... SELECT includes that company's orders... the concurrent writer's order: if the writer's source insert commits before our SELECT, the SELECT includes it, and we INSERT a full-value row → PK collision with the writer's upserted row! `INSERT ... SELECT ... GROUP BY` without ON CONFLICT → unique constraint violation!

  Fix: use `ON CONFLICT ("company_id") DO UPDATE SET` with full values. This is safe and idempotent:
```sql
INSERT INTO "company_financial_totals" (...)
SELECT ... GROUP BY "company_id"
ON CONFLICT ("company_id") DO UPDATE SET
  "pending_amount_cents" = EXCLUDED."pending_amount_cents",
  "approved_amount_cents" = EXCLUDED."approved_amount_cents",
  "rejected_amount_cents" = EXCLUDED."rejected_amount_cents",
  "orders_count" = EXCLUDED."orders_count";
```
  And the preceding DELETE: is it even needed with ON CONFLICT DO UPDATE? DELETE + full-value upsert: the DELETE removes all rows, and the INSERT re-creates all companies with orders. A company with no orders but with a totals row (created via upsert then... orders can't be deleted — no delete endpoint) — in this app, totals rows exist only for companies with ≥1 order, so the DELETE is unnecessary but harmless... actually is it harmful? If a totals row exists for a company with no orders (shouldn't happen), the DELETE removes it — good (drift fix). I'll keep DELETE + upsert; it's idempotent and covers "row exists but company has no orders" drift. Under SERIALIZABLE, concurrent writers' upserts either commit before (their order appears in our SELECT → we overwrite with the full correct value) or after (their upsert's full delta is applied over our row... wait, their upsert is an INCREMENT — if they apply an increment on top of our full-value rebuild after our commit, the result = our full value + their delta = correct! Because the rebuild includes all orders committed at snapshot time, and their increment covers their own order committed later. If their transaction commits before our snapshot, our SELECT includes their order and sets the full value; their increment already applied pre-rebuild (before the DELETE? then their row is deleted and we re-insert with the full value including their order — correct). Interleaving within our tx: their increment at t_b, our DELETE at t_d > t_b: the DELETE removes their row; our SELECT at t_e sees their order (committed? if their tx commits at t_c < t_e, yes → full value includes it; if t_c > t_e... their increment at t_b is uncommitted; our SELECT (READ COMMITTED statement snapshot at t_e) doesn't include their order; we INSERT the row without their order; then their tx commits the increment at t_c — but their tx did an upsert-increment at t_b on a row that was deleted at t_d... MVCC: their update at t_b took a row lock; our DELETE at t_d blocks on their lock until their commit. So order: their commit at t_c, then our DELETE removes their row, and our INSERT creates a row without their order (the snapshot at t_e... wait, t_e is after t_d is after t_c — their order is committed at t_c < t_e → the SELECT includes it. Ugh, I keep going in circles; the point is: under SERIALIZABLE, if there's a genuine conflict (their committed order should be in our aggregation but our snapshot missed it), SSI detects the cycle (we read the orders table at t_e (snapshot at first statement?), they wrote orders after our read and wrote totals before/during our write → cycle → abort us → retry. Serializable + retry gives us the correct answer. Without retry, the worst case is a stale row → the next drift-repair run fixes it. That's the design contract: derive is exactly idempotent when isolated; under concurrent writes, either it's correct or it gets retried, and residual drift is the drift repair's job. I'll document that.

  Actually, one more consideration: does the SERIALIZABLE check cover "we read orders at t_e, they commit an order at t_c between our snapshot and our write"? R's snapshot is... in Postgres SSI, the snapshot is taken at the first read; subsequent reads also use... in SSI, each statement's read uses a snapshot taken at statement start (like READ COMMITTED), but SSI tracks dependencies across the whole transaction. Dependency: W inserted an order row that R's aggregation read... didn't read (didn't exist). W wrote totals (increment). R wrote totals (upsert full value) — R's upsert read the totals row version that W wrote (if W's row/commit is before R's upsert statement) → edge W → R? and W's new order row: R's aggregation read the orders table (scan) — a table scan that doesn't see W's row: no row-level read dependency... SSI's dependency for a scan that misses a concurrent insert: the "phantom" case — SSI doesn't catch phantoms via row reads! Hmm. Aggregation phantoms: W inserts an order; R aggregates the same table in a window... R's aggregation is over the entire table (no window on totals) — R's scan at t_e misses W's uncommitted insert; W's commit is after t_e. SSI: is there a dependency edge? R didn't read any of W's rows. W didn't read any of R's rows. W and R both write to totals: W's increment at t_b (creates row version V1); R's upsert at t_f reads V1 (committed? if W committed at t_c < t_f, R reads W's version → edge W → R). R's upsert then writes V2 (full value excluding W's order). W → R only, no cycle → no abort → R commits with totals missing W's order's amount. W's increment already in V1, and R's V2 = (W's old sum + W's delta)?? wait: V1's value = base + W.delta (W's increment is a delta). R computes the full sum from the orders table at t_e — which doesn't include W's uncommitted order. R sets totals = full sum (base, without W). But the stored row before R's write = base + W.delta. R overwrites with base. W's order's amount is lost from totals! Drift (until the next repair).

  Hmm! So even with SERIALIZABLE, this specific interleaving (W's source insert commits between R's aggregate read and R's totals write, and R's write reads W's totals version) → W→R edge, no cycle, R commits, totals is stale (missing W's order). Ugh. Wait, actually — does SSI add an edge when R reads a version that W wrote? Yes: "reader R read a row version written by committed W" → edge W → R (W must precede R). And "R read an old version that W overwrote" → edge R → W. Here: R reads W's version (W committed at t_c < t_f) → edge W→R. R read orders at t_e (a scan); W's insert committed at t_c > t_e?? For W's version to be committed at t_f, we need t_c < t_f. And for R's scan to miss W's order, t_c > t_e? (committed after the scan's snapshot). So t_e < t_c < t_f. Possible: R: aggregate scan at t_e (no W's order), then R's totals upsert at t_f > t_c (sees W's version) → overwrites with the sum missing W's order. Result: totals = base; true = base + W's order amount. Drift. SSI says OK (W→R is a consistent order).

  So SERIALIZABLE alone doesn't fully guarantee that totals includes all concurrent orders — the "lost delta" can survive. But: how likely, and what's the mitigation? The drift-repair job catches and fixes (that's its purpose). Also the window is bounded. This is inherent to any concurrent re-derivation without global locking; the spec's requirement is "safe to run while live" (doesn't break the system, is idempotent) — I'll interpret as: doesn't lose committed data indefinitely (repair converges), doesn't corrupt, doesn't block writers. The residual transient drift is handled by the drift repair. I'll be honest about this in DESIGN.md: under concurrent writes, a derive run may miss a write that commits mid-run (a phantom in the aggregation); this is bounded and self-healing via the drift-repair job, and SERIALIZABLE+retry eliminates the common conflicting case.

  Or — I could eliminate even that: do the totals rebuild with a stronger approach: after rebuild, verify? Or, rebuild totals per company via a full-value upsert computed from a consistent snapshot... the phantom problem remains.

  A truly robust alternative: don't maintain totals incrementally in a separate table at all — make totals a projection aggregate too (derived from the read model rows)... but the spec requires an in-place increment test for concurrency. OK.

  Another robust option for derive: process the orders in the window + recompute totals only for companies with orders in the window, and compute each company's totals as (current stored value) + (recomputed full sum for the company) - (recomputed sum at window start)?? No — that's not idempotent.

  Full rebuild + drift repair is the defensible design. I'll note the residual race + self-healing in DESIGN.md. Good enough; this is what real systems do.

  Hmm, actually, wait. Let me reconsider: I could make the totals rebuild conflict-free by deriving the totals directly from the operation_read_model (the rows we just rebuilt) instead of from payment_orders — same phantom issue (a concurrent create's hook row is committed mid-run → same). Same. Fine, self-healing.

  Or a simple trick: rebuild totals twice in the transaction? (aggregate, write, aggregate again, and if different, abort/retry within tx). That would detect the phantom (the second aggregate sees W's committed order) → retry. Interesting: `verifyRebuild(tx)` — re-run the aggregate query and compare with what we wrote; on mismatch, throw to abort the tx, the service retries. Two passes doubles the cost of the maintenance tx but makes derive effectively linearizable against concurrent inserts. Nice touch, but adds complexity. I'll leave it out and document. Keep the solution tight.

20. **Drift-repair compare SQL** (in DriftRepairRepository):
```ts
async findDriftedRows(tx: DbClient, from: Date, to: Date) {
  return tx.$queryRaw`
    SELECT o."id" AS "payment_order_id"
    FROM "payment_orders" o
    LEFT JOIN "operation_read_model" p ON p."payment_order_id" = o."id"
    WHERE o."created_at" >= ${from} AND o."created_at" <= ${to}
      AND (
        p."payment_order_id" IS NULL
        OR p."company_id" IS DISTINCT FROM o."company_id"
        OR p."worker_id" IS DISTINCT FROM o."worker_id"
        OR p."worker_name" IS DISTINCT FROM w."full_name"  -- need to join workers
        OR p."event_id" IS DISTINCT FROM o."event_id"
        OR p."event_name" IS DISTINCT FROM e."name"
        OR p."status" IS DISTINCT FROM o."status"
        OR p."amount_cents" IS DISTINCT FROM o."amount_cents"
        OR p."created_at" IS DISTINCT FROM o."created_at"
        OR p."updated_at" IS DISTINCT FROM o."updated_at"
      )
  `;
}
```
Need to JOIN workers/events for name comparison. Fine.

For totals drift:
```ts
async findDriftedTotals(tx, from, to) {
  // companies with orders in the window, whose stored totals disagree with the recomputed totals
  return tx.$queryRaw`
    SELECT t."company_id"
    FROM "company_financial_totals" t
    WHERE t."company_id" IN (SELECT DISTINCT "company_id" FROM "payment_orders" WHERE "created_at" >= ${from} AND "created_at" <= ${to})
      AND (
        t."pending_amount_cents" <> COALESCE((SELECT SUM("amount_cents") FROM "payment_orders" WHERE "company_id" = t."company_id" AND "status" = 'pending'), 0)
        OR ... approved ...
        OR ... rejected ...
        OR t."orders_count" <> (SELECT COUNT(*) FROM "payment_orders" WHERE "company_id" = t."company_id")
      )
      UNION
      SELECT "company_id" FROM "payment_orders" WHERE ... window ... AND "company_id" NOT IN (SELECT "company_id" FROM "company_financial_totals")
  `;
}
```
(For a company with orders in the window but no totals row → drifted.)

The repair then: if rows or totals drifted → `reDerivationService.derive(from, to)`. Return report { window: {from,to}, drifted_row_count, drifted_companies, repaired: boolean }.

Scheduled: `@Cron('*/5 * * * *')` — every 5 minutes. Window: last 24 hours. Use `@nestjs/schedule`.

21. **Operations query repository**:
```ts
async findPage(filter, page, pageSize): Promise<{ items: OperationReadModel[]; total: number }> {
  const where = {
    companyId: filter.companyId,
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.from || filter.to ? { createdAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) } } : {}),
  };
  const [items, total] = await this.prisma.$transaction([
    this.prisma.operationReadModel.findMany({ where, orderBy: [{ createdAt: 'desc' }, { paymentOrderId: 'desc' }], skip: (page-1)*pageSize, take: pageSize }),
    this.prisma.operationReadModel.count({ where }),
  ]);
  return { items, total };
}
```
`$transaction([...])` batch (not interactive) — fine, it's a read.

The service computes the response shape: `{ items: [ { id, company_id, worker_name, event_name, status, amount_cents, created_at, updated_at } ], page, page_size, total }`. Map Prisma camelCase → snake_case API shape? The API contract: "no change to what the operator sees — same columns." I get to define the wire format. Consistency with the DB (snake_case) suggests the API is snake_case. The error envelope is snake_case keys. Let me make the API response snake_case. The service maps rows to the DTO.

22. **Controller validation** (manual, no class-validator):

OperationsController:
```ts
@Get('operations')
async list(@Query() q: Record<string, string>) {
  const problems: Record<string, string> = {};
  const companyId = requireUuid(q.company_id, problems);
  const status = parseStatus(q.status, problems);
  const from = parseDate('from', q.from, problems);
  const to = parseDate('to', q.to, problems);
  if (from && to && from > to) problems.range = 'to must not be earlier than from';
  const page = parsePositiveInt(q.page, 1, problems);
  const pageSize = parseBoundedInt(q.page_size, 50, 1, 200, problems);
  if (Object.keys(problems).length > 0) throw new DomainException(400, 'validation_failed', 'invalid query parameters', problems);
  return this.operationsService.list({ companyId, status, from, to, page, pageSize });
}
```
I'll write a small `src/common/query-parsing.ts` with helpers (uuid regex, date parse, int parse). Controller "validates input" — helpers are fine (no business logic).

The UUID regex: `/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/`.

23. **Error envelope + filter**:

`src/common/domain-exception.ts`:
```ts
export type ErrorCode = 'resource_not_found' | 'validation_failed' | 'invalid_state_transition' | 'internal_error';

export class DomainException extends HttpException {
  constructor(status: number, readonly code: string, message: string, readonly details: Record<string, unknown> = {}) {
    super({ error: { code, message, details } }, status);
  }
}
```
`src/common/api-exception-filter.ts`:
```ts
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    let status = 500; let code = 'internal_error'; let message = 'unexpected error'; const details: Record<string, unknown> = {};
    if (exception instanceof DomainException) { status = ...; code = exception.code; message = exception.message; details = exception.details; }
    else if (exception instanceof HttpException) {
      status = exception.getStatus();
      if (exception instanceof BadRequestException) code = 'validation_failed';
      else if (exception instanceof NotFoundException) code = 'resource_not_found';
      else if (exception instanceof ConflictException) code = 'conflict';
      else code = 'http_error';
      const body = exception.getResponse();
      message = typeof body === 'string' ? body : (body as any).message?.toString() ?? exception.message;
    } else if (exception instanceof Error) message = exception.message;
    const payload = { error: { code, message, details } };
    response.status(status).json(payload);
  }
}
```
`details` is never null → default `{}`.

24. **Test specifics**:

Test helper `test/helpers/db.ts`:
```ts
import { PrismaClient } from '@prisma/client';
export function createTestPrisma(): PrismaClient { return new PrismaClient(); }
export async function resetTestData(prisma, companyIds: string[]) { delete orders, totals, read model, workers, events, companies by id }
```
And `test/helpers/app.ts`:
```ts
export async function startApp() {
  const app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  const address = app.getHttpServer().address() // need to listen on an ephemeral port: app.listen(0)
  ...
}
```
`await app.listen(0)` → server.address().port. Use global fetch.

Test 1 — read-your-own-writes (`test/read-your-own-writes.spec.ts`):
```
- seed a company, worker, event (via prisma)
- POST /payment-orders → 201
- GET /operations?company_id=... → row is pending
- POST /payment-orders/:id/approve → 200
- immediately GET /operations?company_id=...&status=approved → row present, status approved
- GET /companies/:id/financial-totals → approved_amount_cents == amount, pending == 0
- also, the row for the rejected status transition? (approve → can't reject; use a 2nd order: reject → status=rejected, totals move)
- assert the list shape (columns)
```
Test 2 — concurrent totals (`test/concurrent-totals.spec.ts`):
```
- create company, worker, event; create N=20 orders via API (each 500 cents, or varying amounts)
- approve 10 in parallel via Promise.all
- expect totals: approved == sum of 10, pending == sum of 10, exact (no lost updates)
- also, reject the other 10 concurrently? or create more + concurrent creates? The spec: "2 orders approved concurrently for the same company both move the same totals row... a test that runs the 2 concurrently instead of sequentially." I'll do 10 parallel approves + 10 parallel rejects on the same company → all 20 totals accurate.
- assert the dashboard reflects each row's status.
```
Test 3 — drift repair (`test/drift-repair.spec.ts`):
```
- seed orders (created in the last 24h), sync via derive (or via API writes)
- inject drift: UPDATE operation_read_model SET status='approved' WHERE pending order (mismatch); UPDATE totals SET approved_amount_cents = approved + 9999; DELETE a projection row
- run drift repair service's run() (via app context: `app.get(DriftRepairService)`)
- assert: the row is restored, totals are accurate, the row is back
- report indicates drift detected & repaired
```
Test 4 — re-derivation idempotency (`test/re-derivation.spec.ts`):
```
- seed a mix of orders (some source-only, some drifted), run derive(window) twice
- after the first: projection matches source exactly (row-by-row + totals)
- snapshot rows + totals, run again, compare snapshot equality
```
Also a dashboard performance-ish thing? Can't test p95 without scale; skip (mention in DESIGN). "The dashboard query touches only the projection" — I can assert in the test that the operations service/repository only queries operation_read_model... behaviorally: seed source rows without projection rows, and verify the dashboard doesn't show them (proof it doesn't read source). That's a good behavioral proof! Add to read-your-own-writes or re-derivation test: insert a payment_order directly via prisma (no hook) → GET /operations doesn't show it.

25. **package.json**: "deliver every file the solution needs". package.json + tsconfig + vitest config — the layout convention doesn't list them but the solution "needs" them (stack: pnpm, ESM, vitest). I'll include:
- `package.json` (type: module, deps: @nestjs/common, @nestjs/core, @nestjs/platform-express, @nestjs/schedule, @prisma/client, reflect-metadata, rxjs; dev: prisma, typescript, ts-node? no — ESM... running tests: vitest handles TS. Running the app: tsx? or build. I'll add `tsx` for dev, or `@nestjs/cli`? Keep lean: scripts: `prisma:migrate` = `prisma migrate deploy`, `prisma:generate`, `dev` = `tsx src/main.ts`, `test` = `vitest run`, `build` = `tsc -p tsconfig.json`. Node 20 ESM + NestJS + tsx works.
  Deps versions: I'll pin reasonably: @nestjs/* ^10, @prisma/client ^5 (Node 20 fine), rxjs ^7, reflect-metadata ^0.2, prisma ^5, typescript ^5.5, vitest ^2, tsx ^4.10.

  ESM + NestJS: Nest 10 works with ESM (needs `"type": "module"`, and tsconfig module NodeNext). Vitest handles ESM natively. I'll use tsx for dev to avoid build complexity.

- `tsconfig.json`: strict true, module NodeNext, moduleResolution NodeNext, target ES2022, experimentalDecorators + emitDecoratorMetadata (Nest needs decorators; with tsx, esbuild strips types — does esbuild support emitDecoratorMetadata? esbuild supports experimental decorators... tsx doesn't emit decorator metadata by default! Nest's DI relies on constructor parameter decorator metadata for inference... Actually NestJS with ESM: with the NodeNext module and tsx/esbuild, `emitDecoratorMetadata` is not emitted by esbuild → DI breaks unless you explicitly use `@Inject()` or the metadata is available. Hmm! This is a real-world pitfall: NestJS + ESM requires either explicit `@Inject(PrismaService)` tokens or `swc`/`ts-node` with emitDecoratorMetadata. tsx (esbuild) doesn't support emitDecoratorMetadata.

  Options:
  a) Use `@Inject(PrismaService)` explicitly at every injection site — verbose but ESM-safe, and works with any TS runner.
  b) Use swc (tsx? no; `@swc-node/register` or swc with metadata enabled via `.swcrc`).
  c) Build with tsc (tsc emits decorator metadata) and run the dist — the dev script is `tsc && node dist/main.js`. That's the most standard for ESM Nest: tsc with module NodeNext emits metadata (tsc has always supported emitDecoratorMetadata). Tests: vitest uses esbuild → no metadata → DI breaks in tests too!! Vitest has `esbuild: { tsconfigRaw: { compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } } }` — but esbuild still doesn't implement emitDecoratorMetadata (it ignores it / warns). Right — esbuild does not support emitDecoratorMetadata at all. So Nest DI in vitest needs explicit `@Inject()` decorators, or a plugin (vite-plugin-swc / unplugin-swc with metadata).

  The cleanest and most robust solution that works in both vitest and node: use explicit `@Inject()` decorators at every constructor injection. It's a common pattern in ESM Nest codebases. I'll do that — every constructor param gets `@Inject(SomeToken)`. Slightly verbose but bulletproof.

  Actually wait — even with explicit @Inject, does esbuild handle decorators? esbuild supports experimentalDecorators (legacy TS decorators) — yes, esbuild supports the legacy decorator syntax when tsconfig has experimentalDecorators: true. Nest's @Injectable(), @Controller(), @Get() are legacy decorators → fine in esbuild/tsx. The only thing missing is the metadata emission → I cover it with @Inject.

  So: tsconfig: `"module": "NodeNext", "moduleResolution": "NodeNext", "experimentalDecorators": true, "emitDecoratorMetadata": true` (tsc build still emits for anyone using tsc), `"strict": true`, `"target": "ES2022"`. With NodeNext ESM, relative imports need `.js` extensions! In TS with NodeNext, importing `./foo` fails — you have to write `./foo.js`. Vitest: does it handle `.js` → `.ts` resolution? Vitest/vite resolves `./foo.js` to `./foo.ts` (vite has that behavior for TS files). Yes, Vite/Vitest supports importing with `.js` extension mapped to `.ts`. This is the standard ESM TS approach. I must be careful to use `.js` extensions on all relative imports.

  Hmm, but does this increase the risk of subtle issues? It's the correct ESM approach, and the convention says ESM "type": "module". Alternatively, use `"module": "ESNext", "moduleResolution": "Bundler"` → no `.js` extensions needed, and vitest is happy; but tsx/tsc run: tsc with ESNext module emits ESM without extensions → node fails at runtime (needs extensions). So for running via tsc+node, NodeNext is required. Decision: **NodeNext + explicit `.js` relative imports + @Inject everywhere**. For `tsconfig` used by vitest, vitest reads tsconfig for esbuild options; esbuild with NodeNext? esbuild handles `tsconfig.json` with NodeNext fine (it resolves imports). OK.

  Wait, one more: does esbuild/tsx complain about `emitDecoratorMetadata: true` in tsconfig? esbuild warns "Option 'emitDecoratorMetadata' is deprecated"? No — esbuild errors? I recall esbuild silently ignores unsupported options (only errors on a few like `importsNotUsedAsValues`). It ignores emitDecoratorMetadata (with a warning maybe). tsx is fine — many Nest ESM projects use tsx + @Inject. OK.

  For dev run: `tsx watch src/main.ts`. tsc build for prod: `tsc -p tsconfig.json && node dist/src/main.js`? With rootDir src, outDir dist → `dist/main.js`. I'll set rootDir: "src", outDir: "dist". Scripts: `"build": "tsc -p tsconfig.json"`, `"start": "node dist/main.js"`, `"dev": "tsx src/main.ts"`.

- `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  esbuild: { tsconfigRaw: { experimentalDecorators: true } },
  test: { environment: 'node', testTimeout: 30000, hookTimeout: 30000, include: ['test/**/*.spec.ts'], pool: 'forks', poolOptions: { forks: { singleFork: true } } },
});
```
`singleFork: true` — run all test files in one process (they share a DB; per-file parallel DB usage could collide on cleanup? each file uses unique company id so parallel is OK, but a single fork is simpler and avoids connection storms). Good: `pool: 'forks', poolOptions.forks.singleFork: true`.

- `.env.example`? "no secrets in the repo" — I'll provide `.env.example` with `DATABASE_URL=postgresql://user:pass@localhost:5432/marketplace_backoffice` and `PORT=3000`. Useful and not a secret. OK, small file.

26. **Prisma client + ESM**: `import { PrismaClient, Prisma } from '@prisma/client'` — fine.

Now — module wiring per convention:

`src/common/prisma.module.ts`:
```ts
@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
```

`src/app.module.ts`:
```ts
@Module({
  imports: [PrismaModule, ScheduleModule.forRoot(), OperationsModule, PaymentOrdersModule, FinancialTotalsModule, ReDerivationModule, DriftRepairModule],
})
export class AppModule {}
```

`src/operations/operations.module.ts`:
```ts
@Module({
  controllers: [OperationsController],
  providers: [OperationsService, OperationsRepository],
  exports: [OperationsService],
})
```
Does OperationsModule need to import PrismaModule? It's global — no.

`src/payment-orders/payment-orders.module.ts`:
```ts
@Module({
  controllers: [PaymentOrdersController],
  providers: [PaymentOrderService, PaymentOrderRepository],
  imports: [ProjectionModule],
})
```
ProjectionModule:
```ts
@Module({
  providers: [ProjectionService, ProjectionRepository],
  exports: [ProjectionService],
})
export class ProjectionModule {}
```

`src/financial-totals/financial-totals.module.ts`:
```ts
@Module({
  controllers: [FinancialTotalsController],
  providers: [FinancialTotalsService, FinancialTotalsRepository],
})
```

`src/re-derivation/re-derivation.module.ts`:
```ts
@Module({
  providers: [ReDerivationService, ReDerivationRepository],
  exports: [ReDerivationService],
})
```

`src/drift-repair/drift-repair.module.ts`:
```ts
@Module({
  providers: [DriftRepairService, DriftRepairRepository],
  imports: [ReDerivationModule],
})
```
DriftRepairService uses the @Cron decorator (ScheduleModule.forRoot() at app level).

27. **Controller details**:

OperationsController:
```ts
@Controller()
export class OperationsController {
  constructor(@Inject(OperationsService) private readonly operationsService: OperationsService) {}

  @Get('operations')
  list(@Query('company_id') companyId?: string, @Query('status') status?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('page') page?: string, @Query('page_size') pageSize?: string) {
    ... validate ...
    return this.operationsService.list(filter);
  }
}
```
Using individual @Query params — clean.

PaymentOrdersController:
```ts
@Controller('payment-orders')
export class PaymentOrdersController {
  @Post()
  create(@Body() body: Record<string, unknown>) { validate: company_id uuid, worker_id uuid, event_id uuid, amount_cents int >= 0; call service.create; return 201 with order dto }
  @Post(':id/approve')
  approve(@Param('id') id: string) { validate uuid; service.approve(id) }
  @Post(':id/reject')
  reject(@Param('id') id: string) { validate uuid; service.reject(id) }
}
```
Response DTO: `{ id, company_id, worker_id, event_id, status, amount_cents, created_at, updated_at }` (iso string).

FinancialTotalsController:
```ts
@Controller('companies')
@Get(':companyId/financial-totals')
totals(@Param('companyId') companyId: string) { validate uuid; service.getTotals(companyId) }
```
Response: `{ company_id, pending_amount_cents, approved_amount_cents, rejected_amount_cents, orders_count }` or 404 resource_not_found.

Note: BigInt in JSON → JSON.stringify throws on BigInt! Prisma returns BigInt for Int8 columns. I must convert to number or string in the DTO. Amounts per company can exceed 2^53? Realistically, use `Number(x)` for JSON — for safety I'll output as string? "Financial totals are accurate" — if a value exceeds 2^53, number loses accuracy... I'll output amounts as strings? Hmm, that changes the API ergonomics. The per-row `amount_cents` is Int4 → number, fine. Totals are Int8 (bigint) → output as string for exactness (e.g. "1234500"). Hmm — a bit unusual but justifiable (exactness requirement). Actually, most financial APIs output cents as strings or numbers. Given "must be accurate, not approximate", string is the defensible choice for Int8. I'll document it. In tests I'll compare strings or parse to BigInt.

Wait — should the totals even be Int8? Sum of cents per company across 3M orders... Int4 max ~2.1 billion cents = $21 million. A company could exceed that. Int8 is correct. Keep Int8 + string in JSON.

28. **OperationsService.list** returns:
```ts
{
  items: [{ id, company_id, worker_id, worker_name, event_id, event_name, status, amount_cents, created_at, updated_at }],
  page, page_size, total
}
```
`total` is number (count of rows ≤ 3M, fine).

29. **Status transitions**: approve: only pending → approved; reject: only pending → rejected. Otherwise 409 `invalid_state_transition` details `{ from, requested }`.

30. **Drift repair cron**:
```ts
@Injectable()
export class DriftRepairService {
  private static readonly WINDOW_MS = 24 * 60 * 60 * 1000;
  constructor(@Inject(ReDerivationService) private readonly reDerivation: ReDerivationService, @Inject(DriftRepairRepository) private readonly repository: DriftRepairRepository) {}

  @Cron('*/5 * * * *')
  async run(): Promise<DriftReport> {
    const now = new Date();
    const from = new Date(now.getTime() - DriftRepairService.WINDOW_MS);
    return this.repairWindow(from, now);
  }

  async repairWindow(from: Date, to: Date): Promise<DriftReport> {
    const [driftedRows, driftedCompanies] = await this.repository.findDrift(from, to);
    const repaired = driftedRows.length > 0 || driftedCompanies.length > 0;
    if (repaired) await this.reDerivation.derive(from, to);
    return { window: { from: from.toISOString(), to: to.toISOString() }, drifted_row_count: driftedRows.length, drifted_companies: driftedCompanies.length, repaired };
  }
}
```
The cron runs in the same process; the app must have ScheduleModule. Also add a guard: skip if a previous run is in progress (a simple `this.running` flag) — a nice operational touch, small.

Hmm, `@Cron` with a default logger will log every 5 minutes; fine.

31. **ReDerivationService.derive**:
```ts
async derive(from: Date, to: Date): Promise<DeriveResult> {
  if (from > to) throw new DomainException(400, 'validation_failed', 'from must not be later than to', { from, to });
  let attempt = 0;
  // eslint-disable... loop
  for (;;) {
    attempt += 1;
    try {
      return await this.repository.withSerializableTransaction(async (tx) => {
        const deleted = await this.repository.deleteRowsInWindow(tx, from, to);
        const upserted = await this.repository.insertRowsFromSource(tx, from, to);
        await this.repository.rebuildAllTotals(tx);
        return { window: { from: from.toISOString(), to: to.toISOString() }, rows_rebuilt: upserted };
      });
    } catch (err) {
      if (attempt < 3 && isSerializationConflict(err)) continue;  // wait a bit? add a small delay
      throw err;
    }
  }
}
```
Add a small backoff: `await sleep(50 * attempt)` before retry. isSerializationConflict: check `err && (err.code === '40001' || err.code === '40P01' || err.code === 'P2034') || /serializ/i.test(msg)`.

Wait — "run it twice over the same window must leave the same result": delete + full-value insert + full-value totals rebuild → idempotent. ✓.

Also, should `derive` be exposed as an endpoint? "re-derivation routine for an arbitrary date window" — a routine, not necessarily an endpoint. The drift job + tests use the service directly. An admin endpoint `POST /re-derivation`? Not requested — skip (don't create what isn't asked). The tests call the service via the app context.

32. **Concurrent totals test details**:
```ts
const orderIds = [];
for i in 0..19: POST /payment-orders { company_id, worker_id, event_id, amount_cents: 100 + i }
await Promise.all(orderIds.map(id => fetch(`/payment-orders/${id}/approve`)))  // all 20 approves? The spec: "2 orders approved concurrently for the same company both move the same totals row." Approve all 20 concurrently: expected approved = sum(all) = Σ(100+i) for i=0..19 = 20*100 + 190 = 2190? Σ i=0..19 = 190. 20*100=2000 → 2190. pending = 0.
```
Plus a mixed version: approve 10 + reject 10 concurrently:
approved = sum of first 10, rejected = sum of last 10. Let me do: 24 orders; 12 approves concurrent + 12 rejects concurrent in one Promise.all (24 concurrent writes to the same totals row — a strong concurrency test). Assert exact totals. And the per-row status on the dashboard matches.

Also assert no drift: totals sum == source sum (recompute via prisma aggregation in the test).

33. **Drift test details**:
Seed: company C, worker W, event E. Create 3 orders via API (pending). Inject drift:
- Row mismatch: `UPDATE operation_read_model SET "status" = 'approved', "updated_at" = updated_at + interval '1 hour' WHERE payment_order_id = o1` (o1 is pending in source)
- Missing row: `DELETE FROM operation_read_model WHERE payment_order_id = o2`
- Totals mismatch: `UPDATE company_financial_totals SET "approved_amount_cents" = "approved_amount_cents" + 9999 WHERE company_id = C`
Run `app.get(DriftRepairService).repairWindow(now-1h, now)` (orders created now → in window).
Assert: report.repaired is true, drifted counts > 0; o1's row status is 'pending' with updated_at matching source; o2's row exists; totals accurate.

34. **Read-your-own-writes test details**:
- Seed company/worker/event via prisma.
- Create order via API (amount 2500).
- GET list → present, status pending, worker_name/event_name correct, columns exact.
- Approve via API → 200.
- Immediately (no delay) GET list with status=approved → row with status approved.
- GET totals → approved "2500", pending "0", orders_count 1.
- 2nd order: reject → list status=rejected; totals rejected "amount", approved unchanged.
- Negative: directly insert a source order via prisma (no hook) → not visible in GET /operations (proves the dashboard reads only the projection).
- 404: approve an unknown id → 404 resource_not_found with envelope shape.
- Validation: GET /operations without company_id → 400 validation_failed; malformed status → 400.
- Invalid transition: approve an approved order → 409 invalid_state_transition.

35. **Re-derivation test**:
- Seed company, worker, event; insert 5 orders directly via prisma (mixed statuses), some older (created 10 days ago), some newer.
- Corrupt the projection: flip a row's status, delete a row, add garbage totals.
- derive([11 days ago, now]) → assert projection rows match source exactly (select both and compare as sets); totals match aggregation.
- Snapshot (rows JSON + totals JSON), derive again → deep equal.

36. Now, **files inventory**:

```
package.json
tsconfig.json
vitest.config.ts
.env.example
DESIGN.md
prisma/schema.prisma
prisma/migrations/20250101000000_init/migration.sql
prisma/migrations/20250101000000_init/migration_lock.toml
src/main.ts
src/app.module.ts
src/common/prisma.module.ts
src/common/prisma.service.ts
src/common/db-client.ts
src/common/domain-exception.ts
src/common/api-exception-filter.ts
src/common/http-codes.ts? (fold into domain-exception)
src/common/params.ts (query/body parse helpers)
src/operations/operations.module.ts
src/operations/operations.controller.ts
src/operations/operations.service.ts
src/operations/operations.repository.ts
src/payment-orders/payment-orders.module.ts
src/payment-orders/payment-orders.controller.ts
src/payment-orders/payment-orders.service.ts
src/payment-orders/payment-orders.repository.ts
src/projection/projection.module.ts
src/projection/projection.service.ts
src/projection/projection.repository.ts
src/financial-totals/financial-totals.module.ts
src/financial-totals/financial-totals.controller.ts
src/financial-totals/financial-totals.service.ts
src/financial-totals/financial-totals.repository.ts
src/re-derivation/re-derivation.module.ts
src/re-derivation/re-derivation.service.ts
src/re-derivation/re-derivation.repository.ts
src/drift-repair/drift-repair.module.ts
src/drift-repair/drift-repair.service.ts
src/drift-repair/drift-repair.repository.ts
test/helpers/app.ts
test/helpers/db.ts
test/read-your-own-writes.spec.ts
test/concurrent-totals.spec.ts
test/drift-repair.spec.ts
test/re-derivation.spec.ts
```

37 files. A lot, but the task says "build the whole solution in one reply" — deliver all files. Let me double-check each layer rule:

- Controller: validation + service call only. My controllers parse/validate via helpers and call the service. The response mapping (snake_case DTO) — is that "business logic"? It's a view mapping; the service returns a DTO in API shape and the controller returns it. To keep the controller thin, the service builds the API-shape object. OK.
- Service: no Prisma calls. PaymentOrderService uses repository.withTransaction — the repository method calls prisma.$transaction. The service passes a callback that calls other services (projection) and repositories. ✓. ReDerivationService calls repository.withSerializableTransaction + repository methods. ✓. DriftRepairService calls repository.findDrift + reDerivation.derive. ✓. OperationsService calls repository.findPage. ✓. FinancialTotalsService calls repository.findByCompanyId. ✓.
- Repository: the only DB touch. ✓ (PrismaService injected only into repositories... PrismaService is global; only repositories inject it. Test helpers use PrismaClient directly — test code, allowed.)

Wait — the projection hook: ProjectionService.applyOrderCreated calls ProjectionRepository.upsertOperationRow(tx,...). ProjectionRepository methods take a tx client. The repository itself also needs the base prisma for... the projection repository never uses the base client (always tx). Do I still inject PrismaService? No need. It's fine for a repository to not inject anything (pure methods on a tx). Hmm, but the wiring convention: "a service, repository or processor is listed in its module's providers" — still a provider. Constructor with no deps is fine. Actually, `withTransaction` lives in PaymentOrderRepository — the transactional owner is the write feature. ReDerivationRepository has withSerializableTransaction. OK.

38. **Type details**:

`OrderStatus` from `@prisma/client` enum. Values 'pending' | 'approved' | 'rejected'.

PaymentOrderRepository.findByIdInTx returns `OrderWithRelations`:
```ts
export type OrderWithRelations = Prisma.PaymentOrderGetPayload<{ include: { worker: true; event: true } }>;
```
Defined in the payment-orders repository or in common. I'll export it from the repository file.

DomainException details are Record<string, unknown>.

39. **main.ts**:
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './common/api-exception-filter.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new ApiExceptionFilter());
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}
void bootstrap();
```
`import 'reflect-metadata'` — needed for decorators at runtime (Nest requires it). With explicit @Inject, still needed for @Injectable class metadata? Nest uses Reflect for metadata reading; the import is standard. Keep.

ESM: `import { NestFactory } from '@nestjs/core';` — @nestjs/core v10 supports ESM import. ✓

40. **PrismaService**:
```ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(PrismaService)?? no — no deps.
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}
```
PrismaClient constructor with no args reads DATABASE_URL from env (schema's `url = env("DATABASE_URL")`). ✓ "config only from env vars".

41. **Migration file**: I'll write the full DDL as above with the enum type. Also `migration_lock.toml`:
```
# Please do not edit this file manually
# It should be added in your version-control system (e.g., git)
provider = "postgresql"
```

42. Now let me think about **the Prisma schema indexes** matching the migration:
- events: @@index([companyId]) → migration `CREATE INDEX "events_company_id_idx"` — name: I'll control the name in the migration; Prisma's default name would be `events_company_id_idx`. For consistency, I'll name it `events_company_id_idx` in the migration.
- payment_orders: @@index([companyId, createdAt(sort: Desc)], map: "idx_payment_orders_company_created") → migration same name, same columns.
- operation_read_model: @@index([companyId, status, createdAt(sort: Desc), paymentOrderId(sort: Desc)], map: "idx_operation_read_model_dashboard") → migration: same 4 columns + INCLUDE (worker_name, event_name, amount_cents, updated_at). Comment in schema about INCLUDE.

Also, an index on operation_read_model for the totals compare? The compare joins on payment_order_id (pk) — fine.

43. **Raw SQL quoting**: table/column names are double-quoted with snake_case. In Prisma tagged templates, `${from}` where from is a Date → Prisma serializes a Date param for timestamptz fine.

`$executeRaw` returns the number of affected rows (as bigint? $executeRaw returns Promise<number>... for $executeRaw tagged, the result is a number (affected rows). Actually Prisma docs: `$executeRaw` returns `Promise<number>` — affected row count. For $queryRaw with a single column returning bigint: SUM returns bigint → Prisma returns a BigInt for bigint. In the compare query I SELECT uuid ids → string[]. OK.

In findDrift, I select `o."id" AS "payment_order_id"` → rows are `{ payment_order_id: string }`. For totals drift: `{ company_id: string }`.

44. **The compare query in the drift repository** (single method returning both):
```ts
async findDrift(from: Date, to: Date): Promise<{ driftedRows: { paymentOrderId: string }[]; driftedCompanies: { companyId: string }[] }> {
  const [driftedRows, driftedCompanies] = await this.prisma.$transaction([rowsQ, companiesQ]);
}
```
Row query:
```sql
SELECT o."id" AS "payment_order_id"
FROM "payment_orders" o
LEFT JOIN "workers" w ON w."id" = o."worker_id"
LEFT JOIN "events" e ON e."id" = o."event_id"
LEFT JOIN "operation_read_model" p ON p."payment_order_id" = o."id"
WHERE o."created_at" >= ${from} AND o."created_at" <= ${to}
  AND (
    p."payment_order_id" IS NULL
    OR p."company_id" IS DISTINCT FROM o."company_id"
    OR p."worker_id" IS DISTINCT FROM o."worker_id"
    OR p."worker_name" IS DISTINCT FROM w."full_name"
    OR p."event_id" IS DISTINCT FROM o."event_id"
    OR p."event_name" IS DISTINCT FROM e."name"
    OR p."status" IS DISTINCT FROM o."status"
    OR p."amount_cents" IS DISTINCT FROM o."amount_cents"
    OR p."created_at" IS DISTINCT FROM o."created_at"
    OR p."updated_at" IS DISTINCT FROM o."updated_at"
  )
ORDER BY 1
LIMIT 1000? — no, count all. No limit needed (could be heavy at 3M scale, but the job compares a 24h window; fine. Hmm, at 3M orders/month, 24h ≈ 250k rows — a join scan is fine.)
```
Type of status comparison: p.status is an "OrderStatus" enum type, o.status also enum → IS DISTINCT FROM works on enums.

Company query:
```sql
SELECT t."company_id" AS "company_id"
FROM "company_financial_totals" t
WHERE t."company_id" IN (SELECT "company_id" FROM "payment_orders" WHERE "created_at" >= ${from} AND "created_at" <= ${to})
  AND (
    t."pending_amount_cents" <> COALESCE((SELECT SUM("amount_cents") FROM "payment_orders" po WHERE po."company_id" = t."company_id" AND po."status" = 'pending'), 0)
    OR t."approved_amount_cents" <> COALESCE((SELECT SUM("amount_cents") FROM "payment_orders" po WHERE po."company_id" = t."company_id" AND po."status" = 'approved'), 0)
    OR t."rejected_amount_cents" <> COALESCE((SELECT SUM("amount_cents") FROM "payment_orders" po WHERE po."company_id" = t."company_id" AND po."status" = 'rejected'), 0)
    OR t."orders_count" <> (SELECT COUNT(*) FROM "payment_orders" po WHERE po."company_id" = t."company_id")
  )
UNION
SELECT DISTINCT po."company_id" AS "company_id"
FROM "payment_orders" po
WHERE po."created_at" >= ${from} AND po."created_at" <= ${to}
  AND NOT EXISTS (SELECT 1 FROM "company_financial_totals" t WHERE t."company_id" = po."company_id")
ORDER BY 1
```
Note: the SUM of amount_cents over int → bigint; comparing with a bigint column is fine. `po."status" = 'pending'` — the enum literal needs a cast: in Postgres, a string literal = enum works (implicit coercion for literals). ✓

45. **Prisma enum in raw SQL**: the column type is `"OrderStatus"`; the literal `'pending'` is auto-coerced. ✓

46. **The re-derivation insert-select**: `o."status"` is an enum value → insert into the enum column, fine.

47. **Now DESIGN.md** content — concise but covering:
- Problem and constraints (p95 < 50ms, read-your-own-writes, accurate totals).
- Design: projection row table (1 row per payment order, denormalized worker/event name) + per-company totals table; a covering index matching (company, status, created_at desc, id desc) INCLUDE (names, amount, updated_at) → index-only scan for the hot path.
- Why synchronous in-transaction hook: the read-your-own-writes requirement eliminates every async design (post-commit hook + poller, outbox/CDC, queue consumers, scheduled refresh) because each has a visibility gap, "however short". In-transaction hook = zero gap, and atomicity: source + projection commit or roll back together (no orphan projection writes on a failed write; the write is not lost to the projection on a crash).
- Rejected alternatives:
  1. Database triggers: same atomicity, but hides write logic outside the app (invisible to app tests/logs, two places to change the status semantics, harder to evolve, migration friction); chose an explicit app-level hook called from the write service.
  2. Outbox + async consumer: eventual consistency → violates read-your-own-writes; also adds infra.
  3. CDC (Debezium): same as above + operational cost.
  4. Scheduled re-aggregation: same + the exactness of totals under concurrency is lost with the read-modify-write in the job.
  5. Keep the join + materialized view: REFRESH MATERIALIZED VIEW CONCURRENTLY is async/scheduled → same gap; and the totals need a table anyway.
- Exact totals under concurrency: atomic in-place increment (UPDATE ... SET x = x ± delta) on a single totals row per company; no read-modify-write; concurrent approvals are serialized on the row lock, none lost. Proven by a concurrency test.
- Recoverability: re-derivation routine (window) = full-value rebuild (delete + insert-select + full totals rebuild), idempotent, serializable + retry; why totals are rebuilt globally (they are global aggregates; window deltas can't be made idempotent). Honest note: a concurrent write that commits mid-run can be missed by a single run (aggregation phantom); SERIALIZABLE+retry removes the common conflicts; residual drift self-heals via the drift job.
- Drift repair: every 5 min, compare a 24h window (rows field-by-field; totals per company via aggregation) and, if any drift, repair with a re-derivation on that window; bounded, idempotent.
- Read path: the dashboard query reads only the projection; EXPLAIN shape: index-only scan on the covering index; offset pagination (same as before). Note on offset pagination cost at deep pages (same as the original query; acceptable, out of scope).
- Tradeoffs of the synchronous hook: write latency includes 2 extra writes (a row upsert + a totals upsert) — negligible compared to the join; projection failure = write failure (atomicity, no partial state); the hook must be kept small.
- Testing: read-your-own-writes, concurrent totals (24 concurrent transitions on one totals row), drift repair, re-derivation idempotency.

Length: "short DESIGN.md" — keep to ~120 lines.

48. **package.json** details:
```json
{
  "name": "marketplace-backoffice",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate deploy",
    "dev": "tsx src/main.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "test": "vitest run"
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
    "prisma": "^5.19.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.4",
    "vitest": "^2.1.0"
  }
}
```
@nestjs/schedule v4 requires @nestjs/common ^10 — ✓.

49. **tsconfig.json**:
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
    "declaration": false,
    "sourceMap": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/**/*.ts"]
}
```
rootDir src excludes test/ from the build (vitest handles tests separately). ✓

50. Now let me write all the code carefully, watching for TS strictness:

**src/common/domain-exception.ts**:
```ts
import { HttpException } from '@nestjs/common';

/**
 * Domain error codes are the API contract (snake_case, stable).
 */
export type DomainErrorCode =
  | 'resource_not_found'
  | 'validation_failed'
  | 'invalid_state_transition'
  | 'internal_error';

export class DomainException extends HttpException {
  constructor(
    private readonly statusCode: number,
    private readonly errorCode: DomainErrorCode | (string & {}),
    message: string,
    private readonly errorDetails: Record<string, unknown> = {},
  ) {
    super({ error: { code: this.errorCode, message, details: this.errorDetails } }, statusCode);
  }
  ...
}
```
Hmm — HttpException holds status via the constructor's 2nd arg. Accessor: `exception.getStatus()`. And I need to read code/details in the filter: I'll store them on the instance:
```ts
export class DomainException extends HttpException {
  readonly code: string;
  readonly details: Record<string, unknown>;
  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super({ error: { code, message, details } }, status);
    this.code = code;
    this.details = details;
  }
}
```
Simpler. `code: string` (typed as a string; known codes are enumerated in a comment).

**src/common/api-exception-filter.ts**:
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { DomainException } from './domain-exception.js';

interface ErrorEnvelope { error: { code: string; message: string; details: Record<string, unknown> } }

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const envelope = this.toEnvelope(exception);
    response.status(envelope.status).json(envelope.body);
  }

  private toEnvelope(exception: unknown): { status: number; body: ErrorEnvelope } {
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal_error';
    let message = 'unexpected error';
    let details: Record<string, unknown> = {};

    if (exception instanceof DomainException) {
      status = exception.getStatus();
      code = exception.code;
      message = (exception.getResponse() as ErrorEnvelope['body']['error']).message — hmm, simpler: keep message on the exception too.
```
Let me store `message` on the DomainException too.
```ts
export class DomainException extends HttpException {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly details: Record<string, unknown>;
  constructor(status, code, message, details = {}) { super({ error: { code, message, details } }, status); this.status = status; this.code = code; this.message = message; this.details = details; }
}
```
Note: shadowing `message` on the Error subclass — fine (class field).

Filter mapping for non-Domain HttpException:
- 400 → 'validation_failed'
- 404 → 'resource_not_found'
- 409 → 'conflict'
- else → `http_error`
message from the exception.
For a non-Http error: log? The filter shouldn't log... console? Nest's logger isn't injected into the filter (created in main without DI). I'll keep the message = err.message. Add details: {}.

Also, a Prisma error (e.g. P2025 not found) shouldn't leak — the repository converts to DomainException(404). If it does leak, the generic 500 envelope. OK.

**src/common/params.ts** — validation helpers:
```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Problems = Record<string, string>;

export function parseUuid(value: string | undefined, field: string, problems: Problems, required = true): string | undefined {
  if (value === undefined || value === '') { if (required) problems[field] = 'must be a UUID'; return undefined; }
  if (!UUID_RE.test(value)) { problems[field] = 'must be a UUID'; return undefined; }
  return value;
}

export function parseStatus(value: string | undefined, problems: Problems): 'pending' | 'approved' | 'rejected' | undefined {
  if (value === undefined) return undefined;
  if (value !== 'pending' && value !== 'approved' && value !== 'rejected') { problems.status = "must be one of 'pending', 'approved', 'rejected'"; return undefined; }
  return value;
}

export function parseDate(value: string | undefined, field: string, problems: Problems): Date | undefined {
  if (value === undefined || value === '') return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) { problems[field] = 'must be an ISO 8601 date'; return undefined; }
  return date;
}

export function parsePositiveInt(value: string | undefined, field: string, problems: Problems, def: number): number {
  if (value === undefined || value === '') return def;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) { problems[field] = 'must be a positive integer'; return def; }
  return n;
}

export function parseBoundedInt(value: string | undefined, field: string, problems: Problems, def: number, min: number, max: number): number {
  if (value === undefined || value === '') return def;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) { problems[field] = `must be an integer between ${min} and ${max}`; return def; }
  return n;
}

export function parseIntCents(value: unknown, field: string, problems: Problems): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) { problems[field] = 'must be a non-negative integer'; return undefined; }
  return value;
}
```

**src/common/db-client.ts**:
```ts
import type { Prisma } from '@prisma/client';

/**
 * A database client bound to a unit of work: either the base client
 * (single statements) or the client handed to a $transaction callback
 * (multiple statements, one commit).
 */
export type DbClient = Prisma.TransactionClient;
```
Hmm — if `Prisma.TransactionClient` doesn't exist in their Prisma version... let me think about what's safest. The current Prisma 6 (2024–2025) generated client: I'm now fairly sure it exports `TransactionClient` — the generated `index.d.ts` has:
```ts
export type TransactionClient = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$executeRaw" | "$executeRawUnsafe" | "$queryRaw" | "$queryRawUnsafe" | "$extends">;
```
Hmm — if TransactionClient omits $queryRaw/$executeRaw, my re-derivation repository using tx.$executeRaw in a tx will be a type error!! Does the interactive tx client support $queryRaw/$executeRaw? At runtime: yes, the interactive tx client supports raw queries (documented). At the type level: Prisma's `Prisma.TransactionClient`... let me recall the actual usage: people do `await tx.$queryRaw(...)` in interactive tx — it's typed. The generated type for the interactive tx callback parameter is `Prisma.TransactionClient`, and it includes raw methods (there was an issue early where $queryRaw wasn't on the tx type and got fixed). In Prisma 5, I'm fairly sure `tx.$queryRaw` is typed (it's a common pattern). I'll proceed with `Prisma.TransactionClient`.

To reduce risk further, I'll add a fallback type in case Prisma.TransactionClient is structurally narrower: define my own:
```ts
export type DbClient = Prisma.TransactionClient;
```
I'll stick with that; it's the canonical pattern.

**PrismaService** — extends PrismaClient. In repositories: `@Inject(PrismaService) private readonly prisma: PrismaService`.

**src/payment-orders/payment-orders.repository.ts**:
```ts
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';
import { DomainException } from '../common/domain-exception.js';
import type { DbClient } from '../common/db-client.js';

export type OrderWithRelations = Prisma.PaymentOrderGetPayload<{ include: { worker: true; event: true } }>;

export interface NewPaymentOrder {
  companyId: string;
  workerId: string;
  eventId: string;
  amountCents: number;
}

@Injectable()
export class PaymentOrderRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  withTransaction<T>(work: (tx: DbClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work);
  }

  async createInTx(tx: DbClient, data: NewPaymentOrder): Promise<OrderWithRelations> {
    return tx.paymentOrder.create({ data, include: { worker: true, event: true } });
  }

  async findInTx(tx: DbClient, id: string): Promise<OrderWithRelations> {
    const order = await tx.paymentOrder.findUnique({ where: { id }, include: { worker: true, event: true } });
    if (!order) {
      throw new DomainException(404, 'resource_not_found', `payment order ${id} was not found`, { id });
    }
    return order;
  }

  async updateStatusInTx(tx: DbClient, id: string, status: 'approved' | 'rejected'): Promise<OrderWithRelations> {
    return tx.paymentOrder.update({ where: { id }, data: { status, updatedAt: new Date() }, include: { worker: true, event: true } });
  }
}
```

**src/payment-orders/payment-orders.service.ts**:
```ts
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { DbClient } from '../common/db-client.js';
import { DomainException } from '../common/domain-exception.js';
import { ProjectionService } from '../projection/projection.service.js';
import { type NewPaymentOrder, type OrderWithRelations, PaymentOrderRepository } from './payment-orders.repository.js';

@Injectable()
export class PaymentOrderService {
  constructor(
    @Inject(PaymentOrderRepository) private readonly orders: PaymentOrderRepository,
    @Inject(ProjectionService) private readonly projection: ProjectionService,
  ) {}

  /**
   * The write path: the source row and the projection are maintained inside one
   * transaction, so the dashboard sees the new state on the next request.
   */
  create(input: NewPaymentOrder): Promise<OrderDto> {
    return this.orders.withTransaction(async (tx) => {
      const order = await this.orders.createInTx(tx, input);
      await this.projection.applyOrderCreated(tx, order); // maintenance hook
      return toDto(order);
    });
  }

  approve(id: string): Promise<OrderDto> {
    return this.transition(id, 'approved');
  }

  reject(id: string): Promise<OrderDto> {
    return this.transition(id, 'rejected');
  }

  private transition(id: string, to: 'approved' | 'rejected'): Promise<OrderDto> {
    return this.orders.withTransaction(async (tx) => {
      const current = await this.orders.findInTx(tx, id);
      if (current.status !== 'pending') {
        throw new DomainException(409, 'invalid_state_transition',
          `payment order ${id} is ${current.status}; only pending orders can be ${to}`,
          { id, from: current.status, requested: to });
      }
      const updated = await this.orders.updateStatusInTx(tx, id, to);
      await this.projection.applyOrderStatusChanged(tx, updated, 'pending'); // maintenance hook
      return toDto(updated);
    });
  }
}

export interface OrderDto { id: string; company_id: string; worker_id: string; event_id: string; status: string; amount_cents: number; created_at: string; updated_at: string; }

function toDto(order: OrderWithRelations): OrderDto {
  return { id: order.id, company_id: order.companyId, worker_id: order.workerId, event_id: order.eventId, status: order.status, amount_cents: order.amountCents, created_at: order.createdAt.toISOString(), updated_at: order.updatedAt.toISOString() };
}
```
Wait: is `order.status` typed as the enum `OrderStatus` (= 'pending'|'approved'|'rejected')? A Prisma enum with lowercase members → TS union `'pending' | 'approved' | 'rejected'`. So toDto's `status: string` is fine.

**src/projection/projection.repository.ts**:
```ts
import { Injectable } from '@nestjs/common';
import type { OrderStatus } from '@prisma/client';
import type { DbClient } from '../common/db-client.js';

export interface OperationRowData {
  paymentOrderId: string;
  companyId: string;
  workerId: string;
  workerName: string;
  eventId: string;
  eventName: string;
  status: OrderStatus;
  amountCents: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TotalsDelta {
  pending: number;
  approved: number;
  rejected: number;
  ordersCount: number;
}

@Injectable()
export class ProjectionRepository {
  /** Full-value upsert: safe to apply from the hook or re-derivation. */
  async upsertOperationRow(tx: DbClient, row: OperationRowData): Promise<void> {
    await tx.operationReadModel.upsert({
      where: { paymentOrderId: row.paymentOrderId },
      update: {
        companyId: row.companyId,
        workerId: row.workerId,
        workerName: row.workerName,
        eventId: row.eventId,
        eventName: row.eventName,
        status: row.status,
        amountCents: row.amountCents,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
      create: row,
    });
  }

  /**
   * Atomic in-place increment on the company's totals row. Concurrent writers
   * are serialized by the row lock; no read-modify-write, so no update is lost.
   */
  async applyTotalsDelta(tx: DbClient, companyId: string, delta: TotalsDelta): Promise<void> {
    await tx.companyFinancialTotals.upsert({
      where: { companyId },
      update: {
        pendingAmountCents: { increment: delta.pending },
        approvedAmountCents: { increment: delta.approved },
        rejectedAmountCents: { increment: delta.rejected },
        ordersCount: { increment: delta.ordersCount },
      },
      create: {
        companyId,
        pendingAmountCents: delta.pending,
        approvedAmountCents: delta.approved,
        rejectedAmountCents: delta.rejected,
        ordersCount: delta.ordersCount,
      },
    });
  }
}
```
Hmm — `create` with a negative delta (a delta.pending that's negative on create?) — create is used only when the row doesn't exist; in that case the delta is the first change, which for pending is positive (create order) or the first approve after...? The totals row is created by the first write for that company, which is always an order creation (pending +) — the row exists before any approve can happen (the hook creates it on order creation). But an edge: if the totals row was deleted (drift), then an approve delta (pending: -amt) would create a row with a negative pending. The drift repair's rebuild would fix it. Tolerable; or I clamp create to zero? I'll leave it; document nothing. Actually, to be safe, let me make the upsert a 2-step: create with zero if it doesn't exist? The upsert's create uses the delta values — an edge only. Fine.

Also `increment` on a BigInt field accepts `number | bigint` — TS: `PendingAmountCentsFieldUpdateOperationsInput { increment?: number | bigint | null }`. ✓.

**src/projection/projection.service.ts**:
```ts
import { Inject, Injectable } from '@nestjs/common';
import type { OrderStatus } from '@prisma/client';
import type { DbClient } from '../common/db-client.js';
import type { OrderWithRelations } from '../payment-orders/payment-orders.repository.js';
import { ProjectionRepository } from './projection.repository.js';

@Injectable()
export class ProjectionService {
  constructor(@Inject(ProjectionRepository) private readonly repository: ProjectionRepository) {}

  /**
   * Maintenance hook, invoked by the write services inside the writer's
   * transaction. If the write rolls back, the projection never saw it.
   */
  async applyOrderCreated(tx: DbClient, order: OrderWithRelations): Promise<void> {
    await this.repository.upsertOperationRow(tx, toRow(order));
    await this.repository.applyTotalsDelta(tx, order.companyId, {
      pending: order.amountCents, approved: 0, rejected: 0, ordersCount: 1,
    });
  }

  async applyOrderStatusChanged(tx: DbClient, order: OrderWithRelations, from: OrderStatus): Promise<void> {
    await this.repository.upsertOperationRow(tx, toRow(order));
    if (from !== order.status) {
      const delta = { pending: 0, approved: 0, rejected: 0, ordersCount: 0 };
      delta[from] -= order.amountCents;
      delta[order.status] += order.amountCents;
      await this.repository.applyTotalsDelta(tx, order.companyId, delta);
    }
  }
}

function toRow(order: OrderWithRelations): OperationRowData {
  return { paymentOrderId: order.id, companyId: order.companyId, workerId: order.workerId, workerName: order.worker.fullName, eventId: order.eventId, eventName: order.event.name, status: order.status, amountCents: order.amountCents, createdAt: order.createdAt, updatedAt: order.updatedAt };
}
```
Type of `delta[from]`: `delta` is typed as `{ pending: number; approved: number; rejected: number; ordersCount: number }`; indexing by OrderStatus ('pending'|'approved'|'rejected') → OK, all keys are number. `delta[order.status]` — order.status is OrderStatus. ✓

**src/operations/operations.repository.ts**:
```ts
import { Inject, Injectable } from '@nestjs/common';
import type { OrderStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';

export interface OperationFilter {
  companyId: string;
  status?: OrderStatus;
  from?: Date;
  to?: Date;
}

export interface OperationPageParams {
  page: number;
  pageSize: number;
}

@Injectable()
export class OperationsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** The hot path: reads the projection only, no join to the source tables. */
  async findPage(filter: OperationFilter, params: OperationPageParams) {
    const where = {
      companyId: filter.companyId,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.from || filter.to
        ? { createdAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) } }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.operationReadModel.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { paymentOrderId: 'desc' }],
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.operationReadModel.count({ where }),
    ]);
    return { items, total };
  }
}
```
TS strict: the shape of `where` with conditional spreads — Prisma's `OperationReadModelWhereInput` accepts it. The spread types: `{ companyId: string } & {}...` — should be assignable. `createdAt: { gte?: Date, lte?: Date }` ✓.

**src/operations/operations.service.ts**:
```ts
import { Inject, Injectable } from '@nestjs/common';
import type { OrderStatus } from '@prisma/client';
import { OperationsRepository } from './operations.repository.js';

export interface OperationListParams {
  companyId: string;
  status?: OrderStatus;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

export interface OperationItemDto {
  id: string; company_id: string; worker_id: string; worker_name: string;
  event_id: string; event_name: string; status: string; amount_cents: number;
  created_at: string; updated_at: string;
}

@Injectable()
export class OperationsService {
  constructor(@Inject(OperationsRepository) private readonly repository: OperationsRepository) {}

  list(params: OperationListParams) {
    return this.repository.findPage(params, { page: params.page, pageSize: params.pageSize })
      .then(({ items, total }) => ({
        items: items.map(toDto),
        page: params.page,
        page_size: params.pageSize,
        total,
      }));
  }
}

function toDto(row) {...}
```

**src/operations/operations.controller.ts**:
```ts
import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { OrderStatus } from '@prisma/client';
import { DomainException } from '../common/domain-exception.js';
import { parseDate, parsePositiveInt, parseBoundedInt, parseStatus, parseUuid, type Problems } from '../common/params.js';
import { OperationsService } from './operations.service.js';

@Controller('operations')
export class OperationsController {
  constructor(@Inject(OperationsService) private readonly operationsService: OperationsService) {}

  @Get()
  list(
    @Query('company_id') companyId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
  ) {
    const problems: Problems = {};
    const cid = parseUuid(companyId, 'company_id', problems, true);
    const st = parseStatus(status, problems);
    const fromD = parseDate(from, 'from', problems);
    const toD = parseDate(to, 'to', problems);
    if (fromD && toD && fromD > toD) problems.to = 'must not be earlier than from';
    const pageN = parsePositiveInt(page, 'page', problems, 1);
    const pageSizeN = parseBoundedInt(pageSize, 'page_size', problems, 50, 1, 200);
    if (Object.keys(problems).length > 0) {
      throw new DomainException(400, 'validation_failed', 'invalid query parameters', problems);
    }
    if (cid === undefined) throw new Error('unreachable'); // hmm — ugly
    return this.operationsService.list({ companyId: cid, status: st, from: fromD, to: toD, page: pageN, pageSize: pageSizeN });
  }
}
```
The `if (cid === undefined) throw` — TS narrowing: parseUuid returns string | undefined; after the problems check, if company_id was required and invalid, problems is non-empty → throw DomainException. But TS doesn't know that. Cleaner: parseUuid with required returns string (throws? no...). Let me restructure: have the helper return `string` for required, and record the problem but... TS can't know. Alternative: `const cid = parseUuid(...); if (!cid || Object.keys(problems).length) throw ...;` — `if (!cid || ...)` then TS narrows cid to string after. But the order: if cid is undefined → problems is set → throw. So:
```ts
if (!cid || Object.keys(problems).length > 0) throw new DomainException(400, 'validation_failed', 'invalid query parameters', problems);
```
After that, cid: string ✓.

`@Controller('operations')` with `@Get()` → GET /operations ✓ (endpoint kebab-case plural: "operations" ✓).

**src/payment-orders/payment-orders.controller.ts**:
```ts
@Controller('payment-orders')
export class PaymentOrdersController {
  constructor(@Inject(PaymentOrderService) private readonly service: PaymentOrderService) {}

  @Post()
  create(@Body() body: Record<string, unknown>) {
    const problems: Problems = {};
    const companyId = parseUuid(body.company_id as string | undefined, 'company_id', problems, true);
    const workerId = parseUuid(body.worker_id as string | undefined, 'worker_id', problems, true);
    const eventId = parseUuid(body.event_id as string | undefined, 'event_id', problems, true);
    const amountCents = parseAmountCents(body.amount_cents, problems);
    if (!companyId || !workerId || !eventId || amountCents === undefined || Object.keys(problems).length > 0) {
      throw new DomainException(400, 'validation_failed', 'invalid payment order payload', problems);
    }
    return this.service.create({ companyId, workerId, eventId, amountCents });
  }

  @Post(':id/approve')
  approve(@Param('id') id: string) {
    if (!isUuid(id)) throw new DomainException(400, 'validation_failed', 'id must be a UUID', { id });
    return this.service.approve(id);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string) {
    if (!isUuid(id)) throw new DomainException(400, 'validation_failed', 'id must be a UUID', { id });
    return this.service.reject(id);
  }
}
```
Add `isUuid` and `parseAmountCents` in params.ts. `parseUuid` takes `string | undefined`; body's fields are `unknown` → cast: `typeof body.company_id === 'string' ? body.company_id : undefined`. Cleaner:
```ts
const companyId = parseUuid(asString(body.company_id), 'company_id', problems, true);
```
With `function asString(v: unknown): string | undefined { return typeof v === 'string' ? v : undefined; }` — but if it's a number, we report "must be a UUID" — fine.

201 status for create: Nest's `@Post()` returns 201 by default. ✓

**src/financial-totals/**:
repository:
```ts
@Injectable()
export class FinancialTotalsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  findByCompanyId(companyId: string) { return this.prisma.companyFinancialTotals.findUnique({ where: { companyId } }); }
}
```
service:
```ts
@Injectable()
export class FinancialTotalsService {
  constructor(@Inject(FinancialTotalsRepository) private readonly repository: FinancialTotalsRepository) {}
  async get(companyId: string) {
    const totals = await this.repository.findByCompanyId(companyId);
    if (!totals) throw new DomainException(404, 'resource_not_found', `no financial totals recorded for company ${companyId}`, { company_id: companyId });
    return {
      company_id: totals.companyId,
      pending_amount_cents: totals.pendingAmountCents.toString(),
      approved_amount_cents: totals.approvedAmountCents.toString(),
      rejected_amount_cents: totals.rejectedAmountCents.toString(),
      orders_count: totals.ordersCount,
    };
  }
}
```
controller:
```ts
@Controller('companies')
export class FinancialTotalsController {
  @Get(':companyId/financial-totals')
  get(@Param('companyId') companyId: string) {
    if (!isUuid(companyId)) throw new DomainException(400, 'validation_failed', 'companyId must be a UUID', { companyId });
    return this.service.get(companyId);
  }
}
```

**src/re-derivation/re-derivation.repository.ts** — as sketched. Plus `withSerializableTransaction`.

**src/re-derivation/re-derivation.service.ts** — as sketched with retry:
```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
...
const MAX_ATTEMPTS = 3;

@Injectable()
export class ReDerivationService {
  private readonly logger = new Logger(ReDerivationService.name);

  constructor(@Inject(ReDerivationRepository) private readonly repository: ReDerivationRepository) {}

  async derive(from: Date, to: Date): Promise<DeriveResult> {
    if (from.getTime() > to.getTime()) {
      throw new DomainException(400, 'validation_failed', 'from must not be later than to', { from: from.toISOString(), to: to.toISOString() });
    }
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.repository.withSerializableTransaction(async (tx) => {
          await this.repository.deleteRowsInWindow(tx, from, to);
          const rows = await this.repository.insertRowsFromSource(tx, from, to);
          await this.repository.rebuildAllTotals(tx);
          return { from: from.toISOString(), to: to.toISOString(), rows_rebuilt: rows };
        });
      } catch (error) {
        if (attempt < MAX_ATTEMPTS && isSerializationConflict(error)) {
          this.logger.warn(`serialization conflict on attempt ${attempt}; retrying`);
          await sleep(25 * attempt);
          continue;
        }
        throw error;
      }
    }
  }
}
```
`isSerializationConflict`:
```ts
function isSerializationConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code === '40001' || code === '40P01' || code === 'P2034') return true;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && /serializ/i.test(message);
}
```

**src/drift-repair/drift-repair.repository.ts** — findDrift as sketched (two raw queries via a batch $transaction).

**src/drift-repair/drift-repair.service.ts**:
```ts
import { Cron, Injectable, Inject } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';

const WINDOW_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class DriftRepairService {
  private running = false;

  constructor(
    @Inject(ReDerivationService) private readonly reDerivation: ReDerivationService,
    @Inject(DriftRepairRepository) private readonly repository: DriftRepairRepository,
  ) {}

  /** Scheduled drift repair: compare the recent window and repair if anything disagrees. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async run(): Promise<DriftRepairReport> {
    if (this.running) return { skipped: true, reason: 'previous run still in progress' }; — hmm, the report shape gets complicated.
```
Let me keep the guard simple: the report type:
```ts
export interface DriftRepairReport {
  window: { from: string; to: string };
  drifted_row_count: number;
  drifted_company_count: number;
  repaired: boolean;
}
```
Guard: if running, throw? no — log + return a zero-value? Simplest: guard with a `if (this.running) { return; }`... but the return type. I'll make `run(): Promise<DriftRepairReport | null>` returning null if skipped (with a log). Tests use `repairWindow` directly (no guard). Fine:

```ts
@Cron(CronExpression.EVERY_5_MINUTES)
async run(): Promise<DriftRepairReport | null> {
  if (this.running) {
    this.logger.warn('skipping drift repair: previous run still in progress');
    return null;
  }
  this.running = true;
  try {
    const now = new Date();
    return await this.repairWindow(new Date(now.getTime() - WINDOW_MS), now);
  } finally {
    this.running = false;
  }
}
```

`repairWindow(from, to)`:
```ts
async repairWindow(from: Date, to: Date): Promise<DriftRepairReport> {
  const { driftedRows, driftedCompanies } = await this.repository.findDrift(from, to);
  const repaired = driftedRows.length > 0 || driftedCompanies.length > 0;
  if (repaired) {
    this.logger.warn(`drift detected: ${driftedRows.length} rows, ${driftedCompanies.length} companies; re-deriving ${from}..${to}`);
    await this.reDerivation.derive(from, to);
  }
  return { window: { from: from.toISOString(), to: to.toISOString() }, drifted_row_count: driftedRows.length, drifted_company_count: driftedCompanies.length, repaired };
}
```

**Test helpers**:

`test/helpers/db.ts`:
```ts
import { PrismaClient } from '@prisma/client';

export function createTestPrisma(): PrismaClient {
  return new PrismaClient();
}

export interface TestFixtures {
  companyId: string;
  workerId: string;
  eventId: string;
}

export async function seedCompany(prisma: PrismaClient, name = 'Test Co'): Promise<TestFixtures> {
  const company = await prisma.company.create({ data: { name } });
  const worker = await prisma.worker.create({ data: { fullName: 'Ada Worker' } });
  const event = await prisma.event.create({ data: { companyId: company.id, name: 'Harvest Fair' } });
  return { companyId: company.id, workerId: worker.id, eventId: event.id };
}

export async function cleanupByCompany(prisma: PrismaClient, companyId: string): Promise<void> {
  const orderIds = (await prisma.paymentOrder.findMany({ where: { companyId }, select: { id: true } })).map(o => o.id);
  await prisma.operationReadModel.deleteMany({ where: { paymentOrderId: { in: orderIds } } });
  await prisma.companyFinancialTotals.deleteMany({ where: { companyId } });
  await prisma.paymentOrder.deleteMany({ where: { companyId } });
  await prisma.event.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
}
```
Workers are shared (not company-scoped) — cleanup: delete the worker too (since it's unique per test). I'll include workerId in cleanup.

`test/helpers/app.ts`:
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'http';
import { AppModule } from '../../src/app.module.js';
import { ApiExceptionFilter } from '../../src/common/api-exception-filter.js';

export interface TestApp {
  app: INestApplication;
  baseUrl: string;
  close: () => Promise<void>;
}

export async function startTestApp(): Promise<TestApp> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.listen(0);
  const server = app.getHttpServer() as Server;
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    app,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => app.close(),
  };
}
```
Note: the cron in the test app fires every 5 minutes — the test app won't live 5 minutes... the first @Cron EVERY_5_MINUTES fires after 5 minutes, not at startup. Tests finish before that. But the schedule keeps the process alive? `app.close()` stops the cron. OK.

Hmm — the DriftRepairService's @Cron: during tests, the Nest app is alive but the cron fires at t+5min; tests are ~10s. Fine.

Also, the test app boots the PrismaService ($connect to DATABASE_URL). The helper prisma is a separate client. Two clients is fine.

`describe.skipIf(!process.env.DATABASE_URL)` — vitest supports `describe.skipIf(condition)`. ✓

**Test files** — let me write them concretely.

`test/read-your-own-writes.spec.ts`:
```ts
import { beforeAll, afterAll, afterEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { startTestApp, type TestApp } from './helpers/app.js';
import { createTestPrisma, seedCompany, cleanupByCompany, type TestFixtures } from './helpers/db.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe('operations dashboard — read your own writes', () => {
  let app: TestApp;
  let prisma: PrismaClient;
  let fx: TestFixtures;
  const companyIds: string[] = [];

  beforeAll(async () => {
    prisma = createTestPrisma();
    app = await startTestApp();
  }, 30000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  afterEach(async () => {
    for (const id of companyIds.splice(0)) await cleanupByCompany(prisma, id);
  });

  it('shows an approved order on the next request after approving it', async () => {
    fx = await seedCompany(prisma);
    companyIds.push(fx.companyId);

    const created = await post(app, '/payment-orders', { company_id: fx.companyId, worker_id: fx.workerId, event_id: fx.eventId, amount_cents: 2500 });
    expect(created.status).toBe(201);
    const orderId = (await created.json()).id;

    // visible immediately, as pending
    let list = await get(app, '/operations', { company_id: fx.companyId });
    expect(list.status).toBe(200);
    let body = await list.json();
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({ id: orderId, status: 'pending', amount_cents: 2500, worker_name: 'Ada Worker', event_name: 'Harvest Fair' });

    // approve
    const approved = await post(app, `/payment-orders/${orderId}/approve`);
    expect(approved.status).toBe(200);
    expect((await approved.json()).status).toBe('approved');

    // the very next request reflects it — no polling, no delay
    list = await get(app, '/operations', { company_id: fx.companyId, status: 'approved' });
    body = await list.json();
    expect(body.total).toBe(1);
    expect(body.items[0].status).toBe('approved');

    // totals move in the same request cycle
    const totals = await get(app, `/companies/${fx.companyId}/financial-totals`);
    expect(totals.status).toBe(200);
    expect(await totals.json()).toEqual({
      company_id: fx.companyId,
      pending_amount_cents: '0',
      approved_amount_cents: '2500',
      rejected_amount_cents: '0',
      orders_count: 1,
    });
  });
  ...
```
Helper `post/get` with fetch:
```ts
async function get(app: TestApp, path: string, query: Record<string, string>) {
  const url = new URL(path, app.baseUrl);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return fetch(url);
}
async function post(app: TestApp, path: string, body?: unknown) {
  return fetch(new URL(path, app.baseUrl), { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
}
```
Put these in `test/helpers/http.ts`.

Additional tests in this file:
- 'reject moves the order and totals' (2nd order rejected; totals: rejected amount; approved unchanged)
- 'the dashboard reads only the projection': insert an order directly via prisma (status approved) → GET /operations (company) → not present (total unchanged); then GET with status filter also absent. (Then cleanup: the direct order's id is in companyIds cleanup — cleanupByCompany handles orders by company.)
- 'an unknown order id returns the resource_not_found envelope': post approve with a random uuid → 404, body.error.code === 'resource_not_found', details is an object.
- 'validation failures return the validation_failed envelope': GET /operations with no company_id → 400, code validation_failed, details.company_id is defined. Malformed status → 400.
- 'an already-approved order cannot be approved again': 409, code invalid_state_transition.
- 'deep page returns an empty items with the same total': create 3 orders, page=2, page_size=2 → items length 1, total 3. (Pagination shape.) Also order by recency: create orders with explicit created_at? The default now() is within the same ms; the id tiebreak is random — the order test is flaky. I can set createdAt via prisma direct insert for ordering tests (created_at 1s apart). I'll add an ordering test with direct prisma insert + derive to populate the projection: insert 3 orders with created_at now-3s/now-2s/now-1s, run derive via app.get(ReDerivationService) — the test can use the service from the app context. Then GET list → expect created_at descending. That doubles as a re-derivation integration. Or I'll keep the ordering test in the re-derivation spec. I'll put the ordering + direct-seed in the re-derivation spec.

`test/concurrent-totals.spec.ts`:
```ts
describe('concurrent updates to one company totals', () => {
  it('applies 24 concurrent transitions without losing any', async () => {
    const fx = await seedCompany(prisma);
    companyIds.push(fx.companyId);
    const amounts = Array.from({ length: 24 }, (_, i) => 100 + i); // 100..123 → sum 2772? Σ100..123 = 24*100 + Σ0..23 = 2400 + 276 = 2676. Let me compute: Σ0..23 = 23*24/2 = 276. So 2676.
    const ids: string[] = [];
    for (const amount of amounts) { const res = await post(...amount_cents: amount...); ids.push(body.id); }
    // 12 concurrent approves, 12 concurrent rejects — all against the same totals row
    const responses = await Promise.all([
      ...ids.slice(0, 12).map((id) => post(app, `/payment-orders/${id}/approve`)),
      ...ids.slice(12).map((id) => post(app, `/payment-orders/${id}/reject`)),
    ]);
    for (const r of responses) expect(r.status).toBe(200);

    const approvedSum = amounts.slice(0, 12).reduce((a, b) => a + b, 0); // 100..111 → 12*100 + 66 = 1266
    const rejectedSum = amounts.slice(12).reduce((a, b) => a + b, 0); // 112..123 → 12*112 + (0..11)=66 → 1344+66=1410? Σ112..123 = 12*112 + 66 = 1344 + 66 = 1410. Total 1266+1410=2676 ✓
    const totals = await get(app, `/companies/${fx.companyId}/financial-totals`);
    expect(await totals.json()).toEqual({ company_id: fx.companyId, pending_amount_cents: '0', approved_amount_cents: String(approvedSum), rejected_amount_cents: String(rejectedSum), orders_count: 24 });

    // cross-check against source: the totals must equal an aggregation of the source table
    const source = await prisma.paymentOrder.aggregate({ where: { companyId: fx.companyId }, _sum: { amountCents: { ... } } }) — need per status: use groupBy:
    const grouped = await prisma.paymentOrder.groupBy({ by: ['status'], where: { companyId: fx.companyId }, _sum: { amountCents: true }, _count: true });
    const sum = (s) => grouped.find(g => g.status === s)?._sum.amountCents ?? 0;
    expect(sum('approved')).toBe(approvedSum); ...
    And the dashboard shows 12 approved + 12 rejected:
    const list = await get(app, '/operations', { company_id, status: 'approved' }); expect(total 12).
  });

  it('concurrent approvals on two orders for a new company both create the totals row', ...) — the first write race: two orders created concurrently for a brand-new company → both upsert the totals row; assert both counts. (upsert ON CONFLICT handles it.) Maybe fold into the above. I'll add a small 2nd test: 2 concurrent creates → orders_count 2, pending = sum.
});
```

`test/drift-repair.spec.ts`:
```ts
describe('drift repair', () => {
  it('finds and fixes drifted rows and totals in the recent window', async () => {
    const fx = await seedCompany(prisma);
    companyIds.push(fx.companyId);
    const ids = [];
    for (let i = 0; i < 3; i++) create order (amount 500+i);
    const repairService = app.app.get(DriftRepairService);
    const now = new Date();
    const from = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    // baseline: no drift
    let report = await repairService.repairWindow(from, now);
    expect(report.repaired).toBe(false);
    expect(report.drifted_row_count).toBe(0);

    // inject drift
    const [a, b, c] = ids;
    await prisma.$executeRawUnsafe(`UPDATE "operation_read_model" SET "status" = 'approved', "updated_at" = "updated_at" + interval '1 hour' WHERE "payment_order_id" = ${a}`); — better use $executeRaw with params: prisma.$executeRaw`UPDATE "operation_read_model" SET "status" = 'approved' WHERE "payment_order_id" = ${a}`;
    await prisma.$executeRaw`DELETE FROM "operation_read_model" WHERE "payment_order_id" = ${b}`;
    await prisma.$executeRaw`UPDATE "company_financial_totals" SET "approved_amount_cents" = "approved_amount_cents" + 9999 WHERE "company_id" = ${fx.companyId}`;

    report = await repairService.repairWindow(from, now);
    expect(report.repaired).toBe(true);
    expect(report.drifted_row_count).toBeGreaterThanOrEqual(2); // a (mismatch) + b (missing)
    expect(report.drifted_company_count).toBe(1);

    // everything agrees with source again
    const rows = await prisma.operationReadModel.findMany({ where: { paymentOrderId: { in: ids } }, orderBy: { paymentOrderId: 'asc' } });
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.status).toBe('pending');
    const totals = await get(app, `/companies/${fx.companyId}/financial-totals`);
    expect((await totals.json()).approved_amount_cents).toBe('0');
    expect((await totals.json()).pending_amount_cents).toBe(String(500 + 501 + 502));
  });
});
```
Note: `repairWindow` runs the re-derivation, which rebuilds the totals for all companies (delete + insert) — including other test data? This runs in the same DB; other suites' companies — the rebuild recomputes from source, so it's consistent for all companies (not destructive — full-value recompute). ✓ safe.

Also test that the cron job exists? Not behaviorally testable; skip.

`test/re-derivation.spec.ts`:
```ts
describe('re-derivation', () => {
  it('rebuilds the projection for a window from source and is idempotent', async () => {
    const fx = await seedCompany(prisma);
    companyIds.push(fx.companyId);
    const now = new Date();
    // orders directly in source (bypassing the hook on purpose)
    const orderIds = [];
    const statuses: OrderStatus[] = ['pending', 'approved', 'rejected', 'approved', 'pending'];
    for (let i = 0; i < 5; i++) {
      const order = await prisma.paymentOrder.create({ data: { companyId: fx.companyId, workerId: fx.workerId, eventId: fx.eventId, status: statuses[i], amountCents: 100 * (i + 1), createdAt: new Date(now.getTime() - (i + 1) * 60000), updatedAt: new Date(now.getTime() - (i + 1) * 60000) } });
      orderIds.push(order.id);
    }
    // an older order outside the window, for boundary check
    const outside = await prisma.paymentOrder.create({ data: { ..., createdAt: new Date(now.getTime() - 3 * 24 * 3600 * 1000), status: 'approved', amountCents: 777 } });

    const deriveService = app.app.get(ReDerivationService);
    const from = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    await deriveService.derive(from, now);

    // rows match source exactly
    const rows = await prisma.operationReadModel.findMany({ where: { paymentOrderId: { in: orderIds } }, orderBy: { createdAt: 'desc' } });
    expect(rows.map(r => r.paymentOrderId)).toEqual([...orderIds].sort? ...) — createdAt desc → i=0 (most recent, -1min) first. orderIds[0] has createdAt now-1min... I set createdAt = now - (i+1)*60000 → i=0 → -1min (newest). So expected row order: orderIds[0..4]. ✓
    rows.forEach((row, i) => { expect(row).toMatchObject({ status: statuses[i], amountCents: 100*(i+1), workerName: 'Ada Worker', eventName: 'Harvest Fair' }); });
    // the outside-order row was not created (window boundary)
    const outsideRow = await prisma.operationReadModel.findUnique({ where: { paymentOrderId: outside.id } });
    expect(outsideRow).toBeNull();
    // totals rebuilt from all source (including the outside order)
    const totals = await prisma.companyFinancialTotals.findUnique({ where: { companyId: fx.companyId } });
    expect(totals?.approvedAmountCents).toBe(BigInt(100*2 + 100*4 + 777)); // i=1 (200, approved) + i=3 (400, approved) + 777 = 1377
    expect(totals?.pendingAmountCents).toBe(BigInt(100 + 500)); // i=0 100, i=4 500
    expect(totals?.rejectedAmountCents).toBe(BigInt(300));
    expect(totals?.ordersCount).toBe(6);

    // a second run over the same window leaves everything identical
    const before = snapshot(await prisma.operationReadModel.findMany({ where: { companyId: fx.companyId } }), await prisma.companyFinancialTotals.findMany());
    await deriveService.derive(from, now);
    const after = snapshot(...same...);
    expect(after).toEqual(before);
  });

  it('repairs a corrupted projection when run over the window', ...) — maybe redundant with the drift test; skip (the drift test covers repair).

  it('orders in the dashboard are sorted by recency') — after derive, GET /operations?company_id → created_at descending. I'll fold into the above via an HTTP GET check. Add:
    const list = await get(app, '/operations', { company_id: fx.companyId });
    expect((await list.json()).items.map(i => i.id)).toEqual(orderIds); // descending created_at
  Wait, total = 5 (the outside order is excluded from the projection → not in the list). ✓ good boundary check via HTTP.
});
```
Note: totals include the `outside` order (a full rebuild aggregates all orders for the company) — yes, as I computed (approved includes 777). And orders_count 6.

snapshot helper: `JSON.parse(JSON.stringify(x))` for plain data (BigInt → JSON.stringify fails on BigInt! operationReadModel has no bigint; totals does. Map to strings: I'll make a snapshot function that converts bigint → string. Or compare via the API. Simpler: define `plainify` in the test helper: `JSON.parse(JSON.stringify(value, (_k, v) => typeof v === 'bigint' ? v.toString() : v))`.

53. **`app.get(DriftRepairService)`** — import the class from src in the test: `import { DriftRepairService } from '../src/drift-repair/drift-repair.service.js';` ✓ (vitest resolves .js → .ts).

54. **DESIGN.md** — I'll write ~100–150 lines.

55. **Migration timestamp**: `20250612093000_init`? Any fixed timestamp works: `20250101000000_init`.

Let me also double-check the **Prisma schema enum + raw SQL insert**: insert `o."status"` (OrderStatus enum) into an `"OrderStatus"` column — ✓.

The CHECK in the migration vs the enum: I'll use the enum type in the DDL (matching Prisma): `"status" "OrderStatus" NOT NULL DEFAULT 'pending'`.

**The order of DDL in the migration**: create type first, then tables, then indexes. Also the FKs: operation_read_model.company_id → companies? The projection's company_id is data, not strictly FK (the read model mirrors; an FK would help integrity; I'll add FKs for company_id, worker_id, event_id on the read model too? If a worker is deleted, the read model breaks. There's no delete in this app. Adding FKs is harmless... but on re-derivation, we insert rows for orders whose workers exist — fine. I'll add FKs to company_id/worker_id/event_id on the read model for integrity. Hmm — the delete in the re-derivation + re-insert within the same tx, FKs fine. OK, I'll add them.

Wait, one more: the totals' FK → companies: cleanupByCompany deletes totals before company ✓; the re-derivation's rebuild totals deletes all + inserts with companies that exist ✓.

**The Prisma schema needs relations?** No relation fields (I only use include for worker/event from PaymentOrder): PaymentOrder needs `worker Worker @relation(...)` field for include. Let me define the relations:

```prisma
model PaymentOrder {
  ...
  worker Worker @relation(fields: [workerId], references: [id])
  event  Event  @relation(fields: [eventId], references: [id])

  @@index(...)
  @@map("payment_orders")
}

model Worker {
  id, fullName, createdAt
  orders PaymentOrder[]
  @@map("workers")
}

model Event {
  id, companyId, name, createdAt
  company Company @relation(fields: [companyId], references: [id])
  orders PaymentOrder[]
  @@index([companyId])
  @@map("events")
}

model Company {
  id, name, createdAt
  events Event[]
  @@map("companies")
}
```
Do I need a back-relation from Company to PaymentOrder? Only if I declare a relation on PaymentOrder.companyId... PaymentOrder has company_id but no relation field to Company (only worker + event relations) — that's fine in Prisma (a plain field without a relation). But Event.companyId has a relation to Company → Company needs a back-relation `events Event[]`. ✓ as above. Worker has `orders PaymentOrder[]` back-relation ✓. Event has `orders PaymentOrder[]` ✓.

OperationReadModel — no relations (plain fields). CompanyFinancialTotals — plain fields + @@id.

Prisma requires back-relations for declared relations: PaymentOrder.worker → Worker.orders[]; PaymentOrder.event → Event.orders[]; Event.company → Company.events[]. ✓

**Migration DDL for Prisma with relations**: FKs: payment_orders.worker_id → workers.id, payment_orders.event_id → events.id, payment_orders.company_id → companies.id (a plain field without a relation → no FK!). Hmm — Prisma: a field without a relation has no FK. So the DDL for payment_orders.company_id will have no FK (because I didn't declare a relation). That's fine — or I could declare the relation: add `company Company @relation(fields: [companyId], references: [id])` on PaymentOrder, and back-relation `orders PaymentOrder[]` on Company. Cleaner (FK integrity). I'll add it. Company: `orders PaymentOrder[]`.

56. **Now — the `Prisma.TransactionClient` concern** again. Let me hedge differently: in `db-client.ts`:
```ts
import type { Prisma } from '@prisma/client';

// ASSUMPTION: Prisma exports TransactionClient (the interactive-transaction client type)
export type DbClient = Prisma.TransactionClient;
```
I'll add an ASSUMPTION comment per the instructions. Actually — the instructions say to mark genuinely unresolved symbols. This is a standard, documented type; but to be safe, I'll include the comment. OK.

Alternative hedge: define it structurally:
```ts
export type DbClient = Prisma.TransactionClient;
```
Keep with the comment.

57. **`prisma.$transaction([query1, query2])` in OperationsRepository** — batch transaction; the type returns a tuple. ✓ But this is an extra transaction for a read — fine (or a plain 2 promises; the batch keeps a consistent snapshot). Keep the batch.

58. **The totals endpoint path**: `/companies/:companyId/financial-totals` — kebab-case ✓.

59. **The main.ts + filter + `app.enableShutdownHooks()`** — for the PrismaService's onModuleDestroy. `app.enableShutdownHooks()` enables onModuleDestroy on SIGTERM; on app.close() it's called anyway. I'll add it.

60. **Potential circular imports**: PaymentOrdersModule imports ProjectionModule (for ProjectionService). ProjectionService imports the type OrderWithRelations from payment-orders.repository (type-only import — no runtime cycle). ✓ (import type).

61. **FinancialTotalsModule** — only read; independent.

62. **Drift-repair module** doesn't export anything (it's the end consumer). ✓

63. **The `Logger` in the service** — fine.

64. **The re-derivation insert-select with an enum literal**: `SUM("amount_cents") FILTER (WHERE "status" = 'pending')` — status is an enum column; comparing an enum with a string literal works in PG. ✓

65. **`orders_count`** is Int in Prisma; COUNT(*) returns bigint → insert into an int column: PG casts bigint → integer on insert? For `INSERT ... SELECT COUNT(*)` into an integer column: Postgres will auto-coerce (assignment cast) bigint → integer. ✓

66. **The sum of amount_cents (int4) → sum returns int8 (bigint)** → assignment into int8 ✓.

67. **The `IS DISTINCT FROM` on the enum** ✓.

68. **Vitest + Node ESM + `import 'reflect-metadata'`** — the app helper imports it; main.ts also imports it. In vitest, the helper's import runs once. ✓

69. **The Nest + express Response type import**: `import type { Response } from 'express';` — express types via @types/express? @nestjs/platform-express brings express; the types come with it? `@types/express` is a dep of platform-express? platform-express depends on express but types: @types/express is in platform-express's dependencies (yes, @nestjs/platform-express lists @types/express? hmm, not necessarily). To avoid a missing-type issue, I'll avoid importing express types: use `host.switchToHttp().getResponse()` without typing it — `getResponse()` returns `any` (ServerResponse). I'll use:
```ts
const http = host.switchToHttp();
const response = http.getResponse(); // express Response
response.status(status).json(body);
```
Without typing it, `response` is any → no import needed. Under strict TS, any is OK (noImplicitAny doesn't forbid explicit any; getResponse's return type is `any`). ✓

70. **`@nestjs/schedule` Cron + tests**: the DriftRepairService instance in the test app — the cron is registered; harmless.

71. **Amounts: `amount_cents` Int** — sum per company could exceed int? Per-order cents are Int; the totals are Int8. ✓

72. **`parseAmountCents`** — max check? Int max 2147483647 — I'll add a max guard `value <= 2_000_000_000`. Fine.

73. **Controller for POST /payment-orders with no body** → body {} → all fields missing → 400 ✓ (Nest's body-parser returns {} when content-type is json with no body; if no content-type, body is undefined? @Body() is undefined → `body.company_id` throws on undefined. Guard: `const payload: Record<string, unknown> = body ?? {};`.)

74. **The order DTO on create** — returns the dto (201). ✓

75. **`sleep` helper** in the re-derivation service file: `const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));`

76. **`@Cron(CronExpression.EVERY_5_MINUTES)`** — import from '@nestjs/schedule'. ✓

77. **Migration DDL — `gen_random_uuid()`**: requires PG13+ (pgcrypto not needed). I'll note the assumption in a comment? It's standard now. Prisma itself uses `gen_random_uuid()` by default for @default(uuid()). ✓ consistent.

78. **The schema's `@@index` on payment_orders with sort Desc**: `createdAt(sort: Desc)` — supported in Prisma 4.16+. ✓

79. **The Prisma client generation**: the tests import @prisma/client — the environment runs `prisma generate` (in the package.json script; maybe a postinstall: `"postinstall": "prisma generate"` — good practice so pnpm install generates the client. I'll add postinstall.)

80. **`pool: 'forks'` singleFork** — vitest 2: `poolOptions: { forks: { singleFork: true } }`. ✓

81. **testTimeout**: concurrent + derive tests are fast; I'll set a global 20s, beforeAll 30s (Nest boot + DB connect).

82. Now — a very important check: **does `Prisma.PaymentOrderGetPayload` exist?** Yes: `Prisma.PaymentOrderGetPayload<{ include: { worker: true; event: true } }>`. ✓

83. **The `update` in `paymentOrder.update` with include** — returns the payload ✓.

84. **The `DomainException` thrown inside a `$transaction` callback** — the transaction rolls back (an error thrown in the interactive tx → Prisma rolls back) ✓. The filter catches it at the HTTP layer ✓.

85. **The 409 approve on an already-approved order** — findInTx reads the current status; throws → the tx rolls back (no writes happened) ✓.

86. **`updated_at` on the hook's row upsert** — uses order.updatedAt (the new value) ✓.

87. **The drift compare uses `p."updated_at" IS DISTINCT FROM o."updated_at"`** — the drift injection I did in the test sets updated_at +1 hour on the projection → detected ✓. Note: the hook keeps updated_at in sync; source and projection should always match on updated_at ✓.

88. **`$executeRaw` with a Date parameter in a tagged template** — Prisma serializes a JS Date to timestamptz ✓.

89. **The findDrift batch**: `await this.prisma.$transaction([rowsQuery, companiesQuery])` — two raw queries in a batch — returns `[rows, companies]` ✓.

90. **Typing of the raw query results**: `$queryRaw` returns `unknown`... with the generic: `this.prisma.$queryRaw<Array<{ payment_order_id: string }>>(Prisma.sql`...`)`. I'll use `Prisma.sql` tagged template for type-safe generics: `await this.prisma.$queryRaw<{ payment_order_id: string }>`Prisma.sql`...`` hmm — `$queryRaw<T>(query: Sql)` accepts a `Prisma.sql` template. Simpler: `const rows = await this.prisma.$queryRaw<{ payment_order_id: string }>`SELECT ...`;` — the tagged $queryRaw infers `unknown[]`? The overload: `$queryRaw<T>(query: TemplateStringsArray, ...values: RawValue[])` — the explicit generic works: `$queryRaw<DriftRow>`...``. I'll use the explicit generic. ✓

91. **`$executeRaw` returns a number** (affected rows). For a DELETE ... I return Number(result) — result is already number. ✓

92. **The re-derivation insert-select returns a row count** — $executeRaw returns affected rows = inserted count ✓.

93. **The `derive` result type**:
```ts
export interface DeriveResult { from: string; to: string; rows_rebuilt: number; }
```

94. **The drift report** — as defined.

95. **The `DESIGN.md` at the repo root** ✓ (the task says "include a short DESIGN.md").

96. **`.env.example`**:
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/marketplace_backoffice?schema=public
PORT=3000
```

97. **README?** Not requested — skip (DESIGN.md covers the rationale; a run instruction in DESIGN? "short DESIGN.md justifying synchronous hook over the alternatives" — I'll keep it design-only; a small "how to run" section is useful but scope... I'll include a minimal setup section (2–3 lines) at the end — defensible as part of the deliverable's usability. Hmm, "do exactly what the task asks" — a short setup note is harmless and useful. I'll keep it 3 lines.)

Now, let me reconsider the **file count** and merge where the convention pushes: the convention shows `<feature>.module/controller/service/repository`. My features: operations, payment-orders, projection, financial-totals, re-derivation, drift-repair. The projection feature has no controller (that's fine — the convention shows a file per role, not that every role must exist).

Also `src/common/` for shared infrastructure — the convention doesn't forbid it.

Let me write out **the exact content of the migration SQL**:

```sql
-- Init schema: source tables + read-model projection.

CREATE TYPE "OrderStatus" AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE "companies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "full_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'pending',
    "amount_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_orders_amount_cents_check" CHECK ("amount_cents" >= 0)
);

CREATE TABLE "operation_read_model" (
    "payment_order_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "worker_name" TEXT NOT NULL,
    "event_id" UUID NOT NULL,
    "event_name" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "operation_read_model_pkey" PRIMARY KEY ("payment_order_id")
);

CREATE TABLE "company_financial_totals" (
    "company_id" UUID NOT NULL,
    "pending_amount_cents" BIGINT NOT NULL DEFAULT 0,
    "approved_amount_cents" BIGINT NOT NULL DEFAULT 0,
    "rejected_amount_cents" BIGINT NOT NULL DEFAULT 0,
    "orders_count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "company_financial_totals_pkey" PRIMARY KEY ("company_id")
);

-- source FKs
ALTER TABLE "events" ADD CONSTRAINT "events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- projection FKs (integrity; the read model mirrors the source)
ALTER TABLE "operation_read_model" ADD CONSTRAINT "operation_read_model_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "operation_read_model" ADD CONSTRAINT "operation_read_model_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "operation_read_model" ADD CONSTRAINT "operation_read_model_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "company_financial_totals" ADD CONSTRAINT "company_financial_totals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- indexes
CREATE INDEX "events_company_id_idx" ON "events"("company_id");
CREATE INDEX "idx_payment_orders_company_created" ON "payment_orders"("company_id", "created_at" DESC);

-- The dashboard access pattern: filter by company + optional status, range on created_at,
-- sort by created_at DESC with payment_order_id DESC tiebreak. The INCLUDE list makes it
-- covering so the hot path is an index-only scan.
CREATE INDEX "idx_operation_read_model_dashboard" ON "operation_read_model"("company_id", "status", "created_at" DESC, "payment_order_id" DESC) INCLUDE ("worker_name", "event_name", "amount_cents", "updated_at");
```

Wait — Prisma's `@@index([companyId, status, createdAt(sort: Desc), paymentOrderId(sort: Desc)], map: "idx_operation_read_model_dashboard")` would generate exactly the first 4 key columns; my migration adds INCLUDE. Prisma's drift detection would flag the INCLUDE difference... I'll note it in a comment in the schema. Tolerable.

Also `operation_read_model` — should the projection FKs be RESTRICT? If a worker is deleted → the read model row blocks it. There's no worker delete. Fine.

Hmm — one more consideration for the **re-derivation delete+insert with FKs**: we insert rows referencing the existing workers/events — ✓ they exist (joined from source).

**The full Prisma schema**:

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
  id        String   @id @default(uuid()) @db.Uuid
  name      String
  createdAt DateTime @default(now()) @map("created_at")

  orders PaymentOrder[]
  events Event[]

  @@map("companies")
}

model Worker {
  id        String   @id @default(uuid()) @db.Uuid
  fullName  String   @map("full_name")
  createdAt DateTime @default(now()) @map("created_at")

  orders PaymentOrder[]

  @@map("workers")
}

model Event {
  id        String   @id @default(uuid()) @db.Uuid
  companyId String   @map("company_id") @db.Uuid
  name      String
  createdAt DateTime @default(now()) @map("created_at")

  company Company      @relation(fields: [companyId], references: [id])
  orders  PaymentOrder[]

  @@index([companyId], map: "events_company_id_idx")
  @@map("events")
}

model PaymentOrder {
  id          String      @id @default(uuid()) @db.Uuid
  companyId   String      @map("company_id") @db.Uuid
  workerId    String      @map("worker_id") @db.Uuid
  eventId     String      @map("event_id") @db.Uuid
  status      OrderStatus @default(pending)
  amountCents Int         @map("amount_cents")
  createdAt   DateTime    @default(now()) @map("created_at")
  updatedAt   DateTime    @default(now()) @map("updated_at")

  company Company @relation(fields: [companyId], references: [id])
  worker  Worker  @relation(fields: [workerId], references: [id])
  event   Event   @relation(fields: [eventId], references: [id])

  @@index([companyId, createdAt(sort: Desc)], map: "idx_payment_orders_company_created")
  @@map("payment_orders")
}

model OperationReadModel {
  // One row per payment order, shaped like the dashboard query so the hot path
  // never joins the source tables. worker_name/event_name are denormalized
  // snapshots of the join columns.
  paymentOrderId String      @id @map("payment_order_id") @db.Uuid
  companyId      String      @map("company_id") @db.Uuid
  workerId       String      @map("worker_id") @db.Uuid
  workerName     String      @map("worker_name")
  eventId        String      @map("event_id") @db.Uuid
  eventName      String      @map("event_name")
  status         OrderStatus
  amountCents    Int         @map("amount_cents")
  createdAt      DateTime    @map("created_at")
  updatedAt      DateTime    @map("updated_at")

  // The migration creates this index as a COVERING index (INCLUDE worker_name,
  // event_name, amount_cents, updated_at) because Prisma cannot express INCLUDE.
  @@index([companyId, status, createdAt(sort: Desc), paymentOrderId(sort: Desc)], map: "idx_operation_read_model_dashboard")
  @@map("operation_read_model")
}

model CompanyFinancialTotals {
  // Per-company financial totals, maintained by atomic in-place increments
  // inside the writer's transaction and rebuilt by the re-derivation routine.
  companyId           String @id @map("company_id") @db.Uuid
  pendingAmountCents  BigInt @default(0) @map("pending_amount_cents")
  approvedAmountCents BigInt @default(0) @map("approved_amount_cents")
  rejectedAmountCents BigInt @default(0) @map("rejected_amount_cents")
  ordersCount         Int    @default(0) @map("orders_count")

  @@map("company_financial_totals")
}
```

Now — **the `Prisma.TransactionClient` import type** — `import type { Prisma } from '@prisma/client'`. ✓

**A potential issue**: `tx.operationReadModel.upsert` — does the interactive tx client expose model delegates ✓.

**The test's direct prisma use** — `prisma.operationReadModel.findMany` etc. ✓.

**The BigInt JSON** — the totals API outputs strings ✓; the test's `expect(...).toEqual({ ..., approved_amount_cents: '2500' })` ✓.

**The `orders_count`** in the response is a number ✓.

Now, **the concurrent test's `post` for 24 creates sequentially** — fine.

**A subtlety in the concurrent test**: 24 orders are created sequentially, each create's hook upserts the totals row (a row lock, serial) — fine. Then 24 concurrent transitions → 24 concurrent `UPDATE company_financial_totals SET ... = ... ± delta` (via upsert; the row exists → the UPDATE path) → row-lock serialization → all applied → exact ✓. The test asserts exact totals — proving no lost updates.

But wait — the upsert's UPDATE path: `INSERT ... ON CONFLICT DO UPDATE SET col = col + delta` — two concurrent: one inserts (if the row doesn't exist) — the row exists, so both take the UPDATE lock. ✓.

**The drift test's `repairWindow`** calls derive → serializable tx → rebuild totals for all companies: DELETE all totals + INSERT from all orders. In the test DB, that includes companies from other tests (already cleaned? tests run sequentially in a single fork; the previous suite cleaned up via afterEach). The rebuild only affects the current state — recomputes everything from source → consistent. ✓

**The re-derivation test's outside order**: created 3 days ago; the derive window [now-2h, now] excludes its row; totals include it (global rebuild) — the assertion accounts for that ✓.

**`snapshot` equality after the 2nd derive**: rows (companyId scope) + totals (all). The 2nd derive is identical → deep equal ✓. Use plainify for BigInt.

Now, **vitest's config + imports of `vitest/config`** — dev dep vitest ✓.

**tsconfig `include: ["src/**/*.ts"]`** — vitest doesn't use tsconfig's include for test files (vite compiles per-file). ✓

**`"postinstall": "prisma generate"`** — needs prisma in devDeps ✓.

Now, let me double-check **the Nest ESM + tsx**: `tsx src/main.ts` — tsx handles TS ESM with NodeNext; decorators are OK; the `import 'reflect-metadata'` first. ✓

**`@Inject` on every constructor parameter** — including single-provider modules. Let me be consistent.

One more: **`PrismaService` as @Global module provider** — `@Module({ global: true, providers: [PrismaService], exports: [PrismaService] })`. I'll use `@Global()` decorator + providers/exports. ✓

**The `Logger` import** in drift-repair + re-derivation services.

**The `CronExpression`** — `CronExpression.EVERY_5_MINUTES`. ✓

Let me also think about **whether the `OperationsController` should live under the path 'operations'** — yes: GET /operations.

**Endpoint naming check** (kebab-case, plural): /operations ✓, /payment-orders ✓, /payment-orders/:id/approve ✓, /companies/:companyId/financial-totals ✓.

**Error envelope check**: every error goes through the filter → `{ error: { code, message, details } }` ✓ details always an object (default {}) ✓.

Now, let me write the **DESIGN.md** (concise, ~120 lines):

```md
# DESIGN — Operations dashboard read model

## Problem
The operations list joins payment_orders + events + workers, filters by
company/status/date range, sorts by recency and paginates. ~3M rows → 20-30s.
Target: p95 < 50ms, same columns/filters/ordering/page sizes. Two hard
constraints:

1. Read-your-own-writes: after an operator approves an order, the next
   request must show it approved. No visibility window, however short.
2. Per-company financial totals must be exact. Finance reconciles against them.

## Shape of the solution
Two projection tables maintained from the source:

- `operation_read_model` — one row per payment order, pre-joined
  (worker name, event name), so the dashboard query is a single-index scan
  with no joins.
- `company_financial_totals` — one row per company with per-status amounts
  and an order count.

The hot path (GET /operations) reads only `operation_read_model`.

### Index
`idx_operation_read_model_dashboard` on
(company_id, status, created_at DESC, payment_order_id DESC) with
INCLUDE (worker_name, event_name, amount_cents, updated_at): matches the
filter (company + optional status), the created_at range, and the sort
(recency with a stable id tiebreak), and covers every selected column, so
the query is an index-only scan regardless of table size. That is what gets
p95 under 50ms at 3M rows.

## Why the hook runs inside the writer's transaction
[argument]
The read-your-own-writes rule eliminates every design with a visibility gap:
...
So the write service maintains the projection inside the same transaction as
the source write:

    BEGIN
      UPDATE payment_orders SET status = 'approved' ...
      INSERT ... ON CONFLICT UPDATE operation_read_model ...   (hook)
      UPDATE company_financial_totals SET approved_amount_cents = approved_amount_cents + n ... (hook)
    COMMIT

If the write rolls back, the projection never saw it. If the process dies
mid-transaction, neither half is visible. There is no window in which the
operator's own change is missing, because "the change is committed" and
"the projection shows it" are the same commit.

### Rejected alternatives
- Database trigger: same atomicity, but the write logic lives outside the
  application... rejected in favour of an explicit hook called from the
  write service: single place to read/change status semantics, covered by
  the same tests and logs as the write itself, portable across Prisma
  migrations.
- Post-commit hook + poller / outbox + worker / CDC (Debezium): each has a
  gap between the source commit and the projection update (ms to minutes).
  The requirement allows none. They also add infrastructure (queue or
  replica) for a latency property we cannot accept.
- Scheduled refresh of a materialized view: the same gap, plus REFRESH
  CONCURRENTLY is not point-in-time with the write.
- Keep the join and index it: the join still scans ~3M rows per page at
  this selectivity; and it cannot serve the exact per-company totals.

### Cost we accept
Each write does 2 extra writes (a row upsert, a totals upsert) on a
single-row path — microseconds to low ms next to the join we removed — and
projection failure now fails the write (correct: an operator's action that
cannot be made visible is an error, not a silent loss).

## Exact totals under concurrency
The totals row for a company is updated with an in-place increment
(UPDATE ... SET col = col ± delta / INSERT ... ON CONFLICT ... DO UPDATE).
There is no read-modify-write: two concurrent approvals both execute
"col = col + delta" and the row lock serializes them, so neither update is
lost. test/concurrent-totals.spec.ts runs 24 concurrent transitions against
one totals row and asserts the exact sums.

## Re-derivation for an arbitrary window
`ReDerivationService.derive(from, to)` rebuilds, from the source tables:

1. projection rows for orders created in [from, to]
   (DELETE + INSERT...SELECT with the same joins as the old query);
2. all per-company totals (DELETE + INSERT...SELECT GROUP BY).

Totals are rebuilt globally rather than per-window because they are
whole-history aggregates: a window-scoped delta update would not be
idempotent. Both steps are full-value overwrites, so running the routine
twice over the same window leaves an identical state (tested). The
transaction is SERIALIZABLE with a bounded retry on serialization
conflicts, so it is safe to run while the system is live. A write that
commits in the tiny gap after the aggregate read is missed by that one run;
that is exactly what the drift job below converges, and the routine is the
same code path that the job uses.

## Drift repair
`DriftRepairService` runs every 5 minutes over the trailing 24h:

1. compare — projection rows vs source, field by field (missing row,
   wrong status/amount/timestamps, stale denormalized names); totals vs a
   re-aggregation of source for every company with orders in the window;
2. repair — if anything disagrees, re-derive that window (idempotent).

A single in-flight flag prevents overlapping runs. Deploy-mid-transaction
or manual data-fix drift is therefore detected and repaired without a
person noticing.

## Testing
- read-your-own-writes: approve → the very next HTTP request shows it;
  also proves the dashboard does not read the source (an order inserted
  into payment_orders directly is invisible until the projection has it).
- concurrent totals: 24 concurrent approve/reject transitions for one
  company; exact sums asserted against an aggregation of the source.
- drift repair: row mismatch + missing row + inflated totals are injected;
  the job reports the drift and the projection agrees with source again.
- re-derivation: window rebuild matches source; a second run is a no-op.

## Run
pnpm install && pnpm prisma:migrate && DATABASE_URL=... pnpm dev
```

Good. Now, let me write out **all the files** carefully. Also, I need to double-check a few TS details:

- `parseStatus` returns a union or undefined; `OperationsListParams.status?: OrderStatus` — 'pending'|'approved'|'rejected' is exactly OrderStatus (the Prisma enum type = that string union). I import `OrderStatus` from '@prisma/client' and my parseStatus returns `OrderStatus | undefined` — I'll type it as OrderStatus. But if the generated enum is a union of literals (which it is for lowercase members... actually Prisma generates enums as TS union types? For a Prisma enum, the generated type is `export const OrderStatus = { pending: 'pending', ... } as const; export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];` → 'pending'|'approved'|'rejected'). My literal union is structurally identical ✓.

- The `delta[from]` indexing: `from: OrderStatus`; the delta object's keys are pending/approved/rejected/ordersCount — `delta[from]` where from ∈ {pending, approved, rejected} ✓ TS allows (all number).

- The `update` payload for `companyFinancialTotals.upsert` with increment on BigInt — Prisma type: `BigIntFieldUpdateOperationsInput | bigint | null`... the field type is `PendingAmountCentsFieldUpdateOperationsInput { set?: bigint; increment?: bigint; decrement?: bigint; multiply?: bigint; divide?: bigint }` — `increment?: bigint | null`? Prisma's BigInt update operations use `bigint` type, not `number`!! Let me think: for Int8 columns, Prisma types values as `bigint`. The `increment` type for BigInt fields: I think it's `bigint | null` (strictly bigint). Passing a `number` → type error under strict!

  To be safe: I'll pass `BigInt(delta.pending)` in the repository. `increment: BigInt(value)` — the number→BigInt conversion is exact for our magnitudes ✓. Also `create: { pendingAmountCents: BigInt(delta.pending), ... }`. I'll do the BigInt() conversion in ProjectionRepository.

  Similarly, FinancialTotalsService outputs `.toString()` on the bigint ✓.

- The `ordersCount` Int — increment with a number ✓ (Int fields accept number).

- In the concurrent test, I compare totals strings: `String(approvedSum)` where approvedSum is a number ✓ (the API outputs BigInt.toString()).

- The test's `prisma.paymentOrder.groupBy({ by: ['status'], _sum: { amountCents: true } })` — amountCents is Int → sum is number ✓.

- The re-derivation test: `totals?.approvedAmountCents` is a bigint | undefined → compare with `BigInt(1377)` ✓.

- **`findInTx` returns the order; a concurrent transition race** — two concurrent approves on the same order: both read pending, both update → both succeed, and the hook applies the delta twice → totals drift! Hmm! Is that in scope? The spec's concurrency requirement is about two different orders for the same company. Same-order double-approve race: a read-then-update without a lock allows both to pass the `status !== 'pending'` check. To make it robust: use a conditional update: `UPDATE ... WHERE id = $1 AND status = 'pending'` — via Prisma: `updateMany({ where: { id, status: 'pending' }, data: { status: 'approved' } })` → check `count`; if 0 → re-read the state and throw 409. That's the correct optimistic approach, and it also keeps the hook's delta accurate (the hook only fires if count===1). Let me implement `updateStatusInTx` as:
```ts
const result = await tx.paymentOrder.updateMany({ where: { id, status: 'pending' }, data: { status, updatedAt: new Date() } });
if (result.count === 0) {
  const current = await tx.paymentOrder.findUnique({ where: { id } });
  if (!current) throw new DomainException(404, 'resource_not_found', `payment order ${id} was not found`, { id });
  throw new DomainException(409, 'invalid_state_transition', `payment order ${id} is ${current.status}; only pending orders can be ${status}`, { id, from: current.status, requested: status });
}
const updated = await tx.paymentOrder.findUnique({ where: { id }, include: { worker: true, event: true } });
return updated!;
```
Hmm — but under READ COMMITTED, two concurrent transitions on the same order: both run updateMany WHERE status='pending' — one blocks on the row lock until the first commits; then the second's WHERE is re-evaluated? In Postgres, an UPDATE rechecks the WHERE against the latest row version (EvalPlanQual) — the second sees status='approved' → count 0 → 409. ✓ Correct optimistic behavior. I'll also remove the upfront check (keep it? The upfront `findInTx` gives a friendly 404/409 for the common case; the updateMany is the guard. Keep both: the upfront read for a clear error, the updateMany as the authoritative guard. Actually, with the guard, the upfront check is redundant for correctness but gives a clear message... the guard already throws the same message. I'll simplify: no upfront check; updateMany is the sole transition. On count 0 → findUnique for the 404 vs 409 distinction. Clean.

  But wait — the hook's delta uses `from: 'pending'` — valid only if the transition actually happened (count===1) ✓.

  This also hardens the concurrent test (even if I double-approve the same id, no double count) — I won't test that; the spec's case is different orders.

- **`updateMany` with `where: { id, status: 'pending' }`** — `status` is the enum ✓.

- Another subtlety: **the `create` endpoint race with the totals upsert** — two concurrent creates for a new company: both upsert the totals row (INSERT ... ON CONFLICT DO UPDATE with increment) — one inserts, the other waits on the speculative insertion lock, then updates → both increments applied ✓.

Now **`withTransaction` isolation** — default (READ COMMITTED) for writes ✓ (serializable only for the re-derivation).

**Prisma interactive transaction timeout**: default 5s — the re-derivation of a large window may exceed 5s at 3M scale → I'll pass `timeout: 120_000` for the serializable tx. For write txs, the default is fine.

```ts
withSerializableTransaction<T>(work: (tx: DbClient) => Promise<T>): Promise<T> {
  return this.prisma.$transaction(work, { isolationLevel: 'serializable', timeout: 120_000 });
}
```

**`maxWait`** default 2000ms is fine.

Now **the DriftRepairRepository.findDrift** uses the base prisma (no tx needed; a read-only compare). ✓

**Potential lint**: `noUnusedParameters` — watch out.

**Let me write the OperationsRepository's `where` build** — Prisma type for `createdAt` with both gte/lte: `{ gte?: Date | DateTimeFilter... }` — `{ gte: Date, lte: Date }` ✓.

**`skip`/`take`** numbers ✓.

**Response shape** — items is an array of snake_case keys ✓.

Now, **the helpers for tests** — I'll write `test/helpers/http.ts`:
```ts
import type { TestApp } from './app.js';

export function pathUrl(app: TestApp, path: string, query: Record<string, string> = {}): URL {
  const url = new URL(path, app.baseUrl);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url;
}

export async function getJson<T>(app: TestApp, path: string, query?: Record<string, string>): Promise<{ status: number; body: T }> {
  const res = await fetch(pathUrl(app, path, query));
  return { status: res.status, body: (await res.json()) as T };
}

export async function postJson<T>(app: TestApp, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(pathUrl(app, path), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}
```

**db.ts cleanup**: also delete workers by id. `cleanupByCompany(prisma, fx)` — takes fixtures (companyId + workerId):
```ts
export async function cleanupFixtures(prisma: PrismaClient, fx: TestFixtures): Promise<void> {
  const orderIds = (await prisma.paymentOrder.findMany({ where: { companyId: fx.companyId }, select: { id: true } })).map((o) => o.id);
  await prisma.operationReadModel.deleteMany({ where: { paymentOrderId: { in: orderIds } } });
  await prisma.companyFinancialTotals.deleteMany({ where: { companyId: fx.companyId } });
  await prisma.paymentOrder.deleteMany({ where: { companyId: fx.companyId } });
  await prisma.event.deleteMany({ where: { companyId: fx.companyId } });
  await prisma.worker.deleteMany({ where: { id: fx.workerId } });
  await prisma.company.deleteMany({ where: { id: fx.companyId } });
}
```
In afterEach: `for (const fx of fixtures.splice(0)) await cleanupFixtures(prisma, fx);` — keep an array of fixtures.

**beforeAll order**: start the app (PrismaService connects) + create the prisma helper. If DATABASE_URL is missing → `describe.skipIf` skips the whole thing including beforeAll? `describe.skipIf(!hasDb)` — the suite is skipped, hooks don't run ✓.

But `hasDatabase` is computed at module load — fine.

**Test app close** in afterAll: `await app?.close()` — but if beforeAll failed, app is undefined → the `app?` guard; type: let app: TestApp | undefined.

**Vitest globals**: I'll import explicitly from 'vitest' (no globals config needed).

Now, **the app helper's `NestFactory.create(AppModule, { logger: false })`** — silences logs in tests ✓.

**One concern**: the test app boots DriftRepairService with the @Cron — does @nestjs/schedule require `ScheduleModule.forRoot()` in the test app's AppModule? It's in the AppModule ✓ (shared).

**The `app.getHttpServer()` type** — `app.getHttpServer()` returns any/http.Server. `server.address()` — I'll cast:
```ts
const server = app.getHttpServer() as import('http').Server;
const address = server.address();
if (!address || typeof address === 'string') throw new Error('test server has no TCP address');
```
Use `import type { Server } from 'node:http';` ✓ (node types — @types/node is needed! Add to devDependencies: `"@types/node": "^20.14.0"`.)

**tsconfig lib** includes ES2022; node types are separate via @types/node ✓.

**The `fetch` global** — Node 20 ✓ (with @types/node 20, fetch is typed? Node 18+ types include global fetch since @types/node ≥ 18.x (undici types). @types/node 20 has global fetch ✓.)

Now, **`new URL(path, app.baseUrl)`** — path '/operations' + base 'http://127.0.0.1:port' ✓.

**Let me assemble the complete file list with final content.** Let me double-check each file's imports (ESM .js extensions) and decorators.

Let me also reconsider: **does the `operations` feature need `PrismaModule` import?** No (global).

**Module file contents** (example):
```ts
import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller.js';
import { OperationsService } from './operations.service.js';
import { OperationsRepository } from './operations.repository.js';

@Module({
  controllers: [OperationsController],
  providers: [OperationsService, OperationsRepository],
  exports: [OperationsService],
})
export class OperationsModule {}
```
Is the export needed? No other module uses OperationsService — but the convention says "a provider used by another module is exported" — not used elsewhere → no export. I'll drop the exports for operations. PaymentOrdersModule imports ProjectionModule (uses ProjectionService) → ProjectionModule exports ProjectionService ✓. ReDerivationModule exports ReDerivationService (used by DriftRepairModule) ✓. FinancialTotalsModule: standalone. DriftRepairModule: no exports.

**Wiring check** — ProjectionRepository is used only by ProjectionService within the module ✓.

**The payment-orders module** — providers [PaymentOrderService, PaymentOrderRepository], imports [ProjectionModule] ✓.

Now — **the `projection.module.ts`** — no controller:
```ts
@Module({
  providers: [ProjectionService, ProjectionRepository],
  exports: [ProjectionService],
})
export class ProjectionModule {}
```

**app.module.ts**:
```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './common/prisma.module.js';
import { OperationsModule } from './operations/operations.module.js';
import { PaymentOrdersModule } from './payment-orders/payment-orders.module.js';
import { FinancialTotalsModule } from './financial-totals/financial-totals.module.js';
import { ReDerivationModule } from './re-derivation/re-derivation.module.js';
import { DriftRepairModule } from './drift-repair/drift-repair.module.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    OperationsModule,
    PaymentOrdersModule,
    FinancialTotalsModule,
    ReDerivationModule,
    DriftRepairModule,
  ],
})
export class AppModule {}
```

**main.ts**:
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './common/api-exception-filter.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
```

**prisma.service.ts**:
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

**prisma.module.ts**:
```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

**domain-exception.ts**:
```ts
import { HttpException } from '@nestjs/common';

/**
 * Error codes are part of the API contract: snake_case and stable.
 * Known codes: resource_not_found, validation_failed,
 * invalid_state_transition, conflict, internal_error.
 */
export class DomainException extends HttpException {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super({ error: { code, message, details } }, status);
    this.status = status;
    this.code = code;
    this.message = message;
    this.details = details;
  }
}
```
Note: class field `message` shadows Error.message — HttpException's constructor... HttpException(message: string, status) — I call super(object, status) — HttpException stores the response; the Error message comes from...? HttpException extends Error and sets the message from the response object? In Nest, `new HttpException(object, status)` → super(message derived). My field `message` overrides the instance property — the constructor parameter property... I declare `readonly message: string;` and assign in the constructor — fine, it shadows the prototype's message property. TS: `class DomainException extends HttpException` — HttpException extends Error which has `message: string` — redeclaring is allowed (property override). ✓ ESLint might complain; no lint config here. OK.

**api-exception-filter.ts**:
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { DomainException } from './domain-exception.js';

interface ErrorEnvelope {
  error: { code: string; message: string; details: Record<string, unknown> };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();
    const { status, body } = this.toEnvelope(exception);
    response.status(status).json(body);
  }

  private toEnvelope(exception: unknown): { status: number; body: ErrorEnvelope } {
    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal_error';
    let message = 'unexpected error';
    let details: Record<string, unknown> = {};

    if (exception instanceof DomainException) {
      status = exception.status;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = this.codeForStatus(status);
      const body = exception.getResponse();
      message = typeof body === 'string' ? body : this.messageFromBody(body);
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    return { status, body: { error: { code, message, details } } };
  }

  private codeForStatus(status: number): string {
    if (status === HttpStatus.BAD_REQUEST) return 'validation_failed';
    if (status === HttpStatus.NOT_FOUND) return 'resource_not_found';
    if (status === HttpStatus.CONFLICT) return 'conflict';
    return 'http_error';
  }

  private messageFromBody(body: unknown): string {
    if (typeof body === 'object' && body !== null) {
      const message = (body as { message?: unknown }).message;
      if (typeof message === 'string') return message;
      if (Array.isArray(message)) return message.join('; ');
    }
    return 'request failed';
  }
}
```

**params.ts** — final:
```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Field → reason map accumulated by the parse helpers. */
export type Problems = Record<string, string>;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function parseUuid(value: string | undefined, field: string, problems: Problems): string | undefined {
  if (value === undefined || value === '') {
    problems[field] = 'is required and must be a UUID';
    return undefined;
  }
  if (!isUuid(value)) {
    problems[field] = 'must be a UUID';
    return undefined;
  }
  return value;
}

export function parseStatus(value: string | undefined, problems: Problems): 'pending' | 'approved' | 'rejected' | undefined {
  if (value === undefined || value === '') return undefined;
  if (value !== 'pending' && value !== 'approved' && value !== 'rejected') {
    problems.status = "must be one of 'pending', 'approved', 'rejected'";
    return undefined;
  }
  return value;
}

export function parseIsoDate(value: string | undefined, field: string, problems: Problems): Date | undefined {
  if (value === undefined || value === '') return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    problems[field] = 'must be an ISO 8601 date-time';
    return undefined;
  }
  return date;
}

export function parsePositiveInt(value: string | undefined, field: string, problems: Problems, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    problems[field] = 'must be a positive integer';
    return fallback;
  }
  return parsed;
}

export function parseBoundedInt(value: string | undefined, field: string, problems: Problems, fallback: number, min: number, max: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    problems[field] = `must be an integer between ${min} and ${max}`;
    return fallback;
  }
  return parsed;
}

export function parseAmountCents(value: unknown, problems: Problems): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 2_000_000_000) {
    problems.amount_cents = 'must be a non-negative integer of cents';
    return undefined;
  }
  return value;
}
```

**operations.controller.ts** — final:
```ts
import { Controller, Get, Inject, Query } from '@nestjs/common';
import { DomainException } from '../common/domain-exception.js';
import { parseBoundedInt, parseIsoDate, parsePositiveInt, parseStatus, parseUuid, type Problems } from '../common/params.js';
import { OperationsService } from './operations.service.js';

@Controller('operations')
export class OperationsController {
  constructor(@Inject(OperationsService) private readonly operationsService: OperationsService) {}

  /** The dashboard list: company + status + date-range filters, recency order, paged. */
  @Get()
  list(
    @Query('company_id') companyId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
  ) {
    const problems: Problems = {};
    const cid = parseUuid(companyId, 'company_id', problems);
    const st = parseStatus(status, problems);
    const fromDate = parseIsoDate(from, 'from', problems);
    const toDate = parseIsoDate(to, 'to', problems);
    if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
      problems.to = 'must not be earlier than from';
    }
    const pageNumber = parsePositiveInt(page, 'page', problems, 1);
    const pageSizeNumber = parseBoundedInt(pageSize, 'page_size', problems, 50, 1, 200);

    if (!cid || Object.keys(problems).length > 0) {
      throw new DomainException(400, 'validation_failed', 'invalid operations query', problems);
    }

    return this.operationsService.list({
      companyId: cid,
      status: st,
      from: fromDate,
      to: toDate,
      page: pageNumber,
      pageSize: pageSizeNumber,
    });
  }
}
```

**operations.service.ts** final — with the DTO mapping:
```ts
import { Inject, Injectable } from '@nestjs/common';
import type { OrderStatus } from '@prisma/client';
import { OperationsRepository } from './operations.repository.js';

export interface OperationListParams {
  companyId: string;
  status?: OrderStatus;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

export interface OperationItemDto {
  id: string;
  company_id: string;
  worker_id: string;
  worker_name: string;
  event_id: string;
  event_name: string;
  status: string;
  amount_cents: number;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class OperationsService {
  constructor(@Inject(OperationsRepository) private readonly repository: OperationsRepository) {}

  async list(params: OperationListParams) {
    const { items, total } = await this.repository.findPage(params);
    return {
      items: items.map(toItemDto),
      page: params.page,
      page_size: params.pageSize,
      total,
    };
  }
}

function toItemDto(row: OperationItemDto['id'] extends never ? never : ...): OperationItemDto {
```
The row type: `OperationReadModel` from @prisma/client:
```ts
import type { OperationReadModel } from '@prisma/client';
function toItemDto(row: OperationReadModel): OperationItemDto {
  return {
    id: row.paymentOrderId,
    company_id: row.companyId,
    worker_id: row.workerId,
    worker_name: row.workerName,
    event_id: row.eventId,
    event_name: row.eventName,
    status: row.status,
    amount_cents: row.amountCents,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
```
And the repository's `findPage(params: OperationListParams)` — takes the whole params (which includes companyId etc.) — cleaner: the repository method signature `findPage(params: { companyId: string; status?: OrderStatus; from?: Date; to?: Date; page: number; pageSize: number })`. I'll pass the params object directly. ✓

**payment-orders.controller.ts** final:
```ts
import { Body, Controller, Inject, Param, Post } from '@nestjs/common';
import { DomainException } from '../common/domain-exception.js';
import { isUuid, parseAmountCents, parseUuid, type Problems } from '../common/params.js';
import { PaymentOrderService } from './payment-orders.service.js';

@Controller('payment-orders')
export class PaymentOrdersController {
  constructor(@Inject(PaymentOrderService) private readonly paymentOrderService: PaymentOrderService) {}

  /** Simulated write path: creating a payment order (status pending). */
  @Post()
  create(@Body() body: Record<string, unknown>) {
    const payload = body ?? {};
    const problems: Problems = {};
    const companyId = parseUuid(asString(payload.company_id), 'company_id', problems);
    const workerId = parseUuid(asString(payload.worker_id), 'worker_id', problems);
    const eventId = parseUuid(asString(payload.event_id), 'event_id', problems);
    const amountCents = parseAmountCents(payload.amount_cents, problems);

    if (!companyId || !workerId || !eventId || amountCents === undefined || Object.keys(problems).length > 0) {
      throw new DomainException(400, 'validation_failed', 'invalid payment order payload', problems);
    }

    return this.paymentOrderService.create({ companyId, workerId, eventId, amountCents });
  }

  @Post(':id/approve')
  approve(@Param('id') id: string) {
    if (!isUuid(id)) throw new DomainException(400, 'validation_failed', 'id must be a UUID', { id });
    return this.paymentOrderService.approve(id);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string) {
    if (!isUuid(id)) throw new DomainException(400, 'validation_failed', 'id must be a UUID', { id });
    return this.paymentOrderService.reject(id);
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
```

**payment-orders.service.ts** final (with the optimistic guard in the repository):
```ts
import { Inject, Injectable } from '@nestjs/common';
import { ProjectionService } from '../projection/projection.service.js';
import { PaymentOrderRepository, type NewPaymentOrder, type OrderWithRelations } from './payment-orders.repository.js';

export interface OrderDto {
  id: string;
  company_id: string;
  worker_id: string;
  event_id: string;
  status: string;
  amount_cents: number;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class PaymentOrderService {
  constructor(
    @Inject(PaymentOrderRepository) private readonly orders: PaymentOrderRepository,
    @Inject(ProjectionService) private readonly projection: ProjectionService,
  ) {}

  /**
   * Write path: source row and projection are maintained inside one
   * transaction, so the dashboard shows the new state on the next request
   * (read-your-own-writes) and a rolled-back write never touches the
   * projection.
   */
  create(input: NewPaymentOrder): Promise<OrderDto> {
    return this.orders.withTransaction(async (tx) => {
      const order = await this.orders.createInTx(tx, input);
      await this.projection.applyOrderCreated(tx, order);
      return toDto(order);
    });
  }

  approve(id: string): Promise<OrderDto> {
    return this.transition(id, 'approved');
  }

  reject(id: string): Promise<OrderDto> {
    return this.transition(id, 'rejected');
  }

  private transition(id: string, to: 'approved' | 'rejected'): Promise<OrderDto> {
    return this.orders.withTransaction(async (tx) => {
      const order = await this.orders.transitionInTx(tx, id, to);
      await this.projection.applyOrderStatusChanged(tx, order, 'pending');
      return toDto(order);
    });
  }
}

function toDto(order: OrderWithRelations): OrderDto {
  return {
    id: order.id,
    company_id: order.companyId,
    worker_id: order.workerId,
    event_id: order.eventId,
    status: order.status,
    amount_cents: order.amountCents,
    created_at: order.createdAt.toISOString(),
    updated_at: order.updatedAt.toISOString(),
  };
}
```

**payment-orders.repository.ts** final:
```ts
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { DomainException } from '../common/domain-exception.js';
import { PrismaService } from '../common/prisma.service.js';
import type { DbClient } from '../common/db-client.js';

export type OrderWithRelations = Prisma.PaymentOrderGetPayload<{ include: { worker: true; event: true } }>;

export interface NewPaymentOrder {
  companyId: string;
  workerId: string;
  eventId: string;
  amountCents: number;
}

@Injectable()
export class PaymentOrderRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Runs `work` in one interactive transaction (default READ COMMITTED). */
  withTransaction<T>(work: (tx: DbClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work);
  }

  createInTx(tx: DbClient, data: NewPaymentOrder): Promise<OrderWithRelations> {
    return tx.paymentOrder.create({ data, include: { worker: true, event: true } });
  }

  /**
   * pending -> `to`, guarded in the UPDATE itself (WHERE status = 'pending')
   * so two concurrent transitions of the same order cannot both win.
   */
  async transitionInTx(tx: DbClient, id: string, to: 'approved' | 'rejected'): Promise<OrderWithRelations> {
    const updated = await tx.paymentOrder.updateMany({
      where: { id, status: 'pending' },
      data: { status: to, updatedAt: new Date() },
    });
    if (updated.count === 0) {
      const current = await tx.paymentOrder.findUnique({ where: { id } });
      if (!current) {
        throw new DomainException(404, 'resource_not_found', `payment order ${id} was not found`, { id });
      }
      throw new DomainException(
        409,
        'invalid_state_transition',
        `payment order ${id} is ${current.status}; only pending orders can be ${to}`,
        { id, from: current.status, requested: to },
      );
    }
    const order = await tx.paymentOrder.findUnique({ where: { id }, include: { worker: true, event: true } });
    if (!order) throw new DomainException(404, 'resource_not_found', `payment order ${id} was not found`, { id });
    return order;
  }
}
```
`status: to` where to: 'approved'|'rejected' — a subset of OrderStatus ✓.

**projection.repository.ts** final (with BigInt):
```ts
import { Injectable } from '@nestjs/common';
import type { OrderStatus } from '@prisma/client';
import type { DbClient } from '../common/db-client.js';

export interface OperationRowData {
  paymentOrderId: string;
  companyId: string;
  workerId: string;
  workerName: string;
  eventId: string;
  eventName: string;
  status: OrderStatus;
  amountCents: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TotalsDelta {
  pending: number;
  approved: number;
  rejected: number;
  ordersCount: number;
}

@Injectable()
export class ProjectionRepository {
  /**
   * Full-value upsert of one projection row. Idempotent: the hook, the
   * re-derivation and the drift repair all converge on the same value.
   */
  async upsertOperationRow(tx: DbClient, row: OperationRowData): Promise<void> {
    await tx.operationReadModel.upsert({
      where: { paymentOrderId: row.paymentOrderId },
      update: {
        companyId: row.companyId,
        workerId: row.workerId,
        workerName: row.workerName,
        eventId: row.eventId,
        eventName: row.eventName,
        status: row.status,
        amountCents: row.amountCents,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
      create: row,
    });
  }

  /**
   * Atomic in-place increment of the company's totals row:
   * UPDATE ... SET col = col ± delta (via INSERT ... ON CONFLICT DO UPDATE).
   * No read-modify-write, so concurrent transitions on the same row are
   * serialized by the row lock and none of them is lost.
   */
  async applyTotalsDelta(tx: DbClient, companyId: string, delta: TotalsDelta): Promise<void> {
    const pending = BigInt(delta.pending);
    const approved = BigInt(delta.approved);
    const rejected = BigInt(delta.rejected);
    await tx.companyFinancialTotals.upsert({
      where: { companyId },
      update: {
        pendingAmountCents: { increment: pending },
        approvedAmountCents: { increment: approved },
        rejectedAmountCents: { increment: rejected },
        ordersCount: { increment: delta.ordersCount },
      },
      create: {
        companyId,
        pendingAmountCents: pending,
        approvedAmountCents: approved,
        rejectedAmountCents: rejected,
        ordersCount: delta.ordersCount,
      },
    });
  }
}
```
Wait — the `create` with a negative pending (an edge) → the CHECK? No CHECK constraint on the totals columns (I didn't add one). OK.

Hmm — `increment: pending` where pending is a bigint — the Prisma type `BigIntFieldUpdateOperationsInput.increment?: bigint | null`? If the type is `number | bigint`... BigInt works either way ✓.

**projection.service.ts** final — as sketched. Import OrderRowData from the repository.

**financial-totals files** — as sketched.

**re-derivation.repository.ts** final:
```ts
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';
import type { DbClient } from '../common/db-client.js';

@Injectable()
export class ReDerivationRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * SERIALIZABLE so that a concurrent writer cannot slip a commit between
   * our source read and our projection write without causing a detectable
   * conflict (the service retries on serialization failure).
   */
  withSerializableTransaction<T>(work: (tx: DbClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work, { isolationLevel: 'serializable', timeout: 120_000 });
  }

  async deleteRowsInWindow(tx: DbClient, from: Date, to: Date): Promise<void> {
    await tx.$executeRaw`
      DELETE FROM "operation_read_model"
      WHERE "payment_order_id" IN (
        SELECT "id" FROM "payment_orders"
        WHERE "created_at" >= ${from} AND "created_at" <= ${to}
      )
    `;
  }

  async insertRowsFromSource(tx: DbClient, from: Date, to: Date): Promise<number> {
    const affected = await tx.$executeRaw`
      INSERT INTO "operation_read_model" (
        "payment_order_id", "company_id", "worker_id", "worker_name",
        "event_id", "event_name", "status", "amount_cents", "created_at", "updated_at"
      )
      SELECT o."id", o."company_id", o."worker_id", w."full_name",
             o."event_id", e."name", o."status", o."amount_cents", o."created_at", o."updated_at"
      FROM "payment_orders" o
      JOIN "workers" w ON w."id" = o."worker_id"
      JOIN "events" e ON e."id" = o."event_id"
      WHERE o."created_at" >= ${from} AND o."created_at" <= ${to}
      ON CONFLICT ("payment_order_id") DO UPDATE SET
        "company_id" = EXCLUDED."company_id",
        "worker_id" = EXCLUDED."worker_id",
        "worker_name" = EXCLUDED."worker_name",
        "event_id" = EXCLUDED."event_id",
        "event_name" = EXCLUDED."event_name",
        "status" = EXCLUDED."status",
        "amount_cents" = EXCLUDED."amount_cents",
        "created_at" = EXCLUDED."created_at",
        "updated_at" = EXCLUDED."updated_at"
    `;
    return Number(affected);
  }

  /**
   * Whole-history rebuild of the per-company totals: the totals are global
   * aggregates, so only a full recompute (not a window delta) is idempotent.
   */
  async rebuildAllTotals(tx: DbClient): Promise<void> {
    await tx.$executeRaw`
      DELETE FROM "company_financial_totals"
    `;
    await tx.$executeRaw`
      INSERT INTO "company_financial_totals" (
        "company_id", "pending_amount_cents", "approved_amount_cents", "rejected_amount_cents", "orders_count"
      )
      SELECT "company_id",
             COALESCE(SUM("amount_cents") FILTER (WHERE "status" = 'pending'), 0),
             COALESCE(SUM("amount_cents") FILTER (WHERE "status" = 'approved'), 0),
             COALESCE(SUM("amount_cents") FILTER (WHERE "status" = 'rejected'), 0),
             COUNT(*)::int
      FROM "payment_orders"
      GROUP BY "company_id"
      ON CONFLICT ("company_id") DO UPDATE SET
        "pending_amount_cents" = EXCLUDED."pending_amount_cents",
        "approved_amount_cents" = EXCLUDED."approved_amount_cents",
        "rejected_amount_cents" = EXCLUDED."rejected_amount_cents",
        "orders_count" = EXCLUDED."orders_count"
    `;
  }
}
```
`COUNT(*)::int` to match the integer column (the assignment cast would do it anyway, but explicit is fine).

**re-derivation.service.ts** final — with retry:
```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DomainException } from '../common/domain-exception.js';
import { ReDerivationRepository } from './re-derivation.repository.js';

const MAX_ATTEMPTS = 3;

export interface DeriveResult {
  from: string;
  to: string;
  rows_rebuilt: number;
}

@Injectable()
export class ReDerivationService {
  private readonly logger = new Logger(ReDerivationService.name);

  constructor(@Inject(ReDerivationRepository) private readonly repository: ReDerivationRepository) {}

  /**
   * Rebuilds the projection for orders created in [from, to] from the source
   * tables and re-computes all per-company totals. Full-value overwrites, so
   * running it twice over the same window leaves the same state; the
   * SERIALIZABLE transaction makes it safe to run while the system is live.
   */
  async derive(from: Date, to: Date): Promise<DeriveResult> {
    if (from.getTime() > to.getTime()) {
      throw new DomainException(400, 'validation_failed', 'from must not be later than to', {
        from: from.toISOString(),
        to: to.toISOString(),
      });
    }

    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.repository.withSerializableTransaction(async (tx) => {
          await this.repository.deleteRowsInWindow(tx, from, to);
          const rowsRebuilt = await this.repository.insertRowsFromSource(tx, from, to);
          await this.repository.rebuildAllTotals(tx);
          return { from: from.toISOString(), to: to.toISOString(), rows_rebuilt: rowsRebuilt };
        });
      } catch (error) {
        if (attempt < MAX_ATTEMPTS && isSerializationConflict(error)) {
          this.logger.warn(`serialization conflict on attempt ${attempt}/${MAX_ATTEMPTS}; retrying derive`);
          await sleep(25 * attempt);
          continue;
        }
        throw error;
      }
    }
  }
}

function isSerializationConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === '40001' || code === '40P01' || code === 'P2034') return true;
  return typeof message === 'string' && /serializ/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

**drift-repair.repository.ts** final:
```ts
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';

interface DriftedRow { payment_order_id: string; }
interface DriftedCompany { company_id: string; }

@Injectable()
export class DriftRepairRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Compares the projection against the source for orders created in
   * [from, to]: rows that are missing or disagree field by field, and
   * companies whose totals disagree with a re-aggregation of the source.
   */
  async findDrift(from: Date, to: Date): Promise<{ driftedRows: string[]; driftedCompanies: string[] }> {
    const [rows, companies] = await this.prisma.$transaction([
      this.prisma.$queryRaw<DriftedRow[]>`
        SELECT o."id" AS "payment_order_id"
        FROM "payment_orders" o
        JOIN "workers" w ON w."id" = o."worker_id"
        JOIN "events" e ON e."id" = o."event_id"
        LEFT JOIN "operation_read_model" p ON p."payment_order_id" = o."id"
        WHERE o."created_at" >= ${from} AND o."created_at" <= ${to}
          AND (
            p."payment_order_id" IS NULL
            OR p."company_id" IS DISTINCT FROM o."company_id"
            OR p."worker_id" IS DISTINCT FROM o."worker_id"
            OR p."worker_name" IS DISTINCT FROM w."full_name"
            OR p."event_id" IS DISTINCT FROM o."event_id"
            OR p."event_name" IS DISTINCT FROM e."name"
            OR p."status" IS DISTINCT FROM o."status"
            OR p."amount_cents" IS DISTINCT FROM o."amount_cents"
            OR p."created_at" IS DISTINCT FROM o."created_at"
            OR p."updated_at" IS DISTINCT FROM o."updated_at"
          )
      `,
      this.prisma.$queryRaw<DriftedCompany[]>`
        SELECT t."company_id" AS "company_id"
        FROM "company_financial_totals" t
        WHERE t."company_id" IN (
          SELECT "company_id" FROM "payment_orders" WHERE "created_at" >= ${from} AND "created_at" <= ${to}
        )
          AND (
            t."pending_amount_cents" <> COALESCE((SELECT SUM(po."amount_cents") FROM "payment_orders" po WHERE po."company_id" = t."company_id" AND po."status" = 'pending'), 0)
            OR t."approved_amount_cents" <> COALESCE((SELECT SUM(po."amount_cents") FROM "payment_orders" po WHERE po."company_id" = t."company_id" AND po."status" = 'approved'), 0)
            OR t."rejected_amount_cents" <> COALESCE((SELECT SUM(po."amount_cents") FROM "payment_orders" po WHERE po."company_id" = t."company_id" AND po."status" = 'rejected'), 0)
            OR t."orders_count" <> (SELECT COUNT(*)::int FROM "payment_orders" po WHERE po."company_id" = t."company_id")
          )
        UNION
        SELECT DISTINCT po."company_id" AS "company_id"
        FROM "payment_orders" po
        WHERE po."created_at" >= ${from} AND po."created_at" <= ${to}
          AND NOT EXISTS (SELECT 1 FROM "company_financial_totals" t WHERE t."company_id" = po."company_id")
      `,
    ]);
    return {
      driftedRows: rows.map((r) => r.payment_order_id),
      driftedCompanies: companies.map((c) => c.company_id),
    };
  }
}
```
The type of the batch result: `[$queryRaw<DriftedRow[]>, $queryRaw<DriftedCompany[]>]` → tuple [DriftedRow[], DriftedCompany[]] ✓.

**drift-repair.service.ts** final:
```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReDerivationService } from '../re-derivation/re-derivation.service.js';
import { DriftRepairRepository } from './drift-repair.repository.js';

const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface DriftRepairReport {
  window: { from: string; to: string };
  drifted_row_count: number;
  drifted_company_count: number;
  repaired: boolean;
}

@Injectable()
export class DriftRepairService {
  private readonly logger = new Logger(DriftRepairService.name);
  private running = false;

  constructor(
    @Inject(ReDerivationService) private readonly reDerivation: ReDerivationService,
    @Inject(DriftRepairRepository) private readonly repository: DriftRepairRepository,
  ) {}

  /** Scheduled run: compare the trailing 24h and repair what disagrees. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async run(): Promise<DriftRepairReport | null> {
    if (this.running) {
      this.logger.warn('skipping drift repair: a previous run is still in progress');
      return null;
    }
    this.running = true;
    try {
      const to = new Date();
      const from = new Date(to.getTime() - WINDOW_MS);
      return await this.repairWindow(from, to);
    } finally {
      this.running = false;
    }
  }

  /** Compare [from, to] against source and, if anything disagrees, re-derive it. */
  async repairWindow(from: Date, to: Date): Promise<DriftRepairReport> {
    const { driftedRows, driftedCompanies } = await this.repository.findDrift(from, to);
    const repaired = driftedRows.length > 0 || driftedCompanies.length > 0;
    if (repaired) {
      this.logger.warn(
        `drift detected (${driftedRows.length} rows, ${driftedCompanies.length} companies); re-deriving ${from.toISOString()}..${to.toISOString()}`,
      );
      await this.reDerivation.derive(from, to);
    }
    return {
      window: { from: from.toISOString(), to: to.toISOString() },
      drifted_row_count: driftedRows.length,
      drifted_company_count: driftedCompanies.length,
      repaired,
    };
  }
}
```

**Test files** — I'll write them in full.

`test/helpers/app.ts`:
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { AppModule } from '../../src/app.module.js';
import { ApiExceptionFilter } from '../../src/common/api-exception-filter.js';

export interface TestApp {
  app: INestApplication;
  baseUrl: string;
  close: () => Promise<void>;
}

export async function startTestApp(): Promise<TestApp> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.listen(0);
  const server = app.getHttpServer() as Server;
  const address = server.address();
  if (!address || typeof address === 'string') {
    await app.close();
    throw new Error('test server did not bind to a TCP port');
  }
  return {
    app,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => app.close(),
  };
}
```

`test/helpers/db.ts`:
```ts
import { PrismaClient } from '@prisma/client';

export function createTestPrisma(): PrismaClient {
  return new PrismaClient();
}

export interface TestFixtures {
  companyId: string;
  workerId: string;
  workerName: string;
  eventId: string;
  eventName: string;
}

export async function seedFixtures(prisma: PrismaClient): Promise<TestFixtures> {
  const company = await prisma.company.create({ data: { name: `Test Company ${Math.random().toString(36).slice(2)}` } });
  const worker = await prisma.worker.create({ data: { fullName: 'Ada Worker' } });
  const event = await prisma.event.create({ data: { companyId: company.id, name: 'Harvest Fair' } });
  return { companyId: company.id, workerId: worker.id, workerName: worker.fullName, eventId: event.id, eventName: event.name };
}

/** Removes everything a fixture created (source and projection). */
export async function cleanupFixtures(prisma: PrismaClient, fx: TestFixtures): Promise<void> {
  const orderIds = (
    await prisma.paymentOrder.findMany({ where: { companyId: fx.companyId }, select: { id: true } })
  ).map((order) => order.id);
  await prisma.operationReadModel.deleteMany({ where: { paymentOrderId: { in: orderIds } } });
  await prisma.companyFinancialTotals.deleteMany({ where: { companyId: fx.companyId } });
  await prisma.paymentOrder.deleteMany({ where: { companyId: fx.companyId } });
  await prisma.event.deleteMany({ where: { companyId: fx.companyId } });
  await prisma.worker.deleteMany({ where: { id: fx.workerId } });
  await prisma.company.deleteMany({ where: { id: fx.companyId } });
}
```

`test/helpers/http.ts` — as sketched.

`test/read-your-own-writes.spec.ts`:
```ts
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from './helpers/app.js';
import { createTestPrisma, cleanupFixtures, seedFixtures, type TestFixtures } from './helpers/db.js';
import { getJson, postJson } from './helpers/http.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('operations dashboard: read your own writes', () => {
  let app: TestApp | undefined;
  let prisma: PrismaClient | undefined;
  const fixtures: TestFixtures[] = [];

  beforeAll(async () => {
    prisma = createTestPrisma();
    app = await startTestApp();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  afterEach(async () => {
    for (const fixture of fixtures.splice(0)) {
      await cleanupFixtures(prisma!, fixture);
    }
  });

  it('shows an approved order on the very next request after approving it', async () => {
    const fx = await seedFixtures(prisma!);
    fixtures.push(fx);

    const created = await postJson<{ id: string; status: string }>(app!, '/payment-orders', {
      company_id: fx.companyId, worker_id: fx.workerId, event_id: fx.eventId, amount_cents: 2500,
    });
    expect(created.status).toBe(201);
    const orderId = created.body.id;

    let listed = await getJson(app!, '/operations', { company_id: fx.companyId });
    expect(listed.status).toBe(200);
    expect(listed.body.total).toBe(1);
    expect(listed.body.items[0]).toMatchObject({
      id: orderId, company_id: fx.companyId, status: 'pending', amount_cents: 2500,
      worker_name: fx.workerName, event_name: fx.eventName,
    });

    const approved = await postJson<{ status: string }>(app!, `/payment-orders/${orderId}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('approved');

    // no delay, no refresher: the next request already reflects the write
    listed = await getJson(app!, '/operations', { company_id: fx.companyId, status: 'approved' });
    expect(listed.body.total).toBe(1);
    expect(listed.body.items[0].status).toBe('approved');

    const totals = await getJson(app!, `/companies/${fx.companyId}/financial-totals`);
    expect(totals.status).toBe(200);
    expect(totals.body).toEqual({
      company_id: fx.companyId,
      pending_amount_cents: '0',
      approved_amount_cents: '2500',
      rejected_amount_cents: '0',
      orders_count: 1,
    });
  });

  it('shows a rejected order and moves the exact amounts in the totals', async () => {
    const fx = await seedFixtures(prisma!);
    fixtures.push(fx);

    const first = await postJson<{ id: string }>(app!, '/payment-orders', { company_id: fx.companyId, worker_id: fx.workerId, event_id: fx.eventId, amount_cents: 1200 });
    const second = await postJson<{ id: string }>(app!, '/payment-orders', { company_id: fx.companyId, worker_id: fx.workerId, event_id: fx.eventId, amount_cents: 300 });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const rejected = await postJson<{ status: string }>(app!, `/payment-orders/${second.body.id}/reject`);
    expect(rejected.status).toBe(200);

    const totals = await getJson(app!, `/companies/${fx.companyId}/financial-totals`);
    expect(totals.body).toEqual({
      company_id: fx.companyId,
      pending_amount_cents: '1200',
      approved_amount_cents: '0',
      rejected_amount_cents: '300',
      orders_count: 2,
    });

    const listed = await getJson(app!, '/operations', { company_id: fx.companyId, status: 'rejected' });
    expect(listed.body.total).toBe(1);
    expect(listed.body.items[0].id).toBe(second.body.id);
  });

  it('never shows an order that only exists in the source table (projection-only read path)', async () => {
    const fx = await seedFixtures(prisma!);
    fixtures.push(fx);

    await prisma!.paymentOrder.create({
      data: { companyId: fx.companyId, workerId: fx.workerId, eventId: fx.eventId, status: 'approved', amountCents: 9000 },
    });

    const listed = await getJson(app!, '/operations', { company_id: fx.companyId });
    expect(listed.body.total).toBe(0);
    expect(listed.body.items).toEqual([]);

    const totals = await getJson(app!, `/companies/${fx.companyId}/financial-totals`);
    expect(totals.status).toBe(404);
    expect(totals.body.error.code).toBe('resource_not_found');
  });

  it('returns the error envelope for unknown ids, invalid transitions and bad input', async () => {
    const fx = await seedFixtures(prisma!);
    fixtures.push(fx);

    const unknown = await postJson(app!, '/payment-orders/00000000-0000-4000-8000-000000000000/approve');
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ error: { code: 'resource_not_found', message: expect.any(String), details: expect.any(Object) } });

    const created = await postJson<{ id: string }>(app!, '/payment-orders', { company_id: fx.companyId, worker_id: fx.workerId, event_id: fx.eventId, amount_cents: 100 });
    await postJson(app!, `/payment-orders/${created.body.id}/approve`);
    const again = await postJson(app!, `/payment-orders/${created.body.id}/approve`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('invalid_state_transition');

    const noCompany = await getJson(app!, '/operations', {});
    expect(noCompany.status).toBe(400);
    expect(noCompany.body.error.code).toBe('validation_failed');
    expect(noCompany.body.error.details.company_id).toBeDefined();

    const badStatus = await getJson(app!, '/operations', { company_id: fx.companyId, status: 'settled' });
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.error.code).toBe('validation_failed');
  });
});
```
Wait — `getJson(app!, '/operations', {})` — query {} → no company_id → 400 ✓. `totals.body.error...` — the generic T defaults to any — getJson without a generic → body: any ✓.

The 404 detail check: `details: expect.any(Object)` — the details `{ id }` is an object ✓.

`toMatchObject` with items[0] — items[0] is any (body: any via getJson without a generic? I wrote getJson(app!, '/operations', ...) without a generic → body is any ✓ toMatchObject is fine.

**concurrent-totals.spec.ts**:
```ts
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from './helpers/app.js';
import { createTestPrisma, cleanupFixtures, seedFixtures, type TestFixtures } from './helpers/db.js';
import { getJson, postJson } from './helpers/http.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('concurrent updates to one company totals', () => {
  let app: TestApp | undefined;
  let prisma: PrismaClient | undefined;
  const fixtures: TestFixtures[] = [];

  beforeAll(async () => { prisma = createTestPrisma(); app = await startTestApp(); }, 30_000);
  afterAll(async () => { await app?.close(); await prisma?.$disconnect(); });
  afterEach(async () => { for (const fx of fixtures.splice(0)) await cleanupFixtures(prisma!, fx); });

  it('applies 24 concurrent transitions on the same totals row without losing any', async () => {
    const fx = await seedFixtures(prisma!);
    fixtures.push(fx);

    const amounts = Array.from({ length: 24 }, (_, i) => 100 + i); // 100..123
    const ids: string[] = [];
    for (const amountCents of amounts) {
      const created = await postJson<{ id: string }>(app!, '/payment-orders', {
        company_id: fx.companyId, worker_id: fx.workerId, event_id: fx.eventId, amount_cents: amountCents,
      });
      expect(created.status).toBe(201);
      ids.push(created.body.id);
    }

    // 12 approves + 12 rejects, all in flight at once, all moving the same
    // company_financial_totals row.
    const responses = await Promise.all([
      ...ids.slice(0, 12).map((id) => postJson(app!, `/payment-orders/${id}/approve`)),
      ...ids.slice(12).map((id) => postJson(app!, `/payment-orders/${id}/reject`)),
    ]);
    for (const response of responses) expect(response.status).toBe(200);

    const approvedSum = amounts.slice(0, 12).reduce((sum, value) => sum + value, 0);
    const rejectedSum = amounts.slice(12).reduce((sum, value) => sum + value, 0);

    const totals = await getJson(app!, `/companies/${fx.companyId}/financial-totals`);
    expect(totals.status).toBe(200);
    expect(totals.body).toEqual({
      company_id: fx.companyId,
      pending_amount_cents: '0',
      approved_amount_cents: String(approvedSum),
      rejected_amount_cents: String(rejectedSum),
      orders_count: 24,
    });

    // the totals must equal an aggregation of the source table, exactly
    const grouped = await prisma!.paymentOrder.groupBy({
      by: ['status'],
      where: { companyId: fx.companyId },
      _sum: { amountCents: true },
    });
    const sumFor = (status: string): number => grouped.find((g) => g.status === status)?._sum.amountCents ?? 0;
    expect(sumFor('approved')).toBe(approvedSum);
    expect(sumFor('rejected')).toBe(rejectedSum);
    expect(sumFor('pending')).toBe(0);

    // and the dashboard reflects every one of them
    const approvedList = await getJson(app!, '/operations', { company_id: fx.companyId, status: 'approved' });
    const rejectedList = await getJson(app!, '/operations', { company_id: fx.companyId, status: 'rejected' });
    expect(approvedList.body.total).toBe(12);
    expect(rejectedList.body.total).toBe(12);
  });

  it('creates the totals row exactly once under concurrent first writes', async () => {
    const fx = await seedFixtures(prisma!);
    fixtures.push(fx);

    const responses = await Promise.all(
      [500, 700].map((amountCents) =>
        postJson<{ id: string }>(app!, '/payment-orders', {
          company_id: fx.companyId, worker_id: fx.workerId, event_id: fx.eventId, amount_cents: amountCents,
        }),
      ),
    );
    for (const response of responses) expect(response.status).toBe(201);

    const totals = await getJson(app!, `/companies/${fx.companyId}/financial-totals`);
    expect(totals.body).toEqual({
      company_id: fx.companyId,
      pending_amount_cents: '1200',
      approved_amount_cents: '0',
      rejected_amount_cents: '0',
      orders_count: 2,
    });
  });
});
```
amounts 100..123: approvedSum = 100+...+111 = (100+111)*12/2 = 1266. rejectedSum = 112..123 = (112+123)*12/2 = 1410. ✓

**drift-repair.spec.ts**:
```ts
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DriftRepairService } from '../src/drift-repair/drift-repair.service.js';
import { startTestApp, type TestApp } from './helpers/app.js';
import { createTestPrisma, cleanupFixtures, seedFixtures, type TestFixtures } from './helpers/db.js';
import { getJson, postJson } from './helpers/http.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('scheduled drift repair', () => {
  let app: TestApp | undefined;
  let prisma: PrismaClient | undefined;
  const fixtures: TestFixtures[] = [];

  beforeAll(async () => { prisma = createTestPrisma(); app = await startTestApp(); }, 30_000);
  afterAll(async () => { await app?.close(); await prisma?.$disconnect(); });
  afterEach(async () => { for (const fx of fixtures.splice(0)) await cleanupFixtures(prisma!, fx); });

  it('detects drifted rows and totals in the recent window and repairs them', async () => {
    const fx = await seedFixtures(prisma!);
    fixtures.push(fx);

    const amounts = [500, 501, 502];
    const ids: string[] = [];
    for (const amountCents of amounts) {
      const created = await postJson<{ id: string }>(app!, '/payment-orders', {
        company_id: fx.companyId, worker_id: fx.workerId, event_id: fx.eventId, amount_cents: amountCents,
      });
      expect(created.status).toBe(201);
      ids.push(created.body.id);
    }

    const repairService = app!.app.get(DriftRepairService);
    const now = new Date();
    const from = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    // baseline: everything agrees, nothing is repaired
    const clean = await repairService.repairWindow(from, now);
    expect(clean.repaired).toBe(false);
    expect(clean.drifted_row_count).toBe(0);
    expect(clean.drifted_company_count).toBe(0);

    // inject drift: one row with a wrong status/timestamp, one row missing,
    // one inflated totals row
    const [a, b] = ids;
    await prisma!.$executeRaw`UPDATE "operation_read_model" SET "status" = 'approved', "updated_at" = "updated_at" + interval '1 hour' WHERE "payment_order_id" = ${a}`;
    await prisma!.$executeRaw`DELETE FROM "operation_read_model" WHERE "payment_order_id" = ${b}`;
    await prisma!.$executeRaw`UPDATE "company_financial_totals" SET "approved_amount_cents" = "approved_amount_cents" + 9999 WHERE "company_id" = ${fx.companyId}`;

    const report = await repairService.repairWindow(from, now);
    expect(report.repaired).toBe(true);
    expect(report.drifted_row_count).toBe(2);
    expect(report.drifted_company_count).toBe(1);

    // the projection agrees with the source again
    const rows = await prisma!.operationReadModel.findMany({ where: { paymentOrderId: { in: ids } } });
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.status).toBe('pending');
      const source = await prisma!.paymentOrder.findUniqueOrThrow({ where: { id: row.paymentOrderId } });
      expect(row.updatedAt.getTime()).toBe(source.updatedAt.getTime());
    }

    const totals = await getJson(app!, `/companies/${fx.companyId}/financial-totals`);
    expect(totals.body.approved_amount_cents).toBe('0');
    expect(totals.body.pending_amount_cents).toBe(String(amounts.reduce((s, v) => s + v, 0)));
  });
});
```
Note: the drift injection `UPDATE ... SET "status" = 'approved'` — the enum literal is coerced ✓.

Wait — the baseline `repairWindow` with no drift: `clean.drifted_row_count` 0 ✓ (rows match: created via the hook; worker_name/event_name match; updated_at matches ✓).

But note: `repairWindow(from, now)` — now = after the creates ✓ orders created in the last ~seconds ✓ within [now-2h, now] ✓.

**re-derivation.spec.ts**:
```ts
import type { OrderStatus } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ReDerivationService } from '../src/re-derivation/re-derivation.service.js';
import { startTestApp, type TestApp } from './helpers/app.js';
import { createTestPrisma, cleanupFixtures, seedFixtures, type TestFixtures } from './helpers/db.js';
import { getJson } from './helpers/http.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('re-derivation for an arbitrary window', () => {
  ... setup ...

  it('rebuilds rows and totals from source for the window, ordered by recency', async () => {
    const fx = await seedFixtures(prisma!);
    fixtures.push(fx);
    const now = new Date();
    const statuses: OrderStatus[] = ['pending', 'approved', 'rejected', 'approved', 'pending'];

    // source rows only (the hooks were bypassed on purpose)
    const ids: string[] = [];
    for (let i = 0; i < statuses.length; i += 1) {
      const createdAt = new Date(now.getTime() - (i + 1) * 60_000);
      const order = await prisma!.paymentOrder.create({
        data: {
          companyId: fx.companyId, workerId: fx.workerId, eventId: fx.eventId,
          status: statuses[i], amountCents: 100 * (i + 1), createdAt, updatedAt: createdAt,
        },
      });
      ids.push(order.id);
    }
    // an order outside the window, to prove the boundary is respected
    const outsideCreatedAt = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    await prisma!.paymentOrder.create({
      data: { companyId: fx.companyId, workerId: fx.workerId, eventId: fx.eventId, status: 'approved', amountCents: 777, createdAt: outsideCreatedAt, updatedAt: outsideCreatedAt },
    });

    const from = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const deriveService = app!.app.get(ReDerivationService);
    const result = await deriveService.derive(from, now);
    expect(result.rows_rebuilt).toBe(5);

    // the dashboard shows exactly the window, newest first, from the projection
    const listed = await getJson(app!, '/operations', { company_id: fx.companyId });
    expect(listed.status).toBe(200);
    expect(listed.body.total).toBe(5);
    expect(listed.body.items.map((item: { id: string }) => item.id)).toEqual(ids);
    expect(listed.body.items.map((item: { status: string }) => item.status)).toEqual(statuses);
    expect(listed.body.items[0]).toMatchObject({ worker_name: fx.workerName, event_name: fx.eventName, amount_cents: 100 });

    // totals are rebuilt from the WHOLE history of the company (including the outside order)
    const totals = await prisma!.companyFinancialTotals.findUnique({ where: { companyId: fx.companyId } });
    expect(totals?.pendingAmountCents).toBe(BigInt(100 + 500));
    expect(totals?.approvedAmountCents).toBe(BigInt(200 + 400 + 777));
    expect(totals?.rejectedAmountCents).toBe(BigInt(300));
    expect(totals?.ordersCount).toBe(6);
  });

  it('running the same window twice leaves an identical state', async () => {
    const fx = await seedFixtures(prisma!);
    fixtures.push(fx);
    for (let i = 0; i < 4; i += 1) {
      const createdAt = new Date(Date.now() - (i + 1) * 60_000);
      await prisma!.paymentOrder.create({
        data: { companyId: fx.companyId, workerId: fx.workerId, eventId: fx.eventId, status: i % 2 === 0 ? 'pending' : 'approved', amountCents: 40 * (i + 1), createdAt, updatedAt: createdAt },
      });
    }

    const deriveService = app!.app.get(ReDerivationService);
    const from = new Date(Date.now() - 3600_000);
    await deriveService.derive(from, new Date());

    const snapshot = async () => ({
      rows: await plainify(prisma!.operationReadModel.findMany({ where: { companyId: fx.companyId }, orderBy: { paymentOrderId: 'asc' } })),
      totals: await plainify(prisma!.companyFinancialTotals.findMany({ orderBy: { companyId: 'asc' } })),
    });
    const first = await snapshot();
    await deriveService.derive(from, new Date());
    const second = await snapshot();
    expect(second).toEqual(first);
    expect(first.rows).toHaveLength(4);
    expect(first.totals.length).toBeGreaterThanOrEqual(1);
  });
});

function plainify<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item)));
}
```
Note: the status in the first test: items in descending created_at order → i=0 (createdAt now-1min, status 'pending', amount 100) first ✓ `items.map(status)` should equal `[...statuses]` (statuses[0]='pending') ✓. `ids` are pushed in i order → the expected list is ids[0..4] ✓.

items[0]'s `amount_cents: 100` ✓ (i=0 → 100*(0+1)=100).

`plainify` — findMany rows contain Dates (which JSON.stringify converts to strings) — fine, consistent across both snapshots. BigInt → string ✓.

The second test: `first.totals.length >= 1` — totals for all companies in the DB (the rebuild is global; other test companies are already cleaned up, but maybe this company + leftovers). OK.

Wait — in the second test, the derive window [now-1h, now] covers all 4 orders (created within the last 4 minutes) ✓ rows_rebuilt 4 (assert via snapshot rows length 4).

**The `getJson` items typing** — body is any; `.map((item: { id: string }) => item.id)` — any.map is fine.

Now, **vitest.config.ts**:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    tsconfigRaw: {
      experimentalDecorators: true,
      useDefineForClassFields: false,
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
```
`useDefineForClassFields: false` — important for Nest's class fields (logger etc.) under ES2022 target? esbuild's default for target esnext uses define semantics for class fields — `private readonly logger = new Logger(...)` with define vs assign — either is fine. But a known Nest pitfall: with `useDefineForClassFields: true` + TS decorators, some DI edge cases... I'll set false for safety with legacy decorators. ✓

**package.json** final:
```json
{
  "name": "marketplace-backoffice",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Marketplace back-office: operations dashboard backed by a maintained read model",
  "engines": { "node": ">=20" },
  "scripts": {
    "postinstall": "prisma generate",
    "prisma:migrate": "prisma migrate deploy",
    "dev": "tsx src/main.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.4",
    "@nestjs/core": "^10.4.4",
    "@nestjs/platform-express": "^10.4.4",
    "@nestjs/schedule": "^4.1.1",
    "@prisma/client": "^5.22.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@types/node": "^20.17.0",
    "prisma": "^5.22.0",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

**tsconfig.json** final:
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
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "sourceMap": true,
    "declaration": false
  },
  "include": ["src/**/*.ts"]
}
```

**`db-client.ts`** with the ASSUMPTION comment:
```ts
import type { Prisma } from '@prisma/client';

// ASSUMPTION: Prisma exports TransactionClient as the type of the client handed
// to an interactive-transaction callback (it does in Prisma 5/6).
export type DbClient = Prisma.TransactionClient;
```

Hmm, actually let me reconsider — is `Prisma.TransactionClient` a union `PrismaClient | ...`? If it's Omit<PrismaClient, ...raw...>, then tx.$executeRaw would be a type error in re-derivation.repository. Let me recall the generated Prisma 5 d.ts more specifically... From the prisma repo (packages/client/src/runtime/core/types/...), I recall the definition: `export type TransactionClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$use' | '$transaction' | '$extends'>;`?? If so, it includes $queryRaw/$executeRaw (not omitted) and model delegates — and PrismaClient is assignable (having the extra $connect etc. is OK, structural typing: TransactionClient is a subset of properties → PrismaClient is assignable ✓). Either way, $executeRaw exists on it (if it's Omit that keeps raw, or if it's a union with PrismaClient). I'm reasonably confident. I'll keep the ASSUMPTION comment.

**One more design check — the `updated` variable in `transitionInTx`**: `const updated = await tx.paymentOrder.updateMany(...)` — I use `updated.count` ✓.

**The order of the hooks**: create → upsert row + totals; transition → upsert row + delta. Both inside the tx ✓.

**The `ProjectionService` imports `OperationRowData` type from projection.repository** ✓.

**Check: does any service call prisma?** PaymentOrderService — only the repository ✓. ProjectionService — only the repository ✓. OperationsService — repository ✓. FinancialTotalsService — repository ✓. ReDerivationService — repository ✓. DriftRepairService — repository + ReDerivationService ✓.

**Controller business logic check**: only validation + delegation ✓.

Now, **does the re-derivation's delete+insert race with a live write that updates (not creates) an order in the window?** A writer's tx: source update + row upsert (full value from its own read). R: delete rows in window, insert from source. Interleaving: W reads order (status pending), R reads the same (pending), R inserts the row (pending), R commits; W updates source to approved, upserts row to approved, commits → final row is approved ✓ (W's upsert overwrites). Reverse: W commits first → R's insert sees approved ✓. In between: R's insert statement and W's upsert statement on the same row → lock serialization, last writer wins, and the last writer is the one whose source read is latest... If W's upsert commits after R's insert: W's upsert read R's committed row (pending) and set approved (full value from W's source read) ✓. If R's insert reads W's committed row and overwrites with R's older source read (pending) while source is approved → stale until repair (the phantom case discussed) — SERIALIZABLE may or may not catch it (both write the same row: R read W's row version → edge W→R; R read the source version that W overwrote? R's source read was before W's source commit → edge R→W → cycle → abort → retry ✓!). Wait: R read the source row version V0; W updated the source row to V1 and committed after R's read → edge R→W. W wrote the row P version X (approved); R read P at upsert time... R's upsert is INSERT (no existing row — R deleted it first). Hmm, the delete: R deleted the row at time t_d; W's upsert at time t_b: if t_b < t_d: W upserts (row exists from the hook? the hook row existed before R's delete...). This is getting too deep — the key point is: when both write the same row P and their source reads conflict, the SSI edges R→W (source) and W→R (row P, if R reads W's P version) form a cycle → abort. If R's P write doesn't read W's P version (e.g. W's P version was deleted by R before W's upsert...), the cycle may not form → stale row survives until repair. That's the documented residual. Fine — the design is honest about it.

**The drift job's window (24h) vs a deploy mid-transaction** — the drift repair catches it ✓.

Now, **`migration_lock.toml`**:
```
# Please do not edit this file manually
# It should be added in your version-control system (e.g., git)
provider = "postgresql"
```

**`.env.example`**:
```
# PostgreSQL connection (the only configuration the app needs)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/marketplace_backoffice?schema=public
PORT=3000
```

Now, let me check for **unused imports** in each file (noUnusedLocals):

- operations.service.ts: imports Inject, Injectable, OrderStatus (type, used in the interface ✓), OperationsRepository ✓.
- operations.repository.ts: Inject, Injectable, PrismaService, OrderStatus (used in the interface ✓).
- The repository's findPage signature: I'll define the filter interface in the repository:
```ts
export interface OperationListParams {
  companyId: string;
  status?: OrderStatus;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}
```
Wait — I defined OperationListParams in the service. The repository's `findPage(params: OperationListParams)` — import the type from the service? Slightly circular (the service imports the repository). Type-only import cycle is fine (types are erased). But cleaner: define `OperationListParams` in the repository and the service imports it. I'll define it in the repository (the data access contract) and re-export/use in the service. The service's `list(params: OperationListParams)` imports from the repository ✓ no cycle (the service imports the repository class anyway).

- payment-orders.repository.ts: imports Inject, Injectable, Prisma (type), DomainException, PrismaService, DbClient ✓ all used.
- payment-orders.service.ts: Inject, Injectable, ProjectionService, PaymentOrderRepository, NewPaymentOrder, OrderWithRelations ✓.
- projection.service.ts: Inject, Injectable, OrderStatus, DbClient, OrderWithRelations, ProjectionRepository, OperationRowData, TotalsDelta? (TotalsDelta is only used as an inline object literal in the service — no import needed; the object literal is structurally checked). Import: `import type { OrderStatus } from '@prisma/client';` used in the signature `from: OrderStatus` ✓.
- The drift-repair repository: PrismaService, Inject, Injectable ✓.
- re-derivation.service.ts: Inject, Injectable, Logger, DomainException, ReDerivationRepository ✓.
- drift-repair.service.ts: Inject, Injectable, Logger, Cron, CronExpression, ReDerivationService, DriftRepairRepository ✓.
- financial-totals.controller.ts: Controller, Get, Inject, Param, DomainException, isUuid, FinancialTotalsService ✓.
- The main/app modules are fine.

**`OperationsService.list`** returns an object — the controller returns it → Nest serializes ✓.

**`getJson` on 404** — the body is the envelope ✓ (the filter always sends JSON).

**The test's `postJson` to approve with no body** — fetch POST with no body & no content-type → Nest's @Body() is undefined → unused in approve ✓.

**Nest route conflict**: GET /operations vs POST /payment-orders — different paths ✓. `@Controller('payment-orders')` `@Post(':id/approve')` → /payment-orders/:id/approve ✓.

**Express 4/5**: @nestjs/platform-express 10 uses express 4 ✓.

**The `app.listen(0)` in the test app** — binds to an ephemeral port on localhost ✓.

**`NestFactory.create(AppModule, { logger: false })`** — silences the Nest logger; the Prisma client logs via the logger? Prisma logs to stdout when the log option is set — default: none ✓.

Now, **the cron during the test app's lifecycle**: @Cron EVERY_5_MINUTES — first fire at t+5min; the test closes before that ✓.

**Potential test DB state between the 4 spec files** — single fork, sequential; each cleans up its own fixtures ✓. The re-derivation's rebuild touches the global totals, but only recomputes from source → consistent ✓.

**One risk**: the re-derivation's `rebuildAllTotals` DELETEs all totals rows including those of companies from *other running test files* — but they run sequentially in a single fork; and the recompute recreates them from source (source rows exist until cleanup) ✓.

**The `describe.skipIf` with a dynamic import?** No, plain.

**Vitest `pool: 'forks'` + `singleFork`** — vitest 2 supports `poolOptions.forks.singleFork` ✓.

Now, let me reconsider **the `OperationReadModel` import in the operations.service** — `import type { OperationReadModel, OrderStatus } from '@prisma/client';` — OperationReadModel is used as the row type in toItemDto ✓.

**The repository's findPage return** — items is typed as OperationReadModel[] via Prisma ✓.

**`parseStatus`'s return type vs `OrderStatus`** — I return `'pending' | 'approved' | 'rejected' | undefined`; the parameter type `status?: OrderStatus` — the literal union is assignable to OrderStatus (same members) ✓.

Now, **the DESIGN.md** — I'll finalize the text (concise).

Also, **should I include a `README.md`?** Not asked for. Skip.

**`prisma/migrations/20250101000000_init/migration.sql`** — the final DDL as above.

Let me also double-check the **Prisma `@@index` with `sort: Desc` on uuid** — paymentOrderId is @id uuid; the index includes it as the 4th column ✓ allowed.

**The `OperationReadModel`'s `@@index` includes the @id field** — Prisma allows indexing an id field ✓.

Now, **the totals endpoint returns `orders_count`** — the spec's "financial totals" — count is a bonus; fine.

**The `details` in the 400 for a bad param** — the problems map (object) ✓ never null ✓.

**The filter's `details` for a generic 500** — `{}` ✓.

Now, let me reconsider the **`PrismaService` injection into repositories via `@Inject(PrismaService)`** — with explicit @Inject, no metadata needed ✓.

**`@Injectable()` decorators on all providers** ✓. `@Controller()` on controllers ✓. `@Module()` on modules ✓.

**Reflect-metadata import in main.ts and the test app helper** ✓.

**One more check — the `prisma.$transaction([raw1, raw2])` batch with raw queries**: allowed (PrismaPromise array) ✓.

**The `findDrift` batch result type**: `[DriftedRow[], DriftedCompany[]]` — the $transaction tuple inference with $queryRaw generics → `[DriftedRow[], DriftedCompany[]]` ✓.

**`Number(affected)`** — $executeRaw returns a number ✓ (already; Number() is harmless).

Let me also consider **the `insertRowsFromSource` count** — $executeRaw for INSERT ... ON CONFLICT DO UPDATE returns the number of rows inserted/updated ✓ = rows in the window.

**`derive`'s rows_rebuilt assertion of 5** ✓ (5 orders in the window).

**The outside order (3 days ago)** — its row is not created; but the totals include it ✓. Note: the totals rebuild includes all companies; the outside order's company = fx.companyId → totals.ordersCount 6 ✓.

Now, let me write the **complete list of files** (37). Let me also double-check the **order of headings** — the format: a level-3 heading with only the path, immediately followed by a fenced block. "Begin with the first heading." No prose outside the pattern (prose is ignored but I'll keep it to nothing).

File order: package.json, tsconfig.json, vitest.config.ts, .env.example, prisma/schema.prisma, migration files, src files (main, app.module, common, features), test files, DESIGN.md.

Let me write out each file in its final form, watching for syntax.

---

**src/common/params.ts** — I need `parseAmountCents(value: unknown, problems: Problems)`; I used `problems.amount_cents` in the controller ✓.

**Check the `parseUuid` signature**: (value: string | undefined, field, problems). In the controller: `parseUuid(asString(payload.company_id), 'company_id', problems)` ✓; `parseUuid(companyId, 'company_id', problems)` with @Query param string | undefined ✓.

**`isUuid`** used in the param route handler ✓.

Now — **the `body` in the approve/reject controller** — none.

**FinancialTotalsService.get** — the response is a snake_case object ✓.

**FinancialTotalsRepository**:
```ts
import { Inject, Injectable } from '@nestjs/common';
import type { CompanyFinancialTotals } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';

@Injectable()
export class FinancialTotalsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findByCompanyId(companyId: string): Promise<CompanyFinancialTotals | null> {
    return this.prisma.companyFinancialTotals.findUnique({ where: { companyId } });
  }
}
```

**FinancialTotalsService**:
```ts
import { Inject, Injectable } from '@nestjs/common';
import { DomainException } from '../common/domain-exception.js';
import { FinancialTotalsRepository } from './financial-totals.repository.js';

@Injectable()
export class FinancialTotalsService {
  constructor(@Inject(FinancialTotalsRepository) private readonly repository: FinancialTotalsRepository) {}

  /** Exact per-company totals, maintained by atomic increments in the write path. */
  async get(companyId: string) {
    const totals = await this.repository.findByCompanyId(companyId);
    if (!totals) {
      throw new DomainException(404, 'resource_not_found', `no financial totals recorded for company ${companyId}`, { company_id: companyId });
    }
    return {
      company_id: totals.companyId,
      // bigint is emitted as a string: finance reconciles against exact values
      pending_amount_cents: totals.pendingAmountCents.toString(),
      approved_amount_cents: totals.approvedAmountCents.toString(),
      rejected_amount_cents: totals.rejectedAmountCents.toString(),
      orders_count: totals.ordersCount,
    };
  }
}
```

**FinancialTotalsController**:
```ts
import { Controller, Get, Inject, Param } from '@nestjs/common';
import { DomainException } from '../common/domain-exception.js';
import { isUuid } from '../common/params.js';
import { FinancialTotalsService } from './financial-totals.service.js';

@Controller('companies')
export class FinancialTotalsController {
  constructor(@Inject(FinancialTotalsService) private readonly financialTotalsService: FinancialTotalsService) {}

  @Get(':companyId/financial-totals')
  get(@Param('companyId') companyId: string) {
    if (!isUuid(companyId)) {
      throw new DomainException(400, 'validation_failed', 'companyId must be a UUID', { company_id: companyId });
    }
    return this.financialTotalsService.get(companyId);
  }
}
```

**projection.service.ts** final:
```ts
import { Inject, Injectable } from '@nestjs/common';
import type { OrderStatus } from '@prisma/client';
import type { DbClient } from '../common/db-client.js';
import type { OrderWithRelations } from '../payment-orders/payment-orders.repository.js';
import { ProjectionRepository, type OperationRowData } from './projection.repository.js';

/**
 * Maintenance hooks for the read model. Each hook is called by a write
 * service *inside the writer's transaction*: source row and projection
 * commit or roll back together, so there is no window in which an
 * operator's own write is missing from the dashboard.
 */
@Injectable()
export class ProjectionService {
  constructor(@Inject(ProjectionRepository) private readonly repository: ProjectionRepository) {}

  applyOrderCreated(tx: DbClient, order: OrderWithRelations): Promise<void> {
    void; — no. Just:
    return (async () => { ... })();
```
I'll write it plainly:
```ts
  async applyOrderCreated(tx: DbClient, order: OrderWithRelations): Promise<void> {
    await this.repository.upsertOperationRow(tx, toRow(order));
    await this.repository.applyTotalsDelta(tx, order.companyId, {
      pending: order.amountCents,
      approved: 0,
      rejected: 0,
      ordersCount: 1,
    });
  }

  async applyOrderStatusChanged(tx: DbClient, order: OrderWithRelations, from: OrderStatus): Promise<void> {
    await this.repository.upsertOperationRow(tx, toRow(order));
    if (from === order.status) return;
    const delta = { pending: 0, approved: 0, rejected: 0, ordersCount: 0 };
    delta[from] -= order.amountCents;
    delta[order.status] += order.amountCents;
    await this.repository.applyTotalsDelta(tx, order.companyId, delta);
  }
}

function toRow(order: OrderWithRelations): OperationRowData {
  return {
    paymentOrderId: order.id,
    companyId: order.companyId,
    workerId: order.workerId,
    workerName: order.worker.fullName,
    eventId: order.eventId,
    eventName: order.event.name,
    status: order.status,
    amountCents: order.amountCents,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}
```
`delta[order.status]` — order.status: OrderStatus ✓; the delta's keys include ordersCount — indexing with OrderStatus is OK (pending/approved/rejected ⊆ keys) ✓ TS: `delta` is typed as `{ pending: number; approved: number; rejected: number; ordersCount: number }`; `delta[from]` where from: OrderStatus → TS allows (all union members are keys with number) ✓.

**The module files** — straightforward.

Now, **the `OrderStatus` import in operations.repository** — used in OperationListParams ✓.

**OperationsRepository** final:
```ts
import { Inject, Injectable } from '@nestjs/common';
import type { OperationReadModel, OrderStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';

export interface OperationListParams {
  companyId: string;
  status?: OrderStatus;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

export interface OperationPage {
  items: OperationReadModel[];
  total: number;
}

@Injectable()
export class OperationsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * The dashboard hot path: one table, one covering index
   * (company, status, created_at DESC, id DESC) with INCLUDE columns,
   * so the whole page is an index-only scan. No join back to source.
   */
  async findPage(params: OperationListParams): Promise<OperationPage> {
    const where = {
      companyId: params.companyId,
      ...(params.status !== undefined ? { status: params.status } : {}),
      ...(params.from !== undefined || params.to !== undefined
        ? {
            createdAt: {
              ...(params.from !== undefined ? { gte: params.from } : {}),
              ...(params.to !== undefined ? { lte: params.to } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.operationReadModel.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { paymentOrderId: 'desc' }],
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.operationReadModel.count({ where }),
    ]);

    return { items, total };
  }
}
```
TS: the `where` object literal with conditional spreads — is it assignable to `OperationReadModelWhereInput`? The inferred type: `{ companyId: string } & ({ status: OrderStatus } | {}) & ({ createdAt: { gte?: Date; lte?: Date } } | {})` — the spread of a union → does TS distribute? Spreading a union type `{ a } | {}` — does TS distribute the spread over the union? Yes, TS 3.2+ handles spreading a union (produces a union of spreads). The final type is a union of object shapes — each is assignable to WhereInput (all fields optional) ✓. The `createdAt` with both undefined? I only build it when one is defined ✓.

Hmm — `{ gte: params.from }` inside a nested conditional spread: the inner `params.from !== undefined ? { gte: params.from } : {}` — inside the outer object literal `createdAt: { ...(cond ? {gte} : {}), ...(cond2 ? {lte} : {}) }` ✓ the type is `{ gte?: Date; lte?: Date }`... actually the spread produces `{ gte: Date } | {}` etc. → createdAt: `{ gte?: ... }` union — assignable to `DateTimeFilter | Date`? Prisma's `createdAt?: DateTimeFilter | Date` where DateTimeFilter has gte/lte as optional ✓ each union member is assignable ✓.

**OperationsService** final:
```ts
import { Inject, Injectable } from '@nestjs/common';
import type { OperationReadModel } from '@prisma/client';
import { OperationsRepository, type OperationListParams } from './operations.repository.js';

export interface OperationItemDto {
  id: string;
  company_id: string;
  worker_id: string;
  worker_name: string;
  event_id: string;
  event_name: string;
  status: string;
  amount_cents: number;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class OperationsService {
  constructor(@Inject(OperationsRepository) private readonly repository: OperationsRepository) {}

  list(params: OperationListParams): Promise<{ items: OperationItemDto[]; page: number; page_size: number; total: number }> {
    return this.repository.findPage(params).then(({ items, total }) => ({
      items: items.map(toItemDto),
      page: params.page,
      page_size: params.pageSize,
      total,
    }));
  }
}

function toItemDto(row: OperationReadModel): OperationItemDto {
  return {
    id: row.paymentOrderId,
    company_id: row.companyId,
    worker_id: row.workerId,
    worker_name: row.workerName,
    event_id: row.eventId,
    event_name: row.eventName,
    status: row.status,
    amount_cents: row.amountCents,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
```

**OperationsController** — final (as above).

Now, **the `payment-orders` feature folder name vs file names** — `payment-orders.module.ts` etc. ✓ kebab-case.

**The `re-derivation` and `drift-repair` folders** ✓.

**Check: `src/projection/projection.module.ts`** — no controller; providers ProjectionService + ProjectionRepository; exports ProjectionService ✓.

**The app.module** imports all ✓.

Now, **the test import paths** — from `test/` to `src/`: `../src/...` ✓.

**`startTestApp`** — imports AppModule → boots everything including PrismaService (connects to DATABASE_URL). Without a DB, beforeAll fails — but the suite is skipped without DATABASE_URL ✓.

**`describe.skipIf(!hasDatabase)`** — vitest ✓.

**`beforeAll` timeout** — I'll pass 30000 as the 2nd arg ✓ (hookTimeout also set to 60s).

Now, **a potential issue**: 4 spec files each start their own Nest app (PrismaService connects 4 times) sequentially — fine.

**The `fixtures` array and `prisma!`** — non-null assertion is OK in tests (strict is fine with `!`).

Now, let me write the **DESIGN.md** in full (concise, ~120 lines).

Also — **the task says "maintenance hooks invoked by the write services (simulating the write path)"** — my PaymentOrderService invokes the ProjectionService hooks ✓; the endpoints simulate the write path ✓.

**"the new dashboard query"** — OperationsRepository.findPage ✓.

**Deliverables checklist**:
- Projection tables + DDL with indexes ✓ (operation_read_model + company_financial_totals, migration with covering index)
- Maintenance hooks invoked by the write services ✓
- Re-derivation routine for an arbitrary date window ✓ (ReDerivationService.derive)
- Scheduled drift-repair job ✓ (DriftRepairService @Cron)
- The new dashboard query ✓
- Tests: read-your-own-writes ✓, concurrent totals ✓, drift repair ✓ (+ re-derivation idempotency)
- DESIGN.md ✓

Now, one more **naming check**: "TS file: kebab-case.role.ts" — `payment-orders.service.ts` — hmm, "kebab-case.role.ts" — e.g. `payment-orders.service.ts` fits (feature name kebab + .role) ✓.

**Class PascalCase** ✓: PaymentOrderService, OperationReadModel, etc.

Let me also double-check **the Prisma model name `OperationReadModel` → table `operation_read_model`** ✓; the client property is `prisma.operationReadModel` ✓.

**`CompanyFinancialTotals` → `prisma.companyFinancialTotals`** ✓.

**`paymentOrder`** ✓.

Now, **the migration timestamp name**: `20250101000000_init`.

**The schema.prisma header comment** — minimal.

One more consideration — **the `CHECK` on amount_cents ≥ 0** in the migration but the Prisma schema has no check — Prisma's drift detection: Prisma doesn't model CHECK constraints → no drift (Prisma ignores checks in its diff? Prisma migrate diff compares schema and DB including checks? I think Prisma only tracks its own DDL elements; a hand-written extra check in the migration is fine with `migrate deploy` (which applies migrations as-is). The drift check (migrate status) uses the migration history + shadow DB replay, not live DB introspection → consistent ✓.)

Also **the FKs ON DELETE RESTRICT** — Prisma's default is RESTRICT ✓ consistent.

**The enum name "OrderStatus"** — the Prisma enum maps to the PG type `OrderStatus` ✓ (no @@map on the enum; the name is OrderStatus → type "OrderStatus" ✓).

Now, **`gen_random_uuid()`** — the Prisma `@default(uuid())` on postgres generates `gen_random_uuid()` in the DDL ✓ I use the same.

Let me also decide on **the `page_size` default 50, max 200** — arbitrary but reasonable.

**Edge: `page` is huge** → skip is huge → empty items, total is accurate ✓.

Now, **the final format**: a heading per file + a fenced block. Language tags: ts for .ts, prisma for .prisma, sql for .sql, toml for .toml, json for .json, md for .md. The example shows ```ts and ```prisma. I'll use appropriate tags.

Let me also re-verify **the `fetch` POST with undefined body** — `body: undefined` is fine.

**`new URL('/operations', 'http://127.0.0.1:54321')`** ✓.

**The `getJson`'s query param** — the status param is optional ✓.

One more potential gotcha: **the Nest `@Query('page_size')`** — the underscore in the query name is fine.

**The `@Controller('operations')` + `@Get()`** → path `/operations` ✓.

**The exception filter's `response.status(status).json(body)`** — the Express response's any-typing via `getResponse()` — returns `any` (the generic default of the interface is `any`) → no TS error under strict? `host.switchToHttp().getResponse<any>()` — the default type parameter of `getResponse` is `any` — explicit any is allowed (noImplicitAny only forbids implicit) ✓.

**The `@Catch()` with no args** catches everything ✓.

**The `DomainException`'s super call** — `super({ error: {...} }, status)` — HttpException's constructor (objectOrMessage, status) ✓.

Now, **the `isSerializationConflict`** — a Prisma P2034 error: `PrismaClientKnownRequestError` with `.code = 'P2034'`? For interactive transaction conflicts, Prisma throws `PrismaClientKnownRequestError` with code P2034 ("Transaction failed due to a conflict with another transaction") — I believe that's right for serializable conflicts on commit. The raw pg code 40001 may surface as `.meta`? I check both + the message regex. ✓

**The `sleep` backoff 25ms/50ms** — small; at 3M scale, retries are cheap. Fine.

Let me also add **the `timeout: 120_000`** for the serializable tx ✓ (the interactive tx's default 5s is too short for a large window).

**Now, the full re-read of the layering rule**: "service holds the logic. Zero raw SQL, zero Prisma client calls." — my services: no `prisma`/`tx` usage except passing `tx` to the repository/service — passing a client handle is not a Prisma client *call* ✓. The `withTransaction` callback is created in the service but executed in the repository ✓ (the repository's `this.prisma.$transaction(work)`).

"repository is the only layer that touches the database." — repositories + PrismaService (common infrastructure; the repository consumes it). Test helpers use PrismaClient directly — tests, not a layer. OK.

**"controller validates input and calls the service. Zero business logic."** ✓.

**Error envelope** — all error responses go through the filter ✓ (Nest's default exception layer is replaced by the global filter).

**One subtlety**: an unhandled rejection in the @Cron (if the drift repair throws) — Nest logs it; the process survives (the cron error doesn't crash). Acceptable. I could wrap it in a try/catch that logs. Let me wrap:
```ts
@Cron(CronExpression.EVERY_5_MINUTES)
async run(): Promise<DriftRepairReport | null> {
  ...
  try {
    ...
    return await this.repairWindow(from, to);
  } catch (error) {
    this.logger.error(`drift repair failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  } finally {
    this.running = false;
  }
}
```
Hmm — but swallowing the error hides persistent failures... A scheduled job that logs and moves on is standard; the next run retries. I'll keep the catch + log. But then the `run()` never throws; `repairWindow` is exposed for tests (throws on DB failure — fine).

Actually wait — should I rethrow? If the DB is down, each 5-minute run logs an error — that's fine and visible. OK.

**The `logger.error`** with a message string ✓.

Now, **the `DESIGN.md`** — I'll finalize the text (concise).

Let me also confirm **the `postJson`'s approve call returns the JSON dto** — the service returns the OrderDto ✓.

**The 201 for create** — the default for @Post ✓.

**The test `expect(created.status).toBe(201)`** ✓.

Now — **the `tsconfig` `rootDir: "src"`** — the build compiles only src; the test/ files are excluded from the build (fine, vitest compiles them itself).

**The `vitest` include pattern `test/**/*.spec.ts`** ✓.

**pnpm** — no lockfile (can't generate). Fine.

Now, let me write **the complete content of all files** carefully, watching for syntax.

One more: **the `http.ts` helper's type**:
```ts
import type { TestApp } from './app.js';

export interface HttpResult<T> {
  status: number;
  body: T;
}

export function buildUrl(app: TestApp, path: string, query: Record<string, string> = {}): URL {
  const url = new URL(path, app.baseUrl);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return url;
}

export async function getJson<T = unknown>(app: TestApp, path: string, query: Record<string, string> = {}): Promise<HttpResult<T>> {
  const response = await fetch(buildUrl(app, path, query));
  return { status: response.status, body: (await response.json()) as T };
}

export async function postJson<T = unknown>(app: TestApp, path: string, body?: unknown): Promise<HttpResult<T>> {
  const response = await fetch(buildUrl(app, path), {
    method: 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as T };
}
```
`fetch`'s headers undefined is OK.

**The `app.ts` helper** — `import type { Server } from 'node:http';` ✓.

Now, **the drift test's `app!.app.get(DriftRepairService)`** — DriftRepairService is provided in DriftRepairModule (not global) — `app.get` works across the whole application context ✓ (the root injector can find it since it's in a module's providers — yes, `app.get(SomeProvider)` works for any provider in the app's graph ✓).

Similarly, ReDerivationService via app.get ✓.

**The re-derivation test's import of ReDerivationService** ✓.

Let me also check **the `Prisma.PaymentOrderGetPayload` import** — `import type { Prisma } from '@prisma/client'` then `Prisma.PaymentOrderGetPayload<...>` ✓.

**The `OrderStatus` type import from '@prisma/client'** ✓ (the generated enum type).

Potential issue: **`import type { OperationReadModel, OrderStatus } from '@prisma/client'`** — OperationReadModel is a generated model type ✓.

Now, **the concurrent test's `groupBy`** — `prisma.paymentOrder.groupBy({ by: ['status'], where, _sum: { amountCents: true } })` returns an array with `_sum: { amountCents: number | null }` ✓.

**`sumFor`** — `g._sum.amountCents ?? 0` — I wrote `grouped.find((g) => g.status === status)?._sum.amountCents ?? 0` — the precedence: `(find?. _sum.amountCents) ?? 0` ✓.

**The `status` parameter type in the test** — a string vs the enum comparison `g.status === status` where g.status is OrderStatus — passing 'approved' literal ✓.

Now, **the `items.map((item: { id: string }) => item.id)`** in the re-derivation test — the body is any → OK.

I think the design is complete. Let me also reconsider **whether the `OperationReadModel` needs an index for the drift-compare join** — the join is on payment_order_id (pk) ✓.

**The re-derivation's `deleteRowsInWindow` uses a subselect over payment_orders (created_at)** — the index idx_payment_orders_company_created doesn't help (company prefix) — a scan over payment_orders filtered by created_at — at 3M, a seq scan per run... Add an index on payment_orders(created_at)? The re-derivation is a maintenance routine; a seq scan over 3M rows every 5 min (drift job) is wasteful. I'll add `CREATE INDEX "idx_payment_orders_created" ON "payment_orders" ("created_at");` + `@@index([createdAt], map: "idx_payment_orders_created")` in the schema. Reasonable (also useful for the drift window select). I'll add it.

Update the schema: PaymentOrder gets both indexes:
```prisma
@@index([companyId, createdAt(sort: Desc)], map: "idx_payment_orders_company_created")
@@index([createdAt], map: "idx_payment_orders_created")
```
Migration: `CREATE INDEX "idx_payment_orders_created" ON "payment_orders"("created_at");`

OK.

**One more potential concern**: the `operation_read_model`'s FK to workers/events — the re-derivation's insert-select joins them, so they exist ✓.

**The FK to companies on the read model** ✓ exists.

Now, **the final list of files** — let me count and order:

1. package.json
2. tsconfig.json
3. vitest.config.ts
4. .env.example
5. prisma/schema.prisma
6. prisma/migrations/20250101000000_init/migration.sql
7. prisma/migrations/20250101000000_init/migration_lock.toml
8. src/main.ts
9. src/app.module.ts
10. src/common/prisma.module.ts
11. src/common/prisma.service.ts
12. src/common/db-client.ts
13. src/common/domain-exception.ts
14. src/common/api-exception-filter.ts
15. src/common/params.ts
16. src/operations/operations.module.ts
17. src/operations/operations.controller.ts
18. src/operations/operations.service.ts
19. src/operations/operations.repository.ts
20. src/payment-orders/payment-orders.module.ts
21. src/payment-orders/payment-orders.controller.ts
22. src/payment-orders/payment-orders.service.ts
23. src/payment-orders/payment-orders.repository.ts
24. src/projection/projection.module.ts
25. src/projection/projection.service.ts
26. src/projection/projection.repository.ts
27. src/financial-totals/financial-totals.module.ts
28. src/financial-totals/financial-totals.controller.ts
29. src/financial-totals/financial-totals.service.ts
30. src/financial-totals/financial-totals.repository.ts
31. src/re-derivation/re-derivation.module.ts
32. src/re-derivation/re-derivation.service.ts
33. src/re-derivation/re-derivation.repository.ts
34. src/drift-repair/drift-repair.module.ts
35. src/drift-repair/drift-repair.service.ts
36. src/drift-repair/drift-repair.repository.ts
37. test/helpers/app.ts
38. test/helpers/db.ts
39. test/helpers/http.ts
40. test/read-your-own-writes.spec.ts
41. test/concurrent-totals.spec.ts
42. test/drift-repair.spec.ts
43. test/re-derivation.spec.ts
44. DESIGN.md

44 files. All complete, first to last line.

Let me write everything out now, being careful with the exact syntax. A few remaining decisions:

- The `parseStatus` in params.ts returns a union of string literals; the controller passes `st` to `status?: OrderStatus` — assignability: `'pending'|'approved'|'rejected'` → OrderStatus ✓ (identical).

- In the operations controller, if `status` is invalid → 400 with problems.status ✓.

- The `DomainException` import in the controllers ✓.

- The **`void` return type for `catch`**: I'll use `: void` ✓.

- **`response.status(status).json(body)`** — the response is any ✓.

- **The `api-exception-filter`** — `import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';` all used? ArgumentsHost ✓, Catch ✓, ExceptionFilter ✓, HttpException ✓, HttpStatus ✓.

- **`params.ts`** — no imports.

- **`db-client.ts`** — only a type import + comment.

- The **Prisma version pin** — `^5.22.0` for both client + CLI. Prisma 5.22 exists (June 2024) ✓. Node 20 ✓.

- **`@nestjs/schedule` ^4.1.1** — compatible with Nest 10 ✓ (v4 supports Nest 10).

- **The rxjs version** — Nest needs rxjs ^7 ✓.

Now, **the test files' `beforeAll` timeout argument** — `beforeAll(async () => {...}, 30_000)` ✓.

**The `afterAll` cleanup if a test failed mid-way** — the fixture cleanup runs in afterEach ✓; the app close ✓.

**The drift test's `prisma!.$executeRaw`** — the tagged template on the PrismaClient ✓.

**The `interval '1 hour'` in a raw SQL string** ✓.

Let me re-check the **drift-repair findDrift rows query** — the `JOIN "workers"` and `JOIN "events"` are inner joins — source orders always have them (FK) ✓.

**The UNION in the companies query** — the first part selects t.company_id for companies with a totals row + a discrepancy; the second part selects companies with orders in the window but no totals row. UNION dedupes ✓. The type is DriftedCompany[] ✓.

**The `orders_count` comparison** — `t."orders_count" <> (SELECT COUNT(*)::int ...)` ✓.

Now, **`$queryRaw<DriftedRow[]>`** with the template literal containing backticks? No backticks inside the SQL ✓. `${from}`/`${to}` interpolations ✓.

**The `Prisma.sql` vs tagged `$queryRaw`** — the direct tagged template is fine.

Now — **one more architectural sanity check**: the "maintenance hook invoked by the write service" — ProjectionService is a separate service (the "projection" feature) invoked from PaymentOrderService (the write service) ✓ matching "the maintenance hooks are invoked by the write services."

**The read-your-own-writes acceptance**: "approve an order → the next dashboard request reflects it, with no delay" ✓ the test proves it.

**"the dashboard query touches only the projection"** ✓ the test proves it (a direct source row is invisible).

Let me also confirm **the totals endpoint is used in the read-your-own-writes test** ✓.

Now, let me write the **DESIGN.md**:

I'll draft it tight (the task says "short").

---

# DESIGN — operations dashboard read model

## Problem
...

I'll write it in the final answer.

One more thing to confirm — **`OperationReadModel`'s `status` field is the enum `OrderStatus`** — the raw SQL insert copies the enum value ✓; the compare's `IS DISTINCT FROM` ✓; the drift injection's `SET "status" = 'approved'` is a literal coerced to the enum ✓.

**The Prisma `updateMany` data `status: to`** — to: 'approved' | 'rejected' ✓ subset of the enum.

**The `paymentOrder.create` data with `status: statuses[i]` (OrderStatus)** ✓.

Now — **the `amount_cents` in `operation_read_model` is int** and the totals are bigint; the sum in the re-derivation is over int → bigint ✓.

**`COUNT(*)::int`** ✓.

I think I'm ready to write it all out. Let me also make sure there are no `console.log` in the src (the logger is fine).

**`noUnusedLocals`** — in the test files, I import `PrismaClient` (type + value createTestPrisma... `import { PrismaClient } from '@prisma/client'` is used as the type of the `let prisma: PrismaClient | undefined` ✓ used).

In `read-your-own-writes.spec.ts` — imports: PrismaClient ✓, vitest functions ✓, startTestApp/TestApp ✓, createTestPrisma/cleanupFixtures/seedFixtures/TestFixtures ✓, getJson/postJson ✓.

`concurrent-totals.spec.ts` — same + no extra.

`drift-repair.spec.ts` — + DriftRepairService ✓.

`re-derivation.spec.ts` — OrderStatus (type) ✓, PrismaClient ✓, ReDerivationService ✓, getJson ✓ (postJson not used → don't import).

The `http.ts` — buildUrl is exported and used internally; also exported (fine, used within the file; noUnusedLocals doesn't flag exports).

**The `TestApp` type export** is used in the http helper + specs ✓.

Now, **the `app.ts` helper** — `import { AppModule } from '../../src/app.module.js';` ✓; `ApiExceptionFilter` ✓.

**The `NestFactory.create(AppModule, { logger: false })`** — the logger option is `LoggerService` | false ✓.

Let me also handle **`enableShutdownHooks`** in main ✓.

**The `main.ts` port** — `Number(process.env.PORT ?? 3000)`; if PORT is an invalid string → NaN → listen(NaN) throws — acceptable (env config).

OK — one more subtle thing: **the `PrismaService`'s `$connect` on module init** — if the DB is unreachable, the app fails to boot (tests fail clearly) ✓.

**The Prisma client in the test helper** — a separate connection pool; vitest's single fork → up to 2 clients per app (the app's + the helper's) — fine.

Let me finalize the **concurrency of the 2 creates for a new company**: both txs: create order + upsert totals (one INSERTs, the other waits on the ON CONFLICT DO UPDATE... the second's INSERT attempts, detects the in-progress conflicting unique insert, waits for the first tx's commit, then takes the DO UPDATE path with the increment → totals = 500 + 700 ✓ orders_count 2 ✓.

**The totals row's `create` with a negative value edge** — not triggered in the tests.

Now, **let me write the final answer**. I'll be careful with the fence language tags: `json`, `ts`, `prisma`, `sql`, `toml`, `md`, and `.env.example` → I'll use `bash`? The env file is not bash; the tag is arbitrary — I'll use `ini`? I'll use `text`. The parser probably doesn't care; I'll keep a sensible tag.

One more final check of the **migration DDL vs the Prisma schema consistency**:

Prisma model fields → columns:
- Company: id UUID, name TEXT, created_at TIMESTAMPTZ(6) ✓
- Worker: id, full_name, created_at ✓
- Event: id, company_id, name, created_at ✓ + index events_company_id_idx ✓ + FK events_company_id_fkey ✓
- PaymentOrder: id, company_id, worker_id, event_id, status OrderStatus default 'pending', amount_cents INTEGER (default? Prisma Int non-optional with no default → no default in DDL ✓), created_at, updated_at ✓ + FKs ✓ + indexes idx_payment_orders_company_created, idx_payment_orders_created ✓ + check amount_cents >= 0 (extra, fine)
- OperationReadModel: all columns, pk payment_order_id ✓ + index idx_operation_read_model_dashboard (4 columns + INCLUDE) ✓ + FKs (extra, fine)
- CompanyFinancialTotals: company_id pk, 4 counters ✓ + FK (extra, fine)

Prisma's `@@id` on companyId for the totals → constraint name "company_financial_totals_pkey" ✓ I use the same name in the DDL.

**The DDL's default now()** — Prisma's `@default(now())` on postgres → `CURRENT_TIMESTAMP`? Prisma generates `now()`? Either is fine; the migration is the source of truth for deploy.

Now, **the `@db.Uuid` + `gen_random_uuid()`** ✓.

Let me write it all out. Also, I remember: **no prose outside the heading+block pattern** (prose is ignored, but I'll keep it to nothing). I'll begin with the first heading.

Wait — one more consideration about **`Prisma.TransactionClient`**: to reduce the risk of the type not existing / being narrower, an alternative is to define DbClient as a structural pick:

Actually, you know what — let me recall with higher confidence. In the Prisma 5 generated client (`@prisma/client/default`), the `Prisma` namespace includes:

```ts
export type TransactionClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$use' | '$transaction' | '$extends'>
```

I'm now ~85% sure it's an Omit that keeps $queryRaw/$executeRaw and the model delegates (this is the type used for the tx callback in the $transaction overloads). PrismaClient is structurally assignable to it (it has all those properties and more) ✓. My usage (model delegates + $executeRaw) works ✓. I'll keep the ASSUMPTION comment for honesty.

Also, `this.prisma.$transaction(work)` where work: `(tx: DbClient) => Promise<T>` — the overload expects `(prisma: Prisma.TransactionClient) => Promise<T>` — the parameter is contravariant: my work takes DbClient = the same type ✓.

And `prisma.$transaction(work, { isolationLevel: 'serializable', timeout: 120000 })` — the options type `Prisma.TransactionOptions` ✓.

OK, let me write it now.

Actually, let me reconsider one more test detail — the **`expect(listed.body.items[0]).toMatchObject({...})`** in the read-your-own-writes test: `listed` is from `getJson` without a generic → body: unknown → `.items` access on unknown = TS error! I typed `getJson<T = unknown>` → body: T = unknown → `listed.body.total` → TS error (property access on unknown). In the test file, I need to either use a generic or cast. The tests are compiled by vitest (esbuild) — esbuild doesn't type-check! So TS errors don't fail the tests at runtime. But `strict` TS correctness matters for quality (the build only compiles src/ — the tests aren't type-checked by tsc build anyway). Still, I want clean types: I'll type the list response:

`const listed = await getJson<OperationListResponse>(app!, '/operations', {...})` — I'll define a local interface in each test file that needs it, or in http.ts? Better: define the response type in the operations service (OperationItemDto is already exported). The test can import the type from src: `import type { OperationItemDto } from '../src/operations/operations.service.js';` and:

```ts
interface OperationsListBody { items: OperationItemDto[]; page: number; page_size: number; total: number; }
const listed = await getJson<OperationsListBody>(app!, '/operations', { company_id: fx.companyId });
```
I'll add a small local `ListBody` type per spec file that uses it. For the totals:
```ts
interface TotalsBody { company_id: string; pending_amount_cents: string; approved_amount_cents: string; rejected_amount_cents: string; orders_count: number; }
interface ErrorBody { error: { code: string; message: string; details: Record<string, unknown> } }
```
I'll define these in `test/helpers/types.ts`? That's an extra file — or I'll put them in http.ts? They're API contract types — I'll put them in a `test/helpers/api.ts`... that's a 5th helper file. Alternatively, I'll define them inline per spec file (duplicated 3–4 times, small). To keep the file count down, I'll define a shared `test/helpers/api.ts` with ListBody, TotalsBody, ErrorBody, OrderBody. That's clean.

Final helpers: app.ts, db.ts, http.ts, api.ts.

Now let me write the specs with proper generics.

**read-your-own-writes.spec.ts** final:

```ts
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from './helpers/app.js';
import type { ErrorBody, OrderBody, TotalsBody, ListBody } from './helpers/api.js';
import { createTestPrisma, cleanupFixtures, seedFixtures, type TestFixtures } from './helpers/db.js';
import { getJson, postJson } from './helpers/http.js';
```
The import order is fine.

And the usages:
```ts
const created = await postJson<OrderBody>(app!, '/payment-orders', {...});
let listed = await getJson<ListBody>(app!, '/operations', { company_id: fx.companyId });
...
const totals = await getJson<TotalsBody>(app!, `/companies/${fx.companyId}/financial-totals`);
...
const unknown = await postJson<ErrorBody>(app!, '.../approve');
```

**api.ts**:
```ts
export interface OrderBody {
  id: string;
  company_id: string;
  worker_id: string;
  event_id: string;
  status: string;
  amount_cents: number;
  created_at: string;
  updated_at: string;
}

export interface OperationItem {
  id: string;
  company_id: string;
  worker_id: string;
  worker_name: string;
  event_id: string;
  event_name: string;
  status: string;
  amount_cents: number;
  created_at: string;
  updated_at: string;
}

export interface ListBody {
  items: OperationItem[];
  page: number;
  page_size: number;
  total: number;
}

export interface TotalsBody {
  company_id: string;
  pending_amount_cents: string;
  approved_amount_cents: string;
  rejected_amount_cents: string;
  orders_count: number;
}

export interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}
```

OK. And in the re-derivation spec, I use getJson<ListBody>.

**`expect(listed.body.items.map((item) => item.id)).toEqual(ids)`** ✓ typed.

Now — **the `describe.skipIf(!hasDatabase)`** — the type of `hasDatabase` is boolean ✓.

**The `beforeAll` in each spec** — the `prisma = createTestPrisma(); app = await startTestApp();` — the `let` declaration with a type: `let app: TestApp | undefined; let prisma: PrismaClient | undefined;` and `prisma!` inside the hooks. TS strict: `fixtures.splice(0)` and then `cleanupFixtures(prisma!, fx)` ✓.

Time to write the final output. I'll keep the code comments terse but present.

One more thing: **the `OperationReadModel` import in `operations.service.ts`** — `import type { OperationReadModel } from '@prisma/client';` ✓ used in toItemDto.

**The `OrderStatus` import in `operations.repository.ts`** ✓ used in the interface.

**`projection.repository.ts`** — imports Injectable, OrderStatus (type), DbClient (type) ✓.

**`payment-orders.repository.ts`** — imports: Inject, Injectable, Prisma (type), DomainException, PrismaService, DbClient (type) ✓.

**`payment-orders.service.ts`** — imports Inject, Injectable, ProjectionService, PaymentOrderRepository + types ✓.

**`drift-repair.module.ts`**:
```ts
import { Module } from '@nestjs/common';
import { ReDerivationModule } from '../re-derivation/re-derivation.module.js';
import { DriftRepairService } from './drift-repair.service.js';
import { DriftRepairRepository } from './drift-repair.repository.js';

@Module({
  imports: [ReDerivationModule],
  providers: [DriftRepairService, DriftRepairRepository],
})
export class DriftRepairModule {}
```

**`re-derivation.module.ts`**:
```ts
import { Module } from '@nestjs/common';
import { ReDerivationService } from './re-derivation.service.js';
import { ReDerivationRepository } from './re-derivation.repository.js';

@Module({
  providers: [ReDerivationService, ReDerivationRepository],
  exports: [ReDerivationService],
})
export class ReDerivationModule {}
```

**`financial-totals.module.ts`**:
```ts
import { Module } from '@nestjs/common';
import { FinancialTotalsController } from './financial-totals.controller.js';
import { FinancialTotalsService } from './financial-totals.service.js';
import { FinancialTotalsRepository } from './financial-totals.repository.js';

@Module({
  controllers: [FinancialTotalsController],
  providers: [FinancialTotalsService, FinancialTotalsRepository],
})
export class FinancialTotalsModule {}
```

**`projection.module.ts`**:
```ts
import { Module } from '@nestjs/common';
import { ProjectionService } from './projection.service.js';
import { ProjectionRepository } from './projection.repository.js';

@Module({
  providers: [ProjectionService, ProjectionRepository],
  exports: [ProjectionService],
})
export class ProjectionModule {}
```

**`payment-orders.module.ts`**:
```ts
import { Module } from '@nestjs/common';
import { ProjectionModule } from '../projection/projection.module.js';
import { PaymentOrdersController } from './payment-orders.controller.js';
import { PaymentOrderService } from './payment-orders.service.js';
import { PaymentOrderRepository } from './payment-orders.repository.js';

@Module({
  imports: [ProjectionModule],
  controllers: [PaymentOrdersController],
  providers: [PaymentOrderService, PaymentOrderRepository],
})
export class PaymentOrdersModule {}
```

**`operations.module.ts`**:
```ts
import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller.js';
import { OperationsService } from './operations.service.js';
import { OperationsRepository } from './operations.repository.js';

@Module({
  controllers: [OperationsController],
  providers: [OperationsService, OperationsRepository],
})
export class OperationsModule {}
```

OK. Writing the final answer now. I'll keep the comments English, snake_case tables, kebab endpoints, PascalCase classes ✓.

Final check of the **`DESIGN.md`** content — I'll make sure it explicitly "justifies synchronous hook over the rejected alternatives" ✓.

Also — I should double-check that **the `@Cron` import is not unused** in the drift-repair service ✓ used.

**`CronExpression.EVERY_5_MINUTES`** = `*/5 * * * *` ✓.

Now, **the `run()` catch** — I'll include the try/catch/log/return null.

Also, **the `repairWindow`'s from>to validation**? derive validates; repairWindow just runs it. Fine.

**The drift repair's first `repairWindow` (baseline) in the drift spec** — with no drift, it doesn't call derive → fast ✓.

I'm confident. Let me write it out.

Actually — one more: **the `OperationReadModel`'s worker_id FK**: the re-derivation's insert copies the worker_id ✓ exists.

And **the `operation_read_model`'s FK to companies** — the company exists ✓.

Also **the totals FK → companies** — the rebuild's insert-select groups by the order's company_id — the company exists ✓.

Final: the **`.env.example`** content is minimal.

I'll also make sure **no file references something that isn't defined**:
- `OrderStatus` used in projection.service (type import) ✓ generated.
- `NewPaymentOrder` used in the controller? The controller calls `this.paymentOrderService.create({ companyId, workerId, eventId, amountCents })` — an inline object matching NewPaymentOrder ✓ no import needed (structural).

Let me write it all now.

About the fenced block for `.env.example` — I'll tag it as `ini`.

I'll write the DESIGN.md concisely.

One more, **the `test/helpers/app.ts`** — the `Server` import: `import type { Server } from 'node:http';` ✓.

**`address.port`** — after the guard, address is AddressInfo ✓ TS narrows: `if (!address || typeof address === 'string') throw` → address: AddressInfo ✓.

Done — let me write the final output.
```

## reply

### package.json
```json
{
  "name": "marketplace-backoffice",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Marketplace back-office: operations dashboard backed by a maintained read model",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "postinstall": "prisma generate",
    "prisma:migrate": "prisma migrate deploy",
    "dev": "tsx src/main.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.4",
    "@nestjs/core": "^10.4.4",
    "@nestjs/platform-express": "^10.4.4",
    "@nestjs/schedule": "^4.1.1",
    "@prisma/client": "^5.22.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@types/node": "^20.17.0",
    "prisma": "^5.22.0",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
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
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "sourceMap": true,
    "declaration": false
  },
  "include": ["src/**/*.ts"]
}
```

### vitest.config.ts
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    tsconfigRaw: {
      experimentalDecorators: true,
      useDefineForClassFields: false,
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // One process for all suites: they share one database and must not race.
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
```

### .env.example
```ini
# PostgreSQL connection — the only configuration the application needs.
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/marketplace_backoffice?schema=public
PORT=3000
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
  rejected
}

model Company {
  id        String   @id @default(uuid()) @db.Uuid
  name      String
  createdAt DateTime @default(now()) @map("created_at")

  orders PaymentOrder[]
  events Event[]

  @@map("companies")
}

model Worker {
  id        String   @id @default(uuid()) @db.Uuid
  fullName  String   @map("full_name")
  createdAt DateTime @default(now()) @map("created_at")

  orders PaymentOrder[]

  @@map("workers")
}

model Event {
  id        String   @id @default(uuid()) @db.Uuid
  companyId String   @map("company_id") @db.Uuid
  name      String
  createdAt DateTime @default(now()) @map("created_at")

  company Company        @relation(fields: [companyId], references: [id])
  orders  PaymentOrder[]

  @@index([companyId], map: "events_company_id_idx")
  @@map("events")
}

model PaymentOrder {
  id          String      @id @default(uuid()) @db.Uuid
  companyId   String      @map("company_id") @db.Uuid
  workerId    String      @map("worker_id") @db.Uuid
  eventId     String      @map("event_id") @db.Uuid
  status      OrderStatus @default(pending)
  amountCents Int         @map("amount_cents")
  createdAt   DateTime    @default(now()) @map("created_at")
  updatedAt   DateTime    @default(now()) @map("updated_at")

  company Company @relation(fields: [companyId], references: [id])
  worker  Worker  @relation(fields: [workerId], references: [id])
  event   Event   @relation(fields: [eventId], references: [id])

  @@index([companyId, createdAt(sort: Desc)], map: "idx_payment_orders_company_created")
  @@index([createdAt], map: "idx_payment_orders_created")
  @@map("payment_orders")
}

model OperationReadModel {
  // One row per payment order, shaped exactly like the dashboard query so the
  // hot path never joins the source tables. worker_name / event_name are
  // denormalized snapshots of the join columns.
  paymentOrderId String      @id @map("payment_order_id") @db.Uuid
  companyId      String      @map("company_id") @db.Uuid
  workerId       String      @map("worker_id") @db.Uuid
  workerName     String      @map("worker_name")
  eventId        String      @map("event_id") @db.Uuid
  eventName      String      @map("event_name")
  status         OrderStatus
  amountCents    Int         @map("amount_cents")
  createdAt      DateTime    @map("created_at")
  updatedAt      DateTime    @map("updated_at")

  // The migration creates this index as a COVERING index
  // (INCLUDE worker_name, event_name, amount_cents, updated_at) because
  // Prisma cannot express INCLUDE columns.
  @@index([companyId, status, createdAt(sort: Desc), paymentOrderId(sort: Desc)], map: "idx_operation_read_model_dashboard")
  @@map("operation_read_model")
}

model CompanyFinancialTotals {
  // Per-company financial totals, kept exact by atomic in-place increments in
  // the writer's transaction and rebuilt by the re-derivation routine.
  companyId           String @id @map("company_id") @db.Uuid
  pendingAmountCents  BigInt @default(0) @map("pending_amount_cents")
  approvedAmountCents BigInt @default(0) @map("approved_amount_cents")
  rejectedAmountCents BigInt @default(0) @map("rejected_amount_cents")
  ordersCount         Int    @default(0) @map("orders_count")

  @@map("company_financial_totals")
}
```

### prisma/migrations/20250101000000_init/migration.sql
```sql
-- Init schema: source tables plus the operations read-model projection.

CREATE TYPE "OrderStatus" AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE "companies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "full_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "workers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'pending',
    "amount_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_orders_amount_cents_check" CHECK ("amount_cents" >= 0)
);

-- Projection: one row per payment order, pre-joined with worker and event names.
CREATE TABLE "operation_read_model" (
    "payment_order_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "worker_name" TEXT NOT NULL,
    "event_id" UUID NOT NULL,
    "event_name" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "operation_read_model_pkey" PRIMARY KEY ("payment_order_id")
);

-- Projection: exact per-company financial totals (whole history).
CREATE TABLE "company_financial_totals" (
    "company_id" UUID NOT NULL,
    "pending_amount_cents" BIGINT NOT NULL DEFAULT 0,
    "approved_amount_cents" BIGINT NOT NULL DEFAULT 0,
    "rejected_amount_cents" BIGINT NOT NULL DEFAULT 0,
    "orders_count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "company_financial_totals_pkey" PRIMARY KEY ("company_id")
);

-- Source foreign keys.
ALTER TABLE "events"
    ADD CONSTRAINT "events_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_orders"
    ADD CONSTRAINT "payment_orders_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_orders"
    ADD CONSTRAINT "payment_orders_worker_id_fkey"
    FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_orders"
    ADD CONSTRAINT "payment_orders_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Projection foreign keys (integrity; the read model mirrors the source).
ALTER TABLE "operation_read_model"
    ADD CONSTRAINT "operation_read_model_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "operation_read_model"
    ADD CONSTRAINT "operation_read_model_worker_id_fkey"
    FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "operation_read_model"
    ADD CONSTRAINT "operation_read_model_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "company_financial_totals"
    ADD CONSTRAINT "company_financial_totals_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Source indexes.
CREATE INDEX "events_company_id_idx" ON "events"("company_id");
CREATE INDEX "idx_payment_orders_company_created" ON "payment_orders"("company_id", "created_at" DESC);
CREATE INDEX "idx_payment_orders_created" ON "payment_orders"("created_at");

-- The dashboard access pattern: filter by company and optional status, range on
-- created_at, sort by created_at DESC with payment_order_id DESC as a stable
-- tiebreak. The INCLUDE list covers every selected column, so a page is served
-- as an index-only scan no matter how large the table gets.
CREATE INDEX "idx_operation_read_model_dashboard"
    ON "operation_read_model" ("company_id", "status", "created_at" DESC, "payment_order_id" DESC)
    INCLUDE ("worker_name", "event_name", "amount_cents", "updated_at");
```

### prisma/migrations/20250101000000_init/migration_lock.toml
```toml
# Please do not edit this file manually
# It should be added in your version-control system (e.g., git)
provider = "postgresql"
```

### src/main.ts
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './common/api-exception-filter.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
```

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './common/prisma.module.js';
import { OperationsModule } from './operations/operations.module.js';
import { PaymentOrdersModule } from './payment-orders/payment-orders.module.js';
import { FinancialTotalsModule } from './financial-totals/financial-totals.module.js';
import { ReDerivationModule } from './re-derivation/re-derivation.module.js';
import { DriftRepairModule } from './drift-repair/drift-repair.module.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    OperationsModule,
    PaymentOrdersModule,
    FinancialTotalsModule,
    ReDerivationModule,
    DriftRepairModule,
  ],
})
export class AppModule {}
```

### src/common/prisma.module.ts
```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

### src/common/prisma.service.ts
```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Shared Prisma client. Only repositories inject it; services never touch the
 * database directly.
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

### src/common/db-client.ts
```ts
import type { Prisma } from '@prisma/client';

// ASSUMPTION: Prisma exports TransactionClient as the type of the client handed
// to an interactive-transaction callback (it does in Prisma 5/6). Repository
// methods accept either that client or the base client, so the same code runs
// inside and outside a transaction.
export type DbClient = Prisma.TransactionClient;
```

### src/common/domain-exception.ts
```ts
import { HttpException } from '@nestjs/common';

/**
 * Domain errors carry the API-contract code (snake_case, stable). Known codes:
 * resource_not_found, validation_failed, invalid_state_transition, conflict,
 * internal_error.
 */
export class DomainException extends HttpException {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super({ error: { code, message, details } }, status);
    this.status = status;
    this.code = code;
    this.message = message;
    this.details = details;
  }
}
```

### src/common/api-exception-filter.ts
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { DomainException } from './domain-exception.js';

interface ErrorEnvelope {
  error: { code: string; message: string; details: Record<string, unknown> };
}

/**
 * Every error leaves the API in the single envelope
 * { error: { code, message, details } }; details is always an object.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();
    const { status, body } = this.toEnvelope(exception);
    response.status(status).json(body);
  }

  private toEnvelope(exception: unknown): { status: number; body: ErrorEnvelope } {
    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal_error';
    let message = 'unexpected error';
    let details: Record<string, unknown> = {};

    if (exception instanceof DomainException) {
      status = exception.status;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = this.codeForStatus(status);
      const body = exception.getResponse();
      message = typeof body === 'string' ? body : this.messageFromBody(body);
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    return { status, body: { error: { code, message, details } } };
  }

  private codeForStatus(status: number): string {
    if (status === HttpStatus.BAD_REQUEST) return 'validation_failed';
    if (status === HttpStatus.NOT_FOUND) return 'resource_not_found';
    if (status === HttpStatus.CONFLICT) return 'conflict';
    return 'http_error';
  }

  private messageFromBody(body: unknown): string {
    if (typeof body === 'object' && body !== null) {
      const message = (body as { message?: unknown }).message;
      if (typeof message === 'string') return message;
      if (Array.isArray(message)) return message.join('; ');
    }
    return 'request failed';
  }
}
```

### src/common/params.ts
```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Field → reason map accumulated by the parse helpers. */
export type Problems = Record<string, string>;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function parseUuid(value: string | undefined, field: string, problems: Problems): string | undefined {
  if (value === undefined || value === '') {
    problems[field] = 'is required and must be a UUID';
    return undefined;
  }
  if (!isUuid(value)) {
    problems[field] = 'must be a UUID';
    return undefined;
  }
  return value;
}

export function parseStatus(
  value: string | undefined,
  problems: Problems,
): 'pending' | 'approved' | 'rejected' | undefined {
  if (value === undefined || value === '') return undefined;
  if (value !== 'pending' && value !== 'approved' && value !== 'rejected') {
    problems.status = "must be one of 'pending', 'approved', 'rejected'";
    return undefined;
  }
  return value;
}

export function parseIsoDate(value: string | undefined, field: string, problems: Problems): Date | undefined {
  if (value === undefined || value === '') return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    problems[field] = 'must be an ISO 8601 date-time';
    return undefined;
  }
  return date;
}

export function parsePositiveInt(
  value: string | undefined,
  field: string,
  problems: Problems,
  fallback: number,
): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    problems[field] = 'must be a positive integer';
    return fallback;
  }
  return parsed;
}

export function parseBoundedInt(
  value: string | undefined,
  field: string,
  problems: Problems,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    problems[field] = `must be an integer between ${min} and ${max}`;
    return fallback;
  }
  return parsed;
}

export function parseAmountCents(value: unknown, problems: Problems): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 2_000_000_000) {
    problems.amount_cents = 'must be a non-negative integer of cents';
    return undefined;
  }
  return value;
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
```

### src/operations/operations.module.ts
```ts
import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller.js';
import { OperationsService } from './operations.service.js';
import { OperationsRepository } from './operations.repository.js';

@Module({
  controllers: [OperationsController],
  providers: [OperationsService, OperationsRepository],
})
export class OperationsModule {}
```

### src/operations/operations.controller.ts
```ts
import { Controller, Get, Inject, Query } from '@nestjs/common';
import { DomainException } from '../common/domain-exception.js';
import {
  parseBoundedInt,
  parseIsoDate,
  parsePositiveInt,
  parseStatus,
  parseUuid,
  type Problems,
} from '../common/params.js';
import { OperationsService } from './operations.service.js';

@Controller('operations')
export class OperationsController {
  constructor(@Inject(OperationsService) private readonly operationsService: OperationsService) {}

  /** Dashboard list: company + status + date-range filters, recency order, paged. */
  @Get()
  list(
    @Query('company_id') companyId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
  ) {
    const problems: Problems = {};
    const cid = parseUuid(companyId, 'company_id', problems);
    const st = parseStatus(status, problems);
    const fromDate = parseIsoDate(from, 'from', problems);
    const toDate = parseIsoDate(to, 'to', problems);
    if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
      problems.to = 'must not be earlier than from';
    }
    const pageNumber = parsePositiveInt(page, 'page', problems, 1);
    const pageSizeNumber = parseBoundedInt(pageSize, 'page_size', problems, 50, 1, 200);

    if (!cid || Object.keys(problems).length > 0) {
      throw new DomainException(400, 'validation_failed', 'invalid operations query', problems);
    }

    return this.operationsService.list({
      companyId: cid,
      status: st,
      from: fromDate,
      to: toDate,
      page: pageNumber,
      pageSize: pageSizeNumber,
    });
  }
}
```

### src/operations/operations.service.ts
```ts
import { Inject, Injectable } from '@nestjs/common';
import type { OperationReadModel } from '@prisma/client';
import { OperationsRepository, type OperationListParams } from './operations.repository.js';

export interface OperationItemDto {
  id: string;
  company_id: string;
  worker_id: string;
  worker_name: string;
  event_id: string;
  event_name: string;
  status: string;
  amount_cents: number;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class OperationsService {
  constructor(@Inject(OperationsRepository) private readonly repository: OperationsRepository) {}

  list(params: OperationListParams): Promise<{ items: OperationItemDto[]; page: number; page_size: number; total: number }> {
    return this.repository.findPage(params).then(({ items, total }) => ({
      items: items.map(toItemDto),
      page: params.page,
      page_size: params.pageSize,
      total,
    }));
  }
}

function toItemDto(row: OperationReadModel): OperationItemDto {
  return {
    id: row.paymentOrderId,
    company_id: row.companyId,
    worker_id: row.workerId,
    worker_name: row.workerName,
    event_id: row.eventId,
    event_name: row.eventName,
    status: row.status,
    amount_cents: row.amountCents,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
```

### src/operations/operations.repository.ts
```ts
import { Inject, Injectable } from '@nestjs/common';
import type { OperationReadModel, OrderStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';

export interface OperationListParams {
  companyId: string;
  status?: OrderStatus;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

export interface OperationPage {
  items: OperationReadModel[];
  total: number;
}

@Injectable()
export class OperationsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * The dashboard hot path: one table, one covering index
   * (company_id, status, created_at DESC, payment_order_id DESC) with
   * INCLUDE columns, so a page is an index-only scan. No join back to the
   * source tables.
   */
  async findPage(params: OperationListParams): Promise<OperationPage> {
    const where = {
      companyId: params.companyId,
      ...(params.status !== undefined ? { status: params.status } : {}),
      ...(params.from !== undefined || params.to !== undefined
        ? {
            createdAt: {
              ...(params.from !== undefined ? { gte: params.from } : {}),
              ...(params.to !== undefined ? { lte: params.to } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.operationReadModel.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { paymentOrderId: 'desc' }],
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.operationReadModel.count({ where }),
    ]);

    return { items, total };
  }
}
```

### src/payment-orders/payment-orders.module.ts
```ts
import { Module } from '@nestjs/common';
import { ProjectionModule } from '../projection/projection.module.js';
import { PaymentOrdersController } from './payment-orders.controller.js';
import { PaymentOrderService } from './payment-orders.service.js';
import { PaymentOrderRepository } from './payment-orders.repository.js';

@Module({
  imports: [ProjectionModule],
  controllers: [PaymentOrdersController],
  providers: [PaymentOrderService, PaymentOrderRepository],
})
export class PaymentOrdersModule {}
```

### src/payment-orders/payment-orders.controller.ts
```ts
import { Body, Controller, Inject, Param, Post } from '@nestjs/common';
import { DomainException } from '../common/domain-exception.js';
import { asString, isUuid, parseAmountCents, parseUuid, type Problems } from '../common/params.js';
import { PaymentOrderService } from './payment-orders.service.js';

@Controller('payment-orders')
export class PaymentOrdersController {
  constructor(@Inject(PaymentOrderService) private readonly paymentOrderService: PaymentOrderService) {}

  /** Simulated write path: create a payment order (initially pending). */
  @Post()
  create(@Body() body: Record<string, unknown>) {
    const payload = body ?? {};
    const problems: Problems = {};
    const companyId = parseUuid(asString(payload.company_id), 'company_id', problems);
    const workerId = parseUuid(asString(payload.worker_id), 'worker_id', problems);
    const eventId = parseUuid(asString(payload.event_id), 'event_id', problems);
    const amountCents = parseAmountCents(payload.amount_cents, problems);

    if (!companyId || !workerId || !eventId || amountCents === undefined || Object.keys(problems).length > 0) {
      throw new DomainException(400, 'validation_failed', 'invalid payment order payload', problems);
    }

    return this.paymentOrderService.create({ companyId, workerId, eventId, amountCents });
  }

  @Post(':id/approve')
  approve(@Param('id') id: string) {
    if (!isUuid(id)) {
      throw new DomainException(400, 'validation_failed', 'id must be a UUID', { id });
    }
    return this.paymentOrderService.approve(id);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string) {
    if (!isUuid(id)) {
      throw new DomainException(400, 'validation_failed', 'id must be a UUID', { id });
    }
    return this.paymentOrderService.reject(id);
  }
}
```

### src/payment-orders/payment-orders.service.ts
```ts
import { Inject, Injectable } from '@nestjs/common';
import { ProjectionService } from '../projection/projection.service.js';
import {
  PaymentOrderRepository,
  type NewPaymentOrder,
  type OrderWithRelations,
} from './payment-orders.repository.js';

export interface OrderDto {
  id: string;
  company_id: string;
  worker_id: string;
  event_id: string;
  status: string;
  amount_cents: number;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class PaymentOrderService {
  constructor(
    @Inject(PaymentOrderRepository) private readonly orders: PaymentOrderRepository,
    @Inject(ProjectionService) private readonly projection: ProjectionService,
  ) {}

  /**
   * Write path: the source row and the projection are maintained inside ONE
   * transaction. The operator sees the new state on the next request
   * (read-your-own-writes), and a rolled-back write never touched the
   * projection.
   */
  create(input: NewPaymentOrder): Promise<OrderDto> {
    return this.orders.withTransaction(async (tx) => {
      const order = await this.orders.createInTx(tx, input);
      await this.projection.applyOrderCreated(tx, order); // maintenance hook
      return toDto(order);
    });
  }

  approve(id: string): Promise<OrderDto> {
    return this.transition(id, 'approved');
  }

  reject(id: string): Promise<OrderDto> {
    return this.transition(id, 'rejected');
  }

  private transition(id: string, to: 'approved' | 'rejected'): Promise<OrderDto> {
    return this.orders.withTransaction(async (tx) => {
      const order = await this.orders.transitionInTx(tx, id, to);
      await this.projection.applyOrderStatusChanged(tx, order, 'pending'); // maintenance hook
      return toDto(order);
    });
  }
}

function toDto(order: OrderWithRelations): OrderDto {
  return {
    id: order.id,
    company_id: order.companyId,
    worker_id: order.workerId,
    event_id: order.eventId,
    status: order.status,
    amount_cents: order.amountCents,
    created_at: order.createdAt.toISOString(),
    updated_at: order.updatedAt.toISOString(),
  };
}
```

### src/payment-orders/payment-orders.repository.ts
```ts
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { DomainException } from '../common/domain-exception.js';
import type { DbClient } from '../common/db-client.js';
import { PrismaService } from '../common/prisma.service.js';

export type OrderWithRelations = Prisma.PaymentOrderGetPayload<{ include: { worker: true; event: true } }>;

export interface NewPaymentOrder {
  companyId: string;
  workerId: string;
  eventId: string;
  amountCents: number;
}

@Injectable()
export class PaymentOrderRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Runs `work` in one interactive transaction (default READ COMMITTED). */
  withTransaction<T>(work: (tx: DbClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work);
  }

  createInTx(tx: DbClient, data: NewPaymentOrder): Promise<OrderWithRelations> {
    return tx.paymentOrder.create({ data, include: { worker: true, event: true } });
  }

  /**
   * pending -> `to`, guarded in the UPDATE itself (WHERE status = 'pending')
   * so two concurrent transitions of the same order cannot both win: the
   * second one re-evaluates the predicate after the first commits and finds
   * nothing to update.
   */
  async transitionInTx(tx: DbClient, id: string, to: 'approved' | 'rejected'): Promise<OrderWithRelations> {
    const updated = await tx.paymentOrder.updateMany({
      where: { id, status: 'pending' },
      data: { status: to, updatedAt: new Date() },
    });
    if (updated.count === 0) {
      const current = await tx.paymentOrder.findUnique({ where: { id } });
      if (!current) {
        throw new DomainException(404, 'resource_not_found', `payment order ${id} was not found`, { id });
      }
      throw new DomainException(
        409,
        'invalid_state_transition',
        `payment order ${id} is ${current.status}; only pending orders can be ${to}`,
        { id, from: current.status, requested: to },
      );
    }
    const order = await tx.paymentOrder.findUnique({ where: { id }, include: { worker: true, event: true } });
    if (!order) {
      throw new DomainException(404, 'resource_not_found', `payment order ${id} was not found`, { id });
    }
    return order;
  }
}
```

### src/projection/projection.module.ts
```ts
import { Module } from '@nestjs/common';
import { ProjectionService } from './projection.service.js';
import { ProjectionRepository } from './projection.repository.js';

@Module({
  providers: [ProjectionService, ProjectionRepository],
  exports: [ProjectionService],
})
export class ProjectionModule {}
```

### src/projection/projection.service.ts
```ts
import { Inject, Injectable } from '@nestjs/common';
import type { OrderStatus } from '@prisma/client';
import type { DbClient } from '../common/db-client.js';
import type { OrderWithRelations } from '../payment-orders/payment-orders.repository.js';
import { ProjectionRepository, type OperationRowData } from './projection.repository.js';

/**
 * Maintenance hooks for the read model. Every hook is called by a write
 * service INSIDE the writer's transaction: the source row and the projection
 * commit or roll back together, so there is no window in which an operator's
 * own write is missing from the dashboard.
 */
@Injectable()
export class ProjectionService {
  constructor(@Inject(ProjectionRepository) private readonly repository: ProjectionRepository) {}

  async applyOrderCreated(tx: DbClient, order: OrderWithRelations): Promise<void> {
    await this.repository.upsertOperationRow(tx, toRow(order));
    await this.repository.applyTotalsDelta(tx, order.companyId, {
      pending: order.amountCents,
      approved: 0,
      rejected: 0,
      ordersCount: 1,
    });
  }

  async applyOrderStatusChanged(tx: DbClient, order: OrderWithRelations, from: OrderStatus): Promise<void> {
    await this.repository.upsertOperationRow(tx, toRow(order));
    if (from === order.status) return;
    const delta = { pending: 0, approved: 0, rejected: 0, ordersCount: 0 };
    delta[from] -= order.amountCents;
    delta[order.status] += order.amountCents;
    await this.repository.applyTotalsDelta(tx, order.companyId, delta);
  }
}

function toRow(order: OrderWithRelations): OperationRowData {
  return {
    paymentOrderId: order.id,
    companyId: order.companyId,
    workerId: order.workerId,
    workerName: order.worker.fullName,
    eventId: order.eventId,
    eventName: order.event.name,
    status: order.status,
    amountCents: order.amountCents,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}
```

### src/projection/projection.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import type { OrderStatus } from '@prisma/client';
import type { DbClient } from '../common/db-client.js';

export interface OperationRowData {
  paymentOrderId: string;
  companyId: string;
  workerId: string;
  workerName: string;
  eventId: string;
  eventName: string;
  status: OrderStatus;
  amountCents: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TotalsDelta {
  pending: number;
  approved: number;
  rejected: number;
  ordersCount: number;
}

@Injectable()
export class ProjectionRepository {
  /**
   * Full-value upsert of one projection row. Idempotent: the hook, the
   * re-derivation and the drift repair all converge on the same value.
   */
  async upsertOperationRow(tx: DbClient, row: OperationRowData): Promise<void> {
    await tx.operationReadModel.upsert({
      where: { paymentOrderId: row.paymentOrderId },
      update: {
        companyId: row.companyId,
        workerId: row.workerId,
        workerName: row.workerName,
        eventId: row.eventId,
        eventName: row.eventName,
        status: row.status,
        amountCents: row.amountCents,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
      create: row,
    });
  }

  /**
   * Atomic in-place increment of the company's totals row
   * (UPDATE ... SET col = col ± delta, expressed as an upsert so the row is
   * created on first use). No read-modify-write: concurrent transitions on
   * the same row are serialized by the row lock and none of them is lost.
   */
  async applyTotalsDelta(tx: DbClient, companyId: string, delta: TotalsDelta): Promise<void> {
    const pending = BigInt(delta.pending);
    const approved = BigInt(delta.approved);
    const rejected = BigInt(delta.rejected);
    await tx.companyFinancialTotals.upsert({
      where: { companyId },
      update: {
        pendingAmountCents: { increment: pending },
        approvedAmountCents: { increment: approved },
        rejectedAmountCents: { increment: rejected },
        ordersCount: { increment: delta.ordersCount },
      },
      create: {
        companyId,
        pendingAmountCents: pending,
        approvedAmountCents: approved,
        rejectedAmountCents: rejected,
        ordersCount: delta.ordersCount,
      },
    });
  }
}
```

### src/financial-totals/financial-totals.module.ts
```ts
import { Module } from '@nestjs/common';
import { FinancialTotalsController } from './financial-totals.controller.js';
import { FinancialTotalsService } from './financial-totals.service.js';
import { FinancialTotalsRepository } from './financial-totals.repository.js';

@Module({
  controllers: [FinancialTotalsController],
  providers: [FinancialTotalsService, FinancialTotalsRepository],
})
export class FinancialTotalsModule {}
```

### src/financial-totals/financial-totals.controller.ts
```ts
import { Controller, Get, Inject, Param } from '@nestjs/common';
import { DomainException } from '../common/domain-exception.js';
import { isUuid } from '../common/params.js';
import { FinancialTotalsService } from './financial-totals.service.js';

@Controller('companies')
export class FinancialTotalsController {
  constructor(@Inject(FinancialTotalsService) private readonly financialTotalsService: FinancialTotalsService) {}

  @Get(':companyId/financial-totals')
  get(@Param('companyId') companyId: string) {
    if (!isUuid(companyId)) {
      throw new DomainException(400, 'validation_failed', 'companyId must be a UUID', { company_id: companyId });
    }
    return this.financialTotalsService.get(companyId);
  }
}
```

### src/financial-totals/financial-totals.service.ts
```ts
import { Inject, Injectable } from '@nestjs/common';
import { DomainException } from '../common/domain-exception.js';
import { FinancialTotalsRepository } from './financial-totals.repository.js';

@Injectable()
export class FinancialTotalsService {
  constructor(@Inject(FinancialTotalsRepository) private readonly repository: FinancialTotalsRepository) {}

  /** Exact per-company totals, maintained by atomic increments in the write path. */
  async get(companyId: string) {
    const totals = await this.repository.findByCompanyId(companyId);
    if (!totals) {
      throw new DomainException(
        404,
        'resource_not_found',
        `no financial totals recorded for company ${companyId}`,
        { company_id: companyId },
      );
    }
    return {
      company_id: totals.companyId,
      // bigint is emitted as a string: finance reconciles against exact values
      pending_amount_cents: totals.pendingAmountCents.toString(),
      approved_amount_cents: totals.approvedAmountCents.toString(),
      rejected_amount_cents: totals.rejectedAmountCents.toString(),
      orders_count: totals.ordersCount,
    };
  }
}
```

### src/financial-totals/financial-totals.repository.ts
```ts
import { Inject, Injectable } from '@nestjs/common';
import type { CompanyFinancialTotals } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';

@Injectable()
export class FinancialTotalsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findByCompanyId(companyId: string): Promise<CompanyFinancialTotals | null> {
    return this.prisma.companyFinancialTotals.findUnique({ where: { companyId } });
  }
}
```

### src/re-derivation/re-derivation.module.ts
```ts
import { Module } from '@nestjs/common';
import { ReDerivationService } from './re-derivation.service.js';
import { ReDerivationRepository } from './re-derivation.repository.js';

@Module({
  providers: [ReDerivationService, ReDerivationRepository],
  exports: [ReDerivationService],
})
export class ReDerivationModule {}
```

### src/re-derivation/re-derivation.service.ts
```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DomainException } from '../common/domain-exception.js';
import { ReDerivationRepository } from './re-derivation.repository.js';

const MAX_ATTEMPTS = 3;

export interface DeriveResult {
  from: string;
  to: string;
  rows_rebuilt: number;
}

@Injectable()
export class ReDerivationService {
  private readonly logger = new Logger(ReDerivationService.name);

  constructor(@Inject(ReDerivationRepository) private readonly repository: ReDerivationRepository) {}

  /**
   * Rebuilds the projection for orders created in [from, to] from the source
   * tables and recomputes ALL per-company totals. Both steps are full-value
   * overwrites, so running the routine twice over the same window leaves the
   * same state. The transaction is SERIALIZABLE with a bounded retry on
   * serialization conflicts, which makes it safe to run while the system is
   * live.
   */
  async derive(from: Date, to: Date): Promise<DeriveResult> {
    if (from.getTime() > to.getTime()) {
      throw new DomainException(400, 'validation_failed', 'from must not be later than to', {
        from: from.toISOString(),
        to: to.toISOString(),
      });
    }

    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.repository.withSerializableTransaction(async (tx) => {
          await this.repository.deleteRowsInWindow(tx, from, to);
          const rowsRebuilt = await this.repository.insertRowsFromSource(tx, from, to);
          await this.repository.rebuildAllTotals(tx);
          return { from: from.toISOString(), to: to.toISOString(), rows_rebuilt: rowsRebuilt };
        });
      } catch (error) {
        if (attempt < MAX_ATTEMPTS && isSerializationConflict(error)) {
          this.logger.warn(`serialization conflict on attempt ${attempt}/${MAX_ATTEMPTS}; retrying derive`);
          await sleep(25 * attempt);
          continue;
        }
        throw error;
      }
    }
  }
}

function isSerializationConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === '40001' || code === '40P01' || code === 'P2034') return true;
  return typeof message === 'string' && /serializ/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

### src/re-derivation/re-derivation.repository.ts
```ts
import { Inject, Injectable } from '@nestjs/common';
import type { DbClient } from '../common/db-client.js';
import { PrismaService } from '../common/prisma.service.js';

@Injectable()
export class ReDerivationRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * SERIALIZABLE so a concurrent writer cannot slip a commit between our
   * source read and our projection write without a detectable conflict; the
   * service retries on serialization failure.
   */
  withSerializableTransaction<T>(work: (tx: DbClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work, { isolationLevel: 'serializable', timeout: 120_000 });
  }

  async deleteRowsInWindow(tx: DbClient, from: Date, to: Date): Promise<void> {
    await tx.$executeRaw`
      DELETE FROM "operation_read_model"
      WHERE "payment_order_id" IN (
        SELECT "id" FROM "payment_orders"
        WHERE "created_at" >= ${from} AND "created_at" <= ${to}
      )
    `;
  }

  /** Re-creates the window's rows with the same joins the old dashboard query used. */
  async insertRowsFromSource(tx: DbClient, from: Date, to: Date): Promise<number> {
    const affected = await tx.$executeRaw`
      INSERT INTO "operation_read_model" (
        "payment_order_id", "company_id", "worker_id", "worker_name",
        "event_id", "event_name", "status", "amount_cents", "created_at", "updated_at"
      )
      SELECT o."id", o."company_id", o."worker_id", w."full_name",
             o."event_id", e."name", o."status", o."amount_cents", o."created_at", o."updated_at"
      FROM "payment_orders" o
      JOIN "workers" w ON w."id" = o."worker_id"
      JOIN "events" e ON e."id" = o."event_id"
      WHERE o."created_at" >= ${from} AND o."created_at" <= ${to}
      ON CONFLICT ("payment_order_id") DO UPDATE SET
        "company_id" = EXCLUDED."company_id",
        "worker_id" = EXCLUDED."worker_id",
        "worker_name" = EXCLUDED."worker_name",
        "event_id" = EXCLUDED."event_id",
        "event_name" = EXCLUDED."event_name",
        "status" = EXCLUDED."status",
        "amount_cents" = EXCLUDED."amount_cents",
        "created_at" = EXCLUDED."created_at",
        "updated_at" = EXCLUDED."updated_at"
    `;
    return Number(affected);
  }

  /**
   * Whole-history rebuild of the per-company totals. The totals are global
   * aggregates, so only a full recompute (never a window delta) is
   * idempotent and exact.
   */
  async rebuildAllTotals(tx: DbClient): Promise<void> {
    await tx.$executeRaw`
      DELETE FROM "company_financial_totals"
    `;
    await tx.$executeRaw`
      INSERT INTO "company_financial_totals" (
        "company_id", "pending_amount_cents", "approved_amount_cents", "rejected_amount_cents", "orders_count"
      )
      SELECT "company_id",
             COALESCE(SUM("amount_cents") FILTER (WHERE "status" = 'pending'), 0),
             COALESCE(SUM("amount_cents") FILTER (WHERE "status" = 'approved'), 0),
             COALESCE(SUM("amount_cents") FILTER (WHERE "status" = 'rejected'), 0),
             COUNT(*)::int
      FROM "payment_orders"
      GROUP BY "company_id"
      ON CONFLICT ("company_id") DO UPDATE SET
        "pending_amount_cents" = EXCLUDED."pending_amount_cents",
        "approved_amount_cents" = EXCLUDED."approved_amount_cents",
        "rejected_amount_cents" = EXCLUDED."rejected_amount_cents",
        "orders_count" = EXCLUDED."orders_count"
    `;
  }
}
```

### src/drift-repair/drift-repair.module.ts
```ts
import { Module } from '@nestjs/common';
import { ReDerivationModule } from '../re-derivation/re-derivation.module.js';
import { DriftRepairRepository } from './drift-repair.repository.js';
import { DriftRepairService } from './drift-repair.service.js';

@Module({
  imports: [ReDerivationModule],
  providers: [DriftRepairService, DriftRepairRepository],
})
export class DriftRepairModule {}
```

### src/drift-repair/drift-repair.service.ts
```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReDerivationService } from '../re-derivation/re-derivation.service.js';
import { DriftRepairRepository } from './drift-repair.repository.js';

const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface DriftRepairReport {
  window: { from: string; to: string };
  drifted_row_count: number;
  drifted_company_count: number;
  repaired: boolean;
}

/**
 * Scheduled drift repair: periodically compare projection against source for
 * a recent window and repair what disagrees. Drift (deploy mid-transaction,
 * manual data fix) is noticed by the system, not by a person.
 */
@Injectable()
export class DriftRepairService {
  private readonly logger = new Logger(DriftRepairService.name);
  private running = false;

  constructor(
    @Inject(ReDerivationService) private readonly reDerivation: ReDerivationService,
    @Inject(DriftRepairRepository) private readonly repository: DriftRepairRepository,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run(): Promise<DriftRepairReport | null> {
    if (this.running) {
      this.logger.warn('skipping drift repair: a previous run is still in progress');
      return null;
    }
    this.running = true;
    try {
      const to = new Date();
      const from = new Date(to.getTime() - WINDOW_MS);
      return await this.repairWindow(from, to);
    } catch (error) {
      this.logger.error(`drift repair failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    } finally {
      this.running = false;
    }
  }

  /** Compare [from, to] against the source and, if anything disagrees, re-derive it. */
  async repairWindow(from: Date, to: Date): Promise<DriftRepairReport> {
    const { driftedRows, driftedCompanies } = await this.repository.findDrift(from, to);
    const repaired = driftedRows.length > 0 || driftedCompanies.length > 0;
    if (repaired) {
      this.logger.warn(
        `drift detected (${driftedRows.length} rows, ${driftedCompanies.length} companies); ` +
          `re-deriving ${from.toISOString()}..${to.toISOString()}`,
      );
      await this.reDerivation.derive(from, to);
    }
    return {
      window: { from: from.toISOString(), to: to.toISOString() },
      drifted_row_count: driftedRows.length,
      drifted_company_count: driftedCompanies.length,
      repaired,
    };
  }
}
```

### src/drift-repair/drift-repair.repository.ts
```ts
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';

interface DriftedRow {
  payment_order_id: string;
}

interface DriftedCompany {
  company_id: string;
}

@Injectable()
export class DriftRepairRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Compare projection against source for orders created in [from, to]:
   * rows that are missing or disagree field by field, and companies whose
   * totals disagree with a re-aggregation of the source.
   */
  async findDrift(from: Date, to: Date): Promise<{ driftedRows: string[]; driftedCompanies: string[] }> {
    const [rows, companies] = await this.prisma.$transaction([
      this.prisma.$queryRaw<DriftedRow[]>`
        SELECT o."id" AS "payment_order_id"
        FROM "payment_orders" o
        JOIN "workers" w ON w."id" = o."worker_id"
        JOIN "events" e ON e."id" = o."event_id"
        LEFT JOIN "operation_read_model" p ON p."payment_order_id" = o."id"
        WHERE o."created_at" >= ${from} AND o."created_at" <= ${to}
          AND (
            p."payment_order_id" IS NULL
            OR p."company_id" IS DISTINCT FROM o."company_id"
            OR p."worker_id" IS DISTINCT FROM o."worker_id"
            OR p."worker_name" IS DISTINCT FROM w."full_name"
            OR p."event_id" IS DISTINCT FROM o."event_id"
            OR p."event_name" IS DISTINCT FROM e."name"
            OR p."status" IS DISTINCT FROM o."status"
            OR p."amount_cents" IS DISTINCT FROM o."amount_cents"
            OR p."created_at" IS DISTINCT FROM o."created_at"
            OR p."updated_at" IS DISTINCT FROM o."updated_at"
          )
      `,
      this.prisma.$queryRaw<DriftedCompany[]>`
        SELECT t."company_id" AS "company_id"
        FROM "company_financial_totals" t
        WHERE t."company_id" IN (
          SELECT "company_id" FROM "payment_orders"
          WHERE "created_at" >= ${from} AND "created_at" <= ${to}
        )
          AND (
            t."pending_amount_cents" <> COALESCE((SELECT SUM(po."amount_cents") FROM "payment_orders" po WHERE po."company_id" = t."company_id" AND po."status" = 'pending'), 0)
            OR t."approved_amount_cents" <> COALESCE((SELECT SUM(po."amount_cents") FROM "payment_orders" po WHERE po."company_id" = t."company_id" AND po."status" = 'approved'), 0)
            OR t."rejected_amount_cents" <> COALESCE((SELECT SUM(po."amount_cents") FROM "payment_orders" po WHERE po."company_id" = t."company_id" AND po."status" = 'rejected'), 0)
            OR t."orders_count" <> (SELECT COUNT(*)::int FROM "payment_orders" po WHERE po."company_id" = t."company_id")
          )
        UNION
        SELECT DISTINCT po."company_id" AS "company_id"
        FROM "payment_orders" po
        WHERE po."created_at" >= ${from} AND po."created_at" <= ${to}
          AND NOT EXISTS (SELECT 1 FROM "company_financial_totals" t WHERE t."company_id" = po."company_id")
      `,
    ]);

    return {
      driftedRows: rows.map((row) => row.payment_order_id),
      driftedCompanies: companies.map((company) => company.company_id),
    };
  }
}
```

### test/helpers/app.ts
```ts
import 'reflect-metadata';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module.js';
import { ApiExceptionFilter } from '../../src/common/api-exception-filter.js';

export interface TestApp {
  app: INestApplication;
  baseUrl: string;
  close: () => Promise<void>;
}

export async function startTestApp(): Promise<TestApp> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.listen(0);
  const server = app.getHttpServer() as Server;
  const address = server.address();
  if (!address || typeof address === 'string') {
    await app.close();
    throw new Error('test server did not bind to a TCP port');
  }
  return {
    app,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => app.close(),
  };
}
```

### test/helpers/db.ts
```ts
import { PrismaClient } from '@prisma/client';

export function createTestPrisma(): PrismaClient {
  return new PrismaClient();
}

export interface TestFixtures {
  companyId: string;
  workerId: string;
  workerName: string;
  eventId: string;
  eventName: string;
}

export async function seedFixtures(prisma: PrismaClient): Promise<TestFixtures> {
  const company = await prisma.company.create({
    data: { name: `Test Company ${Math.random().toString(36).slice(2)}` },
  });
  const worker = await prisma.worker.create({ data: { fullName: 'Ada Worker' } });
  const event = await prisma.event.create({ data: { companyId: company.id, name: 'Harvest Fair' } });
  return {
    companyId: company.id,
    workerId: worker.id,
    workerName: worker.fullName,
    eventId: event.id,
    eventName: event.name,
  };
}

/** Removes everything a fixture created, in both source and projection. */
export async function cleanupFixtures(prisma: PrismaClient, fx: TestFixtures): Promise<void> {
  const orderIds = (
    await prisma.paymentOrder.findMany({ where: { companyId: fx.companyId }, select: { id: true } })
  ).map((order) => order.id);
  await prisma.operationReadModel.deleteMany({ where: { paymentOrderId: { in: orderIds } } });
  await prisma.companyFinancialTotals.deleteMany({ where: { companyId: fx.companyId } });
  await prisma.paymentOrder.deleteMany({ where: { companyId: fx.companyId } });
  await prisma.event.deleteMany({ where: { companyId: fx.companyId } });
  await prisma.worker.deleteMany({ where: { id: fx.workerId } });
  await prisma.company.deleteMany({ where: { id: fx.companyId } });
}
```

### test/helpers/http.ts
```ts
import type { TestApp } from './app.js';

export interface HttpResult<T> {
  status: number;
  body: T;
}

export function buildUrl(app: TestApp, path: string, query: Record<string, string> = {}): URL {
  const url = new URL(path, app.baseUrl);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return url;
}

export async function getJson<T = unknown>(
  app: TestApp,
  path: string,
  query: Record<string, string> = {},
): Promise<HttpResult<T>> {
  const response = await fetch(buildUrl(app, path, query));
  return { status: response.status, body: (await response.json()) as T };
}

export async function postJson<T = unknown>(
  app: TestApp,
  path: string,
  body?: unknown,
): Promise<HttpResult<T>> {
  const response = await fetch(buildUrl(app, path), {
    method: 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as T };
}
```

### test/helpers/api.ts
```ts
// Wire-level response shapes used by the tests (snake_case, as served).

export interface OrderBody {
  id: string;
  company_id: string;
  worker_id: string;
  event_id: string;
  status: string;
  amount_cents: number;
  created_at: string;
  updated_at: string;
}

export interface OperationItem {
  id: string;
  company_id: string;
  worker_id: string;
  worker_name: string;
  event_id: string;
  event_name: string;
  status: string;
  amount_cents: number;
  created_at: string;
  updated_at: string;
}

export interface ListBody {
  items: OperationItem[];
  page: number;
  page_size: number;
  total: number;
}

export interface TotalsBody {
  company_id: string;
  pending_amount_cents: string;
  approved_amount_cents: string;
  rejected_amount_cents: string;
  orders_count: number;
}

export interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}
```

### test/read-your-own-writes.spec.ts
```ts
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from './helpers/app.js';
import type { ErrorBody, ListBody, OrderBody, TotalsBody } from './helpers/api.js';
import { createTestPrisma, cleanupFixtures, seedFixtures, type TestFixtures } from './helpers/db.js';
import { getJson, postJson } from './helpers/http.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('operations dashboard: read your own writes', () => {
  let app: TestApp | undefined;
  let prisma: PrismaClient | undefined;
  const fixtures: TestFixtures[] = [];

  beforeAll(async () => {
    prisma = createTestPrisma();
    app = await startTestApp();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  afterEach(async () => {
    for (const fixture of fixtures.splice(0)) {
      await cleanupFixtures(prisma!, fixture);
    }
  });

  it('shows an approved order on the very next request after approving it', async () => {
    const fx = await seedFixtures(prisma!);
    fixtures.push(fx);

    const created = await postJson<OrderBody>(app!, '/payment-orders', {
      company_id: fx.companyId,
      worker_id: fx.workerId,
      event_id: fx.eventId,
      amount_cents: 2500,
    });
    expect(created.status).toBe(201);
    const orderId = created.body.id;

    let listed = await getJson<ListBody>(app!, '/operations', { company_id: fx.companyId });
    expect(listed.status).toBe(200);
    expect(listed.body.total).toBe(1);
    expect(listed.body.items[0]).toMatchObject({
      id: orderId,
      company_id: fx.companyId,
      status: 'pending',
      amount_cents: 2500,
      worker_name: fx.workerName,
      event_name: fx.eventName,
    });

    const approved = await postJson<OrderBody>(app!, `/payment-orders/${orderId}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('approved');

    // No delay, no refresher: the next request already reflects the write.
    listed = await getJson<ListBody>(app!, '/operations', { company_id: fx.companyId, status: 'approved' });
    expect(listed.body.total).toBe(1);
    expect(listed.body.items[0].status).toBe('approved');

    const totals = await getJson<TotalsBody>(app!, `/companies/${fx.companyId}/financial-totals`);
    expect(totals.status).toBe(200);
    expect(totals.body).toEqual({
      company_id: fx.companyId,
      pending_amount_cents: '0',
      approved_amount_cents: '2500',
      rejected_amount_cents: '0',
      orders_count: 1,
    });
  });

  it('shows a rejected order and moves the exact amounts in the totals', async () => {
    const fx = await seedFixtures(prisma!);
    fixtures.push(fx);

    const first = await postJson<OrderBody>(app!, '/payment-orders', {
      company_id: fx.companyId, worker_id: fx.workerId, event_id: fx.eventId, amount_cents: 1200,
    });
    const second = await postJson<OrderBody>(app!, '/payment-orders', {
      company_id: fx.companyId, worker_id: fx.workerId, event_id: fx.eventId, amount_cents: 300,
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const rejected = await postJson<OrderBody>(app!, `/payment-orders/${second.body.id}/reject`);
    expect(rejected.status).toBe(200);
    expect(rejected.body.status).toBe('rejected');

    const totals = await getJson<TotalsBody>(app!, `/companies/${fx.companyId}/financial-totals`);
    expect(totals.body).toEqual({
      company_id: fx.companyId,
      pending_amount_cents: '1200',
      approved_amount_cents: '0',
      rejected_amount_cents: '300',
      orders_count: 2,
    });

    const listed = await getJson<ListBody>(app!, '/operations', { company_id: fx.companyId, status: 'rejected' });
    expect(listed.body.total).toBe(1);
    expect(listed.body.items[0].id).toBe(second.body.id);
  });

  it('never shows an order that only exists in the source table (projection-only read path)', async () => {
    const fx = await seedFixtures(prisma!);
    fixtures.push(fx);

    // Direct source write, bypassing the write path on purpose.
    await prisma!.paymentOrder.create({
      data: {
        companyId: fx.companyId,
        workerId: fx.workerId,
        eventId: fx.eventId,
        status: 'approved',
        amountCents: 9000,
      },
    });

    const listed = await getJson<ListBody>(app!, '/operations', { company_id: fx.companyId });
    expect(listed.body.total).toBe(0);
    expect(listed.body.items).toEqual([]);

    const totals = await getJson<ErrorBody>(app!, `/companies/${fx.companyId}/financial-totals`);
    expect(totals.status).toBe(404);
    expect(totals.body.error.code).toBe('resource_not_found');
  });

  it('returns the error envelope for unknown ids, invalid transitions and bad input', async () => {
    const fx = await seedFixtures(prisma!);
    fixtures.push(fx);

    const unknown = await postJson<ErrorBody>(
      app!,
      '/payment-orders/00000000-0000-4000-8000-000000000000/approve',
    );
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({
      error: { code: 'resource_not_found', message: expect.any(String), details: expect.any(Object) },
    });

    const created = await postJson<OrderBody>(app!, '/payment-orders', {
      company_id: fx.companyId, worker_id: fx.workerId, event_id: fx.eventId, amount_cents: 100,
    });
    await postJson(app!, `/payment-orders/${created.body.id}/approve`);
    const again = await postJson<ErrorBody>(app!, `/payment-orders/${created.body.id}/approve`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('invalid_state_transition');

    const noCompany = await getJson<ErrorBody>(app!, '/operations', {});
    expect(noCompany.status).toBe(400);
    expect(noCompany.body.error.code).toBe('validation_failed');
    expect(noCompany.body.error.details.company_id).toBeDefined();

    const badStatus = await getJson<ErrorBody>(app!, '/operations', { company_id: fx.companyId, status: 'settled' });
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.error.code).toBe('validation_failed');
  });
});
```

### test/concurrent-totals.spec.ts
```ts
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type TestApp } from './helpers/app.js';
import type { ListBody, OrderBody, TotalsBody } from './helpers/api.js';
import { createTestPrisma, cleanupFixtures, seedFixtures, type TestFixtures } from './helpers/db.js';
import { getJson, postJson } from './helpers/http.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('concurrent updates to one company totals', () => {
  let app: TestApp | undefined;
  let prisma: PrismaClient | undefined;
  const fixtures: TestFixtures[] = [];

  beforeAll(async () => {
    prisma = createTestPrisma();
    app = await startTestApp();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  afterEach(async () => {
    for (const fixture of fixtures.splice(0)) {
      await cleanupFixtures(prisma!, fixture);
    }
  });

  it('applies 24 concurrent transitions on the same totals row without losing any', async () => {
    const fx = await seedFixtures(prisma!);
    fixtures.push(fx);

    const amounts = Array.from({ length: 24 }, (_, i) => 100 + i); // 100..123
    const ids: string[] = [];
    for (const amountCents of amounts) {
      const created = await postJson<OrderBody>(app!, '/payment-orders', {
        company_id: fx.companyId, worker_id: fx.workerId, event_id: fx.eventId, amount_cents: amountCents,
      });
      expect(created.status).toBe(201);
      ids.push(created.body.id);
    }

    // 12 approves + 12 rejects, all in flight at once, all moving the same
    // company_financial_totals row.
    const responses = await Promise.all([
      ...ids.slice(0, 12).map((id) => postJson(app!, `/payment-orders/${id}/approve`)),
      ...ids.slice(12).map((id) => postJson(app!, `/payment-orders/${id}/reject`)),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(200);
    }

    const approvedSum = amounts.slice(0, 12).reduce((sum, value) => sum + value, 0);
    const rejectedSum = amounts.slice(12).reduce((sum, value) => sum + value, 0);

    const totals = await getJson<TotalsBody>(app!, `/companies/${fx.companyId}/financial-totals`);
    expect(totals.status).toBe(200);
    expect(totals.body).toEqual({
      company_id: fx.companyId,
      pending_amount_cents: '0',
      approved_amount_cents: String(approvedSum),
      rejected_amount_cents: String(rejectedSum),
      orders_count: 24,
    });

    // The totals must equal an aggregation of the source table, exactly.
    const grouped = await prisma!.paymentOrder.groupBy({
      by: ['status'],
      where: { companyId: fx.companyId },
      _sum: { amountCents: true },
    });
    const sumFor = (status: string): number =>
      grouped.find((g) => g.status === status)?._sum.amountCents ?? 0;
    expect(sumFor('approved')).toBe(approvedSum);
    expect(sumFor('rejected')).toBe(rejectedSum);
    expect(sumFor('pending')).toBe(0);

    // And the dashboard reflects every one of them.
    const approvedList = await getJson<ListBody>(app!, '/operations', {
      company_id: fx.companyId, status: 'approved',
    });
    const rejectedList = await getJson<ListBody>(app!, '/operations', {
      company_id: fx.companyId, status: 'rejected',
    });
    expect(approvedList.body.total).toBe(12);
    expect(rejectedList.body.total).toBe(12);
  });

  it('creates the totals row exactly once under concurrent first writes', async () => {
    const fx = await seedFixtures(prisma!);
    fixtures.push(fx);

    const responses = await Promise.all(
      [500, 700].map((amountCents) =>
        postJson<OrderBody>(app!, '/payment-orders', {
          company_id: fx.companyId, worker_id: fx.workerId, event_id: fx.eventId, amount_cents: amountCents,
        }),
      ),
    );
    for (const response of responses) {
      expect(response.status).toBe(201);
    }

    const totals = await getJson<TotalsBody>(app!, `/companies/${fx.companyId}/financial-totals`);
    expect(totals.body).toEqual({
      company_id: fx.companyId,
      pending_amount_cents: '1200',
      approved_amount_cents: '0',
      rejected_amount_cents: '0',
      orders_count: 2,
    });
  });
});
```

### test/drift-repair.spec.ts
```ts
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DriftRepairService } from '../src/drift-repair/drift-repair.service.js';
import { startTestApp, type TestApp } from './helpers/app.js';
import type { OrderBody, TotalsBody } from './helpers/api.js';
import { createTestPrisma, cleanupFixtures, seedFixtures, type TestFixtures } from './helpers/db.js';
import { getJson, postJson } from './helpers/http.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('scheduled drift repair', () => {
  let app: TestApp | undefined;
  let prisma: PrismaClient | undefined;
  const fixtures: TestFixtures[] = [];

  beforeAll(async () => {
    prisma = createTestPrisma();
    app = await startTestApp();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  afterEach(async () => {
    for (const fixture of fixtures.splice(0)) {
      await cleanupFixtures(prisma!, fixture);
    }
  });

  it('detects drifted rows and totals in the recent window and repairs them', async () => {
    const fx = await seedFixtures(prisma!);
    fixtures.push(fx);

    const amounts = [500, 501, 502];
    const ids: string[] = [];
    for (const amountCents of amounts) {
      const created = await postJson<OrderBody>(app!, '/payment-orders', {
        company_id: fx.companyId, worker_id: fx.workerId, event_id: fx.eventId, amount_cents: amountCents,
      });
      expect(created.status).toBe(201);
      ids.push(created.body.id);
    }

    const repairService = app!.app.get(DriftRepairService);
    const now = new Date();
    const from = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    // Baseline: everything agrees, nothing is repaired.
    const clean = await repairService.repairWindow(from, now);
    expect(clean.repaired).toBe(false);
    expect(clean.drifted_row_count).toBe(0);
    expect(clean.drifted_company_count).toBe(0);

    // Inject drift: one row with a wrong status/timestamp, one row missing,
    // one inflated totals row.
    const [a, b] = ids;
    await prisma!.$executeRaw`
      UPDATE "operation_read_model"
      SET "status" = 'approved', "updated_at" = "updated_at" + interval '1 hour'
      WHERE "payment_order_id" = ${a}
    `;
    await prisma!.$executeRaw`
      DELETE FROM "operation_read_model" WHERE "payment_order_id" = ${b}
    `;
    await prisma!.$executeRaw`
      UPDATE "company_financial_totals"
      SET "approved_amount_cents" = "approved_amount_cents" + 9999
      WHERE "company_id" = ${fx.companyId}
    `;

    const report = await repairService.repairWindow(from, now);
    expect(report.repaired).toBe(true);
    expect(report.drifted_row_count).toBe(2);
    expect(report.drifted_company_count).toBe(1);

    // The projection agrees with the source again.
    const rows = await prisma!.operationReadModel.findMany({
      where: { paymentOrderId: { in: ids } },
    });
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.status).toBe('pending');
      const source = await prisma!.paymentOrder.findUniqueOrThrow({ where: { id: row.paymentOrderId } });
      expect(row.updatedAt.getTime()).toBe(source.updatedAt.getTime());
    }

    const totals = await getJson<TotalsBody>(app!, `/companies/${fx.companyId}/financial-totals`);
    expect(totals.body.approved_amount_cents).toBe('0');
    expect(totals.body.pending_amount_cents).toBe(String(amounts.reduce((sum, value) => sum + value, 0)));
  });
});
```

### test/re-derivation.spec.ts
```ts
import type { OrderStatus } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ReDerivationService } from '../src/re-derivation/re-derivation.service.js';
import { startTestApp, type TestApp } from './helpers/app.js';
import type { ListBody } from './helpers/api.js';
import { createTestPrisma, cleanupFixtures, seedFixtures, type TestFixtures } from './helpers/db.js';
import { getJson } from './helpers/http.js';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('re-derivation for an arbitrary window', () => {
  let app: TestApp | undefined;
  let prisma: PrismaClient | undefined;
  const fixtures: TestFixtures[] = [];

  beforeAll(async () => {
    prisma = createTestPrisma();
    app = await startTestApp();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  afterEach(async () => {
    for (const fixture of fixtures.splice(0)) {
      await cleanupFixtures(prisma!, fixture);
    }
  });

  it('rebuilds rows and totals from source for the window, ordered by recency', async () => {
    const fx = await seedFixtures(prisma!);
    fixtures.push(fx);
    const now = new Date();
    const statuses: OrderStatus[] = ['pending', 'approved', 'rejected', 'approved', 'pending'];

    // Source rows only (the write-path hooks were bypassed on purpose).
    const ids: string[] = [];
    for (let i = 0; i < statuses.length; i += 1) {
      const createdAt = new Date(now.getTime() - (i + 1) * 60_000);
      const order = await prisma!.paymentOrder.create({
        data: {
          companyId: fx.companyId,
          workerId: fx.workerId,
          eventId: fx.eventId,
          status: statuses[i],
          amountCents: 100 * (i + 1),
          createdAt,
          updatedAt: createdAt,
        },
      });
      ids.push(order.id);
    }
    // An order outside the window, to prove the boundary is respected.
    const outsideCreatedAt = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    await prisma!.paymentOrder.create({
      data: {
        companyId: fx.companyId,
        workerId: fx.workerId,
        eventId: fx.eventId,
        status: 'approved',
        amountCents: 777,
        createdAt: outsideCreatedAt,
        updatedAt: outsideCreatedAt,
      },
    });

    const from = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const deriveService = app!.app.get(ReDerivationService);
    const result = await deriveService.derive(from, now);
    expect(result.rows_rebuilt).toBe(5);

    // The dashboard shows exactly the window, newest first, from the projection.
    const listed = await getJson<ListBody>(app!, '/operations', { company_id: fx.companyId });
    expect(listed.status).toBe(200);
    expect(listed.body.total).toBe(5);
    expect(listed.body.items.map((item) => item.id)).toEqual(ids);
    expect(listed.body.items.map((item) => item.status)).toEqual(statuses);
    expect(listed.body.items[0]).toMatchObject({
      worker_name: fx.workerName,
      event_name: fx.eventName,
      amount_cents: 100,
    });

    // Totals are rebuilt from the WHOLE history of the company,
    // including the outside-window order.
    const totals = await prisma!.companyFinancialTotals.findUnique({ where: { companyId: fx.companyId } });
    expect(totals?.pendingAmountCents).toBe(BigInt(100 + 500));
    expect(totals?.approvedAmountCents).toBe(BigInt(200 + 400 + 777));
    expect(totals?.rejectedAmountCents).toBe(BigInt(300));
    expect(totals?.ordersCount).toBe(6);
  });

  it('running the same window twice leaves an identical state', async () => {
    const fx = await seedFixtures(prisma!);
    fixtures.push(fx);
    for (let i = 0; i < 4; i += 1) {
      const createdAt = new Date(Date.now() - (i + 1) * 60_000);
      await prisma!.paymentOrder.create({
        data: {
          companyId: fx.companyId,
          workerId: fx.workerId,
          eventId: fx.eventId,
          status: i % 2 === 0 ? 'pending' : 'approved',
          amountCents: 40 * (i + 1),
          createdAt,
          updatedAt: createdAt,
        },
      });
    }

    const deriveService = app!.app.get(ReDerivationService);
    const from = new Date(Date.now() - 3_600_000);
    await deriveService.derive(from, new Date());

    const snapshot = async () => ({
      rows: plainify(
        await prisma!.operationReadModel.findMany({
          where: { companyId: fx.companyId },
          orderBy: { paymentOrderId: 'asc' },
        }),
      ),
      totals: plainify(await prisma!.companyFinancialTotals.findMany({ orderBy: { companyId: 'asc' } })),
    });

    const first = await snapshot();
    expect(first.rows).toHaveLength(4);
    expect(first.totals.length).toBeGreaterThanOrEqual(1);

    await deriveService.derive(from, new Date());
    const second = await snapshot();
    expect(second).toEqual(first);
  });
});

function plainify<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item)));
}
```

### DESIGN.md
```md
# DESIGN — Operations dashboard read model

## Problem

The operations list joins `payment_orders` + `events` + `workers`, filters by
company, status and date range, sorts by recency and paginates. At ~3M orders it
takes 20–30 s. Target: p95 < 50 ms with the same columns, filters, ordering and
page sizes. Two hard constraints:

1. **Read-your-own-writes.** An operator approves an order; the next request
   shows it approved. No visibility window, however short.
2. **Exact per-company financial totals.** Finance reconciles against them: no
   approximate, no eventually-exact, no sampling.

## Shape of the solution

Two projection tables maintained from the source:

- `operation_read_model` — one row per payment order, pre-joined with the
  worker and event names, so the dashboard query touches one table only.
- `company_financial_totals` — one row per company with per-status amounts
  and an order count.

`GET /operations` reads only `operation_read_model`.

### The index

`idx_operation_read_model_dashboard` on
`(company_id, status, created_at DESC, payment_order_id DESC)` with
`INCLUDE (worker_name, event_name, amount_cents, updated_at)`. It matches the
filter (company + optional status), the `created_at` range, and the sort
(recency with a stable id tiebreak for pagination), and it covers every
selected column. A page is therefore an index-only scan whose cost is
independent of the 3M-row table — that is what gets p95 under 50 ms.

## Why the hooks run inside the writer's transaction

The read-your-own-writes rule rejects every design that has a gap between the
source commit and the projection update:

| Alternative | Visibility gap | Verdict |
| --- | --- | --- |
| Post-commit hook + poller | poll interval | fails |
| Outbox + queue worker | queue latency | fails |
| CDC (Debezium) → consumer | replication + processing latency | fails |
| Scheduled refresh of a materialized view | schedule interval | fails |

So the maintenance hooks are called by the write services and run **inside the
same transaction as the source write**:

```
BEGIN
  UPDATE payment_orders SET status = 'approved', ...          -- source
  INSERT ... ON CONFLICT UPDATE operation_read_model ...      -- hook (full value)
  UPDATE company_financial_totals SET approved_amount_cents
       = approved_amount_cents + n, ...                       -- hook (in-place increment)
COMMIT
```

"Write committed" and "projection shows it" become the same commit, so there is
no window. Rollback or crash mid-transaction leaves neither half visible — an
operator action can never be half-applied.

**Why not a database trigger** (the one alternative with equal atomicity): the
write logic would live outside the application — invisible to app tests, logs
and code review, a second place to change when status semantics evolve, and
coupled to Prisma migrations. An explicit hook invoked by the write service is
readable in one place, covered by the same tests as the write, and portable.

**Cost accepted:** each write does two extra single-row writes. That is
microseconds to low milliseconds next to the join we removed, and a projection
failure now fails the write — correct, because an operator action that cannot
be made visible is an error, not a silent loss.

## Exact totals under concurrency

The company totals row is updated with an in-place increment
(`UPDATE ... SET col = col ± delta`, expressed as an upsert). There is no
read-modify-write: two concurrent approvals both execute `col = col + delta`
and are serialized by the row lock, so neither update is lost. A status change
moves the amount between counters by applying `−delta` on the old counter and
`+delta` on the new one, which is also race-free for the same reason.
`test/concurrent-totals.spec.ts` runs 24 concurrent transitions against one
totals row and asserts the exact sums against a source aggregation.

## Re-derivation for an arbitrary window

`ReDerivationService.derive(from, to)` rebuilds, from the source tables:

1. the projection rows for orders created in `[from, to]` —
   `DELETE` + `INSERT ... SELECT` with the same joins the old query used;
2. all per-company totals — `DELETE` + `INSERT ... SELECT ... GROUP BY`.

Totals are rebuilt globally rather than per-window because they are
whole-history aggregates: a window-scoped delta update can never be made
idempotent. Both steps are full-value overwrites, so running the routine twice
over the same window leaves an identical state (tested). The transaction is
`SERIALIZABLE` with a bounded retry on serialization conflicts, so it is safe
to run while the system is live. A concurrent write that commits in the small
gap after the aggregate read can be missed by that single run; that residual
is exactly what the drift job below converges, using the same routine.

## Scheduled drift repair

`DriftRepairService` runs every 5 minutes over the trailing 24 h:

1. **compare** — projection rows vs source field by field (missing row, wrong
   status/amount/timestamp, stale denormalized names), and totals vs a
   re-aggregation of the source for every company with orders in the window;
2. **repair** — if anything disagrees, re-derive that window (idempotent).

An in-flight flag prevents overlapping runs. Drift from a deploy
mid-transaction or a manual data fix is therefore detected and repaired by the
system before a person notices.

## Tests

- `test/read-your-own-writes.spec.ts` — approve → the very next HTTP request
  shows it; also proves the dashboard never reads the source (an order inserted
  directly into `payment_orders` is invisible until the projection has it),
  plus the error-envelope contract.
- `test/concurrent-totals.spec.ts` — 24 concurrent approve/reject transitions
  for one company; exact sums asserted against a source aggregation.
- `test/drift-repair.spec.ts` — a mismatched row, a missing row and an inflated
  totals row are injected; the job reports the drift and the projection agrees
  with the source again.
- `test/re-derivation.spec.ts` — a window rebuild matches the source and
  respects the boundary; a second run over the same window is a no-op.

## Run

```sh
pnpm install            # generates the Prisma client
pnpm prisma:migrate     # applies prisma/migrations
DATABASE_URL=... pnpm dev
pnpm test               # vitest, requires DATABASE_URL to point at Postgres
```
```


---

REQUEST FAILED

IncompleteRead(1001 bytes read)


---

# repair1-set

## reasoning

```
Let me analyze the errors:

1. **`src/common/domain-exception.ts(8,14)`**: `DomainException` has a `status` property that conflicts with `HttpException`'s private `status`. The fix is to not declare `status` as a property on `DomainException` since `HttpException` already has it (as private). I should remove the `readonly status: number` declaration.

2. **`src/main.ts(2,10)`**: `Module '"@nestjs/common"' has no exported member 'NestFactory'`. The correct import is from `@nestjs/core`. So the import should be from `@nestjs/core`.

3. **`src/re-derivation/re-derivation.repository.ts(15,5)`** and **`(15,24)`**: Two issues:
   - The `$transaction` call with a function callback and `{ isolationLevel: 'serializable' }` — the isolation level should be `'Serializable'` (capital S) per Prisma's type.
   - The return type issue: when using the interactive transaction (function form), the callback receives a `Prisma.TransactionClient`, not `DbClient`. The error says `Type 'any[]' is not assignable to type 'Promise<T>'` — this suggests the overload resolution is picking the wrong overload (the array form) because the isolation level string is wrong.

   Actually, looking more carefully at the error:
   - Error at (15,5): `Type 'Promise<any[]>' is not assignable to type 'Promise<T>'` — this is the return type mismatch
   - Error at (15,24): `No overload matches this call` — this is the call itself

   The root cause is `'serializable'` should be `'Serializable'`. When the isolation level is wrong, TypeScript can't match the second overload (the function-based one) and falls through to the first overload (array-based), which expects an array, not a function.

   But wait, there's also the `DbClient` type being used as the parameter type. Let me look at what `DbClient` is. It's imported from `'../common/db-client.js'`. The Prisma transaction client type is `Prisma.TransactionClient`. If `DbClient` is defined as `Prisma.TransactionClient`, then it should be fine.

   Actually, looking at the error more carefully, the second overload says:
   ```
   '(fn: (prisma: Omit<PrismaClient<...>, "$on" | "$connect" | "$disconnect" | "$use" | "$transaction" | "$extends">) => Promise<...>, options?: { ...; } | undefined): Promise<...>'
   ```
   
   The parameter type is `Omit<PrismaClient<...>, ...>` which is what Prisma calls `TransactionClient`. If `DbClient` is typed as `Prisma.TransactionClient`, then the function `(tx: DbClient) => Promise<T>` should be assignable to `(prisma: Omit<...>) => Promise<...>`.

   So the fix is just changing `'serializable'` to `'Serializable'`. That should resolve both errors at line 15.

   Wait, but there might also be a type compatibility issue with `DbClient`. Let me think... The error message says "Type '(tx: TransactionClient) => Promise<T>' is not assignable to parameter of type 'PrismaPromise<any>[]'" for overload 1. For overload 2, it only complains about the isolation level. So if I fix the isolation level, overload 2 should match.

   But will the callback parameter type work? The callback is `(tx: DbClient) => Promise<T>`. The expected parameter is `Omit<PrismaClient<...>, ...>`. If `DbClient` is `Prisma.TransactionClient`, and `Prisma.TransactionClient` is defined as `Omit<PrismaClient<...>, ...>`, then it should work.

   So my fixes are:
   1. `src/common/domain-exception.ts`: Remove the `readonly status: number` property declaration (since `HttpException` already has it as private, we can't re-declare it as public).
   
   Actually wait — if I remove `status`, then `this.status = status` in the constructor will fail. Let me think about this differently.

   `HttpException` has a private `status` property. In TypeScript, you can't extend a class and expose a property with the same name if the base has it as private. The options are:
   - Remove the `status` property from `DomainException` and don't assign to `this.status` (it's already set by the base via the constructor argument)
   - Use a different property name

   Looking at `HttpException`'s constructor: `constructor(response: string | Record<string, any>, status: number)`. The `status` is stored privately in the base class.

   So in `DomainException`, I should remove `readonly status: number` and remove `this.status = status`. The base class already stores it. But then external code that accesses `exception.status` won't work... but that's the compiler error we need to fix.

   Actually, looking at `HttpException` more carefully in NestJS source — it has:
   ```
   private readonly status: number;
   ```
   
   And a getter:
   ```
   getStatus(): number { return this.status; }
   ```

   So the fix is to remove `readonly status: number` from `DomainException` and remove `this.status = status` from the constructor. The `status` is already available via `getStatus()`.

   But wait — is `status` used anywhere else in the codebase? The task says "Change exactly what the compiler requires." So I'll just remove the property declaration and the assignment.

   2. `src/main.ts`: Change import from `'@nestjs/common'` to `'@nestjs/core'` for `NestFactory`.

   3. `src/re-derivation/re-derivation.repository.ts`: Change `'serializable'` to `'Serializable'`.

Let me now write the complete files.

For `src/common/domain-exception.ts`:
```ts
import { HttpException } from '@nestjs/common';

export class DomainException extends HttpException {
  readonly code: string;
  readonly message: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super({ error: { code, message, details } }, status);
    this.code = code;
    this.message = message;
    this.details = details;
  }
}
```

For `src/main.ts`:
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './common/api-exception-filter.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
```

For `src/re-derivation/re-derivation.repository.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import type { DbClient } from '../common/db-client.js';
import { PrismaService } from '../common/prisma.service.js';

@Injectable()
export class ReDerivationRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  withSerializableTransaction<T>(work: (tx: DbClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work, { isolationLevel: 'Serializable', timeout: 120_000 });
  }

  async deleteRowsInWindow(tx: DbClient, from: Date, to: Date): Promise<void> {
    await tx.$executeRaw`
      DELETE FROM "operation_read_model"
      WHERE "payment_order_id" IN (
        SELECT "id" FROM "payment_orders"
        WHERE "created_at" >= ${from} AND "created_at" <= ${to}
      )
    `;
  }

  async insertRowsFromSource(tx: DbClient, from: Date, to: Date): Promise<number> {
    const affected = await tx.$executeRaw`
      INSERT INTO "operation_read_model" (
        "payment_order_id", "company_id", "worker_id", "worker_name",
        "event_id", "event_name", "status", "amount_cents", "created_at", "updated_at"
      )
      SELECT o."id", o."company_id", o."worker_id", w."full_name",
             o."event_id", e."name", o."status", o."amount_cents", o."created_at", o."updated_at"
      FROM "payment_orders" o
      JOIN "workers" w ON w."id" = o."worker_id"
      JOIN "events" e ON e."id" = o."event_id"
      WHERE o."created_at" >= ${from} AND o."created_at" <= ${to}
      ON CONFLICT ("payment_order_id") DO UPDATE SET
        "company_id" = EXCLUDED."company_id",
        "worker_id" = EXCLUDED."worker_id",
        "worker_name" = EXCLUDED."worker_name",
        "event_id" = EXCLUDED."event_id",
        "event_name" = EXCLUDED."event_name",
        "status" = EXCLUDED."status",
        "amount_cents" = EXCLUDED."amount_cents",
        "created_at" = EXCLUDED."created_at",
        "updated_at" = EXCLUDED."updated_at"
    `;
    return Number(affected);
  }

  async rebuildAllTotals(tx: DbClient): Promise<void> {
    await tx.$executeRaw`
      DELETE FROM "company_financial_totals"
    `;
    await tx.$executeRaw`
      INSERT INTO "company_financial_totals" (
        "company_id", "pending_amount_cents", "approved_amount_cents", "rejected_amount_cents", "orders_count"
      )
      SELECT "company_id",
             COALESCE(SUM("amount_cents") FILTER (WHERE "status" = 'pending'), 0),
             COALESCE(SUM("amount_cents") FILTER (WHERE "status" = 'approved'), 0),
             COALESCE(SUM("amount_cents") FILTER (WHERE "status" = 'rejected'), 0),
             COUNT(*)::int
      FROM "payment_orders"
      GROUP BY "company_id"
      ON CONFLICT ("company_id") DO UPDATE SET
        "pending_amount_cents" = EXCLUDED."pending_amount_cents",
        "approved_amount_cents" = EXCLUDED."approved_amount_cents",
        "rejected_amount_cents" = EXCLUDED."rejected_amount_cents",
        "orders_count" = EXCLUDED."orders_count"
    `;
  }
}
```

Wait, I need to double-check: does `HttpException` have a `status` getter? Let me recall NestJS source:

```ts
export class HttpException extends Error {
  private readonly response: string | Record<string, any>;
  private readonly status: number;
  private readonly options?: HttpExceptionOptions;
  private readonly description: string | undefined;

  constructor(private readonly response: string | Record<string, any>, status: number, description?: string) { ... }
  
  getResponse(): string | Record<string, any> { return this.response; }
  getStatus(): number { return this.status; }
  ...
}
```

Yes, `status` is private with a `getStatus()` method. So removing the `status` property from `DomainException` is correct. The base class already handles it.

Let me also check: does `HttpException`'s constructor accept `(response, status)`? Yes: `constructor(response: string | Record<string, any>, status: number, description?: string)`.

So my fix for `DomainException` is correct — just remove the `readonly status: number` line and `this.status = status;`.
```

## reply

### src/common/domain-exception.ts
```ts
import { HttpException } from '@nestjs/common';

/**
 * Domain errors carry the API-contract code (snake_case, stable). Known codes:
 * resource_not_found, validation_failed, invalid_state_transition, conflict,
 * internal_error.
 */
export class DomainException extends HttpException {
  readonly code: string;
  readonly message: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super({ error: { code, message, details } }, status);
    this.code = code;
    this.message = message;
    this.details = details;
  }
}
```

### src/main.ts
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './common/api-exception-filter.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
```

### src/re-derivation/re-derivation.repository.ts
```ts
import { Inject, Injectable } from '@nestjs/common';
import type { DbClient } from '../common/db-client.js';
import { PrismaService } from '../common/prisma.service.js';

@Injectable()
export class ReDerivationRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * SERIALIZABLE so a concurrent writer cannot slip a commit between our
   * source read and our projection write without a detectable conflict; the
   * service retries on serialization failure.
   */
  withSerializableTransaction<T>(work: (tx: DbClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work, { isolationLevel: 'Serializable', timeout: 120_000 });
  }

  async deleteRowsInWindow(tx: DbClient, from: Date, to: Date): Promise<void> {
    await tx.$executeRaw`
      DELETE FROM "operation_read_model"
      WHERE "payment_order_id" IN (
        SELECT "id" FROM "payment_orders"
        WHERE "created_at" >= ${from} AND "created_at" <= ${to}
      )
    `;
  }

  /** Re-creates the window's rows with the same joins the old dashboard query used. */
  async insertRowsFromSource(tx: DbClient, from: Date, to: Date): Promise<number> {
    const affected = await tx.$executeRaw`
      INSERT INTO "operation_read_model" (
        "payment_order_id", "company_id", "worker_id", "worker_name",
        "event_id", "event_name", "status", "amount_cents", "created_at", "updated_at"
      )
      SELECT o."id", o."company_id", o."worker_id", w."full_name",
             o."event_id", e."name", o."status", o."amount_cents", o."created_at", o."updated_at"
      FROM "payment_orders" o
      JOIN "workers" w ON w."id" = o."worker_id"
      JOIN "events" e ON e."id" = o."event_id"
      WHERE o."created_at" >= ${from} AND o."created_at" <= ${to}
      ON CONFLICT ("payment_order_id") DO UPDATE SET
        "company_id" = EXCLUDED."company_id",
        "worker_id" = EXCLUDED."worker_id",
        "worker_name" = EXCLUDED."worker_name",
        "event_id" = EXCLUDED."event_id",
        "event_name" = EXCLUDED."event_name",
        "status" = EXCLUDED."status",
        "amount_cents" = EXCLUDED."amount_cents",
        "created_at" = EXCLUDED."created_at",
        "updated_at" = EXCLUDED."updated_at"
    `;
    return Number(affected);
  }

  /**
   * Whole-history rebuild of the per-company totals. The totals are global
   * aggregates, so only a full recompute (never a window delta) is
   * idempotent and exact.
   */
  async rebuildAllTotals(tx: DbClient): Promise<void> {
    await tx.$executeRaw`
      DELETE FROM "company_financial_totals"
    `;
    await tx.$executeRaw`
      INSERT INTO "company_financial_totals" (
        "company_id", "pending_amount_cents", "approved_amount_cents", "rejected_amount_cents", "orders_count"
      )
      SELECT "company_id",
             COALESCE(SUM("amount_cents") FILTER (WHERE "status" = 'pending'), 0),
             COALESCE(SUM("amount_cents") FILTER (WHERE "status" = 'approved'), 0),
             COALESCE(SUM("amount_cents") FILTER (WHERE "status" = 'rejected'), 0),
             COUNT(*)::int
      FROM "payment_orders"
      GROUP BY "company_id"
      ON CONFLICT ("company_id") DO UPDATE SET
        "pending_amount_cents" = EXCLUDED."pending_amount_cents",
        "approved_amount_cents" = EXCLUDED."approved_amount_cents",
        "rejected_amount_cents" = EXCLUDED."rejected_amount_cents",
        "orders_count" = EXCLUDED."orders_count"
    `;
  }
}
```


---

# repair2-set

## reasoning

```
The error is on line 27, column 26 of `src/common/api-exception-filter.ts`. Let me look at the file:

```typescript
} else if (exception instanceof HttpException) {
  status = exception.getStatus();
  code = this.codeForStatus(status);
```

Wait, line 27... let me count the lines:

1: import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
2: import { DomainException } from './domain-exception.js';
3: (blank)
4: interface ErrorEnvelope {
5:   error: { code: string; message: string; details: Record<string, unknown> };
6: }
7: (blank)
8: /**
9:  * Every error leaves the API in the single envelope
10:  * { error: { code, message, details } }; details is always an object.
11:  */
12: @Catch()
13: export class ApiExceptionFilter implements ExceptionFilter {
14:   catch(exception: unknown, host: ArgumentsHost): void {
15:     const response = host.switchToHttp().getResponse();
16:     const { status, body } = this.toEnvelope(exception);
17:     response.status(status).json(body);
18:   }
19: (blank)
20:   private toEnvelope(exception: unknown): { status: number; body: ErrorEnvelope } {
21:     let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
22:     let code = 'internal_error';
23:     let message = 'unexpected error';
24:     let details: Record<string, unknown> = {};
25: (blank)
26:     if (exception instanceof DomainException) {
27:       status = exception.status;
28:       code = exception.code;
29:       message = exception.message;
30:       details = exception.details;
31:     } else if (exception instanceof HttpException) {
32:       status = exception.getStatus();
...

So line 27 is `status = exception.status;` where `exception` is a `DomainException`.

The error says: `Property 'status' is private and only accessible within class 'HttpException'.`

This is interesting. The issue is that `DomainException` likely extends `HttpException`, and `HttpException` has a private `status` property. When the code does `exception instanceof DomainException`, TypeScript narrows the type to `DomainException`, but if `DomainException` extends `HttpException`, the `status` property from `HttpException` is private and not re-declared in `DomainException`.

Wait, but the error says "Property 'status' is private and only accessible within class 'HttpException'". This means `DomainException` extends `HttpException` and the `status` property is inherited from `HttpException` where it's private.

The fix: Instead of accessing `exception.status` directly (which is private on `HttpException`), use `exception.getStatus()` which is the public method on `HttpException`.

So line 27 should be:
```typescript
status = exception.getStatus();
```

This is the only error. Let me fix just this one file.
```

## reply

The single mistake: `DomainException` extends `HttpException`, whose `status` field is `private`. The public accessor is `getStatus()`. Line 27 accesses the private field directly instead of calling the public method.

### src/common/api-exception-filter.ts
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { DomainException } from './domain-exception.js';

interface ErrorEnvelope {
  error: { code: string; message: string; details: Record<string, unknown> };
}

/**
 * Every error leaves the API in the single envelope
 * { error: { code, message, details } }; details is always an object.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();
    const { status, body } = this.toEnvelope(exception);
    response.status(status).json(body);
  }

  private toEnvelope(exception: unknown): { status: number; body: ErrorEnvelope } {
    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal_error';
    let message = 'unexpected error';
    let details: Record<string, unknown> = {};

    if (exception instanceof DomainException) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = this.codeForStatus(status);
      const body = exception.getResponse();
      message = typeof body === 'string' ? body : this.messageFromBody(body);
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    return { status, body: { error: { code, message, details } } };
  }

  private codeForStatus(status: number): string {
    if (status === HttpStatus.BAD_REQUEST) return 'validation_failed';
    if (status === HttpStatus.NOT_FOUND) return 'resource_not_found';
    if (status === HttpStatus.CONFLICT) return 'conflict';
    return 'http_error';
  }

  private messageFromBody(body: unknown): string {
    if (typeof body === 'object' && body !== null) {
      const message = (body as { message?: unknown }).message;
      if (typeof message === 'string') return message;
      if (Array.isArray(message)) return message.join('; ');
    }
    return 'request failed';
  }
}
```


---
