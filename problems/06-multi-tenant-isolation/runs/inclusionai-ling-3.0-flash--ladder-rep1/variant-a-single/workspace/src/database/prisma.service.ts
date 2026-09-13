import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createTenantExtension } from '../tenant/tenant-prisma.extension.js';
import { getTenantId } from '../common/tenant-context.js';

@Injectable()
export class PrismaService implements OnModuleDestroy {
  public readonly prisma: PrismaClient;

  constructor() {
    const baseClient = new PrismaClient({ log: ['error', 'warn'] });
    this.prisma = baseClient.$extends(createTenantExtension(() => getTenantId())) as PrismaClient;
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
