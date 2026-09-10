import { Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error';
import { OperationsRepository } from './operations.repository';

const BATCH_SIZE = 500;

/**
 * Re-derivation for an arbitrary date window [from, to). Rebuilds the
 * projection rows and the affected companies' totals from the source tables.
 * Safe to run while the system is live (short per-batch transactions, no
 * shared locks) and idempotent (absolute-value writes): running it twice over
 * the same window leaves the same result.
 */
@Injectable()
export class ReprojectionService {
  constructor(private readonly repo: OperationsRepository) {}

  async rederive(from: Date, to: Date): Promise<{ orders: number; companies: number }> {
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from.getTime() >= to.getTime()) {
      throw new ApiError(400, 'validation_failed', 're-derivation window: from must be a date earlier than to', {
        from: from.toISOString(),
        to: to.toISOString(),
      });
    }
    let cursor = 0;
    let orders = 0;
    const companies = new Set<number>();
    for (;;) {
      const batch = await this.repo.rederiveBatch(from, to, cursor, BATCH_SIZE);
      if (batch.length === 0) break;
      orders += batch.length;
      for (const b of batch) companies.add(b.companyId);
      cursor = batch[batch.length - 1].orderId;
      if (batch.length < BATCH_SIZE) break;
    }
    return { orders, companies: companies.size };
  }
}
