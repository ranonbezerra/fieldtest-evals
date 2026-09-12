import { Injectable, Logger } from '@nestjs/common';
import { BankService, BankSendResult, Settlement } from '../bank/bank.service.js';
import { PayoutRepository } from './payout.repository.js';
import { PayoutStatus } from '@prisma/client';
import * as crypto from 'crypto';

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);
  private readonly PUBLISHING_LAG_MS = 30 * 60 * 1000; // 30 minutes
  private readonly MAX_ATTEMPTS = 5;

  constructor(
    private readonly bankService: BankService,
    private readonly payoutRepo: PayoutRepository,
  ) {}

  /**
   * Deterministically derives a txid from order attributes and the effective date.
   */
  private deriveTxId(orderId: string, effectiveDate: Date): string {
    const hash = crypto
      .createHash('sha256')
      .update(`${orderId}|${effectiveDate.toISOString()}`)
      .digest('hex')
      .substring(0, 32); // 128‑bit enough for uniqueness
    return hash;
  }

  /**
   * Executes payments for all pending orders.
   */
  async executePayments(): Promise<void> {
    const pending = await this.payoutRepo.findPendingToSend();

    for (const payout of pending) {
      const txid = this.deriveTxId(payout.orderId, payout.effectiveDate);
      let result: BankSendResult;

      try {
        result = await this.bankService.send({
          txid,
          amount: payout.amount,
          key: payout.supplierKey,
        });
      } catch (err) {
        // Network or unexpected error – treat as transient
        this.logger.warn(
          `Bank send threw an unexpected error for payout ${payout.id}: ${err}`,
        );
        result = { outcome: 'transient_error' };
      }

      await this.handleBankSendResult(payout, txid, result);
    }
  }

  private async handleBankSendResult(
    payout: any,
    txid: string,
    result: BankSendResult,
  ): Promise<void> {
    switch (result.outcome) {
      case 'accepted':
        await this.payoutRepo.updateAfterSend(
          payout.id,
          txid,
          PayoutStatus.sent,
          1,
        );
        break;
      case 'duplicate':
        // Bank already has the txid – treat as success
        await this.payoutRepo.updateAfterSend(
          payout.id,
          txid,
          PayoutStatus.sent,
          0,
        );
        break;
      case 'transient_error':
        // Outcome unknown – record attempt but keep status pending so reconciliation can decide later
        await this.payoutRepo.updateAfterSend(
          payout.id,
          txid,
          PayoutStatus.pending,
          1,
        );
        break;
      case 'permanent_rejection':
        await this.payoutRepo.updateAfterSend(
          payout.id,
          txid,
          PayoutStatus.failed,
          1,
        );
        break;
    }
  }

  /**
   * Reconciliation job.
   * @param window.start inclusive start date (UTC)
   * @param window.end inclusive end date (UTC)
   */
  async reconcile(window: { start: Date; end: Date }): Promise<void> {
    // 1️⃣ Pull statements for each day in the window
    const dates = this.enumerateDates(window.start, window.end);
    const settlements = new Map<string, Settlement>();
    for (const d of dates) {
      const daySettlements = await this.bankService.getStatement(d);
      for (const s of daySettlements) {
        settlements.set(s.txid, s);
      }
    }

    // 2️⃣ Mark payouts that have a matching settlement as settled
    for (const [txid, settlement] of settlements.entries()) {
      const payout = await this.payoutRepo.findByTxid(txid);
      if (payout && payout.status !== PayoutStatus.settled) {
        await this.payoutRepo.markSettled(payout.id);
        this.logger.log(
          `Payout ${payout.id} settled (txid ${txid}, amount ${settlement.amount})`,
        );
      }
    }

    // 3️⃣ For payouts awaiting evidence and past the publishing lag, decide on resend or park
    const now = new Date();
    const awaiting = await this.payoutRepo.findAwaitingEvidence(
      now,
      this.PUBLISHING_LAG_MS,
    );

    for (const payout of awaiting) {
      if (payout.txid && settlements.has(payout.txid)) {
        // Already settled – already handled above
        continue;
      }

      // Not in statement → proven absent → allowed to resend
      if (payout.attempts + 1 >= this.MAX_ATTEMPTS) {
        // Exhausted attempts – park for manual review
        await this.payoutRepo.incrementAttemptsAndMaybePark(
          payout.id,
          this.MAX_ATTEMPTS,
        );
        this.logger.warn(
          `Payout ${payout.id} attempts exhausted; parked for review`,
        );
        continue;
      }

      // Resend with the same deterministic txid
      const txid = payout.txid ?? this.deriveTxId(payout.orderId, payout.effectiveDate);
      let result: BankSendResult;
      try {
        result = await this.bankService.send({
          txid,
          amount: payout.amount,
          key: payout.supplierKey,
        });
      } catch (err) {
        this.logger.warn(
          `Resend threw unexpected error for payout ${payout.id}: ${err}`,
        );
        result = { outcome: 'transient_error' };
      }

      // Handle result (same logic as initial send, but we keep status 'sent' unless duplicate)
      switch (result.outcome) {
        case 'accepted':
        case 'duplicate':
          await this.payoutRepo.incrementAttemptsAndMaybePark(
            payout.id,
            this.MAX_ATTEMPTS,
          );
          // keep status as sent (already is)
          break;
        case 'transient_error':
          await this.payoutRepo.incrementAttemptsAndMaybePark(
            payout.id,
            this.MAX_ATTEMPTS,
          );
          break;
        case 'permanent_rejection':
          // Mark as failed
          await this.payoutRepo.updateAfterSend(
            payout.id,
            txid,
            PayoutStatus.failed,
            1,
          );
          break;
      }
    }
  }

  private enumerateDates(start: Date, end: Date): Date[] {
    const dates: Date[] = [];
    const cur = new Date(start);
    cur.setUTCHours(0, 0, 0, 0);
    const finish = new Date(end);
    finish.setUTCHours(0, 0, 0, 0);
    while (cur <= finish) {
      dates.push(new Date(cur));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return dates;
  }
}
