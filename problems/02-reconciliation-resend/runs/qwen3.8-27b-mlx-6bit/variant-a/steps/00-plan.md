# plan

## reply

Let me carefully consider this task.

The task: Write a `PLAN.md` for Variant A — instant-payment payout reconciler. TypeScript + NestJS + Prisma + Postgres.

Requirements:
1. `executePayments()` — send pending orders via `bank.send({txid, amount, key})`. The txid is deterministically derived from order + valid date.
2. `reconcile(window)` — match entries in the statement to orders, advance state. Safe to run every 15 minutes, even with overlapping windows.
3. Resend logic: an order whose send failed/timed out can only be resent once reconciliation proves it doesn't exist in the statement past the publish lag. Max 5 attempts; after that, park for manual review, never auto-revert.
4. Classify `bank.send` responses (accepted, duplicate, transient error, permanent rejection) and handle each.

Deliverables: schema, service, reconcile job, tests covering the following: timeout but settled (no resend), proven absent (resend with same txid), attempt-count exhaustion. Money is integer minor units only.

Conventions from the codebase:
- NestJS, Prisma, Postgres, Vitest, pnpm, ESM.
- Layout: `prisma/schema.prisma`, `src/main.ts`, `src/app.module.ts`, `src/<feature>/<feature>.module.ts`, controller, service, repository, `test/<feature>.spec.ts`.
- Layers: controller validates and calls service; service has the logic with zero raw SQL / Prisma client calls… wait, "zero raw SQL, zero Prisma client calls" — hmm, so the service doesn't touch Prisma at all? Then the repository is the only layer that touches the DB. So the service calls the repository, and the repository uses Prisma. Wait, but usually in NestJS you inject PrismaService. The convention says "repository is the only layer that touches the database." So the repository uses Prisma. The service never calls Prisma directly.

Hmm, actually rereading: "service has the logic. Zero raw SQL, zero Prisma client calls." So the service never uses Prisma directly — everything goes through the repository. OK.

- Naming: table/columns are snake_case via @map/@@map. Endpoints kebab-case plural. TS files kebab-case.role.ts. Classes PascalCase.
- Errors: single envelope `{ error: { code, message, details } }`. Code snake_case.
- Wiring: providers, exports, imports.
- Migrations: every schema change ships with a migration. So `prisma/migrations/<timestamp>_name/migration.sql`? The manifest lists only files I write. Should I list the migration SQL file? Probably — the deliverables say "deliver schema, service, reconcile job, tests." The migrations section says every schema change ships with a migration. So I should include the migration SQL file in the manifest. But the implementer might run `pnpm prisma migrate dev`. I could list `prisma/migrations/20240101000000_init/migration.sql`. The path has to be deterministic… I'll include a migration directory with the SQL in it. Let's use `prisma/migrations/20240101000000_init/migration.sql`.

- Tests: Vitest, test behaviour.
- Environment: config from env vars only; DATABASE_URL.

Now the plan document must have exactly 6 sections in order, nothing else:
1. Assumptions — decisions the statement leaves open. Pick and a one-line reason.
2. Data model — every table with columns and types.
3. Types and signatures — every exported type, interface, enum, class, function signature. Every error and what raises it. Ordering rules between two operations that might be written in either order.
4. Control flow — state machine, transaction boundaries, what's inside each and must not be inside. Prose or table, no code.
5. Tests — one line per test.
6. Manifest — machine-readable block in exact shape.

Key design decisions to make (assumptions):
- Bank API is out of scope; define a `BankClient` interface with `send(payment)` and `getStatement(date)`. Provide a fake in tests. The task says "the bank exposes getStatement(date)". So we define a port + inject a stub.
- txid derivation: deterministic from order + valid date. E.g., `sha256(order.id + ':' + effectiveDate.toISOString().slice(0,10))`? Or a simpler scheme: `${orderId}:${effectiveDate}` hashed. Must be deterministic and stable so resends use the same txid. Definition: txid = lowercase hex of first 16 bytes of sha256 of `${order.id}|${effectiveDate}`, where effectiveDate is `YYYY-MM-DD`. Or even simpler: no crypto, txid = `${orderId}-${effectiveDateCompact}`? "derived deterministically" — a hash is fine and typical (txids are opaque). Let's pick: `deriveTxid(orderId, effectiveDate): string` = sha256(`${orderId}:${effectiveDate}`) hex (64 chars). Effective date is the order's payment date (a `date` field on orders, YYYY-MM-DD string or Date in UTC). Let's make it `effectiveDate: Date` (UTC date). For determinism, store the string derived from UTC.

- Order state machine: `pending` → `sent` (accepted) → `settled` (matched in statement). Failure: `pending` → `failed_transient`? Let me think.

States:
- `PENDING`: not yet attempted, or attempt failed transiently and eligible for retry after proof of absence.
- `SENT`: send returned accepted; awaiting statement entry.
- `SETTLED`: matched in statement. Terminal (success).
- `REJECTED_PERMANENT`: bank permanently rejected; terminal, never auto-retry, no resend. Park for manual review? The task says: after 5 attempts "park for manual review and never auto-revert." Permanent rejection — the bank said no; resending with the same txid would likely be rejected again. But maybe a different txid? No — txid is deterministic from order + date; changing the date changes txid, meaning double-payment risk. Safest: permanent rejection is terminal, park for manual review, no auto-retry. I'll decide that.
- `MANUAL_REVIEW` / `PARKED`: attempts exhausted (5 failed transient) and still proven absent, or some other stuck case. Terminal from the automation's perspective; never auto-revert (no state machine ever moves it back automatically).

Let me define attempts semantics: `attemptCount` is incremented on every `bank.send` call (accepted, duplicate, transient, permanent?). Hmm — "cap attempts at 5". Count sends to bank. Accepted send = attempt used, but order is SENT so no more resends needed unless it doesn't settle? What about a case where send accepted but entry never appears in statement? That's bank-side failure; out of scope beyond manual review? The task tests: timeout but settled, proven absent, attempt exhaustion. The attempt-exhaustion test: 5 transient errors, then park. So attempts count failed sends? Let me decide: `attempt_count` is incremented before each `bank.send`; if the response is accepted/duplicate, order becomes SENT (or SETTLED if duplicate indicates already settled) and no further attempts will happen unless it's never settled — hmm, keep scope narrow: SENT orders that don't settle remain SENT; the reconciler only matches; resends only from PENDING state whose latest attempt failed transiently AND proof of absence is established. Actually simpler: after a transient error, the order remains PENDING with `last_attempt_at` and `attempt_count` bumped. The executor can only resend orders in PENDING whose `last_attempt_at` (or send time) is older than publish lag AND the reconciler has recorded an "absent" proof after that time.

Proven-absent mechanism: reconciler for a window matches statement entries to orders in state SENT/PENDING? The bank statement contains txids we sent. If an order's send timed out, the txid may or may not be in the statement. The reconciler processes a window: fetch `getStatement(date)` — wait, signature is `getStatement(date) -> Settlement[]`. Date-based, not range-based. "safe to run every 15 minutes, including overlapping windows" — so reconcile(window) takes a window {start, end} and fetches statements for each date that overlaps? If the bank API is date-based, we fetch the statement for each UTC date in the window. Overlapping windows must not double-advance state: make matching idempotent — e.g., upsert on settlement by (txid, date), and orders only transition forward; a second reconcile for the same window finds orders already SETTLED and skips. Also record per-order `reconciled_after` (high-water mark of window end processed). Overlap is fine because transitions are idempotent and guarded (only advance if state is a predecessor).

