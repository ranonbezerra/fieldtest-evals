# 07-payout.service.ts

## reply

Let me carefully analyze the task. I need to write exactly one file: `src/payout/payout.service.ts`. This is a NestJS service for the payout feature.

Let me look at what the plan specifies for this file:

From PLAN.md §3:
```ts
// src/payout/payout.service.ts
export class PayoutService {
  constructor(repo: PayoutRepository, provider: PayoutProvider);

  createPayout(dto: CreatePayoutDto): Promise<PayoutView>;
  // Runs inside ONE transaction: findPayoutByIdempotencyKey (return existing if present),
  // reserveFunds, createPayoutWithMessage.

  processMessages(): Promise<number>; // claims + processes all pending, returns count processed
  // For each claimed message: run processOneMessage.

  private processOneMessage(msg: Message): Promise<void>;
  // provider.transfer -> on success: settle_out + release? (see §4) + status transitions;
  // on throw: increment attempts, decide retry vs dead.
}
```

Now let me think about the details:

**Constructor**: `constructor(repo: PayoutRepository, provider: PayoutProvider)` — but wait, the service needs to run transactions. The plan says: "Transactional multi-step methods take a `tx` client passed by the service so the service owns the boundary." So the service needs access to Prisma to start transactions. But the repository is "the only layer that touches the database." Hmm, but starting a transaction via `prisma.$transaction` — does that count as "touching the database"? The plan explicitly says the service passes a `tx` client to the repository. So the service must have access to PrismaClient to call `$transaction`.

Wait, let me re-read: "Repository (the only layer that touches Prisma). All methods are async. Transactional multi-step methods take a `tx` client passed by the service so the service owns the boundary."

So the service owns the transaction boundary — it calls `prisma.$transaction(async (tx) => {...})` and passes `tx` to repository methods. The service needs PrismaClient injected. But the plan's constructor signature only shows `constructor(repo: PayoutRepository, provider: PayoutProvider)`.

Hmm, this is a contradiction. Let me think about how to resolve it.

Actually, wait. Let me reconsider. The plan says the service passes a `tx` client to the repository. For the service to have a `tx` client, it must start a transaction. The only way to start a Prisma transaction is via `prisma.$transaction`. So the service needs PrismaClient.

But the constructor in the plan only lists `repo` and `provider`. This is a genuine gap. Let me think about the "most defensible reading."

Option A: The service injects PrismaClient and calls `this.prisma.$transaction(...)`. This is the most defensible reading given that the repository methods take a `tx` parameter. The service must own the transaction boundary, which requires PrismaClient.

But wait — does injecting PrismaClient into the service violate "repository is the only layer that touches the database"? Starting a transaction is arguably not "touching the database" in the sense of running queries; it's managing a transaction boundary. The plan explicitly says "the service owns the boundary." So I think the service should have PrismaClient.

Actually, let me reconsider. There's a cleaner interpretation. The plan says the service owns the boundary and passes `tx` to the repository. This strongly implies the service calls `prisma.$transaction`. So the service needs PrismaClient.

Hmm, but the constructor signature is `constructor(repo: PayoutRepository, provider: PayoutProvider)`. This is a conflict between the signature and the "service owns the boundary" statement.

Let me think about what's most defensible. The requirement that the repository methods take `tx` is very explicit and appears in multiple places:
- "Transactional multi-step methods take a `tx` client passed by the service so the service owns the boundary."
- The repository signature: `reserveFunds(tx: Prisma.TransactionClient, ...)` etc.

So the service MUST pass a `tx` to these methods. The only source of a `tx` is `prisma.$transaction`. Therefore the service needs PrismaClient.

I'll add PrismaClient to the constructor with an ASSUMPTION comment, OR I could think about whether there's another way.

Wait, actually — maybe the plan intends that the service gets PrismaClient but the signature in §3 is just abbreviated. Let me look at the manifest:

```
src/payout/payout.service.ts | reads: src/payout/payout.repository.ts, src/payout/provider.types.ts, src/payout/payout.types.ts, src/payout/payout.errors.ts | create + processMessages logic, tx boundaries, retry policy
```

The "reads" list does NOT include PrismaClient. Hmm. But "reads" in the manifest might refer to project files, not external packages. PrismaClient is from `@prisma/client`, an external package. The manifest's "reads" column lists project files. So it's not conclusive about whether PrismaClient is imported.

Let me reconsider the whole design. There are a few ways to structure this:

**Approach 1**: Service injects PrismaClient, calls `this.prisma.$transaction(async (tx) => { ... })`. The service passes `tx` to repo methods.

**Approach 2**: Repository exposes a method that runs the whole transaction internally. But no — the plan explicitly says the service owns the boundary and passes `tx`.

Given the strong emphasis on "the service owns the boundary" and the `tx` parameters, Approach 1 is correct. The service needs PrismaClient.

So I'll inject PrismaClient. I'll add an ASSUMPTION comment noting that the constructor needs PrismaClient to own the transaction boundary, even though §3's signature only listed repo and provider.

Actually wait. Let me reconsider once more. Is it possible the plan intends for the service to NOT have PrismaClient and instead the repository provides a helper? No, the plan is very clear: "Transactional multi-step methods take a `tx` client passed by the service." The service passes the tx. So the service has the tx. So the service has PrismaClient.

OK here's another thought. What if the service uses `prisma.$transaction` but I should double check: does the plan anywhere say the service imports PrismaClient? No. But it's implied by the design. I'll go with Approach 1 and add an ASSUMPTION comment.

Hmm, but the instruction says: "If a symbol you need is genuinely absent from both the plan and the references, do not guess in silence and do not reason around it: write the file using the most defensible reading and mark it with one `// ASSUMPTION: <what was unresolved>` comment at the point it matters."

The symbol `PrismaClient` — is it "genuinely absent"? It's in the references (payout.repository.ts imports `PrismaClient` from `@prisma/client`). So the symbol exists in the codebase. The question is whether the service should import it. Given the design requires the service to own the transaction boundary, yes. I think this is a defensible reading that doesn't need an ASSUMPTION comment because it's clearly implied by the plan. But to be safe, maybe I should add one? 

Actually, let me reconsider. The plan's §3 signature is `constructor(repo: PayoutRepository, provider: PayoutProvider)`. If I add PrismaClient, I'm deviating from the stated signature. The instruction says "Implement exactly what the plan specifies for this file." But the plan also says the service owns the transaction boundary and passes `tx` to the repository, which is impossible without PrismaClient.

This is a genuine tension. Let me think about which is more defensible.

The core requirement (from the problem statement) is: "Two racing requests must never overdraw the account." and "Creates a payout if the account has sufficient available funds. Requests may be retried by clients; retrying the same idempotencyKey must not create a second payout or reserve funds twice." These require atomicity, which requires a transaction. The transaction must be owned by the service (per plan) and passed to the repository.

So PrismaClient in the service is necessary. I'll add it. Since it's a deviation from the literal constructor signature but required by the plan's own logic, I'll add an ASSUMPTION comment explaining why.

Wait, actually, let me reconsider whether there's a way to avoid PrismaClient in the service entirely. 

What if... no. The `tx` parameter is `Prisma.TransactionClient`. The service must produce it. Only `prisma.$transaction` produces it (as a callback param). So the service must have prisma.

Alternatively, could the repository expose a `withTransaction` method? The plan doesn't define such a method. And it says the service owns the boundary. So no.

