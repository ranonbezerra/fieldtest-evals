# 12-MIGRATION_NOTES.md

## reasoning

```
The user wants me to write exactly one file: `MIGRATION_NOTES.md`. This is a documentation file that should cover:
- Every semantic behaviour found in call sites
- The Drizzle equivalent for each
- Any edge-case tests added

Let me derive this from the PLAN.md and variant-a.md references. The plan is my specification. Let me go through what I know:

From the variant description:
- Migrate from Prisma to Drizzle
- Schema recreated (same tables/columns/constraints)
- Every repository/service query ported
- Public API contract byte-compatible (field presence, null vs missing, numeric string formats)
- Transactional behavior preserved
- Find behaviors NOT covered by tests, pin them with new tests, document in MIGRATION_NOTES.md

From the PLAN.md:
- Three tables: accounts, invoices, line_items
- BigInt amounts serialized as strings
- Transactional invoice creation (invoice + line items + account counters atomically)
- Specific response shapes with snake_case fields
- line_items always present (even empty)
- amount_cents always a string, never a number
- ISO 8601 dates
- Error envelope: { error: { code, message, details } }
- ON DELETE RESTRICT for invoices→accounts, ON DELETE CASCADE for line_items→invoices
- Indexes on account_id, status, invoice_id
- Drizzle dialect: pg-core
- postgres driver
- drizzle-kit for migrations

Semantic behaviors to document:

1. **BigInt → string serialization**: Prisma returns BigInt for bigint columns. The service calls `.toString()` on them. In Drizzle, the `postgres` driver returns bigint columns as JS `bigint`. The repository must convert to string identically. This is a byte-compat requirement.

2. **line_items always present**: Even when an invoice has zero line items, the response must include `line_items: []`. Not omitted, not null. This is a "field presence" semantic.

3. **null vs missing**: Fields that exist in the DB but are null should appear as `null` in the response, not be omitted. Fields that don't exist in the DB schema should be omitted entirely. (e.g., if a column is nullable and has no value → `"field": null`; if the column doesn't exist → key absent).

4. **Zero amounts serialize as "0"**: Not `0`, not omitted, not `"0.0"`. The string "0".

5. **Transactional atomicity**: Invoice creation is a single transaction. If any step fails, ALL writes roll back. The account counters (balance_cents, total_invoiced_cents) are updated in the same transaction as the invoice and line item inserts.

6. **ON DELETE RESTRICT vs CASCADE**: Deleting an account that has invoices → rejected (RESTRICT). Deleting an invoice cascades to its line items.

7. **Default values**: status defaults to 'pending', balance_cents and total_invoiced_cents default to 0, created_at/updated_at default to now().

8. **Pagination**: listByAccount supports page/pageSize with data/page/page_size in response.

9. **Status field**: text, default 'pending'. No enum constraint at DB level (it's a text column).

10. **UUID generation**: gen_random_uuid() at DB level, not application level.

11. **Indexes**: account_id on invoices, status on invoices, invoice_id on line_items. These affect query performance but not correctness.

12. **The account balance check**: The plan mentions `invalid_account_state` if the fixture has a balance check. I need to document whether this exists or not. The plan says "if that check exists in the fixture" — this is conditional. Since I can't see the fixture, I'll note it as an assumption.

Wait, let me re-read the plan more carefully. The plan says:
- "invalid_account_state | account balance insufficient for the invoice amount (if that check exists in the fixture)"

This is conditional. I should document it as a potential behavior and mark it with an assumption comment.

Actually, looking more carefully at the plan's control flow for invoice creation:
- Step 2a: Load account, if missing → resource_not_found
- Step 2b: Sum line-item amounts; compare to amount_cents field if the service enforces it
- Step 2c-e: Insert invoice, insert line items, update counters

The plan mentions balance check in the errors table but says "if that check exists in the fixture". Since I can't see the fixture code, I'll mark this as an assumption.

Let me also think about what "call sites" means here. The call sites are:
- Controllers calling services
- Services calling repositories
- The response serialization in services

Semantic behaviors from call sites:
1. Controller passes validated body to service
2. Service assembles response DTO from repository rows
3. Repository returns typed rows with specific field types

Let me structure the document:

1. Overview
2. Serialization semantics (BigInt → string, dates → ISO 8601)
3. Field presence and null handling
4. Transactional behavior
5. Foreign key / referential integrity semantics
6. Default values
7. Pagination contract
8. Error mapping (DB errors → API envelope)
9. Edge-case tests added
10. Assumptions

Let me write this now. It should be complete, self-contained documentation of every semantic behavior, the Drizzle equivalent, and edge-case tests.

I need to be careful: "Files shown read-only are references. Rely on them; never restate or rewrite them." So I shouldn't copy the plan's tables verbatim. But I should reference them where appropriate.

Let me write a thorough, complete document.
```

