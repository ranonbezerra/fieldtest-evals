# 13-payout.spec.ts-cases

## reasoning

```
The user wants me to list test cases for `test/payout.spec.ts` based on the PLAN.md and the implementation files shown. I need to:

1. Cover the behaviour the task statement asks to be tested
2. Cover the behaviour the plan says matters
3. One case per branch that could be wrong on its own
4. Say what would have to break for each case to fail
5. Include awkward cases: concurrency, duplicate delivery, exhaustion, boundary values, error path that looks like success
6. Name what I'm deliberately NOT testing and why

Let me look at what the task asks for tests:
- concurrent creation against one account
- duplicate message delivery
- retry exhaustion

And the PLAN.md section 5 lists:
1. Two concurrent POST /payouts for same account with amount > balance/2 → exactly one succeeds, other 422
2. Two concurrent POST /payouts with same (accountId, idempotencyKey) and identical body → both 200, same payout id, one row
3. POST /payouts with same key but different amount → 409 idempotency_conflict
4. Worker picks up pending message, provider succeeds → completed, ledger entry, balance decremented, message done
5. Worker delivers same message twice after provider succeeds → no double ledger entry, balance decremented once
6. Provider throws 3× → needs_review, message done, balance unchanged, no ledger entry
7. Provider throws once then succeeds → completed, correct balance

Now let me think about what branches could be wrong on their own, looking at the implementation:

**Payout creation path:**
- Validation: missing fields → 400 validation_failed
- Validation: amount not a valid integer string → 400
- Validation: amount <= 0 → 400
- Account not found → 404 resource_not_found
- Insufficient funds (balance - reserved < amount) → 422
- Successful creation → returns payout with status 'created'
- Idempotency: same key, same body → returns existing payout (200)
- Idempotency: same key, different body → 409 idempotency_conflict
- Concurrent creation: two racing requests, one succeeds, one gets 422

**Worker path:**
- Happy path: pending message → provider succeeds → completed, ledger posted, balance decremented, message done
- Duplicate delivery: payout already 'completed' → message marked done, no side effects
- Transient failure then success: provider throws once, next tick succeeds → completed
- Retry exhaustion: provider throws MAX_ATTEMPTS times → needs_review, message done, no ledger, no balance change
- Message for non-existent payout → markDone (defensive)

**Boundary values:**
- amount = 0 → validation error
- amount = negative → validation error
- amount exactly equals available funds → should succeed (boundary)
- amount one unit more than available → insufficient_funds

**Idempotency edge cases:**
- Same key, same account, different destinationAddress → 409
- Same key, different account → should be independent (different unique constraint scope)

Wait, let me re-read the implementation more carefully.

Looking at `payout.repository.ts`:
- `createPayoutWithReservation` uses `$queryRaw` with `FOR UPDATE` on the account row
- It computes reserved as sum of payouts with status in ('created', 'processing', 'sent')
- Checks available = balance - reserved
- Creates payout + outbox message in same transaction

Looking at `payout.service.ts`:
- Validates fields
- Parses BigInt
- Calls repo.createPayoutWithReservation
- Catches InsufficientFundsError → 422
- Catches P2002 → fetches existing, compares amount and destinationAddress
- Catches 'Account not found' error string → 404

Looking at `outbox.service.ts`:
- `processMessages` claims pending, iterates
- For each: loads payout, checks terminal state, transitions to processing, calls provider
- Success: updatePayout(completed), confirmPayoutLedger, markDone
- Error: increments attempts, if >= MAX_ATTEMPTS → needs_review + markDone, else recordAttempt

Looking at `outbox.repository.ts`:
- `claimPending` uses FOR UPDATE SKIP LOCKED
- `markDone` is idempotent (WHERE status <> 'done')
- `recordAttempt` resets to 'pending'

Now let me think about what's NOT tested and why:
- The polling timer itself (setInterval) — that's infra, not behaviour
- Prisma connection / migration correctness — that's covered by the schema compiling
- The provider SDK internals — we mock it

Let me also think about what the implementation has that could subtly break:

1. In `outbox.service.ts`, the success path does THREE separate operations without a transaction:
   - `updatePayout(payout.id, 'completed', txHash)`
   - `confirmPayoutLedger(...)` 
   - `markDone(message.id)`
   
   If the process crashes between updatePayout and confirmPayoutLedger, the payout is 'completed' but no ledger entry was posted. The PLAN says "All in a single $transaction" but the implementation doesn't do that! This is a potential bug. However, the test for duplicate delivery should catch this: if we re-process, the payout is already 'completed' so we skip. But the ledger was never posted. Actually wait — if the payout is 'completed' and we re-deliver, we just markDone. The ledger was never posted. That's a data integrity issue. But the test for "duplicate delivery after success" would show that the balance is decremented once — which it would be if confirmPayoutLedger succeeded. The gap is if it crashes between updatePayout and confirmPayoutLedger. That's a crash-recovery test which is hard to unit-test. I'll note this as something not tested.

2. The `confirmPayoutLedger` in the repository does its own `$transaction` (ledger insert + balance update). So the success path in outbox.service is actually:
   - updatePayout (single query)
   - confirmPayoutLedger (its own transaction: ledger insert + balance update)
   - markDone (single query)
   
   These are NOT atomic together. A crash between them could leave inconsistency.

3. In the idempotency check, the service compares `existing.amount === amount` (bigint comparison) and `existing.destinationAddress === dto.destinationAddress`. If both match, it returns the existing payout. This is correct.

4. The `recordAttempt` in outbox.repository sets status back to 'pending' — so the message is eligible for re-claim on next tick. The `nextAttemptAt` is set to null (immediately eligible). There's no backoff. This could be a problem but it's by design per the plan.

Let me now structure my test list:

**Creation / Validation:**
- amount is zero → 400 validation_failed (would fail if the service doesn't reject 0n)
- amount is negative → 400 validation_failed (would fail if BigInt parsing of negative string is allowed through)
- amount is non-numeric string → 400 validation_failed (would fail if BigInt() throw isn't caught)
- missing accountId → 400 validation_failed
- account does not exist → 404 resource_not_found (would fail if the repo doesn't check row count from FOR UPDATE)

**Funds / Concurrency:**
- amount exceeds available (balance - reserved < amount) → 422 insufficient_funds
- Two concurrent requests, each for > balance/2 → exactly one 201, one 422 (would fail if FOR UPDATE isn't used or reservation sum is wrong)
- amount exactly equals available → succeeds (boundary; would fail if the comparison is < instead of <=, or off-by-one)
- Already has a pending payout; new request for remaining balance → succeeds (tests that 'created' status counts as reserved)

**Idempotency:**
- Same (accountId, idempotencyKey), identical body, second call → returns same payout id, no second row (would fail if unique constraint missing or catch doesn't return existing)
- Same (accountId, idempotencyKey), different amount → 409 idempotency_conflict (would fail if service doesn't compare fields)
- Same (accountId, idempotencyKey), different destinationAddress → 409 idempotency_conflict

**Worker happy path:**
- Pending message, provider succeeds → payout 'completed', tx_hash set, ledger entry posted (debit=amount), balance decremented by amount, message 'done' (would fail if any of those steps is missing)

**Worker duplicate delivery:**
- Payout already 'completed', message re-delivered → no second ledger entry, balance unchanged, message stays 'done' (would fail if the terminal-state check is missing)

**Worker transient retry:**
- Provider throws once, then succeeds on second tick → payout eventually 'completed', balance decremented once (would fail if recordAttempt doesn't reset to 'pending')

**Worker retry exhaustion:**
- Provider throws 3 times → payout 'needs_review', message 'done', no ledger entry, balance unchanged (would fail if MAX_ATTEMPTS check is off-by-one or doesn't mark done)

**Worker: message references missing payout:**
- payoutId points to non-existent row → message marked 'done', no crash (would fail if findById null isn't handled)

**What I'm NOT testing:**
- The setInterval timer firing — that's infrastructure, not business logic; the processMessages() method is called directly in tests.
- Prisma migration / schema validity — covered by the build step, not unit tests.
- The provider SDK's internal behaviour — we mock it; we test our handling of its success/failure/timeout.
- Crash-recovery between the three non-atomic steps in the success path (updatePayout → confirmPayoutLedger → markDone) — this requires process-kill simulation which is an integration/chaos test, not a unit test. The at-least-once + idempotent redelivery design mitigates this, but proving it needs a different test harness.

Wait, let me reconsider. The plan says the success path should be "All in a single $transaction" but the implementation doesn't do that. Should I test for that? The task says "tests for: concurrent creation against one account, duplicate message delivery, retry exhaustion." The plan's test section lists 7 tests. I should cover those plus the branches that could be wrong.

Actually, re-reading the rules: "Cover the behaviour the task statement asks to be tested, and the behaviour the plan says matters. A case per branch that could be wrong on its own."

So I need to cover branches. Let me think about what branches exist:

In `payout.service.ts create()`:
- Branch: missing fields → validation error
- Branch: BigInt parse fails → validation error  
- Branch: amount <= 0 → validation error
- Branch: InsufficientFundsError → 422
- Branch: P2002 + same body → return existing
- Branch: P2002 + different body → 409
- Branch: 'Account not found' → 404
- Branch: success → return payout

In `outbox.service.ts processMessage()`:
- Branch: payout is null → markDone
- Branch: payout.status is 'completed' or 'failed' → markDone (idempotent)
- Branch: payout.status is 'created' → transition to 'processing'
- Branch: provider succeeds → completed + ledger + markDone
- Branch: provider throws, attempts < MAX → recordAttempt (retry)
- Branch: provider throws, attempts >= MAX → needs_review + markDone

In `payout.repository.ts createPayoutWithReservation`:
- Branch: account row not found → throw 'Account not found'
- Branch: available < amount → InsufficientFundsError
- Branch: success → insert payout + outbox message

In `outbox.repository.ts claimPending`:
- Branch: no pending messages → return empty array
- Branch: some pending → claim and mark processing

Let me finalize my list. I'll aim for comprehensive but not redundant. Each case should prove something specific and name what breaks.
```

