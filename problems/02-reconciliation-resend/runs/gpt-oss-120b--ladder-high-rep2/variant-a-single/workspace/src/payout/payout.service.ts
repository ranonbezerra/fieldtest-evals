import { Injectable, Logger } from '@nestjs/common';
import {
  BankService,
  BankSendResult,
  Settlement,
} from '../bank/bank.service.js';
import { PayoutRepository } from './payout.repository.js';
import { Payout, PayoutStatus } from '@prisma/client';
import { createHash } from 'crypto';

const PUBLISHING_LAG_MINUTES = 30;
const MAX_ATTEMPTS = 5;

/**
 * Deterministically derive a transaction ID from a payout.
 * Uses SHA‑256 over `${payout.id}|${payout.effectiveDate}` and takes the first 16 hex chars.
 */
function deterministicTxId(payout: Payout): string {
  const input = `${payout.id}|${payout.effectiveDate.toISOString()}`;
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);

  constructor(
    private readonly payoutRepository: PayoutRepository,
    private readonly bankService: BankService,
  ) {}

  /** Sends all pending payouts. */
  async executePayments(): Promise<void> {
    const pending = await this.payoutRepository.findPendingPayouts();

    for (const payout of pending) {
      const txid = deterministicTxId(payout);
      let result: BankSendResult;

      try {
        result = await this.bankService.send({
          txid,
          amount: payout.amount,
          key: payout.supplierKey,
        });
      } catch (error) {
        this.logger.error(
          `Bank send exception for payout ${payout.id}: ${error}`,
        );
        result = 'transient_error';
      }

      await this.handleSendResult(payout, txid, result);
    }
  }

  /** Core logic for handling the result of a send attempt. */
  private async handleSendResult(
    payout: Payout,
    txid: string,
    result: BankSendResult,
  ): Promise<void> {
    // Increment attempts for *any* outcome (including successes).
    await this.payoutRepository.incrementAttempts(payout.id);
    const updateData: Partial<Payout> = { txid };

    switch (result) {
      case 'accepted':
      case 'duplicate':
        await this.payoutRepository.updateStatus(
          payout.id,
          PayoutStatus.sent,
          updateData,
        );
        break;
      case 'transient_error':
        await this.payoutRepository.updateStatus(
          payout.id,
          PayoutStatus.waiting_evidence,
          updateData,
        );
        break;
      case 'permanent_rejection':
        await this.payoutRepository.updateStatus(
          payout.id,
          PayoutStatus.permanent_rejection,
          updateData,
        );
        break;
      default:
        this.logger.warn(
          `Unhandled bank send result '${result}' for payout ${payout.id}`,
        );
    }

    // Enforce attempts cap.
    const refreshed = await this.payoutRepository.findById(payout.id);
    if (
      refreshed &&
      refreshed.attempts >= MAX_ATTEMPTS &&
      refreshed.status !== PayoutStatus.settled &&
      refreshed.status !== PayoutStatus.exhausted
    ) {
      await this.payoutRepository.updateStatus(
        payout.id,
        PayoutStatus.exhausted,
        { txid },
      );
    }
  }

  /** Reconciliation job. Matches bank statements to payouts and triggers safe resends. */
  async reconcile(window: Date): Promise<void> {
    let settlements: Settlement[];
    try {
      settlements = await this.bankService.getStatement(window);
    } catch (error) {
      this.logger.error(
        `Bank getStatement exception for window ${window.toISOString()}: ${error}`,
      );
      return;
    }

    // 1️⃣  Match statement entries to payouts.
    for (const settlement of settlements) {
      const payout = await this.payoutRepository.findByTxId(settlement.txid);
      if (!payout) {
        this.logger.warn(
          `Settlement with unknown txid ${settlement.txid} received`,
        );
        continue;
      }

      if (payout.status === PayoutStatus.settled) {
        continue; // already settled, skip.
      }

      if (payout.amount !== settlement.amount) {
        this.logger.warn(
          `Amount mismatch for payout ${payout.id}: payout ${payout.amount} vs settlement ${settlement.amount}`,
        );
        // Proceed to settle – business rule is to trust the bank's amount.
      }

      await this.payoutRepository.updateStatus(payout.id, PayoutStatus.settled);
    }

    // 2️⃣  Identify payouts awaiting evidence that are past publishing lag.
    const awaiting = await this.payoutRepository.findAwaitingEvidencePayouts();
    const now = new Date();

    for (const payout of awaiting) {
      // If the payout has already been settled by the previous loop, skip.
      if (payout.status === PayoutStatus.settled) {
        continue;
      }

      const lagThreshold =
        payout.updatedAt.getTime() + PUBLISHING_LAG_MINUTES * 60 * 1000;
      if (now.getTime() < lagThreshold) {
        // Still within publishing lag – cannot prove absence yet.
        continue;
      }

      // Proven absent – decide whether to resend or exhaust.
      if (payout.attempts < MAX_ATTEMPTS) {
        const txid = payout.txid ?? deterministicTxId(payout);
        let result: BankSendResult;
        try {
          result = await this.bankService.send({
            txid,
            amount: payout.amount,
            key: payout.supplierKey,
          });
        } catch (error) {
          this.logger.error(
            `Bank resend exception for payout ${payout.id}: ${error}`,
          );
          result = 'transient_error';
        }

        await this.handleResendResult(payout, txid, result);
      } else {
        // Attempts exhausted – park for manual review.
        await this.payoutRepository.updateStatus(
          payout.id,
          PayoutStatus.exhausted,
        );
      }
    }
  }

  /** Handles the result of a resend attempt (identical handling to the initial send). */
  private async handleResendResult(
    payout: Payout,
    txid: string,
    result: BankSendResult,
  ): Promise<void> {
    await this.payoutRepository.incrementAttempts(payout.id);
    const updateData: Partial<Payout> = { txid };

    switch (result) {
      case 'accepted':
      case 'duplicate':
        await this.payoutRepository.updateStatus(
          payout.id,
          PayoutStatus.sent,
          updateData,
        );
        break;
      case 'transient_error':
        await this.payoutRepository.updateStatus(
          payout.id,
          PayoutStatus.waiting_evidence,
          updateData,
        );
        break;
      case 'permanent_rejection':
        await this.payoutRepository.updateStatus(
          payout.id,
          PayoutStatus.permanent_rejection,
          updateData,
        );
        break;
      default:
        this.logger.warn(
          `Unhandled resend result '${result}' for payout ${payout.id}`,
        );
    }

    // Enforce attempts cap after the resend.
    const refreshed = await this.payoutRepository.findById(payout.id);
    if (
      refreshed &&
      refreshed.attempts >= MAX_ATTEMPTS &&
      refreshed.status !== PayoutStatus.settled &&
      refreshed.status !== PayoutStatus.exhausted
    ) {
      await this.payoutRepository.updateStatus(
        payout.id,
        PayoutStatus.exhausted,
        { txid },
      );
    }
  }
}
