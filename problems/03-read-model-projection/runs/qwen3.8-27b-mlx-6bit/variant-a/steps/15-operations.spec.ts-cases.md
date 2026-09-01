# 15-operations.spec.ts-cases

## reasoning

```
Let me analyze what's needed here. I need to enumerate the test cases for `test/operations.spec.ts`. The basis is:

1. Variant A of the task statement — the behaviors asked to be tested: read-your-own-writes, concurrent updates against a single company's totals, drift repair. Plus p95 latency (though that's a performance thing, probably not something to unit test), financial totals exactness.

2. PLAN.md — my spec. The plan has a test table with 9 test rows:
   - Read-your-own-writes: create order → immediately query dashboard, assert new row appears
   - Read-your-own-writes: approve order → query filtered by status=approved
   - Concurrent updates: N concurrent approves against different orders, same company → totals exact
   - Concurrent mixed create/modify → invariants hold
   - Drift repair: corrupt projection row (status, amount) → repairDrift fixes it
   - Drift repair: delete projection row → restored
   - Re-derivation: create orders, corrupt, rederive → rebuilt from source
   - Dashboard pagination: 25 rows, page1 size10 → 10 items + total; page3 → 5
   - Date range filter: from/to

Also the plan has error paths:
- `order_not_found` for approve/reject on nonexistent order
- `invalid_transition` for already-approved order
- `invalid_query_params` for pageSize > 100 or page < 1
- `company_not_found` for getTotals on a company with no totals row

The error code contract: snake_case codes. The implementation's services throw Nest exceptions (BadRequestException/NotFoundException) — wait, let me check what the actual implementation does. Looking at the workspace files:

- `operations.service.ts` throws `BadRequestException` with an envelope object `{ error: { code: 'invalid_query_params', ... } }`.
- `writes.service.ts` throws `NotFoundException(\`Order ${orderId} not found\`)` and `BadRequestException(\`Invalid transition: ...\`)`. Hmm — these are plain string exceptions, not envelope-shaped. The plan says error codes `order_not_found` and `invalid_transition`. So there's a mismatch between the plan (envelope codes) and the implementation (plain Nest exceptions without code). Interesting. But I'm being asked to write test cases against the implementation files shown as read-only. The tests will run against this code. So do I test what the implementation actually does, or what the plan promises?

The instructions say: "PLAN.md above is your spec, and the implementation files shown as read-only are what these tests will run against." So the tests need to be designed against both — but the failing conditions must reference actual behavior. I should note the error paths as the plan names them, but the failure conditions are about behavior (e.g., approving a nonexistent order rejects with an error rather than succeeding/throwing something else).

Hmm, but wait — the instructions say not to reproduce or rewrite the reference block. I'm only making a list of test cases. Good.

Also note: `projections.service.ts` is truncated in the reference (applyOrderCreated has `...`). But I have to assume per plan the full implementation exists. The list should reference the behaviors planned.

Let me also think about subtle points where tests can catch bugs:

**Concurrency details:** `adjustTotals` uses upsert with increment — but there's a race: if two concurrent transactions both do `upsert` when the row doesn't exist, one succeeds at create and the other gets unique constraint violation. Under concurrent approve + concurrent create for a new company, this is real: first-ever write per company. Plan says "concurrent updates to a single company's totals" must be exact. The test "fire N concurrent approves against different orders of the same company" — but the totals row only exists if a create happened first (which creates the pending row via adjustTotals pendingDelta +1). So the totals row exists after create. Concurrent approves against existing orders: upsert with increment — under READ COMMITTED, concurrent updates to the same row: each increment statement reads then writes; Postgres row locking serializes them, so `SET col = col + delta` is atomic at the row level. So lost update can't happen with column-based increments… unless implemented as read-then-write (read value, compute, write). The implementation uses `increment`, which is atomic. But a buggy version using `update` with computed value would lose updates. Also the create race: two concurrent first writes → one gets P2002/P2010 unique violation. The test "concurrent create + approve interleaved against a single company" catches both the race and lost updates.

But in the test, do I need to handle the race? The task says "tests of … concurrent updates against a single company's totals." To make it deterministic-ish, use e.g. 5–20 concurrent approves and assert the final sum matches exactly. If code loses updates, totals short by k — test fails.

**Read-your-own-writes details:** The key invariant is that projection writes are inside the same transaction as the source write, and that the dashboard reads only from the projection. Failing conditions:
- If projection write is done after commit (or in a separate later transaction), the immediately-following read may not see it → test fails.
- If dashboard reads from source tables (unindexed join), it's slow but not testable in unit test… actually the plan says "read path does no access to source tables." Hard to assert in integration test without mocking. Could assert on the repository, but the behavior test is just "new row appears."
- If `applyOrderCreated` forgets to bump pending_count, totals wrong.
- If status change doesn't adjust totals (pending -1, approved +amount), totals drift.
- Rejection path: pending -1, rejected +amount.

**Totals exactness:**
- After create: pendingCount = 1, approvedTotal = 0.
- After approve: pendingCount back to 0, approvedTotal = amount.
- After reject: rejectedTotal = amount.
- Rejection then approval? Invalid transition — plan says "order is already in target status" for invalid_transition. What about rejected → approved? Plan: "already in target status" is the invalid case. Does the plan forbid rejected→approved? Plan 4: "If already `approved` → throw `invalid_transition`." Only same-status is invalid. So rejected→approved might be allowed? Hmm, that would move a rejected order to approved — the totals adjustment would need to subtract from rejected and add to approved. But the plan's `applyOrderStatusChanged` takes only (orderId, newStatus) and adjustTotals has deltas… The status change flow per plan: `adjustTotals(companyId, { pendingDelta: -1, approvedCents: +amount })`. That's for pending→approved. rejected→approved under that formula would be wrong (would decrement pending which isn't pending, add approved without subtracting rejected). Hmm, but the plan only spec'd that approve/reject flow from pending. Ambiguous. Shouldn't over-commit; either avoid testing rejected→approved, or name it explicitly as a case to not test / treat out of scope. Actually the plan's error table says `invalid_transition` is thrown "when order is already in target status" — meaning the only invalid transition is a no-op. So rejected→approved is "valid" per spec but the totals adjustment in the plan doesn't handle it. This is a genuine design gap in my own plan. In the test list I should call this out: either add a case "rejected→approved transitions adjust totals correctly (subtract from rejected, add to approved)" — that would fail with the current plan logic — or explicitly state not testing cross-terminal transitions because the plan leaves it unspecified.

Hmm. The task says "a case for each independently-possibly-wrong branch." Branches: approve from pending, reject from pending, no-op on same status (error), nonexistent order (error). For rejected→approved: the implementation's `applyOrderStatusChanged` signature doesn't know old status; the plan flow assumes pending as source. Given the ambiguity, cleanest: state in the closing line that we're not testing transitions between terminal states (rejected→approved) because the plan only defines pending as transition source. Or include it as a case that must be handled… but I'm the author of the plan, and the plan says only same-status is invalid. The tests will run against my implementation, which (per what we can tell) throws on same-status only. If I add a test asserting rejected→approved works and totals are right, it would fail with the plan as written. Better to explicitly state not testing that path and why (plan doesn't define it; no-op on same status is the only error case defined).

Wait, actually let me reread: "If not found → throw `order_not_found`. If already `approved` → throw `invalid_transition`." For rejectOrder it'd be "if already rejected." So pending→approved, pending→rejected are the flows. approved→rejected: not explicitly covered but by symmetry would be allowed (not same status) and totals need approved -amount, rejected +amount. Again plan flow `pendingDelta: -1` would be wrong for approved→rejected. Same gap.

So: terminal-state transitions aren't well-defined in the plan. Closing line: not testing cross-terminal transitions (approved↔rejected) and re-approval of a rejected order, because the plan defines pending as the only transition source; those behaviors are unspecified and testing them would enshrine guesswork. Hmm but wait — is that right for the plan's `applyOrderStatusChanged(orderId, newStatus)`? It just updates status and adjusts totals with delta assuming from-pending. For approved→rejected it would do pendingDelta -1 (underflow) and rejected +amount (approved total not decremented). That's a bug, but plan didn't spec it. In production the write service would presumably only be called from a UI that only offers transitions from pending. Explicitly declare as out of scope.

**Drift repair cases:**
- Corrupt a projection row's status (e.g., source approved, projection pending) → repairDrift fixes status and totals.
- Corrupt amount (or worker_name/event denormalized field) → fixed.
- Delete a projection row → restored; totals recompute to include it.
- Extra projection row with no source counterpart (id not in source, created_at inside window) → deleted. Plan step 4: "rows in projection not in source → delete." This is an independent branch! Not in the plan's test table. Include it.
- Drift repair on clean window → no changes (idempotent), report has rowsCorrected 0 / totalsCorrected false. This tests the diff-detection not blindly overwriting. Independent branch: if the repair always resets totals, `totalsCorrected` would be true even when nothing changed — assertion on the report catches that.
- Repair only touches its window: corrupt a row outside [from, to) → after running on window, that row is still corrupt (or at least not touched), window's rows are correct. This tests the boundary — important: repair on wrong/zero-width window must not fix outside rows, and in-window ones must be fixed. Boundary: rows exactly at `to` (exclusive) are out of scope; rows exactly at `from` (inclusive) are in scope. Include a boundary case: an order with created_at exactly `from` is repaired; one exactly `to` is not.

**Re-derivation cases:**
- Corrupt projection (status/amount/missing row), rederive on window → projection matches source exactly, totals recomputed exact. Independent from drift repair (delete+rebuild vs diff).
- Re-derivation on clean window → same content, idempotent (rows correct, totals unchanged). Hmm, is that an independent branch? rederive always deletes and re-inserts. Idempotency is a property worth one line: re-derivation of an already-correct window leaves totals identical and rows correct. Also tests that delete doesn't wipe out-of-window rows: rederive on a window that contains only 2 of 5 orders leaves the other 3 intact. That's an important independent branch — window-scoping of re-derive. Include.
- Re-derivation on empty window → no rows affected, no totals touched (or untouched companies' totals unchanged). Edge: zero rows in window.

**Pagination cases:**
- 25 rows, page1/size10 → 10 items, total 25.
- Page3/size10 → 5 items.
- page > lastPage (e.g., page 4 size 10) → 0 items, total still 25. Boundary!
- pageSize exactly 100 (max) accepted; page 1 valid. Boundary acceptance.
- pageSize 101 → invalid_query_params error, no page returned.
- page 0 / negative → invalid_query_params.
- page non-numeric? Controller parses; probably out of scope for spec-level integration test… The plan's invalid_query_params only lists pageSize>100 and page<1. Keep numeric boundary, don't claim non-numeric handling.
- Ordering: ORDER BY created_at DESC — assert most recent first. "Sorted by recency" is a requirement; an independent branch: wrong sort order fails. Include in the pagination case or separately. I'll add an assertion in one of the list items: item[0] is most recent and sequence is strictly descending.
- Same-timestamp ties? Without a secondary sort key, order among equal created_at is non-deterministic — can't assert. Explicitly not testing tie-break ordering (no secondary sort key defined; Postgres doesn't guarantee). Good "awkward" callout.

**Date range cases:**
- from inclusive, to exclusive: order exactly at `from` is included; exactly at `to` excluded. Boundary.
- from only, to only, neither (companyId + status only).
- Company isolation: filter by companyId returns only that company's rows even if other companies have overlapping dates/status. Independent branch — could get crossed by a missing where clause. The plan's where always includes companyId, but test for cross-company contamination (e.g., 10 orders company A, 5 company B, query A size 100 → total 10 not 15).
- Status filter: status=approved returns only approved, excludes pending/rejected.

**Totals endpoint / getTotals:**
- getTotals for company with no rows → plan says `company_not_found`. Hmm — when does that happen? If writes are synced correctly, every company that created an order has a totals row. A company with zero orders → no row → error. Case: getTotals on a never-seen company → `company_not_found` envelope. That's "the error path that looks like the success path" (success returns zeros? no — spec says error). Include.
- Totals after mixed statuses: 3 approved (sum), 2 rejected (sum), 1 pending → each column exact. "Financial totals per company must be exact" — this is a headline case, independent from concurrency: sequential correctness of the accumulator columns. Could fold into read-your-own-writes approve/reject, but a dedicated "final state of totals" case names the exact sums including BigInt correctness. BigInt serialization: approvedTotalCents is bigint — JSON.stringify fails on bigint! Does getTotals return a bigint? If an endpoint returns it, Nest can't serialize bigint to JSON. The plan's controller list has only GET /operations — no totals endpoint in the controller! CompanyTotals is exposed via ProjectionsService.getTotals, not a route. So tests call the service directly; bigint is fine in-process. OK — no serialization test needed. But note: the plan has no HTTP route for totals; tests exercise it service-level. That's fine.

**Duplicate delivery / idempotency:**
Plan mentions "duplicate delivery" in the rules prompt as an awkward class. What's the analog here? `applyOrderCreated` upserts — re-derivation uses upsert, repair uses upsert. True "duplicate delivery": create hook fires twice for the same order (e.g., double-invocation). upsertOrder with same id → no duplicate rows; but adjustTotals's pendingDelta +1 would double-count! Hmm. Plan: applyOrderCreated calls upsertOrder AND adjustTotals(pendingDelta +1). If the hook is invoked twice (simulating a duplicate), pending_count would be 2 for one order. Would the test catch that? A test "applying create hook twice leaves exactly one projection row and pendingCount 1" — that would fail with plan implementation (upsert dedupes rows but totals double-incremented). Is duplicate delivery in scope? The prompt says "include awkward cases: concurrency, duplicate delivery, exhaustion, boundary values." Hmm. But the discipline says "do exactly what the task asks," and the test table in the plan doesn't include duplicate delivery. However the list I produce is my own spec for tests; the instructions here override and ask to include awkward cases. But if I add a duplicate-delivery test that my own design fails, that's… the honest thing: name it as a case whose failure conditions are real. Actually wait — is duplicate delivery possible under the design? The hook is called inside a transaction with the source write; it can't be invoked twice on the same id unless someone calls applyOrderCreated twice manually. rederive does upserts without touching totals via delta — it resets totals. So the double-increment exposure only exists if the hook is called twice for one order id, which can't happen in normal flow. Hmm.

But there's a true duplicate-ish exposure: re-derivation and repair use upsert (idempotent) — a nice property to test: "running rederive twice yields same state" (already have idempotency case).

I think for "duplicate delivery," the honest mapping is: running rederive/repair twice (double delivery of the maintenance operation) must not double-count or corrupt. That IS an independent branch: if repair applies delta instead of absolute reset, a second run would double-apply… actually no, repair resets from source diff so the second run is a no-op. Test: run repairDrift on a window twice; after second run the report is zero-corrections and totals unchanged. That IS a meaningful duplicate-delivery case. Good.

**Exhaustion:** "exhaustion" — what could be exhausted? A large bulkUpsert (transaction size / statement limit)? Hard in integration test. Offset beyond data (page past end → 0 items) is a form of read exhaustion — I have that. Empty window (no rows to re-derive/repair) — I have that. A company with zero orders (totals row missing → error path) — I have that. So exhaustion is covered by: past-the-end pagination, empty window, unknown company. Enough; I'll state mapping implicitly in the list.

**p95 < 50ms:** performance target — not testable in functional tests. Closing line: not testing p95 latency (requires load harness) and not testing exact index choice; correctness is asserted, the index exists per DDL. Hmm — can we assert the query plan? Overkill. Declaring out of scope.

**Read path doesn't touch source:** can we test this? One behavior test: corrupt the source table (e.g., update a payment_orders row) and assert the dashboard still shows projection values… but then repairDrift would "fix" it the other way. Actually a nice test: update source row directly (bypassing writes service), dashboard still shows old projection value (proving read path is isolated from source — that's exactly the "projection" behavior; also defines drift semantics). Hmm but is that desired? Task: operators see their own writes — via the hook. Direct source changes are exactly "drift" that repair catches later. Test: after directly modifying the source, dashboard reflects projection (old value), then repairDrift syncs it. That's a good case proving the read path doesn't join source, and simultaneously defining drift semantics. But wait — is it safe to assert? The implementation's operations repository only queries operation_read_models (as shown). Yes, this behavior is safe. Include it as a case: "dashboard reads only the projection: directly mutating source doesn't change the dashboard until repair" — failing conditions: read path joins source, or there's a cache layer that hides it… actually if the read path joins source directly, the dashboard shows the mutated value → test fails. Good, nameable.

But note: do I want this? Task says "without changing what operators see" — the dashboard shows a join of payment orders, events, workers. After drift (someone edited source directly), the "true" view would show the new value. But that's drift; repair window catches it. In a normal flow, source changes only happen via the write service which updates both. So asserting isolation is testing architectural property that makes p95 possible and drift semantics coherent. Keep it — it's the single most important test that read path isn't a 3-table join (which is what caused the 20-30s in the first place).

**Concurrent create+approve against same order (conflict)?** Two concurrent approves on the same order: both read pending, both try to update → one succeeds and the other… In READ COMMITTED, the second findUnique might see pending (if first hasn't committed) → both update → projection: applyOrderStatusChanged twice → pendingDelta -2, approved +2×amount! Totals corrupted: pendingCount -1 (or underflow), approved doubled. Hmm wait, does that happen? Transaction A: read pending, update source to approved, projection update + totals delta. Transaction B (concurrent): reads order — if A not yet committed, sees pending → proceeds: updates source (blocked until A commits, then succeeds — in READ COMMITTED the update re-evaluates? no — UPDATE is not optimistic; it just overwrites), updates projection again, adjusts totals again → pending -1 twice (net -2 from a +1 start… starts at 1 → -1 → -1? pendingCount goes 1→0 then →-1), approved +amount twice. Final: source=approved (correct), projection status approved (correct), but totals: pending -1, approved 2×amount. Drift! And repairDrift resets from source → fixes later.

Should we test "concurrent approve on same order"? The task asks for "concurrent updates against a single company's totals" — different orders. Same-order race requires optimistic locking (version, or conditional UPDATE `WHERE status = 'pending'`) which the plan doesn't include (implementation does findUnique then update — no conditional). So a test "concurrent double-approve leaves totals exact" would fail with the plan design. The plan relies on eventual repair for this. Options: (a) include the test — fails against my design; (b) explicitly state not testing same-order double-approve because the plan has no optimistic guard and relies on drift repair; (c) include a variant: "after concurrent double-approve, drift repair restores totals to exact" — that IS supported by design (repair recomputes from source). That's a great awkward case and nameable: two concurrent approves on same order may corrupt totals, but repairDrift on that window restores approvedTotalCents to exactly one amount and pendingCount to 0. Failing conditions: repair's reset logic is wrong, or window misses the row. And (b) in the closing line I'll state that I'm not testing same-order concurrent approve without a subsequent repair, because the plan intentionally relies on repair (no row lock / conditional update in write path).

Hmm wait, let me actually re-verify: does the same-order race really corrupt under the implementation? `adjustTotals` uses upsert with increment — increments are atomic per-row, but applied twice = 2×. Yes, corrupts. `updateOrderStatus` is idempotent (SET status). So totals drift only; repair fixes. OK my case is valid.

Also concurrent create same… different orders, no problem (separate rows). Race on first-ever totals row per company: two concurrent creates for a new company → both upsert with pendingDelta +1 → one create, other unique conflict → Prisma P2002 → the whole write transaction rolls back (order + hook) → 500 error to operator! Hmm. That's a genuine bug in the design (upsert create contention). The plan's "concurrent mixed create/modify" test against an existing company wouldn't hit this unless the company is new. Should I include "first-ever concurrent creates for a new company both succeed"? That would fail against the plan (one fails with P2002). Hmm. Is that an independent branch? Yes — the create branch of the upsert under contention. Design alternatives: `createMany`… or catch retry, or ensure totals row existence with a separate "touch company" before upsert — but same race. Realistic fix: make adjustTotals idempotent-safe, e.g. always use `update` + upsert… still races. Common fix: pre-create company totals row via a companies table, or use `INSERT ... ON CONFLICT DO UPDATE SET pending = pending + 1` — atomic at the SQL level, no app-level read! Wait — Prisma's upsert is not a single SQL statement: it does SELECT then INSERT/UPDATE. That's the race. Raw SQL `INSERT ... ON CONFLICT DO UPDATE` is atomic. But plan/implementation uses Prisma upsert → racy.

Do I want to add this test? The task explicitly asks for tests of "concurrent updates against a single company's totals." New-company concurrency is squarely in scope. If my design fails it, the test exposes a real bug — that's the point of writing failing conditions honestly. But then the "tests" section of my plan will fail against my own implementation… The prompt says tests "will run against" the implementation files. It's not asking me to predict pass/fail; it asks for a list of test cases with honest failure conditions. I think the right move: include the case "first-write contention: concurrent creates for a brand-new company both commit (no unique-violation surfaced), and pending_count equals the number created." Failing conditions: upsert create contention (P2002) rolls back one write, or lost increment. And in the closing line I can note this is expected to drive a fix (adjustTotals must be an atomic upsert SQL). Hmm but discipline: "do exactly what the task asks." Task asks for tests of concurrent updates on totals. This IS that test, just a sharper edge. Include. Actually — wait. Let me reconsider: with pnpm Prisma on Postgres, `upsert` under two concurrent txs both trying to create the same PK: one's INSERT hits a unique violation → P2002 thrown → `createOrder` transaction rolls back → operator's order creation fails with 500. That's a user-visible failure under concurrency — exactly the class of bug the task worries about ("concurrent updates against a single company's totals"). Yes, include.

**Worker/event denormalization:** create hook reads worker name/event title/location and stores them. Case: projection row carries correct worker_name/event fields (covered in read-your-own-writes create assertion). Independent branch: if hook forgot denormalization (stored id instead of name), the field-assertion catches. Also: worker/event changes don't propagate (no update hook planned) — explicitly NOT testing that; the plan doesn't define update hooks for worker/event. Good closing line item.

**Error envelope shape:** the plan has a single envelope contract with snake_case code and details object never null. The shown implementation throws BadRequestException({error:{...}}) for invalid_query_params, but plain-string NotFoundException/BadRequestException for order_not_found/invalid_transition. Testing "response body matches envelope with code X" would fail for writes errors under the implementation. Hmm. What do I do? The list is against "the plan" and "the implementation." Plan's error table defines codes. The implementation shown for writes.service doesn't carry codes. If I write a test asserting envelope codes on approve errors, it fails against the shown implementation. But wait — my list is a spec for what I'll write next ("those come after this list"). The failures I name should be the behavioral contract. Since the plan is my spec and errors section of the plan promises codes, I can list: "approving a nonexistent order rejects with error code order_not_found (envelope shape, details object), not a success and not a 500." Failing condition: code is missing/mis-shaped, or error is swallowed. Whether the current implementation satisfies it is a separate question — but honestly, the shown writes.service throws `NotFoundException(\`Order ${orderId} not found\`)` which in Nest produces `{ message, error, statusCode }` — no `code` field. So that test would fail against the shown implementation. Hmm.

The prompt says "the implementation files shown as read-only are what these tests will run against" — I think it's telling me the truth of what exists so my failure conditions are grounded, not that all tests must pass. The list should specify correct behavior; a test failing against the current code is fine, that's what tests do. But I should be careful to name failures as "code X is missing or envelope not in shape" rather than pretending.

Actually, let me reconsider: I should perhaps align test cases with what's implementable per the plan: the plan (my spec) defines envelope codes for all four errors. The list should test the contract from the plan. Note in one line that two of the error paths currently surface as plain Nest exceptions without the `code` field — the test's failing condition catches exactly that. Hmm, "don't reproduce" applies to the reference block; I can reference behavior.

Let me keep it simple: write failure conditions in terms of the contract ("rejects with code `order_not_found`"), which is a nameable failing condition.

**Read your own writes — "the next request":** Task: "an operator approves an order → it reflects on the next request." Test: create → read shows pending; approve → read shows approved (status filter); the second read is what "next request" means. Also: read between create and approve must show pending, not missing.

**Sort by recency across pages:** page1[0].createdAt > page1[last].createdAt, and last item of page N is newer than first item of page N+1 (no gap/dup across pages). Dup/miss across page boundaries is a real pagination bug class (non-deterministic ordering with equal timestamps → same row on two pages). I'll include: "two consecutive pages don't overlap and don't skip: union of page 1–3 items = top 25 distinct ids, all timestamps in page1 newer than in page2" — failing conditions: offset/skip arithmetic off, or order non-stable. But equal timestamps → tie-break undefined → overlap possible in theory… To keep it deterministic, I'll create 25 orders with distinct timestamps (staggered by ms). Then assert overlap/skip and descending order. Good; and in the closing line I'll note I don't assert tie-break ordering for equal created_at since no secondary key is defined.

**Drift report shape:** DriftReport has rowsCorrected and totalsCorrected. Cases:
- Corrupted row + corrupted totals → rowsCorrected ≥ 1, totalsCorrected true, projection matches source.
- Clean window → rowsCorrected 0, totalsCorrected false (idempotent no-op reported accurately). Independent branch: a naive impl would report totalsCorrected true unconditionally.
- Missing row only (totals also drifted) → rowsCorrected 1.

Hmm wait: does repair fix totals? Plan step 5: "recompute totals for all affected companies from the corrected projection rows; resetTotals if changed." So yes. Failing conditions: repair fixes rows but leaves totals wrong (e.g., only recompute for companies in window, or use deltas instead of reset). Also: a company whose drift row is outside window must NOT have its totals recomputed… but "recompute from projection rows" — for affected companies. Well, keep simple: affected = companies with rows in window.

**Window boundary for repair:** row with created_at == to (exactly) is excluded; == from included. Include in one boundary case (shared with date range query? different code path — the query's where and the raw SQL of repair/rederive use their own boundary logic; independent branches). The raw SQL of fetchSourceWindow: `created_at >= from AND created_at < to` (as shown). The Prisma where of fetchProjectionWindow: gte/lt. Both exclusive — but each is an independent expression, so a boundary test through the public API (query with from/to covers the read path; re-derivation/repair on boundary rows covers maintenance path). I'll write one for read path, one for maintenance (re-derive on [from, to) with one row exactly at to and one just inside: after re-derive, the at-to row must remain in the table untouched and the inside row must be rebuilt/correct).

Wait, note: rederive on [from, to) deletes rows in [from, to) and reinserts from source. A row exactly at `to`: not deleted (delete uses < to), not reinserted (source fetch is < to) → untouched. A corrupted row exactly at `to` remains corrupted after rederive — that's the correct behavior per window semantics; assert it stays (documenting exclusivity). A row exactly at `from` is deleted and reinserted from source → if it was corrupted, it's fixed. That case names boundary behavior precisely on both edges.

**rederive and totals recompute:** after corrupting a row's amount and re-deriving, the company's approvedTotal must equal sum of source amounts (exact). Independent from row-content assertion — could the rows be right but totals reset from a wrong set (e.g., compute totals from just-inserted window rows without… wait, totals are per-company across all time, not window! Bug class: recompute totals for affected company using only window rows → drops contributions from orders outside window. That's a big one. Plan step 5: "recompute totals for affected companies from the newly inserted rows" — hmm, "from the newly inserted rows" — if totals are only over window rows, and company has orders outside the window, we'd undercount. Unless "recompute" means a full recompute from source for that company (ignoring window). The plan is ambiguous here and honestly a likely bug: the totals table covers all-time per company; to reset it correctly you must aggregate over the whole company (or window + prior… no, whole company). So the test: "re-derive on a window that contains only half of a company's orders leaves totals equal to the sum over all of the company's orders (including those outside the window)." Failing conditions: recompute scoped to window → undercount; or resetTotals zeroing the row. This is one of the most important cases I can add — an independent branch with a nameable failure. The same logic applies to repairDrift ("recompute totals for all affected companies from the corrected projection rows" — same window-scoping trap). I'll include in both or one with a note that it applies to both routines. Keep cases atomic: two lines, one per routine? Prompt says one line per case; I can have two lines with the same scenario phrased for each routine. Or one line "both rederive and repairDrift…". I'll do separate lines for atomicity.

**getTotals for company with orders only rejected** → approvedTotal 0n, pendingCount 0 — zero-value path (BigInt default). Meh, fold into mixed-status case.

**pageSize default?** Plan says default 20 — is that tested? Controller default: if pageSize omitted → 20. Is that in scope? Plan's OperationQueryParams requires pageSize: number (non-optional) — default applied at controller. Shown controller signature has pageSize?: string. Controller file not shown… the plan's test table doesn't include default. I'll add a small case: "omitting pageSize/page defaults to page 1, size 20" — failing condition: default missing → undefined/NaN skip/take. It's an independent branch (controller parse path). Include — cheap and realistic. Hmm, but the shown workspace doesn't have the controller… only plan lists it as planned. It's fine; the list is against the plan + implementation. Include.

Now let me count and organize. The response should be a list of one-liners plus one closing line for non-tests. Let me draft:

1. Read-your-own-writes (create) — create an order and immediately GET the company's dashboard: the new row is present, with correct status=pending, amount, worker name and event title/location; failing condition: projection write happens after commit / in a separate transaction, or the hook forgets denormalized fields, so the first read misses it or shows wrong values.

2. Read-your-own-writes (approve) — after approving, the next read filtered by status=approved shows the row and no longer under pending; totals: pendingCount back to 0, approvedTotalCents exactly the amount; failing condition: status-change hook doesn't fire / fires after commit, or delta has wrong sign/magnitude (e.g., pending not decremented, amount added to wrong column).

3. Read-your-own-writes (reject) — mirror case: rejected total exactly the amount, pendingCount 0; failing condition: reject branch of totals delta missing (only approve implemented).

4. Dashboard reads only the projection — mutating the source row directly (bypassing writes service) doesn't change the dashboard response, until repairDrift on that window syncs it; failing condition: read path joins payment_orders/events/workers (the original slow query) so drift is invisible / or repair doesn't converge. This also proves the isolation that makes p95 possible.

Wait — "then repairDrift syncs it" — but if a source has been mutated directly, what does "correct" mean? repair treats source as truth → projection updated to source's mutated value. OK, so "until drift repair syncs it" — after repair, dashboard shows the mutated source value. Good, that also tests that repair's diff detection catches status/amount changes. Maybe split: (a) isolation assert (dashboard unchanged after source mutation), (b) is that the drift-corruption case? My corruption cases corrupt the projection, not the source. Both directions: projection≠source in either direction → repair converges to source. Plan step 4 covers both (missing/stale in projection→upsert; extra in projection→delete). Stale = value mismatch either way (diff comparison). I'll keep the isolation case including the convergence after repair, plus a separate "repair with source as truth: mutate source amount directly, repair converges projection to it" — hmm, that overlaps with #4. Let me fold: case 4 = isolation + convergence in one line. Then corruption cases (projection side) stay separate because they test the projection-side corruption branch and totals reset.

5. Concurrent approves against same company — fire N (say 8) concurrent approveOrder on pending orders of one company; final approvedTotalCents = exact sum, pendingCount 0; failing condition: lost update (read-modify-write on totals) or partial increments — any shortfall in total fails.

6. Concurrent mixed create+approve for one company — P creates and Q approves interleaved concurrently; final totals consistent with the set of orders' final statuses (approvedTotal = sum over approved, pendingCount = number pending); failing condition: ordering hazard between hook and source write, lost increments.

7. First-write contention on a new company — concurrent first orders for a brand-new company: all succeed (no unique-violation surfaces) and pendingCount equals the number created; failing condition: Prisma upsert create-path contention (P2002) aborts one of the writes, or a lost increment on create. — Honestly, this fails with the shown design; that's OK, name it.

Hmm wait, do I actually want to commit to "all succeed" as spec? An alternative correct behavior is one failing with a retryable error… no, order creation shouldn't fail on contention; retrying would double-create (no idempotency key in the input). The design has to make this safe (atomic ON CONFLICT SQL or pre-created row). Spec: both succeed, counts exact. Good.

8. Same-order concurrent double-approve, then repair — two concurrent approves on the same order; source ends approved; if totals are corrupted by the race (doubled increment / underflow of pending), a subsequent repairDrift on that window restores approvedTotalCents to exactly one amount and pendingCount 0; failing condition: repair's reset uses deltas, or window misses the row. (In closing line I state that I'm not asserting no-corruption on same-order double-approve without repair, because the plan has no optimistic guard in the write path and leans on repair.)

9. Drift repair — corrupted status: source approved, projection (silently) changed to pending; repairDrift on window fixes the row and company's totals reflect source; report: rowsCorrected ≥ 1, totalsCorrected true. Failing condition: diff comparison misses value mismatches (only checks presence), or totals not recomputed.

10. Drift repair — corrupted amount/worker_name: same convergence; totals (amount-driven) corrected exactly. Failing condition: repair upserts only some fields, or totals recompute from stale projection… well "recompute from corrected rows" — if we recompute after upsert, fine. Failure: resetTotals computed from window projection read before fix… keep it general: totals end wrong.

11. Drift repair — missing row: delete a projection row (and its totals contribution is now off); repair restores the row and includes it in totals exactly. Failing condition: repair only fixes existing rows, doesn't detect source-side presence.

12. Drift repair — orphan projection row: insert a projection row with an id that has no source order (created_at in window); repair deletes it; its amount excluded from totals. Failing condition: repair only upserts, never deletes.

13. Drift repair — clean window no-op: run on a consistent window → report rowsCorrected 0, totalsCorrected false; state unchanged. Failing condition: unconditional reset (totalsCorrected always true) or blind rewrite.

14. Drift repair — duplicate delivery: run repairDrift twice on the same window (corrupt → repair → repair again); second run reports zero corrections and leaves totals unchanged. Failing condition: repair applies deltas instead of converging (second run double-applies).

15. Drift repair — window boundaries: corrupt a row with created_at exactly `to` and another exactly `from`; repair on [from, to) fixes the at-from row and leaves the at-to row untouched (still stale); failing condition: exclusive boundary implemented as inclusive (< to becoming <= to) or off-by-one.

16. Re-derive — full rebuild under corruption: create orders, corrupt projection (change a status + delete another row), rederive on window → projection matches source exactly, per-company totals equal to exact sum over source; failing condition: re-derive skips rows, or leaves stale rows (delete then insert races / only upserts without delete).

17. Re-derive — window scoping: rederive on a window containing only 2 of a company's 5 orders leaves the other 3 rows intact; failing condition: delete/insert not scoped by created_at (wipes all of a company's or global rows).

18. Re-derive — totals computed over the whole company: window contains only a portion of a company's orders; after rederive, approvedTotalCents equals the sum over all of that company's source orders (not just in-window); failing condition: reset scoped to window rows undercounts.

19. Re-derive — empty window: rederive on a range with no orders → no rows touched (existing rows elsewhere intact), totals unchanged. Failing condition: resetTotals called for zero companies / delete-then-insert of nothing zeroes something.

Hmm, 19 is a bit weak ("totals unchanged" — re-derive of empty window: no affected companies → nothing reset). Failing condition: code iterates `SELECT DISTINCT company_id` over empty set — fine; bug if it resets a hardcoded company list… well. Keep, it's cheap. Actually the real risk: delete+bulkUpsert with empty array — implementation guards `rows.length === 0` (as shown, early return) — but that skips the delete? Look: bulkUpsert early-returns if empty, but rederive calls deleteProjectionWindow first and then bulkUpsert — delete happens even if no source rows (which is correct: delete + no insert = projection for window should be empty). Actually if source has no rows in window but projection does (orphan), delete should still happen. The implementation: rederive → deleteProjectionWindow → fetchSourceWindow → bulkUpsert (early return) → recompute totals for affected companies… which companies? From deleted rows or from source? Plan: "for each affected company" — from newly inserted rows (none) → no reset. But orphans were deleted and their totals contribution not reset! Edge: orphan removal only handled by repair, not re-derive. I'm going too deep — keep test 19 simple: empty window, no rows anywhere affected, no errors. Failing condition: early-return leaves a half-applied state or errors out on empty set.

20. Pagination arithmetic — 25 orders for one company with distinct timestamps: page1/size10 → 10 items, total=25; page3 → last 5 oldest; union of pages 1–3 = 25 distinct ids (no duplicates/gaps across pages); failing condition: skip/take arithmetic wrong or count query uses different where.

21. Pagination exhaustion — page past end (page 4, size 10) → items: [] and total still 25 (not an error); failing condition: negative offset (skip 30 on 25 rows → Postgres error) or treating past-end as invalid_query_params.

Note: skip=(page-1)*pageSize = 30 > 25 → Postgres LIMIT/OFFSET is fine (returns empty). If someone does `page*pageSize - pageSize`… well. Failure: 500 error or total 0.

22. Pagination boundaries acceptance — pageSize=100 and page=1 accepted (boundary max); failing condition: off-by-one (< instead of <=).

23. Pagination boundaries rejection — pageSize=101 → error invalid_query_params with details; page=0 and page=-3 → same code; failing condition: validation missing (pageSize 101 silently caps or errors at wrong boundary) — and error shape: envelope code present, details is object.

24. Date range read boundaries — orders exactly at `from` (included) and exactly at `to` (excluded); also from-only/to-only/none; failing condition: gte becoming gt, or lt becoming le, or to inclusive.

25. Company isolation — two companies interleaved on same day/status; query A with a size that fits all → total = A's count only, no B rows in items; failing condition: missing company_id in where or wrong join key in maintenance… read path is single-table; risk is a missing where clause.

26. Status filter — status=approved excludes pending/rejected; no status returns all three counts; failing condition: status applied with AND against count but not findMany, or vice versa (items/total mismatch).

27. Ordering — items sorted by created_at descending strictly; page1[0] is the most recent of all 25; failing condition: asc sort / no order / per-page order with global disorder. (Fold into 20? Independent enough; keep separate to name "sorted by recency" from the task.)

28. Default values — GET /operations with only companyId → page 1, pageSize default (20); non-numeric/… hmm skip non-numeric; just defaults + failing condition: undefined take → all rows returned (default missing), or 500.

29. getTotals success — company with mixed statuses: approvedTotalCents/rejectedTotalCents exact sums (BigInt), pendingCount exact; failing condition: wrong column/amount per status mapping, integer-cent drift (cents as float — can't actually assert here), or count includes non-pending.

30. getTotals unknown company — never-seen companyId → error code company_not_found (envelope, details object), not zeros and not 500; failing condition: returns empty totals (conflating "no data" with error per plan) or throws raw.

Hmm wait — is company_not_found correct behavior? Plan says so: "no totals row for the company (shouldn't happen if hooks are right)." OK per plan. Failing condition: implementation returns null/zero, or throws NotFoundException with a different code.

31. order_not_found — approve/reject on a random UUID → error code order_not_found; response is an envelope with details object; the source is unchanged (order count for company unchanged); failing condition: code/message shape off, or a 500 from missing null-check.

32. invalid_transition — approve an already-approved order → code invalid_transition; also reject on a rejected one; failing condition: silently re-applies (double increment on totals!) — oh nice, this also guards the double-apply: if no-op re-applies the hook, totals drift; asserting unchanged totals after rejection makes that concrete. So: "and totals unchanged after the rejected call." Failing condition: guard missing → second approve double-counts amount / decrements pending again.

That's a strong case — the error path that looks like success path, with a concrete invariant.

33. Error envelope shape across the board — hmm, do I need a dedicated line? The prompt: "the error path that looks like the success path." My error cases each assert their code; maybe one line: all 4 error codes carry the single-envelope shape (code snake_case, message string, details object not null) — failing condition: any error path emitting Nest's default {message,error,statusCode} shape or a null details. Since the shown implementation already violates this for writes errors (plain strings), this case is grounded and honest. Include.

Now the "not testing" closing line:
- p95 latency / index performance (needs load test against 3M rows; not verifiable in integration environment).
- Tie-break ordering for equal created_at (no secondary sort key defined).
- Transitions between terminal states (approved→rejected, re-approve of rejected) — plan only defines pending as transition source; testing would enshrine unspecified behavior.
- Worker/event field changes after creation (no update hook for workers/events in the plan).
- HTTP-level concerns beyond the endpoint (auth, rate limiting) — not in task.
- Exact migration/DDL verification beyond what the schema declares (indexes present) — hmm, or: "index definitions themselves (EXPLAIN plan)" — fold into p95 line.

I can also mention: not testing Prisma client internals / mocking (integration against real Postgres). That's a test strategy, fine in one line.

Wait — one more thing: "read-your-own-writes … the next request" — my cases 1–3 cover via service-level query. Should any go through the controller/HTTP (supertest) to prove "request"? The plan's tests are integration; either is fine. I'll phrase reads as "the next dashboard query" — implementation-agnostic. Good, since the list is behavior-based not implementation-based.

Also exhaustion of `bulkUpsert` with a large window? A 3M-row re-derive — not testable at that scale. Closing line: "not testing full-scale (3M row) re-derive throughput."

Let me also double-check I cover all rows of the plan's test table:
1. create→read ✓ (case 1)
2. approve→filtered read ✓ (case 2)
3. N concurrent approves ✓ (5)
4. mixed create/modify concurrency ✓ (6)
5. drift corrupt row status+amount ✓ (9, 10)
6. drift delete row ✓ (11)
7. re-derive under corruption ✓ (16)
8. pagination 25/10/3 ✓ (20)
9. date range filter ✓ (24, 25, 26)

Plus my additions: reject path, isolation, contention (7, 8), orphans, no-op, duplicate delivery, boundary, totals over whole company, empty window, past-end, default, error codes, envelope, getTotals.

That's comprehensive — probably too many? Prompt says "a case for each independently-possibly-wrong branch" — thoroughness is desired. I'll aim for ~25–30 lines. Each line one-line. Long lines are OK? "One line per case" — keep each to a single (long) sentence-ish.

Format: `- <name> — <what it proves, and what would have to break for it to fail>`. Name in plain (sentence case or short). I'll use kebab or short imperative name.

I should make sure the "what would have to break" clause is concrete in each item — I'll check each has an explicit failing condition.

Also the rules: "Reply with only the list, nothing else." — so no preamble, no headings beyond maybe a closing line. Closing line for non-tests is part of the requested output ("in one closing line, state what you deliberately don't test and why"). So final line like "Not testing: …". Good.

Let me also reconsider case 7 (first-write contention) once more — is it too aggressive against my design? The list is a spec for the tests I'll write; if the test fails, I fix the code. The prompt explicitly asks for awkward concurrency cases. Keep it.

And case 8 (double-approve then repair) — the assertion needs care: "if totals are corrupted by the race" — I can't conditionally assert; deterministic assertion: after the two concurrent approves settle AND one repairDrift, totals equal exactly one amount and pendingCount 0. The intermediate state I don't assert (racy). Phrasing: "…after both calls settle and one repairDrift on the window, totals are exactly single-counted; failing condition: repair fails to reset (uses deltas / wrong window) leaving doubled increments." Good — I don't assert the racy intermediate, only the post-repair convergence.

For case 4 (isolation), also assert that after repair, the dashboard shows source's mutated value — convergence to source-as-truth. Failing condition: repair compares wrong direction (treats projection as truth), or read path isn't isolated.

OK, one more thought on whether the tests should be integration (real Postgres) — concurrency and upsert contention need a real DB. Not in scope for the list; it's the next step. The closing line could note strategy: integration against real Postgres, no repository mocking… but the closing line is for "what I deliberately don't test and why." Mocking strategy isn't that. Keep the closing line purely scope-exclusions.

Let me now write the final list. I'll number? The shape shows `- <name> — …`. Bullets, no numbers (shape indicates a dash). Names short.

Draft:

- Read-your-own-writes: create — an order that was just created appears on the company's next dashboard query with status `pending`, correct amount and denormalized worker/event fields — fails if the projection write lands after commit or in a separate transaction, or the create hook stores ids instead of worker/event names.
- Read-your-own-writes: approve — after `approveOrder`, the next query with `status=approved` shows the order and it is no longer under `pending`; the company's totals show `pendingCount` decremented by one and `approvedTotalCents` increased by exactly the amount — fails if the status hook doesn't run in the write transaction or the delta uses the wrong column or sign.
- Read-your-own-writes: reject — same for `rejected`: only `rejectedTotalCents` moves, exactly the amount; fails if the reject branch of totals adjustment is missing or adds to the approved column.
- Dashboard reads only the projection — mutating a source `payment_orders` row directly (bypassing the writes service) leaves the dashboard response unchanged, and a subsequent `repairDrift` on that window converges the dashboard to the mutated source value — fails if the read path still joins the three source tables (the original slow query), or repair treats the projection as truth instead of the source.
- Concurrent approves, one company — N concurrent `approveOrder` calls on distinct pending orders for the same company leave `approvedTotalCents` exactly equal to the sum of all amounts and `pendingCount` at 0 — fails on a lost update (read-then-write totals) or any partial increment.
- Concurrent mixed create + approve, one company — interleaved concurrent creates and approves settle into totals that match the actual final statuses of every order (approved total = sum over approved orders only, pendingCount = number still pending) — fails if hook and source write can interleave such that an increment applies to the wrong status or is lost.
- First-write contention on a new company — two concurrent first-ever orders for a brand-new company both commit and `pendingCount` equals 2 — fails if the totals upsert's create path can hit a unique-violation that aborts one of the writes (Prisma upsert's select-then-insert race) or drops an increment.
- Double-approve of the same order, then repair — after two concurrent approves on one order settle and a `repairDrift` on that window runs, totals are single-counted (`approvedTotalCents` = one amount, `pendingCount` = 0) — fails if repair re-applies deltas instead of converging to source, or its window misses the row.
- Drift repair: stale status — a projection row silently flipped to `pending` while the source is `approved` is corrected by `repairDrift`, and the company's totals come back to source-exact values; report says rowsCorrected ≥ 1 and totalsCorrected — fails if the diff only checks row presence (not values) or fixes rows without recomputing totals.
- Drift repair: stale amount — same for a corrupted `amount_cents` (or denormalized field): the row is corrected and any totals that depend on the amount are source-exact — fails if repair upserts only a subset of fields or recomputes totals from the pre-fix projection.
- Drift repair: missing row — deleting a projection row and then running repair restores it with all fields and the company's totals include its amount/count exactly once — fails if repair never detects rows present in source but absent from projection.
- Drift repair: orphan row — a projection row whose id has no source order (created_at in window) is deleted and its amount excluded from totals — fails if repair only ever upserts and never deletes.
- Drift repair: clean no-op — on a consistent window, the report is rowsCorrected 0 and totalsCorrected false and state is unchanged — fails if reset/unconditionally rewrites make the report (or the data) claim corrections that did not happen.
- Drift repair: duplicate delivery — corrupt → repair → repair again on the same window: second run reports zero corrections and leaves totals unchanged — fails if corrections are delta-based, so a second pass double-applies.
- Drift repair: window boundaries — a corrupted row with created_at exactly `from` is fixed, while a corrupted row exactly at `to` is left untouched by repair on `[from, to)` — fails on either boundary being implemented as the wrong inclusivity (inclusive end, or exclusive start).
- Re-derivation: rebuild under corruption — with a row corrupted and another deleted, `rederive(from, to)` leaves the projection identical to source for the window and totals source-exact — fails if re-derive only upserts (leaving stale rows) or computes totals from anything other than source.
- Re-derivation: window scoping — re-deriving a window containing only 2 of a company's 5 orders leaves the other 3 rows byte-identical — fails if the delete/insert phase is not scoped by created_at and wipes rows outside the window.
- Re-derivation: totals are company-wide — after re-deriving a window holding only part of a company's orders, `approvedTotalCents` still equals the sum over all of that company's source orders — fails if totals reset is scoped to window rows and silently undercounts the company.
- Re-derivation: empty window — re-deriving a range with no source orders completes without touching existing rows or totals — fails if the empty-set path errors or zeroes state.
- Pagination arithmetic — 25 rows for one company: page 1/size 10 returns 10 items with total 25, page 3 returns the remaining 5 oldest, and pages 1–3 contain 25 distinct ids with no duplicates or gaps — fails on skip/take arithmetic, or a count query that filters differently from the page query.
- Pagination exhaustion — page 4/size 10 (beyond the last page) returns an empty items array with total still 25, not an error — fails if the offset arithmetic goes negative, errors on Postgres, or past-end is misreported as invalid_query_params.
- Pagination boundary values — pageSize 100 with page 1 is accepted; pageSize 101, page 0 and negative pages are rejected with code `invalid_query_params` and a non-null `details` object — fails on off-by-one in the cap, missing validation, or wrong envelope.
- Sorting by recency — items come back strictly in created_at descending order and the newest of all 25 is first on page 1 — fails on ascending sort, missing order, or per-page-only ordering.
- Date range boundaries (read path) — an order exactly at `from` is included and one exactly at `to` is excluded; from-only, to-only, and neither all filter as specified — fails on gte becoming gt or lt becoming le in the projection query.
- Company isolation — two companies with interleaved orders on the same day: querying one returns only its rows and total, no cross-company leakage at any page size — fails if company_id is dropped from the where clause.
- Status filter — `status=approved` excludes pending/rejected from both items and total; no status returns all three — fails if the filter applies to findMany but not count (or vice versa).
- Default parameters — a query with only companyId uses page 1 and the default page size (20) — fails if a missing param flows through as undefined and returns all rows or 500s.
- Totals endpoint: mixed statuses — a company with approved, rejected and pending orders reports exact per-status sums (bigint cents) and the exact pending count — fails if an amount lands in the wrong status column or the count includes non-pending orders.
- Totals endpoint: unknown company — a companyId that never wrote anything returns the `company_not_found` envelope, not zeros and not a 500 — fails if "no row" is conflated with success or the raw error leaks out.
- Error path: missing order — approving a UUID that does not exist returns code `order_not_found` and leaves the company's order count unchanged — fails if the missing-row case 500s or is swallowed as success.
- Error path: invalid transition — approving an already-approved order (and rejecting an already-rejected one) returns `invalid_transition` and does not re-apply the totals delta — fails if the guard is missing and a no-op re-increments `approvedTotalCents` or decrements `pendingCount` again.
- Error envelope shape — every error code in the table above arrives as `{error:{code,message,details}}` with snake_case code and an object (never null) details — fails if any path emits Nest's default `{message,error,statusCode}` shape.

Not testing line:
Deliberately not testing: p95 latency and index utilization (needs a 3M-row load harness, outside integration scope); ordering among equal created_at values (no secondary sort key defined, so tie-breaks are not asserted); transitions between terminal states such as approved→rejected or re-approval of a rejected order (the plan only defines pending as a transition source); changes to worker/event fields after an order is created (the plan has no update hook for those tables); and full-scale window re-derivation throughput.

That's 30 cases + closing line. Maybe a bit long, but the prompt explicitly asks for per-branch coverage and awkward cases. Let me check "one line per case" — yes, each is one bullet line. "Reply with only the list, nothing else." — I shouldn't add a heading like "Test cases for test/operations.spec.ts"? That's not the list. Strict: reply with just the bullets and the closing line.

One more sanity pass on honesty of failing conditions:

- Case "Sorting by recency": "per-page-only ordering" — in a single query, sort is global; the failure mode is simply wrong/missing order. I'll simplify: "fails if sort is missing or ascending."
- Case Pagination arithmetic: "count query filters differently" — plausible bug. Good.
- Case Drift repair stale amount: "recompute totals from pre-fix projection" — plausible order-of-operations bug. Good.
- Default parameters: is "return all rows" plausible? If pageSize undefined → take: undefined → Prisma returns all. Yes.
- getTotals unknown company: does the implementation return a promise of `CompanyTotals | null`? The repo returns null; the service per plan throws company_not_found. Shown projections.service.ts is truncated so I don't know. The plan says it throws. The test asserts the contract; failing condition is nameable either way ("returns null/zero instead of an error, or 500s").

Also: should I include a case that the `DriftReport` windowStart/echoes the requested window fields? Trivial; skip.

Also, "exhaustion" — I have past-end pagination, empty window, unknown company. Good coverage of the class; I'll mention in closing line? Not needed.

I think I'm ready. I'll finalize the wording to be terse but complete, and make sure each line contains both halves: what it proves AND what would have to break.
```

## reply

- Read-your-own-writes (create) — an order immediately after `createOrder` appears on the company's next dashboard query with `pending` status, correct amount, and denormalized worker/event fields — fails if the projection write lands after commit or in a separate transaction, or if the create hook stores ids instead of worker/event names/locations.
- Read-your-own-writes (approve) — after `approveOrder`, the next query filtered by `status=approved` shows the order and it no longer appears under `pending`; totals show `pendingCount` one lower and `approvedTotalCents` up by exactly the amount — fails if the status hook does not run inside the write transaction, or the delta hits the wrong column or has the wrong sign.
- Read-your-own-writes (reject) — mirror of the approve case: only `rejectedTotalCents` moves, by exactly the amount, and `pendingCount` drops — fails if the reject branch of the totals adjustment is missing or credits the approved column.
- Dashboard reads only the projection — mutating a source `payment_orders` row directly (bypassing write services) leaves the dashboard response unchanged, and a subsequent `repairDrift` over that window converges the dashboard to the mutated source value — fails if the read path still joins the three source tables (the original 20–30s query), or if repair trusts the projection over the source.
- Concurrent approves, one company — N concurrent `approveOrder` calls on distinct pending orders of the same company end with `approvedTotalCents` exactly equal to the sum of all amounts and `pendingCount` at 0 — fails on any lost update (read-then-write totals) or partial increment.
- Concurrent mixed create + approve, one company — interleaved concurrent creates and approves settle into totals that match every order's actual final status (approved total = sum over only the approved orders, `pendingCount` = number still pending) — fails if hook and source write can interleave so an increment is applied to the wrong status or lost.
- First-write contention, new company — two concurrent first-ever orders for a brand-new company both commit and `pendingCount` equals 2 — fails if the totals upsert's create path can hit a unique violation that aborts one write (select-then-insert race) or drops an increment.
- Double-approve of one order, then repair — after two concurrent approves on the same order settle and one `repairDrift` over the window runs, totals are single-counted (one amount in `approvedTotalCents`, `pendingCount` 0) — fails if repair re-applies deltas instead of converging to source, or its window misses the row.
- Drift repair, stale status — a projection row silently flipped to `pending` while source is `approved` is corrected by `repairDrift` and the company's totals are source-exact again, with the report claiming rowsCorrected ≥ 1 and totalsCorrected — fails if the diff checks row presence but not values, or rows are fixed without recomputing totals.
- Drift repair, stale amount — a corrupted `amount_cents` (or a denormalized field) is corrected and amount-dependent totals are source-exact — fails if repair upserts only a subset of fields or recomputes totals from the pre-fix projection.
- Drift repair, missing row — deleting a projection row then running repair restores the row with all fields and includes its amount/count in totals exactly once — fails if repair never detects rows that exist in source but not in the projection.
- Drift repair, orphan row — a projection row whose id has no source order (created_at in window) is deleted and its amount drops out of totals — fails if repair only ever upserts and never deletes.
- Drift repair, clean no-op — on a consistent window the report is rowsCorrected 0 and totalsCorrected false and state is unchanged — fails if resets are unconditional, making the report or the data claim corrections that did not happen.
- Drift repair, duplicate delivery — corrupt → repair → repair again over the same window: the second run reports zero corrections and leaves totals unchanged — fails if corrections are delta-based and a second pass double-applies them.
- Drift repair, window boundaries — a corrupted row with created_at exactly `from` is fixed while a corrupted row exactly at `to` is left untouched by repair over `[from, to)` — fails if either edge uses the wrong inclusivity (inclusive end or exclusive start).
- Re-derivation, rebuild under corruption — with one row corrupted and another deleted, `rederive(from, to)` leaves the projection identical to source for the window and totals source-exact — fails if re-derivation only upserts (leaving stale rows) or computes totals from anything but source.
- Re-derivation, window scoping — re-deriving a window that holds only 2 of a company's 5 orders leaves the other 3 rows byte-identical — fails if the delete/insert phase is not scoped by created_at and wipes rows outside the window.
- Re-derivation, company-wide totals — after re-deriving a window holding only part of a company's orders, `approvedTotalCents` still equals the sum over all of that company's source orders — fails if the totals reset is scoped to window rows and silently undercounts the company.
- Re-derivation, empty window — re-deriving a range with no source orders completes without touching existing rows or totals — fails if the empty-set path errors out or zeroes state.
- Pagination arithmetic — 25 rows for one company: page 1/size 10 returns 10 items with total 25, page 3 returns the final 5, and pages 1–3 contain 25 distinct ids with no overlap or gaps — fails on skip/take arithmetic, or a count query that filters differently from the page query.
- Pagination exhaustion — page 4/size 10, beyond the last page, returns an empty items array with total still 25 rather than an error — fails if the offset goes negative or errors, or past-end is misreported as `invalid_query_params`.
- Pagination boundary values — pageSize 100 with page 1 is accepted; pageSize 101, page 0 and negative pages are rejected with code `invalid_query_params` and a non-null `details` object — fails on an off-by-one in the cap, missing validation, or a malformed envelope.
- Sorting by recency — items come back in strictly descending created_at order and the newest of all 25 is first on page 1 — fails if the sort is ascending, missing, or not applied to the projection query at all.
- Date range boundaries (read path) — an order exactly at `from` is included and one exactly at `to` is excluded; from-only, to-only, and no range all filter as specified — fails if gte becomes gt or lt becomes le in the projection query.
- Company isolation — two companies with interleaved orders on the same day: querying one returns only its rows and total at any page size — fails if company_id is dropped from the where clause.
- Status filter — `status=approved` excludes pending/rejected from both items and total; omitting status returns all three — fails if the filter applies to findMany but not count, or vice versa.
- Default parameters — a query with only companyId uses page 1 and the default page size (20) — fails if a missing param flows through as undefined and returns all rows or 500s.
- Totals, mixed statuses — a company with approved, rejected and pending orders reports exact per-status sums in bigint cents and the exact pending count — fails if an amount lands in the wrong status column or the count includes non-pending orders.
- Totals, unknown company — a companyId that never wrote anything returns the `company_not_found` envelope, not zeros and not a 500 — fails if "no row" is conflated with success or the raw error escapes.
- Error path, missing order — approving a UUID that does not exist returns code `order_not_found` and leaves the company's order count untouched — fails if the missing-row case 500s or is swallowed as success.
- Error path, invalid transition — approving an already-approved order (and rejecting an already-rejected one) returns `invalid_transition` without re-applying the totals delta — fails if the guard is missing and a no-op re-increments `approvedTotalCents` or decrements `pendingCount` again.
- Error envelope shape — every error code above arrives as `{error:{code,message,details}}` with a snake_case code and an object (never null) details — fails if any path emits Nest's default `{message,error,statusCode}` shape.

Not testing, deliberately: p95 latency and index utilisation (requires a 3M-row load harness, out of scope for integration tests); ordering among equal created_at values (no secondary sort key is defined, so tie-breaks are not asserted); transitions between terminal states such as approved→rejected or re-approving a rejected order (the plan defines pending as the only
