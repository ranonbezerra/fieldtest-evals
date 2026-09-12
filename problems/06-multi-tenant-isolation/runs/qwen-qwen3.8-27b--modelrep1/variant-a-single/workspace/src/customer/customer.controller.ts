import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import type { Customer } from '@prisma/client';
import { CreateCustomerDto, UpdateCustomerDto } from './customer.dto.js';
import { CustomerService } from './customer.service.js';

@Controller('customers')
export class CustomerController {
  constructor(private readonly customers: CustomerService) {}

  @Post()
  create(@Body() dto: CreateCustomerDto): Promise<Customer> {
    return this.customers.register(dto);
  }

  @Get()
  list(): Promise<Customer[]> {
    return this.customers.list();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<Customer> {
    return this.customers.get(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCustomerDto): Promise<Customer> {
    return this.customers.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.customers.remove(id);
  }
}
