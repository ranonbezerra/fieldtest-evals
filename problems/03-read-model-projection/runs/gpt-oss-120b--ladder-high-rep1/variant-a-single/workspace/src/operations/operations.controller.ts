import { Controller, Get, Query } from '@nestjs/common';
import { OperationsService } from './operations.service.js';
import {
  IsOptional,
  IsInt,
  IsString,
  IsDateString,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

class ListOperationsDto {
  @IsOptional()
  @IsInt()
  @Transform(({ value }: { value: any }) => parseInt(value, 10))
  companyId?: number;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsInt()
  @Transform(({ value }: { value: any }) => parseInt(value, 10))
  @Min(0)
  limit?: number = 20;

  @IsOptional()
  @IsInt()
  @Transform(({ value }: { value: any }) => parseInt(value, 10))
  @Min(0)
  offset?: number = 0;
}

@Controller('operations')
export class OperationsController {
  constructor(private readonly operationsService: OperationsService) {}

  @Get()
  async list(@Query() query: ListOperationsDto) {
    const {
      companyId,
      status,
      startDate,
      endDate,
      limit = 20,
      offset = 0,
    } = query;
    return this.operationsService.listOperations({
      companyId,
      status,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      limit,
      offset,
    });
  }
}
