import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { readPositiveInt } from '../common/env.js';
import { PayoutRepository, type ClaimedMessage } from './payout.repository.js';
import { PayoutService } from './payout.service.js';

/**
 * Polling worker: claims due outbox messages and hands them to the service.
 * `processMessages()` runs every PAYOUT_POLL_INTERVAL_MS (default 5000).
 * Delivery is at-least-once (including re-claims past the claim lease); the
 * service makes redelivery safe.
 */
@Injectable()
export class PayoutWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutWorker.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly repository: PayoutRepository,
    private readonly service: PayoutService,
  ) {}

  onModuleInit(): void {
    const intervalMs = readPositiveInt(process.env.PAYOUT_POLL_INTERVAL_MS, 5000);
    this.timer = setInterval(() => {
      void this.processMessages().catch((err: unknown) => {
        this.logger.error(`processMessages failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, intervalMs);
    // Do not keep the process alive on the poller alone (matters for tests).
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
  }

  /** One poll cycle: claim a batch of due messages and process each. */
  async processMessages(): Promise<number> {
    const leaseMs = readPositiveInt(process.env.PAYOUT_CLAIM_TIMEOUT_MS, 60_000);
    const batchSize = readPositiveInt(process.env.PAYOUT_BATCH_SIZE, 10);
    const claimed = await this.repository.claimMessages(batchSize, leaseMs);
    for (const message of claimed) {
      await this.guardedProcess(message);
    }
    return claimed.length;
  }

  /**
   * Deliver one specific message now (also how at-least-once redelivery is
   * simulated). No-op if the message is already DONE or DEAD.
   */
  async processMessage(messageId: string): Promise<void> {
    const claimed = await this.repository.claimMessageById(messageId);
    if (claimed === null) return;
    await this.guardedProcess(claimed);
  }

  private async guardedProcess(message: ClaimedMessage): Promise<void> {
    try {
      await this.service.processPayoutMessage(message.id, message.payload, message.attempts);
    } catch (err) {
      // The message stays PROCESSING; the lease-based re-claim in the next
      // processMessages() will pick it up (at-least-once).
      this.logger.error(`message ${message.id} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
