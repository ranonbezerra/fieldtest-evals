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
