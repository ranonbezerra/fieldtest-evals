import { Inject, Injectable } from '@nestjs/common';
import { Company, Event, OrderStatus, PaymentOrder, Prisma, PrismaClient, Worker } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OrderRepository {
  constructor(@Inject(PrismaService) private readonly db: PrismaClient) {}

  withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.db.$transaction(fn);
  }

  getCompany(tx: Prisma.TransactionClient, id: string): Promise<Company | null> {
    return tx.company.findUnique({ where: { id } });
  }

  getWorker(tx: Prisma.TransactionClient, id: string): Promise<Worker | null> {
    return tx.worker.findUnique({ where: { id } });
  }

  getEvent(tx: Prisma.TransactionClient, id: string): Promise<Event | null> {
    return tx.event.findUnique({ where: { id } });
  }

  findById(tx: Prisma.TransactionClient, id: string): Promise<PaymentOrder | null> {
    return tx.paymentOrder.findUnique({ where: { id } });
  }

  createOrder(
    tx: Prisma.TransactionClient,
    data: { companyId: string; workerId: string | null; eventId: string | null; amountCents: bigint; at: Date },
  ): Promise<PaymentOrder> {
    return tx.paymentOrder.create({
      data: {
        companyId: data.companyId,
        workerId: data.workerId,
        eventId: data.eventId,
        status: 'pending',
        amountCents: data.amountCents,
        createdAt: data.at,
        updatedAt: data.at,
      },
    });
  }

  /**
   * Guarded status transition: only orders still in `from` move, atomically.
   * Returns null when nothing matched (order missing or wrong status); the
   * caller fetches the row to tell the two cases apart.
   */
  async transition(
    tx: Prisma.TransactionClient,
    id: string,
    from: OrderStatus,
    to: OrderStatus,
    at: Date,
  ): Promise<PaymentOrder | null> {
    const result = await tx.paymentOrder.updateMany({
      where: { id, status: from },
      data: { status: to, updatedAt: at },
    });
    if (result.count === 0) return null;
    return tx.paymentOrder.findUnique({ where: { id } });
  }
}
