import { Injectable, NotFoundException } from '@nestjs/common';
import { PlansRepository } from './plans.repository.js';
import { CreatePlanDto, UpdatePlanDto } from './plans.dto.js';

@Injectable()
export class PlansService {
  constructor(private readonly repository: PlansRepository) {}

  async findAll() {
    return this.repository.findAll();
  }

  async findById(id: string) {
    const plan = await this.repository.findById(id);
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    return plan;
  }

  async create(data: CreatePlanDto) {
    return this.repository.create(data);
  }

  async update(id: string, data: UpdatePlanDto) {
    try {
      return await this.repository.update(id, data);
    } catch {
      throw new NotFoundException('Plan not found');
    }
  }

  async delete(id: string) {
    try {
      return await this.repository.delete(id);
    } catch {
      throw new NotFoundException('Plan not found');
    }
  }
}
