# Code review — transfers.service.ts / accounts.repository.ts / serializer.ts

Scope: the three files in `fixtures/transfers/`. Findings only; no source changes.
Each finding has `file:line`, severity, the mechanism with exact failure conditions,
and a minimal fix. Ranked: blockers, majors, minors, verdict, non-blocking notes.

## Blockers

### F1 — BigInt passed to JSON.stringify: every transfer ≥ threshold fails, always
- **File:** transfers.service.ts:78–82 (offending property at :80)
- **Severity:** blocker
- **Mechanism:** `amount` is `bigint` (:23, :61). Line 78 calls bare
  `JSON.stringify({ transferId, amount, riskScore })` with no replacer; V8 throws
  `TypeError: Do not know how to serialize a BigInt` on any BigInt property. That is
  exactly why serializer.ts:4–9 exists — but serializer.ts:2 says the replacer is
  wired for the API response path (the interceptor), not for this call, so the audit
  branch has no protection. The throw happens inside the interactive transaction
  (:28), after the balance updates (:48–55) and the ledger write (:67–72) have run,
  so Prisma rolls all of it back and the request 500s. Condition: any transfer with
  `amount >= 1_000_000n` (:74) — deterministic, no race, no special error path:
  every large transfer fails on every attempt, nothing is persisted. The suite
  passing means it only tests sub-threshold amounts.
- **Fix:** :80 → `amount: amount.toString()`.

### F2 — Retry sweep is unclaimed and non-atomic: repeated debit of the sender
- **File:** transfers.service.ts:101–119
- **Severity:** blocker
- **Mechanism:** The sweep issues three independent autocommit statements — debit
  (:107–110), credit (:111–114), status flip (:115–118) — with no `$transaction`, no
  row lock, and no claim on the transfer; the status flip comes last. Any failure
  between debit and credit (a thrown update, a process crash, a DB disconnect)
  leaves the sender debited, the recipient uncredited, and the transfer still
  `FAILED_TRANSIENT`, so the next sweep run (:97–99) debits it again. Nothing bounds
  the repetition: each crash window is another debit, and the job is unattended
  (nightly), so the damage is found late. Overlapping runs hit the same hole with no
  crash at all: two runs read the `failed` list before either executes :115–118, and
  both debit. Secondary: the retry path writes no `ledgerEntry` pair and no audit
  line, while the normal path always pairs a COMPLETED transfer with a ledger pair
  (:67–72) — a retried transfer therefore breaks the ledger invariant whichever way
  the original attempt failed (the fixture never sets `FAILED_TRANSIENT` — only
  `COMPLETED` at :63 — so the producer is out of scope, but the retry must rebuild
  the same invariants). Tertiary: the `continue` at :105 leaves permanently
  under-funded transfers in `FAILED_TRANSIENT` forever — retried and silently
  skipped every night, no terminal state, no alert.
- **Fix:** claim the row with a compare-and-swap, then move money in one transaction
  with locks, relative deltas, and the ledger pair:

    const claimed = await this.prisma.transfer.updateMany({
      where: { id: t.id, status: 'FAILED_TRANSIENT' },
      data: { status: 'RETRYING' },
    });
    if (claimed.count === 0) continue; // another run owns it
    await this.prisma.$transaction(async (tx) => {
      const from = await this.accounts.lockAccount(tx, t.fromAccountId);
      const to = await this.accounts.lockAccount(tx, t.toAccountId);
      if (from.balance < t.amount)
        return tx.transfer.update({ where: { id: t.id }, data: { status: 'FAILED_PERMANENT' } }); // terminal status, name per your state machine
      await tx.account.update({ where: { id: from.id }, data: { balance: { decrement: t.amount } } });
      await tx.account.update({ where: { id: to.id }, data: { balance: { increment: t.amount } } });
      await tx.ledgerEntry.createMany({ data: [ /* same pair shape as :67–72 */ ] });
      await tx.transfer.update({ where: { id: t.id }, data: { status: 'COMPLETED' } });
    });

  The `updateMany` claim makes re-runs and overlaps safe; the transaction makes
  mid-flight crashes impossible to half-apply.

## Majors

### F3 — Retry writes an absolute balance from an unlocked read (lost update)
- **File:** transfers.service.ts:102–110 (write at :109)
- **Severity:** major
- **Mechanism:** `balance: from.balance - t.amount` is a read-modify-write on a hot
  row with no lock; `from` comes from a plain `findUniqueOrThrow` (:102–104) and
  this path never calls `lockAccount`. Condition: any commit that touches the same
  account's balance between :102 and :107. Trace: balance 1000; sweep reads 1000; a
  live transfer debits 100 and commits (balance 900); sweep writes 1000−50 = 950 —
  the live transfer's debit is silently undone while its recipient was credited.
  Phantom funds. The stale read also corrupts the skip decision at :105.
- **Fix:** inside a transaction, lock the row via `lockAccount` and use a relative
  delta (`decrement: t.amount`) so concurrent commits survive; the F2 sketch does
  this.

