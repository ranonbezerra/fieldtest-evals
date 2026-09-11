# solution-retry

## reasoning

```
Let me analyze the task carefully.

Build a payment reconciliation system with the following:
1. `executePayments()` — sends pending orders via `bank.send({txid, amount, key})`, where txid is derived deterministically from order + effective date
2. `reconcile(window)` — matches settlement entries against orders, advances state, safe to run every 15 minutes even with overlapping windows
3. Resend logic: resend only after reconciliation proves the order is not on the statement past the publish lag (about 30 minutes). Cap attempts at 5. After that, park for manual review and never auto-revert
4. Classify `bank.send` responses: accepted, duplicate, transient error, permanent rejection

Stack: TypeScript strict, Node 20+, NestJS API, Prisma ORM, PostgreSQL, Vitest, pnpm, ESM with "type": "module".

Layout conventions:
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

Layers: controller validates input and calls the service. No business logic. Service holds logic. No raw SQL, no Prisma client calls. Repository is the only layer that touches the DB.

Naming: table/columns are snake_case via Prisma's @map/@@map. Endpoints are kebab-case plural. TS files are kebab-case.role.ts. Classes are PascalCase.

Errors: single envelope `{ "error": { "code": "snake_case", "message": "...", "details": {} } }`.

Wiring: services/repositories are included in the module's providers. Cross-module providers are exported/imported. Controllers are declared in the module.

Migrations: every schema change ships with a migration. Since this is a new schema, a migration file is needed. `prisma/migrations/0001_init/migration.sql`. Actually "every schema change ships with a migration" — since this is the initial schema, one migration is enough.

Tests: Vitest. Test behavior, not implementation. Don't just assert that a call happened. No tests without assertions. Not just happy paths.

Required tests:
- timeout-but-settled (no resend)
- proven-absent (resend, same txid)
- attempt exhaustion (parked for review, nothing reverts)
- reconcile twice with the same window → identical state
- four send outcomes each take distinct paths

Thinking about the domain model.

### Domain model

An order (payment order to a supplier). Fields:
- id
- supplier key (key passed to bank.send)
- amount_cents (integer, minor units)
- effective_date (date the payment applies to) — txid is derived from order + effective date
- state: pending, in_flight (accepted, awaiting statement), duplicate? hmm.

Let me define states carefully.

Order states:
- `pending` — never sent, or eligible to send
- `in_flight` — bank accepted, awaiting statement
- `settled` — statement entry matched
- `rejected` — permanently rejected? Wait — "permanent rejection — malformed, blocked account, closed beneficiary". What to do with a permanently rejected order? Rejected by bank — order did not go through. Can we retry? The spec says cap attempts at 5, after that park for manual review. Hmm, does the attempt cap count all send attempts including permanent rejections? The spec says "cap attempts at 5. After that, order goes to a terminal state that a human reviews."

Let me re-read: "Resend logic: orders whose send failed/timed out may only be resent after reconciliation proves they are not on the statement past the publish lag. Cap attempts at 5. After that, park for manual review and never auto-revert."

So the attempts cap is about the resend loop. Permanent rejection — the send didn't go through (bank rejected it). Since we have definitive evidence that the send didn't execute, a resend is safe even without waiting for reconciliation to prove absence — the bank is telling us it didn't accept it. But should we auto-resend a permanently rejected order? That's a business judgment. Defensible reading: a permanent rejection is a known failure (not "unknown outcome"), so a retry with the same txid is safe and doesn't need evidence of absence. But should it auto-retry or park?

Hmm. "Never auto-revert, never release, never mark as failed and forget — same reasoning as the transient case: we don't know, and the safe direction is to stop and escalate." That's about exhaustion.

For permanent rejection: the bank told us the send was rejected. The safe interpretation is that a permanently rejected order should also be parked for manual review (not auto-resent), because a permanent rejection (blocked account, closed beneficiary) won't change on its own — resending immediately will just fail again. Hmm, but "malformed" is fixable…

Let me think about what's most defensible. The spec lists four outcomes with distinct handling:
- accepted → mark in_flight, wait for statement
- duplicate → this is a success. The bank already has this txid. So the order is in flight/settled. Mark as in_flight (statement will confirm) — or directly settled? The statement may already include it. Safest: mark as in_flight (bank has the txid so it will appear on the statement). Actually "duplicate" means the bank already has this txid — so the original send was accepted. The order is already in flight. So state = in_flight.
- transient error → outcome unknown. Record as "unknown outcome" / awaiting evidence. Don't resend from the send path. Reconciliation decides: if past lag and not on statement → eligible to resend (same txid). If on statement → settled.
- permanent rejection → outcome known: did not go through. Mark as rejected. Options: park for manual review, or retry.

Given "cap attempts at 5. After that, park for manual review," and the attempts counter is incremented on each send attempt, I think the cleanest, most defensible design is:

- Each call to bank.send increments `attempt_count`.
- After a permanent rejection, the outcome is known (not sent). If attempts < 5, the order becomes `pending` again (eligible to send, safe because rejection is proof of non-execution). If attempts >= 5 → `parked` (needs manual review).
- After a transient error, the order becomes `unknown` (awaiting evidence). Resend only via reconciliation, if past lag and not on statement. If attempts >= 5 after the failed attempt… hmm, when do we decide exhaustion in the transient case? If an order has attempted 5 times and the 5th timed out, reconciliation proves absence — but attempts are exhausted — it should park, not resend. So: transient → state `unknown`. Reconciliation for `unknown` orders past lag: if found on statement → settled. If not found: if attempt_count >= 5 → parked. Otherwise → resend (pending with same txid, or send directly?).

Design decision: does reconciliation send directly, or mark as pending and let executePayments send? "reconcile(window) … only then is a resend with the same derived txid allowed." The acceptance criteria say "send timed out and the order is proven absent past lag → resend, same txid." This can be read as: reconcile makes the order eligible for resend, and the resend happens via the send path (executePayments). That keeps the send logic in one place (service.sendOrder), and reconcile is evidence-based. But the acceptance criteria say "proven absent → resend" — tests should verify a resend happens. If reconcile only marks as pending, the "resend" test requires running executePayments after reconcile. That's fine, and arguably cleaner: reconcile never sends. Only executePayments sends. Hmm.

Actually, let me reconsider: "reconcile(window) is the only path to a resend." That means reconciliation is the gate/decision that permits a resend — not necessarily that it performs the send itself. The decision "this order may be resent" must come from reconciliation. Implement reconcile so that for proven-absent, attempts-under-cap orders it transitions them back to `pending` (resend-eligible) — and executePayments picks up `pending` orders and sends with the same derived txid. That way "the only path to a resend is reconciliation proving absence" is literally true: the only way an unknown order becomes pending again is via reconcile.

Wait — but subtle point: for a permanent rejection, I said the order also becomes pending again. That would mean a permanent rejection also becomes a "path to resend" without reconciliation. Does that violate "the only thing that can cause a resend is reconciliation proving absence"?

Hmm. Let me re-read the issue: "The only thing that can cause a resend is reconciliation proving absence. Not timeout, not exception, not retry counter. The send path may record that it doesn't know the outcome, but must not act on that."

That's specifically about the transient/unknown case — the incident was a resend after a timeout. For a permanent rejection, we have definitive proof of absence (bank said "no"). So resending a permanently rejected order is safe — the bank explicitly told us it didn't accept it. But the spec is strict: "the only thing that can cause a resend is reconciliation proving absence."

Two defensible readings:
A) Permanent rejection → park for manual review (no auto-retry at all). Only transient+proven-absent leads to auto-resend. This is the strictest reading and simplest: the only auto-retry path is reconcile-proven-absent.
B) Permanent rejection → retry immediately (outcome is known, not unknown).

The spec says "each gets its own handling. Four outcomes and not two." So permanent rejection needs its own handling that differs from transient. Under reading A, permanent rejection → park? But parking is "after 5 attempts"… A permanent rejection on attempt 1 parking immediately feels too aggressive — a "malformed" txid could be a bug we'd want to catch, and a "closed beneficiary" needs manual fix anyway.

Hmm, let me think about what an actual treasury system would do. Actually, I think the most defensible design is this:

- accepted → `in_flight`
- duplicate → `in_flight` (bank has it. Statement will settle it)
- transient → `outcome_unknown` (awaiting evidence; reconciliation decides)
- permanent → `rejected_permanent` … hmm.

Let me think about the acceptance criteria again: "each of the four send outcomes takes a distinct path." So in tests I need four distinct state transitions/behaviors:
1. accepted → in_flight
2. duplicate → in_flight (same state as accepted? "distinct path" — different classification, but could land in same state. Hmm, "distinct path" might just mean each classified and handled separately. To be safe, should duplicate land in a different state? What's semantically different? Duplicate means the bank already has this txid — the first send was accepted. The order is in flight. Honestly `in_flight` is correct. Distinct path = distinct classification code / handling branch, landing in the same state is fine, I think. But to be more distinct: mark duplicate as in_flight with a flag, or… let's keep it simple: both in_flight. In tests, verify the classification and resulting state. "Distinct path" is about how each outcome is handled, not necessarily 4 distinct terminal states. Actually wait — to make paths observably distinct, I could log the classification… tests shouldn't assert on logs.

Hmm, or: duplicate → settled directly? No — the statement may not have published it yet (publishing lag), but the bank said it has the txid. "Duplicate" from bank.send means the bank has this txid — it's either in flight or already settled. Marking as in_flight is honest. Statement will confirm. If the statement already includes it, reconcile will settle it. Mark as in_flight.

3. transient → outcome_unknown, no resend from send path
4. permanent → rejected. What happens next? Let me choose: a permanently rejected order does NOT auto-resend (resend of a rejected payment to a closed beneficiary is pointless. And strictly, "only reconciliation proves absence" → a permanent rejection IS a bank-provided proof of absence, so… ugh).

OK let me decide cleanly with a documented ASSUMPTION comment:

**Decision:** A permanent rejection marks the order as `rejected_permanent`. It does not auto-retry (resending to a blocked/closed beneficiary will fail the same way. And the spec is strict that only reconciliation proves absence). The order stays in `rejected_permanent`… but wait, is that a terminal state that "no one reverts"? The spec says the exhaustion state is terminal-pending-review, "never auto-revert." A permanently rejected order should also be human-reviewable. But then what's the difference between `rejected_permanent` and `needs_review`?

Alternative: treat permanent rejection as consuming an attempt, and if attempts < cap, return the order to `pending` (safe retry — bank explicitly said "rejected, did not execute"). This is actually a common pattern in payment systems: permanent rejection from the bank is a definitive non-execution, so retry is idempotency-safe. The "only reconciliation proves absence" rule is about unknown outcomes (timeouts), where we don't know. The whole thrust of the issue is about timeouts being treated as failures. Permanent rejection is not a timeout.

Hmm, but "the only thing that can cause a resend is reconciliation proving absence" is stated unconditionally in the "What we need" section…

Let me re-read once more: "**The only thing that can cause a resend is reconciliation proving absence.** Not timeout, not exception, not retry counter."

"Not exception" — a permanent rejection is… well, a rejection is a definitive response, not an exception. "Not exception" refers to the send throwing (network error). Hmm.

I think I have to make a judgment call and mark it as an ASSUMPTION. Which is more defensible?

Considering real-world payment systems (Stripe, bank APIs): permanent rejections (e.g., account closed) are terminal — don't auto-retry because retrying won't succeed. You surface to a human/operator. Transient errors get retried. So:

- permanent rejection → state `rejected` (terminal, human-reviewable, never auto-resent, never auto-reverted). This is a distinct path: no retry, no reconciliation wait, no park-after-5 (it's immediately terminal).

This gives four clearly distinct paths:
1. accepted → in_flight → (reconcile: statement) → settled
2. duplicate → in_flight (bank already has it) → settled via reconcile
3. transient → outcome_unknown → (reconcile past lag: present → settled. Absent and attempts < 5 → pending → executePayments resends with same txid. Absent and attempts >= 5 → needs_review)
4. permanent → rejected (terminal, human review, no auto-action)

And attempt exhaustion: a transient order that has been sent 5 times and proven absent → `needs_review` (parked). Never auto-revert.

I like this. Clean, defensible, and matches "each of the four send outcomes takes a distinct path."

Hmm wait, but does it make sense to cap attempts at 5 with a resend only after ~30min+ each time? Timeline: attempt 1 at T0 times out. T0+30min proven absent → resend (attempt 2). T0+X times out again… each cycle needs lag passage. 5 attempts total including the initial send. OK: `attempt_count` increments on each bank.send call. Cap = 5.

Let me define the order states (state machine):
- `pending` — eligible to send (initial, or released by reconcile after proven absence)
- `in_flight` — bank accepted / duplicate confirmed. Awaiting statement
- `outcome_unknown` — last send was transient error. Awaiting reconciliation evidence
- `settled` — matched on statement (terminal, success)
- `rejected` — permanent rejection (terminal, human review)
- `needs_review` — attempts exhausted (terminal, human review)

All terminals: settled, rejected, needs_review. "Never auto-revert" — transitions only in the forward direction, and terminal states are never touched by executePayments or reconcile (except reconcile must not reprocess a settled order: "orders already matched are skipped before any decision is made about them").

Wait, one more thing about `in_flight` orders in reconciliation: if an in_flight order's txid is on the statement → settled. What if in_flight and not on statement? Do nothing (bank hasn't published yet, or… it's there eventually). In_flight orders do NOT become resend-eligible — the bank accepted them, they will land. Only `outcome_unknown` orders are candidates for resend. Important: don't resend in_flight orders that are late on the statement. That would be a double payment. Resend candidates are only `outcome_unknown` past lag and not on the statement.

Hmm wait, is that right? If the bank accepted (accepted outcome), the payment is in flight — the bank guarantees execution (or returns a rejection). So no resend. Correct.

Now, `executePayments()`:
- Fetch all `pending` orders.
- For each: derive txid = deterministic function(order.id, effective_date).
- Call bank.send({txid, amount, key}).
- Classify response:
  - accepted → in_flight, attempts+1
  - duplicate → in_flight, attempts+1
  - transient → outcome_unknown, attempts+1 (if attempts+1 >= 5? no — exhaustion applies at the decision point: if a 5th attempt times out, the next reconcile sees attempt_count=5 and no evidence → park. If I park at send time, I'd be acting on the timeout, which is exactly what the issue says not to do. Wait — is parking at send time "acting on the timeout"? Parking is not a resend. But the spec ties exhaustion to the resend loop: "cap attempts at 5. After that, the order goes to a terminal state that a human reviews." Hmm, when exactly does it go there? If the 5th attempt is transient (unknown), we don't know if it executed. Parking immediately at send time means "we don't know, and we've used our retries, so stop and escalate" — that's defensible and consistent with "the safe direction is to stop and escalate." But if the 5th attempt actually settled, parking + human review is still safe (human sees the settled state… wait, no, if we parked, reconcile skips it? If reconcile skips needs_review orders, a settled order would be parked incorrectly).

Careful! If I park at send time (attempt 5 transient), and the payment actually landed, then reconcile would have to check needs_review orders against the statement and… release them? "Never auto-revert" — I can't auto-move needs_review → settled. So a parked-but-actually-settled order would be a false alert for the human. Whereas if I park at reconcile time (after proven absence), the human sees "proven absent, 5 attempts, parked" — accurate.

So exhaustion parking MUST happen in reconcile, at the decision point: "orders still awaiting evidence past the publish lag, if absent from the statement … only then is a resend … allowed." And if attempts are exhausted → park instead of resend. So:

reconcile for `outcome_unknown` orders whose `last_attempt_at` is older than now - LAG (i.e., lag has passed since the last send):
- on statement (txid match) → settled
- not on statement:
  - attempt_count >= MAX_ATTEMPTS (5) → needs_review (parked, terminal)
  - else → pending (resend-eligible, same derived txid — no new txid since it's derived)

For `in_flight` orders: if txid on statement → settled. Else nothing (wait).

Hmm, should in_flight orders also be checked against the statement with a lag? Yes — match any non-terminal order (in_flight, outcome_unknown) to the statement. Only outcome_unknown past lag can be acted on (settled or moved). in_flight past lag and not on statement: still do nothing — the bank accepted it. It will publish. (ASSUMPTION note.)

What about a window? `reconcile(window)` — window is presumably a range of effective dates or a range of statement dates to fetch. `getStatement(date)` takes a date and returns settlements for that day (with lag). So reconcile(window) where window = {from, to} (dates, inclusive) fetches the statement for each date in the window, aggregates settlements, and processes.

"Safe to run every 15 minutes, including overlapping windows." So the job is: every 15 minutes, reconcile(window = past ~N hours/dates overlapping prior windows). Idempotency: settled is skipped. Outcome is deterministic.

Design of `reconcile(window)`:
1. Fetch statement for each date in window → map txid → Settlement.
2. Load all non-terminal orders with effective_date in window? Hmm — wait. Which orders does reconcile look at? An order's effective date determines its statement date (presumably: payment on effective date appears on that date's statement). So: load orders with effective_date in [window.from, window.to] and state in (in_flight, outcome_unknown, pending?).

Hmm, pending orders — do they appear in reconcile? A pending order has either never been sent, or was released for resend after proven absence. If released for resend, it will be sent by executePayments soon. If it's still pending (not yet sent), should reconcile do anything? Its previous send (if any) is proven absent… but wait, if it's `pending` again (released), we don't want reconcile to keep releasing it. It's already pending. Reconcile only acts on in_flight and outcome_unknown. Pending orders: skip (executePayments handles them).

Actually wait — what about a pending order that was never sent, but somehow a settlement for its txid appears on the statement? Can't happen — no send = no settlement (txid is derived but never submitted). Edge case, ignore.

3. For each non-terminal order in window:
   - state settled → skip (already matched, idempotency)
   - txid on statement:
     - in_flight or outcome_unknown → settled (record settlement reference: settlement_id, amount verification?)
   - txid not on statement:
     - in_flight → do nothing
     - outcome_unknown:
       - last_attempt_at < now - LAG:
         - attempt_count >= 5 → needs_review
         - else → pending (resend-eligible)
       - else → do nothing (lag not yet passed)

Lag: "up to ~30 minutes." Make it a configurable constant (30 min) — config from environment? "Configuration comes from environment variables only. DATABASE_URL for Postgres." So app config from env. Lag could be `RECONCILE_LAG_MINUTES` with a default. Hmm, "no secrets, no hardcoded connection strings" — defaults for non-secret config are probably OK, but to be safe, read from env with a sane default. Actually the convention says "configuration comes from environment variables only" — I'll use a small config provider that reads `RECONCILE_LAG_MINUTES` (default 30), `MAX_SEND_ATTEMPTS` (default 5). Hmm, "configuration comes from environment variables only" — providing a default when env var is unset is fine (the value still comes from env if set). Keep it simple: read process.env in a small config module, with documented defaults. Actually, to minimize file count… the task says "deliver the schema, service, reconcile job, and tests" — deliverables: Prisma schema, service with executePayments() and reconcile(window), the scheduled reconcile job, and tests. Plus presumably the module wiring (NestJS), a bank client abstraction, and tests.

"Assume nothing about the bank API beyond `bank.send({txid, amount, key})` and `getStatement(date) -> Settlement[]`." So I define the interface:

```ts
interface BankClient {
  send(input: { txid: string; amount: number; key: string }): Promise<BankSendResult>;
  getStatement(date: string): Promise<Settlement[]>; // date: YYYY-MM-DD
}
```

BankSendResult — four outcomes. How to classify? The bank response is unspecified, so I define an enum/classification:

```ts
type BankSendOutcome =
  | { kind: 'accepted' }
  | { kind: 'duplicate' }
  | { kind: 'transient'; reason?: string }
  | { kind: 'permanent'; reason?: string };
```

But in reality, the bank returns HTTP-ish responses. Since we can't assume anything, define a thin `BankGateway` interface with `send` returning a raw response, and a `classifySendResponse` function? Hmm — "assume nothing about the bank API beyond bank.send({txid, amount, key}) and getStatement(date) -> Settlement[]" — so we should just call `bank.send(...)` and receive something classifiable. The cleanest is: a `BankGateway` port:

```ts
export interface BankGateway {
  send(input: BankSendInput): Promise<BankSendResult>;
  getStatement(date: StatementDate): Promise<Settlement[]>;
}

export type BankSendResult =
  | { outcome: 'accepted' }
  | { outcome: 'duplicate' }
  | { outcome: 'transient'; detail: string }
  | { outcome: 'permanent'; detail: string };
```

And Settlement:

```ts
export interface Settlement {
  txid: string;
  amount: number; // minor units
  key: string;
  settledAt: string; // ISO timestamp?
  status?: ...
}
```

Keep minimal: txid, amount (minor units int), maybe settlementRef. Spec: "getStatement(date) -> Settlement[] (each has the txid we sent)." So the required field is txid. I'll include `txid`, `amount` (int minor units), `key`. Amount matching is a good safety check: if statement amount ≠ order amount, that's an anomaly — don't auto-settle? Over-engineering risk. Keep: match by txid. If amounts differ, that's a data integrity alarm — treat as an anomaly (don't settle, park?) — hmm, "do exactly what the task asks." Matching by txid is the spec. I'll match by txid and note amount equality as an integrity check. Discrepancy → don't auto-settle, mark needs_review? That adds state transitions not requested. Just match by txid. Actually I could do a cheap assertion-like check: if amounts differ, throw/log an anomaly and skip the order (leave state). Keep it simple: match by txid only. Actually the bank's Settlement has amount and we store amount_cents, a mismatch is a real danger signal. Let me include it: on txid match, if settlement.amount !== order.amount_cents → don't settle, mark as `needs_review` with a reason? "Do exactly what the task asks. Don't create files it doesn't ask for, don't improve code that wasn't asked to be changed." An amount-mismatch branch is arguably scope creep. But it's 5 lines… Let me include a minimal check: throw? No — throwing mid-reconcile would break the idempotent loop. Include: txid match + amount match → settled. txid match + amount mismatch → skip (leave state) with a console warning… hmm, service shouldn't console.log in tests.

Decision: keep it strict and simple — match by txid only, that's the spec ("return the txid we sent"). Skip amount verification. (Can note in a comment.) Actually — hmm, one more reconsideration. "Matches settlement entries to orders" — by txid (derived txid is the whole point of the issue). Yes, txid only.

Now txid derivation: "derived deterministically from stable order attributes and the effective date so that the same order on the same date always produces the same txid."

Implementation: `txid = 'po_' + sha256(order.id + '|' + effectiveDate)` hex truncated? Or full hex. Bank txid format is unspecified. A stable string is fine. Use Node crypto's `crypto.createHash('sha256').update(`${order.id}:${effectiveDate}`).digest('hex')` → 64 hex chars. Prefix maybe. Let me do: `deriveTxid(orderId, effectiveDate) = sha256Hex(`${orderId}:${effectiveDate}`)`. Deterministic, stable. Note in a comment that the derivation must never change without a data migration (changing derivation = new txids = unmatchable history).

Schema (Prisma, snake_case via @@map):

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql", url = env("DATABASE_URL") }

model PaymentOrder {
  id            String   @id @default(cuid())
  supplierKey   String   @map("supplier_key")
  amountCents   Int      @map("amount_cents")
  effectiveDate DateTime @map("effective_date") @db.Date
  state         OrderState @default(PENDING) @map("state")
  attemptCount  Int      @default(0) @map("attempt_count")
  lastAttemptAt DateTime? @map("last_attempt_at")
  settleRef     String?  @map("settle_ref")
  settledAt     DateTime? @map("settled_at")
  parkedReason  String?  @map("parked_reason")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")
  @@map("payment_orders")
}

enum OrderState { PENDING IN_FLIGHT OUTCOME_UNKNOWN SETTLED REJECTED NEEDS_REVIEW }
```

Hmm wait, effective date: `@db.Date` is a date. `getStatement(date)` takes a date. Store effective_date as Date (not DateTime) — "effective date" is a date. Use `DateTime @db.Date`. That works in Prisma.

Should amount be BigInt? Int (minor units) can overflow 32-bit for huge amounts (2^31 cents ≈ €21.4M). Postgres bigint is safer for money. Prisma `BigInt @map("amount_cents")`. "Money is minor units, integers only" — BigInt is integer. Let me use BigInt for correctness. JS tests handle BigInt fine. bank.send's amount: number or string? Interface says amount in minor units int. Let me define `amount: number` in the bank interface… BigInt is safer. But JSON serialization etc. Keep `number` in the gateway interface? Hmm. A single supplier payment realistically won't exceed 2^31 cents (€21.4M) but platforms pay suppliers… For safety: BigInt in DB, number in the bank API contract (the bank presumably uses its own units. Our contract says minor units int). Ugh, friction. Decision: use `number` (safe integer) everywhere in the TS layer and `BigInt @db.BigInt` in the DB? Then repository converts. Adds friction. Or Int (max €21.4M per order) — plenty for a single payment order, and the incident amount was €18,400. Use `Int`? Hmm, "integers only" — Int is integer. Let me use `Int` with a comment (cap is ~€21.47M per order, sufficient for a single payment instruction). Actually no — let me use BigInt @db.BigInt, it's the money-correct choice, and pass number to the bank? No wait, the repository converts BigInt↔number…

Simpler decision: `Int` in Prisma (Postgres integer). Single payment order amounts in cents: 2,147,483,647 cents = €21,474,836.47. Fine for a single supplier payment. And keeps the TS type a plain `number` end-to-end, "integers only." Add a comment. OK, Int.

Now layers:

Files:
1. `prisma/schema.prisma`
2. `prisma/migrations/20250101000000_init/migration.sql` — wait, migrations are generated by prisma. I have to handwrite the SQL. Since there's no shell, I'll write the migration SQL that matches the schema. Name: `0001_init` or a timestamp-like name. Let me use `20250601000000_init/migration.sql`… any name works. Let me do `0001_init/migration.sql`? Prisma convention is `<timestamp>_init`. Use `20250101000000_init/migration.sql`. Hmm, "every schema change ships with a migration" — yes, include it.

Migration SQL:

```sql
CREATE TYPE "OrderState" AS ENUM ('PENDING', 'IN_FLIGHT', 'OUTCOME_UNKNOWN', 'SETTLED', 'REJECTED', 'NEEDS_REVIEW');

CREATE TABLE "payment_orders" (
    "id" TEXT NOT NULL,
    "supplier_key" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "effective_date" DATE NOT NULL,
    "state" "OrderState" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "settle_ref" TEXT,
    "settled_at" TIMESTAMP(3),
    "parked_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" -> "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);
CREATE INDEX ... maybe on state and effective_date.
```

Index: reconcile queries state IN (...) + effective_date range. Index on (state, effective_date)? Or (effective_date, state)? A single composite index `CREATE INDEX "payment_orders_effective_date_state_idx" ON "payment_orders"("effective_date", "state")` would work. Add one index.

3. `src/main.ts` — bootstrap Nest app, maybe register a global exception filter for the error envelope? Error envelope convention: `{ "error": { code, message, details } }`. Do we need HTTP endpoints? The layout has controllers, and the convention says endpoints kebab-case plural. The task deliverables don't explicitly ask for an API endpoint, but the repo layout convention includes controllers, and "controller validates input and calls the service." What would the API expose? Reasonable: `POST /payout-orders/execute` (triggers executePayments), `POST /payout-orders/reconcile` (triggers reconcile with a window), maybe `GET /payout-orders`. Also a scheduled job every 15 minutes — "the scheduled reconcile job" is a deliverable.

Scheduled job in NestJS: `@nestjs/schedule`'s `@Cron` or `@Interval`. Use `@nestjs/schedule` and `ScheduleModule`, with a processor that calls `reconcile(window = past ~2 hours)` every 15 minutes. Window for a 15-minute run: overlapping windows required. Window = [today - 1 day, today]? Since getStatement is per date with a ~30min lag, a 15-minute job needs to cover the current date (and possibly yesterday for late entries?). "Safe to run every 15 minutes, including overlapping windows" — the job itself uses a window that overlaps with the previous run. Let me have the job pass `window = { from: today-1d, to: today }` (inclusive dates). Each run fully overlaps with the previous. Idempotency makes this safe.

Also a processor file: the layout has `src/<feature>/<feature>.module.ts`, controller, service, repository. The wiring notes mention "processor": "services, repositories, and processors are listed in their module's providers." So a `payout.processor.ts` (or `reconcile.processor.ts`)? The naming convention is `kebab-case.role.ts`. Feature: `payout`. Files: `payout.module.ts`, `payout.controller.ts`, `payout.service.ts`, `payout.repository.ts`, and a job: `payout.processor.ts`? Hmm, "reconcile job" — a processor decorated with `@Cron('*/15 * * * *')`. Let me name it `payout.processor.ts` containing a `PayoutProcessor` with a `@Cron` reconcile job + maybe an executePayments job? The spec deliverable is "the scheduled reconcile job" — only reconcile is scheduled. executePayments can be triggered via the API endpoint.

Wait — actually, should executePayments also be scheduled? The task: "deliver the schema, service, reconcile job, and tests." Only the reconcile job is scheduled. executePayments is exposed via controller (POST) — "controller validates input and calls the service" fits: POST /payout-orders/execute (no body) and POST /payout-orders/reconcile {from, to}.

Endpoint naming: kebab-case plural. `POST /payout-orders/execute`, `POST /payout-orders/reconcile`. Both under plural `/payout-orders`. Good.

Error envelope: need a global exception filter that maps exceptions to the envelope. Convention: "Errors — single envelope" — this is a repo-wide convention, so I'll implement a `global-exception.filter.ts` in the feature? Layout is `<feature>/<feature>.<role>.ts`. A filter is cross-cutting… The layout says "decide the file layout yourself. Nothing dictates it here" (the task's formatting note says the layout above is a codebase convention…). Hmm, the convention block says "layout" with that tree, but the task says decide the layout yourself. The convention block is "these always hold." The tree is guidance. The wiring rules (providers/exports) always hold. I'll mostly follow the tree:

- prisma/schema.prisma
- prisma/migrations/.../migration.sql
- src/main.ts
- src/app.module.ts
- src/payout/payout.module.ts
- src/payout/payout.controller.ts
- src/payout/payout.service.ts
- src/payout/payout.repository.ts
- src/payout/payout.processor.ts
- src/payout/bank-gateway.ts (port interface + Settlement type)
- src/payout/txid.ts? — deriveTxid helper. Or in service? Helper file: `src/payout/txid.ts`. Hmm, the naming is `kebab-case.role.ts` — a roleless file? `txid.ts` has no role suffix. Could go in service or a `txid.util.ts`. Put deriveTxid in `src/payout/txid.util.ts`? Hmm. Or as a pure function in the service file? Tests import it. A small `txid.util.ts` is fine. Actually simpler: keep it as an exported pure function inside the service file? But "no raw SQL, no Prisma in service" — pure functions are fine. But a separate file is cleaner for testing. Let me do `src/payout/txid.util.ts`. Hmm — "TS file: kebab-case.role.ts" — `txid.util.ts` fits `name.role.ts` with role=util. OK.
- src/payout/prisma.service.ts? A Prisma client wrapper — a common NestJS pattern: `PrismaService extends PrismaClient`, provided/exported by a module. The repository depends on it. Where does it live? Not in the layout tree, but we need it somewhere. Common: `src/prisma/prisma.module.ts` + `src/prisma/prisma.service.ts`. That adds a module to import in the payout module. That's the cleanest "wiring": the payout module imports the PrismaModule. Let me include `src/prisma/prisma.service.ts` and `src/prisma/prisma.module.ts`.

Wait — does the repository "touch the database" only via PrismaService? "Repository is the only layer that touches the database" — a PrismaService (client wrapper) is the shared client, and the repository is the only place that calls its query methods. That's the standard interpretation.

- src/payout/bank-gateway.ts — interface + `@Injectable() class BankGateway`?? The bank client itself: "assume nothing about the bank API beyond bank.send and getStatement" — so I define a port and in tests inject a fake. Should I ship a real implementation? There's no actual bank SDK. Shipping a fetch-based implementation is pure guessing (no endpoint, no auth details). So: define the `BankGateway` interface, and in the module provide a token-based injection: the module provides BankGateway with a factory that… hmm, if I can't implement it, what's provided at runtime? Options:
  a) Define the interface and mark `// ASSUMPTION: the real bank SDK client is wired in here`. Provide a stub that throws? A stub that throws at runtime is bad, but honest: the real adapter is environment-specific (credentials, endpoints we don't know).
  b) Implement a minimal HTTP adapter with env config (BANK_API_URL etc.) — but "assume nothing about the bank API beyond bank.send({txid, amount, key}) and getStatement(date)" — an HTTP impl is inventing an API shape (paths, auth). The instruction says assume nothing beyond those two operations. So a port + factory that reads env? I think the defensible reading is: define the `BankGateway` port, the module injects it, and the factory instantiates an adapter. Since the real bank integration is out of scope, provide an `HttpBankGateway`? No — I'll not invent endpoints.

  Decision: `bank-gateway.ts` defines the contract (types + injection token + a minimal adapter that throws `not_implemented`? Hmm.) Actually, cleanest: define the interface, and in `payout.module.ts` provide a factory that constructs the adapter from env… I keep coming back to inventing HTTP details.

  Let me do this: `bank-gateway.ts` exports the interface and the types, and a `BankGateway` class implementing it that throws on call with a clear message (`// ASSUMPTION: the real bank SDK/HTTP adapter is out of scope; tests inject a fake, production wires the vendor client here`). Hmm, throwing adapter at runtime = a broken production app. But the task is an evaluation of reconciliation logic. "Assume nothing about the bank API" strongly implies: abstract it, don't guess. Let me write an adapter that reads `process.env.BANK_...`? No.

  Final decision: port interface + `@Injectable() class BankGateway` with methods that `throw new Error('BankGateway is a port; provide a vendor adapter in this environment')`. With an ASSUMPTION comment. Tests inject a fake. Module provides `BankGateway` (the default). That's honest and keeps DI clean.

  Hmm wait, actually — maybe simpler and more honest: the module provides the token with the default class. OK.

