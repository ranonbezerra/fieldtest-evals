# 18-re-derivation.spec.ts-cases

## reasoning

```
The user wants me to list test cases for `test/re-derivation.spec.ts` based on the PLAN.md specification and the implementation files shown. I need to produce one line per test case in the specified format, covering the behavior the task asks to be tested and the behavior the plan says matters.

Let me look at what PLAN.md says about re-derivation tests:

From the plan's test table:
1. `re-derive a window after manually corrupting a projection row restores it` — Re-derivation is a correct repair path
2. `re-derive is idempotent (run twice, same result)` — No double-counting or drift on replay

Now let me look at the implementation to understand what branches could be wrong:

From `re-derivation.service.ts`:
1. Date range validation: `date_from >= date_to` throws `InvalidDateRangeError`
2. Fetches orders by window
3. For each order in the batch:
   - Looks up worker — if not found, logs warning and skips (continue)
   - Looks up last event (may be null)
   - Builds simulateInput from the order
4. If batchEntries is empty (all workers missing), skips the transaction
5. Within a transaction:
   - Upserts operation rows
   - Collects affected companies
   - Recomputes company totals (absolute SUM/COUNT, not delta)
6. Returns `{ rows_rewritten: count }`

Key branches that could be wrong independently:
- Invalid date range (date_from >= date_to) → error
- Valid date range with no orders → returns 0 rows_rewritten
- Worker not found for an order → skipped, not counted in rows_rewritten
- Last event is null → projection row has last_event_type = null
- Multiple orders for same company in one batch → totals recomputed once per company (not per order)
- Batch boundary: exactly 500 orders vs 501 orders (two batches)
- Idempotency: running twice produces same result
- Repair: corrupt a projection row, re-derive restores it
- Company totals are recomputed as absolute values (not delta) — concurrent writes during re-derivation
- The re-derivation does NOT delete rows outside its window
- Empty batch (all workers missing) skips the transaction entirely

Let me also think about what the task statement asks: "a re-derivation routine for an arbitrary date window" — so the core behavior is: given a window, rebuild projection rows from source.

Awkward cases:
- Boundary: date_from === date_to (should reject)
- date_from > date_to (should reject)
- Exactly 500 orders (one batch) vs 501 (two batches)
- A company has orders in the window but all workers are missing → no projection writes, no totals recompute
- Concurrent write during re-derivation: a new order is inserted for a company mid-batch; the totals recompute at end of batch should include it (absolute SUM/COUNT)
- A projection row exists but source order was deleted? Actually the plan says "Re-derivation must not delete rows outside its window" — so we're not testing deletion.
- Re-derivation of a window where the source order's amount changed → projection is updated to new amount

Let me structure the list:

1. Invalid date range (date_from === date_to) throws InvalidDateRangeError
2. Invalid date range (date_from > date_to) throws InvalidDateRangeError
3. Window with no matching orders returns rows_rewritten = 0
4. Corrupted projection row is restored after re-derive of the containing window
5. Re-derivation is idempotent: running the same window twice yields identical projection rows and totals
6. Re-derivation updates a projection row when the source amount/status changed
7. Worker not found for an order: that order is skipped, not counted in rows_rewritten, and its projection row (if any) is left untouched
8. Last event is null: projection row's last_event_type is null
9. Company totals are recomputed as absolute SUM/COUNT from source (not delta) — a concurrent insert during the batch is reflected in the post-batch total
10. Batch boundary: exactly BATCH_SIZE orders produce one transaction; BATCH_SIZE+1 produce two transactions (verify via row count and no cross-contamination)
11. Re-derivation does not delete or modify projection rows outside the requested window
12. All orders in a batch have missing workers: no transaction is opened (no totals recompute side-effect)

Wait, for #10, testing "one transaction vs two transactions" is an implementation detail. Better to test the behavior: 501 orders all get their projection rows written, and totals are correct. The transaction boundary is invisible to the caller unless something fails mid-batch.

Actually, a more useful test for the batch boundary: if the first 500 orders belong to company A and the next 1 belongs to company B, both companies' totals should be correct. This tests that per-batch company tracking doesn't leak across batches incorrectly.

Let me also think about: what if the same order appears twice in the window? That shouldn't happen (it's a SELECT by date range, each order has one created_at), so that's not really a case.

What about: re-derivation of an order whose status is "settled" — the totals should include it (the plan says all statuses included in totals).

Let me refine my list to be focused and name what would break:

- date_from equal to date_to → InvalidDateRangeError. Breaks if: the guard is `>` instead of `>=`, or missing entirely.
- date_from after date_to → InvalidDateRangeError. Breaks if: same as above, or the comparison is reversed.
- Empty window → 0 rows. Breaks if: the code throws on empty, or counts something incorrectly.
- Corrupt projection → restored. Breaks if: upsert doesn't actually overwrite (e.g., only inserts), or the field mapping is wrong.
- Idempotent → same result. Breaks if: totals use delta instead of absolute (double-counting on second run), or upsert creates duplicates.
- Source field changed → projection reflects new value. Breaks if: the code reads from the projection instead of source, or doesn't update existing rows.
- Worker missing → skipped, not counted. Breaks if: the code throws instead of skipping, or counts it in rows_rewritten.
- Last event null → projection last_event_type is null. Breaks if: the code uses a default string or throws.
- Absolute totals under concurrent write → total includes the concurrent insert. Breaks if: totals use delta (the concurrent insert's delta was already applied by the write path, so recompute would be correct, but if it were delta-based in re-derive it would double-count). Actually wait — the plan says re-derive uses absolute SUM/COUNT. If it used delta, running re-derive on a window would add the amounts again. So the break condition is: totals computed as delta instead of absolute SUM/COUNT.
- No cross-window modification → rows outside window untouched. Breaks if: the code does a DELETE or updates by company_id without date filter.
- All workers missing in a batch → no side effects. Breaks if: the code still opens a transaction and recomputes totals for companies with no valid entries (would be a no-op if absolute, but the empty-batch skip is the guard).

I think I should also include: re-derivation correctly handles multiple companies in one window (totals per company are independent). Breaks if: the code aggregates across companies.

And: the returned rows_rewritten count matches only the orders that were actually processed (excluding skipped ones). Breaks if: the counter increments before the worker check.

Let me finalize. I'll aim for about 10-12 cases that each have a distinct failure condition.
```

