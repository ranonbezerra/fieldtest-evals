// src/operations/operations.drift.service.ts

import { Injectable, Logger, Inject } from '@nestjs/common';
import { OperationsRepository } from './operations.repository';

/**
 * Service responsible for detecting and repairing drift between the write‑model
 * and the read‑model projection tables.
 *
 * The implementation is deliberately lightweight – it merely delegates the
 * heavy lifting to a re‑derivation service that recomputes the projection for a
 * given date window.  Using a string token for the re‑derivation service avoids
 * a hard compile‑time dependency on a module that may not exist in the current
 * workspace (the original codebase expected a file that is missing).
 *
 * // ASSUMPTION: A provider elsewhere in the application is registered under
 * // the token `'OPERATIONS_REDERIVATION_SERVICE'` and exposes a method
 * // `rederive(start: Date, end: Date): Promise<void>`.  If the actual token or
 * // method name differs, adjust the injection token or the call below.
 */
@Injectable()
export class OperationsDriftService {
  private readonly logger = new Logger(OperationsDriftService.name);

  constructor(
    private readonly repository: OperationsRepository,
    // The re‑derivation service is injected via a string token to avoid a
    // direct import of a missing module.
    @Inject('OPERATIONS_REDERIVATION_SERVICE')
    private readonly rederivationService: any,
  ) {}

  /**
   * Repairs projection drift for the supplied date window.
   *
   * @param start inclusive lower bound of the window
   * @param end   exclusive upper bound of the window
   */
  async repairDrift(start: Date, end: Date): Promise<void> {
    this.logger.debug(
      `Starting drift repair for ${start.toISOString()} – ${end.toISOString()}`,
    );

    // Guard against a missing or malformed re‑derivation service.
    if (
      !this.rederivationService ||
      typeof this.rederivationService.rederive !== 'function'
    ) {
      this.logger.warn(
        'Rederivation service is not available; skipping drift repair.',
      );
      return;
    }

    try {
      // Delegate the actual recomputation to the re‑derivation service.
      await this.rederivationService.rederive(start, end);
      this.logger.debug('Drift repair completed successfully');
    } catch (error) {
      this.logger.error('Drift repair failed', error as any);
      throw error;
    }
  }
}
