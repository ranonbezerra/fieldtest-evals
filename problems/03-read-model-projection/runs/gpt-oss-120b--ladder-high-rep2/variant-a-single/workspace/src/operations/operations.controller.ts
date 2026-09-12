import { Controller, Get, Query } from '@nestjs/common';
import { OperationsService } from './operations.service.js';

interface ListOperationsDto {
  companyId?: number;
  status?: string;
  startDate?: Date;
  endDate?: Date;
  skip?: number;
  take?: number;
}

@Controller('operations')
export class OperationsController {
  constructor(private readonly operationsService: OperationsService) {}

  @Get()
  async list(@Query() query: Record<string, any>) {
    const filters: ListOperationsDto = {
      companyId: query.companyId ? Number(query.companyId) : undefined,
      status: query.status,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
      skip: query.page && query.pageSize ? Number(query.page) * Number(query.pageSize) : undefined,
      take: query.pageSize ? Number(query.pageSize) : undefined,
    };
    return this.operationsService.listOperations(filters);
  }
}
