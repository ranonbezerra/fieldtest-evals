import { Injectable, Logger } from '@nestjs/common';
import { PayoutRepository } from './payout.repository.js';
import { BankService, BankSendResult, BankSettlement } from '../bank/bank.service.js';
import { Payout, PayoutStatus } from '@prisma/client';
import { createHash } from 'crypto';

export interface ReconcileWindow {
  from: Date;
  to: Date;
}

/**
 * Service that orchestrates sending payouts and reconciling them with the bank's
 * statement.
 */
@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);
  private static readonly MAX_ATTEMPTS = 5;
  private static readonly PUBLISHING_LAG_MS = 30 * 60 * 1000; // 30 minutes

  constructor(
    private readonly payoutRepo: PayoutRepository,
    private readonly bankService: BankService,
  ) {}

  /**
   * Derives a deterministic txid from stable order attributes.
   */
  private deriveTxId(payout: Payout): string {
    const input = `${payout.id}-${payout.effectiveDate.toISOString()}`;
    return createHash('sha256').update(input).digest('hex');
  }

  /**
   * Sends all pending orders to the bank.
   */
  async executePayments(): Promise<void> {
    const pendingOrders = await this.payoutRepo.findPendingOrders();
    for (const order of pendingOrders) {
      const txid = this.deriveTxId(order);
      const payload = { txid, amount: order.amount, key: order.bankKey };
      let result: BankSendResult;
      try {
        result = await this.bankService.send(payload);
      } catch (err) {
        this.logger.warn(`Bank send threw for payout ${order.id}: ${err}`);
        result = { status: 'transient_error' };
      }
      await this.handleSendResult(order, txid, result);
    }
  }

  /**
   * Handles the result of a bank.send call, updating order state accordingly.
   */
  private async handleSendResult(
    order: Payout,
    txid: string,
    result: BankSendResult,
  ): Promise<void> {
    switch (result.status) {
      case 'accepted':
        await this.payoutRepo.markSent(order.id, txid);
        break;
      case 'duplicate':
        // Duplicate means the bank already has the instruction – treat as settled.
        if (!order.txid) {
          await this.payoutRepo.updateTxid(order.id, txid);
        }
        await this.payoutRepo.markSettled(order.id);
        break;
      case 'transient_error':
        // Outcome unknown – mark as sent (increments attempts) and wait for evidence.
        await this.payoutRepo.markSent(order.id, txid);
        break;
      case 'permanent_rejection':
        await this.payoutRepo.markFailed(order.id);
        break;
      default:
        this.logger.error(`Unexpected bank send status: ${JSON.stringify(result)}`);
    }
  }

  /**
   * Reconciles payouts against the bank statement for a given window.
   *
   * - Matches statement entries to payouts and marks them settled.
   * - For payouts still awaiting evidence and past publishing lag, triggers a resend.
   * - Parks payouts that have exhausted attempts.
   */
  async reconcile(window: ReconcileWindow): Promise<void> {
    // Gather all settlements in the window (one call per day).
    const dates = this.enumerateDates(window.from, window.to);
    const settlementsMap: Record<string, BankSettlement> = {};

    for (const date of dates) {
      const daySettlements = await this.bankService.getStatement(date);
      for (const s of daySettlements) {
        settlementsMap[s.txid] = s;
      }
    }

    // Process payouts that are awaiting evidence.
    const awaiting = await this.payoutRepo.findOrdersAwaitingEvidence();
    const now = new Date();
    const lagBoundary = new Date(now.getTime() - PayoutService.PUBLISHING_LAG_MS);

    for (const payout of awaiting) {
      const txid = payout.txid;
      if (!txid) {
        continue; // Should not happen; defensive skip.
      }

      if (settlementsMap[txid]) {
        // Settlement found – mark as settled.
        await this.payoutRepo.markSettled(payout.id);
        continue;
      }

      // No settlement found. If the payout is older than the publishing lag,
      // we have proof that it did not land and may resend (subject to attempt cap).
      if (payout.effectiveDate <= lagBoundary) {
        if (payout.attempts < PayoutService.MAX_ATTEMPTS) {
          // Resend with the same deterministic txid.
          const payload = { txid, amount: payout.amount, key: payout.bankKey };
          let result: BankSendResult;
          try {
            result = await this.bankService.send(payload);
          } catch (err) {
            this.logger.warn(`Bank resend threw for payout ${payout.id}: ${err}`);
            result = { status: 'transient_error' };
          }
          // Reuse the same handling logic; it will increment attempts.
          await this.handleSendResult(payout, txid, result);
        } else {
          // Attempts exhausted – park for manual review.
          await this.payoutRepo.parkOrder(payout.id);
        }
      }
    }
  }

  /**
   * Returns an array of Date objects representing each day in the inclusive range.
   */
  private enumerateDates(start: Date, end: Date): Date[] {
    const dates: Date[] = [];
    const cur = new Date(start);
    cur.setUTCHours(0, 0, 0, 0);
    const endDate = new Date(end);
    endDate.setUTCHours(0, 0, 0, 0);
    while (cur <= endDate) {
      dates.push(new Date(cur));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return dates;
  }
}
