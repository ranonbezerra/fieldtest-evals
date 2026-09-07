# 10-null-vs-missing.spec.ts-cases

## reasoning

```
The user wants me to list test cases for `test/null-vs-missing.spec.ts` based on the PLAN.md and the implementation files provided. I need to focus specifically on the null-vs-missing behavior tests.

Let me look at what PLAN.md says about this file:

| `test/null-vs-missing.spec.ts` — "due_date null is present-key-null" | Invoice with due_date NULL → JSON has `"due_date":null`, key is not absent |
| `test/null-vs-missing.spec.ts` — "empty line_items is empty array" | Invoice created with `lineItems: []` → response `"line_items":[]` not missing |

Now let me think about what "null vs missing" means in this context. The key concern is: when a field has a null value in the database, does the JSON response include the key with `null` as the value, or does it omit the key entirely? Similarly for arrays that are empty.

Let me think about all the fields that could be null or missing:

From the schema:
- `invoices.due_date` — timestamptz, **yes** (nullable)
- All other fields in invoices are NOT NULL
- All fields in accounts are NOT NULL
- All fields in line_items are NOT NULL

So the nullable field is `due_date`. But let me think more broadly about "null vs missing" behaviors:

1. **due_date null → present as `null` in JSON**: When an invoice has no due date (NULL in DB), the GET response must include `"due_date": null` rather than omitting the key.

2. **due_date present → present as ISO string**: When an invoice HAS a due date, the key must be present with a string value (not null, not missing).

3. **line_items empty array → `"line_items": []`**: When an invoice has zero line items, the detail response must include `"line_items": []` not omit the key.

4. **line_items non-empty → `"line_items": [...]`**: When an invoice has line items, they appear as an array.

5. **Account fields that are all non-null**: Since all account fields are NOT NULL, there's no null-vs-missing ambiguity there. But wait — what about the list endpoint vs detail endpoint? Do they return the same shape?

6. **What about `findAllByAccount` (list endpoint) vs `findById` (detail endpoint)?** The list endpoint returns `InvoiceRow[]` (no line_items), the detail returns `InvoiceWithLineItems` (with line_items). So in the list, there's no `line_items` key at all — that's "missing" by design. But in the detail, it must be present even if empty.

7. **What about the `updated_at` field?** It's NOT NULL with default now(). So it should always be present.

8. **What about numeric fields?** They're BigInt → string. A zero value should be `"0"`, not missing, not `null`.

Let me think about what could break:

- If the service layer uses object spread and the DTO mapping accidentally drops null fields (e.g., using a filter that removes null values)
- If Drizzle returns `undefined` instead of `null` for a NULL column (it shouldn't, but could be misconfigured)
- If the serialization layer uses something like `JSON.stringify` with a replacer that strips nulls
- If the response mapping for line_items does `items.length > 0 ? items : undefined` instead of always including the array
- If the list endpoint accidentally includes `line_items: []` when it shouldn't (or vice versa)

Now let me think about awkward cases:

- **Boundary: due_date set to a valid date vs null**: The contrast case. If you create with due_date and read back, it's a string. If you create without due_date, it's null. Both must be present as keys.
- **Empty line_items in list vs detail**: In the list endpoint, `line_items` is simply not a field on InvoiceRow. In the detail endpoint, it IS a field and must be `[]` not missing.
- **What if due_date is passed as null explicitly in the create DTO vs omitted?** Both should result in NULL in DB, and both should serialize as `"due_date": null` in the response.
- **What about the `status` field?** It's NOT NULL, default 'draft'. So it should never be null. But what if somehow the code path produces undefined? That would serialize as missing.

Let me also think about what the task statement emphasizes: "field presence, null vs missing, numeric string formats". So this spec is specifically about the distinction between a key being present with null value vs the key being absent.

Let me structure my test cases:

1. due_date null → key present with null value (the core case from PLAN)
2. due_date non-null → key present with ISO string value (contrast)
3. Empty line_items in detail response → key present with `[]` (from PLAN)
4. Non-empty line_items in detail response → key present with array (contrast to #3)
5. List endpoint does NOT include line_items key (it's not part of InvoiceRow/InvoiceDto) — this is "missing by design"
6. All non-null fields in account are present (no accidental dropping)
7. Zero-value bigint fields serialize as "0" string, not null, not missing (boundary: 0 is falsy in JS, could be accidentally treated as "no value")

Wait, #7 overlaps with bigint-format.spec.ts. Let me keep focus on null-vs-missing specifically.

Actually, let me re-read the plan more carefully:

The plan says:
- `test/null-vs-missing.spec.ts` — "due_date null is present-key-null" | Invoice with due_date NULL → JSON has `"due_date":null`, key is not absent
- `test/null-vs-missing.spec.ts` — "empty line_items is empty array" | Invoice created with `lineItems: []` → response `"line_items":[]` not missing

So the plan explicitly names two cases. But the user asks me to also cover "the behaviour the task statement asks to be tested, and the behaviour the plan says matters. A case per branch that could be wrong on its own."

Let me think about what other null-vs-missing branches exist:

- `due_date` is the only nullable column in the schema. So it's the primary null-vs-missing concern.
- `line_items` is a composite field in the detail response that could be empty.
- The list endpoint shape vs detail endpoint shape (line_items present/absent).

Are there other "null vs missing" concerns? Let me think...

- In the error envelope: `details` must be an object, never null. If details is empty, it should be `{}` not `null` or missing. But that's error envelope behavior, not really "null vs missing" in the data model sense. Though it could be argued.

- What about `CreateInvoiceDto`? If the caller doesn't pass `due_date`, it's undefined in the input. The repository should store NULL. The response should show `"due_date": null`. If the caller passes `due_date: null` explicitly, same result. Both paths must produce the same output.

Let me finalize my list:

1. **due_date NULL serialises as present-key-null** — The core case. Invoice created without a due date (or with explicit null). GET /invoices/:id returns `"due_date": null`. Would fail if: the DTO mapping filters out null values, or Drizzle returns `undefined` for a NULL timestamptz and the serializer omits undefined keys.

2. **due_date non-null serialises as present-key-string** — Contrast to #1. Invoice created with a due_date. GET /invoices/:id returns `"due_date": "2025-01-15T00:00:00.000Z"` (ISO string). Would fail if: the timestamp is returned as a number or the key is conditionally included only when truthy.

3. **Empty line_items in detail response is present-key-empty-array** — Invoice created with zero line items. GET /invoices/:id returns `"line_items": []`. Would fail if: the repository's `findById` returns `line_items: undefined` when the sub-query returns no rows, or the service maps it to `undefined`/omits it.

4. **Non-empty line_items in detail response is present-key-populated-array** — Contrast to #3. Invoice with 2+ line items. GET /invoices/:id returns `"line_items": [{...}, {...}]`. Would fail if: the mapping accidentally flattens or wraps the array.

5. **List endpoint omits line_items key entirely** — GET /invoices?accountId=… returns invoices without a `line_items` key (it's not part of the list DTO). Would fail if: the list mapping accidentally includes `line_items: []` on every row, breaking the byte-compatibility contract (extra field).

6. **due_date omitted in create body and due_date null in create body produce identical read-back** — POST /invoices with no `due_date` field vs POST with `"due_date": null`. Both → GET returns `"due_date": null`. Would fail if: one path stores NULL and the other stores some sentinel, or the serializer treats them differently.

7. **All non-null invoice fields are present in every response shape** — GET /invoices/:id for a minimal invoice (no due_date, zero amounts) still has `id`, `account_id`, `status`, `subtotal_cents`, `tax_cents`, `total_cents`, `created_at`, `updated_at` all present. Would fail if: a DTO mapping uses conditional inclusion (e.g., `if (value) obj.field = value`) which drops zero/falsy values.

8. **Account DTO has all fields present including zero-valued counters** — GET /accounts/:id for a freshly created account shows `"credit_limit_cents":"0","balance_cents":"0","total_invoiced_cents":"0"` — all present as strings. Would fail if: zero-bigint is treated as falsy and the key is omitted during serialization.

Hmm, #8 overlaps with bigint-format.spec.ts territory. But the "present vs missing" aspect is what's unique here. The bigint-format spec would test the *value* ("0" vs 0), while this spec tests the *key presence*. I think it's worth including because a code path that does `balance_cents ? { balance_cents: ... } : {}` would break presence even if the value format is correct.

Actually, let me reconsider. The user said "A case per branch that could be wrong on its own." So I should focus on branches. Let me think about what branches exist in the serialization path:

- `due_date == null` → output null (branch A) vs `due_date != null` → output string (branch B)
- `line_items.length == 0` → output [] (branch A) vs `line_items.length > 0` → output [...] (branch B)
- List endpoint: no line_items field at all (single path, but could be wrong if it accidentally adds one)
- All other fields: always present (no branch, but could be wrong if a generic filter drops them)

I think my list is good. Let me also add:

9. **Error envelope `details` is present-empty-object on 404** — GET /invoices/:id with unknown id → 404 body has `"details": {}` (key present, value is empty object). Would fail if: the error filter sets `details: null` or omits it when there are no details. This is a "null vs missing" case in the error contract.

Wait, but is this really "null-vs-missing" in the data-model sense? The task says "field presence, null vs missing" about the API contract. The error envelope is part of the API contract. I think it's fair to include.

Actually, re-reading the conventions: "details is an object, never null." So if it's `null` or missing, that's a violation. This is a legitimate null-vs-missing test.

Let me also think: is there a case where `line_items` in the list endpoint SHOULD be missing vs the detail where it should be present? Yes, that's #5. Good.

What about the `create` response for an invoice? POST /invoices returns 201 with the created invoice. Does it include `line_items`? Looking at the plan: "POST /invoices → 201; nested `line_items` present". So yes, the create response includes line_items. If the invoice was created with empty lineItems, does the create response show `"line_items": []`? That's another instance of #3 but via POST instead of GET. Should I separate it?

I think it's worth calling out because the code path is different: `createWithLineItems` returns the invoice row (without line_items from a sub-query), and then the service would need to either re-fetch or include the input lineItems. If it re-fetches, empty array comes from the DB. If it includes the input, it's `[]` directly. Either way, the key must be present. But this is arguably the same behavior as #3 just via a different endpoint. I'll fold it into #3 or mention it.

Actually, looking more carefully at the repository: `createWithLineItems` returns `invoice` which is just the `InvoiceRow` (no line_items). The service would need to construct the response. If the service does `repo.findById(id)` after creation, it gets the line_items. If it constructs manually, it needs to include them. Either way, for an empty lineItems array, the result must have `line_items: []`.

I'll add a note to #3 that it covers both GET and POST responses.

Let me also think: what about `updated_at`? It's NOT NULL, default now(). In the list endpoint and detail endpoint, it should always be present. If somehow it's null (shouldn't happen with NOT NULL constraint), would it be omitted? This is a stretch since the DB constraint prevents null. I'll skip this.

Final list:

1. due_date NULL → present-key-null
2. due_date non-null → present-key-ISO-string  
3. Empty line_items (detail) → present-key-empty-array
4. Non-empty line_items (detail) → present-key-populated-array
5. List endpoint → line_items key absent
6. due_date omitted in body vs explicit null → identical read-back
7. Non-null fields all present even when zero-valued
8. Error envelope details → present-empty-object on 404

And a closing line about what I'm NOT testing.

What am I NOT testing here?
- The actual *value* format of BigInt (that's bigint-format.spec.ts)
- Transactional behavior (that's transaction-failure.spec.ts)
- Validation errors (that's validate-*.spec.ts)
- Void behavior (that's void-invoice.spec.ts)
- The actual SQL/correctness of queries
- Timestamp format precision (that's a different concern)

Let me write this up now.
```

