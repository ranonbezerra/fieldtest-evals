import { Injectable, Logger } from '@nestjs/common';
import { PayoutRepository } from './payout.repository.js';
import { BankService, Settlement } from '../bank/bank.service.js';
import { Payout, PayoutStatus } from '@prisma/client';
import { createHash } from 'crypto';

interface ReconcileWindow {
  start: Date;
  end: Date;
}

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);
  private readonly publishingLagMs = 30 * 60 * 1000; // 30 minutes

  constructor(
    private readonly payoutRepository: PayoutRepository,
    private readonly bankService: BankService,
  ) {}

  /**
   * Derive a deterministic txid from stable payout attributes.
   */
  private deriveTxId(payout: Payout): string {
    const data = `${payout.id}-${payout.supplierId}-${payout.amount}-${payout.effectiveDate.toISOString()}`;
    return createHash('sha256').update(data).digest('hex');
  }

  private async handleBankSend(payout: Payout, txid: string): Promise<void> {
    const payload = {
      txid,
      amount: payout.amount,
      key: payout.key,
    };

    let result;
    try {
      result = await this.bankService.send(payload);
    } catch (err) {
      this.logger.error(`Bank send error for payout ${payout.id}: ${err}`);
      await this.recordTransientFailure(payout);
      return;
    }

    switch (result.status) {
      case 'accepted':
      case 'duplicate':
        await this.recordSendSuccess(payout);
        break;
      case 'transient_error':
        await this.recordTransientFailure(payout);
        break;
      case 'permanent_rejection':
        await this.recordPermanentRejection(payout);
        break;
      default:
        this.logger.warn(`Unexpected bank send result for payout ${payout.id}: ${JSON.stringify(result)}`);
        await this.recordTransientFailure(payout);
        break;
    }
  }

  private async recordSendSuccess(payout: Payout): Promise<void> {
    const now = new Date();
    const attemptCount = (payout.attemptCount ?? 0) + 1;
    await this.payoutRepository.updatePayout(payout.id, {
      status: PayoutStatus.SENT_PENDING,
      attemptCount,
      lastAttemptAt: now,
    });
  }

  private async recordTransientFailure(payout: Payout): Promise<void> {
    const now = new Date();
    const attemptCount = (payout.attemptCount ?? 0) + 1;
    const data: Partial<Payout> = {
      status: PayoutStatus.SENT_PENDING,
      attemptCount,
      lastAttemptAt: now,
    };
    if (attemptCount >= 5) {
      data.status = PayoutStatus.PARKED;
    }
    await this.payoutRepository.updatePayout(payout.id, data);
  }

  private async recordPermanentRejection(payout: Payout): Promise<void> {
    await this.payoutRepository.updatePayout(payout.id, {
      status: PayoutStatus.PARKED,
    });
  }

  /**
   * Sends all pending payouts.
   * Only payouts with status PENDING are considered.
   */
  async executePayments(): Promise<void> {
    const pending = await this.payoutRepository.findPendingPayouts();
    for (const payout of pending) {
      const txid = this.deriveTxId(payout);
      if (!payout.txid || payout.txid !== txid) {
        await this.payoutRepository.setTxId(payout.id, txid);
      }
      await this.handleBankSend(payout, txid);
    }
  }

  /**
   * Reconciles payouts against the bank statement for the given window.
   */
  async reconcile(window: ReconcileWindow): Promise<void> {
    const { start, end } = window;
    // Retrieve statement entries for the start date (assumed to cover the window).
    const statement = await this.bankService.getStatement(start);
    const settlementMap = new Map<string, Settlement>();
    for (const settlement of statement) {
      settlementMap.set(settlement.txid, settlement);
    }

    const payouts = await this.payoutRepository.findSentPendingPayoutsWithinWindow(start, end);
    const now = new Date();

    for (const payout of payouts) {
      // Skip if already settled (should not be present, but defensive).
      if (payout.status === PayoutStatus.SETTLED) {
        continue;
      }

      const txid = payout.txid || this.deriveTxId(payout);
      const settlement = settlementMap.get(txid);

      if (settlement) {
        await this.payoutRepository.updatePayout(payout.id, { status: PayoutStatus.SETTLED });
        this.logger.log(`Payout ${payout.id} settled (txid ${txid})`);
        continue;
      }

      // No settlement found – check if publishing lag has passed.
      if (!payout.lastAttemptAt) {
        // No attempt timestamp; nothing to reconcile.
        continue;
      }

      const ageMs = now.getTime() - payout.lastAttemptAt.getTime();
      if (ageMs < this.publishingLagMs) {
        // Still within lag window; wait for next run.
        continue;
      }

      // If attempts exhausted, park for manual review.
      if ((payout.attemptCount ?? 0) >= 5) {
        await this.payoutRepository.updatePayout(payout.id, { status: PayoutStatus.PARKED });
        continue;
      }

      // Resend with the same deterministic txid.
      await this.handleBankSend(payout, txid);
    }
  }
}
