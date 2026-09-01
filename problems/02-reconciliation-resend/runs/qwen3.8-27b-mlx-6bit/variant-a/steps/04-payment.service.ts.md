# 04-payment.service.ts

## reply

Let me analyze the plan carefully to implement `payment.service.ts`.

Key points from the plan:

1. **Service class**: `PaymentService` with constructor:
```typescript
constructor(
  repo: PaymentRepository,
  bank: BankClient,
  opts: { publishingLagMs: number; batchSize: number; maxAttempts: number },
);
```

2. **Methods**:
   - `executePayments(): Promise<void>`
   - `reconcile(window: ReconcileWindow): Promise<ReconcileResult>`
   - `deriveTxid(orderId: string, effectiveDate: Date): string` (internal — exposed only for tests)

3. **Types**:
```typescript
type OrderStatus = 'pending' | 'sent' | 'in_doubt' | 'rejected' | 'settled' | 'parked_manual_review';

interface ReconcileWindow {
  startDate: Date;
  endDate: Date;
}

interface ReconcileResult {
  settled: number;
  provenAbsent: number;
}
```

4. **executePayments logic**:
   1. Fetch up to `batchSize` orders with status `pending`, in ascending `created_at` order.
   2. For each order:
      a. If `attempt_count >= maxAttempts` → call `markParked`. Continue.
      b. Atomically increment attempt count and set `last_attempt_at` (returns new count; if 0 rows affected, skip — another worker got it).
      c. Call `bank.send({ txid, amount_minor_units, key })`.
      d. Classify response:
         - `accepted` or `duplicate` → `markSent`.
         - `transient_error` (or a `BankTransientError` is thrown) → `markInDoubt`.
         - `permanent_rejection` (or a `BankPermanentError` is thrown) → `markRejected`.
      e. **Timeout** (request exceeds client timeout, treated the same as transient) → `markInDoubt`.

Wait, there's a subtle point here: the repository's `markSent`, `markInDoubt`, `markRejected` all use `WHERE status = 'pending'`. And `incrementAttempt` sets the status to... no wait, it doesn't change the status. Let me re-read.

`incrementAttempt`:
```sql
UPDATE orders
SET attempt_count = attempt_count + 1,
    last_attempt_at = ${lastAttemptAt},
    updated_at = NOW()
WHERE id = ${id} AND status = 'pending'
RETURNING attempt_count
```

So the status remains `pending` even after incrementing. Then `markSent` sets status to `sent` from `pending`. OK, that's consistent.

Hmm wait — but the state machine shows `pending → sent` via accepted/duplicate, and `in_doubt → pending` via proven absent, then `pending → in_doubt` on the next send failure. OK.

But wait, there's a problem with the markParked flow: plan step 2a says "If `attempt_count >= maxAttempts` → call `markParked`. Continue." So markParked uses `WHERE status = 'pending'`, which is fine.

5. **reconcile logic**:
   1. Enumerate each calendar date D from `window.startDate` through `window.endDate`.
   2. For each D:
      a. Call `bank.getStatement(D)`.
      b. Matching settlements: for each settlement in the response, call `repo.findByTxid(settlement.txid)`. If an order with status `sent` or `in_doubt` is found, call `markSettled(id, settlement.settled_at)` and `upsertSettlement(...)`.
      c. Proven-absent check: if D's statement is complete (`now > endOfDay(D) + publishingLagMs`):
         - Fetch all orders with status `in_doubt` and `effective_date = D`.
         - For each, if its `txid` is NOT in the set of txids returned by `getStatement(D)`, call `markPendingForResend(id)`.
   3. Return `{ settled, provenAbsent }` counts.

Wait — there's a subtle point in 2b: only count `settled` when the order was actually found with status sent/in_doubt. Also, what if findByTxid returns null (a settlement for a txid we don't have)? In that case... the plan says "If an order is found with status `sent` or `in_doubt`, call `markSettled(id, settlement.settled_at)` and `upsertSettlement(…)`." Hmm — is upsertSettlement only called if the order was found, or always? The wording: "If an order is found with status `sent` or `in_doubt`, call `markSettled(id, settlement.settled_at)` and `upsertSettlement(…)`." So both are conditional on finding an order with a matching status. But then settlements for unknown txids aren't cached. Hmm, alternatively we could always upsertSettlement and only conditionally markSettled. The plan literally ties both to the conditional. Let me follow it literally: if order found AND status in ['sent', 'in_doubt'] → markSettled + upsertSettlement, and increment settled count.

Hmm wait. Actually let me reconsider: "Matching settlements: for each settlement in the response, call repo.findByTxid(settlement.txid). If an order is found with status sent or in_doubt, call markSettled(id, settlement.settled_at) and upsertSettlement(…)." — Yes, both conditional.

But in that case, for the proven-absent check in 2c, the "set of txids returned by getStatement(D)" — that's simply the raw statement entries, regardless of whether we have a matching order. So we build `new Set(statements.map(s => s.txid))` from the raw statement.

Also, regarding counting: `settled` count should increment only when we actually transitioned (i.e., found an order with status sent/in_doubt). If the order was already settled, markSettled's conditional update does nothing, and we shouldn't count it. But the repository's `markSettled` uses `updateMany` and returns void — no way to know if a row was updated. Hmm.

This is a problem for counting in `reconcile`. The plan says "Return counts { settled, provenAbsent }." And for idempotency of overlapping windows: "Running reconcile twice against the same window does not double-count or corrupt state." — Does "does not double-count" mean that the second run returns 0? Or does it mean it doesn't double-count in some ledger sense? The test says "overlapping windows are idempotent: Running reconcile twice against the same window does not double-count or corrupt state."

To avoid double-counting, we should only count a settlement when the order's status before the transition was sent/in_doubt. We can check this from the `findByTxid` result: if `order.status === 'sent' || order.status === 'in_doubt'`, then call markSettled and count++. Since markSettled is a conditional update, this is safe against races — in the race case (concurrent reconcile), both might count, but that's acceptable; the "no double counting" for sequential re-runs is handled by the status check, because after the first run the order is `settled`, so the second run's findByTxid will return status 'settled' and won't count.

Similarly for provenAbsent: fetch in_doubt orders; after the first run they're `pending`, so a second run's findInDoubtByEffectiveDate won't return them. So the count is naturally idempotent.

6. **endOfDay(D)**: need to compute the end of calendar date D. D is a calendar date. In JS/TS, Date is tricky with timezones. Statement dates come from `bank.getStatement(date)`, and the effective_date column is of type `date`.