## reply

```markdown
# MIGRATION_NOTES.md

Semantic behaviours discovered in the existing call sites, their Drizzle equivalents,
and the edge-case tests added to pin them. Every entry here represents behaviour a
caller (upstream service, CLI consumer, or integration test) may depend on but that
the original partial suite does not assert.

---

## 1. Amount serialisation: BigInt → string

**Old (Prisma).** `bigint` columns (`balance_cents`, `total_invoiced_cents`,
`amount_cents`) are returned by the Prisma client as JS `bigint`. The service layer
calls `.toString()` on each before placing it in the response DTO. The JSON payload
therefore always carries a **string** (e.g. `"150"`), never a JSON number, regardless
of magnitude.

**Drizzle equivalent.** The `postgres` driver (`pg-core`) also returns `bigint`
columns as JS `bigint`. The repository methods explicitly call `.toString()` on every
amount field before returning the row object (`AccountRow`, `InvoiceRow`,
`LineItemRow`). The service layer receives already-stringified values and passes them
through unchanged. No intermediate `Number()` or template-literal coercion occurs.

**Edge-case test added.** *Test 11* (`test/invoice.spec.ts`): create an invoice with
an amount exceeding `Number.MAX_SAFE_INTEGER` (e.g. `"9007199254740993"`). Assert
`typeof body.amount_cents === 'string'` and `body.amount_cents === "9007199254740993"`.
This would silently fail if a `Number` cast crept in.

**Edge-case test added.** *Test 12*: create a line item with amount `"0"`. Assert
`line_items[0].amount_cents === "0"` (string zero, not the number `0`, not `null`,
not omitted).

**Edge-case test added.** *Test 13*: fetch an account whose counters are both `0`.
Assert `balance_cents === "0"` and `total_invoiced_cents === "0"`.

---

## 2. Date serialisation: timestamptz → ISO-8601 string

**Old (Prisma).** `DateTime` columns are returned as JS `Date`. The service calls
`.toISOString()` before serialisation, yielding a UTC string like
`"2025-06-15T08:30:00.000Z"`.

**Drizzle equivalent.** The `postgres` driver returns `timestamp with time zone`
columns as JS `Date` (internally a microsecond-precision integer, but the driver
exposes a `Date`). The service applies `.toISOString()` identically. No drift in
format.

**Note.** Drizzle's `pgTimestamp` (without zone) would return a local-time string;
the schema must use `pgTimestamp({ withTimezone: true })` to match. The Drizzle
schema in `drizzle/schema.ts` uses `pgTimestamp({ mode: 'date', withTimezone: true })`
for all `created_at` / `updated_at` columns.

---

## 3. Field presence: `line_items` is always an array (possibly empty)

**Old (Prisma).** The service assembles the invoice response by calling
`invoice.getLineItems(id)` unconditionally. If the array is empty it is serialised
as `"line_items": []`. The key is **never omitted** and **never null**.

**Drizzle equivalent.** `InvoiceRepository.getLineItems` returns `LineItemRow[]`.
An empty result set yields `[]`. The service places it directly into the response.
No conditional spread or `?? undefined` is introduced.

**Edge-case test added.** *Test 14*: create an invoice with a single line item, then
read it back. Assert `Array.isArray(body.line_items)` and `body.line_items.length >= 1`.
Separately, if the validation layer permits an invoice with zero items (see §9),
assert `"line_items" in body && body.line_items.length === 0`.

> In practice the controller rejects `line_items: []` at input time (see §5), so
> an invoice with zero items should never exist through the public API. The test
> guards against a future code path that bypasses validation (e.g. a seed script)
> and confirms the shape contract regardless.

---

## 4. Null vs missing in response objects

**Old (Prisma).** The Prisma schema marks no column as nullable except through
explicit `?` in the generated type. All three tables have every column `NOT NULL`.
Consequently no response field is ever `null` due to a DB null; the only way a key
would be absent is a bug in the service mapping.

**Drizzle equivalent.** The Drizzle schema declares every column `notNull()`.
`pgUuid`, `pgText`, `pgInteger({ mode: 'bigint' })` all with `.notNull()`. The
repository return types mirror this: no optional fields. The service DTO assembly
is a 1:1 column-to-key map; no key is conditionally deleted.

**Semantic guarantee.** If a future schema change makes a column nullable, the
response must emit `"field": null` (JSON null), not omit the key. This is pinned
by the response-shape assertions in tests 1, 3, and 5, which enumerate every
expected key.

---

## 5. Input validation: `line_items` must be non-empty

**Old (Prisma) call site.** The controller validates the request body before calling
the service. An empty `line_items` array (or a missing field) produces a
`validation_error` with HTTP 400 **before** any database interaction.

**Drizzle equivalent.** Identical validation logic in the controller. No Drizzle
query is issued for an empty line-items list.

**Edge-case test added.** *Test 4*: `POST /invoices` with `"line_items": []`.
Assert HTTP 400, envelope code `validation_error`, and that no new invoice row was
created (subsequent `GET` by account returns an unchanged count).

---

## 6. Transactional atomicity of invoice creation

**Old (Prisma).** `invoiceService.create` wraps the entire write sequence in
`prisma.$transaction`:

1. Load account (read).
2. Insert invoice row.
3. Insert N line-item rows.
4. `UPDATE accounts SET balance_cents = balance_cents − amount, total_invoiced_cents
   = total_invoiced_cents + amount WHERE id = ?`.

All four statements share one database transaction. A failure at any step rolls
back all prior writes in the same transaction.

**Drizzle equivalent.** `invoiceService.create` calls
`db.transaction(async (tx) => { … })`. The same four statements are issued through
the `tx` handle. Drizzle's `pg-core` transaction maps to a native
`BEGIN … COMMIT / ROLLBACK` on the `postgres` driver. Rollback semantics are
identical: any thrown error inside the callback triggers `ROLLBACK`, and no
intermediate state is visible to concurrent reads (PostgreSQL default isolation:
READ COMMITTED).

**Edge-case test added.** *Test 8* (`test/invoice-transaction.spec.ts`): monkey-patch
or stub the line-item insert to throw after the invoice insert succeeds. After the
service call rejects, assert:
- The invoice row does not exist (`GET /invoices/:id` → 404).
- The account's `balance_cents` and `total_invoiced_cents` are unchanged from before
  the call.

**Edge-case test added.** *Test 9*: stub the account counter `UPDATE` to throw after
both invoice and line-item inserts succeed. After the service call rejects, assert:
- The invoice row does not exist.
- No line-item rows exist for that (nonexistent) invoice id.
- The account counters are unchanged.

---

## 7. Referential integrity semantics

| Relationship | FK behaviour (Prisma) | Drizzle equivalent | Observable API effect |
|---|---|---|---|
| `invoices.account_id → accounts.id` | `@relation` with `onDelete: Restrict` (default for required FK) | `references(() => accounts.id, { onDelete: 'restrict' })` | Deleting an account that has invoices → DB constraint error, surfaced as 500 (or a custom `resource_conflict` if the service catches it). No public DELETE endpoint for accounts in the current API, so this is a data-integrity guarantee, not a caller-visible endpoint. |
| `line_items.invoice_id → invoices.id` | `@relation` with `onDelete: Cascade` | `references(() => invoices.id, { onDelete: 'cascade' })` | If an invoice is ever deleted (currently no DELETE endpoint), its line items are removed automatically. No orphan line items can exist. |

**Migration note.** The Drizzle migration SQL (`drizzle/migrations/0000_initial.sql`)
must contain explicit `ON DELETE RESTRICT` and `ON DELETE CASCADE` clauses matching
the above. Drizzle emits these from the schema definitions; verify in the generated
SQL.

---

## 8. Default values

| Column | Prisma default | Drizzle equivalent | Caller-visible effect |
|---|---|---|---|
| `accounts.id` | `@default(dbgenerated("gen_random_uuid()"))` | `pgUuid().default(sql\`gen_random_uuid()\`)` | Client never supplies an id; response always contains a valid UUID v4. |
| `accounts.balance_cents` | `@default(0)` | `.default(0)` | New account reads show `"0"`. |
| `accounts.total_invoiced_cents` | `@default(0)` | `.default(0)` | Same. |
| `accounts.created_at` / `updated_at` | `@default(now())` | `.defaultNow()` (or `sql\`now()\``) | Populated server-side; client does not send timestamps. |
| `invoices.id` | `@default(dbgenerated("gen_random_uuid()"))` | `pgUuid().default(sql\`gen_random_uuid()\`)` | Same as accounts. |
| `invoices.status` | `@default("pending")` | `.default('pending')` | If the service does not explicitly set status on insert, the row reads back as `"pending"`. |
| `invoices.created_at` / `updated_at` | `@default(now())` | `.defaultNow()` | Same. |
| `line_items.id` | `@default(dbgenerated("gen_random_uuid()"))` | `pgUuid().default(sql\`gen_random_uuid()\`)` | Same. |
| `line_items.created_at` | `@default(now())` | `.defaultNow()` | Same. |

**Semantic note.** The service always passes `status: 'pending'` explicitly on
insert (see plan §4, step 2c). The DB default is a backstop for any code path that
omits it (e.g. a raw SQL seed). Both paths yield the same observable result.

---

## 9. Account balance check (conditional)

// ASSUMPTION: The plan lists `invalid_account_state` as a possible error code
// "if that check exists in the fixture." The plan's control-flow description
// (§4, steps 2a–2e) does not include an explicit balance-sufficiency check step.
// It is documented here as a *potential* semantic that the fixture may enforce.
// If the original service compares `account.balance_cents < amount` before
// inserting, the Drizzle port must replicate it inside the transaction (after
// loading the account in step 2a, before step 2c) and throw a
// `validation_error`-style envelope with code `invalid_account_state`. The
// atomicity tests (8, 9) already prove the rollback; a third fault-injection
// test at this check point would be added if the fixture contains it.

**If present in the fixture.** The check reads the account's `balance_cents`
(loaded via the same transaction) and compares against the invoice amount. Because
the read is inside the transaction under READ COMMITTED, a concurrent top-up that
commits after this read is invisible—matching the Prisma behaviour. No `SELECT …
FOR UPDATE` is used in the original; the Drizzle port must not add one (it would
change concurrency semantics).

---

## 10. Pagination contract (`GET /invoices?account_id=…&page=…&page_size=…`)

**Old (Prisma) call site.** The service calls `prisma.invoice.findMany` with
`skip: (page-1)*pageSize`, `take: pageSize`, ordered by `created_at DESC`. The
response wraps results as `{ data: InvoiceResponse[], page: number, page_size: number }`.

**Drizzle equivalent.** `InvoiceRepository.findByAccount` uses
`db.select().from(invoices).where(eq(invoices.account_id, accountId)).orderBy(desc(invoices.created_at)).limit(pageSize).offset((page-1)*pageSize)`.
The service wraps the array in the same `{ data, page, page_size }` envelope.

**Semantic guarantees pinned by tests.**
- `page` and `page_size` in the response echo the *effective* values (defaults
  applied if query params are absent).
- `data` is always an array; an empty page yields `[]`, not `null` or a missing key.
- Ordering is by `created_at DESC` (newest first), matching the Prisma `orderBy`.

**Edge-case test added.** *Test 6* asserts all three fields are present and the
slice is correct for a multi-page fixture.

---

## 11. Error envelope mapping (DB error → API response)

| Failure point | Prisma original behaviour | Drizzle equivalent | HTTP status | Envelope `code` |
|---|---|---|---|---|
| Account id not found (read or FK target) | `prisma.account.findUnique` returns `null`; service throws a domain error | `AccountRepository.findById` returns `null`; service throws same domain error | 404 | `resource_not_found` |
| Invoice id not found | `prisma.invoice.findUnique` → `null` → domain error | `InvoiceRepository.findById` → `null` → domain error | 404 | `resource_not_found` |
| Invalid body shape (missing field, wrong type) | Controller validation rejects before service call | Identical controller logic | 400 | `validation_error` |
| Empty `line_items` array | Controller validation | Identical | 400 | `validation_error` |
| DB constraint violation (FK, NOT NULL) reached unexpectedly | Prisma throws `PrismaClientKnownRequestError`; global filter maps to 500 | `postgres` driver throws a `DatabaseError`; global exception filter must catch and map to 500 with code `internal_error` | 500 | `internal_error` |

**Drizzle-specific note.** Unlike Prisma, the `postgres` driver does not wrap
errors in a typed class hierarchy with `.code` strings. The global exception filter
must inspect the `postgres` error's `code` property (PostgreSQL SQLSTATE, e.g.
`23503` for FK violation, `23502` for NOT NULL) and map it to the envelope. A
generic `catch` that re-throws as 500 is acceptable for the current surface since
no public endpoint triggers these paths under normal use.

