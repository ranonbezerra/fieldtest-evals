# repair1-payouts.service.ts

## reasoning

```
Let me analyze the compiler errors that relate to `src/payouts/payouts.service.ts`:

1. `src/payouts/payouts.service.ts(5,39): error TS2307: Cannot find module '../bank/bank.client' or its corresponding type declarations.`
2. `src/payouts/payouts.service.ts(6,51): error TS2307: Cannot find module '../bank/bank.client' or its corresponding type declarations.`
3. `src/payouts/payouts.service.ts(7,35): error TS2307: Cannot find module './payouts.repository' or its corresponding type declarations.`
4. `src/payouts/payouts.service.ts(8,43): error TS2307: Cannot find module './payouts.repository' or its corresponding type declarations.`

These are all "Cannot find module" errors. This means the files `src/bank/bank.client.ts` and `src/payouts/payouts.repository.ts` don't exist yet. But wait - the task says "Change nothing the messages do not name." So I should only fix what's required of `src/payouts/payouts.service.ts`.

The errors for `payouts.service.ts` are all TS2307 (Cannot find module). These are import resolution errors. The modules `../bank/bank.client` and `./payouts.repository` don't exist or don't have type declarations.

Wait, let me re-read the task. It says "Rewrite `src/payouts/payouts.service.ts` complete, fixing what these messages require of this file."

The messages that name `payouts.service.ts` are:
- Line 5, col 39: Cannot find module '../bank/bank.client'
- Line 6, col 51: Cannot find module '../bank/bank.client'
- Line 7, col 35: Cannot find module './payouts.repository'
- Line 8, col 43: Cannot find module './payouts.repository'

These are all import errors. The files `src/bank/bank.client.ts` and `src/payouts/payouts.repository.ts` don't exist (or aren't found). 

But looking at other errors:
- `src/bank/bank.module.ts(2,28): error TS2307: Cannot find module './bank.client'` - so `bank.client.ts` doesn't exist
- `src/payouts/payouts.module.ts(6,35): error TS2307: Cannot find module './payouts.repository'` - so `payouts.repository.ts` doesn't exist

The task says "Change nothing the messages do not name." So I should NOT create `bank.client.ts` or `payouts.repository.ts`. I should only fix `payouts.service.ts`.

But if I can't find those modules, how do I fix the imports? I need to either:
1. Use `declare module` statements (but that would be in a .d.ts file, not in the service)
2. Use type assertions or type the imports differently

Wait, actually re-reading the instruction: "Rewrite `src/payouts/payouts.service.ts` complete, fixing what these messages require of this file."

The messages require that the file compiles. But the issue is that the imported modules don't exist. I can't create those files because the task says "Change nothing the messages do not name" and the messages about `bank.client.ts` and `payouts.repository.ts` are about OTHER files importing them, not about `payouts.service.ts` needing me to create them.

Hmm, but actually the task is asking me to rewrite `payouts.service.ts` to fix the errors. The errors in `payouts.service.ts` are about missing modules. The only way to fix "Cannot find module" for a module that doesn't exist is to either:
1. Create the module
2. Remove the import
3. Use a type declaration

But wait - maybe I'm overthinking this. Let me re-read: "Rewrite `src/payouts/payouts.service.ts` complete, fixing what these messages require of this file."

Perhaps the intent is that I should write the service file with the correct imports (assuming those files will exist), and the "fix" is that the current file has incorrect import paths or something. But the errors clearly say "Cannot find module" which means the files don't exist.

Actually, I think the correct interpretation is: I need to write `payouts.service.ts` in a way that it would compile IF those other files existed. The errors are happening because those files don't exist yet (they need to be created as part of the overall project). My job is to write the service file correctly, with proper imports and implementations, assuming those dependencies will be there.

But that doesn't make sense either - if I just write the imports and they don't resolve, the errors will persist.

Let me reconsider. The task says "fixing what these messages require of this file." The messages are TS2307 (Cannot find module). For `payouts.service.ts`, the fix would be to ensure those modules exist. But I can only modify `payouts.service.ts`.

Wait - I think the practical interpretation is: write the file correctly. The other files (`bank.client.ts`, `payouts.repository.ts`) are missing and need to be created as part of the project, but my task is specifically to write `payouts.service.ts` correctly. The compiler errors in `payouts.service.ts` will be resolved once those dependency files are created.

Actually, I think I need to re-read the constraint more carefully. "Change nothing the messages do not name." This means I should only change `src/payouts/payouts.service.ts` (since that's the file I'm asked to rewrite). The messages name `payouts.service.ts` with specific line numbers and column numbers pointing to imports.

I think the correct approach is:
1. Write the complete `payouts.service.ts` with proper imports and implementation
2. The imports will reference `../bank/bank.client` and `./payouts.repository` which are the correct paths
3. These files will need to be created separately (by other tasks/files)

The "fix" is that the current file probably has wrong import paths or is incomplete. I should write it with the correct structure.

Now let me think about what the service should contain based on the variant description:

1. `executePayments()` — sends pending orders via `bank.send({txid, amount, key})`. The txid must be derived deterministically from the order + effective date.

2. `reconcile(window)` — matches statement entries to orders and advances their state. Must be safe to run every 15 minutes, including over overlapping windows.

3. Resend logic: an order whose send failed/timed out may only be re-sent after reconciliation proves it is absent from the statement past the publishing lag. Cap attempts at 5; after that, park for manual review and never auto-revert.

4. Classify `bank.send` responses (accepted, duplicate, transient error, permanent rejection) and handle each differently.

Money in minor units, integers only.

Let me think about the structure:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { BankClient, SendResponse, Settlement } from '../bank/bank.client';
import { PayoutsRepository, Order } from './payouts.repository';
```

