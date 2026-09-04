# 18-customer.module.ts

## reasoning

```
The user wants me to write `src/customer/customer.module.ts` based on the PLAN.md specification.

From the plan:
- `src/customer/customer.module.ts` — providers: `CustomerRepository`, `CustomerService`; controller: `CustomerController`; imports `PrismaModule`.

Looking at the references, I can see:
- `CustomerController` from `./customer.controller`
- `CustomerService` from `./customer.service`
- `CustomerRepository` from `./customer.repository`
- `PrismaModule` from `../db/prisma.module`

The module should:
- Import `PrismaModule`
- Declare `CustomerController`
- Provide `CustomerRepository`, `CustomerService`

Let me write this.
```

## reply

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../db/prisma.module';
import { CustomerController } from './customer.controller';
import { CustomerRepository } from './customer.repository';
import { CustomerService } from './customer.service';

@Module({
  imports: [PrismaModule],
  controllers: [CustomerController],
  providers: [CustomerRepository, CustomerService],
})
export class CustomerModule {}
```
