import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { TenantContextService } from './tenant-context.service.js';
import { TenantResolutionMiddleware } from './tenant-resolution.middleware.js';
import { TenantPrismaService } from './tenant-prisma.service.js';

@Module({
  providers: [
    PrismaService,
    TenantContextService,
    TenantResolutionMiddleware,
    TenantPrismaService,
  ],
  exports: [PrismaService, TenantContextService, TenantPrismaService],
})
export class MultiTenantModule {}
