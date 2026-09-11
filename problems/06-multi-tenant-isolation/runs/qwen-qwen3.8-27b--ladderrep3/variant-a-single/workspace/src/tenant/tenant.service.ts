import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextStorage } from '../prisma/tenant-context';
import { AppError } from '../errors/app-error';

@Injectable()
export class TenantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: TenantContextStorage,
  ) {}

  /** Branding and feature flags for the tenant resolved for this request. */
  async forCurrentRequest(): Promise<{
    id: string;
    name: string;
    branding: Prisma.JsonValue;
    featureFlags: Prisma.JsonValue;
  }> {
    const tenantId = this.context.tenantId; // throws when no tenant is in context
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw new AppError('internal_error', 500, 'the tenant resolved for this request no longer exists');
    }
    return { id: tenant.id, name: tenant.name, branding: tenant.branding, featureFlags: tenant.featureFlags };
  }
}
