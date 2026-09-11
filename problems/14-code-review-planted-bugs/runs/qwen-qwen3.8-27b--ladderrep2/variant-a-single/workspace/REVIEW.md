# Code review — transfers service

Scope: `transfers.service.ts`, `accounts.repository.ts`, `serializer.ts`, as provided.
Findings only — no source file is modified. Line numbers refer to the fixtures.

**Assumptions (stated because the Prisma schema and controllers are not in the fixture):**

- **A1** — `idempotencyKey` is unique on `Transfer`, implied by the `findUnique` at
  `transfers.service.ts:29`.
- **A2** — `notifications.sendTransferReceipt` is async and can reject (provider call).
- **A3** — `risk.evaluate` is a network call to an external provider (name and module
  `../risk/risk.client`).

**Traced and found sound** (so the list below is not pattern-matching): the main-path
balance updates (`transfers.service.ts:48-55`) are relative `decrement`/`increment`
applied under `FOR UPDATE` locks inside one transaction, and the insufficient-funds
check (line 35) reads a locked row — the happy path is correct. `serializer.ts`'s
`moneyReplacer` (lines 4-9) is a correct replacer for the interceptor path; the
serialization defect below is the audit branch that never uses it.

---

## Blockers

### B1. Audit-log payload cannot be serialized — every large transfer rolls back

- **File:** `transfers.service.ts:80` (the `amount` inside the `JSON.stringify` at lines 78-82)
- **Severity:** blocker
- **Mechanism:** `amount` is a `bigint` (parameter, line 23). `JSON.stringify` has no
  bigint handling and throws `TypeError: Do not know how to serialize a BigInt` the
  moment it reaches one. `moneyReplacer`/`serializeResponse` are not used on this
  branch, so nothing intercepts it. The throw is inside the interactive transaction
  opened at line 28, so Prisma rolls the whole transaction back — no partial state,
  but the transfer is rejected.
- **Conditions:** deterministic; no concurrency required. Every transfer with
  `amount >= 1_000_000n` (the branch at line 74). The suite passes because it stays
  below the threshold — which is precisely the branch the audit code exists for.
- **Fix:**
      payload: JSON.stringify({
        transferId: transfer.id,
        amount: amount.toString(),
        riskScore: risk.score,
      }),

### B2. Retry sweep writes an absolute balance from a stale read, in three non-atomic steps

- **File:** `transfers.service.ts:102-118`; core defect lines 107-110
- **Severity:** blocker
- **Mechanism:** three independent defects in one path:
  1. **Lost update.** The payer balance is read at line 102 with no lock and no
     transaction, then line 109 writes it **back as an absolute value**
     (`balance: from.balance - t.amount`) instead of a relative `decrement`. Any
     credit to that account committed between the read and the write is silently
     destroyed.
  2. **Non-atomicity.** The debit (line 107), the credit (line 111) and the status
     flip (line 115) are three independent auto-committed statements. A crash or DB
     failure between line 107 and line 111 leaves a debit with no credit — money
     gone — and the row is still `FAILED_TRANSIENT`, so the next sweep debits again.
  3. **No claim.** The sweep selects on `status: 'FAILED_TRANSIENT'` (line 98) but
     never transitions the status atomically, so two overlapping runs both see the
     same row and both apply it — a double transfer.
- **Conditions:** (1) any concurrent credit to the payer account during the sweep
  window (a live transfer, or another sweep); (2) any process/DB failure between the
  debit and the credit; (3) two invocations of `retryFailedTransfers` overlapping
  (cron + manual, or a slow run).
- **Fix:** per transfer, take an atomic claim first, then do all writes in one
  transaction with relative math:
      const claimed = await this.prisma.transfer.updateMany({
        where: { id: t.id, status: 'FAILED_TRANSIENT' },
        data: { status: 'RETRYING' },
      });
      if (claimed.count === 0) continue;
      await this.prisma.$transaction(async (tx) => {
        const from = await this.accounts.lockAccount(tx, t.fromAccountId);
        if (from.balance < t.amount) return; // leave status for next sweep
        await tx.account.update({ where: { id: from.id }, data: { balance: { decrement: t.amount } } });
        await tx.account.update({ where: { id: t.toAccountId }, data: { balance: { increment: t.amount } } });
        await tx.transfer.update({ where: { id: t.id }, data: { status: 'COMPLETED' } });
      });

