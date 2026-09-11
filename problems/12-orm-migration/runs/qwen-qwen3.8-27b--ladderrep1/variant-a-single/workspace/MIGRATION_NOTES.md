# MIGRATION_NOTES — Prisma → Drizzle (issue #370)

## What changed

**Removed**
- `prisma/schema.prisma` (file deleted; the directory now holds only the seed)
- `@prisma/client` and `prisma` from `package.json` (dependency and devDependency)
- `mapPrismaError` from `src/common/errors.ts` — replaced by `mapDbError`, which reads
  the Postgres SQLSTATE instead of Prisma's P-codes
- `src/billing/prisma.ts` as a Prisma-client stand-in — it is now a type-only shim (below)

**Added**
- `src/billing/schema.ts` — Drizzle schema, one-to-one with the old Prisma models
- `drizzle/0000_init.sql` + `drizzle/meta/_journal.json` — the migration
- `drizzle.config.ts` — drizzle-kit config (`DATABASE_URL` is the only config source)
- `src/billing/billing-store.ts` — the data-access contract (`BillingStore`) + row types
- `src/billing/drizzle-store.ts` — `DrizzleBillingStore`, the Drizzle implementation
- `src/billing/db.ts` — production wiring (Drizzle DB from a connection string)
- `test/migration.spec.ts` — new tests pinning behaviour the original suite never asserted

**Unchanged on purpose**
- `test/billing.spec.ts` — byte-identical, passes unmodified against the new layer
- `src/common/serializer.ts` — the BigInt→string / Date→ISO wire format is untouched
- `prisma/seed.ts` — data only (no Prisma code); its path is pinned by the untouchable
  suite's import

The fixture ships no Nest wiring (plain classes, plain constructor injection), so none
was added; the layering (service → repository → data layer) is preserved as-is.

## Why the repository keeps its old method shape (the seam)

The untouchable suite builds `new BillingRepository(fakePrisma())` where the fake is a
Prisma-shaped in-memory object (`account.findUnique`, `invoice.createMany`,
`$transaction`, …). Because the suite may not be edited, `BillingRepository` depends on
a local contract — `BillingStore` in `src/billing/billing-store.ts` — whose shape is
pinned by that fake. In production the contract is implemented by `DrizzleBillingStore`,
which runs real Drizzle queries against Postgres. The method names (findUnique,
findMany, createMany, `$transaction`) are the pinned shape, not a Prisma dependency: no
Prisma import, client, generated artifact or error-mapping code remains anywhere.

## Semantics found by reading call sites (the gaps the suite never covered)

For each: what the behaviour is, how it was found, how the Drizzle port preserves it,
and the test that pins it (all in `test/migration.spec.ts`).

1. **Line items come back in storage (insertion) order, not position order.**
   - What: `getInvoice` returns line items in whatever order the DB returns. The seed
     deliberately inserts positions 3, 1, 2, and the API returns them as 3, 1, 2.
   - Found: the seed comment "Inserted out of positional order on purpose", the absence
     of any orderBy in the old repository, and no ordering assertion in the suite.
   - Preserved: the Drizzle `findMany` has no ORDER BY, so Postgres returns the same
     storage order.
   - Pinned: "returns line items in storage order (3, 1, 2), not position order".
   - Note: arguably a latent bug, but "fixing" it would change the wire for every
     consumer. That is a product decision, not part of this migration.

2. **Invoice lists come back in storage order too.**
   - What: `listForAccount` has no ordering; rows return in insertion order.
   - Found: no orderBy in `listInvoices`; the suite asserts only the length.
   - Preserved: no ORDER BY in the Drizzle query.
   - Pinned: "lists invoices in storage order for the account".

3. **`issuedAt` is present with a null value on an unissued invoice (null, not missing).**
   - What: the view key `issuedAt` exists and serializes to `"issuedAt": null`.
   - Found: the Prisma column is nullable, the serializer keeps null-valued keys, and the
     suite never checked the key's presence.
   - Preserved: the Drizzle column is nullable (`Date | null`); the serializer is
     untouched.
   - Pinned: "keeps issuedAt present with a null value on an unissued invoice".

