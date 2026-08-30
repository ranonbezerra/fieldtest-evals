# 06-payout.service.ts

## reasoning

```
Let me carefully analyze the plan and reference files to write `src/payout/payout.service.ts`.

From the plan:

```ts
export class PayoutService {
  constructor(
    private readonly repo: PayoutRepository,
    private readonly bank: BankClient,
  ) {}

  executePayments(): Promise<PayoutResult[]>;
  reconcile(window: ReconcileWindow): Promise<ReconcileResult>;

  // internal, exported for testability
  deriveTxid(orderId: string, effectiveDate: string): string;
  classifyResponse(resp: BankSendResponse): SendClassification;
}
```

From the plan's control flow:

### `executePayments()` transaction boundary

1. **No outer transaction.** Each order is handled in its own short unit.
2. For each pending order (fetched once at start):
   a. Atomically claim: `UPDATE orders SET state = 'sent', send_attempts = send_attempts + 1 WHERE id = ? AND state = 'pending'`. If 0 rows updated, skip (another run claimed it).
   b. Call `bank.send({ txid, amount_cents, key })`.
   c. Classify the response:
      - `accepted`: state stays `sent`. Record `SendEvent(classification = "accepted")`.
      - `duplicate`: set state to `settled`. Record `SendEvent(classification = "duplicate")`. No attempt counted (the claim already incremented; this is acceptable because a duplicate means the bank had it, and the order is now terminal).
      - `transient_error`: state stays `sent`. Record `SendEvent(classification = "transient_error")`.
      - `permanent_rejection`: set state to `rejected`. Record `SendEvent(classification = "permanent_rejection")`.
   d. If `bank.send` throws (unclassifiable): state stays `sent` (or reverts to `pending` if this was the first send and we want it retriable). Record `SendEvent(classification = "transient_error")`. The attempt was already counted in step (a).
3. Return the list of `PayoutResult`s for orders that were actually sent this run.

Wait, there's a subtle point in the plan: "If `bank.send` throws (unclassifiable): state stays `sent` (or reverts to `pending` if this was the first send and we want it retriable)."

Hmm, but the plan's errors section says: "BankClientError — raised if bank.send throws a non-classifiable exception (network error not modeled by the bank's own classification). The order stays in sent (or pending if no prior send) and the attempt is counted as a transient error."

So, when bank.send throws:
- State stays `sent` (or reverts to `pending` if this was the first send and we want it retriable)
- Record SendEvent with classification "transient_error"
- Attempt was already counted in the claim step

Wait, but if state stays `sent`, then how does it get retried? The retry happens via reconciliation proving absence, which sends state back from `sent` to `pending`. So state staying in `sent` is correct for the normal flow.

Actually, re-reading: "state stays `sent` (or reverts to `pending` if this was the first send and we want it retriable)". This is ambiguous. Let me think about what makes most sense given the state machine:

```
pending ──send accepted──► sent ──reconcile match──► settled
   │                         │
   │──send duplicate────────►settled
   │
   ├──send transient──► sent (attempts+1)
   │       │
   │       └─ proven absent, attempts < 5 ──► pending (will re-send next run)
   │       └─ proven absent, attempts >= 5 ──► manual_review (terminal)
   │
   ├──send permanent──► rejected (terminal)
