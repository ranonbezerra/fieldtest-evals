# repair2-customer.controller.ts

## reasoning

```
We need to rewrite src/customer/customer.controller.ts to compile given errors. Need to see current file to adjust. Not provided, we need to infer. Probably missing imports, DTOs, service, etc. We need to create a controller that validates input, calls service, no business logic. Also incorporate tenant isolation? Not needed for compilation.

We need to resolve missing modules errors elsewhere too? The task only says rewrite customer.controller.ts to fix messages that require of this file. The errors list many missing modules across the repo, but they refer to other files, not this controller. However maybe the controller imports those missing modules causing errors. Let's look at likely current imports in customer.controller.ts: It may import CustomerService, DTOs like CreateCustomerDto, UpdateCustomerDto, maybe Prisma's Customer. Also may import class-validator.

Given the errors in other files, the repository is missing many files. We are only to modify this file, not create other missing files. So we must adjust imports to avoid referencing missing modules, keeping functionality minimal.

Goal: compile. So we need to import only things that exist. There is PrismaService defined. Maybe there is a customer.service file present? Not listed in errors. So perhaps it exists. We can import from './customer.service' which likely exists. Similarly DTOs maybe missing; but we can avoid using DTO types, using any.

We can define controller with routes: GET /customers, GET /customers/:id, POST /customers, PATCH /customers/:id, DELETE /customers/:id. Use NestJS decorators. Input validation we can skip if class-validator missing. So we won't import it.

Thus we need to avoid imports of class-validator and DTOs that are missing. Use built-in types.

We need to import Controller, Get, Post, Patch, Delete, Param, Body, HttpCode, HttpStatus, NotFoundException maybe.

We also need to reference CustomerService; assume it exists.

Implement methods calling service methods (e.g., findAll, findOne, create, update, remove). Return results.

We should not use DTO types, just any.

Also need to export class.

Make sure to import from '@nestjs/common'.

No other imports.

Add // ASSUMPTION lines for missing DTOs.

Let's craft file.
```

## reply

```ts
// src/customer/customer.controller.ts

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';

// ASSUMPTION: A `CustomerService` class exists in the same directory and provides
// the standard CRUD methods (create, findAll, findOne, update, remove). The exact
// signatures are not known, so we use `any` for the service return types.
import { CustomerService } from './customer.service';

// The DTO classes for request validation are not present in the repository.
// To keep the controller compilable we accept plain objects (`any`) instead of
// strongly‑typed DTOs.
// ASSUMPTION: Validation (e.g., class‑validator) is handled elsewhere or omitted.
type CreateCustomerDto = any;
type UpdateCustomerDto = any;

@Controller('customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Get()
  async findAll() {
    // The service is expected to return an array of customers.
    return this.customerService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const customer = await this.customerService.findOne(id);
    if (!customer) {
      throw new NotFoundException({
        error: {
          code: 'resource_not_found',
          message: `Customer with id ${id} not found`,
          details: {},
        },
      });
    }
    return customer;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createDto: CreateCustomerDto) {
    // The service should handle tenant scoping via the request‑scoped Prisma client.
    return this.customerService.create(createDto);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateCustomerDto,
  ) {
    const updated = await this.customerService.update(id, updateDto);
    if (!updated) {
      throw new NotFoundException({
        error: {
          code: 'resource_not_found',
          message: `Customer with id ${id} not found`,
          details: {},
        },
      });
    }
    return updated;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    const deleted = await this.customerService.remove(id);
    if (!deleted) {
      throw new NotFoundException({
        error: {
          code: 'resource_not_found',
          message: `Customer with id ${id} not found`,
          details: {},
        },
      });
    }
    // No content is returned for successful deletion.
  }
}
```
