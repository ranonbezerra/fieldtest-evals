# 13-customer.controller.ts

## reasoning

```
Let me analyze what's needed for `src/customer/customer.controller.ts` based on the plan.

From the plan (§3):

```ts
export class CustomerController {
  constructor(service: CustomerService);
  @Get('customers') list(): Promise<CustomerDto[]>;
  @Post('customers') create(@Body() body: CreateCustomerDto): Promise<CustomerDto>;
  @Get('customers/:id') get(@Param('id') id: string): Promise<CustomerDto>;
  @Patch('customers/:id') update(@Param('id') id: string, @Body() body: UpdateCustomerDto): Promise<CustomerDto>;
  @Delete('customers/:id') remove(@Param('id') id: string): Promise<{ deleted: boolean }>;
}
```

From the reference `customer.service.ts`, I can see:
- `CustomerService` has methods: `list()`, `create(input)`, `getById(id)`, `update(id, input)`, `remove(id)`
- DTOs: `CreateCustomerDto`, `UpdateCustomerDto`, `CustomerDto`

The controller:
- Validates input and calls the service (zero business logic)
- Uses `@Controller()` decorator with route prefix or individual decorators
- The plan shows `@Get('customers')`, `@Post('customers')`, etc. — so the route paths include 'customers' directly in each decorator, or there's a `@Controller('customers')` prefix. Let me look more carefully.

The plan says:
```
@Get('customers') list(): Promise<CustomerDto[]>;
@Post('customers') create(@Body() body: CreateCustomerDto): Promise<CustomerDto>;
@Get('customers/:id') get(@Param('id') id: string): Promise<CustomerDto>;
@Patch('customers/:id') update(@Param('id') id: string, @Body() body: UpdateCustomerDto): Promise<CustomerDto>;
@Delete('customers/:id') remove(@Param('id') id: string): Promise<{ deleted: boolean }>;
```

So the routes are `customers`, `customers/:id` directly in the decorators. This could mean either:
1. `@Controller()` with `@Get('customers')` etc., or
2. `@Controller('customers')` with `@Get()`, `@Post()`, `@Get(':id')`, etc.

Looking at the plan more carefully, it explicitly writes `@Get('customers')`, `@Post('customers')`, `@Get('customers/:id')`, etc. This suggests the controller doesn't have a path prefix and each decorator includes the full path. But actually, in NestJS it's more idiomatic to use `@Controller('customers')` and then `@Get()`, `@Post()`, `@Get(':id')`. However, the plan explicitly writes them with the full path in each decorator.

Wait, let me re-read: The plan says "Endpoint: `kebab-case`, plural." from the conventions. The routes are `customers` which is already kebab-case (single word) and plural.

I'll follow the plan exactly as written: each decorator has the full path including 'customers'. So no `@Controller('customers')` prefix, just `@Controller()` or I could use `@Controller('customers')` and shorten the decorators. But the plan literally writes `@Get('customers')` so I'll go with that to be safe.

Actually, thinking about it more - in NestJS you can do either:
- `@Controller()` + `@Get('customers')` 
- `@Controller('customers')` + `@Get()`

The plan writes the decorators with the full path. I'll follow that exactly. But actually, it's more common and cleaner to use `@Controller('customers')`. Let me look at the plan again...

The plan §3 says:
```
src/customer/customer.controller.ts
export class CustomerController {
  constructor(service: CustomerService);
  @Get('customers') list(): Promise<CustomerDto[]>;
  ...
}
```

I'll use `@Controller('customers')` and then `@Get()`, `@Post()`, `@Get(':id')`, `@Patch(':id')`, `@Delete(':id')`. This produces the same routes. Actually wait - the plan literally writes `@Get('customers')` which means the decorator argument is 'customers'. If I use `@Controller('customers')` then I'd write `@Get()` not `@Get('customers')`. 

To be most faithful to the plan, I should use `@Controller()` (or just `@Controller('customers')` - both produce the same URL). Let me just go with `@Controller('customers')` and use `@Get()`, `@Post()`, `@Get(':id')`, etc. since that's the standard NestJS pattern and produces identical routes. The plan is specifying behavior (the routes), not the exact decorator syntax.

Hmm, but the instructions say "Implement exactly what the plan specifies for this file." The plan shows `@Get('customers')` explicitly. I think the safest interpretation is to use `@Controller('customers')` with short decorators since that's equivalent and more idiomatic. But to be extra safe and literal, let me use the exact form shown: no controller-level prefix, full paths in each decorator.

Actually you know what, I'll use `@Controller('customers')` since that's the standard NestJS idiom and produces exactly the same routes. The plan is a specification of behavior, not a literal code template.

Now for the method names - the plan uses `get` as a method name. In NestJS controllers, method names don't matter for routing (the decorators do), so `get` is fine as a method name.

Let me also consider: the controller should have "zero business logic" per conventions. It just validates input (or rather, delegates validation) and calls the service.

Let me write the file:

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import {
  CreateCustomerDto,
  CustomerDto,
  CustomerService,
  UpdateCustomerDto,
} from './customer.service';

@Controller('customers')
export class CustomerController {
  constructor(private readonly service: CustomerService) {}

  @Get()
  async list(): Promise<CustomerDto[]> {
    return this.service.list();
  }

  @Post()
  async create(@Body() body: CreateCustomerDto): Promise<CustomerDto> {
    return this.service.create(body);
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<CustomerDto> {
    return this.service.getById(id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: UpdateCustomerDto): Promise<CustomerDto> {
    return this.service.update(id, body);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ deleted: boolean }> {
    return this.service.remove(id);
  }
}
```

This looks clean and complete. The controller:
- Has zero business logic
- Validates input by accepting typed DTOs (NestJS validation pipe would handle actual validation, but the plan doesn't mention a ValidationPipe)
- Calls the service for all operations
- Follows the naming conventions (kebab-case file, PascalCase class)

Let me double-check against the plan's signature:
- `@Get('customers') list()` → `@Get()` with `@Controller('customers')` ✓
- `@Post('customers') create(@Body() body: CreateCustomerDto)` → `@Post()` with `@Body()` ✓
- `@Get('customers/:id') get(@Param('id') id: string)` → `@Get(':id')` with `@Param('id')` ✓
- `@Patch('customers/:id') update(@Param('id') id: string, @Body() body: UpdateCustomerDto)` → `@Patch(':id')` ✓
- `@Delete('customers/:id') remove(@Param('id') id: string)` → `@Delete(':id')` ✓

All good. Let me finalize.
```

## reply

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import {
  CreateCustomerDto,
  CustomerDto,
  CustomerService,
  UpdateCustomerDto,
} from './customer.service';

@Controller('customers')
export class CustomerController {
  constructor(private readonly service: CustomerService) {}

  @Get()
  async list(): Promise<CustomerDto[]> {
    return this.service.list();
  }

  @Post()
  async create(@Body() body: CreateCustomerDto): Promise<CustomerDto> {
    return this.service.create(body);
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<CustomerDto> {
    return this.service.getById(id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateCustomerDto,
  ): Promise<CustomerDto> {
    return this.service.update(id, body);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ deleted: boolean }> {
    return this.service.remove(id);
  }
}
```