```

So transient error → sent. Then reconciliation proves absence → pending (if attempts < 5). This is the normal retry path.

But wait, if bank.send throws (network error), we don't know if the bank received it or not. The safest thing is to treat it as transient (it may have gone through), keep state as `sent`, and let reconciliation determine what actually happened. This matches "state stays sent".

But then the parenthetical "(or reverts to pending if this was the first send and we want it retriable)" — I think this is an alternative the plan considered but the primary behavior is "stays sent". Let me go with: state stays `sent` when bank.send throws. This is consistent with the state machine where transient → sent.

Actually, wait. Let me reconsider. The claim step already set state to `sent`. So if bank.send throws, the state is already `sent` from the claim. We just need to record the SendEvent and not change state further. That's the simplest and most consistent interpretation: "state stays sent" means we do nothing to state (it's already sent from the claim).

OK so for the throw case:
- State is already `sent` (from claim)
- Record SendEvent with classification "transient_error"
- Don't change state

This is clean and consistent.

Now, there's a question about the attempt cap in executePayments. The plan says:

"The 5-attempt cap applies to send_attempts; on the 6th required send the order is parked (state = manual_review) and bank.send is never called again."

And: "executePayments checks the cap before calling bank.send"

But wait, looking at the state machine and flow:
- `executePayments` only sends orders in `pending` state.
- An order becomes `pending` again only via reconciliation proving absence with attempts < 5.
- So by the time `executePayments` claims a pending order, its send_attempts is < 5 (because reconciliation only reverts to pending when attempts < 5).

Wait, let me trace through:
- Initial: state=pending, send_attempts=0
- executePayments claims: state=sent, send_attempts=1
- Reconcile proves absent, attempts=1 < 5: state=pending (send_attempts stays 1)
- executePayments claims: state=sent, send_attempts=2
- Reconcile proves absent, attempts=2 < 5: state=pending (send_attempts stays 2)
- ...
- executePayments claims: state=sent, send_attempts=5
- Reconcile proves absent, attempts=5 >= 5: state=manual_review

So the cap is enforced by reconciliation, not by executePayments. The plan says "executePayments checks the cap before calling bank.send" but in practice, the only way an order gets back to pending is if reconciliation determined attempts < 5. So executePayments doesn't strictly need to check the cap — it's guaranteed by the state machine.

But the plan explicitly says: "If it does surface, the controller maps it to { code: 'insufficient_attempts' }." And there's an `InsufficientAttemptsError` class. So maybe executePayments should have a defensive check?

Let me re-read: "InsufficientAttemptsError — raised internally if a bug attempts a 6th send; should never surface to the caller because executePayments checks the cap before calling bank.send."

So the plan wants executePayments to check the cap. Even though it's "should never" happen, it's a defensive check. Let me add it: before claiming/sending, if send_attempts >= 5, throw InsufficientAttemptsError (or park the order).

Actually wait — if send_attempts >= 5 and state is pending, that would be a bug (reconciliation should have parked it). So the defensive check would be: if order.send_attempts >= 5, throw InsufficientAttemptsError. But this should never happen in practice.

Hmm, but actually let me reconsider. The plan says "executePayments checks the cap before calling bank.send". Let me add a check: when processing a pending order, if send_attempts >= 5, throw InsufficientAttemptsError. This is defensive and matches the plan.

Actually, I realize there might be a subtlety. Let me re-read the attempt accounting:

"send_attempts is incremented at claim time (step 2a of executePayments), before the bank call."

So:
- claimOrder increments send_attempts and sets state to sent
- The order was pending with send_attempts = N (N < 5, guaranteed by reconciliation)
- After claim: send_attempts = N+1

The max value of send_attempts after a claim is 5 (when N was 4). If reconciliation then proves absence with send_attempts = 5, it parks to manual_review. So the order never goes back to pending with send_attempts >= 5.

So in executePayments, when we fetch a pending order, send_attempts is always < 5. The defensive check is truly just a safety net for bugs.

Let me include the check as the plan specifies: "executePayments checks the cap before calling bank.send". I'll check if send_attempts >= 5 after claiming (or before, on the fetched order) and throw InsufficientAttemptsError.

Wait, but if I check before claiming, the order is pending with send_attempts < 5 (guaranteed). If I check after claiming, send_attempts could be up to 5. Neither would trigger in normal operation. Let me check on the fetched pending order before claiming: if order.send_attempts >= 5, throw. This is the most defensive position.

Actually, I think the cleanest interpretation is: the check happens as part of processing each order. If somehow a pending order has send_attempts >= 5, we throw InsufficientAttemptsError. Let me put it right before the claim.

Now let me think about `reconcile(window)`:

### `reconcile(window)` transaction boundary

1. Call `bank.getStatement(date)` for each distinct `effective_date` in the window (derived from orders in that date range). This is outside any DB transaction.
2. For each effectiveDate:
   a. Determine if the statement is "published": the latest `settled_at` in the returned array (or `window.to` if empty) + 30 min <= now.
   b. If published:
      - For each order in `sent` state with that effectiveDate whose txid is in the statement: set state to `settled`. (Match by txid.)
      - For each order in `sent` state with that effectiveDate whose txid is NOT in the statement: this is "proven absent".
        - If `send_attempts < 5`: set state back to `pending` (next `executePayments` will re-send with the same txid).
        - If `send_attempts >= 5`: set state to `manual_review`.
   c. If not published: do nothing for that date (orders remain in their current state).
3. Record a `ReconcileRun` row with the window and matched count.
4. Return `{ window, matched_count }`.

Wait, step 1 says "for each distinct effective_date in the window (derived from orders in that date range)". So I need to:
1. Find all orders whose effective_date falls within the window [from, to].
2. Get distinct effective_dates.
3. For each, call bank.getStatement(date).

But how do I find orders by date range? The repository has `findOrdersByEffectiveDate(date: string)` which takes a single date. I don't have a `findOrdersByEffectiveDateRange` method.

Hmm, let me look at the repository methods again:
- `findPendingOrders()`
- `findById(id)`
- `claimOrder(id)`
- `updateState(id, state, sendAttempts?)`
- `findOrdersByTxids(txids)`
- `findOrdersByEffectiveDate(date)`
- `createReconcileRun(window, matchedCount)`
- `getLatestReconcileRunForDate(date)`
- `createSendEvent(orderId, txid, classification, raw)`

There's no method to find orders by a range of effective_dates. The plan says "derived from orders in that date range". 

I need to figure out how to get the distinct effective_dates in the window. Options:
1. Iterate over each day in the window and call `findOrdersByEffectiveDate(date)` for each.
2. Use some other approach.

Since the window is a range of dates, and effective_date is a YYYY-MM-DD string, I can iterate over each day in the window. Let me write a helper that generates each date string from `window.from` to `window.to`.

Actually, the window is `{ from: Date, to: Date }`. I need to iterate over each UTC calendar day in [from, to]. For each day, call `findOrdersByEffectiveDate(dateStr)` and collect the distinct dates that have orders (or just all dates in range).

Wait, re-reading: "Call bank.getStatement(date) for each distinct effective_date in the window (derived from orders in that date range)."

So I should only call getStatement for dates that actually have orders. Let me:
1. For each day in the window, call findOrdersByEffectiveDate(day).
2. Collect the set of dates that have orders (or just process all days, but only call getStatement if there are orders).

Actually, it's simpler to just iterate over each day in the window, fetch orders for that day, and if there are orders in `sent` state, process them. But I should only call getStatement if there's at least one order for that date (to avoid unnecessary bank calls).

Hmm, but actually the plan says "for each distinct effective_date in the window (derived from orders in that date range)". This implies I derive the dates from the orders. So:
1. Find all orders in the date range.
2. Get distinct effective_dates from those orders.
3. For each such date, call getStatement.

But I don't have a range query. Let me iterate day by day. For each day in [from, to], call findOrdersByEffectiveDate(day). Collect orders. Then group by effective_date (though each day is one date, so it's already grouped).

Let me write a helper `eachDayInWindow(from: Date, to: Date): string[]` that returns YYYY-MM-DD strings for each UTC day in the range.

Now, for the "published" check:
"the latest settled_at in the returned array (or window.to if empty) + 30 min <= now"

So:
- If statement is non-empty: latestSettledAt = max(settled_at for all settlements). published = (latestSettledAt + 30min) <= now.
- If statement is empty: use window.to. published = (window.to + 30min) <= now.

Wait, that seems odd for the empty case. If the statement is empty (no settlements at all for that date), using window.to + 30min <= now as the "published" check... Let me think. If there are no settlements, we can't determine the latest settled_at. The plan says to use window.to as a fallback. So if window.to + 30min <= now, we consider the statement published (and empty means all orders are proven absent).

This makes sense: if the window ended more than 30 minutes ago, the statement should be fully published. If it's empty, then no orders settled, so all sent orders are proven absent.

Now, for each order in `sent` state with that effective_date:
- If txid is in the statement → settled
- If txid is NOT in the statement → proven absent:
  - send_attempts < 5 → pending
  - send_attempts >= 5 → manual_review

I need to match by txid. The statement has `txid` field. So I build a Set of txids from the statement, then for each order check if its txid is in the set.

Now, about the transaction boundary: "All DB writes (state transitions, reconcile run) are in a single Prisma transaction per effectiveDate batch."

But the repository doesn't expose a transaction method. The service is supposed to have "Zero raw SQL, zero Prisma client calls." So the service can't call prisma.$transaction directly.

Hmm, this is a problem. The plan says the service has zero Prisma client calls, and the repository is the only layer that touches the database. But the repository doesn't have a transaction method.

Let me re-read the layer rules: "service holds the logic. Zero raw SQL, zero Prisma client calls." and "repository is the only layer that touches the database."

So the service cannot call prisma directly. All DB operations go through the repository. The repository as shown doesn't have a transaction method. 

Given the constraint that I can only use the repository methods as defined, and the service can't call prisma, I'll do the DB writes sequentially (not in an explicit transaction). The plan's mention of "single Prisma transaction per effectiveDate batch" is an ideal, but given the repository interface doesn't support it, I'll do sequential updates.

Actually wait — maybe I'm overthinking this. The plan says the repository is the only layer that touches the DB, and the service calls repository methods. The repository methods each do a single DB operation. The "transaction" aspect might be handled at the repository level if needed, but since the repository as shown doesn't have transaction methods, I'll just call the repository methods sequentially.

The key requirement is that reconciliation is idempotent and safe for overlapping windows, which is achieved by the state machine being monotonic (with the one exception of sent→pending for proven absent, which is safe). So even without an explicit transaction, the operations are safe.

Let me proceed with sequential repository calls.

Now, let me also think about `matched_count`. The plan says "Record a ReconcileRun row with the window and matched count." And "matched_count: orders matched in this run". I interpret "matched" as orders that were transitioned to `settled` (i.e., found in the statement). Let me count those.

Actually, re-reading: "matched_count | Int | @map("matched_count"), orders matched in this run". And in the ReconcileResult: "matched_count: number". I'll count orders that were matched (found in statement → settled).

Now let me think about the `deriveTxid` method:

"txid is derived as SHA-256(orderId + "|" + effectiveDate) truncated to 32 hex chars"

I need to use Node's crypto module. Since this is ESM, I'll use:
```ts
import { createHash } from "node:crypto";
```

And:
```ts
deriveTxid(orderId: string, effectiveDate: string): string {
  return createHash("sha256").update(`${orderId}|${effectiveDate}`).digest("hex").slice(0, 32);
}
```

Now `classifyResponse`:

The plan says the bank returns a `BankSendResponse` which already has a `classification` field. So `classifyResponse` just returns `resp.classification`. But wait, the plan says "Classify bank.send responses (accepted, duplicate, transient error, permanent rejection) and handle each differently." And the BankSendResponse already has classification. So classifyResponse is a pass-through?

Looking at the type:
```ts
export interface BankSendResponse {
  classification: SendClassification;
  txid: string;
  message?: string;
}
```

Yes, the response already has classification. So `classifyResponse(resp: BankSendResponse): SendClassification` just returns `resp.classification`. It's a simple accessor/validator. Maybe it validates that the classification is one of the known values? But since it's typed, TypeScript already ensures it. Let me just return `resp.classification`.

Actually, the plan lists it as a method "exported for testability", so it's probably meant to be a simple function that extracts/validates the classification. I'll implement it as returning `resp.classification`.

Now let me think about the full executePayments flow:

```ts
async executePayments(): Promise<PayoutResult[]> {
  const pendingOrders = await this.repo.findPendingOrders();
  const results: PayoutResult[] = [];

  for (const order of pendingOrders) {
    // Defensive cap check
    if (order.send_attempts >= 5) {
      throw new InsufficientAttemptsError(order.id);
    }

    // Atomically claim
    const claimed = await this.repo.claimOrder(order.id);
    if (!claimed) {
      continue; // another run claimed it
    }

    let classification: SendClassification;
    try {
      const resp = await this.bank.send({
        txid: claimed.txid,
        amount_cents: claimed.amount_cents,
        key: claimed.supplier_key,
      });
      classification = this.classifyResponse(resp);
    } catch {
      // unclassifiable error — treat as transient
      classification = "transient_error";
    }

    // Handle based on classification
    switch (classification) {
      case "accepted":
        // state stays sent (already set by claim)
        break;
      case "duplicate":
        await this.repo.updateState(claimed.id, "settled");
        break;
      case "transient_error":
        // state stays sent
        break;
      case "permanent_rejection":
        await this.repo.updateState(claimed.id, "rejected");
        break;
    }

    // Record send event
    await this.repo.createSendEvent(claimed.id, claimed.txid, classification, JSON.stringify({ ... }));

    results.push({
      order_id: claimed.id,
      txid: claimed.txid,
      classification,
    });
  }

  return results;
}
```

Wait, for the raw_response in createSendEvent, I need to pass a JSON string. But if bank.send throws, I don't have a response. Let me handle that:

```ts
let classification: SendClassification;
let rawResponse: string;
try {
  const resp = await this.bank.send({...});
  classification = this.classifyResponse(resp);
  rawResponse = JSON.stringify(resp);
} catch (err) {
  classification = "transient_error";
  rawResponse = JSON.stringify({ error: String(err) });
}
```

Now, there's a question about the `PayoutResult` for the throw case. The plan says "Return the list of PayoutResults for orders that were actually sent this run." A throw means we attempted to send but got an unclassifiable error. I think we should still include it in the results with classification "transient_error", since we did attempt the send.

Actually, re-reading: "Return the list of PayoutResults for orders that were actually sent this run." The word "sent" is a bit ambiguous. I think it means orders that were processed (attempted) in this run, regardless of outcome. So yes, include all processed orders.

Now for reconcile:

```ts
async reconcile(window: ReconcileWindow): Promise<ReconcileResult> {
  const now = new Date();
  const PUBLISHING_LAG_MS = 30 * 60 * 1000; // 30 minutes

  let matchedCount = 0;

  const dates = this.eachDayInWindow(window.from, window.to);
  
  for (const dateStr of dates) {
    const orders = await this.repo.findOrdersByEffectiveDate(dateStr);
    if (orders.length === 0) continue; // no orders for this date, skip bank call

    const statement = await this.bank.getStatement(dateStr);
    
    // Determine if published
    let latestSettledAt: Date;
    if (statement.length > 0) {
      latestSettledAt = statement.reduce((max, s) => s.settled_at > max ? s.settled_at : max, statement[0].settled_at);
    } else {
      latestSettledAt = window.to;
    }

    const published = (latestSettledAt.getTime() + PUBLISHING_LAG_MS) <= now.getTime();
    if (!published) continue;

    // Build set of settled txids
    const settledTxids = new Set(statement.map(s => s.txid));

    // Process orders in sent state for this date
    const sentOrders = orders.filter(o => o.state === "sent");
    
    for (const order of sentOrders) {
      if (settledTxids.has(order.txid)) {
        await this.repo.updateState(order.id, "settled");
        matchedCount++;
      } else {
        // proven absent
        if (order.send_attempts < 5) {
          await this.repo.updateState(order.id, "pending");
        } else {
          await this.repo.updateState(order.id, "manual_review");
        }
      }
    }
  }

  await this.repo.createReconcileRun(window, matchedCount);

  return { window, matched_count: matchedCount };
}
```

Wait, I need to think about the "eachDayInWindow" helper. The window is { from: Date, to: Date }. I need to generate YYYY-MM-DD strings for each UTC day in [from, to] inclusive.

```ts
private eachDayInWindow(from: Date, to: Date): string[] {
  const dates: string[] = [];
  const current = new Date(Date.UTC(
    from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()
  ));
  const end = new Date(Date.UTC(
    to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()
  ));
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}
```

This is a private helper. The plan doesn't explicitly name it, but it's needed to implement the reconcile logic. Since the plan says "for each distinct effective_date in the window", I need this helper. It's an implementation detail, not a new export or feature.

Hmm, but the instructions say "Do not add an export, a feature or a file the plan does not name." A private helper method is not an export, and it's necessary to implement the specified behavior. I think it's fine.

Actually, let me reconsider whether I even need to iterate day by day. The plan says "for each distinct effective_date in the window (derived from orders in that date range)". 

An alternative: I could find all orders and filter by date range. But the repository only has `findOrdersByEffectiveDate(date)` for a single date. So I need to iterate.

Actually, wait. Let me reconsider. Maybe I'm overcomplicating this. The window is a time range, and effective_date is a date string. The natural interpretation is: for each day in the window, check if there are orders with that effective_date, and if so, reconcile them.

Let me keep the day-by-day iteration.

Now, one concern: the plan says "All DB writes (state transitions, reconcile run) are in a single Prisma transaction per effectiveDate batch." Since I can't use transactions (no prisma access in service, no transaction method in repo), I'll do sequential writes. This is a limitation of the given repository interface, but the behavior (idempotency, safety) is preserved.

Let me also double-check: the plan says the service should not have "zero Prisma client calls". So I must not import or use PrismaClient in the service. All DB access through repo. Good.

Now let me think about imports:

```ts
import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { BankClient, BankSendResponse, SendClassification } from "./bank-client";
import type { PayoutRepository } from "./payout.repository";
import {
  BankClientError,
  InsufficientAttemptsError,
  type OrderState,
  type PayoutResult,
  type ReconcileResult,
  type ReconcileWindow,
} from "./payout.types";
```

Wait, do I need `@Injectable()`? The plan's module shows:
```ts
@Module({
  controllers: [PayoutController],
  providers: [PayoutService, PayoutRepository],
  exports: [PayoutService],
})
```

For NestJS DI to work, the service needs `@Injectable()`. But the plan's service signature doesn't show it. However, without it, NestJS won't inject dependencies properly. Let me check the plan again...

The plan shows:
```ts
export class PayoutService {
  constructor(
    private readonly repo: PayoutRepository,
    private readonly bank: BankClient,
  ) {}
  ...
}
```

No `@Injectable()` shown. But in NestJS, you need it for DI. However, the instructions say "Implement exactly what the plan specifies for this file." The plan doesn't show `@Injectable()`. But without it, the code won't work in NestJS.

Hmm, this is a judgment call. The plan is the spec. If the plan doesn't include `@Injectable()`, maybe it's intentionally omitted (perhaps the test setup handles DI differently, or it's an oversight). But for the code to actually work in NestJS, `@Injectable()` is needed.

Actually, looking more carefully: the plan says "File layout: feature lives in src/payout/" and shows the module with providers. For NestJS to inject PayoutRepository and BankClient into PayoutService, the service needs @Injectable(). 

But wait — BankClient is an interface. How would NestJS inject it? It would need a provider that provides BankClient with a useValue or useClass. The plan doesn't show this in the module. This suggests that either:
1. The module is incomplete in the plan (and another file provides BankClient).
2. The tests mock it differently.

Given that the plan says "Bank is a single injected interface BankClient; no real HTTP client", and the module only shows PayoutService and PayoutRepository as providers, there must be something else providing BankClient. But that's not my concern for this file.

For the service file, I'll include `@Injectable()` because it's required for NestJS DI and is a standard part of a NestJS service. The plan's omission is likely just shorthand. Actually, let me reconsider — the instructions say "Implement exactly what the plan specifies for this file. Do not add an export, a feature or a file the plan does not name."

`@Injectable()` is a decorator, not an export or feature. It's a standard NestJS requirement. I'll include it. If the plan intended to omit it, the code wouldn't work, so including it is the defensible reading.

Hmm, but actually, let me reconsider once more. The tests are in `test/payout.service.spec.ts` and they test the service directly (not through NestJS DI). So in tests, you'd construct PayoutService manually: `new PayoutService(mockRepo, mockBank)`. In that case, `@Injectable()` doesn't matter for tests. But for the actual NestJS app, it does.

I'll include `@Injectable()` to be safe and correct for the NestJS context. It's a one-line decorator that's standard practice.

Wait, but if I include `@Injectable()`, I need to import it from `@nestjs/common`. Let me check if that's available. The stack says NestJS, so yes.

Let me also reconsider: do I need `OrderState` in the service? I use string literals like "sent", "settled", "pending", "manual_review", "rejected". I could use the OrderState type for type safety. But since I'm passing them to `updateState(id, state: OrderState, ...)`, TypeScript will check the literals against the type. I don't strictly need to import OrderState unless I use it in a type annotation. Let me see...

In the reconcile method, I filter orders by `o.state === "sent"`. The order's state is typed as OrderState (from Prisma). So the comparison works without importing OrderState. I'll skip importing it unless needed.

Actually, I do reference state values in the service. Let me just use string literals and let TypeScript validate them against the parameter types. No need to import OrderState explicitly.

Let me now also think about whether `classifyResponse` should do anything beyond returning `resp.classification`. The plan lists it as a method. Given that BankSendResponse already has classification, the method is trivial. But maybe it's meant to be a place where classification logic would live if the bank response format changed. For now, it's a pass-through.

Let me write it as:
```ts
classifyResponse(resp: BankSendResponse): SendClassification {
  return resp.classification;
}
```

This is simple and matches the plan.

Now, let me also consider: should `deriveTxid` be used in executePayments? The plan says txid is "stored on the order so all resends reuse it." So when sending, I use `order.txid` (already stored), not re-derive it. The `deriveTxid` method is "exported for testability" and would be used when creating orders (which is outside this service's scope, or perhaps in a different method not shown). 

Wait, the plan says the service has `deriveTxid` as a method. But when is it called? The plan says "txid is derived as SHA-256(orderId + "|" + effectiveDate) truncated to 32 hex chars; stored on the order so all resends reuse it." This implies txid is derived at order creation time and stored. The service's `deriveTxid` is available for that purpose (or for testing). In executePayments, I use the stored txid.

So in executePayments, I use `claimed.txid` (from the order), not `this.deriveTxid(...)`. Good.

Let me now write the complete file.

Actually, wait. Let me reconsider the `eachDayInWindow` helper. Is it OK to add a private method that the plan doesn't name? The instructions say "Do not add an export, a feature or a file the plan does not name." A private helper method is not an export. It's an implementation detail necessary to fulfill the plan's reconcile specification. I think it's acceptable.

But let me see if there's a way to avoid it. The plan says "for each distinct effective_date in the window (derived from orders in that date range)". If I could query all orders in the date range at once, I could extract distinct dates. But the repository only has `findOrdersByEffectiveDate(date)` for a single date. So I must iterate over dates.

Alternatively, maybe the window is always small (e.g., 15 minutes), so it spans at most 1-2 days. But I can't assume that. I'll iterate over all days in the window.

Let me finalize the helper:

```ts
private eachUtcDayInWindow(from: Date, to: Date): string[] {
  const days: string[] = [];
  let cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (cursor.getTime() <= end.getTime()) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return days;
}
```

Using `cursor.getTime() + 24*60*60*1000` is safe for UTC dates (no DST in UTC). Good.

Now, let me also handle the edge case where `from > to` (empty window). The while loop wouldn't execute, returning an empty array. That's fine — no dates to process, matchedCount = 0, record the run, return.

Let me also think about whether I should filter orders to only those in `sent` state before processing. In reconcile, I only care about `sent` orders (they're the ones that can be matched or proven absent). Orders in other states (pending, settled, manual_review, rejected) are not touched by reconcile. So I filter to `sent`.

But wait — should I also consider orders in other states? The plan says:
- "For each order in sent state with that effectiveDate whose txid is in the statement: set state to settled."
- "For each order in sent state with that effectiveDate whose txid is NOT in the statement: proven absent."

So only `sent` orders are processed. Good, I filter to sent.

Now, one more consideration: the plan says "reconcile may run concurrently with executePayments; reconcile only advances sent -> settled or proves absence (leaving state as-is), so it never conflicts with a send in flight."

Wait, "proves absence (leaving state as-is)" — but then it says proven absent with attempts < 5 → pending. That's not "leaving state as-is", that's changing sent → pending. Let me re-read...

"reconcile only advances sent -> settled or proves absence (leaving state as-is)"

Hmm, this contradicts the earlier description where proven absent → pending. Let me re-read the full reconcile spec:

"For each order in sent state with that effectiveDate whose txid is NOT in the statement: this is 'proven absent'.
- If send_attempts < 5: set state back to pending (next executePayments will re-send with the same txid).
- If send_attempts >= 5: set state to manual_review."

So proven absent does change state (sent → pending or sent → manual_review). The "leaving state as-is" in the concurrency note must be a simplification or error. I'll follow the detailed spec: proven absent changes state.

The concurrency safety comes from the fact that these transitions are idempotent and the state machine prevents conflicts. If executePayments is in flight (order is sent, bank call pending), and reconcile runs and proves absence (sent → pending), then when executePayments completes, it would try to update state based on the response. But wait, executePayments already claimed the order (state=sent) and is waiting for bank response. If reconcile changes it to pending in the meantime, then when executePayments gets a response and tries to updateState, it would set it to settled/rejected/etc. based on the response.

Hmm, this could be a race condition. But the plan says it's safe because "reconcile only advances sent -> settled or proves absence". Let me not overthink this — the plan asserts it's safe, and my job is to implement what the plan says.

Actually, I think the safety argument is: if reconcile proves absence and sets state to pending, but executePayments is still in flight, then when executePayments gets a response:
- If accepted: executePayments would set state to... wait, it already claimed (state=sent). If reconcile changed it to pending, and then executePayments sets it to settled (for duplicate) or leaves it sent (for accepted/transient), there's a conflict.

But this is an edge case that the plan acknowledges as safe. I'll implement per the plan and not add extra locking (the plan doesn't specify locking in reconcile).

OK let me just write the code now. I've analyzed enough.

Let me also double check: the plan says "No outer transaction. Each order is handled in its own short unit." for executePayments. So no wrapping the whole thing in a transaction. Each order is processed independently. Good, that's what I have.

For reconcile: "All DB writes (state transitions, reconcile run) are in a single Prisma transaction per effectiveDate batch." Since I can't do transactions (no prisma in service), I'll do sequential writes per date. This is a limitation but the behavior is correct.

Actually, wait. Let me reconsider whether I should note this as an assumption. The plan explicitly says transactions should be used, but the repository interface doesn't support it, and the service can't access prisma. This is a genuine gap. Should I add an ASSUMPTION comment?

The instructions say: "If a symbol you need is genuinely absent from both the plan and the references, do not guess in silence and do not reason around it: write the file using the most defensible reading and mark it with one // ASSUMPTION: <what was unresolved> comment at the point it matters."

The "symbol" here is a transaction method on the repository. It's absent from the repository (which is a reference file I can't modify) and the service can't use prisma directly. So I'm using the most defensible reading: sequential repository calls without an explicit transaction. I should mark this with an ASSUMPTION comment.

Let me add: `// ASSUMPTION: the plan calls for a Prisma transaction per effectiveDate batch, but PayoutRepository exposes no transaction API and the service must not touch Prisma directly; writes are issued sequentially per date, which preserves the idempotent state-machine guarantees the plan relies on for overlapping-window safety.`

