import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { OperationsService, type DriftRepairResult } from './operations.service.js';

/**
 * Scheduled backstop: periodically compares the read model against the source
 * tables and re-derives anything that drifted. Cadence comes from
 * DRIFT_REPAIR_INTERVAL_MS; 0 disables the scheduler (e.g. when an external
 * cron drives the re-derivation endpoint instead).
 */
@Injectable()
export class OperationsDriftRepairJob implements OnApplicationBootstrap, OnModuleDestroy {
  private static readonly logger = new Logger(OperationsDriftRepairJob.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly operations: OperationsService) {}

  onApplicationBootstrap(): void {
    const intervalMs = Number(process.env.DRIFT_REPAIR_INTERVAL_MS ?? 60_000);
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return;
    this.timer = setInterval(() => {
      this.runOnce().catch((err: unknown) => {
        OperationsDriftRepairJob.logger.error(
          `drift repair run failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, intervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<DriftRepairResult> {
    return this.operations.repairDrift();
  }
}