How do we enumerate calendar dates from window.startDate to window.endDate? Both are Dates. We need to step through calendar days. Simplest approach: work in UTC for consistency (since Prisma's `date` type is calendar date without timezone). Treat dates as UTC midnight and add 24 hours (86400000 ms) to step through days. End of day D = D_utc_midnight + 86400000 ms (exclusive) — or "endOfDay" as D's 23:59:59.999. For the completeness check `now > endOfDay(D) + publishingLagMs`, we can define endOfDay(D) = startOfUtcNextDay(D) - 1ms, but for a > comparison the difference between using startOfNextDay vs endOfDay-1ms doesn't matter (using startOfNextDay makes the threshold 1ms later; negligible, but let me be careful to follow the plan: `now > endOfDay(D) + PUBLISHING_LAG_MS`).

Let me define a helper:
```typescript
const startOfUtcDay = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
```

Then endOfDay(D) = startOfUtcDay(D) + 86400000 - 1. Or just use startOfNextDay for simplicity? The plan says "A statement for date D is 'complete' when `now > endOfDay(D) + PUBLISHING_LAG_MS`." Let me compute endOfDay as UTC midnight + 24h - 1ms. Actually more simply: `endOfDay = new Date(startOfUtcDay(D).getTime() + 86_399_999)`. That's D 23:59:59.999 UTC. OK.

For enumerating dates: start = startOfUtcDay(window.startDate), end = startOfUtcDay(window.endDate), and iterate d from start to end (both inclusive) in 86_400_000 steps.

Guard: if endDate < startDate, return { settled: 0, provenAbsent: 0 } (no dates). That's a defensible reading.

7. **deriveTxid**: `sha256(orderId + effectiveDate.toISOString()).hex`.

```typescript
deriveTxid(orderId: string, effectiveDate: Date): string {
  return crypto.createHash('sha256').update(orderId + effectiveDate.toISOString()).digest('hex');
}
```

Wait — the plan says `sha256(orderId + effectiveDate.toISOString()).hex`. Should we add a separator? The plan literally says `orderId + effectiveDate.toISOString()`. Follow the plan exactly. Import from 'node:crypto'.

Note: `effectiveDate.toISOString()` — for a Prisma Date (which is a JS Date from a `date` column, and Prisma returns it as... actually does Prisma return a JS Date at UTC midnight for `Date` type columns? For a `date` field, Prisma returns `string`? No — for `DateTime` it's Date, and for the `date` field type Prisma also returns a JS Date (normalized to UTC midnight)? Hmm. Actually the Prisma docs: for `date` fields, Prisma returns a JS `Date` object representing UTC midnight. Well, for our purposes in the service we just use what we're given.

8. **NestJS wiring**: The service should be `@Injectable()`. How does it get its options (publishingLagMs, batchSize, maxAttempts)? The plan says "Configuration comes from environment variables only. DATABASE_URL for Postgres." And assumption 2: "publishing lag is a named constant PUBLISHING_LAG_MS = 30 * 60 * 1000, injected via env PUBLISHING_LAG_MS."

The constructor takes `opts: { publishingLagMs: number; batchSize: number; maxAttempts: number }`. In NestJS, we could inject via `@Inject()` tokens with default values from env. But the plan's constructor signature has a third positional parameter `opts`. In NestJS DI, multiple parameters need decorators. Hmm.

Options:
- Use `@Inject('PAYMENT_OPTS')` with a provider in the module... but the plan's manifest has `payment.module.ts` "wiring providers and exports of NestJS module" — the plan doesn't specify exactly how opts are provided. The constructor signature in the plan is:
```typescript
constructor(
  repo: PaymentRepository,
  bank: BankClient,
  opts: { publishingLagMs: number; batchSize: number; maxAttempts: number },
);
```

In NestJS, the third parameter could be injected with `@Inject(PAYMENT_OPTIONS)`. But that would require the module to provide it. Alternatively, I could read env directly within the service with default values:

```typescript
constructor(
  private readonly repo: PaymentRepository,
  private readonly bank: BankClient,
) {
  this.publishingLagMs = Number(process.env.PUBLISHING_LAG_MS ?? '1800000');
  this.batchSize = Number(process.env.PAYMENT_BATCH_SIZE ?? '100');
  this.maxAttempts = Number(process.env.PAYMENT_MAX_ATTEMPTS ?? '5');
}
```

But that deviates from the constructor signature in the plan. Hmm. Which is more defensible?

The plan explicitly gives a constructor with 3 parameters including opts. The tests (per plan) will instantiate the service... The test file is `test/payment.spec.ts` and "reads: bank-client.interface, payment.service, payment.repository". The tests likely construct `new PaymentService(repo, bank, { publishingLagMs, batchSize, maxAttempts })` directly with an inline fake repo (vitest, no Nest testing module needed). If the constructor reads env, tests can't easily inject lag — unless they set process.env. The plan's constructor signature strongly suggests opts is passed in.

But for NestJS DI, a plain third parameter without a decorator would fail dependency injection (Nest can't resolve a plain object). However, the plan says "No HTTP controller is exposed; executePayments and reconcile are service methods invoked by an external scheduler." The module still wires providers. Hmm, but the plan's manifest says the module "wires providers and exports of NestJS module".

I'm only writing `payment.service.ts`. I must follow the plan's constructor signature: 3 parameters with opts. In NestJS, to make this work in DI, I'd need `@Inject(...)`. But I don't know the token the module uses (I'm not writing the module).

Most defensible reading: use `@Inject(PAYMENT_SERVICE_OPTIONS)` with an exported constant token, and let the module provide it? But that adds an export that the plan doesn't name ("Do not add exports, features, or files the plan does not name").

Hmm. Let me re-read: "Implement exactly what the plan specifies for this file. Do not add exports, features, or files the plan does not name."

The plan's section 3 lists signatures. It says `class PaymentService { constructor(repo, bank, opts); ... }`. It does not show decorators. But the conventions say services are `@Injectable()` in NestJS... The reference file (payment.repository.ts) shows `@Injectable()` and a plain constructor parameter `private readonly prisma: PrismaClient`. Wait — how does the repository get PrismaClient? There must be a provider somewhere providing `PrismaClient`... The plan doesn't show a PrismaModule. Hmm, the reference repository is given as-is; presumably app.module or payment.module provides a PrismaClient factory. That's not my file's concern.

For BankClient: who provides it? The plan doesn't specify a concrete bank client — "The concrete transport (HTTP, etc.) is outside this repository." So presumably the module provides a `BankClient` factory that reads env config. Also not my file's concern.

For opts: to keep DI functional and follow the plan's signature, I could do:

```typescript
export const PAYMENT_OPTIONS = 'PAYMENT_OPTIONS'; // not in plan...
```

That's an export the plan doesn't name. Alternatively, use `@Optional() @Inject(...)`. Hmm.

Another approach: make the third parameter optional with a default that reads env:

```typescript
constructor(
  private readonly repo: PaymentRepository,
  private readonly bank: BankClient,
  @Optional() @Inject('PAYMENT_SERVICE_OPTIONS') opts?: {...}
) 
```

Still need the Inject token string.

Hmm, actually — I could just declare `@Inject('PAYMENT_SERVICE_OPTIONS') private readonly opts: PaymentServiceOptions`? If the module doesn't provide that token, DI fails at bootstrap. Since I'm not writing the module, I can't guarantee it. But the convention "Configuration comes from environment variables only" suggests env-based config is fine.

Let me think about what's most defensible: the tests construct the service directly (vitest unit tests, no Nest container). The plan's signature: `constructor(repo, bank, opts)`. Simplest implementation that satisfies both Nest and tests:

```typescript
@Injectable()
export class PaymentService {
  private readonly publishingLagMs: number;
  private readonly batchSize: number;
  private readonly maxAttempts: number;

  constructor(
    private readonly repo: PaymentRepository,
    private readonly bank: BankClient,
    opts?: { publishingLagMs: number; batchSize: number; maxAttempts: number },
  ) { ... }
}
```

Making opts optional and falling back to env with documented defaults satisfies: tests pass opts explicitly; Nest DI resolves the constructor with (repo, bank) and the third optional parameter is... actually Nest DI: if a parameter can't be resolved, Nest throws an exception unless the parameter is marked @Optional(). An optional TypeScript parameter (`opts?`) doesn't make Nest treat it as optional — Nest still tries to resolve and fails with "Nest can't resolve dependencies". So pure Nest DI would fail at runtime. But is that my problem? The plan is the spec, and the plan says the constructor takes opts. Presumably the module (which I'm not writing) will provide it via a factory: `provide: PaymentService, useFactory: (repo, bank, config) => new PaymentService(repo, bank, {...})`. That's a common pattern, and the plan's manifest says the module "wires providers" — could be a useFactory.

Given the constraint "do not add exports... the plan does not name", I think the cleanest is to follow the plan's signature exactly: three required parameters. Actually wait — should I make them required or optional? The plan shows `opts: {...}` without `?`. Required.

Hmm but for testability... tests pass it explicitly anyway. Required matches the plan exactly. Let me go with required, exactly as planned.

Wait but let me reconsider using @Inject. The repo's reference file has no @Inject decorator — plain `constructor(private readonly prisma: PrismaClient)`. For Nest to inject PrismaClient, there must be a provider that provides the token PrismaClient (e.g., `provide: PrismaClient, useFactory: ...`). So the codebase pattern is that tokens are provided in modules. Similarly for BankClient and opts, presumably the module provides them. But a plain object type `opts: { publishingLagMs... }` is not injectable in Nest without a token. If the module uses `useFactory` to construct PaymentService directly, no decorator is needed in the service. Since I can't see the module and the plan doesn't specify DI tokens for PaymentService, I'll follow the plan's plain signature without decorators. That's exactly what the plan specifies for this file.

9. **Transaction boundaries**: The plan says: "Each per-order state transition in step 2b, and each per-order transition in step 2c is wrapped in a single short transaction (the conditional UPDATE + upsertSettlement for 2b)."

Hmm — but the repository methods are individual Prisma calls, and the repository does not expose a `transaction` helper... The plan says service calls repo methods. Wrapping 2b in a single transaction requires either a repository method that does both, or `prisma.$transaction`. But the service has "zero Prisma client calls" (per codebase conventions!). So the service cannot call $transaction. Therefore the "short transaction" is... only achievable in the repository. The repository (given) doesn't have a combined method.

Hmm, wait. Let me re-read the conventions: "The `service` holds the logic. Zero raw SQL, zero Prisma client calls." The given repository is reference; I can't modify it. So my service just calls repository methods sequentially: `markSettled` then `upsertSettlement`. The plan's transaction note is idealized; given the constraints (repository API fixed, service can't touch Prisma), sequential calls is what's implementable. Is that a problem? The order: markSettled then upsertSettlement — if it crashes between, the order is settled but the settlement row isn't cached; on re-run, we'd find the order already 'settled' (not in ['sent','in_doubt']), so we wouldn't count it or upsert. Minor inconsistency, but acceptable. Alternatively, call upsertSettlement first then markSettled — that way on re-run we would find the order in sent/in_doubt state and retry the upsert (no-op) and markSettled. Hmm, which order is better?

Plan 2b: "call markSettled(id, settlement.settled_at) and upsertSettlement(…)" — lists markSettled first. Follow the plan's order.

Actually wait, should I add an ASSUMPTION comment here? The instructions say to mark a point as `// ASSUMPTION:` if a symbol I need is genuinely missing from both plan and reference. Here the "single short transaction" is not a symbol; it's a behavioral detail I can't fully implement given the fixed repository API and "zero Prisma client calls" constraint. That's a defensible-reading situation. I think a short comment would be appropriate. Let me keep it minimal and accurate: I'll note that the two conditional updates are issued as separate repository calls since the service must not touch Prisma directly.

Hmm, but "Do not add exports, features, or files the plan does not name" — comments are fine. I'll include a concise one.

10. **Timeout handling**: "e. **Timeout** (request exceeds client timeout, treated the same as transient) → markInDoubt." The BankClient interface says send "may throw BankTransientError for transient failures (network, 5xx)". A timeout would manifest as an exception from the bank client — likely BankTransientError (network). What about generic errors/unknown exceptions? The plan classifies only: accepted, duplicate, transient_error, permanent_rejection, plus thrown BankTransientError/BankPermanentError. Unknown thrown errors — what to do? The plan doesn't specify. Defensible reading: treat unknown send failures as in_doubt (safe: never double-pay; reconciliation decides). Hmm, but "permanently rejected" vs unknown... Safest is in_doubt (don't mark as rejected, don't count against... no wait, attempt_count was already incremented).

Let me think: what does "timeout" mean in this design? If the bank client has its own HTTP timeout, a timeout throws BankTransientError (network). So catch:
- BankTransientError → in_doubt
- BankPermanentError → rejected
- Response status 'transient_error' → in_doubt
- Response status 'permanent_rejection' → rejected
- Any other error → ???

For robustness and safety (the whole point of this problem is to avoid double-pay), I'll treat any other thrown error as in_doubt and mark with a comment. That's the "most defensible reading". Should I add an ASSUMPTION comment? The plan's classification (section 3 BankClient doc: "may throw BankTransientError for transient failures... or BankPermanentError for permanent rejection") implies the client only throws these two. So in the plan's world, the catch-all is unreachable. The step e of 4 says timeout → markInDoubt. So a catch that handles BankTransientError covers timeouts (assuming the client surfaces them as transient). I'll add a conservative fallback: unknown error → in_doubt, with an ASSUMPTION comment. Actually, let me reconsider — is the fallback in scope? The plan says handle the 4 response categories "each differently" + thrown errors. An extra catch-all for safety doesn't add a feature; it just prevents crashes from an unhandled state. I think it's defensible, and I'll flag with a one-line ASSUMPTION comment since the plan doesn't explicitly cover "other" errors.

Hmm, alternatively I could rethrow unknown errors. Which is more defensible? If we rethrow, executePayments aborts midway through the batch — subsequent orders in the batch are not processed, and the current order stays `pending` with an incremented attempt. Then next run, it'll be re-attempted (counting as another attempt even though the send result is unknown — that's somewhat wrong: an unknown outcome should go to in_doubt and not burn another immediate attempt). Actually if we rethrow, the order remains `pending` with attempt_count+1; on next executePayments, we'll resend — but the send outcome is unknown! That's exactly the double-pay risk scenario: send timed out (we didn't get a response), we mark as pending, we resend with same txid — bank dedupes via txid so duplicate → accepted → sent. Actually with a deterministic txid, resending after an unknown outcome is safe (bank dedupes). But that's the "duplicate" path. Hmm, but the plan explicitly says to mark in_doubt on transient/timeout and wait for reconciliation proof before resending. The safety model: after an unknown outcome, don't resend until reconciliation proves absence (past the lag). So if we rethrow and leave it as pending, the next executePayments would resend immediately — violating "can only be resent after reconciliation has proven absence". So treating unknown errors as in_doubt is the safer and more consistent reading. Yes: catch-all → markInDoubt.

Wait, actually — hmm, there's a subtlety. Even `transient_error` response (a definitive "we did not accept" from the bank?) — if the bank says "transient_error", does that mean it definitively didn't process? Typically a transient error means "we might have" or "couldn't process, try again later". The plan explicitly puts transient_error in the same bucket as timeout: in_doubt, no resend until proven absent. OK — follow the plan.

11. **Order of operations in executePayments, per order**:

```
const orders = await this.repo.findPending(this.batchSize);
for (const order of orders) {
  if (order.attempt_count >= this.maxAttempts) {
    await this.repo.markParked(order.id);
    continue;
  }
  const newAttempt = await this.repo.incrementAttempt(order.id, now);
  if (newAttempt === 0) continue; // another worker won the race
  let outcome;
  try {
    const resp = await this.bank.send({ txid: order.txid, amount_minor_units: order.amount_minor_units, key: order.supplier_key });
    outcome = resp.status;
  } catch (err) {
    if (err instanceof BankPermanentError) outcome = 'permanent_rejection';
    else outcome = 'transient_error'; // BankTransientError, timeout, or other → in_doubt
  }
  switch (outcome) {
    case 'accepted':
    case 'duplicate': await this.repo.markSent(order.id, now); break;
    case 'transient_error': await this.repo.markInDoubt(order.id, now); break;
    case 'permanent_rejection': await this.repo.markRejected(order.id); break;
  }
}
```

Wait — check 2a: "If attempt_count >= maxAttempts → markParked. Continue." With maxAttempts = 5: attempts 1..5 are executed. On the 6th eligibility, attempt_count = 5 >= 5 → park. Test: "attempt exhaustion parks the order: 5 timeouts → parked_manual_review". Sequence: attempt 1 timeout → in_doubt (count=1). Reconcile proves absent → pending. Attempt 2... etc. After the 5th timeout, count=5, status is in_doubt. Reconcile proves absent → pending (count still 5). Next executePayments: attempt_count=5 >= 5 → park.

Also "executePayments: if attempt_count >= max, parks order | The 6th eligibility triggers parked_manual_review; no bank call is made." OK, consistent: check before incrementAttempt.

12. **Amounts**: `amount_minor_units` is bigint in the schema (bigInt in Prisma). Prisma returns `bigint` for BigInt fields. BankSendRequest.amount_minor_units is `number` per the interface. So conversion needed: `Number(order.amount_minor_units)`. Hmm — bigint to number is lossy above 2^53, but the interface says number. The plan's types show `amount_minor_units: number` in BankSendRequest, and OrderRecord also shows `amount_minor_units: number`. But Prisma's Order type (from the schema with BigInt) will be `bigint`. The repository returns `Order` (Prisma type), not `OrderRecord`. So in the service, `order.amount_minor_units` is `bigint`. To satisfy BankSendRequest (number), convert with `Number(...)`. That's fine and necessary. The plan idealized the types; the reference file is ground truth for what the repository returns. So `Number(order.amount_minor_units)` — with a comment? Not needed, it's standard.

Hmm wait, is the schema actually `BigInt`? The plan says column type `bigint`. Prisma's `BigInt` maps to Postgres bigint and returns JS `bigint`. Yes. So conversion is required. The plan's idealized OrderRecord with number is just documentation; the actual repository returns Prisma's `Order`. I'll use `Number(order.amount_minor_units)`.

13. **`last_attempt_at` timestamp**: use `new Date()` captured once per order at increment time. Increment sets last_attempt_at, and markSent/markInDoubt also set it — use the same `now` value for consistency.

14. **Return of executePayments**: plan says `Promise<void>`. OK — no return value.

15. **reconcile details**:

```typescript
async reconcile(window: ReconcileWindow): Promise<ReconcileResult> {
  let settled = 0;
  let provenAbsent = 0;

  const startDay = this.startOfUtcDay(window.startDate);
  const endDay = this.startOfUtcDay(window.endDate);
  const now = new Date();

  for (let day = startDay.getTime(); day <= endDay.getTime(); day += DAY_MS) {
    const d = new Date(day);
    const statements = await this.bank.getStatement(d);
    const statementTxids = new Set(statements.map((s) => s.txid));

    for (const entry of statements) {
      const order = await this.repo.findByTxid(entry.txid);
      if (order && (order.status === 'sent' || order.status === 'in_doubt')) {
        await this.repo.markSettled(order.id, entry.settled_at);
        // ASSUMPTION: service can't open Prisma transactions; the two repo calls run sequentially.
        await this.repo.upsertSettlement({
          txid: entry.txid,
          amount_minor_units: entry.amount_minor_units,
          settled_at: entry.settled_at,
          statement_date: d,
        });
        settled += 1;
      }
    }

    const endOfDay = new Date(day + DAY_MS - 1);
    if (now.getTime() > endOfDay.getTime() + this.publishingLagMs) {
      const inDoubt = await this.repo.findInDoubtByEffectiveDate(d);
      for (const order of inDoubt) {
        if (!statementTxids.has(order.txid)) {
          const wasPending = await this.repo.markPendingForResend(order.id); // hmm, repo returns void
          provenAbsent += 1;
        }
      }
    }
  }

  return { settled, provenAbsent };
}
```

Wait — problem: `markPendingForResend` returns void (reference repo: `Promise<void>`). So I can't check if the update actually happened. For counting, I rely on: inDoubt was fetched fresh (status in_doubt), and between fetch and mark, nobody changed it... For idempotency of sequential re-runs: first run flips in_doubt → pending; second run's findInDoubtByEffectiveDate returns nothing. So count is idempotent across runs. Within one run, each in_doubt order appears once. OK, counting by construction is sound.

But wait — a subtle race within one reconcile call: an in_doubt order for date D that appears in the statement — handled in the 2b loop (marked settled). Then 2c: findInDoubtByEffectiveDate(D) — fetched after the 2b loop, so already-settled orders are status 'settled', not returned. And even if returned (if fetched before 2b), the `statementTxids.has(order.txid)` check excludes them. Double protection.

Also 2c check: "if its txid is NOT in the set of txids returned by getStatement(D)". Note that we should only consider in_doubt orders whose effective_date = D — the repo method does that.

Hmm, one more subtlety: should proven-absent apply to `sent` orders too? No — the plan says only in_doubt. A `sent` order that never appears in statement... stays sent forever (the bank said it was accepted). Per plan.

Another subtlety: the completeness gate uses `now` captured once at start — fine.

Also: should we do the proven-absent check for dates where the statement isn't complete yet? No — gated by `now > endOfDay(D) + lag`.

16. **OrderStatus type and domain types**: The plan's section 3 defines `OrderStatus`, `ReconcileWindow`, `ReconcileResult` as types "domain types". Where should they live? The file I'm writing is payment.service.ts. The plan's manifest says: "src/payment/bank-client.interface.ts | ... | BankClient interface, BankSendRequest/Response, Settlement types" — OrderStatus/ReconcileWindow/ReconcileResult are not listed there, and payment.service.ts is "PaymentService: executePayments, reconcile, deriveTxid". So domain types belong in the service file (or at least need to be defined here to be used). ReconcileWindow/ReconcileResult are part of the service's public API (reconcile takes ReconcileWindow, returns ReconcileResult) — define and export them in the service file. OrderStatus — used internally; export or not? "Do not add exports the plan does not name" — the plan lists these types in section 3 without specifying where. ReconcileWindow and ReconcileResult must be exported (they're in the signature). OrderStatus: could keep non-exported... but the repository file uses literal strings. Hmm, actually should I use `order.status === 'sent'` literals or import the type? The Order status from Prisma will be string (or a union if the schema uses an enum — the plan says `varchar(32)` "one of", so plain string in Prisma, no enum). So comparisons with string literals are fine. I'll define OrderStatus type locally; exporting is harmless and consistent with the "domain types" section, but to minimize exports... ReconcileWindow/ReconcileResult are named in the plan as part of the type section. I think exporting all three is a defensible reading — they're "domain types" of the feature. Hmm but strictly, "do not add exports the plan does not name" — the plan names OrderStatus, ReconcileWindow, ReconcileResult in section 3. It doesn't say "export". But for types to be meaningful across files (tests importing ReconcileResult?), export is natural. Test file "reads" payment.service — tests will import PaymentService and likely ReconcileWindow/ReconcileResult for typing their fakes/results. I'll export all three. That's a defensible reading; these types are named in the plan.

17. **NestJS imports**: `@Injectable` from '@nestjs/common'. And `createHash` from 'node:crypto'.

18. **BankClient token injection**: Plain parameter `bank: BankClient` — Nest DI requires a provider with the token BankClient. Presumably the module handles it (interface used as an abstract token). Not my concern in this file.

19. **`startOfUtcDay` helper** — private method or module-level function? I'll make it a small private method, or just inline. Should I add a constant `DAY_MS = 86_400_000`? Module-level const — is that an "export"? No, a non-exported const is fine.

Wait, one more consideration for the day enumeration: what if startDate/endDate include a time component? startOfUtcDay normalizes. The inclusive range for both endpoints is per assumption 5.

Also, an empty/invalid window (endDate < startDate) → loop doesn't execute → returns zeros. Fine.

20. **`markSettled` count increment**: I only count when the order was found with status sent/in_doubt. Since Prisma's status field is a plain string (varchar), `order.status` is `string`. Comparison is fine.

21. **upsertSettlement's statement_date**: pass `d` (Date at UTC midnight) — Prisma `date` column accepts Date. Fine.

22. **Entry's amount**: upsertSettlement takes `amount_minor_units: number` (repo signature) — entry.amount_minor_units is already number per the interface. Pass through as-is.

Now — let me re-check the plan for executePayments: "fetch up to batchSize orders with status pending" — repo.findPending(limit) does that. "For each order" — sequential loop (plan says "must not be inside a transaction: ... any loop over more than one order" — so a sequential for loop with no transaction wrapper, that's correct).

Also, "executePayments must not run concurrently with itself for the same order. The repository's incrementAttempt uses an atomic UPDATE ... returning the new count; if rows affected is 0, another process won the race and this one skips." → `if (newAttemptCount === 0) continue;`

Now let me write the code.

```typescript
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  BankClient,
  BankPermanentError,
  BankSendResponse,
  BankTransientError,
} from './bank-client.interface';
import { PaymentRepository } from './payment.repository';

/** States an order can be in. Terminal: settled, rejected, parked_manual_review. */
export type OrderStatus =
  | 'pending'
  | 'sent'
  | 'in_doubt'
  | 'rejected'
  | 'settled'
  | 'parked_manual_review';

export interface ReconcileWindow {
  startDate: Date;
  endDate: Date;
}

export interface ReconcileResult {
  settled: number;
  provenAbsent: number;
}

interface PaymentServiceOptions {
  publishingLagMs: number;
  batchSize: number;
  maxAttempts: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class PaymentService {
  private readonly publishingLagMs: number;
  private readonly batchSize: number;
  private readonly maxAttempts: number;

  constructor(
    private readonly repo: PaymentRepository,
    private readonly bank: BankClient,
    opts: PaymentServiceOptions,
  ) {
    this.publishingLagMs = opts.publishingLagMs;
    this.batchSize = opts.batchSize;
    this.maxAttempts = opts.maxAttempts;
  }

  /** Derives a deterministic txid from the order and its effective date. */
  deriveTxid(orderId: string, effectiveDate: Date): string {
    return createHash('sha256')
      .update(orderId + effectiveDate.toISOString())
      .digest('hex');
  }

  /** Sends all pending orders (up to batchSize) to the bank. */
  async executePayments(): Promise<void> {
    const orders = await this.repo.findPending(this.batchSize);

    for (const order of orders) {
      if (order.attempt_count >= this.maxAttempts) {
        await this.repo.markParked(order.id);
        continue;
      }

      // Atomic claim: returns the new attempt count, or 0 if another worker
      // already took this order.
      const attempt = await this.repo.incrementAttempt(order.id, new Date());
      if (attempt === 0) {
        continue;
      }

      const sentAt = new Date();
      ...
    }
  }
}
```

Hmm wait, incrementAttempt sets last_attempt_at; markSent/markInDoubt also set last_attempt_at. Should I use one timestamp? Let me capture `const now = new Date();` once per order and pass it to both. Cleaner:

```typescript
const now = new Date();
const attempt = await this.repo.incrementAttempt(order.id, now);
if (attempt === 0) continue;

let status: BankSendResponse['status'];
try {
  status = (await this.bank.send({...})).status;
} catch (error) {
  if (error instanceof BankPermanentError) {
    status = 'permanent_rejection';
  } else {
    // BankTransientError, timeout, or any other transport failure: the outcome
    // is unknown, so treat as transient and let reconciliation decide.
    // ASSUMPTION: ...
    status = 'transient_error';
  }
}

switch (status) {
  case 'accepted':
  case 'duplicate':
    await this.repo.markSent(order.id, now);
    break;
  case 'transient_error':
    await this.repo.markInDoubt(order.id, now);
    break;
  case 'permanent_rejection':
    await this.repo.markRejected(order.id);
    break;
}
```

Wait, one question: should the attempt-exhaustion check (2a) come before incrementAttempt? Yes, per plan.

But wait — there's an edge: an order becomes pending again via proven-absent after attempt 5 (in_doubt, count=5). Next executePayments: count 5 >= max 5 → park. OK, so an order with in_doubt status and count < 5: stays in_doubt until reconcile flips it to pending; executePayments only touches pending. OK.

Now for the bank.send request: `{ txid: order.txid, amount_minor_units: Number(order.amount_minor_units), key: order.supplier_key }`.

Prisma Order fields (from schema): id, supplierKey? Wait — the repository reference uses `order.supplier_key`?? Let me check: the repository uses `findMany({ where: { status: 'pending' } })` — doesn't reveal field names. The plan's data model shows column `supplier_key` via @map. Prisma model fields: the plan's section 2 shows columns; Prisma model field names — the repository's upsertSettlement uses `amountMinorUnits`, `settledAt`, `statementDate` (camelCase) mapped to snake columns. So the Order model fields are camelCase: `supplierKey`, `amountMinorUnits`, `effectiveDate`, `txid`, `status`, `attemptCount`, `lastAttemptAt`, `settledAt`, `createdAt`, `updatedAt`.

The plan's OrderRecord interface uses snake_case, but that's idealized; the actual repo returns Prisma's `Order` with camelCase fields. The repository reference file confirms camelCase for Settlement (amountMinorUnits, settledAt, statementDate). So in the service I must use `order.supplierKey`, `order.amountMinorUnits`, `order.attemptCount`, `order.effectiveDate`, `order.txid`, `order.status`, `order.id`.

This is important — using snake_case would be a type error. So:
- `order.attemptCount`
- `order.amountMinorUnits` (bigint → Number())
- `order.supplierKey`
- `order.txid`
- `order.status`

OK.

Now the full code for reconcile:

```typescript
async reconcile(window: ReconcileWindow): Promise<ReconcileResult> {
  let settled = 0;
  let provenAbsent = 0;

  const startDayMs = this.startOfUtcDay(window.startDate).getTime();
  const endDayMs = this.startOfUtcDay(window.endDate).getTime();
  const nowMs = Date.now();

  for (let dayMs = startDayMs; dayMs <= endDayMs; dayMs += DAY_MS) {
    const day = new Date(dayMs);

    // a. Pull the statement for this calendar date.
    const statements = await this.bank.getStatement(day);
    const statementTxids = new Set(statements.map((s) => s.txid));

    // b. Match statement entries to orders and settle them.
    for (const entry of statements) {
      const order = await this.repo.findByTxid(entry.txid);
      if (!order) {
        continue; // Settlement for a txid we don't know about: nothing to advance.
      }
      if (order.status === 'sent' || order.status === 'in_doubt') {
        await this.repo.markSettled(order.id, entry.settled_at);
        await this.repo.upsertSettlement({
          txid: entry.txid,
          amount_minor_units: entry.amount_minor_units,
          settled_at: entry.settled_at,
          statement_date: day,
        });
        settled += 1;
      }
    }

    // c. Proven-absent: only once the statement is complete past the publishing lag.
    const endOfDayMs = dayMs + DAY_MS - 1;
    if (nowMs > endOfDayMs + this.publishingLagMs) {
      const inDoubt = await this.repo.findInDoubtByEffectiveDate(day);
      for (const order of inDoubt) {
        if (statementTxids.has(order.txid)) {
          continue;
        }
        await this.repo.markPendingForResend(order.id);
        provenAbsent += 1;
      }
    }
  }

  return { settled, provenAbsent };
}
```

Wait — a Prisma subtlety on `findInDoubtByEffectiveDate(day)`: the repo does `where: { status: 'in_doubt', effectiveDate: day }`. Comparing a `date` column to a Date — Prisma compares by calendar date, and the JS Date's time part is... For `DateTime` fields, Prisma compares full timestamps; for `date` fields, Prisma... hmm. When filtering a `date` column by a JS Date that includes a time part, does Prisma truncate? I believe for the `date` field type, Prisma accepts Date and compares by date part (since the column has no time). To be safe, I pass `day` which is UTC midnight — normalized. Either way it's safe.

But wait, the repository was given as reference; I'm calling it with my `day` (UTC midnight). That's the best I can do.

Also, in step b, `findByTxid` returns `Order | null` (repo: `findUnique` could return null). Handle null.

Now, the "short transaction" concern for 2b: markSettled + upsertSettlement as two calls. I'll add a concise comment noting they're separate conditional repository calls (service can't open transactions per the layering rules). Actually, is this worth an ASSUMPTION comment? The instructions: "If a symbol you need is genuinely missing from both the plan and the reference... write the file with the most defensible reading and mark with a single // ASSUMPTION comment at the point it matters." The plan explicitly says to wrap in a single transaction. I can't do that (no $transaction in service; no composite method in repo). This is a genuine gap between plan and reference. I'll add one ASSUMPTION comment at the point it matters (the 2b sequence). Let me phrase it: `// ASSUMPTION: the plan asks for one short transaction per settlement; the service layer cannot open Prisma transactions, so markSettled + upsertSettlement run as two conditional repository calls that remain safe under re-runs.`

Hmm, "one `// ASSUMPTION:` comment" — I read this as: mark such a point with an ASSUMPTION comment (one per unresolved point, concise). I'll keep at most two such comments: one for the unknown-error classification, one for the transaction boundary. Both are genuine plan-vs-reference gaps. Actually let me double-check whether the unknown-error gap is real: the BankClient interface (reference) says send "may throw BankTransientError for transient failures (network, 5xx), or BankPermanentError for permanent rejection (4xx)." Timeouts would be network-ish → presumably BankTransientError. So the only thing genuinely unresolved is: what if something else is thrown (e.g., a bug)? The plan's classification table covers exactly 4 outcomes + the two error types. The catch-all is my safety net. I'll mark with ASSUMPTION.

Also on `deriveTxid` — the plan says "internal — exposed only for tests". So it's a public method (no `private`) but not part of the "API" semantics. Public, per the plan's signature listing it under the class. OK.

Now `OrderStatus` export: let me reconsider. I'll use it... actually, do I reference OrderStatus anywhere in the code? Status checks use literals against Prisma's string. The type would be used for documentation. If I define it and don't use it, TS's `noUnusedLocals` (with strict + typical config) would flag an unused non-exported type — but if exported, no flag. So exporting avoids lint issues and matches the plan naming it as a domain type. I'll export.

Hmm, but "do not add exports the plan does not name" — OrderStatus is named in plan section 3. OK, exporting it is following the plan, not adding.

Let me also double-check `ReconcileResult` usage: return type of reconcile. Exported, named in the plan. OK.

BankSendResponse import — used as the type of `status` variable? I wrote `let status: BankSendResponse['status']`. Or import `BankSendStatus` directly — the interface file exports `BankSendStatus`. Cleaner:

```typescript
let outcome: BankSendStatus;
```

Yes, use BankSendStatus.

Now imports from './bank-client.interface': BankClient (type), BankSendStatus (type), BankPermanentError, BankTransientError (classes — but do I reference BankTransientError? In my catch, I only check `instanceof BankPermanentError`; else → transient. So I don't need to import BankTransientError unless I explicitly check it for clarity:

```typescript
catch (error) {
  if (error instanceof BankPermanentError) {
    outcome = 'permanent_rejection';
  } else {
    // BankTransientError (including timeouts) and any other failure → in_doubt
    outcome = 'transient_error';
  }
}
```

I don't need to import BankTransientError if I don't reference it. Should I explicitly check? An explicit `error instanceof BankTransientError` branch would be semantically identical to the else. The else is cleaner and safer (covers unexpected errors). I'll only import BankPermanentError and BankClient, BankSendStatus. Hmm — but is treating "any other error" as transient something the plan wants? Plan 4.e: "Timeout (request exceeds client timeout, treated the same as transient) → markInDoubt." Timeout will surface as whatever the client throws. If the client is well-behaved (per its own doc), it's BankTransientError. My else handles both that and anything else. The defensible reading, flagged.

Actually wait — let me reconsider whether I should let unknown errors propagate instead. Arguments for in_doubt (propagate vs swallow):
- Safety: leaving as `pending` after incrementing attempt is dangerous because the next executePayments would immediately resend (possibly double-pay... well, bank dedupes by txid so no double-pay, but it violates the "no resend before proof of absence" rule and burns attempt budget).
- A thrown error that escapes the per-order loop would abort the entire batch (subsequent orders not processed). Per-order isolation is more robust for a cron job.
- The plan's whole design treats "unknown outcome" as in_doubt.

I'm confident: catch-all → transient_error/in_doubt, with an ASSUMPTION comment.

One more: should I wrap the per-order body in try/catch so a repo failure on one order doesn't kill the batch? Plan doesn't say. The discipline says do exactly what the task asks — I won't add per-order error isolation beyond send classification. Keep it lean.

Also: `executePayments` — "sends pending orders" — the plan returns void, so no return value. OK.

Edge: `findPending` orders include ones with attempt_count < max only? No — findPending returns all pending; the per-order check 2a handles parking. OK, matches plan.

Now `startOfUtcDay`:

```typescript
private startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
```

Module-level or private method? Private method is fine.

DAY_MS constant: module-level `const DAY_MS = 86_400_000;` (non-exported).

Wait — one thing to verify: step c in `reconcile` fetches in_doubt orders after the settlement loop. For an in_doubt order with effective date D whose txid appears in D's statement: settled in step b → status 'settled' → not returned by findInDoubtByEffectiveDate. OK — no double handling, and the count is accurate (settled increments, not provenAbsent).

But hmm — one more subtlety: what if an in_doubt order's effective date is D but its settlement appears in a different date's statement (say, next day)? Then reconcile for D's window (statement complete) would mark it provenAbsent → pending → resend with same txid. And reconcile for D+1 finds the settlement, order is now 'pending' — markSettled requires status in ('sent','in_doubt') → no-op! The order stays pending forever?? Hmm wait — is that a real gap? Let me think about whether an in_doubt order's settlement could appear in a later date's statement.

Settlement is keyed by txid; the effective_date is the order's date. The statement for date D presumably contains settlements with settlement timestamp on date D (bank groups by settlement date). If a payment with effective date D settles at 00:10 on D+1, it appears in D+1's statement. Reconcile window typically covers recent dates every 15 min; both D and D+1 get processed. Order of processing: ascending dates. For D: statement complete (after endOfDay(D)+lag). At that point, is the D+1 settlement visible? No — it's in D+1's statement. So order (in_doubt, effective D) is not in D's statement → provenAbsent → pending → resend with same txid. Bank dedupes (already settled) → duplicate → sent. Then D+1's statement: settlement found, order is 'sent' → markSettled. OK — works out via the duplicate path! No double-pay thanks to deterministic txid.

But timing: after provenAbsent → pending, executePayments resends immediately (no waiting). Send returns 'duplicate' (bank says already processed) → sent. This is safe and self-heals. The plan's design tolerates this — resend is always with the same txid, and duplicate is a success class. OK, not a gap I need to address; the plan's spec governs and I'll implement it exactly.

Alternative: only check proven-absent against the order's own effective date statement — that's what the plan specifies (fetch in_doubt by effective_date D, check against statement for D). I'll follow it.

Now, one more design question about `reconcile`'s counts under overlapping windows (test: "Running reconcile twice against the same window does not double-count or corrupt state"). First run: settled=X, provenAbsent=Y. Second run immediately after: orders are now 'settled'/'pending'; step b finds them but status is not in ('sent','in_doubt') → no count; step c finds no in_doubt orders (flipped to pending) → no count. Returns {0,0}. "Does not double-count" ✓.

Now let me write the final file. Consider: `executePayments` should skip orders whose status changed since findPending (e.g., to in_doubt via concurrent reconcile)? incrementAttempt's WHERE status='pending' handles that (returns 0 → skip). And markParked's WHERE status='pending' is also conditional. OK.

Also: in executePayments, after incrementAttempt succeeds (attempt >= 1), the order is still 'pending' in the DB (increment doesn't change status). Then bank.send... then markSent/markInDoubt/markRejected transition from 'pending'. If bank.send throws something unexpected other than Permanent (caught → in_doubt). All paths transition. If the repo call for markSent fails (DB error) → propagates, order stays pending with count+1; on next run re-send (same txid, deduped). Acceptable.

Type details:
- `order.amountMinorUnits` is `bigint`. `Number(order.amountMinorUnits)`.
- `order.attemptCount` is `number`.
- Prisma's `Order['status']` is `string`.

For the switch on outcome, TS exhaustive: cases accepted/duplicate/transient_error/permanent_rejection — all covered; no default needed. To satisfy strict, add `default: break`? An exhaustive switch over a union without default is fine; no fallthrough needed. Actually, with a variable of type BankSendStatus and a switch over all four cases, TS knows it's exhaustive. Each case ends with `await` and `break`. No default needed.

Let me also decide the naming: private fields for options. The constructor opts parameter isn't stored as a field (the plan shows it as a plain parameter). I'll destructure into private readonly fields. Fine.

Class doc header comment? Reference file (bank-client.interface) has a short header comment. I'll add a one-line file header — acceptable, not a "feature". Keep minimal.

Let me also double-check the plan's service constructor parameter order: (repo, bank, opts). Yes.

Also — `@Injectable()` decorator: conventions show classes in the feature files with @Injectable (repo has it). Service should have it too. Yes.

Final code:

```typescript
// Payment feature: executes pending payouts and reconciles them against the
// bank's settlement statements.

import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

import {
  BankClient,
  BankPermanentError,
  BankSendStatus,
} from './bank-client.interface';
import { PaymentRepository } from './payment.repository';

/** Order lifecycle states. Terminal: settled, rejected, parked_manual_review. */
export type OrderStatus =
  | 'pending'
  | 'sent'
  | 'in_doubt'
  | 'rejected'
  | 'settled'
  | 'parked_manual_review';

/** Inclusive range of calendar dates to reconcile. */
export interface ReconcileWindow {
  startDate: Date;
  endDate: Date;
}

/** Counts of state transitions performed by reconcile(). */
export interface ReconcileResult {
  /** Orders advanced to `settled` by matching a statement entry. */
  settled: number;
  /** Orders proven absent past the publishing lag and made eligible for resend. */
  provenAbsent: number;
}

interface PaymentServiceOptions {
  /** How long after end-of-day before a statement is considered complete. */
  publishingLagMs: number;
  /** Max pending orders sent per executePayments() call. */
  batchSize: number;
  /** Attempts after which the order is parked for manual review. */
  maxAttempts: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class PaymentService {
  private readonly publishingLagMs: number;
  private readonly batchSize: number;
  private readonly maxAttempts: number;

  constructor(
    private readonly repo: PaymentRepository,
    private readonly bank: BankClient,
    opts: PaymentServiceOptions,
  ) {
    this.publishingLagMs = opts.publishingLagMs;
    this.batchSize = opts.batchSize;
    this.maxAttempts = opts.maxAttempts;
  }

  /**
   * Sends pending orders to the bank. Each order is attempted at most once per
   * call; outcome classification happens after the bank responds.
   */
  async executePayments(): Promise<void> {
    const orders = await this.repo.findPending(this.batchSize);

    for (const order of orders) {
      if (order.attemptCount >= this.maxAttempts) {
        // Attempt budget exhausted: park for manual review. Never auto-revert.
        await this.repo.markParked(order.id);
        continue;
      }

      const now = new Date();

      // Atomic claim: returns the new attempt count, or 0 if a concurrent
      // worker already took this order.
      const attempt = await this.repo.incrementAttempt(order.id, now);
      if (attempt === 0) {
        continue;
      }

      let outcome: BankSendStatus;
      try {
        const response = await this.bank.send({
          txid: order.txid,
          amount_minor_units: Number(order.amountMinorUnits),
          key: order.supplierKey,
        });
        outcome = response.status;
      } catch (error) {
        if (error instanceof BankPermanentError) {
          outcome = 'permanent_rejection';
        } else {
          // BankTransientError (including timeouts) — the outcome is unknown,
          // so the order goes to in_doubt and only reconciliation can clear it.
          // ASSUMPTION: the plan classifies exactly the four response statuses
          // plus the two documented error types; any other thrown error is
          // treated as transient rather than aborting the batch.
          outcome = 'transient_error';
        }
      }

      switch (outcome) {
        case 'accepted':
        case 'duplicate':
          await this.repo.markSent(order.id, now);
          break;
        case 'transient_error':
          await this.repo.markInDoubt(order.id, now);
          break;
        case 'permanent_rejection':
          await this.repo.markRejected(order.id);
          break;
      }
    }
  }

  /**
   * Reconciles an inclusive range of calendar dates against the bank's
   * statements. Safe to run repeatedly, including over overlapping windows:
   * every transition is a conditional update and unknown settlements are
   * absorbed by the txid-keyed upsert.
   */
  async reconcile(window: ReconcileWindow): Promise<ReconcileResult> {
    const startDayMs = this.startOfUtcDay(window.startDate).getTime();
    const endDayMs = this.startOfUtcDay(window.endDate).getTime();
    const nowMs = Date.now();

    let settled = 0;
    let provenAbsent = 0;

    for (let dayMs = startDayMs; dayMs <= endDayMs; dayMs += DAY_MS) {
      const day = new Date(dayMs);

      const statements = await this.bank.getStatement(day);
      const statementTxids = new Set(statements.map((s) => s.txid));

      // Match statement entries to orders and advance them to settled.
      for (const entry of statements) {
        const order = await this.repo.findByTxid(entry.txid);
        if (!order) {
          continue; // The bank reported a txid we do not own: nothing to advance.
        }
        if (order.status === 'sent' || order.status === 'in_doubt') {
          // ASSUMPTION: the plan asks for one short transaction around the
          // settlement write; the service layer cannot open Prisma transactions,
          // so the two conditional repository calls run sequentially and stay
          // safe under re-runs.
          await this.repo.markSettled(order.id, entry.settled_at);
          await this.repo.upsertSettlement({
            txid: entry.txid,
            amount_minor_units: entry.amount_minor_units,
            settled_at: entry.settled_at,
            statement_date: day,
          });
          settled += 1;
        }
      }

      // Proven-absent: once the statement is complete (past the publishing lag),
      // any in_doubt order for this date that is not in the statement may be
      // made pending again — with its original txid preserved.
      const endOfDayMs = dayMs + DAY_MS - 1;
      if (nowMs > endOfDayMs + this.publishingLagMs) {
        const inDoubt = await this.repo.findInDoubtByEffectiveDate(day);
        for (const order of inDoubt) {
          if (statementTxids.has(order.txid)) {
            continue;
          }
          await this.repo.markPendingForResend(order.id);
          provenAbsent += 1;
        }
      }
    }

    return { settled, provenAbsent };
  }

  /**
   * Deterministic txid: the same order + effective date always yields the same
   * id, so a resend is deduplicated by the bank. Exposed for tests.
   */
  deriveTxid(orderId: string, effectiveDate: Date): string {
    return createHash('sha256')
      .update(orderId + effectiveDate.toISOString())
      .digest('hex');
  }

  private startOfUtcDay(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }
}
```

Let me verify against the plan point by point:

- deriveTxid = sha256(orderId + effectiveDate.toISOString()).hex ✓ (assumption 1).
- executePayments: fetch pending up to batchSize ✓; per order: attempt_count >= max → markParked, continue ✓; atomic increment, skip on 0 ✓; bank.send with {txid, amount_minor_units, key} ✓ (fields: txid, Number(amountMinorUnits), supplierKey); classify accepted/duplicate → markSent ✓; transient_error → markInDoubt ✓; permanent_rejection → markRejected ✓; thrown BankTransientError/timeout → in_doubt via catch ✓; thrown BankPermanentError → rejected ✓.
- reconcile: enumerate dates inclusively ✓; getStatement per date ✓; match by txid, only settle if status sent|in_doubt, markSettled + upsertSettlement ✓; proven-absent only if now > endOfDay(D) + lag ✓; fetch in_doubt by effective date; skip if txid in statement; else markPendingForResend ✓; return {settled, provenAbsent} ✓.
- Idempotency: counts guarded by status check (settled) and in_doubt fetch (provenAbsent) ✓.
- No bank call inside a DB transaction: repo methods are individual calls; service has no transactions at all ✓ (and I flagged the deviation from the plan's "short transaction" ask).
- No controller, no extra exports beyond what the plan names (OrderStatus, ReconcileWindow, ReconcileResult, PaymentService; private PaymentServiceOptions — hmm, interface not exported, fine; DAY_MS const not exported, fine).
- Layering: no Prisma usage in service ✓.

One point: `attemptCount >= this.maxAttempts` uses the attempt count from findPending. Between findPending and incrementAttempt, a concurrent reconcile could flip pending → ... no wait, reconcile only flips in_doubt → pending, it never takes a pending order to in_doubt. A concurrent executePayments could increment — handled by the atomic claim. If a concurrent worker already parked (markParked: pending → parked), my incrementAttempt returns 0 → skip ✓; and markParked's WHERE status='pending' prevents double-parking... my check uses the stale row from findPending (status pending, count>=max) → calls markParked → conditional WHERE status='pending' → no-op if already parked ✓.

Another check — `markSent(order.id, now)` after increment: between increment and markSent, the order is still 'pending'. A concurrent reconcile can't touch it (it only handles in_doubt/sent... markSettled requires sent|in_doubt). A concurrent executePayments' incrementAttempt would succeed (status still pending!) → double send! Hmm wait: worker A increments (count 1→... say 0→1), is in the middle of bank.send. Worker B's findPending fetched the order before A's increment (stale read, count 0 < 5). B calls incrementAttempt → status still 'pending' (A hasn't marked yet) → B increments to 2 → both send. Same txid, so bank dedupes → one returns duplicate → both markSent (second is no-op). No double-pay, but attempt budget burned and two network calls. This is inherent in the plan's design (increment doesn't lock; the "skip" only works if the first worker has already transitioned status). The plan's `incrementAttempt` with WHERE status='pending' is what was specified — I implement it as given. The race window exists but is harmless due to txid dedup, and the plan explicitly specifies this mechanism. Not something I redesign; my file implements the plan.

Also verify: `findInDoubtByEffectiveDate(day)` — I'm passing `day` (UTC midnight). Prisma's date field comparison: the repo passes it to `effectiveDate: date` where clause. Prisma converts JS Date → 'YYYY-MM-DD' for the `date` type (normalizing to UTC date part). UTC midnight → correct date ✓.

`upsertSettlement({..., statement_date: day})` — same normalization ✓.

BigInt conversion: `Number(order.amountMinorUnits)` — the schema is BigInt per the plan's column `bigint`. If the actual schema were Int, the reference repo's upsertSettlement `amount_minor_units: number` would map to... well, whatever the schema is, my service's conversion `Number(...)` works either way (Number(number) is identity; Number(bigint) converts). Safe.

TS strict check:
- `error` in catch is `unknown` (strict + useUnknownInCatchVariables). `error instanceof BankPermanentError` narrows fine.
- Exhaustive switch on `outcome: BankSendStatus` — all 4 cases handled, no default. After switch, nothing. TS fine (no "not all code paths return" issue since function returns void).
- `order.status === 'sent'` — status is string (Prisma) or union; comparison fine.

Unused imports? BankClient used (constructor type), BankPermanentError used, BankSendStatus used. PaymentRepository used. Injectable used. createHash used. ✓

`PaymentServiceOptions` interface — used in constructor. Non-exported → fine (used, so no unused error).

One more consideration: should `deriveTxid` be before or after the other methods? Ordering doesn't matter. The plan lists executePayments, reconcile, and deriveTxid (internal, "exposed only for tests"). I'll keep my ordering.

Header comment: reference bank-client.interface has a 2-line header. I'll keep mine at one line to be safe against "no extras" discipline — comments are fine.

Actually let me reconsider the two ASSUMPTION comments. Instruction: "If a symbol you need is genuinely missing from both the plan and the reference, don't guess silently... write the file with the most defensible reading and mark with a single `// ASSUMPTION:` comment at the point it matters." — I read "a single" as meaning use that one-line comment form at the point it matters. Two genuinely unresolved points → two such comments is consistent with "at the point it matters". I'll keep both but make them concise. Both are honest: (1) unknown error classification, (2) transaction boundary not implementable in service layer given fixed repo API + no-Prisma-in-service rule.

Hmm, actually let me reconsider #2 once more. Is it really unimplementable? The plan says "Each per-order state transition in step 2b, and each per-order transition in step 2c is wrapped in a single short transaction (the conditional UPDATE + upsertSettlement for 2b)." For step 2c, the "per-order transition" is just markPendingForResend — a single call, trivially one statement. For 2b, it's markSettled + upsertSettlement. The repository (reference, fixed) exposes no composite method and no $transaction passthrough. Service can't call Prisma directly (convention: "zero Prisma
