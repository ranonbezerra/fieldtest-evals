# 05-payout.service.ts

## reasoning

```
Let me carefully analyze what's needed for `src/payout/payout.service.ts` based on PLAN.md.

From the plan:

```ts
export class PayoutError extends Error {
  readonly code: string;
  constructor(code: string, message: string, details?: Record<string, unknown>);
}

export class InsufficientFundsError extends PayoutError {}   // code: "insufficient_funds"
export class DuplicatePayoutError extends PayoutError {}     // code: "duplicate_payout"
export class PayoutNotFoundError extends PayoutError {}      // code: "resource_not_found"

@Injectable()
export class PayoutService {
  constructor(repo: PayoutRepository, provider: PayoutProvider);

  // Creates a payout + outbox message in one transaction.
  // Throws InsufficientFundsError if available < amount.
  // Throws DuplicatePayoutError if (accountId, idempotencyKey) already exists.
  createPayout(input: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<{ payoutId: string }>;

  // Called by the worker for each claimed message.
  // Handles retry, status transitions, ledger posting.
  processMessage(messageId: string): Promise<void>;
}
```

Next, the `processMessage` flow (from §4 of the plan):
1. Load the message by id. If status is DONE or DEAD, return (idempotent no-op against duplicate delivery).
2. If status is not PROCESSING, claim it (step 2 above). If claim returns null, return.
3. Load the associated payout. If payout status is not CREATED or PROCESSING, return (already processed).
4. Mark the payout as PROCESSING.
5. Call `provider.transfer(destinationAddress, amount)`.
   - **Success**: call `completePayout(payoutId, txHash)`. Done.
   - **Failure**: record the attempt (`recordAttemptFailure`). If `attempts < PAYOUT_MAX_ATTEMPTS`, leave the message as PROCESSING (it will be reclaimed by subsequent polls after timeout/reclaim, or the worker can reset it to PENDING for retry). If `attempts >= PAYOUT_MAX_ATTEMPTS`:
     - If the error is a **definitive failure** (e.g., invalid address, provider 4xx): call `failPayout`.
     - If the error is **ambiguous** (timeout, 5xx, network error): call `markNeedsReview`.

Retry mechanism: after a failed attempt where retries remain, the message status is reset to PENDING (via `recordAttemptFailure` or a separate repository call), so that the next poll picks it up again. The `attempts` counter on the message tracks how many times it has been processed.

Hmm, there's a slight contradiction in the plan: step 5 of `processMessage` says "leave the message as PROCESSING (it will be reclaimed by subsequent polls after timeout/reclaim, or the worker can reset it to PENDING for retry)", but the "Retry mechanism" section says "after a failed attempt where retries remain, the message status is reset to PENDING (via `recordAttemptFailure` or a separate repository call), so that the next poll picks it up again."

The repository API in the plan doesn't have a method to reset the message to PENDING. Let me check the repository reference file shown:

The repository has:
- `createPayoutWithMessage`
- `claimMessage(messageId)` — claims a PENDING message, sets to PROCESSING, increments attempts
- `markProcessing(payoutId)`
- `recordAttemptFailure(payoutId, error)` — increments payout.attempts, sets lastError
- `completePayout(payoutId, txHash)`
- `failPayout(payoutId)`
- `markNeedsReview(payoutId)`
- `findPendingMessages(limit)`
- `findMessageById(id)`
- `findPayoutByAccountIdemKey(accountId, idempotencyKey)`

So there's no `resetToPending` method. The plan says "the message status is reset to PENDING (via `recordAttemptFailure` or a separate repository call)". Hmm. But `recordAttemptFailure` in the reference file only updates the payout, not the message.

Wait — the instructions say: "Files shown read-only are references. Rely on them; do not restate or rewrite them." So the repository is as shown. The service can only call methods that exist on the shown repository.

So how does retry work with the given repository? Let me think:

- `claimMessage` only claims messages with status PENDING.
- After a failed attempt where retries remain, the message is left as PROCESSING (per step 5 of the plan) — "it will be reclaimed by subsequent polls after timeout/reclaim, or the worker can reset it to PENDING for retry."

But the plan also says "after a failed attempt where retries remain, the message status is reset to PENDING (via `recordAttemptFailure` or a separate repository call), so that the next poll picks it up again."

Hmm, these two statements contradict each other. The repository as shown has no method to reset the message to PENDING. So the service cannot reset it.

Wait, but the tests in §5 of the plan include: "Transient failure then success: provider fails once (timeout), succeeds on second attempt; payout is COMPLETED with ledger entry; message's `attempts` is 2."

For this to work, after the first failed attempt, the message must become claimable again. If the service leaves it as PROCESSING, then `claimMessage` returns null for it (since status !== PENDING), and the second attempt never happens... unless the test calls `processMessage` again, in which case step 1: load message; status is PROCESSING (not DONE/DEAD), so continue; step 2: "if status is not PROCESSING, claim it" — the status IS PROCESSING, so skip the claim; step 3: load payout; status is PROCESSING (marked in step 4 of the first run), which is in {CREATED, PROCESSING}, so continue; step 4: mark as PROCESSING again (no-op); step 5: call provider again.

So in fact, if the test calls `processMessage(messageId)` twice, the second call will reprocess even though the message is PROCESSING. This works with the shown repository! The flow of `processMessage` handles re-entry for PROCESSING messages.

So the design is: after a failed attempt where retries remain, leave the message as PROCESSING and record the failure on the payout. The test (or worker) calls `processMessage` again, which re-enters and retries. The message's `attempts` counter only increments on claim (PENDING → PROCESSING).

Hmm wait, but then the test "message's `attempts` is 2" — the message's attempts only increments on claim. If the test calls `processMessage` twice and the first call claims (PENDING → PROCESSING, attempts 0→1), then the second call sees PROCESSING and doesn't re-claim (attempts stays 1). So message.attempts would be 1, not 2.

Hmm. Unless the test itself resets... no, the test shouldn't touch internals beyond the service API.

Alternatively, maybe the intended behavior is: after a failed attempt where retries remain, the service resets the message to PENDING so that the next `processMessage` call (or worker poll) re-claims it, incrementing attempts. But the shown repository has no such method.

Let me re-read: "Retry mechanism: after a failed attempt where retries remain, the message status is reset to PENDING (via `recordAttemptFailure` or a separate repository call), so that the next poll picks it up again. The `attempts` counter on the message tracks how many times it has been processed."

"via `recordAttemptFailure` or a separate repository call" — the reference implementation of `recordAttemptFailure` only updates the payout. So "a separate repository call" would need a method that doesn't exist in the reference file.

Hmm, this is a genuine gap. The instructions say: "If a symbol you need is truly missing from both the plan and references, do not silently guess or work around it: write the file using the most defensible reading and mark it with a single `// ASSUMPTION: <what was unresolved>` comment at the point where it matters."

Wait, but actually — is it missing? The plan's repository spec (§3) lists the repository methods and doesn't include a reset method. The reference file matches that spec. So the plan itself is slightly self-contradictory between §4's "Retry mechanism" paragraph and the rest.

Most defensible reading: the service should work with the repository API as shown. The `processMessage` flow in §4 (the numbered steps) is the primary spec, and it says: "If `attempts < PAYOUT_MAX_ATTEMPTS`, leave the message as PROCESSING (it will be reclaimed by subsequent polls after timeout/reclaim, or the worker can reset it to PENDING for retry)."

So step 5 of the numbered flow explicitly says "leave the message as PROCESSING." The later "Retry mechanism" paragraph contradicts it, but the numbered flow is more specific and consistent with the shown repository API. Also, the duplicate-delivery handling in step 1 only no-ops on DONE/DEAD, so PROCESSING messages are reprocessable — this is what makes retry work when `processMessage` is called again.

Actually wait, let me reconsider. Which attempts counter gates the retry? Step 5 says: "record the attempt (`recordAttemptFailure`). If `attempts < PAYOUT_MAX_ATTEMPTS`..." — whose attempts? `recordAttemptFailure` increments the payout's attempts. So presumably the payout's attempts after increment. Or the message's attempts?

The message's attempts increments on claim. The payout's attempts increments on `recordAttemptFailure`. If we gate on the message's attempts: first claim → message.attempts = 1. First provider failure → recordAttemptFailure (payout.attempts = 1). Check: message.attempts (1) < MAX (3)? Yes → leave as PROCESSING. Second `processMessage` call: sees PROCESSING, no re-claim, provider fails again → payout.attempts = 2. Check message.attempts (1) < 3 → retry again. Third call: provider fails → payout.attempts = 3, message.attempts still 1 < 3 → leave as PROCESSING. Fourth call: provider fails → payout.attempts = 4, message.attempts 1 < 3 → retry... infinite! The message's attempts never increments because re-claims don't happen.

So gating on the message's attempts with "leave as PROCESSING" breaks retry exhaustion — it never exhausts. Unless the test resets the message to PENDING between attempts (which it shouldn't, since the test should test behavior through the service API).