Proven-absent: an order whose send timed out at time T. Publish lag ~30 minutes. So a window [T - something, ...] processed ending at E where E > T + LAG, if the order's txid is not in any statement for dates covering T..E, then it's proven absent. Implementation: reconciler, after processing a window ending at `windowEnd`, for each order with state PENDING and `last_attempt_at <= windowEnd - LAG` (i.e., the lag has passed) — check whether a settlement record exists for that order's txid in `statement_entries`; if not, mark as "absent-proven" (set `eligible_for_retry_at` = now or increment a flag), and executor will resend. Simpler: reconciler directly sets `retry_eligible` when proof of absence is established, or just allows executor to resend any PENDING order where `attempt_count < 5` AND (no last_attempt OR `last_attempt_at <= now - LAG`) AND no settlement exists for txid. Wait — "can only be resent once reconciliation proves it doesn't exist in the statement past the publish lag." The proof must come from reconciliation, not from executor's local timer. So we need an explicit marker: `absence_proven_at` timestamp set by reconciler when it has processed a window ending at or after (last_attempt_at + LAG) AND found no entry for txid. Executor resends PENDING orders with `absence_proven_at != null` and `attempt_count < 5`.

Hmm, but that means executor checks absence via a flag. Alternatively, the reconciler itself could resend. The task says "resend logic: an order whose send failed/timed out may only be re-sent after reconciliation proves it is absent from the statement past the publishing lag." Doesn't specify who resends. I'll have `executePayments()` handle both first-send and resend of PENDING orders, gated by absence proof. Actually cleaner: `executePayments()` sends (a) PENDING with `attempt_count = 0` (never sent), and (b) PENDING with `attempt_count > 0`, `absence_proven_at != null`, `attempt_count < 5`. This keeps one sender. Good.

Attempt cap: after the 5th failed attempt… "Cap attempts at 5; after that, park for manual review and never auto-revert." So if attempt_count reaches 5 and the send fails transiently again, state → MANUAL_REVIEW (parked). If 5th attempt succeeds (accepted)? Then SENT — no problem, cap is about attempts not failures; a 5th successful attempt is fine. So park only on failure when attempt_count == 5 (i.e., after consuming the 5th attempt with a transient error). Definition: increment attempt_count on send; if response is transient AND attempt_count >= 5 → state MANUAL_REVIEW. If accepted/duplicate → SENT/SETTLED regardless of count. If permanent → MANUAL_REVIEW (parked, terminal) — or a distinct state? Keep states minimal but I'll add `REJECTED` as terminal-parked state with a note "parked for manual review." Hmm, "after that" (cap 5) refers to parking after exhaustion. Permanent rejection: bank explicitly said no; retrying with same txid is pointless. I'll make permanent → state `REJECTED` (terminal, no auto-retry; manual review). Both MANUAL_REVIEW and REJECTED are "parked" states that automation never leaves ("never auto-revert"). I'll note this.

Actually let me reconsider: is duplicate a distinct state outcome? "duplicate" from bank.send means: we already sent this txid and the bank knows it — so effectively "already accepted." Should order become SETTLED? A duplicate response on send means the bank already processed (or will process) it. Treat as accepted → SENT, but actually safer: duplicate means the bank has a record; treat as settled? No — settlement is proven by statement. But duplicate usually means it was received. Since txid is idempotency key, treat duplicate as "bank already has it" → state SENT (awaiting statement confirmation) — or SETTLED directly? Hmm. Statement eventually confirms; but statement has lag, so duplicate now means the entry may appear in the statement for that date later. To keep the state machine tight: duplicate → treat as accepted → SENT. That's fine; next reconcile will match and SETTLE. Actually wait — "timeout but settled (no resend)" test: send times out; order remains PENDING with attempt_count=1, last_attempt_at set. Reconcile runs with window covering it; statement contains txid → order → SETTLED. No resend happens (executor sees state SETTLED, skips). This is the key test.

