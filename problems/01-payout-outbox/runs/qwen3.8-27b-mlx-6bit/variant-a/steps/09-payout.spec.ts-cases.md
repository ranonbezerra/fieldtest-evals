# 09-payout.spec.ts-cases

## reply

We need answer user's request: list test cases for test/payout.spec.ts, do not write tests. Need read references and reason about required behavior, branches. Need final list only, one line per case with shape: - <name of the test> — <what it proves, and what would have to be broken for it to fail>. Include awkward cases: concurrency, duplicate delivery, exhaustion, boundary values, error path looks like success. Closing line naming what deliberately not testing and why. No code. Need likely include plan's tests and maybe additional branch-specific cases. Need ensure we align with implementation read-only.

Let's analyze code/plan to identify behaviors and branches.

Implementation:
- PayoutService.createPayout:
  - find existing by idempotency key; if exists return existing.
  - else call repo.createPayoutWithHold(input). If catch: if isIdempotencyKeyConflict (Prisma P2002, target maybe idempotencyKey or column), re-fetch and return winner; if winner null rethrow. Otherwise throw error.
- PayoutRepository.createPayoutWithHold:
  - transaction: SELECT 1 FROM accounts WHERE id FOR UPDATE. If account not exists? $queryRaw no error if no row? findUniqueOrThrow will throw Prisma P2025. Not explicitly in plan? Tests maybe not account not found? Task didn't require, but controller validates presence. Could test unknown account? Might need if branch could be wrong: raw select no lock but findUniqueOrThrow throws P2025; controller? Maybe not plan required. But tests could cover error path for missing account? Task says create if account has sufficient funds, implies invalid account maybe 404? But plan doesn't define. Should we include? We are listing for tests that will run against implementation. Maybe not necessary unless plan says matters. But one case per branch that could be wrong on its own. Missing account is branch. But controller? read-only service only? We only test payout.service.ts, worker, repository per manifest. Could include repository behavior: unknown account results in Prisma error? But no envelope contract? Not specified. Could be awkward? Let's see.
  - available = settledBalance - heldAmount; if available < amount throw InsufficientFundsError. Boundary: amount == available should succeed, amount = available + 1 fail.
  - update account heldAmount increment input.amount
  - create payout default status created? schema presumably.
  - create ledger HOLD
  - create outbox pending.
- findPayoutByIdempotencyKey and findPayoutById map amount to string.
- updatePayoutStatus sets updatedAt, txHash optional. If no txHash doesn't set? uses conditional.
- settleLedger: create SETTLE ledger; decrement settledBalance and heldAmount.
- releaseHold: create RELEASE ledger; decrement heldAmount only.
- claimMessage: updateMany where id and status in [PENDING, PROCESSING] to PROCESSING, started now. Returns count === 1. This means if message already DONE/FAILED, returns false. If message PROCESSING but stale or not, can claim if still PROCESSING? In processOne, candidates include pending and stale; then claimMessage with status in [PENDING, PROCESSING]. If a message is PROCESSING not stale, nextPendingMessage won't include; claimStaleMessages includes stale processing. But if there are multiple workers, claimMessage on a PENDING message updates to PROCESSING; second updateMany with status in [PENDING, PROCESSING] will also match (since now PROCESSING) and return count=1! That's a concurrency bug? Wait: claimMessage uses status IN ('pending','processing'), not just pending. That's dangerous: two workers fetching same pending message at same time both call claimMessage; first sets PROCESSING, second's updateMany WHERE status IN PENDING OR PROCESSING matches the row (now PROCESSING) and updates again, returns count 1, both think claimed. The plan says claimMessage must use conditional update WHERE status='pending' so two workers cannot claim same message. But for stale re-claim, maybe need status in pending/processing? The implementation as shown uses [PENDING, PROCESSING], which fails mutual exclusion for pending race and also for a stale message with another active worker? Actually if same pending concurrently, both can claim. But for duplicate delivery (message already done) it returns false because DONE not in list. For stale processing, if two workers see same stale, both can claim because status PROCESSING matches; one resets startedAt? They both count 1. That's a potential bug. But user asks list tests that will run against implementation; should we include test that would catch this? The plan says concurrent claim / duplicate delivery. The reference implementation may have flaw. We should include tests for claimMessage concurrency or processMessages duplicate delivery? The plan's test: worker sees same message twice (done) no double-settlement. But if claimMessage accepts PROCESSING, duplicate delivery of a PROCESSING message could lead to double transfer? In processOne: claimed = claimMessage; if already DONE false skip. If duplicate pending delivery before first completes, both could process and double call provider. But is that a "duplicate message delivery" requirement? At-least-once; worker may see same message more than once. Need safe: don't double settle. But implementation only prevents terminal duplicate, not concurrent duplicate pending. Should include awkward case: two concurrent workers/processMessages on same pending message must cause provider.transfer once or at least ledger settled once? But with implementation, it may fail. That's okay: list cases that would catch breakage.

Need be careful: The user says implementation files are what tests run against; not to write tests. We list test cases; they should cover behavior plan says matters, including branches that could be wrong on its own. Some cases may expose implementation bugs; that's expected? Yes. Need list what would have to break for fail, including actual bug: if claimMessage uses status IN PENDING OR PROCESSING, concurrent duplicate pending would fail test that provider transfer called once? But we cannot assert only call happened; need behavioral state: no double ledger settlement, balances consistent. If provider mock called twice? The rule says never assert only that a call happens; but can use provider mock state? In test list, we can say it proves exactly one SETTLE ledger entry and balances decremented once; would fail if duplicate pending messages are both claimed and transfer executed/settled twice. That's behavioral.

Also processOne: If provider throws on attempts < maxAttempts, incrementAttempts sets status PENDING. Note message.attempts is from candidate row fetched before claim. If two workers duplicate, both might see attempts 0 and call increment? But claim doesn't prevent. Could double increment? Not if no concurrency.

Retry exhaustion logic:
- processOne claims, finds payout, update status PROCESSING, transfer. On error: if message.attempts < maxAttempts -> incrementAttempts. Else transaction releaseHold, status NEEDS_REVIEW, markMessageFailed.
Potential bug: attempts counter starts 0. If maxAttempts=3, first failure message.attempts=0 <3 -> increment to 1. second: attempts=1 -> increment to 2. third: attempts=2 -> increment to 3, not failed. Fourth: attempts=3 <3 false -> release/failed. So total 4 attempts, maxAttempts not respected if interpreted as max number of provider calls = maxAttempts. Plan says default 3, bounded; test in plan: Provider throws on attempt 1 and 2, succeeds on attempt 3 (maxAttempts=3) -> completed; attempts recorded as 3. In implementation, if initial attempts=0, after first success on third call, message.attempts? Let's simulate: create with attempts 0. processOne candidate attempts 0; transfer success; markDone (doesn't update attempts). So attempts remains 0, not recorded as 3. Plan test says attempts recorded as 3; implementation would fail that if asserting attempts=3. But maybe they don't need attempts recorded? The plan says test asserts attempts recorded as 3. Since implementation doesn't increment on success, it will fail. We should list a case: transient failures then success within bound completes and records the attempts count as expected? But if implementation fails, that's okay. Need name what would break: success path after retries must not lose attempt accounting; failure if attempts field remains 0 or is not incremented before success. However, do we need to test internal attempts? The task says retry bounded number; if exhaust retries... attempts count is mechanism. But behavior test should focus on external: provider called at most maxAttempts? The implementation calls transfer before checking attempts; for exhaustion it calls transfer on attempt when message.attempts == maxAttempts, so total maxAttempts+1 calls. If maxAttempts=3, it will call transfer 4 times before failed. That's a funds-safety? It might call provider 4 times despite bound 3. Should test: with maxAttempts=3 and always-failing provider, processMessages runs until no pending? Need simulate. Let's simulate:
initial attempts=0, status PENDING.
processMessages #1: candidate pending attempts 0; claim -> PROCESSING; transfer fails; 0<3 => increment to 1, status PENDING.
#2: attempts 1 -> transfer fails -> attempts 2.
#3: attempts 2 -> transfer fails -> attempts 3.
#4: candidate pending attempts 3; claim; transfer fails; 3<3 false -> release/needs_review, message FAILED.
Total provider.transfer calls = 4. If maxAttempts means maximum attempts total, implementation violates. Plan's test says exhaust retries: provider throws on every attempt (attempts = maxAttempts) -> needs_review. Ambiguous. Could set message attempts = maxAttempts initially, then first process triggers failure and release. But "bounded number of times" likely provider calls should be <= maxAttempts. Implementation is wrong. Should include boundary test: with maxAttempts=3 and always failing, provider transfer is invoked exactly 3 times (or at most 3) and final state needs_review. Implementation fails (4 calls). But rule says never assert only call happened; can assert no fourth settlement? Provider mock with no side effects. But call count is a call assertion? It says never assert only that a call happens. We can combine with final state and ledger. But if provider fails, no settlement. Could assert exactly 3 failed attempts before terminal? The test could track call count but also state. Is that allowed? It says never assert only that a call happens; can use as part but not only. We can phrase proves bounded retries: final needs_review after at most maxAttempts provider attempts and no settlement; would fail if worker makes a fourth attempt or settles after exhaustion. That's okay.