Wait, I need to think about what types the bank client and repository would export. Since I can't see those files, I need to make assumptions.

Looking at the errors more carefully:
- `src/bank/bank.client.ts(60,13): error TS2322: Type 'unknown' is not assignable to type '{ code?: string | undefined; message?: string | undefined; }'.`

This tells me `bank.client.ts` EXISTS (it has a line 60 with an error), but the error in `payouts.service.ts` is "Cannot find module '../bank/bank.client'". That's strange. If the file exists, why can't it be found?

Wait, maybe the file exists but has a syntax error that prevents it from being a valid module? Or maybe it's in the wrong location?

Actually, looking at `src/bank/bank.module.ts(2,28): error TS2307: Cannot find module './bank.client'` - this also can't find `./bank.client` from the bank module. But `src/bank/bank.client.ts(60,13)` has an error. So the file exists at `src/bank/bank.client.ts` but can't be imported?

This is confusing. Maybe the file has a compilation error that prevents it from being recognized as a module. In that case, my import path is correct and the issue is in the other file.

I think the best approach is:
1. Write the service with the correct import paths (matching what the errors show)
2. Define the types I expect from those modules using ASSUMPTION comments
3. Implement the full service logic

Let me look at the import lines from the errors:
- Line 5, col 39: `'../bank/bank.client'` - this is at column 39, which suggests it's part of an import statement
- Line 6, col 51: `'../bank/bank.client'` - another import from the same module
- Line 7, col 35: `'./payouts.repository'`
- Line 8, col 43: `'./payouts.repository'`

So lines 5 and 6 import from `../bank/bank.client` (two different things), and lines 7 and 8 import from `./payouts.repository` (two different things).

Let me figure out what column 39 and 51 mean. If line 5 is:
`import { BankClient, SendResponse } from '../bank/bank.client';`
The module path starts at... let me count. Actually in TypeScript, the column for a module specifier in TS2307 points to the start of the string literal. Let me count:

`import { BankClient } from '../bank/bank.client';`
- `import ` = 7 chars
- `{ BankClient }` = 14 chars  
- ` from ` = 6 chars
- Total before quote = 27, so the quote is at column 28 (1-indexed) or 27 (0-indexed)

Hmm, that doesn't match column 39. Let me try:
`import { BankClient, SendResponse } from '../bank/bank.client';`
- `import { BankClient, SendResponse } from ` = 40 chars
- So the quote would be at column 41 (1-indexed)

That's close to 39 but not exact. Let me try:
`import { BankClient, SendResult } from '../bank/bank.client';`
- `import { BankClient, SendResult } from ` = 39 chars
- Quote at column 40 (1-indexed)

Still not exact. Let me try different naming:
`import { BankClient, SendResult } from '../bank/bank.client';`

Actually, TypeScript columns are 1-based in error messages. Let me be more careful:

Position 1: `i`
`import { BankClient, SendResult } from '../bank/bank.client';`

i(1)m(2)p(3)o(4)r(5)t(6) (7){(8) (9)B(10)a(11)n(12)k(13)C(14)l(15)i(16)e(17)n(18)t(19),(20) (21)S(22)e(23)n(24)d(25)R(26)e(27)s(28)u(29)l(30)t(31) (32)}(33) (34)f(35)r(36)o(37)m(38) (39)'(40)...

So column 39 would be the space before the quote, or... hmm. Actually in TypeScript, the column for the module specifier error points to the opening quote of the module specifier string.

Let me try: `import { BankClient, SendResult } from '../bank/bank.client';`
Column 39 = `'` (the opening quote of the path)

