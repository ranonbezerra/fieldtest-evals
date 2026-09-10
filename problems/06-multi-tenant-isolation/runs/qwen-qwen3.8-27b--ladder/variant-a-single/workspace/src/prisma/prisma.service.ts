import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * The plain, unscoped Prisma client. Only the tenant bootstrap lookups
 * (host/org -> tenant) may use it, because they run before any tenant is
 * in context. All tenant-owned data access goes through TenantPrismaService.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client: PrismaClient;

  constructor() {
    this.client = new PrismaClient({
      datasources: { db: { url: requireEnv('DATABASE_URL') } },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set in the environment.`);
  }
  return value;
}
