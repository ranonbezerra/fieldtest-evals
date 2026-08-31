# 01-DESIGN.md

## reasoning

```
We need answer user's request: write exactly one file DESIGN.md, complete content in one fenced block, nothing else. Need analyze in English (user request English). Need produce DESIGN.md justifying sync hooks vs alternatives, based on PLAN.md and variant. Need not reproduce references. Need likely include no code? Prose justification. Must implement exactly what plan specifies for this file: "prose justification of sync maintenance hooks vs triggers/async queues". Need not add features/files. Need maybe mention assumptions if unresolved? We have enough. Need ensure markdown complete first line to last. One fenced block only. No explanation.

Need think about content. DESIGN.md should be short? Plan says "short prose doc justifying sync maintenance hooks over triggers/async queues; it is not code and has no imports." Manifest: DESIGN.md | reads: - | prose justification of sync maintenance hooks vs triggers/async queues. Need maybe structure:
# Design: Synchronous read-model maintenance
## Requirements driving design
- read-your-own-writes immediate after approve order next request
- exact financial totals per company, no approximate
- p95 under 50ms dashboard, 3M orders
- operations are join of payment_orders/events/workers filtered by company/status/date, sorted recency, paginated
## Chosen approach: synchronous in-transaction maintenance hooks
- write service calls OperationReadModelService.upsertOperation/deleteOperation within same Prisma transaction as source mutation
- projection row committed atomically with source change; next read sees it
- single-row upsert keyed by order_id, independent concurrent updates, exact totals via SUM bigint at read time
- re-derivation and drift repair handle divergence/missed maintenance; not primary correctness path but safety net
## Why not DB triggers
- triggers couple read-model maintenance to schema, harder to test in app layer, language constraints, transaction semantics maybe but less portable; Prisma/app can control validation and error mapping; triggers make deployment migrations more complex; can't easily share TypeScript types/validation; debugging harder. However triggers could be alternative but rejected because maintenance logic belongs in app, easier to evolve with dashboard needs, and tests can simulate write path.
## Why not async queues / outbox / CDC
- eventual consistency violates read-your-own-writes; operator approves order and next request must reflect. Queue latency/retry/backlog unacceptable for financial exactness? Eventual counts maybe but exact totals require committed projection; async can lose/duplicate unless transactional outbox, adds complexity and still latency. For a back-office dashboard where freshness matters, sync hook is simpler and meets p95 because write path adds one indexed upsert, not query heavy.
## Why not materialized views / async refresh
- Postgres matview refresh is expensive and not row-level immediate; can't read-your-own-writes; partial refresh maybe but still maintenance complexity.
## Why not query source directly with indexes
- 3M orders join is slow; projection pre-denormalizes and indexes for dashboard. Need exact totals, projection stores bigint amount_cents; SUM exact.
## Failure modes and repair
- If write service crashes after source commit? Not possible if same transaction. If bug/missed hook or legacy data, rederiveWindow and scheduled drift repair restore. Drift repair sliding window with safety margin avoids interfering with active writes; idempotent.
## Performance
- dashboard reads only projection with composite index (company_id,status,occurred_at DESC,id DESC), count; p95 target.
## Exactness
- integer cents, no floats; totals computed from committed rows; concurrent upserts disjoint; same order last write wins.
## Boundaries
- write transaction includes source mutation + projection upsert/remove only; no display reads or external calls.
Maybe include "Alternatives considered" table? Prose okay. Need not too long? "short" but desired oververbosity 9; but task says short. We can be concise but thorough. Need no code? Plan says not code and no imports. Could include endpoint? Maybe avoid code blocks? It's prose, but markdown headings okay. No imports. Could include small bullet list. Need ensure not restating plan? It can refer to components. But should not rewrite references. We can write original.

Need consider if any symbol absent? No.

Need output one fenced block: ```markdown ... ```? They say complete content of DESIGN.md inside one fenced block. Usually use ```markdown. Nothing else. Need ensure no trailing explanation.

Potential issue: They say "Never a fragment, never an 'unchanged' comment, never a diff." Fine.

Need maybe include "ASSUMPTION" comment if unresolved. We don't need. But if we mention source tables pre-existing? That's from plan. Fine.

Need ensure file is DESIGN.md, not code. Could start `# Design: Synchronous read-model maintenance`.

Need maybe justify "sync hooks vs alternatives" explicitly. Include sections:
- Decision
- Requirements
- Chosen design
- Alternatives considered
  - Database triggers
  - Async queue / outbox / CDC
  - Materialized view / scheduled refresh only
  - Querying source tables directly
- Consistency and exactness
- Performance
- Failure recovery
- Operational trade-offs

Need be careful: "maintenance hooks invoked by write services (simulate write path)" The design should say app-level service calls in same transaction. "sync-hooks" maybe means write services call projection maintenance synchronously.

Need mention Prisma transaction: same transaction, no separate transaction. If source and projection in one Postgres DB, atomic commit. If different DB? Plan assumes same. Could mention "because source and projection share the database, a single Prisma transaction can commit both." If not, would need outbox, but plan assumes.

Need not add export/feature/file. It's doc only.

Let's craft polished.

Potential nuance: Financial totals exact not approximate. Async queues can be exact if eventually consistent but immediate? The requirement says operators must see own writes immediately, so async fails. Exact totals not approximate is about not using HLL/approx count; we use bigint sum.

