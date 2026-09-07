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
