import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReDerivationService } from '../re-derivation/re-derivation.service.js';
import { DriftRepairRepository } from './drift-repair.repository.js';

const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface DriftRepairReport {
  window: { from: string; to: string };
  drifted_row_count: number;
  drifted_company_count: number;
  repaired: boolean;
}

/**
 * Scheduled drift repair: periodically compare projection against source for
 * a recent window and repair what disagrees. Drift (deploy mid-transaction,
 * manual data fix) is noticed by the system, not by a person.
 */
@Injectable()
export class DriftRepairService {
  private readonly logger = new Logger(DriftRepairService.name);
  private running = false;

  constructor(
    @Inject(ReDerivationService) private readonly reDerivation: ReDerivationService,
    @Inject(DriftRepairRepository) private readonly repository: DriftRepairRepository,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run(): Promise<DriftRepairReport | null> {
    if (this.running) {
      this.logger.warn('skipping drift repair: a previous run is still in progress');
      return null;
    }
    this.running = true;
    try {
      const to = new Date();
      const from = new Date(to.getTime() - WINDOW_MS);
      return await this.repairWindow(from, to);
    } catch (error) {
      this.logger.error(`drift repair failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    } finally {
      this.running = false;
    }
  }

  /** Compare [from, to] against the source and, if anything disagrees, re-derive it. */
  async repairWindow(from: Date, to: Date): Promise<DriftRepairReport> {
    const { driftedRows, driftedCompanies } = await this.repository.findDrift(from, to);
    const repaired = driftedRows.length > 0 || driftedCompanies.length > 0;
    if (repaired) {
      this.logger.warn(
        `drift detected (${driftedRows.length} rows, ${driftedCompanies.length} companies); ` +
          `re-deriving ${from.toISOString()}..${to.toISOString()}`,
      );
      await this.reDerivation.derive(from, to);
    }
    return {
      window: { from: from.toISOString(), to: to.toISOString() },
      drifted_row_count: driftedRows.length,
      drifted_company_count: driftedCompanies.length,
      repaired,
    };
  }
}
