import { Injectable, BadRequestException } from '@nestjs/common';
import { BankService, BankSendResult, Settlement } from '../bank/bank.service.js';
import { PayoutRepository } from './payout.repository.js';
import { PayoutStatus } from '@prisma/client';
import * as crypto from 'crypto';

export interface ReconcileWindow {
  start: Date;
  end: Date;
}

/**
 * Core business logic for payouts.
 * - No direct Prisma client usage (repository only).
 * - No raw SQL.
 */
@Injectable()
export class PayoutService {
  private static readonly PUBLISHING_LAG_MS = 30 * 60 * 1000; // 30 minutes

  constructor(
    private readonly repository: PayoutRepository,
    private readonly bank: BankService,
  ) {}

  /**
   * Derive a deterministic transaction id from stable order attributes.
   */
  private deriveTxId(payoutId: string, effectiveDate: Date): string {
    const hash = crypto.createHash('sha256');
    hash.update(`${payoutId}|${effectiveDate.toISOString()}`);
    return hash.digest('hex').substring(0, 32); // 32‑char hex string
  }

  /**
   * Sends all pending payouts respecting attempt limits.
   */
  async executePayments(): Promise<void> {
    const pending = await this.repository.findPending();

    for (const payout of pending) {
      const txid = this.deriveTxId(payout.id, payout.effectiveDate);
      // Store the derived txid once (idempotent)
      if (!payout.txid) {
        await this.repository.setTxId(payout.id, txid);
      }

      const result = await this.bank.send({
        txid,
        amount: payout.amount,
        key: payout.supplierKey,
      });

      await this.handleBankSendResult(payout.id, result);
    }
  }

  private async handleBankSendResult(
    payoutId: string,
    result: BankSendResult,
  ): Promise<void> {
    switch (result) {
      case 'accepted':
      case 'duplicate':
        // Successful – mark as SENT (if not already) and keep attempts as‑is.
        await this.repository.updateStatus(payoutId, PayoutStatus.SENT);
        break;
      case 'transient_error':
        // Outcome unknown – record attempt and keep status SENT for later reconciliation.
        await this.repository.incrementAttempts(payoutId);
        await this.repository.updateStatus(payoutId, PayoutStatus.SENT);
        break;
      case 'permanent_rejection':
        await this.repository.updateStatus(payoutId, PayoutStatus.FAILED);
        break;
      default:
        // Defensive programming – should never happen.
        throw new BadRequestException('Unknown bank send result');
    }
  }

  /**
   * Reconciliation job. Should be safe to run repeatedly over overlapping windows.
   */
  async reconcile(window: ReconcileWindow): Promise<void> {
    const { start, end } = window;

    // Gather statement entries for each day in the window.
    const statementMap = new Map<string, Settlement>(); // txid => settlement

    const dayMs = 24 * 60 * 60 * 1000;
    for (
      let d = new Date(start);
      d.getTime() <= end.getTime();
      d = new Date(d.getTime() + dayMs)
    ) {
      // eslint-disable-next-line no-await-in-loop
      const settlements = await this.bank.getStatement(d);
      for (const s of settlements) {
        statementMap.set(s.txid, s);
      }
    }

    // Process payouts that are in SENT state within the window.
    const payouts = await this.repository.findSentInWindow(start, end);

    for (const payout of payouts) {
      // If already settled, skip (idempotent).
      if (payout.status === PayoutStatus.SETTLED) {
        continue;
      }

      const txid = payout.txid;
      if (!txid) {
        // Should never happen – txid is derived before sending.
        continue;
      }

      const settlement = statementMap.get(txid);
      if (settlement) {
        // Matching settlement found – mark as settled.
        await this.repository.updateStatus(payout.id, PayoutStatus.SETTLED);
        continue;
      }

      // No settlement found – check if we are past publishing lag.
      const now = new Date();
      const lagThreshold = new Date(
        payout.effectiveDate.getTime() + PayoutService.PUBLISHING_LAG_MS,
      );

      if (now < lagThreshold) {
        // Still within lag window – do nothing, wait for next run.
        continue;
      }

      // Proven absent – attempt a resend if attempts < 5.
      const attempts = await this.repository.incrementAttempts(payout.id);
      if (attempts >= 5) {
        await this.repository.parkForReview(payout.id);
        continue;
      }

      // Resend using the same deterministic txid.
      const result = await this.bank.send({
        txid,
        amount: payout.amount,
        key: payout.supplierKey,
      });

      await this.handleBankSendResult(payout.id, result);
    }
  }
}
