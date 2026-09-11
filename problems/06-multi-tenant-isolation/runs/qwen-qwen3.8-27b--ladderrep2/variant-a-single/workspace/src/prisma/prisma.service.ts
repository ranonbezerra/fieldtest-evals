import { PrismaClient } from '@prisma/client';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { tenantScope } from '../tenant/tenant-scope.util.js';

/**
 * The application's only Prisma entry point. Repositories always go through
 * this tenant-scoped client, so no query can escape tenant isolation.
 *
 * The extension only rewrites args behind an unchanged public API, so the
 * scoped client is typed as the base client. Raw SQL accessors and
 * $transaction are deliberately not exposed: a transaction callback would
 * hand out an unscoped client, which is exactly the hole this class exists
 * to close.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  private readonly base: PrismaClient;
  private readonly scoped: PrismaClient;

  constructor() {
    this.base = new PrismaClient();
    this.scoped = (this.base.$extends(tenantScope as any) as unknown) as PrismaClient;
  }

  get tenant() {
    return this.scoped.tenant;
  }

  get customer() {
    return this.scoped.customer;
  }

  get plan() {
    return this.scoped.plan;
  }

  get order() {
    return this.scoped.order;
  }

  async onModuleDestroy(): Promise<void> {
    await this.base.$disconnect();
  }
}
