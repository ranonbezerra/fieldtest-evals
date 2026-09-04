# 17-tenant.module.ts

## reasoning

```
Looking at the plan for `src/tenant/tenant.module.ts`:

- providers: `TenantRepository`, `TenantService`
- controller: `TenantController`
- imports `PrismaModule`

From the references, I can see:
- `TenantController` is in `./tenant.controller`
- `TenantService` is in `./tenant.service`
- `TenantRepository` is in `./tenant.repository`
- `PrismaModule` is in `../db/prisma.module` (from the plan: `src/db/prisma.module.ts`)

Let me write the module.
```

## reply

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../db/prisma.module';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';
import { TenantRepository } from './tenant.repository';

@Module({
  imports: [PrismaModule],
  controllers: [TenantController],
  providers: [TenantService, TenantRepository],
})
export class TenantModule {}
```
