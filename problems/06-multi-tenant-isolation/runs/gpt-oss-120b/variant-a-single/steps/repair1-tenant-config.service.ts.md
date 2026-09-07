# repair1-tenant-config.service.ts

## reasoning

```
We need to write tenant-config.service fixing imports. Likely need to import TenantConfigRepository and Prisma types. Since errors: cannot find module './tenant-config.repository' etc. So we create service that uses repository. Provide basic methods. Use @Injectable. Assume repository exists. Import from './tenant-config.repository'. Also import Tenant from @prisma/client (but error says no exported member Tenant). Probably model is TenantConfig? We'll assume TenantConfig. Use // ASSUMPTION. Provide class with getConfig method. Use repository. Return whatever.
```

## reply

```ts
// src/tenant-config/tenant-config.service.ts

import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantConfigRepository } from './tenant-config.repository';

// ASSUMPTION: The Prisma schema defines a model named `TenantConfig` (not `Tenant`)
// and the repository exposes a `findByTenantId` method returning that model.
// If the actual model name differs, adjust the import and method signatures accordingly.

@Injectable()
export class TenantConfigService {
  constructor(private readonly repo: TenantConfigRepository) {}

  /**
   * Retrieves the branding and feature‑flags configuration for the current tenant.
   * The repository is expected to return `null`/`undefined` when the tenant does not
   * exist, in which case a `NotFoundException` is thrown to conform to the
   * error‑envelope contract.
   *
   * @param tenantId - the resolved tenant identifier (from request‑scoped context)
   * @returns the tenant configuration object
   */
  async getConfig(tenantId: string) {
    const config = await this.repo.findByTenantId(tenantId);
    if (!config) {
      // The error envelope is handled by a global filter; we just throw the NestJS exception.
      throw new NotFoundException({
        error: {
          code: 'resource_not_found',
          message: `Tenant configuration not found for tenantId ${tenantId}`,
          details: {},
        },
      });
    }
    return config;
  }

  /**
   * Updates the tenant configuration.
   *
   * @param tenantId - the resolved tenant identifier
   * @param data - partial configuration fields to update
   * @returns the updated configuration
   */
  async updateConfig(tenantId: string, data: Partial<any>) {
    // ASSUMPTION: `TenantConfigRepository` provides an `updateByTenantId` method.
    const updated = await this.repo.updateByTenantId(tenantId, data);
    if (!updated) {
      throw new NotFoundException({
        error: {
          code: 'resource_not_found',
          message: `Cannot update configuration for unknown tenantId ${tenantId}`,
          details: {},
        },
      });
    }
    return updated;
  }
}
```
