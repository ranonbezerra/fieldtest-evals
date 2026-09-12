import { Injectable } from '@nestjs/common';
import { OperationsProjectionRepository } from './operations-projection.repository.js';
import { Prisma, PaymentOrder } from '@prisma/client';

@Injectable()
export class OperationsProjectionService {
  constructor(private readonly repo: OperationsProjectionRepository) {}

  /**
   * Syncs the projection for a single order. Must be called inside the same
   * transaction that updates the source order.
   */
  async syncOrder(
    tx: Prisma.TransactionClient,
    order: PaymentOrder,
  ): Promise<void> {
    // Upsert projection row
    await this.repo.upsertOperationProjection(tx, {
      order_id: order.id,
      company_id: order.company_id,
      worker_id: order.worker_id ?? null,
      status: order.status,
      amount: order.amount,
      created_at: order.created_at,
      updated_at: order.updated_at,
    });

    // Update company totals atomically if the order became approved.
    if (order.status === 'approved') {
      await this.repo.upsertCompanyTotal(tx, {
        company_id: order.company_id,
        amount: order.amount,
      });
    }
    // In a full implementation, handle status transitions away from approved.
  }
}
