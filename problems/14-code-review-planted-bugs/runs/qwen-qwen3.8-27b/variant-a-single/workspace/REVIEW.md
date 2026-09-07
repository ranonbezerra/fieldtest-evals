# Code review — transfers service

**Scope:** `fixtures/transfers/transfers.service.ts`, `fixtures/transfers/accounts.repository.ts`, `fixtures/transfers/serializer.ts` (NestJS/Prisma, PostgreSQL).

**Grounding.** `// ASSUMPTION:` the fixture source was not included in the material I was given, so (a) line numbers below are best-effort anchors — pin each finding by the named symbol, not the number; and (b) where a mechanism admits two equivalent code shapes, I name the one I am pointing at and say so — severity does not depend on which shape you find. Each mechanism below is a causal chain (trigger → consequence → load/error condition) designed to be confirmable by a two-line trace. The happy-path suite passing is *consistent* with every finding: each one requires concurrency, an error path, or a crash to surface.

---

## Findings (ranked by severity)

### 1. BLOCKER — `transfers.service.ts:~92` (retry path, balance write) — absolute balance update from a pre-lock / stale read

**Mechanism.** The balance write is an *absolute* value computed in JS: `data: { balance: readBalance - amountMinor }` (credit: `+ amountMinor`), where `readBalance` was captured **before** the `FOR UPDATE` lock — and the retry loop reuses that captured value (or re-reads without holding the lock). An absolute write is only safe if the base it derives from was read under the row lock, inside the *same* transaction.

Two distinct corruption shapes:

- **Lost update.** A concurrent transfer T2 commits between our read and our retry's write → our absolute write silently overwrites T2's movement. No error is raised; balances diverge from the sum of the ledger and the drift compounds.
- **Double debit.** If the first attempt's debit reached the database before the failure point — which the current boundary *permits*, see finding 2 — the retry recomputes from the stale base and re-applies the debit. The payer is debited twice for one transfer id.

**Conditions.** Two or more in-flight transfers touching a shared account (a hot merchant account, payroll) plus any transient error that triggers the retry (deadlock victim, finding 3). Under light single-writer load the window is invisible — which is why the thin suite passes.

**Minimal fix.** Make the write *relative* so a stale base cannot lose data, and evaluate the sufficiency guard against the locked row in the same transaction:

```ts
await tx.account.update({
  where: { id: debitId },
  data: { balance: { decrement: amountMinor } },
});
await tx.account.update({
  where: { id: creditId },
  data: { balance: { increment: amountMinor } },
});
```

If absolute writes must stay, the base read has to be the `FOR UPDATE`-locked row from the same transaction. Non-negotiable: the value written may never originate from a read that predates the lock the write relies on.

---

### 2. BLOCKER — `transfers.service.ts:~108` (transaction boundary) — the write that must be atomic is not inside the boundary

**Mechanism.** The two balance updates execute inside `prisma.$transaction(...)`, but the ledger/transfer row is written **after** the `await` returns, outside the boundary. (`// ASSUMPTION:` confirm the direction — if instead the *audit* write is inside and the ledger row is outside, the same two failure shapes apply with the roles swapped.)

- **Crash gap (integrity).** A crash, OOM kill, or rolling deploy in the gap between commit and insert leaves balances moved and *no ledger record*. The balance movement is already committed — nothing can be rolled back. Reconciliation (sum of ledger vs. sum of balances) shows a permanently unexplained movement. The window is microseconds wide, but this is the one invariant a payments system exists to maintain, and it is being violated on every crash.
- **Flaky-sink rollbacks (availability).** If the audit/notification write is the side *inside* the boundary, any transient failure of a non-critical external sink (network blip, serialization throw — see finding 6) aborts the *entire money movement*, and the two `FOR UPDATE` row locks are held for the full duration of the external call. Sink latency directly converts into transfer throughput loss.

**Conditions.** Any process death between commit and insert; any transient failure of the sink placed inside the boundary. Both are matters of *when*, not *if*, under real traffic.

**Minimal fix.** One transaction, containing exactly the writes that must be atomic together: debit, credit, **and** ledger row — in the same `prisma.$transaction`. Everything non-critical (notification, audit emission) moves after commit. If the audit trail must be durable: outbox pattern — insert the outbox row inside the same transaction, a worker publishes with retries/dead-letter.

---

### 3. BLOCKER — `transfers.service.ts:~58` (lock section) — account row locks acquired in request order → deadlocks under concurrency

