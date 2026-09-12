import { Injectable } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service.js';
import { GlobalPrismaService } from './global-prisma.service.js';
import {
  BasePrismaClient,
  TenantAwarePrismaClient,
  createTenantAwareClient,
} from './tenant-prisma.middleware.js';

@Injectable()
export class TenantPrismaService {
  readonly client: TenantAwarePrismaClient;

  constructor(
    context: TenantContextService,
    base: GlobalPrismaService,
  ) {
    this.client = createTenantAwareClient(base as unknown as BasePrismaClient, context);
  }
}
