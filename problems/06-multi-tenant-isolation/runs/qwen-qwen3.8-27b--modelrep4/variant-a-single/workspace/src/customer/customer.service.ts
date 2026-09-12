import { Injectable } from '@nestjs/common';
import type { Customer } from '@prisma/client';
import { NotFoundError } from '../common/api-error.js';
import { CustomerRepository } from './customer.repository.js';

export interface CustomerCreateInput {
  email: string;
  name: string;
}

export interface CustomerUpdateInput {
  name?: string;
  email?: string;
}

@Injectable()
export class CustomerService {
  constructor(private readonly customers: CustomerRepository) {}

  list(): Promise<Customer[]> {
    return this.customers.list();
  }

  async get(id: string): Promise<Customer> {
    const customer = await this.customers.findById(id);
    if (!customer) {
      throw new NotFoundError(`Customer with id "${id}" was not found in this tenant`);
    }
    return customer;
  }

  create(input: CustomerCreateInput): Promise<Customer> {
    return this.customers.create(input);
  }

  update(id: string, input: CustomerUpdateInput): Promise<Customer> {
    return this.customers.update(id, input);
  }

  remove(id: string): Promise<void> {
    return this.customers.remove(id);
  }
}
