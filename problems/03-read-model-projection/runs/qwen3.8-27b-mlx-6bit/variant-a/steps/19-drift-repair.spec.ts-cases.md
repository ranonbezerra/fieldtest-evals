# 19-drift-repair.spec.ts-cases

## reasoning

```
The user wants me to list test cases for `test/drift-repair.spec.ts` based on the plan and the implementation shown. Let me analyze what the drift-repair service does and what the plan says should be tested.

From the plan (section 5):
- drift-repair detects and repairs a stale projection row
- drift-repair skips rows where source is newer than projection (concurrent write guard)
- drift-repair recomputes company totals after repair

From the implementation (`drift-repair.service.ts`):
- `run()` defines a window: `[now - 1h, now]`
- Fetches projection rows with `updated_at` in window via `findProjectionByWindow`
- For each row:
  - Fetches source order via `findOrderById(projection.order_id)` — if null, skip
  - Gets `projectionUpdatedAt` from the projection row
  - If `!projectionUpdatedAt`, skip
  - Stale-read guard: if `sourceOrder.updatedAt <= projectionUpdatedAt`, skip (not stale)
  - Fetches worker via `findWorkerById` — if null, skip
  - Fetches last event via `findLastEventForOrder`
  - Calls `rederiveOperationRow` which upserts projection + recomputes company totals
  - Increments `rowsRepaired` and adds to `repairedCompanyIds`
- Returns report with window_start, window_end, rows_checked, rows_repaired

Let me think about what could be wrong on each branch:

1. **Basic detection and repair**: A projection row is stale (source.updatedAt > projection.updatedAt). The service should detect it and repair it. Failure: if the comparison is inverted, or if the upsert doesn't actually update the row, or if the report count is wrong.

2. **Concurrent write guard (skip fresh source)**: If source.updatedAt <= projection.updatedAt, the row is NOT stale and should be skipped. Failure: if the comparison is `<` instead of `<=`, or inverted.

3. **Concurrent write guard (source is newer — the "in-flight write" scenario)**: Actually wait, re-reading the guard: `if (sourceOrder.updatedAt <= projectionUpdatedAt) { continue; }` — this means "skip if source is NOT newer". So the repair happens when source IS newer. The "concurrent write guard" in the plan says "skipping rows whose payment_orders.updated_at is newer than the projection row's updated_at (stale read guard)" — wait, that's contradictory. Let me re-read.

Plan says: "it must tolerate concurrent writes by skipping rows whose `payment_orders.updated_at` is newer than the projection row's `updated_at` (stale read guard)."

But the implementation does: `if (sourceOrder.updatedAt <= projectionUpdatedAt) { continue; }` — this skips when source is OLDER or EQUAL, and repairs when source is NEWER.

Wait, that's the opposite of what the plan says. The plan says skip when source is NEWER (because a concurrent write is in-flight), but the implementation repairs when source is NEWER.

Hmm, actually let me re-read the plan more carefully: "it must tolerate concurrent writes by skipping rows whose `payment_orders.updated_at` is newer than the projection row's `updated_at` (stale read guard)."

I think the plan is saying: if you read the source and find it's newer than what you have in projection, that might be because a concurrent write just happened and the projection will be updated by that write's hook. So you should skip it to avoid clobbering.

But the implementation does the opposite: it repairs when source is newer. This is a discrepancy between plan and implementation. However, my job is to list test cases for what the tests will run against — the implementation files. So I should write tests that match the implementation's behavior, OR flag this as something that could be wrong.

Actually wait — let me re-read the task: "the implementation files shown read-only are what these tests will run against." So I should write test cases that test the implementation as-is, but also flag where it might be wrong per the plan.

Actually, I think there's a subtlety. The plan says the drift-repair should skip rows where source is newer because those are being handled by concurrent writes. But the implementation repairs them. This is a potential bug. My test list should include a case that would catch this discrepancy.

Let me also think about:
- **Missing source order**: `findOrderById` returns null → skip. Failure: if the code doesn't handle null and crashes, or counts it as repaired.
- **Missing projectionUpdatedAt**: `projection.updated_at` is undefined → skip. Failure: if the code doesn't handle this and crashes.
- **Missing worker**: `findWorkerById` returns null → skip. Failure: if the code doesn't handle null and crashes, or counts it as repaired.
- **Empty window (no rows)**: `findProjectionByWindow` returns empty array. Failure: if the code doesn't handle empty and crashes, or reports wrong count.
- **Report accuracy**: rows_checked should be the total number of projection rows in window, rows_repaired should be only those actually repaired. Failure: if the counts are wrong (e.g., counting skipped rows as repaired).
- **Multiple rows, mix of stale and fresh**: Some rows are stale, some aren't. Failure: if the loop breaks early or miscounts.
- **Multiple rows for same company**: Two stale rows for the same company. The totals should be recomputed correctly. Failure: if the recompute is per-row but uses stale data, or if it's only done once.
- **Idempotency**: Running drift-repair twice — second run should find no stale rows (since first run fixed them). Failure: if the repair introduces new drift, or if the comparison is off-by-one on timestamps.
- **Boundary: source.updatedAt === projection.updatedAt**: The `<=` means this is skipped. Failure: if the comparison is `<` instead of `<=`.
- **The `repairedCompanyIds` set is computed but never used in the return**: This is dead code, not a bug per se, but worth noting.

Wait, looking more carefully at the implementation: `repairedCompanyIds` is built but never used. The report doesn't include it. This is just dead code, not a testable behavior issue unless the plan expected it in the report.

Let me also consider:
- **Window boundary**: A row with `updated_at` exactly at `windowStart` or `windowEnd`. Does `findProjectionByWindow` include boundaries? This depends on the repository implementation which I don't have, but it's worth a test.

Actually, I don't have the repository implementation, so I can't test window boundaries directly. I'll focus on what the service does with the rows it receives.

Let me also think about the "concurrent updates to one company's totals" aspect. The plan says: "concurrent updates to one company's totals: two simultaneous simulateWrite calls for different orders of the same company leave total_amount = sum of both". But that's in `test/operations.spec.ts`, not drift-repair. For drift-repair, the relevant concern is: if two stale rows for the same company are repaired in sequence, does the totals recompute correctly? Since each `rederiveOperationRow` recomputes via SUM/COUNT, the second call will see the first's effect (same transaction? No — different transactions since each row is its own tx). So the final state should be correct. But if both read before either writes... actually each is in its own transaction, so they're sequential. The second will see the first's commit.

Wait, but the plan says "drift-repair per row | Yes (per row) | Single projection upsert + totals recompute for that company". So each row gets its own transaction. If two rows are for the same company, the first tx recomputes totals (including both orders since SUM is over all orders), and the second tx also recomputes totals (same result). So it's fine — idempotent.

But what if between the two tx commits, a concurrent `simulateWrite` adds a third order? Then the second drift-repair tx's SUM would include that third order, which is correct. Good.

Now let me structure the test cases:

1. Detects and repairs a stale projection row (basic happy path)
2. Skips a row where source is not newer than projection (source.updatedAt < projection.updatedAt)
3. Skips a row where source timestamp equals projection timestamp (boundary: <=)
4. Skips a row whose source order no longer exists (findOrderById returns null)
5. Skips a row where projection has no updated_at (defensive)
6. Skips a row whose worker no longer exists (findWorkerById returns null)
7. Empty window — no projection rows in range
8. Mixed batch: some stale, some fresh — only stale are repaired, counts correct
9. Multiple stale rows for same company — totals correct after all repairs
10. Idempotency: running twice, second run repairs zero rows
11. Report fields are correct (window_start, window_end, rows_checked, rows_repaired)
12. The plan's "concurrent write guard" — source is newer, should it skip or repair? (This tests the discrepancy)

Wait, I need to be more careful. The plan says skip when source is newer (concurrent write in flight). The implementation repairs when source is newer. So:
- If I write a test "skips when source is newer" it will FAIL against the implementation (because implementation repairs it).
- If I write a test "repairs when source is newer" it will PASS against the implementation but contradict the plan.

I should list both angles: one that tests the implementation's actual behavior (repairs when source is newer) and flag the discrepancy with the plan. Actually, the user said "what would have to be broken for it to fail" — so I should write tests that verify correct behavior. If the plan says "skip when source is newer" but the implementation "repairs when source is newer", then one of them is wrong. I'll write the test to match what I think is correct per the plan, and note that it would fail against the current implementation.

Hmm, but actually re-reading the plan: "it must tolerate concurrent writes by skipping rows whose `payment_orders.updated_at` is newer than the projection row's `updated_at` (stale read guard)."

I think the reasoning is: if source.updatedAt > projection.updatedAt, it could mean either (a) the projection is genuinely stale and needs repair, OR (b) a concurrent write just updated the source and its hook will update the projection momentarily. The plan chooses to skip in case (b) to avoid clobbering.

But the implementation always repairs in that case. This is a real discrepancy. I'll include a test case for the plan's intended behavior and note it would fail against the implementation.

Actually, let me reconsider. Maybe I'm overthinking this. The user asked me to list test cases. Let me just be practical:

The implementation's logic is:
- If source exists AND projection.updated_at exists AND source.updatedAt > projection.updatedAt AND worker exists → repair
- Otherwise → skip

I'll write test cases for each branch of this logic, plus the report correctness, plus edge cases.

Let me finalize my list:

1. Repairs a projection row whose source is strictly newer
2. Does not repair a projection row whose source is older (source.updatedAt < projection.updatedAt)
3. Does not repair a projection row whose source timestamp equals the projection's (boundary: <=)
4. Skips and does not count a row whose source order has been deleted
5. Skips a projection row that lacks an updated_at timestamp (defensive null guard)
6. Skips and does not count a row whose worker no longer exists
7. Returns zero-checked, zero-repaired when the window contains no projection rows
8. In a mixed batch, repairs only the stale rows and reports accurate checked/repaired counts
9. When two stale rows belong to the same company, the final company totals reflect both orders (sequential tx recompute is correct)
10. A second run immediately after the first repairs zero rows (idempotency)
11. The report's window_start and window_end are exactly 1 hour apart, with window_end ≈ now
12. Plan discrepancy: the plan says drift-repair must skip rows where source is newer (to avoid clobbering in-flight concurrent writes); the implementation repairs them. A test asserting the plan's "skip" behaviour would fail against current code.

And what I'm NOT testing:
- The cron scheduling itself (that's a NestJS scheduler concern, not the service logic)
- The repository's SQL correctness (findProjectionByWindow, findOrderById, etc.) — those are unit-tested separately or integration-tested at the DB layer
- The `rederiveOperationRow` upsert logic itself (tested in re-derivation.spec.ts)

Let me write this up cleanly.
```

