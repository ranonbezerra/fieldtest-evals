# repair1-customer.controller.ts

## reasoning

```
We need to fix controller compile errors. Likely missing imports. Provide typical NestJS controller using CustomerService. But we don't know its path. Probably src/customer/customer.service.ts exists. We just need to import correct modules and use Request scoped tenant context? The errors shown are about many other files, but task only to rewrite customer.controller.ts to fix its own compile errors. Likely it currently has wrong imports. We'll create a minimal controller that compiles given other missing pieces? We cannot guarantee other files exist, but we can import from relative paths that likely exist: './customer.service', './dto/create-customer.dto', './dto/update-customer.dto'. Also import appropriate NestJS decorators, Request from express. Ensure types. Use async methods returning Promise.

We'll not reference missing modules. Just implement basic controller.

Let's output file.
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
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { CustomerService } from './customer.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

// ASSUMPTION: The service methods used below exist and return the appropriate
// Prisma‑derived types. If the actual signatures differ, adjust the calls
// accordingly.

@Controller('customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Post()
  async create(@Body() createDto: CreateCustomerDto) {
    try {
      return await this.customerService.create(createDto);
    } catch (error: any) {
      // Prisma throws a unique‑constraint error when the same email is used
      // within the same tenant. We translate it to our API contract.
      if (error?.code === 'P2002') {
        throw new ConflictException('Customer with this email already exists');
      }
      throw error;
    }
  }

  @Get()
  async findAll() {
    return this.customerService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const customer = await this.customerService.findOne(id);
    if (!customer) {
      throw new NotFoundException(`Customer ${id} not found`);
    }
    return customer;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateCustomerDto,
  ) {
    try {
      return await this.customerService.update(id, updateDto);
    } catch (error: any) {
      if (error?.code === 'P2025') {
        // Record to update not found
        throw new NotFoundException(`Customer ${id} not found`);
      }
      if (error?.code === 'P2002') {
        // Unique‑constraint violation (e.g., email clash)
        throw new ConflictException('Customer with this email already exists');
      }
      throw error;
    }
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    try {
      return await this.customerService.remove(id);
    } catch (error: any) {
      if (error?.code === 'P2025') {
        throw new NotFoundException(`Customer ${id} not found`);
      }
      throw error;
    }
  }
}
```
