# plan

## reply

Let me carefully plan the plan document for this crypto payout service.

Key design decisions I need to make:

1. **Idempotency**: The `payouts` table has a unique constraint on `idempotency_key`. Retry → return the existing payout.

2. **Balance/ledger**: Double-entry style. Two ledger tables, or a single `ledger_entries` table with account-based entries. Approach:
   - `accounts` table: `account_id`, `settled_balance` (minor units, BigInt), `reserved_balance`.
   - `ledger_entries`: entries with `entry_id`, `account_id`, `entry_type` (reserve / release / debit / credit), `amount`, `payout_id`.
   
   Requirement 5: "The account's settled balance changes only when the provider confirms a transfer." So reservation must not touch the settled balance. On payout creation: `available = settled - reserved`, check `settled - reserved >= amount`, then increment `reserved` and write a "reserve" ledger entry. On provider confirmation: decrement `reserved`, decrement `settled`, write "settle" entries (debit the account's settled balance, credit the "PAYOUTS_IN_FLIGHT"/"LIABILITIES" account? For a double-entry ledger, each entry should have a counterpart).

   Let's design the double-entry ledger properly: each payout moves money between conceptual accounts.
   - `reserve`: debit `available_balance` (asset), credit `pending_payouts` (liability/suspense).
   - `settle` on provider confirmation: debit `pending_payouts`, credit `settled_balance`.
   - `release` (cancellation after retries exhausted): debit `pending_payouts`, credit `available_balance`.

   But wait — "settled balance changes only when provider confirms a transfer." If reserve decrements available = settled - reserved, then the settled column doesn't change at reserve time. On confirmation: both settled and reserved decrement. So "settled balance" (the nominal column) only changes on confirmation. Good — available is derived: `settled - reserved`.

   So the ledger entries table: one row per accounting event:
   - `id` (BigInt/uuid)
   - `payout_id` (FK, nullable?)
   - `entry_type`: 'reserve' | 'settle' | 'release'
   - `debit_account` / `credit_account`: account IDs — either the customer's accountId, or a house account like 'HOUSE_PENDING_PAYOUTS'.
   
   Simpler double-entry: each payout gets a pair of ledger entries at each transition. Table `ledger_entries`: `entry_id`, `payout_id`, `account_id` (the account affected), `change_kind` ('in' | 'out'), `amount`. Reserve: one entry on the user account for "reserved". Hmm.

   The cleanest and most readable approach:
   - `accounts`: `account_id (uuid PK)`, `settled_minor_units (BigInt)`, `reserved_minor_units (BigInt)`.
   - `ledger_entries`: `entry_id (uuid PK)`, `payout_id (FK→payouts, not null)`, `ledger_account` enum-ish string: 'SETTLED' | 'RESERVED' | 'SETTLED_OUT' ... hmm.

   Maybe simpler: `ledger_entries` columns: `entry_id`, `payout_id`, `direction` ('debit'|'credit'), `account_code` (one of 'customer:settled', ...). This is getting complicated.

   A practical double-entry approach that's common in this kind of eval: a single `ledger_entries` table where each transaction creates exactly two rows (debit+credit) referencing named ledger accounts. Ledger accounts: `SETTLED_FUNDS` (customer's available money), `PAYOUTS_PENDING` (house suspense account).

   - Reserve: debit SETTLED_FUNDS (customer's available decreases) → but the requirement says settled balance only changes on confirmation...

   Re-reading: "Maintain a double-entry style ledger. The account's settled balance changes only when the provider confirms a transfer." I think the intent is: don't decrement the user's balance at payout creation time; reserve via a separate reserved amount, and only actually move money out on confirmation. A "double-entry style" ledger means each event is a pair of entries that sum to zero.

   Concrete design:
   - `accounts`: `account_id`, `settled_minor_units BigInt`, `reserved_minor_units BigInt`.
   - `ledger_entries`: each row = one side of an event pair:
     - `entry_id uuid PK`
     - `payout_id FK not null`
     - `counter_account_code Text` — one of `SETTLED`, `RESERVED`, `PAID_OUT` (house accounts), with the actual customer account being implicit via payout.account_id? Hmm, that's confusing.

   The most defensible and simple double-entry: two named house ledger accounts + customer account rows:
   - Accounts in the ledger sense: for each payout event, two entries:
     - Reserve: entry A: account = customer's accountId, amount = +amount (type 'reserved'); entry B: house account 'PAYOUTS_PENDING', amount = -amount?

   Let's use a signed amount convention:
   - `ledger_entries`: `entry_id`, `payout_id`, `account_ref` (Text: customer account ID, or house codes 'pending'/'paid_out'), `delta_minor_units` (BigInt, signed).
   - Reserve: (customer, +amount to a "reserved" bucket) ... but then the customer row mixes settled and reserved.

   Maybe it's cleanest to have 4 house ledger buckets: `customer_settled` (per customer), `customer_reserved` (per customer), `house_pending` (suspense), and the flow is:
   - Reserve: customer_settled -A, house_pending +A. Then settled decreases at reserve time — violates the requirement?

   "The account's settled balance changes only when the provider confirms a transfer." Strict reading: `accounts.settled_minor_units` (the number) only changes at confirmation time. The derived available balance may change, but the "settled" ledger account... hmm, I think the point is about not losing funds before confirmation — the "settled balance" in the sense of money recognized as spent is only decremented when the provider confirms. At reserve time, what changes is the *available* balance (settled - reserved), and the ledger records a move from customer-settled to customer-reserved.

   To avoid over-engineering, and because this is a planning document, I'll specify:

   - `accounts` table: `account_id`, `settled_minor_units BigInt`, `reserved_minor_units BigInt`. Available = settled - reserved (computed, never stored).
   - `ledger_entries`: double-entry pairs:
     columns: `entry_id uuid`, `payout_id FK not null`, `ledger_account Text` (customer's account ID, or one of the house codes `'payouts_pending'`, `'payouts_paid_out'`), `side Text` ('debit' | 'credit'), `amount_minor_units BigInt (positive)`.
   - Reserve: debit `payouts_pending` +A, credit customer `A`. (Available drops because the customer's credit balances the pending debit? hmm, debits/credits on assets vs liabilities...)

   Honestly, for a planning doc the precise debit/credit orientation barely matters as long as it's internally consistent and I declare: each payout transition appends exactly one debit entry and one credit entry of equal amount, and the sum over all entries for a customer account equals (settled - reserved + paid_out)... Let me define invariants:

   Invariant: for a customer account, the sum of ledger credits − debits = lifetime settled credits... too heavy.

   Simpler, and defensible:
   - Reserve: customer entry (kind 'reserved', +A) and house entry (`payouts_pending`, kind 'liability', +A)?

   OK let me commit to a concrete, simple spec and stop waffling:

   **Ledger**: table `ledger_entries`:
   - `entry_id: uuid PK`
   - `payout_id: uuid FK not null`
   - `ledger_account: text not null` — the customer's `accountId`, or the house code `'payouts_pending'` (money held for unpaid payouts) — that's it.
   - `amount_minor_units: BigInt not null` — positive integer.
   - `entry_type: 'reserve' | 'settle_out' | 'release'`
   - `created_at: timestamptz`

   Rules:
   - Reserve (at creation): two rows — (customer, A, 'reserve') and ('payouts_pending', A, 'reserve').
   - Settle (on provider confirmation): two rows — (customer, A, 'settle_out') and ('payouts_pending', A, 'settle_out'). And `accounts.settled_minor_units -= A; reserved -= A`.
   - Release (on retries exhausted): two rows — (customer, A, 'release') and ('payouts_pending', A, 'release'). And `reserved -= A` (settled unchanged).

   Invariants I can state:
   - For the customer: sum(settle_out rows) = total actually paid out = initial settle − current settled... well, the account might have its balance topped up externally, which is out of scope; no deposit endpoint is specified. So: sum(customer settle_out) = seeded initial balance − current settled_minor_units. Good enough, I can state "settled balance only ever changes on settle, and by the negative of the corresponding ledger rows."
   - For 'payouts_pending': sum(reserve) − sum(settle_out) − sum(release) = current total reserved across all payouts of the account.

   That's a clean double-entry style: each event is a balanced pair, and the suspense account tracks in-flight money.

   Prisma BigInt type: `BigInt @db.BigInt`. Money is always non-negative, stored as positive.

3. **Concurrency / no overdraw**: creation must atomically check and reserve. In Prisma: `prisma.$transaction(async tx => { const acct = await tx.account.findUnique({where:{account_id}, forUpdate:true (via $queryRaw? }` — Prisma doesn't support SELECT FOR UPDATE directly; options:
   - Pessimistic lock with `tx.$queryRaw` SELECT ... FOR UPDATE — but the rule says zero raw SQL in service; the repository is the only layer that can touch the DB — raw SQL within a repository via `prisma.$transaction` is allowed? "repository is the only layer that touches the database" — $queryRaw is a DB touch, so fine within repository.
   - Optimistic locking: `reserved_minor_units` with a version column, or UPDATE ... WHERE settled - reserved >= amount returning rowcount. A conditional UPDATE is the simplest race-safe approach: `UPDATE accounts SET reserved_minor_units = reserved_minor_units + $1 WHERE account_id = $2 AND settled_minor_units - reserved_minor_units >= $1 RETURNING ...` — zero rows → insufficient funds. This is atomic, no lock, clean in Prisma: `tx.account.updateMany({where:{account_id, ...compute expression?}})`.

   Prisma `updateMany` can't express an arithmetic condition easily (does it support `gt`/`gte` against computed values in where? No — Prisma's where clauses can't do arithmetic on two columns... actually `where: { settled_minor_units: { gte: ??? } }` — no, no arithmetic). So a repository-side conditional update needs raw SQL: `UPDATE accounts SET reserved_minor_units = reserved_minor_units + $1 WHERE account_id = $2 AND settled_minor_units - reserved_minor_units >= $1 RETURNING account_id` — return 0 rows → insufficient funds. But "zero raw SQL" is about the service layer; repository can use $queryRaw, or `prisma.$executeRaw` + separate fetch. That's the standard pattern for this kind of eval.

   Alternative: optimistic retry with version. The conditional UPDATE is better: single atomic statement, no retry loop, correct for two racers (one succeeds, one gets 0 rows).

   Also account creation: the account must exist; if not, `resource_not_found` (or auto-create?). The task says "if the account has enough available funds" — implies the account exists. Assumption: `accountId` must reference an existing row in `accounts`; otherwise 404 resource_not_found. Seed accounts are created via a fixture/migration? For tests I need seeded accounts — the test helper creates accounts directly via repository.

   Hmm, should POST /payouts create an account if it doesn't exist? No — a platform paying out sellers; the seller has an account with funds (topped up via deposits out of scope). State the assumption: accounts are created outside this service's API (tests seed them); POST /payouts on an unknown accountId → 404 resource_not_found.

4. **Messages/outbox table** (`messages`):
   - `message_id uuid PK`
   - `payout_id uuid FK not null` (unique — one message per payout)
   - `topic text not null` = 'payout.transfer'
   - `payload jsonb not null` (accountId, destinationAddress, amountMinorUnits)
   - `status text`: 'pending' | 'in_flight'? With at-least-once delivery via polling, either claim messages in a single transaction (UPDATE ... WHERE status='pending' AND (claim_expires_at IS NULL OR claim_expires_at < now) ...), or simply SELECT pending and mark. To make duplicate delivery testable, the worker `processMessages()` claims N pending messages (status → 'in_flight'? or leave as pending and mark processing).

   Simpler: message statuses: `pending` → (worker claims) `processing` → `sent`/`dead`. Worker: in a transaction, atomically claim pending messages (UPDATE ... SET status='processing', claimed_at=now WHERE message_id IN (...)), then for each call the provider. This claim UPDATE itself is a raw SQL / updateMany in the repository. Prisma's `updateMany` can do it: `tx.message.updateMany({ where: { message_id: { in: ids }, status: 'pending' }, data: { status: 'processing' } })` — but which ones were actually claimed (if two workers run concurrently) is unknown. updateMany returns count, not rows. Need `RETURNING` → raw SQL, or single-threaded assumption (the task's polling worker is singular; concurrency of two workers is not required). Required concurrency: payout creation. So single-worker assumption is fine: worker selects all pending, marks them processing (in a tx), then processes.

   Duplicate delivery is at the provider-call level: "the worker may see the same message multiple times" — meaning a message can be redelivered (e.g. it stays pending because the process crashed mid-processing, or a test calls processMessages twice / requeues). Handling: idempotent processing — if the payout is already `sent`/`completed`, skip; if `processing`, safely retry (provider is at-least-once; dedupe by provider? we can't assume a provider idempotency key — assumption: the provider SDK doesn't accept an idempotency key; if a transient failure happens with an unknown outcome (timeout), we must not blindly retry, because the transfer might have gone through → duplicate payment. So: timeout/unknown outcome → mark the payout `needs_review` and message `dead`; don't auto-retry. Definitive failure (thrown error with a definitive rejection) → retry up to N times, then message `dead`, payout `failed`? But requirement 6: "retry a bounded number of times; if retries are exhausted without a definite outcome, do something safe and explain why."

   "Without a definite outcome" — so the ambiguity is about transient failures. Safe thing: don't release funds (keep them reserved), mark the payout `needs_review` / `dead-lettered`, alert a human. Explain in DESIGN.md: we can't know if the transfer happened; releasing funds risks double-pay or loss; keeping them reserved is conservative.

   Distinguish "definitive failure" from "unknown": the provider SDK "can throw, time out, or succeed slowly." How do I know a thrown error is definitive? Assume: the SDK throws `ProviderTransientError` (retryable) vs other errors (definitive failure) vs `TimeoutError`. In the plan I need to make this concrete: define that the provider is an injected interface `TransferProvider { transfer(req): Promise<{txHash}> }`; errors are classified by a `classifyProviderError(e): 'definitive' | 'unknown'` function; assumption: the SDK's errors have a `retryable: boolean` flag (or we treat all thrown errors as transient/retryable except a specific `ProviderRejectionError` (e.g. invalid destination) that is definitive). State the assumption: provider errors implement `{ retryable?: boolean }`; `retryable === true` or timeout → transient/unknown path; otherwise definitive.

   Bounded retries: `attempt_count` column on message (or the payout). Retry policy: transient error → increment attempt; if attempt < MAX (3) → message back to `pending` (retry later, or immediately); if exhausted → payout `needs_review`, message `dead`, funds stay reserved. Definitive error (e.g. invalid address) → payout `failed`, message `dead`, release funds? On definitive failure (transfer never happened, e.g. rejected before execution), releasing funds is safe: refund the reservation. Hmm — but requirement 6 says "do something safe" when exhausted without a definite outcome. Definitive failure is a definite outcome (failed). So:
   - Success → payout `sent` (record txHash), settle the ledger, message `sent`.
   - Definitive failure → payout `failed`, release reservation, message `dead`.
   - Transient/unknown exhausted → payout `needs_review`, keep reservation, message `dead`.
   What about a transient failure that exhausts after 2 retries without ever reaching a definitive "no"? Same as unknown-exhausted → needs_review. Good: any exhaustion → needs_review (safe), because transient errors could have been unknown outcomes.

   Actually the requirement is: "the provider may fail transiently. Retry a bounded number of times; if retries are exhausted without a definite outcome, do something safe." So: transient → retry up to MAX_ATTEMPTS (say 3 total). Exhausted → needs_review, keep funds reserved, dead-letter the message. Definitive failure (SDK explicitly rejects, e.g. invalid destination) → immediate failed + release, no retries. That's a sensible, safe split. DESIGN.md explains it.

5. **Payout state machine**:
   `created → processing → sent → completed`? The task says "created → processing → sent → completed / failed / needs_review, or equivalent." Let me simplify: `pending` (created) → `processing` (claimed by worker / transfer in flight) → `sent` (provider confirmed, txHash recorded) — is there a `completed` separate from sent? In crypto, "sent" with a txHash is effectively final if the provider only returns after confirmation. Let me define:
   - `created`: reserved, message pending.
   - `processing`: worker claimed the message; transfer may be in flight (not definitive).
   - `sent`: provider returned a txHash; ledger settled; message `sent`. Terminal (for the happy path).
   - `failed`: definitive rejection; reservation released; terminal.
   - `needs_review`: retries exhausted without a definite outcome; reservation held; terminal (until human intervention — no API for that; note in assumptions).
   Do I need `completed`? I can skip it — "or your own equivalent." I'll use 5 states: created, processing, sent, failed, needs_review. Clean.

   Transitions and where funds move:
   - created→processing: no funds change (reservation already at creation).
   - processing→sent: settled -= A, reserved -= A; ledger settle pair.
   - processing→failed: reserved -= A (release); ledger release pair.
   - processing→needs_review: no funds change (reservation held).
   State transitions must be guarded in the repository (UPDATE ... WHERE status = expected) so a duplicate delivery can't double-settle: e.g., the settle UPDATE has `WHERE payout_id = ? AND status = 'processing'` returning 0 rows if already sent. That's the duplicate-delivery safety: processing a message whose payout is already `sent` → skip (ledger/ledger settled idempotent).

   Duplicate delivery scenarios: message marked `processing` but the worker crashes before finishing; restart → claim only picks up `pending`... then stuck in `processing` forever. Need a lease/claim expiry, or: on startup requeue `processing` messages older than X. Or simpler: the worker claims pending, processes them one at a time, and only marks sent/dead after; if it crashes the message is stuck `processing` — for this plan, add a rule: the claim step also picks up stale `processing` messages (`claimed_at < now - STALE_MS`). Or even simpler: don't have an intermediate `processing` message state; leave messages as `pending` until terminal (`sent`/`dead`), and use at-least-once naturally: the worker selects pending, processes them, marks terminal. If it crashes mid-processing, the message stays pending → redelivered → duplicate delivery. This directly models "the worker may see the same message multiple times" without lease complexity! And the duplicate-safety burden falls on payout state guards.

   Then message table statuses: `pending` → `sent` | `dead`. Attempts counter on the message. Worker: fetch pending (limit N); for each: claim? If two workers... single-worker assumption. But even with one worker, if we process sequentially and mark terminal immediately after each, duplicates only happen on crash or explicit re-run (test calls processMessages twice — the second call finds none pending unless requeued). How does a test simulate duplicate delivery? By requeueing a message (setting status back to pending via repository) or by calling the worker's per-message handler twice. Test: "duplicate message delivery" — I'll design the service to expose `handleTransferMessage(message)` which is idempotent: if payout is already terminal (sent/failed/needs_review), return 'skipped'. Test calls the handler twice for the same message with a successful provider → assert ledger only settled once, payout is sent, no double ledger row.

   For the polling loop: NestJS worker — implement via a service that's started from a module's `onModuleInit`/`onApplicationBootstrap` with `setInterval`... but in tests, tests call `processMessages()` directly. The interval runner is a thin class (`PayoutWorker`) with `start(intervalMs)` / `stop()` and calls the service's `processMessages()`. Config from env var: `WORKER_POLL_MS`, default e.g. 1000. "Configuration from environment variables only" — env var with default is fine.

   Attempt count: store on the message (`attempt_count Int` default 0), increment per provider call (on transient error, when requeueing as pending). MAX_ATTEMPTS = 3 (constant or env var; keep constant in the plan, mention it's an assumption).

   Where does retry state live — message or payout? Message: `attempt_count`. Payout stays `processing`? If the message goes back to pending after a transient failure, what's the payout state? Leave it `processing`? But then "processing" is used for two meanings. Alternative: keep the payout at `created` until the worker claims it... Let me use states: `created` → (worker starts) `processing` → `sent`/`failed`/`needs_review`. On transient retry, payout stays `processing`, message goes back to `pending` with attempts+1. Duplicate delivery guard: `sent`/`failed`/`needs_review` are terminal; a redelivered message whose payout is terminal → skip. If the payout is `processing` and the message is redelivered (crash between claim and terminal) → re-invoke provider — risky? The provider might have succeeded (slow). Hmm — that's the "succeed slowly" hazard. If the first call timed out, the second call might double-pay. Mitigation in this plan: on transient error with unknown outcome (timeout), don't retry automatically — treat as unknown → needs_review. Then the only auto-retried errors are those that are definitely non-executing (e.g. SDK error saying "rejected before submit"). But can I trust that? The task says "the provider may fail transiently. Retry a bounded number of times" — so it asks for retry on transient failures. OK, simplest consistent model: all thrown errors are retryable (transient) up to 3 attempts; timeouts are also transient. Exhausted → needs_review + keep funds. If an error is classified `definitive` (invalid destination / provider says no) → immediate failed + release. The double-pay risk from slow success + retry is the inherent cost of at-least-once without provider idempotency keys; I'll state the assumption: "the provider SDK accepts an optional `idempotencyKey`" — wait, the task defines the SDK as `provider.transfer({to, amount}) -> {txHash}`. Don't extend it; state the assumption: if a transfer with an unknown outcome is retried and both succeed, the provider may send twice; to prevent this, treat timeouts as unknown → straight to needs_review without counting them against retries? Hmm, that contradicts "retry a bounded number of times" for transient.

   Let me cleanly separate error classes (assume the SDK's errors have a `retryable?: boolean` property, else throw a special error type I define):
   - Define the interface in plan: `TransferProviderError { retryable: boolean; code: string }` — no, I can't change the SDK. Assumption: the provider SDK's errors are plain `Error`s; we can't reliably classify → so treat all failures as transient, retry up to 3, then needs_review (safe). Additionally: we assume "succeed slowly" means the call eventually resolves; if it rejects, no tx was submitted... I'm overthinking for a planning doc.

   Decision: all provider errors are treated as transient (bounded retries, MAX 3). On exhaustion → `needs_review`, message `dead`, reservation held. DESIGN.md explains: we cannot distinguish "rejected" from "executed but unacknowledged"; retrying risks double-payment and releasing funds risks loss, so a human reviews. Also add an assumption line: no auto-classification of definitive rejection; if the SDK later exposes `retryable`, wire it into `classify` — no, keep the plan narrow: all errors are transient. Simpler and safe. But then "failed" state is never reached... The task lists `failed` in the lifecycle. Hmm. "Or your own equivalent" — I can keep `failed` as a state that's reachable for... non-provider failures? E.g. validation-like failures (payout destination became invalid?). Or a definitive provider rejection if the SDK throws an error with `name === 'ProviderRejectionError'`.

   Compromise: define a classification function `isDefinitive(e): boolean` in the service; assumption: SDK definitively-rejection errors are subclasses of `Error` with `code === 'REJECTION'` (assumed), else transient. State as an assumption: "provider definitively-rejection errors are marked with `code === 'REJECTION'` (invalid destination, etc.); everything else — including timeouts — is transient." That gets us a `failed` state (release funds, no retry) and the safe path for exhaustion. Good enough, one line.

   Wait, should `failed` (definitive) release funds? Definitive rejection = provider guaranteed the transfer didn't happen → releasing the reservation (funds back to available) is safe. Yes.

6. **API design**:
   - `POST /payouts` → 201 `{ payoutId, status, ... }`? Idempotent retry: client retries the same idempotencyKey → return the existing payout (201 or 200?). Common practice: return 200 with the same resource. State: first creation → 201; retry (same key) → 200 with the existing payout. Or always 201? Spec: retry returns existing payout's status (200). Keep it simple.
   - Errors: 400 invalid_body (bad shape, amount <= 0, bad address?), 404 resource_not_found (unknown accountId or... idempotency key belongs to a different account? If same key with different accountId → conflict 409 `idempotency_conflict`). Hmm — is that scope creep? It's a real idempotency-safety detail; one line in assumptions: same key + different accountId → 409. Include it, cheap.
   - `GET /payouts/:id` for lifecycle inspection? The task doesn't ask. "Do exactly what the task asks" — skip GET. But tests need to observe state — via repository/service directly in tests, fine. Manifest: only files I write; skip GET controller route.
   - Amount validation: integer minor units > 0, ≤ some cap? Validate: positive integer, no floats. Type in body: `amount` is a number (JSON) or string? Minor units can exceed 2^53 for huge amounts — safe to accept as string? Accept number but validate `Number.isSafeInteger` and > 0; assume realistic amounts fit safe integers (one line). Prisma BigInt: pass string/number to BigInt.

   Address validation: light — non-empty, length ≤ 128? Assume a format checker `isValidDestination(address): boolean` (non-empty, alphanumeric/hyphen, ≤ 128). One line assumption.

7. **Files / layout** (per conventions):
   - `prisma/schema.prisma`
   - `src/main.ts`, `src/app.module.ts`
   - Feature: name it `payouts`? Files:
     - `src/payouts/payouts.module.ts`
     - `src/payouts/payouts.controller.ts`
     - `src/payouts/payouts.service.ts`
     - `src/payouts/payouts.repository.ts`
     - `src/payouts/worker.service.ts`? Convention is `<feature>.<role>.ts` — roles: module, controller, service, repository. The worker is extra; name it `payouts.worker.ts` (class `PayoutWorker`) — the convention allows additional role files? Layout shows 4; worker needed ("NestJS modules: controller, service, worker"). I'll use `src/payouts/payouts.worker.ts`, class `PayoutWorker` (injectable, not a controller). Manifest lists it.
     - Provider interface: `src/payouts/transfer-provider.ts`, `TransferProvider` (interface) + a mock in tests. Or define in a separate `src/providers/transfer-provider.ts`? Keep in feature: `src/payouts/transfer-provider.ts` exports interface `TransferProvider` and maybe a `class MockTransferProvider`? The mock should live in tests. In production, an adapter — task says assume SDK; deliverables don't include an actual SDK adapter. Provide the interface + a `MockTransferProvider` in tests only? Then how is it wired in `app.module`? Need a provider token. `src/payouts/transfer-provider.ts` has the interface + a token constant `TRANSFER_PROVIDER` (or use the class as token). Wiring: module provides `{ provide: TransferProvider, useValue: ??? }` — without a real SDK, wire a stub adapter `provider-transfer-adapter.ts`? Scope creep. Assumption: in this repo, the app wires a `MockTransferProvider` from the test file? No — src must compile standalone. Minimal: `src/payouts/transfer-provider.ts` exports the interface and a minimal in-repo stub implementation `NoopTransferProvider`? Hmm.

   Let me keep it clean: `src/payouts/transfer-provider.ts`:
   ```ts
   export interface TransferRequest { to: string; amountMinorUnits: bigint }
   export interface TransferResult { txHash: string }
   export abstract class TransferProvider { abstract transfer(req: TransferRequest): Promise<TransferResult>; }
   ```
   Using an abstract class as a DI token is Nest-idiomatic. Then the module needs a concrete provider — I add `src/payouts/mock-transfer-provider.ts` (concrete, deterministic behavior via a `behaviors` queue? configurable with env vars?) — hmm "do exactly what the task asks": deliverables list controller, service, worker. But without a provider implementation, app.module can't instantiate the DI graph and we can't run tests against the real thing (tests can use an in-test mock via module overrides). Options:
   a) Tests use `Test.createTestingModule` and provide `{provide: TransferProvider, useClass: FakeProvider defined in test file}`. `src/payouts.module.ts` itself provides the mock? The Nest module can't provide an abstract class without a useValue. If `payouts.module.ts` doesn't provide it, `app.module.ts` imports payouts module and provides the token with a placeholder useValue? Ugly.
   b) Ship `src/payouts/fake-transfer-provider.ts`: a concrete class `FakeTransferProvider` that throws `NotConfiguredError` on transfer (clear "no real SDK" behavior). Wire it in app.module. Tests override with their own fake. That keeps DI complete, and one extra small file is justified because without it the app can't boot. Do (b), one line assumption.

   - Migrations: "every schema change ships with a migration." Prisma migrations are generated by CLI — the implementer has no tools? "The implementer of this document has no tools, no shell" — hmm, then how do they make a migration file? They have to hand-write the SQL migration. Manifest: `prisma/migrations/0001_init/migration.sql`. Hand-write it. Prisma also needs `prisma/schema.prisma` with a datasource url env var DATABASE_URL.

   Wait — the manifest example says `test/thing.test.ts`. Convention layout is `test/<feature>.spec.ts`. Test files: `test/payouts.spec.ts` (concurrent creation), maybe `test/duplicate-delivery.spec.ts`, `test/retry-exhaustion.spec.ts`? Manifest lists "only files you'll write." Tests can be multiple spec files. Conventions say `test/<feature>.spec.ts`. I'll write:
   - `test/payouts.spec.ts` — concurrency + idempotency + validation? Keep per-test-file purposes:
   - `test/concurrency.spec.ts`? Convention `<feature>.spec.ts` — maybe all in `test/payouts.spec.ts`. But clarity: 3 spec files: `test/payouts-creation.spec.ts`, `test/duplicate-delivery.spec.ts`, `test/retry-exhaustion.spec.ts`? The convention is pattern-based; multiple files matching `test/<something>.spec.ts` should be fine. Hmm "TS files: kebab-case.role.ts" — spec files in tests are role `spec`. `test/payouts.spec.ts` etc. I'll use three:
     - `test/payouts.spec.ts` — concurrent creation (no overdraw), idempotent retry, insufficient funds, validation.
     - `test/duplicate-delivery.spec.ts` — duplicate message delivery is idempotent.
     - `test/retry-exhaustion.spec.ts` — bounded retries → needs_review, funds held; definitive rejection → failed + release.
   - Test DB: real Postgres? Vitest + Prisma + Postgres — tests need a database. Assumption: tests run against a real Postgres instance (DATABASE_URL), with per-test cleanup (truncate). The alternative in-memory sqlite doesn't work well with BigInt ($db.BigInt) and raw SQL... Prisma's SQLite doesn't support $db.BigInt? (It maps BigInt to Int64... SQLite bigint is fine). But raw SQL RETURNING works in sqlite too. Still, real Postgres is assumed (task says PostgreSQL; concurrency test needs real DB semantics). One line assumption: tests use DATABASE_URL (Postgres) with cleanup between tests.

   - `DESIGN.md` at the repo root (short, 10–20 lines).

   Full manifest list:
   ```
   DESIGN.md | reads: - | ...
   prisma/schema.prisma | reads: - | ...
   prisma/migrations/0001_init/migration.sql | reads: prisma/schema.prisma | ...
   src/main.ts | reads: src/app.module.ts | boot
   src/app.module.ts | reads: src/payouts/payouts.module.ts, src/payouts/prisma.service.ts(?) | ...
   src/payouts/payouts.module.ts | reads: controller, service, repository, worker, provider files
   src/payouts/payouts.controller.ts | reads: service, dto?
   src/payouts/payouts.service.ts | reads: repository, provider interface
   src/payouts/payouts.repository.ts | reads: prisma client
   src/payouts/payouts.worker.ts | reads: service
   src/payouts/transfer-provider.ts | reads: - | interface
   src/payouts/fake-transfer-provider.ts | reads: transfer-provider.ts
   test/*.spec.ts (3) | reads: src files
   ```

   Prisma client access: the repository needs PrismaClient. NestJS: provide a `PrismaService` (`src/prisma.service.ts`? layout convention: shared files at src root? layout is feature-based; a shared Prisma service — `src/prisma.service.ts`? That breaks the `<feature>/` pattern but it's shared infrastructure. Common Nest pattern: `src/prisma.service.ts`. Hmm, the layout conventions block only shows feature structure; a shared `src/prisma.service.ts` is a reasonable choice — one line assumption. Or put PrismaClient instantiation inside the repository directly (`new PrismaClient()`)? Repository is "the only layer that touches the database" — instantiating PrismaClient in the repository constructor is literally following the layering, but then tests can't inject different clients... though env var switching would let me. But lifecycle (disconnect on shutdown) — Nest's `OnModuleDestroy`. PrismaService is cleaner and standard. I'll go with `src/prisma.service.ts` (class PrismaService extends PrismaClient, implements OnModuleInit/OnModuleDestroy), provided/exported by AppModule (or by PayoutsModule which imports AppModule's export? Wiring rules: "providers used in other modules are exports'd from their own module and that module is imports'd"). So AppModule provides + exports PrismaService; PayoutsModule imports AppModule. But main.ts imports AppModule and AppModule already imports PayoutsModule → circular module imports! Nest handles A imports B, B imports A cycles with forwardRef... cleaner: make a small `PrismaModule` (`src/prisma.module.ts`) that provides/exports PrismaService; both AppModule and PayoutsModule import PrismaModule. No cycle. Two small files: `src/prisma.module.ts`, `src/prisma.service.ts`. Good.

   Or skip PrismaModule: PayoutsModule imports AppModule for PrismaService, and AppModule imports PayoutsModule → forwardRef needed. Module structure with PrismaModule is cleaner. Include it.

   Validation: the controller validates input (zero business logic in controller — validation is allowed there). Manual check or class-validator? Adding a dependency (class-validator) — assume manual validation in the controller (no extra deps), one line. DTO types: define interfaces in `payouts.controller.ts`? Export types — the plan requires "all exported types." I'll define in the service file or a dedicated file: `src/payouts/dto.ts`? The naming convention `kebab-case.role.ts`... "dto" isn't in the listed roles but layout allows it. To minimize files, put `CreatePayoutBody` and response types in the controller file? The service also needs them (createPayout takes a typed input). Shared types between controller/service → put in `src/payouts/payouts.service.ts`? Controller imports from service file — acceptable (controller reads service). Export `CreatePayoutInput`, `PayoutResponse` from the service file. Hmm, or a types file `src/payouts/types.ts` — the role name "types" is fine kebab. I'll use `src/payouts/types.ts` for shared domain types (statuses, input/output, provider contract?). Provider interface stays in transfer-provider.ts. types.ts holds: `PayoutStatus` union, `CreatePayoutInput`, `PayoutView` (response shape), `MessageStatus`, `LedgerEntryType`. Good.

   Error envelope: how are errors thrown? Assume a shared `ApiError` class in `src/api-error.ts` with `{ code, message, details }`, and a global exception filter in `src/main.ts` (or app module) that maps ApiError → 4xx/5xx envelope, and unknown → 500 `internal_error`. Mapping: resource_not_found→404, invalid_body→400, idempotency_conflict→409, insufficient_funds→422 (or 409/400 — pick 422? Common: 400. Use 422 for insufficient funds? Hmm — funds insufficient is a domain condition; 409 conflict or 422 unprocessable. State: insufficient_funds → HTTP 422). The filter file: `src/main.ts` can hold the filter inline? Better a separate small file `src/app.exception-filter.ts`? Adding files... Or put the filter class in app.module.ts? Convention files listed are minimal, but "do not create files not requested" — needed infrastructure files for the task are fair game; keep count low.

   Decisions:
   - `src/api-error.ts`: `class ApiError extends Error { constructor(code, message, details, httpStatus) }`. Read from main.ts's filter and services/controllers.
   - `src/main.ts`: bootstrap + `app.useGlobalFilters(new ApiErrorFilter())` — define filter in main.ts? Filter is 15 lines; putting it in main.ts is acceptable and saves a file. Or the filter reads api-error only, so define it in `src/main.ts`. OK.
   - Prisma unique-constraint violations (idempotency race): repository catches P2002 and returns the existing payout (service translates duplicate on creation → existing lookup). Concurrent same-key POSTs: both attempt INSERT; one wins; the loser gets P2002 → repository does a findUnique by key and returns it (within the same transaction? After commit, do it outside). Race-safe.

   Insufficient funds error from conditional UPDATE returning 0 rows → service throws ApiError('insufficient_funds', 422).

   Unknown accountId → check first (or catch P2025 FK violation): the service checks account existence in the same transaction before the reservation UPDATE (read then conditional update — read is fine, the guard is on the UPDATE).

8. **Transaction boundaries**:
   - Creation: single `$transaction`: (a) look up account by id (404 if missing); (b) unique lookup on idempotency_key — if exists: validate account match (409 if different), return existing payout (transaction can commit no-op); (c) conditional UPDATE that reserves; (d) INSERT payout with status 'created'; (e) INSERT message pending; (f) INSERT reserve ledger pair. All-or-nothing. Then return payout view (201 or 200 — the service distinguishes created vs existing → controller picks status code).
   - Worker per message (per payout): a single `$transaction` for each DB phase? Flow: claim? Since messages stay pending until terminal (no in_flight state), "claim" = nothing; but two simultaneous workers could double-process — single-worker assumption (only one interval loop). Within processMessages: for each pending message (batch, sequential):
     1. Read payout+message (pending). If payout is terminal → mark message `sent`? No — if payout is sent then the message should already be sent; redelivery in terminal state means we just mark dead/skip: mark message with final status consistent (sent if payout sent, else dead) — "skip (no-op)."
     2. payout → processing guarded UPDATE (`WHERE status='created'` → 'processing'; if it was already processing from a previous crashed attempt — allow: `WHERE status IN ('created','processing')`).
     3. Provider call — outside the DB transaction (no long-held tx during a network call!). Important boundary: no open transaction around provider.transfer. So: tx1 (claim: mark processing + read) → provider call (no tx) → tx2 (apply outcome).
     4. Outcome: success → guarded UPDATE payout processing→sent + txHash; settle ledger pair; accounts settled/reserved -= A (guarded: reserved >= A); message → sent. Definitive → payout processing→failed; release ledger pair; reserved -= A; message dead. Transient with attempts+1 < MAX → message stays pending (UPDATE attempt_count+1); payout stays processing. Transient with attempts+1 >= MAX → payout → needs_review; message dead (hold reservation).
     The accounts UPDATE in tx2 uses the same guarded arithmetic: `UPDATE accounts SET settled_minor_units = settled_minor_units - $1, reserved_minor_units = reserved_minor_units - $1 WHERE account_id=$2 AND settled_minor_units >= $1 AND reserved_minor_units >= $1`.
   - What must not be inside a transaction: provider network call, retries/loops over multiple messages? Each message's tx2 is separate; processMessages loops sequentially (no inter-message parallelism — simpler, avoids concurrent double-claim; note it).

   Duplicate-delivery safety: every mutation is a guarded UPDATE with status precondition + a unique payout per message; reprocessing a terminal payout → no-op skip (mark message appropriately? If a payout is 'sent' and the message is still pending (crash after tx2? no — tx2 sets both payout and message atomically, so the pending+sent combination cannot exist post-commit; a crash before tx2 leaves payout 'processing' + message pending → redelivery: guarded UPDATE created|processing→sent works, but is re-calling the provider safe? Payout is processing and the previous provider call might have succeeded (unknown outcome — that's the retry hazard, addressed by bounded retries + needs_review). Within a single redelivery where the payout is 'processing' — re-call the provider: acceptable under the bounded-attempt model (each redelivery increments attempt_count... but wait, attempts only increment on transient errors; a successful first call that crashed before tx2 has attempt=0, redelivery → success → settled once thanks to guarded status (second attempt can't settle again). Duplicate ledger row? Ledger rows are inserted in tx2 only on successful guarded UPDATE → once. Good: the guard is `UPDATE payouts ... WHERE status IN ('created','processing')` returning rowsAffected; if 0 → skip. This also covers double-settle: only the first tx2 wins.)

   But the ledger INSERT + accounts UPDATE + payout UPDATE are one transaction, and the decision to proceed is "guarded UPDATE won" — all-or-nothing within that tx.

   Edge: redelivery when the payout is 'processing' but the in-flight provider call from the previous incarnation is still running (slow success)? Single-worker sequential loop → no overlap. Only cross-restart case: process crashes, old call still in flight? If process is dead the call is dead too. If it times out → reject path (counts as a transient attempt). Fine under assumptions; note in DESIGN.md briefly? Keep DESIGN to 10-20 lines focused on fund safety.

9. **Types and signatures** (section 3) — let me enumerate:

   `src/payouts/types.ts`:
   ```ts
   export type PayoutStatus = 'created' | 'processing' | 'sent' | 'failed' | 'needs_review';
   export type MessageStatus = 'pending' | 'sent' | 'dead';
   export type LedgerEntryType = 'reserve' | 'settle' | 'release';
   export type HouseAccount = 'payouts_pending';  // hmm, I might drop house accounts in favor of simpler pairs?
   ```

   Wait, let me reconsider the ledger design once more. Simpler double-entry that's easier to specify:

   `ledger_entries`:
   - `entry_id: uuid PK`
   - `payout_id: uuid FK not null`
   - `side: 'debit' | 'credit'`
   - `ledger_account: text not null` — one of the house codes `'customer:<accountId>'`? Ugly.

   Alternative clean model: each event writes two entries referencing named accounts from a fixed set per payout: the customer's accountId and a house suspense 'payouts_pending':
   - reserve: credit `payouts_pending` (we owe the customer? ...) — the debit/credit semantics on assets vs liabilities confuse; to keep the plan unambiguous, I'll specify **with signed deltas instead of debit/credit**:
   
   `ledger_entries`:
   - `entry_id: uuid PK`
   - `payout_id: uuid FK not null`
   - `ledger_account: text not null` (customer's accountId or `'payouts_pending'`)
   - `delta_minor_units: bigint not null` (signed)
   - `entry_type: 'reserve' | 'settle' | 'release' not null`
   - `created_at timestamptz`

   Rules (each payout writes exactly one balanced pair per transition, sum of pair deltas = 0):
   - reserve: (customer, −A) & ('payouts_pending', +A)
   - settle: (customer, −A)? no wait. If reserve already moved customer −A, then settle moves the suspense money out: ('payouts_pending', −A) & (house 'payouts_paid'? need a third account: `'payouts_out'`).

   Ugh — the customer's ledger balance moves at reserve time. And the requirement: "The account's settled balance changes only when the provider confirms a transfer." The `accounts.settled_minor_units` column doesn't change at reserve (only the derived available does). But a customer ledger entry at reserve time is... The requirement targets the balance/ledger's *settled* semantics. Let me define ledger accounts precisely to align:

   Ledger accounts (ledger_account values):
   - Customer's own `accountId` = customer's settled-funds account.
   - `'pending_payouts'` = suspense: money reserved for in-flight payouts (belong to customer but quarantined).
   - `'paid_out'` = house: money that has left via confirmed transfers.

   Entries (delta, signed):
   - reserve: customer −A, pending_payouts +A. (Customer's ledger available drops; accounts column: reserved += A, settled unchanged — the requirement is about the settled balance, which doesn't move. I'll state explicitly: "settled_minor_units never changes on reserve; only available (derived) changes.")
   - settle: pending_payouts −A, paid_out +A. And `accounts.settled_minor_units −= A; reserved −= A`.
   - release: pending_payouts −A, customer +A. And `accounts.reserved −= A`.

   Invariants (stated in the plan):
   - For each payout, for each entry_type present, exactly 2 rows, deltas +A/−A summing to zero.
   - For a customer: initial set − Σ(reserve) + Σ(release) = derived available; accounts.settled_minor_units = initial − Σ(settle) (in our scope, no top-ups... actually settle decrements settled; reserve doesn't. So `settled_minor_units = seeded_initial − Σ(settle rows for customer)` — wait, settle moves pending→paid_out, and settled column decrements separately. The double-entry bookkeeping shows pending_payouts holding the reserve; the settled column mirrors it: settled + reserved... hmm, customer ledger balance = initial −Σreserve +Σrelease = settled_minor_units − Σsettle? Let me verify: settled column = initial − Σ(settle). Reserved column = Σ(reserve) − Σ(settle) − Σ(release). Customer ledger delta = initial − Σres + Σrel. But settled+reserved = initial − Σset − Σres + Σset + Σrel = initial − Σres + Σrel ✓. So customer ledger balance = settled + reserved = "money still in the customer's book (available + reserved)." Nice — consistent: total money for the customer on our books. paid_out = Σsettle = total actually sent. pending_payouts balance = Σres − Σset − Σrel = total reserved in-flight ✓.
   
   I'll state 2–3 invariant lines. That's genuinely double-entry (balanced pairs, conservation) and aligns with the requirement wording: the settled balance column changes only on settle.

   Prisma BigInt for delta (signed OK), amount stored as bigint in payout.

   Now signatures:

   `src/payouts/transfer-provider.ts`:
   ```ts
   export interface TransferRequest { to: string; amountMinorUnits: bigint }
   export interface TransferReceipt { txHash: string }
   export abstract class TransferProvider {
     abstract transfer(req: TransferRequest): Promise<TransferReceipt>;
   }
   ```
   (abstract class as DI token; note: errors thrown by concrete implementations are classified in the service.)

   `src/payouts/fake-transfer-provider.ts`:
   ```ts
   export class FakeTransferProvider extends TransferProvider {
     constructor(options?: { failWithDefinitive?: boolean; rejectFirstN?: number })  // hmm, keep it simple:
   ```
   Simpler: FakeTransferProvider always throws `new Error('transfer not configured')`. One method. That's it.

   Actually maybe the fake should just throw to make the app "work" — fine: `transfer()` rejects with an Error('no real provider configured').

   `src/api-error.ts`:
   ```ts
   export type ApiErrorCode = 'invalid_body' | 'resource_not_found' | 'insufficient_funds' | 'idempotency_conflict' | 'internal_error';
   export class ApiError extends Error {
     readonly code: ApiErrorCode; readonly details: Record<string, unknown>; readonly httpStatus: number;
     constructor(code: ApiErrorCode, message: string, httpStatus: number, details?: Record<string, unknown>);
   }
   ```

   `src/prisma.service.ts`:
   ```ts
   export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
     async onModuleInit(): Promise<void>;
     async onModuleDestroy(): Promise<void>;
   }
   ```
   (imports PrismaClient from '@prisma/client'.)

   `src/prisma.module.ts`: `export class PrismaModule { providers: [PrismaService]; exports: [PrismaService]; }`

   `src/payouts/payouts.repository.ts`:
   ```ts
   export class PayoutsRepository {
     constructor(prisma: PrismaService);
     // creation (single transaction)
     createPayout(input: CreatePayoutInput): Promise<PayoutRecord & { created: boolean }>;
     // worker
     findPendingMessages(limit: number): Promise<MessageRecord[]>;
     markProcessing(payoutId: string): Promise<boolean>;      // guarded created|processing -> processing; false if terminal
     completeWithTxHash(payoutId: string, txHash: string): Promise<boolean>; // guarded processing -> sent + settle ledger + decrement account + message sent
     failDefinitive(payoutId: string, reason: string): Promise<boolean>;   // guarded processing -> failed + release ledger + reserved-=A + message dead
     recordTransientAttempt(payoutId: string): Promise<boolean /* hasMoreRetries */>; // attempt_count+1, message stays pending; returns attempts < MAX
     exhaustRetries(payoutId: string): Promise<boolean>; // guarded processing -> needs_review + message dead, no fund movement
     recordSentOutcome?? — consolidated into completeWithTxHash.
   }
   ```
   Hmm, "retry" — after transient error with attempts remaining: message stays pending, payout stays processing. `recordTransientAttempt` returns the new attempt count; service decides. MAX_ATTEMPTS constant — where? `src/payouts/payouts.constants.ts`? Another file... Put constants in types.ts? A constant file is cheap but "don't create files not requested" — a constants export from `types.ts` is fine (call it domain types and constants). Or define MAX in the service file. I'll export from `types.ts`: `export const MAX_TRANSFER_ATTEMPTS = 3;` with a comment. OK.

   Records: define read shapes? The repository returns Prisma models — but the plan says "all exported types." I can reference the generated Prisma models (Payout, Message, LedgerEntry, Account) as return types — they exist in '@prisma/client' via schema. Name them: repository methods return `Promise<Payout>`, `Promise<Message>` from '@prisma/client' (generated). That's resolvable: generated client. Good — avoids duplicating row types.

   `src/payouts/payouts.service.ts`:
   ```ts
   export interface CreatePayoutInput { accountId: string; amountMinorUnits: bigint; destinationAddress: string; idempotencyKey: string; }
   export interface PayoutView { payoutId: string; accountId: string; destinationAddress: string; amountMinorUnits: bigint; idempotencyKey: string; status: PayoutStatus; txHash: string | null; }
   export class PayoutsService {
     constructor(repo: PayoutsRepository, provider: TransferProvider);
     createPayout(body: { accountId?: unknown; amount?: unknown; destinationAddress?: unknown; idempotencyKey?: unknown }): Promise<PayoutView & { created: boolean }>;
     // hmm — controller validates, service receives typed input. So:
     createPayout(input: CreatePayoutInput): Promise<{ payout: PayoutView; created: boolean }>;
     processMessages(limit?: number): Promise<{ processed: number; skipped: number; dead: number }>; // summary for logging/testing
     handleMessage?(internal) — keep private; tests test duplicate delivery via processMessages + requeue?
   }
   ```

   How does a test simulate duplicate delivery? If the worker leaves messages pending until terminal and processMessages picks them up, then to force duplicate: test directly requeues... or design: worker `processMessages()` claims with a lease: message gets `claimed_at` + status 'processing'? Earlier I decided to keep pending to model duplicates. For a *testable* duplicate-delivery, cleanest is: expose the per-message handler as public on the service: `processMessage(messageId: string): Promise<'transferred'|'skipped'|'retried'|'dead'>`. Tests call `processMessage(id)` twice (with a provider fake that counts calls) → second call skips because payout is terminal → assert ledger only settled once, provider called exactly... wait, on a redelivery where payout is already 'sent', the handler must not call provider again (skip first, check state). So assert provider.transfer called once.

   And processMessages(): fetch pending → for each, processMessage (sequential). Worker interval calls processMessages.

   Duplicate case where payout is 'processing' (crash after markProcessing, before tx2): redelivery calls provider again (attempt). That's the at-least-once semantics; fine.

   Controller:
   ```ts
   export class PayoutsController {
     @Post('payouts') create(@Body() body: Record<string, unknown>): Promise<{ status, body }>?
   ```
   Nest controllers return the object; HTTP code via @HttpCode. Signature: `create(body: CreatePayoutBody): PayoutView` with `@HttpCode(201)`... idempotent retry is 200 vs created 201 — needs dynamic code → controller sets via Response param or throw? Use `@Res({ passthrough: true }) res: Response; res.status(created ? 201 : 200)`. Return PayoutView. Controller validation: body shape, accountId non-empty string, amount positive safe integer, destinationAddress valid per `isValidDestination` (where? helper in the controller file or service? "Controller validates input" → put `isValidDestinationAddress` in the controller file (local, not exported? plan section 3 covers exports; local helpers can be mentioned in the control flow). idempotencyKey non-empty string ≤ 128.

   `src/payouts/payouts.worker.ts`:
   ```ts
   export class PayoutWorker implements OnApplicationBootstrap, OnApplicationDestroy {
     constructor(service: PayoutsService);
     onApplicationBootstrap(): void;  // setInterval(() => void this.service.processMessages(), pollMs)
     onApplicationDestroy(): void;    // clearInterval
   }
   ```
   pollMs from env var `PAYOUT_WORKER_POLL_MS`, default 1000 — read in worker (env var is configuration). One line assumption.

   `src/payouts/payouts.module.ts`: imports PrismaModule; providers: PayoutsRepository, PayoutsService, PayoutWorker, { provide: TransferProvider, useClass: FakeTransferProvider }; controllers: [PayoutsController]; exports: [PayoutsService] (tests? not strictly required — tests build their own testing module; but exporting service is harmless; keep exports minimal: none needed. "Providers used in other modules are exports'd" — only PrismaService crosses modules. PayoutsModule exports: none.)

   `src/app.module.ts`: imports PrismaModule, PayoutsModule.
   `src/main.ts`: NestFactory.create(AppModule), global filter for ApiError, listen on env var PORT default 3000.

   Exception filter: class in main.ts `class ApiEnvelopeFilter implements ExceptionFilter` — local (not exported) fine? "All exported types... every error and what raises it" — filter is internal; mention in control flow. Hmm, better exported for tests? Tests can assert envelope via supertest through the HTTP layer — fine.

   PrismaClient generated model names: `Account`, `Payout`, `Message`, `LedgerEntry` (model LedgerEntry). @map to table: accounts, payouts, messages, ledger_entries.

   Columns:
   - accounts: account_id uuid PK default random_uuid? `@default(uuid())`, created_at timestamptz, settled_minor_units bigint default 0, reserved_minor_units bigint default 0. Constraint: reserve update guards non-negative reserved (WHERE checks).
   - payouts: payout_id uuid PK, account_id FK, idempotency_key text, destination_address text, amount_minor_units bigint, status text default 'created', tx_hash text null, failure_reason text null (for failed/needs_review? add `note`?), created_at, updated_at. @@unique([idempotency_key]). Should idempotency be unique per (account, key)? I said same key different account → 409 conflict; globally-unique key is simpler and safer.
   - messages: message_id uuid PK, payout_id FK unique not null, topic text default 'payout.transfer', payload jsonb? Prisma Json. Payload: { accountId, destinationAddress, amountMinorUnits } — redundant with payout but message should be self-contained (at-least-once, decoupled). status text default 'pending', attempt_count int default 0, created_at, updated_at. Index on status.
   - ledger_entries: entry_id uuid PK, payout_id FK not null, ledger_account text, entry_type text, delta_minor_units bigint, created_at. Index on (payout_id), (ledger_account).

   Migrations: `prisma/migrations/0001_init/migration.sql` — hand-written SQL matching the schema (CREATE TABLE, unique constraints, indexes). Migration naming: folder `0001_init` is fine (prisma CLI uses timestamps but any name works; implementer has no tools → fixed name is good).

10. **Section 2 data model** — table + column spec, and ledger invariants.

11. **Section 4 control flow** — state machine table + transactions:
    - Creation tx: steps, guard semantics (conditional UPDATE for reservation; P2002 handling), what it returns.
    - No-DB / provider call boundary: tx1 markProcessing → provider.transfer (outside any tx) → outcome tx2.
    - Outcome tx (each guarded by status precondition; if guard fails, skip = duplicate already handled).
    - processMessages loop: fetch pending batch (limit 20?), sequential.
    - Rules on ordering: "message is marked dead only in the same transaction as its payout's terminal status; ledger rows are appended in the same transaction as account balance changes; a new message is never created after a payout exists (unique FK)." Ordering rule between two operations: e.g. reserve must precede message insert? Same tx — order within tx doesn't matter atomically, but I'll state: "Payout row and message row are committed together; no intermediate observation is possible." Ordering between operations that "could be written in either order" — e.g. "accounts set and ledger append: same transaction; the guard on accounts UPDATE is authoritative — if 0 rows affected, abort the tx (shouldn't happen post-reserve; defensive)." Also "txHash recorded only with transition to sent." "Marking a message dead/sent only after its payout has reached the corresponding terminal state, atomically."

12. **Section 5 tests** — one line each:
    - Concurrent creation (N=20 parallel POSTs/repo calls against one account with funds for 5): exactly 5 created, no overdraw (available = 5A − 5A...), available balance non-negative, ledger balanced.
    - Idempotent retry: same key twice → 1 payout, reserve once; concurrent same-key (20 parallel) → 1 payout.
    - Insufficient funds: request for more than available → insufficient_funds, no row.
    - Unknown account → resource_not_found.
    - Validation: negative/zero/floating-point amount, missing fields → invalid_body 400.
    - Same key different account → idempotency_conflict 409.
    - Happy worker: pending message → provider success → payout sent, txHash set, settled/reserved decremented, settle ledger pair, message sent.
    - Duplicate delivery: requeue / call handler twice → provider called once per unique in-flight, ledger settled once, payout sent; calling processMessage again after sent → skipped, no provider call.
    - Transient retries: provider fails 2x transient then succeeds → payout sent, attempt_count=2, message sent.
    - Retry exhaustion: provider always throws → after 3 attempts payout needs_review, message dead, reservation held (reserved still A, settled unchanged).
    - Definitive rejection: provider error with code 'REJECTION' → payout failed, message dead, funds released (reserved back to 0).
    - Insufficient at settle? skip.
    - Ledger invariants after each scenario: pairs balanced (assertable via repository sum) — fold into scenarios.

    Keep to ~10–12 lines, grouped by spec file.

13. **Section 1 assumptions** (one line each):
    - Accounts pre-exist (seeded); POST on unknown account → resource_not_found 404.
    - JSON body `amount` is a number validated as a positive safe integer (minor units); stored as BigInt.
    - Idempotency key is globally unique; same key with a different accountId → 409 idempotency_conflict.
    - A single polling worker instance (no concurrent workers); duplication is at the message level (crash/requeue), guarded by status preconditions.
    - Provider errors: definitively-rejection has `code === 'REJECTION'` (or name) — I'll assume: error objects may have a string `code`; `code === 'REJECTION'` = definitive (funds released); anything else including timeouts = transient → bounded retries.
    - MAX_TRANSFER_ATTEMPTS = 3 (total provider calls per message), constant in types.ts.
    - Post-exhaustion safe action: `needs_review`, keep reservation (DESIGN.md).
    - No human-resolution API (out of scope); needs_review is terminal for the system.
    - Tests run against a real Postgres at DATABASE_URL, tables truncated between tests.
    - No extra validation deps (class-validator); manual checks in controller.
    - Real provider SDK adapter out of scope; `FakeTransferProvider` (always rejects) wired in AppModule so the DI graph can boot.
    - Worker poll interval from env var `PAYOUT_WORKER_POLL_MS` (default 1000); tests call processMessages directly.
    - `GET /payouts/:id` not in scope (lifecycle inspectable in DB/tests).
    - HTTP: created → 201, idempotent retry → 200 same body. insufficient_funds → 422.
    - Shared Prisma client via `src/prisma.service.ts` + `src/prisma.module.ts`.

    A lot of lines but each is one line. The section says "decisions the task leaves open, with the choice and a one-line why." Fine.

14. **Manifest** — ordering: each file may only read files listed above it. Let me order:
    ```
    DESIGN.md | reads: - | rationale for fund safety (10–20 lines)
    prisma/schema.prisma | reads: - | data model (accounts, payouts, messages, ledger_entries)
    prisma/migrations/0001_init/migration.sql | reads: prisma/schema.prisma | DDL matching the schema
    src/api-error.ts | reads: - | ApiError + codes
    src/transfer-provider.ts? — I said src/payouts/transfer-provider.ts. Ordering:
    src/payouts/types.ts | reads: - | status unions, input/view types, MAX_TRANSFER_ATTEMPTS
    src/payouts/transfer-provider.ts | reads: - | TransferProvider abstract + req/receipt
    src/prisma.service.ts | reads: - | PrismaClient lifecycle
    src/prisma.module.ts | reads: src/prisma.service.ts | module wiring
    src/payouts/fake-transfer-provider.ts | reads: src/payouts/transfer-provider.ts | bootable stub provider
    src/payouts/payouts.repository.ts | reads: src/prisma.service.ts, src/payouts/types.ts | all DB access
    src/payouts/payouts.service.ts | reads: src/payouts/payouts.repository.ts, src/payouts/transfer-provider.ts, src/payouts/types.ts, src/api-error.ts | business logic
    src/payouts/payouts.controller.ts | reads: src/payouts/payouts.service.ts, src/payouts/types.ts, src/api-error.ts | POST /payouts + validation
    src/payouts/payouts.worker.ts | reads: src/payouts/payouts.service.ts | polling loop
    src/payouts/payouts.module.ts | reads: controller, service, repository, worker, fake provider, prisma module | feature wiring
    src/app.module.ts | reads: src/payouts/payouts.module.ts, src/prisma.module.ts | root module
    src/main.ts | reads: src/app.module.ts, src/api-error.ts | bootstrap + error envelope filter
    test/payouts.spec.ts | reads: many src | ...
    test/duplicate-delivery.spec.ts | reads: ...
    test/retry-exhaustion.spec.ts | reads: ...
    ```
    Tests read src files — tests are listed last so "files listed above it" is satisfied.

    Tests read: `src/app.module.ts`? or build a module with overrides (Test.createTestingModule with providers, fake provider). Read: src/payouts/*, src/prisma.module.ts, prisma/schema.prisma (types)? Keep reads as: `src/payouts/payouts.service.ts | src/payouts/payouts.repository.ts | src/prisma.module.ts | src/payouts/transfer-provider.ts | prisma/schema.prisma`? Reads = files the implementer needs to look at. Reasonable.

    Hmm wait: `test/payouts.spec.ts` per convention is `test/<feature>.spec.ts` ✓.

    Also: `package.json` / `tsconfig.json`? "List only files you'll write" — the repo probably has scaffolding? No guarantee. The manifest says copy the shape with files I write. Config files: are they in scope? Convention: pnpm, NestJS project — assume an existing project scaffold with dependencies (package.json present) — but the repo has `src/main.ts`, `src/app.module.ts` as layout items, meaning I do write them. Config: assume existing scaffold has package.json/tsconfig with Nest/Prisma/Vitest deps; state in assumptions: "Project scaffold (package.json, tsconfig, vitest config) already exists with the needed deps; we don't create/modify them." Good — one line, avoids config scope.

15. **Section 3 completeness** — "every ordering rule between two operations that could be written in either order":
    - Within creation tx: reservation UPDATE must execute before the payout/message INSERTs (guard drives 422).
    - Worker: markProcessing (tx1) before provider call; outcome tx2 after; ledger append + account decrement + payout transition + message terminal status in one tx2.
    - `processMessages` handles one message fully (terminal or requeue) before the next.
    - On idempotent retry: if a key exists, no new reservation/message — read-then-insert must be race-safe via unique constraint (P2002 → return existing), so two racers don't both reserve.
    - Release vs settle: a payout can only receive release via the 'failed' path and settle via the 'sent' path; guarded status makes it impossible for both to apply.

    Every error and what raises it:
    - invalid_body (400): controller — missing/wrong-typed/zero/negative/non-integer amount, empty accountId/address/key, address too long.
    - resource_not_found (404): service createPayout — accountId unknown.
    - insufficient_funds (422): service — reservation UPDATE affects 0 rows (account exists but available < amount).
    - idempotency_conflict (409
