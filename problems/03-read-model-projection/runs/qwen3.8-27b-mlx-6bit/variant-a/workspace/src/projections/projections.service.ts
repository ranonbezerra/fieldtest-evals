import { Injectable } from '@nestjs/common';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ProjectionsRepository } from './projections.repository';
import {
  CompanyTotals,
  CreateOrderInput,
  DriftReport,
  OperationRow,
  OrderStatus,
} from './projections.types';

@Injectable()
export class ProjectionsService {
  constructor(private readonly repo: ProjectionsRepository) {}

  /** Called by write services inside the same transaction as the source write. */
  async applyOrderCreated(
    input: CreateOrderInput,
    order: { id: string; createdAt: Date },
  ): Promise<void> {
    // Build the projection row by reading denormalised worker/event fields from source.
    ...
  }
}
