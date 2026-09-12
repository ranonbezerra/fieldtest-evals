import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantRepository } from './tenant.repository.js';
import { Tenant } from '@prisma/client';

@Injectable()
export class TenantService {
  constructor(private readonly tenantRepo: TenantRepository) {}

  async findByDomain(domain: string): Promise<Tenant | null> {
    return this.tenantRepo.findByDomain(domain);
  }

  async findByOrg(org: string): Promise<Tenant | null> {
    return this.tenantRepo.findByOrg(org);
  }
}
