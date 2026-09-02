import { Prisma, PrismaClient } from "@prisma/client";
import {
  DashboardQuery,
  DashboardResult,
  OperationRow,
  CompanyTotals,
  SimulateWriteInput,
} from "./operations.types";

// ASSUMPTION: The plan specifies the transaction parameter type as `PrismaPromise`,
// which is not a type exported by @prisma/client. The correct type for an interactive
// transaction client is `Prisma.TransactionClient`, used here instead.

export class OperationsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertOperation(
    tx: Prisma.TransactionClient,
    order: SimulateWriteInput,
    worker: { name: string; role: string },
    lastEventType: string | null,
  ): Promise<void> {
    await tx.operations.upsert({
      where: { order_id: order.order_id },
      create: {
        order_id: order.order_id,
        company_id: order.company_id,
        status: order.status,
        amount: order.amount,
        currency: order.currency,
        worker_name: worker.name,
        worker_role: worker.role,
        last_event_type: lastEventType,
      },
      update: {
        status: order.status,
        amount: order.amount,
        currency: order.currency,
        worker_name: worker.name,
        worker_role: worker.role,
        last_event_type: lastEventType,
      },
    });
  }

  async queryDashboard(query: DashboardQuery): Promise<DashboardResult> {
    const where: Prisma.OperationsWhereInput = {
      company_id: query.company_id,
    };
    if (query.status) {
      where.status = query.status;
    }
    if (query.date_from || query.date_to) {
      where.created_at = {};
      if (query.date_from) where.created_at.gte = query.date_from;
      if (query.date_to) where.created_at.lte = query.date_to;
    }

    const [data, total_count] = await Promise.all([
      this.prisma.operations.findMany({
        where,
        orderBy: [{ created_at: "desc" }, { order_id: "desc" }],
        skip: (query.page - 1) * query.page_size,
        take: query.page_size,
      }),
      this.prisma.operations.count({ where }),
    ]);

    return {
      data: data.map((row) => this.toOperationRow(row)),
      total_count,
      page: query.page,
      page_size: query.page_size,
    };
  }

  async upsertCompanyTotal(
    tx: Prisma.TransactionClient,
    companyId: string,
    deltaAmount: string,
    deltaCount: number,
  ): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO company_financial_totals (company_id, total_amount, order_count, updated_at)
      VALUES (${companyId}, ${deltaAmount}::numeric, ${deltaCount}, now())
      ON CONFLICT (company_id) DO UPDATE SET
        total_amount = company_financial_totals.total_amount + EXCLUDED.total_amount,
        order_count  = company_financial_totals.order_count  + EXCLUDED.order_count,
        updated_at   = now()
    `;
  }

  async findOrdersByWindow(from: Date, to: Date): Promise<Record<string, unknown>[]> {
    return this.prisma.$queryRaw`
      SELECT * FROM payment_orders
      WHERE created_at >= ${from} AND created_at <= ${to}
      ORDER BY created_at ASC
    ` as Promise<Record<string, unknown>[]>;
  }

  async findWorkerById(workerId: string): Promise<{ id: string; name: string; role: string } | null> {
    return this.prisma.workers.findUnique({
      where: { id: workerId },
      select: { id: true, name: true, role: true },
    });
  }

  async findLastEventForOrder(orderId: string): Promise<string | null> {
    const event = await this.prisma.events.findFirst({
      where: { order_id: orderId },
      orderBy: { created_at: "desc" },
      select: { event_type: true },
    });
    return event?.event_type ?? null;
  }

  async findProjectionByWindow(from: Date, to: Date): Promise<OperationRow[]> {
    const rows = await this.prisma.operations.findMany({
      where: {
        updated_at: { gte: from, lte: to },
      },
    });
    return rows.map((row) => this.toOperationRow(row));
  }

  async getOperationByOrderId(orderId: string): Promise<OperationRow | null> {
    const row = await this.prisma.operations.findUnique({
      where: { order_id: orderId },
    });
    return row ? this.toOperationRow(row) : null;
  }

  async getCompanyTotal(companyId: string): Promise<CompanyTotals | null> {
    const row = await this.prisma.companyFinancialTotals.findUnique({
      where: { company_id: companyId },
    });
    return row
      ? {
          company_id: row.company_id,
          total_amount: row.total_amount.toString(),
          order_count: row.order_count,
        }
      : null;
  }

  private toOperationRow(row: {
    order_id: string;
    company_id: string;
    status: string;
    amount: { toString(): string };
    currency: string;
    worker_name: string;
    worker_role: string;
    last_event_type: string | null;
    created_at: Date;
  }): OperationRow {
    return {
      order_id: row.order_id,
      company_id: row.company_id,
      status: row.status as OperationRow["status"],
      amount: row.amount.toString(),
      currency: row.currency,
      worker_name: row.worker_name,
      worker_role: row.worker_role,
      last_event_type: row.last_event_type,
      created_at: row.created_at,
    };
  }
}
