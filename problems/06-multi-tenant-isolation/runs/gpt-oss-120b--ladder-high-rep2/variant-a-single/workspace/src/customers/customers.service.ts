import { Injectable } from '@nestjs/common';
import { CustomersRepository } from './customers.repository.js';
import { CreateCustomerDto } from './dto/create-customer.dto.js';
import { UpdateCustomerDto } from './dto/update-customer.dto.js';
import { Customer } from '@prisma/client';

@Injectable()
export class CustomersService {
  constructor(private readonly repo: CustomersRepository) {}

  async create(dto: CreateCustomerDto): Promise<Customer> {
    return this.repo.create(dto);
  }

  async findAll(): Promise<Customer[]> {
    return this.repo.findAll();
  }

  async findOne(id: string): Promise<Customer | null> {
    return this.repo.findById(id);
  }

  async update(id: string, dto: UpdateCustomerDto): Promise<Customer | null> {
    try {
      return await this.repo.update(id, dto);
    } catch (err) {
      return null;
    }
  }

  async remove(id: string): Promise<Customer | null> {
    try {
      return await this.repo.delete(id);
    } catch (err) {
      return null;
    }
  }
}
