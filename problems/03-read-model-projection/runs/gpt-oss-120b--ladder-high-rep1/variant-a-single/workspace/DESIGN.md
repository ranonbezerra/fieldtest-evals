# DESIGN.md

## Overview

The operations dashboard must serve sub‑second response times while preserving two
strict guarantees:

1. **Read‑your‑own‑writes** – an operator’s change (e.g. approving an order)
   must be visible on the next request without any delay.
2. **Exact per‑company financial totals** – the aggregate amount for a company
   must be absolutely correct even under concurrent updates.

To meet these requirements we introduce a **materialised projection** (`operation_dashboard`)
that mirrors the shape of the dashboard query and a separate aggregate table
(`company_financial_total`). The projection is **maintained synchronously inside
the same database transaction that writes the source tables**. This guarantees
that the projection is always consistent with the source data and eliminates any
visibility lag.

## Why synchronous hooks (inside the write transaction)?

| Alternative | Delay / Staleness | Complexity | Consistency Guarantees |
|-------------|-------------------|------------|------------------------|
| **After‑commit trigger** (e.g. `AFTER INSERT` trigger) | Visible only after the transaction commits; still a tiny window where the operator’s read may not see the change. | Requires DB‑side triggers; harder to test. | Can miss updates if the transaction rolls back. |
| **Background job / queue** | In‑flight updates may take seconds to minutes → violates read‑your‑own‑writes. | Needs durable queue, workers, error handling. | Hard to guarantee exactly‑once semantics. |
| **Read‑replica sync** | Replication lag introduces stale reads. | Additional infrastructure. | No guarantee of immediate visibility. |
| **Synchronous hook (our choice)** | No lag – the projection is updated **before the transaction commits**. | Simple service‑level code, fully testable in unit/integration tests. | Atomicity is guaranteed by the enclosing transaction – if the source write rolls back, the projection change rolls back as well. |

Because the dashboard is read‑only and the projection contains a subset of
columns, the extra storage cost is modest and the performance gain (index‑only
scans) is substantial.

## Concurrency handling for financial totals

Multiple approvals for the same company can occur concurrently. Updating the
aggregate by reading‑modify‑writing a row would cause lost updates. Instead we
use PostgreSQL’s atomic `UPDATE … SET total_amount = total_amount + $delta`
via Prisma’s `increment` operator inside the same transaction. This ensures
that each approval contributes its amount exactly once, regardless of the order
in which concurrent transactions acquire locks.

## Re‑derivation routine

A service method (`rederiveProjection`) can rebuild the projection for any
date window:

* It reads the source `payment_order` rows for the window.
* Deletes existing projection rows for those orders.
* Inserts fresh rows matching the source.
* Re‑computes per‑company totals for the affected companies.

The routine runs inside a transaction per‑order batch, making it safe to execute
while the system is live. Running it twice over the same window is idempotent
because the delete‑then‑insert pattern yields the same final state.

## Drift‑repair job

Even with synchronous hooks, drift can appear due to manual data fixes or
deploy‑time anomalies. A scheduled job (`DriftRepairService`) runs every minute,
examines a recent time window (last 5 minutes), and upserts the projection rows
to match the source. Afterwards it recomputes the affected financial totals.
This “repair‑and‑re‑aggregate” approach restores correctness without affecting
read‑your‑own‑writes because the job only fixes rows that already reflect the
source state.

## Indexing strategy

`operation_dashboard` is queried with the pattern:

```
WHERE company_id = $company AND status = $status
  AND created_at BETWEEN $start AND $end
ORDER BY created_at DESC
LIMIT $pageSize OFFSET $offset
