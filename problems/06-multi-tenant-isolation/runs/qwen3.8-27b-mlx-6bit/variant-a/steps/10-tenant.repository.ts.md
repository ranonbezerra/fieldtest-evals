# 10-tenant.repository.ts

## reasoning

```
Looking at the plan, `src/tenant/tenant.repository.ts` should have:

```ts
export class TenantRepository {
  constructor(prisma: PrismaService);
  findBySlug(slug: string): Promise<Tenant | undefined>;
}
```

It reads from `src/db/prisma.service.ts`. The `Tenant` type comes from `@prisma/client`. The repository uses the base Prisma client (not the scoped one) since Tenant is exempt from the tenant guard.

Let me write this file. The repository should:
- Be decorated with `@Injectable()`
- Import `PrismaService` from `../db/prisma.service`
- Import `Tenant` from `@prisma/client`
- Have a constructor that takes `PrismaService`
- Have a `findBySlug` method that does `this.prisma.tenant.findUnique({ where: { slug } })`

Since Tenant is exempt from the guard, we use `this.prisma.tenant` directly (the base client), not `this.prisma.scoped.tenant`. Actually, looking at the plan more carefully: "the `Tenant` registry model is exempt (never stamped/scoped) so middleware can look it up before a tenant context exists." So using `this.prisma.tenant` directly is correct, or we could use `this.prisma.scoped.tenant` which would just pass through. But the plan says "One Prisma client, guard no-ops on Tenant." So either works. But since the repository is a registry lookup that happens before tenant context exists, using the base client directly (`this.prisma.tenant`) is most defensible and clear.

Let me write it:
```

## reply

```ts
import { Injectable } from '@nestjs/common';
import { Tenant } from '@prisma/client';
import { PrismaService } from '../db/prisma.service';

@Injectable()
export class TenantRepository {
  constructor(private readonly prisma: PrismaService) {}

  findBySlug(slug: string): Promise<Tenant | undefined> {
    return this.prisma.tenant.findUnique({ where: { slug } });
  }
}
```
