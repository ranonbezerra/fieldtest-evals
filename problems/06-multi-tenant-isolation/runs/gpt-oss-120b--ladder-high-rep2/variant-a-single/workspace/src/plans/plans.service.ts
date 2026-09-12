import { Injectable } from '@nestjs/common';
import { PlansRepository } from './plans.repository.js';
import { CreatePlanDto } from './dto/create-plan.dto.js';
import { UpdatePlanDto } from './dto/update-plan.dto.js';
import { Plan } from '@prisma/client';

@Injectable()
export class PlansService {
  constructor(private readonly repo: PlansRepository) {}

  async create(dto: CreatePlanDto): Promise<Plan> {
    return this.repo.create(dto);
  }

  async findAll(): Promise<Plan[]> {
    return this.repo.findAll();
  }

  async findOne(id: string): Promise<Plan | null> {
    return this.repo.findById(id);
  }

  async update(id: string, dto: UpdatePlanDto): Promise<Plan | null> {
    try {
      return await this.repo.update(id, dto);
    } catch (err) {
      return null;
    }
  }

  async remove(id: string): Promise<Plan | null> {
    try {
      return await this.repo.delete(id);
    } catch (err) {
      return null;
    }
  }
}
