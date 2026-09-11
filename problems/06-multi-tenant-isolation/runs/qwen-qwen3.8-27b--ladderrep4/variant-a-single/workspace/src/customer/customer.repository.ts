import { Injectable } from '@nestjs/common';
import type { Customer } from '@prisma/client';
import { ResourceNotFoundError } from '../errors/exceptions.js';
import { TenantContext } from '../tenant/tenant-context.js';
import type { TenantAwarePrisma } from '../tenant/tenant-prisma.provider.js';

@Injectable()
export class CustomerRepository {
  private readonly tenantContext = new TenantContext();

  constructor(private readonly prisma: TenantAwarePrisma) {}

  // NOTE: no tenantId passed manually in queries. The tenant-aware Prisma
  // client scopes reads and stamps writes from request-scoped context.

  list(): Promise<Customer[]> {
    const tenantId = this.tenantContext.current();
    return this.prisma.runWithTenant(tenantId, (scoped) => scoped.customer.findMany());
  }

  async getById(id: string): Promise<Customer> {
    const tenantId = this.tenantContext.current();
    return this.prisma.runWithTenant(tenantId, async (scoped) => {
      const customer = await scoped.customer.findFirst({ where: { id } });
      if (!customer) {
        throw new ResourceNotFoundError(`Customer "${id}" was not found.`);
      }
      return customer;
    });
  }

  create(data: { email: string; name?: string; phone?: string }): Promise<Customer> {
    const tenantId = this.tenantContext.current();
    return this.prisma.runWithTenant(tenantId, (scoped) => scoped.customer.create({ data: data as any }));
  }

  async update(id: string, data: { email?: string; name?: string; phone?: string }): Promise<Customer> {
    const tenantId = this.tenantContext.current();
    return this.prisma.runWithTenant(tenantId, async (scoped) => {
      const existing = await scoped.customer.findFirst({ where: { id } });
      if (!existing) {
        throw new ResourceNotFoundError(`Customer "${id}" was not found.`);
      }
      return scoped.customer.update({ where: { id }, data });
    });
  }

  async remove(id: string): Promise<void> {
    const tenantId = this.tenantContext.current();
    await this.prisma.runWithTenant(tenantId, async (scoped) => {
      const existing = await scoped.customer.findFirst({ where: { id } });
      if (!existing) {
        throw new ResourceNotFoundError(`Customer "${id}" was not found.`);
      }
      await scoped.customer.delete({ where: { id } });
    });
  }
}
