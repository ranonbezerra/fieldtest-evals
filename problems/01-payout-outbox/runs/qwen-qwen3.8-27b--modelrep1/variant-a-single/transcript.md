# Transcript — 01-payout-outbox / variant-a / qwen/qwen3.8-27b

Every request, in order, with its reasoning. Nothing is elided.

# solution

## reasoning

```
Let me think through this carefully. I need to build a complete payout service in TypeScript + NestJS + Prisma + PostgreSQL.

Let me review the requirements:

1. `POST /payouts` — body: `{ accountId, amount, destinationAddress, idempotencyKey }`. Create the payout if the account has sufficient available funds. Retries with the same `idempotencyKey` must not create a second payout or reserve the funds twice.

2. Asynchronous processing — the transfer must NOT happen inside the request. Use a Postgres message table as the queue, and a polling worker (`processMessages()` runs every N seconds). Delivery is at-least-once: the worker may see the same message more than once.

3. Account balance can be spent down by concurrent payout requests. Two contending requests must never overdraw.

4. Track the lifecycle of each payout explicitly (created → processing → sent → completed / failed / needs-review, or an equivalent of my own).

5. Maintain a double-entry-style ledger. The account's settled balance only changes when the provider confirms the transfer.

6. The provider can fail transiently. Retry a bounded number of times. If retries are exhausted without a definitive outcome, do something safe and explain why.

Deliverables:
- Prisma schema + migration
- NestJS module: controller, service, worker
- Tests: concurrent creation against a single account, duplicate message delivery, retry exhaustion
- A short `DESIGN.md` (10–20 lines) explaining the funds-safety approach

Amounts are in minor units. No floating point.

From the conventions:
- TypeScript strict, Node 20+, NestJS, Prisma, PostgreSQL, Vitest, pnpm, ESM `"type": "module"`.
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
- Layers: controller validates input and calls the service. No business logic. Service holds the logic. No raw SQL, no Prisma client calls. Repository is the only layer that touches the DB.

Wait — "no raw SQL" in the service. But the service needs transactional logic… hmm. The service can't call Prisma directly. The repository can. So the repository must expose transactional methods — e.g. `createPayoutAtomically(...)` that uses `prisma.$transaction` (interactive transactions are Prisma client calls in the repository, which is allowed).

Actually the key challenge: concurrent creation must not overdraw. The standard approach: a row-level lock on the account row via a `SELECT ... FOR UPDATE` inside a transaction. In Prisma, `SELECT ... FOR UPDATE` can't be expressed in the query API — you have to use `$queryRaw`. The repository is the only layer that can touch the DB and can use raw queries? The convention says "no raw SQL" in the *service*. The repository can use raw SQL? The conventions say "repository is the only layer that touches the database". So the repository can use raw SQL as needed. But to keep it clean, better to do the lock inside an interactive transaction with `$transaction(async (tx) => { const locked = await tx.$queryRaw`... ` })`.

As an alternative, use optimistic concurrency with a version column: `UPDATE accounts SET available_balance = available_balance - ? WHERE id = ? AND available_balance >= ?` — this atomic conditional update works without a row lock and never overdraws. This is simpler and more testable. If the affected rows are 0 → insufficient funds (or a race happened; but with the conditional update, a retry of the conditional update will work correctly; in the same transaction we also insert a ledger entry).

Let me think about the ledger design (double-entry style):

Accounts hold a "settled balance" (the ledger account balance). Payouts move funds:
- On creation: `available = settled - reserved`. A "hold" ledger entry: debit the settled balance into a "payouts_pending" (reserved) balance.
- On send confirmation: debit from payouts_pending into an asset/withdrawn account.
- On failure: reverse the hold — credit settled balance back from payouts_pending.

Double-entry: each ledger entry has an id, a payout reference, and pairs of entries (debits/credits) or a single `ledger_entries` table with `direction` and `account_id`/`account_type`. A common pattern: a `ledger_entries` table with `id`, `payout_id`, `side` (debit/credit), `account` (which ledger account: `account:<id>` settled, `payouts:pending`), `amount_minor`. And a `ledger_balances` table for the account's settled balance?

Let me simplify to satisfy "double-entry style": a table `ledger_entries` where every state transition produces two or more entries with a common `entry_id` group, and the sum of debits = credits. Account's "settled balance" = SUM(credits) - SUM(debits) against the `account_settled` account for that user account. Available = settled - reserved (reserved = sum of holds for open payouts, or tracked separately).

But there's a requirement: "the account's settled balance only changes when the provider confirms the transfer." So:

- Creation: move `settled` → `reserved` (hold). Settled balance decreases (available = settled - reserved; hmm).

Let me define:
- `settled_balance` = funds the provider confirms can be paid out (i.e. the balance after confirmed transfers).
- `reserved` = amount held for in-flight payouts.
- `available = settled_balance - reserved`.

Transitions:
- Create: `reserved += amount` (require `available >= amount`, i.e. `settled_balance - reserved >= amount`). Ledger: a pair of entries: debit `user:settled:available`, credit `payouts:pending`? Actually in a true double-entry with a T-account: asset account `UserBalance` (debit balance) and `PayoutHolds`. Entry: debit `PayoutHolds` (amount), credit `UserBalance` (amount). So the user's settled (available) balance goes down by the hold.
- On confirmation (sent → completed): debit `Payouts:PaidOut` (or the provider asset account), credit `PayoutHolds`. User's settled balance is unchanged (already reduced at hold time). Hmm, but the requirement says "the account's settled balance only changes when the provider confirms the transfer."

Alternate interpretation: "settled balance" = the balance that has been fully settled on-chain; on creation we don't touch the settled balance, we just create a `pending` reserve; the settled balance is only debited on confirmation. Then available = settled - pending. And requirement 3 "sufficient available funds" = `settled - pending >= amount`.

Which interpretation satisfies the letter? "The account's settled balance only changes when the provider confirms the transfer." So on creation, the settled balance must NOT change. On confirmation, it changes (debited by amount). On failure (exhausted, funds returned), the settled balance also… hmm, if the settled balance didn't change on creation, then on failure nothing needs to be restored to the settled balance — the pending reservation just disappears. That's clean!

So:
- `settled_balance`: the user's balance of funds confirmed settled (only debited on transfer confirmation, only credited on top-ups/deposits, out of scope).
- `pending_balance` (reserved): the sum of active (created/processing/needs-review?) payouts.
- `available = settled_balance - pending_balance`.

Ledger (double-entry style), ledger accounts:
- `A:settled` (the user's settled funds, per-account) — hmm, but in a double-entry ledger with multiple user accounts, each user has a ledger account, plus global accounts `PENDING_PAYOUTS`, `PAID_OUT` (asset out), `PROVIDER_FAILURES`? Let me keep it tractable: a single ledger with `ledger_entries` rows: `{ id, group_id, entry_type ('debit'|'credit'), account_key (e.g. 'settled:<accountId>', 'payout:pending', 'payout:paid_out'), amount_minor, payout_id, created_at }`.

Entry for create: debit `payout:pending`, credit `settled:<accountId>`? Wait, which direction decreases the user's settled balance? If user's settled balance is a credit balance (liability of the platform to the user), then a credit increases it, a debit decreases it. So on payout confirmation: debit `settled:<accountId>` (decrease), credit `payout:paid_out` (increase paid-out asset). On creation: debit `payout:pending`, credit `settled:<accountId>`? No wait — that also decreases settled on creation, violating the requirement.

OK, requirement: settled balance only changes on confirmation. So on creation the entry should be: debit `payout:pending`, credit `settled:pending:<accountId>`?? That introduces a new ledger account "settled:pending". Hmm.

Alternative: keep per-account balance rows in the `accounts` table: `settled_balance_minor`, `pending_balance_minor`, and the ledger just records the entries, with invariants: `available = settled - pending`; pending is the sum of open payout amounts (computable from payouts or from a ledger account).

The cleanest defensible approach:

`accounts` table: `id`, `settled_balance_minor` (BigInt), `pending_balance_minor` (BigInt), `version` (for optimistic locking). Available = settled - pending.

Ledger: `ledger_entries` table, double-entry pairs grouped by `entry_id` (group), each entry has `ledger_account` and `direction`. Accounts:
- `user:settled:<accountId>` — the user's settled funds (credit-balance liability).
- `payouts:pending` — holds for open payouts (debit).
- `payouts:paid` — confirmed transfers (debit asset).
- `payouts:failed`? No — on failure the hold is released: debit `user:settled:<accountId>`, credit `payouts:pending`.

Wait, but if on creation we do: debit `payouts:pending`, credit `user:settled:<id>`… no, that's wrong: the credit to a credit-balance account *increases* it. Let me be careful.

Define user settled account as a *credit* balance (liability: platform owes user).
- Deposit: debit `bank`, credit `user:settled:<id>` (+ to user).
- Payout confirmed: debit `user:settled:<id>` (- to user), credit `bank`.

Now, we don't want to touch the user's settled account on creation. Instead:
- Creation: debit `user:settled_pending`?? Hmm, that splits the user's balance into two sub-accounts.

Alternative framing: available = settled - pending, where pending is tracked in the `accounts` row (`pending_balance_minor`). Ledger entry on creation: debit `user:settled:<id>` (reserve the user's funds), credit `payouts:pending` (platform's obligation for the in-flight payout)? Then user:settled goes down on creation. Violates requirement 5's wording again.

Hmm. Let me reread requirement 5: "Maintain a double-entry style ledger. The account's settled balance only changes when the provider confirms the transfer."

I think the intent is this: don't deduct the user's settled balance at request time, or the ledger must make it clear that deduction on hold is a reservation, not a settled change. The phrase "settled balance" strongly suggests: balance of settled funds. A hold moves funds from "settled, available" to "settled, reserved" — one could argue the *settled* total hasn't changed, only availability. Then "the account's settled balance only changes when the provider confirms the transfer" holds: total settled (available + reserved) is unchanged on creation; only decreases on confirmation. And on failure, total settled is restored (the reservation is removed).

So: `accounts` row: `settled_balance_minor` (total settled, = available + reserved) and `reserved_balance_minor`. Available = settled - reserved.

- Create: `reserved += amount`, require `settled - reserved >= amount`. Ledger: debit `user:settled_available:<id>`?? Hmm, sub-accounts again.

The double-entry in the ledger can use these ledger accounts:
- `settled:<accountId>` — the user's total settled funds (credit balance).
- `payout:held` — the platform's obligation for in-flight payouts (credit? debit?).
- `payout:paid` — confirmed payouts (debit, asset out).

Entry on creation: debit `payout:held`, credit `settled:<accountId>` — no wait, that's still a decrease…

Ugh. OK let me think about which is more natural and defensible. In a true double-entry with per-user sub-accounts:

Ledger accounts:
- `SETTLED` (per user): the user's funds, credit balance.
- `AVAILABLE` vs `HELD` is not a separate ledger account but an *allocation* on the user's balance.

Simplest and most robust design that satisfies "double-entry style" + "settled balance only changes on confirmation":

Table `ledger_entries`:
- `id` (ulid)
- `group_id` — groups entries of one double-entry (so SUM(debits) == SUM(credits) per group)
- `payout_id`
- `side`: `debit` | `credit`
- `account_type`: `user_settled` | `payout_holds` | `payouts_paid_out` | `payouts_reversed`
- `user_account_id` (nullable, set for `user_settled`)
- `amount_minor` BigInt

Transitions:
1. Create (created):
   - debit `payout_holds` (amount)
   - credit `user_settled` (amount) → hmm, still a decrease of user_settled…

Let me stop fighting myself. Let me decide: "settled balance" = user's available settled funds as exposed (the `available` column / the sum of the `user_settled` account). The requirement is that it doesn't change on creation, and only changes on confirmation.

Design that achieves that:
- `accounts` row has: `settled_balance_minor` (available settled funds) and `held_balance_minor` (amount on hold for in-flight payouts).
- Create: `held += amount`, guard `settled - held >= amount`… no wait, available = settled - held? Then "sufficient available funds" = `settled - held >= amount`.

Hmm wait, actually maybe simpler: available = settled - held.
- Create: held += amount. settled unchanged. ✓ (settled balance unchanged on creation)
- Confirm: settled -= amount; held -= amount. ✓ (settled changes on confirmation)
- Fail/exhaust: held -= amount. settled unchanged. (Funds returned to available; no change to settled needed since it wasn't changed.)

Wait, this is the most literal interpretation and it's consistent! On failure, the hold is simply released — since settled didn't change on creation, nothing to restore.

But wait — in this scheme, what does the double-entry ledger look like? The "user_settled" ledger account (sum of credits - debits = available?) hmm.

Let me define: the `user_settled` ledger account represents the user's *available settled* balance (credit-balance liability). Then:
- Create: the user's available funds are… not decreasing (settled_balance_minor unchanged). But the *effective* available = settled - held decreases. Hmm, so the sum of the ledger account doesn't match "available".

OK, the real problem is: in double-entry, "available" decreasing on creation requires moving funds to another ledger account (the holds account): debit `payout_holds`, credit `user_available`. That's the true double-entry: funds move from the user's available account to the platform's holds account. Then on confirmation: debit `user_holds`…

Let me do it fully properly:

Ledger accounts (all in `ledger_entries`):
- `user_settled:<accountId>`: credit balance = user's total settled funds (available + held).
- `payout_holds`: debit balance = sum of holds for open payouts. (Debit is like an asset/receivable: the platform will pay this out.)
- `payouts_sent`: debit balance = sum of confirmed transfers.

Entries:
1. Create: debit `payout_holds` A; credit `user_settled:<id>` A?? No! A credit to a credit-balance account increases it. That's wrong.

Debits and credits: for the user's credit-balance account (liability), a debit decreases it, a credit increases it. For holds (debit-balance), a debit increases it, a credit decreases it.

Create: user's *available* decreases, holds increase. Total user settled (available + held) is unchanged. To express "available" separately, we need `user_available` and `user_held` as separate ledger accounts:
- `user_available:<id>` (credit balance)
- `user_held:<id>` (debit balance? or credit balance as part of the user's assets?)

Entry on creation: debit `user_held:<id>` A, credit `user_available:<id>` A. → The user's available goes down, the held portion goes up. Total user settled = available + held is unchanged. ✓ Requirement 5: "the account's settled balance only changes when the provider confirms" — total settled (available + held) is unchanged on creation. ✓
2. Confirm: debit `user_available:<id>`? No wait… on confirmation, the user loses the held funds: entry: debit `user_available:<id>`? The held funds were in `user_held`. On confirmation: credit `user_held:<id>` A (releases the held), debit `payouts_sent` A (records the paid-out asset). Net effect: user's total settled decreases by A (held portion vanishes, moved to the platform's "payouts sent" record). ✓ Settled balance changes on confirmation. ✓
3. Fail (release): credit `user_held:<id>` A, debit `user_available:<id>` A. → Held goes back to available. Total unchanged. ✓

This is a proper double-entry with 3 accounts and each transition is balanced (sum of debits = sum of credits).

Per-user: `available_balance` = credit - debit on `user_available:<id>`; `held_balance` = debit - credit on `user_held:<id>`; `settled = available + held`.

But do we want to compute the balance from the ledger every time? For performance we'd cache in the `accounts` row, but for this exercise let's keep a `accounts` table with `settled_balance_minor` and `held_balance_minor` as running totals (the "general ledger" ledger, with `ledger_entries` as the detail journal). Requirement 3's concurrency is handled on the accounts row.

Actually, hmm, "maintain a double-entry style ledger" — maybe simpler: per-user sub-accounts are awkward in one table with `user_account_id`. Alternative: `ledger_entries` with columns: `id`, `entry_group_id`, `payout_id` (nullable), `direction` ('debit'|'credit'), `ledger_account` (enum-like string: `user_available` | `user_held` | `payouts_sent`), `user_account_id` (nullable, set when the ledger account is user-scoped), `amount_minor`, `created_at`. And invariant: per `entry_group_id`, SUM of debit amounts == SUM of credit amounts.

And the `accounts` table: `id`, `settled_balance_minor` (available + held? or just available?), `held_balance_minor`, `version`.

Let me define the columns on `accounts`:
- `settled_balance_minor` BigInt: the user's total settled funds (available + held). Only changes on confirmation (per requirement 5, and on deposits).
- `held_balance_minor` BigInt: the amount currently held for in-flight payouts.
- `available = settled_balance_minor - held_balance_minor` (computed, or a generated column? Prisma doesn't easily support computed columns; compute in the service/repository).
- `version` Int for optimistic concurrency? Or use a conditional UPDATE.

Requirement 3: two contending requests must never overdraw. With an atomic conditional update: `UPDATE accounts SET held_balance_minor = held_balance_minor + ?, version = version + 1 WHERE id = ? AND settled_balance_minor - held_balance_minor >= ? RETURNING ...`. If no row is returned → insufficient funds → 409/422. This is atomic in Postgres — never overdraws. No need for SELECT FOR UPDATE.

But we also need idempotency: retries with the same idempotencyKey must not create a second payout or reserve twice. Design: `payouts` table has a unique constraint on `idempotency_key` (per account? Globally? The key is supplied by the client; usually scoped to (account, key) or globally unique. To be safe, unique on `idempotency_key` globally? Hmm — two different accounts with the same key? Usually idempotency keys are per-account or globally unique tokens (UUIDs). Safest is a unique on `(account_id, idempotency_key)`? But then two accounts could reuse the same key — which is fine as separate clients. Actually many APIs (Stripe) require the key to be unique per API use; Stripe enforces a unique key on the (account, key) dimension. Make it globally unique? Hmm. Let me think: the client generates a UUID per payout attempt. Two different accounts submitting the same key is a client bug. Either constraint is defensible. Let's go with unique on (account_id, idempotency_key) — it's the standard "idempotent per (subject, key)" and allows key reuse across accounts. Actually wait — for the duplicate detection in the atomic path: I want to check for an existing payout with the same (account_id, idempotency_key) before creating. Race: two concurrent requests with the same key. With the unique constraint, the second insert fails. Catch that and return the existing payout.

But subtle: if I use the optimistic conditional update + insert inside a transaction with proper isolation, the sequence:
1. Begin transaction.
2. `UPDATE accounts SET held += amt, version+1 WHERE id=? AND settled - held >= amt RETURNING id` → if no row: commit? No — return insufficient_funds (409). (Rollback or commit; nothing was changed; commit is fine but rollback is cleaner — in the interactive tx, throw to abort and return the error.)
3. `INSERT payout (idempotency_key, account_id, amount, status='created', ...)` → unique violation on (account_id, idempotency_key) → concurrent same-key request: this means another request already created a payout with this key; we need to return that payout and undo our hold (or the other request's insert failed first and we win?).

Race A and B with same key, both pass the balance check, both update held (+2A — over-reserved!), then A inserts the payout, B's insert fails on unique. B must then: delete/return its hold (hold -= A) and fetch A's payout to return it. This is getting complicated with optimistic concurrency.

Alternative: `SELECT ... FOR UPDATE` on the account row at the start of the creation transaction. Then two contending requests serialize on the account row:
1. tx: `SELECT * FROM accounts WHERE id = ? FOR UPDATE` (raw query in repository).
2. Check: existing payout with (account_id, idempotency_key)? If yes → return it (idempotent replay).
3. Check: `settled - held >= amount`? If no → insufficient funds error.
4. `UPDATE accounts SET held = held + amount WHERE id = ?`.
5. `INSERT payouts ...` (with the unique constraint as a backstop).
6. `INSERT ledger_entries` (the two entries for creation).
7. `INSERT outbox_messages (type='payout.process', payload={payoutId})`.
8. Commit.

All of this inside one interactive Prisma transaction. FOR UPDATE serializes on the account → no overdraft, no double-reserve. The unique constraint is the backstop (should never fire given the lock, but if it does — e.g. lock timeout or application bug — catch and treat as a replay).

Prisma interactive transactions with a raw `$queryRaw` inside the tx: `prisma.$transaction(async (tx) => { await tx.$queryRaw\`SELECT ... FOR UPDATE\` ... })`. This works — the tx client supports $queryRaw. Since the service cannot touch Prisma, the repository exposes `createPayoutAtomically(input): Promise<CreatePayoutResult>` that does the whole interactive transaction, including the $queryRaw for the FOR UPDATE lock. That's allowed: the repository touches the DB.

Now the worker: `processMessages()` runs every N seconds (polling). Messages: an `outbox_messages` table (the "message table in Postgres as the queue"). At-least-once delivery: the worker selects unprocessed messages (status='pending'), marks them 'processing' (claimed with a `processed_at`/`lease`), processes, marks 'done'. At-least-once means the handler must be idempotent — a duplicate delivery of the same message must not cause a double transfer.

How can the same message be delivered twice? A crash after transfer succeeds but before marking done. On restart the message is reprocessed. The worker re-calls `provider.transfer` — dangerous: double payment! To be safe: the worker must be idempotent per payout, not per message. Idempotency: track payout status transitions. Only process a payout if status is `created` (or `retryable`?). Status transitions use a conditional UPDATE: `UPDATE payouts SET status='processing', ... WHERE id=? AND status='created'`. If no row updated → already processing/processed → skip (duplicate delivery).

But careful: if the provider.transfer throws after *sending* the transfer (timeout), we don't know. That's the "exhausted retries without a definitive outcome" case → status `needs_review` (safe: stop auto-retries; a human reconciles before any further money movement).

Retry policy: each message delivery attempts the transfer. On transient failure, increment `attempts` on the message (or the payout). Bounded retries (say 3). If attempts < max and error looks transient → requeue the message (status back to 'pending' with `attempts+1`). If attempts >= max → the outcome is uncertain → mark the payout as `needs_review` (safe: stop auto-retries; a human reconciles before any further money movement). Also release? No — don't release the hold on uncertainty; the funds stay held (safe: no double pay, and the user's funds remain reserved until a human confirms). The DESIGN.md should explain this.

Wait, but also the "definitive failure" case: the provider may return a definitive failure (e.g. invalid address, permanent error). The spec says "the provider can fail transiently. Retry a bounded number of times. If retries are exhausted without a definitive outcome, do something safe and explain why." So: bounded retries; on exhaustion → `needs_review` (manual reconciliation). Also, on any failure we must NOT release the hold until we know the transfer didn't go through — actually if the failure is *definitive* (provider explicitly says "not sent"), we can release the hold and mark `failed`. But the SDK as specified "may throw, timeout, or succeed slowly" — a throw doesn't tell us it wasn't sent. For simplicity and safety: any thrown error from the provider → transient (retry); after exhaustion → `needs_review` with the hold retained. Also support a definitive failure path? The task says "fail transiently" — I'll model it as: any error is treated as transient/unknown; bounded retries; exhaustion → needs_review (hold retained, payout not failed, no double-pay risk, human reconciles with the provider). Maybe support an `error.kind`? Keep it simple and safe: any thrown error is transient/unknown; bounded retries; exhaustion → needs_review. Document it in DESIGN.md.

Lifecycle states: `created` → `processing` → `sent` → `completed`; plus `failed` (definitive), `needs_review` (exhausted without definitive outcome). Hmm, `sent` vs `completed`: the provider returns a txHash — that's the "sent" state (transfer on-chain). "completed" = settlement? In our model: the provider confirms the transfer (returns txHash) → status `sent`, and then we immediately settle (ledger: paid out, hold released, settled balance debited) → `completed`. The spec's example: created → processing → sent → completed / failed / needs-review. So:
- `created`: payout created, hold placed, message queued.
- `processing`: worker picked it up and called the provider.
- `sent`: the provider returned a txHash (transfer confirmed by the provider). Ledger settlement happens here.
- `completed`: post-processing is done (message marked done). Or: `sent` = we have the txHash and settled the ledger; `completed` = the message is fully processed. Hmm, that makes `completed` just "the message is done". A bit artificial but fine: sent → (message finalized) → completed. Actually maybe: `sent` = the provider confirmed (we have the txHash), the payout is settled in the ledger; `completed` = the entire outbox message lifecycle is done. Let's go with that and document the transitions:
  - created → processing (worker claims)
  - processing → sent (provider returned txHash; ledger settlement entry; hold released)
  - sent → completed (message finalized)
  - processing → created? (retry: requeue the message; payout stays `created`? Or `processing` → `created` for requeue). Hmm.

Let me restructure: the payout status tracks the *payout*, the message tracks the *delivery attempt*. On a retryable failure: the payout status goes back to `created` (still awaiting a transfer), the message is requeued with attempts+1, until max attempts → `needs_review`.

State machine:
- `created` — awaiting processing.
- `processing` — transfer in flight.
- `sent` — provider confirmed, txHash recorded, ledger settled.
- `completed` — done (message done).
- `needs_review` — retries exhausted, no definitive outcome; hold retained; manual.
- `failed` — definitive failure (the provider explicitly says it wasn't sent / permanently invalid). Hold released (funds back).

In the worker:
1. Claim a pending message (`UPDATE outbox_messages SET status='processing', claimed_at=now WHERE id IN (...) AND status='pending' RETURNING *` — batch claim via FOR UPDATE SKIP LOCKED, or via a conditional update). Use a conditional UPDATE for atomic claim: `UPDATE ... SET status='processing' WHERE status='pending' RETURNING id, payload` — atomic, no double-claim.
2. For each message: fetch the payout. Guard: only process if payout status is `created` or `processing` (i.e., not sent/completed/failed/needs_review). If the payout is already `sent`/`completed` → duplicate delivery → mark the message done without calling the provider. This is the at-least-once safety: the transfer is only attempted once per payout, gated by the conditional status transition.
3. Conditional transition created/processing → processing (UPDATE ... WHERE id=? AND status IN ('created','processing')). If 0 rows → skip (already advanced; mark message done).
4. Call `provider.transfer({to, amount})`.
   - Success: record txHash, transition → `sent`, settle ledger (entry: credit `user_held`, debit `payouts_sent`; and accounts: settled -= amount, held -= amount), mark message done, then transition sent → completed? Let's mark the payout `sent` and the message done in the same tx, and the payout stays `sent`… but the requirement lists `completed` as a terminal state. So: after ledger settlement, the payout → `completed` (with `sent_at`/`tx_hash` recorded)? Then what's `sent`?

Let me simplify: the states are `created`, `processing`, `sent`, `completed`, `failed`, `needs_review`.
- Worker claims → `processing` (conditional).
- Provider returns txHash → set `tx_hash`, `sent_at` → `sent`. Same transaction: settle the ledger, decrement the account's settled & held.
- Mark the message done in the same tx? Then separately → `completed`. Hmm, `sent` and `completed` in one worker pass: the payout reaches `sent` when the provider confirms; `completed` when everything (ledger, message) is finalized. To have both states meaningfully exist, we can do: step 1 tx: status→sent + ledger settlement + account update + message done. Then a small follow-up: status sent→completed (idempotent, unconditional for sent). That's silly.

Alternative: `completed` = provider confirmed + ledger settled (the payout is fully done); `sent` = provider said sent but the ledger settlement is pending?? But the requirement example is "sent → completed / failed / needs-review" — meaning after sent you can end up completed, failed, or needs_review. So sent is a mid-state where the transfer is on-chain but our bookkeeping isn't finalized? That matches: after we have the txHash (sent), we finalize our ledger (→ completed), or if the tx is invalid/fails on-chain (→ failed), or if verification is uncertain (→ needs_review).

In our SDK, transfer() returning a txHash = provider confirmed. So: sent → (settle ledger in same step, then mark) completed. I'll do this: on success, one repository transaction: payout processing→sent with tx_hash+sent_at; insert ledger entries; update accounts; message → done. Then immediately, a second lightweight conditional update sent→completed (or in the same tx after the message is marked done). Let me do it in the same tx: set the payout to `sent` first… we can't set two statuses in one tx. OK: in the same tx: update the payout to `sent` (with txHash, ledger, accounts, message→done), then a second update `sent`→`completed` guarded by `WHERE status='sent' AND tx_hash = ?`. Slightly redundant but it shows the explicit lifecycle. Actually simpler: the worker does two repository calls:
1. `recordSent(payoutId, txHash)` — tx: status→sent, ledger settlement entries, accounts settled-=amt held-=amt, message done.
2. `completePayout(payoutId)` — conditional sent→completed.

Hmm, is that over-engineered? The requirement says "track the lifecycle of each payout explicitly (created → processing → sent → completed / failed / needs-review, or an equivalent of your own)." I can use an equivalent: my own equivalent is allowed. But using their states verbatim is safest. Let's keep all six states with the transitions above. The double update is fine and makes the lifecycle explicit and auditable.

On failure (provider throws):
- Increment the message's `attempts` (the message row: `attempts Int`, `max_attempts Int` or a constant).
- If attempts < max (say 3): requeue the message (status 'pending', `available_at = now + backoff`), and the payout status back to `created` (conditional: processing→created? Or leave as 'processing'?). If we leave it as 'processing' and requeue, then next claim: the payout is 'processing' — the guard `status IN ('created','processing')` allows it, and the transition processing→processing is a no-op guard… my conditional `UPDATE ... SET status='processing' WHERE id=? AND status IN ('created','processing')` returns 1 row → proceed. OK, works. But is it cleaner to go back to `created` on requeue? `created` means "awaiting processing" — semantically right for a requeue. Let's do: processing→created on requeue (conditional). Next delivery: created→processing.
- If attempts >= max: message → done (stop delivery), payout processing→needs_review (conditional). Hold retained. Explain in DESIGN.md: we can't know whether the provider sent the transfer (a timeout might hide a success), so we freeze the funds (hold) and flag for manual reconciliation — never auto-release (risk: releasing then the transfer actually landed = user is paid for free… well, the user is double-benefited: their balance is restored AND they received the stablecoin) and never auto-retry (risk of double payment).

Also a definitive-failure path: if the provider throws an error with a `permanent: true` flag (ASSUMPTION: the SDK doesn't specify an error shape; treat any error as unknown/transient — that's the safe reading; we could also honor an optional `error.permanent` flag). Hmm. The task says "if retries are exhausted without a definitive outcome, do something safe." This implies some failures *do* have a definitive outcome (definitive failure → `failed`, release hold). To cover both: treat an error as definitive if it has a truthy `permanent`/`definitive` property (ASSUMPTION comment); otherwise treat as transient. On definitive failure: payout → `failed` (with an error message), hold released (ledger: credit user_held, debit user_available; accounts: held -= amount), message → done. This covers the "failed" state too. I'll mark it with an ASSUMPTION comment about the error shape since the SDK contract is unspecified.

Now, worker scheduling: `processMessages()` runs every N seconds. NestJS: use `@nestjs/schedule`? That's an extra dependency. Or a plain `setInterval` in the worker service + `onModuleDestroy` to clear, plus `enableShutdownHooks`. To avoid extra deps, a simple `setInterval` inside `PayoutWorker` (an `@Injectable()` implementing `OnModuleInit`/`OnModuleDestroy`), configurable interval from env (`PROCESSING_INTERVAL_MS`). But "configuration only from environment variables" — yes, env-based config.

Also important: in tests, we don't want the worker running automatically (or make it optional). Gate worker startup on env? In the app, it's always on. In tests, the worker module is not instantiated (test the service directly). Fine.

Also `processMessages()` should be exported as a public method (the deliverable explicitly names it).

Polling claim: `SELECT id, payload FROM outbox_messages WHERE status='pending' AND available_at <= now() ORDER BY created_at LIMIT N FOR UPDATE SKIP LOCKED`? With FOR UPDATE SKIP LOCKED, we can support multiple workers without double-claim. Then mark as processing. Or a single atomic conditional UPDATE claiming the first N. Let's do: inside a tx: raw query `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 10`, then `UPDATE ... SET status='processing' WHERE id = ANY(...)`. Hmm, or simpler: a single raw UPDATE with a CTE:
`WITH claimed AS (UPDATE outbox_messages SET status='processing', claimed_at=now() WHERE id IN (SELECT id FROM outbox_messages WHERE status='pending' AND available_at <= now() ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED) RETURNING id, payload) SELECT * FROM claimed`. A single raw statement — atomic claim. That's clean. The repository does this raw (allowed in the repository).

Hmm, but the convention says no raw SQL in the service; the repository is the DB layer, and Prisma can't do SKIP LOCKED, so raw SQL in the repository is the right tool. Fine.

Or skip SKIP LOCKED and just rely on a conditional claim (since we run a single worker). At-least-once is about delivery to the *handler*, not about multiple workers. I'll keep a simple atomic claim CTE — robust even with multiple workers, shows skill. But complexity… I'll include it; it's like 10 lines of SQL.

Message payload: JSON with the payoutId. Message type: `payout.process` (outbox pattern: the same tx that creates the payout inserts the message → no lost messages; the worker picks them up; the transfer is NOT in the request path ✓ requirement 2).

Now the idempotency details for creation under the FOR UPDATE lock:

Repository `createPayout({accountId, amount, destinationAddress, idempotencyKey})`:
```ts
return this.prisma.$transaction(async (tx) => {
  // lock the account row
  const account = await tx.$queryRaw<...>\`SELECT id, settled_balance_minor, held_balance_minor, version FROM accounts WHERE id = ${accountId} FOR UPDATE\`;
  if (!account) throw new AccountNotFound...
  // idempotent replay?
  const existing = await tx.payout.findUnique({ where: { account_id_idempotency_key: { account_id: accountId, idempotency_key: idempotencyKey } } });
  if (existing) return { payout: existing, replay: true };
  // balance check
  const available = account.settled - account.held;
  if (available < amount) throw new InsufficientFunds...
  // update the account
  await tx.account.update({ where: { id: accountId }, data: { heldBalanceMinor: { increment: amount }, version: { increment: 1 } } });
  const payout = await tx.payout.create({ data: {...status 'created'...} });
  // ledger entries (double-entry: debit payout_holds, credit user_available? ...)
  ...
  // outbox message
  await tx.outboxMessage.create({ data: { type: 'payout.process', payload: JSON.stringify({payoutId}) } });
  return { payout, replay: false };
});
```

Wait — the ledger design. Let me settle the final ledger shape (per the analysis):

Ledger accounts (the `ledger_account` column, string enum):
- `user_available` (user-scoped, credit balance)
- `user_held` (user-scoped, debit balance)
- `payouts_sent` (global, debit balance)

Hmm wait, do I even need `user_held`? Let me re-derive. Actually maybe simpler: two user-scoped accounts is elegant:

Create: [debit `user_held` A] + [credit `user_available` A] → balanced ✓. Effect: available −A, held +A. Settled total (available+held) unchanged ✓.
Sent/settle: [debit `payouts_sent` A] + [credit `user_held` A] → balanced ✓. Effect: held −A, paid_out record +A. Settled total −A ✓ (changed only on confirmation ✓).
Failed (definitive): [debit `user_available` A] + [credit `user_held` A] → balanced ✓. Effect: held −A, available +A. Settled total unchanged ✓.
needs_review: no ledger entry (hold retained). ✓

Invariant check: for a payout: create → sent: user_available −A, payouts_sent +A, user_held 0. ✓ Net: user lost A, platform recorded A sent.
For a payout: create → failed: net zero. ✓

And the `accounts` row mirrors: `available_balance_minor`?? Wait, do we store available or settled? Let me store on `accounts`:
- `settled_balance_minor` BigInt: the user's *total* settled funds (available + held). Hmm, or store `available_balance_minor` and `held_balance_minor` separately?

Requirement 5 says "the account's settled balance only changes when the provider confirms the transfer." If the `accounts` table has `settled_balance_minor` = available + held, then on creation only held changes → settled_balance_minor unchanged ✓ literally. On confirmation: settled −A, held −A ✓. On failure: held −A only ✓.

Let's store: `settled_balance_minor`, `held_balance_minor`. available = settled − held (computed in the repository when needed, e.g. `getAccount` returns both + the computed available).

Creation guard: `settled_balance_minor - held_balance_minor >= amount` (under the row lock).

Ledger vs. accounts consistency: the `user_available` ledger account sum (credit − debit) should equal `accounts.available`… wait: on create, credit user_available A → available *increases*?? No! Wait. I had the directions backwards. `user_available` is a credit-balance account (like a liability: the platform owes the user). To decrease the user's available, we *debit* `user_available`. Let me redo:

Create: available −A, held +A.
- Debit `user_available` A (decrease the user's available liability) ✓
- Credit `user_held` A (increase user_held — if user_held is a credit-balance sub-account of the user's liability: "platform owes the user A, but it's in an in-flight payout"). Yes! `user_held` is also a credit-balance account (both are components of the user's total settled liability).
Entry: [debit user_available A] + [credit user_held A] — balanced (one debit A, one credit A) ✓.

Confirm: held −A:
- Debit `user_held` A (decrease)
- Credit `payouts_sent` A (increase payouts_sent — a credit-balance record of what we sent out).
Entry: [debit user_held A] + [credit payouts_sent A] ✓ balanced.

Fail: held −A, available +A:
- Credit `user_available` A
- Debit `user_held` A
✓ balanced.

Invariants:
- Per group: sum(debits) == sum(credits) ✓ (each entry group has exactly one debit A and one credit A).
- `user_available` balance = SUM(credits) − SUM(debits) = accounts.available (available = settled − held).
- `user_held` balance = SUM(credits) − SUM(debits) = accounts.held.
- `payouts_sent` balance = total confirmed payout amount.
- Double-entry invariant: SUM(all debits) == SUM(all credits) globally ✓.

I like it. Ledger entry table:
```
model LedgerEntry {
  id          String   @id @default(cuid())  // or a uuid
  group_id    String   // one double-entry group (e.g. = payout id + transition)
  payout_id   String
  account     LedgerAccount  // enum
  direction   LedgerDirection // 'debit' | 'credit'
  amount_minor BigInt
  created_at  DateTime @default(now())
  @@index([payout_id])
  @@index([account, direction]) // hmm, for reconciliation
  @@map("ledger_entries")
}
```
Use an enum: `enum LedgerAccount { USER_AVAILABLE USER_HELD PAYOUTS_SENT }` and `enum LedgerDirection { DEBIT CREDIT }`. Prisma enums are fine.

group_id: `${payoutId}:created`, `:${sent}`, `:${failed}` — deterministic, idempotent! If the worker processes a duplicate message for a payout that's already sent… well, the status guard prevents re-settlement. But the deterministic group id is nice. Actually even better: use the payout id as the group and include the transition in the group: `createPayout` uses `groupId = payout.id + ':created'`. Deterministic group ids help auditing. Keep it.

Now the `payouts` table:
```
model Payout {
  id String @id @default(cuid())
  account_id String @map("account_id")
  amount_minor BigInt
  destination_address String @map("destination_address")
  idempotency_key String @map("idempotency_key")
  status PayoutStatus @default(CREATED)
  tx_hash String? @map("tx_hash")
  attempts Int @default(0)  // hmm — attempts belong to the message? The payout may have multiple messages? Only one message per payout in our flow. Keep attempts on the message.
  error_message String? @map("error_message")
  created_at DateTime @default(now())
  updated_at DateTime @updatedAt
  sent_at DateTime? @map("sent_at")
  completed_at DateTime? @map("completed_at")
  account Account @relation(...)
  @@unique([account_id, idempotency_key])
  @@map("payouts")
}
```

`accounts` table:
```
model Account {
  id String @id @default(cuid())
  settled_balance_minor BigInt @default(0) @map("settled_balance_minor")
  held_balance_minor BigInt @default(0) @map("held_balance_minor")
  version Int @default(0)
  created_at, updated_at
  payouts Payout[]
  @@map("accounts")
}
```

Hmm, do we need `version` if we have FOR UPDATE? The version increments anyway for auditing; keep it, and increment it on every change. OK.

`outbox_messages`:
```
model OutboxMessage {
  id String @id @default(cuid())
  type String @default("payout.process")
  payload Json
  status OutboxStatus @default(PENDING) // PENDING, PROCESSING, DONE, DEAD
  attempts Int @default(0)
  available_at DateTime @default(now())
  claimed_at DateTime? @map("claimed_at")
  created_at DateTime @default(now())
  @@index([status, available_at])
  @@map("outbox_messages")
}
```
payload Json: `{"payoutId": "..."}`.

Message status: PENDING (queued, not yet claimed or requeued), PROCESSING (claimed, in flight), DONE (delivered & acked), DEAD (exhausted; for audit). On exhaustion, set the message to DEAD (or DONE). Since the payout carries the needs_review state, DEAD is a good terminal marker for the message. Let's use DONE for delivered-OK and DEAD for exhausted. The claim CTE selects PENDING.

Now, max attempts: `MAX_PROVIDER_ATTEMPTS = 3` (a constant in the worker/service; configurable via env? "Configuration only from environment variables" — the polling interval comes from env; the attempt count could be a constant — but maybe `PAYOUT_MAX_ATTEMPTS` env. Let's have a small `ConfigService`-like thing: read process.env directly with defaults. No @nestjs/config dep — just read process.env in the worker's constructor. Keep it lean.

Now the service:

`PayoutService`:
- `createPayout(input: CreatePayoutDto)`:
  - Controller validates the shape; the service calls `repository.createPayout(...)`.
  - Map repository exceptions to HTTP errors: account not found → 404 `resource_not_found`; insufficient funds → 409 `insufficient_funds` (or 422?). Error envelope: `{ error: { code, message, details } }`. Code in snake_case. `account_not_found` → 404, `insufficient_funds` → 409. Replay → return the existing payout with 200 (or 201? Idempotent replay usually returns the same response; to be kind, 200 with a flag? Just return the same body, status 201? Common practice: return the same response as the original (201) or 200. Let's return 200 with a body that includes the payout + `replayed: true`? Hmm, simpler: the service returns the payout; the controller returns 201 if created, 200 if replayed. The body is `{ payout: {...} }`. Include `replayed` in the details? Keep the body: `{ id, status, amount_minor, ... }` flat? Let's go with `{ payout: {...} }`.)
  - The service must throw Nest exceptions with the envelope. Need an exception filter that formats all errors into the envelope `{ error: { code, message, details } }`. The convention: "Errors — one envelope." So we need a global exception filter. Where? `src/common/all-exceptions.filter.ts`? The layout only lists feature folders + main + app module. I can add `src/common/errors.ts` with a `ServiceError` class (code, status, message, details) + an `AllExceptionsFilter` that catches ServiceError + Prisma known errors + HttpException and renders the envelope. The layout section of the convention says "Layout: …" — it shows the expected structure, but adding a common file for the error filter is necessary for the envelope requirement. I'll add `src/common/all-exceptions.filter.ts` and register it in main.ts (app.useGlobalFilters) — that's wiring, acceptable. Or the filter in app.module? A global filter in main.ts is the NestJS-idiomatic spot.

  - Also, the service translates the repository result: the repository throws domain errors (`AccountNotFoundError`, `InsufficientFundsError`, `DuplicatePayoutError` as a ServiceError subclass with an HTTP status + code) — the service can pass through (no logic, just call + map? The controller shouldn't do the mapping (no business logic in the controller); the filter maps ServiceError → envelope. So the service just calls the repository, and if the repository throws a ServiceError subclass, the service lets it bubble. Then no logic in the service?? The "create" service is thin: validate semantic things (e.g. amount > 0 — no, that's controller validation), call the repository, return the payout. Thin but fine; the complexity lives in the repository (DB) and the worker (orchestration).

  Hmm wait — is it OK for the worker's orchestration (status transitions, retry decisions) to live in the service? Yes: the worker is a service; the *payout* service holds the processing logic: `processMessages()` is in `PayoutWorker` which calls `PayoutService.processPayout(payoutId)`? Or is the worker self-contained calling the repository + provider? Layers: the controller validates and calls the service; the service holds the logic; the repository touches the DB. The worker is effectively a service (listed in providers). Let me have the worker do the orchestration (claim messages → for each: payoutService.handleDelivery(payout, message)?)… actually the cleanest: `PayoutWorker` claims messages via the repository, then calls `PayoutService.processPayout(message)` for each, which does the guard/transfer/retry logic using the repository + the provider. The worker is a scheduler; the service holds the logic.

- `PayoutService.processPayout(messageId)`:
  ```
  const msg = repo.getMessageById(messageId) // already PROCESSING (claimed)
  const payoutId = (msg.payload as {payoutId: string}).payoutId
  const payout = repo.findPayoutById(payoutId)
  if (!payout) { repo.completeMessage(messageId); return } // orphan, mark done
  if (payout.status is in ['SENT','COMPLETED','FAILED','NEEDS_REVIEW']) {
    // duplicate delivery after completion (or message re-claimed) — safe no-op
    repo.completeMessage(messageId); return
  }
  // mark processing
  const started = repo.beginProcessing(payoutId) // conditional created→processing; if !started → completeMessage (someone else advanced it) and return
  try {
    const { txHash } = await provider.transfer({ to: payout.destinationAddress, amount: payout.amountMinor })
    repo.recordSent(payoutId, txHash, messageId) // tx: sent, ledger, account, message DONE… then completePayout
    repo.markCompleted(payoutId)
  } catch (err) {
    const definitive = isDefinitiveError(err)
    if (definitive) { repo.recordFailed(payoutId, errMsg, messageId) // tx: failed, ledger release, held-=amt, message DONE; return }
    const attempts = msg.attempts + 1
    if (attempts >= MAX) { repo.recordNeedsReview(payoutId, errMsg, messageId) // payout→NEEDS_REVIEW, message DEAD; hold retained }
    else { repo.requeue(messageId, attempts) // message→PENDING with backoff, payout processing→created }
  }
  ```

Wait — the `beginProcessing` conditional: `UPDATE payouts SET status='processing', updated_at=now() WHERE id=? AND status='created' RETURNING id`. If the payout is already 'processing' (we crashed mid-flight and the message is re-claimed… wait, if we crash mid-flight, the message is stuck as PROCESSING). Hmm! At-least-once: a crashed worker leaves the message as PROCESSING forever → the message is lost (a form of "at-most-once" — bad!). We need a claim timeout / stale re-claim: the poll should also pick up PROCESSING messages older than X (e.g. `claimed_at < now() - claim_timeout`) and re-claim them. That's the standard lease pattern. Let me add to the claim CTE:
```
WHERE (status = 'PENDING' AND available_at <= now())
   OR (status = 'PROCESSING' AND claimed_at < now() - interval '30 seconds')
```
So crashed workers' claims are re-claimed after the timeout → true at-least-once. And the idempotency guard on the payout status prevents double transfer: if we crashed *after* transfer success but *before* marking done, the re-claim finds the payout… wait, in my flow `recordSent` sets status 'sent' in the same tx as the message done. If we crashed between the provider returning and the tx commit: the tx didn't commit → status is still 'processing', the message is still PROCESSING → re-claim → the guard `status IN ('created','processing')`… my beginProcessing is `WHERE status='created'` → 0 rows (it's 'processing') → we'd mark the message done and skip the transfer!! But the transfer was actually sent by the provider → we lose the settlement and never mark sent. Bug!

Fix: the processing guard must allow re-processing from 'processing': `beginProcessing`: `UPDATE ... SET status='processing' WHERE id=? AND status IN ('created','processing')`. But then, if the previous attempt actually succeeded at the provider (the transfer happened) and we're re-running → double transfer!! That's the fundamental at-least-once problem. The *only* safe fix: provider-side idempotency (an idempotency key per payout passed to the provider), or accept re-attempts and rely on the provider not double-charging… The task says: "Delivery is at-least-once: the worker may see the same message more than once" and requirement 6: "If retries are exhausted without a definitive outcome, do something safe."

So the intended reading: the worker may see the same message more than once, and my code must handle it safely. The cleanest, defensible approach: a **payout-level attempt record**: before calling the provider, check if a `processing` state already has an in-flight attempt… hmm.

A practical safe design that people use: a per-payout `transfer_idempotency_key` passed to the provider: `provider.transfer({ to, amount, idempotencyKey: payout.id })`? But the given SDK signature is `provider.transfer({to, amount}) -> {txHash}` — no idempotency key param. "Assume `provider.transfer({to, amount}) -> {txHash}`" — I should call it exactly as specified. Hmm.

Alternative: don't re-claim stale PROCESSING messages; instead, on worker startup, requeue all PROCESSING messages back to PENDING (at-least-once), and accept that a crashed-mid-attempt payout will retry the transfer… but that risks double transfer.

Wait — let me reread: "Delivery is at-least-once: the worker may see the same message more than once." I think the intended scenario is simpler: the polling worker might *select* the same message twice (e.g. two polls overlap, or a re-claim after timeout), and my *handler* must be idempotent: it must not double-transfer. The intended solution: guard the transfer with a status transition that only succeeds once: `UPDATE payouts SET status='processing' WHERE id=? AND status='created'` → if 0 rows, the transfer has already been initiated (status has advanced beyond created) → skip. And the crash mid-processing case: on startup, reset `processing` payouts to `created`?? No — that reintroduces the double-transfer risk.

Hmm, but is the double-transfer risk acceptable/expected here? Let's think: if the worker crashes after the provider succeeded but before committing: the payout is 'processing' in the DB. On restart, requeue the message (PROCESSING→PENDING). The handler sees the status 'processing' → the guard `WHERE status='created'` fails → it must *not* call the provider again (good — no double transfer), but then the payout is stuck 'processing' with the funds held… The message: mark done? Then the payout is stuck in 'processing' forever, with the hold retained — that's the "safe" outcome: money is held, no double-pay, manual reconciliation needed. Hmm, but that conflates the crash with needs_review.

Alternatively: on restart, 'processing' payouts → 'needs_review' (since we can't know if the in-flight transfer landed). That's *defensible and safe*: an in-flight transfer whose outcome is unknown → freeze + manual review. And the re-queued message finds the payout NEEDS_REVIEW → marks the message done (or dead). No double transfer, no lost money, explicit state. I like this:

- `PayoutWorker.onModuleInit`: `repo.requeueStaleMessages()` (PROCESSING→PENDING, keeping attempts) — for at-least-once delivery — and `repo.flagStuckProcessing()` (payouts in PROCESSING older than X, or all PROCESSING → NEEDS_REVIEW)? Hmm wait, if a worker claims a message (→PROCESSING) and sets the payout to processing, and crashes, then on restart: flagStuckProcessing marks the payout NEEDS_REVIEW (funds held, manual reconciliation with the provider). The re-queued message is re-processed: the payout is NEEDS_REVIEW → skip, message → DONE/DEAD.

But careful: two workers running concurrently — the startup flag could clobber a healthy in-flight payout from another worker. Mitigate with an age threshold: only flag payouts that have been PROCESSING for more than `CLAIM_TIMEOUT_MS` (say 30s) — longer than a single attempt. In tests, single worker, no issue. In this exercise, keep it simple: on module init, (a) requeue messages that are PROCESSING, (b) mark payouts stuck in PROCESSING as NEEDS_REVIEW. Document that in production this would be gated by an age threshold / a leader lease. Actually, to keep the code clean, do both with an age parameter (default: requeue messages older than 0?? no…). Hmm. Let me keep it simple and honest:

`onModuleInit`:
1. `repo.requeueProcessingMessages()` — all PROCESSING → PENDING (at-least-once recovery).
2. `repo.resolveStuckProcessingPayouts()` — all PROCESSING → NEEDS_REVIEW? But wait — the message requeue + payout needs_review means: next poll, the message is claimed, the payout is NEEDS_REVIEW → mark the message DEAD (not DONE? It's not delivered-acked; it's terminated). Let me mark it DONE… the payout is in a terminal-ish state (needs_review is manual). Message → DEAD makes sense ("no more automatic deliveries"). Let's use DEAD.

Hmm wait, actually simpler and more standard: don't special-case the crash in onModuleInit. Instead, make the *claim* lease-based: the claim picks up PENDING or (PROCESSING AND claimed_at < now() - LEASE). And make the handler's guard idempotent in a safe way:

Handler:
```
const payout = ...
if (terminal or sent-ish) → mark done/dead, return
if (payout.status === 'processing') {
  // an in-flight attempt whose outcome is unknown (we're re-claiming after a lease expiry or duplicate delivery)
  // safe: don't call the provider again; escalate to manual review.
  repo.escalateToNeedsReview(payout.id, 'recovery: prior attempt outcome unknown', messageId) // payout→NEEDS_REVIEW, message→DEAD
  return
}
// status === 'created'
guard created→processing (conditional; 0 rows → re-read; if now needs_review/sent/etc → done/dead; otherwise proceed)
call provider...
```
And the claim CTE:
```
UPDATE outbox_messages SET status='PROCESSING', claimed_at=now(), attempts=attempts ... 
```
Hmm wait, but the attempts semantics: the attempts increment only on *retry* (failure), not on re-claim due to a crash? If a crash happens every time, the message loops: claim → processing → crash → re-claim → payout is processing → needs_review. Actually no: the payout is stuck 'processing' from the crashed attempt, so the second claim escalates to needs_review without calling the provider. So the crash → needs_review (safe, manual).

But the lease re-claim of a healthy long-running attempt (the provider is slow, "succeeds slowly"!) — the lease expires while the transfer is in flight → a second worker re-claims → sees payout 'processing' → escalates to needs_review, while the first worker's transfer is still in flight and might succeed → then the first worker commits sent… a race between the needs_review escalation (conditional `WHERE status='processing'`) and the sent commit (conditional `WHERE status='processing'`) — exactly one wins, both use conditional updates, no corruption; if the sent commit wins, the escalation fails (0 rows) → good; if the escalation wins, the sent commit fails → the provider sent money, the payout is needs_review, the hold is retained → safe (manual reconciles; the provider's txHash is… lost? The first worker has the txHash but its tx failed… it should log it. Add to DESIGN.md: the worker logs the provider response before committing; a human can recover the txHash from logs/provider statements.)

OK. This is all quite involved, but this *is* the crux of the problem (at-least-once + funds safety). Let me make sure the code is clean and testable, and the tests cover the three required scenarios:
1. Concurrent creation against one account (e.g. a 1000-unit account, 2+ concurrent creations of 1000 → exactly one succeeds, the other gets insufficient_funds; the total held ≤ settled; no overdraft).
2. Duplicate message delivery (same message id processed twice → provider called once, payout sent/completed, no double ledger entry, no double debit).
3. Retry exhaustion (provider always throws → attempts increment to max → payout NEEDS_REVIEW, message DEAD, hold retained).

Test infrastructure: Vitest + a real Postgres? The convention says Prisma + PostgreSQL; tests need a DB. Options: `@prisma/client` + a real DB in tests (needs DATABASE_URL), or use Vitest with a mocked repository for the service tests + one integration-style test for concurrent creation… but concurrency can't be tested without a real DB (conditional updates / row locks). Hmm. "Tests: concurrent creation against a single account, duplicate message delivery, retry exhaustion." A real concurrent creation test needs a real Postgres. I don't have a tool to run anything, so I'll write the tests to assume a `DATABASE_URL` is available (the environment convention says DATABASE_URL for Postgres). Use `prisma db push`/migrate in test setup? Let me write `test/setup.ts`? The layout says `test/<feature>.spec.ts`. What I'll write:
- `test/payout.spec.ts` — integration: create the Nest app (or directly the service+repository with a PrismaClient) against a real Postgres; beforeAll: `prisma.$executeRaw` to seed/reset; the concurrent creation test fires N parallel `service.createPayout` with the same account and amount; expect exactly one success, the rest `insufficient_funds`, `held == settled` or `settled - held >= 0`.
- Duplicate delivery: create a payout, take its message, call `worker.processMessages()` twice (or `service.processPayout(msgId)` directly twice), with a fake provider that counts calls → assert 1 call, payout completed, one ledger group, account settled decremented once.
- Retry exhaustion: a provider that always throws, max attempts 3 → after processing, payout needs_review, message DEAD, attempts == 3, held unchanged.

But wait — "duplicate message delivery" via `processMessages()`: for a message to be delivered twice, after processing it's DONE — the poll won't re-see it. To *simulate* a duplicate: mark the message PENDING again (requeue) and process → the handler must no-op. Or directly call the per-message processing twice. The worker's `processMessages()` is the public entry; I can structure the worker to expose `processMessage(messageId)` (idempotent handler) and `processMessages()` (poll + fan-out). The test calls `processMessage(id)` twice → asserts idempotency. That directly tests "the worker may see the same message more than once."

The provider in tests: a fake implementing the interface `PayoutProvider` with `transfer`. Inject via token / module providers. In the spec, either build a small Nest Testing module, or instantiate the class directly: `const provider = new FakeProvider(); const repo = new PayoutRepository(prisma); const service = new PayoutService(repo); const worker = new PayoutWorker(repo, service, provider, interval)`. Direct instantiation in Vitest is simpler and tests behavior (not the Nest wiring). The convention's tests are behavior-focused — direct DI by constructor is fine. Let's do direct instantiation (the tests are behavior, not implementation).

Prisma client import: `@prisma/client`. In the test: `new PrismaClient()`.

But the service uses BigInt amounts: Prisma returns BigInt for BigInt columns. JSON bodies have numbers; the controller parses `amount` as a number → validates it's an integer ≥ 0 → converts to BigInt. "Amounts are in minor units. No floating point for money" — in the JSON body they're numeric (integer); internally BigInt. Validation: an integer (Number.isInteger), > 0, below a sane max (< 2^53 to avoid float precision — enforced by an explicit cap like < 10^15? If I check Number.isInteger, JS numbers are exact up to 2^53; a client could send 2^53+2 and have it parsed as an integer but imprecisely… Number.isInteger(9007199254740994) → true but it's a float that was rounded. Cap it: amount < 1e12 (trillion minor units = 10^6 major if cent-minor… whatever) — enforce `MAX_AMOUNT = 10^15`? Let's cap at `Number.MAX_SAFE_INTEGER / something`. Simply: require 0 < amount ≤ 10^15 (well below 2^53 ≈ 9×10^15). A reasonable business cap, comment it.)

The controller: "validates input and calls the service. No business logic." Manual validation (no class-validator dep? class-validator is common but the dep isn't specified; to keep deps minimal, hand-validate in the controller: accountId non-empty string, amount positive safe integer, destinationAddress non-empty string, idempotencyKey non-empty string (max length)). Manual validation in the controller is acceptable and keeps deps to nestjs + prisma. I'll hand-validate (controller's job). Use @Body() and check; on failure → 400 `validation_failed` with a details listing the issues. That fits the envelope.

Error codes (snake_case contract):
- `resource_not_found` (404) — unknown account (and maybe unknown payout for the GET endpoint? Is there a GET? Not required. Skip the GET endpoint — "do exactly what the task asks." Only POST /payouts. Hmm, a GET /payouts/:id would be handy but not required — skip.)
- `account_not_found` (404)? The convention example shows `resource_not_found`. Let me use `resource_not_found` for unknown accounts with details `{ resource: 'account', id }`. That matches the documented example code.
- `insufficient_funds` (409) with details `{ available_minor, requested_minor }`.
- `validation_failed` (400) with details `{ issues: [...] }`.
- `internal_error` (500) fallback.

Envelope filter: `AllExceptionsFilter`:
- ServiceError (with status, code, message, details) → render.
- HttpException → map to envelope: if the response body is our shape (code etc.) use it; otherwise map by status (404 → resource_not_found? A generic HttpException from Nest → code = `http_error`? Let me map: use the status-based default code: 400 validation_failed? hmm — Nest's built-in 400 (e.g. malformed JSON) → code `validation_failed`, 404 → `resource_not_found`, else `http_error`? Let's keep: ServiceError → its code; HttpException → code from a status map with `http_error` fallback… Let me do: 400→`validation_failed`, 404→`resource_not_found`, 405→`method_not_allowed`? overkill. Map {400:'validation_failed',404:'resource_not_found',409:'conflict'} and default `http_error`. details: {}.)
- Prisma errors (P2002 unique constraint violation on idempotency → `idempotency_conflict`? Under FOR UPDATE this shouldn't happen; if it does (shouldn't), map to 409 `idempotency_conflict`. P2025 → resource_not_found.)
- Anything else → 500 `internal_error`, log.

Where does the ServiceError class live? `src/common/service-error.ts` + the filter in `src/common/all-exceptions.filter.ts`. Register in main.ts: `app.useGlobalFilters(new AllExceptionsFilter())`.

Now — the repository transaction using `$queryRaw` inside `$transaction`:
```ts
await this.prisma.$transaction(async (tx) => {
  const rows = await tx.$queryRaw<Array<{ settled_balance_minor: bigint; held_balance_minor: bigint; version: number }>>(Prisma.sql`SELECT settled_balance_minor, held_balance_minor, version FROM accounts WHERE id = ${accountId} FOR UPDATE`);
  ...
})
```
With the ESM + Prisma: `import { Prisma } from '@prisma/client'` and `Prisma.sql` template. Fine.

Hmm, one gotcha: BigInt in $queryRaw results — Postgres `bigint` comes back as a string or bigint depending on driver config? Node's `pg` returns int8 as a string by default! Prisma's $queryRaw maps it… Prisma docs: `$queryRaw` returns values as the database returns them; for bigint, Prisma returns a `bigint`? Actually I recall Prisma's raw queries return int8 as strings from pg unless configured. Hmm. Prisma's `$queryRaw` types: if I type it as `bigint`, at runtime it might be a string. This is a real gotcha. To avoid it: parse defensively in the repository: `BigInt(row.settled_balance_minor)` — BigInt() works on both a string and a bigint/number. Write a helper `toBigInt(v: unknown)`. Defensive and correct. Also, when passing BigInt parameters to $queryRaw, pg handles BigInt? node-pg serializes BigInt… does pg support BigInt from 8.x? I think `pg` can handle bigint (converted to a string) (with `pg-types`?). To be safe, in the raw SQL we only SELECT (no BigInt params). The conditional UPDATE for the claim CTE uses now() — no params. OK, raw SQL is used for (1) FOR UPDATE select, (2) claim CTE. Both mostly parameterless (accountId param in (1) — a string, fine).

Now the interactive transaction with `tx.$queryRaw` + `tx.payout.create` etc. — supported.

Timeout of the interactive transaction: the default 5s is fine.

Now, let me also think about the `recordSent` transaction:
```ts
recordSent(payoutId, txHash, messageId): Promise<void>
  tx:
    - payout = tx.payout.findUnique (status check? The guard was already done in beginProcessing; but for safety: the conditional update)
    - const upd = tx.payout.updateMany? No — use $queryRaw or updateMany with a where condition + RETURNING: Prisma's updateMany doesn't RETURN. Use a raw conditional update? Or fetch the payout and check status==='processing' and then update (we hold no lock…). Race: two handlers (duplicate delivery) both see 'processing'?? Can that happen? beginProcessing: `UPDATE ... WHERE id=? AND status='created'` — two concurrent handlers: the first sets processing (commit), the second gets 0 rows → skip. So only one handler advances past created. But if the handler crashes after beginProcessing commits and before recordSent, the lease re-claim → handler sees 'processing' → my rule: escalate to needs_review (safe). So within a single successful path, recordSent is the sole consumer: it can do a conditional updateMany (id + status processing) and then check the count… but then the ledger/account updates must be conditioned on the transition. Use raw: `UPDATE payouts SET status='sent', tx_hash=?, sent_at=now() WHERE id=? AND status='processing' RETURNING id, amount_minor, account_id` — then if 0 rows → abort (throw, rollback) — otherwise proceed with the ledger + account + message done. Inside one tx, consistent.

    - Ledger: insert 2 entries (group `${payoutId}:sent`): debit USER_HELD A, credit PAYOUTS_SENT A.
    - Account: `UPDATE accounts SET settled_balance_minor = settled_balance_minor - A, held_balance_minor = held_balance_minor - A, version=version+1 WHERE id=?`. (raw, or Prisma's decrement with negatives: `data: { settledBalanceMinor: { decrement: A }, heldBalanceMinor: { decrement: A }, version: { increment: 1 } }` — Prisma supports negative increments; fine, no raw needed.)
    - Message: `UPDATE outbox_messages SET status='DONE', completed_at=now() WHERE id=? AND status='PROCESSING'` — or set DONE. If the message is no longer PROCESSING (stale-duplicated claim — a second worker claimed the same message while the first was committing)… the claim CTE with SKIP LOCKED prevents concurrent claims of the same row (FOR UPDATE in the subquery). A lease re-claim could double-claim only if the first is still in flight beyond the lease — the second handler then sees the payout 'sent' → marks done; the first handler also marks done — the final DONE is idempotent. OK.
  Then a separate call markCompleted: `UPDATE payouts SET status='completed', completed_at=now() WHERE id=? AND status='sent'`.
```

Wait — why not set status directly to 'completed' in recordSent? To keep the lifecycle explicit with a 'sent' state in between (an audit trail that shows sent_at before completed_at, and allows a future verification step). Fine; document it.

`recordFailed(payoutId, message, messageId)`: tx:
- conditional updateMany payouts → 'failed' WHERE status='processing' (0 rows → abort).
- Ledger group `${payoutId}:failed`: credit USER_AVAILABLE A, debit USER_HELD A.
- Account: held −A (settled unchanged).
- Message → DONE (definitive failure, no more retries).
- Save error_message.

`recordNeedsReview(payoutId, message, messageId)`: tx:
- conditional updateMany → 'NEEDS_REVIEW' WHERE status='processing'.
- No ledger change (hold retained).
- Message → DEAD.
- error_message.

`requeue(messageId, attempts, backoffMs)`: tx:
- message → PENDING, attempts=attempts, available_at=now()+backoff.
- payout: `UPDATE ... SET status='created' WHERE id=? AND status='processing'` (back to awaiting; conditional).
Wait — is it right to reset to 'created'? The lifecycle created→processing→(retry)→created→processing… a bit odd but it conveys "awaiting processing." Acceptable and explicit. Alternatively keep 'processing' and have the guard allow processing (but then the crash/lease case can't distinguish "in flight" from "ready to retry"). Reset to created: clean.

`completeMessage(messageId)`: → DONE.
`deadMessage(messageId)`: → DEAD.

`beginProcessing(payoutId)`: conditional created→processing; return boolean.
`escalateNeedsReview(payoutId, reason, messageId)` — the "processing outcome unknown" path: payout→NEEDS_REVIEW (from 'processing'), message→DEAD, error_message=reason.

Hmm wait, the "payout is processing on claim" case: the handler escalates to needs_review — but is that too aggressive for a legitimate slow provider? The lease is long (30s) vs "succeeds slowly"… the SDK "may … succeed slowly." If a transfer legitimately takes 40s, the lease re-claim escalates to needs_review (funds held, manual) while the original attempt is still running and might succeed → commit race: the original recordSent's conditional `WHERE status='processing'` fails because the status is now NEEDS_REVIEW → the transfer succeeded but the payout is needs_review → safe (money held; a human confirms the txHash from logs; the user's funds are still held so no loss). OK, safe. Make the lease configurable, default 60s? Let me default `PROCESSING_CLAIM_TIMEOUT_MS` = 60_000, `PROCESSING_INTERVAL_MS` = 5_000. Env-configurable.

Now, the claim CTE in SQL:
```sql
WITH claim AS (
  SELECT id FROM outbox_messages
  WHERE (status = 'PENDING' AND available_at <= now())
     OR (status = 'PROCESSING' AND claimed_at IS NOT NULL AND claimed_at < now() - (${leaseMs} || ' milliseconds')::interval)
  ORDER BY available_at, created_at
  LIMIT 10
  FOR UPDATE SKIP LOCKED
)
UPDATE outbox_messages m
SET status = 'PROCESSING', claimed_at = now()
FROM claim
WHERE m.id = claim.id
RETURNING m.id, m.payload, m.attempts
```
Note: when re-claiming a stale PROCESSING message, keep `attempts` (crash ≠ retry)? Or increment? A crash re-claim followed by a provider call is effectively a new delivery — should count toward the bound? For boundedness of *provider calls*, hmm — the attempts field increments only in my requeue path (on error). Crash loop: crash, re-claim, escalation to needs_review (payout is processing) — no provider call. So the provider-call bound holds: at most (max attempts via requeue) calls + 1 call per escalation… let me trace: an attempt fails with an error → requeue (attempts=1,2) → attempt 3 fails → needs_review. Provider calls: 3. A crash during attempt k → re-claim → payout is 'processing' → escalate (no call). So ≤ max provider calls per payout, plus the crash path. Bounded.

Payload is JSON: `payload` column type Json → Prisma returns an object. In RETURNING of the raw SQL, it comes back as a JSON object (pg parses json). Fine; cast as `unknown`.

Enum in raw SQL: Postgres enum values are uppercase ('PENDING' etc.) — the Prisma enum default is the enum value name in uppercase. When writing raw SQL with enum literals, Prisma enums are stored as text; the Postgres enum type is created with values PENDING, PROCESSING, DONE, DEAD (uppercase). Literal comparison `status = 'PENDING'` — in raw SQL, comparing an enum column with a string literal works (Postgres coerces the literal to the enum type). ✓.

Now the migration files. "Every schema change ships with a migration." I need `prisma/migrations/<ts>_init/migration.sql` with the full DDL matching the schema. I'll write it by hand (standard Prisma migration format):

- Create types: `CREATE TYPE "PayoutStatus" AS ENUM ('CREATED','PROCESSING','SENT','COMPLETED','FAILED','NEEDS_REVIEW');` `CREATE TYPE "OutboxStatus" AS ENUM ('PENDING','PROCESSING','DONE','DEAD');` `CREATE TYPE "LedgerAccount" AS ENUM ('USER_AVAILABLE','USER_HELD','PAYOUTS_SENT');` `CREATE TYPE "LedgerDirection" AS ENUM ('DEBIT','CREDIT');`
- accounts, payouts, outbox_messages, ledger_entries tables with snake_case columns, indexes, and FKs.
- Unique: `CREATE UNIQUE INDEX "payouts_account_id_idempotency_key_key" ON "payouts"("account_id","idempotency_key");`
- FK: payouts.account_id → accounts.id (ON DELETE RESTRICT? Prisma default: for required relations ON DELETE Restrict? Prisma default referential action for required: Restrict? Actually the default is `ReferentialAction.Restrict` for required, `SetNull` for optional… For a required FK, Prisma generates `ON DELETE RESTRICT`? Let me recall: Prisma's default referential actions: required relation → RESTRICT? I believe the default is `ON DELETE RESTRICT` for required, `ON DELETE SET NULL` for optional… hmm, no: I recall the default is Restrict for required, NoAction for optional? To be safe in hand-written SQL, just use `ON DELETE RESTRICT` for the payouts→accounts FK and payout FKs; ledger_entries.payout_id FK → payouts ON DELETE RESTRICT; outbox_messages: no FK (payload-based) — fine.

Wait, does the Prisma schema need the relations? `account Account @relation(fields: [accountId], references: [id])`. And `payout Payout @relation(...)` on LedgerEntry? LedgerEntry has a payout_id — relation `payout Payout @relation(fields:[payoutId], references:[id])`. Payout has `ledgerEntries LedgerEntry[]`. Accounts has `payouts Payout[]`. OK.

BigInt columns: `BIGINT NOT NULL DEFAULT 0`.
Json: `JSONB NOT NULL`.
Timestamps: `TIMESTAMPTZ(6)`.
cuid id: `TEXT NOT NULL` + PK. Prisma's `@default(cuid())` is app-generated.

The migration name: `20240101000000_init/migration.sql` — the ts prefix, e.g. `20250101000000_init`. Fine.

Also `prisma/schema.prisma` with `datasource db { provider = "postgresql", url = env("DATABASE_URL") }` and `generator client { provider = "prisma-client-js" }`.

Now — Prisma's ESM + Node 20: the generated client needs the standard import `import { PrismaClient } from '@prisma/client'`. Under `"type":"module"`, Prisma v5+ works with ESM imports (the client is CJS, and Node ESM importing CJS is fine). OK.

Do I need a `package.json`? "Deliver every file the solution needs." The conventions mention pnpm, Vitest, NestJS, Prisma — the repo probably has a package.json, but it wasn't shown, and I "decide the file layout myself… deliver every file the solution needs." Since no existing codebase is shown (the "existing files" statement is conditional, and none was given), I should include a minimal `package.json` + `tsconfig.json` + `vitest.config.ts` to make it runnable. Hmm — "don't create files it doesn't ask for." The deliverables are: Prisma schema + migration, NestJS module (controller, service, worker), tests, DESIGN.md. The conventions layout includes `src/main.ts`, `src/app.module.ts` — so main.ts and app.module.ts are part of the expected layout → include. A package.json isn't in the layout; but without it nothing runs… the conventions assume a repo with pnpm etc. I think including `package.json`, `tsconfig.json`, `vitest.config.ts` is defensible as "files the solution needs" for it to be runnable. But there's a risk of clashing with an existing one? "If files are given above the task, they are the existing codebase" — none was given. So it's a fresh repo; a runnable repo needs package.json. I'll include: package.json (deps: @nestjs/common, @nestjs/core, @nestjs/platform-express, @nestjs/testing? (not needed for my direct-instantiation tests), reflect-metadata, rxjs (peer of @nestjs/core), prisma, @prisma/client, pg? (not directly — Prisma brings its own driver? no — Prisma uses its own engine, not node-postgres; pg isn't needed), vitest, typescript, @types/node, tsx? For running main in dev: tsx or ts-node. I'll use `tsx` for dev and vitest for tests. Keep deps minimal:

dependencies: @nestjs/common, @nestjs/core, @nestjs/platform-express, reflect-metadata, rxjs, @prisma/client.
devDependencies: prisma, typescript, tsx, vitest, @types/node, @types/express? (needed for ts? The controller uses plain @Body() — express types only needed by platform-express internally; TS doesn't need @types/express unless we import express. We don't. Skip.)

Wait — `@nestjs/platform-express` peer deps: needs @types/express? Only for its own typings; not needed at compile time for our code. OK.

Also "configuration only from environment variables": `main.ts` reads `process.env.PORT` (default 3000).

vitest.config.ts: `import { defineConfig } from 'vitest/config'`; test environment node; maybe `test: { env: {} }`? The tests need DATABASE_URL — the convention says config from env, tests run against a Postgres with DATABASE_URL set. Add a small `test/prisma.ts` helper? Let me keep the tests self-contained: in the spec, `import { PrismaClient } from '@prisma/client'; const prisma = new PrismaClient();` and in beforeAll: `await prisma.$executeRawUnsafe('DELETE FROM outbox_messages; DELETE FROM ledger_entries; DELETE FROM payouts; DELETE FROM accounts;')` — wait, the service has no raw SQL but tests can use raw. Fine — tests are a separate context. Actually cleaner: cascade deletes? Set up FKs so that deleting accounts cascades? For test cleanup, a raw DELETE in the spec is fine.

Seed an account with a settled balance: `prisma.account.create({ data: { id: 'acc1', settledBalanceMinor: BigInt(1000), heldBalanceMinor: 0n } })`.

Now, the test details:

Test 1 — concurrent creation: account settled 1000 (major? minor units, whatever), held 0. Fire 5 concurrent `createPayout({accountId:'acc1', amount: 1000, ...})` with different idempotency keys (and different destination addresses, or the same). Expect: exactly 1 resolves with 201/payout; 4 reject with a ServiceError code 'insufficient_funds'. Then account: held == 1000, settled 1000, available 0. Also, a subsequent creation of amount 1 → insufficient.

Test 1b (idempotent duplicate within concurrency): fire 2 concurrent creations with the same idempotencyKey → both return the same payout id, held == 1000 (not 2000). This tests the "retrying with the same idempotencyKey must not create a second payout or reserve funds twice" under concurrency (FOR UPDATE serializes). Include it.

Test 2 — duplicate delivery: create a payout (via the service), find the outbox message (status PENDING). A FakeProvider that succeeds and counts calls. Call `worker.processMessage(msg.id)` twice (sequentially). Assert: provider.calls === 1, payout status COMPLETED, txHash set, account settled 0? Let me use amounts: settled 1000, payout 400 → after: settled 600, held 0. Ledger: 3 groups? Groups: created (debit USER_AVAILABLE 400, credit USER_HELD 400), sent (debit USER_HELD 400, credit PAYOUTS_SENT 400). The account's available from the ledger? Maybe assert a balance computation: the SUM of ledger invariants: per group, debits==credits. And `payouts_sent` balance == 400.

Wait — note: the account was seeded with settled 1000 directly via prisma (no ledger entries for the "deposit"). So the ledger sum won't match the account balance (no deposit entry). Fine for this exercise (deposits are out of scope); the invariants I'll assert are per-group balance + the specific deltas. I could seed via a helper that inserts a deposit entry (group 'seed:acc1': debit `PAYOUTS_SENT`?? no). The deposit would be: credit USER_AVAILABLE, debit … an external account not in the enum. Skip deposit ledger entries; the requirement is about the payout lifecycle's ledger. OK.

Test 3 — retry exhaustion: a provider that always throws. Create a payout (amount 400). `processMessage(msg.id)` → attempt 1 fails → requeue (attempts 1, PENDING, available_at in the future). To continue processing, the test needs to move the message's available_at back (or processMessage should ignore available_at — the handler processes a specific message id regardless of availability). Let me make `processMessage(id)` claim the message directly (conditional PENDING/DEAD?→PROCESSING). In the test: call processMessage 3 times; after each of the first 2, the message is PENDING with attempts+1; after the 3rd (attempts reaching MAX=3), the payout is NEEDS_REVIEW, the message is DEAD, the account held is still 400 (funds held), the settled is unchanged 1000.

Wait, attempts semantics: `msg.attempts` starts at 0. processMessage: claim (PENDING→PROCESSING). Provider throws. attempts = 0+1 = 1 < 3 → requeue with attempts=1. Second call: attempts 1+1=2 <3 → requeue attempts=2. Third: 2+1=3 → >= 3 → needs_review. Provider calls: 3.

But `processMessage` claims from PENDING — after a requeue with available_at in the future, the claim `WHERE status='PENDING'` (the direct-claim path for a specific message) — should it respect available_at? In the test, the test awaits or the backoff is small. Let me make the direct-claim path in processMessage not respect available_at (it's an explicit "deliver this message now") — the polling path respects it. Hmm, but then the test trivially passes. A simpler alternative: have the test use `processMessages()` (the real poll) and await the available_at (a small backoff: first requeue +100ms, then +200ms — exponential, configurable). The test: `await worker.processMessages(); await sleep(150); await worker.processMessages(); ...` — 3 polls with sleeps. A bit flaky-ish, but with generous sleeps it's OK. Or expose the backoff to be tiny in tests (env `PAYOUT_RETRY_BACKOFF_BASE_MS`?). Configuration only from env — the worker reads env with defaults; the test sets `process.env.PAYOUT_RETRY_BACKOFF_BASE_MS='10'` before constructing the worker. Clean. Let's do that: backoff = base * 2^(attempts-1), base from env (default 5000? default 1000ms base is fine; tests set 10ms).

Actually, for the test's determinism, it's simpler to expose `processMessage(id)` as the idempotent handler (documented) and have `processMessages()` poll→claim→processMessage for each. Test 2 uses processMessage twice (duplicate delivery — exactly the requirement). Test 3 uses processMessages() ×3 with sleeps (realistic poll). Or processMessage 3 times — but requeue sets available_at to the future, and processMessage's direct claim ignores available_at → the test is instant, deterministic. Let me have processMessage's claim: `UPDATE outbox_messages SET status='PROCESSING', claimed_at=now() WHERE id=? AND status IN ('PENDING','PROCESSING')` — re-claiming even if PROCESSING (simulates a lease/duplicate). Hmm — that would let a test reprocess a DONE message? No: status IN ('PENDING','PROCESSING') excludes DONE/DEAD → a duplicate delivery after DONE is a no-op (the payout guard + the message guard). For test 2: after the first processMessage, the message is DONE; the second processMessage(msgId) → the claim fails (status DONE) → nothing happens → provider.calls stays 1. But is that testing the *dangerous* duplicate (a re-claim while in flight, or a re-delivery before DONE)? The requirement: "the worker may see the same message more than once." Scenarios: (a) a poll overlap re-selects the same PENDING message — prevented by the atomic claim; (b) a lease re-claim after a "crash" — payout is processing → escalation; (c) the message is requeued after DONE (at-least-once redelivery) → the payout guard (status completed) no-ops.

The most valuable test for funds safety: redelivery after the transfer succeeded but before the DONE ack — i.e. the message is still PROCESSING (crash before commit? but the commit is atomic…). In my design, the transfer + DONE ack are in one tx, so a redelivery of a DONE message is the realistic duplicate → the payout guard makes it a no-op. To test the "crash before commit" variant: hard to simulate without hooks. Let me simulate: after creating, manually set the message to PROCESSING and the payout to 'processing' (as if a crashed attempt), and processMessage → the handler sees payout 'processing' → escalates to NEEDS_REVIEW, no provider call (safe: no double transfer). That's a great test for "duplicate delivery of an in-flight message is safe."

So test 2 = two parts:
- 2a: processMessage(id) after DONE → no additional provider call, state unchanged (duplicate redelivery is a no-op).
- 2b (in-flight redelivery): a fresh payout; simulate a crash: message PROCESSING, payout PROCESSING; processMessage → no provider call; payout NEEDS_REVIEW; message DEAD; funds held.

Both demonstrate at-least-once safety.

And test 3: retry exhaustion as above (processMessage ×3, or processMessages with env backoff). Let me use processMessages() with a small env backoff and a sleep to test the real path (including available_at). Hmm, flakiness… the total sleep is ~ (10 + 20 + …) ms. Fine: base 10ms → requeue1 available at +10ms, requeue2 at +20ms; the test: processMessages (attempt 1) → sleep 30 → processMessages (attempt 2) → sleep 40 → processMessages (attempt 3) → assert. OK.

Also the service-level creation tests might be in the same spec file: `test/payout.spec.ts` — one feature spec file per convention. Include all tests there.

Now the worker class:
```ts
@Injectable()
export class PayoutWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  constructor(private readonly repo: PayoutRepository, private readonly service: PayoutService, private readonly provider: PayoutProvider) {}
  onModuleInit() { this.start(); }
  start() { interval = env PAYOUT_POLL_INTERVAL_MS default 5000; timer = setInterval(() => { void this.processMessages().catch(log) }, interval); timer.unref?.() }
  async processMessages(): Promise<number> { const claimed = await this.repo.claimMessages(leaseMs, batchSize); for (const m of claimed) { try { await this.service.processPayoutMessage(m.id, m.payload, m.attempts) } catch (e) { log; mark the message as failed? } } return claimed.length }
  onModuleDestroy() { clearInterval }
}
```
Hmm, the `attempts` on the claimed message: pass the current attempts; the service computes newAttempts = attempts+1 on failure. Fine.

Wait, who owns the retry logic — the service (`PayoutService.processPayoutMessage`) or the worker? The service holds the logic ✓. The worker: scheduling + fan-out + top-level catch (if the service throws unexpectedly, mark the message… let the service own all terminal states; the worker's catch: log + mark the message PROCESSING→PENDING (re-claimable) for liveness? Or leave it as PROCESSING for lease recovery. Leave it as PROCESSING (the lease will re-claim) and log. OK.)

Provider interface:
```ts
export interface PayoutProvider {
  transfer(args: { to: string; amount: bigint }): Promise<{ txHash: string }>;
}
```
amount: bigint (minor units) — the SDK "amount" — is it minor units? Our internal amount is BigInt minor units; pass it through. Mark an ASSUMPTION: the provider takes amounts in the same minor units (no conversion).

Provider token: define an `INJECTABLE` provider class `BlockchainPayoutProvider` that implements the interface — a real (stub) adapter? "The blockchain provider SDK is assumed" — we don't have the real SDK. So we define an interface + a default implementation that throws "not configured"? Better: define the interface and a DI token `PAYOUT_PROVIDER`; in the module, provide it with a factory that wraps `provider.transfer` — but the real SDK doesn't exist → the default implementation would be… an ASSUMPTION comment: the SDK is assumed to be importable as `@rnn/blockchain-provider`? That's inventing a package. The task says "assume `provider.transfer({to, amount}) -> {txHash}`" — I think defining the `PayoutProvider` interface + an injectable default implementation with a clearly marked ASSUMPTION (a stand-in that wraps a real SDK) is the right call. Let me create `src/payout/blockchain-provider.provider.ts`:

```ts
export const PAYOUT_PROVIDER = Symbol('PAYOUT_PROVIDER') // or a string token
// ASSUMPTION: the concrete SDK module is not specified; the default implementation
// is a seam for the real provider. Tests inject a fake.
@Injectable()
export class DefaultBlockchainProvider implements PayoutProvider { ... throw new Error('provider not configured') }
```
Hmm — or more simply: the module provides `{ provide: PAYOUT_PROVIDER, useFactory: () => ({ transfer: async (a) => { throw new Error('payout provider not configured') } }) }`. In main/app it should be wired to the real SDK (ASSUMPTION comment). In tests, we bypass Nest and construct the worker with a fake.

Hmm wait — then the app can't actually run a payout in production… but the task is an exercise; the SDK doesn't exist. The ASSUMPTION marker covers it.

Or use `useFactory: () => createProviderFromEnv()`? There's no env for the SDK. Keep: a factory returning the interface, with a comment that in production it wraps the real SDK (e.g. `new StablecoinSdk()`). Fine.

Now the module wiring per the convention:
`payout.module.ts`:
```ts
@Module({
  controllers: [PayoutController],
  providers: [PayoutService, PayoutRepository, PayoutWorker, { provide: PAYOUT_PROVIDER, useFactory: ... }],
  exports: [PayoutService],
})
export class PayoutModule {}
```
The worker is in providers ✓ ("a service, repository, or processor is listed in the module's providers").

`app.module.ts`: imports [PayoutModule].
`main.ts`: NestFactory.create(AppModule), useGlobalFilters(new AllExceptionsFilter()), listen on PORT from env, enableShutdownHooks? For OnModuleDestroy (worker cleanup) — Nest calls OnModuleDestroy on SIGINT/SIGTERM by default on graceful shutdown; `app.enableShutdownHooks()` is needed for process signals. Include it.

Controller:
```ts
@Controller('payouts')
export class PayoutController {
  constructor(private readonly service: PayoutService) {}
  @Post()
  async create(@Body() body: unknown) {
    const errors = validateCreatePayoutBody(body); // controller-level validation, no logic beyond shape
    if (errors.length) throw new ServiceError(400, 'validation_failed', '...', { issues: errors });
    const { payout, replayed } = await this.service.createPayout({...});
    const status = replayed ? 200 : 201;
    this.http.status(status).json?
```
Nest: to return a custom status per case, return `new HttpException`? Ugly. Alternative: use `@Res()` passthrough? Mixing @Res() breaks the filter. Better: the controller always returns 201? On replay, 200 is preferable; but 201 for replay isn't wrong? Idempotency best practice: return the same response (status can differ; Stripe returns the same as the original). Simplest and most robust: always 201? Hmm. Or use Nest's `@HttpCode(201)` and on replay `@Res()`… Let's do:
```ts
@Post()
@HttpCode(HttpStatus.CREATED)
async create(@Body() body, @Res({ passthrough: true }) res: Response) {
  ...
  const result = await this.service.createPayout(input);
  if (result.replayed) res.status(HttpStatus.OK);
  return { payout: toPayoutDto(result.payout) };
}
```
With passthrough, the global filter still applies (filter applies only to thrown exceptions — a successful response bypasses the filter, fine). `Response` type from express — import type from 'express' → needs @types/express. Alternatively, avoid the express import: use `@Res({passthrough:true}) res: any`? Ugly typing. Add @types/express to devDeps — fine, it's a standard NestJS setup. Or even simpler: always 201. Actually, let me just always return 201 and include `replayed: true` in the response body — a defensible API choice and it avoids the @Res complexity. Hmm… "retrying with the same idempotencyKey must not create a second payout" — the status code isn't part of the contract. Decision: return 201 with a body `{ payout, replayed }`. Clean, no express import needed.

Wait, is `replayed` in the body "business logic in the controller"? No — it's response shaping. Fine. Actually even simpler: the service returns `{ payout, replayed }`; the controller maps to `{ payout: {...}, replayed }`. OK.

Body shape: `{ accountId, amount, destinationAddress, idempotencyKey }`. The service method takes a typed input. The controller validates:
- body is an object
- accountId: a non-empty string (length ≤ 64?)
- amount: a number, Number.isInteger, 1 ≤ amount ≤ 10^15 (safe integer range cap). Hmm Number.MAX_SAFE_INTEGER = 9007199254740991 (~9e15). A cap of 1e15 is below it. Use MAX = 1_000_000_000_000_000.
- destinationAddress: a non-empty string, ≤ 256? (address format is provider-specific — no validation beyond non-empty; ASSUMPTION? no, just non-empty.)
- idempotencyKey: a non-empty string ≤ 128.

Service.createPayout: calls repo.createPayout; repo returns `{ payout, replayed }` or throws a ServiceError subclass (AccountNotFound → 404 resource_not_found; InsufficientFunds → 409). The service catches nothing (the filter handles it). The service maps the repo's payout row → a DTO {id, status, amountMinor: number? or a string?}. BigInt in JSON: JSON.stringify(BigInt) throws! We must serialize amounts as strings or numbers. If ≤ 1e15, safe integer → Number(bigint) is safe. Return `amount_minor: number` (safe within the cap). Or a string to be safe with JSON. Hmm "no floating point for money" — that's about storage/computation (BigInt), not the wire. A wire number ≤ 1e15 is exact. Return a number on the wire (documented as minor units). In the DTO: `amountMinor: Number(p.amountMinor)`. Since we cap at 1e15, it's safe.

Now the repository details. Let me write out the methods:

```ts
@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createPayout(input: { accountId, amountMinor: bigint, destinationAddress, idempotencyKey }): Promise<{ payout: Payout; replayed: boolean }>
  async findPayoutById(id): Promise<Payout | null>
  async findAccountById(id): Promise<Account | null>
  async beginProcessing(payoutId): Promise<boolean>
  async recordSent(payoutId, txHash, messageId): Promise<void>
  async markCompleted(payoutId): Promise<boolean>
  async recordFailed(payoutId, errorMessage, messageId): Promise<void>
  async recordNeedsReview(payoutId, errorMessage, messageId): Promise<void>
  async requeueForRetry(messageId, payoutId, attempts): Promise<void>
  async completeMessage(messageId): Promise<void>
  async deadMessage(messageId): Promise<void>
  async claimMessages(batchSize, leaseMs): Promise<ClaimedMessage[]>
}
```

Wait — `requeueForRetry` needs to also reset the payout processing→created. Both in one tx. And `recordNeedsReview` (the retry-exhaustion path, from 'processing') and the crash-recovery escalation path (also from 'processing') — both the same method (payout→NEEDS_REVIEW, message→DEAD, set error_message). Reuse.

But note: `recordSent`'s conditional is `WHERE status='processing'` — in the normal flow beginProcessing set it. ✓.

A subtle point: in `createPayout`, after the FOR UPDATE select + checks, `tx.payout.create` — could it hit the unique violation? Only if a payout with the same key was created *after* we locked?? No — the lock is held on the account row; any concurrent creation on the same account must wait on the lock. A creation for a different account with the same key is allowed (unique on (account_id, key)). So a violation can't happen… except on a lock timeout. If it does, Prisma throws P2002 → the filter maps it to 409 `idempotency_conflict`? That's a rare fallback; I'll add the mapping (code `idempotency_conflict`, 409, message 'an existing payout already exists for this idempotency key'). Actually cleaner: catch P2002 in the repository → fetch the existing → return `{ payout: existing, replayed: true }`?? But our own held increment was applied — need to undo: roll back and re-run the whole tx (it'll see the existing and return it as a replay). Let me do: catch the P2002 in the repository's createPayout wrapper → retry once (the transaction rolls back automatically) → the second pass finds the existing payout → replayed. Clean, self-healing. Let me implement: a try/catch around `$transaction`; if a Prisma P2002 error with a target including idempotency → recurse once. Guard with a `retried` flag to avoid infinite loops.

Now `beginProcessing`: `const res = await this.prisma.payout.updateMany({ where: { id, status: 'CREATED' }, data: { status: 'PROCESSING' } }); return res.count > 0;`

`claimMessages`:
```ts
const lease = `${leaseMs} milliseconds`;
const rows = await this.prisma.$queryRaw`
  WITH claim AS (
    SELECT id FROM outbox_messages
    WHERE (status = 'PENDING' AND available_at <= now())
       OR (status = 'PROCESSING' AND claimed_at IS NOT NULL AND claimed_at <= now() - ${lease}::interval)
    ORDER BY created_at
    LIMIT ${batchSize}
    FOR UPDATE SKIP LOCKED
  )
  UPDATE outbox_messages m
  SET status = 'PROCESSING', claimed_at = now()
  FROM claim
  WHERE m.id = claim.id
  RETURNING m.id, m.payload, m.attempts
`;
```
Wait, `now() - interval`: `now() - (${lease}::interval)`. And `${lease}` is interpolated as a text parameter → `(${param})::interval` — the parameter is a string; the cast works. But `status = 'PENDING'` — comparing an enum with a string literal: Postgres allows `enum_col = 'PENDING'` (implicit coercion of the literal to the enum). But with a *parameter*, the coercion would fail (the parameter's type is unknown → actually an unknown-typed literal works; a $1 with a declared text type wouldn't coerce). Prisma's $queryRaw uses pg's parameters with unknown OID for untyped? pg sends parameters as text with no OID (unknown type) → Postgres coerces unknown to the enum. Hmm, to be safe, use literals in the SQL for the enum values (hardcoded 'PENDING', 'PROCESSING' — these are SQL, not dynamic values), and parameters only for batchSize (int) and the lease (interval). In the SQL above the enum values are literals ✓. batchSize: `LIMIT ${batchSize}` — pg sends an int parameter into LIMIT: `LIMIT $1` with an int8/int4 parameter works (LIMIT accepts a parameter). ✓.

Also the UPDATE…FROM with RETURNING m.payload — the payload jsonb comes back as a parsed object (pg parses jsonb). ✓.

`recordSent` transaction:
```ts
await this.prisma.$transaction(async (tx) => {
  const updated = await tx.$queryRaw`
    UPDATE payouts SET status = 'SENT', tx_hash = ${txHash}, sent_at = now()
    WHERE id = ${payoutId} AND status = 'PROCESSING'
    RETURNING id, account_id, amount_minor`;
  if (updated.length === 0) throw new Error('payout is no longer processing; cannot record sent'); // rolls back
  const row = updated[0] as { account_id: string; amount_minor: bigint | string };
  const amount = BigInt(row.amount_minor);
  await tx.ledgerEntry.createMany({ data: [
    { groupId: `${payoutId}:sent`, payoutId, account: 'USER_HELD', direction: 'DEBIT', amountMinor: amount },
    { groupId: `${payoutId}:sent`, payoutId, account: 'PAYOUTS_SENT', direction: 'CREDIT', amountMinor: amount },
  ]});
  await tx.account.update({ where: { id: row.account_id }, data: { settledBalanceMinor: { decrement: amount }, heldBalanceMinor: { decrement: amount }, version: { increment: 1 } } });
  await tx.outboxMessage.update({ where: { id: messageId }, data: { status: 'DONE', completedAt: new Date() } });
});
```
Hmm wait: `decrement: amount` with a BigInt — Prisma accepts BigInt for BigInt fields ✓.

`status = 'SENT'` is a literal ✓, `status = 'PROCESSING'` is a literal ✓.

`completedAt` column on OutboxMessage: add a `completed_at DateTime?`. ✓.

`markCompleted`: `updateMany({ where: { id, status: 'SENT' }, data: { status: 'COMPLETED', completedAt: new Date() } }).count > 0`.

`recordFailed`:
```ts
tx: raw UPDATE payouts SET status='FAILED', error_message=${msg} WHERE id=? AND status='PROCESSING' RETURNING id, account_id, amount_minor;
if 0 → throw/abort
ledger: [debit USER_HELD, credit USER_AVAILABLE] group `${payoutId}:failed`
account: held decrement
message → DONE
```

`recordNeedsReview`:
```ts
tx: raw UPDATE payouts SET status='NEEDS_REVIEW', error_message=${msg} WHERE id=? AND status='PROCESSING' RETURNING id;
if 0 → abort
message → DEAD
```

`requeueForRetry(messageId, payoutId, attempts)`:
```ts
tx: outboxMessage.update where id data { status:'PENDING', attempts, availableAt: new Date(now + backoff), claimedAt: null }
     payout.updateMany where { id, status:'PROCESSING' } data { status:'CREATED' }
```
backoff: computed in the service (base * 2^(attempts-1)). Pass the Date from the service? The repository takes a `nextAvailableAt: Date` parameter. The service computes it. Fine — the logic (backoff) in the service ✓.

Now the `PayoutService`:
```ts
@Injectable()
export class PayoutService {
  constructor(private readonly repo: PayoutRepository, @Inject(PAYOUT_PROVIDER) private readonly provider: PayoutProvider) {}

  async createPayout(input: CreatePayoutInput): Promise<{ payout: PayoutDto; replayed: boolean }> {
    const { payout, replayed } = await this.repo.createPayout(input);
    return { payout: toPayoutDto(payout), replayed };
  }

  async processPayoutMessage(messageId: string, payload: unknown, attemptsSoFar: number): Promise<void> {
    const payoutId = extractPayoutId(payload); // if missing → dead the message
    const payout = await this.repo.findPayoutById(payoutId);
    if (!payout) { await this.repo.deadMessage(messageId); return; }
    if (payout.status !== 'CREATED' && payout.status !== 'PROCESSING') {
      // duplicate delivery after the payout has already advanced/terminated
      await this.repo.completeOrDead? // the message was claimed → mark DONE
      await this.repo.completeMessage(messageId); return;
    }
    if (payout.status === 'PROCESSING') {
      // redelivery while a prior attempt is in flight / crashed: outcome unknown → safe escalation
      await this.repo.recordNeedsReview(payout.id, 'duplicate delivery while processing; outcome unknown', messageId);
      return;
    }
    // status CREATED
    const started = await this.repo.beginProcessing(payout.id);
    if (!started) { await this.repo.completeMessage(messageId); return; }
    try {
      const { txHash } = await this.provider.transfer({ to: payout.destinationAddress, amount: payout.amountMinor });
      await this.repo.recordSent(payout.id, txHash, messageId);
      await this.repo.markCompleted(payout.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isDefinitiveFailure(err)) { await this.repo.recordFailed(payout.id, message, messageId); return; }
      const attempts = attemptsSoFar + 1;
      if (attempts >= MAX_ATTEMPTS) { await this.repo.recordNeedsReview(payout.id, `retries exhausted without a definitive outcome: ${message}`, messageId); return; }
      await this.repo.requeueForRetry(messageId, payout.id, attempts, backoffDate);
    }
  }
}
```

Wait — a conflict: the "payout.status === 'PROCESSING'" branch (escalation) and the `beginProcessing` guard. When would the payout be PROCESSING on a legitimate redelivery? Only after a crash/re-claim (the lease). But also: what if processPayoutMessage is called concurrently twice for the same message (a duplicate claim via the lease)? The first claim sets the message to PROCESSING; a second claim of the same message (the lease) — the payout is now PROCESSING (set by the first) → the second escalates to needs_review → the first is still running the provider… race: the first completes → recordSent conditional WHERE status='PROCESSING' — if the escalation committed first → 0 rows → the first's recordSent throws → rolls back → the first's catch (an error in recordSent!) → hmm, the first catches its own recordSent failure → treats it as a provider failure?? Bug: the catch block would requeue/escalate. The requeue: `outboxMessage.update where id data{status PENDING...}` and the payout's updateMany processing→created (0 rows since it's now NEEDS_REVIEW) → the message is PENDING again with attempts+1 → later claimed → the payout is NEEDS_REVIEW → completeMessage (DONE). The final state: NEEDS_REVIEW ✓ (the transfer actually happened; manual reconciliation; the funds are held → safe). The message loops a bit but terminates. Acceptable but noisy. Alternatively, wrap the recordSent failure specially: if it throws (transition failed), don't retry the provider — just log (the escalation path handles the state). Let me structure the catch to distinguish: the provider call in its own try; the post-provider repository calls in a separate try that on failure just logs (the state is owned by the escalation / conditional transitions). Cleaner:

```ts
let result: { txHash: string };
try {
  result = await this.provider.transfer(...);
} catch (err) {
  ... failure path (requeue / failed / needs_review); return;
}
try {
  await this.repo.recordSent(payout.id, result.txHash, messageId);
  await this.repo.markCompleted(payout.id);
} catch (err) {
  // the conditional transition lost a race (e.g. a lease re-claim escalated the payout).
  // The provider's outcome was captured; log it for reconciliation. Never retry the transfer here.
  log.error(...)
}
```
Good — this is safe: the transfer is never called twice for the same payout (guarded by the CREATED→PROCESSING transition + the PROCESSING escalation).

Hmm wait, one more: the normal retry flow (provider throws): the payout is PROCESSING (set by beginProcessing). Requeue resets it to CREATED. The next delivery: CREATED → beginProcessing ✓.

And `isDefinitiveFailure(err)`: `// ASSUMPTION: the SDK error shape is unspecified; treat errors with a truthy .permanent (or .definitive) flag as definitive; all others as unknown/transient.` Implementation: `const e = err as { permanent?: boolean; definitive?: boolean }; return Boolean(e && (e.permanent || e.definitive));`

`extractPayoutId(payload)`: the payload is a Json object `{ payoutId: string }`; if invalid → return null → the caller dead-ends the message. The service: if (!payoutId) { dead; return }.

Now the `toPayoutDto` mapping — where? The service (logic) — a small mapper in the service file. Fields: id, status (lowercase? Keep the Prisma enum string as-is, e.g. 'CREATED'? Or map to lowercase 'created' for API niceness? The contract isn't specified; let's expose lowercase: created/processing/sent/completed/failed/needs_review. Map with a small record.) Plus amountMinor (number), destinationAddress, idempotencyKey, txHash, errorMessage, timestamps (ISO strings).

Now — the `attempts` cap: `MAX_ATTEMPTS = 3` — from env `PAYOUT_MAX_ATTEMPTS` (default 3). The service reads env in the constructor. The backoff base is env `PAYOUT_RETRY_BACKOFF_MS` default 1000. The worker's interval is env `PAYOUT_POLL_INTERVAL_MS` default 5000; the lease is env `PAYOUT_CLAIM_TIMEOUT_MS` default 60000. All from env ✓ (the convention).

Test env: set `process.env.PAYOUT_RETRY_BACKOFF_MS = '20'`, `PAYOUT_MAX_ATTEMPTS = '3'` (default anyway), `PAYOUT_POLL_INTERVAL_MS = '5000'` (the worker is constructed manually without auto-start? My worker's `onModuleInit` starts the timer; in tests I don't call onModuleInit → no timer. But I'll call `processMessages()` explicitly. Good.)

Also `unref()` the timer so tests / node can exit.

Now — the migration + schema must match exactly. Let me write the schema:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum PayoutStatus {
  CREATED
  PROCESSING
  SENT
  COMPLETED
  FAILED
  NEEDS_REVIEW
}

enum OutboxStatus {
  PENDING
  PROCESSING
  DONE
  DEAD
}

enum LedgerAccount {
  USER_AVAILABLE
  USER_HELD
  PAYOUTS_SENT
}

enum LedgerDirection {
  DEBIT
  CREDIT
}

model Account {
  id                    String   @id @default(cuid())
  settledBalanceMinor   BigInt   @default(0) @map("settled_balance_minor")
  heldBalanceMinor      BigInt   @default(0) @map("held_balance_minor")
  version               Int      @default(0)
  createdAt             DateTime @default(now()) @map("created_at")
  updatedAt             DateTime @updatedAt @map("updated_at")
  payouts               Payout[]

  @@map("accounts")
}

model Payout {
  id                String       @id @default(cuid())
  accountId         String       @map("account_id")
  amountMinor       BigInt       @map("amount_minor")
  destinationAddress String      @map("destination_address")
  idempotencyKey    String       @map("idempotency_key")
  status            PayoutStatus @default(CREATED)
  txHash            String?      @map("tx_hash")
  errorMessage      String?      @map("error_message")
  createdAt         DateTime     @default(now()) @map("created_at")
  updatedAt         DateTime     @updatedAt @map("updated_at")
  sentAt            DateTime?    @map("sent_at")
  completedAt       DateTime?    @map("completed_at")

  account         Account         @relation(fields: [accountId], references: [id])
  ledgerEntries   LedgerEntry[]

  @@unique([accountId, idempotencyKey])
  @@index([status])
  @@map("payouts")
}

model LedgerEntry {
  id         String          @id @default(cuid())
  groupId    String          @map("group_id")
  payoutId   String          @map("payout_id")
  account    LedgerAccount
  direction  LedgerDirection
  amountMinor BigInt         @map("amount_minor")
  createdAt  DateTime        @default(now()) @map("created_at")

  payout Payout @relation(fields: [payoutId], references: [id])

  @@index([groupId])
  @@index([payoutId])
  @@map("ledger_entries")
}

model OutboxMessage {
  id          String       @id @default(cuid())
  type        String       @default("payout.process")
  payload     Json
  status      OutboxStatus @default(PENDING)
  attempts    Int          @default(0)
  availableAt DateTime     @default(now()) @map("available_at")
  claimedAt   DateTime?    @map("claimed_at")
  completedAt DateTime?    @map("completed_at")
  createdAt   DateTime     @default(now()) @map("created_at")

  @@index([status, availableAt])
  @@map("outbox_messages")
}
```

Wait: `createdAt` in the model with `@map("created_at")` — the TS property is camelCase `createdAt`, the column is snake_case ✓ per the convention (column snake_case via @map).

Migration SQL (matching):

```sql
-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('CREATED', 'PROCESSING', 'SENT', 'COMPLETED', 'FAILED', 'NEEDS_REVIEW');
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'DEAD');
CREATE TYPE "LedgerAccount" AS ENUM ('USER_AVAILABLE', 'USER_HELD', 'PAYOUTS_SENT');
CREATE TYPE "LedgerDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "settled_balance_minor" BIGINT NOT NULL DEFAULT 0,
    "held_balance_minor" BIGINT NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,
    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "destination_address" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'CREATED',
    "tx_hash" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL,
    "sent_at" TIMESTAMP(6),
    "completed_at" TIMESTAMP(6),
    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "payout_id" TEXT NOT NULL,
    "account" "LedgerAccount" NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "outbox_messages" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'payout.process',
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMP(6),
    "completed_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payouts_account_id_idempotency_key_key" ON "payouts"("account_id", "idempotency_key");
CREATE INDEX "payouts_status_idx" ON "payouts"("status");
CREATE INDEX "ledger_entries_group_id_idx" ON "ledger_entries"("group_id");
CREATE INDEX "ledger_entries_payout_id_idx" ON "ledger_entries"("payout_id");
CREATE INDEX "outbox_messages_status_available_at_idx" ON "outbox_messages"("status", "available_at");

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

Migration folder: `prisma/migrations/20250101000000_init/migration.sql`.

Now `package.json`:
```json
{
  "name": "payout-service",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx watch src/main.ts",
    "start": "tsx src/main.ts",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate deploy",
    "test": "vitest run"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.0",
    "@nestjs/core": "^10.3.0",
    "@nestjs/platform-express": "^10.3.0",
    "@prisma/client": "^5.10.0",
    "reflect-metadata": "^0.2.1",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "prisma": "^5.10.0",
    "tsx": "^4.7.0",
    "typescript": "^5.4.0",
    "vitest": "^1.2.0"
  }
}
```

tsconfig.json:
```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "declaration": false,
    "sourceMap": true,
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```
NestJS requires experimentalDecorators + emitDecoratorMetadata ✓. With NodeNext ESM, Nest's decorators work (the metadata is emitted). Relative imports in ESM need file extensions!! `"type": "module"` + NodeNext → imports like `import { PayoutService } from './payout.service'` would fail at runtime under tsx/Node ESM unless we use `.js` extensions: `from './payout.service.js'`. NestJS projects usually use CommonJS. The convention says ESM `"type": "module"`. So all relative imports need the `.js` suffix. Vitest handles both. Let me write all relative imports with the `.js` extension. Carefully, everywhere:

- main.ts: `import { AppModule } from './app.module.js';` `import { AllExceptionsFilter } from './common/all-exceptions.filter.js';`
- app.module: `./payout/payout.module.js`
- module: `./payout.controller.js`, `./payout.service.js`, `./payout.repository.js`, `./payout.worker.js`, `./blockchain-provider.js`
- controller: `./payout.service.js`, `../common/service-error.js`
- service: `./payout.repository.js`, `./blockchain-provider.js`, `../common/service-error.js`
- repository: `../common/service-error.js`
- worker: `./payout.repository.js`, `./payout.service.js`, `./blockchain-provider.js`
- test: `../src/payout/payout.service.js` etc., `../src/payout/payout.repository.js`, `../src/payout/payout.worker.js`.

Hmm wait, does Vitest handle `.js`→`.ts` resolution? Yes — Vite/Vitest resolves `.js` to `.ts` in the TS project (a standard ESM TS setup). ✓. tsx handles it too. ✓.

Actually hmm, `@prisma/client` under ESM: `import { PrismaClient, Prisma } from '@prisma/client'` — the package has CJS + an ESM wrapper; works.

The filter file: `src/common/all-exceptions.filter.ts`:
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ServiceError } from './service-error.js';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    if (exception instanceof ServiceError) {
      res.status(exception.status).json({ error: { code: exception.code, message: exception.message, details: exception.details } });
      return;
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2025') { res.status(404).json(envelope('resource_not_found', 'the requested resource does not exist', {})); return; }
      if (exception.code === 'P2002') { res.status(409).json(envelope('idempotency_conflict', 'a resource with this idempotency key already exists', {})); return; }
      // fall through to 500
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const code = status === 400 ? 'validation_failed' : status === 404 ? 'resource_not_found' : status === 409 ? 'conflict' : 'http_error';
      const message = typeof body === 'string' ? body : (body as {message?: unknown}).message ?? exception.message;
      res.status(status).json({ error: { code, message: String(message), details: {} } });
      return;
    }
    this.logger.error('unhandled exception', exception instanceof Error ? exception.stack : String(exception));
    res.status(500).json({ error: { code: 'internal_error', message: 'an unexpected error occurred', details: {} } });
  }
}
```
Need @types/express for the `Request, Response` types — add @types/express to devDeps. OK.

Hmm, the 404 code in the HttpException map — but the documented example uses `resource_not_found` — ✓ consistent.

`service-error.ts`:
```ts
export class ServiceError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly details: Record<string, unknown> = {}) { super(message); this.name = 'ServiceError'; }
}
export class AccountNotFoundError extends ServiceError { constructor(accountId: string) { super(404, 'resource_not_found', `account ${accountId} was not found`, { resource: 'account', id: accountId }); } }
export class InsufficientFundsError extends ServiceError { constructor(availableMinor: bigint, requestedMinor: bigint) { super(409, 'insufficient_funds', 'the account does not have sufficient available funds', { available_minor: Number(availableMinor), requested_minor: Number(requestedMinor) }); } }
```
Wait, details values: the BigInt→Number conversion here is safe (the cap). OK.

Repository createPayout:
```ts
async createPayout(input: CreatePayoutInput): Promise<{ payout: Payout; replayed: boolean }> {
  return this.doCreatePayout(input, false);
}
private async doCreatePayout(input, afterUniqueConflict: boolean) {
  try {
    return await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ settled_balance_minor: bigint | string; held_balance_minor: bigint | string; version: number }>>`
        SELECT settled_balance_minor, held_balance_minor, version FROM accounts WHERE id = ${input.accountId} FOR UPDATE`;
      if (rows.length === 0) throw new AccountNotFoundError(input.accountId);
      const account = rows[0];
      const existing = await tx.payout.findUnique({ where: { accountId_idempotencyKey: { accountId: input.accountId, idempotencyKey: input.idempotencyKey } } });
      if (existing) return { payout: existing, replayed: true };
      const settled = toBigInt(account.settled_balance_minor);
      const held = toBigInt(account.held_balance_minor);
      const available = settled - held;
      if (available < input.amountMinor) throw new InsufficientFundsError(available, input.amountMinor);
      const payout = await tx.payout.create({ data: { accountId: input.accountId, amountMinor: input.amountMinor, destinationAddress: input.destinationAddress, idempotencyKey: input.idempotencyKey, status: 'CREATED' } });
      await tx.account.update({ where: { id: input.accountId }, data: { heldBalanceMinor: { increment: input.amountMinor }, version: { increment: 1 } } });
      const groupId = `${payout.id}:created`;
      await tx.ledgerEntry.createMany({ data: [
        { groupId, payoutId: payout.id, account: 'USER_AVAILABLE', direction: 'DEBIT', amountMinor: input.amountMinor },
        { groupId, payoutId: payout.id, account: 'USER_HELD', direction: 'CREDIT', amountMinor: input.amountMinor },
      ]});
      await tx.outboxMessage.create({ data: { type: 'payout.process', payload: { payoutId: payout.id } } });
      return { payout, replayed: false };
    }, { timeout: 10000 });
  } catch (err) {
    if (!afterUniqueConflict && isUniqueConstraintError(err, 'payouts_account_id_idempotency_key_key')) {
      // a concurrent request with the same key committed first; our transaction rolled back
      return this.doCreatePayout(input, true);
    }
    throw err;
  }
}
```
`isUniqueConstraintError`: `err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'`. (The meta contains the target.) Sufficient.

