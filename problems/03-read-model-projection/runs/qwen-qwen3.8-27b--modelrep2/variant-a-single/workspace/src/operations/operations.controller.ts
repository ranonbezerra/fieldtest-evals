import { Controller, Get, Query } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { ApiError } from '../common/api-error.js';
import { isUuid, parseBoundedPositiveInt, parseIsoDate } from '../common/validation.js';
import { OperationsService } from './operations.service.js';

const ORDER_STATUSES: string[] = Object.values(OrderStatus);

@Controller('operations')
export class OperationsController {
  constructor(private readonly service: OperationsService) {}

  /**
   * Dashboard list. Query params:
   * company_id (required UUID), status (enum), from/to (ISO-8601, half-open
   * range on last_event_at), page (>=1, default 1), page_size (1..200, default 50).
   */
  @Get()
  list(@Query() query: Record<string, string | undefined>) {
    const errors: Record<string, string> = {};
    if (!isUuid(query.company_id)) errors.company_id = 'must be a UUID';

    let status: OrderStatus | undefined;
    if (query.status !== undefined) {
      if (ORDER_STATUSES.includes(query.status)) {
        status = query.status as OrderStatus;
      } else {
        errors.status = `must be one of: ${ORDER_STATUSES.join(', ')}`;
      }
    }

    let from: Date | undefined;
    if (query.from !== undefined) {
      const parsed = parseIsoDate(query.from);
      if (parsed === null) errors.from = 'must be an ISO-8601 timestamp';
      else from = parsed;
    }
    let to: Date | undefined;
    if (query.to !== undefined) {
      const parsed = parseIsoDate(query.to);
      if (parsed === null) errors.to = 'must be an ISO-8601 timestamp';
      else to = parsed;
    }
    if (from !== undefined && to !== undefined && from.getTime() >= to.getTime()) {
      errors.to = 'must be strictly after from';
    }

    const page = parseBoundedPositiveInt(query.page, 1, Number.MAX_SAFE_INTEGER, 1, errors, 'page');
    const pageSize = parseBoundedPositiveInt(query.page_size, 1, 200, 50, errors, 'page_size');

    if (Object.keys(errors).length > 0) {
      throw new ApiError('validation_failed', 'Query parameters failed validation.', 400, { fields: errors });
    }
    return this.service.list({
      companyId: query.company_id as string,
      status,
      from,
      to,
      page: page as number,
      pageSize: pageSize as number,
    });
  }
}
