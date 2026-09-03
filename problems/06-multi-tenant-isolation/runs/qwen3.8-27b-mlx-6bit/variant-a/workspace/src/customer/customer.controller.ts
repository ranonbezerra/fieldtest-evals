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
