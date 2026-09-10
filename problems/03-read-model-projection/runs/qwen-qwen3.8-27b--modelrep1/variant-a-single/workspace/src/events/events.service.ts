import { Injectable } from '@nestjs/common';
import type { Event } from '@prisma/client';
import { AppError } from '../common/errors.js';
import { TransactionService } from '../common/transaction.service.js';
import { PaymentOrdersRepository } from '../payment-orders/payment-orders.repository.js';
import { ProjectionService } from '../projection/projection.service.js';
import { EventsRepository } from './events.repository.js';

@Injectable()
export class EventsService {
  constructor(
    private readonly repository: EventsRepository,
    private readonly ordersRepository: PaymentOrdersRepository,
    private readonly transactions: TransactionService,
    private readonly projection: ProjectionService,
  ) {}

  record(input: { orderId: string; type: string; occurredAt: Date }): Promise<Event> {
    return this.transactions.run(async (tx) => {
      const order = await this.ordersRepository.findById(tx, input.orderId);
      if (!order) throw AppError.notFound('payment order', input.orderId);

      const event = await this.repository.create(tx, input);

      // Keeps the projection's "latest event" current, still inside the write's
      // transaction so the next dashboard read reflects it.
      await this.projection.onEventRecorded(tx, event.orderId, event.type, event.occurredAt);
      return event;
    });
  }
}
