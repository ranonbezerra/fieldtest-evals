import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DAY_MS, startOfUtcDay, toUtcYmd } from '../dates.js';
import { BankClient } from '../bank/bank-client.js';
import type { BankSendRequest, BankSendResponse } from '../bank/bank-client.js';
import { PayoutOrderStore } from './payout.repository.js';
import type { PayoutStatusValue } from './payout.repository.js';

/** Hard cap on bank sends per order; after it the order parks for manual review. */
export const MAX_ATTEMPTS = 5;

/**
 * The bank's publishing lag: a settlement shows up in the statement at most
 * this long after it happens. Absence is only proof of "not landed" once the
 * lag has elapsed since the last attempt.
 */
export const PUBLISHING_LAG_MS = 30 * 60 * 1000;

/** Sanity cap so a bad window cannot fan out into hundreds of statement fetches. */
export const MAX_RECONCILE_WINDOW_DAYS = 14;

export interface ReconcileWindow {
  /** Inclusive lower bound (any instant). */
  from: Date;
  /** Exclusive upper bound (any instant). */
  to: Date;
}

export type SendOutcome = 'accepted' | 'duplicate' | 'transient' | 'permanent';

export interface ExecutePaymentsSummary {
  accepted: number;
  duplicate: number;
  transient: number;
  permanent: number;
}

export interface ReconcileSummary {
  settled: number;
  /** Re-sends actually submitted to the bank in this run (accepted or duplicate). */
  resent: number;
  /** Orders that remain awaiting evidence after this run. */
  stillAwaiting: number;
  rejected: number;
  parked: number;
}

/**
 * The txid is derived, not generated: the same order on the same effective
 * date always produces the same txid. That is what makes a statement entry
 * matchable back to an order and makes a re-send recognisable to the bank as
 * the same instruction rather than a new one.
 */
export function deriveTxid(orderId: string, effectiveDate: Date): string {
  // ASSUMPTION: the bank accepts a 64-char lowercase hex (SHA-256) string as a txid.
  const seed = `${orderId}:${toUtcYmd(effectiveDate)}`;
  return createHash('sha256').update(seed).digest('hex');
}

/**
 * Maps a raw bank response to the four outcomes. A transient error (no
 * response, 5xx, 408, 429) means the outcome is unknown: the only correct
 * move is to record that and wait for evidence — never act on it.
 */
export function classifySend(response: BankSendResponse): SendOutcome {
  if (response.statusCode === 0) return 'transient';
  if (response.statusCode >= 200 && response.statusCode < 300) return 'accepted';
  // ASSUMPTION: the bank answers 409 when it already holds this txid.
  if (response.statusCode === 409) return 'duplicate';
  if (response.statusCode === 408 || response.statusCode === 429 || response.statusCode >= 500) {
    return 'transient';
  }
  return 'permanent';
}

/** The UTC calendar days (midnights) covered by a half-open window. */
export function daysInWindow(window: ReconcileWindow): Date[] {
  if (window.to.getTime() <= window.from.getTime()) return [];
  const spanDays = (window.to.getTime() - window.from.getTime()) / DAY_MS + 1;
  if (spanDays > MAX_RECONCILE_WINDOW_DAYS) {
    throw new Error(`reconcile window spans more than ${MAX_RECONCILE_WINDOW_DAYS} days`);
  }
  const first = startOfUtcDay(window.from).getTime();
  const last = startOfUtcDay(new Date(window.to.getTime() - 1)).getTime();
  const days: Date[] = [];
  for (let t = first; t <= last; t += DAY_MS) days.push(new Date(t));
  return days;
}

/**
 * An order is past the publishing lag once enough time has passed since its
 * last attempt that, had the send landed, its entry would be in the statement
 * by now.
 */
export function isPastPublishingLag(lastAttemptAt: Date | null, now: Date): boolean {
  const base = lastAttemptAt !== null ? lastAttemptAt.getTime() : 0;
  return now.getTime() - base >= PUBLISHING_LAG_MS;
}

/**
 * The scheduled job reconciles yesterday and today: today's statement is
 * still receiving entries (presence settles), and yesterday's statement is
 * complete once the lag has passed (absence becomes proof there).
 */
export function buildScheduledWindow(now: Date): ReconcileWindow {
  const today = startOfUtcDay(now);
  return { from: new Date(today.getTime() - DAY_MS), to: new Date(today.getTime() + DAY_MS) };
}

