import type { Order, Prisma, PrismaClient, ReconcileRun, SendEvent } from "@prisma/client";
import type { SendClassification } from "./bank-client";
import type { OrderState, ReconcileWindow } from "./payout.types";

export class PayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findPendingOrders(): Promise<Order[]> {
    return this.prisma.order.findMany({ where: { state: "pending" } });
  }

  findById(id: string): Promise<Order | null> {
    return this.prisma.order.findUnique({ where: { id } });
  }

  // ASSUMPTION: the plan's control flow (step 2a) mandates an atomic
  // pending -> sent claim with send_attempts incremented, but its signature
  // sketch does not name the method; `claimOrder` is that method.
  async claimOrder(id: string): Promise<Order | null> {
    const result = await this.prisma.order.updateMany({
      where: { id, state: "pending" },
      data: { state: "sent", send_attempts: { increment: 1 } },
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.order.findUnique({ where: { id } });
  }

  async updateState(id: string, state: OrderState, sendAttempts?: number): Promise<Order> {
    const data: Prisma.OrderUpdateInput = { state };
    if (sendAttempts !== undefined) {
      data.send_attempts = sendAttempts;
    }
    return this.prisma.order.update({ where: { id }, data });
  }

  findOrdersByTxids(txids: string[]): Promise<Order[]> {
    return this.prisma.order.findMany({ where: { txid: { in: txids } } });
  }

  findOrdersByEffectiveDate(date: string): Promise<Order[]> {
    return this.prisma.order.findMany({ where: { effective_date: date } });
  }

  createReconcileRun(window: ReconcileWindow, matchedCount: number): Promise<ReconcileRun> {
    return this.prisma.reconcileRun.create({
      data: {
        window_from: window.from,
        window_to: window.to,
        matched_count: matchedCount,
      },
    });
  }

  // ASSUMPTION: "latest reconcile run for a date" is read as the most recent
  // run whose window overlaps the UTC calendar day of the given effective date.
  getLatestReconcileRunForDate(date: string): Promise<ReconcileRun | null> {
    const start = new Date(`${date}T00:00:00.000Z`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return this.prisma.reconcileRun.findFirst({
      where: {
        window_from: { lt: end },
        window_to: { gte: start },
      },
      orderBy: { created_at: "desc" },
    });
  }

  createSendEvent(
    orderId: string,
    txid: string,
    classification: SendClassification,
    raw: string,
  ): Promise<SendEvent> {
    return this.prisma.sendEvent.create({
      data: {
        order_id: orderId,
        txid,
        classification,
        raw_response: raw,
      },
    });
  }
}
