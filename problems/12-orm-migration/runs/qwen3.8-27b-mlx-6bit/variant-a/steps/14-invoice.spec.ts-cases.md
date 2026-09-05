# 14-invoice.spec.ts-cases

## reasoning

```
The user wants me to list the test cases for `test/invoice.spec.ts` based on the PLAN.md and the implementation files shown. I need to follow the format specified:

- One line per case
- Shape: `- <name of the test> — <what it proves, and what would have to be broken for it to fail>`
- Cover behavior the task statement asks to be tested, and behavior the plan says matters
- A case per branch that could be wrong on its own
- Say what would have to break
- Include awkward cases: concurrency, duplicate delivery, exhaustion, boundary values, error path that looks like success
- Name what I'm deliberately NOT testing and why in one closing line

Let me look at the implementation carefully:

**invoice.controller.ts:**
- `create` POST: validates body (account_id string non-empty, line_items non-empty array, each item has description non-empty string and amount_cents integer string matching `/^-?\d+$/`)
- `getById` GET :id: passes id to service
- `listByAccount` GET with query params: validates account_id present, page positive integer, page_size positive integer

**invoice.service.ts:**
- `create`: 
  - Maps line_items to bigints
  - Sums totalAmount from line items (NOT from a separate amount_cents field)
  - Opens transaction
  - Loads account inside tx (NotFoundException if missing)
  - Inserts invoice with amount = totalAmount (sum of line items), status 'pending'
  - Inserts line items
  - Updates account counters: balance_cents -= totalAmount, total_invoiced_cents += totalAmount
  - After tx: fetches line items, assembles response with ISO dates
  - Note: the service does NOT validate that sum equals a provided amount_cents (there's no amount_cents in the body - it's derived from line items)
  
- `getById`:
  - Fetches invoice, throws NotFoundException if missing
  - Fetches line items
  - Returns response with ISO dates

- `listByAccount`:
  - Defaults page=1, pageSize=20
  - Fetches invoices (ordered by created_at)
  - For each, fetches line items (N+1 but that's implementation detail)
  - Returns { data, page, page_size }

**invoice.repository.ts:**
- `findById`: single row by id
- `findByAccount`: ordered by created_at, with limit/offset pagination
- `createWithLineItems`: inserts invoice (returning), then inserts line items if any
- `getLineItems`: all line items for an invoice

Now let me think about what tests to write for `test/invoice.spec.ts`. The plan lists tests 3, 4, 5, 6, 7, 10, 11, 12, 14 for this file. But I should also think about what's actually in the code and what could break.

Key behaviors to test:
1. POST /invoices happy path - creates invoice, returns 201 with correct shape
2. POST /invoices with empty line_items - 400 validation error
3. POST /invoices with missing account_id - 400
4. POST /invoices with bad amount_cents format (non-integer string) - 400
5. POST /invoices with non-existent account - 404 resource_not_found
6. GET /invoices/:id happy path - returns invoice with nested line_items
7. GET /invoices/:id not found - 404
8. GET /invoices?account_id=... pagination works
9. GET /invoices?account_id=... missing account_id - 400
10. GET /invoices?account_id=... with invalid page - 400
11. amount_cents is always a string (typeof check)
12. line_items array present even when empty (but wait - controller requires non-empty, so can an invoice have zero line items? Looking at createWithLineItems - it checks `if (data.lineItems.length > 0)` before inserting. But the controller requires non-empty array. So in practice, every created invoice has at least one line item. Unless someone creates via seed directly.)
13. Zero amount serializes as "0" not 0
14. ISO date format for created_at/updated_at
15. Negative amounts in line items (the regex allows `-?\d+`)
16. Large bigint values (exceeding Number.MAX_SAFE_INTEGER)
17. Pagination boundary: page beyond available data returns empty array
18. Pagination default values (page=1, page_size=20)

Let me also think about what the task statement specifically asks:
- "public API contract byte-compatible (field presence, null vs missing, numeric string formats — invoices carry BigInt amounts serialized as strings today)"
- "Transactional behavior preserved" (but that's in invoice-transaction.spec.ts per the plan)
- "Some behavior callers depend on is NOT covered by any test"

Looking at the service code more carefully:
- The amount_cents on the invoice is DERIVED from the sum of line items. There's no separate amount_cents field in the request body. This is a semantic behavior.
- The account counter update: balance_cents decreases by totalAmount, total_invoiced_cents increases by totalAmount. This means creating an invoice reduces balance. Is there a check for insufficient balance? Looking at the code... NO, there's no check! The service just does the arithmetic. This is a potential semantic behavior that the task says to find.

Wait, looking at the plan: "invalid_account_state | account balance insufficient for the invoice amount (if that check exists in the fixture)". The plan says "if that check exists." Looking at the actual service code, there's NO such check. So this is a behavior that exists in the original Prisma service (presumably) but... wait, I'm looking at the NEW Drizzle code. The task says to migrate and preserve behavior. If the original had a balance check and this doesn't, that's a bug. But I can only see the new code here.

Actually wait - I need to re-read the task. The user is asking me to list test cases for `test/invoice.spec.ts` based on the PLAN and the implementation. I should list what the tests should cover given what's in the code.

Let me also note: the plan mentions test 14: "line_items: [] in response when invoice has no items (if allowed by validation)". But the controller requires non-empty line_items for creation. So the only way to have an invoice with no line items is if it was created outside this API (e.g., seed data). The test would need to seed such an invoice.

Let me structure my list:

1. POST happy path - full response shape
2. POST empty line_items - 400
3. POST missing/empty account_id - 400
4. POST bad amount_cents (non-integer string like "12.5") - 400
5. POST non-existent account - 404 resource_not_found
6. GET by id happy path
7. GET by id not found - 404
8. GET list with pagination (specific page)
9. GET list missing account_id - 400
10. GET list invalid page (0, negative, non-integer) - 400
11. amount_cents is string type for large values (> MAX_SAFE_INTEGER)
12. Zero amount line item serializes as "0"
13. Account counters updated correctly after creation (balance decreased, total_invoiced increased)
14. Invoice with no line items still returns line_items: [] (seeded)
15. Negative amount_cents allowed and serialized correctly
16. Pagination beyond data returns empty data array with correct page/page_size
17. Response field presence: all fields present, none null where they should be strings
18. created_at/updated_at are ISO 8601 strings

Let me also think about what's awkward:
- The sum of line items determines the invoice amount (not a separate field) - if you send line items [100, 200], the invoice amount_cents is "300"
- A single line item: invoice amount = that one item's amount
- Very large values that would lose precision as Number but are fine as string/bigint

What I'm NOT testing:
- Transactional atomicity (that's in invoice-transaction.spec.ts)
- Account endpoint behavior (that's in account.spec.ts)
- FK constraint enforcement at DB level (would need to bypass the service)

Let me finalize my list. I'll aim for clarity and specificity about what breaks.
```

