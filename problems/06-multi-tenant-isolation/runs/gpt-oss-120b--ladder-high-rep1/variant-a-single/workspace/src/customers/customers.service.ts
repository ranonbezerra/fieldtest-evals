import { Injectable, Scope, NotFoundException } from '@nestjs/common';
import { CustomersRepository } from './customers.repository.js';
import { Customer } from '@prisma/client';

@Injectable({ scope: Scope.REQUEST })
export class CustomersService {
  constructor(private readonly repo: CustomersRepository) {}

  async list(): Promise<Customer[]> {
    return this.repo.findAll();
  }

  async getById(id: number): Promise<Customer> {
    const customer = await this.repo.findById(id);
    if (!customer) {
      throw new NotFoundException({
        error: {
          code: 'resource_not_found',
          message: `Customer with id ${id} not found`,
          details: {},
        },
      });
    }
    return customer;
  }

  async create(email: string, name: string): Promise<Customer> {
    return this.repo.create({ email, name });
  }

  async update(id: number, data: { email?: string; name?: string }): Promise<Customer> {
    const existing = await this.repo.findById(id);
    if (!existing) {
      throw new NotFoundException({
        error: {
          code: 'resource_not_found',
          message: `Customer with id ${id} not found`,
          details: {},
        },
      });
    }
    return this.repo.update(id, data);
  }

  async delete(id: number): Promise<void> {
    const existing = await this.repo.findById(id);
    if (!existing) {
      throw new NotFoundException({
        error: {
          code: 'resource_not_found',
          message: `Customer with id ${id} not found`,
          details: {},
        },
      });
    }
    await this.repo.delete(id);
  }
}
