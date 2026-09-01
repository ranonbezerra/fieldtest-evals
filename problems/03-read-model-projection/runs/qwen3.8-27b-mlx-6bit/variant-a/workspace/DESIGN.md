# Design

## Requirements driving the design

The operations dashboard lists derived rows from payment orders, events, and workers. It must remain fast at roughly three million source orders: p95 under 50 ms, with filters by company, status, and date range, sorted by recency and paginated. Operators must read their own writes immediately after a source write commits — for example, an approval should be visible on the next dashboard request. Per-company financial totals must be exact, not approximate or eventually converging after a visible delay.

## Chosen approach

Use synchronous, application-managed read models maintained in the same database transaction as the source write.

The design keeps payment orders and related reference tables as the system of record. It adds derived read models:

- a per-operation row containing the fields needed by the dashboard, denormalized so the read path does not join payment orders with events and workers;
- a per-company totals row containing exact financial aggregates.

The dashboard query reads only the per-operation read model. The read model is indexed for the dominant access patterns: company plus status plus recency, and company plus recency without a status filter. This turns the expensive multi-table join and sort over millions of rows into an indexed single-table page fetch.

Write services invoke projection maintenance hooks inside the same transaction as their source updates:

- order creation inserts or updates the operation row and increases the company's pending contribution;
- approval or rejection updates the operation row's status and moves the amount between exact total columns while adjusting pending counts.

Because the source change and read-model change commit together, a successful write is immediately visible to the next dashboard query. There is no background propagation window and no cache invalidation step.

The design also includes recovery facilities: a re-derivation routine for an arbitrary date window and a scheduled drift-repair job. These make the system self-healing if a projection row is missing, stale, manually edited, or affected by an unforeseen bug.

## Why synchronous hooks satisfy the requirements

### Fast reads

The dashboard no longer computes a join across payment orders, events, and workers on every request. It reads a narrow, precomputed table whose indexes match the dashboard filters and sort order. Pagination and filtered counts are served from the same read model, which makes the 50 ms p95 target realistic even with millions of source orders.

### Immediate read-your-writes

The projection is updated before the transaction commits. A reader that queries after the commit sees both the source state and the read-model state. This avoids the central weakness of asynchronous pipelines: there is no consumer lag between "the approval was written" and "the approval appears on the dashboard."

### Exact financial totals

Totals are maintained as exact integer values, not floating-point aggregates or approximate counters. The company totals row is updated with atomic row-level operations inside the write transaction. This avoids lost updates when multiple operators approve or reject orders for the same company concurrently. Recovery routines can also recompute affected totals from the corrected read model, so accumulated drift is not allowed to persist.

### Bounded write overhead

Each write performs a small number of indexed row updates: the source row, the operation read-model row, and the company totals row. This is constant per operation and does not grow with table size. The added write latency is modest and is the acceptable cost of making reads fast and consistent.

## Alternatives considered

### Directly optimizing the source query

Adding indexes, covering indexes, or partial indexes can reduce query time, but it does not remove the fundamental shape of the problem: the dashboard filters, sorts, and paginates over millions of source rows while joining reference tables. Financial totals would still require aggregation over large ranges. Optimizations may help, but they make the 50 ms target fragile and do not solve read-your-writes. The projection precomputes the read shape at write time, which is a better fit for the requirement.

### Database triggers or stored procedures

Triggers could provide the same transactional atomcity and would keep projection maintenance very close to the data. They were not chosen because they move business-visible behavior into SQL, making it harder to test in TypeScript, harder to version alongside application code, and harder to reason about during migrations. Application-level hooks keep validation, transaction orchestration, and tests in the same stack while still committing source and projection changes together.

### Change data capture or asynchronous replication

