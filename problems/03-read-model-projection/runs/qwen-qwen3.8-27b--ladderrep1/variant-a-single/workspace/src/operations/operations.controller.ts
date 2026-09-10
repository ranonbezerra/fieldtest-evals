import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  finishValidation,
  parseOptionalIsoDate,
  parseOptionalUuid,
  parsePositiveInt,
  parseRequiredIsoDate,
  parseStatus,
  requireUuid,
  ValidationErrors,
} from '../common/validation.js';
import { FinancialTotalsDto, OperationListResult, OperationsService } from './operations.service.js';

@Controller('operations')
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get()
  list(@Query() query: Record<string, string | undefined>): Promise<OperationListResult> {
    const errors: ValidationErrors = {};
    const companyId = parseOptionalUuid(query?.companyId, 'companyId', errors);
    const status = parseStatus(query?.status, 'status', errors);
    const from = parseOptionalIsoDate(query?.from, 'from', errors);
    const to = parseOptionalIsoDate(query?.to, 'to', errors);
    const page = parsePositiveInt(query?.page, 'page', errors, 1_000_000) ?? 1;
    const pageSize = parsePositiveInt(query?.pageSize, 'pageSize', errors, 100) ?? 20;
    if (from !== undefined && to !== undefined && from.getTime() >= to.getTime()) {
      errors.to = 'must be strictly after "from"';
    }
    finishValidation(errors);
    return this.operations.list({ companyId, status, from, to, page, pageSize });
  }

  @Get('companies/:companyId/financial-totals')
  financialTotals(@Param('companyId') companyId: string): Promise<FinancialTotalsDto> {
    requireUuid(companyId, 'companyId');
    return this.operations.totals(companyId);
  }

  @Post('rederive')
  rederive(@Body() body: Record<string, unknown> | undefined): Promise<{ rowsRebuilt: number }> {
    const errors: ValidationErrors = {};
    const from = parseRequiredIsoDate(body?.from, 'from', errors);
    const to = parseRequiredIsoDate(body?.to, 'to', errors);
    if (from !== undefined && to !== undefined && from.getTime() >= to.getTime()) {
      errors.to = 'must be strictly after "from"';
    }
    finishValidation(errors);
    return this.operations.rederive(from as Date, to as Date);
  }
}
