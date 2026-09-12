import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PayoutRepository } from './payout.repository.js';
import { PayoutService } from './payout.service.js';
import { Provider } from '../provider.js';
import { PayoutStatus } from '@prisma/client';

@Injectable()
export class PayoutWorker implements OnModuleDestroy {
  private readonly POLL_INTERVAL_MS = 5_000;
  private readonly MAX_PROVIDER_ATTEMPTS = 3;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly repo: PayoutRepository,
    private readonly service: PayoutService,
    private readonly provider: Provider,
  ) {}

  async start() {
    // Kick off the periodic poller
    this.timer = setInterval(() => this.processMessages(), this.POLL_INTERVAL_MS);
    // Also run immediately on start
    await this.processMessages();
  }

  async onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  /** Main loop – processes a batch of pending messages */
  async processMessages() {
    const BATCH_SIZE = 10;
    const messages = await this.repo.fetchPendingMessages(BATCH_SIZE);
    for (const msg of messages) {
      // Try to claim the message; if another worker claimed it, skip.
      const claimed = await this.repo.claimMessage(msg.id);
      if (!claimed) continue;

      try {
        await this.handleMessage(msg);
      } catch (err) {
        // Log and continue – the message remains unprocessed for future retries
        // In a real system we would use a logger.
        console.error('Error processing payout message', err);
      }
    }
  }

  private async handleMessage(msg: { id: string; payoutId: string; attempts: number }) {
    // Load payout
    const payout = await this.repo.getPayout(msg.payoutId);

    // If payout already in a terminal state, just mark message processed.
    if (
      payout.status === PayoutStatus.COMPLETED ||
      payout.status === PayoutStatus.NEEDS_REVIEW
    ) {
      await this.repo.markMessageProcessed(msg.id);
      return;
    }

    // Transition from CREATED -> PROCESSING (guarded)
    const transitioned = await this.service.markProcessing(payout.id);
    if (!transitioned) {
      // Another worker may have taken it; skip.
      await this.repo.markMessageProcessed(msg.id);
      return;
    }

    // Attempt the external transfer
    try {
      const result = await this.provider.transfer({
        to: payout.destinationAddress,
        amount: payout.amount,
      });

      // Successful transfer – settle payout
      await this.service.settlePayout({
        payoutId: payout.id,
        txHash: result.txHash,
      });

      // Message is fully processed
      await this.repo.markMessageProcessed(msg.id);
    } catch (err: any) {
      // Provider failure – decide whether to retry or give up
      await this.repo.incrementAttempts(payout.id);

      if (payout.attempts + 1 >= this.MAX_PROVIDER_ATTEMPTS) {
        // Exhausted retries – move payout to review, keep reservation
        await this.service.failPayout(payout.id, err.message ?? 'Provider failure');
        await this.repo.markMessageProcessed(msg.id);
      } else {
        // Keep the message unprocessed so it will be retried later
        // (processedAt stays null)
      }
    }
  }
}
