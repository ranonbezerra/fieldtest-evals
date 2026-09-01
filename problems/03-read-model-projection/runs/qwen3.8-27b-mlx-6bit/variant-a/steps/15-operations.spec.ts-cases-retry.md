# 15-operations.spec.ts-cases-retry

## reasoning

```
Let me analyze the task requirements, the plan, and the implementation to identify what test cases are needed.

From the task statement:
- Read-your-own-writes (approve an order → it reflects on the next request)
- Concurrent updates to one company's totals
- Drift repair

From the plan's test section:
1. Read-your-own-writes: create order, immediately query dashboard for that company, assert the new row appears with correct fields
2. Read-your-own-writes: approve an order, query dashboard filtered by status=approved, assert it appears
3. Concurrent updates: fire N concurrent approveOrder calls on different orders for the same company, then read company_financial_totals, assert approved_total_cents equals sum of all amounts and pending_count is correct
4. Concurrent updates: fire concurrent createOrder + approveOrder interleaved for one company, verify final totals match the sum of final order statuses
5. Drift repair: manually corrupt a projection row (change status, change amount), run repairDrift for that window, assert projection matches source and totals are corrected
6. Drift repair: delete a projection row, run repairDrift, assert the row is restored and totals reflect it
7. Re-derivation: create orders, corrupt projection, run rederive for the window, assert projection is rebuilt from source
8. Dashboard pagination: insert 25 rows, query page 1 size 10, assert 10 items + correct total; page 3, assert 5 items
9. Dashboard filter by date range: insert orders with known timestamps, query with from/to, assert only in-range rows returned

Now let me think about what could be wrong on its own (branch that could fail):

1. **Read-your-own-writes: create** — The projection row must appear in the dashboard query immediately after createOrder. What would break: if the sync hook doesn't run, or runs outside the transaction (so it's not committed by the time the next read happens), or if the projection row's fields are wrong (denormalized fields not populated).

2. **Read-your-own-writes: status change** — After approveOrder, the row in the dashboard must show status=approved. What would break: if applyOrderStatusChanged doesn't update the projection row, or if the totals aren't adjusted (pending decremented, approved incremented).

3. **Concurrent approvals on same company** — N concurrent approveOrder calls must result in exact totals. What would break: if adjustTotals uses a read-then-write pattern (lost update) instead of atomic increment, or if the upsert on company_financial_totals races.

4. **Concurrent create + approve interleaved** — Final totals must match. What would break: same as above but with the create path also racing (pending_count increment vs approve's pending_count decrement).

5. **Drift repair: corrupted row** — A projection row with wrong status/amount must be fixed. What would break: if repairDrift doesn't compare all fields, or doesn't reset totals after fixing.

6. **Drift repair: missing row** — A deleted projection row must be restored. What would break: if repairDrift only handles stale rows but not missing ones.

7. **Re-derivation** — After corrupting the projection, rederive must rebuild it from source. What would break: if rederive doesn't delete old rows first, or if the source window query is wrong.

8. **Pagination: page 1** — Correct items and total. What would break: if skip/take is wrong, or if total doesn't reflect the filtered set.

9. **Pagination: last partial page** — Page 3 with size 10 on 25 rows returns 5. What would break: if the query doesn't handle partial pages, or if total is wrong.

10. **Pagination: boundary — page 1 size 100 (max)** — Should work. What would break: if the service rejects valid max page size.

11. **Pagination: boundary — pageSize 101** — Should be rejected with invalid_query_params. What would break: if validation is off-by-one or missing.

12. **Pagination: boundary — page 0** — Should be rejected. What would break: if validation only checks > 0 for pageSize but not page.

13. **Date range filter: from/to** — Only rows within [from, to) returned. What would break: if the where clause uses wrong operators (e.g., gte/lt vs gt/lte), or if the projection's created_at doesn't match the source order's created_at.

14. **Date range: boundary — from inclusive, to exclusive** — A row exactly at `from` is included, a row exactly at `to` is not. What would break: if the repository uses wrong inequality operators.

15. **Status filter** — Query with status=approved returns only approved rows. What would break: if the filter is not applied, or if it's case-sensitive incorrectly.

16. **Totals: approved total is exact (BigInt)** — After approving orders with known amounts, the sum must be exact. What would break: if cents are stored as float, or if the increment uses wrong type.

17. **Totals: pending_count decrements on approve** — After approving a pending order, pending_count goes down by 1. What would break: if the delta calculation in applyOrderStatusChanged doesn't check the old status.

18. **Totals: pending_count decrements on reject** — Same but for reject path. What would break: same as above.

19. **Error: approve non-existent order** — Returns order_not_found error code. What would break: if the service doesn't check for null, or returns wrong error code.

20. **Error: approve already-approved order** — Returns invalid_transition. What would break: if the transition validation is missing or inverted.

21. **Error: reject already-rejected order** — Same as above for reject.

22. **Drift repair: orphan projection row (in projection but not in source)** — Counted as corrected. What would break: if repairDrift doesn't handle this case (the implementation notes it can't delete orphans individually, just counts them — so this is a known limitation).

Wait, looking at the implementation more carefully:

In `repairDrift`, orphan rows (in projection but not in source) are counted as `rowsCorrected++` but NOT actually deleted. The comment says "They will be cleaned on the next full rederive." So a test for this would actually fail against the current implementation — or we should note that this is deliberately not tested because the implementation has a known gap.

Actually, let me re-read the task: "Include the cases that are awkward." So I should include a case for orphan rows and note that it would fail because the implementation doesn't delete them.

Wait, but the instruction says "Say what would have to break." If the test would fail against the current implementation, then it's a test that exposes a bug. I should still list it because it's a behaviour the plan says matters (the plan says "rows in projection but not in source → delete").

Let me also think about:
- What happens if `applyOrderCreated` is called but the source row's createdAt has a different company than what's passed in `input.companyId`? The implementation uses `input.companyId` for adjustTotals but `sourceRow.companyId` for the projection row. If they differ, totals go to the wrong company. This is a potential bug.

- What about the `applyOrderStatusChanged` using `fetchProjectionWindow(new Date(0), new Date(Date.now() + 1))` — this is O(n) scan of all projection rows. It works but is inefficient. A test wouldn't catch this unless we're testing performance.

- The `rederive` method doesn't use a transaction wrapping all the operations (delete + fetch + bulkUpsert + resetTotals). The plan says "All in one transaction" but the implementation doesn't wrap it. This means if it crashes mid-way, you get partial state. A test for this would be hard to write deterministically.

Let me also think about what the plan says about the `rederive` totals: it recomputes totals from only the rows in the window. But what if a company had orders outside the window? The totals would be wrong because `resetTotals` overwrites the entire row, not just the delta for the window. This is a bug! The plan says "recompute totals for affected companies from the newly inserted rows" — but this only counts orders in the window, not all orders for that company.

Actually wait, let me re-read: "For each affected company: recompute totals from the newly inserted rows; resetTotals." This is indeed a bug if a company has orders both inside and outside the window. The `resetTotals` would overwrite with only the in-window totals.

This is a significant bug that a test could catch: create orders at different times, rederive for a window that only covers some of them, and check that totals still include the out-of-window orders.

Let me compile my final list:

1. Read-your-own-writes: create → dashboard shows new row
2. Read-your-own-writes: approve → dashboard filtered by approved shows the row with status=approved
3. Read-your-own-writes: reject → dashboard filtered by rejected shows the row with status=rejected
4. Concurrent approvals on same company → totals exact
5. Concurrent create + approve interleaved → final totals match
6. Drift repair: corrupted status in projection → repaired
7. Drift repair: corrupted amount in projection → repaired
8. Drift repair: missing projection row → restored
9. Drift repair: orphan projection row (in projection, not in source) → this would fail because implementation doesn't delete orphans
10. Drift repair: totals are corrected after fixing rows
11. Re-derivation: rebuilds projection from source after corruption
12. Re-derivation: totals are correct after rederive (but this has the bug about out-of-window orders)
13. Pagination: page 1 of 25 with size 10 → 10 items, total=25
14. Pagination: last partial page (page 3, size 10, 25 rows) → 5 items
15. Pagination: pageSize > 100 → rejected with invalid_query_params
16. Pagination: page < 1 → rejected with invalid_query_params
17. Date range filter: from/to → only in-range rows
18. Date range boundary: row exactly at `from` included, row exactly at `to` excluded
19. Status filter: only matching status returned
20. Error: approve non-existent order → order_not_found
21. Error: approve already-approved order → invalid_transition
22. Error: reject already-rejected order → invalid_transition
23. Totals: pending_count decremented on approve
24. Totals: approved_total_cents is exact sum (BigInt arithmetic)
25. Re-derivation with out-of-window orders: totals still include all orders (this would expose the bug)

Let me think about whether I'm being too granular or not. The instruction says "A case per branch that could be wrong on its own." Let me consolidate slightly but keep the branches distinct.

Actually, I think I should also consider:
- The `adjustTotals` uses `upsert` with `increment`. If two concurrent transactions both try to upsert the same company row, Postgres will serialize them on the row lock. The increment should be atomic. But if the implementation used a read-then-write, it would lose updates. A test with concurrent writes proves this works.

- What about the error envelope shape? The plan says errors use `{ error: { code, message, details } }`. A test could verify the shape. But that's more of a contract test. I'll include one for the error path.

Let me finalize my list. I'll aim for clarity and make sure each case names what would have to break.
```

