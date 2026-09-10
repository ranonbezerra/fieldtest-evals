import { Injectable } from '@nestjs/common';
import type { Event, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';

@Injectable()
export class EventsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    tx: Prisma.TransactionClient | undefined,
    data: { orderId: string; type: string; occurredAt: Date },
  ): Promise<Event> {
    return (tx ?? this.prisma).event.create({ data });
  }
}
