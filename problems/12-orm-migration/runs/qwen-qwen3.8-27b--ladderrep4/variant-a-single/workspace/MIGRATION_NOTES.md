# Migration notes — Prisma → Drizzle (issue #370)

## What moved where

| Before | After |
| --- | --- |
| `prisma/schema.prisma` | `src/billing/schema.ts` (Drizzle) + `drizzle/0000_init.sql` (migration) |
| `@prisma/client` dependency and the trimmed client stand-in used by `billing.repository.ts` / `billing.service.ts` | `drizzle-orm` + `postgres` (driver); every query is expressed in Drizzle in `src/billing/drizzle-client.ts` |
| `src/common/errors.ts::mapPrismaError` (P2002/P2025) | removed; a no-match update is now detected structurally (see #6) |
| — | `src/billing/db.ts` (production wiring from `DATABASE_URL`), `drizzle.config.ts` |

`package.json` no longer references Prisma (the package name was renamed from
`fixture-billing-prisma` accordingly). `src/common/serializer.ts` is untouched,
so the wire format is byte-compatible.

## Kept on purpose (frozen-suite seams)

`test/billing.spec.ts` must run unmodified, and it imports `seed` from
`prisma/seed.js` and the row types / client interface from
`src/billing/prisma.js`. Those files therefore remain:

- `prisma/seed.ts` — unchanged seed data (value import from the suite).
- `src/billing/prisma.ts` — now a **seam, not Prisma**: it contains only the
  row types and the data-access interface (`PrismaClient`, kept by name
  because the suite imports it by that name). It imports nothing from Prisma.
  In production the interface is implemented by `DrizzleBillingClient`; in
  tests, by the suite's in-memory fake.
- `prisma/schema.prisma` — replaced by a tombstone comment (this delivery
  format cannot delete files); nothing reads it.

## Semantic differences met, found, and preserved

### 1. BigInt money ships as decimal strings — and must stay exact in memory
- **Behaviour:** `total_minor` / `unit_price_minor` are BigInt. Prisma
  returned JS `bigint`; the global serializer turns `bigint` into a decimal
  string, and the web client parses strings.
- **Found:** comparing the Prisma column type (`BigInt`) with Drizzle's
  `bigint()` default — Drizzle's default mode is **`'number'`**, which would
  (a) lose precision on the seed's `9007199254740993n` (past
  `Number.MAX_SAFE_INTEGER`) and (b) make the serializer emit a JSON number.
  No existing test would have noticed.
- **Preserved:** `bigint(..., { mode: 'bigint' })` on both money columns in
  `src/billing/schema.ts`.
- **Pinned by:** `keeps large amounts exact in memory and ships them as
  decimal strings`, `serializes bigints to decimal strings and dates to ISO
  strings`, and the adapter test `routes createInvoice through a single
  db.transaction and keeps amounts as bigint`.

### 2. Line items come back in database (insertion) order, not by position
- **Behaviour:** the legacy `findMany` had no `orderBy`; the seeded invoice
  carries positions inserted as 3, 1, 2, so the API returns Support retainer,
  Implementation, Training day.
- **Found:** the seed comment "Inserted out of positional order on purpose"
  plus the absence of any `orderBy` in the legacy repository.
- **Preserved:** the Drizzle select has no `.orderBy()`.
- **Pinned by:** `returns line items in stored (insertion) order, not by
  position` (a "helpful" `orderBy(position)` would fail it).

### 3. Invoice lists are in natural (stored) order, not by number/date
- **Behaviour:** `listForAccount` never ordered its results.
- **Found:** no `orderBy` in the legacy `findMany`; comparing old vs new
  output would reorder the payload the moment an `orderBy` is added.
- **Preserved:** no `.orderBy()` on the Drizzle select.
- **Pinned by:** `keeps the invoice list in stored order`.

### 4. `issuedAt` is present-and-null for drafts, never missing
- **Behaviour:** the view always contains the `issuedAt` key; a draft has
  JSON `null`, not an absent field. An invoice with no line items ships
  `lineItems: []`, not a missing key.
- **Found:** `issuedAt: DateTime?` in the Prisma schema vs the view
  construction; the suite never asserted the null case.
- **Preserved:** the service is unchanged; the nullable Drizzle column
  returns `null`, which the unchanged serializer emits as `null`.
- **Pinned by:** `keeps issuedAt present-and-null for a draft, and lineItems
  as an empty array`.

### 5. `listForAccount` returns `[]` (not 404) when the account does not exist
- **Behaviour:** freshly provisioned tenants are listed before their account
  row exists; the service maps a missing account to an empty list.
