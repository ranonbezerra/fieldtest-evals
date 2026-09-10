# DESIGN — operations dashboard read model

## Problem

The marketplace back-office lists "operations" — payment orders joined with
events and workers — filtered by company, status, and date range, sorted by
recency, paginated. With ~3M orders the join takes 20–30s. Target: p95 under
50ms, without changing what operators see. Two hard constraints:

1. **Read-your-own-writes** — approve an order and it must show on the next request.
2. **Exact financial totals** per company — no approximation.

## Decision

Two projection tables, maintained **synchronously, in the same Postgres
transaction as the write** (the "maintenance hooks" invoked by the write
services — simulated here by the `payment-orders` and `order-events` features):

| Table | Purpose |
| --- | --- |
| `operations` | One denormalized row per order: company, worker name, status, amount, `last_event_at` (recency key). The dashboard is one indexed read on this table. |
| `company_financial_totals` | Exact per `(company_id, status)` aggregates: order count + total amount. |

The dashboard query is `SELECT ... FROM operations WHERE company_id = ?
[AND status = ?] [AND last_event_at >= ? [AND last_event_at < ?]] ORDER BY
last_event_at DESC, id DESC LIMIT ? OFFSET ?` — served by
`(company_id, last_event_at DESC)` and
`(company_id, status, last_event_at DESC)`. A point query on a narrow table is
well under 50ms at 3M rows; there is no join left to do at read time.

## Why sync hooks instead of the alternatives

- **Read-your-own-writes**: the projection and the write commit atomically, so
  there is no window in which a fresh write is invisible. Any async path (CDC,
  outbox + queue, logical replication) introduces a lag window that the
  constraint forbids; making the reader wait for the sync path defeats it.
- **Exact totals**: the aggregates are maintained arithmetically, not
  approximated. Each delta is a single `INSERT ... ON CONFLICT DO UPDATE SET
  count = count + ?, amount = amount + ?`. Concurrent writers serialize on the
  `(company_id, status)` row, so interleavings cannot lose or double-count —
  covered by the concurrency test (16 parallel approvals, exact sum).
  HyperLogLog / sampling / estimated counts are ruled out by constraint 2.
- **Cost**: 2–3 extra row writes per write, all on rows already hot in the
  write path. No new service, broker, or infrastructure; the transaction stays
  short (single-row locks, no scans).

### Alternatives rejected

- **Join at read time** — the 20–30s problem. Rejected.
- **Materialized view** — `REFRESH MATERIALIZED VIEW` is not atomic with the
  write (stale window → violates constraint 1) and concurrent refresh takes an
  exclusive lock. Rejected.
- **Async CDC / outbox / queue** — eventually correct, immediately stale;
  right for non-critical analytics, not for this dashboard. Rejected here.
- **Cache with invalidation** — the invalidation race is the same stale window,
  and the totals still need the exact delta logic. The projection table *is*
  the durable, queryable cache.
- **Approximate aggregates** — violates constraint 2. Rejected.

## Failure modes: drift, and how it is repaired

The projection can only diverge from the source if a hook is bypassed (a buggy
hotfix, a manual DB patch, a partially rolled-out deploy). Two tools:

1. **Windowed re-derivation** — `DriftRepairService.rederive(from, to)`
   rebuilds, from the source tables, every row for an order *created* in
   `[from, to)` or with an *event* in `[from, to)`, and recomputes the totals
   **in full** for the affected companies. Idempotent: safe to overlap windows
   and to run twice; it reports how many rows it actually corrected.
2. **Scheduled drift repair** — `DriftRepairProcessor` runs every
   `DRIFT_REPAIR_INTERVAL_MS` (default 15 min) and re-derives the last
   `DRIFT_REPAIR_WINDOW_MINUTES` (default 30 min), so any missed hook
   self-heals within one window.

## Accepted costs

- Slightly longer write transactions (2–3 extra indexed row writes).
- Duplicated data (worker name, status) — the source of truth remains
  `payment_orders` / `order_events` / `workers`. The projection has **no
  foreign keys** into it, so a rebuild or backfill can never block a write.