## reply

- POST /invoices returns 201 with a complete invoice object — proves the happy path shape: `id`, `account_id`, `amount_cents` (string), `status === "pending"`, non-empty `line_items` array, `created_at` and `updated_at` as ISO-8601 strings. Fails if any field is missing, a date is a number, or `amount_cents` is a number instead of a string.

- POST /invoices with an empty `line_items` array returns 400 `validation_error` — proves the controller rejects an empty array before any DB write. Fails if the controller allows zero items, returns a different HTTP status, or the error envelope lacks `code: "validation_error"`.

- POST /invoices with a missing or empty-string `account_id` returns 400 `validation_error` — proves the guard on `account_id` fires. Fails if the controller passes an empty string through to the service, or the error is a 500.

- POST /invoices with `amount_cents` of `"12.5"` on a line item returns 400 `validation_error` — proves the integer-string regex (`/^-?\d+$/`) rejects fractional input. Fails if the regex is absent or permissive, letting a float reach `BigInt()` and throw a 500.

- POST /invoices with a non-existent `account_id` returns 404 with `code: "resource_not_found"` — proves the service's account-existence check inside the transaction surfaces as a structured 404, not an FK-constraint 500. Fails if the error envelope is missing, the status is 500, or `details` is null.

- GET /invoices/:id returns 200 with the invoice and its nested `line_items` — proves the read path: all fields present, each line item has `id`, `description`, `amount_cents` (string), and the invoice's `amount_cents` equals the sum of its line items. Fails if `line_items` is omitted, a nested field is missing, or the date fields are not ISO strings.

