import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AppError } from '../common/app-error.js';
import { ProjectionRepository } from './projection.repository.js';

export interface RederiveResult {
  from: Date;
  to: Date;
  companies: number;
  operationsRows: number;
}

export interface DriftRepairResult {
  from: Date;
  to: Date;
  discrepancies: {
    operationsStale: number;
    operationsOrphan: number;
    totalsCompanies: number;
  };
  repaired: boolean;
  companiesRecomputed: number;
  operationsRowsRebuilt: number;
}

@Injectable()
export class ProjectionService {
  private readonly logger = new Logger(ProjectionService.name);
  private repairInFlight = false;

  constructor(private readonly projection: ProjectionRepository) {}

  /** Rebuilds the projection for an arbitrary [from, to) window from source. Idempotent. */
  rederive(from: Date, to: Date): Promise<RederiveResult> {
    this.assertWindow(from, to);
    return this.projection.rebuildWindow(from, to).then(({ companies, operationsRows }) => ({
      from,
      to,
      companies,
      operationsRows,
    }));
  }

  /** Compares the projection against source for the window and repairs what disagrees. */
  async repairDrift(from: Date, to: Date): Promise<DriftRepairResult> {
    this.assertWindow(from, to);
    const drift = await this.projection.findDrift(from, to);
    const discrepancies = {
      operationsStale: drift.operationsStale,
      operationsOrphan: drift.operationsOrphan,
      totalsCompanies: drift.totalsCompanies.length,
    };
    if (drift.operationsStale === 0 && drift.operationsOrphan === 0 && drift.totalsCompanies.length === 0) {
      return { from, to, discrepancies, repaired: false, companiesRecomputed: 0, operationsRowsRebuilt: 0 };
    }
    const { companies, operationsRows } = await this.projection.rebuildWindow(from, to, drift.totalsCompanies);
    this.logger.log(
      `drift repaired: window=${from.toISOString()}..${to.toISOString()} stale=${drift.operationsStale} orphan=${drift.operationsOrphan} totalsCompanies=${drift.totalsCompanies.length}`,
    );
    return {
      from,
      to,
      discrepancies,
      repaired: true,
      companiesRecomputed: companies,
      operationsRowsRebuilt: operationsRows,
    };
  }

  /** The window the scheduled job covers: the last DRIFT_REPAIR_WINDOW_HOURS hours. */
  defaultWindow(): { from: Date; to: Date } {
    const hours = Number(process.env.DRIFT_REPAIR_WINDOW_HOURS);
    const to = new Date();
    const from = new Date(to.getTime() - (Number.isFinite(hours) && hours > 0 ? hours : 24) * 3_600_000);
    return { from, to };
  }

  @Cron(process.env.DRIFT_REPAIR_CRON ?? '0 * * * *')
  async scheduledDriftRepair(): Promise<void> {
    if (this.repairInFlight) {
      this.logger.warn('previous drift repair still running; skipping this tick');
      return;
    }
    this.repairInFlight = true;
    try {
      const { from, to } = this.defaultWindow();
      const result = await this.repairDrift(from, to);
      this.logger.log(`scheduled drift repair complete (repaired=${result.repaired})`);
    } catch (error) {
      this.logger.error(`scheduled drift repair failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.repairInFlight = false;
    }
  }

  private assertWindow(from: Date, to: Date): void {
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new AppError(400, 'validation_failed', 'The window bounds must be valid timestamps.', {
        from: String(from),
        to: String(to),
      });
    }
    if (from.getTime() >= to.getTime()) {
      throw new AppError(400, 'validation_failed', 'The window `from` must be strictly before `to`.', {
        from: from.toISOString(),
        to: to.toISOString(),
      });
    }
  }
}
