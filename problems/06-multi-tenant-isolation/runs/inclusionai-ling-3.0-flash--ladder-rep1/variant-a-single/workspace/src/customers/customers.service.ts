import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId: string) {
    return this.prisma.customer.findMany({ where: { tenantId } });
  }

  findOne(id: string, tenantId: string) {
    return this.prisma.customer.findFirst({ where: { id, tenantId } });
  }

  create(tenantId: string, data: { email: string; name: string; phone?: string }) {
    return this.prisma.customer.create({
      data: { ...data, tenantId },
    });
  }

  update(id: string, tenantId: string, data: Partial<{ email: string; name: string; phone?: string }>) {
    return this.prisma.customer.update({ where: { id, tenantId }, data });
  }

  delete(id: string, tenantId: string) {
    return this.prisma.customer.delete({ where: { id, tenantId } });
  }
}