- GET /invoices/:id with a UUID that was never inserted returns 404 `resource_not_found` — proves the not-found branch in `getById`. Fails if it returns 500, returns an empty object, or the envelope `code` is anything other than `resource_not_found`.

- GET /invoices?account_id=X&page=2&page_size=2 returns the correct second page slice — proves pagination: exactly 2 items, `page === 2`, `page_size === 2`, ordered by `created_at` ascending. Fails if offset math is off-by-one, ordering is wrong, or the wrapper keys are missing.

- GET /invoices with no `account_id` query param returns 400 — proves the required-param guard. Fails if the service is called with `undefined` and produces a 500 or an empty list.

- GET /invoices?account_id=X&page=0 returns 400; `page=-1` and `page=abc` also return 400 — proves each invalid page variant is rejected. Fails if any variant slips through (e.g. `Number("abc")` → `NaN` passes the integer check, or 0 is treated as page 1).

- POST /invoices with a line-item `amount_cents` of `"9007199254740993"` (exceeds `Number.MAX_SAFE_INTEGER`) returns 201 and the response `amount_cents` is the exact string `"9007199254740993"` — proves no numeric coercion anywhere in the pipeline. Fails if `BigInt → Number → String` round-trip loses low bits, or JSON serialization converts to a number.

- POST /invoices with a single line item of `amount_cents: "0"` returns 201 and the response shows `amount_cents: "0"` and the line item's `amount_cents: "0"` — proves zero is serialised as the string `"0"`, not omitted, not `null`, not numeric `0`. Fails if a falsy check drops the field or JSON.stringify emits bare `0`.

- POST /invoices with line items `[{"amount_cents":"100"},{"amount_cents":"250"}]` produces an invoice whose `amount_cents` is `"350"` — proves the invoice total is *derived* as the sum of line items (there is no client-supplied total). Fails if the code reads a non-existent top-level `amount_cents` field, hard-codes a value, or the sum is off.

- POST /invoices with a negative line-item amount (e.g. `"-50"`) returns 201 and the response shows `"−50"` correctly — proves the regex permits a leading minus and `BigInt("-50")` round-trips. Fails if the regex rejects negatives or the sign is lost in serialization.

- After POST /invoices succeeds, GET /accounts/:id shows `balance_cents` decreased by the invoice total and `total_invoiced_cents` increased by the same amount — proves the counter arithmetic in the transaction is correct and committed. Fails if the delta sign is flipped, the update targets the wrong column, or the counters are not yet visible (transaction not committed).

- GET /invoices?account_id=X where X exists but has no invoices returns 200 with `data: []`, `page: 1`, `page_size: 20` — proves the empty-list path returns an array (not `null`, not omitted) and default pagination values. Fails if `data` is `null`, the defaults differ, or a 404 is returned for "no rows".

- GET /invoices?account_id=X&page=999 (far beyond available pages) returns 200 with `data: []` — proves pagination beyond the data boundary does not error. Fails if the repository or service throws on an empty offset result.

- A pre-seeded invoice with zero line items, fetched via GET /invoices/:id, returns `line_items: []` (empty array key present) — proves the field is always serialised, never omitted when empty. Fails if the mapping skips the key for an empty array or emits `line_items: null`.

- POST /invoices response `created_at` and `updated_at` match the pattern `YYYY-MM-DDTHH:mm:ss.sssZ` — proves `.toISOString()` is applied, not a raw `Date` object or a DB-returned string with a different format. Fails if the field is a number, a locale-formatted string, or omitted.

Deliberately **not** testing in this file: transactional atomicity and mid-transaction rollback (covered by `test/invoice-transaction.spec.ts`), account-endpoint read/create shapes (covered by `test/account.spec.ts`), and DB-level FK constraint enforcement bypassing the service layer (not an API contract concern).