That's a good assumption comment. Let me place it near the reconcile method or at the point where I do the writes.

Now let me write the final file.

```ts
import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";

import type { BankClient, BankSendResponse, SendClassification } from "./bank-client";
import type { PayoutRepository } from "./payout.repository";
import {
  BankClientError,
  InsufficientAttemptsError,
  type PayoutResult,
  type ReconcileResult,
  type ReconcileWindow,
} from "./payout.types";

const PUBLISHING_LAG_MS = 30 * 60 * 1000;
const MAX_SEND_ATTEMPTS = 5;

@Injectable()
export class PayoutService {
  constructor(
    private readonly repo: PayoutRepository,
    private readonly bank: BankClient,
  ) {}

  async executePayments(): Promise<PayoutResult[]> {
    const pendingOrders = await this.repo.findPendingOrders();
    const results: PayoutResult[] = [];

    for (const order of pendingOrders) {
      if (order.send_attempts >= MAX_SEND_ATTEMPTS) {
        throw new InsufficientAttemptsError(order.id);
      }

      const claimed = await this.repo.claimOrder(order.id);
      if (claimed === null) {
        continue;
      }

      let classification: SendClassification;
      let rawResponse: string;
      try {
        const resp = await this.bank.send({
          txid: claimed.txid,
          amount_cents: claimed.amount_cents,
          key: claimed.supplier_key,
        });
        classification = this.classifyResponse(resp);
        rawResponse = JSON.stringify(resp);
      } catch (err) {
        classification = "transient_error";
        rawResponse = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }

      switch (classification) {
        case "duplicate":
          await this.repo.updateState(claimed.id, "settled");
          break;
        case "permanent_rejection":
          await this.repo.updateState(claimed.id, "rejected");
          break;
        case "accepted":
        case "transient_error":
          // state remains "sent" as set by the claim
          break;
      }

      await this.repo.createSendEvent(claimed.id, claimed.txid, classification, rawResponse);

      results.push({
        order_id: claimed.id,
        txid: claimed.txid,
        classification,
      });
    }

    return results;
  }

  async reconcile(window: ReconcileWindow): Promise<ReconcileResult> {
    const now = new Date();
    let matchedCount = 0;

    // ASSUMPTION: the plan calls for a Prisma transaction per effectiveDate batch, but PayoutRepository exposes no transaction API and the service must not touch Prisma directly; state writes are issued sequentially per date, which preserves the idempotent state-machine guarantees the plan relies on for overlapping-window safety.
    for (const dateStr of this.eachUtcDayInWindow(window.from, window.to)) {
      const orders = await this.repo.findOrdersByEffectiveDate(dateStr);
      if (orders.length === 0) {
        continue;
      }

      const statement = await this.bank.getStatement(dateStr);

      const latestSettledAt =
        statement.length > 0
          ? statement.reduce(
              (max, s) => (s.settled_at.getTime() > max.getTime() ? s.settled_at : max),
              statement[0].settled_at,
            )
          : window.to;

      if (latestSettledAt.getTime() + PUBLISHING_LAG_MS > now.getTime()) {
        continue; // statement not yet published for this date
      }

      const settledTxids = new Set(statement.map((s) => s.txid));
      const sentOrders = orders.filter((o) => o.state === "sent");

      for (const order of sentOrders) {
        if (settledTxids.has(order.txid)) {
          await this.repo.updateState(order.id, "settled");
          matchedCount += 1;
        } else if (order.send_attempts < MAX_SEND_ATTEMPTS) {
          await this.repo.updateState(order.id, "pending");
        } else {
          await this.repo.updateState(order.id, "manual_review");
        }
      }
    }

    await this.repo.createReconcileRun(window, matchedCount);

    return { window, matched_count: matchedCount };
  }

  deriveTxid(orderId: string, effectiveDate: string): string {
    return createHash("sha256").update(`${orderId}|${effectiveDate}`).digest("hex").slice(0, 32);
  }

  classifyResponse(resp: BankSendResponse): SendClassification {
    return resp.classification;
  }

  private eachUtcDayInWindow(from: Date, to: Date): string[] {
    const days: string[] = [];
    const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
    const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
    for (let t = start; t <= end; t += 24 * 60 * 60 * 1000) {
      days.push(new Date(t).toISOString().slice(0, 10));
    }
    return days;
  }
}
```

