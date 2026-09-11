# Transcript — 02-reconciliation-resend / variant-a / qwen/qwen3.8-27b

Every request, in order, with its reasoning. Nothing is elided.

# solution-retry

## reasoning

```
Let me carefully analyze the task.

What the task is asking for:
1. `executePayments()` — send pending orders via `bank.send({txid, amount, key})`. The txid is derived deterministically from the order + effective date.
2. `reconcile(window)` — match statement entries to orders, advance their state. Safe to run every 15 minutes, including overlapping windows.
3. Resend logic: an order that had a send failure/timeout can only be resent after reconciliation proves it doesn't exist in the statement past the publishing lag. Attempts capped at 5; after that, move to a state pending manual review, never auto-rollback.
4. Classification of `bank.send` responses (accepted, duplicate, transient error, permanent rejection) and distinct handling for each.

Deliverables: schema, services, reconcile job, tests for timeout-but-settled (no resend), proven-absent (resend, same txid), attempt exhaustion. Amounts are minor units, integers only.

Stack: TypeScript (strict), Node 20+, NestJS, Prisma, PostgreSQL, Vitest, pnpm, ESM, `"type": "module"`.

Conventions:
- Layout:
```
prisma/schema.prisma
src/main.ts
src/app.module.ts
src/<feature>/<feature>.module.ts
src/<feature>/<feature>.controller.ts
src/<feature>/<feature>.service.ts
src/<feature>/<feature>.repository.ts
test/<feature>.spec.ts
```
- Layers: controllers do input validation and call the service. No business logic. Services hold the logic. No raw SQL, no Prisma client calls. Repository is the only layer that touches the DB.
- Naming: tables/columns are `snake_case` (via Prisma `@map`/`@@map`). Endpoints are kebab-case plural. TS files are `kebab-case.role.ts`. Classes are PascalCase. Code and comments in English.
- Error envelope: `{ "error": { "code": "snake_case", "message": "...", "details": {} } }`.
- Wiring: services/repositories/processors are listed in the module's `providers`. Providers used by other modules are `exports`ed, and that module is `imports`ed. Controllers are declared by the module.
- Migrations: every schema change ships with a migration.
- Tests: Vitest. Test behavior, not implementation. Don't just assert calls happened.

Now, "do not create files that aren't asked for" — the task asks for schema, services, reconcile job, tests. The layout convention suggests `main.ts` and `app.module.ts`, but the task says "build the full solution in a single reply" and "deliver every file the solution needs, complete." The layout block is a convention of the codebase. Since nothing exists (the reference blocks are only task descriptions, not actual code), we need to build a new solution.

Hmm — "if files are given above as the task, they are the existing codebase" — no files are given, only task descriptions. So we're building from scratch. The layout convention tells us the expected structure. The task asks for "schema, services, reconcile job, tests."

What files do we need?
- `prisma/schema.prisma` — schema
- `src/payout/payout.module.ts` — module
- `src/payout/payout.service.ts` — service with `executePayments()` and `reconcile(window)`
- `src/payout/payout.repository.ts` — repository (only layer that touches the DB)
- `src/payout/payout.controller.ts` — endpoint (convention: controllers declared by the module; endpoints kebab-case plural). Do we need a controller? The task doesn't explicitly ask for an endpoint. "Deliver the schema, services, reconcile job, tests." Hmm. But the convention says controllers do input validation and call the service. The reconcile job is scheduled — in NestJS, scheduling is usually done via a processor using `@nestjs/schedule` (Cron). The convention mentions "processor" in the wiring section: "services, repositories or processors are listed in the module's `providers`." So there's a processor for the scheduled reconcile job.

Let me think about what "reconcile job" means: a scheduled job that calls `reconcile(window)` every 15 minutes. In NestJS, that would be a processor class with `@Cron` decorator from `@nestjs/schedule`. Or a processor called by a scheduler. Given that we don't have an actual running environment, the processor should be a class with a `@Cron('*/15 * * * *')` method that computes the window and calls `service.reconcile(window)`.

What about a controller? The convention lists a controller in the layout, but the task's deliverables don't mention an API endpoint. "Do exactly what the task asks. Do not create files that aren't asked for." The task asks for: schema, services, reconcile job, tests. Controllers aren't asked for. But is a controller part of "the full solution"? The convention layout includes a controller for each feature. Hmm. The discipline says "do not create files that aren't asked for." The task asks for schema, services, reconcile job, tests. I think a controller is defensible either way, but I want to keep the solution tight. Actually, wait — the "error envelope" convention suggests there's an API that returns errors. But without an endpoint, an error envelope is meaningless.

Let me re-read: "Build in TypeScript + NestJS + Prisma + Postgres: 1. executePayments() 2. reconcile(window) 3. Resend logic 4. Classify bank.send responses... Deliver the schema, services, reconcile job, tests for: timeout-but-settled (no resend), proven-absent (resend, same txid), attempt exhaustion."

So the deliverables are clear. There's no mention of an endpoint. But NestJS apps need an app.module and main.ts to be runnable... The layout convention lists `src/main.ts` and `src/app.module.ts` as part of the standard layout. "Build the full solution in a single reply" — a NestJS solution needs a module for wiring (the wiring convention requires modules for providers). Is `app.module.ts` needed for that? The feature module could stand alone, but for a runnable app, an app module importing the feature module is needed.

I think the reasonable set is:
1. `prisma/schema.prisma` — schema with `@@map` snake_case
2. `prisma/migrations/<timestamp>_init/migration.sql` — migration (convention: every schema change ships with a migration)
3. `src/app.module.ts` — imports the feature module
4. `src/main.ts` — bootstrap
5. `src/payout/payout.module.ts` — module
6. `src/payout/payout.service.ts` — service with `executePayments()` and `reconcile(window)`
7. `src/payout/payout.repository.ts` — repository
8. `src/payout/payout.processor.ts` — scheduled reconcile job (Cron every 15 minutes)
9. `src/bank/bank.client.ts` or `src/payout/bank-client...`? The bank API is external: `bank.send({txid, amount, key})` and `getStatement(date)`. We need an abstraction of the bank client. The task says "assume nothing about the bank API beyond `bank.send({txid, amount, key})` and `getStatement(date) -> Settlement[]`." So we define a port/interface for the bank client and an implementation that hits an HTTP API? Or an interface that gets mocked in tests?

The task says to assume nothing beyond those two methods. The most defensible approach: define a `BankClient` interface (port) with `send` and `getStatement`, and provide a default implementation (e.g., `HttpBankClient` or `BankHttpClient`) using `fetch` (Node 20+ has global fetch) or `axios`. Endpoints/config from environment variables ("configuration is from environment variables only"). No secrets in the repo. So `BANK_API_URL`, `BANK_API_KEY` (hmm, "no secrets in the repository" — env var is fine, just don't hardcode).

Actually, to keep it minimal and testable: a `BankClient` interface with:
```ts
interface BankSendResult {
  outcome: 'accepted' | 'duplicate' | 'transient' | 'permanent';
  ...
}
```
Wait — the classification is our job, not the bank's. The bank returns something (presumably HTTP status) and we classify:
- accepted — e.g., 2xx
- duplicate — the bank already has this txid (e.g., 409 Conflict, or specific response)
- transient — network error, timeout, 5xx
- permanent — 4xx (other than 409/408/429?) e.g., 400, 402, 403, 422

Since we assume nothing beyond the two methods, we define the contract ourselves and mark it with `// ASSUMPTION` where needed. Let's think about what's most defensible:

- `send`: returns a classification. Let's have the bank client return a raw-ish result and let the service classify? Or does the client classify? The spec says "executePayments() classifies what came back." So the service (executePayments) classifies. So the bank client returns something raw — probably an HTTP-like status code — and the service maps it to the four outcomes.

Let me design:

```ts
// bank-client
export type BankSendOutcome = 'accepted' | 'duplicate' | 'transient' | 'permanent';

export interface BankClient {
  send(input: { txid: string; amount: number; key: string }): Promise<BankSendResult>;
  getStatement(date: Date): Promise<Settlement[]>;
}
```

Hmm, but if the client returns a classified outcome, the service doesn't "classify what came back." Better: the client returns `{ status: number }` for accepted/duplicate/permanent, and throws for network issues? No — the service needs to distinguish transient from permanent. If the client throws on 5xx, the service can't distinguish. Better: the client returns a normalized transport result:

```ts
export type BankSendResult =
  | { status: 'ok' }                    // 2xx
  | { status: 'duplicate' }             // 409
  | { status: 'error'; code: string; statusCode: number }  // other 4xx/5xx
  | { status: 'network'; reason: string }; // timeout, DNS, socket error
```

And the service classifies:
- `ok` → accepted
- `duplicate` → duplicate
- `network` or 5xx or 408/429 → transient (unknown outcome)
- other 4xx → permanent

The actual `getStatement(date)`: returns `Settlement[]` where `Settlement = { txid: string; ... }`. The spec says "each has the txid we sent." Let's define `Settlement { txid: string; amountMinor: number; key: string; settledAt: Date }`. Keep it minimal: txid is required for matching. Include amount for sanity check? "Don't assume anything beyond `bank.send({txid, amount, key})` and `getStatement(date) -> Settlement[]`." The Settlement shape is unspecified — we have to define it. Minimal: `{ txid: string; amountMinor: number }` — amount can be a sanity check but might add complexity. For matching, txid alone suffices. Should the settlement include a date? `getStatement(date)` returns that day's entries, so date is implicit. Let's keep `Settlement = { txid: string; amountMinor: number }`... hmm, actually, should matching also verify amount? If the txid is derived deterministically, txid collision between different orders is practically impossible (order id + date). We could include an amount check as defense: on txid match, if amounts differ, that's an anomaly — should we still advance? That complicates state. Keep it simple: match by txid (that's what the spec says: "match statement entries to orders by txid"). Include `amountMinor` in Settlement for completeness but don't branch on it. Actually, including fields we don't use smells. But it's reasonable for a settlement record to have an amount. The spec says "each has the txid we sent" — that's the only guaranteed field. Let's define `Settlement { txid: string; amountMinor: number; settledAt: Date }` and use only txid for matching. Hmm, "don't assume" — the amount on the settlement is a natural assumption; mark with an ASSUMPTION comment? The instruction says: "if a symbol you need is genuinely not present in the task, don't silently guess: use the most defensible reading and mark it at the important spot with a single `// ASSUMPTION: <what was unresolved>` comment."

The Settlement shape is unresolved → define it, and put one ASSUMPTION comment on the type. Bank `send` response classification: which HTTP status means "duplicate" is unresolved → ASSUMPTION comment. Let me put an ASSUMPTION on the bank client's classification mapping (e.g., 409 → duplicate; 5xx/408/429/network → transient; other 4xx → permanent; 2xx → accepted).

Now the data model.

Order: what the platform pays to suppliers.
- id: cuid/uuid string
- supplierId / key: bank account key (IBAN or similar). `bank.send({txid, amount, key})` — key is the beneficiary.
- amountMinor: integer
- effectiveDate: Date (the date for which the payment is valid)
- status: state machine
- attemptCount: int
- txid: stored derived txid? We could always re-derive (deterministic), so storing is optional but useful. Since the derivation is stable, we can compute on demand: `deriveTxid(order)` = hash(orderId + effectiveDate). Store for queryability? "The txid is derived, not generated" — derivation at send time. We can derive in the service: `txid = deriveTxid(orderId, effectiveDate)`. We don't need to persist, but the repository could... hmm, keep it derived; a pure function in the service. Actually, storing `txid` on the order is redundant with derivation. The spec emphasizes derivation; let's not store and always derive. But wait — matching statement entries to orders: `reconcile` gets a settlement with a txid, and it needs to find the order whose derived txid equals that txid. If txid = H(orderId, effectiveDate), we can't reverse the hash. So reconciliation needs to: fetch candidate orders (those in awaiting-state whose effectiveDate is within the window's dates), compute the derived txid for each, and check membership against the set of settlement txids. That works: for each unsettled order in the window, compute txid, check if it's in the settlement set → settled; else → absent (if past lag) → resend candidate.

Alternative: store txid in a column to enable direct lookup. "Derive" still holds (derive and store once, and every resend reuses it). Hmm. The spec says "derived deterministically from stable order attributes and the effective date, so that the same order on the same date always produces the same txid." Deriving on the fly satisfies this. But for reconciliation, if we store txid, the query is simpler: `findMany({ txid: in settlementTxids })`. Both are defensible.

Which is better? If we store, we create a risk of divergence (stored vs. derived). If we derive on the fly, the service owns the derivation, and it's a pure function — testable. Let's derive on the fly: the repository fetches "orders in the window needing evidence" (status in awaiting-state, effectiveDate within the window's dates) and the service computes the txid for each.

Hmm, wait, but there's a subtlety: a window is a time range [from, to). `getStatement(date)` takes a date (a day). The bank's statement is per-day. So `reconcile(window)` — the window is probably a time range like the last 30-60 minutes, or a day range. Since the statement is per-day, the window should be expressed as a range of dates. Let me define:

```ts
interface ReconcileWindow {
  from: Date; // inclusive, day-granularity
  to: Date;   // exclusive, day-granularity
}
```

The job runs every 15 min; each run calls `getStatement(day)` for each day in [from, to). With ~30 min publishing lag, the job could cover today + yesterday, e.g., `window = { from: startOfToday - 1 day, to: today }`... Let me think.

The processor (scheduled every 15 min) computes the window: since there's up to ~30 min lag, today's statement isn't complete until the end of the day + 30 min. So a run at time T should reconcile:
- days fully in the past (all dates before today): their statements are complete; absence = proof.
- today: statement still in flux; only useful for detecting settlements (timeout-but-settled), not for proving absence (today isn't yet past lag).

So `reconcile(window)` takes a window of dates and:
1. For each date in the window, fetch statement entries → set of (date, txid).
2. Find orders whose effectiveDate is in the window and whose status is in an "awaiting-evidence" state (sent-accepted, sent-transient, or a resend with same properties).
3. For each order: if derived txid is in the settlement set → settled (state: settled). "Orders already matched are skipped before any decision is made about them."
4. Otherwise (absent): if the order is past publishing lag → proven absent → allow resend. "Past publishing lag" means: the statement for the effective date is complete, and the send is older than the lag. Concretely: `now >= dayEnd(effectiveDate) + lag` (30 min) and `now >= lastAttemptAt + lag`. The cleanest defensible rule: an order is "past publishing lag" when `now > endOfDay(effectiveDate) + publishingLagMs`. Since the effective date is a day, the bank's statement for that day is complete at endOfDay + 30 min. This is clean and testable. Let me also guard with lastAttemptAt: `now >= max(lastAttemptAt, endOfDay(effectiveDate)) + lag`. Hmm, if the send happened at 10am effective today, end of day + 30 min is much later than send + 30 min. Using only the day boundary is conservative (safer — fewer resends, which is the safe direction). But it means same-day resends don't happen until the next morning. Is that OK for this task? The acceptance tests: "send timed out and the order is proven absent past lag → resend, same txid." The test controls time so this works.

But wait — there's a subtlety in "proven absent" for the *current day*: we shouldn't prove absence for today's entries, because today's statement is still incomplete. Day-boundary rule handles this: orders effective today are not yet "past lag" until tomorrow + 30 min.

But what about settlement detection? Even within the day, if the order is in the statement, we mark it settled — that's safe (presence is evidence regardless of lag). Yes: presence → settled (no lag required); absence → needs lag to be proof.

Now, resends: "after reconciliation proves absence, resend is only allowed, with the same derived txid." So `reconcile` itself triggers a resend? The spec says "reconcile(window) is the only path to resend." So reconcile decides and resends (via the bank client) — or marks the order for resend and executePayments picks it up? The spec says "reconcile(window) is the only path to resend" — meaning only reconcile can permit/trigger a resend. If reconcile marks `needs_resend` and executePayments sends, then executePayments becomes a path to resend, violating "reconcile is the only path to resend"? Hmm. The intent is that no timeout/exception/retry counter can trigger a resend; only proven absence from the statement can. If executePayments sends an order marked `resend_authorized` by reconcile... the *decision* comes from reconcile. But the literal wording: "the only thing that can cause a resend is reconciliation proving absence."

Two designs:
A) `reconcile` does the resend inline: after proving absence, call `bank.send` with the same txid, increment attempts, handle the outcome (accepted/duplicate/transient/permanent).
B) `reconcile` marks `status = 'awaiting_resend'` (or `resend_permitted`) and a separate step (a processor or executePayments) performs the send.

Design A is more literally compliant: reconcile is the only code path that calls send for a resend. But then executePayments is only for initial send of new pending orders, and reconcile also sends. Hmm, but is it weird for reconcile to also do sending? The spec section 3: "For orders still awaiting evidence **and past publishing lag** — absence from the statement is proof that the send didn't land, and only then is a resend allowed, with the same derived txid." It says resend is "allowed" — it doesn't say reconcile executes it.

Design B with gating: `executePayments()` sends orders in `pending` (new) state and... if it also sends `resend_permitted`, then the "only path to resend" is arguably broken. Because executePayments is the sender. But the *permission* comes from reconcile. Hmm.

Let me reconsider: I think the cleanest is that reconcile does the resend itself (design A). Then executePayments() = first-send path for new pending orders only; it never resends. The send path (executePayments) can record "outcome unknown" but never resends. Reconcile: match → settle; else past lag → proven absent → if attempts < 5, increment and send (same txid); classify outcome; if 5th attempt fails (transient/permanent? any outcome other than settled), move to parked.

Wait, "cap attempts at 5; after that, move to manual review." What is an "attempt"? A call to bank.send. Initial send = attempt 1. Resends = attempts 2..5. After the 5th attempt's outcome isn't success (and reconcile can't prove it settled), move to `parked` (manual review, terminal).

Note: if the 5th attempt is "accepted" (in flight), the order is awaiting evidence with attempts=5. Then reconcile proves absence → attempts would become 6 → over cap → parked. Good: parked is triggered by reconcile too.

Also: what if the 5th attempt is transient (unknown)? Order stays awaiting; reconcile proves absence later → parked (attempts is already 5, can't resend). Good.

If the 5th attempt is a permanent rejection? A permanent rejection means the bank rejected — but can a permanent rejection prove that the payment didn't land? For example, "blocked account" → payment was not executed. Hmm, but the safe direction: treat permanent rejection as "we know it didn't land"? The spec says to classify each and "handle each differently." For permanent: the bank explicitly rejected — the money didn't move (a rejection is a rejection; it's not in flight). So the handling: mark `rejected`... but can we retry? "Malformed, blocked account, closed beneficiary" — these are conditions that won't self-heal; retrying with the same txid will get the same rejection. But is rejection proof of absence? Not via the statement — it's a direct signal from the bank that the instruction was rejected. Hmm, but is that safe? If the bank says 400 "malformed," it wasn't executed. I think it's safe to treat a permanent rejection as "definitively not paid, no point retrying with the same txid"... but wait — we shouldn't just mark it failed and forget ("never mark it failed-and-forget"). Hmm, that was about exhaustion. For permanent rejection, what's the right terminal state? Options:
- Move to `failed` with the rejection reason, human reviews (not auto-reverted, not forgotten).
- Let reconcile retry? No — the bank rejected; resending the same txid is pointless; but the spec says only reconciliation can permit resends... a permanent rejection is knowledge, not unknown. Resending the same txid after a permanent rejection will get the same rejection.

I think: permanent rejection → order moves to `rejected` state (a kind of terminal state, reviewed by a human, with the reason stored). Not auto-retry, not forgotten. This is "handle each differently":
- accepted → `sent` (awaiting evidence)
- duplicate → `sent`/effectively success: the bank already has it → awaiting evidence too (the original is in flight or settled). Actually, duplicate means the bank already received this txid — the original send is probably accepted; treat as awaiting evidence (reconcile will settle). Could also mark as `sent`. Duplicate = success, not error.
- transient → `unknown`/`sent_unknown` (awaiting evidence, outcome unknown)
- permanent → `rejected` (terminal-ish, human review, reason stored)

State machine (status column):
- `pending` — created, not yet sent
- `sent` — bank accepted (or duplicate), awaiting statement
- `outcome_unknown` — transient error; awaiting statement
- `settled` — matched to a statement entry (paid). Terminal (happy path).
- `rejected` — permanent rejection; human review. Terminal.
- `parked` — attempts exhausted; human review. Terminal.

Hmm, is `rejected` OK as a terminal? Spec: "after that [5 attempts], the order goes to a terminal state a human reviews. Never auto-revert, never release, never mark it failed-and-forget." That's about exhaustion. For permanent rejection, the bank explicitly said no — the payment wasn't executed (a rejection, not a timeout). Marking it `rejected` with a reason and leaving it for humans is safe: we don't auto-retry (the bank said no to this instruction; retrying with the same txid = same rejection; a new txid is out of scope — a new txid would be a new instruction and risks double-pay... actually no, if it was rejected, no money moved; but deriving a new txid contradicts "same order same date same txid"). Keep `rejected` as a review state.

Wait, can permanent rejection also be "unknown"? A 4xx from the bank means the bank processed the request and rejected it — it wasn't executed. That's knowledge. OK.

Now, which states are "awaiting evidence" for reconciliation? `sent` and `outcome_unknown`. Both need matching against the statement. And both are candidates for proven-absence resend (if past lag).

State `pending`: never sent; executePayments sends it (attempt 1). Reconcile shouldn't touch `pending` (never sent, so its absence from the statement is meaningless).

Now, the "safe to run every 15 min, including overlapping windows" requirement: "running twice over the same window, or over overlapping windows, must not change anything the first run already settled. Orders already matched are skipped before any decision is made about them."

Key idempotency concerns:
1. Settlement: once an order is `settled`, reconcile skips (only queries `sent`/`outcome_unknown`). The query itself excludes settled. Also within one run, two settlements with the same txid? The txid→order mapping is unique per (order, date) since the derivation is injective over the orders we process. Fine.
2. Resend within reconcile: if two overlapping runs both see the same order as "proven absent" and both resend → double resend! We need a guard: increment attempts atomically before sending, or transition the state. How to make this safe? Use a conditional update (compare-and-set): `UPDATE orders SET attempt_count = attempt_count + 1, last_attempt_at = now WHERE id = ? AND status IN ('sent','outcome_unknown') AND attempt_count = ? AND ...` — if the update affects 0 rows, another run already took it → skip. That's a repository-level atomic claim. In Prisma: `prisma.$transaction` with a check, or better `updateMany` with a condition and check `count`. `updateMany` is atomic in Postgres; if `count === 0`, someone else claimed. This is the defensible pattern without raw SQL.

Actually, can we do better with `prisma.$transaction([...])`? `updateMany` with a WHERE including the current attempt_count gives us CAS semantics. Let's do this:

```ts
// repository
async claimResend(orderId: string, expectedAttempts: number, txid: string, now: Date): Promise<boolean> {
  const res = await this.prisma.payoutOrder.updateMany({
    where: { id: orderId, attemptCount: expectedAttempts, status: { in: ['sent', 'outcome_unknown'] } },
    data: { attemptCount: expectedAttempts + 1, lastAttemptAt: now, txid },
  });
  return res.count === 1;
}
```

Hmm wait, if we do claim first (increment attempts, record the resend as in-flight?), the order is still in `sent`/`outcome_unknown` state — the other overlapping run will see the same status but attemptCount has changed → its CAS fails (expectedAttempts is stale) → skip.

But subtlety: the other run might have read the order before our update (both read attempts=1), both try to claim with expectedAttempts=1 → only one updateMany affects 1 row (atomic) → the other gets 0 → skip.

Also, the claim should only happen for orders that are past lag; that's a service-level decision using `now`. Fine.

What state should the order be in after claiming but before we know the send outcome? We could introduce an in-flight marker, but... the state after the send outcome is: accepted→sent, duplicate→sent, transient→outcome_unknown, permanent→rejected. Between claim and outcome, it's still the old status — fine, because the claim's CAS on attemptCount prevents double-claim. If the process crashes between claim and send, the order has attempts incremented but no send was made... then the next reconcile: absent (nothing was sent), past lag → claim again (attempts now 2) → send. Attempts incremented without a send — a slight over-counting of attempts; safe direction (we err on parking sooner, never on double-pay). Acceptable; we can note it in a comment. Actually wait — is that safe? If a crash happens after claim, before send, we lose one attempt slot. Worst case: 5 attempts → parked even though the bank might have only seen 4. Parked = human review, not auto-reverted. Safe direction. OK.

Alternatively, claim as part of transition to a new status like `resend_in_flight`? That adds a state that doesn't need matching... it is awaiting evidence (if the send actually happened). Keep it simple: no new state; CAS on attemptCount.

3. Duplicate handling in reconcile: the settlement set might have the txid multiple times (both sends landed — the incident!). Matching is by txid → one order. We don't count how many settlements there are; the order settles once. (The double-pay incident is detected by the bank/treasury; the txid being present in both sends means both entries have the same txid — the order settles once, and the treasury sees two settlements with the same txid. Not our problem per the spec.)

Now, `executePayments()`:
- Fetch `pending` orders (not yet sent). For each: derive txid from (orderId, effectiveDate), amountMinor, key → `bank.send`.
- Classify outcome:
  - accepted → status `sent`, attempts=1, lastAttemptAt=now, store txid? (we derive, so optional — store `txid` for audit? Let's not store txid... hmm, actually, storing txid makes auditing and reconciliation queries easier. But the derivation is the source of truth. Let me think again: if we store `txid`, the repository could match settlements by `txid in [...]` directly — much more efficient than fetching all candidates and hashing each. And "the txid is derived, not generated" is still satisfied: we derive it deterministically and store the derived value; we never use a random UUID. Re-sends use the same derived txid (recomputed, same value).

  Efficiency aside (not a concern at this scale), which is cleaner for the "derived not generated" requirement? The requirement is about the value being deterministic, not about where it lives. Both satisfy it. But there's a correctness angle: if someone changes the derivation function (e.g., adds a field), the stored txid and the newly-derived one diverge → reconciliation breaks. If we derive on the fly at both send and reconcile time, a function change changes both consistently... but it changes txid between the send and the reconciliation → mismatch with what the bank has! Wait no — the bank has the txid we *sent*. If the derivation changes between the send and the reconcile, the on-the-fly derivation produces a different txid than the one sent → reconciliation can never match → orders stay unknown → resends with a new txid → double-pay risk!! Whereas a stored txid always reflects what was actually sent.

  Oh, that's a strong argument for storing the txid: it records what was actually submitted. Deterministic derivation ensures the same order+date always maps to the same txid (so the bank recognizes a resend as the same instruction), and storing pins what was sent. Hmm, but the spec's second bug: "the txid is regenerated fresh on each attempt, so even if we checked the statement, we couldn't match the first send to the order." The fix is to make it deterministic. Storing adds robustness.

  Let's store `txid` (string) — populated at send time with the derived value; re-sends assert (re-derive and use the same value). Actually, on re-send, the service should re-derive and verify it equals the stored one (defense), or just use the stored one. The spec: "resend is allowed, with the same derived txid." Derive and use the derived value (which equals the stored one by determinism). For reconciliation matching: use the stored txid (what we actually sent). On first send: derive and store.

  Hmm, wait — is there a scenario where the stored txid is stale (null)? `pending` orders have no txid yet (never sent). `sent`/`outcome_unknown` have it. So reconciliation: query orders in the window with status in (sent, outcome_unknown) and txid non-null → match by txid against the settlement set. Clean and efficient. And `claimResend` can include `txid: expectedTxid` in the WHERE for extra safety. Let's do that.

- duplicate → status `sent`, attempts? A duplicate means the bank already has this txid — a previous attempt landed at the bank. Should a duplicate count as an attempt? An attempt was made before (that's why it's a duplicate). For a resend (reconcile-triggered), we already incremented attempts before sending. The first send in executePayments can't be a duplicate (never sent before)... unless the order was re-inserted? No. So duplicates only happen in the reconcile-resend path. On duplicate: set status to `sent` (the bank has it; awaiting settlement). attempts is already incremented by the claim. Good.
- transient → status `outcome_unknown`, attempts=1 (in executePayments), lastAttemptAt=now.
- permanent → status `rejected`, rejectionReason stored, attempts=1.

For executePayments (initial send), do we use a CAS claim too? Pending orders: two overlapping executePayments runs could both pick the same pending order → double send with the same txid → the bank returns duplicate on the second → handled as success, not a double-pay (same txid!). Actually, that's the beauty of deterministic txid: even a duplicate initial send is safe (the bank deduplicates). But let's still CAS (status pending → attempt) to avoid confusion. `updateMany where { id, status: 'pending' }` → set to a transitional state... we can't set the final state before the outcome. Claim: set `lastAttemptAt`, `attemptCount=1`, `txid`, keep status `pending`? Then a concurrent run sees attemptCount=1 → CAS fails. But the status stays `pending` during sending — a concurrent executePayments run re-fetches pendings... the CAS prevents double-claim. After the outcome, set the final status. If we crash mid-send, the order stays `pending` with attempts=1 → the next run re-fetches pending... would it re-claim? The CAS expects status pending and attemptCount=0? Let's define the claim for initial send: `where { id, status: 'pending', attemptCount: 0 }` → data `{ attemptCount: 1, txid, lastAttemptAt }`. After crash: order is pending, attemptCount=1 → not eligible for initial claim (attempts must be 0) → stuck? executePayments only picks attemptCount=0 pendings. A crashed pending with attempts=1 would never be sent again → stuck. Hmm. But same txid was derived; if the send actually reached the bank, we'd want reconcile to catch it — but reconcile only looks at sent/outcome_unknown, not pending. Stuck pending = bad.

Alternative: don't over-engineer executePayments. The spec's focus on idempotency is on reconcile. For executePayments, the double-send hazard is mitigated by the deterministic txid (bank deduplicates → duplicate outcome → safe). We can CAS to reduce duplicates but handle the crash case: claim transitions pending → `sending`? Add a state? Hmm, state bloat.

Let me reconsider: maybe executePayments should be simpler — fetch pending with attemptCount=0, for each: derive txid, send, classify, update. Without CAS. Rationale: the same-txid deduplication makes concurrent double-send harmless (worst case, one "duplicate" outcome recorded). And the spec doesn't demand idempotency of executePayments (only reconcile's). "Safe to run every 15 min" is about reconcile. OK: no CAS in executePayments; CAS in reconcile's claim. I'll note in a comment that the duplicate outcome exists precisely to make accidental double-sends of the same instruction safe.

Hmm, but wait: in executePayments, if two concurrent runs both send, both might get "accepted" (race before the bank dedups)? No — the bank dedups by txid at the point of acceptance: the second one returns duplicate. The bank's dedup is exactly what the "duplicate" outcome is for. OK.

Now, the reconcile job: a NestJS processor with `@Cron`. The wiring convention mentions "processor" as a provider type. Let me create `src/payout/payout.processor.ts` with:

```ts
@Injectable()
export class PayoutProcessor {
  constructor(private readonly payout: PayoutService) {}

  @Cron(CronExpression.EVERY_15_MINUTES)
  async reconcileScheduled(): Promise<void> {
    const window = computeReconcileWindow(new Date());
    await this.payout.reconcile(window);
  }
}
```

Window computation: the job should cover dates whose statements might have new entries since the last run, plus enough overlap for safety. Since the statement lags by ~30 min, we need to cover at least today (entries from the past few hours appear in today's statement with a delay) and yesterday (the end-of-day entries land with the 30-min lag). Overlapping windows are explicitly fine ("safe to run every 15 min, including overlapping windows"), so we can always cover [yesterday, today) ∪ today → i.e., dates from (today - 1) through today. Let's define: window = { from: startOfToday - 1 day, to: endOfToday } → dates: yesterday and today. Each run refetches both days. The bank refetch is cheap and overlap is safe by design.

But wait — "proven absent past lag" for yesterday's orders: `now >= endOfDay(yesterday) + 30min` = today + 30 min... hmm, endOfDay(yesterday) = startOfToday. So yesterday's absence is provable from startOfToday + 30 min = 00:30 today. Correct: the bank's statement for yesterday is complete by 00:30 today (30-min lag). Good.

Today's orders: endOfDay(today) + 30 min → not provable until tomorrow 00:30. So today's absents don't get resends today — conservative. Presence settles regardless. Good.

Should the window also include older days? "Up to ~30 min lag" — older than yesterday is already fully reconciled by prior runs; no need to refetch (and it's harmless if we do). Keep to [yesterday, today]. Hmm, what about orders effective a few days ago that were `outcome_unknown` from a long-ago send and haven't been reconciled (e.g., the system was down for a week)? A [yesterday, today] window keyed on effectiveDate would never revisit them → stuck in unknown forever. Hmm. Should reconciliation be keyed on effectiveDate in the window, or should we also catch stale unknown orders?

Let me re-read: "`reconcile(window)` — match statement entries to orders, advance state. Must be safe to run every 15 min, including overlapping windows." And the spec: "For orders still awaiting evidence **and past publishing lag** — the bank lags by ~30 min — absence from the statement is proof."

The natural read: window = the time range to reconcile. Orders in scope: those awaiting evidence whose effectiveDate is within the window. The publishing lag rule handles the rest. For robustness, the window could be derived as "all dates on which there exist awaiting-evidence orders, capped at N days back"? That's over-engineering. But a stuck-forever unknown order violates "never auto-revert / safe direction" — well, stuck unknown isn't a revert; it's a limbo. Hmm.

Defensible middle ground: the processor's window covers [earliest date among awaiting-evidence orders, today] but bounded — e.g., from min(today-1, oldest pending evidence date) to today, with a cap (say 7 days back)? More code. Alternatively, the service's reconcile takes the window and processes orders with effectiveDate in [from, to). The processor computes a window that's safe for steady state: [today - 1, today + 1)? Let's keep it simple: the window = { from: startOfToday - 1 day, to: startOfToday + 1 day } (i.e., dates yesterday..today inclusive — `to` is exclusive at startOfTomorrow). Stale orders older than 2 days: an ASSUMPTION comment? Or handle them: the service, when computing candidates, could also include orders past lag regardless of window? No — that breaks the "window" semantics and makes overlap safety harder to reason about.

Hmm, actually, let me reconsider. What does "window" most plausibly mean? A reconcile job that "runs every 15 min over overlapping windows" — a time window like "the last 30 minutes plus 30 min of overlap." Since the statement is per-day, the window maps to a set of days. Let's define the window as a half-open [from, to) over time, and the service:
1. Determines the affected days: all calendar days that overlap [from, to).
2. Fetches statements for those days.
3. Finds orders awaiting evidence with effectiveDate in those days (i.e., effectiveDate < to and endOfDay(effectiveDate) >= from... roughly).
4. Match/decide as above.

The processor: window = [now - 45 min, now] (30 min lag coverage + 15 min cadence overlap → 45 min). Overlapping by design. Day mapping: at 00:10, now-45min = yesterday 23:25 → days = {yesterday, today}. At 10:00 → 9:15..10:00 → days = {today}. Hmm! At 10:00, the window only covers today — but yesterday's 00:30+ absence proof: orders effective yesterday past lag are... their effectiveDate (yesterday) is not in days={today} → not processed → their absence isn't proven today → no resend until tomorrow's run? Tomorrow the window [now-45m, now] → days = {today(new)} → yesterday(old) not included → never processed!! Stuck.

That's the stale-order problem again. A 45-min rolling window keyed on effectiveDate only sees each date during a narrow period. Orders effective yesterday can only be resended if a run's day set includes yesterday AND the run is past yesterday's lag (after today 00:30). A 45-min rolling window includes yesterday only during 00:00–00:45. The first run after 00:30 (e.g., 00:30 or 00:45) includes yesterday → proven absent → resend. OK, it works! The 00:45 run: window [00:00, 00:45] → days {today} — wait, 00:00–00:45 is all today. Days = {today} only. Yesterday not included. The 00:30 run: [23:45, 00:30] → days {yesterday, today} → includes yesterday → orders effective yesterday, now > endOfDay(yesterday)+30min = 00:30 → proven → resend. But only if a run lands in [00:30, 00:45]. 15-min cadence: runs at 00:30 and 00:45 — the 00:30 run's window [23:45, 00:30] contains 00:30 as the to (exclusive) → days = yesterday ∪ today. Good. The 00:45 run [00:00, 00:45] → today only. So there's a 15-min window during which yesterday is in scope and past lag. If the job is down during 00:30–00:45... the next day's window includes "yesterday" = today only. Orders effective yesterday (2 days ago from then) are never revisited. Edge case (job down for a 15-min gap at midnight). Hmm.

This is getting fragile. A simpler, more robust design: the processor's window is date-based, not a rolling time: cover [today-1, today+1) days — i.e., always refetch yesterday and today's statements. This handles: today's settlements (appearing with 30-min lag), yesterday's absences (provable from today 00:30), yesterday's settlements (end-of-day entries, appearing by today 00:30 — wait, a payment executed yesterday 23:59 might appear in yesterday's statement at today 00:29). All covered by always fetching yesterday+today. And stale orders older than 2 days: still an issue, but rarer; and honestly, an order in limbo for 2 days should be noticed by a human; the spec doesn't require indefinite recovery from the auto path. We can add a comment: orders awaiting evidence beyond the window are left for manual review (safe direction: no auto-action outside the lag-proven range).

Hmm wait, actually, let me reconsider once more. What if reconcile's scope is "all orders awaiting evidence" (no window filter on orders) and the window just determines which days' statements to fetch? Then: a stale unknown order effective 10 days ago: statements fetched = {yesterday, today}; the order's txid is not in them; is it past lag? endOfDay(10 days ago) + 30 min < now → yes → proven absent → resend. But wait — is that correct? Absence from yesterday/today's statements doesn't prove absence from 10 days ago's statement! The payment might have settled 10 days ago, in the 10-days-ago statement, and the system just missed it. Resending → double-pay!! No. Proven absence requires checking the statement for the order's effective date. So the order's effectiveDate must be within the fetched days. → The scope has to be keyed on effectiveDate ∈ fetched days. The window → days → orders with effectiveDate in days. So a stale order's date isn't fetched → not processed. Stuck until a human. OK, that's the safe design. Accept it, and document it.

So: window = { from: Date; to: Date } (half-open over time); service maps to day list: each calendar day (UTC? local?) overlapping [from, to). Timezone: use UTC for determinism (bank statements per-day — assume UTC day boundaries; ASSUMPTION comment). The processor uses window = [startOfUtcDay(today) - 1 day, startOfUtcDay(today) + 1 day) → days = {yesterday, today}.

Wait, do we need a 1-day overlap for safety ("overlapping windows")? The processor's window is a fixed pattern; overlap happens because today is refetched each run. Yesterday is refetched for the whole day today (each run). Overlap = same day refetched 96 times a day → must be idempotent → our design is (settlements are skipped; claims CAS; absences → at most one successful claim).

Also "must not change anything the first run already settled": a run settles an order; a second run skips (status settled not in the candidate query).

Now, the service structure:

```ts
export interface ReconcileWindow { from: Date; to: Date }

@Injectable()
export class PayoutService {
  constructor(
    private readonly repo: PayoutRepository,
    private readonly bank: BankClientPort,
  ) {}

  async executePayments(now: Date = new Date()): Promise<ExecuteSummary> { ... }
  async reconcile(window: ReconcileWindow, now: Date = new Date()): Promise<ReconcileSummary> { ... }
}
```

Inject `now` for testability (behavior tests need controlled time). A legitimate pattern. Or use a Clock service. A parameter with default is simpler and testable. Hmm, the "test behavior not implementation" — tests call the service with fakes (a fake bank client, a fake repository or an in-memory real repository?).

Test strategy: unit tests for the service with a fake bank client and a fake repository? But the repository is a Prisma class — faking the repository means testing service logic with a stubbed persistence. That's behavior-level-ish (state transitions). But "test behavior not implementation" — better: test with a real repository on a real Postgres? We can't run a DB in this environment... but the tests are artifacts; CI will run them. A Postgres test setup (testcontainers or a local db) is heavy. The convention: "repository is the only layer that touches the DB" — the repository uses PrismaClient. For tests, the cleanest is: an in-memory fake implementing the repository's interface? But the repository is a concrete class with PrismaClient injected. We can make the repository's public API small and inject a fake that implements the same interface in tests (via a TS `satisfies`/interface). That's standard, and tests remain fast and hermetic.

But "never assert only that a call happened" — tests should assert end-to-end state transitions: e.g., "send timed out but the order is in the statement → no resend, order settles": set up an order in the repo (fake) with status outcome_unknown, txid T; bank fake: statement contains T; run reconcile; assert order status is settled AND bank.send is not called (or, the bank's send call log is empty — that's an assertion about behavior: no resend happened; plus the status assertion). Also assert that the send, when it does happen, uses the same txid (proven-absent test: capture the send argument's txid === derived/original). Attempt exhaustion: 5 attempts, then reconcile → status parked, no 6th send, never reverted.

So tests: a service with a fake bank (a scripted outcome sequence) + a fake repository (an in-memory implementation of the repository contract). The fake repository has to implement the same async contract as the real repository. Let's define the repository's public methods (the contract):

```ts
export class PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // used by executePayments
  findPending(take?): Promise<PayoutOrderRow[]>   // status 'pending', attemptCount 0
  recordInitialOutcome(orderId, { status, txid, attemptCount, lastAttemptAt, rejectionReason }): void  // or update by id

  // used by reconcile
  findAwaitingEvidence(dates: string[]/*or Date[]*/): Promise<PayoutOrderRow[]>  // status in sent/outcome_unknown, effectiveDate in dates
  claimResend(orderId, expectedAttemptCount, txid, now): Promise<boolean>  // CAS
  recordResendOutcome(orderId, { status, lastAttemptAt, rejectionReason }): void
  settle(orderId, now): void  // status settled, settledAt
  park(orderId, now, reason): void
}
```

Hmm, a few of these can be consolidated. Let me design the reconcile flow precisely:

```
reconcile(window, now):
  days = daysInWindow(window)                 // list of Dates (UTC midnight)
  statements = await Promise.all(days.map(d => bank.getStatement(d)))
  settlementTxids = new Set(statements.flat().map(s => s.txid))

  candidates = await repo.findAwaitingEvidence(days)   // status in (sent, outcome_unknown), effectiveDate in days

  settledCount = 0; resentCount = 0; parkedCount = 0; stillUnknown = 0

  for order of candidates:
    if settlementTxids.has(order.txid):
      await repo.settle(order.id, now)
      settledCount++
      continue
    // absent from its own day's statement
    if now < endOfDay(order.effectiveDate) + PUBLISHING_LAG_MS:
      stillUnknown++; continue            // not yet provable
    if order.attemptCount >= MAX_ATTEMPTS:
      await repo.park(order.id, now, 'attempts exhausted...'); parkedCount++; continue
    claimed = await repo.claimResend(order.id, order.attemptCount, order.txid, now)
    if (!claimed) { continue }            // a concurrent run already acted
    outcome = classify(bank.send({ txid: order.txid, amount: order.amountMinor, key: order.key }))
    // send might throw? BankClient normalizes; but wrap in try just in case → transient
    applyResendOutcome(order, outcome, now)  // accepted→sent, duplicate→sent, transient→outcome_unknown, permanent→rejected
    if outcome accepted/duplicate → resentCount++
  return summary
```

Wait — a subtlety: `order.txid` — in the candidate query, the txid must be non-null. `sent`/`outcome_unknown` always have a txid (set on first send). OK.

Another subtlety: the settlement check uses the full set of txids across days; the order's effectiveDate is one of the days; a txid derived from (order, its date) won't legitimately appear in a different day's statement (the bank dedups by txid — if the same txid appears on multiple days, it's the same payment; settlement is correct).

The "past publishing lag" check: `now >= addMs(endOfUtcDay(order.effectiveDate), 30*60_000)`. Let me define `PUBLISHING_LAG_MS = 30 * 60 * 000`. Should the lag be configurable? "Configuration is from environment variables only" — for DB URL etc. The 30-min lag is part of the bank contract (a spec constant). A constant is fine; env-configurable adds surface. Keep as a constant, documented. Hmm, "up to ~30 min" — use 30 min (conservative: we use the maximum lag; using less could prove absence too early). MAX_ATTEMPTS = 5 constant.

Edge: `endOfUtcDay` for an effectiveDate of D = startOfUtcDay(D+1) (exclusive). Past lag ⇔ now >= startOfUtcDay(D+1) + LAG.

Now, executePayments flow:

```
executePayments(now = new Date()):
  pending = await repo.findPending()
  for order of pending:
    txid = deriveTxid(order.id, order.effectiveDate)
    raw = await bank.send({ txid, amount: order.amountMinor, key: order.key })   // might throw
    outcome = classify(raw)   // throws → transient
    switch outcome:
      accepted → repo.recordOutcome(order.id, { status: 'sent', txid, attemptCount: 1, lastAttemptAt: now })
      duplicate → repo.recordOutcome(..., status: 'sent', ...)   // bank already has it
      transient → repo.recordOutcome(..., status: 'outcome_unknown', ...)
      permanent → repo.recordOutcome(..., status: 'rejected', rejectionReason: raw.reason)
  return summary
```

Wait — attempts for the initial send: attemptCount 0 → 1. In a permanent rejection on first send: status `rejected`, attempts=1. Can a `rejected` order ever be reconsidered? By design, no (a terminal review state). Hmm — but is that right? "Blocked account" might get unblocked; a human reviews and can re-release... "Never auto-revert" is about parked; for rejected, the human decides. Keep it terminal (no auto-path). The spec's 4 outcomes "handle each differently" — rejected is its own terminal state. OK.

Wait, one more: for duplicate in executePayments — can the first send return duplicate? Only if the order was already sent (shouldn't happen for pending/attemptCount=0). If it did, it's success; status sent. Fine.

Now `deriveTxid`: deterministic from order attributes + effective date. E.g., SHA-256 of `${order.id}:${yyyy-mm-dd}` → hex, maybe prefixed. The bank txid format is unknown → ASSUMPTION: a 32-char lowercase hex SHA-256 is accepted by the bank as a txid. Use Node's `crypto.createHash('sha256')`.

```ts
export function deriveTxid(orderId: string, effectiveDate: Date): string {
  const date = toUtcYmd(effectiveDate);
  const digest = createHash('sha256').update(`${orderId}:${date}`).digest('hex');
  return `tx_${digest.slice(0, 32)}`;  // hmm, or full hex?
}
```

Keep it simple: return the full 64-char hex? "Txid" — banks often want alphanumeric; ASSUMPTION comment. Let's do `sha256 hex` (64 chars), maybe prefix `po_`. Keep it plain hex with an ASSUMPTION.

Hmm, wait: should the derivation include supplier key or amount? "Derive deterministically from stable order attributes and the effective date" — order id + effective date is sufficient and matches "the same order on the same date always produces the same txid." Adding more attributes is fine but id+date is the core contract. Use id + date. (If an order's amount changes after a send... we don't allow changes; out of scope.)

Schema (Prisma):

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum PayoutStatus {
  PENDING
  SENT
  OUTCOME_UNKNOWN
  SETTLED
  REJECTED
  PARKED

  // no @map needed for enum values? Enum values are stored as-is; snake?
}
```

Hmm, enums in Prisma: enum values are UPPER_SNAKE by convention; stored as the enum value string. The naming convention says tables/columns snake_case — that's about table/column names via @map/@@map. Enum values are neither; UPPER_CASE is Prisma convention. OK.

```prisma
model PayoutOrder {
  id              String       @id @default(cuid()) @map("id")
  supplierId      String       @map("supplier_id")
  key             String       @map("key")          // beneficiary account key
  amountMinor     Int          @map("amount_minor") // integer minor units
  currency        String       @default("EUR") @map("currency")
  effectiveDate   DateTime     @map("effective_date")
  status          PayoutStatus @default(PENDING) @map("status")
  txid            String?      @map("txid")
  attemptCount    Int          @default(0) @map("attempt_count")
  lastAttemptAt   DateTime?    @map("last_attempt_at")
  rejectionReason String?      @map("rejection_reason")
  parkedAt        DateTime?    @map("parked_at")
  settledAt       DateTime?    @map("settled_at")
  createdAt       DateTime     @default(now()) @map("created_at")
  updatedAt       DateTime     @updatedAt @map("updated_at")

  @@index([status, effectiveDate])
  @@index([txid])
  @@map("payout_orders")
}
```

Amount is Int — Postgres `Int` maps to `integer` (4-byte, max ~2.1B). €18,400 = 1,840,000 minor units fits. But larger amounts? Use `BigInt`? Prisma's BigInt → Postgres `bigint`, JS `bigint`. "Amount is integer minor units end to end" — BigInt is safest but complicates the bank API (`amount: number`?) and tests. The bank's send takes `{txid, amount, key}` — type of amount unspecified. Integer minor units; for platform payouts, Int (up to €21M) is plenty. But "integer end to end" — Int is integer. Use Int (Postgres integer) — defensible; a BigInt would force bigint arithmetic on the bank side. Hmm, I think Int is fine and simpler; I'll note the column is a plain integer.

Do we need a SettlementRecord table (a mirror of statement entries)? Not required — the statement is fetched from the bank per run; we don't persist it. "Deliver the schema" — the orders table is the core. Do we need an audit of actions (send log)? A `payout_events` table for auditing? Not asked for. Keep minimal: one model. Hmm, but "never mark it failed-and-forget" — rejectionReason/parkedAt carry the human-review info. OK, single model.

Migration: "every schema change ships with a migration." So include `prisma/migrations/20250101000000_init/migration.sql`:

```sql
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING','SENT','OUTCOME_UNKNOWN','SETTLED','REJECTED','PARKED');

CREATE TABLE "payout_orders" (
  "id" TEXT NOT NULL,
  "supplier_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "amount_minor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "effective_date" TIMESTAMPTZ NOT NULL,
  "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
  "txid" TEXT,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_attempt_at" TIMESTAMPTZ,
  "rejection_reason" TEXT,
  "parked_at" TIMESTAMPTZ,
  "settled_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "payout_orders_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "payout_orders_status_effective_date_idx" ON "payout_orders"("status", "effective_date");
CREATE INDEX "payout_orders_txid_idx" ON "payout_orders"("txid");
```

Note: Prisma generates `TIMESTAMPTZ` for DateTime (prisma's DateTime is timestamptz by default in recent versions). `updated_at` — Prisma's `@updatedAt` doesn't emit a default in SQL; it's managed in the app. In the migration, `TIMESTAMPTZ NOT NULL` without a default (prisma sets it on every write). Correct.

Also the migration needs `prisma/migrations/migration_lock.toml`? A real repo has it:
```
# Please do not edit this file manually
# It should be added in your version-control system (e.g., git)
provider = "postgresql"
```
Include it for completeness. Is it "not asked for"? "Every schema change ships with a migration" — the lock file is part of a real migration directory. Include; it's a defensible component.

Bank client: interface + HTTP implementation.

```ts
// src/payout/bank-client.ts  — hmm, naming convention: `kebab-case.role.ts`. Is the bank client a "role"? The layout lists feature.module/controller/service/repository. The bank client is a dependency. Options: put it in `src/bank/bank-client.ts`? A separate feature `bank` with a module `BankModule` that exports `BankClient`, imported by `PayoutModule`. That fits the wiring convention ("providers used by another module are exportsed by their own module").
```

Hmm, but "do not create files that aren't asked for" — the bank client is needed (the service depends on it; tests fake it). An interface + an HTTP implementation is a defensible reading. Minimal: a single file `src/bank/bank-client.ts` defining:
- `Settlement` type
- `BankSendRequest` / `BankSendResult` (raw transport outcome)
- `BankClient` interface
- `BankHttpTransport`?

Wait, let me settle on the classification responsibility. "executePayments() classifies what came back" — the service classifies. So the bank client returns something the service can classify. Design:

```ts
export type BankSendResponse =
  | { kind: 'accepted' }                      // 2xx
  | { kind: 'duplicate'; txid: string }       // bank already has the txid
  | { kind: 'http-error'; statusCode: number; reason: string }
  | { kind: 'network-error'; reason: string }; // timeout, socket, DNS

export interface BankClient {
  send(req: { txid: string; amount: number; key: string }): Promise<BankSendResponse>;
  getStatement(date: Date): Promise<Settlement[]>;
}
```

And the service maps:
```ts
function classify(r: BankSendResponse): 'accepted'|'duplicate'|'transient'|'permanent' {
  switch (r.kind) {
    case 'accepted': return 'accepted';
    case 'duplicate': return 'duplicate';
    case 'network-error': return 'transient';
    case 'http-error':
      // 5xx, 408, 429 → transient (unknown); other 4xx → permanent
      if (r.statusCode >= 500 || r.statusCode === 408 || r.statusCode === 429) return 'transient';
      return 'permanent';
  }
}
```

Hmm wait, if the client already returns `kind: 'duplicate'`, then the "duplicate" classification is done in the client, not executePayments. The spec says executePayments classifies into 4 outcomes. To honor that literally, maybe the client should return something more raw: the HTTP status code and body. E.g.:

```ts
export interface BankSendResponse {
  statusCode: number;        // 0 for network failure?
  ...
}
```

Hmm. Or the client throws typed errors? Ugly. Let me think about what's cleanest while keeping the classification in executePayments (and the same classifier reused in reconcile — the spec says executePayments classifies; reconcile also sends (resends) and needs classification — the same private helper is used for both, fine).

Option: the client returns a raw `{ statusCode: number; body: string }`, with network failures as `{ statusCode: 0 }` (or a `networkError: true` flag). Then:

```ts
function classifySend(resp: RawBankSendResponse): SendOutcome {
  if (resp.networkError || resp.statusCode === 0) return 'transient';
  if (resp.statusCode >= 200 && resp.statusCode < 300) return 'accepted';
  if (resp.statusCode === 409) return 'duplicate';       // ASSUMPTION
  if (resp.statusCode >= 500 || resp.statusCode === 408 || resp.statusCode === 429) return 'transient';
  return 'permanent';
}
```

This puts all 4-way classification in the service (executePayments path). The HTTP implementation maps fetch results: response.ok → 2xx statusCode; 409 → 409; network throw → { networkError: true, reason }.

I like this: the bank client = thin transport (only assumes `bank.send` + `getStatement`), the service = business classification.

For `getStatement`, the HTTP implementation fetches `${baseUrl}/statements?date=...` — ASSUMPTION about the URL shape. The body is an array of Settlement. `Settlement = { txid: string; amountMinor: number }` — hmm, do we need amountMinor on Settlement? The bank returns "the txid we sent" — the only guaranteed field. Let's define `Settlement { txid: string; amountMinor?: number }`? Optional feels wimpy. Define `{ txid: string; amountMinor: number }` with an ASSUMPTION that the bank echoes the amount we submitted. Or just `{ txid: string }` — the minimal assumption. The spec: "each has the txid we sent" — minimum is txid. Match on txid only. Let's define `interface Settlement { txid: string }`. Hmm, but a real settlement record... "assume nothing beyond" → minimal is most defensible: txid only. OK: `Settlement { txid: string }`.

Now the HTTP implementation — is it needed for the deliverable? The service needs `BankClient` (interface). Tests fake it. For a runnable app, a real implementation is needed. "Deliver every file the solution needs." A NestJS solution that wires BankClient into a module needs a provider. Include `src/bank/bank-client.ts` (interface + types) and `src/bank/bank-http-client.ts` (the implementation) + `src/bank/bank.module.ts` that exports `BankClient`. Env: `BANK_BASE_URL`, `BANK_API_KEY` (no secrets in the repo — read from env at runtime). Use global fetch (Node 20). Timeout handling: AbortSignal.timeout(ms) — env `BANK_TIMEOUT_MS` default 10000? "Configuration is from environment variables only" — hmm, that means config comes from env (not a .env file in the repo? no — it means don't hardcode config; env vars are the source). Defaults for non-secret tunables in code are OK (like the 30-min lag constant). For timeout, default 10s, overridable.

Hmm wait. Do we want to introduce a `bank` feature directory? The layout convention says `src/<feature>/...`. The feature here is `payout`. The bank is an external dependency. Options: (a) `src/bank/` module; (b) put the bank client files inside `src/payout/`. The wiring convention: "providers used by another module are exportsed by their own module, and that module is importsed by the other." This suggests modules per concern. `src/bank/bank.module.ts` exporting `BankClient` (provided by `BankHttpClient`, bound via a token). Use an injection token: `export const BANK_CLIENT = 'BANK_CLIENT'` or an interface token. In Nest, provide `{ provide: BankClient, useExisting: BankHttpClient }` — an interface as a token works in TS (interfaces are erased; use a string token or a class). Simplest and most robust: a string token `BANK_CLIENT`.

Actually — simpler and fewer files: put everything bank-related in the payout module? The convention favors feature-based modules; the bank client is shared infrastructure. Go with `src/bank/` — cleaner wiring, demonstrating the exports/imports convention. Files:
- `src/bank/bank-client.ts` — token + interface + types (Settlement, BankSendResponse, RawSendResult)
- `src/bank/bank-http-client.ts` — the fetch implementation
- `src/bank/bank.module.ts` — @Module providers: [BankHttpClient], {provide: BANK_CLIENT, useExisting: BankHttpClient}, exports: [BANK_CLIENT]

Hmm, is the HTTP client "not asked for"? The task says the bank API is assumed to exist; we need something that talks to it. A real solution needs it. I think it's needed ("the full solution"). Keep it lean.

Now the module wiring:

`src/payout/payout.module.ts`:
```ts
@Module({
  imports: [BankModule, ScheduleModule.forRoot()... ],
  controllers: [PayoutController],
  providers: [PayoutRepository, PayoutService, PayoutProcessor],
  exports: [PayoutService],
})
```

Controller — do we need one? The layout convention includes one per feature. The task doesn't ask for endpoints. Hmm. The error envelope convention exists... but only matters if there's an API. "Do exactly what the task asks. Do not create files that aren't asked for." The task asks for schema, services, reconcile job, tests. No endpoints → no controller → no error envelope usage. But then `main.ts`/`app.module.ts` — are they "asked for"? "Build the full solution" in NestJS implies a runnable app: main.ts + app.module.ts are needed for the module to be instantiated. The convention layout lists them as the app skeleton. Include `src/main.ts` and `src/app.module.ts` (app module imports PayoutModule). That's the minimum runnable Nest app. No controller (not asked). Hmm — but a NestJS app with zero controllers is fine (just cron).

Wait, but does `ScheduleModule.forRoot()` require `@nestjs/schedule` as a dep? Yes. And `@nestjs/config` for env? We can read `process.env` directly (simpler, no extra dep). Configuration is from env vars — direct `process.env` reads are fine and dependency-light. The BankHttpClient reads `process.env.BANK_BASE_URL` etc. at construction. PrismaClient from `@prisma/client`.

Deps: `@nestjs/common`, `@nestjs/core`, `@nestjs/schedule`, `@nestjs/platform-express`, `@prisma/client`, `reflect-metadata`, `rxjs`. Dev: `prisma`, `typescript`, `vitest`, `tsconfig` etc.

Should I include a `package.json` and `tsconfig.json`? "Deliver every file the solution needs." A NestJS+Prisma+Vitest project needs package.json, tsconfig.json, vitest.config.ts. The convention block doesn't list them, but the "file layout" block is the *source* layout, not the whole repo. Hmm. The parser reads `### path` + fenced block. Extra files are allowed ("decide the file layout yourself"). To make the solution complete and runnable, include:
- `package.json` (with scripts: start, build, test, prisma migrate)
- `tsconfig.json` (strict, ESM)
- `vitest.config.ts`? Vitest can work without config (defaults). Tests import from `src/...` — with ESM + TS, vitest handles it. Might need `test/vitest.config.ts`? No — put `vitest.config.ts` at the root. Include a minimal one for explicitness? If it works without, skip? Actually with `"type": "module"` and TS path imports (relative), vitest's defaults are enough. But ESM + TS: vitest transforms TS automatically. Relative imports without extensions in TS source — vitest (via esbuild) resolves `./payout.service` fine (doesn't enforce node ESM rules). OK, vitest works with extensionless relative imports. Include a small vitest.config.ts just to be safe? Hmm, "don't create files that aren't asked for" — a vitest config is arguably needed for a working test setup... I'd rather minimize: no vitest.config.ts (defaults are enough). But then `test/` discovery: default include is `**/*.{test,spec}.?(c|m)[jt]s(x)?` — `test/payout.service.spec.ts` matches. Good, no config needed.

`package.json` — definitely include (deps + scripts). `tsconfig.json` — needed for the tsc build; include with strict, ES2022, ESM module resolution ("NodeNext"? or "Bundler"?). With `"type": "module"` and NestJS decorators, the common setup: `"module": "NodeNext", "moduleResolution": "NodeNext"` requires explicit `.js` extensions on relative imports in TS source... which is annoying but correct for Node 20 ESM. Or `"module": "ESNext", "moduleResolution": "Bundler"` (no extensions, works with tsc? tsc with Bundler resolution doesn't require extensions; the emitted JS has extensionless imports, which Node ESM fails at runtime... unless it's a NestJS build via `tsc -p tsconfig.build.json`... hmm, real-world NestJS ESM projects often use `"module": "nodenext"` + explicit `.js` extensions, or use tsx/ESBuild.

To keep the artifact robust, let's use NodeNext + explicit `.js` extensions on relative imports in TS source. That's the correct modern Node 20 ESM setup. Files import like `import { PayoutService } from './payout.service.js';`. Yes, slightly unusual-looking but correct.

Wait — but for tests, `test/payout.service.spec.ts` imports `../src/payout/payout.service.js` — does vitest resolve that to `.ts`? With NodeNext, TS allows `.js` → `.ts` resolution. Vitest handles `.js` → `.ts` mapping correctly (esbuild + its resolver does). Yes, vitest supports it.

Prisma schema + generator: `prisma-client-js`. Import in TS: `import { PrismaClient, PayoutStatus } from '@prisma/client';`.

Now — the repository with Prisma. Methods:

```ts
@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}
```

Wait — PrismaClient is created where? Convention: "repository is the only layer that touches the database" — the repository holds PrismaClient. Create it in the repository's constructor (`new PrismaClient()`)? Or provide it via a module provider (common: `provide: () => new PrismaClient()` with onModuleDestroy). If we create it in the repository's constructor, the repository "touches the DB" — fine per the convention. But lifecycle: on app shutdown we should disconnect. We can add `onModuleDestroy` to the repository to call `$disconnect`. The repository is an @Injectable in providers — lifecycle hooks on it work. Let's do:

```ts
@Injectable()
export class PayoutRepository implements OnModuleDestroy {
  private readonly prisma = new PrismaClient();
  async onModuleDestroy() { await this.prisma.$disconnect(); }
  ...
}
```

Self-contained, and the only DB touch. DATABASE_URL is read by PrismaClient from env automatically (schema uses env("DATABASE_URL")).

Row type: use Prisma's `PayoutOrder` type (exported from @prisma/client) — but that couples the service to the Prisma-generated type... the repository can map to a plain domain DTO to keep the service Prisma-free. Is that over-engineering? The convention says the service has zero Prisma client calls — using a generated type isn't a client call. But cleaner layering: the repository exposes a plain interface `PayoutOrderRecord`. Hmm. Let me keep it simple: the repository methods return `PayoutOrder` (Prisma's type) — wait, that imports '@prisma/client' in the repository only; the service imports the type from the repository file. We can define and export a DTO in the repository:

Actually, let's define the domain shape in the service or a types file. The simplest defensible: the repository returns Prisma `PayoutOrder` objects; the service only consumes a subset of fields. Type import from '@prisma/client' in the service for the parameter type — is that a "Prisma client call"? No, just a type. But purists... the convention only forbids client calls in the service. Type-only imports are fine, but to keep the layering clean, let's define a `PayoutOrderView` interface in the repository and export it; the service depends on that. Hmm, that's duplication. Or the service defines what it needs and the repository returns compatible rows.

Decision: the repository exports a `PayoutOrderRow` interface (plain: id, key, amountMinor, effectiveDate, status, txid, attemptCount, lastAttemptAt, rejectionReason). The repository maps Prisma models to it (select only needed fields). The service uses `PayoutOrderRow`. Clean, and the repository is the only file that imports @prisma/client (plus the module? no).

Repository methods (final):

```ts
// for executePayments
async findPending(): Promise<PayoutOrderRow[]>
  // where { status: PENDING, attemptCount: 0 }, orderBy createdAt, take 100

async recordSendOutcome(id: string, data: {
  status: PayoutStatusValue; txid: string; attemptCount: number; lastAttemptAt: Date; rejectionReason?: string | null;
}): Promise<void>
  // update by id (no CAS — initial path)

// for reconcile
async findAwaitingEvidence(effectiveDates: Date[]): Promise<PayoutOrderRow[]>
  // where { status: in [SENT, OUTCOME_UNKNOWN], effectiveDate: in dates, txid not null }

async claimResend(id: string, expectedAttemptCount: number, txid: string, now: Date): Promise<boolean>
  // updateMany where { id, status: in [SENT, OUTCOME_UNKNOWN], attemptCount: expected, txid }
  // data: { attemptCount: expected+1, lastAttemptAt: now }
  // return count === 1

async recordResendOutcome(id: string, data: { status: PayoutStatusValue; rejectionReason?: string|null }): Promise<void>
  // update by id

async markSettled(id: string, settledAt: Date): Promise<void>
async markParked(id: string, parkedAt: Date, rejectionReason: string): Promise<void>  // hmm reason field name
```

Hmm, `rejectionReason` for parked — the reason is "attempts exhausted, awaiting manual review." Field name: maybe a generic `holdReason`? We have `rejectionReason` for the bank's rejection. Let's add `parkReason`? Or reuse a single `note`/`reviewReason`? Let's keep two fields: `rejection_reason` (the bank's permanent rejection message) and parked just sets `parked_at` + status; the reason for parking is implied (attempts exhausted) — no text needed. Simpler: `park(id, now)` sets status PARKED, parkedAt. OK.

Wait, one more: for `recordResendOutcome` on permanent rejection — set status REJECTED + rejectionReason. For transient → OUTCOME_UNKNOWN. For accepted/duplicate → SENT.

Should `recordResendOutcome` be a CAS too (to avoid overwriting a concurrent settle)? A concurrent reconcile could settle the order between our claim and outcome (e.g., the send is "accepted" — the bank has it; a concurrent run sees the txid in the statement → settles). If we then set SENT after SETTLED → regression! Guard: recordResendOutcome should only apply if the status is still in (SENT, OUTCOME_UNKNOWN):

```ts
updateMany where { id, status: in [SENT, OUTCOME_UNKNOWN] } data {...}
```

If count 0 → it was settled/parked concurrently → our outcome write is skipped. That's the correct "don't overwrite a settled state." Similarly, `recordSendOutcome` in executePayments: where { id, status: PENDING } — only the initial send writes from PENDING. And `markSettled` where { id, status: in [SENT, OUTCOME_UNKNOWN] } (settle only from an awaiting state). `markParked` where { id, status: in [SENT, OUTCOME_UNKNOWN], attemptCount: MAX }? The service already checked; the WHERE status in (SENT, OUTCOME_UNKNOWN) is enough (a parked order won't be a candidate). Also for park, include the attemptCount check? The service checked attempts >= 5 before parking. A concurrent run can't change attemptCount except via a claim (which requires status SENT/UNKNOWN — still true at park time). The race: two runs both see attempts=5, both park → the second park's WHERE status in (SENT, UNKNOWN) fails (already PARKED) → no-op. Idempotent.

All transitions are conditional updates → idempotent and race-safe.

Now the service:

```ts
export const MAX_ATTEMPTS = 5;
export const PUBLISHING_LAG_MS = 30 * 60 * 1000;

export interface ReconcileWindow { from: Date; to: Date; }

export type SendOutcome = 'accepted' | 'duplicate' | 'transient' | 'permanent';

@Injectable()
export class PayoutService {
  constructor(private readonly orders: PayoutRepository, private readonly bank: BankClient) {}

  async executePayments(now: Date = new Date()): Promise<{ accepted: number; duplicate: number; unknown: number; rejected: number }> {
    const pending = await this.orders.findPending();
    const summary = { accepted: 0, duplicate: 0, transient: 0, permanent: 0 };
    for (const order of pending) {
      const txid = deriveTxid(order.id, order.effectiveDate);
      const raw = await this.safeSend(txid, order.amountMinor, order.key);
      const outcome = classifySend(raw);
      const status = { accepted: SENT, duplicate: SENT, transient: OUTCOME_UNKNOWN, permanent: REJECTED }[outcome];
      await this.orders.recordSendOutcome(order.id, { status, txid, attemptCount: 1, lastAttemptAt: now, rejectionReason: raw.reason ?? null });
      summary[outcome]++;
    }
    return summary;
  }
```

Hmm `safeSend`: wrap `bank.send` in try/catch → any throw becomes a network error (transient). The HTTP client already normalizes, but the fake in tests might throw — the service must treat any throw as outcome-unknown. Yes: "the send path may record that it doesn't know the outcome."

```ts
  private async safeSend(req): Promise<RawBankSendResponse> {
    try { return await this.bank.send(req); }
    catch (err) { return { ok: false, networkError: true, reason: msg(err) }; }
  }
```

RawBankSendResponse shape — let me finalize:

```ts
export interface BankSendResponse {
  statusCode: number;          // 0 when no HTTP response was received
  reason: string;              // human-readable; empty on success
}
```

Simple: one interface; statusCode 0 or ≥500/408/429 → transient; 2xx → accepted; 409 → duplicate; other 4xx → permanent. `reason` carries the bank's message for permanent (stored in rejectionReason).

`classifySend`:

```ts
export function classifySend(resp: BankSendResponse): SendOutcome {
  if (resp.statusCode === 0) return 'transient';
  if (resp.statusCode >= 200 && resp.statusCode < 300) return 'accepted';
  if (resp.statusCode === 409) return 'duplicate'; // ASSUMPTION: bank signals "already have this txid" with 409
  if (resp.statusCode === 408 || resp.statusCode === 429 || resp.statusCode >= 500) return 'transient';
  return 'permanent';
}
```

Where to put classifySend + deriveTxid? Pure domain logic — the service file (or a separate `payout.rules.ts`?). The layout convention only lists module/controller/service/repository; pure helpers can live in the service file. But the processor also needs date-window helpers. Let's put `deriveTxid`, `classifySend`, `PUBLISHING_LAG_MS`, `MAX_ATTEMPTS` in `payout.service.ts` (exported for tests). Date helpers (`utcDayRange`, `daysInWindow`, `endOfUtcDay`) — needed by the service (reconcile) and the processor (window computation). Put in the service file too? The processor needs only `buildScheduledWindow(now)`. Hmm, small helpers in the service file are fine (exported). Or a `src/payout/payout-dates.ts`? That's a new role not in the convention layout. Keep in service file — it's the service's domain logic.

reconcile:

```ts
async reconcile(window: ReconcileWindow, now: Date = new Date()): Promise<ReconcileSummary> {
  const days = daysInWindow(window);            // UTC midnight Date[]
  if (days.length === 0) return emptySummary;
  const statements = await Promise.all(days.map(d => this.bank.getStatement(d)));
  const settledTxids = new Set<string>();
  for (const s of statements.flat()) settledTxids.add(s.txid);

  const candidates = await this.orders.findAwaitingEvidence(days);
  const summary = { settled: 0, resentAccepted: 0, resentDuplicate: 0, stillAwaiting: 0, parked: 0, rejected: 0 };

  for (const order of candidates) {
    if (order.txid && settledTxids.has(order.txid)) {
      const did = await this.orders.markSettled(order.id, now);
      if (did) summary.settled++;
      continue;
    }
    if (!isPastPublishingLag(order.effectiveDate, now)) { summary.stillAwaiting++; continue; }
    // proven absent
    if (order.attemptCount >= MAX_ATTEMPTS) {
      const did = await this.orders.markParked(order.id, now);
      if (did) summary.parked++;
      continue;
    }
    const claimed = await this.orders.claimResend(order.id, order.attemptCount, order.txid!, now);
    if (!claimed) { summary.stillAwaiting++; continue; }   // a concurrent run took it
    const raw = await this.safeSend({ txid: order.txid!, amount: order.amountMinor, key: order.key });
    const outcome = classifySend(raw);
    const status = outcome === 'permanent' ? REJECTED : outcome === 'transient' ? OUTCOME_UNKNOWN : SENT;
    const did = await this.orders.recordResendOutcome(order.id, { status, rejectionReason: outcome === 'permanent' ? raw.reason : null });
    if (!did) { summary.stillAwaiting++; continue; }  // settled concurrently; our write skipped
    switch (outcome) {
      case 'accepted': summary.resentAccepted++; break;
      case 'duplicate': summary.resentDuplicate++; break;
      case 'transient': summary.stillAwaiting++; break;
      case 'permanent': summary.rejected++; break;
    }
  }
  return summary;
}
```

Wait, there's an issue with `recordResendOutcome` on permanent rejection and subsequent runs: an order in REJECTED state is not a candidate (not in SENT/UNKNOWN) → stays rejected → human review. OK.

Issue: for a resend with `accepted` — status SENT, attempts 2. The next day's reconcile: if absent and past lag → claim (attempts 2→3) → send. Up to attempts 5. The 5th send is transient → UNKNOWN, attempts=5. Next reconcile: absent, past lag, attempts>=5 → parked. ✓. 5th send is accepted → SENT attempts=5; reconcile proves absence → parked (can't resend). ✓ — "cap attempts at 5."

Hmm, is it right that a 5th attempt's "accepted" (in flight) leads to parking when later proven absent? We've sent 5 times, none proven to have landed, none proven not to have landed... wait — proven absent from the statement = proof that the send didn't land (that's the whole premise: "absence from the statement is proof that the send didn't land"). So if the 5th (accepted) send is later proven absent from the statement... the premise says absence = didn't land. But attempts exhausted → park for human review instead of a 6th send. ✓ matches spec.

Wait, subtle: is absence really proof of non-landing? Only past the publishing lag for that date. We gate on that. ✓.

Another subtlety: `findAwaitingEvidence(days)` — the txid in a candidate must match its own effective date's statement. We pool all txids from all days into one set. A candidate's effectiveDate ∈ days, so its statement is in the pool. ✓.

`markSettled` returns a boolean (count===1) so the summary doesn't double-count across runs — well, the summary is per-run; two runs each settle different orders. Within a run, the candidate is fetched once. The boolean guards races (a concurrent run settled first → we don't count). Fine.

Now "orders already matched are skipped before any decision is made about them" — matched = settled status → not in the candidate query → skipped. ✓. Within a run too: the settlement check is the first decision. ✓.

daysInWindow: window {from, to} half-open → list of UTC days D where [startOfUtcDay(D), startOfUtcDay(D)+1day) overlaps [from, to):
```
firstDay = startOfUtcDay(from)  // if from is a midnight exactly, that day
lastDay = startOfUtcDay(to - 1ms)  // the day containing the last instant
days = from firstDay stepping 1 day while < = lastDay
```
Cap: if (to - from) > some sanity (say 32 days) → throw? The processor always passes a small window. Add a guard to prevent abuse: cap at, say, 31 days → throw a service error? Keep it simple: no cap, but the processor is controlled. Hmm, a malicious/buggy window (a year) → 365 bank calls. Add a modest guard: if span > 14 days, throw `Error('reconcile window too wide')`. Defensible. Er — let's include; it's 3 lines.

isPastPublishingLag:
```ts
function isPastPublishingLag(effectiveDate: Date, now: Date): boolean {
  const dayEnd = startOfUtcDay(effectiveDate) + 86_400_000;
  return now.getTime() >= dayEnd + PUBLISHING_LAG_MS;
}
```

The processor's window:
```ts
buildScheduledWindow(now: Date): ReconcileWindow {
  const today = startOfUtcDay(now);
  return { from: today - 86_400_000, to: today + 86_400_000 };
}
```
→ days = [yesterday, today]. Every 15 min, refetches both → overlapping by design. ✓.

Should we also include yesterday's day for "today's" absence proofs? No — today's absence is never proven (until tomorrow). Yesterday is proven from today 00:30 onward. Both days in the window means: a run at 00:15 (window days [yesterday, today]): a yesterday order's lag boundary = today 00:30 → not yet past lag → stillAwaiting. A run at 00:30 → past lag → resend. ✓.

Tests. "Test behavior not implementation. Never assert only that a call happened." Test the service with a fake bank + fake repository? Wait — if we fake the repository, we're testing the service's state-machine decisions, but the actual persistence idempotency (CAS) is untested. The critical behaviors (timeout-but-settled, proven-absent same txid, exhaustion) are service decisions over repository data. A fake repository (in-memory map) that faithfully implements the contract (including CAS semantics) lets us test the service logic hermetically. The CAS semantics in the real repository (Prisma updateMany) — we trust Prisma's atomicity; testing it would require a DB. That's an acceptable split.

Hmm, but "test behavior not implementation" — with a fake repository, we're still testing behavior: "given an order in state X and a bank that behaves Y, after reconcile, the order is in state Z and no send was made with a different txid." Good.

Alternatively, tests with a real Prisma repository against an in-memory... Prisma doesn't support SQLite here (the schema is postgres). Vitest + real Postgres = needs a DB service. Many repos do that in CI with testcontainers, but that adds a lot of infra (docker, containers). The convention doesn't mention a test DB. Go with fake repository + fake bank. The fakes are defined in the spec file (or a test helper). Keep the fakes in the spec file itself (single test file per convention: `test/<feature>.spec.ts` → `test/payout.spec.ts`? or `test/payout.service.spec.ts`). Convention: `test/<feature>.spec.ts` → `test/payout.spec.ts`.

Fake design:

```ts
class FakeBank {
  sendLog: BankSendRequest[] = [];
  sendOutcome: BankSendResponse | (() => BankSendResponse) | Error = { statusCode: 202, reason: '' };
  statementByDay = new Map<string, Settlement[]>();
  async send(req) { this.sendLog.push(req); return scripted... }
  async getStatement(date) { return this.statementByDay.get(ymd(date)) ?? []; }
}

class FakeOrders implements PayoutRepository-ish {
  orders = new Map<string, PayoutOrderRow>();
  // implement findPending, findAwaitingEvidence, claimResend (CAS!), recordSendOutcome, recordResendOutcome (conditional!), markSettled (conditional), markParked (conditional)
}
```

To make sure the fake implements the *contract*, we should type it as the repository type. But the repository is a concrete class. Option: define an interface `PayoutOrderStore` in the repository file; the class implements it; the service depends on the interface (DI token = the interface? in Nest, injection by interface requires a token). Hmm — the convention says the service is "zero Prisma client calls" and calls the repository. DI: the service constructor takes `PayoutRepository` (the concrete class) — simplest, no token gymnastics. For the fake, `Object.create(PayoutRepository.prototype)`? No — just have the fake class `implements` the contract... TS structural typing: if the service declares the parameter type as the concrete `PayoutRepository`, the fake must be an instance of it — not structurally allowed (a class with methods is structurally fine if the shape matches — TS is structural! A plain object/class with the same public method signatures is assignable to `PayoutRepository` type as long as all public members match. The concrete class has a `private prisma` → private members make assignability fail (private/protected are nominal). So add `private readonly prisma` to the repository → the fake can't be assigned. Workaround: don't declare a private; make prisma a `readonly` public? Ugly. Or the service depends on an exported interface `PayoutOrderRepository` that the class implements, and Nest provides the concrete class against that token:

```ts
// repository file
export interface PayoutOrderStore { findPending(): ...; ... }
@Injectable()
export class PayoutRepository implements PayoutOrderStore { private readonly prisma = new PrismaClient(); ... }

// module
providers: [PayoutService, { provide: PayoutOrderStore, useExisting: PayoutRepository }, PayoutRepository]
```

Hmm, more wiring. Or the simplest: the service takes the concrete class; the test fake is a class with `as unknown as PayoutRepository`? Casting is a bit ugly but a common test pattern. Or the fake extends PayoutRepository? The constructor creates a PrismaClient (needs DATABASE_URL env → PrismaClient's constructor doesn't connect until the first query! `new PrismaClient()` doesn't connect). So `class FakeRepo extends PayoutRepository {}` overriding all methods — the super constructor runs `new PrismaClient()` — safe (no connection until a query; we never query). It works but smells.

Cleaner: define the store interface. Actually — wait. Let me reconsider: is an interface the "most defensible" layering? The convention layout lists the repository as a file/role; it doesn't forbid an interface. Many NestJS codebases do exactly this for testability. Let's do it:

`payout.repository.ts`:
```ts
export interface PayoutOrderStore {
  findPending(take?: number): Promise<PayoutOrderRow[]>;
  findAwaitingEvidence(effectiveDates: Date[]): Promise<PayoutOrderRow[]>;
  recordSendOutcome(id: string, data: SendOutcomeRecord): Promise<boolean>;
  claimResend(id: string, expectedAttemptCount: number, now: Date): Promise<boolean>;
  recordResendOutcome(id: string, data: ResendOutcomeRecord): Promise<boolean>;
  markSettled(id: string, at: Date): Promise<boolean>;
  markParked(id: string, at: Date): Promise<boolean>;
}
```

Hmm wait, earlier I included the txid in claimResend's where clause. The service derives it anyway; the row already has a txid; the claim doesn't need the txid parameter (we don't change txid on a resend — same txid). Drop it: `claimResend(id, expectedAttemptCount, now)`.

`recordSendOutcome(id, {status, txid, attemptCount, lastAttemptAt, rejectionReason})` — the initial path sets the txid (the first time it's known) — should we CAS? The initial path only fires from PENDING/attempt 0. Two concurrent executePayments runs: both read the same pending list, both send (same txid → bank dedups → one accepted one duplicate — harmless), both write recordSendOutcome. To be safe, make recordSendOutcome conditional: `where { id, status: PENDING, attemptCount: 0 }` → if it fails (already recorded), skip. Add attemptCount to the where: `attemptCount: 0` → after the first write (attemptCount=1), the second write no-ops. Return a boolean. But wait — for a duplicate outcome in the initial path, the status is SENT — the second run's write is no-op → the first's write stands (maybe 'accepted'). Consistent. OK, conditional.

But subtle: what if the first run's outcome is transient (OUTCOME_UNKNOWN, attempts=1) and the second run's is accepted (SENT)? The first write wins (PENDING→UNKNOWN); the second no-ops. Status UNKNOWN, attempts 1 → reconcile will handle. Fine.

Now the module: `providers: [PayoutRepository, PayoutService, PayoutProcessor]`, and the service injects... the concrete `PayoutRepository`? If the service takes the concrete class, the fake in the test must satisfy the class type (impossible with private prisma). So the service must take the interface → module wiring: `{ provide: PayoutOrderStore, useExisting: PayoutRepository }`. And the bank similarly: the service takes the `BankClient` interface → bank module: `{ provide: BankClient, useExisting: BankHttpClient }` + exports [BankClient]. Interface as a DI token: interfaces are erased at runtime → can't be a token! In NestJS, an injection token must be a runtime value (string/symbol/class). An interface isn't. So: use a string/symbol token:

```ts
export const PAYOUT_ORDER_STORE = 'PAYOUT_ORDER_STORE';  // in the repository file
@Injectable() export class PayoutRepository { ... }
// module: { provide: PAYOUT_ORDER_STORE, useExisting: PayoutRepository }
// service: constructor(@Inject(PAYOUT_ORDER_STORE) private readonly orders: PayoutOrderStore)
```

That's the standard Nest pattern for interface-based injection. Two tokens (store + bank client) — fine, a small cost for real testability and clean layering.

Alternatively, use an abstract class as the token:
```ts
export abstract class PayoutOrderStore { abstract findPending(): ...; }
@Injectable() export class PayoutRepository extends PayoutOrderStore { ... }
```
An abstract class is a runtime value → usable as a token directly: `@Injectable()` service constructor `private readonly orders: PayoutOrderStore` — Nest resolves abstract class tokens by class identity. And in the module: `providers: [PayoutRepository, PayoutService]` — wait, Nest auto-binds: PayoutService asks for the `PayoutOrderStore` token; who provides it? We need an explicit `{ provide: PayoutOrderStore, useExisting: PayoutRepository }` or `useClass`. Same wiring as the string token but without the string. Abstract class as the token is a well-known Nest pattern. Let's use abstract classes for both the store and the bank client:

```ts
// bank-client.ts
export abstract class BankClient {
  abstract send(req: BankSendRequest): Promise<BankSendResponse>;
  abstract getStatement(date: Date): Promise<Settlement[]>;
}
@Injectable() export class BankHttpClient extends BankClient { ... }
```

```ts
// bank.module.ts
providers: [BankHttpClient, { provide: BankClient, useExisting: BankHttpClient }],
exports: [BankClient],
```

Hmm wait — does `useExisting` work with an abstract class token? Yes: any token.

The fake in the test: `class FakeBank extends BankClient { ... }` — clean.

Now the bank HTTP implementation. Endpoints: `POST {BANK_BASE_URL}/instant-payments` with JSON `{ txid, amount, key }` + auth header `Authorization: Bearer ${BANK_API_KEY}`? ASSUMPTION on path/auth. And `GET {BANK_BASE_URL}/statements?date=YYYY-MM-DD` → `Settlement[]`. Mark the endpoint shape as ASSUMPTION. Use global fetch; timeout via AbortSignal.timeout(BANK_TIMEOUT_MS default 10_000); catch AbortError/network → `{ statusCode: 0, reason }`.

```ts
@Injectable()
export class BankHttpClient extends BankClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor() {
    super();
    this.baseUrl = (process.env.BANK_BASE_URL ?? '').replace(/\/+$/, '');
    this.apiKey = process.env.BANK_API_KEY ?? '';
    this.timeoutMs = Number(process.env.BANK_TIMEOUT_MS ?? '10000');
  }

  async send(req: BankSendRequest): Promise<BankSendResponse> {
    try {
      const res = await fetch(`${this.baseUrl}/instant-payments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ txid: req.txid, amount: req.amount, key: req.key }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const reason = await this.safeText(res);
      return { statusCode: res.status, reason };
    } catch (err) {
      return { statusCode: 0, reason: describeError(err) };
    }
  }

  async getStatement(date: Date): Promise<Settlement[]> {
    const res = await fetch(`${this.baseUrl}/statements?date=${toUtcYmd(date)}`, { headers: {...}, signal: AbortSignal.timeout(this.timeoutMs) });
    if (!res.ok) throw new Error(`statement fetch failed: HTTP ${res.status}`);
    return (await res.json()) as Settlement[];
  }
}
```

Hmm — should a getStatement failure throw (aborting the run) or be tolerated? If the bank's statement endpoint is down, reconcile can't prove anything → the safe move: fail the run (don't act on incomplete evidence). Throwing → the cron run fails → retried next run. That's the safe direction (no action on missing evidence). And the service: `Promise.all(days.map(getStatement))` → a throw aborts the whole reconcile before any state change. Important: the statement fetch happens before the candidate fetch and before any write → a failed fetch changes nothing. ✓. (In my reconcile draft, statements are fetched first — keep that order.)

`toUtcYmd(date)` — a shared date utility. Where? Needed by the bank client (statement URL) and the service (daysInWindow, lag). A small utility file? The convention layout doesn't have a utils role... Options: export `toUtcYmd` + `startOfUtcDay` from `payout.service.ts` and have the bank client import from payout — a reverse layering (bank → payout) smells. Or duplicate 3 lines in the bank client. Or a `src/dates.ts` utility (top-level, not a feature). A small `src/dates.ts`? "Do not create files that aren't asked for" — a shared date utility is needed by two features; it's defensible. Hmm, alternatively, put date helpers in the bank client file and have the service import from `@/bank/...`? No. A small `src/dates.ts` is cleanest. Actually wait — what helpers do we need where?

- Service: `startOfUtcDay`, `daysInWindow`, `PUBLISHING_LAG` logic, `endOfUtcDay`.
- Bank client: `toUtcYmd` (format YYYY-MM-DD).
- Processor: `startOfUtcDay` for the window.

Let's create `src/dates.ts` and export `startOfUtcDay(d: Date): Date` and `toUtcYmd(d: Date): string`. Small, no deps. I think that's justified.

Now `main.ts` and `app.module.ts`:

```ts
// main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(Number(process.env.PORT ?? '3000'));
}
void bootstrap();
```

```ts
// app.module.ts
@Module({ imports: [PayoutModule] })
export class AppModule {}
```

PayoutModule needs ScheduleModule.forRoot() for @Cron. `imports: [ScheduleModule.forRoot(), BankModule]`. ScheduleModule.forRoot() is global-ish (registers the scheduler) — must be imported once (forRoot in PayoutModule is fine; conventionally in AppModule). Hmm — put `ScheduleModule.forRoot()` in AppModule's imports (app-level concern), and PayoutModule imports BankModule. But then tests... the tests don't bootstrap the app (pure service tests) → no schedule needed. OK:

```ts
// app.module.ts
imports: [ScheduleModule.forRoot(), PayoutModule]
```

Wait, is it OK for ScheduleModule.forRoot() to be in AppModule and not PayoutModule? @Cron on the processor works as long as forRoot is somewhere in the tree. Yes.

Do we need a controller? No (decided). The error envelope convention → not used (no HTTP API). Hmm, the convention block describes the codebase conventions; for a new solution without endpoints, it just doesn't apply. OK.

Now — the processor:

```ts
// src/payout/payout.processor.ts
@Injectable()
export class PayoutProcessor {
  constructor(private readonly payouts: PayoutService) {}

  @Cron(CronExpression.EVERY_15_MINUTES)
  async runScheduledReconcile(): Promise<void> {
    const now = new Date();
    await this.payouts.reconcile(buildScheduledWindow(now), now);
  }
}
```

`buildScheduledWindow(now)` — export from the service file. Window: { from: startOfUtcDay(now) - DAY_MS, to: startOfUtcDay(now) + DAY_MS }.

Also, should the processor run executePayments periodically too? The task says the reconcile job is scheduled every 15 min. executePayments — when is it called? The task doesn't specify its scheduling (probably on order intake). "Deliver... the reconcile job" — only reconcile is a job. Let's schedule only reconcile. executePayments is exposed on the service (called by whatever creates orders — out of scope). Hmm — should the processor also trigger executePayments? No — don't invent. Reconcile job only. ✓ (The spec: "the scheduled reconcile job" — singular, reconcile.)

Now the full draft of the reconcile service logic — edge: `findAwaitingEvidence(days)` returns rows; the rows' `txid` is typed `string | null`. The WHERE requires non-null. If null (shouldn't happen), the txid-less order can't match a settlement and can't be safely resent? If txid is null and status is SENT/UNKNOWN — that's a data invariant violation. Guard: skip with a log? Just treat it as stillAwaiting (safe: no action). In the code: `if (!order.txid) { summary.stillAwaiting++; continue; }`.

Let me also double-check the "proven absent" test scenario:
- An order: status OUTCOME_UNKNOWN (timed out), txid T (derived), effectiveDate D (yesterday), attempts 1.
- Now = D+1 day + 30 min + 1 min (past lag).
- Statement for D: doesn't contain T.
- Window: [startOfUtcDay(now) - day, +day] → days {D, D+1}... wait, if now is in D+1, the days are {D, D+1}? now is in day D+1 → today = D+1, yesterday = D. days = [D, D+1]. ✓ D is in the days.
- Reconcile: T not in the settlement set; past lag ✓; attempts 1 < 5 → claim (1→2) → send with T (same txid ✓) → say transient again → status OUTCOME_UNKNOWN, attempts 2. Assert: the bank's send log has exactly one send, txid T, amount, key; order.attemptCount 2; status UNKNOWN.

"Timeout-but-settled": order UNKNOWN txid T, effectiveDate D (today!), now = D + 2 hours (not past lag — today isn't over). Statement for D contains T. → settled regardless of lag. Assert: status SETTLED, settledAt set, zero bank sends. ✓ (The key: even though the send "timed out," the statement proves it landed → no resend.)

"Attempt exhaustion": order UNKNOWN, attempts 5, effectiveDate D (yesterday), now past lag, statement empty → parked. Assert: status PARKED, parkedAt, zero sends, never reverted (status stays PARKED across a second reconcile run — idempotency: the candidate query excludes PARKED).

Also test: "reconcile twice over the same window → identical state." Run reconcile twice; the second run: no candidates (settled/parked) → no sends, no state change. Or the scenario: two runs both see an absent order past lag → the first resends (claim), the second: attempts changed... wait, in a sequential test: run 1: claim 1→2, send (say accepted → SENT attempts 2). Run 2 (same window): the order is SENT attempts 2, absent, past lag → claim 2→3 → another send!! That's not "identical state"!!

Wait. Is that a spec violation? "Running twice over the same window... must not change anything the first run already settled. Orders already matched are skipped before any decision is made about them." — "must not change anything the first run already settled" — "settled" here = matched/settled orders, not all state. A proven-absent order that was resent by run 1: run 2 sees it as SENT attempts 2 (the new in-flight send), absent (its new send isn't in the statement yet — of course, the statement lags), past lag (effectiveDate is still D, past lag is still true!) → resends again (attempts 3)! Every 15 min, a resend → burns through the 5 attempts in an hour → parked!! Hmm!! Is that intended??

Let me think carefully. After a resend (accepted, in flight), the order is again "awaiting evidence." Is it correct to immediately resend again just because the statement (which lags by 30 min!) doesn't show it? No — the new send just happened; its statement entry hasn't been published yet. Re-sending based on absence before the new send's publishing lag = exactly the original bug (resending on unknown outcome)!!

So "past publishing lag" must be relative to the last attempt, not just the effective date! The absence proof must be: the statement is complete for that date AND the last attempt is older than the publishing lag. I.e.:

```
isPastPublishingLag(order, now) = now >= endOfUtcDay(effectiveDate) + LAG
                          AND now >= order.lastAttemptAt + LAG
```

The second condition: the most recent send is at least the lag old → any entry from it would have been published by now. After a resend at time T, the next eligible time is ≥ T + 30 min. A 15-min cron: run 1 at 10:00 resends (lastAttempt 10:00). Run 2 at 10:15: lastAttempt+30 = 10:30 > 10:15 → not eligible → stillAwaiting. Run at 10:30: eligible → if still absent → resend. So resends are at most once per 30 min per order. And "reconcile twice over the same window" (back-to-back runs, same now in a test): run 1 resends at now T (lastAttemptAt = T). Run 2 with the same T: lastAttempt+LAG > T → not eligible → no resend → state identical (except lastAttemptAt/attempts from run 1 — "must not change anything the first run already settled" ✓ — the settled things don't change; the resend result stands).

Hmm wait, but the test "reconcile run twice over the same window → identical state after both": if run 1 resends, the state after run 1 ≠ state after run 2? After run 1: attempts 2, SENT. After run 2: attempts 2, SENT (no action). State after both = state after run 1 (stable). "Identical state after both" — I read that as: the second run changes nothing relative to the first (idempotent). ✓.

So the eligibility: both conditions. Let me define:

```ts
function isEligibleForProvenAbsence(order: PayoutOrderRow, now: Date): boolean {
  const dayEnd = startOfUtcDay(order.effectiveDate).getTime() + DAY_MS;
  const attemptTime = order.lastAttemptAt?.getTime() ?? 0;
  return now.getTime() >= Math.max(dayEnd, attemptTime) + PUBLISHING_LAG_MS;
}
```

lastAttemptAt is always set for SENT/UNKNOWN (set on the first send). ✓.

Now, is the dayEnd condition still needed if we have lastAttempt+LAG? Consider: effective today, sent at 09:00, lastAttempt 09:00, now 10:00 (lastAttempt+30 ✓). Absent from today's statement — but today's statement is incomplete (the bank is still publishing today's entries; the 09:00 payment might appear at 09:30, or a 23:00 payment would never appear in an earlier check...). Wait, absence means our txid isn't in the fetched statement. Today's statement is a moving target: it doesn't yet contain all of today's settlements. Our 09:00 send: if it landed, would it be in the statement by 10:00? Bank's lag is "up to ~30 min" → a 09:00 landing appears by 09:30. So by 10:00, if it had landed at 09:00, it should be visible... assuming the lag is measured from settlement. Hmm, "the bank lags by ~30 min" — publishing lag: settlements appear in the statement ~30 min after they happen. So lastAttempt+LAG (30 min) should suffice if the lag is from send/settlement time. But there's a wrinkle: `getStatement(date)` — the statement for day D is published throughout the day; is the statement for day D "complete and stable" after endOfDay(D)+30min? The dayEnd condition covers the worst case where the bank buffers a whole day's entries and publishes them the next morning. With only lastAttempt+LAG: a send at 23:59 effective D, checked at D+1 00:29 (lastAttempt+30 ✓): if the bank's D-statement is only finalized at D+1 00:30, the 00:29 check might see an incomplete D-statement → false absence → resend risk!! So keep both conditions: day complete (endOfUtcDay + LAG) AND attempt older than LAG. The dayEnd condition is the conservative one (also covers end-of-day buffering), and lastAttempt prevents the resend-every-15-min loop. Both. ✓

Let me also reconsider: is the dayEnd condition correct for same-day resends? Effective today, sent at 09:00 (timeout). Not resend-eligible until tomorrow 00:30. Is that too conservative? Under the "up to 30 min" publishing lag, a 09:00 landing appears by ~09:30, so resending at 10:00 is safe under that model. But the "up to ~30 min" is an approximation; the day-end rule is bulletproof. The spec says "the bank lags by up to ~30 min" and "past publishing lag" — the lag is about publication delay, not day completion. Hmm. If we use only lastAttempt+LAG: at 10:00, the 09:00 timeout, absent from today's statement (fetched at 10:00, which contains entries up to ~09:30) → proof that the 09:00 send didn't land? A 09:05 settlement should be in the 10:00 fetch (09:05+30=09:35 < 10:00 ✓). So under the pure "30 min publishing lag" model, lastAttempt+LAG is exactly the right proof. The dayEnd condition is extra-cautious for a different failure mode (day-boundary batching). The spec's model: "the bank lags by up to ~30 min" — publishing lag on entries. I think the spec intends: an order is past lag when now ≥ lastAttemptAt + 30min (the entry, if it existed, would have been published). But hmm, "for orders still awaiting evidence and past publishing lag — absence from the statement is proof" — "the statement" = getStatement(effectiveDate). If we only use lastAttempt+LAG, we fetch today's statement at 10:00 and it's missing entries after 09:30 — but those are irrelevant for proving a 09:00 send absent (its window closed at 09:30). OK, so under the spec's model, lastAttempt+LAG is sufficient and correct.

But wait — is it sufficient for the *effective date* boundary? A send with effectiveDate D at D+1 00:10 (crossing midnight)? A payment effective D executed at D+1 00:10 — which statement? Presumably D (effective date). If it landed at 00:10, it appears in D's statement by 00:40 (lag). Check at 00:45: lastAttempt+30 ✓ → proof. Fine.

Decision: use `now >= lastAttemptAt + LAG` as the primary rule; also require the effective date's statement was fetched (in the window — structural). Should we also require dayEnd? Let me weigh the risk: using only lastAttempt+LAG, the failure mode requires the bank's statement for D to lag >30 min from settlement — contradicting the given "up to ~30 min." The spec says to assume a 30-min lag. Let's go with lastAttempt+LAG... hmm, but hmm. One more consideration: "up to ~30 min" — "up to" means ≤30 min. So a 30-min wait after the attempt is a proof.

Hmm, but actually, let me reconsider once more. There's a subtle interaction: after a resend at T (accepted), the order is SENT, lastAttempt T. At T+30, if still absent → resend. Each resend cycle is 30 min. Attempts: 5 → worst case ~2 hours to park. Fine.

And "reconcile twice over the same window" (same now): run 1 resends at now (lastAttempt=now). Run 2 at the same now: now < now+LAG → not eligible. ✓ No double resend.

If now advances by 15 min between runs: run 2: lastAttempt(now1) + 30 > now2=now1+15 → not eligible. ✓. At now1+30: eligible. So in steady state, a proven-absent order resends at most every 30 min. Attempts 5 → parked by ~105 min after the last attempt. ✓.

OK, the rule: `isPastPublishingLag = now >= (lastAttemptAt ?? effectiveDate) + PUBLISHING_LAG_MS`. lastAttemptAt is always present for candidates; the fallback is harmless. Drop the dayEnd condition? Hmm... let me keep it simple: lastAttempt-based only. But wait, one more scenario: an order's effectiveDate is 5 days ago (system was down since the send). lastAttempt = 5 days ago → past lag ✓ → if today's window doesn't include effectiveDate 5 days ago, the order isn't a candidate (daysInWindow = {yesterday, today}) → not processed. Safe (no false proof on a stale date). When it will be processed... never (its date never re-enters the window) → stuck awaiting → eventually human notices (an order stuck in UNKNOWN for 5 days). Acceptable? The spec's job covers a 15-min cadence over a recent window; a multi-day outage recovery is out of scope. But hmm, "never auto-revert" / safe direction — a stuck order isn't a revert; a human can review an old UNKNOWN. Add a comment. OK.

Hmm, wait — actually, let me reconsider the processor's window once more. What if the window is [now - LAG - overlap, now] mapped to days? At 10:00: [09:10, 10:00] → days {today}. An order effective yesterday past lag: not a candidate (yesterday not in days) → never resent. Broken. So the day-based window {yesterday, today} is the right shape. It refetches yesterday all day (redundant but idempotent). ✓ My earlier design stands.

But hmm, one more: an order effective 2 days ago, sent 2 days ago, UNKNOWN, bank actually settled it on day D-2 (we missed it). Window days {D-1, D} → not a candidate → never settled by us → stuck. A human sees UNKNOWN and checks manually. Safe (no double action). The spec's acceptance doesn't cover multi-day outages. Documented in a comment. OK.

Alternatively, we could widen the processor's window to {D-3, D} or so — cheap (3 statement fetches per run), covering 3-day outages. "Up to ~30 min" lag — no need beyond yesterday, except for outage recovery. Let's do {D-1, D} — matches the spec's assumption exactly (no over-engineering). Hmm... actually, yeah, let me think about whether including more days breaks anything: overlap safety is by design, and extra days = extra fetches + extra candidates (their absent ones are provable). It only adds recovery power. But "assume nothing beyond" — the bank's getStatement for any past date should work. Let's keep to {yesterday, today} — tight to the stated lag, and a comment notes that orders awaiting evidence beyond the window remain for manual review. Fine.

Now let me also double-check `findAwaitingEvidence(days)`: WHERE effectiveDate IN (the UTC midnight Dates). effectiveDate is stored as a UTC midnight Date (by convention: the effective date is a date, stored at UTC midnight). Tests must construct effectiveDate as UTC midnight. Note: `@map("effective_date")`, DateTime. A Prisma IN query with Date values — compares timestamptz; effectiveDate must be stored exactly at UTC midnight for the IN match. We should document that effectiveDate is normalized to UTC midnight when orders are created (out of scope — order creation isn't part of the deliverables; assume the producer normalizes). Add a comment in the schema or the repository: "effectiveDate is stored at UTC midnight."

Now the Prisma updateMany for CAS — the `claimResend` WHERE: { id, status: { in: [SENT, OUTCOME_UNKNOWN] }, attemptCount: expected }. data: { attemptCount: { increment: 1 }? or the computed value }. Use the computed value `expectedAttemptCount + 1` — but increment is safer (no staleness): `data: { attemptCount: { increment: 1 }, lastAttemptAt: now }`. If count is 1 → claimed. ✓.

`recordResendOutcome` WHERE { id, status: { in: [SENT, OUTCOME_UNKNOWN] } } — hmm, but for a permanent rejection on a resend: SET REJECTED. If a concurrent run settled in between → count 0 → skip (settle wins — correct: it settled = it landed; better than rejected). ✓.

`recordSendOutcome` (initial) WHERE { id, status: PENDING, attemptCount: 0 } data { status, txid, attemptCount: 1, lastAttemptAt, rejectionReason }. count===1 → written.

Wait, executePayments summary counting: if the write is skipped (count 0), we still counted an outcome... minor; let's count based on the write result? A skipped write means a concurrent initial send already recorded → our bank call was a duplicate at the bank level (or a race). For summary honesty, only count when the write lands? Hmm, the summary is informational. Let's count by outcome regardless — no wait. Let's keep it simple: count by classification (what happened to our send). The write race is a rare double-run artifact. Fine — actually, let me have recordSendOutcome return a boolean and only increment when it's true; if false, it means another run handled it → don't count. Either is defensible; I'll count on successful record (state actually transitioned) — cleaner "behavior" semantics. Hmm, but then a legitimate send that got recorded is... always recorded for a true first send. OK: count on recorded===true.

Hmm wait, there's a bug risk: if a concurrent executePayments ran first and recorded OUTCOME_UNKNOWN (its transient), and our run's accepted outcome write is skipped → the order stays UNKNOWN → reconcile will later prove settlement/absence. Correct and safe. ✓.

markSettled WHERE { id, status: { in: [SENT, OUTCOME_UNKNOWN] } } data { status: SETTLED, settledAt }.
markParked WHERE { id, status: { in: [SENT, OUTCOME_UNKNOWN] }, attemptCount: MAX_ATTEMPTS }? Include the attempts guard: if attempts < 5 somehow, parking is wrong. The service checked; a concurrent claim could bump it to 5... e.g., the service reads attempts=5 (from a stale list fetch), a concurrent run... no wait, if the service read attempts=5, the claim requires the exact count — a claim at 5 is impossible (the service parks at ≥5 without claiming). Concurrent claims only happen from a run that read attempts<5 → bumps to at most 5. If it becomes 5 right before our park: the WHERE attemptCount: MAX_ATTEMPTS → true → park. Correct (5 attempts done, all proven absent... well, the 5th attempt is in flight — hmm, if a concurrent run just claimed the 5th and is sending, and we park → the send goes out as the 5th (already in flight) → status REJECTED/SENT/UNKNOWN overwrites PARKED?? recordResendOutcome's WHERE status in (SENT, UNKNOWN) — PARKED isn't in the set → skip. ✓ Park wins; the in-flight 5th send's result is discarded → if it landed, the order is PARKED even though it settled → human review → treasury finds it in the statement. Safe direction (never auto-unparks). OK, include the attempts guard in the park WHERE. Actually — simpler: the service only parks when the row it saw had attempts ≥ 5; the WHERE is just status in (SENT, UNKNOWN). A claim can't bump it above 5 (a claim at 5 is impossible — no run claims at ≥5). If a row has attempts=5, no concurrent claim can happen (all claimers saw <5 → their CAS is on a stale count → they fail... wait: run A read attempts=4 (stale), run B read attempts=5. B parks. A claims with expected 4 — the row's attempts is 5 → WHERE attemptCount: 4 fails → A's claim no-op. ✓.) So the park WHERE = status in (SENT, UNKNOWN) is safe. Let's keep just that (less magic).

Now the summary type:

```ts
export interface ReconcileSummary {
  settled: number;
  resent: number;          // successful resend sends (accepted+duplicate)
  stillAwaiting: number;   // not yet provable, or transient resend outcome
  parked: number;
  rejected: number;        // permanent rejection on resend
}
```

Keep it coarse. And ExecutePaymentsSummary { accepted, duplicate, transient, permanent }.

Now — the service must not touch Prisma ✓ (only store + bank). The controller: none.

Tests: `test/payout.spec.ts`. Cases (behavior):

1. **timeout-but-settled (no resend)**: an order sent (attempt 1) timed out → status OUTCOME_UNKNOWN, txid T, effectiveDate today-0? Let's use today (not past lag — to prove that settlement doesn't need the lag): bank statement (today) contains T. reconcile → status SETTLED, settledAt ≈ now, bank.send not called. Assert: order.status 'SETTLED', sendLog length 0. Also assert that the amount is unchanged, etc.

2. **proven-absent → resend with same txid**: an order OUTCOME_UNKNOWN attempts 1, txid T, lastAttemptAt 1 hour ago (past lag), effectiveDate yesterday; statement (yesterday) empty. reconcile → exactly one bank.send, with { txid: T, amount: same, key: same }; order attempts 2; status per the outcome (script the bank to return transient → still UNKNOWN; or accepted → SENT). Assert send args + state.

3. **not yet past lag → no resend**: an order UNKNOWN, lastAttemptAt now-5min (within lag), effectiveDate yesterday; statement empty. reconcile → no send, status UNKNOWN, attempts 1, lastAttemptAt unchanged.

4. **attempt exhaustion → parked, never reverted**: an order UNKNOWN attempts 5, past lag, statement empty → reconcile → PARKED, parkedAt set, no send. Run reconcile again (same window) → still PARKED, still no sends, nothing reverted (status PARKED, attempts 5).

5. **reconcile idempotent over overlapping/same window**: an order UNKNOWN attempts 1, lastAttempt long ago, statement empty; run reconcile at T (resends → attempts 2, accepted → SENT, lastAttempt T). Run reconcile again at T (same now) → no new send (lag on the new attempt), state identical after both (attempts 2, SENT). Assert sendLog length 1 across both runs.

6. **the 4 send outcomes take distinct paths** (executePayments): four pending orders; the bank returns 202 (accepted) → SENT; 409 (duplicate) → SENT (duplicate counted); 503/0 (transient) → OUTCOME_UNKNOWN; 422 (permanent) → REJECTED with reason. All attemptCount 1, txid derived (assert txid = deriveTxid(id, date)). Also assert the same txid is reused... (covered in 2).

7. Or: **resend permanent rejection → REJECTED** (distinct from parked).

8. **derived txid is deterministic**: deriveTxid same input → same output; different date → different. (Unit, but a behavior contract — the "derived not generated" acceptance.)

Let me also double-check test 5's "identical state after both": after run 1 at T: attempts 2, SENT, lastAttempt T. Run 2 at T: candidate (SENT), not settled, pastLag? lastAttempt T + 30 > T → no → stillAwaiting. State unchanged. ✓.

Now, the fake store must faithfully implement the conditional semantics (CAS), because the tests rely on it (e.g., the idempotency test). Write it carefully as an in-memory class:

```ts
class InMemoryOrderStore extends PayoutOrderStore {  // abstract
  rows = new Map<string, PayoutOrderRow & mutable>();
  add(order) {...}
  async findPending() { return [...rows.values()].filter(r => r.status==='PENDING' && r.attemptCount===0).map(clone) }
  async findAwaitingEvidence(days) { const daySet = new Set(days.map(d=>d.getTime())); return [...].filter(r => (r.status==='SENT'||r.status==='OUTCOME_UNKNOWN') && daySet.has(startOfUtcDay(r.effectiveDate).getTime())) }
  async recordSendOutcome(id, d) { const r = rows.get(id); if (!r || r.status!=='PENDING' || r.attemptCount!==0) return false; Object.assign(r, d, { txid: d.txid }); return true; }
  async claimResend(id, expected, now) { const r = rows.get(id); if (!r || !AWAITING.includes(r.status) || r.attemptCount!==expected) return false; r.attemptCount = expected+1; r.lastAttemptAt = now; return true; }
  async recordResendOutcome(id, d) { const r = rows.get(id); if (!r || !AWAITING.includes(r.status)) return false; Object.assign(r, d); return true; }
  async markSettled(id, at) { ...status SENT/UNKNOWN → SETTLED, settledAt: at }
  async markParked(id, at) { ...→ PARKED, parkedAt: at }
}
```

Hmm wait — the fake must not import Prisma enums as string values... define the status as a string union in the repository file:

```ts
export type PayoutStatusValue = 'PENDING' | 'SENT' | 'OUTCOME_UNKNOWN' | 'SETTLED' | 'REJECTED' | 'PARKED';
```

And the repository maps to/from the Prisma enum (Prisma enum values are these same strings — the enum PayoutStatus has members PENDING, SENT, OUTCOME_UNKNOWN, SETTLED, REJECTED, PARKED → runtime values 'PENDING' etc. So `row.status as PayoutStatusValue` works since the strings are identical). In the real repository, use Prisma's enum in queries: `status: { in: [PayoutStatus.SENT, PayoutStatus.OUTCOME_UNKNOWN] }`, and map the result `.status as PayoutStatusValue`? Prisma types the field as `$Enums.PayoutStatus` — assignable to my union since the values match? TS: is the enum type assignable to a string-literal union? No — a string enum isn't assignable to a string-literal union (enums are nominal-ish). Cast: `status: model.status as PayoutStatusValue`. Fine in the repository.

Actually — do we even need the separate union? The service imports `PayoutStatusValue` from the repository file. Yes.

PayoutOrderRow:

```ts
export interface PayoutOrderRow {
  id: string;
  supplierId: string;
  key: string;
  amountMinor: number;
  currency: string;
  effectiveDate: Date;
  status: PayoutStatusValue;
  txid: string | null;
  attemptCount: number;
  lastAttemptAt: Date | null;
  rejectionReason: string | null;
  settledAt: Date | null;
  parkedAt: Date | null;
}
```

The real repository's select: id, supplierId, key, amountMinor, currency, effectiveDate, status, txid, attemptCount, lastAttemptAt, rejectionReason, settledAt, parkedAt. createdAt/updatedAt excluded.

Now, the abstract-class-as-abstract-store:

```ts
export abstract class PayoutOrderStore {
  abstract findPending(): Promise<PayoutOrderRow[]>;
  abstract findAwaitingEvidence(effectiveDates: Date[]): Promise<PayoutOrderRow[]>;
  abstract recordSendOutcome(id: string, data: { status: PayoutStatusValue; txid: string; attemptCount: number; lastAttemptAt: Date; rejectionReason: string | null }): Promise<boolean>;
  abstract claimResend(id: string, expectedAttemptCount: number, now: Date): Promise<boolean>;
  abstract recordResendOutcome(id: string, data: { status: PayoutStatusValue; rejectionReason: string | null }): Promise<boolean>;
  abstract markSettled(id: string, at: Date): Promise<boolean>;
  abstract markParked(id: string, at: Date): Promise<boolean>;
}
```

The service: `constructor(private readonly orders: PayoutOrderStore, private readonly bank: BankClient) {}` — Nest injects by the abstract class tokens; the module provides the bindings.

The module:

```ts
@Module({
  imports: [BankModule],
  providers: [
    PayoutRepository,
    { provide: PayoutOrderStore, useExisting: PayoutRepository },
    PayoutService,
    PayoutProcessor,
  ],
  exports: [PayoutService],
})
export class PayoutModule {}
```

Hmm — `useExisting: PayoutRepository` where PayoutRepository extends PayoutOrderStore: Nest checks that the existing provider (PayoutRepository) satisfies the token (PayoutOrderStore) — at runtime it's just an object; no type check. Works.

Wait — does PayoutRepository need @Injectable() with no constructor args (prisma created in the property initializer)? `@Injectable() export class PayoutRepository extends PayoutOrderStore { private readonly prisma = new PrismaClient(); ... }` ✓.

Bank module:

```ts
@Module({
  providers: [BankHttpClient, { provide: BankClient, useExisting: BankHttpClient }],
  exports: [BankClient],
})
export class BankModule {}
```

BankClient is an abstract class in `bank-client.ts`; BankHttpClient in `bank-http-client.ts`.

Now `bank-client.ts` contents:

```ts
export interface Settlement { txid: string }  // ASSUMPTION: the bank's statement entry exposes at least the txid we submitted

export interface BankSendRequest { txid: string; amount: number; key: string }

export interface BankSendResponse {
  statusCode: number;  // 0 when no HTTP response was received (network failure / timeout)
  reason: string;
}

export abstract class BankClient {
  abstract send(request: BankSendRequest): Promise<BankSendResponse>;
  abstract getStatement(date: Date): Promise<Settlement[]>;
}
```

`bank-http-client.ts`:

```ts
@Injectable()
export class BankHttpClient extends BankClient {
  // ASSUMPTION: the bank exposes POST {BANK_BASE_URL}/instant-payments and GET {BANK_BASE_URL}/statements?date=YYYY-MM-DD, with a bearer auth header.
  ...
}
```

Now, the service file — let me write it out completely in my head:

```ts
import { Inject, Injectable } from '@nestjs/common';
```
Wait — the service constructor uses abstract class tokens directly (class-typed parameters) → no @Inject needed (Nest infers the token from the parameter type). ✓.

```ts
import { PayoutOrderRow, PayoutOrderStore, PayoutStatusValue } from './payout.repository.js';
import { BankClient, BankSendRequest, BankSendResponse, Settlement } from '../bank/bank-client.js';
import { DAY_MS, startOfUtcDay } from '../dates.js';

export const MAX_ATTEMPTS = 5;
export const PUBLISHING_LAG_MS = 30 * 60 * 1000;
export const MAX_RECONCILE_WINDOW_DAYS = 14;

export interface ReconcileWindow { from: Date; to: Date }

export type SendOutcome = 'accepted' | 'duplicate' | 'transient' | 'permanent';

export function deriveTxid(orderId: string, effectiveDate: Date): string {
  // ASSUMPTION: the bank accepts a 64-char lowercase hex string as a txid.
  const seed = `${orderId}:${toUtcYmd(effectiveDate)}`;
  return createHash('sha256').update(seed).digest('hex');
}

export function classifySend(response: BankSendResponse): SendOutcome {
  // ASSUMPTION: the bank reports "already have this txid" with HTTP 409.
  if (response.statusCode === 0) return 'transient';
  if (response.statusCode >= 200 && response.statusCode < 300) return 'accepted';
  if (response.statusCode === 409) return 'duplicate';
  if (response.statusCode === 408 || response.statusCode === 429 || response.statusCode >= 500) return 'transient';
  return 'permanent';
}

export function daysInWindow(window: ReconcileWindow): Date[] {
  if (window.to <= window.from) return [];
  const spanDays = (window.to.getTime() - window.from.getTime()) / DAY_MS + 1;
  if (spanDays > MAX_RECONCILE_WINDOW_DAYS) throw new Error(`reconcile window spans ${...} days; max is ${MAX_RECONCILE_WINDOW_DAYS}`);
  const first = startOfUtcDay(window.from);
  const last = startOfUtcDay(new Date(window.to.getTime() - 1));
  const days: Date[] = [];
  for (let t = first.getTime(); t <= last.getTime(); t += DAY_MS) days.push(new Date(t));
  return days;
}

export function isPastPublishingLag(lastAttemptAt: Date | null, now: Date): boolean {
  const base = lastAttemptAt ? lastAttemptAt.getTime() : 0;
  return now.getTime() - base >= PUBLISHING_LAG_MS;
}

export function buildScheduledWindow(now: Date): ReconcileWindow {
  const today = startOfUtcDay(now);
  return { from: new Date(today.getTime() - DAY_MS), to: new Date(today.getTime() + DAY_MS) };
}
```

Hmm wait — the lag rule: I decided `now >= lastAttemptAt + LAG` (drop the dayEnd). Let me re-verify against the acceptance: "send timed out and the order is proven absent past lag → resend." The test sets lastAttemptAt = now - 31min → eligible. ✓. And "timeout-but-settled" — the settlement path doesn't check the lag at all. ✓.

Hmm, one more sanity check on dropping dayEnd: an order effective today, lastAttempt 09:00, now 10:00, today's statement fetched at 10:00. The bank lags by up to 30 min → anything that landed by 09:30 is visible; our send was at 09:00 → if it landed, it's visible by 09:30... wait, if it landed at 09:00:05, it's visible by 09:35:05 ≤ 10:00 ✓. So absence at 10:00 proves the 09:00 send didn't land (under the ≤30-min lag assumption). ✓ dayEnd is unnecessary.

But: what about a payment that lands late? I.e., the bank accepted at 09:00 but settles at 23:00 (processing delay)? "Instant payment" — settles near-instantly. The spec's model: send → (land or not) → statement entry within 30 min. Trust the spec's model.

Service methods:

```ts
@Injectable()
export class PayoutService {
  constructor(
    private readonly orders: PayoutOrderStore,
    private readonly bank: BankClient,
  ) {}

  async executePayments(now: Date = new Date()): Promise<ExecutePaymentsSummary> {
    const pending = await this.orders.findPending();
    const summary: ExecutePaymentsSummary = { accepted: 0, duplicate: 0, transient: 0, permanent: 0 };
    for (const order of pending) {
      const txid = deriveTxid(order.id, order.effectiveDate);
      const response = await this.sendToBank({ txid, amount: order.amountMinor, key: order.key });
      const outcome = classifySend(response);
      const recorded = await this.orders.recordSendOutcome(order.id, {
        status: statusFor(outcome),
        txid,
        attemptCount: 1,
        lastAttemptAt: now,
        rejectionReason: outcome === 'permanent' ? response.reason : null,
      });
      if (recorded) summary[outcome]++;
    }
    return summary;
  }

  async reconcile(window: ReconcileWindow, now: Date = new Date()): Promise<ReconcileSummary> {
    const summary: ReconcileSummary = { settled: 0, resent: 0, stillAwaiting: 0, rejected: 0, parked: 0 };
    const days = daysInWindow(window);
    if (days.length === 0) return summary;

    // Fetch all statements before touching any state: a failed fetch changes nothing.
    const statements = await Promise.all(days.map((day) => this.bank.getStatement(day)));
    const settledTxids = new Set<string>();
    for (const entry of statements) for (const s of entry) settledTxids.add(s.txid);

    const candidates = await this.orders.findAwaitingEvidence(days);
    for (const order of candidates) {
      // Orders already matched are skipped before any decision is made about them.
      if (order.txid !== null && settledTxids.has(order.txid)) {
        if (await this.orders.markSettled(order.id, now)) summary.settled++;
        continue;
      }
      if (order.txid === null || !isPastPublishingLag(order.lastAttemptAt, now)) {
        summary.stillAwaiting++;
        continue;
      }
      // Proven absent past the publishing lag: the only situation where a resend is allowed.
      if (order.attemptCount >= MAX_ATTEMPTS) {
        if (await this.orders.markParked(order.id, now)) summary.parked++;
        continue;
      }
      // Claim the resend atomically so overlapping runs cannot double-send.
      if (!(await this.orders.claimResend(order.id, order.attemptCount, now))) {
        summary.stillAwaiting++;
        continue;
      }
      const response = await this.sendToBank({ txid: order.txid, amount: order.amountMinor, key: order.key });
      const outcome = classifySend(response);
      const recorded = await this.orders.recordResendOutcome(order.id, {
        status: statusFor(outcome),
        rejectionReason: outcome === 'permanent' ? response.reason : null,
      });
      if (!recorded) { summary.stillAwaiting++; continue; }
      if (outcome === 'accepted' || outcome === 'duplicate') summary.resent++;
      else if (outcome === 'permanent') summary.rejected++;
      else summary.stillAwaiting++;
    }
    return summary;
  }

  private async sendToBank(request: BankSendRequest): Promise<BankSendResponse> {
    try {
      return await this.bank.send(request);
    } catch (error) {
      // A throw means we did not get a bank answer: outcome unknown.
      return { statusCode: 0, reason: error instanceof Error ? error.message : String(error) };
    }
  }
}

function statusFor(outcome: SendOutcome): PayoutStatusValue {
  switch (outcome) {
    case 'accepted':
    case 'duplicate': return 'SENT';       // the bank has the instruction; awaiting the statement
    case 'transient': return 'OUTCOME_UNKNOWN';
    case 'permanent': return 'REJECTED';
  }
}
```

Wait — statusFor for duplicate in the initial path: SENT, fine.

One issue: in `executePayments`, `recordSendOutcome` with attemptCount: 1 — but the CAS in the repository's WHERE is attemptCount: 0 (the initial). Passing attemptCount in data is fine.

Hmm, another edge: two different pending orders — sequential send, one bank call fails... independent. ✓.

A summary type for executePayments:
```ts
export interface ExecutePaymentsSummary { accepted: number; duplicate: number; transient: number; permanent: number }
```

`ReconcileSummary { settled, resent, stillAwaiting, rejected, parked }`.

Now the real repository:

```ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient, PayoutStatus } from '@prisma/client';

@Injectable()
export class PayoutRepository extends PayoutOrderStore implements OnModuleDestroy {
  private readonly prisma = new PrismaClient();

  async onModuleDestroy(): Promise<void> { await this.prisma.$disconnect(); }

  async findPending(): Promise<PayoutOrderRow[]> {
    const rows = await this.prisma.payoutOrder.findMany({
      where: { status: PayoutStatus.PENDING, attemptCount: 0 },
      orderBy: { createdAt: 'asc' },
      take: 100,
      ...SELECT,
    });
    return rows.map(toRow);
  }

  async findAwaitingEvidence(effectiveDates: Date[]): Promise<PayoutOrderRow[]> {
    const rows = await this.prisma.payoutOrder.findMany({
      where: {
        status: { in: [PayoutStatus.SENT, PayoutStatus.OUTCOME_UNKNOWN] },
        txid: { not: null },
        effectiveDate: { in: effectiveDates },
      },
      ...SELECT,
    });
    return rows.map(toRow);
  }

  async recordSendOutcome(id, data) {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id, status: PayoutStatus.PENDING, attemptCount: 0 },
      data: { status: data.status, txid: data.txid, attemptCount: 1, lastAttemptAt: data.lastAttemptAt, rejectionReason: data.rejectionReason },
    });
    return result.count === 1;
  }

  async claimResend(id, expectedAttemptCount, now) {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id, status: { in: [PayoutStatus.SENT, PayoutStatus.OUTCOME_UNKNOWN] }, attemptCount: expectedAttemptCount },
      data: { attemptCount: { increment: 1 }, lastAttemptAt: now },
    });
    return result.count === 1;
  }

  async recordResendOutcome(id, data) {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id, status: { in: [PayoutStatus.SENT, PayoutStatus.OUTCOME_UNKNOWN] } },
      data: { status: data.status, rejectionReason: data.rejectionReason },
    });
    return result.count === 1;
  }

  async markSettled(id, at) {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id, status: { in: [PayoutStatus.SENT, PayoutStatus.OUTCOME_UNKNOWN] } },
      data: { status: PayoutStatus.SETTLED, settledAt: at },
    });
    return result.count === 1;
  }

  async markParked(id, at) {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id, status: { in: [PayoutStatus.SENT, PayoutStatus.OUTCOME_UNKNOWN] } },
      data: { status: PayoutStatus.PARKED, parkedAt: at },
    });
    return result.count === 1;
  }
}
```

`status: data.status` — data.status is PayoutStatusValue (a string union) but Prisma expects the $Enums.PayoutStatus. Cast: `status: data.status as PayoutStatus`. OK.

SELECT constant: `const SELECT = { supplierId: true, key: true, amountMinor: true, currency: true, effectiveDate: true, status: true, txid: true, attemptCount: true, lastAttemptAt: true, rejectionReason: true, settledAt: true, parkedAt: true } as const;` and `toRow`:

```ts
function toRow(m: { id: string; supplierId: string; ... status: $Enums.PayoutStatus; ... }): PayoutOrderRow {
  return { id: m.id, ..., status: m.status as PayoutStatusValue, ... };
}
```

The type of m: use Prisma's `PayoutOrder` model type? With the partial select, the result type differs; simpler: don't select — fetch all columns (id, createdAt, updatedAt included), and map to the row (ignoring createdAt/updatedAt). Drop the SELECT constant; `toRow(m: PayoutOrder)` with `import { PayoutOrder } from '@prisma/client'`? Prisma exports the model type `PayoutOrder` when using the default generator. Yes: `import type { PayoutOrder } from '@prisma/client'`.

```ts
function toRow(m: PayoutOrder): PayoutOrderRow {
  return {
    id: m.id, supplierId: m.supplierId, key: m.key, amountMinor: m.amountMinor,
    currency: m.currency, effectiveDate: m.effectiveDate,
    status: m.status as PayoutStatusValue, txid: m.txid,
    attemptCount: m.attemptCount, lastAttemptAt: m.lastAttemptAt,
    rejectionReason: m.rejectionReason, settledAt: m.settledAt, parkedAt: m.parkedAt,
  };
}
```

Now the schema — currency: needed? The bank's amount is minor units; the currency is part of the "stable order attributes"... it's not part of the txid derivation. Is currency a required field? The spec's example is € (EUR). Include `currency String @default("EUR")` — defensible, minimal. Or drop it? Money without a currency is sloppy; keep it.

Supplier: `supplierId` — the orders reference a supplier; we don't model a Supplier (not asked). Keep supplierId as a string. The "key" = the bank account key for the payment (IBAN-like) — the beneficiary's key. Fine.

The migration SQL must match the schema exactly. Let me write it carefully (Prisma-style):

```sql
-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'SENT', 'OUTCOME_UNKNOWN', 'SETTLED', 'REJECTED', 'PARKED');

-- CreateTable
CREATE TABLE "payout_orders" (
    "id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "effective_date" TIMESTAMPTZ NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "txid" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMPTZ,
    "rejection_reason" TEXT,
    "settled_at" TIMESTAMPTZ,
    "parked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP(6)? 
```

Prisma uses `now()` for the default in the migration: `DEFAULT now()`. And `updated_at TIMESTAMPTZ NOT NULL`. Indexes + PK constraint name: Prisma's naming: `payout_orders_pkey`, `payout_orders_status_effective_date_idx`, `payout_orders_txid_idx`. Prisma's cuid default is app-side (no SQL default). `id TEXT NOT NULL` + `CONSTRAINT "payout_orders_pkey" PRIMARY KEY ("id")`.

Schema:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum PayoutStatus {
  PENDING
  SENT
  OUTCOME_UNKNOWN
  SETTLED
  REJECTED
  PARKED
}

model PayoutOrder {
  id              String       @id @default(cuid()) @map("id")
  supplierId      String       @map("supplier_id")
  key             String       @map("key")
  amountMinor     Int          @map("amount_minor")
  currency        String       @default("EUR") @map("currency")
  effectiveDate   DateTime     @map("effective_date")
  status          PayoutStatus @default(PENDING) @map("status")
  txid            String?      @map("txid")
  attemptCount    Int          @default(0) @map("attempt_count")
  lastAttemptAt   DateTime?    @map("last_attempt_at")
  rejectionReason String?      @map("rejection_reason")
  settledAt       DateTime?    @map("settled_at")
  parkedAt        DateTime?    @map("parked_at")
  createdAt       DateTime     @default(now()) @map("created_at")
  updatedAt       DateTime     @updatedAt @map("updated_at")

  @@index([status, effectiveDate], map: "payout_orders_status_effective_date_idx")
  @@index([txid], map: "payout_orders_txid_idx")
  @@map("payout_orders")
}
```

Wait — the convention says "tables and columns: snake_case (via Prisma @map/@@map)." Field names in the model are camelCase (TS), mapped to snake_case columns. ✓. Should I add `map:` on the indexes? Prisma's default index name = `<table>_<cols>_idx` — matches; explicit map is optional. Let's include an explicit map for determinism with the migration. Fine.

Comment about effectiveDate being UTC midnight: add a comment line in the schema.

`key` as a column name — "key" isn't a reserved word in Postgres (it's a non-reserved keyword; Prisma will quote it anyway). Fine.

Now `src/dates.ts`:

```ts
export const DAY_MS = 24 * 60 * 60 * 1000;

/** The start of the UTC day containing `date`. */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** A calendar date as YYYY-MM-DD in UTC. */
export function toUtcYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}
```

Processor:

```ts
import { Cron, CronExpression } from '@nestjs/schedule';
import { Injectable } from '@nestjs/common';
import { buildScheduledWindow, PayoutService } from './payout.service.js';

/**
 * The scheduled reconcile job: every 15 minutes, reconcile the two most recent
 * calendar days (yesterday + today). The window overlaps by design; reconcile
 * is idempotent over it.
 */
@Injectable()
export class PayoutProcessor {
  constructor(private readonly payouts: PayoutService) {}

  @Cron(CronExpression.EVERY_15_MINUTES)
  async reconcileScheduledWindow(): Promise<void> {
    const now = new Date();
    await this.payouts.reconcile(buildScheduledWindow(now), now);
  }
}
```

Now the tests. `test/payout.spec.ts`. Let me write it with a fake.

```ts
import { describe, expect, it } from 'vitest';
import { BankClient, BankSendRequest, BankSendResponse, Settlement } from '../src/bank/bank-client.js';
import { PayoutOrderRow, PayoutOrderStore, PayoutStatusValue } from '../src/payout/payout.repository.js';
import {
  deriveTxid, classifySend, daysInWindow, isPastPublishingLag, buildScheduledWindow,
  MAX_ATTEMPTS, PayoutService, PUBLISHING_LAG_MS, ReconcileWindow,
} from '../src/payout/payout.service.js';
import { DAY_MS, startOfUtcDay } from '../src/dates.js';
```

Wait — importing `PayoutOrderStore` (the abstract class) from `payout.repository.js` — the repository file imports `@prisma/client` and instantiates PrismaClient in the class... import-time side effects: the module imports { PrismaClient, PayoutStatus } from '@prisma/client' — just an import; `new PrismaClient()` only in the constructor (not called by the import). But `@prisma/client` in the test environment: the package must be generated (postinstall `prisma generate`) — in a test setup, `@prisma/client` without a generated client throws at import time ("@prisma/client did not initialize yet. Please run prisma generate")!! That breaks the test import (the test imports the repository file for the types).

Hmm. Options:
1. Make the tests run after prisma generate (a pretest script: `prisma generate && vitest`). Then the @prisma/client import is fine. But it needs the schema and network? prisma generate is local (the engine is downloaded... the prisma package includes it? It downloads the engine on install). In CI with pnpm install, @prisma/client's postinstall triggers generate if the schema is present. So the generated client exists → the import works, no DB needed. ✓.
2. Or put the abstract store + row type in a separate file (`payout.store.ts`?) — deviates from the layout convention (the repository file is specified).
3. Or a type-only import in the test: `import type { PayoutOrderStore } from ...` — but the fake must extend PayoutOrderStore (runtime) → a value import is needed.

Hmm, wait, actually: with a default `prisma-client-js` generator, `@prisma/client`'s index re-exports the generated client; without a generate, it throws at require time. To be safe: (a) a `pretest`/`generate` script in package.json; (b) the convention: pnpm runs @prisma/client's postinstall → generate. Let me add `"postinstall": "prisma generate"` to package.json — standard for Prisma projects. That makes the test import safe.

Alternatively, avoid the value import: the fake doesn't extend the abstract; the service's constructor takes `PayoutOrderStore` (the type) — a plain object structurally implementing the methods is assignable? The abstract class has no private members → structural typing works! `class FakeStore { ... same methods ... }` — is `FakeStore` assignable to the `PayoutOrderStore` type? An abstract class with only abstract methods → the type is just the method signatures → structural ✓. So the test only needs `import type { PayoutOrderStore }` (erased at runtime) + the PayoutOrderRow type (type-only) → no runtime import of the repository module → no @prisma/client in the test runtime.

Similarly BankClient: an abstract class, the fake implements it structurally with `import type { BankClient }`. And a fake bank instance passed to `new PayoutService(fakeStore, fakeBank)` — TS's structural check ✓.

So the test file: type-only imports from the repository + bank-client; value imports from the service + dates + bank-client? (BankSendResponse is an interface — type-only.) Actually, everything from bank-client except nothing is a value... `Settlement` is an interface. So:

```ts
import type { BankClient, BankSendResponse, BankSendRequest, Settlement } from '../src/bank/bank-client.js';
import type { PayoutOrderRow, PayoutOrderStore } from '../src/payout/payout.repository.js';
import { buildScheduledWindow, classifySend, daysInWindow, deriveTxid, isPastPublishingLag, MAX_ATTEMPTS, PUBLISHING_LAG_MS, PayoutService, } from '../src/payout/payout.service.js';
import type { ReconcileWindow } from '../src/payout/payout.service.js';
import { DAY_MS, startOfUtcDay, toUtcYmd } from '../src/dates.js';
```

`payout.service.js` imports `./payout.repository.js` (value? the service only imports types from the repository → use `import type`). And `../bank/bank-client.js` (type-only). So the service module's runtime imports: @nestjs/common (Injectable), crypto, dates. No Prisma → the test is safe even without a generated client. But wait — the service's `@Injectable()` decorator → needs reflect-metadata? Nest's Injectable works without reflect-metadata in tests (it uses a fallback). ✓.

The test fakes:

```ts
class FakeBank {
  sent: BankSendRequest[] = [];
  nextSendResponse: BankSendResponse | Error = { statusCode: 202, reason: '' };
  statements: Map<string, Settlement[]> = new Map();

  async send(request: BankSendRequest): Promise<BankSendResponse> {
    this.sent.push({ ...request });
    if (this.nextSendResponse instanceof Error) throw this.nextSendResponse;
    return this.nextSendResponse;
  }
  async getStatement(date: Date): Promise<Settlement[]> {
    return this.statements.get(toUtcYmd(date)) ?? [];
  }
}
```

Scripted per-call outcomes: better to support a queue: `sendResponses: (BankSendResponse | Error)[]` + a default. Let's do:

```ts
class FakeBank {
  sent: BankSendRequest[] = [];
  private responses: (BankSendResponse | Error)[] = [];
  private fallback: BankSendResponse = { statusCode: 202, reason: '' };
  statements = new Map<string, Settlement[]>();

  queueSendResponse(r: BankSendResponse | Error) { this.responses.push(r); }
  setSendResponse(r: BankSendResponse | Error) { this.fallback = r; }
  async send(req) { this.sent.push({...req}); const r = this.responses.shift() ?? this.fallback; if (r instanceof Error) throw r; return r; }
  async getStatement(date) { return this.statements.get(toUtcYmd(date)) ?? []; }
}
```

Fake store:

```ts
const AWAITING: PayoutStatusValue[] = ['SENT', 'OUTCOME_UNKNOWN'];

class FakeOrderStore {
  rows = new Map<string, PayoutOrderRow>();
  put(row: PayoutOrderRow) { this.rows.set(row.id, { ...row }); return this; }
  get(id: string) { return this.rows.get(id); }

  async findPending(): Promise<PayoutOrderRow[]> {
    return [...this.rows.values()].filter(r => r.status === 'PENDING' && r.attemptCount === 0).map(r => ({ ...r }));
  }
  async findAwaitingEvidence(effectiveDates: Date[]): Promise<PayoutOrderRow[]> {
    const days = new Set(effectiveDates.map(d => d.getTime()));
    return [...this.rows.values()].filter(r =>
      AWAITING.includes(r.status) && r.txid !== null && days.has(startOfUtcDay(r.effectiveDate).getTime()),
    ).map(r => ({ ...r }));
  }
  async recordSendOutcome(id, data) {
    const r = this.rows.get(id);
    if (!r || r.status !== 'PENDING' || r.attemptCount !== 0) return false;
    Object.assign(r, data);
    return true;
  }
  async claimResend(id, expectedAttemptCount, now) {
    const r = this.rows.get(id);
    if (!r || !AWAITING.includes(r.status) || r.attemptCount !== expectedAttemptCount) return false;
    r.attemptCount += 1;
    r.lastAttemptAt = now;
    return true;
  }
  async recordResendOutcome(id, data) {
    const r = this.rows.get(id);
    if (!r || !AWAITING.includes(r.status)) return false;
    Object.assign(r, data);
    return true;
  }
  async markSettled(id, at) {
    const r = this.rows.get(id);
    if (!r || !AWAITING.includes(r.status)) return false;
    r.status = 'SETTLED'; r.settledAt = at;
    return true;
  }
  async markParked(id, at) {
    const r = this.rows.get(id);
    if (!r || !AWAITING.includes(r.status)) return false;
    r.status = 'PARKED'; r.parkedAt = at;
    return true;
  }
}
```

The structural conformance to PayoutOrderStore: the methods must match the signatures. `recordSendOutcome(id: string, data: {...}): Promise<boolean>` ✓.

Helper to build an order row:

```ts
function order(overrides: Partial<PayoutOrderRow> & { id: string }): PayoutOrderRow {
  return {
    id: overrides.id,
    supplierId: 'sup-1',
    key: 'DE89370400440532013000',
    amountMinor: 1840000,   // €18,400.00 — a nod to the incident
    currency: 'EUR',
    effectiveDate: startOfUtcDay(new Date(Date.UTC(2025, 0, 15))),
    status: 'OUTCOME_UNKNOWN',
    txid: null,
    attemptCount: 1,
    lastAttemptAt: null,
    rejectionReason: null,
    settledAt: null,
    parkedAt: null,
    ...overrides,
  };
}
```

Time anchor: NOW = startOfUtcDay(2025-01-20) + a few hours. Let's define in the test:

```ts
const DAY = (iso: string) => startOfUtcDay(new Date(iso));   // '2025-01-15' → UTC midnight
```

Hmm, `new Date('2025-01-15')` is UTC midnight ✓.

Test 1 — timeout-but-settled:

```ts
it('settles a timed-out order that is in the statement and never re-sends it', async () => {
  const now = new Date(Date.UTC(2025, 0, 20, 10, 0));
  const effective = DAY('2025-01-20');          // same day as now: not past lag
  const txid = deriveTxid('ord-1', effective);
  const store = new FakeOrderStore().put(order({ id: 'ord-1', effectiveDate: effective, txid, status: 'OUTCOME_UNKNOWN', lastAttemptAt: new Date(now.getTime() - 5 * 60_000) }));
  const bank = new FakeBank();
  bank.statements.set(toUtcYmd(effective), [{ txid }]);
  const service = new PayoutService(store, bank);
  const window = buildScheduledWindow(now);
  await service.reconcile(window, now);
  const after = store.get('ord-1')!;
  expect(after.status).toBe('SETTLED');
  expect(after.settledAt).toEqual(now);
  expect(bank.sent).toEqual([]);
});
```

The window from now (2025-01-20) → days {2025-01-19, 2025-01-20} ✓ includes effective.

Test 2 — proven absent, same txid:

```ts
it('re-sends a timed-out order with the same txid once absence is proven past the lag', async () => {
  const now = new Date(Date.UTC(2025, 0, 20, 10, 0));
  const effective = DAY('2025-01-19');   // yesterday
  const txid = deriveTxid('ord-2', effective);
  store.put(order({ id: 'ord-2', effectiveDate: effective, txid, status: 'OUTCOME_UNKNOWN', attemptCount: 1, lastAttemptAt: new Date(now.getTime() - (PUBLISHING_LAG_MS + 60_000)) }));
  bank.setSendResponse({ statusCode: 503, reason: 'bank unavailable' });   // the resend also fails transiently
  const service = ...;
  await service.reconcile(buildScheduledWindow(now), now);
  expect(bank.sent).toEqual([{ txid, amount: 1840000, key: 'DE89...' }]);   // same txid
  const after = store.get('ord-2')!;
  expect(after.attemptCount).toBe(2);
  expect(after.status).toBe('OUTCOME_UNKNOWN');
});
```

Also assert the txid equals the originally-sent one — it is, since we set it via deriveTxid with the same inputs; the assertion that bank.sent[0].txid === the original txid is the point. To make it meaningful, let the original txid be "whatever was sent before" — but it's deterministic, so the equality holds. To emphasize "same txid," the test could use a txid the fake bank recorded in the original send... well — equality with deriveTxid(id, effective) is the contract. Let me add an explicit comment.

Test 3 — not yet past lag:

```ts
it('does not re-send while the publishing lag has not elapsed', async () => {
  now; effective yesterday; lastAttemptAt = now - 5min; statement empty.
  → no send, attempts 1, status unchanged, lastAttemptAt unchanged.
});
```

Test 4 — exhaustion:

```ts
it('parks for review after five attempts and never reverts', async () => {
  effective yesterday; txid; attemptCount: MAX_ATTEMPTS (5); lastAttemptAt past lag; status OUTCOME_UNKNOWN; statement empty.
  run reconcile → PARKED, parkedAt = now, no send.
  run reconcile again (same window, same now) → still PARKED, parkedAt unchanged, no send, attemptCount still 5, no field reverted (status stays PARKED).
  Also run a third time with a later now → still PARKED.
});
```

Test 5 — idempotent over same/overlapping window:

```ts
it('is idempotent when run twice over the same window', async () => {
  effective yesterday, UNKNOWN attempts 1, lastAttempt now-2h, statement empty.
  bank.setSendResponse({ statusCode: 202, reason: '' }); // the resend is accepted
  run1 = await service.reconcile(window, now);
  → the order is SENT, attempts 2, lastAttemptAt now; bank.sent length 1.
  run2 = await service.reconcile(window, now);   // same window, same time
  → bank.sent still 1 (the fresh send is within its own lag); state identical: SENT attempts 2.
});
```

Hmm — "identical state after both": after run1 the state is S1; after run2 the state is S1. Assert equality of the row after both runs (deep equal to a snapshot after run1). ✓.

Test 6 — the 4 outcomes in executePayments:

```ts
it('routes each bank.send outcome to its own state', async () => {
  const effective = DAY('2025-01-20'); const now = ...;
  four pending orders ord-a..d (status PENDING, attemptCount 0, txid null).
  bank.queueSendResponse({ statusCode: 202, reason: '' });       // accepted
  bank.queueSendResponse({ statusCode: 409, reason: 'duplicate' }); // duplicate
  bank.queueSendResponse({ statusCode: 503, reason: '503' });    // transient
  bank.queueSendResponse({ statusCode: 422, reason: 'blocked account' }); // permanent
  const summary = await service.executePayments(now);
  expect(summary).toEqual({ accepted: 1, duplicate: 1, transient: 1, permanent: 1 });
  a: SENT, txid === deriveTxid('ord-a', effective), attemptCount 1, lastAttemptAt now
  b: SENT (a duplicate is a success), attemptCount 1
  c: OUTCOME_UNKNOWN
  d: REJECTED, rejectionReason 'blocked account'
  // and all sent with the derived txid:
  expect(bank.sent.map(s => s.txid)).toEqual([deriveTxid('ord-a', effective), ...]);
});
```

Wait — ordering: findPending orders by createdAt asc — the fake returns in insertion order (Map preserves insertion). Insert a,b,c,d in order ✓.

Hmm — a thrown response (network) → transient: add to this test? queueSendResponse(new Error('socket hang up')) for one order → OUTCOME_UNKNOWN, attempt 1. Add a 5th order. Good — covers "the send path records the unknown outcome." Let's include 5 orders: accepted, duplicate, 503, thrown Error, 422. Summary: accepted 1, duplicate 1, transient 2, permanent 1.

Test 7 — derived txid determinism:

```ts
it('derives a stable txid from the order and its effective date', () => {
  const d1 = DAY('2025-01-15'), d2 = DAY('2025-01-15');
  expect(deriveTxid('ord-9', d1)).toBe(deriveTxid('ord-9', d2));
  expect(deriveTxid('ord-9', d1)).not.toBe(deriveTxid('ord-9', DAY('2025-01-16')));
  expect(deriveTxid('ord-9', d1)).not.toBe(deriveTxid('ord-10', d1));
  expect(deriveTxid('ord-9', d1)).toMatch(/^[0-9a-f]{64}$/);
});
```

Test 8 — the classification boundaries (unit but behavior contract):

```ts
it('classifies bank responses into the four outcomes', () => {
  expect(classifySend({ statusCode: 202, reason: '' })).toBe('accepted');
  expect(classifySend({ statusCode: 409, reason: '' })).toBe('duplicate');
  expect(classifySend({ statusCode: 500, reason: '' })).toBe('transient');
  expect(classifySend({ statusCode: 408, reason: '' })).toBe('transient');
  expect(classifySend({ statusCode: 429, reason: '' })).toBe('transient');
  expect(classifySend({ statusCode: 0, reason: 'timeout' })).toBe('transient');
  expect(classifySend({ statusCode: 400, reason: 'malformed' })).toBe('permanent');
  expect(classifySend({ statusCode: 422, reason: 'blocked account' })).toBe('permanent');
});
```

Test 9 — daysInWindow / lag helper (light):

```ts
it('maps a window onto whole calendar days', () => {
  const now = new Date(Date.UTC(2025, 0, 20, 0, 15));
  expect(daysInWindow(buildScheduledWindow(now))).toEqual([DAY('2025-01-19'), DAY('2025-01-20')]);
});
it('treats an order as past lag exactly 30 minutes after its last attempt', () => {
  const t = new Date(Date.UTC(2025, 0, 20, 10, 0));
  expect(isPastPublishingLag(new Date(t.getTime() - PUBLISHING_LAG_MS), t)).toBe(true);
  expect(isPastPublishingLag(new Date(t.getTime() - PUBLISHING_LAG_MS + 1000), t)).toBe(false);
});
```

And a resend-permanent test:

```ts
it('marks a re-sent order rejected when the bank permanently rejects it', ...)
```
Might merge into an exhaustion-ish describe. Keep the suite focused on the acceptance: timeout-but-settled, proven-absent, exhaustion, idempotency, 4-outcome routing, plus the small helper contracts. Good coverage without bloat. Let me also assert that a settled order isn't touched by a subsequent reconcile (covered by the idempotency test with a SETTLED row? Test 1 settles; add a second reconcile call → still SETTLED, settledAt unchanged, no send). Let's add that to test 1: run reconcile again → state unchanged.

Also, "never auto-revert" — in the exhaustion test, after parked, run a reconcile with a statement that contains the txid?? Wait — if the statement contains the txid and the order is PARKED: the candidate query excludes PARKED → stays PARKED (not auto-settled, not reverted) — human review reconciles. Hmm — is that desirable? A parked order that later appears in the statement: we know it settled; but we don't auto-transition a parked order (a human should see the full history). The spec: "after that, the order goes to a terminal state a human reviews. Never auto-revert, never release, never mark it failed-and-forget." Terminal → no auto-transitions at all. ✓ Our design (the candidate excludes PARKED). Let's add that assertion to the exhaustion test: after parking, add the txid to the statement and reconcile → still PARKED (no auto-settle, no release).

Wait, careful — that assertion: is it "correct"? A human would want to know it settled. But auto-transitioning a parked order = "auto-release"? Marking it SETTLED is a release of the review... The spec says terminal, human-reviewed, no auto-revert. Keep it terminal. ✓.

Now — `package.json`:

```json
{
  "name": "supplier-payouts",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "start:dev": "nest start --watch"?? — needs the @nestjs/cli dev dep; skip nest cli: "start:dev": "tsx watch src/main.ts" (tsx dev dep)
    "test": "vitest run",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate deploy",
    "postinstall": "prisma generate"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.0",
    "@nestjs/core": "^10.3.0",
    "@nestjs/platform-express": "^10.3.0",
    "@nestjs/schedule": "^4.1.0",
    "@prisma/client": "^5.16.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "prisma": "^5.16.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "@types/node": "^20.14.0"
  }
}
```

NestJS v10 (stable, Node 20 ✓). @nestjs/schedule v4 works with Nest 10 ✓. Prisma 5 ✓. Vitest 2 ✓.

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "useDefineForClassFields": false,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src"]
}
```

`useDefineForClassFields: false` — important for Nest DI (constructor parameter properties). With target ES2022 the default is true → class fields use `define` semantics → Nest's DI... the common Nest guidance: set `useDefineForClassFields: false` for Nest compatibility (with emitDecoratorMetadata). Include it.

rootDir src, include src → the tests are excluded from the build (fine; vitest runs TS directly).

Do we need `@types/express`? The platform-express types are included. OK.

Now — do the `.js` extensions work with `moduleResolution: NodeNext` + vitest? Vitest (vite) resolves `./payout.service.js` → `./payout.service.ts` ✓ (vite handles it).

`import { createHash } from 'node:crypto';` ✓ Node built-in.

The processor uses `@Cron(CronExpression.EVERY_15_MINUTES)` — the string '*/15 * * * *'. ✓.

The schedule module: `ScheduleModule.forRoot()` in AppModule. The processor is a provider of PayoutModule. The @Cron method runs in-process. ✓.

Now — main.ts listens on a PORT; no controllers → an HTTP server with no routes; fine (the app exists to run the cron; health too? not asked).

Double-check the convention: "endpoints are kebab-case plural" — no endpoints, N/A. "Error envelope" — N/A (no HTTP error surface). I'm comfortable.

Now, let me reconsider the `executePayments` signature: `executePayments()` per the task. The `now` parameter with a default — OK ("executePayments(now?)" is still callable as executePayments()). Tests pass now explicitly. ✓. Same for reconcile(window, now?).

Now — let me write the full service file with comments explaining the money flow (the incident's rationale). The comments in English ✓.

Another design question: should `reconcile` handle `pending` orders that were never sent but are past lag? No — a pending order wasn't sent; its absence means nothing; executePayments will send it. Reconcile doesn't touch PENDING. ✓ (The spec: resends only for failed/timed-out sends.)

And `REJECTED` orders (permanent, initial): not candidates. A human reviews. ✓.

Let me reconsider the summary field names once more:

```ts
export interface ExecutePaymentsSummary {
  accepted: number;
  duplicate: number;
  transient: number;
  permanent: number;
}

export interface ReconcileSummary {
  settled: number;
  resent: number;
  stillAwaiting: number;
  rejected: number;
  parked: number;
}
```

Now, potential subtlety in the fake store's findAwaitingEvidence: the real repository filters by effectiveDate IN days (exact Date match). The fake uses startOfUtcDay(r.effectiveDate) ∈ days — more lenient (works even if effectiveDate has a time). The real DB requires exact midnight storage. Slight fake/real divergence — acceptable (the fake is a behavior stand-in). But the tests must set effectiveDate to midnight anyway (they do). Fine.

Now, `recordSendOutcome` — the fake uses Object.assign(r, data), where data contains status, txid, attemptCount (1), lastAttemptAt, rejectionReason ✓.

Let me think about the real repository's `recordSendOutcome` — `data.status` is a union; cast to PayoutStatus: `status: data.status as PayoutStatus`. TS: casting from a string union to an enum — is it allowed? A string-literal union to a string enum: TS allows casts when there's overlap — actually, `as` requires comparability; 'SENT' (a literal) vs PayoutStatus (an enum type) — the enum members are subtypes... casting from a union of literals to an enum: I think `'SENT' as PayoutStatus` errors ("neither type sufficiently overlaps")? A string enum: PayoutStatus.SENT has the type PayoutStatus.SENT; the literal 'SENT' is not assignable to the enum type, and the enum type is assignable to... hmm, casting between them: TS's comparability — the enum literal type is comparable with its literal value? I recall needing `as unknown as PayoutStatus` in some cases. Safer: map explicitly:

```ts
const PRISMA_STATUS: Record<PayoutStatusValue, PayoutStatus> = {
  PENDING: PayoutStatus.PENDING,
  SENT: PayoutStatus.SENT,
  OUTCOME_UNKNOWN: PayoutStatus.OUTCOME_UNKNOWN,
  SETTLED: PayoutStatus.SETTLED,
  REJECTED: PayoutStatus.REJECTED,
  PARKED: PayoutStatus.PARKED,
};
```

And `status: PRISMA_STATUS[data.status]`. Clean, no casts. In toRow: `status: m.status as PayoutStatusValue` — the reverse cast from enum to union: does the enum type overlap with the literal? A Prisma enum's $Enums.PayoutStatus is an enum type; casting to a literal union — again potentially an error. Use an inverse record or `String(m.status) as PayoutStatusValue`? Simplest: define `const FROM_PRISMA: Record<PayoutStatus, PayoutStatusValue> = {...}` and `status: FROM_PRISMA[m.status]`. Both maps are 6 lines each — fine, explicit, no `as` acrobatics. Actually, simpler: a single bidirectional map:

```ts
const STATUS: Record<PayoutStatusValue, PayoutStatus> = {...};
const STATUS_FROM_PRISMA: Record<PayoutStatus, PayoutStatusValue> = {
  [PayoutStatus.PENDING]: 'PENDING', ... 
};
```
Or just derive it: `Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [v, k]))` — typed as Record<PayoutStatus, PayoutStatusValue>. Fine:

```ts
const STATUS_TO_PRISMA: Record<PayoutStatusValue, PayoutStatus> = { PENDING: PayoutStatus.PENDING, ... };
const STATUS_FROM_PRISMA: Record<PayoutStatus, PayoutStatusValue> = Object.fromEntries(
  Object.entries(STATUS_TO_PRISMA).map(([value, status]) => [status, value]),
) as Record<PayoutStatus, PayoutStatusValue>;
```

The `as` there is harmless (fromEntries returns a string index). OK.

Prisma client property name: `this.prisma.payoutOrder` (model PayoutOrder → property payoutOrder) ✓.

Now the migration directory name: `prisma/migrations/20250101000000_init/migration.sql`. Include `migration_lock.toml`.

Let me also double-check the Prisma schema syntax: `@default(cuid())` ✓; `Int` ✓; `@@index([status, effectiveDate], map: "...")` — the correct Prisma syntax for an index map is `@@index([status, effectiveDate], map: "name")` ✓ (Prisma 5: `map` works; the newer `name:`? `@@index(..., map: "x")` is valid).

Enum inside the schema → a Postgres enum ✓; migration creates the type ✓.

Now — the amount in `bank.send`: the bank client sends `amount: req.amount` (minor units) ✓ "amount is integer minor units end to end" — the schema is Int, the TS is number (integer value), the bank's JSON is a number (integer). ✓.

The HTTP client's getStatement: the response is parsed as `Settlement[]` — map defensively? `body.map((e: { txid: string }) => ({ txid: e.txid }))`? Keep it simple: `as Settlement[]`. Fine.

Now the processor — should it log? No logging infrastructure is specified; skip (or a minimal console? "Don't invent" — skip).

Error handling in the processor: a cron run that throws → Nest logs it; the next run retries. Our reconcile: a bank failure throws before any write ✓ safe.

Now, is `ScheduleModule.forRoot()` needed in the tests? No (no app bootstrap). ✓.

Let me also verify that the PayoutModule exports PayoutService (the wiring convention: providers used by other modules are exportsed) — nothing else imports PayoutModule's service; export it anyway? "A provider used by another module is exportsed by its own module" — only if used. PayoutService isn't used by other modules (the processor is in the same module). Don't export? A module without controllers/exports is fine. Hmm, exporting the service is harmless and common. The convention says to export when used by another module — it isn't → no exports. Keep the module minimal: imports: [BankModule], providers: [PayoutRepository, {provide: PayoutOrderStore, useExisting: PayoutRepository}, PayoutService, PayoutProcessor].

Wait — ordering: does `useExisting: PayoutRepository` require PayoutRepository to be listed? Same providers array — Nest resolves it. ✓.

BankModule: providers [BankHttpClient, { provide: BankClient, useExisting: BankHttpClient }], exports [BankClient]. ✓.

AppModule: imports [ScheduleModule.forRoot(), PayoutModule]. ✓.

main.ts: standard. Add `app.enableShutdownHooks()`? For Prisma's $disconnect via onModuleDestroy — Nest calls onModuleDestroy on SIGTERM/SIGINT by default? Actually, lifecycle hooks on shutdown require... `onModuleDestroy` runs on `app.close()` and on signals (SIGINT) — does Nest register signal handlers by default in v10? `NestFactory.create` + `app.listen` — SIGINT handling: does Nest add signal listeners automatically? In Nest 10, yes — it registers `SIGTERM`/`SIGINT` listeners by default and calls close (I think app.enableShutdownHooks is for process hooks like uncaughtException... hmm). To be safe, add `app.enableShutdownHooks()` — a one-liner that ensures onModuleDestroy fires on signals. Include it.

Now — a subtle test-environment concern: importing `@nestjs/common` in the test (via the service) is fine.

Another check — the service file exports `buildScheduledWindow`, `daysInWindow`, `deriveTxid`, `classifySend`, `isPastPublishingLag`, `MAX_ATTEMPTS`, `PUBLISHING_LAG_MS`, the types, the class. The processor imports buildScheduledWindow + PayoutService. ✓.

Potential circular import: none (service → repository (type), bank-client (type), dates; processor → service; the repository → @prisma/client).

Now let me write the `BankHttpClient` completely:

```ts
import { Injectable } from '@nestjs/common';
import { toUtcYmd } from '../dates.js';
import { BankClient, BankSendRequest, BankSendResponse, Settlement } from './bank-client.js';

/**
 * Thin HTTP transport for the bank's instant-payment API.
 *
 * ASSUMPTION: the bank exposes `POST {BANK_BASE_URL}/instant-payments`
 * (body: { txid, amount, key }) and `GET {BANK_BASE_URL}/statements?date=YYYY-MM-DD`,
 * authenticated with a bearer token, and returns the statement entries as a JSON array.
 */
@Injectable()
export class BankHttpClient extends BankClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor() {
    super();
    this.baseUrl = (process.env.BANK_BASE_URL ?? '').replace(/\/+$/, '');
    this.apiKey = process.env.BANK_API_KEY ?? '';
    this.timeoutMs = Number(process.env.BANK_TIMEOUT_MS ?? '10000');
  }

  async send(request: BankSendRequest): Promise<BankSendResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/instant-payments`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ txid: request.txid, amount: request.amount, key: request.key }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const reason = (await response.text()).trim();
      return { statusCode: response.status, reason };
    } catch (error) {
      // No answer from the bank at all (DNS, socket, timeout): the outcome is unknown.
      return { statusCode: 0, reason: describe(error) };
    }
  }

  async getStatement(date: Date): Promise<Settlement[]> {
    const response = await fetch(`${this.baseUrl}/statements?date=${toUtcYmd(date)}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`bank statement for ${toUtcYmd(date)} unavailable: HTTP ${response.status}`);
    }
    return (await response.json()) as Settlement[];
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${this.apiKey}`,
    };
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

Note: the content-type header on GET is harmless. OK.

Hmm — one more thing about `getStatement` throwing: `Promise.all` in reconcile rejects → the run aborts with no state change ✓. But partial: the fetch for day 1 succeeds, day 2 throws → all is aborted; nothing was written (the fetch precedes the writes) ✓.

Now let me reconsider whether `executePayments` should also be invoked by the processor... no (decided).

The test file — let me write it fully, carefully, with good behavior descriptions. Also a "second run over an overlapping window" variant: run 1 at now with window W, run 2 at now+15min with window W' (overlapping: same days) — the same-lag logic applies. My idempotency test uses the same now (stronger: same window, same instant). Let's do both: same instant (strict) — plus a second run at now+15min also no resend (lag on the new attempt). Let's include it: run 2 at now + 15min: lastAttempt = now → now+15min < now+30min → no resend. ✓ Assert bank.sent length is still 1.

Also let me double-check that `claimResend` in the real repository uses `attemptCount: { increment: 1 }` — but the WHERE pins the expected count → the result is deterministically expected+1. ✓.

Edge: `recordResendOutcome` after a claim — the fake sets the status; if the bank's send is 'accepted' → SENT. attempts stays 2. ✓.

Now — let me re-check the acceptance list against the tests:
1. "Send timed out but the order is in the statement → no resend, order settles" → test 1 ✓
2. "Send timed out and the order is proven absent past lag → resend, same txid" → test 2 ✓
3. "Attempts exhausted → parked for review, nothing reverted" → test 4 ✓ (plus no auto-settle after parking)
4. "reconcile run twice over the same window → identical state after both" → test 5 ✓
5. "Each of the 4 send outcomes takes a distinct path" → test 6 ✓ (executePayments) + classification test.

Also "cap attempts at 5" — the exhaustion test uses attempts=5. Also test: attempts=4, past lag, absent → resend (claim 4→5) → then if still absent, the next run parks. Maybe add: a resend from attempts 4 happens; then (now+lag) a run with attempts 5 → parks. This covers the transition to exhaustion via the actual flow. Let's add test: "the fifth attempt is the last: an order with 4 attempts is re-sent once, then parked when still absent." Sequence:
- Order attempts 4, UNKNOWN, past lag, statement empty.
- bank fallback: transient (503).
- reconcile at T → attempts 5, UNKNOWN, 1 send.
- bank fallback still 503.
- reconcile at T + LAG + 1s → attempts 5 ≥ MAX → PARKED. No additional send (total sends 1).
✓ Good — covers the cap boundary (a 5th send is allowed; a 6th is not).

Hmm wait — a subtlety: at T+LAG+1s, is the order past lag? lastAttemptAt = T (set by the claim at T) → T + LAG ≤ T+LAG+1s ✓.

And the "same txid" across resends: in that test, both sends use the same txid (there's only one send)... test 2 covers the same-txid explicitly. In the cap test, we can also assert the single send's txid = the original. Fine.

Now, one more concern — the default `now` parameter: `executePayments(now: Date = new Date())`. In Nest DI, the service is constructed once; the parameter default is evaluated at call time ✓.

Vitest test timing: no fake timers needed (we pass `now` explicitly).

Now, the `PayoutOrderRow` — is `supplierId` needed by the service? No, but part of the row (for completeness/audit). Keep.

Let me also reconsider: the service's `reconcile` — fetch candidates after the statements ✓. The candidates include rows for both days. A row's effectiveDate is in days → its statement is in the pool ✓.

Potential issue: two different orders (different suppliers) on the same date → different txids (different order IDs) ✓ no cross-match.

Same order id, different dates → different txids; a statement on date D1 contains txid(order,D1); the candidate on date D1 matches; the candidate on date D2 looks for txid(order,D2) ✓ no false settlement.

Now the file list (final):
1. `package.json`
2. `tsconfig.json`
3. `prisma/schema.prisma`
4. `prisma/migrations/migration_lock.toml`
5. `prisma/migrations/20250101000000_init/migration.sql`
6. `src/main.ts`
7. `src/app.module.ts`
8. `src/dates.ts`
9. `src/bank/bank-client.ts`
10. `src/bank/bank-http-client.ts`
11. `src/bank/bank.module.ts`
12. `src/payout/payout.repository.ts`
13. `src/payout/payout.service.ts`
14. `src/payout/payout.processor.ts`
15. `src/payout/payout.module.ts`
16. `test/payout.spec.ts`

No controller (not asked). No vitest.config (defaults suffice). No .env (no secrets in the repo; the environment provides DATABASE_URL etc.).

Hmm — is `main.ts`/`app.module.ts` "not asked for"? The task: "Build in TypeScript + NestJS + Prisma + Postgres" + the deliverables. A NestJS solution needs an entry point and a root module to be a coherent app; the convention layout lists them. I'm confident including them.

`.gitignore`? Not asked; skip. `README`? Skip (the prose isn't parsed anyway; don't invent).

Now, the strict TS check per file.

**src/dates.ts** ✓ trivial.

**src/bank/bank-client.ts**:

```ts
/**
 * Port for the bank's instant-payment API.
 *
 * We deliberately assume nothing about the bank beyond the two operations
 * `send({txid, amount, key})` and `getStatement(date) -> Settlement[]`.
 */

/** One entry in the bank's daily statement: the txid we submitted. */
export interface Settlement {
  txid: string;
}

export interface BankSendRequest {
  txid: string;
  /** Amount in minor units (integer). */
  amount: number;
  /** Beneficiary account key. */
  key: string;
}

/**
 * Normalised transport result of a send. `statusCode` is 0 when no HTTP
 * response was received at all (network failure, timeout) — that is the
 * "outcome unknown" case.
 */
export interface BankSendResponse {
  statusCode: number;
  reason: string;
}

export abstract class BankClient {
  abstract send(request: BankSendRequest): Promise<BankSendResponse>;
  abstract getStatement(date: Date): Promise<Settlement[]>;
}
```

Wait — an abstract class with only abstract methods: a class that extends it needs a super() call in the constructor. BankHttpClient does `constructor() { super(); ... }` ✓. FakeBank in the test: no constructor → the implicit `constructor() { super(); }` ✓ (an abstract class with no fields — an implicit super() is fine).

**payout.repository.ts** — write it completely:

```ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PayoutOrder, PayoutStatus, PrismaClient } from '@prisma/client';

/**
 * Status of a payout order. PENDING/SENT/OUTCOME_UNKNOWN are the only states
 * the machine moves through on its own; SETTLED/REJECTED/PARKED are terminal
 * and reviewed by a human.
 */
export type PayoutStatusValue = 'PENDING' | 'SENT' | 'OUTCOME_UNKNOWN' | 'SETTLED' | 'REJECTED' | 'PARKED';

export interface PayoutOrderRow {
  id: string;
  supplierId: string;
  key: string;
  amountMinor: number;
  currency: string;
  /** The effective date of the payment, stored at UTC midnight. */
  effectiveDate: Date;
  status: PayoutStatusValue;
  /** The txid that was actually submitted to the bank; null before the first send. */
  txid: string | null;
  attemptCount: number;
  lastAttemptAt: Date | null;
  rejectionReason: string | null;
  settledAt: Date | null;
  parkedAt: Date | null;
}

export interface SendRecord {
  status: PayoutStatusValue;
  txid: string;
  lastAttemptAt: Date;
  rejectionReason: string | null;
}

export interface ResendRecord {
  status: PayoutStatusValue;
  rejectionReason: string | null;
}

/**
 * The persistence contract for payout orders. Every transition is a
 * conditional (compare-and-set) update so that overlapping runs can never
 * double-act on the same order or overwrite a state a later run already took.
 */
export abstract class PayoutOrderStore {
  /** Orders that were never sent. */
  abstract findPending(): Promise<PayoutOrderRow[]>;
  /** Orders awaiting statement evidence for the given UTC days. */
  abstract findAwaitingEvidence(effectiveDates: Date[]): Promise<PayoutOrderRow[]>;
  /** Record the first send. Only valid from PENDING with zero attempts. */
  abstract recordSendOutcome(id: string, data: SendRecord): Promise<boolean>;
  /**
   * Claim the right to perform the next resend. Atomic: exactly one of
   * concurrent claimers with the same expected count succeeds.
   */
  abstract claimResend(id: string, expectedAttemptCount: number, now: Date): Promise<boolean>;
  /** Record the outcome of a resend. Skipped if the order left the awaiting states. */
  abstract recordResendOutcome(id: string, data: ResendRecord): Promise<boolean>;
  abstract markSettled(id: string, at: Date): Promise<boolean>;
  abstract markParked(id: string, at: Date): Promise<boolean>;
}

const STATUS_TO_PRISMA: Record<PayoutStatusValue, PayoutStatus> = {
  PENDING: PayoutStatus.PENDING,
  SENT: PayoutStatus.SENT,
  OUTCOME_UNKNOWN: PayoutStatus.OUTCOME_UNKNOWN,
  SETTLED: PayoutStatus.SETTLED,
  REJECTED: PayoutStatus.REJECTED,
  PARKED: PayoutStatus.PARKED,
};

const STATUS_FROM_PRISMA: Record<PayoutStatus, PayoutStatusValue> = {
  [PayoutStatus.PENDING]: 'PENDING',
  [PayoutStatus.SENT]: 'SENT',
  [PayoutStatus.OUTCOME_UNKNOWN]: 'OUTCOME_UNKNOWN',
  [PayoutStatus.SETTLED]: 'SETTLED',
  [PayoutStatus.REJECTED]: 'REJECTED',
  [PayoutStatus.PARKED]: 'PARKED',
};

const AWAITING_EVIDENCE: PayoutStatus[] = [PayoutStatus.SENT, PayoutStatus.OUTCOME_UNKNOWN];

function toRow(order: PayoutOrder): PayoutOrderRow {
  return {
    id: order.id,
    supplierId: order.supplierId,
    key: order.key,
    amountMinor: order.amountMinor,
    currency: order.currency,
    effectiveDate: order.effectiveDate,
    status: STATUS_FROM_PRISMA[order.status],
    txid: order.txid,
    attemptCount: order.attemptCount,
    lastAttemptAt: order.lastAttemptAt,
    rejectionReason: order.rejectionReason,
    settledAt: order.settledAt,
    parkedAt: order.parkedAt,
  };
}

/** The only layer that touches the database. */
@Injectable()
export class PayoutRepository extends PayoutOrderStore implements OnModuleDestroy {
  private readonly prisma = new PrismaClient();

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async findPending(): Promise<PayoutOrderRow[]> {
    const orders = await this.prisma.payoutOrder.findMany({
      where: { status: PayoutStatus.PENDING, attemptCount: 0 },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    return orders.map(toRow);
  }

  async findAwaitingEvidence(effectiveDates: Date[]): Promise<PayoutOrderRow[]> {
    const orders = await this.prisma.payoutOrder.findMany({
      where: {
        status: { in: AWAITING_EVIDENCE },
        txid: { not: null },
        effectiveDate: { in: effectiveDates },
      },
    });
    return orders.map(toRow);
  }

  async recordSendOutcome(id: string, data: SendRecord): Promise<boolean> {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id, status: PayoutStatus.PENDING, attemptCount: 0 },
      data: {
        status: STATUS_TO_PRISMA[data.status],
        txid: data.txid,
        attemptCount: 1,
        lastAttemptAt: data.lastAttemptAt,
        rejectionReason: data.rejectionReason,
      },
    });
    return result.count === 1;
  }

  async claimResend(id: string, expectedAttemptCount: number, now: Date): Promise<boolean> {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id, status: { in: AWAITING_EVIDENCE }, attemptCount: expectedAttemptCount },
      data: { attemptCount: { increment: 1 }, lastAttemptAt: now },
    });
    return result.count === 1;
  }

  async recordResendOutcome(id: string, data: ResendRecord): Promise<boolean> {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id, status: { in: AWAITING_EVIDENCE } },
      data: {
        status: STATUS_TO_PRISMA[data.status],
        rejectionReason: data.rejectionReason,
      },
    });
    return result.count === 1;
  }

  async markSettled(id: string, at: Date): Promise<boolean> {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id, status: { in: AWAITING_EVIDENCE } },
      data: { status: PayoutStatus.SETTLED, settledAt: at },
    });
    return result.count === 1;
  }

  async markParked(id: string, at: Date): Promise<boolean> {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id, status: { in: AWAITING_EVIDENCE } },
      data: { status: PayoutStatus.PARKED, parkedAt: at },
    });
    return result.count === 1;
  }
}
```

Wait — the `PayoutOrder` import is used only as a type (toRow) → `import { PayoutStatus, PrismaClient } from '@prisma/client'; import type { PayoutOrder } from '@prisma/client';` — under NodeNext + isolatedModules? I didn't enable isolatedModules; a normal import of a type is fine, but for cleanliness: a separate `import type`. ✓.

**payout.service.ts**:

```ts
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { toUtcYmd } from '../dates.js';
import type { BankClient, BankSendRequest, BankSendResponse } from '../bank/bank-client.js';
import { DAY_MS, startOfUtcDay } from '../dates.js';
import type { PayoutOrderRow, PayoutOrderStore, PayoutStatusValue } from './payout.repository.js';

/** Hard cap on bank sends per order; the order parks for manual review after this. */
export const MAX_ATTEMPTS = 5;

/**
 * The bank's publishing lag: a settlement is in the statement at most this
 * long after it happens. Absence is only proof past this delay.
 */
export const PUBLISHING_LAG_MS = 30 * 60 * 1000;

/** Sanity cap so a bad window cannot fan out into hundreds of statement fetches. */
export const MAX_RECONCILE_WINDOW_DAYS = 14;

export interface ReconcileWindow {
  /** Inclusive lower bound (any instant). */
  from: Date;
  /** Exclusive upper bound (any instant). */
  to: Date;
}

export type SendOutcome = 'accepted' | 'duplicate' | 'transient' | 'permanent';

export interface ExecutePaymentsSummary {
  accepted: number;
  duplicate: number;
  transient: number;
  permanent: number;
}

export interface ReconcileSummary {
  settled: number;
  /** Resends actually sent to the bank in this run (accepted or duplicate). */
  resent: number;
  /** Orders that remain awaiting evidence after this run. */
  stillAwaiting: number;
  rejected: number;
  parked: number;
}

/**
 * The txid is derived, not generated: the same order on the same effective
 * date always produces the same txid, so the bank recognises a re-send as the
 * same instruction and the statement can be matched back to the order.
 */
export function deriveTxid(orderId: string, effectiveDate: Date): string {
  // ASSUMPTION: the bank accepts a 64-char lowercase hex (SHA-256) string as a txid.
  const seed = `${orderId}:${toUtcYmd(effectiveDate)}`;
  return createHash('sha256').update(seed).digest('hex');
}

/**
 * Maps a raw bank response to the four outcomes. A transient error (no
 * response, 5xx, 408, 429) means the outcome is unknown: we may only record
 * that and wait for evidence — never act on it.
 */
export function classifySend(response: BankSendResponse): SendOutcome {
  if (response.statusCode === 0) return 'transient';
  if (response.statusCode >= 200 && response.statusCode < 300) return 'accepted';
  // ASSUMPTION: the bank answers 409 when it already holds this txid.
  if (response.statusCode === 409) return 'duplicate';
  if (response.statusCode === 408 || response.statusCode === 429 || response.statusCode >= 500) {
    return 'transient';
  }
  return 'permanent';
}

/** The UTC calendar days (midnights) covered by a half-open window. */
export function daysInWindow(window: ReconcileWindow): Date[] {
  if (window.to.getTime() <= window.from.getTime()) return [];
  const spanDays = (window.to.getTime() - window.from.getTime()) / DAY_MS + 1;
  if (spanDays > MAX_RECONCILE_WINDOW_DAYS) {
    throw new Error(`reconcile window spans more than ${MAX_RECONCILE_WINDOW_DAYS} days`);
  }
  const first = startOfUtcDay(window.from).getTime();
  const last = startOfUtcDay(new Date(window.to.getTime() - 1)).getTime();
  const days: Date[] = [];
  for (let t = first; t <= last; t += DAY_MS) days.push(new Date(t));
  return days;
}

/**
 * An order is past the publishing lag once the bank would have published an
 * entry for its latest attempt by now: lag or more has elapsed since the last
 * attempt.
 */
export function isPastPublishingLag(lastAttemptAt: Date | null, now: Date): boolean {
  const base = lastAttemptAt !== null ? lastAttemptAt.getTime() : 0;
  return now.getTime() - base >= PUBLISHING_LAG_MS;
}

/**
 * The scheduled job reconciles yesterday and today: today's statement still
 * receives entries (settlements), and yesterday's is only complete once the
 * lag has passed (so absence there becomes proof).
 */
export function buildScheduledWindow(now: Date): ReconcileWindow {
  const today = startOfUtcDay(now);
  return { from: new Date(today.getTime() - DAY_MS), to: new Date(today.getTime() + DAY_MS) };
}

@Injectable()
export class PayoutService {
  constructor(
    private readonly orders: PayoutOrderStore,
    private readonly bank: BankClient,
  ) {}

  /**
   * First send of pending orders. This path may only record an unknown
   * outcome — it never re-sends. Re-sends happen in reconcile(), and only
   * after the statement proves absence past the publishing lag.
   */
  async executePayments(now: Date = new Date()): Promise<ExecutePaymentsSummary> {
    const pending = await this.orders.findPending();
    const summary: ExecutePaymentsSummary = { accepted: 0, duplicate: 0, transient: 0, permanent: 0 };
    for (const order of pending) {
      const txid = deriveTxid(order.id, order.effectiveDate);
      const response = await this.sendToBank({ txid, amount: order.amountMinor, key: order.key });
      const outcome = classifySend(response);
      const recorded = await this.orders.recordSendOutcome(order.id, {
        status: statusFor(outcome),
        txid,
        lastAttemptAt: now,
        rejectionReason: outcome === 'permanent' ? response.reason : null,
      });
      if (recorded) summary[outcome] += 1;
    }
    return summary;
  }

  /**
   * Match statement entries to orders and advance them. Safe to run every
   * 15 minutes over overlapping windows:
   *  - statements are fetched before any state changes, so a bank failure
   *    changes nothing;
   *  - orders already matched (settled) are not fetched at all;
   *  - every transition is a conditional update, and a resend is claimed
   *    atomically before it happens, so two overlapping runs can never
   *    double-send or double-settle one order.
   */
  async reconcile(window: ReconcileWindow, now: Date = new Date()): Promise<ReconcileSummary> {
    const summary: ReconcileSummary = { settled: 0, resent: 0, stillAwaiting: 0, rejected: 0, parked: 0 };
    const days = daysInWindow(window);
    if (days.length === 0) return summary;

    const statements = await Promise.all(days.map((day) => this.bank.getStatement(day)));
    const settledTxids = new Set<string>();
    for (const entries of statements) {
      for (const entry of entries) settledTxids.add(entry.txid);
    }

    const candidates = await this.orders.findAwaitingEvidence(days);
    for (const order of candidates) {
      // Presence in the statement settles the order — regardless of the lag.
      if (order.txid !== null && settledTxids.has(order.txid)) {
        if (await this.orders.markSettled(order.id, now)) summary.settled += 1;
        continue;
      }
      // Absence is not proof until the lag has passed (and the txid must be
      // known for absence to mean anything).
      if (order.txid === null || !isPastPublishingLag(order.lastAttemptAt, now)) {
        summary.stillAwaiting += 1;
        continue;
      }
      // Proven absent: the only situation where a re-send is permitted.
      if (order.attemptCount >= MAX_ATTEMPTS) {
        // Terminal: a human reviews. Never auto-reverted, released or forgotten.
        if (await this.orders.markParked(order.id, now)) summary.parked += 1;
        continue;
      }
      if (!(await this.orders.claimResend(order.id, order.attemptCount, now))) {
        // A concurrent run already claimed (and probably performed) this resend.
        summary.stillAwaiting += 1;
        continue;
      }
      // Re-send with the same derived txid the bank already saw.
      const response = await this.sendToBank({ txid: order.txid, amount: order.amountMinor, key: order.key });
      const outcome = classifySend(response);
      const recorded = await this.orders.recordResendOutcome(order.id, {
        status: statusFor(outcome),
        rejectionReason: outcome === 'permanent' ? response.reason : null,
      });
      if (!recorded) {
        // The order left the awaiting states in the meantime (e.g. settled).
        summary.stillAwaiting += 1;
        continue;
      }
      if (outcome === 'accepted' || outcome === 'duplicate') summary.resent += 1;
      else if (outcome === 'permanent') summary.rejected += 1;
      else summary.stillAwaiting += 1;
    }
    return summary;
  }

  private async sendToBank(request: BankSendRequest): Promise<BankSendResponse> {
    try {
      return await this.bank.send(request);
    } catch (error) {
      // No answer from the bank at all: outcome unknown, not a failure we may act on.
      return { statusCode: 0, reason: error instanceof Error ? error.message : String(error) };
    }
  }
}

function statusFor(outcome: SendOutcome): PayoutStatusValue {
  switch (outcome) {
    case 'accepted':
    case 'duplicate':
      // The bank holds the instruction; the statement will settle it.
      return 'SENT';
    case 'transient':
      return 'OUTCOME_UNKNOWN';
    case 'permanent':
      return 'REJECTED';
  }
}
```

Wait, `recordSendOutcome`'s data — I changed SendRecord to `{ status, txid, lastAttemptAt, rejectionReason }` (no attemptCount — the repository pins it to 1). The service passes that. ✓ Consistent with the repository definition above (I defined SendRecord without attemptCount — let me check the repository draft: `SendRecord { status; txid; lastAttemptAt; rejectionReason }` ✓, and the repository sets attemptCount: 1 in the data ✓).

The service's `summary[outcome] += 1` — outcome is a union matching the keys ✓.

**payout.processor.ts** ✓ as drafted. Import CronExpression from '@nestjs/schedule'.

**payout.module.ts**:

```ts
import { Module } from '@nestjs/common';
import { BankModule } from '../bank/bank.module.js';
import { PayoutOrderStore, PayoutRepository } from './payout.repository.js';
import { PayoutService } from './payout.service.js';
import { PayoutProcessor } from './payout.processor.js';

@Module({
  imports: [BankModule],
  providers: [
    PayoutRepository,
    { provide: PayoutOrderStore, useExisting: PayoutRepository },
    PayoutService,
    PayoutProcessor,
  ],
})
export class PayoutModule {}
```

**bank.module.ts**:

```ts
import { Module } from '@nestjs/common';
import { BankClient } from './bank-client.js';
import { BankHttpClient } from './bank-http-client.js';

@Module({
  providers: [BankHttpClient, { provide: BankClient, useExisting: BankHttpClient }],
  exports: [BankClient],
})
export class BankModule {}
```

**app.module.ts**:

```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PayoutModule } from './payout/payout.module.js';

@Module({
  imports: [ScheduleModule.forRoot(), PayoutModule],
})
export class AppModule {}
```

**main.ts**:

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? '3000'));
}
void bootstrap();
```

(Does NestFactory import reflect-metadata? In Nest 10, @nestjs/core imports it internally? The convention is to import it in main. Keep it — harmless. Actually with ESM, the top-level `import 'reflect-metadata'` runs first ✓.)

**test/payout.spec.ts** — let me write it completely:

```ts
import { describe, expect, it } from 'vitest';
import { DAY_MS, startOfUtcDay, toUtcYmd } from '../src/dates.js';
import {
  buildScheduledWindow,
  classifySend,
  deriveTxid,
  isPastPublishingLag,
  MAX_ATTEMPTS,
  PUBLISHING_LAG_MS,
  PayoutService,
} from '../src/payout/payout.service.js';
import type {
  BankClient,
  BankSendRequest,
  BankSendResponse,
  Settlement,
} from '../src/bank/bank-client.js';
import type { PayoutOrderRow, PayoutOrderStore } from '../src/payout/payout.repository.js';

const DAY = (isoDate: string): Date => startOfUtcDay(new Date(`${isoDate}T00:00:00Z`));

const KEY = 'DE89370400440532013000';
const AMOUNT = 1_840_000; // €18,400.00 in minor units

function order(overrides: Partial<PayoutOrderRow> & Pick<PayoutOrderRow, 'id'>): PayoutOrderRow {
  return {
    supplierId: 'sup-1',
    key: KEY,
    amountMinor: AMOUNT,
    currency: 'EUR',
    effectiveDate: DAY('2025-01-15'),
    status: 'OUTCOME_UNKNOWN',
    txid: null,
    attemptCount: 1,
    lastAttemptAt: null,
    rejectionReason: null,
    settledAt: null,
    parkedAt: null,
    ...overrides,
  };
}

const AWAITING = ['SENT', 'OUTCOME_UNKNOWN'] as const;

/** In-memory stand-in for the store contract; mirrors the conditional-update semantics. */
class FakeOrderStore {
  private readonly rows = new Map<string, PayoutOrderRow>();

  put(row: PayoutOrderRow): this {
    this.rows.set(row.id, { ...row });
    return this;
  }
  get(id: string): PayoutOrderRow {
    const row = this.rows.get(id);
    expect(row).toBeDefined();
    return { ...row! };
  }

  async findPending(): Promise<PayoutOrderRow[]> {
    return [...this.rows.values()]
      .filter((r) => r.status === 'PENDING' && r.attemptCount === 0)
      .map((r) => ({ ...r }));
  }

  async findAwaitingEvidence(effectiveDates: Date[]): Promise<PayoutOrderRow[]> {
    const days = new Set(effectiveDates.map((d) => d.getTime()));
    return [...this.rows.values()]
      .filter((r) => AWAITING.includes(r.status) && r.txid !== null && days.has(startOfUtcDay(r.effectiveDate).getTime()))
      .map((r) => ({ ...r }));
  }

  async recordSendOutcome(id: string, data: { status: PayoutOrderRow['status']; txid: string; lastAttemptAt: Date; rejectionReason: string | null }): Promise<boolean> {
    const row = this.rows.get(id);
    if (row === undefined || row.status !== 'PENDING' || row.attemptCount !== 0) return false;
    Object.assign(row, data, { attemptCount: 1 });
    return true;
  }

  async claimResend(id: string, expectedAttemptCount: number, now: Date): Promise<boolean> {
    const row = this.rows.get(id);
    if (row === undefined || !AWAITING.includes(row.status) || row.attemptCount !== expectedAttemptCount) return false;
    row.attemptCount += 1;
    row.lastAttemptAt = now;
    return true;
  }

  async recordResendOutcome(id: string, data: { status: PayoutOrderRow['status']; rejectionReason: string | null }): Promise<boolean> {
    const row = this.rows.get(id);
    if (row === undefined || !AWAITING.includes(row.status)) return false;
    Object.assign(row, data);
    return true;
  }

  async markSettled(id: string, at: Date): Promise<boolean> {
    const row = this.rows.get(id);
    if (row === undefined || !AWAITING.includes(row.status)) return false;
    row.status = 'SETTLED';
    row.settledAt = at;
    return true;
  }

  async markParked(id: string, at: Date): Promise<boolean> {
    const row = this.undefined... 
  }
}
```

Hmm wait — `AWAITING.includes(r.status)`, where AWAITING is a readonly tuple of 'SENT'|'OUTCOME_UNKNOWN' and r.status is a wider union — `includes` on a readonly array of a narrower type with a wider argument → TS error (the argument must be the narrower type). Fix: `const AWAITING: PayoutOrderRow['status'][] = ['SENT', 'OUTCOME_UNKNOWN'];` (a plain array of the wide union) → includes accepts the wide union ✓.

Also, the fake's methods must be structurally compatible with PayoutOrderStore — but we don't declare `implements` (to avoid importing the value... wait, the `implements` clause is a type-level position — does it require a value import? `class X implements Y` — Y is used only in a type position → `import type` suffices for implements! Yes: TS allows implements with a type-only import (the clause is erased). Actually hmm — `implements` needs the class type; a type-only import provides that ✓. So I can write `class FakeOrderStore implements PayoutOrderStore` with `import type { PayoutOrderStore }` — and get compile-time conformance checking.

But wait: the data parameter type of `recordSendOutcome` must match SendRecord exactly (structural: my inline type must be identical in shape). Let me also import the type: `import type { SendRecord, ResendRecord } from '../src/payout/payout.repository.js';` and use them. ✓ Cleaner.

Similarly `class FakeBank implements BankClient` with a type-only import ✓.

The fake bank:

```ts
class FakeBank implements BankClient {
  sent: BankSendRequest[] = [];
  private readonly queued: (BankSendResponse | Error)[] = [];
  private defaultResponse: BankSendResponse = { statusCode: 202, reason: '' };
  private readonly statements = new Map<string, Settlement[]>();

  queueSend(response: BankSendResponse | Error): this { this.queued.push(response); return this; }
  setSend(response: BankSendResponse | Error): this { this.defaultResponse = response; return this; }
  statementFor(isoDate: string, txids: string[]): this {
    this.statements.set(isoDate, txids.map((txid) => ({ txid })));
    return this;
  }

  async send(request: BankSendRequest): Promise<BankSendResponse> {
    this.sent.push({ ...request });
    const response = this.queued.shift() ?? this.defaultResponse;
    if (response instanceof Error) throw response;
    return response;
  }

  async getStatement(date: Date): Promise<Settlement[]> {
    return this.statements.get(toUtcYmd(date)) ?? [];
  }
}
```

Note: the `implements BankClient` — BankClient has abstract methods send/getStatement ✓.

Now the tests:

```ts
describe('PayoutService', () => {
  describe('reconcile — timeout but settled', () => {
    it('settles a timed-out order found in the statement and never re-sends it', async () => {
      const now = new Date(Date.UTC(2025, 0, 20, 10, 0, 0));
      const effectiveDate = DAY('2025-01-20');
      const txid = deriveTxid('ord-1', effectiveDate);
      const store = new FakeOrderStore().put(
        order({
          id: 'ord-1',
          effectiveDate,
          txid,
          status: 'OUTCOME_UNKNOWN',
          lastAttemptAt: new Date(now.getTime() - 5 * 60_000), // timed out 5 minutes ago: well inside the lag
        }),
      );
      const bank = new FakeBank().statementFor(toUtcYmd(effectiveDate), [txid]);
      const service = new PayoutService(store, bank);

      const summary = await service.reconcile(buildScheduledWindow(now), now);

      const after = store.get('ord-1');
      expect(after.status).toBe('SETTLED');
      expect(after.settledAt).toEqual(now);
      expect(bank.sent).toEqual([]); // the timeout did not trigger a resend
      expect(summary.settled).toBe(1);
      expect(summary.resent).toBe(0);

      // A second run over the same window changes nothing.
      await service.reconcile(buildScheduledWindow(now), now);
      expect(store.get('ord-1').status).toBe('SETTLED');
      expect(bank.sent).toEqual([]);
    });
  });
```

Wait — `store.get` returns a clone; the `settledAt` comparison is fine.

Note: the order's lastAttemptAt is now-5min and the effective date is today: if the statement were empty, it would be stillAwaiting (not past lag — 5min < 30min) — a good contrast: settlement happens despite being within the lag, proving that the settlement path doesn't require the lag. Maybe add a comment.

```ts
  describe('reconcile — proven absent', () => {
    it('re-sends with the same txid once the statement proves absence past the lag', async () => {
      const now = new Date(Date.UTC(2025, 0, 20, 10, 0, 0));
      const effectiveDate = DAY('2025-01-19');
      const txid = deriveTxid('ord-2', effectiveDate); // the txid the first (timed-out) send used
      const store = new FakeOrderStore().put(
        order({
          id: 'ord-2',
          effectiveDate,
          txid,
          status: 'OUTCOME_UNKNOWN',
          lastAttemptAt: new Date(now.getTime() - PUBLISHING_LAG_MS - 60_000),
        }),
      );
      const bank = new FakeBank().setSend({ statusCode: 503, reason: 'bank unavailable' });
      const service = new PayoutService(store, bank);

      await service.reconcile(buildScheduledWindow(now), now);

      expect(bank.sent).toEqual([{ txid, amount: AMOUNT, key: KEY }]); // same txid, same amount
      const after = store.get('ord-2');
      expect(after.attemptCount).toBe(2);
      expect(after.status).toBe('OUTCOME_UNKNOWN');
      expect(after.lastAttemptAt).toEqual(now);
    });

    it('does not re-send while the publishing lag has not elapsed', async () => {
      const now = new Date(Date.UTC(2025, 0, 20, 10, 0, 0));
      const effectiveDate = DAY('2025-01-19');
      const txid = deriveTxid('ord-3', effectiveDate);
      const store = new FakeOrderStore().put(
        order({
          id: 'ord-3',
          effectiveDate,
          txid,
          status: 'OUTCOME_UNKNOWN',
          lastAttemptAt: new Date(now.getTime() - 5 * 60_000), // 5 minutes ago: inside the 30-minute lag
        }),
      );
      const bank = new FakeBank();
      const service = new PayoutService(store, bank);

      const summary = await service.reconcile(buildScheduledWindow(now), now);

      expect(bank.sent).toEqual([]);
      const after = store.get('ord-3');
      expect(after.status).toBe('OUTCOME_UNKNOWN');
      expect(after.attemptCount).toBe(1);
      expect(after.lastAttemptAt).not.toEqual(now);
      expect(summary.stillAwaiting).toBe(1);
    });

    it('is idempotent when run twice over the same window', async () => {
      const now = new Date(Date.UTC(2025, 0, 20, 10, 0, 0));
      const effectiveDate = DAY('2025-01-19');
      const txid = deriveTxid('ord-4', effectiveDate);
      const store = new FakeOrderStore().put(
        order({
          id: 'ord-4',
          effectiveDate,
          txid,
          status: 'OUTCOME_UNKNOWN',
          lastAttemptAt: new Date(now.getTime() - 2 * 60 * 60_000),
        }),
      );
      const bank = new FakeBank().setSend({ statusCode: 202, reason: '' });
      const service = new PayoutService(store, bank);
      const window = buildScheduledWindow(now);

      await service.reconcile(window, now);
      const afterFirst = store.get('ord-4');
      expect(afterFirst.status).toBe('SENT');
      expect(afterFirst.attemptCount).toBe(2);
      expect(bank.sent).toHaveLength(1);

      // Same window, same instant: the fresh send is still inside its own lag,
      // so nothing may be re-sent.
      await service.reconcile(window, now);
      expect(store.get('ord-4')).toEqual(afterFirst);
      expect(bank.sent).toHaveLength(1);

      // Fifteen minutes later (the next scheduled run) it is still inside the lag.
      await service.reconcile(buildScheduledWindow(new Date(now.getTime() + 15 * 60_000)), new Date(now.getTime() + 15 * 60_000));
      expect(store.get('ord-4')).toEqual(afterFirst);
      expect(bank.sent).toHaveLength(1);
    });
```

Wait — the 15-min-later run: window = buildScheduledWindow(now+15min) → days {2025-01-19, 2025-01-20} (same). The order's lastAttemptAt = now → now+15min - now = 15min < 30min → stillAwaiting ✓. And `store.get` after the first run: a clone at that instant; after the 3rd run, the row is unchanged ✓ deep equal.

Note: `afterFirst.lastAttemptAt` = now (the claim set it). ✓.

```ts
    it('re-sends at most once per lag once absence is proven', ...)
```
— that's covered by the 15-min check above. Skip.

  describe('reconcile — attempt exhaustion', () => {
    it('parks an order for review once attempts are exhausted and never reverts it', async () => {
      const now = new Date(Date.UTC(2025, 0, 20, 10, 0, 0));
      const effectiveDate = DAY('2025-01-19');
      const txid = deriveTxid('ord-5', effectiveDate);
      const store = new FakeOrderStore().put(
        order({
          id: 'ord-5',
          effectiveDate,
          txid,
          status: 'OUTCOME_UNKNOWN',
          attemptCount: MAX_ATTEMPTS,
          lastAttemptAt: new Date(now.getTime() - PUBLISHING_LAG_MS - 60_000),
        }),
      );
      const bank = new FakeBank();
      const service = new PayoutService(store, bank);

      const summary = await service.reconcile(buildScheduledWindow(now), now);

      const after = store.get('ord-5');
      expect(after.status).toBe('PARKED');
      expect(after.parkedAt).toEqual(now);
      expect(bank.sent).toEqual([]); // no sixth send
      expect(summary.parked).toBe(1);

      // Overlapping re-runs, even much later, must not release or revert it.
      const later = new Date(now.getTime() + 6 * 60 * 60_000);
      await service.reconcile(buildScheduledWindow(later), later);
      const afterLater = store.get('ord-5');
      expect(afterLater.status).toBe('PARKED');
      expect(afterLater.parkedAt).toEqual(now);
      expect(afterLater.attemptCount).toBe(MAX_ATTEMPTS);
      expect(bank.sent).toEqual([]);

      // Even evidence that it settled does not auto-release a parked order:
      // a human makes that call.
      bank.statementFor(toUtcYmd(effectiveDate), [txid]);
      const muchLater = new Date(now.getTime() + 2 * DAY_MS);
      await service.reconcile(buildScheduledWindow(muchLater), muchLater);
      expect(store.get('ord-5').status).toBe('PARKED');
    });

Wait — muchLater = now + 2 days → now is 2025-01-20 → muchLater is 2025-01-22 10:00 → window days {2025-01-21, 2025-01-22} — effectiveDate 2025-01-19 is not in the window! So the candidate query doesn't return it anyway → trivially stays PARKED. To make the "even with evidence" assertion meaningful, the window must include 01-19: muchLater would need to be within 2 days of 01-19... but PARKED isn't a candidate regardless of the window (the status filter excludes PARKED) — so the assertion holds trivially and honestly (the point: parked is terminal — no window, no evidence changes it). Fine — the test asserts behavior: a parked order stays parked across runs including ones whose window covers the order's date. Let's pick muchLater = DAY('2025-01-19') + 3 hours → window days {01-18, 01-19} → the window covers the order's date AND the statement contains the txid → a parked order is still untouched. A stronger assertion:

```ts
      bank.statementFor(toUtcYmd(effectiveDate), [txid]);
      const coveringRun = new Date(effectiveDate.getTime() + 3 * 60 * 60_000); // same day, window covers the order's date
      await service.reconcile(buildScheduledWindow(coveringRun), coveringRun);
      expect(store.get('ord-5').status).toBe('PARKED');
```

coveringRun = 01-19 03:00 → window {01-18, 01-19} ✓ covers. The statement for 01-19 contains the txid. A SENT/UNKNOWN order would settle; PARKED stays. ✓ meaningful.

    it('makes the fifth attempt the last, then parks when it too is proven absent', async () => {
      const t0 = new Date(Date.UTC(2025, 0, 20, 10, 0, 0));
      const effectiveDate = DAY('2025-01-19');
      const txid = deriveTxid('ord-6', effectiveDate);
      const store = new FakeOrderStore().put(
        order({
          id: 'ord-6',
          effectiveDate,
          txid,
          status: 'OUTCOME_UNKNOWN',
          attemptCount: MAX_ATTEMPTS - 1, // four attempts so far
          lastAttemptAt: new Date(t0.getTime() - PUBLISHING_LAG_MS - 60_000),
        }),
      );
      const bank = new FakeBank().setSend({ statusCode: 503, reason: 'still down' });
      const service = new PayoutService(store, bank);

      const summary = await service.reconcile(buildScheduledWindow(t0), t0);
      expect(bank.sent).toEqual([{ txid, amount: AMOUNT, key: KEY }]); // the fifth attempt
      expect(store.get('ord-6').attemptCount).toBe(MAX_ATTEMPTS);
      expect(summary.resent).toBe(0);
      expect(summary.stillAwaiting).toBe(1);

      // Once the fifth attempt is also proven absent, the order parks: no sixth send.
      const t1 = new Date(t0.getTime() + PUBLISHING_LAG_MS + 60_000);
      const summary2 = await service.reconcile(buildScheduledWindow(t1), t1);
      const after = store.get('ord-6');
      expect(after.status).toBe('PARKED');
      expect(bank.sent).toHaveLength(1); // still only the fifth attempt
      expect(summary2.parked).toBe(1);
    });
```

Hmm wait: at t1 = t0 + 31min: window = buildScheduledWindow(t1): t1 = 2025-01-20 10:31 → days {01-19, 01-20} ✓ includes effectiveDate 01-19. lastAttemptAt = t0 (set by the claim in run 1) → t1 - t0 = 31min ≥ 30min ✓ past lag. attempts = 5 ≥ MAX → parked ✓. But wait — does run 2 re-check the statement? bank's statement is empty for 01-19 ✓ (no statementFor) → absent → parked. ✓.

Hmm, `summary2.stillAwaiting` too? Only parked is asserted. Fine.

  describe('executePayments — the four outcomes', () => {
    it('routes each bank.send outcome to its own state and derives the same txid for all', async () => {
      const now = new Date(Date.UTC(2025, 0, 20, 9, 0, 0));
      const effectiveDate = DAY('2025-01-20');
      const ids = ['ord-a', 'ord-b', 'ord-c', 'ord-d', 'ord-e'];
      const store = new FakeOrderStore();
      for (const id of ids) {
        store.put(order({ id, effectiveDate, status: 'PENDING', attemptCount: 0 }));
      }
      const bank = new FakeBank()
        .queueSend({ statusCode: 202, reason: '' })                  // accepted
        .queueSend({ statusCode: 409, reason: 'txid already known' }) // duplicate
        .queueSend({ statusCode: 503, reason: 'bank overloaded' })    // transient
        .queueSend(new Error('socket hang up'))                      // no answer at all
        .queueSend({ statusCode: 422, reason: 'blocked account' });   // permanent
      const service = new PayoutService(store, bank);

      const summary = await service.executePayments(now);

      expect(summary).toEqual({ accepted: 1, duplicate: 1, transient: 2, permanent: 1 });

      const byId = (id: string) => store.get(id);
      expect(byId('ord-a').status).toBe('SENT');
      expect(byId('ord-b').status).toBe('SENT'); // a duplicate is a success
      expect(byId('ord-c').status).toBe('OUTCOME_UNKNOWN');
      expect(byId('ord-d').status).toBe('OUTCOME_UNKNOWN');
      expect(byId('ord-e').status).toBe('REJECTED');
      expect(byId('ord-e').rejectionReason).toBe('blocked account');
      for (const id of ids) {
        const row = byId(id);
        expect(row.txid).toBe(deriveTxid(id, effectiveDate));
        expect(row.attemptCount).toBe(1);
        expect(row.lastAttemptAt).toEqual(now);
      }
      expect(bank.sent.map((s) => s.txid)).toEqual(ids.map((id) => deriveTxid(id, effectiveDate)));
    });
  });
```

Wait — the order of bank.sent: findPending returns in insertion order (Map) ✓ a,b,c,d,e.

Also, the `duplicate` outcome for the first send — can that happen? I noted earlier that it's odd but harmless. In the test, it's fine (we're exercising the classification routing).

  describe('txid derivation', () => {
    it('is deterministic per order and effective date, and changes with either', () => {
      const d1 = DAY('2025-01-15');
      expect(deriveTxid('ord-9', d1)).toBe(deriveTxid('ord-9', new Date(d1.getTime())));
      expect(deriveTxid('ord-9', d1)).not.toBe(deriveTxid('ord-9', DAY('2025-01-16')));
      expect(deriveTxid('ord-9', d1)).not.toBe(deriveTxid('ord-10', d1));
      expect(deriveTxid('ord-9', d1)).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('classification and window helpers', () => {
    it('classifies the four outcomes from the raw response', () => {
      expect(classifySend({ statusCode: 201, reason: '' })).toBe('accepted');
      expect(classifySend({ statusCode: 409, reason: '' })).toBe('duplicate');
      expect(classifySend({ statusCode: 500, reason: '' })).toBe('transient');
      expect(classifySend({ statusCode: 408, reason: '' })).toBe('transient');
      expect(classifySend({ statusCode: 429, reason: '' })).toBe('transient');
      expect(classifySend({ statusCode: 0, reason: 'timeout' })).toBe('transient');
      expect(classifySend({ statusCode: 400, reason: 'malformed' })).toBe('permanent');
      expect(classifySend({ statusCode: 403, reason: 'blocked account' })).toBe('permanent');
    });

    it('treats an order as past the lag exactly when the lag has elapsed since its last attempt', () => {
      const t = new Date(Date.UTC(2025, 0, 20, 10, 0, 0));
      expect(isPastPublishingLag(new Date(t.getTime() - PUBLISHING_LAG_MS), t)).toBe(true);
      expect(isPastPublishingLag(new Date(t.getTime() - PUBLISHING_LAG_MS + 1_000), t)).toBe(false);
      expect(isPastPublishingLag(null, t)).toBe(true);
    });

    it('maps the scheduled window onto yesterday and today (UTC)', () => {
      const now = new Date(Date.UTC(2025, 0, 20, 0, 15, 0));
      const window = buildScheduledWindow(now);
      expect(window.from).toEqual(new Date(Date.UTC(2025, 0, 19, 0, 0, 0)));
      expect(window.to).toEqual(new Date(Date.UTC(2025, 0, 21, 0, 0, 0)));
    });
  });
});
```

`isPastPublishingLag(null, t)`: base=0 → t - 0 ≥ lag → true. Hmm — is that the desired semantics? A null lastAttemptAt shouldn't happen for a candidate; true is fine.

Now — one more acceptance nuance to double-check: "reconcile run twice over the same window → identical state after both." My idempotency test: run 1 changes state (a resend), run 2 doesn't. "Identical state after both" — state after run2 == state after run1 ✓ asserted by toEqual(afterFirst).

Now, the fake store's `get` uses `expect(row).toBeDefined()` — a vitest expect inside the fake; fine.

Potential TS strictness issues in the test:
- `AWAITING.includes(row.status)` with AWAITING: PayoutOrderRow['status'][] ✓.
- FakeOrderStore implements PayoutOrderStore — the method signatures must match exactly (the data parameter types SendRecord/ResendRecord). Use the imported types ✓.
- `class FakeBank implements BankClient` ✓.

Another strictness: in `order()`, the spread `...overrides` — the result must be PayoutOrderRow ✓ (the overrides is Partial & Pick<'id'>).

`store.get('ord-1')` returns a clone (a spread) — the settledAt comparison is fine.

Now the `payout.processor.ts` — import path `'./payout.service.js'` ✓.

Let me reconsider the `take: 100` in `findPending` — an arbitrary batch limit; fine with a comment.

Now, double-check the Prisma schema ↔ migration consistency:
- Columns: id TEXT, supplier_id TEXT, key TEXT, amount_minor INTEGER, currency TEXT DEFAULT 'EUR', effective_date TIMESTAMPTZ, status PayoutStatus DEFAULT 'PENDING', txid TEXT NULL, attempt_count INTEGER DEFAULT 0, last_attempt_at TIMESTAMPTZ NULL, rejection_reason TEXT NULL, settled_at TIMESTAMPTZ NULL, parked_at TIMESTAMPTZ NULL, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ.
- Prisma's DateTime default now() → the migration `DEFAULT now()` ✓ (Prisma emits `now()` for postgres).
- @updatedAt → `TIMESTAMPTZ NOT NULL` (no default) ✓.
- Indexes: (status, effective_date), (txid) ✓.

The migration SQL (Prisma style):

```sql
-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'SENT', 'OUTCOME_UNKNOWN', 'SETTLED', 'REJECTED', 'PARKED');

-- CreateTable
CREATE TABLE "payout_orders" (
    "id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "effective_date" TIMESTAMPTZ NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "txid" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMPTZ,
    "rejection_reason" TEXT,
    "settled_at" TIMESTAMPTZ,
    "parked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payout_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payout_orders_status_effective_date_idx" ON "payout_orders"("status", "effective_date");
CREATE INDEX "payout_orders_txid_idx" ON "payout_orders"("txid");
```

✓.

migration_lock.toml:
```
# Please do not edit this file manually
# It should be added in your version-control system (e.g., git)
provider = "postgresql"
```

package.json — final version:

```json
{
  "name": "supplier-payouts",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Instant-payment payouts with statement-driven reconciliation and gated re-sends",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "start:dev": "tsx watch src/main.ts",
    "test": "vitest run",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate deploy",
    "postinstall": "prisma generate"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.0",
    "@nestjs/core": "^10.4.0",
    "@nestjs/platform-express": "^10.4.0",
    "@nestjs/schedule": "^4.1.1",
    "@prisma/client": "^5.19.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@types/node": "^20.16.0",
    "prisma": "^5.19.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

Do we need @nestjs/platform-express? NestFactory.create's default is express ✓ include it.

tsconfig — `rootDir: "src"`, `include: ["src"]`. dist/main.js ✓.

Hmm — the tests import `../src/...` — outside rootDir? rootDir only applies to files compiled (include src) ✓ the tests aren't compiled by tsc; vitest handles them.

Now — is `emitDecoratorMetadata` + NodeNext OK? Yes.

`strict: true` ✓. `noUncheckedIndexedAccess` too? Not required; skip (it would complicate the maps).

Let me mentally re-verify the strict-mode compilation of the service:
- `summary[outcome] += 1` — outcome: SendOutcome; the summary's keys match ✓.
- statusFor's switch — all cases return; no fall-through → TS is happy (exhaustive switch on a union, each case returns) — the function has no final return → does TS flag "not all code paths return a value"? With strictNullChecks and an exhaustive switch over a union where every case returns — TS narrows to never after the switch, so no error... actually, TS only requires a trailing return if a path can fall through; an exhaustive switch on a union where all cases return → the tail is unreachable → no error (control-flow analysis understands it). ✓.
- `daysInWindow` — arithmetic is fine.
- `classifySend` — the final return 'permanent' ✓.

The repository's strictness:
- `STATUS_FROM_PRISMA[order.status]` ✓ Record lookup.
- `private readonly prisma = new PrismaClient();` — a class field with a decorator on the class (not a property) — with useDefineForClassFields: false + emitDecoratorMetadata, field initializers are fine ✓.
- `updateMany`'s data: `status: STATUS_TO_PRISMA[data.status]` ✓; `attemptCount: { increment: 1 }` ✓.
- `where: { id, status: { in: AWAITING_EVIDENCE }, attemptCount: expectedAttemptCount }` ✓.

Bank client:
- `AbortSignal.timeout` — a type in the Node 20 lib? `lib: ["ES2022"]` + @types/node → AbortSignal.timeout is declared in @types/node (undici) ✓ (Node ≥17.3; does @types/node 20 include timeout? Yes).
- `fetch` global — @types/node 20 declares the global fetch (undici-types) ✓. Actually — is `fetch` in the TS types with only lib ES2022 + @types/node? @types/node declares `var fetch: typeof globalThis extends { fetch: infer T } ? T : ...`? Modern @types/node (≥18) includes the global fetch types ✓.
- `response.json()` returns any → `as Settlement[]` ✓.
- The constructor reads process.env ✓ @types/node.

The processor:
- The CronExpression import ✓.

The tests:
- `new Date(`${isoDate}T00:00:00Z`)` ✓.
- The FakeBank's queued shift ✓.
- `expect(bank.sent).toEqual([{ txid, amount: AMOUNT, key: KEY }])` — the order of the sent object: the fake pushes `{...request}` — request = { txid, amount, key } (service sends `{ txid, amount: order.amountMinor, key: order.key }`) — toEqual is deep, key order irrelevant ✓.
- The `store.get` clones — `expect(store.get('ord-4')).toEqual(afterFirst)` ✓.

One concern: `class FakeOrderStore implements PayoutOrderStore` — PayoutOrderStore is an abstract class imported type-only. Its methods return `Promise<...>`; the fake's methods are async ✓. The abstract class's parameter types: `recordSendOutcome(id: string, data: SendRecord)` — the fake must accept SendRecord — use `data: SendRecord` in the fake ✓ (import type { SendRecord, ResendRecord }).

Also — the `PayoutOrderStore` import in the test is type-only, but the `implements` clause needs the class symbol in a type position — `import type` works with implements (TS allows it; the clause is erased). ✓ (I'm fairly confident: type-only imports can be used in implements/extends? For `extends` (a value position) — no; for `implements` (a type position) — yes.)

The service's imports from the repository: `import type { PayoutOrderRow, PayoutOrderStore, PayoutStatusValue } from './payout.repository.js';` — all used only as types ✓ (PayoutOrderRow is used in... hmm, does the service reference PayoutOrderRow? It iterates `candidates` — the type is inferred from the store method's return; no explicit annotation needed. Drop PayoutOrderRow from the service's imports if unused. In the service: the types used: PayoutOrderStore (constructor), PayoutStatusValue (the return of statusFor). PayoutOrderRow — not referenced → don't import (strict noUnusedLocals? I didn't enable noUnusedLocals; still, keep it clean).

The dates import in the service: `DAY_MS, startOfUtcDay, toUtcYmd` — toUtcYmd is used in deriveTxid ✓.

Now — a subtle Nest DI point: the PayoutService's constructor parameters are typed with the abstract classes `PayoutOrderStore` and `BankClient` — Nest uses the design:paramtypes metadata (emitDecoratorMetadata) → the token = the abstract class ✓ resolvable via the module's `{ provide: PayoutOrderStore, useExisting: PayoutRepository }` ✓.

The BankClient token is exported by BankModule, imported by PayoutModule ✓.

Now — do the tests instantiate `new PayoutService(store, bank)` directly (bypassing DI) — fine.

Let me also reconsider whether `executePayments` should take `now` — the task signature is `executePayments()`. The optional parameter preserves that. ✓.

Another spec item: "the send path may record that it doesn't know the outcome; it must not act on it." — executePayments records OUTCOME_UNKNOWN and takes no further action (no retry loop) ✓. And it never resends: it only processes PENDING/attempt 0 ✓.

"The resend is currently driven by the send's own error path" (the bug) — in our design, a transient on the first send just records unknown; no immediate retry ✓.

Now the file ordering in the reply: the parser reads the headings; the order is probably free. Let me organize logically: package.json, tsconfig, prisma (schema, lock, migration), src (main, app.module, dates, bank/*, payout/*), test.

Let me double-check the convention "TS file: kebab-case.role.ts": payout.repository.ts ✓, payout.service.ts ✓, payout.processor.ts ✓, payout.module.ts ✓, bank-client.ts / bank-http-client.ts / bank.module.ts — "bank-client.ts" has no role suffix... the layout lists specific roles (module/controller/service/repository); a client is an extra role; "bank-client" reads as <name>-<role> ✓ fine. dates.ts is a utility, not a feature role — a top-level src/dates.ts ✓ fine.

"Endpoints kebab-case plural" — N/A.

Now, are there any hidden requirements I'm missing? Let me re-read the variant + spec once more...

Variant: "1. executePayments() — sends pending orders via bank.send({txid, amount, key}). The txid must be derived deterministically from the order + effective date." ✓.

"2. reconcile(window) — matches statement entries to orders and advances their state. Must be safe to run every 15 minutes, including overlapping windows." ✓.

"3. Resend logic: ... only re-sent after reconciliation proves it absent from the statement past the publishing lag. Cap attempts at 5; after that, park for manual review, never auto-revert." ✓.

"4. Classify bank.send responses (accepted, duplicate, transient error, permanent rejection) and handle each differently." ✓ — accepted→SENT, duplicate→SENT (success), transient→OUTCOME_UNKNOWN, permanent→REJECTED (+reason). "Handle each differently" — accepted and duplicate both → SENT... is that "different"? The handling is different: a duplicate means the bank already has it (we don't count it as a new in-flight acceptance... hmm). Let me think — do accepted and duplicate need distinct stored states? Both mean "the bank holds this txid; wait for the statement." Functionally identical. The classification is distinct (the summary counts them separately); the handling is intentionally convergent (both = the bank holds the instruction). I'd argue that's correct: a duplicate is a success that is equivalent to an acceptance. The spec's incident: "duplicate — the bank already has this txid; this is a success, not an error." So the handling: treat as success → awaiting settlement. ✓. In the executePayments summary, we count them separately ✓.

Hmm — but wait, in the resend path, `resent` counts both accepted and duplicate (both = the resend reached the bank / was acknowledged). ✓.

"L2 acceptance: each of the 4 send outcomes takes a distinct path" — the test asserts distinct statuses for transient vs permanent; accepted vs duplicate both SENT but separately counted in the summary — the test asserts summary {accepted:1, duplicate:1,...} and both SENT. Is that "distinct paths"? The path differs in the classification/summary; the resulting state is intentionally the same (the bank has it). I think that's defensible — the alternative (a DUPLICATE state) adds a state with identical semantics. Hmm... let me reconsider. Would a grader want a separate status for duplicate? "This is a success, not an error" → a success → the order is in flight → SENT. Let's go with SENT, and let the comment explain.

"Amount is minor units, integers only." ✓ Int / number-integer, no floats anywhere.

"Deliverables: Prisma schema · services with executePayments() and reconcile(window) · the scheduled reconcile job · tests for timeout-but-settled, proven-absent, and attempt exhaustion." ✓ all present.

"Assume nothing about the bank API beyond bank.send({txid, amount, key}) and getStatement(date) -> Settlement[]." — my HTTP implementation assumes endpoints/auth → marked with an ASSUMPTION comment ✓ (the port itself only assumes the two operations ✓).

Now — one more thought on `getStatement(date)` — the date parameter: my daysInWindow produces UTC midnights; the HTTP client formats as YYYY-MM-DD (UTC) ✓.

Potential edge: `buildScheduledWindow` at exactly midnight 00:00: today = now; from = yesterday 00:00, to = tomorrow 00:00 ✓.

Edge: `daysInWindow` when from is a midnight exactly: startOfUtcDay(from) = from ✓; to is a midnight exactly (tomorrow 00:00): `new Date(to - 1)` = yesterday 23:59:59.999 → last = yesterday midnight... wait: to = tomorrow 00:00 → to-1ms = today 23:59:59.999 → startOfUtcDay = today midnight ✓. So days = {yesterday, today} ✓ (from = yesterday 00:00 → first = yesterday). ✓.

If to <= from → [] → the service returns an empty summary (no bank calls) ✓.

Now — a potential issue: the `reconcile` summary for a settled order via markSettled returning false (a concurrent settle): don't count — fine.

I think the design is solid. Let me also add a header comment to the service file explaining the core invariants (the incident's lessons). Keep the comments professional and concise.

One more: the `PayoutOrderStore` in the repository file is an abstract class — Nest doesn't instantiate it (it's just a token) ✓.

And the module's `{ provide: PayoutOrderStore, useExisting: PayoutRepository }` — PayoutRepository is in the same module's providers ✓.

Should PayoutRepository be exported? Only within the module (the service in the same module uses the token) → no need to export ✓.

Now — a sanity check on `@nestjs/schedule` v4 API: `ScheduleModule.forRoot()` ✓, `@Cron(CronExpression.EVERY_15_MINUTES)` ✓, `CronExpression.EVERY_15_MINUTES = '*/15 * * * *'` ✓.

Vitest 2: `import { describe, expect, it } from 'vitest'` ✓.

Let me also make sure there are no unused imports in each file (strict cleanliness):

- main.ts: NestFactory, AppModule ✓.
- app.module.ts: Module, ScheduleModule, PayoutModule ✓.
- dates.ts: none.
- bank-client.ts: none.
- bank-http-client.ts: Injectable, toUtcYmd, BankClient (extends — a value import! `class BankHttpClient extends BankClient` needs BankClient as a value ✓ a regular import), BankSendRequest/BankSendResponse/Settlement (types) — a mixed import: `import { BankClient } from './bank-client.js'; import type { BankSendRequest, BankSendResponse, Settlement } from './bank-client.js';` ✓.
- bank.module.ts: Module, BankClient (value — as a token ✓), BankHttpClient ✓.
- payout.repository.ts: Injectable, OnModuleDestroy, PayoutStatus, PrismaClient (values), PayoutOrder (type) ✓.
- payout.service.ts: createHash, Injectable, DAY_MS, startOfUtcDay, toUtcYmd (values); type imports ✓.
- payout.processor.ts: Cron, CronExpression, Injectable, buildScheduledWindow, PayoutService (values) ✓.
- payout.module.ts: Module, BankModule, PayoutOrderStore (value — a token), PayoutRepository, PayoutService, PayoutProcessor ✓.
- test: as listed.

Wait — the processor: `import { PayoutService } from './payout.service.js';` is used only as a type in the constructor... constructor parameter property `private readonly payouts: PayoutService` — a type-only use! With emitDecoratorMetadata, the design:paramtypes metadata references it at runtime — but the import is still elided by TS (type-only elision) — is that a problem for the metadata? The metadata references the class object — elided imports break design:paramtypes?! Actually: with emitDecoratorMetadata, if a class is used only in a type position, TS still emits the import in the JS (because the decorator metadata needs it) — TS retains imports that are referenced from emitted decorator metadata. Yes — TS handles it: parameter properties with decorators cause the import to be retained. To be safe/explicit, it's fine as is (a common Nest pattern).

The same pattern in PayoutService's constructor (PayoutOrderStore, BankClient as parameter property types) — the imports from the repository/bank-client are `import type` → elided! Does design:paramtypes need the class objects?? Hmm! If `import type` elides the import, the emitted JS's decorator metadata would reference undefined classes → DI breaks at runtime (Nest can't resolve the token).

Wait — does emitDecoratorMetadata emit `design:paramtypes` referencing the classes? Yes: `__metadata("design:paramtypes", [PayoutOrderStore, BankClient])`. If the import is type-only (elided), the emitted code would reference undeclared identifiers → runtime ReferenceError / Nest DI failure!!

Hold on — is that right? Let me think. TS's `import type` is always elided. The decorator metadata emission uses type information, but it only emits a reference if the import is retained... actually, I recall TS emits the metadata reference and relies on the import being present; with `import type`, there's a known pitfall where the decorator metadata breaks under `isolatedModules`? Hmm. Let me recall specifically: with `emitDecoratorMetadata: true`, a constructor parameter of a type imported via `import type` — the emitted `design:paramtypes` contains the class name; the import is elided → `ReferenceError` at module load (class definition execution) → the app crashes.

Hmm, is that really true? I think TS actually retains the reference and it fails. There's a GitHub issue about this (microsoft/TypeScript#46333?) — "import type breaks emitDecoratorMetadata." Yes, I'm fairly confident this is a real pitfall. The workaround: use a regular import (which is elided only if unused at value positions — but the design:paramtypes emission counts as a use? TS's import elision: an import is retained if it's referenced from emitted code — the decorator metadata emission counts as a use, so TS retains the import even if it's only "used" in type positions... in that case, is `import type` also retained? No — `import type` is unconditionally elided; that's the bug.)

To be safe: use a regular (non-type) import in the service for PayoutOrderStore and BankClient. A regular import of a class used in type positions: TS normally elides it (unused at value positions)... but with emitDecoratorMetadata, the metadata emission makes it "used" → retained. I think that's the correct behavior (that's how NestJS works with class-type dependencies — a regular import). ✓ So: in payout.service.ts, use a regular import for PayoutOrderStore (from the repository) and BankClient (from bank-client); the other purely-type imports (BankSendRequest, BankSendResponse, PayoutStatusValue, PayoutOrderRow) can be `import type`.

Similarly the processor: a regular import for PayoutService ✓ (already planned).
The module: a regular import for the tokens (used as values in provide) ✓.
BankHttpClient: a regular import for BankClient (extends) ✓.

And in the test: no decorator metadata concern (no @Injectable on the fakes); type-only imports are fine. But the `implements` clause — fine with type-only.

Also, the service's `@Injectable()` — a regular import of Injectable ✓.

Now, another runtime consideration: `new PrismaClient()` in the repository at module load (when Nest instantiates the provider) — no DB connection until the first query ✓; in tests, the repository is never instantiated (only the fakes) ✓; the service's import chain: the service file imports the repository file (a regular import for PayoutOrderStore) → the repository module imports @prisma/client at the top → in the test, importing the service pulls in the repository module → pulls in the @prisma/client module → without a generated client, it throws at import time!!

Wait — is that really true? `@prisma/client`'s index.js: without a generated client, it does `throw new Error('@prisma/client did not initialize yet. Please run "prisma generate"')` — at require time? The default @prisma/client package ships a `default` index that tries to load the generated client, and if absent, throws at import. Yes — a common CI pain.

Mitigation: (1) postinstall `prisma generate` (pnpm runs it on install) → in a properly installed repo, the client is generated → the import is fine. (2) In addition, a `pretest` script: `"pretest": "prisma generate"`? That guarantees the tests can run. But prisma generate needs the schema ✓ present. It's fast and offline (the engine is already downloaded? prisma generate needs the query engine binary — downloaded on prisma package install... the prisma CLI downloads engines on install via postinstall; if the network is blocked in CI, it might fail — but pnpm install needs network anyway).

Hmm, or restructure so the service doesn't import the repository at all at runtime: put the `PayoutOrderStore` abstract class + row types in a separate file, say `payout.store.ts`?? That deviates from the "repository file" layout... the convention layout names the file `payout.repository.ts` as the repository. Splitting the contract into its own file is a common pattern, but the convention says the layout has the repository file — it doesn't forbid additional files, but it says "don't create files that aren't asked for."

Alternative: keep the single repository file and rely on postinstall/pretest for generation. That's the standard Prisma workflow — defensible. Let me add both `"postinstall": "prisma generate"` and `"pretest": "prisma generate"`? pretest makes `pnpm test` self-sufficient. Hmm, `prisma generate` without a DB is fine ✓. Let me include a pretest. Actually — wait, does the test even need to import the repository module? The service's regular import of PayoutOrderStore (for the decorator metadata) forces it. So, yes, pretest. OK.

Hmm, actually, let me reconsider: is it really true that @prisma/client throws at import without a generate? The default entry of @prisma/client v5: `node_modules/.prisma/client` (generated) — the @prisma/client/index.js re-exports `./default`, which does:
```js
const { PrismaClient } = require('.prisma/client')
```
and `.prisma/client/index.js` (the default stub when not generated) contains a throwing message. Yes — it throws at require time. So pretest/postinstall is needed. ✓ Include both.

Also — the `PayoutOrder` type import in the repository (type-only) is fine.

Now — vitest and the repository's import chain: the service test imports the service → the repository → @prisma/client (generated via pretest) ✓ works.

But hmm — another wrinkle: `prisma generate` generates into `node_modules/.prisma/client` by default ✓ the import '@prisma/client' resolves ✓.

Now, `tsx watch src/main.ts` for development — tsx handles ESM TS ✓.

Build: `tsc -p tsconfig.json` → dist/ with the same structure; `node dist/main.js` ✓ (NodeNext emits the extensions as written — `.js` ✓).

I think we're ready. Let me also double-check that `useDefineForClassFields: false` is needed: with target ES2022, class fields default to define semantics → Nest's DI works via the constructor return... the issue: with `declare`/param properties + define fields, the design:type metadata is fine; the known issue is that `useDefineForClassFields: true` breaks some Nest patterns (e.g., `@Injectable()` class property injection). For constructor injection, either works, but Nest's docs historically set it to false. Keep it false — safe.

Also add `"declaration": false, "removeComments": false`? Skip.

One more check — `import 'reflect-metadata';` as the first line of main.ts ✓ (ESM hoisting: imports are hoisted and executed in order; reflect-metadata before @nestjs/core ✓).

Now, the final list of assumptions (marked with `// ASSUMPTION`):
1. deriveTxid: the bank accepts 64-hex-digit SHA-256 as a txid (service).
2. classifySend: 409 = duplicate (service).
3. BankHttpClient: endpoint paths + bearer auth (bank-http-client).
4. Settlement exposes at least the txid (bank-client).

Four assumption comments — each "at the important spot" ✓.

Let me reconsider #4: is it an assumption? The spec literally says the statement returns "each has the txid we sent" → txid is given. Defining `Settlement { txid: string }` uses only what's given. Strictly, not an assumption. But the shape (an array of objects with a txid field) vs. e.g., a map — the spec says `Settlement[]` "each has the txid" → the object has a txid property — given. Drop the assumption there, keep the type minimal. OK, three assumptions.

Also the HTTP status mapping (2xx accepted, 4xx permanent) — the 409-duplicate is the one that's truly assumed; the rest are standard HTTP semantics. One assumption comment on the 409 line ✓. And "5xx/408/429 → transient" is standard.

Now, let me write the test file completely and carefully (the largest file). Let me re-verify each test against the fake/store semantics.

Test "settles a timed-out order...": order's status OUTCOME_UNKNOWN, txid T, effectiveDate today (01-20), lastAttempt now-5min. Window days {01-19, 01-20} ✓. Statement 01-20 = [T]. Reconcile: the candidate is found (status UNKNOWN, txid non-null, effectiveDate 01-20 ∈ days) ✓. T is in the settlement set → markSettled: the fake checks AWAITING includes UNKNOWN ✓ → SETTLED, settledAt now ✓. bank.sent [] ✓. summary.settled 1 ✓.

Second run: the candidate query: status SETTLED is not in AWAITING → no candidate → nothing ✓.

Test "re-sends with the same txid": order's effectiveDate 01-19, lastAttempt now-31min, attempts 1, UNKNOWN. Window {01-19, 01-20} ✓. Statement: none → empty. T is not in the set. txid non-null ✓, past lag (31min ≥ 30min ✓). attempts 1 < 5. claimResend(1) → attempts 2, lastAttempt now ✓. send → 503 → transient → recordResendOutcome: AWAITING (UNKNOWN) ✓ → status OUTCOME_UNKNOWN (same), rejectionReason null. bank.sent = [{txid: T, amount: AMOUNT, key: KEY}] ✓. after: attempts 2, status UNKNOWN, lastAttempt now ✓.

Test "does not re-send while lag": lastAttempt now-5min → not past lag → stillAwaiting ✓ no claim, no send ✓. lastAttemptAt unchanged (still now-5min) — assert `not.toEqual(now)` ✓ (better: toEqual(original) — let's store the original: `const lastAttempt = new Date(...)`; assert toEqual(lastAttempt)).

Test idempotency: covered above ✓.

Exhaustion test: attempts 5 → parked ✓. coveringRun: 01-19 03:00 → but wait, the order's lastAttempt = now(01-20 10:00) - 31min = 01-20 09:29. coveringRun = 01-19 03:00 — that's before the lastAttempt?! Time travel in the test — the "run" happens at 01-19 03:00, which is before the order's last attempt (01-20). Weird. Let me reorder: parking happened at `now` = 01-20 10:00. The later run with a window covering 01-19 must be ≥ 01-19 00:00 (to include 01-19 as "yesterday") and < 01-21 (01-19 as yesterday requires the run date to be 01-20; or 01-19 as today, i.e., the run on 01-19). A run at 01-20 11:00 (after parking at 10:00) → window {01-19, 01-20} → covers 01-19 ✓ chronologically valid. Use `const covering = new Date(now.getTime() + 60 * 60_000)` (01-20 11:00) → window {01-19, 01-20} ✓. And a run at muchLater = now+2 days → window {01-21, 01-22} (doesn't cover) — keep both runs? One is enough; let's do the covering run + statement present → still PARKED ✓.

Also, the first re-run (later = now+6h, window {01-19, 01-20}) → PARKED isn't a candidate → unchanged ✓.

Cap test: covered above ✓ — verify run 1's summary: `resent` 0 (transient), `stillAwaiting` 1 ✓, parked 0.

executePayments test: 5 PENDING orders, attempts 0. The bank's queued responses are in order. All recorded (recordSendOutcome from PENDING/0 ✓ sequential). summary ✓. txids derived ✓. The d (Error throw) case → safeSend catches → statusCode 0 → transient ✓.

Hmm — `new Error('socket hang up')` is queued — the fake throws it ✓ the service catches ✓.

Now, the `order()` helper's defaults: status OUTCOME_UNKNOWN, attempts 1, lastAttemptAt null — the PENDING test overrides status/attempts ✓; lastAttemptAt null is fine for PENDING (set on record).

Also note: the `order()` default effectiveDate 01-15 — overridden in each test ✓.

Now — the `AWAITING` in the test: `const AWAITING: PayoutOrderRow['status'][] = ['SENT', 'OUTCOME_UNKNOWN'];` ✓.

The fake's `get`:
```ts
get(id: string): PayoutOrderRow {
  const row = this.rows.get(id);
  if (row === undefined) throw new Error(`no order ${id}`);
  return { ...row };
}
```
(Avoid expect inside the helper for clarity.)

Now, let me also double-check `FakeOrderStore implements PayoutOrderStore` — the abstract class has 7 abstract methods; the fake implements all 7 ✓ plus the extra put/get (fine).

One more: the fake's `recordSendOutcome` — Object.assign(row, data, { attemptCount: 1 }) — data has status/txid/lastAttemptAt/rejectionReason ✓.

Now — the real repository's `findPending` is `take: 100` — the fake ignores take (no signature parameter) — the abstract has no parameter ✓.

Edge — the real repository's `findAwaitingEvidence` with empty `effectiveDates` → Prisma `in: []` returns [] ✓ (the service guards days.length 0 before the call anyway).

Let me also reconsider: should `reconcile` also settle orders in `REJECTED`... no. Terminal.

`SENT` orders (accepted) — candidates ✓ settle on presence; proven absent → resend?? Wait — a SENT order means the bank accepted; if later proven absent from the statement (past lag), we resend. Is that right? An accepted send that never appears → it didn't land (per the premise, absence = proof of non-landing) → a resend is permitted. Yes — the premise covers any awaiting state. ✓.

OK — let me also think about whether `reconcile` should be exposed via a controller for manual triggering... not asked. Skip.

The final reply format: for each file, `### path` + a fenced block. "Nothing outside that pattern is read... keep [prose] to nothing." So the reply = only headings + blocks. No intro.

File order:
1. package.json
2. tsconfig.json
3. prisma/schema.prisma
4. prisma/migrations/migration_lock.toml
5. prisma/migrations/20250101000000_init/migration.sql
6. src/main.ts
7. src/app.module.ts
8. src/dates.ts
9. src/bank/bank-client.ts
10. src/bank/bank-http-client.ts
11. src/bank/bank.module.ts
12. src/payout/payout.repository.ts
13. src/payout/payout.service.ts
14. src/payout/payout.processor.ts
15. src/payout/payout.module.ts
16. test/payout.spec.ts

Let me now write out each file's final content, carefully.

---

**package.json** (as above).

**tsconfig.json**:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "useDefineForClassFields": false,
    "sourceMap": true
  },
  "include": ["src"]
}
```

**prisma/schema.prisma**:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum PayoutStatus {
  PENDING
  SENT
  OUTCOME_UNKNOWN
  SETTLED
  REJECTED
  PARKED
}

/// A payment to a supplier through the bank's instant-payment API.
///
/// `effective_date` is a calendar date stored at UTC midnight; it is part of
/// the deterministic txid derivation. `amount_minor` is an integer amount in
/// the currency's minor units (cents).
model PayoutOrder {
  id              String       @id @default(cuid()) @map("id")
  supplierId      String       @map("supplier_id")
  /// Beneficiary account key submitted to the bank.
  key             String       @map("key")
  amountMinor     Int          @map("amount_minor")
  currency        String       @default("EUR") @map("currency")
  effectiveDate   DateTime     @map("effective_date")
  status          PayoutStatus @default(PENDING) @map("status")
  /// The txid actually submitted to the bank; null before the first send.
  txid            String?      @map("txid")
  attemptCount    Int          @default(0) @map("attempt_count")
  lastAttemptAt   DateTime?    @map("last_attempt_at")
  rejectionReason String?      @map("rejection_reason")
  settledAt       DateTime?    @map("settled_at")
  parkedAt        DateTime?    @map("parked_at")
  createdAt       DateTime     @default(now()) @map("created_at")
  updatedAt       DateTime     @updatedAt @map("updated_at")

  @@index([status, effectiveDate], map: "payout_orders_status_effective_date_idx")
  @@index([txid], map: "payout_orders_txid_idx")
  @@map("payout_orders")
}
```

Prisma schema comments: `///` is a doc comment (valid), `//` is a regular comment (valid) ✓.

**migration_lock.toml**:
```
# Please do not edit this file manually
# It should be added in your version-control system (e.g., git)
provider = "postgresql"
```

**migration.sql**: as drafted.

**src/main.ts**:
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // Ensures onModuleDestroy (Prisma $disconnect) runs on SIGINT/SIGTERM.
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? '3000'));
}

void bootstrap();
```

**src/app.module.ts**:
```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PayoutModule } from './payout/payout.module.js';

@Module({
  imports: [ScheduleModule.forRoot(), PayoutModule],
})
export class AppModule {}
```

**src/dates.ts**:
```ts
export const DAY_MS = 24 * 60 * 60 * 1000;

/** The start of the UTC day containing `date` (UTC midnight). */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** A calendar day as YYYY-MM-DD in UTC. */
export function toUtcYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}
```

**src/bank/bank-client.ts**:
```ts
/**
 * Port for the bank's instant-payment API.
 *
 * Nothing is assumed about the bank beyond the two operations
 * `send({ txid, amount, key })` and `getStatement(date) -> Settlement[]`.
 * The HTTP shape of those operations lives in BankHttpClient.
 */

/** One entry in the bank's daily statement: the txid we submitted. */
export interface Settlement {
  txid: string;
}

export interface BankSendRequest {
  txid: string;
  /** Amount in the currency's minor units, an integer. */
  amount: number;
  /** Beneficiary account key. */
  key: string;
}

/**
 * Normalised transport result of a send. `statusCode` is 0 when no HTTP
 * response was received at all (network failure, timeout): the outcome is
 * unknown, not a rejection.
 */
export interface BankSendResponse {
  statusCode: number;
  reason: string;
}

export abstract class BankClient {
  abstract send(request: BankSendRequest): Promise<BankSendResponse>;
  abstract getStatement(date: Date): Promise<Settlement[]>;
}
```

**src/bank/bank-http-client.ts**:
```ts
import { Injectable } from '@nestjs/common';
import { toUtcYmd } from '../dates.js';
import { BankClient } from './bank-client.js';
import type { BankSendRequest, BankSendResponse, Settlement } from './bank-client.js';

/**
 * HTTP transport for the bank API. Configuration comes from the environment
 * (BANK_BASE_URL, BANK_API_KEY, optional BANK_TIMEOUT_MS); nothing is
 * hardcoded.
 *
 * ASSUMPTION: the bank exposes `POST {BANK_BASE_URL}/instant-payments`
 * (JSON body `{ txid, amount, key }`) and `GET {BANK_BASE_URL}/statements?date=YYYY-MM-DD`
 * (JSON array of statement entries), authenticated with a bearer token.
 */
@Injectable()
export class BankHttpClient extends BankClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor() {
    super();
    this.baseUrl = (process.env.BANK_BASE_URL ?? '').replace(/\/+$/, '');
    this.apiKey = process.env.BANK_API_KEY ?? '';
    this.timeoutMs = Number(process.env.BANK_TIMEOUT_MS ?? '10000');
  }

  async send(request: BankSendRequest): Promise<BankSendResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/instant-payments`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ txid: request.txid, amount: request.amount, key: request.key }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return { statusCode: response.status, reason: (await response.text()).trim() };
    } catch (error) {
      // No answer from the bank at all (DNS, socket, timeout): the outcome is unknown.
      return { statusCode: 0, reason: describe(error) };
    }
  }

  async getStatement(date: Date): Promise<Settlement[]> {
    const ymd = toUtcYmd(date);
    const response = await fetch(`${this.baseUrl}/statements?date=${ymd}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      // Reconciliation must never act on evidence it could not fetch.
      throw new Error(`bank statement for ${ymd} unavailable: HTTP ${response.status}`);
    }
    return (await response.json()) as Settlement[];
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${this.apiKey}`,
    };
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

**src/bank/bank.module.ts**:
```ts
import { Module } from '@nestjs/common';
import { BankClient } from './bank-client.js';
import { BankHttpClient } from './bank-http-client.js';

@Module({
  providers: [BankHttpClient, { provide: BankClient, useExisting: BankHttpClient }],
  exports: [BankClient],
})
export class BankModule {}
```

**src/payout/payout.repository.ts**: (as drafted above, with the SendRecord/ResendRecord types)

Let me finalize it:

```ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PayoutStatus, PrismaClient } from '@prisma/client';
import type { PayoutOrder } from '@prisma/client';

/**
 * The lifecycle of a payout order. PENDING/SENT/OUTCOME_UNKNOWN are the only
 * states the system moves on its own; SETTLED/REJECTED/PARKED are terminal
 * and reviewed by a human.
 */
export type PayoutStatusValue =
  | 'PENDING'
  | 'SENT'
  | 'OUTCOME_UNKNOWN'
  | 'SETTLED'
  | 'REJECTED'
  | 'PARKED';

export interface PayoutOrderRow {
  id: string;
  supplierId: string;
  key: string;
  /** Integer amount in the currency's minor units. */
  amountMinor: number;
  currency: string;
  /** Calendar date stored at UTC midnight. */
  effectiveDate: Date;
  status: PayoutStatusValue;
  /** The txid actually submitted to the bank; null before the first send. */
  txid: string | null;
  attemptCount: number;
  lastAttemptAt: Date | null;
  rejectionReason: string | null;
  settledAt: Date | null;
  parkedAt: Date | null;
}

export interface SendRecord {
  status: PayoutStatusValue;
  txid: string;
  lastAttemptAt: Date;
  rejectionReason: string | null;
}

export interface ResendRecord {
  status: PayoutStatusValue;
  rejectionReason: string | null;
}

/**
 * Persistence contract for payout orders.
 *
 * Every mutation is a conditional (compare-and-set) update: it only applies
 * if the row is still in the expected state, so two overlapping runs can
 * never double-send, double-settle or overwrite a state a later run already
 * took. The boolean result tells the caller whether it won the race.
 */
export abstract class PayoutOrderStore {
  /** Orders that were never sent. */
  abstract findPending(): Promise<PayoutOrderRow[]>;
  /** Orders still awaiting statement evidence for the given UTC days. */
  abstract findAwaitingEvidence(effectiveDates: Date[]): Promise<PayoutOrderRow[]>;
  /** Record the first send. Only applies from PENDING with zero attempts. */
  abstract recordSendOutcome(id: string, data: SendRecord): Promise<boolean>;
  /**
   * Claim the right to perform the next resend. Atomic: at most one of
   * concurrent claimers with the same expected count succeeds.
   */
  abstract claimResend(id: string, expectedAttemptCount: number, now: Date): Promise<boolean>;
  /** Record a resend's outcome. Skipped if the order left the awaiting states. */
  abstract recordResendOutcome(id: string, data: ResendRecord): Promise<boolean>;
  /** Match to a statement entry. Skipped if the order left the awaiting states. */
  abstract markSettled(id: string, at: Date): Promise<boolean>;
  /** Park for manual review. Skipped if the order left the awaiting states. */
  abstract markParked(id: string, at: Date): Promise<boolean>;
}

const STATUS_TO_PRISMA: Record<PayoutStatusValue, PayoutStatus> = {
  PENDING: PayoutStatus.PENDING,
  SENT: PayoutStatus.SENT,
  OUTCOME_UNKNOWN: PayoutStatus.OUTCOME_UNKNOWN,
  SETTLED: PayoutStatus.SETTLED,
  REJECTED: PayoutStatus.REJECTED,
  PARKED: PayoutStatus.PARKED,
};

const STATUS_FROM_PRISMA: Record<PayoutStatus, PayoutStatusValue> = {
  [PayoutStatus.PENDING]: 'PENDING',
  [PayoutStatus.SENT]: 'SENT',
  [PayoutStatus.OUTCOME_UNKNOWN]: 'OUTCOME_UNKNOWN',
  [PayoutStatus.SETTLED]: 'SETTLED',
  [PayoutStatus.REJECTED]: 'REJECTED',
  [PayoutStatus.PARKED]: 'PARKED',
};

const AWAITING_EVIDENCE: PayoutStatus[] = [PayoutStatus.SENT, PayoutStatus.OUTCOME_UNKNOWN];

function toRow(order: PayoutOrder): PayoutOrderRow {
  return {
    id: order.id,
    supplierId: order.supplierId,
    key: order.key,
    amountMinor: order.amountMinor,
    currency: order.currency,
    effectiveDate: order.effectiveDate,
    status: STATUS_FROM_PRISMA[order.status],
    txid: order.txid,
    attemptCount: order.attemptCount,
    lastAttemptAt: order.lastAttemptAt,
    rejectionReason: order.rejectionReason,
    settledAt: order.settledAt,
    parkedAt: order.parkedAt,
  };
}

/** The only layer that touches the database. */
@Injectable()
export class PayoutRepository extends PayoutOrderStore implements OnModuleDestroy {
  private readonly prisma = new PrismaClient();

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async findPending(): Promise<PayoutOrderRow[]> {
    const orders = await this.prisma.payoutOrder.findMany({
      where: { status: PayoutStatus.PENDING, attemptCount: 0 },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    return orders.map(toRow);
  }

  async findAwaitingEvidence(effectiveDates: Date[]): Promise<PayoutOrderRow[]> {
    const orders = await this.prisma.payoutOrder.findMany({
      where: {
        status: { in: AWAITING_EVIDENCE },
        txid: { not: null },
        effectiveDate: { in: effectiveDates },
      },
    });
    return orders.map(toRow);
  }

  async recordSendOutcome(id: string, data: SendRecord): Promise<boolean> {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id, status: PayoutStatus.PENDING, attemptCount: 0 },
      data: {
        status: STATUS_TO_PRISMA[data.status],
        txid: data.txid,
        attemptCount: 1,
        lastAttemptAt: data.lastAttemptAt,
        rejectionReason: data.rejectionReason,
      },
    });
    return result.count === 1;
  }

  async claimResend(id: string, expectedAttemptCount: number, now: Date): Promise<boolean> {
    const result = await this.prisma.payoutOrder.updateMany({
      where: {
        id,
        status: { in: AWAITING_EVIDENCE },
        attemptCount: expectedAttemptCount,
      },
      data: { attemptCount: { increment: 1 }, lastAttemptAt: now },
    });
    return result.count === 1;
  }

  async recordResendOutcome(id: string, data: ResendRecord): Promise<boolean> {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id, status: { in: AWAITING_EVIDENCE } },
      data: {
        status: STATUS_TO_PRISMA[data.status],
        rejectionReason: data.rejectionReason,
      },
    });
    return result.count === 1;
  }

  async markSettled(id: string, at: Date): Promise<boolean> {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id, status: { in: AWAITING_EVIDENCE } },
      data: { status: PayoutStatus.SETTLED, settledAt: at },
    });
    return result.count === 1;
  }

  async markParked(id: string, at: Date): Promise<boolean> {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id, status: { in: AWAITING_EVIDENCE } },
      data: { status: PayoutStatus.PARKED, parkedAt: at },
    });
    return result.count === 1;
  }
}
```

Wait — a strict TS check: `STATUS_FROM_PRISMA[order.status]` — order.status is PayoutStatus ✓.

Hmm — `implements OnModuleDestroy` + `extends PayoutOrderStore` — allowed (extends one class + implements interfaces) ✓.

**src/payout/payout.service.ts**: (as drafted; finalize the imports)

```ts
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DAY_MS, startOfUtcDay, toUtcYmd } from '../dates.js';
import { BankClient } from '../bank/bank-client.js';
import type { BankSendRequest, BankSendResponse } from '../bank/bank-client.js';
import { PayoutOrderStore } from './payout.repository.js';
import type { PayoutStatusValue } from './payout.repository.js';
```

(the rest as drafted).

Let me double-check the service's reconcile once more for the "stillAwaiting" double-counting... the claim-failed branch adds stillAwaiting — that order is actually being handled by the other run; counting it as "still awaiting evidence" is accurate.

**src/payout/payout.processor.ts**:
```ts
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { buildScheduledWindow, PayoutService } from './payout.service.js';

/**
 * The scheduled reconcile job: every 15 minutes, reconcile yesterday and
 * today. The window overlaps with the previous run by design; reconcile is
 * idempotent over it, so overlap is safe.
 */
@Injectable()
export class PayoutProcessor {
  constructor(private readonly payouts: PayoutService) {}

  @Cron(CronExpression.EVERY_15_MINUTES)
  async reconcileScheduledWindow(): Promise<void> {
    const now = new Date();
    await this.payouts.reconcile(buildScheduledWindow(now), now);
  }
}
```

**src/payout/payout.module.ts**: (as drafted)

**test/payout.spec.ts**: assemble all the tests. Let me write it in full:

```ts
import { describe, expect, it } from 'vitest';
import { DAY_MS, startOfUtcDay, toUtcYmd } from '../src/dates.js';
import {
  buildScheduledWindow,
  classifySend,
  deriveTxid,
  isPastPublishingLag,
  MAX_ATTEMPTS,
  PUBLISHING_LAG_MS,
  PayoutService,
} from '../src/payout/payout.service.js';
import type { BankClient, BankSendRequest, BankSendResponse, Settlement } from '../src/bank/bank-client.js';
import type { PayoutOrderRow, PayoutOrderStore, ResendRecord, SendRecord } from '../src/payout/payout.repository.js';

const DAY = (isoDate: string): Date => startOfUtcDay(new Date(`${isoDate}T00:00:00Z`));
const MINUTE = 60 * 1000;

const KEY = 'DE89370400440532013000';
const AMOUNT = 1_840_000; // €18,400.00 in minor units

function order(overrides: Partial<PayoutOrderRow> & Pick<PayoutOrderRow, 'id'>): PayoutOrderRow {
  return {
    supplierId: 'sup-1',
    key: KEY,
    amountMinor: AMOUNT,
    currency: 'EUR',
    effectiveDate: DAY('2025-01-15'),
    status: 'OUTCOME_UNKNOWN',
    txid: null,
    attemptCount: 1,
    lastAttemptAt: null,
    rejectionReason: null,
    settledAt: null,
    parkedAt: null,
    ...overrides,
  };
}

const AWAITING: PayoutOrderRow['status'][] = ['SENT', 'OUTCOME_UNKNOWN'];

/**
 * In-memory stand-in for the store contract. It mirrors the real store's
 * conditional-update semantics (transitions only apply from the expected
 * state), which is what the overlap-safety of reconcile relies on.
 */
class FakeOrderStore implements PayoutOrderStore {
  private readonly rows = new Map<string, PayoutOrderRow>();

  put(row: PayoutOrderRow): this {
    this.rows.set(row.id, { ...row });
    return this;
  }

  get(id: string): PayoutOrderRow {
    const row = this.rows.get(id);
    if (row === undefined) throw new Error(`no order with id ${id}`);
    return { ...row };
  }

  async findPending(): Promise<PayoutOrderRow[]> {
    return [...this.rows.values()]
      .filter((row) => row.status === 'PENDING' && row.attemptCount === 0)
      .map((row) => ({ ...row }));
  }

  async findAwaitingEvidence(effectiveDates: Date[]): Promise<PayoutOrderRow[]> {
    const days = new Set(effectiveDates.map((day) => day.getTime()));
    return [...this.rows.values()]
      .filter(
        (row) =>
          AWAITING.includes(row.status) &&
          row.txid !== null &&
          days.has(startOfUtcDay(row.effectiveDate).getTime()),
      )
      .map((row) => ({ ...row }));
  }

  async recordSendOutcome(id: string, data: SendRecord): Promise<boolean> {
    const row = this.rows.get(id);
    if (row === undefined || row.status !== 'PENDING' || row.attemptCount !== 0) return false;
    Object.assign(row, data, { attemptCount: 1 });
    return true;
  }

  async claimResend(id: string, expectedAttemptCount: number, now: Date): Promise<boolean> {
    const row = this.rows.get(id);
    if (row === undefined || !AWAITING.includes(row.status) || row.attemptCount !== expectedAttemptCount) {
      return false;
    }
    row.attemptCount += 1;
    row.lastAttemptAt = now;
    return true;
  }

  async recordResendOutcome(id: string, data: ResendRecord): Promise<boolean> {
    const row = this.rows.get(id);
    if (row === undefined || !AWAITING.includes(row.status)) return false;
    Object.assign(row, data);
    return true;
  }

  async markSettled(id: string, at: Date): Promise<boolean> {
    const row = this.rows.get(id);
    if (row === undefined || !AWAITING.includes(row.status)) return false;
    row.status = 'SETTLED';
    row.settledAt = at;
    return true;
  }

  async markParked(id: string, at: Date): Promise<boolean> {
    const row = this.rows.get(id);
    if (row === undefined || !AWAITING.includes(row.status)) return false;
    row.status = 'PARKED';
    row.parkedAt = at;
    return true;
  }
}

/** Scripted stand-in for the bank. */
class FakeBank implements BankClient {
  sent: BankSendRequest[] = [];
  private readonly queued: (BankSendResponse | Error)[] = [];
  private defaultResponse: BankSendResponse = { statusCode: 202, reason: '' };
  private readonly statements = new Map<string, Settlement[]>();

  queueSend(response: BankSendResponse | Error): this {
    this.queued.push(response);
    return this;
  }

  setSend(response: BankSendResponse | Error): this {
    this.defaultResponse = response;
    return this;
  }

  statementFor(isoDate: string, txids: string[]): this {
    this.statements.set(isoDate, txids.map((txid) => ({ txid })));
    return this;
  }

  async send(request: BankSendRequest): Promise<BankSendResponse> {
    this.sent.push({ ...request });
    const response = this.queued.shift() ?? this.defaultResponse;
    if (response instanceof Error) throw response;
    return response;
  }

  async getStatement(date: Date): Promise<Settlement[]> {
    return this.statements.get(toUtcYmd(date)) ?? [];
  }
}

describe('PayoutService', () => {
  describe('reconcile: a timed-out send that the statement proves landed', () => {
    it('settles the order and never re-sends it', async () => {
      const now = new Date(Date.UTC(2025, 0, 20, 10, 0, 0));
      const effectiveDate = DAY('2025-01-20');
      const txid = deriveTxid('ord-1', effectiveDate);
      const store = new FakeOrderStore().put(
        order({
          id: 'ord-1',
          effectiveDate,
          txid,
          status: 'OUTCOME_UNKNOWN', // the send timed out; the outcome is unknown
          lastAttemptAt: new Date(now.getTime() - 5 * MINUTE), // well inside the publishing lag
        }),
      );
      const bank = new FakeBank().statementFor(toUtcYmd(effectiveDate), [txid]);
      const service = new PayoutService(store, bank);

      const summary = await service.reconcile(buildScheduledWindow(now), now);

      const after = store.get('ord-1');
      expect(after.status).toBe('SETTLED');
      expect(after.settledAt).toEqual(now);
      expect(bank.sent).toEqual([]); // the timeout did not trigger a re-send
      expect(summary).toMatchObject({ settled: 1, resent: 0 });

      // A second run over the same window changes nothing.
      await service.reconcile(buildScheduledWindow(now), now);
      expect(store.get('ord-1').status).toBe('SETTLED');
      expect(bank.sent).toEqual([]);
    });
  });

  describe('reconcile: absence proven past the publishing lag', () => {
    it('re-sends with the same txid and the same amount', async () => {
      const now = new Date(Date.UTC(2025, 0, 20, 10, 0, 0));
      const effectiveDate = DAY('2025-01-19');
      const txid = deriveTxid('ord-2', effectiveDate); // what the first (timed-out) send used
      const store = new FakeOrderStore().put(
        order({
          id: 'ord-2',
          effectiveDate,
          txid,
          status: 'OUTCOME_UNKNOWN',
          lastAttemptAt: new Date(now.getTime() - PUBLISHING_LAG_MS - MINUTE),
        }),
      );
      const bank = new FakeBank().setSend({ statusCode: 503, reason: 'bank unavailable' });
      const service = new PayoutService(store, bank);

      await service.reconcile(buildScheduledWindow(now), now);

      expect(bank.sent).toEqual([{ txid, amount: AMOUNT, key: KEY }]); // same txid, not a new one
      const after = store.get('ord-2');
      expect(after.attemptCount).toBe(2);
      expect(after.status).toBe('OUTCOME_UNKNOWN'); // the re-send timed out again: record and wait
      expect(after.lastAttemptAt).toEqual(now);
    });

    it('does not re-send while the publishing lag has not elapsed', async () => {
      const now = new Date(Date.UTC(2025, 0, 20, 10, 0, 0));
      const effectiveDate = DAY('2025-01-19');
      const txid = deriveTxid('ord-3', effectiveDate);
      const lastAttempt = new Date(now.getTime() - 5 * MINUTE);
      const store = new FakeOrderStore().put(
        order({ id: 'ord-3', effectiveDate, txid, status: 'OUTCOME_UNKNOWN', lastAttemptAt: lastAttempt }),
      );
      const bank = new FakeBank();
      const service = new PayoutService(store, bank);

      const summary = await service.reconcile(buildScheduledWindow(now), now);

      expect(bank.sent).toEqual([]);
      const after = store.get('ord-3');
      expect(after.status).toBe('OUTCOME_UNKNOWN');
      expect(after.attemptCount).toBe(1);
      expect(after.lastAttemptAt).toEqual(lastAttempt);
      expect(summary.stillAwaiting).toBe(1);
    });

    it('is idempotent when run repeatedly over the same window', async () => {
      const now = new Date(Date.UTC(2025, 0, 20, 10, 0, 0));
      const effectiveDate = DAY('2025-01-19');
      const txid = deriveTxid('ord-4', effectiveDate);
      const store = new FakeOrderStore().put(
        order({
          id: 'ord-4',
          effectiveDate,
          txid,
          status: 'OUTCOME_UNKNOWN',
          lastAttemptAt: new Date(now.getTime() - 2 * 60 * MINUTE),
        }),
      );
      const bank = new FakeBank().setSend({ statusCode: 202, reason: '' }); // the re-send is accepted
      const service = new PayoutService(store, bank);
      const window = buildScheduledWindow(now);

      await service.reconcile(window, now);
      const afterFirst = store.get('ord-4');
      expect(afterFirst.status).toBe('SENT');
      expect(afterFirst.attemptCount).toBe(2);
      expect(bank.sent).toHaveLength(1);

      // Same window, same instant: the fresh send is still inside its own lag.
      await service.reconcile(window, now);
      expect(store.get('ord-4')).toEqual(afterFirst);
      expect(bank.sent).toHaveLength(1);

      // The next scheduled run (15 minutes later) is still inside the lag.
      const nextRun = new Date(now.getTime() + 15 * MINUTE);
      await service.reconcile(buildScheduledWindow(nextRun), nextRun);
      expect(store.get('ord-4')).toEqual(afterFirst);
      expect(bank.sent).toHaveLength(1);
    });
  });

  describe('reconcile: attempt exhaustion', () => {
    it('parks the order for review once attempts are exhausted, and never reverts it', async () => {
      const now = new Date(Date.UTC(2025, 0, 20, 10, 0, 0));
      const effectiveDate = DAY('2025-01-19');
      const txid = deriveTxid('ord-5', effectiveDate);
      const store = new FakeOrderStore().put(
        order({
          id: 'ord-5',
          effectiveDate,
          txid,
          status: 'OUTCOME_UNKNOWN',
          attemptCount: MAX_ATTEMPTS,
          lastAttemptAt: new Date(now.getTime() - PUBLISHING_LAG_MS - MINUTE),
        }),
      );
      const bank = new FakeBank();
      const service = new PayoutService(store, bank);

      const summary = await service.reconcile(buildScheduledWindow(now), now);

      const after = store.get('ord-5');
      expect(after.status).toBe('PARKED');
      expect(after.parkedAt).toEqual(now);
      expect(bank.sent).toEqual([]); // no sixth send
      expect(summary.parked).toBe(1);

      // A later overlapping run must not release or revert the parked order.
      const later = new Date(now.getTime() + 60 * MINUTE);
      await service.reconcile(buildScheduledWindow(later), later);
      const afterLater = store.get('ord-5');
      expect(afterLater).toEqual(after);
      expect(bank.sent).toEqual([]);

      // Even fresh statement evidence does not auto-release a parked order:
      // a human makes that call.
      bank.statementFor(toUtcYmd(effectiveDate), [txid]);
      await service.reconcile(buildScheduledWindow(later), later);
      expect(store.get('ord-5').status).toBe('PARKED');
    });

    it('makes the fifth attempt the last, then parks when it too is proven absent', async () => {
      const t0 = new Date(Date.UTC(2025, 0, 20, 10, 0, 0));
      const effectiveDate = DAY('2025-01-19');
      const txid = deriveTxid('ord-6', effectiveDate);
      const store = new FakeOrderStore().put(
        order({
          id: 'ord-6',
          effectiveDate,
          txid,
          status: 'OUTCOME_UNKNOWN',
          attemptCount: MAX_ATTEMPTS - 1, // four attempts so far
          lastAttemptAt: new Date(t0.getTime() - PUBLISHING_LAG_MS - MINUTE),
        }),
      );
      const bank = new FakeBank().setSend({ statusCode: 503, reason: 'still down' });
      const service = new PayoutService(store, bank);

      const first = await service.reconcile(buildScheduledWindow(t0), t0);
      expect(bank.sent).toEqual([{ txid, amount: AMOUNT, key: KEY }]); // the fifth attempt
      expect(store.get('ord-6').attemptCount).toBe(MAX_ATTEMPTS);
      expect(first.resent).toBe(0);
      expect(first.stillAwaiting).toBe(1);

      const t1 = new Date(t0.getTime() + PUBLISHING_LAG_MS + MINUTE);
      const second = await service.reconcile(buildScheduledWindow(t1), t1);
      const after = store.get('ord-6');
      expect(after.status).toBe('PARKED');
      expect(bank.sent).toHaveLength(1); // still only the fifth attempt
      expect(second.parked).toBe(1);
    });
  });

  describe('executePayments: the four send outcomes', () => {
    it('routes each outcome to its own state, deriving the txid for every order', async () => {
      const now = new Date(Date.UTC(2025, 0, 20, 9, 0, 0));
      const effectiveDate = DAY('2025-01-20');
      const ids = ['ord-a', 'ord-b', 'ord-c', 'ord-d', 'ord-e'];
      const store = new FakeOrderStore();
      for (const id of ids) {
        store.put(order({ id, effectiveDate, status: 'PENDING', attemptCount: 0 }));
      }
      const bank = new FakeBank()
        .queueSend({ statusCode: 202, reason: '' }) // accepted: in flight
        .queueSend({ statusCode: 409, reason: 'txid already known' }) // duplicate: success
        .queueSend({ statusCode: 503, reason: 'bank overloaded' }) // transient: unknown
        .queueSend(new Error('socket hang up')) // no answer at all: unknown
        .queueSend({ statusCode: 422, reason: 'blocked account' }); // permanent
      const service = new PayoutService(store, bank);

      const summary = await service.executePayments(now);

      expect(summary).toEqual({ accepted: 1, duplicate: 1, transient: 2, permanent: 1 });

      const byId = (id: string): PayoutOrderRow => store.get(id);
      expect(byId('ord-a').status).toBe('SENT');
      expect(byId('ord-b').status).toBe('SENT'); // a duplicate is a success, not an error
      expect(byId('ord-c').status).toBe('OUTCOME_UNKNOWN');
      expect(byId('ord-d').status).toBe('OUTCOME_UNKNOWN');
      expect(byId('ord-e').status).toBe('REJECTED');
      expect(byId('ord-e').rejectionReason).toBe('blocked account');
      for (const id of ids) {
        const row = byId(id);
        expect(row.txid).toBe(deriveTxid(id, effectiveDate));
        expect(row.attemptCount).toBe(1);
        expect(row.lastAttemptAt).toEqual(now);
      }
      expect(bank.sent.map((request) => request.txid)).toEqual(
        ids.map((id) => deriveTxid(id, effectiveDate)),
      );
    });
  });

  describe('txid derivation', () => {
    it('is deterministic per order and effective date, and changes with either', () => {
      const d1 = DAY('2025-01-15');
      expect(deriveTxid('ord-9', d1)).toBe(deriveTxid('ord-9', new Date(d1.getTime())));
      expect(deriveTxid('ord-9', d1)).not.toBe(deriveTxid('ord-9', DAY('2025-01-16')));
      expect(deriveTxid('ord-9', d1)).not.toBe(deriveTxid('ord-10', d1));
      expect(deriveTxid('ord-9', d1)).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('classification and window helpers', () => {
    it('classifies raw bank responses into the four outcomes', () => {
      expect(classifySend({ statusCode: 201, reason: '' })).toBe('accepted');
      expect(classifySend({ statusCode: 409, reason: '' })).toBe('duplicate');
      expect(classifySend({ statusCode: 500, reason: '' })).toBe('transient');
      expect(classifySend({ statusCode: 408, reason: '' })).toBe('transient');
      expect(classifySend({ statusCode: 429, reason: '' })).toBe('transient');
      expect(classifySend({ statusCode: 0, reason: 'timeout' })).toBe('transient');
      expect(classifySend({ statusCode: 400, reason: 'malformed' })).toBe('permanent');
      expect(classifySend({ statusCode: 403, reason: 'blocked account' })).toBe('permanent');
    });

    it('treats an order as past the lag exactly when the lag has elapsed since its last attempt', () => {
      const t = new Date(Date.UTC(2025, 0, 20, 10, 0, 0));
      expect(isPastPublishingLag(new Date(t.getTime() - PUBLISHING_LAG_MS), t)).toBe(true);
      expect(isPastPublishingLag(new Date(t.getTime() - PUBLISHING_LAG_MS + 1000), t)).toBe(false);
    });

    it('maps the scheduled window onto yesterday and today (UTC)', () => {
      const now = new Date(Date.UTC(2025, 0, 20, 0, 15, 0));
      const window = buildScheduledWindow(now);
      expect(window.from).toEqual(new Date(Date.UTC(2025, 0, 19, 0, 0, 0)));
      expect(window.to).toEqual(new Date(Date.UTC(2025, 0, 21, 0, 0, 0)));
      expect(window.to.getTime() - window.from.getTime()).toBe(2 * DAY_MS);
    });
  });
});
```

Wait — in the exhaustion test, the assertion `afterLater).toEqual(after)`: `after` is a clone at the parking time; the later run doesn't touch it ✓.

Also — a subtlety in the "later" run of the exhaustion test: later = 01-20 11:00 → window {01-19, 01-20} → covers effectiveDate, but the order is PARKED → not a candidate ✓.

And the third run with the statement present: same later window; still PARKED ✓.

Now, `summary` in the first exhaustion run: `{ settled: 0, resent: 0, stillAwaiting: 0, rejected: 0, parked: 1 }` — I assert summary.parked === 1 ✓.

In the cap test's run 1: the order is UNKNOWN attempts 4 → claim → attempts 5 → send 503 → transient → status UNKNOWN, stillAwaiting++ → summary {settled 0, resent 0, stillAwaiting 1, rejected 0, parked 0} ✓ asserted resent 0, stillAwaiting 1 ✓.

Hmm — `first.stillAwaiting` — a property exists ✓.

One more check — the test "does not re-send while lag": summary.stillAwaiting 1 ✓ (the order counted once).

Now — the test's `import { DAY_MS ... }` is used in the window test ✓.

The test file length is fine.

Now, let me verify the service file compiles with the regular import of `PayoutOrderStore` — the service file: `import { PayoutOrderStore } from './payout.repository.js';` and `import type { PayoutStatusValue } from './payout.repository.js';` — two import statements from the same module (one value, one type) — allowed ✓.

And `BankClient` is a regular import (a value — needed for the design:paramtypes retention) ✓; `BankSendRequest, BankSendResponse` are type-only ✓.

Hmm — wait, one more thing about `emitDecoratorMetadata` + `@Injectable()` on PayoutService: the design:paramtypes will contain [PayoutOrderStore, BankClient] — both imported as values ✓ retained.

The PayoutProcessor: `@Injectable()` + a constructor parameter PayoutService (a regular import ✓).

Now — a potential issue: `@Injectable()` on PayoutService with an abstract-class-typed parameter — when Nest creates the provider, it resolves the token PayoutOrderStore from the module (provided via useExisting) ✓; BankClient from the imported BankModule's exports ✓.

Everything checks out. Let me also reconsider the `take: 100` batch: after processing 100 pendings, the rest on the next executePayments call — fine, a comment.

Now, the "amount is integer" check in `bank.send` — the service sends `order.amountMinor` (number) ✓; the schema is Int ✓; the tests use integers ✓. No floats anywhere.

Another consideration — the task's deliverables say "services with executePayments() and reconcile(window)" ✓; "the scheduled reconcile job" ✓ the processor.

I'm fairly confident in the solution. Let me also double-check there's no accidental use of `Date.now()` in the service (tests pass now) — the default parameter `new Date()` is only at call time ✓.

`classifySend` — statusCode 3xx? A redirect — fetch follows redirects automatically; a 3xx response wouldn't normally surface. If it did: not 2xx, not 409, not 408/429/5xx → 'permanent'. Hmm — a 3xx shouldn't be permanent... but fetch auto-follows; the final status is 2xx or an error. Ignore (an edge not worth the code).

Also `response.statusCode === 1xx`? Not possible. OK.

Now, the final formatting concern: the reply must start with the first heading and contain only headings + fenced blocks. The code fences: for ts files, ` ```ts `; prisma ` ```prisma `; sql ` ```sql `; toml ` ```toml `; json ` ```json `.

Let me also reconsider the filename `test/payout.spec.ts` per the convention `test/<feature>.spec.ts` → `test/payout.spec.ts` ✓.

Also — should I include a controller to satisfy the layout? I've decided no; the discipline says not to create what isn't asked. The layout block is a "convention" for existing features; the task's deliverables don't include an API. A grader checking "did they follow the convention" might expect a controller... but the discipline is explicit: "do exactly what the task asks. Do not create files that aren't asked for." The task: schema, services, reconcile job, tests. A controller would be an endpoint for what? Exposing executePayments/reconcile via HTTP would be inventing an API (endpoints, error envelope usage) that the task never mentions. I'll stand firm: no controller.

Hmm — but wait, let me reconsider the error envelope convention once more. "Errors — one envelope" is listed as a convention that "always holds." Without any HTTP endpoint, it doesn't apply. If I added a controller, I'd have to use the envelope. The task's deliverables are unambiguous. No controller. Final decision.

One more: `src/app.module.ts` + `src/main.ts` — "asked for"? They're in the convention layout (the app skeleton), and a NestJS deliverable without an entry point isn't a solution. Include. Final decision.

Let me also sanity-check the `package.json` name: the spec's repo is `supplier-payouts` ✓ use that.

Prisma version and the `prisma-client-js` generator ✓ standard.

I think I'm ready to write the final reply. Let me count the files: 16. Let me write them out.

Actually — one more look at `daysInWindow`'s guard: `spanDays > MAX_RECONCILE_WINDOW_DAYS` — for the scheduled window: span = 2*DAY_MS → spanDays = 3 → ≤ 14 ✓. The error message is fine.

And `reconcile` with days.length 0 → early return — but it doesn't fetch the statements or the candidates ✓.

In the service, `const statements = await Promise.all(days.map((day) => this.bank.getStatement(day)));` — if the bank rejects on one day → the whole reconcile rejects before any mutation ✓ (the candidate fetch is after). Important ordering guarantee — keep the fetch before findAwaitingEvidence ✓ (it is).

Final check on the test idempotency assertion `expect(store.get('ord-4')).toEqual(afterFirst)` — afterFirst includes lastAttemptAt = now; the row is unchanged ✓.

And in that test, after the 3rd run (15min), `bank.sent` is still length 1 ✓.

Also — the 3rd run's window: buildScheduledWindow(nextRun), nextRun = 01-20 10:15 → days {01-19, 01-20} ✓ the order is a candidate (SENT) → not settled (no statement) → past lag? lastAttempt = now(10:00), run at 10:15 → 15min < 30min → stillAwaiting ✓ no claim, no send ✓.

The design is complete and consistent. Let me write it out.

One more micro-decision: in `executePayments`, should the summary count the skipped (raced) initial sends? I chose to count only on successful record. In the tests, all records succeed → the summary is as expected ✓.

Also, the service's `reconcile` — `summary[outcome]`... no, the reconcile summary is manual ✓.

Let me write out the final reply. No prose outside the pattern. The headings exactly as the repository-relative paths.
```

## reply

### package.json
```json
{
  "name": "supplier-payouts",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Instant-payment supplier payouts with statement-driven reconciliation and gated re-sends",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "start:dev": "tsx watch src/main.ts",
    "pretest": "prisma generate",
    "test": "vitest run",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate deploy",
    "postinstall": "prisma generate"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.0",
    "@nestjs/core": "^10.4.0",
    "@nestjs/platform-express": "^10.4.0",
    "@nestjs/schedule": "^4.1.1",
    "@prisma/client": "^5.19.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@types/node": "^20.16.0",
    "prisma": "^5.19.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "useDefineForClassFields": false,
    "sourceMap": true
  },
  "include": ["src"]
}
```

### prisma/schema.prisma
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum PayoutStatus {
  PENDING
  SENT
  OUTCOME_UNKNOWN
  SETTLED
  REJECTED
  PARKED
}

/// A payment to a supplier through the bank's instant-payment API.
///
/// `effective_date` is a calendar date stored at UTC midnight; together with
/// the order id it determines the derived txid. `amount_minor` is an integer
/// amount in the currency's minor units (cents) — no floats anywhere.
model PayoutOrder {
  id              String       @id @default(cuid()) @map("id")
  supplierId      String       @map("supplier_id")
  /// Beneficiary account key submitted to the bank.
  key             String       @map("key")
  amountMinor     Int          @map("amount_minor")
  currency        String       @default("EUR") @map("currency")
  effectiveDate   DateTime     @map("effective_date")
  status          PayoutStatus @default(PENDING) @map("status")
  /// The txid actually submitted to the bank; null before the first send.
  txid            String?      @map("txid")
  attemptCount    Int          @default(0) @map("attempt_count")
  lastAttemptAt   DateTime?    @map("last_attempt_at")
  rejectionReason String?      @map("rejection_reason")
  settledAt       DateTime?    @map("settled_at")
  parkedAt        DateTime?    @map("parked_at")
  createdAt       DateTime     @default(now()) @map("created_at")
  updatedAt       DateTime     @updatedAt @map("updated_at")

  @@index([status, effectiveDate], map: "payout_orders_status_effective_date_idx")
  @@index([txid], map: "payout_orders_txid_idx")
  @@map("payout_orders")
}
```

### prisma/migrations/migration_lock.toml
```toml
# Please do not edit this file manually
# It should be added in your version-control system (e.g., git)
provider = "postgresql"
```

### prisma/migrations/20250101000000_init/migration.sql
```sql
-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'SENT', 'OUTCOME_UNKNOWN', 'SETTLED', 'REJECTED', 'PARKED');

-- CreateTable
CREATE TABLE "payout_orders" (
    "id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "effective_date" TIMESTAMPTZ NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "txid" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMPTZ,
    "rejection_reason" TEXT,
    "settled_at" TIMESTAMPTZ,
    "parked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payout_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payout_orders_status_effective_date_idx" ON "payout_orders"("status", "effective_date");
CREATE INDEX "payout_orders_txid_idx" ON "payout_orders"("txid");
```

### src/main.ts
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // Ensures onModuleDestroy (Prisma $disconnect) runs on SIGINT/SIGTERM.
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? '3000'));
}

void bootstrap();
```

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PayoutModule } from './payout/payout.module.js';

@Module({
  imports: [ScheduleModule.forRoot(), PayoutModule],
})
export class AppModule {}
```

### src/dates.ts
```ts
export const DAY_MS = 24 * 60 * 60 * 1000;

/** The start of the UTC day containing `date` (UTC midnight). */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** A calendar day as YYYY-MM-DD in UTC. */
export function toUtcYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}
```

### src/bank/bank-client.ts
```ts
/**
 * Port for the bank's instant-payment API.
 *
 * Nothing is assumed about the bank beyond the two operations
 * `send({ txid, amount, key })` and `getStatement(date) -> Settlement[]`.
 * The HTTP shape of those operations lives in BankHttpClient.
 */

/** One entry in the bank's daily statement: the txid we submitted. */
export interface Settlement {
  txid: string;
}

export interface BankSendRequest {
  txid: string;
  /** Amount in the currency's minor units, an integer. */
  amount: number;
  /** Beneficiary account key. */
  key: string;
}

/**
 * Normalised transport result of a send. `statusCode` is 0 when no HTTP
 * response was received at all (network failure, timeout): the outcome is
 * unknown, not a rejection.
 */
export interface BankSendResponse {
  statusCode: number;
  reason: string;
}

export abstract class BankClient {
  abstract send(request: BankSendRequest): Promise<BankSendResponse>;
  abstract getStatement(date: Date): Promise<Settlement[]>;
}
```

### src/bank/bank-http-client.ts
```ts
import { Injectable } from '@nestjs/common';
import { toUtcYmd } from '../dates.js';
import { BankClient } from './bank-client.js';
import type { BankSendRequest, BankSendResponse, Settlement } from './bank-client.js';

/**
 * HTTP transport for the bank API. Configuration comes from the environment
 * (BANK_BASE_URL, BANK_API_KEY, optional BANK_TIMEOUT_MS); nothing is
 * hardcoded and no secrets live in the repository.
 *
 * ASSUMPTION: the bank exposes `POST {BANK_BASE_URL}/instant-payments`
 * (JSON body `{ txid, amount, key }`) and `GET {BANK_BASE_URL}/statements?date=YYYY-MM-DD`
 * (JSON array of statement entries), authenticated with a bearer token.
 */
@Injectable()
export class BankHttpClient extends BankClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor() {
    super();
    this.baseUrl = (process.env.BANK_BASE_URL ?? '').replace(/\/+$/, '');
    this.apiKey = process.env.BANK_API_KEY ?? '';
    this.timeoutMs = Number(process.env.BANK_TIMEOUT_MS ?? '10000');
  }

  async send(request: BankSendRequest): Promise<BankSendResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/instant-payments`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ txid: request.txid, amount: request.amount, key: request.key }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return { statusCode: response.status, reason: (await response.text()).trim() };
    } catch (error) {
      // No answer from the bank at all (DNS, socket, timeout): outcome unknown.
      return { statusCode: 0, reason: describe(error) };
    }
  }

  async getStatement(date: Date): Promise<Settlement[]> {
    const ymd = toUtcYmd(date);
    const response = await fetch(`${this.baseUrl}/statements?date=${ymd}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      // Reconciliation must never act on evidence it could not fetch.
      throw new Error(`bank statement for ${ymd} unavailable: HTTP ${response.status}`);
    }
    return (await response.json()) as Settlement[];
  }

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      authorization: `Bearer ${this.apiKey}`,
    };
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

### src/bank/bank.module.ts
```ts
import { Module } from '@nestjs/common';
import { BankClient } from './bank-client.js';
import { BankHttpClient } from './bank-http-client.js';

@Module({
  providers: [BankHttpClient, { provide: BankClient, useExisting: BankHttpClient }],
  exports: [BankClient],
})
export class BankModule {}
```

### src/payout/payout.repository.ts
```ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PayoutStatus, PrismaClient } from '@prisma/client';
import type { PayoutOrder } from '@prisma/client';

/**
 * The lifecycle of a payout order. PENDING/SENT/OUTCOME_UNKNOWN are the only
 * states the system moves on its own; SETTLED/REJECTED/PARKED are terminal
 * and reviewed by a human.
 */
export type PayoutStatusValue =
  | 'PENDING'
  | 'SENT'
  | 'OUTCOME_UNKNOWN'
  | 'SETTLED'
  | 'REJECTED'
  | 'PARKED';

export interface PayoutOrderRow {
  id: string;
  supplierId: string;
  key: string;
  /** Integer amount in the currency's minor units. */
  amountMinor: number;
  currency: string;
  /** Calendar date stored at UTC midnight. */
  effectiveDate: Date;
  status: PayoutStatusValue;
  /** The txid actually submitted to the bank; null before the first send. */
  txid: string | null;
  attemptCount: number;
  lastAttemptAt: Date | null;
  rejectionReason: string | null;
  settledAt: Date | null;
  parkedAt: Date | null;
}

export interface SendRecord {
  status: PayoutStatusValue;
  txid: string;
  lastAttemptAt: Date;
  rejectionReason: string | null;
}

export interface ResendRecord {
  status: PayoutStatusValue;
  rejectionReason: string | null;
}

/**
 * Persistence contract for payout orders.
 *
 * Every mutation is a conditional (compare-and-set) update: it only applies
 * if the row is still in the expected state, so two overlapping runs can
 * never double-send, double-settle or overwrite a state a later run already
 * took. The boolean result tells the caller whether it won the race.
 */
export abstract class PayoutOrderStore {
  /** Orders that were never sent. */
  abstract findPending(): Promise<PayoutOrderRow[]>;
  /** Orders still awaiting statement evidence for the given UTC days. */
  abstract findAwaitingEvidence(effectiveDates: Date[]): Promise<PayoutOrderRow[]>;
  /** Record the first send. Only applies from PENDING with zero attempts. */
  abstract recordSendOutcome(id: string, data: SendRecord): Promise<boolean>;
  /**
   * Claim the right to perform the next resend. Atomic: at most one of
   * concurrent claimers with the same expected count succeeds.
   */
  abstract claimResend(id: string, expectedAttemptCount: number, now: Date): Promise<boolean>;
  /** Record a resend's outcome. Skipped if the order left the awaiting states. */
  abstract recordResendOutcome(id: string, data: ResendRecord): Promise<boolean>;
  /** Match to a statement entry. Skipped if the order left the awaiting states. */
  abstract markSettled(id: string, at: Date): Promise<boolean>;
  /** Park for manual review. Skipped if the order left the awaiting states. */
  abstract markParked(id: string, at: Date): Promise<boolean>;
}

const STATUS_TO_PRISMA: Record<PayoutStatusValue, PayoutStatus> = {
  PENDING: PayoutStatus.PENDING,
  SENT: PayoutStatus.SENT,
  OUTCOME_UNKNOWN: PayoutStatus.OUTCOME_UNKNOWN,
  SETTLED: PayoutStatus.SETTLED,
  REJECTED: PayoutStatus.REJECTED,
  PARKED: PayoutStatus.PARKED,
};

const STATUS_FROM_PRISMA: Record<PayoutStatus, PayoutStatusValue> = {
  [PayoutStatus.PENDING]: 'PENDING',
  [PayoutStatus.SENT]: 'SENT',
  [PayoutStatus.OUTCOME_UNKNOWN]: 'OUTCOME_UNKNOWN',
  [PayoutStatus.SETTLED]: 'SETTLED',
  [PayoutStatus.REJECTED]: 'REJECTED',
  [PayoutStatus.PARKED]: 'PARKED',
};

const AWAITING_EVIDENCE: PayoutStatus[] = [PayoutStatus.SENT, PayoutStatus.OUTCOME_UNKNOWN];

function toRow(order: PayoutOrder): PayoutOrderRow {
  return {
    id: order.id,
    supplierId: order.supplierId,
    key: order.key,
    amountMinor: order.amountMinor,
    currency: order.currency,
    effectiveDate: order.effectiveDate,
    status: STATUS_FROM_PRISMA[order.status],
    txid: order.txid,
    attemptCount: order.attemptCount,
    lastAttemptAt: order.lastAttemptAt,
    rejectionReason: order.rejectionReason,
    settledAt: order.settledAt,
    parkedAt: order.parkedAt,
  };
}

/** The only layer that touches the database. */
@Injectable()
export class PayoutRepository extends PayoutOrderStore implements OnModuleDestroy {
  private readonly prisma = new PrismaClient();

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async findPending(): Promise<PayoutOrderRow[]> {
    const orders = await this.prisma.payoutOrder.findMany({
      where: { status: PayoutStatus.PENDING, attemptCount: 0 },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    return orders.map(toRow);
  }

  async findAwaitingEvidence(effectiveDates: Date[]): Promise<PayoutOrderRow[]> {
    const orders = await this.prisma.payoutOrder.findMany({
      where: {
        status: { in: AWAITING_EVIDENCE },
        txid: { not: null },
        effectiveDate: { in: effectiveDates },
      },
    });
    return orders.map(toRow);
  }

  async recordSendOutcome(id: string, data: SendRecord): Promise<boolean> {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id, status: PayoutStatus.PENDING, attemptCount: 0 },
      data: {
        status: STATUS_TO_PRISMA[data.status],
        txid: data.txid,
        attemptCount: 1,
        lastAttemptAt: data.lastAttemptAt,
        rejectionReason: data.rejectionReason,
      },
    });
    return result.count === 1;
  }

  async claimResend(id: string, expectedAttemptCount: number, now: Date): Promise<boolean> {
    const result = await this.prisma.payoutOrder.updateMany({
      where: {
        id,
        status: { in: AWAITING_EVIDENCE },
        attemptCount: expectedAttemptCount,
      },
      data: { attemptCount: { increment: 1 }, lastAttemptAt: now },
    });
    return result.count === 1;
  }

  async recordResendOutcome(id: string, data: ResendRecord): Promise<boolean> {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id, status: { in: AWAITING_EVIDENCE } },
      data: {
        status: STATUS_TO_PRISMA[data.status],
        rejectionReason: data.rejectionReason,
      },
    });
    return result.count === 1;
  }

  async markSettled(id: string, at: Date): Promise<boolean> {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id, status: { in: AWAITING_EVIDENCE } },
      data: { status: PayoutStatus.SETTLED, settledAt: at },
    });
    return result.count === 1;
  }

  async markParked(id: string, at: Date): Promise<boolean> {
    const result = await this.prisma.payoutOrder.updateMany({
      where: { id, status: { in: AWAITING_EVIDENCE } },
      data: { status: PayoutStatus.PARKED, parkedAt: at },
    });
    return result.count === 1;
  }
}
```

### src/payout/payout.service.ts
```ts
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DAY_MS, startOfUtcDay, toUtcYmd } from '../dates.js';
import { BankClient } from '../bank/bank-client.js';
import type { BankSendRequest, BankSendResponse } from '../bank/bank-client.js';
import { PayoutOrderStore } from './payout.repository.js';
import type { PayoutStatusValue } from './payout.repository.js';

/** Hard cap on bank sends per order; after it the order parks for manual review. */
export const MAX_ATTEMPTS = 5;

/**
 * The bank's publishing lag: a settlement shows up in the statement at most
 * this long after it happens. Absence is only proof of "not landed" once the
 * lag has elapsed since the last attempt.
 */
export const PUBLISHING_LAG_MS = 30 * 60 * 1000;

/** Sanity cap so a bad window cannot fan out into hundreds of statement fetches. */
export const MAX_RECONCILE_WINDOW_DAYS = 14;

export interface ReconcileWindow {
  /** Inclusive lower bound (any instant). */
  from: Date;
  /** Exclusive upper bound (any instant). */
  to: Date;
}

export type SendOutcome = 'accepted' | 'duplicate' | 'transient' | 'permanent';

export interface ExecutePaymentsSummary {
  accepted: number;
  duplicate: number;
  transient: number;
  permanent: number;
}

export interface ReconcileSummary {
  settled: number;
  /** Re-sends actually submitted to the bank in this run (accepted or duplicate). */
  resent: number;
  /** Orders that remain awaiting evidence after this run. */
  stillAwaiting: number;
  rejected: number;
  parked: number;
}

/**
 * The txid is derived, not generated: the same order on the same effective
 * date always produces the same txid. That is what makes a statement entry
 * matchable back to an order and makes a re-send recognisable to the bank as
 * the same instruction rather than a new one.
 */
export function deriveTxid(orderId: string, effectiveDate: Date): string {
  // ASSUMPTION: the bank accepts a 64-char lowercase hex (SHA-256) string as a txid.
  const seed = `${orderId}:${toUtcYmd(effectiveDate)}`;
  return createHash('sha256').update(seed).digest('hex');
}

/**
 * Maps a raw bank response to the four outcomes. A transient error (no
 * response, 5xx, 408, 429) means the outcome is unknown: the only correct
 * move is to record that and wait for evidence — never act on it.
 */
export function classifySend(response: BankSendResponse): SendOutcome {
  if (response.statusCode === 0) return 'transient';
  if (response.statusCode >= 200 && response.statusCode < 300) return 'accepted';
  // ASSUMPTION: the bank answers 409 when it already holds this txid.
  if (response.statusCode === 409) return 'duplicate';
  if (response.statusCode === 408 || response.statusCode === 429 || response.statusCode >= 500) {
    return 'transient';
  }
  return 'permanent';
}

/** The UTC calendar days (midnights) covered by a half-open window. */
export function daysInWindow(window: ReconcileWindow): Date[] {
  if (window.to.getTime() <= window.from.getTime()) return [];
  const spanDays = (window.to.getTime() - window.from.getTime()) / DAY_MS + 1;
  if (spanDays > MAX_RECONCILE_WINDOW_DAYS) {
    throw new Error(`reconcile window spans more than ${MAX_RECONCILE_WINDOW_DAYS} days`);
  }
  const first = startOfUtcDay(window.from).getTime();
  const last = startOfUtcDay(new Date(window.to.getTime() - 1)).getTime();
  const days: Date[] = [];
  for (let t = first; t <= last; t += DAY_MS) days.push(new Date(t));
  return days;
}

/**
 * An order is past the publishing lag once enough time has passed since its
 * last attempt that, had the send landed, its entry would be in the statement
 * by now.
 */
export function isPastPublishingLag(lastAttemptAt: Date | null, now: Date): boolean {
  const base = lastAttemptAt !== null ? lastAttemptAt.getTime() : 0;
  return now.getTime() - base >= PUBLISHING_LAG_MS;
}

/**
 * The scheduled job reconciles yesterday and today: today's statement is
 * still receiving entries (presence settles), and yesterday's statement is
 * complete once the lag has passed (absence becomes proof there).
 */
export function buildScheduledWindow(now: Date): ReconcileWindow {
  const today = startOfUtcDay(now);
  return { from: new Date(today.getTime() - DAY_MS), to: new Date(today.getTime() + DAY_MS) };
}

@Injectable()
export class PayoutService {
  constructor(
    private readonly orders: PayoutOrderStore,
    private readonly bank: BankClient,
  ) {}

  /**
   * First send of pending orders. This path may record that it does not know
   * an outcome — it may not act on that. It never re-sends: re-sends happen in
   * reconcile(), and only after the statement proves absence past the lag.
   */
  async executePayments(now: Date = new Date()): Promise<ExecutePaymentsSummary> {
    const pending = await this.orders.findPending();
    const summary: ExecutePaymentsSummary = { accepted: 0, duplicate: 0, transient: 0, permanent: 0 };
    for (const order of pending) {
      const txid = deriveTxid(order.id, order.effectiveDate);
      const response = await this.sendToBank({ txid, amount: order.amountMinor, key: order.key });
      const outcome = classifySend(response);
      const recorded = await this.orders.recordSendOutcome(order.id, {
        status: statusFor(outcome),
        txid,
        lastAttemptAt: now,
        rejectionReason: outcome === 'permanent' ? response.reason : null,
      });
      if (recorded) summary[outcome] += 1;
    }
    return summary;
  }

  /**
   * Match statement entries to orders and advance them. Safe to run every 15
   * minutes over overlapping windows:
   *  - statements are fetched before any state change, so a bank failure
   *    changes nothing;
   *  - orders already matched (settled) are not even fetched;
   *  - every transition is a conditional update, and a re-send is claimed
   *    atomically before it happens, so two overlapping runs can never
   *    double-send or double-settle one order.
   */
  async reconcile(window: ReconcileWindow, now: Date = new Date()): Promise<ReconcileSummary> {
    const summary: ReconcileSummary = { settled: 0, resent: 0, stillAwaiting: 0, rejected: 0, parked: 0 };
    const days = daysInWindow(window);
    if (days.length === 0) return summary;

    const statements = await Promise.all(days.map((day) => this.bank.getStatement(day)));
    const settledTxids = new Set<string>();
    for (const entries of statements) {
      for (const entry of entries) settledTxids.add(entry.txid);
    }

    const candidates = await this.orders.findAwaitingEvidence(days);
    for (const order of candidates) {
      // Presence in the statement settles the order — regardless of the lag.
      if (order.txid !== null && settledTxids.has(order.txid)) {
        if (await this.orders.markSettled(order.id, now)) summary.settled += 1;
        continue;
      }
      // Absence is not proof until the lag has passed (and a missing txid is
      // not absence of anything).
      if (order.txid === null || !isPastPublishingLag(order.lastAttemptAt, now)) {
        summary.stillAwaiting += 1;
        continue;
      }
      // Proven absent: the only situation in which a re-send is permitted.
      if (order.attemptCount >= MAX_ATTEMPTS) {
        // Terminal: a human reviews. Never auto-reverted, released or forgotten.
        if (await this.orders.markParked(order.id, now)) summary.parked += 1;
        continue;
      }
      if (!(await this.orders.claimResend(order.id, order.attemptCount, now))) {
        // A concurrent run already claimed (and probably performed) this re-send.
        summary.stillAwaiting += 1;
        continue;
      }
      // Re-send with the same derived txid the bank already saw.
      const response = await this.sendToBank({ txid: order.txid, amount: order.amountMinor, key: order.key });
      const outcome = classifySend(response);
      const recorded = await this.orders.recordResendOutcome(order.id, {
        status: statusFor(outcome),
        rejectionReason: outcome === 'permanent' ? response.reason : null,
      });
      if (!recorded) {
        // The order left the awaiting states in the meantime (e.g. settled).
        summary.stillAwaiting += 1;
        continue;
      }
      if (outcome === 'accepted' || outcome === 'duplicate') summary.resent += 1;
      else if (outcome === 'permanent') summary.rejected += 1;
      else summary.stillAwaiting += 1;
    }
    return summary;
  }

  private async sendToBank(request: BankSendRequest): Promise<BankSendResponse> {
    try {
      return await this.bank.send(request);
    } catch (error) {
      // No answer from the bank at all: outcome unknown, not a failure we may act on.
      return { statusCode: 0, reason: error instanceof Error ? error.message : String(error) };
    }
  }
}

function statusFor(outcome: SendOutcome): PayoutStatusValue {
  switch (outcome) {
    case 'accepted':
    case 'duplicate':
      // The bank holds the instruction; the statement will settle it.
      return 'SENT';
    case 'transient':
      return 'OUTCOME_UNKNOWN';
    case 'permanent':
      return 'REJECTED';
  }
}
```

### src/payout/payout.processor.ts
```ts
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { buildScheduledWindow, PayoutService } from './payout.service.js';

/**
 * The scheduled reconcile job: every 15 minutes, reconcile yesterday and
 * today. The window overlaps with the previous run by design; reconcile is
 * idempotent over it, so overlap is safe.
 */
@Injectable()
export class PayoutProcessor {
  constructor(private readonly payouts: PayoutService) {}

  @Cron(CronExpression.EVERY_15_MINUTES)
  async reconcileScheduledWindow(): Promise<void> {
    const now = new Date();
    await this.payouts.reconcile(buildScheduledWindow(now), now);
  }
}
```

### src/payout/payout.module.ts
```ts
import { Module } from '@nestjs/common';
import { BankModule } from '../bank/bank.module.js';
import { PayoutOrderStore, PayoutRepository } from './payout.repository.js';
import { PayoutService } from './payout.service.js';
import { PayoutProcessor } from './payout.processor.js';

@Module({
  imports: [BankModule],
  providers: [
    PayoutRepository,
    { provide: PayoutOrderStore, useExisting: PayoutRepository },
    PayoutService,
    PayoutProcessor,
  ],
})
export class PayoutModule {}
```

### test/payout.spec.ts
```ts
import { describe, expect, it } from 'vitest';
import { DAY_MS, startOfUtcDay, toUtcYmd } from '../src/dates.js';
import {
  buildScheduledWindow,
  classifySend,
  deriveTxid,
  isPastPublishingLag,
  MAX_ATTEMPTS,
  PUBLISHING_LAG_MS,
  PayoutService,
} from '../src/payout/payout.service.js';
import type { BankClient, BankSendRequest, BankSendResponse, Settlement } from '../src/bank/bank-client.js';
import type { PayoutOrderRow, PayoutOrderStore, ResendRecord, SendRecord } from '../src/payout/payout.repository.js';

const DAY = (isoDate: string): Date => startOfUtcDay(new Date(`${isoDate}T00:00:00Z`));
const MINUTE = 60 * 1000;

const KEY = 'DE89370400440532013000';
const AMOUNT = 1_840_000; // €18,400.00 in minor units

function order(overrides: Partial<PayoutOrderRow> & Pick<PayoutOrderRow, 'id'>): PayoutOrderRow {
  return {
    supplierId: 'sup-1',
    key: KEY,
    amountMinor: AMOUNT,
    currency: 'EUR',
    effectiveDate: DAY('2025-01-15'),
    status: 'OUTCOME_UNKNOWN',
    txid: null,
    attemptCount: 1,
    lastAttemptAt: null,
    rejectionReason: null,
    settledAt: null,
    parkedAt: null,
    ...overrides,
  };
}

const AWAITING: PayoutOrderRow['status'][] = ['SENT', 'OUTCOME_UNKNOWN'];

/**
 * In-memory stand-in for the store contract. It mirrors the real store's
 * conditional-update semantics (transitions only apply from the expected
 * state), which is what the overlap-safety of reconcile relies on.
 */
class FakeOrderStore implements PayoutOrderStore {
  private readonly rows = new Map<string, PayoutOrderRow>();

  put(row: PayoutOrderRow): this {
    this.rows.set(row.id, { ...row });
    return this;
  }

  get(id: string): PayoutOrderRow {
    const row = this.rows.get(id);
    if (row === undefined) throw new Error(`no order with id ${id}`);
    return { ...row };
  }

  async findPending(): Promise<PayoutOrderRow[]> {
    return [...this.rows.values()]
      .filter((row) => row.status === 'PENDING' && row.attemptCount === 0)
      .map((row) => ({ ...row }));
  }

  async findAwaitingEvidence(effectiveDates: Date[]): Promise<PayoutOrderRow[]> {
    const days = new Set(effectiveDates.map((day) => day.getTime()));
    return [...this.rows.values()]
      .filter(
        (row) =>
          AWAITING.includes(row.status) &&
          row.txid !== null &&
          days.has(startOfUtcDay(row.effectiveDate).getTime()),
      )
      .map((row) => ({ ...row }));
  }

  async recordSendOutcome(id: string, data: SendRecord): Promise<boolean> {
    const row = this.rows.get(id);
    if (row === undefined || row.status !== 'PENDING' || row.attemptCount !== 0) return false;
    Object.assign(row, data, { attemptCount: 1 });
    return true;
  }

  async claimResend(id: string, expectedAttemptCount: number, now: Date): Promise<boolean> {
    const row = this.rows.get(id);
    if (row === undefined || !AWAITING.includes(row.status) || row.attemptCount !== expectedAttemptCount) {
      return false;
    }
    row.attemptCount += 1;
    row.lastAttemptAt = now;
    return true;
  }

  async recordResendOutcome(id: string, data: ResendRecord): Promise<boolean> {
    const row = this.rows.get(id);
    if (row === undefined || !AWAITING.includes(row.status)) return false;
    Object.assign(row, data);
    return true;
  }

  async markSettled(id: string, at: Date): Promise<boolean> {
    const row = this.rows.get(id);
    if (row === undefined || !AWAITING.includes(row.status)) return false;
    row.status = 'SETTLED';
    row.settledAt = at;
    return true;
  }

  async markParked(id: string, at: Date): Promise<boolean> {
    const row = this.rows.get(id);
    if (row === undefined || !AWAITING.includes(row.status)) return false;
    row.status = 'PARKED';
    row.parkedAt = at;
    return true;
  }
}

/** Scripted stand-in for the bank. */
class FakeBank implements BankClient {
  sent: BankSendRequest[] = [];
  private readonly queued: (BankSendResponse | Error)[] = [];
  private defaultResponse: BankSendResponse = { statusCode: 202, reason: '' };
  private readonly statements = new Map<string, Settlement[]>();

  queueSend(response: BankSendResponse | Error): this {
    this.queued.push(response);
    return this;
  }

  setSend(response: BankSendResponse | Error): this {
    this.defaultResponse = response;
    return this;
  }

  statementFor(isoDate: string, txids: string[]): this {
    this.statements.set(isoDate, txids.map((txid) => ({ txid })));
    return this;
  }

  async send(request: BankSendRequest): Promise<BankSendResponse> {
    this.sent.push({ ...request });
    const response = this.queued.shift() ?? this.defaultResponse;
    if (response instanceof Error) throw response;
    return response;
  }

  async getStatement(date: Date): Promise<Settlement[]> {
    return this.statements.get(toUtcYmd(date)) ?? [];
  }
}

describe('PayoutService', () => {
  describe('reconcile: a timed-out send that the statement proves landed', () => {
    it('settles the order and never re-sends it', async () => {
      const now = new Date(Date.UTC(2025, 0, 20, 10, 0, 0));
      const effectiveDate = DAY('2025-01-20');
      const txid = deriveTxid('ord-1', effectiveDate);
      const store = new FakeOrderStore().put(
        order({
          id: 'ord-1',
          effectiveDate,
          txid,
          status: 'OUTCOME_UNKNOWN', // the send timed out; the outcome is unknown
          lastAttemptAt: new Date(now.getTime() - 5 * MINUTE), // well inside the publishing lag
        }),
      );
      const bank = new FakeBank().statementFor(toUtcYmd(effectiveDate), [txid]);
      const service = new PayoutService(store, bank);

      const summary = await service.reconcile(buildScheduledWindow(now), now);

      const after = store.get('ord-1');
      expect(after.status).toBe('SETTLED');
      expect(after.settledAt).toEqual(now);
      expect(bank.sent).toEqual([]); // the timeout did not trigger a re-send
      expect(summary).toMatchObject({ settled: 1, resent: 0 });

      // A second run over the same window changes nothing.
      await service.reconcile(buildScheduledWindow(now), now);
      expect(store.get('ord-1').status).toBe('SETTLED');
      expect(bank.sent).toEqual([]);
    });
  });

  describe('reconcile: absence proven past the publishing lag', () => {
    it('re-sends with the same txid and the same amount', async () => {
      const now = new Date(Date.UTC(2025, 0, 20, 10, 0, 0));
      const effectiveDate = DAY('2025-01-19');
      const txid = deriveTxid('ord-2', effectiveDate); // what the first (timed-out) send used
      const store = new FakeOrderStore().put(
        order({
          id: 'ord-2',
          effectiveDate,
          txid,
          status: 'OUTCOME_UNKNOWN',
          lastAttemptAt: new Date(now.getTime() - PUBLISHING_LAG_MS - MINUTE),
        }),
      );
      const bank = new FakeBank().setSend({ statusCode: 503, reason: 'bank unavailable' });
      const service = new PayoutService(store, bank);

      await service.reconcile(buildScheduledWindow(now), now);

      expect(bank.sent).toEqual([{ txid, amount: AMOUNT, key: KEY }]); // same txid, not a new one
      const after = store.get('ord-2');
      expect(after.attemptCount).toBe(2);
      expect(after.status).toBe('OUTCOME_UNKNOWN'); // the re-send failed again: record and wait
      expect(after.lastAttemptAt).toEqual(now);
    });

    it('does not re-send while the publishing lag has not elapsed', async () => {
      const now = new Date(Date.UTC(2025, 0, 20, 10, 0, 0));
      const effectiveDate = DAY('2025-01-19');
      const txid = deriveTxid('ord-3', effectiveDate);
      const lastAttempt = new Date(now.getTime() - 5 * MINUTE);
      const store = new FakeOrderStore().put(
        order({ id: 'ord-3', effectiveDate, txid, status: 'OUTCOME_UNKNOWN', lastAttemptAt: lastAttempt }),
      );
      const bank = new FakeBank();
      const service = new PayoutService(store, bank);

      const summary = await service.reconcile(buildScheduledWindow(now), now);

      expect(bank.sent).toEqual([]);
      const after = store.get('ord-3');
      expect(after.status).toBe('OUTCOME_UNKNOWN');
      expect(after.attemptCount).toBe(1);
      expect(after.lastAttemptAt).toEqual(lastAttempt);
      expect(summary.stillAwaiting).toBe(1);
    });

    it('is idempotent when run repeatedly over the same window', async () => {
      const now = new Date(Date.UTC(2025, 0, 20, 10, 0, 0));
      const effectiveDate = DAY('2025-01-19');
      const txid = deriveTxid('ord-4', effectiveDate);
      const store = new FakeOrderStore().put(
        order({
          id: 'ord-4',
          effectiveDate,
          txid,
          status: 'OUTCOME_UNKNOWN',
          lastAttemptAt: new Date(now.getTime() - 2 * 60 * MINUTE),
        }),
      );
      const bank = new FakeBank().setSend({ statusCode: 202, reason: '' }); // the re-send is accepted
      const service = new PayoutService(store, bank);
      const window = buildScheduledWindow(now);

      await service.reconcile(window, now);
      const afterFirst = store.get('ord-4');
      expect(afterFirst.status).toBe('SENT');
      expect(afterFirst.attemptCount).toBe(2);
      expect(bank.sent).toHaveLength(1);

      // Same window, same instant: the fresh send is still inside its own lag.
      await service.reconcile(window, now);
      expect(store.get('ord-4')).toEqual(afterFirst);
      expect(bank.sent).toHaveLength(1);

      // The next scheduled run (15 minutes later) is still inside the lag.
      const nextRun = new Date(now.getTime() + 15 * MINUTE);
      await service.reconcile(buildScheduledWindow(nextRun), nextRun);
      expect(store.get('ord-4')).toEqual(afterFirst);
      expect(bank.sent).toHaveLength(1);
    });
  });

  describe('reconcile: attempt exhaustion', () => {
    it('parks the order for review once attempts are exhausted, and never reverts it', async () => {
      const now = new Date(Date.UTC(2025, 0, 20, 10, 0, 0));
      const effectiveDate = DAY('2025-01-19');
      const txid = deriveTxid('ord-5', effectiveDate);
      const store = new FakeOrderStore().put(
        order({
          id: 'ord-5',
          effectiveDate,
          txid,
          status: 'OUTCOME_UNKNOWN',
          attemptCount: MAX_ATTEMPTS,
          lastAttemptAt: new Date(now.getTime() - PUBLISHING_LAG_MS - MINUTE),
        }),
      );
      const bank = new FakeBank();
      const service = new PayoutService(store, bank);

      const summary = await service.reconcile(buildScheduledWindow(now), now);

      const after = store.get('ord-5');
      expect(after.status).toBe('PARKED');
      expect(after.parkedAt).toEqual(now);
      expect(bank.sent).toEqual([]); // no sixth send
      expect(summary.parked).toBe(1);

      // A later overlapping run must not release or revert the parked order.
      const later = new Date(now.getTime() + 60 * MINUTE);
      await service.reconcile(buildScheduledWindow(later), later);
      expect(store.get('ord-5')).toEqual(after);
      expect(bank.sent).toEqual([]);

      // Even fresh statement evidence does not auto-release a parked order:
      // a human makes that call.
      bank.statementFor(toUtcYmd(effectiveDate), [txid]);
      await service.reconcile(buildScheduledWindow(later), later);
      expect(store.get('ord-5').status).toBe('PARKED');
    });

    it('makes the fifth attempt the last, then parks when it too is proven absent', async () => {
      const t0 = new Date(Date.UTC(2025, 0, 20, 10, 0, 0));
      const effectiveDate = DAY('2025-01-19');
      const txid = deriveTxid('ord-6', effectiveDate);
      const store = new FakeOrderStore().put(
        order({
          id: 'ord-6',
          effectiveDate,
          txid,
          status: 'OUTCOME_UNKNOWN',
          attemptCount: MAX_ATTEMPTS - 1, // four attempts so far
          lastAttemptAt: new Date(t0.getTime() - PUBLISHING_LAG_MS - MINUTE),
        }),
      );
      const bank = new FakeBank().setSend({ statusCode: 503, reason: 'still down' });
      const service = new PayoutService(store, bank);

      const first = await service.reconcile(buildScheduledWindow(t0), t0);
      expect(bank.sent).toEqual([{ txid, amount: AMOUNT, key: KEY }]); // the fifth attempt
      expect(store.get('ord-6').attemptCount).toBe(MAX_ATTEMPTS);
      expect(first.resent).toBe(0);
      expect(first.stillAwaiting).toBe(1);

      const t1 = new Date(t0.getTime() + PUBLISHING_LAG_MS + MINUTE);
      const second = await service.reconcile(buildScheduledWindow(t1), t1);
      const after = store.get('ord-6');
      expect(after.status).toBe('PARKED');
      expect(bank.sent).toHaveLength(1); // still only the fifth attempt
      expect(second.parked).toBe(1);
    });
  });

  describe('executePayments: the four send outcomes', () => {
    it('routes each outcome to its own state, deriving the txid for every order', async () => {
      const now = new Date(Date.UTC(2025, 0, 20, 9, 0, 0));
      const effectiveDate = DAY('2025-01-20');
      const ids = ['ord-a', 'ord-b', 'ord-c', 'ord-d', 'ord-e'];
      const store = new FakeOrderStore();
      for (const id of ids) {
        store.put(order({ id, effectiveDate, status: 'PENDING', attemptCount: 0 }));
      }
      const bank = new FakeBank()
        .queueSend({ statusCode: 202, reason: '' }) // accepted: in flight
        .queueSend({ statusCode: 409, reason: 'txid already known' }) // duplicate: success
        .queueSend({ statusCode: 503, reason: 'bank overloaded' }) // transient: unknown
        .queueSend(new Error('socket hang up')) // no answer at all: unknown
        .queueSend({ statusCode: 422, reason: 'blocked account' }); // permanent
      const service = new PayoutService(store, bank);

      const summary = await service.executePayments(now);

      expect(summary).toEqual({ accepted: 1, duplicate: 1, transient: 2, permanent: 1 });

      const byId = (id: string): PayoutOrderRow => store.get(id);
      expect(byId('ord-a').status).toBe('SENT');
      expect(byId('ord-b').status).toBe('SENT'); // a duplicate is a success, not an error
      expect(byId('ord-c').status).toBe('OUTCOME_UNKNOWN');
      expect(byId('ord-d').status).toBe('OUTCOME_UNKNOWN');
      expect(byId('ord-e').status).toBe('REJECTED');
      expect(byId('ord-e').rejectionReason).toBe('blocked account');
      for (const id of ids) {
        const row = byId(id);
        expect(row.txid).toBe(deriveTxid(id, effectiveDate));
        expect(row.attemptCount).toBe(1);
        expect(row.lastAttemptAt).toEqual(now);
      }
      expect(bank.sent.map((request) => request.txid)).toEqual(
        ids.map((id) => deriveTxid(id, effectiveDate)),
      );
    });
  });

  describe('txid derivation', () => {
    it('is deterministic per order and effective date, and changes with either', () => {
      const d1 = DAY('2025-01-15');
      expect(deriveTxid('ord-9', d1)).toBe(deriveTxid('ord-9', new Date(d1.getTime())));
      expect(deriveTxid('ord-9', d1)).not.toBe(deriveTxid('ord-9', DAY('2025-01-16')));
      expect(deriveTxid('ord-9', d1)).not.toBe(deriveTxid('ord-10', d1));
      expect(deriveTxid('ord-9', d1)).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('classification and window helpers', () => {
    it('classifies raw bank responses into the four outcomes', () => {
      expect(classifySend({ statusCode: 201, reason: '' })).toBe('accepted');
      expect(classifySend({ statusCode: 409, reason: '' })).toBe('duplicate');
      expect(classifySend({ statusCode: 500, reason: '' })).toBe('transient');
      expect(classifySend({ statusCode: 408, reason: '' })).toBe('transient');
      expect(classifySend({ statusCode: 429, reason: '' })).toBe('transient');
      expect(classifySend({ statusCode: 0, reason: 'timeout' })).toBe('transient');
      expect(classifySend({ statusCode: 400, reason: 'malformed' })).toBe('permanent');
      expect(classifySend({ statusCode: 403, reason: 'blocked account' })).toBe('permanent');
    });

    it('treats an order as past the lag exactly when the lag has elapsed since its last attempt', () => {
      const t = new Date(Date.UTC(2025, 0, 20, 10, 0, 0));
      expect(isPastPublishingLag(new Date(t.getTime() - PUBLISHING_LAG_MS), t)).toBe(true);
      expect(isPastPublishingLag(new Date(t.getTime() - PUBLISHING_LAG_MS + 1000), t)).toBe(false);
    });

    it('maps the scheduled window onto yesterday and today (UTC)', () => {
      const now = new Date(Date.UTC(2025, 0, 20, 0, 15, 0));
      const window = buildScheduledWindow(now);
      expect(window.from).toEqual(new Date(Date.UTC(2025, 0, 19, 0, 0, 0)));
      expect(window.to).toEqual(new Date(Date.UTC(2025, 0, 21, 0, 0, 0)));
      expect(window.to.getTime() - window.from.getTime()).toBe(2 * DAY_MS);
    });
  });
});
```


---

REQUEST FAILED

IncompleteRead(209 bytes read)


---

# repair1-set

## reasoning

```
The error is clear: `CronExpression.EVERY_15_MINUTES` doesn't exist. Looking at the `@nestjs/schedule` package, the `CronExpression` enum has predefined values for every 1, 5, 10, 15, 30 minutes and every hour. Let me think...

Actually, in `@nestjs/schedule`, the `CronExpression` enum does include `EVERY_15_MINUTES`. Let me reconsider.

Wait, looking at the actual `@nestjs/schedule` source code, the `CronExpression` enum includes:
- EVERY_SECOND
- EVERY_5_SECONDS
- EVERY_10_SECONDS
- EVERY_30_SECONDS
- EVERY_MINUTE
- EVERY_5_MINUTES
- EVERY_10_MINUTES
- EVERY_15_MINUTES
- EVERY_30_MINUTES
- EVERY_HOUR
- EVERY_3_HOURS
- EVERY_DAY
- EVERY_WEEK
- EVERY_MONTH

So `EVERY_15_MINUTES` should exist. But the compiler says it doesn't. The compiler suggests `EVERY_5_MINUTES` as a close match, which means the enum exists but `EVERY_15_MINUTES` specifically is not there.

This could be a version issue. In some versions of `@nestjs/schedule`, the enum might not have `EVERY_15_MINUTES`. Let me check what's actually available.

Looking at the `@nestjs/schedule` package more carefully - in version 1.x and 2.x, the `CronExpression` enum is:

```ts
export enum CronExpression {
  EVERY_SECOND = '* * * * * *',
  EVERY_5_SECONDS = '*/5 * * * * *',
  EVERY_10_SECONDS = '*/10 * * * * *',
  EVERY_30_SECONDS = '*/30 * * * * *',
  EVERY_MINUTE = '* * * * *',
  EVERY_5_MINUTES = '*/5 * * * *',
  EVERY_10_MINUTES = '*/10 * * * *',
  EVERY_15_MINUTES = '*/15 * * * *',
  EVERY_30_MINUTES = '*/30 * * * *',
  EVERY_HOUR = '0 * * * *',
  EVERY_3_HOURS = '0 */3 * * *',
  EVERY_DAY = '0 0 * * *',
  EVERY_WEEK = '0 0 * * 0',
  EVERY_MONTH = '0 0 1 * *',
}
```

So `EVERY_15_MINUTES` should be there. But the compiler says it's not. This means the installed version of `@nestjs/schedule` in this project doesn't have it, or there's some other issue.

Since the compiler is the authority here and it says `EVERY_15_MINUTES` doesn't exist, the fix is to use a raw cron string `'*/15 * * * *'` instead. This is the standard cron expression for "every 15 minutes" and will work regardless of what enum values are available.

The fix is to replace `CronExpression.EVERY_15_MINUTES` with the string literal `'*/15 * * * *'` in the `@Cron` decorator.

Since we're no longer using `CronExpression` at all, we can also remove the import of `CronExpression` if it's not used elsewhere. Let me check the file - it imports `Cron, CronExpression` from `@nestjs/schedule`. After the fix, only `Cron` is needed.

So the fix for `src/payout/payout.processor.ts`:
- Remove `CronExpression` from the import
- Change `@Cron(CronExpression.EVERY_15_MINUTES)` to `@Cron('*/15 * * * *')`

That's the only file with errors, so that's the only file I need to return.
```

## reply

### src/payout/payout.processor.ts
```ts
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { buildScheduledWindow, PayoutService } from './payout.service.js';

/**
 * The scheduled reconcile job: every 15 minutes, reconcile yesterday and
 * today. The window overlaps with the previous run by design; reconcile is
 * idempotent over it, so overlap is safe.
 */
@Injectable()
export class PayoutProcessor {
  constructor(private readonly payouts: PayoutService) {}

  @Cron('*/15 * * * *')
  async reconcileScheduledWindow(): Promise<void> {
    const now = new Date();
    await this.payouts.reconcile(buildScheduledWindow(now), now);
  }
}
```


---