## reply

- **amount is zero → 400 validation_failed** — Proves the service rejects a payout of 0 minor units before it reaches the repository. Fails if the `amount <= 0n` guard is missing or uses `<` instead of `<=`.

- **amount is a negative integer string → 400 validation_failed** — Proves that `BigInt("-5")` is caught by the same `<= 0n` check. Fails if only non-numeric strings are validated but negative numerics slip through.

- **amount is a non-numeric string (e.g. "abc") → 400 validation_failed** — Proves the `BigInt()` throw is caught and mapped to the validation envelope. Fails if the try/catch around BigInt parsing is absent or re-throws.

- **accountId (or destinationAddress / idempotencyKey) is empty string → 400 validation_failed** — Proves the `.trim()` check rejects whitespace-only or missing fields. Fails if the guard only checks for `undefined`/`null` but not empty string.

- **accountId does not exist in accounts table → 404 resource_not_found** — Proves the `FOR UPDATE` SELECT returning zero rows is mapped to a 404 rather than propagating as a 500. Fails if the repository throws a bare `Error('Account not found')` that the service's string-match catch misses (e.g. message wording differs).

- **amount exceeds available funds (balance − reserved < amount) → 422 insufficient_funds** — Proves the reservation arithmetic and the comparison are correct. Fails if the sum of non-terminal payouts is forgotten, or if the comparison is `<=` instead of `<` (allowing an overdraw by one unit).

