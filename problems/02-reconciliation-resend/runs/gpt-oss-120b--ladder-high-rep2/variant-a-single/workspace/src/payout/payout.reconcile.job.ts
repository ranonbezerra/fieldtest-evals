import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '../schedule.mock.js';
import { PayoutService } from './payout.service.js';

@Injectable()
export class PayoutReconcileJob {
  private readonly logger = new Logger(PayoutReconcileJob.name);

  constructor(private readonly payoutService: PayoutService) {}

  /**
   * Runs every 15 minutes. The `window` is the current timestamp;
   * the service itself accounts for the publishing lag.
   */
  @Cron('*/15 * * * *')
  async handleCron(): Promise<void> {
    const now = new Date();
    this.logger.log(`Starting reconciliation job at ${now.toISOString()}`);
    await this.payoutService.reconcile(now);
  }
}
