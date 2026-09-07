# DESIGN — Operations dashboard read model (Variant A)

## Problem

The back-office lists "operations" — payment orders joined with events and
workers — filtered by company, status, and date range, sorted by recency,
paginated. Against ~3M orders the 3-way join takes 20–30s. Requirements:

- p95 < 50ms,
- read-your-own-writes: approve an order → visible on the next request,
- exact (not approximate) per-company financial totals,
- no change to what operators see.

## Approach: projection tables maintained synchronously by the write path

Two tables, both maintained inside the write transaction:

- `operations_read_model` — one row per payment order, with worker/event
  denormalized in. The dashboard becomes a single-table
  `WHERE company_id [AND status] [AND created_at range]
  ORDER BY created_at DESC LIMIT/OFFSET`, served by
  `(company_id, status, created_at DESC, payment_order_id DESC)` and
  `(company_id, created_at DESC, payment_order_id DESC)` — an index range scan
  doing O(page) work, independent of the 3M-row join.
- `company_order_totals` — per-company running counts and `NUMERIC(18,2)`
  sums, updated with **atomic increment** statements
  (`INSERT ... ON CONFLICT DO UPDATE SET x = t.x + delta`). Concurrent writes
  to one company serialize on the row, no increment can be lost, and money is
  exact end to end (Postgres NUMERIC → Prisma Decimal → JSON strings in the API).

### The sync hook

`OrdersRepository.createOrder` / `transitionOrder` run one interactive
transaction: source write → `OperationsProjectionRepository.applyOrderCreated`
/ `applyOrderChanged` → commit. Source and projection commit together, so the
operator's own write is visible on the very next dashboard request, and a
crash can never leave the two diverged. Status transitions take
`SELECT ... FOR UPDATE` on the order row so concurrent transitions serialize,
and a stale expectation returns `409 conflict`.

### Why sync hooks, not the alternatives

| Alternative | Verdict |
| --- | --- |
| Async events / outbox + consumer | Lag between write and visibility → violates read-your-own-writes; plus at-least-once, idempotency and replay machinery for no gain. |
| CDC (logical replication, e.g. Debezium) | Same lag, plus external infrastructure; the writer already owns the transaction, so an extra replication pipeline is pure cost. |
| Batch rebuild only (no hook) | Drift is unbounded between batches → same read-your-own-writes violation. Kept *in addition*, as the safety net below. |
| SQL view over the source | Rebuilds the 3-way join per query — exactly the 20–30s query being replaced. |
| In-process / Redis cache | Consistency problem at least as hard as the one in Postgres, plus an eviction/serialization layer. |

The write path is local to this service and same-database, which is exactly
where an in-transaction hook is the cheapest correct option: it cannot lag,
cannot be partially lost, and needs no new infrastructure.

## Safety net: re-derivation and scheduled drift repair

- **Re-derivation for an arbitrary window** —
  `OperationsReconciliationService.rederiveWindow(from, to)` rebuilds every
  order whose `created_at` *or* `updated_at` falls in `[from, to)` straight
  from the source tables (joined to workers/events), then recomputes totals
  for all companies touched as full exact aggregates. Idempotent. Exposed at
  `POST /operations/reconcile` for operators.
- **Scheduled drift-repair job** — `DriftRepairProcessor` (cron, default every
  15 minutes; window = last 24h + 1h overlap, tunable via
  `DRIFT_REPAIR_LOOKBACK_MS` / `DRIFT_REPAIR_OVERLAP_MS`) counts missing,
  stale, and orphan projection rows in the window, repairs them by
  re-deriving the window, deletes orphans, and logs the report. Manual trigger:
  `POST /operations/drift-repair`.

Because the hook path is atomic with the source write, drift can only come
from out-of-band changes (backfills, manual SQL, a hotfix that bypassed the
service) — the routines above exist for exactly that.

## What operators see

Unchanged: the same operation rows (order fields plus worker/event names),
same filters, same sort (recency, deterministic tie-break on id), same
pagination — plus exact per-company totals in the page payload and at
`GET /operations/totals?companyId=`.

## Limitations

- Re-derivation rewrites the rows in the window and recomputes totals per
  touched company; a full rebuild is a re-derivation over the full date range.
- The projection mirrors worker/event *names* as of the order's last write;
  renaming a worker later is picked up by re-derivation (drift detection
  flags it), not by the hook.
- Offset pagination degrades for very deep offsets; the index keeps
  realistic pages fast.
