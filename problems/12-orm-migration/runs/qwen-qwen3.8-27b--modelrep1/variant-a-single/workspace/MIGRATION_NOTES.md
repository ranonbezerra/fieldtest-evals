# MIGRATION_NOTES — Prisma → Drizzle

Data-layer migration of the billing service. The public contract is unchanged:
same service return shapes, same error `code`s, same JSON wire format (money as
decimal strings, dates as ISO-8601, `issuedAt: null` present for drafts).

## Removed / added

- **Removed:** `prisma/schema.prisma`, `prisma/seed.ts`, `src/billing/prisma.ts`
  (hand-written Prisma row types), and the `@prisma/client` + `prisma`
  dependencies.
- **Added:** `src/billing/schema.ts` (Drizzle tables + row types),
  `src/billing/db.ts` (`createDb()` from `DATABASE_URL` — the only place the
  environment is read), `drizzle/0000_init.sql` + `drizzle/meta/_journal.json`,
  `drizzle.config.ts`, `test/seed.ts` (seed data, moved, unchanged),
  `test/serializer.spec.ts`, `vitest.config.ts`.
- **Rewritten:** `billing.repository.ts`, `billing.service.ts` (`issue` only),
  `src/common/errors.ts` (`mapPrismaError` → `mapDbError`),
  `test/billing.spec.ts`, `package.json`, `tsconfig.json` (`types: ["node"]`
  so `process` typechecks).
- **Untouched:** `src/common/serializer.ts`. Its contract is what most of the
  semantic risk was about (below).

## Column / type mapping

| Prisma                          | Drizzle                                      |
| ------------------------------- | -------------------------------------------- |
| `String @db.Uuid`               | `uuid`                                       |
| `String`                        | `text`                                       |
| `String @db.Char(3)`            | `char(3)` — Postgres pads short values on read; identical in both stacks |
| `Int` / `Int @default(0)`       | `integer` / `integer().default(0)`           |
| `BigInt`                        | `bigint(..., { mode: 'bigint' })` — see below |
| `DateTime @db.Timestamptz(6)`   | `timestamp(..., { withTimezone: true, precision: 6 })` |
| `@default(now())`               | `.defaultNow()`                              |
| `@default("draft")`             | `.default('draft')`                          |

### The big-int trap (highest-impact difference)

Prisma returned JS `bigint` for `@db.BigInt`. Drizzle's `bigint` column
defaults to `mode: 'number'`, which would (1) silently round
`9007199254740993n` to `9007199254740992` (the seed value is deliberately past
`Number.MAX_SAFE_INTEGER`) and (2) turn money fields into JSON **numbers** —
it is the serializer's `typeof v === 'bigint'` branch that makes them ship as
decimal strings. Both `total_minor` and `unit_price_minor` are declared
`{ mode: 'bigint' }`. Pinned in `test/billing.spec.ts` (round-trip + serialized
string) and `test/serializer.spec.ts`.

## Constraints (recreated 1:1 in `drizzle/0000_init.sql`)

- PKs; `UNIQUE(invoices.number)` as `invoices_number_key`; indexes on
  `invoices(account_id)` and `invoice_line_items(invoice_id)`.
- `invoices.account_id → accounts.id`: `ON DELETE RESTRICT ON UPDATE CASCADE` —
  Prisma's default for a required relation; reproduced.
- `invoice_line_items.invoice_id → invoices.id`: `ON DELETE CASCADE` (explicit
  `onDelete: Cascade` in the Prisma schema); pinned by a delete test.

## Transactional behavior

`createInvoice` runs one `db.transaction` doing the same three writes in the
same order as the old `$transaction`: invoice insert → line-item insert
(skipped when empty, see below) → `UPDATE accounts SET invoice_count =
invoice_count + 1`. Pinned by a failure-injection test: a line item
referencing a non-existent invoice fails at step 2 (FK violation), and the test
asserts the invoice insert and the counter bump are rolled back.