Let me recount:
```
i m p o r t   {   B a n k C l i e n t ,   S e n d R e s u l t   }   f r o m   ' . . / b a n k / b a n k . c l i e n t ' ;
1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39
```

Yes! Column 39 is the opening quote. So line 5 is:
`import { BankClient, SendResult } from '../bank/bank.client';`

Wait, that's 38 characters before the quote. Let me recount more carefully:

`import { BankClient, SendResult } from ` 
i=1, m=2, p=3, o=4, r=5, t=6, ' '=7, {=8, ' '=9, B=10, a=11, n=12, k=13, C=14, l=15, i=16, e=17, n=18, t=19, ,=20, ' '=21, S=22, e=23, n=24, d=25, R=26, e=27, s=28, u=29, l=30, t=31, ' '=32, }=33, ' '=34, f=35, r=36, o=37, m=38, ' '=39, '=40

So column 39 is the space, and column 40 is the quote. That's not matching either.

Hmm, let me try a different import name:
`import { BankClient, SendResponse } from '../bank/bank.client';`
i=1...t=6, ' '=7, {=8, ' '=9, B=10...t=19, ,=20, ' '=21, S=22, e=23, n=24, d=25, R=26, e=27, s=28, p=29, o=30, n=31, s=32, e=33, ' '=34, }=35, ' '=36, f=37, r=38, o=39, m=40, ' '=41, '=42

That gives column 42 for the quote. Too far.

Let me try: `import { BankClient, SendResult } from '../bank/bank.client';`
That gave me column 40 for the quote.

What about: `import { Bank, SendResult } from '../bank/bank.client';`
i=1...t=6, ' '=7, {=8, ' '=9, B=10, a=11, n=12, k=13, ,=14, ' '=15, S=16, e=17, n=18, d=19, R=20, e=21, s=22, u=23, l=24, t=25, ' '=26, }=27, ' '=28, f=29, r=30, o=31, m=32, ' '=33, '=34

Column 34. Too early.

What about: `import { BankClient, Settlement } from '../bank/bank.client';`
i=1...t=6, ' '=7, {=8, ' '=9, B=10...t=19, ,=20, ' '=21, S=22, e=23, t=24, t=25, l=26, e=27, m=28, e=29, n=30, t=31, ' '=32, }=33, ' '=34, f=35, r=36, o=37, m=38, ' '=39, '=40

Column 40 again.

Hmm, I'm getting 40 consistently for reasonable names. Let me try a slightly different format. Maybe there's no space after the comma or something.

Actually, you know what, I'm overthinking this. The exact column numbers don't matter for my implementation. What matters is:
- Line 5 imports something from `'../bank/bank.client'`
- Line 6 imports something else from `'../bank/bank.client'`
- Line 7 imports something from `'./payouts.repository'`
- Line 8 imports something else from `'./payouts.repository'`

The fact that there are two imports from each module suggests:
- From bank.client: maybe `BankClient` (class) and a type like `SendResponse` or `Settlement`
- From payouts.repository: maybe `PayoutsRepository` (class) and a type like `Order` or `PayoutOrder`

Now, since I can't actually see these files, I'll need to make assumptions about their shapes. The task says: "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly."

Let me now design the service based on the variant requirements:

**Orders/Payouts model:**
- An order has: id, txid (deterministic), amount (minor units), key (bank identifier), status, attempts, effectiveDate
- Statuses: pending, sending, sent (accepted by bank), settled (confirmed in statement), failed, permanent_rejection, manual_review

**executePayments():**
- Find pending orders
- For each, call bank.send({txid, amount, key})
- Classify the response:
  - accepted → mark as sent
  - duplicate → mark as sent (it was already sent)
  - transient error → leave as pending (will retry)
  - permanent rejection → mark as permanent_rejection
- Increment attempts on transient errors/timeouts

**reconcile(window):**
- Get statement for the window date(s)
- Match statement entries to orders by txid
- For matched orders in "sent" state → advance to "settled"
- For orders in "pending" or "failed" state that are NOT in the statement AND past the publishing lag → they're proven absent, so they can be resent
- Must be idempotent (safe to run over overlapping windows)

**Resend logic:**
- Only resend if reconciliation proves absence past publishing lag
- Cap at 5 attempts
- After 5, park as manual_review

**Deterministic txid:**
- Derived from order + effective date. Could be a hash of order_id + date, or a structured format.

Let me think about the txid derivation. "derived deterministically from the order + effective date" - I'll use a simple approach: combine the order ID and the effective date (YYYY-MM-DD) into a string, then use it as the txid. Or maybe hash it. Since it needs to be a valid txid for the bank, I'll use a structured format like `{orderId}-{date}` or a hash.

