import { Injectable, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PayoutService, PUBLISHING_LAG_MINUTES } from '../payout/payout.service';
import { PayoutRepository } from '../payout/payout.repository';
import { ReconcileWindow } from '../payout/payout.types';

@Injectable()
export class ReconcileSchedulerService {
  constructor(
    private readonly payoutService: PayoutService,
    @Inject(PayoutRepository) private readonly repo: PayoutRepository,
  ) {}

  @Cron(CronExpression.EVERY_15_MINUTES)
  async runReconcile(): Promise<void> {
    const end = new Date();
    const start = new Date(end.getTime() - PUBLISHING_LAG_MINUTES * 60 * 1000);
    const window: ReconcileWindow = { start, end };
    await this.payoutService.reconcile(window);
  }
}