- test/payout.service.spec.ts — main behavior tests.

Also an exception filter for the error envelope: `src/common/exception.filter.ts`? The convention says the error envelope with code is "the contract." The controller returns a 200/201 with plain data, and on error — e.g., POST /payout-orders/reconcile with invalid window → 400 with envelope `{error: {code: 'invalid_window', ...}}`. Controller "validates input" — if window is invalid → throw a custom exception, mapped by the filter to the envelope. Add a small `src/common/...`? The layout tree doesn't have a common directory. Could put the filter inside the payout feature: `src/payout/payout-exception.filter.ts`? A filter isn't a <feature>.<role> pattern but kebab-case… `payout.filter.ts`? Hmm. Or handle it in the controller with try/catch → HttpException with a custom body? Nest's HttpException lets you set a custom body — the controller could catch and throw `new BadRequestException({error: {...}})`? That pushes envelope construction into the controller (allowed: "controller validates input"). But the envelope is a repo-wide contract. A global filter is the right tool. Let me create `src/common/all-exceptions.filter.ts` and a `src/common/api-exception.ts` (custom `ApiError` class with code + details). Register the filter in main.ts. That's the standard NestJS pattern (Catch filter). "Don't create files it doesn't ask for" — the envelope is a stated convention of the codebase ("these always hold"), so implementing it is in scope. Keep it minimal: one filter file + one exception class file. Or both in one file? A class + filter in one file is fine: `src/common/api-error.ts` with `ApiError extends Error` and `AllExceptionsFilter`. Hmm, two exports in one file — acceptable. Actually let me keep the two small files separate… Let me minimize: `src/common/api-error.ts` (ApiError with code/message/details, static factories) and `src/common/exception-filter.ts` (AllExceptionsFilter). OK.

Now the service. Core logic:

```ts
@Injectable()
export class PayoutService {
  constructor(
    private readonly orders: PayoutRepository,
    private readonly bank: BankGateway,
  ) {}

  async executePayments(): Promise<ExecuteSummary> {
    const pending = await this.orders.findPending();
    for (const order of pending) {
      const txid = deriveTxid(order.id, order.effectiveDate);
      const result = await this.bank.send({ txid, amount: order.amountCents, key: order.supplierKey });
      await this.handleSendResult(order, result, txid);
    }
    return summary;
  }
```

handleSendResult:
- accepted: `await this.orders.markInFlight(id, now)` (attemptCount+1, lastAttemptAt=now, state IN_FLIGHT)
- duplicate: same → markInFlight (bank already has the txid. Statement will confirm). Distinct path: the classification is logged/recorded? To make it observably distinct… both in_flight. The test asserts state = IN_FLIGHT and that the bank was called. "Distinct path" is satisfied by separate classification branches. Hmm, I want the four paths to be distinguishable in tests. Let me see what tests can observe:
  1. accepted → state IN_FLIGHT, attempts 1
  2. duplicate → state IN_FLIGHT, attempts 1 — observably the same as accepted!
  
  Is that a problem for "each of the four send outcomes takes a distinct path"? The test verifies each outcome is handled: for duplicate, the key behavior is "it's success, not an error" — the order goes IN_FLIGHT, doesn't error, doesn't count as unknown. If accepted and duplicate land in the same state, the tests for both look identical. To make the paths distinct, should duplicate land in a different state? What's semantically different? A duplicate means a previous send with the same txid was already accepted by the bank. The previous send's state was… the order should already have been in_flight or outcome_unknown. Duplicate on resend after proven absence? Can't happen (proven absent = not on statement, but the bank could have it unpublished… no wait, proven absent means past lag and not on statement = bank doesn't have it. A subsequent send getting "duplicate" means… the bank has that txid — contradiction, except in the case of statement inconsistency. Edge.) Duplicate is most likely: we sent, got a transient error, actually the bank accepted. Reconcile: past lag, not on statement (published lag… hmm, if the bank accepted, the statement will show it within 30 min. So at the point reconcile says "proven absent," the bank shouldn't have it. But if the bank accepted and statement generation broke — the bank said "duplicate," meaning it has the txid → the order must be in_flight, not pending!).

  Oh wait, this is important: if executePayments resends (released by reconcile) and the bank responds "duplicate," that means the bank DOES have the txid — our "proven absence" was wrong (statement gap). Handling: mark as IN_FLIGHT (bank has it, wait for statement). Same as accepted. OK.

  So both in_flight. To distinguish in tests, I could store the classification of the last result? Add a column `last_result` (enum: accepted, duplicate, transient, permanent)? That makes paths observable: `last_result` column. Legitimately useful for operations (a human reviewing needs_review wants to know the last result). Let me add `lastResult String? @map("last_result")` storing 'accepted' | 'duplicate' | 'transient' | 'permanent'. This gives distinct, testable paths for all four. Good.

- transient: mark state OUTCOME_UNKNOWN, attempts+1, lastAttemptAt=now, lastResult='transient'. No resend here. If attemptCount+1 >= MAX? Don't park here (parking is decided by reconcile after evidence — wait, should we? Let me reconsider. If attempts exhausted (5th) and transient: option A: park immediately at send time. Option B: wait for reconcile to confirm. Earlier I argued B is better (park only after proven absence, avoiding false parks if it actually landed). But hmm — is that right? "Cap attempts at 5. After that, the order goes to a terminal state that a human reviews." If the 5th attempt times out and we wait for reconcile, the order is in OUTCOME_UNKNOWN with attempts=5. Reconcile (past lag, absent) → NEEDS_REVIEW. If present → SETTLED. If we parked immediately, the landed case becomes a false park (can't auto-revert). So B. Confirmed: exhaustion is decided by reconcile.

  Hmm wait, actually there's a subtlety: is "parking at the exhaustion moment" (5th transient) — "never auto-revert" a problem with B? No: B parks at the reconcile decision, which is the only decision point. Good.

- permanent: mark state REJECTED (terminal), attempts+1, lastResult='permanent', maybe a `rejectionReason`. Terminal: human review. Distinct path.

reconcile(window):

```ts
async reconcile(window: { from: string; to: string }, now: Date = new Date()): Promise<ReconcileSummary> {
  // 1. fetch statement
  const dates = eachDate(window.from, window.to); // inclusive
  const settlements = new Map<string, Settlement>();
  for (const d of dates) {
    for (const s of await this.bank.getStatement(d)) settlements.set(s.txid, s);
  }
  // 2. load candidate orders: non-terminal, effective_date in window
  const orders = await this.orders.findAwaitingEvidence(from, to); // state IN (IN_FLIGHT, OUTCOME_UNKNOWN)
  const lagMs = this.config.lagMs;
  for (const order of orders) {
    if (settlements.has(txid)) {
      if (order.state === IN_FLIGHT || order.state === OUTCOME_UNKNOWN) {
        await this.orders.markSettled(order.id, txid, now); // idempotent: repository checks state?
      }
      continue;
    }
    if (order.state === OUTCOME_UNKNOWN && order.lastAttemptAt && now - order.lastAttemptAt >= lagMs) {
      if (order.attemptCount >= MAX_ATTEMPTS) await this.orders.markParked(order.id, 'attempts_exhausted', now);
      else await this.orders.markPendingForResend(order.id, now); // → PENDING, same derived txid
    }
    // IN_FLIGHT and absent: wait (bank accepted, statement will catch up)
  }
}
```

Idempotency / overlap safety:
- Settled orders are not in the candidate set (state is filtered) → "orders already matched are skipped before any decision is made about them." ✓
- Running twice: the first run settles/moves orders. The second run doesn't load them (no longer in the non-terminal state, or… wait, markPendingForResend sets state to PENDING — the next reconcile won't load PENDING orders (candidates are IN_FLIGHT/OUTCOME_UNKNOWN only). ✓ No double release.
- But: two reconcile runs in parallel? Out of scope (job is sequential). "Run twice" = sequential overlap. ✓
- Also, the repository's markSettled should be conditional (updateMany where state in non-terminal set) to avoid races and double-counting. Since service does zero Prisma calls, conditional update is in the repository: `markSettled(id, ...)` does `updateMany({ where: { id, state: { in: [IN_FLIGHT, OUTCOME_UNKNOWN] } }, data: {...} })` and returns the count. Service can use the count. Good — the repository encapsulates the safe transition. Same for markParked: `where: { id, state: OUTCOME_UNKNOWN }`, markResendable: `where: { id, state: OUTCOME_UNKNOWN }`, markInFlight: `where: { id, state: PENDING }` (only pending orders are sent), markRejected: `where: { id, state: PENDING }`. Conditional updates = no double-processing if the same order appears twice.

Wait, executePayments: it loads pending orders, sends, then conditionally marks (state still PENDING). If executePayments is called twice concurrently — out of scope. But the conditional guard is cheap and safe.

Hmm, one issue: in executePayments, after bank.send returns transient and attempts become 5… I decided to not park at send time. OK.

Another subtlety: `markPendingForResend` — release with the same txid. The txid is derived from (id, effective_date) — invariant. ✓ "Resend, same txid."

Now — is it correct to make it PENDING (and let executePayments send), or should reconcile send directly? Let me re-read: "reconcile(window) … for orders still awaiting evidence past the publish lag … only then is a resend with the same derived txid allowed." Acceptance criteria: "send timed out and the order is proven absent past lag → resend, same txid." My implementation: reconcile → PENDING → executePayments → bank.send with same txid. The test can run reconcile then executePayments and assert bank.send was called with the original txid and attempts=2. That satisfies "resend." And it keeps "send path" (the only code that calls bank.send) in one place — clean. I'm confident in this design. Also note: the send path "may record that it doesn't know the outcome but must not act on that" — executePayments never resends. Only reconcile releases. ✓ "The only thing that can cause a resend is reconciliation proving absence" — the only transition OUTCOME_UNKNOWN→PENDING is inside reconcile, conditioned on proven absence. PENDING→PENDING? executePayments doesn't re-PENDING an already-PENDING order. Initial PENDING orders are new. So all resends are gated by reconcile. ✓

But hmm — one more path to consider: a PENDING order that has never been sent (fresh) — executed by executePayments. That's an initial send, not a resend. Fine.

And REJECTED (permanent) — terminal, human action only. NEEDS_REVIEW — terminal, human action only. No auto-transitions out. ✓ "Never auto-revert, never release."