Wait, I import `BankClientError` but don't use it in the service. Let me check — the plan says BankClientError is "raised if bank.send throws a non-classifiable exception". But in my implementation, I catch the error and treat it as transient_error without throwing BankClientError. 

Re-reading the plan: "BankClientError — raised if bank.send throws a non-classifiable exception (network error not modeled by the bank's own classification). The order stays in sent (or pending if no prior send) and the attempt is counted as a transient error. Controller maps to { code: bank_client_error }."

Hmm, so the plan says BankClientError is raised. But it also says "The order stays in sent... and the attempt is counted as a transient error." This is contradictory — if the error is raised, the order wouldn't be updated (the exception would propagate). Unless the error is caught internally and the order is still updated.

Let me re-read more carefully: "BankClientError — raised if bank.send throws a non-classifiable exception (network error not modeled by the bank's own classification). The order stays in sent (or pending if no prior send) and the attempt is counted as a transient error. Controller maps to { code: bank_client_error }."

I think the intent is:
- When bank.send throws, the service catches it.
- The order stays in sent (no state change beyond the claim).
- A SendEvent is recorded with classification "transient_error".
- The BankClientError is... raised? But if it's raised, it propagates to the controller.

Wait, but if it propagates, then executePayments would fail for that order and subsequent orders wouldn't be processed. That doesn't match "Each order is handled in its own short unit."