@Injectable()
export class PayoutService {
  constructor(
    private readonly orders: PayoutOrderStore,
    private readonly bank: BankClient,
  ) {}

  /**
   * First send of pending orders. This path may record that it does not know
   * an outcome — it may not act on that. It never re-sends: re-sends happen in
   * reconcile(), and only after the statement proves absence past the lag.
   */
  async executePayments(now: Date = new Date()): Promise<ExecutePaymentsSummary> {
    const pending = await this.orders.findPending();
    const summary: ExecutePaymentsSummary = { accepted: 0, duplicate: 0, transient: 0, permanent: 0 };
    for (const order of pending) {
      const txid = deriveTxid(order.id, order.effectiveDate);
      const response = await this.sendToBank({ txid, amount: order.amountMinor, key: order.key });
      const outcome = classifySend(response);
      const recorded = await this.orders.recordSendOutcome(order.id, {
        status: statusFor(outcome),
        txid,
        lastAttemptAt: now,
        rejectionReason: outcome === 'permanent' ? response.reason : null,
      });
      if (recorded) summary[outcome] += 1;
    }
    return summary;
  }

  /**
   * Match statement entries to orders and advance them. Safe to run every 15
   * minutes over overlapping windows:
   *  - statements are fetched before any state change, so a bank failure
   *    changes nothing;
   *  - orders already matched (settled) are not even fetched;
   *  - every transition is a conditional update, and a re-send is claimed
   *    atomically before it happens, so two overlapping runs can never
   *    double-send or double-settle one order.
   */
  async reconcile(window: ReconcileWindow, now: Date = new Date()): Promise<ReconcileSummary> {
    const summary: ReconcileSummary = { settled: 0, resent: 0, stillAwaiting: 0, rejected: 0, parked: 0 };
    const days = daysInWindow(window);
    if (days.length === 0) return summary;

    const statements = await Promise.all(days.map((day) => this.bank.getStatement(day)));
    const settledTxids = new Set<string>();
    for (const entries of statements) {
      for (const entry of entries) settledTxids.add(entry.txid);
    }

    const candidates = await this.orders.findAwaitingEvidence(days);
    for (const order of candidates) {
      // Presence in the statement settles the order — regardless of the lag.
      if (order.txid !== null && settledTxids.has(order.txid)) {
        if (await this.orders.markSettled(order.id, now)) summary.settled += 1;
        continue;
      }
      // Absence is not proof until the lag has passed (and a missing txid is
      // not absence of anything).
      if (order.txid === null || !isPastPublishingLag(order.lastAttemptAt, now)) {
        summary.stillAwaiting += 1;
        continue;
      }
      // Proven absent: the only situation in which a re-send is permitted.
      if (order.attemptCount >= MAX_ATTEMPTS) {
        // Terminal: a human reviews. Never auto-reverted, released or forgotten.
        if (await this.orders.markParked(order.id, now)) summary.parked += 1;
        continue;
      }
      if (!(await this.orders.claimResend(order.id, order.attemptCount, now))) {
        // A concurrent run already claimed (and probably performed) this re-send.
        summary.stillAwaiting += 1;
        continue;
      }
      // Re-send with the same derived txid the bank already saw.
      const response = await this.sendToBank({ txid: order.txid, amount: order.amountMinor, key: order.key });
      const outcome = classifySend(response);
      const recorded = await this.orders.recordResendOutcome(order.id, {
        status: statusFor(outcome),
        rejectionReason: outcome === 'permanent' ? response.reason : null,
      });
      if (!recorded) {
        // The order left the awaiting states in the meantime (e.g. settled).
        summary.stillAwaiting += 1;
        continue;
      }
      if (outcome === 'accepted' || outcome === 'duplicate') summary.resent += 1;
      else if (outcome === 'permanent') summary.rejected += 1;
      else summary.stillAwaiting += 1;
    }
    return summary;
  }

  private async sendToBank(request: BankSendRequest): Promise<BankSendResponse> {
    try {
      return await this.bank.send(request);
    } catch (error) {
      // No answer from the bank at all: outcome unknown, not a failure we may act on.
      return { statusCode: 0, reason: error instanceof Error ? error.message : String(error) };
    }
  }
}

function statusFor(outcome: SendOutcome): PayoutStatusValue {
  switch (outcome) {
    case 'accepted':
    case 'duplicate':
      // The bank holds the instruction; the statement will settle it.
      return 'SENT';
    case 'transient':
      return 'OUTCOME_UNKNOWN';
    case 'permanent':
      return 'REJECTED';
  }
}