Now, the job: every 15 minutes. Window: which dates? Statements are per date. Lag ~30 min. A 15-minute job should reconcile the current date (and yesterday to catch late entries? "Up to ~30 min publish lag" — entries for date D appear on D's statement within ~30 min of settling. If settling near midnight, an entry for D could appear in the early hours of D+1 — still "D's statement" I think, since getStatement(date) returns entries for that date). The job window: `[today - 1, today]` (local date? Use UTC date). Overlap: yes, each run fully covers the previous run's window (both include today, and yesterday's date changes at midnight). Also allow manual window via the API.

Date handling: getStatement(date) — date as 'YYYY-MM-DD' string. In TS: store effectiveDate as Date (midnight UTC via Prisma's @db.Date). Helper `toDateKey(d: Date): string` → d.toISOString().slice(0,10). EachDate(from,to) — iterate days.

Lag check: `now - lastAttemptAt >= lagMs` (default 30 min, env `RECONCILE_PUBLISHING_LAG_MINUTES`).

Config: a small `PayoutConfig` — reads env in the module? Convention: "configuration comes from environment variables only." Let me have the service take config via constructor injection? Simplest: a `@Injectable() class PayoutConfig { get lagMs() { return (parseInt(process.env.RECONCILE_PUBLISHING_LAG_MINUTES ?? '30', 10)) * 60_000 } get maxAttempts() { return parseInt(process.env.MAX_SEND_ATTEMPTS ?? '5', 10) } }`. Provide in module. Tests can construct service with explicit config values? If tests construct the service directly with a fake config object (plain object literal), no env needed. Make the config an interface `PayoutConfig { lagMs: number; maxAttempts: number }` with a default implementation reading env. Tests pass literal `{ lagMs: 30*60000, maxAttempts: 5 }`. Clean. File: `src/payout/payout-config.ts`.

Now the repository:

```ts
@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  findPending(): Promise<PaymentOrder[]>
  findReconcilable(from: Date, to: Date): Promise<PaymentOrder[]> // state IN (IN_FLIGHT, OUTCOME_UNKNOWN), effective_date in [from, to]
  markInFlight(id: string, lastAttemptAt: Date): Promise<boolean> // PENDING → IN_FLIGHT, attempts+1, lastResult?
  markOutcomeUnknown(id, lastAttemptAt, lastResult): Promise<boolean> // PENDING → OUTCOME_UNKNOWN
  markRejected(id, lastAttemptAt, lastResult, reason): Promise<boolean> // PENDING → REJECTED
  markSettled(id, txid, at): Promise<boolean> // IN_FLIGHT|OUTCOME_UNKNOWN → SETTLED
  markNeedsReview(id, reason, at): Promise<boolean> // OUTCOME_UNKNOWN → NEEDS_REVIEW
  markPendingForResend(id, at): Promise<boolean> // OUTCOME_UNKNOWN → PENDING
  create(...) // for tests/seed? Does the task need create? The tests need to seed orders. Tests use the repository (with real or fake Prisma?).
}
```

Hmm — the tests. Vitest, "test behavior, not implementation." Testing the service needs a fake repository (in-memory) and a fake bank. "Don't just assert that a call happened" — assert resulting states/behavior. In-memory fake repository implementing the repository interface — but the service depends on the concrete `PayoutRepository` class. Make the service depend on an interface `PayoutOrderStore` that the repository implements? That adds an abstraction file. Alternative: tests construct `PayoutRepository` with a fake PrismaService? The fake PrismaService would have to emulate the updateMany semantics — heavy.

Hmm. "Repository is the only layer that touches the database" + "service has zero Prisma client calls." For testability, define a store interface in the service file? Or in the repository file: `export interface PayoutOrderStore { ... }` and `export class PayoutRepository implements PayoutOrderStore`. The service depends on the interface. The module provides the repository. In tests, inject a fake that implements the interface (a simple in-memory Map). That's clean, idiomatic, and lets tests focus on service behavior (the state machine). Let me do that: define the `PayoutOrderStore` interface in `payout.repository.ts` (co-located), the service imports the type.

Hmm wait, is that over-abstraction? It's a standard seam. OK.

But wait — should I also test the repository's conditional-update semantics? That needs a real DB (Prisma e2e). The Vitest convention here — unit tests with fakes. The required tests (timeout-but-settled, proven-absent, exhaustion, idempotent window, four outcomes) are all service-level. Test the service with fakes. Also a small test for the deriveTxid determinism, and date-window iteration. Good.

Now, "a test that only asserts a call happened" — my tests assert the resulting state and that the bank was called with the correct txid (that's part of the behavior: "same txid" — asserting the txid of the resend IS the behavior). Assert order.state transitions, attempt counts, and in proven-absent, the bank.send args. Good.

Let me design the fakes:

```ts
class FakeBank implements BankGateway {
  outcomes: BankSendResult[] = []; // scripted per call
  sent: BankSendInput[] = [];
  statements = new Map<string, Settlement[]>(); // dateKey -> Settlement[]
  async send(input) { this.sent.push(input); return this.outcomes.shift() ?? { outcome: 'accepted' }; }
  async getStatement(date) { return this.statements.get(date) ?? []; }
}
```

FakeStore: implements PayoutOrderStore with an in-memory `Map<string, OrderRecord>`. Methods mirror the repository but as plain functions (synchronous is fine. Service awaits — no problem, the service can `await` non-Promise values. But the interface says Promise — the fake can return `Promise.resolve(...)`).

OrderRecord shape for the store interface — what the service needs: id, supplierKey, amountCents, effectiveDate (Date), state, attemptCount, lastAttemptAt (Date | null). Use Prisma model type? The service shouldn't import Prisma types? Importing a model type is not "touching the DB." But cleaner: define a `PaymentOrderRecord` DTO in the repository file:

```ts
export interface PaymentOrderRecord {
  id: string;
  supplierKey: string;
  amountCents: number;
  effectiveDate: Date;
  state: OrderState;
  attemptCount: number;
  lastAttemptAt: Date | null;
}
```

And `OrderState` — a Prisma enum type or a TS union? If the store interface uses Prisma's `OrderState` enum import from `@prisma/client`, the fake needs it too — fine, it's a type import. But if the test environment doesn't have generated Prisma client (no shell, no generated client), importing from `@prisma/client` in tests would fail at runtime… in this evaluation environment, tests are probably run with the client generated. Hmm, risky. Safer: define our own TS union `OrderState = 'PENDING' | 'IN_FLIGHT' | ...` in a shared file (say, `payout.types.ts`), and the Prisma schema defines its own enum with the same values. The repository maps. That decouples the domain from the generated client. Yes — define domain types in `src/payout/payout.types.ts`? Hmm, file proliferation. Let me consolidate:

- `src/payout/payout.types.ts` — OrderState union, PaymentOrderRecord, BankSendInput, BankSendResult, Settlement, BankGateway interface, PayoutOrderStore interface, Window type, result summaries. One types file.

Hmm, but "don't create files it doesn't ask for" — types files are necessary plumbing. Consolidate to keep file count reasonable:

File list (final):
1. `prisma/schema.prisma`
2. `prisma/migrations/20250101000000_init/migration.sql`
3. `src/main.ts`
4. `src/app.module.ts`
5. `src/common/api-error.ts` (ApiError)
6. `src/common/exception-filter.ts` (AllExceptionsFilter)
7. `src/prisma/prisma.service.ts`
8. `src/prisma/prisma.module.ts`
9. `src/payout/payout.types.ts` (domain types: states, record, bank contract, store port, window, summaries)
10. `src/payout/txid.util.ts` (deriveTxid + date-key helpers? Date helpers maybe in `dates.util.ts`… consolidate in txid.util? Name is weird then. Let me do `src/payout/payout.util.ts`? Hmm. Keep `txid.util.ts` for deriveTxid, and put date helpers (dateKey, eachDay) in `payout.types.ts`? No — types shouldn't have functions… let me make `src/payout/dates.util.ts` (dateKey, addDays, eachDay, todayKey). OK, two small util files. Acceptable.
11. `src/payout/payout-config.ts` (PayoutConfigPort + EnvPayoutConfig)
12. `src/payout/payout.repository.ts` (PayoutRepository implements PayoutOrderStore)
13. `src/payout/bank-gateway.ts`? I said the BankGateway interface goes in types. A default adapter class that throws — put the class in types? No. A small `src/payout/bank-gateway.ts` with `@Injectable() class BankGateway` that implements the port with a throwing default. OK.
14. `src/payout/payout.service.ts`
15. `src/payout/payout.controller.ts`
16. `src/payout/payout.processor.ts` (@Cron job)
17. `src/payout/payout.module.ts`
18. `test/payout.service.spec.ts`
19. `test/txid.util.spec.ts`? Maybe fold into the service spec. The task's tests: timeout-but-settled, proven-absent, attempt exhaustion (+ idempotency, four outcomes). Put all in `test/payout.service.spec.ts`, and maybe a small `test/txid.util.spec.ts` for derivation determinism — the txid property is core to the bug ("second issue"). A small separate spec is justified. And a window overlap test — service spec.

Do we need a `GET /payout-orders` list endpoint? "Controller validates input and calls the service" — my controller has two POST endpoints. That's enough. No need for a list. Keep scope tight: execute + reconcile endpoints. Hmm, "endpoint: kebab-case, plural" — `/payout-orders/execute` and `/payout-orders/reconcile` ✓.

Also consider a body DTO for the reconcile endpoint: `{ from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }`, from <= to, both valid dates, window size limited (say, <= 7 days) to bound the statement fetches. Validate in the controller. On invalid, throw ApiError('invalid_window').

Also — what does the endpoint return? A summary object: e.g., `{ settled: 2, rescheduled: 1, parked: 0, ... }` and execute: `{ accepted: 1, duplicate: 0, transient: 1, permanent: 0 }`. Plain JSON (no envelope for success — envelope is only for errors).

Now — let me write the service carefully.

```ts
export interface ExecuteSummary {
  accepted: number; duplicate: number; transient: number; permanent: number;
}
export interface ReconcileSummary {
  settled: number; rescheduled: number; parked: number;
}
```

Service:

```ts
@Injectable()
export class PayoutService {
  constructor(
    private readonly store: PayoutOrderStore,
    private readonly bank: BankGatewayPort,
    private readonly config: PayoutConfigPort,
  ) {}

  async executePayments(now: Date = new Date()): Promise<ExecuteSummary> {
    const summary = { accepted: 0, duplicate: 0, transient: 0, permanent: 0 };
    const pending = await this.store.findPending();
    for (const order of pending) {
      const txid = deriveTxid(order.id, order.effectiveDate);
      let result: BankSendResult;
      try {
        result = await this.bank.send({ txid, amount: order.amountCents, key: order.supplierKey });
      } catch (err) {
        // bank client threw (network/timeout surfaced as exception): outcome unknown
        result = { outcome: 'transient', detail: ... };
      }
      await this.applySendOutcome(order, result, now);
      summary[result.outcome] += 1;
    }
    return summary;
  }
```

Wait — "classify the bank.send response (accepted, duplicate, transient error, permanent rejection)." Classification is in the result. But what if the bank SDK throws on timeout? The BankGateway port contract: `send` returns a classified result. A raw throw is a transport failure = transient by definition (we don't know). Catching a throw → transient is defensible and safe (treats unknown as unknown). Include with a comment. Hmm — or should the port never throw and always return transient? In which case the catch is dead code. Keep the catch: robust, and the fake bank in tests can throw to simulate a crash. Actually good: "transient error — network, timeout, 5xx" — the SDK would express these either as a result or as a throw. Treat both as transient. ✓

applySendOutcome:

```ts
private async applySendOutcome(order, result, now) {
  switch (result.outcome) {
    case 'accepted':
      await this.store.markInFlight(order.id, now); break;   // PENDING→IN_FLIGHT, attempts+1
    case 'duplicate':
      await this.store.markInFlight(order.id, now); break;   // bank already has the txid: treat as in flight
    case 'transient':
      await this.store.markOutcomeUnknown(order.id, now); break; // record unknown, don't act
    case 'permanent':
      await this.store.markRejected(order.id, now, result.detail); break; // terminal
  }
}
```

Hmm — accepted and duplicate both call markInFlight. "Distinct path" — the branch is distinct. The summary counts are distinct. And store `lastResult`: markInFlight(id, now, lastResult: 'accepted'|'duplicate'). Let me pass lastResult to the store methods so the column is set: markInFlight(id, at, lastResult: 'accepted' | 'duplicate'), markOutcomeUnknown(id, at, detail), markRejected(id, at, reason). And the record has `lastResult: string | null`. OK — now the four outcomes are observably distinct in state (IN_FLIGHT+lastResult accepted / IN_FLIGHT+duplicate / OUTCOME_UNKNOWN+transient / REJECTED+permanent).

reconcile:

```ts
async reconcile(window: DateWindow, now: Date = new Date()): Promise<ReconcileSummary> {
  const { from, to } = window; // Date (day precision)
  if (from > to) throw new ApiError('invalid_window', ...); // or validate in controller. Service guard too
  const summary = { settled: 0, rescheduled: 0, parked: 0 };
  const statement = await this.loadStatement(from, to); // Map<txid, Settlement>
  const candidates = await this.store.findReconcilable(from, to);
  const lagMs = this.config.lagMs;
  for (const order of candidates) {
    const txid = deriveTxid(order.id, order.effectiveDate);
    if (statement.has(txid)) {
      // evidence: the instruction is on the bank's statement
      const settled = await this.store.markSettled(order.id, txid, now);
      if (settled) summary.settled += 1;
      continue;
    }
    if (order.state === 'IN_FLIGHT') continue; // bank accepted. Statement will catch up. Never re-send
    // state === 'OUTCOME_UNKNOWN'
    if (order.lastAttemptAt === null) continue; // defensive: can't measure lag
    if (now.getTime() - order.lastAttemptAt.getTime() < lagMs) continue; // lag not yet passed: no evidence
    // proven absent past the lag: the only path to resend (or park)
    if (order.attemptCount >= this.config.maxAttempts) {
      const parked = await this.store.markNeedsReview(order.id, 'send_attempts_exhausted', now);
      if (parked) summary.parked += 1;
    } else {
      const released = await this.store.markPendingForResend(order.id);
      if (released) summary.rescheduled += 1;
    }
  }
  return summary;
}
```

loadStatement:

```ts
private async loadStatement(from: Date, to: Date): Promise<Map<string, Settlement>> {
  const seen = new Map<string, Settlement>();
  for (const day of eachDay(from, to)) {
    for (const s of await this.bank.getStatement(dateKey(day))) {
      seen.set(s.txid, s); // later dates win on dup txid? A txid should appear once. Last-write-wins is fine
    }
  }
  return seen;
}
```

Note: statement entries are keyed by the txid we sent — derived the same way. ✓

The repository's markSettled is conditional on state IN (IN_FLIGHT, OUTCOME_UNKNOWN) → returns boolean (count>0). On the second run of the same window, the order is SETTLED → not loaded by findReconcilable → "orders already matched are skipped before any decision is made about them" ✓ (double guard: the filter + the conditional update).

Wait — a subtlety on the "rescheduled" double-run: run 1: OUTCOME_UNKNOWN proven absent → PENDING. Run 2 (same window, overlapping): findReconcilable loads only IN_FLIGHT/OUTCOME_UNKNOWN → order no longer loaded ✓. And executePayments in between may send → IN_FLIGHT/OUTCOME_UNKNOWN again → run 3 reconciles the new attempt. All fine.

Another subtlety: an order released to PENDING is sent in the same cycle? No — executePayments is separate. That's by design.

Edge: OUTCOME_UNKNOWN order with lastAttemptAt older than lag but window excludes effective_date? findReconcilable filters by effective_date in window. The job's window always includes today ±1 day. A manual narrow window may skip old unknowns — that's the semantics of the window parameter. Fine.

Edge: IN_FLIGHT order never appears on the statement? It stays IN_FLIGHT forever — correct (bank accepted. It's a bank-side issue, and a human would notice via the age of in_flight). Should reconcile park old IN_FLIGHT? Not in the spec. Don't. (Do exactly what the task asks.)

Now the store port methods (interface):

```ts
export interface PayoutOrderStore {
  findPending(): Promise<PaymentOrderRecord[]>;
  findReconcilable(from: Date, to: Date): Promise<PaymentOrderRecord[]>;
  markInFlight(id: string, at: Date, lastResult: 'accepted' | 'duplicate'): Promise<boolean>;
  markOutcomeUnknown(id: string, at: Date, detail: string): Promise<boolean>;
  markRejected(id: string, at: Date, reason: string): Promise<boolean>;
  markSettled(id: string, txid: string, at: Date): Promise<boolean>;
  markPendingForResend(id: string): Promise<boolean>;
  markNeedsReview(id: string, reason: string, at: Date): Promise<boolean>;
}
```

All conditional transitions (where state = expected) → return whether the transition happened. Repository implements with Prisma's updateMany.

Hmm, one thing: markInFlight — expected prior state PENDING. markOutcomeUnknown — from PENDING. markRejected — from PENDING. markSettled — from IN_FLIGHT|OUTCOME_UNKNOWN. markPendingForResend — from OUTCOME_UNKNOWN. markNeedsReview — from OUTCOME_UNKNOWN. The repository enforces via where clause. If the transition didn't apply (count 0), the service ignores (idempotent).

But wait: in executePayments, if the transition fails (count 0) — that means the order's state changed concurrently. Ignore? Log? Just ignore (returning boolean, and the service doesn't do anything with it for send outcomes — keep it simple. Maybe no need for the summary counts from the boolean for send outcomes).

Now Prisma repository implementation:

```ts
@Injectable()
export class PayoutRepository implements PayoutOrderStore {
  constructor(private readonly prisma: PrismaService) {}

  async findPending() {
    const rows = await this.prisma.paymentOrder.findMany({ where: { state: OrderState.PENDING }, orderBy: { createdAt: 'asc' } });
    return rows.map(toRecord);
  }
  async findReconcilable(from, to) {
    const rows = await this.prisma.paymentOrder.findMany({
      where: {
        state: { in: [OrderState.IN_FLIGHT, OrderState.OUTCOME_UNKNOWN] },
        effectiveDate: { gte: from, lte: to },
      },
    });
    return rows.map(toRecord);
  }
  async markInFlight(id, at, lastResult) {
    const res = await this.prisma.paymentOrder.updateMany({
      where: { id, state: OrderState.PENDING },
      data: { state: OrderState.IN_FLIGHT, lastAttemptAt: at, attemptCount: { increment: 1 }, lastResult },
    });
    return res.count > 0;
  }
  ...
}
```

Model field names: Prisma model `PaymentOrder` with camelCase fields + @map. `state` field of enum `OrderState`. Note: the Prisma enum name `OrderState` and my TS union `OrderState` — name collision in the repository file (importing Prisma's OrderState and the domain union). The repository only needs Prisma's enum. The service uses the domain union. The record DTO uses the domain union, and toRecord maps Prisma's enum → string (same values). To avoid confusion, name the domain union `OrderState` in payout.types.ts and the Prisma enum also `OrderState`. In the repository, `import { OrderState as DbOrderState } from '@prisma/client'`? Ugh. Alternative: name the Prisma enum `PaymentOrderState` @map? Prisma enums aren't mapped to a different DB name without @@map? For enums, `@@map`? Prisma enums don't support @@map (actually they do? No — Prisma enums map to a Postgres type of the same name. You can't rename without a native type. There's `@native`? That's for custom native enums: `enum OrderState { ... @native("payment_order_state", ...) }`? Hmm, I don't think @native is stable/widely supported for enums in Prisma… actually Prisma supports `@native` for enums? No — Prisma doesn't support @native on enums (as of recent versions, unsupported. There's an open issue). Let me name the Prisma enum `PaymentOrderState`, and the migration SQL `CREATE TYPE "PaymentOrderState" AS ENUM (...)`. And the domain TS union is `OrderState`. Clean, no collision.

Domain union values: 'PENDING' | 'IN_FLIGHT' | 'OUTCOME_UNKNOWN' | 'SETTLED' | 'REJECTED' | 'NEEDS_REVIEW'. Matches enum values.

Now `@db.Date` + JS Date: Prisma returns a Date at midnight UTC for @db.Date columns (I think in the prisma client with date columns it returns a Date object at 00:00 UTC… actually `@db.Date` — the client treats it as DateTime in JS? Hmm. Prisma `@db.Date`: the field type in schema is `DateTime @db.Date`. The JS value is a Date at midnight UTC. gte/lte Date comparisons in queries work. OK.

effectiveDate stored as UTC midnight. deriveTxid uses dateKey(effectiveDate) = ISO slice(0,10). Deterministic ✓.

Now the controller:

```ts
@Controller('payout-orders')
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post('execute')
  execute() { return this.service.executePayments(); }

  @Post('reconcile')
  reconcile(@Body() body: unknown) {
    const window = parseWindow(body); // validate: {from, to} date strings, from<=to, span<=31 days?
    return this.service.reconcile(window);
  }
}
```

Validation: body is an object with from/to as 'YYYY-MM-DD' matching regex, valid calendar dates, from <= to, (to-from) <= 31 days (bound on statement fetches). On failure, throw `new ApiError('invalid_window', '...', { field })`. Filter maps ApiError → 400 + envelope. Other exceptions → 500 envelope `internal_error`.

The filter:

```ts
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    if (exception instanceof ApiError) {
      const status = exception.status; // 400
      res.status(status).json({ error: { code: exception.code, message: exception.message, details: exception.details } });
    } else if (exception instanceof HttpException) {
      const status = exception.getStatus();
      res.status(status).json({ error: { code: 'request_rejected' ... } });
    } else {
      res.status(500).json({ error: { code: 'internal_error', message: 'Unexpected error', details: {} } });
    }
  }
}
```

Keep it simple. ApiError carries status.

main.ts:

```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/exception-filter.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3000);
}
void bootstrap();
```

ESM with "type": "module" — NestJS + TS with ESM: imports need `.js` extensions in TS source (NodeNext). Conventions say ESM "type": "module." So in TS files, relative imports with `.js` extensions. Yes, I'll write imports with `.js` suffixes. And tsconfig? The task says deliver "every file the solution needs" — is tsconfig/package.json in scope? Hmm. "Build the whole solution in a single reply" — the solution needs package.json (deps: @nestjs/common, @nestjs/core, @nestjs/schedule, @prisma/client, prisma, reflect-metadata, rxjs, vitest, @nestjs/testing?) and tsconfig.json (NodeNext), vitest.config.ts. Without them, the "solution" doesn't build. The layout tree doesn't list them, but they're needed. "Don't create files it doesn't ask for" — but a non-building solution fails. I think including minimal `package.json`, `tsconfig.json`, and `vitest.config.ts` is justified — they're scaffolding, not scope creep. The repo is `supplier-payouts` with labels — probably a fresh build. Let me include:

- `package.json` — name supplier-payouts, type module, scripts (start, test, prisma migrate), deps.
- `tsconfig.json` — strict, NodeNext module, experimental decorators, etc.
- `vitest.config.ts` — minimal (environment node, include test/**/*.spec.ts).

NestJS in ESM: decorators require `emitDecoratorMetadata`? With NodeNext ESM, `emitDecoratorMetadata` requires CommonJS… TypeScript supports emitDecoratorMetadata in ESM output only since TS 5.x? Actually `experimentalDecorators` + `emitDecoratorMetadata` work with module Node16/NodeNext in recent TS (they emit __metadata calls). NestJS docs for ESM: tsconfig with `"module": "nodenext"`, `"moduleResolution": "nodenext"`, `"emitDecoratorMetadata": true`? Hmm, NestJS ESM docs: `"module": "ESNext"`? Let me recall: NestJS ESM support: package type: module, tsconfig: `"module": "ES2022"`, `"moduleResolution": "Bundler"`? And imports need .js. Common setup that works:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "declaration": false,
    "sourceMap": true,
    "outDir": "dist",
    "skipLibCheck": true,
    "esModuleInterop": true,
    "strictNullChecks": true
  },
  "include": ["src", "test"]
}
```

Does emitDecoratorMetadata work with NodeNext ESM? TypeScript: "emitDecoratorMetadata is only allowed when targeting ES2015 or higher and when using experimentalDecorators" — and it works with ESM output in TS 5 (metadata is emitted via __metadata import from tslib). With NodeNext + ESM, TS will auto-import tslib helpers (`import { __decorate, __metadata } from 'tslib'`) — requires tslib as a dep. Include `tslib` in deps. And decorators: NestJS in ESM mode needs `reflect-metadata` import in main.ts before Nest imports — actually in ESM, `import 'reflect-metadata'` at the top of main.ts. NestJS docs ESM: add `import 'reflect-metadata'` in main. I'll include it.

Vitest + TS + decorators: vitest handles TS via esbuild — does esbuild support experimentalDecorators? esbuild has supported TS decorators since 0.21? esbuild implements the legacy decorator… hmm, does esbuild support TS legacy decorators with the tsconfig flag `experimentalDecorators`? esbuild reads tsconfig's experimentalDecorators and emitDecoratorMetadata? Does esbuild respect `experimentalDecorators`? Yes — esbuild supports experimentalDecorators (not emitDecoratorMetadata!). This is a known issue: in pure unit tests where the service doesn't rely on DI metadata (we construct the service directly with `new PayoutService(fakeStore, fakeBank, fakeConfig)`), emitDecoratorMetadata is irrelevant. @Injectable() decorators still apply (esbuild handles the decorator syntax). So in tests, we construct the service directly — no @nestjs/testing, no DI container.

But wait — will esbuild apply the class decorator `@Injectable()`? Yes, esbuild supports legacy decorators (it follows tsconfig's experimentalDecorators, or defaults to experimental when TS). And the @Cron decorator in the processor — the processor is only imported in the module (not in tests), so no issue.

But actually, does vitest even compile src modules in tests? The service spec imports `../src/payout/payout.service.js` (NodeNext resolution: in TS source, imports need `.js` extensions. Vitest resolves `.js` → `.ts`? Vitest (Vite) handles TS files imported with `.js` extensions? Hmm — with Vite, importing `./payout.service.js` when the file is `payout.service.ts`: does Vite resolve this? Vite handles TS files imported with .js extension in ESM mode? Vite's esbuild plugin… I recall Vite supports this (it tries .ts for .js imports) — yes, Vite handles this "TypeScript extension substitution" for TS files. Vitest inherits. I think it works (common pattern in NodeNext + Vitest projects). OK.

Alternative, to avoid the whole issue: write imports without extensions and use `"moduleResolution": "bundler"`… but the convention is Node 20 ESM — at runtime (compiled), extensions are needed. In the source, `.js` extensions are the correct ESM style. Let me commit to `.js` extensions everywhere and `"module": "NodeNext"`.

Hmm wait, let me reconsider whether to include package.json/tsconfig at all. The instructions: "deliver every file the solution needs, complete." A TS+NestJS+Prisma+Vitest solution needs package.json (deps, type: module), tsconfig (strict, ESM, decorators), vitest config (strictly no — vitest works zero-config: it picks up test/**/*.spec.ts by default! Default include: `**/*.{test,spec}.?(c|m)[jt]s?(x)` — so test/payout.service.spec.ts is picked up without config). So vitest.config.ts can be skipped. package.json: needed (type: module, scripts, deps). tsconfig.json: needed (strict + decorators + module NodeNext). Include both, keep minimal.

Actually, do I need to worry that the evaluation harness has its own package.json? "If files are given above the task, they're the existing codebase" — no existing files were given (the reference block is problem statements, not code). So we're building from scratch. Include package.json + tsconfig.json.

Now — `@nestjs/schedule` for the cron job. The processor:

```ts
@Injectable()
export class PayoutProcessor {
  private readonly logger = new Logger(PayoutProcessor.name);
  constructor(private readonly service: PayoutService) {}

  @Cron('*/15 * * * *')
  async reconcileScheduled() {
    const now = new Date();
    const from = startOfDay(addDays(now, -1));
    const to = startOfDay(now);
    const summary = await this.service.reconcile({ from, to }, now);
    this.logger.log(`reconcile [${dateKey(from)}..${dateKey(to)}]: settled=${summary.settled} rescheduled=${summary.rescheduled} parked=${summary.parked}`);
  }
}
```

Window: yesterday+today → each 15-minute run overlaps with the previous (today is always covered. Yesterday too, until midnight). ✓ "Safe to run every 15 minutes, including overlapping windows."

Module:

```ts
@Module({
  imports: [PrismaModule, ScheduleModule.forRoot()],
  controllers: [PayoutController],
  providers: [PayoutService, PayoutRepository, BankGateway, EnvPayoutConfig, PayoutProcessor],
  exports: [PayoutService],
})
export class PayoutModule {}
```

Wait — service depends on the PayoutOrderStore interface, BankGatewayPort interface, and PayoutConfigPort interface. With @Injectable and no @Inject token, Nest resolves by design:type → PayoutOrderStore (a TS interface → design:type returns Object!). Interfaces erase to `Object` → Nest can't auto-resolve. Need explicit injection tokens:

- `export const PAYOUT_ORDER_STORE = 'PAYOUT_ORDER_STORE'` and `@Inject(PAYOUT_ORDER_STORE)` in the service constructor, and in the module providers: `{ provide: PAYOUT_ORDER_STORE, useExisting: PayoutRepository }` or `{ provide: PayoutRepository }` + `{ provide: PAYOUT_ORDER_STORE, useClass: PayoutRepository }`. Cleaner: `providers: [{ provide: PAYOUT_ORDER_STORE, useClass: PayoutRepository }]`. Hmm, then PayoutRepository itself is not a provider — that's fine (it exists as the instance behind the token).

Simpler alternative: have the service depend on the concrete class `PayoutRepository` (class, so design:type works), and tests pass a fake instance typed as PayoutRepository (structural typing: a fake with the same methods — but a fake that `implements PayoutRepository`? PayoutRepository has a constructor(prisma) — a fake implementing the same method signatures is structurally compatible in TS without extends. The service constructor arg type `PayoutRepository` accepts an object literal with the right methods? If the service's arg is typed as the PayoutRepository class, a fake object implementing the same public method signatures is assignable (structural typing). Yes! TS is structural. So the service can depend on the concrete `PayoutRepository` type, and the test fake implements the same interface structurally. And the BankGateway class similarly (a concrete default adapter. A test fake is structurally assignable). And the config: an interface with a token, or a concrete EnvPayoutConfig class with a fake structurally assignable.

This eliminates all injection tokens. Nest's design:type for concrete classes works. In tests: `new PayoutService(fakeRepo, fakeBank, { lagMs, maxAttempts })` — wait, if the service's constructor arg is typed as the concrete `EnvPayoutConfig`, a plain object literal `{ lagMs: X, maxAttempts: Y }` is structurally assignable ✓ (class instance type = its public surface. The literal matches). But EnvPayoutConfig methods — make the config a class with public getters `lagMs`/`maxAttempts`? A getter in a class → the instance type has a readonly property lagMs: number. A literal `{lagMs: n, maxAttempts: n}` is assignable ✓.

So:
- Service deps: `PayoutRepository`, `BankGateway` (concrete adapter class with a port shape), `EnvPayoutConfig` (concrete config class). All structurally fakeable. Nest resolves via design:type.

But hmm — "BankGateway" as a default adapter class that throws: fine. Tests pass a FakeBank structurally.

Wait, but is it weird to have the service depend on a "BankGateway" class that throws by default? The module provides BankGateway (the class). In a real deployment, you'd replace it with a vendor adapter via a module override — that's the seam. OK, with an ASSUMPTION comment: "The bank's SDK/HTTP transport is out of scope; a production module override wires the real client here."

Hmm, actually — wait. Reconsider: is a throwing default class the "most defensible reading"? Alternative: a factory provider that constructs an adapter from env vars (BANK_BASE_URL, BANK_API_TOKEN) and makes actual fetch calls with a guessed shape — no, guessing HTTP contract is worse ("assume nothing about the bank API"). A port with a clear TODO adapter is the honest engineering answer.

Also let me decide on `Settlement`:

```ts
export interface Settlement {
  txid: string;
  amount: number; // minor units
  key: string;
}
```

Keep minimal (the spec says "each has the txid we sent." amount/key are natural. amount is for future verification, key for logging). Keep txid, amount, key. Hmm — "don't invent"? Minimal contract: at least txid. Including amount/key is reasonable and doesn't force anything (fake statements in tests include them). OK.

BankSendResult:

```ts
export type BankSendResult =
  | { outcome: 'accepted' }
  | { outcome: 'duplicate' }
  | { outcome: 'transient'; detail: string }
  | { outcome: 'permanent'; reason: string };
```

BankSendInput: `{ txid: string; amount: number; key: string }`.

BankGateway:

```ts
@Injectable()
export class BankGateway {
  async send(_input: BankSendInput): Promise<BankSendResult> {
    throw new Error('...not wired...');
  }
  async getStatement(_date: string): Promise<Settlement[]> {
    throw new Error('...not wired...');
  }
}
```

Hmm wait — but if the real bank call throws for any reason in production, the service catches in executePayments → transient ✓. For getStatement throwing: it propagates — reconcile fails, next run retries. OK.

Now let me write the tests. Requirements:
1. timeout-but-settled (no resend): seed an order in OUTCOME_UNKNOWN, lastAttemptAt past lag, attemptCount 1, and include the settlement for its txid. reconcile → order becomes SETTLED, bank.send is NOT called (reconcile doesn't send anyway — assert via a subsequent executePayments? The point is "no resend": after reconcile, executePayments sends nothing (order is settled, not pending). Assert: after reconcile, state SETTLED. Then executePayments() → bank.sent.length === 0.
2. proven-absent (resend, same txid): seed OUTCOME_UNKNOWN, past lag, attempts=1, no settlement. reconcile → PENDING, summary.rescheduled=1. Then executePayments → bank.send called with the txid === the original derived txid (record from before), amount/key same, attempts → 2 (and after that, say accepted → IN_FLIGHT). Assert same txid explicitly.
3. attempt exhaustion: OUTCOME_UNKNOWN, attempts=5, past lag, absent → reconcile → NEEDS_REVIEW, parked_reason set. executePayments → no send. (And never auto-reverts: a second reconcile → still NEEDS_REVIEW, no changes.)
4. idempotency: run reconcile twice with the same window → after run 1 and run 2, same state (capture the map snapshot, deep-equal). Include mixed orders (settled + rescheduled) so it's meaningful: run 1 settles A and releases B (→PENDING). Run 2: nothing more changes (B is PENDING — not a candidate. A is SETTLED). Snapshot equality ✓. Also overlapping windows: run with {d1,d2} then {d2,d3} — same outcome.
5. Four outcomes: executePayments on 4 PENDING orders with scripted results [accepted, duplicate, transient, permanent] → states [IN_FLIGHT, IN_FLIGHT, OUTCOME_UNKNOWN, REJECTED], lastResult distinguishes accepted/duplicate. attempts all 1.
6. Lag not yet passed: OUTCOME_UNKNOWN with lastAttemptAt within lag → reconcile does nothing (stays OUTCOME_UNKNOWN). (Important negative test: no premature resend.)
7. in_flight absent is not resent: IN_FLIGHT order, past lag, absent → stays IN_FLIGHT, and executePayments sends nothing. (Critical double-payment guard.)
8. deriveTxid: same input → same. Different date → different. Different order → different.

Also: "a test that only asserts a call happened is… worse than no test" — all my tests assert state. ✓ "Not just happy paths" — negative/edge included. ✓

Test structure: a helper `seed(store, {...})`.

Fake store implementation:

```ts
type Row = PaymentOrderRecord & { lastResult: string | null; rejectReason?: string | null; parkedReason?: string | null; settleTxid?: string | null; settledAt?: Date | null };
```

Hmm — what does the service need in the record? id, supplierKey, amountCents, effectiveDate, state, attemptCount, lastAttemptAt. Plus, for test assertions, the fake keeps extra fields (lastResult, parkedReason…). PaymentOrderRecord is what the service reads. The fake's internal row can be a superset. Let me define:

```ts
export interface PaymentOrderRecord {
  id: string;
  supplierKey: string;
  amountCents: number;
  effectiveDate: Date;
  state: OrderState;
  attemptCount: number;
  lastAttemptAt: Date | null;
}
```

Fake row: PaymentOrderRecord + { lastResult: string | null; parkedReason: string | null; rejectReason: string | null; settledAt: Date | null; settleTxid: string | null }.

Fake store methods with conditional transitions:

```ts
class FakeStore implements PayoutRepository {
  rows = new Map<string, Row>();
  add(row: Row) { this.rows.set(row.id, { ...row }); }
  all() { return [...this.rows.values()].map(r => ({...r})); } // snapshot
  async findPending() { return [...this.rows.values()].filter(r => r.state === 'PENDING').map(copy); }
  async findReconcilable(from, to) { filter state in [IN_FLIGHT, OUTCOME_UNKNOWN] && effectiveDate >= from && <= to }
  async markInFlight(id, at, lastResult) { r = row(id); if (r.state !== 'PENDING') return false; r.state='IN_FLIGHT'; r.attemptCount++; r.lastAttemptAt=at; r.lastResult=lastResult; return true; }
  async markOutcomeUnknown(id, at, detail) { if (r.state!=='PENDING') return false; r.state='OUTCOME_UNKNOWN'; r.attemptCount++; r.lastAttemptAt=at; r.lastResult='transient'; r.detail? ... }
```

Hmm detail — do I store the transient detail? The repository schema: a `last_result` column for classification, `parked_reason`, `reject_reason`. Transient detail is transient operational data — skip storing (or a last_error column?). Keep the schema tight: last_result (accepted|duplicate|transient|permanent), reject_reason, parked_reason. The service's markOutcomeUnknown(id, at) — drop the detail param. The detail of a transient result isn't needed downstream. Simplify the store interface:

- markInFlight(id, at, lastResult: 'accepted' | 'duplicate')
- markOutcomeUnknown(id, at)
- markRejected(id, at, reason: string)
- markSettled(id, txid, at)
- markPendingForResend(id)
- markNeedsReview(id, reason, at)

Schema columns: last_result TEXT, reject_reason TEXT, parked_reason TEXT, settle_txid TEXT, settled_at TIMESTAMP. attempt_count, last_attempt_at. Good.

Now the summary type and "same txid" assertion: in test 2, before reconcile, compute `expectTxid = deriveTxid(orderId, effectiveDate)` and after executePayments, `expect(bank.sent[0].txid).toBe(expectTxid)`. Also assert it equals the txid used in the original send — in the test, first run executePayments with a scripted transient (simulating the original timeout!) to make it authentic:

Test flow for timeout-but-settled:
- Seed a PENDING order.
- bank: scripted [transient]. statements: [ {txid: deriveTxid(id, date), amount, key} ] for the order's date.
- executePayments() → state OUTCOME_UNKNOWN, attempts 1. (The "timeout")
- Advance time: pass a `now` parameter. The service accepts `now: Date = new Date()`. The test passes `new Date(lastAttempt + 31min)` to reconcile → proven past lag.
- reconcile(window covering the date, now) → SETTLED. summary.settled 1.
- executePayments(now) → bank.sent.length still 1 (no resend). ✓

Proven-absent:
- Seed PENDING. scripted [transient]. statements: empty.
- executePayments() → OUTCOME_UNKNOWN.
- reconcile (now = attempt+31min) → PENDING, rescheduled 1.
- scripted push 'accepted'. executePayments → bank.sent.length 2, sent[1].txid === sent[0].txid ✓, state IN_FLIGHT, attempts 2.

Exhaustion:
- Seed PENDING. Scripted [transient ×5]? That's 5 executePayments calls, each followed by reconcile releasing (attempts 1→2→3→4→5, and at 5: reconcile parks). Long but realistic. Faster: seed directly OUTCOME_UNKNOWN attempts=5, lastAttemptAt past lag, statements empty → reconcile → NEEDS_REVIEW parked. Then executePayments → no new send. A second reconcile → no change (NEEDS_REVIEW not in candidates). Assert parked_reason = 'send_attempts_exhausted'. I'll do the fast version, plus the loop version maybe… the loop version is a nice integration-style test: 5 cycles. Hmm, each cycle: executePayments (transient) + reconcile (release) — after the 5th transient (attempts=5), the next reconcile parks. Let me write it as a loop of 5 send attempts, with a reconcile after each. Assert parked after the final reconcile, total bank.sent = 5, all with the same txid (all 5 sends have the same txid! Good assertion: derived txid is constant). This is a strong behavioral test. Let me do the loop version — it tests the full lifecycle. Plus idempotent double reconcile within the cycle.

Actually wait, in the loop, after each executePayments (transient), the order is OUTCOME_UNKNOWN with lastAttemptAt=now. The subsequent reconcile needs now' > lastAttemptAt + lag → use a now clock: keep a mutable `t` that advances. Pass `t` to both calls and advance t by 31 minutes after each send. Clean.

Idempotency test:
- Seed 3 orders: A (OUTCOME_UNKNOWN, past lag, with settlement), B (OUTCOME_UNKNOWN, past lag, absent, attempts 1), C (IN_FLIGHT, past lag, absent).
- Run reconcile(w) → A SETTLED, B PENDING, C IN_FLIGHT.
- Snapshot. Run reconcile(w) again (same window) → snapshot equal (deep). Also run with an overlapping window {from: w.from-1d, to: w.to+1d} → still equal. (Statements for additional dates: empty in fake.)
- Assert C never became resend-eligible (IN_FLIGHT, and after a subsequent executePayments, bank.sent.length === 0… wait, B is now PENDING → executePayments would send B. Don't run executePayments here, or run it and assert only B is sent, not C. Let me run executePayments after both reconciles, with scripted accepted: bank sends exactly one (B). C untouched. Good — proves IN_FLIGHT is not resent.)

Four-outcomes test:
- Seed 4 PENDING orders. Scripted [accepted, duplicate, transient, permanent].
- executePayments → summary {accepted:1, duplicate:1, transient:1, permanent:1}. States: IN_FLIGHT(lastResult accepted), IN_FLIGHT(lastResult duplicate), OUTCOME_UNKNOWN, REJECTED. attempts each 1. And bank.sent's txids are all the respective derived ones.

Lag test:
- OUTCOME_UNKNOWN, lastAttemptAt = now - 10min (lag 30) → reconcile(now) → no change. State still OUTCOME_UNKNOWN, summary all zeros.

Also "same txid across attempts" is implicit in all tests (deriveTxid is pure. Assert in the txid spec).

Now, `now` injection: service methods take an optional `now` param — a test seam. Default `new Date()`. Good. Not a leak of "implementation" — it's a clock for determinism.

Timezones/dates: use UTC everywhere. `dateKey(d) = d.toISOString().slice(0,10)`. `parseDateKey(s)` → `new Date(s + 'T00:00:00Z')`. `eachDay(from, to)` inclusive: iterate days. `startOfUtcDay(d)` → new Date(Date.UTC(y,m,day)).

Window type: `{ from: Date; to: Date }` (service-level, day precision). The controller parses strings → Date (UTC midnight).

Controller validation:
```ts
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
parse: body must be a plain object. from/to are strings matching DATE_RE. Valid calendar date (Date parse + round-trip check). from <= to. (to - from) <= 31 days? Cap on span: use 366? 31-day cap is reasonable… actually for manual catch-up, more might be needed. But each date = 1 statement call. 31 is safe. Throw ApiError('invalid_window', ...) with details {field, value}? details is an object. On failure throw ApiError('invalid_window', '...', { field }).
```

ApiError:

```ts
export class ApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number = 400, public readonly details: Record<string, unknown> = {}) {
    super(message);
  }
}
```

Filter:

```ts
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    if (exception instanceof ApiError) {
      this.send(res, exception.status, exception.code, exception.message, exception.details);
    } else if (exception instanceof HttpException) {
      const status = exception.getStatus();
      this.send(res, status, status === 404 ? 'resource_not_found' : 'request_rejected', exception.message, {});
    } else {
      this.send(res, 500, 'internal_error', 'Unexpected server error', {});
    }
  }
  private send(res: Response, status: number, code: string, message: string, details: Record<string, unknown>) {
    res.status(status).json({ error: { code, message, details } });
  }
}
```

message: "developer-facing English" ✓.

Now the full schema:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum PaymentOrderState {
  PENDING
  IN_FLIGHT
  OUTCOME_UNKNOWN
  SETTLED
  REJECTED
  NEEDS_REVIEW
}

model PaymentOrder {
  id            String            @id @default(cuid())
  supplierKey   String            @map("supplier_key")
  amountCents   Int               @map("amount_cents")
  effectiveDate DateTime          @map("effective_date") @db.Date
  state         PaymentOrderState @default(PENDING) @map("state")
  attemptCount  Int               @default(0) @map("attempt_count")
  lastAttemptAt DateTime?         @map("last_attempt_at")
  lastResult    String?           @map("last_result")
  rejectReason  String?           @map("reject_reason")
  settleTxid    String?           @map("settle_txid")
  settledAt     DateTime?         @map("settled_at")
  parkedReason  String?           @map("parked_reason")
  createdAt     DateTime          @default(now()) @map("created_at")
  updatedAt     DateTime          @updatedAt @map("updated_at")

  @@index([effectiveDate, state], map: "payment_orders_effective_date_state_idx")
  @@map("payment_orders")
}
```

Migration SQL:

```sql
CREATE TYPE "PaymentOrderState" AS ENUM ('PENDING','IN_FLIGHT','OUTCOME_UNKNOWN','SETTLED','REJECTED','NEEDS_REVIEW');

CREATE TABLE "payment_orders" (
  "id" TEXT NOT NULL,
  "supplier_key" TEXT NOT NULL,
  "amount_cents" INTEGER NOT NULL,
  "effective_date" DATE NOT NULL,
  "state" "PaymentOrderState" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_attempt_at" TIMESTAMP(3),
  "last_result" TEXT,
  "reject_reason" TEXT,
  "settle_txid" TEXT,
  "settled_at" TIMESTAMP(3),
  "parked_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payment_orders_effective_date_state_idx" ON "payment_orders"("effective_date", "state");
```

Good. (No shadow __prisma_migrations table — Prisma adds it automatically. Migrations include only user SQL.)

Now — how do orders get created (initial PENDING)? No endpoint for creation (not requested). In production, orders are created upstream (ledger). Should I add a `create` to the repository? Not needed by the service… the repository needs nothing for creation. The tests seed via the fake store (bypassing the DB). But for e2e/dev, a creation path helps. "Do exactly what the task asks" — the task doesn't ask for order creation. Skip a creation endpoint. But the repository's `create`? Skip — not needed. Hmm, but then the table is forever empty in reality… the upstream system writes the orders (out of scope). OK.

Wait — should I add a `GET /payout-orders` endpoint? No. Skip.

Now — processor: `@Cron('*/15 * * * *')`. Timezone: cron in UTC by default (ScheduleModule's default timezone? @nestjs/schedule's default timezone is the system local. Set `ScheduleModule.forRoot({ timezone: 'UTC' })`? The forRoot option exists (timezone). Let me set UTC explicitly.

Also, should the processor run executePayments on a schedule too? Not requested. Reconcile only. Hmm — but wait: who calls executePayments in production? The controller's POST. Or another upstream scheduler. The task only asks for a scheduled reconcile job. ✓

Config class:

```ts
@Injectable()
export class PayoutConfig {
  get lagMs(): number {
    const minutes = Number(process.env.PAYOUT_PUBLISHING_LAG_MINUTES ?? 30);
    return Number.isFinite(minutes) && minutes >= 0 ? minutes * 60_000 : 30 * 60_000;
  }
  get maxAttempts(): number {
    const n = Number(process.env.PAYOUT_MAX_SEND_ATTEMPTS ?? 5);
    return Number.isInteger(n) && n > 0 ? n : 5;
  }
}
```

Hmm "configuration comes from environment variables only" — defaults are fine (still overridable via env). Name it `EnvPayoutConfig`? Or just `PayoutConfig`. A `PayoutConfig` class with getters. The test passes a literal `{ lagMs: 30*60000, maxAttempts: 5 }` — structurally compatible with the PayoutConfig class instance type? A class with only getters → the instance type = { readonly lagMs: number; readonly maxAttempts: number }? Getters in instance type: properties. A literal `{lagMs: n, maxAttempts: n}` is assignable to `{readonly lagMs: number...}` ✓.

But the service constructor type: `private readonly config: PayoutConfig`. The literal is assignable ✓.

Hmm wait, actually — a subtlety: if PayoutConfig has getters that read env at call time, the service's `this.config.lagMs` reads env per call. Tests use the literal. Fine.

Now service file — imports: types, txid util, dates util, repository (type), bank gateway (type), config (type), ApiError for invalid window? The service guards from>to: throw ApiError('invalid_window'...). OK.

Let me also think: `findReconcilable` from/to are Dates at UTC midnight. Prisma's @db.Date comparison with Date at UTC midnight — fine.

Potential Prisma quirk: `updateMany` with an enum in where — fine. `data: { lastResult }` string ✓.

`toRecord` mapping: row.effectiveDate (Date) ✓, row.state (PaymentOrderState enum) → cast to domain OrderState: `row.state as OrderState`? Prisma's enum is a TS string union? No — Prisma's generated enum is an object + a union type of literals. `PaymentOrderState.PENDING` is a string value 'PENDING'. The type is a union 'PENDING'|... so structurally identical to the domain union. The assignment works without cast? The Prisma enum's TS type: `PaymentOrderState` is declared as a union of literals (plus the const object). The values are the same strings → assignable to the domain union without cast. Actually Prisma generates:

```ts
export const PaymentOrderState = { PENDING: 'PENDING', ... } as const;
export type PaymentOrderState = (typeof PaymentOrderState)[keyof typeof PaymentOrderState];
```

So the type = 'PENDING' | 'IN_FLIGHT' | ... — identical to my domain union. Assignable ✓. (In the repository, to avoid shadowing, I'd import `PaymentOrderState` from '@prisma/client' as DbOrderState? In the repository, the domain union OrderState and the Prisma enum PaymentOrderState have different names — no collision! I named them differently exactly for this. The repository imports { PrismaClient? no—PrismaService } and { PaymentOrderState } from '@prisma/client'. No problem.)

Now the "wiring" rules: "A provider used by another module is exported by its own module and imported by the other." — PrismaModule exports PrismaService. PayoutModule imports PrismaModule. ✓ PayoutService used elsewhere? The processor is in the same module. Controller in the same module. No cross-module needs beyond Prisma. ✓

app.module:

```ts
@Module({ imports: [PayoutModule] })
export class AppModule {}
```

main.ts as above, with `import 'reflect-metadata';` first.

package.json:

```json
{
  "name": "supplier-payouts",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/src/main.js",
    "test": "vitest run",
    "prisma:migrate": "prisma migrate dev",
    "prisma:generate": "prisma generate"
  },
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/platform-express": "^10.0.0",
    "@nestjs/schedule": "^4.0.0",
    "@prisma/client": "^5.0.0",
    "reflect-metadata": "^0.2.0",
    "rxjs": "^7.8.0",
    "tslib": "^2.6.0"
  },
  "devDependencies": {
    "prisma": "^5.0.0",
    "typescript": "^5.4.0",
    "vitest": "^2.0.0",
    "@types/node": "^20.0.0",
    "@types/express": "^4.17.0"
  }
}
```

Hmm — @nestjs/common@10 with @types/express? @nestjs/platform-express bundles express. For the Response type in the filter: import { Response } from 'express' — need @types/express ✓ (or use Nest's HTTP adapter types. Simpler: import the express type). Actually, to avoid the express types dependency, could type res as any-ish? No — keep @types/express. It's standard.

Wait, `@nestjs/schedule` version: ^4 for Nest 10 ✓.

Vitest ^2. Node 20 ✓.

Now — tsconfig for NodeNext + decorators. One concern: `emitDecoratorMetadata: true` with `"module": "NodeNext"` — does TS allow it? Yes. It imports tslib helpers. And the decorators in ESM output: `__decorate([...], PayoutController)` — works at runtime with reflect-metadata imported.

Hmm, one more consideration: `verbatimModuleSyntax`? Skip (decorator metadata is fine with esModuleInterop etc.). Keep tsconfig:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "strict": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "declaration": false,
    "noEmitOnError": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

With NodeNext, relative imports in TS files need explicit extensions: `.js`. And type-only imports: with `verbatimModuleSyntax` off, regular imports of types are fine (elided).

Vitest + NodeNext + `.js` extension imports: Vite resolves `./payout.service.js` → `payout.service.ts`? Vite's resolver: for a TS project, does it resolve `.js` → `.ts` in ESM? I believe yes — Vite has supported this since v4 (a "TypeScript extension substitution" feature. Vite 5 handles it). Vitest 2 → Vite 5 ✓. OK.

But wait — vitest's esbuild transform + `emitDecoratorMetadata`: esbuild does NOT emit decorator metadata. In tests, we don't use the DI container (direct `new`), so metadata isn't needed. The `@Injectable()` decorator: esbuild applies it (legacy decorator via tsconfig's experimentalDecorators — does esbuild read tsconfig? Vitest's esbuild reads tsconfig for experimentalDecorators. Vitest sets esbuild's tsconfigRaw by default? Vite reads tsconfig.json for esbuild options (respecting `experimentalDecorators`). Yes, Vite respects tsconfig's experimentalDecorators for esbuild transform. ✓

And in tests, `@Cron`/`@Controller` decorators aren't involved (we don't import controller/processor in tests). The service is `@Injectable()` — esbuild handles it.

One more: the service has a constructor with parameter properties (`private readonly store: PayoutRepository`) — esbuild supports parameter properties ✓ (it's a TS feature esbuild supports. It's not metadata — just assignment in the constructor).

Now — the fake bank in tests:

```ts
class FakeBank {
  scripted: BankSendResult[] = [];
  sent: BankSendInput[] = [];
  statements: Map<string, Settlement[]> = new Map();
  statementCalls: string[] = [];
  send(input: BankSendInput): Promise<BankSendResult> {
    this.sent.push(input);
    const next = this.scripted.shift();
    if (!next) throw new Error('FakeBank: no scripted outcome');
    return Promise.resolve(next);
  }
  getStatement(date: string): Promise<Settlement[]> {
    this.statementCalls.push(date);
    return Promise.resolve(this.statements.get(date) ?? []);
  }
}
```

Also test: bank throws on send → treated as transient (crash safety): seed a PENDING order. Make the fake's send throw once. executePayments → OUTCOME_UNKNOWN. Add as a test (classify: exception = unknown outcome). Good — this directly encodes "must not act on not knowing."

Test helpers:

```ts
function order(overrides: Partial<Row> & Pick<Row,'id'|'supplierKey'|'amountCents'|'effectiveDate'>): Row {
  return { state: 'PENDING', attemptCount: 0, lastAttemptAt: null, lastResult: null, rejectReason: null, parkedReason: null, settleTxid: null, settledAt: null, ...overrides };
}
```

Clock: a const base = new Date('2025-03-10T12:00:00Z'). Dates: effectiveDate = new Date('2025-03-10T00:00:00Z').

Service's `now` param: `executePayments(now = new Date())`, `reconcile(window, now = new Date())`.

Now let me carefully write the service code.

```ts
import { Injectable } from '@nestjs/common';
import { BankGateway } from './bank-gateway.js';
import { PayoutConfig } from './payout-config.js';
import { PayoutRepository } from './payout.repository.js';
import { ApiError } from '../common/api-error.js';
import { eachDay } from './dates.util.js';
import { deriveTxid } from './txid.util.js';
import {
  BankSendResult,
  DateWindow,
  ExecuteSummary,
  PaymentOrderRecord,
  ReconcileSummary,
  Settlement,
} from './payout.types.js';

@Injectable()
export class PayoutService {
  constructor(
    private readonly orders: PayoutRepository,
    private readonly bank: BankGateway,
    private readonly config: PayoutConfig,
  ) {}

  /** Sends all pending orders exactly once each. Never resends on its own. */
  async executePayments(now: Date = new Date()): Promise<ExecuteSummary> {
    const summary: ExecuteSummary = { accepted: 0, duplicate: 0, transient: 0, permanent: 0 };
    const pending = await this.orders.findPending();
    for (const order of pending) {
      const txid = deriveTxid(order.id, order.effectiveDate);
      const result = await this.safeSend({ txid, amount: order.amountCents, key: order.supplierKey });
      await this.applySendOutcome(order, result);
      summary[result.outcome] += 1;
    }
    return summary;
  }
```

Hmm wait, `now` isn't used in executePayments except for marking. applySendOutcome(order, result, now). ✓ Use it.

```ts
  private async safeSend(input: BankSendInput): Promise<BankSendResult> {
    try {
      return await this.bank.send(input);
    } catch (err) {
      // A throw means the transport failed: we don't know whether the bank got it.
      // Only a classified outcome drives state. An unknown outcome is transient by definition.
      return { outcome: 'transient', detail: err instanceof Error ? err.message : String(err) };
    }
  }

  private async applySendOutcome(order: PaymentOrderRecord, result: BankSendResult, now: Date): Promise<void> {
    switch (result.outcome) {
      case 'accepted':
        // In flight. The statement is the only confirmation.
        await this.orders.markInFlight(order.id, now, 'accepted');
        break;
      case 'duplicate':
        // The bank already has this txid: success, not an error. The original instruction is (or was) in flight.
        await this.orders.markInFlight(order.id, now, 'duplicate');
        break;
      case 'transient':
        // Unknown outcome. Record and wait for reconciliation. Never resend here.
        await this.orders.markOutcomeUnknown(order.id, now);
        break;
      case 'permanent':
        // The bank definitively refused. Terminal: a human decides.
        await this.orders.markRejected(order.id, now, result.reason);
        break;
    }
  }
```

reconcile:

```ts
  async reconcile(window: DateWindow, now: Date = new Date()): Promise<ReconcileSummary> {
    const { from, to } = window;
    if (from.getTime() > to.getTime()) {
      throw new ApiError('invalid_window', 'window "from" must not be after "to"', 400, { from, to });
    }
    const summary: ReconcileSummary = { settled: 0, rescheduled: 0, parked: 0 };
    const statement = await this.loadStatement(from, to);
    const candidates = await this.orders.findReconcilable(from, to);
    const lagMs = this.config.lagMs;
    for (const order of candidates) {
      const txid = deriveTxid(order.id, order.effectiveDate);
      if (statement.has(txid)) {
        // Evidence of execution. Settle (the conditional update makes a re-run a no-op).
        const settled = await this.orders.markSettled(order.id, txid, now);
        if (settled) summary.settled += 1;
        continue;
      }
      if (order.state === 'IN_FLIGHT') {
        // The bank accepted this instruction. A missing statement row is lag, not evidence of absence.
        continue;
      }
      // OUTCOME_UNKNOWN:
      if (order.lastAttemptAt === null) continue;
      if (now.getTime() - order.lastAttemptAt.getTime() < lagMs) continue; // lag not yet passed: no evidence yet
      // Proven absent past the lag — the only path to resend (or park).
      if (order.attemptCount >= this.config.maxAttempts) {
        const parked = await this.orders.markNeedsReview(order.id, 'send_attempts_exhausted', now);
        if (parked) summary.parked += 1;
      } else {
        const released = await this.orders.markPendingForResend(order.id);
        if (released) summary.rescheduled += 1;
      }
    }
    return summary;
  }

  private async loadStatement(from: Date, to: Date): Promise<Map<string, Settlement>> {
    const seen = new Map<string, Settlement>();
    for (const day of eachDay(from, to)) {
      const entries = await this.bank.getStatement(dateKey(day));
      for (const entry of entries) seen.set(entry.txid, entry);
    }
    return seen;
  }
}
```

Wait — `summary[result.outcome] += 1` — the ExecuteSummary's keys match the outcome literals ✓ (accepted, duplicate, transient, permanent). TS: indexing with result.outcome which is a union of those keys ✓.

Edge: `markSettled` for an order that was OUTCOME_UNKNOWN with a settlement — correct (the timeout actually landed — exactly the incident scenario: settled, no resend).

Now — one design question: should `reconcile` handle `pending` orders whose txid appears on the statement? E.g., an order released for resend (PENDING) before executePayments sends it, and a statement entry for its txid appears (meaning the previous "unknown" send actually landed — the statement was just late!). If we then executePayments sends it again → the bank responds "duplicate" → IN_FLIGHT → reconcile settles. Handled! The duplicate classification covers the race. And should reconcile also settle PENDING orders found on the statement (avoiding a redundant send)? findReconcilable only loads IN_FLIGHT/OUTCOME_UNKNOWN. Should I include PENDING? Hmm: a PENDING order with a settlement entry = the previous send landed (statement late). Settling it now is strictly better than sending again (getting a duplicate). But is a PENDING order here "already matched"? It was OUTCOME_UNKNOWN, released… no wait: if it's PENDING now, it was released by a prior reconcile as proven absent. If a settlement appears after that (bank data arriving late), the bank DOES have it. Settling is correct. But if it's PENDING because it's a new order (never sent)? Its txid on the statement is impossible (never submitted) — unless another order shares the txid (impossible: derived from unique id+date). So: including PENDING in reconcile's candidates and settling on a statement match is safe and prevents one redundant send. But it complicates the "released" flow: reconcile releases B → PENDING. The same reconcile run doesn't see it (we loaded candidates before release). The next reconcile: B is PENDING. If statement still empty → PENDING and absent → do nothing ✓ (PENDING absent = nothing). If statement has it → settle ✓.

Should I include PENDING in findReconcilable? Pro: prevents a redundant (duplicate) send in a late-statement race. Con: reconcile touches the send-queue state more. And "orders already matched are skipped" still holds. Hmm — also risk: a fresh PENDING order that was never sent can't match (impossible). So including PENDING is safe and adds robustness. But it also makes the "proven absent → release" logic interact with PENDING… no, release only applies to OUTCOME_UNKNOWN. PENDING absent → continue.

Decision: include PENDING in the candidate filter, and in the loop: if statement has txid → settle (works from PENDING too, markSettled's condition should allow PENDING|IN_FLIGHT|OUTCOME_UNKNOWN). If absent: PENDING → continue (it's in the send queue). IN_FLIGHT → continue. OUTCOME_UNKNOWN → lag/exhaustion logic.

Hmm wait — but markSettled from PENDING: is that "auto-reverting" anything? No — settle is forward. But a subtle point: if a PENDING order was released by reconcile and the bank's send hasn't happened yet, and reconcile settles it from a late statement — great, we avoid a duplicate.

But wait, is this over-complicating? It prevents a real double-send race. I'll include PENDING in the candidate states, with clear comments. markSettled's where state IN (PENDING, IN_FLIGHT, OUTCOME_UNKNOWN).

Hmm, actually wait a moment. Let me reconsider — "reconcile … orders already matched are skipped before any decision is made about them." Adding PENDING: a PENDING order that was never sent (fresh, waiting for its first executePayments) — reconcile runs, statement for its date doesn't have its txid (it hasn't been sent) → continue. No harm. ✓

OK include PENDING. Wait, one more: `findPending` in executePayments + reconcile settling PENDING orders in parallel… concurrent execution, out of scope. The conditional update keeps consistency anyway.

Hmm, but — the idempotency test: run 1 releases B (→PENDING), settles A, C stays IN_FLIGHT. Run 2: candidates include B (PENDING), A? (SETTLED — no), C (IN_FLIGHT). B: statement empty → PENDING → continue ✓. State unchanged ✓. Good.

Now, the store's findReconcilable: `state: { in: [PENDING, IN_FLIGHT, OUTCOME_UNKNOWN] }` + effectiveDate range.

And markSettled: `where: { id, state: { in: [PENDING, IN_FLIGHT, OUTCOME_UNKNOWN] } }`.

Now the dates util:

```ts
export function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function parseDateKey(key: string): Date {
  const d = new Date(`${key}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new ApiError(...)  // hmm, util shouldn't import common? It's fine.
  return d;
}
export function eachDay(from: Date, to: Date): Date[] {
  const days: Date[] = [];
  let cur = startOfUtcDay(from);
  const end = startOfUtcDay(to);
  while (cur.getTime() <= end.getTime()) {
    days.push(cur);
    cur = new Date(cur.getTime() + 86_400_000);
  }
  return days;
}
export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
```

parseDateKey validation in the controller: also verify the round-trip: dateKey(parseDateKey(s)) === s (catches 2025-02-30). Since we construct directly from components (UTC), '2025-02-30' → Date.UTC(2025,1,30) rolls over to March 2 → dateKey = '2025-03-02' ≠ input → invalid ✓.

Controller:

```ts
import { Body, Controller, Post } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { PayoutService } from './payout.service.js';
import { parseDateKey, startOfUtcDay } from './dates.util.js';
import { DateWindow } from './payout.types.js';

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_WINDOW_DAYS = 31;

@Controller('payout-orders')
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post('execute')
  execute() {
    return this.service.executePayments();
  }

  @Post('reconcile')
  reconcile(@Body() body: unknown) {
    return this.service.reconcile(parseWindow(body));
  }
}

function parseWindow(body: unknown): DateWindow {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError('invalid_window', 'body must be an object with "from" and "to" date keys', 400, { received: 'object expected' });
  }
  const { from, to } = body as { from?: unknown; to?: unknown };
  const fromDate = parseDateField('from', from);
  const toDate = parseDateField('to', to);
  if (fromDate.getTime() > toDate.getTime()) throw new ApiError('invalid_window', '"from" must not be after "to"', 400, {});
  const days = Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000);
  if (days > MAX_WINDOW_DAYS) throw new ApiError('invalid_window', `window spans at most ${MAX_WINDOW_DAYS} days`, 400, {});
  return { from: fromDate, to: toDate };
}

