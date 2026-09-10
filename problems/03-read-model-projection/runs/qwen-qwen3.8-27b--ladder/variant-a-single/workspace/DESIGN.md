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
