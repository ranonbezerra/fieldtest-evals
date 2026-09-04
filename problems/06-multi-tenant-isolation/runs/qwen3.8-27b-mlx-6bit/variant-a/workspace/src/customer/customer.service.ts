import { Injectable } from '@nestjs/common';
import type { Customer } from '@prisma/client';
import { AppException } from '../errors/app-exception.js';
import { CustomerRepository, NewCustomerRow, UpdateCustomerRow } from './customer.repository.js';

export interface CreateCustomerDto {
  email: string;
  name?: string;
}

export interface UpdateCustomerDto {
  email?: string;
  name?: string | null;
}

export interface CustomerDto {
  id: string;
  email: string;
  name: string | null;
}

@Injectable()
export class CustomerService {
  constructor(private readonly repo: CustomerRepository) {}

  async list(): Promise<CustomerDto[]> {
    const customers = await this.repo.list();
    return customers.map((c: Customer) => ({ id: c.id, email: c.email, name: c.name }));
  }

  async create(input: CreateCustomerDto): Promise<CustomerDto> {
    const row: NewCustomerRow = { email: input.email, name: input.name ?? null };
    const customer = await this.repo.create(row);
    return { id: customer.id, email: customer.email, name: customer.name };
  }

  async getById(id: string): Promise<CustomerDto> {
    const customer = await this.repo.findById(id);
    if (!customer) throw AppException.resourceNotFound(id);
    return { id: customer.id, email: customer.email, name: customer.name };
  }

  async update(id: string, input: UpdateCustomerDto): Promise<CustomerDto> {
    const data: UpdateCustomerRow = {};
    if (input.email !== undefined) data.email = input.email;
    if (input.name !== undefined) data.name = input.name;
    const customer = await this.repo.update(id, data);
    if (!customer) throw AppException.resourceNotFound(id);
    return { id: customer.id, email: customer.email, name: customer.name };
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    const count = await this.repo.delete(id);
    if (count === 0) throw AppException.resourceNotFound(id);
    return { deleted: true };
  }
}