OK, I'm confident: the service needs PrismaClient. I'll add an ASSUMPTION comment at the constructor.

Actually, let me reconsider the ASSUMPTION comment placement and necessity. The instruction is to mark genuinely absent symbols. `PrismaClient` is not absent — it's used in the repository. The design (service owns boundary, passes tx) clearly requires it. I think a brief ASSUMPTION comment is the safest and most honest approach, because I'm adding a constructor param not in the §3 signature. Let me include it but keep it minimal and accurate.

Hmm, let me reconsider. Actually I realize I should think harder about whether the service really needs PrismaClient or whether I'm overcomplicating.

Let me re-read the repository methods:
- `reserveFunds(tx, accountId, amount)` — needs tx
- `releaseReserved(tx, accountId, amount)` — needs tx
- `settleOut(tx, accountId, amount)` — needs tx
- `createPayoutWithMessage(tx, dto)` — needs tx
- `getAccount(id)` — no tx (uses this.prisma)
- `findPayoutByIdempotencyKey(key)` — no tx (uses this.prisma)
- `getPayout(id)` — no tx
- `updatePayoutStatus(id, status, txHash?)` — no tx
- `incrementPayoutAttempts(id)` — no tx
- `claimNextPendingMessage()` — no tx
- `claimMessage(id)` — no tx (CAS via updateMany)
- `setMessageStatus(id, status, lastError?)` — no tx
- `incrementMessageAttempts(id)` — no tx

So the transactional methods (reserveFunds, releaseReserved, settleOut, createPayoutWithMessage) need a tx. The service must provide it. So the service needs PrismaClient for `$transaction`.

Confirmed. Service needs PrismaClient.

Now, let me design the service logic in detail.

### createPayout(dto: CreatePayoutDto): Promise<PayoutView>

Per plan §4, Transaction boundary 1:
"Create (one tx): look up idempotency key → if found, return existing (no reservation). Else reserveFunds (atomic balance check + increment) → insert payout (created) → insert message (pending). Commit. The transfer is NOT in this tx."

Ordering rule: "In createPayout: reserveFunds before createPayoutWithMessage."

So:
```ts
async createPayout(dto: CreatePayoutDto): Promise<PayoutView> {
  return this.prisma.$transaction(async (tx) => {
    const existing = await this.repo.findPayoutByIdempotencyKey(dto.idempotencyKey);
    if (existing) {
      return this.toView(existing);
    }
    await this.repo.reserveFunds(tx, dto.accountId, dto.amount);
    const payout = await this.repo.createPayoutWithMessage(tx, dto);
    return this.toView(payout);
  });
}
```

Wait, but there's a subtlety. `findPayoutByIdempotencyKey` uses `this.prisma` (not tx). That's fine — it's a read. But should it use tx for consistency? The plan says the method signature is `findPayoutByIdempotencyKey(key)` with no tx param, so it uses the plain client. That's fine for a read. Actually, using the plain client inside a transaction callback is OK in Prisma (it just won't be part of the tx). For an idempotency check, that's acceptable. Actually, to be safe and consistent, maybe I should just call it as-is since the repo method doesn't accept tx.

Hmm, but there's a subtle issue: if I call `findPayoutByIdempotencyKey` using the plain client while inside a `$transaction`, and two concurrent requests with the same key race, both might see "no existing" and both try to create. But the `idempotency_key` is unique in the DB, so one will get a unique constraint violation. That's a race condition.

But wait — the plan says "a retry with the same key returns the existing payout." And the test is "duplicate idempotency key: two createPayout with the same key → one creates, the other returns the existing payout; only one payout row and one reservation exist."

For the test to pass with "only one payout row and one reservation exist," we need the idempotency check to work. If two requests race with the same key, we could get a unique constraint violation on insert. How to handle that?

Option 1: Catch the unique constraint violation and return the existing payout.
Option 2: Rely on the fact that in the test, the two calls are sequential (not truly concurrent), so the first creates and the second sees the existing.

The plan's test description: "duplicate idempotency key: two createPayout with the same key → one creates, the other returns the existing payout." This sounds sequential. The concurrent creation test uses "distinct idempotency keys." So the duplicate key test is likely sequential.

But to be robust, I should handle the race. However, the plan doesn't explicitly mention catching unique constraint violations. Let me think about whether to add that.

Actually, the plan's createPayout logic is: "findPayoutByIdempotencyKey (return existing if present), reserveFunds, createPayoutWithMessage." It doesn't mention catching unique violations. But for correctness under concurrency with the same key, we'd want to handle it.

Hmm. Let me consider: if I use `findPayoutByIdempotencyKey` with the plain client inside the transaction, and there's a race, the second insert fails with a unique constraint violation. The plan doesn't specify how to handle this. 

I think the most defensible approach: within the transaction, after finding no existing and reserving funds, if the insert fails due to a unique constraint violation (P2002), we should... hmm, this gets complicated because we've already reserved funds.

Actually, let me reconsider. The cleanest way to handle idempotency under concurrency is to do the check-and-insert in a way that's atomic. But given the plan's structure (reserve first, then create), and the unique constraint on idempotency_key, a race with the same key would:
1. Both read "no existing" (plain client).
2. Both reserve funds (both increment reserved_amount).
3. First inserts payout + message successfully.
4. Second inserts payout → unique constraint violation on idempotency_key.

So the second request would throw a P2002 error, and its transaction rolls back (releasing its reservation). But the client gets a 500 error instead of the existing payout. That's not ideal but it's "safe" (no double reservation because the tx rolls back, no double payout).

But the plan says "a retry with the same key returns the existing payout." For a true concurrent race, this wouldn't hold without explicit handling.

I think for the scope of this task, and given the plan's test is likely sequential, I'll implement the straightforward version. But should I add handling for the unique constraint violation to be safe? 

The instruction says "Implement exactly what the plan specifies for this file." The plan doesn't specify catching P2002. Adding it might be seen as adding a feature not in the plan. But it's also a correctness concern for idempotency under concurrency, which is a core requirement.

Hmm, let me think about this more carefully. The requirement: "retrying the same idempotencyKey must not create a second payout or reserve funds twice." This is about retries, which are typically sequential (a client retries after a timeout). So the sequential case is the primary concern. The concurrent-same-key case is an edge case.

Given the plan's explicit structure and the instruction to implement exactly what the plan specifies, I'll go with the straightforward version: check existing, reserve, create. I won't add P2002 handling because the plan doesn't specify it and it would complicate the flow (especially the reserve-then-create ordering). 

Actually, wait. Let me reconsider. If I want to be robust AND follow the plan, I could consider: what if the idempotency check and creation are done such that a concurrent same-key request is handled gracefully? 

One clean approach: catch the P2002 and, in that case, look up the existing payout and return it. But we'd have already reserved funds in this tx... no wait, if the insert fails, the whole tx rolls back, so the reservation is undone. So catching P2002 and re-reading the existing payout (after rollback) would work:

```ts
async createPayout(dto) {
  try {
    return await this.prisma.$transaction(async (tx) => {
      const existing = await this.repo.findPayoutByIdempotencyKey(dto.idempotencyKey);
      if (existing) return this.toView(existing);
      await this.repo.reserveFunds(tx, dto.accountId, dto.amount);
      const payout = await this.repo.createPayoutWithMessage(tx, dto);
      return this.toView(payout);
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const existing = await this.repo.findPayoutByIdempotencyKey(dto.idempotencyKey);
      if (existing) return this.toView(existing);
    }
    throw e;
  }
}
```

But this adds complexity not in the plan. And `isUniqueViolation` requires checking Prisma's error code (P2002). This is getting into "adding features not in the plan."

I'll make a judgment call: The plan's test for duplicate idempotency key is sequential ("two createPayout with the same key → one creates, the other returns the existing payout"). The straightforward implementation handles this correctly. I'll implement the straightforward version without P2002 handling, to follow the plan exactly. If I add P2002 handling, I risk deviating from "implement exactly what the plan specifies."

Hmm, but actually, let me reconsider whether the straightforward version correctly handles the sequential duplicate case. 

Sequential:
1. First createPayout: no existing, reserve, create payout+message, commit. Returns view.
2. Second createPayout (same key): findPayoutByIdempotencyKey finds the existing → returns its view. No reservation. 

Yes, that works for sequential. Good.

So the straightforward version is correct for the plan's test. I'll go with it. No P2002 handling.

Wait, but there's still the concern: what if `findPayoutByIdempotencyKey` uses the plain client and there's a replication lag or something? No, that's overthinking. In a single-DB test, it's fine.

Actually, hold on. Let me reconsider using the plain client vs tx for the idempotency check. The repo method `findPayoutByIdempotencyKey` uses `this.prisma` (plain). Inside a `$transaction`, calling it means the read is not part of the tx. For the sequential case, that's fine. I'll leave it as the repo defines it.

OK so createPayout is straightforward. Let me also think about error handling: `reserveFunds` throws `PayoutError('insufficient_funds', ...)` or `PayoutError('resource_not_found', ...)`. These should propagate out of createPayout (the transaction rolls back). The controller maps them to the envelope. So I don't catch them in createPayout — let them propagate. Good.

Now, `toView` — a private helper to convert a Payout to PayoutView. The plan defines PayoutView with fields: id, accountId, amount, destinationAddress, idempotencyKey, status, txHash. The Payout model (from Prisma) has: id, accountId, amount, destinationAddress, idempotencyKey, status, txHash, attempts, createdAt, updatedAt. So toView maps the relevant fields.

Let me write toView:
```ts
private toView(payout: Payout): PayoutView {
  return {
    id: payout.id,
    accountId: payout.accountId,
    amount: payout.amount,
    destinationAddress: payout.destinationAddress,
    idempotencyKey: payout.idempotencyKey,
    status: payout.status as PayoutStatus,
    txHash: payout.txHash,
  };
}
```

Wait, the Payout model's `status` is a String in Prisma (since it's not an enum, per the plan: "status String — one of the status values in §1"). So `payout.status` is a string, and I cast to PayoutStatus. That's fine.

