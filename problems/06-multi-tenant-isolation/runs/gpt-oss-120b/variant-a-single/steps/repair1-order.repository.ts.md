# repair1-order.repository.ts

## reasoning

```
We need to write order.repository fixing imports. Likely need PrismaService, Order model. Assume Prisma client provides Order type. Use dependency injection. Provide methods: findMany, findOne, create, update, delete. Use tenant context already applied globally so no tenantId param.

Implement class OrderRepository with PrismaService injected. Export. Use @Injectable.

Write file.
```

## reply

```ts
// src/order/order.repository.ts

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Order } from '@prisma/client';

// ASSUMPTION: The Prisma schema defines a model `Order` with at least the
// fields `id: string` and `tenantId: string`. No other fields are required for
// this repository implementation.

@Injectable()
export class OrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- READ ----------
  async findAll(): Promise<Order[]> {
    // The tenant‑scoping middleware in PrismaService automatically adds
    // `tenantId` to the query, so we simply delegate to Prisma.
    return this.prisma.order.findMany();
  }

  async findById(id: string): Promise<Order | null> {
    return this.prisma.order.findUnique({
      where: { id },
    });
  }

  // ---------- CREATE ----------
  async create(data: Omit<Order, 'id' | 'tenantId'>): Promise<Order> {
    // `tenantId` will be injected by the Prisma middleware.
    return this.prisma.order.create({
      data: data as any, // Prisma middleware will add tenantId
    });
  }

  // ---------- UPDATE ----------
  async update(id: string, data: Partial<Omit<Order, 'id' | 'tenantId'>>): Promise<Order> {
    return this.prisma.order.update({
      where: { id },
      data: data as any, // tenantId is enforced by middleware
    });
  }

  // ---------- DELETE ----------
  async delete(id: string): Promise<Order> {
    return this.prisma.order.delete({
      where: { id },
    });
  }
}
```