## Major

### M1. Deadlock from opposite lock acquisition order

- **File:** `transfers.service.ts:32-33`
- **Severity:** major
- **Mechanism:** `transfer()` always locks `fromAccountId` first, then
  `toAccountId`. Two transfers between the same pair in opposite directions acquire
  the same two row locks in opposite orders; PostgreSQL's deadlock detector
  (SQLSTATE 40P01) then aborts one transaction, and the loser gets a 500 that the
  client must retry. Money stays consistent (rollback), but a defined traffic shape
  produces spurious failures that grow with volume.
- **Conditions:** A→B and B→A in flight simultaneously, overlapping inside the lock
  window (lines 35-87 — which includes the risk call, see M4, so the window is
  provider-latency-sized, not just DB-time-sized).
- **Fix:** lock in a global canonical order:
      const [x, y] = [fromAccountId, toAccountId].sort();
      const rowX = await this.accounts.lockAccount(tx, x);
      const rowY = x === y ? rowX : await this.accounts.lockAccount(tx, y);
      const from = rowX.id === fromAccountId ? rowX : rowY;
      const to = rowX.id === toAccountId ? rowX : rowY;
  Self-transfer (`from === to`) is safe: same row, one lock.

### M2. Receipt is fire-and-forget: unhandled rejection, lost and duplicate notifications

- **File:** `transfers.service.ts:90` (compounded by the replay path at line 30)
- **Severity:** major
- **Mechanism:** `sendTransferReceipt` is called without `await`.
  1. If it rejects (provider down/timeout — A2), the rejection is unhandled. It
     occurs after `transfer()` has already resolved, outside the request's promise
     chain, so Nest's exception filters cannot see it; Node 20's default
     (`--unhandled-rejections=throw`) terminates the process — after the transfer
     committed and the 2xx was (likely) already sent. A flaky notification provider
     takes down a healthy payments API.
  2. The send is outside the transaction and not persisted: a crash in the
     commit→send window loses the receipt with nothing to replay.
  3. An idempotent replay (line 30 returns the existing row) falls through to line
     90 as well, so a successful duplicate request delivers a second receipt.
- **Conditions:** (1) provider failure on any transfer; (2) process crash between
  commit and send; (3) any repeated `idempotencyKey` request arriving after the
  original committed.
- **Fix:**
      let created = true; // set false on the `return existing` path
      ...
      if (created) await this.notifications.sendTransferReceipt(result.id);
  Awaiting surfaces provider failure to the request (handle it in the global filter
  or enqueue). Durable delivery needs an outbox row written in the same transaction
  as the transfer plus a drainer — follow-up, but the `await` and the `created`
  guard are the minimum.

### M3. pg client is leaked on every error in `exportLedger`

- **File:** `transfers.service.ts:150-158`; the leak is line 158
- **Severity:** major
- **Mechanism:** `client.release()` runs on the happy path only. If
  `client.query` rejects (any DB error, server disconnect, statement timeout) or the
  `.map`/`.join` at lines 155-157 throws, line 158 is skipped and the client stays
  checked out of the pool. Each error permanently consumes a pool slot; with a
  default pool size of 10, ten failed exports exhaust the pool and every subsequent
  raw query hangs.
- **Conditions:** any error inside lines 150-157; no concurrency required.
- **Fix:**
      const client = await this.accounts.getRawClient();
      try {
        const res = await client.query(
          'SELECT * FROM "LedgerEntry" WHERE "accountId" = $1 ORDER BY "createdAt"',
          [accountId],
        );
        return res.rows.map((r) => `${r.createdAt.toISOString()},${r.transferId},${r.delta}`).join('\n');
      } finally {
        client.release();
      }

### M4. External risk call executes while holding both row locks

