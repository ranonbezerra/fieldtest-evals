import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { ParkReason, PayoutStatus } from '@prisma/client';
import type { Payout } from '@prisma/client';
import { BankClient, toUtcDate } from '../bank/bank.client';
import type { BankSendResponse, Settlement } from '../bank/bank.client';
import { PayoutsRepository } from './payouts.repository';
import type { PayoutTransitionData } from './payouts.repository';

/** DI token for the payout configuration (see PayoutsModule). */
export const PAYOUTS_CONFIG = 'PAYOUTS_CONFIG';

export interface PayoutsConfig {
  /** How long the bank may lag before a settlement is visible in its statements. */
  publishingLagMs: number;
  /** Maximum orders sent per executePayments() invocation. */
  sendBatchSize: number;
}

/** An order is sent at most this many times; beyond that it is parked for manual review. */
export const MAX_SEND_ATTEMPTS = 5;

/** How far the reconcile window looks back; it overlaps the previous run by half. */
const RECONCILE_WINDOW_MS = 30 * 60_000;

export type SendClassification = 'accepted' | 'duplicate' | 'transient' | 'permanent';

export interface CreatePayoutInput {
  supplierKey: string;
  amountMinor: number;
  effectiveDate: Date;
}

export interface ReconcileWindow {
  from: Date;
  to: Date;
}

export interface ExecutePaymentsResult {
  attempted: number;
  accepted: number;
  duplicates: number;
  transient: number;
  permanent: number;
  parked: number;
}

export interface ReconcileResult {
  from: Date;
  to: Date;
  statementDatesFetched: number;
  settled: number;
  provenAbsent: number;
  parked: number;
  discrepancies: number;
  unmatchedEntries: number;
}

const SENDABLE_STATES: PayoutStatus[] = [PayoutStatus.pending, PayoutStatus.retryable];

const SETTLE_FROM_STATES: PayoutStatus[] = [
  PayoutStatus.pending,
  PayoutStatus.sent,
  PayoutStatus.in_flight,
  PayoutStatus.retryable,
  PayoutStatus.parked,
];

const CLASSIFICATION_COUNT_KEY: Record<SendClassification, 'accepted' | 'duplicates' | 'transient' | 'permanent'> = {
  accepted: 'accepted',
  duplicate: 'duplicates',
  transient: 'transient',
  permanent: 'permanent',
};

/**
 * Classifies a raw bank send response:
 *  - accepted: the bank took the payment;
 *  - duplicate: the bank already processed this txid (a prior attempt went through);
 *  - transient: the outcome is unknown (network failure, timeout, bank unavailable);
 *  - permanent: the bank explicitly rejected it; it must never be auto-retried.
 * // ASSUMPTION: the bank signals duplicates via HTTP 409 or the codes
 * // 'DUPLICATE_TXID' / 'DUPLICATE'.
 * Anything that is not a confirmed acceptance, a duplicate, or an explicit
 * rejection is treated as transient: resending is only safe because the txid is
 * deterministic and the bank dedupes on it.
 */
export function classifySendResponse(response: { status: number; code?: string }): SendClassification {
  const { status, code } = response;
  if (status === 409 || code === 'DUPLICATE_TXID' || code === 'DUPLICATE') return 'duplicate';
  if (status === 0 || status === 408 || status === 429 || (status >= 500 && status <= 599)) return 'transient';
  if (status >= 200 && status <= 299) return 'accepted';
  if (status >= 400 && status <= 499) return 'permanent';
  return 'transient';
}

/** Deterministic txid: the same order and effective date always yield the same txid. */
export function deriveTxid(orderId: string, effectiveDate: Date | string): string {
  return createHash('sha256').update(`${orderId}:${toUtcDate(effectiveDate)}`).digest('hex');
}

@Injectable()
export class PayoutsService {
  constructor(
    private readonly payouts: PayoutsRepository,
    private readonly bank: BankClient,
    @Inject(PAYOUTS_CONFIG) private readonly config: PayoutsConfig,
  ) {}

