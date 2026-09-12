# DESIGN

## Goal

Provide a sub‑second (p95 < 50 ms) operations dashboard without changing the
observable columns, filters, ordering, or pagination. Operators must see the
effects of their own writes immediately, and per‑company financial totals must be
exact.

## Chosen Architecture – Synchronous Projection Hooks

We maintain a **materialised projection table** (`operation_projection`) that
mirrors the join of `payment_order`, `event` and `worker`. The projection is
kept in sync by **hooks that run inside the same transaction that writes the
source rows**.

### Why synchronous hooks?

| Alternative                               | Delay for own‑writes | Consistency of totals | Complexity |
|------------------------------------------|----------------------|-----------------------|------------|
| Post‑commit queue (e.g., Kafka)          | Seconds‑to‑minutes   | Requires idempotent handling; risk of lost updates under failure | High |
| Trigger on read‑replica                  | Seconds (replication lag) | Same as queue | Medium |
| Periodic batch job (e.g., every minute) | Up to batch interval | May miss real‑time totals | Low |
| **Sync hook inside transaction** (our choice) | **0 ms** (visible on next request) | **Exact** – the update is atomic with the source write | Moderate (requires careful transaction handling) |

Because the dashboard is a critical operational tool, any latency in seeing
the operator’s own changes is unacceptable. Synchronous hooks guarantee
*read‑your‑own‑writes* by virtue of being part of the same transaction: if the
transaction rolls back, the projection never sees the change; if it commits,
the projection is already consistent.

## Concurrency Control for Totals

Two operators may approve orders for the same company at the same time.
A naïve read‑modify‑write would lose one increment. To avoid this we use a
single **`INSERT … ON CONFLICT … UPDATE`** statement that atomically adds the
delta to `operation_company_total.total_amount`. PostgreSQL guarantees the
operation is serialised, eliminating lost updates without requiring explicit
locks in application code.

## Re‑derivation Routine

The system can rebuild the projection for any date window:

1. Delete existing projection rows for the window.
2. Re‑insert rows derived from the source tables.
3. Re‑compute per‑company totals **over all time** for the affected companies
   (not just the window) to keep totals exact.

Running this while the system is live is safe because it operates on the same
tables using transactional writes; running it twice produces the same result.

## Drift‑Repair Job

Even with synchronous hooks, drift can occur (e.g., manual data fixes, deployment
bugs). A scheduled job runs every ten minutes:

* Computes source totals for the recent hour.
* Compares them with the totals stored in the projection.
* Repairs any mismatches by upserting the correct totals.

The job is lightweight (aggregates only recent data) and runs independently of
the main write path.

## Indexes

The hot path query reads **only** from `operation_projection`. We create a
covering index:

```
CREATE INDEX idx_company_status_created_at_desc
ON operation_projection (company_id, status, created_at DESC);
