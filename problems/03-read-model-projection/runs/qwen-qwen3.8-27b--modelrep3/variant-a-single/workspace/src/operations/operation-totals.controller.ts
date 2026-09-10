import { Controller, Get, Query } from '@nestjs/common';
import { OperationsService } from './operations.service.js';

@Controller('operation-totals')
export class OperationTotalsController {
  constructor(private readonly operations: OperationsService) {}

  @Get()
  totals(@Query('companyId') companyId: number) {
    return this.operations.getCompanyTotals(companyId);
  }
}
