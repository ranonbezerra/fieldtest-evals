import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createTenantScopedClient } from './tenant-scoped-prisma.client.js';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly baseClient: PrismaClient;
  readonly client: PrismaClient;

  constructor() {
    this.baseClient = new PrismaClient();
    this.client = createTenantScopedClient(this.baseClient);
  }

  async onModuleInit(): Promise<void> {
    await this.baseClient.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.baseClient.$disconnect();
  }
}
