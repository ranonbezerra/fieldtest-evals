import { Injectable } from '@nestjs/common';
import { PlanRepository } from './plan.repository.js';
import { CreatePlanInput, UpdatePlanInput, Plan } from './dto.js';
import { ResourceNotFoundError, ConflictError } from '../multi-tenant/errors.js';

@Injectable()
export class PlanService {
  constructor(private readonly repo: PlanRepository) {}

  async list(): Promise<Plan[]> {
    return this.repo.list();
  }

  async findById(id: string): Promise<Plan> {
    const plan = await this.repo.findById(id);
    if (!plan) {
      throw new ResourceNotFoundError('plan');
    }
    return plan;
  }

  async create(input: CreatePlanInput): Promise<Plan> {
    try {
      return await this.repo.create(input);
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: string }).code === 'P2002'
      ) {
        throw new ConflictError();
      }
      throw err;
    }
  }

  async update(id: string, input: UpdatePlanInput): Promise<Plan> {
    return this.repo.update(id, input);
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete(id);
  }
}