But careful: Plan's retry exhaustion test in §5: "Worker processes a message whose provider throws on every attempt (attempts = maxAttempts) | Payout status → needs_review; ledger has RELEASE entry; held_amount decremented, settled_balance unchanged; message → failed" It says attempts = maxAttempts maybe initial. Then provider call? processOne always calls transfer even if attempts >= maxAttempts before deciding, so it will call provider once more. Maybe safe? But "bounded" should mean no transfer after exhaustion? Actually if attempts=maxAttempts means already attempted max, maybe shouldn't call. Implementation calls transfer then releases. Could double-send? If prior attempts unknown outcome, calling again could be unsafe. We should include: a message already at maxAttempts must not call provider again; it should release/needs_review directly. But implementation would call transfer. The plan §4: on error if attempts >= maxAttempts release. It doesn't explicitly check before transfer. State machine: stale pending with attempts=max? How could happen if increment increments up to max and leaves pending. Then next process calls transfer (extra). So bug. Test: with attempts at max and provider mock that would settle, processMessages must not settle and must go needs_review; fail if provider.transfer is invoked or SETTLE ledger created. That's strong.

Need also consider duplicate settlement idempotency: provider success after a crash? The worker sets payout PROCESSING, calls transfer, then if crash before settle, message stays PROCESSING; stale claim later may call provider again. At-least-once transfer could result in duplicate blockchain transfer? Funds safety? The plan treats all errors transient and if success slowly maybe crash before recording; stale recovery may call provider again, possibly double transfer. But provider not idempotent? Task only asks safe on retry exhaustion. Maybe not test duplicate transfer due to stale after success. But requirement: account settled balance changes only when provider confirms transfer. If provider succeeds but worker crashes before settle, later retry might double confirm? Could overpay. But provider SDK not idempotent? No requirement. Maybe not in plan. But could include stale processing timeout: a PROCESSING message older than 30s is re-claimed and processed; if provider succeeds on retry, settle once. But risk double transfer not testable unless mock. Maybe include: stale processing message is reclaimed and completed if provider later succeeds; fail if stale messages are ignored (stuck) or double-settled. That's in plan? Plan has claimStaleMessages. Need test branch: stale processing is picked up.

Need test message terminal DONE/FAILED not reprocessed. processMessages candidates pending + stale processing, so done not fetched. Even if candidate somehow done? claimMessage false. Could test processOne with done message? But processMessages doesn't include done. Direct duplicate delivery: call processMessages twice after done; no extra SETTLE. That's plan test.

Need test creation concurrent: two racing requests same account sufficient for one. Repository uses FOR UPDATE, should prevent overdraw. But service idempotency fast path? If same account different keys. Test with real DB concurrency. What would break: if lock missing or balance check not atomic, both could hold. Also raw SELECT FOR UPDATE only selects 1; if account missing, findUniqueOrThrow throws after no lock? But for known account okay. Need test: concurrent creations with different idempotency keys where total amount > available: exactly one succeeds, other insufficient_funds. Also maybe concurrent same idempotency key: exactly one payout and one hold; second returns same id. Plan says duplicate creation test. But concurrent same key: service fast path may both find null then createPayoutWithHold; one inserts, other P2002, re-fetch returns existing. Need test: concurrent same idempotency key produces one payout and held_amount once. That's awkward. Also sequential duplicate: second returns existing, 200? If testing service/repository only maybe no HTTP status. But plan tests likely service level? Manifest test reads service, worker, repository. Could be e2e with supertest? Not specified. We can name at behavior level; could include controller status? Maybe tests in payout.spec.ts maybe unit/integration. The list should cover test cases; can include controller mapping? The plan says controller validates 400/422. But manifest test reads only service/worker/repository? It says test/payout.spec.ts reads: src/payout/payout.service.ts, payout-worker.service.ts, payout.repository.ts. Does not list controller/module. Maybe tests may not test HTTP layer? But deliverable includes controller. The user's list for test/payout.spec.ts maybe all tests. PLAN §5 only lists behaviors, not controller statuses. But requirements ask POST; maybe test HTTP? However reference manifest says test reads service, worker, repository only. But could still test controller via module? Not listed. We should probably focus on service/worker/repository behavior, not HTTP status unless branch matters. The shape asks tests for concurrent creation, duplicate message delivery, retry exhaustion. Could include controller mapping error code? The plan says controller returns 400/422. If test/payout.spec.ts doesn't read controller, maybe not. But the task statement says tests for: concurrent creation against one account, duplicate message delivery, retry exhaustion. Not necessarily HTTP.

Need consider amount as bigint and JSON string. Boundary values:
- amount 0? Is zero valid? Task says amount in minor units; maybe could be 0. If zero, available < 0 false? It would create payout with 0, hold 0. Is that desirable? Maybe invalid? Not specified. Boundary: amount equal available succeeds; amount one greater fails. Amount negative? Controller validates? Not in service? Repository would allow negative: available < negative false, heldAmount increment negative (reduces hold) => could overdraw. Should test input validation rejects non-positive? But plan controller validates presence only, not amount positive. Task says body includes amount; no explicit validation of positive. But funds safety: negative amount could increase available by decrementing heldAmount? In createPayoutWithHold, if amount negative, available (maybe 10) < -5 false, heldAmount += -5 (decrease), payout amount negative. That's dangerous. Should we include test? The controller zero business logic but validates input; could reject negative/zero. Plan doesn't mention. "Include boundary values" suggests test amount exactly available and one too many; maybe non-positive. But deliberately not testing unspecified? Need decide.

Could list: zero or negative amount is rejected as invalid; would fail if service/repository allows a non-positive amount to alter held_amount. But if no test, is it required? The task says amount; amounts minor units; probably positive. But plan did not specify controller validation for positive. If implementation doesn't, test would fail. But user asks list tests that will run against implementation; should they pass? It doesn't say all must pass, but likely we list intended tests. If implementation lacks validation, maybe we shouldn't include tests for unimplemented behavior? But "what would have to be broken for it to fail" can identify implementation shortcomings. However the tests are to be written next from this list against this implementation; if we include unimplemented behavior, next step will make tests fail. That's okay? Usually evaluation expects list based on plan/implementation; may include edge cases that catch bugs. Need align with "implementation files shown read-only are what these tests will run against." It doesn't say tests must pass. We should test actual behaviors and branches that could be wrong.

Need maybe not include tests requiring files not shown (controller validation) because test file may run service. But could still include if spec includes controller? It says test/payout.spec.ts, no constraint. PLAN manifest says test reads service/worker/repository only. We can avoid controller status tests, but include service error mapping? Controller is separate. Error envelope maybe not in these files? No global exception filter shown. So don't test HTTP error envelope unless we assume. The list should be for behavior of service/worker/repository.

Need consider idempotency duplicate fast path: find existing before create. What if existing payout has any status? Should return it. Test: duplicate key after payout completed returns same completed payout and does not create ledger HOLD. Fail if code creates a second hold or ignores existing status.

