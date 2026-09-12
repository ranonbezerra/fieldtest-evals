# Code review — transfers service

Scope: `transfers.service.ts`, `accounts.repository.ts`, `serializer.ts` (NestJS/Prisma, payments). Findings only; no source changed.

Severity scale: **blocker** = ships wrong money, wrong data, or a dead process; **major** = fails or degrades badly under a real production condition; **minor** = edge/cosmetic.

## Summary

| # | Severity | Location | One-liner |
|---|----------|----------|-----------|
| 1 | blocker | transfers.service.ts:78 | `JSON.stringify` on a `bigint` — every transfer at/above threshold 500s and rolls back |
| 2 | blocker | transfers.service.ts:102-118 | Retry sweep: lockless read, absolute balance write, no transaction — silent double-debit / lost update |
| 3 | blocker | transfers.service.ts:90 | Notification promise neither awaited nor caught — provider failure crashes the process |
| 4 | major | transfers.service.ts:32-33 | Row locks taken in (from, to) order — opposite-direction pairs deadlock |
| 5 | major | transfers.service.ts:39 | External risk call awaited inside the transaction while holding both row locks |
| 6 | major | transfers.service.ts:150-158 | Raw pool client released only on the happy path — errors leak connections |
| 7 | major | transfers.service.ts:29-30 | Idempotency check runs before the locks — in-flight replay → unique violation → 500 |
| 8 | major | transfers.service.ts:107-118 | Retry path never writes the ledger pair (or the audit row) — reconciliation drift |
| 9 | major | transfers.service.ts:129-143 | Statement builder: N+1 with unbounded concurrency — busy account saturates the pool |

## Findings

### 1. blocker — transfers.service.ts:78 — `JSON.stringify` on a `bigint` in the audit-log branch

**Mechanism.** `amount` is a `bigint` (parameter, line 23). When `amount >= LARGE_TRANSFER_THRESHOLD` (line 74), line 78 builds the audit payload with a bare `JSON.stringify` and no replacer, with `amount` (line 80) as an own property of the stringified object. `JSON.stringify` throws `TypeError: Do not know how to serialize a BigInt` in exactly that situation; the replacer is only consulted when one is passed, and none is. The throw happens while constructing the argument to `tx.auditLog.create`, i.e. inside the `$transaction` callback (line 28): the entire transfer — balance moves, transfer row, ledger pair — rolls back, and the request surfaces as a 500 (an unhandled `TypeError`, not an `HttpException`). The API response path is safe precisely because `serializeResponse` wires `moneyReplacer` (serializer.ts:12); this branch bypasses it.

**Conditions.** Deterministic. Every transfer with `amount >= 1_000_000n` minor units fails; no concurrency, no error path involved. The suite passes only if its amounts sit below the threshold (e.g. at 2-decimal minor units, every transfer of $10,000.00 or more is affected).

**Fix.** Serialize the amount as a string, or reuse the existing replacer:

    payload: JSON.stringify({
      transferId: transfer.id,
      amount: amount.toString(),
      riskScore: risk.score,
    }),

### 2. blocker — transfers.service.ts:102-118 — retry sweep is an unguarded, non-atomic read-modify-write

**Mechanism.** Each failed transfer is "replayed" with three separate auto-committed statements and no row locks. Line 102 reads `from.balance` without a lock; line 109 writes an **absolute** value `from.balance - t.amount` (the credit at line 113 is a relative `increment`; the debit is the racy half). Two distinct failure shapes, both silent:

- **Lost update.** Any committed change to the same account between lines 102 and 109 — a concurrent `transfer()` debiting that account, or a second overlapping sweep — is overwritten by the stale snapshot. The balance ends up too high by exactly the overwritten delta, and later transfers can be funded against money that is not there.
- **Double debit on a mid-sequence failure.** The debit (line 107) commits on its own. If the process or the DB fails before lines 111/115 run, the row is still `FAILED_TRANSIENT` with the debit already applied; the next sweep re-reads the (already debited) balance, passes the sufficiency check, and debits **again**. `from` loses 2×, `to` gains 1×.
- Secondary: a `findUniqueOrThrow` (line 102) on a deleted account throws and aborts the whole loop — the rest of the night's retries are skipped and the job errors.

