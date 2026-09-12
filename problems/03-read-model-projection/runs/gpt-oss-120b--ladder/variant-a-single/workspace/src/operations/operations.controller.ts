import {
  Controller,
  Get,
  Query,
  ValidationPipe,
  UsePipes,
} from '@nestjs/common';
import { OperationsService } from './operations.service.js';
import { QueryOperationsDto } from './dto/query-operations.dto.js';

@Controller('operations')
export class OperationsController {
  constructor(private readonly operationsService: OperationsService) {}

  @Get()
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async list(@Query() query: QueryOperationsDto) {
    return this.operationsService.queryDashboard(query);
  }
}
