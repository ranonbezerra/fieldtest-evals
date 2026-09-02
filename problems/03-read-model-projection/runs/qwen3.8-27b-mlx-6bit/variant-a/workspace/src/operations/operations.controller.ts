// ASSUMPTION: The first compiler error for this file was truncated in the provided output.
// It appears to reference a property access on PrismaClient (suggesting 'event' as a close match).
// The rewrite below eliminates any PrismaClient usage from the controller entirely, which is
// consistent with the layer rules (controller must not touch the database).

import { Controller, Get, Post, Body, Param, Query } from "@nestjs/common";
import { OperationsService } from "./operations.service";
import {
  DashboardQuery,
  DashboardResult,
  SimulateWriteInput,
  OperationRow,
  CompanyTotals,
  ValidationError,
} from "./operations.types";

@Controller()
export class OperationsController {
  constructor(private readonly service: OperationsService) {}

  @Get("operations")
  async getDashboard(@Query() query: Record<string, string>): Promise<DashboardResult> {
    const companyId = query.company_id;
    if (!companyId) {
      throw new ValidationError("company_id is required", {});
    }

    const page = parseInt(query.page ?? "1", 10);
    if (Number.isNaN(page) || page < 1) {
      throw new ValidationError("page must be a positive integer", {});
    }

    const pageSize = parseInt(query.page_size ?? "20", 10);
    if (Number.isNaN(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new ValidationError("page_size must be between 1 and 100", {});
    }

    const status = query.status as DashboardQuery["status"] | undefined;
    const dateFrom = query.date_from ? new Date(query.date_from) : undefined;
    const dateTo = query.date_to ? new Date(query.date_to) : undefined;

    return this.service.getDashboard({
      company_id: companyId,
      status,
      date_from: dateFrom,
      date_to: dateTo,
      page,
      page_size: pageSize,
    });
  }

  @Post("operations/simulate-write")
  async simulateWrite(@Body() input: SimulateWriteInput): Promise<OperationRow> {
    return this.service.simulateWrite(input);
  }

  @Get("operations/totals/:companyId")
  async getTotals(@Param("companyId") companyId: string): Promise<CompanyTotals> {
    return this.service.getCompanyTotals(companyId);
  }
}