**Conditions.** The sweep runs nightly against accounts that keep moving money, so the read→write window overlaps live traffic routinely; the double-debit shape is triggered by exactly the transient DB failure the sweep exists to recover from.

**Fix.** One `$transaction` per retried transfer that: (a) locks both account rows with `lockAccount` in the canonical order from finding 4; (b) uses `{ decrement: t.amount }` / `{ increment: t.amount }` instead of an absolute write; (c) claims the row atomically before mutating — e.g. `UPDATE "Transfer" SET status = 'RETRYING' WHERE id = $1 AND status = 'FAILED_TRANSIENT'`, skip if `count === 0` — so two overlapping runs cannot both act on the same row; (d) writes the ledger pair and the audit row (finding 8).

### 3. blocker — transfers.service.ts:90 — notification promise neither awaited nor caught

**Mechanism.** `this.notifications.sendTransferReceipt(result.id);` discards the promise. If the provider rejects (timeout, 5xx, queue down), the rejection is unhandled; Node 20's default `--unhandled-rejections=throw` escalates it to a top-level throw and **crashes the process**. The crash takes every in-flight transfer down with it (their transactions roll back — no corruption — but in-flight work is lost, and a supervisor restart loop can amplify one provider blip into an outage). Second-order: the receipt is fire-and-forget, so the client's 200 goes out before the receipt is sent. That may be intended, but the unguarded intent is the crash above.

**Conditions.** Any notification-provider failure after a successful commit — the money moved, and the process dies.

**Fix.**

    try {
      await this.notifications.sendTransferReceipt(result.id);
    } catch (err) {
      this.logger.error(`receipt failed for transfer ${result.id}`, err);
    }

A failed receipt must not 500 an already-committed transfer. If the receipt is business-critical, enqueue it (outbox) instead of calling the provider in the request path.

### 4. major — transfers.service.ts:32-33 — lock order depends on direction; opposite-direction pairs deadlock

**Mechanism.** Locks are taken in (from, to) order. A transfer A→B holds `FOR UPDATE` on A and waits for B; a concurrent B→A holds B and waits for A — a cycle. Postgres's deadlock detector aborts one of the two with `40P01`; that transfer 500s and rolls back (no corruption, but a guaranteed failure of one of the pair).

**Conditions.** Two transfers between the same pair of accounts in opposite directions whose transactions overlap — e.g. a payout and a refund to the same counterparty in the same batch. Not a rare race: it is guaranteed whenever the two land in the same lock window, and the window is stretched by finding 5.

**Fix.** Take the locks in a canonical (e.g. sorted) order, then map back:

    const [firstId, secondId] = [fromAccountId, toAccountId].sort();
    const first  = await this.accounts.lockAccount(tx, firstId);
    const second = await this.accounts.lockAccount(tx, secondId);
    const from = firstId === fromAccountId ? first : second;
    const to   = firstId === fromAccountId ? second : first;

(Reject `fromAccountId === toAccountId` at the top of `transfer()`.) The retry sweep (finding 2) must use the same canonical order.

### 5. major — transfers.service.ts:39 — external risk call awaited inside the transaction, while holding both row locks

**Mechanism.** `risk.evaluate` (an external call) is awaited inside the `$transaction` (opened line 28) **after** both `FOR UPDATE` locks (lines 32-33). Lock-hold time therefore includes provider latency: with the risk provider in a slow phase (p99 in seconds), every transfer touching either account queues on the row locks, and the transaction's DB connection is held for the whole call, shrinking the pool for unrelated work. It also widens the deadlock window (finding 4) and the in-flight idempotency window (finding 7).

