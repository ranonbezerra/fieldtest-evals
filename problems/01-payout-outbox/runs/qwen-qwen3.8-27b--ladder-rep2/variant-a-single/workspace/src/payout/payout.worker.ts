import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PayoutService } from './payout.service.js';

const DEFAULT_INTERVAL_MS = 5_000;

/**
 * Polls the outbox on a fixed interval (PAYOUT_WORKER_INTERVAL_MS). All
 * funds-safety logic lives in PayoutService; this class only schedules the
 * ticks. A single scheduler is assumed.
 */
@Injectable()
export class PayoutWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutWorker.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly payouts: PayoutService) {}

  onModuleInit(): void {
    const intervalMs = Number(process.env.PAYOUT_WORKER_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
    this.timer = setInterval(() => {
      this.payouts
        .processMessages()
        .catch((error: unknown) => {
          this.logger.error(`processMessages tick failed: ${error instanceof Error ? error.message : String(error)}`);
        });
    }, intervalMs);
    // Do not keep the process alive just for the poller.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }
}
