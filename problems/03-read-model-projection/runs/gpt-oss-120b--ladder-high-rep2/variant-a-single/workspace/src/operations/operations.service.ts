import { Injectable } from '@nestjs/common';
import { OperationsRepository } from './operations.repository.js';
import { OperationProjection } from '@prisma/client';

interface ListOperationsFilters {
  companyId?: number;
  status?: string;
  startDate?: Date;
  endDate?: Date;
  skip?: number;
  take?: number;
}

@Injectable()
export class OperationsService {
  constructor(private readonly repo: OperationsRepository) {}

  async listOperations(filters: ListOperationsFilters) {
    const [data, total] = await Promise.all([
      this.repo.findOperations(filters),
      this.repo.countOperations(filters),
    ]);

    return {
      data,
      total,
    };
  }
}
