import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { CustomerService } from './customer.service.js';

interface CreateCustomerDto {
  email: string;
  name: string;
}

interface UpdateCustomerDto {
  email?: string;
  name?: string;
}

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

@Controller('customers')
export class CustomerController {
  constructor(private readonly customers: CustomerService) {}

  @Get()
  list() {
    return this.customers.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.customers.get(id);
  }

  @Post()
  create(@Body() body: unknown) {
    return this.customers.create(validateCreateCustomer(body));
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.customers.update(id, validateUpdateCustomer(body));
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    return this.customers.remove(id);
  }
}

function validateCreateCustomer(body: unknown): CreateCustomerDto {
  const errors: string[] = [];
  const record = asRecord(body, errors);
  const email = nonEmptyString(record?.email, 'email', errors);
  const name = nonEmptyString(record?.name, 'name', errors);
  if (email && !EMAIL_PATTERN.test(email)) {
    errors.push('"email" must be a valid email address');
  }
  if (errors.length > 0) {
    throw new AppError(400, 'validation_failed', 'The request body is invalid.', { errors });
  }
  return { email: email!, name: name! };
}

function validateUpdateCustomer(body: unknown): UpdateCustomerDto {
  const errors: string[] = [];
  const record = asRecord(body, errors);
  const dto: UpdateCustomerDto = {};
  if (record) {
    if ('email' in record) {
      const email = nonEmptyString(record.email, 'email', errors);
      if (email) {
        if (!EMAIL_PATTERN.test(email)) {
          errors.push('"email" must be a valid email address');
        }
        dto.email = email;
      }
    }
    if ('name' in record) {
      const name = nonEmptyString(record.name, 'name', errors);
      if (name) {
        dto.name = name;
      }
    }
  }
  if (Object.keys(dto).length === 0) {
    errors.push('provide at least one of "email" or "name"');
  }
  if (errors.length > 0) {
    throw new AppError(400, 'validation_failed', 'The request body is invalid.', { errors });
  }
  return dto;
}

function asRecord(body: unknown, errors: string[]): Record<string, unknown> | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    errors.push('the request body must be a JSON object');
    return undefined;
  }
  return body as Record<string, unknown>;
}

function nonEmptyString(value: unknown, field: string, errors: string[]): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`"${field}" must be a non-empty string`);
    return undefined;
  }
  return value.trim();
}
