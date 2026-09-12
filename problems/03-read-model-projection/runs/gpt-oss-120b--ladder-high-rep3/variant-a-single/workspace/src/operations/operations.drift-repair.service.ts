import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OperationsService } from './operations.service.js';

@Injectable()
export class OperationsDriftRepairService {
  constructor(private readonly opsService: OperationsService) {}

  /**
   * Runs every 10 minutes to ensure the projection stays in sync with the
   * source tables.
   */
  @Cron('0 */10 * * * *')
  async handleCron() {
    await this.opsService.repairDrift();
  }
}