### F4 — Currency is fetched but never checked: cross-currency transfers go through
- **File:** transfers.service.ts:32–33 (field defined at accounts.repository.ts:9, selected at :25)
- **Severity:** major
- **Mechanism:** `lockAccount` selects and returns `currency` in `AccountRow`, but
  `transfer` never reads it. Condition: a book with accounts in more than one
  currency. A USD→EUR transfer debits/credits the same minor-unit integer across
  currencies, posts them to one shared ledger, and the balance check at :35 compares
  unlike units — a silent integrity break with no error anywhere.
- **Fix:** after the two locks,
  `if (from.currency !== to.currency) throw new BadRequestException('currency mismatch');`
  (ideally a dedicated `currency_mismatch` code in the error envelope).

### F5 — Lock order is (from, to): deadlock on opposite-direction concurrent transfers
- **File:** transfers.service.ts:32–33
- **Severity:** major
- **Mechanism:** Locks are always taken in request order. T1 (A→B) locks A at :32
  and waits on B at :33; T2 (B→A) locks B at :32 and waits on A at :33 — a cycle.
  Postgres deadlock detection (after `deadlock_timeout`, default 1s) aborts one with
  40P01 → 500 on exactly one of two otherwise valid transfers. Condition: two
  transfers between the same pair in opposite directions whose lock windows
  overlap. No corruption (the loser rolls back), but it is a deterministic failure
  under normal bidirectional traffic.
- **Fix:** canonical order before locking:

    const [lo, hi] = [fromAccountId, toAccountId].sort();
    const a = await this.accounts.lockAccount(tx, lo);
    const b = await this.accounts.lockAccount(tx, hi);
    const [from, to] = fromAccountId === lo ? [a, b] : [b, a];

  (One `SELECT … WHERE id IN (… ) ORDER BY id FOR UPDATE` achieves the same.)

### F6 — Network call (risk) inside the DB transaction while holding row locks
- **File:** transfers.service.ts:39–43
- **Severity:** major
- **Mechanism:** At :39 both account rows are already lock-held (:32–33).
  `risk.evaluate` is an HTTP round trip; the locks are held for its full duration.
  Condition: the provider is slow or degraded → every other transfer touching either
  account blocks on `FOR UPDATE`, and with Prisma's default 5s interactive-transaction
  timeout, provider latency + query time > 5s aborts the transaction (P2028) → 500
  on transfers that would otherwise succeed. A provider slowdown amplifies into
  queueing and timeouts across all transfers involving hot accounts.
- **Fix:** move `risk.evaluate` before the `$transaction` — it needs only
  from/to/amount, not the locked balance. If `BLOCK`, reject before taking any lock;
  the transaction then contains only local DB work.

### F7 — Un-awaited notification promise: an unhandled rejection can kill the process
- **File:** transfers.service.ts:90
- **Severity:** major
- **Mechanism:** `sendTransferReceipt` is fire-and-forget. (1) If it rejects
  (provider down, timeout), the rejection is unhandled; Node 20's default
  `--unhandled-rejections=throw` crashes the process — one bad notification provider
  takes down the API. (2) On rejection the receipt is silently lost: the transfer
  committed, the customer is never notified, nothing is logged or retried. (3) When
  the request is an idempotent replay (early return at :30), the receipt is
  re-sent — duplicate notifications on client retries. Placement after commit is
  correct; the missing await is the bug.
- **Fix:**

    try {
      await this.notifications.sendTransferReceipt(result.id);
    } catch (err) {
      // log and continue (inject Logger); the transfer is already committed
    }

  Deduplicating receipts on replay is a product decision; at minimum, log it.

### F8 — exportLedger leaks the pool connection on any error
- **File:** transfers.service.ts:150–158 (release at :158)
- **Severity:** major
- **Mechanism:** `client.release()` runs only on the success path. If
  `client.query` (:151) rejects (timeout, server error) or the mapping (:155–157)
  throws (a null `createdAt` → `.toISOString()` throws), the client is never
  returned to the pool. Each failure permanently consumes a slot; a recurring error
  exhausts the pool (default max 10) and everything else on that pool hangs until
  timeout. Additionally, the "streamed" comment (:148) is false — the full result
  set is materialized into one in-memory string, so a large account ledger is a
  memory spike as well.
- **Fix:**

    const client = await this.accounts.getRawClient();
    try {
      const res = await client.query('SELECT … WHERE "accountId" = $1 ORDER BY "createdAt"', [accountId]);
      return res.rows.map(...).join('\n');
    } finally {
      client.release();
    }

### F9 — Concurrent idempotent replays: 500 instead of an idempotent result
- **File:** transfers.service.ts:29–30 (check) and :57–65 (create)
- **Severity:** major
- **Mechanism:** `findUnique({ where: { idempotencyKey } })` at :29 proves
  `idempotencyKey` is a unique/`@@unique` field (Prisma requires it for
  `findUnique`). Condition: two concurrent requests carrying the same key — the
  canonical case is a client retrying after a timeout. Under READ COMMITTED, T2's
  :29 does not see T1's uncommitted row, so both proceed; T1's create (:57) commits;
  T2's create hits the unique constraint → Prisma P2002, unhandled → 500 for an
  operation that succeeded.
