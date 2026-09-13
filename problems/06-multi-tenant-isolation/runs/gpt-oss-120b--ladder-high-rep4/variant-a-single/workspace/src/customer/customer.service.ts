import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { CustomerRepository } from './customer.repository.js';
import { CreateCustomerDto } from './dto/create-customer.dto.js';
import { UpdateCustomerDto } from './dto/update-customer.dto.js';
import { Customer } from '@prisma/client';

@Injectable()
export class CustomerService {
  constructor(private readonly repository: CustomerRepository) {}

  async getAll(): Promise<Customer[]> {
    return this.repository.findAll();
  }

  async getById(id: number): Promise<Customer> {
    const customer = await this.repository.findById(id);
    if (!customer) {
      throw new HttpException(
        {
          error: {
            code: 'resource_not_found',
            message: `Customer with id ${id} not found`,
            details: {},
          },
        },
        HttpStatus.NOT_FOUND,
      );
    }
    return customer;
  }

  async create(dto: CreateCustomerDto): Promise<Customer> {
    return this.repository.create(dto);
  }

  async update(id: number, dto: UpdateCustomerDto): Promise<Customer> {
    try {
      return await this.repository.update(id, dto);
    } catch (error: any) {
      if (error?.code === 'P2025') {
        throw new HttpException(
          {
            error: {
              code: 'resource_not_found',
              message: `Customer with id ${id} not found`,
              details: {},
            },
          },
          HttpStatus.NOT_FOUND,
        );
      }
      throw error;
    }
  }

  async delete(id: number): Promise<void> {
    try {
      await this.repository.delete(id);
    } catch (error: any) {
      if (error?.code === 'P2025') {
        throw new HttpException(
          {
            error: {
              code: 'resource_not_found',
              message: `Customer with id ${id} not found`,
              details: {},
            },
          },
          HttpStatus.NOT_FOUND,
        );
      }
      throw error;
    }
  }
}
