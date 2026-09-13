import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '../nestjs-schedule.js';
import { OperationsService } from '../operations/operations.service.js';

@Injectable()
export class RepairScheduler {
  private readonly logger = new Logger(RepairScheduler.name);
  constructor(private readonly opsService: OperationsService) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleCron() {
    this.logger.log('Running drift‑repair job');
    try {
      await this.opsService.repairDrift(1);
      this.logger.log('Drift‑repair job completed');
    } catch (err) {
      this.logger.error('Drift‑repair job failed', err);
    }
  }
}
