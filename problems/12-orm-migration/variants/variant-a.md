# Variant A — Prisma → Drizzle in a working service

The fixture is a working NestJS billing service on Prisma (accounts, invoices,
line items): schema, seeds, and a test suite covering roughly the happy paths
of each endpoint. The team is standardizing on Drizzle.

## The task

Migrate the data layer to Drizzle completely:

1. Schema recreated in Drizzle (same tables/columns/constraints), migrations
   included; Prisma schema, client, and dependency fully removed.
2. Every repository/service query ported; public API contract byte-compatible
   (field presence, null vs missing, numeric string formats — invoices carry
   BigInt amounts serialized as strings today).
3. Transactional behavior preserved: invoice creation writes invoice + line
   items + account counters atomically today; prove it still does (test that
   injects a failure mid-transaction).
4. The suite is intentionally partial. Some behavior callers depend on is NOT
   covered by any test. Part of your job is finding such behavior by reading
   call sites and comparing old vs new outputs, pinning it with new tests, and
   preserving it. Document everything semantic you hit in MIGRATION_NOTES.md.

Green tests alone do not mean done — the judging includes behaviors the suite
never mentions.
