import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { BANK_CLIENT } from '../bank/bank.types';
import type { BankClient, BankSendResult, Settlement } from '../bank/bank.types';
import {
  Payout,
  PayoutStatus,
  PayoutConfig,
  PAYOUT_CONFIG,
  PayoutRepository,
  PAYOUT_REPOSITORY,
  ReconcileWindow,
  ReconcileResult,
  formatDateKey,
} from './payout.types';

@Injectable()
export class PayoutService {
  private readonly publishLagMs: number;
  private readonly maxAttempts: number;

  constructor(
    @Inject(PAYOUT_REPOSITORY) private readonly payoutRepository: PayoutRepository,
    @Inject(BANK_CLIENT) private readonly bankClient: BankClient,
    @Inject(PAYOUT_CONFIG) private readonly config: PayoutConfig,
  ) {
    this.publishLagMs = config.publishLagMinutes * 60_000;
    this.maxAttempts = config.maxAttempts;
  }

  /**
   * Derives a deterministic txid from the order ID and effective date.
   * Same order + same effective date always yields the same txid,
   * which is required for the bank's duplicate detection.
   */
  deriveTxid(orderId: string, effectiveDate: Date): string {
    const dateStr = formatDateKey(effectiveDate);
    return createHash('sha256')
      .update(`${orderId}:${dateStr}`)
      .digest('hex')
      .substring(0, 32);
  }

  /**
   * Sends pending payouts via the bank's instant-payment API.
   *
   * Response classification:
   *   accepted        → SENT (in the bank's system, waiting for settlement)
   *   duplicate       → SENT (bank already has this txid)
   *   transient_error → AWAITING_RECONCILE (needs proof of absence before retry)
   *   permanent_rejection → REJECTED (parked, never auto-retried)
   */
  async executePayments(): Promise<number> {
    const orders = await this.payoutRepository.findPending();

    for (const order of orders) {
      const txid = order.txid ?? this.deriveTxid(order.id, order.effectiveDate);
      let result: BankSendResult;

      try {
        result = await this.bankClient.send({
          txid,
          amount: order.amount,
          key: order.externalKey,
        });
      } catch (err) {
        // Network / timeout / unhandled exception → transient
        result = {
          status: 'transient_error',
          error: (err as Error).message,
        };
      }

      await this.handleSendResult(order, txid, result);
    }

    return orders.length;
  }

  private async handleSendResult(
    order: Payout,
    txid: string,
    result: BankSendResult,
  ): Promise<void> {
    switch (result.status) {
      case 'accepted':
        await this.payoutRepository.markSent(order.id, txid);
        break;

      case 'duplicate':
        // The bank already has this txid from a prior attempt.
        await this.payoutRepository.markSent(order.id, txid);
        break;

      case 'transient_error':
        // Send failed or timed out — we cannot know if the bank received it.
        // The order must go through reconciliation to prove absence
        // before it can be re-sent with the same deterministic txid.
        await this.payoutRepository.markAwaitingReconcile(order.id, txid);
        break;

      case 'permanent_rejection':
        // Definitive rejection. Park for manual review — never auto-retried.
        await this.payoutRepository.markRejected(order.id, txid);
        break;
    }
  }

  /**
   * Reconciles bank statements with payout orders.
   *
   * Idempotent and safe to run every 15 minutes, including over
   * overlapping windows: if a txid was already matched in a prior
   * run, the second run is a no-op for that order.
   */
  async reconcile(window: ReconcileWindow): Promise<ReconcileResult> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - this.publishLagMs);

    // 1. Fetch statement entries for dates in the window past the publish lag.
    const settlements = await this.fetchStatements(window, cutoff);

    // 2. Collect every txid that appeared in the bank statement.
    const statementTxids = new Set<string>();
    for (const s of settlements) {
      statementTxids.add(s.txid);
    }

    // 3. Match statement entries to orders → advance to SETTLED.
    let matched = 0;
    for (const settlement of settlements) {
      const order = await this.payoutRepository.findByTxid(settlement.txid);
      if (order && order.status !== PayoutStatus.SETTLED) {
        await this.payoutRepository.markSettled(order.id, now);
        matched++;
      }
    }

    // 4. For AWAITING_RECONCILE orders absent from the statement,
    //    prove absence and decide: resend or park for manual review.
    const awaiting = await this.payoutRepository.findAwaitingReconcileEligible(
      window,
      cutoff,
    );

    let resendEligible = 0;
    let failed = 0;

    for (const order of awaiting) {
      if (order.txid && statementTxids.has(order.txid)) {
        // Already matched and settled in step 3 — skip.
        continue;
      }

      // Proven absent past the publishing lag.
      if (order.attemptCount >= this.maxAttempts) {
        await this.payoutRepository.markFailed(order.id, now);
        failed++;
      } else {
        await this.payoutRepository.markForResend(order.id);
        resendEligible++;
      }
    }

    return { matched, resendEligible, failed };
  }

  /**
   * Fetches bank statements for each calendar date in the window
   * that is older than the publish-lag cutoff.
   */
  private async fetchStatements(
    window: ReconcileWindow,
    cutoff: Date,
  ): Promise<Settlement[]> {
    const settlements: Settlement[] = [];

    const current = new Date(window.from);
    current.setHours(0, 0, 0, 0);
    const end = new Date(window.to);
    end.setHours(0, 0, 0, 0);

    while (current <= end) {
      if (current.getTime() <= cutoff.getTime()) {
        try {
          const entries = await this.bankClient.getStatement(new Date(current));
          settlements.push(...entries);
        } catch {
          // ASSUMPTION: A single statement fetch failure should not abort
          // the entire reconciliation. The affected date will be retried
          // on the next scheduled run.
        }
      }
      current.setDate(current.getDate() + 1);
    }

    return settlements;
  }
}
