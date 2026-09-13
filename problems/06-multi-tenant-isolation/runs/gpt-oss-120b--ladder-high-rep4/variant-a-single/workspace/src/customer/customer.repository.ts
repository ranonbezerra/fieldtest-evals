import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCustomerDto } from './dto/create-customer.dto.js';
import { UpdateCustomerDto } from './dto/update-customer.dto.js';
import { Customer } from '@prisma/client';

@Injectable()
export class CustomerRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<Customer[]> {
    return this.prisma.customer.findMany();
  }

  async findById(id: number): Promise<Customer | null> {
    return this.prisma.customer.findUnique({
      where: { id },
    });
  }

  // The tenantId is injected automatically by the Prisma middleware,
  // so we accept a loosely‑typed DTO here.
  async create(data: CreateCustomerDto): Promise<Customer> {
    // Cast to any to satisfy Prisma's strict input type; the middleware will
    // add the required tenantId field.
    return this.prisma.customer.create({
      data: data as any,
    });
  }

  async update(id: number, data: UpdateCustomerDto): Promise<Customer> {
    // Cast to any for the same reason as in create().
    return this.prisma.customer.update({
      where: { id },
      data: data as any,
    });
  }

  async delete(id: number): Promise<Customer> {
    return this.prisma.customer.delete({
      where: { id },
    });
  }
}