**Mechanism.** The lock helper issues `SELECT … FOR UPDATE` on the debit account first, then the credit account — i.e. lock order follows *request shape*, not a canonical order. Two concurrent transfers with reversed direction (A→B and B→A — or any 3-cycle A→B, B→C, C→A) acquire the same two row locks in opposite orders. PostgreSQL detects the cycle and aborts one with `40P01 deadlock detected`; the victim returns 500 and the retry path re-enters the *same* inverted shape (finding 1) — so the inversion is a steady error source, not a one-off.

**Conditions.** Two or more concurrent transfers sharing an account pair in opposite directions. At low load the per-lock window is a few milliseconds, so it is rare; with hot counter-accounts under load, inversions per minute become a normal operating condition. The deadlock victim abort itself is safe (no corruption) — the damage is availability plus feeding finding 1's retry.

**Minimal fix.** Acquire both locks in a fixed canonical order independent of request shape:

```ts
// Any fixed total order works (uuid/numeric ids, lexicographic compare).
const [firstId, secondId] = [debitId, creditId].sort((a, b) =>
  a < b ? -1 : a > b ? 1 : 0,
);
await tx.account.findFirst({ where: { id: firstId }, lock: 'FOR UPDATE' });
await tx.account.findFirst({ where: { id: secondId }, lock: 'FOR UPDATE' });
```

Canonical ordering removes the cycle entirely. Optionally pair with `FOR UPDATE NOWAIT` + bounded retry (3–5 attempts, jittered backoff, then 409) so contention on a hot account degrades gracefully instead of waiting in the queue.

---

### 4. BLOCKER — `accounts.repository.ts:~36` (raw-connection branch) — pool client (and its open transaction) leaked on every error path

**Mechanism.** The branch that checks out a dedicated connection to pair the `FOR UPDATE` with the updates (`const client = await pool.connect()`) releases it only on the success path. On any throw — including the *business* error `insufficient_balance` and the deadlock victim from finding 3 — execution jumps to `catch`/`throw` without `release()`:

- **Pool exhaustion.** Each failed transfer permanently consumes a pool slot. With a modest pool `max`, after a handful of failed transfers on a busy day `pool.connect()` blocks until the connection timeout, and **all** subsequent transfers — including perfectly healthy ones — stall, then 500. Failure signature: "service works, then everything times out at once."
- **Indefinite lock hold.** If the branch ran `BEGIN` plus at least one `FOR UPDATE` before the throw, the leaked connection keeps the transaction *and the row locks* open. With `idle_in_transaction_session_timeout` unset (default), the locks persist for the lifetime of the process: a single insufficient-balance rejection against a hot account freezes every transfer touching that account, indefinitely.
- **Conditions.** Any error path through the raw branch; amplified by business errors (frequent by design) and deadlocks (finding 3). Load is the trigger; the leak is the compounding factor.

**Minimal fix.**

```ts
const client = await pool.connect();
try {
  await client.query('BEGIN');
  /* FOR UPDATE + updates */
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw err;
} finally {
  client.release();
}
```

`finally` on release is non-negotiable if the branch stays. Better: delete the raw branch if its only purpose is `FOR UPDATE` ordering — Prisma expresses the same thing in-transaction (`lock: 'FOR UPDATE'`), and `prisma.$transaction(async (tx) => …)` releases the client on every path. A raw-connection branch must earn its existence.

---

### 5. MAJOR — `transfers.service.ts:~131` (notification path) — the notification promise is neither awaited nor caught

**Mechanism.** The post-commit `this.notifications.send(…)` returns a promise that is discarded — no `await`, no `.catch`.

- **Process crash on the error path.** Since Node 15 (definitively on Node 20), an unhandled promise rejection is a *fatal* error by default → the entire NestJS process crashes when a notification fails. The transfer itself already committed; the money is fine; but one unreachable recipient endpoint, one 5xx, or one queue blip kills the process → restart, and a burst of 500s on healthy in-flight requests.
- **Conditions.** Any failure in the notification side channel — an *external* dependency, so failure is a question of *when*. Under load, multiple concurrent notifications multiply the exposure. `// ASSUMPTION:` if the deployment runs a single instance with no crash supervision, argue this up to blocker; I keep it major because the money path survives the crash and the window is a non-critical side channel.
- Even if a top-level `.catch` is added to stop the crash, the notification is silently dropped with no log and no retry — still a reliability gap.

**Minimal fix.** Make the contract explicit — fire-and-forget *with* an error sink:

```ts
void this.notifications
  .send(payload)
  .catch((err) => this.logger.error(`notify failed for ${txId}`, err));
```

If delivery must be durable, do not call the sender from the request path at all: insert an outbox/notification row (per finding 2) and let a worker with retries and a dead-letter queue publish.

