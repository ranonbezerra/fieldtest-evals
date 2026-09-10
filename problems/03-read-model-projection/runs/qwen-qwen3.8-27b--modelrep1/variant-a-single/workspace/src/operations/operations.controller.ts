import { Controller, Get, Query } from '@nestjs/common';
import { AppError } from '../common/errors.js';
import { optionalIntQuery, optionalIsoDate, optionalStatus, optionalUuid } from '../common/validation.js';
import { OperationsService } from './operations.service.js';

@Controller('operations')
export class OperationsController {
  constructor(private readonly service: OperationsService) {}

  @Get()
  list(@Query() query: Record<string, string | undefined>) {
    const from = optionalIsoDate(query.from, 'from');
    const to = optionalIsoDate(query.to, 'to');
    if (from !== undefined && to !== undefined && from.getTime() >= to.getTime()) {
      throw AppError.validation("'from' must be earlier than 'to'", {
        from: from.toISOString(),
        to: to.toISOString(),
      });
    }
    return this.service.list({
      companyId: optionalUuid(query.company_id, 'company_id'),
      status: optionalStatus(query.status, 'status'),
      from,
      to,
      page: optionalIntQuery(query.page, 'page', 1, 10_000),
      pageSize: optionalIntQuery(query.page_size, 'page_size', 50, 200),
    });
  }
}
