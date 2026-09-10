import { Inject, Injectable, Logger } from '@nestjs/common';
import { DomainException } from '../common/domain-exception.js';
import { ReDerivationRepository } from './re-derivation.repository.js';

const MAX_ATTEMPTS = 3;

export interface DeriveResult {
  from: string;
  to: string;
  rows_rebuilt: number;
}

@Injectable()
export class ReDerivationService {
  private readonly logger = new Logger(ReDerivationService.name);

  constructor(@Inject(ReDerivationRepository) private readonly repository: ReDerivationRepository) {}

  /**
   * Rebuilds the projection for orders created in [from, to] from the source
   * tables and recomputes ALL per-company totals. Both steps are full-value
   * overwrites, so running the routine twice over the same window leaves the
   * same state. The transaction is SERIALIZABLE with a bounded retry on
   * serialization conflicts, which makes it safe to run while the system is
   * live.
   */
  async derive(from: Date, to: Date): Promise<DeriveResult> {
    if (from.getTime() > to.getTime()) {
      throw new DomainException(400, 'validation_failed', 'from must not be later than to', {
        from: from.toISOString(),
        to: to.toISOString(),
      });
    }

    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.repository.withSerializableTransaction(async (tx) => {
          await this.repository.deleteRowsInWindow(tx, from, to);
          const rowsRebuilt = await this.repository.insertRowsFromSource(tx, from, to);
          await this.repository.rebuildAllTotals(tx);
          return { from: from.toISOString(), to: to.toISOString(), rows_rebuilt: rowsRebuilt };
        });
      } catch (error) {
        if (attempt < MAX_ATTEMPTS && isSerializationConflict(error)) {
          this.logger.warn(`serialization conflict on attempt ${attempt}/${MAX_ATTEMPTS}; retrying derive`);
          await sleep(25 * attempt);
          continue;
        }
        throw error;
      }
    }
  }
}

function isSerializationConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === '40001' || code === '40P01' || code === 'P2034') return true;
  return typeof message === 'string' && /serializ/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
