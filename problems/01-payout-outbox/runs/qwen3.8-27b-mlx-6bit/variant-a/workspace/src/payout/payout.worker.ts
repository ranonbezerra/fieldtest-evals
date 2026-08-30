import { Injectable, Logger } from '@nestjs/common';
import { PayoutService } from './payout.service';
import { PayoutRepository } from './payout.repository';

// ASSUMPTION: the plan does not specify a poll batch size; 10 messages per cycle.
const POLL_BATCH_SIZE = 10;

@Injectable()
export class PayoutWorker {
  private readonly logger = new Logger(PayoutWorker.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly service: PayoutService,
    private readonly repo: PayoutRepository,
  ) {}

  /**
   * Single poll cycle: fetch pending messages, claim each, and hand the
   * claimed ones to the service. A failure on one message must not stop the
   * rest of the cycle.
   */
  async processMessages(): Promise<void> {
    const messages = await this.repo.findPendingMessages(POLL_BATCH_SIZE);

    for (const message of messages) {
      try {
        const claimed = await this.repo.claimMessage(message.id);
        if (claimed === null) {
          // Already claimed by a concurrent worker; nothing to do.
          continue;
        }
        await this.service.processMessage(message.id);
      } catch (err) {
        this.logger.error(
          `Failed to process payout message ${message.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * Starts the polling interval. Called by the module on init.
   */
  start(intervalMs: number): void {
    if (this.timer !== null) {
      return;
    }

    this.timer = setInterval(() => {
      this.processMessages().catch((err) => {
        this.logger.error(
          `Payout poll cycle failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, intervalMs);
  }

  /**
   * Stops the polling interval. Called by the module on destroy.
   */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