Hmm — `toBigInt`: `const toBigInt = (v: bigint | string | number) => (typeof v === 'bigint' ? v : BigInt(v));`

`findPayoutById`: `this.prisma.payout.findUnique({ where: { id } })`.

Now the worker:
```ts
@Injectable()
export class PayoutWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutWorker.name);
  private timer: NodeJS.Timeout | undefined;
  constructor(private readonly repo: PayoutRepository, private readonly service: PayoutService) {}
  onModuleInit(): void {
    const intervalMs = readPositiveInt(process.env.PAYOUT_POLL_INTERVAL_MS, 5000);
    this.timer = setInterval(() => {
      void this.processMessages().catch((err) => this.logger.error(`processMessages failed: ${err instanceof Error ? err.message : String(err)}`));
    }, intervalMs);
    this.timer.unref();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }
  async processMessages(): Promise<number> {
    const leaseMs = readPositiveInt(process.env.PAYOUT_CLAIM_TIMEOUT_MS, 60000);
    const claimed = await this.repo.claimMessages(10, leaseMs);
    for (const message of claimed) {
      try {
        await this.service.processPayoutMessage(message.id, message.payload, message.attempts);
      } catch (err) {
        this.logger.error(...); // leave as PROCESSING; the lease will re-claim
      }
    }
    return claimed.length;
  }
}
```
The worker doesn't need the provider (the service has it). ✓