4. **BigInt money fields serialize as decimal strings, including values past
   Number.MAX_SAFE_INTEGER.**
   - What: `totalMinor`/`unitPriceMinor` are bigint; the global serializer ships them as
     strings. The seed carries `9007199254740993n` (> 2^53−1), which any numeric
     round-trip would silently corrupt.
   - Found: the serializer comment "money fields ship as decimal STRINGS" and the seed
     comment "deliberately past Number.MAX_SAFE_INTEGER".
   - Preserved: the Drizzle columns are `bigint({ mode: 'bigint' })`, so they surface as
     JS bigint and flow into the same string serializer. A default (number) mode would
     have broken this.
   - Pinned: "serializes BigInt money fields as decimal strings, even past
     Number.MAX_SAFE_INTEGER".

5. **`listForAccount` returns `[]` for a nonexistent account (not a 404).**
   - What: the dashboard calls this before the account row exists for freshly provisioned
     tenants; a missing account means an empty list.
   - Found: the service comment; the suite only covered an existing account with zero
     invoices.
   - Preserved: the service logic is unchanged (`findAccount` → null → `[]`).
   - Pinned: "returns an empty list for a nonexistent account".

6. **`issue()` on a missing invoice is a 404 `invoice_not_found` (was Prisma P2025).**
   - What: Prisma's `update` threw P2025 when it matched no row; the old mapper turned
     that into `NotFoundError('invoice_not_found')`.
   - Found: the P2025 branch of `mapPrismaError`; the suite never exercised the path.
   - Preserved: Drizzle's update resolves with no row instead of throwing, so
     `DrizzleBillingStore.invoice.update` throws `RowNotFoundError`, which `mapDbError`
     converts to `NotFoundError('invoice_not_found')`.
   - Pinned: "issue() on a missing invoice throws invoice_not_found".

7. **A duplicate invoice number is a 409 `invoice_number_taken` (was Prisma P2002) at the
   service boundary; at the repository boundary the raw DB error propagates, as before.**
   - What: the old mapper converted P2002 → `ConflictError('invoice_number_taken')` in
     `issue()`; `createInvoice` never mapped its errors and let the raw Prisma error
     propagate.
   - Found: the P2002 branch of `mapPrismaError` plus the fact that only `issue` is
     wrapped by the service.
   - Preserved: `mapDbError` converts SQLSTATE 23505 →
     `ConflictError('invoice_number_taken')`; `createInvoice` still propagates the raw
     DB error (now carrying 23505).
   - Pinned: "propagates the unique violation (23505, was P2002) for a taken number".

8. **`createInvoice` is one atomic unit (invoice + line items + account counter).**
   - What: a single transaction writes all three; the counter bump is an SQL-level
     `invoice_count = invoice_count + 1` (no read-modify-write race).
   - Found: the `$transaction` block in the old repository; the suite never exercised
     `createInvoice` at all.
   - Preserved: `DrizzleBillingStore.$transaction` maps to drizzle's `db.transaction`;
     the increment is a `sql` template, not a JS-side re-read.
   - Pinned: the atomicity describe block — a failure is injected at each later write
     (line items, then the counter) and each test asserts nothing was written: no
     invoice row, no line items, counter unchanged.

9. **The exact view field set.**
   - What: the invoice view has exactly `id, number, status, totalMinor, issuedAt,
     lineItems`, and each line item exposes exactly `description, quantity,
     unitPriceMinor` — no position, no ids.
   - Found: the view construction in the service; the suite never asserted keys.
   - Preserved: the service is structurally unchanged, and row types are inferred from
     the Drizzle schema, so a column drift fails typechecking.
   - Pinned: "keeps the exact view field set".

## The two paths that keep the word "prisma", and why

- `prisma/seed.ts` — the untouchable suite imports it from that exact path. It contains
  only seed data, no Prisma code. The `prisma/` directory holds nothing else.
- `src/billing/prisma.ts` — the untouchable suite type-imports
  `AccountRow/InvoiceRow/LineItemRow/PrismaClient` from that exact path and casts its
  fake to `PrismaClient`. It is now a pure type re-export of `BillingStore` and the row
  types: erased at runtime, no Prisma code or import. Deleting it would break the
  untouchable suite's typechecking, so it is kept as a documented shim.

## Running it

- `pnpm install` — clean install; nothing Prisma is left to resolve
- `pnpm test` — the untouched original suite plus the new migration suite
- `pnpm typecheck`
- `DATABASE_URL=… pnpm db:migrate` — applies `drizzle/0000_init.sql`
