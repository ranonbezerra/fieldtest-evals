import { Controller, Get, Query, Req } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { AppError, appErrorResponse } from '../types/app.errors';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  async list(
    @Query('companyId') companyId: string,
    @Query('status') status?: string,
    @Query('createdFrom') createdFrom?: string,
    @Query('createdTo') createdTo?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    try {
      if (!companyId) {
        throw new AppError('invalid_input', 'companyId is required', 400);
      }
      return await this.dashboardService.getDashboard({
        companyId,
        status,
        createdFrom: createdFrom ? new Date(createdFrom) : undefined,
        createdTo: createdTo ? new Date(createdTo) : undefined,
        page: page ? parseInt(page, 10) : 1,
        pageSize: pageSize ? parseInt(pageSize, 10) : 20,
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError('internal_error', (err as Error).message, 500);
    }
  }
}
