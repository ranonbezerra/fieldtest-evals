# 13-account.spec.ts-cases

## reasoning

```
The user wants me to list test cases for `test/account.spec.ts` based on the PLAN.md and the implementation files shown. Let me analyze what the account feature does and what behaviors need to be pinned.

From the implementation files:

**AccountController:**
- `GET /accounts/:id` — returns 200 with account data, or 404 (resource_not_found) if not found, or 500 (internal_error) for unexpected errors
- `POST /accounts` — validates body has non-empty string `name`, returns 400 if not, then creates and returns 201

**AccountService:**
- `findById(id)` — calls repo.findById, throws NotFoundException if null, maps to AccountResponse
- `create(data)` — calls repo.create, maps to AccountResponse
- `toResponse(row)` — maps AccountRow to AccountResponse (id, name, balance_cents as string, total_invoiced_cents as string, created_at/updated_at as ISO strings)

**AccountRepository:**
- `findById(id)` — SELECT from accounts WHERE id = ? LIMIT 1, returns row or null
- `create(data)` — INSERT into accounts with name, returns the row
- `updateCounters(id, deltaBalance, deltaInvoiced)` — UPDATE accounts SET balance_cents = balance_cents + delta, total_invoiced_cents = total_invoiced_cents + delta, updated_at = now() WHERE id = ?

**AccountRow:**
- id: string (uuid)
- name: string
- balance_cents: string (bigint serialized as string)
- total_invoiced_cents: string (bigint serialized as string)
- created_at: Date
- updated_at: Date

**AccountResponse:**
- id: string
- name: string
- balance_cents: string
- total_invoiced_cents: string
- created_at: string (ISO 8601)
- updated_at: string (ISO 8601)

Now let me think about what test cases are needed:

From PLAN.md section 5, tests 1, 2, 13 are for account.spec.ts:
1. GET /accounts/:id returns 200 with all fields — Account read shape, string amounts, ISO dates
2. GET /accounts/:id returns 404 for missing id — resource_not_found envelope, not 500
13. Account with zero balance still shows "0" for both counters — Default/zero serialisation as string

But I need to think more broadly about what could break:

**GET /accounts/:id:**
- Happy path: returns 200, all fields present (id, name, balance_cents, total_invoiced_cents, created_at, updated_at)
- balance_cents is a string (not a number) — this is the BigInt serialization concern
- total_invoiced_cents is a string
- created_at and updated_at are ISO 8601 strings (not Date objects, not epoch numbers)
- 404 for non-existent id with correct error envelope {error: {code: "resource_not_found", message, details: {}}}
- The 404 error has `details` as an object (empty), never null

**POST /accounts:**
- Happy path: 201, returns created account with all fields, balance_cents = "0", total_invoiced_cents = "0" (defaults)
- Validation: missing name → 400, validation_error
- Validation: empty string name → 400
- Validation: whitespace-only name → 400 (the controller checks `.trim().length === 0`)
- Validation: name is not a string (e.g., number) → 400
- Validation: body is null/undefined → 400

**updateCounters (indirectly tested via invoice creation, but the account side):**
- After an invoice is created, balance_cents decreases and total_invoiced_cents increases
- The counters are updated atomically with the invoice (tested in transaction spec, not here)
- But we should verify the account reflects correct counter values after operations

**Edge cases:**
- Large balance values: balance_cents should remain a string even for values that would lose precision as JS numbers (e.g., > Number.MAX_SAFE_INTEGER)
- The id field is a UUID string

**What I'm NOT testing here:**
- Transactional atomicity of counter updates (that's in invoice-transaction.spec.ts)
- The full invoice creation flow (that's in invoice.spec.ts)

Let me also think about:
- GET /accounts/:id with a malformed UUID (not a valid UUID format) — does it return 404 or 500? The repository does `eq(accounts.id, id)` which would just not match, so it should return 404. This is important because if Drizzle throws on an invalid UUID format, you'd get a 500 instead of 404.
- POST /accounts with extra fields in body — should they be ignored?

Let me structure the list now:

1. GET /accounts/:id returns 200 with all six fields present and correctly typed
2. GET /accounts/:id — balance_cents and total_invoiced_cents are strings (typeof === 'string'), not numbers
3. GET /accounts/:id — created_at and updated_at are ISO 8601 date strings (match a regex or parse correctly)
4. GET /accounts/:id for a non-existent UUID returns 404 with the resource_not_found envelope
5. GET /accounts/:id for a non-existent UUID — error body has details as {} (empty object), not null or missing
6. GET /accounts/:id with a malformed id (e.g., "not-a-uuid") returns 404, not 500
7. POST /accounts with valid name returns 201 and the response includes balance_cents "0" and total_invoiced_cents "0"
8. POST /accounts with valid name — created_at and updated_at are present and ISO 8601
9. POST /accounts with missing name field returns 400 validation_error
10. POST /accounts with empty string name returns 400 validation_error
11. POST /accounts with whitespace-only name returns 400 validation_error
12. POST /accounts with non-string name (e.g., number 42) returns 400 validation_error
13. POST /accounts with null/undefined body returns 400 validation_error
14. GET /accounts/:id for an account with a large balance (e.g., > 9007199254740991) still returns balance_cents as an exact string

Wait, let me reconsider. The task says "List the test cases for test/account.spec.ts" and the plan says tests 1, 2, 13 are in this file. But I should also think about what else is important for the account module specifically.

Actually, looking more carefully at the plan:
- Test 1: GET /accounts/:id returns 200 with all fields
- Test 2: GET /accounts/:id returns 404 for missing id
- Test 13: Account with zero balance still shows "0" for both counters

But the user is asking me to list ALL test cases that should be in this file, not just the ones in the plan. The plan is a starting point but I should be thorough.

Let me also consider: the updateCounters method on AccountRepository is called from the invoice service within a transaction. In this spec file, we'd test it indirectly (e.g., after creating an invoice, check the account's counters changed). But actually, that's more of an invoice test. However, we could have a test that directly verifies the counter arithmetic is correct by:
1. Create account
2. Create invoice (which updates counters)
3. GET the account and verify balance decreased by amount, total_invoiced increased by amount

But that crosses into invoice territory. I'll keep it focused on what the account endpoints expose.

Let me also think about: is there a GET /accounts (list all) endpoint? Looking at the controller... no, there's only GET /accounts/:id and POST /accounts. So no list endpoint.

Let me finalize my list. I want to be specific about failure conditions.
```