- **Two concurrent POSTs for the same account, each requesting more than half the balance → exactly one 201, one 422** — Proves the `SELECT … FOR UPDATE` serialises the two transactions so the second sees the first's reservation. Fails if the lock is missing, if it uses `FOR UPDATE` on the wrong table, or if the reservation SUM doesn't include status `'created'` (so both see the full balance).

- **amount exactly equals available funds → 201, payout created** — Proves the boundary: `available < amount` is strictly less-than, so equal passes. Fails if the guard uses `<=`, rejecting a legitimate spend of the entire balance.

- **Account already has a pending (status='created') payout; new request for the remaining balance → 201** — Proves that `'created'` is included in the reserved-sum filter. Fails if the WHERE clause omits `'created'` and only counts `'processing'`/`'sent'`, letting the second request see stale available funds.

- **Retry of same (accountId, idempotencyKey) with identical amount and destinationAddress → 200, same payout id, exactly one row in payouts** — Proves the P2002 catch fetches the existing row, compares fields, and returns it without inserting a second payout or reserving funds twice. Fails if the unique index is missing, if the catch doesn't compare and always throws 409, or if it re-inserts instead of returning the existing row.

- **Same (accountId, idempotencyKey) but different amount → 409 idempotency_conflict** — Proves the field comparison rejects a mismatched body. Fails if the service only checks key existence and returns 200 regardless of body, silently accepting a different amount.

