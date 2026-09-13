import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { tenantMiddleware } from './tenant-middleware.js';

const SKIP_TENANT_MODELS = ['Tenant'];

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
  }

  async onModuleInit() {
    this.$use(tenantMiddleware(SKIP_TENANT_MODELS));
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
