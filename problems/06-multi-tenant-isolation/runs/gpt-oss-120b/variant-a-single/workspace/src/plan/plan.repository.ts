// src/plan/plan.repository.ts

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, Plan } from '@prisma/client';

// ASSUMPTION: The Prisma schema defines a `Plan` model and the generated client
// exports it as `Plan`. If the model name differs, adjust the import accordingly.

@Injectable()
export class PlanRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Create a new plan
  async create(data: Prisma.PlanCreateInput): Promise<Plan> {
    return this.prisma.plan.create({ data });
  }

  // Find a plan by its unique identifier
  async findById(id: string): Promise<Plan | null> {
    return this.prisma.plan.findUnique({ where: { id } });
  }

  // Retrieve all plans for the current tenant (tenant filtering is applied
  // automatically by the tenant‑aware Prisma client middleware)
  async findAll(args?: Prisma.PlanFindManyArgs): Promise<Plan[]> {
    return this.prisma.plan.findMany(args);
  }

  // Update an existing plan
  async update(
    id: string,
    data: Prisma.PlanUpdateInput,
  ): Promise<Plan> {
    return this.prisma.plan.update({
      where: { id },
      data,
    });
  }

  // Delete a plan
  async delete(id: string): Promise<Plan> {
    return this.prisma.plan.delete({ where: { id } });
  }
}