Need consider idempotency key conflict with insufficient funds? If race: same key, one succeeds, other P2002 re-fetch returns success even if funds now insufficient. Good. Test: concurrent identical request where one wins; loser returns winner, not InsufficientFunds. Fail if re-fetch path missing or P2002 handling wrong, returning 422 instead of existing.

Need consider P2002 on other unique? Only idempotency key. isIdempotencyKeyConflict accepts target length 0 or field. If a P2002 on something else (impossible) would be misclassified. Not test.

Need consider missing account: createPayout with unknown accountId: raw select no row, findUniqueOrThrow throws P2025. Service not catch; controller maybe 500? Not specified. Could test repository propagates not-found? But no error type. Maybe deliberately not testing because task doesn't define unknown-account contract. Closing line can say not testing unknown account/HTTP envelope because not specified by plan/task? But it's a branch. The user asks name what deliberately are not testing and why, one closing line. Could say Not testing unknown-account/HTTP error envelope because the plan does not define that contract and the shown layers do not own it. Good.

Need consider provider slow success: updatePayoutStatus to PROCESSING before transfer; on success settle in transaction. Test: payout status is PROCESSING while provider pending? Hard to assert without hooks. Could use mock that records status before transfer. But behavioral: when provider eventually returns, final completed and ledger settlement atomic. If settlement not transactional, maybe partial update? Could test if markMessageDone throws after settle? Hmm.

Need consider transactional atomicity of success: settleLedger, updatePayoutStatus completed, markMessageDone same transaction. If one fails, none committed. Could test by mocking repository? But tests behavior with real DB? Hard to force one step fail. Could test duplicate delivery after partial? Not possible. Maybe not include because testing implementation details. But plan says must be same transaction; a test could verify if message mark done fails, payout not completed? That requires fault injection. Maybe too implementation-specific. But could list: a failure between settlement and message completion leaves no committed mixed state (either all or none); would fail if success path is non-atomic and a crash after payout update leaves message pending and balance settled? But with at-least-once, could double settle? Hmm.

Need consider ledger invariants:
- creation: HOLD entry, held_amount increases by amount, settled_balance unchanged.
- success: SETTLE entry, settled and held decremented by amount.
- failure/exhaustion: RELEASE entry, held decremented only, settled unchanged.
- duplicate delivery: no extra ledger entries or balance changes.
Need tests for each.

Need consider state transitions:
- created initially? Could test new payout status = created (or processing after worker). Plan state machine. Test: freshly created payout has status created and no txHash; fail if default missing or worker prematurely completed.
- processing before provider call: need assert via mock provider capturing payout status at transfer time? Could test with provider mock that queries repository for status during transfer; if not PROCESSING, fail. Is this behaviorally important? Prevents double processing? It's in plan ordering rules. But might be too implementation-specific. However "case per branch that could be wrong on its own" maybe include: worker marks payout PROCESSING before calling provider; fail if status remains created during provider call (e.g., stale recovery or duplicate can't tell in-flight). But tests can mock provider and assert status. That's not just call happened; it asserts observed state. Could include.

- completed with txHash: provider returns txHash; payout.txHash set; fail if txHash lost.
- needs_review no txHash? If provider failed, no txHash; fail if null replaced or random.

- failed status reserved? Not used by current worker unless maybe definitive rejection. No test.

Need consider message attempts update on retry:
- transient failure increments attempts and resets to pending, lastError stored, processingStartedAt cleared. Test: after first failure with maxAttempts > attempts, message PENDING and attempts 1; payout still PROCESSING? Actually processOne updates payout to PROCESSING before failure. On transient failure, does it revert payout status? No, remains PROCESSING. Is that okay? State machine created -> processing; retry stays processing. Could test payout status remains PROCESSING (or at least not completed/needs_review) and message pending; fail if it releases funds or marks failed on first transient error.
- boundary: attempts = maxAttempts - 1 and failure -> increments to maxAttempts and remains pending? Or should it fail? Implementation leaves pending until next call. Test might assert one more attempt allowed (next process calls provider) and then exhaust. But if bounded total attempts, this reveals bug. Could instead test: when the last allowed attempt fails, final state needs_review; fail if it leaves a retry pending or releases before a provider attempt. Need decide.

Let's define maxAttempts semantics: likely maximum number of attempts (provider calls) before giving up. For maxAttempts=3, attempts field maybe count completed attempts. Implementation increments after failure if attempts < maxAttempts. This yields 4 calls. A correct implementation might check attempts before transfer or increment before? Let's design test cases robust: 
- "bounded retry exhaustion" — with maxAttempts=3 and provider always failing, after repeated processMessages the payout is needs_review, message failed, funds released, and provider.transfer is not called more than three times total. Would fail if worker makes a fourth transfer or never reaches terminal state.
This covers.
- "message already at max attempts is not sent again" — pre-seed message with attempts=maxAttempts, status pending; processMessages must release/needs_review without calling provider or creating SETTLE. Would fail if processOne calls provider before checking attempts, causing another transfer/settlement. This is strong and branch-specific. But is it in plan? Not explicitly, but "bounded" and safe. Include awkward error path looks like success: if provider would succeed on that extra call, it must not settle.

Need consider duplicate delivery of message in processing due to stale claim: 
- Two concurrent workers claim same pending message: only one provider transfer and one settle. Implementation likely fails due to claimMessage status includes PROCESSING. Test with two processMessages concurrent? Could be flaky; but list can name it. It proves claim is exclusive; fail if claim uses status IN pending or processing, allowing two claims, or if settlement not idempotent. But test may be hard due timing; can call repo.claimMessage twice concurrently. More direct: claimMessage on same PENDING message by two concurrent repository calls returns true exactly once; second false. But rule says behavior, not just call? Claim boolean is behavior of repository. Could assert ledger unaffected if both processOne? Better: two concurrent processOne/processMessages on same pending message results in one SETTLE and balances decremented once. But to force concurrency with real provider mock delayed. Good.
- duplicate delivery of stale PROCESSING: two workers see same stale message; only one should process? If claimMessage with status PROCESSING allows both, fail. Could test: a stale PROCESSING message is reclaimed by at most one worker; no double settlement. But if the message was stuck, second should be allowed only if first crashed; concurrent active should not. How to distinguish? A claim should set a lock with version? Implementation not enough. But plan only says claimMessage conditional WHERE status='pending' for pending; for stale maybe need processing_started_at cutoff in WHERE? Implementation claimStaleMessages selects, then claimMessage doesn't check stale condition; a non-stale PROCESSING could be claimed if candidate somehow includes it? But candidates only stale. For two workers seeing same stale, both select before update; claimMessage matches PROCESSING, both succeed. Need atomic claim with WHERE id AND status='processing' AND processing_started_at < cutoff (or use lock). The test: two concurrent claims of the same stale message must produce exactly one successful claim/processing; fail if claim does not condition on the same stale predicate, allowing both. Could include.

Need consider processMessages batch and no pending: If no messages, does nothing; fail if it throws or processes terminal. Maybe not necessary.

Need consider message for missing payout: processOne if findPayoutById null -> markMessageFailed 'Payout not found'. Test? Branch could be wrong: orphan message. Not in plan but code has branch. Include: orphan outbox message (payout deleted/not present) is failed without provider call or balance changes; fail if worker calls provider, settles, or leaves message pending. But payout FK prevents deletion? Maybe no deletion. Could be awkward.

Need consider provider success after transient failures: plan test. Include.
- Provider throws first two, succeeds third; final completed, SETTLE one, message done. Fail if worker gives up early or double-settles. Implementation would likely: attempt1 fail -> attempts1; attempt2 fail -> attempts2; attempt3 success -> done, attempts remains 2 not 3. If test asserts attempts recorded as 3, fail due to missing attempt accounting on success. But do we want assert attempts? Maybe not if bounded test covers total calls. Could say provider invoked exactly three times and final completed; implementation fails? It will invoke 3 times (for maxAttempts=3) yes. Attempts field not 3. If test doesn't assert attempts, passes. But plan says attempts recorded as 3; implementation not. Should we include assertion on attempts? The test list can say "message attempts reflect the successful third attempt" to catch. But is that behavior or implementation? The user wants test cases; plan §5 says attempts recorded as 3. So include. It would fail against shown implementation. That's okay? The list should be from PLAN.md as own specification. Yes, PLAN is spec. So test must match plan. Implementation may be inconsistent. We list what it proves and break condition. Good.