Also ordering rule: executor must not send an order that reconcile might be settling concurrently? Ordering rules required in section 3: "every ordering rule between two operations that might be written in either order." E.g.:
- reconcile must mark SETTLED before executor is allowed to resend the same order; i.e., executor only resends PENDING with absence_proven_at set; reconcile clears/supersedes the absence proof if it finds a settlement… actually, if a settlement is found the order becomes SETTLED and executor skips non-PENDING orders. The race: send times out; concurrently bank settled it. Executor might resend before reconcile runs → duplicate at bank — but bank handles duplicates idempotently via txid (that's the point of deterministic txid + duplicate classification). Still, ordering rule: absence proof is only computed for windows ending at or after last_attempt_at + LAG, giving the bank time to publish; and resends only use the same txid so a late settlement is harmless (bank dedupes). I'll state this.

- Idempotency of matching: statement entry upsert keyed by (txid, statement_date) — idempotent on overlap.
- State transitions only forward along a defined set; any transition attempt from an already-terminal state is a no-op (idempotent).

Data model:

Table `orders` (or `payout_orders`? Let me call the feature `payments`). Feature name: `payments`. Tables:

1. `payout_orders`:
   - id: string (uuid or business order id?). Use uuid PK `id` @default(uuid(7))? Keep string uuid. Also an external order id? Simple: `id` (PK), `supplier_key`? bank.send takes `{txid, amount, key}` — `key` is the supplier's account key. So orders need: `recipient_key` (string), `amount_cents` (int, integer minor units), `effective_date` (Date UTC date, `DATE` type in Prisma? Prisma has `DateTime`; Date-only is a common pattern but let me use `Date` at day precision in DateTime). Let's use `effective_date DateTime @map("effective_date")` with UTC midnight convention, or a string. Prisma supports `DateTime`; DATE type requires raw. Use DateTime in UTC with day-precision convention (store at 00:00:00Z). Columns:
   - id String @id @default(uuid())
   - recipient_key String (bank key)
   - amount_cents Int
   - effective_date DateTime (UTC midnight)
   - status String @map("status") — enum values PENDING/SENT/SETTLED/REJECTED/MANUAL_REVIEW
   - attempt_count Int @default(0) @map("attempt_count")
   - last_attempt_at DateTime? @map("last_attempt_at")
   - absence_proven_at DateTime? @map("absence_proven_at")
   - created_at, updated_at DateTime default now / @updatedAt
   Index: `status`, `effective_date` (for window scanning), `(txid)` is derived not stored — but for matching, we need to look up order by txid. We can compute txid→? Mapping: reconcile gets Settlement[] with txids; we need to find the order whose derived txid matches. Option: store `txid` column on orders (set at first attempt, deterministic — could pre-compute at creation or lazily). Storing txid makes matching a simple lookup and is deterministic either way. Let's store `txid String @unique`, set on order creation (or on first send). Better: set at creation — deterministic from id + effective_date, both known. Then matching = `findMany({ txid: in [...] })`. Also unique constraint guards against txid collisions (effectively impossible).

2. `statement_entries`:
   - id / composite: txid String, statement_date DateTime (UTC date), status? Settlement has what fields? `getStatement(date) -> Settlement[]` each with "txid we sent." Probably also amount. Definition: `{ txid: string, amount_cents: int, date }`? Minimum per spec: txid. I'll assume `Settlement = { txid, amount_cents }` for a given date. Columns:
   - txid String
   - statement_date DateTime (UTC midnight)
   - amount_cents Int
   - order_id String (FK to orders, set on match; null if unknown txid) — or separate `matched` flag. Store `order_id String? @map("order_id")`.
   - ingested_at DateTime default now
   - PK: (txid, statement_date) composite @id. @@unique(txid, statement_date).

Should the reconciler keep a per-order high-water mark `reconciled_through`? Not needed if absence proof logic uses last_attempt_at vs windowEnd: absence proof is established when a reconcile with windowEnd >= last_attempt_at + LAG processes dates covering [date(last_attempt), date(windowEnd)] and finds no entry for the txid. Simpler: after processing each window, for every PENDING order with last_attempt_at != null and last_attempt_at + LAG <= windowEnd AND no statement_entry exists for its txid: set absence_proven_at = windowEnd (or now). Wait, but do we need entries from prior windows? Yes — if a txid settled in an earlier window, the statement_entry row would exist (we keep them). The absence check is "no statement_entry exists for txid in the DB" — but that only covers dates we've ingested. To be safe: absence proof requires the window (plus past) to have covered all dates from last_attempt date through windowEnd. For simplicity and correctness: require that a reconcile has ingested all dates from `floorDate(last_attempt_at)` through `floorDate(windowEnd)` (i.e., windowStart <= floorDate(lastAttempt) and windowEnd covers rest?). That gets complex for overlapping windows.

Simpler and defensible assumption: the bank statement for a date is finalized once that date has passed its publish lag; reconciler runs every 15 minutes and always covers the last ~30–45 minutes; statement data for date D is complete by D+1 (next day) — actually publish lag is ~30 min, so date D's statement is complete by D+1. The reconciler, for the window [start,end], ingests dates in range. Absence proof for an order: requires that a reconcile has covered all UTC dates from the last_attempt's date through floorDate(windowEnd), and windowEnd >= last_attempt + LAG. We can track per-order `dates_covered_from`… overengineered for a plan.

Alternative cleaner design: reconciler maintains a per-order `absence_watermark`? Hmm.

Let me simplify with an assumption: "Reconcile job is always run to cover continuously backward from now (no gaps), so ingested dates are contiguous from earliest known." Then absence proof = windowEnd >= last_attempt_at + LAG AND no statement_entry for txid. State the assumption: reconciler is invoked with a window ending at now and starting at or before the oldest outstanding attempt (e.g., last 24h), so coverage is contiguous; under that invariant, no-entry in DB means absent. This is a reasonable one-line assumption.

Actually even simpler and standard: the reconciler, per window, fetches statement for each UTC date in [floorDate(start), floorDate(end)] (dedup with upsert). Then compute absence proof for PENDING orders where `last_attempt_at != null && last_attempt_at <= end - LAG && !exists(statement_entry for txid)`. If the job runs every 15 min with a window that reaches back far enough, all such orders have their full date range covered because entry rows from earlier windows persist. The only hole: an order attempted before the earliest window ever processed… but absence also requires last_attempt + LAG <= end, and we've kept processing since; edge cases are acceptable under the assumption "job runs continuously with overlapping windows." I'll write the assumption.

Config: `PUBLISHING_LAG_MINUTES` (default 30), `MAX_ATTEMPTS` (5) — env-var only. `RECONCILE_WINDOW_MINUTES` too? The task says reconcile(window) takes a window param — so the job passes it. The "reconcile job" = the scheduler that calls `reconcile({start,end})` every 15 minutes. Include a simple timer or cron? NestJS scheduler needs @nestjs/schedule — dependency assumption. Or the reconcile job is just a service method `runReconcileJob()` that computes window = [now - 45min, now] and calls reconcile. Let's assume no extra dependencies: job is a service method that computes window and calls reconcile; wiring the timer is out of scope (or note assumption). I'll write: "Job entry point `runReconcileCycle()` in service computes window [now-45m, now] and calls reconcile; timer wiring out of scope." Hmm, but deliverables say "reconcile job." So include `reconcile-job` as something — I'll make `runReconcileCycle()` the job method, and note in assumption that the actual cron/timer wiring is left to deployment (no new deps). Good.

bank client: define `BankClient` interface (port) with `send(p: OutgoingPayment): Promise<BankSendResult>` and `getStatement(date: Date): Promise<Settlement[]>`. `BankSendResult` classification: raw response from bank — how to classify? Task says "classify bank.send responses (accepted, duplicate, transient error, permanent rejection)." So classify function: `classifySendResponse(res: BankSendOutcome): SendClassification`. What's the shape of raw outcome? Let me define: bank returns `{ status: 'accepted' | 'duplicate', txid, settled_at? }` or throws? Define outcome:

```
type BankSendOutcome =
  | { kind: 'accepted'; txid: string }
  | { kind: 'duplicate'; txid: string }
  | { kind: 'error'; code: string; retryable: boolean }  // bank's own flag?
```

Hmm, "classify" suggests raw responses are ambiguous (HTTP status, error codes) and we map them. Let me define a raw shape: bank.send throws `BankError { code, message }` for failures and resolves `{ status: 'accepted' | 'duplicate', txid }` for successes. Then classifier maps: resolve → accepted/duplicate; BankError with code in retryable set (e.g., 'timeout', 'gateway', 'bank_unavailable') → transient; code in permanent set (e.g., 'insufficient_funds', 'invalid_key', 'txid_reused') → permanent; unknown codes → assume transient (safe default: don't give up on money without explicit rejection) — that's a good assumption to state. Wait, is unknown→transient or permanent safe? For payouts, giving up = lost money (parked for manual), retrying with same txid = idempotent at bank so no double-pay. So unknown→transient is the safe side and eventually parks for manual review anyway after 5 attempts.

Define error codes as constants: `TRANSIENT_BANK_CODES = ['timeout','unavailable','rate_limited']`, `PERMANENT_BANK_CODES = ['insufficient_funds','invalid_key','fraud_hold']`. Unknown → transient (assumption).

Also timeout: "send sometimes times out" — `bank.send` may throw a timeout error (classified transient) but the payment might have been accepted (that's why txid is deterministic + statement reconciliation). Timeout case: order remains PENDING, attempt_count++, last_attempt_at set. Then reconcile either proves settlement (SETTLED, no resend) or absence (resend with same txid).

Types and signatures — let me draft:

```ts
// src/payments/bank-client.ts
export interface Settlement {
  txid: string;
  amount_cents: number;
}

export interface OutgoingPayment {
  txid: string;
  amount_cents: number;
  key: string;
}

export interface BankSuccess {
  kind: 'accepted' | 'duplicate';
  txid: string;
}

export class BankError extends Error {
  readonly code: string;
  readonly message: string;
}

export interface BankClient {
  send(payment: OutgoingPayment): Promise<BankSuccess>;
  getStatement(date: Date): Promise<Settlement[]>; // date = UTC midnight
}
```

Wait — the repo layout convention: `src/<feature>/<feature>.module.ts` etc. Feature = `payments`. Files:
- src/payments/payments.module.ts
- src/payments/payments.controller.ts — hmm, do we need a controller? Endpoints? Task doesn't specify HTTP endpoints. "Deliver schema, service, reconcile job, tests." No API required… but the layout convention lists a controller. Convention says no exceptions to the layering, but does it require a controller in every feature? "controller validates input and calls service." If no endpoints are needed, do we make a minimal controller? Endpoints kebab-case plural — implies there are endpoints. Hmm. Task deliverables don't mention an API. But the codebase conventions imply the API exists (NestJS). I could add a minimal controller exposing `POST /payments/execute` and `POST /payments/reconcile` — manual trigger endpoints, reasonable for ops (also "park for manual review" suggests an ops UI later, but not needed now). I'll include a thin controller with these two trigger endpoints — it gives the job an entry point and fits conventions. Alternatively, controller-less feature… convention's layout lists a controller file as part of the standard feature; I'll include it. Assumption: "expose POST /payments/execute and POST /payments/reconcile for manual triggering; reconcile takes optional window query/body." Keep minimal.

- src/payments/payments.service.ts
- src/payments/payments.repository.ts
- src/payments/bank-client.ts (port) — hmm, layout doesn't list extra files but they are needed; the manifest lists files I write so it's fine. Also `prisma/prisma.service.ts`? Convention: repository is the only layer touching DB; the repository uses PrismaClient. I need a PrismaService or direct PrismaClient in the repository. Convention file layout doesn't include prisma.service.ts… many NestJS+Prisma setups use `src/prisma/prisma.service.ts`. Since layout is only given as "Layout" (maybe minimum), I'll add `src/prisma/prisma.service.ts` to keep repository clean. Hmm, "do not create files that are not requested" — but PLAN.md defines what to build; this is my design. The Prisma service is standard. I'll include it and state in assumptions: "PrismaClient wrapped in PrismaService (src/prisma/prisma.service.ts) injected into repository."

- derive-txid: put in `src/payments/derive-txid.ts`? Or a helper inside service file. I'll make `src/payments/derive-txid.ts` exporting `deriveTxid(orderId: string, effectiveDate: Date): string`. Hmm wait — txid is set at creation; service computes from id + effective_date. id is generated by DB (uuid default) on insert… chicken-and-egg: we need id to derive txid before insert. Solution: generate uuid in TS (crypto.randomUUID()) and pass both id and txid on insert. Clean, deterministic. I'll note that.

Actually should we even need a `createOrder` method? Task says "send pending orders" — orders must come from somewhere. The deliverables don't include order creation… but tests need orders in the DB. Provide `createOrder(input)` on service/repository for completeness (used by tests and real ingestion). I'll include it — necessary for tests to set up DB state, and it's where txid is derived. Yes include; I'll state in assumption: "provide createOrder to ingest orders (txid derived at creation); external ingestion pipeline out of scope."

Where does the bank client implementation come from? Out of scope — port only; tests inject a fake. Assume: "no real bank SDK in the repo; BankClient is a DI token provided by deployment / test fakes." For the app to boot, the module must provide BankClient — use a DI token `BANK_CLIENT` and an env-var-driven stub? In dev, module provides a no-op that throws "bank client not configured"? Simpler assumption: "module imports BANK_CLIENT from environment: if BANK_API_URL is set a real client would be registered; repo ships port + fake only (in test)." Hmm, in production app.module we need a provider. Let me say: payments module uses `@Inject(BANK_CLIENT)` and the provider is registered by a `bank-client.provider` (src/payments/bank-client.provider.ts) that constructs the real HTTP client when `BANK_API_URL` is set… but that adds an entire HTTP implementation — out of scope. Assumption: "BankClient is provided by the host application via the BANK_CLIENT token; this repo only defines the port and a test fake. app.module imports PaymentsModule; bank client provider is registered in deployment / tests." But then the repo's app.module won't boot… for eval purposes, this is fine; tests exercise service directly. Hmm but "every symbol we name must be resolvable here" — the implementer writes app.module.ts; if it imports PaymentsModule which requires BANK_CLIENT binding, the boot needs a provider. Let me add a minimal provider in the module: `provide(BANK_CLIENT), useValue: (import.meta.env.BANK_API_URL ? ... : throw)`. No — I'll decide: module declares `providers: [PaymentsService, PaymentsRepository, PrismaService, { provide: BANK_CLIENT, useFactory: ... }]` and the factory throws at inject time when `BANK_API_URL` is missing? That breaks boot for local runs.

Decision (one line in assumptions): "BankClient is an injected port bound via the BANK_CLIENT token; the repo ships only the interface and a test fake. Module declares the injection point and the concrete binding is out of scope (host app provides it). app.module.ts only imports PaymentsModule, and a stub provider is registered in app.module.ts for non-test boot." Hmm, stub = "unconfigured" client that throws BankError('unconfigured')? That's clean: `createUnconfiguredBankClient()`. OK, I'll go with that and state it.

Wait, maybe simpler: skip controller and app boot concerns entirely? No — conventions are always true. Keep as decided; one line each.

Repository interface (what the service can call — no Prisma):

```ts
export class PaymentsRepository {
  constructor(prisma: PrismaService) {}
  createOrder(input: { id: string; txid: string; recipient_key: string; amount_cents: number; effective_date: Date }): Promise<OrderRow>
  findResendable(now: Date, maxAttempts: number): Promise<OrderRow[]>   // PENDING, (attempt_count===0 || absence_proven_at!=null), attempt_count < maxAttempts
  findUnsettledBefore(cutoff: Date): Promise<OrderRow[]>  // PENDING with last_attempt_at != null && last_attempt_at <= cutoff  (for absence proof)
  findOrdersByTxids(txids: string[]): Promise<OrderRow[]>
  markSent(id, attemptCount, lastAttemptAt): ...
  markSettled(ids or id): transition to SETTLED (guarded)
  markRejected(id): ...
  parkManualReview(id): ...
  recordAbsenceProof(ids or id, provenAt: Date)
  upsertStatementEntries(entries: {txid, statement_date, amount_cents}[]): Promise<...>
  listStatementEntriesByTxids(txids: string[]): Promise<...>
  nextUpdatedAt... 
}
```

OrderRow type: define as an exported interface mirroring orders table. Service holds logic; repository does Prisma calls.

Service:

```ts
export class PaymentsService {
  constructor(repo, bank: BankClient @Inject(BANK_CLIENT), config)
  createOrder(input: NewOrderInput): Promise<OrderRow>
  executePayments(now?: Date): Promise<ExecutionSummary>
  reconcile(window: Window, now?: Date): Promise<ReconcileSummary>
  runReconcileCycle(now?: Date): Promise<ReconcileSummary> // computes default window
}
```

`now?` injection for testability — a clock. Config: `PaymentsConfig { publishingLagMs: number; maxAttempts: number; }` from env `PUBLISHING_LAG_MINUTES` (default 30), `MAX_PAYMENT_ATTEMPTS` (default 5). Env parsing where? module factory or config file. Keep: `payments.module.ts` env→config mapping with defaults 30/5, using process.env.

Classification helpers (pure, exported for tests):

```ts
export type SendOutcome =
  | { kind: 'accepted' }
  | { kind: 'duplicate' }
  | { kind: 'transient'; code: string }
  | { kind: 'permanent'; code: string };

export function classifyBankResult(result: BankSuccess, err?: BankError): SendOutcome
```

Hmm — better signature: classify takes `BankSendAttempt = BankSuccess | BankError`? Discriminate: if `instanceof BankError`. But instanceof couples classify to the error class — fine since both are our port.

```ts
export type SendAttemptResult = BankSuccess | BankError;
export function classifySendAttempt(result: SendAttemptResult): SendOutcome
```

And `isRetryable...` is covered.

State enum:

```ts
export const ORDER_STATUS = ['PENDING','SENT','SETTLED','REJECTED','MANUAL_REVIEW'] as const;
export type OrderStatus = typeof ORDER_STATUS[number];
```

OrderRow:

```ts
export interface OrderRow {
  id: string;
  txid: string;
  recipient_key: string;
  amount_cents: number;
  effective_date: Date;
  status: OrderStatus;
  attempt_count: number;
  last_attempt_at: Date | null;
  absence_proven_at: Date | null;
  created_at: Date;
  updated_at: Date;
}
```

Window:

```ts
export interface Window { start: Date; end: Date }
```

Summaries:

```ts
export interface ExecutionSummary { sent: number; duplicate: number; transient_failed: number; permanently_rejected: number; parked: number }
export interface ReconcileSummary { ingested_entries: number; settled: number; absence_proven: number; unknown_txids: number }
```

Error envelope: error code for this feature? Service-level errors are… the envelope is for HTTP errors. Controller-level: validate input (reconcile window shape) → `invalid_request` code. Also `bank_unavailable`? Service throws typed errors; controller maps to envelope via NestJS exception filter — is the filter an added file? Convention says "errors — one envelope" is a global contract, presumably handled by a global filter in app. In the plan: controller throws HttpException? To stay in scope: define `PaymentsError extends Error { code: string }` and a global exception filter `src/app.filter.ts` that maps to envelope? Convention states the envelope as a contract, not necessarily a filter file. To be safe and minimal: controller validates and throws NotFoundException-style? Hmm. I'll keep it simple: endpoints are ops triggers; errors: 400 invalid window → envelope `invalid_request`; 500 otherwise. Let me specify a global filter `src/errors/exception.filter.ts`? The manifest grows… I think it's within scope to include a global `AllExceptionsFilter` in the repo that renders the envelope because "one envelope" is a stated contract. But discipline: "do exactly what the task asks." Task: schema, service, reconcile job, tests. A controller/filter isn't strictly required. But the layering convention demands a controller? "No exceptions" refers to layer rules. Layout lists a controller as standard file for a feature. I'll include a thin controller (two POST endpoints), and the envelope via a small global filter — one file `src/app.filter.ts`. Hmm… is that overbuilding? The "errors — one envelope" contract means the repo should produce that envelope on errors. Without a filter, Nest returns its own shape. I'll include it; small and justified by contract. Actually wait — the convention block is "always true" and applies to this repo; so the envelope contract applies to what we deliver. Minimal: `src/main.ts` (needed by layout anyway) + `src/app.filter.ts`. main.ts is in the layout so we write it. OK.

Let me finalize file list (manifest):

1. `prisma/schema.prisma` — schema.
2. `prisma/migrations/20240101000000_init/migration.sql` — init migration.
3. `src/main.ts` — bootstrap, apply filter.
4. `src/app.module.ts` — imports PaymentsModule.
5. `src/app.filter.ts` — global exception filter producing envelope; maps unknown → `internal_error`, validation → `invalid_request`. Hmm, do I also need an error class? Put `AppException` in app.filter.ts? Simpler: filter catches `ServiceError` (defined in payments.service.ts? no—errors are cross-cutting). Let me define error types in `src/payments/payments.service.ts`? Controller throws Nest's `BadRequestException('invalid window')`; filter maps Nest exceptions to envelope with code: BadRequest→`invalid_request`, Not Found→`resource_not_found`, else→`internal_error`. That avoids a custom error class. Fine: no custom error class needed. Service throws domain errors…? Do any? E.g., createOrder with negative amount → validation in controller only. Service errors: no bank client configured → BankError('unconfigured'). Executor just classifies as permanent? Hmm — unconfigured bank should fail loudly, not park orders. Edge case; I'll assume: unconfigured client throws BankError code 'unconfigured', which is classified as transient per unknown-code rule — orders will remain PENDING and eventually park. Acceptable; note in one line? It's a subtle point; skip, the classification rule covers it.

6. `src/prisma/prisma.service.ts` — PrismaClient wrapper.
7. `src/payments/bank-client.ts` — port (BankClient, BankSuccess, BankError, Settlement, OutgoingPayment) + BANK_CLIENT token + `unconfiguredBankClient()` factory for app boot.
8. `src/payments/derive-txid.ts` — `deriveTxid`.
9. `src/payments/payments.types.ts`? Could fold types into service/repository files, but a shared types file is cleaner: `OrderRow`, `Window`, summaries, `ORDER_STATUS`. Hmm, layout has `<feature>.module/controller/service/repository` — extra files allowed (we already have bank-client). I'll add `src/payments/payments.types.ts` for shared types. Fewer cross-imports. OK.
10. `src/payments/payments.repository.ts` — PaymentsRepository class + methods; owns all Prisma calls.
11. `src/payments/payments.service.ts` — PaymentsService + classify function? Put classify in its own file for pure-testability: `src/payments/classify-send.ts`. Or fold into service; tests can import from service file. Fold into service file? "Every exported function signature" — either fine. Let me make `src/payments/classify-send.ts` small and pure: `classifySendAttempt`, `TRANSIENT_BANK_CODES`, `PERMANENT_BANK_CODES`. Clean.
12. `src/payments/payments.module.ts` — providers: PrismaService? (global?), PaymentsRepository, PaymentsService, {provide BANK_CLIENT...}; controller; exports PaymentsService (for app boot / other modules? controller uses it in-module so no need to export — but reconcile job is… the job is inside service). Module exports nothing? Fine if controller in same module. PrismaService: make it @Global() module `src/prisma/prisma.module.ts`? Adds a file. Alternative: PrismaService provided directly by payments.module — allowed (provider declared in module that uses it). Convention: "service, repository, or processor is enumerated as provider in their own module." PrismaService is a service; its own module would be cleaner but adds files. Let me have payments.module provide PrismaService directly (it's the only consumer). Decision, one line.
13. `src/payments/payments.controller.ts` — POST /payments/execute, POST /payments/reconcile (body {start,end} optional ISO dates → defaults to last 45 min). Kebab-case: `/payments/execute` is singular verb — "Endpoints: kebab-case, plural" — /payments/execute… endpoint path is `payments` plural + action. I think a trigger POST to a sub-action is acceptable; alternative: `POST /reconcile-runs`? Ugh. Conventions are for REST resources; a job trigger isn't a resource. Let me go with `POST /payments/execute` and `POST /payments/reconcile` and note in assumptions: "job triggers are action endpoints under /payments; the plural-resource rule applies to collection routes." OK.
14. `test/payments.service.spec.ts` — unit tests with fake bank + in-memory repository? Repository is Prisma-based; service tests need a fake repository or real DB. Convention: `test/<feature>.spec.ts`. Behavior tests for timeout but settled, etc., need the repository. Option A: fake BankClient + in-memory fake repository implementing PaymentsRepository (service only depends on repository interface). But our repository is a class, not an interface. For testability, define the repository as a class and tests provide a fake via DI override. Vitest + Nest test module is fine. Option B: integration tests against real Postgres (DATABASE_URL) with Prisma — heavy for evals; needs migration + DB running. Safer: unit tests of service with fake repository (implementing same method signatures) + fake BankClient; plus pure tests for classify and deriveTxid. "Test behavior, not implementation" — fake repository at the service boundary is acceptable (repository is a seam). But "never assert only on calls" — we'll assert on returned summary and repository state transitions (fake repo holds state, assertions read it). OK.

So tests:
- `test/payments.spec.ts`? Layout says `test/<feature>.spec.ts`. Split: `test/derive-txid.spec.ts`? Manifest can list multiple test files; layout suggests feature spec per feature. Let me have: `test/payments.service.spec.ts` (end-to-end at service boundary with fakes), `test/classify-send.spec.ts`, `test/derive-txid.spec.ts`. Hmm, layout is strict-ish: `test/<feature>.spec.ts`. I'll consolidate into a single `test/payments.spec.ts` to honor layout. All tests there. Good — fewer files, still fine.

Wait — but does the repository need its own tests? Repository is Prisma glue; testing it needs a DB. Skip (assumption: repository is covered implicitly; no DB in unit tests). Note? Maybe one line in assumptions… not necessary. Actually, "every error and what raises it" needs care below.

Now — control flow details:

executePayments (per order in resendable set):
- txid already stored; build OutgoingPayment {txid, amount_cents: amount_cents, key: recipient_key}.
- Call bank.send (outside any DB transaction — network call).
- Classify:
  - accepted → update order: status SENT, attempt_count+1, last_attempt_at=now. (absence_proven_at cleared? If it was set and now accepted, cleared — status change guards executor anyway; also clear for cleanliness.)
  - duplicate → same as accepted (SENT) — bank already has it; statement will confirm. attempt_count+1? Duplicate means a previous attempt got through — count this as an attempt too (it was a send). Yes, increment.
  - transient → status remains PENDING, attempt_count+1, last_attempt_at=now, absence_proven_at=null (proof stale). If attempt_count becomes MAX (5) → status MANUAL_REVIEW (parked).

  Wait — carefully: "Cap attempts at 5; after that, park." If the order is on attempt #5 (attempt_count 4→5) and transient → park. If the order is on attempt #5 and accepted → SENT (no parking). Per logic: park only if outcome is transient AND new attempt_count >= maxAttempts. Good.
  - permanent → status REJECTED, attempt_count+1, last_attempt_at=now, clear absence proof. Terminal; parked for manual review, no auto-retry.

- All updates in small per-order Prisma transaction (updateMany with guard: `where: {id, status: 'PENDING'}` — idempotency against concurrent execution). Note: guard updates by current status to make double execution safe.

reconcile(window):
- Dates covered: UTC dates from floorDate(start) through floorDate(end).
- For each date: entries = bank.getStatement(date) (network; outside transaction). Upstatement_entries by (txid, statement_date) — upsert idempotent on overlap; count ingested (new/updated).
- Matching: find orders with txid in ingested txids AND status in (PENDING, SENT). Wait — PENDING orders matched? Yes! That's the timeout-but-settled case: timed out (status PENDING), statement shows settled → SETTLED. Both SENT and PENDING → SETTLED, when entry found, guarded update (status in [PENDING,SENT]). Also settle a REJECTED? If bank permanently rejected and yet settled… contradictory; don't touch terminal states. MANUAL_REVIEW: "never auto-revert" — so no. Only PENDING|SENT → SETTLED.
  - Also set statement_entry.order_id = order.id on match (for audit). Mismatched amounts? If entry.amount_cents != order.amount_cents → mismatch! What to do? Not in task… Assumption: amount mismatch parks the order for manual review (safe for money). Include? "do exactly what the task asks" — but amount validation is prudent; one line in assumptions: "amount mismatch between statement and order → MANUAL_REVIEW." Include because it's a real hole. OK.
- Unknown txid (no order) → ignore, log only (unknown_txids counter).
- Absence proof: after matching, cutoff = window.end - publishingLag. Candidates: PENDING orders with last_attempt_at != null && last_attempt_at <= cutoff. For each, if no statement_entry exists for its txid → set absence_proven_at = window.end (guarded: status PENDING).

  Wait, subtle: an order just now in SENT (accepted, not timed out) has last_attempt_at <= cutoff — it's SENT not PENDING, so not a candidate. Good. An order PENDING with attempt 0 (never sent) → last_attempt_at null → not a candidate. Good.

- All DB writes inside one Prisma $transaction? Mixing network (getStatement) with transactions: no — fetch statements first (no txn), then do all writes in one transaction: upsert entries, settle orders, link entries, absence proofs. If window spans multiple dates, fetch all first then one txn. But if getStatement throws for a date → abort the whole cycle, no writes (safe; next cycle retries). OK: "statement fetch is outside transaction; matching/writes are inside a single transaction; no network calls inside a transaction."

  Hmm, one concern: the "no entry for txid" absence check must reflect entries just upserted in this txn — use entries fetched in memory, not re-query. The set of txids to check = candidates' txids; absence = txid not in fetched entries for covered dates AND not previously stored. We upserted the fetched ones; a pre-existing row from a prior window is in DB. So check = not in (fetched ∪ stored). Implementation: after upsert, query statement_entries where txid in candidate txids (inside txn) — simplest and correct. OK, repository methods: `upsertStatementEntries`, `findOrdersByTxids`, `settleOrders(ids)` (guarded), `linkEntries(txid→orderId pairs)`, `findPendingWithAttemptBefore(cutoff)`, `statementEntriesByTxids(txids)`, `proveAbsence(ids, provenAt)`.

Ordering rules (section 3 requirement — "every ordering rule between two operations that might be written in either order"):
1. In reconcile: statement fetch/upsert before absence check (absence must see entries from this window). — This is within reconcile.
2. In executePayments: classification and status update after bank.send completes (obviously); skip: none?
3. Between reconcile and executePayments across concurrent runs: absence proof is only computed for attempts older than LAG past window end, AND the order must still be PENDING when executor acts (guarded update `where status=PENDING`); if reconcile settles it in between, executor's guarded update no-ops → no duplicate state; worst case, a bank-level duplicate is deduped by txid. Rule: "executor's guarded write must come after the bank call with the current PENDING status; settle wins over resend because executor only acts on orders still PENDING at write time."
4. createOrder before executePayments (trivial).
5. attempt_count increments and last_attempt_at set in same update as outcome — atomic per order (one txn / one update).
6. In controller reconcile: parse/validate window before calling service (trivial; skip? "might be written in either order" — validating after compute is wrong; include briefly).

Maybe also: "absence_proven_at is cleared when an order transitions out of PENDING (accepted/duplicate/rejected/settled)."

State machine (section 4):
- PENDING → SENT (accepted|duplicate)
- PENDING → SETTLED (statement match)
- PENDING → MANUAL_REVIEW (transient failure on 5th attempt) [also amount mismatch path from PENDING/SENT]
- PENDING → REJECTED (permanent)
- SENT → SETTLED (statement match)
- SENT → MANUAL_REVIEW (amount mismatch)
- Terminal: SETTLED, REJECTED, MANUAL_REVIEW — no automatic transitions out ("never auto-revert").

Transactions:
- createOrder: single insert (txid unique → collision returns error → `duplicate_order`? code… envelope. Controller maps to… createOrder via controller? No create-order endpoint needed. Service method used in tests / future ingestion. Keep as service+repo only, no endpoint.)
- executePayments: bank.send outside transaction; one small update per order (guarded). Orders processed sequentially or in parallel? Sequential for determinism — assumption? Parallel could race on the same order across concurrent executePayments runs; guarded update prevents double state advance but could double bank.send (two concurrent executors both call bank.send before either writes) — bank dedupes by txid → duplicate outcome, harmless. So safety relies on txid idempotency + guarded writes. I'll state: concurrent runs are safe due to guarded updates and bank txid dedup; no global lock.
- reconcile: single $transaction wrapping entry upserts, settle updates, linking, absence proofs. getStatement calls outside/preceding.
- What must not be in transactions: bank.send, getStatement, any network.

Tests (section 5, one line each) — required 3 + reasonable extras:
1. Timeout but settled: send throws timeout (transient); window containing attempt date with fake bank statement containing txid → reconcile settles; subsequent executePayments does not resend (bank.send not called again for that order; state SETTLED).
2. Proven absent: send times out; reconcile window with end past attempt+lag, empty statement → order gets absence_proven_at; executePayments resends with the same txid (fake bank captures txid; assert equal to original).
3. Attempt exhaustion: 5 cycles of transient failure + absence proof → after 5th, order is MANUAL_REVIEW; further cycles do not send (no more bank.send) and no state changes (no auto-revert).
4. Accepted: executePayments on new order → status SENT, txid matches derived, attempt_count 1.
5. Duplicate classification: bank returns duplicate → status SENT (idempotent acceptance), no double send in subsequent cycle.
6. Permanent rejection: bank returns permanent code → status REJECTED, terminal (no resends across cycles).
7. Overlapping windows: reconcile same/overlapping window twice → second run is no-op (no double settle, entry count stable; entries not duplicated).
8. deriveTxid determinism + sensitivity: same (order, date) → same txid; different date or id → different.
9. classify: each mapping — success kinds, transient codes, permanent codes, unknown → transient (safe default).
10. Amount mismatch: statement amount ≠ order amount → MANUAL_REVIEW (not SETTLED).
11. New PENDING (never sent) order is not subject to absence proof / not resent without send first? That's covered by executor only sending attempt 0 or proofed. Test: executePayments on a fresh order sends once (attempt 0 path). Covered by test 4. Maybe: executor does not resend PENDING with attempt>0 without absence proof (window still within lag) → no second send. Good test:
12. Within-lag guard: after transient failure, executePayments again within lag (no absence proof yet) → no resend.

Maybe too many; I'll trim to a strong set (~10). Requirement: "test behavior, not implementation. never assert only on calls" — assertions on state/summary + bank interactions captured by fakes with meaningful assertions (same txid).

Data model section — write tables:

payout_orders (@@map("payout_orders")):
- id String (uuid) PK
- txid String @unique
- recipient_key String
- amount_cents Int
- effective_date DateTime (UTC midnight)
- status String default "PENDING"
- attempt_count Int default 0
- last_attempt_at DateTime?
- absence_proven_at DateTime?
- created_at DateTime @default(now())
- updated_at DateTime @updatedAt
Index: [status, last_attempt_at] for scans; [effective_date].

statement_entries (@@map("statement_entries")):
- txid String
- statement_date DateTime (UTC midnight)
- amount_cents Int
- order_id String? (FK payout_orders.id, nullable, set on match)
- ingested_at DateTime @default(now())
- @id([txid, statement_date])
Index: [order_id], [statement_date].

Wait — Prisma composite @id needs @map on fields? Composite id with @map: `txid @map... String` — the composite `@@id([txid, statement_date])`. Columns map to txid, statement_date — already snake_case anyway.

Also migration SQL mirrors this.

Types and signatures — let me write all of them carefully:

```ts
// src/payments/bank-client.ts
export const BANK_CLIENT: unique symbol  // or string token 'BANK_CLIENT'
export interface OutgoingPayment { txid: string; amount_cents: number; key: string }
export interface Settlement { txid: string; amount_cents: number }
export type BankSuccess = { kind: 'accepted' | 'duplicate'; txid: string }
export class BankError extends Error { constructor(code: string, message?: string); readonly code: string }
export interface BankClient {
  send(payment: OutgoingPayment): Promise<BankSuccess>;
  getStatement(date: Date): Promise<Settlement[]>; // date: UTC midnight for that day
}
export function unconfiguredBankClient(): BankClient; // both methods throw BankError('unconfigured')
```

DI token: `export const BANK_CLIENT = 'BANK_CLIENT' as const`? Nest token. Fine.

```ts
// src/payments/derive-txid.ts
export function deriveTxid(orderId: string, effectiveDate: Date): string; // 64-hex sha256 of `${orderId}|${isoDay}`
```

```ts
// src/payments/classify-send.ts
export type SendOutcome =
  | { kind: 'accepted' }
  | { kind: 'duplicate' }
  | { kind: 'transient'; code: string }
  | { kind: 'permanent'; code: string };
export const TRANSIENT_BANK_CODES: readonly string[];
export const PERMANENT_BANK_CODES: readonly string[];
export function classifySendAttempt(result: BankSuccess | BankError): SendOutcome;
```

```ts
// src/payments/payments.types.ts
export const ORDER_STATUS = [...] as const; export type OrderStatus = ...
export interface OrderRow {...} (as above)
export interface NewOrderInput { recipient_key: string; amount_cents: number; effective_date: Date }
export interface Window { start: Date; end: Date }
export interface PaymentsConfig { publishingLagMs: number; maxAttempts: number }
export interface ExecutionSummary {...}
export interface ReconcileSummary {...}
```

Repository class:

```ts
// src/payments/payments.repository.ts
export class PaymentsRepository {
  constructor(prisma: PrismaService);
  createOrder(order: OrderRowInput): Promise<OrderRow>;   // insert with explicit id+txid
  findForExecution(maxAttempts: number): Promise<OrderRow[]>; // PENDING, attempt_count===0 || absence_proven_at!==null
  findPendingAttemptedBefore(cutoff: Date): Promise<OrderRow[]>; // PENDING, last_attempt_at!==null && last_attempt_at<=cutoff
  findOrdersByTxids(txids: string[]): Promise<OrderRow[]>;
  upsertStatementEntries(entries: StatementEntryInput[]): Promise<number>; // returns number of rows written
  findSettleableByTxids(txids: string[]): Promise<OrderRow[]>; // status in PENDING|SENT
  recordSettlements(settlements: {orderId: string; txid: string; statementDate: Date}[]): Promise<number>; // guarded update + link entries
  recordAmountMismatches(ids: string[]): Promise<number>; // PENDING|SENT -> MANUAL_REVIEW
  proveAbsence(ids: string[], provenAt: Date): Promise<number>; // guarded PENDING
  applyOutcome(id: string, outcome: OutcomeUpdate): Promise<boolean>; // one guarded update per bank outcome; boolean = applied
}
```

Hmm, applyOutcome — encoding the outcome in repository: pass a discriminated union:

```ts
export type OutcomeUpdate =
  | { kind: 'sent'; attemptCount: number; lastAttemptAt: Date }         // PENDING->SENT, clear absence
  | { kind: 'failed_transient'; attemptCount: number; lastAttemptAt: Date; parked: boolean } // stays PENDING or ->MANUAL_REVIEW
  | { kind: 'rejected'; attemptCount: number; lastAttemptAt: Date }     // PENDING->REJECTED
```

All guarded with where status='PENDING'; return whether applied. Service computes attemptCount/parked (logic) — repository just applies. Reasonable split: business rules (when to park, count limit) in service; repo does guarded writes.

Service:

```ts
// src/payments/payments.service.ts
export class PaymentsService {
  constructor(repo: PaymentsRepository, bank: BankClient /* injected with @Inject(BANK_CLIENT) */, config: PaymentsConfig);
  createOrder(input: NewOrderInput): Promise<OrderRow>;
  executePayments(now?: Date): Promise<ExecutionSummary>;
  reconcile(window: Window, now?: Date): Promise<ReconcileSummary>;
  runReconcileCycle(now?: Date): Promise<ReconcileSummary>; // window = [now-45m, now]
}
```

Env/config: module reads `PUBLISHING_LAG_MINUTES` (default 30), `MAX_PAYMENT_ATTEMPTS` (default 5) and constructs PaymentsConfig as a provider. Provider: `{ provide: 'PAYMENTS_CONFIG', useFactory: ... }` or an `APP_CONFIG`? Keep: `{ provide: PaymentsConfigToken...}`. Simpler: inline object in module useFactory that returns config; service takes `@Inject(PAYMENTS_CONFIG)`. Let me define `export const PAYMENTS_CONFIG = 'PAYMENTS_CONFIG'` in payments.types.ts.

Controller:

```ts
// src/payments/payments.controller.ts
@Controller('payments')
export class PaymentsController {
  constructor(service: PaymentsService) {}
  @Post('execute') execute(): Promise<ExecutionSummary>;
  @Post('reconcile') reconcile(@Body() body?: ReconcileBody): Promise<ReconcileSummary>;
}
export interface ReconcileBody { start?: string; end?: string } // ISO 8601
```

Validation: if body provided, parse ISO dates; invalid → HttpException 400 (envelope `invalid_request`); if start>=end → 400. Otherwise default last 45 min? Controller defaulting vs service runReconcileCycle — consolidate: controller always calls `service.reconcile(window)` with resolved window (default = last 45m via `DEFAULT_WINDOW_MINUTES`? that's config… add to PaymentsConfig: defaultWindowMs). Fine: config gets `defaultReconcileWindowMs`.

Filter:

```ts
// src/app.filter.ts
export class EnvelopeExceptionFilter implements ExceptionFilter { catch(exception, host): void; }
```

Mapping: BadRequestException → 400 `invalid_request`; NotFoundException → 404 `resource_not_found`; others → 500 `internal_error` (log, no leak). Prisma unique constraint violation on createOrder (txid collision) → 409 `duplicate_txid`? Service can catch P2002 and throw ConflictException with message; filter maps to `duplicate_txid` 409. Include in "errors and what raises it":
- `invalid_request`: bad body on /payments/reconcile (missing/parse-fail/misordered dates), or missing/invalid input on future createOrder endpoint (none for now) — actually only reconcile endpoint. execute has no body → nothing invalid. OK: raised by controller validation on /payments/reconcile.
- `duplicate_txid`: createOrder when txid already exists (Prisma P2002) — service → ConflictException.
- `internal_error`: anything else.
- `resource_not_found`: not used by current endpoints? Keep in filter map for completeness (no raise). Hmm, "every error and what raises it" — list what's raised by this feature. List: invalid_request (controller), duplicate_txid (service.createOrder on collision), internal_error (filter catch-all). And state filter maps Nest types generally.

main.ts: NestFactory.create(AppModule); app.useGlobalFilters(new EnvelopeExceptionFilter()); listen on env PORT (default 3000)? Port from env — "config from env only." OK, `process.env.PORT ?? 3000`.

app.module.ts: imports [PaymentsModule].

payments.module.ts:
- controllers: [PaymentsController]
- providers: [PrismaService, PaymentsRepository, {provide: PAYMENTS_CONFIG, useFactory: env→config}, {provide: BANK_CLIENT, useFactory: () => unconfiguredBankClient()}, PaymentsService]
- No exports (nothing else needs it).

prisma.service.ts:

```ts
export class PrismaService extends PrismaClient {
  onModuleInit(): Promise<void>;
  onModuleDestroy(): Promise<void>;
}
```

Now — is `executePayments` also triggered by an endpoint? Yes, POST /payments/execute. And "reconcile job" = runReconcileCycle + endpoint /payments/reconcile. OK.

Now section 1, Assumptions — one-line each. Let me enumerate:

1. Bank access is a port: repo defines `BankClient` interface only; concrete HTTP client is out of scope, tests use fakes. (reason: bank API unspecified)
2. App boot binds BANK_CLIENT to `unconfiguredBankClient()` (throws code 'unconfigured', classified transient → safe retry/park path) — hmm, actually if host provides real client that's fine; default is safe. One line: "unconfigured BANK_CLIENT throws BankError('unconfigured') so a misconfigured deployment keeps retrying safely rather than losing orders."
3. Deterministic txid = sha256 hex of `${orderId}|${yyyy-mm-dd(utc)}` — stable across resends, which is what makes duplicate detection work.
4. txid is derived and stored at order creation (uuid generated in TS as both PK and txid input) so DB insert and bank send always agree.
5. Orders arrive via `createOrder` (service + repo); external ingestion pipeline is out of scope.
6. Statement rows keyed by (txid, statement_date); bank statement is per-UTC-date and final past publish lag.
7. `getStatement(date)` returns entries including amount; amount mismatch with order parks for MANUAL_REVIEW rather than settle.
8. Unknown bank error codes classify as transient (retry + eventual manual park) because same-txid retry is idempotent at bank, whereas giving up loses a payment.
9. Publish lag 30 min and max attempts 5 via env `PUBLISHING_LAG_MINUTES`, `MAX_PAYMENT_ATTEMPTS`; reconcile window per call; job default window is trailing 45 min (config `DEFAULT_RECONCILE_WINDOW_MINUTES`? or fixed 45). Let me make it configurable: `RECONCILE_WINDOW_MINUTES` default 45.
10. No scheduler dependency: `runReconcileCycle()` is the job entry point, exposed via POST /payments/reconcile; cron wiring in deployment (assumption: no new deps).
11. Action endpoints under /payments (execute/reconcile); plural-resource rule applies to collection routes.
12. Money: integer minor units everywhere (`amount_cents`), never float; Prisma Int.
13. Effective date stored as DateTime at UTC midnight; bank `date` arg is same convention.
14. Concurrency safety via guarded status updates + bank txid dedup, no locks; concurrent executePayments may double-call bank but result is deduped.
15. Tests run without a database: service is tested against a fake repository (same method signatures) and a fake BankClient; repository code is Prisma glue covered by migration/schema.
16. PrismaService declared as provider in payments module (only consumer) rather than a global module — file is src/prisma/prisma.service.ts.
17. Migration folder `prisma/migrations/20240101000000_init` ships with the schema (single init migration).
18. Envelope filter is global (src/app.filter.ts); feature raises only invalid_request and duplicate_txid specifically, rest → internal_error.

Some of these are "conventions I chose" — instructions say to pick and state in section 1 concisely. Good, that's what I'm doing. Keep each one line. Maybe trim to ~12 lines for budget.

Section 2, Data model — two tables with column/type/default as above + notes (indexes).

Section 3, Types and signatures — all files' exported symbols with signatures + errors + ordering rules. Write compactly, grouped by file. Include error list:
- BankError (from bank.port; raised by bank client implementations incl. unconfigured)
- Prisma P2002 on createOrder → service throws ConflictException (→ 409 duplicate_txid)
- Controller: BadRequest on bad window body → invalid_request
- Filter catch-all internal_error.

Ordering rules:
- reconcile: all getStatement fetches complete (or abort cycle) before any DB write; entries upserted before absence check reads; settle writes and absence proofs in one transaction.
- executePayments: bank.send before state write; state write is guarded on status=PENDING so a concurrent settle wins (executor never overwrites SETTLED); absence_proven_at cleared whenever order leaves PENDING.
- createOrder (txid insert) before any bank.send for that order (by construction).
- Controller validates window before calling service.reconcile.

Section 4, Control flow — state machine table + narrative per operation + transaction boundaries:
- executePayments: fetch eligible orders (PENDING, attempts<5, attempt 0 or proofed) → for each: bank.send (no txn) → classify → one guarded update (mini-txn): [mapping]. No network in txn.
- reconcile: per-date fetch → single transaction: upsert entries, settle (PENDING|SENT with entry; amount mismatch → MANUAL_REVIEW), link, prove absence (PENDING with last_attempt_at ≤ end−lag and no entry for txid) → summary. On any fetch error: no writes, throw (500).
- State machine table with transitions and triggers; terminal states SETTLED/REJECTED/MANUAL_REVIEW never auto-exit.

Section 5, Tests — one line each (~10):
1. timeout-but-settled: send throws timeout; later reconcile's statement contains txid → SETTLED and no subsequent executePayments resends (bank captures 1 send, final state SETTLED).
2. proven-absent resend: send times out; reconcile with window past attempt+lag with empty statement sets absence proof; next executePayments calls bank.send again with identical txid.
3. within-lag no-resend: after transient failure, executePayments before lag elapses → no second bank.send (proof not established).
4. attempt exhaustion: 5 cycles of transient failure + absence proof → MANUAL_REVIEW after 5th; further cycles leave state unchanged and no bank.send (no auto-revert).
5. accepted path: new order executes → SENT, attempt_count 1, txid equals deriveTxid(order.id, effectiveDate).
6. duplicate response: bank answers duplicate → SENT (no error); subsequent cycle does not resend.
7. permanent rejection: permanent code → REJECTED, terminal: further executePayments never send it.
8. overlapping windows: same window twice (and 2× overlap) → second reconcile settles nothing new; statement_entries row count unchanged; summary settled=0 second time.
9. amount mismatch: statement amount differs → MANUAL_REVIEW, not SETTLED.
10. deriveTxid: deterministic for same (id, date); differs when date or id changes; output is 64-hex.
11. classify mapping: accepted/duplicate pass through; timeout/unavailable/rate_limited → transient; insufficient_funds/invalid_key → permanent; unknown code → transient.
12. (maybe) never-sent order not subject to absence proof: fresh PENDING stays attempt 0 until executePayments; reconcile doesn't give it absence_proven_at. — I'll include, cheap and covers hole.

Maybe drop #12 to save budget? Keep; one line. 12 tests, fine.

Section 6 Manifest — machine-readable block, exact shape:

```
<!-- manifest
prisma/schema.prisma | reads: - | orders + statement_entries schema
prisma/migrations/20240101000000_init/migration.sql | reads: prisma/schema.prisma | init DDL for both tables
src/main.ts | reads: src/app.module.ts, src/app.filter.ts | bootstrap + global envelope filter
src/app.module.ts | reads: src/payments/payments.module.ts | root module
src/app.filter.ts | reads: - | maps exceptions to the single error envelope
src/prisma/prisma.service.ts | reads: - | PrismaClient lifecycle wrapper
src/payments/bank-client.ts | reads: - | BankClient port, BankError, BANK_CLIENT token, unconfigured client
src/payments/derive-txid.ts | reads: - | deterministic txid derivation
src/payments/classify-send.ts | reads: src/payments/bank-client.ts | outcome classification + code tables
src/payments/payments.types.ts | reads: - | OrderRow, Window, config token, summaries
src/payments/payments.repository.ts | reads: src/prisma/prisma.service.ts, src/payments/payments.types.ts | all Prisma calls, guarded writes
src/payments/payments.service.ts | reads: src/payments/payments.repository.ts, src/payments/bank-client.ts, src/payments/classify-send.ts, src/payments/derive-txid.ts, src/payments/payments.types.ts | execution, reconcile, absence proof, state transitions
src/payments/payments.module.ts | reads: src/prisma/prisma.service.ts, src/payments/payments.controller.ts, src/payments/payments.repository.ts, src/payments/payments.service.ts, src/payments/bank-client.ts, src/payments/payments.types.ts | DI wiring + env config
src/payments/payments.controller.ts | reads: src/payments/payments.service.ts, src/payments/payments.types.ts | thin triggers for execute/reconcile
test/payments.spec.ts | reads: src/payments/payments.service.ts, src/payments/bank-client.ts, src/payments/classify-send.ts, src/payments/derive-txid.ts, src/payments/payments.types.ts | behaviour tests incl. timeout-settled, proven-absent, exhaustion
-->
```

Constraint: "a file may only name in reads: files that appear above it" — I have to order so dependencies come before dependents. Check order:
- schema.prisma (top).
- migration.sql reads schema ✓ (above).
- main.ts reads app.module + app.filter — both
