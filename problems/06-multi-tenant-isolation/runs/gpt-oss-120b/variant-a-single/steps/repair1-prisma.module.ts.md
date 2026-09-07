# repair1-prisma.module.ts

## reasoning

```
We need to create prisma.module.ts that imports PrismaService correctly and exports. Also need to resolve imports paths. Likely need to import Module from @nestjs/common and PrismaService from './prisma.service'. Also need to import TenantContext? Not here. Just provide module.

File should compile: need to export PrismaService provider. Also need to export PrismaService for other modules.

Write:

import { Module, Global } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TenantContext } from '../tenant/tenant.context';

@Module({
  providers: [PrismaService, TenantContext],
  exports: [PrismaService],
})
export class PrismaModule {}

But TenantContext is a provider likely defined elsewhere. Ensure import path correct: '../tenant/tenant.context'.

Also need to mark as Global maybe not required. But okay.

Return only file content.
```

## reply

```ts
// src/prisma/prisma.module.ts

import { Module, Global } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TenantContext } from '../tenant/tenant.context';

@Global()
@Module({
  providers: [PrismaService, TenantContext],
  exports: [PrismaService],
})
export class PrismaModule {}
```
