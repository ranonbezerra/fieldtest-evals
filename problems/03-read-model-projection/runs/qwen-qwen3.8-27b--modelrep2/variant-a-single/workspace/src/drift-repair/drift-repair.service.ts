import { Injectable } from '@nestjs/common';
import { Operation, OrderStatus, Prisma } from '@prisma/client';
import { FinancialTotalsRepository } from '../financial-totals/financial-totals.repository.js';
import { OperationRow, OperationsRepository } from '../operations/operations.repository.js';
import { DriftRepairRepository } from './drift-repair.repository.js';

export interface DriftRepairReport {
  from: string;
  to: string;
  ordersInWindow: number;
  companiesRebuilt: number;
  operationsCorrected: number;
  totalsCorrected: number;
  driftDetected: boolean;
}

@Injectable()
export class DriftRepairService {
  constructor(
    private readonly repository: DriftRepairRepository,
    private readonly operations: OperationsRepository,
    private readonly totals: FinancialTotalsRepository,
  ) {}

  /**
   * Re-derives the projection for an arbitrary window [from, to): every order
   * created in the window, or with an event occurring in the window, gets its
   * row rebuilt from the source of truth, and the financial totals of the
   * affected companies are recomputed in full. Idempotent — safe to overlap
   * and to run twice; reports what was actually corrected.
   */
  rederive(from: Date, to: Date): Promise<DriftRepairReport> {
    return this.repository.withTransaction(async (tx) => {
      const orders = await this.repository.sourceOrdersInWindow(tx, from, to);
      const orderIds = orders.map(order => order.id);
      const companyIds = [...new Set(orders.map(order => order.companyId))];

      const currentOperations = await this.repository.projectionOperations(tx, orderIds);
      const currentTotals = await this.repository.projectionTotals(tx, companyIds);
      const currentOperationById = new Map(currentOperations.map(row => [row.id, row]));
      const currentTotalByKey = new Map(currentTotals.map(row => [totalKey(row.companyId, row.status), row]));

      let operationsCorrected = 0;
      for (const order of orders) {
        const row: OperationRow = {
          id: order.id,
          companyId: order.companyId,
          workerId: order.workerId,
          workerName: order.worker.name,
          status: order.status,
          amount: order.amount,
          currency: order.currency,
          lastEventAt: lastActivityAt(order.createdAt, order.events.map(event => event.occurredAt)),
        };
        const before = currentOperationById.get(order.id);
        if (!before || !operationRowMatches(before, row)) {
          operationsCorrected += 1;
        }
        await this.operations.upsertOperation(tx, row);
      }

      const expectedTotals = await this.repository.sourceTotalsByCompany(tx, companyIds);
      const expectedTotalByKey = new Map(expectedTotals.map(row => [totalKey(row.companyId, row.status), row]));
      let totalsCorrected = 0;
      const allKeys = new Set([...currentTotalByKey.keys(), ...expectedTotalByKey.keys()]);
      for (const key of allKeys) {
        const current = currentTotalByKey.get(key);
        const expected = expectedTotalByKey.get(key);
        const currentCount = current?.orderCount ?? 0;
        const expectedCount = expected?.orderCount ?? 0;
        const currentAmount = current?.totalAmount ?? new Prisma.Decimal(0);
        const expectedAmount = expected?.totalAmount ?? new Prisma.Decimal(0);
        if (currentCount !== expectedCount || !currentAmount.equals(expectedAmount)) {
          totalsCorrected += 1;
        }
      }
      await this.totals.replaceForCompanies(tx, companyIds, expectedTotals);

      return {
        from: from.toISOString(),
        to: to.toISOString(),
        ordersInWindow: orders.length,
        companiesRebuilt: companyIds.length,
        operationsCorrected,
        totalsCorrected,
        driftDetected: operationsCorrected > 0 || totalsCorrected > 0,
      };
    });
  }
}

function totalKey(companyId: string, status: OrderStatus): string {
  return `${companyId}|${status}`;
}

/** Recency key = creation time or the latest event, whichever is later. */
function lastActivityAt(createdAt: Date, eventTimes: Date[]): Date {
  return eventTimes.reduce((latest, time) => (time > latest ? time : latest), createdAt);
}

function operationRowMatches(row: Operation, expected: OperationRow): boolean {
  return (
    row.companyId === expected.companyId &&
    row.workerId === expected.workerId &&
    row.workerName === expected.workerName &&
    row.status === expected.status &&
    row.amount.equals(expected.amount) &&
    row.currency === expected.currency &&
    row.lastEventAt.getTime() === expected.lastEventAt.getTime()
  );
}