## reply

- Repairs a projection row whose source is strictly newer — proves the core detect-and-fix path; would fail if the staleness comparison were inverted (`>=` vs `>`, or comparing the wrong fields), or if `rederiveOperationRow` were never called, or if `rows_repaired` were not incremented on the success path.
- Does not repair a projection row whose source is older than the projection — proves the non-stale branch is a no-op; would fail if the `continue` guard were missing or the comparison flipped, causing an unnecessary upsert and a false-positive `rows_repaired` count.
- Does not repair a projection row whose source timestamp equals the projection's (boundary: `<=`) — proves the equality case is treated as "not stale"; would fail if the guard used strict `<` instead of `<=`, letting an equal-timestamp row through and producing a spurious repair.
- Skips and does not count a row whose source order no longer exists — proves the null-source guard; would fail if the code dereferenced `sourceOrder` without checking, or if a null source still incremented `rows_repaired`.
- Skips a projection row that carries no `updated_at` (defensive null guard) — proves the code tolerates a missing projection timestamp rather than crashing on `undefined <= Date`; would fail if the guard were absent and the comparison threw a TypeError.
- Skips and does not count a row whose worker no longer exists — proves the null-worker guard; would fail if `findWorkerById` returning null were not handled before the upsert, or if the row was still counted as repaired.
- Returns `rows_checked: 0` and `rows_repaired: 0` when the window contains no projection rows — proves the empty-batch path does not short-circuit into an error or produce a non-zero count; would fail if the loop or the report assembly assumed at least one row.
- In a mixed batch of stale and fresh rows, repairs only the stale ones and reports accurate `rows_checked` / `rows_repaired` — proves the per-row branch selection is independent; would fail if the loop broke on the first fresh row, or if `rows_checked` counted only repaired rows, or if a fresh row was erroneously upserted.
- When two stale rows belong to the same company, the final `company_financial_totals` row reflects the correct aggregate after both repairs — proves that sequential per-row transactions each recompute totals via SUM/COUNT over the full source, so the second commit is not lost; would fail if the totals update were a delta (accumulate) rather than a recompute, or if the second transaction read a pre-first-commit snapshot.
- A second run immediately after the first repairs zero rows (idempotency) — proves the repair brings the projection to a state where no row is stale on re-check; would fail if `rederiveOperationRow` set the projection's `updated_at` to a value ≤ the source's (e.g., copying `source.createdAt` instead of `now()`), leaving the row perpetually "stale".
- The report's `window_start` and `window_end` are exactly one hour apart, with `window_end` ≈ the clock time at invocation — proves the window arithmetic is correct; would fail if the offset were in seconds (1 000 ms instead of 3 600 000 ms) or if the endpoints were swapped.
- Plan-contract: the plan mandates that drift-repair must *skip* rows where `payment_orders.updated_at` is newer than the projection's, to avoid clobbering a concurrent write whose hook has not yet committed. The current implementation *repairs* in that case. A test asserting the plan's skip-on-concurrent-write contract would fail against the implementation as written — this is the highest-risk discrepancy between spec and code.

Not testing: the `@Cron` scheduling cadence (a NestJS scheduler concern, verified in integration/E2E, not unit); the SQL correctness of `findProjectionByWindow`, `findOrderById`, and `rederiveOperationRow` (covered by `test/operations.spec.ts` and `test/re-derivation.spec.ts`); and the totals-delta-vs-recompute logic in `simulateWrite` (owned by `test/operations.spec.ts`).