## reply

- **GET /accounts/:id returns 200 with all six fields present** — proves the happy-path read shape. Would fail if Drizzle's `select()` returns a row whose keys don't match the expected `AccountRow` interface (e.g. a column renamed in `drizzle/schema.ts` but not in the mapping), if `findById` returns `undefined` instead of the first element, or if `toResponse` drops a field.

- **GET /accounts/:id — `balance_cents` and `total_invoiced_cents` are `typeof === 'string'`** — proves BigInt→string serialisation survived the migration. Would fail if Drizzle's `postgres` driver returns a native JS `number` or a `BigInt` for a `bigint` column and the repository does not call `String()` on it, so JSON serialisation emits a bare integer or the string `"123"` becomes the number `123`.

- **GET /accounts/:id — `created_at` and `updated_at` are ISO-8601 date strings (e.g. match `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/`)** — proves the `Date → toISOString()` mapping is intact. Would fail if Drizzle returns a primitive epoch number or a `Date` object that NestJS's default JSON serialiser renders as a full `toJSON()` string with extra metadata, or if the repository accidentally maps to `.getTime()`.

- **GET /accounts/:id for a valid-but-absent UUID returns 404 with `error.code === "resource_not_found"`** — proves the not-found branch. Would fail if the repository returns `undefined` instead of `null` for an empty result set (so the `!row` check in the service misses it and a 500 is emitted), or if the error is thrown as a generic `Error` rather than NestJS `NotFoundException` and the controller's `sendError` falls through to the 500 branch.

