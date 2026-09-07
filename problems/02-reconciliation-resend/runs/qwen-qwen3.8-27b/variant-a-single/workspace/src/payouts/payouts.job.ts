import { Cron, CronExpression } from '@nestjs/schedule';
import { Injectable, Logger } from '@nestjs/common';
import { PayoutsService } from './payouts.service';

@Injectable()
export class PayoutsJob {
  private readonly logger = new Logger(PayoutsJob.name);

  constructor(private readonly service: PayoutsService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async executePayments(): Promise<void> {
    try {
      const result = await this.service.executePayments();
      this.logger.log(`executePayments: ${JSON.stringify(result)}`);
    } catch (error) {
      this.logger.error(`executePayments failed: ${describe(error)}`);
    }
  }

  /**
   * Runs every 15 minutes over [now - lag - 30min, now - lag]: 15 minutes of
   * overlap with the previous run, ending exactly where the bank's statements
   * are trustworthy again (past the publishing lag). Overlap is safe because
   * reconcile is idempotent.
   */
  @Cron(CronExpression.EVERY_15_MINUTES)
  async reconcile(): Promise<void> {
    try {
      const result = await this.service.reconcile();
      this.logger.log(`reconcile: ${JSON.stringify(result)}`);
    } catch (error) {
      this.logger.error(`reconcile failed: ${describe(error)}`);
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
