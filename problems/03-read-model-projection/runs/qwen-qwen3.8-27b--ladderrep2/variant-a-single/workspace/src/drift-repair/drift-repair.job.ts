import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OperationsRepository } from '../operations/operations.repository';
import { ReprojectionService } from '../operations/reprojection.service';

export interface DriftRepairReport {
  windowFrom: Date;
  windowTo: Date;
  driftedOrders: number;
  driftedCompanies: number;
  repaired: { orders: number; companies: number } | null;
}

/**
 * Scheduled drift-repair job. Every `DRIFT_REPAIR_CRON` (default: every 5
 * minutes) it compares the projection against the source for the last
 * `DRIFT_REPAIR_WINDOW_DAYS` days (default 1) and re-derives the window when
 * anything disagrees. Drift is expected (a deploy mid-transaction, a manual
 * source fix); this job is what notices before a person does.
 */
@Injectable()
export class DriftRepairJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(DriftRepairJob.name);
  private enabled = true;
  private running = false;

  constructor(
    private readonly repo: OperationsRepository,
    private readonly reproject: ReprojectionService,
  ) {}

  onApplicationBootstrap(): void {
    this.enabled = (process.env.DRIFT_REPAIR_ENABLED ?? 'true') !== 'false';
  }

  @Cron(process.env.DRIFT_REPAIR_CRON ?? '*/5 * * * *')
  async runScheduled(): Promise<void> {
    if (!this.enabled || this.running) return;
    this.running = true;
    try {
      await this.run();
    } catch (err) {
      this.logger.error(`drift-repair run failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
    }
  }

  /** One compare-and-repair pass; also invoked directly from the tests. */
  async run(windowDays: number = Number(process.env.DRIFT_REPAIR_WINDOW_DAYS ?? '1')): Promise<DriftRepairReport> {
    const windowTo = new Date();
    const windowFrom = new Date(windowTo.getTime() - windowDays * 86_400_000);

    const [driftedOrders, driftedCompanies] = await Promise.all([
      this.repo.countDriftedOrders(windowFrom, windowTo),
      this.repo.countDriftedCompanies(windowFrom, windowTo),
    ]);

    let repaired: DriftRepairReport['repaired'] = null;
    if (driftedOrders > 0 || driftedCompanies > 0) {
      repaired = await this.reproject.rederive(windowFrom, windowTo);
    }

    const report: DriftRepairReport = { windowFrom, windowTo, driftedOrders, driftedCompanies, repaired };
    this.logger.log(
      `drift-repair window=[${windowFrom.toISOString()} .. ${windowTo.toISOString()}] ` +
        `driftedOrders=${driftedOrders} driftedCompanies=${driftedCompanies} repaired=${repaired ? 'yes' : 'no'}`,
    );
    return report;
  }
}
