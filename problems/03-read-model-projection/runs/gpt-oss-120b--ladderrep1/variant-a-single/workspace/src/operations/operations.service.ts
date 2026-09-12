import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { OperationsRepository } from './operations.repository';
import { Prisma } from '@prisma/client';

export interface DashboardFilters {
  companyId?: number | null;
  status?: string | null;
  startDate?: Date;
  endDate?: Date;
}

@Injectable()
export class OperationsService {
  constructor(private readonly repo: OperationsRepository) {}

  /**
   * Dashboard query – reads only the projection.
   */
  async getOperations(
    filters: DashboardFilters,
    page: number,
    pageSize: number,
  ) {
    const skip = (page - 1) * pageSize;
    return this.repo.fetchOperations(filters, skip, pageSize);
  }

  /**
   * Synchronous maintenance hook – must be called inside the same
   * transaction that writes the source `PaymentOrder`.
   *
   * The caller supplies the new/updated order data.
   */
  async handleOrderApproved(
    order: {
      id: number;
      companyId: number;
      workerId?: number | null;
      eventId?: number | null;
      status: string;
      amount: Prisma.Decimal;
      createdAt: Date;
      approvedAt?: Date | null;
    },
  ) {
    try {
      await this.repo.upsertOperationAndAdjustTotals(order);
    } catch (err) {
      throw new InternalServerErrorException('Failed to maintain projection');
    }
  }

  /**
   * Re‑derivation routine for an arbitrary date window.
   */
  async rederiveWindow(start: Date, end: Date) {
    await this.repo.rederiveProjection(start, end);
  }
}
