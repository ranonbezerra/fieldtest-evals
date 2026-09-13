import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { CreatePlanDto, UpdatePlanDto } from './plans.dto.js';
import { getTenantId } from '../common/tenant-context.js';

@Injectable()
export class PlansRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.prisma.plan.findMany();
  }

  findById(id: string) {
    return this.prisma.prisma.plan.findFirst({ where: { id } });
  }

  create(data: CreatePlanDto) {
    return this.prisma.prisma.plan.create({
      data: { ...data, tenantId: getTenantId() },
    });
  }

  update(id: string, data: UpdatePlanDto) {
    return this.prisma.prisma.plan.update({ where: { id }, data });
  }

  delete(id: string) {
    return this.prisma.prisma.plan.delete({ where: { id } });
  }
}
