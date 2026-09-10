import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PayoutService } from './payout.service';

@Injectable()
export class PayoutWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly pollIntervalMs: number;

  constructor(private readonly service: PayoutService) {
    this.pollIntervalMs = parseInt(process.env.PAYOUT_POLL_INTERVAL_MS ?? '5000', 10);
  }

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.service.processMessages().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Error processing messages: ${msg}`);
      });
    }, this.pollIntervalMs);
    this.logger.log(`Payout worker started, polling every ${this.pollIntervalMs}ms`);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
