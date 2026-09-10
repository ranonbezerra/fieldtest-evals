import { Injectable } from '@nestjs/common';
import { OrderEvent, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface CreateOrderEventInput {
  orderId: string;
  type: string;
  occurredAt: Date;
}

@Injectable()
export class OrderEventsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, { timeout: 30_000, maxWait: 10_000 });
  }

  async createInTx(tx: Prisma.TransactionClient, input: CreateOrderEventInput): Promise<OrderEvent> {
    return tx.orderEvent.create({
      data: { orderId: input.orderId, type: input.type, occurredAt: input.occurredAt },
    });
  }
}
