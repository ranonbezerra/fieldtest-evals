import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiError } from '../common/api-error';
import { parseOptionalDate, parsePositiveInt, parseRequiredPositiveInt, parseStatuses } from '../common/validation';
import { OperationsService } from './operations.service';
import type { OperationPage } from './operations.service';

@Controller()
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  /** The new dashboard list: reads the projection only, p95 target < 50 ms. */
  @Get('operations')
  list(
    @Query('companyId') companyId: string | undefined,
    @Query('status') status: string | string[] | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
  ): Promise<OperationPage> {
    // ASSUMPTION: the dashboard is always company-scoped, so companyId is
    // required; the covering index leads with company_id.
    const parsedCompanyId = parseRequiredPositiveInt(companyId, 'companyId');
    const statuses = parseStatuses(status);
    const fromDate = parseOptionalDate(from, 'from');
    const toDate = parseOptionalDate(to, 'to');
    if (fromDate !== undefined && toDate !== undefined && fromDate.getTime() >= toDate.getTime()) {
      throw new ApiError(400, 'validation_failed', 'from must be strictly earlier than to', {
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
      });
    }
    const pageNum = parsePositiveInt(page ?? '1', 'page');
    const size = parsePositiveInt(pageSize ?? '20', 'pageSize');
    if (size > 100) {
      throw new ApiError(400, 'validation_failed', 'pageSize must be at most 100', { pageSize: size });
    }
    return this.operations.listOperations({
      companyId: parsedCompanyId,
      statuses,
      from: fromDate,
      to: toDate,
      page: pageNum,
      pageSize: size,
    });
  }

  /** Exact per-company financial totals (the maintained totals row). */
  @Get('company-totals/:companyId')
  totals(@Param('companyId') companyId: string) {
    return this.operations.getCompanyTotals(parseRequiredPositiveInt(companyId, 'companyId'));
  }
}
