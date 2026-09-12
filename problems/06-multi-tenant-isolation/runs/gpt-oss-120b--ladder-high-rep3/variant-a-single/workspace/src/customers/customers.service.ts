import { Injectable, NotFoundException } from '@nestjs/common';
import { CustomersRepository } from './customers.repository.js';
import { Prisma, Customer } from '@prisma/client';
import { CreateCustomerDto } from './dto/create-customer.dto.js';
import { UpdateCustomerDto } from './dto/update-customer.dto.js';

@Injectable()
export class CustomersService {
  constructor(private readonly repo: CustomersRepository) {}

  async getAll(): Promise<Customer[]> {
    return this.repo.findAll();
  }

  async getOne(id: number): Promise<Customer> {
    const customer = await this.repo.findById(id);
    if (!customer) {
      throw new NotFoundException({
        error: {
          code: 'resource_not_found',
          message: 'Customer not found',
          details: {}
        }
      });
    }
    return customer;
  }

  async create(dto: CreateCustomerDto): Promise<Customer> {
    // tenantId will be injected by Prisma middleware
    return this.repo.create(dto as Prisma.CustomerCreateInput);
  }

  async update(id: number, dto: UpdateCustomerDto): Promise<Customer> {
    try {
      return await this.repo.update(id, dto as Prisma.CustomerUpdateInput);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new NotFoundException({
          error: {
            code: 'resource_not_found',
            message: 'Customer not found',
            details: {}
          }
        });
      }
      throw err;
    }
  }

  async remove(id: number): Promise<Customer> {
    try {
      return await this.repo.delete(id);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new NotFoundException({
          error: {
            code: 'resource_not_found',
            message: 'Customer not found',
            details: {}
          }
        });
      }
      throw err;
    }
  }
}