Need think about tests in spec: likely integration with real Postgres? Could include Prisma. The list doesn't need setup.

Need produce exactly lines, no extra prose except closing line. Each line: - name — what it proves, and what would have to be broken for it to fail.
Need ensure one line per case. Closing line maybe also dash? User: "Name what you deliberately are not testing and why, in one closing line." Could be a normal line or dash? Probably one line, maybe not numbered. We can make final line: Not testing ... because ... Should it match shape? It says one closing line, not necessarily case shape. But to be safe maybe a line starting with "Not testing" no dash? They asked reply with list and nothing else. Could include closing line not a test. I'd do a final line: `Not testing unknown-account handling or HTTP error envelopes because the plan does not define those contracts and the shown service/worker/repository layers do not own them.` That's one line. But maybe they expect bullet? "Name what ... in one closing line." Could be no dash.

Need decide number of cases. Enough but not bloated. Need cover branches that could be wrong independently:
Creation:
1 duplicate idempotency fast path (existing any status) — returns same, no second hold/ledger.
2 concurrent duplicate idempotency key — one payout, one hold, loser returns winner not error.
3 concurrent different keys overdraw — exactly one success, other insufficient; ledger holds sum = successful amount.
4 boundary sufficient equal available — succeeds; held_amount increased exactly amount, settled unchanged.
5 boundary insufficient by one — InsufficientFundsError; no payout/ledger/message/hold.
6 non-positive amount? maybe include. Could be branch: amount zero or negative. But if not specified, maybe not. Let's consider including "amount boundary one minor unit". Negative is awkward funds safety. The task says amounts in minor units; not use floating point. It doesn't explicitly say positive, but payout amount should be positive. The controller should validate? Plan says validates presence of all four fields, not positive. Could be deliberately not testing because plan doesn't define. But if we include, it would fail. Maybe better to put in closing not testing? "Not testing non-positive amount validation because the plan only specifies presence, not positivity." But funds-safety maybe important. Hmm.
Could include "zero amount is rejected"? If implementation allows, fail. But is it a behavior the task asks? No. "boundary values" likely amount == available and amount > available. We can skip non-positive to avoid unplaned.

7 unknown account? skip/not testing.
8 creation inserts outbox message pending and payout created status; fail if missing message or status wrong. Could combine with equal available test? But one case per branch. Need explicit: creation persists an outbox message in PENDING for the worker; fail if message missing or not pending. This is important because async processing depends. Include.

Worker success:
9 worker success settlement — completed, txHash set, SETTLE ledger, settled/held decremented, message done. Fail if settlement not atomic, txHash lost, or message not done.
10 worker marks payout PROCESSING before transfer — provider observes status PROCESSING (e.g., mock captures) and no settlement if it fails? Could be implementation-specific but plan ordering. Include maybe "payout is PROCESSING while provider call is in flight" — fail if worker leaves it created or updates after, because duplicate/stale handling cannot distinguish in-flight. But test can be awkward.
11 duplicate delivery after done — second processMessages no new SETTLE, balances unchanged, message done. Fail if worker re-claims terminal or settlement not idempotent.
12 duplicate delivery of same pending message concurrent — one transfer/settle; fail if claim not exclusive (claim accepts PROCESSING) or settlement double-counted.
13 stale processing message reclaimed and processed — a PROCESSING older than timeout is picked up, completed on success; fail if stale selector wrong or claim doesn't recover crashed work.
14 stale message exclusive claim — two concurrent claims of same stale message only one success/no double settlement; fail if claim does not condition on stale predicate or accepts PROCESSING without lock.
Maybe combine 12 and 14? They are distinct: pending vs stale. Include both? Could be too many but okay.

Retry:
15 transient failure below max — message returns PENDING, attempts+1, lastError stored, processingStartedAt cleared, payout not terminal, no RELEASE/SETTLE. Fail if one failure releases funds or marks failed or leaves processing lock.
16 retry success after failures — provider throws then succeeds within bound; final completed, one SETTLE, message done, attempts reflect successful attempt (if plan). Fail if worker gives up early, double-settles, or loses attempt count.
17 exhaustion boundary — provider always fails and attempts at max: final needs_review, RELEASE ledger, held decremented settled unchanged, message failed; no SETTLE. Fail if release not atomic, or worker settles/retries forever.
18 bounded provider calls — with maxAttempts=3 always failing, total transfer attempts not exceed 3 (or if implementation maybe 4). Could combine with 17? 17 may not catch extra call if still terminal after 4. Include separate to prove bounded. Fail if worker makes extra attempt after max or ignores attempts before calling provider.
19 message already at max attempts not sent again — preseeded attempts=max, processMessages must go needs_review without provider call/settlement. Fail if processOne calls provider before checking attempts, allowing a late transfer to settle funds.
This is strong; include.

Error path looks like success: provider throws but maybe lastError? Or P2002 conflict path. Include idempotency race as error path looks like success? "Concurrent identical request returns existing payout instead of 422" yes.
Provider success after crash? Not test.

State transitions:
20 completed sets txHash and terminal; no further processing. Could be part of success/duplicate.
21 needs_review has no txHash and terminal; message failed. Part of exhaustion.

Need avoid too many duplicates. The final list can be ~15-20 lines. Desired oververbosity 9 but user wants list; could be comprehensive.

Need ensure each line says what would have to be broken for it to fail. Use semicolons.

Potential issue: "would have to be broken" should describe code breakage, not test breakage. E.g., "would fail if the service creates a second hold". Good.

Need consider the reference code bug in claimMessage. We can explicitly say "claimMessage must reject a second claim after the row is PROCESSING; it would fail if claim uses status IN (PENDING, PROCESSING) so a racer sees its own state as claimable". That's specific. But the test list shouldn't mention implementation? It can. The user says say what would have to break. We can mention conditional update.

Need consider service idempotency conflict detection: P2002 target. Test concurrent same key would fail if service rethrows P2002 or doesn't re-fetch. Good.

Need consider insufficient funds in transaction: if available < amount, throw; must roll back no partial writes. Test boundary insufficient proves no payout/message/ledger. Also if account row lock missing, concurrency test fails.

Need consider amounts as bigint: test large amount near max? Could include boundary: amount uses integer minor units, no float rounding; e.g., settled=10, held=3, available=7. But not necessary. Could include "large minor-unit amount equal to available succeeds without precision loss". But implementation uses bigint. A test with > Number.MAX_SAFE_INTEGER would fail if floats used. The task says do not use floating point for money. Include boundary: major amounts exceeding 2^53 are handled exactly (e.g., BigInt maxish) and no overdraw. Would fail if amount coerced to number. That's a good boundary value. But tests with huge BigInt maybe within DB BIGINT? Use 9007199254740993 minor units (2^53+1). It fits BIGINT. Include? It proves no float. Failure if service/repository converts to number or JSON loses precision. Good. But maybe too much. The task explicitly says no floating point; should test. Include: "large integer minor-unit boundary — a payout equal to available funds above 2^53 is created exactly and second one-unit increment fails; would fail if money passes through number/float and precision or comparison is wrong." Nice.

Need consider JSON amount string? PayoutResponse amount string. Could test duplicate response amount is string preserving big integer? Maybe include in large amount case: response amount string exactly. If not, fail if serialized as number/loss. But test may not go through JSON. Could say response amount preserves exact minor units as a string; fail if amount is coerced to number or decimal. Include? Maybe part of large boundary.

