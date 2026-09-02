# 04-payouts.service.ts

## reasoning

```
Let me analyze the PLAN.md to understand exactly what `payouts.service.ts` needs to contain.

From the plan:

**File:** `src/payouts/payouts.service.ts`

**Class:** `PayoutsService` with:
- Constructor taking `repo: PayoutsRepository` and `bank: BankClient`
- `executePayments(effectiveDate: Date): Promise<{ sent: number; rejected: number }>`
- `reconcile(date: string): Promise<ReconcileResult>`
- Private `deriveTxid(orderId: string, effectiveDate: Date): string`
- Private `isPastPublishingLag(effectiveDate: Date, now?: Date): boolean`

**Export interface:**
```ts
export interface ReconcileResult {
  date: string;
  settled: number;
  provenAbsent: number;
  parked: number;
}
```

**Control flow:**

### executePayments(effectiveDate):
1. `repo.findPending(effectiveDate)` → list of orders
2. For each order (sequentially):
   a. Compute `txid = deriveTxid(order.id, effectiveDate)`. If `order.txid` is already set, reuse it.
   b. Call `bank.send({ txid, amountCents, bankKey })`.
   c. Classify:
      - `accepted` / `duplicate` → `repo.transition(id, PENDING, IN_FLIGHT, { txid, attempts: order.attempts + 1 })`. Increment `sent`.
      - `transient` → no state change; log and continue.
      - `permanent_rejection` → `repo.transition(id, PENDING, REJECTED)`. Increment `rejected`.
   d. If `bank.send` throws (network) → treat as timeout: `repo.transition(id, PENDING, IN_FLIGHT, { txid, attempts: order.attempts + 1 })`. Increment `sent` (it's a committed send attempt).
3. Return `{ sent, rejected }`.

Wait, let me re-read the plan more carefully on what counts as "sent":
- The return is `{ sent: number; rejected: number }`
- Looking at the control flow, it says "Increment `sent`" for accepted/duplicate and timeout.
- For transient: no state change, no increment of sent.
- For permanent_rejection: increment rejected.

### reconcile(date):
1. Compute `effectiveDate = parseUTC(date)` (midnight UTC).
2. Call `bank.getStatement(date)` → `Settlement[]`. Build a `Map<txid, BankSettlement>`.
3. **Match phase** — `repo.findInFlight(effectiveDate)`:
   - For each order, if `statementMap.has(order.txid)`:
     - Verify `amountCents` matches; if mismatch, raise an alarm log and skip (do not settle).
     - `repo.transition(id, IN_FLIGHT, SETTLED)`. Increment `settled` counter.
4. **Absence phase** — re-fetch `repo.findInFlight(effectiveDate)` (to exclude those just settled):
   - For each remaining order:
     - If `!isPastPublishingLag(effectiveDate)` → skip (cannot yet prove absence).
     - Else: `newAttempts = order.attempts`.
       - If `newAttempts >= 5` → `repo.transition(id, IN_FLIGHT, PARKED)`. Increment `parked`.
       - Else → `repo.transition(id, IN_FLIGHT, PENDING)`. Increment `provenAbsent`.
5. Return `{ date, settled, provenAbsent, parked }`.

### deriveTxid:
`sha256hex("${orderId}:${effectiveDate}")` truncated to 32 hex chars.

I need to use Node's crypto module for sha256. The effective date format in the string - since it's a Date object, I need to format it. Let me think... The plan says `sha256hex("${orderId}:${effectiveDate}")`. Since effectiveDate is a Date, I'll use its ISO string or a formatted version. Actually, to be deterministic and consistent, I should format it as YYYY-MM-DD (the date part). Let me use `effectiveDate.toISOString().split('T')[0]` or just the ISO string. 

Actually, re-reading: "The txid must be derived deterministically from the order + effective date." The plan says `sha256hex("${orderId}:${effectiveDate}")`. Since effectiveDate is a Date at UTC midnight, using `toISOString()` would give a consistent string like "2024-01-15T00:00:00.000Z". That's deterministic. I'll use that.

Wait, but for truncation to 32 hex chars - sha256 produces 64 hex chars, so we take the first 32.

### isPastPublishingLag:
"An order with `effectiveDate` D is 'past lag' iff `now >= D + 24 h + 30 min`"

So: `now.getTime() >= effectiveDate.getTime() + 24*60*60*1000 + 30*60*1000`

The `now` parameter is optional, defaulting to `new Date()`.

Now let me think about the imports:
- `Injectable` from `@nestjs/common`
- `Logger` from `@nestjs/common` (for the alarm log on mismatch)
- `createHash` from `crypto` (Node built-in)
- `BankClient`, `BankSendRequest`, `BankSettlement` from `./bank-client`
- `PayoutsRepository` from `./payouts.repository`
- `OrderStatus` from `@prisma/client`

Wait, the plan says the repository uses `Prisma.OrderGetPayload<never>` for return types. Let me check what fields are available on the order based on the schema:
- `id: string`
- `amountCents: number` (mapped to `amount_cents`)
- `bankKey: string` (mapped to `bank_key`)
- `status: OrderStatus`
- `attempts: number`
- `txid: string | null`
- `effectiveDate: Date` (mapped to `effective_date`)
- `createdAt: Date`
- `updatedAt: Date`

For the `bank.send` call, I need `{ txid, amountCents, bankKey }`.

Let me also think about the `effectiveDate` parameter type. The plan says `executePayments(effectiveDate: Date)`. The controller passes it as a string from the body, but the service takes a Date.

For the `reconcile` method, it takes `date: string` (YYYY-MM-DD) and internally converts to a Date at UTC midnight.

Let me write the file now:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { OrderStatus } from '@prisma/client';
import { BankClient, BankSendRequest } from './bank-client';
import { PayoutsRepository } from './payouts.repository';

export interface ReconcileResult {
  date: string;
  settled: number;
  provenAbsent: number;
  parked: number;
}

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private readonly repo: PayoutsRepository,
    private readonly bank: BankClient,
  ) {}

  async executePayments(effectiveDate: Date): Promise<{ sent: number; rejected: number }> {
    const orders = await this.repo.findPending(effectiveDate);
    let sent = 0;
    let rejected = 0;

    for (const order of orders) {
      const txid = order.txid ?? this.deriveTxid(order.id, effectiveDate);
      const req: BankSendRequest = { txid, amountCents: order.amountCents, bankKey: order.bankKey };

      try {
        const result = await this.bank.send(req);

        switch (result.kind) {
          case 'accepted':
          case 'duplicate': {
            const updated = await this.repo.transition(
              order.id,
              OrderStatus.PENDING,
              OrderStatus.IN_FLIGHT,
              { txid, attempts: order.attempts + 1 },
            );
            if (updated) sent++;
            break;
          }
          case 'transient': {
            this.logger.warn(`Transient error for order ${order.id}: ${result.reason}`);
            break;
          }
          case 'permanent_rejection': {
            const updated = await this.repo.transition(
              order.id,
              OrderStatus.PENDING,
              OrderStatus.REJECTED,
            );
            if (updated) rejected++;
            break;
          }
        }
      } catch {
        // Treat as timeout: the send may have landed at the bank.
        const updated = await this.repo.transition(
          order.id,
          OrderStatus.PENDING,
          OrderStatus.IN_FLIGHT,
          { txid, attempts: order.attempts + 1 },
        );
        if (updated) sent++;
      }
    }

    return { sent, rejected };
  }

  async reconcile(date: string): Promise<ReconcileResult> {
    const effectiveDate = this.parseUTCDate(date);
    const settlements = await this.bank.getStatement(date);
    const statementMap = new Map(settlements.map((s) => [s.txid, s]));

    let settled = 0;
    let provenAbsent = 0;
    let parked = 0;

    // Match phase
    const inFlightOrders = await this.repo.findInFlight(effectiveDate);
    for (const order of inFlightOrders) {
      if (!order.txid) continue;
      const settlement = statementMap.get(order.txid);
      if (settlement) {
        if (settlement.amountCents !== order.amountCents) {
          this.logger.error(
            `Amount mismatch for order ${order.id}: expected ${order.amountCents}, got ${settlement.amountCents}`,
          );
          continue;
        }
        const updated = await this.repo.transition(
          order.id,
          OrderStatus.IN_FLIGHT,
          OrderStatus.SETTLED,
        );
        if (updated) settled++;
      }
    }

    // Absence phase — re-fetch to exclude those just settled
    const remainingInFlight = await this.repo.findInFlight(effectiveDate);
    for (const order of remainingInFlight) {
      if (!this.isPastPublishingLag(effectiveDate)) continue;

      if (order.attempts >= 5) {
        const updated = await this.repo.transition(
          order.id,
          OrderStatus.IN_FLIGHT,
          OrderStatus.PARKED,
        );
        if (updated) parked++;
      } else {
        const updated = await this.repo.transition(
          order.id,
          OrderStatus.IN_FLIGHT,
          OrderStatus.PENDING,
        );
        if (updated) provenAbsent++;
      }
    }

    return { date, settled, provenAbsent, parked };
  }

  private deriveTxid(orderId: string, effectiveDate: Date): string {
    const input = `${orderId}:${effectiveDate.toISOString()}`;
    return createHash('sha256').update(input).digest('hex').slice(0, 32);
  }

  private isPastPublishingLag(effectiveDate: Date, now: Date = new Date()): boolean {
    const lagThreshold = effectiveDate.getTime() + 24 * 60 * 60 * 1000 + 30 * 60 * 1000;
    return now.getTime() >= lagThreshold;
  }

  private parseUTCDate(date: string): Date {
    return new Date(`${date}T00:00:00.000Z`);
  }
}
```

