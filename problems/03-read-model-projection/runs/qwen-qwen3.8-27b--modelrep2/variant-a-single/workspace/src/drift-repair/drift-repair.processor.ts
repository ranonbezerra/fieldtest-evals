import { Injectable, Logger } from '@nestjs/common';
import { DriftRepairService } from './drift-repair.service.js';

/**
 * Scheduled drift repair. Re-derives the most recent window on a fixed
 * interval; windows overlap on purpose because the re-derivation is idempotent.
 */
@Injectable()
export class DriftRepairProcessor {
  private readonly logger = new Logger(DriftRepairProcessor.name);
  private running = false;

  constructor(private readonly repair: DriftRepairService) {}

  async runScheduledRepair(): Promise<void> {
    if (this.running) return; // never overlap with itself
    this.running = true;
    try {
      const configuredWindow = Number(process.env.DRIFT_REPAIR_WINDOW_MINUTES);
      const windowMinutes = Number.isFinite(configuredWindow) && configuredWindow > 0 ? configuredWindow : 30;
      const to = new Date();
      const from = new Date(to.getTime() - windowMinutes * 60_000);
      const report = await this.repair.rederive(from, to);
      this.logger.log(
        `drift repair [${report.from}, ${report.to}): orders=${report.ordersInWindow} ` +
          `operations_corrected=${report.operationsCorrected} totals_corrected=${report.totalsCorrected}`,
      );
    } catch (error) {
      this.logger.error(`drift repair failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