Need consider controller validation: missing fields returns 400. But plan test? Not in §5. Could include if testing HTTP: "missing idempotencyKey returns 400 before DB". But manifest test doesn't read controller. The task says endpoint; maybe important. However user says tests for specific behaviors. Maybe skip or put in not testing HTTP validation because controller not focus. But "case per branch that could be wrong on its own" for controller? The implementation files shown don't include controller. So can't specify how it would break. We can not test.

Need consider global error envelope? Not testing.

Need consider worker interval: processMessages every N seconds. Test that onModuleInit starts timer? That's implementation, not funds safety. Not testing.

Need consider provider timeout: transfer may time out. We can simulate error. Good.

Need consider "failed" status? Plan says reserved for definitive rejection; not used. Not testing because provider contract has no definitive error type. Closing line could mention not testing failed status/definitive rejection because plan treats all provider errors transient and no definitive error path exists. Good.

Need maybe mention not testing multiple accounts isolation? Could be simple but not required. Not testing provider SDK internals.

Let's think of possible test cases with exact failure conditions.

Draft list:
- Duplicate idempotency key on second request — proves a retried request returns the original payout and does not add a second HOLD ledger entry or second outbox message; would fail if the fast-path lookup is skipped, returns a new id, or re-runs the hold.
- Concurrent identical idempotency key — proves only one payout row and one funds hold exist when two requests with the same key race, and the loser returns the winner instead of an error; would fail if the unique-constraint conflict is not caught and re-fetched, so one request gets 500/P2002 or both reserve funds.
- Concurrent different keys against one account with enough funds for one — proves row-level locking prevents overdraw: exactly one payout is created and held_amount equals that payout's amount, the other gets insufficient funds; would fail if the balance check is not under FOR UPDATE or uses read-then-write.
- Boundary available equals amount — proves creation succeeds when the request consumes all available funds, increasing held_amount by exactly amount and leaving settled_balance unchanged; would fail if the comparison is `<` vs `<=` wrong or increment applies a different value.
- Boundary available one minor unit short — proves insufficient funds rejects before any payout, ledger entry, or outbox message is persisted; would fail if the check is missing, off by one, or writes before validating.
- Large minor-unit amount above 2^53 — proves amounts are handled as exact big integers end-to-end (response amount string and DB comparison); would fail if money is coerced to number/float and precision or inequality breaks.
- Created payout state and outbox message — proves a new payout is stored as created with no txHash and exactly one PENDING outbox message exists; would fail if the payout defaults to a later status, txHash is fabricated, or the message is absent/not pending.
- Worker success settlement — proves a successful provider transfer produces one SETTLE ledger entry, payout completed with txHash, settled_balance and held_amount each decremented by amount, and message done; would fail if settlement is partial, txHash lost, or terminal states are not committed atomically.
- Worker marks payout processing before provider call — proves the payout is observed as PROCESSING while the provider transfer is outstanding; would fail if worker calls provider before updating status, leaving created visible during in-flight work.
- Duplicate delivery of a done message — proves calling processMessages again after completion does not create another SETTLE entry, change balances, or resurrect the message; would fail if terminal DONE is not excluded from work or settlement is not idempotent.
- Concurrent duplicate delivery of the same pending message — proves two simultaneous processMessages calls cause only one settlement and one balance decrement for one payout; would fail if claimMessage allows a second claim after the first has set PROCESSING (e.g., status IN PENDING/PROCESSING) or settlement double-counts.
- Stale processing recovery — proves a PROCESSING message older than the stale timeout is re-claimed and can complete when the provider succeeds; would fail if stale selector misses PROCESSING/old started_at, or claim does not reset ownership.
- Concurrent stale message claim — proves two workers racing on the same stale PROCESSING message do not both process it; exactly one provider outcome is settled; would fail if the claim does not atomically condition on the stale predicate, letting both claimers proceed.
- Transient provider failure below max attempts — proves a failed transfer retries safely: message returns to PENDING with attempts incremented, lastError recorded, processingStartedAt cleared, payout not completed or released; would fail if the worker releases funds, marks failed, or leaves the message stuck after one transient error.
- Retry then success — proves provider failures followed by a successful transfer within the bound complete the payout with one SETTLE and a done message, with attempts reflecting the successful attempt; would fail if the worker gives up early, loses attempt accounting, or settles more than once.
- Retry exhaustion — proves when attempts are exhausted the payout becomes needs_review, one RELEASE ledger entry is written, held_amount is decremented but settled_balance unchanged, and the message is failed; would fail if exhaustion settles instead of releases, omits the ledger entry, or leaves funds held.
- Message already at max attempts — proves a pending message whose attempt count has reached max is resolved to needs_review without another provider transfer or SETTLE entry; would fail if processOne calls provider before checking the attempt bound, allowing a late transfer to settle funds.
- Bounded total transfer attempts — proves with maxAttempts=3 and an always-failing provider the worker stops after at most three provider attempts and reaches needs_review; would fail if it makes a fourth attempt or loops forever.
- Orphan outbox message — proves a message whose payout no longer exists is marked failed without calling the provider or touching balances; would fail if the worker assumes payout exists and crashes, settles, or leaves the message pending.
Not testing definitive provider failure mapping to failed status or HTTP validation/error envelopes because the plan treats all provider errors as transient and does not define those contracts for these layers.

Need maybe closing line includes unknown account? It says one closing line. Could be: `Not testing unknown-account handling, HTTP validation/error envelopes, or definitive provider failure mapping because the plan does not define those contracts for the shown service/worker/repository layers.` Good.

Need ensure line count not too high? It's okay. But maybe "Worker marks payout processing before provider call" is awkward to test behaviorally; can be included. "Orphan outbox message" maybe not plan, but branch in code. Good.

Potential issue: The test "Concurrent duplicate delivery of same pending message" and "Message already at max attempts" might be flaky/hard. But list is for test cases; okay.

Need consider if `processMessages` uses `message.attempts` from candidate row before claim. In concurrent duplicate pending, both see attempts 0. If one success marks done; other maybe also calls provider and settle double. Test catches. Good.

Need consider if `claimMessage` returns true for PROCESSING, then test "Concurrent duplicate pending" fails. Good.

Need consider if stale claim: `claimStaleMessages` selects; `claimMessage` doesn't check cutoff. Two workers both can claim. But if a message is stale, it may be safe to re-claim even if another worker is active? The plan says claimStaleMessages plus claimMessage conditional status pending? Actually for stale, to avoid two workers on same stale, need atomic update with stale condition. Test good.

Need consider "stale processing recovery" if claimMessage sets processingStartedAt now; then provider success. Good.

Need consider "Transient failure below max attempts" after failure payout status remains PROCESSING. Could test? It says not completed or released; maybe still processing. If it remains created, could fail? The plan sets processing before transfer and doesn't revert. Is that important? Maybe not. We can say "payout remains in processing (or at least not terminal)"? To be precise: would fail if it releases funds or marks terminal. If status remains created, is that broken? Maybe not funds safety, but state machine says processing. Could include "still PROCESSING". But if provider failed transiently, payout is still in flight; should be PROCESSING. Implementation leaves PROCESSING. Good.

Need consider "Worker marks payout processing before provider call" duplicates that. Could combine? Keep separate for ordering.

Need consider "Created payout state and outbox message" maybe covered by boundary success. But one case per branch: status default, outbox insert. Keep.

Need consider "Duplicate idempotency key on second request" vs concurrent same key. Both needed: fast path and conflict race. Good.

Need consider "Concurrent different keys" plus boundary insufficient. Good.

