import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PayoutService } from './payout.service.js';

@Injectable()
export class PayoutScheduler {
  private readonly logger = new Logger(PayoutScheduler.name);

  constructor(private readonly payoutService: PayoutService) {}

  // Runs every 15 minutes
  @Cron(CronExpression.EVERY_15_MINUTES)
  async handleReconcileCron(): Promise<void> {
    this.logger.log('Running scheduled payout reconciliation');
    const now = new Date();
    const start = new Date(now.getTime() - 30 * 60 * 1000); // look back 30 minutes to cover lag
    await this.payoutService.reconcile({ start, end: now });
  }
}
