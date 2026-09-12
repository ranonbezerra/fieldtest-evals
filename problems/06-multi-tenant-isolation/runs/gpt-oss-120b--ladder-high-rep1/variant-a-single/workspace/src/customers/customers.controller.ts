import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  ParseIntPipe,
} from '@nestjs/common';
import { CustomersService } from './customers.service.js';
import { Customer } from '@prisma/client';

class CreateCustomerDto {
  email!: string;
  name!: string;
}

class UpdateCustomerDto {
  email?: string;
  name?: string;
}

@Controller('customers')
export class CustomersController {
  constructor(private readonly service: CustomersService) {}

  @Get()
  async list(): Promise<Customer[]> {
    return this.service.list();
  }

  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number): Promise<Customer> {
    return this.service.getById(id);
  }

  @Post()
  async create(@Body() dto: CreateCustomerDto): Promise<Customer> {
    return this.service.create(dto.email, dto.name);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCustomerDto,
  ): Promise<Customer> {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  async delete(@Param('id', ParseIntPipe) id: number): Promise<{ success: true }> {
    await this.service.delete(id);
    return { success: true };
  }
}
