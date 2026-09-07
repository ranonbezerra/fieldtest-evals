# 09-bigint-format.spec.ts-cases

## reasoning

```
The user wants me to list test cases for `test/bigint-format.spec.ts` based on the plan and implementation files provided. Let me analyze what BigInt formatting concerns exist in this codebase.

From the plan:
- `bigint-format.spec.ts` — "zero-amount invoice serialises as '0'" — total_cents=0 → `"total_cents":"0"` (string, not number, not omitted)
- `bigint-format.spec.ts` — "negative balance serialises with minus sign" — balance_cents=-50 → `"balance_cents":"-50"`

From the implementation:
- `accounts` table has: `credit_limit_cents` (bigint), `balance_cents` (bigint), `total_invoiced_cents` (bigint)
- `invoices` table has: `subtotal_cents` (bigint), `tax_cents` (bigint), `total_cents` (bigint)
- `line_items` table has: `unit_price_cents` (bigint), `quantity` (integer), `line_total_cents` (bigint)

The key concern: Drizzle's `bigint` column with default mode `'bigint'` returns JS `BigInt` values. The DTO serialization layer converts these to strings. The plan says "the existing `.toString()` serialization layer is untouched."

So the tests need to verify:
1. BigInt → string conversion happens correctly for all money fields
2. Zero values serialize as `"0"` not `""` or omitted
3. Negative values serialize with minus sign
4. Large values (beyond Number.MAX_SAFE_INTEGER) serialize correctly as strings
5. The `quantity` field is an integer, NOT a bigint — it should serialize as a number, not a string
6. `line_total_cents` is bigint → string
7. `unit_price_cents` is bigint → string

Let me think about what branches could be wrong:

1. **Zero amount**: `total_cents = 0n` → should be `"0"` not omitted, not `0`, not `""`
2. **Negative balance**: `balance_cents = -50n` → should be `"-50"` not `"50"` or `-50` (number)
3. **Large value exceeding Number.MAX_SAFE_INTEGER**: e.g., `total_cents = 9007199254740993n` → must serialize as exact string, not lose precision if accidentally coerced to Number
4. **Quantity is integer not bigint**: `quantity: 5` → should be number `5` in JSON, not string `"5"`
5. **Multiple bigint fields on same object**: account has three bigint fields, invoice has three — all must be strings simultaneously
6. **Line item bigint fields**: `unit_price_cents` and `line_total_cents` are bigint → string; `quantity` is integer → number

Let me also think about what's awkward:
- If the serialization accidentally does `Number(bigintValue).toString()` instead of `bigintValue.toString()`, precision is lost for large values
- If a field is accidentally typed as number in the schema, it won't be bigint
- If `quantity` (integer) gets `.toString()` applied to it, it becomes `"5"` instead of `5`
- If the DTO mapping accidentally omits a zero value (falsy check)

Let me structure this:

1. Zero total_cents on invoice → `"total_cents":"0"` (string "0", not number 0, not omitted)
   - Breaks if: DTO mapping uses a truthy check before serializing, or if zero is treated as "no value"

2. Negative balance_cents on account → `"balance_cents":"-50"` (string with minus)
   - Breaks if: BigInt negative is formatted as unsigned, or if `.toString()` is replaced with something that strips sign

3. Large bigint beyond Number.MAX_SAFE_INTEGER → exact string, no precision loss
   - Breaks if: serialization does `Number(bigInt).toString()` instead of `bigInt.toString()`

4. Quantity (integer, not bigint) on line item → number in JSON, not string
   - Breaks if: a blanket "all money fields are strings" rule accidentally applies to integer columns

5. All three bigint fields on an account simultaneously serialized as strings
   - Breaks if: only one of the three is handled, or the mapping misses a field

6. All three bigint fields on an invoice simultaneously serialized as strings
   - Breaks if: subtotal/tax/total mapping is inconsistent

7. line_total_cents and unit_price_cents on line items → strings; quantity → number (mixed types in same object)
   - Breaks if: the line item DTO treats all fields uniformly

Now let me think about what NOT to test here — validation of amounts, business logic of how totals are computed, etc. Those belong in other spec files.

Let me format this properly.
```

## reply

- Zero invoice total serialises as the string `"0"` — proves the DTO mapping does not drop or coerce a zero BigInt (a truthy guard like `if (val) …` or an accidental `Number()` cast would turn `0n` into `0`, `""`, or a missing key, all of which break the wire contract)
- Negative account balance serialises as a signed string (e.g. `"-50"`) — proves the BigInt→string path preserves the minus sign (a `Math.abs()` or unsigned-format helper would emit `"50"`, silently inverting the semantic of a credit balance)
- A bigint value exceeding `Number.MAX_SAFE_INTEGER` round-trips exactly — proves the serialisation calls `BigInt.prototype.toString()` directly rather than coercing through `Number` (an accidental `Number(bigVal).toString()` would lose the low-order digits and the JSON would show a different number)
- `quantity` on a line item is a JSON number, not a string — proves the integer column (Drizzle `integer`, mode default) is not swept up by a blanket "all cent fields are strings" rule (a `.map(v => v.toString())` applied to the whole row object would turn `5` into `"5"` and break every client that does arithmetic on quantity)
- All three bigint fields on an account (`credit_limit_cents`, `balance_cents`, `total_invoiced_cents`) are strings simultaneously in the same response body — proves the account DTO mapper handles each field individually and none falls through to a raw BigInt (a partial mapping that stringifies one field but forgets the others would leak `BigInt` into JSON, which NestJS serialises as `{}` or throws)
- All three bigint fields on an invoice (`subtotal_cents`, `tax_cents`, `total_cents`) are strings simultaneously, and the nested `line_items` array carries its own bigint fields (`unit_price_cents`, `line_total_cents`) as strings while `quantity` remains a number — proves the composite invoice-with-line-items mapper applies the correct per-column treatment without cross-contaminating the integer column (a shared helper that assumes every numeric column is a cent-value would stringify `quantity`; a helper applied only at the top level would leave line-item bigints as raw objects)

Not testing here: business rules for how subtotal/tax/total are *computed* (belongs in invoice-creation tests), validation of negative or zero amounts at input time (belongs in `validate-quantity` / `validate-negative-price` specs), and the transactional visibility of counter updates (belongs in `transaction-failure` spec). This file pins only the *serialisation shape* of values that are already correct in the database.