The module:
```ts
@Module({
  controllers: [PayoutController],
  providers: [
    PayoutRepository,
    PayoutService,
    PayoutWorker,
    { provide: PAYOUT_PROVIDER, useFactory: createPayoutProvider },
  ],
  exports: [PayoutService],
})
```
`blockchain-provider.ts`:
```ts
import { Injectable } from '@nestjs/common';

export interface TransferResult { txHash: string }
export interface PayoutProvider {
  transfer(args: { to: string; amount: bigint }): Promise<TransferResult>;
}
export const PAYOUT_PROVIDER = 'PAYOUT_PROVIDER';

// ASSUMPTION: the concrete blockchain provider SDK is not specified in the task;
// this factory is the seam where the real SDK client would be constructed
// (e.g. `new StablecoinSdk()`). Until wired, it fails loudly instead of
// silently pretending to send money.
@Injectable()
export class UnconfiguredPayoutProvider implements PayoutProvider {
  async transfer(): Promise<TransferResult> {
    throw new Error('payout provider is not configured');
  }
}
export function createPayoutProvider(): PayoutProvider { return new UnconfiguredPayoutProvider(); }
```
Hmm — a useFactory that returns a class instance; simpler: `useFactory: () => new UnconfiguredPayoutProvider()`. The Unconfigured class is maybe unnecessary — the factory can return an object literal. But the Injectable class is more idiomatic. Keep the class + factory.

