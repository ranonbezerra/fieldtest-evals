import { Injectable } from '@nestjs/common';
import type { Company, Event, PaymentOrder, Prisma, Worker } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';
import type { OrderStatus } from './order-status.js';

export type OrderWithRefs = PaymentOrder & { event: Event; worker: Worker };

export interface CreateOrderData {
  companyId: number;
  eventId: number;
  workerId: number;
  amount: string;
  status: OrderStatus;
}

@Injectable()
export class OrderWritesRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Opens the interactive transaction shared by a write and its maintenance
  // hooks, so both commit (or roll back) as a single unit.
  withTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work);
  }

  findCompany(tx: Prisma.TransactionClient, id: number): Promise<Company | null> {
    return tx.company.findUnique({ where: { id } });
  }

  findEvent(tx: Prisma.TransactionClient, id: number): Promise<Event | null> {
    return tx.event.findUnique({ where: { id } });
  }

  findWorker(tx: Prisma.TransactionClient, id: number): Promise<Worker | null> {
    return tx.worker.findUnique({ where: { id } });
  }

  findOrderWithRefs(tx: Prisma.TransactionClient, id: number): Promise<OrderWithRefs | null> {
    return tx.paymentOrder.findUnique({ where: { id }, include: { event: true, worker: true } });
  }

  createOrder(tx: Prisma.TransactionClient, data: CreateOrderData): Promise<OrderWithRefs> {
    return tx.paymentOrder.create({ data, include: { event: true, worker: true } });
  }

  updateOrderStatus(tx: Prisma.TransactionClient, id: number, status: OrderStatus): Promise<OrderWithRefs> {
    return tx.paymentOrder.update({ where: { id }, data: { status }, include: { event: true, worker: true } });
  }

  updateEventName(tx: Prisma.TransactionClient, id: number, name: string): Promise<Event> {
    return tx.event.update({ where: { id }, data: { name } });
  }

  updateWorkerName(tx: Prisma.TransactionClient, id: number, name: string): Promise<Worker> {
    return tx.worker.update({ where: { id }, data: { name } });
  }
}
