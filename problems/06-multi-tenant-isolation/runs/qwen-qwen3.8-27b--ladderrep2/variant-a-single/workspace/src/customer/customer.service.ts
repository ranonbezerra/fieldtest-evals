import { Customer } from '@prisma/client';
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CustomerCreateData,
  CustomerRepository,
  CustomerUpdateData,
} from './customer.repository.js';

export interface CustomerDto {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class CustomerService {
  constructor(private readonly customers: CustomerRepository) {}

  async list(): Promise<CustomerDto[]> {
    const rows = await this.customers.findAll();
    return rows.map((row) => this.toDto(row));
  }

  async get(id: string): Promise<CustomerDto> {
    const row = await this.customers.findById(id);
    // A missing id and another tenant's id are the same answer: not found.
    // 403 would leak that the row exists.
    if (!row) throw new NotFoundException('Customer not found');
    return this.toDto(row);
  }

  async register(input: CustomerCreateData): Promise<CustomerDto> {
    const row = await this.customers.create(input);
    return this.toDto(row);
  }

  async update(id: string, patch: CustomerUpdateData): Promise<CustomerDto> {
    const existing = await this.customers.findById(id);
    if (!existing) throw new NotFoundException('Customer not found');
    const row = await this.customers.update(id, patch);
    return this.toDto(row);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.customers.findById(id);
    if (!existing) throw new NotFoundException('Customer not found');
    await this.customers.remove(id);
  }

  private toDto(row: Customer): CustomerDto {
    // tenantId is an internal fact of isolation, not part of the API surface.
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
