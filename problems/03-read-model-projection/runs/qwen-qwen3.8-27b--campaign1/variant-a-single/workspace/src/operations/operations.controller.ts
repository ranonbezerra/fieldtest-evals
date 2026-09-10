import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import type {
  CompanyTotalsDto,
  DriftReport,
  OperationsPage,
  RederiveResult,
} from './operations.dto.js';
import { CompanyIdQueryDto, GetOperationsQueryDto, GetWindowDto } from './operations.dto.js';
import { OperationsService } from './operations.service.js';

@Controller('operations')
export class OperationsController {
  constructor(private readonly operationsService: OperationsService) {}

  @Get()
  listOperations(@Query() query: GetOperationsQueryDto): Promise<OperationsPage> {
    return this.operationsService.listOperations({
      companyId: query.companyId,
      status: query.status,
      from: query.from !== undefined ? new Date(query.from) : undefined,
      to: query.to !== undefined ? new Date(query.to) : undefined,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
    });
  }

  @Get('totals')
  getTotals(@Query() query: CompanyIdQueryDto): Promise<CompanyTotalsDto> {
    return this.operationsService.getTotals(query.companyId);
  }

  @Post('reconcile')
  rederive(@Body() body: GetWindowDto): Promise<RederiveResult> {
    return this.operationsService.rederiveWindow(new Date(body.from), new Date(body.to));
  }

  @Post('drift-repair')
  repairDrift(@Body() body: GetWindowDto): Promise<DriftReport> {
    return this.operationsService.repairDriftWindow(new Date(body.from), new Date(body.to));
  }
}