I think there are two possible interpretations:
1. The error is caught, the order is handled (stays sent, event recorded), and no error propagates. BankClientError is just a type that exists but isn't actually thrown in this flow.
2. The error is caught, the order is handled, and then BankClientError is thrown to signal to the caller that something went wrong (but the order was still processed).

Given the plan's control flow says: "d. If bank.send throws (unclassifiable): state stays sent... Record SendEvent(classification = transient_error). The attempt was already counted in step (a)." — this describes handling the error inline, not propagating it. So interpretation 1 seems right: catch, handle, don't propagate.

But then why does the plan mention BankClientError and "Controller maps to { code: bank_client_error }"? Maybe for a different scenario, or maybe it's a leftover.

I'll go with interpretation 1: catch the error, treat as transient, record event, don't propagate. I won't throw BankClientError in executePayments. This matches the control flow description.

So I should remove the `BankClientError` import since I don't use it. Let me check if I use it anywhere... No, I don't. Remove it.

Actually wait, let me reconsider. Maybe the plan wants BankClientError to be thrown in some cases. But the control flow is clear: "If bank.send throws (unclassifiable): state stays sent... Record SendEvent." This is inline handling. No propagation. So BankClientError isn't thrown in executePayments.

But the plan lists it as an error that exists and is mapped by the controller. Maybe it's for a different method or a future use. Since I'm only implementing what the plan specifies for this file, and the control flow doesn't throw it, I won't use it. Remove the import.

