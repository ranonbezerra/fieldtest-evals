# repair1-customer.repository.ts

## reasoning

```
need to write repository fixing imports. Likely need PrismaService and TenantContext. Provide class with methods. Use PrismaClient types. Assume Customer model exists. We'll import PrismaService from '../prisma/prisma.service' and TenantContext. Also import Injectable, Scope? repository likely injectable request scope. Write basic CRUD.

Implement getById, findAll, create, update, delete.

Use PrismaService injection.

Add assumptions comments where unknown.
```

## reply

```typescript
// src/customer/customer.repository.ts

import { Injectable, Scope } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';

// ASSUMPTION: The Prisma schema defines a `Customer` model with at least the
// following fields: `id: string`, `email: string`, `name: string`, `tenantId: string`.
// The generated Prisma client therefore has a type `Customer` under
// `@prisma/client`. If the real model differs, adjust the typings accordingly.

@Injectable({ scope: Scope.REQUEST })
export class CustomerRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Get a single customer by its primary key (id). */
  async getById(id: string) {
    // The tenant filter is applied automatically by Prisma middleware,
    // so we only need to query by id.
    return this.prisma.customer.findUnique({
      where: { id },
    });
  }

  /** List all customers belonging to the current tenant. */
  async findAll() {
    // No explicit where clause needed; middleware injects tenantId.
    return this.prisma.customer.findMany();
  }

  /** Create a new customer. */
  async create(data: { email: string; name: string }) {
    // The middleware will stamp `tenantId` automatically.
    return this.prisma.customer.create({
      data,
    });
  }

  /** Update an existing customer. */
  async update(
    id: string,
    data: { email?: string; name?: string },
  ) {
    // Middleware enforces tenant scoping and adds tenantId to the payload.
    return this.prisma.customer.update({
      where: { id },
      data,
    });
  }

  /** Delete a customer. */
  async delete(id: string) {
    // Tenant scoping is handled by middleware.
    return this.prisma.customer.delete({
      where: { id },
    });
  }

  /** Helper to retrieve the current tenant id (if needed elsewhere). */
  private getTenantId(): string | undefined {
    return TenantContext.getTenantId();
  }
}
```
