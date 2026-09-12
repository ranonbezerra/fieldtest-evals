# Migration notes — Prisma → Drizzle

Scope: the data layer of the billing service. The public API contract (field
presence, null vs missing, numeric formats) is byte-compatible with the Prisma
version. Every semantic difference found while porting is pinned by a test in
`test/billing.spec.ts`.

## Files

| Change | Path |
| --- | --- |
| Removed | `prisma/schema.prisma` (schema recreated in Drizzle) |
| Removed | `src/billing/prisma.ts` (trimmed Prisma client types; replaced by Drizzle `$inferSelect` row types) |
| Removed | deps `prisma`, `@prisma/client`; added `drizzle-orm`, `pg` (runtime) and `@electric-sql/pglite`, `drizzle-kit`, `@types/pg`, `@types/node` (dev) |
| Added | `src/db/db.schema.ts` (Drizzle schema + row types), `src/db/db.client.ts` (runtime client), `drizzle.config.ts` |
| Added | `drizzle/0000_initial.sql` + `drizzle/meta/_journal.json` (migration; apply with `pnpm migrate` → `drizzle-kit migrate`, connection from `DATABASE_URL`) |
| Moved | `prisma/seed.ts` → `test/seed.ts` (content unchanged) |
| Ported | `src/billing/billing.repository.ts`, `src/billing/billing.service.ts`, `src/common/errors.ts` |
| Unchanged | `src/common/serializer.ts` (the wire format it defines is preserved, see below) |

## Column/mode mapping (why it stays byte-compatible)

- `String @db.Uuid` → `uuid`; `String` → `text`; `String @db.Char(3)` → `char(3)`; `Int` → `integer`; `BigInt` → `bigint` with **`mode: 'bigint'`** (JS `bigint`, as Prisma returned); `DateTime @db.Timestamptz(6)` → `timestamp(6) with time zone` with **`mode: 'date'`** (JS `Date`, as Prisma returned). Drizzle's default column modes (`number` / `string`) would have silently changed the JS types and therefore the serialized wire format — the single most dangerous difference of this port.
- Defaults, the unique index on `invoices.number`, the two secondary indexes and the `ON DELETE CASCADE` on `invoice_line_items.invoice_id` are reproduced in `drizzle/0000_initial.sql`.

## Semantic differences found and how they were preserved

1. **A 0-row update no longer throws.** Prisma raised `P2025` ("record not found") when `markIssued` matched nothing; Drizzle simply returns no rows. `BillingRepository.markIssued` now returns `InvoiceRow | null` and `BillingService.issue` throws `NotFoundError('invoice_not_found')` on `null` — the same public error. Pinned: "throws invoice_not_found when issuing an invoice that does not exist".
2. **No `ORDER BY` anywhere — on purpose.** The Prisma repository issued no `orderBy`, so Postgres returned physical (insertion) order and callers shipped in that order. The Drizzle port omits `ORDER BY` on `findLineItems` and `listInvoices` as well. The seed deliberately inserts line-item positions 3, 1, 2, and the API returns them in that order (NOT sorted by `position`). Sorting by position would be a breaking change — it is flagged here for a deliberate product decision, not applied. Pinned: "returns line items in insertion order, not positional order" and "lists invoices in insertion order".
3. **Money is an exact decimal string.** `total_minor` / `unit_price_minor` come back as JS `bigint` and the (unchanged) serializer renders them with `toString()` — e.g. `9007199254740993` (deliberately past `Number.MAX_SAFE_INTEGER`) must survive the round trip unchanged. Pinned: "serializes money fields as exact decimal strings (no precision loss)".
4. **`null` stays present.** Draft invoices carry `issuedAt: null` (the key is present, the value null — not missing), and dates serialize as ISO strings (`2024-04-01T09:00:00.000Z`). Pinned: "keeps null fields present and dates as ISO strings in the wire format".
5. **`createInvoice` is one transaction: insert invoice → insert line items → `invoice_count + 1`.** The increment is a SQL expression (no read-modify-write race; the same atomic effect as Prisma's `{ increment: 1 }`). Pinned by the happy path plus "rolls back invoice, line items and counter when a statement fails mid-transaction", which forces a primary-key violation on the second statement (the invoice insert has already succeeded) and asserts the invoice, its line items and the counter are all rolled back.
6. **Counter semantics.** `invoice_count` is only ever incremented on creation. Deleting an invoice cascades its line items but does NOT decrement the counter (true in Prisma as well). Pinned: "cascades line-item deletion when an invoice is deleted, without touching the counter".
7. **`listForAccount` on a missing account returns `[]`, not a 404.** The service comment says the dashboard relies on this for freshly provisioned tenants; the old suite only covered an existing empty account. Pinned: "returns an empty list, not a 404, for an account that does not exist".
8. **`issue` is unconditional.** Re-issuing an already-issued invoice succeeds and refreshes `issuedAt` (no guard in Prisma, none added). Pinned: "re-issuing an already issued invoice succeeds and refreshes issuedAt".
9. **The create path never mapped the unique violation.** Prisma `P2002` on a duplicate `number` during `createInvoice` was a raw 500-class error, not a 409 — the repository had no try/catch there. The port keeps that error surface (no "fix"). `mapDbError` still maps SQLSTATE `23505` → `ConflictError('invoice_number_taken')` for callers that route errors through it (the `P2002` equivalent). Pinned: "surfaces the raw database error on a duplicate invoice number at creation time".
10. **Malformed IDs are server errors, not 404s.** A non-UUID id fails in Postgres before the lookup (`invalid input syntax`), under both Prisma and Drizzle; the old fake client masked this. Pinned: "rejects a malformed invoice id with a database error, not a 404".
11. **Foreign keys enforced as before.** Creating an invoice for an unknown account fails the transaction at the first statement. Pinned: "rejects creating an invoice for an unknown account (foreign key)".

## Error mapping (`src/common/errors.ts`)

`mapPrismaError` → `mapDbError`. Prisma codes are gone:

- `P2002` (unique violation) → Postgres SQLSTATE `23505` → `ConflictError('invoice_number_taken')`.
- `P2025` (0-row update) has no Drizzle equivalent; replaced by the explicit `null` check in `BillingService.issue` (see 1).
- Drizzle may hand back the driver error directly or nest the server error under `cause`, so `mapDbError` walks the error/`cause` chain for a string `code`. Anything else still propagates as a 500, as before.

## Test harness

The old suite ran against a fake in-memory Prisma client, which cannot prove
SQL-level behavior (constraints, atomicity, ordering, int8 precision). The new
suite runs against **Pglite** — a real in-process Postgres (WASM) — started
with the same migration SQL (`drizzle/`) that production applies, then seeded
in the seed file's order. No `DATABASE_URL` is needed for `pnpm test`; the
runtime client (`src/db/db.client.ts`) still reads `DATABASE_URL` from the
environment only. Future schema changes: edit `src/db/db.schema.ts`, run
`drizzle-kit generate`, commit the new migration.

## Run

- `pnpm migrate` — apply `drizzle/` to Postgres (`drizzle-kit migrate`, `DATABASE_URL` from env).
- `pnpm test` — vitest suite (in-process Postgres).
- `pnpm typecheck` — `tsc --noEmit`.
