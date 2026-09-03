# 11-customer.controller.ts

## reasoning

```
Let me analyze what's needed for `src/customer/customer.controller.ts` based on the plan and references.

From the plan:
- `src/customer/customer.controller.ts` — reads: `src/customer/customer.service.ts`, `src/customer/dto.ts`
- CustomerController (CRUD endpoints)
- Endpoints follow `kebab-case` plural convention: `/customers`
- Controller validates input and calls the service. Zero business logic.

From the plan's control flow:
- Controller: validate request body params; delegate to service.

The CRUD endpoints for customers would be:
- `GET /customers` — list
- `POST /customers` — create
- `GET /customers/:id` — fetch by id
- `PATCH /customers/:id` — update
- `DELETE /customers/:id` — delete

Looking at the service (read-only reference):
- `list(): Promise<Customer[]>`
- `findById(id: string): Promise<Customer>`
- `create(input: CreateCustomerInput): Promise<Customer>`
- `update(id: string, input: UpdateCustomerInput): Promise<Customer>`
- `delete(id: string): Promise<void>`

DTOs (read-only reference):
- `CreateCustomerInput { email: string; name: string; }`
- `UpdateCustomerInput { email?: string; name?: string; }`
- `Customer { id: string; email: string; name: string; createdAt: Date; updatedAt: Date; }`

The controller should:
- Use `@Controller('customers')` for the kebab-case plural path
- Import from `customer.service.js` and `dto.js` (ESM with `.js` extension based on the references)
- Use decorators: `@Get()`, `@Post()`, `@Get(':id')`, `@Patch(':id')`, `@Delete(':id')`
- Use `@Body()` and `@Param('id')` for input
- Delegate directly to service

Let me write the complete file.
```

## reply

```ts
import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { CustomerService } from './customer.service.js';
import { CreateCustomerInput, UpdateCustomerInput, Customer } from './dto.js';

@Controller('customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Get()
  async list(): Promise<Customer[]> {
    return this.customerService.list();
  }

  @Post()
  async create(@Body() input: CreateCustomerInput): Promise<Customer> {
    return this.customerService.create(input);
  }

  @Get(':id')
  async findById(@Param('id') id: string): Promise<Customer> {
    return this.customerService.findById(id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() input: UpdateCustomerInput): Promise<Customer> {
    return this.customerService.update(id, input);
  }

  @Delete(':id')
  async delete(@Param('id') id: string): Promise<void> {
    await this.customerService.delete(id);
  }
}
```
