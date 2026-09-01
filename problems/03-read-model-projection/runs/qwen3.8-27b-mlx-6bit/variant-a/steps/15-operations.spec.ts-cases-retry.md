# 15-operations.spec.ts-cases-retry

## reasoning

```
The user wants me to list test cases for `test/operations.spec.ts` based on the PLAN.md and the implementation files shown. I need to:

1. Cover behaviour the task statement asks to be tested (read-your-own-writes, concurrent updates to one company's totals, drift repair)
2. Cover behaviour the plan says matters (pagination, date filtering, re-derivation, error paths)
3. One line per case in the specified shape
4. Say what would have to break for each to fail
5. Include awkward cases (concurrency, duplicate delivery, exhaustion, boundary values, error paths)
6. Close with what I'm deliberately NOT testing and why

Let me think through the test cases systematically:

**Read-your-own-writes:**
1. Create order → immediately query dashboard → row appears with correct fields (worker name, event title denormalised correctly)
2. Approve order → query filtered by status=approved → row appears with updated status
3. Reject order → query filtered by status=rejected → row appears

**Concurrent updates:**
4. N concurrent approveOrder calls on different orders for same company → totals exact (approved_total_cents = sum, pending_count correct)
5. Concurrent createOrder + approveOrder interleaved for one company → final totals match sum of final statuses

**Drift repair:**
6. Corrupt projection row (change status/amount) → run repairDrift → projection matches source, totals corrected
7. Delete a projection row → run repairDrift → row restored, totals reflect it

**Re-derivation:**
8. Create orders, corrupt projection → run rederive → projection rebuilt from source exactly

**Pagination:**
9. Insert 25 rows, page 1 size 10 → 10 items, total=25
10. Page 3 size 10 → 5 items (boundary/exhaustion)
11. Page beyond available data → empty items, correct total

**Date filtering:**
12. Orders with known timestamps, query with from/to → only in-range rows

**Error paths:**
13. approveOrder with non-existent ID → order_not_found error envelope
14. approveOrder already approved → invalid_transition error envelope
15. pageSize > 100 → invalid_query_params error
16. page < 1 → invalid_query_params error

**Boundary / awkward:**
17. Create order for a new company (no totals row exists) → totals row created with pending_count=1
18. approveOrder for an order that was just created (single transaction atomicity — if the projection write fails, source shouldn't be committed... but in practice we can test that after a successful create, the projection row exists)
19. Drift repair with an empty window (no orders in range) → returns DriftReport with rowsCorrected=0, no errors

**Totals exactness:**
20. After a sequence of creates and status changes, getTotals returns exact values matching the sum of individual orders

Let me also think about what's NOT being tested:
- Performance (p95 < 50ms) — that's a load test, not a unit/integration test
- Cron scheduling actually firing — that's a NestJS scheduler concern, we test the runForWindow method directly
- HTTP layer / serialization — we test at the service level
- Prisma connection pooling, retry behaviour

Let me refine and make sure each case names what would have to break.
```

## reply