Actually, let me double check the Prisma model. The plan says `status` String. So in the generated client, `Payout.status` is `string`. Casting to `PayoutStatus` is fine.

Also `amount` is BigInt in Prisma → `bigint` in TS. Good, matches PayoutView.amount: bigint.

### processMessages(): Promise<number>

Per plan §3: "claims + processes all pending, returns count processed. For each claimed message: run processOneMessage."

Per plan §4, the processing flow:
- Claim the message (pending → processing) via CAS; if it fails, skip.
- Call provider.transfer outside any DB transaction.
- Success: in one tx: settleOut (debit settled), set payout sent with txHash, set message done. Commit.
- Failure: in one tx: increment message attempts, store last_error. If attempts < MAX → reset message to pending (retry) and payout stays/returns to processing. If attempts >= MAX → set message dead, payout needs_review. Commit.

Wait, but there's a subtlety in the success path. Let me re-read §4:

"Success: in one tx: settleOut (debit settled), set payout sent with txHash, set message done. Commit."

Hmm, but what about the reserved_amount? When we settle out, we debit settled_balance. But we also had a reservation (reserved_amount was incremented at create time). If we only debit settled_balance and don't decrement reserved_amount, then the available balance (settled - reserved) would be wrong.

Wait, let's think about the accounting. At create:
- settled_balance unchanged (say 100)
- reserved_amount += amount (say +50, now 50)
- available = settled - reserved = 100 - 50 = 50. Good, the 50 is held.

At success (provider confirms):
- We want to reflect that 50 has been paid out. The settled balance should decrease by 50 (the money left the account). And the reservation should be released (no longer in-flight).
- If we do settleOut: settled_balance -= 50 (now 50), and reserved_amount unchanged (still 50). Then available = 50 - 50 = 0. That's wrong! The 50 was paid out, so available should be 50 (the remaining settled balance of 50).

Wait, let me reconsider. Let me define:
- settled_balance = total confirmed funds in the account.
- reserved_amount = portion of settled funds held by in-flight payouts.
- available = settled_balance - reserved_amount.

At create: settled=100, reserved=0, available=100. Reserve 50: settled=100, reserved=50, available=50.

