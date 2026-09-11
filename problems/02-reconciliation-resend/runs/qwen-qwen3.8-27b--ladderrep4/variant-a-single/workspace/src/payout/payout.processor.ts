import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { dateKey, startOfUtcDay } from './dates.util.js';
import { PayoutService } from './payout.service.js';
import type { DateWindow } from './payout.types.js';

const DAY_MS = 86_400_000;

/**
 * The scheduled reconcile job.
 *
 * Runs every 15 minutes over yesterday + today — a window that overlaps the
 * previous run by design; reconcile() is idempotent, so the overlap settles
 * nothing twice.
 */
@Injectable()
export class PayoutProcessor {
  private readonly logger = new Logger(PayoutProcessor.name);

  constructor(private readonly service: PayoutService) {}

  @Cron('*/15 * * * *')
  async runScheduledReconcile(): Promise<void> {
    const now = new Date();
    const window: DateWindow = {
      from: startOfUtcDay(new Date(now.getTime() - DAY_MS)),
      to: startOfUtcDay(now),
    };
    try {
      const summary = await this.service.reconcile(window, now);
      this.logger.log(
        `reconciled ${dateKey(window.from)}..${dateKey(window.to)}: ` +
          `settled=${summary.settled} rescheduled=${summary.rescheduled} parked=${summary.parked}`,
      );
    } catch (err) {
      // The next run re-covers the same window; log loudly, do not crash the process.
      this.logger.error(`scheduled reconcile failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