## reply

- **due_date NULL serialises as present-key-null** — Invoice created without a due date; `GET /invoices/:id` body contains `"due_date":null`. Fails if the DTO mapping or a JSON replacer drops null-valued keys (e.g. `if (v != null) out.k = v`), or if Drizzle's row model yields `undefined` for a NULL timestamptz and the serializer treats `undefined` as "omit".

- **due_date non-null serialises as present-key-ISO-string** — Contrast to the previous case: invoice created with `due_date`; `GET /invoices/:id` body contains `"due_date":"2025-06-15T00:00:00.000Z"`. Fails if the value is emitted as a number (epoch ms), as a non-ISO format, or if a truthiness check on the date object drops it in an edge-case locale.

- **Empty line_items in detail response is present-key-empty-array** — Invoice created with `lineItems: []`; both `GET /invoices/:id` and the `POST /invoices` 201 body contain `"line_items":[]`. Fails if the repository's sub-query returns an empty array that is then mapped to `undefined`/omitted, or if the service conditionally attaches `line_items` only when `items.length > 0`.

- **Non-empty line_items in detail response is present-key-populated-array** — Invoice created with two line items; `GET /invoices/:id` body contains `"line_items":[{…},{…}]` with each element carrying all its columns. Fails if the mapping flattens, wraps in an extra array, or drops elements with zero-valued fields (e.g. a line item where `unit_price_cents` is 0).

