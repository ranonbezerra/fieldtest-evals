import { Controller, Get, Inject, Query } from '@nestjs/common';
import { DomainException } from '../common/domain-exception.js';
import {
  parseBoundedInt,
  parseIsoDate,
  parsePositiveInt,
  parseStatus,
  parseUuid,
  type Problems,
} from '../common/params.js';
import { OperationsService } from './operations.service.js';

@Controller('operations')
export class OperationsController {
  constructor(@Inject(OperationsService) private readonly operationsService: OperationsService) {}

  /** Dashboard list: company + status + date-range filters, recency order, paged. */
  @Get()
  list(
    @Query('company_id') companyId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
  ) {
    const problems: Problems = {};
    const cid = parseUuid(companyId, 'company_id', problems);
    const st = parseStatus(status, problems);
    const fromDate = parseIsoDate(from, 'from', problems);
    const toDate = parseIsoDate(to, 'to', problems);
    if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
      problems.to = 'must not be earlier than from';
    }
    const pageNumber = parsePositiveInt(page, 'page', problems, 1);
    const pageSizeNumber = parseBoundedInt(pageSize, 'page_size', problems, 50, 1, 200);

    if (!cid || Object.keys(problems).length > 0) {
      throw new DomainException(400, 'validation_failed', 'invalid operations query', problems);
    }

    return this.operationsService.list({
      companyId: cid,
      status: st,
      from: fromDate,
      to: toDate,
      page: pageNumber,
      pageSize: pageSizeNumber,
    });
  }
}
