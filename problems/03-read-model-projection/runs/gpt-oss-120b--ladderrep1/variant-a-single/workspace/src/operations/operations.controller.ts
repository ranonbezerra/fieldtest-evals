import {
  Controller,
  Get,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { OperationsService } from './operations.service';

@Controller('operations')
export class OperationsController {
  constructor(private readonly opsService: OperationsService) {}

  @Get()
  async list(
    @Query('companyId', new DefaultValuePipe(null), ParseIntPipe) companyId: number | null,
    @Query('status') status: string | null,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page', new DefaultValuePipe('1'), ParseIntPipe) page: number = 1,
    @Query('pageSize', new DefaultValuePipe('20'), ParseIntPipe) pageSize: number = 20,
  ) {
    const filters = {
      companyId,
      status,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    };
    return this.opsService.getOperations(filters, page, pageSize);
  }
}