- **Same (accountId, idempotencyKey) but different destinationAddress → 409 idempotency_conflict** — Proves the comparison covers both amount and destination, not just amount. Fails if only `amount` is compared and a changed address is silently accepted.

- **Worker: pending message, provider.transfer resolves with txHash → payout 'completed' with tx_hash set, one ledger entry (debit=amount), account balance decremented by amount, message 'done'** — Proves the full happy-path chain. Fails if any of the four side-effects (status update, txHash write, ledger insert, balance decrement) is missing or the message is not marked done.

- **Worker: payout already 'completed', same message delivered again → no second ledger entry, balance unchanged, message remains 'done'** — Proves the terminal-state early-return prevents double-posting under at-least-once redelivery. Fails if the `payout.status === 'completed'` guard is missing, or if `markDone` is not idempotent and the second pass re-enters the provider call.

- **Worker: provider throws once (attempts becomes 1), then succeeds on the next tick → payout eventually 'completed', balance decremented exactly once, one ledger entry** — Proves `recordAttempt` resets status to `'pending'` so the message is re-claimed, and that the success path runs exactly once. Fails if `recordAttempt` leaves status as `'processing'` (message never re-claimed), or if the retry path also posts a ledger entry.

- **Worker: provider throws on all 3 attempts → payout 'needs_review', message 'done', zero ledger entries, balance unchanged** — Proves the exhaustion branch halts safely. Fails if `MAX_ATTEMPTS` is off-by-one (e.g. 4 instead of 3, or the check is `>` instead of `>=`), if the payout is left in 'processing' instead of 'needs_review', or if a ledger entry is posted on the last failed attempt.

- **Worker: message.payoutId references a non-existent payout row → message marked 'done', no exception propagates** — Proves the `findById` null check is present. Fails if the code dereferences `payout.status` on `null`, crashing the tick and blocking subsequent messages in the batch.

- **Worker: two pending messages are claimed in one tick; first succeeds, second causes provider to throw → both are processed independently (first 'completed', second retried or exhausted)** — Proves the per-message try/catch in `processMessages` isolates failures so one bad message doesn't abort the rest of the batch. Fails if a thrown error in `processMessage` propagates out of the for-loop and skips remaining messages.

**Not testing:** the `setInterval`/timer mechanics (infrastructure; tests call `processMessages()` directly), Prisma migration/schema validity (build-time, not unit-testable here), the provider SDK's own timeout/retry behaviour (mocked; we test *our* handling of its resolved/rejected promises), and crash-recovery between the three non-atomic steps in the success path (`updatePayout` → `confirmPayoutLedger` → `markDone`) — that requires process-kill or connection-drop simulation, which is an integration/chaos test outside this spec's scope; the at-least-once + idempotent-redelivery design is the mitigation, proven by the duplicate-delivery case above.
