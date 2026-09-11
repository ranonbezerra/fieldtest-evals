# repair1-set

## reasoning

```
Let me analyze the errors:

1. `src/payout/payout.scheduler.ts(21,24): error TS2551: Property 'EVERY_15_MINUTES' does not exist on type 'typeof CronExpression'. Did you mean 'EVERY_5_MINUTES'?`

The `CronExpression` enum from `@nestjs/schedule` doesn't have `EVERY_15_MINUTES`. I need to replace it with a literal cron string `'*/15 * * * *'` or use the correct approach.

2. `src/payout/payout.service.ts(131,21): error TS2551: Property 'duplicate' does not exist on type 'ExecuteSummary'. Did you mean 'duplicates'?`

In the `executePayments` method, at the `case 'duplicate'` block, the code does `summary[outcome] += 1`. When `outcome` is `'duplicate'`, it tries to access `summary.duplicate` which doesn't exist — the property is `summary.duplicates`. 

Let me look at the code more carefully:

```ts
case 'accepted':
case 'duplicate': {
  const attempts = outcome === 'accepted' ? order.attempts + 1 : order.attempts;
  if (
    await this.repo.markAwaitingSettlement(order.id, {
      txid,
      attempts,
      lastSendAt: sentAt,
      lastOutcome: outcome,
    })
  ) {
    summary[outcome] += 1;
  }
  break;
}
```

The issue is `summary[outcome]` where `outcome` can be `'accepted'` or `'duplicate'`. But the `ExecuteSummary` interface has `accepted` and `duplicates` (plural). So `summary[outcome]` won't work for `'duplicate'` because the key is `'duplicates'`.

The fix: instead of `summary[outcome] += 1`, I need to use the correct property name. Since `outcome` is either `'accepted'` or `'duplicate'` in this case block, I can do:

```ts
if (outcome === 'accepted') {
  summary.accepted += 1;
} else {
  summary.duplicates += 1;
}
```

Or I could use a mapping. But the simplest fix is to replace `summary[outcome] += 1` with the correct property access.

Now let me produce the complete files with fixes:

For `payout.scheduler.ts`:
- Replace `CronExpression.EVERY_15_MINUTES` with the cron string `'*/15 * * * *'`

For `payout.service.ts`:
- Fix `summary[outcome] += 1` to properly handle the `'duplicate'` vs `'duplicates'` mismatch.
```

## reply

### src/payout/payout.scheduler.ts
```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PayoutConfig, PAYOUT_CONFIG } from './payout.config.js';
import { PayoutService } from './payout.service.js';

/**
 * Reconciliation job. Every 15 minutes it re-reads the statement history
 * ending at `now - publishingLag` (so every statement fetched is complete)
 * and reaching back `reconcileSpanMs` (so consecutive windows overlap),
 * then lets executePayments release the newly proven-absent orders for resend.
 */
@Injectable()
export class PayoutScheduler {
  private readonly logger = new Logger(PayoutScheduler.name);

  constructor(
    private readonly service: PayoutService,
    @Inject(PAYOUT_CONFIG) private readonly config: PayoutConfig,
  ) {}

  @Cron('*/15 * * * *')
  async tick(): Promise<void> {
    const to = new Date(Date.now() - this.config.publishingLagMs);
    const from = new Date(to.getTime() - this.config.reconcileSpanMs);
    try {
      const reconciled = await this.service.reconcile({ from, to });
      const executed = await this.service.executePayments();
      this.logger.log(`reconcile=${JSON.stringify(reconciled)} execute=${JSON.stringify(executed)}`);
    } catch (error) {
      // The next tick retries; state writes are guarded, so a partial failure
      // can never double-advance an order.
      this.logger.error(`payout run failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
```

### src/payout/payout.service.ts
```ts
import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PayoutOrder } from '@prisma/client';
import {
  BANK_CLIENT,
  BankClient,
  BankRequestError,
  BankSendResponse,
  Settlement,
} from './bank.client.js';
import { PAYOUT_CONFIG, PayoutConfig } from './payout.config.js';
import { PayoutRepository } from './payout.repository.js';

export type SendOutcome = 'accepted' | 'duplicate' | 'transient' | 'permanent';

export interface ReconcileWindow {
  /** Inclusive start of the statement history to re-read. */
  from: Date;
  /** Instant up to which the bank's statements are guaranteed complete. */
  to: Date;
}

