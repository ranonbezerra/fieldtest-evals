import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { CLOCK, Clock, PAYOUT_CONFIG, PayoutConfig } from './payout.constants.js';
import { PayoutService } from './payout.service.js';

/**
 * Scheduled reconcile: every interval (default 15 minutes) over a window
 * (default 45 minutes), so consecutive windows overlap by 30 minutes.
 * reconcile() is idempotent, so overlapping windows — and any accidental
 * re-run — cannot change what an earlier run already settled.
 */
@Injectable()
export class PayoutReconcileJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutReconcileJob.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly service: PayoutService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PAYOUT_CONFIG) private readonly config: PayoutConfig,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.config.reconcileIntervalMs);
    this.logger.log(
      `reconcile scheduled every ${this.config.reconcileIntervalMs}ms over a ${this.config.reconcileWindowMs}ms window`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One reconcile pass. A failed pass is logged and retried on the next tick. */
  async runOnce(): Promise<void> {
    if (this.running) {
      this.logger.warn('previous reconcile still running; skipping tick');
      return;
    }
    this.running = true;
    try {
      const now = this.clock.now();
      const report = await this.service.reconcile({
        from: new Date(now.getTime() - this.config.reconcileWindowMs),
        to: now,
      });
      this.logger.log(
        `reconciled: settlements=${report.settlements} settled=${report.settled} resends=${report.resends} ` +
          `parked=${report.parked} rejected=${report.rejected} stillUnknown=${report.stillUnknown} ` +
          `amountMismatches=${report.amountMismatches}`,
      );
    } catch (error) {
      this.logger.error(`reconcile run failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
