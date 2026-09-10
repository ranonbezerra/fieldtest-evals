# DESIGN — operations dashboard read model (issue #501)

## Constraints that decide the design

1. **Read-your-own-writes.** An operator approves an order; the next dashboard request shows it.
   Any design with a propagation window (a schedule, a queue, a replica) violates this by construction.
2. **Exact per-company totals.** Finance reconciles against them: not approximate, not "eventually exact".
3. **p95 < 50 ms** at ~3M orders, with no change to what operators see (columns, filters, ordering, page sizes).

## The design in one paragraph

Two projection tables, maintained by hooks that run **inside the writer's own Postgres transaction**:
`operation_rows` (one row per payment order, shaped like the dashboard join) and
`company_financial_totals` (exact per-company aggregates). The dashboard query reads `operation_rows`
alone, served by a covering index that matches filter + sort. A windowed re-derivation routine rebuilds
the projection from the source tables (idempotent, safe while live), and a scheduled drift-repair job
compares projection against source for a recent window and converges what disagrees.

## Why the hooks are synchronous and in-transaction

The hooks are plain service calls from the write services (`ProjectionService.applyOrderChange` /
`applyEvent`), executed with the same transaction handle as the source mutation:

- the projection sees exactly the writer's snapshot — no visibility gap, so the next read (same or
  another connection) observes the change immediately;
- if the write rolls back, the projection never saw it — no orphaned state, no compensating writes.

### Alternatives rejected

| Alternative | Why it fails or loses |
|---|---|
| Scheduled refresh / interval job | Any interval > 0 is a read-your-own-writes gap. The requirement explicitly forbids it. |
| `REFRESH MATERIALIZED VIEW` (even `CONCURRENTLY`) | Same scheduling problem, plus a whole-table rebuild cost; the refresh is global and cannot bound per-write latency. |
| Postgres trigger on the source table | Works, but moves read-model logic out of the app: untestable with the app's tests, a second home for business rules, and a surprise at the schema level. Same cost as an in-transaction hook, strictly less testable. |
| CDC / outbox / queue (e.g. Debezium → consumer) | Asynchronous by construction: consumer lag *is* the read-your-own-writes gap. More infrastructure for a property we do not need (decoupling) at the cost of the property we do (zero gap). |
| Trigger/replication on a replica | Adds a network hop and lag; the read-your-own-writes gap again. |
| Better index / faster join on the source | The join spans three tables at 3M rows with selective filters; index tuning buys an order of magnitude at best, not the ~400× to 50 ms, and every new column the dashboard wants reopens the join. A cache has the same staleness problem as a schedule. |

An in-transaction hook costs one indexed upsert plus one row update per write — negligible next to the
write itself — and is the only option with a zero gap.

## Exactness under concurrency

The totals row is never read-modify-written in app code. The hook applies an **in-place delta**
(`SET x = x ± delta` via Prisma `increment`/`decrement` inside an upsert): concurrent writers to the same
company's row serialize on the row lock and each delta is applied exactly once. `test/concurrency.spec.ts`
proves it with two and with eight truly concurrent approvals (separate transactions), asserting the exact
sum and count — a read-modify-write loses updates under this test.

## Idempotent re-derivation

`OperationsService.rederive(from, to)` runs two set-based statements in one transaction:

1. `INSERT … SELECT … ON CONFLICT DO UPDATE` rebuilds `operation_rows` for orders created in `[from, to)` —
   current status plus the latest event via `DISTINCT ON (order, occurred_at DESC, id DESC)`. The result
   depends only on the current source state, so running it twice leaves the same result.
2. `company_financial_totals` is recomputed from scratch (totals are global, not windowable).

Safe while live: the rebuild reads a snapshot; writes that commit afterwards are applied by the hooks, so
the projection converges to the latest source state either way. `POST /operations/rederive` exposes it.

## Drift repair

`DriftRepairService` runs on a cron (`DRIFT_REPAIR_CRON`, default every 5 minutes) over a recent window
(`DRIFT_REPAIR_WINDOW_HOURS`, default 24):

1. `findDriftedOrderIds` — orders in the window whose row is missing or `IS DISTINCT FROM` the source
   (status, company, worker name, amount, currency, latest event).
2. If any: the windowed re-derivation (the same idempotent routine) repairs the window.
3. `findTotalsDriftedCompanyIds` — companies whose totals row is missing, stale, or disagrees with the
   source aggregate. If any: recompute totals from scratch.
4. The outcome is logged. The job is a pure converging pass, so a failed run simply means the next one
   catches up.

Drift sources it is built for: a deploy mid-transaction, a manual data fix, a future bug in a hook.
A repair that requires a human to notice first would be a no-op.

## The read path

`GET /operations` → `operation_rows` only; no join back to the source.

```sql
CREATE INDEX operation_rows_company_status_updated_idx
  ON operation_rows (company_id, status, updated_at DESC, payment_order_id DESC)
  INCLUDE (worker_name, amount_cents, currency, latest_event_type, latest_event_at, latest_event_id, created_at);
```

The index is a seek on `(company_id, status)`, walked in sort order; `created_at` (the date-range filter)
and every projected column are in `INCLUDE`, so the query is answered from the index alone. `payment_order_id`
in the key makes the tiebreak and pagination stable. (Prisma cannot express `INCLUDE`; the migration carries
it — see "Caveats".)

## What operators see — unchanged

Same columns as the old join (order id, company, status, worker name, amount, currency, latest event,
timestamps), same filters (company, status, created-in range), same ordering (`updated_at DESC`, order-id
tiebreak), same page semantics. The only behavioural change is the guarantee: own writes visible immediately,
totals exact.

A row's `updated_at` mirrors `payment_orders.updated_at`; an event updates the latest-event fields but not
the row's recency — the same as the old join, where inserting an event did not touch the order row.

## Caveats

- `operation_rows` carries an FK to `payment_orders` (`ON DELETE CASCADE`) that the Prisma model does not
  declare (Prisma models it as a loose projection). The migration is authoritative for the physical schema.
- The drift window is recent-activity-based: corruption older than the window is caught on the next change
  to the affected orders, or by a manual `POST /operations/rederive`.
- Totals are stored as `BIGINT` cents and serialized as JSON numbers; the range is far beyond any realistic
  company total.

## Operations

- Env: `DATABASE_URL`, `PORT`, `DRIFT_REPAIR_CRON`, `DRIFT_REPAIR_WINDOW_HOURS`.
- Apply schema: `pnpm migrate` (`prisma migrate deploy`). Run tests: `pnpm test` (needs a Postgres with
  the migrations applied; test files run serially against it).
