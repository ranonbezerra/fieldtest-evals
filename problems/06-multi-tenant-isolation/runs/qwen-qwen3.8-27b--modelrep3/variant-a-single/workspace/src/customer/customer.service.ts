import { Injectable } from '@nestjs/common';
import type { Customer } from '@prisma/client';
import { ApiError } from '../common/api-error.js';
import { CustomerRepository } from './customer.repository.js';
import { CustomerInput, CustomerUpdateInput } from './customer.types.js';

@Injectable()
export class CustomerService {
  constructor(private readonly repository: CustomerRepository) {}

  list(): Promise<Customer[]> {
    return this.repository.findMany();
  }

  create(input: CustomerInput): Promise<Customer> {
    return this.repository.create(input);
  }

  async getById(id: string): Promise<Customer> {
    const customer = await this.repository.findById(id);
    if (!customer) {
      throw new ApiError(404, 'resource_not_found', 'Customer not found.', { id });
    }
    return customer;
  }

  async update(id: string, input: CustomerUpdateInput): Promise<Customer> {
    const customer = await this.repository.update(id, input);
    if (!customer) {
      throw new ApiError(404, 'resource_not_found', 'Customer not found.', { id });
    }
    return customer;
  }

  async remove(id: string): Promise<{ id: string }> {
    const deleted = await this.repository.delete(id);
    if (!deleted) {
      throw new ApiError(404, 'resource_not_found', 'Customer not found.', { id });
    }
    return deleted;
  }
}
