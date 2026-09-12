# DESIGN – Synchronous Projection for the Operations Dashboard

## Goal
Provide a sub‑second (p95 < 50 ms) operations list without changing the
operators’ view, while guaranteeing:

* **Read‑your‑own‑writes** – an operator’s approval must be visible on the next
  request, with no lag.
* **Exact per‑company financial totals** – finance requires a mathematically
  correct sum, not an eventual‑consistency approximation.

## Chosen Architecture

| Layer | Responsibility |
|-------|-----------------|
| **Write service** (simulated in tests) | Persists the source `payment_order` row. |
| **Synchronous maintenance hook** (`OperationsService.handleOrderApproved`) | Runs **inside the same transaction** that writes the source row. It upserts the projection row and atomically updates the company totals. |
| **Projection table** (`operation_projections`) | Denormalised, one row per order containing all columns needed by the dashboard. |
| **Company totals table** (`company_financial_totals`) | Stores the exact sum of `amount` for all `APPROVED` orders per company. Updated atomically with `INSERT … ON CONFLICT … DO UPDATE` to avoid lost updates. |
| **Re‑derivation routine** (`OperationsRepository.rederiveProjection`) | Rebuilds the projection for any arbitrary date window, safe to run while the system is live. |
| **Drift‑repair job** (`DriftRepairJob`) | Periodic (hourly) scan of a recent window, compares projection to source, and fixes mismatches. |
| **Dashboard query** (`OperationsRepository.fetchOperations`) | Reads **only** the projection, using a covering index (`companyId + status + approvedAt + id`) to satisfy the filter‑order‑paginate pattern. |

## Why Synchronous Hooks?

* **Read‑your‑own‑writes**: As soon as the outer transaction commits, the
  projection row is already present. Any later read (even from a different
  connection) sees the updated state immediately.
* **Atomic totals**: The hook updates the totals in the same transaction,
  using a single `INSERT … ON CONFLICT … DO UPDATE` statement that PostgreSQL
  executes atomically, eliminating classic “lost update” race conditions.
* **Simplicity & determinism**: No external queues, no eventual‑consistency
  windows, no replica lag. The system’s state is always consistent after a
  transaction completes.

### Alternatives Rejected

| Alternative | Reason for rejection |
|-------------|----------------------|
| **Post‑commit async worker / queue** | Introduces a window where the operator’s own change is invisible. |
| **Logical replication + materialised view** | Replication lag would break read‑your‑own‑writes. |
| **Periodic batch rebuild only** | Operators would see stale data until the next batch. |
| **Optimistic cache with stale‑while‑revalidate** | Finance totals must be exact; cache invalidation would be complex. |

## Concurrency Guarantees

* The totals table is updated with a single SQL statement that adds the delta.
  PostgreSQL guarantees row‑level atomicity, so concurrent approvals for the
  same company accumulate correctly.
* The projection upsert uses `ON CONFLICT … DO UPDATE`, which is also atomic.

## Re‑derivation & Drift Repair

* **Re‑derivation** clears the projection rows for the window, bulk‑inserts the
  fresh source data, and recomputes totals via a `GROUP BY`. Running it twice
  yields the same result because the operation is idempotent.
* **Drift repair** runs hourly, compares source and projection for the last hour,
  and fixes any divergence. It also adjusts totals to keep them exact.
* Both routines operate inside a single transaction, ensuring that live traffic
  never observes a partially rebuilt state.

## Indexing Strategy

`operation_projections` has a covering index:

```
CREATE INDEX idx_ops_company_status_approved
ON operation_projections (company_id, status, approved_at DESC, id DESC);
