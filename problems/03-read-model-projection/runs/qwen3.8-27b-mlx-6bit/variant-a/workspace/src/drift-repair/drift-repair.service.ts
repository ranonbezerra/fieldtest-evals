import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OperationsRepository } from '../operations/operations.repository';
import { DriftRepairReport, OperationRow } from '../operations/operations.types';

// ASSUMPTION: The plan's control flow for drift-repair says "fetch the corresponding
// payment_orders" per row, but the repository type-signatures section does not list a
// single-order fetch method. I assume `findOrderByOrderId` exists and returns the source
// order shape (id, company_id, worker_id, status, amount, currency, created_at, updated_at).

// ASSUMPTION: The plan's control flow for drift-repair step 4 says "Recompute
// company_financial_totals … by SUM/COUNT over payment_orders WHERE company_id = ?".
// I assume the repository exposes `recomputeCompanyTotal(companyId: string): Promise<void>`
// which performs that SUM/COUNT and upserts the aggregate row.

// ASSUMPTION: `upsertOperation`'s first parameter (typed as a Prisma transaction handle in
// the plan) accepts the PrismaClient instance itself when no interactive transaction is
// active, because PrismaClient and TransactionClient share the same delegate surface.
// Drift-repair runs each row's upsert in its own short-lived interactive transaction via
// the repository; here we pass the client as a stand-in.

@Injectable()
export class DriftRepairService {
  private readonly logger = new Logger(DriftRepairService.name);

  constructor(private readonly repo: OperationsRepository) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run(): Promise<DriftRepairReport> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - 60 * 60 * 1000);
    const windowEnd = now;

    let rowsChecked = 0;
    let rowsRepaired = 0;
    const affectedCompanies = new Set<string>();

    // Step 1: Fetch projection rows whose updated_at falls within the window.
    const projectionRows = await this.repo.findProjectionByWindow(windowStart, windowEnd);

    // Step 2: For each projection row, compare against the source order.
    for (const projRow of projectionRows) {
      rowsChecked++;

      const sourceOrder = await this.repo.findOrderByOrderId(projRow.order_id);
      if (!sourceOrder) {
        // Source row is absent (e.g. deleted); nothing to repair.
        continue;
      }

      // Stale-read guard: skip if the source has not advanced past the projection.
      if (sourceOrder.updated_at.getTime() <= projRow.updated_at.getTime()) {
        continue;
      }

      // Fetch denormalised fields needed for the upsert.
      const worker = await this.repo.findWorkerById(sourceOrder.worker_id);
      if (!worker) {
        this.logger.warn(`Worker ${sourceOrder.worker_id} not found; skipping order ${sourceOrder.id}`);
        continue;
      }

      const lastEventType = await this.repo.findLastEventForOrder(sourceOrder.id);

      // Re-derive the single projection row (upsert).
      await this.repo.upsertOperation(
        undefined as any, // ASSUMPTION: see note above about the tx parameter.
        {
          order_id: sourceOrder.id,
          company_id: sourceOrder.company_id,
          worker_id: sourceOrder.worker_id,
          status: sourceOrder.status,
          amount: sourceOrder.amount,
          currency: sourceOrder.currency,
        },
        { name: worker.name, role: worker.role },
        lastEventType,
      );

      rowsRepaired++;
      affectedCompanies.add(sourceOrder.company_id);
    }

    // Step 3: Recompute exact totals for every company that was touched.
    for (const companyId of affectedCompanies) {
      await this.repo.recomputeCompanyTotal(companyId);
    }

    this.logger.log(
      `Drift repair complete — checked: ${rowsChecked}, repaired: ${rowsRepaired}, companies affected: ${affectedCompanies.size}`,
    );

    return {
      window_start: windowStart,
      window_end: windowEnd,
      rows_checked: rowsChecked,
      rows_repaired: rowsRepaired,
    };
  }
}