  createOrder(input: CreatePayoutInput): Promise<Payout> {
    const id = randomUUID();
    return this.payouts.create({
      id,
      supplierKey: input.supplierKey,
      amountMinor: input.amountMinor,
      effectiveDate: input.effectiveDate,
      txid: deriveTxid(id, input.effectiveDate),
    });
  }

  /**
   * Sends every order that is eligible to be sent: `pending` (never sent) and
   * `retryable` (reconciliation proved it absent from the statements).
   * `in_flight`, `sent`, `parked` and `settled` orders are never (re)sent from
   * here, which is what makes double payment impossible.
   */
  async executePayments(): Promise<ExecutePaymentsResult> {
    const result: ExecutePaymentsResult = {
      attempted: 0,
      accepted: 0,
      duplicates: 0,
      transient: 0,
      permanent: 0,
      parked: 0,
    };
    for (;;) {
      const batch = await this.payouts.findToSend(this.config.sendBatchSize);
      if (batch.length === 0) break;
      for (const payout of batch) {
        result.attempted += 1;
        const { classification, parked } = await this.sendOnce(payout);
        result[CLASSIFICATION_COUNT_KEY[classification]] += 1;
        if (parked) result.parked += 1;
      }
      // Every send moves the order out of a sendable state, so this terminates.
      if (batch.length < this.config.sendBatchSize) break;
    }
    return result;
  }

  /**
   * Reconciles the given window (or, when none is given, the default job window
   * [now - lag - 30min, now - lag], which overlaps the previous run):
   * 1. A statement entry matching an order's txid settles the order.
   * 2. Once the window end is past the publishing lag, an unknown-outcome order
   *    whose txid is absent from the fetched statements is proven absent and
   *    becomes eligible for a re-send (or is parked when the attempt cap is hit).
   * Every transition is state-guarded, so overlapping windows are safe.
   */
  async reconcile(window: ReconcileWindow | undefined): Promise<ReconcileResult> {
    const resolved = window ?? this.defaultWindow();
    this.assertValidWindow(resolved);

    const dates = utcDatesCovering(resolved);
    const statements = await Promise.all(dates.map((date) => this.bank.getStatement(date)));

    const settlementsByTxid = new Map<string, Settlement>();
    for (const settlement of statements.flat()) {
      settlementsByTxid.set(settlement.txid, settlement);
    }

    const result: ReconcileResult = {
      from: resolved.from,
      to: resolved.to,
      statementDatesFetched: dates.length,
      settled: 0,
      provenAbsent: 0,
      parked: 0,
      discrepancies: 0,
      unmatchedEntries: 0,
    };

    // 1) Settlement matching: the statement is authoritative. Settling an order
    //    whose txid we see in it (even one we never sent) is what prevents a
    //    double payment.
    const candidates = await this.payouts.findUnsettledByTxids([...settlementsByTxid.keys()]);
    let matchedEntries = 0;
    for (const payout of candidates) {
      const settlement = settlementsByTxid.get(payout.txid);
      if (!settlement) continue;
      matchedEntries += 1;
      if (settlement.amount !== payout.amountMinor) {
        // Never auto-settle (or auto-resend) on an amount mismatch; flag for humans.
        result.discrepancies += 1;
        continue;
      }
      const applied = await this.payouts.transition(payout.id, SETTLE_FROM_STATES, {
        status: PayoutStatus.settled,
        settledAt: settlement.settledAt,
      });
      if (applied) result.settled += 1;
    }
    result.unmatchedEntries = settlementsByTxid.size - matchedEntries;

    // 2) Absence proof: only valid once the statement is fully published, i.e.
    //    the window end is at least `publishingLagMs` in the past.
    const absenceProvable = resolved.to.getTime() <= Date.now() - this.config.publishingLagMs;
    if (absenceProvable) {
      const fetchedDates = new Set(dates.map(toUtcDate));
      const unknowns = await this.payouts.findInFlightAttemptedBefore(resolved.to);
      for (const payout of unknowns) {
        // Seen in the statement (settled above, or amount mismatch) -> not absent.
        if (settlementsByTxid.has(payout.txid)) continue;
        // We only fetched statements for the dates covered by the window.
        if (payout.lastAttemptAt === null || !fetchedDates.has(toUtcDate(payout.lastAttemptAt))) continue;
        const to = payout.attempts >= MAX_SEND_ATTEMPTS ? PayoutStatus.parked : PayoutStatus.retryable;
        const data: PayoutTransitionData = { status: to };
        if (to === PayoutStatus.parked) data.parkReason = ParkReason.attempt_limit;
        const applied = await this.payouts.transition(payout.id, [PayoutStatus.in_flight], data);
        if (applied) {
          if (to === PayoutStatus.parked) result.parked += 1;
          else result.provenAbsent += 1;
        }
      }
    }

    return result;
  }

