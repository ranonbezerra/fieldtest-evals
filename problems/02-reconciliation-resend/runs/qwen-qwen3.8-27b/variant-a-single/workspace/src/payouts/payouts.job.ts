import { Injectable } from '@nestjs/common';
import { PayoutsService } from './payouts.service';

// ASSUMPTION: @nestjs/schedule is not installed; scheduling is handled externally (infrastructure cron or a controller trigger). The reconcile logic is idempotent and safe for overlapping windows.

@Injectable()
export class PayoutsJob {
  constructor(private readonly payoutsService: PayoutsService) {}

  // ASSUMPTION: PayoutsService.reconcile accepts a window parameter of type { from: Date; to: Date }.

  async runReconciliation(): Promise<void> {
    const to = new Date();
    const from = new Date(to.getTime() - 45 * 60 * 1000);
    await this.payoutsService.reconcile({ from, to });
  }
}
