import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CustomerDto, CreateCustomerDto, UpdateCustomerDto, CustomerService } from './customer.service.js';

@Controller()
export class CustomerController {
  constructor(private readonly service: CustomerService) {}

  @Get('customers')
  list(): Promise<CustomerDto[]> {
    return this.service.list();
  }

  @Post('customers')
  create(@Body() body: CreateCustomerDto): Promise<CustomerDto> {
    return this.service.create(body);
  }

  @Get('customers/:id')
  get(@Param('id') id: string): Promise<CustomerDto> {
    return this.service.getById(id);
  }

  @Patch('customers/:id')
  update(@Param('id') id: string, @Body() body: UpdateCustomerDto): Promise<CustomerDto> {
    return this.service.update(id, body);
  }

  @Delete('customers/:id')
  remove(@Param('id') id: string): Promise<{ deleted: boolean }> {
    return this.service.remove(id);
  }
}