export interface ExecuteSummary {
  sent: number;
  accepted: number;
  duplicates: number;
  transient: number;
  permanent: number;
  parked: number;
}

export interface ReconcileSummary {
  daysFetched: number;
  entries: number;
  settled: number;
  parked: number;
  provenAbsent: number;
  unmatched: number;
}

/** Bank error codes that mean "try again later", not "will never work". */
const TRANSIENT_ERROR_CODES: ReadonlySet<string> = new Set([
  'BANK_TIMEOUT',
  'BANK_UNAVAILABLE',
  'SYSTEM_BUSY',
  'RATE_LIMITED',
  'HTTP_429',
  'HTTP_500',
  'HTTP_502',
  'HTTP_503',
  'HTTP_504',
]);

/**
 * Deterministic txid: the same order id + effective date always yields the
 * same txid (time of day irrelevant), so a resend is the very same payment
 * from the bank's point of view and can never double-pay.
 */
export function deriveTxid(orderId: string, effectiveDate: Date): string {
  const day = new Date(
    Date.UTC(effectiveDate.getUTCFullYear(), effectiveDate.getUTCMonth(), effectiveDate.getUTCDate()),
  ).toISOString().slice(0, 10);
  return createHash('sha256').update(`${orderId}:${day}`).digest('hex');
}

/** Classifies a bank.send response; each outcome is handled differently below. */
export function classifySendResponse(response: BankSendResponse): SendOutcome {
  if (response.status === 'accepted') return 'accepted';
  if (response.status === 'duplicate') return 'duplicate';
  return TRANSIENT_ERROR_CODES.has(response.code) ? 'transient' : 'permanent';
}

@Injectable()
export class PayoutService {
  constructor(
    private readonly repo: PayoutRepository,
    @Inject(BANK_CLIENT) private readonly bank: BankClient,
    @Inject(PAYOUT_CONFIG) private readonly config: PayoutConfig,
  ) {}

  /**
   * Sends orders that are due for the bank: fresh PENDING orders and RETRYABLE
   * orders that reconciliation has proven absent from the statement past the
   * publishing lag. The attempt cap is enforced here; exhausted or
   * permanently rejected orders are parked for manual review and are never
   * touched again by the automatic jobs.
   *
   * If two runs race on the same order, the deterministic txid makes the bank
   * de-duplicate the second send as a duplicate, so no double payment.
   */
  async executePayments(): Promise<ExecuteSummary> {
    const summary: ExecuteSummary = {
      sent: 0,
      accepted: 0,
      duplicates: 0,
      transient: 0,
      permanent: 0,
      parked: 0,
    };

    for (const order of await this.repo.findSendable()) {
      const txid = deriveTxid(order.id, order.effectiveDate);
      const sentAt = new Date();
      let outcome: SendOutcome;
      try {
        outcome = classifySendResponse(
          await this.bank.send({ txid, amount: order.amount, key: order.supplierKey }),
        );
      } catch (error) {
        // A thrown transport error (timeout, dropped connection) is exactly the
        // "we do not know whether it landed" case: classify as transient and
        // let reconciliation prove it absent (or find it settled).
        outcome = error instanceof BankRequestError && error.transient ? 'transient' : 'permanent';
      }
      summary.sent += 1;

      switch (outcome) {
        case 'accepted':
        case 'duplicate': {
          // The bank has the payment. A duplicate proves an earlier attempt
          // already landed, so it is not counted as a new attempt.
          const attempts = outcome === 'accepted' ? order.attempts + 1 : order.attempts;
          if (
            await this.repo.markAwaitingSettlement(order.id, {
              txid,
              attempts,
              lastSendAt: sentAt,
              lastOutcome: outcome,
            })
          ) {
            if (outcome === 'accepted') {
              summary.accepted += 1;
            } else {
              summary.duplicates += 1;
            }
          }
          break;
        }
        case 'transient': {
          const attempts = order.attempts + 1;
          if (attempts >= this.config.maxAttempts) {
            if (
              await this.repo.markParked(order.id, {
                reason: 'attempts_exhausted',
                attempts,
                lastSendAt: sentAt,
                lastOutcome: 'transient',
              })
            ) {
              summary.transient += 1;
              summary.parked += 1;
            }
          } else if (
            await this.repo.markRetryable(order.id, {
              attempts,
              lastSendAt: sentAt,
              lastOutcome: 'transient',
            })
          ) {
            // resendEligibleAt stays null: no resend until reconcile() proves
            // the txid absent from the statement past the publishing lag.
            summary.transient += 1;
          }
          break;
        }
        case 'permanent': {
          if (
            await this.repo.markParked(order.id, {
              reason: 'permanent_rejection',
              attempts: order.attempts + 1,
              lastSendAt: sentAt,
              lastOutcome: 'permanent',
            })
          ) {
            summary.permanent += 1;
            summary.parked += 1;
          }
          break;
        }
      }
    }
    return summary;
  }