**Conditions.** Risk-provider degradation plus any concurrency on shared accounts — an ordinary provider incident, not a contrived shape.

**Fix.** Move the call outside and before the transaction; it needs only the two account IDs and the amount, not the locked rows:

    const risk = await this.risk.evaluate({ from: fromAccountId, to: toAccountId, amount: amount.toString() });
    if (risk.decision === 'BLOCK') throw new BadRequestException('transfer blocked by risk policy');
    const result = await this.prisma.$transaction(async (tx) => { /* unchanged body */ });

If policy can change between check and commit and that matters, re-evaluate after the locks; otherwise the pre-check is the standard shape.

### 6. major — transfers.service.ts:150-158 — pool client released only on the happy path

**Mechanism.** `client.release()` (line 158) runs only if everything above it succeeds. If `client.query` rejects (statement timeout, DB blip) or the map at line 156 throws (e.g. a row with `null "createdAt"` → `toISOString` on `null`), the client is never returned to the pool. Each error permanently leaks one connection from `this.pool` (`accounts.repository.ts:37-39`); after enough, `pool.connect()` hangs until pool timeout and every export stalls — including requests that would have succeeded.

**Conditions.** Any error inside the export path, repeated; a small pool makes it a handful of bad requests.

**Fix.**

    const client = await this.accounts.getRawClient();
    try {
      const res = await client.query(
        'SELECT "createdAt", "transferId", "delta" FROM "LedgerEntry" WHERE "accountId" = $1 ORDER BY "createdAt"',
        [accountId],
      );
      return res.rows.map((r) => `${r.createdAt.toISOString()},${r.transferId},${r.delta}`).join('\n');
    } finally {
      client.release();
    }

(Or push the lifecycle into the repository — a `withRawClient(fn)` helper — so callers cannot leak.)

### 7. major — transfers.service.ts:29-30 — idempotency check-then-act does not close the in-flight replay race

**Mechanism.** `findUnique` by `idempotencyKey` runs **before** the account locks (lines 32-33). Under READ COMMITTED, a second request with the same key performs its check before the first commits, sees nothing, then blocks on the row lock; when the first commits, the second proceeds and its `tx.transfer.create` (line 57) violates the unique constraint on `idempotencyKey` — the constraint exists, since `findUnique({ where: { idempotencyKey } })` (line 29) only compiles for a unique field — Prisma P2002 → 500 on a legitimate client retry. The "return the original" contract (line 30) holds only for serial replays. Secondary: a successful replay re-sends the receipt (line 90).

**Conditions.** A client retries while the first attempt is still in flight — which finding 5 makes likely, because a slow risk provider is exactly what lengthens the in-flight window.

**Fix.** Re-check after the locks (the lock makes the check authoritative) and/or absorb the violation:

    try {
      const transfer = await tx.transfer.create({ data: { /* as now */ } });
      /* as now */
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return tx.transfer.findUniqueOrThrow({ where: { idempotencyKey } });
      }
      throw e;
    }

### 8. major — transfers.service.ts:107-118 — retry path never writes the ledger pair (or the audit row)

**Mechanism.** `transfer()` writes a `ledgerEntry` pair (lines 67-72) and, for large amounts, an `auditLog` row (lines 74-85). The retry path writes only the two balance updates and the status (lines 107-118). A transfer completed via the sweep therefore has balances that do not reconcile to its ledger: `SUM(LedgerEntry.delta)` per account diverges from `Account.balance` by exactly the retried amounts, and `buildStatement` (line 140) renders that transfer's row with `delta: 0n` — a silent, plausible-looking wrong row on a real statement.

**Conditions.** Any transfer retried from `FAILED_TRANSIENT`.