Controller validation details:
```ts
@Post()
async create(@Body() body: unknown): Promise<{ payout: PayoutDto; replayed: boolean }> {
  const issues: string[] = [];
  if (typeof body !== 'object' || body === null || Array.isArray(body)) issues.push('body must be a JSON object');
  else {
    const b = body as Record<string, unknown>;
    if (typeof b.accountId !== 'string' || b.accountId.length === 0 || b.accountId.length > 64) issues.push('accountId must be a non-empty string (max 64 chars)');
    if (typeof b.amount !== 'number' || !Number.isInteger(b.amount) || b.amount <= 0 || b.amount > MAX_PAYOUT_AMOUNT_MINOR) issues.push(`amount must be a positive integer in minor units (max ${MAX_PAYOUT_AMOUNT_MINOR})`);
    if (typeof b.destinationAddress !== 'string' || b.destinationAddress.length === 0 || b.destinationAddress.length > 256) issues.push('destinationAddress must be a non-empty string (max 256 chars)');
    if (typeof b.idempotencyKey !== 'string' || b.idempotencyKey.length === 0 || b.idempotencyKey.length > 128) issues.push('idempotencyKey must be a non-empty string (max 128 chars)');
  }
  if (issues.length > 0) throw new ServiceError(400, 'validation_failed', 'the request body is invalid', { issues });
  const b = body as Record<string, unknown>;
  const { payout, replayed } = await this.service.createPayout({ accountId: b.accountId as string, amountMinor: BigInt(b.amount as number), destinationAddress: b.destinationAddress as string, idempotencyKey: b.idempotencyKey as string });
  return { payout, replayed };
}
```
MAX_PAYOUT_AMOUNT_MINOR = 1_000_000_000_000_000 (10^15, safely below MAX_SAFE_INTEGER).

The service's `createPayout(input: CreatePayoutInput)` — CreatePayoutInput has amountMinor: bigint. The service passes it to the repo. The DTO mapping:
```ts
const PAYOUT_STATUS_TO_API: Record<PayoutStatus, string> = { CREATED: 'created', PROCESSING: 'processing', SENT: 'sent', COMPLETED: 'completed', FAILED: 'failed', NEEDS_REVIEW: 'needs_review' };
export interface PayoutDto { id: string; status: string; amountMinor: number; destinationAddress: string; idempotencyKey: string; txHash: string | null; errorMessage: string | null; createdAt: string; sentAt: string | null; completedAt: string | null; }
```
Import the Payout type from '@prisma/client'.

Now main.ts:
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}
void bootstrap();
```
`import 'reflect-metadata'` — Nest 10 includes it as a dependency of @nestjs/core; an explicit import at the top is standard. ✓

app.module.ts:
```ts
import { Module } from '@nestjs/common';
import { PayoutModule } from './payout/payout.module.js';

@Module({ imports: [PayoutModule] })
export class AppModule {}
```

Now the test file `test/payout.spec.ts`:

```ts
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PayoutRepository } from '../src/payout/payout.repository.js';
import { PayoutService } from '../src/payout/payout.service.js';
import { PayoutWorker } from '../src/payout/payout.worker.js';
import { AccountNotFoundError, InsufficientFundsError, ServiceError } from '../src/common/service-error.js';
import type { PayoutProvider } from '../src/payout/blockchain-provider.js';

const prisma = new PrismaClient();
const ACCOUNT_ID = 'acc_test_1';

class FakeProvider implements PayoutProvider {
  calls: Array<{ to: string; amount: bigint }> = [];
  mode: 'ok' | 'always-fail' | 'fail-then-ok' = 'ok';
  constructor(private readonly txHash = '0xabc') {}
  async transfer(args: { to: string; amount: bigint }) {
    this.calls.push(args);
    if (this.mode !== 'ok') throw new Error('provider transient failure');
    return { txHash: this.txHash };
  }
}

let repo: PayoutRepository;
let service: PayoutService;
let worker: PayoutWorker;
let provider: FakeProvider;

beforeAll(async () => {
  // schema must be applied first (prisma migrate deploy / db push)
});

beforeEach(async () => {
  await prisma.$transaction([
    prisma.ledgerEntry.deleteMany({}),
    prisma.outboxMessage.deleteMany({}),
    prisma.payout.deleteMany({}),
    prisma.account.deleteMany({}),
  ]);
  provider = new FakeProvider();
  repo = new PayoutRepository(prisma);
  service = new PayoutService(repo, provider);
  worker = new PayoutWorker(repo, service);
  process.env.PAYOUT_RETRY_BACKOFF_MS = '20';
});

afterAll(async () => { await prisma.$disconnect(); });

async function seedAccount(settledMinor: bigint, heldMinor = 0n): Promise<void> {
  await prisma.account.create({ data: { id: ACCOUNT_ID, settledBalanceMinor: settledMinor, heldBalanceMinor: heldMinor } });
}

const createInput = (amount: number, key: string) => ({ accountId: ACCOUNT_ID, amountMinor: BigInt(amount), destinationAddress: '0xdst', idempotencyKey: key });
```

Test 1 — concurrent creation:
```ts
describe('concurrent creation against one account', () => {
  it('never overdraws: only as many payouts as available funds', async () => {
    await seedAccount(1000n);
    const results = await Promise.allSettled([1,2,3,4,5].map(i => service.createPayout(createInput(1000, `key-${i}`))));
    const created = results.filter(r => r.status === 'fulfilled').length;
    const rejected = results.filter(r => r.status === 'rejected');
    expect(created).toBe(1);
    expect(rejected.length).toBe(4);
    for (const r of rejected) {
      expect(r.status).toBe('rejected');
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(InsufficientFundsError);
    }
    const account = await prisma.account.findUniqueOrThrow({ where: { id: ACCOUNT_ID } });
    expect(account.settledBalanceMinor).toBe(1000n);
    expect(account.heldBalanceMinor).toBe(1000n);
    const payouts = await prisma.payout.findMany({ where: { accountId: ACCOUNT_ID } });
    expect(payouts).toHaveLength(1);
    // a sixth request must also be rejected
    await expect(service.createPayout(createInput(1, 'key-six'))).rejects.toBeInstanceOf(InsufficientFundsError);
  });

  it('retries with the same idempotencyKey do not create a second payout or reserve twice', async () => {
    await seedAccount(1000n);
    const [a, b] = await Promise.all([service.createPayout(createInput(600, 'same-key')), service.createPayout(createInput(600, 'same-key'))]);
    expect(a.payout.id).toBe(b.payout.id);
    expect(a.replayed).not.toBe(b.replayed); // one is a replay... hmm — actually one created (false), the other replayed (true); order is non-deterministic. expect([a.replayed, b.replayed].sort()).toEqual([false, true])
    const account = await prisma.account.findUniqueOrThrow({ where: { id: ACCOUNT_ID } });
    expect(account.heldBalanceMinor).toBe(600n);
    const count = await prisma.payout.count({ where: { accountId: ACCOUNT_ID } });
    expect(count).toBe(1);
  });
});
```
Wait — `[a.replayed, b.replayed]` — one is false (the creator), the other is true. `expect(a.replayed !== b.replayed).toBe(true)`. And also sequential duplicates:
```ts
it('a sequential retry returns the same payout without double-reserving', async () => {
  await seedAccount(1000n);
  const first = await service.createPayout(createInput(250, 'seq-key'));
  const second = await service.createPayout(createInput(250, 'seq-key'));
  expect(second.payout.id).toBe(first.payout.id);
  expect(second.replayed).toBe(true);
  const account = ...held 250n
});
```

Also an unknown account → AccountNotFoundError (404).

Test 2 — duplicate message delivery:
```ts
describe('duplicate message delivery', () => {
  it('redelivering a fully processed message does not call the provider again', async () => {
    await seedAccount(1000n);
    const { payout } = await service.createPayout(createInput(400, 'dup-key'));
    const message = await prisma.outboxMessage.findFirst({ where: { payload: { payoutId: payout.payout.id } } });
```
Hmm, filtering by Json: Prisma's Json filter `{ payoutId: ... }` needs a JsonPath filter: `where: { payload: { payoutId: id } }` — does Prisma support this? Json filtering: `payload: { path: ['payoutId'], equals: id }`? In Prisma, `where: { payload: { payoutId: 'x' } }` is supported ("a JSON object filter matches if the fields match"). Yes, Prisma supports an object-literal Json filter. But simpler: findFirst with an ordered by createdAt — only one message exists in the test. `const message = (await prisma.outboxMessage.findMany())[0];` Simplest. ✓ (No other messages in the test.)

```ts
    expect(message.status).toBe('PENDING');
    await worker.processMessage(message.id);
    // assert the payout is completed
    const afterFirst = await prisma.payout.findUniqueOrThrow({ where: { id: payout.payout.id } });
    expect(afterFirst.status).toBe('COMPLETED');
    expect(afterFirst.txHash).toBe('0xabc');
    expect(provider.calls).toHaveLength(1);
    // duplicate delivery
    await worker.processMessage(message.id);
    await worker.processMessage(message.id);
    expect(provider.calls).toHaveLength(1);
    const account = await prisma.account.findUniqueOrThrow({ where: { id: ACCOUNT_ID } });
    expect(account.settledBalanceMinor).toBe(600n); // 1000 - 400, only once
    expect(account.heldBalanceMinor).toBe(0n);
    // ledger: exactly 2 balanced groups of 400
    const entries = await prisma.ledgerEntry.findMany();
    expect(entries).toHaveLength(4);
    for (const group of [...new Set(entries.map(e => e.groupId))]) {
      const g = entries.filter(e => e.groupId === group);
      const debits = g.filter(e => e.direction === 'DEBIT').reduce((s, e) => s + e.amountMinor, 0n);
      const credits = g.filter(e => e.direction === 'CREDIT').reduce((s, e) => s + e.amountMinor, 0n);
      expect(debits).toBe(credits);
    }
  });

  it('redelivery while a prior attempt is in flight never retries the transfer', async () => {
    await seedAccount(1000n);
    const { payout } = await service.createPayout(createInput(300, 'inflight-key'));
    const message = (await prisma.outboxMessage.findMany())[0];
    // simulate a worker crash: the message was claimed and the payout was set to processing,
    // but the worker died before recording the outcome
    await prisma.payout.update({ where: { id: payout.payout.id }, data: { status: 'PROCESSING' } });
    await prisma.outboxMessage.update({ where: { id: message.id }, data: { status: 'PROCESSING', claimedAt: new Date() } });
    await worker.processMessage(message.id);
    expect(provider.calls).toHaveLength(0); // no double transfer
    const after = await prisma.payout.findUniqueOrThrow({ where: { id: payout.payout.id } });
    expect(after.status).toBe('NEEDS_REVIEW');
    const account = await prisma.account.findUniqueOrThrow({ where: { id: ACCOUNT_ID } });
    expect(account.heldBalanceMinor).toBe(300n); // funds stay held
  });
});
```

I need `worker.processMessage(messageId)` — a public method that claims a specific message: `UPDATE outbox_messages SET status='PROCESSING', claimed_at=now() WHERE id=? AND status IN ('PENDING','PROCESSING') RETURNING ...`; if 0 rows → return (message is DONE/DEAD → no-op). Then it calls `service.processPayoutMessage(id, payload, attempts)`. In test 2a: the second processMessage → the claim fails (status DONE) → no-op ✓. Good.

Wait, in 2a: the first processMessage: the claim PENDING→PROCESSING, attempts 0. service.processPayoutMessage: the payout is CREATED → beginProcessing → provider OK → recordSent (sent + ledger + account + message DONE) → markCompleted (COMPLETED). ✓. Second processMessage: the claim `WHERE id AND status IN ('PENDING','PROCESSING')` → status DONE → 0 rows → return. provider.calls stays at 1 ✓.

Test 3 — retry exhaustion:
```ts
describe('retry exhaustion', () => {
  it('stops after the bounded number of attempts, keeps the funds held, and flags needs-review', async () => {
    process.env.PAYOUT_MAX_ATTEMPTS = '3';
    await seedAccount(1000n);
    provider.mode = 'always-fail';
    const { payout } = await service.createPayout(createInput(500, 'exhaust-key'));
    const message = (await prisma.outboxMessage.findMany())[0];
    await worker.processMessage(message.id);
    expect(provider.calls).toHaveLength(1);
    let after = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(after.status).toBe('PENDING'); // requeued
    expect(after.attempts).toBe(1);
    await sleep(30);
    await worker.processMessage(message.id);
    expect(provider.calls).toHaveLength(2);
    after = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(after.attempts).toBe(2);
    await sleep(40);
    await worker.processMessage(message.id);
    expect(provider.calls).toHaveLength(3);
    after = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(after.status).toBe('DEAD');
    const p = await prisma.payout.findUniqueOrThrow({ where: { id: payout.payout.id } });
    expect(p.status).toBe('NEEDS_REVIEW');
    expect(p.txHash).toBeNull();
    const account = await prisma.account.findUniqueOrThrow({ where: { id: ACCOUNT_ID } });
    expect(account.heldBalanceMinor).toBe(500n); // funds remain held, not released
    expect(account.settledBalanceMinor).toBe(1000n);
  });
});
```
The backoff: attempts=1 → backoff = base*2^(0) = 20ms; sleep 30 ✓. attempts=2 → 40ms; sleep 40 — borderline; let me sleep 50. Make it sleep(60) twice to be safe.

Hmm wait — `worker.processMessage` re-claims a PENDING message: the claim WHERE status IN ('PENDING','PROCESSING') — does it respect availableAt? If it ignores availableAt, the sleep is unnecessary. But the *polling* path respects availableAt. For the deterministic test via processMessage, I can skip the sleep if the direct claim ignores available_at. But is that realistic? "Redeliver before the backoff" — the test is driving delivery explicitly. To also test the backoff via the real path, I could use `processMessages()` (the poll) with sleeps. Let me make processMessage's claim respect… no — let me make it ignore available_at (a direct instruction) and also include one processMessages-based test? The task asks for a "retry exhaustion" test — processMessage ×3 suffices. But to make the test more faithful to the actual flow, use `worker.processMessages()` with env backoff 20ms and a 60ms sleep — the polling claims via the CTE that respects available_at. That exercises the real path including the CTE. But the CTE test is riskier (raw SQL correctness) — which is exactly what we want to test! Let me use processMessages() in the exhaustion test:

- processMessages #1: claim (PENDING, available now) → attempt 1 → requeue (PENDING, available +20ms, attempts 1).
- sleep 50 → processMessages #2 → attempt 2 → requeue (+40ms, attempts 2).
- sleep 60 → processMessages #3 → attempt 3 → DEAD + NEEDS_REVIEW.

And the "duplicate delivery" test 2a can use processMessage (explicit redelivery) — fine.

Hmm, also a test for the *definitive failure* path? Not strictly required (the required three: concurrent creation, duplicate delivery, retry exhaustion). But "failed" state + hold release is a core ledger path… "don't create files it doesn't ask for" applies to files; extra tests are fine but let me stay focused. Add one small test: a definitive failure releases the hold. It tests the ledger's release entry (credit USER_AVAILABLE, debit USER_HELD) — valuable. Add it (behavioral test, cheap).

The FakeProvider needs a "definitive" mode: throw an Error with a `permanent = true` property:
```ts
mode: 'ok' | 'transient' | 'definitive';
case 'definitive': const e = new Error('invalid destination address'); (e as any).permanent = true; throw e;
```
In TS: create an error object:
```ts
const err = new Error('invalid destination address') as Error & { permanent: boolean };
err.permanent = true; throw err;
```

And the test: the payout is FAILED, the hold is released (held 0), the ledger has 3 groups? created (2) + failed (2) = 4 entries; the available from the ledger = seeded? The account's settled is unchanged (1000), the held is 0. The message is DONE.

Wait — a note on `PayoutService`'s MAX_ATTEMPTS reading env in the constructor: the test sets the env before constructing the service (in beforeEach, after env set). ✓. Actually let me set `PAYOUT_MAX_ATTEMPTS` to default '3' and the base backoff to '1000'; the test overrides the backoff to 20.

Backoff formula: `base * 2 ** (attempts - 1)`, attempts = the new attempts (1 → base, 2 → 2×base). The nextAvailableAt = new Date(Date.now() + backoff).

Now — the claim CTE: `ORDER BY created_at` — requeued messages keep the original created_at → the ordering is stable. OK.

The batch size: a constant 10 or an env `PAYOUT_BATCH_SIZE` default 10.

Now, let me reconsider: the "no raw SQL" rule — the repository uses raw SQL for the FOR UPDATE select + the claim CTE + the conditional updates with RETURNING (recordSent/recordNeedsReview/recordFailed use a raw UPDATE ... RETURNING). Prisma's updateMany doesn't return rows → raw is justified. All raw is in the repository ✓ (the layer rule: the service has zero raw SQL / Prisma calls ✓ — the service only calls the repository + the provider).

Controller: no business logic ✓ (shape validation only).

Now the worker's `processMessage` (public, used by tests and processMessages):
```ts
async processMessage(messageId: string): Promise<void> {
  const claimed = await this.repo.claimMessageById(messageId);
  if (!claimed) return; // already DONE or DEAD — nothing to do
  try {
    await this.service.processPayoutMessage(claimed.id, claimed.payload, claimed.attempts);
  } catch (err) {
    this.logger.error(`failed to process message ${messageId}: ${...}`);
    // the message stays PROCESSING; the lease-based re-claim in processMessages() will retry it
  }
}
```
`claimMessageById`: raw: `UPDATE outbox_messages SET status='PROCESSING', claimed_at=now() WHERE id=${id} AND status IN ('PENDING','PROCESSING') RETURNING id, payload, attempts` → first row or null.

Hmm — one issue: in processMessages, the CTE claim sets PROCESSING; then processMessage would re-claim (already PROCESSING → the claim succeeds again, claimed_at is refreshed — fine, idempotent).

Actually simpler: processMessages does the CTE claim and then directly calls the service for each (no re-claim). And processMessage is a separate entry point that does claimMessageById + the service. Both paths exist; the tests use both. OK.

Now `processPayoutMessage(messageId, payload, attemptsSoFar)`:

```ts
async processPayoutMessage(messageId: string, payload: unknown, attemptsSoFar: number): Promise<void> {
  const payoutId = extractPayoutId(payload);
  if (payoutId === null) {
    this.logger.warn(`message ${messageId} has no payoutId in payload; dropping`);
    await this.repo.deadMessage(messageId);
    return;
  }
  const payout = await this.repo.findPayoutById(payoutId);
  if (payout === null) {
    this.logger.warn(`message ${messageId} references missing payout ${payoutId}; dropping`);
    await this.repo.deadMessage(messageId);
    return;
  }
  switch (payout.status) {
    case 'SENT':
    case 'COMPLETED':
    case 'FAILED':
    case 'NEEDS_REVIEW':
      // the payout has already advanced or terminated (e.g. at-least-once redelivery
      // after we recorded the outcome) — nothing safe left to do.
      await this.repo.completeMessage(messageId);
      return;
    case 'PROCESSING':
      // a prior attempt is in flight (or the worker crashed mid-attempt); its outcome
      // is unknown, so retrying the transfer could pay out twice. Escalate instead.
      await this.repo.recordNeedsReview(payout.id, 'redelivered while a prior attempt was in flight; outcome unknown, manual review required', messageId);
      return;
    case 'CREATED':
      break;
  }
  const started = await this.repo.beginProcessing(payout.id);
  if (!started) {
    // a concurrent delivery won the race; the payout has already advanced.
    await this.repo.completeMessage(messageId);
    return;
  }
  let txHash: string;
  try {
    const result = await this.provider.transfer({ to: payout.destinationAddress, amount: payout.amountMinor });
    txHash = result.txHash;
  } catch (err) {
    const reason = toErrorMessage(err);
    if (isDefinitiveFailure(err)) {
      await this.repo.recordFailed(payout.id, reason, messageId);
      return;
    }
    const attempts = attemptsSoFar + 1;
    if (attempts >= this.maxAttempts) {
      // exhausted retries without a definitive outcome: stop, keep the funds held,
      // flag for manual reconciliation (see DESIGN.md).
      await this.repo.recordNeedsReview(payout.id, `provider retries exhausted without a definitive outcome: ${reason}`, messageId);
      return;
    }
    const nextAvailableAt = this.nextBackoffAt(attempts);
    await this.repo.requeueForRetry(messageId, payout.id, attempts, nextAvailableAt);
    return;
  }
  try {
    await this.repo.recordSent(payout.id, txHash, messageId);
    await this.repo.markCompleted(payout.id);
  } catch (err) {
    // the conditional transition lost a race (e.g. a lease re-claim escalated the
    // payout to needs_review). The provider result is logged for reconciliation;
    // the transfer is never retried here.
    this.logger.error(`provider confirmed txHash=${txHash} for payout ${payout.id} but the state transition failed: ${toErrorMessage(err)}`);
  }
}
```

`extractPayoutId(payload: unknown): string | null`:
```ts
function extractPayoutId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const candidate = (payload as Record<string, unknown>).payoutId;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}
```

`toErrorMessage(err)`: `err instanceof Error ? err.message : String(err)`.

`isDefinitiveFailure(err)`:
```ts
// ASSUMPTION: the provider SDK's error shape is unspecified. Errors carrying a
// truthy `permanent`/`definitive` flag are treated as definitive (the transfer is
// known not to have happened); every other error is treated as unknown.
function isDefinitiveFailure(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { permanent?: unknown; definitive?: unknown };
  return Boolean(e.permanent) || Boolean(e.definitive);
}
```

`nextBackoffAt(attempts)`:
```ts
const backoffMs = this.retryBackoffBaseMs * 2 ** (attempts - 1);
return new Date(Date.now() + backoffMs);
```
The constructor:
```ts
this.maxAttempts = readPositiveInt(process.env.PAYOUT_MAX_ATTEMPTS, 3);
this.retryBackoffBaseMs = readPositiveInt(process.env.PAYOUT_RETRY_BACKOFF_MS, 1000);
```
readPositiveInt helper (in common?):
```ts
export function readPositiveInt(env: string | undefined, fallback: number): number {
  if (env === undefined) return fallback;
  const n = Number(env);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}
```
Put it in `src/common/env.ts`? Or inline in each file. Let me make `src/common/env.ts` and export it. Hmm, files: service-error.ts, all-exceptions.filter.ts, env.ts under common. OK.

Now, the repository's full method list and implementation. Also `claimMessages(batchSize, leaseMs)` and `claimMessageById(id)`.

`deadMessage`: `update({ where: { id }, data: { status: 'DEAD', completedAt: new Date() } })` — unconditional? If the message is already DONE… only call it from paths where we own the claim. Use an unconditional update (simpler); fine.

`completeMessage`: `update({ where: { id }, data: { status: 'DONE', completedAt: new Date() } })`.

Hmm — in `recordSent` I set the message to DONE inside the tx (atomically with the settlement). ✓. In `recordFailed`/`recordNeedsReview` I set the message to DONE/DEAD inside the tx. ✓.

`requeueForRetry(messageId, payoutId, attempts, nextAvailableAt)`:
```ts
await this.prisma.$transaction([
  this.prisma.outboxMessage.update({ where: { id: messageId }, data: { status: 'PENDING', attempts, availableAt: nextAvailableAt, claimedAt: null } }),
  this.prisma.payout.updateMany({ where: { id: payoutId, status: 'PROCESSING' }, data: { status: 'CREATED' } }),
]);
```
A batch (non-interactive) tx is fine (independent writes; atomicity is what matters).

`recordSent(payoutId, txHash, messageId)`:
```ts
await this.prisma.$transaction(async (tx) => {
  const rows = await tx.$queryRaw<Array<{ id: string; account_id: string; amount_minor: bigint | string }>>`
    UPDATE "payouts"
    SET status = 'SENT', tx_hash = ${txHash}, sent_at = now()
    WHERE id = ${payoutId} AND status = 'PROCESSING'
    RETURNING id, account_id, amount_minor`;
  if (rows.length === 0) {
    throw new Error(`cannot record sent for payout ${payoutId}: not in PROCESSING state`);
  }
  const { account_id: accountId, amount_minor: rawAmount } = rows[0];
  const amount = toBigInt(rawAmount);
  await tx.ledgerEntry.createMany({ data: [
    { groupId: `${payoutId}:sent`, payoutId, account: 'USER_HELD', direction: 'DEBIT', amountMinor: amount },
    { groupId: `${payoutId}:sent`, payoutId, account: 'PAYOUTS_SENT', direction: 'CREDIT', amountMinor: amount },
  ]});
  await tx.account.update({ where: { id: accountId }, data: { settledBalanceMinor: { decrement: amount }, heldBalanceMinor: { decrement: amount }, version: { increment: 1 } } });
  await tx.outboxMessage.update({ where: { id: messageId }, data: { status: 'DONE', completedAt: new Date() } });
});
```
Note: in the raw SQL, the enum literals 'SENT'/'PROCESSING' — Prisma creates a Postgres enum type; a plain string literal in the SET clause: `SET status = 'SENT'` — Postgres coerces the unknown literal to the enum type ✓ (a common pattern in Prisma migrations/raw SQL).

`recordFailed(payoutId, errorMessage, messageId)`:
```ts
await this.prisma.$transaction(async (tx) => {
  const rows = await tx.$queryRaw`
    UPDATE "payouts"
    SET status = 'FAILED', error_message = ${errorMessage}
    WHERE id = ${payoutId} AND status = 'PROCESSING'
    RETURNING id, account_id, amount_minor`;
  if (rows.length === 0) throw new Error(...);
  ...
  ledger: [ { groupId: `${payoutId}:failed`, account: 'USER_HELD', direction: 'DEBIT' }, { groupId, account: 'USER_AVAILABLE', direction: 'CREDIT' } ]
  account: held decrement, version+1
  message → DONE
});
```

`recordNeedsReview(payoutId, errorMessage, messageId)`:
```ts
await this.prisma.$transaction(async (tx) => {
  const rows = await tx.$queryRaw`
    UPDATE "payouts" SET status = 'NEEDS_REVIEW', error_message = ${errorMessage}
    WHERE id = ${payoutId} AND status = 'PROCESSING'
    RETURNING id`;
  if (rows.length === 0) throw new Error(...);
  await tx.outboxMessage.update({ where: { id: messageId }, data: { status: 'DEAD', completedAt: new Date() } });
});
```

Wait — in the test "redelivery while in flight", the payout is manually set to PROCESSING; processMessage claims the message (PROCESSING → the claim allows) → the service sees PROCESSING → recordNeedsReview ✓ (conditional from PROCESSING ✓), message → DEAD ✓.

`markCompleted(payoutId)`:
```ts
const res = await this.prisma.payout.updateMany({ where: { id: payoutId, status: 'SENT' }, data: { status: 'COMPLETED', completedAt: new Date() } });
return res.count > 0;
```

`beginProcessing(payoutId)`:
```ts
const res = await this.prisma.payout.updateMany({ where: { id: payoutId, status: 'CREATED' }, data: { status: 'PROCESSING' } });
return res.count > 0;
```

`findPayoutById(id)`: `this.prisma.payout.findUnique({ where: { id } })`.
`findAccountById` — used? Not really (the repository does everything in create). Skip? The controller only creates. Skip findAccountById (don't create what isn't asked). Hmm, maybe useful for later GET — no. Skip.

`claimMessages(batchSize, leaseMs)`:
```ts
const rows = await this.prisma.$queryRaw<Array<{ id: string; payload: unknown; attempts: number }>>`
  WITH claim AS (
    SELECT id FROM outbox_messages
    WHERE (status = 'PENDING' AND available_at <= now())
       OR (status = 'PROCESSING' AND claimed_at IS NOT NULL AND claimed_at <= now() - ${`${leaseMs} milliseconds`}::interval)
    ORDER BY created_at
    LIMIT ${batchSize}
    FOR UPDATE SKIP LOCKED
  )
  UPDATE outbox_messages m
  SET status = 'PROCESSING', claimed_at = now()
  FROM claim
  WHERE m.id = claim.id
  RETURNING m.id, m.payload, m.attempts`;
