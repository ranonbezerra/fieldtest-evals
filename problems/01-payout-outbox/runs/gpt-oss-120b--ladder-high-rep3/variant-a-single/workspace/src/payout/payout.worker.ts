import { Injectable, Logger } from '@nestjs/common';
import { PayoutRepository } from './payout.repository';
import { TransferProvider } from '../provider/transfer.provider';
import { PayoutStatus, OutboxMessage } from '@prisma/client';

@Injectable()
export class PayoutWorker {
  private readonly logger = new Logger(PayoutWorker.name);

  constructor(
    private readonly payoutRepository: PayoutRepository,
    private readonly transferProvider: TransferProvider,
  ) {}

  // Called periodically (e.g. via a cron). Processes a limited batch of messages.
  async processMessages(limit = 10): Promise<void> {
    const messages = await this.payoutRepository.findPendingMessages(limit);
    for (const message of messages) {
      await this.handleMessage(message);
    }
  }

  private async handleMessage(message: OutboxMessage): Promise<void> {
    const payout = await this.payoutRepository.getPayoutById(message.payoutId);
    if (!payout) {
      // No payout – nothing to do.
      await this.payoutRepository.markMessageProcessed(message.id);
      return;
    }

    // Idempotent guard: if the payout is already in a terminal state, just mark the message processed.
    if (
      [
        PayoutStatus.SENT,
        PayoutStatus.COMPLETED,
        PayoutStatus.FAILED,
        PayoutStatus.NEEDS_REVIEW,
      ].includes(payout.status as any)
    ) {
      await this.payoutRepository.markMessageProcessed(message.id);
      return;
    }

    // Transition to PROCESSING so other workers know work is underway.
    await this.payoutRepository.updatePayoutStatus(payout.id, PayoutStatus.PROCESSING);

    try {
      const result = await this.transferProvider.transfer(payout.destinationAddress, payout.amount);
      // Transfer succeeded – mark as SENT and store txHash.
      await this.payoutRepository.updatePayoutStatus(payout.id, PayoutStatus.SENT, result.txHash);
      // Settlement (debit settled balance, release reservation, ledger entry).
      await this.payoutRepository.settlePayout(payout);
      // Message handled – mark processed.
      await this.payoutRepository.markMessageProcessed(message.id);
    } catch (err) {
      // Transient failure – increment attempts.
      const newAttempts = message.attempts + 1;
      await this.payoutRepository.setMessageAttempts(message.id, newAttempts);

      if (newAttempts >= message.maxAttempts) {
        // Exhausted retries – move payout to NEEDS_REVIEW, keep reservation.
        await this.payoutRepository.updatePayoutStatus(payout.id, PayoutStatus.NEEDS_REVIEW);
        // Mark the message processed so the worker stops retrying.
        await this.payoutRepository.markMessageProcessed(message.id);
      }
      // Otherwise the message stays unprocessed and will be retried later.
    }
  }
}
