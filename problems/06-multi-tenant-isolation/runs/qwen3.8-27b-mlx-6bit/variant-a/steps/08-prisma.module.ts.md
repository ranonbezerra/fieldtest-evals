# 08-prisma.module.ts

## reasoning

```
The task is to write `src/db/prisma.module.ts` which provides and exports `PrismaService`. Based on the plan:

- `src/db/prisma.module.ts` — provides + exports `PrismaService`.

This is straightforward: a NestJS module that provides and exports `PrismaService`.
```

## reply

```typescript
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```
