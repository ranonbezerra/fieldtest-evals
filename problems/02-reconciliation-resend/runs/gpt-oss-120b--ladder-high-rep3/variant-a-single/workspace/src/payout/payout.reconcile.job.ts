import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PayoutService } from './payout.service.js';

@Injectable()
export class PayoutReconcileJob {
  private readonly logger = new Logger(PayoutReconcileJob.name);
  private readonly intervalMs = 15 * 60 * 1000; // 15 minutes
  private readonly publishingLagMs = 30 * 60 * 1000; // 30 minutes

  constructor(private readonly payoutService: PayoutService) {}

  @Cron('*/15 * * * *')
  async handleCron(): Promise<void> {
    const now = new Date();
    // Overlapping window: start a bit earlier to guarantee coverage.
    const start = new Date(now.getTime() - this.publishingLagMs - this.intervalMs);
    const end = now;
    this.logger.debug(`Running reconcile for window ${start.toISOString()} – ${end.toISOString()}`);
    await this.payoutService.reconcile({ start, end });
  }
}