function parseDateField(field: 'from' | 'to', value: unknown): Date {
  if (typeof value !== 'string' || !DATE_KEY_RE.test(value)) {
    throw new ApiError('invalid_window', `"${field}" must be a date key in YYYY-MM-DD form`, 400, { field });
  }
  const parsed = parseDateKey(value);
  if (dateKey(parsed) !== value) {
    throw new ApiError('invalid_window', `"${field}" is not a valid calendar date`, 400, { field });
  }
  return parsed;
}
```

"Zero business logic" in the controller — window validation is input validation ✓ (allowed: "controller validates input").

Now the repository file:

```ts
import { Injectable } from '@nestjs/common';
import { PaymentOrderState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  DateWindow? no — from/to are dates
  OrderState,
  PaymentOrderRecord,
} from './payout.types.js';

@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findPending(): Promise<PaymentOrderRecord[]> {
    const rows = await this.prisma.paymentOrder.findMany({
      where: { state: PaymentOrderState.PENDING },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toRecord);
  }

  async findReconcilable(from: Date, to: Date): Promise<PaymentOrderRecord[]> {
    const rows = await this.prisma.paymentOrder.findMany({
      where: {
        state: { in: [PaymentOrderState.PENDING, PaymentOrderState.IN_FLIGHT, PaymentOrderState.OUTCOME_UNKNOWN] },
        effectiveDate: { gte: from, lte: to },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toRecord);
  }

  async markInFlight(id: string, at: Date, lastResult: 'accepted' | 'duplicate'): Promise<boolean> {
    return this.transition(
      { id, state: PaymentOrderState.PENDING },
      { state: PaymentOrderState.IN_FLIGHT, lastAttemptAt: at, attemptCount: { increment: 1 }, lastResult },
    );
  }

  async markOutcomeUnknown(id: string, at: Date): Promise<boolean> {
    return this.transition(
      { id, state: PaymentOrderState.PENDING },
      { state: PaymentOrderState.OUTCOME_UNKNOWN, lastAttemptAt: at, attemptCount: { increment: 1 }, lastResult: 'transient' },
    );
  }

  async markRejected(id: string, at: Date, reason: string): Promise<boolean> {
    return this.transition(
      { id, state: PaymentOrderState.PENDING },
      { state: PaymentOrderState.REJECTED, lastAttemptAt: at, attemptCount: { increment: 1 }, lastResult: 'permanent', rejectReason: reason },
    );
  }

  async markSettled(id: string, txid: string, at: Date): Promise<boolean> {
    return this.transition(
      { id, state: { in: [PaymentOrderState.PENDING, PaymentOrderState.IN_FLIGHT, PaymentOrderState.OUTCOME_UNKNOWN] } },
      { state: PaymentOrderState.SETTLED, settleTxid: txid, settledAt: at },
    );
  }

  async markPendingForResend(id: string): Promise<boolean> {
    return this.transition(
      { id, state: PaymentOrderState.OUTCOME_UNKNOWN },
      { state: PaymentOrderState.PENDING },
    );
  }

  async markNeedsReview(id: string, reason: string, at: Date): Promise<boolean> {
    return this.transition(
      { id, state: PaymentOrderState.OUTCOME_UNKNOWN },
      { state: PaymentOrderState.NEEDS_REVIEW, parkedReason: reason, updatedAt? (updatedAt is automatic) },
    );
  }

  private async transition(where: ..., data: ...): Promise<boolean> {
    const res = await this.prisma.paymentOrder.updateMany({ where, data });
    return res.count > 0;
  }
}

function toRecord(row: Prisma.PaymentOrderGetPayload<{}>? or the model type): PaymentOrderRecord {
  return {
    id: row.id,
    supplierKey: row.supplierKey,
    amountCents: row.amountCents,
    effectiveDate: row.effectiveDate,
    state: row.state,
    attemptCount: row.attemptCount,
    lastAttemptAt: row.lastAttemptAt,
  };
}
```

`updatedAt` — Prisma auto-manages it. Don't set manually.

Type of `where`: to avoid importing Prisma's types, I'll type the transition helper's params:

```ts
private async transition(
  where: Prisma.PaymentOrderWhereUniqueInput,
  data: Prisma.PaymentOrderUpdateManyMutationInput,
): Promise<boolean>
```

Need `import { Prisma } from '@prisma/client'` — the types come from the generated client. In this offline deliverable, that's fine (standard).

Hmm — does the repository import `Prisma` namespace and `PaymentOrderState` from '@prisma/client' — yes, standard.

The PrismaService:

```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> { await this.$connect(); }
  async onModuleDestroy(): Promise<void> { await this.$disconnect(); }
}
```

Standard. (Or extend PrismaClient directly — fine.)

PrismaModule:

```ts
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

PayoutModule:

```ts
@Module({
  imports: [PrismaModule, ScheduleModule.forRoot()],
  controllers: [PayoutController],
  providers: [PayoutService, PayoutRepository, BankGateway, PayoutConfig, PayoutProcessor],
  exports: [PayoutService],
})
export class PayoutModule {}
```

Wait — DI: PayoutService constructor(PayoutRepository, BankGateway, PayoutConfig) — all providers in the module ✓. PayoutRepository(PrismaService) — imported ✓. PayoutProcessor(PayoutService) ✓. PayoutController(PayoutService) ✓.

ScheduleModule.forRoot() in the feature module — works (forRoot registers cron. Can be called in any module). ✓

BankGateway default adapter:

```ts
import { Injectable } from '@nestjs/common';
import { BankSendInput, BankSendResult, Settlement } from './payout.types.js';

/**
 * Port to the bank's instant-payment API.
 *
 * // ASSUMPTION: the vendor's transport (endpoints, auth, SDK) is not specified in
 * the task, so the default adapter is a stub. A production deployment must override
 * this provider with the vendor client (e.g. `{ provide: BankGateway, useValue: vendorClient }`),
 * whose `send`/`getStatement` map the raw responses to the four classified outcomes.
 */
@Injectable()
export class BankGateway {
  async send(_input: BankSendInput): Promise<BankSendResult> {
    throw new Error('BankGateway is not wired: provide the vendor bank client for this environment');
  }

  async getStatement(_date: string): Promise<Settlement[]> {
    throw new Error('BankGateway is not wired: provide the vendor bank client for this environment');
  }
}
```

Wait — but if the real bank call throws for any reason in production, executePayments catches it → transient ✓. getStatement throwing propagates → reconcile fails, retried next run ✓.

payout.types.ts:

```ts
/** Domain states for a payment order. Values mirror the PaymentOrderState enum in the Prisma schema. */
export type OrderState =
  | 'PENDING'
  | 'IN_FLIGHT'
  | 'OUTCOME_UNKNOWN'
  | 'SETTLED'
  | 'REJECTED'
  | 'NEEDS_REVIEW';

export interface PaymentOrderRecord {
  id: string;
  supplierKey: string;
  /** Amount in minor units (cents). Integer only. */
  amountCents: number;
  /** UTC date the payment applies to. Part of the derived txid. */
  effectiveDate: Date;
  state: OrderState;
  attemptCount: number;
  lastAttemptAt: Date | null;
}

export interface BankSendInput {
  txid: string;
  amount: number; // minor units
  key: string;
}

/** The four classified outcomes of bank.send. */
export type BankSendResult =
  | { outcome: 'accepted' }
  | { outcome: 'duplicate' }
  | { outcome: 'transient'; detail: string }
  | { outcome: 'permanent'; reason: string };

export interface Settlement {
  /** The txid we submitted with bank.send — the join key. */
  txid: string;
  amount: number; // minor units
  key: string;
}

/** Inclusive range of statement dates (UTC midnight). */
export interface DateWindow {
  from: Date;
  to: Date;
}

export interface ExecuteSummary {
  accepted: number;
  duplicate: number;
  transient: number;
  permanent: number;
}

export interface ReconcileSummary {
  settled: number;
  rescheduled: number;
  parked: number;
}
```

txid.util.ts:

```ts
import { createHash } from 'node:crypto';
import { dateKey } from './dates.util.js';

/**
 * Derives the bank txid deterministically from stable order attributes and the
 * effective date: the same order on the same date always yields the same txid, so a
 * statement entry is matchable and a resend is recognised by the bank as the same
 * instruction rather than a new payment.
 *
 * Never change this derivation without migrating existing orders: a new derivation
 * would make history unmatchable and resends unrecognised.
 */
export function deriveTxid(orderId: string, effectiveDate: Date): string {
  const digest = createHash('sha256').update(`${orderId}:${dateKey(effectiveDate)}`).digest('hex');
  return `po_${digest.slice(0, 40)}`;
}
```

Hmm — prefix 'po_' + 40 hex chars (20 bytes) — a decent txid length. Deterministic ✓.

dates.util.ts — parseDateKey: throw an ApiError? Util → common dependency. Or return null and let the controller throw. Let me have parseDateKey return a Date (assumes a format-validated input) and let the controller do the round-trip check.

```ts
/** 'YYYY-MM-DD' key for a date (UTC). */
export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Parse a 'YYYY-MM-DD' key to a Date at UTC midnight. Callers should validate the shape first. */
export function parseDateKey(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Inclusive list of UTC days from `from` to `to`. Empty when from > to. */
export function eachDay(from: Date, to: Date): Date[] {
  const days: Date[] = [];
  const end = startOfUtcDay(to).getTime();
  let cursor = startOfUtcDay(from);
  while (cursor.getTime() <= end) {
    days.push(cursor);
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return days;
}
```

payout-config.ts:

```ts
import { Injectable } from '@nestjs/common';

const DEFAULT_LAG_MINUTES = 30; // The bank publishes the statement with up to ~30 min lag
const DEFAULT_MAX_ATTEMPTS = 5;

/** Configuration from environment variables only. */
@Injectable()
export class PayoutConfig {
  get lagMs(): number {
    return readPositiveInt(process.env.PAYOUT_PUBLISHING_LAG_MINUTES, DEFAULT_LAG_MINUTES) * 60_000;
  }

  get maxAttempts(): number {
    return readPositiveInt(process.env.PAYOUT_MAX_SEND_ATTEMPTS, DEFAULT_MAX_ATTEMPTS);
  }
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}
```

The processor:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { addDays? } ...
```

Need an `addDays` helper? from = startOfUtcDay(new Date(Date.now() - 86_400_000)), to = startOfUtcDay(now). No addDays needed.

```ts
/**
 * The scheduled reconcile job: every 15 minutes, over a window that overlaps
 * with the previous run (yesterday + today). Reconciliation is idempotent, so the
 * overlap is harmless.
 */
@Injectable()
export class PayoutProcessor {
  private readonly logger = new Logger(PayoutProcessor.name);

  constructor(private readonly service: PayoutService) {}

  @Cron('*/15 * * * *')
  async runReconcile(): Promise<void> {
    const now = new Date();
    const window = {
      from: startOfUtcDay(new Date(now.getTime() - 86_400_000)),
      to: startOfUtcDay(now),
    };
    try {
      const summary = await this.service.reconcile(window, now);
      this.logger.log(
        `reconcile ${dateKey(window.from)}..${dateKey(window.to)}: settled=${summary.settled} rescheduled=${summary.rescheduled} parked=${summary.parked}`,
      );
    } catch (err) {
      // The next 15-minute run re-covers the same window; fail loudly, don't crash the process.
      this.logger.error(`reconcile failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
```

Hmm — try/catch in the processor: good (a cron that throws crashes? Nest's cron catches? Actually, if a cron job function throws, Nest's cron will log the error (does it catch?) — I think it logs unhandled rejections… either way safe: catch and log. Fine.

Wait — does the processor's catch violate "do exactly what the task asks"? It's the job deliverable. Reasonable robustness. Keep it.

Now — the tests. Let me write `test/payout.service.spec.ts` in full.

```ts
import { describe, expect, it } from 'vitest';
import { PayoutService } from '../src/payout/payout.service.js';
import { deriveTxid } from '../src/payout/txid.util.js';
import { BankSendInput, BankSendResult, OrderState, Settlement } from '../src/payout/payout.types.js';

const LAG_MS = 30 * 60_000;
const MAX_ATTEMPTS = 5;
const CONFIG = { lagMs: LAG_MS, maxAttempts: MAX_ATTEMPTS };

interface Row {
  id: string;
  supplierKey: string;
  amountCents: number;
  effectiveDate: Date;
  state: OrderState;
  attemptCount: number;
  lastAttemptAt: Date | null;
  lastResult: string | null;
  rejectReason: string | null;
  parkedReason: string | null;
  settleTxid: string | null;
  settledAt: Date | null;
}

function makeOrder(overrides: Partial<Omit<Row, 'id'>> & { id: string }): Row {
  return {
    supplierKey: 'key_123',
    amountCents: 1840_000, // €18,400.00
    effectiveDate: new Date('2025-03-10T00:00:00.000Z'),
    state: 'PENDING',
    attemptCount: 0,
    lastAttemptAt: null,
    lastResult: null,
    rejectReason: null,
    parkedReason: null,
    settleTxid: null,
    settledAt: null,
    ...overrides,
  };
}

class FakeBank {
  scripted: BankSendResult[] = [];
  sent: BankSendInput[] = [];
  statements = new Map<string, Settlement[]>();
  statementCalls: string[] = [];

  async send(input: BankSendInput): Promise<BankSendResult> {
    this.sent.push(input);
    const next = this.scripted.shift();
    if (!next) throw new Error('FakeBank: no scripted outcome left');
    return next;
  }

  async getStatement(date: string): Promise<Settlement[]> {
    this.statementCalls.push(date);
    return this.statements.get(date) ?? [];
  }
}
```

Hmm wait — `this.sent.push(input); ... if (!next) throw` — if no scripted outcome, we throw after recording the input: that's actually the "bank throws" behavior = transient. But for tests expecting a throw, better to script it explicitly. OK: if the queue is empty, throw (simulate a transport crash). A test that uses exactly as many sends as it scripted won't hit this.

FakeStore:

```ts
class FakeStore {
  rows = new Map<string, Row>();

  seed(order: Row): void { this.rows.set(order.id, { ...order }); }
  get(id: string): Row { return { ...this.rows.get(id)! }; }
  snapshot(): Record<string, Row> {
    const out: Record<string, Row> = {};
    for (const [id, row] of this.rows) out[id] = { ...row };
    return out;
  }

  async findPending(): Promise<PaymentOrderRecord[]> {
    return [...this.rows.values()].filter((r) => r.state === 'PENDING').map(({ ...rest }) => rest);
  }

  async findReconcilable(from: Date, to: Date): Promise<PaymentOrderRecord[]> {
    return [...this.rows.values()]
      .filter((r) => (r.state === 'PENDING' || r.state === 'IN_FLIGHT' || r.state === 'OUTCOME_UNKNOWN')
        && r.effectiveDate.getTime() >= from.getTime()
        && r.effectiveDate.getTime() <= to.getTime())
      .map((r) => ({ ...r }));
  }

  async markInFlight(id: string, at: Date, lastResult: 'accepted' | 'duplicate'): Promise<boolean> {
    const r = this.rows.get(id);
    if (!r || r.state !== 'PENDING') return false;
    Object.assign(r, { state: 'IN_FLIGHT', attemptCount: r.attemptCount + 1, lastAttemptAt: at, lastResult });
    return true;
  }

  async markOutcomeUnknown(id: string, at: Date): Promise<boolean> {
    const r = this.rows.get(id);
    if (!r || r.state !== 'PENDING') return false;
    Object.assign(r, { state: 'OUTCOME_UNKNOWN', attemptCount: r.attemptCount + 1, lastAttemptAt: at, lastResult: 'transient' });
    return true;
  }

  async markRejected(id: string, at: Date, reason: string): Promise<boolean> {
    const r = this.rows.get(id);
    if (!r || r.state !== 'PENDING') return false;
    Object.assign(r, { state: 'REJECTED', attemptCount: r.attemptCount + 1, lastAttemptAt: at, lastResult: 'permanent', rejectReason: reason });
    return true;
  }

  async markSettled(id: string, txid: string, at: Date): Promise<boolean> {
    const r = this.rows.get(id);
    if (!r || !(r.state === 'PENDING' || r.state === 'IN_FLIGHT' || r.state === 'OUTCOME_UNKNOWN')) return false;
    Object.assign(r, { state: 'SETTLED', settleTxid: txid, settledAt: at });
    return true;
  }

  async markPendingForResend(id: string): Promise<boolean> {
    const r = this.rows.get(id);
    if (!r || r.state !== 'OUTCOME_UNKNOWN') return false;
    Object.assign(r, { state: 'PENDING' });
    return true;
  }

  async markNeedsReview(id: string, reason: string, _at: Date): Promise<boolean> {
    const r = this.rows.get(id);
    if (!r || r.state !== 'OUTCOME_UNKNOWN') return false;
    Object.assign(r, { state: 'NEEDS_REVIEW', parkedReason: reason });
    return true;
  }
}
```

Wait — the fake's `markInFlight`'s lastResult parameter is typed 'accepted'|'duplicate' ✓ matches the repository.

Structural compatibility: FakeStore vs PayoutRepository — the service's constructor types the dep as `PayoutRepository` (the class). Is FakeStore assignable to PayoutRepository? PayoutRepository's instance type includes the constructor property + prisma field (private!). Private fields break structural typing: a class with a `private readonly prisma` — a structurally-typed target with a private member requires the source to be the same class! Ugh! TS: private/protected members are nominal. So a `PayoutRepository` with a private field can't be faked.

Fix options:
1. The service depends on the `PayoutOrderStore` interface (defined in the repository or types file) → fake implements the interface ✓. Nest DI: interface → design:type = Object → needs an @Inject token. Manageable: define an injection token `export const PAYOUT_ORDER_STORE = 'PAYOUT_ORDER_STORE'`. The service: `constructor(@Inject(PAYOUT_ORDER_STORE) private readonly orders: PayoutOrderStore, ...)`. BankGateway and PayoutConfig are concrete classes without private fields? BankGateway: no fields (the stub) → structurally fakeable ✓. PayoutConfig: only getters, no fields → structurally fakeable ✓. So only the store needs a token (the repository has a private prisma field).

   Alternatively, make the repository's prisma field non-private? No. Use a token — standard Nest practice.

   So: `payout.repository.ts` exports `PayoutOrderStore` interface + `PAYOUT_ORDER_STORE` token + `PayoutRepository implements PayoutOrderStore`. The service uses @Inject(PAYOUT_ORDER_STORE). The module: `providers: [..., PayoutRepository, { provide: PAYOUT_ORDER_STORE, useClass: PayoutRepository }]`.

   And the BankGateway dep: service uses the concrete class (no private members → fakes OK) ✓. PayoutConfig concrete (getters only) ✓.

   Hmm wait — `class PayoutConfig` with getters: the instance type has no private → structural ✓. A test literal `{ lagMs: 300000, maxAttempts: 5 }` is assignable to the PayoutConfig type? Class type with only getters = { lagMs: number; maxAttempts: number } (readonly? getters are readonly properties in the instance type) — literal assignable ✓.

   And BankGateway: the test's FakeBank has extra members (scripted, sent, statements) — structurally OK (excess properties are allowed when not a fresh literal… wait, FakeBank is a class instance passed as a variable → excess is fine ✓).

2. Interface for everything — more tokens. No — keep tokens minimal: just for the store.

OK, going with option 1.

Now let me write the tests.

Shared constants:
```ts
const LAG_MS = 30 * 60_000;
const MAX_ATTEMPTS = 5;
const CONFIG = { lagMs: LAG_MS, maxAttempts: MAX_ATTEMPTS } as const;  // hmm, service's config type is PayoutConfig (getters) — a literal with as const is fine.
const T0 = new Date('2025-03-10T12:00:00.000Z');
const EFFECTIVE = new Date('2025-03-10T00:00:00.000Z');
const WINDOW = { from: new Date('2025-03-09T00:00:00.000Z'), to: new Date('2025-03-10T00:00:00.000Z') };
```

Test 1 — timeout but settled, no resend:

```ts
it('settles a timed-out order that appears on the statement and never re-sends it', async () => {
  const store = new FakeStore();
  const bank = new FakeBank();
  const order = makeOrder({ id: 'order-1' });
  store.seed(order);
  bank.scripted.push({ outcome: 'transient', detail: 'timeout' });

  const service = new PayoutService(store, bank, CONFIG);

  // Original send times out: outcome is unknown, nothing else changes.
  await service.executePayments(T0);
  expect(store.get('order-1').state).toBe('OUTCOME_UNKNOWN');
  expect(store.get('order-1').attemptCount).toBe(1);

  // The bank's statement (published after the lag) shows the txid we sent.
  const txid = deriveTxid('order-1', EFFECTIVE);
  bank.statements.set('2025-03-10', [{ txid, amount: 1840_000, key: 'key_123' }]);

  const summary = await service.reconcile(WINDOW, new Date(T0.getTime() + LAG_MS + 60_000));

  expect(summary.settled).toBe(1);
  const settled = store.get('order-1');
  expect(settled.state).toBe('SETTLED');
  expect(settled.settleTxid).toBe(txid);

  // No resend: the send path has nothing left to do.
  const before = bank.sent.length;
  await service.executePayments(new Date(T0.getTime() + LAG_MS + 120_000));
  expect(bank.sent.length).toBe(before);
});
```

Test 2 — proven absent, resend with same txid:

```ts
it('re-sends a proven-absent order with the same derived txid', async () => {
  const store = new FakeStore();
  const bank = new FakeBank();
  store.seed(makeOrder({ id: 'order-2' }));
  bank.scripted.push({ outcome: 'transient', detail: 'timeout' });
  const service = new PayoutService(store, bank, CONFIG);

  await service.executePayments(T0);
  expect(store.get('order-2').state).toBe('OUTCOME_UNKNOWN');
  const firstTxid = bank.sent[0].txid;

  // Past the lag, the statement for the order's date is empty: proven absent.
  const afterLag = new Date(T0.getTime() + LAG_MS + 60_000);
  const summary = await service.reconcile(WINDOW, afterLag);
  expect(summary.rescheduled).toBe(1);
  expect(store.get('order-2').state).toBe('PENDING');

  // The next send goes out with the same txid — the bank sees the same instruction.
  bank.scripted.push({ outcome: 'accepted' });
  await service.executePayments(new Date(afterLag.getTime() + 60_000));
  expect(bank.sent.length).toBe(2);
  expect(bank.sent[1].txid).toBe(firstTxid);
  expect(bank.sent[1].amount).toBe(1840_000);
  expect(store.get('order-2').state).toBe('IN_FLIGHT');
  expect(store.get('order-2').attemptCount).toBe(2);
});
```

Test 3 — before the lag, nothing changes:

```ts
it('takes no action while the publishing lag has not passed', async () => {
  ... seed OUTCOME_UNKNOWN with lastAttemptAt = T0, attempts 1
  const summary = await service.reconcile(WINDOW, new Date(T0.getTime() + LAG_MS - 1_000));
  expect(summary).toEqual({ settled: 0, rescheduled: 0, parked: 0 });
  expect(store.get('order-3').state).toBe('OUTCOME_UNKNOWN');
});
```

Test 4 — in_flight absent is never resent:

```ts
it('never re-sends an accepted (in-flight) order that is late on the statement', async () => {
  store.seed(makeOrder({ id: 'order-4', state: 'IN_FLIGHT', attemptCount: 1, lastAttemptAt: T0, lastResult: 'accepted' }));
  const service = ...
  const afterLag = new Date(T0.getTime() + LAG_MS + 60_000);
  const summary = await service.reconcile(WINDOW, afterLag);
  expect(summary).toEqual({ settled: 0, rescheduled: 0, parked: 0 });
  expect(store.get('order-4').state).toBe('IN_FLIGHT');
  await service.executePayments(afterLag); // nothing pending
  expect(bank.sent.length).toBe(0);
});
```

Test 5 — idempotent, overlapping windows:

```ts
it('is idempotent when run twice over the same window and over overlapping windows', async () => {
  const store = new FakeStore();
  const bank = new FakeBank();
  store.seed(makeOrder({ id: 'a', state: 'OUTCOME_UNKNOWN', attemptCount: 1, lastAttemptAt: T0, lastResult: 'transient' }));
  store.seed(makeOrder({ id: 'b', state: 'OUTCOME_UNKNOWN', attemptCount: 1, lastAttemptAt: T0, lastResult: 'transient' }));
  store.seed(makeOrder({ id: 'c', state: 'IN_FLIGHT', attemptCount: 1, lastAttemptAt: T0, lastResult: 'accepted' }));
  bank.statements.set('2025-03-10', [{ txid: deriveTxid('a', EFFECTIVE), amount: 1840_000, key: 'key_123' }]);

  const service = new PayoutService(store, bank, CONFIG);
  const afterLag = new Date(T0.getTime() + LAG_MS + 60_000);

  const first = await service.reconcile(WINDOW, afterLag);
  expect(first).toEqual({ settled: 1, rescheduled: 1, parked: 0 });

  const afterFirst = store.snapshot();
  const second = await service.reconcile(WINDOW, new Date(afterLag.getTime() + 60_000));
  const afterSecond = store.snapshot();
  expect(second).toEqual({ settled: 0, rescheduled: 0, parked: 0 });
  expect(afterSecond).toEqual(afterFirst);

  // An overlapping window that shifts by one day changes nothing.
  const wider = { from: new Date('2025-03-08T00:00:00.000Z'), to: new Date('2025-03-11T00:00:00.000Z') };
  const third = await service.reconcile(wider, new Date(afterLag.getTime() + 120_000));
  expect(third).toEqual({ settled: 0, rescheduled: 0, parked: 0 });
  expect(store.snapshot()).toEqual(afterFirst);
});
```

Wait — 'b' is released to PENDING in run 1. Run 2: 'b' is PENDING, no statement entry → continue ✓. 'c' is IN_FLIGHT, absent → continue ✓. 'a' is SETTLED → not loaded ✓.

Note: the wider window includes 2025-03-08..11: fake statement only has '2025-03-10' ✓.

Test 6 — attempt exhaustion loop:

```ts
it('parks an order for manual review after five attempts, never auto-reverting', async () => {
  const store = new FakeStore();
  const bank = new FakeBank();
  store.seed(makeOrder({ id: 'order-5' }));
  const service = new PayoutService(store, bank, CONFIG);

  let clock = T0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    bank.scripted.push({ outcome: 'transient', detail: `timeout ${attempt}` });
    await service.executePayments(clock);
    clock = new Date(clock.getTime() + LAG_MS + 60_000); // wait out the lag
    await service.reconcile(WINDOW, clock);
    expect(store.get('order-5').attemptCount).toBe(attempt);
    // Until exhausted, each proven-absent cycle releases the order for a resend.
    if (attempt < MAX_ATTEMPTS) {
      expect(store.get('order-5').state).toBe('PENDING');
    }
  }
  // After the fifth proven-absent outcome, the order is parked — not re-released.
  clock = new Date(clock.getTime() + LAG_MS + 60_000);
  const summary = await service.reconcile(WINDOW, clock);
  expect(summary.parked).toBe(1);
  const parked = store.get('order-5');
  expect(parked.state).toBe('NEEDS_REVIEW');
  expect(parked.parkedReason).toBe('send_attempts_exhausted');
  expect(parked.attemptCount).toBe(MAX_ATTEMPTS);

  // Every attempt used the same derived txid.
  expect(bank.sent).toHaveLength(MAX_ATTEMPTS);
  const txid = deriveTxid('order-5', EFFECTIVE);
  for (const s of bank.sent) expect(s.txid).toBe(txid);

  // Terminal: neither a further reconcile nor the send path touches it.
  const after = store.snapshot();
  const later = new Date(clock.getTime() + LAG_MS + 60_000);
  await service.reconcile(WINDOW, later);
  await service.executePayments(later);
  expect(store.snapshot()).toEqual(after);
  expect(bank.sent).toHaveLength(MAX_ATTEMPTS);
});
```

Wait — trace the loop carefully. Start: PENDING, attempts 0.
- Iter 1: executePayments: PENDING→send (transient)→OUTCOME_UNKNOWN, attempts 1, lastAttemptAt=T0. clock=T0+31min. reconcile(WINDOW, clock): OUTCOME_UNKNOWN, past lag, absent, attempts 1 < 5 → PENDING. attempts 1 ✓ state PENDING ✓.
- Iter 2: executePayments(clock): PENDING→send→OUTCOME_UNKNOWN attempts 2 lastAttemptAt=clock. clock+=31min. reconcile: past lag, absent, attempts 2<5 → PENDING. ✓
- …
- Iter 5: executePayments: attempts 5, OUTCOME_UNKNOWN. clock+=31min. reconcile: past lag, absent, attempts 5 >= 5 → NEEDS_REVIEW (parked=1).

Wait! In the loop as written, reconcile happens inside the loop at iter 5 — so after iter 5, state is already NEEDS_REVIEW, and the "post-loop" reconcile parks… no — the parking happens at iter 5's reconcile. Let me re-trace: iter 5: executePayments → attempts=5, OUTCOME_UNKNOWN. Then clock += 31min. reconcile → attempts 5 >= 5 → markNeedsReview → parked. So after the loop, state is already NEEDS_REVIEW, and my `if (attempt < MAX_ATTEMPTS) expect PENDING` check is skipped at iter 5 ✓. Then the post-loop "parking" reconcile: order is NEEDS_REVIEW → not a candidate → summary.parked = 0, not 1! My assertion `summary.parked).toBe(1)` is wrong.

Fix: move the parking assertion to inside the loop at attempt 5, or restructure:

```ts
let lastSummary;
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  bank.scripted.push({ outcome: 'transient', detail: `timeout ${attempt}` });
  await service.executePayments(clock);
  clock = new Date(clock.getTime() + LAG_MS + 60_000);
  lastSummary = await service.reconcile(WINDOW, clock);
  expect(store.get('order-5').attemptCount).toBe(attempt);
  if (attempt < MAX_ATTEMPTS) {
    expect(store.get('order-5').state).toBe('PENDING');
    expect(lastSummary.rescheduled).toBe(1);
  }
}
// The fifth proven-absent outcome parks the order.
expect(lastSummary.parked).toBe(1);
expect(store.get('order-5').state).toBe('NEEDS_REVIEW');
expect(store.get('order-5').parkedReason).toBe('send_attempts_exhausted');
```

✓ Correct. Then the terminal check.

Test 7 — four outcomes:

```ts
it('classifies the four send outcomes onto four distinct paths', async () => {
  const store = new FakeStore();
  const bank = new FakeBank();
  store.seed(makeOrder({ id: 'o-acc' }));
  store.seed(makeOrder({ id: 'o-dup' }));
  store.seed(makeOrder({ id: 'o-trans' }));
  store.seed(makeOrder({ id: 'o-perm' }));
  bank.scripted.push(
    { outcome: 'accepted' },
    { outcome: 'duplicate' },
    { outcome: 'transient', detail: '503' },
    { outcome: 'permanent', reason: 'closed_beneficiary' },
  );
  const service = new PayoutService(store, bank, CONFIG);
  const summary = await service.executePayments(T0);

  expect(summary).toEqual({ accepted: 1, duplicate: 1, transient: 1, permanent: 1 });
  expect(store.get('o-acc').state).toBe('IN_FLIGHT');
  expect(store.get('o-acc').lastResult).toBe('accepted');
  expect(store.get('o-dup').state).toBe('IN_FLIGHT');
  expect(store.get('o-dup').lastResult).toBe('duplicate');
  expect(store.get('o-trans').state).toBe('OUTCOME_UNKNOWN');
  expect(store.get('o-trans').lastResult).toBe('transient');
  expect(store.get('o-perm').state).toBe('REJECTED');
  expect(store.get('o-perm').lastResult).toBe('permanent');
  expect(store.get('o-perm').rejectReason).toBe('closed_beneficiary');
  for (const id of ['o-acc', 'o-dup', 'o-trans', 'o-perm']) {
    expect(store.get(id).attemptCount).toBe(1);
  }
  // Each send used the order's own derived txid.
  expect(bank.sent.map((s) => s.txid)).toEqual([
    deriveTxid('o-acc', EFFECTIVE),
    deriveTxid('o-dup', EFFECTIVE),
    deriveTxid('o-trans', EFFECTIVE),
    deriveTxid('o-perm', EFFECTIVE),
  ]);
});
```

Note: findPending order — the fake returns in Map insertion order ✓ deterministic.

Test 8 — bank throws → transient (unknown):

```ts
it('treats a transport throw from bank.send as an unknown outcome, not a failure to act on', async () => {
  store.seed(makeOrder({ id: 'o-throw' }));
  bank.send = async (input) => { bank.sent.push(input); throw new Error('ECONNRESET'); };
  ...
  await service.executePayments(T0);
  expect(store.get('o-throw').state).toBe('OUTCOME_UNKNOWN');
  expect(store.get('o-throw').attemptCount).toBe(1);
});
```

Hmm — overriding FakeBank's instance method: `bank.send = ...` — a class method assignment, fine in TS.

Test 9 — settled orders are skipped (double-run within a window) — covered by test 5.

Also a test: reconcile settles an IN_FLIGHT order found on the statement (normal success path):

```ts
it('settles an in-flight order when its statement entry arrives', async () => {
  store.seed(makeOrder({ id: 'o-settle', state: 'IN_FLIGHT', attemptCount: 1, lastAttemptAt: T0, lastResult: 'accepted' }));
  bank.statements.set('2025-03-10', [{ txid: deriveTxid('o-settle', EFFECTIVE), amount: 1840_000, key: 'key_123' }]);
  const summary = await service.reconcile(WINDOW, T0); // settlement doesn't need the lag
  expect(summary.settled).toBe(1);
  expect(store.get('o-settle').state).toBe('SETTLED');
});
```

Good — a happy path (in addition to the negative paths, so it's "not just non-happy").

And the txid spec `test/txid.util.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { deriveTxid } from '../src/payout/txid.util.js';

describe('deriveTxid', () => {
  it('is deterministic for the same order and effective date', () => {
    const a = new Date('2025-03-10T00:00:00.000Z');
    const b = new Date('2025-03-10T05:00:00.000Z'); // same UTC day
    expect(deriveTxid('order-1', a)).toBe(deriveTxid('order-1', b));
    expect(deriveTxid('order-1', a)).toMatch(/^po_[0-9a-f]{40}$/);
  });

  it('differs when the effective date differs', () => {
    expect(deriveTxid('order-1', new Date('2025-03-10T00:00:00.000Z')))
      .not.toBe(deriveTxid('order-1', new Date('2025-03-11T00:00:00.000Z')));
  });

  it('differs when the order differs', () => {
    const d = new Date('2025-03-10T00:00:00.000Z');
    expect(deriveTxid('order-1', d)).not.toBe(deriveTxid('order-2', d));
  });
});
```

Wait, test 1b: same UTC day at different times — dateKey handles it ✓ (tests that day granularity is the key).

Now — a potential issue with the fake store in the service: the service is typed `@Inject(PAYOUT_ORDER_STORE) private readonly orders: PayoutOrderStore`. In tests: `new PayoutService(store, bank, CONFIG)` — TS checks: FakeStore must be assignable to PayoutOrderStore (an interface) ✓. bank: FakeBank → BankGateway class type — BankGateway has no private members. FakeBank is structurally compatible? The service's param type is `BankGateway` (the class type). FakeBank instance: needs methods send(input): Promise<BankSendResult>, getStatement(date): Promise<Settlement[]> ✓ + excess members OK (not a fresh literal) ✓.

CONFIG literal: `{ lagMs: 30*60_000, maxAttempts: 5 }` → PayoutConfig class type { readonly lagMs: number; readonly maxAttempts: number }? Hmm — actually wait: a class with a getter `get lagMs(): number` — the instance type property `lagMs: number` (readonly). A fresh object literal `{ lagMs: n, maxAttempts: n }` is assignable to a target with readonly properties ✓ (fresh literal excess property check: the properties match, no excess ✓).

Hmm, one issue: a fresh literal's excess property check against a class instance type — allowed if all properties exist on the target ✓.

Now — `as const` on CONFIG? Not needed.

Now, PayoutOrderStore interface — where to define? `payout.repository.ts`:

```ts
/** The port the service uses to read and advance payment orders. */
export interface PayoutOrderStore {
  findPending(): Promise<PaymentOrderRecord[]>;
  findReconcilable(from: Date, to: Date): Promise<PaymentOrderRecord[]>;
  markInFlight(id: string, at: Date, lastResult: 'accepted' | 'duplicate'): Promise<boolean>;
  markOutcomeUnknown(id: string, at: Date): Promise<boolean>;
  markRejected(id: string, at: Date, reason: string): Promise<boolean>;
  markSettled(id: string, txid: string, at: Date): Promise<boolean>;
  markPendingForResend(id: string): Promise<boolean>;
  markNeedsReview(id: string, reason: string, at: Date): Promise<boolean>;
}

export const PAYOUT_ORDER_STORE = 'PAYOUT_ORDER_STORE';
```

And FakeStore in the test `implements PayoutOrderStore`? If it also has extra methods (seed, get, snapshot) — the interface is satisfied ✓. Write `class FakeStore implements PayoutOrderStore` — nice.

Now — one more consideration on the service's executePayments: it iterates `findPending()` and sends sequentially. If two orders are pending and both sends are transient — each marked independently ✓. Sequential avoids bank concurrency issues ✓.

Summary type ExecuteSummary — `summary[result.outcome] += 1`: result.outcome: 'accepted'|'duplicate'|'transient'|'permanent' — indexing into ExecuteSummary ✓.

Now — the service's import of ApiError for invalid window: throw new ApiError('invalid_window', ...). The filter maps to 400 ✓. The controller validates first anyway. The service's guard is defensive (the processor builds a valid window). Fine.

Hmm — actually, should the service throw at all? The controller validates. The service's guard is a double safety for direct callers (the processor). Keep it.

Now — the filter file. Need to import the express Response type:

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Response } from 'express';
import { ApiError } from './api-error.js';
```

With NodeNext + @types/express, the `import { Response } from 'express'` type import — esModuleInterop, fine.

api-error.ts:

```ts
/** Application error with a stable snake_case code. The response envelope's contract. */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
```

Filter:

```ts
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof ApiError) {
      this.write(response, exception.status, exception.code, exception.message, exception.details);
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      this.write(response, status, status === 404 ? 'resource_not_found' : 'request_rejected', exception.message, {});
      return;
    }
    this.write(response, 500, 'internal_error', 'Unexpected server error', {});
  }

  private write(response: Response, status: number, code: string, message: string, details: Record<string, unknown>): void {
    response.status(status).json({ error: { code, message, details } });
  }
}
```

HttpException.message may be an object for validation — `exception.message` typed as any → fine (string expected). `exception.message` — does Nest's HttpException.message get a typed `any` via getMessage()? Actually HttpException has a `.message` property? `exception.message` exists (Error.message is string, but Nest sets it to a string or object). Let me use `exception.getMessage()` (typed any). Cast: `String(exception.getMessage())`. Keep it simple.

main.ts:

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AllExceptionsFilter } from './common/exception-filter.js';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new AllExceptionsFilter());
  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port);
}

void bootstrap();
```

app.module.ts:

```ts
import { Module } from '@nestjs/common';
import { PayoutModule } from './payout/payout.module.js';

@Module({
  imports: [PayoutModule],
})
export class AppModule {}
```

prisma.module.ts:

```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

Hmm — @Global vs explicit import in the payout module. The wiring rule: "A provider used by another module is exported by its own module and imported by the other." So PayoutModule should `imports: [PrismaModule]` — no @Global. Let me not make it @Global and have PayoutModule import it explicitly. ✓

prisma.service.ts:

```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

payout.module.ts:

```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module.js';
import { BankGateway } from './bank-gateway.js';
import { PayoutConfig } from './payout-config.js';
import { PayoutController } from './payout.controller.js';
import { PayoutProcessor } from './payout.processor.js';
import { PayoutRepository, PAYOUT_ORDER_STORE } from './payout.repository.js';
import { PayoutService } from './payout.service.js';

@Module({
  imports: [PrismaModule, ScheduleModule.forRoot()],
  controllers: [PayoutController],
  providers: [
    PayoutService,
    PayoutRepository,
    BankGateway,
    PayoutConfig,
    PayoutProcessor,
    { provide: PAYOUT_ORDER_STORE, useClass: PayoutRepository },
  ],
  exports: [PayoutService],
})
export class PayoutModule {}
```

The service:

```ts
@Injectable()
export class PayoutService {
  constructor(
    @Inject(PAYOUT_ORDER_STORE)
    private readonly orders: PayoutOrderStore,
    private readonly bank: BankGateway,
    private readonly config: PayoutConfig,
  ) {}
  ...
}
```

Imports: `Inject` from @nestjs/common.

Now — full service file:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { BankGateway } from './bank-gateway.js';
import { dateKey, eachDay } from './dates.util.js';
import { PayoutConfig } from './payout-config.js';
import {
  BankSendInput,
  BankSendResult,
  DateWindow,
  ExecuteSummary,
  PaymentOrderRecord,
  ReconcileSummary,
  Settlement,
} from './payout.types.js';
import { PAYOUT_ORDER_STORE, PayoutOrderStore } from './payout.repository.js';
import { deriveTxid } from './txid.util.js';

@Injectable()
export class PayoutService {
  constructor(
    @Inject(PAYOUT_ORDER_STORE)
    private readonly orders: PayoutOrderStore,
    private readonly bank: BankGateway,
    private readonly config: PayoutConfig,
  ) {}

  /**
   * Sends every pending order to the bank exactly once, classifying each response.
   *
   * This method is never a resend path: it only sends orders that are already
   * PENDING, and the only code that moves an order back to PENDING after a send
   * is reconcile() proving the order absent from the statement.
   */
  async executePayments(now: Date = new Date()): Promise<ExecuteSummary> {
    const summary: ExecuteSummary = { accepted: 0, duplicate: 0, transient: 0, permanent: 0 };
    const pending = await this.orders.findPending();
    for (const order of pending) {
      const result = await this.sendClassified(order);
      await this.applySendOutcome(order, result, now);
      summary[result.outcome] += 1;
    }
    return summary;
  }

  /**
   * The only path to a resend: match the statement to the orders and advance state.
   *
   * Safe to run repeatedly over overlapping windows — orders already settled are
   * not even loaded, and every transition is a guarded, one-way update.
   */
  async reconcile(window: DateWindow, now: Date = new Date()): Promise<ReconcileSummary> {
    const { from, to } = window;
    if (from.getTime() > to.getTime()) {
      throw new ApiError('invalid_window', 'window "from" must not be after "to"', 400);
    }
    const summary: ReconcileSummary = { settled: 0, rescheduled: 0, parked: 0 };
    const statement = await this.loadStatement(from, to);
    const candidates = await this.orders.findReconcilable(from, to);
    const lagMs = this.config.lagMs;

    for (const order of candidates) {
      const txid = deriveTxid(order.id, order.effectiveDate);

      if (statement.has(txid)) {
        // Evidence of execution. Settle. The guarded update makes a second run a no-op.
        const settled = await this.orders.markSettled(order.id, txid, now);
        if (settled) summary.settled += 1;
        continue;
      }

      // Not on the statement:
      if (order.state === 'PENDING') continue;        // still in the send queue (or never sent); no evidence either way
      if (order.state === 'IN_FLIGHT') continue;      // the bank accepted it. A late row is lag, not absence

      // OUTCOME_UNKNOWN: the last send's outcome is unknown.
      if (order.lastAttemptAt === null) continue;
      if (now.getTime() - order.lastAttemptAt.getTime() < lagMs) continue; // the lag has not passed: no evidence yet

      // Proven absent past the publishing lag — absence is proof the send did not land.
      if (order.attemptCount >= this.config.maxAttempts) {
        const parked = await this.orders.markNeedsReview(order.id, 'send_attempts_exhausted', now);
        if (parked) summary.parked += 1; // terminal: a human reviews. Never auto-revert.
      } else {
        const released = await this.orders.markPendingForResend(order.id);
        if (released) summary.rescheduled += 1; // back to PENDING; the next executePayments() re-sends the same txid
      }
    }
    return summary;
  }

  private async sendClassified(order: PaymentOrderRecord): Promise<BankSendResult> {
    const input: BankSendInput = {
      txid: deriveTxid(order.id, order.effectiveDate),
      amount: order.amountCents,
      key: order.supplierKey,
    };
    try {
      return await this.bank.send(input);
    } catch (err) {
      // A transport failure means the bank never answered: the outcome is unknown.
      // Record it as transient and let reconciliation look for evidence.
      return { outcome: 'transient', detail: err instanceof Error ? err.message : String(err) };
    }
  }

  private async applySendOutcome(order: PaymentOrderRecord, result: BankSendResult, now: Date): Promise<void> {
    switch (result.outcome) {
      case 'accepted':
        // In flight. The statement is the only confirmation.
        await this.orders.markInFlight(order.id, now, 'accepted');
        break;
      case 'duplicate':
        // The bank already has this txid: success, not an error. The instruction is (or was) in flight.
        await this.orders.markInFlight(order.id, now, 'duplicate');
        break;
      case 'transient':
        // Unknown outcome. Record and wait. Never resend from the send path.
        await this.orders.markOutcomeUnknown(order.id, now);
        break;
      case 'permanent':
        // The bank definitively refused. Terminal: a human decides what (if anything) to do.
        await this.orders.markRejected(order.id, now, result.reason);
        break;
    }
  }

  private async loadStatement(from: Date, to: Date): Promise<Map<string, Settlement>> {
    const seen = new Map<string, Settlement>();
    for (const day of eachDay(from, to)) {
      for (const entry of await this.bank.getStatement(dateKey(day))) {
        seen.set(entry.txid, entry);
      }
    }
    return seen;
  }
}
```

Check: `summary[result.outcome] += 1` — TS: result.outcome is a union. ExecuteSummary has those 4 keys ✓.

Now — `@Inject(PAYOUT_ORDER_STORE)` + parameter properties: `@Inject(TOKEN) private readonly orders: PayoutOrderStore` — parameter properties + decorator OK ✓.

One concern: `emitDecoratorMetadata` + @Inject — fine.

In tests we `new PayoutService(store, bank, CONFIG)` — the decorator is irrelevant at runtime for direct construction ✓.

Now, the Prisma `updateMany` for markPendingForResend — data: `{ state: PaymentOrderState.PENDING }`. Should it also clear something? The lastResult stays 'transient' — fine (history). attemptCount unchanged ✓.

markNeedsReview — data: `{ state: NEEDS_REVIEW, parkedReason: reason }` ✓.

markSettled — data: `{ state: SETTLED, settleTxid: txid, settledAt: at }` ✓.

Also, `findPending` — should it be ordered? Deterministic order is nice: orderBy createdAt asc, then id. `orderBy: { createdAt: 'asc' }` — ties possible. Add a secondary `{ id: 'asc' }`? Prisma supports an array of orderBy ✓.

Now — "Money is minor units, integers only" ✓ Int column, integer TS `number` (safe integer), the bank interface's `amount: number`.

Wait — one more double-check: `amountCents: Int` max ~2.1B cents = €21.5M per order. Add a comment in the schema: `// minor units (cents); integer`. Fine.

Now — package.json deps versions. Use reasonable carets:

```json
"dependencies": {
  "@nestjs/common": "^10.4.0",
  "@nestjs/core": "^10.4.0",
  "@nestjs/platform-express": "^10.4.0",
  "@nestjs/schedule": "^4.1.0",
  "@prisma/client": "^5.20.0",
  "reflect-metadata": "^0.2.2",
  "rxjs": "^7.8.1",
  "tslib": "^2.7.0"
},
"devDependencies": {
  "@types/express": "^4.17.21",
  "@types/node": "^20.14.0",
  "prisma": "^5.20.0",
  "typescript": "^5.5.4",
  "vitest": "^2.1.0"
}
```

scripts:

```json
"scripts": {
  "build": "tsc -p tsconfig.json",
  "start": "node dist/src/main.js",
  "test": "vitest run",
  "migrate": "prisma migrate dev",
  "generate": "prisma generate"
}
```

Wait — outDir dist, rootDir? src + test are both compiled → dist/src/..., dist/test/.... `node dist/src/main.js` ✓. Tests are compiled too (harmless).

Hmm — do I even need the build script? Keep it, it's small.

vitest default include: `['**/*.{test,spec}.?(c|m)[jt]s?(x)']` relative to root — test/payout.service.spec.ts ✓ no config needed. But the default exclude includes node_modules ✓. OK, no vitest.config.ts.

Now — will Vitest pick up `.spec.ts` under `test/`? Yes.

Now — a subtle point: tsconfig's "include": ["src", "test"] + NodeNext — the spec file imports `../src/payout/payout.service.js` → resolves to .ts ✓ (tsc). And `import { describe } from 'vitest'` — needs vitest's types ✓ devDep.

Now — one concern: `PayoutService` constructor parameter order in tests vs @Inject — fine.

One more — `FakeBank.getStatement` is called for each day in the window. WINDOW spans 03-09..03-10 (2 days). The fake returns [] for 03-09 ✓.

Let me re-verify test 1 (timeout-but-settled): executePayments(T0) → PENDING→transient→OUTCOME_UNKNOWN lastAttemptAt=T0 attempts 1 ✓. Statement '2025-03-10' has the txid. reconcile(WINDOW, T0+31min): candidates: order (OUTCOME_UNKNOWN) effective 03-10 in [03-09, 03-10] ✓. statement.has(txid) ✓ → markSettled → SETTLED ✓ summary.settled=1 ✓. Then executePayments(T0+32min): findPending → none ✓ bank.sent unchanged (1) ✓.

Test 2: as traced ✓. Note: after the release, the order is PENDING. executePayments(afterLag+1min) sends with derived txid = same as the first ✓ (deterministic). amount 1840_000 ✓ key 'key_123' ✓ → accepted → IN_FLIGHT attempts 2 ✓.

Test 5 idempotency: 'a' OUTCOME_UNKNOWN settled, 'b' OUTCOME_UNKNOWN→PENDING, 'c' IN_FLIGHT stays. Snapshot after run 1. Run 2 (now+1min): 'a' SETTLED excluded, 'b' PENDING in candidates (state PENDING) — statement: only 'a''s txid. 'b' absent → PENDING → continue ✓. 'c' IN_FLIGHT absent → continue ✓. summary zeros ✓ snapshot equal ✓. Run 3 wider window: same ✓ (statement for 03-08/03-11 empty).

Hmm wait — one wrinkle: in run 2, 'b' is PENDING and its txid is not on the statement → `continue` — but should a PENDING order that's proven absent be rescheduled again? No — it's already PENDING (executePayments will send it). "Rescheduling" a PENDING order = no-op. ✓ And crucially, my loop only reschedules from OUTCOME_UNKNOWN. ✓

Test 6 (exhaustion): traced ✓. Note: in the loop, each executePayments(clock) — the order must be PENDING at that moment: iter 1 initial PENDING ✓. After each reconcile (except the last), it's released to PENDING ✓. After the 5th reconcile, NEEDS_REVIEW. bank.sent length 5, all txid = deriveTxid('order-5', EFFECTIVE) ✓. Terminal check: later reconcile + executePayments → no changes ✓ snapshot equal ✓.

Wait — snapshot equality: the Row has settledAt, etc. — all unchanged ✓. `store.snapshot()` returns a copy. toEqual is deep ✓. But Dates — toEqual compares Dates by value ✓.

Test 7: 4 orders seeded. findPending order: Map insertion order: o-acc, o-dup, o-trans, o-perm ✓ scripted outcome order matches ✓.

Test 8 (throw): override bank.send — `bank.send = async (input) => {...}` — wait, FakeBank.send is a method. Reassigning an instance property shadows it ✓ TS allows (same signature).

Hmm — the throw test: after the throw, safeSend returns transient → OUTCOME_UNKNOWN attempts 1 ✓. And then — assert it's not "treated as a failure and immediately resent": run executePayments again → findPending → none (it's OUTCOME_UNKNOWN) → bank.sent.length stays 1 ✓ add that assertion.

Now the controller — `@Post('execute')` returns the service's Promise<ExecuteSummary> → JSON {accepted:..} ✓. `@Post('reconcile')` with body.

Also — should the controller handle the window as query params? Body is fine.

Re-check "endpoint: kebab-case, plural": `/payout-orders/execute` — base is plural kebab ✓ sub-action is singular verb… the convention is endpoints plural kebab — `/payout-orders` is plural. Sub-resource actions are standard REST verbs. Fine.

Now the migration file name: `prisma/migrations/20250310000000_init/migration.sql`. Fine.

Also — `prisma/schema.prisma` — the Prisma enum name PaymentOrderState → SQL type "PaymentOrderState" ✓ matches the migration.

Let me re-check the migration SQL details against Prisma's conventions:
- id TEXT (cuid → TEXT) ✓
- supplier_key TEXT ✓
- amount_cents INTEGER ✓
- effective_date DATE ✓
- state "PaymentOrderState" NOT NULL DEFAULT 'PENDING' ✓
- attempt_count INTEGER NOT NULL DEFAULT 0 ✓
- last_attempt_at TIMESTAMP(3) ✓
- last_result TEXT ✓
- reject_reason TEXT ✓
- settle_txid TEXT ✓
- settled_at TIMESTAMP(3) ✓
- parked_reason TEXT ✓
- created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP ✓
- updated_at TIMESTAMP(3) NOT NULL ✓
- PK, index ✓

Good.

Now — "Do not create a file it doesn't ask for" — my file list: schema, migration, main, app.module, prisma module/service, common (2), payout (9: types, util ×2, config, bank-gateway, repository, service, controller, processor, module) — wait, let me count: payout.types.ts, dates.util.ts, txid.util.ts, payout-config.ts, bank-gateway.ts, payout.repository.ts, payout.service.ts, payout.controller.ts, payout.processor.ts, payout.module.ts = 10. test (2), package.json, tsconfig.json. Total 18 files. Reasonable as "the whole solution."

Let me re-verify the discipline: "controller validates input and calls the service. No business logic." — my controller: parseWindow is input validation ✓ calls the service ✓.

"Service holds logic. No raw SQL, no Prisma client calls." ✓ (only store port).

"Repository is the only layer that touches the DB." ✓ (PrismaService is the client wrapper provided by PrismaModule — the repository is the only consumer).

Error envelope ✓.

Wiring ✓ (providers listed. PrismaService exported from PrismaModule and imported by PayoutModule. PayoutService exported).

Migration ✓.

Tests: behavior, assertions, not just happy path ✓.

Env config ✓ (DATABASE_URL in the schema via env(). Lag/attempts/port from env with fallbacks — "configuration comes from environment variables only" — hmm, fallbacks: is that a violation? The env variable is the source. The fallback is a default for when unset. I think it's OK — the alternative (crash on unset) is worse. The strict reading is about not hardcoding secrets/connections. Fine.)

Now, let me reconsider the `PAYOUT_ORDER_STORE` token vs the wiring convention "a service, repository, or processor is listed in its module's providers" — PayoutRepository is in providers ✓ and the token mapping ✓.

Edge — Nest DI for PayoutService: constructor @Inject(PAYOUT_ORDER_STORE) → provider {provide: PAYOUT_ORDER_STORE, useClass: PayoutRepository} ✓. BankGateway → provider BankGateway ✓. PayoutConfig → provider ✓.

Now, let me write the FakeBank and FakeStore in the test file — complete and type-safe.

One more check on the `PayoutOrderStore` import in the service: `import { PAYOUT_ORDER_STORE, PayoutOrderStore } from './payout.repository.js';` — PayoutOrderStore is a type. In NodeNext without verbatimModuleSyntax, a normal import is OK (elided) ✓.

In the test: `import { PayoutOrderStore } from '../src/payout/payout.repository.js';` — importing from the repository file pulls in the prisma imports?? The repository file imports `PrismaService` from '../prisma/prisma.service.js', which imports PrismaClient from '@prisma/client' — at test runtime (Vitest), importing the repository module executes `import { PrismaClient } from '@prisma/client'` → requires the generated client to exist!! If the evaluation env hasn't run `prisma generate`, the test fails to import!!

Danger. Mitigation options:
a) Define PayoutOrderStore + token in a separate file that doesn't import prisma: e.g., `payout.types.ts` (domain types, no prisma). The repository implements it and imports from types. The service imports from types. The test imports the interface from types → no prisma chain. ✓✓

Move `PayoutOrderStore` and `PAYOUT_ORDER_STORE` to `payout.types.ts`. Then the test's import: payout.service.js → imports bank-gateway.js (no prisma), payout-config.js (no prisma), api-error.js (no prisma), dates/txid utils (no prisma), payout.types.js (no prisma) ✓. The test imports only PayoutService + types + txid util → no prisma at runtime. The FakeStore `implements PayoutOrderStore` imported from types ✓.

But wait — the service file itself: does it import payout.repository.js? No — after moving the interface to types, the service only imports the token + interface from types ✓.

Also verify: the `@prisma/client` import in prisma.service.ts — only loaded via the module chain (app.module → payout.module → repository → prisma.service) — never in tests ✓.

b) Alternative: `vi.mock('@prisma/client')` — no, (a) is cleaner.

Now — the txid spec imports only txid.util ✓ (dates.util, node:crypto ✓).

Now, `PayoutConfig` — the service imports it for the type. The class is @Injectable, no deps ✓ no prisma.

`BankGateway` — @Injectable, imports types only ✓.

api-error — no deps ✓.

Great, the test's import graph is prisma-free.

Now let me write FakeStore `implements PayoutOrderStore` — the methods return Promises. Implement with async methods ✓.

One more design point — `markPendingForResend(id)` has no `at` param. The repository's updateMany only sets state. updatedAt is automatic ✓. The fake is the same.

Let me also re-verify the service's `reconcile` guard: `if (order.state === 'PENDING') continue;` — before or after the statement check? After (a PENDING with a statement entry = the late landing of the previous unknown send → settle ✓ — wait, can a PENDING order's txid legitimately appear on the statement? Only if a previous send with that txid landed: the order was OUTCOME_UNKNOWN (that txid was sent, timed out), then released to PENDING, and then the statement row appears (late). Settling is the right answer ✓. A fresh PENDING (never sent): impossible for the txid to appear ✓.)

