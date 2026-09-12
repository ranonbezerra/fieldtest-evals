import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OperationsDriftRepairService } from './operations-drift-repair.service.js';

@Injectable()
export class OperationsScheduler {
  private readonly logger = new Logger(OperationsScheduler.name);

  constructor(private readonly driftRepairService: OperationsDriftRepairService) {}

  // Run every 5 minutes
  @Cron('*/5 * * * *')
  async handleDriftRepair() {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    this.logger.log(`Starting drift repair for recent window`);
    try {
      await this.driftRepairService.repairWindow(oneHourAgo, now);
    } catch (error) {
      this.logger.error('Drift repair failed', error);
    }
  }
}
