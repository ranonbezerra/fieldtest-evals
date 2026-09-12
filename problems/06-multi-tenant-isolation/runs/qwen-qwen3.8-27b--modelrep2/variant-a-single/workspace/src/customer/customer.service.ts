import { Injectable } from '@nestjs/common';
import { AppError } from '../common/app-error.js';
import { CustomerRepository } from './customer.repository.js';

export interface CreateCustomerInput {
  email: string;
  name: string;
}

export interface UpdateCustomerInput {
  email?: string;
  name?: string;
}

@Injectable()
export class CustomerService {
  constructor(private readonly customers: CustomerRepository) {}

  list() {
    return this.customers.list();
  }

  async get(id: string) {
    const customer = await this.customers.findById(id);
    if (!customer) {
      throw new AppError(404, 'resource_not_found', `Customer ${id} was not found for this tenant.`, {
        id,
      });
    }
    return customer;
  }

  async create(input: CreateCustomerInput) {
    // A duplicate email inside the tenant surfaces as Prisma P2002 -> 409
    // via the global filter (atomic, race-safe).
    return this.customers.create(input);
  }

  async update(id: string, input: UpdateCustomerInput) {
    // A row missing in this tenant (including rows owned by other tenants)
    // surfaces as Prisma P2025 -> 404 via the global filter.
    return this.customers.update(id, input);
  }

  async remove(id: string): Promise<void> {
    await this.customers.remove(id);
  }
}
