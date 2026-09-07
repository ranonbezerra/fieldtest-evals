import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { WORKER_CONFIG, WorkerConfig } from './payout.config';
import { PayoutRepository } from './payout.repository';
import { PayoutService } from './payout.service';

/**
 * Polls the outbox table every N seconds (WORKER_INTERVAL_MS) and processes due
 * messages. Delivery is at-least-once; every handler is idempotent.
 */
@Injectable()
export class PayoutWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutWorker.name);
  private timer?: NodeJS.Timeout;
  private inFlight = false;

  constructor(
    private readonly repo: PayoutRepository,
    private readonly service: PayoutService,
    @Inject(WORKER_CONFIG) private readonly config: WorkerConfig,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.runPass();
    }, this.config.intervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async runPass(): Promise<void> {
    try {
      await this.processMessages();
    } catch (err) {
      this.logger.error(`poll pass failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** One poll pass: atomically claim due messages and process each idempotently. */
  async processMessages(): Promise<number> {
    if (this.inFlight) return 0;
    this.inFlight = true;
    let processed = 0;
    try {
      for (let i = 0; i < this.config.batchSize; i++) {
        const message = await this.repo.claimNextDueMessage(this.config.leaseMs);
        if (!message) break;
        try {
          await this.service.processMessage(message);
        } catch (err) {
          this.logger.error(
            `message ${message.id} (${message.kind}) failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          try {
            await this.service.handleMessageError(message, err);
          } catch (err2) {
            this.logger.error(
              `failed to record error state for message ${message.id}: ${err2 instanceof Error ? err2.message : String(err2)}`,
            );
          }
        }
        processed++;
      }
    } finally {
      this.inFlight = false;
    }
    return processed;
  }
}
