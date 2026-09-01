import { Injectable } from '@nestjs/common';
// ASSUMPTION: @nestjs/schedule is not installed in the workspace; the import will resolve once the dependency is added.
import { Cron, CronExpression } from '@nestjs/schedule';
// ASSUMPTION: ../projections/projections.service and ../projections/projections.types cannot be resolved because those files have their own unresolved imports; they will resolve once the rest of the workspace compiles.
import { ProjectionsService } from '../projections/projections.service';
import type { DriftReport } from '../projections/projections.types';

@Injectable()
export class DriftRepairProcessor {
  constructor(private readonly projections: ProjectionsService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run(): Promise<void> {
    const to = new Date();
    const from = new Date(to.getTime() - 60 * 60 * 1000);
    await this.runForWindow(from, to);
  }

  async runForWindow(from: Date, to: Date): Promise<DriftReport> {
    return this.projections.repairDrift(from, to);
  }
}
