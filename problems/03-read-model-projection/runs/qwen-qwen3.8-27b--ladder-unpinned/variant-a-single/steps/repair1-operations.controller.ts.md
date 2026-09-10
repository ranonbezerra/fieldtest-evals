# repair1-operations.controller.ts

## reasoning

```
Let me analyze the compiler errors:

1. `src/drift-repair/drift-repair.service.ts(34,13): error TS2345` — This is in a different file, not the one I'm asked to fix.

2. `src/operations/operations.controller.ts(23,5): error TS2322: Type 'Promise<CompanyTotals>' is not assignable to type 'Promise<never>'.` — This is the error I need to fix.

The error says `Type 'Promise<CompanyTotals>' is not assignable to type 'Promise<never>'`. This means the controller method at line 23 has a return type that's being inferred or declared as `Promise<never>` somehow. This typically happens when the controller method's return type annotation is wrong, or when the method is in a context where TypeScript can't infer the return type properly.

Looking at the service, `getCompanyTotals` returns `Promise<CompanyTotals>`. The controller at line 23 must be calling this and the return type is being resolved to `Promise<never>`.

The most common cause of this is that the controller method has an explicit return type annotation that's wrong, or the method is in a class that extends something that constrains return types, or there's a type import issue.

Wait, let me think about this more carefully. `Type 'Promise<CompanyTotals>' is not assignable to type 'Promise<never>'` — the "to" type is `Promise<never>`. This suggests the controller method is declared with a return type of `Promise<never>` or the context expects `Promise<never>`.

Actually, this could happen if the controller method is annotated with a return type that doesn't match. Or if there's a decorator issue.

Let me think about what a typical NestJS controller for operations would look like based on the service:

```typescript
import { Controller, Get, Query, Param } from '@nestjs/common';
import { OperationsService, OperationsPage, CompanyTotals } from './operations.service';

@Controller('operations')
export class OperationsController {
  constructor(private readonly operationsService: OperationsService) {}

  @Get()
  async listOperations(
    @Query('companyId') companyId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<OperationsPage> {
    return this.operationsService.listOperations({
      companyId,
      status: status as any,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      page: parseInt(page ?? '1', 10),
      pageSize: parseInt(pageSize ?? '20', 10),
    });
  }

  @Get('companies/:companyId/totals')
  async getCompanyTotals(@Param('companyId') companyId: string): Promise<CompanyTotals> {
    return this.operationsService.getCompanyTotals(companyId);
  }
}
```

Wait, but the error is at line 23, column 5. Let me count lines. If the file starts with imports and the class declaration, line 23 would be around the second method.

The error `Type 'Promise<CompanyTotals>' is not assignable to type 'Promise<never>'` — this is strange. It means the target type is `Promise<never>`. How could that happen?

One possibility: the method doesn't have an explicit return type annotation, and TypeScript is inferring it from the return statement, but something is going wrong. Actually no, if TypeScript infers it, it would infer `Promise<CompanyTotals>` not `Promise<never>`.

Another possibility: The controller is using a generic type parameter that's being resolved to `never`. For example, if the controller extends a base class with generics.

Wait, actually the most likely scenario: The method has an explicit return type annotation that's wrong. Like `Promise<never>` or something that resolves to `Promise<never>`.

Or perhaps the issue is that `CompanyTotals` is imported from a wrong location and there's a type conflict.

Actually, re-reading the error: `Type 'Promise<CompanyTotals>' is not assignable to type 'Promise<never>'`. The "from" type is what the expression evaluates to, and the "to" type is what the context expects. So the context (the declared return type or the parameter of some function) expects `Promise<never>`.

The most likely cause: the method has an explicit return type of `Promise<never>` or the method is declared in a way that constrains it.

But wait — I don't have the current content of `operations.controller.ts`. I need to rewrite it from scratch. Let me write a correct controller that:
1. Has a `listOperations` endpoint
2. Has a `getCompanyTotals` endpoint
3. Uses proper types from the service

The key fix is making sure the return type of the `getCompanyTotals` method is `Promise<CompanyTotals>` (or just let it be inferred without a wrong annotation).

Let me write the complete controller:

```typescript
import { Controller, Get, Query, Param } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import {
  OperationsService,
  OperationsPage,
  CompanyTotals,
} from './operations.service';

@Controller('operations')
export class OperationsController {
  constructor(private readonly operationsService: OperationsService) {}

  @Get()
  async listOperations(
    @Query('company-id') companyId?: string,
    @Query('status') status?: OrderStatus,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('page-size') pageSize?: string,
  ): Promise<OperationsPage> {
    return this.operationsService.listOperations({
      companyId,
      status,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 20,
    });
  }

  @Get('companies/:company-id/totals')
  async getCompanyTotals(
    @Param('company-id') companyId: string,
  ): Promise<CompanyTotals> {
    return this.operationsService.getCompanyTotals(companyId);
  }
}
```

Wait, but the naming convention says "Endpoint: kebab-case, plural." So the controller should be `@Controller('operations')` and sub-paths should be kebab-case.

Looking at the service's `OperationsFilter` and `OperationsPageInput`, the filter has `companyId`, `status`, `from`, `to`. The input adds `page` and `pageSize`.

Now, the error was specifically at line 23, column 5, saying `Promise<CompanyTotals>` not assignable to `Promise<never>`. This means in the original file, the `getCompanyTotals` method (which would be around line 23) had a return type issue.

The fix is simple: make sure the return type is `Promise<CompanyTotals>` or just omit the return type annotation and let TypeScript infer it.

Let me also check: the service exports `CompanyTotals` interface. So I need to import it.

Let me write the final version. I'll keep it simple and correct.
```

## reply

```typescript
import { Controller, Get, Query, Param } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import {
  OperationsService,
  OperationsPage,
  CompanyTotals,
} from './operations.service';

@Controller('operations')
export class OperationsController {
  constructor(private readonly operationsService: OperationsService) {}

  @Get()
  async listOperations(
    @Query('company-id') companyId?: string,
    @Query('status') status?: OrderStatus,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('page-size') pageSize?: string,
  ): Promise<OperationsPage> {
    return this.operationsService.listOperations({
      companyId,
      status,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 20,
    });
  }

  @Get('companies/:company-id/totals')
  async getCompanyTotals(
    @Param('company-id') companyId: string,
  ): Promise<CompanyTotals> {
    return this.operationsService.getCompanyTotals(companyId);
  }
}
```