Need consider amount negative/zero? Not included; closing says not testing unknown-account etc but not non-positive. Maybe add to not testing: "non-positive amount validation because the plan specifies presence, not positivity." But if we don't test, is that okay? The task says amount; maybe positive implicit. Could include a test for zero? Let's evaluate. If amount=0, available < 0 false (unless available negative? no). It would create payout, hold 0, message; worker transfers 0 and settles 0. Is that a branch could be wrong? It might allow free spam payouts but no funds. But funds safety? Could create ledger 0. If negative, dangerous. The controller should validate positive integer minor units. Plan says controller validates presence of all four fields, not positivity. But the requirement "body: {accountId, amount, ...}" and amounts minor units likely implies positive. Should we include? The user's rules: "Include the cases that are awkward: concurrency, duplicate delivery, exhaustion, boundary values, the error path that looks like the success path." Boundary values could include zero and one. I might include a case: "zero or negative amount is rejected before any write" — would fail if createPayoutWithHold accepts non-positive amounts, because a negative amount can reduce held_amount and a zero amount can create ledger/message noise. But if implementation/controller not shown, test may fail. Is that within plan? Plan only says validates presence; but controller zero business logic maybe can validate amount > 0 as input validation. It's reasonable. But the plan didn't list. If we include, we are adding behavior not in PLAN.md. The prompt says PLAN.md above is your own specification, and implementation files are what tests will run against. It also says cover behaviour task statement asks and plan says matters. So maybe don't add unplaned. But "amounts are in minor units. Do not use floating point" could imply integer non-negative? Hmm.

Maybe include "amount boundary one minor unit" and "large big int". Zero/negative maybe not.

Need consider floating point: large amount test covers. But if using number for comparison of large equal? Good.

Need consider JSON response amount string: In large test, if response amount is number (implementation returns string) maybe not. Actually PayoutResponse amount is string. If controller serializes, big int string okay. Good.

Need consider `InsufficientFundsError` code? Service throws class with code. Controller maps 422. If tests at service level, assert throws InsufficientFundsError with code. Could include in boundary insufficient: "throws InsufficientFundsError (code insufficient_funds)". Would fail if error not typed. Good.

Need consider idempotency duplicate response status 200 vs 201? Plan says 200. Not testing HTTP. Could not include.

Need consider `details` object? not testing.

Need maybe mention test uses real Postgres for concurrency. Not needed.

Need ensure final list only, no headings? User: Reply with the list and nothing else. Could just lines. No title. Good.

Let's refine each line for clarity and failure condition.

Potential final:
- Retried request with an existing idempotency key — proves the service returns the original payout and creates no second payout, HOLD entry, or outbox message; would fail if the fast-path lookup is missing or the create path runs again for the same key.
- Two racing requests with the same idempotency key — proves exactly one payout and one hold are persisted, and the losing racer returns the winning payout rather than an error; would fail if the P2002 unique-constraint race is not caught and re-fetched, so one request errors or both reserve funds.
- Two racing requests with different keys where only enough funds exist for one — proves account-row locking prevents overdraw: one payout succeeds, held_amount increases by only that amount, and the other receives InsufficientFundsError; would fail if the balance check is not atomic under a row lock.
- Request amount equal to available funds — proves creation succeeds and holds exactly the requested minor units without changing settled_balance; would fail if the sufficiency comparison is off by one or the hold increment uses a different value.
- Request amount one minor unit above available funds — proves InsufficientFundsError is thrown before any payout, ledger entry, or outbox message is persisted; would fail if the check is missing, wrong, or writes occur before validation.
- Large minor-unit amount above 2^53 — proves amounts remain exact big integers from input through DB check and response amount string; would fail if money is coerced to number/float and precision or inequality breaks.
- Newly created payout and queue message — proves the payout is stored as created with no txHash and exactly one PENDING outbox message exists for it; would fail if the payout starts in a later state, txHash is fabricated, or the outbox insert is missing or not pending.
- Successful worker settlement — proves a confirmed transfer records one SETTLE ledger entry, marks the payout completed with txHash, decrements settled_balance and held_amount once, and marks the message done; would fail if any part of that outcome is non-atomic, partial, or repeats on duplicate delivery.
- Payout status while provider call is outstanding — proves the payout is PROCESSING before provider.transfer is allowed to observe the in-flight work; would fail if the worker calls the provider before updating status, leaving created visible during a transfer.
- Duplicate delivery after completion — proves processing a message that is already DONE again does not add ledger entries, change balances, or leave the payout completed more than once; would fail if terminal messages are re-queued or settlement is not idempotent.
- Concurrent duplicate delivery of one pending message — proves two simultaneous processMessages calls for the same payout settle at most once and decrement balances once; would fail if claimMessage lets a second claim succeed after the first sets PROCESSING, or if settlement double-counts.
- Recovery of a stale processing message — proves a PROCESSING message older than the timeout is claimed again and can complete after a successful provider transfer; would fail if the stale query misses old PROCESSING rows or claim does not take ownership of them.
- Concurrent claim of one stale message — proves two workers racing on the same stale PROCESSING row do not both process it; at most one transfer outcome is settled; would fail if claim does not atomically include the stale cutoff, allowing both to claim the same row.
- Transient failure below retry limit — proves a failed provider call returns the message to PENDING with attempts incremented, lastError stored, processingStartedAt cleared, and no SETTLE or RELEASE ledger entry; would fail if the worker treats one transient failure as terminal, releases funds, or leaves the message locked.
- Failure then success within retry limit — proves a payout whose provider attempts fail first and then succeed ends completed with exactly one SETTLE entry and a done message, with attempt accounting reflecting the successful attempt; would fail if retries are abandoned early, attempt count is lost, or settlement happens more than once.
- Retry exhaustion on the last allowed failure — proves when attempts are exhausted the payout becomes needs_review, one RELEASE entry is written, held_amount is decremented but settled_balance unchanged, and the message becomes failed; would fail if exhaustion settles the payout, omits the release ledger entry, or leaves funds held.
- Message already at max attempts — proves a pending message whose attempt count has reached the bound is resolved to needs_review without another provider.transfer call or SETTLE entry; would fail if processOne calls the provider before checking the bound, permitting a late transfer to settle funds.
- Bounded number of provider attempts — proves an always-failing provider with maxAttempts=3 results in needs_review after at most three transfer attempts; would fail if the worker performs a fourth attempt, ignores the counter, or never reaches a terminal state.
- Orphan outbox message — proves a message whose payout no longer exists is marked failed without calling the provider or changing balances; would fail if the worker assumes the payout exists and crashes, settles, or leaves the message pending.
Not testing non-positive amount validation, unknown-account handling, HTTP status/envelope mapping, or definitive provider failure to failed because the plan does not define those contracts for these layers.

Need check if "failure then success ... attempt accounting reflecting successful attempt" may be too implementation-specific but plan says. Good.

Potential problem: "duplicate delivery after completion" line says "or leave the payout completed more than once" awkward. Better: "does not add ledger entries, change balances, or alter the already completed payout". Good.

Potential problem: "Worker status while provider call is outstanding" might require mocking provider to query DB. It's okay.

Potential problem: "Concurrent duplicate delivery of one pending message" with real `processMessages` maybe hard but test can use repo claims. Good.

Need ensure no code words? It's okay. No imports/describe/assertions. Some method names are okay? The user says no imports, no describe, no assertions. Method names are fine? It's a list. Could avoid too many code symbols? But names like provider.transfer okay? It's reference. The shape uses name of test. We can use natural language. But code identifiers may be okay. To be safe, avoid backticks? The final can have plain text. But method names in failure condition helpful. The user didn't forbid identifiers. But "No imports, no describe, no assertions" not "no method names". Fine.

Need maybe include "P2002"? It's code-specific; but failure condition can mention unique constraint. Could say "unique-constraint race". Good.

Need maybe line "Payout status while provider call is outstanding" could be considered implementation detail; but plan ordering rule. Keep.

Need check if all required from task:
1 POST create idempotent and sufficient funds -> duplicate, race, boundary.
2 Async processing message table + polling worker, at-least-once duplicate -> outbox pending, worker success, duplicate done, concurrent duplicate.
3 concurrent no overdraw -> race different keys.
4 lifecycle explicitly -> created state, processing while outstanding, completed/needs_review. Maybe no "failed" not tested.
5 double-entry ledger, settled balance changes only on confirm -> settlement, exhaustion, duplicate no settlement.
6 transient retry bounded and safe -> transient, retry success, exhaustion, max attempts, bounded.
Deliverables tests: concurrent creation against one account (line 3), duplicate message delivery (lines 10/11?), retry exhaustion (lines 15-17). Good.

Need maybe "duplicate message delivery" includes duplicate after done and concurrent pending. Good.

