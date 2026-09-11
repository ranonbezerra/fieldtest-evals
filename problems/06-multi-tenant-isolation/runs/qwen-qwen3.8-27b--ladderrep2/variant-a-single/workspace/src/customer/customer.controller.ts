import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CustomerCreateData, CustomerUpdateData } from './customer.repository.js';
import { CustomerService } from './customer.service.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Controller('customers')
export class CustomerController {
  constructor(private readonly customers: CustomerService) {}

  @Post()
  create(@Body() body: unknown) {
    return this.customers.register(validateCreate(body));
  }

  @Get()
  list() {
    return this.customers.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.customers.get(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.customers.update(id, validateUpdate(body));
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.customers.remove(id);
  }
}

function asRecord(body: unknown): Record<string, unknown> | null {
  return body !== null && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

function rejectIfInvalid(details: Record<string, string>): void {
  if (Object.keys(details).length > 0) {
    throw new HttpException(
      { error: { code: 'validation_failed', message: 'Request validation failed', details } },
      400,
    );
  }
}

function validateCreate(body: unknown): CustomerCreateData {
  const details: Record<string, string> = {};
  const record = asRecord(body);
  if (record === null) details.email = 'the request body must be a JSON object';
  const email = record?.email;
  if (typeof email !== 'string' || !EMAIL_PATTERN.test(email)) {
    details.email = details.email ?? 'must be a valid email address';
  }
  const name = record?.name;
  if (name !== undefined && typeof name !== 'string') details.name = 'must be a string';
  rejectIfInvalid(details);
  return { email: email as string, ...(typeof name === 'string' ? { name } : {}) };
}

function validateUpdate(body: unknown): CustomerUpdateData {
  const details: Record<string, string> = {};
  const record = asRecord(body);
  if (record === null) details.body = 'the request body must be a JSON object';
  const email = record?.email;
  const name = record?.name;
  if (email !== undefined && (typeof email !== 'string' || !EMAIL_PATTERN.test(email))) {
    details.email = 'must be a valid email address';
  }
  if (name !== undefined && typeof name !== 'string') details.name = 'must be a string';
  if (email === undefined && name === undefined) {
    details.body = details.body ?? 'at least one of "email" or "name" is required';
  }
  rejectIfInvalid(details);
  return {
    ...(email !== undefined ? { email: email as string } : {}),
    ...(typeof name === 'string' ? { name } : {}),
  };
}
