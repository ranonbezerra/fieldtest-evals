import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { applyTenantScope } from './tenant-scope.js';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly client = new PrismaClient();

  /**
   * Tenant-scoped client used by every repository: reads are automatically
   * filtered to the ambient tenant, writes are stamped with it. No caller
   * ever passes tenantId explicitly.
   */
  readonly tenant = applyTenantScope(this.client);

  /**
   * Unscoped client. Only the tenant registry itself (the Tenant model)
   * may use it, because tenant resolution runs before any request-scoped
   * tenant context exists.
   */
  readonly unscoped = this.client;

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
