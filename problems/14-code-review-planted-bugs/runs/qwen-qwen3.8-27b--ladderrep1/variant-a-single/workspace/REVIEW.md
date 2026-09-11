# Code Review — Transfers Service

Issue #488 · Scope: `transfers.service.ts`, `accounts.repository.ts`, `serializer.ts`

Method: traced the concurrency, error, and slow-provider paths line by line instead of
pattern-matching. Every finding below is defensible from the cited lines; line numbers
refer to the files as shipped. `serializer.ts` is clean (see "Traced and not flagged").

## Findings, ranked by severity

Order within a severity band is blast radius × certainty.

### 1. [blocker] Every transfer at/above the large-transfer threshold crashes in audit serialization
`transfers.service.ts:78-82` (gate at line 74, threshold at line 9)

**Mechanism.** `amount` is a `bigint` (line 23) and is passed verbatim to a bare
`JSON.stringify` at line 80. `JSON.stringify` throws `TypeError: Do not know how to
serialize a BigInt` on BigInt values — no replacer is passed here, whereas the response
path (`serializer.ts:4-13`) has `moneyReplacer` for exactly this case.

**Conditions.** Deterministic: any transfer with `amount >= 1_000_000n` minor units.
The TypeError is raised inside the `$transaction` callback, so Prisma aborts the
transaction: no balance change, no transfer row, no ledger entries — and the request
500s. 100% of transfers at/above the threshold fail. The happy-path suite cannot see
this because it stays below the threshold and because the response serializer works.

**Fix.** One line:

    payload: JSON.stringify({
      transferId: transfer.id,
      amount: amount.toString(),   // or: JSON.stringify({ ... }, moneyReplacer)
      riskScore: risk.score,
    }),

### 2. [blocker] Retry sweep is not atomic: double debit on partial failure, lost update under concurrency
`transfers.service.ts:101-119`

**Mechanism A (money destroyed).** The source debit (107-110), destination credit
(111-114), and status flip (115-118) are three independent auto-commit statements, and
the status flip is the only completion marker. If the process dies — or the third
statement errors — after the first two committed, the transfer is still
`FAILED_TRANSIENT`, and the next nightly sweep debits the sender and credits the
destination a second time for the same transfer.

**Conditions.** Any crash or error in the window between the debit commit (line 110)
and the status commit (line 118) — two more round trips, on a job that runs against
live balances.

**Mechanism B (lost update).** The debit writes an absolute value, `from.balance -
t.amount` (line 109), computed from an unlocked read (line 102). The main path uses
atomic `decrement` (line 50) for exactly this reason. If a live `transfer()` debits or
credits the same account between the read and the write, the retry's stale absolute
write clobbers the concurrent change: retry reads 1000, a live transfer commits -100
(→ 900), retry writes 950 — the 100 is gone.

**Conditions.** A retried transfer and a live transfer touching the same sender
account in the same sweep window — which is by construction, a nightly sweep running
while the service is live.

**Fix.** One transaction per retry, so a crash rolls everything back and a re-run is
safe; locks plus atomic arithmetic kill the lost update:

    await this.prisma.$transaction(async (tx) => {
      const from = await this.accounts.lockAccount(tx, t.fromAccountId);
      const to   = await this.accounts.lockAccount(tx, t.toAccountId); // canonical order, finding 3
      if (from.balance < t.amount) return; // still insolvent: next sweep (finding 11)
      await tx.account.update({ where: { id: from.id }, data: { balance: { decrement: t.amount } } });
      await tx.account.update({ where: { id: to.id },   data: { balance: { increment:  t.amount } } });
      await tx.ledgerEntry.createMany({ data: [
        { transferId: t.id, accountId: from.id, delta: -t.amount },
        { transferId: t.id, accountId: to.id,   delta:  t.amount },
      ]}); // finding 6
      await tx.transfer.update({ where: { id: t.id }, data: { status: 'COMPLETED' } });
    });

### 3. [blocker] Deadlock: account row locks acquired in (from, to) order
`transfers.service.ts:32-33` (via `FOR UPDATE` in `accounts.repository.ts:24-29`)

**Mechanism.** `transfer` always locks the sender first, then the receiver. Two
opposite transfers between the same pair — T1: A→B, T2: B→A — arriving in the same
lock window: T1 holds A and waits for B; T2 holds B and waits for A. Postgres'
deadlock detector fires after `deadlock_timeout` (default 1 s) and aborts one
transaction with a deadlock error; that request 500s.

**Conditions.** Any two concurrent opposite-direction transfers between the same pair
of accounts — two users paying each other, or a correction flow running against live
traffic. It recurs on every overlap, and other waiters queue behind the pair. The
window is widened by the in-transaction risk call (finding 5), which holds both locks
for the duration of an external HTTP call.

**Fix.** Acquire both row locks in a stable total order:

    const [firstId, secondId] = [fromAccountId, toAccountId].sort();
    const first  = await this.accounts.lockAccount(tx, firstId);
    const second = await this.accounts.lockAccount(tx, secondId);
    const from = firstId === fromAccountId ? first : second;
    const to   = firstId === fromAccountId ? second : first;

