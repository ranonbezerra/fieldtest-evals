import { Injectable, Logger } from '@nestjs/common';
import { PayoutRepository } from './payout.repository';
import { PayoutProvider } from './payout.provider';
import { CreatePayoutInput } from './payout.types';

// ASSUMPTION: CreatePayoutInput has fields { accountId: string; amount: bigint; destinationAddress: string; idempotencyKey: string }
// ASSUMPTION: PayoutProvider exposes transfer(to: string, amount: bigint) => Promise<{ txHash: string }>

@Injectable()
export class PayoutService {
  private readonly logger = new Logger(PayoutService.name);
  private static readonly MAX_RETRIES = 3;

  constructor(
    private readonly repository: PayoutRepository,
    private readonly provider: PayoutProvider,
  ) {}

  async createPayout(input: CreatePayoutInput) {
    // The repository performs the atomic check-and-reserve inside a DB transaction.
    // Idempotency is enforced by a unique index on idempotencyKey.
    const payout = await this.repository.createPayout(input);
    this.logger.log(
      `Payout ${payout.id} created for account ${input.accountId}, amount=${input.amount}`,
    );
    return payout;
  }

  async processMessages(): Promise<void> {
    // ASSUMPTION: repository.findPendingMessages returns an array of objects
    // with at least { id, payoutId, destinationAddress, amount, attemptCount }.
    const messages = await this.repository.findPendingMessages();

    for (const message of messages) {
      await this.processMessage(message);
    }
  }

  private async processMessage(
    message: {
      id: string;
      payoutId: string;
      destinationAddress: string;
      amount: bigint;
      attemptCount: number;
    },
  ): Promise<void> {
    await this.repository.markMessageProcessing(message.id);

    try {
      const result = await this.provider.transfer(
        message.destinationAddress,
        message.amount,
      );

      // Provider confirmed — settle the ledger entry and mark completed.
      await this.repository.completePayout(message.payoutId, result.txHash);
      this.logger.log(
        `Payout ${message.payoutId} completed: txHash=${result.txHash}`,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const nextAttempt = message.attemptCount + 1;

      if (nextAttempt >= PayoutService.MAX_RETRIES) {
        // Retries exhausted without a definitive outcome.
        // Safe choice: mark needs-review. The reserved funds are neither
        // released nor settled, so no double-spend is possible. A human
        // operator must verify on-chain whether the transfer went through
        // before deciding to release or confirm.
        await this.repository.markPayoutNeedsReview(message.payoutId, reason);
        this.logger.warn(
          `Payout ${message.payoutId} marked needs-review after ${PayoutService.MAX_RETRIES} attempts: ${reason}`,
        );
      } else {
        await this.repository.incrementMessageRetry(message.id, reason);
      }
    }
  }
}
