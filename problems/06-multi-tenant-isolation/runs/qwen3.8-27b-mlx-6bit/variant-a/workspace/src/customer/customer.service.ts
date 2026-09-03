import { Injectable } from '@nestjs/common';
import { CustomerRepository } from './customer.repository.js';
import { CreateCustomerInput, UpdateCustomerInput, Customer } from './dto.js';
import { ResourceNotFoundError, ConflictError } from '../multi-tenant/errors.js';

@Injectable()
export class CustomerService {
  constructor(private readonly repo: CustomerRepository) {}

  async list(): Promise<Customer[]> {
    return this.repo.list();
  }

  async findById(id: string): Promise<Customer> {
    const customer = await this.repo.findById(id);
    if (!customer) {
      throw new ResourceNotFoundError('Customer');
    }
    return customer;
  }

  async create(input: CreateCustomerInput): Promise<Customer> {
    try {
      return await this.repo.create(input);
    } catch (err) {
      if (this.isUniqueConstraintError(err)) {
        throw new ConflictError();
      }
      throw err;
    }
  }

  async update(id: string, input: UpdateCustomerInput): Promise<Customer> {
    return this.repo.update(id, input);
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete(id);
  }

  private isUniqueConstraintError(err: unknown): boolean {
    return err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2002';
  }
}
