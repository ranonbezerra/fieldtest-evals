import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PayoutRepository } from './payout.repository.js';
import { ProviderService } from '../provider/provider.service.js';
import { PayoutStatus } from '@prisma/client';

@Injectable()
export class PayoutWorker implements OnModuleInit, OnModuleDestroy {
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly INTERVAL_MS = 5_000; // poll every 5 seconds
  private readonly BATCH_SIZE = 10;

  constructor(
    private readonly repo: PayoutRepository,
    private readonly provider: ProviderService,
  ) {}

  onModuleInit() {
    this.interval = setInterval(() => this.processMessages(), this.INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.interval) clearInterval(this.interval);
  }

  private async processMessages() {
    const messages = await this.repo.findPendingMessages(this.BATCH_SIZE);
    for (const msg of messages) {
      // Guard against double processing
      const statusUpdated = await this.repo.updatePayoutStatus(
        msg.payoutId,
        PayoutStatus.CREATED,
        PayoutStatus.PROCESSING,
      );
      if (!statusUpdated) {
        // Already being processed or processed; mark message done
        await this.repo.markMessageDone(msg.id);
        continue;
      }

      const payout = await this.repo.findPayoutById(msg.payoutId);
      if (!payout) {
        await this.repo.markMessageDone(msg.id);
        continue;
      }

      try {
        const result = await this.provider.transfer({
          to: payout.destination_address,
          amount: payout.amount,
        });

        // Provider returned txHash – treat as confirmation
        await this.repo.setPayoutTxHash(payout.id, result.txHash);
        await this.repo.finalizeSettlement(payout.id, payout.amount);
        await this.repo.updatePayoutStatus(
          payout.id,
          PayoutStatus.PROCESSING,
          PayoutStatus.COMPLETED,
        );
        await this.repo.markMessageDone(msg.id);
      } catch (err: any) {
        // Provider failure handling
        await this.repo.incrementMessageAttempts(msg);
        if (msg.attempts + 1 >= msg.max_attempts) {
          // Exhausted retries – move payout to review, keep reservation
          await this.repo.setPayoutNeedsReview(payout.id);
          await this.repo.failMessage(msg.id);
        }
        // else leave as pending for next attempt
      }
    }
  }
}
