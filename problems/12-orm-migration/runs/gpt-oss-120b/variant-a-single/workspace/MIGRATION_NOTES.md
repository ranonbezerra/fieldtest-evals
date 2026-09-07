# Migration Notes – Prisma → Drizzle

## Schema migration
- Re‑created the three tables (`accounts`, `invoices`, `invoice_line_items`) in
  `src/db/schema.ts` using Drizzle’s `pgTable` definitions.
- Added explicit column names to match the original Prisma `@map` annotations.
- Created primary keys, foreign keys, unique constraints, and indexes mirroring the
  Prisma schema.
- `initDb()` in `src/db/client.ts` creates the same tables in an in‑memory SQLite
  database used by the test suite.

## Data‑access layer
- `BillingRepository` now depends on a Drizzle `DB` instance instead of a Prisma
  client.
- All queries are expressed with Drizzle’s fluent API (`select`, `where`,
  `insert`, `update`, `transaction`).
- Transactional creation of an invoice (`createInvoice`) uses `db.transaction` and
  the SQL helper `sql` to atomically increment `accounts.invoice_count`.
- Types for rows (`AccountRow`, `InvoiceRow`, `LineItemRow`) are re‑exported from
  `src/db/client.ts` to keep the public contract unchanged.

## Public API contract
- The service layer (`BillingService`) continues to return the same shape.
- Serialization of `bigint` fields is unchanged because `serialize()` (global
  serializer) still converts `bigint` → string.
- No field has been added, removed, or changed from nullable to required.

## Transaction integrity test
- Added `test/billing.transaction.spec.ts` which intentionally triggers a
  primary‑key violation during line‑item insertion.
- The test asserts that the surrounding account’s `invoiceCount` remains
  unchanged, proving the transaction rolls back correctly.

## Removed Prisma artifacts
- Deleted `prisma/schema.prisma` and the `@prisma/client` dependency from
  `package.json`.
- The only remaining Prisma‑related file is `src/billing/prisma.ts`, which now only
  contains type definitions (no client logic) and is kept solely for compatibility
  with existing import statements.

## Assumptions & Decisions
- The original code never called any Prisma‑specific APIs beyond the generic
  CRUD methods used here; therefore the Drizzle‑based implementation can fully
  replace it.
- Tests run against an in‑memory SQLite DB; this matches the original behaviour
  of the fake Prisma client while providing real transactional guarantees.
- No other parts of the application reference the Prisma client, so removal is safe.
