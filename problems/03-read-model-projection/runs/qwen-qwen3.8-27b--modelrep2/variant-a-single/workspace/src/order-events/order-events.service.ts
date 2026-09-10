import { Injectable } from '@nestjs/common';
import { OrderEvent } from '@prisma/client';
import { ApiError } from '../common/api-error.js';
import { isForeignKeyError } from '../common/prisma-errors.js';
import { OperationsRepository } from '../operations/operations.repository.js';
import { CreateOrderEventInput, OrderEventsRepository } from './order-events.repository.js';

export interface OrderEventDto {
  id: string;
  order_id: string;
  type: string;
  occurred_at: string;
}

/**
 * Simulated write path for order events. The event and the read-model
 * maintenance hook commit in ONE transaction, so the dashboard reflects the
 * new recency on the very next request.
 */
@Injectable()
export class OrderEventsService {
  constructor(
    private readonly events: OrderEventsRepository,
    private readonly operations: OperationsRepository,
  ) {}

  record(input: CreateOrderEventInput): Promise<OrderEventDto> {
    return this.events.withTransaction(async (tx) => {
      let event: OrderEvent;
      try {
        event = await this.events.createInTx(tx, input);
      } catch (error) {
        if (isForeignKeyError(error)) {
          throw new ApiError('resource_not_found', `Payment order ${input.orderId} was not found.`, 404, {
            order_id: input.orderId,
          });
        }
        throw error;
      }
      // Maintenance hook: keep the projection's recency fresh, same transaction.
      await this.operations.touchLastEvent(tx, input.orderId, event.occurredAt);
      return {
        id: event.id,
        order_id: event.orderId,
        type: event.type,
        occurred_at: event.occurredAt.toISOString(),
      };
    });
  }
}
