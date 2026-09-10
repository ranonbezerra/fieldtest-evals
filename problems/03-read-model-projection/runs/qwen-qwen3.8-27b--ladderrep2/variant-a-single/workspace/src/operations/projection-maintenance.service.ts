import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ApiError } from '../common/api-error';
import { emptyTotalsDelta } from '../common/types';
import type { Status } from '../common/types';
import { OperationsRepository } from './operations.repository';

/**
 * Synchronous projection maintenance hooks. The write services call these
 * with the transaction client of the write's own transaction, so the
 * projection update commits or rolls back atomically with the source write.
 */
@Injectable()
export class ProjectionMaintenanceService {
  constructor(private readonly repo: OperationsRepository) {}

  onOrderCreated(tx: Prisma.TransactionClient, orderId: number): Promise<void> {
    return this.apply(tx, orderId, { created: true, from: 'pending', to: 'pending' });
  }

  onOrderStatusChanged(tx: Prisma.TransactionClient, orderId: number, from: Status, to: Status): Promise<void> {
    return this.apply(tx, orderId, { created: false, from, to });
  }

  private async apply(
    tx: Prisma.TransactionClient,
    orderId: number,
    change: { created: boolean; from: Status; to: Status },
  ): Promise<void> {
    const row = await this.repo.recomputeOperationRow(orderId, tx);
    if (!row) {
      throw new ApiError(
        409,
        'conflict',
        `Payment order ${orderId} disappeared while its projection was being maintained`,
        { orderId },
      );
    }
    // The row is written as an absolute snapshot of the source: idempotent,
    // so the hook, re-derivation and drift repair all converge on the same state.
    await this.repo.upsertOperationRow(row, tx);
    // The totals delta is derived from the transition itself, never from a
    // read of the current totals, so there is no read-modify-write race.
    const delta = emptyTotalsDelta();
    if (change.created) {
      delta[change.to] = { count: 1, amountCents: row.amountCents };
    } else {
      delta[change.from] = { count: -1, amountCents: -row.amountCents };
      delta[change.to] = { count: 1, amountCents: row.amountCents };
    }
    await this.repo.applyTotalsDelta(row.companyId, delta, tx);
  }
}
