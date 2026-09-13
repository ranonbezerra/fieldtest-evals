import { Injectable, NotFoundException } from '@nestjs/common';
import { CustomersRepository } from './customers.repository.js';
import { CreateCustomerDto, UpdateCustomerDto } from './customers.dto.js';

@Injectable()
export class CustomersService {
  constructor(private readonly repository: CustomersRepository) {}

  async findAll() {
    return this.repository.findAll();
  }

  async findById(id: string) {
    const customer = await this.repository.findById(id);
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    return customer;
  }

  async create(data: CreateCustomerDto) {
    return this.repository.create(data);
  }

  async update(id: string, data: UpdateCustomerDto) {
    try {
      return await this.repository.update(id, data);
    } catch {
      throw new NotFoundException('Customer not found');
    }
  }

  async delete(id: string) {
    try {
      return await this.repository.delete(id);
    } catch {
      throw new NotFoundException('Customer not found');
    }
  }
}