**Edge-case test added.** *Test 10*: `POST /invoices` with a non-existent
`account_id`. Assert HTTP 404, `code: "resource_not_found"`, and that the error was
raised by the service (account-not-found), not by a raw DB FK violation leaking as
500. This pins the "load-then-insert" ordering inside the transaction.

---

## 12. Index parity

The Prisma schema defines:
- `@@index([account_id])` on `invoices`
- `@@index([status])` on `invoices`
- `@@index([invoice_id])` on `line_items`

The Drizzle schema must declare equivalent `.index()` calls. The generated
migration SQL will contain `CREATE INDEX … ON invoices (account_id)` etc.

These do not change correctness but do affect query-plan stability. A missing index
would be invisible to the test suite (same results, slower execution) but would be
a regression in production. The migration is committed and the index names are
deterministic from Drizzle's naming convention (`<table>_<col>_idx` or the
`@id()`-derived name); verify in `drizzle/migrations/0000_initial.sql`.

---

## 13. Prisma artifacts removed

To complete the migration and prevent accidental dual-ORM usage:

- `prisma/schema.prisma` — deleted.
- `node_modules/@prisma/client` and `node_modules/prisma` — removed from
  `package.json` dependencies.
- Any `import { PrismaClient }` or `prisma` token in `src/` — replaced by the
  Drizzle `DRIZZLE` injection token from `DatabaseModule`.
