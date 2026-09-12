import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OperationsRepository } from './operations.repository';

@Injectable()
export class DriftRepairJob {
  private readonly logger = new Logger(DriftRepairJob.name);

  constructor(private readonly repo: OperationsRepository) {}

  // Runs every hour at minute 0.
  @Cron(CronExpression.EVERY_HOUR)
  async handle() {
    this.logger.log('Starting drift‑repair job');
    try {
      await this.repo.repairDrift();
      this.logger.log('Drift‑repair job completed successfully');
    } catch (err) {
      this.logger.error('Drift‑repair job failed', err);
    }
  }
}
