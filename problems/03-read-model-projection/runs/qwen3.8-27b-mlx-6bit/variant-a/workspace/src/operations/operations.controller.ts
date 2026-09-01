import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import type {
  OperationPage,
  OperationQueryParams,
  OrderStatus,
} from '../projections/projections.types.js';
import { OperationsService } from './operations.service.js';

const VALID_STATUSES: readonly OrderStatus[] = ['pending', 'approved', 'rejected'];
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;

@Controller()
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  // ASSUMPTION: the plan does not pin down controller-side validation beyond
  // parsing; malformed input (missing companyId, unknown status, non-integer or
  // < 1 page/pageSize, unparseable dates) is rejected here with
  // invalid_query_params using the standard error envelope.
  @Get('operations')
  async query(
    @Query('companyId') companyId: string,
    @Query('status') status?: OrderStatus,
    @Query('from') from?: string, // ISO 8601
    @Query('to') to?: string, // ISO 8601
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<OperationPage> {
    if (!companyId) {
      throw this.invalidParams('companyId is required.', { field: 'companyId' });
    }

    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      throw this.invalidParams(`status must be one of: ${VALID_STATUSES.join(', ')}.`, {
        field: 'status',
        value: status,
      });
    }

    const params: OperationQueryParams = {
      companyId,
      page: this.parsePositiveInt('page', page, DEFAULT_PAGE),
      pageSize: this.parsePositiveInt('pageSize', pageSize, DEFAULT_PAGE_SIZE),
    };

    if (status !== undefined) {
      params.status = status;
    }

    const fromDate = this.parseDate('from', from);
    if (fromDate !== undefined) {
      params.from = fromDate;
    }

    const toDate = this.parseDate('to', to);
    if (toDate !== undefined) {
      params.to = toDate;
    }

    return this.operations.query(params);
  }

  private invalidParams(message: string, details: Record<string, unknown>): BadRequestException {
    return new BadRequestException({
      error: {
        code: 'invalid_query_params',
        message,
        details,
      },
    });
  }

  private parsePositiveInt(field: string, raw: string | undefined, fallback: number): number {
    if (raw === undefined) {
      return fallback;
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) {
      throw this.invalidParams(`${field} must be a positive integer.`, { field, value: raw });
    }
    return value;
  }

  private parseDate(field: string, raw?: string): Date | undefined {
    if (raw === undefined) {
      return undefined;
    }
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      throw this.invalidParams(`${field} must be a valid ISO 8601 date.`, { field, value: raw });
    }
    return date;
  }
}
