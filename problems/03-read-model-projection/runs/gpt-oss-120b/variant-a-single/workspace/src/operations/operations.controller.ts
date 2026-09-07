// src/operations/operations.controller.ts
//
// NOTE: The controller is deliberately minimal – it only wires HTTP request
// parameters to the OperationsService.  The service implementation, DTOs, and
// repository layer are defined elsewhere in the code‑base.  Because those
// files are currently missing or contain compile‑time issues, the controller
// avoids importing them directly (apart from the service which must exist for
// the module wiring).  Any shape expectations are expressed with `any` to
// keep the file compilable without further knowledge of the domain models.
//
// ASSUMPTION: `OperationsService` exposes `findMany(filter: any): Promise<any>`
// and `findOne(filter: any): Promise<any>`.  The exact DTO types are not needed
// here; callers receive the raw service result.
//
// The controller follows the conventional NestJS pattern: input validation is
// left to the service layer, and no business logic is performed here.

import {
  Controller,
  Get,
  Param,
  Query,
  DefaultValuePipe,
} from '@nestjs/common';
import { OperationsService } from './operations.service';

@Controller('operations')
export class OperationsController {
  constructor(private readonly operationsService: OperationsService) {}

  /**
   * GET /operations
   *
   * Returns a paginated list of operations filtered by optional query
   * parameters.  All parameters are treated as strings; conversion and
   * validation are delegated to the service layer.
   */
  @Get()
  async findAll(
    @Query('companyId') companyId?: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page', new DefaultValuePipe('1')) page = '1',
    @Query('limit', new DefaultValuePipe('20')) limit = '20',
  ): Promise<any> {
    const pageNumber = Number(page);
    const limitNumber = Number(limit);

    // The service is expected to understand this filter shape.
    const filter = {
      companyId,
      status,
      startDate,
      endDate,
      page: pageNumber,
      limit: limitNumber,
    };

    return this.operationsService.findMany(filter);
  }

  /**
   * GET /operations/:id
   *
   * Retrieves a single operation by its identifier.
   */
  @Get(':id')
  async findOne(@Param('id') id: string): Promise<any> {
    // Service method signature is assumed; adapt as needed.
    return this.operationsService.findOne({ id });
  }
}