Good.

Now — the idempotency test includes 'b' PENDING after run 1. Run 2: 'b' is PENDING, txid not on statement → continue ✓ no double-release (no-op anyway).

Hmm — but there's a subtle behavior: in run 2, 'b' is PENDING and the statement is empty and… the order's lastAttemptAt is T0 (old). Should reconcile "reschedule" a PENDING order? It can't — it's already PENDING. The send path will handle it. But wait — what if executePayments is never called? 'b' stays PENDING forever. Is that a problem? The operator runs executePayments (or upstream). By design, fine.

Now, one more scenario from the spec: "reconcile run twice over the same window → identical state after both" ✓ tested.

"Each of the four send outcomes takes a distinct path" ✓ tested (lastResult + state differ).

I think the design is solid. Let me also consider whether `reconcile` should verify `settlement.amount === order.amountCents` on match. The Settlement has amount. A mismatch = a bank data anomaly. Spec: "match statement entries to orders by txid and advance state." — matching by txid. Let me add a mismatch check that refuses to settle and parks? No — scope. Silently? Also no. Just a comment noting that txid is the join key (the bank's statement amount is out of scope for matching). Actually — hmm, let me reconsider once more. If I include `amount` in the Settlement type, a reviewer might expect it to be used. If I don't include amount in Settlement, no issue at all: Settlement = { txid, key }. "Each has the txid we sent" — minimally: txid. key is natural (the beneficiary key). Let me keep { txid, key } and drop amount from Settlement. Then no unused-field smell. But the statement amount would be useful for verification… The spec says the statement entries have the txid — assume only what we're told + key. Final: `Settlement { txid: string; key: string }`.

Hmm wait, then in the test the statement entries: `{ txid, key: 'key_123' }` ✓ simpler.

Now let me write the fake's snapshot: a Map of Rows → Record. `toEqual` on an object with Date values — vitest's toEqual handles Dates ✓.

Potential TS strictness issues to check:
- `bank.scripted.shift()` returns BankSendResult | undefined → guarded ✓.
- `this.rows.get(id)!` — I use `!` in get(). Fine in strict. Or guard. Let me do `const row = this.rows.get(id); if (!row) throw ...`. Keep `!` in get() — strict allows non-null assertions ✓.
- `for (const s of bank.sent) expect(s.txid).toBe(txid);` ✓.

Controller: `@Body() body: unknown` ✓.

Now — `parseDateKey` in dates.util: `new Date(\`${key}T00:00:00.000Z\`)` — for a malformed input like '2025-13-40' (if the regex passes? '2025-13-40' matches \d{2} pattern) → Date is NaN → the controller's round-trip dateKey(NaN) → 'NaT...' hmm toISOString on an invalid date throws. Controller: after parse, `dateKey(parsed) !== value` — if parsed is invalid, toISOString throws a RangeError → caught by the filter → 500 instead of 400. Better: check `Number.isNaN(parsed.getTime())` in the controller first → throw ApiError invalid_window. Let me add that.

```ts
const parsed = parseDateKey(value);
if (Number.isNaN(parsed.getTime()) || dateKey(parsed) !== value) {
  throw new ApiError('invalid_window', `"${field}" must be a valid YYYY-MM-DD calendar date`, 400, { field, value });
}
```

✓.

The span check: days = Math.round((to-from)/86400000); if days > 31 → invalid. Also days < 0 is covered by from>to. ✓

Now — the `PayoutProcessor` imports: Cron from @nestjs/schedule, Logger, dates util, service ✓.

`@Cron('*/15 * * * *')` ✓ every 15 minutes.

Also — the ScheduleModule.forRoot() option timezone: `ScheduleModule.forRoot({ timezone: 'UTC' })`? @nestjs/schedule v4 supports the `timezone` option ✓. Include it (deterministic).

Now — main.ts port parsing: `Number.parseInt(process.env.PORT ?? '3000', 10)` — NaN guard? Trivial: `const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3000;` and `Number.isNaN(port) || port <= 0 ? 3000 : port`. Keep it small.

Also — one thing I want to double-check: **ESM + Prisma**: `new PrismaClient()` in ESM works fine with prisma 5 ✓.

**tslib import**: with NodeNext + ESM + emitDecoratorMetadata, TS emits `import { __decorate, __metadata, __param } from "tslib"` — tslib must be resolvable ✓ in deps.

Wait — does TS auto-import tslib? With `importHelpers: false` (default), TS inlines the helpers (no tslib import needed!). Right — without importHelpers, the helpers are inlined. So tslib is strictly unnecessary. But harmless to have it. Let me drop tslib from deps to reduce surface? Without importHelpers, inlined. Keep deps minimal: drop tslib. Hmm — some tooling (esbuild/vitest) also inlines. Drop it.

Now — `reflect-metadata` import in main.ts: needed for DI metadata at runtime in ESM ✓.

Let me reconsider `@Post('execute')` returning `Promise<ExecuteSummary>` — Nest serializes ✓.

`reconcile` endpoint: `@Post('reconcile') reconcile(@Body() body: unknown) { return this.service.reconcile(parseWindow(body)); }` — returns Promise<ReconcileSummary> ✓.

Now — the controller imports the ApiError from common ✓. dateKey, parseDateKey from dates.util ✓. DateWindow from types ✓.

Let me also think about the `GET` endpoint for status… not requested. Skip.

Let me review the spec deliverables once more:
- "Prisma schema" ✓ schema.prisma (+ migration)
- "Service with executePayments() and reconcile(window)" ✓
- "Scheduled reconcile job" ✓ processor
- "Tests for timeout-but-settled, proven-absent, attempt exhaustion" ✓ (+ idempotency, four outcomes, lag, in_flight guard, throw).

"Cap attempts at 5" ✓ config default 5. "Park for manual review and never auto-revert" ✓ NEEDS_REVIEW terminal.

"Txid is derived deterministically from order + effective date" ✓ deriveTxid(order.id, effectiveDate). "Stable order attributes" — order id is the stable attribute (+ effective date). ✓

"Money is minor units, integers only" ✓.

Now — the ASSUMPTION comments. Where are the genuinely unresolved points?
1. Bank transport/vendor client is unspecified → the BankGateway stub. `// ASSUMPTION:` comment there.
2. Handling of permanent rejection = terminal human review (not auto-retry) — the spec is ambiguous ("each gets its own handling"). Mark with an ASSUMPTION comment at applySendOutcome's permanent case.
3. Settlement shape {txid, key} — "assume nothing about the bank API beyond … getStatement(date) -> Settlement[]" — we assumed txid + key. Mark? The task says entries "have the txid we sent" — txid is guaranteed. key is an assumption. Mark with one comment.
4. Statement date = order's effective date (settlements appear on the effective date's statement) — an assumption in reconcile (window ↔ effectiveDate). Mark a comment.

