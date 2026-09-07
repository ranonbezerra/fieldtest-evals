# repair1-operations.controller.ts

## reasoning

```
We need to create controller with correct imports. Likely missing files. We can stub imports. Provide minimal controller class with NestJS decorators, using OperationsService. Also import DTOs. Provide placeholder types.

We'll assume DTO files exist. We'll import from './dto/operation.dto' etc. Also need to export controller.

Implement GET endpoint for list with query params for filter, pagination. Use @Get('operations').

We'll just create class with constructor injecting OperationsService. Provide method getOperations(@Query() dto: any): Promise<any>. Use service.getOperations(dto).

Add necessary Nest imports: Controller, Get, Query, Param, Body, Post, Put, Delete.

Provide placeholder.

Let's write file.
```

## reply

```ts
// src/operations/operations.controller.ts

import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { OperationsService } from './operations.service';
import { OperationDto } from './dto/operation.dto';
import { PaginationDto } from './dto/pagination.dto';

// ASSUMPTION: The DTOs (OperationDto, PaginationDto) and the service methods exist
// and conform to the needs of the dashboard. Their exact shapes are not provided
// in the current task description, so we treat them as opaque types.

@Controller('operations')
export class OperationsController {
  constructor(private readonly operationsService: OperationsService) {}

  /**
   * List operations with optional filters, pagination and sorting.
   * The query parameters are mapped to a DTO that the service can handle.
   */
  @Get()
  async list(
    @Query() pagination: PaginationDto,
    @Query('companyId') companyId?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<any> {
    // Build a filter object expected by the service.
    const filter = {
      companyId,
      status,
      startDate,
      endDate,
      pagination,
    };
    return this.operationsService.findMany(filter);
  }

  /**
   * Retrieve a single operation by its identifier.
   */
  @Get(':id')
  async get(@Param('id') id: string): Promise<any> {
    return this.operationsService.findOne({ id });
  }

  /**
   * Create a new operation.
   * The body should conform to OperationDto.
   */
  @Post()
  async create(@Body() dto: OperationDto): Promise<any> {
    return this.operationsService.create(dto);
  }

  /**
   * Update an existing operation.
   */
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: OperationDto): Promise<any> {
    return this.operationsService.update({ id }, dto);
  }

  /**
   * Delete an operation.
   */
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<any> {
    return this.operationsService.remove({ id });
  }
}
```
