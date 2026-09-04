# repair1-customer.module.ts

## reasoning

```
Let me analyze the compiler errors to determine what `src/customer/customer.module.ts` needs.

Looking at the error messages, I don't see any errors directly from `src/customer/customer.module.ts`. Let me re-read the task:

"Rewrite `src/customer/customer.module.ts` complete, fixing what these messages require of this file."

The errors shown are from other files. The task says "these are the compiler's exact messages for the whole workspace." So the errors in `customer.module.ts` might not be listed because... wait, let me look again.

Actually, looking at the errors, I see errors in:
- `src/tenant/tenant-resolution.middleware.ts`
- `src/tenant/tenant.controller.ts`
- `src/tenant/tenant.module.ts`
- `src/tenant/tenant.repository.ts`
- `src/tenant/tenant.service.ts`
- `test/customer-isolation.spec.ts`
- `test/tenant-config.spec.ts`

There are NO errors listed for `src/customer/customer.module.ts` directly. But the task says to rewrite it fixing what "these messages require of this file."

Wait - the task says "These are the compiler's exact messages for the whole workspace — not a summary of them." So if there are no errors for `customer.module.ts`, maybe the file has issues that aren't showing as errors in this list? Or maybe the task is asking me to write it correctly based on the patterns I can see from other files' errors.

Looking at the patterns:
1. Relative imports need explicit `.js` extensions (e.g., `./tenant-context.js` not `./tenant-context`)
2. Module resolution is `node16` or `nodenext`

So for `src/customer/customer.module.ts`, I need to:
- Use `.js` extensions on relative imports
- Import from `../db/prisma.module.js` (not `../db/prisma.module`)
- Import from `./customer.controller.js` (not `./customer.controller`)
- Import from `./customer.service.js` (not `./customer.service`)
- Import from `./customer.repository.js` (not `./customer.repository`)

Based on the PLAN.md, `src/customer/customer.module.ts` should:
- providers: `CustomerRepository`, `CustomerService`
- controller: `CustomerController`
- imports `PrismaModule`

Let me also look at the pattern from `tenant.module.ts` errors:
```
src/tenant/tenant.module.ts(2,30): error TS2307: Cannot find module '../db/prisma.module'
src/tenant/tenant.module.ts(3,34): error TS2307: Cannot find module './tenant.controller'
src/tenant/tenant.module.ts(4,31): error TS2307: Cannot find module './tenant.service'
src/tenant/tenant.module.ts(5,34): error TS2307: Cannot find module './tenant.repository'
```

So `tenant.module.ts` has the same pattern - missing `.js` extensions. The fix is to add `.js` to all relative imports.

Now let me write `src/customer/customer.module.ts` with proper `.js` extensions:

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../db/prisma.module.js';
import { CustomerController } from './customer.controller.js';
import { CustomerService } from './customer.service.js';
import { CustomerRepository } from './customer.repository.js';

@Module({
  imports: [PrismaModule],
  controllers: [CustomerController],
  providers: [CustomerRepository, CustomerService],
})
export class CustomerModule {}
```

This follows the plan exactly:
- providers: `CustomerRepository`, `CustomerService`
- controller: `CustomerController`
- imports: `PrismaModule`

And it uses `.js` extensions on all relative imports to satisfy the `node16`/`nodenext` module resolution.
```

## reply

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../db/prisma.module.js';
import { CustomerController } from './customer.controller.js';
import { CustomerService } from './customer.service.js';
import { CustomerRepository } from './customer.repository.js';

@Module({
  imports: [PrismaModule],
  controllers: [CustomerController],
  providers: [CustomerRepository, CustomerService],
})
export class CustomerModule {}
```