Potential missing: account settled balance changes only when provider confirms transfer. On creation, settled unchanged; on failure transient unchanged; on exhaustion settled unchanged. Covered.

Potential missing: ledger double-entry style? We have HOLD, SETTLE, RELEASE. Good.

Potential missing: `held_amount` invariant? Tests check specific.

Could include "ledger invariants after mixed success/failure"? Maybe not necessary.

Need maybe test "transient failure leaves held funds held" -> line says no release, held? It says no RELEASE; but should also prove held_amount remains increased. Could add: "held_amount remains reserved". Good. Modify line: "... and held_amount remains reserved; would fail if ..." Good.

Need maybe test "success settlement leaves no residual hold" -> line says decrements held once. Good.

Need maybe test "exhaustion release only once" -> one RELEASE.

Need maybe test "duplicate idempotency key after original failed/exhausted"? Could return existing needs_review and not new hold. Our duplicate line says original payout any? It doesn't specify status. Could add "regardless of the original payout's terminal status". Good. Modify: "Retried request with an existing idempotency key (even after completion or needs-review) — proves..." Good.

Need maybe test "insufficient funds due to held_amount" (available = settled - held). Boundary equal/short covers. Could explicitly say available considers held_amount. Good.

Potential issue: "Large minor-unit amount above 2^53" in PostgreSQL BIGINT and Prisma BigInt. If using 9007199254740993, okay. But if response amount string and DB, good.

Need maybe test "amount is integer minor units, not float" with value like 0.5? JSON can't send bigint? Controller validation. Not testing. Large covers float precision.

Need maybe test "concurrent creation same account where both amounts fit"? Should allow both, held total sum. Not required but could be wrong if lock serializes incorrectly rejecting valid requests? A test: two concurrent different keys both fit; both succeed, held total sum. This is a boundary of concurrency: no false insufficient due to stale read. Include? It proves lock doesn't reject valid concurrent fits. Could be branch: if transaction isolation or lock causes second to read stale? With FOR UPDATE, second waits and sees updated held. It should succeed if funds enough. Plan only says two racing must never overdraw; not that both fit must succeed. But good to include? Maybe too many. Could be awkward: serialization may cause one to see insufficient if total fits? Actually correct DB will commit both. Test would fail if implementation uses pessimistic lock but checks before updating? It checks after lock, so okay. If it used optimistic update with WHERE available >= amount, both can succeed. Not likely wrong. But include to avoid over-strict? Maybe not necessary.

Need maybe test "idempotency key duplicate after insufficient funds race"? e.g., same key, one succeeds, other would have been insufficient if first held; loser returns success. Covered by concurrent identical key. If both requests amount > initial available but one? No, same key same amount; if insufficient for one, both should fail unless? If first succeeds means funds sufficient. Fine.

Need maybe test "P2002 conflict where winner has been deleted"? FK? no.

Need maybe test "worker batch does not process FAILED messages" -> duplicate after failure? Could include terminal failed not reprocessed. Similar to done. Maybe line "Duplicate delivery after completion" only DONE. What about FAILED? processMessages candidates pending/stale, so FAILED not included. Could test: a FAILED message is never retried; fail if failed messages are re-queued. This is important for needs_review safe. Include? It is a branch: terminal FAILED. Add line:
- Duplicate delivery after retry exhaustion — proves a FAILED message is not picked up again and does not create another RELEASE or provider transfer; would fail if terminal FAILED is treated as pending/processing.
Good. But maybe too similar. Include because needs-review safe. Add after duplicate done.

Need maybe test "payout needs_review is terminal from worker" same. Good.

Potential line count now ~20. Acceptable.

Need ensure closing line one line. It can mention not testing non-positive etc. Good.

Let's refine final list with concise but detailed lines. Need no numbering? The shape uses dash. Use all dashes for test cases. Closing line maybe no dash. If list only, closing line no dash might break? It's okay. Could make closing line a dash too? "Name what ... in one closing line" maybe can be a bullet. But if it's a dash, looks like another test. To distinguish, no dash. The user says reply with the list and nothing else; a non-bullet closing line is still part of reply. Fine.

Need ensure each test line exactly one line (no wrapping? In final, lines can wrap visually but we can keep one paragraph per line). Use `—` em dash. Good.

Let's check for hidden issue: The implementation worker uses `message.attempts` from candidate row, not re-fetched after claim. For "Message already at max attempts" if status PENDING attempts=3, processOne claims, finds payout, updates PROCESSING, calls provider. If provider succeeds (mock), it will settle, not needs_review. Test would fail. Good.

For "Bounded number of provider attempts" if maxAttempts=3 always failing, implementation total 4. Test fails. Good.

For "Retry then success within retry limit" with maxAttempts=3, provider fails first two succeeds third. Implementation total 3 calls, final done. Attempts remains 2 if not assert attempts. If we assert attempt accounting reflecting successful attempt (attempts=3) fails. Good. But is attempts expected to be 3? Plan says attempts recorded as 3. Yes.

For "Transient failure below retry limit" implementation attempts increments; good. lastError stored; processingStartedAt null; status pending. Good.

For "Duplicate delivery after completion" implementation processMessages doesn't fetch done; if manually call processOne with done message? claimMessage false. If processMessages twice, second no candidates. Good.

For "Duplicate delivery after retry exhaustion" similar.

For "Orphan outbox message" FK? If payout deleted cascade? schema maybe no cascade. But can create orphan via raw SQL? Test may be hard. But branch exists. Include.

Need maybe test "provider throws on every attempt and message already FAILED not reprocessed" covered.

Need maybe test "stale timeout boundary": message at exactly 30s? Could be boundary value. Plan stale timeout 30 seconds. Test: message with processingStartedAt just before cutoff is reclaimed, just after is ignored until timeout. Could include? Boundary values. But time flaky; can use repo.claimStaleMessages with controlled dates. It proves stale selector uses lt/gt correctly. What would break: if cutoff off by one or uses wrong status. Maybe include? The task says process every N seconds, stale not required? Plan has 30s. Could be important. Add line:
- Stale timeout boundary — proves a PROCESSING message started just before the 30-second cutoff is eligible for re-claim while one started after it is not; would fail if the stale query uses the wrong cutoff, comparison, or status.
This is a boundary. Include? It adds implementation detail but plan says 30s. Good. But tests with real time can manipulate DB rows. Include maybe after stale recovery.

Need maybe test "polling interval" not testing. Good.

Need maybe test "batch limit"? Not important.

Potential problem: The plan says stale timeout 30 seconds, worker poll 5s env. Test boundary may require env; not core funds safety. But "boundary values" maybe okay. However too many tests could dilute. But desired oververbosity 9. Let's include maybe not? The user asked one line per case, no limit. I'd include up to 20; stale boundary is a branch that could be wrong independently. Good.

Need maybe test "message claim when already DONE returns false" covered by duplicate done. "claim when FAILED" covered by failed duplicate.

Need maybe test "settlement atomicity if markMessageDone fails"? Hard, not include.

Need maybe test "release atomicity if updatePayoutStatus fails"? Hard.

Need maybe test "account not found"? Not testing closing.

Let's think if any test case is impossible due to layers. "Payout status while provider call is outstanding" can be tested by mock provider that calls repository.findPayoutById. Since test can instantiate service/worker with mock provider and real repo. Good.

"Concurrent duplicate delivery of one pending message" can be tested by calling `worker.processMessages()` concurrently with a mock provider delayed enough. But processMessages fetches pending; both fetch same before claim. Good. If real DB, race. Good.

"Concurrent claim of one stale message" similarly.

