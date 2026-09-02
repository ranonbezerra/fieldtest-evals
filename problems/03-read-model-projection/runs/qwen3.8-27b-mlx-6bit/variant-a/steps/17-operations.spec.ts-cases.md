# 17-operations.spec.ts-cases

## reasoning

```
The user wants me to list test cases for `test/operations.spec.ts` based on the PLAN.md specification and the implementation files shown. I need to follow the format exactly:

- `<name of the test>` — `<what it proves, and what would have to be broken for it to fail>`

Let me analyze what the plan says should be tested in `test/operations.spec.ts`:

From PLAN.md section 5:
1. read-your-own-writes: approve an order, next getDashboard includes it with new status
2. concurrent updates to one company's totals: two simultaneous simulateWrite calls for different orders of the same company leave total_amount = sum of both
3. dashboard filters by status and date range correctly
4. pagination returns correct page and total_count

From the task statement:
- "Operators must see their own writes immediately (approve an order → it reflects on the next request)"
- "the financial totals per company must be exact, not approximate"

From the implementation, let me look at what branches could go wrong:

In `getDashboard`:
- page < 1 → ValidationError
- page_size < 1 or > 100 → ValidationError
- date_from >= date_to → InvalidDateRangeError
- company not found (getCompanyTotal returns null) → ResourceNotFoundError
- normal path: queries repo.queryDashboard

In `simulateWrite`:
- worker not found → ResourceNotFoundError
- new order (existingOrder is null) → delta = (+amount, +1)
- existing order with same amount → no delta (deltaAmount stays "0", deltaCount stays 0)
- existing order with different amount → delta = new - old, deltaCount stays 0
- The transaction: source upsert, projection upsert, totals upsert all in one tx
- Read-back after upsert: if row not found → throws Error

In `getCompanyTotals`:
- company not found → ResourceNotFoundError
- normal path: returns totals

Now let me think about what would have to break for each test to fail, and include awkward cases:

1. Read-your-own-writes: After simulateWrite commits, getDashboard must show the new status. Would fail if: projection upsert is outside the transaction, or if getDashboard reads from source instead of projection, or if there's a cache layer.

2. Concurrent totals: Two simultaneous simulateWrite for same company different orders. Would fail if: totals upsert uses a non-atomic read-modify-write (e.g., SELECT then UPDATE without row locking), or if the delta computation is wrong under concurrency.

3. Dashboard filters by status: WHERE clause on projection. Would fail if: the repository builds wrong WHERE, or if status is not denormalised correctly in projection.

4. Dashboard filters by date range: Would fail if: date comparison uses wrong operator (exclusive vs inclusive), or if date_from/date_to are swapped in the query.

5. Pagination: correct page and total_count. Would fail if: OFFSET arithmetic is wrong (off-by-one), or COUNT uses different WHERE than SELECT.

6. Error paths:
   - page < 1 → ValidationError with code "validation_error"
   - page_size out of range → ValidationError
   - date_from >= date_to → InvalidDateRangeError with code "invalid_date_range"
   - unknown company_id in getDashboard → ResourceNotFoundError with code "resource_not_found"
   - unknown worker_id in simulateWrite → ResourceNotFoundError

7. Update path (not insert): simulateWrite on existing order changes status but not amount → totals should NOT change. Would fail if: delta is computed as non-zero when it shouldn't be, or if the code always adds to count.

8. Update path with amount change: simulateWrite changes amount on existing order → total_amount reflects the delta, not a double-add. Would fail if: the code adds the new amount instead of the delta (new - old).

9. The projection row is returned from within the transaction (read-your-own-write at the transaction level). Would fail if: read-back uses the non-transactional prisma client instead of tx.

10. getCompanyTotals for unknown company → ResourceNotFoundError.

Let me also think about what's NOT in this file but IS in other test files (re-derivation, drift-repair) — I should note those as deliberately excluded.

Let me also think about boundary values:
- page_size = 1 (minimum)
- page_size = 100 (maximum)
- date_from == date_to (should fail, strict < required)

And the "error path that looks like success path":
- simulateWrite on an existing order where status changes but amount stays the same → should succeed and NOT change totals. If broken, totals would drift.

Let me structure this properly now.
```

## reply

- read-your-own-writes: simulateWrite inserts a new order as `pending`, then getDashboard for that company includes the row with status `pending` and the correct amount — fails if the projection upsert is outside the interactive transaction (so a read between source-commit and projection-commit sees nothing), or if getDashboard reads the source table instead of the `operations` projection, or if the service swallows a failed upsert and returns a stale/absent row.

- read-your-own-writes on update: simulateWrite first inserts an order as `pending`, then a second simulateWrite for the same `order_id` changes status to `approved`; the subsequent getDashboard shows `approved`, not `pending` — fails if the projection upsert uses an insert-only path (duplicate-key error on second write), or if the update branch omits `status` from the `data` payload so the old value persists.

