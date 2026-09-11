# MIGRATION_NOTES — Prisma → Drizzle (issue #370)

## TL;DR

- The schema is recreated in Drizzle (`src/db/schema.ts`) with an initial migration in
  `drizzle/migrations/`. **`prisma/schema.prisma` is deleted.** `@prisma/client` and
  `prisma` are removed from `package.json`; `drizzle-orm` + `pg` are added.
- Every query now runs through Drizzle. The repository programs against the same data
  access surface it always had (model-scoped `findUnique`/`findMany`/`create`/`update`/
  `createMany` + interactive `$transaction`); that surface is now the `BillingClient`
  interface in `src/billing/billing.client.ts`, and `DrizzleBillingClient` is its
  Drizzle implementation. The frozen suite injects an in-memory fake through exactly
  this surface, which is why it runs **unmodified** and remains the behavioural
  baseline (a repository rewritten to call the Drizzle query builder directly would
  break the frozen suite's fake at runtime).
- Every semantic the old service had was preserved; the ones the old suite never
  asserted are pinned in `test/migration.spec.ts` and documented below.

## File-by-file

| Path | What happened |
| --- | --- |
| `prisma/schema.prisma` | **DELETED** — schema now lives in `src/db/schema.ts` + `drizzle/migrations/`. (Nothing in the new code references it.) |
| `prisma/seed.ts` | **Kept, unchanged** — the frozen suite imports it at *runtime* (`import { seed } from '../prisma/seed.js'`). It is plain data, no Prisma code. Moving it would break the frozen suite. |
| `package.json` | `- @prisma/client - prisma`; `+ drizzle-orm`, `+ pg` (deps); `+ drizzle-kit`, `@types/pg`, `@types/node` (dev). No Prisma package remains. |
| `tsconfig.json` | `types: []` → `types: ["node"]` — `src/db/index.ts` reads `process.env.DATABASE_URL` (env-only config, per convention). |
| `src/db/schema.ts` | **New** — Drizzle schema, same tables/columns/constraints as the Prisma one. |
| `src/db/index.ts` | **New** — builds the Drizzle db from `DATABASE_URL` (environment only, nothing hardcoded). |
| `src/billing/billing.client.ts` | **New** — `BillingClient` contract + `DrizzleBillingClient` (all ported queries). |
| `src/billing/billing.repository.ts` | Same methods, same logic; programs against `BillingClient` instead of the Prisma client. The type-only `./prisma.js` import is gone. |
| `src/billing/billing.service.ts` | Same logic; `mapPrismaError` → `mapDbError`; row types come from the Drizzle schema. |
| `src/billing/prisma.ts` | **Now a type-only shim.** Re-exports the Drizzle-derived row types and aliases the historical `PrismaClient` name to `BillingClient`. It exists for one reason: the frozen suite type-imports these four names from this path, and the frozen suite must not be edited. It imports nothing Prisma-related; no Prisma package is imported anywhere in the new code. |
| `src/common/errors.ts` | `mapPrismaError` removed; `mapDbError` + `RecordNotFoundError` added (see error mapping below). |
| `src/common/serializer.ts` | **Unchanged** — still the thing that turns `bigint` → decimal string and `Date` → ISO on the wire. |
| `drizzle.config.ts`, `drizzle/migrations/**` | **New** — Drizzle migration tooling + initial migration (DDL in `0000_init.sql`). |
| `test/migration.spec.ts` | **New** — pins the behaviours in §Semantic differences. |
| `test/billing.spec.ts` | **Unchanged** (frozen baseline). |

## Semantic differences found and resolved

Each item: what the behaviour is, how it was found, how the Drizzle version preserves
it, and the test that pins it.

### §1. Money is `bigint` in memory and a decimal **string** on the wire
`InvoiceView.totalMinor` and line-item `unitPriceMinor` are `bigint`; the global
serializer turns them into decimal strings. The seed carries
`9007199254740993n` — deliberately above `Number.MAX_SAFE_INTEGER` — so any port that
let the value become a `number` would silently emit `9007199254740992` and no existing
test would notice.
- **Found:** reading `serializer.ts` + the seed comment; Drizzle's pg `bigint` column
  returns a **string by default**, which would have broken the *internal* contract
  (`typeof totalMinor === 'bigint'`) even though the wire would still look right.
- **Preserved:** `bigint(..., { mode: 'bigint' })` on both money columns, so rows come
  back as native `bigint` and the unchanged serializer produces the strings.
- **Pinned:** `test/migration.spec.ts` → "keeps money values as bigint internally…"
  and the exact-wire test (asserts `"totalMinor":"9007199254740993"`).

### §2. There is **no `ORDER BY` anywhere** — wire order is database order
`findLineItems` and `listInvoices` had no ordering. On this data the database returns
insertion order: the seed inserts line-item positions **3, 1, 2 on purpose**, and the
old service returned them in that order. Adding `ORDER BY position` would look like an
improvement and silently reorder every consumer's payload.
- **Found:** the seed comment ("Inserted out of positional order on purpose") next to a
  query with no `orderBy`; comparing old vs new output shapes.
- **Preserved:** the Drizzle queries omit ordering entirely.
- **Pinned:** "line items come back in database (insertion) order, not position order"
  and the exact-wire test (lineItems appear as 3, 1, 2).

### §3. `issuedAt` is present-and-`null` for drafts, never a missing field
`JSON.stringify` drops `undefined` keys but emits `"key": null` for `null` — so a null
that became absent is a wire change. Draft invoices must ship `"issuedAt": null`.
- **Found:** reading the serializer's `Object.entries` behaviour against the row types
  (`issuedAt: Date | null`); Drizzle returns `null` (not `undefined`) for NULL columns,
  so the port keeps it, and the pin guards against a future "cleanup".
- **Pinned:** "ships a draft invoice with issuedAt present and null, and an empty (not
  missing) lineItems" (also pins `lineItems: []` rather than absent).

