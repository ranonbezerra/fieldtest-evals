import { Injectable, NotFoundException } from '@nestjs/common';
import { CustomerRepository } from './customer.repository';

export interface CustomerInput {
  email: string;
  name?: string | null;
}

@Injectable()
export class CustomerService {
  constructor(private readonly customerRepository: CustomerRepository) {}

  async create(input: CustomerInput) {
    return this.customerRepository.create({
      email: input.email,
      name: input.name ?? null,
    });
  }

  async findAll() {
    return this.customerRepository.findMany();
  }

  async findById(id: string) {
    const customer = await this.customerRepository.findById(id);
    if (!customer) {
      throw new NotFoundException();
    }
    return customer;
  }

  async update(id: string, input: CustomerInput) {
    const existing = await this.customerRepository.findById(id);
    if (!existing) {
      throw new NotFoundException();
    }
    return this.customerRepository.update(id, {
      email: input.email,
      name: input.name ?? null,
    });
  }

  async remove(id: string) {
    const existing = await this.customerRepository.findById(id);
    if (!existing) {
      throw new NotFoundException();
    }
    await this.customerRepository.delete(id);
  }
}
