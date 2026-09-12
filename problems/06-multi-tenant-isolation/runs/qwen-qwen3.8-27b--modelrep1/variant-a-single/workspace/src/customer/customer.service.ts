import { Injectable } from '@nestjs/common';
import type { Customer } from '@prisma/client';
import { AppError } from '../common/app-error.js';
import { fromPrismaError } from '../common/prisma-errors.js';
import { CreateCustomerDto, UpdateCustomerDto } from './customer.dto.js';
import { CustomerRepository } from './customer.repository.js';

function notFound(id: string): AppError {
  return new AppError(404, 'resource_not_found', `Customer ${id} was not found for the current tenant`);
}

@Injectable()
export class CustomerService {
  constructor(private readonly customers: CustomerRepository) {}

  register(dto: CreateCustomerDto): Promise<Customer> {
    return this.customers.create({ email: dto.email, name: dto.name }).catch((error: unknown) => {
      throw fromPrismaError(error);
    });
  }

  list(): Promise<Customer[]> {
    return this.customers.list();
  }

  async get(id: string): Promise<Customer> {
    const customer = await this.customers.findById(id);
    if (!customer) {
      throw notFound(id);
    }
    return customer;
  }

  async update(id: string, dto: UpdateCustomerDto): Promise<Customer> {
    const data: { email?: string; name?: string } = {};
    if (dto.email !== undefined) {
      data.email = dto.email;
    }
    if (dto.name !== undefined) {
      data.name = dto.name;
    }

    if (Object.keys(data).length > 0) {
      const result = await this.customers.update(id, data).catch((error: unknown) => {
        throw fromPrismaError(error);
      });
      if (result.count === 0) {
        throw notFound(id);
      }
    }
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    const result = await this.customers.delete(id);
    if (result.count === 0) {
      throw notFound(id);
    }
  }
}