### §4. `listForAccount` on a **completely missing** account returns `[]`, not a 404
The service branches on `findAccount(...) === null` and returns an empty list — the
comment says the dashboard calls it before the account row exists for freshly
provisioned tenants. The old suite only covered an *existing* account with zero
invoices, so this branch was never asserted.
- **Found:** reading the service call site + its comment.
- **Preserved:** `findAccount` still returns `null` (`rows[0] ?? null`) and the branch
  is untouched.
- **Pinned:** "listForAccount returns [] for a completely missing account (not a 404)".

### §5. `issue()` on a missing invoice 404s with `invoice_not_found`
Prisma reported an UPDATE matching no row as **P2025**, which `mapPrismaError` turned
into `NotFoundError('invoice_not_found')`. Postgres performs a no-op UPDATE silently —
`UPDATE … RETURNING` just comes back empty — so the Drizzle client now **synthesises**
`RecordNotFoundError` when `RETURNING` yields nothing, and `mapDbError` maps it to the
same API error. Same mechanism on the account-counter update inside `createInvoice`.
- **Found:** comparing Prisma P-code semantics with raw Postgres behaviour for
  no-match updates.
- **Pinned:** "issue() on a missing invoice 404s with invoice_not_found (the P2025
  path)", plus mapper unit tests.

### §6. Unique violation on the invoice number → `invoice_number_taken`
Prisma's **P2002** became Postgres error code **23505** (`unique_violation`);
`mapDbError` maps it to `ConflictError('invoice_number_taken')` exactly where the old
mapper mapped P2002.
- **Pinned:** "maps a unique violation (23505) to invoice_number_taken, as P2002 did".

### §7. `create` resolves with the **stored** row, defaults applied
Prisma's `create` returned the row with the DB-applied `createdAt`. Drizzle's insert
returns nothing unless you ask — the port uses `.returning()` so the service's
create/issue responses keep every field (`createdAt` included).
- **Pinned:** "writes the invoice, its line items and the account counter together"
  (asserts `created.createdAt` is a real `Date`).

