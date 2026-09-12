import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { PayoutService } from './payout.service';

/**
 * Polling worker: drives PayoutService.processMessages() every N ms.
 * Blockchain transfers are NEVER executed inside an HTTP request — the
 * request only reserves funds and queues the outbox message.
 */
@Injectable()
export class PayoutWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PayoutWorker.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(@Inject(PayoutService) private readonly payoutService: PayoutService) {}

  onApplicationBootstrap(): void {
    const intervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5_000);
    this.timer = setInterval(() => {
      this.payoutService.processMessages().catch((error: unknown) => {
        this.logger.error(`worker pass failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, intervalMs);
    this.timer.unref();
    this.logger.log(`polling payout messages every ${intervalMs} ms`);
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
