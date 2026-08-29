# 03 — Read-model projection for a slow dashboard

## The real situation

A production operations dashboard aggregated payment orders, events, and worker
data across several joined tables. As the platform grew, the main listing query
degraded to 20–30 seconds. The redesign target was sub-50ms, achieved with a
classic pattern executed carefully:

- Two **projection tables** (a row-level projection of operations and a per-company
  summary), partitioned, with covering indexes (`INCLUDE`) so the hot query never
  touches the source tables.
- Projections maintained by **synchronous in-transaction hooks** on every write to
  the source entities — not an event bus. Same transaction = projection can never
  be observed out of sync with the write that caused it.
- A **safety net for drift**: a 1-minute repair job plus a daily reconciliation
  that re-derives the last 7 days from the source of truth. Hooks are the fast
  path; re-derivation is the guarantee.

The trap for a model here is stopping at "add a materialized view" or "cache it in
Redis". Those answers ignore the real requirements: read-your-own-writes for
operators, exact consistency for financial numbers, and a rebuild story when the
projection logic itself changes.

## Stack

TypeScript, NestJS, Prisma, PostgreSQL (raw SQL allowed and expected for DDL and
the hot query).