- Create order then immediately query the dashboard for that company — the new row appears with correct denormalised fields (workerName, eventTitle, eventLocation) — fails if the projection write is skipped, deferred to async, or uses wrong field mapping
- Approve an order then query filtered by status=approved — the row's status reflects the transition — fails if `applyOrderStatusChanged` is not called, is called with the old status, or writes to the wrong column
- Reject an order then query filtered by status=rejected — the row appears under rejected and is absent from approved — fails if the status update is a no-op or if both statuses are set
- Fire 10 concurrent `approveOrder` calls on distinct orders for the same company then read totals — `approved_total_cents` equals the sum of all 10 amounts and `pending_count` is 0 — fails if `adjustTotals` uses a read-then-write pattern instead of atomic increment, or if the upsert's `increment` is lost under concurrent execution
- Fire concurrent `createOrder` and `approveOrder` interleaved for one company (e.g. 5 creates and 5 approves on a different set) then read totals — final `pending_count` equals the number of orders still pending and `approved_total_cents` equals the sum of approved amounts — fails if create and approve race such that a pending increment is lost or an approved increment is applied to the wrong company
- Corrupt a projection row by changing its status and amount directly in the DB, then run `repairDrift` for a window containing that row — projection matches source and totals are corrected — fails if `repairDrift` only detects missing rows but not stale ones, or if it compares on the wrong fields
- Delete a projection row directly from the DB, then run `repairDrift` for the window — the row is restored with correct fields and totals include its contribution — fails if `repairDrift` only updates existing rows but never inserts missing ones
- Create several orders, manually corrupt the projection (wrong status on one, wrong amount on another), then run `rederive` for the window — projection is a byte-for-byte match of source for that window and totals are recomputed from scratch — fails if `rederive` does not delete before re-inserting (leaving stale rows), or if it skips the totals reset
- Insert 25 rows for a company, query page 1 size 10 — returns exactly 10 items and `total` is 25 — fails if `skip`/`take` arithmetic is off by one or the count query uses a different `where` clause than the data query
- Query page 3 size 10 for a company with 25 rows — returns exactly 5 items (last partial page) — fails if the repository clamps or rejects pages that yield fewer than `pageSize` items
- Query page 99 size 10 for a company with 25 rows — returns 0 items and `total` is still 25 — fails if the repository throws an error for out-of-range pages or returns `total` as 0
- Insert orders with known timestamps (some before `from`, some within `[from, to)`, some at or after `to`), query with that range — only strictly-in-range rows are returned; the row exactly at `from` is included, the row exactly at `to` is excluded — fails if the repository uses `lte` instead of `lt` for the upper bound, or `gt` instead of `gte` for the lower bound
- Call `approveOrder` with a UUID that does not exist in `payment_orders` — returns an error with code `order_not_found` — fails if the service swallows the not-found and returns a success, or if the error code is different
- Call `approveOrder` on an order that is already approved — returns an error with code `invalid_transition` — fails if the service allows idempotent re-approval (silently succeeds) or returns a different code
- Call the dashboard with `pageSize=101` — returns an error with code `invalid_query_params` — fails if the service silently clamps to 100 or allows unbounded page sizes
- Call the dashboard with `page=0` — returns an error with code `invalid_query_params` — fails if the service treats page 0 as valid (returning a shifted result) or allows negative pages
- Create the first order for a brand-new company (no `company_financial_totals` row exists) — after the create, `getTotals` returns a row with `pending_count=1` and zero totals — fails if the `adjustTotals` upsert's `create` branch does not set `pendingCount` from the delta (leaving it at 0), or if `getTotals` throws instead of returning the freshly created row
- Run `repairDrift` for a window that contains no orders — returns a `DriftReport` with `rowsCorrected=0` and `totalsCorrected=false` without error — fails if the routine throws on an empty diff or attempts a `resetTotals` with no affected companies
- Create 3 orders for company A, approve 1, reject 1, then read totals — `pending_count=1`, `approved_total_cents` equals the single approved amount, `rejected_total_cents` equals the single rejected amount — fails if a status change does not decrement the old bucket (pending) before incrementing the new one, or if the amount is signed incorrectly on reject
- Two orders for the same company have identical `created_at` timestamps; query the dashboard — both appear, and their relative order is stable across repeated queries (deterministic tiebreak) — fails if the sort has no secondary key and Postgres returns them in arbitrary order, causing flaky pagination

Deliberately not testing: p95 latency (requires load infrastructure and is a non-functional property, not a behavioural one), cron scheduler firing (NestJS scheduler concern; `runForWindow` is tested directly as the unit of behaviour), HTTP serialization and status codes (NestJS framework concern; service-level error codes are the contract), and Prisma connection pooling or retry semantics (infrastructure, not application logic).
