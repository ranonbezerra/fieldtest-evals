import { Injectable } from '@nestjs/common';
import type { Plan } from '@prisma/client';
import { NotFoundError } from '../common/api-error.js';
import { PlanRepository } from './plan.repository.js';

export interface PlanCreateInput {
  name: string;
  priceCents: number;
  currency?: string;
}

@Injectable()
export class PlanService {
  constructor(private readonly plans: PlanRepository) {}

  list(): Promise<Plan[]> {
    return this.plans.list();
  }

  async get(id: string): Promise<Plan> {
    const plan = await this.plans.findById(id);
    if (!plan) {
      throw new NotFoundError(`Plan with id "${id}" was not found in this tenant`);
    }
    return plan;
  }

  create(input: PlanCreateInput): Promise<Plan> {
    return this.plans.create(input);
  }
}
