# Migration notes — Prisma → Drizzle

## What changed

| Before | After |
| --- | --- |
| `prisma/schema.prisma` | `src/billing/schema.ts` (Drizzle tables) + `drizzle/0000_init.sql` (canonical DDL) |
| `@prisma/client`, `prisma` dependencies | `drizzle-orm` + `postgres` (postgres-js driver); `drizzle-kit` for migrations |
| `src/billing/prisma.ts` (hand-written row + client types) | deleted; row types are now inferred (`AccountRow` / `InvoiceRow` / `LineItemRow` via `$inferSelect` in `src/billing/schema.ts`) |
| `prisma/seed.ts` | `test/seed.ts` (data unchanged) |
| `src/common/errors.ts` → `mapPrismaError` | `mapDbError` (SQLSTATE-based) |
| — | `src/billing/db.ts`: the single Drizzle client, built from `DATABASE_URL` only |

The old `prisma/` files and `src/billing/prisma.ts` are left as one-line
tombstones because this patch format cannot delete files; nothing imports them.

## Value-level contract (byte compatibility)

- **Money stays bigint.** `total_minor` / `unit_price_minor` use
  `bigint({ mode: 'bigint' })`, so values are JS `bigint` end to end and the
  global serializer emits the exact decimal string the web client parses. The
  seed invoice carries `9007199254740993` (past `Number.MAX_SAFE_INTEGER`); it
  must serialize to `"9007199254740993"`, not the rounded
  `"9007199254740992"`. Pinned in tests. Using Drizzle's `mode: 'number'`
  (or any `Number()` coercion) would silently corrupt amounts — it is the
  main trap in this migration.
- **Timestamps come back as `Date`.** `created_at` / `issued_at` use
  `timestamp(..., { withTimezone: true, mode: 'date', precision: 6 })`.
  Drizzle's default for timestamps is *string* mode; switching to it would
  still produce the same ISO wire strings, but the service-level type
  (`issuedAt: Date | null`) and every consumer of the rows would change.
  `issuedAt` stays present-but-`null` on drafts (null, never missing).
- **Field presence.** Selects return every column; an invoice list row
  serializes to exactly `{accountId, createdAt, id, issuedAt, number, status,
  totalMinor}`. Pinned in tests.
- **Sub-millisecond precision.** Both Prisma and postgres-js surface
  `timestamptz(6)` as JS `Date` (millisecond precision in JS itself); the seed
  data has no sub-second components, so wire output is unchanged.

## Behavior the old suite never covered — found, pinned, preserved

1. **Line item order.** The old `findLineItems` had no `ORDER BY`; the row
   order was whatever Postgres happened to return (storage order — the seed
   deliberately inserts positions 3, 1, 2). Callers render line items in the
   order the API returns, so the only defensible contract is `position`
   order. The new query issues `ORDER BY position ASC` explicitly, and a test
   pins it against the out-of-order seed. (You cannot "preserve storage
   order" in SQL — there is no queryable insertion-order column — which is
   what makes the old behavior an accident rather than a contract.)
2. **Missing account → `[]`.** `listForAccount` on a nonexistent account
   returns an empty list, not a 404 (the dashboard calls it before the account
   row exists for freshly provisioned tenants). Preserved; now pinned.
3. **`issue` on a missing invoice.** Prisma threw `P2025` on an update that
   matched nothing; `mapPrismaError` turned that into
   `NotFoundError('invoice_not_found')`. Drizzle's `update` **resolves with
   zero rows** instead of throwing, so the repository now converts an empty
   `RETURNING` into the same `NotFoundError`. Same observable error. Pinned.
4. **Duplicate invoice number.** Prisma's `P2002` →
   `ConflictError('invoice_number_taken')`. The Drizzle equivalent is the
   Postgres SQLSTATE `23505` (unique_violation), exposed as `error.code` by
   both postgres-js and node-postgres. `mapDbError` maps it identically, and
   the repository applies it around `createInvoice`, the only place a
   duplicate number can surface. Pinned, including "nothing was written".
5. **Atomicity of `createInvoice`.** Insert invoice → insert line items →
   `account.invoice_count + 1`, all inside `db.transaction`. Two tests inject
   failures mid-transaction (at the line-item insert, and at the counter
   update) and assert the invoice row, the items and the counter are all
   rolled back and the error propagates. The fake DB only rolls back *inside*
   `transaction()`, so a port that dropped the transaction would fail.
6. **Empty line items.** `createInvoice` with `lineItems: []` still creates
   the invoice and increments the counter (the old code explicitly skipped the
   empty `createMany`). Preserved; pinned.
7. **Invoice list order.** The old `listInvoices` had no `ORDER BY` and none
   was added: the seed cannot distinguish any order, and adding one would
   change the wire output. Documented as unspecified; do not rely on it.

## Migrations

`drizzle/0000_init.sql` is the canonical DDL and matches the Prisma schema
column-for-column, including:

- `invoices_number_key` unique constraint,
- `invoices_account_id_fkey` (`ON DELETE RESTRICT ON UPDATE CASCADE` —
  Prisma's default referential actions for a required relation) and
  `invoice_line_items_invoice_id_fkey` (`ON DELETE CASCADE`),
- indexes `invoices_account_id_idx`, `invoice_line_items_invoice_id_idx`,
- `char(3)` currency, `timestamptz(6)`, `bigint` money,
  `DEFAULT now()` / `DEFAULT 0` / `DEFAULT 'draft'`.

`drizzle/meta/_journal.json` lets `drizzle-kit migrate` apply it; regenerate
the snapshot with `pnpm db:generate` whenever the schema changes.

## Runtime & tests

`src/billing/db.ts` builds the single client from `DATABASE_URL`
(environment only; no connection strings in the repo) and exports the `Db`
type the repository consumes. The test suite injects an in-memory fake shaped
like the Drizzle client — the same approach as the old fake Prisma client —
plus transaction snapshot/rollback so the atomicity tests are meaningful.
`src/common/serializer.ts` is unchanged; the contract it implements is now
pinned by tests.
