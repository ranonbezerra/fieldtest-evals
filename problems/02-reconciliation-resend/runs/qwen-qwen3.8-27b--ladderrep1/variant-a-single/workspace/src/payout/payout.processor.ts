import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { buildScheduledWindow, PayoutService } from './payout.service.js';

/**
 * The scheduled reconcile job: every 15 minutes, reconcile yesterday and
 * today. The window overlaps with the previous run by design; reconcile is
 * idempotent over it, so overlap is safe.
 */
@Injectable()
export class PayoutProcessor {
  constructor(private readonly payouts: PayoutService) {}

  @Cron('*/15 * * * *')
  async reconcileScheduledWindow(): Promise<void> {
    const now = new Date();
    await this.payouts.reconcile(buildScheduledWindow(now), now);
  }
}
