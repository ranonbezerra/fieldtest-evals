# DESIGN.md — operations read model

## Problem

The operations dashboard joins `payment_orders`, `events` and `workers`, filters
by company, status and date range, sorts by recency and paginates. At ~3M orders
the query takes 20–30 s. Target: **p95 < 50 ms with no change to what an
operator sees**. Two constraints rule out the obvious fixes:

- Operators must see their own writes immediately (approve → the next request
  shows it). Any design with a refresh window fails, however short the window.
- Per-company financial totals must be **exact** — not approximate, not
  eventually exact. Finance reconciles against them.

## Read-model shape

- `op_operations` — one row per payment order, pre-joined with the worker name
  and the worker's most recent event. Its columns are exactly what the dashboard
  renders, so the hot query is a single index-only scan.
- `company_totals` — one row per company with exact counts and amounts per
  status.

Neither table is precious: both are fully re-derivable from the source tables for
any date window, which is what makes drift recoverable instead of fatal.

## Maintenance: synchronous hooks inside the writer's transaction

The read-your-own-writes requirement is the whole design constraint: there must
be **no window** in which a committed write is invisible. The hooks
(`ProjectionRepository.onOrderCreated / onOrderStatusChanged / onEventLogged`)
are therefore called by the write services **on the write's own transaction
client**, inside the same `$transaction` as the source write:

- commit ⇒ source row and projection rows become visible together;
- rollback ⇒ the projection never saw the write.

Alternatives considered and rejected:

| Alternative | Why it fails the constraints |
| --- | --- |
| After-commit hook / outbox + queue consumer | A lag window between commit and projection update; a consumer crash loses updates until repair. |
| Scheduled refresh / `REFRESH MATERIALIZED VIEW` | A staleness window by construction — the requirement forbids any window. |
| Trigger on a replica / CDC subscriber | Replication lag = an invisible-writes window; exact totals still need a serializing aggregate. |
| Cache layer (Redis / in-memory) | Eviction and TTL reintroduce staleness; caches do not give exact aggregates. |
| Postgres trigger on the source tables | Also synchronous and in-transaction, so it is the closest alternative. Rejected because the spec pins maintenance to the write services (exercisable, reviewable and unit-testable in the application's language), and re-derivation would have to disable/re-enable triggers. With the write services as the only writers, in-app hooks give the same atomicity with none of that. |

## Exact totals under concurrency

The totals hook is a **single in-place `UPDATE` with SQL-level increments**
(`count + 1`, `amount + n`, or their negatives on a status change) — never a
read-modify-write. Two approvals for the same company serialize on the totals
row's lock, and each applies its own delta, so neither is lost (a
read-modify-write would lose one). The concurrent test runs two (and ten)
approvals for one company concurrently and asserts the exact totals.

## Re-derivation (safe while live, idempotent)

`rebuildWindow(from, to)` runs one transaction (READ COMMITTED):

1. Find the companies that have orders in `[from, to)`.
2. Ensure their `company_totals` rows exist and take a `FOR UPDATE` lock on
   them, in sorted company order. A live writer's hook then blocks until this
   transaction commits, and its increment lands **on top of** the recomputed
   value; a writer that committed before our snapshot is already included in
   the recompute. Either way the final value is exact. Sorted locking order
   keeps concurrent rebuilds from deadlocking.
3. `DELETE` the window's `op_operations` rows and re-`INSERT` them from source.
   Delete + insert makes a second run over the same window a no-op.
4. Recompute each affected company's totals from the full source history.

## Scheduled drift repair

`ProjectionService.scheduledDriftRepair` runs on a cron (`DRIFT_REPAIR_CRON`,
default hourly) over the last `DRIFT_REPAIR_WINDOW_HOURS` (default 24 h). It
compares projection to source for the window — ops rows missing or stale
(including worker name and latest event), orphan ops rows whose source order was
removed, and totals that disagree for window companies — and repairs via the
same `rebuildWindow` (plus totals recompute for companies whose only evidence of
drift is an orphan). A clean run is a handful of `COUNT` queries. An in-flight
guard skips overlapping ticks. Manual source fixes and bad deploys therefore
self-heal without an operator noticing first.

## Why the dashboard query is fast

The query reads `op_operations` only — no join back to source. Indexes are
shaped to the exact access pattern (filter `company_id` [+ `status`], sort
`created_at DESC, id DESC`, return all displayed columns):

- `ops_company_recency_covering (company_id, created_at DESC, id DESC) INCLUDE (…)`,
- one partial covering index per status.

`ORDER BY` matches the index order, so there is no sort node and `LIMIT`
terminates the scan early; `OFFSET n` costs n extra index tuples. The query is
an index-only scan, which is what buys p95 < 50 ms at 3M rows.

## What operators see

Same columns, same filters, same ordering, same page sizes. One deliberate
difference: ties on `created_at` break by `id DESC`, making pagination
deterministic (the old join had no defined tie-break).

## Failure modes

- Deploy mid-write → the transaction rolls back; the projection is untouched.
- Manual source fix → the next repair tick (or a manual re-derive) reconciles it.
- Projection bug or lost maintenance → re-derive the window; it is idempotent.

## Operations

- Env: `DATABASE_URL` (required), `PORT` (default 3000), `DRIFT_REPAIR_CRON`
  (default `0 * * * *`), `DRIFT_REPAIR_WINDOW_HOURS` (default 24).
- Schema: `prisma/migrations/20250101000000_initial` (source + projections +
  indexes). `pnpm install && pnpm prisma:migrate && pnpm start`.
- Tests: `pnpm test` (Vitest against a real Postgres pointed at by
  `DATABASE_URL`; specs share the database and run sequentially).
