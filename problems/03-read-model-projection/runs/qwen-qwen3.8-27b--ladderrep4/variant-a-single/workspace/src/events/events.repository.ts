import { Injectable } from '@nestjs/common';
import type { Event } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';
import { ProjectionRepository } from '../projection/projection.repository.js';

export interface LogEventInput {
  companyId: string;
  workerId: string;
  type: string;
}

@Injectable()
export class EventRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projection: ProjectionRepository,
  ) {}

  findWorker(id: string): Promise<{ id: string; companyId: string } | null> {
    return this.prisma.worker.findUnique({ where: { id } });
  }

  /** Writes the source event and refreshes the affected projection rows in the same transaction. */
  logEvent(input: LogEventInput): Promise<Event> {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.paymentOrder.findFirst({
        where: { companyId: input.companyId, workerId: input.workerId },
        orderBy: { createdAt: 'desc' },
      });
      if (!order) {
        throw new Error('No order found for the given company and worker.');
      }
      const event = await tx.event.create({
        data: { orderId: order.id, type: input.type, payload: {} },
      });
      await this.projection.onEventLogged(tx, {
        companyId: input.companyId,
        workerId: input.workerId,
        type: event.type,
        occurredAt: event.createdAt,
      });
      return event;
    });
  }
}
