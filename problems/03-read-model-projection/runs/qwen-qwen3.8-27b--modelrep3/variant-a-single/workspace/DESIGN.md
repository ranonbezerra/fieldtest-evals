# DESIGN — operations dashboard read model

## Problem

The back-office dashboard lists "operations" — payment orders joined with their
event and worker — filtered by company, status and date range, sorted by recency,
paginated, with exact per-company financial totals. At ~3M orders the ad-hoc
query takes 20–30 s; the target is p95 < 50 ms without changing what operators
see, and operators must see their own writes immediately.

## Read model

Two projection tables, both maintained from the source of truth
(`payment_orders` ⋈ `events` ⋈ `workers`):

- `operation_read_models` — one row per order, denormalized with the event name,
  event start and worker name. The dashboard is now a single indexed scan of one
  table:

  ```
  WHERE company_id = ? [AND status = ?] [AND created_at >= ? AND created_at < ?]
  ORDER BY created_at DESC, order_id DESC LIMIT ?
  ```

  served by `(company_id, status, created_at DESC, order_id DESC)` plus
  `(company_id, created_at DESC, order_id DESC)` for status-less queries. No
  joins, no sort step, no aggregation at read time.
- `company_operation_totals` — `operation_count`, `total_amount`,
  `approved_amount` per company in `numeric` (never floats). One primary-key
  lookup per totals request.

## How the projection is maintained

1. **Synchronous hooks in the write transaction.** Every simulated write (order
   create, status transition, event/worker rename) runs its maintenance step —
   upsert the read-model row, adjust the company totals — inside the *same*
   Prisma transaction as the source write: `order-writes.service.ts` opens the
   transaction through `order-writes.repository.ts` and invokes
   `projection-maintenance.service.ts` inside it.
2. **Exact totals under concurrency.** Totals move with atomic SQL increments
   (`total_amount = total_amount + Δ` via `upsert … ON CONFLICT DO UPDATE`),
   never a read-modify-write in application code, so racing writers on one
   company cannot lose updates.
3. **Re-derivation routine.** `rederivation.service.ts#rederive(from, to)`
   (also `POST /rederivations`) re-derives the read-model rows for orders
   created in `[from, to)` and recounts every touched company's totals directly
   from the source tables. Idempotent and exact by construction.
4. **Scheduled drift-repair job.** `drift-repair-scheduler.service.ts` runs
   `drift-repair.service.ts#run()` every `DRIFT_REPAIR_INTERVAL_MS`: count
   diverged rows in the trailing `DRIFT_REPAIR_WINDOW_HOURS` (missing rows,
   stale fields vs. the source join), then re-derive that window. It is the
   backstop for anything the hooks miss.

## Why synchronous hooks (and not the alternatives)

| Alternative | Why it loses |
|---|---|
| Index the source join and keep computing totals | The joins are the least of it: exact per-company totals still mean a range aggregation over up to millions of rows on hot companies, which alone blows the 50 ms p95. |
| CDC / outbox → async consumer (Debezium, Kafka, …) | Eventual consistency: an approval would be invisible for seconds — a direct violation of read-your-own-writes. It also adds infrastructure plus exactly the backfill/backstop jobs we would run anyway. |
| `REFRESH MATERIALIZED VIEW` | Same staleness, and each refresh is O(whole table) rather than O(window). |
| Cache (Redis/Memcached) | Stale reads, and concurrent increments on shared counters need app-level locking to stay exact — re-implementing the database's job. |
| **Synchronous hooks (chosen)** | Same-tx commit ⇒ zero lag (read-your-own-writes by construction), atomic increments ⇒ exact totals, no new infrastructure. The cost is two indexed upserts per order write, negligible against a 50 ms *read* budget. If a hook fails, the whole write rolls back (fail fast, operator retries) instead of leaving a half-applied read model; drift repair bounds any divergence that slips through to one repair interval. |

## Failure modes

- Hook throws → the whole write rolls back, the client gets the standard error
  envelope, and a retry is safe.
- Missed/bypassed hook (manual SQL, old code, crash mid-migration) → the next
  drift-repair run within `DRIFT_REPAIR_INTERVAL_MS` re-derives the window and
  restores exactness.
- Large re-derivation windows run in a single transaction with an extended
  timeout and are idempotent, so retries are safe.
