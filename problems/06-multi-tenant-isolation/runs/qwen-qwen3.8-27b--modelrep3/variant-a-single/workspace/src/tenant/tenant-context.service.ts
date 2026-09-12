import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ApiError } from '../common/api-error.js';
import { ResolvedTenant } from './tenant.types.js';

@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<ResolvedTenant>();

  run<T>(tenant: ResolvedTenant, fn: () => T | Promise<T>): T | Promise<T> {
    return this.storage.run(tenant, fn);
  }

  getTenant(): ResolvedTenant {
    const tenant = this.storage.getStore();
    if (!tenant) {
      throw new ApiError(500, 'internal_error', 'Tenant context is missing.', {});
    }
    return tenant;
  }

  getTenantId(): string {
    return this.getTenant().id;
  }
}
