import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { OperationReadModelRepository } from './operation-read-model.repository';
import {
  CompanyTotals,
  DateWindow,
  InvalidParameterError,
  OperationUpsertInput,
  OperationsPage,
  OperationsQueryInput,
  ResourceNotFoundError,
} from './operation-read-model.types';

@Injectable()
export class OperationReadModelService {
  constructor(
    private readonly repo: OperationReadModelRepository,
    private readonly prisma: PrismaClient,
  ) {}

  // Maintenance hook for the write path. The write service calls this inside the
  // same transaction that commits its source mutation, so the projection row is
  // committed together with it and visible to the very next read (read-your-own-writes).
  // This method must not open its own transaction or await anything external.
  async upsertOperation(input: OperationUpsertInput): Promise<void> {
    const source = await this.prisma.paymentOrder.findUnique({
      where: { orderId: input.orderId },
    });
    if (source === null) {
      throw new ResourceNotFoundError(
        `payment order ${input.orderId} no longer exists in the source tables`,
      );
    }
    await this.repo.upsert(input);
  }

  // Maintenance hook for order deletion. Idempotent: removing an order that has
  // no projection row is a no-op.
  async deleteOperation(orderId: bigint): Promise<void> {
    await this.repo.remove(orderId);
  }

  // Dashboard read. Validates the input, then serves the page entirely from the
  // projection; source tables are never touched on this path.
  async queryOperations(query: OperationsQueryInput): Promise<OperationsPage> {
    this.validateQuery(query);
    return this.repo.findPage(query);
  }

  // Exact per-company financial totals, computed as a fresh SUM over committed
  // projection rows at read time. Never a cached counter, so concurrent updates
  // can never be lost or approximated.
  async totalsForCompany(companyId: bigint): Promise<CompanyTotals> {
    return this.repo.totalsForCompany(companyId);
  }

  // Re-derives the projection for [from, to) from the source tables. Atomic and
  // idempotent: overlapping or repeated windows converge to the same rows, so a
  // missed or doubled drift-repair tick is harmless.
  async rederiveWindow(window: DateWindow): Promise<number> {
    // ASSUMPTION: the plan's ResourceNotFoundError for "a re-derivation window
    // contains no derivable rows and the caller expected them" has no expressible
    // trigger in the planned signature (there is no expectation flag), so an
    // empty window is treated as a valid idempotent no-op that returns 0.
    return this.repo.rederiveWindow(window);
  }

  private validateQuery(query: OperationsQueryInput): void {
    if (query.page < 1) {
      throw new InvalidParameterError('page must be at least 1');
    }
    if (query.pageSize < 1 || query.pageSize > 200) {
      throw new InvalidParameterError('pageSize must be between 1 and 200');
    }
    if (
      query.fromDate !== undefined &&
      query.toDate !== undefined &&
      query.fromDate > query.toDate
    ) {
      throw new InvalidParameterError('fromDate must not be after toDate');
    }
  }
}
