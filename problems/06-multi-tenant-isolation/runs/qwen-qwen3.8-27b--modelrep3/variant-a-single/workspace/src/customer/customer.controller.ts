import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { CustomerService } from './customer.service.js';
import { CustomerInput, CustomerUpdateInput } from './customer.types.js';

@Controller('customers')
export class CustomerController {
  constructor(private readonly service: CustomerService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  create(@Body() body: { email?: unknown; name?: unknown }) {
    const email = requireString(body?.email, 'email').toLowerCase();
    validateEmail(email);
    const name = requireString(body?.name, 'name');

    const input: CustomerInput = { email, name };
    return this.service.create(input);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.getById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { email?: unknown; name?: unknown }) {
    const input: CustomerUpdateInput = {};

    if (body?.email !== undefined) {
      const email = requireString(body.email, 'email').toLowerCase();
      validateEmail(email);
      input.email = email;
    }

    if (body?.name !== undefined) {
      input.name = requireString(body.name, 'name');
    }

    if (Object.keys(input).length === 0) {
      throw new ApiError(400, 'validation_error', 'At least one updatable field must be provided.', {
        fields: ['email', 'name'],
      });
    }

    return this.service.update(id, input);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiError(400, 'validation_error', `${field} must be a non-empty string.`, {
      field,
    });
  }
  return value.trim();
}

function validateEmail(email: string): void {
  const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!pattern.test(email)) {
    throw new ApiError(400, 'validation_error', 'email must be a valid email address.', {
      email,
    });
  }
}
