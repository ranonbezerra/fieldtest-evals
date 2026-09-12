import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type Plan } from '@prisma/client';
import { TENANT_PRISMA, type TenantPrisma } from '../prisma/prisma.module.js';

@Injectable()
export class PlanRepository {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: TenantPrisma) {}

  create(data: { name: string; priceCents: number }): Promise<Plan> {
    return this.prisma.plan.create({ data: data as Prisma.PlanUncheckedCreateInput });
  }

  list(): Promise<Plan[]> {
    return this.prisma.plan.findMany({ orderBy: { createdAt: 'asc' } });
  }

  findById(id: string): Promise<Plan | null> {
    return this.prisma.plan.findFirst({ where: { id } });
  }

  update(id: string, data: { name?: string; priceCents?: number }): Promise<Prisma.BatchPayload> {
    return this.prisma.plan.updateMany({ where: { id }, data });
  }

  delete(id: string): Promise<Prisma.BatchPayload> {
    return this.prisma.plan.deleteMany({ where: { id } });
  }
}