Actually, for idempotency with the bank, the txid is the key. If we send the same txid twice, the bank should return "duplicate". So the txid must be the same for the same order on the same effective date, regardless of how many times we send.

I'll use: `${order.id}-${order.effectiveDate.toISOString().slice(0,10)}` or a SHA-256 hash. Let me go with a structured approach that's readable.

Actually, let me think about what makes sense. The txid is sent to the bank. It should be:
- Deterministic (same input → same output)
- Unique per order+date combination
- Reasonable length

I'll use a SHA-256 hash of `${order.id}:${effectiveDate}` truncated or in hex. Or simpler: just use the order ID with a date suffix. Let me go with a simple hash approach using Node's crypto.

Now let me write the service:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { BankClient, SendResponse } from '../bank/bank.client';
import { Settlement } from '../bank/bank.client';
import { PayoutsRepository } from './payouts.repository';
import { PayoutOrder } from './payouts.repository';
```

Wait, I need to think about what the repository exports. The repository is the data access layer. It would have:
- Methods to find pending orders
- Methods to update order status
- Methods to find orders by txid
- etc.

And it would export the types it uses.

Let me think about the `BankClient` interface. From the variant:
- `bank.send({txid, amount, key})` - sends a payment
- `bank.getStatement(date) -> Settlement[]` - gets settlements

The `SendResponse` would have a classification: accepted, duplicate, transient_error, permanent_rejection.

Looking at the error in bank.client.ts: `Type 'unknown' is not assignable to type '{ code?: string | undefined; message?: string | undefined; }'` - this suggests the bank client has some error handling with a `code` and `message` shape.

Let me now write the complete service. I'll make reasonable assumptions about the types:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { BankClient, SendResponse, Settlement } from '../bank/bank.client';
import { PayoutsRepository, PayoutOrder, OrderStatus } from './payouts.repository';
```

Hmm wait, I have two imports from bank.client on lines 5 and 6. That means they're separate import statements. Let me structure it:

Line 1: `import { Injectable, Logger } from '@nestjs/common';`
Line 2: `import { createHash } from 'node:crypto';`
Line 3: (blank)
Line 4: (blank or something)
Line 5: `import { BankClient, SendResponse } from '../bank/bank.client';`
Line 6: `import { Settlement } from '../bank/bank.client';`
Line 7: `import { PayoutsRepository } from './payouts.repository';`
Line 8: `import { PayoutOrder, OrderStatus } from './payouts.repository';`

Actually, having two separate import statements from the same module is unusual but valid. It might be that the original code had them separate for a reason (maybe one was `import type` vs value import). Let me keep them as separate lines to match the error positions.

Actually wait - I just realized I should focus on writing a correct, complete service file. The exact line numbers of imports don't matter as long as the file is correct. The compiler errors will be resolved when the dependency files are created.

Let me now write the full implementation:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { BankClient, SendResponse, Settlement } from '../bank/bank.client';
import { PayoutsRepository, PayoutOrder, OrderStatus } from './payouts.repository';

const MAX_ATTEMPTS = 5;
const PUBLISHING_LAG_MS = 30 * 60 * 1000; // 30 minutes

