# 04-prisma.service.ts

## reasoning

```
The task is to write exactly one file: `src/multi-tenant/prisma.service.ts`.

From the PLAN.md, the specification for this file is:

```ts
export declare class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor();
  onModuleInit(): Promise<void>;
  onModuleDestroy(): Promise<void>;
}
```

Standard NestJS Prisma lifecycle wrapper (singleton). No tenant logic.

So I need to:
- Import `PrismaClient` from `@prisma/client`
- Import `OnModuleInit`, `OnModuleDestroy` from `@nestjs/common`
- Create a class `PrismaService` extending `PrismaClient` and implementing both lifecycle interfaces
- `onModuleInit()` calls `this.$connect()`
- `onModuleDestroy()` calls `this.$disconnect()`

This is the standard NestJS + Prisma pattern. No tenant logic, no extra features. Let me write it cleanly.
```

## reply

```ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```
