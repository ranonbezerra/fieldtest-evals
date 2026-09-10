import { Injectable } from '@nestjs/common';
import { RederivationRepository } from './rederivation.repository.js';
import { RederivationService } from './rederivation.service.js';

export interface DriftRepairReport {
  from: Date;
  to: Date;
  missingRows: number;
  staleRows: number;
  ordersRedriven: number;
  companiesRecounted: number;
}

const DEFAULT_WINDOW_HOURS = 24;

@Injectable()
export class DriftRepairService {
  constructor(
    private readonly rederivation: RederivationService,
    private readonly repo: RederivationRepository,
  ) {}

  // Detects divergence in the trailing window, then re-derives it from source.
  // The re-derivation is idempotent, so this is safe to run repeatedly.
  async run(now: Date = new Date()): Promise<DriftRepairReport> {
    const windowHours = Number(process.env.DRIFT_REPAIR_WINDOW_HOURS ?? DEFAULT_WINDOW_HOURS);
    const to = now;
    const from = new Date(now.getTime() - windowHours * 60 * 60 * 1000);

    const drift = await this.repo.countDrift(from, to);
    const redriven = await this.rederivation.rederive(from, to);

    return {
      from,
      to,
      missingRows: drift.missing,
      staleRows: drift.stale,
      ordersRedriven: redriven.ordersRedriven,
      companiesRecounted: redriven.companiesRecounted,
    };
  }
}
