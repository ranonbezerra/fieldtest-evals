import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PayoutService } from '../payout/payout.service.js';

@Injectable()
export class ReconcileService {
  private readonly logger = new Logger(ReconcileService.name);
  private static readonly RECONCILE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

  constructor(private readonly payoutService: PayoutService) {}

  @Cron(CronExpression.EVERY_15_MINUTES)
  async handleReconcile(): Promise<void> {
    const now = new Date();
    const from = new Date(now.getTime() - ReconcileService.RECONCILE_WINDOW_MS);
    const to = now;
    this.logger.debug(`Running reconciliation window ${from.toISOString()} - ${to.toISOString()}`);
    await this.payoutService.reconcile({ from, to });
  }
}