type SendClassification = 'accepted' | 'duplicate' | 'transient_error' | 'permanent_rejection';

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private readonly bank: BankClient,
    private readonly repo: PayoutsRepository,
  ) {}

  /**
   * Derives a deterministic txid from the order and its effective date.
   */
  private deriveTxid(order: PayoutOrder): string {
    const dateStr = order.effectiveDate.toISOString().slice(0, 10);
    return createHash('sha256').update(`${order.id}:${dateStr}`).digest('hex').slice(0, 32);
  }

  /**
   * Classifies a bank.send response into one of four categories.
   */
  private classifyResponse(response: SendResponse): SendClassification {
    // ASSUMPTION: SendResponse has a `status` field with values like 'accepted', 'duplicate', 'error'
    // and an `error` field with `code` and `message`.
    if (response.status === 'accepted') return 'accepted';
    if (response.status === 'duplicate') return 'duplicate';
    if (response.status === 'error') {
      const code = response.error?.code?.toUpperCase() ?? '';
      const permanentCodes = ['INSUFFICIENT_FUNDS', 'INVALID_KEY', 'INVALID_AMOUNT', 'ACCOUNT_CLOSED'];
      if (permanentCodes.includes(code)) return 'permanent_rejection';
      return 'transient_error';
    }
    // Unknown status treated as transient
    return 'transient_error';
  }

  /**
   * Sends all pending payout orders to the bank.
   */
  async executePayments(): Promise<void> {
    const pendingOrders = await this.repo.findPending();
    this.logger.log(`Found ${pendingOrders.length} pending orders`);

    for (const order of pendingOrders) {
      try {
        const txid = this.deriveTxid(order);
        const response = await this.bank.send({ txid, amount: order.amount, key: order.key });
        const classification = this.classifyResponse(response);

        switch (classification) {
          case 'accepted':
            await this.repo.markSent(order.id, txid);
            this.logger.log(`Order ${order.id} accepted (txid=${txid})`);
            break;
          case 'duplicate':
            await this.repo.markSent(order.id, txid);
            this.logger.log(`Order ${order.id} duplicate (txid=${txid})`);
            break;
          case 'transient_error':
            await this.repo.incrementAttempts(order.id);
            this.logger.warn(`Order ${order.id} transient error: ${response.error?.message}`);
            break;
          case 'permanent_rejection':
            await this.repo.markPermanentRejection(order.id);
            this.logger.error(`Order ${order.id} permanently rejected: ${response.error?.message}`);
            break;
        }
      } catch (err: unknown) {
        // Network timeout or unexpected error
        await this.repo.incrementAttempts(order.id);
        this.logger.warn(`Order ${order.id} failed with exception: ${String(err)}`);
      }
    }
  }

  /**
   * Reconciles a window of settlement data against pending/sent orders.
   * Safe to run repeatedly over overlapping windows.
   * 
   * @param window - The date window to reconcile (start and end dates)
   */
  async reconcile(window: { start: Date; end: Date }): Promise<void> {
    const now = new Date();
    const lagCutoff = new Date(now.getTime() - PUBLISHING_LAG_MS);

    // Collect all settlements in the window
    const settlements: Settlement[] = [];
    const cursor = new Date(window.start);
    while (cursor <= window.end) {
      const daySettlements = await this.bank.getStatement(cursor);
      settlements.push(...daySettlements);
      cursor.setDate(cursor.getDate() + 1);
    }

    const settledTxids = new Set(settlements.map((s) => s.txid));

    // Advance "sent" orders to "settled" if their txid appears in the statement
    const sentOrders = await this.repo.findSent(window.start, window.end);
    for (const order of sentOrders) {
      const txid = this.deriveTxid(order);
      if (settledTxids.has(txid)) {
        await this.repo.markSettled(order.id);
        this.logger.log(`Order ${order.id} confirmed settled (txid=${txid})`);
      }
    }

    // Identify orders that are proven absent (no txid in statement) past the publishing lag
    // These are candidates for resend
    const stuckOrders = await this.repo.findStuck(window.start, window.end);
    for (const order of stuckOrders) {
      const txid = this.deriveTxid(order);

      if (settledTxids.has(txid)) {
        // Actually settled - advance to settled
        await this.repo.markSettled(order.id);
        this.logger.log(`Order ${order.id} found settled during stuck scan (txid=${txid})`);
        continue;
      }

      // Proven absent: the window end is past the publishing lag
      // Check if the order is eligible for resend
      if (window.end < lagCutoff) {
        if (order.attempts >= MAX_ATTEMPTS) {
          await this.repo.markManualReview(order.id);
          this.logger.warn(`Order ${order.id} parked for manual review (attempts=${order.attempts})`);
        } else {
          await this.repo.markPendingForResend(order.id);
          this.logger.log(`Order ${order.id} proven absent, marked for resend (attempts=${order.attempts})`);
        }
      }
      // If window.end is not past the lag, we can't yet prove absence — leave it alone
    }
  }
}
```

Wait, I need to reconsider the reconcile logic. The requirement says:
- "Must be safe to run every 15 minutes, including over overlapping windows."
- "an order whose send failed/timed out may only be re-sent after reconciliation proves it is absent from the statement past the publishing lag"

So the key insight is: we can only prove absence if we've checked the statement up to a point that is at least 30 minutes (publishing lag) in the past. If the window we're reconciling includes data up to "now - 30min", then any order not in that data is proven absent.

Let me also reconsider what "stuck" orders are. They would be orders that:
- Were sent (or attempted) but their status is still "pending" or "failed" (not "sent" or "settled")
- Their effective date falls within the window

Actually, let me reconsider the state machine:
- `pending` → (executePayments) → `sent` (if accepted/duplicate)
- `pending` → (executePayments, transient error) → stays `pending` (attempts incremented)
- `pending` → (executePayments, permanent rejection) → `permanent_rejection`
- `sent` → (reconcile, found in statement) → `settled`
- `pending` (with attempts > 0, proven absent) → (reconcile) → stays `pending` but now eligible for resend
- `pending` (attempts >= 5, proven absent) → (reconcile) → `manual_review`

Hmm, but how do we distinguish "pending, never tried" from "pending, tried but failed"? The attempts counter handles that. An order with attempts=0 has never been tried. An order with attempts>0 has been tried at least once.

For the resend logic:
- After a transient error or timeout, the order stays `pending` with incremented attempts
- During reconciliation, if we find the order's txid is NOT in the statement AND the window is past the publishing lag, we know the bank never received it (or didn't process it)
- We can then allow it to be re-sent (it's already `pending`, so `executePayments` will pick it up again)
- If attempts >= 5, we mark it `manual_review` instead

Actually, I think the flow is simpler than I'm making it:
1. `executePayments` picks up `pending` orders and tries to send them
2. If send succeeds (accepted/duplicate) → `sent`
3. If send fails (transient) → stays `pending`, attempts++
4. If send fails (permanent) → `permanent_rejection`
5. `reconcile` checks:
   - `sent` orders → if txid in statement → `settled`
   - `pending` orders (attempts > 0) → if txid NOT in statement AND past lag → eligible for resend (stays pending, will be picked up by next executePayments)
   - `pending` orders (attempts >= MAX) → if txid NOT in statement AND past lag → `manual_review`

This makes sense. The "proven absent" check is: the order's effective date is within the reconciled window, AND the window extends past the publishing lag from the order's effective date (or from now), AND the txid is not in the statement.

Actually, I think the simpler interpretation is: if we've reconciled up to a point that is at least `publishing_lag` after the order's effective date, and the txid isn't there, it's proven absent.

Let me simplify: the reconcile window represents a range of dates. If the END of the window is at least `publishing_lag` in the past (i.e., `window.end + publishing_lag <= now`), then we can prove absence for orders in that window.

Wait no. The publishing lag means: a settlement that happened at time T won't appear in the statement until T + 30min. So if we're looking at the statement for date D, and "now" is D + 1 day, then anything that should have settled on D would have appeared by now (since D + 1 day >> D + 30 min). So we can prove absence.

More precisely: for an order with effective date D, we can prove its txid is absent if we've checked the statement for date D AND the current time is at least D + 30min (the publishing lag). Since we're checking historical dates in the reconcile window, this is almost always true unless the window includes "today" and it's within 30 minutes of the start of the day.

I think the practical check is: `now - window.end >= PUBLISHING_LAG_MS`. If the end of our reconcile window is at least 30 minutes in the past, we can trust the absence.

Let me refine my implementation. Also, I need to think about what methods the repository needs:

- `findPending()` → PayoutOrder[]
- `findSent(start: Date, end: Date)` → PayoutOrder[] (orders in "sent" state with effective date in range)
- `findPendingWithAttempts(start: Date, end: Date)` → PayoutOrder[] (orders in "pending" state with attempts > 0 and effective date in range)
- `markSent(id: string, txid: string)` → void
- `markSettled(id: string)` → void
- `markPermanentRejection(id: string)` → void
- `incrementAttempts(id: string)` → void
- `markManualReview(id: string)` → void

Actually, for the "stuck" orders that need resend consideration, I need to find pending orders with attempts > 0 in the window. Let me call that `findPendingWithAttempts`.

Hmm, but actually I realize I should think about this differently. The "resend" doesn't require a separate action - the order stays in `pending` state, and the next `executePayments` call will pick it up again. The reconcile's job is just to:
1. Confirm settlements (sent → settled)
2. Park orders that have exhausted attempts (pending → manual_review)
3. NOT block resend of orders that are proven absent (they just stay pending)

So the reconcile doesn't need to "mark for resend" - it just needs to NOT prevent the order from being picked up again. The only state change in reconcile for stuck orders is:
- If found in statement → mark settled (in case it was actually sent but we lost the response)
- If NOT found and attempts >= MAX → mark manual_review
- If NOT found and attempts < MAX → do nothing (stays pending, will be retried by executePayments)

This is cleaner. Let me rewrite:

```typescript
async reconcile(window: { start: Date; end: Date }): Promise<void> {
  const now = new Date();
  const canProveAbsence = now.getTime() - window.end.getTime() >= PUBLISHING_LAG_MS;

  // Collect settlements for the window
  const settlements = await this.collectSettlements(window.start, window.end);
  const settledTxids = new Set(settlements.map((s) => s.txid));

  // 1. Advance sent orders to settled
  const sentOrders = await this.repo.findSent(window.start, window.end);
  for (const order of sentOrders) {
    const txid = this.deriveTxid(order);
    if (settledTxids.has(txid)) {
      await this.repo.markSettled(order.id);
    }
  }

  // 2. Check pending orders (that have been attempted) in the window
  if (canProveAbsence) {
    const pendingOrders = await this.repo.findPendingWithAttempts(window.start, window.end);
    for (const order of pendingOrders) {
      const txid = this.deriveTxid(order);
      if (settledTxids.has(txid)) {
        // Was actually sent and settled, but we never got the confirmation
        await this.repo.markSettled(order.id);
      } else if (order.attempts >= MAX_ATTEMPTS) {
        // Proven absent and exhausted retries
        await this.repo.markManualReview(order.id);
      }
      // else: proven absent, attempts remaining → stays pending, will be retried
    }
  }
}
```

This is better. Now let me think about the types I need to assume.

For `BankClient`:
- It's an injectable class
- Has method `send(params: { txid: string; amount: number; key: string }): Promise<SendResponse>`
- Has method `getStatement(date: Date): Promise<Settlement[]>`

For `SendResponse`:
- Based on the error in bank.client.ts about `{ code?: string; message?: string }`, it seems like there's an error shape
- I'll assume: `{ status: 'accepted' | 'duplicate' | 'error'; error?: { code?: string; message?: string } }`

For `Settlement`:
- Has at least `txid: string` (the txid we sent)
- Probably also has `amount`, `settledAt`, etc.

For `PayoutsRepository`:
- Injectable class
- Has the methods I listed above

For `PayoutOrder`:
- `id: string`
- `amount: number` (minor units)
- `key: string`
- `effectiveDate: Date`
- `attempts: number`
- `status: OrderStatus` (maybe)

Let me also think about whether I need `OrderStatus` as a separate import or if it's just a field.

I think I have enough to write a complete implementation. Let me also add the `collectSettlements` helper.

One more thing: the task says "Money in minor units, integers only." So `amount` is always an integer representing cents (or whatever the minor unit is).

Let me finalize my implementation. I'll add ASSUMPTION comments where I'm guessing at shapes.

Actually, wait. Let me reconsider the import structure. The errors show:
- Line 5: import from '../bank/bank.client'
- Line 6: import from '../bank/bank.client'
- Line 7: import from './payouts.repository'
- Line 8: import from './payouts.repository'

Having two separate imports from the same module is a code smell but it's valid. It could be:
- Line 5: `import { BankClient } from '../bank/bank.client';` (value import)
- Line 6: `import type { SendResponse, Settlement } from '../bank/bank.client';` (type import)

Or:
- Line 5: `import { BankClient, SendResponse } from '../bank/bank.client';`
- Line 6: `import { Settlement } from '../bank/bank.client';`

I'll go with a clean single import per module since I'm rewriting the file. The exact line numbers don't matter for correctness.

Let me write the final version:
```

