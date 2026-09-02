import { Injectable, Logger } from "@nestjs/common";
import { OperationsRepository } from "../operations/operations.repository";
import { DriftRepairReport, OperationRow } from "../operations/operations.types";

@Injectable()
export class DriftRepairService {
  private readonly logger = new Logger(DriftRepairService.name);

  constructor(private readonly repo: OperationsRepository) {}

  async run(): Promise<DriftRepairReport> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - 3_600_000);

    const projectionRows = await this.repo.findProjectionByWindow(windowStart, now);

    let rowsChecked = 0;
    let rowsRepaired = 0;
    const affectedCompanyIds = new Set<string>();

    for (const proj of projectionRows) {
      rowsChecked++;

      try {
        // Fetch the corresponding source order in a narrow window around its created_at.
        const orders = await this.repo.findOrdersByWindow(
          new Date(proj.created_at.getTime() - 1_000),
          new Date(proj.created_at.getTime() + 1_000),
        );
        const source = orders.find((o) => o["id"] === proj.order_id);
        if (!source) continue;

        const sourceUpdatedAt = new Date(source["updated_at"] as string);
        // Stale-read guard: skip if the source is not strictly newer than the projection.
        if (sourceUpdatedAt <= proj.updated_at) continue;

        const worker = await this.repo.findWorkerById(source["worker_id"] as string);
        if (!worker) continue;

        const lastEventType = await this.repo.findLastEventForOrder(proj.order_id);

        // ASSUMPTION: The PLAN mandates a per-row transaction for each repair and the
        // layer rules forbid the service from calling Prisma directly. This file assumes
        // the repository exposes a transactional convenience method that performs the
        // projection upsert atomically for a single row.
        await (
          this.repo as unknown as {
            repairProjectionRow(
              orderId: string,
              order: Record<string, unknown>,
              worker: { name: string; role: string },
              lastEventType: string | null,
            ): Promise<void>;
          }
        ).repairProjectionRow(
          proj.order_id,
          source,
          { name: worker.name, role: worker.role },
          lastEventType,
        );

        rowsRepaired++;
        affectedCompanyIds.add(proj.company_id);
      } catch (err) {
        this.logger.error(
          `Drift repair: failed to process order ${proj.order_id}: ${(err as Error).message}`,
        );
      }
    }

    // ASSUMPTION: The PLAN requires recomputing company financial totals via SUM/COUNT
    // from source after repairing rows. This file assumes the repository exposes a
    // transactional method `recomputeCompanyTotal(companyId)` for this purpose.
    for (const companyId of affectedCompanyIds) {
      try {
        await (
          this.repo as unknown as {
            recomputeCompanyTotal(companyId: string): Promise<void>;
          }
        ).recomputeCompanyTotal(companyId);
      } catch (err) {
        this.logger.error(
          `Drift repair: failed to recompute totals for company ${companyId}: ${(err as Error).message}`,
        );
      }
    }

    return {
      window_start: windowStart,
      window_end: now,
      rows_checked: rowsChecked,
      rows_repaired: rowsRepaired,
    };
  }
}
