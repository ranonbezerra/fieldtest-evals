import { Controller, Get, Post, Body, Query, Param } from '@nestjs/common';
import { OperationsService } from './operations.service';
import {
  DashboardQuery,
  DashboardResult,
  SimulateWriteInput,
  OperationRow,
  CompanyTotals,
  OrderStatus,
} from './operations.types';

@Controller('operations')
export class OperationsController {
  constructor(private readonly service: OperationsService) {}

  @Get()
  getDashboard(
    @Query('company_id') companyId: string,
    @Query('status') status?: string,
    @Query('date_from') dateFrom?: string,
    @Query('date_to') dateTo?: string,
    @Query('page') page?: string,
    @Query('page_size') pageSize?: string,
  ): Promise<DashboardResult> {
    const query: DashboardQuery = {
      company_id: companyId,
      page: parseInt(page ?? '1', 10),
      page_size: parseInt(pageSize ?? '20', 10),
    };
    if (status) query.status = status as OrderStatus;
    if (dateFrom) query.date_from = new Date(dateFrom);
    if (dateTo) query.date_to = new Date(dateTo);
    return this.service.getDashboard(query);
  }

  @Post('simulate-write')
  simulateWrite(@Body() input: SimulateWriteInput): Promise<OperationRow> {
    return this.service.simulateWrite(input);
  }

  @Get('totals/:companyId')
  getTotals(@Param('companyId') companyId: string): Promise<CompanyTotals> {
    return this.service.getCompanyTotals(companyId);
  }
}
