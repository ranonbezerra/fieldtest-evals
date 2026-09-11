import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TenantContextStorage } from './tenant-context';
import { createTenantAwareClient } from './tenant-db.factory';

/**
 * Injection token for the tenant-aware Prisma client. Repositories inject
 * this (never the raw client), so no repository or handler can mention a
 * tenant id.
 */
export const TENANT_DB = Symbol('TENANT_DB');

@Module({
  providers: [
    PrismaService,
    TenantContextStorage,
    {
      provide: TENANT_DB,
      inject: [PrismaService, TenantContextStorage],
      useFactory: (base: PrismaService, storage: TenantContextStorage) =>
        createTenantAwareClient(base, storage),
    },
  ],
  exports: [PrismaService, TenantContextStorage, TENANT_DB],
})
export class PrismaModule {}
