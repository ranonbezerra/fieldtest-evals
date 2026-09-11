# MIGRATION_NOTES — billing data layer: Prisma → Drizzle

## File map

| Before | After |
| --- | --- |
| `prisma/schema.prisma` | `src/billing/schema.ts` + `drizzle/0000_initial.sql` (+ `drizzle/meta/_journal.json`) |
| `@prisma/client`, `prisma` (package.json) | `drizzle-orm`, `drizzle-kit` |
| `src/billing/prisma.ts` (hand-rolled stand-in for the generated client) | `src/billing/rows.ts` (row types), `src/billing/client.ts` (`BillingClient`), `src/billing/drizzle-client.ts` (the only code that touches the database) |
| `mapPrismaError` (P2002 / P2025) | `mapDbError` (SQLSTATE `23505` / `RowNotFoundError`) in `src/common/errors.ts` |

No `@prisma/client` import, Prisma schema, generated client or `prisma` package
reference remains anywhere: package.json, all of `src/`, and the error mapper.

## Why `src/billing/prisma.ts` and `prisma/seed.ts` still exist

The task forbids editing the existing suite. That suite imports
`{ AccountRow, InvoiceRow, LineItemRow, PrismaClient }` from
`../src/billing/prisma.js` and types its in-memory fake as `PrismaClient`, and it
imports `{ seed }` from `../prisma/seed.js`. Both files therefore stay at their
historical paths; both are now Prisma-free:

- `src/billing/prisma.ts` is a type-only re-export of `rows.ts` / `client.ts`
  (the historical name `PrismaClient` survives as an alias of `BillingClient`,
  whose shape is intentionally identical so the suite's fake stays a valid
  implementation). Nothing outside the unmodifiable suite imports it.
- `prisma/seed.ts` is plain seed data with no Prisma code; nothing in `src/`
  imports it.

## Behaviours the old suite did not cover — found, pinned, preserved

Method: read every call site, listed what the old Prisma queries *actually*
did (no `orderBy` anywhere; `findUnique` → `null`; update-matched-nothing →
P2025; global BigInt serializer), then compared against what a naive Drizzle
port would return and pinned each delta with a new test
(`test/billing.contract.spec.ts`, `test/billing.atomicity.spec.ts`).

1. **Line items arrive in storage order, not position order.** The seed
   inserts positions 3, 1, 2 on purpose. The old
   `invoiceLineItem.findMany({ where: { invoiceId } })` had no `orderBy`, so
   the wire order was the database's incidental (storage) order. The Drizzle
   port keeps no `.orderBy()`, so the output is unchanged. Pinned:
   `getInvoice(...).lineItems` → positions `[3, 1, 2]`. An
   `orderBy(position)` "fix" would reorder every consumer's payload; that is a
   behaviour change, not a migration, and was deliberately not done.

2. **Invoice lists also arrive in storage order.** Same for
   `listInvoices` — no `orderBy` before, none after. Pinned: numbers come back
   as `['INV-2024-0001', 'INV-2024-0002']`.

3. **Missing account → `[]`, not a 404.** `listForAccount` returns an empty
   list when the account row does not exist (the dashboard calls it before the
   row exists for freshly provisioned tenants). The old suite only covered an
   *existing* account with zero invoices. Pinned with a genuinely missing id.

4. **`issue()` on a missing invoice → `invoice_not_found`.** Prisma raised
   P2025 when an update matched nothing; the old mapper turned that into
   `NotFoundError('invoice_not_found')` (the 404 path). A Drizzle `update()`
   on a missing row does **not** throw — it silently affects zero rows. The
   Drizzle client therefore raises `RowNotFoundError` when `.returning()`
   comes back empty, and `mapDbError` maps it to the same
   `NotFoundError`/code. Pinned: `issue('<missing>')` rejects with
   `code === 'invoice_not_found'`.

5. **Unique violations still map to `invoice_number_taken`.** P2002 becomes
   Postgres SQLSTATE `23505` (unique_violation, carried in the driver error's
   `code`) → `ConflictError('invoice_number_taken')`, same as before. The
   `invoices.number` constraint keeps its Prisma-default name
   `invoices_number_key`.

6. **BigInt money serializes to exact decimal strings.** Drizzle `bigint`
   columns return JS `bigint`, exactly like Prisma, so the global serializer's
   contract (serializer untouched) is unchanged. The seed's `9007199254740993n`
   is past `Number.MAX_SAFE_INTEGER`: an accidental `Number` round-trip would
   read `9007199254740992` and no happy-path test would notice. Pinned: the
   serialized body contains the string `"9007199254740993"`.

7. **Field presence: `issuedAt` is present-but-null, not absent; an invoice
   without line items returns `lineItems: []`.** Pinned for invoice 0002,
   which the old suite never fetched, and for every invoice-list row (all
   seven fields present after serialization).

8. **`createInvoice` atomicity.** Invoice insert, line-item insert and the
   account counter increment run in one transaction. Pinned by injecting a
   failure at each later step (`lineItems`, `account`) with a fake whose
   `$transaction` rolls its store back, and asserting the invoice row, the
   line items and the counter are all untouched.

## Schema and constraint mapping

JS keys stay camelCase; SQL names stay snake_case (Drizzle's column names play
the role Prisma's `@map` played). Constraint names were kept identical so the
DDL matches what the old schema generated.

| Prisma | Drizzle |
| --- | --- |
| `@id @db.Uuid` | `uuid('id').primaryKey()` → JS `string` |
| `String` | `text(...)` → JS `string` |
| `Char(3)` | `char('currency', { length: 3 })` |
| `Int @default(0) @map("invoice_count")` | `integer('invoice_count').notNull().default(0)` |
| `BigInt @map("total_minor")` / `@map("unit_price_minor")` | `bigint(...)` → JS `bigint` |
| `DateTime @db.Timestamptz(6) @default(now())` | `timestamp(..., { withTimezone: true, mode: 'date', precision: 6 }).defaultNow()` → JS `Date` |
| `number @unique` (`invoices_number_key`) | `uniqueIndex('invoices_number_key').on(t.number)` |
| `@@index([accountId])` (`invoices_account_id_idx`) | `index('invoices_account_id_idx').on(t.accountId)` |
| `@@index([invoiceId])` (`invoice_line_items_invoice_id_idx`) | `index('invoice_line_items_invoice_id_idx').on(t.invoiceId)` |
| line-item FK, `onDelete: Cascade` | `.references(() => invoices.id, { onDelete: 'cascade', onUpdate: 'cascade' })` |
| invoices → accounts FK (Prisma defaults: restrict / cascade) | `.references(() => accounts.id, { onDelete: 'restrict', onUpdate: 'cascade' })` |

## Migrations

`drizzle/0000_initial.sql` (journal: `drizzle/meta/_journal.json`) recreates
the whole schema. Apply with `pnpm db:migrate` (reads `DATABASE_URL` from the
environment; nothing is hardcoded). The drizzle-kit snapshot file is produced
by `drizzle-kit generate` on first run, as usual.

## Verification

    pnpm install
    pnpm typecheck   # tsc --noEmit, clean
    pnpm test        # original suite unmodified + new pinning tests
