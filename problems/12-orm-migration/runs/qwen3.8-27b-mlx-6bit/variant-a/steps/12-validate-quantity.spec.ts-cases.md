# 12-validate-quantity.spec.ts-cases

## reasoning

```
The user wants me to list test cases for `test/validate-quantity.spec.ts`. Let me look at what the plan says about this test file and understand what behavior it should cover.

From PLAN.md:
- `test/validate-quantity.spec.ts` — "rejects quantity ≤ 0" | POST /invoices with quantity 0 → 400 `validation_error`

The plan mentions:
- `quantity` is an `integer` column with `CHECK > 0`
- The validation happens in the controller (per §4: "Validation of input DTOs (happens in controller / before repo call)")
- Error contract: `validation_error` code

Let me think about what branches could be wrong on their own for quantity validation:

1. Quantity = 0 → should reject with 400 validation_error
2. Quantity = negative (e.g., -1) → should reject with 400 validation_error
3. Quantity = 1 (minimum valid) → should succeed (boundary)
4. Quantity is non-integer (e.g., 1.5) → should reject
5. Quantity is missing/undefined → should reject (or use default?)
6. Quantity is a string like "3" → depends on DTO validation (NestJS pipe)
7. Quantity is null → should reject
8. Multiple line items where one has invalid quantity → the whole request should be rejected

Wait, let me re-read the plan more carefully. The plan says:
- `test/validate-quantity.spec.ts` — "rejects quantity ≤ 0" | POST /invoices with quantity 0 → 400 `validation_error`

So the primary focus is quantity ≤ 0. But the task says "A case per branch that could be wrong on its own" and to include awkward cases.

Let me think about what the implementation looks like. The controller validates input before calling the service. The repository's `createWithLineItems` just inserts the values. So validation must happen at the controller/DTO level (NestJS validation pipe) or in the service.

Looking at the plan's §4:
- "Validation of input DTOs (happens in controller / before repo call)."

So the validation is at the controller/DTO level using NestJS class-validator or manual checks.

Let me think about what could break:

1. **quantity = 0 rejected** — The core case. If the validation only checks for negative but forgets zero, this fails.
2. **quantity = -1 rejected** — Negative values. If validation uses `> 0` but the code accidentally uses `>= 0`, negative would slip through... wait no, `> 0` rejects negatives. If it uses `>= 1` that's fine. The risk is if someone writes `> -1` or similar.
3. **quantity = 1 accepted** — Boundary: the minimum valid value. If validation accidentally rejects 1 (e.g., `> 1` instead of `>= 1` or `> 0`), this fails.
4. **quantity missing/undefined** — If the field is optional in the DTO and no default is set, it could insert NULL into a NOT NULL column. Or if it has a default of 1, it should work.
5. **quantity is non-numeric (string "abc")** — Type validation. If the DTO doesn't enforce number type, it could pass to the DB and fail differently.
6. **quantity is a float (1.5)** — The column is `integer`. If validation doesn't reject non-integers, Postgres will either truncate or error.
7. **Multiple line items, one invalid** — If validation only checks the first item or uses early-return incorrectly.
8. **The error envelope is correct** — code is `validation_error`, not `resource_conflict` or a 500. The error path looks like the success path if it returns 201 with a partial result.

Actually wait - I need to be careful. The plan says the validation happens in the controller. But looking at the repository code, there's no validation there. The DB has a CHECK constraint `CHECK > 0` on quantity. So there are two layers:
- Application-level validation (controller/DTO) → returns 400 validation_error
- Database CHECK constraint → would return a different error (500 or mapped to resource_conflict)

The test should verify the APPLICATION-level validation catches it before it hits the DB. If it only relies on the DB constraint, the error code would be wrong.

Let me also think about: what if quantity is valid in one line item but invalid in another? The whole request should fail atomically.

What about the interaction with the transaction? If validation is done before the transaction opens, then no partial writes occur. But if someone accidentally puts validation inside the transaction (after the invoice insert), a failure would roll back but the error code might be wrong.

Let me structure my list:

1. quantity = 0 → 400 validation_error (the exact plan case)
2. quantity = -5 → 400 validation_error (negative)
3. quantity = 1 with valid rest → 201 success (minimum boundary accepted)
4. quantity missing from line item → 400 validation_error (not silently defaulted to something)
5. quantity = 1.5 (non-integer) → 400 validation_error
6. Multiple line items where second has quantity 0 → 400, AND no partial invoice/line-item rows in DB
7. The error envelope has code "validation_error" specifically (not resource_conflict, not internal_error)

Hmm, but I should focus on what's specific to THIS test file. The plan says it's specifically about quantity validation. Let me not over-scope into general DTO validation.

Actually, re-reading the rules: "Cover the behaviour the task statement asks to be tested, and the behaviour the plan says matters. A case per branch that could be wrong on its own."

The task statement says: "rejects quantity ≤ 0" → POST /invoices with quantity 0 → 400 validation_error

Let me be precise about what would break:

1. **quantity 0 is rejected with validation_error** — Proves the `> 0` boundary treats zero as invalid. Fails if validation uses `>= 0` or only checks for negative numbers, or if zero falls through to the DB and surfaces as a different error code (e.g., CHECK constraint violation mapped to `resource_conflict` or 500).

2. **quantity -1 is rejected with validation_error** — Proves negative values are caught. Fails if validation only guards against zero but not negatives, or if a type coercion (e.g., parsing a string) turns -1 into something else.

3. **quantity 1 is accepted and invoice is created** — Proves the minimum valid value isn't accidentally rejected. Fails if the check is `> 1` instead of `>= 1` / `> 0`, or if there's an off-by-one in the boundary.

4. **quantity field absent from a line item → 400** — Proves the field is required, not silently defaulted. Fails if the DTO makes quantity optional with a default (like 1), allowing a zero-quantity semantic to be hidden, or if it inserts NULL and the DB NOT NULL constraint produces a 500 instead of 400.

5. **non-integer quantity (e.g. 2.7) → 400** — Proves type enforcement. Fails if the DTO accepts any number and Postgres silently truncates to 2, creating a line item the caller didn't intend.

6. **one valid + one zero-quantity line item in the same request → 400, no rows persisted** — Proves validation is all-or-nothing before any write. Fails if validation is per-item and the first item is inserted before the second is checked, leaving a partial invoice with one line item (or if the transaction isn't used and there's no rollback).

7. **error response has code "validation_error" and details object** — Proves the error envelope contract. Fails if the CHECK constraint in Postgres fires first and is mapped to `resource_conflict` or a 500 `internal_error`, making the client unable to distinguish "fix your input" from "server bug".

Now for what I'm NOT testing:
- I'm not testing quantity > some upper bound (e.g., 999999) because the schema has no MAX constraint and the task doesn't call for one.
- I'm not testing concurrency (two simultaneous POSTs with quantity 0) because validation is stateless per-request; the interesting concurrency cases are about the counter update, which belongs in transaction-failure.spec.ts.

Let me finalize.
```

