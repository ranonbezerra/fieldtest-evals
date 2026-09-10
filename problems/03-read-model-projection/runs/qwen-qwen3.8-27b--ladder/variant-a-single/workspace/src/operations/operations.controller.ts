import {
  Controller,
  Get,
  Query,
  ParseStringPipe,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import { OperationsService } from './operations.service';

@Controller('operations')
export class OperationsController {
  constructor(private readonly operationsService: OperationsService) {}

  @Get()
  async list(
    @Query('company', new ParseStringPipe()) company: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.operationsService.listOperations({
      company,
      status,
      from,
      to,
      page,
      limit,
    });
  }
}