Let me also reconsider: do I need `InsufficientAttemptsError`? Yes, I throw it in executePayments when send_attempts >= 5 (defensive check). Keep that import.

Let me also reconsider the `OrderState` import — I don't use it explicitly (I use string literals). Remove it if not imported. In my current code, I don't import OrderState. Good.

Let me clean up imports:
```ts
import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";

import type { BankClient, BankSendResponse, SendClassification } from "./bank-client";
import type { PayoutRepository } from "./payout.repository";
import {
  InsufficientAttemptsError,
  type PayoutResult,
  type ReconcileResult,
  type ReconcileWindow,
} from "./payout.types";
```

This looks right. I use:
- Injectable (decorator)
- createHash (deriveTxid)
- BankClient (constructor param type)
- BankSendResponse (classifyResponse param type)
- SendClassification (return types, local vars)
- PayoutRepository (constructor param type)
- InsufficientAttemptsError (thrown)
- PayoutResult (return type)
- ReconcileResult (return type)
- ReconcileWindow (param type)

All used. Good.

Now, let me reconsider the `@Injectable()` decorator once more. The plan's service signature doesn't show it. But NestJS requires it for DI. The instructions say to implement exactly what the plan specifies. However, the plan also says the module lists PayoutService as a provider, which implies DI is used, which implies @Injectable() is needed.

I'll include it. It's a standard NestJS requirement and its absence would be a bug. The plan's omission is shorthand, not an explicit exclusion.

Hmm, but actually, let me reconsider whether the tests would care. The test file is `test/payout.service.spec.ts` and it "Tests for timeout-but-settled, proven-absent resend, attempt exhaustion, duplicate, permanent rejection, overlapping windows, unpublished statement, concurrent claim, txid determinism." These are unit tests that would construct PayoutService directly with mocks. In that case, @Injectable() is irrelevant to the tests.

But for the actual NestJS app, it's needed. Since the deliverable includes a working service (not just tests), I'll include @Injectable().

Final check on the code:

1. `executePayments`:
   - Fetches pending orders
   - For each, checks cap (defensive), claims atomically, sends, classifies, updates state, records event, adds to results
   - Returns results
   ✓

2. `reconcile`:
   - Iterates days in window
   - For each day with orders, fetches statement
   - Checks published (latest settled_at + 30min <= now)
   - If published, matches sent orders by txid
   - Settles matched, reverts proven-absent to pending (if attempts < 5) or manual_review (if >= 5)
   - Records reconcile run
   - Returns result
   ✓

3. `deriveTxid`: SHA-256(orderId|effectiveDate) truncated to 32 hex chars ✓

4. `classifyResponse`: returns resp.classification ✓

5. Private helper `eachUtcDayInWindow` ✓

Let me also verify: the plan says "bank.send is never called twice in the same execution for one order". Since I process each order once per executePayments call (fetched once at start, processed in a single loop), this is satisfied. ✓

The plan says "resends happen only on a later executePayments run after reconciliation has proven absence." Since executePayments only sends pending orders, and an order becomes pending again only via reconciliation, this is satisfied. ✓

I think the code is correct and complete. Let me write it out cleanly.

One more thing: the `rawResponse` for the catch case. I use `JSON.stringify({ error: ... })`. This is a reasonable representation of the "raw response" when there's no response (just an error). The plan says `raw_response: JSON string of bank response for debugging`. When there's no response, an error object is the closest thing. This is fine.

Also, I should make sure the `createSendEvent` call happens even in the catch case. Yes, it does — it's after the try/catch block. ✓

Let me also verify the state transitions in executePayments match the plan:
- accepted → stays sent ✓ (no updateState call)
- duplicate → settled ✓
- transient_error → stays sent ✓ (no updateState call)
- permanent_rejection → rejected ✓
- throw → stays sent ✓ (no updateState call, classification = transient_error)

All match. 

And in reconcile:
- matched (txid in statement) → settled ✓
- proven absent, attempts < 5 → pending ✓
- proven absent, attempts >= 5 → manual_review ✓

All match.

I'm confident in the implementation. Let me write the final version.

Actually, let me reconsider one thing about the `eachUtcDayInWindow` helper and whether it could produce an infinite loop or miss days. 

