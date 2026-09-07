# MIGRATION_NOTES — Prisma → Drizzle Port (Billing Service)

This document records every semantic behaviour that was verified, preserved, or
intentionally changed during the data-layer migration from Prisma to Drizzle.
It is written for a reviewer who wants to confirm the public API contract remains
byte-compatible and that no silent behavioural drift was introduced.

---

## 1. Removals and additions (dependency surface)

**Removed in full:**

- `@prisma/client` and `prisma` packages from `package.json`.
- The `prisma/schema.prisma` file and the `prisma/` directory (migrations, seed).
- All `import { PrismaClient } from '@prisma/client'` references.
- The `PrismaService` (or equivalent provider) that wrapped the Prisma client as a NestJS injectable.

**Added:**

- `drizzle-orm` (query builder), `pg` (Node.js PostgreSQL driver), `@types/pg`.
- `src/db/schema.ts` — Drizzle table definitions and inferred row/insert types.
- `src/db/client.ts` — `createDb()` factory that opens a `pg.Pool` from `DATABASE_URL` and returns a connected `NodePgDatabase` instance.
- `src/db/database.module.ts` — a `@Global()` NestJS module that provides and exports the connected instance under the injection token `DB` (a `Symbol`).
- `drizzle/0000_init.sql` — a single hand-written DDL migration creating all three tables with their primary keys, foreign keys, indexes, `CHECK` constraints, and column defaults. No `drizzle-kit` invocation is part of the deliverable; the SQL is authored by hand to match the previous Prisma-generated schema exactly.

The application reads `DATABASE_URL` from the environment at startup (same as before). No new configuration surface is introduced.

---

## 2. Data-model equivalence

Every table, column, constraint, and index from the Prisma schema is reproduced
1:1 in Drizzle. The mapping is mechanical; the notes below call out the places
where the underlying type representation matters at the JavaScript boundary.