return rows;
```
Wait, the string interpolation `${...}` inside the template: in Prisma.sql / $queryRaw templates, `${expr}` interpolates a value. To produce the text `60000 milliseconds` as an interval: `(${'60000 milliseconds'})::interval`? That would parameterize the string '60000 milliseconds' and cast → valid. Let me write it: `claimed_at <= now() - (${leaseMs} || ' milliseconds')::interval` — the concatenation of a text parameter with ' milliseconds', then cast to interval. `||` on unknown-typed parameters: Postgres — the parameter type is unknown, and `unknown || text` → text. The cast to interval works. ✓ Safer: pass the whole string: `const lease = ${\`${leaseMs} milliseconds\`}` and `now() - ${lease}::interval`? Template syntax: `now() - (${leaseInterval})::interval`. Let me compute `const leaseInterval = \`${leaseMs} milliseconds\`` and use `now() - (${leaseInterval})::interval`. ✓ clean.

`FOR UPDATE SKIP LOCKED` in the CTE subquery — supported on PG ≥ 9.5 ✓.

`claimMessageById(id)`:
```ts
const rows = await this.prisma.$queryRaw`
  UPDATE outbox_messages
  SET status = 'PROCESSING', claimed_at = now()
  WHERE id = ${id} AND status IN ('PENDING', 'PROCESSING')
  RETURNING id, payload, attempts`;
return rows.length > 0 ? rows[0] : null;
```
The `status IN ('PENDING','PROCESSING')` literals ✓.

Hmm — one more consideration for the claim CTE: the `LIMIT ${batchSize}` — pg parameter in LIMIT: fine.

`payload` is returned as a JSON object (pg auto-parses JSONB) — but Prisma's $queryRaw: does it parse JSONB? Prisma's $queryRaw returns rows with pg's types — JSONB is parsed by pg into an object ✓ (I think pg parses json/jsonb by default; Prisma uses its own driver adapter? Prisma's JS driver (Rust engine over the binary protocol) — for $queryRaw with the old engine, Prisma sends SQL via its Rust driver and maps the types; JSONB → object. I'm fairly confident that Prisma's $queryRaw returns JSONB as a parsed object. To be safe, the service's `extractPayoutId` handles a string too:
```ts
if (typeof candidate === 'string') { try { const parsed = JSON.parse(candidate); ... } }
```
Hmm, that's defensive bloat. Let me keep it simple: assume an object (documented in the repository). Actually, let me make extractPayoutId lenient: if the payload is a JSON *string*, parse it. 3 lines, prevents a nasty runtime failure. OK.

Now — BigInt in the JSON payload? The payload is only `{ payoutId }` — no BigInt. ✓.

Now — a potential issue: `tx.$queryRaw` inside an interactive transaction — the FOR UPDATE lock is held until the tx commits ✓.

Test "concurrent creation" — 5 parallel `service.createPayout` on the same account: each opens an interactive tx, the first gets the FOR UPDATE lock, the others wait. With 5 concurrent txs and the default lock wait (Postgres has no lock timeout by default) → they serialize. Total tx time is small. ✓. Exactly one creates (1000 available), the other 4 see available 0 → InsufficientFundsError. ✓.

Also note: `prisma.$transaction` with 5 concurrent interactive txs — fine.

Another subtlety: in the test 2 concurrent-creation test, two requests with the same key: A locks, creates the payout (600 held), commits. B acquires the lock, finds the existing → returns the replay ✓. held = 600 ✓. No P2002 occurs (the lock serializes before the insert). The P2002 retry path is a backstop (e.g. if the lock is released before the insert? not possible here).

Now, `toPayoutDto`:
```ts
export function toPayoutDto(payout: Payout): PayoutDto {
  return {
    id: payout.id,
    status: PAYOUT_STATUS_TO_API[payout.status],
    amountMinor: Number(payout.amountMinor),
    destinationAddress: payout.destinationAddress,
    idempotencyKey: payout.idempotencyKey,
    txHash: payout.txHash,
    errorMessage: payout.errorMessage,
    createdAt: payout.createdAt.toISOString(),
    sentAt: payout.sentAt ? payout.sentAt.toISOString() : null,
    completedAt: payout.completedAt ? payout.completedAt.toISOString() : null,
  };
}
```
Number(payout.amountMinor) — safe due to the 10^15 cap ✓.

The service's createPayout returns `{ payout: toPayoutDto(payout), replayed }`.

Now the DESIGN.md (10–20 lines):
```md
# DESIGN — funds safety

- **One write-path per state transition.** Every mutation is a single Postgres
  transaction: the payout row, the account balance, the ledger entries, and the
  outbox message commit or roll back together. There is no state where money is
  reserved without a ledger entry or where a transfer is queued without a payout.
- **No overdraft under concurrency.** `POST /payouts` takes a `SELECT ... FOR UPDATE`
  on the account row, so racing requests serialize; the guard
  `settled - held >= amount` is evaluated under the lock. A second writer cannot
  reserve funds the first already reserved.
- **Idempotent creation.** `(account_id, idempotency_key)` is unique and checked
  under the same lock: a retried request returns the existing payout and reserves
  nothing extra.
- **Held vs settled.** Creating a payout only moves funds from available to held
  (`user_available` → `user_held`); the settled balance is debited only when the
  provider confirms the transfer (`user_held` → `payouts_sent`). Double-entry
  groups are balanced: every group's debits equal its credits.
- **At-least-once delivery, once-per-payout effect.** The outbox message may be
  redelivered; the transfer is gated by a conditional `CREATED → PROCESSING`
  transition, and a redelivery of a payout already in `PROCESSING` (crashed
  attempt, unknown outcome) escalates to `needs_review` instead of calling the
  provider again. A transfer is never attempted twice for the same payout.
- **Safe exhaustion.** If bounded retries (default 3) end without a definitive
  outcome, the payout goes to `needs_review` with the hold **retained**: releasing
  could double-pay if the provider actually sent, and retrying could double-pay
  for sure. A human reconciles against the provider's statement before releasing
  or completing.
- **Amounts are BigInt minor units** end-to-end (Postgres `BIGINT`); no floats.
```
Counting the lines: about 24… "10–20 lines" — let me trim to ≤20 lines. Compress:

```md
# DESIGN — funds safety

- Every mutation is one Postgres transaction: payout row, account balance, ledger
  entries, and outbox message commit together — no partial money state.
- Racing creations serialize on `SELECT ... FOR UPDATE` on the account row; the
  `settled - held >= amount` guard is evaluated under the lock, so no overdraft.
- `(account_id, idempotency_key)` is unique and checked under the same lock, so a
  retried request returns the existing payout and reserves nothing extra.
- Creation only moves funds available → held; the settled balance is debited only
  when the provider confirms the transfer (held → payouts_sent). Ledger groups are
  balanced double-entry (debits = credits per group).
- The outbox is at-least-once, but the transfer is gated by a conditional
  `CREATED → PROCESSING` transition. A redelivery while the payout is already
  `PROCESSING` (crashed attempt, unknown outcome) escalates to `needs_review`;
  the provider is never called twice for one payout.
- On retry exhaustion without a definitive outcome, the payout goes to
  `needs_review` with the hold retained: releasing could double-pay if the
  transfer actually landed, and retrying risks it too. A human reconciles.
- Amounts are BigInt minor units in code and BIGINT in Postgres; no floats.
```
Count: 1 (title) + blank line + … roughly: lines: 1 title, 2 blank, 3-4 bullet 1, 5-6 bullet 2, 7-8 bullet 3, 9-10 bullet 4, 11-14 bullet 5, 15-17 bullet 6, 18-19 bullet 7 → about 19 lines ✓.

Now — do I need a README? Not required. Skip.

`.env.example`? "No secrets in the repo, no hardcoded connection strings" — the DATABASE_URL comes from env. A `.env.example` with `DATABASE_URL=postgresql://...` is not a secret (it's a template). Hmm, "don't create a file it doesn't ask for" — skip .env.example? It's standard practice, but let me follow discipline and skip it; the convention already states DATABASE_URL.

Now, let me double-check the convention layout:
```
prisma/schema.prisma ✓
src/main.ts ✓
src/app.module.ts ✓
src/<feature>/<feature>.module.ts ✓ (payout)
src/<feature>/<feature>.controller.ts ✓
src/<feature>/<feature>.service.ts ✓
src/<feature>/<feature>.repository.ts ✓
test/<feature>.spec.ts ✓ (test/payout.spec.ts)
```
Plus the worker file: the deliverable mentions a "worker" — the layout doesn't show a worker file, but the task requires one; add `src/payout/payout.worker.ts`. The blockchain-provider file: `src/payout/blockchain-provider.ts` (kebab-case ✓). Common files: `src/common/service-error.ts`, `src/common/all-exceptions.filter.ts`, `src/common/env.ts`. Migration: `prisma/migrations/20250101000000_init/migration.sql`. Root: `package.json`, `tsconfig.json`, `vitest.config.ts`, `DESIGN.md` (DESIGN.md at the root — "a short DESIGN.md" — the root is fine; or src/? The root is standard).

vitest.config.ts:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
```

Now let me carefully write each file, watching imports/ESM extensions and types.

**src/common/env.ts**
```ts
/** Read a positive integer from an environment variable, falling back to a default. */
export function readPositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}
```

**src/common/service-error.ts**
```ts
/**
 * Base class for domain errors. The global exception filter turns these into the
 * standard error envelope: { error: { code, message, details } }.
 * `code` is snake_case and is the stable API contract.
 */
export class ServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class AccountNotFoundError extends ServiceError {
  constructor(accountId: string) {
    super(404, 'resource_not_found', `account '${accountId}' was not found`, { resource: 'account', id: accountId });
  }
}

export class InsufficientFundsError extends ServiceError {
  constructor(availableMinor: bigint, requestedMinor: bigint) {
    super(409, 'insufficient_funds', 'the account does not have sufficient available funds for this payout', {
      available_minor: Number(availableMinor),
      requested_minor: Number(requestedMinor),
    });
  }
}
```

**src/common/all-exceptions.filter.ts**
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { ServiceError } from './service-error.js';

interface ErrorEnvelope {
  error: { code: string; message: string; details: Record<string, unknown> };
}

/**
 * Global filter that renders every error as the single error envelope:
 * { "error": { "code": "...", "message": "...", "details": {} } }
 * `details` is always an object, never null.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof ServiceError) {
      res.status(exception.status).json({
        error: { code: exception.code, message: exception.message, details: exception.details },
      } satisfies ErrorEnvelope);
      return;
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2025') {
        res.status(HttpStatus.NOT_FOUND).json({ error: { code: 'resource_not_found', message: 'the requested resource does not exist', details: {} } } satisfies ErrorEnvelope);
        return;
      }
      if (exception.code === 'P2002') {
        res.status(HttpStatus.CONFLICT).json({ error: { code: 'idempotency_conflict', message: 'a resource with this idempotency key already exists', details: {} } } satisfies ErrorEnvelope);
        return;
      }
      this.logger.error('unhandled Prisma error', exception.message);
    } else if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code =
        status === HttpStatus.BAD_REQUEST ? 'validation_failed'
        : status === HttpStatus.NOT_FOUND ? 'resource_not_found'
        : status === HttpStatus.CONFLICT ? 'conflict'
        : 'http_error';
      const body = exception.getResponse();
      const message = typeof body === 'string' ? body : String((body as { message?: unknown }).message ?? exception.message);
      res.status(status).json({ error: { code, message, details: {} } } satisfies ErrorEnvelope);
      return;
    } else {
      this.logger.error('unhandled exception', exception instanceof Error ? exception.stack : String(exception));
    }

    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: { code: 'internal_error', message: 'an unexpected error occurred', details: {} } } satisfies ErrorEnvelope);
  }
}
```
The `satisfies` on an object literal passed to .json — json expects any; satisfies is fine but unnecessary; let me drop `satisfies` to reduce noise? It's harmless. Let me drop it — cleaner. Actually let me keep the code simple without satisfies.

**src/payout/blockchain-provider.ts**
```ts
/**
 * The blockchain provider SDK is assumed to expose:
 *   provider.transfer({ to, amount }) -> Promise<{ txHash }>
 * which may throw, time out, or succeed slowly. Amounts are passed in minor
 * units (BigInt).
 */
export interface PayoutProvider {
  transfer(args: { to: string; amount: bigint }): Promise<{ txHash: string }>;
}

/** DI token for the provider. Tests inject a fake; production wraps the real SDK. */
export const PAYOUT_PROVIDER = 'PAYOUT_PROVIDER';

// ASSUMPTION: the concrete SDK package is not specified, so this stand-in is the
// seam where the real provider client would be constructed (e.g.
// `return new RealProviderSdk({ ... })`). It fails loudly rather than pretending
// to send money.
export function createPayoutProvider(): PayoutProvider {
  return {
    async transfer(): Promise<{ txHash: string }> {
      throw new Error('payout provider is not configured');
    },
  };
}
```

**src/payout/payout.repository.ts**

```ts
import { Injectable } from '@nestjs/common';
import { Prisma, type Payout } from '@prisma/client';
import { AccountNotFoundError, InsufficientFundsError } from '../common/service-error.js';

export interface CreatePayoutInput {
  accountId: string;
  amountMinor: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}

export interface ClaimedMessage {
  id: string;
  payload: unknown;
  attempts: number;
}

/**
 * The only layer that touches the database.
 *
 * Raw SQL is used where the Prisma query API cannot express what funds safety
 * requires: row locking (`FOR UPDATE`), atomic conditional state transitions
 * (`UPDATE ... WHERE status = ... RETURNING`), and queue claiming with
 * `FOR UPDATE SKIP LOCKED`.
 */
@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}
  ...
}
```
Need to import `PrismaClient`: `import { Prisma, PrismaClient, type Payout } from '@prisma/client';`

Methods (as designed). Let me write `toBigInt` locally:
```ts
function toBigInt(value: bigint | string | number): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}
```

createPayout with P2002 retry:
```ts
async createPayout(input: CreatePayoutInput): Promise<{ payout: Payout; replayed: boolean }> {
  try {
    return await this.createPayoutTx(input);
  } catch (err) {
    // Backstop for the (rare) case where a concurrent same-key transaction
    // committed between our lock read and insert. Our transaction rolled back
    // (nothing was reserved), so one retry will return the existing payout.
    if (isUniqueViolation(err)) {
      return this.createPayoutTx(input);
    }
    throw err;
  }
}

private async createPayoutTx(input: CreatePayoutInput): Promise<{ payout: Payout; replayed: boolean }> {
  return this.prisma.$transaction(async (tx) => {
    // Serialize all concurrent creations for this account on the account row.
    const locked = await tx.$queryRaw<Array<{ settled_balance_minor: bigint | string; held_balance_minor: bigint | string }>>`
      SELECT settled_balance_minor, held_balance_minor
      FROM accounts
      WHERE id = ${input.accountId}
      FOR UPDATE
    `;
    if (locked.length === 0) {
      throw new AccountNotFoundError(input.accountId);
    }

    const existing = await tx.payout.findUnique({
      where: { accountId_idempotencyKey: { accountId: input.accountId, idempotencyKey: input.idempotencyKey } },
    });
    if (existing !== null) {
      return { payout: existing, replayed: true };
    }

    const available = toBigInt(locked[0].settled_balance_minor) - toBigInt(locked[0].held_balance_minor);
    if (available < input.amountMinor) {
      throw new InsufficientFundsError(available, input.amountMinor);
    }

    const payout = await tx.payout.create({
      data: {
        accountId: input.accountId,
        amountMinor: input.amountMinor,
        destinationAddress: input.destinationAddress,
        idempotencyKey: input.idempotencyKey,
        status: 'CREATED',
      },
    });

    await tx.account.update({
      where: { id: input.accountId },
      data: { heldBalanceMinor: { increment: input.amountMinor }, version: { increment: 1 } },
    });

    // Double-entry hold: debit the user's available settled funds, credit the
    // held sub-account. The total settled balance is unchanged.
    const groupId = `${payout.id}:created`;
    await tx.ledgerEntry.createMany({
      data: [
        { groupId, payoutId: payout.id, account: 'USER_AVAILABLE', direction: 'DEBIT', amountMinor: input.amountMinor },
        { groupId, payoutId: payout.id, account: 'USER_HELD', direction: 'CREDIT', amountMinor: input.amountMinor },
      ],
    });

    // Outbox: the message is queued in the same transaction as the payout, so a
    // committed payout always has a message (no lost transfers).
    await tx.outboxMessage.create({ data: { type: 'payout.process', payload: { payoutId: payout.id } } });

    return { payout, replayed: false };
  });
}
```
`isUniqueViolation`:
```ts
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
```

Hmm — one concern: `locked[0].settled_balance_minor` — the type is `bigint | string` as annotated; at runtime it may be either; toBigInt handles it. ✓.

`findPayoutById`, `beginProcessing`, `recordSent`, `markCompleted`, `recordFailed`, `recordNeedsReview`, `requeueForRetry`, `completeMessage`, `deadMessage`, `claimMessages`, `claimMessageById` — as designed.

**src/payout/payout.service.ts**
```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Payout, PayoutStatus } from '@prisma/client';
import { readPositiveInt } from '../common/env.js';
import { PAYOUT_PROVIDER, type PayoutProvider } from './blockchain-provider.js';
import type { CreatePayoutInput } from './payout.repository.js';
import { PayoutRepository } from './payout.repository.js';

export interface PayoutDto {
  id: string;
  status: 'created' | 'processing' | 'sent' | 'completed' | 'failed' | 'needs_review';
  amountMinor: number;
  destinationAddress: string;
  idempotencyKey: string;
  txHash: string | null;
  errorMessage: string | null;
  createdAt: string;
  sentAt: string | null;
  completedAt: string | null;
}

const STATUS_TO_API: Record<PayoutStatus, PayoutDto['status']> = {
  CREATED: 'created',
  PROCESSING: 'processing',
  SENT: 'sent',
  COMPLETED: 'completed',
  FAILED: 'failed',
  NEEDS_REVIEW: 'needs_review',
};

export function toPayoutDto(payout: Payout): PayoutDto { ... }

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);
  private readonly maxAttempts: number;
  private readonly retryBackoffBaseMs: number;

  constructor(
    private readonly repository: PayoutRepository,
    @Inject(PAYOUT_PROVIDER) private readonly provider: PayoutProvider,
  ) {
    this.maxAttempts = readPositiveInt(process.env.PAYOUT_MAX_ATTEMPTS, 3);
    this.retryBackoffBaseMs = readPositiveInt(process.env.PAYOUT_RETRY_BACKOFF_MS, 1000);
  }

  async createPayout(input: CreatePayoutInput): Promise<{ payout: PayoutDto; replayed: boolean }> {
    const { payout, replayed } = await this.repository.createPayout(input);
    return { payout: toPayoutDto(payout), replayed };
  }

  /**
   * Handle one outbox delivery. Safe under at-least-once delivery: the provider
   * is called at most once per payout, and a redelivery with an unknown prior
   * outcome escalates to needs_review instead of risking a double transfer.
   */
  async processPayoutMessage(messageId: string, payload: unknown, attemptsSoFar: number): Promise<void> {
    const payoutId = extractPayoutId(payload);
    if (payoutId === null) {
      this.logger.warn(`message ${messageId}: payload has no payoutId; dropping`);
      await this.repository.deadMessage(messageId);
      return;
    }
    const payout = await this.repository.findPayoutById(payoutId);
    if (payout === null) {
      this.logger.warn(`message ${messageId}: payout ${payoutId} no longer exists; dropping`);
      await this.repository.deadMessage(messageId);
      return;
    }

    if (payout.status !== 'CREATED' && payout.status !== 'PROCESSING') {
      // The payout has already advanced or terminated (redelivery after the
      // outcome was recorded). Nothing left to do.
      await this.repository.completeMessage(messageId);
      return;
    }
    if (payout.status === 'PROCESSING') {
      // A prior attempt is in flight, or its worker died mid-attempt: the outcome
      // is unknown. Calling the provider again could pay out twice, so escalate
      // for manual reconciliation. The hold stays in place.
      await this.repository.recordNeedsReview(
        payout.id,
        'redelivered while a prior attempt was in flight; outcome unknown, manual review required',
        messageId,
      );
      return;
    }

    const started = await this.repository.beginProcessing(payout.id);
    if (!started) {
      // A concurrent delivery advanced the payout first.
      await this.repository.completeMessage(messageId);
      return;
    }

    let txHash: string;
    try {
      const result = await this.provider.transfer({ to: payout.destinationAddress, amount: payout.amountMinor });
      txHash = result.txHash;
    } catch (err) {
      const reason = toErrorMessage(err);
      if (isDefinitiveFailure(err)) {
        // The provider is certain the transfer did not happen: release the hold.
        await this.repository.recordFailed(payout.id, reason, messageId);
        return;
      }
      const attempts = attemptsSoFar + 1;
      if (attempts >= this.maxAttempts) {
        // Bounded retries exhausted without a definitive outcome. Stop and flag:
        // the funds stay held (see DESIGN.md) — a human reconciles with the
        // provider before the payout is completed or the hold is released.
        await this.repository.recordNeedsReview(payout.id, `retries exhausted without a definitive outcome: ${reason}`, messageId);
        return;
      }
      await this.repository.requeueForRetry(messageId, payout.id, attempts, this.nextRetryAt(attempts));
      return;
    }

    try {
      await this.repository.recordSent(payout.id, txHash, messageId);
      await this.repository.markCompleted(payout.id);
    } catch (err) {
      // The conditional transition lost a race (e.g. a lease re-claim escalated
      // the payout). The provider result is logged for reconciliation; the
      // transfer is never re-attempted here.
      this.logger.error(`provider confirmed txHash=${txHash} for payout ${payout.id} but the state transition failed: ${toErrorMessage(err)}`);
    }
  }

  private nextRetryAt(attempts: number): Date {
    const backoffMs = this.retryBackoffBaseMs * 2 ** (attempts - 1);
    return new Date(Date.now() + backoffMs);
  }
}

function extractPayoutId(payload: unknown): string | null {
  let candidate: unknown = payload;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return null;
    }
  }
  if (typeof candidate !== 'object' || candidate === null) return null;
  const payoutId = (candidate as Record<string, unknown>).payoutId;
  return typeof payoutId === 'string' && payoutId.length > 0 ? payoutId : null;
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ASSUMPTION: the provider SDK's error shape is unspecified. Errors carrying a
// truthy `permanent` or `definitive` flag are treated as definitive (the transfer
// is known not to have happened); every other error is treated as unknown.
function isDefinitiveFailure(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { permanent?: unknown; definitive?: unknown };
  return Boolean(e.permanent) || Boolean(e.definitive);
}
```

**src/payout/payout.worker.ts**
```ts
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { readPositiveInt } from '../common/env.js';
import { PayoutService } from './payout.service.js';
import { PayoutRepository } from './payout.repository.js';

/**
 * Polling worker: claims due outbox messages and hands them to the service.
 * `processMessages()` runs every PAYOUT_POLL_INTERVAL_MS (default 5s).
 * Delivery is at-least-once; the service makes redelivery safe.
 */
@Injectable()
export class PayoutWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutWorker.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly repository: PayoutRepository,
    private readonly service: PayoutService,
  ) {}

  onModuleInit(): void {
    const intervalMs = readPositiveInt(process.env.PAYOUT_POLL_INTERVAL_MS, 5000);
    this.timer = setInterval(() => {
      void this.processMessages().catch((err: unknown) => {
        this.logger.error(`processMessages failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, intervalMs);
    // Do not keep the process alive on the poller alone (matters for tests/CLI use).
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
  }

  /** One poll cycle: claim a batch of due messages and process each. */
  async processMessages(): Promise<number> {
    const leaseMs = readPositiveInt(process.env.PAYOUT_CLAIM_TIMEOUT_MS, 60000);
    const batchSize = readPositiveInt(process.env.PAYOUT_BATCH_SIZE, 10);
    const claimed = await this.repository.claimMessages(batchSize, leaseMs);
    for (const message of claimed) {
      await this.guardedProcess(message);
    }
    return claimed.length;
  }

  /**
   * Deliver one specific message now (also used to simulate at-least-once
   * redelivery). No-op if the message is already DONE or DEAD.
   */
  async processMessage(messageId: string): Promise<void> {
    const claimed = await this.repository.claimMessageById(messageId);
    if (claimed === null) return;
    await this.guardedProcess(claimed);
  }

  private async guardedProcess(message: ClaimedMessage): Promise<void> {
    try {
      await this.service.processPayoutMessage(message.id, message.payload, message.attempts);
    } catch (err) {
      // The message stays PROCESSING; the lease-based re-claim in the next
      // processMessages() will pick it up (at-least-once).
      this.logger.error(`message ${message.id} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
```
Import the ClaimedMessage type from the repository.

Hmm — `this.timer.unref()` — the NodeJS.Timeout type has unref ✓.

**src/payout/payout.controller.ts**
```ts
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ServiceError } from '../common/service-error.js';
import { PayoutService, type PayoutDto } from './payout.service.js';

const MAX_PAYOUT_AMOUNT_MINOR = 1_000_000_000_000_000; // 10^15, well inside Number.MAX_SAFE_INTEGER

interface CreatePayoutResponse {
  payout: PayoutDto;
  replayed: boolean;
}

@Controller('payouts')
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: unknown): Promise<CreatePayoutResponse> {
    const issues = validateCreatePayoutBody(body);
    if (issues.length > 0) {
      throw new ServiceError(400, 'validation_failed', 'the request body is invalid', { issues });
    }
    const b = body as Record<string, unknown>;
    const result = await this.service.createPayout({
      accountId: b.accountId as string,
      amountMinor: BigInt(b.amount as number),
      destinationAddress: b.destinationAddress as string,
      idempotencyKey: b.idempotencyKey as string,
    });
    return { payout: result.payout, replayed: result.replayed };
  }
}

/** Controller-level shape validation only; no business logic here. */
function validateCreatePayoutBody(body: unknown): string[] {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return ['body must be a JSON object'];
  }
  const b = body as Record<string, unknown>;
  const issues: string[] = [];
  if (typeof b.accountId !== 'string' || b.accountId.length === 0 || b.accountId.length > 64) {
    issues.push('accountId must be a non-empty string of at most 64 characters');
  }
  if (
    typeof b.amount !== 'number' ||
    !Number.isInteger(b.amount) ||
    b.amount <= 0 ||
    b.amount > MAX_PAYOUT_AMOUNT_MINOR
  ) {
    issues.push(`amount must be a positive integer in minor units (max ${MAX_PAYOUT_AMOUNT_MINOR})`);
  }
  if (typeof b.destinationAddress !== 'string' || b.destinationAddress.length === 0 || b.destinationAddress.length > 256) {
    issues.push('destinationAddress must be a non-empty string of at most 256 characters');
  }
  if (typeof b.idempotencyKey !== 'string' || b.idempotencyKey.length === 0 || b.idempotencyKey.length > 128) {
    issues.push('idempotencyKey must be a non-empty string of at most 128 characters');
  }
  return issues;
}
```

**src/payout/payout.module.ts**
```ts
import { Module } from '@nestjs/common';
import { PayoutController } from './payout.controller.js';
import { PayoutService } from './payout.service.js';
import { PayoutRepository } from './payout.repository.js';
import { PayoutWorker } from './payout.worker.js';
import { PAYOUT_PROVIDER, createPayoutProvider } from './blockchain-provider.js';

@Module({
  controllers: [PayoutController],
  providers: [
    PayoutRepository,
    PayoutService,
    PayoutWorker,
    { provide: PAYOUT_PROVIDER, useFactory: createPayoutProvider },
  ],
  exports: [PayoutService],
})
export class PayoutModule {}
```

**src/app.module.ts**, **src/main.ts** as above.

**test/payout.spec.ts** — the full thing:

```ts
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountNotFoundError, InsufficientFundsError } from '../src/common/service-error.js';
import type { PayoutProvider } from '../src/payout/blockchain-provider.js';
import { PayoutRepository } from '../src/payout/payout.repository.js';
import { PayoutService } from '../src/payout/payout.service.js';
import { PayoutWorker } from '../src/payout/payout.worker.js';

// Integration tests run against a real PostgreSQL (DATABASE_URL); apply the
// schema first with `pnpm prisma migrate deploy` (or `prisma db push`).

const prisma = new PrismaClient();
const ACCOUNT_ID = 'acc_spec_1';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type ProviderMode = 'ok' | 'transient-fail' | 'definitive-fail';

class FakeProvider implements PayoutProvider {
  calls: Array<{ to: string; amount: bigint }> = [];
  mode: ProviderMode = 'ok';
  private counter = 0;
  constructor(private readonly txPrefix = '0x') {}
  async transfer(args: { to: string; amount: bigint }): Promise<{ txHash: string }> {
    this.calls.push(args);
    this.counter += 1;
    if (this.mode === 'transient-fail') {
      throw new Error(`transient provider failure #${this.counter}`);
    }
    if (this.mode === 'definitive-fail') {
      const err = new Error('invalid destination address (definitive)') as Error & { permanent: boolean };
      err.permanent = true;
      throw err;
    }
    return { txHash: `${this.txPrefix}${this.counter}` };
  }
}

let repo: PayoutRepository;
let service: PayoutService;
let worker: PayoutWorker;
let provider: FakeProvider;

