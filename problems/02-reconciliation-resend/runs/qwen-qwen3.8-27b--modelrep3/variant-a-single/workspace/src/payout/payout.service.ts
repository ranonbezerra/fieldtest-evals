import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  MAX_SEND_ATTEMPTS,
  PayoutRepository,
  type OpenOrder,
} from './payout.repository.js';

/**
 * The bank's statement can lag a settlement by up to ~30 minutes. A send is only
 * "proven absent" once it is at least two lags old and its txid is missing from
 * every statement whose day lies inside the reconcile window.
 */
export const PUBLISHING_LAG_MS = 30 * 60 * 1000;

export interface ReconcileWindow {
  from: Date;
  to: Date;
}

export interface Settlement {
  /** The txid we sent. */
  txid: string;
  /** Amount in minor units (integers only). */
  amount: number;
  settledAt: Date;
}

export type BankSendOutcome =
  | { status: 'accepted' }
  | { status: 'duplicate' }
  | { status: 'rejected'; code: string; message: string };

/**
 * Port for the bank's instant-payment API.
 * ASSUMPTION: transient failures (timeout, network, 5xx) surface as thrown errors
 * from `send`; business outcomes come back as the resolved `BankSendOutcome`.
 * `getStatement(date)` returns the settlements published for the UTC calendar day
 * containing `date`, with up to ~30 min of publishing lag.
 */
export interface BankClient {
  send(payload: { txid: string; amount: number; key: string }): Promise<BankSendOutcome>;
  getStatement(date: Date): Promise<Settlement[]>;
}

/** DI token for the bank client. */
export const BANK_CLIENT = 'BANK_CLIENT';

/**
 * Deterministic txid: the same order + same effective UTC date always yields the
 * same txid, so a resend of a payment the bank already processed is reported as a
 * duplicate, never a second payment.
 */
export function deriveTxid(orderId: string, effectiveDate: Date): string {
  const effectiveDay = effectiveDate.toISOString().slice(0, 10);
  return createHash('sha256').update(`${orderId}:${effectiveDay}`).digest('hex');
}

export function startOfDayUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** The UTC calendar days covered by [from, to], both inclusive. */
export function eachUtcDay(from: Date, to: Date): Date[] {
  const days: Date[] = [];
  for (let t = startOfDayUtc(from).getTime(); t <= startOfDayUtc(to).getTime(); t += 24 * 60 * 60 * 1000) {
    days.push(new Date(t));
  }
  return days;
}

export interface ExecutePaymentsResult {
  claimed: number;
  accepted: number;
  duplicates: number;
  transient: number;
  rejected: number;
  parked: number;
}

export interface ReconcileResult {
  entries: number;
  settled: number;
  parked: number;
  provenAbsent: number;
}

/**
 * Order state machine: pending -> in_flight | send_unknown -> settled | needs_review.
 * A send_unknown order may be re-sent only after reconciliation proves its txid
 * absent from the statement past the publishing lag. A needs_review order is never
 * auto-retried and never auto-reverted (a late statement entry may still settle it).
 */
