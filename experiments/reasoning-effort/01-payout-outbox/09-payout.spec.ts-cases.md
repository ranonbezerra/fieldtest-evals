# 09-payout.spec.ts-cases@medium

## reasoning

```
The user wants me to list the test cases for `test/payout.spec.ts` based on the PLAN.md and the implementation files provided. I need to cover the behaviour the task statement asks to be tested, and the behaviour the plan says matters. Let me go through the plan's test section (§5) and the implementation to identify all branches that could be wrong.

From PLAN.md §5:
1. Two concurrent `createPayout` calls for the same account where only enough funds exist for one
2. Two `createPayout` calls with the same `idempotencyKey`
3. Worker processes a message whose provider succeeds
4. Worker processes a message whose provider throws on every attempt (attempts = maxAttempts)
5. Worker sees the same message twice (simulated by calling `processMessages` with a message already in `done`)
6. Provider throws on attempt 1 and 2, succeeds on attempt 3 (maxAttempts = 3)

Now let me think about what other branches could be wrong based on the implementation:

From `payout.service.ts`:
- Idempotency fast path: `findPayoutByIdempotencyKey` returns existing → return it (no second create)
- Unique constraint violation (P2002) on idempotency key → re-fetch and return existing
- Non-P2002 error (e.g., InsufficientFundsError) → re-thrown
- P2002 but the re-fetch returns null (practically unreachable) → re-thrown

From `payout.repository.ts`:
- `createPayoutWithHold`: available < amount → InsufficientFundsError
- `createPayoutWithHold`: available >= amount → holds funds, creates payout + ledger + outbox
- `claimMessage`: conditional update WHERE status IN (PENDING, PROCESSING) → returns false if already claimed
- `settleLedger`: creates SETTLE entry, decrements both settledBalance and heldAmount
- `releaseHold`: creates RELEASE entry, decrements heldAmount only

From `payout-worker.service.ts`:
- `processMessages`: fetches pending + stale, claims each, processes
- Claim fails (another worker got it) → skip
- Payout not found → markMessageFailed
- Provider success → settleLedger + updatePayoutStatus(COMPLETED) + markMessageDone in one tx
- Provider error, attempts < maxAttempts → incrementAttempts (reset to PENDING)
- Provider error, attempts >= maxAttempts → releaseHold + updatePayoutStatus(NEEDS_REVIEW) + markMessageFailed in one tx

Let me think about boundary cases:
- attempts exactly at maxAttempts (the boundary between retry and exhaust)
- amount = 0? (probably not meaningful)
- amount exactly equal to available funds (boundary for overdraw)

Let me also think about what the controller does:
- Missing fields → 400
- InsufficientFundsError → 422
- Success → 201 (or 200 for duplicate)

Wait, the plan says "Returns 200 OK with the existing payout body" for duplicates and "Return 201 with the new payout" for new creation. But looking at the controller description in the plan: "Validates presence of all four fields; delegates to PayoutService.createPayout. Returns 400 on missing fields, 422 on InsufficientFundsError."

The controller doesn't distinguish between new (201) and duplicate (200) in the plan text. Let me re-read... Actually the plan says in assumptions: "Idempotent duplicate response status | 200 OK with the existing payout body". And in control flow: "Return 201 with the new payout" and "Return 200" for duplicate. So the service needs to signal which it was, or the controller always returns 201? Looking at the service, it just returns a PayoutResponse either way. The controller would need to distinguish. But actually, looking more carefully at the plan, it says the service returns PayoutResponse in both cases. The controller might just always return 201, or it might need a way to distinguish. This is an implementation detail.

Actually, for the test list, I should focus on what's testable at the service/worker level (since the tests are in `test/payout.spec.ts` and test behaviour). Let me structure this properly.

Let me also consider:
- What happens if the account doesn't exist? (findUniqueOrThrow would throw a different error)
- The stale message recovery path

Let me now write the list:

1. **Concurrent overdraw prevention** — Two simultaneous createPayout calls against an account with exactly enough funds for one. Proves: exactly one succeeds, the other gets InsufficientFundsError. Would fail if: the FOR UPDATE lock is missing or the available check isn't inside the transaction, allowing both to pass the check before either increments heldAmount.

2. **Idempotency fast path** — A second createPayout with the same idempotencyKey returns the existing payout without creating a new one. Proves: no second row in payouts, no second HOLD entry, heldAmount incremented only once. Would fail if: the fast-path check is skipped, or the re-fetch after P2002 doesn't return the original payout.

3. **Idempotency race (unique constraint)** — Two concurrent createPayout calls with the same idempotencyKey where both pass the fast-path miss. Proves: one gets 201, the other catches P2002 and re-fetches to return the winner's payout; only one payout row and one hold exist. Would fail if: the P2002 catch is missing or misidentified, causing a 500 instead of returning the existing payout.

4. **Insufficient funds at boundary** — createPayout where amount exactly equals available funds. Proves: succeeds, heldAmount = settledBalance, available becomes 0. Would fail if: the comparison uses `<` vs `<=` incorrectly, or the subtraction overflows.

5. **Insufficient funds rejection** — createPayout where amount exceeds available funds by 1 minor unit. Proves: InsufficientFundsError is thrown, no payout row created, no ledger entry, no outbox message, heldAmount unchanged. Would fail if: the check is absent or the transaction partially commits (e.g., payout inserted but funds not held).

6. **Worker: provider success** — processMessages with a pending message, provider.transfer resolves. Proves: payout status → COMPLETED, txHash set, SETTLE ledger entry created, settledBalance and heldAmount both decremented by amount, message status → DONE. Would fail if: the settle transaction is not atomic (e.g., ledger entry written but account update fails), or status transitions out of order.

7. **Worker: provider transient failure then success** — Provider throws on attempts 1 and 2, succeeds on attempt 3 (maxAttempts=3). Proves: after 3 processMessages calls, payout → COMPLETED, message → DONE, attempts = 3. Would fail if: the retry counter doesn't increment, or the message isn't reset to PENDING after a failed attempt so it's never re-claimed.

8. **Worker: retry exhaustion → needs_review** — Provider throws on all attempts (attempts reaches maxAttempts). Proves: payout → NEEDS_REVIEW, RELEASE ledger entry created, heldAmount decremented (funds returned to available), settledBalance unchanged, message → FAILED. Would fail if: the exhaustion branch calls settleLedger instead of releaseHold, or the status is set to COMPLETED/FAILED instead of NEEDS_REVIEW.

9. **Worker: duplicate delivery (already done)** — processMessages called again after a message is already DONE. Proves: no second SETTLE entry, no double decrement of balances, payout status unchanged. Would fail if: the claim doesn't check status (a DONE message gets re-processed), or the settle logic isn't idempotent.

10. **Worker: duplicate delivery (already processing by another)** — Two workers claim the same message simultaneously. Proves: only one succeeds at the conditional UPDATE, the other gets count=0 and skips. Would fail if: claimMessage uses an unconditional update or a read-then-write pattern instead of a conditional WHERE.

11. **Worker: stale message recovery** — A message stuck in PROCESSING with processingStartedAt older than 30s is picked up and re-processed. Proves: the stale message is included in candidates, claimed successfully, and processed to completion. Would fail if: claimStaleMessages doesn't filter on the timestamp, or claimMessage doesn't accept PROCESSING status (only PENDING).

12. **Worker: payout not found** — A message references a payout that doesn't exist (orphaned). Proves: message → FAILED with error, no crash, no state change on account. Would fail if: the worker throws an unhandled exception or attempts to settle against a missing account.

13. **Ledger invariant after full lifecycle** — After create (HOLD) → settle (SETTLE), the account's heldAmount is 0 and settledBalance is decremented by the payout amount; ledger has exactly one HOLD and one SETTLE for that payout. Proves: the double-entry bookkeeping is consistent. Would fail if: settleLedger only decrements one of the two balance columns, or the ledger entry type is wrong.

14. **Ledger invariant after release** — After create (HOLD) → release (RELEASE), heldAmount is back to 0, settledBalance unchanged; ledger has one HOLD and one RELEASE. Proves: the "safe" path on retry exhaustion returns funds without losing them. Would fail if: releaseHold also decrements settledBalance (double-decrement), or doesn't create the RELEASE entry.

Now, what am I deliberately NOT testing?
- The HTTP layer (controller validation, status codes 400/422) — those are thin pass-throughs; the service and worker hold the logic. Actually wait, the plan does mention 400 for missing fields and 422 for InsufficientFundsError. But the task says tests are in `test/payout.spec.ts` and the plan's test section doesn't list controller-level tests. I'll note this.
- The polling interval / timer mechanics (setInterval firing) — that's infrastructure, not behaviour.
- The actual blockchain provider interaction — we mock it.

Let me refine and format these properly. I want one line per case in the specified shape.
```