Wait, let me double-check a few things:

1. The plan says `private isPastPublishingLag(effectiveDate: Date, now?: Date): boolean` — I have that.

2. The plan says the `reconcile` method should be idempotent. My implementation re-fetches after the match phase, so orders that were just settled won't appear in the absence phase. Good.

3. The `transition` method on the repository returns a boolean indicating whether the row was actually updated (status guard). I use this to only increment counters when the transition actually happened. This makes it safe for overlapping runs.

4. For the timeout case (catch block), the plan says "treat as timeout: `repo.transition(id, PENDING, IN_FLIGHT, { txid, attempts: order.attempts + 1 })`". This counts as a sent attempt. I increment `sent`.

5. The plan mentions "No outer transaction; each order is an independent unit of work." — I don't wrap anything in a transaction.

6. For the `deriveTxid`, the plan says `sha256hex("${orderId}:${effectiveDate}")` truncated to 32 hex chars. I'm using `effectiveDate.toISOString()` which gives a full ISO string. This is deterministic for the same Date value.

Actually, wait - should I use just the date part? The plan says "effective date" which is a Date at UTC midnight. Using `toISOString()` gives `"2024-01-15T00:00:00.000Z"`. This is deterministic and fine. Alternatively I could use `.toISOString().split('T')[0]` to get just `"2024-01-15"`. Either is deterministic. I'll stick with the full ISO string since the plan just says "effectiveDate" without specifying a format for the hash input.