At success (payout of 50 confirmed): The 50 has left the account. So settled should become 50, and reserved should go back to 0 (the in-flight payout is no longer in-flight; it's settled out). available = 50 - 0 = 50. Correct!

So on success, we need BOTH:
- settleOut: settled_balance -= 50 → 50.
- releaseReserved: reserved_amount -= 50 → 0.

That gives available = 50. Correct.

But the plan's §4 success path says: "in one tx: settleOut (debit settled), set payout sent with txHash, set message done." It mentions settleOut but not releaseReserved!

Wait, let me re-read. The plan §3 says: "on success: settle_out + release? (see §4) + status transitions". The "+" and "?" suggest there's a question about whether to release. And §4 says "Success: in one tx: settleOut (debit settled), set payout sent with txHash, set message done."

Hmm, so §4 doesn't explicitly mention releaseReserved in the success path. But accounting-wise, we need to release the reservation too, otherwise the available balance is wrong.

Wait, let me reconsider the accounting model. Maybe the plan's model is different from what I assumed.

Let me re-read the plan's assumptions:
- "Available balance = settled_balance − reserved_amount, both read from the ledger in the same transaction as the reservation."

So available = settled - reserved. Confirmed my model.

Now, at create, we reserve: reserved += amount. So available decreases by amount. Good.

At success, if we only do settleOut (settled -= amount) and don't release reserved, then:
- settled = 100 - 50 = 50
- reserved = 50 (unchanged)
- available = 50 - 50 = 0

But the account actually has 50 available (the other 50 that wasn't reserved). So available should be 50, not 0. This is wrong — it would incorrectly lock 50 of the account's funds forever.

So we MUST release the reservation on success. The plan's §4 seems to omit this, but §3 hints at it with "settle_out + release?". 

Wait, let me reconsider. Maybe the plan's intent is that settleOut both decrements settled AND the reservation is handled differently. Let me look at the repository methods again:

- `settleOut(tx, accountId, amount)`: "Debits the account's settled balance by amount (the only place settled balance decreases)." It does `settledBalance: { decrement: amount }` and creates a `settle_out` ledger entry.

- `releaseReserved(tx, accountId, amount)`: "Releases a previously reserved amount back to the account." It does `reservedAmount: { decrement: amount }` and creates a `release` ledger entry.

So these are separate operations. On success, we need both: settleOut (to debit the settled balance) AND releaseReserved (to clear the reservation).

Hold on. Let me reconsider whether that's right, because it seems like double-counting. Let me think about the ledger (double-entry style).

The plan says "Keep a double-entry-style ledger. The account's settled balance changes only when the provider confirms the transfer."

Ledger entry types: `reserve`, `release`, `settle_out`. Amounts always positive; sign implied by type.

Let me think of the ledger as tracking the account's funds:
- `reserve`: funds moved from "available" to "reserved". (Held for a payout.)
- `release`: funds moved from "reserved" back to "available". (Payout cancelled/failed.)
- `settle_out`: funds moved out of the account entirely (paid to destination).

So the lifecycle:
1. Create: `reserve` amount. available -= amount, reserved += amount.
2a. Success: the reserved amount is paid out. We need `settle_out` (funds leave account) AND the reservation is consumed. 

Hmm, but if we do both `release` and `settle_out`, that's:
- `release`: reserved -= amount, available += amount. (Funds go back to available.)
- `settle_out`: settled -= amount, available -= amount. (Funds leave.)

Net: reserved unchanged (was +amount from reserve, now -amount from release = 0), settled -= amount, available net 0. Let me track:

Start: settled=100, reserved=0, available=100.
Reserve 50: settled=100, reserved=50, available=50.
Release 50: settled=100, reserved=0, available=100.
Settle_out 50: settled=50, reserved=0, available=50.

Final: settled=50, reserved=0, available=50. Correct! The 50 was paid out, remaining 50 is available.

Alternatively, if we only do `settle_out` without `release`:
Reserve 50: settled=100, reserved=50, available=50.
Settle_out 50: settled=50, reserved=50, available=0.

Final: settled=50, reserved=50, available=0. WRONG — 50 is stuck in reserved forever.

So yes, on success we need BOTH release and settle_out. The plan's §3 "settle_out + release?" confirms this is the intended (if ambiguously worded) design. The "?" was probably because the plan author was unsure of the ordering or whether both are needed, but accounting requires both.

Wait, but actually, let me reconsider. Is there an alternative interpretation where settleOut is the only operation and it handles both? No, the repository's settleOut only decrements settledBalance. So we need releaseReserved separately.

Hmm, but wait. Let me reconsider the ordering and whether both are truly needed, by thinking about what "settled balance" means.

Actually, maybe I'm overcomplicating. Let me reconsider: perhaps the design intent is that `settle_out` represents the final debit, and the reservation is just a temporary hold that must be cleared. So on success: clear the hold (release) and debit the settled balance (settle_out). Both needed. Yes.

On failure (definitive, e.g., provider rejects): the payout is failed, and we should release the reservation (funds go back to available). We do NOT settle_out (no money left). So: `release`.

On retry exhaustion (needs_review): the plan says "do NOT reverse the ledger — because we never received a definitive success, the settled balance was never debited, so there is nothing to roll back; a human investigates." And "the reservation is still held (settled_balance unchanged)." So on needs_review, we do NOT release. The reservation stays. This is the "safe" behavior — funds stay locked until a human decides.

Wait, but that means on needs_review, reserved stays at 50, settled stays at 100, available = 50. The 50 is locked. A human then either:
- Confirms the transfer landed → complete it (settle_out, and the reservation is... hmm).
- Confirms it didn't land → fail it (release).

But the plan doesn't specify the human resolution flow. It just says needs_review is terminal and the reservation is held. So in processOneMessage, on exhaustion, we set message dead + payout needs_review, and do nothing to the ledger. Good.

So to summarize the ledger operations:
- Success: releaseReserved + settleOut (both, in one tx).
- Definitive failure: releaseReserved (in one tx). [But wait, does the plan have a "definitive provider rejection" path? Let me check.]

Hmm, the plan's state machine:
```
created --worker claims--> processing --transfer ok--> sent --(committed)--> completed
                              |
                              |--attempts < MAX, transient--> processing (retry)
                              |--attempts >= MAX, no definitive outcome--> needs_review
                              +--definitive provider rejection--> failed
```

So there's a "definitive provider rejection" → failed path. But how do we distinguish a "definitive provider rejection" from a "transient failure"? The plan says the provider "may throw, time out, or succeed slowly." It doesn't specify how to tell a definitive rejection from a transient error.

Hmm. The plan's retry policy: "Each failed attempt increments attempts; a message is marked dead after the Nth attempt without a definitive outcome." And "if you exhaust retries without a definitive outcome, do something safe."

So the plan treats all failures as potentially transient (retry), and only after exhausting retries does it mark needs_review. The "definitive provider rejection → failed" path in the state machine is shown, but the plan doesn't specify how to detect a definitive rejection. 

Given the provider interface is `transfer(to, amount) -> {txHash}` which "may throw, time out, or succeed slowly," there's no way to distinguish a definitive rejection from the error alone (unless the error has specific properties, which the plan doesn't define). So I think the plan's intent is: all failures are treated as transient and retried up to MAX attempts, then needs_review. The "failed" state in the state machine might be for a future/manual path, or it's shown for completeness but not triggered by the worker.

Wait, but the test "retry exhaustion: provider always throws; after MAX attempts the message is dead, payout is needs_review, and the reservation is still held (settled_balance unchanged)." So on exhaustion → needs_review, not failed. Good.

And there's no test for "definitive rejection → failed." So I'll implement: all failures are retried, and after MAX attempts → needs_review. I won't implement a separate "definitive rejection" detection because the plan doesn't specify how to detect it, and there's no test for it.

Hmm, but the state machine shows "definitive provider rejection → failed." Should I implement it? The plan doesn't define how to detect a definitive rejection. If I can't detect it, I can't implement the path. So I'll treat all failures as transient. This is the "most defensible reading" given the provider interface.

Actually, wait. Let me reconsider. Maybe I should add an ASSUMPTION comment about this: that all provider failures are treated as transient (retried up to MAX), and the "definitive rejection → failed" path is not implemented because the provider interface doesn't expose a way to distinguish definitive from transient failures. That would be honest and defensible.

Let me reconsider the whole failure path:
- On throw: increment message attempts, store last_error. 
  - If attempts < MAX → reset message to pending (retry). Payout status: stays processing? Or goes back to created? The plan says "payout stays/returns to processing." Let me re-read: "If attempts < MAX → reset message to pending (retry) and payout stays/returns to processing."

Hmm, "stays/returns to processing." When does the payout become processing? Let me think about when the payout status transitions to processing.

Looking at the state machine: "created --worker claims--> processing". So when the worker claims the message, the payout goes from created to processing.

Wait, but the claim is on the message (pending → processing). Does claiming the message also set the payout to processing? Let me re-read.

The plan's processOneMessage: "provider.transfer -> on success: settle_out + release? + status transitions; on throw: increment attempts, decide retry vs dead."

And §4: "Claim the message (pending → processing) via CAS; if it fails, skip (another worker got it)."

So the claim sets the message to processing. Does it also set the payout to processing? The state machine says "created --worker claims--> processing", implying that when the worker claims (the message), the payout moves to processing.

So I think when we claim a message, we should also set the corresponding payout to processing. Let me incorporate that.

Actually, let me reconsider. The `claimMessage(id)` method only updates the message (pending → processing). It doesn't touch the payout. So to set the payout to processing, I'd need a separate call: `updatePayoutStatus(payoutId, 'processing')`.

But wait, when does the payout go to processing? Let me think about the flow:
1. Worker claims message (message: pending → processing).
2. Payout should go to processing.
3. Call provider.transfer.
4. On success: payout → sent (with txHash), then... the plan says "sent --(committed)--> completed". So after committing, payout → completed? Or is sent the terminal success state?

Hmm, let me re-read the state machine:
```
created --worker claims--> processing --transfer ok--> sent --(committed)--> completed
```

So: created → processing (on claim) → sent (on transfer ok) → completed (on commit). 

Wait, that's a bit odd. "sent" then "completed"? Let me think. Maybe:
- sent: the provider confirmed the transfer (we have a txHash).
- completed: we've recorded it in our ledger (settled out) and marked the message done.

So the flow on success:
1. Claim message (message → processing), payout → processing.
2. Call provider.transfer → get txHash.
3. In one tx: settleOut + releaseReserved, set payout → sent (with txHash), set message → done. Commit.
4. Then... set payout → completed?

Hmm, but the plan says "in one tx: settleOut (debit settled), set payout sent with txHash, set message done. Commit." So the single tx sets payout to sent and message to done. Then where does completed come from?

The state machine shows "sent --(committed)--> completed". Maybe "completed" is set after the tx commits. So:
- In tx: settleOut, releaseReserved, payout → sent (txHash), message → done. Commit.
- After commit: payout → completed.

But that's two separate operations, and if the second fails (after commit), we'd have a payout stuck at sent with message done. That's a bit fragile but the plan seems to indicate it.

Alternatively, maybe I'm overanalyzing the state machine. Let me reconsider. The requirement says: "Track each payout's lifecycle explicitly (created → processing → sent → completed / failed / needs-review, or your own equivalent)."

So the lifecycle is: created → processing → sent → completed (success), or → failed, or → needs-review.

Hmm, so both sent and completed are part of the success path. Let me think about what distinguishes them.

Actually, maybe the intended flow is:
- sent: provider confirmed (we have txHash). This is a durable fact.
- completed: our internal bookkeeping is done (ledger updated, message done).

But the plan's §4 says the single tx does "settleOut, set payout sent with txHash, set message done." So within that tx, the payout goes to sent. Then "completed" would be set... where?

Wait, maybe I'm misreading the state machine. Let me re-read very carefully:

```
created --worker claims--> processing --transfer ok--> sent --(committed)--> completed
                              |
                              |--attempts < MAX, transient--> processing (retry)
                              |--attempts >= MAX, no definitive outcome--> needs_review
                              +--definitive provider rejection--> failed
```

So from `processing`:
- transfer ok → sent
- (then) committed → completed

So the flow is processing → sent → completed. The "sent" state is reached when the transfer is ok (we have a txHash). Then "(committed)" → completed, meaning after the DB commit of the ledger update.

Hmm, but that would mean:
1. Claim message, payout → processing.
2. provider.transfer ok → we have txHash. Set payout → sent? But the plan says the tx sets "payout sent with txHash" AND "message done" together. So sent and done happen in the same tx.
3. After commit → completed.

But if sent and done are in the same tx, and then completed is after commit, that's:
- Tx: settleOut, releaseReserved, payout → sent (txHash), message → done. Commit.
- After: payout → completed.

But this is weird because the message is done but the payout isn't completed yet. And if the app crashes between commit and setting completed, the payout is stuck at sent with message done.

Alternatively, maybe the plan intends that "sent" and "completed" are set in the same tx, and the state machine's "--(committed)--> completed" just means "after the tx commits, the payout is effectively completed." I.e., the tx sets payout to sent AND the plan considers that as leading to completed.

This is ambiguous. Let me think about what's most defensible and matches the tests.

The test "duplicate message delivery: processOneMessage invoked twice for the same message → the transfer is debited exactly once (settled_balance drops by amount once), payout reaches completed/sent exactly once, second call is a no-op."

So the test checks that "payout reaches completed/sent exactly once." The "/" suggests either completed or sent is acceptable. So the test is lenient about whether it's sent or completed.

Given the ambiguity, I'll make a decision: On success, in the single tx, I'll set the payout to `completed` (not just sent) and the message to `done`. Wait, but the plan says "set payout sent with txHash." Hmm.

Let me reconsider. The plan's §4 explicitly says: "Success: in one tx: settleOut (debit settled), set payout sent with txHash, set message done. Commit." So the plan says set payout to `sent` in the tx. Then the state machine shows sent → completed after commit.

I think the cleanest interpretation that matches the plan's explicit text: 
- In the tx: settleOut, releaseReserved, payout → sent (txHash), message → done.
- After commit: payout → completed.

But the "after commit" step is a separate DB write. To make it robust, I could do it in the same tx actually — set payout to completed directly. But the plan says "sent" in the tx.

Ugh, this is really ambiguous. Let me think about which is more defensible.

Option A: Tx sets payout → sent, message → done. Then a separate write sets payout → completed.
- Pro: matches plan's explicit "set payout sent with txHash" in the tx.
- Con: two writes, potential inconsistency if crash between them.

Option B: Tx sets payout → completed (with txHash), message → done. Skip the intermediate sent state in the worker.
- Pro: single write, atomic, simpler.
- Con: doesn't match plan's "set payout sent" text; the sent state is never set by the worker.

Option C: Tx sets payout → sent (txHash), message → done, AND also... no.

Hmm. Let me reconsider the purpose of "sent" vs "completed". 

Actually, you know what, I think the most sensible interpretation, given the requirement "created → processing → sent → completed / failed / needs-review", is:
- sent = the transfer was sent to the provider and confirmed (we have a txHash). This is the point where the on-chain transfer happened.
- completed = our internal processing is fully done (ledger updated, message done).

The distinction matters for auditing: "sent" means the money is on its way / confirmed on-chain, "completed" means we've fully accounted for it.

Given the plan's explicit instruction to set "sent" in the tx, and the state machine showing sent → completed after commit, I'll go with:
- In the tx: settleOut, releaseReserved, payout → sent (txHash), message → done.
- After the tx commits: payout → completed.

Wait, but that creates the inconsistency risk. Let me reconsider.

Actually, maybe the plan intends for "completed" to be set within the same tx as well, and the state machine is just showing the logical progression. Let me re-read §4 once more:

"Success: in one tx: settleOut (debit settled), set payout sent with txHash, set message done. Commit."

It only mentions setting "sent" and "done" in the tx. It doesn't mention "completed" in the tx. So per the explicit text, the tx sets sent + done. Then completed must be set elsewhere (after commit).

But that's fragile. However, the plan is my spec and I should follow it. But the instruction also says "Implement exactly what the plan specifies." The plan specifies setting sent in the tx. It doesn't explicitly say where completed is set, but the state machine implies after commit.

Hmm, let me think about this differently. What if I set the payout to `completed` directly in the tx (instead of sent)? The test accepts "completed/sent". And it's more robust. But it deviates from the plan's explicit "set payout sent."

Alternatively, what if I do: in the tx, set payout to `sent` and message to `done`. Then after commit, set payout to `completed`. This follows the plan most literally.

I'll go with following the plan literally: tx sets sent + done, then after commit set completed. But I'm worried about the inconsistency.

Wait, actually, let me reconsider. Is there a reason to have both sent and completed? Let me think about the "duplicate message delivery" test: "processOneMessage invoked twice for the same message → the transfer is debited exactly once, payout reaches completed/sent exactly once, second call is a no-op."

For the second call to be a no-op, the message must already be in a terminal state (done or dead) OR the claim must fail. Let me think about how processOneMessage handles an already-processed message.

processOneMessage(msg): 
- First, it should claim the message (pending → processing). But if the message is already done/processing, the claim fails.

Wait, but processOneMessage takes a `msg` (a Message object). Where does the msg come from? From processMessages, which claims messages. Let me re-read.

processMessages: "claims + processes all pending, returns count processed. For each claimed message: run processOneMessage."

So processMessages:
1. Find pending messages (claimNextPendingMessage or findMany).
2. For each, claim it (CAS pending → processing). If claim succeeds, run processOneMessage.

Wait, but there's a subtlety. Let me re-read the plan:

"processMessages(): Promise<number>; // claims + processes all pending, returns count processed. For each claimed message: run processOneMessage."

And processOneMessage: "provider.transfer -> on success: ...; on throw: increment attempts, decide retry vs dead."

And §4: "Claim the message (pending → processing) via CAS; if it fails, skip (another worker got it)."

So the claim happens... where? In processMessages or in processOneMessage? The §4 flow says "Claim the message (pending → processing) via CAS; if it fails, skip." This is part of the "Process one message" flow. So maybe processOneMessage does the claim?

But processOneMessage takes a `msg`. If it does the claim, it would re-claim. Let me think.

Actually, I think the design is:
- processMessages: loop over pending messages. For each, call claimMessage(id) (CAS). If claim succeeds, call processOneMessage(msg). If claim fails, skip.
- processOneMessage: assumes the message is already claimed (processing). Calls provider.transfer, then handles success/failure.

OR:
- processMessages: find pending messages, for each call processOneMessage(msg).
- processOneMessage: first claims the message (CAS). If claim fails, return (skip). Then proceeds.

The §4 flow lists "Claim the message" as step 1 of "Process one message." So I lean towards processOneMessage doing the claim. But then processMessages just finds and passes messages.

Hmm, but if processOneMessage does the claim, then processMessages would find pending messages and pass them, and processOneMessage claims each. That works.

But there's a subtlety: if processMessages finds a message that's pending, and calls processOneMessage which claims it, that's fine. But if two workers run concurrently, both might find the same pending message and both call processOneMessage. The claim (CAS) ensures only one succeeds. The other's claim fails and it skips. Good, that's the at-least-once handling.

So I think:
- processMessages: find all pending messages (or loop finding one at a time), for each call processOneMessage(msg). Count how many were actually processed (claimed successfully).
- processOneMessage: claim the message (CAS pending → processing). If claim fails, return (not processed). Then set payout to processing. Call provider.transfer. Handle success/failure.

Wait, but the count. "returns count processed." If processOneMessage returns a boolean (whether it was processed/claimed), then processMessages sums them. But the plan says processOneMessage returns Promise<void>. Hmm.

Let me re-read: "private processOneMessage(msg: Message): Promise<void>." So it returns void. Then how does processMessages count? 

Maybe processOneMessage returns void but processMessages counts based on the claim. But the claim is inside processOneMessage...

Alternatively, maybe the claim is in processMessages, and processOneMessage assumes it's claimed. Let me reconsider.

If the claim is in processMessages:
```ts
async processMessages(): Promise<number> {
  let processed = 0;
  // loop
  while (true) {
    const msg = await this.repo.claimNextPendingMessage(); // find oldest pending
    if (!msg) break;
    const claimed = await this.repo.claimMessage(msg.id); // CAS
    if (!claimed) continue; // lost the race, try next
    await this.processOneMessage(msg);
    processed++;
  }
  return processed;
}
```

But wait, `claimNextPendingMessage` returns a pending message, then `claimMessage` does the CAS. But between findFirst and updateMany, another worker could claim it. The CAS handles that. But there's a subtle issue: if I use `claimNextPendingMessage` (findFirst pending) in a loop, and after processing one message it goes to done/dead (or back to pending for retry), the loop might re-find a message that just went back to pending (retry). That could cause an infinite loop if a message keeps failing and going back to pending within the same processMessages call.

Hmm, that's a concern. Let me think.

Actually, for retry, the message goes back to pending. So if processMessages loops with "find next pending," it could pick up the same message again (now pending for retry) and process it again, incrementing attempts again, in the same call. That would burn through all retries in one processMessages call. Is that desired? Probably not — we want to spread retries over time (polling interval). So processMessages should process each pending message at most once per call.

To avoid re-processing a retried message in the same call, I should snapshot the pending messages at the start and process each once. Or use a different approach.

Let me reconsider. A cleaner approach:
```ts
async processMessages(): Promise<number> {
  const pending = await this.repo.findPendingMessages(); // snapshot
  let processed = 0;
  for (const msg of pending) {
    const claimed = await this.repo.claimMessage(msg.id); // CAS
    if (!claimed) continue;
    await this.processOneMessage(msg);
    processed++;
  }
  return processed;
}
```

But the repository doesn't have a `findPendingMessages` (plural) method. It has `claimNextPendingMessage()` (singular, returns oldest pending or null). Hmm.

Wait, the plan's repository methods:
- `claimNextPendingMessage(): Promise<Message | null>;` — "Returns the oldest pending message, or null when the queue is empty."
- `claimMessage(id): Promise<boolean>;` — CAS.

So there's no "find all pending" method. Only "claim next pending" (which is actually just a findFirst, not a claim) and "claimMessage" (the CAS).

So the intended flow with these methods:
```ts
async processMessages(): Promise<number> {
  let processed = 0;
  while (true) {
    const msg = await this.repo.claimNextPendingMessage(); // oldest pending or null
    if (!msg) break;
    const claimed = await this.repo.claimMessage(msg.id); // CAS
    if (!claimed) {
      // lost the race; but this message is now processing (by someone else), 
      // so it won't be returned by claimNextPendingMessage again. Continue.
      continue;
    }
    await this.processOneMessage(msg);
    processed++;
  }
  return processed;
}
```

But the infinite loop concern: if processOneMessage causes a message to go back to pending (retry), then claimNextPendingMessage could return it again. Let's trace:
- Start: message M is pending (attempts=0).
- claimNextPendingMessage → M. claimMessage(M) → success (M now processing). processOneMessage(M): transfer fails, attempts=1 < MAX, M → pending.
- Loop: claimNextPendingMessage → M again (it's pending now). claimMessage(M) → success. processOneMessage(M): transfer fails, attempts=2 < MAX, M → pending.
- ... this continues until attempts = MAX, then M → dead. Then claimNextPendingMessage → next pending or null.

So in one processMessages call, a failing message would be retried MAX times and go to dead. That burns all retries in one poll. Is that a problem?

The plan says "Retry a bounded number of times." It doesn't explicitly say retries should be spread over time. But the polling worker "runs every N seconds," implying that each poll processes the queue, and retries happen across polls. If all retries happen in one poll, then a transient failure that lasts longer than the processing time would exhaust all retries immediately.

Hmm, but actually, for the purposes of this task and the tests, does it matter? The test "retry exhaustion: provider always throws; after MAX attempts the message is dead, payout is needs_review." If processMessages processes the message MAX times in one call (all failing), then after one processMessages call, the message is dead and payout is needs_review. That matches the test (the test probably calls processMessages once or a few times and checks the final state).

But wait, if the provider always throws and processMessages retries MAX times in one call, then the test "retry exhaustion" would pass after a single processMessages call. That's fine.

But the concern about burning retries in one poll is a real design issue. However, the plan's repository only provides `claimNextPendingMessage` (singular) and no "find all pending." So the intended flow is probably the while-loop with claimNextPendingMessage. And the plan might accept that retries happen within a poll.

Alternatively, maybe the intended flow is to process only one message per poll? No, "claims + processes all pending" suggests processing all pending in one call.

Hmm, let me reconsider. Actually, maybe the cleaner interpretation is: processMessages processes each currently-pending message once per call. To do that with the given repo methods, I'd snapshot the pending IDs first. But there's no "find all pending" method.

Wait, I could use `claimNextPendingMessage` in a loop but track which messages I've already claimed in this call, to avoid re-processing a retried one. But that's hacky.

Alternatively, I realize the simplest correct approach given the repo methods: use a while loop with claimNextPendingMessage, and accept that a message that fails and goes back to pending might be re-processed in the same call. But to prevent infinite loops and burning retries, I could limit it.

Actually, wait. Let me reconsider. Is it really a problem to burn retries in one poll? Let me think about the real-world semantics. The polling worker runs every N seconds. If a message fails and is retried immediately (in the same poll), then the "retry" has no delay. The point of retries with delays is to wait for transient issues to resolve. If we retry immediately, a transient issue lasting 1 second would exhaust all 3 retries (if processing is fast).

But the plan doesn't specify retry delays. It just says "Retry a bounded number of times." So maybe immediate retries are acceptable per the plan.

Given the ambiguity, and to keep it simple and matching the repo methods, I'll go with the while-loop approach but add a guard to prevent infinite loops. Actually, the natural termination is: each claim either leads to done/dead (message leaves pending) or back to pending (retry). If it goes back to pending, it could be re-claimed. To prevent infinite loop, I need to ensure progress.

Hmm, actually, if the provider always throws, each re-claim increments attempts, and after MAX attempts it goes to dead. So it terminates after MAX re-claims. If the provider succeeds, it goes to done. So the loop always terminates (either all messages reach done/dead, or the queue is empty). The only "waste" is burning retries in one poll for failing messages.

I think this is acceptable per the plan. Let me go with it. But let me reconsider whether burning retries in one poll breaks any test.

Test "transient failure then success: provider throws once then succeeds → payout completes, settled_balance debited once, message done." If the provider throws on the first attempt and succeeds on the second, and processMessages does: claim M (attempts 0), transfer fails (attempts=1, M→pending), re-claim M, transfer succeeds (M→done). So in one processMessages call, it retries once and succeeds. That matches the test. Good.

Test "retry exhaustion: provider always throws; after MAX attempts the message is dead, payout is needs_review." In one processMessages call: claim M (attempts 0), fail (attempts=1, pending), re-claim, fail (attempts=2, pending), re-claim, fail (attempts=3=MAX, dead). So after one call, M is dead, payout needs_review. Matches test. Good.

So the while-loop approach works for all tests. I'll use it. But I'm slightly concerned about the "burn retries in one poll" semantics. However, since the plan doesn't specify retry delays and the tests pass, I'll go with it.

Actually, wait. Let me reconsider. There's a subtle issue with the while-loop and `claimNextPendingMessage` returning the "oldest pending." If I have multiple messages, and one keeps going back to pending (retry), it's the oldest, so claimNextPendingMessage would keep returning it until it's dead. That means other pending messages wouldn't be processed until the failing one is dead. That could starve other messages.

Example: M1 (oldest) always fails, M2 is pending. 
- claimNextPendingMessage → M1. claim M1, process, fail, attempts=1, M1→pending.
- claimNextPendingMessage → M1 (still oldest, still pending). claim M1, process, fail, attempts=2, M1→pending.
- ... M1 goes to dead after MAX attempts.
- claimNextPendingMessage → M2. Process M2.

So M2 is only processed after M1 exhausts all retries. That's starvation. In one processMessages call, M2 waits for M1 to burn MAX retries. If MAX is 3 and each transfer takes time, M2 waits 3x the transfer time.

This is a real issue but maybe acceptable for this task's scope. The plan doesn't address starvation. To avoid it, I'd want to process each pending message once per call (snapshot approach). But the repo doesn't have a "find all pending" method.

Hmm. Given the constraints, I have two options:
1. Use the while-loop with claimNextPendingMessage (simple, matches repo methods, but has starvation + retry-burning issues).
2. Snapshot pending messages at the start (process each once per call), but I need a way to get all pending. The repo only has claimNextPendingMessage (singular).

Wait, could I use claimNextPendingMessage in a loop to build a snapshot? No, because it doesn't remove them from pending (it's just a findFirst). So I'd get the same first one repeatedly.

Alternatively, I could add logic to process each message at most once per call by tracking processed IDs. But that's complex and the repo doesn't support it cleanly.

Given the plan's repo methods, I think the intended flow is option 1 (while-loop). The starvation and retry-burning are acceptable per the plan's scope. I'll go with option 1 but be mindful.

Actually, wait. Let me reconsider the design. Maybe processMessages is intended to process messages one at a time per poll, and the "all pending" means it keeps going until there are no more pending. The starvation is a known limitation but not addressed in the plan. I'll implement option 1.

Hmm, but actually, let me reconsider whether to re-claim within the same call. What if I change the structure so that a message that fails and goes back to pending is NOT re-processed in the same call? 

I could do: processMessages finds the current set of pending messages (by looping claimNextPendingMessage but only to collect, not to claim)... no, that doesn't work because claimNextPendingMessage always returns the same first one.

OK, I think the cleanest given the repo is: 
```ts
async processMessages(): Promise<number> {
  let processed = 0;
  for (;;) {
    const msg = await this.repo.claimNextPendingMessage();
    if (!msg) break;
    const claimed = await this.repo.claimMessage(msg.id);
    if (!claimed) continue; // another worker took it; it's no longer pending, so loop will find the next
    await this.processOneMessage(msg);
    processed++;
  }
  return processed;
}
```

This is simple and matches the repo. I'll go with it. The starvation/retry-burning is a known limitation but acceptable.

Wait, but there's the infinite-loop risk if a message keeps going back to pending forever. But it can't, because attempts increment each time and after MAX it goes to dead. So it terminates. Good.

Actually, hold on. Let me reconsider the "claimed" check. `claimMessage` does CAS pending→processing. If it returns false, it means the message was not pending (someone else claimed it, or it's already processing/done/dead). In that case, we `continue` to find the next pending. But if the message is now processing (by another worker), it won't be returned by claimNextPendingMessage (which only returns pending). So the loop will find a different message. Good, no infinite loop from that.

But what if claimMessage returns false because the message is already done/dead? Then it's not pending, so claimNextPendingMessage won't return it. Good.

The only way to loop on the same message is if processOneMessage sends it back to pending (retry). And that's bounded by MAX attempts. So termination is guaranteed.

OK, I'm confident in this structure. Let me now detail processOneMessage.

### processOneMessage(msg: Message): Promise<void>

Wait, but I decided the claim is in processMessages. So processOneMessage assumes the message is already claimed (processing). Let me re-read the plan to confirm where the claim is.

§4: "Process one message (per attempt, its own tx for the DB writes):
- Claim the message (pending → processing) via CAS; if it fails, skip (another worker got it).
- Call provider.transfer outside any DB transaction (it may be slow/timeout).
- Success: ...
- Failure: ..."

So §4 lists "Claim the message" as step 1 of "Process one message." This suggests the claim is inside processOneMessage. But then processMessages would just find and pass messages, and each processOneMessage claims its own.

But if the claim is in processOneMessage, then processMessages' "claims + processes all pending" — the "claims" part is done by processOneMessage. So processMessages just iterates pending messages and calls processOneMessage for each, which claims internally.

Hmm, but then how does processMessages know which messages to pass? It would find pending messages and pass them. But if it uses claimNextPendingMessage (findFirst pending) in a loop, and processOneMessage claims it, then after processing, the message is done/dead/pending. If pending (retry), the loop re-finds it. Same as before.

Alternatively, processMessages could find all pending and pass them, but there's no "find all" method.

Let me reconsider. I think the claim should be in processOneMessage, per §4. Let me restructure:

```ts
async processMessages(): Promise<number> {
  let processed = 0;
  for (;;) {
    const msg = await this.repo.claimNextPendingMessage(); // oldest pending or null
    if (!msg) break;
    const didProcess = await this.processOneMessage(msg); // claims internally
    if (didProcess) processed++;
  }
  return processed;
}

private async processOneMessage(msg: Message): Promise<boolean> {
  const claimed = await this.repo.claimMessage(msg.id); // CAS pending→processing
  if (!claimed) return false; // lost the race
  // ... process
  return true;
}
```

But the plan says processOneMessage returns Promise<void>, not boolean. Hmm.

Wait, let me re-read: "private processOneMessage(msg: Message): Promise<void>." So it returns void. Then how does processMessages count "processed"?

If processOneMessage returns void and the claim is inside it, then processMessages can't easily know if it was processed. Unless processMessages does the claim and passes a claimed message.

This is getting confusing. Let me step back and think about the cleanest design that matches the plan's signatures:
- `processMessages(): Promise<number>` — returns count processed.
- `private processOneMessage(msg: Message): Promise<void>` — returns void.

For processMessages to return a count, it needs to know how many messages were processed. If processOneMessage returns void, then the count must be determined by processMessages itself (e.g., based on the claim).

So the claim should be in processMessages, and processOneMessage assumes the message is already claimed (processing). That way, processMessages increments the count when the claim succeeds.

So:
```ts
async processMessages(): Promise<number> {
  let processed = 0;
  for (;;) {
    const msg = await this.repo.claimNextPendingMessage();
    if (!msg) break;
    const claimed = await this.repo.claimMessage(msg.id);
    if (!claimed) continue;
    await this.processOneMessage(msg);
    processed++;
  }
  return processed;
}

private async processOneMessage(msg: Message): Promise<void> {
  // msg is already claimed (processing) by processMessages
  const payout = await this.repo.getPayout(msg.payoutId);
  if (!payout) {
    // orphaned message; mark done to avoid reprocessing? or dead?
    // Plan doesn't specify. Mark done.
    await this.repo.setMessageStatus(msg.id, 'done');
    return;
  }
  // set payout to processing
  await this.repo.updatePayoutStatus(payout.id, 'processing');
  // call provider outside tx
  try {
    const { txHash } = await this.provider.transfer(payout.destinationAddress, payout.amount);
    // success: in one tx
    await this.prisma.$transaction(async (tx) => {
      await this.repo.releaseReserved(tx, payout.accountId, payout.amount);
      await this.repo.settleOut(tx, payout.accountId, payout.amount);
      await this.repo.updatePayoutStatus(payout.id, 'sent', txHash); // wait, updatePayoutStatus doesn't take tx
      ...
    });
  } catch (e) {
    // failure handling
  }
}
```

Wait, there's a problem. `updatePayoutStatus` and `setMessageStatus` don't take a `tx` parameter (per the repo signatures). So they use the plain client, not the transaction. That means I can't include them in a `$transaction` via the repo methods.

Let me re-check the repo signatures:
- `updatePayoutStatus(id, status, txHash?)` — no tx.
- `setMessageStatus(id, status, lastError?)` — no tx.
- `incrementMessageAttempts(id)` — no tx.
- `incrementPayoutAttempts(id)` — no tx.
- `reserveFunds(tx, ...)` — has tx.
- `releaseReserved(tx, ...)` — has tx.
- `settleOut(tx, ...)` — has tx.
- `createPayoutWithMessage(tx, dto)` — has tx.

So only the funds-related methods and createPayoutWithMessage take a tx. The status update methods don't.

This is a problem for the plan's §4 which says "Success: in one tx: settleOut (debit settled), set payout sent with txHash, set message done." If updatePayoutStatus and setMessageStatus don't take a tx, they can't be part of the same transaction.

Hmm. So either:
(a) The plan intends for these status updates to be outside the tx (separate writes), or
(b) The repo methods should take a tx but the plan's signatures omitted it.

Given the plan explicitly lists the repo signatures and only some take tx, I think (a) is the intended reading: the funds operations (settleOut, releaseReserved) are in the tx, and the status updates (updatePayoutStatus, setMessageStatus) are separate writes.

But that means the "one tx" in §4 only covers the funds operations, not the status updates. That's a bit odd but matches the repo signatures.

Wait, let me re-read §4: "Success: in one tx: settleOut (debit settled), set payout sent with txHash, set message done. Commit."

It says "in one tx: settleOut, set payout sent, set message done." But if the status updates don't take a tx, they can't be in the tx. Contradiction.

Unless... the plan intends for the service to do the status updates directly via Prisma (bypassing the repo)? But that violates "repository is the only layer that touches the database."

Hmm, this is a genuine design tension in the plan. Let me think about the most defensible reading.

Option 1: The funds operations (settleOut, releaseReserved) are in the tx. The status updates (updatePayoutStatus, setMessageStatus) are done via the repo's non-tx methods, outside the tx. So the "one tx" only covers funds. The status updates are separate.

This is defensible because:
- It matches the repo signatures (only funds methods take tx).
- It keeps the "repository is the only layer that touches the database" rule.
- The critical atomicity (funds) is preserved in the tx.

The downside: if the app crashes after the funds tx commits but before the status updates, we'd have a settled-out account but a payout not marked sent/done. But the message is already claimed (processing), so it would be re-processed... wait, no. If the message is still processing (not done), and the worker restarts, would it re-claim? claimMessage only claims pending messages. A processing message wouldn't be re-claimed. So it'd be stuck in processing forever. That's a problem (stuck message).

But the plan doesn't address stuck messages (processing forever). It's a known limitation of at-least-once without a timeout/reclaim mechanism. The plan focuses on the funds safety, which is preserved.

Option 2: Do everything (funds + status) in the tx by having the service call Prisma directly for the status updates. But this violates the layering rule.

Option 3: The repo methods should take a tx, and the plan's signatures are incomplete. But I can't change the repo (it's read-only reference). And the plan's signatures are what they are.

Given the constraints, Option 1 is the most defensible: funds in tx, status updates via repo non-tx methods.

But wait, let me reconsider. If the status updates are outside the tx, then the ordering matters for consistency. Let me think about the success path:

1. Claim message (processing). [done in processMessages]
2. Set payout to processing. [repo, plain client]
3. provider.transfer → txHash. [outside DB]
4. Tx: releaseReserved + settleOut. Commit. [repo, tx]
5. Set payout to sent (txHash). [repo, plain client]
6. Set message to done. [repo, plain client]

If crash between 4 and 5: funds are settled out (account debited), but payout is not marked sent, message is not done (still processing). On restart, the message is stuck in processing (not re-claimed). The account has been debited but the payout isn't recorded as sent. Inconsistent, but funds are safe (no double-spend; the money was actually transferred and debited).

If crash between 5 and 6: payout is sent, but message is processing. Stuck message.

These are edge cases the plan doesn't fully address. But the core funds safety is preserved. I'll go with Option 1.

Actually, wait. Let me reconsider whether the status updates
