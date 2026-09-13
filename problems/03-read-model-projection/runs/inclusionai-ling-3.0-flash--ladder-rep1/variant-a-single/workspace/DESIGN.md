# Design — Operations Dashboard Projection

## Problem

The operations dashboard joins `payment_orders`, `events`, and `workers`, then
filters by company, status, and date range. At ~3M rows the join is 20–30 s.
Two hard constraints block the obvious fixes:

1. **Read-your-own-writes.** Approving an order must appear on the next
   dashboard request. Any refresh interval, however short, violates this.
2. **Exact totals.** Finance reconciles against per-company financial totals;
   they cannot be eventually correct or sampled.

## Solution

Replace the hot-path join with a **materialised projection table**
(`order_dashboard`) that mirrors the dashboard query shape, plus a
**per-company financial totals** table (`company_financial_totals`) that is
updated atomically.

The hot-path query now reads only from projection tables — no join to source.

## Why synchronous hooks inside the write transaction

| Alternative | Why rejected |
|---|---|
| **After-commit hook (queue/listener)** | A message published after the write commits, then consumed by a projection updater, introduces a propagation delay — even if only tens of milliseconds. The operator's next request can arrive in that window. |
| **Database trigger** | Triggers fire synchronously inside the statement, which is tempting, but they cannot read denormalised values that the write service just computed in application code (worker name, company name) without re-querying, and they couple schema logic to the database, making migrations harder. |
| **Scheduled refresh (cron/interval)** | Entirely incompatible with read-your-own-writes. The requirement is *immediate*, not *eventual*. |
| **Change Data Capture (CDC) on a replica** | Asynchronous by definition. The replica lag window violates the requirement. |

**Synchronous hooks inside the writer's transaction** is the only option that
guarantees the projection is updated *before* the transaction commits, so the
very next read sees the change. If the write rolls back, the transaction client
also rolls back the projection writes — the projection never saw data it should
not have.

The write service calls `prisma.$transaction(async (tx) => { … })` and inside
the callback:

1. Updates the source row (`payment_orders`).
2. Calls `syncOrderDashboard(tx, …)` — inserts/updates the matching
   `order_dashboard` row via the same `tx` client.
3. Calls `updateCompanyTotals(tx, …)` — atomically increments the relevant
   financial columns via `upsert` with server-side `increment`.

Because all three statements use the **same transaction client**, they are
all-or-nothing.

## Atomic concurrent updates to company totals

`updateCompanyTotals` uses PostgreSQL's `INSERT … ON CONFLICT … DO UPDATE`
(prisma `upsert` with `{ increment: value }`). The database serialises
concurrent writes to the same `company_financial_totals` row at the row level.
Each concurrent approval increments the same column by the order amount; the
database guarantees both increments land, so the running total is exact.

```
T1: UPDATE totals SET approved_amount = approved_amount + 250 …
T2: UPDATE totals SET approved_amount = approved_amount + 350 …
→ approved_amount = 600  (neither lost)
```

## Re-derivation routine

`rederiveWindow(start, end)` deletes every `order_dashboard` row whose
`createdAt` falls inside the window, then rebuilds from the source tables
(`payment_orders` + `events` + `workers` + `companies`). For each affected
company it recalculates `company_financial_totals` from scratch. It runs inside
a transaction so the rebuild is atomic — operators never see a half-rebuilt
state. Because it always rebuilds from source, running it twice produces
identical output (idempotent).

## Scheduled drift-repair job

`repairDrift(windowDays)` compares every `order_dashboard` row in the given
window against the corresponding `payment_orders` row, fixes status mismatches,
and re-inserts missing rows. Run on a schedule (e.g. every 5 minutes via a
cron job or external orchestrator), it catches drift from mid-deployment
transactions, manual fixes, or any other source of disagreement.

## Indexing

The covering index on `order_dashboard` matches the exact access pattern:

```sql
CREATE INDEX idx_order_dashboard_covering
  ON order_dashboard (company_id, status, created_at DESC)
  INCLUDE (order_id, worker_id, worker_name, company_name, amount, updated_at, event_count);
```

The filter (`companyId`, `status`), sort (`createdAt DESC`), and all projected
columns are satisfied by the index alone — the query never touches the heap.

## What operators see

No change. Same filters (company, status, date range), same sort (recency),
same pagination. The only difference is the query hits one table instead of a
three-way join, which is why p95 drops from 20–30 s to under 50 ms.
