# Design: Synchronous read-model maintenance

## Problem

The operations dashboard lists a join of payment orders, events, and workers for a
company, filtered by status and date range, sorted by recency, and paginated. At the
current scale, reading that join directly from the source tables is too slow to meet
the target p95. The replacement read path must preserve what operators see, make an
operator's own write visible on the next request, and keep per-company financial
totals exact.

## Decision

Use a denormalized projection table maintained by synchronous application hooks in
the same database transaction as the source write. The write service performs its
source mutation and then updates the projection row for that order before commit.
The dashboard reads only from the projection, using indexes designed for the
dashboard filter and sort shape.

This makes the projection a read model, not a cache: it stores the fields needed by
the dashboard and is rebuilt or repaired from source when divergence is detected.

## Why synchronous hooks

Synchronous in-transaction maintenance directly satisfies the strongest requirement:
read-your-own-writes. When an operator approves or updates an order, the source row
and the projection row commit together. There is no window in which the write has
committed but the dashboard has not yet seen it.

It also keeps financial totals exact. The projection stores money as integer cents,
and company totals are computed from committed projection rows using exact integer
sums. No approximate aggregate, sampled count, or eventually consistent counter is
needed.

The write-path cost is deliberately small: one row upsert or delete keyed by the
order identifier. That is much cheaper than making every dashboard request perform a
large multi-table join, and it avoids adding queue infrastructure for a freshness
requirement that must be immediate.

Concurrency is straightforward because each order maps to exactly one projection row.
Concurrent writes for different orders in the same company touch disjoint rows and
commit independently. Concurrent writes for the same order converge through the
unique projection key, with the later committed write determining the final row.
Company totals are not maintained as mutable cached counters; they are derived at
read time from the committed rows, so they cannot drift because of a stale aggregate.

The approach is also easier to evolve and test than hidden database-side logic. The
maintenance code lives in the application layer, uses the same TypeScript types as
the rest of the service, participates in the existing error contract, and can be
tested by simulating the write path and asserting on the committed read model.

## Alternatives considered

### Database triggers

Database triggers could update the projection automatically whenever source rows
change. That was rejected because it moves read-model logic into SQL where it is
harder to type, validate, test, and debug. It also couples the source schema to a
specific dashboard need: if the projection shape changes, the trigger must change,
and that change is less visible in application code review.

Triggers can provide atomicity, but the application already has the same transaction
boundary available. Using the application hook keeps the write service responsible
for both the source change and the read-model effect, while still committing them
atomically.

### Async queue, outbox, or CDC

An asynchronous approach would publish a change event after the source write and let
a consumer update the projection later. That introduces eventual consistency, which
conflicts with the requirement that an operator's write appears on the next request.

It also adds operational complexity: message durability, retries, ordering,
duplicates, backpressure, dead-letter handling, and reconciliation. A transactional
outbox or CDC pipeline can make the path durable, but it still adds latency and more
moving parts. For this workload, the synchronous row-level update is simpler and
meets the freshness requirement without that infrastructure.

### Materialized view or scheduled refresh only

A materialized view or purely scheduled rebuild would not provide immediate
visibility of individual writes. Full refreshes are expensive at this scale, and
partial refreshes still leave a freshness gap. Scheduled re-derivation is therefore
used here only as a repair mechanism, not as the primary consistency model.

### Querying source tables directly with better indexes

Improving source-table indexes could reduce read latency, but the dashboard still
requires a multi-table join over millions of rows. That keeps the read path coupled
to source schema changes and makes it harder to guarantee a stable p95. The projection
isolates the dashboard from source-table growth and lets the read query use a narrow,
purpose-built index.

## Consistency model

The primary consistency guarantee comes from synchronous maintenance in the write
transaction. The re-derivation routine and scheduled drift-repair job are secondary
safety mechanisms.

Re-derivation works over an arbitrary date window: it replaces the projection rows
for that window with rows derived from the source tables. It is idempotent, so
running it repeatedly over the same window converges to the same result. The
scheduled drift-repair job uses that routine over a sliding window behind current
time, avoiding interference with the most recent writes while still detecting and
correcting divergence caused by bugs, missed maintenance, or historical data issues.

This separation keeps the normal path simple and fast while still providing a
recovery path for cases where the projection no longer matches source.

## Performance rationale

The dashboard query no longer joins the large source tables. It filters and sorts a
single projection table using an index aligned with company, status, recency, and a
stable tie-breaker. Pagination can therefore be served with a bounded row scan plus a
count, which is the main change needed to reach the p95 target.

The write path pays for one additional indexed projection update per source mutation.
That is an acceptable trade-off because the dashboard read path is the performance
bottleneck, and immediate visibility of writes is a hard requirement.

## Exact financial totals

Money is represented as integer cents throughout the projection. Company totals are
computed by summing those integer values over committed rows, so they are exact and
deterministic. The design avoids floats for financial amounts and avoids approximate
aggregation primitives.

Because totals are derived at read time from the projection rows, they remain correct
even when many writes for one company occur concurrently. The projection rows are
updated atomically, and the total is always a fresh sum of what has committed.

## Boundary and trade-off

The write transaction contains only the source mutation and the corresponding
projection update. It does not read the dashboard projection for display, perform
cross-company aggregation, or make external calls. Keeping that transaction narrow
preserves both atomicity and write-path performance.

The accepted trade-off is a small amount of additional write-path work in exchange
for a much faster dashboard, immediate operator visibility of writes, and exact
company-level financial totals.