  private async sendOnce(
    payout: Payout,
  ): Promise<{ classification: SendClassification; parked: boolean }> {
    let response: BankSendResponse;
    try {
      response = await this.bank.send({
        txid: payout.txid,
        amount: payout.amountMinor,
        key: payout.supplierKey,
      });
    } catch {
      // BankClient already maps network failures to status 0; this is a
      // defensive net so that any throw means "outcome unknown".
      response = { status: 0, code: 'NETWORK_ERROR' };
    }

    const classification = classifySendResponse(response);
    const now = new Date();
    let to: PayoutStatus;
    let parkReason: ParkReason | undefined;

    if (classification === 'accepted' || classification === 'duplicate') {
      // The bank has the payment (it just accepted it, or it was already
      // processed by a prior unknown-outcome attempt). Awaiting settlement.
      to = PayoutStatus.sent;
    } else if (classification === 'permanent') {
      // Explicit bank rejection: park for manual review, never auto-retry.
      to = PayoutStatus.parked;
      parkReason = ParkReason.permanent_rejection;
    } else {
      // Unknown outcome: the payment may still go through, so the order waits
      // for reconciliation before any re-send. Past the cap -> manual review.
      to = payout.attempts + 1 >= MAX_SEND_ATTEMPTS ? PayoutStatus.parked : PayoutStatus.in_flight;
      if (to === PayoutStatus.parked) parkReason = ParkReason.attempt_limit;
    }

    const data: PayoutTransitionData = {
      status: to,
      attempts: { increment: 1 },
      lastAttemptAt: now,
    };
    if (parkReason) data.parkReason = parkReason;
    const applied = await this.payouts.transition(payout.id, SENDABLE_STATES, data);
    return { classification, parked: applied && to === PayoutStatus.parked };
  }

  /** [now - lag - 30min, now - lag]: 15 minutes of overlap with the previous run. */
  private defaultWindow(): ReconcileWindow {
    const nowMs = Date.now();
    return {
      from: new Date(nowMs - this.config.publishingLagMs - RECONCILE_WINDOW_MS),
      to: new Date(nowMs - this.config.publishingLagMs),
    };
  }

  private assertValidWindow(window: ReconcileWindow): void {
    const fromMs = window.from.getTime();
    const toMs = window.to.getTime();
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
      throw new BadRequestException({
        error: { code: 'invalid_window', message: 'reconcile window from/to must be valid dates', details: {} },
      });
    }
    if (fromMs >= toMs) {
      throw new BadRequestException({
        error: { code: 'invalid_window', message: 'reconcile window from must be strictly before to', details: {} },
      });
    }
    if (toMs > Date.now()) {
      throw new BadRequestException({
        error: { code: 'window_in_future', message: 'reconcile window to cannot be in the future', details: { to: window.to.toISOString() } },
      });
    }
  }
}

/** UTC calendar dates (midnight UTC) spanned by the window. */
function utcDatesCovering(window: ReconcileWindow): Date[] {
  const dates: Date[] = [];
  let cursor = new Date(Date.UTC(window.from.getUTCFullYear(), window.from.getUTCMonth(), window.from.getUTCDate()));
  while (cursor.getTime() <= window.to.getTime()) {
    dates.push(cursor);
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return dates;
}