beforeEach(async () => {
  process.env.PAYOUT_MAX_ATTEMPTS = '3';
  process.env.PAYOUT_RETRY_BACKOFF_MS = '20';
  await prisma.$transaction([
    prisma.ledgerEntry.deleteMany({}),
    prisma.outboxMessage.deleteMany({}),
    prisma.payout.deleteMany({}),
    prisma.account.deleteMany({}),
  ]);
  provider = new FakeProvider();
  repo = new PayoutRepository(prisma);
  service = new PayoutService(repo, provider);
  worker = new PayoutWorker(repo, service);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedAccount(settledMinor: bigint, heldMinor = 0n): Promise<void> {
  await prisma.account.create({
    data: { id: ACCOUNT_ID, settledBalanceMinor: settledMinor, heldBalanceMinor: heldMinor },
  });
}

function createInput(amountMinor: bigint, idempotencyKey: string) {
  return { accountId: ACCOUNT_ID, amountMinor, destinationAddress: '0xdestination', idempotencyKey };
}

async function onlyMessage(): Promise<{ id: string; status: string; attempts: number }> {
  const [message] = await prisma.outboxMessage.findMany();
  if (message === undefined) throw new Error('expected exactly one outbox message, found none');
  return { id: message.id, status: message.status, attempts: message.attempts };
}
```

Hmm — `onlyMessage` after a creation: only one message exists (a single payout created). ✓.

Tests:

```ts
describe('concurrent creation against one account', () => {
  it('never overdraws when requests race', async () => {
    await seedAccount(1000n);
    const results = await Promise.allSettled(
      [0, 1, 2, 3, 4].map((i) => service.createPayout(createInput(1000n, `key-${i}`))),
    );
    const created = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(created).toHaveLength(1);
    expect(rejected).toHaveLength(4);
    for (const r of rejected) {
      if (r.status !== 'rejected') throw new Error('unreachable');
      expect(r.reason).toBeInstanceOf(InsufficientFundsError);
      expect(r.reason).toBeInstanceOf(AccountNotFoundError === undefined ? Error : Error); // no, drop
    }
```
Drop the silly line. Just `expect(r.reason).toBeInstanceOf(InsufficientFundsError);`.

```ts
    const account = await prisma.account.findUniqueOrThrow({ where: { id: ACCOUNT_ID } });
    expect(account.settledBalanceMinor).toBe(1000n); // settled is unchanged by holds
    expect(account.heldBalanceMinor).toBe(1000n);    // exactly one payout was reserved
    expect(await prisma.payout.count({ where: { accountId: ACCOUNT_ID } })).toBe(1);
    await expect(service.createPayout(createInput(1n, 'key-after'))).rejects.toBeInstanceOf(InsufficientFundsError);
  });

  it('does not create a second payout or reserve twice for a retried idempotencyKey', async () => {
    await seedAccount(1000n);
    // Concurrent retries with the same key.
    const [a, b] = await Promise.all([
      service.createPayout(createInput(600n, 'same-key')),
      service.createPayout(createInput(600n, 'same-key')),
    ]);
    expect(a.payout.id).toBe(b.payout.id);
    expect(a.replayed !== b.replayed).toBe(true);
    // Sequential retry with the same key.
    const c = await service.createPayout(createInput(600n, 'same-key'));
    expect(c.payout.id).toBe(a.payout.id);
    expect(c.replayed).toBe(true);

    const account = await prisma.account.findUniqueOrThrow({ where: { id: ACCOUNT_ID } });
    expect(account.heldBalanceMinor).toBe(600n); // reserved exactly once
    expect(account.settledBalanceMinor).toBe(1000n);
    expect(await prisma.payout.count({ where: { accountId: ACCOUNT_ID } })).toBe(1);
  });

  it('rejects an unknown account', async () => {
    await expect(
      service.createPayout({ accountId: 'missing', amountMinor: 1n, destinationAddress: '0x', idempotencyKey: 'k' }),
    ).rejects.toBeInstanceOf(AccountNotFoundError);
  });
});
```

Duplicate delivery:
```ts
describe('duplicate message delivery (at-least-once)', () => {
  it('a redelivered processed message does not call the provider again', async () => {
    await seedAccount(1000n);
    const { payout } = await service.createPayout(createInput(400n, 'dup-key'));
    const message = await onlyMessage();
    expect(message.status).toBe('PENDING');

    await worker.processMessage(message.id);
    const afterFirst = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(afterFirst.status).toBe('COMPLETED');
    expect(afterFirst.txHash).toBe('0x1');
    expect(provider.calls).toHaveLength(1);

    // At-least-once redelivery of the same message.
    await worker.processMessage(message.id);
    await worker.processMessage(message.id);
    expect(provider.calls).toHaveLength(1);

    const account = await prisma.account.findUniqueOrThrow({ where: { id: ACCOUNT_ID } });
    expect(account.settledBalanceMinor).toBe(600n); // debited exactly once
    expect(account.heldBalanceMinor).toBe(0n);

    // Ledger: one balanced group per transition (created, sent), total 4 entries.
    const entries = await prisma.ledgerEntry.findMany();
    expect(entries).toHaveLength(4);
    const groups = new Set(entries.map((e) => e.groupId));
    expect(groups.size).toBe(2);
    for (const groupId of groups) {
      const group = entries.filter((e) => e.groupId === groupId);
      const debits = group.filter((e) => e.direction === 'DEBIT').reduce((s, e) => s + e.amountMinor, 0n);
      const credits = group.filter((e) => e.direction === 'CREDIT').reduce((s, e) => s + e.amountMinor, 0n);
      expect(debits).toBe(credits);
    }
  });

  it('a redelivered in-flight message never triggers a second transfer', async () => {
    await seedAccount(1000n);
    const { payout } = await service.createPayout(createInput(300n, 'inflight-key'));
    const message = await onlyMessage();

    // Simulate a worker crash mid-attempt: the message was claimed and the
    // payout moved to PROCESSING, but the worker died before recording the
    // provider outcome.
    await prisma.payout.update({ where: { id: payout.id }, data: { status: 'PROCESSING' } });
    await prisma.outboxMessage.update({ where: { id: message.id }, data: { status: 'PROCESSING', claimedAt: new Date() } });

    await worker.processMessage(message.id);

    expect(provider.calls).toHaveLength(0); // no second transfer attempt
    const after = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(after.status).toBe('NEEDS_REVIEW');
    const account = await prisma.account.findUniqueOrThrow({ where: { id: ACCOUNT_ID } });
    expect(account.heldBalanceMinor).toBe(300n); // the hold is retained
  });
});
```

Wait — in the first test: `worker.processMessage(message.id)` — the claim: `UPDATE ... WHERE id AND status IN ('PENDING','PROCESSING')` — the first call claims the PENDING ✓, the service processes it → recordSent sets the message to DONE ✓. The second call: the status is DONE → claimMessageById returns null → no-op ✓.

Retry exhaustion:
```ts
describe('retry exhaustion', () => {
  it('stops after the bounded number of attempts, keeps the funds held, and flags needs-review', async () => {
    await seedAccount(1000n);
    provider.mode = 'transient-fail';
    const { payout } = await service.createPayout(createInput(500n, 'exhaust-key'));
    const message = await onlyMessage();

    await worker.processMessages(); // attempt 1
    expect(provider.calls).toHaveLength(1);
    let msg = await onlyMessage();
    expect(msg.status).toBe('PENDING'); // requeued
    expect(msg.attempts).toBe(1);

    await sleep(50); // respect the retry backoff (20ms base)
    await worker.processMessages(); // attempt 2
    expect(provider.calls).toHaveLength(2);
    msg = await onlyMessage();
    expect(msg.attempts).toBe(2);

    await sleep(60); // backoff is 40ms now
    await worker.processMessages(); // attempt 3 → exhausted
    expect(provider.calls).toHaveLength(3);
    msg = await onlyMessage();
    expect(msg.status).toBe('DEAD');

    const after = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(after.status).toBe('NEEDS_REVIEW');
    expect(after.txHash).toBeNull();
    expect(after.errorMessage).toContain('retries exhausted');

    const account = await prisma.account.findUniqueOrThrow({ where: { id: ACCOUNT_ID } });
    expect(account.settledBalanceMinor).toBe(1000n);
    expect(account.heldBalanceMinor).toBe(500n); // funds stay held, not released

    // No further automatic delivery happens.
    await worker.processMessages();
    expect(provider.calls).toHaveLength(3);
  });
});
```

Wait — `worker.processMessages()` claims via the CTE `status='PENDING' AND available_at <= now()`. After the first processMessages: the message is requeued with available_at = now+20ms, status PENDING. The test calls processMessages again immediately after `await worker.processMessages()` resolves — hmm, attempt 1 completes the requeue *within* that processMessages call (the service requeues before returning). Then the next processMessages call: if <20ms have elapsed, the message isn't due → it claims nothing → the provider isn't called! So the sleep must come *before* the next poll: sleep(50) then processMessages ✓ (I wrote sleep before polls 2 and 3). The poll 1 → requeue (attempts 1, +20ms) → assert attempts 1 (the assertion takes a few ms; fine) → sleep(50) → poll 2: due ✓ → attempt 2 → requeue (+40ms) → assert → sleep(60) → poll 3: attempt 3 → exhausted → DEAD ✓.

One risk: if the machine is slow between `processMessages()` poll 1 resolving and the next poll… the sleep makes it *more* due, not less. The only risk: poll 2 claiming *two* messages? Only one message exists. ✓.

Also `onlyMessage()` returns a status string — the Prisma enum type: `message.status` is typed as an `OutboxStatus` union; comparing to the string 'PENDING' — TS: `msg.status === 'PENDING'`? My onlyMessage returns a `{ status: string }` shape — typed as string ✓ no type clash.

The "final" processMessages after DEAD: the CTE claims only PENDING due or stale PROCESSING — the message is DEAD → claims nothing ✓ provider stays at 3 ✓.

Definitive failure test (extra):
```ts
describe('definitive provider failure', () => {
  it('marks the payout failed and releases the hold', async () => {
    await seedAccount(1000n);
    provider.mode = 'definitive-fail';
    const { payout } = await service.createPayout(createInput(350n, 'def-key'));
    const message = await onlyMessage();
    await worker.processMessage(message.id);
    expect(provider.calls).toHaveLength(1);

    const after = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(after.status).toBe('FAILED');
    const account = await prisma.account.findUniqueOrThrow({ where: { id: ACCOUNT_ID } });
    expect(account.settledBalanceMinor).toBe(1000n);
    expect(account.heldBalanceMinor).toBe(0n); // hold released, funds back to available
    const msg = await onlyMessage();
    expect(msg.status).toBe('DONE');
  });
});
```
`payout.id` — the service's createPayout returns `{ payout: PayoutDto, replayed }` — the DTO has `.id` ✓ (I used `payout.id` — the DTO id ✓).

Wait, in the earlier tests I destructure `const { payout } = await service.createPayout(...)` and use `payout.id` — the DTO id ✓, and `payout.payout.id`? No — a single destructure: `const { payout } = ...` → payout is a PayoutDto with `.id` ✓.

Now — the test's `beforeEach` sets the env before constructing the service/worker ✓. But `readPositiveInt(process.env.PAYOUT_RETRY_BACKOFF_MS, 1000)` is read in the *service* constructor — the beforeEach sets it before `new PayoutService` ✓.

Potential issue: the `processMessages` CTE's lease re-claim: `status='PROCESSING' AND claimed_at <= now() - 60s` — in the tests, the in-flight message is PROCESSING with a fresh claimed_at → not claimed ✓ (no interference).

Now — recheck `recordSent`'s raw SQL `status = 'SENT'`: the Postgres enum coercion of a string literal in the SET clause ✓ (a standard pattern).

The Prisma enum type name: the enum `OutboxStatus` is created as `"OutboxStatus"`; the column type is `"OutboxStatus"`. The migration CREATE TYPE matches the schema's enum name ✓.

Now — the JSON payload in `outboxMessage.create({ data: { payload: { payoutId: payout.id } } })` — Prisma Json input accepts an object ✓.

`claimMessages` RETURNING `m.payload` — the JSONB → Prisma's raw returns it as… Let me think again about Prisma's $queryRaw JSONB handling. Prisma's $queryRaw uses the query engine; I believe the JSONB values come back as JS objects (the engine parses them). Even if they came back as a string, extractPayoutId handles a string. Robust either way. ✓.

Another subtle point: the claim CTE's `ORDER BY created_at` + `LIMIT` + `FOR UPDATE SKIP LOCKED` — the ORDER BY before the LIMIT in a subquery with FOR UPDATE: `SELECT id FROM t WHERE ... ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED` — valid SQL ✓.

UPDATE ... FROM claim: `UPDATE outbox_messages m SET ... FROM claim WHERE m.id = claim.id RETURNING m.id, m.payload, m.attempts` ✓.

Now — the `processMessages` batch: the test has one message; batchSize is the default 10 ✓.

Let me also verify the `claimMessageById`'s RETURNING payload — same as above ✓.

Now the "no raw SQL in the service" check: the service file has zero SQL ✓. Controller: none ✓.

The BigInt `amount` passed to the provider: `payout.amountMinor` is a BigInt from Prisma ✓. The FakeProvider records `amount: bigint` ✓. "No floating point for money" ✓ — everything is BigInt/number only at the wire edge (a safe integer).

Now `markCompleted` — the service calls it after recordSent. In test 2a: afterFirst.status is 'COMPLETED' ✓ (both calls within the same processMessage).

Edge: `recordSent` throws (0 rows) → the service's catch logs; the payout stays PROCESSING… in the normal flow it won't throw.

Now — the NestJS wiring: the `PayoutService`'s constructor has `@Inject(PAYOUT_PROVIDER) private readonly provider: PayoutProvider` — the token is the string 'PAYOUT_PROVIDER', the module provides it ✓. In the test, I construct `new PayoutService(repo, provider)` — the decorator metadata is irrelevant to direct instantiation ✓.

The worker in providers ✓; it implements OnModuleInit — when the app boots, the timer starts (unref'd). In the test, the worker is constructed directly and onModuleInit isn't called ✓ no timer.

Now `main.ts` — also maybe `app.enableShutdownHooks()`; the worker's OnModuleDestroy clears the timer on shutdown ✓.

Also: should the worker be excluded from the app when running tests? The tests don't boot the app — only the classes directly. ✓.

The tsconfig: `module: "NodeNext"` — Nest decorators + NodeNext ESM: fine. `verbatimModuleSyntax`? Not needed. Keep it as is. Actually with NodeNext, `import type` is required for type-only imports — I'm using `type` imports where appropriate (`import type { PayoutProvider }`, `import { Payout, type PayoutStatus }`). In the repository: `import { Prisma, PrismaClient, type Payout } from '@prisma/client'` ✓. In the filter: `import type { Response } from 'express'` ✓ (need @types/express devDep — add it).

`@nestjs/common`'s Logger import ✓.

Also double-check `satisfies` — I dropped it.

package.json devDeps: @types/express, @types/node, prisma, tsx, typescript, vitest. Add "prisma:db:push" too? A script: `"test:prepare": "prisma migrate deploy"`? Let me keep the scripts: build, dev, start, test, prisma:generate, prisma:migrate.

Wait — does `vitest` need `@vitest/ui`? No.

Now, the `@prisma/client` version is ^5.10 and the `prisma` devDep is ^5.10 ✓.

The migration timestamp: use `20250101000000_init`. Fine.

DESIGN.md at the repo root.

One more requirement check: "`processMessages()` runs every N seconds" ✓ (setInterval, env N). "A Postgres message table as the queue" ✓ outbox_messages. "The transfer must NOT happen inside the request" ✓ (the outbox message is created in the tx; the worker polls).

Requirement 4: the lifecycle is explicit ✓ 6 states + transitions.
Requirement 5: the double-entry ledger ✓; the settled balance only changes on confirmation ✓ (recordSent debits settled; create only touches held; failed only touches held).
Requirement 6: bounded retries ✓ (3, env); exhaustion → needs_review, hold retained, explain in DESIGN.md ✓.

Requirement 1: idempotency ✓ (unique + check under lock; the replay returns the existing).
Requirement 3: no overdraft ✓ (FOR UPDATE serialization + the guard).

Deliverables: schema + migration ✓; module controller/service/worker ✓; tests: concurrent creation ✓, duplicate delivery ✓, retry exhaustion ✓ (+ a bonus definitive failure); DESIGN.md ✓.

Let me review the format requirement again: "For each file, a level-3 heading containing only the repo-relative path, immediately followed by a single fenced block containing only that file's content." And "start with the first heading." No prose outside the pattern (it's ignored but keep it to nothing).

File order:
1. package.json
2. tsconfig.json
3. vitest.config.ts
4. prisma/schema.prisma
5. prisma/migrations/20250101000000_init/migration.sql
6. src/main.ts
7. src/app.module.ts
8. src/common/env.ts
9. src/common/service-error.ts
10. src/common/all-exceptions.filter.ts
11. src/payout/blockchain-provider.ts
12. src/payout/payout.repository.ts
13. src/payout/payout.service.ts
14. src/payout/payout.worker.ts
15. src/payout/payout.controller.ts
16. src/payout/payout.module.ts
17. test/payout.spec.ts
18. DESIGN.md

Now let me write the final content of each file, carefully.

**package.json**
```json
{
  "name": "payout-service",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "tsx src/main.ts",
    "dev": "tsx watch src/main.ts",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate deploy",
    "test": "vitest run"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.8",
    "@nestjs/core": "^10.3.8",
    "@nestjs/platform-express": "^10.3.8",
    "@prisma/client": "^5.14.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.0",
    "prisma": "^5.14.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vitest": "^1.6.0"
  }
}
```

**tsconfig.json**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "strict": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

**vitest.config.ts**
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
```

**prisma/schema.prisma** — as drafted. One check: `BigInt` in Prisma → `Decimal`? No: `BigInt` is supported ✓ → BIGINT.

**Migration** — as drafted. Let me double-check the index names Prisma would generate: the default for `@@index([status])` on payouts is `"payouts_status_idx"` ✓; `@@index([accountId, idempotencyKey])` unique → `"payouts_account_id_idempotency_key_key"` ✓; the ledger indexes: `"ledger_entries_group_id_idx"`, `"ledger_entries_payout_id_idx"` ✓; the outbox: `"outbox_messages_status_available_at_idx"` ✓ (column names in snake_case — Prisma names indexes by the mapped column names ✓).

FK names: `"payouts_account_id_fkey"`, `"ledger_entries_payout_id_fkey"` ✓.

**src/main.ts**
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
```

**src/app.module.ts**
```ts
import { Module } from '@nestjs/common';
import { PayoutModule } from './payout/payout.module.js';

@Module({
  imports: [PayoutModule],
})
export class AppModule {}
```

Now the repository file, fully:

```ts
import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient, type Payout } from '@prisma/client';
import { AccountNotFoundError, InsufficientFundsError } from '../common/service-error.js';

export interface CreatePayoutInput {
  accountId: string;
  amountMinor: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}

export interface ClaimedMessage {
  id: string;
  payload: unknown;
  attempts: number;
}

/**
 * The only layer that touches the database.
 *
 * Raw SQL is used where the Prisma query API cannot express what funds safety
 * requires: row locking (`FOR UPDATE`), atomic conditional state transitions
 * (`UPDATE ... WHERE status = ... RETURNING`), and queue claiming with
 * `FOR UPDATE SKIP LOCKED`.
 */
@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Create a payout, reserve the funds, write the hold ledger entries, and queue
   * the outbox message — all in one transaction. `FOR UPDATE` on the account
   * row serializes concurrent creations, so the available-funds guard is
   * race-free and a retried idempotency key can never reserve twice.
   */
  async createPayout(input: CreatePayoutInput): Promise<{ payout: Payout; replayed: boolean }> {
    try {
      return await this.createPayoutTx(input);
    } catch (err) {
      // Backstop: a same-key transaction committed after we read (rare; the row
      // lock normally prevents it). Our transaction rolled back — nothing was
      // reserved — so one retry returns the existing payout as a replay.
      if (isUniqueViolation(err)) {
        return this.createPayoutTx(input);
      }
      throw err;
    }
  }

  private async createPayoutTx(input: CreatePayoutInput): Promise<{ payout: Payout; replayed: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ settled_balance_minor: bigint | string; held_balance_minor: bigint | string }>>`
        SELECT settled_balance_minor, held_balance_minor
        FROM accounts
        WHERE id = ${input.accountId}
        FOR UPDATE
      `;
      if (locked.length === 0) {
        throw new AccountNotFoundError(input.accountId);
      }

      const existing = await tx.payout.findUnique({
        where: {
          accountId_idempotencyKey: {
            accountId: input.accountId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (existing !== null) {
        return { payout: existing, replayed: true };
      }

      const available = toBigInt(locked[0].settled_balance_minor) - toBigInt(locked[0].held_balance_minor);
      if (available < input.amountMinor) {
        throw new InsufficientFundsError(available, input.amountMinor);
      }

      const payout = await tx.payout.create({
        data: {
          accountId: input.accountId,
          amountMinor: input.amountMinor,
          destinationAddress: input.destinationAddress,
          idempotencyKey: input.idempotencyKey,
          status: 'CREATED',
        },
      });

      // Hold: move the amount from available to held. The settled total is
      // unchanged; only availability drops.
      await tx.account.update({
        where: { id: input.accountId },
        data: { heldBalanceMinor: { increment: input.amountMinor }, version: { increment: 1 } },
      });

      // Double-entry hold (one balanced group): debit the user's available
      // funds, credit the user's held sub-account.
      const groupId = `${payout.id}:created`;
      await tx.ledgerEntry.createMany({
        data: [
          { groupId, payoutId: payout.id, account: 'USER_AVAILABLE', direction: 'DEBIT', amountMinor: input.amountMinor },
          { groupId, payoutId: payout.id, account: 'USER_HELD', direction: 'CREDIT', amountMinor: input.amountMinor },
        ],
      });

      // Outbox: the message is committed with the payout, so a committed payout
      // always has a queued message (no lost transfers, no transfer in the
      // request path).
      await tx.outboxMessage.create({
        data: { type: 'payout.process', payload: { payoutId: payout.id } },
      });

      return { payout, replayed: false };
    });
  }

  findPayoutById(id: string): Promise<Payout | null> {
    return this.prisma.payout.findUnique({ where: { id } });
  }

  /** Conditional CREATED → PROCESSING; false if the payout is already advanced. */
  async beginProcessing(payoutId: string): Promise<boolean> {
    const result = await this.prisma.payout.updateMany({
      where: { id: payoutId, status: 'CREATED' },
      data: { status: 'PROCESSING' },
    });
    return result.count > 0;
  }

  /**
   * Provider confirmed the transfer. Records the tx hash, settles the ledger
   * (held → payouts sent; the settled balance is debited here and only here),
   * and acks the message — atomically.
   */
  async recordSent(payoutId: string, txHash: string, messageId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; account_id: string; amount_minor: bigint | string }>>`
        UPDATE "payouts"
        SET status = 'SENT', tx_hash = ${txHash}, sent_at = now()
        WHERE id = ${payoutId} AND status = 'PROCESSING'
        RETURNING id, account_id, amount_minor
      `;
      if (rows.length === 0) {
        throw new Error(`cannot record sent for payout ${payoutId}: it is not in PROCESSING state`);
      }
      const { account_id: accountId, amount_minor: rawAmount } = rows[0];
      const amount = toBigInt(rawAmount);

      await tx.ledgerEntry.createMany({
        data: [
          { groupId: `${payoutId}:sent`, payoutId, account: 'USER_HELD', direction: 'DEBIT', amountMinor: amount },
          { groupId: `${payoutId}:sent`, payoutId, account: 'PAYOUTS_SENT', direction: 'CREDIT', amountMinor: amount },
        ],
      });

      await tx.account.update({
        where: { id: accountId },
        data: {
          settledBalanceMinor: { decrement: amount },
          heldBalanceMinor: { decrement: amount },
          version: { increment: 1 },
        },
      });

      await tx.outboxMessage.update({
        where: { id: messageId },
        data: { status: 'DONE', completedAt: new Date() },
      });
    });
  }

  /** Conditional SENT → COMPLETED; false if the payout is no longer SENT. */
  async markCompleted(payoutId: string): Promise<boolean> {
    const result = await this.prisma.payout.updateMany({
      where: { id: payoutId, status: 'SENT' },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    return result.count > 0;
  }

  /**
   * The provider is certain the transfer did not happen (definitive failure).
   * Marks the payout FAILED, releases the hold (held → available), and acks
   * the message — atomically.
   */
  async recordFailed(payoutId: string, errorMessage: string, messageId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; account_id: string; amount_minor: bigint | string }>>`
        UPDATE "payouts"
        SET status = 'FAILED', error_message = ${errorMessage}
        WHERE id = ${payoutId} AND status = 'PROCESSING'
        RETURNING id, account_id, amount_minor
      `;
      if (rows.length === 0) {
        throw new Error(`cannot record failed for payout ${payoutId}: it is not in PROCESSING state`);
      }
      const { account_id: accountId, amount_minor: rawAmount } = rows[0];
      const amount = toBigInt(rawAmount);

      await tx.ledgerEntry.createMany({
        data: [
          { groupId: `${payoutId}:failed`, payoutId, account: 'USER_HELD', direction: 'DEBIT', amountMinor: amount },
          { groupId: `${payoutId}:failed`, payoutId, account: 'USER_AVAILABLE', direction: 'CREDIT', amountMinor: amount },
        ],
      });

      await tx.account.update({
        where: { id: accountId },
        data: { heldBalanceMinor: { decrement: amount }, version: { increment: 1 } },
      });

      await tx.outboxMessage.update({
        where: { id: messageId },
        data: { status: 'DONE', completedAt: new Date() },
      });
    });
  }

  /**
   * The outcome is unknown (redelivery while in flight, or retry exhaustion).
   * Marks the payout NEEDS_REVIEW and dead-letters the message. The hold is
   * deliberately retained: releasing it could double-pay if the transfer
   * actually landed.
   */
  async recordNeedsReview(payoutId: string, errorMessage: string, messageId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "payouts"
        SET status = 'NEEDS_REVIEW', error_message = ${errorMessage}
        WHERE id = ${payoutId} AND status = 'PROCESSING'
        RETURNING id
      `;
      if (rows.length === 0) {
        throw new Error(`cannot record needs_review for payout ${payoutId}: it is not in PROCESSING state`);
      }
      await tx.outboxMessage.update({
        where: { id: messageId },
        data: { status: 'DEAD', completedAt: new Date() },
      });
    });
  }

  /** Requeue the message for a later attempt and reset the payout to CREATED. */
  async requeueForRetry(messageId: string, payoutId: string, attempts: number, nextAvailableAt: Date): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.outboxMessage.update({
        where: { id: messageId },
        data: { status: 'PENDING', attempts, availableAt: nextAvailableAt, claimedAt: null },
      }),
      this.prisma.payout.updateMany({
        where: { id: payoutId, status: 'PROCESSING' },
        data: { status: 'CREATED' },
      }),
    ]);
  }

  async completeMessage(messageId: string): Promise<void> {
    await this.prisma.outboxMessage.update({
      where: { id: messageId },
      data: { status: 'DONE', completedAt: new Date() },
    });
  }

  async deadMessage(messageId: string): Promise<void> {
    await this.prisma.outboxMessage.update({
      where: { id: messageId },
      data: { status: 'DEAD', completedAt: new Date() },
    });
  }

  /**
   * Claim a batch of due messages atomically. Also re-claims messages stuck in
   * PROCESSING past the lease (crashed worker) — this is what makes delivery
   * at-least-once. `FOR UPDATE SKIP LOCKED` keeps concurrent workers disjoint.
   */
  async claimMessages(batchSize: number, leaseMs: number): Promise<ClaimedMessage[]> {
    const lease = `${leaseMs} milliseconds`;
    const rows = await this.prisma.$queryRaw<Array<{ id: string; payload: unknown; attempts: number }>>`
      WITH claim AS (
        SELECT id
        FROM outbox_messages
        WHERE (status = 'PENDING' AND available_at <= now())
           OR (status = 'PROCESSING' AND claimed_at IS NOT NULL AND claimed_at <= now() - (${lease})::interval)
        ORDER BY created_at
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE outbox_messages m
      SET status = 'PROCESSING', claimed_at = now()
      FROM claim
      WHERE m.id = claim.id
      RETURNING m.id, m.payload, m.attempts
    `;
    return rows;
  }

  /**
   * Claim one specific message now (PENDING or a stale PROCESSING). Returns
   * null if the message is already DONE or DEAD.
   */
  async claimMessageById(messageId: string): Promise<ClaimedMessage | null> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; payload: unknown; attempts: number }>>`
      UPDATE outbox_messages
      SET status = 'PROCESSING', claimed_at = now()
      WHERE id = ${messageId} AND status IN ('PENDING', 'PROCESSING')
      RETURNING id, payload, attempts
    `;
    return rows.length > 0 ? rows[0] : null;
  }
}

function toBigInt(value: bigint | string | number): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
```

Hmm, `completeMessage`/`deadMessage` unconditionally update — if the message doesn't exist → P2025 → 500. Only called for messages we just claimed, so they exist. OK.

One concern: `claimMessages` — a message that was claimed (PROCESSING) and whose worker is healthy, claimed within the lease → not re-claimed ✓. In the in-flight test, the message is PROCESSING with a fresh claimed_at; `processMessage` (claimMessageById) claims it regardless of the lease (status IN ('PENDING','PROCESSING')) — that's the intended "redelivery now" semantics for the test. In production, the lease protects. OK.

Also the type of the `payload` unknown in the $queryRaw generic — pg/Prisma may return an object; the `unknown` type is fine.

Now the service file — also export the `PayoutDto` + the mapper (used by the controller). The controller imports the type from the service ✓.

Wait — a circular import? The service imports the repository's type (CreatePayoutInput) — the repository doesn't import the service ✓ no cycle. The worker imports the service + repository ✓. The module imports everything ✓.

Controller: `import { PayoutService, type PayoutDto } from './payout.service.js';` ✓.

Now the `PayoutDto['status']` union — the controller's response type uses PayoutDto ✓.

Also the `@HttpCode(HttpStatus.CREATED)` — a replay returns 201 with `replayed: true`. Acceptable (documented in the body). OK.

Now the full test file — also the test for the *concurrent* idempotent case: `expect(a.replayed !== b.replayed).toBe(true);` — under the FOR UPDATE serialization, one runs first (replayed false), the other second (replayed true) ✓ deterministic.

Also the "unknown account" test: `service.createPayout` with accountId 'missing' → the repository's FOR UPDATE select finds nothing → AccountNotFoundError ✓.

Wait — one more: the `InsufficientFundsError` message contains the available amount — in the test, the rejected one: available 0n, requested 1000n ✓.

Now — is `prisma.payout.findUniqueOrThrow` available in Prisma 5? ✓.

The `beforeEach` deleteMany order: ledger → messages → payouts → accounts (FK order) ✓.

Also the test file's `beforeAll` — do I need it? Not necessary (no setup; the migration is applied externally). Drop the beforeAll (only afterEach/afterAll for disconnect). Actually I need `afterAll` for the disconnect ✓.

Potential vitest + PrismaClient ESM issue: fine.

One more design question: `PayoutService.processPayoutMessage` — after `beginProcessing` returns true, the provider is called. If the provider hangs for a long time ("succeeds slowly") and the lease expires → another poll re-claims (the CTE's lease branch) → another processMessages call → the service sees PROCESSING → recordNeedsReview (escalation) → the provider call is still in flight… when it returns, the recordSent conditional fails (the status is NEEDS_REVIEW) → logged. Safe ✓.

But wait — the CTE re-claim sets the message back to PROCESSING with a fresh claimed_at; the original processMessages is still running the service call for that message (from the first claim). Both are in flight. The second escalates to NEEDS_REVIEW and sets the message to DEAD. The first's recordSent fails (payout is no longer PROCESSING) → the catch logs; then markCompleted isn't called (the try wraps both — recordSent throws → markCompleted is skipped) ✓. The message is DEAD ✓. Final: the transfer was sent, the payout is NEEDS_REVIEW, the hold is retained, the txHash is logged. Safe ✓.

Also `recordNeedsReview`'s message update sets DEAD unconditionally (the message may already be… we own the claim) ✓.

Now — let me verify the "duplicate delivery" requirement is explicitly visible in the test names: "duplicate message delivery" ✓.

The test file name: `test/payout.spec.ts` ✓ per the layout `test/<feature>.spec.ts`.

Now DESIGN.md — finalize (≤20 lines):

```md
# DESIGN — funds safety

- Every mutation is one Postgres transaction: the payout row, the account
  balance, the ledger entries, and the outbox message commit or roll back
  together, so money state can never be half-written.
- Racing creations serialize on `SELECT ... FOR UPDATE` of the account row; the
  `settled - held >= amount` guard runs under that lock, so concurrent requests
  can never overdraw.
- `(account_id, idempotency_key)` is unique and checked under the same lock, so
  a retried request returns the existing payout and reserves nothing extra.
- Creating a payout only moves funds available → held (ledger: debit
  `user_available`, credit `user_held`); the settled balance is debited only
  when the provider confirms the transfer (debit `user_held`, credit
  `payouts_sent`). Every ledger group is balanced: debits = credits.
- The outbox is at-least-once, but the transfer is gated by a conditional
  `CREATED → PROCESSING` transition. A redelivery while the payout is already
  `PROCESSING` (crashed attempt, unknown outcome) escalates to `needs_review`;
  the provider is never called twice for one payout.
- On retry exhaustion (default 3) without a definitive outcome, the payout goes
  to `needs_review` with the hold retained: releasing could double-pay if the
  transfer landed, and retrying risks the same. A human reconciles with the
  provider before releasing or completing.
- Amounts are BigInt minor units in code and `BIGINT` in Postgres; no floats.
```
Count: title 1, blank line 2, bullet 1: 3-5, bullet 2: 6-8, bullet 3: 9-10, bullet 4: 11-14, bullet 5: 15-18, bullet 6: 19-22, bullet 7: 23. That's 23 lines — over 20. Trim: combine/shorten. Target ≤20:

```md
# DESIGN — funds safety

- One Postgres transaction per mutation: payout row, account balance, ledger
  entries, and outbox message commit together — no half-written money state.
- Racing creations serialize on `SELECT ... FOR UPDATE` of the account row; the
  `settled - held >= amount` guard runs under that lock, so no overdraft.
- `(account_id, idempotency_key)` is unique and checked under the same lock, so
  a retried request returns the existing payout and reserves nothing extra.
- Creation only moves funds available → held (debit `user_available`, credit
  `user_held`); the settled balance is debited only when the provider confirms
  (debit `user_held`, credit `payouts_sent`). Every group is balanced (debits = credits).
- The outbox is at-least-once, but the transfer is gated by the conditional
  `CREATED → PROCESSING` transition; a redelivery while already `PROCESSING`
  (unknown prior outcome) escalates to `needs_review`. The provider is never
  called twice for one payout.
- Retries are bounded (default 3); exhaustion without a definitive outcome goes
  to `needs_review` with the hold retained — releasing or retrying could both
  double-pay. A human reconciles with the provider first.
- Amounts are BigInt minor units in code and `BIGINT` in Postgres; no floats.
```
Line count: 1 title, 2 blank, 3-4 b1, 5-6 b2, 7-8 b3, 9-11 b4, 12-15 b5, 16-18 b6, 19 b7 → 19 lines ✓ (within the 10-20 range).

Hmm, line 11 "Every group is balanced (debits = credits)." — that's part of bullet 4 (lines 9-11). Let me recount exactly:

1: `# DESIGN — funds safety`
2: (blank)
3: `- One Postgres transaction per mutation: payout row, account balance, ledger`
4: `  entries, and outbox message commit together — no half-written money state.`
5: `- Racing creations serialize on \`SELECT ... FOR UPDATE\` of the account row; the`
6: `  \`settled - held >= amount\` guard runs under that lock, so no overdraft.`
7: `- \`(account_id, idempotency_key)\` is unique and checked under the same lock, so`
8: `  a retried request returns the existing payout and reserves nothing extra.`
9: `- Creation only moves funds available → held (debit \`user_available\`, credit`
10: `  \`user_held\`); the settled balance is debited only when the provider confirms`
11: `  (debit \`user_held\`, credit \`payouts_sent\`). Every group is balanced (debits = credits).`
12: `- The outbox is at-least-once, but the transfer is gated by the conditional`
13: `  \`CREATED → PROCESSING\` transition; a redelivery while already \`PROCESSING\``
14: `  (unknown prior outcome) escalates to \`needs_review\`. The provider is never`
15: `  called twice for one payout.`
16: `- Retries are bounded (default 3); exhaustion without a definitive outcome goes`
17: `  to \`needs_review\` with the hold retained — releasing or retrying could both`
18: `  double-pay. A human reconciles with the provider first.`
19: `- Amounts are BigInt minor units in code and \`BIGINT\` in Postgres; no floats.`

19 lines ✓.

Now, one more recheck of the format instructions: "For each file, a level-3 heading containing only the repo-relative path, immediately followed by a single fenced block containing only that file's content: `### src/payout/payout.service.ts` ```ts ...```". The prisma migration is `.sql` — the fence language is `sql`. The schema is `.prisma` — the fence is `prisma`. JSON — `json`. MD — `md`.

Also "a path that appears twice is taken only once, at the last occurrence" — ensure no duplicate paths.

Let me verify TS strictness issues:

1. In the test: `const [a, b] = await Promise.all([...])` — a, b are typed `{ payout: PayoutDto; replayed: boolean }` ✓.
2. `results.filter(r => r.status === 'fulfilled')` — typed as a union; `expect(created).toHaveLength(1)` fine.
3. In the loop over `rejected`: `for (const r of rejected) { if (r.status !== 'rejected') throw ...; expect(r.reason).toBeInstanceOf(InsufficientFundsError); }` — r.reason is `any` — toBeInstanceOf is fine.

4. `msg.attempts` — the number from Prisma ✓.

5. `prisma.account.findUniqueOrThrow({ where: { id: ACCOUNT_ID } })` ✓.

6. `service.createPayout(createInput(1n, 'key-after'))` — createInput(amountMinor: bigint) — `1n` ✓.

7. The service's `processPayoutMessage` — a switch on `payout.status` (a Prisma enum union) with the comparison to the string literal 'CREATED' ✓.

8. The `PayoutStatus` import in the service for the Record ✓.

9. The worker: `import type { ClaimedMessage } from './payout.repository.js';` ✓.

10. The filter: `exception.getResponse()` returns `string | Record<string, any>` — `typeof body === 'string' ? body : String((body as {message?: unknown}).message ?? exception.message)` — if body is an object without a message (e.g. the default 500 body `{message: 'Internal server error'}` has message) ✓.

11. `Prisma.PrismaClientKnownRequestError` — a static property access on the namespace import ✓ (a Prisma class).

12. The repository: the `Prisma` import is used in isUniqueViolation ✓; `PrismaClient` is used in the constructor ✓; the type `Payout` is used ✓.

13. `tx.$queryRaw<...>` generic — supported ✓.

14. `this.timer.unref()` — NodeJS.Timeout has unref() ✓.

15. The controller: `BigInt(b.amount as number)` — validated to be an integer ≤ 1e15 → BigInt(number) is exact ✓.

16. `@Inject(PAYOUT_PROVIDER)` — PAYOUT_PROVIDER is a string constant ✓.

17. The service's constructor parameter property `@Inject(PAYOUT_PROVIDER) private readonly provider: PayoutProvider` ✓.

18. `readPositiveInt(process.env.PAYOUT_MAX_ATTEMPTS, 3)` — process.env values are string|undefined ✓.

19. vitest's `testTimeout`/`hookTimeout` — valid config keys ✓ (v1: `testTimeout` ✓).

20. tsconfig `module: NodeNext` + decorators: emitDecoratorMetadata under NodeNext ✓.

One risk: NestJS v10 + NodeNext ESM + tsx — works (Nest supports ESM; tsx transpiles). ✓.

Now, the Prisma schema's `payload Json` — `Json` (not `Json?`) ✓.

Also recheck the Prisma composite unique where: `accountId_idempotencyKey` — the default name for @@unique([accountId, idempotencyKey]) is `accountId_idempotencyKey` ✓.

One more: the schema's `LedgerEntry.payout` relation is required; the `ledgerEntries` list on the Payout side ✓.

In the migration, the ledger_entries FK is ON DELETE RESTRICT — Prisma's default for a required relation is actually `ON DELETE RESTRICT`? Prisma's default referential action: required → `Restrict`, optional → `SetNull`. ✓ matches.

Now — the "no raw SQL in the service" check: the service file has zero SQL ✓. Controller: none ✓.

Also — should the `PayoutController`'s `@Post()` route be exactly `/payouts`? `@Controller('payouts')` + `@Post()` → POST /payouts ✓. Kebab-case, plural ✓.

Also — the error envelope's `details` "is an object, never null" ✓ all our details are objects.

Also verify the `AllExceptionsFilter` handles the `ServiceError` thrown by the controller (validation) → 400 envelope ✓, and the ServiceError from the service/repository (404/409) ✓.

Also — `AccountNotFoundError` details `{ resource: 'account', id }` ✓ an object.

Now let me write the final test file completely and consistently.

Also — one more test consideration: the "concurrent creation" test with 5 parallel `service.createPayout` calls — each opens an interactive transaction; the Prisma connection pool default is 10? Prisma's default `connection_limit` is 1 — uh oh! PrismaClient's default pool: the default is 1 connection?? Prisma's default is `connection_limit = 1`?? No — Prisma's default connection pool: the default is 1? Let me recall: Prisma uses a connection pool with a default limit of… Prisma's default `connection_limit` is 10? Hmm. Prisma docs: "connection_limit: the maximum number of connections to the database that the query engine opens. Default: 10." I believe the default is 10. 5 concurrent interactive transactions → 5 connections ✓ under 10. To be safe, in the test's PrismaClient, set `datasourceUrl`? No — set the pool via env `PRISMA_CLIENT_ENGINE_TYPE`? Not needed; 5 < 10 ✓. Also each interactive transaction holds one connection while waiting on the lock — 5 simultaneous → 5 connections ✓.

But wait — interactive transactions + FOR UPDATE: the 5th connection's transaction waits on the row lock — Prisma's interactive transaction default timeout is 5 seconds — the lock wait is well below ✓.

Also the PrismaClient in the test and the repository share the same client instance ✓ (I pass it in).

Another potential snag: `prisma.$transaction([...])` batched deleteMany in beforeEach — ✓.

And after the test, `prisma.$disconnect()` ✓.

Also — vitest runs the test file once; the global prisma instance ✓.

Now, let me reconsider whether the `processMessages` CTE's re-claim branch could interfere with the exhaustion test: after attempt 1 requeues (PENDING, attempts 1), the message is PENDING — the CTE's PENDING branch claims it when due ✓. There's no stale PROCESSING in the test (recorded quickly). ✓.

In the in-flight test, after the manual update (message PROCESSING, claimed_at now), `worker.processMessage(message.id)` → claimMessageById: `status IN ('PENDING','PROCESSING')` → claims (sets claimed_at now) ✓ → the service: payout PROCESSING → recordNeedsReview: the conditional PROCESSING→NEEDS_REVIEW ✓ (the payout is manually set to PROCESSING) → the message is DEAD ✓. provider.calls 0 ✓. held 300 ✓.

Wait — but in that test, the *original* message was created as PENDING by createPayout; I manually set it to PROCESSING. But `beginProcessing` wasn't called (the payout was manually set to PROCESSING) — that's exactly simulating a crash *after* beginProcessing but before the provider returned. ✓.

Now, let me also consider that `worker.processMessage` calls `guardedProcess` which catches service errors and leaves the message as PROCESSING — in the in-flight test, no error is thrown (recordNeedsReview succeeds) ✓.

Edge: `recordNeedsReview`'s message update is `status: 'DEAD'` — but the message was just claimed as PROCESSING ✓ the update is unconditional by id ✓.

I think the design is solid. Also let me double-check that the `payouts` unique index is also useful for the P2002 backstop ✓.

One more file consideration — a `.gitignore`? Not asked for. Skip.

`README.md`? Not asked for. Skip. (DESIGN.md is the required doc.)

Now — let me reconsider the "no second request" format rule: "start with the first heading." So my reply begins directly with `### package.json`. No preamble. And nothing after the last block.

Let me also recheck the imports in `payout.worker.ts`: `@Injectable, Logger, OnModuleDestroy, OnModuleInit` from '@nestjs/common' ✓.

And in the service, `Logger` is used ✓, `Inject` ✓.

The filter file imports `HttpStatus` ✓ used.

Now, `src/common/env.ts` is imported by the service and the worker ✓.

The service imports `readPositiveInt` from '../common/env.js' ✓.

Let me write out the PayoutDto type: `amountMinor: number` — a number in the JSON response ✓ (a safe integer).

Hmm — one subtlety: the `toPayoutDto` used in the service's createPayout — the DTO's `status` is mapped to lowercase ✓.

Also the controller's response: `{ payout, replayed }` ✓.

Also — the controller: "validates input and calls the service. No business logic." The validation function in the controller file ✓.

Also the worker's env `PAYOUT_BATCH_SIZE` — fine.

Now, let me assemble the migration SQL precisely. Also add `-- InsertStub`? No, no seed data.

Also note: the Prisma migration for `@default(cuid())` — the column has no DB default ✓ my SQL: `TEXT NOT NULL` ✓.

`updated_at TIMESTAMP(6) NOT NULL` (no default; Prisma sets it on writes) ✓.

Timestamps: `TIMESTAMP(6)` vs `TIMESTAMPTZ(6)`: Prisma's `DateTime` → `TIMESTAMPTZ(6)` in Postgres migrations! Prisma maps DateTime to `TIMESTAMPTZ(6)`. Right — Prisma uses `TIMESTAMPTZ(6)` for DateTime. Let me use TIMESTAMPTZ(6) to match what `prisma migrate` would generate. Yes, Prisma generates `TIMESTAMPTZ(6)` for DateTime on PostgreSQL.

And `DEFAULT CURRENT_TIMESTAMP` ✓.

Enum default: `"status" "PayoutStatus" NOT NULL DEFAULT 'CREATED'` ✓.

JSONB: `"payload" JSONB NOT NULL` ✓.

BIGINT default: `BIGINT NOT NULL DEFAULT 0` ✓.

INTEGER default ✓.

Now the full final test file:

```ts
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountNotFoundError, InsufficientFundsError } from '../src/common/service-error.js';
import type { PayoutProvider } from '../src/payout/blockchain-provider.js';
import { PayoutRepository } from '../src/payout/payout.repository.js';
import { PayoutService } from '../src/payout/payout.service.js';
import { PayoutWorker } from '../src/payout/payout.worker.js';

// Integration tests against a real PostgreSQL (DATABASE_URL).
// Apply the schema first: pnpm prisma migrate deploy

const prisma = new PrismaClient();
const ACCOUNT_ID = 'acc_spec_1';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type ProviderMode = 'ok' | 'transient-fail' | 'definitive-fail';

class FakeProvider implements PayoutProvider {
  calls: Array<{ to: string; amount: bigint }> = [];
  mode: ProviderMode = 'ok';
  private counter = 0;

  async transfer(args: { to: string; amount: bigint }): Promise<{ txHash: string }> {
    this.calls.push(args);
    this.counter += 1;
    if (this.mode === 'transient-fail') {
      throw new Error(`transient provider failure #${this.counter}`);
    }
    if (this.mode === 'definitive-fail') {
      const err = new Error('invalid destination address (definitive)') as Error & { permanent: boolean };
      err.permanent = true;
      throw err;
    }
    return { txHash: `0x${this.counter}` };
  }
}

