import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { PlanRepository } from './plan.repository.js';

@Injectable()
export class PlanService {
  constructor(private readonly plans: PlanRepository) {}

  list() {
    return this.plans.list();
  }

  async get(id: string) {
    const plan = await this.plans.findById(id);
    if (!plan) {
      throw new AppError(404, 'resource_not_found', `Plan ${id} was not found for this tenant.`, {
        id,
      });
    }
    return plan;
  }

  async create(input: { name: string; priceCents?: number }) {
    // A duplicate plan name inside the tenant surfaces as Prisma P2002 ->
    // 409 via the global filter.
    return this.plans.create({ name: input.name, priceCents: input.priceCents ?? 0 });
  }
}
