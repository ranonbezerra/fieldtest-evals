// ASSUMPTION: The truncated leading compiler error named an implicit-any parameter 'r' in this file, but the original source is not visible; per PLAN.md this processor only delegates to ProjectionsService.repairDrift, and this rewrite declares every parameter explicitly.
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { ProjectionsService } from '../projections/projections.service';
import type { DriftReport } from '../projections/projections.types';

const DEFAULT_WINDOW_MS = 60 * 60 * 1000; // last 1 hour

@Injectable()
export class DriftRepairProcessor {
  constructor(private readonly projections: ProjectionsService) {}

  /** Scheduled repair of the default window (last 1 hour). */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async run(): Promise<void> {
    const to: Date = new Date();
    const from: Date = new Date(to.getTime() - DEFAULT_WINDOW_MS);
    await this.runForWindow(from, to);
  }

  /** Manual trigger for an explicit window. */
  runForWindow(from: Date, to: Date): Promise<DriftReport> {
    return this.projections.repairDrift(from, to);
  }
}
