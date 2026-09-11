import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { BadRequestError } from '../errors/exceptions.js';
import { CreateCustomerDto, UpdateCustomerDto } from './customer.dto.js';
import { CustomerService } from './customer.service.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]-[9ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertId(id: string | undefined): string {
  if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
    throw new BadRequestError('Customer id must be a UUID.');
  }
  return id;
}

@Controller('customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Post()
  create(@Body() dto: CreateCustomerDto) {
    return this.customerService.create(dto);
  }

  @Get()
  list() {
    return this.customerService.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.customerService.getById(assertId(id));
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    if (!dto || Object.keys(dto).length === 0) {
      throw new BadRequestError('Update body must contain at least one of: name, email, phone.');
    }
    return this.customerService.update(assertId(id), dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @Res() res: Response): Promise<void> {
    await this.customerService.remove(assertId(id));
    res.status(204).send();
  }
}
