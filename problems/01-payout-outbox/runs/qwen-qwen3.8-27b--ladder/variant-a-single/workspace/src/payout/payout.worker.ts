// ASSUMPTION: payout.repository, payout.provider, and payout.types modules are expected to exist with the named exports used here.
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PayoutRepository } from './payout.repository';
import { PayoutProvider } from './payout.provider';
import { PayoutMessageType, MAX_RETRIES, RETRY_DELAY_MS } from './payout.types';

const WORKER_INTERVAL_MS = 5000;

@Injectable()
export class PayoutWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly repository: PayoutRepository,
    private readonly provider: PayoutProvider,
  ) {}

  onModuleInit(): void {
    this.start(WORKER_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(intervalMs: number): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.processMessages().catch((err) => {
        this.logger.error(`Worker tick failed: ${(err as Error).message}`, (err as Error).stack);
      });
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processMessages(): Promise<void> {
    const messages = await this.repository.findPendingMessages(new Date());

    for (const message of messages) {
      await this.processMessage(message);
    }
  }

  private async processMessage(
    message: { id: string; type: string; payload: unknown; attempts: number },
  ): Promise<void> {
    // Claim the message to handle at-least-once delivery safely
    await this.repository.markMessageProcessing(message.id);

    try {
      if (message.type === PayoutMessageType.PAYOUT_PROCESS) {
        const payload = message.payload as { payoutId: string };
        await this.processPayout(payload.payoutId);
      }

      await this.repository.markMessageProcessed(message.id);
    } catch (err) {
      const error = err as unknown as { code?: string; message: string };

      if (error.code === 'TRANSFER_FAILED' || error.code === 'TRANSFER_TIMEOUT') {
        const attempts = message.attempts + 1;

        if (attempts >= MAX_RETRIES) {
          const payload = message.payload as { payoutId: string };
          // Safe choice: mark needs_review. We do NOT know if the transfer
          // landed on-chain, so we must not release the reservation or
          // double-spend. An operator must reconcile manually.
          await this.repository.markPayoutNeedsReview(payload.payoutId);
          this.logger.warn(
            `Payout ${payload.payoutId}: ${attempts} retries exhausted without definitive outcome; marked needs_review. Funds remain reserved.`,
          );
          await this.repository.markMessageProcessed(message.id);
        } else {
          const nextAttemptAt = new Date(Date.now() + RETRY_DELAY_MS);
          await this.repository.scheduleRetry(message.id, attempts, nextAttemptAt);
          this.logger.warn(
            `Message ${message.id}: attempt ${attempts}/${MAX_RETRIES} failed, retrying at ${nextAttemptAt.toISOString()}`,
          );
        }
      } else {
        this.logger.error(
          `Message ${message.id}: unrecoverable error: ${error.message}`,
        );
        await this.repository.markMessageProcessed(message.id);
      }
    }
  }

  private async processPayout(payoutId: string): Promise<void> {
    const payout = await this.repository.findPayoutById(payoutId);

    if (!payout) {
      this.logger.error(`Payout ${payoutId} not found; cannot process`);
      return;
    }

    // Idempotency guard for at-least-once delivery:
    // if the transfer already completed, do nothing.
    if (payout.status === 'sent' || payout.status === 'completed') {
      this.logger.debug(`Payout ${payoutId} already ${payout.status}; skipping`);
      return;
    }

    await this.repository.updatePayoutStatus(payoutId, 'processing');

    const { txHash } = await this.provider.transfer({
      to: payout.destinationAddress,
      amount: payout.amount,
    });

    await this.repository.completePayout(payoutId, txHash);
  }
}
