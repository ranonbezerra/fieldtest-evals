import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Order } from '@prisma/client';
import {
  BANK_CLIENT,
  classifySendResult,
  deriveTxid,
  statementDatesInRange,
  toUtcDateKey,
  type BankClient,
  type Settlement,
} from './bank.client.js';
import type { OrderRepository } from './payout.repository.js';

/** Hard cap on send attempts per order. */
export const MAX_SEND_ATTEMPTS = 5;

/**
 * The bank's statement lags reality by up to this much. Absence from the
 * statement is only evidence after a full lag has elapsed since the send.
 */
export const PUBLISHING_LAG_MS = 30 * 60 * 1000;

/** DI token for a clock (injectable for tests). */
export const CLOCK: unique symbol = Symbol('CLOCK');
export type Clock = () => Date;

export interface ReconcileWindow {
  /** inclusive start of the statement window */
  from: Date;
  /** as-of time: every decision in this run is made as of this moment */
  to: Date;
}

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);

  constructor(
    private readonly orders: OrderRepository,
    @Inject(BANK_CLIENT) private readonly bank: BankClient,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Send every pending order. First send only: the send path may record
   * that it does not know an outcome, but it may not act on that. Every
   * resend is made by reconcile(), after reconciliation proves absence.
   */
  async executePayments(): Promise<void> {
    const pending = await this.orders.findPending();
    for (const order of pending) {
      // Defensive: nothing ever moves an order back to pending, so a
      // pending order at the cap is inconsistent state. Park it rather
      // than send blindly.
      if (order.attempts >= MAX_SEND_ATTEMPTS) {
        await this.orders.park(order.id, this.clock(), 'pending_order_at_attempt_cap');
        this.logger.error(`order ${order.id} parked without being sent (at attempt cap while pending)`);
        continue;
      }
      await this.sendOrder(order);
    }
  }

  /**
   * Match statement entries to orders and advance their state.
   *
   * Safe to run repeatedly, over overlapping windows:
   *  - an order that is already settled (or terminal) is skipped before
   *    any decision is taken about it;
   *  - absence is re-proven against a freshly fetched statement on every
   *    run, and only then may a resend happen;
   *  - if a statement fetch fails, nothing is changed and the next run
   *    retries — never decide on partial evidence.
   */
  async reconcile(window: ReconcileWindow): Promise<void> {
    const evidenceCutoff = new Date(window.to.getTime() - PUBLISHING_LAG_MS);

    // Orders whose last send outcome is unknown, and the bank has had a
    // full publication cycle since the attempt. Only these may be proven
    // absent — and only they may be re-sent. (An accepted/duplicate
    // instruction is the bank's to publish, not ours to chase.)
    const awaitingEvidence = await this.orders.findUnknownReadyForEvidence(evidenceCutoff);

    // Statement dates to pull: the dates covered by the window, plus the
    // send date of every awaiting-evidence order — a landed send is
    // published in the statement for the date it was sent, so absence can
    // only be proven against that date.
    const dates = new Set<string>(statementDatesInRange(window.from, window.to));
    for (const order of awaitingEvidence) {
      if (order.lastAttemptAt) dates.add(toUtcDateKey(order.lastAttemptAt));
    }

    const settlements: Settlement[] = [];
    for (const date of [...dates].sort()) {
      settlements.push(...(await this.bank.getStatement(date)));
    }

    await this.matchSettlements(settlements, window.to);
    await this.handleProvenAbsence(settlements, awaitingEvidence);
  }

  /**
   * The four-way handling of one send attempt. Shared by the first send
   * (executePayments) and reconciliation-proven resends, so a resend and a
   * first send are handled identically — same derived txid, same outcomes.
   */
  private async sendOrder(order: Order): Promise<void> {
    const txid = deriveTxid(order);
    const attempts = order.attempts + 1;
    const at = this.clock();

    const result = await this.bank.send({
      txid,
      amount: order.amountMinor,
      key: order.supplierKey,
    });
    const outcome = classifySendResult(result);

    switch (outcome) {
      case 'accepted':
      case 'duplicate':
        // In flight: the bank holds the instruction; the statement is what
        // proves settlement. `duplicate` is a success, not an error — the
        // bank already had this txid (a prior send landed).
        await this.orders.applyAttempt(order.id, {
          status: 'in_flight',
          attempts,
          lastAttemptAt: at,
          lastOutcome: outcome,
        });
        this.logger.log(`order ${order.id} ${outcome} (attempt ${attempts}/${MAX_SEND_ATTEMPTS})`);
        break;
      case 'transient':
        // Outcome unknown: record that we do not know and wait. Nothing in
        // the send path acts on this — only reconciliation may.
        await this.orders.applyAttempt(order.id, {
          status: 'unknown',
          attempts,
          lastAttemptAt: at,
          lastOutcome: 'transient',
        });
        this.logger.warn(`order ${order.id} send outcome unknown (attempt ${attempts}/${MAX_SEND_ATTEMPTS}); awaiting statement evidence`);
        break;
      case 'permanent':
        // Terminal: the bank will not process this instruction (malformed,
        // blocked account, closed beneficiary). A human reviews; we never
        // auto-retry and never auto-revert.
        await this.orders.applyAttempt(order.id, {
          status: 'rejected',
          attempts,
          lastAttemptAt: at,
          lastOutcome: `permanent:${result.type === 'response' ? result.code : 'unknown'}`,
        });
        this.logger.error(`order ${order.id} permanently rejected (attempt ${attempts}/${MAX_SEND_ATTEMPTS})`);
        break;
    }
  }

  /**
   * Match statement entries to orders by txid and settle them. Idempotent:
   * an order that is already settled is skipped before any decision is
   * taken about it, so re-running over the same window changes nothing.
   */
  private async matchSettlements(settlements: Settlement[], asOf: Date): Promise<void> {
    for (const settlement of settlements) {
      const order = await this.orders.findByTxid(settlement.txid);
      if (!order) {
        this.logger.warn(`statement ${settlement.date}: entry ${settlement.txid} matches no order; ignored`);
        continue;
      }
      if (order.status === 'settled') continue; // already settled — a re-run
      if (order.status === 'rejected' || order.status === 'parked') {
        // Anomaly: a terminal order's instruction was published as
        // settled. We never auto-revert; a human must look.
        this.logger.error(`terminal order ${order.id} (${order.status}) found settled as ${settlement.txid}`);
        continue;
      }
      // pending / in_flight / unknown: the statement is the proof. (A
      // pending match means a send crashed before it was recorded; the
      // money is in, so the order is settled.)
      const settledAt = settlement.settledAt ? new Date(settlement.settledAt) : asOf;
      if (settlement.amount !== order.amountMinor) {
        this.logger.error(`order ${order.id}: statement amount ${settlement.amount} != order amount ${order.amountMinor} (minor units)`);
      }
      await this.orders.settle(order.id, settledAt);
      await this.orders.recordSettlement({
        orderId: order.id,
        txid: settlement.txid,
        statementDate: settlement.date,
        settledAt,
      });
      this.logger.log(`order ${order.id} settled via statement ${settlement.date}`);
    }
  }

  /**
   * The only path to a resend: an order whose outcome is unknown, is past
   * the publication lag, and is absent from a fully fetched statement.
   * Absence is proof the send did not land.
   */
  private async handleProvenAbsence(settlements: Settlement[], awaitingEvidence: Order[]): Promise<void> {
    const provenPresent = new Set(settlements.map((s) => s.txid));
    for (const order of awaitingEvidence) {
      if (provenPresent.has(order.txid)) continue; // it landed; matched above

      if (order.attempts >= MAX_SEND_ATTEMPTS) {
        // Five attempts made, all without proof of landing. Stop and
        // escalate: park for manual review. Never auto-revert, never
        // release, never mark failed-and-forget.
        await this.orders.park(order.id, this.clock(), 'attempts_exhausted');
        this.logger.error(`order ${order.id} parked for manual review after ${order.attempts} attempts`);
        continue;
      }

      await this.sendOrder(order); // same derived txid — the bank sees the same instruction
    }
  }
}