- **GET /accounts/:id for a non-existent UUID — error body has `details` as `{}` (empty object), not `null`, not missing** — proves the error-envelope contract. Would fail if someone changes `sendError` to omit `details` or set it to `null`, or if a different exception path (e.g. an unhandled Drizzle query error) bypasses `sendError` and NestJS's default exception filter emits a different shape.

- **GET /accounts/:id with a malformed id (e.g. `"not-a-uuid"`) returns 404, not 500** — proves the repository does not throw on a non-UUID string. Would fail if Drizzle's `eq(accounts.id, "not-a-uuid")` causes the Postgres driver to throw a `PG::InvalidTextRepresentation` (22P02) that propagates as an unhandled exception to the 500 branch instead of simply returning an empty row set.

- **POST /accounts with a valid non-empty `name` returns 201 and the response body has `balance_cents === "0"` and `total_invoiced_cents === "0"`** — proves the DB column defaults (`DEFAULT 0` on both `bigint` columns) are applied by the migration and the repository reads them back as the string `"0"`. Would fail if the Drizzle schema omits the `default(0)` on those columns (so the DB stores `NULL` and the repository returns `null` instead of `"0"`), or if the `.returning()` row has the values as `bigint` and no `String()` conversion happens.

- **POST /accounts — the returned `id` is a valid UUID v4 string and `created_at` equals `updated_at` (same instant)** — proves the `gen_random_uuid()` default is wired in the migration and that no application-level code overwrites one of the two timestamps. Would fail if the Drizzle schema sets `defaultRandom()` on a column that Postgres doesn't recognise, or if the migration creates the PK as a serial and the returned `id` is a number.

- **POST /accounts with `name` missing entirely from the body returns 400 with `error.code === "validation_error"`** — proves the validation guard fires before any DB write. Would fail if the controller's `typeof body.name !== 'string'` check is removed or reordered after the service call, letting a `NULL` name hit the NOT NULL column and surface as a 500 DB constraint error.

- **POST /accounts with `name` set to `""` (empty string) returns 400** — proves the trim check catches empty strings. Would fail if the guard is changed to a simple truthiness check that somehow passes `""` (it wouldn't in JS, but would if someone switches to a `.length > 0` on a coerced value), or if the check is removed.

- **POST /accounts with `name` set to `"   "` (whitespace-only) returns 400** — proves the `.trim().length === 0` branch. Would fail if the guard is simplified to `body.name.length === 0`, which would let a whitespace-only name into the DB and return 201.

- **POST /accounts with `name` set to a non-string (e.g. `42`) returns 400** — proves the `typeof` guard. Would fail if the check is changed to a truthiness or `.trim()` call without a prior `typeof` guard, causing a `TypeError` on `(42).trim()` to be thrown and surface as a 500.

- **POST /accounts with a null or missing body returns 400, not 500** — proves the `!body` short-circuit. Would fail if the guard is `typeof body.name !== 'string'` without the leading `!body ||`, so accessing `.name` on `null` throws a `TypeError` that NestJS catches as an unhandled exception and returns its default 500 envelope (different shape from our contract).

- **GET /accounts/:id for an account whose `balance_cents` exceeds `Number.MAX_SAFE_INTEGER` (e.g. 9007199254740993) returns the exact decimal string, not a rounded number** — proves no floating-point coercion anywhere in the chain. Would fail if any intermediate step (repository mapping, service mapping, or a JSON `Number()` parse) converts the bigint to a JS number, silently rounding the last digits.

**Deliberately not testing here:** transactional atomicity of `updateCounters` (belonging in `invoice-transaction.spec.ts`), the full invoice-creation flow that triggers counter updates (in `invoice.spec.ts`), list/pagination of accounts (no such endpoint exists in this controller), and the internal error path (`internal_error`, 500) beyond confirming it is *not* the response for the known failure cases above.