## reply

- **re-derive rejects a window where date_from equals date_to** — proves the guard uses `>=` (not `>`); would fail if the comparison is strictly greater-than or missing, letting a zero-width window through to an empty SELECT that returns 0 rows instead of raising `InvalidDateRangeError`.

- **re-derive rejects a window where date_from is after date_to** — proves the guard catches an inverted range; would fail if the comparison logic is reversed or only checks equality.

- **re-derive on a window with no matching orders returns `{ rows_rewritten: 0 }` without side-effects** — proves the empty-result path is handled; would fail if the code throws on an empty array, or if it still opens a transaction and "recomputes" totals for companies that have no orders in the window (a no-op if absolute, but a mutation if delta-based).

- **re-derive restores a projection row whose status, amount, and last_event_type were manually corrupted to wrong values** — proves the upsert actually overwrites an existing row (not insert-only) and maps every denormalised field from source; would fail if the upsert is keyed wrong, a field is omitted from the update set, or the code reads from the projection instead of source.

- **re-derive is idempotent: running the same window a second time yields byte-identical projection rows and unchanged company totals** — proves totals are computed as absolute SUM/COUNT from source, not as a delta added on top; would fail if the totals step adds the window's amounts again (double-counting) or if the upsert creates a duplicate row.

- **re-derive reflects a concurrent source update: an order's amount is changed in `payment_orders` after the window fetch but before the batch commits, and the projection and totals reflect the new amount** — proves the absolute SUM/COUNT reads source at commit time; would fail if the code snapshots the amount during the fetch loop and writes that stale value, or if totals are delta-based (the write path already applied the delta, so an absolute recompute is the only correct reconciliation).

- **re-derive skips an order whose worker_id does not resolve to a row in `workers`, excludes it from `rows_rewritten`, and leaves any pre-existing projection row for that order untouched** — proves the missing-worker branch is a `continue`, not a throw or a zero-fill; would fail if the code throws `ResourceNotFoundError` (aborting the whole window), counts the skipped row in `rows_rewritten`, or writes a projection row with empty worker fields.

- **re-derive sets `last_event_type` to null on the projection row when the order has no events** — proves the nullable path is handled; would fail if the code substitutes an empty string, a default sentinel, or throws on the null from `findLastEventForOrder`.

- **re-derive with exactly BATCH_SIZE (500) orders completes in a single batch, and with BATCH_SIZE + 1 (501) orders both rows are written and totals for all affected companies are correct** — proves the slice arithmetic at the boundary is `i < orders.length` with step 500 (not off-by-one); would fail if the loop condition is `<=` (skipping the last row) or if the second batch's per-company set is contaminated by the first batch's companies.

- **re-derive does not modify or delete projection rows whose `created_at` falls outside the requested window** — proves the operation is scoped to the window; would fail if the code groups by `company_id` and rewrites all rows for that company regardless of date, or issues a DELETE to "clean up" before upserting.

- **re-derive correctly attributes totals to distinct companies: a window containing orders from company A and company B produces independent, correct totals for each** — proves the `affectedCompanies` set is keyed per company and the recompute is per-company, not a global aggregate; would fail if the code sums across companies or shares a single accumulator.

- **re-derive returns a `rows_rewritten` count that excludes orders skipped due to missing workers** — proves the counter increments only after the worker check passes; would fail if the counter is incremented at the top of the loop body before the `continue`.

Deliberately not testing here: the `@Cron` scheduling cadence of drift-repair (covered in `test/drift-repair.spec.ts`), the correctness of the dashboard read query against the projection (covered in `test/operations.spec.ts`), and the interactive-transaction isolation level of the write path (covered by the concurrent-totals test in `test/operations.spec.ts`). Re-derivation tests exercise only the re-derivation service's own contract: input validation, batched upsert correctness, absolute-totals semantics, and scope boundaries.
