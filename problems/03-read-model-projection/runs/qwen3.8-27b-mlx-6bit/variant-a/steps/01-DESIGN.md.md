# 01-DESIGN.md

## reasoning

```
The task asks me to write exactly one file: `DESIGN.md`. It should justify sync-hooks over CDC/messaging/materialised-view alternatives, based on the plan provided.

Let me look at what the plan says about DESIGN.md:
- From the manifest: `DESIGN.md | reads: - | Justifies sync-hooks over CDC/messaging/materialised-view alternatives`
- From the variant description: "Include a short DESIGN.md justifying sync-hooks vs alternatives."

I need to write a concise design document that:
1. States the chosen approach (sync hooks / synchronous maintenance within the same transaction)
2. Justifies why this was chosen over:
   - CDC (Change Data Capture, e.g., Debezium, logical replication)
   - Messaging / async event-driven (e.g., RabbitMQ, Kafka, outbox pattern)
   - Materialised views (Postgres `CREATE MATERIALIZED VIEW ... REFRESH`)

The justification should align with the requirements:
- p95 under 50ms (the projection read is a simple indexed SELECT)
- Read-your-own-writes: approve an order → it reflects on the next request (synchronous hook guarantees this; async would have a lag)
- Financial totals must be exact, not approximate (synchronous update in the same transaction guarantees consistency; async could have a window of inconsistency)
- ~3M orders, current query takes 20-30s (projection table is small and indexed)

Let me structure this:

1. **Chosen approach**: Synchronous maintenance hooks (same-transaction upsert)
2. **Requirements that drove the choice**
3. **Alternatives considered**:
   - CDC (logical replication / Debezium)
   - Async messaging (outbox + consumer)
   - Postgres materialised view with REFRESH
4. **Why each alternative was rejected**
5. **Trade-offs accepted**

Let me write this concisely but completely. The variant says "short DESIGN.md". I'll keep it focused.

Let me think about the structure:

- Title
- Chosen design (1 paragraph)
- Requirements recap (bullets)
- Why sync hooks satisfy them
- Alternatives considered and rejected (each with a short paragraph)
  - CDC
  - Async messaging / outbox
  - Materialised view REFRESH
- Trade-offs we accept

This should be a complete, self-contained document. Let me write it now.
```

## reply