Prisma's `createMany` was a no-op on `[]`; Drizzle's `insert().values([])`
**throws**, so the original `if (lineItems.length > 0)` guard is preserved and
pinned by a zero-line-item test.

## Error contract (the `code` field is the contract)

| Old (Prisma)            | New (SQLSTATE)        | Mapped to                              |
| ----------------------- | --------------------- | -------------------------------------- |
| `P2002` unique violation | `23505`             | `ConflictError('invoice_number_taken')` |
| `P2025` update matched 0 rows | *n/a* — no SQLSTATE | same public error, different mechanism |
| anything else           | anything else         | propagated as-is (500)                 |

The one semantic shift: Drizzle's `update … returning()` on zero rows
**resolves with `[]`** instead of throwing P2025. `markIssued` therefore
returns `InvoiceRow | null`, and `BillingService.issue` converts null to
`NotFoundError('invoice_not_found')` — callers see the same code and envelope
as before. `mapDbError` now matches `23505` (what `pg`/pglite put in
`error.code`) instead of `P2002`.

## Behaviors the old suite never covered (now pinned)

1. `getInvoice` 404 carries `code: 'invoice_not_found'` (old test only
   asserted "throws").
2. `listForAccount` on a **missing** account returns `[]`, not 404 — the
   service comment says the dashboard calls it before the account row exists;
   the old suite only covered an existing account with 0 invoices.
3. `issue` on a missing invoice → `NotFoundError('invoice_not_found')` (the
   P2025 path — the only place that mapping was reachable).
4. Duplicate `invoices.number` → `23505` → `ConflictError('invoice_number_taken')`
   (the P2002 path).
5. BigInt money past `Number.MAX_SAFE_INTEGER` round-trips exactly and
   serializes to the string `"9007199254740993"`.
6. Line items come back in **storage order** — neither stack used `ORDER BY`;
   the seed inserts positions 3, 1, 2 on purpose and the test pins that order.
7. `issuedAt` is `null` and **present** for drafts (`"issuedAt":null` in JSON),
   never omitted.
8. `listForAccount` returns raw rows with exactly
   `{ accountId, createdAt, id, issuedAt, number, status, totalMinor }`.
9. `issue` does not touch the account counter.
10. `createInvoice` with zero line items is a no-op for items.
11. Schema defaults (`status 'draft'`, `invoice_count 0`, `created_at now()`)
    and the line-item cascade on invoice delete.

## Judgment calls / caveats

- **Not-found tests use well-formed UUIDs.** The old fake accepted any string
  as an id; real Prisma rejects malformed `@db.Uuid` input (client-side
  validation) and Drizzle/Postgres rejects it with SQLSTATE `22P02` — both a
  500, never a 404. The 404 contract is defined for well-formed ids, and that
  is what the tests pin.
- **Test engine.** The suite runs against pglite (real Postgres semantics in a
  WASM module, in-memory), applying the **same** `drizzle/` migration the
  production `drizzle-kit migrate` runs. The old hand-rolled fake existed only
  because `@prisma/client` was not installed; with Drizzle there is no codegen
  to avoid, so a real engine is strictly stronger and lets the
  transaction-rollback, FK and unique tests be proofs rather than simulations.
- **Driver typing.** `BillingRepository` is typed against the production
  driver (`NodePgDatabase` from `src/billing/db.ts`); the test casts the pglite
  handle — both expose the same pg query surface (`select`/`insert`/`update`/
  `transaction`).
- **Migration artifacts.** `drizzle/0000_init.sql` + `drizzle/meta/_journal.json`
  are hand-written; the journal is what the Drizzle migrator actually consumes,
  in tests and in prod. The drizzle-kit snapshot (`meta/0000_snapshot.json`) was
  not hand-generated — run `pnpm db:generate` if you want to diff future schema
  changes against it.
- **Configuration.** `DATABASE_URL` is read in exactly one place
  (`createDb`); the test suite needs no environment at all.