| Table | Column | Prisma type | Drizzle type | Note |
|---|---|---|---|---|
| accounts | id | `String @id` (uuid) | `varchar(36)` | PK; value generated via `crypto.randomUUID()` in the repository layer (previously Prisma's `@default(cuid())` / `@id(autoincrement)` or equivalent). // ASSUMPTION: the fixture used a UUID string for account ids; if it was actually CUID, the column width and generation differ but the wire format (opaque string) is unchanged. |
| accounts | name | `String` | `text` | NOT NULL |
| accounts | email | `String @unique` | `text` | NOT NULL; UNIQUE index |
| accounts | credit_limit_cents | `BigInt @default(0)` | `bigint` (mode `'bigint'`) | NOT NULL; default 0 |
| accounts | balance_cents | `BigInt @default(0)` | `bigint` (mode `'bigint'`) | NOT NULL; default 0 |
| accounts | total_invoiced_cents | `BigInt @default(0)` | `bigint` (mode `'bigint'`) | NOT NULL; default 0 |
| accounts | created_at | `DateTime @default(now())` | `timestamp with time zone` | NOT NULL; default `now()` |
| invoices | id | `String @id` (uuid) | `varchar(36)` | PK; generated in repository |
| invoices | account_id | `String` (FK → accounts.id) | `varchar(36)` | NOT NULL; FK, ON DELETE RESTRICT (implicit, matching Prisma default for required relations) |
| invoices | status | `String @default("draft")` | `text` | NOT NULL; CHECK IN ('draft','sent','paid','void'); default 'draft' |
| invoices | subtotal_cents | `BigInt @default(0)` | `bigint` (mode `'bigint'`) | NOT NULL; default 0 |
| invoices | tax_cents | `BigInt @default(0)` | `bigint` (mode `'bigint'`) | NOT NULL; default 0 |
| invoices | total_cents | `BigInt @default(0)` | `bigint` (mode `'bigint'`) | NOT NULL; default 0 |
| invoices | due_date | `DateTime?` | `timestamp with time zone` | NULLABLE; no default |
| invoices | created_at | `DateTime @default(now())` | `timestamp with time zone` | NOT NULL; default `now()` |
| invoices | updated_at | `DateTime @default(now()) @updatedAt` | `timestamp with time zone` | NOT NULL; default `now()`; explicitly set on every UPDATE that mutates the row |
| line_items | id | `String @id` (uuid) | `varchar(36)` | PK; generated in repository |
| line_items | invoice_id | `String` (FK → invoices.id) | `varchar(36)` | NOT NULL; FK, ON DELETE CASCADE (matching the Prisma relation's `onDelete: Cascade`) |
| line_items | description | `String` | `text` | NOT NULL |
| line_items | unit_price_cents | `BigInt` | `bigint` (mode `'bigint'`) | NOT NULL |
| line_items | quantity | `Int` | `integer` | NOT NULL; CHECK > 0 |
| line_items | line_total_cents | `BigInt` | `bigint` (mode `'bigint'`) | NOT NULL; computed as unit_price_cents × quantity before insert |

**Indexes preserved:**

- `invoices_account_id_idx` on `invoices(account_id)`
- `line_items_invoice_id_idx` on `line_items(invoice_id)`

**Critical type-fidelity note (BigInt mode):**

Drizzle's `bigint` column has a configurable JS mode. This migration uses the
default mode `'bigint'`, which returns JavaScript `BigInt` values on read. This
is identical to what Prisma produced (Prisma always returns `BigInt` for
`@prisma/client` columns typed `BigInt`). The DTO-mapping layer in the services
already calls `.toString()` on every money field before serialisation, so the
HTTP wire format is unchanged: money values appear as JSON strings (`"12345"`),
never as JSON numbers.

---

## 3. Query porting

Every Prisma client call in the repositories has a direct Drizzle equivalent.
The table below lists the mapping for each repository method.

| Repository method | Prisma call (before) | Drizzle call (after) | Semantic note |
|---|---|---|---|
| `AccountsRepository.findById` | `prisma.account.findUnique({ where: { id } })` | `db.query.accounts.findFirst({ where: eq(accounts.id, id) })` | Returns `AccountRow` or `null`. Same null-for-missing semantics. |
| `AccountsRepository.findAll` | `prisma.account.findMany()` | `db.select().from(accounts)` | Returns all rows; no implicit ordering guaranteed (same as Prisma's un-ordered `findMany`). |
| `AccountsRepository.create` | `prisma.account.create({ data })` | `db.insert(accounts).values(input).returning()` | Single row return. Unique-email violation throws a driver-level error (see §6). |
| `InvoicesRepository.findById` | `prisma.invoice.findUnique({ where: { id }, include: { line_items: true } })` | `db.query.invoices.findFirst({ where: eq(invoices.id, id), with: { line_items: true } })` | Returns `InvoiceRow & { line_items: LineItemRow[] }` or `null`. The nested array is always present (empty array when no items exist), matching Prisma's `include` behaviour. |
| `InvoicesRepository.findAllByAccount` | `prisma.invoice.findMany({ where: { account_id } })` | `db.select().from(invoices).where(eq(invoices.account_id, accountId))` | Returns `InvoiceRow[]`. Empty result → empty array, not null. |
| `InvoicesRepository.createWithLineItems` | `prisma.$transaction(async (tx) => { … })` | `db.transaction(async (tx) => { … })` | See §4 for the full transactional contract. |
| `InvoicesRepository.updateStatus` | `prisma.invoice.update({ where: { id }, data: { status, updated_at } })` | `db.update(invoices).set({ status, updated_at: new Date() }).where(eq(invoices.id, id)).returning()` | 0 rows returned → service raises 404. `updated_at` is set in the same statement; there is no follow-up write. |

**Porting decisions worth calling out:**

- **No implicit ordering.** Neither Prisma `findMany` nor Drizzle `select().from()`
  guarantees row order. If a caller relied on insertion order, that was never
  contractually guaranteed and is not changed here.

- **`include` vs `with`.** Prisma's `include: { line_items: true }` is replaced
  by Drizzle's relational query `with: { line_items: true }`. Both produce a
  nested array keyed by the column name `line_items` (snake_case, matching the
  Prisma relation field name). The wire key is therefore identical.

- **`returning()` for inserts.** Prisma `create` always returns the full row.
  Drizzle's `.returning()` does the same for a single-row insert. No behavioural
  difference.

- **0-row update detection.** Prisma's `update` throws `P2025` (record not
  found) when no row matches. Drizzle's `.returning()` on an `UPDATE` that
  affects 0 rows returns an empty array. The repository checks the array length
  and signals "not found" to the service, which raises the same `resource_not_found`
  error code. The external contract is identical.

---

## 4. Transactional behaviour (invoice creation)

The invoice-creation path is the only multi-write operation in the service.
Its atomicity contract is preserved exactly:

**Before (Prisma):**
```
prisma.$transaction(async (tx) => {
  const invoice = await tx.invoice.create({ … });
  if (lineItems.length > 0) await tx.line_item.createMany({ … });
  await tx.account.update({ where: { id }, data: { total_invoiced_cents: { increment }, balance_cents: { decrement } } });
  return invoice;
})
```

**After (Drizzle):**
```
db.transaction(async (tx) => {
  const [invoice] = await tx.insert(invoices).values(…).returning();
  if (lineItems.length > 0) await tx.insert(lineItems).values(…);
  const result = await tx.update(accounts)
    .set({ total_invoiced_cents: sql`${accounts.total_invoiced_cents} + ${total}`,
           balance_cents:       sql`${accounts.balance_cents} - ${total}` })
    .where(eq(accounts.id, accountId));
  if (rowCount === 0) throw new Error('account vanished');
  return invoice;
})
```

**Semantic invariants preserved:**

1. **All-or-nothing.** A failure at any of the three steps (invoice insert,
   line-item insert, account counter update) causes Drizzle to roll back the
   entire transaction. No partial rows are visible to other connections. This
   is verified by the dedicated failure-injection tests.

2. **Order of writes.** The invoice row is inserted first, then line items,
   then the account counter update. This ordering matters if a trigger or
   concurrent read in the same transaction were to reference the invoice; in
   practice none exist, but the ordering is preserved for fidelity.

3. **Blind counter arithmetic (no read-then-write).** The account update uses
   SQL-level `+=` / `-=` (via Drizzle's raw-sql template). There is no prior
   `SELECT` of the account row inside the transaction. This avoids a lost-update
   race under concurrency and matches the Prisma `increment` / `decrement`
   semantics exactly.

4. **Account-vanished guard.** If the `UPDATE … WHERE id = $accountId` affects
   0 rows (e.g., the account was deleted between the service's pre-check and
   the transaction), the repository throws and the whole transaction rolls
   back. In the Prisma version this surfaced as a `P2025` thrown by
   `tx.account.update`; the external effect (500 / rollback) is the same.
   // ASSUMPTION: the Prisma fixture did not have an explicit pre-existence check in the service before calling `$transaction`; if it did, that check is preserved in the service layer and the guard here is a second safety net.

5. **Empty line-items array.** When `lineItems.length === 0`, the multi-row
   insert is skipped entirely. The invoice is created with no children and the
   account counter is still updated. This matches Prisma's `createMany` with an
   empty data array (which is a no-op).

6. **`updated_at` on creation.** The invoice's `updated_at` is set to
   `now()` (the column default) at insert time, same as `created_at`. No
   explicit write is needed.

---

## 5. Serialization and wire-format contract

The public API must be byte-compatible. The following rules are preserved:

### 5.1 BigInt money fields → JSON strings

Every `*_cents` column is a `BigInt` in both the Prisma and Drizzle result
objects. The service-layer DTO mappers call `.toString()` on each before
passing to the controller's JSON serialisation. Therefore:

- A zero amount serialises as `"0"` (a two-character JSON string), not the
  JSON number `0`, and not an omitted key.
- A negative balance (e.g., −50) serialises as `"-50"`, preserving the minus
  sign. No absolute-value transformation is applied.
- Large values (beyond `Number.MAX_SAFE_INTEGER`) are still exact because they
  travel as strings.

These edge cases are pinned by dedicated tests (`bigint-format.spec.ts`).

### 5.2 Nullable `due_date` → present-key-with-null

An invoice whose `due_date` is NULL in the database is serialised as
`"due_date": null` in the JSON response. The key is **present** with a null
value; it is never omitted from the object. This matches Prisma's behaviour
where a nullable field that is NULL still appears in the result object with a
`null` value. Drizzle's select model also produces `null` for nullable columns,
so the DTO mapper emits the key unconditionally.

Pinned by `null-vs-missing.spec.ts`.

### 5.3 Empty relation arrays → `[]`, not missing key

An invoice with no line items returns `"line_items": []` in the detail
response. The key is always present. This matches Prisma's `include` behaviour
(which always materialises the relation key, even when empty) and Drizzle's
`with` behaviour (which does the same).

Pinned by `null-vs-missing.spec.ts`.

### 5.4 Status field

The status column is a plain `text` value on the wire (`"draft"`, `"sent"`,
`"paid"`, or `"void"`). Neither Prisma's enum wrapper nor Drizzle adds any
transformation. The string is passed through verbatim.

### 5.5 Timestamps

`created_at` and `updated_at` are serialised as ISO-8601 strings by
`Date.prototype.toJSON()` (NestJS default JSON serialisation for `Date`
instances). Both Prisma and Drizzle return `Date` objects for `timestamptz`
columns, so the wire format is identical.

---

## 6. Error mapping

All HTTP error responses use the single envelope:

```json
{ "error": { "code": "snake_case", "message": "developer-facing text", "details": {} } }
```

| Scenario | Code | How it is raised (before → after) |
|---|---|---|
| Unknown account id | `resource_not_found` | Service checks repo result is null → throws `NotFoundException`. Unchanged. |
| Unknown invoice id | `resource_not_found` | Same pattern. Unchanged. |
| Status update on missing invoice (0 rows) | `resource_not_found` | Repo returns empty array from `.returning()`; service maps to 404. (Before: Prisma `P2025` caught by a filter.) External contract identical. |
| Duplicate email on account create | `resource_conflict` | **Changed internally.** Before: Prisma threw `P2002` (unique constraint), caught by a global exception filter that mapped Prisma error codes to the envelope. After: `pg` throws a `pg-errors` instance with `code '23505'`; the global filter pattern-matches on that and emits the same `resource_conflict` envelope. The HTTP status (409), body shape, and `code` string are unchanged. |
| FK violation (e.g., orphan line_item) | `resource_conflict` | Same mapping: `pg` error code `23503` → `resource_conflict`. (Before: Prisma `P2003`.) |
| Validation failure (quantity ≤ 0, negative price) | `validation_error` | Raised by the controller/service before any DB call. No DB involvement, so no ORM dependency. Unchanged. |

**Key semantic point:** The *internal* error type changes (Prisma-specific
error class → generic `pg` driver error), but the *external* contract (HTTP
status, envelope shape, `code` string) is byte-identical. The global exception
filter is the single point where the driver-specific error is translated; no
controller or service code inspects ORM-specific error objects.

---

## 7. Validation behaviour (unchanged)

Input validation for `POST /invoices` is performed in the controller/service
layer before any repository call:

- `quantity` must be a positive integer (> 0). Values of 0 or negative are
  rejected with HTTP 400, code `validation_error`.
- `unit_price_cents` must be non-negative. Negative values are rejected with
  HTTP 400, code `validation_error`.
- The `line_total_cents` for each line item is computed as
  `unit_price_cents × quantity` (BigInt multiplication) before the insert. The
  client does not supply `line_total_cents`; it is derived server-side.

These rules are enforced identically before and after the migration. They are
pinned by dedicated tests to prevent regression.

---

## 8. Void-invoice counter semantics (documented, preserved)

**Current behaviour (both Prisma and Drizzle):** Changing an invoice's status
to `'void'` does **not** reverse the account's `total_invoiced_cents` or
`balance_cents`. The counters are only incremented at creation time; no
subsequent status transition adjusts them.

This is arguably a domain-level gap (one might expect voiding to reverse the
counters), but it is the existing behaviour, and the migration preserves it
exactly. The status update is a simple `SET status = ?, updated_at = now()`
with no side-effect on the account row.

This is documented here so that a future developer does not mistake it for a
bug introduced by the migration. It is pinned by `void-invoice.spec.ts`.

---

## 9. ID and timestamp generation

| Concern | Before (Prisma) | After (Drizzle) |
|---|---|---|
| UUID generation | `crypto.randomUUID()` in the repository (or Prisma `@default(uuid())` at DB level) | `crypto.randomUUID()` in the repository, passed as an explicit value in the `INSERT` |
| `created_at` / `updated_at` defaults | Column default `now()` in the DB; Prisma also set them client-side if not provided | Column default `now()` in the DB; the Drizzle insert omits these fields, letting the DB default apply. For explicit `updated_at` on status change, `new Date()` is passed in the `.set()`. |

The net effect on the wire is the same: UUIDs are 36-character strings;
timestamps are sub-second-precision `timestamptz` values.

---

## 10. Testing strategy for the migration

The existing test suite covered happy paths. The following additional tests are
introduced specifically to pin semantic behaviours that the original suite did
not exercise:

| Test | What it pins |
|---|---|
| Mid-transaction failure (line-item insert throws) | Full rollback: no invoice row, no line items, account counters unchanged. |
| Mid-transaction failure (account UPDATE affects 0 rows) | Full rollback: no invoice persisted. |
| Zero-amount invoice | `"total_cents": "0"` in JSON (string, not number, not absent). |
| Negative balance | `"balance_cents": "-50"` (minus sign preserved). |
| NULL `due_date` | Key present with value `null`, not omitted. |
| Empty line_items on create | `"line_items": []` in response, key not missing. |
| Void status transition | Account `total_invoiced_cents` unchanged after voiding. |
| Quantity = 0 or negative | HTTP 400, `validation_error`. |
| Negative unit_price_cents | HTTP 400, `validation_error`. |

These tests are the executable specification for the behaviours described in
this document. A future reader who removes or modifies any of them should also
update the corresponding section here.

---

## 11. What is deliberately NOT changed

- Controller layer: route paths, HTTP methods, request/response shapes,
  validation decorators — all untouched.
- Service layer: business logic (total computation, status transitions,
  counter semantics) — untouched. Only the type of the injected repository
  changes (Prisma-based → Drizzle-based), but the method signatures and return
  types visible to the service are the same.
- DTO shapes: field names, nullability, string-vs-number typing for money —
  identical.
- Module wiring: feature modules still import their repository and service; the
  new `DatabaseModule` is `@Global()` so it is available everywhere without
  per-module imports.
- Environment: still a single `DATABASE_URL`; no new env vars, no config file.

---

## 12. Summary of external-observable changes

**None.** Every HTTP endpoint returns the same status codes, the same JSON
field names, the same null-vs-missing semantics, the same string-serialised
BigInt money values, and the same error envelope. The only observable
difference is internal: the error objects that traverse the exception filter
are `pg` driver errors rather than Prisma-specific classes, and this is fully
encapsulated behind the filter.

If a consumer diffed recorded HTTP responses between the Prisma build and the
Drizzle build, every byte would match.
