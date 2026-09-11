import { Injectable } from '@nestjs/common';
import { AppException } from '../common/app-exception.js';
import { CustomersRepository } from './customers.repository.js';

export interface CreateCustomerInput {
  email: string;
  name?: string;
}

export interface UpdateCustomerInput {
  email?: string;
  name?: string;
}

@Injectable()
export class CustomersService {
  constructor(private readonly customersRepository: CustomersRepository) {}

  list() {
    return this.customersRepository.list();
  }

  async findById(id: string) {
    const customer = await this.customersRepository.findById(id);
    if (!customer) {
      throw new AppException(404, 'resource_not_found', 'Customer not found', {});
    }
    return customer;
  }

  async create(input: CreateCustomerInput) {
    return this.customersRepository.create(input);
  }

  async update(id: string, input: UpdateCustomerInput) {
    const customer = await this.customersRepository.update(id, input);
    if (!customer) {
      throw new AppException(404, 'resource_not_found', 'Customer not found', {});
    }
    return customer;
  }

  async remove(id: string) {
    const deleted = await this.customersRepository.remove(id);
    if (!deleted) {
      throw new AppException(404, 'resource_not_found', 'Customer not found', {});
    }
    return { deleted: true };
  }
}