Max 4 assumption comments, each one line, placed where they matter.

Also — "the bank's own statement showed it the whole time" — nothing else.

Now, one more thought on `executePayments` — should it return 202/200? Default 201 for POST. Fine (no custom status needed).

Also — hmm, `@Post('execute')` — a POST with no body. The controller method with no params ✓.

Let me also double-check the FakeBank's `statementCalls` — do I assert on it? Not necessary. Drop it to reduce surface? Keep it (useful, small). Actually — let me use it: in the idempotency test, assert that a wider window fetches more days? Not needed. Keep the property but unused… "don't create what you don't need" — let me drop statementCalls. Keep the fake minimal: scripted, sent, statements.

Now — one more edge for the service: `executePayments` — if `bank.send` throws for order X and the fake has no more scripted outcomes… covered.

Also — in executePayments, if markX returns false (state changed concurrently)? Ignored. Fine (a comment in the repository: guarded transition; false = a concurrent change, safe to ignore due to the one-way state machine).

Let me also settle the naming of the service's method params: `reconcile(window: DateWindow, now: Date = new Date())` ✓.

Now — let me write the full test file, carefully, complete.

```ts
import { describe, expect, it } from 'vitest';
import { PayoutService } from '../src/payout/payout.service.js';
import { PayoutOrderStore } from '../src/payout/payout.types.js';
import { deriveTxid } from '../src/payout/txid.util.js';
import type { BankSendInput, BankSendResult, OrderState, Settlement } from '../src/payout/payout.types.js';
```

Consolidate the types import into one:
`import { BankSendInput, BankSendResult, OrderState, PayoutOrderStore, Settlement } from '../src/payout/payout.types.js';` — these are all types. In NodeNext, a value import of type-only exports — TS elides it (no verbatimModuleSyntax) ✓. But to be safe/clean, use `import type` for pure types. BankSendResult etc. are types ✓. Let me use `import type`.

Constants:

```ts
const CONFIG = { lagMs: 30 * 60_000, maxAttempts: 5 };
const T0 = new Date('2025-03-10T12:00:00.000Z');
const EFFECTIVE = new Date('2025-03-10T00:00:00.000Z');
const WINDOW = { from: new Date('2025-03-09T00:00:00.000Z'), to: new Date('2025-03-10T00:00:00.000Z') };
const AMOUNT = 1_840_000; // €18,400.00 in cents
const KEY = 'key_123';
```

Row + makeOrder + FakeStore + FakeBank as above.

Tests (list):
1. 'settles a timed-out order that appears on the statement and never re-sends it'
2. 're-sends a proven-absent order past the lag with the same derived txid'
3. 'does not act on an unknown outcome while the publishing lag has not passed'
4. 'never re-sends an accepted in-flight order that is late on the statement'
5. 'settles an in-flight order once its statement entry appears'
6. 'is idempotent across repeated and overlapping reconcile windows'
7. 'parks the order for manual review after five attempts and never auto-reverts it'
8. 'classifies the four send outcomes onto four distinct paths'
9. 'treats a transport throw from bank.send as an unknown outcome, not a trigger to act'

Let me write #3 concretely:

```ts
it('does not act on an unknown outcome while the publishing lag has not passed', async () => {
  const store = new FakeStore();
  const bank = new FakeBank();
  store.seed(makeOrder({ id: 'o-lag', state: 'OUTCOME_UNKNOWN', attemptCount: 1, lastAttemptAt: T0, lastResult: 'transient' }));
  const service = new PayoutService(store, bank, CONFIG);

  const summary = await service.reconcile(WINDOW, new Date(T0.getTime() + CONFIG.lagMs - 1_000));

  expect(summary).toEqual({ settled: 0, rescheduled: 0, parked: 0 });
  expect(store.get('o-lag').state).toBe('OUTCOME_UNKNOWN');
  expect(bank.sent).toHaveLength(0);
});
```

#5:

```ts
it('settles an in-flight order once its statement entry appears', async () => {
  const store = new FakeStore();
  const bank = new FakeBank();
  store.seed(makeOrder({ id: 'o-set', state: 'IN_FLIGHT', attemptCount: 1, lastAttemptAt: T0, lastResult: 'accepted' }));
  bank.statements.set('2025-03-10', [{ txid: deriveTxid('o-set', EFFECTIVE), key: KEY }]);
  const service = new PayoutService(store, bank, CONFIG);

  const summary = await service.reconcile(WINDOW, T0);

  expect(summary).toEqual({ settled: 1, rescheduled: 0, parked: 0 });
  const row = store.get('o-set');
  expect(row.state).toBe('SETTLED');
  expect(row.settleTxid).toBe(deriveTxid('o-set', EFFECTIVE));
  expect(row.settledAt).toBe(T0);
});
```

#9:

```ts
it('treats a transport throw from bank.send as an unknown outcome, not a trigger to act', async () => {
  const store = new FakeStore();
  const bank = new FakeBank();
  bank.send = async (input) => { bank.sent.push(input); throw new Error('ECONNRESET'); };
  store.seed(makeOrder({ id: 'o-err' }));
  const service = new PayoutService(store, bank, CONFIG);

  await service.executePayments(T0);

  const row = store.get('o-err');
  expect(row.state).toBe('OUTCOME_UNKNOWN');
  expect(row.attemptCount).toBe(1);

  // The send path does not act on not knowing: a second run sends nothing.
  await service.executePayments(new Date(T0.getTime() + 60_000));
  expect(bank.sent).toHaveLength(1);
});
```

Wait — `bank.send = async (input) => ...` — a type: FakeBank's send is a method. Reassigning to an async arrow: the instance property's type must match `(input: BankSendInput) => Promise<BankSendResult>` ✓.

Hmm — but the FakeBank class defines `async send(input: BankSendInput)`. Reassignment on an instance: TS checks property assignability ✓.

Now the FakeStore's `get`:

```ts
get(id: string): Row {
  const row = this.rows.get(id);
  if (!row) throw new Error(`FakeStore: unknown order ${id}`);
  return { ...row };
}
```

snapshot:

```ts
snapshot(): Record<string, Row> {
  const out: Record<string, Row> = {};
  for (const [id, row] of this.rows) out[id] = { ...row };
  return out;
}
```

Now — test 6's loop uses `CONFIG.maxAttempts` ✓.

Let me also verify the service compiles: the `summary[result.outcome] += 1` — result: BankSendResult. outcome: 'accepted'|'duplicate'|'transient'|'permanent'. ExecuteSummary has exactly those keys ✓ TS OK.

`summary` is declared as `const summary: ExecuteSummary = {...}` — mutable properties ✓.

Now — the repository's `transition` private method with the Prisma types:

```ts
import { Injectable } from '@nestjs/common';
import { PaymentOrderState, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { PayoutOrderStore, PaymentOrderRecord, PAYOUT_ORDER_STORE } from './payout.types.js';
```

