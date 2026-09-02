import { Prisma, PrismaClient, Decimal } from "@prisma/client";
import {
  OperationRow,
  DashboardQuery,
  DashboardResult,
  CompanyTotals,
  SimulateWriteInput,
} from "./operations.types";

export class OperationsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** Projection maintenance — called inside a transaction. */
  async upsertOperation(
    tx: Prisma.TransactionClient,
    order: SimulateWriteInput,
    worker: { name: string; role: string },
    lastEventType: string | null,
  ): Promise<void> {
    await tx.operation.upsert({
      where: { orderId: order.order_id },
      create: {
        orderId: order.order_id,
        companyId: order.company_id,
        status: order.status,
        amount: new Decimal(order.amount),
        currency: order.currency,
        workerName: worker.name,
        workerRole: worker.role,
        lastEventType: lastEventType,
        createdAt: new Date(),
      },
      update: {
        companyId: order.company_id,
        status: order.status,
        amount: new Decimal(order.amount),
        currency: order.currency,
        workerName: worker.name,
        workerRole: worker.role,
        lastEventType: lastEventType,
      },
    });
  }

  /** Dashboard read — single query against the projection. */
  async queryDashboard(query: DashboardQuery): Promise<DashboardResult> {
    const where: Prisma.OperationWhereInput = {
      companyId: query.company_id,
    };
    if (query.status) {
      where.status = query.status;
    }
    const dateFilter: Record<string, Date> = {};
    if (query.date_from) dateFilter.gte = query.date_from;
    if (query.date_to) dateFilter.lte = query.date_to;
    if (Object.keys(dateFilter).length > 0) {
      where.createdAt = dateFilter as Prisma.OperationWhereInput["createdAt"];
    }

    const [rows, totalCount] = await Promise.all([
      this.prisma.operation.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { orderId: "desc" }],
        skip: (query.page - 1) * query.page_size,
        take: query.page_size,
      }),
      this.prisma.operation.count({ where }),
    ]);

    const data: OperationRow[] = rows.map((row) => ({
      order_id: row.orderId,
      company_id: row.companyId,
      status: row.status as OperationRow["status"],
      amount: row.amount.toString(),
      currency: row.currency,
      worker_name: row.workerName,
      worker_role: row.workerRole,
      last_event_type: row.lastEventType,
      created_at: row.createdAt,
    }));

    return { data, total_count: totalCount, page: query.page, page_size: query.page_size };
  }

  /** Aggregate maintenance (delta-based) — called inside a transaction. */
  async upsertCompanyTotal(
    tx: Prisma.TransactionClient,
    companyId: string,
    deltaAmount: string,
    deltaCount: number,
  ): Promise<void> {
    await tx.companyFinancialTotal.upsert({
      where: { companyId },
      create: {
        companyId,
        totalAmount: new Decimal(deltaAmount),
        orderCount: deltaCount,
      },
      update: {
        totalAmount: { increment: new Decimal(deltaAmount) },
        orderCount: { increment: deltaCount },
      },
    });
  }

  /** Source read for re-derivation and drift-repair. */
  async findOrdersByWindow(from: Date, to: Date): Promise<Record<string, unknown>[]> {
    const rows = await this.prisma.paymentOrder.findMany({
      where: {
        createdAt: { gte: from, lte: to },
      },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => ({ ...row }) as Record<string, unknown>);
  }

  /** Look up a worker by id. */
  async findWorkerById(
    workerId: string,
  ): Promise<{ id: string; name: string; role: string } | null> {
    const worker = await this.prisma.worker.findUnique({ where: { id: workerId } });
    if (!worker) return null;
    return { id: worker.id, name: worker.name, role: worker.role };
  }

  /** Most recent event type for an order, or null. */
  async findLastEventForOrder(orderId: string): Promise<string | null> {
    const event = await this.prisma.event.findFirst({
      where: { orderId },
      orderBy: { createdAt: "desc" },
      select: { eventType: true },
    });
    return event ? event.eventType : null;
  }

  /** Projection rows whose updated_at falls within [from, to]. */
  async findProjectionByWindow(from: Date, to: Date): Promise<OperationRow[]> {
    const rows = await this.prisma.operation.findMany({
      where: {
        updatedAt: { gte: from, lte: to },
      },
    });
    return rows.map((row) => ({
      order_id: row.orderId,
      company_id: row.companyId,
      status: row.status as OperationRow["status"],
      amount: row.amount.toString(),
      currency: row.currency,
      worker_name: row.workerName,
      worker_role: row.workerRole,
      last_event_type: row.lastEventType,
      created_at: row.createdAt,
    }));
  }

  /** Single-order fetch from the projection (read-your-own-writes). */
  async getOperationByOrderId(orderId: string): Promise<OperationRow | null> {
    const row = await this.prisma.operation.findUnique({ where: { orderId } });
    if (!row) return null;
    return {
      order_id: row.orderId,
      company_id: row.companyId,
      status: row.status as OperationRow["status"],
      amount: row.amount.toString(),
      currency: row.currency,
      worker_name: row.workerName,
      worker_role: row.workerRole,
      last_event_type: row.lastEventType,
      created_at: row.createdAt,
    };
  }

  /** Read a company's exact financial totals. */
  async getCompanyTotal(companyId: string): Promise<CompanyTotals | null> {
    const row = await this.prisma.companyFinancialTotal.findUnique({ where: { companyId } });
    if (!row) return null;
    return {
      company_id: row.companyId,
      total_amount: row.totalAmount.toString(),
      order_count: row.orderCount,
    };
  }
}
