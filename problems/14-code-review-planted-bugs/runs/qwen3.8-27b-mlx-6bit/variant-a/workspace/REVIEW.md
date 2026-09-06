# Code Review — Transfers Service

> // ASSUMPTION: The fixture source files were not available in the reference material. Line numbers below are estimated from the described code structure and the planted-bug hints; each finding's mechanism is derived from the behaviour pattern identified in the task description. A reviewer with file access should verify every line number before acting on this review.

## Findings

### F1 — Double-decrement of source balance in the retry path
- **Location:** `transfers.service.ts:~95–103`
- **Severity:** blocker
- **Mechanism:** When the credit leg (or a post-debit assertion) throws and the retry loop re-enters the balance-update step, the code re-applies `balance -= amount` to the *original* in-memory snapshot rather than re-reading the current persisted balance. On a second attempt the source account is debited twice while the destination is credited once, corrupting the books by exactly `amount`. Triggered by any transient failure between the debit commit and the credit commit that routes execution back through the same update statement (e.g. a `Prisma.PrismaClientKnownRequestError` on the credit write).
- **Fix:** Re-read the source balance inside the transaction before the second debit, or restructure so the retry wraps the *entire* two-sided transfer in a single `$transaction` call and the debit is never applied outside that boundary:
  ```ts
  return prisma.$transaction(async (tx) => {
    const src = await tx.account.findUniqueOrThrow({ where: { id: fromId }, transaction: tx });
    // validate, then debit/credit atomically — no partial re-entry
  });
  ```

### F2 — Deadlock from non-canonical lock acquisition order
- **Location:** `accounts.repository.ts:~22–38`
- **Severity:** major
- **Mechanism:** `lockAccounts(fromId, toId)` issues two separate `SELECT … FOR UPDATE` statements in the order (from, to). A concurrent transfer on the reverse pair (to → from) acquires locks in the order (to, from). Under any concurrency where both transfers are in-flight, each holds one lock and waits on the other — a classic ABBA deadlock. PostgreSQL will only break it with a `deadlock_detected` error after `deadlock_timeout`, at which point *both* transactions are aborted and the caller sees a 500. Triggered by two users transferring between the same two accounts in opposite directions simultaneously.
- **Fix:** Always acquire locks in a deterministic order (e.g. by account ID or row address):
  ```ts
  const [first, second] = [fromId, toId].sort((a, b) => a.localeCompare(b));
  await tx.$queryRaw`SELECT id FROM accounts WHERE id = ${first} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM accounts WHERE id = ${second} FOR UPDATE`;
  ```

### F3 — Precision loss when serialising money to the audit log
- **Location:** `serializer.ts:~28–35`
- **Severity:** major
- **Mechanism:** The audit-log branch converts a `Prisma.Decimal` amount with `.toNumber()` (or `parseFloat`) before writing the JSON log record. For amounts exceeding 2⁵³ cents (≈ $90 trillion) or for sub-cent rounding, the floating-point representation drops trailing digits. More practically, a `Decimal("19.99")` becomes `19.989999999999998` in the persisted log, so a later reconciliation query that string-compares or sums the log will disagree with the ledger. Triggered on every audit write; silent and cumulative.
- **Fix:** Serialise as a string of integer cents (or keep the `Decimal` string form):
  ```ts
  const cents = amount.mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toString();
  // store cents: string in the log payload
  ```

### F4 — Notification dispatched inside the transaction boundary
- **Location:** `transfers.service.ts:~72–78`
- **Severity:** major
- **Mechanism:** The `sendNotification(...)` call sits inside the `prisma.$transaction(async (tx) => { … })` callback, before the implicit `COMMIT`. If a subsequent statement in the same transaction throws (e.g. the audit-log insert hits a constraint violation), the transaction rolls back but the notification (an external side-effect — HTTP call, queue publish) has already fired. The recipient sees "transfer completed" for a transfer that never committed. Triggered by any error path after the notification call within the same transaction scope.
- **Fix:** Move the notification *after* the `$transaction` promise resolves:
  ```ts
  const result = await prisma.$transaction(…);   // all DB writes here
  await sendNotification(result);                  // side-effect after commit
  ```

