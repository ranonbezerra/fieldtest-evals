import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import type { Customer } from '@prisma/client';
import { ValidationError } from '../common/api-error.js';
import { bodyOf, requireEmail, requireString } from '../common/validators.js';
import { CustomerService } from './customer.service.js';
import type { CustomerUpdateInput } from './customer.service.js';

@Controller('customers')
export class CustomerController {
  constructor(private readonly customers: CustomerService) {}

  @Get()
  list(): Promise<Customer[]> {
    return this.customers.list();
  }

  @Get(':id')
  getById(@Param('id') id: string): Promise<Customer> {
    return this.customers.get(id);
  }

  @Post()
  create(@Body() rawBody: unknown): Promise<Customer> {
    const body = bodyOf(rawBody);
    const email = requireEmail(body, 'email');
    const name = requireString(body, 'name', { max: 200 });
    return this.customers.create({ email, name });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() rawBody: unknown): Promise<Customer> {
    const body = bodyOf(rawBody);
    const input: CustomerUpdateInput = {};
    if ('name' in body) {
      input.name = requireString(body, 'name', { max: 200 });
    }
    if ('email' in body) {
      input.email = requireEmail(body, 'email');
    }
    if (input.name === undefined && input.email === undefined) {
      throw new ValidationError('Provide at least one of "name" or "email" to update a customer');
    }
    return this.customers.update(id, input);
  }

  @Delete(':id')
  remove(@Param('id') id: string): Promise<void> {
    return this.customers.remove(id);
  }
}
