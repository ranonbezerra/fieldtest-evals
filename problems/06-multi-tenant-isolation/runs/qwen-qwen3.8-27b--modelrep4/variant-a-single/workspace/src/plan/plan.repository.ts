import { Injectable } from '@nestjs/common';
import type { Plan } from '@prisma/client';
import { ConflictError } from '../common/api-error.js';
import { isPrismaUniqueViolation } from '../common/prisma-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class PlanRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<Plan[]> {
    return this.prisma.client.plan.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }

  findById(id: string): Promise<Plan | null> {
    return this.prisma.client.plan.findUnique({ where: { id } });
  }

  async create(data: { name: string; priceCents: number; currency?: string }): Promise<Plan> {
    try {
      return await this.prisma.client.plan.create({ data });
    } catch (error) {
      if (isPrismaUniqueViolation(error)) {
        throw new ConflictError('plan_name_already_exists', `A plan named "${data.name}" already exists in this tenant`);
      }
      throw error;
    }
  }
}
