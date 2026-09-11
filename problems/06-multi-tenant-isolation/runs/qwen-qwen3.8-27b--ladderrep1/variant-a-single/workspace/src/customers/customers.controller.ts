import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { AppException } from '../common/app-exception.js';
import { CustomersService, type CreateCustomerInput, type UpdateCustomerInput } from './customers.service.js';

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function readString(value: unknown, field: string, required: boolean): string | undefined {
  if (value === undefined) {
    if (required) {
      throw new AppException(400, 'invalid_payload', `${field} is required`, { field });
    }
    return undefined;
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AppException(400, 'invalid_payload', `${field} must be a non-empty string`, { field });
  }

  return value;
}

@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  list() {
    return this.customersService.list();
  }

  @Post()
  create(@Body() body: unknown) {
    const payload = body as Record<string, unknown> | null;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new AppException(400, 'invalid_payload', 'Request body must be an object', {});
    }

    const email = readString(payload.email, 'email', true);
    if (email === undefined) {
      throw new AppException(400, 'invalid_payload', 'email is required', { field: 'email' });
    }
    if (!EMAIL_PATTERN.test(email)) {
      throw new AppException(400, 'invalid_payload', 'email is not valid', { email });
    }

    const name = readString(payload.name, 'name', false);
    const input: CreateCustomerInput = { email };
    if (name !== undefined) {
      input.name = name;
    }

    return this.customersService.create(input);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    if (!id) {
      throw new AppException(400, 'invalid_payload', 'id is required', {});
    }
    return this.customersService.findById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    const payload = body as Record<string, unknown> | null;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new AppException(400, 'invalid_payload', 'Request body must be an object', {});
    }

    const email = readString(payload.email, 'email', false);
    if (email !== undefined && !EMAIL_PATTERN.test(email)) {
      throw new AppException(400, 'invalid_payload', 'email is not valid', { email });
    }

    const name = readString(payload.name, 'name', false);
    if (email === undefined && name === undefined) {
      throw new AppException(400, 'invalid_payload', 'At least one of email or name is required', {});
    }

    const input: UpdateCustomerInput = {};
    if (email !== undefined) {
      input.email = email;
    }
    if (name !== undefined) {
      input.name = name;
    }

    return this.customersService.update(id, input);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    if (!id) {
      throw new AppException(400, 'invalid_payload', 'id is required', {});
    }
    return this.customersService.remove(id);
  }
}
