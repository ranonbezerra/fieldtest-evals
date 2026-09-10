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
