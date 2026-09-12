import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Customer } from '@prisma/client';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCustomerDto): Promise<Customer> {
    return this.prisma.customer.create({ data: dto });
  }

  async findAll(): Promise<Customer[]> {
    return this.prisma.customer.findMany();
  }

  async findById(id: string): Promise<Customer | null> {
    return this.prisma.customer.findFirst({ where: { id } });
  }

  async update(id: string, dto: UpdateCustomerDto): Promise<Customer> {
    return this.prisma.customer.update({ where: { id }, data: dto });
  }

  async delete(id: string): Promise<Customer> {
    return this.prisma.customer.delete({ where: { id } });
  }
}
