import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, PaymentOrder } from '@prisma/client';
import { ProjectionService } from '../projection/projection.service';
import { OrderRepository } from './order.repository';

export interface CreateOrderInput {
  companyId: string;
  workerId?: string;
  eventId?: string;
  amountCents: number;
}

export interface OrderView {
  id: string;
  companyId: string;
  workerId: string | null;
  eventId: string | null;
  status: OrderStatus;
  amountCents: number;
  createdAt: Date;
  updatedAt: Date;
}

function toView(order: PaymentOrder): OrderView {
  return {
    id: order.id,
    companyId: order.companyId,
    workerId: order.workerId,
    eventId: order.eventId,
    status: order.status,
    amountCents: Number(order.amountCents),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

/**
 * Write path for payment orders (create / approve / reject), simulated here
 * so the projection contract is exercisable. Every write runs in one
 * database transaction that (1) mutates the source row and (2) applies the
 * matching projection hook, so the write and its projection commit or roll
 * back together.
 */
@Injectable()
export class OrderService {
  constructor(
    @Inject(OrderRepository) private readonly orders: OrderRepository,
    @Inject(ProjectionService) private readonly projections: ProjectionService,
  ) {}

  createOrder(input: CreateOrderInput): Promise<OrderView> {
    return this.orders.withTransaction(async (tx) => {
      const company = await this.orders.getCompany(tx, input.companyId);
      if (!company) throw new NotFoundException(`Company ${input.companyId} does not exist`);

      let workerName: string | null = null;
      let eventName: string | null = null;
      if (input.workerId !== undefined) {
        const worker = await this.orders.getWorker(tx, input.workerId);
        if (!worker) throw new NotFoundException(`Worker ${input.workerId} does not exist`);
        workerName = worker.name;
      }
      if (input.eventId !== undefined) {
        const event = await this.orders.getEvent(tx, input.eventId);
        if (!event) throw new NotFoundException(`Event ${input.eventId} does not exist`);
        eventName = event.title;
      }

      const at = new Date();
      const order = await this.orders.createOrder(tx, {
        companyId: input.companyId,
        workerId: input.workerId ?? null,
        eventId: input.eventId ?? null,
        amountCents: BigInt(input.amountCents),
        at,
      });

      await this.projections.onOrderCreated(tx, {
        id: order.id,
        companyId: order.companyId,
        status: order.status,
        amountCents: Number(order.amountCents),
        occurredAt: at,
        workerName,
        eventName,
        createdAt: at,
      });

      return toView(order);
    });
  }

  approveOrder(id: string): Promise<OrderView> {
    return this.transition(id, 'approved');
  }

  rejectOrder(id: string): Promise<OrderView> {
    return this.transition(id, 'rejected');
  }

  private transition(id: string, to: 'approved' | 'rejected'): Promise<OrderView> {
    return this.orders.withTransaction(async (tx) => {
      const at = new Date();
      const updated = await this.orders.transition(tx, id, 'pending', to, at);
      if (!updated) {
        const existing = await this.orders.findById(tx, id);
        if (!existing) throw new NotFoundException(`Order ${id} does not exist`);
        throw new ConflictException(`Order ${id} is ${existing.status} and cannot be ${to}`);
      }

      await this.projections.onOrderStatusChanged(tx, {
        id: updated.id,
        companyId: updated.companyId,
        fromStatus: 'pending',
        toStatus: to,
        amountCents: Number(updated.amountCents),
        occurredAt: at,
      });

      return toView(updated);
    });
  }
}