**Fix.** Inside the same transaction as finding 2's rewrite, mirror lines 67-85 for `t.id`: `createMany` the two ledger entries, and `auditLog.create` when `t.amount >= LARGE_TRANSFER_THRESHOLD`. Define the audit payload once and share it between the two paths.

### 9. major — transfers.service.ts:129-143 — statement builder: N+1 with unbounded concurrency

**Mechanism.** One `findMany` for the month's transfers (line 124), then `Promise.all` over **all** of them (line 129), each firing two more queries (lines 131, 134) — `2N+1` queries with no concurrency bound, all issued at once. A busy account (a merchant with 5,000 transfers in a month) issues 10,000 concurrent queries against a finite connection pool: the statement request hangs or times out, and the pool starvation hits unrelated traffic in the same service.

**Conditions.** A statement for an account with a large transfer count in the month; concurrent DB traffic lowers the threshold.

**Fix.** Two queries, joined in memory:

    const ids = transfers.map((t) => t.id);
    const entries = await this.prisma.ledgerEntry.findMany({
      where: { transferId: { in: ids }, accountId },
    });
    const cpIds = [...new Set(transfers.map(
      (t) => (t.fromAccountId === accountId ? t.toAccountId : t.fromAccountId),
    ))];
    const counterparties = await this.prisma.account.findMany({ where: { id: { in: cpIds } } });

Group `entries` by `transferId` and map `counterparties` by `id` when assembling the rows.

## Checked, no finding

- `serializer.ts` — `moneyReplacer` handles nested `bigint` correctly (the replacer is applied to every property, recursively) and is the wired API path. The bug is that the audit branch does not use it (finding 1).
- `accounts.repository.ts:23-34` — `lockAccount` is a parameterized tagged-template query, `FOR UPDATE` scoped to the surrounding transaction, with an explicit throw on a missing row. Correct as written; the misuse is in the callers (findings 4, 5).
- `transfers.service.ts:48-55` — the main-path balance updates use relative `decrement`/`increment` under the row locks. Correct.
- `transfers.service.ts:151-154` — the raw SQL is parameterized (`$1`); no injection.

## Verdict

**Block.**

Three of the findings are blockers, and two of them do not need a bad day to bite:

- Finding 1 fails **every** transfer at or above the large-transfer threshold, deterministically. Production traffic above the threshold cannot complete at all; the suite cannot catch this unless it includes an amount ≥ `1_000_000n`.
- Finding 2 can silently double-debit on the very transient failure the sweep exists to recover from, and stomps on concurrent updates otherwise. Silent balance corruption is the worst class of failure a money service can have.
- Finding 3 converts a notification-provider blip into a process crash, taking the money path down because of a dependent service.

Findings 4-9 are the class of failure a happy-path suite structurally cannot see (concurrency, degraded dependencies, volume, error paths), and several compound: 4 and 5 widen each other's windows, and 2 and 8 must be fixed together, because the correct retry is one transaction that does what `transfer()` does.

Re-review once the three blockers and findings 4/5 are fixed, with tests for: a transfer at/above the threshold; concurrent opposite-direction transfers on the same pair; an in-flight idempotent replay; a rejecting notification provider; a sweep overlapping a live transfer on the same account; a statement for a high-volume account; and an export that fails mid-query. Approving this as-is ships a service that double-spends and crashes on its first bad quarter.

## Non-blocking notes (style — do not gate the review)

- `transfers.service.ts:148` — the doc comment says "streamed via the raw pg client", but `exportLedger` materializes all rows (`res.rows` + `join`). Either the comment is wrong or the streaming implementation is missing.
- `transfers.service.ts:152` — `SELECT *` fetches every column but only three are used; enumerate the columns so a schema change cannot silently bloat the export (the sketch in finding 6 does this).
- `transfers.service.ts:36,45` — `BadRequestException` (400) for `insufficient funds` and risk-blocked: the request is well-formed and the rejection is state-dependent; 409/422 would be more accurate. Judgment call.
