import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DriftRepairService } from './drift-repair.service.js';

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// Scheduled drift-repair job: periodically counts diverged rows in the trailing
// window and re-derives it, bounding the impact of anything the sync hooks
// missed to a single repair interval.
@Injectable()
export class DriftRepairScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DriftRepairScheduler.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly driftRepair: DriftRepairService) {}

  onModuleInit(): void {
    const intervalMs = Number(process.env.DRIFT_REPAIR_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      this.logger.warn('invalid DRIFT_REPAIR_INTERVAL_MS, drift repair is disabled');
      return;
    }
    this.timer = setInterval(() => {
      this.driftRepair
        .run()
        .then((report) => {
          this.logger.log(
            `drift repair: missing=${report.missingRows} stale=${report.staleRows} ` +
              `ordersRedriven=${report.ordersRedriven} companiesRecounted=${report.companiesRecounted}`,
          );
        })
        .catch((err: unknown) => {
          this.logger.error(`drift repair failed: ${err instanceof Error ? err.message : String(err)}`);
        });
    }, intervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
