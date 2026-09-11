import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PayoutOrder } from '@prisma/client';

import {
  BANK_GATEWAY,
  BankAck,
  BankGateway,
  BankPermanentError,
  BankSendRequest,
  Settlement,
} from './bank-gateway.js';
import { CLOCK, Clock, PAYOUT_CONFIG, PayoutConfig } from './payout.constants.js';
import { PAYOUT_REPOSITORY, PayoutRepositoryApi } from './payout.repository.js';

/** The four classified outcomes of a bank.send call. */
export type SendOutcome = 'accepted' | 'duplicate' | 'transient' | 'permanent';

export interface CreateOrderInput {
  supplierKey: string;
  /** Amount in minor units; must be a positive safe integer. */
  amount: number;
  effectiveDate: Date;
}

export interface ReconcileWindow {
  from: Date;
  to: Date;
}

export interface ExecuteReport {
  total: number;
  accepted: number;
  duplicate: number;
  unknown: number;
  rejected: number;
}

export interface ReconcileReport {
  window: ReconcileWindow;
  settlements: number;
  settled: number;
  resends: number;
  parked: number;
  rejected: number;
  stillUnknown: number;
  amountMismatches: number;
}

/**
 * Deterministic transaction id: the same order on the same effective date
 * always produces the same txid. That is what makes a statement entry
 * matchable to an order at all, and what makes a re-send readable by the
 * bank as the same instruction rather than a new payment.
 *
 * Derive only from attributes that never change once the order exists:
 * the order id and the UTC effective date.
 */
export function deriveTxid(orderId: string, effectiveDate: Date): string {
  const payload = `payout:${orderId}:${effectiveDate.toISOString().slice(0, 10)}`;
  return `pay_${createHash('sha256').update(payload).digest('hex').slice(0, 32)}`;
}

function utcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/** UTC calendar days (yyyy-mm-dd) covered by [from, to], inclusive. */
function utcDatesBetween(from: Date, to: Date): string[] {
  const days: string[] = [];
  let cursor = utcMidnight(from);
  const end = utcMidnight(to);
  while (cursor.getTime() <= end.getTime()) {
    days.push(cursor.toISOString().slice(0, 10));
    if (days.length > 370) {
      throw new Error('reconcile range spans more than 370 days; refusing to fetch that many statements');
    }
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return days;
}

function sendOutcomeKey(outcome: SendOutcome): 'accepted' | 'duplicate' | 'unknown' | 'rejected' {
  switch (outcome) {
    case 'accepted':
      return 'accepted';
    case 'duplicate':
      return 'duplicate';
    case 'transient':
      return 'unknown';
    case 'permanent':
      return 'rejected';
  }
}

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);

  constructor(
    @Inject(PAYOUT_REPOSITORY) private readonly repo: PayoutRepositoryApi,
    @Inject(BANK_GATEWAY) private readonly bank: BankGateway,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PAYOUT_CONFIG) private readonly config: PayoutConfig,
  ) {}

  /** Register a new supplier order. The txid is derived, not generated. */
  async createOrder(input: CreateOrderInput): Promise<PayoutOrder> {
    if (!input.supplierKey || !input.supplierKey.trim()) {
      throw new Error('supplierKey is required');
    }
    if (!Number.isInteger(input.amount) || input.amount <= 0 || input.amount > Number.MAX_SAFE_INTEGER) {
      throw new Error('amount must be a positive integer in minor units');
    }
    if (!isValidDate(input.effectiveDate)) {
      throw new Error('effectiveDate must be a valid date');
    }
    const effectiveDate = utcMidnight(input.effectiveDate);
    const id = randomUUID();
    return this.repo.create({
      id,
      supplierKey: input.supplierKey,
      amount: input.amount,
      effectiveDate,
      txid: deriveTxid(id, effectiveDate),
    });
  }

  /**
   * Send all pending orders. The send path only records outcomes; it never
   * decides to retry. An unknown outcome (transient) is recorded and left
   * to reconciliation — the only path to a re-send.
   */
  async executePayments(): Promise<ExecuteReport> {
    const now = this.clock.now();
    const orders = await this.repo.findPending();
    const report: ExecuteReport = {
      total: orders.length,
      accepted: 0,
      duplicate: 0,
      unknown: 0,
      rejected: 0,
    };

    for (const order of orders) {
      // Claim before calling the bank: pending (attempt 0) -> in_flight
      // (attempt 1). If another run already claimed the order, skip it.
      if (!(await this.repo.claimSend(order.id, now))) continue;
      const outcome = await this.classifySend(this.toBankRequest(order));
      await this.applySendOutcome(order.id, 1, outcome);
      report[sendOutcomeKey(outcome)] += 1;
    }
    return report;
  }

  /**
   * Match statement entries to orders and advance state.
   *
   * Idempotent by construction: every transition is a conditional update
   * keyed on the state just observed, and orders already settled (or
   * parked/rejected) are not even read as candidates. Running this twice
   * over the same — or overlapping — windows changes nothing the first
   * run already settled.
   */
  async reconcile(window: ReconcileWindow): Promise<ReconcileReport> {
    if (!isValidDate(window.from) || !isValidDate(window.to) || window.from.getTime() >= window.to.getTime()) {
      throw new Error('reconcile window must have valid dates with from < to');
    }
    const now = this.clock.now();
    // Absence is only proof once the bank's publishing lag has elapsed.
    const provableByMs = now.getTime() - this.config.publishingLagMs;

    const orders = await this.repo.findAwaitingEvidence();
    const provable: PayoutOrder[] = [];
    for (const order of orders) {
      if (order.lastAttemptAt !== null && order.lastAttemptAt.getTime() <= provableByMs) {
        provable.push(order);
      }
    }

    // Fetch the statements that can serve as evidence: the window, plus a
    // backfill down to the oldest provable attempt, so an order stranded
    // by an outage still gets its statement dates covered in a later run.
    let evidenceFrom = window.from;
    if (provable.length > 0) {
      const oldestMs = Math.min(...provable.map((o) => o.lastAttemptAt!.getTime()));
      evidenceFrom = new Date(Math.min(evidenceFrom.getTime(), oldestMs));
    }

    const settlementsByTxid = new Map<string, Settlement>();
    let settlements = 0;
    for (const date of utcDatesBetween(evidenceFrom, window.to)) {
      // A failed fetch rejects and aborts the whole run: we must never
      // read "no statement data" as "the instruction is absent".
      const rows = await this.bank.getStatement(date);
      settlements += rows.length;
      for (const row of rows) {
        if (!settlementsByTxid.has(row.txid)) settlementsByTxid.set(row.txid, row);
      }
    }

    const report: ReconcileReport = {
      window,
      settlements,
      settled: 0,
      resends: 0,
      parked: 0,
      rejected: 0,
      stillUnknown: 0,
      amountMismatches: 0,
    };

    // 1) Match what the statement shows and settle. Orders already
    //    settled/parked/rejected were not returned by findAwaitingEvidence,
    //    so a repeated run cannot re-do a decision or auto-revert one.
    const matched = new Set<string>();
    for (const order of orders) {
      const settlement = settlementsByTxid.get(order.txid);
      if (settlement === undefined) continue;
      if (Number(order.amount) !== settlement.amount) {
        // Same txid, different money: neither settle nor re-send. A human
        // looks at this before anything else happens to the order.
        report.amountMismatches += 1;
        this.logger.error(
          `statement amount mismatch on order ${order.id}: order=${order.amount} statement=${settlement.amount}`,
        );
        continue;
      }
      if (await this.repo.settle(order.id, now)) report.settled += 1;
      matched.add(order.txid);
    }

    // 2) Proven absent past the publishing lag: the only path to a re-send.
    for (const order of provable) {
      if (matched.has(order.txid)) continue;
      if (settlementsByTxid.has(order.txid)) continue; // matched but amount-mismatched above

      if (order.attemptCount >= this.config.maxAttempts) {
        // Attempts exhausted: park for manual review. Never auto-revert,
        // never release, never mark failed-and-forget — the outcome is
        // still not known, and the safe direction is to stop and escalate.
        if (
          await this.repo.park(
            order.id,
            order.attemptCount,
            `absent from statement past lag after ${order.attemptCount} attempts; manual review required`,
          )
        ) {
          report.parked += 1;
          this.logger.warn(`order ${order.id} parked for manual review after ${order.attemptCount} attempts`);
        }
        continue;
      }

      // Claim the re-send before calling the bank so overlapping runs do
      // not both act. Even if one ever slipped through, the bank dedupes
      // by txid: the second send reads as a duplicate, never a second pay.
      if (!(await this.repo.claimResend(order.id, order.attemptCount, now))) continue;
      const outcome = await this.classifySend(this.toBankRequest(order));
      await this.applySendOutcome(order.id, order.attemptCount + 1, outcome);
      report.resends += 1;
      if (outcome === 'permanent') report.rejected += 1;
      else if (outcome === 'transient') report.stillUnknown += 1;
    }

    return report;
  }

  /**
   * Classify the four outcomes of bank.send. Success resolves with
   * accepted | duplicate; BankPermanentError is a definitive rejection;
   * BankTransientError — and any unclassified error — means the outcome
   * is unknown. We never assume permanent from an exception: the safe
   * direction is "unknown", and only reconciliation may act on it.
   */
  private async classifySend(request: BankSendRequest): Promise<SendOutcome> {
    try {
      const ack: BankAck = await this.bank.send(request);
      return ack.outcome;
    } catch (error) {
      if (error instanceof BankPermanentError) return 'permanent';
      return 'transient';
    }
  }

  /** Each outcome gets its own handling; none of them retries. */
  private async applySendOutcome(id: string, attemptCount: number, outcome: SendOutcome): Promise<void> {
    switch (outcome) {
      case 'accepted':
        // In flight at the bank; the statement is the final word.
        await this.repo.recordOutcome(id, attemptCount, { status: 'accepted', lastOutcome: 'accepted' });
        break;
      case 'duplicate':
        // The bank already has this txid: the first send landed (or is
        // landing). That is a success — same wait-for-statement path,
        // recorded distinctly so the audit trail shows the duplicate.
        await this.repo.recordOutcome(id, attemptCount, { status: 'accepted', lastOutcome: 'duplicate' });
        break;
      case 'transient':
        // Timeout / network / 5xx: outcome unknown. Record it and wait
        // for statement evidence. The send path does not retry.
        await this.repo.recordOutcome(id, attemptCount, { status: 'unknown', lastOutcome: 'transient' });
        break;
      case 'permanent':
        // Definitive rejection (malformed, blocked account, closed
        // beneficiary): re-sending the same instruction cannot succeed.
        // Terminal; a human decides what happens next.
        await this.repo.recordOutcome(id, attemptCount, { status: 'rejected', lastOutcome: 'permanent_rejection' });
        break;
    }
  }

  private toBankRequest(order: PayoutOrder): BankSendRequest {
    // Money flows as integer minor units end to end; the amount is a safe
    // integer by construction (validated in createOrder).
    return { txid: order.txid, amount: Number(order.amount), key: order.supplierKey };
  }
}
