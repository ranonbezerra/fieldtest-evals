import { Injectable } from '@nestjs/common';
import { OrderStatus, PaymentOrder, Prisma } from '@prisma/client';
import { ConflictError, ResourceNotFoundError } from '../common/errors.js';
import { PrismaService } from '../database/prisma.service.js';
import { EventRepository } from '../events/events.repository.js';
import { ProjectionService } from '../operations/projection.service.js';
import { NewOrderInput, OrdersRepository } from './orders.repository.js';

type Tx = Prisma.TransactionClient;
type OrderSnapshot = Pick<
  PaymentOrder,
  'id' | 'companyId' | 'workerId' | 'status' | 'amountCents' | 'currency' | 'createdAt' | 'updatedAt'
>;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersRepository,
    private readonly events: EventRepository,
    private readonly projection: ProjectionService,
  ) {}

  async create(input: NewOrderInput): Promise<PaymentOrder> {
    return this.prisma.transaction(async (tx) => {
      const [companyExists, workerExists] = await Promise.all([
        this.orders.companyExists(input.companyId, tx),
        this.orders.workerExists(input.workerId, tx),
      ]);
      if (!companyExists) {
        throw new ResourceNotFoundError(`Company ${input.companyId} does not exist`, { companyId: input.companyId });
      }
      if (!workerExists) {
        throw new ResourceNotFoundError(`Worker ${input.workerId} does not exist`, { workerId: input.workerId });
      }
      const order = await this.orders.create(input, tx);
      // Maintenance hook — inside the writer's transaction (read-your-own-writes, rollback-safe).
      await this.projection.applyOrderChange(tx, order);
      return order;
    });
  }

  approve(orderId: string): Promise<PaymentOrder> {
    return this.move(orderId, 'pending', 'approved');
  }

  cancel(orderId: string): Promise<PaymentOrder> {
    return this.move(orderId, 'pending', 'cancelled');
  }

  async dispute(orderId: string): Promise<PaymentOrder> {
    return this.prisma.transaction(async (tx) => {
      const existing = await this.orders.findOrThrow(orderId, tx);
      if (existing.status === 'disputed' || existing.status === 'cancelled') {
        throw new ConflictError(`Order ${orderId} is ${existing.status}; it cannot be disputed`, {
          orderId,
          status: existing.status,
        });
      }
      const updated = await this.orders.transition(orderId, existing.status, 'disputed', tx);
      if (!updated) {
        throw new ConflictError(`Order ${orderId} changed concurrently`, { orderId });
      }
      await this.applyProjection(tx, updated, 'disputed');
      return updated;
    });
  }

  async assignWorker(orderId: string, workerId: string): Promise<PaymentOrder> {
    return this.prisma.transaction(async (tx) => {
      await this.orders.findOrThrow(orderId, tx);
      if (!(await this.orders.workerExists(workerId, tx))) {
        throw new ResourceNotFoundError(`Worker ${workerId} does not exist`, { workerId });
      }
      const updated = await this.orders.assignWorker(orderId, workerId, tx);
      await this.applyProjection(tx, updated, 'worker_assigned');
      return updated;
    });
  }

  private move(orderId: string, from: OrderStatus, to: OrderStatus): Promise<PaymentOrder> {
    return this.prisma.transaction(async (tx) => {
      const existing = await this.orders.findOrThrow(orderId, tx);
      if (existing.status !== from) {
        throw new ConflictError(
          `Order ${orderId} is ${existing.status}; only ${from} orders can be moved to ${to}`,
          { orderId, status: existing.status },
        );
      }
      const updated = await this.orders.transition(orderId, from, to, tx);
      if (!updated) {
        throw new ConflictError(`Order ${orderId} changed concurrently`, { orderId });
      }
      await this.applyProjection(tx, updated, to);
      return updated;
    });
  }

  /** Shared write→read-model hook for every order mutation, inside the same transaction. */
  private async applyProjection(tx: Tx, order: OrderSnapshot, auditType: string): Promise<void> {
    await this.projection.applyOrderChange(tx, order);
    const event = await this.events.record(
      { paymentOrderId: order.id, eventType: auditType, occurredAt: order.updatedAt },
      tx,
    );
    await this.projection.applyEvent(tx, event);
  }
}