Therefore, for retry exhaustion to work with repeated `processMessage` calls, the gating counter must be the payout's attempts (which increments on each failed attempt via `recordAttemptFailure`).

Let me verify with the test: "Retry exhaustion with definitive failure: provider throws a non-timeout error on every attempt; after `PAYOUT_MAX_ATTEMPTS` calls, payout is FAILED..." With MAX=3:
- Call 1: claim (msg attempts 1), mark PROCESSING, transfer fails → recordAttemptFailure (payout.attempts=1). 1 < 3 → leave as PROCESSING.
- Call 2: re-enter (PROCESSING), transfer fails → payout.attempts=2. 2 < 3 → leave as PROCESSING.
- Call 3: re-enter, transfer fails → payout.attempts=3. 3 >= 3 → definitive → failPayout. ✓ "after PAYOUT_MAX_ATTEMPTS calls, payout is FAILED" — 3 calls, 3 provider invocations.

And "Transient failure then success": Call 1: fails (payout.attempts=1, 1<3, leave as PROCESSING). Call 2: succeeds → completePayout. ✓ Provider called twice. "message's attempts is 2" — hmm, with this flow message.attempts = 1 (claimed only once). The test expects 2.

Hmm. So the test expectation "message's attempts is 2" contradicts "leave as PROCESSING." Unless... the intended flow is to reset to PENDING after a failed attempt, and the next `processMessage` call re-claims (attempts 1→2). Then:
- Call 1: claim (msg attempts 1), fail → reset to PENDING.
- Call 2: claim (msg attempts 2), success. message.attempts = 2 ✓.

And retry exhaustion:
- Call 1: claim (msg attempts 1), fail → payout.attempts=1, reset to PENDING.
- Call 2: claim (msg attempts 2), fail → payout.attempts=2, reset to PENDING.
- Call 3: claim (msg attempts 3), fail → payout.attempts=3 >= MAX → failPayout. ✓

Both work with reset-to-PENDING, and the message.attempts test expectation is also satisfied. But the shown repository has no reset method!

Hmm, wait. Let me re-read `claimMessage` in the reference: "if (!message || message.status !== MessageStatus.PENDING) return null". So it only claims PENDING.

Is there any way for the service to reset a message to PENDING using only the shown repository methods? No. `recordAttemptFailure` only touches the payout.

So there's a genuine gap: the plan §4 "Retry mechanism" says to reset to PENDING, but no repository method exists for that. The instructions say to mark with `// ASSUMPTION:` if a symbol is truly missing from both the plan and references.

Hmm, but wait — is it truly missing from the plan? The plan §3 repository spec enumerates methods and doesn't include a reset. The "Retry mechanism" paragraph says "(via `recordAttemptFailure` or a separate repository call)". So the plan contemplates that reset happens via `recordAttemptFailure` (which in the reference implementation doesn't do that) or a separate repository call (not enumerated).