```ts
private eachUtcDayInWindow(from: Date, to: Date): string[] {
  const days: string[] = [];
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  for (let t = start; t <= end; t += 24 * 60 * 60 * 1000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}
```

- `start` is midnight UTC of `from`'s date.
- `end` is midnight UTC of `to`'s date.
- Loop from start to end inclusive, stepping by 24h.
- If from = to (same day), start = end, one iteration. ✓
- If from < to, multiple iterations. ✓
- If from > to, no iterations (empty array). ✓

This is correct. No infinite loop risk since t strictly increases and end is finite.

Edge case: very large window (e.g., years). The loop would iterate many times, but that's a caller concern. For a 15-minute reconcile window, it's at most 1-2 days.

I'm satisfied. Let me write the final file.

Wait, I want to double-check one more time about whether `reconcile` should process ALL orders for a date or only `sent` ones. The plan says:

"For each order in sent state with that effectiveDate whose txid is in the statement: set state to settled."
"For each order in sent state with that effectiveDate whose txid is NOT in the statement: this is proven absent."

So only `sent` orders. I filter with `orders.filter((o) => o.state === "sent")`. ✓

But wait — what about orders that are `pending` for that date? They're not sent yet, so they shouldn't be matched or proven absent. Correct to exclude them. ✓

What about orders already `settled`? They're terminal, not touched. Correct to exclude (they're not `sent`). ✓

What about `manual_review` or `rejected`? Terminal, not touched. Correct to exclude. ✓

Good, filtering to `sent` is correct.

Now, one subtle point: when I call `findOrdersByEffectiveDate(dateStr)`, it returns ALL orders for that date (all states). I then filter to `sent`. This is correct but slightly inefficient (fetches more than needed). However, the repository doesn't have a method to filter by state + date, so this is the best I can do with the given interface. It's fine.

Alternatively, I could avoid fetching non-sent orders by... no, the repository doesn't support that. I'll keep it as is.

Final code:

```ts
import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";

import type { BankClient, BankSendResponse, SendClassification } from "./bank-client";
import type { PayoutRepository } from "./payout.repository";
import {
  InsufficientAttemptsError,
  type PayoutResult,
  type ReconcileResult,
  type ReconcileWindow,
} from "./payout.types";

const PUBLISHING_LAG_MS = 30 * 60 * 1000;
const MAX_SEND_ATTEMPTS = 5;

@Injectable()
export class PayoutService {
  constructor(
    private readonly repo: PayoutRepository,
    private readonly bank: BankClient,
  ) {}

  async executePayments(): Promise<PayoutResult[]> {
    const pendingOrders = await this.repo.findPendingOrders();
    const results: PayoutResult[] = [];

    for (const order of pendingOrders) {
      if (order.send_attempts >= MAX_SEND_ATTEMPTS) {
        throw new InsufficientAttemptsError(order.id);
      }

      const claimed = await this.repo.claimOrder(order.id);
      if (claimed === null) {
        continue;
      }

      let classification: SendClassification;
      let rawResponse: string;
      try {
        const resp = await this.bank.send({
          txid: claimed.txid,
          amount_cents: claimed.amount_cents,
          key: claimed.supplier_key,
        });
        classification = this.classifyResponse(resp);
        rawResponse = JSON.stringify(resp);
      } catch (err) {
        classification = "transient_error";
        rawResponse = JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        });
      }

      switch (classification) {
        case "duplicate":
          await this.repo.updateState(claimed.id, "settled");
          break;
        case "permanent_rejection":
          await this.repo.updateState(claimed.id, "rejected");
          break;
        case "accepted":
        case "transient_error":
          // state remains "sent" as set by the atomic claim
          break;
      }

      await this.repo.createSendEvent(claimed.id, claimed.txid, classification, rawResponse);

      results.push({
        order_id: claimed.id,
        txid: claimed.txid,
        classification,
      });
    }

    return results;
  }

  async reconcile(window: ReconcileWindow): Promise<ReconcileResult> {
    const now = new Date();
    let matchedCount = 0;

    // ASSUMPTION: the plan calls for a Prisma transaction per effectiveDate batch, but PayoutRepository exposes no transaction API and the service must not touch Prisma directly; state writes are issued sequentially per date, which preserves the idempotent state-machine guarantees the plan relies on for overlapping-window safety.
    for (const dateStr of this.eachUtcDayInWindow(window.from, window.to)) {
      const orders = await this.repo.findOrdersByEffectiveDate(dateStr);
      if (orders.length === 0) {
        continue;
      }

      const statement = await this.bank.getStatement(dateStr);

      const latestSettledAt =
        statement.length > 0
          ? statement.reduce((max, s) =>
              s.settled_at.getTime() > max.getTime() ? s.settled_at : max,
            )
          : window.to;

      if (latestSettledAt.getTime() + PUBLISHING_LAG_MS > now.getTime()) {
        continue; // statement not yet published for this date
      }

      const settledTxids = new Set(statement.map((s) => s.txid));
      const sentOrders = orders.filter((o) => o.state === "sent");

      for (const order of sentOrders) {
        if (settledTxids.has(order.txid)) {
          await this.repo.updateState(order.id, "settled");
          matchedCount += 1;
        } else if (order.send_attempts < MAX_SEND_ATTEMPTS) {
          await this.repo.updateState(order.id, "pending");
        } else {
          await this.repo.updateState(order.id, "manual_review");
        }
      }
    }

    await this.repo.createReconcileRun(window, matchedCount);

    return { window, matched_count: matchedCount };
  }

  deriveTxid(orderId: string, effectiveDate: string): string {
    return createHash("sha256").update(`${orderId}|${effectiveDate}`).digest("hex").slice(0, 32);
  }

  classifyResponse(resp: BankSendResponse): SendClassification {
    return resp.classification;
  }

  private eachUtcDayInWindow(from: Date, to: Date): string[] {
    const days: string[] = [];
    const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
    const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
    for (let t = start; t <= end; t += 24 * 60 * 60 * 1000) {
      days.push(new Date(t).toISOString().slice(0, 10));
    }
    return days;
  }
}
```

Wait, I need to double check the `reduce` — when `statement.length > 0`, I use `statement.reduce(...)` without an initial value, which means the first element is used as the initial accumulator. That's correct for finding the max. But TypeScript might complain if the array could be empty — but I guarded with `statement.length > 0`, so it's fine. Actually, TypeScript's type system doesn't narrow based on the ternary condition in a way that affects the reduce call. Let me check...

Actually, `statement.reduce((max, s) => ...)` without initial value requires the array to be non-empty at runtime, but TypeScript's type for `reduce` without initial value is `reduce(cb: (prev: T, cur: T) => T): T` which doesn't require a non-empty check at the type level. It'll compile fine. At runtime, since I guarded with `statement.length > 0`, it's safe.

But to be extra safe and clear, I could use `statement[0].settled_at` as the initial value:
```ts
statement.reduce((max, s) => s.settled_at.getTime() > max.getTime() ? s.settled_at : max, statement[0].settled_at)
```

This is cleaner and avoids any ambiguity. Let me use this form.

Actually, both forms are equivalent when the array is non-empty. The form with explicit initial value is slightly more verbose but clearer. Let me use it.

