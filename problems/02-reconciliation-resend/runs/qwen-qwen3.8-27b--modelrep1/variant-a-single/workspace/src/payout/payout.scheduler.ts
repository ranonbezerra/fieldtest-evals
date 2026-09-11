import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PayoutConfig, PAYOUT_CONFIG } from './payout.config.js';
import { PayoutService } from './payout.service.js';

/**
 * Reconciliation job. Every 15 minutes it re-reads the statement history
 * ending at `now - publishingLag` (so every statement fetched is complete)
 * and reaching back `reconcileSpanMs` (so consecutive windows overlap),
 * then lets executePayments release the newly proven-absent orders for resend.
 */
@Injectable()
export class PayoutScheduler {
  private readonly logger = new Logger(PayoutScheduler.name);

  constructor(
    private readonly service: PayoutService,
    @Inject(PAYOUT_CONFIG) private readonly config: PayoutConfig,
  ) {}

  @Cron('*/15 * * * *')
  async tick(): Promise<void> {
    const to = new Date(Date.now() - this.config.publishingLagMs);
    const from = new Date(to.getTime() - this.config.reconcileSpanMs);
    try {
      const reconciled = await this.service.reconcile({ from, to });
      const executed = await this.service.executePayments();
      this.logger.log(`reconcile=${JSON.stringify(reconciled)} execute=${JSON.stringify(executed)}`);
    } catch (error) {
      // The next tick retries; state writes are guarded, so a partial failure
      // can never double-advance an order.
      this.logger.error(`payout run failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