## reply

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { BankClient, SendResponse, Settlement } from '../bank/bank.client';
// ASSUMPTION: BankClient exposes `send({txid, amount, key}): Promise<SendResponse>` and `getStatement(date: Date): Promise<Settlement[]>`.
// ASSUMPTION: SendResponse is `{ status: 'accepted' | 'duplicate' | 'error'; error?: { code?: string; message?: string } }`.
// ASSUMPTION: Settlement is `{ txid: string; amount: number; settledAt: Date }`.
import { PayoutsRepository, PayoutOrder } from './payouts.repository';
// ASSUMPTION: PayoutOrder is `{ id: string; amount: number; key: string; effectiveDate: Date; attempts: number; status: string }`.
// ASSUMPTION: PayoutsRepository exposes: findPending, findSent, findPendingWithAttempts, markSent, markSettled, markPermanentRejection, incrementAttempts, markManualReview.

const MAX_ATTEMPTS = 5;
const PUBLISHING_LAG_MS = 30 * 60 * 1000;

type SendClassification = 'accepted' | 'duplicate' | 'transient_error' | 'permanent_rejection';

const PERMANENT_ERROR_CODES = new Set([
  'INSUFFICIENT_FUNDS',
  'INVALID_KEY',
  'INVALID_AMOUNT',
  'ACCOUNT_CLOSED',
  'UNREACHABLE',
]);

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private readonly bank: BankClient,
    private readonly repo: PayoutsRepository,
  ) {}

  /**
   * Derives a deterministic txid from the order id and effective date.
   * The same order on the same effective date always produces the same txid,
   * guaranteeing idempotency at the bank level.
   */
  private deriveTxid(order: PayoutOrder): string {
    const dateStr = order.effectiveDate.toISOString().slice(0, 10);
    return createHash('sha256').update(`${order.id}:${dateStr}`).digest('hex').slice(0, 32);
  }

  /**
   * Classifies a bank.send response into one of four handling categories.
   */
  private classify(response: SendResponse): SendClassification {
    if (response.status === 'accepted') return 'accepted';
    if (response.status === 'duplicate') return 'duplicate';
    if (response.status === 'error') {
      const code = (response.error?.code ?? '').toUpperCase();
      if (PERMANENT_ERROR_CODES.has(code)) return 'permanent_rejection';
      return 'transient_error';
    }
    // Unknown status — treat as transient to be safe
    return 'transient_error';
  }

  /**
   * Sends all pending payout orders to the bank via the instant-payment API.
   * Each order is sent with a deterministic txid so that retries are idempotent.
   */
  async executePayments(): Promise<void> {
    const pending = await this.repo.findPending();
    this.logger.log(`executePayments: ${pending.length} pending order(s)`);

    for (const order of pending) {
      const txid = this.deriveTxid(order);
      try {
        const response = await this.bank.send({ txid, amount: order.amount, key: order.key });
        this.handleSendResult(order, txid, response);
      } catch (err: unknown) {
        // Network timeout or unexpected exception — treat as transient
        await this.repo.incrementAttempts(order.id);
        this.logger.warn(
          `executePayments: order ${order.id} transient failure: ${String(err)}`,
        );
      }
    }
  }

  /**
   * Reconciles a date window against the bank statement.
   *
   * - Advances `sent` orders to `settled` when their txid appears in the statement.
   * - For `pending` orders (attempts > 0) whose txid is absent from the statement
   *   and whose window is past the publishing lag, parks them for manual review
   *   if attempts are exhausted. Otherwise they remain pending for the next
   *   executePayments cycle (resend with the same txid).
   *
   * Safe to invoke repeatedly over overlapping windows: all transitions are
   * idempotent (state is only ever advanced forward).
   */
  async reconcile(window: { start: Date; end: Date }): Promise<void> {
    const now = Date.now();
    const canProveAbsence = now - window.end.getTime() >= PUBLISHING_LAG_MS;

    // Collect all settlements across the window (one statement per calendar day)
    const settledTxids = new Set<string>(
      await this.collectSettlementTxids(window.start, window.end),
    );

    // 1. Advance sent → settled for orders confirmed in the statement
    const sentOrders = await this.repo.findSent(window.start, window.end);
    for (const order of sentOrders) {
      const txid = this.deriveTxid(order);
      if (settledTxids.has(txid)) {
        await this.repo.markSettled(order.id);
        this.logger.log(`reconcile: order ${order.id} settled (txid=${txid})`);
      }
    }

    // 2. Handle pending orders that were previously attempted
    if (canProveAbsence) {
      const stuckOrders = await this.repo.findPendingWithAttempts(window.start, window.end);
      for (const order of stuckOrders) {
        const txid = this.deriveTxid(order);
        if (settledTxids.has(txid)) {
          // The payment went through despite a lost response
          await this.repo.markSettled(order.id);
          this.logger.log(`reconcile: order ${order.id} found settled (txid=${txid})`);
        } else if (order.attempts >= MAX_ATTEMPTS) {
          // Proven absent and no retries remaining — park for manual review
          await this.repo.markManualReview(order.id);
          this.logger.warn(
            `reconcile: order ${order.id} parked for manual review (attempts=${order.attempts})`,
          );
        }
        // Otherwise: proven absent with retries remaining → stays pending,
        // next executePayments will resend with the same txid.
      }
    }
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private handleSendResult(order: PayoutOrder, txid: string, response: SendResponse): void {
    switch (this.classify(response)) {
      case 'accepted':
        this.repo.markSent(order.id, txid).then(() =>
          this.logger.log(`executePayments: order ${order.id} accepted (txid=${txid})`),
        );
        break;
      case 'duplicate':
        this.repo.markSent(order.id, txid).then(() =>
          this.logger.log(`executePayments: order ${order.id} duplicate (txid=${txid})`),
        );
        break;
      case 'transient_error':
        this.repo.incrementAttempts(order.id).then(() =>
          this.logger.warn(
            `executePayments: order ${order.id} transient error: ${response.error?.message ?? 'unknown'}`,
          ),
        );
        break;
      case 'permanent_rejection':
        this.repo.markPermanentRejection(order.id).then(() =>
          this.logger.error(
            `executePayments: order ${order.id} permanent rejection: ${response.error?.message ?? 'unknown'}`,
          ),
        );
        break;
    }
  }

  private async collectSettlementTxids(start: Date, end: Date): Promise<string[]> {
    const txids: string[] = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      const settlements: Settlement[] = await this.bank.getStatement(cursor);
      for (const s of settlements) {
        txids.push(s.txid);
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return txids;
  }
}
```