```markdown
# Design: Operations Dashboard Read Model

## Chosen approach — synchronous maintenance hooks

Every write to a `payment_orders` row (via the `simulateWrite` path) performs,
**inside the same interactive transaction**, three writes:

1. Upsert the source row (`payment_orders`).
2. Upsert the denormalised projection row (`operations`).
3. Apply a delta to the exact aggregate (`company_financial_totals`).

The dashboard read is a single indexed `SELECT` against the projection table.
No join, no sub-query over 3 M rows.

## Requirements that drove the choice

| Requirement | Implication |
|---|---|
| p95 < 50 ms on a 3 M-row table | Read path must hit a small, indexed projection; no runtime join. |
| Read-your-own-writes (approve → visible on next request) | The projection row must be **committed before** the write response returns. |
| Financial totals per company must be **exact** | No eventual-consistency window; the aggregate must reflect every committed write. |
| Operational simplicity (single Postgres instance, no extra brokers) | Prefer in-DB mechanisms; avoid a second moving part that can partition from the primary. |

All three data-consistency requirements point to the same conclusion: the
projection update must be **atomically coupled** to the source write. A single
transaction gives that guarantee for free; every async alternative introduces a
window in which the projection is stale.

## Alternatives considered and rejected

### 1. CDC (Change Data Capture — logical replication / Debezium)

A separate consumer watches the Postgres WAL, parses `INSERT`/`UPDATE` events on
`payment_orders`, and applies them to the projection.

**Why rejected:**

- **Read-your-own-writes gap.** WAL events are delivered asynchronously; the
  consumer lags by milliseconds to seconds under load. An operator who approves
  an order and immediately re-queries the dashboard would see the stale status.
  The requirement explicitly forbids this.
- **Exactness of totals.** A counter or SUM maintained by the consumer can miss
  or double-apply events if the consumer restarts mid-stream. Reconciling the
  exact running total requires a separate repair loop, which is precisely the
  drift-repair job we already ship as a safety net — making it the *primary*
  correctness mechanism is too risky.
- **Operational surface.** Logical replication slots, a consumer service, an
  offset store, and monitoring for slot lag add a second deployment unit and a
  new class of failure (slot falls behind, WAL is not vacuumed).

### 2. Async messaging / outbox pattern

The write service inserts into an `outbox` table in the same transaction; a
poller or trigger emits events to a broker (RabbitMQ, Kafka, Redis Streams); a
consumer applies them to the projection.

**Why rejected:**

- Same read-your-own-writes gap as CDC: the consumer is a separate process with
  its own latency and at-least-once semantics.
- **At-least-once delivery** means the consumer can see the same event twice.
  Idempotent upserts mitigate this for the projection row, but the totals delta
  must be exactly-once; turning it into a recompute-on-each-event erodes the
  "apply a small delta" performance benefit.
- Introduces a **broker** as a hard dependency. If the broker is unreachable,
  writes either block (defeating the purpose of async) or fail, and the outbox
  table grows unboundedly until the broker recovers.
- More moving parts, more code paths to test, for no gain over the in-transaction
  approach given our write volume (back-office operations, not C10K fan-out).

### 3. Postgres materialised view with `REFRESH MATERIALIZED VIEW`

Define the join as a materialised view and refresh it on a schedule (cron,
pg_cron) or after each write.

**Why rejected:**

- **`REFRESH` is globally exclusive.** In Postgres 15 and earlier, `REFRESH
  MATERIALIZED VIEW` acquires an `ACCESS EXCLUSIVE` lock on the target table,
  blocking all reads for the duration of the refresh. Even with `CONCURRENTLY`
  (PG 15+), the refresh takes a full scan of the source, which at 3 M rows is
  seconds — incompatible with a 50 ms p95 read path if a refresh overlaps.
- **Per-write refresh is infeasible.** Refreshing after every single write
  serialises all writers and costs a full re-scan. Refreshing on a schedule
  reintroduces the stale-read window.
- **Cannot maintain a separate exact aggregate table.** A materialised view is
  one relation; our design needs both the per-order projection and the per-company
  totals. We would need two views and two refreshes, doubling the lock surface.

## Trade-offs accepted by the sync-hook design

- **Write latency increases** by two extra `UPSERT`s in the same transaction.
  In practice these are single-row, indexed writes (< 1 ms each on local NVMe),
  negligible against the ~5–20 ms a typical order write already takes.
- **Coupling.** The projection schema and the write path live in the same
  module. Adding a column to the projection requires a coordinated code change,
  not a config tweak on a consumer. This is an acceptable constraint for a
  back-office tool with a small team.
- **No automatic replay of historical data.** If the projection is corrupted or
  a column is added later, there is no WAL log to re-read. We compensate with
  the **re-derivation routine** (`POST /operations/re-derive`), which rebuilds
  any arbitrary date window from the source tables, and the **scheduled
  drift-repair job** (every 5 minutes) that detects and fixes rows where the
  source `updated_at` is newer than the projection's.
- **If the transaction fails mid-way**, both the source write and the projection
  write roll back together. The operator retries; no partial state is visible.

## Summary

The three hard requirements — sub-50 ms reads, immediate visibility of one's own
writes, and exact per-company totals — are all met by updating the projection
and the aggregate **in the same transaction as the source write**. The cost is
two extra single-row upserts per write, which is trivially cheap at back-office
volume. The alternatives (CDC, async messaging, materialised views) each relax
at least one of the three requirements or add significant operational complexity
without a proportional benefit at our scale.
```