- **List endpoint omits the line_items key entirely** — `GET /invoices?accountId=…` returns an array where each element has NO `line_items` key (byte-compat with the Prisma list shape, which never joined items). Fails if the new repository or service accidentally includes `line_items:[]` on every list row, adding a field the old contract did not expose.

- **due_date omitted in create body and due_date explicitly null produce identical read-back** — Two invoices: one created with no `due_date` key in the JSON body, one created with `"due_date":null`. Both read back via `GET /invoices/:id` as `"due_date":null`. Fails if one path stores a sentinel (empty string, epoch 0) while the other stores SQL NULL, causing one to serialise as a date string and the other as null.

- **All non-null invoice fields are present in every response shape, including zero-valued money fields** — `GET /invoices/:id` for a freshly created invoice with `subtotal_cents=0, tax_cents=0, total_cents=0` still carries every key (`id`, `account_id`, `status`, `subtotal_cents`, `tax_cents`, `total_cents`, `due_date`, `created_at`, `updated_at`). Fails if a generic DTO mapper uses a truthiness filter (`value ? set : skip`) that silently drops zero-string or empty values from the output.

- **Account DTO carries all fields present, including zero-valued counters** — `GET /accounts/:id` for a brand-new account shows `"credit_limit_cents":"0","balance_cents":"0","total_invoiced_cents":"0"` — keys present, values are the string `"0"`. Fails if the account-to-DTO mapping omits keys whose BigInt value is `0n` (falsy), or if a `?? 'default'` coalesce converts the legitimate zero to a placeholder.

- **Error envelope `details` is present-empty-object, never null or absent** — `GET /invoices/:id` with a nonexistent UUID → 404 body is `{ "error": { "code":"resource_not_found", "message":"…", "details":{} } }`. Fails if the global exception filter sets `details: null` (or omits the key) when there are no extra details to attach, violating the "details is an object, never null" contract.

Not testing here: the *value* format of BigInt fields (covered by `bigint-format.spec.ts`), transactional rollback semantics (`transaction-failure.spec.ts`), input validation rejections (`validate-*.spec.ts`), or the non-reversal of counters on void (`void-invoice.spec.ts`) — those are orthogonal concerns with their own failure modes and dedicated spec files.