- **File:** `transfers.service.ts:39-43`
- **Severity:** major
- **Mechanism:** `risk.evaluate` (A3) is made after both `FOR UPDATE` locks
  (lines 32-33) and before commit. While the provider responds, both account rows
  stay locked and the interactive transaction holds a Prisma pool connection. Every
  other transfer touching either account queues behind provider latency; a 30 s
  provider stall becomes 30 s of queueing on two accounts and pins a pool
  connection per in-flight transfer. It also widens the M1 deadlock window, since
  the holding side is slow.
- **Conditions:** provider slowness (upstream load, timeouts, GC) concurrent with
  any other transfer touching the same accounts — normal production variability.
- **Fix:** move the evaluation before the transaction; it only needs account ids and
  amount, not locked balances:
      const risk = await this.risk.evaluate({ from: fromAccountId, to: toAccountId, amount: amount.toString() });
      if (risk.decision === 'BLOCK') throw new BadRequestException('transfer blocked by risk policy');
      const result = await this.prisma.$transaction(async (tx) => { /* ... */ });
  The verdict is then one provider round-trip stale — an acceptable trade for a risk
  check; calling it later inside the transaction still holds the locks.

### M5. Idempotency check runs before the locks, so a concurrent duplicate 500s instead of replaying

- **File:** `transfers.service.ts:29-30`
- **Severity:** major
- **Mechanism:** `findUnique` on `idempotencyKey` happens before either row is
  locked. Under READ COMMITTED, a concurrent request with the same key does not see
  the first request's uncommitted row, so both pass line 30. The second is then
  serialized by the `FOR UPDATE` lock, re-executes the full transfer, and dies in
  `tx.transfer.create` (line 57) on the unique constraint (A1) → P2002 → 500. A
  client retry that should be an idempotent no-op returning the original transfer
  instead looks like a failure. (If A1 is wrong — no unique constraint — this is a
  double debit instead.)
- **Conditions:** a client retries with the same `idempotencyKey` while the original
  is still in flight — exactly the situation (timeouts) that makes clients retry.
- **Fix:** re-check after the locks (the lock guarantees the first transaction has
  committed by the time we get here), and treat P2002 as "already exists" for the
  different-account-pair edge case:
      // after the two lockAccount calls:
      const existing = await tx.transfer.findUnique({ where: { idempotencyKey } });
      if (existing) return existing;
  Keep the pre-lock check as a fast path. Around line 57, catch
  `(e as { code?: string }).code === 'P2002'`, re-read by `idempotencyKey`, and
  return that row.

### M6. Statement builder fires 2N+1 queries, all at once

- **File:** `transfers.service.ts:129-143` (per-row queries at 131-133 and 134-136)
- **Severity:** major
- **Mechanism:** for each transfer, a `ledgerEntry.findMany` and an
  `account.findUnique` are issued inside `Promise.all`. A month with N transfers
  costs 1 + 2N queries, launched concurrently. Prisma's connection pool (default 10)
  cannot carry that: a busy month (5k rows → 10k concurrent query attempts) floods
  the pool and the statement fails with connection timeouts — for every caller of
  `buildStatement`.
- **Conditions:** any month with more than a handful of transfers; severity scales
  linearly with the account's activity.
- **Fix:** two batched queries, then group in memory:
      const ids = transfers.map((t) => t.id);
      const [entries, accounts] = await Promise.all([
        this.prisma.ledgerEntry.findMany({ where: { transferId: { in: ids }, accountId } }),
        this.prisma.account.findMany({ where: { id: { in: transfers.flatMap((t) => [t.fromAccountId, t.toAccountId]) } } }),
      ]);
      // index entries by transferId and accounts by id, then map over transfers
      // without any further queries.

### M7. `transfer()` returns a pre-serialized string; the response pipeline serializes it again

- **File:** `transfers.service.ts:92`, with `serializer.ts:11-13` and the wiring note at `serializer.ts:2`
- **Severity:** major
- **Mechanism:** `serializeResponse` returns a `string`, and `transfer()` returns
  that string. The header comment in `serializer.ts` says `moneyReplacer` is "wired
  into the interceptor for API responses (main path)" — the response pipeline
  already handles bigints. The service-level call is therefore redundant *and*
  harmful: a standard Nest controller returns the string, the JSON encoder encodes
  a string, and clients receive a JSON **string containing JSON**
  (`"{\"id\":...}"`) that they must double-parse. Every transfer response is
  affected, not just large ones.