## reply

- Read-your-own-writes: create order then query dashboard — the new row must appear with correct denormalised fields (workerName, eventTitle, eventLocation) on the very next read. Fails if the sync hook is missing, runs outside the transaction (so it's invisible until a later commit), or the joined source read inside `applyOrderCreated` doesn't populate the denormalised columns.

- Read-your-own-writes: approve order then query dashboard with `status=approved` — the row must show `status: 'approved'`. Fails if `applyOrderStatusChanged` doesn't call `updateOrderStatus`, or if the projection row's status column isn't actually updated (e.g. wrong field name in the `update` data).

- Read-your-own-writes: reject order then query dashboard with `status=rejected` — the row must show `status: 'rejected'`. Fails if the reject path in `changeOrderStatus` doesn't propagate to the projection, or if `applyOrderStatusChanged` only handles the `approved` branch.

- Concurrent approvals on the same company — N concurrent `approveOrder` calls on distinct orders must yield `approvedTotalCents` equal to the exact sum of all approved amounts and `pendingCount` decremented by N. Fails if `adjustTotals` uses a read-then-write pattern (lost update), or if the `increment` on the upsert isn't atomic under concurrent row-lock contention.

- Concurrent interleaved create and approve for one company — fire `createOrder` and `approveOrder` in parallel (some approves target orders created earlier in the same batch); final `approvedTotalCents` and `pendingCount` must match the sum of final statuses. Fails if the create path's `pendingDelta: +1` and the approve path's `pendingDelta: -1` race such that one increment is lost, or if an approve targets an order whose projection row isn't yet committed (should be prevented by the same-transaction constraint, but a broken transaction boundary would allow it).

- Drift repair: projection row has wrong status — corrupt a projection row's `status` to `'approved'` while source says `'pending'`; run `repairDrift`; the projection row must be restored to `'pending'` and totals must reflect the correction (approved total decreased, pending count increased). Fails if `repairDrift`'s comparison misses the status field, or if it upserts the row but doesn't call `resetTotals` for the affected company.

- Drift repair: projection row has wrong amount — corrupt `amountCents` on a projection row; run `repairDrift`; the amount must match source and totals must be corrected. Fails if the field-by-field comparison in `repairDrift` omits `amountCents`, or if totals are reset from the stale projection rather than from source.

- Drift repair: projection row is missing — delete a projection row directly via the repository; run `repairDrift`; the row must be reinserted with all fields matching source and totals must include it. Fails if `repairDrift` only iterates over rows present in the projection (and thus never sees the gap), or if `upsertOrder` is called but `resetTotals` is skipped because `affectedCompanies` isn't populated for insertions.

- Drift repair: orphan projection row (present in projection, absent from source) — `repairDrift` counts it as corrected but the implementation does not delete it. The test would assert the orphan is gone; it fails against the current code because the loop only increments `rowsCorrected` without calling any delete. This documents the known gap where orphans persist until a full `rederive`.

- Re-derivation: corrupt projection then rebuild — create orders, tamper with two projection rows (wrong status + wrong amount), run `rederive(from, to)` covering their window; all projection rows in the window must match source exactly. Fails if `rederive` doesn't call `deleteProjectionWindow` first (so stale rows survive), or if `fetchSourceWindow`'s raw SQL JOIN is wrong (e.g. missing a join condition).

- Re-derivation: totals after rebuild include only in-window orders — create 3 orders for company A (two in the rederive window, one before it); run `rederive` for the window; `approvedTotalCents` for company A must reflect all 3 orders (or at least not be wrong due to partial reset). Fails because the implementation's `resetTotals` overwrites the entire totals row with sums computed from only the in-window rows, discarding contributions from out-of-window orders. This is a real bug the test would expose.

- Pagination: first page — 25 rows exist for a company; query `page=1, pageSize=10`; must return 10 items and `total=25`. Fails if `skip` is computed as `page * pageSize` (off-by-one) or if the `count` query uses a different `where` than the `findMany`.

- Pagination: last partial page — 25 rows; query `page=3, pageSize=10`; must return 5 items and `total=25`. Fails if the repository doesn't handle a result set smaller than `take`, or if `total` is computed as the length of the current page instead of the full filtered count.

- Pagination: `pageSize` exceeds 100 — query with `pageSize=101`; must return the standard error envelope with `code: 'invalid_query_params'`. Fails if the service's validation uses `>=` instead of `>`, or if the error is thrown as a bare string without the envelope shape.

- Pagination: `page` less than 1 — query with `page=0`; must return `invalid_query_params`. Fails if validation only guards `pageSize` and doesn't check `page < 1`.

- Date range filter: only in-range rows returned — insert orders with `createdAt` at known timestamps; query with `from` and `to` that exclude some; only in-range rows must appear. Fails if the repository's `where` clause is missing, or if the projection's `createdAt` was set to the projection's `updatedAt` (current time) rather than the source order's original `createdAt`.

- Date range boundary: `from` is inclusive, `to` is exclusive — insert a row with `createdAt` exactly equal to `from` and another exactly equal to `to`; query with that range; the first must be included, the second excluded. Fails if the repository uses `gt`/`lte` instead of `gte`/`lt`, or if the raw SQL in `fetchSourceWindow` uses different operators than the Prisma query in `findPage`.

- Status filter: only matching status returned — insert orders with mixed statuses; query `status=approved`; only approved rows must appear and `total` must reflect the filtered count. Fails if the `where` clause doesn't include the status condition, or if Prisma's enum comparison is case-sensitive in a way that mismatches the stored value.

- Error: approve a non-existent order — call `approveOrder` with an ID that was never created; must return the error envelope with `code: 'order_not_found'`. Fails if the service doesn't check for `null` after `findUnique`, or if it throws a generic 500 instead of the structured envelope.

- Error: approve an already-approved order — call `approveOrder` twice on the same order; the second call must return `code: 'invalid_transition'`. Fails if the transition guard is missing, or if it compares `order.status !== targetStatus` with wrong operand order (always true).

- Error: reject an already-rejected order — call `rejectOrder` twice; second call must return `invalid_transition`. Fails for the same reason as above but on the reject path specifically.

- Totals: `pendingCount` decrements on approve — create 3 orders (all pending), approve 1; read totals; `pendingCount` must be 2. Fails if `applyOrderStatusChanged` doesn't check the old status before computing `pendingDelta`, or if it hardcodes `pendingDelta: -1` without verifying the old status was actually `'pending'`.

- Totals: `approvedTotalCents` is exact under large values — create orders with amounts that sum to a value exceeding `Number.MAX_SAFE_INTEGER` / use `BigInt` arithmetic; approve all; read totals; the sum must be bit-exact. Fails if `amountCents` is stored as `Int` (32-bit) in the Prisma model and overflows, or if the accumulation in `rederive` uses `Number` instead of `BigInt`.

- Deliberately not tested: performance (p95 < 50 ms), because the projection's value is architectural and a single-row test on a dev database cannot reproduce the 3M-row cardinality that makes the original query slow; and orphan deletion by `repairDrift`, because the implementation has a documented gap (orphans are counted but not removed) and testing for it would assert behaviour the code does not yet have.