- **Found:** the `account === null` branch in the service; the suite only
  covered an *existing* account with zero invoices.
- **Preserved:** the branch is unchanged; `findAccount` still resolves null.
- **Pinned by:** `returns [] (not a 404) for an account id that does not
  exist`.

### 6. `issue()` on a missing invoice is a 404 `invoice_not_found`, not a 500
- **Behaviour:** updating a non-existent invoice used to surface as Prisma
  `P2025`, and `mapPrismaError` converted it to
  `NotFoundError('invoice_not_found')`.
- **Found:** reading `mapPrismaError` and its only call site; the suite never
  exercised the missing-invoice path.
- **Preserved:** Drizzle has no P2025, so the Drizzle client's `update` uses
  `.returning()` and resolves to `null` when nothing matched. The repository
  returns that null and the service throws `NotFoundError('invoice_not_found')`
  — same code, same envelope.
- **Pinned by:** `throws NotFoundError(invoice_not_found) when issuing a
  missing invoice`, and at the adapter level `resolves null when the invoice
  update matches no row (feeds the 404 path)`.

### 7. The Prisma error mapper is gone; no P-code mapper replaced it
- **Behaviour:** `mapPrismaError` mapped `P2002` →
  `ConflictError('invoice_number_taken')` and `P2025` → NotFound.
- **Found / analysis:** `P2025` is handled structurally now (#6). The `P2002`
  path was unreachable from this service: `issue()` only updates
  `status`/`issued_at`, and `createInvoice` never mapped errors, so a
  duplicate `number` was a raw Prisma error → 500.
- **Preserved:** under Drizzle/postgres a duplicate `number` is a raw `23505`
  → still an unhandled error → still a 500. I deliberately did **not** add a
  `23505 → ConflictError` mapping, which would have changed a 500 into a 409.
  `ConflictError` remains exported, as before.

### 8. Invoice creation is atomic (invoice + line items + counter)
- **Behaviour:** all three writes commit or roll back together.
- **Found:** the legacy repository funnels every write through
  `$transaction`; the suite never tested the failure path.
- **Preserved:** `DrizzleBillingClient.$transaction` maps to
  `db.transaction`, and all three writes happen inside it. The counter
  increment is `invoice_count = invoice_count + 1` via a SQL fragment
  (Drizzle has no Prisma-style `{ increment }` object).
- **Pinned by:** the two mid-transaction failure tests. Their fake emulates a
  real transaction (snapshot on begin, restore on throw), so a write outside
  the transaction would survive the rollback and fail the test. The tests
  also assert the writes were *attempted* before the failure, i.e. the
  rollback undid real work.

### 9. An empty line-item batch is never sent
- **Behaviour:** `createInvoice` skips `createMany` for zero items (an empty
  multi-row `VALUES` is not a valid Postgres statement).
- **Found:** the `length > 0` guard in the legacy repository.
- **Preserved:** the guard stays in the repository, and the Drizzle client's
  `createMany` also no-ops on an empty array.
- **Pinned by:** `skips the line-item batch entirely when there are no line
  items`.

### 10. Referential actions in the DDL
- **Behaviour:** line items cascade-delete with their invoice; invoices→
  accounts uses the default (Prisma `Restrict` ↔ Postgres `NO ACTION`).
- **Found:** `onDelete: Cascade` on the Prisma relation; the other FK left
  the default.
- **Preserved:** `.references(() => invoices.id, { onDelete: 'cascade' })`
  and a plain `.references(() => accounts.id)` in the Drizzle schema, both
  shipped in `drizzle/0000_init.sql`.

### 11. Defaults and timestamps
- **Behaviour:** `created_at` is DB-stamped (`DEFAULT now()`); inserts omit
  it; `timestamptz(6)` values arrive as JS `Date` (millisecond precision, as
  with Prisma) and serialize to ISO strings.
- **Found:** `@default(now())` / `@db.Timestamptz(6)` in the Prisma schema
  vs the repository's `Omit<InvoiceRow, 'createdAt'>` insert type.
- **Preserved:** `.defaultNow()`, the same insert shape, and `.returning()`
  supplying the stamped value; the serializer is untouched.

## Running

```
pnpm install
pnpm migrate    # applies drizzle/0000_init.sql (DATABASE_URL from env)
pnpm test
pnpm typecheck
```

`drizzle/meta/0000_snapshot.json` is intentionally not hand-written;
`pnpm generate` (re)creates it from `src/billing/schema.ts` when a future
schema change is needed.
