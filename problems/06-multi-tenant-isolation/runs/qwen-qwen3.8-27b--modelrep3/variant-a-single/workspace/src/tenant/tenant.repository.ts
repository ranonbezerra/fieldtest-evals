import { Injectable } from '@nestjs/common';
import { GlobalPrismaService } from './global-prisma.service.js';

@Injectable()
export class TenantRepository {
  constructor(private readonly prisma: GlobalPrismaService) {}

  findByHost(host: string) {
    return this.prisma.tenant.findUnique({ where: { host } });
  }

  findById(id: string) {
    return this.prisma.tenant.findUnique({ where: { id } });
  }
}