Two ordered statements guarantee the order; a single `SELECT ... WHERE id IN (...)
ORDER BY id FOR UPDATE` does not guarantee lock-acquisition order.

### 4. [major] Receipt notification is a floating promise
`transfers.service.ts:90`

**Mechanism.** `this.notifications.sendTransferReceipt(result.id);` is not awaited.
If it rejects, the rejection is unhandled. Node 20's default `unhandledRejections`
mode is `throw` — the process crashes. The transfer already committed (lines 28-88),
so no money is lost, but a notification-provider hiccup takes down the API process.
Under a non-fatal `unhandledRejections` setting, the receipt is silently lost: no
log, no retry, no dead-letter.

**Conditions.** Any `sendTransferReceipt` rejection while a transfer is committing —
any provider outage or slow response, on any traffic.

**Fix.**

    try {
      await this.notifications.sendTransferReceipt(result.id);
    } catch (err) {
      // enqueue for retry + alert. The transfer is already committed;
      // a receipt failure must not fail the request or crash the process.
    }

(Or enqueue a receipt job after commit — either way, handle the promise.)

### 5. [major] Risk check runs inside the transaction while holding two row locks
`transfers.service.ts:39-43` (locks taken at 32-33)

**Mechanism.** `this.risk.evaluate` — an external call — is awaited while the
transaction holds `FOR UPDATE` locks on both accounts. Lock hold time becomes the risk
provider's latency, including its timeout budget. Every other transfer touching either
account queues behind the wait; a slow or down provider stalls all transfers that
reach this point with growing lock-wait queues, and it multiplies the deadlock window
of finding 3. A non-BLOCK error from `evaluate` also aborts the transaction — the
right outcome, but only after the provider's full timeout.

**Note.** The call depends on nothing the transaction provides: its inputs (lines
40-42) are the request arguments (`from.id`/`to.id` are `fromAccountId`/`toAccountId`).

**Fix.** Move it before the transaction, right after the amount guard:

    const risk = await this.risk.evaluate({
      from: fromAccountId,
      to: toAccountId,
      amount: amount.toString(),
    });
    if (risk.decision === 'BLOCK') {
      throw new BadRequestException('transfer blocked by risk policy');
    }

### 6. [major] Retry path never writes the ledger pair
`transfers.service.ts:101-119`, cf. 67-72 and 131-140

**Mechanism.** `buildStatement` computes per-transfer deltas exclusively from
`ledgerEntry` rows (131-140), and the main path writes the debit/credit pair in the
same transaction as the transfer row (67-72). The retry path moves balances and flips
status (107-118) but creates no `ledgerEntry` rows (and no audit line for a
threshold-crossing retry, cf. 74-85). Any transfer that reaches `COMPLETED` via the
sweep therefore moves balances with no ledger trace: the statement shows `delta: 0n`
for it, and the ledger sum diverges from account balances.

**Conditions.** Any transfer that completes through `retryFailedTransfers`. (If the
origin path that writes `FAILED_TRANSIENT` — outside these three files — already
wrote a ledger entry at failure, the sweep's re-application would double-write
instead; either way the ledger is wrong. Worth confirming against that code; the
inconsistency is within these files regardless.)

**Fix.** In the retry transaction (finding 2), write the same pair as lines 67-72,
plus the audit line when `t.amount >= LARGE_TRANSFER_THRESHOLD`.

### 7. [major] `exportLedger` leaks a pooled client on every error
`transfers.service.ts:150-158`

**Mechanism.** `client.release()` (line 158) only runs if `client.query` (line 151)
succeeds. If the query throws — statement timeout, dropped connection, server error —
the `PoolClient` is never returned. The pool is finite (default size 10); after 10
failed exports it is exhausted, and every subsequent `getRawClient()`
(`accounts.repository.ts:37-39` → `pool.connect()`) waits on the queue — pg-pool does
not time out queued connections by default — so the export endpoint hangs instead of
failing.

**Conditions.** Ten failed exports (query errors, not successes) brick the export
path for the life of the process.

**Fix.**

    const client = await this.accounts.getRawClient();
    try {
      const res = await client.query(...);
      return buildCsv(res.rows);
    } finally {
      client.release();
    }

Better: have `AccountsRepository` own the lease — e.g. `withClient(async (client) =>
...)` — so no caller can forget the release.

### 8. [major] `buildStatement` is a 2N+1 query pattern
`transfers.service.ts:129-143`

**Mechanism.** For each of the month's N transfers, the builder issues a
`ledgerEntry.findMany` (line 131) and an `account.findUnique` (line 134) — 2N+1 round
trips, fanned out with `Promise.all` (line 129) so they hit the pool concurrently. A
busy account's month (hundreds to thousands of transfers) becomes hundreds to
thousands of queries per statement: a slow endpoint and pool pressure every time a
statement is generated.

**Fix.** Two batched queries instead:

    const transferIds = transfers.map((t) => t.id);
    const [entries, accounts] = await Promise.all([
      this.prisma.ledgerEntry.findMany({ where: { transferId: { in: transferIds }, accountId } }),
      this.prisma.account.findMany({
        where: { id: { in: [...new Set(transfers.flatMap((t) => [t.fromAccountId, t.toAccountId]))] } },
      }),
    ]);
    // group entries by transferId in a Map, look up counterparties by id — no per-row queries.

