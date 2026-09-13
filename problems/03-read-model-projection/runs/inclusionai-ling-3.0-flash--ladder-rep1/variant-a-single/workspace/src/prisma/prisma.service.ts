import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({ log: (process.env.PRISMA_LOG?.split(',') as ('query' | 'info' | 'warn' | 'error')[]) || [] });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