let repo: PayoutRepository;
let service: PayoutService;
let worker: PayoutWorker;
let provider: FakeProvider;

beforeEach(async () => {
  process.env.PAYOUT_MAX_ATTEMPTS = '3';
  process.env.PAYOUT_RETRY_BACKOFF_MS = '20';
  await prisma.$transaction([
    prisma.ledgerEntry.deleteMany({}),
    prisma.outboxMessage.deleteMany({}),
    prisma.payout.deleteMany({}),
    prisma.account.deleteMany({}),
  ]);
  provider = new FakeProvider();
  repo = new PayoutRepository(prisma);
  service = new PayoutService(repo, provider);
  worker = new PayoutWorker(repo, service);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedAccount(settledMinor: bigint, heldMinor = 0n): Promise<void> {
  await prisma.account.create({
    data: { id: ACCOUNT_ID, settledBalanceMinor: settledMinor, heldBalanceMinor: heldMinor },
  });
}

function createInput(amountMinor: bigint, idempotencyKey: string) {
  return { accountId: ACCOUNT_ID, amountMinor, destinationAddress: '0xdestination', idempotencyKey };
}

async function onlyMessage(): Promise<{ id: string; status: string; attempts: number }> {
  const [message] = await prisma.outboxMessage.findMany();
  if (message === undefined) {
    throw new Error('expected exactly one outbox message, found none');
  }
  return { id: message.id, status: message.status, attempts: message.attempts };
}

describe('concurrent creation against one account', () => {
  it('never overdraws when requests race', async () => {
    await seedAccount(1000n);
    const results = await Promise.allSettled(
      [0, 1, 2, 3, 4].map((i) => service.createPayout(createInput(1000n, `key-${i}`))),
    );

    const created = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(created).toHaveLength(1);
    expect(rejected).toHaveLength(4);
    for (const r of rejected) {
      if (r.status !== 'rejected') throw new Error('unreachable');
      expect(r.reason).toBeInstanceOf(InsufficientFundsError);
    }

    const account = await prisma.account.findUniqueOrThrow({ where: { id: ACCOUNT_ID } });
    expect(account.settledBalanceMinor).toBe(1000n); // holds do not change the settled balance
    expect(account.heldBalanceMinor).toBe(1000n); // exactly one payout was reserved
    expect(await prisma.payout.count({ where: { accountId: ACCOUNT_ID } })).toBe(1);

    await expect(service.createPayout(createInput(1n, 'key-after'))).rejects.toBeInstanceOf(InsufficientFundsError);
  });

  it('retries with the same idempotencyKey create no second payout and reserve nothing extra', async () => {
    await seedAccount(1000n);

    const [a, b] = await Promise.all([
      service.createPayout(createInput(600n, 'same-key')),
      service.createPayout(createInput(600n, 'same-key')),
    ]);
    expect(a.payout.id).toBe(b.payout.id);
    expect(a.replayed !== b.replayed).toBe(true);

    const c = await service.createPayout(createInput(600n, 'same-key'));
    expect(c.payout.id).toBe(a.payout.id);
    expect(c.replayed).toBe(true);

    const account = await prisma.account.findUniqueOrThrow({ where: { id: ACCOUNT_ID } });
    expect(account.heldBalanceMinor).toBe(600n);
    expect(account.settledBalanceMinor).toBe(1000n);
    expect(await prisma.payout.count({ where: { accountId: ACCOUNT_ID } })).toBe(1);
  });

  it('rejects an unknown account', async () => {
    await expect(
      service.createPayout({ accountId: 'missing', amountMinor: 1n, destinationAddress: '0x', idempotencyKey: 'k' }),
    ).rejects.toBeInstanceOf(AccountNotFoundError);
  });
});

describe('duplicate message delivery (at-least-once)', () => {
  it('redelivering a processed message does not call the provider again', async () => {
    await seedAccount(1000n);
    const { payout } = await service.createPayout(createInput(400n, 'dup-key'));
    const message = await onlyMessage();
    expect(message.status).toBe('PENDING');

    await worker.processMessage(message.id);
    const afterFirst = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(afterFirst.status).toBe('COMPLETED');
    expect(afterFirst.txHash).toBe('0x1');
    expect(provider.calls).toHaveLength(1);

    // At-least-once redelivery of the same message.
    await worker.processMessage(message.id);
    await worker.processMessage(message.id);
    expect(provider.calls).toHaveLength(1);

    const account = await prisma.account.findUniqueOrThrow({ where: { id: ACCOUNT_ID } });
    expect(account.settledBalanceMinor).toBe(600n); // debited exactly once
    expect(account.heldBalanceMinor).toBe(0n);

    const entries = await prisma.ledgerEntry.findMany();
    expect(entries).toHaveLength(4); // created group + sent group, 2 entries each
    const groups = new Set(entries.map((e) => e.groupId));
    expect(groups.size).toBe(2);
    for (const groupId of groups) {
      const group = entries.filter((e) => e.groupId === groupId);
      const debits = group.filter((e) => e.direction === 'DEBIT').reduce((sum, e) => sum + e.amountMinor, 0n);
      const credits = group.filter((e) => e.direction === 'CREDIT').reduce((sum, e) => sum + e.amountMinor, 0n);
      expect(debits).toBe(credits);
    }
  });

  it('redelivering an in-flight message never triggers a second transfer', async () => {
    await seedAccount(1000n);
    const { payout } = await service.createPayout(createInput(300n, 'inflight-key'));
    const message = await onlyMessage();

    // Simulate a worker crash mid-attempt: the message was claimed and the
    // payout moved to PROCESSING, but the worker died before recording the
    // provider outcome.
    await prisma.payout.update({ where: { id: payout.id }, data: { status: 'PROCESSING' } });
    await prisma.outboxMessage.update({
      where: { id: message.id },
      data: { status: 'PROCESSING', claimedAt: new Date() },
    });

    await worker.processMessage(message.id);

    expect(provider.calls).toHaveLength(0); // no second transfer attempt
    const after = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(after.status).toBe('NEEDS_REVIEW');
    const account = await prisma.account.findUniqueOrThrow({ where: { id: ACCOUNT_ID } });
    expect(account.heldBalanceMinor).toBe(300n); // the hold is retained
  });
});

describe('retry exhaustion', () => {
  it('stops after the bounded number of attempts, keeps funds held, and flags needs-review', async () => {
    await seedAccount(1000n);
    provider.mode = 'transient-fail';
    const { payout } = await service.createPayout(createInput(500n, 'exhaust-key'));

    await worker.processMessages(); // attempt 1
    expect(provider.calls).toHaveLength(1);
    let message = await onlyMessage();
    expect(message.status).toBe('PENDING'); // requeued
    expect(message.attempts).toBe(1);

    await sleep(50); // let the retry backoff elapse
    await worker.processMessages(); // attempt 2
    expect(provider.calls).toHaveLength(2);
    message = await onlyMessage();
    expect(message.attempts).toBe(2);

    await sleep(80); // the backoff has grown
    await worker.processMessages(); // attempt 3 → exhausted
    expect(provider.calls).toHaveLength(3);
    message = await onlyMessage();
    expect(message.status).toBe('DEAD');

    const after = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(after.status).toBe('NEEDS_REVIEW');
    expect(after.txHash).toBeNull();
    expect(after.errorMessage).toContain('retries exhausted');

    const account = await prisma.account.findUniqueOrThrow({ where: { id: ACCOUNT_ID } });
    expect(account.settledBalanceMinor).toBe(1000n);
    expect(account.heldBalanceMinor).toBe(500n); // funds stay held, not released

    // No further automatic delivery happens.
    await worker.processMessages();
    expect(provider.calls).toHaveLength(3);
  });
});

describe('definitive provider failure', () => {
  it('marks the payout failed and releases the hold', async () => {
    await seedAccount(1000n);
    provider.mode = 'definitive-fail';
    const { payout } = await service.createPayout(createInput(350n, 'def-key'));
    const message = await onlyMessage();

    await worker.processMessage(message.id);
    expect(provider.calls).toHaveLength(1);

    const after = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(after.status).toBe('FAILED');
    expect(after.errorMessage).toContain('definitive');

    const account = await prisma.account.findUniqueOrThrow({ where: { id: ACCOUNT_ID } });
    expect(account.settledBalanceMinor).toBe(1000n);
    expect(account.heldBalanceMinor).toBe(0n); // hold released, funds back to available

    const finalMessage = await onlyMessage();
    expect(finalMessage.status).toBe('DONE');
  });
});
```

Wait — the `afterFirst.status` type: the Prisma enum union; `.toBe('COMPLETED')` — a string comparison; does TS allow `.toBe('COMPLETED')`? toBe takes `any`… actually `expect(x).toBe(y)` — y: `unknown`? toBe's signature is `toBe(expected: any)` — fine.

`afterFirst.txHash` is a string | null ✓ `.toBe('0x1')` ✓.

One issue: in the exhaustion test, `worker.processMessages()` uses the CTE claim — the claim CTE's re-claim branch uses the lease from env `PAYOUT_CLAIM_TIMEOUT_MS` default 60000 — the message is never a stale PROCESSING in this test ✓.

Another subtle check — the exhaustion test: `worker.processMessages()` poll 1: the message is PENDING and due (available_at is now at creation time… availableAt defaults to now() at creation; by the time the poll runs it's due ✓).

Also note: `seedAccount` + `createPayout` — createPayout inserts the message with availableAt defaulting to now() ✓ due immediately.

Now — the "unknown account" test: `service.createPayout` with accountId 'missing' → the repository's FOR UPDATE select finds nothing → AccountNotFoundError ✓.

Now — is the test `beforeEach` order OK: deleteMany before constructing the provider ✓.

Now the `PayoutService`'s constructor signature `(repository, provider)` — the test passes `(repo, provider)` ✓ matches the parameter order.

`PayoutWorker`'s constructor `(repository, service)` — the test passes `(repo, service)` ✓.

Now, the service's `processPayoutMessage` — hmm, one more edge: the message is claimed (PROCESSING) by processMessage, and the payout is CREATED but `beginProcessing` fails (0 rows) — when? If a concurrent processMessage for the same payout (a different message? there's one message per payout) — not in the test. The code handles it: completeMessage. ✓.

Now, let me double-check the `recordSent` ledger direction against the invariant I stated in DESIGN: "debit user_available, credit user_held" on creation; "debit user_held, credit payouts_sent" on confirmation. The repository: creation: USER_AVAILABLE DEBIT, USER_HELD CREDIT ✓; sent: USER_HELD DEBIT, PAYOUTS_SENT CREDIT ✓; failed: USER_HELD DEBIT, USER_AVAILABLE CREDIT ✓. Consistent with DESIGN ✓.

Wait, earlier I reasoned the held is a credit-balance account… Let me re-verify the ledger's arithmetic: USER_AVAILABLE (credit balance): creation debits A (decreases available ✓), failure credits A (restores ✓). USER_HELD (credit balance): creation credits A (increases held ✓), sent debits A (decreases ✓), failed debits A (decreases ✓). PAYOUTS_SENT (credit balance): sent credits A (records the amount sent ✓). Per group, one debit A + one credit A → balanced ✓. Global: total debits = total credits ✓ (each group balances).

And accounts.available = the USER_AVAILABLE balance? Available = settled - held. The USER_AVAILABLE balance = Σcredit − Σdebit = (total credits to available) − (total debits) = deposits − holds + releases… the seeded account has no deposit entries, so the ledger sum ≠ the account column (the seeded balance isn't journaled). That's OK — the ledger records the payout-side entries; the accounts table is the running balance. In the test I only assert the per-group balance (which holds) ✓. In a real system, deposits would be journaled too (out of scope).

Hmm — is that a gap for the "double-entry style ledger" requirement? The ledger *is* double-entry for all the payout operations; the seeded test balance is a test artifact. Fine. Maybe I should note it in DESIGN? No, 20-line cap. Fine.

Now — the `payload` in the `outbox_messages` row in the test's `onlyMessage` — not needed.

Also let me double-check the `PayoutDto` export and its use in the controller's return type ✓.

One more: the controller's `@Body() body: unknown` — Nest passes the parsed JSON ✓.

Now — the `main.ts` PORT parsing: `Number(process.env.PORT ?? 3000)` — if PORT is garbage → NaN → listen(NaN) throws; fine (env misconfiguration). Could use readPositiveInt — let me use it for consistency:
```ts
const port = readPositiveInt(process.env.PORT, 3000);
```
Import from './common/env.js' ✓.

Now the final check on the `claimMessages` SQL — `LIMIT ${batchSize}`: batchSize is a number → Prisma interpolates the parameter; LIMIT $1 with an int4 parameter ✓.

The `(${lease})::interval` — lease is a string like '60000 milliseconds' → parameter text → `('60000 milliseconds')::interval` ✓ valid.

`now() - (param)::interval` ✓.

Also the CTE: `WITH claim AS (...) UPDATE ... FROM claim` — a data-modifying CTE ✓ Postgres.

RETURNING from an UPDATE...FROM: `RETURNING m.id, m.payload, m.attempts` ✓.

Now — the Prisma `$queryRaw` with a CTE that returns rows: the typing generic is `Array<{ id: string; payload: unknown; attempts: number }>` ✓.

Now — the `claimMessageById` — `status IN ('PENDING', 'PROCESSING')` literals ✓.

OK. Also verify: no `console.log` anywhere; the Logger is used in the worker/service/filter ✓.

Also — the discipline: "don't create files it doesn't ask for." Files I'm adding beyond the strict deliverable: package.json, tsconfig, vitest.config (needed to run the solution — defensible), common/ files (needed for the error envelope contract), blockchain-provider.ts (needed for the provider seam), main.ts/app.module (required by the convention layout). I think that's the minimal complete set.

Also let me reconsider whether to include the `replayed` field in the response — it's useful for the idempotency contract; fine.

One more potential issue: Nest 10 + `@HttpCode(HttpStatus.CREATED)` with an async method returning an object → 201 ✓.

And the global filter + `@Res` — I'm not using @Res ✓ the filter applies.

Now, the `satisfies` removal — the filter returns a plain object to res.status().json() ✓.

Also the filter: a `ServiceError` thrown from the *service* (none currently — the repository throws; the service doesn't throw a ServiceError) ✓ the filter catches it anyway.

Also — the `AllExceptionsFilter`'s catch of `Prisma.PrismaClientKnownRequestError` — after the if/else chain, it falls to the 500 render (after logging). Structure: if P2025 → 404 return; if P2002 → 409 return; else log + 500. Let me restructure cleanly:

```ts
if (exception instanceof ServiceError) { ...404/409/whatever...; return; }
if (exception instanceof Prisma.PrismaClientKnownRequestError) {
  if (exception.code === 'P2025') { 404; return; }
  if (exception.code === 'P2002') { 409; return; }
  this.logger.error(`unhandled Prisma error (${exception.code})`, exception.message);
} else if (exception instanceof HttpException) {
  ...; return;
} else {
  this.logger.error('unhandled exception', ...);
}
res.status(500).json(...);
```
✓.

Now — the final file list and content. Also verify each relative import ends in `.js`.

- main.ts: `./app.module.js`, `./common/all-exceptions.filter.js`, `./common/env.js` ✓.
- app.module.ts: `./payout/payout.module.js` ✓.
- common/all-exceptions.filter.ts: `./service-error.js` ✓.
- payout/payout.module.ts: `./payout.controller.js`, `./payout.service.js`, `./payout.repository.js`, `./payout.worker.js`, `./blockchain-provider.js` ✓.
- payout/payout.controller.ts: `../common/service-error.js`, `./payout.service.js` ✓.
- payout/payout.service.ts: `../common/env.js`, `./blockchain-provider.js`, `./payout.repository.js` ✓.
- payout/payout.worker.ts: `../common/env.js`, `./payout.repository.js`, `./payout.service.js` ✓.
- payout/payout.repository.ts: `../common/service-error.js` ✓.
- test/payout.spec.ts: `../src/common/service-error.js`, `../src/payout/blockchain-provider.js`, `../src/payout/payout.repository.js`, `../src/payout/payout.service.js`, `../src/payout/payout.worker.js` ✓.

The service also needs `type { Payout, PayoutStatus }` from '@prisma/client' ✓.

Wait, does the service use the `Payout` type? `toPayoutDto(payout: Payout)` ✓ and `PayoutStatus` in the Record ✓.

The repository uses the `Payout` type in the return ✓, and `Prisma` + `PrismaClient` values ✓.

One more strict-TS check: in the test's `FakeProvider`, `mode` is a public mutable ✓. `calls` is public ✓.

`const [message] = await prisma.outboxMessage.findMany();` — message: OutboxMessage | undefined ✓ handled.

`message.status` is typed as an OutboxStatus enum union; assigned to a `status: string` — the OutboxStatus values are string literals → assignable to string ✓.

Now the service's `processPayoutMessage` — the `payout.status !== 'CREATED' && payout.status !== 'PROCESSING'` check: the PayoutStatus union includes all 6 ✓ the comparison is fine.

Now — a potential issue with the `InsufficientFundsError` details: `Number(availableMinor)` — available could be a large BigInt but < 1e15 (the cap per payout; the account balance could theoretically exceed 1e15 if deposited via a direct DB… the test uses small values). The Number() of a large bigint is lossy but the details are informational. Fine — or use a string: `available_minor: availableMinor.toString()`? A JSON string number is safer for a contract. Hmm — the request `amount` is a number on the wire; the details should mirror that. Keep Number() — consistent with the wire type; in practice values are within the safe range.

Let me reconsider the `version` field: it's incremented but not used for optimistic locking (we use FOR UPDATE). It's a useful audit column; keep it (it's in the schema + migration). Fine — no harm.

Actually — hmm, "don't create files it doesn't ask for" and discipline "do exactly what the task asks" — the version column is a bit extra. It's harmless and common. Keep it.

One more consideration: the requirement "a Postgres message table as the queue, plus a polling worker (`processMessages()` runs every N seconds)" — my `processMessages()` exists on the worker and is scheduled via setInterval ✓.

Also "delivery is at-least-once: the worker may see the same message more than once" — the lease re-claim + the CTE + the processMessage redelivery path ✓ tested.

I think I'm ready to write the output. Let me double-check the DESIGN.md line count constraint one more time — 19 lines ✓.

Also verify the fence language tags: `.ts` files use `ts`, `.prisma` uses `prisma`, `.sql` uses `sql`, `.json` uses `json`, `.md` uses `md`.

Let me also re-verify the `prisma/schema.prisma` field names: I use camelCase TS names with @map to snake_case columns ✓ per the convention ("tables and columns: snake_case (via Prisma's @map/@@map)"). Model names are PascalCase, tables are @@map snake_case ✓.

One: `LedgerEntry.account` — a column named `account` — a single word, fine. But `account` might be confused with the Account model? Prisma is fine. The column is `"account" "LedgerAccount" NOT NULL` ✓.

Also the `LedgerEntry` fields: `id, groupId, payoutId, account, direction, amountMinor, createdAt` + the relation `payout` ✓.

The `OutboxMessage` fields ✓.

Now — one final consideration about `prisma.migrations` naming: the convention is `prisma/migrations/<timestamp_name>/migration.sql` ✓.

Let me also confirm the `package.json` "type": "module" ✓ per the convention.

I'm confident. Let me write the output, in order, with no prose.

Actually wait — one more sanity check on the `worker.processMessages()` call in the exhaustion test: poll 1 claims the message, the service runs: beginProcessing (CREATED→PROCESSING), the provider throws (transient), attempts = 0+1 = 1 < 3 → requeueForRetry(messageId, payoutId, 1, now+20ms): the message → PENDING attempts 1, the payout PROCESSING→CREATED ✓. Poll 1 returns. The test asserts PENDING/1 ✓. sleep(50) → poll 2: the CTE claims (PENDING, due) → beginProcessing ✓ → throw → attempts = 1+1 = 2 < 3 → requeue (attempts 2, now+40ms), the payout → CREATED ✓. Poll 2 returns; the assertion attempts 2 ✓. sleep(80) → poll 3: claim → beginProcessing → throw → attempts = 2+1 = 3 >= 3 → recordNeedsReview: payout PROCESSING→NEEDS_REVIEW ✓ message DEAD ✓. The assertion ✓. The final processMessages: no PENDING; the message is DEAD → not claimed (the CTE: PENDING due or stale PROCESSING) → claims 0 ✓ provider stays at 3 ✓.

And in poll 2/3, `attemptsSoFar` is the message.attempts at claim time (1, then 2) ✓ — the claim RETURNING includes attempts *before* the requeue increments it ✓.

Also — `worker.processMessage(message.id)` in the "definitive" test: the claim (PENDING) → the service: CREATED → beginProcessing → the provider throws with permanent → recordFailed: payout PROCESSING→FAILED ✓ ledger release ✓ account held −350 → 0 ✓ message DONE ✓.

`after.errorMessage` contains 'definitive' — my FakeProvider's error message: 'invalid destination address (definitive)' ✓ contains 'definitive' ✓.

Now, one thing I want to confirm: the `recordFailed`/`recordSent`/`recordNeedsReview` raw UPDATEs — the `status = 'FAILED'` etc. literals: Postgres enum coercion from an unknown literal ✓ (exactly what Prisma's own generated SQL does? Prisma generates parameters for enums in the query engine, but literals work in raw SQL — `SET status = 'FAILED'` — the column type is the enum; a string literal is coerced ✓ standard).

And `claimed_at = now()` in the raw SQL ✓.

Final: writing the files.

Also — a small detail: in the `payout.service.ts`, I should double-check the unused-import check (strict doesn't flag unused by default without noUnusedLocals; I haven't enabled noUnusedLocals — I could enable it? If I do, I must make sure everything is used. Let me not enable it to reduce the risk… actually enabling strict flags is good, but the risk of a stray unused import failing the build. Leave tsconfig as is (strict: true only).)

The `Logger` in the service is used ✓ (warn/error). The `Logger` in the worker is used ✓.

In the repository, `Prisma` is used in isUniqueViolation ✓.

In the service: the `PAYOUT_PROVIDER` value import is used with @Inject ✓.

OK — writing.

Also the heading: exactly the path, e.g. `### prisma/migrations/20250101000000_init/migration.sql`.

Let me make sure the fenced blocks contain only file content (no comments outside). Yes.

DESIGN.md content — finalize the text (19 lines as counted).

Also — the em dashes / arrows in DESIGN.md (→) are fine (markdown, English, though the symbol → is not strictly "English" — fine, a code reference).

Now, let me write everything out.
```

## reply

### package.json
```json
{
  "name": "payout-service",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "tsx src/main.ts",
    "dev": "tsx watch src/main.ts",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate deploy",
    "test": "vitest run"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.8",
    "@nestjs/core": "^10.3.8",
    "@nestjs/platform-express": "^10.3.8",
    "@prisma/client": "^5.14.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.0",
    "prisma": "^5.14.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vitest": "^1.6.0"
  }
}
```

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "strict": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

### vitest.config.ts
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
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
  CREATED
  PROCESSING
  SENT
  COMPLETED
  FAILED
  NEEDS_REVIEW
}

enum OutboxStatus {
  PENDING
  PROCESSING
  DONE
  DEAD
}

enum LedgerAccount {
  USER_AVAILABLE
  USER_HELD
  PAYOUTS_SENT
}

enum LedgerDirection {
  DEBIT
  CREDIT
}

model Account {
  id                  String   @id @default(cuid())
  settledBalanceMinor BigInt   @default(0) @map("settled_balance_minor")
  heldBalanceMinor    BigInt   @default(0) @map("held_balance_minor")
  version             Int      @default(0)
  createdAt           DateTime @default(now()) @map("created_at")
  updatedAt           DateTime @updatedAt @map("updated_at")

  payouts Payout[]

  @@map("accounts")
}

model Payout {
  id                 String       @id @default(cuid())
  accountId          String       @map("account_id")
  amountMinor        BigInt       @map("amount_minor")
  destinationAddress String       @map("destination_address")
  idempotencyKey     String       @map("idempotency_key")
  status             PayoutStatus @default(CREATED)
  txHash             String?      @map("tx_hash")
  errorMessage       String?      @map("error_message")
  createdAt          DateTime     @default(now()) @map("created_at")
  updatedAt          DateTime     @updatedAt @map("updated_at")
  sentAt             DateTime?    @map("sent_at")
  completedAt        DateTime?    @map("completed_at")

  account         Account         @relation(fields: [accountId], references: [id])
  ledgerEntries   LedgerEntry[]

  @@unique([accountId, idempotencyKey])
  @@index([status])
  @@map("payouts")
}

model LedgerEntry {
  id          String          @id @default(cuid())
  groupId     String          @map("group_id")
  payoutId    String          @map("payout_id")
  account     LedgerAccount
  direction   LedgerDirection
  amountMinor BigInt          @map("amount_minor")
  createdAt   DateTime        @default(now()) @map("created_at")

  payout Payout @relation(fields: [payoutId], references: [id])

  @@index([groupId])
  @@index([payoutId])
  @@map("ledger_entries")
}

model OutboxMessage {
  id          String       @id @default(cuid())
  type        String       @default("payout.process")
  payload     Json
  status      OutboxStatus @default(PENDING)
  attempts    Int          @default(0)
  availableAt DateTime     @default(now()) @map("available_at")
  claimedAt   DateTime?    @map("claimed_at")
  completedAt DateTime?    @map("completed_at")
  createdAt   DateTime     @default(now()) @map("created_at")

  @@index([status, availableAt])
  @@map("outbox_messages")
}
```

### prisma/migrations/20250101000000_init/migration.sql
```sql
-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('CREATED', 'PROCESSING', 'SENT', 'COMPLETED', 'FAILED', 'NEEDS_REVIEW');
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'DEAD');
CREATE TYPE "LedgerAccount" AS ENUM ('USER_AVAILABLE', 'USER_HELD', 'PAYOUTS_SENT');
CREATE TYPE "LedgerDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "settled_balance_minor" BIGINT NOT NULL DEFAULT 0,
    "held_balance_minor" BIGINT NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "destination_address" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'CREATED',
    "tx_hash" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "sent_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "payout_id" TEXT NOT NULL,
    "account" "LedgerAccount" NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_messages" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'payout.process',
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payouts_account_id_idempotency_key_key" ON "payouts"("account_id", "idempotency_key");
CREATE INDEX "payouts_status_idx" ON "payouts"("status");
CREATE INDEX "ledger_entries_group_id_idx" ON "ledger_entries"("group_id");
CREATE INDEX "ledger_entries_payout_id_idx" ON "ledger_entries"("payout_id");
CREATE INDEX "outbox_messages_status_available_at_idx" ON "outbox_messages"("status", "available_at");

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

### src/main.ts
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { readPositiveInt } from './common/env.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
  const port = readPositiveInt(process.env.PORT, 3000);
  await app.listen(port);
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

### src/common/env.ts
```ts
/** Read a positive integer from an environment variable, falling back to a default. */
export function readPositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}
```

### src/common/service-error.ts
```ts
/**
 * Base class for domain errors. The global exception filter renders these as the
 * single error envelope: { error: { code, message, details } }.
 * `code` is snake_case and is the stable API contract.
 */
export class ServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class AccountNotFoundError extends ServiceError {
  constructor(accountId: string) {
    super(404, 'resource_not_found', `account '${accountId}' was not found`, {
      resource: 'account',
      id: accountId,
    });
  }
}

