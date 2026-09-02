import { Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { OperationsRepository } from "./operations.repository";
import {
  DashboardQuery,
  DashboardResult,
  CompanyTotals,
  OperationRow,
  SimulateWriteInput,
  ResourceNotFoundError,
  InvalidDateRangeError,
  ValidationError,
} from "./operations.types";

@Injectable()
export class OperationsService {
  constructor(
    private readonly repo: OperationsRepository,
    private readonly prisma: PrismaClient,
  ) {}

  async getDashboard(query: DashboardQuery): Promise<DashboardResult> {
    if (query.page < 1) {
      throw new ValidationError("page must be >= 1", {});
    }
    if (query.page_size < 1 || query.page_size > 100) {
      throw new ValidationError("page_size must be between 1 and 100", {});
    }
    if (query.date_from && query.date_to && query.date_from >= query.date_to) {
      throw new InvalidDateRangeError("date_from must be strictly before date_to", {});
    }

    const totals = await this.repo.getCompanyTotal(query.company_id);
    if (!totals) {
      throw new ResourceNotFoundError("Company not found", {
        company_id: query.company_id,
      });
    }

    return this.repo.queryDashboard(query);
  }

  async simulateWrite(input: SimulateWriteInput): Promise<OperationRow> {
    await this.prisma.$transaction(async (tx) => {
      const worker = await this.repo.findWorkerById(input.worker_id);
      if (!worker) {
        throw new ResourceNotFoundError("Worker not found", {
          worker_id: input.worker_id,
        });
      }

      // ASSUMPTION: repo exposes findSourceOrder(orderId) returning the current source row (or null) for delta computation.
      const existing = await this.repo.findSourceOrder(input.order_id);

      // ASSUMPTION: repo exposes upsertSourceOrder(tx, input) to upsert the source payment_orders row within the transaction.
      await this.repo.upsertSourceOrder(tx, input);

      const lastEventType = await this.repo.findLastEventForOrder(input.order_id);
      await this.repo.upsertOperation(tx, input, worker, lastEventType);

      const oldAmount = existing ? Number(existing.amount) : 0;
      const newAmount = Number(input.amount);
      const deltaAmount = String(newAmount - oldAmount);
      const deltaCount = existing ? 0 : 1;

      if (deltaAmount !== "0" || deltaCount !== 0) {
        await this.repo.upsertCompanyTotal(
          tx,
          input.company_id,
          deltaAmount,
          deltaCount,
        );
      }
    });

    const row = await this.repo.getOperationByOrderId(input.order_id);
    if (!row) {
      throw new ResourceNotFoundError("Operation not found after write", {
        order_id: input.order_id,
      });
    }
    return row;
  }

  async getCompanyTotals(companyId: string): Promise<CompanyTotals> {
    const totals = await this.repo.getCompanyTotal(companyId);
    if (!totals) {
      throw new ResourceNotFoundError("Company not found", {
        company_id: companyId,
      });
    }
    return totals;
  }
}
