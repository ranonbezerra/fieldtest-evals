# repair1-plan.repository.ts

## reasoning

```
We need to write repository file importing PrismaService etc. Likely missing imports. Provide basic class with methods using PrismaService. Use correct paths. Assume Prisma client has model Plan. Provide import { Injectable } from '@nestjs/common'; import { PrismaService } from '../../prisma/prisma.service'; import { Plan } from '@prisma/client'; etc. Also need to export class PlanRepository. Provide methods: create, findMany, findOne, update, delete. Use tenant-aware client so no tenantId param. Implement.

Add assumptions comment for missing modules.
```

## reply

```typescript
// src/plan/plan.repository.ts

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Plan } from '@prisma/client';

// ASSUMPTION: The Prisma schema defines a `Plan` model with at least the
// fields `id: string` (primary key) and `tenantId: string`. The tenant‑aware
// Prisma client (see prisma.service.ts) will automatically inject the
// correct `tenantId` for every query, so the repository does not need to
// handle it manually.

@Injectable()
export class PlanRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Create a new plan */
  async create(data: Omit<Plan, 'id' | 'tenantId'>): Promise<Plan> {
    return this.prisma.plan.create({ data });
  }

  /** Find many plans (optionally filtered) */
  async findMany(filter?: Partial<Plan>): Promise<Plan[]> {
    return this.prisma.plan.findMany({ where: filter });
  }

  /** Find a single plan by its unique identifier */
  async findById(id: string): Promise<Plan | null> {
    return this.prisma.plan.findUnique({ where: { id } });
  }

  /** Update a plan */
  async update(
    id: string,
    data: Partial<Omit<Plan, 'id' | 'tenantId'>>,
  ): Promise<Plan> {
    return this.prisma.plan.update({
      where: { id },
      data,
    });
  }

  /** Delete a plan */
  async delete(id: string): Promise<Plan> {
    return this.prisma.plan.delete({ where: { id } });
  }
}
```
