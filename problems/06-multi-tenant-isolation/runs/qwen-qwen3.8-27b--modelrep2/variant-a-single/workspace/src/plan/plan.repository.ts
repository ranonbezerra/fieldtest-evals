import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class PlanRepository {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.tenant.plan.findMany({ orderBy: { createdAt: 'asc' } });
  }

  findById(id: string) {
    return this.prisma.tenant.plan.findFirst({ where: { id } });
  }

  create(data: { name: string; priceCents: number }) {
    return this.prisma.tenant.plan.create({ data });
  }
}