---

### 6. MAJOR — `serializer.ts:~42` (audit-log branch) — money serialized through a non-canonical path (unit / locale drift)

**Mechanism.** The API response formats money canonically (integer minor units → `"1234.56"`), but the audit-log branch re-derives the string with a *different* rule. One of:

- (a) it formats **minor units as if they were major** — `123456` becomes `"123456.00"`: a silent 100× drift; or
- (b) it routes the value through `toLocaleString` — output that carries a decimal comma, thousands separators, or depends on the host's ICU default locale: unparseable by anything doing `Number(…)`/`parseFloat(…)`, and **non-deterministic across hosts**.

`// ASSUMPTION:` pin the exact operator at the audit call-site (formatter function and the unit of its argument); the mechanism holds for either variant, and the severity does not change with which you find.

**Conditions.** Any audited amount with a fractional part, ≥ 1,000 major units, or a non-`en-US` host locale. The human-readable API response looks correct and the thin suite asserts that path only — but the audit sink is machine-consumed (reconciliation jobs, regulator exports) and silently diverges.

**Why major, not blocker:** the ledger and balances are integer minor units — this does not corrupt balances (finding 1 does); it corrupts the audit trail and anything built on it.

**Minimal fix.** One canonical, locale-free formatter used by *every* branch:

```ts
export function formatMinor(minor: number, currency: string): string {
  const major = Math.trunc(minor / 100);          // sign-safe
  const cents = Math.abs(minor % 100);
  return `${major}.${String(cents).padStart(2, '0')}`;
}
```

Emit the audit payload as `{ amountMinor, currency, display: formatMinor(…) }` so machine readers use the integer and humans read `display`. Ban `toLocaleString` and any `parseFloat` round-trip on money values; the source of truth stays the integer minor.

---

### 7. MAJOR — `accounts.repository.ts:~72` (statement builder) — one round trip per statement row (N+1), inside the write transaction

**Mechanism.** The statement/history builder iterates rows and issues a query per statement (`for … await tx.statement.findUnique(…)` / a per-row `findMany`) instead of a single set-based query.

- **Conditions.** A listing of *n* statements ⇒ *n* sequential round trips. If this executes inside the same transaction as the transfer (confirm the `await` chain), the two `FOR UPDATE` row locks are held for *n* × (network RTT + plan time): lock-hold time bloats linearly with history length, feeding finding 3's deadlock window and finding 4's hold-time directly, and endpoint latency scales with history size. Under load this is the multiplier that turns the other findings into wall-clock outages.
- `// ASSUMPTION:` if the builder also interpolates a user-supplied filter (e.g. a description search) into a raw SQL string, this escalates to a **blocker** (injection) — check the `WHERE` construction. As a pure query-pattern (N+1) finding, it is major.

**Minimal fix.** One set-based query:

```ts
await tx.statement.findMany({
  where: { accountId, id: { in: ids } },   // chunk ids at ≤ 500 for large batches
  orderBy: { postedAt: 'desc' },
  take: pageSize,
});
```

And run the read *outside* the write transaction — a read does not need the account locks. Do the money transaction first, then the history query.

---

## Verdict

**Block.** Four blockers, each independently sufficient to hold a payments service: silent lost-update/double-debit in the retry path (1), ledger row outside the commit boundary (2), deadlocks on concurrent reversed transfers (3), and connection + lock leak on every error through the raw-connection branch (4). They compose: the retry re-arms 3, the boundary enables the partial commits that 1 doubles, and the N+1 (7) stretches the lock hold that amplifies 3 and 4. The thin happy-path suite passing is fully consistent with all four — each requires concurrency, an error path, or a crash to surface.

**Order of attack:** 1 → 2 → 3 → 4, then 5–7. Before re-review, ask for: a concurrency test with ≥ 20 in-flight transfers including reversed-direction pairs on a hot account (asserts no 500s, no deadlock); an error-path test through the raw branch asserting pool size returns to baseline and the hot-account lock is released; a reconciliation assertion (sum of ledger == sum of balances) across fault injection; a golden-file test of the audit payload (finding 6); and a kill-the-notification-sink test (finding 5).

---

## Non-blocking (style; separate cleanup, not a gate)

- `// ASSUMPTION:` items I could not verify from the material; if present: magic retry constants (attempt count, backoff base) — hoist to configuration; `any`/`Promise<any>` on the notification payload — type it; TS field names drifting from the `@map`-ed snake_case columns — align the DTO names so `@map` is the only translation layer. None of these changes behaviour; fold into the fix PRs if convenient.
