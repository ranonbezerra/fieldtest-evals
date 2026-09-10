import { Injectable } from '@nestjs/common';
import { OrderStatus, PaymentOrder, Prisma } from '@prisma/client';
import { ResourceNotFoundError } from '../common/errors.js';
import { PrismaService } from '../database/prisma.service.js';

export interface NewOrderInput {
  companyId: string;
  workerId: string;
  amountCents: number;
  currency: string;
}

type Tx = Prisma.TransactionClient;

@Injectable()
export class OrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async companyExists(companyId: string, tx: Tx = this.prisma): Promise<boolean> {
    const row = await tx.company.findUnique({ where: { id: companyId }, select: { id: true } });
    return row !== null;
  }

  async workerExists(workerId: string, tx: Tx = this.prisma): Promise<boolean> {
    const row = await tx.worker.findUnique({ where: { id: workerId }, select: { id: true } });
    return row !== null;
  }

  async create(input: NewOrderInput, tx: Tx): Promise<PaymentOrder> {
    return tx.paymentOrder.create({ data: input });
  }

  async assignWorker(orderId: string, workerId: string, tx: Tx): Promise<PaymentOrder> {
    return tx.paymentOrder.update({ where: { id: orderId }, data: { workerId } });
  }

  async find(id: string, tx: Tx = this.prisma): Promise<PaymentOrder | null> {
    return tx.paymentOrder.findUnique({ where: { id } });
  }

  async findOrThrow(id: string, tx: Tx = this.prisma): Promise<PaymentOrder> {
    const order = await this.find(id, tx);
    if (!order) {
      throw new ResourceNotFoundError(`Payment order ${id} does not exist`, { orderId: id });
    }
    return order;
  }

  /**
   * Atomically moves the order from `fromStatus` to `toStatus` via a guarded update.
   * Returns null when the order is not in `fromStatus` (concurrent change); the
   * caller decides the error, and the whole transaction rolls back with it.
   */
  async transition(
    orderId: string,
    fromStatus: OrderStatus,
    toStatus: OrderStatus,
    tx: Tx,
  ): Promise<PaymentOrder | null> {
    const result = await tx.paymentOrder.updateMany({
      where: { id: orderId, status: fromStatus },
      data: { status: toStatus },
    });
    if (result.count === 0) {
      return null;
    }
    const updated = await this.find(orderId, tx);
    if (!updated) {
      throw new ResourceNotFoundError(`Payment order ${orderId} disappeared during transition`, { orderId });
    }
    return updated;
  }
}