### §8. `listForAccount` returns **full rows**, not a view
The frozen suite only asserted `length === 2`. The wire actually carries the whole row
— `accountId`, `createdAt`, `issuedAt: null` for the draft, money as strings, in
database order.
- **Pinned:** "listForAccount returns full rows (accountId, createdAt included) in
  database order" (asserts the exact key set per row + serialized values).

### §9. `createInvoice` is one transaction (invoice + line items + counter)
All three writes happen inside a single `$transaction` callback. The Drizzle client
implements `$transaction` as one `db.transaction` and hands the callback a client view
bound to the same transaction handle, so a failure anywhere rolls back all three.
- **Proven:** `test/migration.spec.ts` → "rolls back everything when the line-item
  insert fails mid-transaction" and "rolls back the invoice too when the counter update
  fails (the third write)" — a failure injected mid-transaction, asserting **nothing**
  was written (no invoice row, no line items, counter unchanged). The in-memory fake
  implements real snapshot/rollback semantics to model the database's atomicity
  contract.

### §10. `currency` is `char(3)`, not `varchar(3)`
The Prisma schema says `@db.Char(3)` (fixed width). Recreated as Drizzle `char(3)` and
`"currency" char(3)` in the migration SQL so the constraint is byte-identical.
- **Pinned:** by the migration DDL itself (see below).

## Error mapping

| Old (Prisma) | New (Drizzle/Postgres) | API result |
| --- | --- | --- |
| `P2002` (unique violation) | pg error code `23505` | 409 `invoice_number_taken` |
| `P2025` (update matched nothing) | `RecordNotFoundError` — synthesised by the client on an empty `UPDATE … RETURNING` | 404 `invoice_not_found` |
| anything else | anything else | propagates → 500 |

`mapPrismaError` is gone; `mapDbError` in `src/common/errors.ts` is the only mapper.

## Recorded wire contract (byte-for-byte)

For the seeded issued invoice, `JSON.stringify(serialize(getInvoice('aaaaaaaa-…-0001')))`
must remain exactly:

```
{"id":"aaaaaaaa-0000-4000-8000-000000000001","number":"INV-2024-0001","status":"issued","totalMinor":"9007199254740993","issuedAt":"2024-04-01T09:00:00.000Z","lineItems":[{"description":"Support retainer","quantity":1,"unitPriceMinor":"50000"},{"description":"Implementation","quantity":2,"unitPriceMinor":"250000"},{"description":"Training day","quantity":1,"unitPriceMinor":"120000"}]}
```

## Considered and accepted

- **Malformed (non-UUID) ids:** Prisma validated UUID format client-side
  (`PrismaClientValidationError`); Drizzle/pg surfaces Postgres `22P02`. Both
  propagate unmapped from the service layer (→ 500), so there is no change at the
  service boundary; no client-side validation was added (that would be a behaviour
  change, not a migration).
- **Ordering is incidental, not promised:** with no `ORDER BY`, Postgres returns table
  order (insertion order on this data, for both the small-table seq scan and the
  single-column index — equal keys sort by heap tuple order). Both the old and new
  queries rely on exactly this; that is the contract. If the product ever wants
  position-ordered line items, that is a separate change.

## Migrations

- `drizzle/migrations/0000_init.sql` is the DDL (authoritative): creates `accounts`,
  `invoices`, `invoice_line_items` with the same columns, defaults, the unique index on
  `invoices.number`, the two b-tree indexes, and both FKs (including
  `ON DELETE CASCADE` for line items).
- Apply: `psql "$DATABASE_URL" -f drizzle/migrations/0000_init.sql`, or
  `pnpm db:migrate` (drizzle-kit). `meta/` is drizzle-kit bookkeeping for this
  hand-written initial migration; when extending the schema, `pnpm db:generate`.

## Verification

1. Clean `pnpm install` — no Prisma package is installed or imported (the stale
   `node_modules` failure mode the issue calls out).
2. `pnpm typecheck` — clean, including the frozen suite against the type shim.
3. `pnpm test` — frozen suite green **unmodified**, plus the new pins above.
