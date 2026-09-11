import { Injectable } from '@nestjs/common';
import type { Customer } from '@prisma/client';
import { CustomersRepository } from './customers.repository';
import { AppError } from '../errors/app-error';

export interface CustomerDto {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

function toDto(customer: Customer): CustomerDto {
  return {
    id: customer.id,
    email: customer.email,
    name: customer.name,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}

@Injectable()
export class CustomersService {
  constructor(private readonly customers: CustomersRepository) {}

  list(): Promise<CustomerDto[]> {
    return this.customers.list().then((rows) => rows.map(toDto));
  }

  async findById(id: string): Promise<CustomerDto> {
    const customer = await this.customers.findById(id);
    if (!customer) {
      // Deliberately indistinguishable from "no such id": a 404 that never
      // reveals whether the row exists in another tenant.
      throw new AppError('resource_not_found', 404, 'resource not found');
    }
    return toDto(customer);
  }

  register(email: string, name: string): Promise<CustomerDto> {
    return this.customers.create({ email, name }).then(toDto);
  }

  update(id: string, data: { name: string }): Promise<CustomerDto> {
    // Cross-tenant id -> Prisma P2025 -> 404 via the global filter, row untouched.
    return this.customers.update(id, data).then(toDto);
  }

  remove(id: string): Promise<void> {
    // Cross-tenant id -> Prisma P2025 -> 404 via the global filter, row untouched.
    return this.customers.remove(id).then(() => undefined);
  }
}