CDC can watch source-table changes and update projections in a consumer. It is attractive for decoupling, replayability, and horizontal scaling, but it introduces an asynchronous pipeline. Even with low-latency connectors, the projection may lag behind the committed source row. That violates the requirement that an approval be visible on the next request unless the API blocks until the consumer has applied the change. Blocking would make write latency depend on external infrastructure and would remove the simple all-or-nothing transactional guarantee.

CDC also increases operational surface: connector health, message ordering, idempotent consumers, backpressure, monitoring, and exactly-once semantics. For this requirement, those costs buy capabilities that re-derivation and drift repair already provide more simply.

### Event sourcing or event-driven projections

Event sourcing would make events the source of truth and build dashboards by consuming or replaying them. If projection processing is asynchronous, it has the same read-your-writes lag as CDC. If it is synchronous inside the same transaction, it is largely equivalent to application-level projection hooks but with much higher complexity: immutable event schemas, event store integration, handler idempotence, snapshots, and migration of existing order workflows.

Since the source tables already provide transactional records and the task is to improve a read path, event sourcing is disproportionate. The design still gets a useful part of that idea — bounded rebuilds through re-derivation and drift repair — without changing the system of record.

### Materialized views

PostgreSQL materialized views can precompute the read shape, but they do not naturally solve immediate read-your-writes. Refreshing a materialized view is a separate operation. Full refresh can take locks; concurrent refresh builds new data and swaps it in, which is expensive if done frequently. Synchronously refreshing the view on every write would create long transactions and lock contention, defeating the performance goal. A schedule leaves a staleness window.

A materialized aggregate for totals might be exact after refresh, but the same staleness applies to operators viewing their just-approved orders. Materialized views are therefore a poor fit for the combination of immediate visibility, exact totals, and low read latency.

### Separate cache or data warehouse

A cache can be fast but must handle invalidation immediately after writes. A warehouse is typically batch-oriented and unsuitable for exact, immediate operational financial totals. Both add infrastructure without providing the simpler transactional guarantee needed here.

## Consistency, concurrency, and recovery

- All-or-nothing writes: the source write and projection maintenance commit or roll back together. A failed projection update cannot leave a visible source row without its read-model counterpart.
- Read-your-writes: after commit, the next query reads the committed projection row. There is no propagation delay and no invalidation event.
- Exact totals: amounts are integral and stored as large integers. Total adjustments use atomic database operations on the company totals row, so concurrent updates for the same company do not lose contributions.
- Safe transitions: order status changes are validated inside the write transaction and guarded so concurrent transitions for the same order cannot both succeed incorrectly.
- Idempotent repair: re-derivation can rebuild a date window from the source tables. Drift repair compares source and projection for a window, upserts missing or stale rows, removes orphans, and recalculates affected totals.
- Bounded drift detection: the scheduled drift-repair job limits how long residual divergence can persist. Manual re-derivation supports larger corrections or backfills.
- Reference data: denormalized event and worker fields are copied when the order row is written. If reference data changes outside the specified write path, the re-derivation and drift-repair routines can refresh affected windows.

## Trade-offs accepted

The main trade-off is coupling the write path to projection maintenance. If a hook has a bug, writes can fail or read models can drift. This is accepted because the requirement prioritizes immediate consistency and exact totals over loose coupling. The risk is mitigated by transactional failure semantics, integration tests for read-your-writes and concurrent totals, drift repair, and window re-derivation.

Write latency increases modestly because each source write also updates a few indexed projection rows. That cost is acceptable relative to removing a 20–30 second dashboard query and meeting the 50 ms read target.

If future write volume makes the synchronous projection too expensive, CDC could be reconsidered, but it would need to preserve the read-your-writes SLA or accept a different consistency contract.

## Conclusion

Synchronous in-transaction projection hooks are the lowest-complexity design that simultaneously provides a fast indexed read model, immediate operator visibility of writes, exact company financial totals, and a practical recovery story. CDC, event sourcing, materialized views, and pure source-query optimization either introduce unacceptable staleness, operational complexity, or refresh costs for the stated requirements.
