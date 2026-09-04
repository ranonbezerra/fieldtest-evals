import { Injectable } from '@nestjs/common';
import { TenantRepository } from './tenant.repository';
import { requireTenant } from './tenant-context';
import { AppException } from '../errors/app-exception';

export interface TenantConfigDto {
  slug: string;
  name: string;
  branding: Record<string, unknown>;
  featureFlags: Record<string, boolean>;
}

@Injectable()
export class TenantService {
  constructor(private readonly repo: TenantRepository) {}

  async getConfig(): Promise<TenantConfigDto> {
    const ctx = requireTenant();
    const tenant = await this.repo.findBySlug(ctx.slug);
    if (!tenant) {
      throw AppException.resourceNotFound(ctx.slug);
    }
    return {
      slug: tenant.slug,
      name: tenant.name,
      branding: tenant.branding as Record<string, unknown>,
      featureFlags: tenant.featureFlags as Record<string, boolean>,
    };
  }
}