## reply

- **concurrent overdraw: two racing payouts, funds for one** — Exactly one `createPayout` succeeds and the other rejects with `InsufficientFundsError`; no double-hold. Would fail if the `FOR UPDATE` row lock is missing, the availability check is outside the transaction, or `heldAmount` increment uses a read-modify-write instead of an atomic `increment`.

- **idempotency fast-path: duplicate key returns existing payout** — A second `createPayout` with the same `idempotencyKey` returns the original payout id and does not create a second row, HOLD entry, or outbox message; `heldAmount` is incremented only once. Would fail if the fast-path `findPayoutByIdempotencyKey` check is absent or the service falls through to `createPayoutWithHold`.

- **idempotency race: P2002 on concurrent insert** — Two concurrent `createPayout` calls with the same key both miss the fast-path; one wins the insert, the other catches P2002 and re-fetches to return the winner's payout. Only one payout row and one hold exist in the end. Would fail if `isIdempotencyKeyConflict` misidentifies the error code, the catch block is missing, or the re-fetch returns null and re-throws as a 500.

- **insufficient funds: amount exceeds available by one minor unit** — `createPayout` throws `InsufficientFundsError`; no payout row, no ledger entry, no outbox message is persisted; `heldAmount` and `settledBalance` are unchanged. Would fail if the availability check is omitted, uses `<=` instead of `<`, or the transaction partially commits (payout inserted before the balance check).