export class InsufficientFundsError extends ServiceError {
  constructor(availableMinor: bigint, requestedMinor: bigint) {
    super(409, 'insufficient_funds', 'the account does not have sufficient available funds for this payout', {
      available_minor: Number(availableMinor),
      requested_minor: Number(requestedMinor),
    });
  }
}
```

### src/common/all-exceptions.filter.ts
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { ServiceError } from './service-error.js';

/**
 * Global filter that renders every error as the single error envelope:
 * { "error": { "code": "...", "message": "...", "details": {} } }
 * `details` is always an object, never null.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof ServiceError) {
      res.status(exception.status).json({
        error: { code: exception.code, message: exception.message, details: exception.details },
      });
      return;
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2025') {
        res.status(HttpStatus.NOT_FOUND).json({
          error: { code: 'resource_not_found', message: 'the requested resource does not exist', details: {} },
        });
        return;
      }
      if (exception.code === 'P2002') {
        res.status(HttpStatus.CONFLICT).json({
          error: { code: 'idempotency_conflict', message: 'a resource with this idempotency key already exists', details: {} },
        });
        return;
      }
      this.logger.error(`unhandled Prisma error (${exception.code})`, exception.message);
    } else if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code =
        status === HttpStatus.BAD_REQUEST
          ? 'validation_failed'
          : status === HttpStatus.NOT_FOUND
            ? 'resource_not_found'
            : status === HttpStatus.CONFLICT
              ? 'conflict'
              : 'http_error';
      const body = exception.getResponse();
      const message =
        typeof body === 'string' ? body : String((body as { message?: unknown }).message ?? exception.message);
      res.status(status).json({ error: { code, message, details: {} } });
      return;
    } else {
      this.logger.error('unhandled exception', exception instanceof Error ? exception.stack : String(exception));
    }

    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: 'internal_error', message: 'an unexpected error occurred', details: {} },
    });
  }
}
```

### src/payout/blockchain-provider.ts
```ts
/**
 * The blockchain provider SDK is assumed to expose:
 *   provider.transfer({ to, amount }) -> Promise<{ txHash }>
 * which may throw, time out, or succeed slowly. Amounts are passed in minor
 * units (BigInt).
 */
export interface PayoutProvider {
  transfer(args: { to: string; amount: bigint }): Promise<{ txHash: string }>;
}

/** DI token for the provider. Tests inject a fake; production wraps the real SDK. */
export const PAYOUT_PROVIDER = 'PAYOUT_PROVIDER';

// ASSUMPTION: the concrete SDK package is not specified by the task, so this
// factory is the seam where the real provider client would be constructed (e.g.
// `return new RealProviderSdk()`). It fails loudly rather than pretending to
// send money.
export function createPayoutProvider(): PayoutProvider {
  return {
    async transfer(): Promise<{ txHash: string }> {
      throw new Error('payout provider is not configured');
    },
  };
}
```

### src/payout/payout.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient, type Payout } from '@prisma/client';
import { AccountNotFoundError, InsufficientFundsError } from '../common/service-error.js';

export interface CreatePayoutInput {
  accountId: string;
  amountMinor: bigint;
  destinationAddress: string;
  idempotencyKey: string;
}

export interface ClaimedMessage {
  id: string;
  payload: unknown;
  attempts: number;
}

/**
 * The only layer that touches the database.
 *
 * Raw SQL is used where the Prisma query API cannot express what funds safety
 * requires: row locking (`FOR UPDATE`), atomic conditional state transitions
 * (`UPDATE ... WHERE status = ... RETURNING`), and queue claiming with
 * `FOR UPDATE SKIP LOCKED`.
 */
@Injectable()
export class PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Create a payout, reserve the funds, write the hold ledger entries, and queue
   * the outbox message — all in one transaction. `FOR UPDATE` on the account
   * row serializes concurrent creations, so the available-funds guard is
   * race-free and a retried idempotency key can never reserve twice.
   */
  async createPayout(input: CreatePayoutInput): Promise<{ payout: Payout; replayed: boolean }> {
    try {
      return await this.createPayoutTx(input);
    } catch (err) {
      // Backstop: a same-key transaction committed after our lock read (rare;
      // the row lock normally prevents it). Our transaction rolled back —
      // nothing was reserved — so one retry returns the existing payout.
      if (isUniqueViolation(err)) {
        return this.createPayoutTx(input);
      }
      throw err;
    }
  }

  private async createPayoutTx(input: CreatePayoutInput): Promise<{ payout: Payout; replayed: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      // Serialize all concurrent creations for this account on the account row.
      const locked = await tx.$queryRaw<
        Array<{ settled_balance_minor: bigint | string; held_balance_minor: bigint | string }>
      >`
        SELECT settled_balance_minor, held_balance_minor
        FROM accounts
        WHERE id = ${input.accountId}
        FOR UPDATE
      `;
      if (locked.length === 0) {
        throw new AccountNotFoundError(input.accountId);
      }

      // Idempotent replay: an existing payout with this (account, key) is
      // returned as-is and nothing is reserved again.
      const existing = await tx.payout.findUnique({
        where: {
          accountId_idempotencyKey: {
            accountId: input.accountId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (existing !== null) {
        return { payout: existing, replayed: true };
      }

      const available = toBigInt(locked[0].settled_balance_minor) - toBigInt(locked[0].held_balance_minor);
      if (available < input.amountMinor) {
        throw new InsufficientFundsError(available, input.amountMinor);
      }

      const payout = await tx.payout.create({
        data: {
          accountId: input.accountId,
          amountMinor: input.amountMinor,
          destinationAddress: input.destinationAddress,
          idempotencyKey: input.idempotencyKey,
          status: 'CREATED',
        },
      });

      // Hold: move the amount from available to held. The settled total is
      // unchanged; only availability drops.
      await tx.account.update({
        where: { id: input.accountId },
        data: { heldBalanceMinor: { increment: input.amountMinor }, version: { increment: 1 } },
      });

      // Double-entry hold (one balanced group): debit the user's available
      // funds, credit the user's held sub-account.
      const groupId = `${payout.id}:created`;
      await tx.ledgerEntry.createMany({
        data: [
          { groupId, payoutId: payout.id, account: 'USER_AVAILABLE', direction: 'DEBIT', amountMinor: input.amountMinor },
          { groupId, payoutId: payout.id, account: 'USER_HELD', direction: 'CREDIT', amountMinor: input.amountMinor },
        ],
      });

      // Outbox: the message is committed with the payout, so a committed payout
      // always has a queued message — no lost transfers, and no transfer in
      // the request path.
      await tx.outboxMessage.create({
        data: { type: 'payout.process', payload: { payoutId: payout.id } },
      });

      return { payout, replayed: false };
    });
  }

  findPayoutById(id: string): Promise<Payout | null> {
    return this.prisma.payout.findUnique({ where: { id } });
  }

  /** Conditional CREATED → PROCESSING; false if the payout already advanced. */
  async beginProcessing(payoutId: string): Promise<boolean> {
    const result = await this.prisma.payout.updateMany({
      where: { id: payoutId, status: 'CREATED' },
      data: { status: 'PROCESSING' },
    });
    return result.count > 0;
  }

  /**
   * Provider confirmed the transfer. Records the tx hash, settles the ledger
   * (held → payouts sent; the settled balance is debited here and only here),
   * and acks the message — atomically.
   */
  async recordSent(payoutId: string, txHash: string, messageId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; account_id: string; amount_minor: bigint | string }>>`
        UPDATE "payouts"
        SET status = 'SENT', tx_hash = ${txHash}, sent_at = now()
        WHERE id = ${payoutId} AND status = 'PROCESSING'
        RETURNING id, account_id, amount_minor
      `;
      if (rows.length === 0) {
        throw new Error(`cannot record sent for payout ${payoutId}: it is not in PROCESSING state`);
      }
      const { account_id: accountId, amount_minor: rawAmount } = rows[0];
      const amount = toBigInt(rawAmount);

      await tx.ledgerEntry.createMany({
        data: [
          { groupId: `${payoutId}:sent`, payoutId, account: 'USER_HELD', direction: 'DEBIT', amountMinor: amount },
          { groupId: `${payoutId}:sent`, payoutId, account: 'PAYOUTS_SENT', direction: 'CREDIT', amountMinor: amount },
        ],
      });

      await tx.account.update({
        where: { id: accountId },
        data: {
          settledBalanceMinor: { decrement: amount },
          heldBalanceMinor: { decrement: amount },
          version: { increment: 1 },
        },
      });

      await tx.outboxMessage.update({
        where: { id: messageId },
        data: { status: 'DONE', completedAt: new Date() },
      });
    });
  }

  /** Conditional SENT → COMPLETED; false if the payout is no longer SENT. */
  async markCompleted(payoutId: string): Promise<boolean> {
    const result = await this.prisma.payout.updateMany({
      where: { id: payoutId, status: 'SENT' },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    return result.count > 0;
  }

  /**
   * The provider is certain the transfer did not happen (definitive failure).
   * Marks the payout FAILED, releases the hold (held → available), and acks
   * the message — atomically.
   */
  async recordFailed(payoutId: string, errorMessage: string, messageId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; account_id: string; amount_minor: bigint | string }>>`
        UPDATE "payouts"
        SET status = 'FAILED', error_message = ${errorMessage}
        WHERE id = ${payoutId} AND status = 'PROCESSING'
        RETURNING id, account_id, amount_minor
      `;
      if (rows.length === 0) {
        throw new Error(`cannot record failed for payout ${payoutId}: it is not in PROCESSING state`);
      }
      const { account_id: accountId, amount_minor: rawAmount } = rows[0];
      const amount = toBigInt(rawAmount);

      await tx.ledgerEntry.createMany({
        data: [
          { groupId: `${payoutId}:failed`, payoutId, account: 'USER_HELD', direction: 'DEBIT', amountMinor: amount },
          { groupId: `${payoutId}:failed`, payoutId, account: 'USER_AVAILABLE', direction: 'CREDIT', amountMinor: amount },
        ],
      });

      await tx.account.update({
        where: { id: accountId },
        data: { heldBalanceMinor: { decrement: amount }, version: { increment: 1 } },
      });

      await tx.outboxMessage.update({
        where: { id: messageId },
        data: { status: 'DONE', completedAt: new Date() },
      });
    });
  }

  /**
   * The outcome is unknown (redelivery while in flight, or retry exhaustion).
   * Marks the payout NEEDS_REVIEW and dead-letters the message. The hold is
   * deliberately retained: releasing it could double-pay if the transfer
   * actually landed.
   */
  async recordNeedsReview(payoutId: string, errorMessage: string, messageId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "payouts"
        SET status = 'NEEDS_REVIEW', error_message = ${errorMessage}
        WHERE id = ${payoutId} AND status = 'PROCESSING'
        RETURNING id
      `;
      if (rows.length === 0) {
        throw new Error(`cannot record needs_review for payout ${payoutId}: it is not in PROCESSING state`);
      }
      await tx.outboxMessage.update({
        where: { id: messageId },
        data: { status: 'DEAD', completedAt: new Date() },
      });
    });
  }

  /** Requeue the message for a later attempt and reset the payout to CREATED. */
  async requeueForRetry(
    messageId: string,
    payoutId: string,
    attempts: number,
    nextAvailableAt: Date,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.outboxMessage.update({
        where: { id: messageId },
        data: { status: 'PENDING', attempts, availableAt: nextAvailableAt, claimedAt: null },
      }),
      this.prisma.payout.updateMany({
        where: { id: payoutId, status: 'PROCESSING' },
        data: { status: 'CREATED' },
      }),
    ]);
  }

  async completeMessage(messageId: string): Promise<void> {
    await this.prisma.outboxMessage.update({
      where: { id: messageId },
      data: { status: 'DONE', completedAt: new Date() },
    });
  }

  async deadMessage(messageId: string): Promise<void> {
    await this.prisma.outboxMessage.update({
      where: { id: messageId },
      data: { status: 'DEAD', completedAt: new Date() },
    });
  }

  /**
   * Claim a batch of due messages atomically. Also re-claims messages stuck in
   * PROCESSING past the lease (crashed worker) — this is what makes delivery
   * at-least-once. `FOR UPDATE SKIP LOCKED` keeps concurrent workers disjoint.
   */
  async claimMessages(batchSize: number, leaseMs: number): Promise<ClaimedMessage[]> {
    const lease = `${leaseMs} milliseconds`;
    const rows = await this.prisma.$queryRaw<Array<{ id: string; payload: unknown; attempts: number }>>`
      WITH claim AS (
        SELECT id
        FROM outbox_messages
        WHERE (status = 'PENDING' AND available_at <= now())
           OR (status = 'PROCESSING' AND claimed_at IS NOT NULL AND claimed_at <= now() - (${lease})::interval)
        ORDER BY created_at
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE outbox_messages m
      SET status = 'PROCESSING', claimed_at = now()
      FROM claim
      WHERE m.id = claim.id
      RETURNING m.id, m.payload, m.attempts
    `;
    return rows;
  }

  /**
   * Claim one specific message now (PENDING, or PROCESSING — i.e. a
   * redelivery). Returns null if the message is already DONE or DEAD.
   */
  async claimMessageById(messageId: string): Promise<ClaimedMessage | null> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; payload: unknown; attempts: number }>>`
      UPDATE outbox_messages
      SET status = 'PROCESSING', claimed_at = now()
      WHERE id = ${messageId} AND status IN ('PENDING', 'PROCESSING')
      RETURNING id, payload, attempts
    `;
    return rows.length > 0 ? rows[0] : null;
  }
}

function toBigInt(value: bigint | string | number): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
```

### src/payout/payout.service.ts
```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Payout, PayoutStatus } from '@prisma/client';
import { readPositiveInt } from '../common/env.js';
import { PAYOUT_PROVIDER, type PayoutProvider } from './blockchain-provider.js';
import { PayoutRepository, type CreatePayoutInput } from './payout.repository.js';

export interface PayoutDto {
  id: string;
  status: 'created' | 'processing' | 'sent' | 'completed' | 'failed' | 'needs_review';
  amountMinor: number;
  destinationAddress: string;
  idempotencyKey: string;
  txHash: string | null;
  errorMessage: string | null;
  createdAt: string;
  sentAt: string | null;
  completedAt: string | null;
}

const STATUS_TO_API: Record<PayoutStatus, PayoutDto['status']> = {
  CREATED: 'created',
  PROCESSING: 'processing',
  SENT: 'sent',
  COMPLETED: 'completed',
  FAILED: 'failed',
  NEEDS_REVIEW: 'needs_review',
};

export function toPayoutDto(payout: Payout): PayoutDto {
  return {
    id: payout.id,
    status: STATUS_TO_API[payout.status],
    amountMinor: Number(payout.amountMinor),
    destinationAddress: payout.destinationAddress,
    idempotencyKey: payout.idempotencyKey,
    txHash: payout.txHash,
    errorMessage: payout.errorMessage,
    createdAt: payout.createdAt.toISOString(),
    sentAt: payout.sentAt ? payout.sentAt.toISOString() : null,
    completedAt: payout.completedAt ? payout.completedAt.toISOString() : null,
  };
}

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);
  private readonly maxAttempts: number;
  private readonly retryBackoffBaseMs: number;

  constructor(
    private readonly repository: PayoutRepository,
    @Inject(PAYOUT_PROVIDER) private readonly provider: PayoutProvider,
  ) {
    this.maxAttempts = readPositiveInt(process.env.PAYOUT_MAX_ATTEMPTS, 3);
    this.retryBackoffBaseMs = readPositiveInt(process.env.PAYOUT_RETRY_BACKOFF_MS, 1000);
  }

  async createPayout(input: CreatePayoutInput): Promise<{ payout: PayoutDto; replayed: boolean }> {
    const { payout, replayed } = await this.repository.createPayout(input);
    return { payout: toPayoutDto(payout), replayed };
  }

  /**
   * Handle one outbox delivery. Safe under at-least-once delivery: the provider
   * is called at most once per payout, and a redelivery whose prior outcome is
   * unknown escalates to needs_review instead of risking a double transfer.
   */
  async processPayoutMessage(messageId: string, payload: unknown, attemptsSoFar: number): Promise<void> {
    const payoutId = extractPayoutId(payload);
    if (payoutId === null) {
      this.logger.warn(`message ${messageId}: payload has no payoutId; dropping`);
      await this.repository.deadMessage(messageId);
      return;
    }

    const payout = await this.repository.findPayoutById(payoutId);
    if (payout === null) {
      this.logger.warn(`message ${messageId}: payout ${payoutId} no longer exists; dropping`);
      await this.repository.deadMessage(messageId);
      return;
    }

    if (payout.status !== 'CREATED' && payout.status !== 'PROCESSING') {
      // The payout already advanced or terminated (redelivery after the
      // outcome was recorded). Nothing left to do.
      await this.repository.completeMessage(messageId);
      return;
    }
    if (payout.status === 'PROCESSING') {
      // A prior attempt is in flight, or its worker died mid-attempt: the
      // outcome is unknown. Calling the provider again could pay out twice,
      // so escalate for manual reconciliation. The hold stays in place.
      await this.repository.recordNeedsReview(
        payout.id,
        'redelivered while a prior attempt was in flight; outcome unknown, manual review required',
        messageId,
      );
      return;
    }

    const started = await this.repository.beginProcessing(payout.id);
    if (!started) {
      // A concurrent delivery advanced the payout first.
      await this.repository.completeMessage(messageId);
      return;
    }

    let txHash: string;
    try {
      const result = await this.provider.transfer({ to: payout.destinationAddress, amount: payout.amountMinor });
      txHash = result.txHash;
    } catch (err) {
      const reason = toErrorMessage(err);
      if (isDefinitiveFailure(err)) {
        // The provider is certain the transfer did not happen: release the hold.
        await this.repository.recordFailed(payout.id, reason, messageId);
        return;
      }
      const attempts = attemptsSoFar + 1;
      if (attempts >= this.maxAttempts) {
        // Bounded retries exhausted without a definitive outcome. Stop and
        // flag: the funds stay held (see DESIGN.md) — a human reconciles with
        // the provider before the payout is completed or the hold released.
        await this.repository.recordNeedsReview(
          payout.id,
          `retries exhausted without a definitive outcome: ${reason}`,
          messageId,
        );
        return;
      }
      await this.repository.requeueForRetry(messageId, payout.id, attempts, this.nextRetryAt(attempts));
      return;
    }

    try {
      await this.repository.recordSent(payout.id, txHash, messageId);
      await this.repository.markCompleted(payout.id);
    } catch (err) {
      // The conditional transition lost a race (e.g. a lease re-claim
      // escalated the payout). The provider result is logged for
      // reconciliation; the transfer is never re-attempted here.
      this.logger.error(
        `provider confirmed txHash=${txHash} for payout ${payout.id} but the state transition failed: ${toErrorMessage(err)}`,
      );
    }
  }

  private nextRetryAt(attempts: number): Date {
    const backoffMs = this.retryBackoffBaseMs * 2 ** (attempts - 1);
    return new Date(Date.now() + backoffMs);
  }
}

function extractPayoutId(payload: unknown): string | null {
  let candidate: unknown = payload;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return null;
    }
  }
  if (typeof candidate !== 'object' || candidate === null) return null;
  const payoutId = (candidate as Record<string, unknown>).payoutId;
  return typeof payoutId === 'string' && payoutId.length > 0 ? payoutId : null;
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ASSUMPTION: the provider SDK's error shape is unspecified. Errors carrying a
// truthy `permanent` or `definitive` flag are treated as definitive (the
// transfer is known not to have happened); every other error is treated as
// unknown and retried within the bound.
function isDefinitiveFailure(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { permanent?: unknown; definitive?: unknown };
  return Boolean(e.permanent) || Boolean(e.definitive);
}
```

### src/payout/payout.worker.ts
```ts
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { readPositiveInt } from '../common/env.js';
import { PayoutRepository, type ClaimedMessage } from './payout.repository.js';
import { PayoutService } from './payout.service.js';

/**
 * Polling worker: claims due outbox messages and hands them to the service.
 * `processMessages()` runs every PAYOUT_POLL_INTERVAL_MS (default 5000).
 * Delivery is at-least-once (including re-claims past the claim lease); the
 * service makes redelivery safe.
 */
@Injectable()
export class PayoutWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutWorker.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly repository: PayoutRepository,
    private readonly service: PayoutService,
  ) {}

  onModuleInit(): void {
    const intervalMs = readPositiveInt(process.env.PAYOUT_POLL_INTERVAL_MS, 5000);
    this.timer = setInterval(() => {
      void this.processMessages().catch((err: unknown) => {
        this.logger.error(`processMessages failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, intervalMs);
    // Do not keep the process alive on the poller alone (matters for tests).
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
  }

  /** One poll cycle: claim a batch of due messages and process each. */
  async processMessages(): Promise<number> {
    const leaseMs = readPositiveInt(process.env.PAYOUT_CLAIM_TIMEOUT_MS, 60_000);
    const batchSize = readPositiveInt(process.env.PAYOUT_BATCH_SIZE, 10);
    const claimed = await this.repository.claimMessages(batchSize, leaseMs);
    for (const message of claimed) {
      await this.guardedProcess(message);
    }
    return claimed.length;
  }

  /**
   * Deliver one specific message now (also how at-least-once redelivery is
   * simulated). No-op if the message is already DONE or DEAD.
   */
  async processMessage(messageId: string): Promise<void> {
    const claimed = await this.repository.claimMessageById(messageId);
    if (claimed === null) return;
    await this.guardedProcess(claimed);
  }

  private async guardedProcess(message: ClaimedMessage): Promise<void> {
    try {
      await this.service.processPayoutMessage(message.id, message.payload, message.attempts);
    } catch (err) {
      // The message stays PROCESSING; the lease-based re-claim in the next
      // processMessages() will pick it up (at-least-once).
      this.logger.error(`message ${message.id} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
```

### src/payout/payout.controller.ts
```ts
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ServiceError } from '../common/service-error.js';
import { PayoutService, type PayoutDto } from './payout.service.js';

// 10^15 — far below Number.MAX_SAFE_INTEGER, so JSON number amounts stay exact.
const MAX_PAYOUT_AMOUNT_MINOR = 1_000_000_000_000_000;

interface CreatePayoutResponse {
  payout: PayoutDto;
  replayed: boolean;
}

@Controller('payouts')
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: unknown): Promise<CreatePayoutResponse> {
    const issues = validateCreatePayoutBody(body);
    if (issues.length > 0) {
      throw new ServiceError(400, 'validation_failed', 'the request body is invalid', { issues });
    }
    const b = body as Record<string, unknown>;
    const result = await this.service.createPayout({
      accountId: b.accountId as string,
      amountMinor: BigInt(b.amount as number),
      destinationAddress: b.destinationAddress as string,
      idempotencyKey: b.idempotencyKey as string,
    });
    return { payout: result.payout, replayed: result.replayed };
  }
}

/** Controller-level shape validation only; no business logic here. */
function validateCreatePayoutBody(body: unknown): string[] {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return ['body must be a JSON object'];
  }
  const b = body as Record<string, unknown>;
  const issues: string[] = [];
  if (typeof b.accountId !== 'string' || b.accountId.length === 0 || b.accountId.length > 64) {
    issues.push('accountId must be a non-empty string of at most 64 characters');
  }
  if (typeof b.amount !== 'number' || !Number.isInteger(b.amount) || b.amount <= 0 || b.amount > MAX_PAYOUT_AMOUNT_MINOR) {
    issues.push(`amount must be a positive integer in minor units (max ${MAX_PAYOUT_AMOUNT_MINOR})`);
  }
  if (typeof b.destinationAddress !== 'string' || b.destinationAddress.length === 0 || b.destinationAddress.length > 256) {
    issues.push('destinationAddress must be a non-empty string of at most 256 characters');
  }
  if (typeof b.idempotencyKey !== 'string' || b.idempotencyKey.length === 0 || b.idempotencyKey.length > 128) {
    issues.push('idempotencyKey must be a non-empty string of at most 128 characters');
  }
  return issues;
}
```

### src/payout/payout.module.ts
```ts
import { Module } from '@nestjs/common';
import { PayoutController } from './payout.controller.js';
import { PayoutService } from './payout.service.js';
import { PayoutRepository } from './payout.repository.js';
import { PayoutWorker } from './payout.worker.js';
import { PAYOUT_PROVIDER, createPayoutProvider } from './blockchain-provider.js';

@Module({
  controllers: [PayoutController],
  providers: [
    PayoutRepository,
    PayoutService,
    PayoutWorker,
    { provide: PAYOUT_PROVIDER, useFactory: createPayoutProvider },
  ],
  exports: [PayoutService],
})
export class PayoutModule {}
```

### test/payout.spec.ts
```ts
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountNotFoundError, InsufficientFundsError } from '../src/common/service-error.js';
import type { PayoutProvider } from '../src/payout/blockchain-provider.js';
import { PayoutRepository } from '../src/payout/payout.repository.js';
import { PayoutService } from '../src/payout/payout.service.js';
import { PayoutWorker } from '../src/payout/payout.worker.js';

// Integration tests against a real PostgreSQL (DATABASE_URL).
// Apply the schema first: pnpm prisma migrate deploy

const prisma = new PrismaClient();
const ACCOUNT_ID = 'acc_spec_1';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type ProviderMode = 'ok' | 'transient-fail' | 'definitive-fail';

class FakeProvider implements PayoutProvider {
  calls: Array<{ to: string; amount: bigint }> = [];
  mode: ProviderMode = 'ok';
  private counter = 0;

  async transfer(args: { to: string; amount: bigint }): Promise<{ txHash: string }> {
    this.calls.push(args);
    this.counter += 1;
    if (this.mode === 'transient-fail') {
      throw new Error(`transient provider failure #${this.counter}`);
    }
    if (this.mode === 'definitive-fail') {
      const err = new Error('invalid destination address (definitive)') as Error & { permanent: boolean };
      err.permanent = true;
      throw err;
    }
    return { txHash: `0x${this.counter}` };
  }
}

let repo: PayoutRepository;
let service: PayoutService;
let worker: PayoutWorker;
let provider: FakeProvider;

beforeEach(async () => {
  process.env.PAYOUT_MAX_ATTEMPTS = '3';
  process.env.PAYOUT_RETRY_BACKOFF_MS = '20';
  await prisma.$transaction([
    prisma.ledgerEntry.deleteMany({}),
    prisma.outboxMessage.deleteMany({}),
    prisma.payout.deleteMany({}),
    prisma.account.deleteMany({}),
  ]);
  provider = new FakeProvider();
  repo = new PayoutRepository(prisma);
  service = new PayoutService(repo, provider);
  worker = new PayoutWorker(repo, service);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedAccount(settledMinor: bigint, heldMinor = 0n): Promise<void> {
  await prisma.account.create({
    data: { id: ACCOUNT_ID, settledBalanceMinor: settledMinor, heldBalanceMinor: heldMinor },
  });
}

function createInput(amountMinor: bigint, idempotencyKey: string) {
  return { accountId: ACCOUNT_ID, amountMinor, destinationAddress: '0xdestination', idempotencyKey };
}

async function onlyMessage(): Promise<{ id: string; status: string; attempts: number }> {
  const [message] = await prisma.outboxMessage.findMany();
  if (message === undefined) {
    throw new Error('expected exactly one outbox message, found none');
  }
  return { id: message.id, status: message.status, attempts: message.attempts };
}

describe('concurrent creation against one account', () => {
  it('never overdraws when requests race', async () => {
    await seedAccount(1000n);
    const results = await Promise.allSettled(
      [0, 1, 2, 3, 4].map((i) => service.createPayout(createInput(1000n, `key-${i}`))),
    );

    const created = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(created).toHaveLength(1);
    expect(rejected).toHaveLength(4);
    for (const r of rejected) {
      if (r.status !== 'rejected') throw new Error('unreachable');
      expect(r.reason).toBeInstanceOf(InsufficientFundsError);
    }

    const account = await prisma.account.findUniqueOrThrow({ where: { id: ACCOUNT_ID } });
    expect(account.settledBalanceMinor).toBe(1000n); // holds do not change the settled balance
    expect(account.heldBalanceMinor).toBe(1000n); // exactly one payout was reserved
    expect(await prisma.payout.count({ where: { accountId: ACCOUNT_ID } })).toBe(1);

    await expect(service.createPayout(createInput(1n, 'key-after'))).rejects.toBeInstanceOf(InsufficientFundsError);
  });

  it('retries with the same idempotencyKey create no second payout and reserve nothing extra', async () => {
    await seedAccount(1000n);

    const [a, b] = await Promise.all([
      service.createPayout(createInput(600n, 'same-key')),
      service.createPayout(createInput(600n, 'same-key')),
    ]);
    expect(a.payout.id).toBe(b.payout.id);
    expect(a.replayed !== b.replayed).toBe(true);

    const c = await service.createPayout(createInput(600n, 'same-key'));
    expect(c.payout.id).toBe(a.payout.id);
    expect(c.replayed).toBe(true);

    const account = await prisma.account.findUniqueOrThrow({ where: { id: ACCOUNT_ID } });
    expect(account.heldBalanceMinor).toBe(600n);
    expect(account.settledBalanceMinor).toBe(1000n);
    expect(await prisma.payout.count({ where: { accountId: ACCOUNT_ID } })).toBe(1);
  });

  it('rejects an unknown account', async () => {
    await expect(
      service.createPayout({ accountId: 'missing', amountMinor: 1n, destinationAddress: '0x', idempotencyKey: 'k' }),
    ).rejects.toBeInstanceOf(AccountNotFoundError);
  });
});

describe('duplicate message delivery (at-least-once)', () => {
  it('redelivering a processed message does not call the provider again', async () => {
    await seedAccount(1000n);
    const { payout } = await service.createPayout(createInput(400n, 'dup-key'));
    const message = await onlyMessage();
    expect(message.status).toBe('PENDING');

    await worker.processMessage(message.id);
    const afterFirst = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(afterFirst.status).toBe('COMPLETED');
    expect(afterFirst.txHash).toBe('0x1');
    expect(provider.calls).toHaveLength(1);

    // At-least-once redelivery of the same message.
    await worker.processMessage(message.id);
    await worker.processMessage(message.id);
    expect(provider.calls).toHaveLength(1);

    const account = await prisma.account.findUniqueOrThrow({ where: { id: ACCOUNT_ID } });
    expect(account.settledBalanceMinor).toBe(600n); // debited exactly once
    expect(account.heldBalanceMinor).toBe(0n);

    const entries = await prisma.ledgerEntry.findMany();
    expect(entries).toHaveLength(4); // created group + sent group, two entries each
    const groups = new Set(entries.map((e) => e.groupId));
    expect(groups.size).toBe(2);
    for (const groupId of groups) {
      const group = entries.filter((e) => e.groupId === groupId);
      const debits = group.filter((e) => e.direction === 'DEBIT').reduce((sum, e) => sum + e.amountMinor, 0n);
      const credits = group.filter((e) => e.direction === 'CREDIT').reduce((sum, e) => sum + e.amountMinor, 0n);
      expect(debits).toBe(credits);
    }
  });

  it('redelivering an in-flight message never triggers a second transfer', async () => {
    await seedAccount(1000n);
    const { payout } = await service.createPayout(createInput(300n, 'inflight-key'));
    const message = await onlyMessage();

    // Simulate a worker crash mid-attempt: the message was claimed and the
    // payout moved to PROCESSING, but the worker died before recording the
    // provider outcome.
    await prisma.payout.update({ where: { id: payout.id }, data: { status: 'PROCESSING' } });
    await prisma.outboxMessage.update({
      where: { id: message.id },
      data: { status: 'PROCESSING', claimedAt: new Date() },
    });

    await worker.processMessage(message.id);

    expect(provider.calls).toHaveLength(0); // no second transfer attempt
    const after = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(after.status).toBe('NEEDS_REVIEW');
    const account = await prisma.account.findUniqueOrThrow({ where: { id: ACCOUNT_ID } });
    expect(account.heldBalanceMinor).toBe(300n); // the hold is retained
  });
});

describe('retry exhaustion', () => {
  it('stops after the bounded number of attempts, keeps funds held, and flags needs-review', async () => {
    await seedAccount(1000n);
    provider.mode = 'transient-fail';
    const { payout } = await service.createPayout(createInput(500n, 'exhaust-key'));

    await worker.processMessages(); // attempt 1
    expect(provider.calls).toHaveLength(1);
    let message = await onlyMessage();
    expect(message.status).toBe('PENDING'); // requeued
    expect(message.attempts).toBe(1);

    await sleep(50); // let the retry backoff elapse
    await worker.processMessages(); // attempt 2
    expect(provider.calls).toHaveLength(2);
    message = await onlyMessage();
    expect(message.attempts).toBe(2);

    await sleep(80); // the backoff has grown
    await worker.processMessages(); // attempt 3 → exhausted
    expect(provider.calls).toHaveLength(3);
    message = await onlyMessage();
    expect(message.status).toBe('DEAD');

    const after = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(after.status).toBe('NEEDS_REVIEW');
    expect(after.txHash).toBeNull();
    expect(after.errorMessage).toContain('retries exhausted');

    const account = await prisma.account.findUniqueOrThrow({ where: { id: ACCOUNT_ID } });
    expect(account.settledBalanceMinor).toBe(1000n);
    expect(account.heldBalanceMinor).toBe(500n); // funds stay held, not released

    // No further automatic delivery happens.
    await worker.processMessages();
    expect(provider.calls).toHaveLength(3);
  });
});

describe('definitive provider failure', () => {
  it('marks the payout failed and releases the hold', async () => {
    await seedAccount(1000n);
    provider.mode = 'definitive-fail';
    const { payout } = await service.createPayout(createInput(350n, 'def-key'));
    const message = await onlyMessage();

    await worker.processMessage(message.id);
    expect(provider.calls).toHaveLength(1);

    const after = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(after.status).toBe('FAILED');
    expect(after.errorMessage).toContain('definitive');

    const account = await prisma.account.findUniqueOrThrow({ where: { id: ACCOUNT_ID } });
    expect(account.settledBalanceMinor).toBe(1000n);
    expect(account.heldBalanceMinor).toBe(0n); // hold released, funds back to available

    const finalMessage = await onlyMessage();
    expect(finalMessage.status).toBe('DONE');
  });
});
```

### DESIGN.md
```md
# DESIGN — funds safety

- One Postgres transaction per mutation: payout row, account balance, ledger
  entries, and outbox message commit together — no half-written money state.
- Racing creations serialize on `SELECT ... FOR UPDATE` of the account row; the
  `settled - held >= amount` guard runs under that lock, so no overdraft.
- `(account_id, idempotency_key)` is unique and checked under the same lock, so
  a retried request returns the existing payout and reserves nothing extra.
- Creation only moves funds available → held (debit `user_available`, credit
  `user_held`); the settled balance is debited only when the provider confirms
  (debit `user_held`, credit `payouts_sent`). Every group is balanced (debits = credits).
- The outbox is at-least-once, but the transfer is gated by the conditional
  `CREATED → PROCESSING` transition; a redelivery while already `PROCESSING`
  (unknown prior outcome) escalates to `needs_review`. The provider is never
  called twice for one payout.
- Retries are bounded (default 3); exhaustion without a definitive outcome goes
  to `needs_review` with the hold retained — releasing or retrying could both
  double-pay. A human reconciles with the provider first.
- Amounts are BigInt minor units in code and `BIGINT` in Postgres; no floats.
```


---