Options:
1. Leave the message as PROCESSING and gate retries on payout.attempts. Retry exhaustion works; duplicate delivery works; but message.attempts stays at 1 in the transient-then-success scenario (test expectation "message's attempts is 2" fails — but that's a test file issue, not this file; still, the plan is my spec and I should implement what the plan specifies).

2. Call a non-existent repository method like `repo.resetMessageToPending(messageId)` with an ASSUMPTION comment.

Hmm. The instructions: "If a symbol you need is truly missing from both the plan and references, do not silently guess or work around it: write the file using the most defensible reading and mark it with a single `// ASSUMPTION: <what was unresolved>` comment at the point where it matters."

"Most defensible reading" — I think the most defensible reading is to follow the numbered `processMessage` flow in §4, which is the detailed spec and is self-consistent with the shown repository API: leave the message as PROCESSING after a failed attempt where retries remain, gate on payout.attempts. The "Retry mechanism" paragraph is a loose summary that contradicts; the numbered flow + repository API are concrete and mutually consistent.

But wait — does leaving as PROCESSING break "duplicate message delivery" safety? The test: "call `processMessage` twice on the same message id; provider's `transfer` is called exactly once." Flow: Call 1: claim PENDING→PROCESSING, transfer succeeds → completePayout (message DONE). Call 2: load message; status DONE → return no-op. Provider called once ✓.

What if the provider succeeds but the message is still PROCESSING (crash between transfer and completePayout)? Call 2: status PROCESSING → re-enter → payout status is... let me check step 3: "load the associated payout. If payout status is not CREATED or PROCESSING, return (already processed)." In the crash scenario, payout is PROCESSING (marked in step 4 before transfer). So re-entry would call the provider again — double transfer! But that's inherent to at-least-once and the plan acknowledges it: "at-least-once is required and idempotency must be enforced downstream." The provider/chain would presumably dedupe or this is accepted. Not my concern for this file.

Now, the SENT state: the plan says "SENT: set when the provider returns a `txHash` (transfer confirmed on-chain)" and "COMPLETED: set immediately after SENT in the same transaction that posts the ledger entry. In practice SENT and COMPLETED are set together." The repository's `completePayout` sets status directly to COMPLETED (as shown in the reference). So the service doesn't separately set SENT — the repository handles it. Fine, the service just calls `completePayout`.

Now, how does the service distinguish definitive vs ambiguous errors? The provider interface just says "throws on transient or permanent failure; the caller distinguishes by error shape." The plan says: "If the error is a **definitive failure** (e.g., invalid address, provider 4xx): call `failPayout`. If the error is **ambiguous** (timeout, 5xx, network error): call `markNeedsReview`."

The provider file comment: "an ambiguous failure (e.g. timeout) means the transfer may have landed on-chain and funds must remain reserved, while a definitive failure (e.g. invalid destination address) means it did not."

So the service needs a way to classify errors. No shared error type is defined in the plan or references for provider errors. So I need to define a classification heuristic in the service. Most defensible: check error message/shape for timeout indicators → ambiguous; otherwise... hmm, which is the default?

Safety principle: when in doubt, treat as ambiguous (NEEDS_REVIEW), because treating a landed transfer as failed would double-spend on retry... wait, actually no — `failPayout` releases the reservation and marks DONE; the message is done, no retry. If the transfer actually landed but we marked FAILED and released funds, the seller got paid AND the account retains... no wait, `failPayout` doesn't post a ledger entry and releases the reservation — meaning the account's available funds go back up, but the money actually left. That's a loss for the platform (double payment capability). So defaulting to ambiguous/NEEDS_REVIEW on unknown errors is the safe choice.

How to detect "definitive"? Common approach: the provider error has a property like `code` or `status` (4xx = definitive, 5xx/timeout = ambiguous). Since the SDK is out of scope and the test fake throws errors, the most defensible reading: treat errors whose message or code indicates a timeout as ambiguous; also treat unknown/unknown-shape errors as ambiguous (safe default); only treat errors explicitly marked as definitive (e.g., `error.definitive === true`, or a 4xx status) as definitive.

Hmm, but the test "Retry exhaustion with definitive failure: provider throws a non-timeout error on every attempt" — so in the test, a plain non-timeout error (e.g., `new Error('invalid address')`) must be classified as definitive. So the heuristic can't be "unknown → ambiguous" — a plain `Error('...')` must be definitive per the test.

So the classification is: if the error looks like a timeout (message contains "timeout" / "timed out", or has a timeout marker) → ambiguous; otherwise → definitive. Let me design:

```ts
function isAmbiguousFailure(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes('timeout') || message.includes('timed out')) return true;
    // Provider may mark timeouts explicitly.
    const anyError = error as Error & { code?: string; name?: string };
    if (anyError.name === 'TimeoutError' || anyError.code === 'ETIMEDOUT') return true;
  }
  return false;
}
```

So: timeout-like → ambiguous → NEEDS_REVIEW on exhaustion. Everything else → definitive → FAILED on exhaustion. This matches the tests: "provider throws a timeout error" → NEEDS_REVIEW; "provider throws a non-timeout error" → FAILED.

And the safe default question: unknown errors (non-timeout) are treated as definitive. Is that safe? The plan's test spec requires a non-timeout error → FAILED, so yes, per the plan. The plan's assumption says: "if the provider throws a non-timeout error (definitive failure), payout is `failed`; if it times out or throws ambiguously and attempts are exhausted, payout is `needs-review`." So the plan explicitly defines: non-timeout = definitive. Good, my heuristic matches the plan exactly.

Now, environment configuration: "Poll interval and max retries are env-configured: `PAYOUT_WORKER_INTERVAL_MS` (default 1000) and `PAYOUT_MAX_ATTEMPTS` (default 3)." The service needs `PAYOUT_MAX_ATTEMPTS`. How does the service get it? "Configuration comes from environment variables only." The service can read `process.env.PAYOUT_MAX_ATTEMPTS` with default 3. Should the worker pass it? The plan's service constructor is `constructor(repo: PayoutRepository, provider: PayoutProvider)` — only two dependencies. So the service reads env itself. Parse with default 3, guard against invalid values (fall back to 3? or clamp to >= 1?). Most defensible: parse int; if not a positive integer, default to 3.

Hmm, should I read env at construction or per call? Per call is more testable (tests can set `process.env.PAYOUT_MAX_ATTEMPTS`). Actually, tests would probably set the env var before instantiation or per test. Reading per call in `processMessage` is safest for tests that change the env between calls. But reading at construction is also common. Let me read via a small private method called per `processMessage` invocation — that way tests can control it flexibly. Actually, hmm, let me think about what's cleanest: a private `maxAttempts()` method that reads and parses env each time. This is defensible and testable.

Wait, but "configuration comes from environment variables only" — reading `process.env` directly in the service is fine per the convention (NestJS ConfigModule isn't mentioned in the plan; the plan says env-configured with defaults). The module wiring in the plan doesn't include ConfigService. So direct `process.env` reading is the way.

Now, the `PayoutError` class:

```ts
export class PayoutError extends Error {
  readonly code: string;
  constructor(code: string, message: string, details?: Record<string, unknown>) { ... }
}
```

The plan's signature: `constructor(code: string, message: string, details?: Record<string, unknown>);`. The error envelope requires `details` to be an object, never null. So the service should store details with default `{}`. The controller translates to the envelope; the service holds code/message/details.

Let me write it:

```ts
export class PayoutError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

export class InsufficientFundsError extends PayoutError {}
export class DuplicatePayoutError extends PayoutError {}
export class PayoutNotFoundError extends PayoutError {}
```

The subclasses are empty per the plan (`extends PayoutError {}`). The codes are set at construction by callers (repository throws with the code). Wait — in the reference repository, errors are thrown like `new InsufficientFundsError('insufficient_funds', '...')` — the code is passed explicitly. So the subclasses don't hardcode the code; the caller passes it. OK, I'll keep the subclasses empty as per the plan.

Note: the reference repository imports `InsufficientFundsError, DuplicatePayoutError` from `'./payout.service'` — so my file must export those names. ✓.

Now `PayoutService`:

```ts
@Injectable()
export class PayoutService {
  constructor(
    private readonly repo: PayoutRepository,
    private readonly provider: PayoutProvider,
  ) {}

  async createPayout(input: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<{ payoutId: string }> {
    return this.repo.createPayoutWithMessage(input);
  }

  async processMessage(messageId: string): Promise<void> {
    // Step 1: load message; no-op if terminal.
    const message = await this.repo.findMessageById(messageId);
    if (!message) {
      // ASSUMPTION? The plan says PayoutNotFoundError exists with code "resource_not_found". But processMessage flow step 1 doesn't mention missing messages. Hmm.
    }
    ...
  }
}
```

Hmm, what if the message isn't found? The plan's flow: "1. Load the message by id. If status is DONE or DEAD, return (idempotent no-op against duplicate delivery)." It doesn't specify behavior for a missing message. `PayoutNotFoundError` exists with code "resource_not_found" — presumably used somewhere. Where? The controller's error envelope mentions 404 for not-found. But the only endpoint is POST /payouts — there's no GET endpoint in the plan! The controller only has `@Post() create(...)`. So where is `PayoutNotFoundError` used?

Hmm. The plan lists it as an error class to exist in this file. It might be used in `processMessage` when the message or payout isn't found. That's the most defensible use: if `findMessageById` returns null, throw `PayoutNotFoundError('resource_not_found', ...)`. Or if the payout isn't found.

Actually, is throwing appropriate in a worker context? A thrown error in `processMessage` would propagate to the worker's `processMessages`. The worker spec doesn't detail error handling. Hmm. Alternatively, treat missing message as a no-op (log and return). But then `PayoutNotFoundError` is unused — but the plan explicitly says this file contains it, so it should be used somewhere defensible.

Let me think: the plan says "the controller catches `PayoutError` subclasses and returns `{ error: ... }` with appropriate HTTP status (409 for duplicate/insufficient, 404 for not found)." So the controller maps PayoutNotFoundError → 404. But POST /payouts... when would a payout not be found on create? It wouldn't. So the 404 path is somewhat vestigial, or for future GET endpoints. The class must exist per the plan; its use in `processMessage` for a missing message/payout is the most defensible.

Decision: in `processMessage`, if the message isn't found, throw `PayoutNotFoundError`. This is defensible: a worker processing a non-existent message indicates a corrupted queue state and should surface loudly rather than be silently swallowed. I'll add an ASSUMPTION comment? The plan doesn't specify this behavior, so it's a gap. Per instructions: mark with `// ASSUMPTION:` where something is truly missing. The plan's flow step 1 only covers DONE/DEAD. Missing message handling is unspecified → I'll write the most defensible reading (throw PayoutNotFoundError) and mark it with a single ASSUMPTION comment.

Hmm wait, actually let me reconsider — maybe no-op is more defensible for at-least-once delivery? No — a missing message id can't be "retried" into existence; it's a bug. Throwing surfaces it. And it gives `PayoutNotFoundError` a real use. I'll go with throw + ASSUMPTION comment.

Step 2: "If status is not PROCESSING, claim it (step 2 above). If claim returns null, return."

Wait, careful: after step 1, the message exists and is not DONE/DEAD. So status is PENDING or PROCESSING. If PENDING → claim. If claim returns null (concurrent claim won, or status changed), return. If PROCESSING → skip claim (we're re-entering for retry) and continue.

```ts
if (message.status === MessageStatus.PENDING) {
  const claimed = await this.repo.claimMessage(messageId);
  if (!claimed) return;
}
```

Step 3: "Load the associated payout. If payout status is not CREATED or PROCESSING, return (already processed)."

How does the service load the payout? The repository has `findPayoutByAccountIdemKey` (no), `findMessageById` (returns message row, no payout status)... hmm! The shown repository has no `findPayoutById` method!

Let me re-check the reference repository's methods:
- createPayoutWithMessage
- claimMessage
- markProcessing
- recordAttemptFailure
- completePayout
- failPayout
- markNeedsReview
- findPendingMessages
- findMessageById
- findPayoutByAccountIdemKey

No `findPayoutById`! But step 3 of `processMessage` needs the payout (status, destinationAddress, amount). And step 5 needs `destinationAddress` and `amount` to call the provider.

Hmm!! This is a bigger gap. The plan §3 repository spec also doesn't list `findPayoutById`:

"// Fetches a pending message (for worker polling). findPendingMessages(limit: number): Promise<MessageRow[]>;
// Fetches a message by id (for reprocessing / duplicate delivery). findMessageById(id: string): Promise<MessageRow | null>;
// Idempotency check: does a payout already exist for this key? findPayoutByAccountIdemKey(...)"

So the plan's own repository spec lacks a way to load a payout by id. But `processMessage` needs the payout's destinationAddress, amount, and status.

Wait... does it? Let me re-derive: the service needs to call `provider.transfer(destinationAddress, amount)`. Those fields are on the payout. The message row only has id, payoutId, accountId, status, attempts. So yes, the service needs to load the payout.

Unless... the repository methods `completePayout`/`failPayout` load the payout internally (they do — `findUniqueOrThrow`). But the provider call happens before those, in the service. So the service must have the payout data.

So `findPayoutById` (or similar) is truly missing from both the plan's repository spec and the reference file. Per instructions: "If a symbol you need is truly missing from both the plan and references, do not silently guess or work around it: write the file using the most defensible reading and mark it with a single `// ASSUMPTION: <what was unresolved>` comment at the point where it matters."

Hmm, "a single `// ASSUMPTION:` comment" — does that mean one total in the file, or one per unresolved point? "mark it with a single `// ASSUMPTION: <what was unresolved>` comment at the point where it matters" — I read this as: one comment per unresolved point, placed where it matters. If there are two unresolved points (missing message handling + missing payout fetch), I might need two comments. Or maybe I should minimize: is the missing message handling truly unresolved? The plan lists `PayoutNotFoundError` as part of this file with code "resource_not_found" — that strongly implies it's thrown when a resource isn't found. I could argue the use is implied by the plan (the class exists for a reason, and the only place "not found" can occur in this file is processMessage). So maybe no ASSUMPTION needed there — the plan implies it.

For the payout fetch: I need to call something like `this.repo.findPayoutById(payoutId)`. That symbol is missing. Most defensible reading: the repository has (or should have) a `findPayoutById` returning the payout row with at least `{ id, accountId, amount, destinationAddress, status }`. I'll call it and mark with an ASSUMPTION comment.

Hmm wait, actually — let me reconsider. Is there any way to avoid it? Could the service call `provider.transfer` with data from... no. The message row doesn't have amount/destination. There's no way around loading the payout.

Alternatively, could `claimMessage` return more? No, it returns a MessageRow.

OK so I'll call `this.repo.findPayoutById(payoutId)` with an ASSUMPTION comment explaining the gap. What shape? Most defensible: return a payout row or null:

```ts
interface PayoutRow {
  id: string;
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  status: PayoutStatus;
}
```

The service needs amount (bigint), destinationAddress, status. I'll type the call's result accordingly. Since the repository file is fixed (I can't change it), my service just calls a method that doesn't exist there — which would be a compile error in the actual workspace... but I'm only writing this one file, and the instructions explicitly anticipate this: "write the file using the most defensible reading and mark it with a single ASSUMPTION comment." So the evaluation presumably checks whether I handled the gap correctly rather than silently inventing or working around it.

Hmm, wait. Let me re-read the instructions once more: "If a symbol you need is truly missing from both the plan and references, do not silently guess or work around it: write the file using the most defensible reading and mark it with a single `// ASSUMPTION: <what was unresolved>` comment at the point where it matters."

Yes. So: use `this.repo.findPayoutById(payoutId)` (most defensible name/shape) + ASSUMPTION comment.

Now let me also re-check the gating counter issue with an eye to "message's attempts is 2" test. With my flow (leave as PROCESSING, no reset), message.attempts stays at 1 in the transient-then-success case. The plan's test expects 2. But I can't write the test file — only the service. The plan is my spec; §4's numbered flow says "leave the message as PROCESSING." The "Retry mechanism" paragraph says reset to PENDING. Contradiction within the plan. Which governs for this file?

The numbered flow is the detailed control-flow spec; the repository API (both plan §3 and reference) has no reset method; and step 5's parenthetical explicitly anticipates the alternative ("or the worker can reset it to PENDING for retry" — pushing the reset out of the service). So within this file, the defensible implementation is: leave as PROCESSING, gate on payout.attempts.

But wait — if I gate on payout.attempts and leave as PROCESSING, does retry exhaustion work when driven by the worker's `processMessages()`? The worker fetches PENDING messages (`findPendingMessages`). A PROCESSING message is never fetched by the worker! So with a real polling worker, a failed-then-retriable message stuck in PROCESSING would never be retried by the worker. Hmm!! That's a real liveness problem in the actual system...

Unless the worker also re-processes PROCESSING messages (stuck ones). The worker spec: "Single poll cycle: fetch pending messages, claim each, call service.processMessage." Only PENDING. So a PROCESSING message is stuck forever (until someone calls processMessage directly).

Hmm, this is getting deep. But my file is only the service. The plan's numbered flow for processMessage explicitly handles PROCESSING re-entry (step 1 only no-ops on DONE/DEAD; step 2 skips claim if PROCESSING). That re-entry path exists precisely so that a repeated `processMessage` call retries. The tests drive `processMessage` directly (test spec: "call `processMessage` twice on the same message id", "provider fails once then succeeds on second attempt" — implying a second `processMessage` call). So for the testable behavior specified, my flow works.

The worker liveness gap (PROCESSING messages not re-polled) is a plan/repository/worker-level issue, not something I can fix in the service file without adding repository methods. The plan itself says "it will be reclaimed by subsequent polls after timeout/reclaim, or the worker can reset it to PENDING for retry" — acknowledging the mechanism is elsewhere. Fine.

So: gate on payout.attempts (the counter that `recordAttemptFailure` increments — the plan says "record the attempt (`recordAttemptFailure`). If `attempts < PAYOUT_MAX_ATTEMPTS`..." — immediately after mentioning recordAttemptFailure, so `attempts` most naturally refers to the payout's attempts that was just incremented).

Let me write out the full flow:

```ts
async processMessage(messageId: string): Promise<void> {
  const message = await this.repo.findMessageById(messageId);
  if (!message) {
    throw new PayoutNotFoundError('resource_not_found', `Message '${messageId}' not found.`);
  }

  // Terminal messages are no-ops: this is what makes duplicate delivery safe.
  if (message.status === MessageStatus.DONE || message.status === MessageStatus.DEAD) {
    return;
  }

  // Claim PENDING messages; a null claim means another worker won the race.
  if (message.status === MessageStatus.PENDING) {
    const claimed = await this.repo.claimMessage(messageId);
    if (!claimed) {
      return;
    }
  }

  // Load the payout (ASSUMPTION: repo method missing).
  const payout = await this.repo.findPayoutById(message.payoutId);
  if (!payout) {
    throw new PayoutNotFoundError('resource_not_found', `Payout '${message.payoutId}' not found.`);
  }

  // Already handled (terminal payout) — no-op.
  if (payout.status !== PayoutStatus.CREATED && payout.status !== PayoutStatus.PROCESSING) {
    return;
  }

  await this.repo.markProcessing(payout.id);

  try {
    const { txHash } = await this.provider.transfer(payout.destinationAddress, payout.amount);
    await this.repo.completePayout(payout.id, txHash);
  } catch (error) {
    const description = error instanceof Error ? error.message : String(error);
    await this.repo.recordAttemptFailure(payout.id, description);

    const attempts = (await this.repo.findPayoutById(payout.id))?.attempts ?? 0;
    // Hmm — recordAttemptFailure doesn't return the new attempts. I need the count.
    ...
  }
}
```

Hmm, problem: after `recordAttemptFailure`, I need the payout's attempts count to decide retry vs exhaust. `recordAttemptFailure` returns void. So I'd need to re-fetch the payout (another call to the assumed `findPayoutById`). That's fine — one more read. Or track locally: I know the payout's attempts from the initial fetch, and each `recordAttemptFailure` call increments by 1. Since this invocation records exactly one failure, `newAttempts = payout.attempts + 1`. That avoids the extra fetch and is correct within a single processMessage invocation. But is it robust? If two workers process the same message concurrently... the claim mechanism should prevent concurrent processing of the same message (only one claims PENDING→PROCESSING). But re-entry into PROCESSING isn't guarded against concurrency — two workers could both see PROCESSING and both call the provider. That's an inherent at-least-once risk the plan accepts. For the attempts count, using `payout.attempts + 1` from the snapshot is consistent with what this invocation did. But under concurrent double-processing, the DB count could be higher than my local estimate... edge case; the plan doesn't require handling it.

Cleaner and more defensible: re-read the payout after recording the failure to get the authoritative count. One extra DB read, but always correct. Hmm, but that doubles reliance on the assumed method. Alternatively, compute locally: `const attempts = payout.attempts + 1;`.

Let me think about which is more "defensible." The plan says: "record the attempt (`recordAttemptFailure`). If `attempts < PAYOUT_MAX_ATTEMPTS`..." — it reads as if `attempts` is known after recording. Since `recordAttemptFailure` returns void in the reference, the service must know the count some other way: either from the pre-read (payout.attempts) + 1, or by re-reading. The pre-read + 1 is simple and correct for sequential processing (which the claim mechanism enforces for first processing; re-entry is a retry path). I'll go with `payout.attempts + 1` — no wait, hmm.

Actually, hold on. Let me reconsider: which attempts does the plan mean? Re-reading: "Failure: record the attempt (`recordAttemptFailure`). If `attempts < PAYOUT_MAX_ATTEMPTS`, leave the message as PROCESSING... If `attempts >= PAYOUT_MAX_ATTEMPTS`: ..."

`recordAttemptFailure(payoutId, error)` — "Records a provider attempt failure: increments attempts, sets lastError." — on the payout. So `attempts` = payout.attempts after increment = snapshot + 1. I'll use that.

With MAX=3:
- Attempt 1 fails: payout.attempts snapshot 0 → new 1. 1 < 3 → leave as PROCESSING (retry).
- Attempt 2 fails: snapshot 1 → new 2. 2 < 3 → retry.
- Attempt 3 fails: snapshot 2 → new 3. 3 >= 3 → exhaust: definitive? failPayout : markNeedsReview.

So the provider is called exactly PAYOUT_MAX_ATTEMPTS times total, then terminal. ✓ Matches "after `PAYOUT_MAX_ATTEMPTS` calls, payout is FAILED."

Now the classification:

```ts
private isAmbiguousFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false; // hmm...
  ...
}
```

Wait — what about non-Error throws (e.g., a string)? The plan's test: "provider throws a timeout error" vs "non-timeout error." Both are presumably Error instances. For non-Error throws, what's defensible? Safe default = ambiguous (funds stay reserved)? But the plan says "non-timeout error → definitive." A thrown string isn't a timeout... strictly following the plan: only timeouts are ambiguous; everything else definitive. So non-Error → definitive? Hmm, that feels unsafe in the real world (unknown SDK failure might be in-flight). But the plan's assumption is explicit: "if the provider throws a non-timeout error (definitive failure), payout is `failed`; if it times out or throws ambiguously... `needs-review`."

I'll implement: ambiguous iff the error indicates a timeout (message/name/code heuristic). Everything else → definitive. This matches the plan's assumption exactly and passes both exhaustion tests.

Timeout detection heuristic:
- `error.name === 'TimeoutError'` (Node's built-in) or `'ETIMEDOUT'`
- `error.code === 'ETIMEDOUT'` or `'ECONNABORTED'`? Let me keep it focused: message contains 'timeout' or 'timed out', name is 'TimeoutError', code is 'ETIMEDOUT'.

```ts
private isAmbiguousFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as { name?: unknown; code?: unknown; message?: unknown };
  const name = typeof candidate.name === 'string' ? candidate.name : '';
  const code = typeof candidate.code === 'string' ? candidate.code : '';
  const message = typeof error === 'object' && 'message' in error && typeof (error as {message: unknown}).message === 'string' ? ... 
}
```

Simpler:

```ts
private isAmbiguousFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const marker = `${error.name} ${error.message} ${(error as { code?: string }).code ?? ''}`.toLowerCase();
  return marker.includes('timeout') || marker.includes('timed out') || marker.includes('etimedout');
}
```

Hmm, 'timeout' already covers 'timed out'? No: "timed out" doesn't contain the substring "timeout". So check both. And ETIMEDOUT contains 'timedout'... 'etimedout'.toLowerCase() = 'etimedout' — does it contain 'timeout'? e-t-i-m-e-d-o-u-t: "etimedout" — substring "timeout"? t-i-m-e-o-u-t vs t-i-m-e-d-o-u-t. No, "etimedout" doesn't contain "timeout" (there's a 'd' in between). So I'll check 'etimedout' too. Or just check name/code separately:

```ts
private isAmbiguousFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = (error as Error & { code?: string }).code;
  if (code === 'ETIMEDOUT' || code === 'ECONNRESET' ... 
```

Hmm, ECONNRESET — is that ambiguous? A connection reset mid-transfer could mean in-flight. But the plan only names timeouts as ambiguous examples ("if it times out or throws ambiguously (timeout, 5xx, network error)"). Wait, §4 says ambiguous = "(timeout, 5xx, network error)." And the assumption section says "if it times out or throws ambiguously." So network errors (5xx) are also ambiguous!

Hmm, so the classification per §4: definitive = "invalid address, provider 4xx"; ambiguous = "timeout, 5xx, network error." But the assumption section simplifies to: non-timeout → definitive; timeout/ambiguous → needs-review. And the test spec: "provider throws a non-timeout error on every attempt" → FAILED (definitive). So in the test, a plain `Error('invalid address')` must be definitive.

So how do I encode "4xx definitive, 5xx ambiguous" without a real SDK? The test fake presumably throws: for the definitive test, something like `new Error('invalid destination address')`; for the timeout test, something with 'timeout' in the message. My heuristic (timeout-marker → ambiguous, else definitive) passes both tests and matches the assumption section's simplification. Encoding 4xx/5xx would require a status field on the error that the plan doesn't define. I could also check for a `status`/`statusCode` property: if present and 400-499 → definitive; 500-599 → ambiguous; absent → timeout-marker heuristic, else definitive. That's over-engineering beyond the plan's testable contract.

Most defensible: follow the plan's assumption section (the explicit, normative statement): timeout-like → ambiguous; everything else → definitive. I'll implement the timeout-marker heuristic and document it in a comment referencing the plan's rule. Keep it simple:

```ts
/**
 * Classifies a provider failure. Per the design, only failures that may have
 * landed on-chain (timeouts and other ambiguous failures) keep the funds
 * reserved; every other failure is treated as definitive (the transfer did
 * not happen) and releases the reservation.
 */
private isAmbiguousFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = (error as Error & { code?: string }).code ?? '';
  const haystack = `${error.name} ${code} ${error.message}`.toLowerCase();
  return (
    code === 'ETIMEDOUT' ||
    error.name === 'TimeoutError' ||
    haystack.includes('timeout') ||
    haystack.includes('timed out')
  );
}
```

This is clean. `haystack.includes('timeout')` covers most fake errors like `new Error('transfer timed out')`? "timed out" — covered by the second check. `new Error('Request timeout')` — covered. Good.

Now env config for max attempts:

```ts
private static readonly DEFAULT_MAX_ATTEMPTS = 3;

private maxAttempts(): number {
  const raw = process.env.PAYOUT_MAX_ATTEMPTS;
  if (raw === undefined || raw.trim() === '') {
    return PayoutService.DEFAULT_MAX_ATTEMPTS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return PayoutService.DEFAULT_MAX_ATTEMPTS;
  }
  return parsed;
}
```

Defensible: env-only config, default 3 per plan, invalid → default.

Now imports for this file:
- `Injectable` from `@nestjs/common`.
- `PayoutStatus`, `MessageStatus` from `@prisma/client` (needed to compare statuses).
- `PayoutRepository` from `./payout.repository` — but note: the repository imports from `./payout.service` (circular import!). The reference repository does `import { InsufficientFundsError, DuplicatePayoutError } from './payout.service';`. And my service imports `PayoutRepository` from `./payout.repository`. Circular! In ESM + TypeScript, this can be problematic... but it's a type-only + class usage. The service uses `PayoutRepository` only as a constructor parameter type → I can use `import type { PayoutRepository } from './payout.repository'` to erase it at runtime and break the cycle. The repository imports error classes from the service at runtime (it throws them) — that's the real runtime edge. With ESM circular imports, as long as the service module doesn't use the repository's exports at module-evaluation time (only in constructor injection at runtime, after both modules are loaded), it works. Using `import type` for the repository in the service is the clean, defensible move and avoids any TDZ issues.

Similarly `PayoutProvider` from `./payout.provider` — interface only → `import type`.

And `PayoutStatus`, `MessageStatus` from `@prisma/client` — these are runtime enum values (used in comparisons) → regular import.

Wait, does the plan say to use `import type`? No, but it's standard and safe. The repository reference file uses regular imports for Prisma enums (runtime values). For my service: `PayoutStatus` and `MessageStatus` are used as values (comparisons) → regular import. `PayoutRepository`, `PayoutProvider` are used only as types → `import type`.

Now, the shape of the payout row I assume from `findPayoutById`: I need `id`, `accountId` (maybe not directly), `amount: bigint`, `destinationAddress: string`, `status: PayoutStatus`. Do I need accountId? `completePayout`/`failPayout`/`markNeedsReview` take only payoutId and load the account internally. So the service doesn't need accountId. Minimal: `{ id, amount, destinationAddress, status }`. I'll type the call inline or define a small local interface. Since the method doesn't exist, I'll write an ASSUMPTION comment at the call site explaining the assumed signature.

Actually — how many ASSUMPTION comments do I need? Unresolved points:
1. `findPayoutById` repository method (truly missing from plan §3 and reference).
2. Missing message → throw PayoutNotFoundError (plan doesn't specify; but the class's existence + code "resource_not_found" implies it — borderline).
3. Missing payout (after fetch) → throw PayoutNotFoundError (same reasoning).
4. Retry gating on payout.attempts vs message.attempts (plan is ambiguous; I chose payout.attempts based on the flow).
5. Leave as PROCESSING vs reset to PENDING (plan contradicts; I chose leave-as-PROCESSING per the numbered flow + repository API).

The instructions say "mark it with a single `// ASSUMPTION: <what was unresolved>` comment at the point where it matters" — I read "it" = "a symbol you need is truly missing." So ASSUMPTION comments are specifically for missing symbols. #1 is the clear case. The others are interpretation choices, not missing symbols — I can document them with regular comments (the plan permits English comments; the convention says code and comments in English). I'll use regular explanatory comments for interpretation choices and reserve `// ASSUMPTION:` for the truly missing `findPayoutById`.

Hmm, but wait — is #1 really missing? Let me scan the plan once more for any payout-fetch method... §3 repository: createPayoutWithMessage, claimMessage, markProcessing, recordAttemptFailure, completePayout, failPayout, markNeedsReview, findPendingMessages, findMessageById, findPayoutByAccountIdemKey. No findPayoutById. Reference file: same list. Confirmed missing.

And how does the service get destinationAddress/amount? Only from the payout. Confirmed needed.

So one ASSUMPTION comment at the `findPayoutById` call site. I could also add a short note about the return shape within the same comment.

Now, let me also double-check `createPayout`: the plan says the service's `createPayout` "Creates a payout + outbox message in one transaction. Throws InsufficientFundsError if available < amount. Throws DuplicatePayoutError if (accountId, idempotencyKey) already exists." The repository's `createPayoutWithMessage` does all that (as shown in the reference: throws DuplicatePayoutError and InsufficientFundsError internally). So the service just delegates:

```ts
async createPayout(input: CreatePayoutInput): Promise<{ payoutId: string }> {
  return this.repo.createPayoutWithMessage(input);
}
```

Should I define an exported `CreatePayoutInput` interface? The plan's signature inlines the input type: `createPayout(input: { accountId: string; amount: bigint; destinationAddress: string; idempotencyKey: string }): Promise<{ payoutId: string }>`. "Do not add exports the plan doesn't name." An exported input interface would be an added export. I'll inline the type as per the plan.

Now, the full service file:

```ts
import { Injectable } from '@nestjs/common';
import { MessageStatus, PayoutStatus } from '@prisma/client';
import type { PayoutRepository } from './payout.repository';
import type { PayoutProvider } from './payout.provider';

/**
 * Base class for all typed errors thrown by the payout service. The
 * controller translates these into the standard error envelope; `code` is
 * the stable contract, `message` is developer-facing, and `details` is
 * always an object (never null).
 */
export class PayoutError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

/** Account does not have enough available (settled - reserved) funds. */
export class InsufficientFundsError extends PayoutError {}

/** A payout already exists for this (accountId, idempotencyKey). */
export class DuplicatePayoutError extends PayoutError {}

/** The referenced payout (or queue message) does not exist. */
export class PayoutNotFoundError extends PayoutError {}

@Injectable()
export class PayoutService {
  private static readonly DEFAULT_MAX_ATTEMPTS = 3;

  constructor(
    private readonly repo: PayoutRepository,
    private readonly provider: PayoutProvider,
  ) {}

  /**
   * Creates a payout and its outbox message atomically. The repository locks
   * the account row, checks available funds, and enforces idempotency inside
   * a single transaction, so racing requests can never overdraw the account
   * and a retried idempotency key can never reserve funds twice.
   */
  async createPayout(input: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<{ payoutId: string }> {
    return this.repo.createPayoutWithMessage(input);
  }

  /**
   * Processes one outbox message. Safe to call more than once for the same
   * message (at-least-once delivery): terminal messages and payouts are
   * no-ops, and the provider is only called for payouts that have not yet
   * reached a terminal state.
   */
  async processMessage(messageId: string): Promise<void> {
    const message = await this.repo.findMessageById(messageId);
    if (!message) {
      throw new PayoutNotFoundError(
        'resource_not_found',
        `Outbox message '${messageId}' not found.`,
      );
    }

    // Duplicate delivery of an already-handled message is a no-op.
    if (message.status === MessageStatus.DONE || message.status === MessageStatus.DEAD) {
      return;
    }

    // Claim PENDING messages before touching the provider so a crash can
    // only cause redelivery, never silent loss. A null claim means another
    // worker won the race; PROCESSING messages are re-entered for retry.
    if (message.status === MessageStatus.PENDING) {
      const claimed = await this.repo.claimMessage(messageId);
      if (!claimed) {
        return;
      }
    }

    // ASSUMPTION: the plan's repository spec and the reference repository do
    // not expose a way to load a payout by id, but processMessage needs the
    // payout's amount, destinationAddress and status to call the provider;
    // this assumes the repository provides findPayoutById(id) returning that
    // row (or null).
    const payout = await this.repo.findPayoutById(message.payoutId);
    if (!payout) {
      throw new PayoutNotFoundError(
        'resource_not_found',
        `Payout '${message.payoutId}' not found.`,
      );
    }

    // Only CREATED/PROCESSING payouts are actionable; anything else means
    // this message was already handled end-to-end.
    if (
      payout.status !== PayoutStatus.CREATED &&
      payout.status !== PayoutStatus.PROCESSING
    ) {
      return;
    }

    await this.repo.markProcessing(payout.id);

    try {
      const { txHash } = await this.provider.transfer(
        payout.destinationAddress,
        payout.amount,
      );
      // The repository posts the ledger entry and updates the account in one
      // transaction, so the settled balance only moves on confirmed transfer.
      await this.repo.completePayout(payout.id, txHash);
    } catch (error) {
      const description = error instanceof Error ? error.message : String(error);
      await this.repo.recordAttemptFailure(payout.id, description);

      // recordAttemptFailure increments the payout's attempts; this attempt
      // is therefore payout.attempts + 1.
      const attempts = payout.attempts + 1;
      if (attempts < this.maxAttempts()) {
        // Retries remain: the message stays PROCESSING and a subsequent
        // processMessage call re-enters it (the worker/test drives the retry).
        return;
      }

      if (this.isAmbiguousFailure(error)) {
        // The transfer may have landed on-chain: keep the funds reserved and
        // hold the payout for manual reconciliation rather than risk a
        // double payment.
        await this.repo.markNeedsReview(payout.id);
      } else {
        // Definitive failure: the transfer did not happen, so release the
        // reservation. No ledger entry is posted.
        await this.repo.failPayout(payout.id);
      }
    }
  }

  /** PAYOUT_MAX_ATTEMPTS from the environment, defaulting to 3. */
  private maxAttempts(): number {
    const raw = process.env.PAYOUT_MAX_ATTEMPTS;
    if (raw === undefined || raw.trim() === '') {
      return PayoutService.DEFAULT_MAX_ATTEMPTS;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return PayoutService.DEFAULT_MAX_ATTEMPTS;
    }
    return parsed;
  }

  /**
   * A failure is ambiguous when it may have landed on-chain (a timeout).
   * Ambiguous failures keep the reservation and route to needs-review;
   * every other failure is definitive and releases the funds.
   */
  private isAmbiguousFailure(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    const code = (error as Error & { code?: string }).code ?? '';
    const haystack = `${error.name} ${code} ${error.message}`.toLowerCase();
    return (
      code === 'ETIMEDOUT' ||
      error.name === 'TimeoutError' ||
      haystack.includes('timeout') ||
      haystack.includes('timed out')
    );
  }
}
```

Wait — `payout.attempts` — my assumed payout row shape must include `attempts: number`. Yes, I'll note that in the ASSUMPTION comment. The payout has an `attempts` column per the plan's data model. Good.

Let me double-check the duplicate-delivery test against my flow:
Test: "call `processMessage` twice on the same message id; provider's `transfer` is called exactly once; payout reaches COMPLETED with a single ledger entry; the second call is a no-op."
- Call 1: message PENDING → claim → PROCESSING (attempts 1). Payout CREATED → markProcessing. Transfer succeeds → completePayout (payout COMPLETED, message DONE).
- Call 2: findMessageById → status DONE → return. ✓ Provider called once, single ledger entry. ✓

Concurrent creation test: two `createPayout` calls race; the repository handles locking (reference does findFirst for idempotency, then FOR UPDATE on account... wait, actually the reference checks idempotency before locking the account — a minor race between two different keys is fine because the lock serializes the balance check; same key could double-insert before either commits? The unique index (accountId, idempotencyKey) on the message table would catch it at commit... but the reference throws DuplicatePayoutError only from findFirst. Under a race, both pass findFirst, both insert → one hits the unique constraint → Prisma throws P2002, not DuplicatePayoutError. Hmm — but that's the repository's problem (reference file, fixed), not mine. My service just delegates. Not my file's concern.)

Retry exhaustion (definitive): provider always throws `new Error('invalid address')`.
- Call 1: claim, markProcessing, transfer throws → recordAttemptFailure (payout.attempts 0→1). attempts = 0+1 = 1 < 3 → return (message stays PROCESSING).
- Call 2: message PROCESSING → skip claim. Payout PROCESSING → continue. markProcessing (no-op). Transfer throws → recordAttemptFailure (1→2). attempts = 1+1 = 2 < 3 → return.
- Call 3: same. Transfer throws → recordAttemptFailure (2→3). attempts = 2+1 = 3. 3 >= 3 → not ambiguous → failPayout. ✓ Payout FAILED, reservation released, no ledger entry, message DONE (failPayout sets it). Provider called 3 times = PAYOUT_MAX_ATTEMPTS. ✓

Retry exhaustion (timeout): same but `new Error('transfer timed out')` → isAmbiguousFailure: haystack contains 'timed out' ✓ → markNeedsReview. Payout NEEDS_REVIEW, reservation retained, message DEAD. ✓

Transient then success:
- Call 1: timeout → attempts 1 < 3 → return.
- Call 2: transfer succeeds → completePayout. Payout COMPLETED, ledger entry, message DONE. ✓ (message.attempts = 1, not 2 as the test line says — but that test expectation conflicts with the plan's own "leave as PROCESSING" flow and repository API; my file follows the normative numbered flow. Can't do better within this file.)

Hmm, wait. Let me reconsider once more whether I should gate on message.attempts instead... If I gate on message.attempts (which only increments on claim): with leave-as-PROCESSING, message.attempts stays 1 forever → never exhausts (1 < 3 always) → infinite retries. That clearly violates the retry-exhaustion tests. So payout.attempts gating is the only self-consistent choice. Confirmed.

Worker poll test: "seed a PENDING message, call `processMessages()`, payout transitions to COMPLETED and message to DONE." The worker fetches PENDING, claims, calls processMessage... wait, the worker spec: "fetch pending messages, claim each, call service.processMessage." So the worker claims first (PENDING→PROCESSING), then calls processMessage, which sees PROCESSING and skips the claim. Works with my flow. ✓

Now — one more consideration on step ordering: the plan says "3. Load the associated payout. If payout status is not CREATED or PROCESSING, return." I do that. "4. Mark the payout as PROCESSING." ✓. "5. Call provider.transfer." ✓.

Also, should `markProcessing` be called before the provider even on re-entry? It's idempotent (sets PROCESSING + processedAt). Fine.

Edge: what if `completePayout` throws (e.g., DB error)? The error propagates out of processMessage to the worker. The message stays PROCESSING, payout PROCESSING → retryable on next call. But note: the provider already succeeded (txHash obtained) — a retry would call the provider again → double transfer risk. That's inherent at-least-once; the plan accepts downstream idempotency. Not my concern to solve here.

Now, imports check: do I use `MessageStatus` and `PayoutStatus` as values? Yes (comparisons). Regular import from `@prisma/client`. ✓

`Injectable` — used. ✓

Type-only imports: `PayoutRepository`, `PayoutProvider`. Using `import type` — good for the circular import with the repository (which imports error classes from this file at runtime). With `import type`, my module has no runtime dependency on the repository module → cycle fully broken.

Wait, but does NestJS DI care? No — DI resolves by token at runtime via the module system; the constructor parameter type is erased. The repository class is provided by the module; Nest instantiates PayoutService with the repository instance. Type erasure is fine.

One concern: `import type { PayoutRepository } from './payout.repository';` — the reference repository exports `PayoutRepository` (class) and `MessageRow` (interface). ✓ Name matches.

And `PayoutProvider` is exported from `./payout.provider`. ✓

Now, the plan also says the service throws PayoutError subclasses — but in my implementation, `createPayout` delegates to the repository which throws them. The service itself throws PayoutNotFoundError in processMessage. Fine.

Should `processMessage` catch repository errors and wrap them? No — the plan doesn't say so. Keep it minimal.

Let me reconsider the missing-message behavior once more. Options: (a) throw PayoutNotFoundError, (b) no-op return. The plan gives PayoutNotFoundError code "resource_not_found" and the controller maps it to 404. In a worker context, throwing surfaces the anomaly. The plan's flow step 1 doesn't cover it, so either is "unspecified." I'll go with (a) and note it briefly in a regular comment (not ASSUMPTION since the class's existence in the plan makes this a reasonable reading, not a missing symbol). Hmm, actually — is it worth an ASSUMPTION? The instructions tie ASSUMPTION to missing symbols. PayoutNotFoundError exists in the plan; its use here is my design choice. Regular comment it is.

Also, should I re-verify the message status after claiming (TOCTOU)? `claimMessage` returns the claimed row or null; if it returns non-null, we own it. Fine.

One more: the plan's `processMessage` signature returns `Promise<void>`. ✓

Let me also think about whether `createPayout` should do any validation (e.g., amount > 0). The plan: "The controller validates input and calls the service. Zero business logic." So validation (bigint parse, positivity) is the controller's job. The service takes a bigint. No extra validation in the service — "do exactly what the task asks." The plan's service spec for createPayout only mentions the two throws (which come from the repository). So pure delegation. ✓

Hmm, one subtlety: should `createPayout` catch a Prisma unique-constraint error and rethrow as DuplicatePayoutError? The repository is the only DB layer, and its reference implementation handles idempotency via findFirst (+ the unique index as backstop). If P2002 leaks through, that's a repository concern. Not in my file. ✓

Now, formatting: ESM, TypeScript strict. `process.env` is available (Node). `Number.parseInt` fine.

Let me also double-check the `details` default: the plan's constructor signature is `constructor(code: string, message: string, details?: Record<string, unknown>);`. I'll implement with a default parameter `= {}` and store as a readonly property. The envelope requires details to be an object, never null — the default `{}` guarantees that. Should the property be optional or required? Required with default is cleanest: `readonly details: Record<string, unknown>;` assigned from the parameter. ✓

`this.name = new.target.name;` — nice touch so instanceof chains report the right name. Defensible, standard.

Let me also reconsider: the plan says the error classes are in `payout.service.ts` — yes, "PayoutService: createPayout, processMessage; PayoutError and subclasses." ✓ All in this file.

Final check on the ASSUMPTION comment placement: "at the point where it matters" → right before/at the `findPayoutById` call. I'll write it as a compact comment block there. The instructions say "a single `// ASSUMPTION: <what was unresolved>` comment" — I'll make it start with `// ASSUMPTION:` and can span a few lines. Let me keep it tight:

```ts
    // ASSUMPTION: neither the plan's repository spec nor the reference
    // repository exposes a payout-by-id lookup, but processMessage needs the
    // payout's amount/destinationAddress/status/attempts to drive the
    // provider call; assuming repo.findPayoutById(id) returns that row or null.
```

Good — one ASSUMPTION marker, clearly placed.

Also, the `payout.attempts` reference depends on the assumed shape — covered by the same comment.

Let me also add a brief comment about why leaving as PROCESSING is safe (re-entry path) — regular comment.

I think the file is solid. Let me also verify no unused imports: MessageStatus (used), PayoutStatus (used), Injectable (used), PayoutRepository (type, used), PayoutProvider (type, used). ✓

Strict TS: `catch (error)` is `unknown` — I handle with instanceof. `(error as Error & { code?: string }).code ?? ''` — fine. `payout.attempts + 1` — number. ✓

One more style point: the repository reference uses 2-space indentation, single quotes, semicolons. I'll match.

Let me write the final file.
```

## reply

```typescript
import { Injectable } from '@nestjs/common';
import { MessageStatus, PayoutStatus } from '@prisma/client';
import type { PayoutRepository } from './payout.repository';
import type { PayoutProvider } from './payout.provider';

/**
 * Base class for every typed error thrown by the payout service. The
 * controller translates these into the standard error envelope: `code` is
 * the stable snake_case contract, `message` is developer-facing English, and
 * `details` is always an object (never null).
 */
export class PayoutError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details;
  }
}

/** The account's available funds (settled - reserved) cover the amount. */
export class InsufficientFundsError extends PayoutError {}

/** A payout already exists for this (accountId, idempotencyKey). */
export class DuplicatePayoutError extends PayoutError {}

/** The referenced payout (or outbox message) does not exist. */
export class PayoutNotFoundError extends PayoutError {}

@Injectable()
export class PayoutService {
  private static readonly DEFAULT_MAX_ATTEMPTS = 3;

  constructor(
    private readonly repo: PayoutRepository,
    private readonly provider: PayoutProvider,
  ) {}

  /**
   * Creates a payout and its outbox message atomically. The repository locks
   * the account row, checks available funds and enforces idempotency inside a
   * single transaction, so racing requests can never overdraw the account and
   * a retried idempotency key can never reserve funds twice.
   */
  async createPayout(input: {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<{