Need maybe test "duplicate message delivery after provider timeout but before settle" (crash) not included. Could be funds safety: if provider times out (throws) but actually succeeded, worker will retry and may double transfer. But task says provider may time out; safe? Requirement 6: if exhaust retries without definitive outcome, do safe. It doesn't require handling successful-but-timed-out before exhaustion. Since all errors transient, if first attempt times out but actually sent, retry might send again. But provider SDK no idempotency; safe? Maybe needs_review after exhaustion, but before exhaustion it may double spend. Could we include test for timeout as transient: no funds released, retry occurs. Already transient failure. But duplicate transfer due to unknown outcome not tested. Could be awkward "error path that looks like success": provider times out then next attempt succeeds; should not double settle? It will call transfer twice possibly. But if blockchain provider not idempotent, could double payout. However the plan treats all thrown errors transient and retries; this is a known unsafe assumption? They chose safe only at exhaustion. The task says "if you exhaust retries without a definitive outcome, do something safe and explain why." So before exhaustion, retrying after timeout is accepted. We can test that a timeout (error) does not settle and retries. Good.

Could include "provider timeout is treated as transient, not settled" — but same as transient failure. Could name it to cover requirement: "Timeout or network error is treated as transient" — proves no SETTLE, no RELEASE until retries; would fail if timeout is interpreted as success or immediate failure. Good. Maybe include separate? The task explicitly says provider may time out. We should test. Add line:
- Provider timeout is treated as transient — proves a timed-out transfer does not settle or release funds and leaves the message eligible for another attempt; would fail if a timeout is mapped to success, or funds are released/needs_review before the bounded retry limit.
Good. It overlaps transient but distinct error type.

Need maybe test "provider slow success" — a slow transfer still completes and does not time out in worker; but worker has no timeout. Hard. Not needed.

Need maybe test "amount zero/negative" still? Maybe closing.

Let's consider final line not testing: should include non-positive amount? If we don't test, yes. Also unknown account, HTTP, definitive failed. Good.

Potential issue: "Non-positive amount validation" maybe a funds-safety branch; not testing might be criticized. But plan doesn't define. Could instead include a test for negative amount to be safe. Let's weigh. The task says amounts in minor units; do not use float. It doesn't explicitly say amount must be >0, but payout of negative would be absurd. A robust implementation should validate. The plan says controller validates presence, not positivity. But "zero business logic" in controller still can validate input shape/positivity. The reference controller not shown, so we don't know. If we include, tests may fail if controller not implemented. But the list is to guide tests; failing unimplemented behavior is acceptable? The prompt: "The implementation files shown read-only are what these tests will run against." It might imply tests should be executable and likely pass? Not necessarily. But in a codebase discipline, we shouldn't test unrequested behavior? "Do exactly what task asks." The task didn't ask non-positive validation. So not testing is okay. Closing line can state reason.

Need maybe test "accountId missing/invalid UUID"? Not testing.

Let's ensure final list is not code. It includes method names but okay. Maybe avoid `processMessages`, `provider.transfer`? It's okay. But to be safe, use natural language: "worker polling", "provider transfer". But failure condition can mention specific. The user says no assertions, not no identifiers. I can use lower-level names sparingly.

Need maybe include "InsufficientFundsError code" in boundary line. Good.

Let's draft final with polished lines:

- Retried request with an existing idempotency key — proves the service returns the original payout, including when it is already completed or needs-review, and does not create another payout, HOLD ledger entry, or outbox message; would fail if the duplicate lookup is skipped or the create/hold path runs again for the same key.
- Two racing requests with the same idempotency key — proves exactly one payout and one funds hold exist after both requests, and the losing racer receives the winner rather than an error; would fail if the unique-constraint conflict is not caught and re-fetched, so one request errors or both reserve funds.
- Two racing requests with different keys where only enough available funds exist for one — proves account-row locking prevents overdraw: one payout succeeds, held_amount increases by exactly that amount, and the other gets InsufficientFundsError; would fail if the availability check is not performed under a row lock or uses a stale read.
- Request amount equal to available funds — proves creation succeeds and holds exactly the requested minor units while leaving settled_balance unchanged; would fail if the sufficiency comparison is off by one or the hold increment uses a different value.
- Request amount one minor unit above available funds — proves InsufficientFundsError is thrown before any payout, ledger entry, or outbox message is persisted; would fail if the check is missing, wrong, or writes occur before validation.
- Large minor-unit amount above 2^53 — proves amounts remain exact big integers through database checks and the response amount string; would fail if money is coerced to number/float and precision or inequality breaks.
- Newly created payout and queue message — proves the payout is stored as created with no txHash and exactly one PENDING outbox message exists for it; would fail if the payout starts in a later lifecycle state, txHash is fabricated, or the outbox insert is missing or not pending.
- Successful worker settlement — proves a confirmed transfer records one SETTLE ledger entry, marks the payout completed with the returned txHash, decrements settled_balance and held_amount once, and marks the message done; would fail if any part of that outcome is partial, non-atomic, or lost.
- Payout status while a provider transfer is outstanding — proves the payout is already PROCESSING when the provider call can observe in-flight work; would fail if the worker calls the provider before updating status, leaving created visible during an active transfer.
- Provider timeout is treated as transient — proves a timed-out transfer does not settle or release funds and leaves the message eligible for another bounded attempt; would fail if a timeout is mapped to success, immediate failure, or funds release before the retry limit.
- Duplicate delivery after completion — proves processing a message that is already done again does not add ledger entries, change balances, or alter the completed payout; would fail if terminal done messages are re-queued or settlement is not idempotent.
- Duplicate delivery after retry exhaustion — proves a failed/needs-review message is not picked up again and does not create another release or provider transfer; would fail if terminal failed messages are treated as pending or stale work.
- Concurrent duplicate delivery of one pending message — proves two simultaneous worker polls for the same payout settle at most once and decrement balances once; would fail if claiming a pending message allows a second claim after the first has set it processing, or if settlement double-counts.
- Recovery of a stale processing message — proves a processing message older than the configured timeout is claimed again and can complete after a successful provider transfer; would fail if the stale query misses old processing rows or claim does not take ownership of them.
- Stale timeout boundary — proves a processing message started just before the stale cutoff is eligible for re-claim while one started after it is not; would fail if the cutoff, comparison direction, or status filter is wrong.
- Concurrent claim of one stale message — proves two workers racing on the same stale processing row do not both process it; at most one transfer outcome is settled; would fail if claim does not atomically include the stale cutoff, allowing both to claim the same row.
- Transient failure below retry limit — proves a failed provider call returns the message to pending with attempts incremented, last error stored, processing-started cleared, and held funds still reserved; would fail if the worker treats one transient failure as terminal, releases funds, or leaves the message locked.
- Failure then success within retry limit — proves a payout whose provider attempts fail first and then succeed ends completed with exactly one SETTLE entry and a done message, with attempt accounting reflecting the successful attempt; would fail if retries are abandoned early, attempt count is lost, or settlement happens more than once.
- Retry exhaustion on the last allowed failure — proves when attempts are exhausted the payout becomes needs-review, one RELEASE entry is written, held_amount is decremented but settled_balance unchanged, and the message becomes failed; would fail if exhaustion settles the payout, omits the release ledger entry, or leaves funds held.
- Message already at max attempts — proves a pending message whose attempt count has reached the bound is resolved to needs-review without another provider transfer or SETTLE entry; would fail if the worker calls the provider before checking the bound, permitting a late transfer to settle funds.
- Bounded number of provider attempts — proves an always-failing provider with maxAttempts=3 reaches needs-review after at most three transfer attempts; would fail if the worker performs a fourth attempt, ignores the counter, or never reaches a terminal state.
- Orphan outbox message — proves a message whose payout no longer exists is marked failed without calling the provider or changing balances; would fail if the worker assumes the payout exists and crashes, settles, or leaves the message pending.
Not testing non-positive amount validation, unknown-account handling, HTTP status/error-envelope mapping, or definitive provider failure to a failed payout because the plan does not define those contracts for these layers.

Need check if line "Duplicate delivery after retry exhaustion" says failed/needs-review message; good.

Potential concern: "Stale timeout boundary" with exact cutoff may be flaky and implementation uses `lt: cutoff` (strictly less than). If started exactly at cutoff, not eligible. Test can control dates. It proves boundary; failure if comparison wrong. Good.

Potential concern: "Provider timeout is treated as transient" may overlap with transient failure; but timeout distinct. Good.

Potential concern: "Payout status while provider transfer is outstanding" might