Hmm, actually let me reconsider. The plan says `sha256hex("${orderId}:${effectiveDate}")`. In a template literal, a Date object would be stringified via its `.toString()` method which gives something like `"Mon Jan 15 2024 00:00:00 GMT+0000 (Coordinated Universal Time)"`. That's not ideal for hashing. Using `toISOString()` is the most defensible choice for a deterministic string representation. I'll add an ASSUMPTION comment about this.

Actually wait, no. The plan is the spec. It says `sha256hex("${orderId}:${effectiveDate}")`. In TypeScript, if you put a Date in a template literal, it calls `.toString()`. But that's locale-dependent and not great. The most defensible reading is to use `.toISOString()` since we need determinism. I'll add a brief assumption comment.

Let me also check: do I need to handle the case where `order.txid` is null in the absence phase? In the absence phase, we're looking at IN_FLIGHT orders. An order can only be IN_FLIGHT if it had a txid set (it's set during the transition to IN_FLIGHT). So `order.txid` should always be non-null for IN_FLIGHT orders. But I'll add a guard just in case... actually the plan doesn't mention this guard for the absence phase, only for the match phase where I check `statementMap.has(order.txid)`. In the absence phase, we don't look up by txid in the statement - we just check if it's past lag. So no need for the txid guard there.

Wait, actually in the match phase I do `if (!order.txid) continue;` - this is a safety guard. The plan doesn't explicitly mention it but it's defensive. Since IN_FLIGHT orders should always have a txid, this is just belt-and-suspenders. I'll keep it.

Let me also verify the import for `OrderStatus`. Looking at the repository file, it imports `OrderStatus` from `@prisma/client`. I'll do the same.

One more thing - the plan says the service should have `private` methods for `deriveTxid` and `isPastPublishingLag`. I have them as private. Good.

