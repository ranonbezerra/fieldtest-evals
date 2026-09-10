import { Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import type { DriftReport, RederiveResult } from './operations.dto.js';
import { OperationsProjectionRepository } from './operations-projection.repository.js';

/**
 * Re-derivation of the read model for an arbitrary [from, to) date window,
 * and the drift-repair routine (detect + repair) built on top of it.
 */
@Injectable()
export class OperationsReconciliationService {
  constructor(private readonly projection: OperationsProjectionRepository) {}

  rederiveWindow(from: Date, to: Date): Promise<RederiveResult> {
    this.assertWindow(from, to);
    return this.projection.rederiveWindow(from, to);
  }

  repairDriftWindow(from: Date, to: Date): Promise<DriftReport> {
    this.assertWindow(from, to);
    return this.projection.repairDriftWindow(from, to);
  }

  private assertWindow(from: Date, to: Date): void {
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw ApiError.invalidRequest('Window bounds must be valid dates.');
    }
    if (to.getTime() <= from.getTime()) {
      throw ApiError.invalidRequest('Window "to" must be strictly after "from".');
    }
  }
}