@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);

  /** Test seam; the wall clock in production. */
  clock: () => Date = () => new Date();

  constructor(
    @Inject(PayoutRepository) private readonly repo: PayoutRepository,
    @Inject(BANK_CLIENT) private readonly bank: BankClient,
  ) {}

  /**
   * Sends every order that is eligible right now: pending orders (never sent) and
   * send_unknown orders whose txid has been proven absent. The claim is conditional
   * in the repository, so overlapping runs never double-claim the same attempt, and
   * the deterministic txid makes even a stray double-send a duplicate at the bank,
   * not a double payment.
   */
  async executePayments(): Promise<ExecutePaymentsResult> {
    const now = this.clock();
    const result: ExecutePaymentsResult = {
      claimed: 0,
      accepted: 0,
      duplicates: 0,
      transient: 0,
      rejected: 0,
      parked: 0,
    };

    for (const order of await this.repo.findSendable()) {
      if (order.attemptCount >= MAX_SEND_ATTEMPTS) continue; // cap: park instead
      const claimed = await this.repo.claimForSend(order.id, order.state as 'pending' | 'send_unknown', now);
      if (!claimed) continue; // an overlapping run already won this attempt
      result.claimed += 1;
      const attempt = order.attemptCount + 1;

      let outcome: BankSendOutcome;
      try {
        outcome = await this.bank.send({
          txid: deriveTxid(order.id, order.effectiveDate),
          amount: order.amountMinor,
          key: order.recipientKey,
        });
      } catch (err) {
        // Transient failure (timeout, network, 5xx): the bank may have processed the
        // send. The order stays send_unknown; a resend requires proof of absence.
        this.logger.warn(`send for order ${order.id} failed transiently: ${(err as Error).message}`);
        result.transient += 1;
        if (attempt >= MAX_SEND_ATTEMPTS) {
          await this.repo.recordOutcome(order.id, attempt, 'needs_review', 'attempts_exhausted');
          result.parked += 1;
        }
        continue;
      }

      if (outcome.status === 'accepted') {
        await this.repo.recordOutcome(order.id, attempt, 'in_flight', null);
        result.accepted += 1;
      } else if (outcome.status === 'duplicate') {
        // The bank already holds this txid: the original send went through. Wait for
        // the statement to confirm settlement; never treat it as a fresh send.
        await this.repo.recordOutcome(order.id, attempt, 'in_flight', null);
        result.duplicates += 1;
      } else {
        // Permanent rejection: a retry can never fix it; park for manual review.
        this.logger.error(`bank permanently rejected order ${order.id}: ${outcome.code} ${outcome.message}`);
        await this.repo.recordOutcome(order.id, attempt, 'needs_review', `permanent_rejection:${outcome.code}`);
        result.rejected += 1;
        result.parked += 1;
      }
    }
    return result;
  }

  /**
   * Matches statement entries to orders and advances their state. Idempotent, so it
   * is safe to run every 15 minutes over overlapping windows: a matched entry
   * settles its order (already-settled orders are a no-op), and a send_unknown order
   * is proven absent only when its send date is inside the window and its send is
   * older than two publishing lags, i.e. every entry that could still surface has
   * already been published.
   */
  async reconcile(window: ReconcileWindow): Promise<ReconcileResult> {
    const now = this.clock();
    const result: ReconcileResult = { entries: 0, settled: 0, parked: 0, provenAbsent: 0 };

    // The statement is only trustworthy up to `now - publishing lag`.
    const safeTo = new Date(Math.min(window.to.getTime(), now.getTime() - PUBLISHING_LAG_MS));

    const entries: Settlement[] = [];
    for (const day of eachUtcDay(window.from, safeTo)) {
      entries.push(...(await this.bank.getStatement(day)));
    }
    result.entries = entries.length;
    const seenTxids = new Set(entries.map((entry) => entry.txid));

    const openOrders = await this.repo.findOpen();
    const byTxid = new Map<string, OpenOrder>();
    for (const order of openOrders) {
      byTxid.set(deriveTxid(order.id, order.effectiveDate), order);
    }

    for (const entry of entries) {
      const order = byTxid.get(entry.txid);
      if (!order) continue; // not one of our open orders (or already settled)
      if (entry.amount !== order.amountMinor) {
        // A discrepancy is never resolved automatically: park for manual review.
        this.logger.error(
          `statement amount mismatch for order ${order.id}: expected ${order.amountMinor}, statement says ${entry.amount}`,
        );
        await this.repo.markNeedsReview(order.id, 'amount_mismatch');
        result.parked += 1;
        continue;
      }
      if (await this.repo.settle(order.id, entry.settledAt, ['in_flight', 'send_unknown', 'needs_review'])) {
        result.settled += 1;
      }
    }

    const windowFromDay = startOfDayUtc(window.from);
    for (const order of openOrders) {
      if (order.state !== 'send_unknown' || order.lastSendAt === null) continue;
      if (seenTxids.has(deriveTxid(order.id, order.effectiveDate))) continue; // matched above
      if (order.lastSendAt.getTime() + PUBLISHING_LAG_MS > safeTo.getTime()) continue; // could still surface
      if (startOfDayUtc(order.lastSendAt) < windowFromDay) continue; // window doesn't cover the send date
      await this.repo.markProvenAbsent(order.id, now);
      result.provenAbsent += 1;
    }
    return result;
  }
}

/**
 * Concrete bank client over HTTP.
 * ASSUMPTION: the bank's wire protocol is not specified; this client posts
 * {txid, amount, key} to `{BANK_BASE_URL}/payments` and reads the BankSendOutcome
 * JSON shape, and GETs `{BANK_BASE_URL}/statements?date=YYYY-MM-DD` reading a JSON
 * array of {txid, amount, settledAt (ISO)} for the UTC day. Non-2xx responses
 * surface as thrown errors, i.e. transient failures.
 */
export class HttpBankClient implements BankClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private headers(): Record<string, string> {
    return { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` };
  }

  async send(payload: { txid: string; amount: number; key: string }): Promise<BankSendOutcome> {
    const res = await fetch(`${this.baseUrl}/payments`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`bank.send failed: HTTP ${res.status}`);
    return (await res.json()) as BankSendOutcome;
  }

  async getStatement(date: Date): Promise<Settlement[]> {
    const day = date.toISOString().slice(0, 10);
    const res = await fetch(`${this.baseUrl}/statements?date=${day}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`bank.getStatement failed: HTTP ${res.status}`);
    const rows = (await res.json()) as Array<{ txid: string; amount: number; settledAt: string }>;
    return rows.map((row) => ({ txid: row.txid, amount: row.amount, settledAt: new Date(row.settledAt) }));
  }
}
