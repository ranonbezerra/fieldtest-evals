# 13-validate-negative-price.spec.ts-cases

## reasoning

```
The user wants me to list test cases for `test/validate-negative-price.spec.ts`. Let me look at what the plan says about this test file and what behavior it should cover.

From PLAN.md:
- `test/validate-negative-price.spec.ts` — "rejects negative unit_price" | POST /invoices with unit_price_cents: -1 → 400 `validation_error`

Now let me think about what "negative unit_price" validation entails in this billing service context:

1. The basic case: POST /invoices with a line item having unit_price_cents: -1 should be rejected with 400 validation_error.

2. What are the edge cases and branches that could be wrong?

Let me think about what "negative unit price" means in context:
- unit_price_cents is a bigint field
- It should be validated as >= 0 (non-negative)
- What about zero? Zero is valid (a $0 line item).
- What about negative values of various magnitudes? -1, -999999?
- What about the error response shape? Must be the single envelope: `{ "error": { "code": "validation_error", "message": "...", "details": {} } }`
- What about multiple line items where one is negative? The whole request should be rejected.
- What about the combination with quantity? If unit_price is 0 and quantity is positive, that's valid. If unit_price is negative and quantity is 1, that's invalid.
- What about the total computation? If somehow a negative price slipped through, line_total would be negative. But validation should prevent this before any DB write.
- What about the response status code? 400 not 422, not 500.
- What about the error code? Must be "validation_error" not "resource_conflict" or some other code.
- What about the `details` field? Must be an object, never null. Should it contain which field failed?
- What about the fact that no invoice is created (no side effect)? The DB should have no new invoice row, no line items, and account counters unchanged.
- What about a negative price in a multi-line-item invoice where the first line is valid but the second is negative? The whole request fails.
- What about unit_price_cents: -0? In JS, -0 === 0, and BigInt(-0) is 0n. So this should pass as valid (zero).
- What about the boundary: unit_price_cents: 0 should be accepted (valid), while -1 should be rejected.

Let me also think about what's NOT in scope:
- The plan says this test file specifically covers "rejects negative unit_price". Quantity validation is in a separate file (`test/validate-quantity.spec.ts`).
- The plan doesn't mention testing the DB constraint (CHECK) for negative prices — that's a defense-in-depth concern, not the primary validation path.

Let me think about what would have to break for each test to fail:

1. Basic rejection: unit_price_cents = -1 → 400 validation_error
   - Would fail if: the controller/service doesn't validate, or validates wrong direction (> 0 instead of < 0), or returns wrong status code, or uses wrong error code.

2. Response envelope shape: the 400 body must be `{ error: { code: "validation_error", message: string, details: object } }`
   - Would fail if: the error filter doesn't catch validation errors properly, or returns a different shape.

3. No side effects: after rejected POST, no invoice row exists in DB
   - Would fail if: validation happens AFTER the insert (i.e., the INSERT succeeds and then something throws).

4. Account counters unchanged after rejected POST
   - Would fail if: partial transaction commits or the counter update runs before validation.

5. Multiple line items, one negative: entire request rejected
   - Would fail if: validation is per-item but doesn't short-circuit, or only validates the first item.

6. Boundary: unit_price_cents = 0 is accepted (contrast with -1 rejected)
   - Would fail if: validation uses `> 0` instead of `>= 0`, or `!== 0` incorrectly.

7. details field is an object (not null, not missing)
   - Would fail if: the error handler sets details to null or omits it.

8. The negative price must be in a line item, not the top-level invoice
   - Actually, unit_price_cents is only on line items. So this is about the shape of the request.

Let me also consider: what about very large negative numbers? Like -2^63 (minimum bigint)? That's probably overkill and the validation is just `< 0`.

What about the interaction with the "void" behavior? No, that's a different test file.

What about concurrency? Two simultaneous POSTs both with negative prices — both should get 400. But that's really the same as the basic case, just twice. I don't think concurrency is particularly relevant for a pure input validation test (no race condition on the validation itself).

Actually, let me reconsider. The plan says: "Include the cases that are awkward: concurrency, duplicate delivery, exhaustion, boundary values, the error path that looks like the success path."

For validation:
- Concurrency: not really applicable to pure input validation. Two requests with bad input both get 400 independently.
- Duplicate delivery: POST the same bad payload twice — both should get 400, and still no side effects.
- Exhaustion: not applicable.
- Boundary values: 0 (valid), -1 (invalid). What about the most negative bigint? Probably not necessary.
- Error path that looks like success: what if validation passes but the DB constraint catches it? That would be a 500 or a different error code, not 400. But the validation should prevent reaching the DB.

Let me finalize my list. I want to be specific about what breaks:

1. "rejects unit_price_cents of -1 with 400 validation_error" — proves the controller/service validates negative prices before any DB write. Would fail if: no validation exists, validation checks `> 0` instead of `< 0`, or the error is returned as 500/422 instead of 400.

2. "rejects with correct error envelope shape" — proves the 400 response is `{error:{code:"validation_error", message: string, details: {}}}`. Would fail if: error filter maps to wrong code (e.g., "invalid_input"), or details is null/missing, or message is absent.

3. "no invoice row created after rejected POST" — proves validation precedes any DB insert. Would fail if: the repository's createWithLineItems is called and the INSERT into invoices succeeds before validation throws (impossible with current design since validation is in service/controller, but would fail if someone moved validation into the repo after the insert).

4. "account counters unchanged after rejected POST" — proves no partial transaction effect. Would fail if: the counter UPDATE runs in a separate auto-commit before validation, or if the transaction commits partially.

5. "rejects when only the second of multiple line items has negative price" — proves validation checks ALL line items, not just the first. Would fail if: validation loop breaks after first valid item, or only validates `lineItems[0]`.

6. "accepts unit_price_cents of 0 (boundary)" — proves the validation is `< 0` not `<= 0`. Would fail if: the check is `<= 0` or `!== 0` (rejecting valid zero-price line items).

7. "accepts a valid multi-line-item invoice with all non-negative prices" — proves the validation doesn't false-positive on legitimate requests. Would fail if: validation has a logic error that rejects valid inputs (e.g., checking the wrong field, or inverting the comparison).

8. "details object identifies the offending field" — proves the error response is actionable (contains which line item / field failed). Would fail if: details is `{}` with no field info, or doesn't distinguish which item was bad.

Wait, does the plan actually specify what goes in `details`? Let me re-read... The plan says `details` is an object, never null. It doesn't specify the contents for validation errors specifically. I should be careful not to over-specify. But the error envelope contract says `details` is an object. Let me keep this but frame it as "details is a non-null object" rather than specifying exact contents.

Actually, re-reading the conventions: "details is an object, never null." That's the contract. I'll test that it's present and is an object.

Let me also think about: what about the status code being 400 specifically? The plan says "400 validation_error". So I should pin that.

And what about: does the response body contain anything other than the error? In a 400, it should ONLY be the error envelope. No partial invoice data.

Let me reconsider whether to include a "concurrency" case. For pure input validation, two simultaneous bad requests both get 400 and neither creates data. The "awkward" aspect would be: does the validation happen before or after acquiring any lock? If it's pure in-memory validation (checking the number), concurrency doesn't matter. I think I'll skip this and note it in the "not testing" line.

What about "duplicate delivery"? POST the same negative-price payload twice in sequence — both 400, no side effects. This is really just the basic case run twice. I'll fold it into the "no side effects" case or mention it briefly.

Let me write the final list now.
```

