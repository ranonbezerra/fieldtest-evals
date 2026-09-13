import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantConfig } from '@prisma/client';

@Injectable()
export class TenantConfigRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getConfig(): Promise<TenantConfig | null> {
    // The Prisma middleware automatically injects tenantId filter
    return this.prisma.tenantConfig.findFirst();
  }
}
