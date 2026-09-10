import { Body, Controller, Post } from '@nestjs/common';
import { asRecord, requireIsoDate, requireString, requireUuid } from '../common/validation.js';
import { EventsService } from './events.service.js';

@Controller('events')
export class EventsController {
  constructor(private readonly service: EventsService) {}

  @Post()
  record(@Body() body: unknown) {
    const payload = asRecord(body, 'request body');
    return this.service.record({
      orderId: requireUuid(payload.order_id, 'order_id'),
      type: requireString(payload.type, 'type', 100),
      occurredAt:
        payload.occurred_at === undefined ? new Date() : requireIsoDate(payload.occurred_at, 'occurred_at'),
    });
  }
}
