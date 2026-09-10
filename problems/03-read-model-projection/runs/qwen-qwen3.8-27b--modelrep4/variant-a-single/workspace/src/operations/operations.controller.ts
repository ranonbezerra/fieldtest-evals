import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { OperationsService } from './operations.service.js';
import { ApiError } from '../common/api-error.js';
import { asBodyObject, optionalPositiveInt, optionalQueryDate, optionalString, requiredString } from '../common/validate.js';

@Controller('operations')
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get()
  list(
    @Query('companyId') companyId: string | undefined,
    @Query('status') status: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
  ) {
    if (typeof companyId !== 'string' || companyId.trim() === '') {
      throw new ApiError(400, 'validation_error', 'query parameter "companyId" is required', { field: 'companyId' });
    }
    const optionalStrings: Record<'status' | 'from' | 'to', string | undefined> = { status, from, to };
    for (const field of ['status', 'from', 'to'] as const) {
      const value = optionalStrings[field];
      if (value !== undefined && (typeof value !== 'string' || value.trim() === '')) {
        throw new ApiError(400, 'validation_error', `query parameter "${field}" must be a non-empty string`, { field });
      }
    }
    const fromDate = optionalQueryDate(from, 'from');
    const toDate = optionalQueryDate(to, 'to');
    // ASSUMPTION: the dashboard is company-scoped (operators view their own
    // company's operations), so companyId is required; that is what lets the
    // (company_id, ...) indexes lead the query at 3M rows.
    return this.operations.list({
      companyId,
      status,
      from: fromDate?.toISOString(),
      to: toDate?.toISOString(),
      page: optionalPositiveInt(page, 'page'),
      pageSize: optionalPositiveInt(pageSize, 'pageSize'),
    });
  }

  @Post('rederive')
  @HttpCode(200)
  rederive(@Body() body: unknown) {
    const b = asBodyObject(body);
    const from = requiredString(b, 'from');
    const to = requiredString(b, 'to');
    const companyId = optionalString(b, 'companyId');
    return this.operations.rederive(from, to, companyId);
  }
}
