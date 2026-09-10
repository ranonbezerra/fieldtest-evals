import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service.js';
import { ProjectionRepository } from './projection.repository.js';

export interface DriftRepairReport {
  from: Date;
  to: Date;
  driftedOrders: number;
  rowsRepaired: number;
  driftedTotalsCompanies: number;
  totalsRecomputed: boolean;
}

const DEFAULT_WINDOW_HOURS = 24;
const DEFAULT_CRON = '*/5 * * * *';

/**
 * Scheduled drift repair: periodically compares the projection against the source
 * for a recent window and converges what disagrees, without a person noticing first.
 *
 * Window: DRIFT_REPAIR_WINDOW_HOURS (default 24). Schedule: DRIFT_REPAIR_CRON (default every 5 minutes).
 */
@Injectable()
export class DriftRepairService {
  private readonly logger = new Logger(DriftRepairService.name);
  private readonly windowMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly projection: ProjectionRepository,
  ) {
    const hours = Number(process.env.DRIFT_REPAIR_WINDOW_HOURS ?? DEFAULT_WINDOW_HOURS);
    this.windowMs = (Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_WINDOW_HOURS) * 3_600_000;
  }

  @Cron(process.env.DRIFT_REPAIR_CRON ?? DEFAULT_CRON)
  async run(): Promise<DriftRepairReport> {
    const to = new Date();
    const from = new Date(to.getTime() - this.windowMs);
    try {
      const report = await this.prisma.transaction(async (tx) => {
        const driftedOrderIds = await this.projection.findDriftedOrderIds(tx, from, to);
        let rowsRepaired = 0;
        if (driftedOrderIds.length > 0) {
          // The same idempotent re-derivation routine is the repair mechanism.
          rowsRepaired = await this.projection.rederiveWindow(tx, from, to);
        }
        const driftedCompanyIds = await this.projection.findTotalsDriftedCompanyIds(tx, from, to);
        let totalsRecomputed = false;
        if (driftedCompanyIds.length > 0) {
          await this.projection.recomputeTotals(tx);
          totalsRecomputed = true;
        }
        return {
          from,
          to,
          driftedOrders: driftedOrderIds.length,
          rowsRepaired,
          driftedTotalsCompanies: driftedCompanyIds.length,
          totalsRecomputed,
        };
      });
      if (report.driftedOrders > 0 || report.driftedTotalsCompanies > 0) {
        this.logger.warn(
          `Drift repaired: ${report.driftedOrders} order row(s), totals recomputed: ${report.totalsRecomputed} ` +
            `(window [${from.toISOString()}, ${to.toISOString()}])`,
        );
      }
      return report;
    } catch (error) {
      this.logger.error(
        `Drift repair failed for window [${from.toISOString()}, ${to.toISOString()}]: ${
          error instanceof Error ? error.stack : String(error)
        }`,
      );
      throw error;
    }
  }
}
