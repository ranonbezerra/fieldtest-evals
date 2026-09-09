# Issue #501 — Operations dashboard takes 20–30s and operators cannot see their own writes

**Repo:** `marketplace-backoffice` · **Labels:** `performance` `blocker`
**Reported by:** operations · **Diagnosed by:** platform

---

## What is happening

The operations list joins payment orders, events and workers, filters by company,
status and date range, sorts by recency and paginates. At ~3M orders it takes 20–30
seconds. Operators have started keeping the tab open and refreshing rather than
navigating, which makes it worse.

Target is **p95 under 50 ms with no change to what an operator sees**. Same columns,
same filters, same ordering, same page sizes.

Two constraints make the obvious fixes wrong:

- **Operators must see their own writes.** Approve an order, and the next request
  shows it approved. Any design where the list is refreshed on a schedule fails
  this, however short the schedule.
- **The per-company financial totals must be exact.** Not eventually exact, not
  approximate, not sampled. Finance reconciles against them.

## What we need

A projection — a table shaped like the query, maintained as the source changes —
rather than a faster join.

### 1. The projection is updated in the writer's transaction

The read-your-own-writes requirement is the whole design constraint. A hook that
fires after the write commits, a queue, a trigger on a replica, a job on a short
interval: each of these has a window in which the operator's own change is not
visible, and the requirement does not allow one.

So the maintenance hooks are called by the write services and run **inside the
transaction that writes the source row**. If the write rolls back, the projection
never saw it. Simulate the write path so this is exercisable.

### 2. Concurrent updates to one company's totals must be exact

Two orders approved at once for the same company both move the same totals row. A
read-modify-write of that row loses one of them. Make the update atomic at the
database — an in-place increment, or a lock held for the duration — and prove it with
a test that runs the two concurrently rather than in sequence.

### 3. Re-derivation for an arbitrary window

A routine that rebuilds the projection for a date range from the source tables. This
is what makes the projection recoverable rather than precious: if it is wrong, we
rebuild it. It must be safe to run while the system is live, and running it twice
over the same window must leave the same result.

### 4. A scheduled drift-repair job

Periodically compare projection against source for a recent window and repair what
disagrees. Drift will happen — a deploy mid-transaction, a manual data fix — and the
system needs to notice without a person noticing first.

### 5. The dashboard query reads only the projection

No join back to the source tables in the hot path. Index it for the actual access
pattern: filter by company and status, ordered by recency, paginated. A covering
index that matches the filter and the sort is the point of doing this at all.

## Acceptance

- Approve an order → the next dashboard request reflects it, with no delay
- Two concurrent approvals for one company → totals exact, neither lost
- Re-derive a window → projection matches source; run it twice → same result
- Drift injected into the projection → the repair job finds and fixes it
- The dashboard query touches the projection only

## Deliverables

Projection table(s) and DDL with indexes · maintenance hooks invoked by the write
services · re-derivation routine · scheduled drift-repair job · the new dashboard
query · tests for read-your-own-writes, concurrent totals, and drift repair ·
`DESIGN.md` justifying synchronous hooks against the alternatives you rejected.

## Notes

Stack is fixed: TypeScript, NestJS, Prisma, PostgreSQL.
