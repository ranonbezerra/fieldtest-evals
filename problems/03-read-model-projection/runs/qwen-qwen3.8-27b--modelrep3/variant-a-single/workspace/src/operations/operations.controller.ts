import { Controller, Get, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ORDER_STATUSES, type OrderStatus } from './order-status.js';
import { OperationsService } from './operations.service.js';

export class ListOperationsQuery {
  @IsInt()
  @Type(() => Number)
  companyId!: number;

  @IsOptional()
  @IsIn([...ORDER_STATUSES])
  status?: OrderStatus;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

@Controller('operations')
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get()
  list(@Query() query: ListOperationsQuery) {
    return this.operations.listDashboard({
      companyId: query.companyId,
      status: query.status,
      from: query.from,
      to: query.to,
      page: query.page,
      pageSize: query.pageSize,
    });
  }
}