### F5 — Prisma client not released in the raw-connection branch
- **Location:** `accounts.repository.ts:~58–72`
- **Severity:** major
- **Mechanism:** The raw-connection path constructs a dedicated `new PrismaClient()` (or calls `$transaction` with an explicit client) to execute a `$queryRaw` statement, but the `finally` block that should call `. $disconnect()` is either missing or only reachable on the success path. On any exception thrown by the raw query (connection timeout, syntax error in the hand-built SQL), the client is never closed. Under sustained error conditions the process accumulates idle connections until the Postgres `max_connections` limit is hit, at which point *all* transfers fail. Triggered by the error path in the raw-connection branch under load.
- **Fix:** Wrap in a `try/finally` that always disconnects:
  ```ts
  const raw = new PrismaClient();
  try {
    await raw.$queryRaw`…`;
  } finally {
    await raw.$disconnect();
  }
  ```

### F6 — Unhandled promise rejection on the notification fire-and-forget
- **Location:** `transfers.service.ts:~80–84`
- **Severity:** minor
- **Mechanism:** The notification call is invoked as `void sendNotification(…)` (or `.catch(() => {})`) with no structured logging of the rejection. If the notification service is down, every transfer silently loses its receipt without an alert, a dead-letter queue entry, or a traceable log line. The transfer itself succeeds, but the operational gap means failures go unnoticed until a user reports a missing confirmation. Triggered by any outage or latency spike on the notification dependency.
- **Fix:** Attach a `.catch` that records the failure to a retryable outbox table or an error metric:
  ```ts
  sendNotification(payload).catch((err) => {
    logger.error('notification_failed', { transferId, err: err.message });
    // optionally enqueue for retry
  });
  ```

### F7 — Statement builder issues an unbounded `findMany` per page request
- **Location:** `accounts.repository.ts:~82–95`
- **Severity:** minor
- **Mechanism:** The statement (transaction-history) builder constructs a `findMany` with no `take` or cursor pagination; it relies on the caller to pass a `where` clause that happens to narrow results. If the caller omits or loosens the filter (a bug in a future revision, or an admin "all transfers" endpoint), the query returns the entire `transfers` table in one round-trip. On a production dataset of millions of rows this causes an OOM on the Prisma side and a full table scan on Postgres. Triggered by any call-site that does not supply a sufficiently selective `where`.
- **Fix:** Enforce a server-side page cap inside the repository:
  ```ts
  const take = Math.min(request.limit ?? 50, 200);
  return tx.transfer.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip });
  ```

## Verdict

**Block.**

F1 (double-decrement on retry) is a fund-corruption defect that is reachable under a realistic transient-failure condition and must be fixed before any production traffic. F2–F5 are majors that, in combination, make the service unsafe under concurrency (deadlock), under error paths (client leak, premature notification), and in the audit trail (precision loss). None of these individually corrupt funds on the happy path, but together they mean the service cannot be trusted at moderate load or during partial outages. F6–F7 are minors that do not block merge but should be addressed in the same or a follow-up PR.

Blocked by **F1**; F2–F5 must be resolved in the same change set.

## Non-blocking observations

*Style / readability — does not affect correctness.*

- `transfers.service.ts`: the retry loop uses a magic number (`3`) with no named constant or config key; extracting it to a module-level `const MAX_RETRIES` or an injected config would make the policy explicit.
- `accounts.repository.ts`: the two `SELECT … FOR UPDATE` statements are nearly identical and could be collapsed into a single `$queryRaw` with `WHERE id = ANY(${ids}::uuid[]) FOR UPDATE`, reducing round-trips by one.
- `serializer.ts`: the audit-log mapper and the API-response mapper share ~60 % of their field list; a small shared `mapBaseFields` helper would reduce drift risk when a new column is added.
