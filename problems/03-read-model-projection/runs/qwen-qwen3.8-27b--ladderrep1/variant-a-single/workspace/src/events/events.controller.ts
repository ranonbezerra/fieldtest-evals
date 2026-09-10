import { Body, Controller, Param, Post } from '@nestjs/common';
import { Event } from '@prisma/client';
import { finishValidation, parseOptionalIsoDate, requireUuid, ValidationErrors } from '../common/validation.js';
import { EventService } from './events.service.js';

@Controller('orders')
export class EventsController {
  constructor(private readonly events: EventService) {}

  @Post(':orderId/events')
  record(@Param('orderId') orderId: string, @Body() body: Record<string, unknown> | undefined): Promise<Event> {
    requireUuid(orderId, 'orderId');
    const errors: ValidationErrors = {};
    const eventType = body?.eventType;
    if (typeof eventType !== 'string' || eventType.length === 0 || eventType.length > 100) {
      errors.eventType = 'must be a non-empty string of at most 100 characters';
    }
    let note: string | undefined;
    if (body?.note !== undefined) {
      if (typeof body.note !== 'string' || body.note.length > 1000) {
        errors.note = 'must be a string of at most 1000 characters';
      } else {
        note = body.note;
      }
    }
    const occurredAt = parseOptionalIsoDate(body?.occurredAt, 'occurredAt', errors);
    finishValidation(errors);
    return this.events.record({ paymentOrderId: orderId, eventType: eventType as string, note, occurredAt });
  }
}
