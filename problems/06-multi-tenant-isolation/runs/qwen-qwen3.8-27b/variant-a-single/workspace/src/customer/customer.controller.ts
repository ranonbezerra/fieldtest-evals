import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { AppException } from '../common/exceptions/app.exception.js';
import { CustomerService } from './customer.service.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

@Controller('customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Post()
  create(@Body() body: unknown) {
    const record = asRecord(body);
    const name = asString(record.name);
    const email = asString(record.email);

    if (!name || name.trim() === '') {
      throw new AppException(400, 'invalid_input', 'name must be a non-empty string.');
    }

    if (!email || email.trim() === '' || !EMAIL_PATTERN.test(email.trim())) {
      throw new AppException(400, 'invalid_input', 'email must be a valid email address.');
    }

    return this.customerService.create({ name, email });
  }

  @Get()
  list() {
    return this.customerService.list();
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    if (!id) {
      throw new AppException(400, 'invalid_input', 'id is required.');
    }

    return this.customerService.getById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    if (!id) {
      throw new AppException(400, 'invalid_input', 'id is required.');
    }

    const record = asRecord(body);
    const input: { name?: string; email?: string } = {};

    if (record.name !== undefined) {
      const name = asString(record.name);
      if (!name || name.trim() === '') {
        throw new AppException(400, 'invalid_input', 'name must be a non-empty string.');
      }
      input.name = name;
    }

    if (record.email !== undefined) {
      const email = asString(record.email);
      if (!email || email.trim() === '' || !EMAIL_PATTERN.test(email.trim())) {
        throw new AppException(400, 'invalid_input', 'email must be a valid email address.');
      }
      input.email = email;
    }

    if (Object.keys(input).length === 0) {
      throw new AppException(400, 'invalid_input', 'At least one updatable field is required.');
    }

    return this.customerService.update(id, input);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    if (!id) {
      throw new AppException(400, 'invalid_input', 'id is required.');
    }

    await this.customerService.delete(id);
  }
}
