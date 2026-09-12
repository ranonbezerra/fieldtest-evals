import { Injectable } from '@nestjs/common';
import { OperationsRepository } from './operations.repository.js';

@Injectable()
export class OperationsService {
  constructor(private readonly repo: OperationsRepository) {}

  async getDashboard(params: {
    companyId?: string;
    status?: string;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    pageSize?: number;
  }) {
    return this.repo.getDashboard(params);
  }

  async rederiveWindow(startDate: Date, endDate: Date) {
    await this.repo.rederiveWindow(startDate, endDate);
  }

  async repairDrift() {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    await this.repo.repairDrift(oneHourAgo, now);
  }
}