I think the file is complete and correct. Let me finalize it.
```

## reply

```ts
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { OrderStatus } from '@prisma/client';
import { BankClient, BankSendRequest } from './bank-client';
import { PayoutsRepository } from './payouts.repository';

export interface ReconcileResult {
  date: string;
  settled: number;
  provenAbsent: number;
  parked: number;
}

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private readonly repo: PayoutsRepository,
    private readonly bank: BankClient,
  ) {}

  async executePayments(effectiveDate: Date): Promise<{ sent: number; rejected: number }> {
    const orders = await this.repo.findPending(effectiveDate);
    let sent = 0;
    let rejected = 0;

    for (const order of orders) {
      // Reuse existing txid on resend; derive a new one for the first send.
      const txid = order.txid ?? this.deriveTxid(order.id, effectiveDate);
      const req: BankSendRequest = { txid, amountCents: order.amountCents, bankKey: order.bankKey };

      try {
        const result = await this.bank.send(req);

        switch (result.kind) {
          case 'accepted':
          case 'duplicate': {
            const updated = await this.repo.transition(
              order.id,
              OrderStatus.PENDING,
              OrderStatus.IN_FLIGHT,
              { txid, attempts: order.attempts + 1 },
            );
            if (updated) sent++;
            break;
          }
          case 'transient': {
            this.logger.warn(`Transient error for order ${order.id}: ${result.reason}`);
            break;
          }
          case 'permanent_rejection': {
            const updated = await this.repo.transition(
              order.id,
              OrderStatus.PENDING,
              OrderStatus.REJECTED,
            );
            if (updated) rejected++;
            break;
          }
        }
      } catch {
        // Network timeout: the send may have landed at the bank, so treat as committed.
        const updated = await this.repo.transition(
          order.id,
          OrderStatus.PENDING,
          OrderStatus.IN_FLIGHT,
          { txid, attempts: order.attempts + 1 },
        );
        if (updated) sent++;
      }
    }

    return { sent, rejected };
  }

  async reconcile(date: string): Promise<ReconcileResult> {
    const effectiveDate = this.parseUTCDate(date);
    const settlements = await this.bank.getStatement(date);
    const statementMap = new Map(settlements.map((s) => [s.txid, s]));

    let settled = 0;
    let provenAbsent = 0;
    let parked = 0;

    // Match phase: settle orders whose txid appears in the statement.
    const inFlightOrders = await this.repo.findInFlight(effectiveDate);
    for (const order of inFlightOrders) {
      if (!order.txid) continue;
      const settlement = statementMap.get(order.txid);
      if (!settlement) continue;

      if (settlement.amountCents !== order.amountCents) {
        this.logger.error(
          `Amount mismatch for order ${order.id}: expected ${order.amountCents}, got ${settlement.amountCents}`,
        );
        continue;
      }

      const updated = await this.repo.transition(
        order.id,
        OrderStatus.IN_FLIGHT,
        OrderStatus.SETTLED,
      );
      if (updated) settled++;
    }

    // Absence phase: re-fetch to exclude orders just settled above.
    const remainingInFlight = await this.repo.findInFlight(effectiveDate);
    for (const order of remainingInFlight) {
      if (!this.isPastPublishingLag(effectiveDate)) continue;

      if (order.attempts >= 5) {
        const updated = await this.repo.transition(
          order.id,
          OrderStatus.IN_FLIGHT,
          OrderStatus.PARKED,
        );
        if (updated) parked++;
      } else {
        const updated = await this.repo.transition(
          order.id,
          OrderStatus.IN_FLIGHT,
          OrderStatus.PENDING,
        );
        if (updated) provenAbsent++;
      }
    }

    return { date, settled, provenAbsent, parked };
  }

  // ASSUMPTION: the plan writes sha256hex("${orderId}:${effectiveDate}"); using
  // toISOString() for the Date gives a locale-independent, deterministic string.
  private deriveTxid(orderId: string, effectiveDate: Date): string {
    const input = `${orderId}:${effectiveDate.toISOString()}`;
    return createHash('sha256').update(input).digest('hex').slice(0, 32);
  }

  private isPastPublishingLag(effectiveDate: Date, now: Date = new Date()): boolean {
    const lagThreshold = effectiveDate.getTime() + 24 * 60 * 60 * 1000 + 30 * 60 * 1000;
    return now.getTime() >= lagThreshold;
  }

  private parseUTCDate(date: string): Date {
    return new Date(`${date}T00:00:00.000Z`);
  }
}
```
