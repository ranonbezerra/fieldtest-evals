import { Injectable } from '@nestjs/common';
import { ProjectionService } from '../projection/projection.service.ts';

@Injectable()
export class DriftService {
  constructor(private readonly projection: ProjectionService) {}

  /**
   * Run periodically (e.g. every 5 minutes via a cron job or external scheduler).
   * Compares projection vs source for the last `windowDays` and repairs discrepancies.
   */
  async runRepair(windowDays: number = 7) {
    return this.projection.repairDrift(windowDays);
  }
}
