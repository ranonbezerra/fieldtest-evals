# Migration notes — Prisma → Drizzle

## What was done

- Schema recreated in Drizzle (`src/db/schema.ts`); initial migration shipped in
  `drizzle/0000_init.sql` with journal and snapshot under `drizzle/meta/`.
- Single Drizzle client in `src/db/client.ts`, configured from `DATABASE_URL`
  only. `drizzle.config.ts` wires the schema/out paths for drizzle-kit.
- Every repository query ported to Drizzle. The repository still takes the db
  through its constructor, so the test suite can substitute a fake session.
- Prisma fully removed: `prisma` and `@prisma/client` dropped from
  `package.json`; `prisma/schema.prisma` and `src/billing/prisma.ts` stubbed
  (content removed). `prisma/seed.ts` is untouched — it is plain seed data the
  tests use, not ORM surface.

## Schema parity

| Table | Columns / constraints (unchanged) |
|---|---|
| `accounts` | `id uuid PK`, `name text`, `currency char(3)`, `invoice_count int not null default 0`, `created_at timestamptz(6) default now()` |
| `invoices` | `id uuid PK`, `account_id uuid FK → accounts(id)`, `number text unique`, `status text default 'draft'`, `total_minor bigint`, `issued_at timestamptz(6) null`, `created_at timestamptz(6) default now()`, index `invoices_account_id_idx` |
| `invoice_line_items` | `id uuid PK`, `invoice_id uuid FK → invoices(id) ON DELETE CASCADE`, `position int`, `description text`, `quantity int`, `unit_price_minor bigint`, index `invoice_line_items_invoice_id_idx` |

Index and FK names match Prisma's auto-generated names, so a rebuilt database
is indistinguishable from the old one.

## Query port

| Old (Prisma) | New (Drizzle) |
|---|---|
| `account.findUnique({ where: { id } })` | `select().from(accounts).where(eq(accounts.id, id)).get()` |
| `invoice.findUnique({ where: { id } })` | `select().from(invoices).where(eq(invoices.id, id)).get()` |
| `invoiceLineItem.findMany({ where: { invoiceId } })` | `select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, invoiceId))` — **no orderBy added** |
| `invoice.findMany({ where: { accountId } })` | `select().from(invoices).where(eq(invoices.accountId, accountId))` — **no orderBy added** |
| `invoice.create(...)` in `$transaction` | `tx.insert(invoices).values(...).returning()` |
| `invoiceLineItem.createMany({ data })` | `tx.insert(invoiceLineItems).values(rows)` (empty-list guard kept) |
| `account.update(..., { invoiceCount: { increment: 1 } })` | `tx.update(accounts).set({ invoiceCount: sql\`${accounts.invoiceCount} + 1\` })` — same atomic `SET col = col + 1` |
| `invoice.update(...)` in `markIssued` | `update(invoices).set({ status, issuedAt }).where(eq(invoices.id, id)).returning()` |

`createInvoice` still runs all three writes inside a single `db.transaction`
callback; nothing moved outside it.

## Semantics the old suite did not cover (found by reading call sites; now pinned by new tests)

1. **Line items are NOT sorted.** Neither the Prisma query nor the Drizzle one
   has an `ORDER BY`. The seed inserts positions 3, 1, 2 on purpose and the old
   fake returned them "in insertion order, as the database returns it" — i.e.
   callers receive items in the database's natural order. Adding
   `orderBy(position)` would have changed the payload, so it was not done.
   Pinned by a test asserting the 3-1-2 description order.
2. **Missing account → empty list, not 404.** `listForAccount` returns `[]`
   when the account row does not exist (the code comment says the dashboard
   calls this before the account is provisioned). The old suite only covered
   "account exists, zero invoices". Pinned.
3. **`issue()` on a missing invoice was a 404 via P2025.** Prisma threw on an
   unmatched update; Drizzle resolves it with an empty array. `markIssued`
   therefore now returns `null` in that case (internal signature change) and
   the service throws the same `NotFoundError('invoice_not_found')`. Pinned.
4. **Unique-violation code changed, contract did not.** P2002 → SQLSTATE
   `23505`; `mapPrismaError` became `mapDbError` and still yields
   `ConflictError('invoice_number_taken')`. Pinned at the mapping level.
5. **Money is a decimal string on the wire, BigInt-safe.** `total_minor` /
   `unit_price_minor` are `bigint` columns; Drizzle maps driver values to JS
   `bigint`, and the global serializer turns bigints into decimal strings. The
   seed carries `9007199254740993n` (> `Number.MAX_SAFE_INTEGER`) precisely to
   catch any numeric coercion. Pinned through the serialized body.
6. **`null` stays `null` (present, not missing).** A draft invoice serializes
   with `"issuedAt": null`. Pinned.
7. **`createInvoice` is one transaction.** The new fake commits staged writes
   only when the callback succeeds, so a test that makes the line-item insert
   fail proves nothing is persisted: no invoice row, no line items, counter
   unchanged. Writes made through the root connection would survive the
   rollback test, so the test also proves the writes go through `tx`.
8. **Empty line items still bump the counter.** The old code skipped
   `createMany([])`; Drizzle's `values([])` is not a no-op, so the guard is
   preserved and pinned.
9. **View shape.** The invoice view exposes exactly `id, number, status,
   totalMinor, issuedAt, lineItems` and each line item exactly `description,
   quantity, unitPriceMinor` — row extras (`accountId`, `createdAt`,
   `position`, …) never leak. Pinned.

## Error mapping

- `23505` (unique violation) → `ConflictError('invoice_number_taken')` (was P2002).
- Unmatched update/delete no longer throws (was P2025): the repository returns
  `null`, the service maps it to `NotFoundError('invoice_not_found')`.
- Anything else propagates unchanged (500).

## Migrations

- `drizzle/0000_init.sql` is written in Drizzle's journal format (with
  `--> statement-breakpoint` separators). Apply it on a fresh database with
  `drizzle-kit migrate`; drizzle-kit reads `drizzle/meta/_journal.json`.
- The journal and snapshot were written by hand to match the SQL. If
  `drizzle-kit generate` ever disagrees with the snapshot, regenerate the
  snapshot from the schema — the applied migration is the SQL file.

## Driver and type notes

- Driver: `postgres` (postgres.js) via `drizzle-orm/postgres-js`. Drizzle maps
  int8 driver values to JS `bigint`, so `InvoiceRow.totalMinor` and
  `LineItemRow.unitPriceMinor` stay `bigint` and the serializer contract is
  unchanged.
- `markIssued` now returns `InvoiceRow | null` instead of throwing; this is an
  internal signature change — the HTTP-facing behavior (`invoice_not_found`)
  is identical.
- The test double emulates Drizzle's real behaviors: reads filter by the
  compiled `where` (read via the builder's public `.toSQL()`, so the fake
  never parses Drizzle internals), `insert` fills `created_at` like the DB
  default, `update().returning()` returns `[]` when nothing matched, and
  `transaction()` stages writes and commits only on success.
