import { Injectable, Logger } from '@nestjs/common';
import { PayoutService, ReconcileWindow } from './payout.service.js';

@Injectable()
export class PayoutReconcileJob {
  private readonly logger = new Logger(PayoutReconcileJob.name);

  constructor(private readonly payoutService: PayoutService) {}

  async handleReconcile(): Promise<void> {
    const now = new Date();
    const from = new Date(now.getTime() - 15 * 60 * 1000);
    const window: ReconcileWindow = { from, to: now };
    this.logger.log(
      `Running payout reconciliation for window ${from.toISOString()} - ${now.toISOString()}`,
    );
    await this.payoutService.reconcile(window);
  }
}