Wait — PAYOUT_ORDER_STORE is now in types ✓ (the repository imports it? The repository doesn't need the token. The module does. The module imports { PayoutRepository } from repository and { PAYOUT_ORDER_STORE } from types.)

Repository:

```ts
@Injectable()
export class PayoutRepository implements PayoutOrderStore {
  constructor(private readonly prisma: PrismaService) {}

  async findPending(): Promise<PaymentOrderRecord[]> {
    const rows = await this.prisma.paymentOrder.findMany({
      where: { state: PaymentOrderState.PENDING },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toRecord);
  }

  async findReconcilable(from: Date, to: Date): Promise<PaymentOrderRecord[]> {
    const rows = await this.prisma.paymentOrder.findMany({
      where: {
        state: {
          in: [
            PaymentOrderState.PENDING,
            PaymentOrderState.IN_FLIGHT,
            PaymentOrderState.OUTCOME_UNKNOWN,
          ],
        },
        effectiveDate: { gte: from, lte: to },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toRecord);
  }

  async markInFlight(id: string, at: Date, lastResult: 'accepted' | 'duplicate'): Promise<boolean> {
    return this.transition(
      { id, state: PaymentOrderState.PENDING },
      { state: PaymentOrderState.IN_FLIGHT, attemptCount: { increment: 1 }, lastAttemptAt: at, lastResult },
    );
  }

  async markOutcomeUnknown(id: string, at: Date): Promise<boolean> {
    return this.transition(
      { id, state: PaymentOrderState.PENDING },
      { state: PaymentOrderState.OUTCOME_UNKNOWN, attemptCount: { increment: 1 }, lastAttemptAt: at, lastResult: 'transient' },
    );
  }

  async markRejected(id: string, at: Date, reason: string): Promise<boolean> {
    return this.transition(
      { id, state: PaymentOrderState.PENDING },
      { state: PaymentOrderState.REJECTED, attemptCount: { increment: 1 }, lastAttemptAt: at, lastResult: 'permanent', rejectReason: reason },
    );
  }

  async markSettled(id: string, txid: string, at: Date): Promise<boolean> {
    return this.transition(
      {
        id,
        state: {
          in: [PaymentOrderState.PENDING, PaymentOrderState.IN_FLIGHT, PaymentOrderState.OUTCOME_UNKNOWN],
        },
      },
      { state: PaymentOrderState.SETTLED, settleTxid: txid, settledAt: at },
    );
  }

  async markPendingForResend(id: string): Promise<boolean> {
    return this.transition({ id, state: PaymentOrderState.OUTCOME_UNKNOWN }, { state: PaymentOrderState.PENDING });
  }

  async markNeedsReview(id: string, reason: string, _at: Date): Promise<boolean> {
    return this.transition(
      { id, state: PaymentOrderState.OUTCOME_UNKNOWN },
      { state: PaymentOrderState.NEEDS_REVIEW, parkedReason: reason },
    );
  }

  /**
   * Every state change is a guarded, one-way transition: the WHERE clause pins the
   * expected prior state, so a duplicate run (or a concurrent one) can apply each
   * transition at most once.
   */
  private async transition(
    where: Prisma.PaymentOrderWhereUniqueInput,
    data: Prisma.PaymentOrderUpdateManyMutationInput,
  ): Promise<boolean> {
    const result = await this.prisma.paymentOrder.updateMany({ where, data });
    return result.count > 0;
  }
}

function toRecord(row: {
  id: string;
  supplierKey: string;
  amountCents: number;
  effectiveDate: Date;
  state: PaymentOrderState;
  attemptCount: number;
  lastAttemptAt: Date | null;
}): PaymentOrderRecord {
  return {
    id: row.id,
    supplierKey: row.supplierKey,
    amountCents: row.amountCents,
    effectiveDate: row.effectiveDate,
    state: row.state,
    attemptCount: row.attemptCount,
    lastAttemptAt: row.lastAttemptAt,
  };
}
```

Hmm — `_at` unused param in markNeedsReview — the interface has `at: Date`. In the impl, name it `_at`? The interface signature is markNeedsReview(id, reason, at). The impl can name it `at` and not use it → TS noUnusedParameters? tsconfig strict doesn't include noUnusedParameters (not part of strict) ✓. Keep the name `at`, unused, fine. Or use it: add `updatedAt`? Can't (Prisma auto). Keep `at` unused — hmm, does an unused constructor param property trigger? Not with strict. Fine. Actually — should markNeedsReview take `at` in the first place? It could set… nothing. Keep the parameter for symmetry (a future `parked_at`)? "Don't invent" — simpler: drop `at` from markNeedsReview: `markNeedsReview(id: string, reason: string): Promise<boolean>`. The service calls `markNeedsReview(order.id, 'send_attempts_exhausted')`. Cleaner ✓. Update the interface, the fake, the repository.

Wait, but the fake's `markNeedsReview(id, reason)` — fine.

Now — `toRecord` — I could also type the parameter as `Pick<...>` or just inline the object type as I did — but Prisma's row type: `Omit<Prisma.PaymentOrderGetPayload<{}>, ...>`? Simplest and most robust: parameter type = the return of `this.prisma.paymentOrder.findFirst`… let me type it as the Prisma model: `import type { PaymentOrder } from '@prisma/client'` and `function toRecord(row: PaymentOrder): PaymentOrderRecord`. The `PaymentOrder` model type is exported by @prisma/client ✓ (model types are exported). `row.state` is PaymentOrderState (a union of literals) → assignable to the domain OrderState ✓.

So the repository imports: `import { Injectable } from '@nestjs/common'; import { PaymentOrder, PaymentOrderState, Prisma } from '@prisma/client';` — PaymentOrder is a type-only use → mixing is fine (elided).

Now — the types file has the PAYOUT_ORDER_STORE token:

```ts
/** DI token for the order store port. */
export const PAYOUT_ORDER_STORE = 'PAYOUT_ORDER_STORE';
```

In types — a value export in a types file… the filename payout.types.ts has a value — slightly impure. Acceptable? Rename to `payout.contract.ts`? Or put the token in payout-config? Hmm. Let me name the file `payout.types.ts` — with one const, fine. Or put the token in the service file (the consumer) — the module + the repository… the repository doesn't need the token. The module does. The service does. Put `PAYOUT_ORDER_STORE` in the service file? The module imports from the service file ✓, and the test's fake doesn't need the token (implements the interface) ✓. Hmm — but the interface is in types. The token is next to the service… Let me just put the token in types.ts — one line, fine. Actually cleanest: the token constant in `payout.repository.ts`?? That imports prisma — the module imports the token from the repository file (the module imports the repository anyway, the app chain is prisma-touched, fine) — but the service must not import the repository (prisma chain in tests!). The service imports the token → if the token is in the repository file, the service imports the repository file → prisma chain in tests ✗. So the token must live in a prisma-free file → types.ts ✓ decided.

Now — `PayoutOrderStore` in types.ts ✓ prisma-free.

Re-check the service's imports (final):
- @nestjs/common: Inject, Injectable
- ../common/api-error.js: ApiError
- ./bank-gateway.js: BankGateway
- ./dates.util.js: dateKey, eachDay
- ./payout-config.js: PayoutConfig
- ./payout.types.js: PAYOUT_ORDER_STORE, PayoutOrderStore, BankSendInput, BankSendResult, DateWindow, ExecuteSummary, PaymentOrderRecord, ReconcileSummary, Settlement
- ./txid.util.js: deriveTxid

✓ no prisma.

Controller imports: @nestjs/common (Body, Controller, Post), ../common/api-error.js, ./dates.util.js (dateKey, parseDateKey), ./payout.service.js, ./payout.types.js (DateWindow) ✓ no prisma.

Now — the module file:

```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module.js';
import { BankGateway } from './bank-gateway.js';
import { PayoutConfig } from './payout-config.js';
import { PayoutController } from './payout.controller.js';
import { PayoutProcessor } from './payout.processor.js';
import { PayoutRepository } from './payout.repository.js';
import { PayoutService } from './payout.service.js';
import { PAYOUT_ORDER_STORE } from './payout.types.js';
```

providers: [PayoutService, PayoutRepository, BankGateway, PayoutConfig, PayoutProcessor, { provide: PAYOUT_ORDER_STORE, useClass: PayoutRepository }] ✓.

Now — let me re-verify @nestjs/schedule v4 + Nest 10 compatibility ✓ (v4.1 supports Nest 10).

Now — a possible runtime gotcha: Nest ESM + `@Injectable()` without args + emitDecoratorMetadata — fine.

Now — `PayoutProcessor` is a provider with @Cron — ScheduleModule.forRoot() is present ✓.

The processor file:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { dateKey, startOfUtcDay } from './dates.util.js';
import { PayoutService } from './payout.service.js';
import type { DateWindow } from './payout.types.js';

const DAY_MS = 86_400_000;

/**
 * The scheduled reconcile job.
 *
 * Runs every 15 minutes over yesterday + today — a window that overlaps with the
 * previous run by design; reconcile() is idempotent, so the overlap settles nothing
 * twice.
 */
@Injectable()
export class PayoutProcessor {
  private readonly logger = new Logger(PayoutProcessor.name);

  constructor(private readonly service: PayoutService) {}

  @Cron('*/15 * * * *')
  async runScheduledReconcile(): Promise<void> {
    const now = new Date();
    const window: DateWindow = {
      from: startOfUtcDay(new Date(now.getTime() - DAY_MS)),
      to: startOfUtcDay(now),
    };
    try {
      const summary = await this.service.reconcile(window, now);
      this.logger.log(
        `reconciled ${dateKey(window.from)}..${dateKey(window.to)}: ` +
          `settled=${summary.settled} rescheduled=${summary.rescheduled} parked=${summary.parked}`,
      );
    } catch (err) {
      // The next run re-covers the same window; log loudly, don't crash the process.
      this.logger.error(`scheduled reconcile failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
```

Now — `DateWindow` import type ✓.

bank-gateway.ts:

```ts
import { Injectable } from '@nestjs/common';
import type { BankSendInput, BankSendResult, Settlement } from './payout.types.js';

/**
 * Port to the bank's instant-payment API.
 *
 * // ASSUMPTION: the task defines no transport for the bank (endpoints, auth,
 * vendor SDK), so this default adapter is a stub. A deployment must override the
 * provider (e.g. `{ provide: BankGateway, useValue: vendorClient }`) with a client
 * whose `send` maps the raw response onto the four classified outcomes and whose
 * `getStatement(dateKey)` returns that day's published settlements.
 */
@Injectable()
export class BankGateway {
  async send(_input: BankSendInput): Promise<BankSendResult> {
    throw new Error('BankGateway is not wired: provide the vendor bank client for this environment');
  }

  async getStatement(_date: string): Promise<Settlement[]> {
    throw new Error('BankGateway is not wired: provide the vendor bank client for this environment');
  }
}
```

The types file:

```ts
/**
 * Domain types shared by the payout feature. Deliberately free of Prisma/Nest
 * imports so tests can use them without a generated client.
 */

/** State of a payment order. Values mirror the PaymentOrderState enum in the Prisma schema. */
export type OrderState =
  | 'PENDING'          // eligible to be sent (initial, or released by reconcile)
  | 'IN_FLIGHT'        // the bank accepted (or confirmed duplicate); awaiting the statement
  | 'OUTCOME_UNKNOWN'  // last send timed out / transient failure; outcome unknown
  | 'SETTLED'          // matched on the bank's statement (terminal)
  | 'REJECTED'         // the bank permanently rejected it (terminal, human review)
  | 'NEEDS_REVIEW';    // attempts exhausted (terminal, human review)

/** The view of a payment order the service works with. */
export interface PaymentOrderRecord {
  id: string;
  supplierKey: string;
  /** Money in minor units (cents). Integer only. */
  amountCents: number;
  /** UTC date the payment applies to. With the id, it determines the txid. */
  effectiveDate: Date;
  state: OrderState;
  /** Number of bank.send calls made for this order. */
  attemptCount: number;
  lastAttemptAt: Date | null;
}

/** The only state changes the service is allowed to request; each is guarded to run at most once. */
export interface PayoutOrderStore {
  findPending(): Promise<PaymentOrderRecord[]>;
  findReconcilable(from: Date, to: Date): Promise<PaymentOrderRecord[]>;
  markInFlight(id: string, at: Date, lastResult: 'accepted' | 'duplicate'): Promise<boolean>;
  markOutcomeUnknown(id: string, at: Date): Promise<boolean>;
  markRejected(id: string, at: Date, reason: string): Promise<boolean>;
  markSettled(id: string, txid: string, at: Date): Promise<boolean>;
  markPendingForResend(id: string): Promise<boolean>;
  markNeedsReview(id: string, reason: string): Promise<boolean>;
}

/** DI token for the order store port. */
export const PAYOUT_ORDER_STORE = 'PAYOUT_ORDER_STORE';

/** Input to bank.send. Amount is in minor units, integer. */
export interface BankSendInput {
  txid: string;
  amount: number;
  key: string;
}

/** The four classified outcomes of bank.send — not two. */
export type BankSendResult =
  | { outcome: 'accepted' }
  | { outcome: 'duplicate' }
  | { outcome: 'transient'; detail: string }
  | { outcome: 'permanent'; reason: string };

// ASSUMPTION: the task only guarantees that a settlement carries the txid we sent;
// the beneficiary key is included because bank.send takes it and it aids manual review.
export interface Settlement {
  txid: string;
  key: string;
}

/** Inclusive range of statement dates (UTC midnight), e.g. for getStatement(). */
export interface DateWindow {
  from: Date;
  to: Date;
}

export interface ExecuteSummary {
  accepted: number;
  duplicate: number;
  transient: number;
  permanent: number;
}

export interface ReconcileSummary {
  settled: number;
  rescheduled: number;
  parked: number;
}
```

Wait — the comment "not two" is cute but OK. Keep it professional: "The four classified outcomes of bank.send."

payout-config.ts:

```ts
import { Injectable } from '@nestjs/common';

// The bank publishes the statement with up to ~30 min lag; absence is only
// evidence past that.
const DEFAULT_PUBLISHING_LAG_MINUTES = 30;
const DEFAULT_MAX_SEND_ATTEMPTS = 5;

/**
 * Configuration from environment variables only:
 *   PAYOUT_PUBLISHING_LAG_MINUTES, PAYOUT_MAX_SEND_ATTEMPTS
 */
@Injectable()
export class PayoutConfig {
  get lagMs(): number {
    return readPositiveInt(process.env.PAYOUT_PUBLISHING_LAG_MINUTES, DEFAULT_PUBLISHING_LAG_MINUTES) * 60_000;
  }

  get maxAttempts(): number {
    return readPositiveInt(process.env.PAYOUT_MAX_SEND_ATTEMPTS, DEFAULT_MAX_SEND_ATTEMPTS);
  }
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
```

dates.util.ts and txid.util.ts as above.

Now — a potential subtle issue: `deriveTxid` uses `dateKey(effectiveDate)`, which uses toISOString — a Date at any instant on that UTC day → the same key ✓ (test: 05:00Z same day ✓).

Now — the migration directory: `prisma/migrations/20250310000000_init/migration.sql`.

Let me re-verify the SQL for the index name matches the schema's `map:`: I set `@@index([effectiveDate, state], map: "payment_orders_effective_date_state_idx")` → the SQL index name is the same ✓.

Now — package.json final:

```json
{
  "name": "supplier-payouts",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/src/main.js",
    "test": "vitest run",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.4",
    "@nestjs/core": "^10.4.4",
    "@nestjs/platform-express": "^10.4.4",
    "@nestjs/schedule": "^4.1.1",
    "@prisma/client": "^5.20.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.16.5",
    "prisma": "^5.20.0",
    "typescript": "^5.5.4",
    "vitest": "^2.1.1"
  }
}
```

tsconfig.json:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "strict": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "noEmitOnError": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

Now — a potential issue: `emitDecoratorMetadata` requires `experimentalDecorators` ✓ set.

Now, let me re-scan the "no raw SQL / no Prisma in the service" rule — ✓.

"Zero business logic in the controller" — the window parsing is validation ✓ (boundary check on input shape). OK.

Now, one more thought on `executePayments` — does the task name it exactly `executePayments()` ✓ and `reconcile(window)` ✓.

Let me reconsider: the tests for "attempt exhaustion" — I do the full 5-cycle loop. Each cycle: executePayments + reconcile. In the loop, at iter n (n<5), after reconcile, state PENDING, rescheduled=1 ✓. At iter 5: parked=1. Let me re-verify the summary at iter 5: the order is OUTCOME_UNKNOWN attempts=5 (just sent), past lag (clock advanced by 31min after send), absent → attempts >= 5 → markNeedsReview ✓ summary.parked=1, rescheduled=0 ✓.

Wait — in my loop code, I asserted `lastSummary.rescheduled).toBe(1)` only when attempt < MAX ✓. And after the loop: `expect(lastSummary.parked).toBe(1)` ✓.

Also in the loop, `expect(store.get('order-5').attemptCount).toBe(attempt)` after each cycle ✓ (incremented once per executePayments).

Now — one more check: at iter 1, before executePayments, the order is PENDING (seeded) ✓. executePayments(clock=T0): findPending finds it ✓ sends (scripted transient #1) → OUTCOME_UNKNOWN lastAttemptAt=T0 attempts 1 ✓. clock = T0+31min. reconcile: past lag (31 > 30) ✓ absent → attempts 1 < 5 → PENDING ✓.

Iter 2: executePayments(clock=T0+31min) → PENDING → send → OUTCOME_UNKNOWN lastAttemptAt=T0+31min attempts 2. clock=T0+62min. reconcile: past lag ✓ → PENDING. … iter 5 similar: after send attempts 5 lastAttemptAt=T0+93min. clock=T0+124min. reconcile: attempts 5 >= 5 → NEEDS_REVIEW ✓.

Then the terminal block: clock += 31min. reconcile(WINDOW, clock): the order is NEEDS_REVIEW → not in candidates (state filter) → summary all zeros ✓. executePayments(clock): findPending → none (NEEDS_REVIEW) → no send ✓. Snapshot equality ✓. bank.sent length 5 ✓ all txid identical ✓.

Also — parkedReason assertion: 'send_attempts_exhausted' ✓.

Now — the idempotency test — one detail: `store.snapshot()` after run 1 includes 'b' PENDING lastResult 'transient' — after run 2 equal ✓ (no field changes). Dates: settledAt for 'a' = afterLag (run 1's now). Run 2's now is later but 'a' is not re-settled ✓ so settledAt stays ✓ snapshot equal ✓.

Now — the 4-outcomes test: the txid assertion — findPending order is Map insertion order: o-acc, o-dup, o-trans, o-perm ✓ (the fake's findPending returns filter order = insertion order ✓).

Now — does the FakeStore need to be typed to structurally match PayoutOrderStore for the `new PayoutService(store, bank, CONFIG)` call? Yes: declare `class FakeStore implements PayoutOrderStore` ✓ (imported from types — prisma-free ✓).

FakeBank: no interface declared (there's no port interface — the service depends on the concrete BankGateway class). FakeBank is structurally compatible: the service's parameter type is `BankGateway` — class type = { send(...): ...; getStatement(...): ... } (no private) → FakeBank ✓.

Wait — actually, is that right? `class BankGateway { async send(_input: BankSendInput): Promise<BankSendResult>; async getStatement(_date: string): Promise<Settlement[]> }` — the instance type has exactly those two methods. FakeBank has those + scripted/sent/statements → structurally assignable ✓ (a class instance assigned to a class-typed parameter — TS uses structural typing; no brand) ✓.

CONFIG: a literal `{ lagMs: number, maxAttempts: number }` → the PayoutConfig instance type = { lagMs: number; maxAttempts: number } (from the getters, readonly) → assignable ✓.

Hmm — readonly: the literal's properties are mutable → assignable to readonly ✓.

Now — the service's file header comment: brief.

Let me also reconsider the `now` param of `executePayments` — the test passes a clock. In the real world, default new Date() ✓.

Edge: two PENDING orders with the same effective date but different ids → different txids ✓.

I believe the solution is complete. Let me also reconsider whether a `GET` health or list endpoint is expected by "controller" convention — not required.

One more convention check: "Class: PascalCase" ✓ all. "Code and comments in English" ✓.

"Table and columns: snake_case via @map/@@map" ✓.

Now — let me re-verify the migration SQL once more:

```sql
-- CreateEnum
CREATE TYPE "PaymentOrderState" AS ENUM ('PENDING', 'IN_FLIGHT', 'OUTCOME_UNKNOWN', 'SETTLED', 'REJECTED', 'NEEDS_REVIEW');

-- CreateTable
CREATE TABLE "payment_orders" (
    "id" TEXT NOT NULL,
    "supplier_key" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "effective_date" DATE NOT NULL,
    "state" "PaymentOrderState" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "last_result" TEXT,
    "reject_reason" TEXT,
    "settle_txid" TEXT,
    "settled_at" TIMESTAMP(3),
    "parked_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_orders_effective_date_state_idx" ON "payment_orders"("effective_date", "state");
```

✓.

The schema.prisma final:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum PaymentOrderState {
  PENDING
  IN_FLIGHT
  OUTCOME_UNKNOWN
  SETTLED
  REJECTED
  NEEDS_REVIEW
}

/// A payment order to a supplier via the bank's instant-payment API.
/// Money is stored in minor units (cents) as integers.
model PaymentOrder {
  id            String            @id @default(cuid())
  supplierKey   String            @map("supplier_key")
  amountCents   Int               @map("amount_cents")
  effectiveDate DateTime          @map("effective_date") @db.Date
  state         PaymentOrderState @default(PENDING) @map("state")
  attemptCount  Int               @default(0) @map("attempt_count")
  lastAttemptAt DateTime?         @map("last_attempt_at")
  lastResult    String?           @map("last_result")
  rejectReason  String?           @map("reject_reason")
  settleTxid    String?           @map("settle_txid")
  settledAt     DateTime?         @map("settled_at")
  parkedReason  String?           @map("parked_reason")
  createdAt     DateTime          @default(now()) @map("created_at")
  updatedAt     DateTime          @updatedAt @map("updated_at")

  @@index([effectiveDate, state], map: "payment_orders_effective_date_state_idx")
  @@map("payment_orders")
}
```

Good.

Now — one final concern about `@db.Date` + the JS Date at UTC midnight and `gte: from` — the repository is called with from/to at UTC midnight (from the controller/processor). Prisma's @db.Date handles Date values ✓.

Also — `findReconcilable` with `effectiveDate: { gte: from, lte: to }` — from/to are Dates ✓.

Now, let me write out all the files in the requested format: an H3 with the path only, a fenced block with the content only. No prose.

File order (reasonable):
1. package.json
2. tsconfig.json
3. prisma/schema.prisma
4. prisma/migrations/20250310000000_init/migration.sql
5. src/main.ts
6. src/app.module.ts
7. src/common/api-error.ts
8. src/common/exception-filter.ts
9. src/prisma/prisma.service.ts
10. src/prisma/prisma.module.ts
11. src/payout/payout.types.ts
12. src/payout/dates.util.ts
13. src/payout/txid.util.ts
14. src/payout/payout-config.ts
15. src/payout/bank-gateway.ts
16. src/payout/payout.repository.ts
17. src/payout/payout.service.ts
18. src/payout/payout.controller.ts
19. src/payout/payout.processor.ts
20. src/payout/payout.module.ts
21. test/payout.service.spec.ts
22. test/txid.util.spec.ts

Let me re-check the exception filter's HttpException.message handling:

```ts
if (exception instanceof HttpException) {
  const status = exception.getStatus();
  const message = exception.getMessage();
  this.write(response, status, status === 404 ? 'resource_not_found' : 'request_rejected', typeof message === 'string' ? message : 'Request rejected', {});
  return;
}
```

getMessage() returns any. The typeof guard ✓.

ApiError's default status 400 ✓.

The controller's parseWindow uses ApiError with 400 ✓.

Now — `@Post('execute')` — a POST with no body: the controller method with no params ✓.

One more consideration — **the `PayoutService` should not know about HTTP**. It throws ApiError (shared domain error) ✓ acceptable.

Also — hmm, `ApiError` in common is imported by the controller, the filter, and the service ✓.

Now, one more thought: **the "duplicate" outcome and the attempts increment** — markInFlight increments attempts. A duplicate on the 5th attempt → attempts 5, IN_FLIGHT — fine (in_flight is not subject to the attempts cap; the cap applies to the unknown-outcome loop).

**A duplicate on a fresh send (attempt 1)?** Means someone else (another system) already sent that txid — treat as in flight ✓ safe.

I think we're ready. Also let me confirm no unused imports in each file (a strict tsconfig without noUnusedLocals won't fail anyway).

Let me carefully write the final test file in full:

```ts
import { describe, expect, it } from 'vitest';
import type {
  BankSendInput,
  BankSendResult,
  OrderState,
  PayoutOrderStore,
  Settlement,
} from '../src/payout/payout.types.js';
import { PayoutService } from '../src/payout/payout.service.js';
import { deriveTxid } from '../src/payout/txid.util.js';

const CONFIG = { lagMs: 30 * 60_000, maxAttempts: 5 };
const T0 = new Date('2025-03-10T12:00:00.000Z');
const EFFECTIVE = new Date('2025-03-10T00:00:00.000Z');
const EFFECTIVE_KEY = '2025-03-10';
const WINDOW = {
  from: new Date('2025-03-09T00:00:00.000Z'),
  to: new Date('2025-03-10T00:00:00.000Z'),
};
const AMOUNT = 1_840_000; // €18,400.00, in cents
const KEY = 'key_123';

interface Row {
  id: string;
  supplierKey: string;
  amountCents: number;
  effectiveDate: Date;
  state: OrderState;
  attemptCount: number;
  lastAttemptAt: Date | null;
  lastResult: string | null;
  rejectReason: string | null;
  parkedReason: string | null;
  settleTxid: string | null;
  settledAt: Date | null;
}

function makeOrder(overrides: { id: string } & Partial<Omit<Row, 'id'>>): Row {
  return {
    supplierKey: KEY,
    amountCents: AMOUNT,
    effectiveDate: EFFECTIVE,
    state: 'PENDING',
    attemptCount: 0,
    lastAttemptAt: null,
    lastResult: null,
    rejectReason: null,
    parkedReason: null,
    settleTxid: null,
    settledAt: null,
    ...overrides,
  };
}

class FakeBank {
  scripted: BankSendResult[] = [];
  sent: BankSendInput[] = [];
  statements = new Map<string, Settlement[]>();

  async send(input: BankSendInput): Promise<BankSendResult> {
    this.sent.push(input);
    const next = this.scripted.shift();
    if (!next) throw new Error('FakeBank: no scripted outcome left');
    return next;
  }

  async getStatement(dateKey: string): Promise<Settlement[]> {
    return this.statements.get(dateKey) ?? [];
  }
}

class FakeStore implements PayoutOrderStore {
  rows = new Map<string, Row>();

  seed(order: Row): void {
    this.rows.set(order.id, { ...order });
  }

  get(id: string): Row {
    const row = this.rows.get(id);
    if (!row) throw new Error(`FakeStore: unknown order ${id}`);
    return { ...row };
  }

  snapshot(): Record<string, Row> {
    const out: Record<string, Row> = {};
    for (const [id, row] of this.rows) out[id] = { ...row };
    return out;
  }

  async findPending() {
    return [...this.rows.values()].filter((r) => r.state === 'PENDING').map((r) => ({ ...r }));
  }

  async findReconcilable(from: Date, to: Date) {
    return [...this.rows.values()]
      .filter(
        (r) =>
          (r.state === 'PENDING' || r.state === 'IN_FLIGHT' || r.state === 'OUTCOME_UNKNOWN') &&
          r.effectiveDate.getTime() >= from.getTime() &&
          r.effectiveDate.getTime() <= to.getTime(),
      )
      .map((r) => ({ ...r }));
  }

  async markInFlight(id: string, at: Date, lastResult: 'accepted' | 'duplicate') {
    const r = this.rows.get(id);
    if (!r || r.state !== 'PENDING') return false;
    Object.assign(r, { state: 'IN_FLIGHT', attemptCount: r.attemptCount + 1, lastAttemptAt: at, lastResult });
    return true;
  }

  async markOutcomeUnknown(id: string, at: Date) {
    const r = this.rows.get(id);
    if (!r || r.state !== 'PENDING') return false;
    Object.assign(r, { state: 'OUTCOME_UNKNOWN', attemptCount: r.attemptCount + 1, lastAttemptAt: at, lastResult: 'transient' });
    return true;
  }

  async markRejected(id: string, at: Date, reason: string) {
    const r = this.rows.get(id);
    if (!r || r.state !== 'PENDING') return false;
    Object.assign(r, { state: 'REJECTED', attemptCount: r.attemptCount + 1, lastAttemptAt: at, lastResult: 'permanent', rejectReason: reason });
    return true;
  }

  async markSettled(id: string, txid: string, at: Date) {
    const r = this.rows.get(id);
    if (!r || !(r.state === 'PENDING' || r.state === 'IN_FLIGHT' || r.state === 'OUTCOME_UNKNOWN')) return false;
    Object.assign(r, { state: 'SETTLED', settleTxid: txid, settledAt: at });
    return true;
  }

  async markPendingForResend(id: string) {
    const r = this.rows.get(id);
    if (!r || r.state !== 'OUTCOME_UNKNOWN') return false;
    Object.assign(r, { state: 'PENDING' });
    return true;
  }

  async markNeedsReview(id: string, reason: string) {
    const r = this.rows.get(id);
    if (!r || r.state !== 'OUTCOME_UNKNOWN') return false;
    Object.assign(r, { state: 'NEEDS_REVIEW', parkedReason: reason });
    return true;
  }
}
```

Hmm — the FakeStore's methods without explicit return types — `implements PayoutOrderStore` enforces compatibility. The return type is inferred as Promise<...> ✓. But `implements` checks signature compatibility — the inferred Promise<boolean> ✓.

Now the describe blocks:

```ts
describe('PayoutService.executePayments', () => {
  it('sends pending orders and classifies the four outcomes onto four distinct paths', async () => {
    ...
  });

  it('treats a transport throw from bank.send as an unknown outcome, not a trigger to act', async () => { ... });
});

describe('PayoutService.reconcile', () => {
  it('settles a timed-out order that appears on the statement and never re-sends it', ...);
  it('settles an in-flight order once its statement entry appears', ...);
  it('re-sends a proven-absent order past the lag with the same derived txid', ...);
  it('does not act on an unknown outcome while the publishing lag has not passed', ...);
  it('never re-sends an accepted in-flight order that is late on the statement', ...);
  it('is idempotent across repeated and overlapping reconcile windows', ...);
  it('parks the order for manual review after five attempts and never auto-reverts it', ...);
});
```

Wait — the "re-sends a proven-absent" test spans reconcile + executePayments. Put it under the reconcile describe? Or a top-level 'incident scenarios'? Keep two describes as above. Fine.

Now — let me confirm test 1 again: after the first executePayments, assert OUTCOME_UNKNOWN attempts 1 — ✓.

Also in the "four outcomes" test — assert `bank.sent` amounts/keys? Add: `expect(bank.sent[0]).toEqual({ txid: deriveTxid('o-acc', EFFECTIVE), amount: AMOUNT, key: KEY })` for one of them. And the array of txids ✓.

Now — a potential subtle TS issue in the test: `bank.send = async (input) => {...}` — a parameter of a method assigned to an instance: TS infers `input: BankSendInput` from the property type ✓ (the property's type is a method signature. Reassignment context gives the parameter type ✓).

Also — `Object.assign(r, {...})` with a state literal 'IN_FLIGHT' — r is Row. state: OrderState ✓.

Now — vitest `expect(store.snapshot()).toEqual(after)` — Date values: toEqual treats Date as an object with a time value — vitest handles Date in equality ✓ (uses `equals` with date support).

Now — the txid spec:

```ts
import { describe, expect, it } from 'vitest';
import { deriveTxid } from '../src/payout/txid.util.js';

describe('deriveTxid', () => {
  it('is deterministic: same order, same effective date, same txid', () => {
    const morning = new Date('2025-03-10T00:00:00.000Z');
    const noon = new Date('2025-03-10T12:00:00.000Z');
    const txid = deriveTxid('order-1', morning);
    expect(txid).toBe(deriveTxid('order-1', noon));
    expect(txid).toMatch(/^po_[0-9a-f]{40}$/);
  });

  it('changes when the effective date changes', () => {
    const d1 = new Date('2025-03-10T00:00:00.000Z');
    const d2 = new Date('2025-03-11T00:00:00.000Z');
    expect(deriveTxid('order-1', d1)).not.toBe(deriveTxid('order-1', d2));
  });

  it('changes when the order changes', () => {
    const d = new Date('2025-03-10T00:00:00.000Z');
    expect(deriveTxid('order-1', d)).not.toBe(deriveTxid('order-2', d));
  });
});
```

✓.

Now — the main.ts final, and app.module.ts final, as above.

One more check — the `import 'reflect-metadata';` as the first line of main.ts ✓ ESM side effect import.

Also — the `NestFactory.create(AppModule)` in main — the default express adapter comes from @nestjs/platform-express ✓ (in deps).

Now, does the `@Post('reconcile')` route conflict with the module's `reconcile`? No.

I think we're ready. Also — should I add a `.env.example`? "No secrets in the repository, no hardcoded connection strings" — a .env.example with a DATABASE_URL placeholder is conventional and harmless… "don't create files it doesn't ask for" — skip it. The schema references env('DATABASE_URL') ✓.

Let me reconsider the file count and "don't create a file it doesn't ask for": the task: "deliver the schema, service, reconcile job, and tests." Plus the repo conventions require main/app.module/module/controller/wiring, and the build scaffolding (package.json, tsconfig). All justified. The common filter — the error envelope convention requires it (the "these always hold" convention). OK.

One more reconsideration: does the task ask for a controller at all? The conventions' layout includes a controller, and the controller rule ("controller validates input and calls the service") implies an API exists. My two POST endpoints are a minimal reasonable surface. Keep it.

Final check on the service's `reconcile` — `const lagMs = this.config.lagMs;` reads the getter ✓.

And `executePayments` — `for (const order of pending)` — sequential ✓.

Also — potential issue: `findPending` returns a copy. We mark by id ✓.

Also — what if the `bank.send` result is 'accepted' but markInFlight returns false (concurrent)? Ignored — the comment in the repository explains the guarded transition. Fine.

Now — the `// ASSUMPTION` comments — let me place exactly one in each of:
1. bank-gateway.ts (the transport is unspecified)
2. The permanent case of the service's applySendOutcome (permanent → terminal human review, no auto-retry)
3. payout.types.ts Settlement (shape beyond txid)
4. The service's reconcile / processor (statement date == effective date) — where? In the service's reconcile doc comment: "statement entries for a payment are read from the statement of its effective date." Mark with ASSUMPTION.

Good — 4 markers.

Now, let me write it all out. Also make sure the fenced blocks contain only the file contents, and the headings contain only the paths. No prose outside the pattern (the instructions: keep it to nothing).

One more sanity check on the import paths in `payout.service.ts`: `../common/api-error.js` from src/payout → src/common ✓.

In the controller: `../common/api-error.js` ✓.

In the main: `./common/exception-filter.js`, `./app.module.js` ✓.

In the app.module: `./payout/payout.module.js` ✓.

In the payout.module: `../prisma/prisma.module.js` ✓.

In the repository: `../prisma/prisma.service.js` ✓.

In the processor: `./dates.util.js`, `./payout.service.js`, `./payout.types.js` ✓.

In the txid.util: `./dates.util.js` ✓ + `node:crypto` ✓.

Let me write the dates.util final:

```ts
/** Date helpers shared by the payout feature. All dates are handled in UTC. */

/** 'YYYY-MM-DD' key (the form getStatement takes) for a date. */
export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Parse a 'YYYY-MM-DD' key to a Date at UTC midnight. */
export function parseDateKey(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

/** The UTC midnight at the start of the date the argument falls on. */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** The inclusive list of UTC days from `from` to `to`; empty when `from` is after `to`. */
export function eachDay(from: Date, to: Date): Date[] {
  const days: Date[] = [];
  const end = startOfUtcDay(to).getTime();
  for (let cursor = startOfUtcDay(from).getTime(); cursor <= end; cursor += 86_400_000) {
    days.push(new Date(cursor));
  }
  return days;
}
```

Clean.

The controller final:

```ts
import { Body, Controller, Post } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { dateKey, parseDateKey } from './dates.util.js';
import { PayoutService } from './payout.service.js';
import type { DateWindow } from './payout.types.js';

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_WINDOW_DAYS = 31;

@Controller('payout-orders')
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  /** Send all pending orders. */
  @Post('execute')
  execute() {
    return this.service.executePayments();
  }

  /** Reconcile the given inclusive statement-date window (YYYY-MM-DD). */
  @Post('reconcile')
  reconcile(@Body() body: unknown) {
    return this.service.reconcile(parseWindow(body));
  }
}

function parseWindow(body: unknown): DateWindow {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError('invalid_window', 'body must be an object with "from" and "to" in YYYY-MM-DD form', 400);
  }
  const candidate = body as { from?: unknown; to?: unknown };
  const from = parseDateField('from', candidate.from);
  const to = parseDateField('to', candidate.to);
  if (from.getTime() > to.getTime()) {
    throw new ApiError('invalid_window', '"from" must not be after "to"', 400);
  }
  const spanDays = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  if (spanDays > MAX_WINDOW_DAYS) {
    throw new ApiError('invalid_window', `window may span at most ${MAX_WINDOW_DAYS} days`, 400);
  }
  return { from, to };
}

function parseDateField(field: 'from' | 'to', value: unknown): Date {
  if (typeof value !== 'string' || !DATE_KEY_RE.test(value)) {
    throw new ApiError('invalid_window', `"${field}" must be a date in YYYY-MM-DD form`, 400, { field });
  }
  const parsed = parseDateKey(value);
  if (Number.isNaN(parsed.getTime()) || dateKey(parsed) !== value) {
    throw new ApiError('invalid_window', `"${field}" must be a valid calendar date`, 400, { field, value });
  }
  return parsed;
}
```

✓.

ApiError signature: (code, message, status?, details?) ✓ matches the usage.

Exception filter final:

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { ApiError } from './api-error.js';

/**
 * The single error envelope for the API:
 *   { "error": { "code": "snake_case", "message": "...", "details": {} } }
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof ApiError) {
      this.write(response, exception.status, exception.code, exception.message, exception.details);
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const message = exception.getMessage();
      this.write(
        response,
        status,
        status === 404 ? 'resource_not_found' : 'request_rejected',
        typeof message === 'string' ? message : 'Request rejected',
        {},
      );
      return;
    }
    this.write(response, 500, 'internal_error', 'Unexpected server error', {});
  }

  private write(
    response: Response,
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown>,
  ): void {
    response.status(status).json({ error: { code, message, details } });
  }
}
```

`import type { Response } from 'express'` ✓ (needs @types/express ✓).

Now — one risk: `getResponse<Response>()` — the generic param ✓.

All set. Let me also confirm the `payout.service.ts` has no unused imports: Inject, Injectable, ApiError, BankGateway, dateKey, eachDay, PayoutConfig, types (PAYOUT_ORDER_STORE, PayoutOrderStore, BankSendInput, BankSendResult, DateWindow, ExecuteSummary, PaymentOrderRecord, ReconcileSummary, Settlement), deriveTxid — all used ✓ (BankSendInput in the sendClassified annotation ✓, Settlement in loadStatement ✓, PaymentOrderRecord in private methods ✓).

Repository: Injectable, PaymentOrder (type), PaymentOrderState, Prisma (type), PrismaService, PayoutOrderStore, PaymentOrderRecord ✓ all used.

The module file: all imports used ✓.

Processor: Injectable, Logger, Cron, dateKey, startOfUtcDay, PayoutService, DateWindow ✓.

main.ts: ✓.

Now — one more subtle point: the `PayoutRepository` implements `PayoutOrderStore` — the interface is from types ✓. And the repository's `markNeedsReview(id, reason)` — the interface updated ✓ (no `at`).

In the service: `await this.orders.markNeedsReview(order.id, 'send_attempts_exhausted')` ✓.

The fake: markNeedsReview(id, reason) ✓.

Let me re-check the FakeStore's `findReconcilable` — includes PENDING ✓ (matches the repository's filter).

Wait — the idempotency test: run 1 settles 'a' (OUTCOME_UNKNOWN→SETTLED), releases 'b' (→PENDING), 'c' stays. Run 2: 'b' is PENDING — in candidates — txid 'b' not on statement → `order.state === 'PENDING' → continue` ✓.

But hmm — a PENDING order 'b' with an old lastAttemptAt (T0) and past lag — should reconcile treat a PENDING as "proven absent" and… it's already PENDING. No action ✓. Good.

Now — a subtle scenario: an order PENDING (never sent, fresh) with effective date 03-10. Reconcile: no statement → PENDING → continue ✓ no harm.

OK. One more thought — **the `findPending` + `findReconcilable` overlap**: an order PENDING appears in both (executePayments sends it. If in the window, reconcile also loads it). No conflict: reconcile only acts on PENDING if a settlement exists (settle — correct) ✓.

Time to write the final answer. Format: for each file, an H3 path + a fenced block. The fence for prisma is `prisma`, for sql is `sql`, for json is `json`, for ts is `ts`.

Also — confirm no file appears twice.

Final review of the service file contents — let me write it out fully in my head once more:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { BankGateway } from './bank-gateway.js';
import { dateKey, eachDay } from './dates.util.js';
import { PayoutConfig } from './payout-config.js';
import {
  BankSendInput,
  BankSendResult,
  DateWindow,
  ExecuteSummary,
  PAYOUT_ORDER_STORE,
  PaymentOrderRecord,
  PayoutOrderStore,
  ReconcileSummary,
  Settlement,
} from './payout.types.js';
import { deriveTxid } from './txid.util.js';

/**
 * The payout reconciler.
 *
 * Invariant: the send path (executePayments) may record that it does not know
 * the outcome of a send, but it may not act on that. The only thing that may
 * cause a resend is reconcile() proving the order absent from the bank's
 * statement past the publishing lag.
 */
@Injectable()
export class PayoutService {
  constructor(
    @Inject(PAYOUT_ORDER_STORE)
    private readonly orders: PayoutOrderStore,
    private readonly bank: BankGateway,
    private readonly config: PayoutConfig,
  ) {}

  /**
   * Sends every pending order to the bank exactly once, classifying each
   * response. Never a resend path: it only sends orders that are already
   * PENDING, and reconcile() is the only code that moves an order back to
   * PENDING after a send.
   */
  async executePayments(now: Date = new Date()): Promise<ExecuteSummary> {
    const summary: ExecuteSummary = { accepted: 0, duplicate: 0, transient: 0, permanent: 0 };
    const pending = await this.orders.findPending();
    for (const order of pending) {
      const result = await this.sendClassified(order);
      await this.applySendOutcome(order, result, now);
      summary[result.outcome] += 1;
    }
    return summary;
  }

  /**
   * Match statement entries to orders by txid and advance state.
   *
   * // ASSUMPTION: a payment for a given effective date is published on the
   * statement of that date, so the window bounds both the statement fetches
   * and the orders examined.
   *
   * Safe to run repeatedly over overlapping windows: already-settled orders
   * are not even loaded, and every transition is a guarded one-way update.
   */
  async reconcile(window: DateWindow, now: Date = new Date()): Promise<ReconcileSummary> {
    const { from, to } = window;
    if (from.getTime() > to.getTime()) {
      throw new ApiError('invalid_window', 'window "from" must not be after "to"', 400);
    }

    const summary: ReconcileSummary = { settled: 0, rescheduled: 0, parked: 0 };
    const statement = await this.loadStatement(from, to);
    const candidates = await this.orders.findReconcilable(from, to);
    const lagMs = this.config.lagMs;

    for (const order of candidates) {
      const txid = deriveTxid(order.id, order.effectiveDate);

      if (statement.has(txid)) {
        // Evidence of execution — the send landed (this is also the timeout
        // case: the bank had it all along). Settle; the guarded update makes
        // a second run a no-op.
        const settled = await this.orders.markSettled(order.id, txid, now);
        if (settled) summary.settled += 1;
        continue;
      }

      // Not on the statement:
      if (order.state === 'PENDING') continue; // in the send queue (or never sent); no evidence either way
      if (order.state === 'IN_FLIGHT') continue; // the bank accepted it; a late row is lag, not absence

      // OUTCOME_UNKNOWN: the last send's outcome is unknown.
      if (order.lastAttemptAt === null) continue;
      if (now.getTime() - order.lastAttemptAt.getTime() < lagMs) continue; // the lag has not passed: no evidence yet

      // Proven absent past the publishing lag: absence is proof the send did
      // not land — the only point at which a resend (or a park) is permitted.
      if (order.attemptCount >= this.config.maxAttempts) {
        const parked = await this.orders.markNeedsReview(order.id, 'send_attempts_exhausted');
        if (parked) summary.parked += 1; // terminal: a human reviews; never auto-revert
      } else {
        const released = await this.orders.markPendingForResend(order.id);
        if (released) summary.rescheduled += 1; // PENDING; the next executePayments() re-sends the same txid
      }
    }
    return summary;
  }

  private async sendClassified(order: PaymentOrderRecord): Promise<BankSendResult> {
    const input: BankSendInput = {
      txid: deriveTxid(order.id, order.effectiveDate),
      amount: order.amountCents,
      key: order.supplierKey,
    };
    try {
      return await this.bank.send(input);
    } catch (err) {
      // The bank never answered: the outcome is unknown. Recording it as
      // transient and waiting for evidence is the only correct move.
      return { outcome: 'transient', detail: err instanceof Error ? err.message : String(err) };
    }
  }

  private async applySendOutcome(order: PaymentOrderRecord, result: BankSendResult, now: Date): Promise<void> {
    switch (result.outcome) {
      case 'accepted':
        // In flight; the statement is the only confirmation.
        await this.orders.markInFlight(order.id, now, 'accepted');
        break;
      case 'duplicate':
        // The bank already has this txid: success, not an error. The
        // instruction is (or was) in flight; the statement will confirm.
        await this.orders.markInFlight(order.id, now, 'duplicate');
        break;
      case 'transient':
        // Unknown outcome. Record and wait. Never resend from the send path.
        await this.orders.markOutcomeUnknown(order.id, now);
        break;
      case 'permanent':
        // // ASSUMPTION: a permanent rejection (malformed, blocked account,
        // closed beneficiary) is definitive and will not resolve by retrying,
        // so it parks for manual review immediately rather than auto-retrying.
        await this.orders.markRejected(order.id, now, result.reason);
        break;
    }
  }

  private async loadStatement(from: Date, to: Date): Promise<Map<string, Settlement>> {
    const seen = new Map<string, Settlement>();
    for (const day of eachDay(from, to)) {
      for (const entry of await this.bank.getStatement(dateKey(day))) {
        seen.set(entry.txid, entry);
      }
    }
    return seen;
  }
}
```

Good. Note: `summary[result.outcome] += 1` — TS: `summary` is ExecuteSummary. The key type of `result.outcome` is valid ✓.

Everything's ready to write out. Let me generate the final answer with the 22 files in the exact format. No prose outside the pattern.

Actually wait — let me count the files again and re-verify each is necessary:

1. package.json — needed (type: module, deps, scripts) ✓
2. tsconfig.json — needed (strict ESM decorators) ✓
3. prisma/schema.prisma ✓
4. prisma/migrations/20250310000000_init/migration.sql ✓ (convention: every schema change ships with a migration)
5. src/main.ts ✓
6. src/app.module.ts ✓
7. src/common/api-error.ts ✓ (error envelope convention)
8. src/common/exception-filter.ts ✓
9. src/prisma/prisma.service.ts ✓
10. src/prisma/prisma.module.ts ✓
11. src/payout/payout.types.ts ✓
12. src/payout/dates.util.ts ✓
13. src/payout/txid.util.ts ✓
14. src/payout/payout-config.ts ✓
15. src/payout/bank-gateway.ts ✓
16. src/payout/payout.repository.ts ✓
17. src/payout/payout.service.ts ✓
18. src/payout/payout.controller.ts ✓
19. src/payout/payout.processor.ts ✓ (the scheduled job deliverable)
20. src/payout/payout.module.ts ✓
21. test/payout.service.spec.ts ✓
22. test/txid.util.spec.ts ✓

Good. Let me write it out.

One more micro-check: in `test/payout.service.spec.ts`, the `PayoutService` import + `deriveTxid` import + the types type import — all prisma-free ✓. The service imports bank-gateway (no prisma), config (no prisma), api-error (no prisma), dates/txid utils, types ✓. So the test can run without a generated Prisma client ✓ — a big robustness win.

And in the 4-outcomes test, I reference `lastResult` values 'accepted'/'duplicate' ✓ the fake stores them ✓.

Also — confirm that in test 2 the `summary.rescheduled` — the release happened ✓.

And in test 2 I should also assert that before the lag passes, there was no release — implicitly covered by test 3.

Let me write the final version.
```

## reply

### package.json
```json
{
  "name": "supplier-payouts",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/src/main.js",
    "test": "vitest run",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.4",
    "@nestjs/core": "^10.4.4",
    "@nestjs/platform-express": "^10.4.4",
    "@nestjs/schedule": "^4.1.1",
    "@prisma/client": "^5.20.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.16.5",
    "prisma": "^5.20.0",
    "typescript": "^5.5.4",
    "vitest": "^2.1.1"
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
    "outDir": "dist",
    "strict": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "noEmitOnError": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
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

enum PaymentOrderState {
  PENDING
  IN_FLIGHT
  OUTCOME_UNKNOWN
  SETTLED
  REJECTED
  NEEDS_REVIEW
}

/// A payment order to a supplier via the bank's instant-payment API.
/// Money is held in minor units (cents), integers only.
model PaymentOrder {
  id            String            @id @default(cuid())
  supplierKey   String            @map("supplier_key")
  amountCents   Int               @map("amount_cents")
  effectiveDate DateTime          @map("effective_date") @db.Date
  state         PaymentOrderState @default(PENDING) @map("state")
  attemptCount  Int               @default(0) @map("attempt_count")
  lastAttemptAt DateTime?         @map("last_attempt_at")
  lastResult    String?           @map("last_result")
  rejectReason  String?           @map("reject_reason")
  settleTxid    String?           @map("settle_txid")
  settledAt     DateTime?         @map("settled_at")
  parkedReason  String?           @map("parked_reason")
  createdAt     DateTime          @default(now()) @map("created_at")
  updatedAt     DateTime          @updatedAt @map("updated_at")

  @@index([effectiveDate, state], map: "payment_orders_effective_date_state_idx")
  @@map("payment_orders")
}
```

### prisma/migrations/20250310000000_init/migration.sql
```sql
-- CreateEnum
CREATE TYPE "PaymentOrderState" AS ENUM ('PENDING', 'IN_FLIGHT', 'OUTCOME_UNKNOWN', 'SETTLED', 'REJECTED', 'NEEDS_REVIEW');

-- CreateTable
CREATE TABLE "payment_orders" (
    "id" TEXT NOT NULL,
    "supplier_key" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "effective_date" DATE NOT NULL,
    "state" "PaymentOrderState" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "last_result" TEXT,
    "reject_reason" TEXT,
    "settle_txid" TEXT,
    "settled_at" TIMESTAMP(3),
    "parked_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_orders_effective_date_state_idx" ON "payment_orders"("effective_date", "state");
```

### src/main.ts
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AllExceptionsFilter } from './common/exception-filter.js';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = process.env.PORT !== undefined ? Number.parseInt(process.env.PORT, 10) : 3000;
  await app.listen(Number.isInteger(port) && port > 0 ? port : 3000);
}

void bootstrap();
```

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { PayoutModule } from './payout/payout.module.js';

@Module({
  imports: [PayoutModule],
})
export class AppModule {}
```

### src/common/api-error.ts
```ts
/**
 * Application error carrying the stable snake_case `code` of the error
 * envelope. The message is developer-facing English; `details` is always an
 * object (never null).
 */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
```

### src/common/exception-filter.ts
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { ApiError } from './api-error.js';

/**
 * The single error envelope for the API:
 *   { "error": { "code": "snake_case", "message": "...", "details": {} } }
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof ApiError) {
      this.write(response, exception.status, exception.code, exception.message, exception.details);
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const message = exception.getMessage();
      this.write(
        response,
        status,
        status === 404 ? 'resource_not_found' : 'request_rejected',
        typeof message === 'string' ? message : 'Request rejected',
        {},
      );
      return;
    }
    this.write(response, 500, 'internal_error', 'Unexpected server error', {});
  }

  private write(
    response: Response,
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown>,
  ): void {
    response.status(status).json({ error: { code, message, details } });
  }
}
```

### src/prisma/prisma.service.ts
```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

### src/prisma/prisma.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

### src/payout/payout.types.ts
```ts
/**
 * Domain types shared by the payout feature. Deliberately free of Prisma/Nest
 * imports so tests can use them without a generated client.
 */

/**
 * State of a payment order. Values mirror the PaymentOrderState enum in the
 * Prisma schema. Transitions are one-way; the three terminal states are never
 * auto-reverted.
 */
export type OrderState =
  | 'PENDING' // eligible to be sent (initial, or released by reconcile)
  | 'IN_FLIGHT' // bank accepted (or confirmed duplicate); awaiting the statement
  | 'OUTCOME_UNKNOWN' // last send timed out / transient failure; outcome unknown
  | 'SETTLED' // matched on the bank's statement (terminal)
  | 'REJECTED' // bank permanently rejected it (terminal, human review)
  | 'NEEDS_REVIEW'; // send attempts exhausted (terminal, human review)

/** The view of a payment order the service works with. */
export interface PaymentOrderRecord {
  id: string;
  supplierKey: string;
  /** Money in minor units (cents). Integers only. */
  amountCents: number;
  /** UTC date the payment applies to; together with the id it derives the txid. */
  effectiveDate: Date;
  state: OrderState;
  /** Number of bank.send calls made for this order. */
  attemptCount: number;
  lastAttemptAt: Date | null;
}

/**
 * The port the service uses to read and advance orders. Every mark* method is a
 * guarded, one-way transition that can apply at most once.
 */
export interface PayoutOrderStore {
  findPending(): Promise<PaymentOrderRecord[]>;
  findReconcilable(from: Date, to: Date): Promise<PaymentOrderRecord[]>;
  markInFlight(id: string, at: Date, lastResult: 'accepted' | 'duplicate'): Promise<boolean>;
  markOutcomeUnknown(id: string, at: Date): Promise<boolean>;
  markRejected(id: string, at: Date, reason: string): Promise<boolean>;
  markSettled(id: string, txid: string, at: Date): Promise<boolean>;
  markPendingForResend(id: string): Promise<boolean>;
  markNeedsReview(id: string, reason: string): Promise<boolean>;
}

/** DI token for the order store port. */
export const PAYOUT_ORDER_STORE = 'PAYOUT_ORDER_STORE';

/** Input to bank.send. Amount is in minor units, integers only. */
export interface BankSendInput {
  txid: string;
  amount: number;
  key: string;
}

/** The four classified outcomes of bank.send. */
export type BankSendResult =
  | { outcome: 'accepted' }
  | { outcome: 'duplicate' }
  | { outcome: 'transient'; detail: string }
  | { outcome: 'permanent'; reason: string };

// ASSUMPTION: the task only guarantees a settlement carries the txid we sent;
// the beneficiary key is included because bank.send takes it and it aids manual review.
export interface Settlement {
  txid: string;
  key: string;
}

/** Inclusive range of statement dates (UTC midnights). */
export interface DateWindow {
  from: Date;
  to: Date;
}

export interface ExecuteSummary {
  accepted: number;
  duplicate: number;
  transient: number;
  permanent: number;
}

export interface ReconcileSummary {
  settled: number;
  rescheduled: number;
  parked: number;
}
```

### src/payout/dates.util.ts
```ts
/** Date helpers shared by the payout feature. All dates are handled in UTC. */

/** 'YYYY-MM-DD' key (the form getStatement takes) for a date. */
export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Parse a 'YYYY-MM-DD' key to the Date at UTC midnight. */
export function parseDateKey(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

/** The UTC midnight starting the day the argument falls on. */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Inclusive list of UTC days from `from` to `to`; empty when `from` is after `to`. */
export function eachDay(from: Date, to: Date): Date[] {
  const days: Date[] = [];
  const end = startOfUtcDay(to).getTime();
  for (let cursor = startOfUtcDay(from).getTime(); cursor <= end; cursor += 86_400_000) {
    days.push(new Date(cursor));
  }
  return days;
}
```

### src/payout/txid.util.ts
```ts
import { createHash } from 'node:crypto';
import { dateKey } from './dates.util.js';

/**
 * Derives the bank txid deterministically from stable order attributes and the
 * effective date: the same order on the same date always yields the same txid.
 * That is what makes a statement entry matchable to the order and a re-send
 * recognisable by the bank as the same instruction rather than a new payment.
 *
 * Never change this derivation without migrating existing orders: a new
 * derivation would make history unmatchable and re-sends unrecognised.
 */
export function deriveTxid(orderId: string, effectiveDate: Date): string {
  const digest = createHash('sha256').update(`${orderId}:${dateKey(effectiveDate)}`).digest('hex');
  return `po_${digest.slice(0, 40)}`;
}
```

### src/payout/payout-config.ts
```ts
import { Injectable } from '@nestjs/common';

// The bank publishes statements with up to ~30 minutes of lag; absence is only
// evidence past that.
const DEFAULT_PUBLISHING_LAG_MINUTES = 30;
const DEFAULT_MAX_SEND_ATTEMPTS = 5;

/**
 * Configuration from environment variables only:
 *   PAYOUT_PUBLISHING_LAG_MINUTES (default 30)
 *   PAYOUT_MAX_SEND_ATTEMPTS      (default 5)
 */
@Injectable()
export class PayoutConfig {
  get lagMs(): number {
    return readPositiveInt(process.env.PAYOUT_PUBLISHING_LAG_MINUTES, DEFAULT_PUBLISHING_LAG_MINUTES) * 60_000;
  }

  get maxAttempts(): number {
    return readPositiveInt(process.env.PAYOUT_MAX_SEND_ATTEMPTS, DEFAULT_MAX_SEND_ATTEMPTS);
  }
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
```

### src/payout/bank-gateway.ts
```ts
import { Injectable } from '@nestjs/common';
import type { BankSendInput, BankSendResult, Settlement } from './payout.types.js';

/**
 * Port to the bank's instant-payment API: send({txid, amount, key}) and
 * getStatement(date) -> Settlement[].
 *
 * ASSUMPTION: the task specifies no transport for the bank (endpoints, auth,
 * vendor SDK), so this default adapter is a stub. A deployment must override the
 * provider (e.g. `{ provide: BankGateway, useValue: vendorClient }`) with a
 * client whose `send` maps the raw response onto the four classified outcomes
 * and whose `getStatement(dateKey)` returns the day's published settlements.
 */
@Injectable()
export class BankGateway {
  async send(_input: BankSendInput): Promise<BankSendResult> {
    throw new Error('BankGateway is not wired: provide the vendor bank client for this environment');
  }

  async getStatement(_date: string): Promise<Settlement[]> {
    throw new Error('BankGateway is not wired: provide the vendor bank client for this environment');
  }
}
```

### src/payout/payout.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PaymentOrder, PaymentOrderState, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { PayoutOrderStore, PaymentOrderRecord } from './payout.types.js';

/**
 * The only layer that touches the database. Every state change is a guarded,
 * one-way transition: the WHERE clause pins the expected prior state, so a
 * repeated (or concurrent) run can apply each transition at most once.
 */
@Injectable()
export class PayoutRepository implements PayoutOrderStore {
  constructor(private readonly prisma: PrismaService) {}

  async findPending(): Promise<PaymentOrderRecord[]> {
    const rows = await this.prisma.paymentOrder.findMany({
      where: { state: PaymentOrderState.PENDING },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toRecord);
  }

  async findReconcilable(from: Date, to: Date): Promise<PaymentOrderRecord[]> {
    const rows = await this.prisma.paymentOrder.findMany({
      where: {
        state: {
          in: [PaymentOrderState.PENDING, PaymentOrderState.IN_FLIGHT, PaymentOrderState.OUTCOME_UNKNOWN],
        },
        effectiveDate: { gte: from, lte: to },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toRecord);
  }

  async markInFlight(id: string, at: Date, lastResult: 'accepted' | 'duplicate'): Promise<boolean> {
    return this.transition(
      { id, state: PaymentOrderState.PENDING },
      { state: PaymentOrderState.IN_FLIGHT, attemptCount: { increment: 1 }, lastAttemptAt: at, lastResult },
    );
  }

  async markOutcomeUnknown(id: string, at: Date): Promise<boolean> {
    return this.transition(
      { id, state: PaymentOrderState.PENDING },
      {
        state: PaymentOrderState.OUTCOME_UNKNOWN,
        attemptCount: { increment: 1 },
        lastAttemptAt: at,
        lastResult: 'transient',
      },
    );
  }

  async markRejected(id: string, at: Date, reason: string): Promise<boolean> {
    return this.transition(
      { id, state: PaymentOrderState.PENDING },
      {
        state: PaymentOrderState.REJECTED,
        attemptCount: { increment: 1 },
        lastAttemptAt: at,
        lastResult: 'permanent',
        rejectReason: reason,
      },
    );
  }

  async markSettled(id: string, txid: string, at: Date): Promise<boolean> {
    return this.transition(
      {
        id,
        state: {
          in: [PaymentOrderState.PENDING, PaymentOrderState.IN_FLIGHT, PaymentOrderState.OUTCOME_UNKNOWN],
        },
      },
      { state: PaymentOrderState.SETTLED, settleTxid: txid, settledAt: at },
    );
  }

  async markPendingForResend(id: string): Promise<boolean> {
    return this.transition(
      { id, state: PaymentOrderState.OUTCOME_UNKNOWN },
      { state: PaymentOrderState.PENDING },
    );
  }

  async markNeedsReview(id: string, reason: string): Promise<boolean> {
    return this.transition(
      { id, state: PaymentOrderState.OUTCOME_UNKNOWN },
      { state: PaymentOrderState.NEEDS_REVIEW, parkedReason: reason },
    );
  }

  private async transition(
    where: Prisma.PaymentOrderWhereUniqueInput,
    data: Prisma.PaymentOrderUpdateManyMutationInput,
  ): Promise<boolean> {
    const result = await this.prisma.paymentOrder.updateMany({ where, data });
    return result.count > 0;
  }
}

function toRecord(row: PaymentOrder): PaymentOrderRecord {
  return {
    id: row.id,
    supplierKey: row.supplierKey,
    amountCents: row.amountCents,
    effectiveDate: row.effectiveDate,
    state: row.state,
    attemptCount: row.attemptCount,
    lastAttemptAt: row.lastAttemptAt,
  };
}
```

### src/payout/payout.service.ts
```ts
import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { BankGateway } from './bank-gateway.js';
import { dateKey, eachDay } from './dates.util.js';
import { PayoutConfig } from './payout-config.js';
import {
  BankSendInput,
  BankSendResult,
  DateWindow,
  ExecuteSummary,
  PAYOUT_ORDER_STORE,
  PaymentOrderRecord,
  PayoutOrderStore,
  ReconcileSummary,
  Settlement,
} from './payout.types.js';
import { deriveTxid } from './txid.util.js';

/**
 * The payout reconciler.
 *
 * Invariant: the send path may record that it does not know the outcome of a
 * send, but it may not act on that. The only thing that may cause a re-send is
 * reconcile() proving the order absent from the statement past the publishing
 * lag.
 */
@Injectable()
export class PayoutService {
  constructor(
    @Inject(PAYOUT_ORDER_STORE)
    private readonly orders: PayoutOrderStore,
    private readonly bank: BankGateway,
    private readonly config: PayoutConfig,
  ) {}

  /**
   * Sends every pending order to the bank exactly once, classifying each
   * response. Never a re-send path: it only sends orders that are already
   * PENDING, and reconcile() is the only code that moves an order back to
   * PENDING after a send.
   */
  async executePayments(now: Date = new Date()): Promise<ExecuteSummary> {
    const summary: ExecuteSummary = { accepted: 0, duplicate: 0, transient: 0, permanent: 0 };
    const pending = await this.orders.findPending();
    for (const order of pending) {
      const result = await this.sendClassified(order);
      await this.applySendOutcome(order, result, now);
      summary[result.outcome] += 1;
    }
    return summary;
  }

  /**
   * Matches statement entries to orders by txid and advances state.
   *
   * ASSUMPTION: a payment for a given effective date is published on the
   * statement of that date, so the window bounds both the statement fetches
   * and the orders examined.
   *
   * Safe to run repeatedly over overlapping windows: already-settled orders
   * are skipped before any decision is taken about them, and every transition
   * is a guarded one-way update.
   */
  async reconcile(window: DateWindow, now: Date = new Date()): Promise<ReconcileSummary> {
    const { from, to } = window;
    if (from.getTime() > to.getTime()) {
      throw new ApiError('invalid_window', 'window "from" must not be after "to"', 400);
    }

    const summary: ReconcileSummary = { settled: 0, rescheduled: 0, parked: 0 };
    const statement = await this.loadStatement(from, to);
    const candidates = await this.orders.findReconcilable(from, to);
    const lagMs = this.config.lagMs;

    for (const order of candidates) {
      const txid = deriveTxid(order.id, order.effectiveDate);

      if (statement.has(txid)) {
        // Evidence of execution — the send landed (this is also the timeout
        // case: the bank had it all along). Settle; the guarded update makes a
        // second run a no-op.
        const settled = await this.orders.markSettled(order.id, txid, now);
        if (settled) summary.settled += 1;
        continue;
      }

      // Not on the statement:
      if (order.state === 'PENDING') continue; // in the send queue (or never sent): no evidence either way
      if (order.state === 'IN_FLIGHT') continue; // the bank accepted it; a late row is lag, not absence

      // OUTCOME_UNKNOWN: the last send's outcome is unknown.
      if (order.lastAttemptAt === null) continue;
      if (now.getTime() - order.lastAttemptAt.getTime() < lagMs) continue; // lag not yet passed: no evidence

      // Proven absent past the publishing lag: absence is proof the send did
      // not land — the only point at which a re-send (or a park) is permitted.
      if (order.attemptCount >= this.config.maxAttempts) {
        const parked = await this.orders.markNeedsReview(order.id, 'send_attempts_exhausted');
        if (parked) summary.parked += 1; // terminal: a human reviews; never auto-revert
      } else {
        const released = await this.orders.markPendingForResend(order.id);
        if (released) summary.rescheduled += 1; // PENDING; the next executePayments() re-sends the same txid
      }
    }
    return summary;
  }

  private async sendClassified(order: PaymentOrderRecord): Promise<BankSendResult> {
    const input: BankSendInput = {
      txid: deriveTxid(order.id, order.effectiveDate),
      amount: order.amountCents,
      key: order.supplierKey,
    };
    try {
      return await this.bank.send(input);
    } catch (err) {
      // The bank never answered: the outcome is unknown. Recording it as
      // transient and waiting for evidence is the only correct move.
      return { outcome: 'transient', detail: err instanceof Error ? err.message : String(err) };
    }
  }

  private async applySendOutcome(order: PaymentOrderRecord, result: BankSendResult, now: Date): Promise<void> {
    switch (result.outcome) {
      case 'accepted':
        // In flight; the statement is the only confirmation.
        await this.orders.markInFlight(order.id, now, 'accepted');
        break;
      case 'duplicate':
        // The bank already has this txid: success, not an error. The
        // instruction is (or was) in flight; the statement will confirm.
        await this.orders.markInFlight(order.id, now, 'duplicate');
        break;
      case 'transient':
        // Unknown outcome. Record and wait. Never re-send from the send path.
        await this.orders.markOutcomeUnknown(order.id, now);
        break;
      case 'permanent':
        // ASSUMPTION: a permanent rejection (malformed, blocked account, closed
        // beneficiary) is definitive and will not resolve by retrying, so it
        // parks for manual review immediately rather than auto-retrying.
        await this.orders.markRejected(order.id, now, result.reason);
        break;
    }
  }

  private async loadStatement(from: Date, to: Date): Promise<Map<string, Settlement>> {
    const seen = new Map<string, Settlement>();
    for (const day of eachDay(from, to)) {
      for (const entry of await this.bank.getStatement(dateKey(day))) {
        seen.set(entry.txid, entry);
      }
    }
    return seen;
  }
}
```

### src/payout/payout.controller.ts
```ts
import { Body, Controller, Post } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { dateKey, parseDateKey } from './dates.util.js';
import { PayoutService } from './payout.service.js';
import type { DateWindow } from './payout.types.js';

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_WINDOW_DAYS = 31;

@Controller('payout-orders')
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  /** Send all pending orders. */
  @Post('execute')
  execute() {
    return this.service.executePayments();
  }

  /** Reconcile the given inclusive statement-date window (YYYY-MM-DD). */
  @Post('reconcile')
  reconcile(@Body() body: unknown) {
    return this.service.reconcile(parseWindow(body));
  }
}

function parseWindow(body: unknown): DateWindow {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError('invalid_window', 'body must be an object with "from" and "to" in YYYY-MM-DD form', 400);
  }
  const candidate = body as { from?: unknown; to?: unknown };
  const from = parseDateField('from', candidate.from);
  const to = parseDateField('to', candidate.to);
  if (from.getTime() > to.getTime()) {
    throw new ApiError('invalid_window', '"from" must not be after "to"', 400);
  }
  const spanDays = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  if (spanDays > MAX_WINDOW_DAYS) {
    throw new ApiError('invalid_window', `window may span at most ${MAX_WINDOW_DAYS} days`, 400);
  }
  return { from, to };
}

function parseDateField(field: 'from' | 'to', value: unknown): Date {
  if (typeof value !== 'string' || !DATE_KEY_RE.test(value)) {
    throw new ApiError('invalid_window', `"${field}" must be a date in YYYY-MM-DD form`, 400, { field });
  }
  const parsed = parseDateKey(value);
  if (Number.isNaN(parsed.getTime()) || dateKey(parsed) !== value) {
    throw new ApiError('invalid_window', `"${field}" must be a valid calendar date`, 400, { field, value });
  }
  return parsed;
}
```

### src/payout/payout.processor.ts
```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { dateKey, startOfUtcDay } from './dates.util.js';
import { PayoutService } from './payout.service.js';
import type { DateWindow } from './payout.types.js';

const DAY_MS = 86_400_000;

/**
 * The scheduled reconcile job.
 *
 * Runs every 15 minutes over yesterday + today — a window that overlaps the
 * previous run by design; reconcile() is idempotent, so the overlap settles
 * nothing twice.
 */
@Injectable()
export class PayoutProcessor {
  private readonly logger = new Logger(PayoutProcessor.name);

  constructor(private readonly service: PayoutService) {}

  @Cron('*/15 * * * *')
  async runScheduledReconcile(): Promise<void> {
    const now = new Date();
    const window: DateWindow = {
      from: startOfUtcDay(new Date(now.getTime() - DAY_MS)),
      to: startOfUtcDay(now),
    };
    try {
      const summary = await this.service.reconcile(window, now);
      this.logger.log(
        `reconciled ${dateKey(window.from)}..${dateKey(window.to)}: ` +
          `settled=${summary.settled} rescheduled=${summary.rescheduled} parked=${summary.parked}`,
      );
    } catch (err) {
      // The next run re-covers the same window; log loudly, do not crash the process.
      this.logger.error(`scheduled reconcile failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
```

### src/payout/payout.module.ts
```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../prisma/prisma.module.js';
import { BankGateway } from './bank-gateway.js';
import { PayoutConfig } from './payout-config.js';
import { PayoutController } from './payout.controller.js';
import { PayoutProcessor } from './payout.processor.js';
import { PayoutRepository } from './payout.repository.js';
import { PayoutService } from './payout.service.js';
import { PAYOUT_ORDER_STORE } from './payout.types.js';

@Module({
  imports: [PrismaModule, ScheduleModule.forRoot({ timezone: 'UTC' })],
  controllers: [PayoutController],
  providers: [
    PayoutService,
    PayoutRepository,
    BankGateway,
    PayoutConfig,
    PayoutProcessor,
    { provide: PAYOUT_ORDER_STORE, useClass: PayoutRepository },
  ],
  exports: [PayoutService],
})
export class PayoutModule {}
```

### test/payout.service.spec.ts
```ts
import { describe, expect, it } from 'vitest';
import type {
  BankSendInput,
  BankSendResult,
  OrderState,
  PayoutOrderStore,
  Settlement,
} from '../src/payout/payout.types.js';
import { PayoutService } from '../src/payout/payout.service.js';
import { deriveTxid } from '../src/payout/txid.util.js';

const CONFIG = { lagMs: 30 * 60_000, maxAttempts: 5 };
const T0 = new Date('2025-03-10T12:00:00.000Z');
const EFFECTIVE = new Date('2025-03-10T00:00:00.000Z');
const EFFECTIVE_KEY = '2025-03-10';
const WINDOW = {
  from: new Date('2025-03-09T00:00:00.000Z'),
  to: new Date('2025-03-10T00:00:00.000Z'),
};
const AMOUNT = 1_840_000; // €18,400.00, in minor units
const KEY = 'key_123';

interface Row {
  id: string;
  supplierKey: string;
  amountCents: number;
  effectiveDate: Date;
  state: OrderState;
  attemptCount: number;
  lastAttemptAt: Date | null;
  lastResult: string | null;
  rejectReason: string | null;
  parkedReason: string | null;
  settleTxid: string | null;
  settledAt: Date | null;
}

function makeOrder(overrides: { id: string } & Partial<Omit<Row, 'id'>>): Row {
  return {
    supplierKey: KEY,
    amountCents: AMOUNT,
    effectiveDate: EFFECTIVE,
    state: 'PENDING',
    attemptCount: 0,
    lastAttemptAt: null,
    lastResult: null,
    rejectReason: null,
    parkedReason: null,
    settleTxid: null,
    settledAt: null,
    ...overrides,
  };
}

class FakeBank {
  scripted: BankSendResult[] = [];
  sent: BankSendInput[] = [];
  statements = new Map<string, Settlement[]>();

  async send(input: BankSendInput): Promise<BankSendResult> {
    this.sent.push(input);
    const next = this.scripted.shift();
    if (!next) throw new Error('FakeBank: no scripted outcome left');
    return next;
  }

  async getStatement(dateKey: string): Promise<Settlement[]> {
    return this.statements.get(dateKey) ?? [];
  }
}

class FakeStore implements PayoutOrderStore {
  rows = new Map<string, Row>();

  seed(order: Row): void {
    this.rows.set(order.id, { ...order });
  }

  get(id: string): Row {
    const row = this.rows.get(id);
    if (!row) throw new Error(`FakeStore: unknown order ${id}`);
    return { ...row };
  }

  snapshot(): Record<string, Row> {
    const out: Record<string, Row> = {};
    for (const [id, row] of this.rows) out[id] = { ...row };
    return out;
  }

  async findPending() {
    return [...this.rows.values()].filter((r) => r.state === 'PENDING').map((r) => ({ ...r }));
  }

  async findReconcilable(from: Date, to: Date) {
    return [...this.rows.values()]
      .filter(
        (r) =>
          (r.state === 'PENDING' || r.state === 'IN_FLIGHT' || r.state === 'OUTCOME_UNKNOWN') &&
          r.effectiveDate.getTime() >= from.getTime() &&
          r.effectiveDate.getTime() <= to.getTime(),
      )
      .map((r) => ({ ...r }));
  }

  async markInFlight(id: string, at: Date, lastResult: 'accepted' | 'duplicate') {
    const r = this.rows.get(id);
    if (!r || r.state !== 'PENDING') return false;
    Object.assign(r, { state: 'IN_FLIGHT', attemptCount: r.attemptCount + 1, lastAttemptAt: at, lastResult });
    return true;
  }

  async markOutcomeUnknown(id: string, at: Date) {
    const r = this.rows.get(id);
    if (!r || r.state !== 'PENDING') return false;
    Object.assign(r, { state: 'OUTCOME_UNKNOWN', attemptCount: r.attemptCount + 1, lastAttemptAt: at, lastResult: 'transient' });
    return true;
  }

  async markRejected(id: string, at: Date, reason: string) {
    const r = this.rows.get(id);
    if (!r || r.state !== 'PENDING') return false;
    Object.assign(r, { state: 'REJECTED', attemptCount: r.attemptCount + 1, lastAttemptAt: at, lastResult: 'permanent', rejectReason: reason });
    return true;
  }

  async markSettled(id: string, txid: string, at: Date) {
    const r = this.rows.get(id);
    if (!r || !(r.state === 'PENDING' || r.state === 'IN_FLIGHT' || r.state === 'OUTCOME_UNKNOWN')) return false;
    Object.assign(r, { state: 'SETTLED', settleTxid: txid, settledAt: at });
    return true;
  }

  async markPendingForResend(id: string) {
    const r = this.rows.get(id);
    if (!r || r.state !== 'OUTCOME_UNKNOWN') return false;
    Object.assign(r, { state: 'PENDING' });
    return true;
  }

  async markNeedsReview(id: string, reason: string) {
    const r = this.rows.get(id);
    if (!r || r.state !== 'OUTCOME_UNKNOWN') return false;
    Object.assign(r, { state: 'NEEDS_REVIEW', parkedReason: reason });
    return true;
  }
}

describe('PayoutService.executePayments', () => {
  it('sends pending orders and classifies the four outcomes onto four distinct paths', async () => {
    const store = new FakeStore();
    const bank = new FakeBank();
    store.seed(makeOrder({ id: 'o-acc' }));
    store.seed(makeOrder({ id: 'o-dup' }));
    store.seed(makeOrder({ id: 'o-trans' }));
    store.seed(makeOrder({ id: 'o-perm' }));
    bank.scripted.push(
      { outcome: 'accepted' },
      { outcome: 'duplicate' },
      { outcome: 'transient', detail: '503' },
      { outcome: 'permanent', reason: 'closed_beneficiary' },
    );
    const service = new PayoutService(store, bank, CONFIG);

    const summary = await service.executePayments(T0);

    expect(summary).toEqual({ accepted: 1, duplicate: 1, transient: 1, permanent: 1 });
    expect(store.get('o-acc').state).toBe('IN_FLIGHT');
    expect(store.get('o-acc').lastResult).toBe('accepted');
    expect(store.get('o-dup').state).toBe('IN_FLIGHT');
    expect(store.get('o-dup').lastResult).toBe('duplicate');
    expect(store.get('o-trans').state).toBe('OUTCOME_UNKNOWN');
    expect(store.get('o-trans').lastResult).toBe('transient');
    expect(store.get('o-perm').state).toBe('REJECTED');
    expect(store.get('o-perm').lastResult).toBe('permanent');
    expect(store.get('o-perm').rejectReason).toBe('closed_beneficiary');
    for (const id of ['o-acc', 'o-dup', 'o-trans', 'o-perm']) {
      expect(store.get(id).attemptCount).toBe(1);
    }
    // Each send carried its order's own derived txid, amount and key.
    expect(bank.sent).toEqual([
      { txid: deriveTxid('o-acc', EFFECTIVE), amount: AMOUNT, key: KEY },
      { txid: deriveTxid('o-dup', EFFECTIVE), amount: AMOUNT, key: KEY },
      { txid: deriveTxid('o-trans', EFFECTIVE), amount: AMOUNT, key: KEY },
      { txid: deriveTxid('o-perm', EFFECTIVE), amount: AMOUNT, key: KEY },
    ]);
  });

  it('treats a transport throw from bank.send as an unknown outcome, not a trigger to act', async () => {
    const store = new FakeStore();
    const bank = new FakeBank();
    bank.send = async (input) => {
      bank.sent.push(input);
      throw new Error('ECONNRESET');
    };
    store.seed(makeOrder({ id: 'o-err' }));
    const service = new PayoutService(store, bank, CONFIG);

    await service.executePayments(T0);

    const row = store.get('o-err');
    expect(row.state).toBe('OUTCOME_UNKNOWN');
    expect(row.attemptCount).toBe(1);

    // The send path does not act on not knowing: a second run sends nothing.
    await service.executePayments(new Date(T0.getTime() + 60_000));
    expect(bank.sent).toHaveLength(1);
  });
});

describe('PayoutService.reconcile', () => {
  it('settles a timed-out order that appears on the statement and never re-sends it', async () => {
    const store = new FakeStore();
    const bank = new FakeBank();
    store.seed(makeOrder({ id: 'order-1' }));
    bank.scripted.push({ outcome: 'transient', detail: 'timeout' });
    const service = new PayoutService(store, bank, CONFIG);

    // The original send times out: outcome unknown, nothing else changes.
    await service.executePayments(T0);
    expect(store.get('order-1').state).toBe('OUTCOME_UNKNOWN');
    expect(store.get('order-1').attemptCount).toBe(1);

    // The bank's statement (published after the lag) shows the txid we sent.
    const txid = deriveTxid('order-1', EFFECTIVE);
    bank.statements.set(EFFECTIVE_KEY, [{ txid, key: KEY }]);

    const afterLag = new Date(T0.getTime() + CONFIG.lagMs + 60_000);
    const summary = await service.reconcile(WINDOW, afterLag);

    expect(summary).toEqual({ settled: 1, rescheduled: 0, parked: 0 });
    const settled = store.get('order-1');
    expect(settled.state).toBe('SETTLED');
    expect(settled.settleTxid).toBe(txid);

    // No re-send: the send path has nothing left to do for this order.
    const sentBefore = bank.sent.length;
    await service.executePayments(new Date(afterLag.getTime() + 60_000));
    expect(bank.sent.length).toBe(sentBefore);
  });

  it('settles an in-flight order once its statement entry appears', async () => {
    const store = new FakeStore();
    const bank = new FakeBank();
    store.seed(makeOrder({ id: 'o-set', state: 'IN_FLIGHT', attemptCount: 1, lastAttemptAt: T0, lastResult: 'accepted' }));
    bank.statements.set(EFFECTIVE_KEY, [{ txid: deriveTxid('o-set', EFFECTIVE), key: KEY }]);
    const service = new PayoutService(store, bank, CONFIG);

    const summary = await service.reconcile(WINDOW, T0);

    expect(summary).toEqual({ settled: 1, rescheduled: 0, parked: 0 });
    const row = store.get('o-set');
    expect(row.state).toBe('SETTLED');
    expect(row.settleTxid).toBe(deriveTxid('o-set', EFFECTIVE));
    expect(row.settledAt).toBe(T0);
  });

  it('re-sends a proven-absent order past the lag with the same derived txid', async () => {
    const store = new FakeStore();
    const bank = new FakeBank();
    store.seed(makeOrder({ id: 'order-2' }));
    bank.scripted.push({ outcome: 'transient', detail: 'timeout' });
    const service = new PayoutService(store, bank, CONFIG);

    await service.executePayments(T0);
    expect(store.get('order-2').state).toBe('OUTCOME_UNKNOWN');
    const firstTxid = bank.sent[0].txid;

    // Past the lag, the statement for the order's date is empty: proven absent.
    const afterLag = new Date(T0.getTime() + CONFIG.lagMs + 60_000);
    const summary = await service.reconcile(WINDOW, afterLag);
    expect(summary).toEqual({ settled: 0, rescheduled: 1, parked: 0 });
    expect(store.get('order-2').state).toBe('PENDING');

    // The next send goes out with the same txid — the bank sees the same instruction.
    bank.scripted.push({ outcome: 'accepted' });
    await service.executePayments(new Date(afterLag.getTime() + 60_000));
    expect(bank.sent).toHaveLength(2);
    expect(bank.sent[1].txid).toBe(firstTxid);
    expect(bank.sent[1].amount).toBe(AMOUNT);
    expect(store.get('order-2').state).toBe('IN_FLIGHT');
    expect(store.get('order-2').attemptCount).toBe(2);
  });

  it('does not act on an unknown outcome while the publishing lag has not passed', async () => {
    const store = new FakeStore();
    const bank = new FakeBank();
    store.seed(makeOrder({ id: 'o-lag', state: 'OUTCOME_UNKNOWN', attemptCount: 1, lastAttemptAt: T0, lastResult: 'transient' }));
    const service = new PayoutService(store, bank, CONFIG);

    const summary = await service.reconcile(WINDOW, new Date(T0.getTime() + CONFIG.lagMs - 1_000));

    expect(summary).toEqual({ settled: 0, rescheduled: 0, parked: 0 });
    expect(store.get('o-lag').state).toBe('OUTCOME_UNKNOWN');
    expect(bank.sent).toHaveLength(0);
  });

  it('never re-sends an accepted in-flight order that is late on the statement', async () => {
    const store = new FakeStore();
    const bank = new FakeBank();
    store.seed(makeOrder({ id: 'o-inflight', state: 'IN_FLIGHT', attemptCount: 1, lastAttemptAt: T0, lastResult: 'accepted' }));
    const service = new PayoutService(store, bank, CONFIG);

    const afterLag = new Date(T0.getTime() + CONFIG.lagMs + 60_000);
    const summary = await service.reconcile(WINDOW, afterLag);

    expect(summary).toEqual({ settled: 0, rescheduled: 0, parked: 0 });
    expect(store.get('o-inflight').state).toBe('IN_FLIGHT');

    // The send path must not touch it either: a double payment is the incident.
    await service.executePayments(afterLag);
    expect(bank.sent).toHaveLength(0);
  });

  it('is idempotent across repeated and overlapping reconcile windows', async () => {
    const store = new FakeStore();
    const bank = new FakeBank();
    store.seed(makeOrder({ id: 'a', state: 'OUTCOME_UNKNOWN', attemptCount: 1, lastAttemptAt: T0, lastResult: 'transient' }));
    store.seed(makeOrder({ id: 'b', state: 'OUTCOME_UNKNOWN', attemptCount: 1, lastAttemptAt: T0, lastResult: 'transient' }));
    store.seed(makeOrder({ id: 'c', state: 'IN_FLIGHT', attemptCount: 1, lastAttemptAt: T0, lastResult: 'accepted' }));
    bank.statements.set(EFFECTIVE_KEY, [{ txid: deriveTxid('a', EFFECTIVE), key: KEY }]);
    const service = new PayoutService(store, bank, CONFIG);

    const afterLag = new Date(T0.getTime() + CONFIG.lagMs + 60_000);
    const first = await service.reconcile(WINDOW, afterLag);
    expect(first).toEqual({ settled: 1, rescheduled: 1, parked: 0 });
    const afterFirst = store.snapshot();

    // Run twice over the same window: identical state after both.
    const second = await service.reconcile(WINDOW, new Date(afterLag.getTime() + 60_000));
    expect(second).toEqual({ settled: 0, rescheduled: 0, parked: 0 });
    expect(store.snapshot()).toEqual(afterFirst);

    // A shifted, overlapping window changes nothing either.
    const wider = { from: new Date('2025-03-08T00:00:00.000Z'), to: new Date('2025-03-11T00:00:00.000Z') };
    const third = await service.reconcile(wider, new Date(afterLag.getTime() + 120_000));
    expect(third).toEqual({ settled: 0, rescheduled: 0, parked: 0 });
    expect(store.snapshot()).toEqual(afterFirst);
  });

  it('parks the order for manual review after five attempts and never auto-reverts it', async () => {
    const store = new FakeStore();
    const bank = new FakeBank();
    store.seed(makeOrder({ id: 'order-5' }));
    const service = new PayoutService(store, bank, CONFIG);

    let clock = T0;
    let lastSummary = { settled: 0, rescheduled: 0, parked: 0 };
    for (let attempt = 1; attempt <= CONFIG.maxAttempts; attempt++) {
      bank.scripted.push({ outcome: 'transient', detail: `timeout ${attempt}` });
      await service.executePayments(clock);
      clock = new Date(clock.getTime() + CONFIG.lagMs + 60_000); // wait out the publishing lag
      lastSummary = await service.reconcile(WINDOW, clock);
      expect(store.get('order-5').attemptCount).toBe(attempt);
      if (attempt < CONFIG.maxAttempts) {
        expect(store.get('order-5').state).toBe('PENDING');
        expect(lastSummary.rescheduled).toBe(1);
      }
    }

    // The fifth proven-absent outcome parks the order instead of releasing it.
    expect(lastSummary.parked).toBe(1);
    const parked = store.get('order-5');
    expect(parked.state).toBe('NEEDS_REVIEW');
    expect(parked.parkedReason).toBe('send_attempts_exhausted');
    expect(parked.attemptCount).toBe(CONFIG.maxAttempts);

    // Every attempt used the same derived txid.
    expect(bank.sent).toHaveLength(CONFIG.maxAttempts);
    const txid = deriveTxid('order-5', EFFECTIVE);
    for (const sent of bank.sent) expect(sent.txid).toBe(txid);

    // Terminal: neither a further reconcile nor the send path touches it.
    const after = store.snapshot();
    const later = new Date(clock.getTime() + CONFIG.lagMs + 60_000);
    await service.reconcile(WINDOW, later);
    await service.executePayments(later);
    expect(store.snapshot()).toEqual(after);
    expect(bank.sent).toHaveLength(CONFIG.maxAttempts);
  });
});
```

### test/txid.util.spec.ts
```ts
import { describe, expect, it } from 'vitest';
import { deriveTxid } from '../src/payout/txid.util.js';

describe('deriveTxid', () => {
  it('is deterministic: same order, same effective date, same txid', () => {
    const morning = new Date('2025-03-10T00:00:00.000Z');
    const noon = new Date('2025-03-10T12:00:00.000Z'); // same UTC day
    const txid = deriveTxid('order-1', morning);
    expect(txid).toBe(deriveTxid('order-1', noon));
    expect(txid).toMatch(/^po_[0-9a-f]{40}$/);
  });

  it('changes when the effective date changes', () => {
    const d1 = new Date('2025-03-10T00:00:00.000Z');
    const d2 = new Date('2025-03-11T00:00:00.000Z');
    expect(deriveTxid('order-1', d1)).not.toBe(deriveTxid('order-1', d2));
  });

  it('changes when the order changes', () => {
    const d = new Date('2025-03-10T00:00:00.000Z');
    expect(deriveTxid('order-1', d)).not.toBe(deriveTxid('order-2', d));
  });
});
```
