# 12-customer.module.ts

## reasoning

```
Looking at the plan for `src/customer/customer.module.ts`:

```
src/customer/customer.module.ts | reads: src/customer/customer.controller.ts, src/customer/customer.service.ts, src/customer/customer.repository.ts, src/multi-tenant/multi-tenant.module.ts | CustomerModule
```

So the module needs:
- Imports: CustomerController, CustomerService, CustomerRepository, MultiTenantModule
- Controllers: [CustomerController]
- Providers: [CustomerService, CustomerRepository]

The service depends on the repository. The repository depends on TenantPrismaService (exported from MultiTenantModule).

Let me write the module following the conventions:
- TS file: `kebab-case.role.ts` → `customer.module.ts` ✓
- Class: `PascalCase` → `CustomerModule`
- Import from `MultiTenantModule` for the `TenantPrismaService` export
- The controller is declared by the module
- Services and repositories are listed in providers

The MultiTenantModule exports: `[PrismaService, TenantContextService, TenantPrismaService]`

So CustomerModule imports MultiTenantModule to get TenantPrismaService for the repository.

Let me write it:
```

## reply

```typescript
import { Module } from '@nestjs/common';
import { CustomerController } from './customer.controller.js';
import { CustomerService } from './customer.service.js';
import { CustomerRepository } from './customer.repository.js';
import { MultiTenantModule } from '../multi-tenant/multi-tenant.module.js';

@Module({
  imports: [MultiTenantModule],
  controllers: [CustomerController],
  providers: [CustomerService, CustomerRepository],
})
export class CustomerModule {}
```
