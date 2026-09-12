import { Module } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service.js';
import { GlobalPrismaService } from './global-prisma.service.js';
import { TenantPrismaService } from './tenant-prisma.service.js';
import { TenantRepository } from './tenant.repository.js';
import { TenantService } from './tenant.service.js';

@Module({
  providers: [
    TenantContextService,
    GlobalPrismaService,
    TenantPrismaService,
    TenantRepository,
    TenantService,
  ],
  exports: [
    TenantContextService,
    GlobalPrismaService,
    TenantPrismaService,
    TenantService,
  ],
})
export class TenantModule {}
