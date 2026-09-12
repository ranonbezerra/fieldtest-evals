import { Injectable } from '@nestjs/common';
import { CustomerRepository } from './customer.repository.js';
import { CreateCustomerDto } from './dto/create-customer.dto.js';
import { UpdateCustomerDto } from './dto/update-customer.dto.js';

@Injectable()
export class CustomerService {
  constructor(private readonly repo: CustomerRepository) {}

  async findAll() {
    return this.repo.findAll();
  }

  async findOne(id: string) {
    return this.repo.findById(id);
  }

  async create(dto: CreateCustomerDto) {
    return this.repo.create(dto);
  }

  async update(id: string, dto: UpdateCustomerDto) {
    return this.repo.update(id, dto);
  }

  async delete(id: string) {
    return this.repo.delete(id);
  }
}
