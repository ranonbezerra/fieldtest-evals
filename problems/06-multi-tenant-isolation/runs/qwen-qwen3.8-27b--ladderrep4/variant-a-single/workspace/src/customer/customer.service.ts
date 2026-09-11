import { Injectable } from '@nestjs/common';
import type { CreateCustomerDto, UpdateCustomerDto } from './customer.dto.js';
import { CustomerRepository } from './customer.repository.js';

@Injectable()
export class CustomerService {
  constructor(private readonly repo: CustomerRepository) {}

  create(dto: CreateCustomerDto) {
    return this.repo.create(dto);
  }

  list() {
    return this.repo.list();
  }

  getById(id: string) {
    return this.repo.getById(id);
  }

  update(id: string, dto: UpdateCustomerDto) {
    return this.repo.update(id, dto);
  }

  async remove(id: string): Promise<void> {
    await this.repo.remove(id);
  }
}
