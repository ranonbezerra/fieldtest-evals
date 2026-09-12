import { Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createTenantAwarePrisma } from './tenant-prisma.js';

/** Injection token for the tenant-aware Prisma client. */
export const TENANT_PRISMA = 'TENANT_PRISMA';

/** The Prisma client with tenant scoping applied (see tenant-prisma.ts). */
export type TenantPrisma = PrismaClient;

/** Disconnects the pool on application shutdown. */
@Injectable()
class PrismaConnection implements OnApplicationShutdown {
  constructor(@Inject(TENANT_PRISMA) private readonly prisma: PrismaClient) {}

  onApplicationShutdown(): Promise<void> {
    return this.prisma.$disconnect();
  }
}

@Module({
  providers: [
    {
      provide: TENANT_PRISMA,
      useFactory: () => createTenantAwarePrisma(),
    },
    PrismaConnection,
  ],
  exports: [TENANT_PRISMA],
})
export class PrismaModule {}
