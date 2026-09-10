import { Injectable } from '@nestjs/common';
import { Event, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';

export interface NewEventInput {
  paymentOrderId: string;
  eventType: string;
  note?: string;
  occurredAt: Date;
}

type Tx = Prisma.TransactionClient;

@Injectable()
export class EventRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Liveness check on the source order.
   * // ASSUMPTION: kept in this repository (instead of importing the orders feature) so EventsModule
   * does not create a circular module import with OrdersModule, which consumes this repository.
   */
  async orderExists(orderId: string, tx: Tx = this.prisma): Promise<boolean> {
    const row = await tx.paymentOrder.findUnique({ where: { id: orderId }, select: { id: true } });
    return row !== null;
  }

  async record(input: NewEventInput, tx: Tx): Promise<Event> {
    return tx.event.create({ data: input });
  }
}