  /**
   * Re-reads the statement history for the window, settles matching orders,
   * and proves which timed-out orders are absent (hence resendable).
   * Idempotent: every write is a guarded transition, so overlapping windows
   * (which re-read the same days) are safe to run back to back.
   *
   * Contract: `to` must not be later than "now - publishingLag"; the
   * scheduler enforces this, and we still clamp it to the wall clock.
   */
  async reconcile(window: ReconcileWindow): Promise<ReconcileSummary> {
    const summary: ReconcileSummary = {
      daysFetched: 0,
      entries: 0,
      settled: 0,
      parked: 0,
      provenAbsent: 0,
      unmatched: 0,
    };
    const to = new Date(Math.min(window.to.getTime(), Date.now()));
    if (to.getTime() <= window.from.getTime()) return summary;

    // 1. Fetch every statement in the window before touching state, so a
    //    mid-run bank failure leaves all orders untouched.
    const entriesByTxid = new Map<string, Settlement[]>();
    for (const day of statementDays(window.from, to)) {
      const entries = await this.bank.getStatement(day);
      summary.daysFetched += 1;
      for (const entry of entries) {
        summary.entries += 1;
        const bucket = entriesByTxid.get(entry.txid);
        if (bucket) bucket.push(entry);
        else entriesByTxid.set(entry.txid, [entry]);
      }
    }

    // 2. Match settlements to orders by txid. A matching-amount entry settles
    //    the order even if it had been parked (the money did move); a
    //    mismatching amount parks it for a human. Re-matching an order that is
    //    already SETTLED is a no-op — that is what makes overlapping windows safe.
    const orders = await this.repo.findByTxids([...entriesByTxid.keys()]);
    const orderByTxid = new Map(orders.map((o): [string, PayoutOrder] => [o.txid as string, o]));
    for (const [txid, entries] of entriesByTxid) {
      const order = orderByTxid.get(txid);
      if (!order) {
        summary.unmatched += entries.length;
        continue;
      }
      if (order.state === 'SETTLED') continue;
      const matching = entries.find((e) => e.amount === order.amount);
      if (matching) {
        if (
          await this.repo.markSettled(order.id, {
            settledAt: matching.timestamp,
            settlementAmount: order.amount,
          })
        ) {
          summary.settled += 1;
        }
      } else if (
        await this.repo.markParked(order.id, {
          reason: 'amount_mismatch',
          lastOutcome: 'settlement_amount_mismatch',
        })
      ) {
        summary.parked += 1;
      }
    }

    // 3. Proven absent: a RETRYABLE order becomes resendable once the statements
    //    just fetched span from its last send time up past the publishing lag
    //    and none of them contains its txid. Orders last sent before the window
    //    start are owned by earlier runs (or an operator's wider window).
    const windowStartUtc = Date.UTC(window.from.getUTCFullYear(), window.from.getUTCMonth(), window.from.getUTCDate());
    const candidates = (await this.repo.findRetryable()).filter((order) => {
      const lastSendAt = order.lastSendAt;
      if (!lastSendAt) return false;
      if (lastSendAt.getTime() < windowStartUtc) return false;
      if (lastSendAt.getTime() + this.config.publishingLagMs > to.getTime()) return false;
      return !entriesByTxid.has(deriveTxid(order.id, order.effectiveDate));
    });
    if (candidates.length > 0) {
      summary.provenAbsent = await this.repo.markResendEligible(
        candidates.map((o) => o.id),
        to,
      );
    }
    return summary;
  }
}

/** UTC days whose statements to fetch: from's day through to's day, inclusive. */
function* statementDays(from: Date, to: Date): Generator<Date, void, unknown> {
  const dayMs = 24 * 60 * 60_000;
  let cursor = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const last = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  while (cursor <= last) {
    yield new Date(cursor);
    cursor += dayMs;
  }
}
```
