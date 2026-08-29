# Variant A — Marketplace operations dashboard

A marketplace back-office lists "operations" (a join of payment orders, events,
and workers) filtered by company, status, and date range, sorted by recency,
paginated. With ~3M orders the query takes 20–30s. Target: p95 under 50ms without
changing what operators see. Operators must see their own writes immediately
(approve an order → it reflects on the next request), and the financial totals
per company must be exact, not approximate.

Build in **TypeScript + NestJS + Prisma + Postgres**: projection table(s) + DDL
with appropriate indexes; maintenance hooks invoked by the write services
(simulate the write path); a re-derivation routine for an arbitrary date window;
a scheduled drift-repair job; the new dashboard query; tests for
read-your-own-writes, concurrent updates to one company's totals, and drift
repair. Include a short DESIGN.md justifying sync-hooks vs alternatives.
