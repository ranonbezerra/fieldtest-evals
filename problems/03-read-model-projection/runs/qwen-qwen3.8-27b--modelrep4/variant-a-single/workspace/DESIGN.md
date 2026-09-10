# DESIGN — operations dashboard read model

## Problem
The back-office "operations" list is a three-way join (payment_orders ⋈ events ⋈ workers) over ~3M
orders, filtered by company/status/date range, sorted by recency, paginated — 20–30 s per page.
Target: p95 < 50 ms, without changing what operators see; operators must see their own writes
immediately (approve → reflected on the next request); financial totals per company must be exact.

## What was built
Two read-model tables plus transactional maintenance:

1. `operation_views` — one row per payment order, denormalised with the worker/event fields the
   dashboard renders. The dashboard query is a single-table index scan:
   `company_id` equality + optional `status` equality + a `created_at` range, walked in
   `(created_at DESC, id DESC)` index order with `LIMIT` — no joins, no sort step.
2. `company_operation_totals` — exact running aggregates per company and status (cents + counts,
   `BIGINT`), maintained by atomic delta upserts on the write path.

### Synchronous maintenance hooks
`PaymentOrderRepository` writes the source row and the read model **in one transaction**:

- create order → insert order, upsert the view row, add to the `pending` totals;
- change status → `SELECT … FOR UPDATE`, update the order, upsert the view row, move the cents and
  count between status buckets.

The read model is therefore correct the moment the write commits: the operator's next request
(read-committed, any connection from the pool) already sees it. Read-your-own-writes holds by
construction, not by cache eviction.

Why synchronous hooks instead of the alternatives:

- **Keep the join, add indexes.** A three-way join over 3M rows plus per-row worker/event lookups
  and a filesort for recency cannot hit 50 ms p95 no matter how the indexes are tuned. The join has
  to disappear from the hot path, not merely get faster.
- **Async CDC (Debezium / outbox + consumer).** Correct eventually, wrong *now* — and consumer lag
  is exactly the window where an operator approves an order and the dashboard still shows the old
  status, which the requirement forbids. It also means a second system to keep exactly-once
  semantics for financial totals.
- **Materialised views / periodic refresh.** `REFRESH MATERIALIZED VIEW` is all-or-nothing and
  minutes-to-hours stale; there is no row-level freshness for the company just written.
- **In-memory cache (Redis).** Caching the aggregate is easy; caching the *list* with consistent
  filters and pagination is the invalidation problem again, and a cache serving stale totals
  violates the exactness requirement.

Hook cost is one upsert plus one counter update per write — negligible next to the write itself —
and bounded: a failed hook rolls back the whole write, so there is never a partially-written state.

### Exactness under concurrency
Totals are never recomputed per request; they are accumulated with `SET bucket = bucket +
EXCLUDED.bucket` upserts. PostgreSQL re-reads the current row version before applying the update,
so N concurrent status changes on one company's totals row accumulate exactly — covered by
`test/concurrent-company-totals.spec.ts` (45 concurrent transitions, exact expected sums). Amounts
are integer cents end to end (`BIGINT`), so no floating point is involved.

## Re-derivation (arbitrary window)
`OperationsService.rederive(from, to, companyId?)`, exposed as `POST /operations/rederive`:
deletes and re-populates `operation_views` for `created_at ∈ [from, to)` (optionally one company)
from the source join, then recomputes the affected companies' totals from their full order history —
in one transaction. Idempotent: the read model is rebuilt from the source of truth, never patched.
Window semantics: `[from, to)` on `created_at`; a later status change on an order is picked up
whenever that order's `created_at` falls inside the window.

## Drift repair (scheduled)
`OperationsDriftRepairJob` runs every `DRIFT_REPAIR_INTERVAL_MS` (default 60 s; `0` disables it):

1. **Day digests.** Per (company, UTC day): count + cents + `md5` over `id|status|cents|worker|event`
   for the last `DRIFT_REPAIR_LOOKBACK_DAYS` (default 14), source vs view. Any mismatch re-derives
   that company's affected days. The hash catches status flips and denormalised-field staleness that
   count+sum alone would not.
2. **Totals backstop.** Recomputes all-time per-company totals from the source and compares to
   `company_operation_totals`; a mismatch re-derives that company's full `created_at` range. This
   catches drift on orders older than the lookback window, which the day digests cannot see.

Both paths funnel into the same re-derivation routine, so the repair produces exactly what the API
already knows to be correct.

## Indexes
| index | serves |
|---|---|
| `operation_views (company_id, status, created_at DESC, id DESC)` | status-filtered pages; matches `ORDER BY`, so no sort |
| `operation_views (company_id, created_at DESC, id DESC)` | unfiltered pages |
| `operation_views (created_at)` | re-derivation / drift window scans |
| `payment_orders (company_id)`, `payment_orders (created_at)` | re-derivation, drift checks |

Trailing `id DESC` breaks `created_at` ties deterministically, keeping pagination stable.

## Expected latency
A page is a bounded index scan: at most `pageSize` index entries are read, in order. At 3M rows this
is single-digit milliseconds on Postgres. The p95 < 50 ms target is asserted in
`test/read-your-own-writes.spec.ts` with 5000 rows for one company.

## Environment
| variable | meaning | default |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | required |
| `PRISMA_CONNECTION_LIMIT` | client pool size (lets the write path run concurrent transactions) | 10 |
| `DRIFT_REPAIR_INTERVAL_MS` | drift-repair cadence; `0` disables the scheduler | 60000 |
| `DRIFT_REPAIR_LOOKBACK_DAYS` | day-digest window | 14 |
| `PORT` | HTTP port | 3000 |

## API
- `POST /payment-orders` — create an order (simulated write path; 201)
- `POST /payment-orders/:id/status` — transition via `{ status }` (200); 409 `invalid_transition` /
  `state_conflict`, 404 `resource_not_found`
- `GET /operations?companyId&status&from&to&page&pageSize` — the dashboard: items + pagination +
  exact per-status totals
- `POST /operations/rederive` — `{ from, to, companyId? }` (200)

## Known limitations
- The day digest covers only the lookback window; older drift is caught only by the totals
  backstop, which is a per-status aggregate (an amount swap between two orders of the same status
  and day would be invisible — not a realistic failure mode of the hooks).
- Company totals are all-time; the dashboard does not re-aggregate them per date range.
