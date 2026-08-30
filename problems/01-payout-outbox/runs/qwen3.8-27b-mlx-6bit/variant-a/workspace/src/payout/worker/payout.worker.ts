import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PayoutService } from '../payout.service.js';

const DEFAULT_POLL_MS = 1000;

/**
 * Polling worker: drives pending payout messages through the provider on a
 * fixed interval. Starts and stops with the Nest app lifecycle.
 */
@Injectable()
export class PayoutWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutWorker.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly service: PayoutService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.tick();
    }, this.getPollMs());
  }

  onModuleDestroy(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private getPollMs(): number {
    const parsed = Number(this.config.get<string>('PAYOUT_POLL_MS'));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_POLL_MS;
  }

  private async tick(): Promise<void> {
    try {
      await this.service.processMessages();
    } catch (error) {
      // A failed tick must not kill the worker; the next poll retries.
      this.logger.error(
        `payout worker tick failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