- **boundary: amount exactly equals available funds** — `createPayout` succeeds; `heldAmount` becomes equal to `settledBalance`, leaving zero available. Would fail if the comparison is inverted or a 1-unit off-by-one in the subtraction rejects an exactly-sufficient request.

- **worker success: provider resolves, settlement is atomic** — After `processMessages`, the payout status is `COMPLETED` with `txHash` set, a `SETTLE` ledger entry exists, both `settledBalance` and `heldAmount` are decremented by the amount, and the message is `DONE`. Would fail if `settleLedger` + `updatePayoutStatus` + `markMessageDone` are not in one transaction (partial settlement on crash), or `settleLedger` only decrements one balance column.

- **worker retry: transient failures then success on final attempt** — Provider throws on attempts 1 and 2, resolves on attempt 3 (`maxAttempts = 3`); after three `processMessages` invocations the payout is `COMPLETED`, message is `DONE`, and `attempts = 3`. Would fail if `incrementAttempts` doesn't reset status to `PENDING`, the `attempts` counter isn't incremented, or the worker skips the message after a failed claim instead of re-queueing it.

- **worker exhaustion: retries spent, no definitive outcome** — Provider throws on every attempt up to `maxAttempts`; the payout transitions to `NEEDS_REVIEW`, a `RELEASE` ledger entry is written, `heldAmount` is decremented (funds returned to the account's available), `settledBalance` is unchanged, and the message is `FAILED`. Would fail if the exhaustion branch calls `settleLedger` instead of `releaseHold`, sets status to `COMPLETED` or `FAILED`, or the release+status+mark-transaction is split across separate commits.

- **duplicate delivery: message already DONE is not re-settled** — Calling `processMessages` a second time after a message reached `DONE` produces no additional `SETTLE` ledger entry, no further balance change, and the payout status remains `COMPLETED`. Would fail if `claimMessage` accepts `DONE` as a claimable status, or the settlement logic is not guarded by the claim's conditional update.

- **duplicate delivery: two workers race on the same PENDING message** — Two concurrent `processMessages` calls both see the same pending message; exactly one wins `claimMessage` (conditional `WHERE status IN (PENDING, PROCESSING)`) and processes it; the other gets `count = 0` and skips. The provider is called exactly once. Would fail if `claimMessage` uses a read-then-write pattern, an unconditional update, or only checks `PENDING` without `PROCESSING`.

- **stale recovery: PROCESSING message older than timeout is reclaimed** — A message stuck in `PROCESSING` with `processingStartedAt` 31 s in the past is picked up by `claimStaleMessages`, re-claimed via `claimMessage`, and processed to completion. Would fail if `claimStaleMessages` doesn't filter on the timestamp, `claimMessage` rejects a message already in `PROCESSING`, or the stale query is absent from the candidate fetch.

- **orphaned message: payout row missing** — A message references a `payoutId` that has no corresponding payout row; the worker marks the message `FAILED` with an error string and does not crash or mutate any account balance. Would fail if the worker throws an unhandled exception on `findPayoutById` returning null, or attempts to settle/release against a missing account.

- **ledger invariant: HOLD → SETTLE lifecycle is balanced** — After creation and successful settlement, the account has exactly one `HOLD` and one `SETTLE` entry for that payout, `heldAmount = 0`, and `settledBalance` is decremented by the payout amount. Would fail if `settleLedger` omits the `SETTLE` entry, writes the wrong sign/type, or decrements `settledBalance` without also clearing the hold.

- **ledger invariant: HOLD → RELEASE lifecycle returns funds** — After creation and retry-exhaustion release, the account has one `HOLD` and one `RELEASE` entry, `heldAmount = 0`, and `settledBalance` is unchanged from before the payout was created. Would fail if `releaseHold` also decrements `settledBalance` (double-spend), skips the `RELEASE` entry, or forgets to decrement `heldAmount`.

Deliberately not testing: HTTP controller status codes (400 / 422) and body validation — those are thin pass-throughs over the service errors already exercised here; the polling timer mechanics (`setInterval` firing cadence) — that is runtime infrastructure, not a correctness property; and the real blockchain provider SDK — we stub `TransferProvider` and test only our own retry/state logic around it.
