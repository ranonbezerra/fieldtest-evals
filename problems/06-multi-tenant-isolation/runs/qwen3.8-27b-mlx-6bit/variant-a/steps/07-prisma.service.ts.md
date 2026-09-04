# 07-prisma.service.ts

## reasoning

```
Let me analyze the plan to understand what `src/db/prisma.service.ts` should contain.

From the plan (§3 - Types and signatures):

```ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  readonly scoped: TenantAwarePrisma;
  constructor();                     // this.scoped = createTenantAwareClient(this)
  async onModuleInit(): Promise<void>;
  async onModuleDestroy(): Promise<void>;
}
```

So the file needs:
1. Import `Injectable` from `@nestjs/common`
2. Import `OnModuleInit`, `OnModuleDestroy` from `@nestjs/common`
3. Import `PrismaClient` from `@prisma/client`
4. Import `createTenantAwareClient` and `TenantAwarePrisma` from `./tenant-aware-prisma`
5. The class extends `PrismaClient`, implements `OnModuleInit` and `OnModuleDestroy`
6. Has a `readonly scoped: TenantAwarePrisma` property
7. Constructor calls `super()` and sets `this.scoped = createTenantAwareClient(this)`
8. `onModuleInit` calls `this.$connect()`
9. `onModuleDestroy` calls `this.$disconnect()`

Let me look at the reference file for `tenant-aware-prisma.ts` to confirm the exports:
- `createTenantAwareClient(base: PrismaClient): TenantAwarePrisma`
- `TenantAwarePrisma = ReturnType<typeof createTenantAwareClient>`

Now let me write the file. The plan says:
- `src/db/prisma.module.ts` — provides + exports `PrismaService`. (This is a different file, not what I'm writing.)

Let me write the complete file:

```ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createTenantAwareClient, type TenantAwarePrisma } from './tenant-aware-prisma';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  readonly scoped: TenantAwarePrisma;

  constructor() {
    super();
    this.scoped = createTenantAwareClient(this);
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

This matches the plan exactly. The constructor creates the scoped client from `this` (the PrismaClient instance). The lifecycle hooks connect/disconnect the base client. No extra features, no extra exports.

Let me double-check: the plan says "reads: src/db/tenant-aware-prisma.ts" in the manifest. Good, I'm importing from there.

The plan also says the module file `src/db/prisma.module.ts` provides + exports PrismaService, but that's a separate file.

I think this is clean and complete.
```

## reply

```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createTenantAwareClient, type TenantAwarePrisma } from './tenant-aware-prisma';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  readonly scoped: TenantAwarePrisma;

  constructor() {
    super();
    this.scoped = createTenantAwareClient(this);
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```
