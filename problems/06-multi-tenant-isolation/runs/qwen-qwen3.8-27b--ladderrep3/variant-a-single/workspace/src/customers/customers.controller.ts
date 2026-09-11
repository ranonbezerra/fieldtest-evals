import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { AppError } from '../errors/app-error';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseRegisterBody(body: unknown): { email: string; name: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new AppError('bad_request', 400, 'body must be a JSON object with email and name');
  }
  const { email, name } = body as { email?: unknown; name?: unknown };
  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    throw new AppError('bad_request', 400, 'email must be a valid email address', { field: 'email' });
  }
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new AppError('bad_request', 400, 'name must be a non-empty string', { field: 'name' });
  }
  return { email: email.trim(), name: name.trim() };
}

function parseUpdateBody(body: unknown): { name: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new AppError('bad_request', 400, 'body must be a JSON object with name');
  }
  const { name } = body as { name?: unknown };
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new AppError('bad_request', 400, 'name must be a non-empty string', { field: 'name' });
  }
  return { name: name.trim() };
}

@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list() {
    return this.customers.list();
  }

  @Post()
  register(@Body() body: unknown) {
    const { email, name } = parseRegisterBody(body);
    return this.customers.register(email, name);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.customers.findById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    const data = parseUpdateBody(body);
    return this.customers.update(id, data);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.customers.remove(id);
  }
}
