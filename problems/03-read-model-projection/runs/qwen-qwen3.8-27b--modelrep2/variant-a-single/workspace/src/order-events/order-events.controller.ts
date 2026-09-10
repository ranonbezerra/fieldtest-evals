import { Body, Controller, Post } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { asObject, isUuid, parseIsoDate } from '../common/validation.js';
import { OrderEventsService } from './order-events.service.js';

const FUTURE_SKEW_MS = 5_000;

@Controller('order-events')
export class OrderEventsController {
  constructor(private readonly service: OrderEventsService) {}

  @Post()
  create(@Body() rawBody: unknown) {
    const body = asObject(rawBody);
    const errors: Record<string, string> = {};
    if (!isUuid(body.order_id)) errors.order_id = 'must be a UUID';
    if (typeof body.type !== 'string' || body.type.length === 0 || body.type.length > 64) {
      errors.type = 'must be a non-empty string of at most 64 characters';
    }
    let occurredAt: Date | null = null;
    if (body.occurred_at === undefined) {
      occurredAt = new Date();
    } else {
      const parsed = parseIsoDate(body.occurred_at);
      if (parsed === null) {
        errors.occurred_at = 'must be an ISO-8601 timestamp';
      } else if (parsed.getTime() > Date.now() + FUTURE_SKEW_MS) {
        errors.occurred_at = 'must not be in the future';
      } else {
        occurredAt = parsed;
      }
    }
    if (Object.keys(errors).length > 0) {
      throw new ApiError('validation_failed', 'Request body failed validation.', 400, { fields: errors });
    }
    return this.service.record({
      orderId: body.order_id as string,
      type: body.type as string,
      occurredAt: occurredAt as Date,
    });
  }
}