## reply

- **rejects unit_price_cents of −1 with HTTP 400 and code `validation_error`** — proves the service/controller validates each line item's price before delegating to the repository. Would fail if: no validation exists at all (request reaches the DB), the comparison is inverted (`> 0` instead of `< 0`), or the error surfaces as a 500/422 instead of 400.

- **rejects with the single error envelope shape** — proves the 400 body is exactly `{ "error": { "code": "validation_error", "message": <string>, "details": <object> } }` with no extra top-level keys and `details` present as an object (not null, not omitted). Would fail if: the global exception filter maps `BadRequestException` to a different code (e.g. `"invalid_input"`), omits `details`, sets it to `null`, or the controller throws a bare `Error` that the filter can't shape.

- **no invoice row or line-item row persisted after a rejected POST** — proves validation occurs before any `INSERT` reaches Postgres. Would fail if: the repository's `createWithLineItems` is invoked and its `INSERT INTO invoices` commits (or auto-commits) before the service-layer check throws, or if the transaction is opened and the invoice insert executes prior to the price guard.

- **account counters (total_invoiced_cents, balance_cents) unchanged after a rejected POST** — proves the counter `UPDATE` inside the transaction never executes for an invalid request. Would fail if: validation is placed after the counter update in the same transaction (so the UPDATE runs, then a subsequent check throws and rollback is missed), or if the counter update is in a separate auto-committed statement outside the transaction.

- **rejects when only the second of two line items carries a negative price** — proves validation iterates over *all* line items, not just the first. Would fail if: the loop breaks after the first valid item, validation checks only `dto.lineItems[0]`, or a `some()`/`find()` short-circuits on the wrong condition (e.g. returns on first valid instead of first invalid).

- **accepts unit_price_cents of 0 (boundary: zero is a valid price)** — proves the guard is strictly `< 0`, not `<= 0`. Would fail if: the check is written as `price <= 0` or `price !== 0`, which would reject legitimate zero-dollar line items and return 400 where 201 is expected.

- **accepts a valid multi-line-item invoice (all prices ≥ 0, quantities ≥ 1) and returns 201** — proves the validation does not false-positive on legitimate input. Would fail if: the validator checks the wrong field (e.g. `line_total_cents` instead of `unit_price_cents`), has a type coercion bug that turns a valid `0n` into a falsy rejection, or an off-by-one in the comparison (`< 1` instead of `< 0`).

- **details object is non-empty and identifies the offending line-item index or field** — proves the error response is actionable by a client integrating against this API. Would fail if: `details` is `{}` with no field/index information, or the exception is thrown before the per-item index is captured (e.g. a single `throw new BadRequestException('invalid price')` with no per-item context).

**Deliberately not testing:** concurrent duplicate submissions of the same negative-price payload (both get 400 with no side effects), because the validation is a pure in-memory numeric comparison with no shared mutable state — there is no race window that could produce a different outcome than the single-request case; and the Postgres-level CHECK constraint (if any) as a second line of defence, because the task pins behaviour at the service layer and the constraint is a schema concern owned by the migration, not the runtime validation path.
