# repair1-prisma.service.ts

## reasoning

```
Let me analyze the compiler errors to understand what `src/common/prisma.service.ts` needs to provide:

1. `src/profiles/profile.repository.ts(37,39): error TS2339: Property 'profile' does not exist on type 'PrismaService'.`
2. `
```

## reply

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```