Potential nuance: p95 under 50ms. Sync hook adds write latency, but acceptable? Need justify: one row upsert on unique key is cheap relative to 20-30s read; write path not p95 dashboard. It improves reads dramatically.

Potential nuance: concurrent updates to one company's totals: no cached counter, sum at read. Row-level upserts avoid lost updates. If two updates same order, last write wins due to unique key; maybe use upsert set all fields. Could mention.

Potential nuance: drift repair scheduled job is not replacing sync hooks; it's safety net for missed/buggy maintenance, backfills. It uses re-derivation window.

Need maybe mention "not changing what operators see": projection preserves same fields/status/date semantics; endpoint unchanged. But doc can mention.

Need avoid too much code-like signatures. Prose only.

Let's draft:

# Design: Synchronous read-model maintenance

## Problem
... The dashboard currently joins large source tables... 20-30s. Need p95 <50ms, immediate visibility of writes, exact financial totals.

## Decision
Use a denormalized projection table maintained by synchronous application hooks in the same database transaction as source writes. The write service changes payment order and calls projection maintenance before commit. A dashboard reads only projection.

## Why synchronous hooks
- Read-your-own-writes: atomic commit... no gap between source and projection.
- Exact totals: projection stores amount_cents as bigint; totals are SUM over committed rows; no approximate or stale counter.
- Simplicity: one extra indexed upsert/delete per write; no queue, consumer, backpressure, dead-letter, idempotency store, or replay infrastructure.
- Testability: write path can be simulated by invoking same maintenance service; tests assert committed projection state.
- Evolution: dashboard fields can change in TypeScript with validation and error envelope; not hidden in SQL trigger.
- Concurrency: each order has one projection row keyed by order_id; concurrent company writes touch different rows; same-order writes converge via upsert.

## Alternatives
### Database triggers
Could maintain projection automatically, but... rejected because: logic in SQL harder to maintain/test; couples schema to app requirements; Prisma/app transaction can already provide atomicity; triggers make error handling and typed validation awkward; migration complexity; debugging. If trigger fails, harder to reason.

### Async queue / outbox / CDC
Eventual consistency. Operator approval would not necessarily appear on next request. Queue latency, retries, duplicates/backlogs; requires transactional outbox or CDC for durability; more moving parts. Exact totals would still need reconciliation. For back-office freshness, sync is simpler and sufficient because maintenance cost is one row.

### Materialized view or scheduled refresh only
Refreshes are batch and not immediate; full refresh expensive; partial refresh may miss recent writes. Scheduled drift repair is only safety net, not primary.

### Query source directly with better indexes
May reduce time but 3M-row join across orders/events/workers still likely misses p95 and couples dashboard to source schema. Projection isolates read model.

## Consistency model
Primary consistency: synchronous same-transaction maintenance. Secondary: re-derivation for arbitrary date window and scheduled drift repair over sliding window with safety margin. Re-derivation deletes/inserts rows for window in one transaction, idempotent; converges after missed/incorrect maintenance. It does not weaken read-your-own-writes because live writes still update projection synchronously; repair only catches divergence.

## Performance
Dashboard uses composite index for company/status/occurred_at/id and count; no joins to source. Write path adds single-row upsert/remove, acceptable.

## Exact financial totals
All money as integer cents; totals computed from committed projection rows; no floats, no approximate aggregates. Concurrent updates do not corrupt because row-level atomic upserts and fresh sum at read.

## Boundaries / trade-offs
Write transaction contains source mutation and projection maintenance only; no display reads or external calls. If future writes span multiple databases, sync hook would need outbox; not in current scope. The design accepts slightly higher write latency for much faster dashboard and immediate consistency.

Need maybe "short" but this is okay. Could be too long? Fine. Need ensure no code block? It's markdown, not code. We can use headings. The final must be inside one fenced block. Could use ```markdown. Ensure no extra text.

Double-check instructions: "Write exactly one file: DESIGN.md" "This file: prose justification of sync maintenance hooks vs triggers/async queues" "Implement exactly what the plan specifies for this file. Do not add an export, a feature or a file the plan does not name." Doc can mention features in plan. "Files shown read-only are references. Rely on them; never restate or rewrite them." We are not restating, just using. "If a symbol you need is genuinely absent... mark with // ASSUMPTION". Not needed.

Need maybe not include "manifest" or code. Good.

Potential hidden requirement: The file should be "short". Maybe we can trim to ~800 words? Current maybe 750. Good.

Need think if "sync maintenance hooks" could be interpreted as "maintenance hooks invoked by write services (simulate the write path)" not necessarily same transaction? Plan says same Prisma transaction. Good.

Need maybe mention "without changing what operators see": The projection mirrors the fields/status/date used by dashboard, so response shape and semantics unchanged. Add in problem or decision.

Need maybe mention "scheduled drift-repair job" as secondary. Good.

Need final only fenced block. Ensure no analysis outside. final with ```markdown ... ```.

Let's ensure line first is # Design... Last line maybe period. No trailing spaces.

One more nuance: "Do not add an export, a feature or a file the plan does not name." In doc, mentioning "outbox" as alternative is okay? It's justification vs alternatives. It doesn't add feature. Mentioning "multiple databases" maybe outside scope? Could be okay but maybe avoid adding hypothetical. Keep to plan.

Need maybe not say "Prisma/app transaction can already provide atomicity" if source tables pre-existing and owned by write services; but plan says same transaction. Good.

Let's produce final.
```

## reply

```markdown
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
```
