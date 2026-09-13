import { Injectable, AppError } from '../types/app.errors.ts';
import { DashboardRepository } from './dashboard.repository.ts';
import { OrderService } from '../order/order.service.ts';

@Injectable()
export class DashboardService {
  constructor(
    private readonly repo: DashboardRepository,
    private readonly orderService: OrderService,
  ) {}

  async getDashboard(params: {
    companyId: string;
    status?: string;
    createdFrom?: Date;
    createdTo?: Date;
    page?: number;
    pageSize?: number;
  }) {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;

    const { data, total } = await this.repo.findPage(
      params.companyId,
      params.status,
      params.createdFrom,
      params.createdTo,
      page,
      pageSize,
    );

    const totals = await this.repo.findCompanyTotals(params.companyId);

    return {
      data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
      companyTotals: totals,
    };
  }
}
