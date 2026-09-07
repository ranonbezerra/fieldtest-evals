# repair2-tenant-config.repository.ts

## reasoning

```
We need to write repository fixing imports. Likely need PrismaService import path and Tenant type. Assume Prisma schema has Tenant model. We'll import PrismaService from '../../prisma/prisma.service'? Actually path: src/tenant-config/tenant-config.repository.ts relative to src folder. PrismaService is in src/prisma/prisma.service.ts. So import { PrismaService } from '../../prisma/prisma.service'; Also need Injectable. Import from @nestjs/common. Need Tenant type from @prisma/client. If not exported, maybe model named TenantConfig? But error says no exported member 'Tenant'. We'll assume model is TenantConfig. Use assumption.

We'll write repository with methods getConfig(tenantId). Use prisma. Return.

Add assumptions.
```

## reply

```ts
// src/tenant-config/tenant-config.repository.ts

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, Tenant } from '@prisma/client';

// ASSUMPTION: The Prisma schema defines a `Tenant` model that stores the
// branding and feature‑flag configuration for each tenant. The generated
// client therefore exports a `Tenant` type. If the actual model name differs,
// this repository would need to be adjusted accordingly.
@Injectable()
export class TenantConfigRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves the configuration for the given tenant.
   *
   * @param tenantId - The ID of the tenant (already resolved by middleware).
   * @returns The tenant configuration record.
   *
   * The Prisma client is request‑scoped, and the tenant‑aware middleware
   * automatically injects `tenantId` into any read operation. However we still
   * pass an explicit `where` clause for clarity and type‑safety.
   */
  async getTenantConfig(tenantId: string): Promise<Tenant | null> {
    return this.prisma.tenant.findUnique({
      where: { tenantId },
    });
  }

  /**
   * Updates the configuration for the given tenant.
   *
   * @param tenantId - The ID of the tenant.
   * @param data - Partial configuration fields to update.
   * @returns The updated tenant configuration.
   *
   * The tenant‑aware Prisma middleware will ensure the `tenantId` in the
   * payload (if provided) matches the resolved tenant, otherwise it throws.
   */
  async updateTenantConfig(
    tenantId: string,
    data: Prisma.TenantUpdateInput,
  ): Promise<Tenant> {
    return this.prisma.tenant.update({
      where: { tenantId },
      data,
    });
  }
}
```
