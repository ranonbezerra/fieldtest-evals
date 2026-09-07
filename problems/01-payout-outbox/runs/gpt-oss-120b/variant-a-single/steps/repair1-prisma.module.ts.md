# repair1-prisma.module.ts

## reasoning

```
need to write prisma.module.ts that imports PrismaService etc. Likely missing files: src/prisma/prisma.service.ts not present, but we assume exists. Just create module that provides PrismaService and exports it. Also need to import Module from @nestjs/common. So:

```ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

Add assumption comment about PrismaService existence.
```

## reply

```ts
// src/prisma/prisma.module.ts
// ---------------------------------------------------------------
// NestJS module that registers the PrismaService and makes it
// available to the rest of the application.
// ---------------------------------------------------------------

import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// ASSUMPTION: A `PrismaService` class exists in the same folder
// and correctly provides a `PrismaClient` instance.

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```