- concurrent updates to one company's totals do not lose an update: two simulateWrite calls for different `order_id`s of the same company, issued concurrently (both in-flight before either commits), leave `getCompanyTotals` with `total_amount` equal to the sum of both amounts and `order_count` equal to 2 — fails if `upsertCompanyTotal` performs a non-atomic SELECT-then-UPDATE (lost update on the aggregate row), or if the delta for a concurrent insert is computed against a stale `total_amount` read outside the transaction's snapshot.

- update with changed amount adjusts total by delta, not by new amount: first insert an order for 100.00, then simulateWrite the same `order_id` with amount 250.00; getCompanyTotals shows total_amount = 250.00 (not 350.00) and order_count still 1 — fails if the service always adds `input.amount` to the total on update (double-count), or if the delta is computed as `new - old` but the repository's upsert adds rather than sets.

- update with unchanged amount does not perturb totals: insert order for 50.00, simulateWrite same `order_id` with a different status but the same amount 50.00; getCompanyTotals still shows total_amount = 50.00 and order_count = 1 — fails if the code treats any re-write as an insert (incrementing count) or if the zero-delta guard (`deltaAmount !== "0" || deltaCount !== 0`) is missing so a no-op upsert still fires and races with a concurrent writer.

- dashboard filters by status: seed three orders for a company with statuses `pending`, `approved`, `settled`; getDashboard with `status: "approved"` returns only the one approved row and `total_count` = 1 — fails if the repository omits the status predicate, or if the projection row stored the wrong status at upsert time (e.g., always writing `"pending"`).

- dashboard filters by date range (inclusive boundaries): seed orders at T1, T2, T3; getDashboard with `date_from` = T2 and `date_to` = T3 returns the orders at T2 and T3 but not T1 — fails if the repository uses strict `<` on `date_to` (excluding T3), or swaps the comparison direction so `date_from` is an upper bound.

- pagination returns correct slice and total_count: seed 5 orders; getDashboard with `page` = 2, `page_size` = 2 returns the 3rd and 4th rows in recency order and `total_count` = 5 — fails if OFFSET is computed as `page * page_size` instead of `(page - 1) * page_size` (off-by-one), or if the COUNT query uses a different WHERE than the SELECT (e.g., missing the date filter), inflating or deflating `total_count`.

- page_size boundary 1 and 100 are accepted: getDashboard with `page_size` = 1 returns exactly one row; `page_size` = 100 is accepted without error — fails if the validation uses `> 100` correctly but `page_size < 1` accidentally rejects 1, or if the cap is applied as `Math.min(page_size, 99)`.

- page_size of 0 or 101 raises ValidationError with code `validation_error`: getDashboard with `page_size` = 0 and separately `page_size` = 101 each throw an error whose `code` property is `"validation_error"` — fails if the guard is missing (query executes with LIMIT 0 or an unbounded page), or if the thrown error uses a generic `Error` without the `code` field.

- page < 1 raises ValidationError: getDashboard with `page` = 0 throws with code `"validation_error"` — fails if the check is `page < 0` (allowing page 0 which produces a negative offset), or if the error is a 500 `Error` rather than the typed validation error.

- date_from equal to date_to raises InvalidDateRangeError with code `invalid_date_range`: getDashboard with both set to the same timestamp throws the typed error — fails if the comparison is `>` instead of `>=` (allowing an empty-but-not-invalid range to slip through and return zero rows with a 200), or if the error class lacks the `code` field.

- unknown company_id in getDashboard raises ResourceNotFoundError with code `resource_not_found`: getDashboard for a UUID that has no row in `company_financial_totals` throws the typed error with the company_id in `details` — fails if the service skips the existence check and returns an empty page (200 with `data: []`), making a typo indistinguishable from "no results".

- unknown worker_id in simulateWrite raises ResourceNotFoundError: simulateWrite with a `worker_id` that has no matching row throws before any source or projection write occurs — fails if the worker check is inside the transaction after the `paymentOrder.create`, leaving an orphan source row on rollback failure, or if the error is a generic 500.

- getCompanyTotals for an unknown company raises ResourceNotFoundError: calling the service directly with a UUID absent from `company_financial_totals` throws with code `"resource_not_found"` and the id in `details` — fails if the method returns a zero-filled object (total_amount `"0"`, count 0) instead of signalling absence, masking the not-found case.

- projection row is read back from within the transaction (not via the outer client): simulateWrite returns an `OperationRow` whose `status` matches the input and whose `created_at` is non-null — fails if the read-back uses `this.prisma.operation.findUnique` (non-transactional) instead of `tx.operation.findUnique`, so under a concurrent re-derive the returned row could be the old value, or if the repository method `getOperationByOrderId` (which uses the outer client) is called after commit and a concurrent re-derive has already overwritten the row with a stale snapshot.

Not tested in this file: re-derivation idempotency and window repair (`test/re-derivation.spec.ts`), drift-repair detection/skip/recompute (`test/drift-repair.spec.ts`), and the Prisma migration DDL itself — those have their own spec files per the plan's manifest.