### 9. [minor] Concurrent same-key replay 500s instead of replaying
`transfers.service.ts:29-30` and `57-65`

**Mechanism.** The idempotency check is `findUnique`-then-`create` inside a READ
COMMITTED transaction (the Postgres default). Two requests with the same
`idempotencyKey` in flight simultaneously — a client retry while the original has not
committed, exactly the case idempotency keys exist for — both see `existing == null`,
both proceed, and the second `create` violates the unique constraint on
`idempotencyKey` → Prisma P2002, unhandled → 500. The client gets an error for a
transfer that did commit, and the error carries no envelope `code`.

`idempotencyKey` is unique: `findUnique` on that field (line 29) type-checks, and
Prisma's generated client only accepts unique fields there — the code compiles. So the
money is safe (no double debit); this is a contract violation. Confirm the index in
the schema; if it were absent, this finding would be a blocker.

**Conditions.** Same key, two requests overlapping in time.

**Fix.** Catch the constraint violation around the `prisma.$transaction` call and
replay:

    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return this.prisma.transfer.findUniqueOrThrow({ where: { idempotencyKey } });
      }
      throw e;
    }

### 10. [minor] Missing account surfaces as a 500, not `resource_not_found`
`accounts.repository.ts:30-32`

**Mechanism.** `lockAccount` throws a generic `Error`. Inside `transfer` it is not an
`HttpException`, so it becomes a 500 with no `code` in the error envelope. A transfer
to/from a nonexistent account is a client error (404, `resource_not_found`), not a
server error; clients that treat 5xx as transient will retry a permanently bad
request.

**Fix.** Throw a typed error that maps to the envelope — e.g. `NotFoundException`
carrying `code: 'resource_not_found'` and the account id in `details` — keeping the
`FOR UPDATE` behavior.

### 11. [minor] Retry sweep: one bad row kills the batch; no terminal state for insolvent transfers
`transfers.service.ts:102-105`

**Mechanism.** (a) `findUniqueOrThrow` on the sender (line 102) — if one transfer
references a missing account, the exception escapes the `for` loop and every remaining
transfer in the batch is skipped that night. (b) The `continue` on insufficient funds
(line 105) leaves the transfer `FAILED_TRANSIENT` forever — no attempt count, no
dead-letter status — so an insolvent transfer is re-read every night indefinitely and
is indistinguishable from a transient one.

**Fix.** try/catch around the per-transfer body (log + continue), or pre-fetch the
accounts and skip missing ones; add a `retries` counter and a `FAILED_PERMANENT`
status after N sweeps.

## Traced and not flagged

- `serializer.ts` — clean. `moneyReplacer` handles the bigint case correctly; it is
  the contrast that makes finding 1 possible (same problem, handled here, not handled
  at line 80).
- `transfers.service.ts:125` — `where: { month }` requires `month` to be a real
  `Transfer` field for this to compile, and the `create` at lines 57-65 does not set
  it. How it is populated (default, trigger, denormalization elsewhere) is not visible
  from the three files in scope — not a finding without the schema; worth a one-line
  confirmation from the team.
- `transfers.service.ts:35` — insufficient-funds check after both locks is correctly
  placed (atomic under the locks).
- `transfers.service.ts:26` — the `amount <= 0n` guard before the transaction is
  correct.

## Verdict: Block

Any one of findings 1-3 is sufficient. Finding 1 is a deterministic 100% failure of
the entire large-transfer class; finding 2 can double-debit a sender across a crash
window and silently lost-update balances under concurrency; finding 3 deadlocks the
money path on any opposite-direction overlap. On top of those, the retry path writes
balances without a ledger trace (6), the notification path can crash the process (4),
the risk provider's latency is baked into lock-hold time (5), and the export path can
brick the connection pool (7).

Re-review once fixes for 1-11 land, with tests for the paths the current suite does
not have: a transfer at/above `LARGE_TRANSFER_THRESHOLD`; opposite-direction
concurrent transfers between the same pair; a retry sweep with an injected failure
between the balance writes and the status flip; a notification provider rejection; a
failing `client.query`. A happy-path suite is not evidence for a money service.

## Non-blocking (style)

- `transfers.service.ts:148-157` — docstring says "streamed via the raw pg client";
  the implementation is an in-memory `SELECT *`. Either stream (cursor, or `COPY TO
  STDOUT` to a response stream) or fix the comment; `SELECT *` also pulls unused
  columns.
- `transfers.service.ts:92` — the service returns a pre-serialized string
  (`serializeResponse`). The serializer's header comment (`serializer.ts:2`) says the
  interceptor owns the API response path; returning the entity and letting the
  interceptor apply `moneyReplacer` keeps serialization in one layer.
- `transfers.service.ts:36, 45` — `BadRequestException` for "insufficient funds" /
  "blocked by risk policy" reads as a domain rejection (409/422) rather than a client
  syntax error; judgment call, note it for the API contract.