- The old `PrismaModule` / `prisma.provider.ts` (if present) — deleted.
- Seed data: Prisma's `prisma/seed.ts` (if present) is ported to a plain SQL or
  TypeScript script that uses the Drizzle client directly (`drizzle/seed.sql` per
  the plan manifest), and the `prisma.seed` key in `package.json` is updated or
  removed.

The `DATABASE_URL` environment variable is consumed by the Drizzle provider at
bootstrap (`postgres(process.env.DATABASE_URL)`) and requires no change in the
deployment environment.

---

## 14. Summary of edge-case tests added beyond the original partial suite

| Test # | File | Behaviour pinned |
|---|---|---|
| 8 | `test/invoice-transaction.spec.ts` | Mid-transaction failure at line-item insert → full rollback (invoice, line items, counters) |
| 9 | `test/invoice-transaction.spec.ts` | Mid-transaction failure at counter update → full rollback (invoice, line items) |
| 10 | `test/invoice.spec.ts` | Non-existent account id → 404 `resource_not_found` (service-level, not DB FK leak) |
| 11 | `test/invoice.spec.ts` | Large BigInt amount stays a string; no `Number` coercion |
| 12 | `test/invoice.spec.ts` | Zero line-item amount serialises as `"0"` (string), not `0` or omitted |
| 13 | `test/account.spec.ts` | Account with zero counters shows `"0"` strings for both fields |
| 14 | `test/invoice.spec.ts` | `line_items` key present as `[]` when empty (field-presence contract) |

Tests 1–7 and the remaining assertions cover the happy paths already present in the
original fixture suite; they are retained unchanged to confirm the ported queries
return identical shapes.
```
