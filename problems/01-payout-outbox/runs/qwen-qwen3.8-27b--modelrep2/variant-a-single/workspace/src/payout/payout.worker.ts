import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { PayoutConfigService } from './payout.config.service.js';
import { PayoutRepository } from './payout.repository.js';
import { PayoutService } from './payout.service.js';

@Injectable()
export class PayoutWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PayoutWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly payouts: PayoutRepository,
    private readonly service: PayoutService,
    private readonly config: PayoutConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.workerEnabled) {
      this.logger.log('Outbox worker disabled via PAYOUT_OUTBOX_WORKER_DISABLED');
      return;
    }
    this.timer = setInterval(() => void this.tick(), this.config.outboxPollMs);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return; // one in-flight pass at a time
    this.running = true;
    try {
      await this.processMessages();
    } catch (err) {
      this.logger.error(`Outbox poll failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
    }
  }

  async processMessages(): Promise<number> {
    let processed = 0;
    for (;;) {
      const message = await this.payouts.claimMessage(new Date());
      if (!message) break;
      try {
        await this.service.processMessage(message.id);
      } catch (err) {
        this.logger.error(
          `Delivery of outbox message ${message.id} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      processed += 1;
    }
    return processed;
  }
}
