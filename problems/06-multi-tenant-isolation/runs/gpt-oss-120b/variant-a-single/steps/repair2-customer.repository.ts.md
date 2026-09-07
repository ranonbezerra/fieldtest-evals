# repair2-customer.repository.ts

## reasoning

```
We need to write repository fixing imports. Likely need PrismaService path and Customer type. Use assumptions. Provide repository with methods using injected PrismaService. Use request-scoped? Not needed. Provide class with typical CRUD. Include assumptions about missing modules.
```

## reply

```ts
// src/customer/customer.repository.ts

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service'; // ASSUMPTION: prisma module is located at src/prisma and exports PrismaService
import { Prisma, Customer } from '@prisma/client'; // ASSUMPTION: the Prisma schema defines a `Customer` model with a `tenantId` field

@Injectable()
export class CustomerRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- CREATE ----------
  async create(data: Prisma.CustomerCreateInput): Promise<Customer> {
    // The tenantId will be injected by the Prisma middleware, so we just pass the data through.
    return this.prisma.customer.create({ data });
  }

  // ---------- READ ----------
  async findMany(params?: {
    skip?: number;
    take?: number;
    cursor?: Prisma.CustomerWhereUniqueInput;
    where?: Prisma.CustomerWhereInput;
    orderBy?: Prisma.CustomerOrderByWithRelationInput;
  }): Promise<Customer[]> {
    // No explicit tenantId needed – middleware scopes the query.
    return this.prisma.customer.findMany(params);
  }

  async findById(id: string): Promise<Customer | null> {
    // The middleware adds tenant scoping, so we only filter by the primary key.
    return this.prisma.customer.findUnique({
      where: { id },
    });
  }

  // ---------- UPDATE ----------
  async update(
    id: string,
    data: Prisma.CustomerUpdateInput,
  ): Promise<Customer> {
    // Tenant scoping is handled by the middleware.
    return this.prisma.customer.update({
      where: { id },
      data,
    });
  }

  // ---------- DELETE ----------
  async delete(id: string): Promise<Customer> {
    // Tenant scoping is handled by the middleware.
    return this.prisma.customer.delete({
      where: { id },
    });
  }
}
```