## reply

- **quantity 0 is rejected with 400 validation_error** — proves the `> 0` boundary treats zero as invalid at the application layer. Fails if the guard is `>= 0` or only checks for negatives, or if zero slips past the DTO and hits the DB CHECK constraint, surfacing as `resource_conflict` or a 500 instead of `validation_error`.

- **quantity −5 is rejected with 400 validation_error** — proves negative values are caught before any DB interaction. Fails if the validation compares with `> 0` but a type-coercion step (e.g. `Number` cast on a string input) turns the value into `NaN` which passes a loose check, or if the guard is written as `!== 0` only.

- **quantity 1 (minimum valid) is accepted and the invoice + line item are created** — proves the lower boundary is inclusive of 1. Fails if the check is `> 1` instead of `>= 1` / `> 0`, an off-by-one that silently rejects the smallest legitimate order.

- **quantity field absent from a line-item body → 400 validation_error, no rows persisted** — proves the field is required, not silently defaulted. Fails if the DTO marks quantity optional with a default of 1 (hiding caller intent) or if it inserts NULL and the NOT NULL constraint produces a 500 `internal_error` instead of a 400.

- **non-integer quantity (2.7) → 400 validation_error** — proves type enforcement at the API boundary. Fails if the DTO accepts any `number` and Postgres silently truncates to 2, creating a line item whose `line_total_cents` no longer matches the caller's intended quantity.

- **request with two line items where the second has quantity 0 → 400, and zero rows exist in invoices or line_items** — proves validation is all-or-nothing before any write enters the transaction. Fails if per-item validation is interleaved with inserts (first item committed before second is checked) or if the early-return happens after `tx.insert(invoices)` without a rollback, leaving an orphan invoice with one line item.

- **error envelope carries code `"validation_error"`, a developer-facing message, and `details` as an object (not null)** — proves the single-envelope contract for input errors. Fails if the Postgres CHECK constraint fires first and the global filter maps it to `resource_conflict`, or if `details` is serialised as `null` / omitted, breaking clients that branch on the code.

Deliberately **not** testing: an upper bound on quantity (the schema has no MAX and the task specifies none), and concurrent duplicate POSTs with invalid quantity (stateless per-request validation has no race; the concurrency cases that matter—counter under-count on retry—belong in `transaction-failure.spec.ts`).