- **Fix:** catch the constraint error on create and return the committed row
  (requires importing `Prisma`):

    try {
      transfer = await tx.transfer.create({ ... });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return tx.transfer.findUniqueOrThrow({ where: { idempotencyKey } });
      }
      throw e;
    }

### F10 — Double serialization on the main response path
- **File:** transfers.service.ts:92, against serializer.ts:2
- **Severity:** major
- **Mechanism:** serializer.ts:2 states `moneyReplacer` is "wired into the
  interceptor for API responses (main path)." If that interceptor is in effect, it
  stringifies the controller return value — which :92 has already stringified — so
  the body is a JSON string containing JSON (quoted/escaped), breaking every client
  of this endpoint. If the interceptor is not actually wired, the comment is stale
  and the service is the sole serializer. Either way exactly one of the two may
  exist; as written with the stated wiring, the response contract is broken.
  (The interceptor file is not in the fixture — condition: confirm the wiring.)
- **Fix:** if the interceptor serializes, return the object (`return result;`) and
  let its replacer handle the bigint `amount`; keep `serializeResponse` only where
  no interceptor runs.

## Minors

### F11 — Statement builder: N+1 queries with unbounded parallelism
- **File:** transfers.service.ts:129–143
- **Severity:** minor
- **Mechanism:** Two queries per transfer row (:131–133, :134–136), all fired at
  once via `Promise.all` — unbounded concurrency against the pool. N transfers in
  the month → 2N+1 round trips and up to N simultaneous queries; N = 10,000 → 20k
  queries and pool pressure. A latency/capacity bug under load, not a correctness
  bug.
- **Fix:** one `transfer.findMany` with
  `include: { ledgerEntry: { where: { accountId } } }`, one
  `account.findMany({ where: { id: { in: counterparties } } })`, join in memory.

### F12 — Missing account surfaces as 500, not resource_not_found
- **File:** accounts.repository.ts:31
- **Severity:** minor
- **Mechanism:** A non-existent `accountId` throws a plain `Error`; Nest maps
  unknown errors to 500 with a generic message. The codebase convention is a single
  error envelope with snake_case codes — a missing resource should surface as
  `resource_not_found` (404). A client with a bad id cannot distinguish "my input
  is wrong" from "the service is down."
- **Fix:** `throw new NotFoundException('account not found: ' + accountId);`
  (the global filter formats the envelope).

### F13 — Self-transfers are not rejected
- **File:** transfers.service.ts:20–26 (missing guard)
- **Severity:** minor
- **Mechanism:** `transfer(A, A, amt)` is legal. Locking the same row twice is
  harmless inside one transaction, but the balance check at :35 can reject a
  net-zero move outright, and on success the path records a spurious A→A transfer
  plus a −amt/+amt ledger pair, and may trip the large-transfer audit (:74) on a
  net-zero event.
- **Fix:** at :26,
  `if (fromAccountId === toAccountId) throw new BadRequestException('from and to must differ');`

### F14 — Raw SQL executed in the service layer, with SELECT *
- **File:** transfers.service.ts:151–153 (accessor at accounts.repository.ts:37–39)
- **Severity:** minor
- **Mechanism:** The layering rule is that the repository is the only layer that
  touches the database; here the service runs a raw `pg` query directly. `SELECT *`
  (:152) also couples the CSV to every future column — a new column or type change
  breaks the mapping at :156.
- **Fix:** `AccountsRepository.exportLedgerRows(accountId)` with an explicit column
  list; the service only formats.

## Traced, no finding

- Main-path balance check uses the locked row (:32–35) and the balance updates are
  relative (:50, :54) — no check-then-act race; concurrent commits are preserved.
- Transfer row + ledger pair + audit line are one transaction (:28–88) — no partial
  state on failure.
- Notification after commit (:90) is the right boundary — only the await is missing
  (F7).

## Verdict

**BLOCK.**

1. F1 is a deterministic 100% failure of the large-transfer path
   (≥ 1,000,000 minor units): the feature is broken on every request, not flaky
   under load.
2. F2 and F3 can debit an account twice or silently undo a concurrent transfer's
   debit — real money loss in an unattended nightly job, found late.
3. F4 and F5 show the two shapes a happy-path suite cannot see — cross-currency
   books and opposite-direction concurrency / provider slowness — are both unsafe.

F1 and F2 gate the release. F3–F10 are small, local fixes and should land in the
same PR. Re-review after the fixes; add a test for each blocker before merge.

## Non-blocking style notes

- The file-header comment `// transfers.service.ts` (line 1 of the service)
  restates the filename.
- `LARGE_TRANSFER_THRESHOLD` (:9) is hardcoded; if it is an operational value
  rather than a business constant, it should come from an environment variable per
  the codebase convention.
