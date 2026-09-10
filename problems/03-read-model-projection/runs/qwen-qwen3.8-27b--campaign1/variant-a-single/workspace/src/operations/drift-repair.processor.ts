import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OperationsRepository } from './operations.repository';

@Injectable()
export class DriftRepairProcessor {
  private readonly logger = new Logger(DriftRepairProcessor.name);

  constructor(
    private readonly operationsRepository: OperationsRepository,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleDriftRepair(): Promise<void> {
    this.logger.log('Starting scheduled drift repair...');
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - 1);
    const windowEnd = new Date();

    const repairedCount = await this.operationsRepository.repairDrift(
      windowStart,
      windowEnd,
    );
    this.logger.log(
      `Drift repair complete. Repaired ${repairedCount} rows.`,
    );
  }
}