- **Conditions:** any call to `transfer()` under the standard controller return
  pattern the `serializer.ts` comment describes.
- **Fix:** return the object and let the interceptor's replacer do the bigint work:
      return result;
  If some consumer genuinely needs raw text, move `serializeResponse` to that
  boundary and remove one of the two serializations — never both. (After this fix,
  `serializeResponse` has no callers; see style notes.)

## Minor

### m1. Missing account surfaces as a 500

- **File:** `accounts.repository.ts:31`
- **Severity:** minor
- **Mechanism:** `throw new Error(...)` is not a Nest exception; Nest maps unknown
  throws to 500 with the raw message. A transfer referencing a nonexistent account
  is a client error (404), and the current message also puts the account id into the
  error body.
- **Conditions:** any request naming a nonexistent account (typo, deleted account).
- **Fix:** throw a typed `NotFoundException` (or the app's `resource_not_found`
  error type) and let the global exception filter shape the envelope.

### m2. (Open question — could not be resolved by tracing) Retry path writes no ledger or audit rows

- **File:** `transfers.service.ts:101-119` vs. the main path's `ledgerEntry.createMany` at lines 67-72
- **Severity:** minor, pending team confirmation
- **Mechanism:** the main path writes a ledger-entry pair (and an audit row for
  large amounts) per transfer; the retry path updates balances and status only. The
  statement builder computes deltas **from ledger entries** (line 140), so a
  transfer completed via the sweep would report delta 0, and the ledger table would
  no longer reconcile against the transfers table — *if* the flow that creates
  `FAILED_TRANSIENT` rows also skipped the ledger writes. Nothing in the three files
  in scope ever creates a `FAILED_TRANSIENT` row, so I cannot tell which writer
  owns the ledger entries.
- **Conditions:** any transfer that completes via the nightly sweep.
- **Fix (pending answer):** if the original attempt never wrote ledger entries, the
  sweep must write the same `ledgerEntry` pair (and audit row above threshold)
  inside the B2 transaction; if the creator of `FAILED_TRANSIENT` rows already
  wrote them, say so in a comment on `retryFailedTransfers` so nobody "fixes" this
  into a double-write.

## Non-blocking style notes (do not gate the review)

- `transfers.service.ts:39` — the local `const risk` shadows the injected
  `this.risk`; rename the local to `riskResult`.
- `transfers.service.ts:148` and 155-157 — the doc says "streamed via the raw pg
  client" but the query materializes every row into `res.rows` and builds the whole
  CSV in memory. If streaming is actually required, use a server-side cursor;
  otherwise fix the comment.
- `transfers.service.ts:97` — `retryFailedTransfers` loads the entire
  `FAILED_TRANSIENT` set without pagination; fine today, needs a cursor at scale.
- `accounts.repository.ts:37-39` — `getRawClient` pushes the release-on-error
  contract (M3) onto every caller implicitly; a `withClient(fn)` helper in the
  repository would make the leak structurally impossible.
- `serializer.ts:11-13` — if M7 is fixed by returning the object,
  `serializeResponse` has no callers; delete it or keep it deliberately.

## Verdict

**Block.**

- B1 breaks an explicit product path deterministically: no transfer at or above
  `1_000_000n` minor units can ever complete. No concurrency, no flakiness — it
  fails on the first such transfer in production.
- B2 can destroy money on an ordinary concurrent credit or a mid-sweep crash, and
  the sweep can double-apply under overlapping runs.
- M1, M4 and M5 each convert normal production traffic — opposite-direction pairs,
  a slow provider, a client retry — into errors, and M2 adds a process-crash path
  on provider failure. M3 and M6 convert errors and busy months into resource
  exhaustion. None of these is reachable from a happy-path suite, which is exactly
  why the suite passing today is context, not evidence.

Re-review gate: B1, B2, M1-M5 fixed, with tests that actually reproduce the
concurrent/error shape (opposite-direction pair, injected provider failure,
duplicate in-flight idempotency key, error during `exportLedger`). M6, M7, m1 and
m2 may ship as scheduled fast-follows.
