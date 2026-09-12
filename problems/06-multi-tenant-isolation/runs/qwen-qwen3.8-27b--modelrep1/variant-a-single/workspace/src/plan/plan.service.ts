import { Injectable } from '@nestjs/common';
import type { Plan } from '@prisma/client';
import { AppError } from '../common/app-error.js';
import { fromPrismaError } from '../common/prisma-errors.js';
import { CreatePlanDto, UpdatePlanDto } from './plan.dto.js';
import { PlanRepository } from './plan.repository.js';

@Injectable()
export class PlanService {
  constructor(private readonly plans: PlanRepository) {}

  create(dto: CreatePlanDto): Promise<Plan> {
    return this.plans.create({ name: dto.name, priceCents: dto.priceCents }).catch((error: unknown) => {
      throw fromPrismaError(error);
    });
  }

  list(): Promise<Plan[]> {
    return this.plans.list();
  }

  async get(id: string): Promise<Plan> {
    const plan = await this.plans.findById(id);
    if (!plan) {
      throw new AppError(404, 'resource_not_found', `Plan ${id} was not found for the current tenant`);
    }
    return plan;
  }

  async update(id: string, dto: UpdatePlanDto): Promise<Plan> {
    const data: { name?: string; priceCents?: number } = {};
    if (dto.name !== undefined) {
      data.name = dto.name;
    }
    if (dto.priceCents !== undefined) {
      data.priceCents = dto.priceCents;
    }

    if (Object.keys(data).length > 0) {
      const result = await this.plans.update(id, data).catch((error: unknown) => {
        throw fromPrismaError(error);
      });
      if (result.count === 0) {
        throw new AppError(404, 'resource_not_found', `Plan ${id} was not found for the current tenant`);
      }
    }
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    const result = await this.plans.delete(id);
    if (result.count === 0) {
      throw new AppError(404, 'resource_not_found', `Plan ${id} was not found for the current tenant`);
    }
  }
}
