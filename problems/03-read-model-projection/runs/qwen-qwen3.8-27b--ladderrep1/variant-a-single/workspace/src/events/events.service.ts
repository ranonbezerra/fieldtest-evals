import { Injectable } from '@nestjs/common';
import { Event } from '@prisma/client';
import { ResourceNotFoundError } from '../common/errors.js';
import { PrismaService } from '../database/prisma.service.js';
import { ProjectionService } from '../operations/projection.service.js';
import { EventRepository } from './events.repository.js';

export interface RecordEventInput {
  paymentOrderId: string;
  eventType: string;
  note?: string;
  occurredAt?: Date;
}

@Injectable()
export class EventService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventRepository,
    private readonly projection: ProjectionService,
  ) {}

  async record(input: RecordEventInput): Promise<Event> {
    return this.prisma.transaction(async (tx) => {
      if (!(await this.events.orderExists(input.paymentOrderId, tx))) {
        throw new ResourceNotFoundError(`Payment order ${input.paymentOrderId} does not exist`, {
          orderId: input.paymentOrderId,
        });
      }
      const event = await this.events.record(
        {
          paymentOrderId: input.paymentOrderId,
          eventType: input.eventType,
          note: input.note,
          occurredAt: input.occurredAt ?? new Date(),
        },
        tx,
      );
      // Maintenance hook — inside the writer's transaction.
      await this.projection.applyEvent(tx, event);
      return event;
    });
  }
}