Hmm, but `statement[0].settled_at` — TypeScript might complain that `statement[0]` could be undefined if noUncheckedIndexedAccess is enabled. But the stack says "TypeScript (strict)" — strict mode includes `noUncheckedIndexedAccess`? No, actually, `strict` does NOT include `noUncheckedIndexedAccess`. That's a separate flag. So `statement[0]` is typed as `Settlement`, not `Settlement | undefined`. So it's fine.

But to be safe, let me keep the reduce without initial value (which is valid for non-empty arrays) or use the explicit initial. I'll use explicit initial for clarity:

```ts
const latestSettledAt =
  statement.length > 0
    ? statement.reduce(
        (max, s) => (s.settled_at.getTime() > max.getTime() ? s.settled_at : max),
        statement[0].settled_at,
      )
    : window.to;
```

This is clear and safe. Good.

Let me finalize. I think the code is complete and correct. Let me write it out one final time, cleanly.

Actually, I realize I should double-check: does the plan want `reconcile` to handle the case where the same order appears for multiple dates? No — each order has one effective_date, so it appears in exactly one date's batch. No double-processing. ✓

And overlapping windows: if two reconcile runs cover the same date, the second run would find the orders already in their final state (settled, pending, or manual_review) and not in `sent`, so it wouldn't re-process them. Wait — if the first run set an order to `pending` (proven absent), and the second run also processes that date, the order is now `pending`, not `sent`, so it's filtered out. ✓ If the first run set it to `settled`, it's filtered out. ✓ If `manual_review`, filtered out. ✓ So overlapping windows are safe. ✓

But what if the first run set it to `pending`, and then executePayments re-sends it (back to `sent`), and then the second reconcile run processes the date? The order is `sent` again, and if it's still not in the statement (because the re-send also timed out), it would be proven absent again and go back to `pending` (or manual_review if attempts >= 5). This is correct behavior — it's a new send that needs to be reconciled. ✓

Great, the logic is sound.

Let me also verify: the plan says "Must be safe to run every 15 minutes, including over overlapping windows." My implementation is idempotent per the analysis above. ✓

I'm confident. Final answer below.

Let me reconsider the ASSUMPTION comment placement and wording once more. The instructions say "mark it with one // ASSUMPTION: <what was unresolved> comment at the point it matters." The point it matters is where I do the DB writes in reconcile (where a transaction would be). My comment is right before the loop that does the writes. That's the right place.

The wording: "the plan calls for a Prisma transaction per effectiveDate batch, but PayoutRepository exposes no transaction API and the service must not touch Prisma directly; state writes are issued sequentially per date, which preserves the idempotent state-machine guarantees the plan relies on for overlapping-window safety."

This is clear and explains both the gap and why my reading is defensible. Good.

One concern: is this truly a "symbol genuinely absent from both the plan and the references"? The plan mentions transactions (in prose), but the repository interface (reference) has no transaction method. And the service can't use prisma (per layer rules). So yes, a transaction capability is genuinely absent. My reading (sequential writes) is the most defensible given the constraints. The ASSUMPTION comment is appropriate.

Final code is ready. Let me output it.
```

## reply

```ts
import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";

import type { BankClient, BankSendResponse, SendClassification } from "./bank-client";
import type { PayoutRepository } from "./payout.repository";
import {
  InsufficientAttemptsError,
  type PayoutResult,
  type ReconcileResult,
  type ReconcileWindow,
} from "./payout.types";

const PUBLISHING_LAG_MS = 30 * 60 * 1000;
const MAX_SEND_ATTEMPTS = 5;

@Injectable()
export class PayoutService {
  constructor(
    private readonly repo: PayoutRepository,
    private readonly bank: BankClient,
  ) {}

  async executePayments(): Promise<PayoutResult[]> {
    const pendingOrders = await this.repo.findPendingOrders();
    const results: PayoutResult[] = [];

    for (const order of pendingOrders) {
      // Defensive cap guard: reconciliation only ever reverts an order to
      // "pending" while send_attempts < MAX_SEND_ATTEMPTS, so this should be
      // unreachable; it exists to fail loudly if that invariant is ever broken.
      if (order.send_attempts >= MAX_SEND_ATTEMPTS) {
        throw new InsufficientAttemptsError(order.id);
      }

      // Atomic pending -> sent claim; null means another run won the race.
      const claimed = await this.repo.claimOrder(order.id);
      if (claimed === null) {
        continue;
      }

      let classification: SendClassification;
      let rawResponse: string;
      try {
        const resp = await this.bank.send({
          txid: claimed.txid,
          amount_cents: claimed.amount_cents,
          key: claimed.supplier_key,
        });
        classification = this.classifyResponse(resp);
        rawResponse = JSON.stringify(resp);
      } catch (err) {
        // Unclassifiable transport failure: the bank may or may not have
        // received the payment, so treat it as transient and let reconciliation
        // decide. The attempt was already counted by the claim above.
        classification = "transient_error";
        rawResponse = JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        });
      }

      switch (classification) {
        case "duplicate":
          // The bank already has it; terminal.
          await this.repo.updateState(claimed.id, "settled");
          break;
        case "permanent_rejection":
          // Terminal; never auto-revert, never re-send.
          await this.repo.updateState(claimed.id, "rejected");
          break;
        case "accepted":
        case "transient_error":
          // State remains "sent" as set by the atomic claim; reconciliation
          // will either confirm settlement or prove absence.
          break;
      }

      await this.repo.createSendEvent(claimed.id, claimed.txid, classification, rawResponse);

      results.push({
        order_id: claimed.id,
        txid: claimed.txid,
        classification,
      });
    }

    return results;
  }

  async reconcile(window: ReconcileWindow): Promise<ReconcileResult> {
    const now = new Date();
    let matchedCount = 0;

    // ASSUMPTION: the plan calls for a Prisma transaction per effectiveDate batch, but PayoutRepository exposes no transaction API and the service must not touch Prisma directly; state writes are issued sequentially per date, which preserves the idempotent state-machine guarantees the plan relies on for overlapping-window safety.
    for (const dateStr of this.eachUtcDayInWindow(window.from, window.to)) {
      const orders = await this.repo.findOrdersByEffectiveDate(dateStr);
      if (orders.length === 0) {
        continue;
      }

      const statement = await this.bank.getStatement(dateStr);

      const latestSettledAt =
        statement.length > 0
          ? statement.reduce(
              (max, s) => (s.settled_at.getTime() > max.getTime() ? s.settled_at : max),
              statement[0].settled_at,
            )
          : window.to;

      // The statement is only authoritative once the publishing lag has passed.
      if (latestSettledAt.getTime() + PUBLISHING_LAG_MS > now.getTime()) {
        continue;
      }

      const settledTxids = new Set(statement.map((s) => s.txid));
      const sentOrders = orders.filter((o) => o.state === "sent");

      for (const order of sentOrders) {
        if (settledTxids.has(order.txid)) {
          // Timeout-but-settled: the bank has it; terminal. No resend.
          await this.repo.updateState(order.id, "settled");
          matchedCount += 1;
        } else if (order.send_attempts < MAX_SEND_ATTEMPTS) {
          // Proven absent: safe to re-send with the same txid on
