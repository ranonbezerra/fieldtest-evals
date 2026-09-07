# repair2-prisma.module.ts

## reasoning

```
We need to write src/prisma/prisma.module.ts. Errors indicate missing module './prisma.service', '../tenant/tenant.context', and PrismaClient not exported. The reference prisma.service file exists and imports TenantContext. So prisma.module should import PrismaService and maybe provide it globally. Also need to import TenantContext? Not needed maybe.

We need to satisfy TypeScript compile.

Likely prisma.module should be a Nest module that provides PrismaService and exports it.

Also need to import Module from '@nestjs/common'.

Also need to import PrismaService from './prisma.service'.

Potentially need to import TenantContext elsewhere? Not used.

So file:

import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}

Also need to set global? Not required.

Ensure path correct relative.

File path src/prisma/prisma.module.ts.

Thus final content.

Potential missing tenant.context import not needed.

If any other requirements? The errors also had src/plan/plan.module.ts referencing '../prisma/prisma.module', after fixing this module, those errors may resolve.

Thus output.
```

## reply

```ts
// src/prisma/prisma.module.ts

import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// ASSUMPTION: PrismaService is correctly implemented (see src/prisma/prisma.service.ts)
// and handles tenant‑scoping internally. No other providers are required here.

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```
